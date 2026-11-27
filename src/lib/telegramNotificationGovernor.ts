/**
 * Signal Forge — Phase A: Telegram Anti-Flood Governor, State-Transition Filter,
 * Durable Deduplication, Cross-Worker Lease Coordinator & 429 Backoff Controller.
 *
 * Pure, side-effect-free TypeScript module (filesystem persistence is injected via
 * adapter callbacks in server.ts so all edge cases are exhaustively unit-tested).
 */

export type HealthDigestCadence = 'MANUAL' | '1h' | '2h' | '4h' | '6h' | '12h' | '24h';

export type SystemOperationalHealth = 'OPTIMAL' | 'SELF_HEALING' | 'DEGRADED' | 'CRITICAL';

export type TelegramAlertCategory =
  | 'CRITICAL_ALERT'
  | 'STATE_TRANSITION'
  | 'RECOVERY_EVENT'
  | 'PROTECTIVE_ORDER_FAILURE'
  | 'TRADING_ALERT'
  | 'ROUTINE_AUDIT'
  | 'HEALTH_DIGEST'
  | 'MANUAL_COMMAND'
  | 'PUBLIC_SIGNAL_PUBLISH';

export interface NotificationSettings {
  readonly criticalAlertsEnabled: boolean;
  readonly tradingAlertsEnabled: boolean;
  readonly routineAuditEnabled: boolean;
  readonly healthDigestCadence: HealthDigestCadence;
  readonly publicSignalPublishingEnabled: boolean;
  readonly updatedAtIso: string;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = Object.freeze({
  criticalAlertsEnabled: true,
  tradingAlertsEnabled: false,
  routineAuditEnabled: false, // STRICT DEFAULT: stops ~600/hr unsolicited OPTIMAL audit spam
  healthDigestCadence: '24h', // One optional daily digest by default
  publicSignalPublishingEnabled: true,
  updatedAtIso: '2026-11-23T00:00:00.000Z',
});

export const DIGEST_CADENCE_MS: Record<Exclude<HealthDigestCadence, 'MANUAL'>, number> = {
  '1h': 1 * 60 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

export interface DurableDedupeEntry {
  readonly deliveryId: string;
  readonly fingerprint: string;
  readonly category: TelegramAlertCategory;
  readonly targetStream: 'PERSONAL_ADMIN' | 'PUBLIC_CHANNEL';
  readonly dispatchedAtMs: number;
  readonly expiresAtMs: number;
}

export interface AggregatedNonCriticalFailure {
  readonly key: string;
  readonly count: number;
  readonly firstSeenIso: string;
  readonly lastSeenIso: string;
  readonly lastMessage: string;
}

export interface SchedulerLeaseRecord {
  readonly taskName: string;
  readonly workerId: string;
  readonly acquiredAtMs: number;
  readonly expiresAtMs: number;
}

export interface TelegramGovernorPersistedState {
  readonly schemaVersion: 1;
  readonly settings: NotificationSettings;
  readonly lastReportedHealth: SystemOperationalHealth;
  readonly lastHealthDigestSentAtMs: number;
  readonly retryAfterUntilMs: number;
  readonly dedupeEntries: DurableDedupeEntry[];
  readonly leases: Record<string, SchedulerLeaseRecord>;
  readonly suppressedRoutineAuditCount: number;
  readonly deduplicatedCount: number;
  readonly rateLimitedCount: number;
  readonly telegram429Count: number;
  readonly deliveredCount: number;
  readonly failedCount: number;
}

export interface DispatchDecision {
  readonly allowed: boolean;
  readonly reason:
    | 'ALLOWED'
    | 'SUPPRESSED_ROUTINE_AUDIT_DISABLED'
    | 'SUPPRESSED_UNCHANGED_HEALTHY_STATE'
    | 'SUPPRESSED_TRADING_ALERTS_DISABLED'
    | 'SUPPRESSED_PUBLIC_CHANNEL_DISABLED'
    | 'SUPPRESSED_CRITICAL_DISABLED'
    | 'SUPPRESSED_DUPLICATE_DELIVERY_ID'
    | 'SUPPRESSED_DUPLICATE_FINGERPRINT'
    | 'DEFERRED_TELEGRAM_429_BACKOFF'
    | 'SUPPRESSED_RATE_LIMIT_EXCEEDED'
    | 'BLOCKED_STREAM_ISOLATION_VIOLATION';
  readonly deliveryId: string;
  readonly retryAfterSec: number;
  readonly detail: string;
}

export interface TelegramSendOutcome {
  readonly ok: boolean;
  readonly httpStatus?: number | null;
  readonly retryAfterSeconds?: number | null;
  readonly errorDetail?: string | null;
}

export function normalizeHealthDigestCadence(raw: unknown): HealthDigestCadence {
  const value = String(raw || '').trim();
  if (
    value === 'MANUAL' ||
    value === '1h' ||
    value === '2h' ||
    value === '4h' ||
    value === '6h' ||
    value === '12h' ||
    value === '24h'
  ) {
    return value;
  }
  return '24h';
}

export function buildDeterministicDeliveryId(params: {
  category: TelegramAlertCategory;
  targetStream: 'PERSONAL_ADMIN' | 'PUBLIC_CHANNEL';
  eventKey: string;
}): string {
  const cleanKey = params.eventKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, '_')
    .slice(0, 96);
  return `tg_${params.targetStream.toLowerCase()}_${params.category.toLowerCase()}_${cleanKey}`;
}

export function extractTelegram429RetryAfterSeconds(
  httpStatus: number | null | undefined,
  responseBody: unknown
): number | null {
  if (httpStatus !== 429) return null;
  if (responseBody && typeof responseBody === 'object') {
    const params = (responseBody as { parameters?: { retry_after?: unknown } }).parameters;
    if (params && typeof params.retry_after === 'number' && Number.isFinite(params.retry_after)) {
      return Math.max(1, Math.min(3600, Math.ceil(params.retry_after)));
    }
    const desc = String((responseBody as { description?: unknown }).description || '');
    const match = desc.match(/retry after\s+(\d+)/i);
    if (match) {
      return Math.max(1, Math.min(3600, Number(match[1])));
    }
  }
  return 30;
}

export class TelegramNotificationGovernor {
  private settings: NotificationSettings;
  private lastReportedHealth: SystemOperationalHealth = 'OPTIMAL';
  private lastHealthDigestSentAtMs = 0;
  private retryAfterUntilMs = 0;
  private dedupeEntries: DurableDedupeEntry[] = [];
  private leases: Record<string, SchedulerLeaseRecord> = {};
  private recentSendTimestampsMs: number[] = [];
  private aggregatedFailures = new Map<string, AggregatedNonCriticalFailure>();
  private suppressedRoutineAuditCount = 0;
  private deduplicatedCount = 0;
  private rateLimitedCount = 0;
  private telegram429Count = 0;
  private deliveredCount = 0;
  private failedCount = 0;
  private readonly maxPerMinutePerGovernor: number;
  private readonly onPersist?: (state: TelegramGovernorPersistedState) => void;

  constructor(options?: {
    initialState?: Partial<TelegramGovernorPersistedState> | null;
    maxPerMinute?: number;
    onPersist?: (state: TelegramGovernorPersistedState) => void;
  }) {
    this.maxPerMinutePerGovernor = Math.max(2, Math.min(25, options?.maxPerMinute ?? 12));
    this.onPersist = options?.onPersist;
    this.settings = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...(options?.initialState?.settings || {}),
    };
    if (options?.initialState) {
      const s = options.initialState;
      this.lastReportedHealth = s.lastReportedHealth ?? 'OPTIMAL';
      this.lastHealthDigestSentAtMs = Number(s.lastHealthDigestSentAtMs || 0);
      this.retryAfterUntilMs = Number(s.retryAfterUntilMs || 0);
      this.dedupeEntries = Array.isArray(s.dedupeEntries) ? [...s.dedupeEntries] : [];
      this.leases = s.leases ? { ...s.leases } : {};
      this.suppressedRoutineAuditCount = Number(s.suppressedRoutineAuditCount || 0);
      this.deduplicatedCount = Number(s.deduplicatedCount || 0);
      this.rateLimitedCount = Number(s.rateLimitedCount || 0);
      this.telegram429Count = Number(s.telegram429Count || 0);
      this.deliveredCount = Number(s.deliveredCount || 0);
      this.failedCount = Number(s.failedCount || 0);
    }
  }

  getSettings(): NotificationSettings {
    return { ...this.settings };
  }

  updateSettings(
    patch: Partial<{
      criticalAlertsEnabled: boolean;
      tradingAlertsEnabled: boolean;
      routineAuditEnabled: boolean;
      healthDigestCadence: HealthDigestCadence;
      publicSignalPublishingEnabled: boolean;
    }>,
    nowMs = Date.now()
  ): NotificationSettings {
    this.settings = {
      criticalAlertsEnabled:
        typeof patch.criticalAlertsEnabled === 'boolean'
          ? patch.criticalAlertsEnabled
          : this.settings.criticalAlertsEnabled,
      tradingAlertsEnabled:
        typeof patch.tradingAlertsEnabled === 'boolean'
          ? patch.tradingAlertsEnabled
          : this.settings.tradingAlertsEnabled,
      routineAuditEnabled:
        typeof patch.routineAuditEnabled === 'boolean'
          ? patch.routineAuditEnabled
          : this.settings.routineAuditEnabled,
      healthDigestCadence:
        patch.healthDigestCadence !== undefined
          ? normalizeHealthDigestCadence(patch.healthDigestCadence)
          : this.settings.healthDigestCadence,
      publicSignalPublishingEnabled:
        typeof patch.publicSignalPublishingEnabled === 'boolean'
          ? patch.publicSignalPublishingEnabled
          : this.settings.publicSignalPublishingEnabled,
      updatedAtIso: new Date(nowMs).toISOString(),
    };
    this.persist();
    return this.getSettings();
  }

  /**
   * Cross-worker durable lease: ensures ONLY ONE worker/instance executes a scheduled
   * monitoring/digest task within the lease TTL, preventing multi-worker floods.
   */
  tryAcquireSchedulerLease(params: {
    taskName: string;
    workerId: string;
    leaseTtlMs: number;
    nowMs?: number;
  }): boolean {
    const now = params.nowMs ?? Date.now();
    const existing = this.leases[params.taskName];
    if (existing && existing.workerId !== params.workerId && existing.expiresAtMs > now) {
      return false;
    }
    this.leases[params.taskName] = {
      taskName: params.taskName,
      workerId: params.workerId,
      acquiredAtMs: now,
      expiresAtMs: now + Math.max(5_000, params.leaseTtlMs),
    };
    this.persist();
    return true;
  }

  /**
   * Evaluates whether a system health cycle should emit an alert.
   * Repeated OPTIMAL/HEALTHY cycles NEVER send Telegram messages unless routine audits
   * were explicitly turned ON by the admin. Genuine transitions (OPTIMAL -> DEGRADED/CRITICAL)
   * and recoveries (DEGRADED/CRITICAL -> OPTIMAL) ARE emitted immediately.
   */
  evaluateHealthCycle(params: {
    currentHealth: SystemOperationalHealth;
    nowMs?: number;
  }): {
    shouldSendImmediateAlert: boolean;
    category: TelegramAlertCategory | null;
    transitionLabel: string;
    shouldSendScheduledDigest: boolean;
  } {
    const now = params.nowMs ?? Date.now();
    const prev = this.lastReportedHealth;
    const curr = params.currentHealth;

    let shouldSendImmediateAlert = false;
    let category: TelegramAlertCategory | null = null;
    let transitionLabel = `${prev} -> ${curr} (unchanged)`;

    if (prev !== curr) {
      if (curr === 'CRITICAL' || curr === 'DEGRADED') {
        shouldSendImmediateAlert = this.settings.criticalAlertsEnabled;
        category = curr === 'CRITICAL' ? 'CRITICAL_ALERT' : 'STATE_TRANSITION';
        transitionLabel = `${prev} -> ${curr}`;
      } else if (curr === 'OPTIMAL' && (prev === 'CRITICAL' || prev === 'DEGRADED')) {
        shouldSendImmediateAlert = this.settings.criticalAlertsEnabled;
        category = 'RECOVERY_EVENT';
        transitionLabel = `${prev} -> OPTIMAL (RECOVERED)`;
      }
      this.lastReportedHealth = curr;
      this.persist();
    } else if (curr === 'OPTIMAL' || curr === 'SELF_HEALING') {
      if (!this.settings.routineAuditEnabled) {
        this.suppressedRoutineAuditCount += 1;
        this.persist();
      } else {
        shouldSendImmediateAlert = true;
        category = 'ROUTINE_AUDIT';
        transitionLabel = `${curr} (explicit routine audit enabled)`;
      }
    }

    let shouldSendScheduledDigest = false;
    if (this.settings.healthDigestCadence !== 'MANUAL') {
      const intervalMs = DIGEST_CADENCE_MS[this.settings.healthDigestCadence];
      if (this.lastHealthDigestSentAtMs === 0) {
        // Seed anchor on cold boot so restarting the server never blasts an immediate digest
        this.lastHealthDigestSentAtMs = now;
        this.persist();
      } else if (now - this.lastHealthDigestSentAtMs >= intervalMs) {
        shouldSendScheduledDigest = true;
      }
    }

    return {
      shouldSendImmediateAlert,
      category,
      transitionLabel,
      shouldSendScheduledDigest,
    };
  }

  /**
   * Central anti-flood gate called BEFORE any outbound Telegram API request.
   */
  evaluateOutboundDispatch(params: {
    category: TelegramAlertCategory;
    targetStream: 'PERSONAL_ADMIN' | 'PUBLIC_CHANNEL';
    eventKey: string;
    fingerprint: string;
    targetChatId: string;
    publicChannelChatId: string;
    dedupeWindowMs?: number;
    nowMs?: number;
  }): DispatchDecision {
    const now = params.nowMs ?? Date.now();
    this.pruneExpiredDedupe(now);

    const deliveryId = buildDeterministicDeliveryId({
      category: params.category,
      targetStream: params.targetStream,
      eventKey: params.eventKey,
    });

    // Strict separation: Personal admin alerts may NEVER route to the public channel
    if (
      params.targetStream === 'PERSONAL_ADMIN' &&
      params.publicChannelChatId &&
      params.targetChatId.trim() === params.publicChannelChatId.trim()
    ) {
      return {
        allowed: false,
        reason: 'BLOCKED_STREAM_ISOLATION_VIOLATION',
        deliveryId,
        retryAfterSec: 0,
        detail: 'Stream isolation enforced: personal admin notification cannot target the public Telegram channel.',
      };
    }

    // Category policy checks (Manual /status / /audit commands always bypass routine suppression)
    if (params.category === 'ROUTINE_AUDIT' && !this.settings.routineAuditEnabled) {
      this.suppressedRoutineAuditCount += 1;
      this.persist();
      return {
        allowed: false,
        reason: 'SUPPRESSED_ROUTINE_AUDIT_DISABLED',
        deliveryId,
        retryAfterSec: 0,
        detail: 'Routine OPTIMAL/HEALTHY Telegram audits are disabled by default to prevent alert flooding.',
      };
    }

    if (params.category === 'TRADING_ALERT' && !this.settings.tradingAlertsEnabled) {
      return {
        allowed: false,
        reason: 'SUPPRESSED_TRADING_ALERTS_DISABLED',
        deliveryId,
        retryAfterSec: 0,
        detail: 'Trading alerts are currently disabled in Command Hub Notification Settings.',
      };
    }

    if (
      params.category === 'PUBLIC_SIGNAL_PUBLISH' &&
      !this.settings.publicSignalPublishingEnabled
    ) {
      return {
        allowed: false,
        reason: 'SUPPRESSED_PUBLIC_CHANNEL_DISABLED',
        deliveryId,
        retryAfterSec: 0,
        detail: 'Public Telegram signal publishing is currently paused in Notification Settings.',
      };
    }

    if (
      (params.category === 'CRITICAL_ALERT' ||
        params.category === 'STATE_TRANSITION' ||
        params.category === 'RECOVERY_EVENT' ||
        params.category === 'PROTECTIVE_ORDER_FAILURE') &&
      !this.settings.criticalAlertsEnabled
    ) {
      return {
        allowed: false,
        reason: 'SUPPRESSED_CRITICAL_DISABLED',
        deliveryId,
        retryAfterSec: 0,
        detail: 'Critical alerts are explicitly disabled in Notification Settings.',
      };
    }

    // Telegram HTTP 429 retry_after global backoff check
    if (this.retryAfterUntilMs > now) {
      const retryAfterSec = Math.ceil((this.retryAfterUntilMs - now) / 1000);
      this.rateLimitedCount += 1;
      this.persist();
      return {
        allowed: false,
        reason: 'DEFERRED_TELEGRAM_429_BACKOFF',
        deliveryId,
        retryAfterSec,
        detail: `Honoring Telegram 429 retry_after backoff for ${retryAfterSec}s.`,
      };
    }

    // Durable deduplication check (skip only for explicit user-triggered /status commands)
    if (params.category !== 'MANUAL_COMMAND') {
      const dupById = this.dedupeEntries.find((e) => e.deliveryId === deliveryId);
      if (dupById) {
        this.deduplicatedCount += 1;
        this.persist();
        return {
          allowed: false,
          reason: 'SUPPRESSED_DUPLICATE_DELIVERY_ID',
          deliveryId,
          retryAfterSec: 0,
          detail: `Duplicate deliveryId "${deliveryId}" already dispatched.`,
        };
      }
      const dupByFingerprint = this.dedupeEntries.find(
        (e) =>
          e.fingerprint === params.fingerprint &&
          e.targetStream === params.targetStream &&
          e.category === params.category
      );
      if (dupByFingerprint) {
        this.deduplicatedCount += 1;
        this.persist();
        return {
          allowed: false,
          reason: 'SUPPRESSED_DUPLICATE_FINGERPRINT',
          deliveryId,
          retryAfterSec: 0,
          detail: `Identical ${params.category} payload suppressed within deduplication window.`,
        };
      }
    }

    // Sliding 60-second outbound rate cap (critical alerts get 2x emergency burst headroom)
    const oneMinAgo = now - 60_000;
    this.recentSendTimestampsMs = this.recentSendTimestampsMs.filter((t) => t >= oneMinAgo);
    const limit =
      params.category === 'CRITICAL_ALERT' || params.category === 'PROTECTIVE_ORDER_FAILURE'
        ? this.maxPerMinutePerGovernor * 2
        : this.maxPerMinutePerGovernor;
    if (this.recentSendTimestampsMs.length >= limit) {
      this.rateLimitedCount += 1;
      this.persist();
      return {
        allowed: false,
        reason: 'SUPPRESSED_RATE_LIMIT_EXCEEDED',
        deliveryId,
        retryAfterSec: 15,
        detail: `Outbound Telegram rate cap (${limit}/min) reached — message suppressed to protect bot quota.`,
      };
    }

    return {
      allowed: true,
      reason: 'ALLOWED',
      deliveryId,
      retryAfterSec: 0,
      detail: 'Authorized for outbound Telegram delivery.',
    };
  }

  recordDeliveryOutcome(params: {
    deliveryId: string;
    fingerprint: string;
    category: TelegramAlertCategory;
    targetStream: 'PERSONAL_ADMIN' | 'PUBLIC_CHANNEL';
    outcome: TelegramSendOutcome;
    dedupeWindowMs?: number;
    nowMs?: number;
  }): void {
    const now = params.nowMs ?? Date.now();
    this.recentSendTimestampsMs.push(now);

    if (params.outcome.ok) {
      this.deliveredCount += 1;
      const ttl = params.dedupeWindowMs ?? (params.category === 'HEALTH_DIGEST' ? 50 * 60_000 : 15 * 60_000);
      this.dedupeEntries.push({
        deliveryId: params.deliveryId,
        fingerprint: params.fingerprint,
        category: params.category,
        targetStream: params.targetStream,
        dispatchedAtMs: now,
        expiresAtMs: now + ttl,
      });
      if (this.dedupeEntries.length > 500) {
        this.dedupeEntries.splice(0, this.dedupeEntries.length - 500);
      }
      if (params.category === 'HEALTH_DIGEST') {
        this.lastHealthDigestSentAtMs = now;
      }
      this.persist();
      return;
    }

    this.failedCount += 1;
    if (params.outcome.httpStatus === 429) {
      const waitSec = Math.max(1, Math.min(3600, params.outcome.retryAfterSeconds ?? 30));
      this.retryAfterUntilMs = Math.max(this.retryAfterUntilMs, now + waitSec * 1000);
      this.telegram429Count += 1;
    }
    this.recordNonCriticalFailure(
      `telegram_send:${params.category}`,
      params.outcome.errorDetail || `HTTP ${params.outcome.httpStatus ?? 'error'}`,
      now
    );
    this.persist();
  }

  recordNonCriticalFailure(key: string, message: string, nowMs = Date.now()): AggregatedNonCriticalFailure {
    const nowIso = new Date(nowMs).toISOString();
    const existing = this.aggregatedFailures.get(key);
    const next: AggregatedNonCriticalFailure = existing
      ? {
          ...existing,
          count: existing.count + 1,
          lastSeenIso: nowIso,
          lastMessage: message.slice(0, 240),
        }
      : {
          key,
          count: 1,
          firstSeenIso: nowIso,
          lastSeenIso: nowIso,
          lastMessage: message.slice(0, 240),
        };
    this.aggregatedFailures.set(key, next);
    if (this.aggregatedFailures.size > 100) {
      const oldestKey = this.aggregatedFailures.keys().next().value;
      if (oldestKey) this.aggregatedFailures.delete(oldestKey);
    }
    return next;
  }

  getAggregatedFailures(): AggregatedNonCriticalFailure[] {
    return Array.from(this.aggregatedFailures.values());
  }

  exportPersistedState(): TelegramGovernorPersistedState {
    return {
      schemaVersion: 1,
      settings: this.getSettings(),
      lastReportedHealth: this.lastReportedHealth,
      lastHealthDigestSentAtMs: this.lastHealthDigestSentAtMs,
      retryAfterUntilMs: this.retryAfterUntilMs,
      dedupeEntries: [...this.dedupeEntries],
      leases: { ...this.leases },
      suppressedRoutineAuditCount: this.suppressedRoutineAuditCount,
      deduplicatedCount: this.deduplicatedCount,
      rateLimitedCount: this.rateLimitedCount,
      telegram429Count: this.telegram429Count,
      deliveredCount: this.deliveredCount,
      failedCount: this.failedCount,
    };
  }

  getTelemetrySnapshot(nowMs = Date.now()) {
    this.pruneExpiredDedupe(nowMs);
    return {
      settings: this.getSettings(),
      lastReportedHealth: this.lastReportedHealth,
      lastHealthDigestSentAtIso:
        this.lastHealthDigestSentAtMs > 0
          ? new Date(this.lastHealthDigestSentAtMs).toISOString()
          : null,
      telegram429BackoffActive: this.retryAfterUntilMs > nowMs,
      telegram429RetryAfterSec:
        this.retryAfterUntilMs > nowMs ? Math.ceil((this.retryAfterUntilMs - nowMs) / 1000) : 0,
      activeDedupeCount: this.dedupeEntries.length,
      activeSchedulerLeases: Object.values(this.leases).filter((l) => l.expiresAtMs > nowMs),
      counters: {
        deliveredCount: this.deliveredCount,
        suppressedRoutineAuditCount: this.suppressedRoutineAuditCount,
        deduplicatedCount: this.deduplicatedCount,
        rateLimitedCount: this.rateLimitedCount,
        telegram429Count: this.telegram429Count,
        failedCount: this.failedCount,
      },
      aggregatedNonCriticalFailures: this.getAggregatedFailures(),
    };
  }

  private pruneExpiredDedupe(nowMs: number): void {
    this.dedupeEntries = this.dedupeEntries.filter((e) => e.expiresAtMs > nowMs);
  }

  private persist(): void {
    if (this.onPersist) {
      this.onPersist(this.exportPersistedState());
    }
  }
}

/**
 * Singleton timer registry: prevents duplicate background schedulers after
 * module re-entry or service restarts within the same Node process.
 */
export class SingletonSchedulerRegistry {
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();

  register(name: string, intervalMs: number, fn: () => void): void {
    const existing = this.timers.get(name);
    if (existing) {
      clearInterval(existing);
    }
    const handle = setInterval(fn, intervalMs);
    this.timers.set(name, handle);
  }

  clear(name: string): void {
    const existing = this.timers.get(name);
    if (existing) {
      clearInterval(existing);
      this.timers.delete(name);
    }
  }

  clearAll(): void {
    for (const handle of this.timers.values()) {
      clearInterval(handle);
    }
    this.timers.clear();
  }

  listActiveNames(): string[] {
    return Array.from(this.timers.keys());
  }
}

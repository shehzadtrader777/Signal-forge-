/**
 * Signal Forge — Step 3 Persistent Notification Ledger (SQLite) & Delivery Dispatcher
 *
 * - Persists every notification lifecycle record in `.data/signal_forge_notification_ledger.sqlite`
 *   using strictly parameterized prepared statements (survives restarts; zero secrets stored).
 * - Enforces persistent idempotency keyed by (signal_id, event_type, destination).
 * - Enforces single-transport Telegram policy (Make.com OR Direct Telegram; never parallel
 *   duplicates; optional owner-enabled fallback only when primary fails & no prior delivery exists).
 * - Preserves full typed signal payloads across retries (never zeroes TP1/TP2/TP3/SL/Entry).
 * - Handles Discord `?wait=true` genuine message ID capture, Make.com 404 diagnostics,
 *   Telegram 401 auth failure detection, and HTTP 429 `Retry-After` backoff cleanly.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  appendDiscordWaitQuery,
  buildDiscordSignalPayload,
  buildSecretFreeMakePayload,
  resolveDiscordWebhookConfig,
  resolveMakeWebhookConfig,
  resolveTelegramConfig,
  sanitizeNotificationError,
  validatePersistedSignalPayload,
  type DeliveryLifecycleCounters,
  type NotificationDeliveryState,
  type NotificationDestination,
  type NotificationProviderId,
  type NotificationTransportPolicy,
  type PersistedSignalPayload,
  type ProviderConnectionHealthState,
  type ProviderHealthSummary,
  type ResolvedDiscordConfig,
  type ResolvedMakeWebhookConfig,
  type ResolvedTelegramConfig,
  type TelegramPrimaryTransport,
} from './notificationDeliveryConfig';

export interface NotificationErrorHistoryItem {
  readonly attempt: number;
  readonly provider: NotificationProviderId;
  readonly httpStatus: number | null;
  readonly error: string;
  readonly timestampIso: string;
}

export interface NotificationLedgerRecord {
  readonly idempotencyKey: string;
  readonly signalId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly destination: NotificationDestination;
  readonly provider: NotificationProviderId;
  readonly state: NotificationDeliveryState;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly nextRetryAtMs: number;
  readonly providerHttpStatus: number | null;
  readonly providerMessageId: string | null;
  readonly sanitizedError: string | null;
  readonly errorHistory: readonly NotificationErrorHistoryItem[];
  readonly payload: PersistedSignalPayload | null;
  readonly createdAtIso: string;
  readonly dispatchedAtIso: string | null;
  readonly updatedAtIso: string;
}

export interface PersistedProviderHealthRow {
  readonly provider: NotificationProviderId;
  readonly state: ProviderConnectionHealthState;
  readonly lastVerifiedAtIso: string | null;
  readonly lastSuccessAtIso: string | null;
  readonly lastSuccessDetail: string | null;
  readonly lastFailureAtIso: string | null;
  readonly lastFailureHttpStatus: number | null;
  readonly lastFailureDetail: string | null;
  readonly botUsername: string | null;
  readonly updatedAtIso: string;
}

interface RawLedgerRow {
  idempotency_key: string;
  signal_id: string;
  event_id: string;
  event_type: string;
  destination: string;
  provider: string;
  state: string;
  attempt_count: number;
  max_attempts: number;
  next_retry_at_ms: number;
  provider_http_status: number | null;
  provider_message_id: string | null;
  sanitized_error: string | null;
  error_history_json: string;
  payload_json: string | null;
  created_at_iso: string;
  dispatched_at_iso: string | null;
  updated_at_iso: string;
}

interface RawHealthRow {
  provider: string;
  state: string;
  last_verified_at_iso: string | null;
  last_success_at_iso: string | null;
  last_success_detail: string | null;
  last_failure_at_iso: string | null;
  last_failure_http_status: number | null;
  last_failure_detail: string | null;
  bot_username: string | null;
  updated_at_iso: string;
}

export function buildNotificationIdempotencyKey(
  signalId: string,
  eventType: string,
  destination: NotificationDestination
): string {
  return `${signalId.trim()}::${eventType.trim().toUpperCase()}::${destination}`;
}

export class PersistentNotificationLedger {
  private readonly db: DatabaseSync;
  public readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS notification_deliveries (
        idempotency_key TEXT PRIMARY KEY,
        signal_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        destination TEXT NOT NULL,
        provider TEXT NOT NULL,
        state TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 4,
        next_retry_at_ms INTEGER NOT NULL DEFAULT 0,
        provider_http_status INTEGER,
        provider_message_id TEXT,
        sanitized_error TEXT,
        error_history_json TEXT NOT NULL DEFAULT '[]',
        payload_json TEXT,
        created_at_iso TEXT NOT NULL,
        dispatched_at_iso TEXT,
        updated_at_iso TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notif_state_retry
        ON notification_deliveries (state, next_retry_at_ms);
      CREATE INDEX IF NOT EXISTS idx_notif_updated
        ON notification_deliveries (updated_at_iso DESC);
      CREATE TABLE IF NOT EXISTS provider_health_snapshots (
        provider TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        last_verified_at_iso TEXT,
        last_success_at_iso TEXT,
        last_success_detail TEXT,
        last_failure_at_iso TEXT,
        last_failure_http_status INTEGER,
        last_failure_detail TEXT,
        bot_username TEXT,
        updated_at_iso TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notification_lifecycle_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signal_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        stage TEXT NOT NULL,
        destination TEXT,
        detail TEXT,
        created_at_iso TEXT NOT NULL
      );
    `);
  }

  public close(): void {
    try {
      this.db.close();
    } catch {
      // ignore close errors
    }
  }

  private mapRow(row: RawLedgerRow): NotificationLedgerRecord {
    let errorHistory: NotificationErrorHistoryItem[] = [];
    try {
      const parsed = JSON.parse(row.error_history_json || '[]');
      if (Array.isArray(parsed)) errorHistory = parsed;
    } catch {
      errorHistory = [];
    }

    let payload: PersistedSignalPayload | null = null;
    if (row.payload_json) {
      try {
        const parsed = JSON.parse(row.payload_json);
        const validated = validatePersistedSignalPayload(parsed);
        if (validated.ok) payload = validated.payload;
      } catch {
        payload = null;
      }
    }

    return {
      idempotencyKey: row.idempotency_key,
      signalId: row.signal_id,
      eventId: row.event_id,
      eventType: row.event_type,
      destination: row.destination as NotificationDestination,
      provider: row.provider as NotificationProviderId,
      state: row.state as NotificationDeliveryState,
      attemptCount: Number(row.attempt_count || 0),
      maxAttempts: Number(row.max_attempts || 4),
      nextRetryAtMs: Number(row.next_retry_at_ms || 0),
      providerHttpStatus:
        row.provider_http_status !== null && row.provider_http_status !== undefined
          ? Number(row.provider_http_status)
          : null,
      providerMessageId: row.provider_message_id ?? null,
      sanitizedError: row.sanitized_error ?? null,
      errorHistory,
      payload,
      createdAtIso: row.created_at_iso,
      dispatchedAtIso: row.dispatched_at_iso ?? null,
      updatedAtIso: row.updated_at_iso,
    };
  }

  public recordLifecycleStage(params: {
    signalId: string;
    eventType: string;
    stage: 'SIGNAL_GENERATED' | 'SIGNAL_APPROVED' | 'SUPPRESSED';
    destination?: NotificationDestination | null;
    detail?: string | null;
    nowIso?: string;
  }): void {
    const nowIso = params.nowIso ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO notification_lifecycle_events (signal_id, event_type, stage, destination, detail, created_at_iso)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.signalId,
        params.eventType,
        params.stage,
        params.destination ?? null,
        params.detail ? params.detail.slice(0, 260) : null,
        nowIso
      );
  }

  public getRecord(idempotencyKey: string): NotificationLedgerRecord | null {
    const row = this.db
      .prepare('SELECT * FROM notification_deliveries WHERE idempotency_key = ?')
      .get(idempotencyKey) as RawLedgerRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  public hasConfirmedDelivery(
    signalId: string,
    eventType: string,
    destination: NotificationDestination
  ): boolean {
    const key = buildNotificationIdempotencyKey(signalId, eventType, destination);
    const existing = this.getRecord(key);
    return Boolean(
      existing &&
        (existing.state === 'PROVIDER_ACCEPTED' || existing.state === 'DELIVERED_WHEN_VERIFIABLE')
    );
  }

  public upsertDeliveryRecord(params: {
    signalId: string;
    eventId: string;
    eventType: string;
    destination: NotificationDestination;
    provider: NotificationProviderId;
    state: NotificationDeliveryState;
    attemptCount: number;
    maxAttempts: number;
    nextRetryAtMs: number;
    providerHttpStatus: number | null;
    providerMessageId: string | null;
    sanitizedError: string | null;
    errorHistory: readonly NotificationErrorHistoryItem[];
    payload: PersistedSignalPayload | null;
    dispatchedAtIso?: string | null;
    nowIso?: string;
  }): NotificationLedgerRecord {
    const nowIso = params.nowIso ?? new Date().toISOString();
    const key = buildNotificationIdempotencyKey(
      params.signalId,
      params.eventType,
      params.destination
    );
    const existing = this.getRecord(key);
    const createdAtIso = existing?.createdAtIso ?? nowIso;
    const dispatchedAtIso = params.dispatchedAtIso ?? existing?.dispatchedAtIso ?? null;

    // Never persist secrets inside payload_json
    const safePayloadJson = params.payload ? JSON.stringify(params.payload) : existing?.payload ? JSON.stringify(existing.payload) : null;
    const errorHistoryJson = JSON.stringify(params.errorHistory.slice(-10));

    this.db
      .prepare(
        `INSERT INTO notification_deliveries (
          idempotency_key, signal_id, event_id, event_type, destination, provider, state,
          attempt_count, max_attempts, next_retry_at_ms, provider_http_status, provider_message_id,
          sanitized_error, error_history_json, payload_json, created_at_iso, dispatched_at_iso, updated_at_iso
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(idempotency_key) DO UPDATE SET
          provider = excluded.provider,
          state = excluded.state,
          attempt_count = excluded.attempt_count,
          max_attempts = excluded.max_attempts,
          next_retry_at_ms = excluded.next_retry_at_ms,
          provider_http_status = excluded.provider_http_status,
          provider_message_id = COALESCE(excluded.provider_message_id, notification_deliveries.provider_message_id),
          sanitized_error = excluded.sanitized_error,
          error_history_json = excluded.error_history_json,
          payload_json = COALESCE(excluded.payload_json, notification_deliveries.payload_json),
          dispatched_at_iso = COALESCE(excluded.dispatched_at_iso, notification_deliveries.dispatched_at_iso),
          updated_at_iso = excluded.updated_at_iso`
      )
      .run(
        key,
        params.signalId,
        params.eventId,
        params.eventType,
        params.destination,
        params.provider,
        params.state,
        params.attemptCount,
        params.maxAttempts,
        params.nextRetryAtMs,
        params.providerHttpStatus,
        params.providerMessageId,
        params.sanitizedError,
        errorHistoryJson,
        safePayloadJson,
        createdAtIso,
        dispatchedAtIso,
        nowIso
      );

    return this.getRecord(key)!;
  }

  public getDueRetryRecords(nowMs = Date.now(), limit = 10): NotificationLedgerRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM notification_deliveries
         WHERE state IN ('QUEUED', 'RETRYING')
           AND attempt_count < max_attempts
           AND next_retry_at_ms <= ?
         ORDER BY next_retry_at_ms ASC
         LIMIT ?`
      )
      .all(nowMs, limit) as unknown as RawLedgerRow[];
    return rows.map((r) => this.mapRow(r));
  }

  public listRecentDeliveries(limit = 50): NotificationLedgerRecord[] {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const rows = this.db
      .prepare(
        `SELECT * FROM notification_deliveries
         ORDER BY updated_at_iso DESC
         LIMIT ?`
      )
      .all(safeLimit) as unknown as RawLedgerRow[];
    return rows.map((r) => this.mapRow(r));
  }

  public getCounters(): DeliveryLifecycleCounters {
    const stageCounts = new Map<string, number>();
    const lifecycleRows = this.db
      .prepare('SELECT stage, COUNT(*) as cnt FROM notification_lifecycle_events GROUP BY stage')
      .all() as Array<{ stage: string; cnt: number }>;
    for (const r of lifecycleRows) {
      stageCounts.set(r.stage, Number(r.cnt || 0));
    }

    const deliveryRows = this.db
      .prepare('SELECT state, COUNT(*) as cnt, COALESCE(SUM(attempt_count), 0) as attempts FROM notification_deliveries GROUP BY state')
      .all() as Array<{ state: string; cnt: number; attempts: number }>;

    const stateMap = new Map<string, number>();
    let totalAttempted = 0;
    for (const r of deliveryRows) {
      stateMap.set(r.state, Number(r.cnt || 0));
      totalAttempted += Number(r.attempts || 0);
    }

    return {
      signalGenerated: stageCounts.get('SIGNAL_GENERATED') ?? 0,
      signalApproved: stageCounts.get('SIGNAL_APPROVED') ?? 0,
      queued: stateMap.get('QUEUED') ?? 0,
      dispatchAttempted: totalAttempted,
      providerAccepted: stateMap.get('PROVIDER_ACCEPTED') ?? 0,
      deliveredWhenVerifiable: stateMap.get('DELIVERED_WHEN_VERIFIABLE') ?? 0,
      failed: stateMap.get('FAILED') ?? 0,
      retrying: stateMap.get('RETRYING') ?? 0,
      suppressed: (stateMap.get('SUPPRESSED') ?? 0) + (stageCounts.get('SUPPRESSED') ?? 0),
    };
  }

  public saveProviderHealth(row: PersistedProviderHealthRow): void {
    this.db
      .prepare(
        `INSERT INTO provider_health_snapshots (
          provider, state, last_verified_at_iso, last_success_at_iso, last_success_detail,
          last_failure_at_iso, last_failure_http_status, last_failure_detail, bot_username, updated_at_iso
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider) DO UPDATE SET
          state = excluded.state,
          last_verified_at_iso = COALESCE(excluded.last_verified_at_iso, provider_health_snapshots.last_verified_at_iso),
          last_success_at_iso = COALESCE(excluded.last_success_at_iso, provider_health_snapshots.last_success_at_iso),
          last_success_detail = COALESCE(excluded.last_success_detail, provider_health_snapshots.last_success_detail),
          last_failure_at_iso = COALESCE(excluded.last_failure_at_iso, provider_health_snapshots.last_failure_at_iso),
          last_failure_http_status = COALESCE(excluded.last_failure_http_status, provider_health_snapshots.last_failure_http_status),
          last_failure_detail = COALESCE(excluded.last_failure_detail, provider_health_snapshots.last_failure_detail),
          bot_username = COALESCE(excluded.bot_username, provider_health_snapshots.bot_username),
          updated_at_iso = excluded.updated_at_iso`
      )
      .run(
        row.provider,
        row.state,
        row.lastVerifiedAtIso,
        row.lastSuccessAtIso,
        row.lastSuccessDetail,
        row.lastFailureAtIso,
        row.lastFailureHttpStatus,
        row.lastFailureDetail,
        row.botUsername,
        row.updatedAtIso
      );
  }

  public getProviderHealth(provider: NotificationProviderId): PersistedProviderHealthRow | null {
    const row = this.db
      .prepare('SELECT * FROM provider_health_snapshots WHERE provider = ?')
      .get(provider) as RawHealthRow | undefined;
    if (!row) return null;
    return {
      provider: row.provider as NotificationProviderId,
      state: row.state as ProviderConnectionHealthState,
      lastVerifiedAtIso: row.last_verified_at_iso ?? null,
      lastSuccessAtIso: row.last_success_at_iso ?? null,
      lastSuccessDetail: row.last_success_detail ?? null,
      lastFailureAtIso: row.last_failure_at_iso ?? null,
      lastFailureHttpStatus:
        row.last_failure_http_status !== null && row.last_failure_http_status !== undefined
          ? Number(row.last_failure_http_status)
          : null,
      lastFailureDetail: row.last_failure_detail ?? null,
      botUsername: row.bot_username ?? null,
      updatedAtIso: row.updated_at_iso,
    };
  }
}

export interface ProviderAttemptResult {
  readonly ok: boolean;
  readonly verifiableDelivery: boolean;
  readonly httpStatus: number | null;
  readonly providerMessageId: string | null;
  readonly latencyMs: number;
  readonly retryable: boolean;
  readonly retryAfterSec: number | null;
  readonly error: string | null;
  readonly healthState: ProviderConnectionHealthState;
}

export interface SignalDispatchOutcome {
  readonly signalId: string;
  readonly eventId: string;
  readonly suppressed: boolean;
  readonly suppressionReason: string | null;
  readonly duplicateBlocked: boolean;
  readonly telegramRecord: NotificationLedgerRecord | null;
  readonly discordRecord: NotificationLedgerRecord | null;
  readonly telegramDelivered: boolean;
  readonly telegramAccepted: boolean;
  readonly discordDelivered: boolean;
  readonly discordAccepted: boolean;
  readonly webhookDispatched: boolean;
  readonly webhookHttpStatus: number | null;
  readonly webhookLatencyMs: number | null;
  readonly webhookError: string | null;
  readonly telegramMirrorDelivered: boolean;
}

export interface NotificationHealthOverview {
  readonly policy: NotificationTransportPolicy;
  readonly counters: DeliveryLifecycleCounters;
  readonly telegram: ProviderHealthSummary;
  readonly makeWebhook: ProviderHealthSummary;
  readonly discord: ProviderHealthSummary;
  readonly configSummary: {
    readonly telegramBotTokenSource: ResolvedTelegramConfig['botTokenSource'];
    readonly telegramPublicChatIdSource: ResolvedTelegramConfig['publicChatIdSource'];
    readonly telegramDevChatIdSource: ResolvedTelegramConfig['devChatIdSource'];
    readonly telegramWebhookSecretValid: boolean;
    readonly legacyShadowConflict: boolean;
    readonly makeHost: string | null;
    readonly discordBotTokenConfiguredUnused: boolean;
    readonly discordChannelIdConfiguredUnused: boolean;
  };
  readonly advisories: readonly string[];
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function parseRetryAfterSeconds(res: Response, bodyJson: unknown): number | null {
  const header = res.headers.get('retry-after');
  if (header) {
    const num = Number(header);
    if (Number.isFinite(num) && num > 0) return Math.min(3600, Math.ceil(num));
  }
  if (bodyJson && typeof bodyJson === 'object') {
    const obj = bodyJson as Record<string, unknown>;
    if (typeof obj.retry_after === 'number' && Number.isFinite(obj.retry_after) && obj.retry_after > 0) {
      return Math.min(3600, Math.ceil(obj.retry_after));
    }
    const params = obj.parameters as Record<string, unknown> | undefined;
    if (params && typeof params.retry_after === 'number' && Number.isFinite(params.retry_after)) {
      return Math.min(3600, Math.ceil(params.retry_after));
    }
  }
  return null;
}

export class NotificationDispatcher {
  public readonly ledger: PersistentNotificationLedger;
  private readonly getEnv: () => Record<string, string | undefined>;
  private readonly fetchFn: FetchLike;
  private policy: NotificationTransportPolicy;
  private lastTelegramGetMeCheckMs = 0;
  private cachedTelegramGetMe: {
    ok: boolean;
    httpStatus: number | null;
    botUsername: string | null;
    error: string | null;
    checkedAtIso: string;
  } | null = null;
  private providerCooldownUntilMs = new Map<NotificationProviderId, number>();

  constructor(options: {
    ledger: PersistentNotificationLedger;
    getEnv?: () => Record<string, string | undefined>;
    fetchFn?: FetchLike;
    initialPolicy?: Partial<NotificationTransportPolicy>;
  }) {
    this.ledger = options.ledger;
    this.getEnv = options.getEnv ?? (() => process.env);
    this.fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));

    const env = this.getEnv();
    const makeCfg = resolveMakeWebhookConfig(env);
    const tgCfg = resolveTelegramConfig(env);
    const discordCfg = resolveDiscordWebhookConfig(env);

    const defaultPrimary: TelegramPrimaryTransport = makeCfg.valid
      ? 'MAKE_WEBHOOK'
      : tgCfg.botTokenValid && tgCfg.publicChatIdValid
      ? 'TELEGRAM_DIRECT'
      : 'DISABLED';

    this.policy = {
      telegramPrimaryTransport: options.initialPolicy?.telegramPrimaryTransport ?? defaultPrimary,
      allowTelegramFallbackOnPrimaryFailure:
        options.initialPolicy?.allowTelegramFallbackOnPrimaryFailure ?? false,
      discordEnabled: options.initialPolicy?.discordEnabled ?? discordCfg.valid,
      updatedAtIso: new Date().toISOString(),
    };
  }

  public getConfigs(): {
    telegram: ResolvedTelegramConfig;
    make: ResolvedMakeWebhookConfig;
    discord: ResolvedDiscordConfig;
  } {
    const env = this.getEnv();
    return {
      telegram: resolveTelegramConfig(env),
      make: resolveMakeWebhookConfig(env),
      discord: resolveDiscordWebhookConfig(env),
    };
  }

  public getPolicy(): NotificationTransportPolicy {
    return this.policy;
  }

  public updatePolicy(patch: Partial<NotificationTransportPolicy>): NotificationTransportPolicy {
    const nextPrimary: TelegramPrimaryTransport =
      patch.telegramPrimaryTransport === 'MAKE_WEBHOOK' ||
      patch.telegramPrimaryTransport === 'TELEGRAM_DIRECT' ||
      patch.telegramPrimaryTransport === 'DISABLED'
        ? patch.telegramPrimaryTransport
        : this.policy.telegramPrimaryTransport;

    this.policy = {
      telegramPrimaryTransport: nextPrimary,
      allowTelegramFallbackOnPrimaryFailure:
        typeof patch.allowTelegramFallbackOnPrimaryFailure === 'boolean'
          ? patch.allowTelegramFallbackOnPrimaryFailure
          : this.policy.allowTelegramFallbackOnPrimaryFailure,
      discordEnabled:
        typeof patch.discordEnabled === 'boolean'
          ? patch.discordEnabled
          : this.policy.discordEnabled,
      updatedAtIso: new Date().toISOString(),
    };
    return this.policy;
  }

  private getSecretsForRedaction(): string[] {
    const env = this.getEnv();
    return [
      env.TELEGRAM_BOT_TOKEN,
      env.BOT_TOKEN,
      env.WEBHOOK_BOT_TOKEN,
      env.TELEGRAM_WEBHOOK_SECRET,
      env.MAKE_WEBHOOK_URL,
      env.DISCORD_WEBHOOK_URL,
      env.DISCORD_BOT_TOKEN,
    ].filter((s): s is string => Boolean(s && s.trim().length >= 8));
  }

  /**
   * Low-volume, strictly READ-ONLY Telegram `getMe` authentication check.
   * Never sends a message. Cached for 5 minutes unless force=true.
   */
  public async verifyTelegramBotAuth(force = false): Promise<{
    ok: boolean;
    state: ProviderConnectionHealthState;
    httpStatus: number | null;
    botUsername: string | null;
    error: string | null;
    checkedAtIso: string;
    cached: boolean;
  }> {
    const { telegram } = this.getConfigs();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    if (!telegram.botToken) {
      const err = telegram.issues.find((i) => i.envVar.includes('TOKEN'))?.message || 'TELEGRAM_BOT_TOKEN not configured.';
      return {
        ok: false,
        state: 'UNCONFIGURED',
        httpStatus: null,
        botUsername: null,
        error: err,
        checkedAtIso: nowIso,
        cached: false,
      };
    }

    if (!force && this.cachedTelegramGetMe && nowMs - this.lastTelegramGetMeCheckMs < 5 * 60_000) {
      return {
        ...this.cachedTelegramGetMe,
        state: this.cachedTelegramGetMe.ok
          ? 'AUTHENTICATED'
          : this.cachedTelegramGetMe.httpStatus === 401
          ? 'AUTH_FAILED'
          : 'WEBHOOK_UNREACHABLE',
        cached: true,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await this.fetchFn(`https://api.telegram.org/bot${telegram.botToken}/getMe`, {
        method: 'GET',
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const resultObj = (json?.result as Record<string, unknown> | undefined) ?? undefined;
      if (res.ok && json?.ok === true && resultObj) {
        const username = typeof resultObj.username === 'string' ? `@${resultObj.username}` : null;
        this.cachedTelegramGetMe = {
          ok: true,
          httpStatus: res.status,
          botUsername: username,
          error: null,
          checkedAtIso: nowIso,
        };
        this.lastTelegramGetMeCheckMs = nowMs;
        this.ledger.saveProviderHealth({
          provider: 'TELEGRAM_DIRECT',
          state: 'AUTHENTICATED',
          lastVerifiedAtIso: nowIso,
          lastSuccessAtIso: null,
          lastSuccessDetail: username ? `Telegram getMe verified (${username})` : 'Telegram getMe verified',
          lastFailureAtIso: null,
          lastFailureHttpStatus: null,
          lastFailureDetail: null,
          botUsername: username,
          updatedAtIso: nowIso,
        });
        return {
          ok: true,
          state: 'AUTHENTICATED',
          httpStatus: res.status,
          botUsername: username,
          error: null,
          checkedAtIso: nowIso,
          cached: false,
        };
      }

      const rawDesc =
        typeof json?.description === 'string'
          ? json.description
          : `Telegram getMe HTTP ${res.status}`;
      const sanitized = sanitizeNotificationError(rawDesc, this.getSecretsForRedaction()) || 'Telegram auth failed';
      const state: ProviderConnectionHealthState =
        res.status === 401 || /unauthorized/i.test(sanitized) ? 'AUTH_FAILED' : 'WEBHOOK_UNREACHABLE';

      this.cachedTelegramGetMe = {
        ok: false,
        httpStatus: res.status,
        botUsername: null,
        error: sanitized,
        checkedAtIso: nowIso,
      };
      this.lastTelegramGetMeCheckMs = nowMs;
      this.ledger.saveProviderHealth({
        provider: 'TELEGRAM_DIRECT',
        state,
        lastVerifiedAtIso: nowIso,
        lastSuccessAtIso: null,
        lastSuccessDetail: null,
        lastFailureAtIso: nowIso,
        lastFailureHttpStatus: res.status,
        lastFailureDetail: sanitized,
        botUsername: null,
        updatedAtIso: nowIso,
      });
      return {
        ok: false,
        state,
        httpStatus: res.status,
        botUsername: null,
        error: sanitized,
        checkedAtIso: nowIso,
        cached: false,
      };
    } catch (err) {
      const sanitized =
        sanitizeNotificationError(
          err instanceof Error ? err.message : 'Telegram getMe network error',
          this.getSecretsForRedaction()
        ) || 'Telegram getMe network error';
      this.cachedTelegramGetMe = {
        ok: false,
        httpStatus: null,
        botUsername: null,
        error: sanitized,
        checkedAtIso: nowIso,
      };
      this.lastTelegramGetMeCheckMs = nowMs;
      this.ledger.saveProviderHealth({
        provider: 'TELEGRAM_DIRECT',
        state: 'WEBHOOK_UNREACHABLE',
        lastVerifiedAtIso: nowIso,
        lastSuccessAtIso: null,
        lastSuccessDetail: null,
        lastFailureAtIso: nowIso,
        lastFailureHttpStatus: null,
        lastFailureDetail: sanitized,
        botUsername: null,
        updatedAtIso: nowIso,
      });
      return {
        ok: false,
        state: 'WEBHOOK_UNREACHABLE',
        httpStatus: null,
        botUsername: null,
        error: sanitized,
        checkedAtIso: nowIso,
        cached: false,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  public async sendViaMakeWebhook(
    payload: PersistedSignalPayload,
    nowMs = Date.now()
  ): Promise<ProviderAttemptResult> {
    const { make } = this.getConfigs();
    const secrets = this.getSecretsForRedaction();
    const nowIso = new Date(nowMs).toISOString();

    if (!make.configured) {
      return {
        ok: false,
        verifiableDelivery: false,
        httpStatus: null,
        providerMessageId: null,
        latencyMs: 0,
        retryable: false,
        retryAfterSec: null,
        error: 'MAKE_WEBHOOK_URL is not configured in server Secrets.',
        healthState: 'UNCONFIGURED',
      };
    }
    if (!make.valid || !make.webhookUrl) {
      const reason = make.issues[0]?.message || 'MAKE_WEBHOOK_URL is malformed.';
      return {
        ok: false,
        verifiableDelivery: false,
        httpStatus: null,
        providerMessageId: null,
        latencyMs: 0,
        retryable: false,
        retryAfterSec: null,
        error: reason,
        healthState: 'BLOCKED',
      };
    }

    const cooldownUntil = this.providerCooldownUntilMs.get('MAKE_WEBHOOK') ?? 0;
    if (cooldownUntil > nowMs) {
      const waitSec = Math.ceil((cooldownUntil - nowMs) / 1000);
      return {
        ok: false,
        verifiableDelivery: false,
        httpStatus: 429,
        providerMessageId: null,
        latencyMs: 0,
        retryable: true,
        retryAfterSec: waitSec,
        error: `Make.com rate-limit backoff active (${waitSec}s remaining).`,
        healthState: 'DELIVERY_FAILED',
      };
    }

    const validated = validatePersistedSignalPayload(payload);
    if (!validated.ok) {
      return {
        ok: false,
        verifiableDelivery: false,
        httpStatus: null,
        providerMessageId: null,
        latencyMs: 0,
        retryable: false,
        retryAfterSec: null,
        error: `Payload validation rejected before dispatch: ${validated.error}`,
        healthState: 'DELIVERY_FAILED',
      };
    }

    const outboundBody = buildSecretFreeMakePayload(validated.payload);
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5500);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Signal-Forge-Signal-Id': validated.payload.signalId,
        'X-Signal-Forge-Event-Id': validated.payload.eventId,
      };
      if (validated.payload.targetChatId) {
        headers['X-Signal-Forge-Chat-Id'] = validated.payload.targetChatId;
      }

      const res = await this.fetchFn(make.webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(outboundBody),
        signal: controller.signal,
      });
      const latencyMs = Math.max(1, Date.now() - startedAt);
      const rawText = await res.text().catch(() => '');
      let parsedJson: unknown = null;
      try {
        parsedJson = rawText ? JSON.parse(rawText) : null;
      } catch {
        parsedJson = null;
      }

      if (res.ok) {
        const msgId =
          parsedJson && typeof parsedJson === 'object' && typeof (parsedJson as Record<string, unknown>).message_id === 'string'
            ? String((parsedJson as Record<string, unknown>).message_id)
            : null;
        this.ledger.saveProviderHealth({
          provider: 'MAKE_WEBHOOK',
          state: 'DELIVERY_ACCEPTED',
          lastVerifiedAtIso: nowIso,
          lastSuccessAtIso: nowIso,
          lastSuccessDetail: `Make.com accepted webhook (HTTP ${res.status} · ${latencyMs}ms)`,
          lastFailureAtIso: null,
          lastFailureHttpStatus: null,
          lastFailureDetail: null,
          botUsername: null,
          updatedAtIso: nowIso,
        });
        return {
          ok: true,
          verifiableDelivery: false, // Make.com HTTP 200 confirms webhook acceptance, not final Telegram channel publication
          httpStatus: res.status,
          providerMessageId: msgId,
          latencyMs,
          retryable: false,
          retryAfterSec: null,
          error: null,
          healthState: 'DELIVERY_ACCEPTED',
        };
      }

      const retryAfterSec = parseRetryAfterSeconds(res, parsedJson);
      if (res.status === 429 && retryAfterSec) {
        this.providerCooldownUntilMs.set('MAKE_WEBHOOK', nowMs + retryAfterSec * 1000);
      }

      const detail =
        res.status === 404
          ? 'Make.com Webhook HTTP 404 (Not found) — verify MAKE_WEBHOOK_URL matches an active Custom Webhook scenario in Make.com Secrets.'
          : sanitizeNotificationError(
              `Make.com Webhook HTTP ${res.status}${rawText ? `: ${rawText.slice(0, 120)}` : ''}`,
              secrets
            ) || `Make.com Webhook HTTP ${res.status}`;

      const healthState: ProviderConnectionHealthState =
        res.status === 404
          ? 'WEBHOOK_UNREACHABLE'
          : res.status === 401 || res.status === 403
          ? 'AUTH_FAILED'
          : 'DELIVERY_FAILED';

      this.ledger.saveProviderHealth({
        provider: 'MAKE_WEBHOOK',
        state: healthState,
        lastVerifiedAtIso: nowIso,
        lastSuccessAtIso: null,
        lastSuccessDetail: null,
        lastFailureAtIso: nowIso,
        lastFailureHttpStatus: res.status,
        lastFailureDetail: detail,
        botUsername: null,
        updatedAtIso: nowIso,
      });

      return {
        ok: false,
        verifiableDelivery: false,
        httpStatus: res.status,
        providerMessageId: null,
        latencyMs,
        retryable: res.status === 429 || res.status >= 500,
        retryAfterSec,
        error: detail,
        healthState,
      };
    } catch (err) {
      const latencyMs = Math.max(1, Date.now() - startedAt);
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      const detail =
        sanitizeNotificationError(
          isTimeout
            ? 'Make.com webhook request timed out after 5500ms.'
            : err instanceof Error
            ? err.message
            : 'Make.com webhook network error',
          secrets
        ) || 'Make.com webhook network error';

      this.ledger.saveProviderHealth({
        provider: 'MAKE_WEBHOOK',
        state: 'WEBHOOK_UNREACHABLE',
        lastVerifiedAtIso: nowIso,
        lastSuccessAtIso: null,
        lastSuccessDetail: null,
        lastFailureAtIso: nowIso,
        lastFailureHttpStatus: null,
        lastFailureDetail: detail,
        botUsername: null,
        updatedAtIso: nowIso,
      });

      return {
        ok: false,
        verifiableDelivery: false,
        httpStatus: null,
        providerMessageId: null,
        latencyMs,
        retryable: true,
        retryAfterSec: null,
        error: detail,
        healthState: 'WEBHOOK_UNREACHABLE',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  public async sendViaTelegramDirect(params: {
    chatId: string | null;
    text: string;
    nowMs?: number;
  }): Promise<ProviderAttemptResult> {
    const { telegram } = this.getConfigs();
    const secrets = this.getSecretsForRedaction();
    const nowMs = params.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();

    if (!telegram.botToken) {
      return {
        ok: false,
        verifiableDelivery: false,
        httpStatus: null,
        providerMessageId: null,
        latencyMs: 0,
        retryable: false,
        retryAfterSec: null,
        error: 'TELEGRAM_BOT_TOKEN is missing or malformed.',
        healthState: 'UNCONFIGURED',
      };
    }
    const target = String(params.chatId || '').trim();
    if (!target) {
      return {
        ok: false,
        verifiableDelivery: false,
        httpStatus: null,
        providerMessageId: null,
        latencyMs: 0,
        retryable: false,
        retryAfterSec: null,
        error: 'Target Telegram chat ID is missing or rejected as malformed.',
        healthState: 'BLOCKED',
      };
    }

    const cooldownUntil = this.providerCooldownUntilMs.get('TELEGRAM_DIRECT') ?? 0;
    if (cooldownUntil > nowMs) {
      const waitSec = Math.ceil((cooldownUntil - nowMs) / 1000);
      return {
        ok: false,
        verifiableDelivery: false,
        httpStatus: 429,
        providerMessageId: null,
        latencyMs: 0,
        retryable: true,
        retryAfterSec: waitSec,
        error: `Telegram 429 Retry-After backoff active (${waitSec}s remaining).`,
        healthState: 'DELIVERY_FAILED',
      };
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const res = await this.fetchFn(
        `https://api.telegram.org/bot${telegram.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: target,
            text: params.text,
            disable_web_page_preview: true,
          }),
          signal: controller.signal,
        }
      );
      const latencyMs = Math.max(1, Date.now() - startedAt);
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;

      if (res.ok && json?.ok === true) {
        const resultObj = (json.result as Record<string, unknown> | undefined) ?? undefined;
        const messageId =
          resultObj && resultObj.message_id !== undefined && resultObj.message_id !== null
            ? String(resultObj.message_id)
            : null;
        this.ledger.saveProviderHealth({
          provider: 'TELEGRAM_DIRECT',
          state: 'DELIVERY_ACCEPTED',
          lastVerifiedAtIso: nowIso,
          lastSuccessAtIso: nowIso,
          lastSuccessDetail: messageId
            ? `Telegram confirmed message_id ${messageId} (HTTP ${res.status})`
            : `Telegram sendMessage accepted (HTTP ${res.status})`,
          lastFailureAtIso: null,
          lastFailureHttpStatus: null,
          lastFailureDetail: null,
          botUsername: null,
          updatedAtIso: nowIso,
        });
        return {
          ok: true,
          verifiableDelivery: Boolean(messageId),
          httpStatus: res.status,
          providerMessageId: messageId,
          latencyMs,
          retryable: false,
          retryAfterSec: null,
          error: null,
          healthState: 'DELIVERY_ACCEPTED',
        };
      }

      const retryAfterSec = parseRetryAfterSeconds(res, json);
      if (res.status === 429 && retryAfterSec) {
        this.providerCooldownUntilMs.set('TELEGRAM_DIRECT', nowMs + retryAfterSec * 1000);
      }

      const rawDesc =
        typeof json?.description === 'string'
          ? json.description
          : `Telegram API HTTP ${res.status}`;
      const sanitized = sanitizeNotificationError(rawDesc, secrets) || `Telegram API HTTP ${res.status}`;
      const healthState: ProviderConnectionHealthState =
        res.status === 401 || /unauthorized/i.test(sanitized)
          ? 'AUTH_FAILED'
          : 'DELIVERY_FAILED';

      this.ledger.saveProviderHealth({
        provider: 'TELEGRAM_DIRECT',
        state: healthState,
        lastVerifiedAtIso: nowIso,
        lastSuccessAtIso: null,
        lastSuccessDetail: null,
        lastFailureAtIso: nowIso,
        lastFailureHttpStatus: res.status,
        lastFailureDetail: sanitized,
        botUsername: null,
        updatedAtIso: nowIso,
      });

      return {
        ok: false,
        verifiableDelivery: false,
        httpStatus: res.status,
        providerMessageId: null,
        latencyMs,
        retryable: res.status === 429 || res.status >= 500,
        retryAfterSec,
        error: sanitized,
        healthState,
      };
    } catch (err) {
      const latencyMs = Math.max(1, Date.now() - startedAt);
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      const sanitized =
        sanitizeNotificationError(
          isTimeout
            ? 'Telegram sendMessage timed out after 4500ms.'
            : err instanceof Error
            ? err.message
            : 'Telegram network error',
          secrets
        ) || 'Telegram network error';

      this.ledger.saveProviderHealth({
        provider: 'TELEGRAM_DIRECT',
        state: 'WEBHOOK_UNREACHABLE',
        lastVerifiedAtIso: nowIso,
        lastSuccessAtIso: null,
        lastSuccessDetail: null,
        lastFailureAtIso: nowIso,
        lastFailureHttpStatus: null,
        lastFailureDetail: sanitized,
        botUsername: null,
        updatedAtIso: nowIso,
      });

      return {
        ok: false,
        verifiableDelivery: false,
        httpStatus: null,
        providerMessageId: null,
        latencyMs,
        retryable: true,
        retryAfterSec: null,
        error: sanitized,
        healthState: 'WEBHOOK_UNREACHABLE',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  public async sendViaDiscordWebhook(
    payload: PersistedSignalPayload | { rawContent: string },
    nowMs = Date.now()
  ): Promise<ProviderAttemptResult> {
    const { discord } = this.getConfigs();
    const secrets = this.getSecretsForRedaction();
    const nowIso = new Date(nowMs).toISOString();

    if (!discord.configured) {
      return {
        ok: false,
        verifiableDelivery: false,
        httpStatus: null,
        providerMessageId: null,
        latencyMs: 0,
        retryable: false,
        retryAfterSec: null,
        error: 'DISCORD_WEBHOOK_URL is not configured in server Secrets.',
        healthState: 'UNCONFIGURED',
      };
    }
    if (!discord.valid || !discord.webhookUrl) {
      return {
        ok: false,
        verifiableDelivery: false,
        httpStatus: null,
        providerMessageId: null,
        latencyMs: 0,
        retryable: false,
        retryAfterSec: null,
        error: discord.issues[0]?.message || 'DISCORD_WEBHOOK_URL is invalid.',
        healthState: 'BLOCKED',
      };
    }

    const cooldownUntil = this.providerCooldownUntilMs.get('DISCORD_WEBHOOK') ?? 0;
    if (cooldownUntil > nowMs) {
      const waitSec = Math.ceil((cooldownUntil - nowMs) / 1000);
      return {
        ok: false,
        verifiableDelivery: false,
        httpStatus: 429,
        providerMessageId: null,
        latencyMs: 0,
        retryable: true,
        retryAfterSec: waitSec,
        error: `Discord 429 rate-limit backoff active (${waitSec}s remaining).`,
        healthState: 'DELIVERY_FAILED',
      };
    }

    let requestBody: Record<string, unknown>;
    if ('rawContent' in payload) {
      requestBody = {
        username: 'Signal Forge Signal Router',
        content: payload.rawContent.slice(0, 1900),
      };
    } else {
      const validated = validatePersistedSignalPayload(payload);
      if (!validated.ok) {
        return {
          ok: false,
          verifiableDelivery: false,
          httpStatus: null,
          providerMessageId: null,
          latencyMs: 0,
          retryable: false,
          retryAfterSec: null,
          error: `Discord payload validation failed: ${validated.error}`,
          healthState: 'DELIVERY_FAILED',
        };
      }
      requestBody = buildDiscordSignalPayload(validated.payload) as unknown as Record<
        string,
        unknown
      >;
    }

    const targetUrl = appendDiscordWaitQuery(discord.webhookUrl);
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await this.fetchFn(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      const latencyMs = Math.max(1, Date.now() - startedAt);
      const rawText = await res.text().catch(() => '');
      let json: Record<string, unknown> | null = null;
      try {
        json = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
      } catch {
        json = null;
      }

      if (res.ok) {
        const messageId =
          json && typeof json.id === 'string' && /^\d{15,22}$/.test(json.id) ? json.id : null;
        this.ledger.saveProviderHealth({
          provider: 'DISCORD_WEBHOOK',
          state: 'DELIVERY_ACCEPTED',
          lastVerifiedAtIso: nowIso,
          lastSuccessAtIso: nowIso,
          lastSuccessDetail: messageId
            ? `Discord confirmed message ${messageId} (HTTP ${res.status} · ${latencyMs}ms)`
            : `Discord accepted webhook (HTTP ${res.status} · ${latencyMs}ms)`,
          lastFailureAtIso: null,
          lastFailureHttpStatus: null,
          lastFailureDetail: null,
          botUsername: null,
          updatedAtIso: nowIso,
        });
        return {
          ok: true,
          verifiableDelivery: Boolean(messageId),
          httpStatus: res.status,
          providerMessageId: messageId,
          latencyMs,
          retryable: false,
          retryAfterSec: null,
          error: null,
          healthState: 'DELIVERY_ACCEPTED',
        };
      }

      const retryAfterSec = parseRetryAfterSeconds(res, json);
      if (res.status === 429 && retryAfterSec) {
        this.providerCooldownUntilMs.set('DISCORD_WEBHOOK', nowMs + retryAfterSec * 1000);
      }

      const errMsg =
        json && typeof json.message === 'string'
          ? `Discord HTTP ${res.status}: ${json.message}`
          : `Discord webhook HTTP ${res.status}${rawText ? `: ${rawText.slice(0, 120)}` : ''}`;
      const sanitized = sanitizeNotificationError(errMsg, secrets) || `Discord webhook HTTP ${res.status}`;
      const healthState: ProviderConnectionHealthState =
        res.status === 401 || res.status === 403
          ? 'AUTH_FAILED'
          : res.status === 404
          ? 'WEBHOOK_UNREACHABLE'
          : 'DELIVERY_FAILED';

      this.ledger.saveProviderHealth({
        provider: 'DISCORD_WEBHOOK',
        state: healthState,
        lastVerifiedAtIso: nowIso,
        lastSuccessAtIso: null,
        lastSuccessDetail: null,
        lastFailureAtIso: nowIso,
        lastFailureHttpStatus: res.status,
        lastFailureDetail: sanitized,
        botUsername: null,
        updatedAtIso: nowIso,
      });

      return {
        ok: false,
        verifiableDelivery: false,
        httpStatus: res.status,
        providerMessageId: null,
        latencyMs,
        retryable: res.status === 429 || res.status >= 500,
        retryAfterSec,
        error: sanitized,
        healthState,
      };
    } catch (err) {
      const latencyMs = Math.max(1, Date.now() - startedAt);
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      const sanitized =
        sanitizeNotificationError(
          isTimeout
            ? 'Discord webhook timed out after 6000ms.'
            : err instanceof Error
            ? err.message
            : 'Discord webhook network error',
          secrets
        ) || 'Discord webhook network error';

      this.ledger.saveProviderHealth({
        provider: 'DISCORD_WEBHOOK',
        state: 'WEBHOOK_UNREACHABLE',
        lastVerifiedAtIso: nowIso,
        lastSuccessAtIso: null,
        lastSuccessDetail: null,
        lastFailureAtIso: nowIso,
        lastFailureHttpStatus: null,
        lastFailureDetail: sanitized,
        botUsername: null,
        updatedAtIso: nowIso,
      });

      return {
        ok: false,
        verifiableDelivery: false,
        httpStatus: null,
        providerMessageId: null,
        latencyMs,
        retryable: true,
        retryAfterSec: null,
        error: sanitized,
        healthState: 'WEBHOOK_UNREACHABLE',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Dispatches a validated signal payload with:
   * - Strict publication gate enforcement (never sends unapproved public messages)
   * - Persistent SQLite idempotency across restarts
   * - Single-transport Telegram policy (Make.com primary OR Direct Telegram; never parallel duplicates)
   * - Full structured Discord webhook delivery with `?wait=true` acknowledgement
   */
  public async dispatchSignal(params: {
    payload: PersistedSignalPayload;
    approvedForPublicPublish: boolean;
    suppressionReason?: string | null;
    maxAttempts?: number;
    nowMs?: number;
  }): Promise<SignalDispatchOutcome> {
    const nowMs = params.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const maxAttempts = Math.max(1, Math.min(5, params.maxAttempts ?? 4));
    const validated = validatePersistedSignalPayload(params.payload);

    if (!validated.ok) {
      this.ledger.recordLifecycleStage({
        signalId: params.payload.signalId || 'invalid_signal',
        eventType: params.payload.eventType || 'SIGNAL_CARD',
        stage: 'SUPPRESSED',
        detail: validated.error,
        nowIso,
      });
      return {
        signalId: params.payload.signalId || 'invalid_signal',
        eventId: params.payload.eventId || 'invalid_event',
        suppressed: true,
        suppressionReason: validated.error,
        duplicateBlocked: false,
        telegramRecord: null,
        discordRecord: null,
        telegramDelivered: false,
        telegramAccepted: false,
        discordDelivered: false,
        discordAccepted: false,
        webhookDispatched: false,
        webhookHttpStatus: null,
        webhookLatencyMs: null,
        webhookError: validated.error,
        telegramMirrorDelivered: false,
      };
    }

    const payload = validated.payload;
    this.ledger.recordLifecycleStage({
      signalId: payload.signalId,
      eventType: payload.eventType,
      stage: 'SIGNAL_GENERATED',
      detail: `${payload.symbol} ${payload.direction} (${payload.signalCategory})`,
      nowIso,
    });

    if (!params.approvedForPublicPublish) {
      const reason =
        params.suppressionReason ||
        'Public signal publication is disabled or withheld by safety/governance gate.';
      this.ledger.recordLifecycleStage({
        signalId: payload.signalId,
        eventType: payload.eventType,
        stage: 'SUPPRESSED',
        destination: 'TELEGRAM_PUBLIC_CHANNEL',
        detail: reason,
        nowIso,
      });

      const primaryProvider: NotificationProviderId =
        this.policy.telegramPrimaryTransport === 'TELEGRAM_DIRECT'
          ? 'TELEGRAM_DIRECT'
          : 'MAKE_WEBHOOK';

      const suppressedTg = this.ledger.upsertDeliveryRecord({
        signalId: payload.signalId,
        eventId: payload.eventId,
        eventType: payload.eventType,
        destination: 'TELEGRAM_PUBLIC_CHANNEL',
        provider: primaryProvider,
        state: 'SUPPRESSED',
        attemptCount: 0,
        maxAttempts,
        nextRetryAtMs: 0,
        providerHttpStatus: null,
        providerMessageId: null,
        sanitizedError: reason,
        errorHistory: [],
        payload,
        nowIso,
      });

      return {
        signalId: payload.signalId,
        eventId: payload.eventId,
        suppressed: true,
        suppressionReason: reason,
        duplicateBlocked: false,
        telegramRecord: suppressedTg,
        discordRecord: null,
        telegramDelivered: false,
        telegramAccepted: false,
        discordDelivered: false,
        discordAccepted: false,
        webhookDispatched: false,
        webhookHttpStatus: null,
        webhookLatencyMs: null,
        webhookError: reason,
        telegramMirrorDelivered: false,
      };
    }

    this.ledger.recordLifecycleStage({
      signalId: payload.signalId,
      eventType: payload.eventType,
      stage: 'SIGNAL_APPROVED',
      detail: `${payload.symbol} ${payload.direction} approved for channel broadcast`,
      nowIso,
    });

    let duplicateBlocked = false;
    let telegramRecord: NotificationLedgerRecord | null = null;
    let webhookDispatched = false;
    let webhookHttpStatus: number | null = null;
    let webhookLatencyMs: number | null = null;
    let webhookError: string | null = null;
    let telegramMirrorDelivered = false;

    // 1. TELEGRAM DESTINATION — Single Primary Transport (never parallel duplicate sends)
    const tgKey = buildNotificationIdempotencyKey(
      payload.signalId,
      payload.eventType,
      'TELEGRAM_PUBLIC_CHANNEL'
    );
    if (this.ledger.hasConfirmedDelivery(payload.signalId, payload.eventType, 'TELEGRAM_PUBLIC_CHANNEL')) {
      duplicateBlocked = true;
      telegramRecord = this.ledger.getRecord(tgKey);
    } else if (this.policy.telegramPrimaryTransport !== 'DISABLED') {
      const existingTg = this.ledger.getRecord(tgKey);
      const history: NotificationErrorHistoryItem[] = [...(existingTg?.errorHistory ?? [])];
      let attempts = existingTg?.attemptCount ?? 0;

      const primaryProvider: NotificationProviderId =
        this.policy.telegramPrimaryTransport === 'TELEGRAM_DIRECT'
          ? 'TELEGRAM_DIRECT'
          : 'MAKE_WEBHOOK';

      const primaryRes =
        primaryProvider === 'MAKE_WEBHOOK'
          ? await this.sendViaMakeWebhook(payload, nowMs)
          : await this.sendViaTelegramDirect({
              chatId: payload.targetChatId,
              text: payload.formattedCard,
              nowMs,
            });
      attempts += 1;

      if (primaryProvider === 'MAKE_WEBHOOK') {
        webhookDispatched = primaryRes.ok;
        webhookHttpStatus = primaryRes.httpStatus;
        webhookLatencyMs = primaryRes.latencyMs;
        webhookError = primaryRes.error;
      } else {
        telegramMirrorDelivered = primaryRes.ok;
      }

      let finalProvider: NotificationProviderId = primaryProvider;
      let finalRes: ProviderAttemptResult = primaryRes;

      if (!primaryRes.ok && primaryRes.error) {
        history.push({
          attempt: attempts,
          provider: primaryProvider,
          httpStatus: primaryRes.httpStatus,
          error: primaryRes.error,
          timestampIso: nowIso,
        });

        // Optional owner-enabled fallback ONLY when primary failed and persistent ledger confirms zero delivery
        if (
          this.policy.allowTelegramFallbackOnPrimaryFailure &&
          !this.ledger.hasConfirmedDelivery(
            payload.signalId,
            payload.eventType,
            'TELEGRAM_PUBLIC_CHANNEL'
          )
        ) {
          const fallbackProvider: NotificationProviderId =
            primaryProvider === 'MAKE_WEBHOOK' ? 'TELEGRAM_DIRECT' : 'MAKE_WEBHOOK';
          const fallbackRes =
            fallbackProvider === 'MAKE_WEBHOOK'
              ? await this.sendViaMakeWebhook(payload, nowMs)
              : await this.sendViaTelegramDirect({
                  chatId: payload.targetChatId,
                  text: payload.formattedCard,
                  nowMs,
                });
          attempts += 1;
          finalProvider = fallbackProvider;
          finalRes = fallbackRes;
          if (fallbackProvider === 'MAKE_WEBHOOK') {
            webhookDispatched = fallbackRes.ok;
            webhookHttpStatus = fallbackRes.httpStatus;
            webhookLatencyMs = fallbackRes.latencyMs;
            webhookError = fallbackRes.error;
          } else {
            telegramMirrorDelivered = fallbackRes.ok;
          }
          if (!fallbackRes.ok && fallbackRes.error) {
            history.push({
              attempt: attempts,
              provider: fallbackProvider,
              httpStatus: fallbackRes.httpStatus,
              error: fallbackRes.error,
              timestampIso: nowIso,
            });
          }
        }
      }

      const nextState: NotificationDeliveryState = finalRes.ok
        ? finalRes.verifiableDelivery
          ? 'DELIVERED_WHEN_VERIFIABLE'
          : 'PROVIDER_ACCEPTED'
        : finalRes.retryable && attempts < maxAttempts
        ? 'RETRYING'
        : 'FAILED';

      const backoffMs = finalRes.retryAfterSec
        ? finalRes.retryAfterSec * 1000
        : Math.min(60_000, 2000 * Math.pow(2, Math.max(0, attempts - 1)));

      telegramRecord = this.ledger.upsertDeliveryRecord({
        signalId: payload.signalId,
        eventId: payload.eventId,
        eventType: payload.eventType,
        destination: 'TELEGRAM_PUBLIC_CHANNEL',
        provider: finalProvider,
        state: nextState,
        attemptCount: attempts,
        maxAttempts,
        nextRetryAtMs: nextState === 'RETRYING' ? nowMs + backoffMs : 0,
        providerHttpStatus: finalRes.httpStatus,
        providerMessageId: finalRes.providerMessageId,
        sanitizedError: finalRes.ok ? null : finalRes.error,
        errorHistory: history,
        payload,
        dispatchedAtIso: finalRes.ok ? nowIso : null,
        nowIso,
      });
    }

    // 2. DISCORD DESTINATION — Full structured signal card with ?wait=true
    let discordRecord: NotificationLedgerRecord | null = null;
    const { discord } = this.getConfigs();
    if (this.policy.discordEnabled && discord.configured) {
      const dcKey = buildNotificationIdempotencyKey(
        payload.signalId,
        payload.eventType,
        'DISCORD_SIGNAL_CHANNEL'
      );
      if (this.ledger.hasConfirmedDelivery(payload.signalId, payload.eventType, 'DISCORD_SIGNAL_CHANNEL')) {
        duplicateBlocked = true;
        discordRecord = this.ledger.getRecord(dcKey);
      } else {
        const existingDc = this.ledger.getRecord(dcKey);
        const history: NotificationErrorHistoryItem[] = [...(existingDc?.errorHistory ?? [])];
        const attempts = (existingDc?.attemptCount ?? 0) + 1;
        const dcRes = await this.sendViaDiscordWebhook(payload, nowMs);

        if (!dcRes.ok && dcRes.error) {
          history.push({
            attempt: attempts,
            provider: 'DISCORD_WEBHOOK',
            httpStatus: dcRes.httpStatus,
            error: dcRes.error,
            timestampIso: nowIso,
          });
        }

        const nextState: NotificationDeliveryState = dcRes.ok
          ? dcRes.verifiableDelivery
            ? 'DELIVERED_WHEN_VERIFIABLE'
            : 'PROVIDER_ACCEPTED'
          : dcRes.retryable && attempts < maxAttempts
          ? 'RETRYING'
          : 'FAILED';

        const backoffMs = dcRes.retryAfterSec
          ? dcRes.retryAfterSec * 1000
          : Math.min(60_000, 2000 * Math.pow(2, Math.max(0, attempts - 1)));

        discordRecord = this.ledger.upsertDeliveryRecord({
          signalId: payload.signalId,
          eventId: payload.eventId,
          eventType: payload.eventType,
          destination: 'DISCORD_SIGNAL_CHANNEL',
          provider: 'DISCORD_WEBHOOK',
          state: nextState,
          attemptCount: attempts,
          maxAttempts,
          nextRetryAtMs: nextState === 'RETRYING' ? nowMs + backoffMs : 0,
          providerHttpStatus: dcRes.httpStatus,
          providerMessageId: dcRes.providerMessageId,
          sanitizedError: dcRes.ok ? null : dcRes.error,
          errorHistory: history,
          payload,
          dispatchedAtIso: dcRes.ok ? nowIso : null,
          nowIso,
        });
      }
    }

    const telegramDelivered = telegramRecord?.state === 'DELIVERED_WHEN_VERIFIABLE';
    const telegramAccepted =
      telegramRecord?.state === 'PROVIDER_ACCEPTED' || telegramDelivered;
    const discordDelivered = discordRecord?.state === 'DELIVERED_WHEN_VERIFIABLE';
    const discordAccepted =
      discordRecord?.state === 'PROVIDER_ACCEPTED' || discordDelivered;

    return {
      signalId: payload.signalId,
      eventId: payload.eventId,
      suppressed: false,
      suppressionReason: null,
      duplicateBlocked,
      telegramRecord,
      discordRecord,
      telegramDelivered,
      telegramAccepted,
      discordDelivered,
      discordAccepted,
      webhookDispatched,
      webhookHttpStatus,
      webhookLatencyMs,
      webhookError,
      telegramMirrorDelivered,
    };
  }

  /**
   * Corruption-proof retry worker: reloads complete typed payloads from SQLite ledger,
   * validates all required price fields (never zeroes TP1/TP2/TP3/SL/Entry), enforces
   * idempotency, and retains complete error history.
   */
  public async flushDueRetries(nowMs = Date.now(), limit = 5): Promise<{
    processedCount: number;
    deliveredCount: number;
    failedCount: number;
  }> {
    const due = this.ledger.getDueRetryRecords(nowMs, limit);
    let processedCount = 0;
    let deliveredCount = 0;
    let failedCount = 0;

    for (const rec of due) {
      processedCount += 1;
      const nowIso = new Date(nowMs).toISOString();
      if (this.ledger.hasConfirmedDelivery(rec.signalId, rec.eventType, rec.destination)) {
        continue;
      }

      const validated = validatePersistedSignalPayload(rec.payload);
      if (!validated.ok) {
        failedCount += 1;
        const history: NotificationErrorHistoryItem[] = [
          ...rec.errorHistory,
          {
            attempt: rec.attemptCount + 1,
            provider: rec.provider,
            httpStatus: null,
            error: `Retry aborted: ${validated.error}`,
            timestampIso: nowIso,
          },
        ];
        this.ledger.upsertDeliveryRecord({
          signalId: rec.signalId,
          eventId: rec.eventId,
          eventType: rec.eventType,
          destination: rec.destination,
          provider: rec.provider,
          state: 'FAILED',
          attemptCount: rec.attemptCount + 1,
          maxAttempts: rec.maxAttempts,
          nextRetryAtMs: 0,
          providerHttpStatus: null,
          providerMessageId: rec.providerMessageId,
          sanitizedError: `Retry aborted: ${validated.error}`,
          errorHistory: history,
          payload: rec.payload,
          nowIso,
        });
        continue;
      }

      const res =
        rec.provider === 'MAKE_WEBHOOK'
          ? await this.sendViaMakeWebhook(validated.payload, nowMs)
          : rec.provider === 'DISCORD_WEBHOOK'
          ? await this.sendViaDiscordWebhook(validated.payload, nowMs)
          : await this.sendViaTelegramDirect({
              chatId: validated.payload.targetChatId,
              text: validated.payload.formattedCard,
              nowMs,
            });

      const nextAttempts = rec.attemptCount + 1;
      const history: NotificationErrorHistoryItem[] = [...rec.errorHistory];
      if (!res.ok && res.error) {
        history.push({
          attempt: nextAttempts,
          provider: rec.provider,
          httpStatus: res.httpStatus,
          error: res.error,
          timestampIso: nowIso,
        });
      }

      const nextState: NotificationDeliveryState = res.ok
        ? res.verifiableDelivery
          ? 'DELIVERED_WHEN_VERIFIABLE'
          : 'PROVIDER_ACCEPTED'
        : res.retryable && nextAttempts < rec.maxAttempts
        ? 'RETRYING'
        : 'FAILED';

      if (res.ok) deliveredCount += 1;
      else if (nextState === 'FAILED') failedCount += 1;

      const backoffMs = res.retryAfterSec
        ? res.retryAfterSec * 1000
        : Math.min(60_000, 2000 * Math.pow(2, Math.max(0, nextAttempts - 1)));

      this.ledger.upsertDeliveryRecord({
        signalId: rec.signalId,
        eventId: rec.eventId,
        eventType: rec.eventType,
        destination: rec.destination,
        provider: rec.provider,
        state: nextState,
        attemptCount: nextAttempts,
        maxAttempts: rec.maxAttempts,
        nextRetryAtMs: nextState === 'RETRYING' ? nowMs + backoffMs : 0,
        providerHttpStatus: res.httpStatus,
        providerMessageId: res.providerMessageId,
        sanitizedError: res.ok ? null : res.error,
        errorHistory: history,
        payload: validated.payload,
        dispatchedAtIso: res.ok ? nowIso : null,
        nowIso,
      });
    }

    return { processedCount, deliveredCount, failedCount };
  }

  public getHealthOverview(): NotificationHealthOverview {
    const { telegram, make, discord } = this.getConfigs();
    const persistedTg = this.ledger.getProviderHealth('TELEGRAM_DIRECT');
    const persistedMake = this.ledger.getProviderHealth('MAKE_WEBHOOK');
    const persistedDiscord = this.ledger.getProviderHealth('DISCORD_WEBHOOK');

    const resolveState = (
      configured: boolean,
      configValid: boolean,
      persisted: PersistedProviderHealthRow | null,
      hasBlockingConfigError: boolean
    ): ProviderConnectionHealthState => {
      if (!configured) return 'UNCONFIGURED';
      if (persisted?.state === 'AUTH_FAILED') return 'AUTH_FAILED';
      if (!configValid || hasBlockingConfigError) return 'BLOCKED';
      if (persisted?.state) return persisted.state;
      return 'CONFIGURED_NOT_VERIFIED';
    };

    const tgHasBlockingError = !telegram.botTokenValid || !telegram.publicChatIdValid;
    const tgState = resolveState(
      Boolean(telegram.botTokenSource || telegram.publicChatIdSource),
      telegram.botTokenValid && telegram.publicChatIdValid,
      persistedTg,
      tgHasBlockingError
    );

    const makeState = resolveState(make.configured, make.valid, persistedMake, !make.valid);
    const discordState = resolveState(
      discord.configured,
      discord.valid,
      persistedDiscord,
      !discord.valid
    );

    const advisories = [
      ...telegram.issues.map((i) => `[Telegram · ${i.envVar}] ${i.message}`),
      ...make.issues.map((i) => `[Make.com · ${i.envVar}] ${i.message}`),
      ...discord.issues.map((i) => `[Discord · ${i.envVar}] ${i.message}`),
    ];

    return {
      policy: this.policy,
      counters: this.ledger.getCounters(),
      telegram: {
        provider: 'TELEGRAM_DIRECT',
        label: 'Telegram Bot API',
        state: tgState,
        configured: Boolean(telegram.botTokenSource),
        configValid: telegram.botTokenValid && telegram.publicChatIdValid,
        maskedTarget: telegram.publicChannelHandle || (telegram.publicChatId ? 'Configured Channel ID' : 'Not configured'),
        lastVerifiedAtIso: persistedTg?.lastVerifiedAtIso ?? null,
        lastSuccessAtIso: persistedTg?.lastSuccessAtIso ?? null,
        lastSuccessDetail: persistedTg?.lastSuccessDetail ?? null,
        lastFailureAtIso: persistedTg?.lastFailureAtIso ?? null,
        lastFailureHttpStatus: persistedTg?.lastFailureHttpStatus ?? null,
        lastFailureDetail: persistedTg?.lastFailureDetail ?? null,
        botUsername: persistedTg?.botUsername ?? this.cachedTelegramGetMe?.botUsername ?? null,
        canonicalChannelStatus:
          telegram.publicChatIdSource === 'TELEGRAM_CHAT_ID'
            ? 'CONFIGURED'
            : 'PENDING_OWNER_CONFIGURATION',
        issues: telegram.issues,
      },
      makeWebhook: {
        provider: 'MAKE_WEBHOOK',
        label: 'Make.com Webhook Relay',
        state: makeState,
        configured: make.configured,
        configValid: make.valid,
        maskedTarget: make.maskedUrl,
        lastVerifiedAtIso: persistedMake?.lastVerifiedAtIso ?? null,
        lastSuccessAtIso: persistedMake?.lastSuccessAtIso ?? null,
        lastSuccessDetail: persistedMake?.lastSuccessDetail ?? null,
        lastFailureAtIso: persistedMake?.lastFailureAtIso ?? null,
        lastFailureHttpStatus: persistedMake?.lastFailureHttpStatus ?? null,
        lastFailureDetail: persistedMake?.lastFailureDetail ?? null,
        issues: make.issues,
      },
      discord: {
        provider: 'DISCORD_WEBHOOK',
        label: 'Discord Signal Webhook',
        state: discordState,
        configured: discord.configured,
        configValid: discord.valid,
        maskedTarget: discord.maskedUrl,
        lastVerifiedAtIso: persistedDiscord?.lastVerifiedAtIso ?? null,
        lastSuccessAtIso: persistedDiscord?.lastSuccessAtIso ?? null,
        lastSuccessDetail: persistedDiscord?.lastSuccessDetail ?? null,
        lastFailureAtIso: persistedDiscord?.lastFailureAtIso ?? null,
        lastFailureHttpStatus: persistedDiscord?.lastFailureHttpStatus ?? null,
        lastFailureDetail: persistedDiscord?.lastFailureDetail ?? null,
        issues: discord.issues,
      },
      configSummary: {
        telegramBotTokenSource: telegram.botTokenSource,
        telegramPublicChatIdSource: telegram.publicChatIdSource,
        telegramDevChatIdSource: telegram.devChatIdSource,
        telegramWebhookSecretValid: telegram.webhookSecretValid,
        legacyShadowConflict: telegram.legacyShadowConflict,
        makeHost: make.host,
        discordBotTokenConfiguredUnused: discord.botTokenConfiguredUnused,
        discordChannelIdConfiguredUnused: discord.channelIdConfiguredUnused,
      },
      advisories,
    };
  }
}

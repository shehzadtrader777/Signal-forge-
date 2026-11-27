/**
 * Signal Forge — Safe Version Update & Live Trading Protection Protocol
 *
 * Pure, deterministic state machine and execution gate enforcing:
 *  - Restart-persistent maintenance state with integrity checksum (fail-closed on corruption)
 *  - Blocking ALL new live entry orders (manual, autonomous, voice, copy, arbitrage, AI, mode switch)
 *  - Preserving existing open positions & protective SL/TP orders (never auto-closing or cancelling protection)
 *  - Allowing verified risk-reducing exits and protective updates during maintenance
 *  - Post-update 10-item safety verification checklist before explicit operator resume
 *  - Timer expiry transitions MAINTENANCE -> VERIFYING and NEVER auto-enables live entries
 *  - Failed deployment rollback keeping new live entries blocked while keeping protections active
 */

export type MaintenanceLifecycleState =
  | 'NORMAL'
  | 'PREPARING'
  | 'MAINTENANCE'
  | 'VERIFYING'
  | 'AWAITING_APPROVAL';

export type PublicMaintenanceAccessMode = 'READ_ONLY' | 'MAINTENANCE_PAGE';

export type SafetyCheckId =
  | 'app_backend_health'
  | 'database_connectivity'
  | 'exchange_auth'
  | 'open_positions_reconciled'
  | 'pending_orders_reconciled'
  | 'protective_orders_verified'
  | 'risk_engine_healthy'
  | 'emergency_stop_verified'
  | 'worker_sync'
  | 'automated_tests_passed';

export type SafetyCheckStatus = 'PENDING' | 'PASS' | 'FAIL';

export interface SafetyVerificationItem {
  id: SafetyCheckId;
  label: string;
  category: 'INFRASTRUCTURE' | 'EXCHANGE' | 'RISK' | 'TESTING';
  status: SafetyCheckStatus;
  detail: string;
  checkedAtIso: string | null;
}

export interface TrackedOrderRecord {
  clientOrderId: string;
  exchangeOrderId: string | null;
  pair: string;
  side: 'BUY' | 'SELL';
  status: 'PENDING' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED';
  requestedQty: number;
  filledQty: number;
  isProtective: boolean;
  updatedAtIso: string;
}

export interface ProtectedPositionSnapshot {
  positionId: string;
  pair: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  stopLossOrderId: string | null;
  takeProfitOrderId: string | null;
  protectionVerified: boolean;
}

export interface MaintenanceHistoryEvent {
  id: string;
  timestampIso: string;
  action:
    | 'MAINTENANCE_STARTED'
    | 'MAINTENANCE_SCHEDULED'
    | 'MAINTENANCE_EXTENDED'
    | 'MAINTENANCE_ENDED_TO_VERIFY'
    | 'SAFETY_CHECKLIST_UPDATED'
    | 'CONTROLLED_RESUME_APPROVED'
    | 'DEPLOYMENT_ROLLBACK'
    | 'TIMER_EXPIRED_TO_VERIFY'
    | 'INTEGRITY_FAIL_CLOSED';
  fromState: MaintenanceLifecycleState;
  toState: MaintenanceLifecycleState;
  actor: string;
  version: string;
  detail: string;
}

export interface MaintenanceNotificationRecord {
  dedupeKey: string;
  eventType: string;
  message: string;
  sentAtIso: string;
}

export interface SafeMaintenanceState {
  schemaVersion: 1;
  state: MaintenanceLifecycleState;
  publicAccessMode: PublicMaintenanceAccessMode;
  currentVersion: string;
  targetVersion: string;
  previousStableVersion: string;
  reason: string;
  bannerMessage: string;
  startedAtIso: string | null;
  scheduledStartAtIso: string | null;
  estimatedEndAtIso: string | null;
  durationMinutes: number;
  updatedAtIso: string;
  updatedBy: string;
  integrityCorrupted: boolean;
  rollbackActive: boolean;
  rollbackReason: string | null;
  safetyChecklist: SafetyVerificationItem[];
  trackedOrders: TrackedOrderRecord[];
  protectedPositions: ProtectedPositionSnapshot[];
  processedClientOrderIds: string[];
  notifications: MaintenanceNotificationRecord[];
  history: MaintenanceHistoryEvent[];
}

export interface PersistedMaintenanceEnvelope {
  payload: SafeMaintenanceState;
  checksum: string;
}

export type OrderGateIntentKind =
  | 'NEW_ENTRY'
  | 'SWITCH_TO_LIVE'
  | 'SELF_HEALING_BYPASS'
  | 'RISK_REDUCING_EXIT'
  | 'PROTECTIVE_ORDER_UPDATE'
  | 'AUTO_CLOSE_FOR_MAINTENANCE'
  | 'CANCEL_PROTECTIVE_ORDER';

export type OrderGateSource =
  | 'MANUAL'
  | 'AUTONOMOUS'
  | 'VOICE'
  | 'COPY_TRADING'
  | 'ARBITRAGE'
  | 'AI_SIGNAL'
  | 'SELF_HEALING'
  | 'RISK_ENGINE';

export interface OrderGateIntent {
  kind: OrderGateIntentKind;
  source: OrderGateSource;
  clientOrderId?: string;
  symbol?: string;
  isLiveMode?: boolean;
}

export interface OrderGateDecision {
  allowed: boolean;
  httpStatus: 200 | 409 | 423;
  code:
    | 'ALLOWED_NORMAL'
    | 'ALLOWED_RISK_REDUCING_PROTECTION'
    | 'BLOCKED_MAINTENANCE_ACTIVE'
    | 'BLOCKED_FAIL_CLOSED_INTEGRITY'
    | 'BLOCKED_ROLLBACK_ACTIVE'
    | 'BLOCKED_DUPLICATE_CLIENT_ORDER_ID'
    | 'BLOCKED_SELF_HEALING_BYPASS'
    | 'BLOCKED_PROTECTIVE_PRESERVATION_INVARIANT';
  reason: string;
  maintenanceState: MaintenanceLifecycleState;
}

export interface PublicMaintenanceSummary {
  state: MaintenanceLifecycleState;
  isMaintenanceActive: boolean;
  newLiveEntriesBlocked: boolean;
  publicAccessMode: PublicMaintenanceAccessMode;
  showMaintenancePage: boolean;
  bannerMessage: string;
  currentVersion: string;
  targetVersion: string;
  estimatedEndAtIso: string | null;
  scheduledStartAtIso: string | null;
  remainingSeconds: number | null;
  serviceHealth: 'OPERATIONAL' | 'UPDATING' | 'VERIFYING' | 'DEGRADED_SAFE_LOCK';
  existingPositionsProtected: boolean;
  updatedAtIso: string;
}

export const MAINTENANCE_DURATION_PRESETS_MINUTES = [60, 120, 180] as const;
export const MIN_CUSTOM_MAINTENANCE_MINUTES = 5;
export const MAX_CUSTOM_MAINTENANCE_MINUTES = 1440;
export const DEFAULT_MAINTENANCE_BANNER =
  'Signal Forge System Update in Progress — New Live Trading Entries Temporarily Paused.';

const VALID_STATES: ReadonlySet<MaintenanceLifecycleState> = new Set([
  'NORMAL',
  'PREPARING',
  'MAINTENANCE',
  'VERIFYING',
  'AWAITING_APPROVAL',
]);

const VALID_PUBLIC_MODES: ReadonlySet<PublicMaintenanceAccessMode> = new Set([
  'READ_ONLY',
  'MAINTENANCE_PAGE',
]);

export const MANDATORY_SAFETY_CHECKS: readonly Omit<
  SafetyVerificationItem,
  'status' | 'detail' | 'checkedAtIso'
>[] = [
  { id: 'app_backend_health', label: 'Application & Backend Health', category: 'INFRASTRUCTURE' },
  { id: 'database_connectivity', label: 'Database Connectivity', category: 'INFRASTRUCTURE' },
  { id: 'exchange_auth', label: 'Exchange Authentication', category: 'EXCHANGE' },
  { id: 'open_positions_reconciled', label: 'Actual Open Positions Reconciled', category: 'EXCHANGE' },
  { id: 'pending_orders_reconciled', label: 'Pending Exchange Orders Reconciled', category: 'EXCHANGE' },
  { id: 'protective_orders_verified', label: 'Protective SL/TP Orders Verified', category: 'EXCHANGE' },
  { id: 'risk_engine_healthy', label: 'Risk Engine Invariants Healthy', category: 'RISK' },
  { id: 'emergency_stop_verified', label: 'Emergency Stop Operational', category: 'RISK' },
  { id: 'worker_sync', label: 'Worker & Queue Synchronization', category: 'INFRASTRUCTURE' },
  { id: 'automated_tests_passed', label: 'Relevant Automated Tests Passed', category: 'TESTING' },
];

export function createDefaultSafetyChecklist(): SafetyVerificationItem[] {
  return MANDATORY_SAFETY_CHECKS.map((item) => ({
    ...item,
    status: 'PENDING',
    detail: 'Awaiting post-update verification',
    checkedAtIso: null,
  }));
}

export function createInitialMaintenanceState(
  currentVersion = '1.4.0-step1',
  nowMs = Date.now()
): SafeMaintenanceState {
  const nowIso = new Date(nowMs).toISOString();
  return {
    schemaVersion: 1,
    state: 'NORMAL',
    publicAccessMode: 'READ_ONLY',
    currentVersion,
    targetVersion: currentVersion,
    previousStableVersion: currentVersion,
    reason: 'System operating normally.',
    bannerMessage: DEFAULT_MAINTENANCE_BANNER,
    startedAtIso: null,
    scheduledStartAtIso: null,
    estimatedEndAtIso: null,
    durationMinutes: 60,
    updatedAtIso: nowIso,
    updatedBy: 'SYSTEM_BOOT',
    integrityCorrupted: false,
    rollbackActive: false,
    rollbackReason: null,
    safetyChecklist: createDefaultSafetyChecklist(),
    trackedOrders: [],
    protectedPositions: [],
    processedClientOrderIds: [],
    notifications: [],
    history: [],
  };
}

export function clampMaintenanceDurationMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return 60;
  return Math.max(
    MIN_CUSTOM_MAINTENANCE_MINUTES,
    Math.min(MAX_CUSTOM_MAINTENANCE_MINUTES, Math.round(minutes))
  );
}

/**
 * Deterministic 64-bit-equivalent hex digest (FNV-1a double-lane) for tamper/corruption detection.
 */
export function computeMaintenanceChecksum(state: SafeMaintenanceState): string {
  const canonical = JSON.stringify(state);
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b1;
  for (let i = 0; i < canonical.length; i++) {
    const c = canonical.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c ^ (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export function serializeMaintenanceState(state: SafeMaintenanceState): string {
  const envelope: PersistedMaintenanceEnvelope = {
    payload: state,
    checksum: computeMaintenanceChecksum(state),
  };
  return JSON.stringify(envelope, null, 2);
}

export function createFailClosedMaintenanceState(
  fallbackVersion = '1.4.0-step1',
  reason = 'Maintenance state file missing, corrupted, or failed checksum verification — failed closed to protect live capital.',
  nowMs = Date.now()
): SafeMaintenanceState {
  const base = createInitialMaintenanceState(fallbackVersion, nowMs);
  const nowIso = new Date(nowMs).toISOString();
  return {
    ...base,
    state: 'MAINTENANCE',
    publicAccessMode: 'READ_ONLY',
    reason,
    integrityCorrupted: true,
    updatedAtIso: nowIso,
    updatedBy: 'FAIL_CLOSED_GUARD',
    history: [
      {
        id: `evt-failclosed-${nowMs}`,
        timestampIso: nowIso,
        action: 'INTEGRITY_FAIL_CLOSED',
        fromState: 'MAINTENANCE',
        toState: 'MAINTENANCE',
        actor: 'FAIL_CLOSED_GUARD',
        version: fallbackVersion,
        detail: reason,
      },
    ],
  };
}

export function parseMaintenanceStateFailClosed(
  rawJson: string | null | undefined,
  fallbackVersion = '1.4.0-step1',
  nowMs = Date.now()
): SafeMaintenanceState {
  if (!rawJson || typeof rawJson !== 'string' || rawJson.trim().length === 0) {
    return createFailClosedMaintenanceState(
      fallbackVersion,
      'Maintenance state payload is empty — failed closed.',
      nowMs
    );
  }
  try {
    const parsed = JSON.parse(rawJson) as Partial<PersistedMaintenanceEnvelope>;
    if (!parsed || typeof parsed !== 'object' || !parsed.payload || typeof parsed.checksum !== 'string') {
      return createFailClosedMaintenanceState(
        fallbackVersion,
        'Maintenance state envelope missing payload or checksum — failed closed.',
        nowMs
      );
    }
    const payload = parsed.payload as SafeMaintenanceState;
    if (
      payload.schemaVersion !== 1 ||
      !VALID_STATES.has(payload.state) ||
      !VALID_PUBLIC_MODES.has(payload.publicAccessMode) ||
      !Array.isArray(payload.safetyChecklist) ||
      payload.safetyChecklist.length !== MANDATORY_SAFETY_CHECKS.length
    ) {
      return createFailClosedMaintenanceState(
        fallbackVersion,
        'Maintenance state schema invalid — failed closed.',
        nowMs
      );
    }
    const expectedChecksum = computeMaintenanceChecksum(payload);
    if (expectedChecksum !== parsed.checksum) {
      return createFailClosedMaintenanceState(
        fallbackVersion,
        'Maintenance state checksum mismatch — failed closed to prevent unsafe live entry.',
        nowMs
      );
    }
    return payload;
  } catch {
    return createFailClosedMaintenanceState(
      fallbackVersion,
      'Maintenance state JSON corrupted — failed closed.',
      nowMs
    );
  }
}

function appendDeduplicatedNotification(
  existing: readonly MaintenanceNotificationRecord[],
  dedupeKey: string,
  eventType: string,
  message: string,
  nowIso: string
): MaintenanceNotificationRecord[] {
  if (existing.some((n) => n.dedupeKey === dedupeKey)) {
    return [...existing];
  }
  return [
    { dedupeKey, eventType, message, sentAtIso: nowIso },
    ...existing,
  ].slice(0, 40);
}

function appendHistory(
  existing: readonly MaintenanceHistoryEvent[],
  event: MaintenanceHistoryEvent
): MaintenanceHistoryEvent[] {
  return [event, ...existing].slice(0, 50);
}

export interface StartMaintenanceInput {
  durationMinutes: number;
  publicAccessMode: PublicMaintenanceAccessMode;
  targetVersion?: string;
  reason?: string;
  actor: string;
}

export function startMaintenance(
  current: SafeMaintenanceState,
  input: StartMaintenanceInput,
  nowMs = Date.now()
): SafeMaintenanceState {
  const durationMinutes = clampMaintenanceDurationMinutes(input.durationMinutes);
  const nowIso = new Date(nowMs).toISOString();
  const estimatedEndAtIso = new Date(nowMs + durationMinutes * 60_000).toISOString();
  const targetVersion = input.targetVersion?.trim() || current.targetVersion || current.currentVersion;
  const reason = input.reason?.trim() || 'Scheduled safe version update and verification.';
  const publicAccessMode: PublicMaintenanceAccessMode = VALID_PUBLIC_MODES.has(input.publicAccessMode)
    ? input.publicAccessMode
    : 'READ_ONLY';
  const dedupeKey = `START:${targetVersion}:${publicAccessMode}:${Math.floor(nowMs / 60_000)}`;

  return {
    ...current,
    state: 'MAINTENANCE',
    publicAccessMode,
    targetVersion,
    previousStableVersion: current.currentVersion,
    reason,
    bannerMessage: DEFAULT_MAINTENANCE_BANNER,
    startedAtIso: nowIso,
    scheduledStartAtIso: null,
    estimatedEndAtIso,
    durationMinutes,
    updatedAtIso: nowIso,
    updatedBy: input.actor,
    integrityCorrupted: false,
    rollbackActive: false,
    rollbackReason: null,
    safetyChecklist: createDefaultSafetyChecklist(),
    notifications: appendDeduplicatedNotification(
      current.notifications,
      dedupeKey,
      'MAINTENANCE_STARTED',
      `${DEFAULT_MAINTENANCE_BANNER} Target ${targetVersion} (${durationMinutes}m, ${publicAccessMode}).`,
      nowIso
    ),
    history: appendHistory(current.history, {
      id: `evt-start-${nowMs}`,
      timestampIso: nowIso,
      action: 'MAINTENANCE_STARTED',
      fromState: current.state,
      toState: 'MAINTENANCE',
      actor: input.actor,
      version: targetVersion,
      detail: `Started maintenance (${durationMinutes}m, mode: ${publicAccessMode}). ${reason}`,
    }),
  };
}

export interface ScheduleMaintenanceInput {
  startDelayMinutes: number;
  durationMinutes: number;
  publicAccessMode: PublicMaintenanceAccessMode;
  targetVersion?: string;
  reason?: string;
  actor: string;
}

export function scheduleMaintenance(
  current: SafeMaintenanceState,
  input: ScheduleMaintenanceInput,
  nowMs = Date.now()
): SafeMaintenanceState {
  const startDelayMinutes = Math.max(1, Math.min(1440, Math.round(input.startDelayMinutes || 15)));
  const durationMinutes = clampMaintenanceDurationMinutes(input.durationMinutes);
  const nowIso = new Date(nowMs).toISOString();
  const scheduledStartMs = nowMs + startDelayMinutes * 60_000;
  const scheduledStartAtIso = new Date(scheduledStartMs).toISOString();
  const estimatedEndAtIso = new Date(scheduledStartMs + durationMinutes * 60_000).toISOString();
  const targetVersion = input.targetVersion?.trim() || current.targetVersion || current.currentVersion;
  const reason = input.reason?.trim() || 'Scheduled platform maintenance window.';
  const publicAccessMode: PublicMaintenanceAccessMode = VALID_PUBLIC_MODES.has(input.publicAccessMode)
    ? input.publicAccessMode
    : 'READ_ONLY';
  const dedupeKey = `SCHEDULE:${targetVersion}:${scheduledStartAtIso.slice(0, 16)}`;

  return {
    ...current,
    state: 'PREPARING',
    publicAccessMode,
    targetVersion,
    previousStableVersion: current.currentVersion,
    reason,
    bannerMessage: DEFAULT_MAINTENANCE_BANNER,
    scheduledStartAtIso,
    estimatedEndAtIso,
    durationMinutes,
    updatedAtIso: nowIso,
    updatedBy: input.actor,
    integrityCorrupted: false,
    safetyChecklist: createDefaultSafetyChecklist(),
    notifications: appendDeduplicatedNotification(
      current.notifications,
      dedupeKey,
      'MAINTENANCE_SCHEDULED',
      `Maintenance scheduled for ${scheduledStartAtIso} (${durationMinutes}m). New live entries paused during preparation.`,
      nowIso
    ),
    history: appendHistory(current.history, {
      id: `evt-schedule-${nowMs}`,
      timestampIso: nowIso,
      action: 'MAINTENANCE_SCHEDULED',
      fromState: current.state,
      toState: 'PREPARING',
      actor: input.actor,
      version: targetVersion,
      detail: `Scheduled maintenance in ${startDelayMinutes}m for ${durationMinutes}m (${publicAccessMode}). ${reason}`,
    }),
  };
}

export function extendMaintenance(
  current: SafeMaintenanceState,
  additionalMinutes: number,
  actor: string,
  reason = 'Extended maintenance window for additional verification.',
  nowMs = Date.now()
): SafeMaintenanceState {
  const addMin = clampMaintenanceDurationMinutes(additionalMinutes);
  const nowIso = new Date(nowMs).toISOString();
  const baseEndMs = current.estimatedEndAtIso
    ? Math.max(nowMs, new Date(current.estimatedEndAtIso).getTime())
    : nowMs;
  const newEndIso = new Date(baseEndMs + addMin * 60_000).toISOString();
  const nextState: MaintenanceLifecycleState =
    current.state === 'NORMAL' ? 'MAINTENANCE' : current.state;
  const dedupeKey = `EXTEND:${newEndIso.slice(0, 16)}`;

  return {
    ...current,
    state: nextState,
    estimatedEndAtIso: newEndIso,
    durationMinutes: current.durationMinutes + addMin,
    reason: reason.trim() || current.reason,
    updatedAtIso: nowIso,
    updatedBy: actor,
    notifications: appendDeduplicatedNotification(
      current.notifications,
      dedupeKey,
      'MAINTENANCE_EXTENDED',
      `Maintenance window extended by ${addMin} minutes. New estimated completion: ${newEndIso}.`,
      nowIso
    ),
    history: appendHistory(current.history, {
      id: `evt-extend-${nowMs}`,
      timestampIso: nowIso,
      action: 'MAINTENANCE_EXTENDED',
      fromState: current.state,
      toState: nextState,
      actor,
      version: current.targetVersion,
      detail: `Extended maintenance by +${addMin}m to ${newEndIso}. ${reason}`,
    }),
  };
}

/**
 * Ending maintenance NEVER directly re-enables live entries.
 * It transitions strictly to VERIFYING so all 10 post-update safety checks must pass first.
 */
export function endMaintenanceToVerifying(
  current: SafeMaintenanceState,
  actor: string,
  reason = 'Deployment work complete — initiating mandatory post-update safety verification.',
  nowMs = Date.now()
): SafeMaintenanceState {
  const nowIso = new Date(nowMs).toISOString();
  return {
    ...current,
    state: 'VERIFYING',
    reason: reason.trim() || current.reason,
    updatedAtIso: nowIso,
    updatedBy: actor,
    history: appendHistory(current.history, {
      id: `evt-end-verify-${nowMs}`,
      timestampIso: nowIso,
      action: 'MAINTENANCE_ENDED_TO_VERIFY',
      fromState: current.state,
      toState: 'VERIFYING',
      actor,
      version: current.targetVersion,
      detail: reason,
    }),
  };
}

/**
 * Evaluates scheduled start and maintenance expiry timers.
 * CRITICAL INVARIANT: Timer expiry NEVER transitions to NORMAL or re-enables live trading.
 * When maintenance time expires, it transitions strictly to VERIFYING.
 */
export function evaluateMaintenanceTimer(
  current: SafeMaintenanceState,
  nowMs = Date.now()
): { state: SafeMaintenanceState; changed: boolean } {
  if (
    current.state === 'PREPARING' &&
    current.scheduledStartAtIso &&
    nowMs >= new Date(current.scheduledStartAtIso).getTime()
  ) {
    const nowIso = new Date(nowMs).toISOString();
    return {
      changed: true,
      state: {
        ...current,
        state: 'MAINTENANCE',
        startedAtIso: nowIso,
        updatedAtIso: nowIso,
        updatedBy: 'MAINTENANCE_SCHEDULER',
        history: appendHistory(current.history, {
          id: `evt-sched-start-${nowMs}`,
          timestampIso: nowIso,
          action: 'MAINTENANCE_STARTED',
          fromState: 'PREPARING',
          toState: 'MAINTENANCE',
          actor: 'MAINTENANCE_SCHEDULER',
          version: current.targetVersion,
          detail: 'Scheduled maintenance start time reached — entered MAINTENANCE.',
        }),
      },
    };
  }

  if (
    current.state === 'MAINTENANCE' &&
    current.estimatedEndAtIso &&
    nowMs >= new Date(current.estimatedEndAtIso).getTime()
  ) {
    const nowIso = new Date(nowMs).toISOString();
    return {
      changed: true,
      state: {
        ...current,
        state: 'VERIFYING',
        updatedAtIso: nowIso,
        updatedBy: 'MAINTENANCE_TIMER',
        history: appendHistory(current.history, {
          id: `evt-timer-verify-${nowMs}`,
          timestampIso: nowIso,
          action: 'TIMER_EXPIRED_TO_VERIFY',
          fromState: 'MAINTENANCE',
          toState: 'VERIFYING',
          actor: 'MAINTENANCE_TIMER',
          version: current.targetVersion,
          detail:
            'Maintenance timer elapsed — transitioned to VERIFYING. New live entries remain blocked until all 10 safety checks pass and an authorized operator approves resume.',
        }),
      },
    };
  }

  return { state: current, changed: false };
}

export function recordSafetyVerificationResults(
  current: SafeMaintenanceState,
  updates: Partial<Record<SafetyCheckId, { status: SafetyCheckStatus; detail: string }>>,
  actor: string,
  nowMs = Date.now()
): SafeMaintenanceState {
  const nowIso = new Date(nowMs).toISOString();
  const nextChecklist = current.safetyChecklist.map((item) => {
    const patch = updates[item.id];
    if (!patch) return item;
    return {
      ...item,
      status: patch.status,
      detail: patch.detail,
      checkedAtIso: nowIso,
    };
  });

  const allPassed = nextChecklist.every((item) => item.status === 'PASS');
  const nextState: MaintenanceLifecycleState =
    current.state === 'NORMAL'
      ? 'NORMAL'
      : allPassed
      ? 'AWAITING_APPROVAL'
      : 'VERIFYING';

  return {
    ...current,
    state: nextState,
    integrityCorrupted: allPassed ? false : current.integrityCorrupted,
    safetyChecklist: nextChecklist,
    updatedAtIso: nowIso,
    updatedBy: actor,
    history: appendHistory(current.history, {
      id: `evt-verify-${nowMs}`,
      timestampIso: nowIso,
      action: 'SAFETY_CHECKLIST_UPDATED',
      fromState: current.state,
      toState: nextState,
      actor,
      version: current.targetVersion,
      detail: allPassed
        ? 'All 10 mandatory safety verification checks passed — awaiting explicit operator resume approval.'
        : `Safety verification updated (${nextChecklist.filter((i) => i.status === 'PASS').length}/${nextChecklist.length} passed).`,
    }),
  };
}

export interface ControlledResumeResult {
  ok: boolean;
  error?: string;
  state: SafeMaintenanceState;
}

export function approveControlledResume(
  current: SafeMaintenanceState,
  params: {
    actor: string;
    explicitApproval: boolean;
    clearRollbackFlag?: boolean;
    note?: string;
  },
  nowMs = Date.now()
): ControlledResumeResult {
  if (!params.explicitApproval || !params.actor.trim()) {
    return {
      ok: false,
      error: 'Explicit authorized operator approval is required before resuming live trading.',
      state: current,
    };
  }
  if (current.integrityCorrupted) {
    return {
      ok: false,
      error: 'Maintenance state failed integrity check — run full safety verification before resume.',
      state: current,
    };
  }
  if (current.rollbackActive && !params.clearRollbackFlag) {
    return {
      ok: false,
      error: 'Deployment rollback is active — confirm rollback verification before resuming.',
      state: current,
    };
  }
  const failedOrPending = current.safetyChecklist.filter((item) => item.status !== 'PASS');
  if (failedOrPending.length > 0) {
    return {
      ok: false,
      error: `Cannot resume live entries: ${failedOrPending.length} safety check(s) not passed (${failedOrPending
        .map((c) => c.label)
        .join(', ')}).`,
      state: current,
    };
  }
  if (current.state !== 'AWAITING_APPROVAL') {
    return {
      ok: false,
      error: `Cannot approve controlled resume from state ${current.state}. Complete verification first.`,
      state: current,
    };
  }

  const nowIso = new Date(nowMs).toISOString();
  const activeVersion = current.rollbackActive
    ? current.previousStableVersion
    : current.targetVersion;

  const nextState: SafeMaintenanceState = {
    ...current,
    state: 'NORMAL',
    publicAccessMode: 'READ_ONLY',
    currentVersion: activeVersion,
    targetVersion: activeVersion,
    reason: params.note?.trim() || 'Post-update safety verification passed and operator approved resume.',
    startedAtIso: null,
    scheduledStartAtIso: null,
    estimatedEndAtIso: null,
    rollbackActive: false,
    rollbackReason: null,
    updatedAtIso: nowIso,
    updatedBy: params.actor,
    notifications: appendDeduplicatedNotification(
      current.notifications,
      `RESUME:${activeVersion}:${Math.floor(nowMs / 60_000)}`,
      'CONTROLLED_RESUME_APPROVED',
      `Signal Forge v${activeVersion} verified and resumed by ${params.actor}.`,
      nowIso
    ),
    history: appendHistory(current.history, {
      id: `evt-resume-${nowMs}`,
      timestampIso: nowIso,
      action: 'CONTROLLED_RESUME_APPROVED',
      fromState: current.state,
      toState: 'NORMAL',
      actor: params.actor,
      version: activeVersion,
      detail: params.note?.trim() || 'All 10 safety checks passed; controlled resume approved.',
    }),
  };

  return { ok: true, state: nextState };
}

/**
 * Failed deployment / rollback procedure:
 * Keeps ALL new live entries blocked, preserves existing positions & protective SL/TP orders,
 * resets safety verification checklist so full re-verification is required before resume.
 */
export function triggerDeploymentRollback(
  current: SafeMaintenanceState,
  params: { actor: string; reason: string; rollbackToVersion?: string },
  nowMs = Date.now()
): SafeMaintenanceState {
  const nowIso = new Date(nowMs).toISOString();
  const rollbackVersion = params.rollbackToVersion?.trim() || current.previousStableVersion;
  const reason = params.reason.trim() || 'Deployment anomaly detected — rolled back safely.';

  return {
    ...current,
    state: 'MAINTENANCE',
    targetVersion: rollbackVersion,
    rollbackActive: true,
    rollbackReason: reason,
    reason: `Rollback to ${rollbackVersion}: ${reason}`,
    updatedAtIso: nowIso,
    updatedBy: params.actor,
    safetyChecklist: createDefaultSafetyChecklist(),
    notifications: appendDeduplicatedNotification(
      current.notifications,
      `ROLLBACK:${rollbackVersion}:${Math.floor(nowMs / 60_000)}`,
      'DEPLOYMENT_ROLLBACK',
      `Deployment rolled back to ${rollbackVersion}. New live entries remain paused; existing position protections remain active.`,
      nowIso
    ),
    history: appendHistory(current.history, {
      id: `evt-rollback-${nowMs}`,
      timestampIso: nowIso,
      action: 'DEPLOYMENT_ROLLBACK',
      fromState: current.state,
      toState: 'MAINTENANCE',
      actor: params.actor,
      version: rollbackVersion,
      detail: `${reason} (Positions preserved: ${current.protectedPositions.length}; protective orders untouched).`,
    }),
  };
}

export function reconcilePendingOrdersAndProtections(
  current: SafeMaintenanceState,
  snapshot: {
    trackedOrders?: TrackedOrderRecord[];
    protectedPositions?: ProtectedPositionSnapshot[];
  },
  nowMs = Date.now()
): SafeMaintenanceState {
  const nowIso = new Date(nowMs).toISOString();
  const nextOrders = snapshot.trackedOrders ?? current.trackedOrders;
  const nextPositions = snapshot.protectedPositions ?? current.protectedPositions;
  const seenIds = new Set(current.processedClientOrderIds);
  for (const order of nextOrders) {
    seenIds.add(order.clientOrderId);
  }
  return {
    ...current,
    trackedOrders: nextOrders,
    protectedPositions: nextPositions,
    processedClientOrderIds: Array.from(seenIds).slice(-200),
    updatedAtIso: nowIso,
  };
}

/**
 * Authoritative Backend Gate for ALL execution routes, autonomous ticks, voice orders,
 * copy-trading, arbitrage, mode switches, and self-healing agents.
 */
export function evaluateMaintenanceOrderGate(
  state: SafeMaintenanceState | null | undefined,
  intent: OrderGateIntent
): OrderGateDecision {
  // 1. Fail-closed if state is missing or corrupted
  if (!state || state.integrityCorrupted || !VALID_STATES.has(state.state)) {
    if (
      intent.kind === 'RISK_REDUCING_EXIT' ||
      intent.kind === 'PROTECTIVE_ORDER_UPDATE'
    ) {
      return {
        allowed: true,
        httpStatus: 200,
        code: 'ALLOWED_RISK_REDUCING_PROTECTION',
        reason: 'Risk-reducing exit / protective order update permitted even during fail-closed lock.',
        maintenanceState: state?.state ?? 'MAINTENANCE',
      };
    }
    return {
      allowed: false,
      httpStatus: 423,
      code: 'BLOCKED_FAIL_CLOSED_INTEGRITY',
      reason: 'Maintenance state unavailable or failed integrity verification — new entries blocked (fail-closed).',
      maintenanceState: state?.state ?? 'MAINTENANCE',
    };
  }

  // 2. Maintenance MUST NEVER auto-close existing positions or cancel protective SL/TP orders
  if (
    intent.kind === 'AUTO_CLOSE_FOR_MAINTENANCE' ||
    intent.kind === 'CANCEL_PROTECTIVE_ORDER'
  ) {
    return {
      allowed: false,
      httpStatus: 409,
      code: 'BLOCKED_PROTECTIVE_PRESERVATION_INVARIANT',
      reason:
        'Safe Maintenance Protocol forbids auto-closing existing positions or cancelling protective SL/TP orders.',
      maintenanceState: state.state,
    };
  }

  // 3. Risk-reducing exits & protective SL/TP maintenance remain ALLOWED in every maintenance state
  if (
    intent.kind === 'RISK_REDUCING_EXIT' ||
    intent.kind === 'PROTECTIVE_ORDER_UPDATE'
  ) {
    return {
      allowed: true,
      httpStatus: 200,
      code: 'ALLOWED_RISK_REDUCING_PROTECTION',
      reason: 'Risk-reducing exit or protective order maintenance allowed during maintenance.',
      maintenanceState: state.state,
    };
  }

  // 4. Prevent duplicate order submission across restarts via clientOrderId idempotency tracking
  if (
    intent.clientOrderId &&
    state.processedClientOrderIds.includes(intent.clientOrderId)
  ) {
    return {
      allowed: false,
      httpStatus: 409,
      code: 'BLOCKED_DUPLICATE_CLIENT_ORDER_ID',
      reason: `Duplicate clientOrderId "${intent.clientOrderId}" rejected to prevent restart double-execution.`,
      maintenanceState: state.state,
    };
  }

  // 5. Block self-healing agents from bypassing maintenance lock
  if (
    (intent.source === 'SELF_HEALING' || intent.kind === 'SELF_HEALING_BYPASS') &&
    state.state !== 'NORMAL'
  ) {
    return {
      allowed: false,
      httpStatus: 423,
      code: 'BLOCKED_SELF_HEALING_BYPASS',
      reason: `Self-healing agent cannot bypass maintenance state (${state.state}).`,
      maintenanceState: state.state,
    };
  }

  // 6. Rollback active strictly blocks all new entries & live mode switching
  if (state.rollbackActive) {
    return {
      allowed: false,
      httpStatus: 423,
      code: 'BLOCKED_ROLLBACK_ACTIVE',
      reason: 'Deployment rollback is active — all new entries and live switches are blocked until verified resume.',
      maintenanceState: state.state,
    };
  }

  // 7. Any non-NORMAL state blocks all NEW entries & LIVE mode transitions
  if (state.state !== 'NORMAL') {
    return {
      allowed: false,
      httpStatus: 423,
      code: 'BLOCKED_MAINTENANCE_ACTIVE',
      reason: `Safe Maintenance Protocol active (${state.state}): new ${intent.source.toLowerCase()} entries and live mode switches are paused while existing positions stay protected.`,
      maintenanceState: state.state,
    };
  }

  return {
    allowed: true,
    httpStatus: 200,
    code: 'ALLOWED_NORMAL',
    reason: 'System in NORMAL state — execution gate open.',
    maintenanceState: state.state,
  };
}

export function buildPublicMaintenanceSummary(
  state: SafeMaintenanceState,
  nowMs = Date.now()
): PublicMaintenanceSummary {
  const isMaintenanceActive = state.state !== 'NORMAL' || state.integrityCorrupted || state.rollbackActive;
  const endMs = state.estimatedEndAtIso ? new Date(state.estimatedEndAtIso).getTime() : null;
  const remainingSeconds =
    isMaintenanceActive && endMs !== null && Number.isFinite(endMs)
      ? Math.max(0, Math.floor((endMs - nowMs) / 1000))
      : null;

  let serviceHealth: PublicMaintenanceSummary['serviceHealth'] = 'OPERATIONAL';
  if (state.integrityCorrupted || state.rollbackActive) {
    serviceHealth = 'DEGRADED_SAFE_LOCK';
  } else if (state.state === 'VERIFYING' || state.state === 'AWAITING_APPROVAL') {
    serviceHealth = 'VERIFYING';
  } else if (state.state === 'PREPARING' || state.state === 'MAINTENANCE') {
    serviceHealth = 'UPDATING';
  }

  return {
    state: state.state,
    isMaintenanceActive,
    newLiveEntriesBlocked: isMaintenanceActive,
    publicAccessMode: state.publicAccessMode,
    showMaintenancePage:
      isMaintenanceActive &&
      state.publicAccessMode === 'MAINTENANCE_PAGE' &&
      (state.state === 'MAINTENANCE' || state.state === 'VERIFYING' || state.state === 'AWAITING_APPROVAL'),
    bannerMessage: state.bannerMessage || DEFAULT_MAINTENANCE_BANNER,
    currentVersion: state.currentVersion,
    targetVersion: state.targetVersion,
    estimatedEndAtIso: state.estimatedEndAtIso,
    scheduledStartAtIso: state.scheduledStartAtIso,
    remainingSeconds,
    serviceHealth,
    existingPositionsProtected: true,
    updatedAtIso: state.updatedAtIso,
  };
}

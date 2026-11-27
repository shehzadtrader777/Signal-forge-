/**
 * Signal Forge resilient service supervisor (pure deterministic policy).
 * Safe fallback is limited to read-only or separately approved routes.
 * No function here can turn on live trading or clear a hard emergency seal.
 */
export type RecoveryMode = 'PRIMARY' | 'FALLBACK' | 'ISOLATED' | 'PROBING';
export type RecoveryFault = 'TIMEOUT' | 'RATE_LIMIT' | 'UPSTREAM_5XX' | 'STALE_DATA' | 'AUTH_FAILURE' | 'SECURITY_ALERT' | 'INTEGRITY_FAILURE';

export interface RecoveryState {
  readonly mode: RecoveryMode;
  readonly consecutiveFailures: number;
  readonly consecutiveHealthy: number;
  readonly switchCount: number;
  readonly lastTransitionMs: number;
  readonly nextProbeAtMs: number;
  readonly lastCause: RecoveryFault | null;
}
export interface RecoverySafetyContext {
  readonly hardHaltActive: boolean;
  readonly securityIncidentActive: boolean;
  readonly marketDataFresh: boolean;
  readonly stateReconciled: boolean;
  readonly fallbackTrusted: boolean;
  readonly fallbackIsReadOnly: boolean;
  readonly rollbackIntegrityVerified: boolean;
}
export interface RecoveryResult {
  readonly state: RecoveryState;
  readonly recommendedRoute: 'PRIMARY' | 'READ_ONLY_FALLBACK' | 'BLOCK';
  readonly liveExecutionAllowed: false;
  readonly autoRecoveryEligible: boolean;
  readonly message: string;
}
const CRITICAL: ReadonlySet<RecoveryFault> = new Set(['AUTH_FAILURE','SECURITY_ALERT','INTEGRITY_FAILURE']);
const FAILURES_TO_FALLBACK = 2;
const SUCCESSES_TO_RESTORE = 3;
const MIN_STABLE_MS = 60_000;
const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 120_000;
const MAX_SWITCHES = 5;

export function initialRecoveryState(nowMs = 0): RecoveryState {
  return {mode:'PRIMARY',consecutiveFailures:0,consecutiveHealthy:0,switchCount:0,lastTransitionMs:nowMs,nextProbeAtMs:nowMs,lastCause:null};
}

export function recoveryBackoffMs(failures: number): number {
  const n = Number.isFinite(failures) ? Math.max(0,Math.min(8,Math.trunc(failures))) : 8;
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** n);
}

export function evaluateRecovery(
  previous: RecoveryState,
  input: { readonly nowMs: number; readonly healthy: boolean; readonly fault?: RecoveryFault; readonly safety: RecoverySafetyContext; },
): RecoveryResult {
  const now = Number.isFinite(input.nowMs) ? Math.max(previous.lastTransitionMs,input.nowMs) : previous.lastTransitionMs;
  const unsafe = input.safety.hardHaltActive || input.safety.securityIncidentActive;
  const critical = !input.healthy && (!!input.fault && CRITICAL.has(input.fault));
  const trustworthy = input.safety.marketDataFresh && input.safety.stateReconciled && input.safety.rollbackIntegrityVerified;
  if (unsafe || critical || !input.safety.rollbackIntegrityVerified) {
    return {
      state:{...previous,mode:'ISOLATED',consecutiveHealthy:0,lastCause:input.fault ?? previous.lastCause,
        lastTransitionMs:now,nextProbeAtMs:now + MAX_BACKOFF_MS},
      recommendedRoute:'BLOCK',liveExecutionAllowed:false,autoRecoveryEligible:false,
      message:'Critical or uncertain integrity state: owner investigation required',
    };
  }

  let next = previous;
  if (!input.healthy) {
    const failures = previous.consecutiveFailures + 1;
    const eligibleFallback = input.safety.fallbackTrusted && input.safety.fallbackIsReadOnly && trustworthy;
    const maySwitch = failures >= FAILURES_TO_FALLBACK && eligibleFallback && previous.switchCount < MAX_SWITCHES;
    const mode: RecoveryMode = maySwitch ? 'FALLBACK' : (previous.mode === 'PRIMARY' && failures < FAILURES_TO_FALLBACK ? 'PRIMARY' : 'ISOLATED');
    next = {
      ...previous,mode,consecutiveFailures:failures,consecutiveHealthy:0,
      switchCount:previous.switchCount + (maySwitch && previous.mode !== 'FALLBACK' ? 1 : 0),
      lastTransitionMs:mode !== previous.mode ? now : previous.lastTransitionMs,
      nextProbeAtMs:now + recoveryBackoffMs(failures),lastCause:input.fault ?? 'TIMEOUT',
    };
  } else {
    const healthy = previous.consecutiveHealthy + 1;
    const stable = now - previous.lastTransitionMs >= MIN_STABLE_MS;
    const recovered = trustworthy && healthy >= SUCCESSES_TO_RESTORE && stable
      && (previous.mode === 'FALLBACK' || previous.mode === 'PROBING');
    next = recovered
      ? {...previous,mode:'PRIMARY',consecutiveFailures:0,consecutiveHealthy:0,lastTransitionMs:now,nextProbeAtMs:now,lastCause:null}
      : {...previous,consecutiveHealthy:healthy,nextProbeAtMs:now};
  }
  const fallback = next.mode === 'FALLBACK' && input.safety.fallbackTrusted
    && input.safety.fallbackIsReadOnly && trustworthy;
  const route = fallback ? 'READ_ONLY_FALLBACK' : next.mode === 'PRIMARY' && input.healthy && trustworthy ? 'PRIMARY' : 'BLOCK';
  return {state:next,recommendedRoute:route,liveExecutionAllowed:false,
    autoRecoveryEligible:next.mode === 'PRIMARY' && input.healthy && trustworthy,
    message:route === 'BLOCK'?'Waiting for safe recovery evidence':fallback?'Read-only fallback in use':'Primary health verified; execution gates remain independent'};
}

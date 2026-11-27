/**
 * Forge Safety Decision Policy — classification only, not an execution unlock.
 * This policy cannot clear an engaged EMERGENCY_HALT (423) or change mode.
 * Technical pause auto-resume is eligible only after independent server checks.
 */
export type SafetyTrigger =
  | 'API_TIMEOUT' | 'RATE_LIMIT' | 'FEED_DISCONNECTED' | 'CACHE_STALE'
  | 'DEPLOY_ROLLBACK' | 'API_AUTH_FAILURE'
  | 'MARKET_CRASH' | 'PORTFOLIO_LOSS_LIMIT' | 'MODULE_LOSS_LIMIT'
  | 'SECURITY_INTRUSION' | 'UNAUTHORIZED_WITHDRAWAL' | 'CREDENTIAL_COMPROMISE'
  | 'RISK_ENGINE_TAMPER' | 'UNKNOWN';

export type SafetyAction = 'TECHNICAL_PAUSE' | 'MODULE_ISOLATION' | 'OWNER_LOCKED_HALT';

export interface SafetyDecision {
  readonly action: SafetyAction;
  readonly requiresOwnerApproval: boolean;
  readonly canAttemptAutomaticResume: boolean;
  readonly preventNewOrders: true;
  readonly reason: string;
}

const transient = new Set<SafetyTrigger>([
  'API_TIMEOUT', 'RATE_LIMIT', 'FEED_DISCONNECTED', 'CACHE_STALE', 'DEPLOY_ROLLBACK',
]);

export function classifySafetyTrigger(trigger: SafetyTrigger): SafetyDecision {
  if (trigger === 'MODULE_LOSS_LIMIT') {
    return {
      action: 'MODULE_ISOLATION', requiresOwnerApproval: true,
      canAttemptAutomaticResume: false, preventNewOrders: true,
      reason: 'Module drawdown breached its risk limit; do not auto-restore the module.',
    };
  }
  if (transient.has(trigger)) {
    return {
      action: 'TECHNICAL_PAUSE', requiresOwnerApproval: false,
      canAttemptAutomaticResume: true, preventNewOrders: true,
      reason: 'Technical outage: resume only once independent health gates all pass.',
    };
  }
  return {
    action: 'OWNER_LOCKED_HALT', requiresOwnerApproval: true,
    canAttemptAutomaticResume: false, preventNewOrders: true,
    reason: 'Critical or unknown risk; require authenticated owner verification.',
  };
}

export interface TechnicalRecoveryEvidence {
  readonly activeHardHalt: boolean;
  readonly securityIncidentUnresolved: boolean;
  readonly riskLimitsBreached: boolean;
  readonly upstreamAuthenticated: boolean;
  readonly marketDataFresh: boolean;
  readonly reconciliationClean: boolean;
  readonly rollbackIntegrityVerified: boolean;
  readonly consecutiveHealthyChecks: number;
  readonly elapsedStableSeconds: number;
}

/**
 * Pure eligibility gate; caller MUST separately authenticate every operation
 * and enforce an authoritative server stop at order submission.
 */
export function mayAutoResumeTechnicalPause(
  trigger: SafetyTrigger,
  evidence: TechnicalRecoveryEvidence,
): boolean {
  return classifySafetyTrigger(trigger).canAttemptAutomaticResume
    && !evidence.activeHardHalt
    && !evidence.securityIncidentUnresolved
    && !evidence.riskLimitsBreached
    && evidence.upstreamAuthenticated
    && evidence.marketDataFresh
    && evidence.reconciliationClean
    && evidence.rollbackIntegrityVerified
    && Number.isSafeInteger(evidence.consecutiveHealthyChecks)
    && evidence.consecutiveHealthyChecks >= 3
    && Number.isFinite(evidence.elapsedStableSeconds)
    && evidence.elapsedStableSeconds >= 60;
}

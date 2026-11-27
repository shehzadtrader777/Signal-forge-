import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { classifySafetyTrigger, mayAutoResumeTechnicalPause, type TechnicalRecoveryEvidence } from './forgeSafetyRecoveryPolicy';

const healthy: TechnicalRecoveryEvidence = {
  activeHardHalt: false, securityIncidentUnresolved: false, riskLimitsBreached: false,
  upstreamAuthenticated: true, marketDataFresh: true, reconciliationClean: true,
  rollbackIntegrityVerified: true, consecutiveHealthyChecks: 3, elapsedStableSeconds: 60,
};

test('risk, account compromise and unknown triggers always require owner recovery', () => {
  for (const trigger of ['MARKET_CRASH', 'PORTFOLIO_LOSS_LIMIT', 'SECURITY_INTRUSION', 'UNAUTHORIZED_WITHDRAWAL', 'CREDENTIAL_COMPROMISE', 'RISK_ENGINE_TAMPER', 'API_AUTH_FAILURE', 'UNKNOWN'] as const) {
    const decision = classifySafetyTrigger(trigger);
    assert.equal(decision.requiresOwnerApproval, true);
    assert.equal(decision.canAttemptAutomaticResume, false);
    assert.equal(mayAutoResumeTechnicalPause(trigger, healthy), false);
  }
});

test('module loss must not automatically restore module', () => {
  assert.equal(classifySafetyTrigger('MODULE_LOSS_LIMIT').action, 'MODULE_ISOLATION');
  assert.equal(mayAutoResumeTechnicalPause('MODULE_LOSS_LIMIT', healthy), false);
});

test('transient pause may resume only with stable independent evidence', () => {
  for (const trigger of ['API_TIMEOUT','RATE_LIMIT','FEED_DISCONNECTED','CACHE_STALE','DEPLOY_ROLLBACK'] as const) {
    assert.equal(mayAutoResumeTechnicalPause(trigger, healthy), true);
    assert.equal(mayAutoResumeTechnicalPause(trigger, { ...healthy, activeHardHalt: true }), false);
    assert.equal(mayAutoResumeTechnicalPause(trigger, { ...healthy, securityIncidentUnresolved: true }), false);
    assert.equal(mayAutoResumeTechnicalPause(trigger, { ...healthy, riskLimitsBreached: true }), false);
    assert.equal(mayAutoResumeTechnicalPause(trigger, { ...healthy, marketDataFresh: false }), false);
    assert.equal(mayAutoResumeTechnicalPause(trigger, { ...healthy, reconciliationClean: false }), false);
    assert.equal(mayAutoResumeTechnicalPause(trigger, { ...healthy, rollbackIntegrityVerified: false }), false);
    assert.equal(mayAutoResumeTechnicalPause(trigger, { ...healthy, consecutiveHealthyChecks: 2 }), false);
    assert.equal(mayAutoResumeTechnicalPause(trigger, { ...healthy, elapsedStableSeconds: 59 }), false);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approveControlledResume,
  buildPublicMaintenanceSummary,
  createInitialMaintenanceState,
  endMaintenanceToVerifying,
  evaluateMaintenanceOrderGate,
  evaluateMaintenanceTimer,
  extendMaintenance,
  MANDATORY_SAFETY_CHECKS,
  parseMaintenanceStateFailClosed,
  reconcilePendingOrdersAndProtections,
  recordSafetyVerificationResults,
  scheduleMaintenance,
  serializeMaintenanceState,
  startMaintenance,
  triggerDeploymentRollback,
  type SafetyCheckId,
} from './safeMaintenanceProtocol.ts';

function buildAllPassedUpdates(): Record<SafetyCheckId, { status: 'PASS'; detail: string }> {
  const out = {} as Record<SafetyCheckId, { status: 'PASS'; detail: string }>;
  for (const item of MANDATORY_SAFETY_CHECKS) {
    out[item.id] = { status: 'PASS', detail: `Verified ${item.label}` };
  }
  return out;
}

test('Safe Maintenance Protocol: NORMAL allows entries, MAINTENANCE blocks all entry sources while preserving exits & protections', () => {
  const base = createInitialMaintenanceState('1.4.0', 1_700_000_000_000);

  // Normal state permits new entry
  assert.equal(
    evaluateMaintenanceOrderGate(base, { kind: 'NEW_ENTRY', source: 'MANUAL' }).allowed,
    true
  );

  // Start maintenance (READ_ONLY, 60m)
  const maint = startMaintenance(
    base,
    {
      durationMinutes: 60,
      publicAccessMode: 'READ_ONLY',
      targetVersion: '1.5.0',
      reason: 'Upgrading risk engine',
      actor: 'admin@signalforge.app',
    },
    1_700_000_010_000
  );
  assert.equal(maint.state, 'MAINTENANCE');
  assert.equal(maint.publicAccessMode, 'READ_ONLY');

  // Every new entry source + live mode switch + self-healing bypass must be BLOCKED
  for (const source of [
    'MANUAL',
    'AUTONOMOUS',
    'VOICE',
    'COPY_TRADING',
    'ARBITRAGE',
    'AI_SIGNAL',
  ] as const) {
    const decision = evaluateMaintenanceOrderGate(maint, { kind: 'NEW_ENTRY', source });
    assert.equal(decision.allowed, false, `Expected ${source} entry to be blocked`);
    assert.equal(decision.httpStatus, 423);
  }

  assert.equal(
    evaluateMaintenanceOrderGate(maint, { kind: 'SWITCH_TO_LIVE', source: 'MANUAL' }).allowed,
    false
  );
  assert.equal(
    evaluateMaintenanceOrderGate(maint, {
      kind: 'SELF_HEALING_BYPASS',
      source: 'SELF_HEALING',
    }).code,
    'BLOCKED_SELF_HEALING_BYPASS'
  );

  // Risk-reducing exit & protective SL/TP updates MUST remain ALLOWED
  assert.equal(
    evaluateMaintenanceOrderGate(maint, {
      kind: 'RISK_REDUCING_EXIT',
      source: 'RISK_ENGINE',
    }).allowed,
    true
  );
  assert.equal(
    evaluateMaintenanceOrderGate(maint, {
      kind: 'PROTECTIVE_ORDER_UPDATE',
      source: 'RISK_ENGINE',
    }).allowed,
    true
  );

  // Auto-closing existing positions or cancelling protective orders MUST BE FORBIDDEN
  assert.equal(
    evaluateMaintenanceOrderGate(maint, {
      kind: 'AUTO_CLOSE_FOR_MAINTENANCE',
      source: 'AUTONOMOUS',
    }).code,
    'BLOCKED_PROTECTIVE_PRESERVATION_INVARIANT'
  );
  assert.equal(
    evaluateMaintenanceOrderGate(maint, {
      kind: 'CANCEL_PROTECTIVE_ORDER',
      source: 'AUTONOMOUS',
    }).code,
    'BLOCKED_PROTECTIVE_PRESERVATION_INVARIANT'
  );
});

test('Safe Maintenance Protocol: timer expiry transitions MAINTENANCE -> VERIFYING and NEVER auto-enables live entries', () => {
  const t0 = 1_700_000_000_000;
  const base = createInitialMaintenanceState('1.4.0', t0);
  const maint = startMaintenance(
    base,
    { durationMinutes: 60, publicAccessMode: 'MAINTENANCE_PAGE', actor: 'operator' },
    t0
  );

  // Advance 2 hours past estimatedEndAtIso
  const expired = evaluateMaintenanceTimer(maint, t0 + 120 * 60_000);
  assert.equal(expired.changed, true);
  assert.equal(expired.state.state, 'VERIFYING');

  // New live entries MUST still be blocked after timer expiry!
  const gate = evaluateMaintenanceOrderGate(expired.state, {
    kind: 'NEW_ENTRY',
    source: 'MANUAL',
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.maintenanceState, 'VERIFYING');

  // Direct resume without passing all 10 safety checks MUST fail
  const prematureResume = approveControlledResume(expired.state, {
    actor: 'operator',
    explicitApproval: true,
  });
  assert.equal(prematureResume.ok, false);
  assert.equal(prematureResume.state.state, 'VERIFYING');
});

test('Safe Maintenance Protocol: full controlled lifecycle (Schedule -> Maintenance -> Extend -> Verify 10/10 -> Approve Resume)', () => {
  const t0 = 1_700_000_000_000;
  const base = createInitialMaintenanceState('1.4.0', t0);

  // Schedule
  const scheduled = scheduleMaintenance(
    base,
    {
      startDelayMinutes: 15,
      durationMinutes: 120,
      publicAccessMode: 'READ_ONLY',
      targetVersion: '1.5.0',
      actor: 'admin',
    },
    t0
  );
  assert.equal(scheduled.state, 'PREPARING');
  assert.equal(
    evaluateMaintenanceOrderGate(scheduled, { kind: 'NEW_ENTRY', source: 'AI_SIGNAL' }).allowed,
    false
  );

  // Scheduled start reached
  const started = evaluateMaintenanceTimer(scheduled, t0 + 16 * 60_000);
  assert.equal(started.state.state, 'MAINTENANCE');

  // Extend +60m
  const extended = extendMaintenance(started.state, 60, 'admin', 'Extra DB migration check', t0 + 20 * 60_000);
  assert.equal(extended.durationMinutes, 180);

  // End maintenance -> VERIFYING (never NORMAL)
  const verifying = endMaintenanceToVerifying(extended, 'admin', 'Ready to verify', t0 + 30 * 60_000);
  assert.equal(verifying.state, 'VERIFYING');

  // Partial verification (only 1 check passed) stays in VERIFYING
  const partial = recordSafetyVerificationResults(
    verifying,
    { app_backend_health: { status: 'PASS', detail: 'HTTP 200 OK' } },
    'admin',
    t0 + 31 * 60_000
  );
  assert.equal(partial.state, 'VERIFYING');

  // Pass all 10 mandatory checks -> AWAITING_APPROVAL
  const readyForApproval = recordSafetyVerificationResults(
    partial,
    buildAllPassedUpdates(),
    'admin',
    t0 + 32 * 60_000
  );
  assert.equal(readyForApproval.state, 'AWAITING_APPROVAL');

  // Still blocked until explicit operator approval!
  assert.equal(
    evaluateMaintenanceOrderGate(readyForApproval, { kind: 'NEW_ENTRY', source: 'MANUAL' }).allowed,
    false
  );

  // Missing explicitApproval must be rejected
  const denied = approveControlledResume(readyForApproval, {
    actor: 'admin',
    explicitApproval: false,
  });
  assert.equal(denied.ok, false);

  // Explicit operator approval resumes NORMAL and promotes version
  const resumed = approveControlledResume(
    readyForApproval,
    { actor: 'admin', explicitApproval: true, note: 'All checks green' },
    t0 + 33 * 60_000
  );
  assert.equal(resumed.ok, true);
  assert.equal(resumed.state.state, 'NORMAL');
  assert.equal(resumed.state.currentVersion, '1.5.0');
  assert.equal(
    evaluateMaintenanceOrderGate(resumed.state, { kind: 'NEW_ENTRY', source: 'MANUAL' }).allowed,
    true
  );
});

test('Safe Maintenance Protocol: restart persistence, checksum fail-closed, duplicate order & notification prevention, and rollback', () => {
  const t0 = 1_700_000_000_000;
  let state = createInitialMaintenanceState('1.4.0', t0);
  state = startMaintenance(
    state,
    { durationMinutes: 60, publicAccessMode: 'MAINTENANCE_PAGE', targetVersion: '1.5.0', actor: 'admin' },
    t0
  );

  // Reconcile pending/partial orders & protected positions
  state = reconcilePendingOrdersAndProtections(
    state,
    {
      trackedOrders: [
        {
          clientOrderId: 'CID-RESTART-001',
          exchangeOrderId: 'EX-991',
          pair: 'BTCUSDT',
          side: 'BUY',
          status: 'PARTIALLY_FILLED',
          requestedQty: 0.1,
          filledQty: 0.04,
          isProtective: false,
          updatedAtIso: new Date(t0).toISOString(),
        },
      ],
      protectedPositions: [
        {
          positionId: 'POS-001',
          pair: 'BTCUSDT',
          side: 'LONG',
          quantity: 0.04,
          entryPrice: 92000,
          stopLossOrderId: 'SL-001',
          takeProfitOrderId: 'TP-001',
          protectionVerified: true,
        },
      ],
    },
    t0
  );

  // Serialize & reload (simulated service restart)
  const serialized = serializeMaintenanceState(state);
  const reloaded = parseMaintenanceStateFailClosed(serialized, '1.4.0', t0 + 5000);
  assert.equal(reloaded.state, 'MAINTENANCE');
  assert.equal(reloaded.integrityCorrupted, false);
  assert.equal(reloaded.protectedPositions.length, 1);

  // Duplicate clientOrderId rejected after restart
  const dupDecision = evaluateMaintenanceOrderGate(
    { ...reloaded, state: 'NORMAL' },
    { kind: 'NEW_ENTRY', source: 'MANUAL', clientOrderId: 'CID-RESTART-001' }
  );
  assert.equal(dupDecision.allowed, false);
  assert.equal(dupDecision.code, 'BLOCKED_DUPLICATE_CLIENT_ORDER_ID');

  // Tampered/corrupted persistence fails CLOSED
  const tampered = serialized.replace('1.5.0', '9.9.9');
  const failClosed = parseMaintenanceStateFailClosed(tampered, '1.4.0', t0 + 6000);
  assert.equal(failClosed.integrityCorrupted, true);
  assert.equal(failClosed.state, 'MAINTENANCE');
  assert.equal(
    evaluateMaintenanceOrderGate(failClosed, { kind: 'NEW_ENTRY', source: 'MANUAL' }).code,
    'BLOCKED_FAIL_CLOSED_INTEGRITY'
  );
  // Risk-reducing exit STILL allowed even in fail-closed integrity state
  assert.equal(
    evaluateMaintenanceOrderGate(failClosed, { kind: 'RISK_REDUCING_EXIT', source: 'RISK_ENGINE' })
      .allowed,
    true
  );

  // Duplicate notification within same minute is deduplicated
  const notifCountBefore = reloaded.notifications.length;
  const startedAgain = startMaintenance(
    reloaded,
    { durationMinutes: 60, publicAccessMode: 'MAINTENANCE_PAGE', targetVersion: '1.5.0', actor: 'admin' },
    t0 + 1000
  );
  assert.equal(startedAgain.notifications.length, notifCountBefore);

  // Failed deployment rollback keeps new entries blocked & preserves existing positions
  const rolledBack = triggerDeploymentRollback(
    reloaded,
    { actor: 'admin', reason: 'Exchange adapter smoke test failed' },
    t0 + 10_000
  );
  assert.equal(rolledBack.rollbackActive, true);
  assert.equal(rolledBack.targetVersion, '1.4.0');
  assert.equal(rolledBack.protectedPositions.length, 1);
  assert.equal(
    evaluateMaintenanceOrderGate(rolledBack, { kind: 'NEW_ENTRY', source: 'MANUAL' }).code,
    'BLOCKED_ROLLBACK_ACTIVE'
  );

  // Public summary hides operator/internal order details and sets showMaintenancePage appropriately
  const pubSummary = buildPublicMaintenanceSummary(reloaded, t0 + 5000);
  assert.equal(pubSummary.showMaintenancePage, true);
  assert.equal(pubSummary.newLiveEntriesBlocked, true);
  assert.equal(pubSummary.existingPositionsProtected, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTROL_MATRIX_DESCRIPTORS,
  DEFAULT_CONTROL_MATRIX,
  applySystemControlsToMatrix,
  computeMatrixChecksum,
  derivePlanesFromMatrix,
  diffControlMatrix,
  matrixToSystemControls,
  parseGranularControlMatrix,
} from './controlMatrix';
import {
  UNAUTHENTICATED_PRINCIPAL,
  evaluateSubscriptionGate,
  isPremiumSubscriber,
  maskPrincipalSummary,
  type SubscriptionPrincipal,
} from './subscriptionGatekeeper';
import {
  ORDERED_MICROSERVICE_IDS,
  applyControlMatrixUpdate,
  createInitialPlatformState,
  recordServiceSuccess,
  reportServiceFault,
  rollbackToSnapshot,
  setServiceLifecycle,
  triggerManualFailover,
} from './microserviceArchitecture';

test('Control Matrix parses safely, computes deterministic checksums, and maps to legacy runtime planes', () => {
  const parsed = parseGranularControlMatrix({
    spotWsStream: false,
    futuresExecutionRouter: true,
    nonExistentField: 'ignored',
  });
  assert.equal(parsed.spotWsStream, false);
  assert.equal(parsed.futuresExecutionRouter, true);
  assert.equal(parsed.signalEngine, DEFAULT_CONTROL_MATRIX.signalEngine);

  const c1 = computeMatrixChecksum(parsed);
  const c2 = computeMatrixChecksum({ ...parsed });
  assert.equal(c1, c2);

  const synced = applySystemControlsToMatrix(DEFAULT_CONTROL_MATRIX, {
    testnetExecutionEnabled: false,
    liveFeedModulesEnabled: false,
  });
  const legacyBack = matrixToSystemControls(synced);
  assert.equal(legacyBack.testnetExecutionEnabled, false);
  assert.equal(legacyBack.liveFeedModulesEnabled, false);

  const planes = derivePlanesFromMatrix(synced, true);
  assert.equal(planes.runSpotWsStream, false);
  assert.equal(planes.runTestnetExecution, false);

  const haltedPlanes = derivePlanesFromMatrix(DEFAULT_CONTROL_MATRIX, false);
  assert.equal(haltedPlanes.runSignalEngine, false);
  assert.equal(haltedPlanes.runTopGainersScanner, false);
  assert.ok(CONTROL_MATRIX_DESCRIPTORS.length >= 24);
});

test('Subscription Gatekeeper strictly locks TELEMETRY, AGENT_OVERRIDE, and EXECUTION to authenticated verified PREMIUM_INSTITUTIONAL subscribers', () => {
  // 1. Unauthenticated guest (frozen immutable singleton)
  assert.equal(Object.isFrozen(UNAUTHENTICATED_PRINCIPAL), true);
  for (const cap of ['TELEMETRY', 'AGENT_OVERRIDE', 'EXECUTION'] as const) {
    const res = evaluateSubscriptionGate(UNAUTHENTICATED_PRINCIPAL, cap);
    assert.equal(res.allowed, false);
    assert.equal(res.code, 'AUTH_REQUIRED');
    assert.equal(res.httpStatus, 401);
  }
  assert.equal(evaluateSubscriptionGate(UNAUTHENTICATED_PRINCIPAL, 'PUBLIC_VIEW').allowed, true);

  // 2. Unverified email account
  const unverified: SubscriptionPrincipal = {
    authenticated: true,
    uid: 'user_1',
    email: 'trader@example.com',
    emailVerified: false,
    tier: 'PREMIUM_INSTITUTIONAL',
    status: 'ACTIVE',
    expiresAtMs: Date.now() + 86_400_000,
    entitlementId: 'ent_1',
    planLabel: 'Institutional',
  };
  assert.equal(evaluateSubscriptionGate(unverified, 'EXECUTION').code, 'EMAIL_UNVERIFIED');
  assert.equal(isPremiumSubscriber(unverified), false);

  // 3. Verified FREE / PRO accounts are blocked
  const freeUser: SubscriptionPrincipal = {
    ...unverified,
    emailVerified: true,
    tier: 'FREE',
  };
  assert.equal(
    evaluateSubscriptionGate(freeUser, 'TELEMETRY').code,
    'PREMIUM_SUBSCRIPTION_REQUIRED'
  );
  assert.equal(
    evaluateSubscriptionGate({ ...freeUser, tier: 'PRO' }, 'AGENT_OVERRIDE').code,
    'PREMIUM_SUBSCRIPTION_REQUIRED'
  );

  // 4. Expired PREMIUM account is blocked
  const expiredPremium: SubscriptionPrincipal = {
    ...unverified,
    emailVerified: true,
    tier: 'PREMIUM_INSTITUTIONAL',
    expiresAtMs: Date.now() - 1000,
  };
  assert.equal(
    evaluateSubscriptionGate(expiredPremium, 'EXECUTION').code,
    'SUBSCRIPTION_EXPIRED'
  );

  // 5. Verified active PREMIUM_INSTITUTIONAL unlocks all 3 gated planes
  const activePremium: SubscriptionPrincipal = {
    ...unverified,
    emailVerified: true,
    tier: 'PREMIUM_INSTITUTIONAL',
    status: 'ACTIVE',
    expiresAtMs: Date.now() + 86_400_000,
  };
  assert.equal(isPremiumSubscriber(activePremium), true);
  for (const cap of ['TELEMETRY', 'AGENT_OVERRIDE', 'EXECUTION'] as const) {
    const res = evaluateSubscriptionGate(activePremium, cap);
    assert.equal(res.allowed, true);
    assert.equal(res.httpStatus, 200);
    assert.equal(res.lockedControls.length, 0);
  }

  const masked = maskPrincipalSummary(activePremium);
  assert.equal(masked.maskedEmail, 'tr***@example.com');
  assert.equal(masked.premiumUnlocked, true);
});

test('Microservice Architecture maintains strict fault isolation, HA primary-to-secondary failover, exhaustive redacted error logging, and automated rollback', () => {
  const t0 = 1_760_000_000_000;
  let platform = createInitialPlatformState(DEFAULT_CONTROL_MATRIX, t0);
  assert.equal(platform.monolithDecommissioned, true);
  assert.equal(ORDERED_MICROSERVICE_IDS.length, 5);
  assert.equal(platform.snapshots.length, 1);

  // Mutate control matrix (records pre-mutation healthy snapshot)
  const mutated = applyControlMatrixUpdate(
    platform,
    { spotWsStream: false, futuresExecutionRouter: true },
    'uid_admin',
    'Enable futures router & test change',
    t0 + 1000
  );
  platform = mutated.state;
  assert.deepEqual(mutated.changedKeys.sort(), ['futuresExecutionRouter', 'spotWsStream']);
  assert.equal(platform.controlMatrix.futuresExecutionRouter, true);
  assert.equal(platform.snapshots.length, 2);

  // First fault on market-data-svc (contains secret that must be sanitized)
  const f1 = reportServiceFault(platform, {
    serviceId: 'market-data-svc',
    code: 'WS_DISCONNECT',
    message: 'Socket closed Authorization: Bearer super_secret_jwt_12345 apiKey=abcd1234',
    severity: 'ERROR',
    nowMs: t0 + 2000,
  });
  platform = f1.state;
  assert.equal(f1.failoverTriggered, false);
  assert.equal(f1.rollbackTriggered, false);
  assert.equal(platform.services['market-data-svc'].lifecycle, 'DEGRADED');
  // Sibling services must remain strictly ACTIVE (fault isolation)
  assert.equal(platform.services['ai-agents-svc'].lifecycle, 'ACTIVE');
  assert.equal(platform.services['execution-router-svc'].lifecycle, 'ACTIVE');
  assert.ok(!f1.errorEntry.message.includes('super_secret_jwt_12345'));
  assert.ok(!f1.errorEntry.message.includes('abcd1234'));

  // Second consecutive fault on market-data-svc triggers HA Auto-Failover PRIMARY -> SECONDARY
  const f2 = reportServiceFault(platform, {
    serviceId: 'market-data-svc',
    code: 'WS_TIMEOUT',
    message: 'Primary Binance stream stalled',
    severity: 'ERROR',
    nowMs: t0 + 3000,
  });
  platform = f2.state;
  assert.equal(f2.failoverTriggered, true);
  assert.equal(platform.services['market-data-svc'].activeNode, 'SECONDARY');
  assert.equal(platform.services['market-data-svc'].lifecycle, 'FAILOVER_ACTIVE');
  assert.equal(platform.autoFailoversTotal, 1);
  // Execution router & AI agents still untouched
  assert.equal(platform.services['execution-router-svc'].activeNode, 'PRIMARY');
  assert.equal(platform.services['execution-router-svc'].totalErrors, 0);

  // Critical fault within post-mutation window triggers Automated Rollback back to healthy baseline
  const f3 = reportServiceFault(platform, {
    serviceId: 'execution-router-svc',
    code: 'CRITICAL_PARITY_DRIFT',
    message: 'Unexpected drift following matrix change',
    severity: 'CRITICAL',
    nowMs: t0 + 4000,
  });
  platform = f3.state;
  assert.equal(f3.rollbackTriggered, true);
  assert.equal(platform.autoRollbacksTotal, 1);
  assert.equal(platform.controlMatrix.spotWsStream, DEFAULT_CONTROL_MATRIX.spotWsStream);
  assert.equal(
    platform.controlMatrix.futuresExecutionRouter,
    DEFAULT_CONTROL_MATRIX.futuresExecutionRouter
  );
  assert.equal(platform.rollbackHistory[0].trigger, 'AUTO_FAULT_PROTOCOL');

  // Manual failover + failback + lifecycle isolation + manual rollback checks
  platform = triggerManualFailover(
    platform,
    'ai-agents-svc',
    'SECONDARY',
    'Blue-green canary drill',
    t0 + 5000
  );
  assert.equal(platform.services['ai-agents-svc'].activeNode, 'SECONDARY');
  platform = recordServiceSuccess(platform, 'ai-agents-svc', 18, t0 + 5500);
  assert.equal(platform.services['ai-agents-svc'].lastLatencyMs, 18);

  platform = setServiceLifecycle(
    platform,
    'telemetry-bus-svc',
    'ISOLATED',
    'Operator bulkhead isolation drill',
    t0 + 6000
  );
  assert.equal(platform.services['telemetry-bus-svc'].circuitBreaker, 'OPEN');

  const firstSnap = platform.snapshots[platform.snapshots.length - 1];
  const manualRb = rollbackToSnapshot(
    platform,
    firstSnap.snapshotId,
    'MANUAL_OPERATOR',
    'uid_admin',
    'Manual operator baseline restore',
    t0 + 7000
  );
  assert.equal(manualRb.ok, true);
  assert.equal(manualRb.state.services['ai-agents-svc'].activeNode, 'PRIMARY');
  assert.equal(manualRb.state.services['telemetry-bus-svc'].lifecycle, 'ACTIVE');
  assert.equal(diffControlMatrix(manualRb.state.controlMatrix, DEFAULT_CONTROL_MATRIX).length, 0);
});

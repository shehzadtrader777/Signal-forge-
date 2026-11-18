import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_GITOPS_POLICY,
  KERNEL_REGISTRY,
  computeKernelSetDigest,
  computePolicyDigest,
} from './bindingLayer';
import {
  EU_AI_ACT_HIGH_RISK_ARTICLES,
  ImmutableGateRecordError,
  ImmutableGateRecordStore,
  MIN_GATE_RETENTION_DAYS,
  ORDERED_PG_V4_CONJUNCTS,
  PG_V4_LOGIC_VERSION,
  computePgV4LogicHash,
  evaluatePgV4Gate,
  evaluatePgV4GateAsync,
  evaluatePromotionSubmission,
  resolvePgV4AggregateState,
  validatePgV4RecordCompleteness,
  type PgV4GateRecord,
} from './pgV4Gate';
import {
  CONSTITUTIONAL_FROZEN_RISK,
  CausalWindowViolationError,
  RiskParameterOptimizationForbiddenError,
  assertCausalNonOverlappingWindows,
  computeStabilityScorecard,
  generateCausalWalkForwardWindows,
  optimizeSignalParamsPure,
  runWalkForwardOrchestration,
  type SignalTuneableParams,
} from './walkForwardOrchestrator';
import { generateDeterministicCandles } from './marketData';

test('Walk-Forward Orchestrator generates causally ordered, non-overlapping IS/OOS windows and rejects overlaps', () => {
  const windows = generateCausalWalkForwardWindows({
    totalBars: 410,
    warmupBars: 35,
    inSampleBars: 80,
    outOfSampleBars: 40,
    purgeGapBars: 1,
    maxFolds: 4,
  });

  assert.equal(windows.length, 4);
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    assert.ok(
      w.inSampleRange.endBar < w.outOfSampleRange.startBar,
      `Fold #${w.foldIndex} IS must strictly precede OOS`
    );
    assert.equal(w.purgeGapBars, 1);
    if (i > 0) {
      assert.ok(
        w.outOfSampleRange.startBar > windows[i - 1].outOfSampleRange.endBar,
        `Fold #${w.foldIndex} OOS must not overlap previous fold OOS`
      );
    }
  }

  // Verify structural overlap rejection
  const overlapping = [
    windows[0],
    {
      ...windows[1],
      outOfSampleRange: {
        startBar: windows[0].outOfSampleRange.endBar - 2,
        endBar: windows[0].outOfSampleRange.endBar + 38,
        bars: 40,
      },
    },
  ];
  assert.throws(
    () => assertCausalNonOverlappingWindows(overlapping),
    (err: unknown) => err instanceof CausalWindowViolationError
  );
});

test('Walk-Forward Orchestrator forbids optimizing risk parameters alongside signal parameters and freezes fold params', () => {
  const candles = generateDeterministicCandles('BTCUSDT', '15m', 240);
  const badCandidate = {
    emaFastPeriod: 9,
    emaSlowPeriod: 21,
    rsiBuyMax: 72,
    rsiSellMin: 28,
    trailingAtrMult: 1.6,
    minRRRatio: 3.0,
  } as unknown as SignalTuneableParams;

  assert.throws(
    () =>
      optimizeSignalParamsPure({
        inSampleCandlesPrefix: candles.slice(0, 120),
        warmupStartBar: 0,
        inSampleStartBar: 35,
        inSampleEndBar: 119,
        symbol: 'BTCUSDT',
        timeframe: '15m',
        candidateGrid: [badCandidate],
      }),
    (err: unknown) => err instanceof RiskParameterOptimizationForbiddenError
  );

  // Pure function determinism: two calls yield bit-identical frozen params
  const optA = optimizeSignalParamsPure({
    inSampleCandlesPrefix: candles.slice(0, 120),
    warmupStartBar: 0,
    inSampleStartBar: 35,
    inSampleEndBar: 119,
    symbol: 'BTCUSDT',
    timeframe: '15m',
  });
  const optB = optimizeSignalParamsPure({
    inSampleCandlesPrefix: candles.slice(0, 120),
    warmupStartBar: 0,
    inSampleStartBar: 35,
    inSampleEndBar: 119,
    symbol: 'BTCUSDT',
    timeframe: '15m',
  });
  assert.deepEqual(optA.selectedSignalParams, optB.selectedSignalParams);
  assert.equal(Object.isFrozen(optA.selectedSignalParams), true);
  assert.equal(CONSTITUTIONAL_FROZEN_RISK.minRRRatio, 5.0);
});

test('Walk-Forward Orchestration computes complete Stability Scorecard over unchanged PITFeed backtest engine', () => {
  const report = runWalkForwardOrchestration({
    symbol: 'BTCUSDT',
    timeframe: '15m',
    inSampleBars: 85,
    outOfSampleBars: 45,
    maxFolds: 3,
  });

  assert.equal(report.orchestratorVersion, 'WFV_ORCHESTRATOR_V4');
  assert.equal(report.folds.length, 3);
  assert.equal(report.riskConstantsLocked.minRRRatio, 5.0);
  assert.equal(report.riskConstantsLocked.maxRiskPct, 2.0);
  for (const fold of report.folds) {
    assert.equal(Object.isFrozen(fold.frozenParams), true);
    assert.equal(Object.isFrozen(fold.frozenParams.signal), true);
    assert.equal(Object.isFrozen(fold.frozenParams.risk), true);
    assert.equal(fold.outOfSample.tripwireZeroLookAhead, true);
    assert.equal(fold.outOfSample.rrRejectedLeaks, 0);
    assert.ok(fold.frozenParams.frozenParamHash.startsWith('wf4_'));
  }

  const sc = report.scorecard;
  assert.equal(typeof sc.meanOosReturn, 'number');
  assert.equal(typeof sc.stdDevOosReturn, 'number');
  assert.equal(typeof sc.trainToTestDegradationRatio, 'number');
  assert.ok(sc.signConsistency >= 0 && sc.signConsistency <= 1);
  assert.ok(sc.parameterDrift >= 0 && sc.parameterDrift <= 1);
  assert.ok(sc.overfittingProbabilityEstimate >= 0 && sc.overfittingProbabilityEstimate <= 1);
});

test('PG_v4 evaluates all 14 canonical conjuncts in strict 3-tier order with evidence_ref + 64-hex evidence_hash and NEVER caches identity', () => {
  assert.equal(ORDERED_PG_V4_CONJUNCTS.length, 14);
  assert.equal(PG_V4_LOGIC_VERSION, '4.1.0');

  let policyLoadCalls = 0;
  const freshLoader = () => {
    policyLoadCalls += 1;
    return { ...DEFAULT_GITOPS_POLICY };
  };

  const healthyScorecard = computeStabilityScorecard([]);
  assert.equal(healthyScorecard.overfittingProbabilityEstimate, 1);

  const wfBase = runWalkForwardOrchestration({
    symbol: 'BTCUSDT',
    timeframe: '15m',
    inSampleBars: 85,
    outOfSampleBars: 45,
    maxFolds: 3,
  });

  const record1 = evaluatePgV4Gate({
    promotionRequestId: 'prom_req_identity_1',
    environment: 'staging',
    loadFreshPolicy: freshLoader,
    expectedKernelHash: computeKernelSetDigest(KERNEL_REGISTRY),
    expectedPolicyHash: computePolicyDigest(DEFAULT_GITOPS_POLICY),
    walkForwardReport: wfBase,
  });
  const record2 = evaluatePgV4Gate({
    promotionRequestId: 'prom_req_identity_2',
    environment: 'staging',
    loadFreshPolicy: freshLoader,
    expectedKernelHash: computeKernelSetDigest(KERNEL_REGISTRY),
    expectedPolicyHash: computePolicyDigest(DEFAULT_GITOPS_POLICY),
    walkForwardReport: wfBase,
  });

  // Verify zero identity caching: loader was invoked fresh every single time
  assert.equal(policyLoadCalls, 2);
  assert.equal(record1.identityCacheBypassed, true);
  assert.ok(record2.identityEvaluationSeq > record1.identityEvaluationSeq);

  // Verify exact 14 conjuncts in evaluation order and evidence fields on every conjunct
  assert.equal(record1.conjuncts.length, 14);
  const expectedOrder = ORDERED_PG_V4_CONJUNCTS.map((c) => c.id);
  assert.deepEqual(
    record1.conjuncts.map((c) => c.conjunctId),
    expectedOrder
  );
  for (let i = 0; i < record1.conjuncts.length; i++) {
    const c = record1.conjuncts[i];
    assert.equal(c.evalOrder, i + 1);
    assert.equal(c.cached, false);
    assert.ok(c.evidence_ref.length > 0, `${c.conjunctId} missing evidence_ref`);
    assert.match(c.evidence_hash, /^[0-9a-f]{64}$/, `${c.conjunctId} invalid evidence_hash`);
  }

  // Verify first 2 conjuncts are Tier 1 identity and both PASS, plus PG_stale_state in Tier 2
  assert.equal(record1.conjuncts[0].conjunctId, 'PG_kernel_identity');
  assert.equal(record1.conjuncts[1].conjunctId, 'PG_policy_identity');
  assert.equal(record1.conjuncts[0].status, 'PASS');
  assert.equal(record1.conjuncts[1].status, 'PASS');
  const staleConj = record1.conjuncts.find((c) => c.conjunctId === 'PG_stale_state');
  assert.ok(staleConj);
  assert.equal(staleConj.tier, 'TIER_2_DEPLOYMENT_BLOCKING');
  assert.equal(staleConj.status, 'PASS');
});

test('PG_v4 identity failure short-circuits immediately and marks ALL remaining 12 conjuncts SKIPPED', () => {
  const wfBase = runWalkForwardOrchestration({
    symbol: 'BTCUSDT',
    timeframe: '15m',
    inSampleBars: 85,
    outOfSampleBars: 45,
    maxFolds: 3,
  });

  const kernelMismatchRecord = evaluatePgV4Gate({
    promotionRequestId: 'prom_req_shortcircuit_kernel',
    environment: 'staging',
    expectedKernelHash: 'deadbeef'.repeat(8),
    walkForwardReport: wfBase,
  });

  assert.equal(kernelMismatchRecord.identityShortCircuited, true);
  assert.equal(kernelMismatchRecord.deploymentBlocked, true);
  assert.equal(kernelMismatchRecord.promotionPermitted, false);
  assert.equal(kernelMismatchRecord.aggregateState, 'FAIL');
  assert.equal(kernelMismatchRecord.conjuncts.length, 14);
  assert.equal(kernelMismatchRecord.conjuncts[0].conjunctId, 'PG_kernel_identity');
  assert.equal(kernelMismatchRecord.conjuncts[0].status, 'FAIL');

  // Fail-fast: when PG_kernel_identity fails, ALL 13 other conjuncts (including PG_policy_identity) are SKIPPED
  const remaining13 = kernelMismatchRecord.conjuncts.slice(1);
  assert.equal(remaining13.length, 13);
  for (const c of remaining13) {
    assert.equal(c.status, 'SKIPPED', `Expected ${c.conjunctId} to be SKIPPED on short-circuit`);
    assert.equal(c.skippedDueToIdentityFailure, true);
    assert.ok(c.evidence_ref.length > 0);
    assert.match(c.evidence_hash, /^[0-9a-f]{64}$/);
  }

  // Policy failure (e.g. forbidden min_rr in policy) passes kernel, fails policy, and marks remaining 12 SKIPPED
  const policyMismatchRecord = evaluatePgV4Gate({
    promotionRequestId: 'prom_req_shortcircuit_policy',
    environment: 'production',
    policyDocument: { ...DEFAULT_GITOPS_POLICY, min_rr: 2 },
    walkForwardReport: wfBase,
  });

  assert.equal(policyMismatchRecord.identityShortCircuited, true);
  assert.equal(policyMismatchRecord.aggregateState, 'FAIL');
  assert.equal(policyMismatchRecord.conjuncts[0].status, 'PASS');
  assert.equal(policyMismatchRecord.conjuncts[1].conjunctId, 'PG_policy_identity');
  assert.equal(policyMismatchRecord.conjuncts[1].status, 'FAIL');
  assert.equal(policyMismatchRecord.conjuncts.slice(2).length, 12);
  assert.ok(
    policyMismatchRecord.conjuncts.slice(2).every((c) => c.status === 'SKIPPED')
  );
});

test('evaluatePgV4GateAsync runs Tier 3 promotion conjuncts concurrently and matches strict 14-conjunct order', async () => {
  const wfBase = runWalkForwardOrchestration({
    symbol: 'BTCUSDT',
    timeframe: '15m',
    inSampleBars: 85,
    outOfSampleBars: 45,
    maxFolds: 3,
  });
  const asyncRecord = await evaluatePgV4GateAsync({
    promotionRequestId: 'prom_req_async_parallel',
    environment: 'staging',
    walkForwardReport: wfBase,
  });
  assert.equal(asyncRecord.conjuncts.length, 14);
  assert.equal(asyncRecord.identityCacheBypassed, true);
  for (let i = 0; i < asyncRecord.conjuncts.length; i++) {
    assert.equal(asyncRecord.conjuncts[i].evalOrder, i + 1);
  }
});

test('PG_v4 deterministic aggregation precedence respects FAIL > OFFLINE > AMBER > PASS', () => {
  assert.equal(
    resolvePgV4AggregateState([
      { status: 'PASS' },
      { status: 'AMBER' },
      { status: 'OFFLINE' },
      { status: 'FAIL' },
    ]),
    'FAIL'
  );
  assert.equal(
    resolvePgV4AggregateState([
      { status: 'PASS' },
      { status: 'AMBER' },
      { status: 'OFFLINE' },
    ]),
    'OFFLINE'
  );
  assert.equal(
    resolvePgV4AggregateState([{ status: 'PASS' }, { status: 'AMBER' }]),
    'AMBER'
  );
  assert.equal(
    resolvePgV4AggregateState([{ status: 'PASS' }, { status: 'PASS' }]),
    'PASS'
  );
});

test('PG_v4 Gate Completeness, Promotion API rejection, 5-year Retention & Append-Only Immutability', () => {
  const wfBase = runWalkForwardOrchestration({
    symbol: 'BTCUSDT',
    timeframe: '15m',
    inSampleBars: 85,
    outOfSampleBars: 45,
    maxFolds: 3,
  });

  const store = new ImmutableGateRecordStore();

  // Construct guaranteed healthy passing record for certification test
  const passingWf = {
    ...wfBase,
    scorecard: Object.freeze({
      foldCount: 3,
      meanOosReturn: 4.8,
      stdDevOosReturn: 1.1,
      meanIsReturn: 5.5,
      trainToTestDegradationRatio: 0.873,
      signConsistency: 1.0,
      parameterDrift: 0.08,
      overfittingProbabilityEstimate: 0.05,
    }),
    parityGate: Object.freeze({
      ...wfBase.parityGate,
      passed: true,
      status: 'ARMED' as const,
      liveDeploymentAllowed: true,
      breachAxes: Object.freeze([]),
      haltReason: null,
    }),
  };

  const passRecord = evaluatePgV4Gate({
    promotionRequestId: 'prom_req_valid_001',
    environment: 'staging',
    timestampUtc: '2026-11-17T12:00:00.000Z',
    walkForwardReport: passingWf,
    compliance: {
      articlesDeclared: EU_AI_ACT_HIGH_RISK_ARTICLES,
      guaranteeProfitFlag: false,
      riskDisclosureActive: true,
      modelCardDocumented: true,
    },
  });

  assert.equal(passRecord.aggregateState, 'PASS');
  assert.equal(passRecord.promotionPermitted, true);

  // Verify 5-year retention lock (>= 1825 days)
  const retentionMs = Date.parse(passRecord.retainUntilUtc) - Date.parse(passRecord.evaluatedAtUtc);
  assert.ok(retentionMs >= MIN_GATE_RETENTION_DAYS * 86_400_000);

  // 1. Rejection of incomplete conjunct record sets (< 14)
  const incompleteRecord: PgV4GateRecord = {
    ...passRecord,
    promotionRequestId: 'prom_req_incomplete_13',
    conjuncts: passRecord.conjuncts.slice(0, 13),
  };
  const completenessCheck = validatePgV4RecordCompleteness(incompleteRecord);
  assert.equal(completenessCheck.valid, false);
  assert.deepEqual(completenessCheck.missingConjunctIds, ['PG_regime_stability']);

  const incompletePromo = evaluatePromotionSubmission({
    candidateRecord: incompleteRecord,
    store,
  });
  assert.equal(incompletePromo.accepted, false);
  assert.equal(incompletePromo.httpStatus, 422);

  // 2. Append valid record and verify Promotion API certifies it
  const acceptedPromo = evaluatePromotionSubmission({
    candidateRecord: passRecord,
    store,
  });
  assert.equal(acceptedPromo.accepted, true);
  assert.equal(acceptedPromo.httpStatus, 201);
  assert.ok(acceptedPromo.promotionId?.startsWith('prom_'));
  assert.equal(store.verifyChainIntegrity().valid, true);

  // 3. Stale-state decision blocks promotion cleanly via PG_stale_state (HTTP 409)
  const staleRecord = evaluatePgV4Gate({
    promotionRequestId: 'prom_req_stale_blocked',
    environment: 'staging',
    timestampUtc: '2026-11-17T12:05:00.000Z',
    walkForwardReport: passingWf,
    staleDecisionDetected: true,
    staleStateReason: 'Simulated stale decision with lagging DD view',
  });
  const staleConj = staleRecord.conjuncts.find((c) => c.conjunctId === 'PG_stale_state');
  assert.equal(staleConj?.status, 'FAIL');
  assert.equal(staleRecord.deploymentBlocked, true);
  assert.equal(staleRecord.promotionPermitted, false);
  const stalePromo = evaluatePromotionSubmission({ candidateRecord: staleRecord, store });
  assert.equal(stalePromo.accepted, false);
  assert.equal(stalePromo.httpStatus, 409);

  // 4. Verify immutability: update & delete MUST throw and leave record untouched
  const stored = store.getByRequestId('prom_req_valid_001');
  assert.ok(stored !== null);
  assert.equal(Object.isFrozen(stored), true);
  assert.equal(Object.isFrozen(stored.conjuncts), true);

  assert.throws(
    () => {
      (stored as { aggregateState: string }).aggregateState = 'FAIL';
    },
    (err: unknown) => err instanceof TypeError
  );
  assert.throws(
    () => store.update('prom_req_valid_001', { aggregateState: 'FAIL' }),
    (err: unknown) => err instanceof ImmutableGateRecordError && err.code === 'GATE_RECORD_UPDATE_FORBIDDEN'
  );
  assert.throws(
    () => store.delete('prom_req_valid_001'),
    (err: unknown) => err instanceof ImmutableGateRecordError && err.code === 'GATE_RECORD_DELETE_FORBIDDEN'
  );
  assert.throws(
    () => store.append(passRecord),
    (err: unknown) => err instanceof ImmutableGateRecordError && err.code === 'GATE_RECORD_UPDATE_FORBIDDEN'
  );

  // 5. Changing gate logic version invalidates older record for new promotions while preserving history
  const nextLogicHash = computePgV4LogicHash({ version: '4.2.0', changedThreshold: true });
  const staleVersionPromo = evaluatePromotionSubmission({
    candidateRecord: stored,
    store,
    currentLogicHash: nextLogicHash,
  });
  assert.equal(staleVersionPromo.accepted, false);
  assert.equal(staleVersionPromo.httpStatus, 422);
  assert.match(staleVersionPromo.reason, /Stale or mismatched gate logic/);
  assert.equal(store.getAll().length, 2);
  assert.equal(store.getByRequestId('prom_req_valid_001')?.pgLogicVersion, PG_V4_LOGIC_VERSION);
});

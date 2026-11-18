import assert from 'node:assert/strict';
import test from 'node:test';
import { generateDeterministicCandles } from './marketData';
import {
  CONSOLIDATED_SYSTEMIC_SCHEMA,
  PointInTimeStream,
  assertL0RuntimeDiscipline,
  buildTradeDecisionContract,
  createEnvironmentProfileContract,
  evaluateParityGate,
  runWalkForwardValidation,
  sanitizeAndAlignRuntimeState,
  simulateMultiLayeredFill,
  verifyZeroLookAheadLeakage,
} from './systemicLayers';

test('L0 Runtime Guard enforces strict class matching, API scope authorization, and Paper/Live isolation', () => {
  const paperContract = createEnvironmentProfileContract('PAPER');
  const liveContract = createEnvironmentProfileContract('LIVE', ['READ_MARKET', 'LIVE_SPOT_TRADE']);

  const validPaper = assertL0RuntimeDiscipline({
    activeContract: paperContract,
    requestedProfile: 'PAPER',
    credentialProfile: 'PAPER',
    market: 'SPOT',
    endpointUrl: 'paper://local-simulator/v1/order',
    stateNamespace: 'forge_state_paper',
  });
  assert.equal(validPaper.passed, true);

  // Cross-environment isolation failure: TESTNET credentials used inside LIVE contract
  const crossEnvBreach = assertL0RuntimeDiscipline({
    activeContract: liveContract,
    requestedProfile: 'LIVE',
    credentialProfile: 'TESTNET',
    market: 'SPOT',
    endpointUrl: 'https://api.binance.com/api/v3/order',
    stateNamespace: 'forge_state_live',
  });
  assert.equal(crossEnvBreach.passed, false);
  assert.ok(crossEnvBreach.violations.some((v) => v.includes('Cross-profile isolation')));

  // Missing LIVE_FUTURES_TRADE permission scope
  const missingScope = assertL0RuntimeDiscipline({
    activeContract: liveContract,
    requestedProfile: 'LIVE',
    credentialProfile: 'LIVE',
    market: 'USD_M_FUTURES',
    endpointUrl: 'https://fapi.binance.com/fapi/v1/order',
    stateNamespace: 'forge_state_live',
  });
  assert.equal(missingScope.passed, false);
  assert.ok(missingScope.violations.some((v) => v.includes('LIVE_FUTURES_TRADE')));

  // Endpoint mismatch: TESTNET endpoint passed to LIVE contract
  const wrongEndpoint = assertL0RuntimeDiscipline({
    activeContract: liveContract,
    requestedProfile: 'LIVE',
    credentialProfile: 'LIVE',
    market: 'SPOT',
    endpointUrl: 'https://testnet.binance.vision/api/v3/order',
  });
  assert.equal(wrongEndpoint.passed, false);
  assert.equal(wrongEndpoint.endpointMatched, false);

  // State bleed check
  const stateBleed = assertL0RuntimeDiscipline({
    activeContract: paperContract,
    requestedProfile: 'PAPER',
    credentialProfile: 'PAPER',
    market: 'SPOT',
    endpointUrl: 'paper://local-simulator/v1/order',
    stateNamespace: 'forge_state_live',
  });
  assert.equal(stateBleed.passed, false);
  assert.equal(stateBleed.stateIsolated, false);
});

test('L1 Data Layer enforces monotonic Point-in-Time cursors and zero future look-ahead leakage', () => {
  const candles = generateDeterministicCandles('BTCUSDT', '1h', 100);
  const stream = new PointInTimeStream(candles);

  stream.advanceTo(20);
  assert.equal(stream.cursorIndex, 20);
  assert.equal(stream.getClosedWindow().length, 21);

  assert.throws(
    () => stream.advanceTo(19),
    /Monotonic cursor violation/,
    'PointInTimeStream must throw on backward cursor access'
  );
  assert.throws(
    () => stream.advanceTo(20),
    /Monotonic cursor violation/,
    'PointInTimeStream must throw on duplicate cursor step'
  );

  // Non-monotonic timestamp series rejected on construction
  const corrupted = candles.map((c, idx) =>
    idx === 10 ? { ...c, time: candles[9].time } : c
  );
  assert.throws(
    () => new PointInTimeStream(corrupted),
    /Look-Ahead\/Ordering violation/,
    'Out-of-order bar timestamps must fail at L1 boundary'
  );

  // Mutating all future bars after index 55 must produce zero delta in dynamic indicators at 55
  const leakageCheck = verifyZeroLookAheadLeakage(candles, 55);
  assert.equal(leakageCheck.leakFree, true);
  assert.equal(
    leakageCheck.baselineIndicators.ema21,
    leakageCheck.perturbedIndicators.ema21
  );
  assert.equal(
    leakageCheck.baselineIndicators.atr14,
    leakageCheck.perturbedIndicators.atr14
  );
});

test('L2 Execution Engine separates Decision vs Execution contracts, models volume friction, and enforces Parity Gate halt', () => {
  const candles = generateDeterministicCandles('SOLUSDT', '15m', 90);
  const stream = new PointInTimeStream(candles);
  for (let i = 0; i <= 70; i++) stream.advanceTo(i);
  const indicators = stream.computeIndicatorsAtCursor();
  const closed = stream.getClosedWindow();

  const decision = buildTradeDecisionContract({
    symbol: 'SOLUSDT',
    timeframe: '15m',
    direction: 'BUY',
    closedCandles: closed,
    indicators,
  });
  assert.equal(decision.contractType, 'DECISION_CONTRACT');
  assert.equal(decision.rrGate.passed, true);

  const smallFill = simulateMultiLayeredFill({
    decision,
    environment: 'TESTNET',
    market: 'USD_M_FUTURES',
    notionalUsd: 1000,
    barVolumeUsd: 25_000_000,
  });
  const heavyImpactFill = simulateMultiLayeredFill({
    decision,
    environment: 'TESTNET',
    market: 'USD_M_FUTURES',
    notionalUsd: 250_000,
    barVolumeUsd: 400_000,
  });
  assert.equal(smallFill.contractType, 'EXECUTION_CONTRACT');
  assert.equal(smallFill.status, 'FILLED');
  assert.ok(
    heavyImpactFill.volumeImpactBps > smallFill.volumeImpactBps,
    'Larger notional vs bar liquidity must incur strictly higher volume impact friction'
  );
  assert.ok(heavyImpactFill.effectiveFillPrice > decision.decisionPrice);

  const parityOk = evaluateParityGate({
    backtestExpectedSlippageBps: 14.0,
    liveObservedSlippageBps: 21.0,
    backtestWinRatePct: 58.0,
    liveWinRatePct: 54.0,
    backtestExpectancyR: 1.4,
    liveExpectancyR: 1.25,
  });
  assert.equal(parityOk.passed, true);
  assert.equal(parityOk.status, 'ARMED');
  assert.equal(parityOk.liveDeploymentAllowed, true);

  const parityHalted = evaluateParityGate({
    backtestExpectedSlippageBps: 14.0,
    liveObservedSlippageBps: 78.0, // > 35bps tolerance
    backtestWinRatePct: 60.0,
    liveWinRatePct: 39.0, // > 12% tolerance
    backtestExpectancyR: 1.5,
    liveExpectancyR: 0.2,
  });
  assert.equal(parityHalted.passed, false);
  assert.equal(parityHalted.status, 'HALTED');
  assert.equal(parityHalted.liveDeploymentAllowed, false);
  assert.ok(parityHalted.breachAxes.includes('SLIPPAGE'));
  assert.ok(parityHalted.breachAxes.includes('WIN_RATE'));
  assert.ok(parityHalted.breachAxes.includes('EXPECTANCY'));
  assert.ok((parityHalted.haltReason || '').includes('HALTED'));
});

test('L3 Walk-Forward Validation runs chronological rolling OOS pairs with immutable frozen parameters', () => {
  const candles = generateDeterministicCandles('ETHUSDT', '1h', 320);
  const report = runWalkForwardValidation({
    candles,
    symbol: 'ETHUSDT',
    timeframe: '1h',
    inSampleBars: 75,
    outOfSampleBars: 45,
    maxFolds: 4,
  });

  assert.ok(report.foldCount >= 3, 'Expected at least 3 chronological rolling WFV pairs');
  for (let i = 0; i < report.folds.length; i++) {
    const fold = report.folds[i];
    assert.equal(fold.frozenParamHash, report.frozenParamHash);
    assert.equal(fold.paramsFrozenVerified, true);
    assert.ok(
      fold.outOfSampleRange.startBar > fold.inSampleRange.endBar,
      'OOS window must strictly follow In-Sample window chronologically'
    );
    if (i > 0) {
      assert.ok(
        fold.outOfSampleRange.startBar > report.folds[i - 1].outOfSampleRange.endBar - 1,
        'OOS rolling test folds must advance chronologically'
      );
    }
  }
  assert.equal(report.frozenParams.minRRRatio, 5.0);
  assert.equal(report.frozenParams.maxRiskPct, 2.0);
  assert.equal(report.frozenParams.scalingMinR, 3.0);
});

test('Systemic De-Duplication purges legacy directives, deduplicates items, and aligns exclusively to CONSOLIDATED_SYSTEMIC_SCHEMA', () => {
  assert.equal(CONSOLIDATED_SYSTEMIC_SCHEMA.schemaVersion, 'L0_L3_CONSOLIDATED_V1');
  assert.equal(CONSOLIDATED_SYSTEMIC_SCHEMA.legacyDirectivesPurged, true);
  assert.equal(CONSOLIDATED_SYSTEMIC_SCHEMA.invariants.minRRRatio, 5.0);
  assert.equal(CONSOLIDATED_SYSTEMIC_SCHEMA.invariants.maxRiskPct, 2.0);
  assert.equal(CONSOLIDATED_SYSTEMIC_SCHEMA.invariants.scalingMinRealizedR, 3.0);

  const aligned = sanitizeAndAlignRuntimeState({
    minRRRatio: 2.0, // Attempted legacy lower R:R -> clamped back to 5.0
    maxRiskPct: 5.0, // Attempted legacy 5% SL cap -> clamped back to 2.0
    scalingMinRealizedR: 1.5, // Attempted <3R scaling -> clamped back to 3.0
    legacyOverrides: ['LEGACY_5PCT_SL', 'LEGACY_PRECOMPUTED_EMA'],
    deprecatedFlags: { allowLookAhead: true, bypassRRGate: true },
    items: [
      { id: 'pos_1', label: 'BTC' },
      { id: 'pos_2', label: 'ETH' },
      { id: 'pos_1', label: 'BTC_DUP' },
    ],
  });

  assert.equal(aligned.minRRRatio, 5.0);
  assert.equal(aligned.maxRiskPct, 2.0);
  assert.equal(aligned.scalingMinRealizedR, 3.0);
  assert.equal(aligned.purgedLegacyCount, 4);
  assert.equal(aligned.deduplicatedItemCount, 1);
  assert.equal(aligned.items.length, 2);
});

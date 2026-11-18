import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  BINANCE_FUTURES_FEE_CONTRACT,
  BINANCE_SPOT_FEE_CONTRACT,
  DEFAULT_EXECUTION_ALGORITHM,
  DEFAULT_SLIPPAGE_CONFIG,
  EXECUTION_ALGORITHM_REGISTRY,
  FILL_MODEL_CONTRACT_SEMVER,
  FILL_MODEL_KERNEL_ARTIFACT,
  FILL_MODEL_KERNEL_ID,
  FillTimingViolationError,
  INITIAL_LEDGER_EXPOSURE,
  ORDERED_FILL_PHASES,
  VenueFeeRegistry,
  computeBaseSlippageBps,
  computeCrossHostFillDeterminismHash,
  computeLayeredSlippageBreakdown,
  computeSizeImpactSlippageBps,
  computeVenueOrderModifierBps,
  computeVolatilitySlippageBps,
  createImmutableOrderIntent,
  evaluateBacktestReplayFillParity,
  getExecutionAlgorithm,
  resolveSevenPhaseFill,
  verifyFillModelArtifactSignature,
} from './fillModel';
import { generateDeterministicCandles, type Candle } from './marketData';
import {
  BacktestFeed,
  ReplayFeed,
  type PITFeedView,
  type PITStrategy,
} from './pitFeed';
import { evaluateParityGate } from './systemicLayers';

const SAMPLE_BAR_NEXT: Candle = {
  time: 1700007300,
  open: 64210.5,
  high: 64590.25,
  low: 63980.75,
  close: 64440.1,
  volume: 120.5,
};

test('FillModel-Kernel artifact is signed, versioned, immutable, and defaults to Implementation Shortfall', () => {
  assert.equal(FILL_MODEL_KERNEL_ARTIFACT.kernelId, FILL_MODEL_KERNEL_ID);
  assert.equal(FILL_MODEL_KERNEL_ARTIFACT.contractSemver, FILL_MODEL_CONTRACT_SEMVER);
  assert.equal(FILL_MODEL_KERNEL_ARTIFACT.defaultExecutionAlgorithm, 'IMPLEMENTATION_SHORTFALL');
  assert.equal(DEFAULT_EXECUTION_ALGORITHM, 'IMPLEMENTATION_SHORTFALL');
  assert.equal(getExecutionAlgorithm().isDefault, true);
  assert.equal(getExecutionAlgorithm().algorithmId, 'IMPLEMENTATION_SHORTFALL');
  assert.equal(ORDERED_FILL_PHASES.length, 7);
  assert.deepEqual(ORDERED_FILL_PHASES, [
    'PHASE_1_ORDER_INTENT',
    'PHASE_2_TIMING_RESOLUTION',
    'PHASE_3_PRICE_RESOLUTION',
    'PHASE_4_SLIPPAGE_APPLICATION',
    'PHASE_5_FEE_APPLICATION',
    'PHASE_6_PARTIAL_FILL_MODEL',
    'PHASE_7_LEDGER_COMMIT',
  ]);
  assert.match(FILL_MODEL_KERNEL_ARTIFACT.fillModelHash, /^[0-9a-f]{64}$/);
  assert.equal(verifyFillModelArtifactSignature(), true);
});

test('Cross-host determinism test: produces bit-identical FillModel & audit hashes across V8 JIT, V8 --jitless, OS locales/timezones, and independent Python3 SHA-256', () => {
  const baseline = computeCrossHostFillDeterminismHash();
  assert.match(baseline.fillModelHash, /^[0-9a-f]{64}$/);
  assert.equal(baseline.vectorAuditHashes.length, 4);
  assert.match(baseline.combinedVectorDigest, /^[0-9a-f]{64}$/);

  const fillModelUrl = pathToFileURL(path.resolve(import.meta.dirname, 'fillModel.ts')).href;
  const probeScript =
    'import(process.argv[1]).then((m) => console.log(JSON.stringify(m.computeCrossHostFillDeterminismHash())));';

  const outUtcC = execFileSync(process.execPath, ['--import', 'tsx', '-e', probeScript, fillModelUrl], {
    cwd: process.cwd(),
    env: { ...process.env, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' },
    encoding: 'utf8',
  }).trim();

  const outDeNyJitless = execFileSync(
    process.execPath,
    ['--jitless', '--import', 'tsx', '-e', probeScript, fillModelUrl],
    {
      cwd: process.cwd(),
      env: { ...process.env, LC_ALL: 'de_DE.UTF-8', LANG: 'de_DE.UTF-8', TZ: 'America/New_York' },
      encoding: 'utf8',
    }
  ).trim();

  const parsedUtcC = JSON.parse(outUtcC) as ReturnType<typeof computeCrossHostFillDeterminismHash>;
  const parsedDeNyJitless = JSON.parse(outDeNyJitless) as ReturnType<
    typeof computeCrossHostFillDeterminismHash
  >;

  assert.equal(parsedUtcC.fillModelHash, baseline.fillModelHash);
  assert.equal(parsedDeNyJitless.fillModelHash, baseline.fillModelHash);
  assert.equal(parsedUtcC.combinedVectorDigest, baseline.combinedVectorDigest);
  assert.equal(parsedDeNyJitless.combinedVectorDigest, baseline.combinedVectorDigest);
  assert.deepEqual(parsedUtcC.vectorAuditHashes, baseline.vectorAuditHashes);
  assert.deepEqual(parsedDeNyJitless.vectorAuditHashes, baseline.vectorAuditHashes);

  // Clean-room independent Python3 hashlib.sha256 verification of the signed FillModel canonical spec
  const canonicalSpec = JSON.stringify({
    adverseSlippageOnly: true,
    contractSemver: '1.0.0',
    crossedLimitTakerRule: true,
    defaultExecutionAlgorithm: 'IMPLEMENTATION_SHORTFALL',
    executionAlgorithms: ['TWAP', 'VWAP', 'POV', 'IMPLEMENTATION_SHORTFALL', 'SWEEP'],
    feeComputedOn: 'EXECUTED_NOTIONAL_BY_RESOLVED_BEHAVIOR',
    kernelId: 'FillModel-Kernel',
    layer: 'L2',
    nextBarFillDefault: true,
    orderedPhases: [
      'PHASE_1_ORDER_INTENT',
      'PHASE_2_TIMING_RESOLUTION',
      'PHASE_3_PRICE_RESOLUTION',
      'PHASE_4_SLIPPAGE_APPLICATION',
      'PHASE_5_FEE_APPLICATION',
      'PHASE_6_PARTIAL_FILL_MODEL',
      'PHASE_7_LEDGER_COMMIT',
    ],
    partialFillFormula: 'min(1, (bar_volume * participation_cap) / requested_qty)',
    slippageContributors: ['BASE_BPS', 'VOLATILITY_SCALING', 'SIZE_SCALING', 'VENUE_ORDER_MODIFIER'],
  });

  const pySha = execFileSync(
    'python3',
    ['-c', 'import hashlib, sys; print(hashlib.sha256(sys.argv[1].encode("utf-8")).hexdigest())', canonicalSpec],
    { encoding: 'utf8' }
  ).trim();

  assert.equal(pySha, baseline.fillModelHash);
});

test('Slippage directionality & contributor test: every fill moves strictly adverse across BUY/SELL and all 4 contributors work independently', () => {
  const baseBps = computeBaseSlippageBps(DEFAULT_SLIPPAGE_CONFIG);
  const lowVolBps = computeVolatilitySlippageBps(0.4, DEFAULT_SLIPPAGE_CONFIG);
  const highVolBps = computeVolatilitySlippageBps(4.5, DEFAULT_SLIPPAGE_CONFIG);
  const smallSizeBps = computeSizeImpactSlippageBps(0.1, 1000, DEFAULT_SLIPPAGE_CONFIG);
  const largeSizeBps = computeSizeImpactSlippageBps(40, 1000, DEFAULT_SLIPPAGE_CONFIG);
  const spotMod = computeVenueOrderModifierBps({
    venue: 'BINANCE_SPOT',
    orderType: 'MARKET',
    resolvedBehavior: 'TAKER',
  });
  const futMod = computeVenueOrderModifierBps({
    venue: 'BINANCE_USD_M_FUTURES',
    orderType: 'MARKET',
    resolvedBehavior: 'TAKER',
  });

  assert.ok(baseBps > 0);
  assert.ok(highVolBps > lowVolBps);
  assert.ok(largeSizeBps > smallSizeBps);
  assert.ok(spotMod > futMod);

  const combined = computeLayeredSlippageBreakdown({
    side: 'BUY',
    venue: 'BINANCE_SPOT',
    orderType: 'MARKET',
    resolvedBehavior: 'TAKER',
    barRangePct: 1.5,
    requestedQty: 2,
    barVolume: 100,
  });
  assert.ok(combined.totalSlippageBps > baseBps);
  assert.equal(combined.adverseDirection, 'UP_FOR_BUY');

  // Assert adverse price movement for every order type & both directions
  const scenarios: Array<{
    side: 'BUY' | 'SELL';
    orderType: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'STOP_LIMIT';
    limitPrice?: number;
    stopTriggerPrice?: number;
  }> = [
    { side: 'BUY', orderType: 'MARKET' },
    { side: 'SELL', orderType: 'MARKET' },
    { side: 'BUY', orderType: 'LIMIT', limitPrice: SAMPLE_BAR_NEXT.open + 50 },
    { side: 'BUY', orderType: 'LIMIT', limitPrice: SAMPLE_BAR_NEXT.open - 80 },
    { side: 'SELL', orderType: 'LIMIT', limitPrice: SAMPLE_BAR_NEXT.open - 50 },
    { side: 'SELL', orderType: 'LIMIT', limitPrice: SAMPLE_BAR_NEXT.open + 80 },
    { side: 'BUY', orderType: 'STOP_MARKET', stopTriggerPrice: SAMPLE_BAR_NEXT.open + 90 },
    { side: 'SELL', orderType: 'STOP_MARKET', stopTriggerPrice: SAMPLE_BAR_NEXT.open - 90 },
    {
      side: 'BUY',
      orderType: 'STOP_LIMIT',
      stopTriggerPrice: SAMPLE_BAR_NEXT.open + 60,
      limitPrice: SAMPLE_BAR_NEXT.open + 120,
    },
  ];

  for (const s of scenarios) {
    const res = resolveSevenPhaseFill({
      orderIntent: {
        intentId: `dir_${s.side}_${s.orderType}_${s.limitPrice ?? 'none'}`,
        strategyId: 'SLIP_DIR_TEST',
        symbol: 'BTCUSDT',
        side: s.side,
        orderType: s.orderType,
        timeInForce: 'GTC',
        requestedQty: 0.5,
        limitPrice: s.limitPrice,
        stopTriggerPrice: s.stopTriggerPrice,
        signalCursorIndex: 5,
        signalCursorTime: SAMPLE_BAR_NEXT.time - 900,
        signalReferencePrice: 64200,
      },
      executionCursorIndex: 6,
      executionBar: SAMPLE_BAR_NEXT,
    });

    assert.equal(res.audit.status, 'FILLED');
    assert.equal(res.audit.priceResolution.adverseSlippageVerified, true);
    if (s.side === 'BUY') {
      assert.ok(
        res.audit.priceResolution.effectiveFillPrice >
          res.audit.priceResolution.resolvedReferencePrice,
        'BUY fill slippage must strictly push fill price ABOVE resolved reference'
      );
    } else {
      assert.ok(
        res.audit.priceResolution.effectiveFillPrice <
          res.audit.priceResolution.resolvedReferencePrice,
        'SELL fill slippage must strictly push fill price BELOW resolved reference'
      );
    }
  }
});

test('Partial-fill bounds test: large order in low-volume bar fills fractionally and enforces GTC, IOC, and FOK', () => {
  const lowVolBar: Candle = {
    time: 1700008200,
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    volume: 500,
  };
  // max fillable = 500 * 0.025 = 12.5 out of requested 100 -> fillFraction = 0.125

  const baseIntent = {
    strategyId: 'PARTIAL_TEST',
    symbol: 'SOLUSDT',
    side: 'BUY' as const,
    orderType: 'MARKET' as const,
    requestedQty: 100,
    signalCursorIndex: 10,
    signalCursorTime: lowVolBar.time - 900,
    signalReferencePrice: 100,
    participationCap: 0.025,
  };

  // 1. GTC -> partial fill + persistent remainder working order
  const gtcRes = resolveSevenPhaseFill({
    orderIntent: { ...baseIntent, intentId: 'partial_gtc', timeInForce: 'GTC' },
    executionCursorIndex: 11,
    executionBar: lowVolBar,
  });
  assert.equal(gtcRes.audit.status, 'PARTIALLY_FILLED');
  assert.equal(gtcRes.audit.partialFillDetail.executedQty, 12.5);
  assert.equal(gtcRes.audit.partialFillDetail.fillFraction, 0.125);
  assert.equal(gtcRes.audit.partialFillDetail.workingRemainderQty, 87.5);
  assert.equal(gtcRes.audit.partialFillDetail.remainderAction, 'PERSIST_GTC');
  assert.ok(gtcRes.workingOrder !== null && gtcRes.workingOrder.remainingQty === 87.5);
  assert.equal(gtcRes.nextLedger.netPositionQty, 12.5);
  assert.equal(gtcRes.nextLedger.sequenceNumber, 1);

  // 2. IOC -> partial fill + remainder cancelled immediately
  const iocRes = resolveSevenPhaseFill({
    orderIntent: { ...baseIntent, intentId: 'partial_ioc', timeInForce: 'IOC' },
    executionCursorIndex: 11,
    executionBar: lowVolBar,
  });
  assert.equal(iocRes.audit.status, 'PARTIALLY_FILLED');
  assert.equal(iocRes.audit.partialFillDetail.executedQty, 12.5);
  assert.equal(iocRes.audit.partialFillDetail.cancelledRemainderQty, 87.5);
  assert.equal(iocRes.audit.partialFillDetail.remainderAction, 'CANCELLED_IOC');
  assert.equal(iocRes.workingOrder, null);
  assert.equal(iocRes.nextLedger.netPositionQty, 12.5);

  // 3. FOK -> full order killed, ZERO executed, ZERO fee, ledger exposure UNMUTATED
  const fokRes = resolveSevenPhaseFill({
    orderIntent: { ...baseIntent, intentId: 'partial_fok', timeInForce: 'FOK' },
    executionCursorIndex: 11,
    executionBar: lowVolBar,
    priorLedger: INITIAL_LEDGER_EXPOSURE,
  });
  assert.equal(fokRes.audit.status, 'CANCELLED_TIF');
  assert.equal(fokRes.audit.partialFillDetail.executedQty, 0);
  assert.equal(fokRes.audit.feeDetail.executedNotionalUsd, 0);
  assert.equal(fokRes.audit.feeDetail.feeUsd, 0);
  assert.equal(fokRes.audit.partialFillDetail.remainderAction, 'CANCELLED_FOK');
  assert.equal(fokRes.audit.ledgerCommit.committed, false);
  assert.equal(fokRes.nextLedger.sequenceNumber, 0);
  assert.equal(fokRes.nextLedger.netPositionQty, 0);
});

test('Fee resolution test: limit order that crosses is charged TAKER fee (not declared MAKER) on executed notional only', () => {
  // BUY LIMIT above opening ask with declaredRole: 'MAKER' -> must resolve as TAKER
  const crossedLimitRes = resolveSevenPhaseFill({
    orderIntent: {
      intentId: 'fee_crossed_limit',
      strategyId: 'FEE_TEST',
      symbol: 'BTCUSDT',
      venue: 'BINANCE_USD_M_FUTURES',
      feeTier: 'VIP0',
      side: 'BUY',
      orderType: 'LIMIT',
      declaredRole: 'MAKER',
      timeInForce: 'IOC',
      requestedQty: 10,
      limitPrice: SAMPLE_BAR_NEXT.open + 100,
      signalCursorIndex: 20,
      signalCursorTime: SAMPLE_BAR_NEXT.time - 900,
      signalReferencePrice: 64200,
      participationCap: 0.025, // 120.5 * 0.025 = 3.0125 qty fills
    },
    executionCursorIndex: 21,
    executionBar: SAMPLE_BAR_NEXT,
  });

  assert.equal(crossedLimitRes.audit.declaredRole, 'MAKER');
  assert.equal(crossedLimitRes.audit.resolvedBehavior, 'TAKER');
  assert.equal(crossedLimitRes.audit.crossedLimitAsTaker, true);
  assert.equal(crossedLimitRes.audit.resolverId, 'RESOLVER_LIMIT_CROSS_TAKER');
  assert.equal(
    crossedLimitRes.audit.feeDetail.appliedFeeBps,
    BINANCE_FUTURES_FEE_CONTRACT.tiers.VIP0.takerFeeBps
  );
  // Fee must equal executedNotionalUsd * 5bps / 10000 (never requestedQty 10!)
  const expectedNotional =
    crossedLimitRes.audit.partialFillDetail.executedQty *
    crossedLimitRes.audit.priceResolution.effectiveFillPrice;
  assert.ok(Math.abs(crossedLimitRes.audit.feeDetail.executedNotionalUsd - expectedNotional) < 0.01);
  assert.ok(
    Math.abs(
      crossedLimitRes.audit.feeDetail.feeUsd -
        (crossedLimitRes.audit.feeDetail.executedNotionalUsd * 5) / 10_000
    ) < 0.001
  );

  // Passive resting limit that touches bar low without crossing open -> MAKER fee
  const passiveLimitRes = resolveSevenPhaseFill({
    orderIntent: {
      intentId: 'fee_passive_limit',
      strategyId: 'FEE_TEST',
      symbol: 'BTCUSDT',
      venue: 'BINANCE_SPOT',
      feeTier: 'VIP2',
      side: 'BUY',
      orderType: 'LIMIT',
      declaredRole: 'MAKER',
      timeInForce: 'GTC',
      requestedQty: 0.5,
      limitPrice: SAMPLE_BAR_NEXT.low + 25,
      signalCursorIndex: 20,
      signalCursorTime: SAMPLE_BAR_NEXT.time - 900,
      signalReferencePrice: 64200,
    },
    executionCursorIndex: 21,
    executionBar: SAMPLE_BAR_NEXT,
  });

  assert.equal(passiveLimitRes.audit.resolvedBehavior, 'MAKER');
  assert.equal(passiveLimitRes.audit.crossedLimitAsTaker, false);
  assert.equal(passiveLimitRes.audit.resolverId, 'RESOLVER_LIMIT_PASSIVE_MAKER');
  assert.equal(
    passiveLimitRes.audit.feeDetail.appliedFeeBps,
    BINANCE_SPOT_FEE_CONTRACT.tiers.VIP2.makerFeeBps
  );

  // Venue-pluggable registry check
  const registry = new VenueFeeRegistry();
  registry.registerVenue({
    venueId: 'CUSTOM_INSTITUTIONAL_EXCHANGE',
    description: 'Zero maker rebate schedule',
    tiers: { VIP0: { makerFeeBps: 0.5, takerFeeBps: 3.5 } },
  });
  const customFee = registry.resolveFeeRate({
    venue: 'CUSTOM_INSTITUTIONAL_EXCHANGE',
    tier: 'VIP0',
    resolvedBehavior: 'TAKER',
  });
  assert.equal(customFee.appliedFeeBps, 3.5);
});

test('PIT fill timing test: same-cursor or earlier fill attempt raises FillTimingViolationError', () => {
  const intent = createImmutableOrderIntent({
    intentId: 'same_cursor_probe',
    strategyId: 'PIT_TIMING_PROBE',
    symbol: 'BTCUSDT',
    side: 'BUY',
    requestedQty: 0.25,
    signalCursorIndex: 42,
    signalCursorTime: SAMPLE_BAR_NEXT.time - 900,
    signalReferencePrice: 64200,
  });

  assert.throws(
    () =>
      resolveSevenPhaseFill({
        orderIntent: intent,
        executionCursorIndex: 42,
        executionBar: SAMPLE_BAR_NEXT,
      }),
    (err: unknown) =>
      err instanceof FillTimingViolationError && err.code === 'SAME_BAR_FILL_FORBIDDEN'
  );

  const nextBarOk = resolveSevenPhaseFill({
    orderIntent: intent,
    executionCursorIndex: 43,
    executionBar: SAMPLE_BAR_NEXT,
  });
  assert.equal(nextBarOk.audit.timing.signalCursorIndex, 42);
  assert.equal(nextBarOk.audit.timing.fillCursorIndex, 43);
  assert.equal(nextBarOk.audit.timing.fillBarLag, 1);
});

test('Execution algorithm registry test: TWAP, VWAP, POV, Implementation Shortfall (default), and Sweep conserve quantity and embed fillModelHash', () => {
  const closedHistory = generateDeterministicCandles('BTCUSDT', '15m', 20);
  const algoIds = ['TWAP', 'VWAP', 'POV', 'IMPLEMENTATION_SHORTFALL', 'SWEEP'] as const;

  for (const id of algoIds) {
    const algo = EXECUTION_ALGORITHM_REGISTRY[id];
    const plan = algo.planChildSlices({
      parentOrderId: `parent_${id}`,
      strategyId: 'ALGO_TEST',
      symbol: 'BTCUSDT',
      side: 'BUY',
      totalQty: 2.4,
      signalCursorIndex: 19,
      signalCursorTime: closedHistory[19].time,
      signalReferencePrice: closedHistory[19].close,
      closedHistory,
      horizonBars: 4,
      participationCap: 0.04,
      urgency: 0.8,
    });

    assert.equal(plan.algorithmId, id);
    assert.equal(plan.fillModelHash, FILL_MODEL_KERNEL_ARTIFACT.fillModelHash);
    const totalPlanned = plan.slices.reduce((sum, s) => sum + s.targetQty, 0);
    assert.ok(
      Math.abs(totalPlanned - 2.4) < 1e-6,
      `${id} child slices must conserve parent quantity`
    );

    if (id === 'IMPLEMENTATION_SHORTFALL') {
      assert.equal(algo.isDefault, true);
      // Front-loaded urgency: slice 0 > slice 1
      assert.ok(plan.slices[0].targetQty > plan.slices[1].targetQty);
    } else {
      assert.equal(algo.isDefault, false);
    }

    if (id === 'TWAP') {
      assert.ok(Math.abs(plan.slices[0].targetQty - plan.slices[1].targetQty) < 1e-6);
    }
    if (id === 'SWEEP') {
      assert.equal(plan.slices.length, 1);
      assert.equal(plan.slices[0].timeInForce, 'IOC');
    }
  }
});

test('Backtest <-> Replay parity test: identical Implementation Shortfall fills achieve 100% hash equivalence & promotion approval; hash mismatch halts Parity Gate', () => {
  const candles = generateDeterministicCandles('ETHUSDT', '15m', 80);
  const warmupBars = 20;

  const strategy: PITStrategy = {
    strategyId: 'PARITY_CROSS_CHECK',
    warmupBars,
    evaluate(view: PITFeedView) {
      const f = view.computeFeatures(40);
      const bar = view.current();
      if (!bar) return null;
      if (view.cursorIndex() % 9 === 0) {
        return {
          direction: f.ema9 >= f.ema21 ? 'BUY' : 'SELL',
          stopLossDistance: Math.max(bar.close * 0.008, f.atr14 * 1.4),
          stopLossPct: 1.25,
          targetRR: 5.0,
          trailingAtrMult: 2.0,
          confidence: 83,
          setupLabel: 'PARITY_PROBE',
        };
      }
      return null;
    },
  };

  const backtestFeed = new BacktestFeed(candles, {
    symbol: 'ETHUSDT',
    timeframe: '15m',
    warmupBars,
  });
  const replayFeed = new ReplayFeed(
    candles.flatMap((c) => [
      { candle: { ...c, close: Number((c.open * 1.002).toPrecision(6)) }, isClosed: false },
      { candle: c, isClosed: true },
    ]),
    {
      symbol: 'ETHUSDT',
      timeframe: '15m',
      warmupBars,
    }
  );

  const parity = evaluateBacktestReplayFillParity({
    backtestFeed,
    replayFeed,
    strategy,
    venue: 'BINANCE_SPOT',
    feeTier: 'VIP0',
  });

  assert.equal(parity.fillModelHash, FILL_MODEL_KERNEL_ARTIFACT.fillModelHash);
  assert.equal(parity.fillModelSignatureVerified, true);
  assert.equal(parity.executionAlgorithm, 'IMPLEMENTATION_SHORTFALL');
  assert.equal(parity.fillCountMatch, true);
  assert.ok(parity.backtestFillCount >= 5);
  assert.equal(parity.exactAuditHashMatchCount, parity.backtestFillCount);
  assert.equal(parity.maxPriceDivergenceBps, 0);
  assert.equal(parity.maxFeeDivergenceUsd, 0);
  assert.equal(parity.promotionApproved, true);
  assert.equal(parity.haltReason, null);

  // Verify L2 Parity Gate promotes clean fills and halts on FillModel hash drift
  const promotedGate = evaluateParityGate({
    backtestExpectedSlippageBps: 12.0,
    liveObservedSlippageBps: 13.0,
    backtestWinRatePct: 55,
    liveWinRatePct: 54,
    backtestExpectancyR: 1.3,
    liveExpectancyR: 1.25,
    fillModelHash: parity.fillModelHash,
    fillEquivalenceApproved: parity.promotionApproved,
    fillPriceDivergenceBps: parity.maxPriceDivergenceBps,
  });
  assert.equal(promotedGate.passed, true);
  assert.equal(promotedGate.fillEquivalenceApproved, true);

  const haltedOnDrift = evaluateParityGate({
    backtestExpectedSlippageBps: 12.0,
    liveObservedSlippageBps: 12.0,
    backtestWinRatePct: 55,
    liveWinRatePct: 55,
    backtestExpectancyR: 1.3,
    liveExpectancyR: 1.3,
    fillModelHash: 'deadbeef'.repeat(8),
    fillEquivalenceApproved: true,
  });
  assert.equal(haltedOnDrift.passed, false);
  assert.equal(haltedOnDrift.status, 'HALTED');
  assert.ok(haltedOnDrift.breachAxes.includes('FILL_EQUIVALENCE'));
});

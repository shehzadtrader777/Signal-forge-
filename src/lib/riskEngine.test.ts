import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  runBacktestSimulation,
  runComparativeProtocolSuite,
  runSmcMonthlySimulation,
} from './backtest';
import {
  DEFAULT_GITOPS_POLICY,
  KERNEL_REGISTRY,
  bindPolicyToKernels,
  type GitOpsPolicyDocument,
} from './bindingLayer';
import {
  INITIAL_LEDGER_EXPOSURE,
  createImmutableOrderIntent,
  evaluateBacktestReplayFillParity,
  executeSignalBoundaryThroughFillKernel,
  resolveSevenPhaseFill,
} from './fillModel';
import {
  createInitialForgeCapitalHubState,
  routeDualExecutionOrder,
} from './forgeCapitalHub';
import { generateDeterministicCandles } from './marketData';
import {
  BacktestFeed,
  ReplayFeed,
  TripwireFeed,
  createSignalToFillBoundary,
  issueEngineLoopToken,
  type PITStrategy,
} from './pitFeed';
import {
  MIN_RR_KERNEL_CONSTANT,
  ORDERED_DRAWDOWN_LEVELS,
  ORDERED_RR_CHECK_STAGES,
  RISK_ENGINE_DD_LIMITS,
  RR_REJECTION_TAXONOMY,
  RiskEngineOrderBlockedError,
  assertOrderIntentPermittedOrThrow,
  can_trade,
  checkRROrderIntent,
  checkRRRiskGate,
  checkRRSignalEmission,
  createInitialRiskEngineState,
  deriveStructuralLevelsFromClosedWindow,
  evaluateDrawdownHierarchy,
  evaluateThreeStageRRGate,
  recordTradeOutcomeInRiskState,
  roundTargetPreservingFloor,
} from './riskEngine';
import { runWalkForwardOrchestration } from './walkForwardOrchestrator';

/* ── 1. Compliance Test: 100% planned_RR >= 5 across Backtest, Replay & Paper ─ */

test('Compliance Test: 100% of executed orders enforce planned_RR >= 5 across backtest, replay, walk-forward, and paper', () => {
  const btcSmc = runSmcMonthlySimulation('BTCUSDT', '15m');
  const btcPat = runBacktestSimulation('BTCUSDT', '4h', undefined, 'PATTERN_SCANNER');
  const btcTech = runBacktestSimulation('BTCUSDT', '4h', undefined, 'TECHNICAL');
  const compReport = runComparativeProtocolSuite({
    symbol: 'BTCUSDT',
    timeframe: '15m',
    strategy: 'AUTONOMOUS_MASTER',
  });

  const allBacktestTrades = [
    ...btcSmc.trades,
    ...btcPat.trades,
    ...btcTech.trades,
    ...compReport.windows.flatMap((w) => w.trades),
  ];

  assert.ok(allBacktestTrades.length > 1000, 'Expected substantial cross-strategy backtest trades');

  let minObservedPlannedRR = Number.POSITIVE_INFINITY;
  for (const t of allBacktestTrades) {
    const risk = Math.abs(t.entryPrice - t.stopLoss);
    const reward = Math.abs(t.takeProfit - t.entryPrice);
    const plannedRR = risk > 1e-12 ? reward / risk : 0;
    if (plannedRR < minObservedPlannedRR) {
      minObservedPlannedRR = plannedRR;
    }
    assert.ok(
      plannedRR >= MIN_RR_KERNEL_CONSTANT - 1e-6,
      `Trade ${t.id} (${t.strategy}) breached 1:5 floor: planned_RR=${plannedRR}`
    );
    assert.ok(
      t.riskRewardRatio >= MIN_RR_KERNEL_CONSTANT,
      `Trade ${t.id} summary R:R ${t.riskRewardRatio} < ${MIN_RR_KERNEL_CONSTANT}`
    );
  }
  assert.ok(minObservedPlannedRR >= MIN_RR_KERNEL_CONSTANT - 1e-6);

  // ReplayFeed vs BacktestFeed parity check with 1:5 kernel enforcement
  const parityCandles = generateDeterministicCandles('ETHUSDT', '15m', 90);
  const sharedStrategy: PITStrategy = {
    strategyId: 'RISK_COMPLIANCE_PARITY',
    warmupBars: 25,
    evaluate(view) {
      if (view.cursorIndex() % 10 !== 0) return null;
      const bar = view.current();
      if (!bar) return null;
      const slDist = bar.close * 0.01;
      const sl = Number((bar.close - slDist).toPrecision(6));
      const tp = roundTargetPreservingFloor('BUY', bar.close, sl, bar.close + slDist * 5.2, 5.0);
      return {
        direction: 'BUY',
        stopLossDistance: slDist,
        stopLossPct: 1.0,
        targetRR: 5.0,
        trailingAtrMult: 1.5,
        confidence: 85,
        setupLabel: 'PARITY_1_5_STRUCTURAL',
        snapshotWindowSize: 10,
        stopLossPrice: sl,
        liquidityTargetPrice: tp,
        stopOrigin: 'STRUCTURAL_INVALIDATION',
        targetOrigin: 'STRUCTURAL_LIQUIDITY_POOL',
      };
    },
  };
  const parityReport = evaluateBacktestReplayFillParity({
    backtestFeed: new BacktestFeed(parityCandles, { symbol: 'ETHUSDT', timeframe: '15m', warmupBars: 25 }),
    replayFeed: new ReplayFeed(parityCandles, { symbol: 'ETHUSDT', timeframe: '15m', warmupBars: 25 }),
    strategy: sharedStrategy,
    venue: 'BINANCE_SPOT',
  });
  assert.equal(parityReport.promotionApproved, true);
  assert.ok(parityReport.matchedFillCount >= 4);

  // Walk-Forward Orchestration compliance (zero RR leaks across all folds)
  const wfv = runWalkForwardOrchestration({
    symbol: 'BTCUSDT',
    timeframe: '15m',
    inSampleBars: 85,
    outOfSampleBars: 45,
    maxFolds: 3,
  });
  assert.equal(wfv.riskConstantsLocked.minRRRatio, 5);
  for (const fold of wfv.folds) {
    assert.equal(fold.inSample.rrRejectedLeaks, 0);
    assert.equal(fold.outOfSample.rrRejectedLeaks, 0);
  }

  // Paper L2 Dual Execution Router blocks sub-5R & admits valid 1:5
  const hubState = createInitialForgeCapitalHubState({ initialEquityUsd: 25_000 });
  const paperValid = routeDualExecutionOrder(hubState, {
    moduleId: 'SMC_FRVP_DESK',
    market: 'SPOT',
    environment: 'TESTNET',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    notionalUsd: 1000,
    submittedPrice: 65000,
    authoritativePrice: 65000,
    stopLoss: 64350, // 1% risk = 650
    takeProfit: 68250, // 5% target = 3250 => exact 1:5
    stopOrigin: 'STRUCTURAL_INVALIDATION',
    targetOrigin: 'STRUCTURAL_LIQUIDITY_POOL',
    enforceRRGate: true,
  });
  assert.equal(paperValid.ok, true);
  assert.equal(paperValid.statusCode, 200);
  assert.equal(paperValid.riskVerdict?.allowed, true);
  assert.ok((paperValid.riskVerdict?.plannedRR ?? 0) >= 5.0);

  const paperSub5 = routeDualExecutionOrder(hubState, {
    moduleId: 'SMC_FRVP_DESK',
    market: 'SPOT',
    environment: 'TESTNET',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    notionalUsd: 1000,
    submittedPrice: 65000,
    authoritativePrice: 65000,
    stopLoss: 64350,
    takeProfit: 66950, // 3:1 < 5:1 -> MUST FAIL BEFORE L2
    stopOrigin: 'STRUCTURAL_INVALIDATION',
    targetOrigin: 'STRUCTURAL_LIQUIDITY_POOL',
    enforceRRGate: true,
  });
  assert.equal(paperSub5.ok, false);
  assert.equal(paperSub5.statusCode, 422);
  assert.equal(paperSub5.rejectionCode, 'RR_REJECT_SIGNAL');
});

test('Compliance Test: L2 FillModel Kernel synchronously rejects sub-1:5 order intents & boundaries', () => {
  assert.throws(
    () =>
      createImmutableOrderIntent({
        intentId: 'sub_5r_intent',
        strategyId: 'SMC_1_5',
        symbol: 'BTCUSDT',
        venue: 'BINANCE_SPOT',
        feeTier: 'VIP0',
        side: 'BUY',
        orderType: 'MARKET',
        timeInForce: 'GTC',
        requestedQty: 0.2,
        signalCursorIndex: 10,
        signalCursorTime: 1700000000,
        signalReferencePrice: 65000,
        stopLoss: 64350,
        takeProfit: 66500, // 2.31 R:R -> blocked
      }),
    RiskEngineOrderBlockedError
  );

  // Direct resolveSevenPhaseFill bypass attempt with passing intent + violated CanTradeRequest
  const riskState = createInitialRiskEngineState({ initialCapitalUsd: 25_000, strategyIds: ['SMC_1_5'] });
  const validIntent = createImmutableOrderIntent({
    intentId: 'valid_then_halted_intent',
    strategyId: 'SMC_1_5',
    symbol: 'BTCUSDT',
    venue: 'BINANCE_SPOT',
    feeTier: 'VIP0',
    side: 'BUY',
    orderType: 'MARKET',
    timeInForce: 'GTC',
    requestedQty: 0.1,
    signalCursorIndex: 10,
    signalCursorTime: 1700000000,
    signalReferencePrice: 65000,
    stopLoss: 64350,
    takeProfit: 68250,
  });

  // Trip 6 consecutive losses on SMC_1_5 so riskState halts
  let haltedState = riskState;
  for (let i = 0; i < 6; i += 1) {
    haltedState = recordTradeOutcomeInRiskState(haltedState, {
      strategyId: 'SMC_1_5',
      regime: 'NORMAL',
      pnlPct: -0.2,
    });
  }

  assert.throws(
    () =>
      resolveSevenPhaseFill({
        orderIntent: validIntent,
        executionCursorIndex: 11,
        executionBar: {
          time: 1700000900,
          open: 65010,
          high: 65200,
          low: 64900,
          close: 65100,
          volume: 500,
        },
        priorLedger: INITIAL_LEDGER_EXPOSURE,
        canTradeRequest: {
          riskState: haltedState,
          strategyId: 'SMC_1_5',
          symbol: 'BTCUSDT',
          direction: 'BUY',
          signalEntryPrice: 65000,
          orderIntentPrice: 65010,
          stopLoss: 64350,
          takeProfit: 68250,
        },
      }),
    RiskEngineOrderBlockedError
  );

  // PITFeed SignalToFillBoundary creation also blocks targetRR < 5 at signal_emission
  const candles = generateDeterministicCandles('BTCUSDT', '15m', 40);
  const feed = new TripwireFeed(new BacktestFeed(candles, { symbol: 'BTCUSDT', timeframe: '15m', warmupBars: 20 }));
  const tok = issueEngineLoopToken('boundary_rr_check');
  for (let i = 0; i <= 22; i += 1) {
    feed.advance(tok);
  }
  const view = feed.asConsumerView();
  assert.throws(
    () =>
      createSignalToFillBoundary({
        signalId: 'bad_boundary_rr',
        strategyId: 'SMC_1_5',
        feedView: view,
        emission: {
          direction: 'BUY',
          stopLossDistance: 500,
          stopLossPct: 0.8,
          targetRR: 3.5,
          trailingAtrMult: 1.5,
          confidence: 80,
          setupLabel: 'SUB_5R',
        },
      }),
    (err: unknown) =>
      err instanceof RiskEngineOrderBlockedError &&
      err.code === 'RR_REJECT_SIGNAL' &&
      err.stage === 'signal_emission'
  );
  // Also test executeSignalBoundaryThroughFillKernel against missing stop origin on boundary
  const goodBar = view.current()!;
  const boundary = createSignalToFillBoundary({
    signalId: 'good_boundary',
    strategyId: 'SMC_1_5',
    feedView: view,
    emission: {
      direction: 'BUY',
      stopLossDistance: goodBar.close * 0.01,
      stopLossPct: 1.0,
      targetRR: 5.0,
      trailingAtrMult: 1.5,
      confidence: 85,
      setupLabel: 'VALID_1_5',
    },
  });
  feed.advance(tok);
  feed.verifyAndRecordTPlusOneFill(boundary);
  const fillRes = executeSignalBoundaryThroughFillKernel({
    boundary,
    feedAtExecutionCursor: feed.asConsumerView(),
    priorLedger: INITIAL_LEDGER_EXPOSURE,
  });
  assert.equal(fillRes.intent.plannedRR, 5.0);
});

/* ── 2. Placement Test: signal_emission vs order_intent + No Post-Hoc Tightening ─ */

test('Placement Test: compute ONCE at signal_emission and validate forward through risk_gate -> order_intent with 7-code taxonomy', () => {
  assert.deepEqual([...ORDERED_RR_CHECK_STAGES], [
    'signal_emission',
    'risk_gate',
    'order_intent',
  ]);
  assert.deepEqual([...RR_REJECTION_TAXONOMY], [
    'RR_REJECT_SIGNAL',
    'RR_REJECT_PRICE_DRIFT',
    'RR_REJECT_STALE_PRICE',
    'DD_BLOCK',
    'EXPOSURE_BLOCK',
    'MANDATE_BLOCK',
    'INTEGRITY_FAILURE',
  ]);

  const riskState = createInitialRiskEngineState({
    initialCapitalUsd: 25_000,
    strategyIds: ['SMC_1_5'],
  });

  // Case A: < 5 R:R at signal_emission -> rejected immediately at signal_emission with RR_REJECT_SIGNAL
  const sub5Signal = can_trade({
    riskState,
    strategyId: 'SMC_1_5',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    signalEntryPrice: 100,
    orderIntentPrice: 100,
    stopLoss: 98, // risk = 2
    takeProfit: 108, // reward = 8 -> R:R = 4.0 < 5
  });
  assert.equal(sub5Signal.allowed, false);
  assert.equal(sub5Signal.stage, 'signal_emission');
  assert.equal(sub5Signal.rejectionCode, 'RR_REJECT_SIGNAL');

  // Case B: Missing or parameter-derived SL -> rejected at signal_emission with RR_REJECT_SIGNAL
  const noStop = can_trade({
    riskState,
    strategyId: 'SMC_1_5',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    signalEntryPrice: 100,
    orderIntentPrice: 100,
    stopLoss: null,
    takeProfit: 110,
  });
  assert.equal(noStop.allowed, false);
  assert.equal(noStop.stage, 'signal_emission');
  assert.equal(noStop.rejectionCode, 'RR_REJECT_SIGNAL');

  const syntheticStop = can_trade({
    riskState,
    strategyId: 'SMC_1_5',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    signalEntryPrice: 100,
    orderIntentPrice: 100,
    stopLoss: 99,
    takeProfit: 106,
    stopOrigin: 'SYNTHETIC_MULTIPLE',
    targetOrigin: 'STRUCTURAL_LIQUIDITY_POOL',
  });
  assert.equal(syntheticStop.allowed, false);
  assert.equal(syntheticStop.stage, 'signal_emission');
  assert.equal(syntheticStop.rejectionCode, 'RR_REJECT_SIGNAL');

  // Case C: Missing or parameter-derived TP -> rejected at signal_emission with RR_REJECT_SIGNAL
  const noTarget = can_trade({
    riskState,
    strategyId: 'SMC_1_5',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    signalEntryPrice: 100,
    orderIntentPrice: 100,
    stopLoss: 99,
    takeProfit: null,
  });
  assert.equal(noTarget.allowed, false);
  assert.equal(noTarget.stage, 'signal_emission');
  assert.equal(noTarget.rejectionCode, 'RR_REJECT_SIGNAL');

  const syntheticTarget = can_trade({
    riskState,
    strategyId: 'SMC_1_5',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    signalEntryPrice: 100,
    orderIntentPrice: 100,
    stopLoss: 99,
    takeProfit: 106,
    stopOrigin: 'STRUCTURAL_INVALIDATION',
    targetOrigin: 'SYNTHETIC_MULTIPLE',
  });
  assert.equal(syntheticTarget.allowed, false);
  assert.equal(syntheticTarget.stage, 'signal_emission');
  assert.equal(syntheticTarget.rejectionCode, 'RR_REJECT_SIGNAL');

  // Case D: Passes Stage 1 at signal entry (100, SL=99, TP=105.5 -> 5.5R stored),
  // then price moves up 0.30% (30 bps > 25 bps default budget) before order_intent -> RR_REJECT_PRICE_DRIFT with stored plannedRR unchanged!
  const driftedAtIntent = can_trade({
    riskState,
    strategyId: 'SMC_1_5',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    signalEntryPrice: 100,
    orderIntentPrice: 100.3,
    stopLoss: 99,
    takeProfit: 105.5,
  });
  assert.equal(driftedAtIntent.allowed, false);
  assert.equal(driftedAtIntent.stage, 'order_intent');
  assert.equal(driftedAtIntent.rejectionCode, 'RR_REJECT_PRICE_DRIFT');
  assert.equal(driftedAtIntent.plannedRR, 5.5);

  // Case E: Post-hoc stop tightening (moving SL from 99.0 closer to 99.4 after signal_emission) is rejected with INTEGRITY_FAILURE!
  const tightened = evaluateThreeStageRRGate({
    direction: 'BUY',
    signalEntryPrice: 100,
    orderIntentPrice: 100.05,
    stopLoss: 99.0,
    takeProfit: 105.5,
    intentStopLoss: 99.4,
    intentTakeProfit: 105.5,
  });
  assert.equal(tightened.passed, false);
  assert.equal(tightened.failedStage, 'risk_gate');
  assert.equal(tightened.rejectionCode, 'INTEGRITY_FAILURE');

  // Verify direct Stage-1 -> Stage-2 -> Stage-3 calls validate forward cleanly
  const s1 = checkRRSignalEmission({
    direction: 'SELL',
    entryPrice: 100,
    stopLoss: 101,
    takeProfit: 94.5, // risk 1, reward 5.5
  });
  assert.equal(s1.passed, true);
  assert.ok(s1.signalReceipt);
  assert.equal(s1.signalReceipt.planned_rr, 5.5);

  const s2 = checkRRRiskGate({ signalReceipt: s1.signalReceipt });
  assert.equal(s2.passed, true);
  assert.equal(s2.plannedRR, 5.5);

  const s3Fail = checkRROrderIntent({
    signalReceipt: s1.signalReceipt,
    orderIntentPrice: 99.6, // price drifted 40 bps > 25 bps slippage budget -> RR_REJECT_PRICE_DRIFT
    stopLoss: 101,
    takeProfit: 94.5,
    direction: 'SELL',
  });
  assert.equal(s3Fail.passed, false);
  assert.equal(s3Fail.stage, 'order_intent');
  assert.equal(s3Fail.rejectionCode, 'RR_REJECT_PRICE_DRIFT');
  assert.equal(s3Fail.plannedRR, 5.5);

  // Closed-window structural derivation produces non-synthetic origins
  const candles = generateDeterministicCandles('BTCUSDT', '1h', 96);
  const derived = deriveStructuralLevelsFromClosedWindow({
    direction: 'BUY',
    entryPrice: candles[candles.length - 1].close,
    closedCandles: candles,
  });
  assert.equal(derived.stopOrigin, 'STRUCTURAL_INVALIDATION');
  assert.equal(derived.targetOrigin, 'STRUCTURAL_LIQUIDITY_POOL');
});

/* ── 3. Immutability Test: Policy carrying min_rr rejected by Binding Layer ─ */

test('Immutability Test: MIN_RR_KERNEL_CONSTANT is 5 and Binding Layer rejects any policy carrying min_rr or aliases', () => {
  assert.equal(MIN_RR_KERNEL_CONSTANT, 5);

  // Verify live repository policy file contains zero min_rr keys and binds cleanly
  const rawDiskPolicy = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'policies/force-signal.policy.json'), 'utf8')
  ) as GitOpsPolicyDocument;
  const baselineBind = bindPolicyToKernels(rawDiskPolicy, { environment: 'staging' });
  assert.equal(baselineBind.bound, true);
  assert.equal(baselineBind.audit.status, 'BOUND_START_ALLOWED');

  const rrKeyAliases = [
    'min_rr',
    'min_rr_ratio',
    'min_risk_reward',
    'minRR',
    'minRRRatio',
    'minRiskReward',
  ] as const;

  for (const key of rrKeyAliases) {
    // Attempt 1: Top-level forbidden key in policy
    const topLevelIntrusion = {
      ...DEFAULT_GITOPS_POLICY,
      [key]: 2.5,
    } as unknown as GitOpsPolicyDocument;
    const resTop = bindPolicyToKernels(topLevelIntrusion, { environment: 'staging' });
    assert.equal(resTop.bound, false, `Expected top-level "${key}" to fail closed`);
    assert.equal(resTop.audit.status, 'FAILED_CLOSED_HALT');
    assert.equal(resTop.audit.failedStage, 'STAGE_A_SCHEMA');
    assert.equal(
      resTop.audit.failureCode,
      'IMMUTABLE_MIN_RR_FORBIDDEN',
      `Expected IMMUTABLE_MIN_RR_FORBIDDEN for "${key}", got ${resTop.audit.failureCode}`
    );

    // Attempt 2: Nested key inside kernel_contracts
    const nestedIntrusion = {
      ...DEFAULT_GITOPS_POLICY,
      kernel_contracts: {
        ...DEFAULT_GITOPS_POLICY.kernel_contracts,
        [key]: 5,
      },
    } as unknown as GitOpsPolicyDocument;
    const resNested = bindPolicyToKernels(nestedIntrusion, { environment: 'staging' });
    assert.equal(resNested.bound, false, `Expected nested "${key}" to fail closed`);
    assert.equal(resNested.audit.status, 'FAILED_CLOSED_HALT');
    assert.equal(resNested.audit.failureCode, 'IMMUTABLE_MIN_RR_FORBIDDEN');
  }
});

/* ── 4. Drawdown Independence Test: 6 Independent Levels & Strategy Demotion ─ */

test('Drawdown Independence Test: all 6 DD levels are independently enforced and strategy breach demotes strategy without halting portfolio', () => {
  assert.deepEqual([...ORDERED_DRAWDOWN_LEVELS], [
    'PORTFOLIO_DAILY',
    'PORTFOLIO_PEAK_TO_TROUGH',
    'STRATEGY_DAILY',
    'STRATEGY_PEAK_TO_TROUGH',
    'REGIME_SCOPED',
    'CONSECUTIVE_LOSSES',
  ]);
  assert.deepEqual(RISK_ENGINE_DD_LIMITS, {
    PORTFOLIO_DAILY_PCT: 5.0,
    PORTFOLIO_PEAK_TO_TROUGH_PCT: 15.0,
    STRATEGY_DAILY_PCT: 2.0,
    STRATEGY_PEAK_TO_TROUGH_PCT: 8.0,
    REGIME_SCOPED_PCT: 1.5,
    CONSECUTIVE_LOSSES_TRIGGER: 6,
  });

  const validRequestBase = {
    symbol: 'BTCUSDT',
    direction: 'BUY' as const,
    signalEntryPrice: 100,
    orderIntentPrice: 100,
    stopLoss: 99,
    takeProfit: 106,
  };

  // Level 3: Strategy Daily <= 2% (demotes ONLY breaching strategy; portfolio + sibling remain ACTIVE)
  let sDailyState = createInitialRiskEngineState({
    initialCapitalUsd: 30_000, // 10k per strategy across 3 strategies
    strategyIds: ['STRAT_A', 'STRAT_B', 'STRAT_C'],
  });
  // Lose $210 on STRAT_A (2.1% strategy daily DD, only 0.7% portfolio daily DD)
  sDailyState = recordTradeOutcomeInRiskState(sDailyState, {
    strategyId: 'STRAT_A',
    regime: 'NORMAL',
    pnlUsd: -210,
  });
  const sDailyA = can_trade({ ...validRequestBase, riskState: sDailyState, strategyId: 'STRAT_A' });
  const sDailyB = can_trade({ ...validRequestBase, riskState: sDailyState, strategyId: 'STRAT_B' });
  assert.equal(sDailyA.allowed, false);
  assert.equal(sDailyA.rejectionCode, 'DD_STRATEGY_DAILY_DEMOTED');
  assert.equal(sDailyA.strategyStatus, 'DEMOTED');
  assert.equal(sDailyA.portfolioHalted, false);
  assert.equal(sDailyB.allowed, true);
  assert.equal(sDailyB.strategyStatus, 'ACTIVE');

  // Level 4: Strategy Peak-to-Trough <= 8% (demotes ONLY STRAT_A after prior profit peak, portfolio fine)
  let sP2tState = createInitialRiskEngineState({
    initialCapitalUsd: 30_000,
    strategyIds: ['STRAT_A', 'STRAT_B', 'STRAT_C'],
  });
  // Boost STRAT_A up +$2,000 -> peak $12,000, then lose $1,000 -> P2T = 8.33% >= 8%, daily equity is STILL +$1,000 above daily start (0% daily DD!)
  sP2tState = recordTradeOutcomeInRiskState(sP2tState, {
    strategyId: 'STRAT_A',
    regime: 'TRENDING',
    pnlUsd: 2000,
  });
  sP2tState = recordTradeOutcomeInRiskState(sP2tState, {
    strategyId: 'STRAT_A',
    regime: 'TRENDING',
    pnlUsd: -1000,
  });
  const p2tEvalA = evaluateDrawdownHierarchy(sP2tState, 'STRAT_A', 'TRENDING');
  assert.equal(p2tEvalA.portfolioHalted, false);
  assert.equal(p2tEvalA.strategyDemoted, true);
  assert.equal(p2tEvalA.primaryDenialCode, 'DD_STRATEGY_PEAK_TROUGH_DEMOTED');
  const p2tVerdictA = can_trade({ ...validRequestBase, riskState: sP2tState, strategyId: 'STRAT_A' });
  const p2tVerdictB = can_trade({ ...validRequestBase, riskState: sP2tState, strategyId: 'STRAT_B' });
  assert.equal(p2tVerdictA.allowed, false);
  assert.equal(p2tVerdictA.rejectionCode, 'DD_STRATEGY_PEAK_TROUGH_DEMOTED');
  assert.equal(p2tVerdictB.allowed, true);

  // Level 5: Regime-Scoped <= 1.5% (blocks ONLY STRAT_A in HIGH_VOL while STRAT_A stays ACTIVE in NORMAL & sibling runs in HIGH_VOL)
  let regimeState = createInitialRiskEngineState({
    initialCapitalUsd: 30_000,
    strategyIds: ['STRAT_A', 'STRAT_B', 'STRAT_C'],
  });
  regimeState = recordTradeOutcomeInRiskState(regimeState, {
    strategyId: 'STRAT_A',
    regime: 'HIGH_VOLATILITY',
    pnlUsd: -160, // 1.6% > 1.5% regime cap, but < 2.0% strategy daily cap!
  });
  const regBlocked = can_trade({
    ...validRequestBase,
    riskState: regimeState,
    strategyId: 'STRAT_A',
    regime: 'HIGH_VOLATILITY',
  });
  const regAllowedNormal = can_trade({
    ...validRequestBase,
    riskState: regimeState,
    strategyId: 'STRAT_A',
    regime: 'NORMAL',
  });
  const regAllowedSibling = can_trade({
    ...validRequestBase,
    riskState: regimeState,
    strategyId: 'STRAT_B',
    regime: 'HIGH_VOLATILITY',
  });
  assert.equal(regBlocked.allowed, false);
  assert.equal(regBlocked.rejectionCode, 'DD_REGIME_SCOPED_BLOCKED');
  assert.equal(regBlocked.portfolioHalted, false);
  assert.equal(regAllowedNormal.allowed, true);
  assert.equal(regAllowedSibling.allowed, true);

  // Level 1: Portfolio Daily <= 5% (halts EVERY strategy!)
  let portDailyState = createInitialRiskEngineState({
    initialCapitalUsd: 30_000,
    strategyIds: ['STRAT_A', 'STRAT_B', 'STRAT_C'],
  });
  portDailyState = recordTradeOutcomeInRiskState(portDailyState, {
    strategyId: 'STRAT_A',
    regime: 'NORMAL',
    pnlUsd: -1550, // 5.17% of 30k portfolio -> breaches Portfolio Daily <= 5%
  });
  const portDailyB = can_trade({ ...validRequestBase, riskState: portDailyState, strategyId: 'STRAT_B' });
  assert.equal(portDailyB.allowed, false);
  assert.equal(portDailyB.portfolioHalted, true);
  assert.equal(portDailyB.rejectionCode, 'DD_PORTFOLIO_DAILY_HALT');

  // Level 2: Portfolio Peak-to-Trough <= 15% (after portfolio run-up, 15.5% P2T drop halts portfolio even with 0% daily DD)
  let portP2tState = createInitialRiskEngineState({
    initialCapitalUsd: 30_000,
    strategyIds: ['STRAT_A', 'STRAT_B', 'STRAT_C'],
  });
  portP2tState = recordTradeOutcomeInRiskState(portP2tState, {
    strategyId: 'STRAT_B',
    regime: 'TRENDING',
    pnlUsd: 10_000, // peak = 40,000
  });
  portP2tState = recordTradeOutcomeInRiskState(portP2tState, {
    strategyId: 'STRAT_B',
    regime: 'TRENDING',
    pnlUsd: -6200, // equity = 33,800 -> P2T = 15.5% >= 15%, yet equity > dailyStart 30,000 (0% daily DD!)
  });
  const portP2tC = can_trade({ ...validRequestBase, riskState: portP2tState, strategyId: 'STRAT_C' });
  assert.equal(portP2tC.allowed, false);
  assert.equal(portP2tC.portfolioHalted, true);
  assert.equal(portP2tC.rejectionCode, 'DD_PORTFOLIO_PEAK_TROUGH_HALT');
});

/* ── 5. Consecutive-Loss Test: Circuit Breaker Fires at Exact Count = 6 ──── */

test('Consecutive-Loss Test: circuit breaker stays open through 5 losses and fires at exact count 6', () => {
  let state = createInitialRiskEngineState({
    initialCapitalUsd: 60_000, // 20k per strategy so tiny losses stay well under all % DD thresholds
    strategyIds: ['STRAT_STREAK', 'STRAT_SIBLING', 'STRAT_BACKUP'],
  });

  const tradeProbe = {
    strategyId: 'STRAT_STREAK',
    symbol: 'BTCUSDT',
    direction: 'BUY' as const,
    signalEntryPrice: 100,
    orderIntentPrice: 100,
    stopLoss: 99,
    takeProfit: 106,
  };

  // Losses 1..5 MUST remain allowed (tiny -$5 losses keep DD ~0.12% << 1.5%/2.0%)
  for (let lossNum = 1; lossNum <= 5; lossNum += 1) {
    state = recordTradeOutcomeInRiskState(state, {
      strategyId: 'STRAT_STREAK',
      regime: 'NORMAL',
      pnlUsd: -5,
    });
    assert.equal(state.strategies.STRAT_STREAK.consecutiveLosses, lossNum);
    const verdict = can_trade({ riskState: state, ...tradeProbe });
    assert.equal(verdict.allowed, true, `Loss #${lossNum} must NOT trip breaker before exact 6`);
    assert.equal(verdict.circuitBreakerTripped, false);
  }

  // Exact Loss #6 MUST trip CIRCUIT_BREAKER_CONSECUTIVE_LOSSES
  state = recordTradeOutcomeInRiskState(state, {
    strategyId: 'STRAT_STREAK',
    regime: 'NORMAL',
    pnlUsd: -5,
  });
  assert.equal(state.strategies.STRAT_STREAK.consecutiveLosses, 6);
  const verdictAt6 = can_trade({ riskState: state, ...tradeProbe });
  assert.equal(verdictAt6.allowed, false);
  assert.equal(verdictAt6.circuitBreakerTripped, true);
  assert.equal(verdictAt6.strategyStatus, 'DEMOTED');
  assert.equal(verdictAt6.portfolioHalted, false);
  assert.equal(verdictAt6.rejectionCode, 'CIRCUIT_BREAKER_CONSECUTIVE_LOSSES');
  assert.throws(
    () => assertOrderIntentPermittedOrThrow({ riskState: state, ...tradeProbe }),
    (err: unknown) =>
      err instanceof RiskEngineOrderBlockedError &&
      err.code === 'CIRCUIT_BREAKER_CONSECUTIVE_LOSSES'
  );

  // Sibling strategy remains operational despite STRAT_STREAK hitting 6 consecutive losses
  const siblingVerdict = can_trade({
    riskState: state,
    ...tradeProbe,
    strategyId: 'STRAT_SIBLING',
  });
  assert.equal(siblingVerdict.allowed, true);

  // A win before reaching 6 resets the consecutive streak counter to 0 cleanly
  let resetState = createInitialRiskEngineState({
    initialCapitalUsd: 60_000,
    strategyIds: ['STRAT_RESET'],
  });
  for (let i = 0; i < 4; i += 1) {
    resetState = recordTradeOutcomeInRiskState(resetState, {
      strategyId: 'STRAT_RESET',
      regime: 'NORMAL',
      pnlUsd: -5,
    });
  }
  assert.equal(resetState.strategies.STRAT_RESET.consecutiveLosses, 4);
  resetState = recordTradeOutcomeInRiskState(resetState, {
    strategyId: 'STRAT_RESET',
    regime: 'NORMAL',
    pnlUsd: 25, // 1:5 winner!
  });
  assert.equal(resetState.strategies.STRAT_RESET.consecutiveLosses, 0);
  const postResetVerdict = can_trade({
    riskState: resetState,
    ...tradeProbe,
    strategyId: 'STRAT_RESET',
  });
  assert.equal(postResetVerdict.allowed, true);
  assert.equal(postResetVerdict.circuitBreakerTripped, false);
});

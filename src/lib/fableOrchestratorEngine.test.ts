import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FABLE_PROP_LIMITS,
  FABLE_EIGHT_LAYER_SPEC,
  buildBlackScholesIvSurface,
  computeDynamicHalfKellyFraction,
  computeInverseVarianceWeights,
  computeRegimeAdaptiveTrailingStop,
  diffStrategyParams,
  evaluateLayer6PreTradeRisk,
  generateDeterministicBenchPrices,
  priceBlackScholesOption,
  proposeSingleParameterMutation,
  runFourGateValidation,
  solveBlackScholesImpliedVol,
  type FableStrategyFamilyProfile,
  type FableStrategyVersion,
} from './fableOrchestratorEngine';

const SAMPLE_FAMILIES: readonly FableStrategyFamilyProfile[] = [
  {
    family: 'BREAKOUT',
    label: 'Breakout',
    annualizedVolatility: 0.36,
    oosSharpe: 1.4,
    winRate: 0.51,
    payoffRatio: 2.0,
  },
  {
    family: 'MEAN_REVERSION',
    label: 'Mean Reversion',
    annualizedVolatility: 0.18,
    oosSharpe: 1.85,
    winRate: 0.62,
    payoffRatio: 1.5,
  },
  {
    family: 'MOMENTUM',
    label: 'Momentum',
    annualizedVolatility: 0.24,
    oosSharpe: 1.92,
    winRate: 0.57,
    payoffRatio: 2.1,
  },
];

test('Black-Scholes Option Pricing Model satisfies put-call parity, analytical Greeks bounds, IV inversion, and mispricing filter', () => {
  const spot = 100;
  const strike = 100;
  const t = 0.5;
  const r = 0.05;
  const sigma = 0.3;

  const call = priceBlackScholesOption({
    symbol: 'BTC-180D-100C',
    optionType: 'CALL',
    spotPrice: spot,
    strikePrice: strike,
    timeToExpiryYears: t,
    riskFreeRate: r,
    volatility: sigma,
  });
  const put = priceBlackScholesOption({
    symbol: 'BTC-180D-100P',
    optionType: 'PUT',
    spotPrice: spot,
    strikePrice: strike,
    timeToExpiryYears: t,
    riskFreeRate: r,
    volatility: sigma,
  });

  // Put-Call Parity: C - P = S - K * exp(-rT)
  const parityLhs = call.theoreticalPrice - put.theoreticalPrice;
  const parityRhs = spot - strike * Math.exp(-r * t);
  assert.ok(Math.abs(parityLhs - parityRhs) < 1e-4, `Put-call parity mismatch: ${parityLhs} vs ${parityRhs}`);

  // Greeks invariants: Delta_C - Delta_P = 1, Gamma_C == Gamma_P > 0, Theta < 0 for long ATM options
  assert.ok(Math.abs(call.delta - put.delta - 1) < 1e-4);
  assert.ok(call.gamma > 0 && Math.abs(call.gamma - put.gamma) < 1e-6);
  assert.ok(call.thetaPerDay < 0);

  // Newton-Raphson Implied Volatility round-trip recovery
  const recoveredIv = solveBlackScholesImpliedVol(
    {
      symbol: 'BTC-180D-100C',
      optionType: 'CALL',
      spotPrice: spot,
      strikePrice: strike,
      timeToExpiryYears: t,
      riskFreeRate: r,
      volatility: 0.6, // intentionally far initial guess
    },
    call.theoreticalPrice
  );
  assert.ok(Math.abs(recoveredIv - sigma) < 1e-4, `Expected IV ${sigma}, got ${recoveredIv}`);

  // Mispricing rejection when market price deviates > 5% from theoretical value
  const overpriced = priceBlackScholesOption({
    symbol: 'BTC-OVERPRICED',
    optionType: 'CALL',
    spotPrice: spot,
    strikePrice: strike,
    timeToExpiryYears: t,
    riskFreeRate: r,
    volatility: sigma,
    marketPrice: call.theoreticalPrice * 1.18,
  });
  assert.equal(overpriced.isMispriced, true);
  assert.equal(overpriced.verdict, 'REJECT_MISPRICED');

  // IV Surface generation (5 moneyness x 3 expiries = 15 nodes)
  const surface = buildBlackScholesIvSurface({
    symbol: 'BTCUSDT',
    spotPrice: 90_000,
    baseVolatility: 0.48,
  });
  assert.equal(surface.length, 15);
  assert.ok(surface.every((pt) => pt.impliedVolatility > 0 && pt.gamma >= 0));
});

test('Layer 6 enforces Dynamic Half-Kelly when Sharpe > 1.5, Regime-Adaptive ATR stops (2.5x / 1.5x), 0.02% spread guard, and Inverse Variance weights', () => {
  // 1. Dynamic Half-Kelly activates strictly when Sharpe > 1.5
  const lowSharpe = computeDynamicHalfKellyFraction({
    sharpeRatio: 1.45,
    winRate: 0.58,
    payoffRatio: 2.0,
  });
  assert.equal(lowSharpe.sizingMode, 'STATIC_CONSERVATIVE');
  assert.equal(lowSharpe.riskFractionOfEquity, DEFAULT_FABLE_PROP_LIMITS.staticRiskPerTradePct);

  const highSharpe = computeDynamicHalfKellyFraction({
    sharpeRatio: 1.9,
    winRate: 0.58,
    payoffRatio: 2.0,
  });
  assert.equal(highSharpe.sizingMode, 'DYNAMIC_HALF_KELLY');
  assert.ok(highSharpe.riskFractionOfEquity > 0 && highSharpe.riskFractionOfEquity <= 0.02);

  // 2. Regime-Adaptive Trailing Stops: 2.5x ATR in HIGH_VOLATILITY, 1.5x ATR in QUIET
  const hiVolStop = computeRegimeAdaptiveTrailingStop({
    entryPrice: 1000,
    atr: 20,
    side: 'BUY',
    regime: 'HIGH_VOLATILITY',
  });
  assert.equal(hiVolStop.atrMultiplier, 2.5);
  assert.equal(hiVolStop.trailingStopPrice, 950);

  const quietStop = computeRegimeAdaptiveTrailingStop({
    entryPrice: 1000,
    atr: 20,
    side: 'BUY',
    regime: 'QUIET',
  });
  assert.equal(quietStop.atrMultiplier, 1.5);
  assert.equal(quietStop.trailingStopPrice, 970);

  // 3. Inverse Variance Weighting across Breakout, Mean Reversion, Momentum
  const weights = computeInverseVarianceWeights(SAMPLE_FAMILIES);
  assert.equal(weights.length, 3);
  const sumW = weights.reduce((acc, w) => acc + w.weightFraction, 0);
  assert.ok(Math.abs(sumW - 1) < 1e-4, `Weights must sum to 1.0, got ${sumW}`);
  const mrWeight = weights.find((w) => w.family === 'MEAN_REVERSION')!.weightFraction;
  const boWeight = weights.find((w) => w.family === 'BREAKOUT')!.weightFraction;
  assert.ok(mrWeight > boWeight, 'Lower-volatility Mean Reversion must receive higher inverse-variance weight');

  // 4. Execution spread check rejects > 0.02% (0.0002)
  const wideSpreadDecision = evaluateLayer6PreTradeRisk({
    side: 'BUY',
    bid: 100.0,
    ask: 100.03, // ~0.03% spread > 0.02%
    atr: 1.2,
    regime: 'QUIET',
    currentEquityUsd: 100_000,
    startOfDayEquityUsd: 100_000,
    highWaterMarkEquityUsd: 100_000,
    strategyFamily: SAMPLE_FAMILIES[2],
    allFamilies: SAMPLE_FAMILIES,
    activeCorrelations: [0.2],
  });
  assert.equal(wideSpreadDecision.approved, false);
  assert.ok(wideSpreadDecision.rejectionReasons.some((r) => r.includes('SPREAD_GUARD_REJECTED')));

  // 5. Prop firm daily loss (4%) and correlation guard (>0.70) reject trades
  const propBreachDecision = evaluateLayer6PreTradeRisk({
    side: 'BUY',
    bid: 100.0,
    ask: 100.01, // 0.01% valid spread
    atr: 1.2,
    regime: 'HIGH_VOLATILITY',
    currentEquityUsd: 95_500, // 4.5% daily loss
    startOfDayEquityUsd: 100_000,
    highWaterMarkEquityUsd: 100_000,
    strategyFamily: SAMPLE_FAMILIES[2],
    allFamilies: SAMPLE_FAMILIES,
    activeCorrelations: [0.82],
  });
  assert.equal(propBreachDecision.approved, false);
  assert.ok(propBreachDecision.rejectionReasons.some((r) => r.includes('DAILY_LOSS_LIMIT_BREACHED')));
  assert.ok(propBreachDecision.rejectionReasons.some((r) => r.includes('CORRELATION_GUARD_REJECTED')));

  // 6. Clean trade passes with Half-Kelly sizing
  const cleanDecision = evaluateLayer6PreTradeRisk({
    side: 'BUY',
    bid: 100.0,
    ask: 100.01, // 0.01% spread <= 0.02%
    atr: 1.5,
    regime: 'HIGH_VOLATILITY',
    currentEquityUsd: 100_000,
    startOfDayEquityUsd: 100_000,
    highWaterMarkEquityUsd: 100_000,
    strategyFamily: SAMPLE_FAMILIES[2],
    allFamilies: SAMPLE_FAMILIES,
    activeCorrelations: [0.25, -0.18],
  });
  assert.equal(cleanDecision.approved, true);
  assert.equal(cleanDecision.sizingMode, 'DYNAMIC_HALF_KELLY');
  assert.equal(cleanDecision.trailingStopAtrMult, 2.5);
  assert.ok(cleanDecision.positionNotionalUsd > 0);
});

test('Phase 5 Self-Improvement Loop enforces single-parameter mutation and strict identical-OOS V2 dominance over V1', () => {
  assert.equal(FABLE_EIGHT_LAYER_SPEC.length, 8);

  const series = generateDeterministicBenchPrices(200, 91_400, 'QUIET');
  const isSlice = series.slice(0, 120);
  const oosSlice = series.slice(120);

  const v1: FableStrategyVersion = {
    versionId: 'momentum-v1',
    family: 'MOMENTUM',
    params: { lookback: 20, entryZscore: 1.2, stopAtrMult: 1.5 },
    parentVersionId: null,
    createdAtIso: new Date().toISOString(),
  };

  // Multi-parameter mutation MUST be rejected by Phase 5 single-param rule
  const illegalMultiMut: FableStrategyVersion = {
    versionId: 'momentum-v2-illegal',
    family: 'MOMENTUM',
    params: { lookback: 14, entryZscore: 0.9, stopAtrMult: 1.5 },
    parentVersionId: v1.versionId,
    createdAtIso: new Date().toISOString(),
  };
  assert.equal(diffStrategyParams(v1.params, illegalMultiMut.params).length, 2);
  const illegalReport = runFourGateValidation({
    cycleId: 'cyc_illegal',
    incumbentV1: v1,
    candidateV2: illegalMultiMut,
    hypothesis: 'Illegal 2-parameter mutation',
    inSamplePrices: isSlice,
    outOfSamplePrices: oosSlice,
  });
  assert.equal(illegalReport.promotedV2OverV1, false);
  assert.equal(illegalReport.gate4EvolutionAndOptionsPassed, false);
  assert.ok(illegalReport.reasons.some((r) => r.includes('PHASE_5_VIOLATION')));

  // Valid single-parameter mutation is audited strictly on identical OOS dataset
  const { candidate: v2, hypothesis } = proposeSingleParameterMutation(v1, 'stopAtrMult', 1.25, 2);
  assert.deepEqual(diffStrategyParams(v1.params, v2.params), ['stopAtrMult']);

  const report = runFourGateValidation({
    cycleId: 'cyc_valid',
    incumbentV1: v1,
    candidateV2: v2,
    hypothesis,
    inSamplePrices: isSlice,
    outOfSamplePrices: oosSlice,
    optionContract: {
      symbol: 'BTC-30D-ATM-PUT',
      optionType: 'PUT',
      spotPrice: oosSlice[oosSlice.length - 1],
      strikePrice: oosSlice[oosSlice.length - 1],
      timeToExpiryYears: 30 / 365,
      riskFreeRate: 0.045,
      volatility: 0.42,
    },
  });
  assert.equal(report.v1Oos.datasetId, 'OOS_IDENTICAL');
  assert.equal(report.v2Oos.datasetId, 'OOS_IDENTICAL');
  assert.ok(report.optionAudit !== null);

  // Verify promotion invariant strictly matches V2 > V1 Sharpe AND V2 < V1 Max DD
  if (report.promotedV2OverV1) {
    assert.ok(report.v2Oos.sharpeRatio > report.v1Oos.sharpeRatio);
    assert.ok(report.v2Oos.maxDrawdownPct < report.v1Oos.maxDrawdownPct);
  } else {
    assert.equal(report.promotedV2OverV1, false);
  }
});

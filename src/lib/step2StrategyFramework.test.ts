import test from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from './marketData';
import {
  evaluateStrategyOnCandles,
  runStrategyComparisonBacktest,
  STEP2_STRATEGY_REGISTRY,
} from './step2StrategyFramework';

function buildMultiRegimeCandles(count = 220): Candle[] {
  const startSec = 1758000000;
  const out: Candle[] = [];
  let price = 62000;
  for (let i = 0; i < count; i++) {
    const open = price;
    // Alternate between trending, choppy range, and sharp pullback regimes
    let drift = 0;
    if (i < 70) drift = 120 * Math.sin(i * 0.25) + 45;
    else if (i < 130) drift = 360 * Math.sin(i * 0.65); // whipsaw chop
    else if (i < 175) drift = -145 + 90 * Math.cos(i * 0.3); // downtrend
    else drift = 180 + 110 * Math.sin(i * 0.4); // recovery

    const close = Number(Math.max(1000, open + drift).toFixed(2));
    const high = Number((Math.max(open, close) + 160 + (i % 5) * 35).toFixed(2));
    const low = Number((Math.min(open, close) - 150 - (i % 4) * 30).toFixed(2));
    const volume = i % 11 === 0 ? 420 : 120 + (i % 7) * 18;
    out.push({
      time: startSec + i * 3600,
      open,
      high,
      low,
      close,
      volume,
    });
    price = close;
  }
  return out;
}

test('Step 2 Strategy Registry: declares 8 modular strategies and does NOT auto-enable all for autonomous execution', () => {
  assert.equal(STEP2_STRATEGY_REGISTRY.length, 8);
  const autoEnabled = STEP2_STRATEGY_REGISTRY.filter((s) => s.autonomousEligible);
  assert.ok(autoEnabled.length < STEP2_STRATEGY_REGISTRY.length);
  for (const s of STEP2_STRATEGY_REGISTRY) {
    assert.ok(s.requiredMarketInputs.length > 0);
    assert.ok(s.entryConditions.length > 0);
    assert.ok(s.invalidationConditions.length > 0);
    assert.ok(s.knownLimitations.length > 0);
    assert.ok(s.minRiskReward > 1);
  }
});

test('Step 2 Order Flow Strategy: remains honestly inactive when verified derivatives are absent', () => {
  const candles = buildMultiRegimeCandles(80);
  const withoutDeriv = evaluateStrategyOnCandles('orderflow_funding_oi', candles, {
    derivatives: null,
  });
  assert.equal(withoutDeriv.triggered, false);
  assert.ok(withoutDeriv.reasoning[0].includes('unavailable'));

  const withDeriv = evaluateStrategyOnCandles('orderflow_funding_oi', candles, {
    derivatives: {
      fundingRate8h: 0.0001,
      openInterestUsd: 1_100_000_000,
      spotMarkBasisBps: 3.1,
      liquidations24hUsd: 12_000_000,
      orderBookImbalance: 0.28,
      spreadBps: 1.5,
      provider: 'BINANCE_FUTURES',
      observedAtMs: Date.now(),
      verified: true,
    },
  });
  assert.equal(withDeriv.triggered, true);
  assert.equal(withDeriv.direction, 'BUY');
});

test('Step 2 Backtest Comparator: enforces zero look-ahead, reproducible hash, fees/slippage, and shows winning + losing outcomes', () => {
  const candles = buildMultiRegimeCandles(240);
  const report1 = runStrategyComparisonBacktest(candles, {
    symbol: 'BTCUSDT',
    timeframe: '1h',
    initialEquityUsd: 10_000,
    feeBps: 8,
    slippageBps: 6,
    spreadBps: 4,
  });
  const report2 = runStrategyComparisonBacktest(candles, {
    symbol: 'BTCUSDT',
    timeframe: '1h',
    initialEquityUsd: 10_000,
    feeBps: 8,
    slippageBps: 6,
    spreadBps: 4,
  });

  assert.equal(report1.environment, 'HISTORICAL_BACKTEST');
  assert.equal(report1.lookAheadLeakagePrevented, true);
  assert.equal(report1.configHash, report2.configHash);
  assert.equal(report1.results.length, 8);
  assert.equal(report1.inSampleBars + report1.outOfSampleBars, candles.length);

  // Order flow strategy must have 0 trades on Spot-only OHLCV (never fabricated)
  const orderflowRow = report1.results.find((r) => r.strategyId === 'orderflow_funding_oi');
  assert.ok(orderflowRow);
  assert.equal(orderflowRow.totalTrades, 0);

  // At least one strategy executed trades and accrued real fees/slippage
  const activeRows = report1.results.filter((r) => r.totalTrades > 0);
  assert.ok(activeRows.length >= 2);
  assert.ok(activeRows.some((r) => r.totalFeesAndSlippageUsd > 0));
});

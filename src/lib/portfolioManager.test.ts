import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PORTFOLIO_SEEDS,
  DEFAULT_REBALANCE_CONFIG,
  computeAssetVolatilityProfile,
  computeVolatilityParityWeights,
  evaluateMultiAssetPortfolio,
  executePortfolioRebalance,
  normalizeRebalanceConfig,
} from './portfolioManager';
import { generateDeterministicCandles } from './marketData';

test('normalizeRebalanceConfig guards invalid values and enforces bounds cleanly', () => {
  const normalized = normalizeRebalanceConfig({
    driftThresholdPct: -10,
    periodicIntervalMinutes: 999,
    maxGrossExposurePct: 500,
    minStablecoinReservePct: -5,
    maxSingleAssetPct: 99,
  });

  assert.equal(normalized.driftThresholdPct, 0.5);
  assert.equal(normalized.periodicIntervalMinutes, DEFAULT_REBALANCE_CONFIG.periodicIntervalMinutes);
  assert.equal(normalized.maxGrossExposurePct, 200);
  assert.equal(normalized.minStablecoinReservePct, 0);
  assert.equal(normalized.maxSingleAssetPct, 80);
});

test('computeAssetVolatilityProfile handles null, empty, and valid candles without NaN', () => {
  const emptyVol = computeAssetVolatilityProfile(null, 4.0);
  assert.ok(Number.isFinite(emptyVol.annualizedVolatilityPct) && emptyVol.annualizedVolatilityPct > 0);
  assert.equal(emptyVol.atrPercent, 4.0);

  const btcCandles = generateDeterministicCandles('BTCUSDT', '4h', 80);
  const btcVol = computeAssetVolatilityProfile(btcCandles, 2.6);
  assert.ok(btcVol.annualizedVolatilityPct >= 12 && btcVol.annualizedVolatilityPct <= 220);
  assert.ok(btcVol.atrPercent > 0);
});

test('computeVolatilityParityWeights assigns higher weights to lower-volatility assets and respects single-asset cap', () => {
  const weights = computeVolatilityParityWeights(
    [
      { symbol: 'BTCUSDT', annualizedVolatilityPct: 35 },
      { symbol: 'ETHUSDT', annualizedVolatilityPct: 55 },
      { symbol: 'SOLUSDT', annualizedVolatilityPct: 110 },
    ],
    85,
    45
  );

  assert.ok(weights.BTCUSDT > weights.ETHUSDT);
  assert.ok(weights.ETHUSDT > weights.SOLUSDT);
  assert.ok(weights.BTCUSDT <= 45);
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 85) <= 0.15, `Expected weights sum ~85, got ${sum}`);
});

test('evaluateMultiAssetPortfolio detects UNDER_EXPOSED and OVER_EXPOSED regimes accurately', () => {
  const btcCandles = generateDeterministicCandles('BTCUSDT', '4h', 80);

  // Under-exposed portfolio: huge stablecoin cash reserve vs small deployed spot
  const underExposed = evaluateMultiAssetPortfolio({
    holdings: DEFAULT_PORTFOLIO_SEEDS.map((s) => ({ ...s, units: s.units * 0.25 })),
    stablecoinReserveUsd: 25000,
    candlesMap: { BTCUSDT: btcCandles },
    config: { maxGrossExposurePct: 100, minStablecoinReservePct: 15 },
  });
  assert.equal(underExposed.exposureMeter.regime, 'UNDER_EXPOSED');
  assert.ok(underExposed.exposureMeter.grossExposurePct < 70);

  // Over-exposed portfolio: leveraged Futures positions pushing gross exposure > 100%
  const overExposed = evaluateMultiAssetPortfolio({
    holdings: DEFAULT_PORTFOLIO_SEEDS,
    stablecoinReserveUsd: 1000,
    candlesMap: { BTCUSDT: btcCandles },
    positions: [
      {
        id: 'pos_over_1',
        symbol: 'BTCUSDT',
        direction: 'BUY',
        mode: 'TESTNET',
        marketType: 'USD_M_FUTURES',
        leverage: 10,
        entryPrice: 64000,
        quantity: 0.4,
        notionalUsd: 25600,
        initialStopLoss: 62800,
        trailingStopLoss: 63000,
        takeProfits: [66000, 68000, 70400],
        status: 'OPEN',
        pnlUsd: 0,
        pnlPercent: 0,
        skepticVerdict: 'APPROVED',
        openedAt: new Date().toISOString(),
      },
    ],
    config: { maxGrossExposurePct: 100, minStablecoinReservePct: 15 },
  });
  assert.equal(overExposed.exposureMeter.regime, 'OVER_EXPOSED');
  assert.ok(overExposed.exposureMeter.grossExposurePct > 120);
  assert.equal(overExposed.rebalanceTrigger.shouldExecute, true);
});

test('executePortfolioRebalance aligns overweight and underweight assets back to volatility parity targets', () => {
  const skewedHoldings = DEFAULT_PORTFOLIO_SEEDS.map((h) =>
    h.symbol === 'BTCUSDT' ? { ...h, units: 0.45 } : { ...h, units: h.units * 0.2 }
  );

  const preEval = evaluateMultiAssetPortfolio({
    holdings: skewedHoldings,
    stablecoinReserveUsd: 3000,
    config: { driftThresholdPct: 2.5, volatilityWeightingEnabled: true },
  });

  assert.equal(preEval.rebalanceTrigger.shouldExecute, true);
  assert.ok(preEval.exposureMeter.maxAbsDriftPct > 5);

  const { updatedHoldings, updatedReserveUsd, record } = executePortfolioRebalance({
    holdings: skewedHoldings,
    evaluation: preEval,
    stablecoinReserveUsd: 3000,
    reason: 'THRESHOLD_BREACHED',
  });

  assert.ok(record.tradesExecuted >= 2);
  assert.ok(record.postMaxDriftPct < 0.25, `Expected postMaxDriftPct < 0.25%, got ${record.postMaxDriftPct}%`);

  const postEval = evaluateMultiAssetPortfolio({
    holdings: updatedHoldings,
    stablecoinReserveUsd: updatedReserveUsd,
    config: { driftThresholdPct: 2.5, volatilityWeightingEnabled: true },
    lastRebalanceAt: record.executedAt,
  });
  assert.ok(postEval.exposureMeter.maxAbsDriftPct < 0.5);
});

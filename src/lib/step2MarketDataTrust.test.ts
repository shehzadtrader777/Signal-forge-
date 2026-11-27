import test from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from './marketData';
import {
  evaluateMarketDataTrust,
  validateCandleSeriesIntegrity,
} from './step2MarketDataTrust';

function makeCandles(count = 40, basePrice = 68000): Candle[] {
  const startSec = 1760000000;
  const out: Candle[] = [];
  let price = basePrice;
  for (let i = 0; i < count; i++) {
    const open = price;
    const delta = (i % 2 === 0 ? 1 : -0.6) * 140;
    const close = Number((open + delta).toFixed(2));
    const high = Number((Math.max(open, close) + 85).toFixed(2));
    const low = Number((Math.min(open, close) - 75).toFixed(2));
    out.push({
      time: startSec + i * 3600,
      open,
      high,
      low,
      close,
      volume: 120 + i * 3,
    });
    price = close;
  }
  return out;
}

test('Step 2 Market Data Trust: passes fresh verified Binance Spot candles', () => {
  const nowMs = 1760500000000;
  const result = evaluateMarketDataTrust({
    symbol: 'BTCUSDT',
    timeframe: '1h',
    provider: 'BINANCE_SPOT',
    candles: makeCandles(48),
    fetchedAtMs: nowMs - 8_000,
    nowMs,
    isSyntheticSimulation: false,
    derivatives: {
      fundingRate8h: 0.0001,
      openInterestUsd: 1_400_000_000,
      spotMarkBasisBps: 4.2,
      liquidations24hUsd: 22_000_000,
      orderBookImbalance: 0.14,
      spreadBps: 1.8,
      provider: 'BINANCE_FUTURES',
      observedAtMs: nowMs - 5_000,
      verified: true,
    },
  });

  assert.equal(result.freshness, 'FRESH');
  assert.equal(result.executionAllowed, true);
  assert.equal(result.isSyntheticSimulation, false);
  assert.equal(result.derivativesVerified, true);
  assert.equal(result.blockingReasons.length, 0);
  assert.ok(result.atr14 > 0);
});

test('Step 2 Market Data Trust: blocks stale market data beyond maxDataAgeMs', () => {
  const nowMs = 1760500000000;
  const result = evaluateMarketDataTrust({
    symbol: 'BTCUSDT',
    timeframe: '1h',
    provider: 'BINANCE_SPOT',
    candles: makeCandles(40),
    fetchedAtMs: nowMs - 600_000,
    nowMs,
    maxDataAgeMs: 120_000,
    isSyntheticSimulation: false,
  });

  assert.equal(result.freshness, 'STALE');
  assert.equal(result.executionAllowed, false);
  assert.ok(result.blockingReasons.some((r) => r.includes('stale')));
});

test('Step 2 Market Data Trust: blocks synthetic fallback cache when verified feed is required', () => {
  const nowMs = 1760500000000;
  const result = evaluateMarketDataTrust({
    symbol: 'ETHUSDT',
    timeframe: '1h',
    provider: 'SIMULATED_FALLBACK_CACHE',
    candles: makeCandles(40, 3400),
    fetchedAtMs: nowMs - 2_000,
    nowMs,
    isSyntheticSimulation: true,
    requireVerifiedLiveFeed: true,
  });

  assert.equal(result.isSyntheticSimulation, true);
  assert.equal(result.executionAllowed, false);
  assert.ok(result.blockingReasons.some((r) => r.includes('synthetic fallback')));
});

test('Step 2 Market Data Trust: detects inconsistent inverted OHLCV candles and blocks execution', () => {
  const bad = makeCandles(30);
  bad[12] = { ...bad[12], high: bad[12].low - 50 };
  const integrity = validateCandleSeriesIntegrity(bad);
  assert.equal(integrity.valid, false);

  const nowMs = 1760500000000;
  const result = evaluateMarketDataTrust({
    symbol: 'SOLUSDT',
    timeframe: '1h',
    provider: 'BINANCE_SPOT',
    candles: bad,
    fetchedAtMs: nowMs - 1_000,
    nowMs,
    isSyntheticSimulation: false,
  });

  assert.equal(result.freshness, 'INCONSISTENT');
  assert.equal(result.executionAllowed, false);
});

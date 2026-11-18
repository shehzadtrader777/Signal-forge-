import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDeterministicCandles } from './marketData';
import { aggregateMultiExchangeDepth, buildAnchoredExchangeBook } from './orderBookDepth';
import { evaluateSentinelAgent, type CrossPlatformFeedSignal } from './sentinelAgent';

test('evaluateSentinelAgent detects cross-platform FUD dump and triggers preemptive crash hedge capped at 5% SL', () => {
  const candles = generateDeterministicCandles('BTCUSDT', '15m', 40, undefined, 65000);
  // Simulate sudden drop below recent bars
  const prevClose = candles[candles.length - 4].close;
  const crashPrice = Number((prevClose * 0.962).toFixed(2)); // -3.8% sudden drop
  candles[candles.length - 1] = {
    ...candles[candles.length - 1],
    close: crashPrice,
    low: crashPrice * 0.996,
    volume: candles[candles.length - 2].volume * 2.4,
  };

  const depth = aggregateMultiExchangeDepth(
    'BTCUSDT',
    [
      buildAnchoredExchangeBook({
        exchange: 'BINANCE',
        symbol: 'BTCUSDT',
        liveWsPrice: crashPrice,
        change24hPercent: -7.5,
        volume24hUsd: 2_400_000_000,
      }),
    ],
    crashPrice
  );

  const crossSignals: CrossPlatformFeedSignal[] = [
    {
      id: 'x_1',
      platform: 'X',
      handle: '@tier10k',
      headline: 'BTC exploit / exchange halt rumor triggering liquidation cascade',
      symbols: ['BTC'],
      sentiment: 'PANIC_FUD',
      credibilityWeight: 0.9,
      timestamp: new Date().toISOString(),
    },
    {
      id: 'cp_1',
      platform: 'CRYPTOPANIC',
      handle: '@CoinDesk',
      headline: 'Bitcoin faces flash crash pressure amid heavy exchange inflows',
      symbols: ['BTC'],
      sentiment: 'PANIC_FUD',
      credibilityWeight: 0.85,
      timestamp: new Date().toISOString(),
    },
  ];

  const assessment = evaluateSentinelAgent({
    symbol: 'BTCUSDT',
    liveWsPrice: crashPrice,
    change24hPercent: -7.5,
    candles,
    crossPlatformSignals: crossSignals,
    depthAnalysis: depth,
  });

  assert.equal(assessment.regime, 'PANIC_FUD');
  assert.equal(assessment.verificationStatus, 'VERIFIED_CROSS_PLATFORM');
  assert.equal(assessment.recommendedAction, 'PREEMPTIVE_HEDGE_SHORT');
  assert.ok(assessment.preemptivePlan);
  assert.equal(assessment.preemptivePlan.direction, 'SELL');
  assert.ok(
    assessment.preemptivePlan.stopLossPct <= 5.0,
    `Expected <= 5.0% SL cap, got ${assessment.preemptivePlan.stopLossPct}%`
  );
  assert.ok(assessment.preemptivePlan.trailingTakeProfit5xAtr < crashPrice);
});

test('evaluateSentinelAgent detects verified breakout pump surge and signals reversal exit when hedge active', () => {
  const candles = generateDeterministicCandles('SOLUSDT', '15m', 40, undefined, 140);
  const basePrice = candles[candles.length - 4].close;
  const pumpPrice = Number((basePrice * 1.036).toFixed(2));
  candles[candles.length - 1] = {
    ...candles[candles.length - 1],
    close: pumpPrice,
    high: pumpPrice * 1.004,
    volume: candles[candles.length - 2].volume * 2.2,
  };

  const depth = aggregateMultiExchangeDepth(
    'SOLUSDT',
    [
      buildAnchoredExchangeBook({
        exchange: 'BINANCE',
        symbol: 'SOLUSDT',
        liveWsPrice: pumpPrice,
        change24hPercent: 8.8,
        volume24hUsd: 950_000_000,
      }),
    ],
    pumpPrice
  );

  const surge = evaluateSentinelAgent({
    symbol: 'SOLUSDT',
    liveWsPrice: pumpPrice,
    change24hPercent: 8.8,
    candles,
    crossPlatformSignals: [
      {
        id: 'x_sol',
        platform: 'X',
        handle: '@SolanaFloor',
        headline: 'SOL institutional adoption ETF filing approval catalyst confirmed',
        symbols: ['SOL'],
        sentiment: 'BULLISH_CATALYST',
        credibilityWeight: 0.9,
        timestamp: new Date().toISOString(),
      },
    ],
    depthAnalysis: depth,
  });

  assert.equal(surge.regime, 'PUMP_SURGE');
  assert.equal(surge.recommendedAction, 'PREEMPTIVE_MOMENTUM_LONG');
  assert.ok(surge.preemptivePlan && surge.preemptivePlan.stopLossPct <= 5.0);

  const reversal = evaluateSentinelAgent({
    symbol: 'SOLUSDT',
    liveWsPrice: pumpPrice,
    change24hPercent: 2.5,
    candles,
    depthAnalysis: depth,
    hasActiveHedge: true,
  });
  assert.equal(reversal.regime, 'REVERSAL_CONFIRMED');
  assert.equal(reversal.recommendedAction, 'EXIT_HEDGE_REVERSAL');
});

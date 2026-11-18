import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateMultiExchangeDepth,
  buildAnchoredExchangeBook,
  normalizeExchangeOrderBook,
} from './orderBookDepth';

test('normalizeExchangeOrderBook detects bid whale walls and positive OBI accurately', () => {
  const snap = normalizeExchangeOrderBook({
    exchange: 'BINANCE',
    symbol: 'BTCUSDT',
    bids: [
      [65000, 1.2],
      [64950, 1.5],
      [64800, 18.0], // $1.16M whale bid wall
    ],
    asks: [
      [65020, 0.8],
      [65080, 1.0],
      [65200, 1.1],
    ],
    source: 'live_ws',
  });

  assert.equal(snap.exchange, 'BINANCE');
  assert.ok(snap.imbalanceRatio > 0.5);
  assert.equal(snap.whaleWallSide, 'BID_WALL');
  assert.ok(snap.largestWhaleWallUsd > 1_000_000);
});

test('aggregateMultiExchangeDepth identifies institutional accumulation vs distribution walls across venues', () => {
  const binance = normalizeExchangeOrderBook({
    exchange: 'BINANCE',
    symbol: 'SOLUSDT',
    bids: [
      [140, 2000],
      [139.5, 4500],
    ],
    asks: [
      [140.1, 600],
      [140.8, 700],
    ],
    source: 'live_ws',
  });
  const bybit = buildAnchoredExchangeBook({
    exchange: 'BYBIT',
    symbol: 'SOLUSDT',
    liveWsPrice: 140.05,
    change24hPercent: 8.4,
    volume24hUsd: 800_000_000,
  });
  const okx = buildAnchoredExchangeBook({
    exchange: 'OKX',
    symbol: 'SOLUSDT',
    liveWsPrice: 140.04,
    change24hPercent: 8.4,
    volume24hUsd: 650_000_000,
  });

  const depth = aggregateMultiExchangeDepth('SOLUSDT', [binance, bybit, okx], 140.05);
  assert.equal(depth.exchanges.length, 3);
  assert.equal(depth.imbalanceBias, 'BULLISH');
  assert.equal(depth.liquidityShift, 'INSTITUTIONAL_ACCUMULATION');
  assert.ok(depth.netOrderBookImbalance > 0.14);
  assert.ok(depth.whaleWalls.length > 0);
});

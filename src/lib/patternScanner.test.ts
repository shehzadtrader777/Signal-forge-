import assert from 'node:assert/strict';
import test from 'node:test';
import type { Candle, CoinMeta } from './marketData';
import {
  DEFAULT_PATTERN_SCANNER_PARAMS,
  detectChartPatternStructure,
  scanCoinChartPattern,
  scanMarketPatterns,
} from './patternScanner';

const SAMPLE_COIN: CoinMeta = {
  symbol: 'BTCUSDT',
  baseAsset: 'BTC',
  name: 'Bitcoin',
  referencePrice: 90000,
  dailyVolatility: 0.032,
};

const SECOND_COIN: CoinMeta = {
  symbol: 'ETHUSDT',
  baseAsset: 'ETH',
  name: 'Ethereum',
  referencePrice: 3000,
  dailyVolatility: 0.042,
};

function makeBar(
  idx: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1000
): Candle {
  return {
    time: 1730000000 + idx * 14400,
    open,
    high,
    low,
    close,
    volume,
  };
}

function buildAscendingTriangleCandles(
  finalMode: 'CONFIRMED_BREAKOUT' | 'WICK_FAKEOUT' | 'LOW_VOL_FAKEOUT'
): Candle[] {
  const candles: Candle[] = [];
  // 36 prior structure bars: flat resistance at 105, rising lows from 95 -> 102
  for (let i = 0; i < 38; i++) {
    const segProgress = Math.min(1, i / 35);
    const floor = 95 + segProgress * 7.2; // rises steadily
    const ceiling = 105;
    const isTopTouch = i % 5 === 2;
    const low = isTopTouch ? floor + 1.2 : floor;
    const high = isTopTouch ? ceiling : floor + (ceiling - floor) * 0.65;
    const close = i === 36 ? 103.5 : i === 37 ? 104.1 : (low + high) / 2;
    const open = i % 2 === 0 ? close - 0.5 : close + 0.4;
    candles.push(makeBar(i, open, high, low, close, 1000));
  }

  // Replace the last candle (bar 39, idx 38) with our test breakout bar
  if (finalMode === 'CONFIRMED_BREAKOUT') {
    // Decisive close well above 105 (+1.9%), upper-half close, 2.2x volume
    candles.push(makeBar(38, 104.2, 107.4, 104.0, 107.0, 2200));
  } else if (finalMode === 'WICK_FAKEOUT') {
    // Spikes above 105 to 107.2, then closes back inside the triangle at 104.4
    candles.push(makeBar(38, 104.6, 107.2, 103.9, 104.4, 2100));
  } else {
    // Closes slightly above 105 (105.6) but with weak 0.75x volume
    candles.push(makeBar(38, 104.5, 105.9, 104.4, 105.6, 750));
  }

  return candles;
}

function buildDescendingTriangleCandles(
  finalMode: 'CONFIRMED_BREAKDOWN' | 'WICK_FAKEOUT'
): Candle[] {
  const candles: Candle[] = [];
  // 38 prior bars: flat support at 95, falling highs from 106 -> 97.5
  for (let i = 0; i < 38; i++) {
    const segProgress = Math.min(1, i / 35);
    const ceiling = 106 - segProgress * 8.5;
    const floor = 95;
    const isBottomTouch = i % 5 === 2;
    const low = isBottomTouch ? floor : floor + (ceiling - floor) * 0.35;
    const high = isBottomTouch ? floor + 1.5 : ceiling;
    const close = i === 36 ? 96.4 : i === 37 ? 95.8 : (low + high) / 2;
    const open = i % 2 === 0 ? close + 0.4 : close - 0.3;
    candles.push(makeBar(i, open, high, low, close, 1000));
  }

  if (finalMode === 'CONFIRMED_BREAKDOWN') {
    // Decisive breakdown close well below 95 (93.0), 2.1x volume, bearish body
    candles.push(makeBar(38, 95.6, 95.8, 92.6, 93.0, 2100));
  } else {
    // Pierces 95 down to 93.2 then reverses and closes back above 95 at 95.6
    candles.push(makeBar(38, 95.4, 96.0, 93.2, 95.6, 2000));
  }

  return candles;
}

function buildDoubleBottomCandles(): Candle[] {
  const candles: Candle[] = [];
  // seg0 [0..11]: drops to floor ~90; seg1 [12..23]: bounces to neckline 100; seg2 [24..35]: retests ~90.4
  for (let i = 0; i < 38; i++) {
    let low = 95;
    let high = 97;
    if (i < 12) {
      low = i === 6 ? 90.0 : 92.5;
      high = 95.5;
    } else if (i < 24) {
      low = 94.0;
      high = i === 18 ? 100.0 : 98.0;
    } else {
      low = i === 30 ? 90.5 : 93.0;
      high = 96.5;
    }
    const close = i >= 36 ? 99.4 : (low + high) / 2;
    candles.push(makeBar(i, close - 0.3, high, low, close, 1000));
  }
  candles.push(makeBar(38, 99.5, 102.2, 99.3, 101.8, 2200));
  return candles;
}

test('detectChartPatternStructure recognizes Ascending Triangle, Descending Triangle, and Double Bottom', () => {
  const asc = detectChartPatternStructure(buildAscendingTriangleCandles('CONFIRMED_BREAKOUT'));
  assert.ok(asc);
  assert.equal(asc.patternName, 'Ascending Triangle');
  assert.equal(asc.bias, 'BULLISH');

  const desc = detectChartPatternStructure(buildDescendingTriangleCandles('CONFIRMED_BREAKDOWN'));
  assert.ok(desc);
  assert.equal(desc.patternName, 'Descending Triangle');
  assert.equal(desc.bias, 'BEARISH');

  const dbl = detectChartPatternStructure(buildDoubleBottomCandles());
  assert.ok(dbl);
  assert.equal(dbl.patternName, 'Double Bottom');
  assert.equal(dbl.bias, 'BULLISH');
});

test('scanCoinChartPattern confirms high-volume Long Breakout with clean R:R levels', () => {
  const res = scanCoinChartPattern(
    SAMPLE_COIN,
    buildAscendingTriangleCandles('CONFIRMED_BREAKOUT'),
    { ...DEFAULT_PATTERN_SCANNER_PARAMS, riskRewardTarget: 3 }
  );
  assert.ok(res);
  assert.equal(res.status, 'CONFIRMED_SIGNAL');
  assert.equal(res.direction, 'BUY');
  assert.equal(res.moveType, 'BREAKOUT');
  assert.equal(res.fakeoutReasons.length, 0);
  assert.ok(res.volumeRatio >= 1.35);
  assert.ok(res.stopLoss < res.entryPrice);
  assert.ok(res.entryPrice < res.takeProfits[0]);
  assert.ok(res.takeProfits[0] < res.takeProfits[1]);
  assert.ok(res.takeProfits[1] < res.takeProfits[2]);
  assert.equal(res.riskRewardRatio, 3);
});

test('scanCoinChartPattern confirms high-volume Short Breakdown with valid downward targets', () => {
  const res = scanCoinChartPattern(
    SECOND_COIN,
    buildDescendingTriangleCandles('CONFIRMED_BREAKDOWN'),
    { ...DEFAULT_PATTERN_SCANNER_PARAMS, riskRewardTarget: 5 }
  );
  assert.ok(res);
  assert.equal(res.status, 'CONFIRMED_SIGNAL');
  assert.equal(res.direction, 'SELL');
  assert.equal(res.moveType, 'BREAKDOWN');
  assert.equal(res.fakeoutReasons.length, 0);
  assert.ok(res.stopLoss > res.entryPrice);
  assert.ok(res.entryPrice > res.takeProfits[0]);
  assert.ok(res.takeProfits[0] > res.takeProfits[1]);
  assert.ok(res.takeProfits[1] > res.takeProfits[2]);
  assert.equal(res.riskRewardRatio, 5);
});

test('strict anti-fakeout filter blocks wick traps and low-volume breakouts', () => {
  const wickFakeout = scanCoinChartPattern(
    SAMPLE_COIN,
    buildAscendingTriangleCandles('WICK_FAKEOUT'),
    DEFAULT_PATTERN_SCANNER_PARAMS
  );
  assert.ok(wickFakeout);
  assert.equal(wickFakeout.status, 'FILTERED_FAKEOUT');
  assert.ok(
    wickFakeout.fakeoutReasons.some((r) => r.toLowerCase().includes('wick trap')),
    `Expected wick trap rejection reason, got: ${wickFakeout.fakeoutReasons.join('; ')}`
  );

  const lowVolFakeout = scanCoinChartPattern(
    SAMPLE_COIN,
    buildAscendingTriangleCandles('LOW_VOL_FAKEOUT'),
    DEFAULT_PATTERN_SCANNER_PARAMS
  );
  assert.ok(lowVolFakeout);
  assert.equal(lowVolFakeout.status, 'FILTERED_FAKEOUT');
  assert.ok(
    lowVolFakeout.fakeoutReasons.some((r) => r.toLowerCase().includes('low volume')),
    `Expected low volume rejection reason, got: ${lowVolFakeout.fakeoutReasons.join('; ')}`
  );

  const bearWickTrap = scanCoinChartPattern(
    SECOND_COIN,
    buildDescendingTriangleCandles('WICK_FAKEOUT'),
    DEFAULT_PATTERN_SCANNER_PARAMS
  );
  assert.ok(bearWickTrap);
  assert.equal(bearWickTrap.status, 'FILTERED_FAKEOUT');
});

test('scanMarketPatterns enforces selected signalMode and parameter thresholds', () => {
  const map: Record<string, Candle[]> = {
    BTCUSDT: buildAscendingTriangleCandles('CONFIRMED_BREAKOUT'),
    ETHUSDT: buildDescendingTriangleCandles('CONFIRMED_BREAKDOWN'),
  };

  const bothSummary = scanMarketPatterns(
    map,
    { ...DEFAULT_PATTERN_SCANNER_PARAMS, signalMode: 'BOTH' },
    [SAMPLE_COIN, SECOND_COIN]
  );
  assert.equal(bothSummary.scannedCount, 2);
  assert.equal(bothSummary.confirmedSignals.length, 2);
  assert.ok(bothSummary.confirmedSignals.some((s) => s.direction === 'BUY'));
  assert.ok(bothSummary.confirmedSignals.some((s) => s.direction === 'SELL'));

  const longOnly = scanMarketPatterns(
    map,
    { ...DEFAULT_PATTERN_SCANNER_PARAMS, signalMode: 'LONG_ONLY' },
    [SAMPLE_COIN, SECOND_COIN]
  );
  assert.equal(longOnly.confirmedSignals.length, 1);
  assert.equal(longOnly.confirmedSignals[0].direction, 'BUY');

  const shortOnly = scanMarketPatterns(
    map,
    { ...DEFAULT_PATTERN_SCANNER_PARAMS, signalMode: 'SHORT_ONLY' },
    [SAMPLE_COIN, SECOND_COIN]
  );
  assert.equal(shortOnly.confirmedSignals.length, 1);
  assert.equal(shortOnly.confirmedSignals[0].direction, 'SELL');

  const ultraStrictVol = scanMarketPatterns(
    map,
    { ...DEFAULT_PATTERN_SCANNER_PARAMS, minVolumeMultiplier: 3.0 },
    [SAMPLE_COIN, SECOND_COIN]
  );
  assert.equal(ultraStrictVol.confirmedSignals.length, 0);
  assert.equal(ultraStrictVol.filteredFakeouts.length, 2);
});

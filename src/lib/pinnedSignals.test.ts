import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PINNED_SIGNALS,
  MIN_PINNED_SIGNALS,
  dropDivergentSeedPinnedSignals,
  evaluatePinnedSignalsLiveOutcome,
  rotateResolvedPinnedSignals,
  sanitizePinnedSignals,
  syncPinnedSignals,
} from './pinnedSignals';
import { type TradingSignal } from './signals';

function makeSignal(symbol: string, confidence: number, entry = 100): TradingSignal {
  return {
    id: `sig_${symbol}`,
    symbol,
    baseAsset: symbol.replace('USDT', ''),
    coinName: symbol,
    direction: 'BUY',
    entryPrice: entry,
    stopLoss: entry * 0.98,
    trailingStop: entry * 0.985,
    atrValue: entry * 0.012,
    dynamicRRs: [1.5, 2.5, 4.0],
    takeProfits: [entry * 1.03, entry * 1.05, entry * 1.08],
    confidence,
    technicalScore: 50,
    fundamentalScore: 10,
    indicators: {
      rsi: 55,
      ema9: entry,
      ema21: entry,
      ema50: entry,
      macdLine: 0,
      macdSignal: 0,
      macdHistogram: 0,
      bbUpper: entry * 1.04,
      bbMiddle: entry,
      bbLower: entry * 0.96,
      bbPercentB: 0.5,
      pattern: 'Bull Flag',
      score: 50,
      summary: 'Strong trend',
    },
    fundamental: {
      score: 10,
      articleCount: 1,
      bullishCount: 1,
      bearishCount: 0,
      topHeadline: 'Institutional flow',
      summary: 'Positive',
    },
    reason: 'Execution ready',
    generatedAt: '2026-11-15T00:00:00Z',
  };
}

test('syncPinnedSignals permanently pins top 5 active signals across rescans until resolved', () => {
  const initialBatch = [
    makeSignal('BTCUSDT', 91),
    makeSignal('ETHUSDT', 89),
    makeSignal('SOLUSDT', 87),
    makeSignal('AVAXUSDT', 86),
    makeSignal('LINKUSDT', 85),
  ];

  const pinned = syncPinnedSignals([], initialBatch, {}, 5);
  assert.equal(pinned.length, 5);

  // New scan produces stronger candidates, but all 5 existing active signals must remain pinned
  const nextScan = [makeSignal('SUIUSDT', 96), makeSignal('NEARUSDT', 94)];
  const afterRescan = syncPinnedSignals(pinned, nextScan, {}, 5);
  assert.deepEqual(
    afterRescan.map((p) => p.signal.symbol),
    ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'LINKUSDT']
  );
});

test('evaluatePinnedSignalsLiveOutcome trails ATR stop loss and locks final TP3/SL outcomes', () => {
  const pinned = syncPinnedSignals([], [makeSignal('BTCUSDT', 90, 100)], {}, 5);

  // Move to TP1 (103.5): advances ATR trailing SL up and remains pinned as TP1_HIT
  const atTp1 = evaluatePinnedSignalsLiveOutcome(pinned, { BTCUSDT: 103.5 });
  assert.equal(atTp1[0].status, 'TP1_HIT');
  assert.equal(atTp1[0].highestTpHit, 1);
  assert.ok(atTp1[0].trailingStopLoss > pinned[0].trailingStopLoss);

  // Move to TP3 (109): reaches final outcome TP3_WIN
  const atTp3 = evaluatePinnedSignalsLiveOutcome(atTp1, { BTCUSDT: 109 });
  assert.equal(atTp3[0].status, 'TP3_WIN');
  assert.ok(atTp3[0].resolvedAt);

  // Rotating resolved unlocks slot for new top signal
  const rotated = rotateResolvedPinnedSignals(atTp3, [makeSignal('SOLUSDT', 93, 200)], {}, 5);
  assert.deepEqual(
    rotated.map((p) => p.signal.symbol),
    ['SOLUSDT']
  );
});

test('dropDivergentSeedPinnedSignals clears stale pre-hydration seeds when live mark diverges', () => {
  const pinned = syncPinnedSignals(
    [],
    [makeSignal('BTCUSDT', 91, 91420), makeSignal('ETHUSDT', 88, 1806)],
    {},
    5
  );
  const filtered = dropDivergentSeedPinnedSignals(pinned, {
    BTCUSDT: 64613.9,
    ETHUSDT: 1808.5,
  });
  assert.deepEqual(
    filtered.map((p) => p.signal.symbol),
    ['ETHUSDT']
  );
});

test('pinnedSignals helpers return exact same reference when nothing changes', () => {
  const initialBatch = [
    makeSignal('BTCUSDT', 91, 100),
    makeSignal('ETHUSDT', 89, 100),
    makeSignal('SOLUSDT', 87, 100),
    makeSignal('AVAXUSDT', 86, 100),
    makeSignal('LINKUSDT', 85, 100),
  ];

  const pinned = syncPinnedSignals([], initialBatch, {}, 5);
  const resynced = syncPinnedSignals(pinned, initialBatch, {}, 5);
  assert.strictEqual(resynced, pinned);

  const unchangedOutcome = evaluatePinnedSignalsLiveOutcome(pinned, {
    BTCUSDT: 100,
    ETHUSDT: 100,
    SOLUSDT: 100,
    AVAXUSDT: 100,
    LINKUSDT: 100,
  });
  assert.strictEqual(unchangedOutcome, pinned);

  const unchangedFilter = dropDivergentSeedPinnedSignals(pinned, {
    BTCUSDT: 100,
    ETHUSDT: 100,
  });
  assert.strictEqual(unchangedFilter, pinned);
});

test('sanitizePinnedSignals strips malformed legacy entries and duplicate symbols cleanly', () => {
  const valid = syncPinnedSignals([], [makeSignal('BTCUSDT', 92, 65000)], {}, 5)[0];
  const duplicateBtc = syncPinnedSignals([], [makeSignal('BTCUSDT', 88, 64000)], {}, 5)[0];
  const malformed = [
    null,
    {},
    { signal: { symbol: 'ETHUSDT' }, status: 'ACTIVE' },
    { ...valid, signal: { ...valid.signal, takeProfits: [100] } },
    valid,
    duplicateBtc,
  ];

  const sanitized = sanitizePinnedSignals(malformed);
  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].signal.symbol, 'BTCUSDT');
  assert.equal(sanitized[0].signal.entryPrice, 65000);

  // When fewer than 5 candidates exist, repeated syncPinnedSignals still returns exact reference
  const subFive = syncPinnedSignals(sanitized, [makeSignal('BTCUSDT', 92, 65000)], {}, 5);
  assert.strictEqual(subFive, sanitized);
});

test('MIN_PINNED_SIGNALS=6 and MAX_PINNED_SIGNALS=12 support 6-12 active multi-column dashboard cards with wide ATR trail', () => {
  assert.equal(MIN_PINNED_SIGNALS, 6);
  assert.equal(MAX_PINNED_SIGNALS, 12);

  const symbols = [
    'BTCUSDT',
    'ETHUSDT',
    'SOLUSDT',
    'BNBUSDT',
    'XRPUSDT',
    'ADAUSDT',
    'AVAXUSDT',
    'DOGEUSDT',
    'LINKUSDT',
    'DOTUSDT',
    'SUIUSDT',
    'NEARUSDT',
    'TONUSDT',
  ];
  const candidates = symbols.map((sym, i) => ({
    ...makeSignal(sym, 95 - i, 100),
    trailingAtrMultiplier: i < 2 ? 2.25 : 1.25,
  }));

  const pinned = syncPinnedSignals([], candidates, {}, MAX_PINNED_SIGNALS);
  assert.equal(pinned.length, 12);
  assert.equal(pinned[0].signal.trailingAtrMultiplier, 2.25);

  const progressed = evaluatePinnedSignalsLiveOutcome(pinned, {
    BTCUSDT: 105,
  });
  assert.ok(progressed[0].trailingStopLoss >= pinned[0].trailingStopLoss);
});

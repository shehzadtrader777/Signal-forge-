import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTechnicalStructure,
  detectSwingPivots,
} from './technicalStructureEngine.ts';
import type { Candle } from './marketData.ts';

function buildStructuredBullishCandles(count = 60): Candle[] {
  const candles: Candle[] = [];
  const startTime = 1_700_000_000;
  let price = 100;
  for (let i = 0; i < count; i++) {
    // Deterministic multi-swing uptrend: wave + linear drift
    const wave = Math.sin(i * 0.65) * 4.5;
    const close = Number((100 + i * 0.45 + wave).toFixed(2));
    const open = i === 0 ? 100 : price;
    const high = Number((Math.max(open, close) + 1.4).toFixed(2));
    const low = Number((Math.min(open, close) - 1.4).toFixed(2));
    candles.push({
      time: startTime + i * 3600,
      open,
      high,
      low,
      close,
      volume: 1200 + (i % 7) * 250,
    });
    price = close;
  }
  return candles;
}

test('technicalStructureEngine detects genuine swing pivots, S/R, BOS/CHoCH, breakout-retest, and swing-anchored trendline', () => {
  const candles = buildStructuredBullishCandles(60);
  const pivots = detectSwingPivots(candles, 3);
  assert.ok(pivots.length >= 4, 'Expected at least 4 genuine fractal pivots');

  const analysis = computeTechnicalStructure(candles);
  assert.ok(analysis.supportLevel !== null, 'Expected documented support level');
  assert.ok(analysis.resistanceLevel !== null, 'Expected documented resistance level');
  assert.ok(analysis.supportLevel!.touches >= 1);
  assert.ok(analysis.resistanceLevel!.touches >= 1);
  assert.ok(analysis.structureEvents.length >= 1, 'Expected at least one BOS/CHoCH structure event');
  assert.ok(analysis.breakoutRetest !== null, 'Expected breakout-retest zone from real break');
  assert.ok(analysis.trendline !== null, 'Expected swing-anchored trendline');

  // Verify trendline coordinates match real candle timestamps (never random)
  const validTimes = new Set(candles.map((c) => c.time));
  assert.equal(validTimes.has(analysis.trendline!.startTime), true);
  assert.equal(validTimes.has(analysis.trendline!.endTime), true);
  assert.ok(analysis.trendline!.endTime > analysis.trendline!.startTime);

  assert.ok(analysis.strategyEvidence.length >= 2);
  assert.ok(analysis.invalidationConditions.length >= 1);
});

test('technicalStructureEngine gracefully handles insufficient candles without fabricating levels', () => {
  const tiny = buildStructuredBullishCandles(6);
  const analysis = computeTechnicalStructure(tiny);
  assert.equal(analysis.supportLevel, null);
  assert.equal(analysis.resistanceLevel, null);
  assert.equal(analysis.trendline, null);
  assert.equal(analysis.structureEvents.length, 0);
});

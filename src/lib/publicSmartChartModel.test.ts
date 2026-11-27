import test from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from './marketData';
import { SEEDED_CANONICAL_TRADE_LEDGER, type CanonicalTradeRecord } from './tradeLifecycleLedger';
import {
  classifyTradeEnvironment,
  computeVerifiedTradePnl,
  resolveTradeChartOverlay,
  validatePublicTradeIdInput,
} from './publicSmartChartModel';

function makeHourlyCandles(startIso: string, count: number, basePrice: number): Candle[] {
  const startSec = Math.floor(new Date(startIso).getTime() / 1000);
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const p = basePrice + i * 2;
    out.push({
      time: startSec + i * 3600,
      open: p,
      high: p + 8,
      low: p - 6,
      close: p + 3,
      volume: 1500 + i * 10,
    });
  }
  return out;
}

test('validatePublicTradeIdInput rejects empty and malformed inputs cleanly without fallback substitution', () => {
  const empty = validatePublicTradeIdInput('   ');
  assert.equal(empty.valid, false);
  assert.equal(empty.normalized, '');
  assert.ok(empty.error);

  const malformed = validatePublicTradeIdInput('DROP TABLE;');
  assert.equal(malformed.valid, false);
  assert.ok(malformed.error);

  const valid = validatePublicTradeIdInput(' sf-2026-000103 ');
  assert.equal(valid.valid, true);
  assert.equal(valid.normalized, 'SF-2026-000103');
  assert.equal(valid.error, null);
});

test('resolveTradeChartOverlay returns null before a Trade ID is provided (zero fabricated annotations)', () => {
  const candles = makeHourlyCandles('2026-11-21T00:00:00.000Z', 48, 1680);
  assert.equal(resolveTradeChartOverlay(null, candles), null);
});

test('closed DEMO trade SF-2026-000103 produces DEMO classification, breakout line, entry/exit markers, and net verified PnL', () => {
  const demoTrade = SEEDED_CANONICAL_TRADE_LEDGER.find((r) => r.tradeId === 'SF-2026-000103');
  assert.ok(demoTrade);

  const env = classifyTradeEnvironment(demoTrade);
  assert.equal(env.shortMode, 'DEMO');
  assert.equal(env.isRealCapital, false);
  assert.match(env.badgeLabel, /DEMO/i);
  assert.equal(env.statusLabel, 'Closed at Take Profit');

  const pnl = computeVerifiedTradePnl(demoTrade);
  assert.equal(pnl.isRealized, true);
  assert.equal(pnl.grossPnlUsd, 148.6);
  assert.equal(pnl.feesUsd, 3.12);
  assert.equal(pnl.netPnlUsd, 145.48);

  const candles = makeHourlyCandles('2026-11-21T00:00:00.000Z', 40, 1680);
  const overlay = resolveTradeChartOverlay(demoTrade, candles);
  assert.ok(overlay);
  assert.equal(overlay.entryTimestampMatchedInWindow, true);
  assert.equal(overlay.exitTimestampMatchedInWindow, true);
  assert.equal(overlay.windowNotice, null);

  // Breakout + Entry + SL + TP lines
  assert.equal(overlay.priceLines.length, 4);
  assert.ok(overlay.priceLines.some((l) => l.id === 'breakout_level'));
  assert.ok(overlay.priceLines.some((l) => l.id === 'entry'));
  assert.ok(overlay.priceLines.some((l) => l.id === 'stop_loss'));
  assert.ok(overlay.priceLines.some((l) => l.id === 'take_profit'));

  // Pattern + Entry + Exit markers in strictly ascending time order
  assert.equal(overlay.markers.length, 3);
  assert.ok(overlay.markers[0].time < overlay.markers[1].time);
  assert.ok(overlay.markers[1].time < overlay.markers[2].time);
  assert.match(overlay.markers[2].text, /TP Exit/i);
});

test('SIGNAL_ONLY trade SF-2026-000101 strips realized PnL and never emits an exit execution marker', () => {
  const signalRec = SEEDED_CANONICAL_TRADE_LEDGER.find((r) => r.tradeId === 'SF-2026-000101');
  assert.ok(signalRec);

  const env = classifyTradeEnvironment(signalRec);
  assert.equal(env.shortMode, 'SIGNAL ONLY');
  assert.equal(env.isRealCapital, false);

  const pnl = computeVerifiedTradePnl(signalRec);
  assert.equal(pnl.isRealized, false);
  assert.equal(pnl.netPnlUsd, null);
  assert.match(pnl.displayLabel, /Signal Only/i);

  const candles = makeHourlyCandles('2026-11-22T06:00:00.000Z', 24, 61000);
  const overlay = resolveTradeChartOverlay(signalRec, candles);
  assert.ok(overlay);
  assert.equal(overlay.markers.some((m) => m.id === 'exit'), false);
  assert.ok(overlay.markers.some((m) => m.id === 'entry' && m.text.includes('Signal')));
});

test('OPEN PAPER trade SF-2026-000102 distinguishes PAPER mode and omits exit marker until closed', () => {
  const paperOpen = SEEDED_CANONICAL_TRADE_LEDGER.find((r) => r.tradeId === 'SF-2026-000102');
  assert.ok(paperOpen);

  const env = classifyTradeEnvironment(paperOpen);
  assert.equal(env.shortMode, 'PAPER');
  assert.equal(env.isRealCapital, false);
  assert.equal(env.statusLabel, 'Open Position');

  const pnl = computeVerifiedTradePnl(paperOpen);
  assert.equal(pnl.isRealized, false);
  assert.equal(pnl.netPnlUsd, null);

  const candles = makeHourlyCandles('2026-11-22T12:00:00.000Z', 20, 70.5);
  const overlay = resolveTradeChartOverlay(paperOpen, candles);
  assert.ok(overlay);
  assert.equal(overlay.markers.some((m) => m.id === 'exit'), false);
});

test('LIVE trade classification explicitly marks real capital distinctly from PAPER and DEMO', () => {
  const base = SEEDED_CANONICAL_TRADE_LEDGER[2];
  const liveSample: CanonicalTradeRecord = {
    ...base,
    tradeId: 'SF-2026-LIVE-TEST',
    tradingMode: 'LIVE',
  };
  const env = classifyTradeEnvironment(liveSample);
  assert.equal(env.shortMode, 'LIVE');
  assert.equal(env.isRealCapital, true);
  assert.match(env.badgeLabel, /REAL CAPITAL/i);
});

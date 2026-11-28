import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEEDED_CANONICAL_TRADE_LEDGER,
  computeProjectedRrRatio,
  computeSlippageBps,
  enforceTradeRecordTruthInvariants,
  lookupCanonicalTradeById,
  summarizeVerifiedPerformance,
  type CanonicalTradeRecord,
} from './tradeLifecycleLedger';

test('enforceTradeRecordTruthInvariants strips realized PnL and execution prices from SIGNAL_ONLY records', () => {
  const pollutedSignal: CanonicalTradeRecord = {
    ...SEEDED_CANONICAL_TRADE_LEDGER[0],
    recordClass: 'SIGNAL_ONLY',
    actualExecutionPrice: 91250,
    feesUsd: 2.5,
    realizedPnlUsd: 9999,
    realizedPnlPct: 120,
    closedAtIso: '2026-11-22T18:00:00.000Z',
  };

  const sanitized = enforceTradeRecordTruthInvariants(pollutedSignal);
  assert.equal(sanitized.actualExecutionPrice, null);
  assert.equal(sanitized.slippageBps, null);
  assert.equal(sanitized.feesUsd, null);
  assert.equal(sanitized.realizedPnlUsd, null);
  assert.equal(sanitized.realizedPnlPct, null);
  assert.equal(sanitized.closedAtIso, null);
});

test('summarizeVerifiedPerformance strictly separates signals from executed trades and deducts fees', () => {
  const summary = summarizeVerifiedPerformance(SEEDED_CANONICAL_TRADE_LEDGER);
  assert.equal(summary.publishedSignalsCount, 1);
  assert.equal(summary.executedTradesCount, 3);
  assert.equal(summary.openExecutedCount, 1);
  assert.equal(summary.closedExecutedCount, 2);
  assert.equal(summary.winningClosedTrades, 1);
  assert.equal(summary.losingClosedTrades, 1);
  assert.equal(summary.verifiedWinRatePct, 50);
  // Realized gross: +148.60 - 44.80 = 103.80; fees: 1.47 + 3.12 + 1.95 = 6.54
  assert.equal(summary.totalRealizedPnlUsd, 103.8);
  assert.equal(summary.totalFeesUsd, 6.54);
  assert.equal(summary.netRealizedPnlAfterFeesUsd, 97.26);
  assert.equal(summary.modeBreakdown.LIVE, 0);
  assert.equal(summary.modeBreakdown.PAPER, 2);
  assert.equal(summary.modeBreakdown.DEMO, 1);
});

test('computeSlippageBps and computeProjectedRrRatio calculate accurate numeric values', () => {
  assert.equal(computeSlippageBps(100, 100.1), 10);
  assert.equal(computeSlippageBps(100, null), null);
  assert.equal(computeProjectedRrRatio('BUY', 100, 95, 115), 3);
  assert.equal(computeProjectedRrRatio('SELL', 100, 105, 85), 3);
});

test('lookupCanonicalTradeById finds records by exact Trade ID or case-insensitive query', () => {
  const found = lookupCanonicalTradeById('sf-2026-000103', SEEDED_CANONICAL_TRADE_LEDGER);
  assert.ok(found);
  assert.equal(found?.pair, 'ETHUSDT');
  assert.equal(found?.executionStatus, 'CLOSED_TP');
  assert.equal(lookupCanonicalTradeById('SF-DOES-NOT-EXIST', SEEDED_CANONICAL_TRADE_LEDGER), null);
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SIGNAL_HISTORY_FILTERS,
  buildUnifiedSignalHistory,
  computeHistoryPerformanceMetrics,
  computeStrategyAttribution,
  computeSymbolAttribution,
  filterSignalHistory,
  signalHistoryToCsv,
} from './signalHistory';
import { type SandboxPosition } from './coordinator';
import { type PinnedSignalRecord } from './pinnedSignals';

const SAMPLE_POSITION_CLOSED: SandboxPosition = {
  id: 'pos_btc_closed_1',
  symbol: 'BTCUSDT',
  direction: 'BUY',
  mode: 'TESTNET',
  marketType: 'SPOT',
  entryPrice: 90000,
  quantity: 0.02,
  notionalUsd: 1800,
  initialStopLoss: 88500,
  trailingStopLoss: 91200,
  takeProfits: [93000, 95250, 97500],
  status: 'CLOSED_TP',
  pnlUsd: 60.0,
  pnlPercent: 3.33,
  skepticVerdict: 'APPROVED',
  openedAt: '2026-11-14T10:00:00.000Z',
  closedAt: '2026-11-15T09:15:00.000Z',
};

const SAMPLE_PINNED_LOSS: PinnedSignalRecord = {
  signal: {
    id: 'sig_eth_loss',
    symbol: 'ETHUSDT',
    baseAsset: 'ETH',
    coinName: 'Ethereum',
    direction: 'SELL',
    entryPrice: 3200,
    stopLoss: 3280,
    trailingStop: 3280,
    atrValue: 45,
    dynamicRRs: [2, 3.5, 5],
    takeProfits: [3040, 2920, 2800],
    confidence: 88,
    technicalScore: -42,
    fundamentalScore: 0,
    indicators: {
      rsi: 41,
      ema9: 3190,
      ema21: 3220,
      ema50: 3260,
      macdLine: -4,
      macdSignal: -2,
      macdHistogram: -2,
      bbUpper: 3300,
      bbMiddle: 3210,
      bbLower: 3120,
      bbPercentB: 0.4,
      pattern: 'Rising Wedge (BREAKDOWN)',
      score: -42,
      summary: 'Breakdown',
    },
    fundamental: {
      score: 0,
      articleCount: 0,
      bullishCount: 0,
      bearishCount: 0,
      topHeadline: 'No active fundamental catalyst',
      summary: 'Neutral',
    },
    reason: 'Bearish wedge breakdown',
    generatedAt: '2026-11-14T08:00:00.000Z',
  },
  pinnedAt: '2026-11-14T08:00:00.000Z',
  status: 'SL_STOPPED',
  highestTpHit: 0,
  atr14: 45,
  trailingStopLoss: 3280,
  currentPrice: 3280,
  unrealizedR: -1,
  resolvedAt: '2026-11-14T14:30:00.000Z',
  outcomePrice: 3280,
  realizedR: -1,
};

describe('Signal History Audit Trail & Performance Attribution', () => {
  it('merges live executed orders, pinned outcomes, and cross-pair historical simulations', () => {
    const records = buildUnifiedSignalHistory({
      positions: [SAMPLE_POSITION_CLOSED],
      pinnedSignals: [SAMPLE_PINNED_LOSS],
      includeCrossStrategyBenchmarks: true,
    });

    assert.ok(records.length >= 20, 'Expected comprehensive cross-pair & live history');
    assert.equal(records[0].origin, 'EXECUTED_ORDER');
    assert.equal(records[0].symbol, 'BTCUSDT');
    assert.equal(records[0].status, 'WIN');

    const ethPinned = records.find((r) => r.origin === 'LIVE_PINNED');
    assert.ok(ethPinned, 'Expected pinned signal record');
    assert.equal(ethPinned.status, 'LOSS');
    assert.equal(ethPinned.pnlR, -1);
  });

  it('computes accurate performance metrics, strategy attribution, and symbol attribution', () => {
    const records = buildUnifiedSignalHistory({
      positions: [SAMPLE_POSITION_CLOSED],
      pinnedSignals: [SAMPLE_PINNED_LOSS],
      backtestRecords: [], // falls back to global + cross-strategy cleanly
    });

    const summary = computeHistoryPerformanceMetrics(records);
    assert.equal(summary.totalRecords, records.length);
    assert.equal(summary.wins + summary.losses + summary.activeTrades, summary.totalRecords);
    assert.ok(summary.winRatePct >= 0 && summary.winRatePct <= 100);
    assert.ok(summary.avgConfidencePct > 50);

    const strategyAttr = computeStrategyAttribution(records);
    assert.ok(strategyAttr.length >= 3, 'Expected multi-module strategy attribution rows');
    const executedRow = strategyAttr.find((r) => r.key === 'EXECUTED');
    assert.ok(executedRow);
    assert.equal(executedRow.winRatePct, 100);
    assert.equal(executedRow.netR, 2);

    const symbolAttr = computeSymbolAttribution(records);
    assert.ok(symbolAttr.some((s) => s.symbol === 'BTCUSDT'));
  });

  it('filters records strictly by search, origin group, status, direction, and confidence and exports CSV', () => {
    const records = buildUnifiedSignalHistory({
      positions: [SAMPLE_POSITION_CLOSED],
      pinnedSignals: [SAMPLE_PINNED_LOSS],
    });

    const liveOnly = filterSignalHistory(records, {
      ...DEFAULT_SIGNAL_HISTORY_FILTERS,
      originGroup: 'LIVE_ONLY',
    });
    assert.equal(liveOnly.length, 2);

    const highConfShortLosses = filterSignalHistory(records, {
      ...DEFAULT_SIGNAL_HISTORY_FILTERS,
      status: 'LOSS',
      direction: 'SELL',
      minConfidence: 86,
      search: 'ETH',
    });
    assert.ok(highConfShortLosses.some((r) => r.symbol === 'ETHUSDT'));

    const csv = signalHistoryToCsv(liveOnly);
    assert.ok(csv.startsWith('TimestampUTC,Pair,Direction,Module'));
    assert.ok(csv.includes('BTCUSDT'));
    assert.ok(csv.includes('ETHUSDT'));
  });
});

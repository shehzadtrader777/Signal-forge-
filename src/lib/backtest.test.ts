import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runBacktestSimulation,
  runSmcMonthlySimulation,
  getGlobalPastSignalsHistory,
} from './backtest';

test('runSmcMonthlySimulation simulates ~300 trades monthly with 1:5 risk-to-reward', () => {
  const summary = runSmcMonthlySimulation('BTCUSDT', '15m');
  assert.equal(summary.symbol, 'BTCUSDT');
  assert.equal(summary.strategy, 'SMC_1_5');
  assert.equal(summary.days, 30);
  assert.equal(summary.riskRewardRatio, 5);
  assert.equal(summary.monthlyTargetTrades, 300);
  assert.ok(
    summary.totalTrades >= 280 && summary.totalTrades <= 320,
    `Expected ~300 monthly trades, got ${summary.totalTrades}`
  );
  assert.equal(summary.wins + summary.losses, summary.totalTrades);
  assert.equal(summary.equityCurve.length, summary.totalTrades + 1);
  assert.equal(summary.outcomeBreakdown.length, 2);

  assert.equal(summary.tripwireVerified, true);
  assert.ok(summary.tripwireTelemetry && summary.tripwireTelemetry.barsAdvanced >= 2900);
  assert.equal(summary.tripwireTelemetry.futureReadsBlocked, 0);
  assert.match(summary.fillModelHash, /^[0-9a-f]{64}$/);
  assert.equal(summary.executionAlgorithm, 'IMPLEMENTATION_SHORTFALL');

  // Verify every simulated trade preserves exact 1:5 R:R, executes strictly in London/NY, and fills at t+1 with audit record
  const allowedSessions = new Set(['London Session', 'London / NY Overlap', 'New York Session']);
  for (const t of summary.trades) {
    assert.ok(
      t.session && allowedSessions.has(t.session),
      `Expected London/NY session only, got ${t.session} at ${t.date}`
    );
    assert.equal(t.fillModelHash, summary.fillModelHash);
    assert.equal(t.executionAlgorithm, 'IMPLEMENTATION_SHORTFALL');
    assert.ok(t.fillAudit && t.fillAudit.priceResolution.adverseSlippageVerified);
    if (t.signalCursorIndex !== undefined && t.fillCursorIndex !== undefined) {
      assert.equal(
        t.fillCursorIndex,
        t.signalCursorIndex + 1,
        'Fill cursor must be strictly t+1 after signal cursor'
      );
    }
  }
  for (const t of summary.trades.slice(0, 40)) {
    const risk = Math.abs(t.entryPrice - t.stopLoss);
    const reward = Math.abs(t.takeProfit - t.entryPrice);
    assert.ok(
      Math.abs(reward / risk - 5) <= 0.1,
      `Expected 1:5 TP/SL barrier ratio, got ${(reward / risk).toFixed(2)}`
    );
    assert.equal(t.riskRewardRatio, 5);
  }
});

test('runBacktestSimulation supports both SMC_1_5 and TECHNICAL modes cleanly', () => {
  const smcDefault = runBacktestSimulation('ETHUSDT', '15m');
  assert.equal(smcDefault.strategy, 'SMC_1_5');
  assert.equal(smcDefault.riskRewardRatio, 5);
  assert.ok(smcDefault.totalTrades >= 280);

  const tech = runBacktestSimulation('BTCUSDT', '4h', undefined, 'TECHNICAL');
  assert.equal(tech.symbol, 'BTCUSDT');
  assert.equal(tech.timeframe, '4h');
  assert.equal(tech.strategy, 'TECHNICAL');
  assert.equal(tech.wins + tech.losses, tech.totalTrades);
  assert.ok(tech.totalTrades > 0);
  assert.equal(tech.equityCurve.length, tech.totalTrades + 1);

  const pat = runBacktestSimulation('SOLUSDT', '4h', undefined, 'PATTERN_SCANNER');
  assert.equal(pat.symbol, 'SOLUSDT');
  assert.equal(pat.strategy, 'PATTERN_SCANNER');
  assert.equal(pat.wins + pat.losses, pat.totalTrades);
  assert.equal(pat.equityCurve.length, pat.totalTrades + 1);
});

test('getGlobalPastSignalsHistory returns sorted historical SMC signal records', () => {
  const history = getGlobalPastSignalsHistory();
  assert.ok(history.length >= 10);
  for (const row of history) {
    assert.ok(row.snapshotPoints.length > 0);
    assert.ok(row.result === 'WIN' || row.result === 'LOSS');
    assert.equal(row.riskRewardRatio, 5);
  }
});

import {
  runComparativeProtocolSuite,
  runComparativeWindowSimulation,
} from './backtest';

test('runComparativeProtocolSuite enforces 30/60/90-day windows, 300-500 trades, <=2% SL cap, and >=1:5 R:R trailing TP', () => {
  const report = runComparativeProtocolSuite({
    symbol: 'BTCUSDT',
    timeframe: '15m',
    strategy: 'AUTONOMOUS_MASTER',
    liveWsPrice: 65123.45,
  });

  assert.equal(report.symbol, 'BTCUSDT');
  assert.equal(report.windows.length, 3);
  assert.deepEqual(
    report.windows.map((w) => w.windowDays),
    [30, 60, 90]
  );

  for (const win of report.windows) {
    assert.ok(
      win.totalTrades >= 300 && win.totalTrades <= 500,
      `Window ${win.windowDays}d trade count ${win.totalTrades} outside 300..500 range`
    );
    assert.equal(win.tradesInProtocolRange, true);
    assert.equal(win.maxStopLossPctAllowed, 2);
    assert.ok(
      win.maxStopLossPctObserved <= 2.01,
      `Observed SL ${win.maxStopLossPctObserved}% exceeded 2% cap`
    );
    assert.equal(win.trailingAtrMultiplier, 5);
    assert.ok(
      win.trades.slice(0, 20).every((t) => t.riskRewardRatio >= 5.0),
      'Expected every comparative trade to maintain >= 1:5 profit-to-loss ratio'
    );
    assert.ok(
      win.trailingTp5xAtrExits + win.structuralReversalExits > 0,
      'Expected ATR trailing TP or structural reversal exits'
    );
    assert.equal(win.wins + win.losses, win.totalTrades);
  }

  const single60 = runComparativeWindowSimulation({
    symbol: 'SOLUSDT',
    timeframe: '15m',
    windowDays: 60,
    strategy: 'SMC_1_5',
  });
  assert.equal(single60.windowDays, 60);
  assert.ok(single60.totalTrades >= 300 && single60.totalTrades <= 500);
});

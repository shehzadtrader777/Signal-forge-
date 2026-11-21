import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  HARD_CODED_RISK_PARAMETERS,
  computeNextPaperWinStreak,
  evaluateLiveDeploymentGate,
  evaluatePositionRiskTick,
  formatSystemAuditMessage,
  formatTelegramRpcResponse,
  validateAndPrepareCcxtSignal,
} from './freqtradeCoreEngine';
import { FreqtradeCoreServerRuntime } from './freqtradeCoreServer';

const ROOT_DIR = path.resolve(import.meta.dirname, '..', '..');

test('Unified CCXT Signal Router validates Spot & Futures across Binance/Bybit/OKX and enforces hard SL/TP', () => {
  const spotRoute = validateAndPrepareCcxtSignal({
    signalId: 'sig-1',
    exchange: 'binance',
    symbol: 'BTCUSDT',
    marketType: 'SPOT',
    side: 'BUY',
    entryPrice: 90_000,
    stakeUsd: 1_000,
    confidencePct: 86,
  });

  assert.equal(spotRoute.valid, true);
  assert.equal(spotRoute.normalizedSymbol, 'BTC/USDT');
  assert.equal(spotRoute.effectiveLeverage, 1);
  assert.ok(spotRoute.stopLoss < spotRoute.fillPrice, 'LONG stop-loss must sit below fill');
  assert.ok(spotRoute.takeProfit > spotRoute.fillPrice, 'LONG take-profit must sit above fill');

  const futuresRoute = validateAndPrepareCcxtSignal({
    signalId: 'sig-2',
    exchange: 'okx',
    symbol: 'ETH/USDT',
    marketType: 'FUTURES',
    side: 'SELL',
    entryPrice: 3_000,
    stakeUsd: 500,
    leverage: 5,
    confidencePct: 82,
  });
  assert.equal(futuresRoute.valid, true);
  assert.equal(futuresRoute.effectiveLeverage, 5);
  assert.equal(futuresRoute.notionalUsd, 2_500);
  assert.ok(futuresRoute.stopLoss > futuresRoute.fillPrice, 'SHORT stop-loss must sit above fill');
  assert.ok(futuresRoute.takeProfit < futuresRoute.fillPrice, 'SHORT take-profit must sit below fill');

  const invalidVenue = validateAndPrepareCcxtSignal({
    signalId: 'sig-bad',
    exchange: 'unknown_dex' as 'binance',
    symbol: 'BTC/USDT',
    marketType: 'SPOT',
    side: 'BUY',
    entryPrice: 90_000,
    stakeUsd: 500,
    confidencePct: 80,
  });
  assert.equal(invalidVenue.valid, false);
});

test('Hard-coded Risk Engine ratchets trailing stops and enforces 50-consecutive-profitable-paper-trades Live Gate', () => {
  // Trailing stop activation (+1.5%) & ratchet
  const tick1 = evaluatePositionRiskTick(
    {
      side: 'BUY',
      entryPrice: 100,
      stopLoss: 98,
      takeProfit: 106,
      trailingStop: null,
      peakPrice: 100,
    },
    102.5
  );
  assert.equal(tick1.closeReason, '');
  assert.ok(tick1.nextTrailingStop !== null && tick1.nextTrailingStop > 101);

  // Pullback breaches trailing stop
  const tick2 = evaluatePositionRiskTick(
    {
      side: 'BUY',
      entryPrice: 100,
      stopLoss: 98,
      takeProfit: 106,
      trailingStop: tick1.nextTrailingStop,
      peakPrice: tick1.nextPeakPrice,
    },
    101.0
  );
  assert.equal(tick2.closeReason, 'TRAILING_STOP');

  // 50-consecutive-win gate checks
  assert.equal(evaluateLiveDeploymentGate(0).unlocked, false);
  assert.equal(evaluateLiveDeploymentGate(49).unlocked, false);
  assert.equal(evaluateLiveDeploymentGate(49).remaining, 1);
  assert.equal(evaluateLiveDeploymentGate(50).unlocked, true);

  // Streak resets to 0 on any losing paper trade
  assert.equal(computeNextPaperWinStreak(49, 'PAPER_DRY_RUN', -12.5), 0);
  assert.equal(computeNextPaperWinStreak(49, 'PAPER_DRY_RUN', 25.0), 50);
  assert.equal(HARD_CODED_RISK_PARAMETERS.maxDailyDrawdownPct, 0.08);
});

test('SQLite Dry-Run Server Runtime enforces 50-win Live Gate, 8% daily drawdown cap, Telegram RPC commands, and path-confined source reads', () => {
  const runtime = new FreqtradeCoreServerRuntime(ROOT_DIR, {
    dbPath: ':memory:',
    initialEquityUsd: 10_000,
  });

  try {
    // 1. LIVE mode blocked at 0/50 wins
    const liveDenied = runtime.setTradingMode('LIVE');
    assert.equal(liveDenied.ok, false);
    assert.equal(liveDenied.statusCode, 403);
    assert.ok(liveDenied.message.includes('LIVE_GATE_LOCKED'));

    // 2. Execute 50 consecutive profitable paper trades -> unlocks LIVE mode
    for (let i = 1; i <= 50; i += 1) {
      const opened = runtime.executeStandardizedSignal({
        signalId: `win-${i}`,
        exchange: 'bybit',
        symbol: 'BTC/USDT',
        marketType: 'SPOT',
        side: 'BUY',
        entryPrice: 100,
        stakeUsd: 500,
        confidencePct: 90,
      });
      assert.equal(opened.ok, true);
      const closed = runtime.closePosition(opened.tradeId!, 104, 'TAKE_PROFIT');
      assert.equal(closed.ok, true);
    }

    const metricsAfter50 = runtime.getMetrics();
    assert.equal(metricsAfter50.consecutivePaperWins, 50);
    assert.equal(metricsAfter50.liveGateUnlocked, true);

    const liveAllowed = runtime.setTradingMode('LIVE');
    assert.equal(liveAllowed.ok, true);
    assert.equal(runtime.getMetrics().tradingMode, 'LIVE');

    // 3. Telegram RPC commands (/stop halts execution, /start resumes, /status & /profit report metrics)
    const stopRes = runtime.handleTelegramRpcCommand('/stop');
    assert.equal(stopRes.ok, true);
    assert.equal(runtime.getMetrics().botRunning, false);

    const blockedWhileStopped = runtime.executeStandardizedSignal({
      signalId: 'stopped-sig',
      exchange: 'binance',
      symbol: 'ETH/USDT',
      marketType: 'SPOT',
      side: 'BUY',
      entryPrice: 3000,
      stakeUsd: 500,
      confidencePct: 85,
    });
    assert.equal(blockedWhileStopped.ok, false);
    assert.ok(blockedWhileStopped.message.includes('BOT_STOPPED'));

    const startRes = runtime.handleTelegramRpcCommand('/start');
    assert.equal(startRes.ok, true);
    assert.equal(runtime.getMetrics().botRunning, true);

    const statusRes = runtime.handleTelegramRpcCommand('/status');
    assert.ok(statusRes.response.includes('Portfolio Value:'));
    const profitRes = runtime.handleTelegramRpcCommand('/profit');
    assert.ok(profitRes.response.includes('Consecutive Profitable Paper Streak: 50/50'));

    // 4. System audit formatter & path confinement
    const audit = runtime.recordSystemAudit(11.3);
    assert.ok(audit.formattedMessage.includes('CPU:'));
    assert.ok(audit.formattedMessage.includes('Memory:'));
    assert.ok(audit.formattedMessage.includes('Latency:'));
    assert.ok(formatSystemAuditMessage(audit).includes('Execution Errors:'));
    assert.equal(formatTelegramRpcResponse('/unknown', runtime.getMetrics()).recognized, false);

    const goodSrc = runtime.readAllowlistedCoreSource('ccxt_router');
    assert.equal(goodSrc.ok, true);
    assert.ok((goodSrc.content ?? '').includes('UnifiedCCXTRouter'));

    const badSrc = runtime.readAllowlistedCoreSource('../../.env');
    assert.equal(badSrc.ok, false);
    assert.equal(badSrc.statusCode, 400);
  } finally {
    runtime.close();
  }
});

test('SQLite Dry-Run Runtime enforces mandatory 8.0% Daily Drawdown circuit breaker', () => {
  const runtime = new FreqtradeCoreServerRuntime(ROOT_DIR, {
    dbPath: ':memory:',
    initialEquityUsd: 10_000,
  });

  try {
    // Open a large leveraged trade and close at a loss exceeding 8% of dayStartEquity ($800+)
    const opened = runtime.executeStandardizedSignal({
      signalId: 'dd-test-1',
      exchange: 'binance',
      symbol: 'SOL/USDT',
      marketType: 'FUTURES',
      side: 'BUY',
      entryPrice: 100,
      stakeUsd: 2_000,
      leverage: 5,
      confidencePct: 80,
    });
    assert.equal(opened.ok, true);
    const closed = runtime.closePosition(opened.tradeId!, 91, 'STOP_LOSS');
    assert.equal(closed.ok, true);

    const metrics = runtime.getMetrics();
    assert.equal(metrics.drawdownCircuitTripped, true);
    assert.ok(metrics.dailyDrawdownPct >= 0.08);
    assert.equal(metrics.consecutivePaperWins, 0);

    // Subsequent entry must be blocked by the 8% daily drawdown cap
    const blocked = runtime.executeStandardizedSignal({
      signalId: 'dd-blocked',
      exchange: 'binance',
      symbol: 'BTC/USDT',
      marketType: 'SPOT',
      side: 'BUY',
      entryPrice: 90_000,
      stakeUsd: 500,
      confidencePct: 92,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.statusCode, 403);
    assert.ok(blocked.message.includes('DAILY_DRAWDOWN_CAP_BREACHED'));
  } finally {
    runtime.close();
  }
});

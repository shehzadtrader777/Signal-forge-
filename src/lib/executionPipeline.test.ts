import test from 'node:test';
import assert from 'node:assert/strict';
import { BaseStreamBatcher } from './abstractPipeline';
import {
  EntryZoneExecutionValidator,
  PrePumpSupportExecutionModule,
  TelegramDispatchStabilizer,
  computeEntryZoneBounds,
  evaluateExecutedPositionLifecycle,
  type BackendExecutedOrderLog,
  type EntryZoneSignalCandidate,
} from './executionPipeline';

class MockTickerBatcher extends BaseStreamBatcher<string, { symbol: string; price: number }> {
  public extractKey(frame: { symbol: string; price: number }): string {
    return frame.symbol;
  }
}

test('EntryZoneExecutionValidator keeps signals pinned active outside Entry Zone and triggers auto-execution inside Entry Zone', () => {
  const validator = new EntryZoneExecutionValidator();
  const zone = computeEntryZoneBounds(90000, 0.5); // [89550, 90450]
  const candidate: EntryZoneSignalCandidate = {
    signalId: 'sig_btc_1',
    symbol: 'BTCUSDT',
    coinName: 'Bitcoin',
    direction: 'BUY',
    timeframe: '4h',
    entryPrice: 90000,
    entryZone: zone,
    stopLoss: 88200,
    takeProfits: [93600, 96300, 99000],
    confidence: 91,
    sourceModule: 'AI_ENGINE',
    reason: 'Structural demand retest',
    isPrePump: false,
    holdUntilMaxTarget: false,
    createdAt: new Date().toISOString(),
  };

  // Price outside Entry Zone -> remains active awaiting entry
  const outside = validator.evaluate({ candidate, livePrice: 91500 });
  assert.equal(outside.inEntryZone, false);
  assert.equal(outside.shouldAutoExecute, false);
  assert.equal(outside.state, 'AWAITING_ENTRY_ZONE');
  assert.ok(outside.distanceToZonePct > 1.0);

  // Price inside Entry Zone -> eligible for automated execution & transition to execution log
  const inside = validator.evaluate({ candidate, livePrice: 90120 });
  assert.equal(inside.inEntryZone, true);
  assert.equal(inside.shouldAutoExecute, true);
  assert.equal(inside.state, 'IN_ENTRY_ZONE');
  assert.equal(inside.distanceToZonePct, 0);
});

test('PrePumpSupportExecutionModule keeps estimated signals in research only and preserves position lifecycle', () => {
  const engine = new PrePumpSupportExecutionModule();
  const candidates = engine.process({
    topGainers: [
      {
        symbol: 'SOLUSDT',
        baseAsset: 'SOL',
        name: 'Solana',
        price: 210,
        change24hPercent: 11.4,
        volume24hUsd: 820_000_000,
        high24h: 215,
        low24h: 188,
        gainerRank: 1,
        isTopGainer: true,
        prePumpScore: 91,
        volumeAnomalyRatio: 3.1,
      },
    ],
    livePriceMap: { SOLUSDT: 210 },
    activePositionsBySymbol: {},
  });

  assert.equal(candidates.length, 1);
  const sol = candidates[0];
  assert.equal(sol.holdPolicy, 'HOLD_UNTIL_MAX_PROFIT');
  assert.equal(sol.supportConfirmed, true);
  assert.equal(sol.autoExecuteEligible, false);
  assert.equal(sol.verificationStatus, 'UNVERIFIED_VOLUME');
  assert.ok(sol.resistanceTargetMax > sol.takeProfits[1]);

  // Create executed order with HOLD_UNTIL_MAX_PROFIT mandate
  const order: BackendExecutedOrderLog = {
    executionId: 'exec_sol_1',
    signalId: 'sig_sol_1',
    symbol: 'SOLUSDT',
    direction: 'BUY',
    sourceModule: 'PRE_PUMP_SUPPORT',
    entryPrice: 210,
    executedPrice: 210,
    entryZone: computeEntryZoneBounds(210, 0.5),
    stopLoss: sol.stopLoss,
    takeProfits: sol.takeProfits,
    maxProfitTarget: sol.resistanceTargetMax,
    notionalUsd: 2000,
    leverage: 1,
    status: 'OPEN_EXECUTED',
    holdUntilMaxTarget: true,
    earlyLiquidationBlockedCount: 0,
    currentPrice: 210,
    progressToMaxTargetPct: 0,
    unrealizedPnlUsd: 0,
    unrealizedPnlPercent: 0,
    realizedPnlUsd: null,
    realizedPnlPercent: null,
    executedAt: new Date().toISOString(),
    closedAt: null,
    exitReason: null,
    telegramDispatched: true,
  };

  // Price reaches TP1 -> MUST NOT liquidate early when holdUntilMaxTarget is true
  const midCheck = evaluateExecutedPositionLifecycle(order, sol.takeProfits[0] + 0.5);
  assert.equal(midCheck.liquidatedNow, false);
  assert.equal(midCheck.blockedEarlyExit, true);
  assert.equal(midCheck.updated.status, 'OPEN_EXECUTED');
  assert.equal(midCheck.updated.earlyLiquidationBlockedCount, 1);

  // Price reaches Max Profit Target (TP3) -> automated liquidation triggers
  const maxCheck = evaluateExecutedPositionLifecycle(midCheck.updated, sol.resistanceTargetMax + 0.2);
  assert.equal(maxCheck.liquidatedNow, true);
  assert.equal(maxCheck.updated.status, 'LIQUIDATED_MAX_PROFIT');
  assert.equal(maxCheck.updated.progressToMaxTargetPct, 100);
  assert.ok((maxCheck.updated.realizedPnlUsd ?? 0) > 0);
});

test('TelegramDispatchStabilizer retries transient failures with exponential backoff and BaseStreamBatcher coalesces bursts', () => {
  const stabilizer = new TelegramDispatchStabilizer();
  const item = stabilizer.enqueue({
    signalId: 'sig_eth_1',
    symbol: 'ETHUSDT',
    direction: 'BUY',
    targetChatId: '-1008928895086',
    payloadText: 'ETHUSDT Entry Zone Executed',
    maxAttempts: 3,
  });

  const t0 = 1_700_000_000_000;
  const fail1 = stabilizer.recordAttemptResult(
    item.queueId,
    { ok: false, httpStatus: 502, error: 'Upstream timeout' },
    t0
  );
  assert.equal(fail1?.status, 'RETRYING');
  assert.equal(stabilizer.getDueRetryItems(t0 + 500).length, 0);
  assert.equal(stabilizer.getDueRetryItems(t0 + 2000).length, 1);

  const ok2 = stabilizer.recordAttemptResult(
    item.queueId,
    { ok: true, httpStatus: 200, error: null },
    t0 + 2000
  );
  assert.equal(ok2?.status, 'DELIVERED');
  assert.equal(stabilizer.getSnapshot().reliabilityPct, 100);

  // Verify BaseStreamBatcher coalesces bursts into latest price per symbol
  const batcher = new MockTickerBatcher();
  batcher.enqueueMany([
    { symbol: 'BTCUSDT', price: 90000 },
    { symbol: 'BTCUSDT', price: 90050 },
    { symbol: 'BTCUSDT', price: 90100 },
    { symbol: 'ETHUSDT', price: 3200 },
  ]);
  const flushed = batcher.flush();
  assert.equal(flushed.length, 2);
  assert.equal(flushed.find((f) => f.symbol === 'BTCUSDT')?.price, 90100);
  assert.equal(batcher.getMetrics().coalesceRatio, 4);
});

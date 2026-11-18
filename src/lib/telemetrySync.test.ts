import assert from 'node:assert/strict';
import test from 'node:test';
import { TRACKED_COINS } from './marketData';
import {
  TELEMETRY_POLL_INTERVAL_MS,
  WS_FLUSH_INTERVAL_MS,
  WsFrameBuffer,
  buildDeterministicTickerSnapshot,
  createInitialLatencyMetrics,
  stepDeterministicFallbackTickers,
  updateLatencyMetrics,
} from './telemetrySync';

test('WsFrameBuffer coalesces bursts, discards stale epochs on flush, and empties cleanly', () => {
  const buf = new WsFrameBuffer();
  const epoch1 = buf.getCurrentEpoch();
  assert.equal(epoch1, 1);

  assert.equal(
    buf.enqueue({
      symbol: 'btcusdt',
      price: 91000,
      change24hPercent: 2.1,
      high24h: 92000,
      low24h: 89000,
      volume24hUsd: 1_000_000_000,
      epoch: epoch1,
      receivedAtMs: 100,
    }),
    true
  );
  // Newer tick for same symbol coalesces in place
  buf.enqueue({
    symbol: 'BTCUSDT',
    price: 91500,
    change24hPercent: 2.4,
    high24h: 92000,
    low24h: 89000,
    volume24hUsd: 1_010_000_000,
    epoch: epoch1,
    receivedAtMs: 140,
  });
  assert.equal(buf.getPendingCount(), 1);

  const flushed = buf.flush();
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].price, 91500);
  assert.equal(buf.getPendingCount(), 0);
  assert.equal(buf.getFlushedFramesTotal(), 1);

  // Force buffer discard & epoch bump rejects stale epoch1 packets
  const epoch2 = buf.discardAndBumpEpoch();
  assert.equal(epoch2, 2);
  const acceptedStale = buf.enqueue({
    symbol: 'ETHUSDT',
    price: 3300,
    change24hPercent: 1.5,
    high24h: 3400,
    low24h: 3200,
    volume24hUsd: 500_000_000,
    epoch: epoch1,
    receivedAtMs: 160,
  });
  assert.equal(acceptedStale, false);
  assert.equal(buf.getPendingCount(), 0);
});

test('stepDeterministicFallbackTickers produces repeatable, zero-randomness bounded fallback states', () => {
  const baselineA = buildDeterministicTickerSnapshot(TRACKED_COINS);
  const baselineB = buildDeterministicTickerSnapshot(TRACKED_COINS);
  assert.deepEqual(baselineA, baselineB);

  const step5A = stepDeterministicFallbackTickers(baselineA, TRACKED_COINS, 5);
  const step5B = stepDeterministicFallbackTickers(baselineB, TRACKED_COINS, 5);
  assert.deepEqual(step5A, step5B);

  for (const coin of TRACKED_COINS) {
    const p = step5A[coin.symbol].price;
    const ratioDiff = Math.abs(p - coin.referencePrice) / coin.referencePrice;
    assert.ok(ratioDiff <= 0.004, `Fallback price drift exceeded 0.4% for ${coin.symbol}`);
    assert.equal(step5A[coin.symbol].isLiveWs, false);
  }
});

test('updateLatencyMetrics tracks recalibrated polling EWMA latency, jitter, and fallback state', () => {
  const init = createInitialLatencyMetrics();
  assert.equal(init.pollIntervalMs, TELEMETRY_POLL_INTERVAL_MS);
  assert.equal(init.wsFlushIntervalMs, WS_FLUSH_INTERVAL_MS);

  const s1 = updateLatencyMetrics(init, 24, { fallbackEnforced: false, syncEpoch: 2 });
  assert.equal(s1.lastLatencyMs, 24);
  assert.equal(s1.avgLatencyMs, 24);
  assert.equal(s1.syncEpoch, 2);
  assert.equal(s1.fallbackEnforced, false);

  const s2 = updateLatencyMetrics(s1, 44, {
    fallbackEnforced: true,
    syncEpoch: 3,
    flushedFramesTotal: 12,
  });
  assert.equal(s2.lastLatencyMs, 44);
  assert.ok(s2.avgLatencyMs > 24 && s2.avgLatencyMs < 44);
  assert.ok(s2.jitterMs > 0);
  assert.equal(s2.flushedFramesTotal, 12);
  assert.equal(s2.fallbackEnforced, true);
});

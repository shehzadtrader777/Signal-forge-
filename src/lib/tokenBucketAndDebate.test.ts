import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucketLimiter } from './tokenBucketLimiter';
import {
  SelfHealingSupervisor,
  YearnLockedProfitDegradation,
  enforceSignalRiskInvariants,
} from './multiAgentDebateEngine';

test('TokenBucketLimiter enforces 200 RPM / 50 burst, refills continuously, and isolates identities', () => {
  const limiter = new TokenBucketLimiter({ rpm: 200, burst: 5 });
  const t0 = 1_700_000_000_000;

  for (let i = 0; i < 5; i += 1) {
    const res = limiter.consume('user-alpha', 1, t0);
    assert.equal(res.allowed, true);
    assert.equal(res.remainingTokens, 4 - i);
  }

  // 6th immediate request must be rejected with 429 retryAfterSec >= 1
  const blocked = limiter.consume('user-alpha', 1, t0);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec >= 1);

  // Separate identity is unaffected
  const otherUser = limiter.consume('user-beta', 1, t0);
  assert.equal(otherUser.allowed, true);
  assert.equal(otherUser.remainingTokens, 4);

  // After 600ms at 200 RPM (3.333 tokens/sec), 2 tokens refilled -> allowed again
  const afterRefill = limiter.consume('user-alpha', 1, t0 + 600);
  assert.equal(afterRefill.allowed, true);
  assert.equal(afterRefill.remainingTokens, 1);

  const telemetry = limiter.getTelemetry();
  assert.equal(telemetry.totalAllowed, 7);
  assert.equal(telemetry.totalRejected, 1);
  assert.equal(telemetry.activeIdentities, 2);
});

test('YearnLockedProfitDegradation accumulates consecutive gains without wiping prior locked profit and decays linearly over 6h', () => {
  const vault = new YearnLockedProfitDegradation(6);
  const t0 = 1_700_000_000_000;
  const threeHoursMs = 3 * 3600 * 1000;

  // Report $600 gain -> $600 locked immediately, $0 free
  const s1 = vault.reportGain(600, t0);
  assert.equal(s1.currentLockedProfitUsd, 600);
  assert.equal(s1.currentFreeProfitUsd, 0);

  // After 3 hours (50% of 6h window) -> $300 locked, $300 free
  assert.equal(vault.getLockedAmount(t0 + threeHoursMs), 300);
  assert.equal(vault.getFreeProfit(t0 + threeHoursMs), 300);

  // Report another $200 gain at +3h -> must ACCUMULATE $300 + $200 = $500 locked (fixing DeepSeek overwrite bug)
  const s2 = vault.reportGain(200, t0 + threeHoursMs);
  assert.equal(s2.totalReportedGainUsd, 800);
  assert.equal(s2.currentLockedProfitUsd, 500);
  assert.equal(s2.currentFreeProfitUsd, 300);

  // After full 6h from second report -> $0 locked, $800 free (100% unlocked)
  const s3 = vault.getSnapshot(t0 + threeHoursMs + 6 * 3600 * 1000);
  assert.equal(s3.currentLockedProfitUsd, 0);
  assert.equal(s3.currentFreeProfitUsd, 800);
  assert.equal(s3.unlockedPercent, 100);
});

test('enforceSignalRiskInvariants enforces <= 2.0% stop-loss cap and >= 1:5 R:R floor on Coordinator decisions', () => {
  // Unsafe proposal: 5% stop loss and 1:2 R:R
  const hardened = enforceSignalRiskInvariants({
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entry: 100_000,
    sl: 95_000, // 5% SL -> must clamp to 2.0% ($98,000)
    tp: 104_000, // 4% TP -> must raise to >= 1:5 ($110,000)
    confidence: 88,
    leverage: 25, // must clamp to 10
  });

  assert.equal(hardened.riskKernelEnforced, true);
  assert.equal(hardened.sl, 98_000);
  assert.equal(hardened.stopLossDistancePct, 2);
  assert.equal(hardened.tp, 110_000);
  assert.ok(hardened.riskRewardRatio >= 5.0);
  assert.equal(hardened.leverage, 10);

  // Compliant proposal passes untouched
  const compliant = enforceSignalRiskInvariants({
    symbol: 'ETHUSDT',
    direction: 'SELL',
    entry: 3000,
    sl: 3030, // 1.0% SL
    tp: 2820, // 6.0% TP -> 1:6 R:R
    confidence: 84,
    leverage: 4,
  });
  assert.equal(compliant.riskKernelEnforced, false);
  assert.equal(compliant.riskRewardRatio, 6);
  assert.equal(compliant.stopLossDistancePct, 1);
});

test('SelfHealingSupervisor executes webhook-to-polling failover on consecutive failures and recovers cleanly', () => {
  const supervisor = new SelfHealingSupervisor(2, 30);
  assert.equal(supervisor.getTelegramMode(), 'webhook');

  // 1st failure stays in webhook
  assert.equal(supervisor.recordTelegramWebhookProbe(false), 'webhook');
  // 2nd consecutive failure triggers automatic polling failover
  assert.equal(supervisor.recordTelegramWebhookProbe(false), 'polling');

  const snapFailover = supervisor.buildHealthSnapshot({
    cacheStoreHealthy: true,
    binanceFeedLive: true,
    geminiStatus: 'healthy',
    vaultHealthy: true,
  });
  assert.equal(snapFailover.status, 'healthy');
  assert.equal(snapFailover.checks.telegramMode, 'polling');
  assert.equal(snapFailover.autoFailoverCount, 1);

  // Healthy webhook probe restores primary webhook mode
  assert.equal(supervisor.recordTelegramWebhookProbe(true), 'webhook');
  const snapRecovered = supervisor.buildHealthSnapshot({
    cacheStoreHealthy: true,
    binanceFeedLive: true,
    geminiStatus: 'healthy',
    vaultHealthy: true,
  });
  assert.equal(snapRecovered.checks.telegramMode, 'webhook');
  assert.equal(snapRecovered.consecutiveWebhookFailures, 0);
});

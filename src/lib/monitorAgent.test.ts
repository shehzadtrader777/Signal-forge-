import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBSECOND_HEARTBEAT_INTERVAL_MS,
  WS_FRAME_STALE_THRESHOLD_MS,
  computeSelfHealDelayMs,
  isTelemetryStale,
  validateLiveExecutionPrice,
  validateLiveSwitchChallenge,
} from './monitorAgent';

test('computeSelfHealDelayMs stays strictly sub-second across retry escalation', () => {
  assert.ok(SUBSECOND_HEARTBEAT_INTERVAL_MS < 1000);
  assert.ok(WS_FRAME_STALE_THRESHOLD_MS <= 5000);
  for (let i = 0; i < 6; i++) {
    const delay = computeSelfHealDelayMs(i);
    assert.ok(delay > 0 && delay < 1000, `Expected sub-second delay, got ${delay}`);
  }
  assert.ok(computeSelfHealDelayMs(0) < computeSelfHealDelayMs(2));
});

test('isTelemetryStale detects stale feeds accurately', () => {
  const now = 1_700_000_000_000;
  assert.equal(isTelemetryStale(now - 5_000, now, 18_000), false);
  assert.equal(isTelemetryStale(now - 25_000, now, 18_000), true);
  assert.equal(isTelemetryStale(null, now, 18_000), true);
});

test('validateLiveExecutionPrice enforces tight mark synchronization and catches drift', () => {
  const synced = validateLiveExecutionPrice({
    submittedPrice: 91450,
    liveFeedPrice: 91420,
    maxSlippagePct: 0.35,
  });
  assert.equal(synced.valid, true);
  assert.equal(synced.synchronizedPrice, 91420);

  const drifted = validateLiveExecutionPrice({
    submittedPrice: 93000,
    liveFeedPrice: 91420,
    maxSlippagePct: 0.35,
  });
  assert.equal(drifted.valid, false);
  assert.ok(drifted.deviationPct > 0.35);
});

test('validateLiveSwitchChallenge mandates both question mark and 6-digit email OTP', () => {
  const missingQ = validateLiveSwitchChallenge({
    securityAnswer: 'CONFIRM LIVE',
    otpInput: '482910',
    expectedOtp: '482910',
  });
  assert.equal(missingQ.valid, false);
  assert.match(missingQ.error || '', /question mark/i);

  const badOtp = validateLiveSwitchChallenge({
    securityAnswer: 'SWITCH LIVE?',
    otpInput: '000000',
    expectedOtp: '482910',
  });
  assert.equal(badOtp.valid, false);

  const ok = validateLiveSwitchChallenge({
    securityAnswer: 'SWITCH LIVE?',
    otpInput: '482910',
    expectedOtp: '482910',
  });
  assert.equal(ok.valid, true);
});

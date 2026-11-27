import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  SocialPublishingQueueEngine,
  auditEnvironmentConfiguration,
  computeSaltedOtpHash,
  createSanitizedOtpAuditEntry,
  evaluateExchangeDemoProbeOutcome,
  resolvePlatformOperationalStatuses,
  shouldApplyOtpResendCooldown,
  verifySaltedOtpHash,
} from './step3ReadinessAudit';

function hmacSha256Hex(key: string, payload: string): string {
  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

describe('Step 3 — Environment & Secret Hygiene Audit', () => {
  it('starts cleanly when optional external integrations are disabled', () => {
    const report = auditEnvironmentConfiguration({
      NODE_ENV: 'development',
      PORT: '3000',
      TELEGRAM_BOT_TOKEN: '123456:fake-token-for-unit-test',
      OKX_API_KEY: '',
      RESEND_API_KEY: '',
      DISCORD_WEBHOOK_URL: '',
    });

    assert.equal(report.startupHealthy, true);
    assert.deepEqual(report.missingRequired, []);
    assert.deepEqual(report.clientSecretLeakWarnings, []);
    assert.ok(report.optionalIntegrationsConfigured.includes('TELEGRAM_BOT_TOKEN'));
    assert.ok(report.optionalIntegrationsDisabled.includes('OKX_API_KEY'));
    assert.ok(report.optionalIntegrationsDisabled.includes('RESEND_API_KEY'));
  });

  it('flags sensitive VITE_ client-exposed secret leaks and obsolete variable aliases', () => {
    const report = auditEnvironmentConfiguration({
      VITE_CMC_API_KEY: 'real-looking-cmc-key-1234',
      VITE_CLOUDFLARE_TURNSTILE_SITE_KEY: '0x4AAAAAAABpublicSiteKey',
      BOT_TOKEN: 'legacy-token-value',
    });

    assert.equal(report.startupHealthy, false);
    assert.equal(report.clientSecretLeakWarnings.length, 1);
    assert.match(report.clientSecretLeakWarnings[0], /VITE_CMC_API_KEY/);
    assert.ok(report.obsoleteVariablesPresent.includes('VITE_CMC_API_KEY'));
    assert.ok(report.obsoleteVariablesPresent.includes('BOT_TOKEN'));
  });

  it('treats template placeholder values as unconfigured', () => {
    const report = auditEnvironmentConfiguration({
      GEMINI_API_KEY: 'MY_GEMINI_API_KEY',
      APP_URL: 'MY_APP_URL',
    });

    assert.equal(report.startupHealthy, true);
    assert.ok(report.optionalIntegrationsDisabled.includes('GEMINI_API_KEY'));
    assert.ok(report.optionalIntegrationsDisabled.includes('APP_URL'));
  });
});

describe('Step 3 — External Exchange Demo Verification (Honest State Machine)', () => {
  it('reports EXCHANGE_DEMO_UNVERIFIED when OKX Demo credentials are missing', () => {
    const res = evaluateExchangeDemoProbeOutcome({
      venue: 'OKX_DEMO',
      endpointChecked: 'https://www.okx.com/api/v5/account/balance',
      credentialsPresent: false,
      isDemoEndpoint: true,
      httpStatus: null,
      externalAuthConfirmed: false,
      latencyMs: null,
    });

    assert.equal(res.status, 'EXCHANGE_DEMO_UNVERIFIED');
    assert.equal(res.blockerCode, 'MISSING_CREDENTIALS');
    assert.equal(res.realMoneyLocked, true);
    assert.equal(res.externalAuthConfirmed, false);
  });

  it('refuses non-demo live endpoints unconditionally', () => {
    const res = evaluateExchangeDemoProbeOutcome({
      venue: 'BINANCE_TESTNET',
      endpointChecked: 'https://api.binance.com/api/v3/account',
      credentialsPresent: true,
      isDemoEndpoint: false,
      httpStatus: 200,
      externalAuthConfirmed: true,
      latencyMs: 42,
    });

    assert.equal(res.status, 'EXCHANGE_DEMO_UNVERIFIED');
    assert.equal(res.blockerCode, 'LIVE_ENDPOINT_REFUSED');
    assert.equal(res.externalAuthConfirmed, false);
  });

  it('reports EXCHANGE_DEMO_VERIFIED only when real external auth returns 2xx on demo endpoint', () => {
    const res = evaluateExchangeDemoProbeOutcome({
      venue: 'BINANCE_TESTNET',
      endpointChecked: 'https://testnet.binance.vision/api/v3/account',
      credentialsPresent: true,
      isDemoEndpoint: true,
      httpStatus: 200,
      externalAuthConfirmed: true,
      latencyMs: 118,
    });

    assert.equal(res.status, 'EXCHANGE_DEMO_VERIFIED');
    assert.equal(res.blockerCode, 'NONE');
    assert.equal(res.realMoneyLocked, true);
  });

  it('classifies external 401/403 responses as EXCHANGE_AUTH_REJECTED without fabricating success', () => {
    const res = evaluateExchangeDemoProbeOutcome({
      venue: 'OKX_DEMO',
      endpointChecked: 'https://www.okx.com/api/v5/account/balance',
      credentialsPresent: true,
      isDemoEndpoint: true,
      httpStatus: 401,
      externalAuthConfirmed: false,
      latencyMs: 95,
      errorDetail: 'Invalid OK-ACCESS-SIGN',
    });

    assert.equal(res.status, 'EXCHANGE_DEMO_UNVERIFIED');
    assert.equal(res.blockerCode, 'EXCHANGE_AUTH_REJECTED');
  });
});

describe('Step 3 — Salted Hashed OTP & Zero-Plaintext Audit Trail', () => {
  it('verifies matching 6-digit OTP against salted HMAC hash and rejects wrong/malformed codes', () => {
    const pepper = 'ephemeral-boot-pepper-test-key';
    const challengeId = 'otp_abc1234567';
    const rawOtp = '482915';

    const hash = computeSaltedOtpHash({
      challengeId,
      otpCode: rawOtp,
      pepper,
      hmacHexFn: hmacSha256Hex,
    });

    // Hash must never contain the plaintext OTP
    assert.equal(hash.includes(rawOtp), false);

    assert.equal(
      verifySaltedOtpHash({
        challengeId,
        candidateOtp: rawOtp,
        expectedHash: hash,
        pepper,
        hmacHexFn: hmacSha256Hex,
        constantTimeEqualFn: constantTimeEqual,
      }),
      true
    );

    assert.equal(
      verifySaltedOtpHash({
        challengeId,
        candidateOtp: '482916',
        expectedHash: hash,
        pepper,
        hmacHexFn: hmacSha256Hex,
        constantTimeEqualFn: constantTimeEqual,
      }),
      false
    );

    // Different challengeId must fail even with same OTP
    assert.equal(
      verifySaltedOtpHash({
        challengeId: 'otp_other99999',
        candidateOtp: rawOtp,
        expectedHash: hash,
        pepper,
        hmacHexFn: hmacSha256Hex,
        constantTimeEqualFn: constantTimeEqual,
      }),
      false
    );
  });

  it('does not apply punitive resend lockout when email provider delivery failed', () => {
    assert.equal(shouldApplyOtpResendCooldown(false), false);
    assert.equal(shouldApplyOtpResendCooldown(true), true);
  });

  it('produces sanitized OTP audit entries with zero plaintext OTP values', () => {
    const entry = createSanitizedOtpAuditEntry({
      challengeId: 'otp_1234567890',
      event: 'ISSUED_DELIVERY_FAILED',
      recipientMasked: 'ow***@example.com',
      deliveryStatus: 'PROVIDER_UNCONFIGURED',
      attemptsUsed: 0,
    });

    const serialized = JSON.stringify(entry);
    assert.equal(entry.recipientMasked, 'ow***@example.com');
    assert.equal(entry.deliveryStatus, 'PROVIDER_UNCONFIGURED');
    assert.equal(/\b\d{6}\b/.test(serialized), false);
  });
});

describe('Step 3 — Social Delivery Separation, Idempotency & Bounded Retry Queue', () => {
  it('prevents duplicate posts for the same immutable Trade ID + stage + channel', () => {
    const queue = new SocialPublishingQueueEngine(3);
    const first = queue.enqueueOrInspect({
      tradeId: 'SF-2026-8841',
      stage: 'SIGNAL_ANNOUNCEMENT',
      channel: 'PUBLIC_TELEGRAM_CHANNEL',
      chartSnapshotGenerated: true,
      channelConfigured: true,
    });
    assert.equal(first.accepted, true);
    assert.equal(first.record.messageDelivered, false);

    const confirmed = queue.recordDeliveryOutcome({
      idempotencyKey: first.record.idempotencyKey,
      delivered: true,
      providerMessageId: 'tg_msg_99123',
    });
    assert.equal(confirmed?.state, 'DELIVERED_PROVIDER_CONFIRMED');
    assert.equal(confirmed?.messageDelivered, true);

    const duplicate = queue.enqueueOrInspect({
      tradeId: 'SF-2026-8841',
      stage: 'SIGNAL_ANNOUNCEMENT',
      channel: 'PUBLIC_TELEGRAM_CHANNEL',
      chartSnapshotGenerated: true,
      channelConfigured: true,
    });
    assert.equal(duplicate.accepted, false);
    assert.equal(duplicate.duplicateBlocked, true);

    // Closure stage on same Trade ID is distinct and allowed
    const closure = queue.enqueueOrInspect({
      tradeId: 'SF-2026-8841',
      stage: 'TRADE_CLOSURE',
      channel: 'PUBLIC_TELEGRAM_CHANNEL',
      chartSnapshotGenerated: true,
      channelConfigured: true,
    });
    assert.equal(closure.accepted, true);
    assert.equal(closure.duplicateBlocked, false);
  });

  it('never reports a generated chart PNG as a delivered message when Discord/Telegram channel is unconfigured', () => {
    const queue = new SocialPublishingQueueEngine(3);
    const res = queue.enqueueOrInspect({
      tradeId: 'SF-2026-9902',
      stage: 'SIGNAL_ANNOUNCEMENT',
      channel: 'DISCORD_WEBHOOK',
      chartSnapshotGenerated: true,
      channelConfigured: false,
    });

    assert.equal(res.accepted, false);
    assert.equal(res.record.chartSnapshotGenerated, true);
    assert.equal(res.record.messageDelivered, false);
    assert.equal(res.record.state, 'UNCONFIGURED_NOT_SENT');
    assert.equal(queue.listFailed().length, 1);
  });

  it('enforces bounded retry attempts before transitioning to FAILED_PERMANENT', () => {
    const queue = new SocialPublishingQueueEngine(2);
    const enqueued = queue.enqueueOrInspect({
      tradeId: 'SF-2026-7710',
      stage: 'TRADE_CLOSURE',
      channel: 'PERSONAL_ADMIN_TELEGRAM',
      chartSnapshotGenerated: true,
      channelConfigured: true,
    });

    const fail1 = queue.recordDeliveryOutcome({
      idempotencyKey: enqueued.record.idempotencyKey,
      delivered: false,
      errorMessage: 'Telegram 502 Bad Gateway',
    });
    assert.equal(fail1?.state, 'FAILED_RETRYABLE');
    assert.equal(fail1?.attempts, 1);

    const fail2 = queue.recordDeliveryOutcome({
      idempotencyKey: enqueued.record.idempotencyKey,
      delivered: false,
      errorMessage: 'Telegram 502 Bad Gateway',
    });
    assert.equal(fail2?.state, 'FAILED_PERMANENT');
    assert.equal(fail2?.attempts, 2);

    const retryBlocked = queue.enqueueOrInspect({
      tradeId: 'SF-2026-7710',
      stage: 'TRADE_CLOSURE',
      channel: 'PERSONAL_ADMIN_TELEGRAM',
      chartSnapshotGenerated: true,
      channelConfigured: true,
    });
    assert.equal(retryBlocked.accepted, false);
  });
});

describe('Step 3 — Unambiguous Trading Status & Environment Clarity', () => {
  it('always emits explicit operational badges and never an ambiguous generic LIVE badge', () => {
    const normalPaper = resolvePlatformOperationalStatuses({
      appOnline: true,
      marketDataConnected: true,
      exchangeDemoVerifiedConnected: false,
      maintenanceActive: false,
    });

    assert.equal(normalPaper.applicationLabel, 'APPLICATION ONLINE');
    assert.equal(normalPaper.marketDataLabel, 'MARKET DATA CONNECTED');
    assert.equal(normalPaper.activeTradingLabel, 'PAPER TRADING ACTIVE');
    assert.equal(normalPaper.liveTradingLabel, 'LIVE TRADING LOCKED');
    assert.equal(normalPaper.maintenanceLabel, null);
    for (const badge of normalPaper.badges) {
      assert.notEqual(badge.label, 'LIVE');
    }

    const maintDemo = resolvePlatformOperationalStatuses({
      appOnline: true,
      marketDataConnected: true,
      exchangeDemoVerifiedConnected: true,
      maintenanceActive: true,
    });
    assert.equal(maintDemo.activeTradingLabel, 'EXCHANGE DEMO CONNECTED');
    assert.equal(maintDemo.maintenanceLabel, 'MAINTENANCE ACTIVE');
    assert.equal(maintDemo.liveTradingLabel, 'LIVE TRADING LOCKED');
  });
});

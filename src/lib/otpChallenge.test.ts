import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_OTP_VERIFY_ATTEMPTS,
  checkResendCooldown,
  classifyResendDeliveryResult,
  evaluateLiveSwitchSafetyGate,
  evaluateOtpProviderReadiness,
  maskEmailAddress,
} from './otpChallenge';

test('maskEmailAddress protects user email while preserving domain visibility', () => {
  assert.equal(maskEmailAddress('owner.desk@example.com'), 'ow***@example.com');
  assert.equal(maskEmailAddress('a@b.com'), '***@***');
});

test('evaluateOtpProviderReadiness identifies missing key vs sandbox sender vs verified domain', () => {
  const unconfigured = evaluateOtpProviderReadiness({
    resendApiKey: '',
    resendFromEmail: '',
    recipientEmail: 'trader@example.com',
  });
  assert.equal(unconfigured.readyForInboxDelivery, false);
  assert.equal(unconfigured.resendApiKeyConfigured, false);

  const sandbox = evaluateOtpProviderReadiness({
    resendApiKey: 're_live_1234567890abcdef',
    resendFromEmail: '',
    recipientEmail: 'trader@example.com',
  });
  assert.equal(sandbox.readyForInboxDelivery, true);
  assert.equal(sandbox.customVerifiedSenderConfigured, false);

  const verified = evaluateOtpProviderReadiness({
    resendApiKey: 're_live_1234567890abcdef',
    resendFromEmail: 'Signal Forge <security@signalforge.app>',
    recipientEmail: 'trader@example.com',
  });
  assert.equal(verified.customVerifiedSenderConfigured, true);
});

test('classifyResendDeliveryResult distinguishes sandbox restriction, unconfigured key, and success', () => {
  const missingKey = classifyResendDeliveryResult({
    resendApiKeyConfigured: false,
    senderAddress: 'Signal Forge <onboarding@resend.dev>',
    recipientEmail: 'user@example.com',
  });
  assert.equal(missingKey.deliveryStatus, 'PROVIDER_UNCONFIGURED');
  assert.equal(missingKey.emailSent, false);

  const sandboxBlocked = classifyResendDeliveryResult({
    resendApiKeyConfigured: true,
    senderAddress: 'Signal Forge <onboarding@resend.dev>',
    recipientEmail: 'other@example.com',
    providerErrorMessage:
      'You can only send testing emails to your own email address. To send emails to other recipients, please verify a domain at resend.com/domains.',
  });
  assert.equal(sandboxBlocked.deliveryStatus, 'SANDBOX_DOMAIN_RESTRICTED');
  assert.equal(sandboxBlocked.emailSent, false);

  const delivered = classifyResendDeliveryResult({
    resendApiKeyConfigured: true,
    senderAddress: 'Signal Forge <security@signalforge.app>',
    recipientEmail: 'user@example.com',
    providerMessageId: 'email_123',
  });
  assert.equal(delivered.deliveryStatus, 'DELIVERED');
  assert.equal(delivered.emailSent, true);
});

test('checkResendCooldown enforces 30-second resend protection', () => {
  const now = 1_700_000_000_000;
  const blocked = checkResendCooldown({ lastIssuedAtMs: now - 10_000, nowMs: now });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSec, 20);

  const allowed = checkResendCooldown({ lastIssuedAtMs: now - 31_000, nowMs: now });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.retryAfterSec, 0);
});

test('evaluateLiveSwitchSafetyGate fails closed when any auth, checklist, or OTP requirement fails', () => {
  const baseValid = {
    operatorAuthenticated: true,
    challengeExists: true,
    challengeUsed: false,
    challengeExpired: false,
    attempts: 0,
    otpVerified: true,
    securityPhraseHasQuestionMark: true,
    safetyChecklistCompleted: true,
  };

  assert.equal(evaluateLiveSwitchSafetyGate(baseValid).allowed, true);
  assert.equal(
    evaluateLiveSwitchSafetyGate({ ...baseValid, operatorAuthenticated: false }).httpStatus,
    401
  );
  assert.equal(
    evaluateLiveSwitchSafetyGate({ ...baseValid, safetyChecklistCompleted: false }).allowed,
    false
  );
  assert.equal(
    evaluateLiveSwitchSafetyGate({ ...baseValid, challengeExpired: true }).allowed,
    false
  );
  assert.equal(
    evaluateLiveSwitchSafetyGate({ ...baseValid, attempts: MAX_OTP_VERIFY_ATTEMPTS }).httpStatus,
    429
  );
  assert.equal(
    evaluateLiveSwitchSafetyGate({ ...baseValid, otpVerified: false }).allowed,
    false
  );
});

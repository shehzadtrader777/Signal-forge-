/**
 * Signal Forge — Email OTP Delivery Diagnostics & Fail-Closed Live Switch Gate
 *
 * Pure, unit-testable module used by both server.ts and client security flows.
 */

export const OTP_TTL_MS = 5 * 60_000; // 5 minutes
export const OTP_RESEND_COOLDOWN_MS = 30_000; // 30 seconds
export const MAX_OTP_VERIFY_ATTEMPTS = 5;

export type OtpDeliveryStatus =
  | 'DELIVERED'
  | 'PROVIDER_UNCONFIGURED'
  | 'SANDBOX_DOMAIN_RESTRICTED'
  | 'PROVIDER_REJECTED'
  | 'RATE_LIMITED';

export interface OtpProviderReadiness {
  readonly resendApiKeyConfigured: boolean;
  readonly customVerifiedSenderConfigured: boolean;
  readonly senderAddress: string;
  readonly recipientMasked: string;
  readonly readyForInboxDelivery: boolean;
  readonly advisory: string;
}

export interface OtpDeliveryDiagnosis {
  readonly deliveryStatus: OtpDeliveryStatus;
  readonly emailSent: boolean;
  readonly userMessage: string;
  readonly remediationHint: string;
}

export function maskEmailAddress(email: string): string {
  const trimmed = (email || '').trim();
  const atIdx = trimmed.indexOf('@');
  if (atIdx <= 1) return '***@***';
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  const prefix = local.slice(0, Math.min(2, local.length));
  return `${prefix}***@${domain}`;
}

export function evaluateOtpProviderReadiness(params: {
  resendApiKey?: string;
  resendFromEmail?: string;
  recipientEmail: string;
}): OtpProviderReadiness {
  const apiKey = (params.resendApiKey || '').trim();
  const resendApiKeyConfigured = apiKey.startsWith('re_') && apiKey.length >= 12;
  const customSender = (params.resendFromEmail || '').trim();
  const customVerifiedSenderConfigured =
    customSender.length > 0 && !customSender.toLowerCase().includes('onboarding@resend.dev');
  const senderAddress = customSender || 'Signal Forge <onboarding@resend.dev>';
  const recipientMasked = maskEmailAddress(params.recipientEmail);

  if (!resendApiKeyConfigured) {
    return {
      resendApiKeyConfigured: false,
      customVerifiedSenderConfigured,
      senderAddress,
      recipientMasked,
      readyForInboxDelivery: false,
      advisory:
        'RESEND_API_KEY is missing or invalid. Configure a valid Resend API key (starting with re_) in server secrets to deliver OTP emails.',
    };
  }

  if (!customVerifiedSenderConfigured) {
    return {
      resendApiKeyConfigured: true,
      customVerifiedSenderConfigured: false,
      senderAddress,
      recipientMasked,
      readyForInboxDelivery: true,
      advisory:
        'Using Resend sandbox sender (onboarding@resend.dev). Resend only delivers sandbox emails to your Resend account owner email; set RESEND_FROM_EMAIL with a verified domain for arbitrary recipients.',
    };
  }

  return {
    resendApiKeyConfigured: true,
    customVerifiedSenderConfigured: true,
    senderAddress,
    recipientMasked,
    readyForInboxDelivery: true,
    advisory: `Verified Resend sender configured (${senderAddress}) for ${recipientMasked}.`,
  };
}

export function classifyResendDeliveryResult(params: {
  resendApiKeyConfigured: boolean;
  senderAddress: string;
  recipientEmail: string;
  providerErrorMessage?: string | null;
  providerMessageId?: string | null;
}): OtpDeliveryDiagnosis {
  const masked = maskEmailAddress(params.recipientEmail);
  if (!params.resendApiKeyConfigured) {
    return {
      deliveryStatus: 'PROVIDER_UNCONFIGURED',
      emailSent: false,
      userMessage: `Email OTP could not be delivered to ${masked}: RESEND_API_KEY is not configured on the server.`,
      remediationHint:
        'Set RESEND_API_KEY (and optionally a verified RESEND_FROM_EMAIL) in environment secrets before switching to Live Trading.',
    };
  }

  const errText = (params.providerErrorMessage || '').trim();
  if (!errText && params.providerMessageId) {
    return {
      deliveryStatus: 'DELIVERED',
      emailSent: true,
      userMessage: `6-digit Email OTP dispatched to ${masked} (valid for 5 minutes).`,
      remediationHint: 'Check your inbox and spam folder, then enter the 6-digit code below.',
    };
  }

  const lower = errText.toLowerCase();
  if (
    lower.includes('only send testing emails') ||
    lower.includes('verify a domain') ||
    lower.includes('onboarding@resend.dev') ||
    (params.senderAddress.toLowerCase().includes('onboarding@resend.dev') &&
      (lower.includes('403') || lower.includes('validation')))
  ) {
    return {
      deliveryStatus: 'SANDBOX_DOMAIN_RESTRICTED',
      emailSent: false,
      userMessage: `Resend rejected OTP delivery to ${masked} because sandbox sender onboarding@resend.dev can only email the Resend account owner.`,
      remediationHint:
        'Verify your sending domain in Resend and set RESEND_FROM_EMAIL="Signal Forge <alerts@yourdomain.com>" in server secrets.',
    };
  }

  if (lower.includes('rate limit') || lower.includes('429') || lower.includes('too many')) {
    return {
      deliveryStatus: 'RATE_LIMITED',
      emailSent: false,
      userMessage: 'Email provider rate limit reached. Wait briefly before requesting another OTP.',
      remediationHint: 'Retry after the cooldown window expires.',
    };
  }

  return {
    deliveryStatus: 'PROVIDER_REJECTED',
    emailSent: false,
    userMessage: `Email OTP delivery failed (${errText || 'unknown provider error'}). Live mode remains locked.`,
    remediationHint: 'Inspect RESEND_API_KEY validity and domain DNS records in Resend.',
  };
}

export function checkResendCooldown(params: {
  lastIssuedAtMs: number | null;
  nowMs: number;
  cooldownMs?: number;
}): { allowed: boolean; retryAfterSec: number; resendAvailableAtIso: string } {
  const cooldown = params.cooldownMs ?? OTP_RESEND_COOLDOWN_MS;
  if (!params.lastIssuedAtMs) {
    return {
      allowed: true,
      retryAfterSec: 0,
      resendAvailableAtIso: new Date(params.nowMs).toISOString(),
    };
  }
  const availableAt = params.lastIssuedAtMs + cooldown;
  const remainingMs = availableAt - params.nowMs;
  if (remainingMs <= 0) {
    return {
      allowed: true,
      retryAfterSec: 0,
      resendAvailableAtIso: new Date(params.nowMs).toISOString(),
    };
  }
  return {
    allowed: false,
    retryAfterSec: Math.ceil(remainingMs / 1000),
    resendAvailableAtIso: new Date(availableAt).toISOString(),
  };
}

export interface LiveSwitchSafetyGateInput {
  readonly operatorAuthenticated: boolean;
  readonly challengeExists: boolean;
  readonly challengeUsed: boolean;
  readonly challengeExpired: boolean;
  readonly attempts: number;
  readonly otpVerified: boolean;
  readonly securityPhraseHasQuestionMark: boolean;
  readonly safetyChecklistCompleted: boolean;
}

export interface LiveSwitchSafetyGateResult {
  readonly allowed: boolean;
  readonly httpStatus: 200 | 401 | 403 | 429;
  readonly reason: string;
}

export function evaluateLiveSwitchSafetyGate(
  input: LiveSwitchSafetyGateInput
): LiveSwitchSafetyGateResult {
  if (!input.operatorAuthenticated) {
    return {
      allowed: false,
      httpStatus: 401,
      reason: 'Authenticated operator session required before activating Live Trading.',
    };
  }
  if (!input.safetyChecklistCompleted) {
    return {
      allowed: false,
      httpStatus: 403,
      reason: 'Complete all pre-flight Live Trading safety checks before verification.',
    };
  }
  if (!input.challengeExists || input.challengeUsed || input.challengeExpired) {
    return {
      allowed: false,
      httpStatus: 403,
      reason: 'Email OTP challenge missing, used, or expired. Request a new 6-digit OTP.',
    };
  }
  if (input.attempts >= MAX_OTP_VERIFY_ATTEMPTS) {
    return {
      allowed: false,
      httpStatus: 429,
      reason: 'OTP challenge locked after maximum failed verification attempts. Request a new OTP.',
    };
  }
  if (!input.securityPhraseHasQuestionMark) {
    return {
      allowed: false,
      httpStatus: 403,
      reason: 'Security confirmation phrase must include a question mark (?).',
    };
  }
  if (!input.otpVerified) {
    return {
      allowed: false,
      httpStatus: 403,
      reason: 'Invalid 6-digit Email OTP code.',
    };
  }
  return {
    allowed: true,
    httpStatus: 200,
    reason: 'All authentication, OTP, and safety gates passed.',
  };
}

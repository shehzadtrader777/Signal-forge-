import type { CapabilityClass } from './controlMatrix';

export type SubscriptionTier = 'FREE' | 'PRO' | 'PREMIUM_INSTITUTIONAL';

export type SubscriptionStatus = 'ACTIVE' | 'INACTIVE' | 'EXPIRED' | 'SUSPENDED';

export type GateDenialCode =
  | 'AUTH_REQUIRED'
  | 'EMAIL_UNVERIFIED'
  | 'PREMIUM_SUBSCRIPTION_REQUIRED'
  | 'SUBSCRIPTION_INACTIVE'
  | 'SUBSCRIPTION_EXPIRED';

export interface SubscriptionPrincipal {
  authenticated: boolean;
  uid: string | null;
  email: string | null;
  emailVerified: boolean;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  expiresAtMs: number | null;
  entitlementId: string | null;
  planLabel: string;
}

export interface GateEvaluationResult {
  allowed: boolean;
  capability: CapabilityClass;
  code: 'AUTHORIZED' | GateDenialCode;
  httpStatus: 200 | 401 | 403;
  reason: string;
  remediation: string;
  lockedControls: readonly ('TELEMETRY' | 'AGENT_OVERRIDE' | 'EXECUTION')[];
}

export const PRIVILEGED_CAPABILITIES: readonly ('TELEMETRY' | 'AGENT_OVERRIDE' | 'EXECUTION')[] = [
  'TELEMETRY',
  'AGENT_OVERRIDE',
  'EXECUTION',
] as const;

export const UNAUTHENTICATED_PRINCIPAL: SubscriptionPrincipal = {
  authenticated: false,
  uid: null,
  email: null,
  emailVerified: false,
  tier: 'FREE',
  status: 'INACTIVE',
  expiresAtMs: null,
  entitlementId: null,
  planLabel: 'Guest Read-Only',
};

export function isPremiumSubscriber(
  principal: SubscriptionPrincipal | null | undefined,
  nowMs = Date.now()
): boolean {
  if (!principal || !principal.authenticated || !principal.uid || !principal.emailVerified) {
    return false;
  }
  if (principal.tier !== 'PREMIUM_INSTITUTIONAL') {
    return false;
  }
  if (principal.status !== 'ACTIVE') {
    return false;
  }
  if (principal.expiresAtMs !== null && principal.expiresAtMs <= nowMs) {
    return false;
  }
  return true;
}

export function evaluateSubscriptionGate(
  principal: SubscriptionPrincipal | null | undefined,
  capability: CapabilityClass,
  nowMs = Date.now()
): GateEvaluationResult {
  if (capability === 'PUBLIC_VIEW') {
    return {
      allowed: true,
      capability,
      code: 'AUTHORIZED',
      httpStatus: 200,
      reason: 'Read-only market telemetry summary is accessible.',
      remediation: 'None required.',
      lockedControls: isPremiumSubscriber(principal, nowMs) ? [] : PRIVILEGED_CAPABILITIES,
    };
  }

  if (!principal || !principal.authenticated || !principal.uid) {
    return {
      allowed: false,
      capability,
      code: 'AUTH_REQUIRED',
      httpStatus: 401,
      reason: `${capability} controls are locked: sign in with a verified Signal Forge account holding an active Premium Institutional subscription.`,
      remediation: 'Sign in at /login and activate your Premium Institutional tier.',
      lockedControls: PRIVILEGED_CAPABILITIES,
    };
  }

  if (!principal.emailVerified) {
    return {
      allowed: false,
      capability,
      code: 'EMAIL_UNVERIFIED',
      httpStatus: 403,
      reason: `${capability} controls require a verified email identity before privileged authorization.`,
      remediation: 'Complete email verification on your signed-in account.',
      lockedControls: PRIVILEGED_CAPABILITIES,
    };
  }

  if (principal.tier !== 'PREMIUM_INSTITUTIONAL') {
    return {
      allowed: false,
      capability,
      code: 'PREMIUM_SUBSCRIPTION_REQUIRED',
      httpStatus: 403,
      reason: `${capability} controls are exclusively locked to authenticated PREMIUM_INSTITUTIONAL subscribers (current tier: ${principal.tier}).`,
      remediation: 'Upgrade to Premium Institutional to unlock Telemetry, Agent Override, and Execution controls.',
      lockedControls: PRIVILEGED_CAPABILITIES,
    };
  }

  if (principal.status !== 'ACTIVE') {
    return {
      allowed: false,
      capability,
      code: 'SUBSCRIPTION_INACTIVE',
      httpStatus: 403,
      reason: `Premium subscription status is ${principal.status}; ${capability} controls remain locked.`,
      remediation: 'Reactivate or renew your Premium Institutional subscription.',
      lockedControls: PRIVILEGED_CAPABILITIES,
    };
  }

  if (principal.expiresAtMs !== null && principal.expiresAtMs <= nowMs) {
    return {
      allowed: false,
      capability,
      code: 'SUBSCRIPTION_EXPIRED',
      httpStatus: 403,
      reason: `Premium subscription expired at ${new Date(principal.expiresAtMs).toISOString()}; ${capability} controls locked.`,
      remediation: 'Renew Premium Institutional subscription to restore access.',
      lockedControls: PRIVILEGED_CAPABILITIES,
    };
  }

  return {
    allowed: true,
    capability,
    code: 'AUTHORIZED',
    httpStatus: 200,
    reason: `Authorized for ${capability} (${principal.planLabel}).`,
    remediation: 'Active Premium Institutional clearance verified.',
    lockedControls: [],
  };
}

export function maskPrincipalSummary(principal: SubscriptionPrincipal): {
  authenticated: boolean;
  uid: string | null;
  maskedEmail: string | null;
  emailVerified: boolean;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  expiresAtIso: string | null;
  entitlementId: string | null;
  planLabel: string;
  premiumUnlocked: boolean;
  lockedCapabilities: readonly ('TELEMETRY' | 'AGENT_OVERRIDE' | 'EXECUTION')[];
} {
  let maskedEmail: string | null = null;
  if (principal.email) {
    const at = principal.email.indexOf('@');
    maskedEmail =
      at > 1
        ? `${principal.email.slice(0, 2)}***${principal.email.slice(at)}`
        : '[redacted]';
  }
  const unlocked = isPremiumSubscriber(principal);
  return {
    authenticated: principal.authenticated,
    uid: principal.uid,
    maskedEmail,
    emailVerified: principal.emailVerified,
    tier: principal.tier,
    status: principal.status,
    expiresAtIso:
      principal.expiresAtMs !== null ? new Date(principal.expiresAtMs).toISOString() : null,
    entitlementId: principal.entitlementId,
    planLabel: principal.planLabel,
    premiumUnlocked: unlocked,
    lockedCapabilities: unlocked ? [] : PRIVILEGED_CAPABILITIES,
  };
}

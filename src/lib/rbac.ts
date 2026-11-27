import type { SubscriptionPrincipal } from './subscriptionGatekeeper';

export type RbacRole = 'GUEST' | 'TRADER' | 'QUANT_ANALYST' | 'ADMIN' | 'SUPER_ADMIN';

export type RbacPermission =
  | 'DASHBOARD_VIEW'
  | 'BACKTEST_RUN'
  | 'BACKTEST_OPTIMIZE'
  | 'PROFIT_POLICY_TUNE'
  | 'TEST_CONSOLE_VIEW'
  | 'DEBUG_ENDPOINTS_ACCESS'
  | 'PROMOTION_CERTIFY'
  | 'OPERATOR_SESSION_ISSUE'
  | 'AGENTIC_CLI_WRITE'
  | 'AI_ADMIN_COMMAND';

export interface RbacIdentity {
  authenticated: boolean;
  uid: string | null;
  email: string | null;
  role: RbacRole;
  permissions: readonly RbacPermission[];
  canAccessTestConsole: boolean;
  canAccessDebugEndpoints: boolean;
}

export interface RbacAccessDecision {
  allowed: boolean;
  httpStatus: 200 | 401 | 403;
  code: 'AUTHORIZED' | 'RBAC_AUTH_REQUIRED' | 'RBAC_FORBIDDEN';
  role: RbacRole;
  requiredPermission: RbacPermission;
  reason: string;
}

const ROLE_PERMISSIONS: Readonly<Record<RbacRole, readonly RbacPermission[]>> = {
  GUEST: ['DASHBOARD_VIEW', 'BACKTEST_RUN'],
  TRADER: ['DASHBOARD_VIEW', 'BACKTEST_RUN'],
  QUANT_ANALYST: ['DASHBOARD_VIEW', 'BACKTEST_RUN', 'BACKTEST_OPTIMIZE', 'PROFIT_POLICY_TUNE'],
  ADMIN: [
    'DASHBOARD_VIEW',
    'BACKTEST_RUN',
    'BACKTEST_OPTIMIZE',
    'PROFIT_POLICY_TUNE',
    'TEST_CONSOLE_VIEW',
    'DEBUG_ENDPOINTS_ACCESS',
    'PROMOTION_CERTIFY',
    'OPERATOR_SESSION_ISSUE',
    'AGENTIC_CLI_WRITE',
    'AI_ADMIN_COMMAND',
  ],
  SUPER_ADMIN: [
    'DASHBOARD_VIEW',
    'BACKTEST_RUN',
    'BACKTEST_OPTIMIZE',
    'PROFIT_POLICY_TUNE',
    'TEST_CONSOLE_VIEW',
    'DEBUG_ENDPOINTS_ACCESS',
    'PROMOTION_CERTIFY',
    'OPERATOR_SESSION_ISSUE',
    'AGENTIC_CLI_WRITE',
    'AI_ADMIN_COMMAND',
  ],
};

/**
 * Authorized platform administrator emails are supplied exclusively on the server
 * via environment configuration (ADMIN_EMAIL_ALLOWLIST / OWNER_ALERT_EMAIL / RECIPIENT_EMAIL).
 * Kept empty in client-imported code so no personal email addresses are bundled publicly.
 */
export const DEFAULT_ADMIN_EMAILS: readonly string[] = [];

export const TEST_CONSOLE_ALLOWED_ROLES: readonly RbacRole[] = ['ADMIN', 'SUPER_ADMIN'];

export function resolveRbacRoleFromPrincipal(
  principal: SubscriptionPrincipal | null | undefined,
  extraAdminEmails: readonly string[] = []
): RbacRole {
  if (!principal || !principal.authenticated || !principal.uid) {
    return 'GUEST';
  }

  // Never infer SUPER_ADMIN from a client-supplied UID. CLI authorization must be
  // checked independently on the server using a validated scoped credential.
  const normalizedEmail = (principal.email || '').trim().toLowerCase();
  const allowlist = new Set<string>([
    ...DEFAULT_ADMIN_EMAILS,
    ...extraAdminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean),
  ]);

  if (normalizedEmail && allowlist.has(normalizedEmail) && principal.emailVerified) {
    return 'SUPER_ADMIN';
  }

  if (principal.tier === 'PREMIUM_INSTITUTIONAL' && principal.status === 'ACTIVE') {
    return 'QUANT_ANALYST';
  }

  return 'TRADER';
}

export function buildRbacIdentity(
  principal: SubscriptionPrincipal | null | undefined,
  extraAdminEmails: readonly string[] = []
): RbacIdentity {
  const role = resolveRbacRoleFromPrincipal(principal, extraAdminEmails);
  const permissions = ROLE_PERMISSIONS[role];
  return {
    authenticated: Boolean(principal?.authenticated && principal?.uid),
    uid: principal?.uid ?? null,
    email: principal?.email ?? null,
    role,
    permissions,
    canAccessTestConsole: permissions.includes('TEST_CONSOLE_VIEW'),
    canAccessDebugEndpoints: permissions.includes('DEBUG_ENDPOINTS_ACCESS'),
  };
}

export function evaluateRbacAccess(
  identity: RbacIdentity,
  requiredPermission: RbacPermission
): RbacAccessDecision {
  if (!identity.authenticated || identity.role === 'GUEST') {
    return {
      allowed: false,
      httpStatus: 401,
      code: 'RBAC_AUTH_REQUIRED',
      role: identity.role,
      requiredPermission,
      reason: `Authentication required for ${requiredPermission}. Unauthenticated access to debugging and Test Console endpoints is strictly denied.`,
    };
  }

  if (!identity.permissions.includes(requiredPermission)) {
    return {
      allowed: false,
      httpStatus: 403,
      code: 'RBAC_FORBIDDEN',
      role: identity.role,
      requiredPermission,
      reason: `Role ${identity.role} does not hold ${requiredPermission} clearance. Restricted to ADMIN / SUPER_ADMIN operators.`,
    };
  }

  return {
    allowed: true,
    httpStatus: 200,
    code: 'AUTHORIZED',
    role: identity.role,
    requiredPermission,
    reason: `Role ${identity.role} authorized for ${requiredPermission}.`,
  };
}

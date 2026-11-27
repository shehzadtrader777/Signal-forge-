import crypto from 'node:crypto';
import type { RbacIdentity, RbacRole } from './rbac';
import { maskEmailAddress } from './otpChallenge';
import { matchDeterministicCommandIntent } from './voiceCommandDiagnostics';

export type OperatorSessionRole = 'ADMIN' | 'SUPER_ADMIN';

export interface OperatorSessionClaims {
  readonly uid: string;
  readonly role: OperatorSessionRole;
  readonly expiresAtMs: number;
  readonly nonce: string;
}

export interface OperatorSessionGrantDecision {
  readonly allowed: boolean;
  readonly httpStatus: 200 | 401 | 403;
  readonly code: 'AUTHORIZED' | 'AUTH_REQUIRED' | 'OPERATOR_ROLE_REQUIRED';
  readonly role: RbacRole;
  readonly reason: string;
}

export type AiCommandAuthScope =
  | 'PUBLIC_READ_ONLY'
  | 'AUTHENTICATED_AI_QUERY'
  | 'ADMIN_PRIVILEGED'
  | 'TRADING_EXECUTION_BLOCKED';

export interface AiCommandAuthDecision {
  readonly allowed: boolean;
  readonly scope: AiCommandAuthScope;
  readonly httpStatus: 200 | 401 | 403 | 423;
  readonly code:
    | 'AUTHORIZED_PUBLIC_READ_ONLY'
    | 'AUTHORIZED_AUTHENTICATED_QUERY'
    | 'AUTHORIZED_ADMIN_COMMAND'
    | 'AUTH_REQUIRED'
    | 'ADMIN_AUTHORIZATION_REQUIRED'
    | 'SAFETY_LOCK_ENFORCED';
  readonly reason: string;
  readonly urduReason: string;
}

export function isPrivilegedOperatorRole(role: RbacRole | string | null | undefined): role is OperatorSessionRole {
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

/**
 * Evaluates whether a resolved RBAC identity may be issued an operator session token.
 * Guests are strictly denied (401) and standard users are never promoted (403).
 */
export function evaluateOperatorSessionGrant(
  identity: RbacIdentity | null | undefined
): OperatorSessionGrantDecision {
  if (!identity || !identity.authenticated || !identity.uid || identity.role === 'GUEST') {
    return {
      allowed: false,
      httpStatus: 401,
      code: 'AUTH_REQUIRED',
      role: 'GUEST',
      reason: 'Verified authentication is required to establish an operator session.',
    };
  }

  if (!isPrivilegedOperatorRole(identity.role)) {
    return {
      allowed: false,
      httpStatus: 403,
      code: 'OPERATOR_ROLE_REQUIRED',
      role: identity.role,
      reason: `Role ${identity.role} does not hold operator privileges. Restricted to verified ADMIN / SUPER_ADMIN accounts.`,
    };
  }

  return {
    allowed: true,
    httpStatus: 200,
    code: 'AUTHORIZED',
    role: identity.role,
    reason: `Operator session granted for verified ${identity.role} principal.`,
  };
}

function encodeSegment(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function decodeSegment(encoded: string): string | null {
  try {
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
    return Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Mints an identity-bound HMAC-SHA256 operator session token (v2).
 * Only accepts ADMIN or SUPER_ADMIN roles.
 */
export function signOperatorSessionToken(params: {
  readonly uid: string;
  readonly role: OperatorSessionRole;
  readonly signingKey: string;
  readonly ttlMs: number;
  readonly nowMs?: number;
}): { readonly token: string; readonly expiresAtMs: number } {
  const uid = String(params.uid || '').trim();
  if (!uid || !isPrivilegedOperatorRole(params.role)) {
    throw new Error('Operator session tokens require a non-empty uid and ADMIN/SUPER_ADMIN role.');
  }
  const nowMs = params.nowMs ?? Date.now();
  const expiresAtMs = nowMs + params.ttlMs;
  const nonce = crypto.randomBytes(12).toString('hex');
  const payload = `v2.${encodeSegment(uid)}.${params.role}.${expiresAtMs}.${nonce}`;
  const sig = crypto
    .createHmac('sha256', params.signingKey)
    .update(payload)
    .digest('hex');
  return { token: `${payload}.${sig}`, expiresAtMs };
}

/**
 * Verifies an identity-bound v2 operator session token and returns its claims, or null.
 * Rejects legacy anonymous v1 tokens, tampered signatures, expired tokens, and non-operator roles.
 */
export function verifyOperatorSessionToken(
  token: unknown,
  signingKey: string,
  nowMs = Date.now()
): OperatorSessionClaims | null {
  if (typeof token !== 'string' || !token || !signingKey) return null;
  const parts = token.split('.');
  if (parts.length !== 6) return null;
  const [version, uidB64, roleRaw, expStr, nonce, sig] = parts;
  if (version !== 'v2' || !uidB64 || !roleRaw || !expStr || !nonce || !sig) {
    return null;
  }
  if (!isPrivilegedOperatorRole(roleRaw)) {
    return null;
  }
  const expiresAtMs = Number(expStr);
  if (!Number.isFinite(expiresAtMs) || nowMs > expiresAtMs) {
    return null;
  }
  const uid = decodeSegment(uidB64);
  if (!uid || uid.length > 160) {
    return null;
  }

  const payload = `${version}.${uidB64}.${roleRaw}.${expStr}.${nonce}`;
  const expectedSig = crypto
    .createHmac('sha256', signingKey)
    .update(payload)
    .digest('hex');

  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  return {
    uid,
    role: roleRaw,
    expiresAtMs,
    nonce,
  };
}

const TRADING_EXECUTION_MUTATION_PATTERNS: readonly RegExp[] = [
  /\b(execute|place|open|submit|send|trigger)\b.{0,40}\b(live\s+trade|live\s+order|real\s+order|market\s+order|limit\s+order|buy\s+order|sell\s+order|real[\s-]money)\b/i,
  /\b(buy|sell|long|short)\b\s+\d+(\.\d+)?\s*(btc|eth|sol|bnb|xrp|avax|doge|usdt|usd|\$)/i,
  /\b(enable|activate|switch\s+to|turn\s+on)\b.{0,30}\b(live\s+trading|live\s+execution|real[\s-]money)\b/i,
  /\b(disable|bypass|override|remove|turn\s+off)\b.{0,35}\b(423|safety\s+lock|emergency\s+halt|fail[\s-]?safe|circuit\s+breaker|risk\s+lock)\b/i,
  /\b(unlock|withdraw|drain|transfer)\b.{0,30}\b(profit\s+vault|vault|locker|wallet|funds)\b/i,
];

const ADMIN_PRIVILEGED_COMMAND_PATTERNS: readonly RegExp[] = [
  /\b(rotate|revoke|replace|update|change|set|delete|show|reveal|print|dump|export)\b.{0,35}\b(api\s+key|secret|token|credentials?|password|passphrase|vault|env)\b/i,
  /\b(start|end|toggle|enable|disable|approve|rollback|schedule)\b.{0,35}\b(maintenance|emergency\s+halt|emergency\s+stop|app\s+live|webhook|telegram\s+bot|agentic\s+cli|auto[\s-]?fallback|business\s+config|subscription)\b/i,
  /\b(edit|modify|patch|write|delete|revert)\b.{0,30}\b(file|script|codebase|server\.ts|config|source\s+code)\b/i,
  /\b(diagnose[\s-]?quota|admin\s+panel|operator\s+override|force\s+all\s+(on|off))\b/i,
];

const PUBLIC_HELP_PATTERNS: readonly RegExp[] = [
  /^(help|commands|supported commands|what can you do|menu|\?)[!.?]*$/i,
];

/**
 * Classifies and authorizes an incoming AI Command Hub prompt before any
 * local command routing or Gemini invocation can run.
 *
 * Security invariants:
 * 1. Real-money trading, safety-lock bypass, emergency-halt disable, and vault
 *    unlock commands are ALWAYS blocked under HTTP 423 (regardless of role).
 * 2. Administrative/configuration commands require authenticated ADMIN/SUPER_ADMIN.
 * 3. Harmless read-only support prompts ("hello", "status", "help") stay publicly
 *    accessible without consuming Gemini quota or mutating state.
 * 4. General Gemini LLM queries require an authenticated caller so unauthenticated
 *    guests cannot consume server Gemini API quota.
 */
export function classifyAiCommandAuthorization(
  rawPrompt: string,
  identity: RbacIdentity | null | undefined
): AiCommandAuthDecision {
  const prompt = String(rawPrompt || '').trim();

  if (TRADING_EXECUTION_MUTATION_PATTERNS.some((re) => re.test(prompt))) {
    return {
      allowed: false,
      scope: 'TRADING_EXECUTION_BLOCKED',
      httpStatus: 423,
      code: 'SAFETY_LOCK_ENFORCED',
      reason:
        'Trading execution, Profit Vault unlocks, and Emergency Halt / HTTP 423 safety-lock overrides are strictly disabled in AI Command Hub.',
      urduReason:
        'AI Command Hub کے ذریعے لائیو ٹریڈنگ، پرافٹ والٹ ان لاک، یا HTTP 423 سیفٹی لاک/ایمرجنسی ہالٹ کو بند کرنا سختی سے ممنوع ہے۔',
    };
  }

  if (ADMIN_PRIVILEGED_COMMAND_PATTERNS.some((re) => re.test(prompt))) {
    if (!identity || !identity.authenticated || !identity.uid || identity.role === 'GUEST') {
      return {
        allowed: false,
        scope: 'ADMIN_PRIVILEGED',
        httpStatus: 401,
        code: 'AUTH_REQUIRED',
        reason:
          'Owner authentication is required for administrative, credential, maintenance, or configuration commands.',
        urduReason:
          'ایڈمن، API کلید، مینٹیننس یا سسٹم کنفیگریشن کمانڈز کے لیے مالک (Owner) کا سائن ان ہونا لازمی ہے۔',
      };
    }
    if (!identity.permissions.includes('AI_ADMIN_COMMAND') || !isPrivilegedOperatorRole(identity.role)) {
      return {
        allowed: false,
        scope: 'ADMIN_PRIVILEGED',
        httpStatus: 403,
        code: 'ADMIN_AUTHORIZATION_REQUIRED',
        reason: `Role ${identity.role} is not authorized for administrative AI commands. Restricted to verified ADMIN / SUPER_ADMIN operators.`,
        urduReason:
          'آپ کے اکاؤنٹ کو ایڈمن AI کمانڈز چلانے کی اجازت نہیں ہے۔ یہ سہولت صرف تصدیق شدہ Owner/Admin کے لیے ہے۔',
      };
    }
    return {
      allowed: true,
      scope: 'ADMIN_PRIVILEGED',
      httpStatus: 200,
      code: 'AUTHORIZED_ADMIN_COMMAND',
      reason: 'Authenticated owner authorized for read-only administrative command assistance.',
      urduReason: 'تصدیق شدہ ایڈمن کمانڈ کی اجازت مل گئی۔',
    };
  }

  const deterministicKind = matchDeterministicCommandIntent(prompt);
  if (
    deterministicKind === 'GREETING' ||
    deterministicKind === 'STATUS' ||
    PUBLIC_HELP_PATTERNS.some((re) => re.test(prompt))
  ) {
    return {
      allowed: true,
      scope: 'PUBLIC_READ_ONLY',
      httpStatus: 200,
      code: 'AUTHORIZED_PUBLIC_READ_ONLY',
      reason: 'Read-only public support command permitted.',
      urduReason: 'صرف پڑھنے کے لیے عوامی سپورٹ کمانڈ کی اجازت ہے۔',
    };
  }

  if (!identity || !identity.authenticated || !identity.uid || identity.role === 'GUEST') {
    return {
      allowed: false,
      scope: 'AUTHENTICATED_AI_QUERY',
      httpStatus: 401,
      code: 'AUTH_REQUIRED',
      reason:
        'Sign in with a verified Signal Forge account to run AI model queries. Public read-only commands ("hello", "status", "help") remain available without signing in.',
      urduReason:
        'AI ماڈل سے سوالات پوچھنے کے لیے Signal Forge اکاؤنٹ میں سائن ان کریں۔ مقامی عوامی کمانڈز ("hello"، "status"، "help") سائن ان کے بغیر دستیاب ہیں۔',
    };
  }

  return {
    allowed: true,
    scope: 'AUTHENTICATED_AI_QUERY',
    httpStatus: 200,
    code: 'AUTHORIZED_AUTHENTICATED_QUERY',
    reason: `Authenticated ${identity.role} principal authorized for AI query.`,
    urduReason: 'تصدیق شدہ صارف کے لیے AI سوال کی اجازت ہے۔',
  };
}

/**
 * Masks email addresses inside sender strings (e.g. "Signal Forge <user@gmail.com>" -> "Signal Forge <us***@gmail.com>")
 * while keeping Resend's public sandbox address recognizable.
 */
export function maskSenderAddress(rawSender: string): string {
  const sender = String(rawSender || '').trim();
  if (!sender) return 'Not configured';
  if (sender.toLowerCase().includes('onboarding@resend.dev')) {
    return 'Signal Forge <onboarding@resend.dev>';
  }
  const emailMatch = sender.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (!emailMatch) {
    return '[configured-sender]';
  }
  const rawEmail = emailMatch[0];
  const masked = maskEmailAddress(rawEmail);
  return sender.replace(rawEmail, masked);
}

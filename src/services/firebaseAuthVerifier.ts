import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UNAUTHENTICATED_PRINCIPAL,
  type SubscriptionPrincipal,
  type SubscriptionStatus,
  type SubscriptionTier,
} from '../lib/subscriptionGatekeeper';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FirebaseConfigFile {
  projectId?: string;
}

function loadProjectId(): string {
  try {
    const cfgPath = path.resolve(__dirname, '../../firebase-applet-config.json');
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const parsed = JSON.parse(raw) as FirebaseConfigFile;
    if (parsed.projectId && parsed.projectId !== 'remixed-project-id') {
      return parsed.projectId;
    }
  } catch {
    // fallback to env if config missing
  }
  return process.env.FIREBASE_PROJECT_ID || '';
}

const FIREBASE_PROJECT_ID = loadProjectId();
const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let cachedCerts: Record<string, string> = {};
let certsExpiresAtMs = 0;

async function getFirebasePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (now < certsExpiresAtMs && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(GOOGLE_CERTS_URL, { signal: controller.signal });
    if (!res.ok) {
      return {};
    }
    const json = (await res.json()) as Record<string, string>;
    const cc = res.headers.get('cache-control') || '';
    const maxAgeMatch = cc.match(/max-age=(\d+)/i);
    const ttlSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 0;
    cachedCerts = json;
    certsExpiresAtMs = now + Math.max(0, Math.min(3600, ttlSec)) * 1000;
    return cachedCerts;
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

export interface VerifiedFirebaseToken {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  expMs: number;
}

function decodeBase64Url(segment: string): Buffer {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}

/** Validate the structure of claims; this does not establish signature authenticity. */
export function validateFirebaseTokenClaims(payload: unknown, projectId: string, nowSec: number): VerifiedFirebaseToken | null {
  if (!payload || typeof payload !== 'object' || !projectId || !Number.isFinite(nowSec)) return null;
  const p = payload as Record<string, unknown>;
  if (p.aud !== projectId || p.iss !== `https://securetoken.google.com/${projectId}`) return null;
  if (typeof p.sub !== 'string' || !p.sub.trim() || p.sub.length > 128) return null;
  if (typeof p.exp !== 'number' || !Number.isSafeInteger(p.exp) || p.exp <= nowSec) return null;
  if (typeof p.iat !== 'number' || !Number.isSafeInteger(p.iat) || p.iat <= 0 || p.iat > nowSec + 300 || p.exp <= p.iat || p.exp - p.iat > 3900) return null;
  if (typeof p.auth_time !== 'number' || !Number.isSafeInteger(p.auth_time) || p.auth_time <= 0 || p.auth_time > nowSec + 300 || p.auth_time > p.iat + 300) return null;
  return {
    uid: p.sub,
    email: typeof p.email === 'string' ? p.email : null,
    emailVerified: p.email_verified === true,
    name: typeof p.name === 'string' ? p.name : null,
    expMs: p.exp * 1000,
  };
}

export async function verifyFirebaseIdToken(
  idToken: string
): Promise<VerifiedFirebaseToken | null> {
  if (!idToken || idToken.length > 16_384 || !FIREBASE_PROJECT_ID) return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  try {
    const header = JSON.parse(decodeBase64Url(headerB64).toString('utf8')) as {
      alg?: string;
      kid?: string;
    };
    const payload: unknown = JSON.parse(decodeBase64Url(payloadB64).toString('utf8'));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.kid.length > 256) return null;
    const claims = validateFirebaseTokenClaims(payload, FIREBASE_PROJECT_ID, Math.floor(Date.now() / 1000));
    if (!claims) return null;

    const certs = await getFirebasePublicCerts();
    if (!Object.hasOwn(certs, header.kid)) return null;
    const certPem = certs[header.kid];
    if (typeof certPem !== 'string' || !certPem) return null;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    verifier.end();
    const signature = decodeBase64Url(sigB64);
    if (!verifier.verify(certPem, signature)) return null;

    return claims;
  } catch {
    return null;
  }
}

interface StoredSubscriptionEntitlement {
  uid: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  expiresAtMs: number | null;
  entitlementId: string;
  planLabel: string;
  updatedAtIso: string;
}

const subscriptionRegistry = new Map<string, StoredSubscriptionEntitlement>();

export function grantOrUpdateSubscription(input: {
  uid: string;
  tier: SubscriptionTier;
  status?: SubscriptionStatus;
  durationDays?: number;
  planLabel?: string;
}): StoredSubscriptionEntitlement {
  const durationDays = input.durationDays ?? 30;
  const status: SubscriptionStatus =
    input.status ?? (input.tier === 'PREMIUM_INSTITUTIONAL' ? 'ACTIVE' : 'INACTIVE');
  const record: StoredSubscriptionEntitlement = {
    uid: input.uid,
    tier: input.tier,
    status,
    expiresAtMs:
      input.tier === 'PREMIUM_INSTITUTIONAL' && status === 'ACTIVE'
        ? Date.now() + durationDays * 86_400_000
        : null,
    entitlementId:
      input.tier === 'PREMIUM_INSTITUTIONAL'
        ? `ent_prem_${crypto.randomBytes(6).toString('hex')}`
        : `ent_free_${input.uid.slice(0, 8)}`,
    planLabel:
      input.planLabel ??
      (input.tier === 'PREMIUM_INSTITUTIONAL'
        ? 'Premium Institutional Desk'
        : input.tier === 'PRO'
        ? 'Pro Signal Viewer'
        : 'Free Tier (Locked Controls)'),
    updatedAtIso: new Date().toISOString(),
  };
  subscriptionRegistry.set(input.uid, record);
  return record;
}

export function resolvePrincipalFromVerifiedToken(
  token: VerifiedFirebaseToken | null
): SubscriptionPrincipal {
  if (!token) return UNAUTHENTICATED_PRINCIPAL;
  const stored = subscriptionRegistry.get(token.uid);
  if (!stored) {
    return {
      authenticated: true,
      uid: token.uid,
      email: token.email,
      emailVerified: token.emailVerified,
      tier: 'FREE',
      status: 'INACTIVE',
      expiresAtMs: null,
      entitlementId: null,
      planLabel: 'Free Authenticated Account (Locked)',
    };
  }
  return {
    authenticated: true,
    uid: token.uid,
    email: token.email,
    emailVerified: token.emailVerified,
    tier: stored.tier,
    status: stored.status,
    expiresAtMs: stored.expiresAtMs,
    entitlementId: stored.entitlementId,
    planLabel: stored.planLabel,
  };
}

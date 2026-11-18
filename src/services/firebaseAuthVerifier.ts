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
      return cachedCerts;
    }
    const json = (await res.json()) as Record<string, string>;
    const cc = res.headers.get('cache-control') || '';
    const maxAgeMatch = cc.match(/max-age=(\d+)/i);
    const ttlSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
    cachedCerts = json;
    certsExpiresAtMs = now + Math.max(60, ttlSec) * 1000;
    return cachedCerts;
  } catch {
    return cachedCerts;
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

export async function verifyFirebaseIdToken(
  idToken: string
): Promise<VerifiedFirebaseToken | null> {
  if (!idToken || !FIREBASE_PROJECT_ID) return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  try {
    const header = JSON.parse(decodeBase64Url(headerB64).toString('utf8')) as {
      alg?: string;
      kid?: string;
    };
    const payload = JSON.parse(decodeBase64Url(payloadB64).toString('utf8')) as {
      aud?: string;
      iss?: string;
      sub?: string;
      exp?: number;
      iat?: number;
      auth_time?: number;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };

    if (header.alg !== 'RS256' || !header.kid) return null;
    if (payload.aud !== FIREBASE_PROJECT_ID) return null;
    if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return null;
    if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) return null;

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return null;
    if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) return null;

    const certs = await getFirebasePublicCerts();
    const certPem = certs[header.kid];
    if (!certPem) return null;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    verifier.end();
    const signature = decodeBase64Url(sigB64);
    if (!verifier.verify(certPem, signature)) return null;

    return {
      uid: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      emailVerified: Boolean(payload.email_verified),
      name: typeof payload.name === 'string' ? payload.name : null,
      expMs: payload.exp * 1000,
    };
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

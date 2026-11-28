import { randomBytes } from 'node:crypto';

/** Safely resolve session signing secrets without a rotating production fallback. */
export function resolveSessionSigningKey(env = process.env, generate = () => randomBytes(32).toString('hex')) {
  const production = env.NODE_ENV === 'production';
  const configured = typeof env.SESSION_SIGNING_KEY === 'string' ? env.SESSION_SIGNING_KEY.trim() : '';
  if (configured) {
    if (production && configured.length < 32) {
      throw new Error('Production SESSION_SIGNING_KEY must be at least 32 characters.');
    }
    return configured;
  }
  if (production) {
    throw new Error('SESSION_SIGNING_KEY is mandatory in production.');
  }
  return generate();
}

/**
 * Browser-submitted realized PnL has no verified exchange settlement provenance.
 * Keep this legacy manual-entry endpoint unavailable in production, even if an
 * operator mistakenly enables the local demo switch.
 */
export function isManualVaultGainDemoEnabled(env = process.env) {
  return env.NODE_ENV !== 'production' && env.ALLOW_UNVERIFIED_VAULT_GAIN_DEMO === 'true';
}

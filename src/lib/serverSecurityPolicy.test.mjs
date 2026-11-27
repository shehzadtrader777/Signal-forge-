import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveSessionSigningKey } from './serverSecurityPolicy.mjs';

test('production fails closed without signing key', () => {
  assert.throws(() => resolveSessionSigningKey({NODE_ENV:'production'}), /mandatory/);
});
test('production rejects short signing keys', () => {
  assert.throws(() => resolveSessionSigningKey({NODE_ENV:'production', SESSION_SIGNING_KEY:'too-short'}), /at least 32/);
});
test('production accepts sufficiently long configured signing key', () => {
  const key = 'a'.repeat(64);
  assert.equal(resolveSessionSigningKey({NODE_ENV:'production', SESSION_SIGNING_KEY:key}), key);
});
test('development uses generated secret only when missing', () => {
  assert.equal(resolveSessionSigningKey({NODE_ENV:'development'}, () => 'dev-random'), 'dev-random');
});
test('development reuses a configured secret', () => {
  assert.equal(resolveSessionSigningKey({NODE_ENV:'development',SESSION_SIGNING_KEY:'local-config'}), 'local-config');
});

// Keep confidential CoinMarketCap credentials out of Vite's browser-exposed env namespace.
test('environment template does not offer a browser-exposed CoinMarketCap API key', () => {
  const template = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  assert.doesNotMatch(template, /^VITE_CMC_API_KEY\s*=/m);
  assert.match(template, /^CMC_API_KEY\s*=/m);
});

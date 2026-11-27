import test from 'node:test';
import assert from 'node:assert/strict';
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

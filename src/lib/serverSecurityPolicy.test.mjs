import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveSessionSigningKey, isManualVaultGainDemoEnabled } from './serverSecurityPolicy.mjs';

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

// Prevent accidental upload of Studio export backups or private credential material.
test('Studio source-sync safety exclusions protect backups and credentials', () => {
  const ignore = readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8');
  const dockerIgnore = readFileSync(new URL('../../.dockerignore', import.meta.url), 'utf8');
  for (const rule of ['.aistudio/', '.backups/', '*.zip', '*.pem']) {
    assert.ok(ignore.split(/\r?\n/).includes(rule), `Missing Git exclusion for ${rule}`);
  }
  for (const rule of ['.aistudio', '.backups', '*.zip', '*.pem']) {
    assert.ok(dockerIgnore.split(/\r?\n/).includes(rule), `Missing Docker exclusion for ${rule}`);
  }
  assert.match(ignore, /^\.env\*$/m);
  assert.match(ignore, /^\*service-account\*\.json$/m);
});

test('unverified manual vault gain is off by default and cannot run in production', () => {
  assert.equal(isManualVaultGainDemoEnabled({}), false);
  assert.equal(isManualVaultGainDemoEnabled({NODE_ENV: 'development'}), false);
  assert.equal(isManualVaultGainDemoEnabled({NODE_ENV: 'production', ALLOW_UNVERIFIED_VAULT_GAIN_DEMO: 'true'}), false);
  assert.equal(isManualVaultGainDemoEnabled({NODE_ENV: 'development', ALLOW_UNVERIFIED_VAULT_GAIN_DEMO: 'true'}), true);
  assert.equal(isManualVaultGainDemoEnabled({NODE_ENV: 'test', ALLOW_UNVERIFIED_VAULT_GAIN_DEMO: 'TRUE'}), false);
});

test('manual PnL route enforces production-deny before importing unverified profit', () => {
  const server = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
  const marker = "app.post('/api/vault/record-gain'";
  const start = server.indexOf(marker);
  assert.ok(start > 0);
  const slice = server.slice(start, start + 2300);
  const gateIndex = slice.indexOf('if (!isManualVaultGainDemoEnabled(process.env))');
  const ingestIndex = slice.indexOf('profitVaultEngine.ingestRealizedTrade(');
  assert.ok(gateIndex >= 0 && ingestIndex > gateIndex, 'Manual ingest must be gated before financial state mutation');
  assert.ok(slice.includes("code: 'UNVERIFIED_VAULT_GAIN_DISABLED'"));
});

test('financial vault snapshot endpoint requires operator authorization', () => {
  const server = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../components/ProfitVaultAndDailyPnlPanel.tsx', import.meta.url), 'utf8');
  assert.match(server, /app\.get\('\/api\/vault\/state', requireOperatorAuth, \(_req, res\) => \{/);
  assert.ok(panel.includes("await apiFetch('/api/vault/state')"),
    'Vault panel must attach verified session headers before accessing financial snapshot');
  assert.ok(!panel.includes("await fetch('/api/vault/state')"),
    'Do not fetch protected financial snapshot anonymously');
});

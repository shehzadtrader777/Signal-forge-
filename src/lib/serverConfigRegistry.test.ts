import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildOwnerConfigHealthReport,
  recordBootPresenceSnapshot,
} from './serverConfigRegistry';
import { CoinGeckoMarketClient } from './coinGeckoClient';

const SECRET_GEMINI = 'AIzaSyFakeTestGeminiSecretValue1234567890';
const SECRET_CG = 'CG-FakeTestCoinGeckoKey987654321';
const SECRET_TG_BOT = '1234567890:AAFakeTestTelegramBotTokenSecretXYZ123';
const SECRET_DISCORD = 'https://discord.com/api/webhooks/123456789012345678/FakeDiscordTokenSecretABCDEF1234567890';
const SECRET_OPERATOR = 'op_super_secret_bearer_token_abcdef1234567890';

test('serverConfigRegistry classifies CONFIGURED, VERIFIED, PENDING_VERIFICATION, PENDING_OWNER_CONFIGURATION, INVALID_FORMAT, MISSING, and leaks zero secrets', () => {
  const env: Record<string, string | undefined> = {
    GEMINI_API_KEY: SECRET_GEMINI,
    COINGECKO_API_KEY: SECRET_CG,
    COINGECKO_API_TIER: 'demo',
    ADMIN_EMAIL_ALLOWLIST: 'owner@signalforge.example.com',
    TELEGRAM_BOT_TOKEN: SECRET_TG_BOT,
    // Malformed TELEGRAM_CHAT_ID (bot token pasted into channel ID) -> must be PENDING_OWNER_CONFIGURATION
    TELEGRAM_CHAT_ID: SECRET_TG_BOT,
    TELEGRAM_DEV_CHAT_ID: '-1001234567890', // invalid negative channel ID in dev chat
    TELEGRAM_WEBHOOK_SECRET: SECRET_TG_BOT, // invalid reuse of bot token
    DISCORD_WEBHOOK_URL: SECRET_DISCORD,
    OPERATOR_API_TOKEN: SECRET_OPERATOR,
    BOT_TOKEN: SECRET_TG_BOT, // obsolete conflict
    VITE_CMC_API_KEY: 'cmc-bad-client-key-1234567890', // obsolete client leak
  };

  const preDotenvKeys = new Set(Object.keys(env));
  const dotenvLoadedKeys = new Set<string>();

  const report = buildOwnerConfigHealthReport({
    env,
    preDotenvKeys,
    dotenvLoadedKeys,
    localDotenvFilePresent: false,
    previousBootSnapshot: null,
    currentBootSnapshot: null,
    coinGeckoStatus: new CoinGeckoMarketClient({ apiKey: SECRET_CG, tier: 'demo' }).getSanitizedStatus(),
  });

  const byName = new Map(report.items.map((i) => [i.name, i]));

  assert.equal(byName.get('GEMINI_API_KEY')?.status, 'CONFIGURED');
  assert.equal(byName.get('GEMINI_API_KEY')?.source, 'PLATFORM_RUNTIME_ENV');
  assert.equal(byName.get('COINGECKO_API_KEY')?.status, 'PENDING_VERIFICATION');
  assert.equal(byName.get('COINGECKO_API_TIER')?.status, 'CONFIGURED');
  assert.equal(byName.get('ADMIN_EMAIL_ALLOWLIST')?.status, 'VERIFIED');
  assert.equal(byName.get('TELEGRAM_CHAT_ID')?.status, 'PENDING_OWNER_CONFIGURATION');
  assert.equal(report.telegramReadiness.canonicalChannelStatus, 'PENDING_OWNER_CONFIGURATION');
  assert.equal(byName.get('TELEGRAM_DEV_CHAT_ID')?.status, 'INVALID_FORMAT');
  assert.equal(byName.get('TELEGRAM_WEBHOOK_SECRET')?.status, 'INVALID_FORMAT');
  assert.equal(byName.get('DISCORD_WEBHOOK_URL')?.status, 'PENDING_VERIFICATION');
  assert.equal(byName.get('OPERATOR_API_TOKEN')?.status, 'CONFIGURED');
  assert.equal(byName.get('MAKE_WEBHOOK_URL')?.status, 'MISSING');

  // Obsolete warnings detected
  assert.ok(report.obsoleteWarnings.some((w) => w.name === 'BOT_TOKEN'));
  assert.ok(report.obsoleteWarnings.some((w) => w.name === 'VITE_CMC_API_KEY'));

  // Strict zero-secret leakage guarantee (no values, no prefixes, no fragments)
  const serialized = JSON.stringify(report);
  for (const secret of [SECRET_GEMINI, SECRET_CG, SECRET_TG_BOT, SECRET_DISCORD, SECRET_OPERATOR]) {
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes(secret.slice(0, 8)), false);
    assert.equal(serialized.includes(secret.slice(-8)), false);
  }
});

test('serverConfigRegistry detects VERIFIED_PERSISTENT and RESTART_NOT_PERSISTED across restarts without storing secrets on disk', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-env-persist-'));
  const snapshotPath = path.join(tmpDir, 'env-persistence-snapshot.json');

  try {
    // Boot 1: GEMINI_API_KEY and COINGECKO_API_KEY present
    const boot1Env: Record<string, string | undefined> = {
      GEMINI_API_KEY: SECRET_GEMINI,
      COINGECKO_API_KEY: SECRET_CG,
      TELEGRAM_CHAT_ID: '-1002223334445',
    };
    const boot1 = recordBootPresenceSnapshot({
      snapshotPath,
      env: boot1Env,
      preDotenvKeys: new Set(['GEMINI_API_KEY', 'COINGECKO_API_KEY']),
      dotenvLoadedKeys: new Set(['TELEGRAM_CHAT_ID']),
      nowIso: '2026-11-26T10:00:00.000Z',
    });
    assert.equal(boot1.current.bootCount, 1);

    // Ensure snapshot file on disk contains ZERO secret values or fragments
    const rawSnapshot = fs.readFileSync(snapshotPath, 'utf8');
    assert.equal(rawSnapshot.includes(SECRET_GEMINI), false);
    assert.equal(rawSnapshot.includes(SECRET_GEMINI.slice(0, 8)), false);
    assert.equal(rawSnapshot.includes(SECRET_CG), false);
    assert.equal(rawSnapshot.includes('-1002223334445'), false);

    // Boot 2 (after restart): GEMINI_API_KEY persisted, COINGECKO_API_KEY disappeared!
    const boot2Env: Record<string, string | undefined> = {
      GEMINI_API_KEY: SECRET_GEMINI,
      TELEGRAM_CHAT_ID: '-1002223334445',
    };
    const boot2 = recordBootPresenceSnapshot({
      snapshotPath,
      env: boot2Env,
      preDotenvKeys: new Set(['GEMINI_API_KEY', 'TELEGRAM_CHAT_ID']),
      dotenvLoadedKeys: new Set(),
      nowIso: '2026-11-26T10:05:00.000Z',
    });
    assert.equal(boot2.current.bootCount, 2);

    const report = buildOwnerConfigHealthReport({
      env: boot2Env,
      preDotenvKeys: new Set(['GEMINI_API_KEY', 'TELEGRAM_CHAT_ID']),
      dotenvLoadedKeys: new Set(),
      localDotenvFilePresent: false,
      previousBootSnapshot: boot2.previous,
      currentBootSnapshot: boot2.current,
    });

    const byName = new Map(report.items.map((i) => [i.name, i]));
    assert.equal(byName.get('GEMINI_API_KEY')?.persistence, 'VERIFIED_PERSISTENT');
    assert.equal(byName.get('GEMINI_API_KEY')?.status, 'CONFIGURED');

    assert.equal(byName.get('COINGECKO_API_KEY')?.persistence, 'NOT_PERSISTED_AFTER_RESTART');
    assert.equal(byName.get('COINGECKO_API_KEY')?.status, 'RESTART_NOT_PERSISTED');
    assert.equal(report.summary.restartNotPersisted, 1);

    assert.equal(byName.get('TELEGRAM_CHAT_ID')?.status, 'CONFIGURED');
    assert.equal(report.telegramReadiness.canonicalChannelStatus, 'CONFIGURED');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CoinGeckoMarketClient distinguishes PENDING_VERIFICATION (key configured) from PENDING_CREDENTIALS (key missing)', () => {
  const configuredClient = new CoinGeckoMarketClient({ apiKey: SECRET_CG, tier: 'demo' });
  const configuredStatus = configuredClient.getSanitizedStatus();
  assert.equal(configuredStatus.configured, true);
  assert.equal(configuredStatus.connectionStatus, 'PENDING_VERIFICATION');

  const unconfiguredClient = new CoinGeckoMarketClient({ apiKey: '', tier: 'demo' });
  const unconfiguredStatus = unconfiguredClient.getSanitizedStatus();
  assert.equal(unconfiguredStatus.configured, false);
  assert.equal(unconfiguredStatus.connectionStatus, 'PENDING_CREDENTIALS');
});

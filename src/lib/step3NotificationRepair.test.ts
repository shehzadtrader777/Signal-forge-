import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendDiscordWaitQuery,
  buildDiscordSignalPayload,
  buildSecretFreeMakePayload,
  createPersistedSignalPayload,
  resolveDiscordWebhookConfig,
  resolveMakeWebhookConfig,
  resolveTelegramConfig,
  sanitizeNotificationError,
  validatePersistedSignalPayload,
} from './notificationDeliveryConfig';
import {
  NotificationDispatcher,
  PersistentNotificationLedger,
  type FetchLike,
} from './notificationLedgerServer';
import { extractTradingAlertParams } from './signalProcessor';

const TEST_BOT_TOKEN = '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
const LEGACY_BAD_TOKEN = '999999999:LEGACY_EXPIRED_TOKEN_12345678901234';
const TEST_MAKE_URL = 'https://hook.us2.make.com/abc123def456ghi789jkl012mno345pq';
const TEST_DISCORD_URL =
  'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123456';

function createTempLedgerPath(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sf-${prefix}-`));
  return path.join(dir, 'ledger.sqlite');
}

function makeSamplePayload(overrides?: {
  signalId?: string;
  symbol?: string;
  signalCategory?: 'GENERATED_SIGNAL' | 'PAPER_EXECUTED_TRADE' | 'REALIZED_RESULT';
  finalPnlUsd?: number | null;
  finalPnlPercent?: number | null;
}) {
  const extracted = extractTradingAlertParams({
    source: 'AUTOMATED',
    symbol: overrides?.symbol ?? 'BTCUSDT',
    direction: 'BUY',
    timeframe: '4h',
    entryPrice: 92450,
    tp1: 95500,
    tp2: 98800,
    tp3: 101695,
    stopLoss: 90601,
    confidence: 92,
    finalPnlUsd: overrides?.finalPnlUsd ?? null,
    finalPnlPercent: overrides?.finalPnlPercent ?? null,
    lifecycleStatus: overrides?.signalCategory === 'REALIZED_RESULT' ? 'CLOSED_TP' : 'OPEN',
  });
  assert.equal(extracted.ok, true);
  if (!extracted.ok) throw new Error('sample extraction failed');
  const card = {
    ...extracted.card,
    signalId: overrides?.signalId ?? 'sig_btc_test_001',
  };
  return createPersistedSignalPayload({
    card,
    targetChatId: '-1002345678901',
    channelName: 'Signal Forge',
    signalCategory: overrides?.signalCategory ?? 'GENERATED_SIGNAL',
    executionMode: 'PAPER_DRY_RUN',
  });
}

test('Canonical env precedence prefers TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_DEV_CHAT_ID and rejects malformed credentials', () => {
  const cfg = resolveTelegramConfig({
    TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
    BOT_TOKEN: LEGACY_BAD_TOKEN,
    TELEGRAM_CHAT_ID: TEST_BOT_TOKEN, // malformed: bot token pasted as chat ID!
    CHAT_ID: '-1002345678901',
    TELEGRAM_DEV_CHAT_ID: '-1002345678901', // malformed: public channel pasted as dev chat ID!
    DEVELOPER_CHAT_ID: '2345678901', // malformed: -100 stripped from public channel ID!
    TELEGRAM_CHANNEL_ID: 'https://t.me/SignalForgeOfficial',
    TELEGRAM_WEBHOOK_SECRET: TEST_BOT_TOKEN, // malformed: bot token reused as webhook secret!
  });

  // Canonical bot token wins over legacy BOT_TOKEN and flags conflict
  assert.equal(cfg.botToken, TEST_BOT_TOKEN);
  assert.equal(cfg.botTokenSource, 'TELEGRAM_BOT_TOKEN');
  assert.equal(cfg.legacyShadowConflict, true);

  // Bot token inside TELEGRAM_CHAT_ID is rejected; falls back to valid legacy CHAT_ID with advisory
  assert.equal(cfg.publicChatId, '-1002345678901');
  assert.equal(cfg.publicChatIdSource, 'LEGACY_CHAT_ID');
  assert.ok(cfg.issues.some((i) => i.code === 'TELEGRAM_CHAT_ID_IS_BOT_TOKEN'));

  // Negative channel ID and -100-stripped channel ID are BOTH rejected for private dev chat
  assert.equal(cfg.devChatId, null);
  assert.equal(cfg.devChatIdValid, false);
  assert.ok(cfg.issues.some((i) => i.code === 'DEV_CHAT_ID_IS_CHANNEL'));
  assert.ok(cfg.issues.some((i) => i.code === 'DEV_CHAT_ID_STRIPPED_FROM_CHANNEL'));

  // Bot token as webhook secret is rejected (fail-closed)
  assert.equal(cfg.webhookSecret, null);
  assert.equal(cfg.webhookSecretValid, false);
  assert.ok(cfg.issues.some((i) => i.code === 'WEBHOOK_SECRET_EQUALS_BOT_TOKEN'));

  // Channel URL normalized with warning
  assert.equal(cfg.publicChannelHandle, '@SignalForgeOfficial');
  assert.ok(cfg.issues.some((i) => i.code === 'TELEGRAM_CHANNEL_ID_IS_URL'));
});

test('Zero hardcoded chat ID fallbacks when Telegram env vars are absent', () => {
  const cfg = resolveTelegramConfig({});
  assert.equal(cfg.botToken, null);
  assert.equal(cfg.publicChatId, null);
  assert.equal(cfg.devChatId, null);
  assert.equal(cfg.webhookSecret, null);
  assert.equal(cfg.publicChatIdValid, false);
});

test('Make.com and Discord URL validation masks secrets and rejects malformed hosts/paths', () => {
  const validMake = resolveMakeWebhookConfig({ MAKE_WEBHOOK_URL: TEST_MAKE_URL });
  assert.equal(validMake.valid, true);
  assert.equal(validMake.maskedUrl, 'https://hook.us2.make.com/[redacted-webhook]');
  assert.equal(validMake.maskedUrl.includes('abc1'), false);
  assert.equal(validMake.maskedUrl.includes('def456ghi789'), false);

  const badMake = resolveMakeWebhookConfig({
    MAKE_WEBHOOK_URL: 'https://evil.example.com/abc123def456ghi789',
  });
  assert.equal(badMake.valid, false);
  assert.equal(badMake.webhookUrl, null);

  const validDiscord = resolveDiscordWebhookConfig({ DISCORD_WEBHOOK_URL: TEST_DISCORD_URL });
  assert.equal(validDiscord.valid, true);
  assert.equal(validDiscord.maskedUrl, 'https://discord.com/api/webhooks/[redacted]');
  assert.equal(validDiscord.maskedUrl.includes('123456789012345678'), false);
  assert.match(appendDiscordWaitQuery(TEST_DISCORD_URL), /\?wait=true$/);

  const sanitized = sanitizeNotificationError(
    `Failed POST ${TEST_MAKE_URL} with bot${TEST_BOT_TOKEN} and ${TEST_DISCORD_URL}`,
    [TEST_BOT_TOKEN, TEST_MAKE_URL, TEST_DISCORD_URL]
  );
  assert.ok(sanitized);
  assert.equal(sanitized?.includes(TEST_BOT_TOKEN), false);
  assert.equal(sanitized?.includes(TEST_MAKE_URL), false);
  assert.equal(sanitized?.includes(TEST_DISCORD_URL), false);
});

test('Outbound Make.com payload never includes bot_token and preserves full structured signal fields', () => {
  const payload = makeSamplePayload();
  const makeBody = buildSecretFreeMakePayload(payload);

  assert.equal('bot_token' in makeBody, false);
  assert.equal(JSON.stringify(makeBody).includes(TEST_BOT_TOKEN), false);
  assert.equal(makeBody.signal_id, 'sig_btc_test_001');
  assert.equal(makeBody.symbol, 'BTCUSDT');
  assert.equal(makeBody.pair, 'BTCUSDT');
  assert.equal(makeBody.entry_price, 92450);
  assert.deepEqual(makeBody.take_profits, { tp1: 95500, tp2: 98800, tp3: 101695 });
  assert.equal(makeBody.stop_loss, 90601);
  assert.equal(makeBody.confidence_score, 92);
});

test('Discord embed clearly distinguishes GENERATED_SIGNAL, PAPER_EXECUTED_TRADE, and REALIZED_RESULT', () => {
  const gen = buildDiscordSignalPayload(makeSamplePayload({ signalCategory: 'GENERATED_SIGNAL' }));
  assert.match(gen.content, /GENERATED SIGNAL \(UNEXECUTED\)/);
  assert.equal(gen.embeds[0].fields.find((f) => f.name === 'Result / P&L')?.value, 'Not Realized (Signal / Open State)');

  const paper = buildDiscordSignalPayload(
    makeSamplePayload({ signalCategory: 'PAPER_EXECUTED_TRADE' })
  );
  assert.match(paper.content, /PAPER EXECUTED TRADE \(SIMULATED\)/);

  const realized = buildDiscordSignalPayload(
    makeSamplePayload({
      signalCategory: 'REALIZED_RESULT',
      finalPnlUsd: 485.2,
      finalPnlPercent: 6.4,
    })
  );
  assert.match(realized.content, /REALIZED RESULT \(RECORDED\)/);
  assert.equal(realized.embeds[0].fields.find((f) => f.name === 'Result / P&L')?.value, '+$485.20 / +6.40%');
});

test('Single-transport policy prevents duplicate Make + Direct Telegram sends; Discord uses ?wait=true snowflake ID', async () => {
  const dbPath = createTempLedgerPath('single-transport');
  const ledger = new PersistentNotificationLedger(dbPath);
  const calls: Array<{ url: string; body: string }> = [];

  const mockFetch: FetchLike = async (url, init) => {
    calls.push({ url, body: String(init?.body || '') });
    if (url.includes('make.com')) {
      return new Response('Accepted', { status: 200 });
    }
    if (url.includes('discord.com')) {
      assert.ok(url.includes('wait=true'), 'Discord request must include ?wait=true');
      return new Response(JSON.stringify({ id: '1310987654321098765' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`Unexpected direct Telegram call when Make.com primary succeeded: ${url}`);
  };

  const dispatcher = new NotificationDispatcher({
    ledger,
    getEnv: () => ({
      TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
      TELEGRAM_CHAT_ID: '-1002345678901',
      MAKE_WEBHOOK_URL: TEST_MAKE_URL,
      DISCORD_WEBHOOK_URL: TEST_DISCORD_URL,
    }),
    fetchFn: mockFetch,
    initialPolicy: {
      telegramPrimaryTransport: 'MAKE_WEBHOOK',
      allowTelegramFallbackOnPrimaryFailure: false,
      discordEnabled: true,
    },
  });

  const payload = makeSamplePayload({ signalId: 'sig_single_001' });
  const outcome = await dispatcher.dispatchSignal({
    payload,
    approvedForPublicPublish: true,
  });

  // Exactly 2 calls: 1 Make.com + 1 Discord (ZERO direct Telegram parallel duplicate!)
  assert.equal(calls.length, 2);
  assert.equal(outcome.webhookDispatched, true);
  assert.equal(outcome.telegramMirrorDelivered, false);
  assert.equal(outcome.telegramRecord?.state, 'PROVIDER_ACCEPTED');
  assert.equal(outcome.discordRecord?.state, 'DELIVERED_WHEN_VERIFIABLE');
  assert.equal(outcome.discordRecord?.providerMessageId, '1310987654321098765');

  // Verify zero bot tokens in Make.com outbound body
  const makeCall = calls.find((c) => c.url.includes('make.com'));
  assert.ok(makeCall);
  assert.equal(makeCall.body.includes(TEST_BOT_TOKEN), false);
  assert.equal(makeCall.body.includes('bot_token'), false);

  // Simulate restart: close & reopen SQLite ledger — duplicate dispatch MUST be blocked!
  ledger.close();
  const reopenedLedger = new PersistentNotificationLedger(dbPath);
  const dispatcherAfterRestart = new NotificationDispatcher({
    ledger: reopenedLedger,
    getEnv: () => ({
      TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
      TELEGRAM_CHAT_ID: '-1002345678901',
      MAKE_WEBHOOK_URL: TEST_MAKE_URL,
      DISCORD_WEBHOOK_URL: TEST_DISCORD_URL,
    }),
    fetchFn: async () => {
      throw new Error('Duplicate dispatch after restart should have been blocked by SQLite ledger');
    },
  });

  const dupOutcome = await dispatcherAfterRestart.dispatchSignal({
    payload,
    approvedForPublicPublish: true,
  });
  assert.equal(dupOutcome.duplicateBlocked, true);
  assert.equal(dupOutcome.telegramRecord?.state, 'PROVIDER_ACCEPTED');
  assert.equal(dupOutcome.discordRecord?.providerMessageId, '1310987654321098765');

  reopenedLedger.close();
});

test('Make.com HTTP 404, Telegram 401 getMe auth failure, and separated lifecycle counters never fabricate success', async () => {
  const dbPath = createTempLedgerPath('failure-diagnostics');
  const ledger = new PersistentNotificationLedger(dbPath);

  const mockFetch: FetchLike = async (url) => {
    if (url.includes('/getMe')) {
      return new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('make.com')) {
      return new Response('Not found', { status: 404 });
    }
    return new Response(JSON.stringify({ message: 'Unknown Webhook' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const dispatcher = new NotificationDispatcher({
    ledger,
    getEnv: () => ({
      TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
      TELEGRAM_CHAT_ID: '-1002345678901',
      MAKE_WEBHOOK_URL: TEST_MAKE_URL,
      DISCORD_WEBHOOK_URL: TEST_DISCORD_URL,
    }),
    fetchFn: mockFetch,
  });

  const authCheck = await dispatcher.verifyTelegramBotAuth(true);
  assert.equal(authCheck.ok, false);
  assert.equal(authCheck.state, 'AUTH_FAILED');
  assert.equal(authCheck.httpStatus, 401);

  const outcome = await dispatcher.dispatchSignal({
    payload: makeSamplePayload({ signalId: 'sig_fail_404' }),
    approvedForPublicPublish: true,
  });

  assert.equal(outcome.webhookDispatched, false);
  assert.equal(outcome.webhookHttpStatus, 404);
  assert.equal(outcome.telegramAccepted, false);
  assert.equal(outcome.discordAccepted, false);
  assert.equal(outcome.telegramRecord?.state, 'FAILED');
  assert.match(outcome.telegramRecord?.sanitizedError || '', /404/);

  const overview = dispatcher.getHealthOverview();
  assert.equal(overview.telegram.state, 'AUTH_FAILED');
  assert.equal(overview.makeWebhook.state, 'WEBHOOK_UNREACHABLE');
  assert.equal(overview.discord.state, 'WEBHOOK_UNREACHABLE');
  assert.equal(overview.counters.providerAccepted, 0);
  assert.equal(overview.counters.deliveredWhenVerifiable, 0);
  assert.equal(overview.counters.failed, 2);

  ledger.close();
});

test('Retry worker preserves full TP1/TP2/TP3/SL/Entry payload across HTTP 429 Retry-After without zeroing fields', async () => {
  const dbPath = createTempLedgerPath('retry-preserve');
  const ledger = new PersistentNotificationLedger(dbPath);
  let attempt = 0;
  let capturedRetryBody: Record<string, unknown> | null = null;

  const mockFetch: FetchLike = async (_url, init) => {
    attempt += 1;
    if (attempt === 1) {
      return new Response(JSON.stringify({ message: 'rate limited', retry_after: 5 }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '5' },
      });
    }
    capturedRetryBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
    return new Response('Accepted', { status: 200 });
  };

  const dispatcher = new NotificationDispatcher({
    ledger,
    getEnv: () => ({
      TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
      TELEGRAM_CHAT_ID: '-1002345678901',
      MAKE_WEBHOOK_URL: TEST_MAKE_URL,
    }),
    fetchFn: mockFetch,
    initialPolicy: {
      telegramPrimaryTransport: 'MAKE_WEBHOOK',
      allowTelegramFallbackOnPrimaryFailure: false,
      discordEnabled: false,
    },
  });

  const startMs = Date.now();
  const initial = await dispatcher.dispatchSignal({
    payload: makeSamplePayload({ signalId: 'sig_retry_429' }),
    approvedForPublicPublish: true,
    nowMs: startMs,
  });

  assert.equal(initial.telegramRecord?.state, 'RETRYING');
  assert.equal(initial.telegramRecord?.providerHttpStatus, 429);
  assert.equal(initial.telegramRecord?.errorHistory.length, 1);

  // Advance clock past Retry-After window (6s later) and flush due retries
  const flushRes = await dispatcher.flushDueRetries(startMs + 6_500, 5);
  assert.equal(flushRes.processedCount, 1);
  assert.equal(flushRes.deliveredCount, 1);

  assert.ok(capturedRetryBody);
  const body = capturedRetryBody as Record<string, unknown>;
  assert.equal(body.entry_price, 92450);
  assert.equal(body.stop_loss, 90601);
  assert.deepEqual(body.take_profits, { tp1: 95500, tp2: 98800, tp3: 101695 });
  assert.equal(body.exit_price, 101695);
  assert.equal('bot_token' in body, false);

  // Confirm zero corrupted zero-price payloads ever pass validation
  const corruptCheck = validatePersistedSignalPayload({
    ...makeSamplePayload(),
    takeProfits: [0, 0, 0],
    stopLoss: 0,
  });
  assert.equal(corruptCheck.ok, false);

  ledger.close();
});

test('Suppressed signals record SUPPRESSED state without triggering any external HTTP calls', async () => {
  const dbPath = createTempLedgerPath('suppressed');
  const ledger = new PersistentNotificationLedger(dbPath);

  const dispatcher = new NotificationDispatcher({
    ledger,
    getEnv: () => ({
      TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
      TELEGRAM_CHAT_ID: '-1002345678901',
      MAKE_WEBHOOK_URL: TEST_MAKE_URL,
      DISCORD_WEBHOOK_URL: TEST_DISCORD_URL,
    }),
    fetchFn: async () => {
      throw new Error('Suppressed signal must never invoke external fetch');
    },
  });

  const outcome = await dispatcher.dispatchSignal({
    payload: makeSamplePayload({ signalId: 'sig_suppressed_001' }),
    approvedForPublicPublish: false,
    suppressionReason: 'Public Signal Validation Gate is locked.',
  });

  assert.equal(outcome.suppressed, true);
  assert.equal(outcome.telegramRecord?.state, 'SUPPRESSED');
  const counters = ledger.getCounters();
  assert.equal(counters.signalGenerated, 1);
  assert.equal(counters.signalApproved, 0);
  assert.equal(counters.dispatchAttempted, 0);
  assert.ok(counters.suppressed >= 1);

  // Confirm persisted SQLite DB file contains ZERO secrets
  ledger.close();
  const dbBytes = fs.readFileSync(dbPath, 'utf8');
  assert.equal(dbBytes.includes(TEST_BOT_TOKEN), false);
  assert.equal(dbBytes.includes(TEST_MAKE_URL), false);
  assert.equal(dbBytes.includes(TEST_DISCORD_URL), false);
});

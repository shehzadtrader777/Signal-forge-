import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LiveWsFeedController,
  MAX_CLOCK_SKEW_TOLERANCE_MS,
  MAX_SINGLE_TICK_JUMP_PCT,
  type MinimalWebSocketLike,
} from './wsDataEngine';
import { WsFrameBuffer } from './telemetrySync';
import { TRACKED_COINS } from './marketData';
import {
  MAX_WS_RECONNECT_ATTEMPTS,
  computeExponentialReconnectDelayMs,
  timingSafeEqualStr,
  validateLiveSwitchChallenge,
} from './monitorAgent';
import { validateSpotFeedAgainstCmc } from './spotCmcValidator';
import { buildDigestEmailBodyHtml, escapeHtml } from './emailDigest';
import {
  createInitialForgeCapitalHubState,
  engageImmutableFailSafe,
  recoverFromImmutableFailSafe,
} from './forgeCapitalHub';

class FakeWebSocket implements MinimalWebSocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  closed = false;

  constructor(public readonly url: string) {}

  close() {
    this.closed = true;
    this.readyState = 3;
  }
}

test('LiveWsFeedController detaches hung sockets, ignores stale instances, and enforces epoch-before-mutate', () => {
  const created: FakeWebSocket[] = [];
  const buffer = new WsFrameBuffer();
  const ctrl = new LiveWsFeedController({
    buffer,
    coins: TRACKED_COINS,
    driftThresholdPct: 0.5,
    flushIntervalMs: 1000,
    wsFactory: (url) => {
      const sock = new FakeWebSocket(url);
      created.push(sock);
      return sock;
    },
  });

  ctrl.start();
  assert.equal(created.length, 1);
  const firstSock = created[0];

  const epochBefore = ctrl.getTelemetrySnapshot().syncEpoch;
  const nextEpoch = ctrl.resetEpochAndReconnect();
  assert.equal(nextEpoch, epochBefore + 1);
  assert.equal(firstSock.closed, true);
  assert.equal(firstSock.onmessage, null);
  assert.equal(firstSock.onclose, null);

  // Late message delivered with old epoch must be dropped BEFORE mutating authoritative prices
  const btcRef = TRACKED_COINS.find((c) => c.symbol === 'BTCUSDT')!.referencePrice;
  const nowMs = Date.now();
  const stale = ctrl.ingestRawWsPayload(
    JSON.stringify({ data: { s: 'BTCUSDT', c: String(btcRef * 1.05), E: nowMs } }),
    nowMs,
    epochBefore
  );
  assert.equal(stale.acceptedCount, 0);
  assert.equal(stale.rejectedCount, 1);
  assert.notEqual(ctrl.getAuthoritativePrice('BTCUSDT'), btcRef * 1.05);

  // Valid tick in current epoch sets initial authoritative price & timestamp
  const firstValid = ctrl.ingestRawWsPayload(
    JSON.stringify({
      data: {
        s: 'BTCUSDT',
        c: String(btcRef * 1.01),
        E: nowMs,
      },
    }),
    nowMs,
    nextEpoch
  );
  assert.equal(firstValid.acceptedCount, 1);
  assert.equal(ctrl.getAuthoritativePrice('BTCUSDT'), btcRef * 1.01);

  // Out-of-order stale clock skew (> MAX_CLOCK_SKEW_TOLERANCE_MS older than last accepted tick) is rejected
  const staleClock = ctrl.ingestRawWsPayload(
    JSON.stringify({
      data: {
        s: 'BTCUSDT',
        c: String(btcRef * 1.015),
        E: nowMs - MAX_CLOCK_SKEW_TOLERANCE_MS - 2500,
      },
    }),
    nowMs + 100,
    nextEpoch
  );
  assert.equal(staleClock.acceptedCount, 0);
  assert.equal(staleClock.rejectedCount, 1);

  // Untracked symbol is ignored on single-ticker frames
  const untracked = ctrl.ingestRawWsPayload(
    JSON.stringify({ data: { s: 'MALICIOUSUSDT', c: '100', E: nowMs + 200 } }),
    nowMs + 200,
    nextEpoch
  );
  assert.equal(untracked.acceptedCount, 0);

  // Excessive single-tick jump (> MAX_SINGLE_TICK_JUMP_PCT) is quarantined
  const jumpTooBig = ctrl.ingestRawWsPayload(
    JSON.stringify({
      data: {
        s: 'BTCUSDT',
        c: String(btcRef * (1 + (MAX_SINGLE_TICK_JUMP_PCT + 5) / 100)),
        E: nowMs + 300,
      },
    }),
    nowMs + 300,
    nextEpoch
  );
  assert.equal(jumpTooBig.acceptedCount, 0);
  assert.equal(jumpTooBig.rejectedCount, 1);
  assert.equal(ctrl.getAuthoritativePrice('BTCUSDT'), btcRef * 1.01);

  ctrl.stop();
});

test('LiveWsFeedController trips circuit breaker after MAX_WS_RECONNECT_ATTEMPTS failures', () => {
  const created: FakeWebSocket[] = [];
  const originalSetTimeout = globalThis.setTimeout;
  const queuedTimers: Array<() => void> = [];
  (globalThis as any).setTimeout = (fn: () => void) => {
    queuedTimers.push(fn);
    return queuedTimers.length as any;
  };

  try {
    const buffer = new WsFrameBuffer();
    const ctrl = new LiveWsFeedController({
      buffer,
      coins: TRACKED_COINS,
      driftThresholdPct: 0.5,
      flushIntervalMs: 1000,
      wsFactory: (url) => {
        const sock = new FakeWebSocket(url);
        created.push(sock);
        return sock;
      },
    });
    ctrl.start();

    for (let i = 0; i <= MAX_WS_RECONNECT_ATTEMPTS + 2; i += 1) {
      const sock = created[created.length - 1];
      sock.onclose?.({});
      while (queuedTimers.length > 0) {
        const fn = queuedTimers.shift()!;
        fn();
      }
    }

    assert.equal(ctrl.getTelemetrySnapshot().circuitOpen, true);
    assert.ok(
      computeExponentialReconnectDelayMs(MAX_WS_RECONNECT_ATTEMPTS) <= 30_000,
      'exponential reconnect backoff must remain bounded'
    );
    ctrl.stop();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('timingSafeEqualStr and validateLiveSwitchChallenge enforce hardened OTP & phrase checks', () => {
  assert.equal(timingSafeEqualStr('123456', '123456'), true);
  assert.equal(timingSafeEqualStr('123456', '123457'), false);
  assert.equal(timingSafeEqualStr('short', 'longer'), false);

  const rejectedShort = validateLiveSwitchChallenge({
    securityAnswer: 'live?',
    otpInput: '654321',
    expectedOtp: '654321',
  });
  assert.equal(rejectedShort.valid, false);

  const rejectedWrongOtp = validateLiveSwitchChallenge({
    securityAnswer: 'Authorize live switch?',
    otpInput: '000000',
    expectedOtp: '654321',
  });
  assert.equal(rejectedWrongOtp.valid, false);

  const accepted = validateLiveSwitchChallenge({
    securityAnswer: 'Authorize live execution?',
    otpInput: '654321',
    expectedOtp: '654321',
  });
  assert.equal(accepted.valid, true);
});

test('validateSpotFeedAgainstCmc never self-validates when CMC source is unavailable', () => {
  const unavailable = validateSpotFeedAgainstCmc({
    symbol: 'BTCUSDT',
    spotPrice: 65000,
    cmcBaseline: {
      symbol: 'BTCUSDT',
      coinName: 'Bitcoin',
      cmcRank: 1,
      cmcPriceUsd: 0,
      marketCapUsd: 0,
      volume24hUsd: 0,
      dominancePct: 50,
      percentChange24h: 0,
      circulatingSupply: 0,
      updatedAt: new Date().toISOString(),
      source: 'unavailable',
    },
  });
  assert.equal(unavailable.baselineVerified, false);
});

test('emailDigest escapes unsafe HTML characters in dynamic signal fields', () => {
  assert.equal(
    escapeHtml('<script>"test"&\'x\'</script>'),
    '&lt;script&gt;&quot;test&quot;&amp;&#39;x&#39;&lt;/script&gt;'
  );

  const nowMs = Date.now();
  const html = buildDigestEmailBodyHtml({
    batch: [
      {
        id: 'sig_1',
        symbol: 'BTC<script>alert(1)</script>',
        direction: 'BUY',
        confidence: 91,
        entryPrice: 65000,
        stopLoss: 64000,
        trailingStopLoss: 64200,
        takeProfits: [66000, 68000, 70000],
        sourceModule: 'AI_ENGINE',
        reason: 'Breakout <img src=x onerror=alert(1)>',
        queuedAtMs: nowMs,
        queuedAtIso: new Date(nowMs).toISOString(),
      },
    ],
    trendingCoins: [
      {
        symbol: 'BTC<img onerror=alert(1)>',
        name: 'Bitcoin',
        price: 65000,
        change24h: 4.5,
        tag: '<script>tag</script>',
      },
    ],
    nextDigestIso: new Date(nowMs + 3_600_000).toISOString(),
  });

  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img onerror='));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;script&gt;tag&lt;/script&gt;'));
});

test('recoverFromImmutableFailSafe rejects legacy hardcoded string and enforces server-verified codes', () => {
  const base = createInitialForgeCapitalHubState({ initialEquityUsd: 25000 });
  const locked = engageImmutableFailSafe(base, 'Drawdown floor breached in test');

  const legacyAttempt = recoverFromImmutableFailSafe(locked, {
    confirmationCode: 'UNLOCK_FORGE_FAILSAFE',
    operatorReason: 'Trying legacy bypass code',
  });
  assert.equal(legacyAttempt.ok, false);

  const wrongCode = recoverFromImmutableFailSafe(locked, {
    confirmationCode: 'SF-WRONG001',
    expectedCode: 'SF-REAL1234',
    operatorReason: 'Verified operator audit reason',
  });
  assert.equal(wrongCode.ok, false);

  const validServerAuth = recoverFromImmutableFailSafe(locked, {
    confirmationCode: 'SF-REAL1234',
    operatorReason: 'Verified operator audit reason',
    serverAuthorized: true,
  });
  assert.equal(validServerAuth.ok, true);
  assert.equal(validServerAuth.nextState.failSafe.engaged, false);
});

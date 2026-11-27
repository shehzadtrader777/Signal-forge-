import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  SingletonSchedulerRegistry,
  TelegramNotificationGovernor,
  extractTelegram429RetryAfterSeconds,
} from './telegramNotificationGovernor';

describe('Phase A — Telegram Anti-Flood Governor & Deduplication Proof', () => {
  it('suppresses 100 consecutive OPTIMAL monitoring cycles with zero unsolicited alerts', () => {
    const gov = new TelegramNotificationGovernor();
    assert.equal(DEFAULT_NOTIFICATION_SETTINGS.routineAuditEnabled, false);
    assert.equal(DEFAULT_NOTIFICATION_SETTINGS.healthDigestCadence, '24h');

    let alertsTriggered = 0;
    let t = Date.parse('2026-11-23T12:00:00.000Z');
    for (let i = 0; i < 100; i++) {
      const cycle = gov.evaluateHealthCycle({ currentHealth: 'OPTIMAL', nowMs: t });
      if (cycle.shouldSendImmediateAlert) alertsTriggered += 1;
      t += 60_000; // 100 minutes of continuous healthy polling
    }

    assert.equal(alertsTriggered, 0);
    const snap = gov.getTelemetrySnapshot(t);
    assert.equal(snap.counters.suppressedRoutineAuditCount, 100);
    assert.equal(snap.counters.deliveredCount, 0);
  });

  it('sends immediate alerts on genuine OPTIMAL -> CRITICAL outage and CRITICAL -> OPTIMAL recovery, and deduplicates across restarts', () => {
    let persistedBlob: ReturnType<TelegramNotificationGovernor['exportPersistedState']> | null = null;
    const gov1 = new TelegramNotificationGovernor({
      onPersist: (s) => {
        persistedBlob = s;
      },
    });

    const t0 = Date.parse('2026-11-23T12:00:00.000Z');
    // Genuine outage transition
    const outageCycle = gov1.evaluateHealthCycle({ currentHealth: 'CRITICAL', nowMs: t0 });
    assert.equal(outageCycle.shouldSendImmediateAlert, true);
    assert.equal(outageCycle.category, 'CRITICAL_ALERT');

    const d1 = gov1.evaluateOutboundDispatch({
      category: 'CRITICAL_ALERT',
      targetStream: 'PERSONAL_ADMIN',
      eventKey: 'spot_ws_outage_20261123_1200',
      fingerprint: 'outage_fp_1',
      targetChatId: '111111',
      publicChannelChatId: '@SignalForge',
      nowMs: t0,
    });
    assert.equal(d1.allowed, true);
    gov1.recordDeliveryOutcome({
      deliveryId: d1.deliveryId,
      fingerprint: 'outage_fp_1',
      category: 'CRITICAL_ALERT',
      targetStream: 'PERSONAL_ADMIN',
      outcome: { ok: true, httpStatus: 200 },
      nowMs: t0,
    });

    // Simulate service restart rehydrating persisted state
    const govAfterRestart = new TelegramNotificationGovernor({ initialState: persistedBlob });
    const dupAfterRestart = govAfterRestart.evaluateOutboundDispatch({
      category: 'CRITICAL_ALERT',
      targetStream: 'PERSONAL_ADMIN',
      eventKey: 'spot_ws_outage_20261123_1200',
      fingerprint: 'outage_fp_1',
      targetChatId: '111111',
      publicChannelChatId: '@SignalForge',
      nowMs: t0 + 5_000,
    });
    assert.equal(dupAfterRestart.allowed, false);
    assert.equal(dupAfterRestart.reason, 'SUPPRESSED_DUPLICATE_DELIVERY_ID');

    // Genuine recovery transition CRITICAL -> OPTIMAL
    const recoveryCycle = govAfterRestart.evaluateHealthCycle({
      currentHealth: 'OPTIMAL',
      nowMs: t0 + 120_000,
    });
    assert.equal(recoveryCycle.shouldSendImmediateAlert, true);
    assert.equal(recoveryCycle.category, 'RECOVERY_EVENT');
  });

  it('prevents simultaneous workers from running the same scheduled task via durable lease', () => {
    const gov = new TelegramNotificationGovernor();
    const now = Date.parse('2026-11-23T12:00:00.000Z');

    const w1 = gov.tryAcquireSchedulerLease({
      taskName: 'health_digest_scheduler',
      workerId: 'worker-A',
      leaseTtlMs: 60_000,
      nowMs: now,
    });
    const w2 = gov.tryAcquireSchedulerLease({
      taskName: 'health_digest_scheduler',
      workerId: 'worker-B',
      leaseTtlMs: 60_000,
      nowMs: now + 1_000,
    });
    assert.equal(w1, true);
    assert.equal(w2, false);

    // After lease expires, worker-B can cleanly take over
    const w2AfterExpiry = gov.tryAcquireSchedulerLease({
      taskName: 'health_digest_scheduler',
      workerId: 'worker-B',
      leaseTtlMs: 60_000,
      nowMs: now + 65_000,
    });
    assert.equal(w2AfterExpiry, true);
  });

  it('honors Telegram HTTP 429 retry_after backoff, enforces stream isolation, and aggregates noncritical failures', () => {
    const retrySec = extractTelegram429RetryAfterSeconds(429, {
      ok: false,
      parameters: { retry_after: 42 },
      description: 'Too Many Requests: retry after 42',
    });
    assert.equal(retrySec, 42);

    const gov = new TelegramNotificationGovernor();
    const t0 = Date.parse('2026-11-23T12:00:00.000Z');

    // Stream isolation: personal admin alert must NEVER go to public channel ID
    const isolated = gov.evaluateOutboundDispatch({
      category: 'CRITICAL_ALERT',
      targetStream: 'PERSONAL_ADMIN',
      eventKey: 'iso_test',
      fingerprint: 'iso_fp',
      targetChatId: '@SignalForge',
      publicChannelChatId: '@SignalForge',
      nowMs: t0,
    });
    assert.equal(isolated.allowed, false);
    assert.equal(isolated.reason, 'BLOCKED_STREAM_ISOLATION_VIOLATION');

    // Record a 429 response
    gov.recordDeliveryOutcome({
      deliveryId: 'tg_429_test',
      fingerprint: 'fp_429',
      category: 'PUBLIC_SIGNAL_PUBLISH',
      targetStream: 'PUBLIC_CHANNEL',
      outcome: { ok: false, httpStatus: 429, retryAfterSeconds: 42, errorDetail: '429 Too Many Requests' },
      nowMs: t0,
    });

    const duringBackoff = gov.evaluateOutboundDispatch({
      category: 'PUBLIC_SIGNAL_PUBLISH',
      targetStream: 'PUBLIC_CHANNEL',
      eventKey: 'next_pub_signal',
      fingerprint: 'fp_next',
      targetChatId: '@SignalForge',
      publicChannelChatId: '@SignalForge',
      nowMs: t0 + 10_000,
    });
    assert.equal(duringBackoff.allowed, false);
    assert.equal(duringBackoff.reason, 'DEFERRED_TELEGRAM_429_BACKOFF');
    assert.equal(duringBackoff.retryAfterSec, 32);

    // Aggregate repeated noncritical failures cleanly
    gov.recordNonCriticalFailure('binance_depth_timeout', 'timeout 1', t0);
    const agg = gov.recordNonCriticalFailure('binance_depth_timeout', 'timeout 2', t0 + 5_000);
    assert.equal(agg.count, 2);
  });

  it('prevents duplicate interval timers via SingletonSchedulerRegistry', () => {
    const registry = new SingletonSchedulerRegistry();
    registry.register('audit_loop', 60_000, () => {});
    registry.register('audit_loop', 60_000, () => {});
    assert.deepEqual(registry.listActiveNames(), ['audit_loop']);
    registry.clearAll();
    assert.deepEqual(registry.listActiveNames(), []);
  });
});

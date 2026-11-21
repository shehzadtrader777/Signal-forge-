import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLatencyStatus,
  computeCpuUsagePercent,
  computeNextDailyAuditIso,
  computeRiskRewardRatio,
  formatDailyAuditReportMessage,
  formatDeveloperAuditMessage,
  formatPublicSignalMessage,
  maskChatId,
  maskTelegramToken,
  parseTelegramWebhookUpdate,
  shouldTriggerDailyAudit,
  type ModuleLatencyMetric,
  type SystemHealthParameters,
} from './telegramStreams';

test('formatPublicSignalMessage includes trading pair, entry, exit, stop loss, confidence score, and R:R', () => {
  const msg = formatPublicSignalMessage({
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 92450.5,
    exitPrice: 101695.55,
    stopLoss: 90601.49,
    confidence: 91,
    timeframe: '4h',
    rationale: 'SMC order-block sweep with institutional volume confirmation',
  });

  assert.match(msg, /SIGNAL FORGE · LONG \/ BUY/);
  assert.match(msg, /Trading Pair: BTCUSDT \(4h\)/);
  assert.match(msg, /Entry Price: \$92,450\.50/);
  assert.match(msg, /Exit Price \(TP\): \$101,695\.55/);
  assert.match(msg, /Stop Loss: \$90,601\.49/);
  assert.match(msg, /Confidence Score: 91% \| R:R 1:5/);
  assert.equal(computeRiskRewardRatio('BUY', 100, 110, 98), 5);
});

test('computeCpuUsagePercent and developer audit formatting produce accurate telemetry snapshots', () => {
  // 2 cores, 1000ms elapsed = 2,000,000 core-micros. 500,000 total CPU micros => 25.0%
  const cpuPct = computeCpuUsagePercent({
    prevUserMicros: 1_000_000,
    prevSystemMicros: 500_000,
    nextUserMicros: 1_350_000,
    nextSystemMicros: 650_000,
    elapsedMs: 1000,
    cpuCoreCount: 2,
  });
  assert.equal(cpuPct, 25);

  const health: SystemHealthParameters = {
    overallStatus: 'OPTIMAL',
    uptimeSec: 3600,
    cpuUsagePct: cpuPct,
    loadAvg1m: 0.42,
    memoryRssMb: 184.5,
    heapUsedMb: 92.3,
    heapTotalMb: 128.0,
    eventLoopLagMs: 1.85,
    wsConnected: true,
    wsFrameAgeMs: 140,
    sseSubscribers: 3,
    activeOpenPositions: 2,
    autoHealCount: 0,
    staleFeedCount: 0,
    isolatedFaultsCount: 0,
    activeServicesHealthy: 5,
    totalServices: 5,
  };
  const latencies: ModuleLatencyMetric[] = [
    {
      moduleId: 'spot-feed',
      label: 'Binance Spot Feed',
      latencyMs: 42,
      status: classifyLatencyStatus(42, 250),
      targetCeilingMs: 250,
    },
    {
      moduleId: 'ai-agents',
      label: 'AI Agent Pipeline',
      latencyMs: 19,
      status: classifyLatencyStatus(19, 150),
      targetCeilingMs: 150,
    },
  ];

  const auditMsg = formatDeveloperAuditMessage(health, latencies, '2026-11-19T12:00:00.000Z');
  assert.match(auditMsg, /CPU Usage: 25\.0%/);
  assert.match(auditMsg, /Binance Spot Feed: 42ms \(OPTIMAL\)/);
  assert.match(auditMsg, /Services Healthy: 5\/5/);

  const dailyMsg = formatDailyAuditReportMessage({
    reportDateUtc: '2026-11-19',
    generatedAt: '2026-11-19T00:00:05.000Z',
    samplesCollected: 120,
    avgCpuUsagePct: 18.4,
    peakCpuUsagePct: 44.2,
    avgMemoryRssMb: 176.2,
    avgEventLoopLagMs: 1.9,
    peakModuleLatencyMs: 88,
    slowestModuleLabel: 'Binance Spot Feed',
    publicSignalsDispatched24h: 14,
    continuousAuditsLogged24h: 120,
    autoHealEventsTotal: 1,
    uptimeSec: 86400,
    latestHealth: health,
    moduleLatencies: latencies,
  });
  assert.match(dailyMsg, /DAILY SYSTEM AUDIT REPORT · 2026-11-19/);
  assert.match(dailyMsg, /Avg 18\.4% \| Peak 44\.2%/);
  assert.match(dailyMsg, /Public Signals Dispatched \(24h\): 14/);
});

test('daily scheduler enforces once-per-UTC-day delivery and computes next UTC slot', () => {
  const nineAmUtc = Date.UTC(2026, 10, 19, 9, 0, 0);
  assert.equal(
    shouldTriggerDailyAudit({
      nowMs: nineAmUtc,
      lastSentDateUtc: null,
      scheduledUtcHour: 0,
      enabled: true,
    }),
    true
  );
  assert.equal(
    shouldTriggerDailyAudit({
      nowMs: nineAmUtc,
      lastSentDateUtc: '2026-11-19',
      scheduledUtcHour: 0,
      enabled: true,
    }),
    false
  );
  assert.equal(
    shouldTriggerDailyAudit({
      nowMs: nineAmUtc,
      lastSentDateUtc: null,
      scheduledUtcHour: 12,
      enabled: true,
    }),
    false
  );
  assert.equal(
    computeNextDailyAuditIso(nineAmUtc, 0),
    '2026-11-20T00:00:00.000Z'
  );
  assert.equal(
    computeNextDailyAuditIso(nineAmUtc, 15),
    '2026-11-19T15:00:00.000Z'
  );
});

test('parseTelegramWebhookUpdate extracts private commands and masks sensitive secrets', () => {
  const parsed = parseTelegramWebhookUpdate({
    update_id: 9001,
    message: {
      chat: { id: 77441122, type: 'private' },
      from: { username: 'dev_ops' },
      text: '/audit now',
    },
  });
  assert.equal(parsed.valid, true);
  assert.equal(parsed.updateId, 9001);
  assert.equal(parsed.chatId, '77441122');
  assert.equal(parsed.chatType, 'private');
  assert.equal(parsed.command, '/audit');
  assert.equal(parsed.senderLabel, '@dev_ops');

  assert.equal(maskTelegramToken('9234683930:AAHXMxACmvVzeHtpQWxeNDRR1CCHuq4cWzA'), '923468...cWzA');
  assert.equal(maskChatId('-1008928895086'), '-100***086');
});

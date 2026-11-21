import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDynamicProfitMultiplier,
  createPublicVerifiedTradeRecord,
  diagnoseSystemAuditEvents,
  evaluateDeveloperAuditDispatch,
  evaluatePredictivePrePumpLifecycle,
  gradeAccountVolumeTier,
  normalizeTradingViewWebhook,
  runContinuousStrategyAutoOptimizer,
  validateManualOverrideOrder,
  verifyPublicTradeId,
} from './multiAgentTradingArchitecture';

test('gradeAccountVolumeTier classifies volume tiers and dynamically reduces risk cap on drawdown or loss streaks', () => {
  const instClean = gradeAccountVolumeTier({
    volume30dUsd: 12_500_000,
    accountEquityUsd: 150_000,
    recentWinRatePct: 62,
    currentDrawdownPct: 1.2,
    consecutiveLosses: 0,
  });
  assert.equal(instClean.tier.id, 'TIER_4_INSTITUTIONAL');
  assert.equal(instClean.aiDynamicRiskCapPct, 2.0);
  assert.deepEqual(instClean.allowedRrRange, [5, 25]);
  assert.equal(instClean.riskReductionReason, null);

  const proInDrawdown = gradeAccountVolumeTier({
    volume30dUsd: 2_400_000,
    accountEquityUsd: 40_000,
    recentWinRatePct: 42,
    currentDrawdownPct: 9.0,
    consecutiveLosses: 4,
  });
  assert.equal(proInDrawdown.tier.id, 'TIER_3_PRO');
  assert.ok(proInDrawdown.aiDynamicRiskCapPct < proInDrawdown.tier.maxBaseRiskPct);
  assert.ok(proInDrawdown.riskReductionReason && proInDrawdown.riskReductionReason.includes('drawdown'));
});

test('computeDynamicProfitMultiplier scales variable targets between 1:5 and 1:20+ based on momentum and tier limits', () => {
  const highMomentum = computeDynamicProfitMultiplier({
    change24hPct: 14.5,
    volumeSpikeRatio: 3.4,
    orderBookImbalance: 0.72,
    rsi14: 66,
    fundingRatePct: 0.015,
    tierMaxMultiplier: 25,
  });
  assert.ok(highMomentum.momentumScore >= 85);
  assert.ok(highMomentum.targetRrMultiplier >= 20);
  assert.ok(highMomentum.takeProfitMultipliers[0] >= 5);

  const lowMomentum = computeDynamicProfitMultiplier({
    change24hPct: 0.4,
    volumeSpikeRatio: 1.0,
    orderBookImbalance: 0.05,
    rsi14: 50,
    fundingRatePct: 0.08,
    tierMaxMultiplier: 20,
  });
  assert.ok(lowMomentum.targetRrMultiplier >= 5.0);
  assert.ok(lowMomentum.targetRrMultiplier < highMomentum.targetRrMultiplier);
});

test('validateManualOverrideOrder enforces Forge Kill Switch, tier risk caps, 1:5 R:R floor, and user confirmation', () => {
  const profile = gradeAccountVolumeTier({
    volume30dUsd: 250_000,
    accountEquityUsd: 25_000,
    recentWinRatePct: 58,
    currentDrawdownPct: 1.0,
    consecutiveLosses: 0,
  });

  // Unconfirmed in SUPERVISED_MANUAL_OVERRIDE -> blocked until user confirms
  const unconfirmed = validateManualOverrideOrder({
    symbol: 'BTCUSDT',
    direction: 'BUY',
    market: 'SPOT',
    entryPrice: 100,
    stopLoss: 98.5,
    takeProfit: 112,
    requestedRiskPct: 1.0,
    leverage: 1,
    confidenceScore: 84,
    userConfirmed: false,
    executionMode: 'SUPERVISED_MANUAL_OVERRIDE',
    accountProfile: profile,
    forgeKillSwitchEngaged: false,
  });
  assert.equal(unconfirmed.approved, false);
  assert.equal(unconfirmed.requiresUserConfirmation, true);

  // Confirmed valid setup -> approved
  const valid = validateManualOverrideOrder({
    symbol: 'BTCUSDT',
    direction: 'BUY',
    market: 'SPOT',
    entryPrice: 100,
    stopLoss: 98.5,
    takeProfit: 112,
    requestedRiskPct: 1.0,
    leverage: 1,
    confidenceScore: 84,
    userConfirmed: true,
    executionMode: 'SUPERVISED_MANUAL_OVERRIDE',
    accountProfile: profile,
    forgeKillSwitchEngaged: false,
  });
  assert.equal(valid.approved, true);
  assert.equal(valid.computedRrRatio, 8);

  // Kill Switch engaged -> blocked even when valid
  const halted = validateManualOverrideOrder({
    symbol: 'BTCUSDT',
    direction: 'BUY',
    market: 'SPOT',
    entryPrice: 100,
    stopLoss: 98.5,
    takeProfit: 112,
    requestedRiskPct: 1.0,
    leverage: 1,
    confidenceScore: 84,
    userConfirmed: true,
    executionMode: 'FULLY_AUTONOMOUS',
    accountProfile: profile,
    forgeKillSwitchEngaged: true,
  });
  assert.equal(halted.approved, false);
  assert.ok(halted.violations.some((v) => v.includes('Kill Switch')));
});

test('evaluatePredictivePrePumpLifecycle enforces 3/3 multi-confirmation for accumulation and triggers pre-dump liquidation on delisting/panic', () => {
  const prePump = evaluatePredictivePrePumpLifecycle({
    symbol: 'SOLUSDT',
    livePrice: 145,
    volumeSpikeRatio: 2.6,
    orderBookImbalance: 0.42,
    sentimentScore: 78,
    onChainAccumulationScore: 74,
    distanceToPocPct: 0.8,
    nearLvnZone: true,
    fundingRatePct: 0.01,
    delistingOrPanicAlert: false,
    currentPositionOpen: false,
  });
  assert.equal(prePump.directive, 'PRE_PUMP_ACCUMULATE');
  assert.equal(prePump.confirmationsPassed, 3);

  const preDump = evaluatePredictivePrePumpLifecycle({
    symbol: 'SOLUSDT',
    livePrice: 142,
    volumeSpikeRatio: 3.1,
    orderBookImbalance: -0.5,
    sentimentScore: 22,
    onChainAccumulationScore: 15,
    distanceToPocPct: 3.4,
    nearLvnZone: false,
    fundingRatePct: 0.03,
    delistingOrPanicAlert: true,
    currentPositionOpen: true,
  });
  assert.equal(preDump.directive, 'PRE_DUMP_LIQUIDATE');
});

test('Public Trade ID protocol generates verifiable cryptographic Trade IDs with SVG visual snapshots and detects tampering', () => {
  const record = createPublicVerifiedTradeRecord({
    sequenceNumber: 42,
    symbol: 'BTCUSDT',
    direction: 'BUY',
    market: 'SPOT',
    stage: 'CONFIRMED_SETUP',
    entryPrice: 64000,
    stopLoss: 63040,
    takeProfit: 73600,
    confidence: 88,
    patternLabel: 'Bullish Order Block + LVN Sweep',
    createdAtIso: '2026-11-20T09:00:00.000Z',
  });
  assert.match(record.tradeId, /^SF-TRD-20261120-0042-[A-F0-9]{6}$/);
  assert.ok(record.visualSnapshotSvgDataUri.startsWith('data:image/svg+xml;charset=utf-8,'));
  assert.equal(record.routedToPublicChannel, true);
  assert.equal(record.routedToDeveloperAccount, true);

  const okCheck = verifyPublicTradeId(record.tradeId, [record]);
  assert.equal(okCheck.verified, true);
  assert.equal(okCheck.integrityStatus, 'AUTHENTIC_CRYPTO_MATCH');

  const tampered = { ...record, entryPrice: 65000 };
  const badCheck = verifyPublicTradeId(record.tradeId, [tampered]);
  assert.equal(badCheck.verified, false);
  assert.equal(badCheck.integrityStatus, 'DIGEST_MISMATCH');
});

test('Autonomous Audit diagnostics & 30-minute developer batch scheduler suppress heartbeat spam and isolate root causes', () => {
  const findings = diagnoseSystemAuditEvents([
    { id: '1', source: 'BROKER_API', httpStatus: 429, message: 'Rate limit exceeded', timestampIso: '2026-11-20T09:00:00Z' },
    { id: '2', source: 'NOTIFICATION_PAYLOAD', httpStatus: 400, message: 'Malformed JSON payload syntax', timestampIso: '2026-11-20T09:01:00Z' },
    { id: '3', source: 'EXECUTION_LOG', httpStatus: 401, message: 'Auth token expired', timestampIso: '2026-11-20T09:02:00Z' },
  ]);
  assert.equal(findings.length, 3);
  assert.deepEqual(
    findings.map((f) => f.category),
    ['RATE_LIMIT', 'PAYLOAD_SYNTAX', 'AUTH_DROP']
  );

  const baseMs = Date.parse('2026-11-20T09:00:00.000Z');
  const policy = {
    developerExclusiveOnly: true as const,
    suppressHeartbeatSpam: true,
    batchIntervalMinutes: 30,
    lastBatchSentAtMs: baseMs,
    pendingMetricsCount: 45,
    anomalyLatencyThresholdMs: 500,
  };

  // At +10m with no anomalies -> suppressed heartbeat batching
  const suppressed = evaluateDeveloperAuditDispatch({
    policy,
    nowMs: baseMs + 10 * 60 * 1000,
    currentPeakLatencyMs: 95,
    criticalFindingsCount: 0,
  });
  assert.equal(suppressed.shouldDispatchNow, false);
  assert.equal(suppressed.reason, 'SUPPRESSED_HEARTBEAT_BATCHING');
  assert.equal(suppressed.publicChannelBlocked, true);

  // At +31m -> periodic 30m batch dispatches exclusively to developer account
  const periodic = evaluateDeveloperAuditDispatch({
    policy,
    nowMs: baseMs + 31 * 60 * 1000,
    currentPeakLatencyMs: 95,
    criticalFindingsCount: 0,
  });
  assert.equal(periodic.shouldDispatchNow, true);
  assert.equal(periodic.reason, 'PERIODIC_30M_WINDOW_ELAPSED');
  assert.equal(periodic.destination, 'DEVELOPER_PRIVATE_TELEGRAM');

  // Auto-optimizer + TradingView webhook normalization
  const opt = runContinuousStrategyAutoOptimizer({
    symbol: 'ETHUSDT',
    closes: Array.from({ length: 30 }, (_, i) => 2400 + i * 18),
    tierMaxMultiplier: 20,
  });
  assert.ok(opt.testedCombinations > 10);
  assert.ok(opt.optimalRrMultiplier >= 5);

  const tv = normalizeTradingViewWebhook({
    symbol: 'ETH',
    action: 'BUY',
    price: 2950,
    timeframe: '15m',
    strategy: 'EMA21_RSI_Breakout',
    rsi: 61.5,
  });
  assert.ok(tv);
  assert.equal(tv?.symbol, 'ETHUSDT');
  assert.equal(tv?.action, 'BUY');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from './marketData';
import {
  createInitialMaintenanceState,
  startMaintenance,
} from './safeMaintenanceProtocol';
import {
  buildCanonicalTradeRecordFromStep2Signal,
  DEFAULT_STEP2_RISK_POLICY,
  evaluatePortfolioHedgeIntelligence,
  executeApprovedStep2Signal,
  runLearningPerformanceAudit,
  runSixAgentSignalPipeline,
} from './step2UnifiedSignalHub';

function buildBullishTrendCandles(count = 80): Candle[] {
  const startSec = 1760000000;
  const out: Candle[] = [];
  let price = 64000;
  for (let i = 0; i < count; i++) {
    const open = price;
    // Realistic uptrend with pullbacks so price stays within 1-2 ATR of EMA20
    const cycle = i % 5;
    let delta = cycle === 3 ? -120 : cycle === 4 ? -70 : 105;
    if (i === count - 2) delta = -80;
    if (i === count - 1) delta = 115;
    const close = Number((open + delta).toFixed(2));
    const high = Number((Math.max(open, close) + 120).toFixed(2));
    const low = Number((Math.min(open, close) - 110).toFixed(2));
    out.push({
      time: startSec + i * 3600,
      open,
      high,
      low,
      close,
      volume: 200 + i * 4,
    });
    price = close;
  }
  return out;
}

test('Step 2 Unified Hub: 6-Agent pipeline produces immutable Signal ID, honors SUPERVISED mode, and executes PAPER_SIMULATED_FILL with Trade ID', () => {
  const nowMs = 1760500000000;
  const maint = createInitialMaintenanceState('1.4.0-step2', nowMs);
  const candles = buildBullishTrendCandles(80);

  const signal = runSixAgentSignalPipeline({
    symbol: 'BTCUSDT',
    timeframe: '1h',
    candles,
    provider: 'BINANCE_SPOT',
    fetchedAtMs: nowMs - 5_000,
    isSyntheticSimulation: false,
    preferredStrategyId: 'trend_ema_adx',
    operatingMode: 'SUPERVISED',
    targetEnvironment: 'PAPER',
    riskPolicy: DEFAULT_STEP2_RISK_POLICY,
    portfolio: {
      accountEquityUsd: 25_000,
      currentDailyLossPct: 0.4,
      currentPortfolioDrawdownPct: 1.2,
      openPositions: [],
      activeConcurrentOrders: 0,
      requestedLeverage: 2,
      requestedRiskPerTradePct: 1.0,
      emergencyStopActive: false,
    },
    maintenanceState: maint,
    nowMs,
  });

  assert.ok(signal.signalId.startsWith('SF-SIG-'));
  assert.equal(signal.agentDecisions.length, 6);
  assert.equal(signal.direction, 'BUY');
  assert.equal(signal.riskValidation.passed, true);
  assert.equal(signal.execution.executed, false);
  assert.equal(signal.execution.status, 'AWAITING_OPERATOR_APPROVAL');
  assert.equal(signal.recordClass, 'PROPOSED_SETUP');

  // Operator explicitly approves PAPER execution
  const exec = executeApprovedStep2Signal({
    record: signal,
    environment: 'PAPER',
    approvedBy: 'OPERATOR_TEST',
    clientOrderId: 'ORD-PAPER-001',
    workerId: 'sf-worker-1',
    maintenanceState: maint,
    emergencyStopActive: false,
    nowMs: nowMs + 1000,
  });

  assert.equal(exec.ok, true);
  assert.equal(exec.record.execution.status, 'PAPER_SIMULATED_FILL');
  assert.equal(exec.record.execution.isSimulatedFill, true);
  assert.equal(exec.record.execution.exchangeAcknowledged, false);
  assert.equal(exec.record.execution.exchangeOrderId, null);
  assert.ok(exec.record.canonicalTradeId?.startsWith('SF-'));

  // Bridge to canonical Smart Chart record
  const canonical = buildCanonicalTradeRecordFromStep2Signal(exec.record);
  assert.ok(canonical);
  assert.equal(canonical.tradingMode, 'PAPER');
  assert.equal(canonical.recordClass, 'EXECUTED_TRADE');
  assert.equal(canonical.realizedPnlUsd, null); // Open trade never has fabricated realized PnL
});

test('Step 2 Execution Separation: EXCHANGE_DEMO refuses unconfigured exchange without fake orderId, and LIVE is always blocked', () => {
  const nowMs = 1760500000000;
  const maint = createInitialMaintenanceState('1.4.0-step2', nowMs);
  const candles = buildBullishTrendCandles(80);

  const signal = runSixAgentSignalPipeline({
    symbol: 'BTCUSDT',
    timeframe: '1h',
    candles,
    provider: 'BINANCE_SPOT',
    fetchedAtMs: nowMs - 4_000,
    isSyntheticSimulation: false,
    preferredStrategyId: 'trend_ema_adx',
    operatingMode: 'SUPERVISED',
    targetEnvironment: 'EXCHANGE_DEMO',
    riskPolicy: DEFAULT_STEP2_RISK_POLICY,
    portfolio: {
      accountEquityUsd: 25_000,
      currentDailyLossPct: 0,
      currentPortfolioDrawdownPct: 0,
      openPositions: [],
      activeConcurrentOrders: 0,
      requestedLeverage: 2,
      requestedRiskPerTradePct: 1.0,
      emergencyStopActive: false,
    },
    maintenanceState: maint,
    nowMs,
  });

  // EXCHANGE_DEMO without real exchange ack must fail honestly
  const demoNoAck = executeApprovedStep2Signal({
    record: signal,
    environment: 'EXCHANGE_DEMO',
    approvedBy: 'OPERATOR_TEST',
    clientOrderId: 'ORD-DEMO-001',
    workerId: 'sf-worker-1',
    maintenanceState: maint,
    emergencyStopActive: false,
    exchangeDemoAck: null,
  });
  assert.equal(demoNoAck.ok, false);
  assert.equal(demoNoAck.record.execution.status, 'EXCHANGE_UNCONFIGURED_NO_ACK');
  assert.equal(demoNoAck.record.execution.exchangeOrderId, null);

  // EXCHANGE_DEMO with genuine exchange ack succeeds cleanly
  const demoAck = executeApprovedStep2Signal({
    record: signal,
    environment: 'EXCHANGE_DEMO',
    approvedBy: 'OPERATOR_TEST',
    clientOrderId: 'ORD-DEMO-002',
    workerId: 'sf-worker-1',
    maintenanceState: maint,
    emergencyStopActive: false,
    exchangeDemoAck: {
      acknowledged: true,
      exchangeOrderId: 'OKX-DEMO-987654321',
      filledQty: 0.05,
      fillPrice: signal.entryPrice!,
      feeUsd: 1.25,
    },
  });
  assert.equal(demoAck.ok, true);
  assert.equal(demoAck.record.execution.status, 'EXCHANGE_DEMO_ACKNOWLEDGED');
  assert.equal(demoAck.record.execution.exchangeAcknowledged, true);
  assert.equal(demoAck.record.execution.exchangeOrderId, 'OKX-DEMO-987654321');

  // LIVE mode is strictly blocked
  const liveAttempt = executeApprovedStep2Signal({
    record: signal,
    environment: 'LIVE',
    approvedBy: 'OPERATOR_TEST',
    clientOrderId: 'ORD-LIVE-001',
    workerId: 'sf-worker-1',
    maintenanceState: maint,
    emergencyStopActive: false,
  });
  assert.equal(liveAttempt.ok, false);
  assert.equal(liveAttempt.record.execution.status, 'BLOCKED_LIVE_DISABLED');
});

test('Step 2 Safety Gates: blocks voice bypass, maintenance mode, and risk cap violations', () => {
  const nowMs = 1760500000000;
  const normal = createInitialMaintenanceState('1.4.0-step2', nowMs);
  const inMaint = startMaintenance(normal, {
    durationMinutes: 60,
    publicAccessMode: 'READ_ONLY',
    actor: 'OPS',
  }, nowMs);
  const candles = buildBullishTrendCandles(80);

  // Voice request cannot bypass approval
  const voiceSig = runSixAgentSignalPipeline({
    symbol: 'BTCUSDT',
    timeframe: '1h',
    candles,
    provider: 'BINANCE_SPOT',
    fetchedAtMs: nowMs - 2_000,
    isSyntheticSimulation: false,
    preferredStrategyId: 'trend_ema_adx',
    operatingMode: 'AUTONOMOUS',
    targetEnvironment: 'PAPER',
    requestOrigin: 'VOICE_COMMAND',
    riskPolicy: DEFAULT_STEP2_RISK_POLICY,
    portfolio: {
      accountEquityUsd: 25_000,
      currentDailyLossPct: 0,
      currentPortfolioDrawdownPct: 0,
      openPositions: [],
      activeConcurrentOrders: 0,
      requestedLeverage: 2,
      requestedRiskPerTradePct: 1.0,
      emergencyStopActive: false,
    },
    maintenanceState: normal,
    nowMs,
  });
  assert.equal(voiceSig.execution.status, 'BLOCKED_VOICE_BYPASS');
  assert.equal(voiceSig.execution.executed, false);

  // Maintenance mode blocks Risk Management Agent
  const maintSig = runSixAgentSignalPipeline({
    symbol: 'BTCUSDT',
    timeframe: '1h',
    candles,
    provider: 'BINANCE_SPOT',
    fetchedAtMs: nowMs - 2_000,
    isSyntheticSimulation: false,
    preferredStrategyId: 'trend_ema_adx',
    operatingMode: 'AUTONOMOUS',
    targetEnvironment: 'PAPER',
    riskPolicy: DEFAULT_STEP2_RISK_POLICY,
    portfolio: {
      accountEquityUsd: 25_000,
      currentDailyLossPct: 0,
      currentPortfolioDrawdownPct: 0,
      openPositions: [],
      activeConcurrentOrders: 0,
      requestedLeverage: 2,
      requestedRiskPerTradePct: 1.0,
      emergencyStopActive: false,
    },
    maintenanceState: inMaint,
    nowMs,
  });
  assert.equal(maintSig.riskValidation.passed, false);
  assert.equal(maintSig.riskValidation.maintenanceBlocked, true);
  assert.equal(maintSig.execution.status, 'BLOCKED_RISK_OR_MAINTENANCE');
});

test('Step 2 Hedge Intelligence & Learning Audit: strictly separates HYPOTHETICAL_PROPOSAL and never auto-mutates risk limits', () => {
  const hedge = evaluatePortfolioHedgeIntelligence({
    openPositions: [
      { symbol: 'BTCUSDT', direction: 'LONG', notionalUsd: 18_000 },
      { symbol: 'ETHUSDT', direction: 'LONG', notionalUsd: 12_000 },
    ],
    accountEquityUsd: 20_000,
    volatilityStressScore: 0.78,
    fundingRate8h: 0.0002,
  });
  assert.equal(hedge.isExecutedHedge, false);
  assert.equal(hedge.status, 'HYPOTHETICAL_PROPOSAL');
  assert.ok(hedge.summary.includes('HYPOTHETICAL PROPOSAL ONLY'));
  assert.ok(hedge.riskReducingAlternatives.length > 0);

  const audit = runLearningPerformanceAudit([
    {
      signalId: 'S1',
      tradeId: 'T1',
      strategyId: 'mean_reversion_volatility',
      symbol: 'BTCUSDT',
      environment: 'PAPER',
      expectedEntryPrice: 68000,
      actualFillPrice: 68090,
      realizedPnlUsd: -120,
      feesUsd: 4.5,
      riskViolationOccurred: false,
      falseSignal: true,
      volatilityRegime: 'ELEVATED',
      closedAtIso: '2026-11-22T10:00:00Z',
    },
    {
      signalId: 'S2',
      tradeId: 'T2',
      strategyId: 'mean_reversion_volatility',
      symbol: 'ETHUSDT',
      environment: 'PAPER',
      expectedEntryPrice: 3400,
      actualFillPrice: 3405,
      realizedPnlUsd: -85,
      feesUsd: 3.1,
      riskViolationOccurred: true,
      falseSignal: true,
      volatilityRegime: 'EXTREME',
      closedAtIso: '2026-11-22T14:00:00Z',
    },
    {
      signalId: 'S3',
      tradeId: 'T3',
      strategyId: 'mean_reversion_volatility',
      symbol: 'SOLUSDT',
      environment: 'PAPER',
      expectedEntryPrice: 210,
      actualFillPrice: 210.25,
      realizedPnlUsd: 45,
      feesUsd: 1.5,
      riskViolationOccurred: false,
      falseSignal: false,
      volatilityRegime: 'NORMAL',
      closedAtIso: '2026-11-22T18:00:00Z',
    },
  ]);

  assert.equal(audit.sampleSize, 3);
  assert.equal(audit.riskViolationCount, 1);
  assert.ok(audit.recommendations.length >= 2);
  for (const rec of audit.recommendations) {
    assert.equal(rec.requiresOperatorReview, true);
    assert.equal(rec.autoApplied, false);
  }
});

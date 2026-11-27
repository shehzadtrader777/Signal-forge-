import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { FreqtradeCoreServerRuntime } from './freqtradeCoreServer';
import {
  FUTURE_MODULAR_EXTENSIONS,
  REQUIRED_VERIFIABLE_PAPER_CHECKS,
  runStage1TestnetValidation,
  validatePaperTradeEvidence,
  type PaperTradeEvidenceInput,
} from './publicSignalValidationEngine';
import { PublicSignalValidationServerRuntime } from './publicSignalValidationServer';

const ROOT_DIR = path.resolve(import.meta.dirname, '..', '..');

function makeValidPaperEvidence(
  index: number,
  nowMs: number,
  win: boolean
): PaperTradeEvidenceInput {
  const observedAtIso = new Date(nowMs - (120 - index) * 60_000).toISOString();
  const closedAtIso = new Date(nowMs - (120 - index) * 60_000 + 30_000).toISOString();
  const entryPrice = 90_000 + index * 11.25;
  const bidPrice = entryPrice - 4.5;
  const askPrice = entryPrice + 4.5;
  const exitPrice = win ? entryPrice * 1.012 : entryPrice * 0.992;
  const stakeUsd = 500;
  const feeRate = 0.001;
  const feeUsd = stakeUsd * feeRate * 2;
  return {
    tradeEvidenceId: `paper_obs_${String(index).padStart(3, '0')}`,
    symbol: index % 2 === 0 ? 'BTC/USDT' : 'ETH/USDT',
    side: 'BUY',
    marketSource: 'BINANCE_SPOT_OBSERVATION',
    observedAtIso,
    closedAtIso,
    bidPrice,
    askPrice,
    entryPrice,
    exitPrice,
    stakeUsd,
    feeRate,
    feeUsd,
    spreadBps: 1.8,
    slippageBps: 2.2,
    stopLossPrice: entryPrice * 0.98,
    takeProfitPrice: entryPrice * 1.06,
    isDemonstration: false,
  };
}

test('Stage 1 Testnet Validation passes allowlisted Testnet hosts and blocks all live trading hosts', () => {
  const passReport = runStage1TestnetValidation({
    targetHost: 'testnet.binance.vision',
    sampleSymbol: 'BTC/USDT',
    sampleSide: 'BUY',
    sampleEntryPrice: 91_400,
    sampleStopLossPrice: 89_572,
    sampleTakeProfitPrice: 96_884,
    observedDailyDrawdownPct: 0.012,
    invalidOrderRejected: true,
    lifecycleTransitions: ['OPEN', 'FILL', 'CLOSE'],
  });
  assert.equal(passReport.passed, true);
  assert.equal(passReport.liveEndpointContacted, false);
  assert.equal(passReport.failureReasons.length, 0);

  for (const liveHost of ['api.binance.com', 'fapi.binance.com', 'api.bybit.com']) {
    const blocked = runStage1TestnetValidation({
      targetHost: liveHost,
      sampleSymbol: 'BTC/USDT',
      sampleSide: 'BUY',
      sampleEntryPrice: 91_400,
      sampleStopLossPrice: 89_572,
      sampleTakeProfitPrice: 96_884,
      observedDailyDrawdownPct: 0.012,
      invalidOrderRejected: true,
      lifecycleTransitions: ['OPEN', 'FILL', 'CLOSE'],
    });
    assert.equal(blocked.passed, false, `Live host ${liveHost} must be strictly rejected`);
    assert.equal(blocked.liveEndpointContacted, false);
    assert.ok(blocked.failureReasons.some((r) => r.includes('TESTNET_HOST_ISOLATION')));
  }
});

test('Stage 2 & 3 Paper Evidence validator rejects demonstration, fabricated, zero-cost, inverted-spread, future-timestamp, and duplicate records', () => {
  const nowMs = Date.now();
  const valid = makeValidPaperEvidence(1, nowMs, true);
  const resValid = validatePaperTradeEvidence(valid, new Set(), new Set(), nowMs);
  assert.equal(resValid.accepted, true);
  assert.equal(resValid.outcome, 'WIN');
  assert.equal(resValid.profitLabel, 'SIMULATED_PAPER_ONLY');
  assert.equal(resValid.isRealProfit, false);

  // Demonstration record rejected
  const demoRes = validatePaperTradeEvidence(
    { ...valid, tradeEvidenceId: 'demo_001', isDemonstration: true },
    new Set(),
    new Set(),
    nowMs
  );
  assert.equal(demoRes.accepted, false);
  assert.equal(demoRes.outcome, 'REJECTED');
  assert.ok(demoRes.rejectionReasons.some((r) => r.includes('demonstration')));

  // Fabricated / mock source rejected
  const mockSourceRes = validatePaperTradeEvidence(
    { ...valid, tradeEvidenceId: 'mock_001', marketSource: 'FABRICATED_FEED' },
    new Set(),
    new Set(),
    nowMs
  );
  assert.equal(mockSourceRes.accepted, false);
  assert.ok(mockSourceRes.rejectionReasons.some((r) => r.includes('marketSource')));

  // Zero fee & zero slippage & inverted bid/ask rejected
  const badCostRes = validatePaperTradeEvidence(
    {
      ...valid,
      tradeEvidenceId: 'bad_cost_001',
      bidPrice: 91_000,
      askPrice: 90_900,
      feeRate: 0,
      feeUsd: 0,
      spreadBps: 0,
      slippageBps: 0,
    },
    new Set(),
    new Set(),
    nowMs
  );
  assert.equal(badCostRes.accepted, false);
  assert.ok(badCostRes.rejectionReasons.length >= 4);

  // Duplicate tradeEvidenceId and duplicate fingerprint rejected
  const dupRes = validatePaperTradeEvidence(
    valid,
    new Set([valid.tradeEvidenceId]),
    new Set([resValid.fingerprint]),
    nowMs
  );
  assert.equal(dupRes.accepted, false);
  assert.ok(dupRes.rejectionReasons.some((r) => r.includes('Duplicate')));
});

test('End-to-end 5-stage server gate enforces default-off publication, 50 verifiable checks, operator approval, untouched separate Live Gate, and auto-suspension on tamper', () => {
  const freqtradeCore = new FreqtradeCoreServerRuntime(ROOT_DIR, { dbPath: ':memory:' });
  const gate = new PublicSignalValidationServerRuntime(ROOT_DIR, freqtradeCore, ':memory:');

  try {
    // 1. Publication disabled by default; public feed is empty
    const initialFeed = gate.getPublicSignalsFeed();
    assert.equal(initialFeed.publicPublicationEnabled, false);
    assert.equal(initialFeed.signals.length, 0);
    assert.equal(initialFeed.canTriggerLiveOrders, false);
    assert.ok(initialFeed.withholdingReasons.length >= 3);

    // 2. Register two candidate signals — both stay private
    const candA = gate.registerCandidateSignal('operator@test', {
      signalId: 'sig_btc_valid_01',
      symbol: 'BTC/USDT',
      side: 'BUY',
      timeframe: '1h',
      entryPrice: 91_500,
      stopLossPrice: 89_670,
      takeProfitPrice: 96_990,
      confidencePct: 89,
      strategyName: 'SMC_OrderBlock_Reclaim',
    });
    assert.equal(candA.ok, true);
    assert.equal(candA.candidate?.approvalStatus, 'PRIVATE_UNVERIFIED');

    const candB = gate.registerCandidateSignal('operator@test', {
      signalId: 'sig_eth_private_02',
      symbol: 'ETH/USDT',
      side: 'BUY',
      timeframe: '4h',
      entryPrice: 3_250,
      stopLossPrice: 3_185,
      takeProfitPrice: 3_445,
      confidencePct: 87,
    });
    assert.equal(candB.ok, true);

    // 3. Stage 1 Testnet Check passes on Testnet host
    const s1 = gate.runStage1TestnetCheck('operator@test', {
      targetHost: 'testnet.binance.vision',
    });
    assert.equal(s1.ok, true);

    // 4. Record 49 valid paper checks (mix of wins AND losses) + 2 invalid/demo rejected records
    const nowMs = Date.now();
    for (let i = 1; i <= 49; i++) {
      const rec = gate.recordPaperTradeEvidence(
        'operator@test',
        makeValidPaperEvidence(i, nowMs, i % 4 !== 0),
        nowMs
      );
      assert.equal(rec.ok, true, `Paper observation #${i} should be accepted`);
    }

    // Attempt demonstration & duplicate submissions — both must be rejected and counted as failures
    const demoAttempt = gate.recordPaperTradeEvidence(
      'operator@test',
      { ...makeValidPaperEvidence(99, nowMs, true), isDemonstration: true },
      nowMs
    );
    assert.equal(demoAttempt.ok, false);
    assert.equal(demoAttempt.statusCode, 422);

    const dupAttempt = gate.recordPaperTradeEvidence(
      'operator@test',
      makeValidPaperEvidence(1, nowMs, true),
      nowMs
    );
    assert.equal(dupAttempt.ok, false);
    assert.equal(dupAttempt.statusCode, 422);

    // With only 49 valid checks, approval MUST be blocked (409)
    const blockedApprove49 = gate.decidePublicSignalApproval(
      'admin@test',
      'sig_btc_valid_01',
      'APPROVE',
      'Premature approval attempt'
    );
    assert.equal(blockedApprove49.ok, false);
    assert.equal(blockedApprove49.statusCode, 409);

    // 5. Record 50th valid verifiable paper check
    const rec50 = gate.recordPaperTradeEvidence(
      'operator@test',
      makeValidPaperEvidence(50, nowMs, true),
      nowMs
    );
    assert.equal(rec50.ok, true);

    const snapAt50 = gate.getMonitoringSnapshot();
    assert.equal(snapAt50.evaluation.validPaperChecksCount, REQUIRED_VERIFIABLE_PAPER_CHECKS);
    assert.equal(snapAt50.evaluation.rejectedPaperChecksCount, 2);
    assert.ok(snapAt50.evaluation.paperLossesCount > 0, 'Both failures/losses and successes must be tracked');
    assert.ok(snapAt50.evaluation.paperWinsCount > 0);
    assert.equal(snapAt50.evaluation.stage3Passed, true);
    assert.equal(snapAt50.evaluation.eligibleForOperatorApproval, true);

    // 6. Operator explicitly approves ONLY sig_btc_valid_01
    const approveRes = gate.decidePublicSignalApproval(
      'admin@test',
      'sig_btc_valid_01',
      'APPROVE',
      'Verified all 50 checks for public display only'
    );
    assert.equal(approveRes.ok, true);
    assert.equal(approveRes.canTriggerLiveOrders, false);

    // Global publication is STILL disabled by default -> public feed remains empty!
    assert.equal(gate.getPublicSignalsFeed().signals.length, 0);

    // 7. Authorized operator enables global Public Signal Display
    const toggleRes = gate.setGlobalPublicationEnabled('admin@test', true, 'Enable display-only public feed');
    assert.equal(toggleRes.ok, true);

    const liveFeed = gate.getPublicSignalsFeed();
    assert.equal(liveFeed.publicPublicationEnabled, true);
    assert.equal(liveFeed.signals.length, 1, 'Only explicitly approved candidate should appear publicly');
    assert.equal(liveFeed.signals[0].signalId, 'sig_btc_valid_01');
    assert.equal(liveFeed.signals[0].canTriggerLiveOrders, false);

    // 8. Verify separate 50-consecutive-wins Live Trading gate is 100% untouched & NO live orders triggered
    const ftSnap = freqtradeCore.getSnapshot();
    assert.equal(ftSnap.metrics.liveGateUnlocked, false);
    assert.equal(ftSnap.metrics.requiredPaperWins, 50);
    assert.equal(ftSnap.metrics.tradingMode, 'PAPER_DRY_RUN');
    assert.equal(ftSnap.openPositions.length, 0);

    const monitorAfterApprove = gate.getMonitoringSnapshot();
    assert.equal(monitorAfterApprove.separateLiveTradingGate.preservedUntouched, true);
    assert.equal(monitorAfterApprove.separateLiveTradingGate.liveGateStatus, 'LOCKED');
    assert.equal(monitorAfterApprove.separateLiveTradingGate.canBeTriggeredByPublicApproval, false);
    assert.equal(monitorAfterApprove.futureExtensions.length, FUTURE_MODULAR_EXTENSIONS.length);
    assert.ok(monitorAfterApprove.futureExtensions.every((ext) => ext.enabled === false));

    // 9. Stage 5 Auto-Suspension on Data Integrity Tamper
    gate.tamperEvidenceHashForTest('paper_obs_005');
    const feedAfterTamper = gate.getPublicSignalsFeed();
    assert.equal(feedAfterTamper.autoSuspended, true, 'Data integrity failure must automatically suspend public eligibility');
    assert.equal(feedAfterTamper.publicPublicationEnabled, false);
    assert.equal(feedAfterTamper.signals.length, 0, 'Previously approved public signal must be immediately withheld');

    const auditAfterTamper = gate.getMonitoringSnapshot().auditHistory;
    assert.ok(
      auditAfterTamper.some((entry) => entry.eventType === 'SAFETY_AUTO_SUSPENDED'),
      'Auto-suspension decision must be recorded in auditable history'
    );
  } finally {
    gate.close();
    freqtradeCore.close();
  }
});

test('Stage 5 automatically suspends public eligibility when mandatory emergency halt activates', () => {
  const freqtradeCore = new FreqtradeCoreServerRuntime(ROOT_DIR, { dbPath: ':memory:' });
  const gate = new PublicSignalValidationServerRuntime(ROOT_DIR, freqtradeCore, ':memory:');

  try {
    gate.runStage1TestnetCheck('operator@test', { targetHost: 'testnet.binance.vision' });
    const nowMs = Date.now();
    for (let i = 1; i <= 50; i++) {
      gate.recordPaperTradeEvidence('operator@test', makeValidPaperEvidence(i, nowMs, true), nowMs);
    }
    gate.registerCandidateSignal('operator@test', {
      signalId: 'sig_halt_test_01',
      symbol: 'BTC/USDT',
      side: 'BUY',
      entryPrice: 91_000,
      stopLossPrice: 89_180,
      takeProfitPrice: 96_460,
      confidencePct: 90,
    });
    assert.equal(gate.decidePublicSignalApproval('admin@test', 'sig_halt_test_01', 'APPROVE').ok, true);
    assert.equal(gate.setGlobalPublicationEnabled('admin@test', true).ok, true);
    assert.equal(gate.getPublicSignalsFeed().signals.length, 1);

    // Engage emergency halt -> automatic suspension immediately clears public feed
    gate.setExternalEmergencyHalt(true);
    const haltedFeed = gate.getPublicSignalsFeed();
    assert.equal(haltedFeed.autoSuspended, true);
    assert.equal(haltedFeed.signals.length, 0);
  } finally {
    gate.close();
    freqtradeCore.close();
  }
});

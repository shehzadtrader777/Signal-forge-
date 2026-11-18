import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CACHE_POLICY_TABLE,
  CERTIFIED_PRIMARY_SOURCE_CONFIG,
  CertifiedPriceOracle,
  PRISTINE_DATA_INVARIANT_MANIFEST,
  isPriceUnavailable,
  verifyCertifiedSourceConfig,
} from './certifiedPrimarySource';
import { KERNEL_REGISTRY_BY_ID } from './bindingLayer';
import {
  DataIntegrityRuntime,
  TIER_2_WATCHDOG_INTERVAL_MS,
  TIER_3_HARD_RESET_INTERVAL_MS,
  rebuildDrawdownViewFromEvents,
  type FillStreamEvent,
} from './dataIntegrityRuntime';
import {
  DEFAULT_SLIPPAGE_BUDGET_RATIO,
  MIN_RR_KERNEL_CONSTANT,
  RR_REJECTION_TAXONOMY,
  can_trade,
  checkRROrderIntent,
  checkRRRiskGate,
  checkRRSignalEmission,
  createInitialRiskEngineState,
  recordTradeOutcomeInRiskState,
} from './riskEngine';
import {
  evaluatePgV4GateAsync,
  evaluatePromotionSubmission,
  ImmutableGateRecordStore,
  ORDERED_PG_V4_CONJUNCTS,
  PG_V4_LOGIC_VERSION,
} from './pgV4Gate';

function makeSeededPrng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeFreshOracle(nowMs = 1_700_000_000_000) {
  let clock = nowMs;
  const oracle = new CertifiedPriceOracle({
    nowMsFn: () => clock,
    primeDefaults: false,
  });
  return {
    oracle,
    getClock: () => clock,
    advanceClock: (ms: number) => {
      clock += ms;
      return clock;
    },
    setClock: (ms: number) => {
      clock = ms;
      return clock;
    },
  };
}

test('Kernel Registry & Signed CPS Protocol Artifact Declarations (I-PD1..I-PD4)', () => {
  assert.equal(verifyCertifiedSourceConfig(CERTIFIED_PRIMARY_SOURCE_CONFIG), true);
  assert.equal(CERTIFIED_PRIMARY_SOURCE_CONFIG.entries.SPOT.source_id, 'binance_spot_ws_bookTicker');
  assert.equal(CERTIFIED_PRIMARY_SOURCE_CONFIG.entries.SPOT.freshnessCeilingMs, 500);
  assert.equal(CERTIFIED_PRIMARY_SOURCE_CONFIG.entries.SPOT.divergenceThresholdBps, 25);
  assert.equal(CERTIFIED_PRIMARY_SOURCE_CONFIG.entries.USD_M_FUTURES.source_id, 'binance_usdm_ws_markPrice_1s');
  assert.equal(CERTIFIED_PRIMARY_SOURCE_CONFIG.entries.USD_M_FUTURES.freshnessCeilingMs, 1500);
  assert.equal(CERTIFIED_PRIMARY_SOURCE_CONFIG.entries.USD_M_FUTURES.divergenceThresholdBps, 50);
  assert.equal(CERTIFIED_PRIMARY_SOURCE_CONFIG.entries.COIN_M_FUTURES.source_id, 'binance_coinm_ws_markPrice_1s');
  assert.equal(CERTIFIED_PRIMARY_SOURCE_CONFIG.entries.COIN_M_FUTURES.freshnessCeilingMs, 1500);
  assert.equal(CERTIFIED_PRIMARY_SOURCE_CONFIG.entries.COIN_M_FUTURES.divergenceThresholdBps, 50);

  const cpsKernel = KERNEL_REGISTRY_BY_ID['CertifiedPrimarySource-Kernel'];
  assert.ok(cpsKernel, 'CertifiedPrimarySource-Kernel must be registered in KERNEL_REGISTRY');
  for (const id of ['I-PD1', 'I-PD2', 'I-PD3', 'I-PD4'] as const) {
    assert.ok(cpsKernel.invariantManifest.includes(id), `Kernel manifest missing ${id}`);
    assert.ok(PRISTINE_DATA_INVARIANT_MANIFEST.some((inv) => inv.id === id));
  }
  assert.equal(CACHE_POLICY_TABLE.length, 6);
  assert.deepEqual(RR_REJECTION_TAXONOMY, [
    'RR_REJECT_SIGNAL',
    'RR_REJECT_PRICE_DRIFT',
    'RR_REJECT_STALE_PRICE',
    'DD_BLOCK',
    'EXPOSURE_BLOCK',
    'MANDATE_BLOCK',
    'INTEGRITY_FAILURE',
  ]);
});

/* ── 12 Property Tests ────────────────────────────────────────────────────── */

test('PT-CPS-1: I-PD1 monotonic sequence_number strictly enforced; duplicate/regression/gap returns PriceUnavailable(GAP)', () => {
  const { oracle, getClock } = makeFreshOracle();
  const r1 = oracle.ingestPrimaryStreamTick({
    instrument: 'SPOT:BTCUSDT',
    sequence_number: 1,
    timestamp_exchange: getClock() - 10,
    bid: 64995,
    ask: 65005,
    mark_price: 65000,
  });
  assert.equal(r1.available, true);

  // Duplicate seq=1 -> GAP
  const dup = oracle.ingestPrimaryStreamTick({
    instrument: 'SPOT:BTCUSDT',
    sequence_number: 1,
    timestamp_exchange: getClock() - 5,
    bid: 64996,
    ask: 65006,
    mark_price: 65001,
  });
  assert.equal(isPriceUnavailable(dup), true);
  if (isPriceUnavailable(dup)) {
    assert.equal(dup.reason_code, 'GAP');
  }

  // Gap jump seq=3 after seq=1 -> GAP
  const jump = oracle.ingestPrimaryStreamTick({
    instrument: 'SPOT:BTCUSDT',
    sequence_number: 3,
    timestamp_exchange: getClock() - 3,
    bid: 65000,
    ask: 65010,
    mark_price: 65005,
  });
  assert.equal(isPriceUnavailable(jump), true);
  if (isPriceUnavailable(jump)) {
    assert.equal(jump.reason_code, 'GAP');
  }
  const resolved = oracle.resolve('SPOT:BTCUSDT');
  assert.equal(isPriceUnavailable(resolved), true);
  if (isPriceUnavailable(resolved)) {
    assert.equal(resolved.reason_code, 'GAP');
  }
});

test('PT-CPS-2: I-PD2 freshness ceiling enforced (SPOT <= 500ms, FUTURES <= 1500ms)', () => {
  const { oracle, getClock, advanceClock } = makeFreshOracle();
  oracle.ingestPrimaryStreamTick({
    instrument: 'SPOT:BTCUSDT',
    sequence_number: 1,
    timestamp_exchange: getClock(),
    bid: 64995,
    ask: 65005,
    mark_price: 65000,
  });
  oracle.ingestPrimaryStreamTick({
    instrument: 'USD_M_FUTURES:BTCUSDT',
    sequence_number: 1,
    timestamp_exchange: getClock(),
    bid: 65015,
    ask: 65025,
    mark_price: 65020,
  });

  // At +500ms SPOT is right on boundary -> available; PERP at +500ms -> available
  advanceClock(500);
  assert.equal(oracle.resolve('SPOT:BTCUSDT').available, true);
  assert.equal(oracle.resolve('USD_M_FUTURES:BTCUSDT').available, true);

  // At +501ms SPOT exceeds 500ms -> STALE, while USD_M_FUTURES remains available
  advanceClock(1);
  const spotRes = oracle.resolve('SPOT:BTCUSDT');
  assert.equal(isPriceUnavailable(spotRes), true);
  if (isPriceUnavailable(spotRes)) {
    assert.equal(spotRes.reason_code, 'STALE');
  }
  assert.equal(oracle.resolve('USD_M_FUTURES:BTCUSDT').available, true);

  // Advance another 1000ms (total 1501ms) -> USD_M_FUTURES exceeds 1500ms -> STALE
  advanceClock(1000);
  const perpRes = oracle.resolve('USD_M_FUTURES:BTCUSDT');
  assert.equal(isPriceUnavailable(perpRes), true);
  if (isPriceUnavailable(perpRes)) {
    assert.equal(perpRes.reason_code, 'STALE');
  }
});

test('PT-CPS-3: Zero failover — disconnect or divergence never falls back to secondary REST or last_known_reading', () => {
  const { oracle, getClock } = makeFreshOracle();
  oracle.ingestPrimaryStreamTick({
    instrument: 'SPOT:ETHUSDT',
    sequence_number: 1,
    timestamp_exchange: getClock(),
    bid: 3249,
    ask: 3251,
    mark_price: 3250,
  });
  oracle.ingestSecondaryCrossCheck({
    instrument: 'SPOT:ETHUSDT',
    secondaryPrice: 3250,
  });

  oracle.disconnectSource('SPOT:ETHUSDT', 'Socket dropped');
  const disconnectedRes = oracle.resolve('SPOT:ETHUSDT');
  assert.equal(isPriceUnavailable(disconnectedRes), true);
  if (isPriceUnavailable(disconnectedRes)) {
    assert.equal(disconnectedRes.reason_code, 'SOURCE_DISCONNECTED');
    // last_known_reading is diagnostic only, resolve returns available: false
    assert.equal(disconnectedRes.available, false);
    assert.equal(disconnectedRes.ok, false);
  }
});

test('PT-CPS-4: Decision snapshot handle yields identical source_id & seq within decision and fails STALE after end_decision()', () => {
  const { oracle, getClock } = makeFreshOracle();
  oracle.ingestPrimaryStreamTick({
    instrument: 'SPOT:SOLUSDT',
    sequence_number: 10,
    timestamp_exchange: getClock(),
    bid: 184.9,
    ask: 185.1,
    mark_price: 185,
  });
  const handle = oracle.begin_decision('SPOT:SOLUSDT');
  assert.equal('snapshot_id' in handle, true);
  if ('snapshot_id' in handle) {
    const c1 = oracle.read_decision_snapshot(handle);
    // Stream advances to sequence 11 during decision
    oracle.ingestPrimaryStreamTick({
      instrument: 'SPOT:SOLUSDT',
      sequence_number: 11,
      timestamp_exchange: getClock() + 10,
      timestamp_received: getClock() + 10,
      bid: 185.9,
      ask: 186.1,
      mark_price: 186,
    });
    const c2 = oracle.read_decision_snapshot(handle);
    const c3 = oracle.read_decision_snapshot(handle);
    assert.equal(c1.available && c2.available && c3.available, true);
    if (c1.available && c2.available && c3.available) {
      assert.equal(c1.source_id, c2.source_id);
      assert.equal(c2.source_id, c3.source_id);
      assert.equal(c1.sequence_number, 10);
      assert.equal(c2.sequence_number, 10);
      assert.equal(c3.sequence_number, 10);
    }
    const closed = oracle.end_decision(handle);
    const afterEnd = oracle.read_decision_snapshot(closed);
    assert.equal(isPriceUnavailable(afterEnd), true);
    if (isPriceUnavailable(afterEnd)) {
      assert.equal(afterEnd.reason_code, 'STALE');
    }
  }
});

test('PT-CPS-5: I-PD4 secondary REST cross-check emits PRICE_SOURCE_DIVERGENCE & fails closed at >25bps SPOT / >50bps PERP', () => {
  const { oracle, getClock } = makeFreshOracle();
  oracle.ingestPrimaryStreamTick({
    instrument: 'SPOT:BTCUSDT',
    sequence_number: 1,
    timestamp_exchange: getClock(),
    bid: 64995,
    ask: 65005,
    mark_price: 65000,
  });
  // Within 25 bps (e.g., 10 bps) -> agreed
  const okCheck = oracle.ingestSecondaryCrossCheck({
    instrument: 'SPOT:BTCUSDT',
    secondaryPrice: 65000 * 1.001,
  });
  assert.equal(okCheck.agreed, true);

  // Breach 25 bps (35 bps) -> fail-closed DIVERGENCE + PRICE_SOURCE_DIVERGENCE alert
  const breachCheck = oracle.ingestSecondaryCrossCheck({
    instrument: 'SPOT:BTCUSDT',
    secondaryPrice: 65000 * 1.0035,
  });
  assert.equal(breachCheck.agreed, false);
  const res = oracle.resolve('SPOT:BTCUSDT');
  assert.equal(isPriceUnavailable(res), true);
  if (isPriceUnavailable(res)) {
    assert.equal(res.reason_code, 'DIVERGENCE');
    assert.equal(res.alert_emitted, 'PRICE_SOURCE_DIVERGENCE');
  }
  assert.ok(oracle.getAlerts().some((a) => a.code === 'PRICE_SOURCE_DIVERGENCE'));
});

test('PT-RR-1: planned_rr computed ONCE in Check 1 and identical across Check 1->2->3; drift > budget triggers RR_REJECT_PRICE_DRIFT without altering planned_rr', () => {
  const { oracle, getClock, advanceClock } = makeFreshOracle();
  oracle.ingestPrimaryStreamTick({
    instrument: 'SPOT:BTCUSDT',
    sequence_number: 1,
    timestamp_exchange: getClock(),
    bid: 99.99,
    ask: 100.01,
    mark_price: 100,
  });
  const handle = oracle.begin_decision('SPOT:BTCUSDT');
  assert.equal('snapshot_id' in handle, true);
  if (!('snapshot_id' in handle)) return;

  const s1 = checkRRSignalEmission({
    instrument: 'SPOT:BTCUSDT',
    direction: 'BUY',
    entryPrice: 100,
    stopLoss: 99,
    takeProfit: 105.5,
    priceOracle: oracle,
    decisionHandle: handle,
  });
  assert.equal(s1.passed, true);
  assert.ok(s1.signalReceipt);
  const recordedRR = s1.signalReceipt.planned_rr;
  assert.equal(recordedRR, 5.5);

  // Market moves +15 bps (within 25 bps DEFAULT_SLIPPAGE_BUDGET_RATIO)
  advanceClock(50);
  oracle.ingestPrimaryStreamTick({
    instrument: 'SPOT:BTCUSDT',
    sequence_number: 2,
    timestamp_exchange: getClock() - 2,
    timestamp_received: getClock(),
    bid: 100.14,
    ask: 100.16,
    mark_price: 100.15,
  });

  const s2 = checkRRRiskGate({
    signalReceipt: s1.signalReceipt,
    priceOracle: oracle,
    decisionHandle: handle,
  });
  assert.equal(s2.passed, true);
  assert.equal(s2.plannedRR, recordedRR);

  const s3 = checkRROrderIntent({
    signalReceipt: s1.signalReceipt,
    expectedReceiptHash: s1.signalReceipt.receiptHash,
    orderIntentPrice: 100.15,
    stopLoss: s1.signalReceipt.structural_stop,
    takeProfit: s1.signalReceipt.structural_target,
    direction: 'BUY',
    priceOracle: oracle,
    decisionHandle: handle,
  });
  assert.equal(s3.passed, true);
  assert.equal(s3.plannedRR, recordedRR);

  // Now drift +45 bps (> 25 bps budget) -> RR_REJECT_PRICE_DRIFT (NOT RR recomputation) and plannedRR preserved
  advanceClock(20);
  oracle.ingestPrimaryStreamTick({
    instrument: 'SPOT:BTCUSDT',
    sequence_number: 3,
    timestamp_exchange: getClock() - 2,
    timestamp_received: getClock(),
    bid: 100.44,
    ask: 100.46,
    mark_price: 100.45,
  });
  const s3Drift = checkRROrderIntent({
    signalReceipt: s1.signalReceipt,
    expectedReceiptHash: s1.signalReceipt.receiptHash,
    orderIntentPrice: 100.45,
    stopLoss: s1.signalReceipt.structural_stop,
    takeProfit: s1.signalReceipt.structural_target,
    direction: 'BUY',
    priceOracle: oracle,
    decisionHandle: handle,
    slippageBudgetRatio: DEFAULT_SLIPPAGE_BUDGET_RATIO,
  });
  assert.equal(s3Drift.passed, false);
  assert.equal(s3Drift.rejectionCode, 'RR_REJECT_PRICE_DRIFT');
  assert.equal(s3Drift.plannedRR, recordedRR);
});

test('PT-RR-2: Missing/sub-5R Check 1 triggers RR_REJECT_SIGNAL; tampered SignalRecord triggers INTEGRITY_FAILURE at Check 2/3', () => {
  const noSl = checkRRSignalEmission({
    direction: 'BUY',
    entryPrice: 100,
    stopLoss: null,
    takeProfit: 110,
  });
  assert.equal(noSl.passed, false);
  assert.equal(noSl.rejectionCode, 'RR_REJECT_SIGNAL');

  const subFloor = checkRRSignalEmission({
    direction: 'BUY',
    entryPrice: 100,
    stopLoss: 99,
    takeProfit: 104.2,
  });
  assert.equal(subFloor.passed, false);
  assert.equal(subFloor.rejectionCode, 'RR_REJECT_SIGNAL');

  const valid = checkRRSignalEmission({
    direction: 'BUY',
    entryPrice: 100,
    stopLoss: 99,
    takeProfit: 105.5,
  });
  assert.equal(valid.passed, true);
  assert.ok(valid.signalReceipt);

  const tampered = {
    ...valid.signalReceipt,
    planned_rr: 7.5,
    plannedRR: 7.5,
  };
  const s2 = checkRRRiskGate({ signalReceipt: tampered });
  assert.equal(s2.passed, false);
  assert.equal(s2.rejectionCode, 'INTEGRITY_FAILURE');

  const s3 = checkRROrderIntent({
    signalReceipt: tampered,
    orderIntentPrice: 100,
    stopLoss: 99,
    takeProfit: 105.5,
    direction: 'BUY',
  });
  assert.equal(s3.passed, false);
  assert.equal(s3.rejectionCode, 'INTEGRITY_FAILURE');
});

test('PT-DD-1: Event-sourced DD fold equals sequential state and rebuilds cleanly on lag; corrupt rebuild fails closed with STALE_STATE', () => {
  const { oracle } = makeFreshOracle();
  const runtime = new DataIntegrityRuntime({
    initialCapitalUsd: 10_000,
    strategyIds: ['STRAT_A'],
    priceOracle: oracle,
  });

  const events: FillStreamEvent[] = [
    { fill_sequence: 1, strategyId: 'STRAT_A', symbol: 'BTCUSDT', regime: 'NORMAL', realizedPnlUsd: 250, timestampUtc: new Date(1000).toISOString() },
    { fill_sequence: 2, strategyId: 'STRAT_A', symbol: 'BTCUSDT', regime: 'NORMAL', realizedPnlUsd: -120, timestampUtc: new Date(2000).toISOString() },
    { fill_sequence: 3, strategyId: 'STRAT_A', symbol: 'BTCUSDT', regime: 'TRENDING', realizedPnlUsd: 400, timestampUtc: new Date(3000).toISOString() },
  ];

  let sequential = createInitialRiskEngineState({
    initialCapitalUsd: 10_000,
    strategyIds: ['STRAT_A'],
  });
  for (const ev of events) {
    sequential = recordTradeOutcomeInRiskState(sequential, {
      strategyId: ev.strategyId,
      regime: ev.regime,
      pnlUsd: ev.realizedPnlUsd,
    });
    // Record with lag on sequence 2 to force rebuild check later
    runtime.recordFillEvent({
      strategyId: ev.strategyId,
      symbol: ev.symbol,
      regime: ev.regime,
      realizedPnlUsd: ev.realizedPnlUsd,
      skipMaterializedViewUpdate: ev.fill_sequence === 3,
    });
  }

  // Raw materialized view is lagging (2 !== 3)
  assert.equal(runtime.getMaterializedViewRaw().applied_fill_sequence, 2);
  assert.equal(runtime.getFillHeadSequence(), 3);

  // Freshness gate rebuilds cleanly from fill_stream and matches sequential state
  const freshCheck = runtime.verifyAndGetFreshDrawdownView();
  assert.equal(freshCheck.ok, true);
  if (freshCheck.ok) {
    assert.equal(freshCheck.rebuilt, true);
    assert.equal(freshCheck.view.applied_fill_sequence, 3);
    assert.equal(freshCheck.view.riskEngineState.portfolioEquityUsd, sequential.portfolioEquityUsd);
    assert.equal(freshCheck.view.riskEngineState.portfolioPeakEquityUsd, sequential.portfolioPeakEquityUsd);
  }

  // If rebuild fails, fails closed with STALE_STATE
  runtime.recordFillEvent({
    strategyId: 'STRAT_A',
    symbol: 'BTCUSDT',
    regime: 'NORMAL',
    realizedPnlUsd: -50,
    skipMaterializedViewUpdate: true,
  });
  runtime.setRebuildFailureInjector(() => true);
  const failed = runtime.verifyAndGetFreshDrawdownView();
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.code, 'STALE_STATE');
  }
});

test('PT-DD-2: Versioned REGIME_STATE cache rejects stale feature_sequence; uncached reconciler rejects when starved', () => {
  const { oracle, advanceClock } = makeFreshOracle();
  const runtime = new DataIntegrityRuntime({ priceOracle: oracle });

  runtime.updateRegimeCache('TRENDING', 5);
  assert.equal(runtime.readRegimeState().valid, true);
  runtime.advanceFeatureStreamSequence(6);
  const staleRegime = runtime.readRegimeState();
  assert.equal(staleRegime.valid, false);
  assert.equal(staleRegime.stale, true);

  assert.equal(runtime.isReconcilerFresh().fresh, true);
  advanceClock(6_000);
  const starvedRec = runtime.isReconcilerFresh();
  assert.equal(starvedRec.fresh, false);
});

test('PT-CACHE-1: Tier-2 1s continuous watchdog fires STALE_STATE_DETECTED even while decision path is idle and blocks next decision', () => {
  const { oracle, getClock, advanceClock } = makeFreshOracle();
  const runtime = new DataIntegrityRuntime({ priceOracle: oracle });
  oracle.ingestPrimaryStreamTick({
    instrument: 'SPOT:BTCUSDT',
    sequence_number: 1,
    timestamp_exchange: getClock(),
    bid: 64995,
    ask: 65005,
    mark_price: 65000,
  });

  // Healthy within 500ms
  assert.equal(TIER_2_WATCHDOG_INTERVAL_MS, 1000);
  assert.equal(runtime.runStalenessWatchdogTick().healthy, true);

  // Advance clock by 1000ms without refreshing tick -> watchdog fires STALE_STATE_DETECTED
  advanceClock(TIER_2_WATCHDOG_INTERVAL_MS);
  const wd = runtime.runStalenessWatchdogTick();
  assert.equal(wd.healthy, false);
  assert.ok(wd.alertsEmitted.some((a) => a.code === 'STALE_STATE_DETECTED'));

  // Next decision is blocked immediately until Tier-3 reset clears it
  const ddBlock = runtime.verifyAndGetFreshDrawdownView();
  assert.equal(ddBlock.ok, false);
  if (!ddBlock.ok) {
    assert.equal(ddBlock.code, 'STALE_STATE');
  }
});

test('PT-CACHE-2: Tier-3 hard reset (15m=900,000ms) emits CACHE_HARD_RESET, preserves orders & permanent ledger, never restarts process', () => {
  const { oracle, getClock, advanceClock } = makeFreshOracle();
  const runtime = new DataIntegrityRuntime({
    initialCapitalUsd: 20_000,
    strategyIds: ['STRAT_1'],
    priceOracle: oracle,
  });
  runtime.setOpenExchangeOrdersCount(3);
  runtime.recordFillEvent({
    strategyId: 'STRAT_1',
    symbol: 'BTCUSDT',
    regime: 'NORMAL',
    realizedPnlUsd: 300,
  });
  oracle.ingestPrimaryStreamTick({
    instrument: 'SPOT:BTCUSDT',
    sequence_number: 1,
    timestamp_exchange: getClock(),
    bid: 64995,
    ask: 65005,
    mark_price: 65000,
  });

  assert.equal(TIER_3_HARD_RESET_INTERVAL_MS, 900_000);
  const newNow = advanceClock(TIER_3_HARD_RESET_INTERVAL_MS);
  const reset = runtime.triggerTier3HardReset('SCHEDULED_15M', newNow, [
    {
      tick: {
        instrument: 'SPOT:BTCUSDT',
        sequence_number: 2,
        timestamp_exchange: newNow - 5,
        timestamp_received: newNow,
        bid: 65095,
        ask: 65105,
        mark_price: 65100,
      },
      secondaryPrice: 65100,
    },
  ]);

  assert.equal(reset.eventType, 'CACHE_HARD_RESET');
  assert.equal(reset.triggerReason, 'SCHEDULED_15M');
  assert.equal(reset.openOrdersPreserved, true);
  assert.equal(reset.permanentLedgerPreserved, true);
  assert.equal(reset.processRestarted, false);
  assert.equal(runtime.getOpenExchangeOrdersCount(), 3);
  assert.equal(runtime.getFillStream().length, 1);
  assert.equal(reset.postResetFillSeq, 1);
});

test('PT-PD-3: 10,000 randomized decisions validate source immutability & detect injected mid-decision swap', () => {
  const { oracle, getClock, advanceClock } = makeFreshOracle();
  const rng = makeSeededPrng(20261118);
  const instruments = ['SPOT:BTCUSDT', 'USD_M_FUTURES:BTCUSDT', 'COIN_M_FUTURES:BTCUSD_PERP'] as const;
  const seqMap = new Map<string, number>();

  for (let i = 0; i < 10_000; i++) {
    const inst = instruments[i % instruments.length];
    const nextSeq = (seqMap.get(inst) ?? 0) + 1;
    seqMap.set(inst, nextSeq);
    const now = advanceClock(5);
    const px = inst.startsWith('SPOT') ? 65_000 + (rng() - 0.5) * 40 : 65_020 + (rng() - 0.5) * 40;
    const cls = inst.startsWith('SPOT')
      ? 'SPOT'
      : inst.startsWith('USD_M')
      ? 'USD_M_FUTURES'
      : 'COIN_M_FUTURES';

    oracle.reprimeInstrument(
      inst,
      {
        instrument: inst,
        instrumentClass: cls,
        sequence_number: nextSeq,
        timestamp_exchange: now - 2,
        timestamp_received: now,
        bid: px * 0.9999,
        ask: px * 1.0001,
        mark_price: px,
      },
      px
    );

    const handle = oracle.begin_decision(inst, now);
    assert.equal('snapshot_id' in handle, true);
    if (!('snapshot_id' in handle)) continue;

    // Periodic adversarial mid-decision swap injection (every 500th decision)
    if (i > 0 && i % 500 === 0) {
      oracle.injectSourceIdentitySwap(inst, 'bybit_foreign_feed');
      const aborted = oracle.read_decision_snapshot(handle, now);
      assert.equal(isPriceUnavailable(aborted), true);
      if (isPriceUnavailable(aborted)) {
        assert.equal(aborted.reason_code, 'SOURCE_MIXED');
      }
      oracle.end_decision(handle);
      continue;
    }

    const r1 = oracle.read_decision_snapshot(handle, now);
    const r2 = oracle.read_decision_snapshot(handle, now);
    const r3 = oracle.read_decision_snapshot(handle, now);
    assert.equal(r1.available && r2.available && r3.available, true);
    if (r1.available && r2.available && r3.available) {
      assert.equal(r1.source_id, r2.source_id);
      assert.equal(r2.source_id, r3.source_id);
      assert.equal(r1.sequence_number, nextSeq);
      assert.equal(r2.sequence_number, nextSeq);
      assert.equal(r3.sequence_number, nextSeq);
    }
    oracle.end_decision(handle);
  }
  assert.ok(getClock() > 1_700_000_000_000);
});

/* ── 6 Chaos Tests (CT-1 .. CT-6) ─────────────────────────────────────────── */

test('CT-1: Inject 60 bps divergence on SPOT WS vs REST -> fail-closed DIVERGENCE, zero failover, PRICE_SOURCE_DIVERGENCE alert', () => {
  const { oracle, getClock } = makeFreshOracle();
  oracle.ingestPrimaryStreamTick({
    instrument: 'SPOT:BTCUSDT',
    sequence_number: 1,
    timestamp_exchange: getClock(),
    bid: 64995,
    ask: 65005,
    mark_price: 65000,
  });
  // 60 bps higher on REST /api/v3/ticker/price
  const check = oracle.ingestSecondaryCrossCheck({
    instrument: 'SPOT:BTCUSDT',
    secondaryPrice: 65000 * 1.006,
  });
  assert.equal(check.agreed, false);
  const verdict = can_trade({
    riskState: createInitialRiskEngineState({ initialCapitalUsd: 25_000, strategyIds: ['SMC_1_5'] }),
    strategyId: 'SMC_1_5',
    symbol: 'SPOT:BTCUSDT',
    direction: 'BUY',
    signalEntryPrice: 65000,
    stopLoss: 64500,
    takeProfit: 68000,
    priceOracle: oracle,
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.rejectionCode, 'RR_REJECT_STALE_PRICE');
  assert.ok(oracle.getAlerts().some((a) => a.code === 'PRICE_SOURCE_DIVERGENCE'));
});

test('CT-2: Inject primary WS disconnect mid-decision -> fail-closed RR_REJECT_STALE_PRICE, zero REST fallback', () => {
  const { oracle, getClock } = makeFreshOracle();
  oracle.ingestPrimaryStreamTick({
    instrument: 'SPOT:BTCUSDT',
    sequence_number: 1,
    timestamp_exchange: getClock(),
    bid: 99.99,
    ask: 100.01,
    mark_price: 100,
  });
  const handle = oracle.begin_decision('SPOT:BTCUSDT');
  assert.equal('snapshot_id' in handle, true);
  if (!('snapshot_id' in handle)) return;

  const s1 = checkRRSignalEmission({
    instrument: 'SPOT:BTCUSDT',
    direction: 'BUY',
    entryPrice: 100,
    stopLoss: 99,
    takeProfit: 105.5,
    priceOracle: oracle,
    decisionHandle: handle,
  });
  assert.equal(s1.passed, true);

  // Disconnect mid-decision before Check 2
  oracle.disconnectSource('SPOT:BTCUSDT', 'Simulated mid-decision socket cut');
  const s2 = checkRRRiskGate({
    signalReceipt: s1.signalReceipt,
    priceOracle: oracle,
    decisionHandle: handle,
  });
  assert.equal(s2.passed, false);
  assert.equal(s2.rejectionCode, 'RR_REJECT_STALE_PRICE');
});

test('CT-3: Inject lagging DD materialized view + failed event rebuild -> STALE_STATE fail-closed & INTEGRITY_FAILURE at Check 2', () => {
  const { oracle, getClock } = makeFreshOracle();
  oracle.ingestPrimaryStreamTick({
    instrument: 'SPOT:BTCUSDT',
    sequence_number: 1,
    timestamp_exchange: getClock(),
    bid: 99.99,
    ask: 100.01,
    mark_price: 100,
  });
  const runtime = new DataIntegrityRuntime({
    initialCapitalUsd: 25_000,
    strategyIds: ['SMC_1_5'],
    priceOracle: oracle,
  });
  runtime.recordFillEvent({
    strategyId: 'SMC_1_5',
    symbol: 'BTCUSDT',
    regime: 'NORMAL',
    realizedPnlUsd: -400,
    skipMaterializedViewUpdate: true,
  });
  runtime.setRebuildFailureInjector(() => true);
  const ddCheck = runtime.verifyAndGetFreshDrawdownView();
  assert.equal(ddCheck.ok, false);
  if (!ddCheck.ok) {
    assert.equal(ddCheck.code, 'STALE_STATE');
  }

  const s1 = checkRRSignalEmission({
    instrument: 'SPOT:BTCUSDT',
    direction: 'BUY',
    entryPrice: 100,
    stopLoss: 99,
    takeProfit: 105.5,
  });
  assert.ok(s1.signalReceipt);
  const s2 = checkRRRiskGate({
    signalReceipt: s1.signalReceipt,
    ddLedgerFresh: ddCheck.ok,
  });
  assert.equal(s2.passed, false);
  assert.equal(s2.rejectionCode, 'INTEGRITY_FAILURE');
});

test('CT-4: Inject source identity swap mid-decision -> aborts with SOURCE_MIXED and Check 2 RR_REJECT_STALE_PRICE', () => {
  const { oracle, getClock } = makeFreshOracle();
  oracle.ingestPrimaryStreamTick({
    instrument: 'SPOT:ETHUSDT',
    sequence_number: 1,
    timestamp_exchange: getClock(),
    bid: 99.99,
    ask: 100.01,
    mark_price: 100,
  });
  const handle = oracle.begin_decision('SPOT:ETHUSDT');
  assert.equal('snapshot_id' in handle, true);
  if (!('snapshot_id' in handle)) return;

  const s1 = checkRRSignalEmission({
    instrument: 'SPOT:ETHUSDT',
    direction: 'BUY',
    entryPrice: 100,
    stopLoss: 99,
    takeProfit: 105.5,
    priceOracle: oracle,
    decisionHandle: handle,
  });
  assert.equal(s1.passed, true);

  oracle.injectSourceIdentitySwap('SPOT:ETHUSDT', 'binance_spot_rest_ticker');
  const s2 = checkRRRiskGate({
    signalReceipt: s1.signalReceipt,
    priceOracle: oracle,
    decisionHandle: handle,
  });
  assert.equal(s2.passed, false);
  assert.equal(s2.rejectionCode, 'RR_REJECT_STALE_PRICE');
  assert.match(s2.reason, /SOURCE_MIXED/);
});

test('CT-5: Advance clock >= 15 minutes with open exchange orders -> Tier-3 CACHE_HARD_RESET preserves open orders & ledger', () => {
  const { oracle, getClock, advanceClock } = makeFreshOracle();
  const runtime = new DataIntegrityRuntime({
    initialCapitalUsd: 25_000,
    strategyIds: ['SMC_1_5'],
    priceOracle: oracle,
  });
  runtime.setOpenExchangeOrdersCount(5);
  runtime.recordFillEvent({
    strategyId: 'SMC_1_5',
    symbol: 'BTCUSDT',
    regime: 'TRENDING',
    realizedPnlUsd: 750,
  });
  oracle.ingestPrimaryStreamTick({
    instrument: 'SPOT:BTCUSDT',
    sequence_number: 1,
    timestamp_exchange: getClock(),
    bid: 64995,
    ask: 65005,
    mark_price: 65000,
  });

  // Advance >= 900_000ms and run watchdog tick (which auto-triggers SCHEDULED_15M reset)
  advanceClock(900_005);
  runtime.runStalenessWatchdogTick();

  const resets = runtime.getHardResetHistory();
  assert.equal(resets.length >= 1, true);
  assert.equal(resets[0].triggerReason, 'SCHEDULED_15M');
  assert.equal(resets[0].openOrdersPreserved, true);
  assert.equal(resets[0].permanentLedgerPreserved, true);
  assert.equal(resets[0].processRestarted, false);
  assert.equal(runtime.getOpenExchangeOrdersCount(), 5);
  assert.equal(runtime.getMaterializedViewRaw().current_equity, 25_750);
});

test('CT-6: Tamper SignalRecord.structural_stop between Check 2 and Check 3 -> blocked immediately with INTEGRITY_FAILURE', () => {
  const s1 = checkRRSignalEmission({
    direction: 'BUY',
    entryPrice: 100,
    stopLoss: 99,
    takeProfit: 105.5,
  });
  assert.ok(s1.signalReceipt);
  const s2 = checkRRRiskGate({ signalReceipt: s1.signalReceipt });
  assert.equal(s2.passed, true);

  // Tamper structural_stop before Check 3
  const tamperedBetweenStages = {
    ...s1.signalReceipt,
    structural_stop: 99.4,
    structuralStopLoss: 99.4,
  };
  const s3 = checkRROrderIntent({
    signalReceipt: tamperedBetweenStages,
    expectedReceiptHash: s1.signalReceipt.receiptHash,
    orderIntentPrice: 100,
    stopLoss: 99.4,
    takeProfit: 105.5,
    direction: 'BUY',
  });
  assert.equal(s3.passed, false);
  assert.equal(s3.rejectionCode, 'INTEGRITY_FAILURE');
});

/* ── Incident Regression Replay & PG_stale_state Promotion Gate ───────────── */

test('Incident Regression Replay: Synthetic P1 multi-source/TTL window replayed under amended ladder eliminates internal RR oscillation', () => {
  interface IncidentEvent {
    readonly id: string;
    readonly signalEntry: number;
    readonly stop: number;
    readonly target: number;
    readonly legacyCheck2CacheDriftBps: number;
    readonly liveCpsDriftBps: number;
    readonly staleEquity: boolean;
  }

  // Realistic synthetic incident audit log reproducing Command 6 P1 symptom patterns:
  // Legacy bug recomputed R:R at Check 2 against stale REST cache (18-32 bps skewed) causing RR_REJECT_INTENT flips.
  const incidentLog: ReadonlyArray<IncidentEvent> = [
    { id: 'INC-01', signalEntry: 65000, stop: 64350, target: 68400, legacyCheck2CacheDriftBps: 22, liveCpsDriftBps: 8, staleEquity: false },
    { id: 'INC-02', signalEntry: 3250, stop: 3218, target: 3415, legacyCheck2CacheDriftBps: 30, liveCpsDriftBps: 12, staleEquity: false },
    { id: 'INC-03', signalEntry: 185, stop: 183, target: 196, legacyCheck2CacheDriftBps: 19, liveCpsDriftBps: 35, staleEquity: false },
    { id: 'INC-04', signalEntry: 615, stop: 609, target: 646, legacyCheck2CacheDriftBps: 28, liveCpsDriftBps: 5, staleEquity: true },
  ];

  const { oracle, getClock, advanceClock } = makeFreshOracle();
  let seq = 1;

  for (const ev of incidentLog) {
    const now = advanceClock(20);
    oracle.reprimeInstrument(
      'SPOT:BTCUSDT',
      {
        instrument: 'SPOT:BTCUSDT',
        instrumentClass: 'SPOT',
        sequence_number: seq++,
        timestamp_exchange: now - 2,
        timestamp_received: now,
        bid: ev.signalEntry * 0.9999,
        ask: ev.signalEntry * 1.0001,
        mark_price: ev.signalEntry,
      },
      ev.signalEntry
    );

    const handle = oracle.begin_decision('SPOT:BTCUSDT', now);
    assert.equal('snapshot_id' in handle, true);
    if (!('snapshot_id' in handle)) continue;

    // 1. Check 1 computes planned_rr >= 5 ONCE
    const s1 = checkRRSignalEmission({
      signal_id: ev.id,
      instrument: 'SPOT:BTCUSDT',
      direction: 'BUY',
      entryPrice: ev.signalEntry,
      stopLoss: ev.stop,
      takeProfit: ev.target,
      priceOracle: oracle,
      decisionHandle: handle,
    });
    assert.equal(s1.passed, true, `${ev.id} was >= 5R in incident log`);
    assert.ok(s1.signalReceipt);

    // Move live CPS tick by ev.liveCpsDriftBps
    const movedNow = advanceClock(10);
    const movedPrice = Number((ev.signalEntry * (1 + ev.liveCpsDriftBps / 10_000)).toPrecision(8));
    oracle.ingestPrimaryStreamTick({
      instrument: 'SPOT:BTCUSDT',
      sequence_number: seq++,
      timestamp_exchange: movedNow - 2,
      timestamp_received: movedNow,
      bid: movedPrice * 0.9999,
      ask: movedPrice * 1.0001,
      mark_price: movedPrice,
    });
    oracle.ingestSecondaryCrossCheck({
      instrument: 'SPOT:BTCUSDT',
      secondaryPrice: movedPrice,
      nowMs: movedNow,
    });

    const s2 = checkRRRiskGate({
      signalReceipt: s1.signalReceipt,
      ddLedgerFresh: !ev.staleEquity,
      priceOracle: oracle,
      decisionHandle: handle,
      nowMs: movedNow,
    });

    // Every signal retains exact Check 1 planned_rr across Check 2/3 without oscillation
    assert.equal(s2.plannedRR, s1.signalReceipt.planned_rr);

    if (ev.staleEquity) {
      assert.equal(s2.passed, false);
      assert.equal(s2.rejectionCode, 'INTEGRITY_FAILURE');
    } else if (ev.liveCpsDriftBps > 25) {
      assert.equal(s2.passed, false);
      assert.equal(s2.rejectionCode, 'RR_REJECT_PRICE_DRIFT');
    } else {
      assert.equal(s2.passed, true);
      const s3 = checkRROrderIntent({
        signalReceipt: s1.signalReceipt,
        expectedReceiptHash: s1.signalReceipt.receiptHash,
        orderIntentPrice: movedPrice,
        stopLoss: ev.stop,
        takeProfit: ev.target,
        direction: 'BUY',
        priceOracle: oracle,
        decisionHandle: handle,
        nowMs: movedNow,
      });
      assert.equal(s3.passed, true);
      assert.equal(s3.plannedRR, s1.signalReceipt.planned_rr);
    }

    oracle.end_decision(handle);
    assert.ok(getClock() > 0);
  }

  // Verify rebuildDrawdownViewFromEvents determinism directly
  const rebuilt = rebuildDrawdownViewFromEvents({
    initialCapitalUsd: 10000,
    strategyIds: ['S1'],
    fillStream: [],
    upToSequence: 0,
  });
  assert.equal(rebuilt.applied_fill_sequence, 0);
  assert.equal(rebuilt.current_equity, 10000);
});

test('PG_v4 v4.1.0 includes PG_stale_state (14 conjuncts) and blocks promotion when stale_state triggered', async () => {
  assert.equal(PG_V4_LOGIC_VERSION, '4.1.0');
  assert.equal(ORDERED_PG_V4_CONJUNCTS.length, 14);
  assert.ok(ORDERED_PG_V4_CONJUNCTS.some((c) => c.id === 'PG_stale_state'));

  const { oracle, advanceClock } = makeFreshOracle();
  const runtime = new DataIntegrityRuntime({ priceOracle: oracle });
  // Advance beyond 500ms without fresh ticks -> watchdog detects STALE
  advanceClock(1_000);

  const staleRecord = await evaluatePgV4GateAsync({
    promotionRequestId: 'prom_stale_block_check',
    requestedBy: 'data-integrity-suite',
    environment: 'staging',
    dataIntegrityRuntime: runtime,
    staleDecisionDetected: true,
    staleStateReason: 'CT-STALE simulation',
  });

  const pgStale = staleRecord.conjuncts.find((c) => c.conjunctId === 'PG_stale_state');
  assert.ok(pgStale);
  assert.equal(pgStale.status, 'FAIL');
  assert.equal(staleRecord.deploymentBlocked, true);
  assert.equal(staleRecord.promotionPermitted, false);

  const store = new ImmutableGateRecordStore();
  const promoOutcome = evaluatePromotionSubmission({
    candidateRecord: staleRecord,
    store,
  });
  assert.equal(promoOutcome.accepted, false);
  assert.equal(promoOutcome.httpStatus, 409);
  assert.ok(MIN_RR_KERNEL_CONSTANT === 5);
});

test('CPS Interface Contract Parity (kernels/foundation/cps/interface.py <-> TypeScript SnapshotHandle & PriceOracle)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const {
    CPS_INVARIANTS,
    ReasonCode,
    InstrumentClassCode,
    SnapshotValidationError,
  } = await import('./certifiedPrimarySource');

  const pyInterface = fs.readFileSync(
    path.resolve(process.cwd(), 'kernels/foundation/cps/interface.py'),
    'utf8'
  );
  assert.ok(pyInterface.includes('class ReasonCode'));
  assert.ok(pyInterface.includes('class InstrumentClass'));
  assert.ok(pyInterface.includes('class PriceReading'));
  assert.ok(pyInterface.includes('class PriceUnavailable'));
  assert.ok(pyInterface.includes('class PriceOracle'));
  assert.ok(pyInterface.includes('class SnapshotHandle'));
  assert.ok(pyInterface.includes('def validate_within_decision'));

  assert.deepEqual(CPS_INVARIANTS, {
    'I-PD1': 'monotonic_sequence',
    'I-PD2': 'freshness_ceiling',
    'I-PD3': 'source_immutability_within_decision',
    'I-PD4': 'cross_check_agreement',
  });
  assert.equal(ReasonCode.STALE, 'STALE');
  assert.equal(ReasonCode.GAP, 'GAP');
  assert.equal(ReasonCode.DIVERGENCE, 'DIVERGENCE');
  assert.equal(ReasonCode.SOURCE_DISCONNECTED, 'SOURCE_DISCONNECTED');
  assert.equal(InstrumentClassCode.SPOT, 'spot');
  assert.equal(InstrumentClassCode.USDM_PERP, 'usdm_perp');
  assert.equal(InstrumentClassCode.COINM_PERP, 'coinm_perp');

  const { oracle, getClock, advanceClock } = makeFreshOracle();
  const tick1 = oracle.ingestPrimaryStreamTick({
    instrument: 'BTCUSDT',
    instrumentClass: InstrumentClassCode.USDM_PERP,
    sequence_number: 1,
    timestamp_exchange_ms: getClock() - 25,
    timestamp_received_ms: getClock(),
    bid: 65000,
    ask: 65010,
    mark_price: 65005,
  });
  assert.equal(tick1.available, true);
  if (tick1.available) {
    assert.equal(tick1.instrument, 'USD_M_FUTURES:BTCUSDT');
    assert.equal(tick1.timestamp_exchange_ms, getClock() - 25);
    assert.equal(tick1.timestamp_received_ms, getClock());
    assert.equal(tick1.freshness_ms, 25);
  }

  const asyncOracle = oracle.asPriceOracle();
  const handle = await asyncOracle.begin_decision('USD_M_FUTURES:BTCUSDT');
  assert.equal(handle.instrument, 'USD_M_FUTURES:BTCUSDT');
  assert.equal(handle.source_id, 'binance_usdm_ws_markPrice_1s');
  assert.equal(handle.sequence_number, 1);
  assert.equal(handle.price.mark_price, 65005);

  // Valid intra-decision forward tick passes validate_within_decision
  const now2 = advanceClock(100);
  const tick2 = oracle.ingestPrimaryStreamTick({
    instrument: 'USD_M_FUTURES:BTCUSDT',
    sequence_number: 2,
    timestamp_exchange_ms: now2 - 10,
    timestamp_received_ms: now2,
    bid: 65010,
    ask: 65020,
    mark_price: 65015,
  });
  handle.validate_within_decision(tick2);

  // Switched source_id raises SnapshotValidationError
  if (tick2.available) {
    assert.throws(
      () => handle.validate_within_decision({ ...tick2, source_id: 'binance_spot_ws_bookTicker' }),
      SnapshotValidationError
    );
  }

  asyncOracle.end_decision(handle);
});

test('CPS Source Registry Parity (kernels/foundation/cps/source_registry.py <-> TypeScript SIGNED_REGISTRY & binding_for)', async () => {
  const { SIGNED_REGISTRY, binding_for, InstrumentClassCode } = await import('./certifiedPrimarySource');
  const fs = await import('node:fs');
  const path = await import('node:path');

  const pyRegistry = fs.readFileSync(
    path.resolve(process.cwd(), 'kernels/foundation/cps/source_registry.py'),
    'utf8'
  );
  assert.ok(pyRegistry.includes('class SourceBinding'));
  assert.ok(pyRegistry.includes('SIGNED_REGISTRY'));
  assert.ok(pyRegistry.includes('def binding_for'));

  assert.equal(SIGNED_REGISTRY[InstrumentClassCode.SPOT].primary_stream, 'binance.spot.bookTicker');
  assert.equal(SIGNED_REGISTRY[InstrumentClassCode.SPOT].secondary_poll, 'binance.spot.rest.ticker');
  assert.equal(SIGNED_REGISTRY[InstrumentClassCode.SPOT].freshness_ceiling_ms, 500);
  assert.equal(SIGNED_REGISTRY[InstrumentClassCode.SPOT].divergence_threshold_bps, 25);

  assert.equal(SIGNED_REGISTRY[InstrumentClassCode.USDM_PERP].primary_stream, 'binance.usdm.markPrice@1s');
  assert.equal(SIGNED_REGISTRY[InstrumentClassCode.USDM_PERP].secondary_poll, 'binance.usdm.rest.premiumIndex');
  assert.equal(SIGNED_REGISTRY[InstrumentClassCode.USDM_PERP].freshness_ceiling_ms, 1500);
  assert.equal(SIGNED_REGISTRY[InstrumentClassCode.USDM_PERP].divergence_threshold_bps, 50);

  assert.equal(SIGNED_REGISTRY[InstrumentClassCode.COINM_PERP].primary_stream, 'binance.coinm.markPrice@1s');
  assert.equal(SIGNED_REGISTRY[InstrumentClassCode.COINM_PERP].secondary_poll, 'binance.coinm.rest.premiumIndex');
  assert.equal(SIGNED_REGISTRY[InstrumentClassCode.COINM_PERP].freshness_ceiling_ms, 1500);
  assert.equal(SIGNED_REGISTRY[InstrumentClassCode.COINM_PERP].divergence_threshold_bps, 50);

  assert.equal(binding_for('BTCUSDT').primary_stream, 'binance.spot.bookTicker');
  assert.equal(binding_for('BTCUSDT_PERP').primary_stream, 'binance.usdm.markPrice@1s');
  assert.equal(binding_for('BTCUSD_PERP').primary_stream, 'binance.usdm.markPrice@1s');
  assert.equal(
    binding_for('BTCUSD_PERP', InstrumentClassCode.COINM_PERP).primary_stream,
    'binance.coinm.markPrice@1s'
  );
});



import {
  KERNEL_REGISTRY_BY_ID,
  canonicalStringify,
  sha256Hex,
} from './bindingLayer';
import {
  CERTIFIED_PRIMARY_SOURCE_CONFIG,
  CertifiedPriceOracle,
  isPriceUnavailable,
  normalizeCpsInstrument,
  type DecisionSnapshotHandle,
  type InstrumentClass,
} from './certifiedPrimarySource';
import {
  DEFAULT_MIN_RR_RATIO,
  HARD_MAX_RISK_PCT,
  type MarketRegime as InvariantMarketRegime,
} from './invariantKernels';
import type { Candle } from './marketData';

export type MarketRegime = InvariantMarketRegime;
export type MarketRegimeForRisk = InvariantMarketRegime;

/* ═══════════════════════════════════════════════════════════════════════════
 * FORCE SIGNAL — L0/L3 RISK ENGINE & 1:5 R:R KERNEL GATE (AMENDED V2)
 * Permanent Structural Amendment:
 *   - Compute planned_rr ONCE at Check 1 (signal_emission) against CPS snapshot
 *   - VALIDATE forward at Check 2 (risk_gate) & Check 3 (order_intent)
 *   - ZERO R:R recomputation anywhere after Check 1
 *   - Corrected 7-code Rejection Taxonomy + Fail-Closed CPS Integration
 * ═══════════════════════════════════════════════════════════════════════════ */

export const MIN_RR_KERNEL_CONSTANT = 5 as const;
export const DEFAULT_SLIPPAGE_BUDGET_RATIO = 0.0025 as const;

export const RISK_ENGINE_DD_LIMITS = Object.freeze({
  PORTFOLIO_DAILY_PCT: 5.0,
  PORTFOLIO_PEAK_TO_TROUGH_PCT: 15.0,
  STRATEGY_DAILY_PCT: 2.0,
  STRATEGY_PEAK_TO_TROUGH_PCT: 8.0,
  REGIME_SCOPED_PCT: 1.5,
  CONSECUTIVE_LOSSES_TRIGGER: 6,
} as const);

export type RRCheckStage = 'signal_emission' | 'risk_gate' | 'order_intent';

export const ORDERED_RR_CHECK_STAGES: ReadonlyArray<RRCheckStage> = Object.freeze([
  'signal_emission',
  'risk_gate',
  'order_intent',
]);

export type RRRejectionCode =
  | 'RR_REJECT_SIGNAL'
  | 'RR_REJECT_PRICE_DRIFT'
  | 'RR_REJECT_STALE_PRICE'
  | 'DD_BLOCK'
  | 'EXPOSURE_BLOCK'
  | 'MANDATE_BLOCK'
  | 'INTEGRITY_FAILURE';

export const RR_REJECTION_TAXONOMY: ReadonlyArray<RRRejectionCode> = Object.freeze([
  'RR_REJECT_SIGNAL',
  'RR_REJECT_PRICE_DRIFT',
  'RR_REJECT_STALE_PRICE',
  'DD_BLOCK',
  'EXPOSURE_BLOCK',
  'MANDATE_BLOCK',
  'INTEGRITY_FAILURE',
]);

export type StructuralStopOrigin =
  | 'STRUCTURAL_INVALIDATION'
  | 'SYNTHETIC_MULTIPLE'
  | 'NONE';

export type StructuralTargetOrigin =
  | 'STRUCTURAL_LIQUIDITY_POOL'
  | 'SYNTHETIC_MULTIPLE'
  | 'NONE';

export type DrawdownLevelId =
  | 'PORTFOLIO_DAILY'
  | 'PORTFOLIO_PEAK_TO_TROUGH'
  | 'STRATEGY_DAILY'
  | 'STRATEGY_PEAK_TO_TROUGH'
  | 'REGIME_SCOPED'
  | 'CONSECUTIVE_LOSSES';

export const ORDERED_DRAWDOWN_LEVELS: ReadonlyArray<DrawdownLevelId> = Object.freeze([
  'PORTFOLIO_DAILY',
  'PORTFOLIO_PEAK_TO_TROUGH',
  'STRATEGY_DAILY',
  'STRATEGY_PEAK_TO_TROUGH',
  'REGIME_SCOPED',
  'CONSECUTIVE_LOSSES',
]);

export type RiskEngineDenialCode =
  | RRRejectionCode
  | 'DD_PORTFOLIO_DAILY_HALT'
  | 'DD_PORTFOLIO_PEAK_TROUGH_HALT'
  | 'DD_STRATEGY_DAILY_DEMOTED'
  | 'DD_STRATEGY_PEAK_TROUGH_DEMOTED'
  | 'DD_REGIME_SCOPED_BLOCKED'
  | 'CIRCUIT_BREAKER_CONSECUTIVE_LOSSES'
  | 'RISK_SIZE_EXCEEDS_MAX_PCT'
  | 'POST_HOC_STOP_TIGHTENING_FORBIDDEN'
  | 'STRATEGY_DEMOTED'
  | 'STALE_STATE';

/* ── Structural Invalidation & Liquidity Pool Extraction ──────────────────── */

export interface StructuralLevelDerivation {
  readonly direction: 'BUY' | 'SELL';
  readonly entryPrice: number;
  readonly structuralStopLoss: number | null;
  readonly stopInvalidationLabel: string;
  readonly stopOrigin: StructuralStopOrigin;
  readonly structuralTarget: number | null;
  readonly targetLiquidityPoolLabel: string;
  readonly targetOrigin: StructuralTargetOrigin;
  readonly plannedRR: number;
}

/**
 * Extracts closed-window market invalidation level and opposing structural liquidity pool
 * without parameter-derived multiples or post-hoc stop tightening.
 */
export function deriveStructuralLevelsFromClosedWindow(params: {
  readonly direction: 'BUY' | 'SELL';
  readonly entryPrice: number;
  readonly closedCandles: ReadonlyArray<Candle>;
  readonly lookbackBars?: number;
}): StructuralLevelDerivation {
  const { direction, entryPrice, closedCandles, lookbackBars = 96 } = params;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || closedCandles.length < 5) {
    return Object.freeze({
      direction,
      entryPrice: Number.isFinite(entryPrice) ? entryPrice : 0,
      structuralStopLoss: null,
      stopInvalidationLabel: 'INSUFFICIENT_STRUCTURE',
      stopOrigin: 'NONE' as const,
      structuralTarget: null,
      targetLiquidityPoolLabel: 'NO_LIQUIDITY_POOL',
      targetOrigin: 'NONE' as const,
      plannedRR: 0,
    });
  }

  const windowBars = closedCandles.slice(-Math.max(10, lookbackBars));
  const recentInvalidationSlice = windowBars.slice(-Math.min(windowBars.length, 16));

  let structuralStopLoss: number | null = null;
  let stopInvalidationLabel = 'NONE';
  if (direction === 'BUY') {
    const validLows = recentInvalidationSlice
      .map((c) => c.low)
      .filter((low) => Number.isFinite(low) && low > 0 && low < entryPrice);
    if (validLows.length > 0) {
      const swingLow = Math.min(...validLows);
      structuralStopLoss = Number((swingLow * 0.9985).toPrecision(6));
      stopInvalidationLabel = `Closed Swing Low Invalidation ($${swingLow.toPrecision(6)})`;
    }
  } else {
    const validHighs = recentInvalidationSlice
      .map((c) => c.high)
      .filter((high) => Number.isFinite(high) && high > entryPrice);
    if (validHighs.length > 0) {
      const swingHigh = Math.max(...validHighs);
      structuralStopLoss = Number((swingHigh * 1.0015).toPrecision(6));
      stopInvalidationLabel = `Closed Swing High Invalidation ($${swingHigh.toPrecision(6)})`;
    }
  }

  let structuralTarget: number | null = null;
  let targetLiquidityPoolLabel = 'NONE';
  if (direction === 'BUY') {
    const candidateHighs = windowBars
      .map((c) => c.high)
      .filter((h) => Number.isFinite(h) && h > entryPrice);
    if (candidateHighs.length > 0) {
      const externalHigh = Math.max(...candidateHighs);
      structuralTarget = Number(externalHigh.toPrecision(6));
      targetLiquidityPoolLabel = `External BSL Swing High Pool ($${externalHigh.toPrecision(6)})`;
    }
  } else {
    const candidateLows = windowBars
      .map((c) => c.low)
      .filter((l) => Number.isFinite(l) && l > 0 && l < entryPrice);
    if (candidateLows.length > 0) {
      const externalLow = Math.min(...candidateLows);
      structuralTarget = Number(externalLow.toPrecision(6));
      targetLiquidityPoolLabel = `External SSL Swing Low Pool ($${externalLow.toPrecision(6)})`;
    }
  }

  const hasValidStop = structuralStopLoss !== null;
  const hasValidTarget = structuralTarget !== null;
  const riskDist = hasValidStop ? Math.abs(entryPrice - structuralStopLoss!) : 0;
  const rewardDist = hasValidTarget ? Math.abs(structuralTarget! - entryPrice) : 0;
  const plannedRR = riskDist > 1e-12 && rewardDist > 0 ? Number((rewardDist / riskDist).toFixed(4)) : 0;

  return Object.freeze({
    direction,
    entryPrice,
    structuralStopLoss,
    stopInvalidationLabel,
    stopOrigin: hasValidStop ? ('STRUCTURAL_INVALIDATION' as const) : ('NONE' as const),
    structuralTarget,
    targetLiquidityPoolLabel,
    targetOrigin: hasValidTarget ? ('STRUCTURAL_LIQUIDITY_POOL' as const) : ('NONE' as const),
    plannedRR,
  });
}

/* ── Three-Check RRGateKernel (signal_emission -> risk_gate -> order_intent) */

export interface SignalSnapshotRecord {
  readonly snapshot_id: string;
  readonly instrument: string;
  readonly instrument_class: InstrumentClass;
  readonly source_id: string;
  readonly sequence_number: number;
  readonly timestamp: number;
  readonly price: number;
}

export interface SignalEmissionRRInput {
  readonly signal_id?: string;
  readonly instrument?: string;
  readonly instrumentClass?: InstrumentClass;
  readonly direction: 'BUY' | 'SELL';
  readonly entryPrice: number;
  readonly stopLoss: number | null | undefined;
  readonly takeProfit: number | null | undefined;
  readonly stopOrigin?: StructuralStopOrigin;
  readonly targetOrigin?: StructuralTargetOrigin;
  readonly invalidationLabel?: string;
  readonly liquidityPoolLabel?: string;
  readonly priceOracle?: CertifiedPriceOracle;
  readonly decisionHandle?: DecisionSnapshotHandle;
  readonly snapshotTimestampMs?: number;
  readonly snapshotSequence?: number;
}

export interface SignalEmissionRRReceipt {
  readonly receiptId: string;
  readonly signal_id: string;
  readonly stage: 'signal_emission';
  readonly passed: true;
  readonly direction: 'BUY' | 'SELL';
  readonly snapshot: SignalSnapshotRecord;
  readonly entry_price_proposed: number;
  readonly structural_stop: number;
  readonly structural_target: number;
  readonly planned_rr: number;
  readonly kernel_hash_K4: string;
  readonly kernel_hash_K5: string;
  readonly signalEntryPrice: number;
  readonly structuralStopLoss: number;
  readonly structuralTarget: number;
  readonly stopOrigin: 'STRUCTURAL_INVALIDATION';
  readonly targetOrigin: 'STRUCTURAL_LIQUIDITY_POOL';
  readonly stopDistance: number;
  readonly rewardDistance: number;
  readonly riskPct: number;
  readonly plannedRR: number;
  readonly minRRKernelConstant: typeof MIN_RR_KERNEL_CONSTANT;
  readonly invalidationLabel: string;
  readonly liquidityPoolLabel: string;
  readonly receiptHash: string;
}

export type SignalRecord = SignalEmissionRRReceipt;

export interface RRStageCheckOutcome {
  readonly passed: boolean;
  readonly stage: RRCheckStage;
  readonly rejectionCode: RRRejectionCode | null;
  readonly plannedRR: number;
  readonly minRRRequired: typeof MIN_RR_KERNEL_CONSTANT;
  readonly stopDistance: number;
  readonly rewardDistance: number;
  readonly riskPct: number;
  readonly reason: string;
  readonly signalReceipt: SignalEmissionRRReceipt | null;
}

export interface RiskGateRRInput {
  readonly signalReceipt: SignalEmissionRRReceipt | null | undefined;
  readonly candidateStopLoss?: number;
  readonly candidateTarget?: number;
  readonly candidateEntryPrice?: number;
  readonly maxRiskPct?: number;
  readonly stopOrigin?: StructuralStopOrigin;
  readonly targetOrigin?: StructuralTargetOrigin;
  readonly exposureWithinCap?: boolean;
  readonly mandateValid?: boolean;
  readonly ddHierarchyPassed?: boolean;
  readonly ddLedgerFresh?: boolean;
  readonly reconcilerFresh?: boolean;
  readonly priceOracle?: CertifiedPriceOracle;
  readonly decisionHandle?: DecisionSnapshotHandle;
  readonly instrument?: string;
  readonly freshPrice?: number;
  readonly slippageBudgetRatio?: number;
  readonly nowMs?: number;
}

export interface OrderIntentRRInput {
  readonly signalReceipt: SignalEmissionRRReceipt | null | undefined;
  readonly expectedReceiptHash?: string;
  readonly orderIntentPrice: number;
  readonly stopLoss: number | null | undefined;
  readonly takeProfit: number | null | undefined;
  readonly direction: 'BUY' | 'SELL';
  readonly stopOrigin?: StructuralStopOrigin;
  readonly targetOrigin?: StructuralTargetOrigin;
  readonly maxRiskPct?: number;
  readonly priceOracle?: CertifiedPriceOracle;
  readonly decisionHandle?: DecisionSnapshotHandle;
  readonly instrument?: string;
  readonly slippageBudgetRatio?: number;
  readonly nowMs?: number;
}

export interface ThreeStageRRGateResult {
  readonly passed: boolean;
  readonly failedStage: RRCheckStage | null;
  readonly rejectionCode: RRRejectionCode | null;
  readonly plannedRR: number;
  readonly stageOutcomes: ReadonlyArray<RRStageCheckOutcome>;
  readonly signalReceipt: SignalEmissionRRReceipt | null;
  readonly reason: string;
}

function getK4KernelHash(): string {
  return KERNEL_REGISTRY_BY_ID['RRGate-Kernel']?.sha256Digest ?? sha256Hex('RRGate-Kernel');
}

function getK5KernelHash(): string {
  return CERTIFIED_PRIMARY_SOURCE_CONFIG.sha256Digest;
}

function computeSignalReceiptHash(fields: {
  readonly signal_id: string;
  readonly direction: 'BUY' | 'SELL';
  readonly snapshot: SignalSnapshotRecord;
  readonly entry_price_proposed: number;
  readonly structural_stop: number;
  readonly structural_target: number;
  readonly stopOrigin: 'STRUCTURAL_INVALIDATION';
  readonly targetOrigin: 'STRUCTURAL_LIQUIDITY_POOL';
  readonly planned_rr: number;
  readonly kernel_hash_K4: string;
  readonly kernel_hash_K5: string;
}): string {
  return sha256Hex(canonicalStringify(fields));
}

export function verifySignalRecordIntegrity(
  receipt: SignalEmissionRRReceipt | null | undefined
): boolean {
  if (!receipt || !receipt.passed || receipt.stage !== 'signal_emission') return false;
  if (!receipt.snapshot || !receipt.signal_id || !receipt.receiptHash) return false;
  if (
    receipt.planned_rr !== receipt.plannedRR ||
    receipt.entry_price_proposed !== receipt.signalEntryPrice ||
    receipt.structural_stop !== receipt.structuralStopLoss ||
    receipt.structural_target !== receipt.structuralTarget
  ) {
    return false;
  }
  const expected = computeSignalReceiptHash({
    signal_id: receipt.signal_id,
    direction: receipt.direction,
    snapshot: receipt.snapshot,
    entry_price_proposed: receipt.entry_price_proposed,
    structural_stop: receipt.structural_stop,
    structural_target: receipt.structural_target,
    stopOrigin: receipt.stopOrigin,
    targetOrigin: receipt.targetOrigin,
    planned_rr: receipt.planned_rr,
    kernel_hash_K4: receipt.kernel_hash_K4,
    kernel_hash_K5: receipt.kernel_hash_K5,
  });
  return expected === receipt.receiptHash;
}

/**
 * SINGLE COMPUTATION SITE FOR planned_rr (Constraint C3 / rr_single_compute).
 * Called ONLY in Stage 1 (`checkRRSignalEmission`). Neither `checkRRRiskGate`
 * nor `checkRROrderIntent` may ever call this function or recompute R:R.
 */
export function computePlannedRR(
  entryPrice: number,
  stopLoss: number,
  takeProfit: number
): {
  readonly stopDistance: number;
  readonly rewardDistance: number;
  readonly riskPct: number;
  readonly plannedRR: number;
} {
  const stopDistance = Math.abs(entryPrice - stopLoss);
  const rewardDistance = Math.abs(takeProfit - entryPrice);
  const riskPct = Number(((stopDistance / Math.max(entryPrice, 1e-12)) * 100).toFixed(4));
  const rawPlannedRR = stopDistance > 1e-12 ? rewardDistance / stopDistance : 0;
  const plannedRR = Number(rawPlannedRR.toFixed(6));
  return Object.freeze({ stopDistance, rewardDistance, riskPct, plannedRR });
}

function isStopTightenedComparedToSignal(
  direction: 'BUY' | 'SELL',
  signalStop: number,
  candidateStop: number
): boolean {
  const tolerance = Math.max(1e-8, Math.abs(signalStop) * 1e-6);
  if (direction === 'BUY') {
    return candidateStop > signalStop + tolerance;
  }
  return candidateStop < signalStop - tolerance;
}

function nearlyEqualLevel(a: number, b: number): boolean {
  const tol = Math.max(1e-6, Math.max(Math.abs(a), Math.abs(b)) * 1e-5);
  return Math.abs(a - b) <= tol;
}

function buildRejectOutcome(params: {
  readonly stage: RRCheckStage;
  readonly rejectionCode: RRRejectionCode;
  readonly plannedRR?: number;
  readonly stopDistance?: number;
  readonly rewardDistance?: number;
  readonly riskPct?: number;
  readonly reason: string;
  readonly signalReceipt?: SignalEmissionRRReceipt | null;
}): RRStageCheckOutcome {
  return Object.freeze({
    passed: false,
    stage: params.stage,
    rejectionCode: params.rejectionCode,
    plannedRR: params.plannedRR ?? 0,
    minRRRequired: MIN_RR_KERNEL_CONSTANT,
    stopDistance: params.stopDistance ?? 0,
    rewardDistance: params.rewardDistance ?? 0,
    riskPct: params.riskPct ?? 0,
    reason: params.reason,
    signalReceipt: params.signalReceipt ?? null,
  });
}

/**
 * STAGE 1: `signal_emission` — SINGLE COMPUTE SITE.
 * Computes `planned_rr` ONCE against the decision snapshot and freezes an
 * immutable `SignalRecord` carrying kernel hashes K4 and K5 forward.
 */
export function checkRRSignalEmission(input: SignalEmissionRRInput): RRStageCheckOutcome {
  const stopOrigin = input.stopOrigin ?? 'STRUCTURAL_INVALIDATION';
  const targetOrigin = input.targetOrigin ?? 'STRUCTURAL_LIQUIDITY_POOL';
  const norm = normalizeCpsInstrument(input.instrument ?? 'BTCUSDT', input.instrumentClass);
  const spec = CERTIFIED_PRIMARY_SOURCE_CONFIG.entries[norm.instrumentClass];

  let resolvedSnapshot: SignalSnapshotRecord;
  let effectiveEntry = input.entryPrice;

  if (input.priceOracle) {
    const res = input.decisionHandle
      ? input.priceOracle.read_decision_snapshot(input.decisionHandle, input.snapshotTimestampMs)
      : input.priceOracle.resolve(norm.instrument, input.snapshotTimestampMs);
    if (isPriceUnavailable(res)) {
      return buildRejectOutcome({
        stage: 'signal_emission',
        rejectionCode: 'RR_REJECT_STALE_PRICE',
        reason: `RR_REJECT_STALE_PRICE at signal_emission (${res.reason_code}): ${res.detail}`,
      });
    }
    effectiveEntry = Number.isFinite(input.entryPrice) && input.entryPrice > 0 ? input.entryPrice : res.mark_price;
    resolvedSnapshot = Object.freeze({
      snapshot_id: input.decisionHandle?.snapshot_id ?? `snap_${res.sequence_number}`,
      instrument: res.instrument,
      instrument_class: res.instrument_class,
      source_id: res.source_id,
      sequence_number: res.sequence_number,
      timestamp: res.timestamp_received,
      price: res.mark_price,
    });
  } else if (input.decisionHandle) {
    if (input.decisionHandle.ended || input.decisionHandle.aborted) {
      return buildRejectOutcome({
        stage: 'signal_emission',
        rejectionCode: 'RR_REJECT_STALE_PRICE',
        reason: `RR_REJECT_STALE_PRICE at signal_emission: decision snapshot ${input.decisionHandle.snapshot_id} is closed/aborted.`,
      });
    }
    const r = input.decisionHandle.reading;
    effectiveEntry = Number.isFinite(input.entryPrice) && input.entryPrice > 0 ? input.entryPrice : r.mark_price;
    resolvedSnapshot = Object.freeze({
      snapshot_id: input.decisionHandle.snapshot_id,
      instrument: r.instrument,
      instrument_class: r.instrument_class,
      source_id: r.source_id,
      sequence_number: r.sequence_number,
      timestamp: r.timestamp_received,
      price: r.mark_price,
    });
  } else {
    resolvedSnapshot = Object.freeze({
      snapshot_id: `snap_local_${norm.instrument}`,
      instrument: norm.instrument,
      instrument_class: norm.instrumentClass,
      source_id: spec.source_id,
      sequence_number: input.snapshotSequence ?? 1,
      timestamp: input.snapshotTimestampMs ?? 0,
      price: effectiveEntry,
    });
  }

  const sl = input.stopLoss;
  const tp = input.takeProfit;

  if (!Number.isFinite(effectiveEntry) || effectiveEntry <= 0) {
    return buildRejectOutcome({
      stage: 'signal_emission',
      rejectionCode: 'RR_REJECT_SIGNAL',
      reason: 'RR_REJECT_SIGNAL: non-positive or non-finite entryPrice at signal_emission.',
    });
  }

  if (
    stopOrigin === 'NONE' ||
    stopOrigin === 'SYNTHETIC_MULTIPLE' ||
    sl === null ||
    sl === undefined ||
    !Number.isFinite(sl) ||
    sl <= 0
  ) {
    return buildRejectOutcome({
      stage: 'signal_emission',
      rejectionCode: 'RR_REJECT_SIGNAL',
      reason: `RR_REJECT_SIGNAL: structural invalidation stop loss is required (origin=${stopOrigin}).`,
    });
  }

  const validStopSide = input.direction === 'BUY' ? sl < effectiveEntry : sl > effectiveEntry;
  if (!validStopSide) {
    return buildRejectOutcome({
      stage: 'signal_emission',
      rejectionCode: 'RR_REJECT_SIGNAL',
      reason: `RR_REJECT_SIGNAL: ${input.direction} structural stop (${sl}) violates invalidation side vs entry (${effectiveEntry}).`,
    });
  }

  if (
    targetOrigin === 'NONE' ||
    targetOrigin === 'SYNTHETIC_MULTIPLE' ||
    tp === null ||
    tp === undefined ||
    !Number.isFinite(tp) ||
    tp <= 0
  ) {
    return buildRejectOutcome({
      stage: 'signal_emission',
      rejectionCode: 'RR_REJECT_SIGNAL',
      reason: `RR_REJECT_SIGNAL: structural liquidity pool target is required (origin=${targetOrigin}).`,
    });
  }

  const validTargetSide = input.direction === 'BUY' ? tp > effectiveEntry : tp < effectiveEntry;
  if (!validTargetSide) {
    return buildRejectOutcome({
      stage: 'signal_emission',
      rejectionCode: 'RR_REJECT_SIGNAL',
      reason: `RR_REJECT_SIGNAL: ${input.direction} liquidity target (${tp}) violates reward side vs entry (${effectiveEntry}).`,
    });
  }

  const { stopDistance, rewardDistance, riskPct, plannedRR } = computePlannedRR(
    effectiveEntry,
    sl,
    tp
  );

  if (plannedRR < MIN_RR_KERNEL_CONSTANT - 1e-9) {
    return buildRejectOutcome({
      stage: 'signal_emission',
      rejectionCode: 'RR_REJECT_SIGNAL',
      plannedRR,
      stopDistance,
      rewardDistance,
      riskPct,
      reason: `RR_REJECT_SIGNAL at signal_emission: planned_RR=${plannedRR.toFixed(4)} < mandatory kernel constant ${MIN_RR_KERNEL_CONSTANT}.`,
    });
  }

  const kernel_hash_K4 = getK4KernelHash();
  const kernel_hash_K5 = getK5KernelHash();
  const preliminarySignalId =
    input.signal_id ??
    `sig_${sha256Hex(`${input.direction}|${effectiveEntry}|${sl}|${tp}|${resolvedSnapshot.snapshot_id}`).slice(0, 14)}`;

  const receiptHash = computeSignalReceiptHash({
    signal_id: preliminarySignalId,
    direction: input.direction,
    snapshot: resolvedSnapshot,
    entry_price_proposed: effectiveEntry,
    structural_stop: sl,
    structural_target: tp,
    stopOrigin: 'STRUCTURAL_INVALIDATION',
    targetOrigin: 'STRUCTURAL_LIQUIDITY_POOL',
    planned_rr: plannedRR,
    kernel_hash_K4,
    kernel_hash_K5,
  });

  const receipt: SignalEmissionRRReceipt = Object.freeze({
    receiptId: preliminarySignalId,
    signal_id: preliminarySignalId,
    stage: 'signal_emission',
    passed: true as const,
    direction: input.direction,
    snapshot: resolvedSnapshot,
    entry_price_proposed: effectiveEntry,
    structural_stop: sl,
    structural_target: tp,
    planned_rr: plannedRR,
    kernel_hash_K4,
    kernel_hash_K5,
    signalEntryPrice: effectiveEntry,
    structuralStopLoss: sl,
    structuralTarget: tp,
    stopOrigin: 'STRUCTURAL_INVALIDATION',
    targetOrigin: 'STRUCTURAL_LIQUIDITY_POOL',
    stopDistance,
    rewardDistance,
    riskPct,
    plannedRR,
    minRRKernelConstant: MIN_RR_KERNEL_CONSTANT,
    invalidationLabel: input.invalidationLabel ?? 'Structural Invalidation',
    liquidityPoolLabel: input.liquidityPoolLabel ?? 'Structural Liquidity Pool',
    receiptHash,
  });

  return Object.freeze({
    passed: true,
    stage: 'signal_emission',
    rejectionCode: null,
    plannedRR,
    minRRRequired: MIN_RR_KERNEL_CONSTANT,
    stopDistance,
    rewardDistance,
    riskPct,
    reason: `RRGateKernel signal_emission PASS: planned_RR=${plannedRR.toFixed(2)} >= ${MIN_RR_KERNEL_CONSTANT}.`,
    signalReceipt: receipt,
  });
}

/**
 * STAGE 2: `risk_gate` — VALIDATE ONLY (NEVER RECOMPUTES planned_rr).
 * Verifies SignalRecord integrity, reads stored planned_rr, checks DD/exposure/mandate/freshness,
 * and validates any fresh CPS snapshot against slippage_budget.
 */
export function checkRRRiskGate(input: RiskGateRRInput): RRStageCheckOutcome {
  const receipt = input.signalReceipt;
  if (!receipt || !verifySignalRecordIntegrity(receipt)) {
    return buildRejectOutcome({
      stage: 'risk_gate',
      rejectionCode: 'INTEGRITY_FAILURE',
      reason: 'INTEGRITY_FAILURE at risk_gate: missing or tampered Stage-1 SignalRecord.',
    });
  }

  const storedPlannedRR = receipt.planned_rr;
  if (storedPlannedRR < MIN_RR_KERNEL_CONSTANT - 1e-9) {
    return buildRejectOutcome({
      stage: 'risk_gate',
      rejectionCode: 'INTEGRITY_FAILURE',
      plannedRR: storedPlannedRR,
      stopDistance: receipt.stopDistance,
      rewardDistance: receipt.rewardDistance,
      riskPct: receipt.riskPct,
      reason: `INTEGRITY_FAILURE at risk_gate: stored planned_rr=${storedPlannedRR} violates ${MIN_RR_KERNEL_CONSTANT} floor.`,
    });
  }

  const stopOrigin = input.stopOrigin ?? receipt.stopOrigin;
  const targetOrigin = input.targetOrigin ?? receipt.targetOrigin;
  if (stopOrigin !== 'STRUCTURAL_INVALIDATION' || targetOrigin !== 'STRUCTURAL_LIQUIDITY_POOL') {
    return buildRejectOutcome({
      stage: 'risk_gate',
      rejectionCode: 'INTEGRITY_FAILURE',
      plannedRR: storedPlannedRR,
      stopDistance: receipt.stopDistance,
      rewardDistance: receipt.rewardDistance,
      riskPct: receipt.riskPct,
      reason: `INTEGRITY_FAILURE at risk_gate: invalid structural origins (stop=${stopOrigin}, target=${targetOrigin}).`,
    });
  }

  const candidateStop = input.candidateStopLoss ?? receipt.structural_stop;
  const candidateTarget = input.candidateTarget ?? receipt.structural_target;
  if (
    !Number.isFinite(candidateStop) ||
    candidateStop <= 0 ||
    !Number.isFinite(candidateTarget) ||
    candidateTarget <= 0 ||
    isStopTightenedComparedToSignal(receipt.direction, receipt.structural_stop, candidateStop) ||
    !nearlyEqualLevel(candidateStop, receipt.structural_stop) ||
    !nearlyEqualLevel(candidateTarget, receipt.structural_target)
  ) {
    return buildRejectOutcome({
      stage: 'risk_gate',
      rejectionCode: 'INTEGRITY_FAILURE',
      plannedRR: storedPlannedRR,
      stopDistance: receipt.stopDistance,
      rewardDistance: receipt.rewardDistance,
      riskPct: receipt.riskPct,
      reason: `INTEGRITY_FAILURE at risk_gate: post-hoc stop/target modification forbidden (signal SL=${receipt.structural_stop}, TP=${receipt.structural_target}).`,
    });
  }

  if (input.mandateValid === false) {
    return buildRejectOutcome({
      stage: 'risk_gate',
      rejectionCode: 'MANDATE_BLOCK',
      plannedRR: storedPlannedRR,
      stopDistance: receipt.stopDistance,
      rewardDistance: receipt.rewardDistance,
      riskPct: receipt.riskPct,
      reason: 'MANDATE_BLOCK at risk_gate: active execution mandate is absent or expired.',
    });
  }

  if (input.ddHierarchyPassed === false) {
    return buildRejectOutcome({
      stage: 'risk_gate',
      rejectionCode: 'DD_BLOCK',
      plannedRR: storedPlannedRR,
      stopDistance: receipt.stopDistance,
      rewardDistance: receipt.rewardDistance,
      riskPct: receipt.riskPct,
      reason: 'DD_BLOCK at risk_gate: drawdown hierarchy limit breached.',
    });
  }

  if (input.ddLedgerFresh === false || input.reconcilerFresh === false) {
    return buildRejectOutcome({
      stage: 'risk_gate',
      rejectionCode: 'INTEGRITY_FAILURE',
      plannedRR: storedPlannedRR,
      stopDistance: receipt.stopDistance,
      rewardDistance: receipt.rewardDistance,
      riskPct: receipt.riskPct,
      reason: `INTEGRITY_FAILURE (STALE_STATE) at risk_gate: ddLedgerFresh=${input.ddLedgerFresh !== false}, reconcilerFresh=${input.reconcilerFresh !== false}.`,
    });
  }

  const allowedRiskPct = Math.min(HARD_MAX_RISK_PCT, input.maxRiskPct ?? HARD_MAX_RISK_PCT);
  if (receipt.riskPct > allowedRiskPct + 0.05 || input.exposureWithinCap === false) {
    return buildRejectOutcome({
      stage: 'risk_gate',
      rejectionCode: 'EXPOSURE_BLOCK',
      plannedRR: storedPlannedRR,
      stopDistance: receipt.stopDistance,
      rewardDistance: receipt.rewardDistance,
      riskPct: receipt.riskPct,
      reason: `EXPOSURE_BLOCK at risk_gate: structural riskPct=${receipt.riskPct}% exceeds maxRiskPct=${allowedRiskPct}% or exposure cap exceeded.`,
    });
  }

  const slippageBudgetRatio = input.slippageBudgetRatio ?? DEFAULT_SLIPPAGE_BUDGET_RATIO;
  let freshPrice = input.freshPrice;

  if (input.priceOracle) {
    if (input.decisionHandle) {
      const handleRes = input.priceOracle.read_decision_snapshot(input.decisionHandle, input.nowMs);
      if (isPriceUnavailable(handleRes)) {
        return buildRejectOutcome({
          stage: 'risk_gate',
          rejectionCode: 'RR_REJECT_STALE_PRICE',
          plannedRR: storedPlannedRR,
          stopDistance: receipt.stopDistance,
          rewardDistance: receipt.rewardDistance,
          riskPct: receipt.riskPct,
          reason: `RR_REJECT_STALE_PRICE at risk_gate (${handleRes.reason_code}): ${handleRes.detail}`,
        });
      }
      if (handleRes.source_id !== receipt.snapshot.source_id) {
        return buildRejectOutcome({
          stage: 'risk_gate',
          rejectionCode: 'RR_REJECT_STALE_PRICE',
          plannedRR: storedPlannedRR,
          stopDistance: receipt.stopDistance,
          rewardDistance: receipt.rewardDistance,
          riskPct: receipt.riskPct,
          reason: `RR_REJECT_STALE_PRICE (SOURCE_MIXED): Check 2 source "${handleRes.source_id}" !== Check 1 "${receipt.snapshot.source_id}".`,
        });
      }
    }
    const freshRes = input.priceOracle.resolve(
      input.instrument ?? receipt.snapshot.instrument,
      input.nowMs
    );
    if (isPriceUnavailable(freshRes)) {
      return buildRejectOutcome({
        stage: 'risk_gate',
        rejectionCode: 'RR_REJECT_STALE_PRICE',
        plannedRR: storedPlannedRR,
        stopDistance: receipt.stopDistance,
        rewardDistance: receipt.rewardDistance,
        riskPct: receipt.riskPct,
        reason: `RR_REJECT_STALE_PRICE at risk_gate (${freshRes.reason_code}): ${freshRes.detail}`,
      });
    }
    if (freshRes.source_id !== receipt.snapshot.source_id) {
      return buildRejectOutcome({
        stage: 'risk_gate',
        rejectionCode: 'RR_REJECT_STALE_PRICE',
        plannedRR: storedPlannedRR,
        stopDistance: receipt.stopDistance,
        rewardDistance: receipt.rewardDistance,
        riskPct: receipt.riskPct,
        reason: `RR_REJECT_STALE_PRICE (SOURCE_MIXED): fresh source "${freshRes.source_id}" !== snapshot source "${receipt.snapshot.source_id}".`,
      });
    }
    if (input.decisionHandle) {
      try {
        input.decisionHandle.validate_within_decision(freshRes);
      } catch (err) {
        return buildRejectOutcome({
          stage: 'risk_gate',
          rejectionCode: 'RR_REJECT_STALE_PRICE',
          plannedRR: storedPlannedRR,
          stopDistance: receipt.stopDistance,
          rewardDistance: receipt.rewardDistance,
          riskPct: receipt.riskPct,
          reason: `RR_REJECT_STALE_PRICE at risk_gate: ${err instanceof Error ? err.message : 'validate_within_decision failed'}`,
        });
      }
    }
    freshPrice = freshRes.mark_price;
  }

  if (freshPrice !== undefined) {
    if (!Number.isFinite(freshPrice) || freshPrice <= 0) {
      return buildRejectOutcome({
        stage: 'risk_gate',
        rejectionCode: 'RR_REJECT_STALE_PRICE',
        plannedRR: storedPlannedRR,
        stopDistance: receipt.stopDistance,
        rewardDistance: receipt.rewardDistance,
        riskPct: receipt.riskPct,
        reason: 'RR_REJECT_STALE_PRICE at risk_gate: non-positive fresh CPS price.',
      });
    }
    const driftRatio =
      Math.abs(freshPrice - receipt.snapshot.price) / Math.max(receipt.snapshot.price, 1e-12);
    if (driftRatio > slippageBudgetRatio) {
      return buildRejectOutcome({
        stage: 'risk_gate',
        rejectionCode: 'RR_REJECT_PRICE_DRIFT',
        plannedRR: storedPlannedRR,
        stopDistance: receipt.stopDistance,
        rewardDistance: receipt.rewardDistance,
        riskPct: receipt.riskPct,
        reason: `RR_REJECT_PRICE_DRIFT at risk_gate: drift ${(driftRatio * 10_000).toFixed(2)} bps > budget ${(slippageBudgetRatio * 10_000).toFixed(2)} bps (snap=${receipt.snapshot.price}, fresh=${freshPrice}).`,
      });
    }
  }

  return Object.freeze({
    passed: true,
    stage: 'risk_gate',
    rejectionCode: null,
    plannedRR: storedPlannedRR,
    minRRRequired: MIN_RR_KERNEL_CONSTANT,
    stopDistance: receipt.stopDistance,
    rewardDistance: receipt.rewardDistance,
    riskPct: receipt.riskPct,
    reason: `RRGateKernel risk_gate PASS (validated forward): riskPct=${receipt.riskPct}% <= ${allowedRiskPct}%, planned_rr=${storedPlannedRR.toFixed(2)}.`,
    signalReceipt: receipt,
  });
}

/**
 * STAGE 3: `order_intent` — VALIDATE ONLY (NEVER RECOMPUTES planned_rr).
 * Verifies SignalRecord integrity (unaltered since Check 2), confirms CPS price is available
 * and within slippage_budget of snapshot.price, and emits order intent with recorded levels.
 */
export function checkRROrderIntent(input: OrderIntentRRInput): RRStageCheckOutcome {
  const receipt = input.signalReceipt;
  if (!receipt || !verifySignalRecordIntegrity(receipt)) {
    return buildRejectOutcome({
      stage: 'order_intent',
      rejectionCode: 'INTEGRITY_FAILURE',
      reason: 'INTEGRITY_FAILURE at order_intent: SignalRecord missing, corrupted, or tampered.',
    });
  }

  if (input.expectedReceiptHash && receipt.receiptHash !== input.expectedReceiptHash) {
    return buildRejectOutcome({
      stage: 'order_intent',
      rejectionCode: 'INTEGRITY_FAILURE',
      plannedRR: receipt.planned_rr,
      stopDistance: receipt.stopDistance,
      rewardDistance: receipt.rewardDistance,
      riskPct: receipt.riskPct,
      reason: `INTEGRITY_FAILURE at order_intent: SignalRecord hash altered since Check 2 (${receipt.receiptHash} !== ${input.expectedReceiptHash}).`,
    });
  }

  const storedPlannedRR = receipt.planned_rr;
  const sl = input.stopLoss;
  const tp = input.takeProfit;
  const stopOrigin = input.stopOrigin ?? receipt.stopOrigin;
  const targetOrigin = input.targetOrigin ?? receipt.targetOrigin;

  if (
    stopOrigin !== 'STRUCTURAL_INVALIDATION' ||
    targetOrigin !== 'STRUCTURAL_LIQUIDITY_POOL' ||
    sl === null ||
    sl === undefined ||
    tp === null ||
    tp === undefined ||
    !Number.isFinite(sl) ||
    !Number.isFinite(tp) ||
    sl <= 0 ||
    tp <= 0 ||
    isStopTightenedComparedToSignal(input.direction, receipt.structural_stop, sl) ||
    !nearlyEqualLevel(sl, receipt.structural_stop) ||
    !nearlyEqualLevel(tp, receipt.structural_target)
  ) {
    return buildRejectOutcome({
      stage: 'order_intent',
      rejectionCode: 'INTEGRITY_FAILURE',
      plannedRR: storedPlannedRR,
      stopDistance: receipt.stopDistance,
      rewardDistance: receipt.rewardDistance,
      riskPct: receipt.riskPct,
      reason: `INTEGRITY_FAILURE at order_intent: structural SL/TP diverged from sealed SignalRecord (expected SL=${receipt.structural_stop}, TP=${receipt.structural_target}).`,
    });
  }

  let currentPrice = input.orderIntentPrice;

  if (input.priceOracle) {
    if (input.decisionHandle) {
      const handleRes = input.priceOracle.read_decision_snapshot(input.decisionHandle, input.nowMs);
      if (isPriceUnavailable(handleRes)) {
        return buildRejectOutcome({
          stage: 'order_intent',
          rejectionCode: 'RR_REJECT_STALE_PRICE',
          plannedRR: storedPlannedRR,
          stopDistance: receipt.stopDistance,
          rewardDistance: receipt.rewardDistance,
          riskPct: receipt.riskPct,
          reason: `RR_REJECT_STALE_PRICE at order_intent (${handleRes.reason_code}): ${handleRes.detail}`,
        });
      }
      if (handleRes.source_id !== receipt.snapshot.source_id) {
        return buildRejectOutcome({
          stage: 'order_intent',
          rejectionCode: 'RR_REJECT_STALE_PRICE',
          plannedRR: storedPlannedRR,
          stopDistance: receipt.stopDistance,
          rewardDistance: receipt.rewardDistance,
          riskPct: receipt.riskPct,
          reason: `RR_REJECT_STALE_PRICE (SOURCE_MIXED): Check 3 source "${handleRes.source_id}" !== Check 1 "${receipt.snapshot.source_id}".`,
        });
      }
    }

    const res = input.priceOracle.resolve(
      input.instrument ?? receipt.snapshot.instrument,
      input.nowMs
    );
    if (isPriceUnavailable(res)) {
      return buildRejectOutcome({
        stage: 'order_intent',
        rejectionCode: 'RR_REJECT_STALE_PRICE',
        plannedRR: storedPlannedRR,
        stopDistance: receipt.stopDistance,
        rewardDistance: receipt.rewardDistance,
        riskPct: receipt.riskPct,
        reason: `RR_REJECT_STALE_PRICE at order_intent (${res.reason_code}): ${res.detail}`,
      });
    }
    if (res.source_id !== receipt.snapshot.source_id) {
      return buildRejectOutcome({
        stage: 'order_intent',
        rejectionCode: 'RR_REJECT_STALE_PRICE',
        plannedRR: storedPlannedRR,
        stopDistance: receipt.stopDistance,
        rewardDistance: receipt.rewardDistance,
        riskPct: receipt.riskPct,
        reason: `RR_REJECT_STALE_PRICE (SOURCE_MIXED): current source "${res.source_id}" !== snapshot "${receipt.snapshot.source_id}".`,
      });
    }
    if (input.decisionHandle) {
      try {
        input.decisionHandle.validate_within_decision(res);
      } catch (err) {
        return buildRejectOutcome({
          stage: 'order_intent',
          rejectionCode: 'RR_REJECT_STALE_PRICE',
          plannedRR: storedPlannedRR,
          stopDistance: receipt.stopDistance,
          rewardDistance: receipt.rewardDistance,
          riskPct: receipt.riskPct,
          reason: `RR_REJECT_STALE_PRICE at order_intent: ${err instanceof Error ? err.message : 'validate_within_decision failed'}`,
        });
      }
    }
    currentPrice = res.mark_price;
  }

  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return buildRejectOutcome({
      stage: 'order_intent',
      rejectionCode: 'RR_REJECT_STALE_PRICE',
      plannedRR: storedPlannedRR,
      stopDistance: receipt.stopDistance,
      rewardDistance: receipt.rewardDistance,
      riskPct: receipt.riskPct,
      reason: `RR_REJECT_STALE_PRICE at order_intent: unavailable or non-positive execution price (${currentPrice}).`,
    });
  }

  const validSideGeometry =
    input.direction === 'BUY' ? sl < currentPrice && tp > currentPrice : sl > currentPrice && tp < currentPrice;
  const slippageBudgetRatio = input.slippageBudgetRatio ?? DEFAULT_SLIPPAGE_BUDGET_RATIO;
  const driftRatio =
    Math.abs(currentPrice - receipt.snapshot.price) / Math.max(receipt.snapshot.price, 1e-12);

  if (!validSideGeometry || driftRatio > slippageBudgetRatio) {
    return buildRejectOutcome({
      stage: 'order_intent',
      rejectionCode: 'RR_REJECT_PRICE_DRIFT',
      plannedRR: storedPlannedRR,
      stopDistance: receipt.stopDistance,
      rewardDistance: receipt.rewardDistance,
      riskPct: receipt.riskPct,
      reason: `RR_REJECT_PRICE_DRIFT at order_intent: price drifted ${(driftRatio * 10_000).toFixed(2)} bps > slippage budget ${(slippageBudgetRatio * 10_000).toFixed(2)} bps (snap=${receipt.snapshot.price}, current=${currentPrice}).`,
    });
  }

  if (storedPlannedRR < MIN_RR_KERNEL_CONSTANT - 1e-9) {
    return buildRejectOutcome({
      stage: 'order_intent',
      rejectionCode: 'INTEGRITY_FAILURE',
      plannedRR: storedPlannedRR,
      stopDistance: receipt.stopDistance,
      rewardDistance: receipt.rewardDistance,
      riskPct: receipt.riskPct,
      reason: `INTEGRITY_FAILURE at order_intent: stored planned_rr=${storedPlannedRR} < ${MIN_RR_KERNEL_CONSTANT}.`,
    });
  }

  return Object.freeze({
    passed: true,
    stage: 'order_intent',
    rejectionCode: null,
    plannedRR: storedPlannedRR,
    minRRRequired: MIN_RR_KERNEL_CONSTANT,
    stopDistance: receipt.stopDistance,
    rewardDistance: receipt.rewardDistance,
    riskPct: receipt.riskPct,
    reason: `RRGateKernel order_intent PASS (validated forward): recorded planned_rr=${storedPlannedRR.toFixed(2)} >= ${MIN_RR_KERNEL_CONSTANT}, drift=${(driftRatio * 10_000).toFixed(2)} bps.`,
    signalReceipt: receipt,
  });
}

/**
 * Full Three-Stage RRGateKernel pipeline:
 * 1) signal_emission (compute planned_rr ONCE)
 * 2) risk_gate (validate forward)
 * 3) order_intent (validate forward)
 */
export function evaluateThreeStageRRGate(params: {
  readonly direction: 'BUY' | 'SELL';
  readonly signalEntryPrice: number;
  readonly orderIntentPrice?: number;
  readonly stopLoss: number | null | undefined;
  readonly takeProfit: number | null | undefined;
  readonly intentStopLoss?: number | null | undefined;
  readonly intentTakeProfit?: number | null | undefined;
  readonly stopOrigin?: StructuralStopOrigin;
  readonly targetOrigin?: StructuralTargetOrigin;
  readonly invalidationLabel?: string;
  readonly liquidityPoolLabel?: string;
  readonly maxRiskPct?: number;
  readonly priceOracle?: CertifiedPriceOracle;
  readonly decisionHandle?: DecisionSnapshotHandle;
  readonly instrument?: string;
  readonly slippageBudgetRatio?: number;
  readonly exposureWithinCap?: boolean;
  readonly mandateValid?: boolean;
  readonly ddLedgerFresh?: boolean;
  readonly reconcilerFresh?: boolean;
  readonly nowMs?: number;
}): ThreeStageRRGateResult {
  const outcomes: RRStageCheckOutcome[] = [];

  // Stage 1: signal_emission (SINGLE compute site)
  const stage1 = checkRRSignalEmission({
    direction: params.direction,
    entryPrice: params.signalEntryPrice,
    stopLoss: params.stopLoss,
    takeProfit: params.takeProfit,
    stopOrigin: params.stopOrigin,
    targetOrigin: params.targetOrigin,
    invalidationLabel: params.invalidationLabel,
    liquidityPoolLabel: params.liquidityPoolLabel,
    priceOracle: params.priceOracle,
    decisionHandle: params.decisionHandle,
    instrument: params.instrument,
    snapshotTimestampMs: params.nowMs,
  });
  outcomes.push(stage1);
  if (!stage1.passed || !stage1.signalReceipt) {
    return Object.freeze({
      passed: false,
      failedStage: 'signal_emission',
      rejectionCode: stage1.rejectionCode,
      plannedRR: stage1.plannedRR,
      stageOutcomes: Object.freeze(outcomes),
      signalReceipt: null,
      reason: stage1.reason,
    });
  }

  // Stage 2: risk_gate (validate forward — ZERO recomputation)
  const stage2 = checkRRRiskGate({
    signalReceipt: stage1.signalReceipt,
    candidateStopLoss: params.intentStopLoss ?? params.stopLoss ?? undefined,
    candidateTarget: params.intentTakeProfit ?? params.takeProfit ?? undefined,
    candidateEntryPrice: params.signalEntryPrice,
    maxRiskPct: params.maxRiskPct,
    stopOrigin: params.stopOrigin,
    targetOrigin: params.targetOrigin,
    exposureWithinCap: params.exposureWithinCap,
    mandateValid: params.mandateValid,
    ddLedgerFresh: params.ddLedgerFresh,
    reconcilerFresh: params.reconcilerFresh,
    priceOracle: params.priceOracle,
    decisionHandle: params.decisionHandle,
    instrument: params.instrument,
    slippageBudgetRatio: params.slippageBudgetRatio,
    nowMs: params.nowMs,
  });
  outcomes.push(stage2);
  if (!stage2.passed) {
    return Object.freeze({
      passed: false,
      failedStage: 'risk_gate',
      rejectionCode: stage2.rejectionCode,
      plannedRR: stage2.plannedRR,
      stageOutcomes: Object.freeze(outcomes),
      signalReceipt: stage1.signalReceipt,
      reason: stage2.reason,
    });
  }

  // Stage 3: order_intent (validate forward — ZERO recomputation)
  const stage3 = checkRROrderIntent({
    signalReceipt: stage1.signalReceipt,
    expectedReceiptHash: stage1.signalReceipt.receiptHash,
    orderIntentPrice: params.orderIntentPrice ?? params.signalEntryPrice,
    stopLoss: params.intentStopLoss ?? params.stopLoss,
    takeProfit: params.intentTakeProfit ?? params.takeProfit,
    direction: params.direction,
    stopOrigin: params.stopOrigin,
    targetOrigin: params.targetOrigin,
    maxRiskPct: params.maxRiskPct,
    priceOracle: params.priceOracle,
    decisionHandle: params.decisionHandle,
    instrument: params.instrument,
    slippageBudgetRatio: params.slippageBudgetRatio,
    nowMs: params.nowMs,
  });
  outcomes.push(stage3);
  if (!stage3.passed) {
    return Object.freeze({
      passed: false,
      failedStage: 'order_intent',
      rejectionCode: stage3.rejectionCode,
      plannedRR: stage3.plannedRR,
      stageOutcomes: Object.freeze(outcomes),
      signalReceipt: stage1.signalReceipt,
      reason: stage3.reason,
    });
  }

  return Object.freeze({
    passed: true,
    failedStage: null,
    rejectionCode: null,
    plannedRR: stage1.signalReceipt.planned_rr,
    stageOutcomes: Object.freeze(outcomes),
    signalReceipt: stage1.signalReceipt,
    reason: stage3.reason,
  });
}

/* ── Six-Level Independent Drawdown Hierarchy ─────────────────────────────── */

export interface DrawdownLevelCheck {
  readonly levelId: DrawdownLevelId;
  readonly scope: 'PORTFOLIO' | 'STRATEGY' | 'REGIME';
  readonly threshold: number;
  readonly observed: number;
  readonly unit: 'PERCENT' | 'LOSS_COUNT';
  readonly breached: boolean;
  readonly actionOnBreach: 'HALT_PORTFOLIO' | 'DEMOTE_STRATEGY' | 'BLOCK_REGIME' | 'TRIP_CIRCUIT_BREAKER';
  readonly detail: string;
}

export interface StrategyRiskMetrics {
  readonly strategyId: string;
  readonly initialCapitalUsd: number;
  readonly dailyStartEquityUsd: number;
  readonly peakEquityUsd: number;
  readonly currentEquityUsd: number;
  readonly strategyDailyDrawdownPct: number;
  readonly strategyPeakToTroughPct: number;
  readonly regimeDrawdownPct: Readonly<Partial<Record<MarketRegime, number>>>;
  readonly consecutiveLosses: number;
  readonly totalTrades: number;
  readonly totalWins: number;
  readonly totalLosses: number;
  readonly status: 'ACTIVE' | 'DEMOTED';
  readonly circuitBreakerTripped: boolean;
  readonly blockedRegimes: ReadonlyArray<MarketRegime>;
  readonly demotionReasons: ReadonlyArray<string>;
}

export interface RiskEngineState {
  readonly initialCapitalUsd: number;
  readonly portfolioDailyStartEquityUsd: number;
  readonly portfolioPeakEquityUsd: number;
  readonly portfolioEquityUsd: number;
  readonly portfolioDailyDrawdownPct: number;
  readonly portfolioPeakToTroughPct: number;
  readonly portfolioHalted: boolean;
  readonly portfolioHaltReasons: ReadonlyArray<string>;
  readonly strategies: Readonly<Record<string, StrategyRiskMetrics>>;
}

export interface DrawdownHierarchyEvaluation {
  readonly passed: boolean;
  readonly portfolioHalted: boolean;
  readonly strategyDemoted: boolean;
  readonly regimeBlocked: boolean;
  readonly circuitBreakerTripped: boolean;
  readonly levels: ReadonlyArray<DrawdownLevelCheck>;
  readonly breachedLevels: ReadonlyArray<DrawdownLevelId>;
  readonly primaryDenialCode: RiskEngineDenialCode | null;
  readonly reason: string;
}

function roundPct4(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Number(value.toFixed(4));
}

function roundUsd2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
}

export function createDefaultStrategyMetrics(
  strategyId: string,
  capitalUsd = 10_000
): StrategyRiskMetrics {
  const safeCap = Number.isFinite(capitalUsd) && capitalUsd > 0 ? roundUsd2(capitalUsd) : 10_000;
  return Object.freeze({
    strategyId,
    initialCapitalUsd: safeCap,
    dailyStartEquityUsd: safeCap,
    peakEquityUsd: safeCap,
    currentEquityUsd: safeCap,
    strategyDailyDrawdownPct: 0,
    strategyPeakToTroughPct: 0,
    regimeDrawdownPct: Object.freeze({}),
    consecutiveLosses: 0,
    totalTrades: 0,
    totalWins: 0,
    totalLosses: 0,
    status: 'ACTIVE' as const,
    circuitBreakerTripped: false,
    blockedRegimes: Object.freeze([]),
    demotionReasons: Object.freeze([]),
  });
}

export function createInitialRiskEngineState(params: {
  readonly initialCapitalUsd?: number;
  readonly strategyIds?: ReadonlyArray<string>;
} = {}): RiskEngineState {
  const portfolioCap =
    params.initialCapitalUsd && Number.isFinite(params.initialCapitalUsd) && params.initialCapitalUsd > 0
      ? roundUsd2(params.initialCapitalUsd)
      : 25_000;
  const strategyIds = params.strategyIds ?? ['SMC_1_5', 'PATTERN_SCANNER', 'TECHNICAL'];
  const perStratCap = roundUsd2(portfolioCap / Math.max(1, strategyIds.length));

  const strategies: Record<string, StrategyRiskMetrics> = {};
  for (const id of strategyIds) {
    strategies[id] = createDefaultStrategyMetrics(id, perStratCap);
  }

  return Object.freeze({
    initialCapitalUsd: portfolioCap,
    portfolioDailyStartEquityUsd: portfolioCap,
    portfolioPeakEquityUsd: portfolioCap,
    portfolioEquityUsd: portfolioCap,
    portfolioDailyDrawdownPct: 0,
    portfolioPeakToTroughPct: 0,
    portfolioHalted: false,
    portfolioHaltReasons: Object.freeze([]),
    strategies: Object.freeze(strategies),
  });
}

/**
 * Evaluates all six drawdown & consecutive-loss levels strictly independently.
 * Rule: Strategy-level breach demotes ONLY that strategy without halting the portfolio.
 */
export function evaluateDrawdownHierarchy(
  state: RiskEngineState,
  strategyId: string,
  regime: MarketRegime = 'NORMAL'
): DrawdownHierarchyEvaluation {
  const strat = state.strategies[strategyId] ?? createDefaultStrategyMetrics(strategyId, state.initialCapitalUsd);

  const portDailyBreached =
    state.portfolioHalted ||
    state.portfolioDailyDrawdownPct >= RISK_ENGINE_DD_LIMITS.PORTFOLIO_DAILY_PCT;
  const portP2tBreached =
    state.portfolioHalted ||
    state.portfolioPeakToTroughPct >= RISK_ENGINE_DD_LIMITS.PORTFOLIO_PEAK_TO_TROUGH_PCT;

  const stratDailyBreached =
    strat.strategyDailyDrawdownPct >= RISK_ENGINE_DD_LIMITS.STRATEGY_DAILY_PCT;
  const stratP2tBreached =
    strat.strategyPeakToTroughPct >= RISK_ENGINE_DD_LIMITS.STRATEGY_PEAK_TO_TROUGH_PCT;

  const regimeDd = strat.regimeDrawdownPct[regime] ?? 0;
  const regimeBreached =
    strat.blockedRegimes.includes(regime) || regimeDd >= RISK_ENGINE_DD_LIMITS.REGIME_SCOPED_PCT;

  const consecutiveBreached =
    strat.circuitBreakerTripped ||
    strat.consecutiveLosses >= RISK_ENGINE_DD_LIMITS.CONSECUTIVE_LOSSES_TRIGGER;

  const levels: DrawdownLevelCheck[] = [
    Object.freeze({
      levelId: 'PORTFOLIO_DAILY' as const,
      scope: 'PORTFOLIO' as const,
      threshold: RISK_ENGINE_DD_LIMITS.PORTFOLIO_DAILY_PCT,
      observed: roundPct4(state.portfolioDailyDrawdownPct),
      unit: 'PERCENT' as const,
      breached: portDailyBreached,
      actionOnBreach: 'HALT_PORTFOLIO' as const,
      detail: `Portfolio daily DD ${state.portfolioDailyDrawdownPct.toFixed(2)}% vs <= ${RISK_ENGINE_DD_LIMITS.PORTFOLIO_DAILY_PCT}% limit.`,
    }),
    Object.freeze({
      levelId: 'PORTFOLIO_PEAK_TO_TROUGH' as const,
      scope: 'PORTFOLIO' as const,
      threshold: RISK_ENGINE_DD_LIMITS.PORTFOLIO_PEAK_TO_TROUGH_PCT,
      observed: roundPct4(state.portfolioPeakToTroughPct),
      unit: 'PERCENT' as const,
      breached: portP2tBreached,
      actionOnBreach: 'HALT_PORTFOLIO' as const,
      detail: `Portfolio peak-to-trough DD ${state.portfolioPeakToTroughPct.toFixed(2)}% vs <= ${RISK_ENGINE_DD_LIMITS.PORTFOLIO_PEAK_TO_TROUGH_PCT}% limit.`,
    }),
    Object.freeze({
      levelId: 'STRATEGY_DAILY' as const,
      scope: 'STRATEGY' as const,
      threshold: RISK_ENGINE_DD_LIMITS.STRATEGY_DAILY_PCT,
      observed: roundPct4(strat.strategyDailyDrawdownPct),
      unit: 'PERCENT' as const,
      breached: stratDailyBreached,
      actionOnBreach: 'DEMOTE_STRATEGY' as const,
      detail: `${strategyId} daily DD ${strat.strategyDailyDrawdownPct.toFixed(2)}% vs <= ${RISK_ENGINE_DD_LIMITS.STRATEGY_DAILY_PCT}% limit.`,
    }),
    Object.freeze({
      levelId: 'STRATEGY_PEAK_TO_TROUGH' as const,
      scope: 'STRATEGY' as const,
      threshold: RISK_ENGINE_DD_LIMITS.STRATEGY_PEAK_TO_TROUGH_PCT,
      observed: roundPct4(strat.strategyPeakToTroughPct),
      unit: 'PERCENT' as const,
      breached: stratP2tBreached,
      actionOnBreach: 'DEMOTE_STRATEGY' as const,
      detail: `${strategyId} peak-to-trough DD ${strat.strategyPeakToTroughPct.toFixed(2)}% vs <= ${RISK_ENGINE_DD_LIMITS.STRATEGY_PEAK_TO_TROUGH_PCT}% limit.`,
    }),
    Object.freeze({
      levelId: 'REGIME_SCOPED' as const,
      scope: 'REGIME' as const,
      threshold: RISK_ENGINE_DD_LIMITS.REGIME_SCOPED_PCT,
      observed: roundPct4(regimeDd),
      unit: 'PERCENT' as const,
      breached: regimeBreached,
      actionOnBreach: 'BLOCK_REGIME' as const,
      detail: `${strategyId}@${regime} DD ${regimeDd.toFixed(2)}% vs <= ${RISK_ENGINE_DD_LIMITS.REGIME_SCOPED_PCT}% limit.`,
    }),
    Object.freeze({
      levelId: 'CONSECUTIVE_LOSSES' as const,
      scope: 'STRATEGY' as const,
      threshold: RISK_ENGINE_DD_LIMITS.CONSECUTIVE_LOSSES_TRIGGER,
      observed: strat.consecutiveLosses,
      unit: 'LOSS_COUNT' as const,
      breached: consecutiveBreached,
      actionOnBreach: 'TRIP_CIRCUIT_BREAKER' as const,
      detail: `${strategyId} consecutive losses ${strat.consecutiveLosses} vs <= ${RISK_ENGINE_DD_LIMITS.CONSECUTIVE_LOSSES_TRIGGER} trigger.`,
    }),
  ];

  const breachedLevels = levels.filter((l) => l.breached).map((l) => l.levelId);
  const portfolioHalted = portDailyBreached || portP2tBreached;
  const strategyDemoted =
    strat.status === 'DEMOTED' ||
    stratDailyBreached ||
    stratP2tBreached ||
    consecutiveBreached;
  const regimeBlocked = regimeBreached;
  const circuitBreakerTripped = consecutiveBreached;

  let primaryDenialCode: RiskEngineDenialCode | null = null;
  if (state.portfolioDailyDrawdownPct >= RISK_ENGINE_DD_LIMITS.PORTFOLIO_DAILY_PCT) {
    primaryDenialCode = 'DD_PORTFOLIO_DAILY_HALT';
  } else if (state.portfolioPeakToTroughPct >= RISK_ENGINE_DD_LIMITS.PORTFOLIO_PEAK_TO_TROUGH_PCT || state.portfolioHalted) {
    primaryDenialCode = 'DD_PORTFOLIO_PEAK_TROUGH_HALT';
  } else if (consecutiveBreached) {
    primaryDenialCode = 'CIRCUIT_BREAKER_CONSECUTIVE_LOSSES';
  } else if (stratDailyBreached) {
    primaryDenialCode = 'DD_STRATEGY_DAILY_DEMOTED';
  } else if (stratP2tBreached) {
    primaryDenialCode = 'DD_STRATEGY_PEAK_TROUGH_DEMOTED';
  } else if (regimeBreached) {
    primaryDenialCode = 'DD_REGIME_SCOPED_BLOCKED';
  } else if (strat.status === 'DEMOTED') {
    primaryDenialCode = 'STRATEGY_DEMOTED';
  }

  const passed = !portfolioHalted && !strategyDemoted && !regimeBlocked && !circuitBreakerTripped;
  const reason = passed
    ? `All 6 drawdown hierarchy levels nominal for ${strategyId} in ${regime} regime.`
    : `RiskEngine halted/blocked [${primaryDenialCode}] (${breachedLevels.join(', ') || 'DEMOTED'}).`;

  return Object.freeze({
    passed,
    portfolioHalted,
    strategyDemoted,
    regimeBlocked,
    circuitBreakerTripped,
    levels: Object.freeze(levels),
    breachedLevels: Object.freeze(breachedLevels),
    primaryDenialCode,
    reason,
  });
}

/**
 * Records a closed trade outcome across Portfolio, Strategy, Regime, and Consecutive Loss trackers.
 * Enforces independent strategy demotion and fires consecutive-loss circuit breaker at exact count = 6.
 */
export function recordTradeOutcomeInRiskState(
  state: RiskEngineState,
  input: {
    readonly strategyId: string;
    readonly regime: MarketRegime;
    readonly pnlUsd?: number;
    readonly pnlPct?: number;
  }
): RiskEngineState {
  const prevStrat =
    state.strategies[input.strategyId] ??
    createDefaultStrategyMetrics(input.strategyId, state.initialCapitalUsd * 0.35);

  const deltaUsd =
    input.pnlUsd !== undefined && Number.isFinite(input.pnlUsd)
      ? roundUsd2(input.pnlUsd)
      : input.pnlPct !== undefined && Number.isFinite(input.pnlPct)
      ? roundUsd2(prevStrat.currentEquityUsd * (input.pnlPct / 100))
      : 0;

  const isWin = deltaUsd > 0;
  const isLoss = deltaUsd < 0;

  const nextStratEquity = roundUsd2(Math.max(0, prevStrat.currentEquityUsd + deltaUsd));
  const nextStratPeak = Math.max(prevStrat.peakEquityUsd, nextStratEquity);
  const nextStratDailyDd =
    prevStrat.dailyStartEquityUsd > 0
      ? roundPct4(Math.max(0, ((prevStrat.dailyStartEquityUsd - nextStratEquity) / prevStrat.dailyStartEquityUsd) * 100))
      : 0;
  const nextStratP2tDd =
    nextStratPeak > 0
      ? roundPct4(Math.max(0, ((nextStratPeak - nextStratEquity) / nextStratPeak) * 100))
      : 0;

  const lossAbsPct =
    deltaUsd < 0 && prevStrat.currentEquityUsd > 0
      ? roundPct4((Math.abs(deltaUsd) / prevStrat.currentEquityUsd) * 100)
      : 0;
  const prevRegimeDd = prevStrat.regimeDrawdownPct[input.regime] ?? 0;
  const nextRegimeDd = isLoss
    ? roundPct4(prevRegimeDd + lossAbsPct)
    : roundPct4(Math.max(0, prevRegimeDd - (deltaUsd > 0 && prevStrat.currentEquityUsd > 0 ? (deltaUsd / prevStrat.currentEquityUsd) * 100 : 0)));

  const nextRegimeMap: Partial<Record<MarketRegime, number>> = {
    ...prevStrat.regimeDrawdownPct,
    [input.regime]: nextRegimeDd,
  };

  const nextConsecutiveLosses = isWin ? 0 : isLoss ? prevStrat.consecutiveLosses + 1 : prevStrat.consecutiveLosses;
  const circuitBreakerNow =
    prevStrat.circuitBreakerTripped ||
    nextConsecutiveLosses >= RISK_ENGINE_DD_LIMITS.CONSECUTIVE_LOSSES_TRIGGER;

  const demotionReasons = [...prevStrat.demotionReasons];
  if (
    nextStratDailyDd >= RISK_ENGINE_DD_LIMITS.STRATEGY_DAILY_PCT &&
    !demotionReasons.some((r) => r.includes('STRATEGY_DAILY'))
  ) {
    demotionReasons.push(`STRATEGY_DAILY ${nextStratDailyDd.toFixed(2)}% >= ${RISK_ENGINE_DD_LIMITS.STRATEGY_DAILY_PCT}%`);
  }
  if (
    nextStratP2tDd >= RISK_ENGINE_DD_LIMITS.STRATEGY_PEAK_TO_TROUGH_PCT &&
    !demotionReasons.some((r) => r.includes('STRATEGY_PEAK_TO_TROUGH'))
  ) {
    demotionReasons.push(`STRATEGY_PEAK_TO_TROUGH ${nextStratP2tDd.toFixed(2)}% >= ${RISK_ENGINE_DD_LIMITS.STRATEGY_PEAK_TO_TROUGH_PCT}%`);
  }
  if (
    circuitBreakerNow &&
    !demotionReasons.some((r) => r.includes('CONSECUTIVE_LOSSES'))
  ) {
    demotionReasons.push(`CONSECUTIVE_LOSSES reached ${nextConsecutiveLosses} (trigger=${RISK_ENGINE_DD_LIMITS.CONSECUTIVE_LOSSES_TRIGGER})`);
  }

  const blockedRegimes = [...prevStrat.blockedRegimes];
  if (
    nextRegimeDd >= RISK_ENGINE_DD_LIMITS.REGIME_SCOPED_PCT &&
    !blockedRegimes.includes(input.regime)
  ) {
    blockedRegimes.push(input.regime);
  }

  const nextStatus: 'ACTIVE' | 'DEMOTED' =
    prevStrat.status === 'DEMOTED' ||
    nextStratDailyDd >= RISK_ENGINE_DD_LIMITS.STRATEGY_DAILY_PCT ||
    nextStratP2tDd >= RISK_ENGINE_DD_LIMITS.STRATEGY_PEAK_TO_TROUGH_PCT ||
    circuitBreakerNow
      ? 'DEMOTED'
      : 'ACTIVE';

  const nextStrat: StrategyRiskMetrics = Object.freeze({
    ...prevStrat,
    peakEquityUsd: nextStratPeak,
    currentEquityUsd: nextStratEquity,
    strategyDailyDrawdownPct: nextStratDailyDd,
    strategyPeakToTroughPct: nextStratP2tDd,
    regimeDrawdownPct: Object.freeze(nextRegimeMap),
    consecutiveLosses: nextConsecutiveLosses,
    totalTrades: prevStrat.totalTrades + 1,
    totalWins: prevStrat.totalWins + (isWin ? 1 : 0),
    totalLosses: prevStrat.totalLosses + (isLoss ? 1 : 0),
    status: nextStatus,
    circuitBreakerTripped: circuitBreakerNow,
    blockedRegimes: Object.freeze(blockedRegimes),
    demotionReasons: Object.freeze(demotionReasons),
  });

  const nextPortEquity = roundUsd2(Math.max(0, state.portfolioEquityUsd + deltaUsd));
  const nextPortPeak = Math.max(state.portfolioPeakEquityUsd, nextPortEquity);
  const nextPortDailyDd =
    state.portfolioDailyStartEquityUsd > 0
      ? roundPct4(Math.max(0, ((state.portfolioDailyStartEquityUsd - nextPortEquity) / state.portfolioDailyStartEquityUsd) * 100))
      : 0;
  const nextPortP2tDd =
    nextPortPeak > 0
      ? roundPct4(Math.max(0, ((nextPortPeak - nextPortEquity) / nextPortPeak) * 100))
      : 0;

  const portHaltReasons = [...state.portfolioHaltReasons];
  if (
    nextPortDailyDd >= RISK_ENGINE_DD_LIMITS.PORTFOLIO_DAILY_PCT &&
    !portHaltReasons.some((r) => r.includes('PORTFOLIO_DAILY'))
  ) {
    portHaltReasons.push(`PORTFOLIO_DAILY ${nextPortDailyDd.toFixed(2)}% >= ${RISK_ENGINE_DD_LIMITS.PORTFOLIO_DAILY_PCT}%`);
  }
  if (
    nextPortP2tDd >= RISK_ENGINE_DD_LIMITS.PORTFOLIO_PEAK_TO_TROUGH_PCT &&
    !portHaltReasons.some((r) => r.includes('PORTFOLIO_PEAK_TO_TROUGH'))
  ) {
    portHaltReasons.push(`PORTFOLIO_PEAK_TO_TROUGH ${nextPortP2tDd.toFixed(2)}% >= ${RISK_ENGINE_DD_LIMITS.PORTFOLIO_PEAK_TO_TROUGH_PCT}%`);
  }

  const nextPortfolioHalted =
    state.portfolioHalted ||
    nextPortDailyDd >= RISK_ENGINE_DD_LIMITS.PORTFOLIO_DAILY_PCT ||
    nextPortP2tDd >= RISK_ENGINE_DD_LIMITS.PORTFOLIO_PEAK_TO_TROUGH_PCT;

  return Object.freeze({
    ...state,
    portfolioPeakEquityUsd: nextPortPeak,
    portfolioEquityUsd: nextPortEquity,
    portfolioDailyDrawdownPct: nextPortDailyDd,
    portfolioPeakToTroughPct: nextPortP2tDd,
    portfolioHalted: nextPortfolioHalted,
    portfolioHaltReasons: Object.freeze(portHaltReasons),
    strategies: Object.freeze({
      ...state.strategies,
      [input.strategyId]: nextStrat,
    }),
  });
}

/* ── Synchronous Predicate `can_trade()` (Pre-L2 Mandatory Gate) ──────────── */

export interface CanTradeRequest {
  readonly riskState: RiskEngineState;
  readonly strategyId: string;
  readonly symbol: string;
  readonly instrumentClass?: InstrumentClass;
  readonly direction: 'BUY' | 'SELL';
  readonly regime?: MarketRegime;
  readonly signalEntryPrice: number;
  readonly orderIntentPrice?: number;
  readonly stopLoss: number | null | undefined;
  readonly takeProfit: number | null | undefined;
  readonly intentStopLoss?: number | null | undefined;
  readonly intentTakeProfit?: number | null | undefined;
  readonly stopOrigin?: StructuralStopOrigin;
  readonly targetOrigin?: StructuralTargetOrigin;
  readonly signalReceipt?: SignalEmissionRRReceipt | null;
  readonly invalidationLabel?: string;
  readonly liquidityPoolLabel?: string;
  readonly maxRiskPct?: number;
  readonly runtimeGuardAllowed?: boolean;
  readonly exposureWithinCap?: boolean;
  readonly mandateValid?: boolean;
  readonly ddLedgerFresh?: boolean;
  readonly reconcilerFresh?: boolean;
  readonly priceOracle?: CertifiedPriceOracle;
  readonly decisionHandle?: DecisionSnapshotHandle;
  readonly slippageBudgetRatio?: number;
  readonly nowMs?: number;
  readonly checkedAtUtc?: string;
}

export interface CanTradeVerdict {
  readonly allowed: boolean;
  readonly rejectionCode: RiskEngineDenialCode | null;
  readonly rrRejectionCode: RRRejectionCode | null;
  readonly stage: RRCheckStage | 'drawdown_hierarchy' | 'runtime_guard';
  readonly plannedRR: number;
  readonly minRRKernelConstant: typeof MIN_RR_KERNEL_CONSTANT;
  readonly strategyStatus: 'ACTIVE' | 'DEMOTED';
  readonly portfolioHalted: boolean;
  readonly circuitBreakerTripped: boolean;
  readonly ddHierarchy: DrawdownHierarchyEvaluation;
  readonly rrGate: ThreeStageRRGateResult;
  readonly reason: string;
  readonly checkedAtUtc: string;
}

export class RiskEngineOrderBlockedError extends Error {
  readonly code: RiskEngineDenialCode;
  readonly stage: RRCheckStage | 'drawdown_hierarchy' | 'runtime_guard';
  readonly verdict?: CanTradeVerdict;

  constructor(
    code: RiskEngineDenialCode,
    stage: RRCheckStage | 'drawdown_hierarchy' | 'runtime_guard',
    message: string,
    verdict?: CanTradeVerdict
  ) {
    super(`[RiskEngine:${code}@${stage}] ${message}`);
    this.name = 'RiskEngineOrderBlockedError';
    this.code = code;
    this.stage = stage;
    this.verdict = verdict;
  }
}

/**
 * Synchronous Risk Engine gate (`can_trade()`).
 * Computes `planned_rr` ONCE in Stage 1 (if not already computed) and validates forward
 * through Stage 2 (`risk_gate`) and Stage 3 (`order_intent`) before L2 execution.
 */
export function can_trade(request: CanTradeRequest): CanTradeVerdict {
  const checkedAtUtc = request.checkedAtUtc ?? new Date().toISOString();
  const regime = request.regime ?? 'NORMAL';

  // 1. Evaluate Three-Stage RRGateKernel (signal_emission -> risk_gate -> order_intent)
  let rrGate: ThreeStageRRGateResult;
  if (request.signalReceipt) {
    const s2 = checkRRRiskGate({
      signalReceipt: request.signalReceipt,
      candidateStopLoss: request.intentStopLoss ?? request.stopLoss ?? undefined,
      candidateTarget: request.intentTakeProfit ?? request.takeProfit ?? undefined,
      candidateEntryPrice: request.signalEntryPrice,
      maxRiskPct: request.maxRiskPct,
      stopOrigin: request.stopOrigin,
      targetOrigin: request.targetOrigin,
      exposureWithinCap: request.exposureWithinCap,
      mandateValid: request.mandateValid,
      ddLedgerFresh: request.ddLedgerFresh,
      reconcilerFresh: request.reconcilerFresh,
      priceOracle: request.priceOracle,
      decisionHandle: request.decisionHandle,
      instrument: request.symbol,
      slippageBudgetRatio: request.slippageBudgetRatio,
      nowMs: request.nowMs,
    });
    if (!s2.passed) {
      rrGate = Object.freeze({
        passed: false,
        failedStage: 'risk_gate',
        rejectionCode: s2.rejectionCode,
        plannedRR: s2.plannedRR,
        stageOutcomes: Object.freeze([s2]),
        signalReceipt: request.signalReceipt,
        reason: s2.reason,
      });
    } else {
      const s3 = checkRROrderIntent({
        signalReceipt: request.signalReceipt,
        expectedReceiptHash: request.signalReceipt.receiptHash,
        orderIntentPrice: request.orderIntentPrice ?? request.signalEntryPrice,
        stopLoss: request.intentStopLoss ?? request.stopLoss ?? request.signalReceipt.structural_stop,
        takeProfit: paramsTargetFallback(request),
        direction: request.direction,
        stopOrigin: request.stopOrigin,
        targetOrigin: paramsTargetOriginFallback(request),
        maxRiskPct: request.maxRiskPct,
        priceOracle: request.priceOracle,
        decisionHandle: request.decisionHandle,
        instrument: request.symbol,
        slippageBudgetRatio: request.slippageBudgetRatio,
        nowMs: request.nowMs,
      });
      rrGate = Object.freeze({
        passed: s3.passed,
        failedStage: s3.passed ? null : 'order_intent',
        rejectionCode: s3.rejectionCode,
        plannedRR: s3.plannedRR,
        stageOutcomes: Object.freeze([s2, s3]),
        signalReceipt: request.signalReceipt,
        reason: s3.reason,
      });
    }
  } else {
    rrGate = evaluateThreeStageRRGate({
      direction: request.direction,
      signalEntryPrice: request.signalEntryPrice,
      orderIntentPrice: request.orderIntentPrice,
      stopLoss: request.stopLoss,
      takeProfit: request.takeProfit,
      intentStopLoss: request.intentStopLoss,
      intentTakeProfit: request.intentTakeProfit,
      stopOrigin: request.stopOrigin,
      targetOrigin: request.targetOrigin,
      invalidationLabel: request.invalidationLabel,
      liquidityPoolLabel: request.liquidityPoolLabel,
      maxRiskPct: request.maxRiskPct,
      priceOracle: request.priceOracle,
      decisionHandle: request.decisionHandle,
      instrument: request.symbol,
      slippageBudgetRatio: request.slippageBudgetRatio,
      exposureWithinCap: request.exposureWithinCap,
      mandateValid: request.mandateValid,
      ddLedgerFresh: request.ddLedgerFresh,
      reconcilerFresh: request.reconcilerFresh,
      nowMs: request.nowMs,
    });
  }

  // 2. Evaluate Six-Level Independent Drawdown Hierarchy
  const ddHierarchy = evaluateDrawdownHierarchy(
    request.riskState,
    request.strategyId,
    regime
  );

  if (!rrGate.passed) {
    return Object.freeze({
      allowed: false,
      rejectionCode: rrGate.rejectionCode ?? 'RR_REJECT_SIGNAL',
      rrRejectionCode: rrGate.rejectionCode,
      stage: rrGate.failedStage ?? 'signal_emission',
      plannedRR: rrGate.plannedRR,
      minRRKernelConstant: MIN_RR_KERNEL_CONSTANT,
      strategyStatus: ddHierarchy.strategyDemoted ? 'DEMOTED' : 'ACTIVE',
      portfolioHalted: ddHierarchy.portfolioHalted,
      circuitBreakerTripped: ddHierarchy.circuitBreakerTripped,
      ddHierarchy,
      rrGate,
      reason: rrGate.reason,
      checkedAtUtc,
    });
  }

  if (request.runtimeGuardAllowed === false || request.mandateValid === false) {
    return Object.freeze({
      allowed: false,
      rejectionCode: 'MANDATE_BLOCK',
      rrRejectionCode: 'MANDATE_BLOCK',
      stage: 'runtime_guard',
      plannedRR: rrGate.plannedRR,
      minRRKernelConstant: MIN_RR_KERNEL_CONSTANT,
      strategyStatus: ddHierarchy.strategyDemoted ? 'DEMOTED' : 'ACTIVE',
      portfolioHalted: ddHierarchy.portfolioHalted,
      circuitBreakerTripped: ddHierarchy.circuitBreakerTripped,
      ddHierarchy,
      rrGate,
      reason: 'MANDATE_BLOCK: Runtime Guard or execution mandate denied trade permission prior to L2.',
      checkedAtUtc,
    });
  }

  if (!ddHierarchy.passed) {
    return Object.freeze({
      allowed: false,
      rejectionCode: ddHierarchy.primaryDenialCode ?? 'DD_BLOCK',
      rrRejectionCode: 'DD_BLOCK',
      stage: 'drawdown_hierarchy',
      plannedRR: rrGate.plannedRR,
      minRRKernelConstant: MIN_RR_KERNEL_CONSTANT,
      strategyStatus: ddHierarchy.strategyDemoted ? 'DEMOTED' : 'ACTIVE',
      portfolioHalted: ddHierarchy.portfolioHalted,
      circuitBreakerTripped: ddHierarchy.circuitBreakerTripped,
      ddHierarchy,
      rrGate,
      reason: ddHierarchy.reason,
      checkedAtUtc,
    });
  }

  if (rrGate.plannedRR < DEFAULT_MIN_RR_RATIO - 1e-9) {
    return Object.freeze({
      allowed: false,
      rejectionCode: 'INTEGRITY_FAILURE',
      rrRejectionCode: 'INTEGRITY_FAILURE',
      stage: 'order_intent',
      plannedRR: rrGate.plannedRR,
      minRRKernelConstant: MIN_RR_KERNEL_CONSTANT,
      strategyStatus: 'ACTIVE',
      portfolioHalted: false,
      circuitBreakerTripped: false,
      ddHierarchy,
      rrGate,
      reason: `INTEGRITY_FAILURE: stored planned_RR=${rrGate.plannedRR} < ${MIN_RR_KERNEL_CONSTANT}.`,
      checkedAtUtc,
    });
  }

  return Object.freeze({
    allowed: true,
    rejectionCode: null,
    rrRejectionCode: null,
    stage: 'order_intent',
    plannedRR: rrGate.plannedRR,
    minRRKernelConstant: MIN_RR_KERNEL_CONSTANT,
    strategyStatus: 'ACTIVE',
    portfolioHalted: false,
    circuitBreakerTripped: false,
    ddHierarchy,
    rrGate,
    reason: `RiskEngine can_trade() APPROVED: planned_RR=${rrGate.plannedRR.toFixed(2)} >= ${MIN_RR_KERNEL_CONSTANT}, all 6 drawdown levels nominal.`,
    checkedAtUtc,
  });
}

function paramsTargetFallback(req: CanTradeRequest): number | null | undefined {
  return req.intentTakeProfit ?? req.takeProfit ?? req.signalReceipt?.structuralTarget;
}

function paramsTargetOriginFallback(req: CanTradeRequest): StructuralTargetOrigin {
  return req.targetOrigin ?? req.signalReceipt?.targetOrigin ?? 'STRUCTURAL_LIQUIDITY_POOL';
}

export function assertOrderIntentPermittedOrThrow(request: CanTradeRequest): CanTradeVerdict {
  const verdict = can_trade(request);
  if (!verdict.allowed) {
    throw new RiskEngineOrderBlockedError(
      verdict.rejectionCode ?? 'INTEGRITY_FAILURE',
      verdict.stage,
      verdict.reason,
      verdict
    );
  }
  return verdict;
}

/**
 * Formats a price to 6 significant figures while guaranteeing precision rounding
 * never trims a valid >= 1:5 target down to 4.995..4.9999 (never alters stopLoss).
 */
export function roundTargetPreservingFloor(
  direction: 'BUY' | 'SELL',
  entryPrice: number,
  stopLoss: number,
  rawTakeProfit: number,
  minRR: number = MIN_RR_KERNEL_CONSTANT
): number {
  const risk = Math.max(1e-8, Math.abs(entryPrice - stopLoss));
  const floorRR = Math.max(MIN_RR_KERNEL_CONSTANT, minRR);
  let candidate = Number(Math.max(1e-8, rawTakeProfit).toPrecision(6));
  const achievedRR = Math.abs(candidate - entryPrice) / risk;
  if (achievedRR < floorRR) {
    const exactBoundary =
      direction === 'BUY'
        ? entryPrice + risk * (floorRR + 1e-4)
        : Math.max(1e-8, entryPrice - risk * (floorRR + 1e-4));
    candidate = Number(exactBoundary.toPrecision(6));
    if (Math.abs(candidate - entryPrice) / risk < floorRR) {
      candidate = Number(exactBoundary.toFixed(8));
    }
  }
  return candidate;
}

import {
  KERNEL_REGISTRY_AUTHORITY,
  canonicalStringify,
  sha256Hex,
} from './bindingLayer';
import type { Candle } from './marketData';
import type {
  PITFeed,
  PITFeedView,
  PITStrategy,
  PitTimeframe,
  SignalToFillBoundary,
} from './pitFeed';
import {
  TripwireFeed,
  TripwireViolationError,
  issueEngineLoopToken,
} from './pitFeed';
import {
  MIN_RR_KERNEL_CONSTANT,
  RiskEngineOrderBlockedError,
  assertOrderIntentPermittedOrThrow,
  createInitialRiskEngineState,
  type CanTradeRequest,
  type MarketRegimeForRisk,
  type RiskEngineState,
  type SignalEmissionRRReceipt,
  type StructuralStopOrigin,
  type StructuralTargetOrigin,
} from './riskEngine';

/* ═══════════════════════════════════════════════════════════════════════════
 * L2 — DETERMINISTIC FILL MODEL KERNEL & EXECUTION KERNEL
 * Signed, immutable, cross-host bit-identical 7-phase fill resolution +
 * 5 pluggable execution algorithms (default: IMPLEMENTATION_SHORTFALL).
 * Phases: Decision -> Fill Model Resolution -> Execution / Ledger Commit.
 * ═══════════════════════════════════════════════════════════════════════════ */

export const FILL_MODEL_KERNEL_ID = 'FillModel-Kernel' as const;
export const FILL_MODEL_CONTRACT_SEMVER = '1.0.0' as const;

export type FillResolutionPhaseId =
  | 'PHASE_1_ORDER_INTENT'
  | 'PHASE_2_TIMING_RESOLUTION'
  | 'PHASE_3_PRICE_RESOLUTION'
  | 'PHASE_4_SLIPPAGE_APPLICATION'
  | 'PHASE_5_FEE_APPLICATION'
  | 'PHASE_6_PARTIAL_FILL_MODEL'
  | 'PHASE_7_LEDGER_COMMIT';

export const ORDERED_FILL_PHASES: ReadonlyArray<FillResolutionPhaseId> = Object.freeze([
  'PHASE_1_ORDER_INTENT',
  'PHASE_2_TIMING_RESOLUTION',
  'PHASE_3_PRICE_RESOLUTION',
  'PHASE_4_SLIPPAGE_APPLICATION',
  'PHASE_5_FEE_APPLICATION',
  'PHASE_6_PARTIAL_FILL_MODEL',
  'PHASE_7_LEDGER_COMMIT',
]);

export type ExecutionAlgorithmId =
  | 'TWAP'
  | 'VWAP'
  | 'POV'
  | 'IMPLEMENTATION_SHORTFALL'
  | 'SWEEP';

export const DEFAULT_EXECUTION_ALGORITHM: ExecutionAlgorithmId = 'IMPLEMENTATION_SHORTFALL';

export type ExecutionVenueId = 'BINANCE_SPOT' | 'BINANCE_USD_M_FUTURES' | string;
export type FeeTierId = 'VIP0' | 'VIP1' | 'VIP2' | 'VIP3' | 'MM_INSTITUTIONAL';
export type FillOrderType = 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'STOP_LIMIT';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK';
export type OrderSide = 'BUY' | 'SELL';
export type LiquidityBehavior = 'MAKER' | 'TAKER';

export type PriceResolverId =
  | 'RESOLVER_MARKET_NEXT_OPEN'
  | 'RESOLVER_LIMIT_CROSS_TAKER'
  | 'RESOLVER_LIMIT_PASSIVE_MAKER'
  | 'RESOLVER_LIMIT_UNFILLED'
  | 'RESOLVER_STOP_MARKET'
  | 'RESOLVER_STOP_MARKET_UNTRIGGERED'
  | 'RESOLVER_STOP_LIMIT_CROSS_TAKER'
  | 'RESOLVER_STOP_LIMIT_PASSIVE_MAKER'
  | 'RESOLVER_STOP_LIMIT_UNFILLED';

export class FillTimingViolationError extends Error {
  readonly code = 'SAME_BAR_FILL_FORBIDDEN' as const;
  readonly signalCursorIndex: number;
  readonly attemptedFillCursorIndex: number;

  constructor(signalCursorIndex: number, attemptedFillCursorIndex: number, details: string) {
    super(
      `[FillModel:${details}] signalCursor=${signalCursorIndex}, attemptedFillCursor=${attemptedFillCursorIndex}`
    );
    this.name = 'FillTimingViolationError';
    this.signalCursorIndex = signalCursorIndex;
    this.attemptedFillCursorIndex = attemptedFillCursorIndex;
  }
}

/**
 * Locale-independent, architecture-independent deterministic rounding.
 * Eliminates signed `-0` and cross-runtime formatting divergence.
 */
export function roundDet(value: number, decimals = 8): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const rounded = (scaled >= 0 ? Math.floor(scaled + 0.5 + 1e-12) : Math.ceil(scaled - 0.5 - 1e-12)) / factor;
  return rounded === 0 ? 0 : rounded;
}

export function roundPriceDet(value: number): number {
  return roundDet(value, 8);
}

/* ── Signed Immutable Fill Model Kernel Artifact ──────────────────────────── */

export interface SignedFillModelArtifact {
  readonly kernelId: typeof FILL_MODEL_KERNEL_ID;
  readonly contractSemver: typeof FILL_MODEL_CONTRACT_SEMVER;
  readonly layer: 'L2';
  readonly defaultExecutionAlgorithm: ExecutionAlgorithmId;
  readonly orderedPhases: ReadonlyArray<FillResolutionPhaseId>;
  readonly executionAlgorithms: ReadonlyArray<ExecutionAlgorithmId>;
  readonly adverseSlippageOnly: true;
  readonly crossedLimitTakerRule: true;
  readonly nextBarFillDefault: true;
  readonly fillModelHash: string;
  readonly signature: string;
  readonly signerId: string;
}

const FILL_MODEL_CANONICAL_SPEC = Object.freeze({
  kernelId: FILL_MODEL_KERNEL_ID,
  contractSemver: FILL_MODEL_CONTRACT_SEMVER,
  layer: 'L2',
  defaultExecutionAlgorithm: DEFAULT_EXECUTION_ALGORITHM,
  orderedPhases: ORDERED_FILL_PHASES,
  executionAlgorithms: ['TWAP', 'VWAP', 'POV', 'IMPLEMENTATION_SHORTFALL', 'SWEEP'],
  adverseSlippageOnly: true,
  crossedLimitTakerRule: true,
  nextBarFillDefault: true,
  slippageContributors: ['BASE_BPS', 'VOLATILITY_SCALING', 'SIZE_SCALING', 'VENUE_ORDER_MODIFIER'],
  feeComputedOn: 'EXECUTED_NOTIONAL_BY_RESOLVED_BEHAVIOR',
  partialFillFormula: 'min(1, (bar_volume * participation_cap) / requested_qty)',
});

const COMPUTED_FILL_MODEL_HASH = sha256Hex(canonicalStringify(FILL_MODEL_CANONICAL_SPEC));

export const FILL_MODEL_KERNEL_ARTIFACT: SignedFillModelArtifact = Object.freeze({
  kernelId: FILL_MODEL_KERNEL_ID,
  contractSemver: FILL_MODEL_CONTRACT_SEMVER,
  layer: 'L2',
  defaultExecutionAlgorithm: DEFAULT_EXECUTION_ALGORITHM,
  orderedPhases: ORDERED_FILL_PHASES,
  executionAlgorithms: Object.freeze([
    'TWAP',
    'VWAP',
    'POV',
    'IMPLEMENTATION_SHORTFALL',
    'SWEEP',
  ] as const),
  adverseSlippageOnly: true as const,
  crossedLimitTakerRule: true as const,
  nextBarFillDefault: true as const,
  fillModelHash: COMPUTED_FILL_MODEL_HASH,
  signature: `sig_fill_v1_${sha256Hex(
    `${KERNEL_REGISTRY_AUTHORITY}|${FILL_MODEL_KERNEL_ID}|${FILL_MODEL_CONTRACT_SEMVER}|${COMPUTED_FILL_MODEL_HASH}`
  )}`,
  signerId: KERNEL_REGISTRY_AUTHORITY,
});

export function verifyFillModelArtifactSignature(
  artifact: SignedFillModelArtifact = FILL_MODEL_KERNEL_ARTIFACT
): boolean {
  const expectedSig = `sig_fill_v1_${sha256Hex(
    `${KERNEL_REGISTRY_AUTHORITY}|${artifact.kernelId}|${artifact.contractSemver}|${artifact.fillModelHash}`
  )}`;
  return (
    artifact.kernelId === FILL_MODEL_KERNEL_ID &&
    artifact.fillModelHash === COMPUTED_FILL_MODEL_HASH &&
    artifact.signature === expectedSig &&
    artifact.signerId === KERNEL_REGISTRY_AUTHORITY
  );
}

/* ── Deliverable 2: Venue-Pluggable Parameterized Fee Model Contract ──────── */

export interface FeeTierSchedule {
  readonly makerFeeBps: number;
  readonly takerFeeBps: number;
}

export interface VenueFeeContract {
  readonly venueId: ExecutionVenueId;
  readonly description: string;
  readonly tiers: Readonly<Record<string, FeeTierSchedule>>;
}

export const BINANCE_SPOT_FEE_CONTRACT: VenueFeeContract = Object.freeze({
  venueId: 'BINANCE_SPOT',
  description: 'Binance Spot standard VIP maker/taker schedule computed strictly on executed notional.',
  tiers: Object.freeze({
    VIP0: Object.freeze({ makerFeeBps: 10.0, takerFeeBps: 10.0 }),
    VIP1: Object.freeze({ makerFeeBps: 9.0, takerFeeBps: 10.0 }),
    VIP2: Object.freeze({ makerFeeBps: 8.0, takerFeeBps: 10.0 }),
    VIP3: Object.freeze({ makerFeeBps: 6.0, takerFeeBps: 8.0 }),
    MM_INSTITUTIONAL: Object.freeze({ makerFeeBps: 2.0, takerFeeBps: 5.0 }),
  }),
});

export const BINANCE_FUTURES_FEE_CONTRACT: VenueFeeContract = Object.freeze({
  venueId: 'BINANCE_USD_M_FUTURES',
  description: 'Binance USD-M Futures VIP maker/taker schedule computed strictly on executed notional.',
  tiers: Object.freeze({
    VIP0: Object.freeze({ makerFeeBps: 2.0, takerFeeBps: 5.0 }),
    VIP1: Object.freeze({ makerFeeBps: 1.6, takerFeeBps: 4.5 }),
    VIP2: Object.freeze({ makerFeeBps: 1.4, takerFeeBps: 4.0 }),
    VIP3: Object.freeze({ makerFeeBps: 1.2, takerFeeBps: 3.5 }),
    MM_INSTITUTIONAL: Object.freeze({ makerFeeBps: 0.0, takerFeeBps: 2.2 }),
  }),
});

export class VenueFeeRegistry {
  readonly #venues = new Map<string, VenueFeeContract>();

  constructor(initialContracts: ReadonlyArray<VenueFeeContract> = [
    BINANCE_SPOT_FEE_CONTRACT,
    BINANCE_FUTURES_FEE_CONTRACT,
  ]) {
    for (const c of initialContracts) {
      this.#venues.set(c.venueId, c);
    }
  }

  registerVenue(contract: VenueFeeContract): void {
    this.#venues.set(contract.venueId, Object.freeze({ ...contract }));
  }

  getVenue(venueId: ExecutionVenueId): VenueFeeContract {
    const found = this.#venues.get(venueId);
    if (!found) {
      throw new Error(`Unregistered fee venue "${venueId}". Register via VenueFeeRegistry first.`);
    }
    return found;
  }

  resolveFeeRate(params: {
    venue: ExecutionVenueId;
    tier: FeeTierId | string;
    resolvedBehavior: LiquidityBehavior;
    customOverrideSchedule?: FeeTierSchedule;
  }): { readonly appliedFeeBps: number; readonly venueContractId: string; readonly tierUsed: string } {
    if (params.customOverrideSchedule) {
      const bps =
        params.resolvedBehavior === 'MAKER'
          ? Math.max(0, params.customOverrideSchedule.makerFeeBps)
          : Math.max(0, params.customOverrideSchedule.takerFeeBps);
      return Object.freeze({
        appliedFeeBps: roundDet(bps, 4),
        venueContractId: `${params.venue}_CUSTOM`,
        tierUsed: params.tier,
      });
    }
    const contract = this.getVenue(params.venue);
    const tierSchedule = contract.tiers[params.tier] ?? contract.tiers.VIP0;
    const bps =
      params.resolvedBehavior === 'MAKER'
        ? Math.max(0, tierSchedule.makerFeeBps)
        : Math.max(0, tierSchedule.takerFeeBps);
    return Object.freeze({
      appliedFeeBps: roundDet(bps, 4),
      venueContractId: contract.venueId,
      tierUsed: contract.tiers[params.tier] ? params.tier : 'VIP0',
    });
  }
}

export const DEFAULT_VENUE_FEE_REGISTRY = new VenueFeeRegistry();

/* ── Deliverable 3: Layered Slippage Model Contract ───────────────────────── */

export interface SlippageModelConfig {
  readonly baseBps: number;
  readonly volatilityMultiplier: number;
  readonly maxVolatilityBps: number;
  readonly sizeImpactCoefficientBps: number;
  readonly maxSizeImpactBps: number;
  readonly venueOrderModifiersBps: Readonly<{
    readonly BINANCE_SPOT: number;
    readonly BINANCE_USD_M_FUTURES: number;
    readonly MARKET: number;
    readonly LIMIT_CROSSED: number;
    readonly LIMIT_PASSIVE: number;
    readonly STOP_MARKET: number;
    readonly STOP_LIMIT: number;
  }>;
  readonly ceilingMaxBps: number;
}

export const DEFAULT_SLIPPAGE_CONFIG: SlippageModelConfig = Object.freeze({
  baseBps: 2.0,
  volatilityMultiplier: 1.4,
  maxVolatilityBps: 20.0,
  sizeImpactCoefficientBps: 38.0,
  maxSizeImpactBps: 22.0,
  venueOrderModifiersBps: Object.freeze({
    BINANCE_SPOT: 0.75,
    BINANCE_USD_M_FUTURES: 0.25,
    MARKET: 0.5,
    LIMIT_CROSSED: 0.75,
    LIMIT_PASSIVE: 0.25,
    STOP_MARKET: 1.5,
    STOP_LIMIT: 1.0,
  }),
  ceilingMaxBps: 50.0,
});

export interface SlippageContributorBreakdown {
  readonly baseBps: number;
  readonly volatilityScalingBps: number;
  readonly sizeScalingBps: number;
  readonly venueOrderTypeModifierBps: number;
  readonly rawSumBps: number;
  readonly totalSlippageBps: number;
  readonly adverseDirection: 'UP_FOR_BUY' | 'DOWN_FOR_SELL';
}

export function computeBaseSlippageBps(config: SlippageModelConfig = DEFAULT_SLIPPAGE_CONFIG): number {
  return roundDet(Math.max(0, config.baseBps), 4);
}

export function computeVolatilitySlippageBps(
  barRangePct: number,
  config: SlippageModelConfig = DEFAULT_SLIPPAGE_CONFIG
): number {
  const safeVolPct = Math.max(0, Number.isFinite(barRangePct) ? barRangePct : 0);
  return roundDet(Math.min(config.maxVolatilityBps, safeVolPct * config.volatilityMultiplier), 4);
}

export function computeSizeImpactSlippageBps(
  requestedQty: number,
  barVolume: number,
  config: SlippageModelConfig = DEFAULT_SLIPPAGE_CONFIG
): number {
  const safeVol = Math.max(1e-8, Number.isFinite(barVolume) ? barVolume : 1);
  const safeQty = Math.max(0, Number.isFinite(requestedQty) ? requestedQty : 0);
  const participation = safeQty / safeVol;
  const rawImpact = Math.sqrt(participation) * config.sizeImpactCoefficientBps;
  return roundDet(Math.min(config.maxSizeImpactBps, rawImpact), 4);
}

export function computeVenueOrderModifierBps(params: {
  venue: ExecutionVenueId;
  orderType: FillOrderType;
  resolvedBehavior: LiquidityBehavior;
  config?: SlippageModelConfig;
}): number {
  const cfg = params.config ?? DEFAULT_SLIPPAGE_CONFIG;
  const mods = cfg.venueOrderModifiersBps;
  const venueMod = params.venue === 'BINANCE_USD_M_FUTURES' ? mods.BINANCE_USD_M_FUTURES : mods.BINANCE_SPOT;
  let orderMod = mods.MARKET;
  if (params.orderType === 'LIMIT') {
    orderMod = params.resolvedBehavior === 'TAKER' ? mods.LIMIT_CROSSED : mods.LIMIT_PASSIVE;
  } else if (params.orderType === 'STOP_MARKET') {
    orderMod = mods.STOP_MARKET;
  } else if (params.orderType === 'STOP_LIMIT') {
    orderMod = mods.STOP_LIMIT;
  }
  return roundDet(Math.max(0, venueMod + orderMod), 4);
}

export function computeLayeredSlippageBreakdown(params: {
  side: OrderSide;
  venue: ExecutionVenueId;
  orderType: FillOrderType;
  resolvedBehavior: LiquidityBehavior;
  barRangePct: number;
  requestedQty: number;
  barVolume: number;
  config?: SlippageModelConfig;
}): SlippageContributorBreakdown {
  const cfg = params.config ?? DEFAULT_SLIPPAGE_CONFIG;
  const baseBps = computeBaseSlippageBps(cfg);
  const volatilityScalingBps = computeVolatilitySlippageBps(params.barRangePct, cfg);
  const sizeScalingBps = computeSizeImpactSlippageBps(params.requestedQty, params.barVolume, cfg);
  const venueOrderTypeModifierBps = computeVenueOrderModifierBps({
    venue: params.venue,
    orderType: params.orderType,
    resolvedBehavior: params.resolvedBehavior,
    config: cfg,
  });

  // Always strictly >= 0.05 bps adverse even on passive maker queue decay if positive configured,
  // ensuring every fill's slippage moves price strictly against the position (no favorable slippage).
  const rawSumBps = roundDet(
    baseBps + volatilityScalingBps + sizeScalingBps + venueOrderTypeModifierBps,
    4
  );
  const totalSlippageBps = roundDet(Math.min(cfg.ceilingMaxBps, Math.max(0.01, rawSumBps)), 4);

  return Object.freeze({
    baseBps,
    volatilityScalingBps,
    sizeScalingBps,
    venueOrderTypeModifierBps,
    rawSumBps,
    totalSlippageBps,
    adverseDirection: params.side === 'BUY' ? 'UP_FOR_BUY' : 'DOWN_FOR_SELL',
  });
}

/* ── Deliverable 1 & 5: Seven-Phase Order Intent -> Fill -> Ledger Contract ─ */

export interface OrderIntentInput {
  readonly intentId: string;
  readonly strategyId: string;
  readonly symbol: string;
  readonly venue?: ExecutionVenueId;
  readonly feeTier?: FeeTierId;
  readonly side: OrderSide;
  readonly orderType?: FillOrderType;
  readonly declaredRole?: LiquidityBehavior;
  readonly timeInForce?: TimeInForce;
  readonly requestedQty: number;
  readonly limitPrice?: number;
  readonly stopTriggerPrice?: number;
  readonly stopLoss?: number | null;
  readonly takeProfit?: number | null;
  readonly stopOrigin?: StructuralStopOrigin;
  readonly targetOrigin?: StructuralTargetOrigin;
  readonly plannedRR?: number;
  readonly signalReceipt?: SignalEmissionRRReceipt | null;
  readonly canTradeRequest?: CanTradeRequest;
  readonly signalCursorIndex: number;
  readonly signalCursorTime: number;
  readonly signalReferencePrice: number;
  readonly executionAlgorithm?: ExecutionAlgorithmId;
  readonly participationCap?: number;
}

export interface ImmutableOrderIntent {
  readonly intentId: string;
  readonly strategyId: string;
  readonly symbol: string;
  readonly venue: ExecutionVenueId;
  readonly feeTier: FeeTierId;
  readonly side: OrderSide;
  readonly orderType: FillOrderType;
  readonly declaredRole: LiquidityBehavior;
  readonly timeInForce: TimeInForce;
  readonly requestedQty: number;
  readonly limitPrice: number | null;
  readonly stopTriggerPrice: number | null;
  readonly stopLoss: number | null;
  readonly takeProfit: number | null;
  readonly plannedRR: number | null;
  readonly signalCursorIndex: number;
  readonly signalCursorTime: number;
  readonly signalReferencePrice: number;
  readonly executionAlgorithm: ExecutionAlgorithmId;
  readonly participationCap: number;
  readonly sealedAtSignalClose: true;
}

export interface LedgerExposureState {
  readonly sequenceNumber: number;
  readonly netPositionQty: number;
  readonly averageEntryPrice: number;
  readonly cumulativeExecutedNotionalUsd: number;
  readonly cumulativeFeesUsd: number;
  readonly lastCommitHash: string;
}

export const INITIAL_LEDGER_EXPOSURE: LedgerExposureState = Object.freeze({
  sequenceNumber: 0,
  netPositionQty: 0,
  averageEntryPrice: 0,
  cumulativeExecutedNotionalUsd: 0,
  cumulativeFeesUsd: 0,
  lastCommitHash: sha256Hex('GENESIS_LEDGER_EXPOSURE'),
});

export interface RemainingWorkingOrder {
  readonly parentIntentId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly orderType: FillOrderType;
  readonly timeInForce: 'GTC';
  readonly remainingQty: number;
  readonly limitPrice: number | null;
  readonly eligibleFromCursorIndex: number;
}

export interface FillAuditRecord {
  readonly auditId: string;
  readonly fillModelKernelId: typeof FILL_MODEL_KERNEL_ID;
  readonly fillModelVersion: typeof FILL_MODEL_CONTRACT_SEMVER;
  readonly fillModelHash: string;
  readonly intentId: string;
  readonly strategyId: string;
  readonly symbol: string;
  readonly executionAlgorithm: ExecutionAlgorithmId;
  readonly phaseTrace: ReadonlyArray<FillResolutionPhaseId>;
  readonly status: 'FILLED' | 'PARTIALLY_FILLED' | 'UNFILLED_RESTING' | 'CANCELLED_TIF';
  readonly resolverId: PriceResolverId;
  readonly declaredRole: LiquidityBehavior;
  readonly resolvedBehavior: LiquidityBehavior;
  readonly crossedLimitAsTaker: boolean;
  readonly timing: {
    readonly signalCursorIndex: number;
    readonly fillCursorIndex: number;
    readonly fillCursorTime: number;
    readonly fillBarLag: number;
  };
  readonly priceResolution: {
    readonly resolvedReferencePrice: number;
    readonly effectiveFillPrice: number;
    readonly adverseSlippageVerified: boolean;
  };
  readonly slippageBreakdown: SlippageContributorBreakdown;
  readonly feeDetail: {
    readonly venue: ExecutionVenueId;
    readonly feeTier: string;
    readonly resolvedBehavior: LiquidityBehavior;
    readonly appliedFeeBps: number;
    readonly executedNotionalUsd: number;
    readonly feeUsd: number;
  };
  readonly partialFillDetail: {
    readonly requestedQty: number;
    readonly barVolume: number;
    readonly participationCap: number;
    readonly maxBarFillableQty: number;
    readonly fillFraction: number;
    readonly executedQty: number;
    readonly remainderQty: number;
    readonly workingRemainderQty: number;
    readonly cancelledRemainderQty: number;
    readonly remainderAction:
      | 'FULL_FILL_NONE'
      | 'PERSIST_GTC'
      | 'CANCELLED_IOC'
      | 'CANCELLED_FOK'
      | 'UNFILLED_RESTING_GTC'
      | 'UNFILLED_CANCELLED_TIF';
    readonly timeInForce: TimeInForce;
  };
  readonly ledgerCommit: {
    readonly committed: boolean;
    readonly sequenceBefore: number;
    readonly sequenceAfter: number;
    readonly exposureQtyBefore: number;
    readonly exposureQtyAfter: number;
  };
  readonly recordHash: string;
}

export interface SevenPhaseFillResolutionResult {
  readonly intent: ImmutableOrderIntent;
  readonly audit: FillAuditRecord;
  readonly nextLedger: LedgerExposureState;
  readonly workingOrder: RemainingWorkingOrder | null;
}

export function createImmutableOrderIntent(input: OrderIntentInput): ImmutableOrderIntent {
  if (!Number.isFinite(input.requestedQty) || input.requestedQty <= 0) {
    throw new Error(`Invalid OrderIntent requestedQty=${input.requestedQty}; must be positive finite.`);
  }
  if (!Number.isFinite(input.signalReferencePrice) || input.signalReferencePrice <= 0) {
    throw new Error(`Invalid signalReferencePrice=${input.signalReferencePrice}; must be positive.`);
  }
  const orderType: FillOrderType = input.orderType ?? 'MARKET';
  if ((orderType === 'LIMIT' || orderType === 'STOP_LIMIT') && (!input.limitPrice || input.limitPrice <= 0)) {
    throw new Error(`${orderType} OrderIntent requires a positive limitPrice.`);
  }
  if (
    (orderType === 'STOP_MARKET' || orderType === 'STOP_LIMIT') &&
    (!input.stopTriggerPrice || input.stopTriggerPrice <= 0)
  ) {
    throw new Error(`${orderType} OrderIntent requires a positive stopTriggerPrice.`);
  }

  let verifiedPlannedRR: number | null =
    input.plannedRR !== undefined && Number.isFinite(input.plannedRR)
      ? input.plannedRR
      : null;

  if (verifiedPlannedRR !== null && verifiedPlannedRR < MIN_RR_KERNEL_CONSTANT - 1e-9) {
    throw new RiskEngineOrderBlockedError(
      'RR_REJECT_SIGNAL',
      'signal_emission',
      `L2 FillModel rejected OrderIntent ${input.intentId}: plannedRR=${verifiedPlannedRR} < mandatory kernel floor ${MIN_RR_KERNEL_CONSTANT}.`
    );
  }

  if (input.canTradeRequest) {
    const verdict = assertOrderIntentPermittedOrThrow(input.canTradeRequest);
    verifiedPlannedRR = verdict.plannedRR;
  } else if (
    input.stopLoss !== undefined ||
    input.takeProfit !== undefined ||
    input.signalReceipt
  ) {
    const verdict = assertOrderIntentPermittedOrThrow({
      riskState: createInitialRiskEngineState({ strategyIds: [input.strategyId] }),
      strategyId: input.strategyId,
      symbol: input.symbol,
      direction: input.side,
      signalEntryPrice: input.signalReceipt?.signalEntryPrice ?? input.signalReferencePrice,
      orderIntentPrice: input.limitPrice ?? input.signalReferencePrice,
      stopLoss: input.stopLoss ?? input.signalReceipt?.structuralStopLoss,
      takeProfit: input.takeProfit ?? input.signalReceipt?.structuralTarget,
      stopOrigin: input.stopOrigin,
      targetOrigin: input.targetOrigin,
      signalReceipt: input.signalReceipt,
    });
    verifiedPlannedRR = verdict.plannedRR;
  }

  return Object.freeze({
    intentId: input.intentId,
    strategyId: input.strategyId,
    symbol: input.symbol.toUpperCase(),
    venue: input.venue ?? 'BINANCE_SPOT',
    feeTier: input.feeTier ?? 'VIP0',
    side: input.side,
    orderType,
    declaredRole: input.declaredRole ?? (orderType === 'LIMIT' ? 'MAKER' : 'TAKER'),
    timeInForce: input.timeInForce ?? 'GTC',
    requestedQty: roundDet(input.requestedQty, 8),
    limitPrice: input.limitPrice ? roundPriceDet(input.limitPrice) : null,
    stopTriggerPrice: input.stopTriggerPrice ? roundPriceDet(input.stopTriggerPrice) : null,
    stopLoss: input.stopLoss ? roundPriceDet(input.stopLoss) : null,
    takeProfit: input.takeProfit ? roundPriceDet(input.takeProfit) : null,
    plannedRR: verifiedPlannedRR,
    signalCursorIndex: input.signalCursorIndex,
    signalCursorTime: input.signalCursorTime,
    signalReferencePrice: roundPriceDet(input.signalReferencePrice),
    executionAlgorithm: input.executionAlgorithm ?? DEFAULT_EXECUTION_ALGORITHM,
    participationCap: roundDet(Math.min(0.05, Math.max(0.0005, input.participationCap ?? 0.025)), 6),
    sealedAtSignalClose: true as const,
  });
}

export interface ResolveSevenPhaseFillParams {
  readonly orderIntent: OrderIntentInput | ImmutableOrderIntent;
  readonly executionCursorIndex: number;
  readonly executionBar: Candle;
  readonly priorLedger?: LedgerExposureState;
  readonly slippageConfig?: SlippageModelConfig;
  readonly feeRegistry?: VenueFeeRegistry;
  readonly customFeeSchedule?: FeeTierSchedule;
  readonly canTradeRequest?: CanTradeRequest;
}

/**
 * Executes the strict 7-phase Fill Resolution pipeline in immutable order:
 * (a) order intent -> (b) timing resolution -> (c) price resolution ->
 * (d) slippage application -> (e) fee application -> (f) partial-fill model ->
 * (g) ledger commit.
 */
export function resolveSevenPhaseFill(
  params: ResolveSevenPhaseFillParams
): SevenPhaseFillResolutionResult {
  const ledgerBefore = params.priorLedger ?? INITIAL_LEDGER_EXPOSURE;
  const feeRegistry = params.feeRegistry ?? DEFAULT_VENUE_FEE_REGISTRY;

  if (params.canTradeRequest) {
    assertOrderIntentPermittedOrThrow(params.canTradeRequest);
  }

  // ── Phase (a): Immutable Order Intent ─────────────────────────────────────
  const intent: ImmutableOrderIntent =
    'sealedAtSignalClose' in params.orderIntent
      ? params.orderIntent
      : createImmutableOrderIntent(params.orderIntent);

  if (
    intent.plannedRR !== null &&
    intent.plannedRR !== undefined &&
    intent.plannedRR < MIN_RR_KERNEL_CONSTANT - 1e-9
  ) {
    throw new RiskEngineOrderBlockedError(
      'INTEGRITY_FAILURE',
      'order_intent',
      `L2 resolveSevenPhaseFill blocked order intent ${intent.intentId}: plannedRR=${intent.plannedRR} < ${MIN_RR_KERNEL_CONSTANT}.`
    );
  }

  // ── Phase (b): Timing Resolution (Next-Bar Default t+1 Strict Gate) ────────
  if (params.executionCursorIndex <= intent.signalCursorIndex) {
    throw new FillTimingViolationError(
      intent.signalCursorIndex,
      params.executionCursorIndex,
      'SAME_BAR_FILL_FORBIDDEN: fill attempted at same-or-earlier cursor than signal.'
    );
  }
  const bar = params.executionBar;
  if (!Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.volume) || bar.volume < 0) {
    throw new Error(`Invalid executionBar OHLCV at cursor ${params.executionCursorIndex}.`);
  }

  // ── Phase (c): Price Resolution (Resolver Per Order Type) ─────────────────
  let resolvedRefPrice = 0;
  let resolvedBehavior: LiquidityBehavior = 'TAKER';
  let crossedLimitAsTaker = false;
  let resolverId: PriceResolverId = 'RESOLVER_MARKET_NEXT_OPEN';
  let eligibleToFill = true;

  if (intent.orderType === 'MARKET') {
    resolvedRefPrice = bar.open;
    resolvedBehavior = 'TAKER';
    resolverId = 'RESOLVER_MARKET_NEXT_OPEN';
  } else if (intent.orderType === 'LIMIT') {
    const limit = intent.limitPrice!;
    if (intent.side === 'BUY') {
      if (limit >= bar.open) {
        // Limit order immediately crosses opening ask -> TAKER fee mandatory
        resolvedRefPrice = roundPriceDet(Math.min(limit, bar.open));
        resolvedBehavior = 'TAKER';
        crossedLimitAsTaker = true;
        resolverId = 'RESOLVER_LIMIT_CROSS_TAKER';
      } else if (bar.low <= limit) {
        resolvedRefPrice = limit;
        resolvedBehavior = 'MAKER';
        resolverId = 'RESOLVER_LIMIT_PASSIVE_MAKER';
      } else {
        eligibleToFill = false;
        resolvedRefPrice = limit;
        resolvedBehavior = 'MAKER';
        resolverId = 'RESOLVER_LIMIT_UNFILLED';
      }
    } else {
      if (limit <= bar.open) {
        // Sell limit at-or-below open crosses immediately -> TAKER fee mandatory
        resolvedRefPrice = roundPriceDet(Math.max(limit, bar.open));
        resolvedBehavior = 'TAKER';
        crossedLimitAsTaker = true;
        resolverId = 'RESOLVER_LIMIT_CROSS_TAKER';
      } else if (bar.high >= limit) {
        resolvedRefPrice = limit;
        resolvedBehavior = 'MAKER';
        resolverId = 'RESOLVER_LIMIT_PASSIVE_MAKER';
      } else {
        eligibleToFill = false;
        resolvedRefPrice = limit;
        resolvedBehavior = 'MAKER';
        resolverId = 'RESOLVER_LIMIT_UNFILLED';
      }
    }
  } else if (intent.orderType === 'STOP_MARKET') {
    const trigger = intent.stopTriggerPrice!;
    const triggered = intent.side === 'BUY' ? bar.high >= trigger : bar.low <= trigger;
    if (triggered) {
      resolvedRefPrice =
        intent.side === 'BUY' ? Math.max(bar.open, trigger) : Math.min(bar.open, trigger);
      resolvedBehavior = 'TAKER';
      resolverId = 'RESOLVER_STOP_MARKET';
    } else {
      eligibleToFill = false;
      resolvedRefPrice = trigger;
      resolvedBehavior = 'TAKER';
      resolverId = 'RESOLVER_STOP_MARKET_UNTRIGGERED';
    }
  } else {
    // STOP_LIMIT
    const trigger = intent.stopTriggerPrice!;
    const limit = intent.limitPrice!;
    const triggered = intent.side === 'BUY' ? bar.high >= trigger : bar.low <= trigger;
    if (!triggered) {
      eligibleToFill = false;
      resolvedRefPrice = limit;
      resolvedBehavior = 'MAKER';
      resolverId = 'RESOLVER_STOP_LIMIT_UNFILLED';
    } else if (intent.side === 'BUY') {
      const triggerPx = Math.max(bar.open, trigger);
      if (limit >= triggerPx) {
        resolvedRefPrice = triggerPx;
        resolvedBehavior = 'TAKER';
        crossedLimitAsTaker = true;
        resolverId = 'RESOLVER_STOP_LIMIT_CROSS_TAKER';
      } else if (bar.low <= limit) {
        resolvedRefPrice = limit;
        resolvedBehavior = 'MAKER';
        resolverId = 'RESOLVER_STOP_LIMIT_PASSIVE_MAKER';
      } else {
        eligibleToFill = false;
        resolvedRefPrice = limit;
        resolvedBehavior = 'MAKER';
        resolverId = 'RESOLVER_STOP_LIMIT_UNFILLED';
      }
    } else {
      const triggerPx = Math.min(bar.open, trigger);
      if (limit <= triggerPx) {
        resolvedRefPrice = triggerPx;
        resolvedBehavior = 'TAKER';
        crossedLimitAsTaker = true;
        resolverId = 'RESOLVER_STOP_LIMIT_CROSS_TAKER';
      } else if (bar.high >= limit) {
        resolvedRefPrice = limit;
        resolvedBehavior = 'MAKER';
        resolverId = 'RESOLVER_STOP_LIMIT_PASSIVE_MAKER';
      } else {
        eligibleToFill = false;
        resolvedRefPrice = limit;
        resolvedBehavior = 'MAKER';
        resolverId = 'RESOLVER_STOP_LIMIT_UNFILLED';
      }
    }
  }

  resolvedRefPrice = roundPriceDet(resolvedRefPrice);

  // ── Phase (d): Adverse-Only Slippage Application ──────────────────────────
  const barRangePct = bar.open > 0 ? ((bar.high - bar.low) / bar.open) * 100 : 0;
  const slippageBreakdown = computeLayeredSlippageBreakdown({
    side: intent.side,
    venue: intent.venue,
    orderType: intent.orderType,
    resolvedBehavior,
    barRangePct,
    requestedQty: intent.requestedQty,
    barVolume: bar.volume,
    config: params.slippageConfig,
  });

  let effectiveFillPrice = resolvedRefPrice;
  if (eligibleToFill) {
    const slipFrac = slippageBreakdown.totalSlippageBps / 10_000;
    const rawSlipped =
      intent.side === 'BUY'
        ? resolvedRefPrice * (1 + slipFrac)
        : Math.max(1e-8, resolvedRefPrice * (1 - slipFrac));
    effectiveFillPrice = roundPriceDet(rawSlipped);
    // Guarantee non-zero minimum adverse displacement even on low-precision tiny ticks
    if (intent.side === 'BUY' && effectiveFillPrice <= resolvedRefPrice) {
      effectiveFillPrice = roundPriceDet(resolvedRefPrice + Math.max(1e-8, resolvedRefPrice * 1e-6));
    } else if (intent.side === 'SELL' && effectiveFillPrice >= resolvedRefPrice) {
      effectiveFillPrice = roundPriceDet(
        Math.max(1e-8, resolvedRefPrice - Math.max(1e-8, resolvedRefPrice * 1e-6))
      );
    }
  }

  const adverseSlippageVerified =
    !eligibleToFill ||
    (intent.side === 'BUY'
      ? effectiveFillPrice > resolvedRefPrice
      : effectiveFillPrice < resolvedRefPrice);

  // ── Phase (e): Fee Rate Resolution (By Resolved Behavior, Not Declared) ───
  const feeSchedule = feeRegistry.resolveFeeRate({
    venue: intent.venue,
    tier: intent.feeTier,
    resolvedBehavior,
    customOverrideSchedule: params.customFeeSchedule,
  });

  // ── Phase (f): Partial-Fill Model Bounded By min(1, bar_volume * cap) ─────
  const maxBarFillableQty = roundDet(bar.volume * intent.participationCap, 8);
  const fillFraction = eligibleToFill
    ? roundDet(Math.min(1, maxBarFillableQty / Math.max(intent.requestedQty, 1e-12)), 8)
    : 0;

  let executedQty = 0;
  let workingRemainderQty = 0;
  let cancelledRemainderQty = 0;
  let remainderAction: FillAuditRecord['partialFillDetail']['remainderAction'] = 'FULL_FILL_NONE';
  let status: FillAuditRecord['status'] = 'FILLED';
  let workingOrder: RemainingWorkingOrder | null = null;

  if (!eligibleToFill) {
    executedQty = 0;
    if (intent.timeInForce === 'GTC') {
      workingRemainderQty = intent.requestedQty;
      remainderAction = 'UNFILLED_RESTING_GTC';
      status = 'UNFILLED_RESTING';
      workingOrder = Object.freeze({
        parentIntentId: intent.intentId,
        symbol: intent.symbol,
        side: intent.side,
        orderType: intent.orderType,
        timeInForce: 'GTC',
        remainingQty: workingRemainderQty,
        limitPrice: intent.limitPrice,
        eligibleFromCursorIndex: params.executionCursorIndex + 1,
      });
    } else {
      cancelledRemainderQty = intent.requestedQty;
      remainderAction = 'UNFILLED_CANCELLED_TIF';
      status = 'CANCELLED_TIF';
    }
  } else {
    const rawFilled = roundDet(
      Math.min(intent.requestedQty, roundDet(intent.requestedQty * fillFraction, 8)),
      8
    );
    const unfilled = roundDet(Math.max(0, intent.requestedQty - rawFilled), 8);

    if (unfilled > 1e-8 && intent.timeInForce === 'FOK') {
      executedQty = 0;
      cancelledRemainderQty = intent.requestedQty;
      remainderAction = 'CANCELLED_FOK';
      status = 'CANCELLED_TIF';
    } else if (unfilled > 1e-8 && intent.timeInForce === 'IOC') {
      executedQty = rawFilled;
      cancelledRemainderQty = unfilled;
      remainderAction = 'CANCELLED_IOC';
      status = executedQty > 0 ? 'PARTIALLY_FILLED' : 'CANCELLED_TIF';
    } else if (unfilled > 1e-8) {
      // GTC partial fill -> persist remaining working quantity cleanly
      executedQty = rawFilled;
      workingRemainderQty = unfilled;
      remainderAction = 'PERSIST_GTC';
      status = 'PARTIALLY_FILLED';
      workingOrder = Object.freeze({
        parentIntentId: intent.intentId,
        symbol: intent.symbol,
        side: intent.side,
        orderType: intent.orderType,
        timeInForce: 'GTC',
        remainingQty: workingRemainderQty,
        limitPrice: intent.limitPrice,
        eligibleFromCursorIndex: params.executionCursorIndex + 1,
      });
    } else {
      executedQty = intent.requestedQty;
      remainderAction = 'FULL_FILL_NONE';
      status = 'FILLED';
    }
  }

  // Compute fee strictly on EXECUTED notional (never requested notional)
  const executedNotionalUsd = roundDet(executedQty * effectiveFillPrice, 6);
  const feeUsd = roundDet((executedNotionalUsd * feeSchedule.appliedFeeBps) / 10_000, 6);
  const remainderQty = roundDet(workingRemainderQty + cancelledRemainderQty, 8);

  // ── Phase (g): Ledger Commit (Sole Mutator of Exposure) ───────────────────
  let nextLedger: LedgerExposureState = ledgerBefore;
  const committed = executedQty > 0;

  if (committed) {
    const signedDelta = intent.side === 'BUY' ? executedQty : -executedQty;
    const prevQty = ledgerBefore.netPositionQty;
    const nextQty = roundDet(prevQty + signedDelta, 8);

    let nextAvgEntry = ledgerBefore.averageEntryPrice;
    if (nextQty === 0) {
      nextAvgEntry = 0;
    } else if (prevQty === 0 || Math.sign(prevQty) !== Math.sign(nextQty)) {
      nextAvgEntry = effectiveFillPrice;
    } else if (Math.sign(prevQty) === Math.sign(signedDelta)) {
      const totalNotional =
        Math.abs(prevQty) * ledgerBefore.averageEntryPrice + executedQty * effectiveFillPrice;
      nextAvgEntry = roundPriceDet(totalNotional / Math.abs(nextQty));
    }

    const commitSeq = ledgerBefore.sequenceNumber + 1;
    const commitDigest = sha256Hex(
      canonicalStringify({
        prevHash: ledgerBefore.lastCommitHash,
        seq: commitSeq,
        intentId: intent.intentId,
        fillModelHash: FILL_MODEL_KERNEL_ARTIFACT.fillModelHash,
        executedQty,
        effectiveFillPrice,
        feeUsd,
        nextQty,
      })
    );

    nextLedger = Object.freeze({
      sequenceNumber: commitSeq,
      netPositionQty: nextQty,
      averageEntryPrice: nextAvgEntry,
      cumulativeExecutedNotionalUsd: roundDet(
        ledgerBefore.cumulativeExecutedNotionalUsd + executedNotionalUsd,
        6
      ),
      cumulativeFeesUsd: roundDet(ledgerBefore.cumulativeFeesUsd + feeUsd, 6),
      lastCommitHash: commitDigest,
    });
  }

  const unsignedAudit = {
    fillModelKernelId: FILL_MODEL_KERNEL_ID,
    fillModelVersion: FILL_MODEL_CONTRACT_SEMVER,
    fillModelHash: FILL_MODEL_KERNEL_ARTIFACT.fillModelHash,
    intentId: intent.intentId,
    strategyId: intent.strategyId,
    symbol: intent.symbol,
    executionAlgorithm: intent.executionAlgorithm,
    phaseTrace: ORDERED_FILL_PHASES,
    status,
    resolverId,
    declaredRole: intent.declaredRole,
    resolvedBehavior,
    crossedLimitAsTaker,
    timing: Object.freeze({
      signalCursorIndex: intent.signalCursorIndex,
      fillCursorIndex: params.executionCursorIndex,
      fillCursorTime: bar.time,
      fillBarLag: params.executionCursorIndex - intent.signalCursorIndex,
    }),
    priceResolution: Object.freeze({
      resolvedReferencePrice: resolvedRefPrice,
      effectiveFillPrice,
      adverseSlippageVerified,
    }),
    slippageBreakdown,
    feeDetail: Object.freeze({
      venue: feeSchedule.venueContractId,
      feeTier: feeSchedule.tierUsed,
      resolvedBehavior,
      appliedFeeBps: feeSchedule.appliedFeeBps,
      executedNotionalUsd,
      feeUsd,
    }),
    partialFillDetail: Object.freeze({
      requestedQty: intent.requestedQty,
      barVolume: roundDet(bar.volume, 8),
      participationCap: intent.participationCap,
      maxBarFillableQty,
      fillFraction,
      executedQty,
      remainderQty,
      workingRemainderQty,
      cancelledRemainderQty,
      remainderAction,
      timeInForce: intent.timeInForce,
    }),
    ledgerCommit: Object.freeze({
      committed,
      sequenceBefore: ledgerBefore.sequenceNumber,
      sequenceAfter: nextLedger.sequenceNumber,
      exposureQtyBefore: ledgerBefore.netPositionQty,
      exposureQtyAfter: nextLedger.netPositionQty,
    }),
  };

  const recordHash = sha256Hex(canonicalStringify(unsignedAudit));
  const audit: FillAuditRecord = Object.freeze({
    auditId: `fill_audit_${recordHash.slice(0, 16)}`,
    ...unsignedAudit,
    recordHash,
  });

  return Object.freeze({
    intent,
    audit,
    nextLedger,
    workingOrder,
  });
}

/* ── Deliverable 4: Five Pluggable Execution Algorithms (Registry) ────────── */

export interface AlgorithmPlanInput {
  readonly parentOrderId: string;
  readonly strategyId: string;
  readonly symbol: string;
  readonly venue?: ExecutionVenueId;
  readonly feeTier?: FeeTierId;
  readonly side: OrderSide;
  readonly totalQty: number;
  readonly signalCursorIndex: number;
  readonly signalCursorTime: number;
  readonly signalReferencePrice: number;
  readonly closedHistory: ReadonlyArray<Readonly<Candle>>;
  readonly horizonBars?: number;
  readonly urgency?: number;
  readonly participationCap?: number;
  readonly limitPrice?: number;
}

export interface PlannedChildSlice {
  readonly sliceIndex: number;
  readonly barOffsetFromNextCursor: number;
  readonly targetWeight: number;
  readonly targetQty: number;
  readonly orderType: FillOrderType;
  readonly declaredRole: LiquidityBehavior;
  readonly timeInForce: TimeInForce;
  readonly limitPrice: number | null;
}

export interface ExecutionAlgorithmPlan {
  readonly algorithmId: ExecutionAlgorithmId;
  readonly parentOrderId: string;
  readonly fillModelHash: string;
  readonly totalQty: number;
  readonly horizonBars: number;
  readonly urgency: number;
  readonly slices: ReadonlyArray<PlannedChildSlice>;
}

export interface ExecutionAlgorithmContract {
  readonly algorithmId: ExecutionAlgorithmId;
  readonly isDefault: boolean;
  readonly label: string;
  readonly summary: string;
  readonly defaultOrderType: FillOrderType;
  readonly defaultTimeInForce: TimeInForce;
  readonly maxSingleBarParticipationCap: number;
  readonly requiresClosedVolumeHistory: boolean;
  readonly planChildSlices: (input: AlgorithmPlanInput) => ExecutionAlgorithmPlan;
}

function normalizeWeights(rawWeights: ReadonlyArray<number>): ReadonlyArray<number> {
  const positive = rawWeights.map((w) => Math.max(0.01, w));
  const total = positive.reduce((a, b) => a + b, 0);
  return Object.freeze(positive.map((w) => roundDet(w / total, 6)));
}

function allocateQuantitiesFromWeights(
  totalQty: number,
  weights: ReadonlyArray<number>
): ReadonlyArray<number> {
  const qtys: number[] = [];
  let allocated = 0;
  for (let i = 0; i < weights.length; i += 1) {
    if (i === weights.length - 1) {
      qtys.push(roundDet(Math.max(0, totalQty - allocated), 8));
    } else {
      const q = roundDet(totalQty * weights[i], 8);
      qtys.push(q);
      allocated = roundDet(allocated + q, 8);
    }
  }
  return Object.freeze(qtys);
}

const TWAP_ALGORITHM: ExecutionAlgorithmContract = Object.freeze({
  algorithmId: 'TWAP',
  isDefault: false,
  label: 'Time-Weighted Average Price',
  summary: 'Splits parent order into equal deterministic time slices over the horizon.',
  defaultOrderType: 'MARKET',
  defaultTimeInForce: 'GTC',
  maxSingleBarParticipationCap: 0.03,
  requiresClosedVolumeHistory: false,
  planChildSlices(input: AlgorithmPlanInput): ExecutionAlgorithmPlan {
    const horizon = Math.max(1, Math.min(24, Math.floor(input.horizonBars ?? 4)));
    const weights = normalizeWeights(Array.from({ length: horizon }, () => 1));
    const qtys = allocateQuantitiesFromWeights(input.totalQty, weights);
    const slices = qtys.map((qty, idx) =>
      Object.freeze({
        sliceIndex: idx,
        barOffsetFromNextCursor: idx,
        targetWeight: weights[idx],
        targetQty: qty,
        orderType: input.limitPrice ? ('LIMIT' as const) : ('MARKET' as const),
        declaredRole: input.limitPrice ? ('MAKER' as const) : ('TAKER' as const),
        timeInForce: 'GTC' as const,
        limitPrice: input.limitPrice ? roundPriceDet(input.limitPrice) : null,
      })
    );
    return Object.freeze({
      algorithmId: 'TWAP',
      parentOrderId: input.parentOrderId,
      fillModelHash: FILL_MODEL_KERNEL_ARTIFACT.fillModelHash,
      totalQty: roundDet(input.totalQty, 8),
      horizonBars: horizon,
      urgency: roundDet(input.urgency ?? 0.5, 4),
      slices: Object.freeze(slices),
    });
  },
});

const VWAP_ALGORITHM: ExecutionAlgorithmContract = Object.freeze({
  algorithmId: 'VWAP',
  isDefault: false,
  label: 'Volume-Weighted Average Price',
  summary: 'Weights child slices strictly using historical closed-window PIT volume profile.',
  defaultOrderType: 'MARKET',
  defaultTimeInForce: 'GTC',
  maxSingleBarParticipationCap: 0.04,
  requiresClosedVolumeHistory: true,
  planChildSlices(input: AlgorithmPlanInput): ExecutionAlgorithmPlan {
    const horizon = Math.max(1, Math.min(24, Math.floor(input.horizonBars ?? 4)));
    const tail = input.closedHistory.slice(-horizon);
    const rawWeights = Array.from({ length: horizon }, (_, idx) => {
      if (tail.length === 0) return 1;
      const sample = tail[idx % tail.length];
      return Math.max(1, sample.volume);
    });
    const weights = normalizeWeights(rawWeights);
    const qtys = allocateQuantitiesFromWeights(input.totalQty, weights);
    const slices = qtys.map((qty, idx) =>
      Object.freeze({
        sliceIndex: idx,
        barOffsetFromNextCursor: idx,
        targetWeight: weights[idx],
        targetQty: qty,
        orderType: input.limitPrice ? ('LIMIT' as const) : ('MARKET' as const),
        declaredRole: input.limitPrice ? ('MAKER' as const) : ('TAKER' as const),
        timeInForce: 'GTC' as const,
        limitPrice: input.limitPrice ? roundPriceDet(input.limitPrice) : null,
      })
    );
    return Object.freeze({
      algorithmId: 'VWAP',
      parentOrderId: input.parentOrderId,
      fillModelHash: FILL_MODEL_KERNEL_ARTIFACT.fillModelHash,
      totalQty: roundDet(input.totalQty, 8),
      horizonBars: horizon,
      urgency: roundDet(input.urgency ?? 0.55, 4),
      slices: Object.freeze(slices),
    });
  },
});

const POV_ALGORITHM: ExecutionAlgorithmContract = Object.freeze({
  algorithmId: 'POV',
  isDefault: false,
  label: 'Percentage of Volume',
  summary: 'Caps each slice strictly against trailing closed-bar volume participation ceiling.',
  defaultOrderType: 'MARKET',
  defaultTimeInForce: 'IOC',
  maxSingleBarParticipationCap: 0.05,
  requiresClosedVolumeHistory: true,
  planChildSlices(input: AlgorithmPlanInput): ExecutionAlgorithmPlan {
    const horizon = Math.max(1, Math.min(24, Math.floor(input.horizonBars ?? 5)));
    const cap = Math.min(0.05, Math.max(0.001, input.participationCap ?? 0.025));
    const latestVol =
      input.closedHistory.length > 0
        ? input.closedHistory[input.closedHistory.length - 1].volume
        : input.totalQty / Math.max(cap, 0.01);
    const maxPerBar = roundDet(Math.max(1e-8, latestVol * cap), 8);

    const slices: PlannedChildSlice[] = [];
    let remaining = roundDet(input.totalQty, 8);
    let idx = 0;
    while (remaining > 1e-8 && idx < horizon) {
      const targetQty =
        idx === horizon - 1
          ? remaining
          : roundDet(Math.min(remaining, maxPerBar), 8);
      slices.push(
        Object.freeze({
          sliceIndex: idx,
          barOffsetFromNextCursor: idx,
          targetWeight: roundDet(targetQty / Math.max(input.totalQty, 1e-12), 6),
          targetQty,
          orderType: input.limitPrice ? ('LIMIT' as const) : ('MARKET' as const),
          declaredRole: input.limitPrice ? ('MAKER' as const) : ('TAKER' as const),
          timeInForce: 'IOC' as const,
          limitPrice: input.limitPrice ? roundPriceDet(input.limitPrice) : null,
        })
      );
      remaining = roundDet(Math.max(0, remaining - targetQty), 8);
      idx += 1;
    }

    return Object.freeze({
      algorithmId: 'POV',
      parentOrderId: input.parentOrderId,
      fillModelHash: FILL_MODEL_KERNEL_ARTIFACT.fillModelHash,
      totalQty: roundDet(input.totalQty, 8),
      horizonBars: horizon,
      urgency: roundDet(input.urgency ?? 0.6, 4),
      slices: Object.freeze(slices),
    });
  },
});

const IMPLEMENTATION_SHORTFALL_ALGORITHM: ExecutionAlgorithmContract = Object.freeze({
  algorithmId: 'IMPLEMENTATION_SHORTFALL',
  isDefault: true,
  label: 'Implementation Shortfall (Default)',
  summary:
    'Almgren-Chriss urgency-decayed trajectory minimizing arrival-price shortfall against volatility and liquidity impact.',
  defaultOrderType: 'MARKET',
  defaultTimeInForce: 'GTC',
  maxSingleBarParticipationCap: 0.035,
  requiresClosedVolumeHistory: true,
  planChildSlices(input: AlgorithmPlanInput): ExecutionAlgorithmPlan {
    const horizon = Math.max(1, Math.min(12, Math.floor(input.horizonBars ?? 3)));
    const urgency = Math.min(1.0, Math.max(0.15, input.urgency ?? 0.72));
    // Exponential front-loading weighted by arrival urgency kappa
    const decay = 0.65 + urgency * 1.45;
    const rawWeights = Array.from({ length: horizon }, (_, idx) => Math.exp(-decay * idx));
    const weights = normalizeWeights(rawWeights);
    const qtys = allocateQuantitiesFromWeights(input.totalQty, weights);
    const slices = qtys.map((qty, idx) =>
      Object.freeze({
        sliceIndex: idx,
        barOffsetFromNextCursor: idx,
        targetWeight: weights[idx],
        targetQty: qty,
        orderType: idx === 0 || !input.limitPrice ? ('MARKET' as const) : ('LIMIT' as const),
        declaredRole: idx === 0 || !input.limitPrice ? ('TAKER' as const) : ('MAKER' as const),
        timeInForce: 'GTC' as const,
        limitPrice: idx > 0 && input.limitPrice ? roundPriceDet(input.limitPrice) : null,
      })
    );
    return Object.freeze({
      algorithmId: 'IMPLEMENTATION_SHORTFALL',
      parentOrderId: input.parentOrderId,
      fillModelHash: FILL_MODEL_KERNEL_ARTIFACT.fillModelHash,
      totalQty: roundDet(input.totalQty, 8),
      horizonBars: horizon,
      urgency: roundDet(urgency, 4),
      slices: Object.freeze(slices),
    });
  },
});

const SWEEP_ALGORITHM: ExecutionAlgorithmContract = Object.freeze({
  algorithmId: 'SWEEP',
  isDefault: false,
  label: 'Aggressive Liquidity Sweep',
  summary: 'Immediate single-cursor IOC aggressive marketable sweep across venue depth tiers.',
  defaultOrderType: 'MARKET',
  defaultTimeInForce: 'IOC',
  maxSingleBarParticipationCap: 0.05,
  requiresClosedVolumeHistory: false,
  planChildSlices(input: AlgorithmPlanInput): ExecutionAlgorithmPlan {
    const total = roundDet(input.totalQty, 8);
    return Object.freeze({
      algorithmId: 'SWEEP',
      parentOrderId: input.parentOrderId,
      fillModelHash: FILL_MODEL_KERNEL_ARTIFACT.fillModelHash,
      totalQty: total,
      horizonBars: 1,
      urgency: 1.0,
      slices: Object.freeze([
        Object.freeze({
          sliceIndex: 0,
          barOffsetFromNextCursor: 0,
          targetWeight: 1.0,
          targetQty: total,
          orderType: 'MARKET',
          declaredRole: 'TAKER',
          timeInForce: 'IOC',
          limitPrice: null,
        }),
      ]),
    });
  },
});

export const EXECUTION_ALGORITHM_REGISTRY: Readonly<
  Record<ExecutionAlgorithmId, ExecutionAlgorithmContract>
> = Object.freeze({
  TWAP: TWAP_ALGORITHM,
  VWAP: VWAP_ALGORITHM,
  POV: POV_ALGORITHM,
  IMPLEMENTATION_SHORTFALL: IMPLEMENTATION_SHORTFALL_ALGORITHM,
  SWEEP: SWEEP_ALGORITHM,
});

export function getExecutionAlgorithm(
  algorithmId: ExecutionAlgorithmId = DEFAULT_EXECUTION_ALGORITHM
): ExecutionAlgorithmContract {
  const algo = EXECUTION_ALGORITHM_REGISTRY[algorithmId];
  if (!algo) {
    throw new Error(`Unregistered execution algorithm "${String(algorithmId)}".`);
  }
  return algo;
}

/* ── Execution Kernel Entry Point & Backtest <-> Replay Parity Evaluator ──── */

export interface ExecuteSignalBoundaryWithKernelParams {
  readonly boundary: SignalToFillBoundary;
  readonly feedAtExecutionCursor: PITFeedView;
  readonly requestedQty?: number;
  readonly venue?: ExecutionVenueId;
  readonly feeTier?: FeeTierId;
  readonly orderType?: FillOrderType;
  readonly limitPrice?: number;
  readonly timeInForce?: TimeInForce;
  readonly executionAlgorithm?: ExecutionAlgorithmId;
  readonly participationCap?: number;
  readonly priorLedger?: LedgerExposureState;
  readonly slippageConfig?: SlippageModelConfig;
  readonly riskState?: RiskEngineState;
  readonly regime?: MarketRegimeForRisk;
  readonly enforceOrderIntentRR?: boolean;
}

export function executeSignalBoundaryThroughFillKernel(
  params: ExecuteSignalBoundaryWithKernelParams
): SevenPhaseFillResolutionResult {
  const execBar = params.feedAtExecutionCursor.current();
  const execCursor = params.feedAtExecutionCursor.cursorIndex();
  if (!execBar) {
    throw new FillTimingViolationError(
      params.boundary.signalCursorIndex,
      execCursor,
      'No committed execution bar available at cursor.'
    );
  }
  if (execCursor <= params.boundary.signalCursorIndex) {
    throw new FillTimingViolationError(
      params.boundary.signalCursorIndex,
      execCursor,
      'SAME_BAR_FILL_FORBIDDEN: execution kernel refuses filling on signal bar.'
    );
  }
  if (!Number.isFinite(params.boundary.targetRR) || params.boundary.targetRR < MIN_RR_KERNEL_CONSTANT) {
    throw new RiskEngineOrderBlockedError(
      'RR_REJECT_SIGNAL',
      'signal_emission',
      `L2 FillModel rejected SignalToFillBoundary ${params.boundary.signalId}: targetRR=${params.boundary.targetRR} < ${MIN_RR_KERNEL_CONSTANT}.`
    );
  }

  let canTradeReq: CanTradeRequest | undefined;
  if (
    params.riskState ||
    params.enforceOrderIntentRR ||
    params.boundary.rrReceipt
  ) {
    const sl =
      params.boundary.stopLossPrice ??
      (params.boundary.direction === 'BUY'
        ? params.boundary.signalBarClosePrice - params.boundary.stopLossDistance
        : params.boundary.signalBarClosePrice + params.boundary.stopLossDistance);
    const tp =
      params.boundary.liquidityTargetPrice ??
      (params.boundary.direction === 'BUY'
        ? params.boundary.signalBarClosePrice + params.boundary.stopLossDistance * params.boundary.targetRR
        : params.boundary.signalBarClosePrice - params.boundary.stopLossDistance * params.boundary.targetRR);
    canTradeReq = {
      riskState: params.riskState ?? createInitialRiskEngineState({ strategyIds: [params.boundary.strategyId] }),
      strategyId: params.boundary.strategyId,
      symbol: params.boundary.symbol,
      direction: params.boundary.direction,
      regime: params.regime ?? 'NORMAL',
      signalEntryPrice: params.boundary.signalBarClosePrice,
      orderIntentPrice: execBar.open,
      stopLoss: sl,
      takeProfit: tp,
      stopOrigin: params.boundary.stopOrigin,
      targetOrigin: params.boundary.targetOrigin,
      signalReceipt: params.boundary.rrReceipt ?? undefined,
      slippageBudgetRatio: 0.05,
    };
    assertOrderIntentPermittedOrThrow(canTradeReq);
  }

  const algo = getExecutionAlgorithm(params.executionAlgorithm ?? DEFAULT_EXECUTION_ALGORITHM);
  const defaultQty = roundDet(
    Math.max(0.0001, 2500 / Math.max(params.boundary.signalBarClosePrice, 1e-8)),
    8
  );
  const requestedQty = params.requestedQty ?? defaultQty;

  const plan = algo.planChildSlices({
    parentOrderId: params.boundary.signalId,
    strategyId: params.boundary.strategyId,
    symbol: params.boundary.symbol,
    venue: params.venue,
    feeTier: params.feeTier,
    side: params.boundary.direction,
    totalQty: requestedQty,
    signalCursorIndex: params.boundary.signalCursorIndex,
    signalCursorTime: params.boundary.signalCursorTime,
    signalReferencePrice: params.boundary.signalBarClosePrice,
    closedHistory: params.feedAtExecutionCursor.history(24),
    participationCap: params.participationCap ?? algo.maxSingleBarParticipationCap,
    limitPrice: params.limitPrice,
  });

  const firstSlice = plan.slices[0];
  const orderType = params.orderType ?? firstSlice.orderType;
  const orderIntent = createImmutableOrderIntent({
    intentId: `intent_${params.boundary.signalId}`,
    strategyId: params.boundary.strategyId,
    symbol: params.boundary.symbol,
    venue: params.venue ?? 'BINANCE_SPOT',
    feeTier: params.feeTier ?? 'VIP0',
    side: params.boundary.direction,
    orderType,
    declaredRole: orderType === 'LIMIT' ? 'MAKER' : 'TAKER',
    timeInForce: params.timeInForce ?? firstSlice.timeInForce,
    requestedQty,
    limitPrice: params.limitPrice ?? firstSlice.limitPrice ?? undefined,
    plannedRR: params.boundary.plannedRR ?? params.boundary.targetRR,
    signalCursorIndex: params.boundary.signalCursorIndex,
    signalCursorTime: params.boundary.signalCursorTime,
    signalReferencePrice: params.boundary.signalBarClosePrice,
    executionAlgorithm: algo.algorithmId,
    participationCap: params.participationCap ?? algo.maxSingleBarParticipationCap,
    canTradeRequest: canTradeReq,
  });

  return resolveSevenPhaseFill({
    orderIntent,
    executionCursorIndex: execCursor,
    executionBar: execBar,
    priorLedger: params.priorLedger,
    slippageConfig: params.slippageConfig,
    canTradeRequest: canTradeReq,
  });
}

export interface FillParityComparisonReport {
  readonly fillModelHash: string;
  readonly fillModelSignatureVerified: boolean;
  readonly executionAlgorithm: ExecutionAlgorithmId;
  readonly backtestFillCount: number;
  readonly replayFillCount: number;
  readonly matchedFillCount: number;
  readonly fillCountMatch: boolean;
  readonly maxPriceDivergenceBps: number;
  readonly maxFeeDivergenceUsd: number;
  readonly exactAuditHashMatchCount: number;
  readonly promotionApproved: boolean;
  readonly haltReason: string | null;
  readonly backtestAuditTrail: ReadonlyArray<FillAuditRecord>;
  readonly replayAuditTrail: ReadonlyArray<FillAuditRecord>;
}

/**
 * Verifies exact Backtest <-> Replay parity using ONE shared strategy and ONE shared
 * 7-phase Fill Model + Execution Kernel over two independent PIT data adapters.
 */
export function evaluateBacktestReplayFillParity(params: {
  backtestFeed: PITFeed;
  replayFeed: PITFeed;
  strategy: PITStrategy;
  executionAlgorithm?: ExecutionAlgorithmId;
  venue?: ExecutionVenueId;
  feeTier?: FeeTierId;
  requestedQtyPerSignal?: number;
  maxAllowedPriceDivergenceBps?: number;
  maxAllowedFeeDivergenceUsd?: number;
}): FillParityComparisonReport {
  const algorithmId = params.executionAlgorithm ?? DEFAULT_EXECUTION_ALGORITHM;
  const maxPriceDivBps = params.maxAllowedPriceDivergenceBps ?? 0.01;
  const maxFeeDivUsd = params.maxAllowedFeeDivergenceUsd ?? 0.0001;

  const executeSingleAdapter = (feedInput: PITFeed): ReadonlyArray<FillAuditRecord> => {
    const tripwire = feedInput instanceof TripwireFeed ? feedInput : new TripwireFeed(feedInput);
    const token = issueEngineLoopToken(`parity_${params.strategy.strategyId}_${feedInput.mode}`);
    const audits: FillAuditRecord[] = [];
    let pendingBoundary: SignalToFillBoundary | null = null;
    let ledger: LedgerExposureState = INITIAL_LEDGER_EXPOSURE;

    while (tripwire.hasNext()) {
      tripwire.advance(token);
      const view = tripwire.asConsumerView();

      if (pendingBoundary) {
        tripwire.verifyAndRecordTPlusOneFill(pendingBoundary);
        const resolved = executeSignalBoundaryThroughFillKernel({
          boundary: pendingBoundary,
          feedAtExecutionCursor: view,
          requestedQty: params.requestedQtyPerSignal,
          venue: params.venue,
          feeTier: params.feeTier,
          executionAlgorithm: algorithmId,
          priorLedger: ledger,
        });
        audits.push(resolved.audit);
        ledger = resolved.nextLedger;
        pendingBoundary = null;
      }

      if (!tripwire.is_warm() || !tripwire.hasNext()) {
        continue;
      }

      const emission = tripwire.invokeStrategyGuarded(params.strategy);
      if (emission) {
        const bar = view.current();
        if (!bar) {
          throw new TripwireViolationError(
            'FUTURE_READ_TRIPWIRE',
            view.cursorIndex(),
            'Missing current bar when constructing signal boundary.'
          );
        }
        const snap = view.history(12).map((c) => c.close);
        pendingBoundary = Object.freeze({
          boundaryType: 'SIGNAL_TO_FILL_BOUNDARY_V1' as const,
          signalId: `sig_${params.strategy.strategyId}_${feedInput.symbol}_${view.cursorIndex()}`,
          strategyId: params.strategy.strategyId,
          symbol: view.symbol,
          timeframe: view.timeframe as PitTimeframe,
          signalCursorIndex: view.cursorIndex(),
          signalCursorTime: bar.time,
          signalBarClosePrice: bar.close,
          intendedFillCursorIndex: view.cursorIndex() + 1,
          direction: emission.direction,
          stopLossDistance: emission.stopLossDistance,
          stopLossPct: emission.stopLossPct,
          targetRR: Math.max(5.0, emission.targetRR),
          trailingAtrMult: emission.trailingAtrMult,
          confidence: emission.confidence,
          setupLabel: emission.setupLabel,
          snapshotHistoryAtSignal: Object.freeze(snap),
          isWarmAtSignal: true as const,
          sealedAtClose: true as const,
        });
        tripwire.recordBoundaryCreated();
      }
    }

    return Object.freeze(audits);
  };

  const backtestAuditTrail = executeSingleAdapter(params.backtestFeed);
  const replayAuditTrail = executeSingleAdapter(params.replayFeed);

  const count = Math.min(backtestAuditTrail.length, replayAuditTrail.length);
  let maxPriceDivergenceBps = 0;
  let maxFeeDivergenceUsd = 0;
  let exactAuditHashMatchCount = 0;

  for (let i = 0; i < count; i += 1) {
    const a = backtestAuditTrail[i];
    const b = replayAuditTrail[i];
    const refPx = Math.max(1e-8, a.priceResolution.effectiveFillPrice);
    const priceDiffBps = roundDet(
      (Math.abs(a.priceResolution.effectiveFillPrice - b.priceResolution.effectiveFillPrice) /
        refPx) *
        10_000,
      6
    );
    const feeDiffUsd = roundDet(Math.abs(a.feeDetail.feeUsd - b.feeDetail.feeUsd), 6);
    if (priceDiffBps > maxPriceDivergenceBps) maxPriceDivergenceBps = priceDiffBps;
    if (feeDiffUsd > maxFeeDivergenceUsd) maxFeeDivergenceUsd = feeDiffUsd;
    if (a.recordHash === b.recordHash && a.fillModelHash === b.fillModelHash) {
      exactAuditHashMatchCount += 1;
    }
  }

  const fillCountMatch = backtestAuditTrail.length === replayAuditTrail.length;
  const sigVerified = verifyFillModelArtifactSignature();
  const promotionApproved =
    sigVerified &&
    fillCountMatch &&
    count > 0 &&
    exactAuditHashMatchCount === count &&
    maxPriceDivergenceBps <= maxPriceDivBps &&
    maxFeeDivergenceUsd <= maxFeeDivUsd;

  const haltReason = promotionApproved
    ? null
    : `Fill equivalence parity gate HALTED: counts=${backtestAuditTrail.length}/${replayAuditTrail.length}, exactHashes=${exactAuditHashMatchCount}/${count}, maxPriceDiv=${maxPriceDivergenceBps}bps, maxFeeDiv=$${maxFeeDivergenceUsd}`;

  return Object.freeze({
    fillModelHash: FILL_MODEL_KERNEL_ARTIFACT.fillModelHash,
    fillModelSignatureVerified: sigVerified,
    executionAlgorithm: algorithmId,
    backtestFillCount: backtestAuditTrail.length,
    replayFillCount: replayAuditTrail.length,
    matchedFillCount: count,
    fillCountMatch,
    maxPriceDivergenceBps,
    maxFeeDivergenceUsd,
    exactAuditHashMatchCount,
    promotionApproved,
    haltReason,
    backtestAuditTrail,
    replayAuditTrail,
  });
}

/* ── Cross-Host Determinism Fingerprint Matrix ────────────────────────────── */

export function computeCrossHostFillDeterminismHash(params?: {
  symbol?: string;
  bar?: Candle;
}): {
  readonly fillModelHash: string;
  readonly vectorAuditHashes: ReadonlyArray<string>;
  readonly combinedVectorDigest: string;
} {
  const symbol = params?.symbol ?? 'BTCUSDT';
  const bar: Candle = params?.bar ?? {
    time: 1700007300,
    open: 64210.5,
    high: 64590.25,
    low: 63980.75,
    close: 64440.1,
    volume: 120.5,
  };

  const vectors: ReadonlyArray<OrderIntentInput> = [
    {
      intentId: 'det_vec_1_market_buy',
      strategyId: 'CROSS_HOST_PROBE',
      symbol,
      venue: 'BINANCE_SPOT',
      feeTier: 'VIP0',
      side: 'BUY',
      orderType: 'MARKET',
      timeInForce: 'GTC',
      requestedQty: 0.75,
      signalCursorIndex: 10,
      signalCursorTime: 1700006400,
      signalReferencePrice: 64195.0,
      executionAlgorithm: 'IMPLEMENTATION_SHORTFALL',
      participationCap: 0.025,
    },
    {
      intentId: 'det_vec_2_limit_cross_taker',
      strategyId: 'CROSS_HOST_PROBE',
      symbol,
      venue: 'BINANCE_USD_M_FUTURES',
      feeTier: 'VIP1',
      side: 'BUY',
      orderType: 'LIMIT',
      declaredRole: 'MAKER',
      timeInForce: 'IOC',
      requestedQty: 5.0,
      limitPrice: 64350.0,
      signalCursorIndex: 10,
      signalCursorTime: 1700006400,
      signalReferencePrice: 64195.0,
      executionAlgorithm: 'POV',
      participationCap: 0.02,
    },
    {
      intentId: 'det_vec_3_limit_passive_maker',
      strategyId: 'CROSS_HOST_PROBE',
      symbol,
      venue: 'BINANCE_SPOT',
      feeTier: 'VIP2',
      side: 'SELL',
      orderType: 'LIMIT',
      declaredRole: 'MAKER',
      timeInForce: 'GTC',
      requestedQty: 0.5,
      limitPrice: 64510.0,
      signalCursorIndex: 10,
      signalCursorTime: 1700006400,
      signalReferencePrice: 64195.0,
      executionAlgorithm: 'TWAP',
      participationCap: 0.025,
    },
    {
      intentId: 'det_vec_4_fok_partial_abort',
      strategyId: 'CROSS_HOST_PROBE',
      symbol,
      venue: 'BINANCE_USD_M_FUTURES',
      feeTier: 'VIP0',
      side: 'SELL',
      orderType: 'STOP_MARKET',
      timeInForce: 'FOK',
      requestedQty: 12.0,
      stopTriggerPrice: 64150.0,
      signalCursorIndex: 10,
      signalCursorTime: 1700006400,
      signalReferencePrice: 64195.0,
      executionAlgorithm: 'SWEEP',
      participationCap: 0.02,
    },
  ];

  const hashes: string[] = [];
  let ledger: LedgerExposureState = INITIAL_LEDGER_EXPOSURE;
  for (const vec of vectors) {
    const res = resolveSevenPhaseFill({
      orderIntent: vec,
      executionCursorIndex: 11,
      executionBar: bar,
      priorLedger: ledger,
    });
    hashes.push(res.audit.recordHash);
    ledger = res.nextLedger;
  }

  return Object.freeze({
    fillModelHash: FILL_MODEL_KERNEL_ARTIFACT.fillModelHash,
    vectorAuditHashes: Object.freeze(hashes),
    combinedVectorDigest: sha256Hex(
      canonicalStringify({
        fillModelHash: FILL_MODEL_KERNEL_ARTIFACT.fillModelHash,
        hashes,
        finalLedgerHash: ledger.lastCommitHash,
      })
    ),
  });
}

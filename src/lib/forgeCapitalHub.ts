import {
  type ExecutionEnvironment,
  type MarginMode,
  type SandboxPosition,
} from './coordinator';
import {
  DEFAULT_GITOPS_POLICY,
  assertBootBindingOrThrow,
  type BindingTriple,
} from './bindingLayer';
import {
  advanceMonotonicTrailingStop,
  buildKernelValidatedRiskProfile,
} from './invariantKernels';
import type { Candle, TickerSnapshot } from './marketData';
import {
  DEFAULT_LIVE_MANDATE,
  evaluateRuntimeGuard,
  resolveRuntimeGuardStartupOrThrow,
  type GuardDenialContract,
  type GuardProfileId,
  type LiveMandateState,
  type ResolvedStartupProfileLock,
} from './runtimeGuard';
import type { CmcBaselineValuation, SpotCmcValidationResult } from './spotCmcValidator';
import { timingSafeEqualStr } from './monitorAgent';
import {
  CONSOLIDATED_SYSTEMIC_SCHEMA,
  assertL0RuntimeDiscipline,
  createEnvironmentProfileContract,
  evaluateParityGate,
  type BinanceApiScope,
  type ConsolidatedSystemicSchema,
  type ParityGateInput,
  type ParityGateResult,
  type RuntimeEnvironmentProfile,
} from './systemicLayers';
import {
  DEFAULT_DRIFT_THRESHOLD_PCT,
  computePriceDiscrepancyPct,
} from './wsDataEngine';
import {
  MIN_RR_KERNEL_CONSTANT,
  can_trade,
  createInitialRiskEngineState,
  type CanTradeVerdict,
  type MarketRegime,
  type RiskEngineState,
  type SignalEmissionRRReceipt,
  type StructuralStopOrigin,
  type StructuralTargetOrigin,
} from './riskEngine';

export const PORTFOLIO_DRAWDOWN_MIN_PCT = 10.0;
export const PORTFOLIO_DRAWDOWN_MAX_PCT = 15.0;
export const DEFAULT_PORTFOLIO_DRAWDOWN_LIMIT_PCT = 12.5;

export const MODULE_DRAWDOWN_MIN_PCT = 3.0;
export const MODULE_DRAWDOWN_MAX_PCT = 5.0;
export const DEFAULT_MODULE_DRAWDOWN_LIMIT_PCT = 4.0;

export const BINANCE_SPOT_API_ENDPOINT = 'https://api.binance.com/api/v3/order';
export const BINANCE_SPOT_TESTNET_ENDPOINT = 'https://testnet.binance.vision/api/v3/order';
export const BINANCE_FUTURES_API_ENDPOINT = 'https://fapi.binance.com/fapi/v1/order';
export const BINANCE_FUTURES_TESTNET_ENDPOINT = 'https://testnet.binancefuture.com/fapi/v1/order';

export type ForgeMarketChannel = 'SPOT' | 'USD_M_FUTURES';

export type ForgeModuleId =
  | 'SPOT_MOMENTUM'
  | 'FUTURES_COORDINATOR'
  | 'SMC_FRVP_DESK'
  | 'ARB_COPY_DESK'
  | 'AUTONOMOUS_AI_AGENTS';

export type ForgeModuleStatus = 'ACTIVE' | 'SUSPENDED';

export type ForgeHaltCode = 'NOMINAL' | 'EMERGENCY_HALT';

export interface ForgeModuleRiskProfile {
  readonly id: ForgeModuleId;
  readonly label: string;
  readonly primaryMarket: ForgeMarketChannel;
  readonly allowedMarkets: ReadonlyArray<ForgeMarketChannel>;
  readonly allocatedCapitalUsd: number;
  readonly highWaterMarkUsd: number;
  readonly currentEquityUsd: number;
  readonly realizedPnlUsd: number;
  readonly unrealizedPnlUsd: number;
  readonly drawdownPct: number;
  readonly configuredDrawdownLimitPct: number; // Strictly within [3.0, 5.0], default 4.0
  readonly volatilityAdjustedLimitPct: number; // Dynamically calibrated inside [3.0, 5.0]
  readonly marketVolatilityPct: number;
  readonly status: ForgeModuleStatus;
  readonly suspensionReason: string | null;
  readonly suspendedAt: string | null;
  readonly totalRoutedOrders: number;
  readonly lastRoutedAt: string | null;
}

export interface FailSafeLockSnapshot {
  readonly engaged: boolean;
  readonly haltCode: ForgeHaltCode;
  readonly httpStatusLock: 200 | 423;
  readonly immutableSealId: string | null;
  readonly triggeredAt: string | null;
  readonly triggerDrawdownPct: number;
  readonly enforcedLimitPct: number;
  readonly breachEquityUsd: number;
  readonly highWaterMarkUsd: number;
  readonly reason: string | null;
  readonly operatorResetCount: number;
  readonly lastResetAt: string | null;
  readonly lastResetReason: string | null;
}

export interface ForgeReconciliationCheckpoint {
  readonly reconciledAt: string;
  readonly walletBalanceUsd: number;
  readonly computedEquityUsd: number;
  readonly equityDriftUsd: number;
  readonly maxPriceDriftPct: number;
  readonly openSpotCount: number;
  readonly openFuturesCount: number;
  readonly meanVolatilityPct: number;
  readonly driftDetected: boolean;
  readonly triggerSummary: string;
}

export interface DualExecutionRouteRecord {
  readonly id: string;
  readonly moduleId: ForgeModuleId;
  readonly market: ForgeMarketChannel;
  readonly environment: ExecutionEnvironment;
  readonly apiEndpoint: string;
  readonly symbol: string;
  readonly direction: 'BUY' | 'SELL';
  readonly notionalUsd: number;
  readonly leverage: number;
  readonly marginMode: MarginMode;
  readonly validatedPrice: number;
  readonly priceDiscrepancyPct: number;
  readonly status:
    | 'ROUTED'
    | 'REJECTED_FAIL_SAFE'
    | 'REJECTED_MODULE_SUSPENDED'
    | 'REJECTED_L0_GUARD'
    | 'REJECTED_PARITY_GATE'
    | 'REJECTED_VALIDATION';
  readonly reason: string;
  readonly routedAt: string;
}

export interface ApiErrorLogEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly market: ForgeMarketChannel | 'SYSTEM';
  readonly moduleId: ForgeModuleId | 'SYSTEM';
  readonly endpoint: string;
  readonly httpStatus: number;
  readonly exchangeCode: string;
  readonly severity: 'WARN' | 'ERROR' | 'CRITICAL';
  readonly retryable: boolean;
  readonly latencyMs: number;
  readonly message: string;
}

export interface ForgeAuditLedgerEntry {
  readonly seq: number;
  readonly id: string;
  readonly timestamp: string;
  readonly eventType:
    | 'HUB_INITIALIZED'
    | 'CONFIG_UPDATED'
    | 'MODULE_SUSPENDED'
    | 'MODULE_RESUMED'
    | 'RECONCILIATION_RUN'
    | 'DUAL_ORDER_ROUTED'
    | 'ORDER_REJECTED'
    | 'EMERGENCY_HALT'
    | 'FAIL_SAFE_RESET'
    | 'API_ERROR_RECORDED';
  readonly market: ForgeMarketChannel | 'PORTFOLIO';
  readonly moduleId: ForgeModuleId | 'PORTFOLIO';
  readonly message: string;
  readonly portfolioDrawdownPct: number;
}

export interface ForgeCapitalHubState {
  readonly initializedAt: string;
  readonly portfolioDrawdownLimitPct: number; // Strictly [10.0, 15.0], default 12.5
  readonly highWaterMarkUsd: number;
  readonly currentEquityUsd: number;
  readonly walletBalanceUsd: number;
  readonly unrealizedPnlUsd: number;
  readonly portfolioDrawdownUsd: number;
  readonly portfolioDrawdownPct: number;
  readonly allTradingHalted: boolean;
  readonly systemicSchema: ConsolidatedSystemicSchema;
  readonly bindingStatus: 'BOUND_START_ALLOWED' | 'FAILED_CLOSED_HALT';
  readonly bindingTriple: BindingTriple;
  readonly activeGuardProfile: GuardProfileId;
  readonly liveMandateStatus: 'NOT_GRANTED' | 'GRANTED';
  readonly lastGuardDenial: GuardDenialContract | null;
  readonly parityGate: ParityGateResult;
  readonly riskEngine: RiskEngineState;
  readonly failSafe: Readonly<FailSafeLockSnapshot>;
  readonly modules: Readonly<Record<ForgeModuleId, ForgeModuleRiskProfile>>;
  readonly reconciliation: Readonly<ForgeReconciliationCheckpoint>;
  readonly routeHistory: ReadonlyArray<DualExecutionRouteRecord>;
  readonly apiErrorLogs: ReadonlyArray<ApiErrorLogEntry>;
  readonly auditLedger: ReadonlyArray<ForgeAuditLedgerEntry>;
}

export interface ForgeConfigPatch {
  portfolioDrawdownLimitPct?: number;
  moduleLimitsPct?: Partial<Record<ForgeModuleId, number>>;
}

export interface DualExecutionOrderRequest {
  moduleId: ForgeModuleId;
  market: ForgeMarketChannel;
  environment?: ExecutionEnvironment;
  requestedProfile?: RuntimeEnvironmentProfile;
  credentialEnvironment?: RuntimeEnvironmentProfile;
  grantedScopes?: ReadonlyArray<BinanceApiScope>;
  stateNamespace?: string;
  parityGateInput?: ParityGateInput;
  enforceParityGate?: boolean;
  guardProfileLock?: ResolvedStartupProfileLock;
  liveMandate?: LiveMandateState;
  attemptedProfileSwitch?: GuardProfileId;
  symbol: string;
  direction: 'BUY' | 'SELL';
  notionalUsd: number;
  leverage?: number;
  marginMode?: MarginMode;
  submittedPrice: number;
  authoritativePrice?: number;
  maxSlippagePct?: number;
  appLiveEnabled?: boolean;
  nowIso?: string;
  stopLoss?: number | null;
  takeProfit?: number | null;
  intentStopLoss?: number | null;
  intentTakeProfit?: number | null;
  stopOrigin?: StructuralStopOrigin;
  targetOrigin?: StructuralTargetOrigin;
  signalReceipt?: SignalEmissionRRReceipt | null;
  regime?: MarketRegime;
  maxRiskPct?: number;
  enforceRRGate?: boolean;
}

export interface DualExecutionRouteOutcome {
  ok: boolean;
  statusCode: number;
  error?: string;
  guardDenial?: GuardDenialContract;
  riskVerdict?: CanTradeVerdict;
  rejectionCode?: string;
  routeRecord: DualExecutionRouteRecord;
  nextState: ForgeCapitalHubState;
}

export interface UnifiedExecutionPosition extends SandboxPosition {
  readonly moduleId: ForgeModuleId;
  readonly moduleLabel: string;
  readonly apiEndpoint: string;
  readonly livePrice: number;
  readonly liveTrailSl: number;
  readonly livePnlPercent: number;
  readonly livePnlUsd: number;
  readonly liveRoePercent: number;
  readonly effectiveLev: number;
  readonly marketKind: ForgeMarketChannel;
  readonly cmcPriceUsd: number | null;
  readonly cmcAligned: boolean;
}

export interface UnifiedCapitalLedgerState {
  readonly reconciledAt: string;
  readonly emergencyHalted: boolean;
  readonly haltCode: ForgeHaltCode;
  readonly httpStatusLock: 200 | 423;
  readonly openPositionsCount: number;
  readonly closedPositionsCount: number;
  readonly totalOpenPnlUsd: number;
  readonly totalRealizedPnlUsd: number;
  readonly netPnlUsd: number;
  readonly liveEquityUsd: number;
  readonly walletParityDivergencePct: number;
  readonly walletParityVerified: boolean;
  readonly positions: ReadonlyArray<UnifiedExecutionPosition>;
  readonly ledgerEntries: ReadonlyArray<ForgeAuditLedgerEntry>;
  readonly routes: ReadonlyArray<DualExecutionRouteRecord>;
}

export const FORGE_MODULE_ORDER: ReadonlyArray<ForgeModuleId> = [
  'SPOT_MOMENTUM',
  'FUTURES_COORDINATOR',
  'SMC_FRVP_DESK',
  'ARB_COPY_DESK',
  'AUTONOMOUS_AI_AGENTS',
];

export const FORGE_MODULE_LABELS: Readonly<Record<ForgeModuleId, string>> = {
  SPOT_MOMENTUM: 'Spot Momentum & Top Gainers',
  FUTURES_COORDINATOR: 'USD-M Futures Coordinator',
  SMC_FRVP_DESK: 'SMC & FRVP Structural Desk',
  ARB_COPY_DESK: 'Arbitrage & Copy Desk',
  AUTONOMOUS_AI_AGENTS: 'Autonomous AI Agents',
};

export function isForgeModuleId(value: unknown): value is ForgeModuleId {
  return (
    typeof value === 'string' &&
    (FORGE_MODULE_ORDER as ReadonlyArray<string>).includes(value)
  );
}

export function isForgeMarketChannel(value: unknown): value is ForgeMarketChannel {
  return value === 'SPOT' || value === 'USD_M_FUTURES';
}

export function roundUsd(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
}

export function roundPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(4));
}

export function clampPortfolioDrawdownLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PORTFOLIO_DRAWDOWN_LIMIT_PCT;
  return Number(
    Math.max(PORTFOLIO_DRAWDOWN_MIN_PCT, Math.min(PORTFOLIO_DRAWDOWN_MAX_PCT, value)).toFixed(2)
  );
}

export function clampModuleDrawdownLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MODULE_DRAWDOWN_LIMIT_PCT;
  return Number(
    Math.max(MODULE_DRAWDOWN_MIN_PCT, Math.min(MODULE_DRAWDOWN_MAX_PCT, value)).toFixed(2)
  );
}

/**
 * Calibrates a module's active drawdown threshold strictly within [3.0%, 5.0%]
 * based on live market volatility (% range / ATR).
 */
export function computeVolatilityAdjustedThreshold(
  configuredCeilingPct: number,
  marketVolatilityPct: number
): number {
  const safeCeiling = clampModuleDrawdownLimit(configuredCeilingPct);
  const vol = Number.isFinite(marketVolatilityPct)
    ? Math.max(0, marketVolatilityPct)
    : 2.5;
  const normalizedVol = Math.max(0, Math.min(1, (vol - 1.5) / 5.0));
  const adjusted = safeCeiling - normalizedVol * (safeCeiling - MODULE_DRAWDOWN_MIN_PCT);
  return clampModuleDrawdownLimit(adjusted);
}

export function resolveBinanceExecutionEndpoint(
  market: ForgeMarketChannel,
  environment: ExecutionEnvironment
): string {
  if (market === 'USD_M_FUTURES') {
    return environment === 'LIVE'
      ? BINANCE_FUTURES_API_ENDPOINT
      : BINANCE_FUTURES_TESTNET_ENDPOINT;
  }
  return environment === 'LIVE' ? BINANCE_SPOT_API_ENDPOINT : BINANCE_SPOT_TESTNET_ENDPOINT;
}

/**
 * Maps any position, coordinator plan, or autonomous agent fill directly to its governing Forge module.
 */
export function inferPositionModuleId(position: SandboxPosition): ForgeModuleId {
  const reason = (position.entrySourceReason || '').toUpperCase();
  const idUpper = (position.id || '').toUpperCase();

  for (const modId of FORGE_MODULE_ORDER) {
    if (reason.includes(`[${modId}]`)) {
      return modId;
    }
  }
  if (reason.includes('ARBITRAGE') || reason.includes('COPY')) {
    return 'ARB_COPY_DESK';
  }
  if (
    reason.includes('SENTINEL') ||
    position.autonomousEntry ||
    idUpper.startsWith('AUTO_')
  ) {
    return 'AUTONOMOUS_AI_AGENTS';
  }
  if (reason.includes('SMC') || reason.includes('FRVP') || reason.includes('PATTERN')) {
    return 'SMC_FRVP_DESK';
  }
  if (position.marketType === 'USD_M_FUTURES' || (position.leverage ?? 1) > 1) {
    return 'FUTURES_COORDINATOR';
  }
  if (reason.includes('GAINER') || reason.includes('PRE_PUMP')) {
    return 'SPOT_MOMENTUM';
  }
  return 'SPOT_MOMENTUM';
}

export function computePositionUnrealizedPnlUsd(
  position: SandboxPosition,
  markPrice: number
): number {
  if (
    position.status !== 'OPEN' ||
    !Number.isFinite(markPrice) ||
    markPrice <= 0 ||
    !Number.isFinite(position.entryPrice) ||
    position.entryPrice <= 0
  ) {
    return 0;
  }
  const priceDeltaRatio =
    position.direction === 'BUY'
      ? (markPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - markPrice) / position.entryPrice;
  return roundUsd(position.notionalUsd * priceDeltaRatio + (position.settledFundingUsd ?? 0));
}

export function estimateMarketVolatilityPct(
  tickers: Record<
    string,
    | TickerSnapshot
    | { price: number; high24h?: number; low24h?: number; change24hPercent?: number }
  >
): number {
  const spreads: number[] = [];
  for (const entry of Object.values(tickers)) {
    if (!entry || !Number.isFinite(entry.price) || entry.price <= 0) continue;
    const high = Number(entry.high24h ?? entry.price);
    const low = Number(entry.low24h ?? entry.price);
    if (Number.isFinite(high) && Number.isFinite(low) && high >= low && low > 0) {
      spreads.push(((high - low) / entry.price) * 100);
    } else if (entry.change24hPercent !== undefined && Number.isFinite(entry.change24hPercent)) {
      spreads.push(Math.abs(entry.change24hPercent));
    }
  }
  if (spreads.length === 0) return 2.4;
  const avg = spreads.reduce((acc, s) => acc + s, 0) / spreads.length;
  return Number(Math.max(0.5, Math.min(20, avg)).toFixed(2));
}

function appendAuditEntry(
  ledger: ReadonlyArray<ForgeAuditLedgerEntry>,
  entry: Omit<ForgeAuditLedgerEntry, 'seq' | 'id'>
): ReadonlyArray<ForgeAuditLedgerEntry> {
  const nextSeq = (ledger[0]?.seq ?? 0) + 1;
  const full: ForgeAuditLedgerEntry = Object.freeze({
    ...entry,
    seq: nextSeq,
    id: `fch_audit_${nextSeq}_${entry.eventType}`,
  });
  return [full, ...ledger].slice(0, 80);
}

export function createInitialForgeCapitalHubState(options?: {
  initialEquityUsd?: number;
  portfolioDrawdownLimitPct?: number;
  nowIso?: string;
}): ForgeCapitalHubState {
  const nowIso = options?.nowIso ?? new Date().toISOString();
  const baseEquity =
    options?.initialEquityUsd !== undefined &&
    Number.isFinite(options.initialEquityUsd) &&
    options.initialEquityUsd > 0
      ? roundUsd(options.initialEquityUsd)
      : 25000;
  const portfolioLimit = clampPortfolioDrawdownLimit(
    options?.portfolioDrawdownLimitPct ?? DEFAULT_PORTFOLIO_DRAWDOWN_LIMIT_PCT
  );

  const allocSpot = roundUsd(baseEquity * 0.26);
  const allocFutures = roundUsd(baseEquity * 0.26);
  const allocSmc = roundUsd(baseEquity * 0.18);
  const allocArb = roundUsd(baseEquity * 0.15);
  const allocAuto = roundUsd(baseEquity - allocSpot - allocFutures - allocSmc - allocArb);

  const defaultVol = 2.4;
  const makeModule = (
    id: ForgeModuleId,
    primaryMarket: ForgeMarketChannel,
    allowedMarkets: ForgeMarketChannel[],
    alloc: number,
    baseLimit = DEFAULT_MODULE_DRAWDOWN_LIMIT_PCT
  ): ForgeModuleRiskProfile => ({
    id,
    label: FORGE_MODULE_LABELS[id],
    primaryMarket,
    allowedMarkets,
    allocatedCapitalUsd: alloc,
    highWaterMarkUsd: alloc,
    currentEquityUsd: alloc,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    drawdownPct: 0,
    configuredDrawdownLimitPct: clampModuleDrawdownLimit(baseLimit),
    volatilityAdjustedLimitPct: computeVolatilityAdjustedThreshold(baseLimit, defaultVol),
    marketVolatilityPct: defaultVol,
    status: 'ACTIVE',
    suspensionReason: null,
    suspendedAt: null,
    totalRoutedOrders: 0,
    lastRoutedAt: null,
  });

  const modules: Record<ForgeModuleId, ForgeModuleRiskProfile> = {
    SPOT_MOMENTUM: makeModule('SPOT_MOMENTUM', 'SPOT', ['SPOT'], allocSpot),
    FUTURES_COORDINATOR: makeModule(
      'FUTURES_COORDINATOR',
      'USD_M_FUTURES',
      ['USD_M_FUTURES', 'SPOT'],
      allocFutures
    ),
    SMC_FRVP_DESK: makeModule('SMC_FRVP_DESK', 'SPOT', ['SPOT', 'USD_M_FUTURES'], allocSmc),
    ARB_COPY_DESK: makeModule('ARB_COPY_DESK', 'SPOT', ['SPOT', 'USD_M_FUTURES'], allocArb),
    AUTONOMOUS_AI_AGENTS: makeModule(
      'AUTONOMOUS_AI_AGENTS',
      'SPOT',
      ['SPOT', 'USD_M_FUTURES'],
      allocAuto
    ),
  };

  const failSafe: FailSafeLockSnapshot = Object.freeze({
    engaged: false,
    haltCode: 'NOMINAL',
    httpStatusLock: 200,
    immutableSealId: null,
    triggeredAt: null,
    triggerDrawdownPct: 0,
    enforcedLimitPct: portfolioLimit,
    breachEquityUsd: baseEquity,
    highWaterMarkUsd: baseEquity,
    reason: null,
    operatorResetCount: 0,
    lastResetAt: null,
    lastResetReason: null,
  });

  const reconciliation: ForgeReconciliationCheckpoint = Object.freeze({
    reconciledAt: nowIso,
    walletBalanceUsd: baseEquity,
    computedEquityUsd: baseEquity,
    equityDriftUsd: 0,
    maxPriceDriftPct: 0,
    openSpotCount: 0,
    openFuturesCount: 0,
    meanVolatilityPct: defaultVol,
    driftDetected: false,
    triggerSummary: 'Initialized cleanly across all 5 active trading desks with 0.00% drift.',
  });

  const initialLedger = appendAuditEntry([], {
    timestamp: nowIso,
    eventType: 'HUB_INITIALIZED',
    market: 'PORTFOLIO',
    moduleId: 'PORTFOLIO',
    message: `Forge Capital Hub armed (${portfolioLimit.toFixed(1)}% hard portfolio drawdown stop · 4.0% default / 3.0–5.0% dynamic module limits across 5 desks).`,
    portfolioDrawdownPct: 0,
  });

  const bootBinding = assertBootBindingOrThrow(DEFAULT_GITOPS_POLICY, {
    environment: 'TESTNET',
    timestampUtc: nowIso,
  });
  const guardLock = resolveRuntimeGuardStartupOrThrow({
    requestedProfile: 'Paper-Trade',
    timestampUtc: nowIso,
  });

  return {
    initializedAt: nowIso,
    portfolioDrawdownLimitPct: portfolioLimit,
    highWaterMarkUsd: baseEquity,
    currentEquityUsd: baseEquity,
    walletBalanceUsd: baseEquity,
    unrealizedPnlUsd: 0,
    portfolioDrawdownUsd: 0,
    portfolioDrawdownPct: 0,
    allTradingHalted: false,
    systemicSchema: CONSOLIDATED_SYSTEMIC_SCHEMA,
    bindingStatus: bootBinding.audit.status,
    bindingTriple: bootBinding.triple ?? {
      kernel_hash: '',
      policy_hash: '',
      git_sha: DEFAULT_GITOPS_POLICY.git_sha,
    },
    activeGuardProfile: guardLock.profileId,
    liveMandateStatus: DEFAULT_LIVE_MANDATE,
    lastGuardDenial: null,
    parityGate: evaluateParityGate({
      backtestExpectedSlippageBps: 14.5,
      liveObservedSlippageBps: 14.5,
      backtestWinRatePct: 56.0,
      liveWinRatePct: 56.0,
      backtestExpectancyR: 1.35,
      liveExpectancyR: 1.35,
    }),
    riskEngine: createInitialRiskEngineState({
      initialCapitalUsd: baseEquity,
      strategyIds: FORGE_MODULE_ORDER,
    }),
    failSafe,
    modules,
    reconciliation,
    routeHistory: [],
    apiErrorLogs: [],
    auditLedger: initialLedger,
  };
}

/**
 * Engages EMERGENCY_HALT (423 Locked) immutable fail-safe latch across all modules and WebSocket order generation.
 */
export function engageImmutableFailSafe(
  state: ForgeCapitalHubState,
  reason: string,
  nowIso = new Date().toISOString()
): ForgeCapitalHubState {
  if (state.failSafe.engaged) {
    return state;
  }

  const sealId = `fch_seal_${Date.now()}_${Math.round(state.portfolioDrawdownPct * 100)}`;
  const frozenFailSafe: FailSafeLockSnapshot = Object.freeze({
    engaged: true,
    haltCode: 'EMERGENCY_HALT',
    httpStatusLock: 423,
    immutableSealId: sealId,
    triggeredAt: nowIso,
    triggerDrawdownPct: state.portfolioDrawdownPct,
    enforcedLimitPct: state.portfolioDrawdownLimitPct,
    breachEquityUsd: state.currentEquityUsd,
    highWaterMarkUsd: state.highWaterMarkUsd,
    reason,
    operatorResetCount: state.failSafe.operatorResetCount,
    lastResetAt: state.failSafe.lastResetAt,
    lastResetReason: state.failSafe.lastResetReason,
  });

  const nextModules: Record<ForgeModuleId, ForgeModuleRiskProfile> = {
    ...state.modules,
  };
  for (const modId of Object.keys(nextModules) as ForgeModuleId[]) {
    const m = nextModules[modId];
    if (m.status !== 'SUSPENDED') {
      nextModules[modId] = {
        ...m,
        status: 'SUSPENDED',
        suspendedAt: nowIso,
        suspensionReason: `EMERGENCY_HALT (423 Locked) [${sealId}]`,
      };
    }
  }

  return {
    ...state,
    allTradingHalted: true,
    failSafe: frozenFailSafe,
    modules: nextModules,
    auditLedger: appendAuditEntry(state.auditLedger, {
      timestamp: nowIso,
      eventType: 'EMERGENCY_HALT',
      market: 'PORTFOLIO',
      moduleId: 'PORTFOLIO',
      message: `EMERGENCY_HALT (423 Locked) [${sealId}]: ${reason} — suspended all Spot, Futures, and WebSocket order generation.`,
      portfolioDrawdownPct: state.portfolioDrawdownPct,
    }),
  };
}

export function updateForgeCapitalConfig(
  state: ForgeCapitalHubState,
  patch: ForgeConfigPatch,
  nowIso = new Date().toISOString()
): ForgeCapitalHubState {
  const nextPortfolioLimit =
    patch.portfolioDrawdownLimitPct !== undefined
      ? clampPortfolioDrawdownLimit(patch.portfolioDrawdownLimitPct)
      : state.portfolioDrawdownLimitPct;

  const nextModules: Record<ForgeModuleId, ForgeModuleRiskProfile> = {
    ...state.modules,
  };
  if (patch.moduleLimitsPct) {
    for (const [rawId, rawLimit] of Object.entries(patch.moduleLimitsPct)) {
      const modId = rawId as ForgeModuleId;
      const existing = nextModules[modId];
      if (!existing || rawLimit === undefined) continue;
      const ceiling = clampModuleDrawdownLimit(rawLimit);
      const volAdjusted = computeVolatilityAdjustedThreshold(ceiling, existing.marketVolatilityPct);
      const breached = existing.drawdownPct >= volAdjusted;
      nextModules[modId] = {
        ...existing,
        configuredDrawdownLimitPct: ceiling,
        volatilityAdjustedLimitPct: volAdjusted,
        status: state.failSafe.engaged || breached ? 'SUSPENDED' : existing.status,
        suspendedAt:
          breached && existing.status !== 'SUSPENDED' ? nowIso : existing.suspendedAt,
        suspensionReason:
          breached && existing.status !== 'SUSPENDED'
            ? `Automated module isolation: drawdown ${existing.drawdownPct.toFixed(2)}% >= ${volAdjusted.toFixed(2)}% threshold.`
            : existing.suspensionReason,
      };
    }
  }

  let nextState: ForgeCapitalHubState = {
    ...state,
    portfolioDrawdownLimitPct: nextPortfolioLimit,
    modules: nextModules,
    auditLedger: appendAuditEntry(state.auditLedger, {
      timestamp: nowIso,
      eventType: 'CONFIG_UPDATED',
      market: 'PORTFOLIO',
      moduleId: 'PORTFOLIO',
      message: `Updated Forge Capital limits (Portfolio ${nextPortfolioLimit.toFixed(1)}% hard cap · module floors 3.0–5.0%).`,
      portfolioDrawdownPct: state.portfolioDrawdownPct,
    }),
  };

  if (nextState.portfolioDrawdownPct >= nextPortfolioLimit && !nextState.failSafe.engaged) {
    nextState = engageImmutableFailSafe(
      nextState,
      `Hard portfolio drawdown limit breached after config tightening (${nextState.portfolioDrawdownPct.toFixed(2)}% >= ${nextPortfolioLimit.toFixed(2)}%).`,
      nowIso
    );
  }

  return nextState;
}

export function reconcileForgeCapitalState(
  state: ForgeCapitalHubState,
  input: {
    walletBalanceUsd: number;
    positions: ReadonlyArray<SandboxPosition>;
    authoritativePrices: Record<string, number>;
    marketVolatilityPct?: number;
    submittedBaselineEquityUsd?: number;
    nowIso?: string;
  }
): ForgeCapitalHubState {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const safeWallet =
    Number.isFinite(input.walletBalanceUsd) && input.walletBalanceUsd >= 0
      ? roundUsd(input.walletBalanceUsd)
      : state.walletBalanceUsd;

  const meanVol =
    input.marketVolatilityPct !== undefined && Number.isFinite(input.marketVolatilityPct)
      ? Number(Math.max(0.5, Math.min(20, input.marketVolatilityPct)).toFixed(2))
      : state.reconciliation.meanVolatilityPct;

  let totalUnrealizedPnl = 0;
  let openSpotCount = 0;
  let openFuturesCount = 0;
  let maxPriceDriftPct = 0;

  const moduleRealized: Record<ForgeModuleId, number> = {
    SPOT_MOMENTUM: 0,
    FUTURES_COORDINATOR: 0,
    SMC_FRVP_DESK: 0,
    ARB_COPY_DESK: 0,
    AUTONOMOUS_AI_AGENTS: 0,
  };
  const moduleUnrealized: Record<ForgeModuleId, number> = {
    SPOT_MOMENTUM: 0,
    FUTURES_COORDINATOR: 0,
    SMC_FRVP_DESK: 0,
    ARB_COPY_DESK: 0,
    AUTONOMOUS_AI_AGENTS: 0,
  };

  for (const pos of Array.isArray(input.positions) ? input.positions : []) {
    if (!pos || !pos.symbol) continue;
    const modId = inferPositionModuleId(pos);
    if (pos.status === 'OPEN') {
      if (pos.marketType === 'USD_M_FUTURES') {
        openFuturesCount += 1;
      } else {
        openSpotCount += 1;
      }
      const rawAuthPrice = input.authoritativePrices?.[pos.symbol];
      const safeAuthPrice =
        rawAuthPrice !== undefined && Number.isFinite(rawAuthPrice) && rawAuthPrice > 0
          ? rawAuthPrice
          : undefined;
      if (safeAuthPrice !== undefined) {
        const drift = computePriceDiscrepancyPct(safeAuthPrice, pos.entryPrice);
        if (pos.peakFavorablePrice && Number.isFinite(pos.peakFavorablePrice) && pos.peakFavorablePrice > 0) {
          maxPriceDriftPct = Math.max(
            maxPriceDriftPct,
            computePriceDiscrepancyPct(safeAuthPrice, pos.peakFavorablePrice)
          );
        } else {
          maxPriceDriftPct = Math.max(maxPriceDriftPct, drift);
        }
      }
      const safeEntry = Number.isFinite(pos.entryPrice) && pos.entryPrice > 0 ? pos.entryPrice : 1;
      const mark = safeAuthPrice !== undefined ? safeAuthPrice : safeEntry;
      const uPnl = computePositionUnrealizedPnlUsd(pos, mark);
      totalUnrealizedPnl += uPnl;
      moduleUnrealized[modId] = roundUsd(moduleUnrealized[modId] + uPnl);
    } else {
      const realized = Number.isFinite(pos.pnlUsd) ? pos.pnlUsd : 0;
      moduleRealized[modId] = roundUsd(moduleRealized[modId] + realized);
    }
  }

  totalUnrealizedPnl = roundUsd(totalUnrealizedPnl);
  const computedEquity = roundUsd(Math.max(0, safeWallet + totalUnrealizedPnl));
  const baselineCompare =
    input.submittedBaselineEquityUsd !== undefined &&
    Number.isFinite(input.submittedBaselineEquityUsd)
      ? input.submittedBaselineEquityUsd
      : state.currentEquityUsd;
  const equityDriftUsd = roundUsd(computedEquity - baselineCompare);

  const nextHighWater = Math.max(state.highWaterMarkUsd, computedEquity);
  const drawdownUsd = roundUsd(Math.max(0, nextHighWater - computedEquity));
  const drawdownPct =
    nextHighWater > 0 ? roundPct((drawdownUsd / nextHighWater) * 100) : 0;

  let auditLedger = state.auditLedger;
  const nextModules: Record<ForgeModuleId, ForgeModuleRiskProfile> = {
    ...state.modules,
  };

  for (const modId of FORGE_MODULE_ORDER) {
    const mod = nextModules[modId];
    if (!mod) continue;
    const modEquity = roundUsd(
      Math.max(0, mod.allocatedCapitalUsd + moduleRealized[modId] + moduleUnrealized[modId])
    );
    const modHwm = Math.max(mod.highWaterMarkUsd, modEquity);
    const modDdPct = modHwm > 0 ? roundPct(((modHwm - modEquity) / modHwm) * 100) : 0;
    const volLimit = computeVolatilityAdjustedThreshold(
      mod.configuredDrawdownLimitPct,
      meanVol
    );

    let nextStatus: ForgeModuleStatus = mod.status;
    let suspensionReason = mod.suspensionReason;
    let suspendedAt = mod.suspendedAt;

    if (state.failSafe.engaged) {
      nextStatus = 'SUSPENDED';
    } else if (modDdPct >= volLimit && mod.status !== 'SUSPENDED') {
      nextStatus = 'SUSPENDED';
      suspendedAt = nowIso;
      suspensionReason = `Auto-isolated (${meanVol.toFixed(2)}% vol): module drawdown ${modDdPct.toFixed(2)}% >= ${volLimit.toFixed(2)}% limit.`;
      auditLedger = appendAuditEntry(auditLedger, {
        timestamp: nowIso,
        eventType: 'MODULE_SUSPENDED',
        market: mod.primaryMarket,
        moduleId: modId,
        message: `${mod.label} isolated automatically at ${modDdPct.toFixed(2)}% drawdown (limit ${volLimit.toFixed(2)}%).`,
        portfolioDrawdownPct: drawdownPct,
      });
    }

    nextModules[modId] = {
      ...mod,
      highWaterMarkUsd: modHwm,
      currentEquityUsd: modEquity,
      realizedPnlUsd: moduleRealized[modId],
      unrealizedPnlUsd: moduleUnrealized[modId],
      drawdownPct: modDdPct,
      volatilityAdjustedLimitPct: volLimit,
      marketVolatilityPct: meanVol,
      status: nextStatus,
      suspensionReason,
      suspendedAt,
    };
  }

  const driftDetected =
    Math.abs(equityDriftUsd) >= 0.5 || maxPriceDriftPct >= DEFAULT_DRIFT_THRESHOLD_PCT;
  const checkpoint: ForgeReconciliationCheckpoint = Object.freeze({
    reconciledAt: nowIso,
    walletBalanceUsd: safeWallet,
    computedEquityUsd: computedEquity,
    equityDriftUsd,
    maxPriceDriftPct: roundPct(maxPriceDriftPct),
    openSpotCount,
    openFuturesCount,
    meanVolatilityPct: meanVol,
    driftDetected,
    triggerSummary: driftDetected
      ? `Reconciled $${Math.abs(equityDriftUsd).toFixed(2)} equity delta across ${openSpotCount} Spot / ${openFuturesCount} Futures legs.`
      : `0% Drift synchronized (${openSpotCount} Spot · ${openFuturesCount} Futures · ${meanVol.toFixed(2)}% mean vol).`,
  });

  if (driftDetected) {
    auditLedger = appendAuditEntry(auditLedger, {
      timestamp: nowIso,
      eventType: 'RECONCILIATION_RUN',
      market: 'PORTFOLIO',
      moduleId: 'PORTFOLIO',
      message: checkpoint.triggerSummary,
      portfolioDrawdownPct: drawdownPct,
    });
  }

  let nextState: ForgeCapitalHubState = {
    ...state,
    highWaterMarkUsd: nextHighWater,
    currentEquityUsd: computedEquity,
    walletBalanceUsd: safeWallet,
    unrealizedPnlUsd: totalUnrealizedPnl,
    portfolioDrawdownUsd: drawdownUsd,
    portfolioDrawdownPct: drawdownPct,
    allTradingHalted: state.failSafe.engaged,
    modules: nextModules,
    reconciliation: checkpoint,
    auditLedger,
  };

  if (!nextState.failSafe.engaged && drawdownPct >= nextState.portfolioDrawdownLimitPct) {
    nextState = engageImmutableFailSafe(
      nextState,
      `Hard portfolio drawdown breached: ${drawdownPct.toFixed(2)}% >= ${nextState.portfolioDrawdownLimitPct.toFixed(2)}% (Equity $${computedEquity.toFixed(2)} vs HWM $${nextHighWater.toFixed(2)}).`,
      nowIso
    );
  }

  return nextState;
}

export function routeDualExecutionOrder(
  state: ForgeCapitalHubState,
  request: DualExecutionOrderRequest
): DualExecutionRouteOutcome {
  const nowIso = request.nowIso ?? new Date().toISOString();
  const environment: ExecutionEnvironment = request.environment ?? 'TESTNET';
  const cleanSymbol = String(request.symbol || 'BTCUSDT')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const market: ForgeMarketChannel =
    request.market === 'USD_M_FUTURES' ? 'USD_M_FUTURES' : 'SPOT';
  const apiEndpoint = resolveBinanceExecutionEndpoint(market, environment);
  const leverage =
    market === 'SPOT'
      ? 1
      : Math.max(1, Math.min(125, Math.round(Number(request.leverage ?? 5))));
  const marginMode: MarginMode = request.marginMode === 'ISOLATED' ? 'ISOLATED' : 'CROSS';
  const notionalUsd = roundUsd(Math.max(0, Number(request.notionalUsd || 0)));

  const authPrice =
    request.authoritativePrice !== undefined &&
    Number.isFinite(request.authoritativePrice) &&
    request.authoritativePrice > 0
      ? request.authoritativePrice
      : request.submittedPrice;
  const slippagePct = computePriceDiscrepancyPct(authPrice, request.submittedPrice);
  const maxSlippagePct = request.maxSlippagePct ?? 1.5;

  const failRoute = (
    status: DualExecutionRouteRecord['status'],
    statusCode: number,
    reason: string,
    guardDenial?: GuardDenialContract,
    riskVerdict?: CanTradeVerdict,
    rejectionCode?: string
  ): DualExecutionRouteOutcome => {
    const record: DualExecutionRouteRecord = Object.freeze({
      id: `route_${Date.now()}_${state.routeHistory.length + 1}`,
      moduleId: request.moduleId,
      market,
      environment,
      apiEndpoint,
      symbol: cleanSymbol,
      direction: request.direction,
      notionalUsd,
      leverage,
      marginMode,
      validatedPrice: authPrice,
      priceDiscrepancyPct: slippagePct,
      status,
      reason,
      routedAt: nowIso,
    });
    const nextState: ForgeCapitalHubState = {
      ...state,
      lastGuardDenial: guardDenial ?? state.lastGuardDenial,
      routeHistory: [record, ...state.routeHistory].slice(0, 40),
      auditLedger: appendAuditEntry(state.auditLedger, {
        timestamp: nowIso,
        eventType: 'ORDER_REJECTED',
        market,
        moduleId: request.moduleId,
        message: `Blocked ${market} order (${cleanSymbol} ${request.direction} $${notionalUsd}): ${reason}`,
        portfolioDrawdownPct: state.portfolioDrawdownPct,
      }),
    };
    return {
      ok: false,
      statusCode,
      error: reason,
      guardDenial,
      riskVerdict,
      rejectionCode,
      routeRecord: record,
      nextState,
    };
  };

  if (request.appLiveEnabled === false) {
    return failRoute(
      'REJECTED_VALIDATION',
      423,
      'App Live Master Switch is paused — external API execution suspended.'
    );
  }

  // L0 Runtime Guard: Strict profile class matching, API scope authorization, and Paper/Live isolation
  const requestedProfile: RuntimeEnvironmentProfile = request.requestedProfile ?? environment;
  const activeContract = createEnvironmentProfileContract(environment, request.grantedScopes);
  const l0Guard = assertL0RuntimeDiscipline({
    activeContract,
    requestedProfile,
    credentialProfile: request.credentialEnvironment ?? requestedProfile,
    market,
    endpointUrl: apiEndpoint,
    stateNamespace: request.stateNamespace,
  });
  if (!l0Guard.passed) {
    return failRoute('REJECTED_L0_GUARD', 403, l0Guard.reason);
  }

  // Command 2 Synchronous 6-Layer Runtime Guard & Out-of-Band Mandate Gate
  const runtimeLock =
    request.guardProfileLock ??
    resolveRuntimeGuardStartupOrThrow({
      requestedProfile: environment === 'LIVE' ? 'Live-Trade' : state.activeGuardProfile ?? 'Paper-Trade',
      targetHostOrUrl: apiEndpoint,
      timestampUtc: nowIso,
    });
  const ledgerReconciled =
    Number.isFinite(state.reconciliation.computedEquityUsd) &&
    Math.abs(state.currentEquityUsd - state.reconciliation.computedEquityUsd) <= 0.05;
  const runtimeEval = evaluateRuntimeGuard({
    startupLock: runtimeLock,
    attemptedProfileSwitch: request.attemptedProfileSwitch,
    operation: 'PLACE_ORDER',
    targetEndpoint: apiEndpoint,
    venue: market === 'USD_M_FUTURES' ? 'BINANCE_USD_M_FUTURES' : 'BINANCE_SPOT',
    symbol: cleanSymbol,
    mandate: request.liveMandate ?? DEFAULT_LIVE_MANDATE,
    reconciliationHealthy: ledgerReconciled,
    nowUtc: nowIso,
  });
  if (!runtimeEval.allowed && runtimeEval.denial) {
    return failRoute(
      'REJECTED_L0_GUARD',
      runtimeEval.denial.reasonCode === 'LIVE_WRITE_REQUIRES_MANDATE' ? 423 : 403,
      `[${runtimeEval.denial.blockedByLayer}] ${runtimeEval.denial.message} Remediation: ${runtimeEval.denial.remediationHint}`,
      runtimeEval.denial
    );
  }

  // L2 Parity Gate: Halt Live deployment if live/paper telemetry diverges from backtest expectations
  const activeParity = request.parityGateInput
    ? evaluateParityGate(request.parityGateInput)
    : state.parityGate;
  const shouldEnforceParity = environment === 'LIVE' || request.enforceParityGate === true;
  if (!activeParity.passed && shouldEnforceParity) {
    return failRoute(
      'REJECTED_PARITY_GATE',
      423,
      activeParity.haltReason ||
        'L2 Parity Gate halted deployment: live/backtest divergence exceeded tolerance.'
    );
  }

  if (state.failSafe.engaged || state.allTradingHalted) {
    return failRoute(
      'REJECTED_FAIL_SAFE',
      423,
      `EMERGENCY_HALT (423 Locked) [${state.failSafe.immutableSealId || 'SEALED'}]: ${state.portfolioDrawdownPct.toFixed(2)}% DD >= ${state.portfolioDrawdownLimitPct.toFixed(1)}% cap. Spot, Futures, and WebSocket order generation are suspended.`
    );
  }

  if (!isForgeModuleId(request.moduleId)) {
    return failRoute('REJECTED_VALIDATION', 400, `Unknown Forge module "${String(request.moduleId)}".`);
  }
  const mod = state.modules[request.moduleId];
  if (!mod) {
    return failRoute('REJECTED_VALIDATION', 400, `Unknown Forge module "${request.moduleId}".`);
  }

  if (mod.status === 'SUSPENDED') {
    return failRoute(
      'REJECTED_MODULE_SUSPENDED',
      409,
      mod.suspensionReason ||
        `${mod.label} is isolated due to ${mod.drawdownPct.toFixed(2)}% drawdown (limit ${mod.volatilityAdjustedLimitPct.toFixed(2)}%).`
    );
  }

  if (!mod.allowedMarkets.includes(market)) {
    return failRoute(
      'REJECTED_VALIDATION',
      400,
      `${mod.label} is restricted to ${mod.allowedMarkets.join('/')} and cannot route on ${market}.`
    );
  }

  if (
    !cleanSymbol ||
    !Number.isFinite(request.submittedPrice) ||
    request.submittedPrice <= 0 ||
    notionalUsd < 25
  ) {
    return failRoute(
      'REJECTED_VALIDATION',
      400,
      'Order rejected: valid symbol, positive live price, and notional >= $25 required.'
    );
  }

  if (slippagePct > maxSlippagePct) {
    return failRoute(
      'REJECTED_VALIDATION',
      409,
      `Submitted price $${request.submittedPrice} diverged ${slippagePct.toFixed(2)}% from live mark $${authPrice} (max ${maxSlippagePct.toFixed(2)}%).`
    );
  }

  // Synchronous Pre-L2 Risk Engine Gate: every order intent must pass `can_trade()`
  const hasExplicitRiskParams =
    request.stopLoss !== undefined ||
    request.takeProfit !== undefined ||
    request.intentStopLoss !== undefined ||
    request.intentTakeProfit !== undefined ||
    request.signalReceipt !== undefined ||
    request.enforceRRGate === true;
  const fallbackStop =
    request.direction === 'BUY'
      ? Number((authPrice * 0.99).toPrecision(6))
      : Number((authPrice * 1.01).toPrecision(6));
  const fallbackTarget =
    request.direction === 'BUY'
      ? Number((authPrice + (authPrice - fallbackStop) * MIN_RR_KERNEL_CONSTANT * 1.01).toPrecision(6))
      : Number(
          Math.max(
            1e-8,
            authPrice - (fallbackStop - authPrice) * MIN_RR_KERNEL_CONSTANT * 1.01
          ).toPrecision(6)
        );
  const effectiveRiskState =
    state.riskEngine ??
    createInitialRiskEngineState({
      initialCapitalUsd: state.highWaterMarkUsd || 25_000,
      strategyIds: FORGE_MODULE_ORDER,
    });
  const canTradeVerdict = can_trade({
    riskState: effectiveRiskState,
    strategyId: request.moduleId,
    symbol: cleanSymbol,
    direction: request.direction,
    regime: request.regime ?? 'NORMAL',
    signalEntryPrice: request.signalReceipt?.signalEntryPrice ?? request.submittedPrice,
    orderIntentPrice: authPrice,
    stopLoss: hasExplicitRiskParams ? request.stopLoss : fallbackStop,
    takeProfit: hasExplicitRiskParams ? request.takeProfit : fallbackTarget,
    intentStopLoss: request.intentStopLoss,
    intentTakeProfit: request.intentTakeProfit,
    stopOrigin: request.stopOrigin,
    targetOrigin: request.targetOrigin,
    signalReceipt: request.signalReceipt,
    maxRiskPct: request.maxRiskPct,
    runtimeGuardAllowed: true,
    checkedAtUtc: nowIso,
  });

  if (!canTradeVerdict.allowed) {
    return failRoute(
      'REJECTED_VALIDATION',
      422,
      canTradeVerdict.reason,
      undefined,
      canTradeVerdict,
      canTradeVerdict.rejectionCode ?? undefined
    );
  }

  const record: DualExecutionRouteRecord = Object.freeze({
    id: `route_${Date.now()}_${state.routeHistory.length + 1}`,
    moduleId: request.moduleId,
    market,
    environment,
    apiEndpoint,
    symbol: cleanSymbol,
    direction: request.direction,
    notionalUsd,
    leverage,
    marginMode,
    validatedPrice: authPrice,
    priceDiscrepancyPct: slippagePct,
    status: 'ROUTED',
    reason: `Dispatched via ${apiEndpoint} (${market === 'USD_M_FUTURES' ? `${leverage}x ${marginMode}` : '1x SPOT'}) [${mod.label}].`,
    routedAt: nowIso,
  });

  const nextState: ForgeCapitalHubState = {
    ...state,
    modules: {
      ...state.modules,
      [request.moduleId]: {
        ...mod,
        totalRoutedOrders: mod.totalRoutedOrders + 1,
        lastRoutedAt: nowIso,
      },
    },
    routeHistory: [record, ...state.routeHistory].slice(0, 40),
    auditLedger: appendAuditEntry(state.auditLedger, {
      timestamp: nowIso,
      eventType: 'DUAL_ORDER_ROUTED',
      market,
      moduleId: request.moduleId,
      message: `${record.reason} ${cleanSymbol} ${request.direction} $${notionalUsd.toFixed(0)} @ $${authPrice}.`,
      portfolioDrawdownPct: state.portfolioDrawdownPct,
    }),
  };

  return {
    ok: true,
    statusCode: 200,
    riskVerdict: canTradeVerdict,
    routeRecord: record,
    nextState,
  };
}

/**
 * Builds a unified SandboxPosition from a validated DualExecutionRouteRecord
 * so both Forge Capital Hub Master Desk and Live Testnet Execution Ledger stay 1:1 synchronized.
 */
export function createRoutedSandboxPosition(
  routeRecord: DualExecutionRouteRecord,
  options?: {
    atr14?: number;
    liquidationPrice?: number;
    fundingRate?: number;
    maintenanceMarginUsd?: number;
  }
): SandboxPosition {
  const entry = routeRecord.validatedPrice;
  const lev = Math.max(1, routeRecord.leverage || 1);
  const atr = Math.max(options?.atr14 ?? entry * 0.015, entry * 0.004);
  const kernelRisk = buildKernelValidatedRiskProfile({
    direction: routeRecord.direction,
    entryPrice: entry,
    closedCandles: [],
    atr14: atr,
    minAtrFloorMult: 1.25,
    maxAtrCeilingMult: 1.65,
    maxRiskPct: 2.0,
    targetRR: 5.0,
  });
  const initialStopLoss = kernelRisk.stopLoss;
  const trailingStopLoss = kernelRisk.stopLoss;
  const [tp1, tp2, trailingTp5x] = kernelRisk.takeProfits;

  return {
    id: `${routeRecord.market === 'USD_M_FUTURES' ? 'fut' : 'spot'}_${routeRecord.environment}_${routeRecord.symbol}_${Date.now()}`,
    symbol: routeRecord.symbol,
    direction: routeRecord.direction,
    mode: routeRecord.environment,
    marketType: routeRecord.market,
    marginMode: routeRecord.marginMode,
    leverage: lev,
    entryPrice: entry,
    quantity: Number((routeRecord.notionalUsd / Math.max(entry, 1e-8)).toFixed(5)),
    notionalUsd: routeRecord.notionalUsd,
    initialMarginUsd: roundUsd(routeRecord.notionalUsd / lev),
    maintenanceMarginUsd:
      options?.maintenanceMarginUsd ??
      (routeRecord.market === 'USD_M_FUTURES' ? roundUsd(routeRecord.notionalUsd * 0.005) : 0),
    liquidationPrice: options?.liquidationPrice ?? 0,
    fundingRate: options?.fundingRate ?? (routeRecord.market === 'USD_M_FUTURES' ? 0.0001 : 0),
    settledFundingUsd: 0,
    initialStopLoss,
    trailingStopLoss,
    maxStopLossPct: 2.0,
    trailingTakeProfit5xAtr: trailingTp5x,
    peakFavorablePrice: entry,
    takeProfits: [tp1, tp2, trailingTp5x],
    status: 'OPEN',
    pnlUsd: 0,
    pnlPercent: 0,
    roePercent: 0,
    skepticVerdict: 'APPROVED',
    autonomousEntry: routeRecord.moduleId === 'AUTONOMOUS_AI_AGENTS',
    entrySourceReason: `Forge Hub [${routeRecord.moduleId}] -> ${routeRecord.apiEndpoint}`,
    openedAt: routeRecord.routedAt,
  };
}

/**
 * Aggregates all open/closed positions, live mark-to-market PnL, audit ledger entries,
 * and dual routes into a single unified state snapshot consumed by BOTH ForgeCapitalHub & LiveTestnetLedger (0% drift).
 */
export function buildUnifiedCapitalLedgerState(params: {
  positions: ReadonlyArray<SandboxPosition>;
  walletBalanceUsd: number;
  tickers: Record<string, TickerSnapshot>;
  candlesMap: Record<string, Candle[]>;
  forgeCapitalState: ForgeCapitalHubState;
  cmcValuations?: Record<string, CmcBaselineValuation>;
  spotCmcValidations?: Record<string, SpotCmcValidationResult>;
  liveTrackingActive?: boolean;
}): UnifiedCapitalLedgerState {
  const {
    positions,
    walletBalanceUsd,
    tickers,
    candlesMap,
    forgeCapitalState,
    cmcValuations = {},
    spotCmcValidations = {},
    liveTrackingActive = true,
  } = params;

  const safePositions = Array.isArray(positions) ? positions : [];
  const safeWallet =
    Number.isFinite(walletBalanceUsd) && walletBalanceUsd >= 0
      ? roundUsd(walletBalanceUsd)
      : forgeCapitalState.walletBalanceUsd;

  const unifiedPositions: UnifiedExecutionPosition[] = safePositions
    .filter((pos): pos is SandboxPosition => Boolean(pos && pos.symbol))
    .map((pos) => {
      const safeEntry =
        Number.isFinite(pos.entryPrice) && pos.entryPrice > 0 ? pos.entryPrice : 1;
      const safeNotional =
        Number.isFinite(pos.notionalUsd) && pos.notionalUsd > 0 ? pos.notionalUsd : 0;
      const tickerPrice = tickers?.[pos.symbol]?.price;
      const livePrice =
        tickerPrice !== undefined && Number.isFinite(tickerPrice) && tickerPrice > 0
          ? tickerPrice
          : safeEntry;

      const candles = candlesMap?.[pos.symbol] || [];
      const approxAtr =
        candles.length >= 2
          ? Math.max(
              livePrice * 0.006,
              candles
                .slice(-14)
                .reduce((acc, c) => acc + Math.max(0, c.high - c.low), 0) /
                Math.min(14, candles.length)
            )
          : livePrice * 0.015;

      const liveTrailSl =
        pos.status === 'OPEN' && liveTrackingActive
          ? advanceMonotonicTrailingStop({
              direction: pos.direction,
              prevStopLoss: pos.trailingStopLoss,
              initialStopLoss: pos.initialStopLoss,
              closedBar: { high: livePrice, low: livePrice, close: livePrice },
              atr14: approxAtr,
              atrMultiplier: 1.25,
            }).nextStopLoss
          : pos.trailingStopLoss;

      const settledFunding = Number.isFinite(pos.settledFundingUsd ?? 0)
        ? (pos.settledFundingUsd ?? 0)
        : 0;
      const priceDeltaRatio =
        pos.direction === 'BUY'
          ? (livePrice - safeEntry) / safeEntry
          : (safeEntry - livePrice) / safeEntry;
      const pnlPercent =
        pos.status === 'OPEN'
          ? priceDeltaRatio * 100
          : Number.isFinite(pos.pnlPercent)
          ? pos.pnlPercent
          : 0;

      const livePnlUsd =
        pos.status === 'OPEN'
          ? roundUsd(safeNotional * priceDeltaRatio + settledFunding)
          : Number.isFinite(pos.pnlUsd)
          ? roundUsd(pos.pnlUsd)
          : 0;

      const effectiveLev = Math.max(
        1,
        Number.isFinite(pos.leverage ?? 1) ? (pos.leverage ?? 1) : 1
      );
      const initialMargin =
        pos.initialMarginUsd && Number.isFinite(pos.initialMarginUsd)
          ? pos.initialMarginUsd
          : safeNotional / effectiveLev;
      const liveRoePercent =
        pos.status === 'OPEN'
          ? Number(((livePnlUsd / Math.max(1, initialMargin)) * 100).toFixed(2))
          : pos.roePercent ?? Number((pnlPercent * effectiveLev).toFixed(2));

      const moduleId = inferPositionModuleId(pos);
      const marketKind: ForgeMarketChannel =
        pos.marketType ?? (effectiveLev > 1 ? 'USD_M_FUTURES' : 'SPOT');
      const apiEndpoint = resolveBinanceExecutionEndpoint(marketKind, pos.mode);
      const cmcValuation = cmcValuations[pos.symbol];
      const validation = spotCmcValidations[pos.symbol];

      return Object.freeze({
        ...pos,
        moduleId,
        moduleLabel: FORGE_MODULE_LABELS[moduleId],
        apiEndpoint,
        livePrice,
        liveTrailSl,
        livePnlPercent: Number(pnlPercent.toFixed(2)),
        livePnlUsd,
        liveRoePercent,
        effectiveLev,
        marketKind,
        cmcPriceUsd: cmcValuation?.cmcPriceUsd ?? null,
        cmcAligned: validation ? !validation.anomalyIsolated : true,
      });
    });

  const openPositions = unifiedPositions.filter((p) => p.status === 'OPEN');
  const closedPositions = unifiedPositions.filter((p) => p.status !== 'OPEN');

  const totalOpenPnlUsd = roundUsd(
    openPositions.reduce((sum, p) => sum + p.livePnlUsd, 0)
  );
  const totalRealizedPnlUsd = roundUsd(
    closedPositions.reduce((sum, p) => sum + p.livePnlUsd, 0)
  );
  const netPnlUsd = roundUsd(totalOpenPnlUsd + totalRealizedPnlUsd);
  const liveEquityUsd = roundUsd(Math.max(0, safeWallet + totalOpenPnlUsd));
  const hubEquityBase = Math.max(
    1,
    forgeCapitalState.currentEquityUsd > 0 ? forgeCapitalState.currentEquityUsd : liveEquityUsd
  );
  const equityDeltaUsd = Math.abs(liveEquityUsd - forgeCapitalState.currentEquityUsd);
  const rawDivergencePct =
    equityDeltaUsd < 0.02
      ? 0
      : Number(((equityDeltaUsd / hubEquityBase) * 100).toFixed(4));
  const walletParityDivergencePct = rawDivergencePct;
  const walletParityVerified = walletParityDivergencePct <= 0.01;

  return Object.freeze({
    reconciledAt: forgeCapitalState.reconciliation.reconciledAt,
    emergencyHalted: forgeCapitalState.failSafe.engaged || forgeCapitalState.allTradingHalted,
    haltCode: forgeCapitalState.failSafe.haltCode,
    httpStatusLock: forgeCapitalState.failSafe.httpStatusLock,
    openPositionsCount: openPositions.length,
    closedPositionsCount: closedPositions.length,
    totalOpenPnlUsd,
    totalRealizedPnlUsd,
    netPnlUsd,
    liveEquityUsd,
    walletParityDivergencePct,
    walletParityVerified,
    positions: Object.freeze(unifiedPositions),
    ledgerEntries: forgeCapitalState.auditLedger,
    routes: forgeCapitalState.routeHistory,
  });
}

export function setForgeModuleSuspension(
  state: ForgeCapitalHubState,
  moduleId: ForgeModuleId,
  suspend: boolean,
  reason?: string,
  nowIso = new Date().toISOString()
): { ok: boolean; error?: string; nextState: ForgeCapitalHubState } {
  const mod = state.modules[moduleId];
  if (!mod) {
    return { ok: false, error: `Unknown module ${moduleId}`, nextState: state };
  }

  if (!suspend) {
    if (state.failSafe.engaged) {
      return {
        ok: false,
        error: 'Cannot resume module while Portfolio EMERGENCY_HALT (423 Locked) is engaged.',
        nextState: state,
      };
    }
    if (mod.drawdownPct >= mod.volatilityAdjustedLimitPct) {
      return {
        ok: false,
        error: `Cannot resume ${mod.label}: drawdown ${mod.drawdownPct.toFixed(2)}% still exceeds ${mod.volatilityAdjustedLimitPct.toFixed(2)}% threshold.`,
        nextState: state,
      };
    }
  }

  const nextState: ForgeCapitalHubState = {
    ...state,
    modules: {
      ...state.modules,
      [moduleId]: {
        ...mod,
        status: suspend ? 'SUSPENDED' : 'ACTIVE',
        suspendedAt: suspend ? nowIso : null,
        suspensionReason: suspend
          ? reason || 'Operator isolated module manually.'
          : null,
      },
    },
    auditLedger: appendAuditEntry(state.auditLedger, {
      timestamp: nowIso,
      eventType: suspend ? 'MODULE_SUSPENDED' : 'MODULE_RESUMED',
      market: mod.primaryMarket,
      moduleId,
      message: suspend
        ? `${mod.label} suspended: ${reason || 'Operator intervention'}`
        : `${mod.label} restored to ACTIVE routing status.`,
      portfolioDrawdownPct: state.portfolioDrawdownPct,
    }),
  };

  return { ok: true, nextState };
}

export function recoverFromImmutableFailSafe(
  state: ForgeCapitalHubState,
  params: {
    confirmationCode: string;
    expectedCode?: string;
    serverAuthorized?: boolean;
    operatorReason: string;
    nowIso?: string;
  }
): { ok: boolean; error?: string; nextState: ForgeCapitalHubState } {
  const nowIso = params.nowIso ?? new Date().toISOString();
  if (!state.failSafe.engaged) {
    return { ok: true, nextState: state };
  }
  const submitted = String(params.confirmationCode || '').trim();
  const expected = params.expectedCode !== undefined ? String(params.expectedCode).trim() : '';
  const isAuthorized =
    params.serverAuthorized === true ||
    (expected.length >= 8 && submitted.length > 0 && timingSafeEqualStr(submitted, expected));

  if (!isAuthorized) {
    return {
      ok: false,
      error:
        'Invalid or unauthorized fail-safe recovery code. Obtain a server operator seal challenge to authorize recovery.',
      nextState: state,
    };
  }
  if (params.operatorReason.trim().length < 6) {
    return {
      ok: false,
      error: 'Provide an operator recovery justification (min 6 characters) for the audit ledger.',
      nextState: state,
    };
  }

  const resetEquity = state.currentEquityUsd;
  const nextModules: Record<ForgeModuleId, ForgeModuleRiskProfile> = {
    ...state.modules,
  };
  for (const modId of FORGE_MODULE_ORDER) {
    const mod = nextModules[modId];
    if (!mod) continue;
    nextModules[modId] = {
      ...mod,
      highWaterMarkUsd: mod.currentEquityUsd,
      drawdownPct: 0,
      status: 'ACTIVE',
      suspendedAt: null,
      suspensionReason: null,
    };
  }

  const nextFailSafe: FailSafeLockSnapshot = Object.freeze({
    engaged: false,
    haltCode: 'NOMINAL',
    httpStatusLock: 200,
    immutableSealId: state.failSafe.immutableSealId,
    triggeredAt: state.failSafe.triggeredAt,
    triggerDrawdownPct: state.failSafe.triggerDrawdownPct,
    enforcedLimitPct: state.portfolioDrawdownLimitPct,
    breachEquityUsd: state.failSafe.breachEquityUsd,
    highWaterMarkUsd: resetEquity,
    reason: null,
    operatorResetCount: state.failSafe.operatorResetCount + 1,
    lastResetAt: nowIso,
    lastResetReason: params.operatorReason.trim(),
  });

  const nextState: ForgeCapitalHubState = {
    ...state,
    highWaterMarkUsd: resetEquity,
    portfolioDrawdownUsd: 0,
    portfolioDrawdownPct: 0,
    allTradingHalted: false,
    failSafe: nextFailSafe,
    modules: nextModules,
    auditLedger: appendAuditEntry(state.auditLedger, {
      timestamp: nowIso,
      eventType: 'FAIL_SAFE_RESET',
      market: 'PORTFOLIO',
      moduleId: 'PORTFOLIO',
      message: `Operator recovery executed for seal ${state.failSafe.immutableSealId} (HWM re-anchored to $${resetEquity.toFixed(2)}): ${params.operatorReason.trim()}`,
      portfolioDrawdownPct: 0,
    }),
  };

  return { ok: true, nextState };
}

export function recordForgeApiError(
  state: ForgeCapitalHubState,
  input: {
    market: ForgeMarketChannel | 'SYSTEM';
    moduleId?: ForgeModuleId | 'SYSTEM';
    endpoint: string;
    httpStatus: number;
    exchangeCode?: string | number;
    latencyMs?: number;
    message: string;
    nowIso?: string;
  }
): ForgeCapitalHubState {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const status = Number.isFinite(input.httpStatus) ? Math.round(input.httpStatus) : 500;
  const exchangeCode = String(
    input.exchangeCode ?? (status >= 500 ? 'EXCHANGE_5XX' : 'API_REJECTED')
  );
  const retryable = status === 429 || status === 408 || status >= 500 || status === 0;
  const severity: ApiErrorLogEntry['severity'] =
    status >= 500 || status === 401 || status === 403
      ? 'CRITICAL'
      : status === 429 || status === 409 || status === 423
      ? 'ERROR'
      : 'WARN';

  const entry: ApiErrorLogEntry = Object.freeze({
    id: `fch_err_${Date.now()}_${state.apiErrorLogs.length + 1}`,
    timestamp: nowIso,
    market: input.market,
    moduleId: input.moduleId ?? 'SYSTEM',
    endpoint: input.endpoint,
    httpStatus: status,
    exchangeCode,
    severity,
    retryable,
    latencyMs: Math.max(1, Math.round(Number(input.latencyMs ?? 120))),
    message: input.message,
  });

  return {
    ...state,
    apiErrorLogs: [entry, ...state.apiErrorLogs].slice(0, 60),
    auditLedger: appendAuditEntry(state.auditLedger, {
      timestamp: nowIso,
      eventType: 'API_ERROR_RECORDED',
      market: input.market === 'SYSTEM' ? 'PORTFOLIO' : input.market,
      moduleId: input.moduleId && input.moduleId !== 'SYSTEM' ? input.moduleId : 'PORTFOLIO',
      message: `[${input.market} ${status}/${exchangeCode}] ${input.message}`,
      portfolioDrawdownPct: state.portfolioDrawdownPct,
    }),
  };
}

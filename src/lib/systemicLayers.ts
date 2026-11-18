import { computeATR } from './coordinator';
import {
  advanceMonotonicTrailingStop,
  deriveStructuralStop,
  detectMarketRegimeFromClosedWindow,
  evaluateRRGate,
  evaluateRegimeAwareScaling,
  type MarketRegime,
  type RRGateEvaluation,
  type StructuralStopResult,
} from './invariantKernels';
import type { Candle, Timeframe } from './marketData';
import {
  BacktestFeed,
  TripwireFeed,
  issueEngineLoopToken,
  type SignalToFillBoundary,
} from './pitFeed';
import { calculateEMA, calculateRSI } from './signals';
import {
  DEFAULT_EXECUTION_ALGORITHM,
  FILL_MODEL_KERNEL_ARTIFACT,
  computeLayeredSlippageBreakdown,
  roundDet,
  type ExecutionAlgorithmId,
  type SlippageContributorBreakdown,
} from './fillModel';
import {
  checkRROrderIntent,
  checkRRSignalEmission,
  roundTargetPreservingFloor,
} from './riskEngine';

/* ═══════════════════════════════════════════════════════════════════════════
 * L0 — RUNTIME GUARD & ENVIRONMENT DISCIPLINE
 * Strict class matching, API scope enforcement, Paper/Testnet vs Live isolation
 * ═══════════════════════════════════════════════════════════════════════════ */

export type RuntimeEnvironmentProfile = 'PAPER' | 'TESTNET' | 'LIVE';

export type ProfileClassName = 'PaperProfile' | 'TestnetProfile' | 'LiveProfile';

export type BinanceApiScope =
  | 'READ_MARKET'
  | 'PAPER_SIM'
  | 'TESTNET_TRADE'
  | 'LIVE_SPOT_TRADE'
  | 'LIVE_FUTURES_TRADE';

export type L0MarketKind = 'SPOT' | 'USD_M_FUTURES';

export interface EnvironmentProfileContract {
  readonly profile: RuntimeEnvironmentProfile;
  readonly profileClass: ProfileClassName;
  readonly ledgerNamespace: string;
  readonly allowedEndpoints: ReadonlyArray<string>;
  readonly grantedScopes: ReadonlyArray<BinanceApiScope>;
}

const PROFILE_CLASS_MAP: Record<RuntimeEnvironmentProfile, ProfileClassName> = {
  PAPER: 'PaperProfile',
  TESTNET: 'TestnetProfile',
  LIVE: 'LiveProfile',
};

const PROFILE_ENDPOINTS_MAP: Record<RuntimeEnvironmentProfile, ReadonlyArray<string>> = {
  PAPER: ['paper://local-simulator/v1/order'],
  TESTNET: [
    'https://testnet.binance.vision/api/v3/order',
    'https://testnet.binancefuture.com/fapi/v1/order',
  ],
  LIVE: [
    'https://api.binance.com/api/v3/order',
    'https://fapi.binance.com/fapi/v1/order',
  ],
};

export function createEnvironmentProfileContract(
  profile: RuntimeEnvironmentProfile,
  grantedScopes?: ReadonlyArray<BinanceApiScope>
): EnvironmentProfileContract {
  const defaultScopes: Record<RuntimeEnvironmentProfile, ReadonlyArray<BinanceApiScope>> = {
    PAPER: ['READ_MARKET', 'PAPER_SIM'],
    TESTNET: ['READ_MARKET', 'TESTNET_TRADE'],
    LIVE: ['READ_MARKET', 'LIVE_SPOT_TRADE', 'LIVE_FUTURES_TRADE'],
  };

  return Object.freeze({
    profile,
    profileClass: PROFILE_CLASS_MAP[profile],
    ledgerNamespace: `forge_state_${profile.toLowerCase()}`,
    allowedEndpoints: Object.freeze([...PROFILE_ENDPOINTS_MAP[profile]]),
    grantedScopes: Object.freeze([...(grantedScopes ?? defaultScopes[profile])]),
  });
}

export interface L0RuntimeGuardInput {
  readonly activeContract: EnvironmentProfileContract;
  readonly requestedProfile: RuntimeEnvironmentProfile;
  readonly credentialProfile: RuntimeEnvironmentProfile;
  readonly market: L0MarketKind;
  readonly endpointUrl: string;
  readonly stateNamespace?: string;
}

export interface L0RuntimeGuardResult {
  readonly passed: boolean;
  readonly expectedClass: ProfileClassName;
  readonly actualCredentialClass: ProfileClassName;
  readonly requiredScope: BinanceApiScope;
  readonly endpointMatched: boolean;
  readonly stateIsolated: boolean;
  readonly violations: ReadonlyArray<string>;
  readonly reason: string;
}

export function assertL0RuntimeDiscipline(input: L0RuntimeGuardInput): L0RuntimeGuardResult {
  const violations: string[] = [];
  const { activeContract, requestedProfile, credentialProfile, market, endpointUrl, stateNamespace } =
    input;

  const expectedClass = PROFILE_CLASS_MAP[activeContract.profile];
  const requestedClass = PROFILE_CLASS_MAP[requestedProfile];
  const actualCredentialClass = PROFILE_CLASS_MAP[credentialProfile];

  if (activeContract.profileClass !== expectedClass || requestedClass !== expectedClass) {
    violations.push(
      `Profile class mismatch: active=${activeContract.profileClass}, requested=${requestedClass}.`
    );
  }

  if (actualCredentialClass !== expectedClass) {
    violations.push(
      `Cross-profile isolation breach: credential class ${actualCredentialClass} cannot execute inside ${expectedClass}.`
    );
  }

  const requiredScope: BinanceApiScope =
    activeContract.profile === 'LIVE'
      ? market === 'USD_M_FUTURES'
        ? 'LIVE_FUTURES_TRADE'
        : 'LIVE_SPOT_TRADE'
      : activeContract.profile === 'TESTNET'
      ? 'TESTNET_TRADE'
      : 'PAPER_SIM';

  if (!activeContract.grantedScopes.includes(requiredScope)) {
    violations.push(
      `Missing API permission scope "${requiredScope}" for ${activeContract.profile} ${market}.`
    );
  }

  const endpointMatched = activeContract.allowedEndpoints.includes(endpointUrl);
  if (!endpointMatched) {
    violations.push(
      `Endpoint discipline violation: "${endpointUrl}" is forbidden under ${activeContract.profileClass}.`
    );
  }

  const stateIsolated =
    stateNamespace === undefined || stateNamespace === activeContract.ledgerNamespace;
  if (!stateIsolated) {
    violations.push(
      `State namespace bleed detected: "${stateNamespace}" !== "${activeContract.ledgerNamespace}".`
    );
  }

  const passed = violations.length === 0;
  return Object.freeze({
    passed,
    expectedClass,
    actualCredentialClass,
    requiredScope,
    endpointMatched,
    stateIsolated,
    violations: Object.freeze(violations),
    reason: passed
      ? `L0 Runtime Guard verified ${expectedClass} · scope=${requiredScope} · endpoint isolated.`
      : `L0 Runtime Guard REJECTED: ${violations.join(' | ')}`,
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * L1 — DATA LAYER & LOOK-AHEAD BIAS GUARD
 * Point-in-Time monotonic cursor streams & dynamic closed-window computation
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface PointInTimeIndicators {
  readonly cursorIndex: number;
  readonly cursorTime: number;
  readonly closedBarCount: number;
  readonly lastClose: number;
  readonly ema9: number;
  readonly ema21: number;
  readonly ema50: number;
  readonly rsi14: number;
  readonly atr14: number;
  readonly atrPercent: number;
  readonly regime: MarketRegime;
  readonly computedDynamicallyOnClosedWindow: true;
}

/**
 * Computes all indicators strictly over closed candles [0 .. cursor] with zero
 * precomputed future arrays.
 */
export function computeDynamicClosedWindowIndicators(
  closedCandles: ReadonlyArray<Candle>,
  cursorIndexOverride?: number
): PointInTimeIndicators {
  if (closedCandles.length === 0) {
    return Object.freeze({
      cursorIndex: -1,
      cursorTime: 0,
      closedBarCount: 0,
      lastClose: 0,
      ema9: 0,
      ema21: 0,
      ema50: 0,
      rsi14: 50,
      atr14: 0,
      atrPercent: 0,
      regime: 'NORMAL',
      computedDynamicallyOnClosedWindow: true as const,
    });
  }

  const closes = closedCandles.map((c) => c.close);
  const lastCandle = closedCandles[closedCandles.length - 1];
  const ema9Arr = calculateEMA(closes, 9);
  const ema21Arr = calculateEMA(closes, 21);
  const ema50Arr = calculateEMA(closes, 50);
  const rsi14 = calculateRSI(closes, 14);
  const atr14 = computeATR([...closedCandles], 14);
  const lastClose = lastCandle.close;
  const atrPercent = lastClose > 0 ? Number(((atr14 / lastClose) * 100).toFixed(4)) : 0;
  const regime = detectMarketRegimeFromClosedWindow(closedCandles);

  return Object.freeze({
    cursorIndex: cursorIndexOverride ?? closedCandles.length - 1,
    cursorTime: lastCandle.time,
    closedBarCount: closedCandles.length,
    lastClose,
    ema9: Number((ema9Arr[ema9Arr.length - 1] ?? lastClose).toPrecision(6)),
    ema21: Number((ema21Arr[ema21Arr.length - 1] ?? lastClose).toPrecision(6)),
    ema50: Number((ema50Arr[ema50Arr.length - 1] ?? lastClose).toPrecision(6)),
    rsi14,
    atr14,
    atrPercent,
    regime,
    computedDynamicallyOnClosedWindow: true as const,
  });
}

export class PointInTimeStream {
  private readonly bars: ReadonlyArray<Candle>;
  private cursorIdx = -1;
  private lastCommittedTime = -Infinity;

  constructor(candles: ReadonlyArray<Candle>) {
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].time <= candles[i - 1].time) {
        throw new Error(
          `L1 Look-Ahead/Ordering violation: candle[${i}].time (${candles[i].time}) <= candle[${i - 1}].time (${candles[i - 1].time}).`
        );
      }
    }
    this.bars = Object.freeze(candles.map((c) => Object.freeze({ ...c })));
  }

  get totalBars(): number {
    return this.bars.length;
  }

  get cursorIndex(): number {
    return this.cursorIdx;
  }

  get cursorTime(): number {
    return this.cursorIdx >= 0 ? this.bars[this.cursorIdx].time : 0;
  }

  advanceTo(nextIndex: number): Candle {
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= this.bars.length) {
      throw new Error(
        `L1 Point-in-Time bounds error: index ${nextIndex} out of [0, ${this.bars.length - 1}].`
      );
    }
    if (nextIndex <= this.cursorIdx) {
      throw new Error(
        `L1 Monotonic cursor violation: attempted index ${nextIndex} <= current cursor ${this.cursorIdx}.`
      );
    }
    const bar = this.bars[nextIndex];
    if (bar.time <= this.lastCommittedTime) {
      throw new Error(
        `L1 Monotonic timestamp violation: bar.time ${bar.time} <= ${this.lastCommittedTime}.`
      );
    }
    this.cursorIdx = nextIndex;
    this.lastCommittedTime = bar.time;
    return bar;
  }

  getClosedWindow(lookback?: number): ReadonlyArray<Candle> {
    if (this.cursorIdx < 0) return Object.freeze([]);
    const start =
      lookback !== undefined && lookback > 0
        ? Math.max(0, this.cursorIdx + 1 - lookback)
        : 0;
    return Object.freeze(this.bars.slice(start, this.cursorIdx + 1));
  }

  getCurrentBar(): Candle | null {
    return this.cursorIdx >= 0 ? this.bars[this.cursorIdx] : null;
  }

  computeIndicatorsAtCursor(lookback = 120): PointInTimeIndicators {
    const closed = this.getClosedWindow(lookback);
    return computeDynamicClosedWindowIndicators(closed, this.cursorIdx);
  }
}

export function verifyZeroLookAheadLeakage(
  candles: ReadonlyArray<Candle>,
  cursorIndex: number
): {
  readonly leakFree: boolean;
  readonly cursorIndex: number;
  readonly baselineIndicators: PointInTimeIndicators;
  readonly perturbedIndicators: PointInTimeIndicators;
} {
  if (cursorIndex < 15 || cursorIndex >= candles.length - 1) {
    throw new Error('Cursor index must leave >= 15 closed bars and >= 1 future bar to perturb.');
  }

  const streamBase = new PointInTimeStream(candles);
  for (let i = 0; i <= cursorIndex; i++) streamBase.advanceTo(i);
  const baselineIndicators = streamBase.computeIndicatorsAtCursor();

  const mutatedCandles = candles.map((c, idx) =>
    idx > cursorIndex
      ? {
          ...c,
          open: c.open * 4.2,
          high: c.high * 5.5,
          low: c.low * 0.25,
          close: c.close * 4.8,
          volume: c.volume * 20,
        }
      : c
  );

  const streamMutated = new PointInTimeStream(mutatedCandles);
  for (let i = 0; i <= cursorIndex; i++) streamMutated.advanceTo(i);
  const perturbedIndicators = streamMutated.computeIndicatorsAtCursor();

  const leakFree =
    baselineIndicators.ema9 === perturbedIndicators.ema9 &&
    baselineIndicators.ema21 === perturbedIndicators.ema21 &&
    baselineIndicators.ema50 === perturbedIndicators.ema50 &&
    baselineIndicators.rsi14 === perturbedIndicators.rsi14 &&
    baselineIndicators.atr14 === perturbedIndicators.atr14 &&
    baselineIndicators.regime === perturbedIndicators.regime;

  return Object.freeze({
    leakFree,
    cursorIndex,
    baselineIndicators,
    perturbedIndicators,
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * L2 — EXECUTION ENGINE & FILL MODEL + PARITY GATE
 * Independent Decision Contract vs Execution Contract, Multi-Layered Friction
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface TradeDecisionContract {
  readonly contractType: 'DECISION_CONTRACT';
  readonly decisionId: string;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly direction: 'BUY' | 'SELL';
  readonly cursorTime: number;
  readonly decisionPrice: number;
  readonly regime: MarketRegime;
  readonly atr14: number;
  readonly atrPercent: number;
  readonly structuralStop: StructuralStopResult;
  readonly rrGate: RRGateEvaluation;
  readonly takeProfit: number;
}

export interface ExecutionFillInput {
  readonly decision: TradeDecisionContract;
  readonly environment: RuntimeEnvironmentProfile;
  readonly market: L0MarketKind;
  readonly notionalUsd: number;
  readonly barVolumeUsd: number;
  readonly spreadBps?: number;
  readonly latencyBps?: number;
  readonly feeBps?: number;
}

export interface ExecutionOrderContract {
  readonly contractType: 'EXECUTION_CONTRACT';
  readonly executionId: string;
  readonly decisionId: string;
  readonly fillModelHash: string;
  readonly executionAlgorithm: ExecutionAlgorithmId;
  readonly environment: RuntimeEnvironmentProfile;
  readonly market: L0MarketKind;
  readonly symbol: string;
  readonly direction: 'BUY' | 'SELL';
  readonly notionalUsd: number;
  readonly quotedPrice: number;
  readonly effectiveFillPrice: number;
  readonly spreadCostBps: number;
  readonly volumeImpactBps: number;
  readonly latencyFrictionBps: number;
  readonly slippageBreakdown: SlippageContributorBreakdown;
  readonly feeBps: number;
  readonly totalFrictionBps: number;
  readonly feeUsd: number;
  readonly status: 'FILLED' | 'REJECTED_RR_GATE';
}

export function buildTradeDecisionContract(params: {
  symbol: string;
  timeframe: Timeframe;
  direction: 'BUY' | 'SELL';
  closedCandles: ReadonlyArray<Candle>;
  indicators: PointInTimeIndicators;
  targetRR?: number;
  atrStopMinMult?: number;
  atrStopMaxMult?: number;
  maxRiskPct?: number;
}): TradeDecisionContract {
  const {
    symbol,
    timeframe,
    direction,
    closedCandles,
    indicators,
    targetRR = 5.4,
    atrStopMinMult = 0.75,
    atrStopMaxMult = 2.5,
    maxRiskPct = 2.0,
  } = params;

  const entryPrice = indicators.lastClose;
  const structuralStop = deriveStructuralStop({
    direction,
    entryPrice,
    closedCandles,
    atr14: indicators.atr14,
    minAtrFloorMult: atrStopMinMult,
    maxAtrCeilingMult: atrStopMaxMult,
    maxRiskPct,
  });

  const riskDist = Math.max(1e-8, Math.abs(entryPrice - structuralStop.stopLoss));
  const effectiveTargetRR = Math.max(5.0, targetRR);
  const takeProfit = Number(
    (direction === 'BUY'
      ? entryPrice + riskDist * effectiveTargetRR
      : Math.max(1e-8, entryPrice - riskDist * effectiveTargetRR)
    ).toPrecision(6)
  );

  const rrGate = evaluateRRGate({
    direction,
    entryPrice,
    stopLoss: structuralStop.stopLoss,
    takeProfit,
    minRatio: 5.0,
  });

  return Object.freeze({
    contractType: 'DECISION_CONTRACT' as const,
    decisionId: `dec_${symbol}_${indicators.cursorTime}_${direction}`,
    symbol,
    timeframe,
    direction,
    cursorTime: indicators.cursorTime,
    decisionPrice: entryPrice,
    regime: indicators.regime,
    atr14: indicators.atr14,
    atrPercent: indicators.atrPercent,
    structuralStop,
    rrGate,
    takeProfit,
  });
}

/**
 * Simulates multi-layered fill slippage (spread crossing + volume participation impact +
 * latency/volatility friction + exchange fee) returning an independent ExecutionOrderContract.
 */
export function simulateMultiLayeredFill(input: ExecutionFillInput): ExecutionOrderContract {
  const {
    decision,
    environment,
    market,
    notionalUsd,
    barVolumeUsd,
    spreadBps = 4.0,
    latencyBps = 2.5,
    feeBps = market === 'USD_M_FUTURES' ? 5.0 : 10.0,
  } = input;

  const safeNotional = Math.max(0, notionalUsd);
  const approxQty = safeNotional / Math.max(decision.decisionPrice, 1e-8);
  const safeBarVolUnits = Math.max(10_000, Number.isFinite(barVolumeUsd) ? barVolumeUsd : 100_000) / Math.max(decision.decisionPrice, 1e-8);
  const slippageBreakdown = computeLayeredSlippageBreakdown({
    side: decision.direction,
    venue: market === 'USD_M_FUTURES' ? 'BINANCE_USD_M_FUTURES' : 'BINANCE_SPOT',
    orderType: 'MARKET',
    resolvedBehavior: 'TAKER',
    barRangePct: decision.atrPercent,
    requestedQty: approxQty,
    barVolume: safeBarVolUnits,
  });

  if (!decision.rrGate.passed) {
    return Object.freeze({
      contractType: 'EXECUTION_CONTRACT' as const,
      executionId: `exec_rej_${decision.decisionId}`,
      decisionId: decision.decisionId,
      fillModelHash: FILL_MODEL_KERNEL_ARTIFACT.fillModelHash,
      executionAlgorithm: DEFAULT_EXECUTION_ALGORITHM,
      environment,
      market,
      symbol: decision.symbol,
      direction: decision.direction,
      notionalUsd,
      quotedPrice: decision.decisionPrice,
      effectiveFillPrice: decision.decisionPrice,
      spreadCostBps: 0,
      volumeImpactBps: 0,
      latencyFrictionBps: 0,
      slippageBreakdown,
      feeBps: 0,
      totalFrictionBps: 0,
      feeUsd: 0,
      status: 'REJECTED_RR_GATE',
    });
  }

  const safeBarVol = Math.max(10_000, Number.isFinite(barVolumeUsd) ? barVolumeUsd : 100_000);
  const participationRatio = Math.max(0, notionalUsd / safeBarVol);

  const spreadCostBps = roundDet(Math.max(slippageBreakdown.baseBps, spreadBps * 0.5), 3);
  const volumeImpactBps = roundDet(Math.min(85, Math.max(slippageBreakdown.sizeScalingBps, Math.sqrt(participationRatio) * 140)), 3);
  const latencyFrictionBps = roundDet(
    latencyBps + Math.max(slippageBreakdown.volatilityScalingBps, Math.min(25, decision.atrPercent * 1.4)),
    3
  );
  const priceSlippageBps = roundDet(spreadCostBps + volumeImpactBps + latencyFrictionBps, 4);
  const slippageFraction = priceSlippageBps / 10_000;

  const effectiveFillPrice = Number(
    (decision.direction === 'BUY'
      ? decision.decisionPrice * (1 + slippageFraction)
      : Math.max(1e-8, decision.decisionPrice * (1 - slippageFraction))
    ).toPrecision(6)
  );

  const totalFrictionBps = roundDet(priceSlippageBps + feeBps, 3);
  const feeUsd = roundDet((notionalUsd * feeBps) / 10_000, 4);

  return Object.freeze({
    contractType: 'EXECUTION_CONTRACT' as const,
    executionId: `exec_${decision.decisionId}`,
    decisionId: decision.decisionId,
    fillModelHash: FILL_MODEL_KERNEL_ARTIFACT.fillModelHash,
    executionAlgorithm: DEFAULT_EXECUTION_ALGORITHM,
    environment,
    market,
    symbol: decision.symbol,
    direction: decision.direction,
    notionalUsd,
    quotedPrice: decision.decisionPrice,
    effectiveFillPrice,
    spreadCostBps,
    volumeImpactBps,
    latencyFrictionBps,
    slippageBreakdown,
    feeBps,
    totalFrictionBps,
    feeUsd,
    status: 'FILLED',
  });
}

export interface ParityGateInput {
  readonly backtestExpectedSlippageBps: number;
  readonly liveObservedSlippageBps: number;
  readonly backtestWinRatePct: number;
  readonly liveWinRatePct: number;
  readonly backtestExpectancyR: number;
  readonly liveExpectancyR: number;
  readonly maxSlippageDivergenceBps?: number;
  readonly maxWinRateDivergencePct?: number;
  readonly maxExpectancyDivergenceR?: number;
  readonly fillModelHash?: string;
  readonly fillEquivalenceApproved?: boolean;
  readonly fillPriceDivergenceBps?: number;
  readonly maxFillPriceDivergenceBps?: number;
}

export interface ParityGateResult {
  readonly passed: boolean;
  readonly status: 'ARMED' | 'HALTED';
  readonly liveDeploymentAllowed: boolean;
  readonly fillModelHash: string;
  readonly fillEquivalenceApproved: boolean;
  readonly fillPriceDivergenceBps: number;
  readonly slippageDivergenceBps: number;
  readonly winRateDivergencePct: number;
  readonly expectancyDivergenceR: number;
  readonly breachAxes: ReadonlyArray<'SLIPPAGE' | 'WIN_RATE' | 'EXPECTANCY' | 'FILL_EQUIVALENCE'>;
  readonly haltReason: string | null;
}

export function evaluateParityGate(input: ParityGateInput): ParityGateResult {
  const maxSlipBps = input.maxSlippageDivergenceBps ?? 35;
  const maxWrPct = input.maxWinRateDivergencePct ?? 12;
  const maxExpR = input.maxExpectancyDivergenceR ?? 0.45;
  const maxFillPriceDiv = input.maxFillPriceDivergenceBps ?? 0.05;
  const expectedFillHash = FILL_MODEL_KERNEL_ARTIFACT.fillModelHash;
  const observedFillHash = input.fillModelHash ?? expectedFillHash;
  const fillPriceDivergenceBps = roundDet(Math.max(0, input.fillPriceDivergenceBps ?? 0), 4);
  const fillEquivalenceApproved =
    (input.fillEquivalenceApproved ?? true) &&
    observedFillHash === expectedFillHash &&
    fillPriceDivergenceBps <= maxFillPriceDiv;

  const slippageDivergenceBps = Number(
    Math.abs(input.liveObservedSlippageBps - input.backtestExpectedSlippageBps).toFixed(2)
  );
  const winRateDivergencePct = Number(
    Math.abs(input.liveWinRatePct - input.backtestWinRatePct).toFixed(2)
  );
  const expectancyDivergenceR = Number(
    Math.abs(input.liveExpectancyR - input.backtestExpectancyR).toFixed(3)
  );

  const breachAxes: Array<'SLIPPAGE' | 'WIN_RATE' | 'EXPECTANCY' | 'FILL_EQUIVALENCE'> = [];
  if (slippageDivergenceBps > maxSlipBps) breachAxes.push('SLIPPAGE');
  if (winRateDivergencePct > maxWrPct) breachAxes.push('WIN_RATE');
  if (expectancyDivergenceR > maxExpR) breachAxes.push('EXPECTANCY');
  if (!fillEquivalenceApproved) breachAxes.push('FILL_EQUIVALENCE');

  const passed = breachAxes.length === 0;
  const haltReason = passed
    ? null
    : `L2 Parity Gate HALTED live deployment: ${breachAxes.join(', ')} divergence exceeded tolerance (slip=${slippageDivergenceBps}bps/${maxSlipBps}bps, winRate=${winRateDivergencePct}%/${maxWrPct}%, expectancy=${expectancyDivergenceR}R/${maxExpR}R, fillEquiv=${fillEquivalenceApproved}).`;

  return Object.freeze({
    passed,
    status: passed ? 'ARMED' : 'HALTED',
    liveDeploymentAllowed: passed,
    fillModelHash: observedFillHash,
    fillEquivalenceApproved,
    fillPriceDivergenceBps,
    slippageDivergenceBps,
    winRateDivergencePct,
    expectancyDivergenceR,
    breachAxes: Object.freeze(breachAxes),
    haltReason,
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * L3 — WALK-FORWARD VALIDATION
 * Rigid Out-of-Sample testing with frozen parameters across rolling window pairs
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface WalkForwardFrozenParams {
  readonly emaFastPeriod: number;
  readonly emaSlowPeriod: number;
  readonly rsiBuyMax: number;
  readonly rsiSellMin: number;
  readonly minRRRatio: number;
  readonly atrStopMinMult: number;
  readonly atrStopMaxMult: number;
  readonly trailingAtrMult: number;
  readonly maxRiskPct: number;
  readonly scalingMinR: number;
}

export const DEFAULT_WALK_FORWARD_PARAMS: WalkForwardFrozenParams = Object.freeze({
  emaFastPeriod: 9,
  emaSlowPeriod: 21,
  rsiBuyMax: 72,
  rsiSellMin: 28,
  minRRRatio: 5.0,
  atrStopMinMult: 1.35,
  atrStopMaxMult: 2.5,
  trailingAtrMult: 1.6,
  maxRiskPct: 2.0,
  scalingMinR: 3.0,
});

export interface WalkForwardFoldResult {
  readonly foldIndex: number;
  readonly inSampleRange: { readonly startBar: number; readonly endBar: number; readonly bars: number };
  readonly outOfSampleRange: { readonly startBar: number; readonly endBar: number; readonly bars: number };
  readonly frozenParamHash: string;
  readonly paramsFrozenVerified: true;
  readonly inSampleTrades: number;
  readonly inSampleWinRatePct: number;
  readonly inSampleExpectancyR: number;
  readonly oosTrades: number;
  readonly oosWins: number;
  readonly oosLosses: number;
  readonly oosWinRatePct: number;
  readonly oosExpectancyR: number;
  readonly oosProfitFactor: number;
  readonly oosMaxDrawdownPct: number;
  readonly oosNetReturnPct: number;
  readonly oosAvgFrictionBps: number;
  readonly scalingAbove3RExits: number;
  readonly monotonicStopsHeldCount: number;
  readonly rrRejectedCount: number;
}

export interface WalkForwardReport {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly totalCandles: number;
  readonly foldCount: number;
  readonly frozenParamHash: string;
  readonly fillModelHash: string;
  readonly frozenParams: WalkForwardFrozenParams;
  readonly folds: ReadonlyArray<WalkForwardFoldResult>;
  readonly aggregateOosTrades: number;
  readonly aggregateOosWinRatePct: number;
  readonly aggregateOosExpectancyR: number;
  readonly aggregateOosProfitFactor: number;
  readonly aggregateOosMaxDrawdownPct: number;
  readonly aggregateOosReturnPct: number;
  readonly positiveOosFoldRatio: number;
  readonly parityGate: ParityGateResult;
  readonly overallPassed: boolean;
}

function hashFrozenParams(params: WalkForwardFrozenParams): string {
  const canonical = JSON.stringify([
    params.emaFastPeriod,
    params.emaSlowPeriod,
    params.rsiBuyMax,
    params.rsiSellMin,
    params.minRRRatio,
    params.atrStopMinMult,
    params.atrStopMaxMult,
    params.trailingAtrMult,
    params.maxRiskPct,
    params.scalingMinR,
  ]);
  let hash = 2166136261;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `wf_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

interface SegmentSimResult {
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownPct: number;
  netReturnPct: number;
  avgFrictionBps: number;
  scalingAbove3RExits: number;
  monotonicStopsHeldCount: number;
  rrRejectedCount: number;
}

function simulateSegmentWithPitAndKernels(
  fullCandles: ReadonlyArray<Candle>,
  startIdx: number,
  endIdx: number,
  symbol: string,
  timeframe: Timeframe,
  frozen: WalkForwardFrozenParams
): SegmentSimResult {
  const safeStart = Math.max(25, startIdx);
  const safeEnd = Math.min(fullCandles.length - 1, endIdx);
  const warmupStart = Math.max(0, safeStart - 60);

  const segmentSlice = fullCandles.slice(warmupStart, safeEnd + 1);
  const entryCursorStart = safeStart - warmupStart;
  const feed = new TripwireFeed(
    new BacktestFeed(segmentSlice, {
      symbol,
      timeframe,
      warmupBars: Math.max(15, entryCursorStart),
    })
  );
  const engineToken = issueEngineLoopToken(`wf_segment_${symbol}_${startIdx}_${endIdx}`);

  let openPosition: {
    direction: 'BUY' | 'SELL';
    fillPrice: number;
    stopLoss: number;
    initialStopLoss: number;
    takeProfit: number;
    riskDist: number;
    remainingPct: number;
    realizedRSoFar: number;
    frictionBps: number;
  } | null = null;

  let pendingSignal: {
    boundary: SignalToFillBoundary;
    decision: TradeDecisionContract;
    frictionBps: number;
    slippageFraction: number;
  } | null = null;

  const tradeRs: number[] = [];
  const tradePcts: number[] = [];
  const frictions: number[] = [];
  let wins = 0;
  let losses = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let equity = 10000;
  let peakEquity = equity;
  let maxDd = 0;
  let scalingAbove3RExits = 0;
  let monotonicStopsHeldCount = 0;
  let rrRejectedCount = 0;

  while (feed.hasNext()) {
    const closedBar = feed.advance(engineToken);
    const consumerView = feed.asConsumerView();
    const closedWindow = [...consumerView.history(90)];
    const indicators = consumerView.computeFeatures(90);

    // Phase 2 at cursor t+1: cross SignalToFillBoundary onto newly opened bar
    if (pendingSignal && !openPosition) {
      feed.verifyAndRecordTPlusOneFill(pendingSignal.boundary);
      const { decision, slippageFraction, frictionBps } = pendingSignal;
      const fillOpen = closedBar.open;
      const effectiveFillPrice = Number(
        (decision.direction === 'BUY'
          ? fillOpen * (1 + slippageFraction)
          : Math.max(1e-8, fillOpen * (1 - slippageFraction))
        ).toPrecision(6)
      );
      const riskDist = Math.max(
        1e-8,
        Math.abs(effectiveFillPrice - decision.structuralStop.stopLoss)
      );
      const rawTargetAtFill =
        decision.direction === 'BUY'
          ? effectiveFillPrice + riskDist * Math.max(5.0, decision.rrGate.rewardRiskRatio)
          : Math.max(
              1e-8,
              effectiveFillPrice - riskDist * Math.max(5.0, decision.rrGate.rewardRiskRatio)
            );
      const targetAtFill = roundTargetPreservingFloor(
        decision.direction,
        effectiveFillPrice,
        decision.structuralStop.stopLoss,
        rawTargetAtFill,
        Math.max(5.0, decision.rrGate.rewardRiskRatio)
      );
      const stage1Check = checkRRSignalEmission({
        direction: decision.direction,
        entryPrice: effectiveFillPrice,
        stopLoss: decision.structuralStop.stopLoss,
        takeProfit: targetAtFill,
      });
      const intentGate = checkRROrderIntent({
        signalReceipt: stage1Check.signalReceipt,
        orderIntentPrice: effectiveFillPrice,
        stopLoss: decision.structuralStop.stopLoss,
        takeProfit: targetAtFill,
        direction: decision.direction,
        slippageBudgetRatio: 0.05,
      });
      if (!intentGate.passed) {
        rrRejectedCount += 1;
        pendingSignal = null;
        continue;
      }

      openPosition = {
        direction: decision.direction,
        fillPrice: effectiveFillPrice,
        stopLoss: decision.structuralStop.stopLoss,
        initialStopLoss: decision.structuralStop.stopLoss,
        takeProfit: targetAtFill,
        riskDist,
        remainingPct: 100,
        realizedRSoFar: 0,
        frictionBps,
      };
      pendingSignal = null;
    }

    if (openPosition) {
      // 1. Check conservative stop vs target hit on closed bar
      const hitStop =
        openPosition.direction === 'BUY'
          ? closedBar.low <= openPosition.stopLoss
          : closedBar.high >= openPosition.stopLoss;
      const hitTarget =
        openPosition.direction === 'BUY'
          ? closedBar.high >= openPosition.takeProfit
          : closedBar.low <= openPosition.takeProfit;

      if (hitStop || hitTarget) {
        const exitPrice = hitStop ? openPosition.stopLoss : openPosition.takeProfit;
        const rawR =
          openPosition.direction === 'BUY'
            ? (exitPrice - openPosition.fillPrice) / openPosition.riskDist
            : (openPosition.fillPrice - exitPrice) / openPosition.riskDist;
        const netR = Number(
          (
            openPosition.realizedRSoFar +
            (rawR * openPosition.remainingPct) / 100 -
            openPosition.frictionBps / 150
          ).toFixed(3)
        );
        const netPct = Number((netR * 1.5).toFixed(3));
        tradeRs.push(netR);
        tradePcts.push(netPct);
        frictions.push(openPosition.frictionBps);
        if (netR >= 0) {
          wins++;
          grossWin += Math.abs(netPct);
        } else {
          losses++;
          grossLoss += Math.abs(netPct);
        }
        equity = equity * (1 + netPct / 100);
        if (equity > peakEquity) peakEquity = equity;
        const dd = ((peakEquity - equity) / peakEquity) * 100;
        if (dd > maxDd) maxDd = dd;
        openPosition = null;
        continue;
      }

      // 2. Regime-aware scaling check strictly > 3.0R realized
      const currentR =
        openPosition.direction === 'BUY'
          ? (closedBar.close - openPosition.fillPrice) / openPosition.riskDist
          : (openPosition.fillPrice - closedBar.close) / openPosition.riskDist;
      const scalingCheck = evaluateRegimeAwareScaling({
        regime: indicators.regime,
        realizedR: currentR,
        alreadyScaledPct: 100 - openPosition.remainingPct,
        closedCandles: closedWindow,
      });
      if (scalingCheck.allowed && scalingCheck.exitFractionPct > 0) {
        scalingAbove3RExits++;
        openPosition.realizedRSoFar += (currentR * scalingCheck.exitFractionPct) / 100;
        openPosition.remainingPct = scalingCheck.remainingPositionPct;
      }

      // 3. Monotonic trailing stop update strictly on closed bar
      const trailUpdate = advanceMonotonicTrailingStop({
        direction: openPosition.direction,
        prevStopLoss: openPosition.stopLoss,
        initialStopLoss: openPosition.initialStopLoss,
        closedBar,
        atr14: indicators.atr14,
        atrMultiplier: frozen.trailingAtrMult,
      });
      if (trailUpdate.monotonicInvariantHeld) monotonicStopsHeldCount++;
      openPosition.stopLoss = trailUpdate.nextStopLoss;
      continue;
    }

    // Warm-up gate: never invoke strategy decisions until feed.is_warm() is true
    if (!feed.is_warm() || !feed.hasNext()) {
      continue;
    }

    // Generate entry thesis purely from L1 closed window (EMA9/EMA21/EMA50 structural alignment)
    const bullCross =
      indicators.ema9 > indicators.ema21 &&
      indicators.ema21 >= indicators.ema50 &&
      closedBar.close > indicators.ema9 &&
      indicators.rsi14 >= 48 &&
      indicators.rsi14 <= frozen.rsiBuyMax;
    const bearCross =
      indicators.ema9 < indicators.ema21 &&
      indicators.ema21 <= indicators.ema50 &&
      closedBar.close < indicators.ema9 &&
      indicators.rsi14 <= 52 &&
      indicators.rsi14 >= frozen.rsiSellMin;

    if (!bullCross && !bearCross) continue;

    const direction: 'BUY' | 'SELL' = bullCross ? 'BUY' : 'SELL';
    const decision = buildTradeDecisionContract({
      symbol,
      timeframe,
      direction,
      closedCandles: closedWindow,
      indicators,
      targetRR: Math.max(5.2, frozen.minRRRatio + 0.3),
      atrStopMinMult: frozen.atrStopMinMult,
      atrStopMaxMult: frozen.atrStopMaxMult,
      maxRiskPct: frozen.maxRiskPct,
    });

    if (!decision.rrGate.passed) {
      rrRejectedCount++;
      continue;
    }

    const barVolumeUsd = Math.max(50_000, closedBar.volume * closedBar.close);
    const execution = simulateMultiLayeredFill({
      decision,
      environment: 'PAPER',
      market: 'SPOT',
      notionalUsd: Math.min(2500, equity * 0.2),
      barVolumeUsd,
    });

    if (execution.status !== 'FILLED') {
      rrRejectedCount++;
      continue;
    }

    const slippageFraction = Math.max(
      0,
      Math.abs(execution.effectiveFillPrice - execution.quotedPrice) /
        Math.max(execution.quotedPrice, 1e-8)
    );
    const slDist = Math.abs(decision.decisionPrice - decision.structuralStop.stopLoss);

    pendingSignal = {
      boundary: {
        boundaryType: 'SIGNAL_TO_FILL_BOUNDARY_V1',
        signalId: `wf_${symbol}_${feed.cursorIndex()}`,
        strategyId: 'WFV_KERNEL_CAUSAL',
        symbol,
        timeframe,
        signalCursorIndex: feed.cursorIndex(),
        signalCursorTime: closedBar.time,
        signalBarClosePrice: closedBar.close,
        intendedFillCursorIndex: feed.cursorIndex() + 1,
        direction,
        stopLossDistance: slDist,
        stopLossPct: decision.structuralStop.riskPct,
        targetRR: decision.rrGate.rewardRiskRatio,
        trailingAtrMult: frozen.trailingAtrMult,
        confidence: 80,
        setupLabel: 'WFV_L3_KERNEL',
        snapshotHistoryAtSignal: Object.freeze(closedWindow.slice(-10).map((c) => c.close)),
        isWarmAtSignal: true,
        sealedAtClose: true,
      },
      decision,
      frictionBps: execution.totalFrictionBps,
      slippageFraction,
    };
  }

  // Close leftover mark-to-market at end of segment cleanly
  if (openPosition) {
    const lastBar = feed.current() ?? segmentSlice[segmentSlice.length - 1];
    const finalR =
      openPosition.direction === 'BUY'
        ? (lastBar.close - openPosition.fillPrice) / openPosition.riskDist
        : (openPosition.fillPrice - lastBar.close) / openPosition.riskDist;
    const netR = Number(
      (
        openPosition.realizedRSoFar +
        (finalR * openPosition.remainingPct) / 100 -
        openPosition.frictionBps / 150
      ).toFixed(3)
    );
    const netPct = Number((netR * 1.5).toFixed(3));
    tradeRs.push(netR);
    tradePcts.push(netPct);
    frictions.push(openPosition.frictionBps);
    if (netR >= 0) {
      wins++;
      grossWin += Math.abs(netPct);
    } else {
      losses++;
      grossLoss += Math.abs(netPct);
    }
    equity = equity * (1 + netPct / 100);
  }

  const trades = tradeRs.length;
  const winRatePct = trades > 0 ? Number(((wins / trades) * 100).toFixed(1)) : 0;
  const expectancyR =
    trades > 0
      ? Number((tradeRs.reduce((acc, r) => acc + r, 0) / trades).toFixed(3))
      : 0;
  const profitFactor =
    grossLoss > 0
      ? Number((grossWin / grossLoss).toFixed(2))
      : grossWin > 0
      ? 5.0
      : 1.0;
  const netReturnPct = Number((((equity - 10000) / 10000) * 100).toFixed(2));
  const avgFrictionBps =
    frictions.length > 0
      ? Number((frictions.reduce((a, b) => a + b, 0) / frictions.length).toFixed(2))
      : 14.5;

  return {
    trades,
    wins,
    losses,
    winRatePct,
    expectancyR,
    profitFactor,
    maxDrawdownPct: Number(maxDd.toFixed(2)),
    netReturnPct,
    avgFrictionBps,
    scalingAbove3RExits,
    monotonicStopsHeldCount,
    rrRejectedCount,
  };
}

/**
 * L3 Walk-Forward Validation: Splits historical candles into chronological rolling
 * [In-Sample -> Out-of-Sample] pairs and evaluates OOS execution strictly under frozen parameters.
 */
export function runWalkForwardValidation(params: {
  candles: ReadonlyArray<Candle>;
  symbol: string;
  timeframe: Timeframe;
  inSampleBars?: number;
  outOfSampleBars?: number;
  maxFolds?: number;
  frozenParams?: Partial<WalkForwardFrozenParams>;
}): WalkForwardReport {
  const candles = params.candles;
  const frozenParams: WalkForwardFrozenParams = Object.freeze({
    ...DEFAULT_WALK_FORWARD_PARAMS,
    ...params.frozenParams,
    minRRRatio: Math.max(5.0, params.frozenParams?.minRRRatio ?? DEFAULT_WALK_FORWARD_PARAMS.minRRRatio),
    maxRiskPct: Math.min(2.0, params.frozenParams?.maxRiskPct ?? DEFAULT_WALK_FORWARD_PARAMS.maxRiskPct),
    scalingMinR: Math.max(3.0, params.frozenParams?.scalingMinR ?? DEFAULT_WALK_FORWARD_PARAMS.scalingMinR),
  });
  const frozenParamHash = hashFrozenParams(frozenParams);

  const inSampleBars = Math.max(50, params.inSampleBars ?? 85);
  const outOfSampleBars = Math.max(30, params.outOfSampleBars ?? 45);
  const maxFolds = Math.max(1, Math.min(6, params.maxFolds ?? 4));

  const folds: WalkForwardFoldResult[] = [];
  let cursor = 30;
  let foldIndex = 1;

  while (
    foldIndex <= maxFolds &&
    cursor + inSampleBars + outOfSampleBars <= candles.length
  ) {
    const isStart = cursor;
    const isEnd = cursor + inSampleBars - 1;
    const oosStart = isEnd + 1;
    const oosEnd = oosStart + outOfSampleBars - 1;

    const isSim = simulateSegmentWithPitAndKernels(
      candles,
      isStart,
      isEnd,
      params.symbol,
      params.timeframe,
      frozenParams
    );
    const oosSim = simulateSegmentWithPitAndKernels(
      candles,
      oosStart,
      oosEnd,
      params.symbol,
      params.timeframe,
      frozenParams
    );

    folds.push(
      Object.freeze({
        foldIndex,
        inSampleRange: Object.freeze({
          startBar: isStart,
          endBar: isEnd,
          bars: inSampleBars,
        }),
        outOfSampleRange: Object.freeze({
          startBar: oosStart,
          endBar: oosEnd,
          bars: outOfSampleBars,
        }),
        frozenParamHash,
        paramsFrozenVerified: true as const,
        inSampleTrades: isSim.trades,
        inSampleWinRatePct: isSim.winRatePct,
        inSampleExpectancyR: isSim.expectancyR,
        oosTrades: oosSim.trades,
        oosWins: oosSim.wins,
        oosLosses: oosSim.losses,
        oosWinRatePct: oosSim.winRatePct,
        oosExpectancyR: oosSim.expectancyR,
        oosProfitFactor: oosSim.profitFactor,
        oosMaxDrawdownPct: oosSim.maxDrawdownPct,
        oosNetReturnPct: oosSim.netReturnPct,
        oosAvgFrictionBps: oosSim.avgFrictionBps,
        scalingAbove3RExits: oosSim.scalingAbove3RExits,
        monotonicStopsHeldCount: oosSim.monotonicStopsHeldCount,
        rrRejectedCount: oosSim.rrRejectedCount,
      })
    );

    cursor += outOfSampleBars;
    foldIndex++;
  }

  const aggregateOosTrades = folds.reduce((sum, f) => sum + f.oosTrades, 0);
  const totalOosWins = folds.reduce((sum, f) => sum + f.oosWins, 0);
  const aggregateOosWinRatePct =
    aggregateOosTrades > 0
      ? Number(((totalOosWins / aggregateOosTrades) * 100).toFixed(1))
      : 0;
  const aggregateOosExpectancyR =
    folds.length > 0
      ? Number((folds.reduce((sum, f) => sum + f.oosExpectancyR, 0) / folds.length).toFixed(3))
      : 0;
  const aggregateOosProfitFactor =
    folds.length > 0
      ? Number((folds.reduce((sum, f) => sum + f.oosProfitFactor, 0) / folds.length).toFixed(2))
      : 1;
  const aggregateOosMaxDrawdownPct =
    folds.length > 0 ? Math.max(...folds.map((f) => f.oosMaxDrawdownPct)) : 0;
  const aggregateOosReturnPct = Number(
    folds.reduce((sum, f) => sum + f.oosNetReturnPct, 0).toFixed(2)
  );
  const positiveFolds = folds.filter((f) => f.oosExpectancyR >= 0).length;
  const positiveOosFoldRatio =
    folds.length > 0 ? Number((positiveFolds / folds.length).toFixed(2)) : 0;

  const meanIsWinRate =
    folds.length > 0
      ? Number((folds.reduce((sum, f) => sum + f.inSampleWinRatePct, 0) / folds.length).toFixed(1))
      : aggregateOosWinRatePct;
  const meanIsExpectancy =
    folds.length > 0
      ? Number((folds.reduce((sum, f) => sum + f.inSampleExpectancyR, 0) / folds.length).toFixed(3))
      : aggregateOosExpectancyR;
  const meanOosFrictionBps =
    folds.length > 0
      ? Number((folds.reduce((sum, f) => sum + f.oosAvgFrictionBps, 0) / folds.length).toFixed(2))
      : 14.5;

  const parityGate = evaluateParityGate({
    backtestExpectedSlippageBps: 14.5,
    liveObservedSlippageBps: meanOosFrictionBps,
    backtestWinRatePct: meanIsWinRate,
    liveWinRatePct: aggregateOosWinRatePct,
    backtestExpectancyR: meanIsExpectancy,
    liveExpectancyR: aggregateOosExpectancyR,
    maxSlippageDivergenceBps: 35,
    maxWinRateDivergencePct: 25,
    maxExpectancyDivergenceR: 0.75,
  });

  const overallPassed =
    folds.length > 0 &&
    parityGate.passed &&
    aggregateOosExpectancyR >= 0 &&
    aggregateOosProfitFactor >= 1.0;

  return Object.freeze({
    symbol: params.symbol,
    timeframe: params.timeframe,
    totalCandles: candles.length,
    foldCount: folds.length,
    frozenParamHash,
    fillModelHash: FILL_MODEL_KERNEL_ARTIFACT.fillModelHash,
    frozenParams,
    folds: Object.freeze(folds),
    aggregateOosTrades,
    aggregateOosWinRatePct,
    aggregateOosExpectancyR,
    aggregateOosProfitFactor,
    aggregateOosMaxDrawdownPct,
    aggregateOosReturnPct,
    positiveOosFoldRatio,
    parityGate,
    overallPassed,
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SYSTEMIC DE-DUPLICATION & CONSOLIDATED SCHEMA ALIGNMENT
 * Purges legacy directives/overrides and aligns runtime state to single schema
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface ConsolidatedSystemicSchema {
  readonly schemaVersion: 'L0_L3_CONSOLIDATED_V1';
  readonly legacyDirectivesPurged: true;
  readonly layers: {
    readonly l0ClassIsolation: true;
    readonly l1PointInTimeOnly: true;
    readonly l2SeparateContractsAndParityGate: true;
    readonly l3FrozenWalkForwardOos: true;
  };
  readonly invariants: {
    readonly minRRRatio: 5.0;
    readonly maxRiskPct: 2.0;
    readonly scalingMinRealizedR: 3.0;
    readonly monotonicTrailingOnly: true;
    readonly structuralAtrStopOnly: true;
  };
}

export const CONSOLIDATED_SYSTEMIC_SCHEMA: ConsolidatedSystemicSchema = Object.freeze({
  schemaVersion: 'L0_L3_CONSOLIDATED_V1',
  legacyDirectivesPurged: true,
  layers: Object.freeze({
    l0ClassIsolation: true,
    l1PointInTimeOnly: true,
    l2SeparateContractsAndParityGate: true,
    l3FrozenWalkForwardOos: true,
  }),
  invariants: Object.freeze({
    minRRRatio: 5.0,
    maxRiskPct: 2.0,
    scalingMinRealizedR: 3.0,
    monotonicTrailingOnly: true,
    structuralAtrStopOnly: true,
  }),
});

export interface RawRuntimeDirectiveInput<TItem extends { id: string }> {
  readonly minRRRatio?: number;
  readonly maxRiskPct?: number;
  readonly scalingMinRealizedR?: number;
  readonly legacyOverrides?: ReadonlyArray<string>;
  readonly deprecatedFlags?: Readonly<Record<string, unknown>>;
  readonly items?: ReadonlyArray<TItem>;
}

export interface AlignedRuntimeDirectiveResult<TItem extends { id: string }> {
  readonly schema: ConsolidatedSystemicSchema;
  readonly minRRRatio: number;
  readonly maxRiskPct: number;
  readonly scalingMinRealizedR: number;
  readonly purgedLegacyCount: number;
  readonly deduplicatedItemCount: number;
  readonly items: ReadonlyArray<TItem>;
}

/**
 * Purges legacy overrides/deprecated directives, deduplicates entity lists by unique `id`,
 * and clamps all runtime risk tolerances strictly to CONSOLIDATED_SYSTEMIC_SCHEMA bounds.
 */
export function sanitizeAndAlignRuntimeState<TItem extends { id: string }>(
  raw: RawRuntimeDirectiveInput<TItem>
): AlignedRuntimeDirectiveResult<TItem> {
  const seen = new Set<string>();
  const deduped: TItem[] = [];
  const sourceItems = Array.isArray(raw.items) ? raw.items : [];
  for (const entry of sourceItems) {
    if (!entry || typeof entry.id !== 'string' || entry.id.length === 0) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    deduped.push(entry);
  }

  const purgedLegacyCount =
    (Array.isArray(raw.legacyOverrides) ? raw.legacyOverrides.length : 0) +
    (raw.deprecatedFlags ? Object.keys(raw.deprecatedFlags).length : 0);

  const minRRRatio = Math.max(
    CONSOLIDATED_SYSTEMIC_SCHEMA.invariants.minRRRatio,
    Number.isFinite(raw.minRRRatio) ? Number(raw.minRRRatio) : 5.0
  );
  const maxRiskPct = Math.min(
    CONSOLIDATED_SYSTEMIC_SCHEMA.invariants.maxRiskPct,
    Math.max(0.25, Number.isFinite(raw.maxRiskPct) ? Number(raw.maxRiskPct) : 2.0)
  );
  const scalingMinRealizedR = Math.max(
    CONSOLIDATED_SYSTEMIC_SCHEMA.invariants.scalingMinRealizedR,
    Number.isFinite(raw.scalingMinRealizedR) ? Number(raw.scalingMinRealizedR) : 3.0
  );

  return Object.freeze({
    schema: CONSOLIDATED_SYSTEMIC_SCHEMA,
    minRRRatio,
    maxRiskPct,
    scalingMinRealizedR,
    purgedLegacyCount,
    deduplicatedItemCount: Math.max(0, sourceItems.length - deduped.length),
    items: Object.freeze(deduped),
  });
}

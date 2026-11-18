import type { Candle } from './marketData';

export const DEFAULT_MIN_RR_RATIO = 5.0;
export const SCALING_MIN_REALIZED_R = 3.0;
export const HARD_MAX_RISK_PCT = 2.0;

export type MarketRegime = 'TRENDING' | 'NORMAL' | 'HIGH_VOLATILITY' | 'CHOPPY';

export type InvariantRRRejectionCode =
  | 'RR_REJECT_SIGNAL'
  | 'RR_REJECT_INTENT'
  | 'RR_REJECT_NO_STOP'
  | 'RR_REJECT_NO_TARGET';

export interface RRGateInput {
  readonly direction: 'BUY' | 'SELL';
  readonly entryPrice: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly minRatio?: number;
}

export interface RRGateEvaluation {
  readonly passed: boolean;
  readonly direction: 'BUY' | 'SELL';
  readonly rewardRiskRatio: number;
  readonly minRatioRequired: number;
  readonly riskDistance: number;
  readonly rewardDistance: number;
  readonly rejectionCode: InvariantRRRejectionCode | null;
  readonly reason: string;
}

/**
 * RRGateKernel: Rejects any trade setup failing a strict minimum 1:5 Risk-to-Reward ratio
 * or exhibiting invalid directional stop/target geometry.
 */
export function evaluateRRGate(input: RRGateInput): RRGateEvaluation {
  const minRatioRequired =
    input.minRatio !== undefined && Number.isFinite(input.minRatio) && input.minRatio >= DEFAULT_MIN_RR_RATIO
      ? input.minRatio
      : DEFAULT_MIN_RR_RATIO;

  const { direction, entryPrice, stopLoss, takeProfit } = input;

  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return Object.freeze({
      passed: false,
      direction,
      rewardRiskRatio: 0,
      minRatioRequired,
      riskDistance: 0,
      rewardDistance: 0,
      rejectionCode: 'RR_REJECT_SIGNAL',
      reason: 'RRGateKernel rejected setup: non-positive or non-finite entry price.',
    });
  }

  if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
    return Object.freeze({
      passed: false,
      direction,
      rewardRiskRatio: 0,
      minRatioRequired,
      riskDistance: 0,
      rewardDistance: 0,
      rejectionCode: 'RR_REJECT_NO_STOP',
      reason: 'RRGateKernel rejected setup: missing valid stop loss (RR_REJECT_NO_STOP).',
    });
  }

  if (!Number.isFinite(takeProfit) || takeProfit <= 0) {
    return Object.freeze({
      passed: false,
      direction,
      rewardRiskRatio: 0,
      minRatioRequired,
      riskDistance: Math.abs(entryPrice - stopLoss),
      rewardDistance: 0,
      rejectionCode: 'RR_REJECT_NO_TARGET',
      reason: 'RRGateKernel rejected setup: missing valid take-profit target (RR_REJECT_NO_TARGET).',
    });
  }

  const validStopDirection = direction === 'BUY' ? stopLoss < entryPrice : stopLoss > entryPrice;
  if (!validStopDirection) {
    return Object.freeze({
      passed: false,
      direction,
      rewardRiskRatio: 0,
      minRatioRequired,
      riskDistance: Math.abs(entryPrice - stopLoss),
      rewardDistance: Math.abs(takeProfit - entryPrice),
      rejectionCode: 'RR_REJECT_NO_STOP',
      reason: `RRGateKernel rejected ${direction} geometry: stopLoss=${stopLoss} violates directional bounds around entry=${entryPrice}.`,
    });
  }

  const validTargetDirection = direction === 'BUY' ? takeProfit > entryPrice : takeProfit < entryPrice;
  if (!validTargetDirection) {
    return Object.freeze({
      passed: false,
      direction,
      rewardRiskRatio: 0,
      minRatioRequired,
      riskDistance: Math.abs(entryPrice - stopLoss),
      rewardDistance: Math.abs(takeProfit - entryPrice),
      rejectionCode: 'RR_REJECT_NO_TARGET',
      reason: `RRGateKernel rejected ${direction} geometry: takeProfit=${takeProfit} violates directional bounds around entry=${entryPrice}.`,
    });
  }

  const riskDistance = Math.abs(entryPrice - stopLoss);
  const rewardDistance = Math.abs(takeProfit - entryPrice);

  if (riskDistance <= 1e-12) {
    return Object.freeze({
      passed: false,
      direction,
      rewardRiskRatio: 0,
      minRatioRequired,
      riskDistance: 0,
      rewardDistance,
      rejectionCode: 'RR_REJECT_NO_STOP',
      reason: 'RRGateKernel rejected setup: zero risk distance (RR_REJECT_NO_STOP).',
    });
  }

  const rewardRiskRatio = Number((rewardDistance / riskDistance).toFixed(4));
  const passed = rewardRiskRatio >= minRatioRequired;

  return Object.freeze({
    passed,
    direction,
    rewardRiskRatio,
    minRatioRequired,
    riskDistance,
    rewardDistance,
    rejectionCode: passed ? null : 'RR_REJECT_SIGNAL',
    reason: passed
      ? `RRGateKernel approved ${direction} 1:${rewardRiskRatio.toFixed(2)} (>= 1:${minRatioRequired.toFixed(1)}).`
      : `RRGateKernel rejected ${direction} setup: 1:${rewardRiskRatio.toFixed(2)} < mandatory 1:${minRatioRequired.toFixed(1)} minimum.`,
  });
}

export interface StructuralStopInput {
  readonly direction: 'BUY' | 'SELL';
  readonly entryPrice: number;
  readonly closedCandles: ReadonlyArray<Candle>;
  readonly atr14: number;
  readonly lookbackBars?: number;
  readonly minAtrFloorMult?: number;
  readonly maxAtrCeilingMult?: number;
  readonly maxRiskPct?: number;
}

export interface StructuralStopResult {
  readonly stopLoss: number;
  readonly structureBoundary: number;
  readonly rawStructureDistance: number;
  readonly atrFloorDistance: number;
  readonly atrCeilingDistance: number;
  readonly appliedDistance: number;
  readonly boundedByAtrNoise: boolean;
  readonly clampedByMaxRiskCap: boolean;
  readonly riskPct: number;
}

/**
 * StructuralStopKernel: Derives initial stop loss strictly from closed market structure
 * boundaries (swing low for BUY / swing high for SELL), bounded inside an ATR noise band
 * [minAtrFloorMult * ATR, maxAtrCeilingMult * ATR] and capped by HARD_MAX_RISK_PCT (<= 2%).
 */
export function deriveStructuralStop(input: StructuralStopInput): StructuralStopResult {
  const {
    direction,
    entryPrice,
    closedCandles,
    atr14,
    lookbackBars = 14,
    minAtrFloorMult = 0.75,
    maxAtrCeilingMult = 2.5,
    maxRiskPct = HARD_MAX_RISK_PCT,
  } = input;

  const safeEntry = Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : 100;
  const safeAtr =
    Number.isFinite(atr14) && atr14 > 0 ? atr14 : Math.max(1e-8, safeEntry * 0.012);

  const windowBars = closedCandles.slice(-Math.max(2, lookbackBars));
  let structureBoundary: number;
  if (windowBars.length === 0) {
    structureBoundary = direction === 'BUY' ? safeEntry - safeAtr : safeEntry + safeAtr;
  } else if (direction === 'BUY') {
    structureBoundary = Math.min(...windowBars.map((c) => c.low));
    if (structureBoundary >= safeEntry) {
      structureBoundary = safeEntry - safeAtr * minAtrFloorMult;
    }
  } else {
    structureBoundary = Math.max(...windowBars.map((c) => c.high));
    if (structureBoundary <= safeEntry) {
      structureBoundary = safeEntry + safeAtr * minAtrFloorMult;
    }
  }

  const atrPad = safeAtr * 0.15;
  const paddedStructurePrice =
    direction === 'BUY'
      ? Math.max(1e-8, structureBoundary - atrPad)
      : structureBoundary + atrPad;

  const rawStructureDistance = Math.abs(safeEntry - paddedStructurePrice);
  const atrFloorDistance = Math.max(safeEntry * 0.002, safeAtr * Math.max(0.25, minAtrFloorMult));
  const atrCeilingDistance = Math.max(atrFloorDistance, safeAtr * Math.max(minAtrFloorMult, maxAtrCeilingMult));

  let appliedDistance = Math.min(atrCeilingDistance, Math.max(atrFloorDistance, rawStructureDistance));
  const boundedByAtrNoise = appliedDistance !== rawStructureDistance;

  const effectiveMaxRiskPct =
    Number.isFinite(maxRiskPct) && maxRiskPct > 0
      ? Math.min(HARD_MAX_RISK_PCT, maxRiskPct)
      : HARD_MAX_RISK_PCT;
  const hardMaxRiskDistance = safeEntry * (effectiveMaxRiskPct / 100);
  let clampedByMaxRiskCap = false;
  if (appliedDistance > hardMaxRiskDistance) {
    appliedDistance = hardMaxRiskDistance;
    clampedByMaxRiskCap = true;
  }

  const stopLoss = Number(
    (direction === 'BUY'
      ? Math.max(1e-8, safeEntry - appliedDistance)
      : safeEntry + appliedDistance
    ).toPrecision(6)
  );
  const finalRiskDistance = Math.abs(safeEntry - stopLoss);
  const riskPct = Number(((finalRiskDistance / safeEntry) * 100).toFixed(4));

  return Object.freeze({
    stopLoss,
    structureBoundary: Number(structureBoundary.toPrecision(6)),
    rawStructureDistance: Number(rawStructureDistance.toPrecision(6)),
    atrFloorDistance: Number(atrFloorDistance.toPrecision(6)),
    atrCeilingDistance: Number(atrCeilingDistance.toPrecision(6)),
    appliedDistance: Number(finalRiskDistance.toPrecision(6)),
    boundedByAtrNoise,
    clampedByMaxRiskCap,
    riskPct,
  });
}

export interface MonotonicTrailingStopInput {
  readonly direction: 'BUY' | 'SELL';
  readonly prevStopLoss: number;
  readonly initialStopLoss: number;
  readonly closedBar: Pick<Candle, 'high' | 'low' | 'close'>;
  readonly atr14: number;
  readonly atrMultiplier?: number;
}

export interface MonotonicTrailingStopResult {
  readonly nextStopLoss: number;
  readonly prevStopLoss: number;
  readonly candidateStopLoss: number;
  readonly tightened: boolean;
  readonly distanceTightened: number;
  readonly monotonicInvariantHeld: true;
}

/**
 * MonotonicTrailingStopKernel: Computes trailing stop updates strictly upon closed bars
 * and guarantees monotonic tightening — stops NEVER widen/loosen under any condition.
 */
export function advanceMonotonicTrailingStop(
  input: MonotonicTrailingStopInput
): MonotonicTrailingStopResult {
  const {
    direction,
    prevStopLoss,
    initialStopLoss,
    closedBar,
    atr14,
    atrMultiplier = 1.65,
  } = input;

  const safeAtr =
    Number.isFinite(atr14) && atr14 > 0
      ? atr14
      : Math.max(1e-8, closedBar.close * 0.012);
  const trailOffset = safeAtr * Math.max(0.5, atrMultiplier);

  if (direction === 'BUY') {
    const baseline = Math.max(prevStopLoss, initialStopLoss);
    const candidateRaw = Math.max(closedBar.close, closedBar.high * 0.996) - trailOffset;
    const candidateStopLoss = Number(Math.max(1e-8, candidateRaw).toPrecision(6));
    const nextStopLoss = Number(Math.max(baseline, candidateStopLoss).toPrecision(6));
    const tightened = nextStopLoss > prevStopLoss;
    return Object.freeze({
      nextStopLoss,
      prevStopLoss,
      candidateStopLoss,
      tightened,
      distanceTightened: Number(Math.max(0, nextStopLoss - prevStopLoss).toPrecision(6)),
      monotonicInvariantHeld: true as const,
    });
  }

  const baseline = Math.min(prevStopLoss, initialStopLoss);
  const candidateRaw = Math.min(closedBar.close, closedBar.low * 1.004) + trailOffset;
  const candidateStopLoss = Number(Math.max(1e-8, candidateRaw).toPrecision(6));
  const nextStopLoss = Number(Math.min(baseline, candidateStopLoss).toPrecision(6));
  const tightened = nextStopLoss < prevStopLoss;

  return Object.freeze({
    nextStopLoss,
    prevStopLoss,
    candidateStopLoss,
    tightened,
    distanceTightened: Number(Math.max(0, prevStopLoss - nextStopLoss).toPrecision(6)),
    monotonicInvariantHeld: true as const,
  });
}

export interface RegimeAwareScalingInput {
  readonly regime?: MarketRegime;
  readonly realizedR: number;
  readonly alreadyScaledPct?: number;
  readonly closedCandles?: ReadonlyArray<Candle>;
}

export interface RegimeAwareScalingResult {
  readonly allowed: boolean;
  readonly regime: MarketRegime;
  readonly realizedR: number;
  readonly minRequiredR: number;
  readonly exitFractionPct: number;
  readonly remainingPositionPct: number;
  readonly reason: string;
}

/**
 * Classifies market regime using strictly closed-window candles (zero future leakage).
 */
export function detectMarketRegimeFromClosedWindow(
  closedCandles: ReadonlyArray<Candle>
): MarketRegime {
  if (closedCandles.length < 15) return 'NORMAL';
  const window = closedCandles.slice(-20);
  let trSum = 0;
  for (let i = 1; i < window.length; i++) {
    const c = window[i];
    const prevClose = window[i - 1].close;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose)
    );
    trSum += tr;
  }
  const lastClose = window[window.length - 1].close || 1;
  const firstClose = window[0].close || lastClose;
  const avgAtrPct = (trSum / Math.max(1, window.length - 1) / lastClose) * 100;
  const netMovePct = Math.abs((lastClose - firstClose) / firstClose) * 100;

  if (avgAtrPct >= 2.8) return 'HIGH_VOLATILITY';
  if (netMovePct >= avgAtrPct * 3.0 && netMovePct >= 2.2) return 'TRENDING';
  if (netMovePct < avgAtrPct * 1.1) return 'CHOPPY';
  return 'NORMAL';
}

/**
 * RegimeAwareScalingKernel: Strictly blocks partial exits at or below 3.0R realized.
 * Above 3.0R, determines the regime-calibrated scaling tranche to lock gains while
 * letting strong-trend runners extend toward 1:5+.
 */
export function evaluateRegimeAwareScaling(
  input: RegimeAwareScalingInput
): RegimeAwareScalingResult {
  const alreadyScaledPct = Math.max(0, Math.min(100, input.alreadyScaledPct ?? 0));
  const remainingBefore = Math.max(0, Number((100 - alreadyScaledPct).toFixed(2)));
  const regime: MarketRegime =
    input.regime ??
    (input.closedCandles && input.closedCandles.length > 0
      ? detectMarketRegimeFromClosedWindow(input.closedCandles)
      : 'NORMAL');

  const realizedR = Number.isFinite(input.realizedR) ? Number(input.realizedR.toFixed(4)) : 0;

  if (realizedR <= SCALING_MIN_REALIZED_R) {
    return Object.freeze({
      allowed: false,
      regime,
      realizedR,
      minRequiredR: SCALING_MIN_REALIZED_R,
      exitFractionPct: 0,
      remainingPositionPct: remainingBefore,
      reason: `RegimeAwareScalingKernel blocked partial exit at ${realizedR.toFixed(2)}R (strictly requires > ${SCALING_MIN_REALIZED_R.toFixed(1)}R realized).`,
    });
  }

  if (remainingBefore <= 0) {
    return Object.freeze({
      allowed: false,
      regime,
      realizedR,
      minRequiredR: SCALING_MIN_REALIZED_R,
      exitFractionPct: 0,
      remainingPositionPct: 0,
      reason: 'RegimeAwareScalingKernel: 100% of position has already scaled out.',
    });
  }

  const regimeBaseTranche: Record<MarketRegime, number> = {
    TRENDING: 20, // Hold 80% runner in strong directional trends
    NORMAL: 35,
    HIGH_VOLATILITY: 50,
    CHOPPY: 60,
  };

  const targetSlice = realizedR >= 5.0 ? remainingBefore : regimeBaseTranche[regime];
  const exitFractionPct = Number(Math.min(remainingBefore, targetSlice).toFixed(2));
  const remainingPositionPct = Number(Math.max(0, remainingBefore - exitFractionPct).toFixed(2));

  return Object.freeze({
    allowed: true,
    regime,
    realizedR,
    minRequiredR: SCALING_MIN_REALIZED_R,
    exitFractionPct,
    remainingPositionPct,
    reason: `RegimeAwareScalingKernel approved ${exitFractionPct.toFixed(0)}% partial exit at +${realizedR.toFixed(2)}R (${regime} regime · ${remainingPositionPct.toFixed(0)}% runner retained).`,
  });
}

export interface KernelValidatedRiskProfile {
  readonly stopLoss: number;
  readonly riskDistance: number;
  readonly riskPct: number;
  readonly takeProfits: readonly [number, number, number];
  readonly rewardRiskRatio: number;
  readonly structuralStop: StructuralStopResult;
  readonly rrGate: RRGateEvaluation;
}

/**
 * Consolidated kernel pipeline combining StructuralStopKernel (<= 2% risk, ATR noise bounds)
 * with RRGateKernel (strict minimum 1:5.0 Risk-to-Reward) as the single authoritative risk builder.
 */
export function buildKernelValidatedRiskProfile(params: {
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  closedCandles: ReadonlyArray<Candle>;
  atr14: number;
  lookbackBars?: number;
  minAtrFloorMult?: number;
  maxAtrCeilingMult?: number;
  maxRiskPct?: number;
  targetRR?: number;
}): KernelValidatedRiskProfile {
  const safeEntry = Number.isFinite(params.entryPrice) && params.entryPrice > 0 ? params.entryPrice : 100;
  const structuralStop = deriveStructuralStop({
    direction: params.direction,
    entryPrice: safeEntry,
    closedCandles: params.closedCandles,
    atr14: params.atr14,
    lookbackBars: params.lookbackBars,
    minAtrFloorMult: params.minAtrFloorMult,
    maxAtrCeilingMult: params.maxAtrCeilingMult,
    maxRiskPct: params.maxRiskPct,
  });

  const riskDistance = Math.max(1e-8, Math.abs(safeEntry - structuralStop.stopLoss));
  const minRatio = Math.max(DEFAULT_MIN_RR_RATIO, params.targetRR ?? DEFAULT_MIN_RR_RATIO);
  const rr1 = 2.0;
  const rr2 = 3.5;
  const rr3 = minRatio;

  const projectTarget = (rMult: number): number =>
    Number(
      (params.direction === 'BUY'
        ? safeEntry + riskDistance * rMult
        : Math.max(1e-8, safeEntry - riskDistance * rMult)
      ).toPrecision(6)
    );

  const tp1 = projectTarget(rr1);
  const tp2 = projectTarget(rr2);
  const tp3 = projectTarget(rr3);

  const rrGate = evaluateRRGate({
    direction: params.direction,
    entryPrice: safeEntry,
    stopLoss: structuralStop.stopLoss,
    takeProfit: tp3,
    minRatio: DEFAULT_MIN_RR_RATIO,
  });

  return Object.freeze({
    stopLoss: structuralStop.stopLoss,
    riskDistance,
    riskPct: structuralStop.riskPct,
    takeProfits: Object.freeze([tp1, tp2, tp3] as const),
    rewardRiskRatio: rrGate.rewardRiskRatio,
    structuralStop,
    rrGate,
  });
}

import {
  advanceMonotonicTrailingStop,
  deriveStructuralStop,
  evaluateRRGate,
} from './invariantKernels';
import { type Candle, formatCryptoPrice } from './marketData';
import { type MultiExchangeDepthAnalysis } from './orderBookDepth';
import { type PatternScanResult } from './patternScanner';
import { type SentinelAssessment } from './sentinelAgent';
import { type SmcAgentAnalysis } from './smcAgent';
import {
  calculateBollingerBands,
  calculateEMA,
  calculateRSI,
  detectCandlePatterns,
  resolveLiveEntryPriceSnapshot,
  runFundamentalAgent,
  type LiveTickerInput,
  type NewsItem,
  type TradingSignal,
} from './signals';

export type ExecutionEnvironment = 'TESTNET' | 'LIVE';

export type MarginMode = 'CROSS' | 'ISOLATED';

export type LeverageScalingMode = 'AUTO_VOLATILITY' | 'MANUAL';

export type SkepticVerdict = 'APPROVED' | 'CAUTION' | 'VETOED';

export interface FuturesTickerTelemetry {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  fundingRate: number; // e.g., 0.0001 = 0.01% per 8h
  nextFundingTime: string;
  openInterestUsd: number;
  volume24hUsd: number;
  maxLeverage: number;
  source: 'binance_futures' | 'futures_cache';
}

export interface FuturesMarginBreakdown {
  leverage: number;
  recommendedLeverage: number;
  maxLeverage: number;
  scalingMode: LeverageScalingMode;
  marginMode: MarginMode;
  notionalUsd: number;
  initialMarginUsd: number;
  maintenanceMarginUsd: number;
  maintenanceMarginRate: number;
  estimatedFeeUsd: number;
  liquidationPrice: number;
  stopBeforeLiquidationSafe: boolean;
  fundingImpactUsd8h: number;
}

export interface CrossMarginWalletSummary {
  walletBalanceUsd: number;
  unrealizedPnlUsd: number;
  crossEquityUsd: number;
  totalInitialMarginUsd: number;
  totalMaintenanceMarginUsd: number;
  availableCrossMarginUsd: number;
  crossMarginRatioPercent: number;
}

export interface SubAgentStatus {
  id:
    | 'market_intel'
    | 'whale_tracker'
    | 'technical'
    | 'risk_mgmt'
    | 'skeptic'
    | 'orderbook_depth'
    | 'sentinel';
  name: string;
  role: string;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number; // 0..100
  metricLabel: string;
  summary: string;
}

export interface DynamicRiskPlan {
  atr14: number;
  atrPercent: number;
  volatilityRegime: 'LOW' | 'NORMAL' | 'HIGH';
  initialStopLoss: number;
  maxStopLossPct: number;
  trailingStopLoss: number;
  trailingAtrMultiplier?: number;
  trailingTakeProfit5xAtr: number;
  trailingStepUsd: number;
  breakevenTrigger: number;
  takeProfits: [number, number, number];
  dynamicRRs: [number, number, number];
}

export interface SkepticAudit {
  verdict: SkepticVerdict;
  skepticRiskScore: number; // 0 (clean) .. 100 (high trap risk)
  alignedAgentsCount: number;
  challenges: string[];
  mitigationNote: string;
}

export interface WhaleFlowSnapshot {
  symbol: string;
  netflowUsd: number; // negative = exchange outflow (accumulation / bullish)
  inflow24hUsd: number;
  outflow24hUsd: number;
}

export interface CoordinatedTradePlan {
  id: string;
  symbol: string;
  coinName: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  confidence: number;
  marketType: 'SPOT' | 'USD_M_FUTURES';
  sourceModule: 'AI_ENGINE' | 'SMC_FRVP' | 'PATTERN_SCANNER';
  sourceLabel: string;
  futuresTelemetry?: FuturesTickerTelemetry;
  riskPlan: DynamicRiskPlan;
  futuresMargin: FuturesMarginBreakdown;
  skeptic: SkepticAudit;
  subAgents: SubAgentStatus[];
  routeToTelegram: boolean;
  telegramMessage: string;
  createdAt: string;
}

export interface SandboxPosition {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  mode: ExecutionEnvironment;
  marketType?: 'USD_M_FUTURES' | 'SPOT';
  marginMode?: MarginMode;
  leverage?: number;
  entryPrice: number;
  quantity: number;
  notionalUsd: number;
  initialMarginUsd?: number;
  maintenanceMarginUsd?: number;
  liquidationPrice?: number;
  fundingRate?: number;
  settledFundingUsd?: number;
  initialStopLoss: number;
  maxStopLossPct?: number;
  trailingStopLoss: number;
  trailingTakeProfit5xAtr?: number;
  peakFavorablePrice?: number;
  autonomousEntry?: boolean;
  entrySourceReason?: string;
  takeProfits: [number, number, number];
  status:
    | 'OPEN'
    | 'CLOSED_TP'
    | 'CLOSED_TRAIL_SL'
    | 'CLOSED_MANUAL'
    | 'CLOSED_REVERSAL'
    | 'CLOSED_EMERGENCY_LIQUIDATION';
  pnlUsd: number;
  pnlPercent: number;
  roePercent?: number;
  skepticVerdict: SkepticVerdict;
  openedAt: string;
  closedAt?: string;
}

export interface AppNotificationItem {
  id: string;
  category: 'SIGNAL' | 'TELEGRAM' | 'EXECUTION' | 'DIGEST' | 'SKEPTIC';
  title: string;
  message: string;
  symbol?: string;
  severity: 'info' | 'success' | 'warning';
  read: boolean;
  timestamp: string;
}

/**
 * Computes true Average True Range (ATR 14) from OHLCV candles.
 */
export function computeATR(candles: Candle[], period = 14): number {
  if (!candles || candles.length < 2) {
    const fallbackClose = candles?.[0]?.close ?? 100;
    return Number((fallbackClose * 0.015).toPrecision(6));
  }
  const start = Math.max(1, candles.length - period);
  let sum = 0;
  let count = 0;
  for (let i = start; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose)
    );
    sum += tr;
    count++;
  }
  const atr = count > 0 ? sum / count : candles[candles.length - 1].close * 0.015;
  return atr > 0
    ? Number(atr.toPrecision(6))
    : Number((candles[candles.length - 1].close * 0.015).toPrecision(6));
}

/**
 * Scales recommended Binance USD-M Futures leverage inversely to ATR volatility and Skeptic risk,
 * ensuring the ATR stop loss sits safely inside the liquidation threshold.
 */
export function computeVolatilityScaledLeverage(params: {
  atrPercent: number;
  confidence: number;
  skepticRiskScore?: number;
  maxLeverage?: number;
  stopDistancePercent?: number;
}): number {
  const maxLev = Math.min(125, Math.max(1, Math.round(params.maxLeverage ?? 50)));
  const atrPct = Math.max(0.4, params.atrPercent);
  const skepticRisk = params.skepticRiskScore ?? 20;

  // Volatility budget: lower ATR% allows cleaner leverage; higher ATR% compresses leverage
  let baseScaled = Math.round(28 / atrPct);
  if (params.confidence >= 85) baseScaled += 2;
  if (skepticRisk >= 38) baseScaled = Math.max(2, Math.floor(baseScaled * 0.55));
  if (skepticRisk >= 62) baseScaled = 2;

  // Keep liquidation cushion at least 2.2x further away than stop loss distance
  const stopPct = Math.max(0.8, params.stopDistancePercent ?? atrPct * 1.55);
  const liquidationSafeCap = Math.max(2, Math.floor(100 / (stopPct * 2.2)));

  return Math.max(2, Math.min(maxLev, 25, baseScaled, liquidationSafeCap));
}

/**
 * Calculates dynamic initial margin, tiered maintenance margin, fees, and Cross/Isolated
 * liquidation price using Binance USD-M Futures margin rules.
 */
export function calculateFuturesDynamicMargin(params: {
  entryPrice: number;
  stopLoss: number;
  direction: 'BUY' | 'SELL';
  notionalUsd: number;
  leverage: number;
  recommendedLeverage: number;
  maxLeverage?: number;
  scalingMode?: LeverageScalingMode;
  marginMode?: MarginMode;
  crossAvailableBalanceUsd?: number;
  fundingRate?: number;
}): FuturesMarginBreakdown {
  const safeEntry = Math.max(params.entryPrice, 1e-8);
  const maxLev = Math.min(125, Math.max(1, Math.round(params.maxLeverage ?? 50)));
  const lev = Math.max(1, Math.min(maxLev, Math.round(params.leverage)));
  const notional = Math.max(25, params.notionalUsd);
  const mode: MarginMode = params.marginMode ?? 'CROSS';

  const initialMarginUsd = Number((notional / lev).toFixed(2));
  const maintenanceMarginRate =
    notional >= 250_000 ? 0.01 : notional >= 50_000 ? 0.005 : 0.004;
  const maintenanceMarginUsd = Number((notional * maintenanceMarginRate).toFixed(2));
  const estimatedFeeUsd = Number((notional * 0.0004).toFixed(2)); // 0.04% Binance Futures taker

  // Cross-margin pools remaining cross wallet equity to absorb drawdown before liquidation
  const sharedCrossReserve =
    mode === 'CROSS'
      ? Math.max(0, (params.crossAvailableBalanceUsd ?? 25000) - initialMarginUsd)
      : 0;
  const effectiveMarginBuffer = Math.max(
    maintenanceMarginUsd * 0.25,
    initialMarginUsd + sharedCrossReserve - maintenanceMarginUsd
  );
  const bufferRatio = Math.min(0.96, effectiveMarginBuffer / notional);

  const liquidationPrice =
    params.direction === 'BUY'
      ? Number(Math.max(safeEntry * 0.02, safeEntry * (1 - bufferRatio)).toPrecision(6))
      : Number((safeEntry * (1 + bufferRatio)).toPrecision(6));

  const stopBeforeLiquidationSafe =
    params.direction === 'BUY'
      ? params.stopLoss > liquidationPrice
      : params.stopLoss < liquidationPrice;

  const fundingRate = params.fundingRate ?? 0.0001;
  // Positive funding means longs pay shorts (-), negative funding means longs receive (+)
  const rawFundingFlow =
    params.direction === 'BUY' ? -notional * fundingRate : notional * fundingRate;

  return {
    leverage: lev,
    recommendedLeverage: params.recommendedLeverage,
    maxLeverage: maxLev,
    scalingMode: params.scalingMode ?? 'AUTO_VOLATILITY',
    marginMode: mode,
    notionalUsd: Number(notional.toFixed(2)),
    initialMarginUsd,
    maintenanceMarginUsd,
    maintenanceMarginRate,
    estimatedFeeUsd,
    liquidationPrice,
    stopBeforeLiquidationSafe,
    fundingImpactUsd8h: Number(rawFundingFlow.toFixed(2)),
  };
}

/**
 * Aggregates live Cross-Margin wallet health across all open USD-M Futures positions.
 */
export function summarizeCrossMarginWallet(
  walletBalanceUsd: number,
  positions: SandboxPosition[],
  livePriceMap: Record<string, number>
): CrossMarginWalletSummary {
  let unrealizedPnlUsd = 0;
  let totalInitialMarginUsd = 0;
  let totalMaintenanceMarginUsd = 0;

  for (const pos of positions) {
    if (pos.status !== 'OPEN') continue;
    const mark = livePriceMap[pos.symbol] ?? pos.entryPrice;
    const pctMove =
      pos.direction === 'BUY'
        ? (mark - pos.entryPrice) / pos.entryPrice
        : (pos.entryPrice - mark) / pos.entryPrice;
    unrealizedPnlUsd += pos.notionalUsd * pctMove + (pos.settledFundingUsd ?? 0);

    const lev = Math.max(1, pos.leverage ?? 1);
    const im = pos.initialMarginUsd ?? pos.notionalUsd / lev;
    const mm = pos.maintenanceMarginUsd ?? pos.notionalUsd * 0.004;
    totalInitialMarginUsd += im;
    totalMaintenanceMarginUsd += mm;
  }

  const crossEquityUsd = Number((walletBalanceUsd + unrealizedPnlUsd).toFixed(2));
  const availableCrossMarginUsd = Number(
    Math.max(0, crossEquityUsd - totalInitialMarginUsd).toFixed(2)
  );
  const crossMarginRatioPercent = Number(
    ((totalMaintenanceMarginUsd / Math.max(1, crossEquityUsd)) * 100).toFixed(2)
  );

  return {
    walletBalanceUsd: Number(walletBalanceUsd.toFixed(2)),
    unrealizedPnlUsd: Number(unrealizedPnlUsd.toFixed(2)),
    crossEquityUsd,
    totalInitialMarginUsd: Number(totalInitialMarginUsd.toFixed(2)),
    totalMaintenanceMarginUsd: Number(totalMaintenanceMarginUsd.toFixed(2)),
    availableCrossMarginUsd,
    crossMarginRatioPercent,
  };
}

/**
 * Settles a closed Futures position directly against the shared Cross-Margin wallet balance,
 * deducting taker fees and applying accrued funding payments.
 */
export function settleCrossMarginClose(params: {
  walletBalanceUsd: number;
  position: SandboxPosition;
  exitPrice: number;
}): {
  updatedWalletBalanceUsd: number;
  grossPnlUsd: number;
  feeUsd: number;
  netRealizedPnlUsd: number;
  pnlPercent: number;
  roePercent: number;
} {
  const { position, exitPrice } = params;
  const pctMove =
    position.direction === 'BUY'
      ? (exitPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - exitPrice) / position.entryPrice;

  const grossPnlUsd = position.notionalUsd * pctMove;
  const feeUsd = position.notionalUsd * 0.0008; // round-trip entry + exit taker fee
  const funding = position.settledFundingUsd ?? 0;
  const netRealizedPnlUsd = Number((grossPnlUsd - feeUsd + funding).toFixed(2));
  const lev = Math.max(1, position.leverage ?? 1);
  const im = position.initialMarginUsd ?? position.notionalUsd / lev;
  const roePercent = Number(((netRealizedPnlUsd / Math.max(1, im)) * 100).toFixed(2));

  return {
    updatedWalletBalanceUsd: Number((params.walletBalanceUsd + netRealizedPnlUsd).toFixed(2)),
    grossPnlUsd: Number(grossPnlUsd.toFixed(2)),
    feeUsd: Number(feeUsd.toFixed(2)),
    netRealizedPnlUsd,
    pnlPercent: Number((pctMove * 100).toFixed(2)),
    roePercent,
  };
}

/**
 * Replaces fixed R:R targets with volatility- & structure-adaptive TP1/TP2/TP3
 * and calculates an ATR-anchored Trailing Stop Loss.
 */
export function buildDynamicRiskAndAtrPlan(
  candles: Candle[],
  entryPrice: number,
  direction: 'BUY' | 'SELL',
  confidence: number,
  trendStrengthFactor = 1.0,
  isMomentumLeader = false
): DynamicRiskPlan {
  const safeEntry = Math.max(entryPrice, 1e-8);
  const atr14 = Math.max(computeATR(candles, 14), safeEntry * 0.006);
  const atrPercent = Number(((atr14 / safeEntry) * 100).toFixed(2));

  const volatilityRegime: DynamicRiskPlan['volatilityRegime'] =
    atrPercent >= 3.2 ? 'HIGH' : atrPercent <= 1.15 ? 'LOW' : 'NORMAL';

  const baseStopAtrMult =
    volatilityRegime === 'HIGH' ? 1.85 : volatilityRegime === 'LOW' ? 1.35 : 1.55;
  const stopAtrMult = isMomentumLeader ? baseStopAtrMult * 1.18 : baseStopAtrMult;
  const structuralStop = deriveStructuralStop({
    direction,
    entryPrice: safeEntry,
    closedCandles: candles,
    atr14,
    lookbackBars: 12,
    minAtrFloorMult: isMomentumLeader ? 1.55 : 1.25,
    maxAtrCeilingMult: isMomentumLeader ? 2.6 : 2.2,
    maxRiskPct: 2.0,
  });

  // Enforce strict 2.0% maximum risk cap per trade via StructuralStopKernel
  const initialStopLoss = structuralStop.stopLoss;
  const actualRiskDist = Math.max(Math.abs(safeEntry - initialStopLoss), safeEntry * 0.002);
  const maxStopLossPct = Number(
    ((actualRiskDist / safeEntry) * 100).toFixed(2)
  );

  // Wider trailing SL runway for emerging Top Gainers / Pre-Pump leaders so winners have room to run
  const trailingAtrMultiplier = isMomentumLeader
    ? Number((volatilityRegime === 'HIGH' ? 2.35 : 2.05).toFixed(2))
    : 1.25;
  const recentHigh = Math.max(...candles.slice(-12).map((c) => c.high), safeEntry);
  const recentLow = Math.min(...candles.slice(-12).map((c) => c.low), safeEntry);
  const rawTrailLong = recentHigh - atr14 * trailingAtrMultiplier;
  const rawTrailShort = recentLow + atr14 * trailingAtrMultiplier;
  const trailingStopLoss =
    direction === 'BUY'
      ? Number(
          Math.max(initialStopLoss, Math.min(safeEntry * 0.996, rawTrailLong)).toPrecision(6)
        )
      : Number(
          Math.min(initialStopLoss, Math.max(safeEntry * 1.004, rawTrailShort)).toPrecision(6)
        );

  const trailingTakeProfit5xAtr =
    direction === 'BUY'
      ? Number((safeEntry + Math.max(atr14 * 5.0, actualRiskDist * 5.0)).toPrecision(6))
      : Number(
          Math.max(safeEntry * 0.1, safeEntry - Math.max(atr14 * 5.0, actualRiskDist * 5.0)).toPrecision(6)
        );

  const trailingStepUsd = Number((atr14 * (isMomentumLeader ? 0.65 : 0.5)).toPrecision(5));

  const closes = candles.map((c) => c.close);
  const bb = calculateBollingerBands(closes, 20, 2);
  const bbSpreadRatio = bb.middle > 0 ? (bb.upper - bb.lower) / bb.middle : 0.04;
  const volExpansionBoost = Math.min(0.65, Math.max(-0.2, (bbSpreadRatio - 0.04) * 5.2));
  const confBoost = Math.max(-0.25, Math.min(0.85, (confidence - 72) * 0.032));
  const trendAdj = Math.max(0.82, Math.min(1.32, trendStrengthFactor));

  const rr1 = Number(
    Math.max(2.0, (2.0 + confBoost * 0.4 + volExpansionBoost * 0.35) * trendAdj).toFixed(2)
  );
  const rr2 = Number(
    Math.max(rr1 + 1.25, (3.4 + confBoost * 0.8 + volExpansionBoost * 0.7) * trendAdj).toFixed(2)
  );
  // Enforce strict minimum 1:5 profit-to-loss ratio (TP3 >= 5.0R) verified by RRGateKernel
  const rr3 = Number(
    Math.max(5.0, rr2 + 1.35, (5.0 + confBoost * 1.25 + volExpansionBoost * 1.15) * trendAdj).toFixed(2)
  );

  const tp1 =
    direction === 'BUY'
      ? Number((safeEntry + actualRiskDist * rr1).toPrecision(6))
      : Number(Math.max(safeEntry * 0.05, safeEntry - actualRiskDist * rr1).toPrecision(6));
  const tp2 =
    direction === 'BUY'
      ? Number((safeEntry + actualRiskDist * rr2).toPrecision(6))
      : Number(Math.max(safeEntry * 0.04, safeEntry - actualRiskDist * rr2).toPrecision(6));
  const tp3Candidate =
    direction === 'BUY'
      ? Number((safeEntry + actualRiskDist * rr3).toPrecision(6))
      : Number(Math.max(safeEntry * 0.03, safeEntry - actualRiskDist * rr3).toPrecision(6));

  const rrGateCheck = evaluateRRGate({
    direction,
    entryPrice: safeEntry,
    stopLoss: initialStopLoss,
    takeProfit: tp3Candidate,
    minRatio: 5.0,
  });
  const tp3 = rrGateCheck.passed
    ? tp3Candidate
    : Number(
        (direction === 'BUY'
          ? safeEntry + actualRiskDist * 5.0
          : Math.max(safeEntry * 0.03, safeEntry - actualRiskDist * 5.0)
        ).toPrecision(6)
      );

  const breakevenTrigger =
    direction === 'BUY'
      ? Number((safeEntry + actualRiskDist * 1.0).toPrecision(6))
      : Number((safeEntry - actualRiskDist * 1.0).toPrecision(6));

  return {
    atr14,
    atrPercent,
    volatilityRegime,
    initialStopLoss,
    maxStopLossPct,
    trailingStopLoss,
    trailingAtrMultiplier,
    trailingTakeProfit5xAtr,
    trailingStepUsd,
    breakevenTrigger,
    takeProfits: [tp1, tp2, tp3],
    dynamicRRs: [rr1, rr2, rr3],
  };
}

/**
 * Enforces the mandatory maximum stop-loss risk cap (default strict 2.0%)
 * relative to entry price for both LONG (BUY) and SHORT (SELL) setups.
 */
export function enforceMaxStopLossCap(
  entryPrice: number,
  direction: 'BUY' | 'SELL',
  rawStopLoss: number,
  maxStopLossPct = 2.0
): number {
  const safeEntry = Math.max(entryPrice, 1e-8);
  const capFraction = Math.min(0.25, Math.max(0.002, maxStopLossPct / 100));
  if (direction === 'BUY') {
    const floor = safeEntry * (1 - capFraction);
    return Number(Math.max(floor, rawStopLoss).toPrecision(6));
  }
  const ceiling = safeEntry * (1 + capFraction);
  return Number(Math.min(ceiling, rawStopLoss).toPrecision(6));
}

/**
 * Detects structural trend reversal via fast/slow EMA cross combined with swing break
 * against position direction.
 */
export function detectStructuralTrendReversal(
  candles: Candle[],
  direction: 'BUY' | 'SELL',
  currentPrice?: number
): boolean {
  if (!candles || candles.length < 16) return false;
  const closes = candles.map((c) => c.close);
  if (currentPrice && currentPrice > 0) {
    closes[closes.length - 1] = currentPrice;
  }
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const last9 = ema9[ema9.length - 1];
  const prev9 = ema9[ema9.length - 2];
  const last21 = ema21[ema21.length - 1];
  const prev21 = ema21[ema21.length - 2];
  const recentWindow = candles.slice(-8, -1);
  const swingLow = Math.min(...recentWindow.map((c) => c.low));
  const swingHigh = Math.max(...recentWindow.map((c) => c.high));
  const lastClose = closes[closes.length - 1];

  if (direction === 'BUY') {
    const emaCrossDown = prev9 >= prev21 && last9 < last21;
    const brokeSwingLow = lastClose < swingLow * 0.998;
    return emaCrossDown && brokeSwingLow;
  }
  const emaCrossUp = prev9 <= prev21 && last9 > last21;
  const brokeSwingHigh = lastClose > swingHigh * 1.002;
  return emaCrossUp && brokeSwingHigh;
}

/**
 * Updates a position's 5x ATR Trailing Take-Profit floor/ceiling monotonically
 * as price extends in the profitable direction, holding until structural reversal.
 */
export function advance5xAtrTrailingTakeProfit(params: {
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  initialStopLoss: number;
  trailingStopLoss: number;
  peakFavorablePrice: number;
  currentPrice: number;
  atr14: number;
  atrMultiplier?: number;
}): {
  nextPeakPrice: number;
  nextTrailingStop: number;
  nextTrailingTpTarget: number;
  activated: boolean;
} {
  const safeAtr = Math.max(params.atr14, params.entryPrice * 0.004);
  const mult = params.atrMultiplier ?? 5.0;

  if (params.direction === 'BUY') {
    const nextPeakPrice = Math.max(params.peakFavorablePrice, params.currentPrice);
    const atr5TriggerPrice = params.entryPrice + safeAtr * 2.0;
    const activated = nextPeakPrice >= atr5TriggerPrice;
    // Trail 1.5x ATR behind peak once activated, widening profit lock monotonically
    const dynamicTrailFloor = activated
      ? nextPeakPrice - safeAtr * 1.5
      : params.currentPrice - safeAtr * 1.25;
    const nextTrailingStop = Number(
      Math.max(
        params.trailingStopLoss,
        params.initialStopLoss,
        activated ? Math.max(params.entryPrice * 1.001, dynamicTrailFloor) : dynamicTrailFloor
      ).toPrecision(6)
    );
    const nextTrailingTpTarget = Number((nextPeakPrice + safeAtr * mult).toPrecision(6));
    return { nextPeakPrice, nextTrailingStop, nextTrailingTpTarget, activated };
  }

  const nextPeakPrice = Math.min(params.peakFavorablePrice, params.currentPrice);
  const atr5TriggerPrice = params.entryPrice - safeAtr * 2.0;
  const activated = nextPeakPrice <= atr5TriggerPrice;
  const dynamicTrailCeiling = activated
    ? nextPeakPrice + safeAtr * 1.5
    : params.currentPrice + safeAtr * 1.25;
  const nextTrailingStop = Number(
    Math.min(
      params.trailingStopLoss,
      params.initialStopLoss,
      activated ? Math.min(params.entryPrice * 0.999, dynamicTrailCeiling) : dynamicTrailCeiling
    ).toPrecision(6)
  );
  const nextTrailingTpTarget = Number(
    Math.max(params.entryPrice * 0.1, nextPeakPrice - safeAtr * mult).toPrecision(6)
  );
  return { nextPeakPrice, nextTrailingStop, nextTrailingTpTarget, activated };
}

/**
 * Updates a position's ATR Trailing Stop Loss monotonically via MonotonicTrailingStopKernel
 * (single consolidated source of truth; stops NEVER widen).
 */
export function advanceAtrTrailingStop(
  position: Pick<SandboxPosition, 'direction' | 'trailingStopLoss' | 'initialStopLoss'>,
  currentPrice: number,
  atr14: number,
  atrMultiplier = 1.25
): number {
  const safeAtr = Math.max(atr14, currentPrice * 0.005);
  const safeMult = Math.max(1.0, Math.min(3.0, atrMultiplier));
  const result = advanceMonotonicTrailingStop({
    direction: position.direction,
    prevStopLoss: position.trailingStopLoss,
    initialStopLoss: position.initialStopLoss,
    closedBar: {
      high: currentPrice,
      low: currentPrice,
      close: currentPrice,
    },
    atr14: safeAtr,
    atrMultiplier: safeMult,
  });
  return result.nextStopLoss;
}

/**
 * Skeptic Agent: Adversarially challenges each candidate trade against overextension,
 * whale netflow divergence, Futures funding-rate crowding, low consensus, and ATR cost.
 */
export function runSkepticAgent(params: {
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  rsi: number;
  ema21: number;
  riskPlan: DynamicRiskPlan;
  subAgents: SubAgentStatus[];
  whaleFlow?: WhaleFlowSnapshot;
  futuresTelemetry?: FuturesTickerTelemetry;
}): SkepticAudit {
  const challenges: string[] = [];
  let riskScore = 14;

  // 1. Overextension / Liquidity Chase Trap (execution-focused excursion check)
  const distFromEmaPct =
    params.ema21 > 0
      ? ((params.entryPrice - params.ema21) / params.ema21) * 100
      : 0;
  if (params.direction === 'BUY' && (params.rsi >= 78 || distFromEmaPct >= 6.5)) {
    riskScore += 34;
    challenges.push(
      `Overextended Long: Price stretched +${distFromEmaPct.toFixed(1)}% above structural EMA21 — risks mean-reversion flush.`
    );
  } else if (params.direction === 'SELL' && (params.rsi <= 22 || distFromEmaPct <= -6.5)) {
    riskScore += 34;
    challenges.push(
      `Oversold Short: Price stretched ${distFromEmaPct.toFixed(1)}% below structural EMA21 — risks short-squeeze bounce.`
    );
  }

  // 2. Whale Netflow Conflict
  if (params.whaleFlow) {
    const isHeavyInflow = params.whaleFlow.netflowUsd > 25_000_000;
    const isHeavyOutflow = params.whaleFlow.netflowUsd < -25_000_000;
    if (params.direction === 'BUY' && isHeavyInflow) {
      riskScore += 28;
      challenges.push(
        `Whale Conflict: Spot Exchange Inflows (+$${Math.round(params.whaleFlow.netflowUsd / 1e6)}M net) indicate distribution into longs.`
      );
    } else if (params.direction === 'SELL' && isHeavyOutflow) {
      riskScore += 28;
      challenges.push(
        `Whale Conflict: Cold Custody Outflows (-$${Math.round(Math.abs(params.whaleFlow.netflowUsd) / 1e6)}M net) show institutional accumulation.`
      );
    }
  }

  // 3. Binance Futures Funding Rate Crowding Check
  if (params.futuresTelemetry) {
    const frPct = params.futuresTelemetry.fundingRate * 100;
    if (params.direction === 'BUY' && frPct >= 0.045) {
      riskScore += 22;
      challenges.push(
        `Crowded Futures Longs: Funding +${frPct.toFixed(3)}% per 8h raises long-squeeze cascade risk.`
      );
    } else if (params.direction === 'SELL' && frPct <= -0.045) {
      riskScore += 22;
      challenges.push(
        `Crowded Futures Shorts: Negative funding ${frPct.toFixed(3)}% per 8h raises short-squeeze risk.`
      );
    }
  }

  // 4. Multi-Agent Consensus Check
  const desiredBias = params.direction === 'BUY' ? 'BULLISH' : 'BEARISH';
  const alignedAgentsCount = params.subAgents.filter(
    (a) => a.id !== 'skeptic' && a.bias === desiredBias
  ).length;
  const opposingAgentsCount = params.subAgents.filter(
    (a) => a.id !== 'skeptic' && a.bias !== 'NEUTRAL' && a.bias !== desiredBias
  ).length;

  if (opposingAgentsCount >= 2 || alignedAgentsCount <= 1) {
    riskScore += 32;
    challenges.push(
      `Weak Sub-Agent Consensus (${alignedAgentsCount}/4 aligned, ${opposingAgentsCount} opposing) — insufficient confluence.`
    );
  }

  // 5. Volatility / ATR Cost Sanity
  if (params.riskPlan.atrPercent >= 6.5) {
    riskScore += 18;
    challenges.push(
      `Extreme ATR volatility (${params.riskPlan.atrPercent}% per bar) elevates stop-hunt slippage risk.`
    );
  }

  const clampedRisk = Math.min(98, Math.max(5, Math.round(riskScore)));
  const verdict: SkepticVerdict =
    clampedRisk >= 62 || challenges.length >= 2
      ? 'VETOED'
      : clampedRisk >= 38 || challenges.length === 1
      ? 'CAUTION'
      : 'APPROVED';

  const mitigationNote =
    verdict === 'APPROVED'
      ? `Cleared all Skeptic Futures & Spot stress-tests. Trail SL automatically after TP1 ($${formatCryptoPrice(params.riskPlan.breakevenTrigger)}).`
      : verdict === 'CAUTION'
      ? `Scale down Futures leverage & tighten ATR Trailing SL to $${formatCryptoPrice(params.riskPlan.trailingStopLoss)}.`
      : 'Trade blocked by Skeptic Agent until price extension / Whale / Funding divergence resolves.';

  return {
    verdict,
    skepticRiskScore: clampedRisk,
    alignedAgentsCount,
    challenges,
    mitigationNote,
  };
}

/**
 * Autonomous AI Crypto Trading Coordinator (Binance USD-M Futures Enabled):
 * Orchestrates Market Intelligence, Whale Tracking, Technical Analysis, Risk Management,
 * Skeptic validation, Dynamic Leverage Scaling, and Cross-Margin Calculation.
 */
export function coordinateMultiAgentTrade(
  signal: TradingSignal,
  candles: Candle[],
  newsItems: NewsItem[],
  whaleFlow?: WhaleFlowSnapshot,
  futuresTelemetry?: FuturesTickerTelemetry,
  options?: {
    futuresEnabled?: boolean;
    notionalUsd?: number;
    manualLeverage?: number;
    scalingMode?: LeverageScalingMode;
    marginMode?: MarginMode;
    crossAvailableBalanceUsd?: number;
    sourceModule?: 'AI_ENGINE' | 'SMC_FRVP' | 'PATTERN_SCANNER';
    sourceLabel?: string;
    orderBookDepth?: MultiExchangeDepthAnalysis;
    sentinelAssessment?: SentinelAssessment;
  }
): CoordinatedTradePlan {
  const futuresEnabled = Boolean(options?.futuresEnabled);
  const closes = candles.map((c) => c.close);
  const rsi = calculateRSI(closes, 14);
  const ema21Arr = calculateEMA(closes, 21);
  const ema21 = ema21Arr[ema21Arr.length - 1] ?? signal.entryPrice;
  const pattern = detectCandlePatterns(candles);
  const fundamental = runFundamentalAgent(signal.baseAsset, newsItems);

  const effectiveEntry =
    futuresEnabled && futuresTelemetry && futuresTelemetry.markPrice > 0
      ? futuresTelemetry.markPrice
      : signal.entryPrice;

  const emaGapPct = ema21 > 0 ? Math.abs((effectiveEntry - ema21) / ema21) * 100 : 1;
  const trendStrengthFactor =
    0.92 + Math.min(0.32, emaGapPct * 0.08 + (signal.confidence - 65) * 0.005);

  const isMomentumLeader =
    Boolean(signal.isTopGainer) || (signal.prePumpScore ?? 0) >= 65;

  const riskPlan = buildDynamicRiskAndAtrPlan(
    candles,
    effectiveEntry,
    signal.direction,
    signal.confidence,
    trendStrengthFactor,
    isMomentumLeader
  );

  // Market Intelligence Agent (incorporates Binance USD-M Futures funding & OI bias)
  const frPct = futuresTelemetry ? futuresTelemetry.fundingRate * 100 : 0.01;
  const marketIntelBias: SubAgentStatus['bias'] =
    fundamental.score >= 10 || (signal.isTopGainer && (signal.change24hPercent ?? 0) > 2)
      ? 'BULLISH'
      : fundamental.score <= -10
      ? 'BEARISH'
      : 'NEUTRAL';

  const marketIntelAgent: SubAgentStatus = {
    id: 'market_intel',
    name: 'Market Intelligence Agent',
    role: futuresEnabled ? 'Futures Funding & Macro Catalysts' : 'Spot Liquidity & Macro Catalysts',
    bias: marketIntelBias,
    confidence: Math.min(95, Math.max(52, 62 + Math.round(Math.abs(fundamental.score) * 0.35))),
    metricLabel:
      futuresEnabled && futuresTelemetry
        ? `Funding ${frPct >= 0 ? '+' : ''}${frPct.toFixed(3)}%`
        : signal.isTopGainer
        ? `Top Gainer #${signal.gainerRank}`
        : `${fundamental.articleCount} Catalysts`,
    summary:
      futuresEnabled && futuresTelemetry
        ? `USD-M OI $${Math.round(futuresTelemetry.openInterestUsd / 1e6)}M · ${fundamental.summary}`
        : fundamental.summary,
  };

  let whaleBias: SubAgentStatus['bias'] = 'NEUTRAL';
  let whaleMetric = 'Balanced Flows';
  let whaleSummary = 'No abnormal exchange whale imbalance detected.';
  if (whaleFlow) {
    if (whaleFlow.netflowUsd < -5_000_000) {
      whaleBias = 'BULLISH';
      whaleMetric = `Outflow -$${Math.round(Math.abs(whaleFlow.netflowUsd) / 1e6)}M`;
      whaleSummary = `Whales withdrawing ${signal.baseAsset} to cold custody (accumulation).`;
    } else if (whaleFlow.netflowUsd > 5_000_000) {
      whaleBias = 'BEARISH';
      whaleMetric = `Inflow +$${Math.round(whaleFlow.netflowUsd / 1e6)}M`;
      whaleSummary = `Heavy ${signal.baseAsset} exchange deposits (sell-side distribution risk).`;
    }
  } else {
    const lastCandle = candles[candles.length - 1];
    const isUpBar = lastCandle && lastCandle.close >= lastCandle.open;
    whaleBias = isUpBar ? 'BULLISH' : 'BEARISH';
    whaleMetric = futuresEnabled
      ? isUpBar
        ? 'Futures Taker Buy'
        : 'Futures Taker Sell'
      : isUpBar
      ? 'Spot Taker Buy'
      : 'Spot Taker Sell';
    whaleSummary = isUpBar
      ? `Orderbook volume absorbing dips near ${futuresEnabled ? 'Mark' : 'Spot'} $${formatCryptoPrice(effectiveEntry)}.`
      : `Resting ask supply pressure observed near ${futuresEnabled ? 'Mark' : 'Spot'} $${formatCryptoPrice(effectiveEntry)}.`;
  }

  const whaleAgent: SubAgentStatus = {
    id: 'whale_tracker',
    name: 'Whale Tracking Agent',
    role: 'On-Chain & Exchange Netflow',
    bias: whaleBias,
    confidence: whaleFlow ? 82 : 68,
    metricLabel: whaleMetric,
    summary: whaleSummary,
  };

  const techBias: SubAgentStatus['bias'] =
    signal.technicalScore >= 8
      ? 'BULLISH'
      : signal.technicalScore <= -8
      ? 'BEARISH'
      : 'NEUTRAL';
  const technicalAgent: SubAgentStatus = {
    id: 'technical',
    name: 'Structure & Execution Agent',
    role: 'Price Action · SMC · Breakout',
    bias: techBias,
    confidence: Math.min(96, Math.max(55, 55 + Math.round(Math.abs(signal.technicalScore) * 0.4))),
    metricLabel: `${pattern.name} · Bias ${signal.technicalScore >= 0 ? '+' : ''}${signal.technicalScore}`,
    summary: `${pattern.name} execution alignment with ATR $${formatCryptoPrice(riskPlan.atr14)} volatility envelope.`,
  };

  const coreWithoutRisk = [marketIntelAgent, whaleAgent, technicalAgent];
  // Preliminary risk bias before full skeptic audit
  const prelimRiskAgent: SubAgentStatus = {
    id: 'risk_mgmt',
    name: 'Risk Management Agent',
    role: 'Futures Leverage & Cross Margin',
    bias: signal.direction === 'BUY' ? 'BULLISH' : 'BEARISH',
    confidence: 88,
    metricLabel: `ATR ${riskPlan.atrPercent}%`,
    summary: 'Sizing dynamic leverage & Cross-Margin buffer.',
  };

  const skeptic = runSkepticAgent({
    direction: signal.direction,
    entryPrice: effectiveEntry,
    rsi,
    ema21,
    riskPlan,
    subAgents: [...coreWithoutRisk, prelimRiskAgent],
    whaleFlow,
    futuresTelemetry,
  });

  const stopDistPct =
    effectiveEntry > 0
      ? (Math.abs(effectiveEntry - riskPlan.initialStopLoss) / effectiveEntry) * 100
      : riskPlan.atrPercent * 1.55;

  const recommendedLeverage = computeVolatilityScaledLeverage({
    atrPercent: riskPlan.atrPercent,
    confidence: signal.confidence,
    skepticRiskScore: skeptic.skepticRiskScore,
    maxLeverage: futuresTelemetry?.maxLeverage ?? 50,
    stopDistancePercent: stopDistPct,
  });

  const scalingMode: LeverageScalingMode = options?.scalingMode ?? 'AUTO_VOLATILITY';
  const activeLeverage = !futuresEnabled
    ? 1
    : scalingMode === 'MANUAL' && options?.manualLeverage
    ? options.manualLeverage
    : recommendedLeverage;

  const notional = Math.max(25, options?.notionalUsd ?? 1500);
  const futuresMargin: FuturesMarginBreakdown = futuresEnabled
    ? calculateFuturesDynamicMargin({
        entryPrice: effectiveEntry,
        stopLoss: riskPlan.initialStopLoss,
        direction: signal.direction,
        notionalUsd: notional,
        leverage: activeLeverage,
        recommendedLeverage,
        maxLeverage: futuresTelemetry?.maxLeverage ?? 50,
        scalingMode,
        marginMode: options?.marginMode ?? 'CROSS',
        crossAvailableBalanceUsd: options?.crossAvailableBalanceUsd ?? 25000,
        fundingRate: futuresTelemetry?.fundingRate ?? 0.0001,
      })
    : {
        leverage: 1,
        recommendedLeverage: 1,
        maxLeverage: 1,
        scalingMode: 'MANUAL',
        marginMode: 'CROSS',
        notionalUsd: Number(notional.toFixed(2)),
        initialMarginUsd: Number(notional.toFixed(2)),
        maintenanceMarginUsd: 0,
        maintenanceMarginRate: 0,
        estimatedFeeUsd: Number((notional * 0.001).toFixed(2)),
        liquidationPrice: 0,
        stopBeforeLiquidationSafe: true,
        fundingImpactUsd8h: 0,
      };

  const depth = options?.orderBookDepth;
  if (depth && depth.symbol === signal.symbol) {
    whaleBias = depth.imbalanceBias;
    const obiPct = `${depth.netOrderBookImbalance >= 0 ? '+' : ''}${(depth.netOrderBookImbalance * 100).toFixed(1)}% OBI`;
    whaleMetric = `${obiPct} · ${depth.whaleWalls.length} Walls`;
    whaleSummary = depth.summary;
  }

  const sentinel = options?.sentinelAssessment;
  const sentinelSubAgent: SubAgentStatus = sentinel
    ? {
        id: 'sentinel',
        name: 'Sentinel Panic/FUD Agent',
        role: 'X/News Anomaly & Preemptive Hedge',
        bias:
          sentinel.recommendedAction === 'PREEMPTIVE_MOMENTUM_LONG'
            ? 'BULLISH'
            : sentinel.recommendedAction === 'PREEMPTIVE_HEDGE_SHORT'
            ? 'BEARISH'
            : 'NEUTRAL',
        confidence: sentinel.threatScore,
        metricLabel: `${sentinel.regime} · ${sentinel.verificationStatus === 'VERIFIED_CROSS_PLATFORM' ? 'X+News Verified' : sentinel.verificationStatus}`,
        summary: sentinel.summary,
      }
    : {
        id: 'sentinel',
        name: 'Sentinel Panic/FUD Agent',
        role: 'X/News Anomaly & Preemptive Hedge',
        bias: fundamental.score >= 12 ? 'BULLISH' : fundamental.score <= -12 ? 'BEARISH' : 'NEUTRAL',
        confidence: 78,
        metricLabel: 'NORMAL · Monitoring WS',
        summary: 'Monitoring X cross-platform velocity, FUD spikes, and sudden pump/dump liquidations.',
      };

  const orderbookDepthAgent: SubAgentStatus = {
    id: 'orderbook_depth',
    name: 'L2 Order Book Depth Agent',
    role: 'Binance · Bybit · OKX Liquidity',
    bias: depth ? depth.imbalanceBias : whaleBias,
    confidence: depth ? depth.preActionLeadConfidence : whaleFlow ? 80 : 68,
    metricLabel: depth
      ? `${depth.liquidityShift.replace(/_/g, ' ')}`
      : whaleMetric,
    summary: depth ? depth.summary : whaleSummary,
  };

  const riskAgent: SubAgentStatus = {
    id: 'risk_mgmt',
    name: 'Risk Management Agent',
    role: futuresEnabled ? '2% Max Risk · Min 1:5 R:R · Futures' : '2% Max Risk · Min 1:5 R:R · Spot',
    bias: signal.direction === 'BUY' ? 'BULLISH' : 'BEARISH',
    confidence: 91,
    metricLabel: futuresEnabled
      ? `${futuresMargin.leverage}x ${futuresMargin.marginMode} · SL ${riskPlan.maxStopLossPct}%`
      : `SPOT 1x · Risk ${riskPlan.maxStopLossPct}% (<=2%)`,
    summary: futuresEnabled
      ? `Scaled ${futuresMargin.leverage}x (${futuresMargin.marginMode}) · Min 1:5 R:R (${riskPlan.dynamicRRs[2]}R) · ATR Trail SL · Hard 2% Max Risk.`
      : `Spot 1x ($${futuresMargin.notionalUsd}) · Min 1:5 R:R (${riskPlan.dynamicRRs[2]}R) · ATR Trail SL · Hard 2% Max Risk (${riskPlan.maxStopLossPct}%).`,
  };

  const skepticAgentStatus: SubAgentStatus = {
    id: 'skeptic',
    name: 'Skeptic Validation Agent',
    role: 'Adversarial Trap & Flow Audit',
    bias:
      skeptic.verdict === 'VETOED'
        ? 'NEUTRAL'
        : signal.direction === 'BUY'
        ? 'BULLISH'
        : 'BEARISH',
    confidence: 100 - skeptic.skepticRiskScore,
    metricLabel: `${skeptic.verdict} (${skeptic.skepticRiskScore}% Risk)`,
    summary:
      skeptic.challenges.length > 0
        ? skeptic.challenges[0]
        : `Zero red flags across ${skeptic.alignedAgentsCount} sub-agents & Spot/CMC baseline parity.`,
  };

  const routeToTelegram = signal.confidence >= 80 && skeptic.verdict !== 'VETOED';

  const telegramMessage = futuresEnabled
    ? [
        `SIGNAL FORGE FUTURES COORDINATOR ALERT`,
        `${signal.symbol} USD-M PERP — ${signal.direction === 'BUY' ? 'LONG (BUY)' : 'SHORT (SELL)'} | ${futuresMargin.leverage}x ${futuresMargin.marginMode} | Conf: ${signal.confidence}% | Skeptic: ${skeptic.verdict}`,
        `Mark Entry: $${formatCryptoPrice(effectiveEntry)} | SL (${riskPlan.maxStopLossPct}% Max Cap): $${formatCryptoPrice(riskPlan.trailingStopLoss)} | 5x ATR TP: $${formatCryptoPrice(riskPlan.trailingTakeProfit5xAtr)}`,
        `Dynamic Targets: TP1 $${formatCryptoPrice(riskPlan.takeProfits[0])} (${riskPlan.dynamicRRs[0]}R) · TP2 $${formatCryptoPrice(riskPlan.takeProfits[1])} (${riskPlan.dynamicRRs[1]}R) · TP3 $${formatCryptoPrice(riskPlan.takeProfits[2])} (${riskPlan.dynamicRRs[2]}R)`,
        `Margin: IM $${futuresMargin.initialMarginUsd} ($${futuresMargin.notionalUsd} Notional) · Cross Liq $${formatCryptoPrice(futuresMargin.liquidationPrice)}`,
        `Desk: Signal Forge Terminal`,
      ].join('\n')
    : [
        `SIGNAL FORGE SPOT COORDINATOR ALERT`,
        `${signal.symbol} SPOT 1x — ${signal.direction === 'BUY' ? 'LONG (BUY)' : 'SHORT (SELL)'} | Conf: ${signal.confidence}% | Skeptic: ${skeptic.verdict}`,
        `Spot Entry: $${formatCryptoPrice(effectiveEntry)} | SL (${riskPlan.maxStopLossPct}% Max Cap): $${formatCryptoPrice(riskPlan.trailingStopLoss)} | 5x ATR TP: $${formatCryptoPrice(riskPlan.trailingTakeProfit5xAtr)}`,
        `Dynamic Targets: TP1 $${formatCryptoPrice(riskPlan.takeProfits[0])} (${riskPlan.dynamicRRs[0]}R) · TP2 $${formatCryptoPrice(riskPlan.takeProfits[1])} (${riskPlan.dynamicRRs[1]}R) · TP3 $${formatCryptoPrice(riskPlan.takeProfits[2])} (${riskPlan.dynamicRRs[2]}R)`,
        `Allocation: $${futuresMargin.notionalUsd} Spot Principal (1x · Zero Liquidation)`,
        `Desk: Signal Forge Terminal`,
      ].join('\n');

  const sourceModule = options?.sourceModule ?? 'AI_ENGINE';
  const sourceLabel =
    options?.sourceLabel ??
    (sourceModule === 'SMC_FRVP'
      ? `SMC · ${signal.smc?.zoneLabel || 'Order Block'}`
      : sourceModule === 'PATTERN_SCANNER'
      ? `Pattern · ${signal.indicators.pattern}`
      : 'AI Coordinator');

  return {
    id: `coord_${sourceModule}_${signal.symbol}_${signal.direction}`,
    symbol: signal.symbol,
    coinName: signal.coinName,
    direction: signal.direction,
    entryPrice: effectiveEntry,
    confidence: signal.confidence,
    marketType: futuresEnabled ? 'USD_M_FUTURES' : 'SPOT',
    sourceModule,
    sourceLabel,
    futuresTelemetry: futuresEnabled ? futuresTelemetry : undefined,
    riskPlan,
    futuresMargin,
    skeptic,
    subAgents: [
      marketIntelAgent,
      whaleAgent,
      orderbookDepthAgent,
      technicalAgent,
      sentinelSubAgent,
      riskAgent,
      skepticAgentStatus,
    ],
    routeToTelegram,
    telegramMessage,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Direct bridge connecting the Smart Money Concepts & FRVP module to the Coordinator Execution Engine.
 */
export function smcAnalysisToTradingSignal(
  smc: SmcAgentAnalysis,
  candles: Candle[],
  newsItems: NewsItem[] = [],
  liveTicker?: LiveTickerInput
): TradingSignal {
  const atr = computeATR(candles, 14);
  const entrySnapshot = resolveLiveEntryPriceSnapshot(candles, smc.entryPrice, liveTicker);
  const resolvedEntry =
    entrySnapshot.source === 'LIVE_WS_FEED' ? entrySnapshot.entryPrice : smc.entryPrice;
  const trailingStop =
    smc.direction === 'BUY'
      ? Number(Math.max(smc.stopLoss, resolvedEntry - atr * 1.25).toPrecision(6))
      : Number(Math.min(smc.stopLoss, resolvedEntry + atr * 1.25).toPrecision(6));
  const baseAsset = smc.symbol.replace(/USDT$/i, '');
  const fundamental = runFundamentalAgent(baseAsset, newsItems);

  return {
    id: `smc_${smc.symbol}_${smc.direction}`,
    symbol: smc.symbol,
    baseAsset,
    coinName: smc.coinName,
    direction: smc.direction,
    entryPrice: resolvedEntry,
    entryPriceSource: entrySnapshot.source,
    stopLoss: smc.stopLoss,
    trailingStop,
    atrValue: atr,
    dynamicRRs: [2, 3.5, smc.riskRewardRatio || 5],
    takeProfits: smc.takeProfits,
    confidence: smc.confidence,
    technicalScore: smc.score,
    fundamentalScore: fundamental.score,
    smcScore: smc.score,
    indicators: {
      rsi: 50,
      ema9: resolvedEntry,
      ema21: resolvedEntry,
      ema50: smc.volumeProfile.poc,
      macdLine: 0,
      macdSignal: 0,
      macdHistogram: 0,
      bbUpper: smc.volumeProfile.vah,
      bbMiddle: smc.volumeProfile.poc,
      bbLower: smc.volumeProfile.val,
      bbPercentB: 0.5,
      pattern: `${smc.zoneLabel} (${smc.retestStatus})`,
      score: smc.score,
      summary: smc.structure.summary,
    },
    fundamental,
    smc,
    reason: smc.rationale,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Direct bridge connecting confirmed Chart Pattern Scanner breakouts/breakdowns to the Coordinator Execution Engine.
 */
export function patternResultToTradingSignal(
  pat: PatternScanResult,
  candles: Candle[],
  newsItems: NewsItem[] = [],
  liveTicker?: LiveTickerInput
): TradingSignal {
  const atr = computeATR(candles, 14);
  const entrySnapshot = resolveLiveEntryPriceSnapshot(candles, pat.entryPrice, liveTicker);
  const resolvedEntry =
    entrySnapshot.source === 'LIVE_WS_FEED' ? entrySnapshot.entryPrice : pat.entryPrice;
  const trailingStop =
    pat.direction === 'BUY'
      ? Number(Math.max(pat.stopLoss, resolvedEntry - atr * 1.25).toPrecision(6))
      : Number(Math.min(pat.stopLoss, resolvedEntry + atr * 1.25).toPrecision(6));
  const fundamental = runFundamentalAgent(pat.baseAsset, newsItems);
  const techScore = pat.direction === 'BUY' ? Math.min(92, pat.confidence) : -Math.min(92, pat.confidence);

  return {
    id: pat.id,
    symbol: pat.symbol,
    baseAsset: pat.baseAsset,
    coinName: pat.coinName,
    direction: pat.direction,
    entryPrice: resolvedEntry,
    entryPriceSource: entrySnapshot.source,
    stopLoss: pat.stopLoss,
    trailingStop,
    atrValue: atr,
    dynamicRRs: [1.5, 2.2, pat.riskRewardRatio || 3],
    takeProfits: pat.takeProfits,
    confidence: pat.confidence,
    technicalScore: techScore,
    fundamentalScore: fundamental.score,
    indicators: {
      rsi: pat.rsi,
      ema9: resolvedEntry,
      ema21: pat.breakoutLevel,
      ema50: pat.breakoutLevel,
      macdLine: 0,
      macdSignal: 0,
      macdHistogram: 0,
      bbUpper: pat.takeProfits[0],
      bbMiddle: pat.breakoutLevel,
      bbLower: pat.stopLoss,
      bbPercentB: 0.5,
      pattern: `${pat.patternName} (${pat.moveType})`,
      score: techScore,
      summary: pat.summary,
    },
    fundamental,
    reason: pat.summary,
    generatedAt: pat.detectedAt,
  };
}

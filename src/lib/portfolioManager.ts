import { computeATR } from './coordinator';
import type { Candle, TickerSnapshot } from './marketData';
import type { SandboxPosition } from './coordinator';

export type ExposureRegime = 'UNDER_EXPOSED' | 'BALANCED' | 'OVER_EXPOSED';
export type VolatilityRiskRegime = 'CALM' | 'MODERATE' | 'ELEVATED' | 'EXTREME';
export type RebalanceTriggerMode = 'HYBRID' | 'THRESHOLD_ONLY' | 'PERIODIC_ONLY';
export type RebalanceActionType = 'BUY' | 'SELL' | 'HOLD';

export interface PortfolioHoldingSeed {
  symbol: string;
  baseAsset: string;
  name: string;
  units: number;
  manualTargetWeightPct: number;
  fallbackDailyVolPct: number;
  color: string;
}

export interface PortfolioRebalanceConfig {
  autoRebalanceEnabled: boolean;
  volatilityWeightingEnabled: boolean;
  triggerMode: RebalanceTriggerMode;
  driftThresholdPct: number; // e.g. 3.5% drift
  periodicIntervalMinutes: number; // 15 | 60 | 240 | 1440
  maxGrossExposurePct: number; // e.g. 100% (under >75? or over > max)
  minStablecoinReservePct: number; // e.g. 15%
  maxSingleAssetPct: number; // e.g. 38%
}

export interface EvaluatedPortfolioAsset {
  symbol: string;
  baseAsset: string;
  name: string;
  units: number;
  markPrice: number;
  notionalUsd: number;
  currentWeightPct: number; // % of total portfolio equity
  targetWeightPct: number; // % of total portfolio equity
  manualTargetWeightPct: number;
  volatilityTargetWeightPct: number;
  driftPct: number; // currentWeightPct - targetWeightPct
  exposureStatus: ExposureRegime;
  atrPercent: number;
  annualizedVolatilityPct: number;
  volRegime: VolatilityRiskRegime;
  targetUsd: number;
  rebalanceDeltaUsd: number;
  suggestedAction: RebalanceActionType;
  color: string;
}

export interface MultiAssetExposureSummary {
  totalEquityUsd: number;
  deployedExposureUsd: number;
  stablecoinReserveUsd: number;
  stablecoinReservePct: number;
  futuresLongExposureUsd: number;
  futuresShortExposureUsd: number;
  grossExposurePct: number;
  netExposurePct: number;
  targetDeploymentPct: number;
  exposureDeltaPct: number; // grossExposurePct - targetDeploymentPct
  regime: ExposureRegime;
  regimeLabel: string;
  underExposedAssets: string[];
  overExposedAssets: string[];
  maxAbsDriftPct: number;
}

export interface VolatilityRiskSummary {
  portfolioAnnualizedVolPct: number;
  portfolioAtrPct: number;
  var95DailyPct: number;
  var95DailyUsd: number;
  diversificationRatio: number;
  riskScore: number; // 0 .. 100
  riskRegime: VolatilityRiskRegime;
}

export interface RebalanceTriggerStatus {
  shouldExecute: boolean;
  reason: 'THRESHOLD_BREACHED' | 'PERIODIC_DUE' | 'EXPOSURE_CAP_EXCEEDED' | 'NONE';
  summaryText: string;
  breachedSymbols: string[];
  nextPeriodicDueAt: string;
  minutesUntilPeriodicDue: number;
}

export interface PortfolioEvaluationResult {
  assets: EvaluatedPortfolioAsset[];
  exposureMeter: MultiAssetExposureSummary;
  volatilityRisk: VolatilityRiskSummary;
  rebalanceTrigger: RebalanceTriggerStatus;
  config: PortfolioRebalanceConfig;
  evaluatedAt: string;
}

export interface RebalanceTradeItem {
  symbol: string;
  action: 'BUY' | 'SELL';
  notionalUsd: number;
  unitsDelta: number;
  executionPrice: number;
  preWeightPct: number;
  postWeightPct: number;
}

export interface RebalanceExecutionRecord {
  id: string;
  triggerReason: 'THRESHOLD_BREACHED' | 'PERIODIC_DUE' | 'EXPOSURE_CAP_EXCEEDED' | 'MANUAL';
  tradesExecuted: number;
  movedNotionalUsd: number;
  preMaxDriftPct: number;
  postMaxDriftPct: number;
  volRiskScoreAtExecution: number;
  trades: RebalanceTradeItem[];
  executedAt: string;
}

export const PORTFOLIO_COLORS: Record<string, string> = {
  BTCUSDT: '#3b82f6',
  ETHUSDT: '#8b5cf6',
  SOLUSDT: '#10b981',
  BNBUSDT: '#f59e0b',
  AVAXUSDT: '#06b6d4',
  LINKUSDT: '#ec4899',
  USDT: '#475569',
};

export const DEFAULT_REBALANCE_CONFIG: PortfolioRebalanceConfig = {
  autoRebalanceEnabled: true,
  volatilityWeightingEnabled: true,
  triggerMode: 'HYBRID',
  driftThresholdPct: 3.0,
  periodicIntervalMinutes: 60,
  maxGrossExposurePct: 100,
  minStablecoinReservePct: 15,
  maxSingleAssetPct: 38,
};

export const DEFAULT_PORTFOLIO_SEEDS: PortfolioHoldingSeed[] = [
  {
    symbol: 'BTCUSDT',
    baseAsset: 'BTC',
    name: 'Bitcoin',
    units: 0.145,
    manualTargetWeightPct: 30,
    fallbackDailyVolPct: 2.6,
    color: PORTFOLIO_COLORS.BTCUSDT,
  },
  {
    symbol: 'ETHUSDT',
    baseAsset: 'ETH',
    name: 'Ethereum',
    units: 3.1,
    manualTargetWeightPct: 22,
    fallbackDailyVolPct: 3.4,
    color: PORTFOLIO_COLORS.ETHUSDT,
  },
  {
    symbol: 'SOLUSDT',
    baseAsset: 'SOL',
    name: 'Solana',
    units: 52,
    manualTargetWeightPct: 16,
    fallbackDailyVolPct: 5.2,
    color: PORTFOLIO_COLORS.SOLUSDT,
  },
  {
    symbol: 'BNBUSDT',
    baseAsset: 'BNB',
    name: 'BNB',
    units: 5.4,
    manualTargetWeightPct: 10,
    fallbackDailyVolPct: 2.8,
    color: PORTFOLIO_COLORS.BNBUSDT,
  },
  {
    symbol: 'AVAXUSDT',
    baseAsset: 'AVAX',
    name: 'Avalanche',
    units: 42,
    manualTargetWeightPct: 7,
    fallbackDailyVolPct: 5.8,
    color: PORTFOLIO_COLORS.AVAXUSDT,
  },
];

export const DEFAULT_STABLECOIN_RESERVE_USD = 4200;

export function safeFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function normalizeRebalanceConfig(
  patch?: Partial<PortfolioRebalanceConfig> | null,
  base: PortfolioRebalanceConfig = DEFAULT_REBALANCE_CONFIG
): PortfolioRebalanceConfig {
  const src = patch && typeof patch === 'object' ? patch : {};
  const triggerMode: RebalanceTriggerMode =
    src.triggerMode === 'THRESHOLD_ONLY' ||
    src.triggerMode === 'PERIODIC_ONLY' ||
    src.triggerMode === 'HYBRID'
      ? src.triggerMode
      : base.triggerMode;

  const validIntervals = new Set([15, 60, 240, 1440]);
  const rawInterval = safeFiniteNumber(src.periodicIntervalMinutes, base.periodicIntervalMinutes);
  const periodicIntervalMinutes = validIntervals.has(rawInterval)
    ? rawInterval
    : base.periodicIntervalMinutes;

  return {
    autoRebalanceEnabled:
      typeof src.autoRebalanceEnabled === 'boolean'
        ? src.autoRebalanceEnabled
        : base.autoRebalanceEnabled,
    volatilityWeightingEnabled:
      typeof src.volatilityWeightingEnabled === 'boolean'
        ? src.volatilityWeightingEnabled
        : base.volatilityWeightingEnabled,
    triggerMode,
    driftThresholdPct: Number(
      clampNumber(
        safeFiniteNumber(src.driftThresholdPct, base.driftThresholdPct),
        0.5,
        20
      ).toFixed(1)
    ),
    periodicIntervalMinutes,
    maxGrossExposurePct: Math.round(
      clampNumber(
        safeFiniteNumber(src.maxGrossExposurePct, base.maxGrossExposurePct),
        50,
        200
      )
    ),
    minStablecoinReservePct: Math.round(
      clampNumber(
        safeFiniteNumber(src.minStablecoinReservePct, base.minStablecoinReservePct),
        0,
        60
      )
    ),
    maxSingleAssetPct: Math.round(
      clampNumber(
        safeFiniteNumber(src.maxSingleAssetPct, base.maxSingleAssetPct),
        10,
        80
      )
    ),
  };
}

/**
 * Computes realized annualized volatility (%) and ATR% from recent candles.
 * Defensively handles null, sparse, or zero-priced candles.
 */
export function computeAssetVolatilityProfile(
  candles?: Candle[] | null,
  fallbackDailyVolPct = 3.2
): {
  atrPercent: number;
  annualizedVolatilityPct: number;
  volRegime: VolatilityRiskRegime;
} {
  const cleanDailyFallback = clampNumber(safeFiniteNumber(fallbackDailyVolPct, 3.2), 0.5, 25);
  const fallbackAnn = Number((cleanDailyFallback * Math.sqrt(365)).toFixed(1));

  if (!Array.isArray(candles) || candles.length < 10) {
    return {
      atrPercent: Number(cleanDailyFallback.toFixed(2)),
      annualizedVolatilityPct: fallbackAnn,
      volRegime: classifyVolatilityRegime(fallbackAnn),
    };
  }

  const validCandles = candles.filter(
    (c) =>
      c &&
      Number.isFinite(c.close) &&
      c.close > 0 &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low)
  );
  if (validCandles.length < 10) {
    return {
      atrPercent: Number(cleanDailyFallback.toFixed(2)),
      annualizedVolatilityPct: fallbackAnn,
      volRegime: classifyVolatilityRegime(fallbackAnn),
    };
  }

  const latestClose = validCandles[validCandles.length - 1].close;
  const atr = computeATR(validCandles, 14);
  const atrPercent = clampNumber((atr / Math.max(latestClose, 1e-8)) * 100, 0.35, 18);

  const slice = validCandles.slice(-30);
  const returns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const prev = slice[i - 1].close;
    const cur = slice[i].close;
    if (prev > 0 && cur > 0) {
      returns.push(Math.log(cur / prev));
    }
  }

  let stdPerBar = cleanDailyFallback / 100 / Math.sqrt(6);
  if (returns.length >= 4) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((acc, r) => acc + Math.pow(r - mean, 2), 0) / (returns.length - 1);
    stdPerBar = Math.max(0.002, Math.sqrt(variance));
  }

  // Detect bar spacing (cap high-frequency intraday noise amplification cleanly)
  let barsPerDay = 6;
  if (slice.length >= 2) {
    const dtSec = Math.max(300, slice[slice.length - 1].time - slice[slice.length - 2].time);
    barsPerDay = clampNumber(86400 / dtSec, 1, 24);
  }

  // Blend per-bar log-return volatility with ATR%-scaled daily volatility for regime stability
  const atrDailyVolPct = clampNumber((atrPercent / 100) * Math.sqrt(Math.min(6, barsPerDay)) * 0.85, 0.008, 0.16);
  const logDailyVol = stdPerBar * Math.sqrt(barsPerDay);
  const blendedDailyVol = logDailyVol * 0.55 + atrDailyVolPct * 0.45;
  const annualized = clampNumber(blendedDailyVol * Math.sqrt(365) * 100, 18, 195);
  const roundedAnn = Number(annualized.toFixed(1));
  return {
    atrPercent: Number(atrPercent.toFixed(2)),
    annualizedVolatilityPct: roundedAnn,
    volRegime: classifyVolatilityRegime(roundedAnn),
  };
}

export function classifyVolatilityRegime(annualizedVolPct: number): VolatilityRiskRegime {
  if (!Number.isFinite(annualizedVolPct) || annualizedVolPct < 38) return 'CALM';
  if (annualizedVolPct < 68) return 'MODERATE';
  if (annualizedVolPct < 105) return 'ELEVATED';
  return 'EXTREME';
}

/**
 * Computes inverse-volatility risk parity weights summing cleanly to targetAllocationTotalPct
 * while clamping single-asset concentration below maxSingleAssetPct.
 */
export function computeVolatilityParityWeights(
  items: Array<{ symbol: string; annualizedVolatilityPct: number }>,
  targetAllocationTotalPct: number,
  maxSingleAssetPct: number
): Record<string, number> {
  const result: Record<string, number> = {};
  if (!Array.isArray(items) || items.length === 0) return result;

  const allocBudget = clampNumber(safeFiniteNumber(targetAllocationTotalPct, 85), 0, 200);
  if (allocBudget <= 0) {
    for (const item of items) result[item.symbol] = 0;
    return result;
  }

  const invVols = items.map((item) => ({
    symbol: item.symbol,
    invVol: 1 / Math.max(10, safeFiniteNumber(item.annualizedVolatilityPct, 50)),
  }));
  const invSum = invVols.reduce((acc, x) => acc + x.invVol, 0) || 1;

  // Iterative water-filling cap so no single asset exceeds maxSingleAssetPct
  const cap = clampNumber(safeFiniteNumber(maxSingleAssetPct, 38), 10, 100);
  const locked = new Map<string, number>();
  let remainingBudget = allocBudget;
  let active = [...invVols];

  for (let pass = 0; pass < items.length; pass++) {
    const activeSum = active.reduce((acc, x) => acc + x.invVol, 0);
    if (activeSum <= 0 || active.length === 0) break;
    let cappedAny = false;
    const nextActive: typeof active = [];
    for (const entry of active) {
      const share = (entry.invVol / activeSum) * remainingBudget;
      if (share > cap) {
        locked.set(entry.symbol, cap);
        remainingBudget = Math.max(0, remainingBudget - cap);
        cappedAny = true;
      } else {
        nextActive.push(entry);
      }
    }
    active = nextActive;
    if (!cappedAny) break;
  }

  const finalActiveSum = active.reduce((acc, x) => acc + x.invVol, 0);
  for (const entry of active) {
    const share = finalActiveSum > 0 ? (entry.invVol / finalActiveSum) * remainingBudget : 0;
    locked.set(entry.symbol, share);
  }

  for (const item of items) {
    result[item.symbol] = Number((locked.get(item.symbol) ?? 0).toFixed(2));
  }

  // Fix rounding drift on the first asset if total differs from allocBudget slightly
  const assignedSum = Object.values(result).reduce((a, b) => a + b, 0);
  const diff = Number((allocBudget - assignedSum).toFixed(2));
  if (Math.abs(diff) > 0 && items[0]) {
    result[items[0].symbol] = Number(
      clampNumber((result[items[0].symbol] ?? 0) + diff, 0, cap).toFixed(2)
    );
  }
  return result;
}

const REFERENCE_PRICES: Record<string, number> = {
  BTCUSDT: 64300,
  ETHUSDT: 1805,
  SOLUSDT: 71.2,
  BNBUSDT: 588,
  AVAXUSDT: 24.5,
  LINKUSDT: 16.4,
  XRPUSDT: 0.95,
  ADAUSDT: 0.42,
  DOGEUSDT: 0.14,
  NEARUSDT: 5.1,
};

/**
 * Evaluates full Multi-Asset Portfolio state:
 * - Current vs Target Allocation (Dynamic Volatility Parity or Manual Weights)
 * - Multi-Asset Exposure Meter (Under-Exposed vs Balanced vs Over-Exposed)
 * - Real-Time Volatility Risk Gauges
 * - Auto-Rebalancing threshold & periodic triggers
 */
export function evaluateMultiAssetPortfolio(params: {
  holdings?: PortfolioHoldingSeed[] | null;
  stablecoinReserveUsd?: number | null;
  positions?: SandboxPosition[] | null;
  tickers?: Record<string, TickerSnapshot> | null;
  candlesMap?: Record<string, Candle[]> | null;
  config?: Partial<PortfolioRebalanceConfig> | null;
  lastRebalanceAt?: string | null;
  nowMs?: number;
}): PortfolioEvaluationResult {
  const nowMs = safeFiniteNumber(params.nowMs, Date.now());
  const config = normalizeRebalanceConfig(params.config);
  const rawHoldings =
    Array.isArray(params.holdings) && params.holdings.length > 0
      ? params.holdings
      : DEFAULT_PORTFOLIO_SEEDS;
  const tickers = params.tickers && typeof params.tickers === 'object' ? params.tickers : {};
  const candlesMap =
    params.candlesMap && typeof params.candlesMap === 'object' ? params.candlesMap : {};
  const positions = Array.isArray(params.positions) ? params.positions : [];

  const stablecoinReserveUsd = Math.max(
    0,
    safeFiniteNumber(params.stablecoinReserveUsd, DEFAULT_STABLECOIN_RESERVE_USD)
  );

  // Sum active futures directional exposure separately so gross exposure accurately captures leverage
  let futuresLongExposureUsd = 0;
  let futuresShortExposureUsd = 0;
  for (const pos of positions) {
    if (!pos || pos.status !== 'OPEN') continue;
    const notional = Math.max(0, safeFiniteNumber(pos.notionalUsd, 0));
    if (pos.marketType === 'USD_M_FUTURES' || (pos.leverage ?? 1) > 1) {
      if (pos.direction === 'SELL') futuresShortExposureUsd += notional;
      else futuresLongExposureUsd += notional;
    }
  }

  // First pass: resolve mark prices, notional USD, and per-asset realized volatility
  const assetBasics = rawHoldings.map((seed) => {
    const symbol = String(seed?.symbol || 'BTCUSDT').toUpperCase();
    const tickerPrice = safeFiniteNumber(tickers[symbol]?.price, 0);
    const assetCandles = candlesMap[symbol];
    const lastCandlePrice =
      Array.isArray(assetCandles) && assetCandles.length > 0
        ? safeFiniteNumber(assetCandles[assetCandles.length - 1]?.close, 0)
        : 0;
    const markPrice =
      tickerPrice > 0
        ? tickerPrice
        : lastCandlePrice > 0
        ? lastCandlePrice
        : REFERENCE_PRICES[symbol] ?? 100;

    const units = Math.max(0, safeFiniteNumber(seed?.units, 0));
    const notionalUsd = Number((units * markPrice).toFixed(2));
    const vol = computeAssetVolatilityProfile(assetCandles, seed?.fallbackDailyVolPct ?? 3.2);

    return {
      symbol,
      baseAsset: seed?.baseAsset || symbol.replace(/USDT$/i, ''),
      name: seed?.name || symbol.replace(/USDT$/i, ''),
      units,
      markPrice,
      notionalUsd,
      manualTargetWeightPct: clampNumber(
        safeFiniteNumber(seed?.manualTargetWeightPct, 10),
        0,
        config.maxSingleAssetPct
      ),
      color: seed?.color || PORTFOLIO_COLORS[symbol] || '#3b82f6',
      atrPercent: vol.atrPercent,
      annualizedVolatilityPct: vol.annualizedVolatilityPct,
      volRegime: vol.volRegime,
    };
  });

  const deployedSpotUsd = assetBasics.reduce((acc, a) => acc + a.notionalUsd, 0);
  const totalEquityUsd = Number(Math.max(1, deployedSpotUsd + stablecoinReserveUsd).toFixed(2));

  // Target deployed weight respects minStablecoinReservePct and maxGrossExposurePct
  const targetDeploymentPct = clampNumber(
    Math.min(config.maxGrossExposurePct, 100 - config.minStablecoinReservePct),
    20,
    100
  );

  // Normalize manual weights to sum to targetDeploymentPct
  const manualSum =
    assetBasics.reduce((acc, a) => acc + a.manualTargetWeightPct, 0) || 1;
  const volWeights = computeVolatilityParityWeights(
    assetBasics.map((a) => ({
      symbol: a.symbol,
      annualizedVolatilityPct: a.annualizedVolatilityPct,
    })),
    targetDeploymentPct,
    config.maxSingleAssetPct
  );

  const tolerance = Math.max(1.0, config.driftThresholdPct * 0.65);

  const assets: EvaluatedPortfolioAsset[] = assetBasics.map((a) => {
    const currentWeightPct = Number(((a.notionalUsd / totalEquityUsd) * 100).toFixed(2));
    const normalizedManualPct = Number(
      clampNumber((a.manualTargetWeightPct / manualSum) * targetDeploymentPct, 0, config.maxSingleAssetPct).toFixed(2)
    );
    const volWeightPct = volWeights[a.symbol] ?? normalizedManualPct;
    const targetWeightPct = config.volatilityWeightingEnabled
      ? volWeightPct
      : normalizedManualPct;

    const driftPct = Number((currentWeightPct - targetWeightPct).toFixed(2));
    const exposureStatus: ExposureRegime =
      driftPct > tolerance
        ? 'OVER_EXPOSED'
        : driftPct < -tolerance
        ? 'UNDER_EXPOSED'
        : 'BALANCED';

    const targetUsd = Number(((targetWeightPct / 100) * totalEquityUsd).toFixed(2));
    const rebalanceDeltaUsd = Number((targetUsd - a.notionalUsd).toFixed(2));
    const suggestedAction: RebalanceActionType =
      Math.abs(driftPct) < 0.75 || Math.abs(rebalanceDeltaUsd) < 25
        ? 'HOLD'
        : rebalanceDeltaUsd > 0
        ? 'BUY'
        : 'SELL';

    return {
      symbol: a.symbol,
      baseAsset: a.baseAsset,
      name: a.name,
      units: Number(a.units.toFixed(6)),
      markPrice: Number(a.markPrice.toPrecision(6)),
      notionalUsd: a.notionalUsd,
      currentWeightPct,
      targetWeightPct,
      manualTargetWeightPct: normalizedManualPct,
      volatilityTargetWeightPct: volWeightPct,
      driftPct,
      exposureStatus,
      atrPercent: a.atrPercent,
      annualizedVolatilityPct: a.annualizedVolatilityPct,
      volRegime: a.volRegime,
      targetUsd,
      rebalanceDeltaUsd,
      suggestedAction,
      color: a.color,
    };
  });

  // Portfolio Gross & Net Exposure calculation (Spot Holdings + Open Leveraged Futures Notional)
  const grossDeployedUsd = deployedSpotUsd + futuresLongExposureUsd + futuresShortExposureUsd;
  const netDeployedUsd = deployedSpotUsd + futuresLongExposureUsd - futuresShortExposureUsd;
  const grossExposurePct = Number(((grossDeployedUsd / totalEquityUsd) * 100).toFixed(1));
  const netExposurePct = Number(((netDeployedUsd / totalEquityUsd) * 100).toFixed(1));
  const stablecoinReservePct = Number(((stablecoinReserveUsd / totalEquityUsd) * 100).toFixed(1));
  const exposureDeltaPct = Number((grossExposurePct - targetDeploymentPct).toFixed(1));

  // Exposure Regime band: Over-Exposed if > maxGrossExposurePct or delta > +7.5% above target
  // Under-Exposed if < targetDeploymentPct - 7.5% (or high idle cash above reserve floor)
  let exposureRegime: ExposureRegime = 'BALANCED';
  if (grossExposurePct > config.maxGrossExposurePct || exposureDeltaPct > 7.5) {
    exposureRegime = 'OVER_EXPOSED';
  } else if (exposureDeltaPct < -7.5) {
    exposureRegime = 'UNDER_EXPOSED';
  }

  const regimeLabel =
    exposureRegime === 'OVER_EXPOSED'
      ? `Over-Exposed (+${Math.abs(exposureDeltaPct).toFixed(1)}% vs Target)`
      : exposureRegime === 'UNDER_EXPOSED'
      ? `Under-Exposed (-${Math.abs(exposureDeltaPct).toFixed(1)}% vs Target)`
      : 'Balanced Target Exposure';

  const underExposedAssets = assets
    .filter((a) => a.exposureStatus === 'UNDER_EXPOSED')
    .map((a) => a.baseAsset);
  const overExposedAssets = assets
    .filter((a) => a.exposureStatus === 'OVER_EXPOSED')
    .map((a) => a.baseAsset);
  const maxAbsDriftPct = Number(
    Math.max(0, ...assets.map((a) => Math.abs(a.driftPct))).toFixed(2)
  );

  // Portfolio Volatility Risk metrics (accounting for correlation diversification benefit ~0.72 avg corr)
  const weightedVolSum = assets.reduce(
    (acc, a) => acc + (a.currentWeightPct / 100) * a.annualizedVolatilityPct,
    0
  );
  const leverageMultiplier = Math.max(1, grossExposurePct / 100);
  const avgPairwiseCorr = 0.68;
  const sumSqWeightVol = assets.reduce(
    (acc, a) => acc + Math.pow((a.currentWeightPct / 100) * a.annualizedVolatilityPct, 2),
    0
  );
  const crossTerm = Math.max(0, Math.pow(weightedVolSum, 2) - sumSqWeightVol) * avgPairwiseCorr;
  const portfolioAnnualizedVolPct = Number(
    (Math.sqrt(sumSqWeightVol + crossTerm) * leverageMultiplier).toFixed(1)
  );
  const portfolioAtrPct = Number(
    assets
      .reduce((acc, a) => acc + (a.currentWeightPct / 100) * a.atrPercent, 0)
      .toFixed(2)
  );
  const dailyVolFraction = portfolioAnnualizedVolPct / 100 / Math.sqrt(365);
  const var95DailyPct = Number((dailyVolFraction * 1.645 * 100).toFixed(2));
  const var95DailyUsd = Number(((var95DailyPct / 100) * totalEquityUsd).toFixed(2));
  const diversificationRatio = Number(
    clampNumber(
      weightedVolSum > 0 && portfolioAnnualizedVolPct > 0
        ? (weightedVolSum * leverageMultiplier) / portfolioAnnualizedVolPct
        : 1.0,
      1.0,
      2.5
    ).toFixed(2)
  );

  // Risk Score scaled 0..100
  const riskScore = Math.round(
    clampNumber(
      portfolioAnnualizedVolPct * 0.85 + Math.max(0, grossExposurePct - 100) * 0.45,
      4,
      100
    )
  );
  const riskRegime = classifyVolatilityRegime(
    riskScore < 34 ? 30 : riskScore < 60 ? 55 : riskScore < 82 ? 88 : 120
  );

  // Auto-Rebalance Trigger evaluation (Threshold + Periodic)
  const breachedSymbols = assets
    .filter((a) => Math.abs(a.driftPct) >= config.driftThresholdPct)
    .map((a) => a.symbol);

  const lastRebalMs = params.lastRebalanceAt ? Date.parse(params.lastRebalanceAt) : 0;
  const intervalMs = config.periodicIntervalMinutes * 60_000;
  const elapsedMs = lastRebalMs > 0 ? Math.max(0, nowMs - lastRebalMs) : intervalMs;
  const periodicDue = elapsedMs >= intervalMs;
  const nextPeriodicDueAt = new Date(
    (lastRebalMs > 0 ? lastRebalMs : nowMs) + intervalMs
  ).toISOString();
  const minutesUntilPeriodicDue = Math.max(
    0,
    Math.ceil((intervalMs - elapsedMs) / 60_000)
  );

  let shouldExecute = false;
  let triggerReason: RebalanceTriggerStatus['reason'] = 'NONE';
  let summaryText = `Portfolio within ±${config.driftThresholdPct}% threshold and periodic cadence.`;

  if (config.autoRebalanceEnabled) {
    if (grossExposurePct > config.maxGrossExposurePct + 2) {
      shouldExecute = true;
      triggerReason = 'EXPOSURE_CAP_EXCEEDED';
      summaryText = `Gross exposure ${grossExposurePct}% exceeded ${config.maxGrossExposurePct}% cap — auto-deleveraging trigger armed.`;
    } else if (
      (config.triggerMode === 'HYBRID' || config.triggerMode === 'THRESHOLD_ONLY') &&
      breachedSymbols.length > 0
    ) {
      shouldExecute = true;
      triggerReason = 'THRESHOLD_BREACHED';
      summaryText = `Threshold breached (±${config.driftThresholdPct}%): ${breachedSymbols
        .map((s) => s.replace('USDT', ''))
        .join(', ')} ready for volatility rebalance.`;
    } else if (
      (config.triggerMode === 'HYBRID' || config.triggerMode === 'PERIODIC_ONLY') &&
      periodicDue &&
      maxAbsDriftPct >= 0.8
    ) {
      shouldExecute = true;
      triggerReason = 'PERIODIC_DUE';
      summaryText = `${config.periodicIntervalMinutes}m periodic volatility alignment due (${maxAbsDriftPct.toFixed(1)}% max drift).`;
    }
  } else {
    summaryText = 'Auto-rebalancing paused by user controls — monitoring drift & risk gauges.';
  }

  return {
    assets,
    exposureMeter: {
      totalEquityUsd,
      deployedExposureUsd: Number(grossDeployedUsd.toFixed(2)),
      stablecoinReserveUsd: Number(stablecoinReserveUsd.toFixed(2)),
      stablecoinReservePct,
      futuresLongExposureUsd: Number(futuresLongExposureUsd.toFixed(2)),
      futuresShortExposureUsd: Number(futuresShortExposureUsd.toFixed(2)),
      grossExposurePct,
      netExposurePct,
      targetDeploymentPct,
      exposureDeltaPct,
      regime: exposureRegime,
      regimeLabel,
      underExposedAssets,
      overExposedAssets,
      maxAbsDriftPct,
    },
    volatilityRisk: {
      portfolioAnnualizedVolPct,
      portfolioAtrPct,
      var95DailyPct,
      var95DailyUsd,
      diversificationRatio,
      riskScore,
      riskRegime,
    },
    rebalanceTrigger: {
      shouldExecute,
      reason: triggerReason,
      summaryText,
      breachedSymbols,
      nextPeriodicDueAt,
      minutesUntilPeriodicDue,
    },
    config,
    evaluatedAt: new Date(nowMs).toISOString(),
  };
}

/**
 * Executes a deterministic portfolio rebalance against target weights, adjusting
 * holdings units & stablecoin reserves and generating a complete audit record.
 */
export function executePortfolioRebalance(params: {
  holdings: PortfolioHoldingSeed[];
  evaluation: PortfolioEvaluationResult;
  stablecoinReserveUsd: number;
  reason?: RebalanceExecutionRecord['triggerReason'];
  nowIso?: string;
}): {
  updatedHoldings: PortfolioHoldingSeed[];
  updatedReserveUsd: number;
  record: RebalanceExecutionRecord;
} {
  const { holdings, evaluation } = params;
  const totalEquityUsd = Math.max(1, evaluation.exposureMeter.totalEquityUsd);
  const preMaxDriftPct = evaluation.exposureMeter.maxAbsDriftPct;
  const trades: RebalanceTradeItem[] = [];
  let netUsdSoldMinusBought = 0;

  const updatedHoldings = holdings.map((seed) => {
    const ev = evaluation.assets.find((a) => a.symbol === seed.symbol);
    if (!ev || ev.markPrice <= 0) return seed;

    const targetUsd = (ev.targetWeightPct / 100) * totalEquityUsd;
    const deltaUsd = targetUsd - ev.notionalUsd;
    const unitsDelta = deltaUsd / ev.markPrice;
    const newUnits = Math.max(0, Number((targetUsd / ev.markPrice).toFixed(6)));

    if (Math.abs(deltaUsd) >= 15) {
      trades.push({
        symbol: ev.symbol,
        action: deltaUsd > 0 ? 'BUY' : 'SELL',
        notionalUsd: Number(Math.abs(deltaUsd).toFixed(2)),
        unitsDelta: Number(Math.abs(unitsDelta).toFixed(6)),
        executionPrice: ev.markPrice,
        preWeightPct: ev.currentWeightPct,
        postWeightPct: ev.targetWeightPct,
      });
    }

    netUsdSoldMinusBought -= deltaUsd;
    return {
      ...seed,
      units: newUnits,
    };
  });

  const targetReserveUsd = Number(
    Math.max(
      0,
      params.stablecoinReserveUsd + netUsdSoldMinusBought
    ).toFixed(2)
  );
  const movedNotionalUsd = Number(
    trades.reduce((acc, t) => acc + t.notionalUsd, 0).toFixed(2)
  );

  // Recompute post-drift quickly across targets
  const postMaxDriftPct = Number(
    Math.max(
      0,
      ...updatedHoldings.map((h) => {
        const ev = evaluation.assets.find((a) => a.symbol === h.symbol);
        if (!ev) return 0;
        const postWeight = ((h.units * ev.markPrice) / totalEquityUsd) * 100;
        return Math.abs(postWeight - ev.targetWeightPct);
      })
    ).toFixed(2)
  );

  const record: RebalanceExecutionRecord = {
    id: `reb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    triggerReason: params.reason ?? 'MANUAL',
    tradesExecuted: trades.length,
    movedNotionalUsd,
    preMaxDriftPct,
    postMaxDriftPct,
    volRiskScoreAtExecution: evaluation.volatilityRisk.riskScore,
    trades,
    executedAt: params.nowIso ?? new Date().toISOString(),
  };

  return {
    updatedHoldings,
    updatedReserveUsd: targetReserveUsd,
    record,
  };
}

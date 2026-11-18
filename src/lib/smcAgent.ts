import { type Candle, formatCryptoPrice } from './marketData';
import {
  checkRRSignalEmission,
  deriveStructuralLevelsFromClosedWindow,
  roundTargetPreservingFloor,
  type RRStageCheckOutcome,
  type StructuralStopOrigin,
  type StructuralTargetOrigin,
} from './riskEngine';

export const SMC_AGENT_CONFIG = {
  monthlyTradeTarget: 300,
  riskRewardRatio: 5, // 1:5 Risk-to-Reward profile
  executionTimeframe: '15m' as const,
  simulationDays: 30,
  riskPerTradePercent: 0.35, // 0.35% account risk per trade (-0.35% at SL, +1.75% at 1:5 TP)
};

export const TRADING_SESSIONS = {
  londonStartUtcHour: 7,
  londonEndUtcHour: 16,
  newYorkStartUtcHour: 12,
  newYorkEndUtcHour: 21,
} as const;

export type TradingSessionName =
  | 'London Session'
  | 'London / NY Overlap'
  | 'New York Session'
  | 'Asian / Off-Session';

export interface TradingSessionStatus {
  session: TradingSessionName;
  isOptimalWindow: boolean;
  utcHour: number;
  utcTimeLabel: string;
  volatilityState: 'Optimal Liquidity' | 'Peak Overlap Liquidity' | 'Low Off-Session Liquidity';
  summary: string;
}

export function evaluateTradingSession(unixSeconds?: number): TradingSessionStatus {
  const tsMs =
    typeof unixSeconds === 'number' && Number.isFinite(unixSeconds) && unixSeconds > 0
      ? unixSeconds * 1000
      : Date.now();
  const d = new Date(tsMs);
  const utcHour = d.getUTCHours();
  const utcMin = String(d.getUTCMinutes()).padStart(2, '0');
  const utcTimeLabel = `${String(utcHour).padStart(2, '0')}:${utcMin} UTC`;

  if (utcHour >= 12 && utcHour < 16) {
    return {
      session: 'London / NY Overlap',
      isOptimalWindow: true,
      utcHour,
      utcTimeLabel,
      volatilityState: 'Peak Overlap Liquidity',
      summary: `London / New York Overlap (${utcTimeLabel}) — peak institutional liquidity & optimal execution window.`,
    };
  }

  if (utcHour >= TRADING_SESSIONS.londonStartUtcHour && utcHour < 12) {
    return {
      session: 'London Session',
      isOptimalWindow: true,
      utcHour,
      utcTimeLabel,
      volatilityState: 'Optimal Liquidity',
      summary: `London Session (${utcTimeLabel}) — active 07:00–16:00 UTC killzone with optimal volatility.`,
    };
  }

  if (utcHour >= 16 && utcHour < TRADING_SESSIONS.newYorkEndUtcHour) {
    return {
      session: 'New York Session',
      isOptimalWindow: true,
      utcHour,
      utcTimeLabel,
      volatilityState: 'Optimal Liquidity',
      summary: `New York Session (${utcTimeLabel}) — active 12:00–21:00 UTC killzone with optimal liquidity.`,
    };
  }

  return {
    session: 'Asian / Off-Session',
    isOptimalWindow: false,
    utcHour,
    utcTimeLabel,
    volatilityState: 'Low Off-Session Liquidity',
    summary: `Outside London/NY killzones (${utcTimeLabel}) — entries gated until London (07:00 UTC) or NY (12:00 UTC) open.`,
  };
}

export interface SwingPoint {
  index: number;
  time: number;
  price: number;
  kind: 'HIGH' | 'LOW';
}

export interface MarketStructureAnalysis {
  bias: 'Bullish' | 'Bearish' | 'Neutral';
  lastEvent: 'BOS' | 'CHoCH' | 'Consolidation';
  eventDirection: 'Bullish' | 'Bearish' | 'Neutral';
  brokenLevel: number;
  lastSwingHigh: number;
  lastSwingLow: number;
  summary: string;
}

export interface LiquiditySweepAnalysis {
  detected: boolean;
  type: 'SSL Sweep' | 'BSL Sweep' | 'None';
  sweptPrice: number;
  candlesAgo: number;
  summary: string;
}

export type OrderBlockVolumeAlignment = 'HVN_CONFIRMED' | 'NEUTRAL' | 'LVN_VOID';

export interface OrderBlockZone {
  type: 'Bullish OB' | 'Bearish OB';
  zoneRole: 'Accumulation Zone' | 'Supply Zone';
  high: number;
  low: number;
  mid: number;
  time: number;
  mitigated: boolean;
  retesting: boolean;
  distancePercent: number;
  volumeProfileAlignment?: OrderBlockVolumeAlignment;
  inLowVolumeVoid?: boolean;
  hvnOverlapRatio?: number;
}

export interface VolumeProfileNode {
  low: number;
  high: number;
  center: number;
  ratio: number;
}

export interface VolumeProfileBin {
  priceLow: number;
  priceHigh: number;
  midPrice: number;
  volume: number;
  ratio: number; // 0..1 relative to POC bin
  isPoc: boolean;
  inValueArea: boolean;
  nodeType: 'HVN' | 'NORMAL' | 'LVN';
}

export interface FixedRangeVolumeProfile {
  rangeHigh: number;
  rangeLow: number;
  poc: number;
  vah: number;
  val: number;
  totalVolume: number;
  priceZone: 'Discount' | 'Equilibrium' | 'Premium';
  bins: VolumeProfileBin[];
  highVolumeNodes: VolumeProfileNode[];
  lowVolumeNodes: VolumeProfileNode[];
}

export type SmcExecutionStatus =
  | 'EXECUTE'
  | 'WAIT_SESSION'
  | 'WAIT_SWEEP'
  | 'WAIT_ZONE_RETEST';

export interface SmcAgentAnalysis {
  symbol: string;
  coinName: string;
  direction: 'BUY' | 'SELL';
  confidence: number; // 55 - 97
  score: number; // -100 to +100
  retestStatus:
    | 'Order Block Retest'
    | 'POC Confluence Retest'
    | 'Post-Sweep Structural Entry'
    | 'Range Continuation';
  zoneLabel: 'Accumulation Zone' | 'Supply Zone';
  sweepConfirmed: boolean;
  institutionalLiquidityConfirmed: boolean;
  hvnConfirmedCount: number;
  lvnAvoidedCount: number;
  targetLiquidityPool: number; // Previous High for longs, Previous Low for shorts
  sessionStatus: TradingSessionStatus;
  executionStatus: SmcExecutionStatus;
  executionAllowed: boolean;
  entryPrice: number;
  stopLoss: number;
  takeProfits: [number, number, number];
  riskRewardRatio: number;
  targetRiskReward: number;
  monthlyTradeTarget: number;
  structure: MarketStructureAnalysis;
  liquiditySweep: LiquiditySweepAnalysis;
  activeOrderBlock: OrderBlockZone | null;
  allOrderBlocks: OrderBlockZone[];
  volumeProfile: FixedRangeVolumeProfile;
  structuralStopLoss?: number | null;
  structuralTargetLevel?: number | null;
  structuralStopOrigin?: StructuralStopOrigin;
  structuralTargetOrigin?: StructuralTargetOrigin;
  structuralPlannedRR?: number;
  rrGateEvaluation?: RRStageCheckOutcome;
  rrGateEligible?: boolean;
  rationale: string;
}

function roundPrice(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(value.toPrecision(6));
}

export function detectSwingPoints(candles: Candle[], lookback = 3): {
  highs: SwingPoint[];
  lows: SwingPoint[];
} {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];
  if (candles.length < lookback * 2 + 1) return { highs, lows };

  for (let i = lookback; i < candles.length - lookback; i++) {
    const curr = candles[i];
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= curr.high) isSwingHigh = false;
      if (candles[j].low <= curr.low) isSwingLow = false;
      if (!isSwingHigh && !isSwingLow) break;
    }

    if (isSwingHigh) {
      highs.push({ index: i, time: curr.time, price: curr.high, kind: 'HIGH' });
    }
    if (isSwingLow) {
      lows.push({ index: i, time: curr.time, price: curr.low, kind: 'LOW' });
    }
  }

  return { highs, lows };
}

export function computeFixedRangeVolumeProfile(
  candles: Candle[],
  binCount = 18,
  rangeLookback = 96
): FixedRangeVolumeProfile {
  const slice = candles.slice(-Math.min(candles.length, rangeLookback));
  if (slice.length === 0) {
    return {
      rangeHigh: 0,
      rangeLow: 0,
      poc: 0,
      vah: 0,
      val: 0,
      totalVolume: 0,
      priceZone: 'Equilibrium',
      bins: [],
      highVolumeNodes: [],
      lowVolumeNodes: [],
    };
  }

  let rangeHigh = -Infinity;
  let rangeLow = Infinity;
  for (const c of slice) {
    if (c.high > rangeHigh) rangeHigh = c.high;
    if (c.low < rangeLow) rangeLow = c.low;
  }

  if (rangeHigh <= rangeLow) {
    const fallbackMid = slice[slice.length - 1].close;
    rangeHigh = fallbackMid * 1.01;
    rangeLow = fallbackMid * 0.99;
  }

  const step = (rangeHigh - rangeLow) / binCount;
  const rawVolumes = new Array<number>(binCount).fill(0);
  let totalVolume = 0;

  for (const c of slice) {
    const vol = Math.max(0, c.volume);
    totalVolume += vol;
    const cSpan = Math.max(c.high - c.low, step * 0.25);

    // Distribute candle volume proportionally across overlapping bins with typical-price weighting
    const startBin = Math.max(0, Math.min(binCount - 1, Math.floor((c.low - rangeLow) / step)));
    const endBin = Math.max(0, Math.min(binCount - 1, Math.floor((c.high - rangeLow) / step)));
    const typical = (c.high + c.low + c.close) / 3;

    let weightSum = 0;
    const binWeights: Array<{ idx: number; w: number }> = [];
    for (let b = startBin; b <= endBin; b++) {
      const bLow = rangeLow + b * step;
      const bHigh = bLow + step;
      const overlap = Math.max(step * 0.1, Math.min(c.high, bHigh) - Math.max(c.low, bLow));
      const bMid = (bLow + bHigh) / 2;
      const proximity = 1 / (1 + Math.abs(bMid - typical) / cSpan);
      const w = overlap * (0.65 + proximity * 0.7);
      weightSum += w;
      binWeights.push({ idx: b, w });
    }

    if (weightSum > 0) {
      for (const bw of binWeights) {
        rawVolumes[bw.idx] += vol * (bw.w / weightSum);
      }
    }
  }

  let pocIndex = 0;
  let maxBinVol = 0;
  for (let i = 0; i < binCount; i++) {
    if (rawVolumes[i] > maxBinVol) {
      maxBinVol = rawVolumes[i];
      pocIndex = i;
    }
  }

  // Value Area expansion (70% of total volume centered on POC)
  const targetVaVol = totalVolume * 0.7;
  let accumulatedVa = rawVolumes[pocIndex];
  let lowIdx = pocIndex;
  let highIdx = pocIndex;

  while (accumulatedVa < targetVaVol && (lowIdx > 0 || highIdx < binCount - 1)) {
    const downVol = lowIdx > 0 ? rawVolumes[lowIdx - 1] : -1;
    const upVol = highIdx < binCount - 1 ? rawVolumes[highIdx + 1] : -1;
    if (upVol >= downVol && highIdx < binCount - 1) {
      highIdx++;
      accumulatedVa += rawVolumes[highIdx];
    } else if (lowIdx > 0) {
      lowIdx--;
      accumulatedVa += rawVolumes[lowIdx];
    } else {
      break;
    }
  }

  const poc = roundPrice(rangeLow + (pocIndex + 0.5) * step);
  const val = roundPrice(rangeLow + lowIdx * step);
  const vah = roundPrice(rangeLow + (highIdx + 1) * step);

  const lastClose = slice[slice.length - 1].close;
  const priceZone: FixedRangeVolumeProfile['priceZone'] =
    lastClose < val ? 'Discount' : lastClose > vah ? 'Premium' : 'Equilibrium';

  const bins: VolumeProfileBin[] = [];
  const highVolumeNodes: VolumeProfileNode[] = [];
  const lowVolumeNodes: VolumeProfileNode[] = [];

  for (let i = binCount - 1; i >= 0; i--) {
    const priceLow = roundPrice(rangeLow + i * step);
    const priceHigh = roundPrice(rangeLow + (i + 1) * step);
    const ratio = maxBinVol > 0 ? Number((rawVolumes[i] / maxBinVol).toFixed(3)) : 0;
    const nodeType: VolumeProfileBin['nodeType'] =
      ratio >= 0.62 || i === pocIndex ? 'HVN' : ratio <= 0.24 ? 'LVN' : 'NORMAL';

    const midPrice = roundPrice((priceLow + priceHigh) / 2);
    if (nodeType === 'HVN') {
      highVolumeNodes.push({ low: priceLow, high: priceHigh, center: midPrice, ratio });
    } else if (nodeType === 'LVN') {
      lowVolumeNodes.push({ low: priceLow, high: priceHigh, center: midPrice, ratio });
    }

    bins.push({
      priceLow,
      priceHigh,
      midPrice,
      volume: Number(rawVolumes[i].toFixed(2)),
      ratio,
      isPoc: i === pocIndex,
      inValueArea: i >= lowIdx && i <= highIdx,
      nodeType,
    });
  }

  return {
    rangeHigh: roundPrice(rangeHigh),
    rangeLow: roundPrice(rangeLow),
    poc,
    vah,
    val,
    totalVolume: Number(totalVolume.toFixed(2)),
    priceZone,
    bins,
    highVolumeNodes,
    lowVolumeNodes,
  };
}

/**
 * Classifies Supply/Accumulation Zones against FRVP High-Volume Nodes (HVN)
 * vs thin Low-Volume Nodes (LVN) so execution avoids sweep-prone liquidity voids.
 */
export function classifyOrderBlocksAgainstFrvp(
  zones: OrderBlockZone[],
  vp: FixedRangeVolumeProfile
): OrderBlockZone[] {
  if (vp.bins.length === 0) return zones;

  return zones.map((zone) => {
    const touchingBins = vp.bins.filter(
      (b) =>
        b.priceHigh >= zone.low * 0.996 &&
        b.priceLow <= zone.high * 1.004
    );
    const targetBins =
      touchingBins.length > 0
        ? touchingBins
        : vp.bins.reduce<VolumeProfileBin[]>((closest, b) => {
            if (closest.length === 0) return [b];
            return Math.abs(b.midPrice - zone.mid) < Math.abs(closest[0].midPrice - zone.mid)
              ? [b]
              : closest;
          }, []);

    const avgRatio =
      targetBins.reduce((acc, b) => acc + b.ratio, 0) / Math.max(1, targetBins.length);
    const hasHvn = targetBins.some((b) => b.nodeType === 'HVN' || b.isPoc);
    const allLvn = targetBins.every((b) => b.nodeType === 'LVN');

    const alignment: OrderBlockVolumeAlignment = hasHvn
      ? 'HVN_CONFIRMED'
      : allLvn || avgRatio <= 0.25
      ? 'LVN_VOID'
      : 'NEUTRAL';

    return {
      ...zone,
      volumeProfileAlignment: alignment,
      inLowVolumeVoid: alignment === 'LVN_VOID',
      hvnOverlapRatio: Number(avgRatio.toFixed(3)),
    };
  });
}

export function analyzeMarketStructure(
  candles: Candle[],
  highs: SwingPoint[],
  lows: SwingPoint[]
): MarketStructureAnalysis {
  const lastClose = candles[candles.length - 1]?.close ?? 0;
  const fallbackHigh = Math.max(...candles.slice(-24).map((c) => c.high), lastClose);
  const fallbackLow = Math.min(...candles.slice(-24).map((c) => c.low), lastClose);

  const lastSwingHigh = highs[highs.length - 1]?.price ?? fallbackHigh;
  const prevSwingHigh = highs[highs.length - 2]?.price ?? lastSwingHigh;
  const lastSwingLow = lows[lows.length - 1]?.price ?? fallbackLow;
  const prevSwingLow = lows[lows.length - 2]?.price ?? lastSwingLow;

  // Determine structural progression (HH/HL vs LH/LL)
  const higherHighs = highs.length >= 2 && lastSwingHigh > prevSwingHigh;
  const higherLows = lows.length >= 2 && lastSwingLow > prevSwingLow;
  const lowerHighs = highs.length >= 2 && lastSwingHigh < prevSwingHigh;
  const lowerLows = lows.length >= 2 && lastSwingLow < prevSwingLow;

  // Inspect recent 16 candles for BOS / CHoCH breakouts
  const recent = candles.slice(-16);
  const priorSwingHigh = highs.filter((h) => h.index < candles.length - 4).slice(-1)[0]?.price ?? lastSwingHigh;
  const priorSwingLow = lows.filter((l) => l.index < candles.length - 4).slice(-1)[0]?.price ?? lastSwingLow;

  const brokeHigh = recent.some((c) => c.close > priorSwingHigh);
  const brokeLow = recent.some((c) => c.close < priorSwingLow);

  if (brokeHigh && !brokeLow) {
    const isChoch = lowerHighs || lowerLows;
    return {
      bias: 'Bullish',
      lastEvent: isChoch ? 'CHoCH' : 'BOS',
      eventDirection: 'Bullish',
      brokenLevel: roundPrice(priorSwingHigh),
      lastSwingHigh: roundPrice(lastSwingHigh),
      lastSwingLow: roundPrice(lastSwingLow),
      summary: `${isChoch ? 'Bullish CHoCH' : 'Bullish BOS'} above $${formatCryptoPrice(priorSwingHigh)}`,
    };
  }

  if (brokeLow && !brokeHigh) {
    const isChoch = higherHighs || higherLows;
    return {
      bias: 'Bearish',
      lastEvent: isChoch ? 'CHoCH' : 'BOS',
      eventDirection: 'Bearish',
      brokenLevel: roundPrice(priorSwingLow),
      lastSwingHigh: roundPrice(lastSwingHigh),
      lastSwingLow: roundPrice(lastSwingLow),
      summary: `${isChoch ? 'Bearish CHoCH' : 'Bearish BOS'} below $${formatCryptoPrice(priorSwingLow)}`,
    };
  }

  if (higherHighs && higherLows) {
    return {
      bias: 'Bullish',
      lastEvent: 'BOS',
      eventDirection: 'Bullish',
      brokenLevel: roundPrice(prevSwingHigh),
      lastSwingHigh: roundPrice(lastSwingHigh),
      lastSwingLow: roundPrice(lastSwingLow),
      summary: `Bullish HH/HL structure holding above $${formatCryptoPrice(lastSwingLow)}`,
    };
  }

  if (lowerHighs && lowerLows) {
    return {
      bias: 'Bearish',
      lastEvent: 'BOS',
      eventDirection: 'Bearish',
      brokenLevel: roundPrice(prevSwingLow),
      lastSwingHigh: roundPrice(lastSwingHigh),
      lastSwingLow: roundPrice(lastSwingLow),
      summary: `Bearish LH/LL structure capped below $${formatCryptoPrice(lastSwingHigh)}`,
    };
  }

  return {
    bias: lastClose >= (lastSwingHigh + lastSwingLow) / 2 ? 'Bullish' : 'Bearish',
    lastEvent: 'Consolidation',
    eventDirection: 'Neutral',
    brokenLevel: roundPrice((lastSwingHigh + lastSwingLow) / 2),
    lastSwingHigh: roundPrice(lastSwingHigh),
    lastSwingLow: roundPrice(lastSwingLow),
    summary: `Structural range between $${formatCryptoPrice(lastSwingLow)} – $${formatCryptoPrice(lastSwingHigh)}`,
  };
}

export function detectLiquiditySweeps(
  candles: Candle[],
  highs: SwingPoint[],
  lows: SwingPoint[]
): LiquiditySweepAnalysis {
  if (candles.length < 15) {
    return { detected: false, type: 'None', sweptPrice: 0, candlesAgo: 0, summary: 'No liquidity sweep detected' };
  }

  // Check last 12 candles against prior swing lows (SSL) and swing highs (BSL)
  const checkStart = Math.max(5, candles.length - 12);
  let bestSsl: { price: number; ago: number } | null = null;
  let bestBsl: { price: number; ago: number } | null = null;

  for (let i = checkStart; i < candles.length; i++) {
    const c = candles[i];
    const priorLows = lows.filter((l) => l.index < i - 1 && l.index >= i - 55);
    const priorHighs = highs.filter((h) => h.index < i - 1 && h.index >= i - 55);

    const sweptLows = priorLows.filter((sl) => c.low < sl.price && c.close > sl.price);
    if (sweptLows.length > 0) {
      const deepestLow = Math.min(...sweptLows.map((sl) => sl.price));
      bestSsl = { price: deepestLow, ago: candles.length - 1 - i };
    }

    const sweptHighs = priorHighs.filter((sh) => c.high > sh.price && c.close < sh.price);
    if (sweptHighs.length > 0) {
      const highestHigh = Math.max(...sweptHighs.map((sh) => sh.price));
      bestBsl = { price: highestHigh, ago: candles.length - 1 - i };
    }
  }

  if (bestSsl && (!bestBsl || bestSsl.ago <= bestBsl.ago)) {
    return {
      detected: true,
      type: 'SSL Sweep',
      sweptPrice: roundPrice(bestSsl.price),
      candlesAgo: bestSsl.ago,
      summary: `Sell-Side Liquidity swept below $${formatCryptoPrice(bestSsl.price)} (${bestSsl.ago === 0 ? 'live bar' : `${bestSsl.ago} bars ago`})`,
    };
  }

  if (bestBsl) {
    return {
      detected: true,
      type: 'BSL Sweep',
      sweptPrice: roundPrice(bestBsl.price),
      candlesAgo: bestBsl.ago,
      summary: `Buy-Side Liquidity swept above $${formatCryptoPrice(bestBsl.price)} (${bestBsl.ago === 0 ? 'live bar' : `${bestBsl.ago} bars ago`})`,
    };
  }

  return {
    detected: false,
    type: 'None',
    sweptPrice: 0,
    candlesAgo: 0,
    summary: 'Equilibrium liquidity resting at external swing levels',
  };
}

export function detectOrderBlocks(candles: Candle[]): OrderBlockZone[] {
  if (candles.length < 20) return [];
  const lastPrice = candles[candles.length - 1].close;
  const obs: OrderBlockZone[] = [];

  // Average body size for displacement validation
  const recentBodies = candles.slice(-40).map((c) => Math.abs(c.close - c.open));
  const avgBody = recentBodies.reduce((a, b) => a + b, 0) / Math.max(1, recentBodies.length);

  const start = Math.max(2, candles.length - 75);
  for (let i = start; i < candles.length - 3; i++) {
    const base = candles[i];
    const next1 = candles[i + 1];
    const next2 = candles[i + 2];

    const baseBearish = base.close < base.open;
    const baseBullish = base.close > base.open;

    // Bullish OB: last down-close candle followed by strong bullish displacement
    const bullishImpulse =
      next1.close > next1.open &&
      next2.close > base.high &&
      next2.close - base.low > avgBody * 2.1;

    if (baseBearish && bullishImpulse) {
      const high = roundPrice(Math.max(base.open, base.high));
      const low = roundPrice(base.low);
      const mid = roundPrice((high + low) / 2);

      // Check if invalidated cleanly below OB low later
      const subsequent = candles.slice(i + 3);
      const invalidated = subsequent.some((c) => c.close < low);
      if (!invalidated) {
        const retesting = lastPrice <= high * 1.008 && lastPrice >= low * 0.995;
        const distPct = Math.abs(lastPrice - mid) / Math.max(lastPrice, 1e-9) * 100;
        obs.push({
          type: 'Bullish OB',
          zoneRole: 'Accumulation Zone',
          high,
          low,
          mid,
          time: base.time,
          mitigated: subsequent.some((c) => c.low <= high),
          retesting,
          distancePercent: Number(distPct.toFixed(2)),
        });
      }
    }

    // Bearish OB: last up-close candle followed by strong bearish displacement
    const bearishImpulse =
      next1.close < next1.open &&
      next2.close < base.low &&
      base.high - next2.close > avgBody * 2.1;

    if (baseBullish && bearishImpulse) {
      const high = roundPrice(base.high);
      const low = roundPrice(Math.min(base.open, base.low));
      const mid = roundPrice((high + low) / 2);

      const subsequent = candles.slice(i + 3);
      const invalidated = subsequent.some((c) => c.close > high);
      if (!invalidated) {
        const retesting = lastPrice >= low * 0.992 && lastPrice <= high * 1.005;
        const distPct = Math.abs(lastPrice - mid) / Math.max(lastPrice, 1e-9) * 100;
        obs.push({
          type: 'Bearish OB',
          zoneRole: 'Supply Zone',
          high,
          low,
          mid,
          time: base.time,
          mitigated: subsequent.some((c) => c.high >= low),
          retesting,
          distancePercent: Number(distPct.toFixed(2)),
        });
      }
    }
  }

  return obs.sort((a, b) => a.distancePercent - b.distancePercent).slice(0, 6);
}

export function runSmcVolumeProfileAgent(
  symbol: string,
  coinName: string,
  candles: Candle[],
  targetRiskReward = SMC_AGENT_CONFIG.riskRewardRatio,
  evaluationTimeSec?: number,
  liveWsPrice?: number
): SmcAgentAnalysis {
  const { highs, lows } = detectSwingPoints(candles, 3);
  const structure = analyzeMarketStructure(candles, highs, lows);
  const liquiditySweep = detectLiquiditySweeps(candles, highs, lows);
  const rawOrderBlocks = detectOrderBlocks(candles);
  const volumeProfile = computeFixedRangeVolumeProfile(candles, 18, 96);
  const allOrderBlocks = classifyOrderBlocksAgainstFrvp(rawOrderBlocks, volumeProfile);

  const lastCandle = candles[candles.length - 1];
  const lastClose =
    liveWsPrice !== undefined && Number.isFinite(liveWsPrice) && liveWsPrice > 0
      ? liveWsPrice
      : (lastCandle?.close ?? 100);
  const sessionStatus = evaluateTradingSession(evaluationTimeSec ?? lastCandle?.time);
  const nearZeroRange = Math.max(
    (volumeProfile.rangeHigh - volumeProfile.rangeLow) * 0.08,
    lastClose * 0.0065
  );

  let score = 0;
  if (structure.bias === 'Bullish') score += 30;
  else if (structure.bias === 'Bearish') score -= 30;

  if (structure.lastEvent === 'BOS') {
    score += structure.eventDirection === 'Bullish' ? 14 : -14;
  } else if (structure.lastEvent === 'CHoCH') {
    score += structure.eventDirection === 'Bullish' ? 18 : -18;
  }

  // Confirmed sweep carries primary institutional weight:
  // Longs wait for sweeps below lows (SSL Sweep); Shorts confirm sweeps above highs (BSL Sweep)
  if (liquiditySweep.type === 'SSL Sweep') score += 30;
  else if (liquiditySweep.type === 'BSL Sweep') score -= 30;

  if (volumeProfile.priceZone === 'Discount') score += 14;
  else if (volumeProfile.priceZone === 'Premium') score -= 14;
  else if (lastClose >= volumeProfile.poc) score += 6;
  else score -= 6;

  const preferredObType = score >= 0 ? 'Bullish OB' : 'Bearish OB';
  // Prioritize HVN-confirmed institutional zones and strictly avoid thin LVN sweep voids
  const directionalObs = allOrderBlocks
    .filter((ob) => ob.type === preferredObType)
    .sort((a, b) => {
      const rank = (z: OrderBlockZone) =>
        z.volumeProfileAlignment === 'HVN_CONFIRMED'
          ? 0
          : z.volumeProfileAlignment === 'LVN_VOID'
          ? 2
          : 1;
      const diff = rank(a) - rank(b);
      return diff !== 0 ? diff : a.distancePercent - b.distancePercent;
    });

  const safeDirectionalObs = directionalObs.filter(
    (ob) => ob.volumeProfileAlignment !== 'LVN_VOID'
  );
  const activeOrderBlock = safeDirectionalObs[0] ?? directionalObs[0] ?? allOrderBlocks[0] ?? null;

  const hvnConfirmedCount = directionalObs.filter(
    (ob) => ob.volumeProfileAlignment === 'HVN_CONFIRMED'
  ).length;
  const lvnAvoidedCount = allOrderBlocks.filter(
    (ob) => ob.volumeProfileAlignment === 'LVN_VOID'
  ).length;

  const nearestSpotHvn = volumeProfile.highVolumeNodes.reduce<VolumeProfileNode | null>(
    (best, n) => {
      if (!best) return n;
      return Math.abs(n.center - lastClose) < Math.abs(best.center - lastClose) ? n : best;
    },
    null
  );
  const spotInLvn = volumeProfile.lowVolumeNodes.some(
    (n) => lastClose >= n.low && lastClose <= n.high
  );
  const institutionalLiquidityConfirmed = Boolean(
    activeOrderBlock?.volumeProfileAlignment === 'HVN_CONFIRMED' ||
      (nearestSpotHvn && Math.abs(lastClose - nearestSpotHvn.center) / Math.max(lastClose, 1e-9) <= 0.018)
  );

  if (activeOrderBlock) {
    if (activeOrderBlock.volumeProfileAlignment === 'HVN_CONFIRMED') {
      score += activeOrderBlock.type === 'Bullish OB' ? 18 : -18;
    } else if (activeOrderBlock.retesting) {
      score += activeOrderBlock.type === 'Bullish OB' ? 14 : -14;
    } else if (activeOrderBlock.distancePercent <= 2.5 && !activeOrderBlock.inLowVolumeVoid) {
      score += activeOrderBlock.type === 'Bullish OB' ? 8 : -8;
    }
  }

  const clampedScore = Math.max(-100, Math.min(100, Math.round(score)));
  const direction: 'BUY' | 'SELL' = clampedScore >= 0 ? 'BUY' : 'SELL';
  const zoneLabel: SmcAgentAnalysis['zoneLabel'] =
    direction === 'BUY' ? 'Accumulation Zone' : 'Supply Zone';

  // Sweep confirmation check: BUY requires SSL sweep below lows; SELL requires BSL sweep above highs
  const sweepConfirmed =
    (direction === 'BUY' && liquiditySweep.type === 'SSL Sweep') ||
    (direction === 'SELL' && liquiditySweep.type === 'BSL Sweep');

  // Target previous swing high (longs) or previous swing low (shorts)
  const targetLiquidityPool =
    direction === 'BUY'
      ? roundPrice(
          structure.lastSwingHigh > lastClose
            ? structure.lastSwingHigh
            : Math.max(volumeProfile.rangeHigh, lastClose * 1.008)
        )
      : roundPrice(
          Math.max(
            lastClose * 0.05,
            structure.lastSwingLow < lastClose
              ? structure.lastSwingLow
              : Math.min(volumeProfile.rangeLow, lastClose * 0.992)
          )
        );

  // Retest Status Classification
  const nearPoc = Math.abs(lastClose - volumeProfile.poc) / Math.max(lastClose, 1e-9) <= 0.012;
  const retestStatus: SmcAgentAnalysis['retestStatus'] = activeOrderBlock?.retesting
    ? 'Order Block Retest'
    : nearPoc
    ? 'POC Confluence Retest'
    : liquiditySweep.detected
    ? 'Post-Sweep Structural Entry'
    : 'Range Continuation';

  // Entry anchored at live WebSocket price when streaming, otherwise HVN-confirmed Accumulation/Supply Zone or candle close
  let entryPrice = lastClose;
  if (!(liveWsPrice !== undefined && Number.isFinite(liveWsPrice) && liveWsPrice > 0)) {
    if (direction === 'BUY') {
      const accumZone = safeDirectionalObs[0];
      if (accumZone && accumZone.distancePercent <= 2.4) {
        entryPrice = accumZone.retesting ? lastClose : accumZone.high;
      } else if (spotInLvn && nearestSpotHvn) {
        entryPrice = nearestSpotHvn.center;
      } else if (nearPoc) {
        entryPrice = volumeProfile.poc;
      }
    } else {
      const supplyZone = safeDirectionalObs[0];
      if (supplyZone && supplyZone.distancePercent <= 2.4) {
        entryPrice = supplyZone.retesting ? lastClose : supplyZone.low;
      } else if (spotInLvn && nearestSpotHvn) {
        entryPrice = nearestSpotHvn.center;
      } else if (nearPoc) {
        entryPrice = volumeProfile.poc;
      }
    }
  }
  entryPrice = roundPrice(entryPrice);

  // Stop Loss placed strictly below Accumulation Zone (Longs) or strictly above Supply Zone (Shorts)
  let stopLoss: number;
  if (direction === 'BUY') {
    const accumZone = safeDirectionalObs[0] ?? directionalObs[0];
    const zoneInvalidation =
      accumZone && accumZone.low < entryPrice
        ? accumZone.low * 0.998
        : entryPrice - nearZeroRange * 0.8;
    const sweepLow =
      liquiditySweep.type === 'SSL Sweep' && liquiditySweep.sweptPrice < entryPrice
        ? liquiditySweep.sweptPrice * 0.997
        : zoneInvalidation;
    const rawSl = Math.min(zoneInvalidation, sweepLow);
    stopLoss = roundPrice(Math.min(entryPrice * 0.9955, Math.max(entryPrice * 0.955, rawSl)));
  } else {
    const supplyZone = safeDirectionalObs[0] ?? directionalObs[0];
    const zoneInvalidation =
      supplyZone && supplyZone.high > entryPrice
        ? supplyZone.high * 1.002
        : entryPrice + nearZeroRange * 0.8;
    const sweepHigh =
      liquiditySweep.type === 'BSL Sweep' && liquiditySweep.sweptPrice > entryPrice
        ? liquiditySweep.sweptPrice * 1.003
        : zoneInvalidation;
    const rawSl = Math.max(zoneInvalidation, sweepHigh);
    stopLoss = roundPrice(Math.max(entryPrice * 1.0045, Math.min(entryPrice * 1.045, rawSl)));
  }

  // Exact 1:5 Risk-to-Reward ladder incorporating FRVP POC & previous swing high/low targets
  const actualRisk = Math.max(Math.abs(entryPrice - stopLoss), entryPrice * 0.0045);
  const rr1 = Math.max(1.2, Number((targetRiskReward * 0.4).toFixed(2)));
  const rr2 = Math.max(rr1 + 0.5, Number((targetRiskReward * 0.7).toFixed(2)));
  const rr3 = Math.max(rr2 + 0.5, targetRiskReward);

  const tp1 =
    direction === 'BUY'
      ? roundPrice(entryPrice + actualRisk * rr1)
      : roundPrice(Math.max(entryPrice * 0.05, entryPrice - actualRisk * rr1));
  const tp2 =
    direction === 'BUY'
      ? roundPrice(Math.max(tp1 * 1.001, entryPrice + actualRisk * rr2))
      : roundPrice(Math.max(entryPrice * 0.04, Math.min(tp1 * 0.999, entryPrice - actualRisk * rr2)));
  const rawTp3 =
    direction === 'BUY'
      ? Math.max(tp2 * 1.001, entryPrice + actualRisk * rr3)
      : Math.max(entryPrice * 0.03, Math.min(tp2 * 0.999, entryPrice - actualRisk * rr3));
  const tp3 =
    targetRiskReward >= 5
      ? roundTargetPreservingFloor(direction, entryPrice, stopLoss, rawTp3, targetRiskReward)
      : roundPrice(rawTp3);

  const riskRewardRatio = Number((Math.abs(tp3 - entryPrice) / actualRisk).toFixed(1));

  // Derive closed-window structural invalidation & opposing liquidity pool for Stage-1 RRGateKernel audit
  const structuralLevels = deriveStructuralLevelsFromClosedWindow({
    direction,
    entryPrice,
    closedCandles: candles,
  });
  const rrGateEvaluation = checkRRSignalEmission({
    direction,
    entryPrice,
    stopLoss: structuralLevels.structuralStopLoss ?? stopLoss,
    takeProfit: structuralLevels.structuralTarget ?? targetLiquidityPool,
    stopOrigin: structuralLevels.structuralStopLoss
      ? structuralLevels.stopOrigin
      : 'NONE',
    targetOrigin: structuralLevels.structuralTarget
      ? structuralLevels.targetOrigin
      : 'NONE',
    invalidationLabel: structuralLevels.stopInvalidationLabel,
    liquidityPoolLabel: structuralLevels.targetLiquidityPoolLabel,
  });

  const zoneRetestReady =
    Boolean(safeDirectionalObs[0] && (safeDirectionalObs[0].retesting || safeDirectionalObs[0].distancePercent <= 2.5)) ||
    nearPoc ||
    (institutionalLiquidityConfirmed && !spotInLvn) ||
    (!spotInLvn && volumeProfile.priceZone !== 'Equilibrium');

  // Execution gate: Only execute entries during London or New York sessions with confirmed sweep and non-LVN confluence
  let executionStatus: SmcExecutionStatus = 'EXECUTE';
  if (!sessionStatus.isOptimalWindow) {
    executionStatus = 'WAIT_SESSION';
  } else if (!sweepConfirmed) {
    executionStatus = 'WAIT_SWEEP';
  } else if (!zoneRetestReady || (spotInLvn && safeDirectionalObs.length === 0)) {
    executionStatus = 'WAIT_ZONE_RETEST';
  }
  const executionAllowed = executionStatus === 'EXECUTE';

  const confluenceCount =
    (structure.eventDirection !== 'Neutral' ? 1 : 0) +
    (sweepConfirmed ? 1 : 0) +
    (activeOrderBlock && !activeOrderBlock.inLowVolumeVoid ? 1 : 0) +
    (institutionalLiquidityConfirmed ? 1 : 0) +
    (sessionStatus.isOptimalWindow ? 1 : 0);

  const confidence = Math.max(
    56,
    Math.min(97, Math.round(52 + Math.abs(clampedScore) * 0.32 + confluenceCount * 3))
  );

  const obPart = activeOrderBlock
    ? `${zoneLabel} ($${formatCryptoPrice(activeOrderBlock.low)}–$${formatCryptoPrice(activeOrderBlock.high)}, ${activeOrderBlock.volumeProfileAlignment === 'HVN_CONFIRMED' ? 'HVN Confirmed' : activeOrderBlock.volumeProfileAlignment === 'LVN_VOID' ? 'LVN Guarded' : 'Standard'})`
    : zoneLabel;
  const targetPoolLabel = direction === 'BUY' ? 'Prev Swing High' : 'Prev Swing Low';
  const sessionGateNote = sessionStatus.isOptimalWindow
    ? `${sessionStatus.session} active (${sessionStatus.utcTimeLabel})`
    : `Hold outside London/NY (${sessionStatus.utcTimeLabel})`;
  const lvnNote =
    lvnAvoidedCount > 0
      ? ` Strictly avoided ${lvnAvoidedCount} low-volume node (LVN) void${lvnAvoidedCount > 1 ? 's' : ''} to prevent stop-run sweeps.`
      : '';
  const rationale = `${structure.summary}. ${liquiditySweep.summary}. ${zoneLabel} entry anchored on ${obPart} with FRVP POC at $${formatCryptoPrice(volumeProfile.poc)}, SL ${direction === 'BUY' ? 'below' : 'above'} zone, targeting ${targetPoolLabel} ($${formatCryptoPrice(targetLiquidityPool)}) at 1:${riskRewardRatio} R:R. ${sessionGateNote}.${lvnNote}`;

  return {
    symbol,
    coinName,
    direction,
    confidence,
    score: clampedScore,
    retestStatus,
    zoneLabel,
    sweepConfirmed,
    institutionalLiquidityConfirmed,
    hvnConfirmedCount,
    lvnAvoidedCount,
    targetLiquidityPool,
    sessionStatus,
    executionStatus,
    executionAllowed,
    entryPrice,
    stopLoss,
    takeProfits: [tp1, tp2, tp3],
    riskRewardRatio,
    targetRiskReward,
    monthlyTradeTarget: SMC_AGENT_CONFIG.monthlyTradeTarget,
    structure,
    liquiditySweep,
    activeOrderBlock,
    allOrderBlocks,
    volumeProfile,
    structuralStopLoss: structuralLevels.structuralStopLoss,
    structuralTargetLevel: structuralLevels.structuralTarget,
    structuralStopOrigin: structuralLevels.stopOrigin,
    structuralTargetOrigin: structuralLevels.targetOrigin,
    structuralPlannedRR: structuralLevels.plannedRR,
    rrGateEvaluation,
    rrGateEligible: rrGateEvaluation.passed,
    rationale,
  };
}

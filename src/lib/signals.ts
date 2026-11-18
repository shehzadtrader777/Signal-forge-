import {
  type AccumulationPhase,
  type Candle,
  type CoinMeta,
  type TickerSnapshot,
  type TopGainerCoin,
  TRACKED_COINS,
} from './marketData';
import {
  MIN_RR_KERNEL_CONSTANT,
  checkRRSignalEmission,
  deriveStructuralLevelsFromClosedWindow,
  roundTargetPreservingFloor,
  type RRRejectionCode,
  type RRStageCheckOutcome,
} from './riskEngine';
import { runSmcVolumeProfileAgent, type SmcAgentAnalysis } from './smcAgent';

export type EntryPriceSource = 'LIVE_WS_FEED' | 'CANDLE_CLOSE' | 'REFERENCE_FALLBACK';

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  publishedAt: string;
  url?: string;
  currencies: string[];
  sentiment: 'positive' | 'negative' | 'neutral';
  votesPositive: number;
  votesNegative: number;
  important: boolean;
}

export interface TechnicalAnalysisResult {
  rsi: number;
  ema9: number;
  ema21: number;
  ema50: number;
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  bbPercentB: number;
  pattern: string;
  score: number; // -100 (strong sell) to +100 (strong buy)
  summary: string;
}

export interface FundamentalAnalysisResult {
  score: number; // -100 to +100
  articleCount: number;
  bullishCount: number;
  bearishCount: number;
  topHeadline: string;
  summary: string;
}

export interface TradingSignal {
  id: string;
  symbol: string;
  baseAsset: string;
  coinName: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  entryPriceSource?: EntryPriceSource;
  stopLoss: number;
  trailingStop?: number;
  atrValue?: number;
  dynamicRRs?: [number, number, number];
  takeProfits: [number, number, number];
  confidence: number; // 0 - 99
  technicalScore: number;
  fundamentalScore: number;
  smcScore?: number;
  indicators: TechnicalAnalysisResult;
  fundamental: FundamentalAnalysisResult;
  smc?: SmcAgentAnalysis;
  reason: string;
  generatedAt: string;
  isTopGainer?: boolean;
  gainerRank?: number;
  change24hPercent?: number;
  priorityScore?: number;
  prePumpScore?: number;
  volumeAnomalyRatio?: number;
  accumulationPhase?: AccumulationPhase;
  institutionalConviction?: 'HIGH' | 'ELEVATED' | 'STANDARD';
  recommendedLeverage?: number;
  trailingAtrMultiplier?: number;
  plannedRR?: number;
  structuralPlannedRR?: number;
  rrGateEvaluation?: RRStageCheckOutcome;
  executionEligible?: boolean;
  rrRejectionCode?: RRRejectionCode | null;
}

export function calculateEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

export function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

export function calculateMACD(closes: number[]): {
  macdLine: number;
  signalLine: number;
  histogram: number;
} {
  if (closes.length < 26) {
    return { macdLine: 0, signalLine: 0, histogram: 0 };
  }
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdSeries = closes.map((_, i) => ema12[i] - ema26[i]);
  const signalSeries = calculateEMA(macdSeries, 9);
  const lastIdx = closes.length - 1;
  const macdLine = macdSeries[lastIdx];
  const signalLine = signalSeries[lastIdx];
  return {
    macdLine: Number(macdLine.toFixed(6)),
    signalLine: Number(signalLine.toFixed(6)),
    histogram: Number((macdLine - signalLine).toFixed(6)),
  };
}

export function calculateBollingerBands(
  closes: number[],
  period = 20,
  stdDevMult = 2
): { upper: number; middle: number; lower: number; percentB: number } {
  const slice = closes.slice(-period);
  if (slice.length === 0) {
    return { upper: 0, middle: 0, lower: 0, percentB: 0.5 };
  }
  const mean = slice.reduce((acc, v) => acc + v, 0) / slice.length;
  const variance = slice.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / slice.length;
  const stdDev = Math.sqrt(variance);
  const upper = mean + stdDevMult * stdDev;
  const lower = mean - stdDevMult * stdDev;
  const last = slice[slice.length - 1];
  const bandwidth = upper - lower;
  const percentB = bandwidth > 0 ? (last - lower) / bandwidth : 0.5;
  return {
    upper: Number(upper.toPrecision(6)),
    middle: Number(mean.toPrecision(6)),
    lower: Number(lower.toPrecision(6)),
    percentB: Number(percentB.toFixed(3)),
  };
}

export function detectCandlePatterns(candles: Candle[]): {
  name: string;
  bias: number; // -20 to +20
} {
  if (candles.length < 4) return { name: 'Consolidation', bias: 0 };
  const prev = candles[candles.length - 2];
  const curr = candles[candles.length - 1];
  const prevBody = prev.close - prev.open;
  const currBody = curr.close - curr.open;
  const currRange = Math.max(curr.high - curr.low, 1e-9);
  const lowerWick = Math.min(curr.open, curr.close) - curr.low;
  const upperWick = curr.high - Math.max(curr.open, curr.close);

  if (prevBody < 0 && currBody > 0 && curr.close > prev.open && curr.open <= prev.close) {
    return { name: 'Bullish Engulfing', bias: 18 };
  }
  if (prevBody > 0 && currBody < 0 && curr.close < prev.open && curr.open >= prev.close) {
    return { name: 'Bearish Engulfing', bias: -18 };
  }
  if (lowerWick > Math.abs(currBody) * 2.1 && upperWick < currRange * 0.2) {
    return { name: 'Hammer Reversal', bias: 14 };
  }
  if (upperWick > Math.abs(currBody) * 2.1 && lowerWick < currRange * 0.2) {
    return { name: 'Shooting Star Rejection', bias: -14 };
  }

  const recentHigh = Math.max(...candles.slice(-10, -1).map((c) => c.high));
  const recentLow = Math.min(...candles.slice(-10, -1).map((c) => c.low));
  if (curr.close > recentHigh) {
    return { name: 'Range Breakout High', bias: 15 };
  }
  if (curr.close < recentLow) {
    return { name: 'Support Breakdown', bias: -15 };
  }

  return currBody >= 0
    ? { name: 'Higher Close Continuation', bias: 6 }
    : { name: 'Lower Close Pullback', bias: -6 };
}

export function runTechnicalAgent(candles: Candle[]): TechnicalAnalysisResult {
  const closes = candles.map((c) => c.close);
  const lastClose = closes[closes.length - 1] ?? 0;

  const rsi = calculateRSI(closes, 14);
  const ema9Arr = calculateEMA(closes, 9);
  const ema21Arr = calculateEMA(closes, 21);
  const ema50Arr = calculateEMA(closes, 50);
  const ema9 = ema9Arr[ema9Arr.length - 1] ?? lastClose;
  const ema21 = ema21Arr[ema21Arr.length - 1] ?? lastClose;
  const ema50 = ema50Arr[ema50Arr.length - 1] ?? lastClose;

  const macd = calculateMACD(closes);
  const bb = calculateBollingerBands(closes, 20, 2);
  const pattern = detectCandlePatterns(candles);

  let score = 0;

  // RSI contribution (-28 to +28)
  if (rsi <= 32) score += 26;
  else if (rsi < 45) score += 12;
  else if (rsi >= 68) score -= 26;
  else if (rsi > 56) score += 14; // healthy bullish momentum when not overbought
  else score -= 4;

  // EMA alignment contribution (-28 to +28)
  if (ema9 > ema21 && ema21 > ema50) score += 28;
  else if (ema9 > ema21) score += 15;
  else if (ema9 < ema21 && ema21 < ema50) score -= 28;
  else if (ema9 < ema21) score -= 15;

  // MACD histogram momentum (-22 to +22)
  const normHist = lastClose > 0 ? (macd.histogram / lastClose) * 1000 : 0;
  if (macd.histogram > 0) score += Math.min(22, Math.max(8, Math.round(normHist * 4)));
  else if (macd.histogram < 0) score -= Math.min(22, Math.max(8, Math.round(Math.abs(normHist) * 4)));

  // Bollinger Band positioning (-14 to +14)
  if (bb.percentB < 0.2) score += 14;
  else if (bb.percentB > 0.88) score -= 12;
  else if (bb.percentB >= 0.52) score += 7;
  else score -= 6;

  // Candlestick pattern contribution
  score += pattern.bias;

  const clampedScore = Math.max(-100, Math.min(100, Math.round(score)));
  const emaTrendLabel = ema9 >= ema21 ? 'EMA 9/21 bullish alignment' : 'EMA 9/21 bearish cross';
  const structureBiasLabel = macd.histogram >= 0 ? 'impulse expansion up' : 'downside pressure';
  const summary = `${emaTrendLabel}, ${structureBiasLabel}, ${pattern.name}`;

  return {
    rsi,
    ema9: Number(ema9.toPrecision(6)),
    ema21: Number(ema21.toPrecision(6)),
    ema50: Number(ema50.toPrecision(6)),
    macdLine: macd.macdLine,
    macdSignal: macd.signalLine,
    macdHistogram: macd.histogram,
    bbUpper: bb.upper,
    bbMiddle: bb.middle,
    bbLower: bb.lower,
    bbPercentB: bb.percentB,
    pattern: pattern.name,
    score: clampedScore,
    summary,
  };
}

export function runFundamentalAgent(
  baseAsset: string,
  newsItems: NewsItem[]
): FundamentalAnalysisResult {
  const relevant = newsItems.filter(
    (item) =>
      item.currencies.includes(baseAsset) ||
      item.title.toUpperCase().includes(baseAsset.toUpperCase())
  );

  if (relevant.length === 0) {
    return {
      score: 12,
      articleCount: 0,
      bullishCount: 0,
      bearishCount: 0,
      topHeadline: `Steady institutional orderflow monitored across ${baseAsset} spot books`,
      summary: `Neutral-positive baseline news flow for ${baseAsset}`,
    };
  }

  let weightedSum = 0;
  let bullishCount = 0;
  let bearishCount = 0;

  for (const item of relevant) {
    const importanceMult = item.important ? 1.4 : 1.0;
    const voteNet = Math.max(1, item.votesPositive - item.votesNegative + 3);
    if (item.sentiment === 'positive') {
      bullishCount++;
      weightedSum += 26 * importanceMult + Math.min(18, voteNet);
    } else if (item.sentiment === 'negative') {
      bearishCount++;
      weightedSum -= 26 * importanceMult + Math.min(18, voteNet);
    } else {
      weightedSum += 4;
    }
  }

  const normalizedScore = Math.max(
    -100,
    Math.min(100, Math.round(weightedSum / Math.max(1, Math.sqrt(relevant.length))))
  );
  const topHeadline = relevant[0].title;
  const tone =
    normalizedScore >= 20 ? 'bullish' : normalizedScore <= -20 ? 'bearish' : 'balanced';

  return {
    score: normalizedScore,
    articleCount: relevant.length,
    bullishCount,
    bearishCount,
    topHeadline,
    summary: `${relevant.length} CryptoPanic catalyst${relevant.length > 1 ? 's' : ''} (${tone} bias): "${topHeadline}"`,
  };
}

function estimateATR(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const slice = candles.slice(-period);
  const trs: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const prevClose = slice[i - 1].close;
    const c = slice[i];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  const avg = trs.reduce((a, b) => a + b, 0) / Math.max(1, trs.length);
  return avg > 0 ? avg : slice[slice.length - 1].close * 0.015;
}

export type LiveTickerInput = Pick<TickerSnapshot, 'price' | 'isLiveWs'> | number;

/**
 * Resolves the authoritative snapshot entry price, prioritizing active live WebSocket
 * ticker feeds over static candle closes or deterministic fallback reference prices.
 */
export function resolveLiveEntryPriceSnapshot(
  candles: Candle[],
  fallbackReferencePrice: number,
  liveTicker?: LiveTickerInput
): { entryPrice: number; source: EntryPriceSource } {
  if (typeof liveTicker === 'number' && Number.isFinite(liveTicker) && liveTicker > 0) {
    return { entryPrice: Number(liveTicker.toPrecision(6)), source: 'LIVE_WS_FEED' };
  }
  if (
    liveTicker &&
    typeof liveTicker === 'object' &&
    liveTicker.isLiveWs &&
    Number.isFinite(liveTicker.price) &&
    liveTicker.price > 0
  ) {
    return { entryPrice: Number(liveTicker.price.toPrecision(6)), source: 'LIVE_WS_FEED' };
  }

  const candleClose = candles[candles.length - 1]?.close;
  if (Number.isFinite(candleClose) && candleClose > 0) {
    return { entryPrice: Number(candleClose.toPrecision(6)), source: 'CANDLE_CLOSE' };
  }

  if (
    liveTicker &&
    typeof liveTicker === 'object' &&
    Number.isFinite(liveTicker.price) &&
    liveTicker.price > 0
  ) {
    return { entryPrice: Number(liveTicker.price.toPrecision(6)), source: 'REFERENCE_FALLBACK' };
  }

  const safeFallback =
    Number.isFinite(fallbackReferencePrice) && fallbackReferencePrice > 0
      ? fallbackReferencePrice
      : 100;
  return { entryPrice: Number(safeFallback.toPrecision(6)), source: 'REFERENCE_FALLBACK' };
}

/**
 * Projects a live WebSocket ticker price onto the active working bar without mutating
 * the caller's candle array so technical and SMC calculations reflect real-time order flow.
 */
export function applyLiveSnapshotToCandles(candles: Candle[], livePrice: number): Candle[] {
  if (!candles || candles.length === 0 || !Number.isFinite(livePrice) || livePrice <= 0) {
    return candles;
  }
  const last = candles[candles.length - 1];
  if (
    Math.abs(last.close - livePrice) <= 1e-8 &&
    last.high >= livePrice &&
    last.low <= livePrice
  ) {
    return candles;
  }
  const cloned = candles.slice();
  cloned[cloned.length - 1] = {
    ...last,
    close: livePrice,
    high: Math.max(last.high, livePrice),
    low: Math.min(last.low, livePrice),
  };
  return cloned;
}

export function buildSignalForCoin(
  coin: CoinMeta,
  candles: Candle[],
  newsItems: NewsItem[],
  gainerInfo?: TopGainerCoin,
  liveTicker?: LiveTickerInput
): TradingSignal {
  const entrySnapshot = resolveLiveEntryPriceSnapshot(candles, coin.referencePrice, liveTicker);
  const hasLiveWsFeed = entrySnapshot.source === 'LIVE_WS_FEED';
  const effectiveCandles = hasLiveWsFeed
    ? applyLiveSnapshotToCandles(candles, entrySnapshot.entryPrice)
    : candles;

  const technical = runTechnicalAgent(effectiveCandles);
  const fundamental = runFundamentalAgent(coin.baseAsset, newsItems);
  const smc = runSmcVolumeProfileAgent(
    coin.symbol,
    coin.name,
    effectiveCandles,
    undefined,
    Math.floor(Date.now() / 1000),
    hasLiveWsFeed ? entrySnapshot.entryPrice : undefined
  );

  // Combine Technical (45%) + SMC & Volume Profile (35%) + Fundamental (20%)
  const combinedScore = technical.score * 0.45 + smc.score * 0.35 + fundamental.score * 0.2;
  const direction: 'BUY' | 'SELL' = combinedScore >= 0 ? 'BUY' : 'SELL';

  // Confidence mapped cleanly to 55% - 96% range based on 3-agent agreement & magnitude
  const techAligned = (technical.score >= 0) === (direction === 'BUY');
  const smcAligned = (smc.score >= 0) === (direction === 'BUY');
  const fundAligned = (fundamental.score >= 0) === (direction === 'BUY');
  const alignedCount = (techAligned ? 1 : 0) + (smcAligned ? 1 : 0) + (fundAligned ? 1 : 0);
  const agreementBonus = alignedCount === 3 ? 13 : alignedCount === 2 ? 6 : -4;

  const gainerConfidenceBoost =
    gainerInfo && direction === 'BUY'
      ? Math.min(7, Math.max(2, Math.round(gainerInfo.change24hPercent * 0.25)))
      : 0;
  const rawConfidence =
    54 + Math.abs(combinedScore) * 0.42 + agreementBonus + gainerConfidenceBoost;
  const confidence = Math.max(55, Math.min(96, Math.round(rawConfidence)));

  const smcMatchesDirection = smc.direction === direction;
  const entryPrice = hasLiveWsFeed
    ? entrySnapshot.entryPrice
    : smcMatchesDirection
    ? smc.entryPrice
    : entrySnapshot.entryPrice;

  const atr = Math.max(estimateATR(effectiveCandles), entryPrice * 0.008);
  const atrPct = (atr / Math.max(entryPrice, 1e-8)) * 100;

  // Detect volume anomaly (recent 6 candles vs prior 20 baseline) & institutional accumulation
  const volSliceRecent = effectiveCandles.slice(-6);
  const volSliceBase = effectiveCandles.slice(-26, -6);
  const avgRecentVol =
    volSliceRecent.reduce((acc, c) => acc + c.volume, 0) / Math.max(1, volSliceRecent.length);
  const avgBaseVol =
    volSliceBase.reduce((acc, c) => acc + c.volume, 0) / Math.max(1, volSliceBase.length);
  const candleVolRatio = avgBaseVol > 0 ? avgRecentVol / avgBaseVol : 1.0;
  const volumeAnomalyRatio = Number(
    Math.max(gainerInfo?.volumeAnomalyRatio ?? 1.0, candleVolRatio).toFixed(2)
  );
  const basePrePump = gainerInfo?.prePumpScore ?? 0;
  const accumulationBonus =
    smc.score >= 25 ? 16 : smc.score >= 10 ? 9 : 0;
  const volBonus = Math.min(24, Math.max(0, (volumeAnomalyRatio - 1.0) * 14));
  const prePumpScore = Math.min(
    99,
    Math.max(
      basePrePump,
      Math.round(
        (direction === 'BUY' ? 38 : 26) +
          volBonus +
          accumulationBonus +
          Math.min(18, (gainerInfo?.change24hPercent ?? 0) * 0.9)
      )
    )
  );
  const isMomentumLeader = Boolean(gainerInfo) || prePumpScore >= 65;
  const accumulationPhase: AccumulationPhase | undefined = gainerInfo?.accumulationPhase
    ? gainerInfo.accumulationPhase
    : prePumpScore >= 74
    ? 'PRE_PUMP_ACCUMULATION'
    : prePumpScore >= 62
    ? 'EARLY_BREAKOUT'
    : undefined;
  const institutionalConviction: TradingSignal['institutionalConviction'] =
    gainerInfo?.institutionalConviction ??
    (volumeAnomalyRatio >= 1.65 && smc.score >= 20
      ? 'HIGH'
      : volumeAnomalyRatio >= 1.25 || Boolean(gainerInfo)
      ? 'ELEVATED'
      : 'STANDARD');

  // Dynamic leverage calibrated inversely to ATR volatility while honoring high conviction
  const rawDynLev = Math.round(
    (22 / Math.max(0.65, atrPct)) * (institutionalConviction === 'HIGH' ? 1.15 : 1.0)
  );
  const recommendedLeverage = Math.max(
    2,
    Math.min(gainerInfo?.dynamicLeverageCap ?? 20, 20, rawDynLev)
  );

  // Wider trailing SL multiplier (1.95x-2.35x ATR) for Top Gainer / Pre-Pump leaders so trends run smoothly
  const trailingAtrMultiplier = Number(
    (
      gainerInfo?.wideTrailAtrMult ??
      (isMomentumLeader ? (atrPct >= 3.0 ? 2.35 : 2.05) : 1.25)
    ).toFixed(2)
  );

  const stopMult = (atrPct >= 3.2 ? 1.85 : atrPct <= 1.15 ? 1.35 : 1.55) * (isMomentumLeader ? 1.15 : 1.0);
  const riskUnit = atr * stopMult;

  const bbSpreadRatio =
    technical.bbMiddle > 0 ? (technical.bbUpper - technical.bbLower) / technical.bbMiddle : 0.04;
  const volBoost = Math.min(0.65, Math.max(-0.2, (bbSpreadRatio - 0.04) * 5.2));
  const confBoost = Math.max(-0.25, Math.min(0.85, (confidence - 72) * 0.032));
  const emaGap =
    technical.ema21 > 0 ? Math.abs(entryPrice - technical.ema21) / technical.ema21 : 0.01;
  const trendAdj = 0.94 + Math.min(0.3, emaGap * 6);

  const dynRr1 = Number(Math.max(1.25, (1.45 + confBoost * 0.4 + volBoost * 0.35) * trendAdj).toFixed(2));
  const dynRr2 = Number(Math.max(dynRr1 + 0.85, (2.45 + confBoost * 0.8 + volBoost * 0.7) * trendAdj).toFixed(2));
  const dynRr3 = Number(
    Math.max(dynRr2 + 1.15, MIN_RR_KERNEL_CONSTANT, (5.0 + confBoost * 1.1 + volBoost * 0.9) * trendAdj).toFixed(2)
  );

  let stopLoss: number;
  let tp1: number;
  let tp2: number;
  let tp3: number;

  const smcStopValidForEntry =
    smcMatchesDirection &&
    (direction === 'BUY' ? smc.stopLoss < entryPrice * 0.996 : smc.stopLoss > entryPrice * 1.004);

  if (smcStopValidForEntry) {
    stopLoss = smc.stopLoss;
    const smcRisk = Math.max(Math.abs(entryPrice - stopLoss), riskUnit);
    // Keep SMC liquidity pool reach while adapting scaling increments dynamically around live entry
    const [smcTp1, smcTp2, smcTp3] = smc.takeProfits;
    const dynTp1 =
      direction === 'BUY'
        ? Number((entryPrice + smcRisk * dynRr1).toPrecision(6))
        : Number(Math.max(entryPrice * 0.05, entryPrice - smcRisk * dynRr1).toPrecision(6));
    const dynTp2 =
      direction === 'BUY'
        ? Number((entryPrice + smcRisk * dynRr2).toPrecision(6))
        : Number(Math.max(entryPrice * 0.04, entryPrice - smcRisk * dynRr2).toPrecision(6));
    tp1 =
      direction === 'BUY'
        ? Number(Math.min(smcTp2 * 0.995, Math.max(smcTp1, dynTp1)).toPrecision(6))
        : Number(Math.max(smcTp2 * 1.005, Math.min(smcTp1, dynTp1)).toPrecision(6));
    tp2 =
      direction === 'BUY'
        ? Number(Math.min(smcTp3 * 0.995, Math.max(tp1 * 1.005, dynTp2)).toPrecision(6))
        : Number(Math.max(smcTp3 * 1.005, Math.min(tp1 * 0.995, dynTp2)).toPrecision(6));
    const rawTp3 =
      direction === 'BUY'
        ? Math.max(tp2 * 1.002, smcTp3, entryPrice + Math.abs(entryPrice - stopLoss) * dynRr3)
        : Math.max(entryPrice * 0.03, Math.min(tp2 * 0.998, smcTp3, entryPrice - Math.abs(entryPrice - stopLoss) * dynRr3));
    tp3 = roundTargetPreservingFloor(direction, entryPrice, stopLoss, rawTp3, MIN_RR_KERNEL_CONSTANT);
    if (
      (direction === 'BUY' && (tp1 <= entryPrice || tp2 <= tp1 || tp3 <= tp2)) ||
      (direction === 'SELL' && (tp1 >= entryPrice || tp2 >= tp1 || tp3 >= tp2))
    ) {
      tp1 =
        direction === 'BUY'
          ? Number((entryPrice + smcRisk * dynRr1).toPrecision(6))
          : Number(Math.max(entryPrice * 0.05, entryPrice - smcRisk * dynRr1).toPrecision(6));
      tp2 =
        direction === 'BUY'
          ? Number((entryPrice + smcRisk * dynRr2).toPrecision(6))
          : Number(Math.max(entryPrice * 0.04, entryPrice - smcRisk * dynRr2).toPrecision(6));
      tp3 = roundTargetPreservingFloor(
        direction,
        entryPrice,
        stopLoss,
        direction === 'BUY'
          ? entryPrice + smcRisk * dynRr3
          : Math.max(entryPrice * 0.03, entryPrice - smcRisk * dynRr3),
        MIN_RR_KERNEL_CONSTANT
      );
    }
  } else {
    stopLoss =
      direction === 'BUY'
        ? Number((entryPrice - riskUnit).toPrecision(6))
        : Number((entryPrice + riskUnit).toPrecision(6));
    tp1 =
      direction === 'BUY'
        ? Number((entryPrice + riskUnit * dynRr1).toPrecision(6))
        : Number(Math.max(entryPrice * 0.05, entryPrice - riskUnit * dynRr1).toPrecision(6));
    tp2 =
      direction === 'BUY'
        ? Number((entryPrice + riskUnit * dynRr2).toPrecision(6))
        : Number(Math.max(entryPrice * 0.04, entryPrice - riskUnit * dynRr2).toPrecision(6));
    tp3 = roundTargetPreservingFloor(
      direction,
      entryPrice,
      stopLoss,
      direction === 'BUY'
        ? entryPrice + riskUnit * dynRr3
        : Math.max(entryPrice * 0.03, entryPrice - riskUnit * dynRr3),
      MIN_RR_KERNEL_CONSTANT
    );
  }

  const normalizedEntry = Number(entryPrice.toPrecision(6));
  tp3 = roundTargetPreservingFloor(direction, normalizedEntry, stopLoss, tp3, MIN_RR_KERNEL_CONSTANT);

  const recentHigh = Math.max(...effectiveCandles.slice(-12).map((c) => c.high), normalizedEntry);
  const recentLow = Math.min(...effectiveCandles.slice(-12).map((c) => c.low), normalizedEntry);
  const trailingStop =
    direction === 'BUY'
      ? Number(
          Math.max(stopLoss, Math.min(normalizedEntry * 0.996, recentHigh - atr * trailingAtrMultiplier)).toPrecision(6)
        )
      : Number(
          Math.min(stopLoss, Math.max(normalizedEntry * 1.004, recentLow + atr * trailingAtrMultiplier)).toPrecision(6)
        );

  const actualRisk = Math.max(Math.abs(normalizedEntry - stopLoss), 1e-8);
  const dynamicRRs: [number, number, number] = [
    Number((Math.abs(tp1 - normalizedEntry) / actualRisk).toFixed(2)),
    Number((Math.abs(tp2 - normalizedEntry) / actualRisk).toFixed(2)),
    Number((Math.abs(tp3 - normalizedEntry) / actualRisk).toFixed(2)),
  ];

  // Structural Stage-1 RRGateKernel evaluation against closed-window invalidation and opposing liquidity pool
  const structuralLevels = deriveStructuralLevelsFromClosedWindow({
    direction,
    entryPrice: normalizedEntry,
    closedCandles: effectiveCandles,
  });
  const rrGateEvaluation = checkRRSignalEmission({
    direction,
    entryPrice: normalizedEntry,
    stopLoss: structuralLevels.structuralStopLoss,
    takeProfit: structuralLevels.structuralTarget,
    stopOrigin: structuralLevels.stopOrigin,
    targetOrigin: structuralLevels.targetOrigin,
    invalidationLabel: structuralLevels.stopInvalidationLabel,
    liquidityPoolLabel: structuralLevels.targetLiquidityPoolLabel,
  });

  const gainerNote = gainerInfo
    ? ` Binance Top Gainer #${gainerInfo.gainerRank} (+${gainerInfo.change24hPercent.toFixed(2)}% 24h · Pre-Pump ${prePumpScore}/99 · ${trailingAtrMultiplier}x ATR Runway).`
    : '';
  const smcNote = ` SMC & FRVP Agent: ${smc.structure.summary}; ${smc.retestStatus} (POC $${smc.volumeProfile.poc}).`;
  const reason = `Execution & Structure: ${technical.summary}. Market Context: ${fundamental.summary}.${smcNote}${gainerNote}`;

  const prePumpBonus = prePumpScore >= 72 ? 6 : prePumpScore >= 60 ? 3 : 0;
  const priorityBonus =
    (gainerInfo
      ? Math.max(6, 20 - (gainerInfo.gainerRank - 1) * 2) + (direction === 'BUY' ? 4 : 0)
      : 0) + prePumpBonus;

  return {
    id: `sig_${coin.symbol}_${direction}`,
    symbol: coin.symbol,
    baseAsset: coin.baseAsset,
    coinName: coin.name,
    direction,
    entryPrice: normalizedEntry,
    entryPriceSource: entrySnapshot.source,
    stopLoss,
    trailingStop,
    atrValue: Number(atr.toPrecision(5)),
    dynamicRRs,
    takeProfits: [tp1, tp2, tp3],
    confidence,
    technicalScore: technical.score,
    fundamentalScore: fundamental.score,
    smcScore: smc.score,
    indicators: technical,
    fundamental,
    smc,
    reason,
    generatedAt: new Date().toISOString(),
    ...(gainerInfo
      ? {
          isTopGainer: true,
          gainerRank: gainerInfo.gainerRank,
          change24hPercent: gainerInfo.change24hPercent,
        }
      : {}),
    prePumpScore,
    volumeAnomalyRatio,
    accumulationPhase,
    institutionalConviction,
    recommendedLeverage,
    trailingAtrMultiplier,
    plannedRR: dynamicRRs[2],
    structuralPlannedRR: structuralLevels.plannedRR,
    rrGateEvaluation,
    executionEligible: rrGateEvaluation.passed,
    rrRejectionCode: rrGateEvaluation.rejectionCode,
    priorityScore: confidence + priorityBonus,
  };
}

export function generateTopSignals(
  candlesBySymbol: Record<string, Candle[]>,
  newsItems: NewsItem[],
  topN = 3,
  dynamicCoins: CoinMeta[] = [],
  topGainers: TopGainerCoin[] = [],
  liveTickersBySymbol?: Record<string, LiveTickerInput>
): TradingSignal[] {
  const gainerMap = new Map<string, TopGainerCoin>();
  for (const g of topGainers) {
    gainerMap.set(g.symbol.toUpperCase(), g);
  }

  const coinPoolMap = new Map<string, CoinMeta>();
  for (const coin of TRACKED_COINS) {
    coinPoolMap.set(coin.symbol, coin);
  }
  for (const coin of dynamicCoins) {
    if (!coinPoolMap.has(coin.symbol)) {
      coinPoolMap.set(coin.symbol, coin);
    }
  }
  for (const g of topGainers) {
    if (!coinPoolMap.has(g.symbol)) {
      coinPoolMap.set(g.symbol, {
        symbol: g.symbol,
        baseAsset: g.baseAsset,
        name: g.name,
        referencePrice: g.price,
        dailyVolatility: 0.055,
      });
    }
  }

  const allSignals: TradingSignal[] = [];
  for (const coin of coinPoolMap.values()) {
    const candles = candlesBySymbol[coin.symbol];
    if (!candles || candles.length < 20) continue;
    const gainerInfo = gainerMap.get(coin.symbol);
    const liveTicker = liveTickersBySymbol?.[coin.symbol];
    allSignals.push(buildSignalForCoin(coin, candles, newsItems, gainerInfo, liveTicker));
  }

  return allSignals
    .sort(
      (a, b) =>
        (b.priorityScore ?? b.confidence) - (a.priorityScore ?? a.confidence) ||
        b.confidence - a.confidence ||
        Math.abs(b.technicalScore) - Math.abs(a.technicalScore)
    )
    .slice(0, topN);
}

export const DEFAULT_NEWS_FEED: NewsItem[] = [
  {
    id: 'cp-1',
    title: 'Bitcoin spot ETF net inflows accelerate as institutional desks accumulate BTC',
    source: 'CryptoPanic Feed',
    publishedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    currencies: ['BTC'],
    sentiment: 'positive',
    votesPositive: 48,
    votesNegative: 3,
    important: true,
  },
  {
    id: 'cp-2',
    title: 'Solana DEX weekly settlement volume reaches new quarterly milestone on SOL pairs',
    source: 'CryptoPanic Feed',
    publishedAt: new Date(Date.now() - 52 * 60 * 1000).toISOString(),
    currencies: ['SOL'],
    sentiment: 'positive',
    votesPositive: 36,
    votesNegative: 4,
    important: true,
  },
  {
    id: 'cp-3',
    title: 'Ethereum L2 blob fee efficiency drives higher staking retention for ETH validators',
    source: 'CryptoPanic Feed',
    publishedAt: new Date(Date.now() - 95 * 60 * 1000).toISOString(),
    currencies: ['ETH'],
    sentiment: 'positive',
    votesPositive: 29,
    votesNegative: 5,
    important: false,
  },
  {
    id: 'cp-4',
    title: 'Chainlink CCIP cross-chain settlement expands across major tokenization pilots',
    source: 'CryptoPanic Feed',
    publishedAt: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
    currencies: ['LINK'],
    sentiment: 'positive',
    votesPositive: 24,
    votesNegative: 2,
    important: true,
  },
  {
    id: 'cp-5',
    title: 'Meme token leverage funding heats up as DOGE open interest hits elevated levels',
    source: 'CryptoPanic Feed',
    publishedAt: new Date(Date.now() - 150 * 60 * 1000).toISOString(),
    currencies: ['DOGE'],
    sentiment: 'negative',
    votesPositive: 9,
    votesNegative: 27,
    important: true,
  },
  {
    id: 'cp-6',
    title: 'Large XRP escrow unlock schedules spark short-term exchange inflow caution',
    source: 'CryptoPanic Feed',
    publishedAt: new Date(Date.now() - 190 * 60 * 1000).toISOString(),
    currencies: ['XRP'],
    sentiment: 'negative',
    votesPositive: 7,
    votesNegative: 22,
    important: false,
  },
];

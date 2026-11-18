import { type CoinMeta, type Candle, type Timeframe, TRACKED_COINS, formatCryptoPrice } from './marketData';
import { calculateEMA, calculateMACD, calculateRSI } from './signals';

export type PatternName =
  | 'Ascending Triangle'
  | 'Descending Triangle'
  | 'Symmetrical Triangle'
  | 'Bull Flag'
  | 'Bear Flag'
  | 'Double Bottom'
  | 'Double Top'
  | 'Falling Wedge'
  | 'Rising Wedge'
  | 'Range Compression';

export type PatternSignalMode = 'BOTH' | 'LONG_ONLY' | 'SHORT_ONLY';

export interface PatternScannerParams {
  timeframe: Timeframe;
  signalMode: PatternSignalMode;
  minVolumeMultiplier: number; // e.g. 1.35x 20-bar avg volume
  minClosePercentBeyondLevel: number; // e.g. 0.2% decisive close beyond boundary
  minConfidence: number; // e.g. 70%
  riskRewardTarget: number; // 2, 3, or 5
  strictFakeoutFilter: boolean;
}

export const DEFAULT_PATTERN_SCANNER_PARAMS: PatternScannerParams = {
  timeframe: '4h',
  signalMode: 'BOTH',
  minVolumeMultiplier: 1.35,
  minClosePercentBeyondLevel: 0.2,
  minConfidence: 70,
  riskRewardTarget: 3,
  strictFakeoutFilter: true,
};

export interface PatternCandidate {
  patternName: PatternName;
  bias: 'BULLISH' | 'BEARISH';
  resistanceLevel: number;
  supportLevel: number;
  invalidationLevel: number;
  structuralQuality: number; // 0..30
  description: string;
}

export interface PatternScanResult {
  id: string;
  symbol: string;
  baseAsset: string;
  coinName: string;
  timeframe: Timeframe;
  patternName: PatternName;
  moveType: 'BREAKOUT' | 'BREAKDOWN' | 'COIL';
  direction: 'BUY' | 'SELL';
  status: 'CONFIRMED_SIGNAL' | 'FILTERED_FAKEOUT' | 'WATCHING_COIL';
  breakoutLevel: number;
  closePrice: number;
  closeBeyondPercent: number;
  volumeRatio: number;
  rsi: number;
  confidence: number;
  entryPrice: number;
  stopLoss: number;
  takeProfits: [number, number, number];
  riskRewardRatio: number;
  passedChecks: string[];
  fakeoutReasons: string[];
  summary: string;
  detectedAt: string;
}

export interface MarketPatternScanSummary {
  scannedCount: number;
  confirmedSignals: PatternScanResult[];
  filteredFakeouts: PatternScanResult[];
  watchingCoils: PatternScanResult[];
  scannedAt: string;
}

function roundPrice(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Number(v.toPrecision(6));
}

function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Analyzes prior bars (before the breakout bar) to classify chart structure:
 * Ascending/Descending Triangles, Bull/Bear Flags, Double Bottom/Top, or Range Compression.
 */
export function detectChartPatternStructure(candles: Candle[]): PatternCandidate | null {
  if (candles.length < 36) return null;

  // Use prior 36 bars excluding the latest 2 potential breakout bars to measure pre-break structure
  const structureWindow = candles.slice(Math.max(0, candles.length - 38), candles.length - 2);
  if (structureWindow.length < 24) return null;

  const avgPrice =
    structureWindow.reduce((acc, c) => acc + c.close, 0) / structureWindow.length;
  if (avgPrice <= 0) return null;

  const highs = structureWindow.map((c) => c.high);
  const lows = structureWindow.map((c) => c.low);
  const closes = structureWindow.map((c) => c.close);

  // Split into 3 segments to inspect swing progression & flat ceilings/floors
  const segSize = Math.floor(structureWindow.length / 3);
  const segHighs = [
    Math.max(...highs.slice(0, segSize)),
    Math.max(...highs.slice(segSize, segSize * 2)),
    Math.max(...highs.slice(segSize * 2)),
  ];
  const segLows = [
    Math.min(...lows.slice(0, segSize)),
    Math.min(...lows.slice(segSize, segSize * 2)),
    Math.min(...lows.slice(segSize * 2)),
  ];

  const maxHigh = Math.max(...segHighs);
  const minLow = Math.min(...segLows);
  const highSlopePct = (linearSlope(segHighs) / avgPrice) * 100;
  const lowSlopePct = (linearSlope(segLows) / avgPrice) * 100;

  // Recent 12 bars tighter boundary for immediate breakout/breakdown trigger
  const recentHigh = Math.max(...highs.slice(-14));
  const recentLow = Math.min(...lows.slice(-14));

  // 1. Check prior pole momentum (first half vs second half) for Bull/Bear Flags
  const firstHalfClose = closes[0];
  const midClose = closes[Math.floor(closes.length * 0.45)];
  const endClose = closes[closes.length - 1];
  const poleReturnPct = ((midClose - firstHalfClose) / Math.max(firstHalfClose, 1e-9)) * 100;
  const flagDriftPct = ((endClose - midClose) / Math.max(midClose, 1e-9)) * 100;

  if (poleReturnPct >= 2.2 && flagDriftPct <= 0.6 && flagDriftPct >= -4.2 && highSlopePct <= -0.05) {
    return {
      patternName: 'Bull Flag',
      bias: 'BULLISH',
      resistanceLevel: roundPrice(recentHigh),
      supportLevel: roundPrice(recentLow),
      invalidationLevel: roundPrice(recentLow * 0.996),
      structuralQuality: 26,
      description: `Bullish impulse pole (+${poleReturnPct.toFixed(1)}%) followed by controlled flag pullback`,
    };
  }

  if (poleReturnPct <= -2.2 && flagDriftPct >= -0.6 && flagDriftPct <= 4.2 && lowSlopePct >= 0.05) {
    return {
      patternName: 'Bear Flag',
      bias: 'BEARISH',
      resistanceLevel: roundPrice(recentHigh),
      supportLevel: roundPrice(recentLow),
      invalidationLevel: roundPrice(recentHigh * 1.004),
      structuralQuality: 26,
      description: `Bearish impulse leg (${poleReturnPct.toFixed(1)}%) followed by weak upward flag bounce`,
    };
  }

  // 2. Ascending Triangle (flat highs, rising lows) & Descending Triangle (falling highs, flat lows)
  const flatCeiling = Math.abs(highSlopePct) <= 0.85;
  const flatFloor = Math.abs(lowSlopePct) <= 0.85;
  const risingLows = segLows[1] >= segLows[0] * 0.996 && segLows[2] >= segLows[1] * 0.996;
  const fallingHighs = segHighs[1] <= segHighs[0] * 1.004 && segHighs[2] <= segHighs[1] * 1.004;

  if (flatCeiling && lowSlopePct >= 0.25 && risingLows) {
    return {
      patternName: 'Ascending Triangle',
      bias: 'BULLISH',
      resistanceLevel: roundPrice(recentHigh),
      supportLevel: roundPrice(recentLow),
      invalidationLevel: roundPrice(recentLow * 0.996),
      structuralQuality: 25,
      description: `Ascending Triangle coiling higher lows against $${formatCryptoPrice(recentHigh)} resistance`,
    };
  }

  if (flatFloor && highSlopePct <= -0.25 && fallingHighs) {
    return {
      patternName: 'Descending Triangle',
      bias: 'BEARISH',
      resistanceLevel: roundPrice(recentHigh),
      supportLevel: roundPrice(recentLow),
      invalidationLevel: roundPrice(recentHigh * 1.004),
      structuralQuality: 25,
      description: `Descending Triangle pressing lower highs onto $${formatCryptoPrice(recentLow)} support`,
    };
  }

  // 3. Double Bottom (W) & Double Top (M)
  const lowDiffPct = Math.abs(segLows[0] - segLows[2]) / Math.max(segLows[0], 1e-9) * 100;
  const midPeakBouncePct = ((segHighs[1] - Math.min(segLows[0], segLows[2])) / Math.max(segLows[0], 1e-9)) * 100;
  if (
    lowDiffPct <= 1.8 &&
    midPeakBouncePct >= 1.2 &&
    segLows[1] >= Math.min(segLows[0], segLows[2])
  ) {
    return {
      patternName: 'Double Bottom',
      bias: 'BULLISH',
      resistanceLevel: roundPrice(segHighs[1]),
      supportLevel: roundPrice(Math.min(segLows[0], segLows[2])),
      invalidationLevel: roundPrice(Math.min(segLows[0], segLows[2]) * 0.996),
      structuralQuality: 25,
      description: `Double Bottom (W) defense at $${formatCryptoPrice(Math.min(segLows[0], segLows[2]))} targeting neckline $${formatCryptoPrice(segHighs[1])}`,
    };
  }

  const highDiffPct = Math.abs(segHighs[0] - segHighs[2]) / Math.max(segHighs[0], 1e-9) * 100;
  const midTroughDropPct = ((Math.max(segHighs[0], segHighs[2]) - segLows[1]) / Math.max(segHighs[0], 1e-9)) * 100;
  if (
    highDiffPct <= 1.8 &&
    midTroughDropPct >= 1.2 &&
    segHighs[1] <= Math.max(segHighs[0], segHighs[2])
  ) {
    return {
      patternName: 'Double Top',
      bias: 'BEARISH',
      resistanceLevel: roundPrice(Math.max(segHighs[0], segHighs[2])),
      supportLevel: roundPrice(segLows[1]),
      invalidationLevel: roundPrice(Math.max(segHighs[0], segHighs[2]) * 1.004),
      structuralQuality: 25,
      description: `Double Top (M) rejection near $${formatCryptoPrice(Math.max(segHighs[0], segHighs[2]))} below neckline $${formatCryptoPrice(segLows[1])}`,
    };
  }

  // 4. Symmetrical Triangle & Falling/Rising Wedge structures
  if (highSlopePct <= -0.15 && lowSlopePct >= 0.15) {
    const bias: 'BULLISH' | 'BEARISH' =
      candles[candles.length - 1].close >= (recentHigh + recentLow) / 2 ? 'BULLISH' : 'BEARISH';
    return {
      patternName: 'Symmetrical Triangle',
      bias,
      resistanceLevel: roundPrice(recentHigh),
      supportLevel: roundPrice(recentLow),
      invalidationLevel:
        bias === 'BULLISH' ? roundPrice(recentLow * 0.996) : roundPrice(recentHigh * 1.004),
      structuralQuality: 23,
      description: `Symmetrical Triangle converging apex between $${formatCryptoPrice(recentLow)} and $${formatCryptoPrice(recentHigh)}`,
    };
  }

  if (highSlopePct < -0.25 && lowSlopePct < -0.1) {
    return {
      patternName: 'Falling Wedge',
      bias: highSlopePct < lowSlopePct ? 'BULLISH' : 'BEARISH',
      resistanceLevel: roundPrice(recentHigh),
      supportLevel: roundPrice(recentLow),
      invalidationLevel: roundPrice(recentHigh * 1.004),
      structuralQuality: 22,
      description: `Falling Wedge compression bound by $${formatCryptoPrice(recentLow)} – $${formatCryptoPrice(recentHigh)}`,
    };
  }

  if (highSlopePct > 0.1 && lowSlopePct > 0.25) {
    return {
      patternName: 'Rising Wedge',
      bias: lowSlopePct > highSlopePct ? 'BEARISH' : 'BULLISH',
      resistanceLevel: roundPrice(recentHigh),
      supportLevel: roundPrice(recentLow),
      invalidationLevel: roundPrice(recentLow * 0.996),
      structuralQuality: 22,
      description: `Rising Wedge channel bound by $${formatCryptoPrice(recentLow)} – $${formatCryptoPrice(recentHigh)}`,
    };
  }

  // 5. Fallback Range Compression Box
  const latest = candles[candles.length - 1];
  const midLevel = (recentHigh + recentLow) / 2;
  const bias: 'BULLISH' | 'BEARISH' = latest.close >= midLevel ? 'BULLISH' : 'BEARISH';

  return {
    patternName: 'Range Compression',
    bias,
    resistanceLevel: roundPrice(recentHigh),
    supportLevel: roundPrice(recentLow),
    invalidationLevel:
      bias === 'BULLISH' ? roundPrice(recentLow * 0.996) : roundPrice(recentHigh * 1.004),
    structuralQuality: maxHigh > minLow ? 19 : 14,
    description: `Compression box $${formatCryptoPrice(recentLow)} – $${formatCryptoPrice(recentHigh)} testing boundary expansion`,
  };
}

/**
 * Evaluates a single coin's OHLCV candles for a Breakout or Breakdown and applies
 * strict multi-factor anti-fakeout verification.
 */
export function scanCoinChartPattern(
  coin: CoinMeta,
  candles: Candle[],
  params: PatternScannerParams = DEFAULT_PATTERN_SCANNER_PARAMS
): PatternScanResult | null {
  if (!candles || candles.length < 38) return null;

  const candidate = detectChartPatternStructure(candles);
  if (!candidate) return null;

  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const closes = candles.map((c) => c.close);
  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const ema21 = calculateEMA(closes, 21);
  const latestEma21 = ema21[ema21.length - 1] ?? latest.close;

  // Compute 20-bar average volume excluding the breakout bar(s)
  const volWindow = candles.slice(Math.max(0, candles.length - 22), candles.length - 2);
  const avgVol =
    volWindow.reduce((acc, c) => acc + Math.max(0, c.volume), 0) / Math.max(1, volWindow.length);
  const latestVolRatio = latest.volume / Math.max(avgVol, 1e-9);
  const prevVolRatio = prev.volume / Math.max(avgVol, 1e-9);

  // Determine whether price is probing/breaking upside (Breakout) or downside (Breakdown)
  const upsideWickOrClose =
    latest.high > candidate.resistanceLevel ||
    prev.close > candidate.resistanceLevel ||
    latest.close > candidate.resistanceLevel;
  const downsideWickOrClose =
    latest.low < candidate.supportLevel ||
    prev.close < candidate.supportLevel ||
    latest.close < candidate.supportLevel;

  let moveType: PatternScanResult['moveType'] = 'COIL';
  let direction: 'BUY' | 'SELL' = candidate.bias === 'BULLISH' ? 'BUY' : 'SELL';
  let breakoutLevel =
    candidate.bias === 'BULLISH' ? candidate.resistanceLevel : candidate.supportLevel;

  if (upsideWickOrClose && (!downsideWickOrClose || latest.close >= candidate.resistanceLevel)) {
    moveType = 'BREAKOUT';
    direction = 'BUY';
    breakoutLevel = candidate.resistanceLevel;
  } else if (downsideWickOrClose) {
    moveType = 'BREAKDOWN';
    direction = 'SELL';
    breakoutLevel = candidate.supportLevel;
  }

  const prevConfirmedBeyond =
    direction === 'BUY'
      ? prev.close > breakoutLevel && latest.close > breakoutLevel
      : prev.close < breakoutLevel && latest.close < breakoutLevel;

  const volumeRatio = Number(
    (prevConfirmedBeyond ? Math.max(latestVolRatio, prevVolRatio) : latestVolRatio).toFixed(2)
  );

  const closeBeyondPercent =
    direction === 'BUY'
      ? Number((((latest.close - breakoutLevel) / Math.max(breakoutLevel, 1e-9)) * 100).toFixed(2))
      : Number((((breakoutLevel - latest.close) / Math.max(breakoutLevel, 1e-9)) * 100).toFixed(2));

  // Anti-Fakeout Checks
  const passedChecks: string[] = [];
  const fakeoutReasons: string[] = [];

  if (moveType === 'COIL') {
    const distPct = Math.abs(closeBeyondPercent);
    const entryPrice = roundPrice(latest.close);
    const riskDist = Math.max(
      Math.abs(entryPrice - candidate.invalidationLevel),
      entryPrice * 0.012
    );
    const stopLoss =
      direction === 'BUY'
        ? roundPrice(entryPrice - riskDist)
        : roundPrice(entryPrice + riskDist);
    const rr = params.riskRewardTarget;
    const tp1 =
      direction === 'BUY'
        ? roundPrice(entryPrice + riskDist * Math.max(1, rr * 0.4))
        : roundPrice(Math.max(entryPrice * 0.05, entryPrice - riskDist * Math.max(1, rr * 0.4)));
    const tp2 =
      direction === 'BUY'
        ? roundPrice(entryPrice + riskDist * Math.max(1.5, rr * 0.7))
        : roundPrice(Math.max(entryPrice * 0.04, entryPrice - riskDist * Math.max(1.5, rr * 0.7)));
    const tp3 =
      direction === 'BUY'
        ? roundPrice(entryPrice + riskDist * rr)
        : roundPrice(Math.max(entryPrice * 0.03, entryPrice - riskDist * rr));

    return {
      id: `pat_${coin.symbol}_${params.timeframe}_${direction}`,
      symbol: coin.symbol,
      baseAsset: coin.baseAsset,
      coinName: coin.name,
      timeframe: params.timeframe,
      patternName: candidate.patternName,
      moveType: 'COIL',
      direction,
      status: 'WATCHING_COIL',
      breakoutLevel,
      closePrice: roundPrice(latest.close),
      closeBeyondPercent,
      volumeRatio,
      rsi: Number(rsi.toFixed(1)),
      confidence: Math.min(74, 48 + candidate.structuralQuality - Math.round(distPct * 2)),
      entryPrice,
      stopLoss,
      takeProfits: [tp1, tp2, tp3],
      riskRewardRatio: rr,
      passedChecks: [`Coiling ${distPct.toFixed(2)}% from $${formatCryptoPrice(breakoutLevel)}`],
      fakeoutReasons: [],
      summary: `${candidate.description}. Price coiling within ${distPct.toFixed(2)}% of trigger level.`,
      detectedAt: new Date(latest.time * 1000).toISOString(),
    };
  }

  // Check 1: Decisive Candle Close Beyond Structural Boundary (Rejects Wick Traps)
  const candleRange = Math.max(latest.high - latest.low, latest.close * 0.0005);
  const closePosition = (latest.close - latest.low) / candleRange; // 1 = top of bar, 0 = bottom of bar
  if (closeBeyondPercent >= params.minClosePercentBeyondLevel) {
    passedChecks.push(
      `Confirmed close ${closeBeyondPercent.toFixed(2)}% beyond $${formatCryptoPrice(breakoutLevel)}`
    );
  } else if (closeBeyondPercent < 0) {
    fakeoutReasons.push(
      `Wick trap: pierced $${formatCryptoPrice(breakoutLevel)} but closed back inside range (${closeBeyondPercent.toFixed(2)}%)`
    );
  } else {
    fakeoutReasons.push(
      `Weak close (+${closeBeyondPercent.toFixed(2)}% < ${params.minClosePercentBeyondLevel}% threshold)`
    );
  }

  // Check 2: Upper/Lower Wick Rejection Guard
  if (direction === 'BUY' && closePosition < 0.42) {
    fakeoutReasons.push('Heavy upper wick rejection on breakout candle (bull trap risk)');
  } else if (direction === 'SELL' && closePosition > 0.58) {
    fakeoutReasons.push('Heavy lower wick absorption on breakdown candle (bear trap risk)');
  } else {
    passedChecks.push(
      direction === 'BUY'
        ? `Strong bullish close (${Math.round(closePosition * 100)}% of candle range)`
        : `Strong bearish close (${Math.round((1 - closePosition) * 100)}% of candle range)`
    );
  }

  // Check 3: Volume Expansion Verification (Rejects Low-Volume Fakeouts)
  if (volumeRatio >= params.minVolumeMultiplier) {
    passedChecks.push(
      `Volume surge ${volumeRatio.toFixed(2)}x above ${params.minVolumeMultiplier}x filter`
    );
  } else {
    fakeoutReasons.push(
      `Low volume (${volumeRatio.toFixed(2)}x < ${params.minVolumeMultiplier}x avg20 required)`
    );
  }

  // Check 4: Momentum & Trend Confluence Guard
  const momentumAligned =
    direction === 'BUY'
      ? latest.close >= latestEma21 * 0.998 && rsi <= 82 && macd.histogram >= -latest.close * 0.002
      : latest.close <= latestEma21 * 1.002 && rsi >= 18 && macd.histogram <= latest.close * 0.002;
  if (momentumAligned) {
    passedChecks.push('EMA21 trend & impulse expansion aligned');
  } else {
    fakeoutReasons.push('Momentum exhaustion vs EMA21 structural trend');
  }

  const bodyDominance = Math.abs(latest.close - latest.open) / candleRange;
  const rawConfidence =
    49 +
    candidate.structuralQuality +
    Math.min(10, Math.round(Math.max(0, volumeRatio - 1) * 3.5)) +
    Math.min(7, Math.round(Math.max(0, closeBeyondPercent) * 1.1)) +
    Math.round(bodyDominance * 6) -
    fakeoutReasons.length * 14;
  const confidence = Math.max(42, Math.min(97, Math.round(rawConfidence)));

  const passesFilter = params.strictFakeoutFilter
    ? fakeoutReasons.length === 0 && confidence >= params.minConfidence
    : confidence >= Math.max(55, params.minConfidence - 10);

  const status: PatternScanResult['status'] = passesFilter
    ? 'CONFIRMED_SIGNAL'
    : 'FILTERED_FAKEOUT';

  const entryPrice = roundPrice(latest.close);
  const rawRiskDist = Math.abs(entryPrice - candidate.invalidationLevel);
  const riskDist = Math.min(
    entryPrice * 0.045,
    Math.max(entryPrice * 0.006, rawRiskDist > 0 ? rawRiskDist : entryPrice * 0.015)
  );
  const stopLoss =
    direction === 'BUY'
      ? roundPrice(entryPrice - riskDist)
      : roundPrice(entryPrice + riskDist);

  const rr = params.riskRewardTarget;
  const rr1 = Number((rr * 0.4).toFixed(2));
  const rr2 = Number((rr * 0.7).toFixed(2));
  const tp1 =
    direction === 'BUY'
      ? roundPrice(entryPrice + riskDist * rr1)
      : roundPrice(Math.max(entryPrice * 0.05, entryPrice - riskDist * rr1));
  const tp2 =
    direction === 'BUY'
      ? roundPrice(entryPrice + riskDist * rr2)
      : roundPrice(Math.max(entryPrice * 0.04, entryPrice - riskDist * rr2));
  const tp3 =
    direction === 'BUY'
      ? roundPrice(entryPrice + riskDist * rr)
      : roundPrice(Math.max(entryPrice * 0.03, entryPrice - riskDist * rr));

  const actionWord = direction === 'BUY' ? 'LONG Breakout' : 'SHORT Breakdown';
  const summary = passesFilter
    ? `${candidate.patternName} ${actionWord} confirmed above/below $${formatCryptoPrice(breakoutLevel)} with ${volumeRatio.toFixed(2)}x volume.`
    : `${candidate.patternName} ${moveType.toLowerCase()} flagged as FAKEOUT: ${fakeoutReasons[0]}.`;

  return {
    id: `pat_${coin.symbol}_${params.timeframe}_${direction}`,
    symbol: coin.symbol,
    baseAsset: coin.baseAsset,
    coinName: coin.name,
    timeframe: params.timeframe,
    patternName: candidate.patternName,
    moveType,
    direction,
    status,
    breakoutLevel,
    closePrice: roundPrice(latest.close),
    closeBeyondPercent,
    volumeRatio,
    rsi: Number(rsi.toFixed(1)),
    confidence,
    entryPrice,
    stopLoss,
    takeProfits: [tp1, tp2, tp3],
    riskRewardRatio: rr,
    passedChecks,
    fakeoutReasons,
    summary,
    detectedAt: new Date(latest.time * 1000).toISOString(),
  };
}

/**
 * Continuously scans all tracked and dynamically discovered markets, separating
 * high-conviction Long/Short Breakouts & Breakdowns from filtered Fakeouts.
 */
export function scanMarketPatterns(
  candlesBySymbol: Record<string, Candle[]>,
  params: PatternScannerParams = DEFAULT_PATTERN_SCANNER_PARAMS,
  knownCoins: CoinMeta[] = TRACKED_COINS
): MarketPatternScanSummary {
  const coinMap = new Map<string, CoinMeta>();
  for (const c of TRACKED_COINS) coinMap.set(c.symbol, c);
  for (const c of knownCoins) coinMap.set(c.symbol, c);

  const confirmedSignals: PatternScanResult[] = [];
  const filteredFakeouts: PatternScanResult[] = [];
  const watchingCoils: PatternScanResult[] = [];
  let scannedCount = 0;

  for (const coin of coinMap.values()) {
    const candles = candlesBySymbol[coin.symbol];
    if (!candles || candles.length < 38) continue;
    scannedCount++;

    const result = scanCoinChartPattern(coin, candles, params);
    if (!result) continue;

    // Respect user-selected direction parameter
    if (params.signalMode === 'LONG_ONLY' && result.direction !== 'BUY') continue;
    if (params.signalMode === 'SHORT_ONLY' && result.direction !== 'SELL') continue;

    if (result.status === 'CONFIRMED_SIGNAL') {
      confirmedSignals.push(result);
    } else if (result.status === 'FILTERED_FAKEOUT') {
      filteredFakeouts.push(result);
    } else {
      watchingCoils.push(result);
    }
  }

  confirmedSignals.sort((a, b) => b.confidence - a.confidence || b.volumeRatio - a.volumeRatio);
  filteredFakeouts.sort((a, b) => b.fakeoutReasons.length - a.fakeoutReasons.length || b.confidence - a.confidence);
  watchingCoils.sort((a, b) => b.confidence - a.confidence);

  return {
    scannedCount,
    confirmedSignals,
    filteredFakeouts,
    watchingCoils,
    scannedAt: new Date().toISOString(),
  };
}

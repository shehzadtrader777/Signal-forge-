import { type Candle } from './marketData';
import { type MultiExchangeDepthAnalysis } from './orderBookDepth';
import { type NewsItem } from './signals';
import { computeATR, enforceMaxStopLossCap } from './coordinator';

export type SentinelPlatformSource = 'X_VERIFIED' | 'CRYPTOPANIC' | 'EXCHANGE_DEPTH' | 'WS_ANOMALY';

export type SentinelThreatRegime =
  | 'NORMAL'
  | 'PUMP_SURGE'
  | 'DUMP_ALERT'
  | 'PANIC_FUD'
  | 'REVERSAL_CONFIRMED';

export type SentinelVerificationStatus =
  | 'VERIFIED_CROSS_PLATFORM'
  | 'PRICE_CORROBORATED'
  | 'UNVERIFIED_NOISE';

export type SentinelPreemptiveAction =
  | 'PREEMPTIVE_MOMENTUM_LONG'
  | 'PREEMPTIVE_HEDGE_SHORT'
  | 'EXIT_HEDGE_REVERSAL'
  | 'HOLD_MONITOR';

export interface CrossPlatformFeedSignal {
  id: string;
  platform: 'X' | 'CRYPTOPANIC' | 'EXCHANGE_NOTICE';
  handle: string;
  headline: string;
  symbols: string[];
  sentiment: 'PANIC_FUD' | 'BULLISH_CATALYST' | 'NEUTRAL';
  credibilityWeight: number; // 0..1
  timestamp: string;
}

export interface SentinelPreemptiveTrade {
  id: string;
  symbol: string;
  action: SentinelPreemptiveAction;
  direction: 'BUY' | 'SELL';
  marketType: 'SPOT' | 'USD_M_FUTURES';
  entryPrice: number;
  stopLoss: number;
  stopLossPct: number; // strictly <= 5.0
  trailingTakeProfit5xAtr: number;
  atr14: number;
  reason: string;
  verificationStatus: SentinelVerificationStatus;
  regime: SentinelThreatRegime;
  timestamp: string;
}

export interface SentinelAssessment {
  symbol: string;
  liveWsPrice: number;
  regime: SentinelThreatRegime;
  verificationStatus: SentinelVerificationStatus;
  recommendedAction: SentinelPreemptiveAction;
  threatScore: number; // 0..100
  wsVelocityPct: number; // recent short-window move %
  volumeSpikeRatio: number;
  reversalConfirmed: boolean;
  xCrossVerifiedCount: number;
  newsFudCount: number;
  matchedSignals: CrossPlatformFeedSignal[];
  preemptivePlan: SentinelPreemptiveTrade | null;
  summary: string;
  evaluatedAt: string;
}

const PANIC_FUD_TERMS = [
  'hack',
  'exploit',
  'insolven',
  'bankrupt',
  'sec',
  'lawsuit',
  'depeg',
  'halt',
  'freeze',
  'outflow panic',
  'liquidation cascade',
  'flash crash',
  'rug',
  'delist',
  'outage',
];

const BULLISH_CATALYST_TERMS = [
  'etf',
  'approved',
  'approval',
  'inflow',
  'institutional',
  'adoption',
  'treasury',
  'partnership',
  'upgrade',
  'short squeeze',
  'accumulation',
  'breakout',
];

export function classifyHeadlineSentiment(
  title: string
): CrossPlatformFeedSignal['sentiment'] {
  const lower = title.toLowerCase();
  if (PANIC_FUD_TERMS.some((t) => lower.includes(t))) return 'PANIC_FUD';
  if (BULLISH_CATALYST_TERMS.some((t) => lower.includes(t))) return 'BULLISH_CATALYST';
  return 'NEUTRAL';
}

export function newsItemsToCrossPlatformSignals(
  newsItems: NewsItem[]
): CrossPlatformFeedSignal[] {
  return newsItems.map((item) => {
    const classified = classifyHeadlineSentiment(item.title);
    const sentiment =
      classified !== 'NEUTRAL'
        ? classified
        : item.sentiment === 'negative'
        ? 'PANIC_FUD'
        : item.sentiment === 'positive'
        ? 'BULLISH_CATALYST'
        : 'NEUTRAL';

    const sourceLower = item.source.toLowerCase();
    const isXFeed =
      sourceLower.includes('x ') ||
      sourceLower.includes('twitter') ||
      sourceLower.startsWith('@') ||
      sourceLower.includes('whale') ||
      sourceLower.includes('lookonchain');

    return {
      id: `cp_${item.id}`,
      platform: isXFeed ? 'X' : 'CRYPTOPANIC',
      handle: isXFeed ? item.source : `@${item.source.replace(/\s+/g, '')}`,
      headline: item.title,
      symbols: item.currencies.map((c) => c.toUpperCase()),
      sentiment,
      credibilityWeight: item.important ? 0.92 : isXFeed ? 0.85 : 0.78,
      timestamp: item.publishedAt,
    };
  });
}

/**
 * Evaluates live WebSocket price velocity, volume bursts, L2 order book imbalance,
 * and cross-platform (X + CryptoPanic) news verification to drive preemptive Sentinel trades
 * or reversal exits.
 */
export function evaluateSentinelAgent(params: {
  symbol: string;
  liveWsPrice: number;
  change24hPercent?: number;
  candles: Candle[];
  crossPlatformSignals?: CrossPlatformFeedSignal[];
  newsItems?: NewsItem[];
  depthAnalysis?: MultiExchangeDepthAnalysis;
  hasActiveHedge?: boolean;
}): SentinelAssessment {
  const cleanSymbol = params.symbol.toUpperCase();
  const baseAsset = cleanSymbol.replace(/USDT$/i, '');
  const livePrice =
    params.liveWsPrice > 0
      ? params.liveWsPrice
      : params.candles[params.candles.length - 1]?.close ?? 100;

  const recentCandles = params.candles.slice(-24);
  const lastCandle = recentCandles[recentCandles.length - 1];
  const prev3Close =
    recentCandles[Math.max(0, recentCandles.length - 4)]?.close ?? livePrice;

  // Short-window WS velocity relative to 3 bars prior
  const shortVelocityPct =
    prev3Close > 0 ? ((livePrice - prev3Close) / prev3Close) * 100 : 0;
  const longVelocity = params.change24hPercent ?? shortVelocityPct;

  const avgVol =
    recentCandles.length > 1
      ? recentCandles
          .slice(0, -1)
          .reduce((acc, c) => acc + c.volume, 0) /
        Math.max(1, recentCandles.length - 1)
      : lastCandle?.volume || 1;
  const volumeSpikeRatio =
    avgVol > 0 && lastCandle
      ? Number((lastCandle.volume / avgVol).toFixed(2))
      : 1.0;

  // Cross-platform feed correlation
  const allSignals = [
    ...(params.crossPlatformSignals ?? []),
    ...newsItemsToCrossPlatformSignals(params.newsItems ?? []),
  ];
  const matchedSignals = allSignals.filter(
    (s) =>
      s.symbols.length === 0 ||
      s.symbols.includes(baseAsset) ||
      s.symbols.includes(cleanSymbol) ||
      s.headline.toUpperCase().includes(baseAsset)
  );

  const panicPosts = matchedSignals.filter((s) => s.sentiment === 'PANIC_FUD');
  const bullPosts = matchedSignals.filter((s) => s.sentiment === 'BULLISH_CATALYST');
  const xCrossVerifiedCount = matchedSignals.filter((s) => s.platform === 'X').length;
  const newsFudCount = panicPosts.length;

  const obi = params.depthAnalysis?.netOrderBookImbalance ?? 0;

  // Detect structural market reversal (recovering after panic/dump)
  const reversalConfirmed =
    Boolean(params.hasActiveHedge) &&
    shortVelocityPct >= 1.1 &&
    obi >= 0.08;

  // Classify pump/dump/panic anomalies
  const isDumpVelocity = shortVelocityPct <= -2.1 || (longVelocity <= -6.5 && obi <= -0.1);
  const isPumpVelocity = shortVelocityPct >= 2.2 || (longVelocity >= 7.5 && obi >= 0.12);
  const hasHighPanicFud = panicPosts.length >= 1 && (shortVelocityPct <= -1.2 || obi <= -0.08);

  let regime: SentinelThreatRegime = 'NORMAL';
  if (reversalConfirmed) {
    regime = 'REVERSAL_CONFIRMED';
  } else if (hasHighPanicFud && isDumpVelocity) {
    regime = 'PANIC_FUD';
  } else if (isDumpVelocity || (volumeSpikeRatio >= 1.8 && shortVelocityPct <= -1.5)) {
    regime = 'DUMP_ALERT';
  } else if (isPumpVelocity || (bullPosts.length >= 1 && volumeSpikeRatio >= 1.65 && shortVelocityPct >= 1.4)) {
    regime = 'PUMP_SURGE';
  }

  // Verification gate: cross-platform (X + news >=2 or high-credibility X + price move)
  let verificationStatus: SentinelVerificationStatus = 'UNVERIFIED_NOISE';
  const distinctPlatforms = new Set(matchedSignals.map((s) => s.platform));
  const priceCorroborated =
    Math.abs(shortVelocityPct) >= 1.5 ||
    volumeSpikeRatio >= 1.65 ||
    Math.abs(obi) >= 0.15;

  if (
    (distinctPlatforms.size >= 2 || xCrossVerifiedCount >= 1) &&
    priceCorroborated &&
    matchedSignals.length >= 1
  ) {
    verificationStatus = 'VERIFIED_CROSS_PLATFORM';
  } else if (priceCorroborated && (matchedSignals.length >= 1 || Math.abs(obi) >= 0.18)) {
    verificationStatus = 'PRICE_CORROBORATED';
  }

  let recommendedAction: SentinelPreemptiveAction = 'HOLD_MONITOR';
  if (regime === 'REVERSAL_CONFIRMED') {
    recommendedAction = 'EXIT_HEDGE_REVERSAL';
  } else if (
    (regime === 'PANIC_FUD' || regime === 'DUMP_ALERT') &&
    verificationStatus !== 'UNVERIFIED_NOISE'
  ) {
    recommendedAction = 'PREEMPTIVE_HEDGE_SHORT';
  } else if (regime === 'PUMP_SURGE' && verificationStatus !== 'UNVERIFIED_NOISE') {
    recommendedAction = 'PREEMPTIVE_MOMENTUM_LONG';
  }

  const rawThreatScore =
    Math.abs(shortVelocityPct) * 11 +
    Math.max(0, volumeSpikeRatio - 1) * 18 +
    newsFudCount * 16 +
    bullPosts.length * 10 +
    Math.abs(obi) * 35;
  const threatScore = Math.min(99, Math.max(8, Math.round(rawThreatScore)));

  const atr14 = Math.max(computeATR(params.candles, 14), livePrice * 0.008);
  let preemptivePlan: SentinelPreemptiveTrade | null = null;

  if (
    recommendedAction === 'PREEMPTIVE_MOMENTUM_LONG' ||
    recommendedAction === 'PREEMPTIVE_HEDGE_SHORT'
  ) {
    const direction: 'BUY' | 'SELL' =
      recommendedAction === 'PREEMPTIVE_MOMENTUM_LONG' ? 'BUY' : 'SELL';
    const rawSl = direction === 'BUY' ? livePrice - atr14 * 1.4 : livePrice + atr14 * 1.4;
    const cappedSl = enforceMaxStopLossCap(livePrice, direction, rawSl, 2.0);
    const slPct = Number(((Math.abs(livePrice - cappedSl) / livePrice) * 100).toFixed(2));
    const riskDist = Math.max(Math.abs(livePrice - cappedSl), livePrice * 0.002);
    const trailingTp5xAtr =
      direction === 'BUY'
        ? Number((livePrice + Math.max(atr14 * 5.0, riskDist * 5.0)).toPrecision(6))
        : Number(
            Math.max(livePrice * 0.15, livePrice - Math.max(atr14 * 5.0, riskDist * 5.0)).toPrecision(6)
          );

    preemptivePlan = {
      id: `sent_${cleanSymbol}_${direction}_${Date.now()}`,
      symbol: cleanSymbol,
      action: recommendedAction,
      direction,
      marketType: direction === 'SELL' ? 'USD_M_FUTURES' : 'SPOT',
      entryPrice: Number(livePrice.toPrecision(6)),
      stopLoss: cappedSl,
      stopLossPct: slPct,
      trailingTakeProfit5xAtr: trailingTp5xAtr,
      atr14,
      reason:
        direction === 'SELL'
          ? `Sentinel Preemptive Crash Hedge (${verificationStatus}): ${shortVelocityPct.toFixed(2)}% WS drop · ${newsFudCount} FUD triggers · OBI ${(obi * 100).toFixed(1)}%.`
          : `Sentinel Preemptive Momentum Entry (${verificationStatus}): +${shortVelocityPct.toFixed(2)}% WS surge · ${volumeSpikeRatio}x vol · OBI +${(obi * 100).toFixed(1)}%.`,
      verificationStatus,
      regime,
      timestamp: new Date().toISOString(),
    };
  }

  const summary =
    regime === 'NORMAL'
      ? `Sentinel nominal on ${cleanSymbol}: WS velocity ${shortVelocityPct >= 0 ? '+' : ''}${shortVelocityPct.toFixed(2)}%, ${matchedSignals.length} verified mentions, zero panic/FUD cascade.`
      : regime === 'REVERSAL_CONFIRMED'
      ? `Structural reversal confirmed on ${cleanSymbol} (+${shortVelocityPct.toFixed(2)}% WS rebound, OBI +${(obi * 100).toFixed(1)}%) — closing crash hedges and rotating trend bias.`
      : preemptivePlan?.reason ||
        `Sentinel detected ${regime} on ${cleanSymbol} (${verificationStatus}) — awaiting stronger L2 book/WS confirmation.`;

  return {
    symbol: cleanSymbol,
    liveWsPrice: livePrice,
    regime,
    verificationStatus,
    recommendedAction,
    threatScore,
    wsVelocityPct: Number(shortVelocityPct.toFixed(2)),
    volumeSpikeRatio,
    reversalConfirmed,
    xCrossVerifiedCount,
    newsFudCount,
    matchedSignals: matchedSignals.slice(0, 6),
    preemptivePlan,
    summary,
    evaluatedAt: new Date().toISOString(),
  };
}

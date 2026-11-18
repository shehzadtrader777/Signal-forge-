export interface CoinMeta {
  symbol: string;
  baseAsset: string;
  name: string;
  referencePrice: number;
  dailyVolatility: number;
}

export interface Candle {
  time: number; // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TickerSnapshot {
  symbol: string;
  baseAsset: string;
  name: string;
  price: number;
  change24hPercent: number;
  high24h: number;
  low24h: number;
  volume24hUsd: number;
  isLiveWs: boolean;
}

export type AccumulationPhase =
  | 'PRE_PUMP_ACCUMULATION'
  | 'EARLY_BREAKOUT'
  | 'MOMENTUM_LEADER';

export interface TopGainerCoin {
  symbol: string;
  baseAsset: string;
  name: string;
  price: number;
  change24hPercent: number;
  high24h: number;
  low24h: number;
  volume24hUsd: number;
  gainerRank: number;
  isTopGainer: true;
  isLiveWs?: boolean;
  prePumpScore?: number;
  volumeAnomalyRatio?: number;
  accumulationPhase?: AccumulationPhase;
  institutionalConviction?: 'HIGH' | 'ELEVATED' | 'STANDARD';
  dynamicLeverageCap?: number;
  wideTrailAtrMult?: number;
}

export interface GainerAlertEvent {
  id: string;
  symbol: string;
  baseAsset: string;
  price: number;
  change24hPercent: number;
  volume24hUsd: number;
  gainerRank: number;
  reason: string;
  timestamp: string;
}

export type Timeframe = '15m' | '1h' | '4h' | '1d';

export const TRACKED_COINS: CoinMeta[] = [
  { symbol: 'BTCUSDT', baseAsset: 'BTC', name: 'Bitcoin', referencePrice: 91420, dailyVolatility: 0.024 },
  { symbol: 'ETHUSDT', baseAsset: 'ETH', name: 'Ethereum', referencePrice: 3285, dailyVolatility: 0.031 },
  { symbol: 'SOLUSDT', baseAsset: 'SOL', name: 'Solana', referencePrice: 214.6, dailyVolatility: 0.044 },
  { symbol: 'BNBUSDT', baseAsset: 'BNB', name: 'BNB', referencePrice: 632.4, dailyVolatility: 0.026 },
  { symbol: 'XRPUSDT', baseAsset: 'XRP', name: 'XRP', referencePrice: 1.148, dailyVolatility: 0.048 },
  { symbol: 'AVAXUSDT', baseAsset: 'AVAX', name: 'Avalanche', referencePrice: 38.75, dailyVolatility: 0.045 },
  { symbol: 'LINKUSDT', baseAsset: 'LINK', name: 'Chainlink', referencePrice: 16.42, dailyVolatility: 0.039 },
  { symbol: 'ADAUSDT', baseAsset: 'ADA', name: 'Cardano', referencePrice: 0.742, dailyVolatility: 0.041 },
  { symbol: 'DOGEUSDT', baseAsset: 'DOGE', name: 'Dogecoin', referencePrice: 0.368, dailyVolatility: 0.056 },
  { symbol: 'NEARUSDT', baseAsset: 'NEAR', name: 'NEAR Protocol', referencePrice: 5.94, dailyVolatility: 0.047 },
];

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '15m': 15 * 60,
  '1h': 60 * 60,
  '4h': 4 * 60 * 60,
  '1d': 24 * 60 * 60,
};

export function formatCryptoPrice(price: number): string {
  if (!Number.isFinite(price)) return '0.00';
  if (price >= 1000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (price >= 10) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  }
  if (price >= 1) {
    return price.toFixed(4);
  }
  if (price >= 0.01) {
    return price.toFixed(5);
  }
  return price.toFixed(7);
}

export function formatCompactUsd(amount: number): string {
  if (!Number.isFinite(amount)) return '$0';
  if (amount >= 1e9) return `$${(amount / 1e9).toFixed(2)}B`;
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(2)}M`;
  if (amount >= 1e3) return `$${(amount / 1e3).toFixed(1)}K`;
  return `$${amount.toFixed(2)}`;
}

// Deterministic PRNG for fallback market candles so indicators & charts remain consistent
function createSeededRng(seedStr: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateDeterministicCandles(
  symbol: string,
  timeframe: Timeframe,
  count = 160,
  anchorEndTimeSec?: number,
  referencePriceOverride?: number
): Candle[] {
  const known = TRACKED_COINS.find((c) => c.symbol === symbol);
  const coin: CoinMeta = known || {
    symbol,
    baseAsset: symbol.replace(/USDT$/i, ''),
    name: symbol.replace(/USDT$/i, ''),
    referencePrice:
      referencePriceOverride && referencePriceOverride > 0 ? referencePriceOverride : 12.4,
    dailyVolatility: 0.055,
  };
  const stepSec = TIMEFRAME_SECONDS[timeframe];
  const nowSec = anchorEndTimeSec ?? Math.floor(Date.now() / 1000 / stepSec) * stepSec;
  const rng = createSeededRng(`${symbol}_${timeframe}_v2`);

  // Shape distinct directional bias per coin so the Signal Engine discovers realistic BUY and SELL setups
  const biasMap: Record<string, number> = {
    BTCUSDT: 0.0014,
    ETHUSDT: 0.0011,
    SOLUSDT: 0.0021,
    BNBUSDT: 0.0005,
    XRPUSDT: -0.0016,
    AVAXUSDT: 0.0013,
    LINKUSDT: 0.0017,
    ADAUSDT: -0.0012,
    DOGEUSDT: -0.0019,
    NEARUSDT: 0.0009,
  };
  const drift = (biasMap[coin.symbol] ?? 0.0022) * Math.sqrt(stepSec / 3600);
  const vol = (coin.dailyVolatility / Math.sqrt(24)) * Math.sqrt(stepSec / 3600);

  const candles: Candle[] = [];
  const startBase =
    referencePriceOverride && referencePriceOverride > 0
      ? referencePriceOverride
      : coin.referencePrice;
  let price = startBase * 0.92;

  for (let i = 0; i < count; i++) {
    const time = nowSec - (count - 1 - i) * stepSec;
    const wave = Math.sin(i * 0.19) * vol * 0.65;
    const shock = (rng() - 0.48) * vol * 1.9;
    // Last 18 candles amplify trend momentum to create clear signal trigger
    const lateBoost = i > count - 18 ? drift * 2.1 : drift;
    const ret = lateBoost + wave + shock;

    const open = price;
    const close = Math.max(open * 0.5, open * (1 + ret));
    const spread = Math.abs(close - open) + open * vol * (0.35 + rng() * 0.65);
    const high = Math.max(open, close) + spread * (0.35 + rng() * 0.5);
    const low = Math.max(open * 0.4, Math.min(open, close) - spread * (0.35 + rng() * 0.5));
    const volume = (startBase >= 1000 ? 1200 : 45000) * (0.6 + rng() * 1.8);

    candles.push({
      time,
      open: Number(open.toPrecision(6)),
      high: Number(high.toPrecision(6)),
      low: Number(low.toPrecision(6)),
      close: Number(close.toPrecision(6)),
      volume: Number(volume.toFixed(2)),
    });
    price = close;
  }

  return candles;
}

export async function fetchCoinCandles(
  symbol: string,
  timeframe: Timeframe,
  limit = 160,
  referencePrice?: number,
  externalSignal?: AbortSignal
): Promise<{ candles: Candle[]; source: 'binance' | 'cache' }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
  try {
    const refQuery =
      referencePrice && Number.isFinite(referencePrice) && referencePrice > 0
        ? `&refPrice=${encodeURIComponent(String(referencePrice))}`
        : '';
    const res = await fetch(
      `/api/binance/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}&limit=${limit}&market=spot${refQuery}`,
      { signal: controller.signal }
    );
    if (res.ok) {
      const payload = await res.json();
      if (Array.isArray(payload.candles) && payload.candles.length >= 40) {
        return {
          candles: payload.candles,
          source:
            payload.source === 'binance' || payload.source === 'binance_futures'
              ? 'binance'
              : 'cache',
        };
      }
    }
  } catch {
    // Fallback to deterministic local candles below
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  return {
    candles: generateDeterministicCandles(symbol, timeframe, limit, undefined, referencePrice),
    source: 'cache',
  };
}

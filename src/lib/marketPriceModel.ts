export type MarketExchangeId = 'binance' | 'bybit' | 'okx' | 'kraken';

export type CanonicalMarketType = 'SPOT' | 'FUTURES';

export type MarketPriceType =
  | 'LAST_TRADED'
  | 'BID'
  | 'ASK'
  | 'MARK'
  | 'PAPER_EXECUTION';

export type MarketDataSourceClass =
  | 'LIVE_WS_VERIFIED'
  | 'REST_FALLBACK_VERIFIED'
  | 'CACHED_SIMULATED'
  | 'DEMO_SYNTHETIC';

export type DataFreshnessStatus =
  | 'FRESH'
  | 'DELAYED'
  | 'STALE'
  | 'INVALID_TIMESTAMP';

export type WsConnectionHealth =
  | 'CONNECTED'
  | 'DELAYED'
  | 'STALE'
  | 'RECONNECTING'
  | 'DISCONNECTED'
  | 'CIRCUIT_OPEN';

export const MARKET_FRESHNESS_THRESHOLDS_MS = Object.freeze({
  delayedAfterMs: 5_000,
  staleAfterMs: 15_000,
  maxFutureSkewMs: 5_000,
});

export const BOUNDED_BACKOFF_CONFIG = Object.freeze({
  baseDelayMs: 350,
  maxDelayMs: 30_000,
  multiplier: 2,
});

export interface CanonicalSymbolParts {
  readonly canonical: string; // e.g. BTC/USDT
  readonly compact: string; // e.g. BTCUSDT
  readonly baseAsset: string; // e.g. BTC
  readonly quoteCurrency: string; // e.g. USDT
}

export interface CanonicalPriceObservation {
  readonly symbol: string; // e.g. BTC/USDT
  readonly compactSymbol: string; // e.g. BTCUSDT
  readonly baseAsset: string;
  readonly quoteCurrency: string;
  readonly exchange: MarketExchangeId;
  readonly marketType: CanonicalMarketType;
  readonly priceType: MarketPriceType;
  readonly lastTradedPrice: number;
  readonly bidPrice: number | null;
  readonly askPrice: number | null;
  readonly markPrice: number | null;
  readonly spreadBps: number | null;
  readonly sourceClass: MarketDataSourceClass;
  readonly sourceLabel: string;
  readonly isLiveVerified: boolean;
  readonly isSimulatedOrDemo: boolean;
  readonly observedAtMs: number;
  readonly observedAtIso: string;
  readonly receivedAtMs: number;
  readonly receivedAtIso: string;
}

export interface ObservationValidationResult {
  readonly valid: boolean;
  readonly freshness: DataFreshnessStatus;
  readonly ageMs: number;
  readonly reasons: readonly string[];
}

export interface SimulatedPaperExecutionQuote {
  readonly valid: boolean;
  readonly rejectionReason: string | null;
  readonly symbol: string;
  readonly marketType: CanonicalMarketType;
  readonly exchange: MarketExchangeId;
  readonly side: 'BUY' | 'SELL';
  readonly priceType: 'PAPER_EXECUTION';
  readonly referencePriceType: 'ASK' | 'BID';
  readonly lastTradedPrice: number;
  readonly bidPrice: number;
  readonly askPrice: number;
  readonly markPrice: number | null;
  readonly paperExecutionPrice: number;
  readonly spreadBps: number;
  readonly slippageBps: number;
  readonly feeRate: number;
  readonly feeUsd: number;
  readonly quantity: number;
  readonly notionalUsd: number;
  readonly priceSource: string;
  readonly sourceClass: MarketDataSourceClass;
  readonly priceTimestampIso: string;
  readonly profitClass: 'SIMULATED_PAPER_ONLY';
  readonly isRealProfit: false;
}

export interface ChartVsMarketComparison {
  readonly symbol: string;
  readonly marketType: CanonicalMarketType;
  readonly chartClosePrice: number;
  readonly marketLastTradedPrice: number;
  readonly discrepancyBps: number;
  readonly discrepancyPct: number;
  readonly unintendedDiscrepancy: boolean;
  readonly shouldSyncChartToMarket: boolean;
  readonly reason: string;
}

const KNOWN_QUOTES = ['USDT', 'USDC', 'BUSD', 'USD', 'BTC', 'ETH'] as const;

export function normalizeCanonicalSymbol(rawSymbol: string): CanonicalSymbolParts | null {
  const cleaned = String(rawSymbol || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9/]/g, '');
  if (!cleaned) return null;

  if (cleaned.includes('/')) {
    const parts = cleaned.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const baseAsset = parts[0];
    const quoteCurrency = parts[1];
    return {
      canonical: `${baseAsset}/${quoteCurrency}`,
      compact: `${baseAsset}${quoteCurrency}`,
      baseAsset,
      quoteCurrency,
    };
  }

  for (const quote of KNOWN_QUOTES) {
    if (cleaned.endsWith(quote) && cleaned.length > quote.length) {
      const baseAsset = cleaned.slice(0, cleaned.length - quote.length);
      return {
        canonical: `${baseAsset}/${quote}`,
        compact: cleaned,
        baseAsset,
        quoteCurrency: quote,
      };
    }
  }

  return null;
}

export function isSourceClassSimulatedOrDemo(sourceClass: MarketDataSourceClass): boolean {
  return sourceClass === 'CACHED_SIMULATED' || sourceClass === 'DEMO_SYNTHETIC';
}

export function computeSpreadBps(bidPrice: number, askPrice: number): number | null {
  if (
    !Number.isFinite(bidPrice) ||
    !Number.isFinite(askPrice) ||
    bidPrice <= 0 ||
    askPrice <= 0 ||
    askPrice < bidPrice
  ) {
    return null;
  }
  const mid = (bidPrice + askPrice) / 2;
  if (mid <= 0) return null;
  return Number((((askPrice - bidPrice) / mid) * 10_000).toFixed(4));
}

export function buildCanonicalPriceObservation(input: {
  symbol: string;
  exchange: MarketExchangeId;
  marketType: CanonicalMarketType;
  priceType?: MarketPriceType;
  lastTradedPrice: number;
  bidPrice?: number | null;
  askPrice?: number | null;
  markPrice?: number | null;
  sourceClass: MarketDataSourceClass;
  sourceLabel?: string;
  observedAtMs: number;
  receivedAtMs?: number;
}): CanonicalPriceObservation | null {
  const parts = normalizeCanonicalSymbol(input.symbol);
  if (!parts) return null;
  if (!Number.isFinite(input.lastTradedPrice) || input.lastTradedPrice <= 0) return null;
  if (!Number.isFinite(input.observedAtMs) || input.observedAtMs <= 0) return null;

  const receivedAtMs =
    input.receivedAtMs !== undefined &&
    Number.isFinite(input.receivedAtMs) &&
    input.receivedAtMs > 0
      ? input.receivedAtMs
      : input.observedAtMs;

  const bidPrice =
    input.bidPrice !== undefined &&
    input.bidPrice !== null &&
    Number.isFinite(input.bidPrice) &&
    input.bidPrice > 0
      ? input.bidPrice
      : null;
  const askPrice =
    input.askPrice !== undefined &&
    input.askPrice !== null &&
    Number.isFinite(input.askPrice) &&
    input.askPrice > 0
      ? input.askPrice
      : null;

  if (bidPrice !== null && askPrice !== null && askPrice < bidPrice) {
    return null;
  }

  // Keep Mark Price distinct from Last Traded Price when explicit mark or book midpoint exists
  const explicitMark =
    input.markPrice !== undefined &&
    input.markPrice !== null &&
    Number.isFinite(input.markPrice) &&
    input.markPrice > 0
      ? input.markPrice
      : null;
  const derivedMidMark =
    explicitMark !== null
      ? explicitMark
      : bidPrice !== null && askPrice !== null
        ? Number(((bidPrice + askPrice) / 2).toPrecision(8))
        : null;

  const spreadBps =
    bidPrice !== null && askPrice !== null ? computeSpreadBps(bidPrice, askPrice) : null;

  const isSimulatedOrDemo = isSourceClassSimulatedOrDemo(input.sourceClass);
  const isLiveVerified = input.sourceClass === 'LIVE_WS_VERIFIED';

  const defaultLabel =
    input.sourceClass === 'LIVE_WS_VERIFIED'
      ? `${input.exchange.toUpperCase()} ${input.marketType} Live WS`
      : input.sourceClass === 'REST_FALLBACK_VERIFIED'
        ? `${input.exchange.toUpperCase()} ${input.marketType} REST Fallback`
        : input.sourceClass === 'CACHED_SIMULATED'
          ? 'Cached / Simulated Fallback (Not Live)'
          : 'Demo Synthetic Price (Not Live)';

  return {
    symbol: parts.canonical,
    compactSymbol: parts.compact,
    baseAsset: parts.baseAsset,
    quoteCurrency: parts.quoteCurrency,
    exchange: input.exchange,
    marketType: input.marketType,
    priceType: input.priceType ?? 'LAST_TRADED',
    lastTradedPrice: input.lastTradedPrice,
    bidPrice,
    askPrice,
    markPrice: derivedMidMark,
    spreadBps,
    sourceClass: input.sourceClass,
    sourceLabel: input.sourceLabel ?? defaultLabel,
    isLiveVerified,
    isSimulatedOrDemo,
    observedAtMs: input.observedAtMs,
    observedAtIso: new Date(input.observedAtMs).toISOString(),
    receivedAtMs,
    receivedAtIso: new Date(receivedAtMs).toISOString(),
  };
}

export function evaluateTimestampFreshness(
  observedAtMs: number,
  nowMs: number = Date.now(),
  maxStaleMs: number = MARKET_FRESHNESS_THRESHOLDS_MS.staleAfterMs
): { freshness: DataFreshnessStatus; ageMs: number; reason: string } {
  if (!Number.isFinite(observedAtMs) || observedAtMs <= 0 || !Number.isFinite(nowMs)) {
    return {
      freshness: 'INVALID_TIMESTAMP',
      ageMs: Number.POSITIVE_INFINITY,
      reason: 'Missing or non-finite observation timestamp.',
    };
  }
  if (observedAtMs > nowMs + MARKET_FRESHNESS_THRESHOLDS_MS.maxFutureSkewMs) {
    return {
      freshness: 'INVALID_TIMESTAMP',
      ageMs: nowMs - observedAtMs,
      reason: `Observation timestamp is in the future (${observedAtMs - nowMs}ms ahead).`,
    };
  }
  const ageMs = Math.max(0, nowMs - observedAtMs);
  if (ageMs > maxStaleMs) {
    return {
      freshness: 'STALE',
      ageMs,
      reason: `Market observation is stale (${ageMs}ms old > ${maxStaleMs}ms limit).`,
    };
  }
  if (ageMs > MARKET_FRESHNESS_THRESHOLDS_MS.delayedAfterMs) {
    return {
      freshness: 'DELAYED',
      ageMs,
      reason: `Market observation is delayed (${ageMs}ms old).`,
    };
  }
  return {
    freshness: 'FRESH',
    ageMs,
    reason: `Fresh UTC observation (${ageMs}ms old).`,
  };
}

export function validateMarketObservation(
  observation: CanonicalPriceObservation | null | undefined,
  expected: {
    symbol: string;
    exchange?: MarketExchangeId;
    marketType?: CanonicalMarketType;
    quoteCurrency?: string;
    requireVerifiedNonSimulated?: boolean;
    maxStaleMs?: number;
  },
  nowMs: number = Date.now()
): ObservationValidationResult {
  const reasons: string[] = [];
  if (!observation) {
    return {
      valid: false,
      freshness: 'INVALID_TIMESTAMP',
      ageMs: Number.POSITIVE_INFINITY,
      reasons: ['Missing market price observation.'],
    };
  }

  const expectedParts = normalizeCanonicalSymbol(expected.symbol);
  if (!expectedParts || observation.compactSymbol !== expectedParts.compact) {
    reasons.push(
      `Symbol mismatch: observation is "${observation.symbol}" but expected "${expected.symbol}".`
    );
  }
  if (expected.exchange && observation.exchange !== expected.exchange) {
    reasons.push(
      `Exchange mismatch: observation is "${observation.exchange}" but expected "${expected.exchange}".`
    );
  }
  if (expected.marketType && observation.marketType !== expected.marketType) {
    reasons.push(
      `Market type mismatch: observation is "${observation.marketType}" but expected "${expected.marketType}".`
    );
  }
  if (
    expected.quoteCurrency &&
    observation.quoteCurrency.toUpperCase() !== expected.quoteCurrency.toUpperCase()
  ) {
    reasons.push(
      `Quote currency mismatch: observation uses "${observation.quoteCurrency}" but expected "${expected.quoteCurrency}".`
    );
  }
  if (!Number.isFinite(observation.lastTradedPrice) || observation.lastTradedPrice <= 0) {
    reasons.push('Invalid non-positive or non-finite lastTradedPrice.');
  }
  if (
    observation.bidPrice !== null &&
    observation.askPrice !== null &&
    observation.askPrice < observation.bidPrice
  ) {
    reasons.push(
      `Inverted Bid/Ask spread: ask (${observation.askPrice}) < bid (${observation.bidPrice}).`
    );
  }

  if (expected.requireVerifiedNonSimulated && observation.isSimulatedOrDemo) {
    reasons.push(
      `Blocked simulated/cached price source ("${observation.sourceClass}") from being treated as a verified live market observation.`
    );
  }

  const tsEval = evaluateTimestampFreshness(
    observation.observedAtMs,
    nowMs,
    expected.maxStaleMs ?? MARKET_FRESHNESS_THRESHOLDS_MS.staleAfterMs
  );
  if (tsEval.freshness === 'STALE' || tsEval.freshness === 'INVALID_TIMESTAMP') {
    reasons.push(tsEval.reason);
  }

  return {
    valid: reasons.length === 0,
    freshness: tsEval.freshness,
    ageMs: tsEval.ageMs,
    reasons,
  };
}

/**
 * Computes a realistic simulated Paper Execution Price from a validated market observation:
 * - BUY executes on Ask + slippage
 * - SELL executes on Bid - slippage
 * Never forces Paper Execution Price to equal Last Traded Price or Mark Price.
 * Rejects stale, missing, invalid, mismatched, or cached/demo-only prices.
 */
export function computeSimulatedPaperExecutionQuote(params: {
  symbol: string;
  exchange: MarketExchangeId;
  marketType: CanonicalMarketType;
  side: 'BUY' | 'SELL';
  stakeUsd: number;
  leverage: number;
  takerFeeRate: number;
  slippageBps?: number;
  defaultHalfSpreadBps?: number;
  observation: CanonicalPriceObservation | null | undefined;
  nowMs?: number;
  maxStaleMs?: number;
}): SimulatedPaperExecutionQuote {
  const nowMs = params.nowMs ?? Date.now();
  const slippageBps = Math.max(0.5, Number.isFinite(params.slippageBps) ? Number(params.slippageBps) : 2.0);
  const fallbackHalfSpreadBps = Math.max(
    0.5,
    Number.isFinite(params.defaultHalfSpreadBps) ? Number(params.defaultHalfSpreadBps) : 1.0
  );

  const check = validateMarketObservation(
    params.observation,
    {
      symbol: params.symbol,
      exchange: params.exchange,
      marketType: params.marketType,
      requireVerifiedNonSimulated: true,
      maxStaleMs: params.maxStaleMs,
    },
    nowMs
  );

  const reject = (reason: string): SimulatedPaperExecutionQuote => ({
    valid: false,
    rejectionReason: reason,
    symbol: params.symbol,
    marketType: params.marketType,
    exchange: params.exchange,
    side: params.side,
    priceType: 'PAPER_EXECUTION',
    referencePriceType: params.side === 'BUY' ? 'ASK' : 'BID',
    lastTradedPrice: params.observation?.lastTradedPrice ?? 0,
    bidPrice: params.observation?.bidPrice ?? 0,
    askPrice: params.observation?.askPrice ?? 0,
    markPrice: params.observation?.markPrice ?? null,
    paperExecutionPrice: 0,
    spreadBps: params.observation?.spreadBps ?? 0,
    slippageBps,
    feeRate: params.takerFeeRate,
    feeUsd: 0,
    quantity: 0,
    notionalUsd: 0,
    priceSource: params.observation?.sourceLabel ?? 'UNAVAILABLE',
    sourceClass: params.observation?.sourceClass ?? 'CACHED_SIMULATED',
    priceTimestampIso: params.observation?.observedAtIso ?? '',
    profitClass: 'SIMULATED_PAPER_ONLY',
    isRealProfit: false,
  });

  if (!check.valid || !params.observation) {
    return reject(check.reasons.join(' '));
  }
  if (!Number.isFinite(params.stakeUsd) || params.stakeUsd < 10) {
    return reject('Stake USD must be at least $10.00.');
  }
  if (!Number.isFinite(params.takerFeeRate) || params.takerFeeRate <= 0) {
    return reject('Realistic positive takerFeeRate is required for Paper Trading.');
  }

  const obs = params.observation;
  const effectiveBid =
    obs.bidPrice !== null
      ? obs.bidPrice
      : Number((obs.lastTradedPrice * (1 - fallbackHalfSpreadBps / 10_000)).toFixed(6));
  const effectiveAsk =
    obs.askPrice !== null
      ? obs.askPrice
      : Number((obs.lastTradedPrice * (1 + fallbackHalfSpreadBps / 10_000)).toFixed(6));

  if (effectiveAsk < effectiveBid) {
    return reject('Effective Ask price is below Bid price.');
  }

  const effectiveSpreadBps = computeSpreadBps(effectiveBid, effectiveAsk) ?? fallbackHalfSpreadBps * 2;
  const referencePriceType: 'ASK' | 'BID' = params.side === 'BUY' ? 'ASK' : 'BID';
  const baseExecutionPrice = params.side === 'BUY' ? effectiveAsk : effectiveBid;
  const slippageFactor =
    params.side === 'BUY' ? 1 + slippageBps / 10_000 : 1 - slippageBps / 10_000;
  const paperExecutionPrice = Number((baseExecutionPrice * slippageFactor).toFixed(6));

  const effectiveLeverage =
    params.marketType === 'FUTURES'
      ? Math.max(1, Math.min(20, Number.isFinite(params.leverage) ? params.leverage : 1))
      : 1;
  const notionalUsd = Number((params.stakeUsd * effectiveLeverage).toFixed(2));
  const quantity = Number((notionalUsd / paperExecutionPrice).toFixed(6));
  const feeUsd = Number((notionalUsd * params.takerFeeRate).toFixed(4));

  return {
    valid: true,
    rejectionReason: null,
    symbol: obs.symbol,
    marketType: obs.marketType,
    exchange: obs.exchange,
    side: params.side,
    priceType: 'PAPER_EXECUTION',
    referencePriceType,
    lastTradedPrice: obs.lastTradedPrice,
    bidPrice: effectiveBid,
    askPrice: effectiveAsk,
    markPrice: obs.markPrice,
    paperExecutionPrice,
    spreadBps: effectiveSpreadBps,
    slippageBps,
    feeRate: params.takerFeeRate,
    feeUsd,
    quantity,
    notionalUsd,
    priceSource: obs.sourceLabel,
    sourceClass: obs.sourceClass,
    priceTimestampIso: obs.observedAtIso,
    profitClass: 'SIMULATED_PAPER_ONLY',
    isRealProfit: false,
  };
}

/**
 * Compares Chart Close Price vs Market Last Traded Price for the same symbol & market type.
 * Prevents cached/simulated market ticks from overwriting verified live exchange charts.
 */
export function compareChartAndMarketPrice(params: {
  symbol: string;
  marketType: CanonicalMarketType;
  chartClosePrice: number;
  chartSource: 'binance' | 'cache';
  marketObservation: CanonicalPriceObservation;
  discrepancyThresholdBps?: number;
  nowMs?: number;
}): ChartVsMarketComparison {
  const thresholdBps = params.discrepancyThresholdBps ?? 50; // 0.50%
  const obsCheck = validateMarketObservation(
    params.marketObservation,
    {
      symbol: params.symbol,
      marketType: params.marketType,
      requireVerifiedNonSimulated: false,
    },
    params.nowMs
  );

  if (
    !Number.isFinite(params.chartClosePrice) ||
    params.chartClosePrice <= 0 ||
    !Number.isFinite(params.marketObservation.lastTradedPrice) ||
    params.marketObservation.lastTradedPrice <= 0
  ) {
    return {
      symbol: params.symbol,
      marketType: params.marketType,
      chartClosePrice: params.chartClosePrice,
      marketLastTradedPrice: params.marketObservation.lastTradedPrice,
      discrepancyBps: 0,
      discrepancyPct: 0,
      unintendedDiscrepancy: true,
      shouldSyncChartToMarket: false,
      reason: 'Invalid chart close or market price.',
    };
  }

  const discrepancyBps = Number(
    (
      (Math.abs(params.chartClosePrice - params.marketObservation.lastTradedPrice) /
        params.marketObservation.lastTradedPrice) *
      10_000
    ).toFixed(2)
  );
  const discrepancyPct = Number((discrepancyBps / 100).toFixed(4));
  const unintendedDiscrepancy = discrepancyBps > thresholdBps;

  // Never allow a stale or cached/simulated ticker to overwrite verified exchange chart candles
  if (
    params.chartSource === 'binance' &&
    (params.marketObservation.isSimulatedOrDemo || obsCheck.freshness === 'STALE')
  ) {
    return {
      symbol: params.symbol,
      marketType: params.marketType,
      chartClosePrice: params.chartClosePrice,
      marketLastTradedPrice: params.marketObservation.lastTradedPrice,
      discrepancyBps,
      discrepancyPct,
      unintendedDiscrepancy,
      shouldSyncChartToMarket: false,
      reason: 'Protected live exchange chart from being overwritten by stale or cached/simulated market price.',
    };
  }

  const shouldSyncChartToMarket =
    obsCheck.valid && !params.marketObservation.isSimulatedOrDemo && unintendedDiscrepancy;

  return {
    symbol: params.symbol,
    marketType: params.marketType,
    chartClosePrice: params.chartClosePrice,
    marketLastTradedPrice: params.marketObservation.lastTradedPrice,
    discrepancyBps,
    discrepancyPct,
    unintendedDiscrepancy,
    shouldSyncChartToMarket,
    reason: shouldSyncChartToMarket
      ? `Chart close diverged ${discrepancyBps} bps from verified ${params.marketObservation.sourceLabel}; syncing trailing bar.`
      : 'Chart close and market price aligned within tolerance.',
  };
}

/**
 * Bounded exponential backoff for safe WebSocket reconnection (never exceeds maxDelayMs).
 */
export function computeBoundedExponentialBackoffMs(
  attempt: number,
  options?: { baseDelayMs?: number; maxDelayMs?: number; jitterRatio?: number }
): number {
  const safeAttempt = Math.max(0, Math.floor(Number.isFinite(attempt) ? attempt : 0));
  const base = Math.max(100, options?.baseDelayMs ?? BOUNDED_BACKOFF_CONFIG.baseDelayMs);
  const maxDelay = Math.max(base, options?.maxDelayMs ?? BOUNDED_BACKOFF_CONFIG.maxDelayMs);
  const raw = base * Math.pow(BOUNDED_BACKOFF_CONFIG.multiplier, Math.min(safeAttempt, 16));
  const bounded = Math.min(maxDelay, raw);
  const jitterRatio = Math.max(0, Math.min(0.25, options?.jitterRatio ?? 0));
  const jitter = Math.round(bounded * jitterRatio);
  return Math.min(maxDelay, Math.round(bounded + jitter));
}

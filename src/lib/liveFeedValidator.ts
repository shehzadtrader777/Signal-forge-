/**
 * Signal Forge Strict Live Feed Data Validator & Authoritative Execution Price Guard.
 *
 * Pure, zero-I/O, strictly typed domain validation layer (zero `any`) shared across:
 *  - Server live exchange REST & WebSocket ingestion (Binance Spot & USD-M Futures)
 *  - Execution order/close/tick routes (preventing client or operator entry/exit price bypasses)
 *  - Public Signal Stage 2 paper-trade evidence coherence verification
 */

import {
  computeSpreadBps,
  evaluateTimestampFreshness,
  MARKET_FRESHNESS_THRESHOLDS_MS,
  type DataFreshnessStatus,
} from './marketPriceModel';
import {
  DEFAULT_MAX_EXECUTION_SLIPPAGE_PCT,
  validateLiveExecutionPrice,
} from './monitorAgent';
import { validateSpotTickSample } from './spotCmcValidator';

export const MAX_LIVE_BOOK_SPREAD_BPS = 500; // 5.0% hard crossed/broken book sanity ceiling
export const MAX_LAST_VS_MID_DIVERGENCE_PCT = 5.0;
export const MAX_FUTURES_INDEX_BASIS_PCT = 10.0;
export const MAX_ABS_FUNDING_RATE = 0.05; // +/- 5% per 8h interval hard ceiling
export const MAX_ABS_CHANGE_24H_PCT = 10_000;
export const MAX_SINGLE_TICK_JUMP_PCT = 12.0;
export const MAX_BOOK_TICKER_JUMP_PCT = 12.0;

export type AuthoritativeFeedSource = 'binance_spot' | 'binance_futures';

export interface AuthoritativeExecutionPriceInput {
  readonly symbol: string;
  readonly priceKind: 'ENTRY' | 'EXIT';
  readonly serverPrice: number | null | undefined;
  readonly feedSource: string | null | undefined;
  readonly observedAtMs: number | null | undefined;
  readonly submittedPrice?: number | null;
  readonly maxDeviationPct?: number;
  readonly nowMs?: number;
}

export interface AuthoritativeExecutionPriceResult {
  readonly ok: boolean;
  readonly statusCode: number;
  readonly code:
    | 'OK'
    | 'INVALID_SUBMITTED_PRICE'
    | 'UNVERIFIED_FEED_SOURCE'
    | 'STALE_OR_INVALID_TIMESTAMP'
    | 'ENTRY_PRICE_BYPASS_BLOCKED'
    | 'EXIT_PRICE_BYPASS_BLOCKED';
  readonly authoritativePrice: number;
  readonly deviationPct: number;
  readonly freshness: DataFreshnessStatus;
  readonly reason: string;
}

const VERIFIED_LIVE_SOURCES = new Set<string>(['binance_spot', 'binance_futures']);

/**
 * Authoritative execution price invariant:
 * - Neither unauthenticated callers NOR authenticated operators may bypass live
 *   market prices via client-supplied `entryPrice`, `exitPrice`, or override flags.
 * - Rejects cached/simulated/demo fallback feeds and stale or invalid timestamps.
 * - Always resolves the execution price strictly from the verified server feed.
 */
export function verifyAuthoritativeExecutionPrice(
  input: AuthoritativeExecutionPriceInput
): AuthoritativeExecutionPriceResult {
  const nowMs = input.nowMs ?? Date.now();
  const maxDeviationPct =
    input.maxDeviationPct !== undefined &&
    Number.isFinite(input.maxDeviationPct) &&
    input.maxDeviationPct > 0
      ? Math.min(input.maxDeviationPct, 2.0)
      : DEFAULT_MAX_EXECUTION_SLIPPAGE_PCT;

  const cleanSymbol = String(input.symbol || '').trim().toUpperCase();
  const feedSource = String(input.feedSource || '').trim();

  if (
    !VERIFIED_LIVE_SOURCES.has(feedSource) ||
    typeof input.serverPrice !== 'number' ||
    !Number.isFinite(input.serverPrice) ||
    input.serverPrice <= 0
  ) {
    return {
      ok: false,
      statusCode: 503,
      code: 'UNVERIFIED_FEED_SOURCE',
      authoritativePrice: 0,
      deviationPct: 0,
      freshness: 'INVALID_TIMESTAMP',
      reason: `Authoritative live feed unavailable for ${cleanSymbol || 'symbol'} (source: ${feedSource || 'none'}). Cached, simulated, or missing prices cannot be executed.`,
    };
  }

  const observedAtMs = typeof input.observedAtMs === 'number' ? input.observedAtMs : Number.NaN;
  const freshnessEval = evaluateTimestampFreshness(observedAtMs, nowMs);
  if (
    freshnessEval.freshness === 'STALE' ||
    freshnessEval.freshness === 'INVALID_TIMESTAMP'
  ) {
    return {
      ok: false,
      statusCode: 503,
      code: 'STALE_OR_INVALID_TIMESTAMP',
      authoritativePrice: 0,
      deviationPct: 0,
      freshness: freshnessEval.freshness,
      reason: `Execution blocked for ${cleanSymbol}: ${freshnessEval.reason}`,
    };
  }

  // If client supplied a reference price, strictly enforce slippage ceiling even for operators
  if (input.submittedPrice !== undefined && input.submittedPrice !== null) {
    if (
      typeof input.submittedPrice !== 'number' ||
      !Number.isFinite(input.submittedPrice) ||
      input.submittedPrice <= 0
    ) {
      return {
        ok: false,
        statusCode: 400,
        code: 'INVALID_SUBMITTED_PRICE',
        authoritativePrice: input.serverPrice,
        deviationPct: 0,
        freshness: freshnessEval.freshness,
        reason: `Submitted ${input.priceKind.toLowerCase()} price must be a finite positive number.`,
      };
    }

    const check = validateLiveExecutionPrice({
      submittedPrice: input.submittedPrice,
      liveFeedPrice: input.serverPrice,
      maxSlippagePct: maxDeviationPct,
    });

    if (!check.valid) {
      return {
        ok: false,
        statusCode: 409,
        code:
          input.priceKind === 'ENTRY'
            ? 'ENTRY_PRICE_BYPASS_BLOCKED'
            : 'EXIT_PRICE_BYPASS_BLOCKED',
        authoritativePrice: input.serverPrice,
        deviationPct: check.deviationPct,
        freshness: freshnessEval.freshness,
        reason: `Client-supplied ${input.priceKind.toLowerCase()} price ($${input.submittedPrice}) deviates ${check.deviationPct.toFixed(2)}% from authoritative live price ($${input.serverPrice}), exceeding hard ${maxDeviationPct.toFixed(2)}% guard. Operator override is prohibited.`,
      };
    }

    return {
      ok: true,
      statusCode: 200,
      code: 'OK',
      authoritativePrice: input.serverPrice,
      deviationPct: check.deviationPct,
      freshness: freshnessEval.freshness,
      reason: `Verified live ${input.priceKind.toLowerCase()} price anchored to ${feedSource}.`,
    };
  }

  return {
    ok: true,
    statusCode: 200,
    code: 'OK',
    authoritativePrice: input.serverPrice,
    deviationPct: 0,
    freshness: freshnessEval.freshness,
    reason: `Resolved authoritative ${input.priceKind.toLowerCase()} price from ${feedSource}.`,
  };
}

export interface RawBinanceSpotTicker {
  readonly symbol: unknown;
  readonly lastPrice: unknown;
  readonly priceChangePercent?: unknown;
  readonly highPrice?: unknown;
  readonly lowPrice?: unknown;
  readonly quoteVolume?: unknown;
  readonly bidPrice?: unknown;
  readonly askPrice?: unknown;
  readonly closeTime?: unknown;
}

export interface ValidatedBinanceSpotTicker {
  readonly symbol: string;
  readonly price: number;
  readonly change24hPercent: number;
  readonly high24h: number;
  readonly low24h: number;
  readonly volume24hUsd: number;
  readonly bidPrice: number | null;
  readonly askPrice: number | null;
  readonly markPrice: number | null;
  readonly spreadBps: number | null;
  readonly observedAtMs: number;
}

export interface FeedRecordValidationResult<T> {
  readonly valid: boolean;
  readonly reason: string;
  readonly record?: T;
}

function parseOptionalFiniteNumber(value: unknown): { readonly provided: boolean; readonly value: number } {
  if (value === undefined || value === null || value === '') {
    return { provided: false, value: Number.NaN };
  }
  const num = Number(value);
  return { provided: true, value: num };
}

export function validateBinanceSpotTickerRecord(
  raw: RawBinanceSpotTicker,
  options?: {
    readonly previousLivePrice?: number;
    readonly nowMs?: number;
    readonly allowedSymbols?: ReadonlySet<string>;
  }
): FeedRecordValidationResult<ValidatedBinanceSpotTicker> {
  const nowMs = options?.nowMs ?? Date.now();
  const symbol = typeof raw.symbol === 'string' ? raw.symbol.trim().toUpperCase() : '';
  if (!symbol || !/^[A-Z0-9]{4,20}$/.test(symbol)) {
    return { valid: false, reason: 'Rejected spot ticker: malformed symbol identifier.' };
  }
  if (options?.allowedSymbols && !options.allowedSymbols.has(symbol)) {
    return { valid: false, reason: `Rejected spot ticker: symbol ${symbol} not on allowlist.` };
  }

  const price = Number(raw.lastPrice);
  const sampleCheck = validateSpotTickSample({
    price,
    previousPrice: options?.previousLivePrice,
    maxJumpPct: MAX_SINGLE_TICK_JUMP_PCT,
  });
  if (!sampleCheck.valid) {
    return { valid: false, reason: `${symbol}: ${sampleCheck.reason}` };
  }

  const changeParsed = parseOptionalFiniteNumber(raw.priceChangePercent);
  if (
    changeParsed.provided &&
    (!Number.isFinite(changeParsed.value) ||
      changeParsed.value < -99.99 ||
      changeParsed.value > MAX_ABS_CHANGE_24H_PCT)
  ) {
    return {
      valid: false,
      reason: `${symbol}: Rejected spot ticker with out-of-bounds 24h change (${String(raw.priceChangePercent)}).`,
    };
  }
  const change24hPercent = changeParsed.provided ? Number(changeParsed.value.toFixed(2)) : 0;

  const volParsed = parseOptionalFiniteNumber(raw.quoteVolume);
  if (volParsed.provided && (!Number.isFinite(volParsed.value) || volParsed.value < 0)) {
    return {
      valid: false,
      reason: `${symbol}: Rejected spot ticker with negative or non-finite quoteVolume.`,
    };
  }
  const volume24hUsd = volParsed.provided ? Math.round(volParsed.value) : 0;

  const highParsed = parseOptionalFiniteNumber(raw.highPrice);
  const lowParsed = parseOptionalFiniteNumber(raw.lowPrice);
  if (highParsed.provided && (!Number.isFinite(highParsed.value) || highParsed.value <= 0)) {
    return { valid: false, reason: `${symbol}: Rejected spot ticker with invalid high24h.` };
  }
  if (lowParsed.provided && (!Number.isFinite(lowParsed.value) || lowParsed.value <= 0)) {
    return { valid: false, reason: `${symbol}: Rejected spot ticker with invalid low24h.` };
  }

  let high24h = highParsed.provided ? highParsed.value : price;
  let low24h = lowParsed.provided ? lowParsed.value : price;
  if (highParsed.provided && lowParsed.provided && low24h > high24h * 1.005) {
    return {
      valid: false,
      reason: `${symbol}: Rejected spot ticker due to inverted 24h range (low ${low24h} > high ${high24h}).`,
    };
  }
  high24h = Math.max(high24h, price);
  low24h = Math.min(low24h, price);

  const bidParsed = parseOptionalFiniteNumber(raw.bidPrice);
  const askParsed = parseOptionalFiniteNumber(raw.askPrice);
  let bidPrice: number | null = null;
  let askPrice: number | null = null;
  let markPrice: number | null = null;
  let spreadBps: number | null = null;

  if (bidParsed.provided || askParsed.provided) {
    const bothZero =
      bidParsed.provided && askParsed.provided && bidParsed.value === 0 && askParsed.value === 0;
    if (!bothZero) {
      if (
        !bidParsed.provided ||
        !askParsed.provided ||
        !Number.isFinite(bidParsed.value) ||
        !Number.isFinite(askParsed.value) ||
        bidParsed.value <= 0 ||
        askParsed.value <= 0
      ) {
        return {
          valid: false,
          reason: `${symbol}: Rejected spot ticker with malformed or partial bid/ask quote.`,
        };
      }
      if (askParsed.value < bidParsed.value) {
        return {
          valid: false,
          reason: `${symbol}: Rejected spot ticker with inverted bid/ask (${bidParsed.value} > ${askParsed.value}).`,
        };
      }
      const computedSpread = computeSpreadBps(bidParsed.value, askParsed.value);
      if (computedSpread === null || computedSpread > MAX_LIVE_BOOK_SPREAD_BPS) {
        return {
          valid: false,
          reason: `${symbol}: Rejected spot ticker with abnormal bid/ask spread (${computedSpread ?? 'invalid'} bps > ${MAX_LIVE_BOOK_SPREAD_BPS} bps).`,
        };
      }
      const mid = Number(((bidParsed.value + askParsed.value) / 2).toPrecision(8));
      const lastVsMidPct = (Math.abs(price - mid) / mid) * 100;
      if (lastVsMidPct > MAX_LAST_VS_MID_DIVERGENCE_PCT) {
        return {
          valid: false,
          reason: `${symbol}: Rejected spot ticker because lastPrice (${price}) diverges ${lastVsMidPct.toFixed(2)}% from book midpoint (${mid}).`,
        };
      }
      bidPrice = bidParsed.value;
      askPrice = askParsed.value;
      markPrice = mid;
      spreadBps = computedSpread;
    }
  }

  const closeTimeParsed = parseOptionalFiniteNumber(raw.closeTime);
  if (closeTimeParsed.provided) {
    if (!Number.isFinite(closeTimeParsed.value) || closeTimeParsed.value <= 1_000_000_000_000) {
      return {
        valid: false,
        reason: `${symbol}: Rejected spot ticker with malformed closeTime timestamp.`,
      };
    }
    if (closeTimeParsed.value > nowMs + MARKET_FRESHNESS_THRESHOLDS_MS.maxFutureSkewMs) {
      return {
        valid: false,
        reason: `${symbol}: Rejected future-dated spot ticker closeTime (+${Math.round(closeTimeParsed.value - nowMs)}ms).`,
      };
    }
  }

  return {
    valid: true,
    reason: 'Spot ticker validated.',
    record: {
      symbol,
      price,
      change24hPercent,
      high24h,
      low24h,
      volume24hUsd,
      bidPrice,
      askPrice,
      markPrice,
      spreadBps,
      observedAtMs: nowMs,
    },
  };
}

export interface ValidatedBookTicker {
  readonly symbol: string;
  readonly bidPrice: number;
  readonly askPrice: number;
  readonly markPrice: number;
  readonly spreadBps: number;
}

export function validateBinanceBookTickerRecord(
  raw: { readonly symbol: unknown; readonly bidPrice: unknown; readonly askPrice: unknown },
  options?: {
    readonly referencePrice?: number;
    readonly allowedSymbols?: ReadonlySet<string>;
  }
): FeedRecordValidationResult<ValidatedBookTicker> {
  const symbol = typeof raw.symbol === 'string' ? raw.symbol.trim().toUpperCase() : '';
  if (!symbol || !/^[A-Z0-9]{4,20}$/.test(symbol)) {
    return { valid: false, reason: 'Rejected bookTicker: malformed symbol.' };
  }
  if (options?.allowedSymbols && !options.allowedSymbols.has(symbol)) {
    return { valid: false, reason: `Rejected bookTicker: symbol ${symbol} not on allowlist.` };
  }

  const bidPrice = Number(raw.bidPrice);
  const askPrice = Number(raw.askPrice);
  if (
    !Number.isFinite(bidPrice) ||
    !Number.isFinite(askPrice) ||
    bidPrice <= 0 ||
    askPrice <= 0 ||
    askPrice < bidPrice
  ) {
    return {
      valid: false,
      reason: `${symbol}: Rejected bookTicker with invalid or inverted bid/ask (${raw.bidPrice}/${raw.askPrice}).`,
    };
  }

  const spreadBps = computeSpreadBps(bidPrice, askPrice);
  if (spreadBps === null || spreadBps > MAX_LIVE_BOOK_SPREAD_BPS) {
    return {
      valid: false,
      reason: `${symbol}: Rejected bookTicker with excessive spread (${spreadBps ?? 'invalid'} bps > ${MAX_LIVE_BOOK_SPREAD_BPS} bps).`,
    };
  }

  const markPrice = Number(((bidPrice + askPrice) / 2).toPrecision(8));
  if (
    options?.referencePrice !== undefined &&
    Number.isFinite(options.referencePrice) &&
    options.referencePrice > 0
  ) {
    const jumpPct = (Math.abs(markPrice - options.referencePrice) / options.referencePrice) * 100;
    if (jumpPct > MAX_BOOK_TICKER_JUMP_PCT) {
      return {
        valid: false,
        reason: `${symbol}: Rejected bookTicker midpoint jump (${jumpPct.toFixed(2)}% > ${MAX_BOOK_TICKER_JUMP_PCT}%).`,
      };
    }
  }

  return {
    valid: true,
    reason: 'Book ticker validated.',
    record: {
      symbol,
      bidPrice,
      askPrice,
      markPrice,
      spreadBps,
    },
  };
}

export interface RawBinanceFuturesTicker {
  readonly symbol: unknown;
  readonly markPrice: unknown;
  readonly indexPrice?: unknown;
  readonly lastFundingRate?: unknown;
  readonly nextFundingTime?: unknown;
  readonly quoteVolume?: unknown;
  readonly time?: unknown;
}

export interface ValidatedBinanceFuturesTicker {
  readonly symbol: string;
  readonly markPrice: number;
  readonly indexPrice: number;
  readonly fundingRate: number;
  readonly nextFundingTimeIso: string;
  readonly volume24hUsd: number;
  readonly openInterestUsd: number;
  readonly observedAtMs: number;
}

export function validateBinanceFuturesTickerRecord(
  raw: RawBinanceFuturesTicker,
  options?: {
    readonly previousLiveMarkPrice?: number;
    readonly nowMs?: number;
    readonly allowedSymbols?: ReadonlySet<string>;
  }
): FeedRecordValidationResult<ValidatedBinanceFuturesTicker> {
  const nowMs = options?.nowMs ?? Date.now();
  const symbol = typeof raw.symbol === 'string' ? raw.symbol.trim().toUpperCase() : '';
  if (!symbol || !/^[A-Z0-9]{4,20}$/.test(symbol)) {
    return { valid: false, reason: 'Rejected futures ticker: malformed symbol identifier.' };
  }
  if (options?.allowedSymbols && !options.allowedSymbols.has(symbol)) {
    return { valid: false, reason: `Rejected futures ticker: symbol ${symbol} not on allowlist.` };
  }

  const markPrice = Number(raw.markPrice);
  const sampleCheck = validateSpotTickSample({
    price: markPrice,
    previousPrice: options?.previousLiveMarkPrice,
    maxJumpPct: MAX_SINGLE_TICK_JUMP_PCT,
  });
  if (!sampleCheck.valid) {
    return { valid: false, reason: `${symbol} futures: ${sampleCheck.reason}` };
  }

  const indexParsed = parseOptionalFiniteNumber(raw.indexPrice);
  const indexPrice = indexParsed.provided ? indexParsed.value : markPrice;
  if (!Number.isFinite(indexPrice) || indexPrice <= 0) {
    return {
      valid: false,
      reason: `${symbol} futures: Rejected invalid non-positive indexPrice.`,
    };
  }
  const basisPct = (Math.abs(markPrice - indexPrice) / indexPrice) * 100;
  if (basisPct > MAX_FUTURES_INDEX_BASIS_PCT) {
    return {
      valid: false,
      reason: `${symbol} futures: Rejected abnormal mark/index basis divergence (${basisPct.toFixed(2)}% > ${MAX_FUTURES_INDEX_BASIS_PCT}%).`,
    };
  }

  const fundingParsed = parseOptionalFiniteNumber(raw.lastFundingRate);
  if (
    fundingParsed.provided &&
    (!Number.isFinite(fundingParsed.value) || Math.abs(fundingParsed.value) > MAX_ABS_FUNDING_RATE)
  ) {
    return {
      valid: false,
      reason: `${symbol} futures: Rejected out-of-bounds funding rate (${String(raw.lastFundingRate)}).`,
    };
  }
  const fundingRate = fundingParsed.provided ? fundingParsed.value : 0.0001;

  const nextFundingParsed = parseOptionalFiniteNumber(raw.nextFundingTime);
  const nextFundingMs = nextFundingParsed.provided
    ? nextFundingParsed.value
    : nowMs + 3_600_000 * 4;
  if (!Number.isFinite(nextFundingMs) || nextFundingMs <= 1_000_000_000_000) {
    return {
      valid: false,
      reason: `${symbol} futures: Rejected invalid nextFundingTime epoch.`,
    };
  }

  const volParsed = parseOptionalFiniteNumber(raw.quoteVolume);
  if (volParsed.provided && (!Number.isFinite(volParsed.value) || volParsed.value < 0)) {
    return {
      valid: false,
      reason: `${symbol} futures: Rejected negative or non-finite quoteVolume.`,
    };
  }
  const volume24hUsd = volParsed.provided ? Math.round(volParsed.value) : 250_000_000;

  const eventTimeParsed = parseOptionalFiniteNumber(raw.time);
  if (eventTimeParsed.provided) {
    if (!Number.isFinite(eventTimeParsed.value) || eventTimeParsed.value <= 1_000_000_000_000) {
      return {
        valid: false,
        reason: `${symbol} futures: Rejected malformed exchange timestamp.`,
      };
    }
    if (eventTimeParsed.value > nowMs + MARKET_FRESHNESS_THRESHOLDS_MS.maxFutureSkewMs) {
      return {
        valid: false,
        reason: `${symbol} futures: Rejected future-dated exchange timestamp (+${Math.round(eventTimeParsed.value - nowMs)}ms).`,
      };
    }
  }

  return {
    valid: true,
    reason: 'Futures ticker validated.',
    record: {
      symbol,
      markPrice,
      indexPrice,
      fundingRate,
      nextFundingTimeIso: new Date(nextFundingMs).toISOString(),
      volume24hUsd,
      openInterestUsd: Math.round(volume24hUsd * 0.36),
      observedAtMs: nowMs,
    },
  };
}

/**
 * Validates Stage 2 Paper Trade evidence prices against their own observed Bid/Ask + slippage
 * AND against any fresh authoritative server live feed if the trade was observed recently.
 */
export function validateStage2PaperEvidencePriceCoherence(input: {
  readonly side: 'BUY' | 'SELL';
  readonly bidPrice: number;
  readonly askPrice: number;
  readonly entryPrice: number;
  readonly slippageBps: number;
  readonly observedAtIso: string;
  readonly liveServerPrice?: number | null;
  readonly liveServerSource?: string | null;
  readonly liveServerObservedAtMs?: number | null;
  readonly nowMs?: number;
}): { readonly valid: boolean; readonly reason: string } {
  if (
    !Number.isFinite(input.bidPrice) ||
    !Number.isFinite(input.askPrice) ||
    !Number.isFinite(input.entryPrice) ||
    input.bidPrice <= 0 ||
    input.askPrice <= 0 ||
    input.entryPrice <= 0 ||
    input.askPrice < input.bidPrice
  ) {
    return {
      valid: false,
      reason: 'Paper evidence bid, ask, and entry prices must be finite positive numbers with ask >= bid.',
    };
  }

  const slippageBps =
    Number.isFinite(input.slippageBps) && input.slippageBps >= 0 ? input.slippageBps : 0;
  // Allow declared slippage + small 10bps rounding cushion on execution side
  const toleranceRatio = (slippageBps + 10) / 10_000;

  if (input.side === 'BUY') {
    const minBuy = input.bidPrice * (1 - 0.0005);
    const maxBuy = input.askPrice * (1 + toleranceRatio);
    if (input.entryPrice < minBuy || input.entryPrice > maxBuy) {
      return {
        valid: false,
        reason: `BUY paper entryPrice ($${input.entryPrice}) is inconsistent with observed book [$${input.bidPrice}, $${input.askPrice}] + ${slippageBps}bps slippage.`,
      };
    }
  } else {
    const maxSell = input.askPrice * (1 + 0.0005);
    const minSell = input.bidPrice * (1 - toleranceRatio);
    if (input.entryPrice > maxSell || input.entryPrice < minSell) {
      return {
        valid: false,
        reason: `SELL paper entryPrice ($${input.entryPrice}) is inconsistent with observed book [$${input.bidPrice}, $${input.askPrice}] + ${slippageBps}bps slippage.`,
      };
    }
  }

  // If the paper evidence claims to be from the last 5 minutes and server has a fresh live quote,
  // reject wildly fabricated prices (> 10% away from authoritative live spot).
  const nowMs = input.nowMs ?? Date.now();
  const observedMs = Date.parse(input.observedAtIso);
  const liveFresh =
    typeof input.liveServerObservedAtMs === 'number'
      ? evaluateTimestampFreshness(input.liveServerObservedAtMs, nowMs).freshness
      : 'INVALID_TIMESTAMP';

  if (
    Number.isFinite(observedMs) &&
    Math.abs(nowMs - observedMs) <= 300_000 &&
    input.liveServerSource === 'binance_spot' &&
    typeof input.liveServerPrice === 'number' &&
    Number.isFinite(input.liveServerPrice) &&
    input.liveServerPrice > 0 &&
    (liveFresh === 'FRESH' || liveFresh === 'DELAYED')
  ) {
    const divergencePct =
      (Math.abs(input.entryPrice - input.liveServerPrice) / input.liveServerPrice) * 100;
    if (divergencePct > 10.0) {
      return {
        valid: false,
        reason: `Recent paper evidence entryPrice ($${input.entryPrice}) diverges ${divergencePct.toFixed(2)}% from live verified Binance price ($${input.liveServerPrice}).`,
      };
    }
  }

  return { valid: true, reason: 'Paper evidence price coherence verified.' };
}

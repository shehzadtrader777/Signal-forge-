/**
 * Smart Market Data Router
 *
 * Provider-aware routing layer coordinating:
 * 1. Binance Real-Time Exchange Feed (WS / REST) — PRIMARY for executable trading quotes
 * 2. CoinGecko Reference Market API — SECONDARY for reference/macro/fallback metadata ONLY
 * 3. CoinMarketCap Reference Valuations — TERTIARY for cross-validation/reference ONLY
 *
 * Strict Honesty & Safety Rules:
 * - NEVER treat aggregated CoinGecko or CMC price as an exchange-specific executable quote.
 * - NEVER silently replace failed real data with invented/simulated prices.
 * - When all real providers fail, emit DATA_UNAVAILABLE / STALE_DATA and set
 *   executionAllowed = false so downstream strategies block new execution decisions.
 * - Provides TTL caching, in-flight request deduplication/coalescing, and exponential
 *   backoff on HTTP 429 / 503.
 */

import {
  CoinGeckoMarketClient,
  type CoinGeckoSanitizedStatus,
  type MarketDataQuality,
  normalizeCoinGeckoSymbol,
} from './coinGeckoClient';

export type MarketProviderId =
  | 'binance_spot_ws'
  | 'binance_spot_rest'
  | 'coingecko'
  | 'coinmarketcap'
  | 'none';

export type AgentDataProvenance =
  | 'LIVE_EXCHANGE'
  | 'CACHED_EXCHANGE'
  | 'REFERENCE_AGGREGATED'
  | 'HISTORICAL_BACKTEST'
  | 'SIMULATED_FIXTURE'
  | 'STALE_OR_UNAVAILABLE';

export type RouterFetchStatus =
  | 'OK_LIVE_EXCHANGE'
  | 'OK_CACHED_EXCHANGE'
  | 'FALLBACK_REFERENCE_AGGREGATED'
  | 'STALE_DATA'
  | 'DATA_UNAVAILABLE';

export interface ExchangeFeedSnapshot {
  symbol: string;
  price: number;
  change24hPercent: number;
  volume24hUsd: number;
  bidPrice?: number;
  askPrice?: number;
  updatedAtMs: number;
  source: 'binance_spot' | 'binance_ws' | 'fallback';
}

export interface CmcReferenceSnapshot {
  symbol: string;
  priceUsd: number;
  change24hPercent: number;
  marketCapUsd: number;
  volume24hUsd: number;
  updatedAtMs: number;
  source: 'cmc_api' | 'unavailable';
}

export interface RoutedMarketQuote {
  symbol: string;
  price: number | null;
  change24hPercent: number | null;
  volume24hUsd: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  provider: MarketProviderId;
  dataQuality: MarketDataQuality;
  provenance: AgentDataProvenance;
  fetchStatus: RouterFetchStatus;
  dataAgeMs: number | null;
  fetchedAtIso: string;
  sourceTimestampIso: string | null;
  fallbackReason: string | null;
  executableQuote: boolean;
  executionAllowed: boolean;
  executionBlockReason: string | null;
  cachedHit: boolean;
}

export interface ProviderHealthEntry {
  provider: Exclude<MarketProviderId, 'none'>;
  role: 'EXECUTABLE_EXCHANGE' | 'REFERENCE_AGGREGATED';
  status: 'HEALTHY' | 'DEGRADED' | 'BACKOFF' | 'PENDING_CREDENTIALS' | 'UNAVAILABLE';
  dataQuality: MarketDataQuality;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastHttpStatus: number | null;
  backoffUntilIso: string | null;
  consecutiveFailures: number;
}

export interface SmartMarketRouterStatus {
  generatedAt: string;
  primaryExchangeProvider: 'binance_spot_ws' | 'binance_spot_rest' | 'none';
  overallDataQuality: MarketDataQuality;
  overallProvenance: AgentDataProvenance;
  executionAllowed: boolean;
  executionBlockReason: string | null;
  coalescedRequestsCount: number;
  cacheHitsCount: number;
  fallbackActivationsCount: number;
  providers: {
    binance: ProviderHealthEntry;
    coingecko: ProviderHealthEntry & { detail: CoinGeckoSanitizedStatus };
    coinmarketcap: ProviderHealthEntry;
  };
}

export interface SmartMarketRouterDependencies {
  getExchangeFeed: (symbol: string) => ExchangeFeedSnapshot | null;
  getCmcReference?: (symbol: string) => CmcReferenceSnapshot | null;
  coinGeckoClient: CoinGeckoMarketClient;
  nowFn?: () => number;
  maxExecutableAgeMs?: number;
  maxCachedExchangeAgeMs?: number;
  routeCacheTtlMs?: number;
}

interface ProviderCircuitState {
  consecutiveFailures: number;
  backoffUntilMs: number;
  lastHttpStatus: number | null;
  lastError: string | null;
  lastSuccessAtMs: number | null;
}

const DEFAULT_MAX_EXECUTABLE_AGE_MS = 30_000;
const DEFAULT_MAX_CACHED_EXCHANGE_AGE_MS = 180_000;
const DEFAULT_ROUTE_CACHE_TTL_MS = 3_000;
const MAX_BACKOFF_MS = 5 * 60_000;

export class SmartMarketDataRouter {
  private readonly getExchangeFeed: (symbol: string) => ExchangeFeedSnapshot | null;
  private readonly getCmcReference: (symbol: string) => CmcReferenceSnapshot | null;
  private readonly coinGeckoClient: CoinGeckoMarketClient;
  private readonly nowFn: () => number;
  private readonly maxExecutableAgeMs: number;
  private readonly maxCachedExchangeAgeMs: number;
  private readonly routeCacheTtlMs: number;

  private readonly routeCache = new Map<string, { quote: RoutedMarketQuote; cachedAtMs: number }>();
  private readonly inFlightQuotes = new Map<string, Promise<RoutedMarketQuote>>();

  private coalescedRequestsCount = 0;
  private cacheHitsCount = 0;
  private fallbackActivationsCount = 0;

  private readonly circuits: Record<'binance' | 'coinmarketcap', ProviderCircuitState> = {
    binance: {
      consecutiveFailures: 0,
      backoffUntilMs: 0,
      lastHttpStatus: null,
      lastError: null,
      lastSuccessAtMs: null,
    },
    coinmarketcap: {
      consecutiveFailures: 0,
      backoffUntilMs: 0,
      lastHttpStatus: null,
      lastError: null,
      lastSuccessAtMs: null,
    },
  };

  constructor(deps: SmartMarketRouterDependencies) {
    this.getExchangeFeed = deps.getExchangeFeed;
    this.getCmcReference = deps.getCmcReference ?? (() => null);
    this.coinGeckoClient = deps.coinGeckoClient;
    this.nowFn = deps.nowFn ?? (() => Date.now());
    this.maxExecutableAgeMs = Math.max(5_000, deps.maxExecutableAgeMs ?? DEFAULT_MAX_EXECUTABLE_AGE_MS);
    this.maxCachedExchangeAgeMs = Math.max(
      this.maxExecutableAgeMs,
      deps.maxCachedExchangeAgeMs ?? DEFAULT_MAX_CACHED_EXCHANGE_AGE_MS
    );
    this.routeCacheTtlMs = Math.max(500, deps.routeCacheTtlMs ?? DEFAULT_ROUTE_CACHE_TTL_MS);
  }

  public recordProviderFailure(
    provider: 'binance' | 'coinmarketcap',
    httpStatus: number | null,
    message: string
  ): void {
    const now = this.nowFn();
    const state = this.circuits[provider];
    state.consecutiveFailures += 1;
    state.lastHttpStatus = httpStatus;
    state.lastError = message.slice(0, 180);
    if (httpStatus === 429 || (httpStatus !== null && httpStatus >= 500)) {
      const delayMs = Math.min(MAX_BACKOFF_MS, 5_000 * Math.pow(2, Math.min(6, state.consecutiveFailures - 1)));
      state.backoffUntilMs = now + delayMs;
    }
  }

  public recordProviderSuccess(provider: 'binance' | 'coinmarketcap'): void {
    const now = this.nowFn();
    const state = this.circuits[provider];
    state.consecutiveFailures = 0;
    state.backoffUntilMs = 0;
    state.lastHttpStatus = 200;
    state.lastError = null;
    state.lastSuccessAtMs = now;
  }

  public isProviderInBackoff(provider: 'binance' | 'coinmarketcap'): boolean {
    return this.circuits[provider].backoffUntilMs > this.nowFn();
  }

  public invalidateCache(symbol?: string): void {
    if (symbol) {
      this.routeCache.delete(normalizeCoinGeckoSymbol(symbol));
    } else {
      this.routeCache.clear();
    }
  }

  /**
   * Resolves a routed market quote with strict provider priority, caching,
   * in-flight deduplication, and explicit executable vs reference classification.
   */
  public async getQuote(
    rawSymbol: string,
    options: { bypassCache?: boolean; allowReferenceFallback?: boolean } = {}
  ): Promise<RoutedMarketQuote> {
    const symbol = normalizeCoinGeckoSymbol(rawSymbol) || 'BTCUSDT';
    const now = this.nowFn();

    if (!options.bypassCache) {
      const cached = this.routeCache.get(symbol);
      if (cached && now - cached.cachedAtMs < this.routeCacheTtlMs) {
        this.cacheHitsCount += 1;
        return {
          ...cached.quote,
          cachedHit: true,
        };
      }
    }

    const existing = this.inFlightQuotes.get(symbol);
    if (existing) {
      this.coalescedRequestsCount += 1;
      return existing;
    }

    const promise = this.resolveQuoteUncached(symbol, options.allowReferenceFallback !== false)
      .then((quote) => {
        this.routeCache.set(symbol, { quote, cachedAtMs: this.nowFn() });
        return quote;
      })
      .finally(() => {
        this.inFlightQuotes.delete(symbol);
      });

    this.inFlightQuotes.set(symbol, promise);
    return promise;
  }

  private async resolveQuoteUncached(
    symbol: string,
    allowReferenceFallback: boolean
  ): Promise<RoutedMarketQuote> {
    const now = this.nowFn();
    const fetchedAtIso = new Date(now).toISOString();

    // 1. Primary executable tier: real Binance exchange feed (WS / REST)
    const exchangeSnap = this.getExchangeFeed(symbol);
    const hasRealExchangeQuote =
      exchangeSnap !== null &&
      (exchangeSnap.source === 'binance_spot' || exchangeSnap.source === 'binance_ws') &&
      Number.isFinite(exchangeSnap.price) &&
      exchangeSnap.price > 0 &&
      exchangeSnap.updatedAtMs > 0;

    if (hasRealExchangeQuote && exchangeSnap) {
      const ageMs = Math.max(0, now - exchangeSnap.updatedAtMs);
      const provider: MarketProviderId =
        exchangeSnap.source === 'binance_ws' ? 'binance_spot_ws' : 'binance_spot_rest';

      if (ageMs <= this.maxExecutableAgeMs && !this.isProviderInBackoff('binance')) {
        this.recordProviderSuccess('binance');
        return {
          symbol,
          price: exchangeSnap.price,
          change24hPercent: exchangeSnap.change24hPercent,
          volume24hUsd: exchangeSnap.volume24hUsd,
          bidPrice: exchangeSnap.bidPrice ?? null,
          askPrice: exchangeSnap.askPrice ?? null,
          provider,
          dataQuality: 'LIVE',
          provenance: 'LIVE_EXCHANGE',
          fetchStatus: 'OK_LIVE_EXCHANGE',
          dataAgeMs: ageMs,
          fetchedAtIso,
          sourceTimestampIso: new Date(exchangeSnap.updatedAtMs).toISOString(),
          fallbackReason: null,
          executableQuote: true,
          executionAllowed: true,
          executionBlockReason: null,
          cachedHit: false,
        };
      }

      if (ageMs <= this.maxCachedExchangeAgeMs) {
        return {
          symbol,
          price: exchangeSnap.price,
          change24hPercent: exchangeSnap.change24hPercent,
          volume24hUsd: exchangeSnap.volume24hUsd,
          bidPrice: exchangeSnap.bidPrice ?? null,
          askPrice: exchangeSnap.askPrice ?? null,
          provider,
          dataQuality: 'CACHED',
          provenance: 'CACHED_EXCHANGE',
          fetchStatus: 'OK_CACHED_EXCHANGE',
          dataAgeMs: ageMs,
          fetchedAtIso,
          sourceTimestampIso: new Date(exchangeSnap.updatedAtMs).toISOString(),
          fallbackReason: `Exchange feed age ${Math.round(ageMs / 1000)}s exceeds ${Math.round(this.maxExecutableAgeMs / 1000)}s live execution threshold`,
          executableQuote: false,
          executionAllowed: false,
          executionBlockReason: 'STALE_EXCHANGE_QUOTE_EXECUTION_PAUSED',
          cachedHit: false,
        };
      }
    }

    const primaryFailureReason = this.isProviderInBackoff('binance')
      ? 'Binance exchange feed in exponential backoff after rate-limit/outage'
      : hasRealExchangeQuote && exchangeSnap
      ? `Binance exchange feed stale (${Math.round((now - exchangeSnap.updatedAtMs) / 1000)}s old)`
      : 'Binance real-time exchange feed unavailable';

    // 2. Secondary reference tier: CoinGecko (strictly reference/fallback ONLY — NEVER executableQuote)
    if (allowReferenceFallback) {
      const cgStatus = this.coinGeckoClient.getSanitizedStatus();
      if (cgStatus.configured) {
        const cgQuotes = await this.coinGeckoClient.fetchReferenceQuotes([symbol]);
        const cgQuote = cgQuotes[symbol];
        if (cgQuote && Number.isFinite(cgQuote.priceUsd) && cgQuote.priceUsd > 0) {
          this.fallbackActivationsCount += 1;
          const ageMs = Math.max(0, now - cgQuote.lastUpdatedAtMs);
          return {
            symbol,
            price: cgQuote.priceUsd,
            change24hPercent: cgQuote.change24hPercent,
            volume24hUsd: cgQuote.volume24hUsd,
            bidPrice: null,
            askPrice: null,
            provider: 'coingecko',
            dataQuality: cgQuote.dataQuality === 'LIVE' ? 'DELAYED' : cgQuote.dataQuality,
            provenance: 'REFERENCE_AGGREGATED',
            fetchStatus: 'FALLBACK_REFERENCE_AGGREGATED',
            dataAgeMs: ageMs,
            fetchedAtIso,
            sourceTimestampIso: new Date(cgQuote.lastUpdatedAtMs).toISOString(),
            fallbackReason: `${primaryFailureReason}; serving CoinGecko aggregated reference price (non-executable)`,
            executableQuote: false,
            executionAllowed: false,
            executionBlockReason: 'AGGREGATED_REFERENCE_PRICE_NOT_EXECUTABLE',
            cachedHit: false,
          };
        }
      }

      // 3. Tertiary reference tier: CoinMarketCap (only if real live cmc_api data exists)
      const cmcSnap = this.getCmcReference(symbol);
      if (
        cmcSnap &&
        cmcSnap.source === 'cmc_api' &&
        Number.isFinite(cmcSnap.priceUsd) &&
        cmcSnap.priceUsd > 0 &&
        !this.isProviderInBackoff('coinmarketcap')
      ) {
        this.fallbackActivationsCount += 1;
        this.recordProviderSuccess('coinmarketcap');
        const ageMs = Math.max(0, now - cmcSnap.updatedAtMs);
        return {
          symbol,
          price: cmcSnap.priceUsd,
          change24hPercent: cmcSnap.change24hPercent,
          volume24hUsd: cmcSnap.volume24hUsd,
          bidPrice: null,
          askPrice: null,
          provider: 'coinmarketcap',
          dataQuality: ageMs > 180_000 ? 'DELAYED' : 'CACHED',
          provenance: 'REFERENCE_AGGREGATED',
          fetchStatus: 'FALLBACK_REFERENCE_AGGREGATED',
          dataAgeMs: ageMs,
          fetchedAtIso,
          sourceTimestampIso: new Date(cmcSnap.updatedAtMs).toISOString(),
          fallbackReason: `${primaryFailureReason}; serving CoinMarketCap aggregated reference price (non-executable)`,
          executableQuote: false,
          executionAllowed: false,
          executionBlockReason: 'AGGREGATED_REFERENCE_PRICE_NOT_EXECUTABLE',
          cachedHit: false,
        };
      }
    }

    // 4. All real providers unavailable — NEVER invent or fabricate a price!
    const isStaleExchange = hasRealExchangeQuote && exchangeSnap !== null;
    return {
      symbol,
      price: null,
      change24hPercent: null,
      volume24hUsd: null,
      bidPrice: null,
      askPrice: null,
      provider: 'none',
      dataQuality: 'UNAVAILABLE',
      provenance: 'STALE_OR_UNAVAILABLE',
      fetchStatus: isStaleExchange ? 'STALE_DATA' : 'DATA_UNAVAILABLE',
      dataAgeMs: isStaleExchange && exchangeSnap ? Math.max(0, now - exchangeSnap.updatedAtMs) : null,
      fetchedAtIso,
      sourceTimestampIso:
        isStaleExchange && exchangeSnap ? new Date(exchangeSnap.updatedAtMs).toISOString() : null,
      fallbackReason: `${primaryFailureReason}; no verified CoinGecko or CoinMarketCap reference feed available`,
      executableQuote: false,
      executionAllowed: false,
      executionBlockReason: isStaleExchange
        ? 'STALE_MARKET_DATA_EXECUTION_BLOCKED'
        : 'ALL_REAL_MARKET_PROVIDERS_UNAVAILABLE',
      cachedHit: false,
    };
  }

  public getStatus(anchorSymbol = 'BTCUSDT'): SmartMarketRouterStatus {
    const now = this.nowFn();
    const symbol = normalizeCoinGeckoSymbol(anchorSymbol) || 'BTCUSDT';
    const exchangeSnap = this.getExchangeFeed(symbol);
    const hasRealExchange =
      exchangeSnap !== null &&
      (exchangeSnap.source === 'binance_spot' || exchangeSnap.source === 'binance_ws') &&
      exchangeSnap.price > 0 &&
      exchangeSnap.updatedAtMs > 0;
    const exchangeAgeMs = hasRealExchange && exchangeSnap ? Math.max(0, now - exchangeSnap.updatedAtMs) : null;
    const binanceFresh = hasRealExchange && exchangeAgeMs !== null && exchangeAgeMs <= this.maxExecutableAgeMs;
    const binanceCached =
      hasRealExchange && exchangeAgeMs !== null && exchangeAgeMs <= this.maxCachedExchangeAgeMs;

    const cgDetail = this.coinGeckoClient.getSanitizedStatus();
    const cmcSnap = this.getCmcReference(symbol);
    const cmcLive = cmcSnap !== null && cmcSnap.source === 'cmc_api' && cmcSnap.priceUsd > 0;

    const binanceHealth: ProviderHealthEntry = {
      provider: exchangeSnap?.source === 'binance_ws' ? 'binance_spot_ws' : 'binance_spot_rest',
      role: 'EXECUTABLE_EXCHANGE',
      status: this.isProviderInBackoff('binance')
        ? 'BACKOFF'
        : binanceFresh
        ? 'HEALTHY'
        : binanceCached
        ? 'DEGRADED'
        : 'UNAVAILABLE',
      dataQuality: binanceFresh ? 'LIVE' : binanceCached ? 'CACHED' : 'UNAVAILABLE',
      lastSuccessAt:
        hasRealExchange && exchangeSnap
          ? new Date(exchangeSnap.updatedAtMs).toISOString()
          : this.circuits.binance.lastSuccessAtMs
          ? new Date(this.circuits.binance.lastSuccessAtMs).toISOString()
          : null,
      lastError: this.circuits.binance.lastError,
      lastHttpStatus: this.circuits.binance.lastHttpStatus,
      backoffUntilIso:
        this.circuits.binance.backoffUntilMs > now
          ? new Date(this.circuits.binance.backoffUntilMs).toISOString()
          : null,
      consecutiveFailures: this.circuits.binance.consecutiveFailures,
    };

    const cgStatusMapped: ProviderHealthEntry['status'] = !cgDetail.configured
      ? 'PENDING_CREDENTIALS'
      : cgDetail.backoffUntilIso
      ? 'BACKOFF'
      : cgDetail.connectionStatus === 'VERIFIED_LIVE'
      ? 'HEALTHY'
      : cgDetail.connectionStatus === 'AUTH_ERROR' || cgDetail.connectionStatus === 'UNREACHABLE'
      ? 'UNAVAILABLE'
      : 'DEGRADED';

    const coingeckoHealth: ProviderHealthEntry & { detail: CoinGeckoSanitizedStatus } = {
      provider: 'coingecko',
      role: 'REFERENCE_AGGREGATED',
      status: cgStatusMapped,
      dataQuality: cgDetail.dataQuality,
      lastSuccessAt: cgDetail.lastSuccessAt,
      lastError: cgDetail.lastError,
      lastHttpStatus: cgDetail.lastHttpStatus,
      backoffUntilIso: cgDetail.backoffUntilIso,
      consecutiveFailures: cgDetail.consecutiveFailures,
      detail: cgDetail,
    };

    const cmcConfigured = Boolean(
      typeof process !== 'undefined' && process.env && (process.env.CMC_API_KEY || '').trim()
    );
    const cmcHealth: ProviderHealthEntry = {
      provider: 'coinmarketcap',
      role: 'REFERENCE_AGGREGATED',
      status: !cmcConfigured
        ? 'PENDING_CREDENTIALS'
        : this.isProviderInBackoff('coinmarketcap')
        ? 'BACKOFF'
        : cmcLive
        ? 'HEALTHY'
        : 'UNAVAILABLE',
      dataQuality: cmcLive ? 'LIVE' : 'UNAVAILABLE',
      lastSuccessAt: cmcLive && cmcSnap ? new Date(cmcSnap.updatedAtMs).toISOString() : null,
      lastError: this.circuits.coinmarketcap.lastError,
      lastHttpStatus: this.circuits.coinmarketcap.lastHttpStatus,
      backoffUntilIso:
        this.circuits.coinmarketcap.backoffUntilMs > now
          ? new Date(this.circuits.coinmarketcap.backoffUntilMs).toISOString()
          : null,
      consecutiveFailures: this.circuits.coinmarketcap.consecutiveFailures,
    };

    let overallDataQuality: MarketDataQuality = 'UNAVAILABLE';
    let overallProvenance: AgentDataProvenance = 'STALE_OR_UNAVAILABLE';
    let executionAllowed = false;
    let executionBlockReason: string | null = 'EXCHANGE_LIVE_FEED_UNAVAILABLE';

    if (binanceFresh && !this.isProviderInBackoff('binance')) {
      overallDataQuality = 'LIVE';
      overallProvenance = 'LIVE_EXCHANGE';
      executionAllowed = true;
      executionBlockReason = null;
    } else if (binanceCached) {
      overallDataQuality = 'CACHED';
      overallProvenance = 'CACHED_EXCHANGE';
      executionAllowed = false;
      executionBlockReason = 'STALE_EXCHANGE_QUOTE_EXECUTION_PAUSED';
    } else if (cgDetail.configured && cgDetail.connectionStatus === 'VERIFIED_LIVE') {
      overallDataQuality = cgDetail.dataQuality === 'LIVE' ? 'DELAYED' : cgDetail.dataQuality;
      overallProvenance = 'REFERENCE_AGGREGATED';
      executionAllowed = false;
      executionBlockReason = 'AGGREGATED_REFERENCE_PRICE_NOT_EXECUTABLE';
    } else if (cmcLive) {
      overallDataQuality = 'DELAYED';
      overallProvenance = 'REFERENCE_AGGREGATED';
      executionAllowed = false;
      executionBlockReason = 'AGGREGATED_REFERENCE_PRICE_NOT_EXECUTABLE';
    }

    return {
      generatedAt: new Date(now).toISOString(),
      primaryExchangeProvider: binanceFresh
        ? exchangeSnap?.source === 'binance_ws'
          ? 'binance_spot_ws'
          : 'binance_spot_rest'
        : 'none',
      overallDataQuality,
      overallProvenance,
      executionAllowed,
      executionBlockReason,
      coalescedRequestsCount: this.coalescedRequestsCount,
      cacheHitsCount: this.cacheHitsCount,
      fallbackActivationsCount: this.fallbackActivationsCount,
      providers: {
        binance: binanceHealth,
        coingecko: coingeckoHealth,
        coinmarketcap: cmcHealth,
      },
    };
  }
}

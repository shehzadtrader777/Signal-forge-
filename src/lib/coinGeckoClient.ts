/**
 * Server-Only CoinGecko Secure Market Data Client
 *
 * Security & Honesty Guarantees:
 * - Reads credentials ONLY from server-side environment variables (COINGECKO_API_KEY,
 *   optional COINGECKO_API_TIER). NEVER uses VITE_* or browser-exposed storage.
 * - Supports explicit Demo (api.coingecko.com + x-cg-demo-api-key) vs
 *   Pro (pro-api.coingecko.com + x-cg-pro-api-key) access tiers.
 * - Never exposes raw or partial API keys in status objects, logs, or error strings.
 * - Never invents a successful connection when credentials are missing (returns PENDING_CREDENTIALS).
 * - Enforces strict HTTP status, JSON schema, timestamp freshness, and 429/503 exponential backoff.
 */

export type CoinGeckoTier = 'demo' | 'pro';

export type MarketDataQuality = 'LIVE' | 'DELAYED' | 'CACHED' | 'SIMULATED' | 'UNAVAILABLE';

export type CoinGeckoConnectionStatus =
  | 'PENDING_CREDENTIALS'
  | 'PENDING_VERIFICATION'
  | 'VERIFIED_LIVE'
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'UNREACHABLE';

export interface CoinGeckoReferenceQuote {
  symbol: string;
  coinGeckoId: string;
  priceUsd: number;
  change24hPercent: number | null;
  volume24hUsd: number | null;
  marketCapUsd: number | null;
  lastUpdatedAtMs: number;
  fetchedAtMs: number;
  dataQuality: MarketDataQuality;
  executableQuote: false;
  provider: 'coingecko';
  tier: CoinGeckoTier;
}

export interface CoinGeckoSanitizedStatus {
  provider: 'coingecko';
  configured: boolean;
  tier: CoinGeckoTier;
  endpointHost: string;
  authHeaderName: 'x-cg-demo-api-key' | 'x-cg-pro-api-key';
  connectionStatus: CoinGeckoConnectionStatus;
  dataQuality: MarketDataQuality;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastLatencyMs: number | null;
  lastHttpStatus: number | null;
  lastError: string | null;
  backoffUntilIso: string | null;
  consecutiveFailures: number;
  cachedSymbolCount: number;
  executableQuoteSupported: false;
  role: 'REFERENCE_AND_FALLBACK_ONLY';
}

export interface CoinGeckoTestResult {
  ok: boolean;
  connectionStatus: CoinGeckoConnectionStatus;
  dataQuality: MarketDataQuality;
  tier: CoinGeckoTier;
  endpointHost: string;
  latencyMs: number;
  httpStatus: number | null;
  pingMessage: string | null;
  sampleQuote: CoinGeckoReferenceQuote | null;
  checkedAt: string;
  message: string;
}

export interface CoinGeckoClientConfig {
  apiKey?: string;
  tier?: CoinGeckoTier;
  fetchImpl?: typeof fetch;
  nowFn?: () => number;
  cacheTtlMs?: number;
  timeoutMs?: number;
  maxBackoffMs?: number;
}

export const SYMBOL_TO_COINGECKO_ID: Readonly<Record<string, string>> = {
  BTCUSDT: 'bitcoin',
  ETHUSDT: 'ethereum',
  SOLUSDT: 'solana',
  BNBUSDT: 'binancecoin',
  XRPUSDT: 'ripple',
  AVAXUSDT: 'avalanche-2',
  LINKUSDT: 'chainlink',
  ADAUSDT: 'cardano',
  DOGEUSDT: 'dogecoin',
  NEARUSDT: 'near',
  SUIUSDT: 'sui',
  TONUSDT: 'the-open-network',
  ARBUSDT: 'arbitrum',
  OPUSDT: 'optimism',
  DOTUSDT: 'polkadot',
  LTCUSDT: 'litecoin',
  TRXUSDT: 'tron',
  SHIBUSDT: 'shiba-inu',
  PEPEUSDT: 'pepe',
};

const COINGECKO_DEMO_BASE_URL = 'https://api.coingecko.com/api/v3';
const COINGECKO_PRO_BASE_URL = 'https://pro-api.coingecko.com/api/v3';
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_DELAYED_THRESHOLD_MS = 180_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BACKOFF_MS = 5 * 60_000;

export function resolveCoinGeckoEnvConfig(
  env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}
): {
  apiKey: string;
  tier: CoinGeckoTier;
  baseUrl: string;
  endpointHost: string;
  authHeaderName: 'x-cg-demo-api-key' | 'x-cg-pro-api-key';
  configured: boolean;
} {
  const explicitKey = (env.COINGECKO_API_KEY || '').trim();
  const proKey = (env.COINGECKO_PRO_API_KEY || '').trim();
  const demoKey = (env.COINGECKO_DEMO_API_KEY || '').trim();
  const apiKey = explicitKey || proKey || demoKey;

  const rawTier = (env.COINGECKO_API_TIER || '').trim().toLowerCase();
  let tier: CoinGeckoTier;
  if (rawTier === 'pro') {
    tier = 'pro';
  } else if (rawTier === 'demo') {
    tier = 'demo';
  } else if (!explicitKey && proKey) {
    tier = 'pro';
  } else {
    tier = 'demo';
  }

  const baseUrl = tier === 'pro' ? COINGECKO_PRO_BASE_URL : COINGECKO_DEMO_BASE_URL;
  const endpointHost = tier === 'pro' ? 'pro-api.coingecko.com' : 'api.coingecko.com';
  const authHeaderName = tier === 'pro' ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key';

  return {
    apiKey,
    tier,
    baseUrl,
    endpointHost,
    authHeaderName,
    configured: apiKey.length > 0,
  };
}

export function normalizeCoinGeckoSymbol(symbol: string): string {
  const cleaned = String(symbol || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return '';
  return cleaned.endsWith('USDT') ? cleaned : `${cleaned}USDT`;
}

export function resolveCoinGeckoIdForSymbol(symbol: string): string | null {
  const norm = normalizeCoinGeckoSymbol(symbol);
  return SYMBOL_TO_COINGECKO_ID[norm] ?? null;
}

function sanitizeErrorMessage(err: unknown, apiKey: string): string {
  const raw = err instanceof Error ? err.message : String(err || 'Unknown CoinGecko error');
  if (!apiKey) return raw.slice(0, 180);
  return raw.split(apiKey).join('[REDACTED]').slice(0, 180);
}

function parseRetryAfterMs(headerVal: string | null): number | null {
  if (!headerVal) return null;
  const trimmed = headerVal.trim();
  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds) && asSeconds > 0) {
    return Math.min(DEFAULT_MAX_BACKOFF_MS, Math.round(asSeconds * 1000));
  }
  const asDateMs = Date.parse(trimmed);
  if (Number.isFinite(asDateMs)) {
    const delta = asDateMs - Date.now();
    if (delta > 0) return Math.min(DEFAULT_MAX_BACKOFF_MS, delta);
  }
  return null;
}

export class CoinGeckoMarketClient {
  private readonly explicitApiKey?: string;
  private readonly explicitTier?: CoinGeckoTier;
  private readonly fetchImpl: typeof fetch;
  private readonly nowFn: () => number;
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private readonly maxBackoffMs: number;

  private readonly quoteCache = new Map<string, CoinGeckoReferenceQuote>();
  private inFlightBatch: Map<string, Promise<Record<string, CoinGeckoReferenceQuote>>> = new Map();

  private connectionStatus: CoinGeckoConnectionStatus = 'PENDING_CREDENTIALS';
  private dataQuality: MarketDataQuality = 'UNAVAILABLE';
  private lastCheckedAt: string | null = null;
  private lastSuccessAt: string | null = null;
  private lastLatencyMs: number | null = null;
  private lastHttpStatus: number | null = null;
  private lastError: string | null = null;
  private backoffUntilMs = 0;
  private consecutiveFailures = 0;

  constructor(config: CoinGeckoClientConfig = {}) {
    this.explicitApiKey = config.apiKey;
    this.explicitTier = config.tier;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.nowFn = config.nowFn ?? (() => Date.now());
    this.cacheTtlMs = Math.max(5_000, config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
    this.timeoutMs = Math.max(1_000, config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.maxBackoffMs = Math.max(10_000, config.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS);
  }

  private getResolvedConfig() {
    if (this.explicitApiKey !== undefined || this.explicitTier !== undefined) {
      const envFallback = resolveCoinGeckoEnvConfig();
      const apiKey = (this.explicitApiKey ?? envFallback.apiKey).trim();
      const tier = this.explicitTier ?? envFallback.tier;
      return {
        apiKey,
        tier,
        baseUrl: tier === 'pro' ? COINGECKO_PRO_BASE_URL : COINGECKO_DEMO_BASE_URL,
        endpointHost: tier === 'pro' ? 'pro-api.coingecko.com' : 'api.coingecko.com',
        authHeaderName: (tier === 'pro' ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key') as
          | 'x-cg-demo-api-key'
          | 'x-cg-pro-api-key',
        configured: apiKey.length > 0,
      };
    }
    return resolveCoinGeckoEnvConfig();
  }

  private recordFailure(status: CoinGeckoConnectionStatus, httpStatus: number | null, message: string, retryAfterMs?: number | null) {
    const now = this.nowFn();
    this.consecutiveFailures += 1;
    this.connectionStatus = status;
    this.lastCheckedAt = new Date(now).toISOString();
    this.lastHttpStatus = httpStatus;
    this.lastError = message.slice(0, 180);
    if (this.quoteCache.size === 0) {
      this.dataQuality = 'UNAVAILABLE';
    } else {
      this.dataQuality = 'CACHED';
    }
    if (httpStatus === 429 || (httpStatus !== null && httpStatus >= 500) || status === 'RATE_LIMITED' || status === 'UNREACHABLE') {
      const expDelay = Math.min(this.maxBackoffMs, 5_000 * Math.pow(2, Math.min(6, this.consecutiveFailures - 1)));
      const backoffMs = retryAfterMs && retryAfterMs > 0 ? Math.max(retryAfterMs, expDelay) : expDelay;
      this.backoffUntilMs = now + Math.min(this.maxBackoffMs, backoffMs);
    }
  }

  private recordSuccess(latencyMs: number, httpStatus: number, quality: MarketDataQuality) {
    const now = this.nowFn();
    this.consecutiveFailures = 0;
    this.backoffUntilMs = 0;
    this.connectionStatus = 'VERIFIED_LIVE';
    this.dataQuality = quality;
    this.lastCheckedAt = new Date(now).toISOString();
    this.lastSuccessAt = new Date(now).toISOString();
    this.lastLatencyMs = latencyMs;
    this.lastHttpStatus = httpStatus;
    this.lastError = null;
  }

  public isBackoffActive(): boolean {
    return this.backoffUntilMs > this.nowFn();
  }

  public getCachedQuote(symbol: string): CoinGeckoReferenceQuote | null {
    const norm = normalizeCoinGeckoSymbol(symbol);
    const cached = this.quoteCache.get(norm);
    if (!cached) return null;
    const ageMs = Math.max(0, this.nowFn() - cached.fetchedAtMs);
    const dataQuality: MarketDataQuality =
      ageMs <= this.cacheTtlMs
        ? cached.dataQuality
        : ageMs <= DEFAULT_DELAYED_THRESHOLD_MS
        ? 'CACHED'
        : 'DELAYED';
    return {
      ...cached,
      dataQuality,
    };
  }

  public getSanitizedStatus(): CoinGeckoSanitizedStatus {
    const cfg = this.getResolvedConfig();
    const now = this.nowFn();
    const effectiveStatus: CoinGeckoConnectionStatus = !cfg.configured
      ? 'PENDING_CREDENTIALS'
      : this.connectionStatus === 'PENDING_CREDENTIALS' && this.lastCheckedAt === null
      ? 'PENDING_VERIFICATION'
      : this.connectionStatus;
    const effectiveQuality: MarketDataQuality = !cfg.configured ? 'UNAVAILABLE' : this.dataQuality;

    return {
      provider: 'coingecko',
      configured: cfg.configured,
      tier: cfg.tier,
      endpointHost: cfg.endpointHost,
      authHeaderName: cfg.authHeaderName,
      connectionStatus: effectiveStatus,
      dataQuality: effectiveQuality,
      lastCheckedAt: this.lastCheckedAt,
      lastSuccessAt: this.lastSuccessAt,
      lastLatencyMs: this.lastLatencyMs,
      lastHttpStatus: this.lastHttpStatus,
      lastError: !cfg.configured
        ? 'COINGECKO_API_KEY is not configured in server environment.'
        : this.lastError,
      backoffUntilIso: this.backoffUntilMs > now ? new Date(this.backoffUntilMs).toISOString() : null,
      consecutiveFailures: this.consecutiveFailures,
      cachedSymbolCount: this.quoteCache.size,
      executableQuoteSupported: false,
      role: 'REFERENCE_AND_FALLBACK_ONLY',
    };
  }

  private async requestJson(pathWithQuery: string): Promise<{
    ok: boolean;
    httpStatus: number;
    latencyMs: number;
    data: unknown;
    retryAfterMs: number | null;
    errorMessage: string | null;
  }> {
    const cfg = this.getResolvedConfig();
    const startedAt = this.nowFn();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${cfg.baseUrl}${pathWithQuery}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          [cfg.authHeaderName]: cfg.apiKey,
        },
        signal: controller.signal,
      });
      const latencyMs = Math.max(1, this.nowFn() - startedAt);
      const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after') ?? null);
      if (!response.ok) {
        return {
          ok: false,
          httpStatus: response.status,
          latencyMs,
          data: null,
          retryAfterMs,
          errorMessage: `CoinGecko HTTP ${response.status} (${cfg.tier.toUpperCase()} tier)`,
        };
      }
      const data = await response.json();
      return {
        ok: true,
        httpStatus: response.status,
        latencyMs,
        data,
        retryAfterMs,
        errorMessage: null,
      };
    } catch (err) {
      const latencyMs = Math.max(1, this.nowFn() - startedAt);
      return {
        ok: false,
        httpStatus: 0,
        latencyMs,
        data: null,
        retryAfterMs: null,
        errorMessage: sanitizeErrorMessage(err, cfg.apiKey),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Safe, low-volume, read-only connection probe (/ping + single BTC reference price).
   * Explicitly returns PENDING_CREDENTIALS if COINGECKO_API_KEY is unset.
   */
  public async testConnection(): Promise<CoinGeckoTestResult> {
    const cfg = this.getResolvedConfig();
    const checkedAt = new Date(this.nowFn()).toISOString();

    if (!cfg.configured) {
      this.connectionStatus = 'PENDING_CREDENTIALS';
      this.dataQuality = 'UNAVAILABLE';
      this.lastCheckedAt = checkedAt;
      this.lastHttpStatus = null;
      this.lastError = 'COINGECKO_API_KEY is not configured in server environment.';
      return {
        ok: false,
        connectionStatus: 'PENDING_CREDENTIALS',
        dataQuality: 'UNAVAILABLE',
        tier: cfg.tier,
        endpointHost: cfg.endpointHost,
        latencyMs: 0,
        httpStatus: null,
        pingMessage: null,
        sampleQuote: null,
        checkedAt,
        message: 'CoinGecko API key is not configured on the server. Set server-only COINGECKO_API_KEY and optional COINGECKO_API_TIER (demo|pro).',
      };
    }

    if (this.isBackoffActive()) {
      const untilIso = new Date(this.backoffUntilMs).toISOString();
      return {
        ok: false,
        connectionStatus: 'RATE_LIMITED',
        dataQuality: this.quoteCache.size > 0 ? 'CACHED' : 'UNAVAILABLE',
        tier: cfg.tier,
        endpointHost: cfg.endpointHost,
        latencyMs: 0,
        httpStatus: 429,
        pingMessage: null,
        sampleQuote: this.getCachedQuote('BTCUSDT'),
        checkedAt,
        message: `CoinGecko circuit-breaker backoff active until ${untilIso}.`,
      };
    }

    const pingRes = await this.requestJson('/ping');
    if (!pingRes.ok) {
      const status: CoinGeckoConnectionStatus =
        pingRes.httpStatus === 401 || pingRes.httpStatus === 403
          ? 'AUTH_ERROR'
          : pingRes.httpStatus === 429
          ? 'RATE_LIMITED'
          : 'UNREACHABLE';
      this.recordFailure(status, pingRes.httpStatus || null, pingRes.errorMessage || 'CoinGecko ping failed', pingRes.retryAfterMs);
      return {
        ok: false,
        connectionStatus: status,
        dataQuality: this.dataQuality,
        tier: cfg.tier,
        endpointHost: cfg.endpointHost,
        latencyMs: pingRes.latencyMs,
        httpStatus: pingRes.httpStatus || null,
        pingMessage: null,
        sampleQuote: this.getCachedQuote('BTCUSDT'),
        checkedAt: new Date(this.nowFn()).toISOString(),
        message:
          status === 'AUTH_ERROR'
            ? `CoinGecko rejected credentials (HTTP ${pingRes.httpStatus}). Verify COINGECKO_API_KEY matches COINGECKO_API_TIER=${cfg.tier}.`
            : pingRes.errorMessage || 'CoinGecko ping failed.',
      };
    }

    const pingObj = pingRes.data && typeof pingRes.data === 'object' ? (pingRes.data as Record<string, unknown>) : null;
    const pingMessage = typeof pingObj?.gecko_says === 'string' ? pingObj.gecko_says : null;
    if (!pingMessage) {
      this.recordFailure('UNREACHABLE', pingRes.httpStatus, 'CoinGecko /ping returned invalid schema');
      return {
        ok: false,
        connectionStatus: 'UNREACHABLE',
        dataQuality: this.dataQuality,
        tier: cfg.tier,
        endpointHost: cfg.endpointHost,
        latencyMs: pingRes.latencyMs,
        httpStatus: pingRes.httpStatus,
        pingMessage: null,
        sampleQuote: null,
        checkedAt: new Date(this.nowFn()).toISOString(),
        message: 'CoinGecko /ping response failed schema validation.',
      };
    }

    // Follow up with a single-pair read-only reference quote verification
    const quotes = await this.fetchReferenceQuotes(['BTCUSDT'], { forceRefresh: true });
    const btcQuote = quotes.BTCUSDT ?? null;

    if (!btcQuote) {
      return {
        ok: false,
        connectionStatus: this.connectionStatus,
        dataQuality: this.dataQuality,
        tier: cfg.tier,
        endpointHost: cfg.endpointHost,
        latencyMs: pingRes.latencyMs,
        httpStatus: this.lastHttpStatus,
        pingMessage,
        sampleQuote: null,
        checkedAt: new Date(this.nowFn()).toISOString(),
        message: this.lastError || 'CoinGecko /ping succeeded but reference price check failed.',
      };
    }

    return {
      ok: true,
      connectionStatus: 'VERIFIED_LIVE',
      dataQuality: btcQuote.dataQuality,
      tier: cfg.tier,
      endpointHost: cfg.endpointHost,
      latencyMs: this.lastLatencyMs ?? pingRes.latencyMs,
      httpStatus: 200,
      pingMessage,
      sampleQuote: btcQuote,
      checkedAt: new Date(this.nowFn()).toISOString(),
      message: `CoinGecko ${cfg.tier.toUpperCase()} verified read-only (${pingMessage}). Reference BTC/USD: $${btcQuote.priceUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}.`,
    };
  }

  /**
   * Low-volume batched read-only price lookup with TTL caching, in-flight request coalescing,
   * schema validation, timestamp staleness classification, and 429/503 exponential backoff.
   */
  public async fetchReferenceQuotes(
    symbols: string[],
    options: { forceRefresh?: boolean } = {}
  ): Promise<Record<string, CoinGeckoReferenceQuote>> {
    const cfg = this.getResolvedConfig();
    const now = this.nowFn();
    const normalizedSymbols = Array.from(
      new Set(symbols.map(normalizeCoinGeckoSymbol).filter((sym) => Boolean(SYMBOL_TO_COINGECKO_ID[sym])))
    ).sort();

    if (normalizedSymbols.length === 0) return {};

    const results: Record<string, CoinGeckoReferenceQuote> = {};
    const missingSymbols: string[] = [];

    for (const sym of normalizedSymbols) {
      const cached = this.quoteCache.get(sym);
      if (cached && !options.forceRefresh && now - cached.fetchedAtMs < this.cacheTtlMs) {
        results[sym] = {
          ...cached,
          dataQuality: now - cached.lastUpdatedAtMs > DEFAULT_DELAYED_THRESHOLD_MS ? 'DELAYED' : 'CACHED',
        };
      } else {
        missingSymbols.push(sym);
      }
    }

    if (missingSymbols.length === 0) {
      return results;
    }

    if (!cfg.configured) {
      this.connectionStatus = 'PENDING_CREDENTIALS';
      this.dataQuality = 'UNAVAILABLE';
      return results;
    }

    if (this.isBackoffActive()) {
      for (const sym of missingSymbols) {
        const stale = this.getCachedQuote(sym);
        if (stale) results[sym] = stale;
      }
      return results;
    }

    const batchKey = missingSymbols.join(',');
    const existing = this.inFlightBatch.get(batchKey);
    if (existing) {
      const coalesced = await existing;
      return { ...results, ...coalesced };
    }

    const requestPromise = (async (): Promise<Record<string, CoinGeckoReferenceQuote>> => {
      const ids = missingSymbols.map((sym) => SYMBOL_TO_COINGECKO_ID[sym]).join(',');
      const query = `/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true`;
      const res = await this.requestJson(query);
      const fetched: Record<string, CoinGeckoReferenceQuote> = {};

      if (!res.ok) {
        const status: CoinGeckoConnectionStatus =
          res.httpStatus === 401 || res.httpStatus === 403
            ? 'AUTH_ERROR'
            : res.httpStatus === 429
            ? 'RATE_LIMITED'
            : 'UNREACHABLE';
        this.recordFailure(status, res.httpStatus || null, res.errorMessage || 'CoinGecko price fetch failed', res.retryAfterMs);
        for (const sym of missingSymbols) {
          const cached = this.getCachedQuote(sym);
          if (cached) fetched[sym] = cached;
        }
        return fetched;
      }

      if (!res.data || typeof res.data !== 'object' || Array.isArray(res.data)) {
        this.recordFailure('UNREACHABLE', res.httpStatus, 'CoinGecko /simple/price returned non-object payload');
        return fetched;
      }

      const payload = res.data as Record<string, Record<string, unknown>>;
      const fetchedAtMs = this.nowFn();
      let validCount = 0;

      for (const sym of missingSymbols) {
        const cgId = SYMBOL_TO_COINGECKO_ID[sym];
        const entry = payload[cgId];
        if (!entry || typeof entry !== 'object') continue;
        const priceUsd = Number(entry.usd);
        if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue;

        const rawUpdatedSec = Number(entry.last_updated_at);
        const lastUpdatedAtMs =
          Number.isFinite(rawUpdatedSec) && rawUpdatedSec > 1_500_000_000
            ? rawUpdatedSec * 1000
            : fetchedAtMs;
        const sourceAgeMs = Math.max(0, fetchedAtMs - lastUpdatedAtMs);
        const quality: MarketDataQuality = sourceAgeMs > DEFAULT_DELAYED_THRESHOLD_MS ? 'DELAYED' : 'LIVE';

        const rawChange = Number(entry.usd_24h_change);
        const rawVol = Number(entry.usd_24h_vol);
        const rawMcap = Number(entry.usd_market_cap);

        const quote: CoinGeckoReferenceQuote = {
          symbol: sym,
          coinGeckoId: cgId,
          priceUsd,
          change24hPercent: Number.isFinite(rawChange) ? Number(rawChange.toFixed(2)) : null,
          volume24hUsd: Number.isFinite(rawVol) && rawVol >= 0 ? Math.round(rawVol) : null,
          marketCapUsd: Number.isFinite(rawMcap) && rawMcap >= 0 ? Math.round(rawMcap) : null,
          lastUpdatedAtMs,
          fetchedAtMs,
          dataQuality: quality,
          executableQuote: false,
          provider: 'coingecko',
          tier: cfg.tier,
        };
        this.quoteCache.set(sym, quote);
        fetched[sym] = quote;
        validCount += 1;
      }

      if (validCount > 0) {
        const overallQuality: MarketDataQuality = Object.values(fetched).some((q) => q.dataQuality === 'LIVE')
          ? 'LIVE'
          : 'DELAYED';
        this.recordSuccess(res.latencyMs, res.httpStatus, overallQuality);
      } else {
        this.recordFailure('UNREACHABLE', res.httpStatus, 'CoinGecko response contained no valid positive quotes');
      }
      return fetched;
    })().finally(() => {
      this.inFlightBatch.delete(batchKey);
    });

    this.inFlightBatch.set(batchKey, requestPromise);
    const fetched = await requestPromise;
    return { ...results, ...fetched };
  }
}

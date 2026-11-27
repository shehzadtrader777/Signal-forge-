/**
 * Signal Forge — Step 2 Trustworthy Market Data & Freshness Guard
 *
 * Wraps real OHLCV candles and optional derivatives/order-book feeds with explicit
 * provenance, provider timestamps, structural integrity checks, and freshness gates.
 *
 * Strict Honesty & Safety Invariants:
 *  1. Every market data snapshot explicitly declares its provider and whether it is synthetic.
 *  2. Execution decisions MUST be blocked whenever market data is missing, stale,
 *     structurally inconsistent (NaN/<=0/inverted high-low), or unlabeled synthetic.
 *  3. Historical backtests may inspect verified archived candles, while Paper/Demo
 *     execution requires fresh verified feed data (or explicitly acknowledged simulation
 *     only in Paper mode when operator opts in — never silently disguised as live).
 */

import type { Candle, Timeframe } from './marketData';

export type MarketDataProvider =
  | 'BINANCE_SPOT'
  | 'BINANCE_FUTURES'
  | 'OKX_DEMO'
  | 'OKX_MARKET'
  | 'SIMULATED_FALLBACK_CACHE'
  | 'UNKNOWN';

export type DataFreshnessStatus = 'FRESH' | 'STALE' | 'MISSING' | 'INCONSISTENT';

export interface DerivativesSnapshot {
  readonly fundingRate8h: number | null;
  readonly openInterestUsd: number | null;
  readonly spotMarkBasisBps: number | null;
  readonly liquidations24hUsd: number | null;
  readonly orderBookImbalance: number | null; // -1 to +1
  readonly spreadBps: number | null;
  readonly provider: MarketDataProvider | 'UNAVAILABLE';
  readonly observedAtMs: number | null;
  readonly verified: boolean;
}

export interface MarketDataSnapshotInput {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly provider: MarketDataProvider;
  readonly candles: readonly Candle[];
  readonly fetchedAtMs: number;
  readonly nowMs?: number;
  readonly maxDataAgeMs?: number;
  readonly isSyntheticSimulation: boolean;
  readonly derivatives?: DerivativesSnapshot | null;
  readonly requireVerifiedLiveFeed?: boolean;
}

export interface MarketDataTrustEvaluation {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly provider: MarketDataProvider;
  readonly providerLabel: string;
  readonly isSyntheticSimulation: boolean;
  readonly freshness: DataFreshnessStatus;
  readonly ageMs: number | null;
  readonly maxDataAgeMs: number;
  readonly candleCount: number;
  readonly latestCandleTimeSec: number | null;
  readonly latestClosePrice: number | null;
  readonly realizedVolatilityPct: number;
  readonly atr14: number;
  readonly derivativesVerified: boolean;
  readonly executionAllowed: boolean;
  readonly blockingReasons: readonly string[];
  readonly warnings: readonly string[];
  readonly evaluatedAtIso: string;
}

export const DEFAULT_MAX_DATA_AGE_MS = 180_000; // 3 minutes strict execution freshness

export function formatProviderLabel(provider: MarketDataProvider, isSynthetic: boolean): string {
  switch (provider) {
    case 'BINANCE_SPOT':
      return isSynthetic ? 'Binance Spot (Synthetic Fallback)' : 'Binance Spot (Verified REST/WS)';
    case 'BINANCE_FUTURES':
      return isSynthetic ? 'Binance USD-M Futures (Synthetic Fallback)' : 'Binance USD-M Futures (Verified)';
    case 'OKX_DEMO':
      return 'OKX Demo Environment Feed';
    case 'OKX_MARKET':
      return 'OKX Public Market Feed';
    case 'SIMULATED_FALLBACK_CACHE':
      return 'Simulated Fallback Cache (Non-Live)';
    default:
      return 'Unknown / Unverified Provider';
  }
}

export function validateCandleSeriesIntegrity(candles: readonly Candle[]): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  if (!Array.isArray(candles) || candles.length === 0) {
    return { valid: false, issues: ['OHLCV candle series is empty or missing.'] };
  }
  if (candles.length < 20) {
    issues.push(`Insufficient candle history (${candles.length} bars; minimum 20 required for strategy structure).`);
  }

  let prevTime = -Infinity;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (
      !c ||
      !Number.isFinite(c.time) ||
      !Number.isFinite(c.open) ||
      !Number.isFinite(c.high) ||
      !Number.isFinite(c.low) ||
      !Number.isFinite(c.close) ||
      !Number.isFinite(c.volume)
    ) {
      issues.push(`Candle index ${i} contains non-finite OHLCV values.`);
      break;
    }
    if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0 || c.volume < 0) {
      issues.push(`Candle index ${i} contains zero or negative price/volume.`);
      break;
    }
    if (c.high < c.low || c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close)) {
      issues.push(`Candle index ${i} violates OHLC bounds (high < low or body outside range).`);
      break;
    }
    if (c.time <= prevTime) {
      issues.push(`Candle timestamps are not strictly ascending at index ${i}.`);
      break;
    }
    prevTime = c.time;
  }

  return { valid: issues.length === 0, issues };
}

export function computeSeriesAtr14(candles: readonly Candle[]): number {
  if (candles.length < 2) return 0;
  const period = Math.min(14, candles.length - 1);
  let trSum = 0;
  const start = candles.length - period;
  for (let i = start; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    trSum += tr;
  }
  return Number((trSum / period).toFixed(6));
}

export function computeRealizedVolatilityPct(candles: readonly Candle[], window = 20): number {
  if (candles.length < 3) return 0;
  const slice = candles.slice(-Math.min(window + 1, candles.length));
  const returns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1].close > 0) {
      returns.push((slice[i].close - slice[i - 1].close) / slice[i - 1].close);
    }
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((acc, r) => acc + (r - mean) * (r - mean), 0) / (returns.length - 1);
  return Number((Math.sqrt(variance) * 100).toFixed(3));
}

export function evaluateMarketDataTrust(
  input: MarketDataSnapshotInput
): MarketDataTrustEvaluation {
  const nowMs = input.nowMs ?? Date.now();
  const maxDataAgeMs = Math.max(10_000, input.maxDataAgeMs ?? DEFAULT_MAX_DATA_AGE_MS);
  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  const integrity = validateCandleSeriesIntegrity(input.candles);
  const candleCount = Array.isArray(input.candles) ? input.candles.length : 0;
  const latest = candleCount > 0 ? input.candles[candleCount - 1] : null;
  const ageMs = Number.isFinite(input.fetchedAtMs) ? Math.max(0, nowMs - input.fetchedAtMs) : null;

  let freshness: DataFreshnessStatus = 'FRESH';
  if (candleCount === 0 || !latest) {
    freshness = 'MISSING';
    blockingReasons.push('No OHLCV market candles available for symbol.');
  } else if (!integrity.valid) {
    freshness = 'INCONSISTENT';
    blockingReasons.push(...integrity.issues);
  } else if (ageMs === null || ageMs > maxDataAgeMs) {
    freshness = 'STALE';
    blockingReasons.push(
      `Market data snapshot is stale (${ageMs === null ? 'unknown age' : `${Math.round(ageMs / 1000)}s old`} > ${Math.round(maxDataAgeMs / 1000)}s limit).`
    );
  }

  if (input.provider === 'UNKNOWN') {
    blockingReasons.push('Market data provider is unknown/unverified.');
  }

  if (input.isSyntheticSimulation || input.provider === 'SIMULATED_FALLBACK_CACHE') {
    if (input.requireVerifiedLiveFeed !== false) {
      blockingReasons.push(
        'Market data is a synthetic fallback cache — live/demo execution blocked until verified exchange feed restores.'
      );
    } else {
      warnings.push(
        'Synthetic fallback candle series explicitly allowed for isolated Paper simulation only.'
      );
    }
  }

  const derivativesVerified = Boolean(
    input.derivatives &&
      input.derivatives.verified &&
      input.derivatives.provider !== 'UNAVAILABLE'
  );
  if (!derivativesVerified) {
    warnings.push(
      'Verified derivatives/order-flow telemetry unavailable — order-flow/funding strategies must remain inactive or degraded.'
    );
  }

  const atr14 = integrity.valid ? computeSeriesAtr14(input.candles) : 0;
  const realizedVolatilityPct = integrity.valid ? computeRealizedVolatilityPct(input.candles) : 0;

  return {
    symbol: input.symbol,
    timeframe: input.timeframe,
    provider: input.provider,
    providerLabel: formatProviderLabel(input.provider, input.isSyntheticSimulation),
    isSyntheticSimulation:
      input.isSyntheticSimulation || input.provider === 'SIMULATED_FALLBACK_CACHE',
    freshness,
    ageMs,
    maxDataAgeMs,
    candleCount,
    latestCandleTimeSec: latest ? latest.time : null,
    latestClosePrice: latest ? latest.close : null,
    realizedVolatilityPct,
    atr14,
    derivativesVerified,
    executionAllowed: blockingReasons.length === 0,
    blockingReasons,
    warnings,
    evaluatedAtIso: new Date(nowMs).toISOString(),
  };
}

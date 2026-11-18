import { TRACKED_COINS, type CoinMeta, type TickerSnapshot } from './marketData';

/** Recalibrated real-time telemetry constants */
export const TELEMETRY_POLL_INTERVAL_MS = 12_000;
export const WS_FLUSH_INTERVAL_MS = 250;
export const WS_STALE_TIMEOUT_MS = 2_500;
export const DETERMINISTIC_FALLBACK_TICK_MS = 3_000;

export interface WsBufferedTickerFrame {
  symbol: string;
  price: number;
  change24hPercent: number;
  high24h: number;
  low24h: number;
  volume24hUsd: number;
  epoch: number;
  receivedAtMs: number;
}

export interface TelemetryLatencyMetrics {
  lastLatencyMs: number;
  avgLatencyMs: number;
  jitterMs: number;
  pollIntervalMs: number;
  wsFlushIntervalMs: number;
  syncEpoch: number;
  flushedFramesTotal: number;
  sampleCount: number;
  fallbackEnforced: boolean;
  lastSyncAt: string;
}

/**
 * Coalescing WebSocket frame buffer with epoch-based invalidation so flushing or
 * reconnecting drops all stale queued packets cleanly before resyncing UI state.
 */
export class WsFrameBuffer {
  private buffer = new Map<string, WsBufferedTickerFrame>();
  private epoch = 1;
  private flushedFramesTotal = 0;

  getCurrentEpoch(): number {
    return this.epoch;
  }

  getPendingCount(): number {
    return this.buffer.size;
  }

  getFlushedFramesTotal(): number {
    return this.flushedFramesTotal;
  }

  enqueue(frame: WsBufferedTickerFrame): boolean {
    if (frame.epoch !== this.epoch) {
      return false;
    }
    if (!Number.isFinite(frame.price) || frame.price <= 0) {
      return false;
    }
    this.buffer.set(frame.symbol.toUpperCase(), {
      ...frame,
      symbol: frame.symbol.toUpperCase(),
    });
    return true;
  }

  flush(): WsBufferedTickerFrame[] {
    if (this.buffer.size === 0) return [];
    const frames = Array.from(this.buffer.values());
    this.flushedFramesTotal += frames.length;
    this.buffer.clear();
    return frames;
  }

  discardAndBumpEpoch(): number {
    this.flushedFramesTotal += this.buffer.size;
    this.buffer.clear();
    this.epoch += 1;
    return this.epoch;
  }
}

const DEFAULT_FALLBACK_CHANGES: Record<string, number> = {
  BTCUSDT: 3.42,
  ETHUSDT: 2.18,
  SOLUSDT: 6.84,
  BNBUSDT: 1.05,
  XRPUSDT: -2.74,
  AVAXUSDT: 4.19,
  LINKUSDT: 3.15,
  ADAUSDT: -1.42,
  DOGEUSDT: -3.28,
  NEARUSDT: 2.64,
};

function symbolPhaseSeed(symbol: string): number {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0;
  }
  return (hash % 360) * (Math.PI / 180);
}

/**
 * Builds clean, deterministic baseline snapshots for all tracked & discovered coins.
 */
export function buildDeterministicTickerSnapshot(
  coins: CoinMeta[] = TRACKED_COINS
): Record<string, TickerSnapshot> {
  const map: Record<string, TickerSnapshot> = {};
  for (const coin of coins) {
    const baseChange = DEFAULT_FALLBACK_CHANGES[coin.symbol] ?? 1.4;
    map[coin.symbol] = {
      symbol: coin.symbol,
      baseAsset: coin.baseAsset,
      name: coin.name,
      price: coin.referencePrice,
      change24hPercent: baseChange,
      high24h: Number((coin.referencePrice * 1.032).toPrecision(6)),
      low24h: Number((coin.referencePrice * 0.968).toPrecision(6)),
      volume24hUsd: coin.referencePrice >= 1000 ? 1_450_000_000 : 320_000_000,
      isLiveWs: false,
    };
  }
  return map;
}

/**
 * Deterministic bounded harmonic fallback step (zero Math.random()).
 * Guarantees identical state transitions for identical inputs and keeps prices
 * anchored within +/-0.32% of baseline reference price so fallback never drifts wildly.
 */
export function stepDeterministicFallbackTickers(
  prev: Record<string, TickerSnapshot>,
  coins: CoinMeta[],
  stepIndex: number
): Record<string, TickerSnapshot> {
  const refMap = new Map<string, CoinMeta>(coins.map((c) => [c.symbol, c]));
  const next: Record<string, TickerSnapshot> = {};

  for (const [sym, cur] of Object.entries(prev)) {
    const meta = refMap.get(sym);
    const anchorPrice = meta?.referencePrice ?? cur.price;
    const baseChange = DEFAULT_FALLBACK_CHANGES[sym] ?? cur.change24hPercent;
    const phase = symbolPhaseSeed(sym);

    // Bounded deterministic harmonic wave in [-0.0032, +0.0032]
    const wave =
      Math.sin(stepIndex * 0.42 + phase) * 0.0021 +
      Math.cos(stepIndex * 0.19 + phase * 0.5) * 0.0011;

    const deterministicPrice = Number((anchorPrice * (1 + wave)).toPrecision(6));
    const deterministicChange = Number((baseChange + wave * 100).toFixed(2));

    next[sym] = {
      ...cur,
      price: deterministicPrice,
      change24hPercent: deterministicChange,
      high24h: Math.max(cur.high24h, deterministicPrice),
      low24h: Math.min(cur.low24h, deterministicPrice),
      isLiveWs: false,
    };
  }

  return next;
}

/**
 * Tracks calibrated EWMA telemetry round-trip latency and jitter.
 */
export function updateLatencyMetrics(
  prev: TelemetryLatencyMetrics,
  measuredRttMs: number,
  options: {
    fallbackEnforced: boolean;
    syncEpoch?: number;
    flushedFramesTotal?: number;
    timestamp?: string;
  }
): TelemetryLatencyMetrics {
  const sample = Math.max(1, Math.round(measuredRttMs));
  const count = prev.sampleCount + 1;
  const alpha = count === 1 ? 1 : 0.35;
  const avg = Math.round(prev.avgLatencyMs * (1 - alpha) + sample * alpha);
  const delta = Math.abs(sample - prev.avgLatencyMs);
  const jitter = count === 1 ? 0 : Math.round(prev.jitterMs * 0.65 + delta * 0.35);

  return {
    lastLatencyMs: sample,
    avgLatencyMs: avg,
    jitterMs: jitter,
    pollIntervalMs: TELEMETRY_POLL_INTERVAL_MS,
    wsFlushIntervalMs: WS_FLUSH_INTERVAL_MS,
    syncEpoch: options.syncEpoch ?? prev.syncEpoch,
    flushedFramesTotal: options.flushedFramesTotal ?? prev.flushedFramesTotal,
    sampleCount: count,
    fallbackEnforced: options.fallbackEnforced,
    lastSyncAt: options.timestamp ?? new Date().toISOString(),
  };
}

export function createInitialLatencyMetrics(): TelemetryLatencyMetrics {
  return {
    lastLatencyMs: 0,
    avgLatencyMs: 0,
    jitterMs: 0,
    pollIntervalMs: TELEMETRY_POLL_INTERVAL_MS,
    wsFlushIntervalMs: WS_FLUSH_INTERVAL_MS,
    syncEpoch: 1,
    flushedFramesTotal: 0,
    sampleCount: 0,
    fallbackEnforced: true,
    lastSyncAt: new Date().toISOString(),
  };
}

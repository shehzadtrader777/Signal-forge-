import type { Candle } from './marketData';

export type PriceParityStatus = 'LOCKED' | 'RECONCILING' | 'DRIFT_RESOLVED' | 'AWAITING_WS';

export interface PriceSyncTelemetry {
  symbol: string;
  tradingViewClose: number;
  binanceWsPrice: number;
  discrepancyBps: number;
  discrepancyPct: number;
  parityStatus: PriceParityStatus;
  driftEventsResolved: number;
  intrabarTicksStitched: number;
  lastSyncedAtMs: number;
}

export interface IntrabarStitchResult {
  updatedBar: Candle;
  requiresFullReanchor: boolean;
  discrepancyBps: number;
  discrepancyPct: number;
  parityStatus: PriceParityStatus;
}

export const DEFAULT_PARITY_TOLERANCE_BPS = 5; // 0.05% tight TradingView <-> Binance WS lock
export const FULL_REANCHOR_THRESHOLD_BPS = 35; // 0.35% forces atomic candle series re-anchor

/**
 * Computes basis-point discrepancy between the TradingView chart close and the
 * authoritative Binance WebSocket mark price.
 */
export function computeDiscrepancyBps(tradingViewClose: number, binanceWsPrice: number): number {
  if (
    !Number.isFinite(tradingViewClose) ||
    !Number.isFinite(binanceWsPrice) ||
    tradingViewClose <= 0 ||
    binanceWsPrice <= 0
  ) {
    return 0;
  }
  const bps = (Math.abs(tradingViewClose - binanceWsPrice) / binanceWsPrice) * 10_000;
  return Number(bps.toFixed(2));
}

/**
 * Stitches an authoritative Binance WebSocket tick directly into the active TradingView
 * candle bar so plotted OHLC stays 100% locked to Binance WS without full React re-renders.
 */
export function stitchBinanceTickToTradingViewBar(
  activeBar: Candle,
  binanceWsPrice: number,
  toleranceBps = DEFAULT_PARITY_TOLERANCE_BPS,
  reanchorThresholdBps = FULL_REANCHOR_THRESHOLD_BPS
): IntrabarStitchResult {
  if (!Number.isFinite(binanceWsPrice) || binanceWsPrice <= 0) {
    return {
      updatedBar: activeBar,
      requiresFullReanchor: false,
      discrepancyBps: 0,
      discrepancyPct: 0,
      parityStatus: 'AWAITING_WS',
    };
  }

  const discrepancyBps = computeDiscrepancyBps(activeBar.close, binanceWsPrice);
  const discrepancyPct = Number((discrepancyBps / 100).toFixed(4));
  const requiresFullReanchor = discrepancyBps >= reanchorThresholdBps;

  const updatedBar: Candle = {
    ...activeBar,
    high: Math.max(activeBar.high, binanceWsPrice),
    low: Math.min(activeBar.low, binanceWsPrice),
    close: binanceWsPrice,
  };

  const parityStatus: PriceParityStatus = requiresFullReanchor
    ? 'RECONCILING'
    : discrepancyBps > toleranceBps
    ? 'DRIFT_RESOLVED'
    : 'LOCKED';

  return {
    updatedBar,
    requiresFullReanchor,
    discrepancyBps,
    discrepancyPct,
    parityStatus,
  };
}

/**
 * Atomically scales a cached or slightly offset TradingView candle array onto the
 * authoritative Binance WebSocket price while preserving historical candle geometry.
 */
export function reanchorSeriesToBinanceWs(candles: Candle[], binanceWsPrice: number): Candle[] {
  if (candles.length === 0 || !Number.isFinite(binanceWsPrice) || binanceWsPrice <= 0) {
    return candles;
  }
  const lastClose = candles[candles.length - 1]?.close ?? 0;
  if (!Number.isFinite(lastClose) || lastClose <= 0) {
    return candles;
  }
  const factor = binanceWsPrice / lastClose;
  if (Math.abs(factor - 1) < 1e-6) {
    return candles;
  }

  return candles.map((c, idx) => {
    const isLast = idx === candles.length - 1;
    const open = Number((c.open * factor).toPrecision(7));
    const close = isLast ? binanceWsPrice : Number((c.close * factor).toPrecision(7));
    const scaledHigh = Number((c.high * factor).toPrecision(7));
    const scaledLow = Number((c.low * factor).toPrecision(7));
    return {
      ...c,
      open,
      close,
      high: Math.max(scaledHigh, open, close),
      low: Math.min(scaledLow, open, close),
    };
  });
}

/**
 * Stateful arbiter tracking real-time parity metrics between TradingView Lightweight Charts
 * and Binance WebSocket streams per symbol.
 */
export class TradingViewBinanceSyncArbiter {
  private readonly telemetryBySymbol = new Map<string, PriceSyncTelemetry>();

  recordTick(
    symbol: string,
    tradingViewCloseBeforeStitch: number,
    binanceWsPrice: number,
    resolvedDrift: boolean,
    nowMs = Date.now()
  ): PriceSyncTelemetry {
    const prev = this.telemetryBySymbol.get(symbol);
    const rawBps = computeDiscrepancyBps(tradingViewCloseBeforeStitch, binanceWsPrice);
    const driftEventsResolved =
      (prev?.driftEventsResolved ?? 0) + (resolvedDrift || rawBps > DEFAULT_PARITY_TOLERANCE_BPS ? 1 : 0);
    const intrabarTicksStitched = (prev?.intrabarTicksStitched ?? 0) + 1;

    // After stitching, plotted close equals binanceWsPrice -> effective residual discrepancy is 0 bps
    const next: PriceSyncTelemetry = {
      symbol,
      tradingViewClose: binanceWsPrice,
      binanceWsPrice,
      discrepancyBps: 0,
      discrepancyPct: 0,
      parityStatus: resolvedDrift ? 'DRIFT_RESOLVED' : 'LOCKED',
      driftEventsResolved,
      intrabarTicksStitched,
      lastSyncedAtMs: nowMs,
    };
    this.telemetryBySymbol.set(symbol, next);
    return next;
  }

  getTelemetry(symbol: string): PriceSyncTelemetry | null {
    return this.telemetryBySymbol.get(symbol) ?? null;
  }

  getAllTelemetry(): PriceSyncTelemetry[] {
    return Array.from(this.telemetryBySymbol.values());
  }
}

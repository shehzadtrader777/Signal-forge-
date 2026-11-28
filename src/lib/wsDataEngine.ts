import {
  TRACKED_COINS,
  type Candle,
  type CoinMeta,
  type TickerSnapshot,
} from './marketData';
import {
  MAX_WS_RECONNECT_ATTEMPTS,
  SUBSECOND_HEARTBEAT_INTERVAL_MS,
  WS_FRAME_STALE_THRESHOLD_MS,
  computeExponentialReconnectDelayMs,
} from './monitorAgent';
import {
  dropDivergentSeedPinnedSignals,
  evaluatePinnedSignalsLiveOutcome,
  isPinnedSignalResolved,
  type PinnedSignalRecord,
} from './pinnedSignals';
import {
  type CmcBaselineValuation,
  validateSpotFeedAgainstCmc,
  validateSpotTickSample,
} from './spotCmcValidator';
import {
  DETERMINISTIC_FALLBACK_TICK_MS,
  WS_FLUSH_INTERVAL_MS,
  WS_STALE_TIMEOUT_MS,
  WsFrameBuffer,
  type WsBufferedTickerFrame,
  stepDeterministicFallbackTickers,
} from './telemetrySync';
import {
  computeBoundedExponentialBackoffMs,
  evaluateTimestampFreshness,
  type DataFreshnessStatus,
  type WsConnectionHealth,
} from './marketPriceModel';

export const DEFAULT_DRIFT_THRESHOLD_PCT = 0.5;
export const DEFAULT_SIGNAL_CARD_DRIFT_THRESHOLD_PCT = 0.5;
export const DEFAULT_SEED_ANCHOR_DIVERGENCE_PCT = 3.0;
export const MAX_SINGLE_TICK_JUMP_PCT = 12;
export const MAX_CLOCK_SKEW_TOLERANCE_MS = 5_000;
export const SPOT_WS_HOSTS = [
  'wss://stream.binance.com:9443/stream',
  'wss://data-stream.binance.vision/stream',
] as const;

export interface RawWsTickInput {
  symbol: string;
  price: number;
  bidPrice?: number;
  askPrice?: number;
  change24hPercent?: number;
  high24h?: number;
  low24h?: number;
  volume24hUsd?: number;
  receivedAtMs?: number;
  source?: 'ws' | 'rest' | 'kline' | 'fallback';
}

export interface ValidatedWsTick {
  symbol: string;
  price: number;
  bidPrice?: number;
  askPrice?: number;
  change24hPercent: number;
  high24h: number;
  low24h: number;
  volume24hUsd: number;
  receivedAtMs: number;
  source: 'ws' | 'rest' | 'kline' | 'fallback';
}

export interface TickValidationResult {
  accepted: boolean;
  reason: string;
  tick?: ValidatedWsTick;
}

export interface DiscrepancyReport {
  symbol: string;
  authoritativePrice: number;
  plottedClosePrice: number | null;
  signalTickerPrice: number | null;
  signalCardEntryPrice: number | null;
  plottedDiscrepancyPct: number;
  signalTickerDiscrepancyPct: number;
  signalEntryDiscrepancyPct: number;
  maxDiscrepancyPct: number;
  thresholdPct: number;
  drifted: boolean;
  reasons: string[];
}

export interface CandleReconciliationResult {
  candles: Candle[];
  reconciled: boolean;
  discrepancyPct: number;
  previousClose: number | null;
  authoritativePrice: number;
  mode: 'none' | 'intrabar_tick' | 'full_reanchor';
}

export interface ReconciliationAuditEvent {
  id: string;
  symbol: string;
  scope: 'CHART_CANDLES' | 'CANDLES_MAP' | 'SIGNAL_TICKERS' | 'SIGNAL_CARD';
  discrepancyPct: number;
  thresholdPct: number;
  previousPrice: number;
  authoritativePrice: number;
  mode: string;
  timestamp: string;
}

export interface ReconciliationTelemetrySnapshot {
  validatedTicksCount: number;
  rejectedTicksCount: number;
  duplicateTicksDroppedCount: number;
  outOfOrderTicksDroppedCount: number;
  failedUpdatesCount: number;
  lastRejectionReason: string | null;
  driftsResolvedCount: number;
  lastReconciledSymbol: string | null;
  lastDiscrepancyPct: number;
  lastReconciledAt: string | null;
  wsConnected: boolean;
  connectionHealth: WsConnectionHealth;
  dataFreshness: DataFreshnessStatus;
  lastFrameAtIso: string | null;
  lastDisconnectAtIso: string | null;
  lastReconnectAtIso: string | null;
  reconnectCount: number;
  restoredSubscriptionsCount: number;
  activeSubscriptions: string[];
  fallbackEnforced: boolean;
  syncEpoch: number;
  reconnectAttempt?: number;
  circuitOpen?: boolean;
  recentEvents: ReconciliationAuditEvent[];
}

export interface WsFlushBatch {
  frames: WsBufferedTickerFrame[];
  authoritativePrices: Record<string, number>;
  telemetry: ReconciliationTelemetrySnapshot;
}

export interface MinimalWebSocketLike {
  readyState: number;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  close: () => void;
}

export type WebSocketFactory = (url: string) => MinimalWebSocketLike;

export interface LiveWsFeedControllerOptions {
  buffer?: WsFrameBuffer;
  coins?: CoinMeta[];
  driftThresholdPct?: number;
  flushIntervalMs?: number;
  maxReconnectAttempts?: number;
  reconnectBaseDelayMs?: number;
  cmcBaselines?: Record<string, CmcBaselineValuation>;
  wsFactory?: WebSocketFactory;
  onFlushBatch?: (batch: WsFlushBatch) => void;
  onFallbackStep?: (stepIndex: number) => void;
  onConnectionChange?: (connected: boolean, fallbackEnforced: boolean, epoch: number) => void;
}

/**
 * Mandatory per-tick data validation gate executed upon receipt of EVERY spot WS/REST tick
 * before the authoritative live price store or UI buffers may accept it.
 */
export function validateIncomingWsTick(
  input: RawWsTickInput,
  options?: {
    previousPrice?: number;
    previousTimestampMs?: number;
    anchorPrice?: number;
    maxJumpPct?: number;
    cmcBaseline?: CmcBaselineValuation | null;
    maxCmcDivergencePct?: number;
    nowMs?: number;
    maxStaleAgeMs?: number;
  }
): TickValidationResult {
  const symbol = typeof input.symbol === 'string' ? input.symbol.trim().toUpperCase() : '';
  if (!symbol || !/^[A-Z0-9]{2,20}$/.test(symbol)) {
    return {
      accepted: false,
      reason: 'Rejected tick: invalid or empty symbol identifier.',
    };
  }

  const price = Number(input.price);
  const previousPrice = options?.previousPrice;
  const maxJumpPct = options?.maxJumpPct ?? MAX_SINGLE_TICK_JUMP_PCT;

  const anomalyCheck = validateSpotTickSample({
    price,
    previousPrice,
    maxJumpPct,
    anchorPrice: options?.anchorPrice,
  });
  if (!anomalyCheck.valid) {
    return {
      accepted: false,
      reason: `${symbol}: ${anomalyCheck.reason}`,
    };
  }

  let validatedBid: number | undefined;
  let validatedAsk: number | undefined;
  if (input.bidPrice !== undefined || input.askPrice !== undefined) {
    const bid = Number(input.bidPrice);
    const ask = Number(input.askPrice);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask < bid) {
      return {
        accepted: false,
        reason: `${symbol}: Rejected tick with invalid or inverted bid/ask quote.`,
      };
    }
    const mid = (bid + ask) / 2;
    const spreadBps = ((ask - bid) / mid) * 10_000;
    if (spreadBps > 500) {
      return {
        accepted: false,
        reason: `${symbol}: Rejected tick with excessive bid/ask spread (${spreadBps.toFixed(1)} bps).`,
      };
    }
    const lastVsMidPct = (Math.abs(price - mid) / mid) * 100;
    if (lastVsMidPct > 5.0) {
      return {
        accepted: false,
        reason: `${symbol}: Rejected tick because last price diverges ${lastVsMidPct.toFixed(2)}% from bid/ask midpoint.`,
      };
    }
    validatedBid = bid;
    validatedAsk = ask;
  }

  if (options?.cmcBaseline) {
    const cmcCheck = validateSpotFeedAgainstCmc({
      symbol,
      spotPrice: price,
      cmcBaseline: options.cmcBaseline,
      maxDivergencePct: options.maxCmcDivergencePct ?? 12.0,
    });
    if (!cmcCheck.valid) {
      return {
        accepted: false,
        reason: cmcCheck.reason,
      };
    }
  }

  const volumeRaw = input.volume24hUsd ?? 0;
  if (!Number.isFinite(volumeRaw) || volumeRaw < 0) {
    return {
      accepted: false,
      reason: `${symbol}: Rejected tick with invalid negative or non-finite 24h volume.`,
    };
  }

  if (
    input.change24hPercent !== undefined &&
    (!Number.isFinite(input.change24hPercent) ||
      input.change24hPercent < -99.99 ||
      input.change24hPercent > 10_000)
  ) {
    return {
      accepted: false,
      reason: `${symbol}: Rejected tick with non-finite or out-of-bounds 24h change.`,
    };
  }
  const change24hPercent =
    input.change24hPercent !== undefined ? Number(input.change24hPercent.toFixed(2)) : 0;

  let high24h =
    input.high24h !== undefined && Number.isFinite(input.high24h) && input.high24h > 0
      ? input.high24h
      : price;
  let low24h =
    input.low24h !== undefined && Number.isFinite(input.low24h) && input.low24h > 0
      ? input.low24h
      : price;

  if (input.high24h !== undefined && input.low24h !== undefined && high24h > 0 && low24h > 0) {
    if (low24h > high24h * 1.005) {
      return {
        accepted: false,
        reason: `${symbol}: Rejected tick due to inverted 24h range (low ${low24h} > high ${high24h}).`,
      };
    }
    high24h = Math.max(high24h, price);
    low24h = Math.min(low24h, price);
  }

  const nowMs = options?.nowMs ?? Date.now();
  if (
    input.receivedAtMs !== undefined &&
    (!Number.isFinite(input.receivedAtMs) || input.receivedAtMs <= 0)
  ) {
    return {
      accepted: false,
      reason: `${symbol}: Rejected tick with malformed timestamp.`,
    };
  }
  const receivedAtMs = input.receivedAtMs !== undefined ? input.receivedAtMs : nowMs;

  if (receivedAtMs > nowMs + MAX_CLOCK_SKEW_TOLERANCE_MS) {
    return {
      accepted: false,
      reason: `${symbol}: Rejected future-dated WS frame (+${receivedAtMs - nowMs}ms > ${MAX_CLOCK_SKEW_TOLERANCE_MS}ms).`,
    };
  }

  if (
    options?.maxStaleAgeMs !== undefined &&
    Number.isFinite(options.maxStaleAgeMs) &&
    options.maxStaleAgeMs > 0 &&
    nowMs - receivedAtMs > options.maxStaleAgeMs
  ) {
    return {
      accepted: false,
      reason: `${symbol}: Rejected stale WS frame (age ${nowMs - receivedAtMs}ms > ${options.maxStaleAgeMs}ms).`,
    };
  }

  if (
    options?.previousTimestampMs !== undefined &&
    receivedAtMs < options.previousTimestampMs
  ) {
    return {
      accepted: false,
      reason: `${symbol}: Rejected out-of-order stale WS frame (${receivedAtMs} < ${options.previousTimestampMs}).`,
    };
  }

  return {
    accepted: true,
    reason: 'Tick validated.',
    tick: {
      symbol,
      price,
      ...(validatedBid !== undefined ? { bidPrice: validatedBid } : {}),
      ...(validatedAsk !== undefined ? { askPrice: validatedAsk } : {}),
      change24hPercent,
      high24h,
      low24h,
      volume24hUsd: volumeRaw,
      receivedAtMs,
      source: input.source ?? 'ws',
    },
  };
}

export function computePriceDiscrepancyPct(
  authoritativePrice: number,
  comparedPrice?: number | null
): number {
  if (
    !Number.isFinite(authoritativePrice) ||
    authoritativePrice <= 0 ||
    comparedPrice === undefined ||
    comparedPrice === null ||
    !Number.isFinite(comparedPrice) ||
    comparedPrice <= 0
  ) {
    return 0;
  }
  return Number(
    ((Math.abs(authoritativePrice - comparedPrice) / authoritativePrice) * 100).toFixed(4)
  );
}

export function detectStateDiscrepancy(params: {
  symbol: string;
  authoritativePrice: number;
  plottedClosePrice?: number | null;
  signalTickerPrice?: number | null;
  signalCardEntryPrice?: number | null;
  thresholdPct?: number;
  signalEntryThresholdPct?: number;
}): DiscrepancyReport {
  const thresholdPct = params.thresholdPct ?? DEFAULT_DRIFT_THRESHOLD_PCT;
  const signalEntryThresholdPct =
    params.signalEntryThresholdPct ?? DEFAULT_SEED_ANCHOR_DIVERGENCE_PCT;

  const plottedDiscrepancyPct = computePriceDiscrepancyPct(
    params.authoritativePrice,
    params.plottedClosePrice
  );
  const signalTickerDiscrepancyPct = computePriceDiscrepancyPct(
    params.authoritativePrice,
    params.signalTickerPrice
  );
  const signalEntryDiscrepancyPct = computePriceDiscrepancyPct(
    params.authoritativePrice,
    params.signalCardEntryPrice
  );

  const reasons: string[] = [];
  if (plottedDiscrepancyPct > thresholdPct) {
    reasons.push(
      `Plotted chart close drifted ${plottedDiscrepancyPct.toFixed(2)}% > ${thresholdPct}%`
    );
  }
  if (signalTickerDiscrepancyPct > thresholdPct) {
    reasons.push(
      `Dashboard signal ticker drifted ${signalTickerDiscrepancyPct.toFixed(2)}% > ${thresholdPct}%`
    );
  }
  if (signalEntryDiscrepancyPct > signalEntryThresholdPct) {
    reasons.push(
      `Signal card entry drifted ${signalEntryDiscrepancyPct.toFixed(2)}% > ${signalEntryThresholdPct}%`
    );
  }

  const maxDiscrepancyPct = Math.max(
    plottedDiscrepancyPct,
    signalTickerDiscrepancyPct,
    signalEntryDiscrepancyPct
  );

  return {
    symbol: params.symbol.toUpperCase(),
    authoritativePrice: params.authoritativePrice,
    plottedClosePrice: params.plottedClosePrice ?? null,
    signalTickerPrice: params.signalTickerPrice ?? null,
    signalCardEntryPrice: params.signalCardEntryPrice ?? null,
    plottedDiscrepancyPct,
    signalTickerDiscrepancyPct,
    signalEntryDiscrepancyPct,
    maxDiscrepancyPct,
    thresholdPct,
    drifted: reasons.length > 0,
    reasons,
  };
}

/**
 * Automatically reconciles a plotted candle series with the authoritative live WS price.
 * - If series came from fallback/seed cache OR diverges by >10% (e.g. stale seed baseline),
 *   proportionally re-anchors the entire OHLC history cleanly to the authoritative live mark
 *   so EMAs, FRVP POC/VAH/VAL, Order Blocks, and candlesticks show zero drift.
 * - If genuine historical exchange klines diverge on the trailing live candle by > thresholdPct,
 *   immediately reconciles the trailing bar OHLC/close with the live mark.
 */
export function reconcileCandleSeriesToLivePrice(
  candles: Candle[],
  authoritativePrice: number,
  thresholdPct: number = DEFAULT_DRIFT_THRESHOLD_PCT,
  seriesSource: 'binance' | 'cache' = 'binance'
): CandleReconciliationResult {
  if (candles.length === 0 || !Number.isFinite(authoritativePrice) || authoritativePrice <= 0) {
    return {
      candles,
      reconciled: false,
      discrepancyPct: 0,
      previousClose: candles[candles.length - 1]?.close ?? null,
      authoritativePrice,
      mode: 'none',
    };
  }

  const last = candles[candles.length - 1];
  const previousClose = last.close;
  if (!Number.isFinite(previousClose) || previousClose <= 0) {
    return {
      candles,
      reconciled: false,
      discrepancyPct: 0,
      previousClose: null,
      authoritativePrice,
      mode: 'none',
    };
  }

  const discrepancyPct = computePriceDiscrepancyPct(authoritativePrice, previousClose);
  const precisionDigits = authoritativePrice >= 100 ? 6 : 6;

  // Check if entire series baseline needs proportional re-anchoring
  const needsFullReanchor =
    (seriesSource === 'cache' && discrepancyPct > thresholdPct) || discrepancyPct > 10.0;

  if (needsFullReanchor) {
    const scale = authoritativePrice / previousClose;
    const reanchored = candles.map((c, idx) => {
      const scaledOpen = Number((c.open * scale).toPrecision(precisionDigits));
      const scaledHigh = Number((c.high * scale).toPrecision(precisionDigits));
      const scaledLow = Number((c.low * scale).toPrecision(precisionDigits));
      const scaledClose =
        idx === candles.length - 1
          ? authoritativePrice
          : Number((c.close * scale).toPrecision(precisionDigits));
      return {
        ...c,
        open: scaledOpen,
        high: Math.max(scaledHigh, scaledOpen, scaledClose),
        low: Math.min(scaledLow, scaledOpen, scaledClose),
        close: scaledClose,
      };
    });

    return {
      candles: reanchored,
      reconciled: true,
      discrepancyPct,
      previousClose,
      authoritativePrice,
      mode: 'full_reanchor',
    };
  }

  if (discrepancyPct > thresholdPct || Math.abs(previousClose - authoritativePrice) > 1e-8) {
    const nextCandles = candles.slice();
    nextCandles[nextCandles.length - 1] = {
      ...last,
      close: authoritativePrice,
      high: Math.max(last.high, authoritativePrice),
      low: Math.min(last.low, authoritativePrice),
    };
    return {
      candles: nextCandles,
      reconciled: discrepancyPct > thresholdPct,
      discrepancyPct,
      previousClose,
      authoritativePrice,
      mode: discrepancyPct > thresholdPct ? 'intrabar_tick' : 'none',
    };
  }

  return {
    candles,
    reconciled: false,
    discrepancyPct,
    previousClose,
    authoritativePrice,
    mode: 'none',
  };
}

/**
 * Immediately reconciles signal cards (pinnedSignals) against authoritative WS prices:
 * 1. Purges unresolved/freshly-pinned signals whose entryPrice drifted from live spot beyond threshold
 * 2. Updates live markPrice, trailing SL, and unrealized R whenever mark discrepancy > thresholdPct
 */
export function reconcilePinnedSignalsToLiveFeed(
  pinned: PinnedSignalRecord[],
  authoritativePrices: Record<string, number>,
  thresholdPct: number = DEFAULT_DRIFT_THRESHOLD_PCT,
  candlesMap: Record<string, Candle[]> = {}
): {
  pinned: PinnedSignalRecord[];
  reconciledCount: number;
  droppedCount: number;
  maxDiscrepancyPct: number;
} {
  if (pinned.length === 0) {
    return { pinned, reconciledCount: 0, droppedCount: 0, maxDiscrepancyPct: 0 };
  }

  let maxDiscrepancyPct = 0;
  let hadLiveMarkDrift = false;

  for (const item of pinned) {
    const livePrice = authoritativePrices[item.signal.symbol];
    if (!Number.isFinite(livePrice) || livePrice <= 0) continue;
    if (!isPinnedSignalResolved(item.status)) {
      const markDrift = computePriceDiscrepancyPct(livePrice, item.currentPrice);
      const entryDrift = computePriceDiscrepancyPct(livePrice, item.signal.entryPrice);
      maxDiscrepancyPct = Math.max(maxDiscrepancyPct, markDrift, entryDrift);
      if (markDrift > thresholdPct) {
        hadLiveMarkDrift = true;
      }
    }
  }

  const maxEntryDivergenceRatio = Math.max(0.035, (thresholdPct * 7) / 100);
  const pruned = dropDivergentSeedPinnedSignals(
    pinned,
    authoritativePrices,
    maxEntryDivergenceRatio
  );
  const droppedCount = Math.max(0, pinned.length - pruned.length);
  const evaluated = evaluatePinnedSignalsLiveOutcome(pruned, authoritativePrices, candlesMap);

  const reconciledCount =
    droppedCount + (hadLiveMarkDrift || evaluated !== pruned ? 1 : 0);

  return {
    pinned: evaluated,
    reconciledCount,
    droppedCount,
    maxDiscrepancyPct,
  };
}

/**
 * Decoupled WebSocket Data Engine controller completely independent of React & DOM UI.
 * Manages WebSocket lifecycle, host failover, watchdog, per-tick validation, coalescing buffer,
 * deterministic fallback stepping, and drift audit telemetry.
 */
export class LiveWsFeedController {
  private buffer: WsFrameBuffer;
  private coins: CoinMeta[];
  private trackedSymbols = new Set<string>();
  private anchorPrices: Record<string, number> = {};
  private authoritativePrices: Record<string, number> = {};
  private lastTickAtBySymbol: Record<string, number> = {};
  private lastAcceptedSignatureBySymbol: Record<string, string> = {};
  private cmcBaselines: Record<string, CmcBaselineValuation> = {};
  private wsFactory?: WebSocketFactory;
  private flushIntervalMs: number;
  private driftThresholdPct: number;
  private maxReconnectAttempts: number;
  private reconnectBaseDelayMs: number;

  private ws: MinimalWebSocketLike | null = null;
  private hostIndex = 0;
  private healAttempt = 0;
  private reconnectCount = 0;
  private restoredSubscriptionsCount = 0;
  private hasEverOpened = false;
  private activeSubscriptions: string[] = [];
  private circuitOpen = false;
  private fallbackStep = 0;
  private lastFrameAtMs = 0;
  private lastDisconnectAtIso: string | null = null;
  private lastReconnectAtIso: string | null = null;
  private wsConnected = false;
  private fallbackEnforced = true;
  private running = false;

  private connectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private firstFrameTimerId: ReturnType<typeof setTimeout> | null = null;
  private healTimerId: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimerId: ReturnType<typeof setInterval> | null = null;
  private fallbackTimerId: ReturnType<typeof setInterval> | null = null;
  private flushTimerId: ReturnType<typeof setInterval> | null = null;

  private validatedTicksCount = 0;
  private rejectedTicksCount = 0;
  private duplicateTicksDroppedCount = 0;
  private outOfOrderTicksDroppedCount = 0;
  private failedUpdatesCount = 0;
  private lastRejectionReason: string | null = null;
  private driftsResolvedCount = 0;
  private lastReconciledSymbol: string | null = null;
  private lastDiscrepancyPct = 0;
  private lastReconciledAt: string | null = null;
  private recentEvents: ReconciliationAuditEvent[] = [];

  private onFlushBatch?: (batch: WsFlushBatch) => void;
  private onFallbackStep?: (stepIndex: number) => void;
  private onConnectionChange?: (
    connected: boolean,
    fallbackEnforced: boolean,
    epoch: number
  ) => void;
  private listeners = new Set<(batch: WsFlushBatch) => void>();

  constructor(options: LiveWsFeedControllerOptions = {}) {
    this.buffer = options.buffer ?? new WsFrameBuffer();
    this.coins = options.coins ?? TRACKED_COINS;
    this.driftThresholdPct = options.driftThresholdPct ?? DEFAULT_DRIFT_THRESHOLD_PCT;
    this.flushIntervalMs = options.flushIntervalMs ?? WS_FLUSH_INTERVAL_MS;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? MAX_WS_RECONNECT_ATTEMPTS;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 350;
    if (options.cmcBaselines) {
      this.cmcBaselines = { ...options.cmcBaselines };
    }
    this.wsFactory = options.wsFactory;
    this.onFlushBatch = options.onFlushBatch;
    this.onFallbackStep = options.onFallbackStep;
    this.onConnectionChange = options.onConnectionChange;
    this.syncTrackedSymbols(this.coins);
  }

  configure(options: LiveWsFeedControllerOptions): void {
    if (options.coins) {
      this.coins = options.coins;
      this.syncTrackedSymbols(options.coins);
    }
    if (options.driftThresholdPct !== undefined) {
      this.driftThresholdPct = options.driftThresholdPct;
    }
    if (options.maxReconnectAttempts !== undefined) {
      this.maxReconnectAttempts = options.maxReconnectAttempts;
    }
    if (options.reconnectBaseDelayMs !== undefined) {
      this.reconnectBaseDelayMs = options.reconnectBaseDelayMs;
    }
    if (options.cmcBaselines !== undefined) {
      this.cmcBaselines = { ...options.cmcBaselines };
    }
    if (options.wsFactory !== undefined) {
      this.wsFactory = options.wsFactory;
    }
    if (options.onFlushBatch !== undefined) {
      this.onFlushBatch = options.onFlushBatch;
    }
    if (options.onFallbackStep !== undefined) {
      this.onFallbackStep = options.onFallbackStep;
    }
    if (options.onConnectionChange !== undefined) {
      this.onConnectionChange = options.onConnectionChange;
    }
  }

  updateTrackedSymbols(coins: CoinMeta[]): void {
    this.coins = coins;
    this.syncTrackedSymbols(coins);
  }

  setCmcBaselines(baselines: Record<string, CmcBaselineValuation>): void {
    this.cmcBaselines = { ...baselines };
  }

  private syncTrackedSymbols(coins: CoinMeta[]): void {
    this.trackedSymbols.clear();
    for (const coin of coins) {
      const sym = coin.symbol.toUpperCase();
      this.trackedSymbols.add(sym);
      if (Number.isFinite(coin.referencePrice) && coin.referencePrice > 0 && !this.anchorPrices[sym]) {
        this.anchorPrices[sym] = coin.referencePrice;
      }
    }
  }

  getDriftThresholdPct(): number {
    return this.driftThresholdPct;
  }

  getBuffer(): WsFrameBuffer {
    return this.buffer;
  }

  getActiveSocketReadyState(): number | null {
    return this.ws ? this.ws.readyState : null;
  }

  getAuthoritativePrices(): Record<string, number> {
    return { ...this.authoritativePrices };
  }

  getAuthoritativePrice(symbol: string): number | undefined {
    return this.authoritativePrices[symbol.toUpperCase()];
  }

  getConnectionHealth(nowMs: number = Date.now()): {
    connectionHealth: WsConnectionHealth;
    dataFreshness: DataFreshnessStatus;
  } {
    const freshnessEval =
      this.lastFrameAtMs > 0
        ? evaluateTimestampFreshness(this.lastFrameAtMs, nowMs)
        : { freshness: 'INVALID_TIMESTAMP' as DataFreshnessStatus, ageMs: Number.POSITIVE_INFINITY, reason: 'No frames yet.' };

    if (this.circuitOpen) {
      return { connectionHealth: 'CIRCUIT_OPEN', dataFreshness: freshnessEval.freshness };
    }
    if (this.healTimerId !== null) {
      return { connectionHealth: 'RECONNECTING', dataFreshness: freshnessEval.freshness };
    }
    if (!this.wsConnected) {
      return { connectionHealth: 'DISCONNECTED', dataFreshness: freshnessEval.freshness };
    }
    if (freshnessEval.freshness === 'STALE') {
      return { connectionHealth: 'STALE', dataFreshness: 'STALE' };
    }
    if (freshnessEval.freshness === 'DELAYED') {
      return { connectionHealth: 'DELAYED', dataFreshness: 'DELAYED' };
    }
    return { connectionHealth: 'CONNECTED', dataFreshness: freshnessEval.freshness };
  }

  getTelemetrySnapshot(nowMs: number = Date.now()): ReconciliationTelemetrySnapshot {
    const { connectionHealth, dataFreshness } = this.getConnectionHealth(nowMs);
    return {
      validatedTicksCount: this.validatedTicksCount,
      rejectedTicksCount: this.rejectedTicksCount,
      duplicateTicksDroppedCount: this.duplicateTicksDroppedCount,
      outOfOrderTicksDroppedCount: this.outOfOrderTicksDroppedCount,
      failedUpdatesCount: this.failedUpdatesCount,
      lastRejectionReason: this.lastRejectionReason,
      driftsResolvedCount: this.driftsResolvedCount,
      lastReconciledSymbol: this.lastReconciledSymbol,
      lastDiscrepancyPct: this.lastDiscrepancyPct,
      lastReconciledAt: this.lastReconciledAt,
      wsConnected: this.wsConnected,
      connectionHealth,
      dataFreshness,
      lastFrameAtIso: this.lastFrameAtMs > 0 ? new Date(this.lastFrameAtMs).toISOString() : null,
      lastDisconnectAtIso: this.lastDisconnectAtIso,
      lastReconnectAtIso: this.lastReconnectAtIso,
      reconnectCount: this.reconnectCount,
      restoredSubscriptionsCount: this.restoredSubscriptionsCount,
      activeSubscriptions: this.activeSubscriptions.slice(),
      fallbackEnforced: this.fallbackEnforced,
      syncEpoch: this.buffer.getCurrentEpoch(),
      reconnectAttempt: this.healAttempt,
      circuitOpen: this.circuitOpen,
      recentEvents: this.recentEvents.slice(0, 12),
    };
  }

  subscribe(listener: (batch: WsFlushBatch) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  recordReconciliation(event: Omit<ReconciliationAuditEvent, 'id' | 'timestamp'>): void {
    const timestamp = new Date().toISOString();
    const normalizedPct = Number(event.discrepancyPct.toFixed(4));
    const entry: ReconciliationAuditEvent = {
      ...event,
      discrepancyPct: normalizedPct,
      id: `rec_${event.symbol}_${Date.now()}_${this.driftsResolvedCount + 1}`,
      timestamp,
    };
    this.driftsResolvedCount += 1;
    this.lastReconciledSymbol = event.symbol.toUpperCase();
    this.lastDiscrepancyPct = normalizedPct;
    this.lastReconciledAt = timestamp;
    this.recentEvents = [entry, ...this.recentEvents].slice(0, 20);
  }

  /**
   * Validates & ingests an external REST/snapshot Spot tick through the exact same
   * validation pipeline used for WebSocket frames so corrupted REST payloads cannot cause drift.
   */
  ingestExternalValidatedTick(
    input: RawWsTickInput,
    options?: { cmcBaseline?: CmcBaselineValuation | null; expectedEpoch?: number }
  ): TickValidationResult {
    const currentEpoch = this.buffer.getCurrentEpoch();
    if (options?.expectedEpoch !== undefined && options.expectedEpoch !== currentEpoch) {
      this.rejectedTicksCount += 1;
      this.lastRejectionReason = 'Rejected stale external tick from superseded sync epoch.';
      return { accepted: false, reason: this.lastRejectionReason };
    }

    const sym = String(input.symbol || '').trim().toUpperCase();
    const res = validateIncomingWsTick(
      { ...input, symbol: sym, source: input.source ?? 'rest' },
      {
        previousPrice: this.authoritativePrices[sym],
        previousTimestampMs: this.lastTickAtBySymbol[sym],
        cmcBaseline: options?.cmcBaseline ?? this.cmcBaselines[sym] ?? null,
      }
    );

    if (!res.accepted || !res.tick) {
      this.rejectedTicksCount += 1;
      if (/out-of-order|future/i.test(res.reason)) {
        this.outOfOrderTicksDroppedCount += 1;
      } else {
        this.failedUpdatesCount += 1;
      }
      this.lastRejectionReason = res.reason;
      return res;
    }

    const signature = `${res.tick.price}|${res.tick.receivedAtMs}`;
    if (this.lastAcceptedSignatureBySymbol[sym] === signature) {
      this.duplicateTicksDroppedCount += 1;
      this.rejectedTicksCount += 1;
      this.lastRejectionReason = `Duplicate external tick ignored for ${sym} (${signature}).`;
      return { accepted: false, reason: this.lastRejectionReason };
    }

    this.validatedTicksCount += 1;
    this.authoritativePrices[sym] = res.tick.price;
    this.lastTickAtBySymbol[sym] = res.tick.receivedAtMs;
    this.lastAcceptedSignatureBySymbol[sym] = signature;
    this.anchorPrices[sym] = res.tick.price;
    return res;
  }

  /**
   * Parses raw Binance combined-stream JSON (!miniTicker@arr or @ticker), enforces epoch gating
   * BEFORE mutating authoritative prices, validates against tracked allowlist, deduplicates identical
   * frames, rejects out-of-order updates, and quarantines anomalies.
   */
  ingestRawWsPayload(
    rawData: string | Record<string, unknown>,
    receivedAtMs: number = Date.now(),
    epochOverride?: number
  ): { acceptedCount: number; rejectedCount: number } {
    let acceptedCount = 0;
    let rejectedCount = 0;
    const currentEpoch = this.buffer.getCurrentEpoch();
    const epoch = epochOverride ?? currentEpoch;

    if (epoch !== currentEpoch) {
      this.rejectedTicksCount += 1;
      this.failedUpdatesCount += 1;
      this.lastRejectionReason = `Rejected stale WS payload from superseded epoch ${epoch} (current ${currentEpoch}).`;
      return { acceptedCount: 0, rejectedCount: 1 };
    }

    let payload: Record<string, unknown>;
    if (typeof rawData === 'string') {
      try {
        payload = JSON.parse(rawData) as Record<string, unknown>;
      } catch {
        this.rejectedTicksCount += 1;
        this.failedUpdatesCount += 1;
        this.lastRejectionReason = 'Malformed WebSocket JSON frame quarantined.';
        return { acceptedCount: 0, rejectedCount: 1 };
      }
    } else {
      payload = rawData;
    }

    const streamName = String(payload?.stream || '');
    const dataNode = (payload.data ?? payload) as unknown;

    if (streamName === '!miniTicker@arr' && Array.isArray(dataNode)) {
      for (const entry of dataNode) {
        if (!entry || typeof entry !== 'object') continue;
        const raw = entry as Record<string, unknown>;
        const sym = String(raw.s || '').toUpperCase();
        if (!this.trackedSymbols.has(sym)) continue;

        const price = Number(raw.c ?? 0);
        const openP = Number(raw.o ?? price);
        const chg =
          openP > 0 && Number.isFinite(openP)
            ? Number((((price - openP) / openP) * 100).toFixed(2))
            : 0;
        const hasExplicitEventTs = raw.E !== undefined && raw.E !== null;
        if (
          hasExplicitEventTs &&
          (typeof raw.E !== 'number' || !Number.isFinite(raw.E) || raw.E <= 1_000_000_000_000)
        ) {
          this.rejectedTicksCount += 1;
          this.failedUpdatesCount += 1;
          this.lastRejectionReason = `${sym}: Rejected WS frame with malformed event timestamp.`;
          rejectedCount += 1;
          continue;
        }
        const eventTsMs = hasExplicitEventTs ? (raw.E as number) : receivedAtMs;

        const incomingSig = `${price}|${eventTsMs}`;
        if (
          Number.isFinite(price) &&
          price > 0 &&
          this.lastAcceptedSignatureBySymbol[sym] === incomingSig
        ) {
          this.duplicateTicksDroppedCount += 1;
          this.rejectedTicksCount += 1;
          this.lastRejectionReason = `Duplicate WebSocket frame ignored for ${sym}.`;
          rejectedCount += 1;
          continue;
        }

        const check = validateIncomingWsTick(
          {
            symbol: sym,
            price,
            change24hPercent: chg,
            high24h: Number(raw.h ?? price),
            low24h: Number(raw.l ?? price),
            volume24hUsd: Number(raw.q ?? 0),
            receivedAtMs: eventTsMs,
            source: 'ws',
          },
          {
            previousPrice: this.authoritativePrices[sym],
            previousTimestampMs: this.lastTickAtBySymbol[sym],
            cmcBaseline: this.cmcBaselines[sym] ?? null,
          }
        );

        if (!check.accepted || !check.tick) {
          this.rejectedTicksCount += 1;
          if (/out-of-order|future/i.test(check.reason)) {
            this.outOfOrderTicksDroppedCount += 1;
          } else {
            this.failedUpdatesCount += 1;
          }
          this.lastRejectionReason = check.reason;
          rejectedCount += 1;
          continue;
        }

        const enqueued = this.buffer.enqueue({
          symbol: sym,
          price: check.tick.price,
          change24hPercent: check.tick.change24hPercent,
          high24h: check.tick.high24h,
          low24h: check.tick.low24h,
          volume24hUsd: check.tick.volume24hUsd,
          epoch,
          receivedAtMs: check.tick.receivedAtMs,
        });
        if (!enqueued) {
          this.rejectedTicksCount += 1;
          this.failedUpdatesCount += 1;
          rejectedCount += 1;
          continue;
        }

        this.validatedTicksCount += 1;
        this.authoritativePrices[sym] = check.tick.price;
        this.lastTickAtBySymbol[sym] = check.tick.receivedAtMs;
        this.lastAcceptedSignatureBySymbol[sym] = `${check.tick.price}|${check.tick.receivedAtMs}`;
        acceptedCount += 1;
      }
      return { acceptedCount, rejectedCount };
    }

    if (dataNode && typeof dataNode === 'object' && 's' in dataNode) {
      const raw = dataNode as Record<string, unknown>;
      const sym = String(raw.s || '').toUpperCase();
      if (!sym || !this.trackedSymbols.has(sym)) {
        return { acceptedCount: 0, rejectedCount: 0 };
      }

      const parsedPrice = Number(raw.c);
      const hasExplicitEventTs = raw.E !== undefined && raw.E !== null;
      if (
        hasExplicitEventTs &&
        (typeof raw.E !== 'number' || !Number.isFinite(raw.E) || raw.E <= 1_000_000_000_000)
      ) {
        this.rejectedTicksCount += 1;
        this.failedUpdatesCount += 1;
        this.lastRejectionReason = `${sym}: Rejected WS frame with malformed event timestamp.`;
        return { acceptedCount: 0, rejectedCount: 1 };
      }
      const eventTsMs = hasExplicitEventTs ? (raw.E as number) : receivedAtMs;

      const incomingSig = `${parsedPrice}|${eventTsMs}`;
      if (
        Number.isFinite(parsedPrice) &&
        parsedPrice > 0 &&
        this.lastAcceptedSignatureBySymbol[sym] === incomingSig
      ) {
        this.duplicateTicksDroppedCount += 1;
        this.rejectedTicksCount += 1;
        this.lastRejectionReason = `Duplicate WebSocket frame ignored for ${sym}.`;
        return { acceptedCount: 0, rejectedCount: 1 };
      }

      const hasBookFields = raw.b !== undefined || raw.a !== undefined;
      const check = validateIncomingWsTick(
        {
          symbol: sym,
          price: parsedPrice,
          ...(hasBookFields ? { bidPrice: Number(raw.b), askPrice: Number(raw.a) } : {}),
          change24hPercent: Number(raw.P ?? 0),
          high24h: raw.h !== undefined ? Number(raw.h) : undefined,
          low24h: raw.l !== undefined ? Number(raw.l) : undefined,
          volume24hUsd: Number(raw.q ?? 0),
          receivedAtMs: eventTsMs,
          source: 'ws',
        },
        {
          previousPrice: this.authoritativePrices[sym],
          previousTimestampMs: this.lastTickAtBySymbol[sym],
          cmcBaseline: this.cmcBaselines[sym] ?? null,
        }
      );

      if (!check.accepted || !check.tick) {
        this.rejectedTicksCount += 1;
        if (/out-of-order|future/i.test(check.reason)) {
          this.outOfOrderTicksDroppedCount += 1;
        } else {
          this.failedUpdatesCount += 1;
        }
        this.lastRejectionReason = check.reason;
        return { acceptedCount: 0, rejectedCount: 1 };
      }

      const enqueued = this.buffer.enqueue({
        symbol: sym,
        price: check.tick.price,
        change24hPercent: check.tick.change24hPercent,
        high24h: check.tick.high24h,
        low24h: check.tick.low24h,
        volume24hUsd: check.tick.volume24hUsd,
        epoch,
        receivedAtMs: check.tick.receivedAtMs,
      });
      if (!enqueued) {
        this.rejectedTicksCount += 1;
        this.failedUpdatesCount += 1;
        return { acceptedCount: 0, rejectedCount: 1 };
      }

      this.validatedTicksCount += 1;
      this.authoritativePrices[sym] = check.tick.price;
      this.lastTickAtBySymbol[sym] = check.tick.receivedAtMs;
      this.lastAcceptedSignatureBySymbol[sym] = `${check.tick.price}|${check.tick.receivedAtMs}`;
      return { acceptedCount: 1, rejectedCount: 0 };
    }

    return { acceptedCount: 0, rejectedCount: 0 };
  }

  flushPendingFrames(): WsFlushBatch | null {
    const frames = this.buffer.flush();
    if (frames.length === 0) return null;

    const batch: WsFlushBatch = {
      frames,
      authoritativePrices: this.getAuthoritativePrices(),
      telemetry: this.getTelemetrySnapshot(),
    };
    this.onFlushBatch?.(batch);
    for (const listener of this.listeners) {
      listener(batch);
    }
    return batch;
  }

  private detachAndCloseSocket(sock: MinimalWebSocketLike | null): void {
    if (!sock) return;
    sock.onopen = null;
    sock.onmessage = null;
    sock.onerror = null;
    sock.onclose = null;
    try {
      if (sock.readyState <= 1) {
        sock.close();
      }
    } catch {
      // ignore close errors
    }
    if (this.ws === sock) {
      this.ws = null;
    }
  }

  private clearSocketAndTimers(resetConnectionFlag = false): void {
    if (this.connectTimeoutId !== null) {
      globalThis.clearTimeout(this.connectTimeoutId);
      this.connectTimeoutId = null;
    }
    if (this.firstFrameTimerId !== null) {
      globalThis.clearTimeout(this.firstFrameTimerId);
      this.firstFrameTimerId = null;
    }
    if (this.healTimerId !== null) {
      globalThis.clearTimeout(this.healTimerId);
      this.healTimerId = null;
    }
    if (this.watchdogTimerId !== null) {
      globalThis.clearInterval(this.watchdogTimerId);
      this.watchdogTimerId = null;
    }
    if (this.fallbackTimerId !== null) {
      globalThis.clearInterval(this.fallbackTimerId);
      this.fallbackTimerId = null;
    }
    this.detachAndCloseSocket(this.ws);
    if (resetConnectionFlag && this.wsConnected) {
      this.wsConnected = false;
      this.lastDisconnectAtIso = new Date().toISOString();
      this.onConnectionChange?.(false, this.fallbackEnforced, this.buffer.getCurrentEpoch());
    }
  }

  private startFallbackLoop(): void {
    if (!this.running || this.fallbackTimerId !== null) return;
    this.fallbackEnforced = true;
    this.onConnectionChange?.(this.wsConnected, true, this.buffer.getCurrentEpoch());
    this.fallbackTimerId = globalThis.setInterval(() => {
      if (!this.running) return;
      this.fallbackStep += 1;
      this.onFallbackStep?.(this.fallbackStep);
    }, DETERMINISTIC_FALLBACK_TICK_MS);
  }

  private scheduleReconnect(): void {
    if (!this.running || this.healTimerId !== null) return;
    if (this.healAttempt >= this.maxReconnectAttempts) {
      this.circuitOpen = true;
      this.lastRejectionReason = `WebSocket reconnect circuit breaker opened after ${this.healAttempt} consecutive attempts.`;
      return;
    }
    const delayMs = computeBoundedExponentialBackoffMs(this.healAttempt, {
      baseDelayMs: this.reconnectBaseDelayMs,
      maxDelayMs: 30_000,
    });
    this.healAttempt += 1;
    this.healTimerId = globalThis.setTimeout(() => {
      this.healTimerId = null;
      if (this.running && !this.wsConnected && !this.circuitOpen) {
        this.connectSocket();
      }
    }, delayMs);
  }

  private connectSocket(): void {
    if (!this.running || this.circuitOpen) return;
    this.clearSocketAndTimers(false);

    const createWs: WebSocketFactory | null =
      this.wsFactory ??
      (typeof globalThis.WebSocket === 'function'
        ? (url: string) => new globalThis.WebSocket(url) as unknown as MinimalWebSocketLike
        : null);

    if (!createWs) {
      this.startFallbackLoop();
      return;
    }

    const streamList = [
      '!miniTicker@arr',
      ...this.coins.map((c) => `${c.symbol.toLowerCase()}@ticker`),
    ];
    this.activeSubscriptions = streamList;
    const streams = streamList.join('/');
    const host = SPOT_WS_HOSTS[this.hostIndex % SPOT_WS_HOSTS.length];
    const streamEpoch = this.buffer.getCurrentEpoch();
    let receivedFirstFrame = false;

    try {
      const ws = createWs(`${host}?streams=${streams}`);
      this.ws = ws;
      this.lastFrameAtMs = Date.now();

      this.connectTimeoutId = globalThis.setTimeout(() => {
        this.connectTimeoutId = null;
        if (!this.running || this.ws !== ws) return;
        if (ws.readyState !== 1) {
          this.wsConnected = false;
          this.lastDisconnectAtIso = new Date().toISOString();
          this.hostIndex = (this.hostIndex + 1) % SPOT_WS_HOSTS.length;
          this.detachAndCloseSocket(ws);
          this.startFallbackLoop();
          this.scheduleReconnect();
        }
      }, WS_STALE_TIMEOUT_MS);

      this.watchdogTimerId = globalThis.setInterval(() => {
        if (!this.running || this.ws !== ws) return;
        const ageMs = Date.now() - this.lastFrameAtMs;
        if (this.wsConnected && ageMs > WS_FRAME_STALE_THRESHOLD_MS) {
          this.wsConnected = false;
          this.lastDisconnectAtIso = new Date().toISOString();
          this.hostIndex = (this.hostIndex + 1) % SPOT_WS_HOSTS.length;
          this.fallbackEnforced = true;
          this.onConnectionChange?.(false, true, this.buffer.getCurrentEpoch());
          this.clearSocketAndTimers(false);
          this.startFallbackLoop();
          this.scheduleReconnect();
        }
      }, SUBSECOND_HEARTBEAT_INTERVAL_MS);

      ws.onopen = () => {
        if (this.connectTimeoutId !== null) {
          globalThis.clearTimeout(this.connectTimeoutId);
          this.connectTimeoutId = null;
        }
        if (!this.running || this.ws !== ws) {
          this.detachAndCloseSocket(ws);
          return;
        }
        const nowIso = new Date().toISOString();
        this.lastFrameAtMs = Date.now();
        if (this.hasEverOpened) {
          this.reconnectCount += 1;
          this.lastReconnectAtIso = nowIso;
          this.restoredSubscriptionsCount += streamList.length;
        }
        this.hasEverOpened = true;
        this.wsConnected = true;
        this.fallbackEnforced = false;
        this.onConnectionChange?.(true, false, streamEpoch);

        if (this.fallbackTimerId !== null) {
          globalThis.clearInterval(this.fallbackTimerId);
          this.fallbackTimerId = null;
        }
        if (this.firstFrameTimerId !== null) {
          globalThis.clearTimeout(this.firstFrameTimerId);
        }
        this.firstFrameTimerId = globalThis.setTimeout(() => {
          this.firstFrameTimerId = null;
          if (!this.running || this.ws !== ws) return;
          if (!receivedFirstFrame) {
            this.hostIndex = (this.hostIndex + 1) % SPOT_WS_HOSTS.length;
            this.wsConnected = false;
            this.lastDisconnectAtIso = new Date().toISOString();
            this.onConnectionChange?.(false, true, this.buffer.getCurrentEpoch());
            this.clearSocketAndTimers(false);
            this.startFallbackLoop();
            this.scheduleReconnect();
          }
        }, 1500);
      };

      ws.onmessage = (event) => {
        if (!this.running || this.ws !== ws) return;
        const nowMs = Date.now();
        this.lastFrameAtMs = nowMs;
        if (!receivedFirstFrame) {
          receivedFirstFrame = true;
          this.healAttempt = 0;
          this.circuitOpen = false;
        }
        if (this.firstFrameTimerId !== null) {
          globalThis.clearTimeout(this.firstFrameTimerId);
          this.firstFrameTimerId = null;
        }
        this.ingestRawWsPayload(event.data, nowMs, streamEpoch);
      };

      ws.onerror = () => {
        if (!this.running || this.ws !== ws) return;
        this.wsConnected = false;
        this.lastDisconnectAtIso = new Date().toISOString();
        this.failedUpdatesCount += 1;
        this.hostIndex = (this.hostIndex + 1) % SPOT_WS_HOSTS.length;
        this.clearSocketAndTimers(false);
        this.onConnectionChange?.(false, true, this.buffer.getCurrentEpoch());
        this.startFallbackLoop();
        this.scheduleReconnect();
      };

      ws.onclose = () => {
        if (!this.running || this.ws !== ws) return;
        this.wsConnected = false;
        this.lastDisconnectAtIso = new Date().toISOString();
        this.clearSocketAndTimers(false);
        this.onConnectionChange?.(false, true, this.buffer.getCurrentEpoch());
        this.startFallbackLoop();
        this.scheduleReconnect();
      };
    } catch {
      this.lastDisconnectAtIso = new Date().toISOString();
      this.failedUpdatesCount += 1;
      this.clearSocketAndTimers(false);
      this.startFallbackLoop();
      this.scheduleReconnect();
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.healAttempt = 0;
    this.circuitOpen = false;
    if (this.flushTimerId === null) {
      this.flushTimerId = globalThis.setInterval(() => {
        this.flushPendingFrames();
      }, this.flushIntervalMs);
    }
    this.connectSocket();
  }

  stop(): void {
    this.running = false;
    if (this.flushTimerId !== null) {
      globalThis.clearInterval(this.flushTimerId);
      this.flushTimerId = null;
    }
    this.clearSocketAndTimers(true);
  }

  resetEpochAndReconnect(): number {
    const nextEpoch = this.buffer.discardAndBumpEpoch();
    this.fallbackStep = 0;
    this.healAttempt = 0;
    this.circuitOpen = false;
    this.wsConnected = false;
    this.onConnectionChange?.(false, true, nextEpoch);
    if (this.running) {
      this.connectSocket();
    }
    return nextEpoch;
  }

  stepFallbackSnapshot(
    prev: Record<string, TickerSnapshot>,
    coins: CoinMeta[]
  ): Record<string, TickerSnapshot> {
    this.fallbackStep += 1;
    return stepDeterministicFallbackTickers(prev, coins, this.fallbackStep);
  }
}

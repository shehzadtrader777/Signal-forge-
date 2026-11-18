import { computeATR } from './coordinator';
import {
  detectMarketRegimeFromClosedWindow,
  type MarketRegime,
} from './invariantKernels';
import {
  TIMEFRAME_SECONDS,
  type Candle,
  type Timeframe,
} from './marketData';
import {
  SUBSECOND_HEAL_DELAYS_MS,
  SUBSECOND_HEARTBEAT_INTERVAL_MS,
  WS_FRAME_STALE_THRESHOLD_MS,
  computeSelfHealDelayMs,
} from './monitorAgent';
import { calculateEMA, calculateRSI } from './signals';
import {
  SPOT_WS_HOSTS,
  validateIncomingWsTick,
  type MinimalWebSocketLike,
  type WebSocketFactory,
} from './wsDataEngine';
import {
  MIN_RR_KERNEL_CONSTANT,
  RiskEngineOrderBlockedError,
  checkRRSignalEmission,
  roundTargetPreservingFloor,
  type SignalEmissionRRReceipt,
  type StructuralStopOrigin,
  type StructuralTargetOrigin,
} from './riskEngine';

/* ═══════════════════════════════════════════════════════════════════════════
 * L1 — POINT-IN-TIME (PIT) FEED KERNEL & TRIPWIRE GUARD
 * Zero Look-Ahead Bias as a Structural Property of the Data Layer:
 * 1. PITFeed Contract: history(window), current(), is_warm(), advance(token)
 * 2. Three Identical Variants: BacktestFeed, ReplayFeed, LiveFeed
 * 3. TripwireFeed: Proxy-trapped CI Feed raising on any illegal read/advance
 * 4. Windowed-only features, Warm-up first-class state, t -> t+1 fill boundary
 * 5. Cross-Timeframe Closed-Bar Rule (HTF bars visible only when closed)
 * ═══════════════════════════════════════════════════════════════════════════ */

export type PitTimeframe = Timeframe | '1m' | '5m';
export type PitFeedMode = 'BACKTEST' | 'REPLAY' | 'LIVE' | 'TRIPWIRE';

export const PIT_TIMEFRAME_SECONDS: Readonly<Record<PitTimeframe, number>> = Object.freeze({
  '1m': 60,
  '5m': 5 * 60,
  '15m': TIMEFRAME_SECONDS['15m'],
  '1h': TIMEFRAME_SECONDS['1h'],
  '4h': TIMEFRAME_SECONDS['4h'],
  '1d': TIMEFRAME_SECONDS['1d'],
});

export function getTimeframeSeconds(timeframe: PitTimeframe): number {
  return PIT_TIMEFRAME_SECONDS[timeframe];
}

export type TripwireViolationCode =
  | 'FUTURE_READ_TRIPWIRE'
  | 'STRATEGY_ADVANCE_FORBIDDEN'
  | 'WARMUP_VIOLATION'
  | 'FULL_DATASET_ACCESS_FORBIDDEN'
  | 'SAME_BAR_FILL_FORBIDDEN'
  | 'UNCLOSED_HTF_READ_FORBIDDEN'
  | 'MONOTONIC_CURSOR_VIOLATION'
  | 'IMMUTABLE_VIEW_MUTATION'
  | 'INVALID_WINDOW_REQUEST';

export class TripwireViolationError extends Error {
  readonly code: TripwireViolationCode;
  readonly cursorIndex: number;
  readonly details: string;

  constructor(code: TripwireViolationCode, cursorIndex: number, details: string) {
    super(`[PITFeed:Tripwire:${code}@cursor=${cursorIndex}] ${details}`);
    this.name = 'TripwireViolationError';
    this.code = code;
    this.cursorIndex = cursorIndex;
    this.details = details;
  }
}

export interface WindowedPitFeatures {
  readonly cursorIndex: number;
  readonly cursorTime: number;
  readonly closedBarCount: number;
  readonly lastClose: number;
  readonly ema9: number;
  readonly ema21: number;
  readonly ema50: number;
  readonly rsi14: number;
  readonly atr14: number;
  readonly atrPercent: number;
  readonly regime: MarketRegime;
  readonly computedDynamicallyOnClosedWindow: true;
}

/**
 * Computes technical features strictly over the provided closed-bar window.
 * Zero precomputed full-series feature tables exist anywhere in L1.
 */
export function computeWindowedFeaturesFromHistory(
  closedWindow: ReadonlyArray<Candle>,
  cursorIndex: number
): WindowedPitFeatures {
  if (closedWindow.length === 0) {
    return Object.freeze({
      cursorIndex,
      cursorTime: 0,
      closedBarCount: 0,
      lastClose: 0,
      ema9: 0,
      ema21: 0,
      ema50: 0,
      rsi14: 50,
      atr14: 0,
      atrPercent: 0,
      regime: 'NORMAL',
      computedDynamicallyOnClosedWindow: true as const,
    });
  }

  const closes = closedWindow.map((c) => c.close);
  const lastCandle = closedWindow[closedWindow.length - 1];
  const ema9Arr = calculateEMA(closes, 9);
  const ema21Arr = calculateEMA(closes, 21);
  const ema50Arr = calculateEMA(closes, 50);
  const rsi14 = calculateRSI(closes, 14);
  const atr14 = computeATR([...closedWindow], 14);
  const lastClose = lastCandle.close;
  const atrPercent = lastClose > 0 ? Number(((atr14 / lastClose) * 100).toFixed(4)) : 0;
  const regime = detectMarketRegimeFromClosedWindow(closedWindow);

  return Object.freeze({
    cursorIndex,
    cursorTime: lastCandle.time,
    closedBarCount: closedWindow.length,
    lastClose,
    ema9: Number((ema9Arr[ema9Arr.length - 1] ?? lastClose).toPrecision(6)),
    ema21: Number((ema21Arr[ema21Arr.length - 1] ?? lastClose).toPrecision(6)),
    ema50: Number((ema50Arr[ema50Arr.length - 1] ?? lastClose).toPrecision(6)),
    rsi14,
    atr14,
    atrPercent,
    regime,
    computedDynamicallyOnClosedWindow: true as const,
  });
}

/* ── Unforgeable Engine Loop Capability Token ─────────────────────────────── */

export interface EngineLoopToken {
  readonly engineId: string;
}

const VALID_ENGINE_TOKENS = new WeakSet<EngineLoopToken>();

export function issueEngineLoopToken(engineId: string): EngineLoopToken {
  const token: EngineLoopToken = Object.freeze({ engineId });
  VALID_ENGINE_TOKENS.add(token);
  return token;
}

function assertValidEngineToken(token: EngineLoopToken | undefined, cursorIdx: number): void {
  if (!token || typeof token !== 'object' || !VALID_ENGINE_TOKENS.has(token)) {
    throw new TripwireViolationError(
      'STRATEGY_ADVANCE_FORBIDDEN',
      cursorIdx,
      'Unauthorized advance() call rejected: only the L1/L4 engine loop holding a valid EngineLoopToken may advance the PITFeed cursor.'
    );
  }
}

/* ── Canonical PITFeed Contracts ──────────────────────────────────────────── */

export interface PITFeedView {
  readonly mode: PitFeedMode;
  readonly symbol: string;
  readonly timeframe: PitTimeframe;
  readonly warmupRequired: number;
  cursorIndex(): number;
  cursorTime(): number;
  closedBarCloseTime(): number;
  is_warm(): boolean;
  isWarm(): boolean;
  current(): Readonly<Candle> | null;
  history(window: number): ReadonlyArray<Readonly<Candle>>;
  historyForTimeframe(targetTf: PitTimeframe, window: number): ReadonlyArray<Readonly<Candle>>;
  computeFeatures(window?: number): WindowedPitFeatures;
}

export interface PITFeed extends PITFeedView {
  hasNext(): boolean;
  advance(engineToken: EngineLoopToken): Readonly<Candle>;
  asConsumerView(): PITFeedView;
}

export interface SignalToFillBoundary {
  readonly boundaryType: 'SIGNAL_TO_FILL_BOUNDARY_V1';
  readonly signalId: string;
  readonly strategyId: string;
  readonly symbol: string;
  readonly timeframe: PitTimeframe;
  readonly signalCursorIndex: number;
  readonly signalCursorTime: number;
  readonly signalBarClosePrice: number;
  readonly intendedFillCursorIndex: number;
  readonly direction: 'BUY' | 'SELL';
  readonly stopLossDistance: number;
  readonly stopLossPct: number;
  readonly targetRR: number;
  readonly trailingAtrMult: number;
  readonly confidence: number;
  readonly setupLabel: string;
  readonly stopLossPrice?: number;
  readonly liquidityTargetPrice?: number;
  readonly stopOrigin?: StructuralStopOrigin;
  readonly targetOrigin?: StructuralTargetOrigin;
  readonly plannedRR?: number;
  readonly rrReceipt?: SignalEmissionRRReceipt;
  readonly snapshotHistoryAtSignal: ReadonlyArray<number>;
  readonly isWarmAtSignal: true;
  readonly sealedAtClose: true;
}

export interface PitFilledExecution {
  readonly boundary: SignalToFillBoundary;
  readonly fillCursorIndex: number;
  readonly fillCursorTime: number;
  readonly fillOpenPrice: number;
  readonly effectiveEntryPrice: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly slippageBps: number;
}

export interface PitSignalEmission {
  readonly direction: 'BUY' | 'SELL';
  readonly stopLossDistance: number;
  readonly stopLossPct: number;
  readonly targetRR: number;
  readonly trailingAtrMult: number;
  readonly confidence: number;
  readonly setupLabel: string;
  readonly stopLossPrice?: number;
  readonly liquidityTargetPrice?: number;
  readonly stopOrigin?: StructuralStopOrigin;
  readonly targetOrigin?: StructuralTargetOrigin;
  readonly invalidationLabel?: string;
  readonly liquidityPoolLabel?: string;
  readonly snapshotWindowSize?: number;
}

export interface PITStrategy {
  readonly strategyId: string;
  readonly warmupBars: number;
  evaluate(feed: PITFeedView): PitSignalEmission | null;
}

/* ── Shared Base Cursor Logic (Private Buffer Encapsulation) ──────────────── */

function freezeCandle(c: Candle): Readonly<Candle> {
  return Object.freeze({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  });
}

function validateMonotonicSeries(candles: ReadonlyArray<Candle>, label: string): ReadonlyArray<Readonly<Candle>> {
  const frozen: Array<Readonly<Candle>> = [];
  for (let i = 0; i < candles.length; i += 1) {
    const bar = candles[i];
    if (
      !Number.isFinite(bar.time) ||
      !Number.isFinite(bar.open) ||
      !Number.isFinite(bar.high) ||
      !Number.isFinite(bar.low) ||
      !Number.isFinite(bar.close) ||
      !Number.isFinite(bar.volume) ||
      bar.open <= 0 ||
      bar.close <= 0
    ) {
      throw new TripwireViolationError(
        'MONOTONIC_CURSOR_VIOLATION',
        i,
        `${label}: invalid non-finite or non-positive OHLCV candle at index ${i}.`
      );
    }
    if (i > 0 && bar.time <= candles[i - 1].time) {
      throw new TripwireViolationError(
        'MONOTONIC_CURSOR_VIOLATION',
        i,
        `${label}: non-monotonic timestamp at index ${i} (${bar.time} <= ${candles[i - 1].time}).`
      );
    }
    frozen.push(freezeCandle(bar));
  }
  return Object.freeze(frozen);
}

function aggregateClosedHigherTimeframeBars(
  closedBaseBars: ReadonlyArray<Readonly<Candle>>,
  baseTf: PitTimeframe,
  targetTf: PitTimeframe,
  baseCloseTimeSec: number
): ReadonlyArray<Readonly<Candle>> {
  const baseSec = getTimeframeSeconds(baseTf);
  const targetSec = getTimeframeSeconds(targetTf);

  if (targetSec < baseSec) {
    throw new TripwireViolationError(
      'UNCLOSED_HTF_READ_FORBIDDEN',
      Math.max(-1, closedBaseBars.length - 1),
      `Cannot downsample from coarser base timeframe "${baseTf}" to finer timeframe "${targetTf}" without closed sub-bar stream.`
    );
  }

  if (targetSec === baseSec) {
    return Object.freeze(closedBaseBars.slice());
  }

  const buckets = new Map<number, Array<Readonly<Candle>>>();
  for (const bar of closedBaseBars) {
    const bucketStart = Math.floor(bar.time / targetSec) * targetSec;
    const list = buckets.get(bucketStart);
    if (list) list.push(bar);
    else buckets.set(bucketStart, [bar]);
  }

  const closedHtf: Array<Readonly<Candle>> = [];
  const sortedBuckets = Array.from(buckets.keys()).sort((a, b) => a - b);
  for (const bucketStart of sortedBuckets) {
    const htfCloseTime = bucketStart + targetSec;
    // Closed-direction rule ONLY: HTF bar becomes visible strictly when htfCloseTime <= baseCloseTimeSec
    if (htfCloseTime > baseCloseTimeSec) {
      continue;
    }
    const members = buckets.get(bucketStart) ?? [];
    if (members.length === 0) continue;
    const open = members[0].open;
    const close = members[members.length - 1].close;
    let high = members[0].high;
    let low = members[0].low;
    let volume = 0;
    for (const m of members) {
      if (m.high > high) high = m.high;
      if (m.low < low) low = m.low;
      volume += m.volume;
    }
    closedHtf.push(
      freezeCandle({
        time: bucketStart,
        open,
        high,
        low,
        close,
        volume: Number(volume.toFixed(4)),
      })
    );
  }

  return Object.freeze(closedHtf);
}

function filterPreSuppliedHigherTimeframeBars(
  htfBars: ReadonlyArray<Readonly<Candle>>,
  targetTf: PitTimeframe,
  baseCloseTimeSec: number
): ReadonlyArray<Readonly<Candle>> {
  const targetSec = getTimeframeSeconds(targetTf);
  const closedOnly = htfBars.filter((bar) => bar.time + targetSec <= baseCloseTimeSec);
  return Object.freeze(closedOnly);
}

function makeConsumerViewFromFeed(feed: PITFeed): PITFeedView {
  const consumer: PITFeedView = {
    get mode() {
      return feed.mode;
    },
    get symbol() {
      return feed.symbol;
    },
    get timeframe() {
      return feed.timeframe;
    },
    get warmupRequired() {
      return feed.warmupRequired;
    },
    cursorIndex: () => feed.cursorIndex(),
    cursorTime: () => feed.cursorTime(),
    closedBarCloseTime: () => feed.closedBarCloseTime(),
    is_warm: () => feed.is_warm(),
    isWarm: () => feed.isWarm(),
    current: () => feed.current(),
    history: (window: number) => feed.history(window),
    historyForTimeframe: (targetTf: PitTimeframe, window: number) =>
      feed.historyForTimeframe(targetTf, window),
    computeFeatures: (window?: number) => feed.computeFeatures(window),
  };

  Object.defineProperty(consumer, 'advance', {
    enumerable: false,
    configurable: false,
    get() {
      throw new TripwireViolationError(
        'STRATEGY_ADVANCE_FORBIDDEN',
        feed.cursorIndex(),
        'Strategy/consumer code attempted to access advance() on read-only PITFeedView.'
      );
    },
  });

  return Object.freeze(consumer);
}

/* ── Variant 1: BacktestFeed (Immutable Historical Stepping) ──────────────── */

export interface PitFeedOptions {
  readonly symbol: string;
  readonly timeframe: PitTimeframe;
  readonly warmupBars?: number;
  readonly higherTimeframes?: Readonly<Partial<Record<PitTimeframe, ReadonlyArray<Candle>>>>;
}

export class BacktestFeed implements PITFeed {
  readonly mode: PitFeedMode = 'BACKTEST';
  readonly symbol: string;
  readonly timeframe: PitTimeframe;
  readonly warmupRequired: number;

  readonly #bars: ReadonlyArray<Readonly<Candle>>;
  readonly #higherTimeframes: Readonly<Partial<Record<PitTimeframe, ReadonlyArray<Readonly<Candle>>>>>;
  #cursorIdx = -1;
  #lastCommittedTime = -Infinity;

  constructor(candles: ReadonlyArray<Candle>, options: PitFeedOptions) {
    this.symbol = options.symbol.toUpperCase();
    this.timeframe = options.timeframe;
    this.warmupRequired = Math.max(1, Math.floor(options.warmupBars ?? 21));
    this.#bars = validateMonotonicSeries(candles, `BacktestFeed(${this.symbol}/${this.timeframe})`);

    const htfFrozen: Partial<Record<PitTimeframe, ReadonlyArray<Readonly<Candle>>>> = {};
    if (options.higherTimeframes) {
      for (const [tfKey, tfBars] of Object.entries(options.higherTimeframes)) {
        if (Array.isArray(tfBars)) {
          htfFrozen[tfKey as PitTimeframe] = validateMonotonicSeries(
            tfBars,
            `BacktestFeed.HTF(${this.symbol}/${tfKey})`
          );
        }
      }
    }
    this.#higherTimeframes = Object.freeze(htfFrozen);
  }

  cursorIndex(): number {
    return this.#cursorIdx;
  }

  cursorTime(): number {
    return this.#cursorIdx >= 0 ? this.#bars[this.#cursorIdx].time : 0;
  }

  closedBarCloseTime(): number {
    if (this.#cursorIdx < 0) return 0;
    return this.#bars[this.#cursorIdx].time + getTimeframeSeconds(this.timeframe);
  }

  is_warm(): boolean {
    return this.#cursorIdx + 1 >= this.warmupRequired;
  }

  isWarm(): boolean {
    return this.is_warm();
  }

  hasNext(): boolean {
    return this.#cursorIdx + 1 < this.#bars.length;
  }

  advance(engineToken: EngineLoopToken): Readonly<Candle> {
    assertValidEngineToken(engineToken, this.#cursorIdx);
    const nextIdx = this.#cursorIdx + 1;
    if (nextIdx >= this.#bars.length) {
      throw new TripwireViolationError(
        'FUTURE_READ_TRIPWIRE',
        this.#cursorIdx,
        `BacktestFeed(${this.symbol}): advance() called past end of historical series (index ${nextIdx} >= ${this.#bars.length}).`
      );
    }
    const bar = this.#bars[nextIdx];
    if (bar.time <= this.#lastCommittedTime) {
      throw new TripwireViolationError(
        'MONOTONIC_CURSOR_VIOLATION',
        this.#cursorIdx,
        `BacktestFeed(${this.symbol}): bar.time ${bar.time} <= lastCommitted ${this.#lastCommittedTime}.`
      );
    }
    this.#cursorIdx = nextIdx;
    this.#lastCommittedTime = bar.time;
    return bar;
  }

  current(): Readonly<Candle> | null {
    return this.#cursorIdx >= 0 ? this.#bars[this.#cursorIdx] : null;
  }

  history(window: number): ReadonlyArray<Readonly<Candle>> {
    if (!Number.isInteger(window) || window <= 0) {
      throw new TripwireViolationError(
        'INVALID_WINDOW_REQUEST',
        this.#cursorIdx,
        `history(window) requires positive integer window; received ${String(window)}.`
      );
    }
    if (this.#cursorIdx < 0) return Object.freeze([]);
    const endExclusive = this.#cursorIdx + 1;
    const start = Math.max(0, endExclusive - window);
    return Object.freeze(this.#bars.slice(start, endExclusive));
  }

  historyForTimeframe(targetTf: PitTimeframe, window: number): ReadonlyArray<Readonly<Candle>> {
    if (!Number.isInteger(window) || window <= 0) {
      throw new TripwireViolationError(
        'INVALID_WINDOW_REQUEST',
        this.#cursorIdx,
        `historyForTimeframe(window) requires positive integer window; received ${String(window)}.`
      );
    }
    if (this.#cursorIdx < 0) return Object.freeze([]);
    const baseClose = this.closedBarCloseTime();
    const baseSec = getTimeframeSeconds(this.timeframe);
    const targetSec = getTimeframeSeconds(targetTf);
    if (targetSec < baseSec) {
      throw new TripwireViolationError(
        'UNCLOSED_HTF_READ_FORBIDDEN',
        this.#cursorIdx,
        `Finer timeframe read "${targetTf}" forbidden from base "${this.timeframe}" (cross-timeframe reads are legal only in closed HTF direction).`
      );
    }

    const explicitHtf = this.#higherTimeframes[targetTf];
    const allClosedHtf = explicitHtf
      ? filterPreSuppliedHigherTimeframeBars(explicitHtf, targetTf, baseClose)
      : aggregateClosedHigherTimeframeBars(
          this.#bars.slice(0, this.#cursorIdx + 1),
          this.timeframe,
          targetTf,
          baseClose
        );

    return Object.freeze(allClosedHtf.slice(Math.max(0, allClosedHtf.length - window)));
  }

  computeFeatures(window = 120): WindowedPitFeatures {
    const closed = this.history(Math.max(1, window));
    return computeWindowedFeaturesFromHistory(closed, this.#cursorIdx);
  }

  asConsumerView(): PITFeedView {
    return makeConsumerViewFromFeed(this);
  }
}

/* ── Variant 2: ReplayFeed (Event-Driven Chronological Replay) ────────────── */

export interface ReplayBarEvent {
  readonly candle: Candle;
  readonly isClosed: boolean;
}

export class ReplayFeed implements PITFeed {
  readonly mode: PitFeedMode = 'REPLAY';
  readonly symbol: string;
  readonly timeframe: PitTimeframe;
  readonly warmupRequired: number;

  readonly #eventQueue: ReadonlyArray<ReplayBarEvent>;
  readonly #closedBars: Array<Readonly<Candle>> = [];
  readonly #higherTimeframes: Readonly<Partial<Record<PitTimeframe, ReadonlyArray<Readonly<Candle>>>>>;
  #eventCursor = 0;
  #lastCommittedTime = -Infinity;

  constructor(
    eventsOrCandles: ReadonlyArray<ReplayBarEvent | Candle>,
    options: PitFeedOptions
  ) {
    this.symbol = options.symbol.toUpperCase();
    this.timeframe = options.timeframe;
    this.warmupRequired = Math.max(1, Math.floor(options.warmupBars ?? 21));

    const normalized: ReplayBarEvent[] = eventsOrCandles.map((entry) =>
      'candle' in entry
        ? Object.freeze({ candle: freezeCandle(entry.candle), isClosed: entry.isClosed })
        : Object.freeze({ candle: freezeCandle(entry), isClosed: true })
    );

    // Ensure event timestamps never regress chronologically
    for (let i = 1; i < normalized.length; i += 1) {
      if (normalized[i].candle.time < normalized[i - 1].candle.time) {
        throw new TripwireViolationError(
          'MONOTONIC_CURSOR_VIOLATION',
          i,
          `ReplayFeed(${this.symbol}): replay events must be chronologically non-decreasing.`
        );
      }
    }
    this.#eventQueue = Object.freeze(normalized);

    const htfFrozen: Partial<Record<PitTimeframe, ReadonlyArray<Readonly<Candle>>>> = {};
    if (options.higherTimeframes) {
      for (const [tfKey, tfBars] of Object.entries(options.higherTimeframes)) {
        if (Array.isArray(tfBars)) {
          htfFrozen[tfKey as PitTimeframe] = validateMonotonicSeries(
            tfBars,
            `ReplayFeed.HTF(${this.symbol}/${tfKey})`
          );
        }
      }
    }
    this.#higherTimeframes = Object.freeze(htfFrozen);
  }

  cursorIndex(): number {
    return this.#closedBars.length - 1;
  }

  cursorTime(): number {
    return this.#closedBars.length > 0
      ? this.#closedBars[this.#closedBars.length - 1].time
      : 0;
  }

  closedBarCloseTime(): number {
    if (this.#closedBars.length === 0) return 0;
    return (
      this.#closedBars[this.#closedBars.length - 1].time +
      getTimeframeSeconds(this.timeframe)
    );
  }

  is_warm(): boolean {
    return this.#closedBars.length >= this.warmupRequired;
  }

  isWarm(): boolean {
    return this.is_warm();
  }

  hasNext(): boolean {
    for (let i = this.#eventCursor; i < this.#eventQueue.length; i += 1) {
      if (this.#eventQueue[i].isClosed) return true;
    }
    return false;
  }

  advance(engineToken: EngineLoopToken): Readonly<Candle> {
    assertValidEngineToken(engineToken, this.cursorIndex());

    // Consume intermediate unclosed intrabar replay frames until the next closed bar commits
    while (this.#eventCursor < this.#eventQueue.length) {
      const ev = this.#eventQueue[this.#eventCursor];
      this.#eventCursor += 1;
      if (!ev.isClosed) {
        continue;
      }
      if (ev.candle.time <= this.#lastCommittedTime) {
        throw new TripwireViolationError(
          'MONOTONIC_CURSOR_VIOLATION',
          this.cursorIndex(),
          `ReplayFeed(${this.symbol}): closed bar time ${ev.candle.time} <= lastCommitted ${this.#lastCommittedTime}.`
        );
      }
      this.#closedBars.push(ev.candle);
      this.#lastCommittedTime = ev.candle.time;
      return ev.candle;
    }

    throw new TripwireViolationError(
      'FUTURE_READ_TRIPWIRE',
      this.cursorIndex(),
      `ReplayFeed(${this.symbol}): advance() called with no remaining closed replay bars.`
    );
  }

  current(): Readonly<Candle> | null {
    return this.#closedBars.length > 0
      ? this.#closedBars[this.#closedBars.length - 1]
      : null;
  }

  history(window: number): ReadonlyArray<Readonly<Candle>> {
    if (!Number.isInteger(window) || window <= 0) {
      throw new TripwireViolationError(
        'INVALID_WINDOW_REQUEST',
        this.cursorIndex(),
        `history(window) requires positive integer window; received ${String(window)}.`
      );
    }
    if (this.#closedBars.length === 0) return Object.freeze([]);
    const start = Math.max(0, this.#closedBars.length - window);
    return Object.freeze(this.#closedBars.slice(start));
  }

  historyForTimeframe(targetTf: PitTimeframe, window: number): ReadonlyArray<Readonly<Candle>> {
    if (!Number.isInteger(window) || window <= 0) {
      throw new TripwireViolationError(
        'INVALID_WINDOW_REQUEST',
        this.cursorIndex(),
        `historyForTimeframe(window) requires positive integer window; received ${String(window)}.`
      );
    }
    if (this.#closedBars.length === 0) return Object.freeze([]);
    const baseClose = this.closedBarCloseTime();
    const baseSec = getTimeframeSeconds(this.timeframe);
    const targetSec = getTimeframeSeconds(targetTf);
    if (targetSec < baseSec) {
      throw new TripwireViolationError(
        'UNCLOSED_HTF_READ_FORBIDDEN',
        this.cursorIndex(),
        `Finer timeframe read "${targetTf}" forbidden from base "${this.timeframe}".`
      );
    }

    const explicitHtf = this.#higherTimeframes[targetTf];
    const allClosedHtf = explicitHtf
      ? filterPreSuppliedHigherTimeframeBars(explicitHtf, targetTf, baseClose)
      : aggregateClosedHigherTimeframeBars(
          this.#closedBars,
          this.timeframe,
          targetTf,
          baseClose
        );

    return Object.freeze(allClosedHtf.slice(Math.max(0, allClosedHtf.length - window)));
  }

  computeFeatures(window = 120): WindowedPitFeatures {
    return computeWindowedFeaturesFromHistory(
      this.history(Math.max(1, window)),
      this.cursorIndex()
    );
  }

  asConsumerView(): PITFeedView {
    return makeConsumerViewFromFeed(this);
  }
}

/* ── Variant 3: LiveFeed (Validated Streaming L1 Ingestion) ───────────────── */

export interface LiveKlineFrameInput {
  readonly candle: Candle;
  readonly isFinal: boolean;
  readonly receivedAtMs?: number;
}

export class LiveFeed implements PITFeed {
  readonly mode: PitFeedMode = 'LIVE';
  readonly symbol: string;
  readonly timeframe: PitTimeframe;
  readonly warmupRequired: number;

  readonly #committedBars: Array<Readonly<Candle>> = [];
  readonly #pendingClosedQueue: Array<Readonly<Candle>> = [];
  readonly #higherTimeframes: Readonly<Partial<Record<PitTimeframe, ReadonlyArray<Readonly<Candle>>>>>;
  #lastAcceptedTime = -Infinity;
  #lastCommittedPrice: number | undefined;
  #inProgressBar: Readonly<Candle> | null = null;
  #rejectedFrameCount = 0;

  constructor(
    seedClosedCandles: ReadonlyArray<Candle> = [],
    options: PitFeedOptions
  ) {
    this.symbol = options.symbol.toUpperCase();
    this.timeframe = options.timeframe;
    this.warmupRequired = Math.max(1, Math.floor(options.warmupBars ?? 21));

    const validSeeds = validateMonotonicSeries(
      seedClosedCandles,
      `LiveFeed.Seed(${this.symbol}/${this.timeframe})`
    );
    for (const bar of validSeeds) {
      this.#pendingClosedQueue.push(bar);
      this.#lastAcceptedTime = bar.time;
      this.#lastCommittedPrice = bar.close;
    }

    const htfFrozen: Partial<Record<PitTimeframe, ReadonlyArray<Readonly<Candle>>>> = {};
    if (options.higherTimeframes) {
      for (const [tfKey, tfBars] of Object.entries(options.higherTimeframes)) {
        if (Array.isArray(tfBars)) {
          htfFrozen[tfKey as PitTimeframe] = validateMonotonicSeries(
            tfBars,
            `LiveFeed.HTF(${this.symbol}/${tfKey})`
          );
        }
      }
    }
    this.#higherTimeframes = Object.freeze(htfFrozen);
  }

  get rejectedFrameCount(): number {
    return this.#rejectedFrameCount;
  }

  getLatestIntrabarTick(): Readonly<Candle> | null {
    return this.#inProgressBar;
  }

  /**
   * Validates incoming exchange kline tick via L1 validateIncomingWsTick gate.
   * Intrabar ticks update telemetry only; ONLY finalized bars enqueue onto the PIT cursor.
   */
  ingestLiveKlineFrame(frame: LiveKlineFrameInput): { readonly accepted: boolean; readonly committed: boolean; readonly reason: string } {
    const check = validateIncomingWsTick(
      {
        symbol: this.symbol,
        price: frame.candle.close,
        high24h: frame.candle.high,
        low24h: frame.candle.low,
        volume24hUsd: frame.candle.volume,
        receivedAtMs: frame.receivedAtMs,
        source: 'kline',
      },
      { previousPrice: this.#lastCommittedPrice }
    );

    if (
      !check.accepted ||
      !Number.isFinite(frame.candle.open) ||
      frame.candle.open <= 0 ||
      !Number.isFinite(frame.candle.time) ||
      frame.candle.time <= 0
    ) {
      this.#rejectedFrameCount += 1;
      return Object.freeze({
        accepted: false,
        committed: false,
        reason: check.accepted ? 'Invalid live candle open/timestamp.' : check.reason,
      });
    }

    const frozen = freezeCandle(frame.candle);
    this.#inProgressBar = frozen;

    if (!frame.isFinal) {
      return Object.freeze({
        accepted: true,
        committed: false,
        reason: 'Intrabar tick buffered without advancing closed PIT cursor.',
      });
    }

    if (frozen.time <= this.#lastAcceptedTime) {
      this.#rejectedFrameCount += 1;
      return Object.freeze({
        accepted: false,
        committed: false,
        reason: `Out-of-order finalized kline time ${frozen.time} <= ${this.#lastAcceptedTime}.`,
      });
    }

    this.#pendingClosedQueue.push(frozen);
    this.#lastAcceptedTime = frozen.time;
    this.#lastCommittedPrice = frozen.close;
    return Object.freeze({
      accepted: true,
      committed: true,
      reason: 'Finalized kline queued for next monotonic advance().',
    });
  }

  cursorIndex(): number {
    return this.#committedBars.length - 1;
  }

  cursorTime(): number {
    return this.#committedBars.length > 0
      ? this.#committedBars[this.#committedBars.length - 1].time
      : 0;
  }

  closedBarCloseTime(): number {
    if (this.#committedBars.length === 0) return 0;
    return (
      this.#committedBars[this.#committedBars.length - 1].time +
      getTimeframeSeconds(this.timeframe)
    );
  }

  is_warm(): boolean {
    return this.#committedBars.length >= this.warmupRequired;
  }

  isWarm(): boolean {
    return this.is_warm();
  }

  hasNext(): boolean {
    return this.#pendingClosedQueue.length > 0;
  }

  advance(engineToken: EngineLoopToken): Readonly<Candle> {
    assertValidEngineToken(engineToken, this.cursorIndex());
    const nextBar = this.#pendingClosedQueue.shift();
    if (!nextBar) {
      throw new TripwireViolationError(
        'FUTURE_READ_TRIPWIRE',
        this.cursorIndex(),
        `LiveFeed(${this.symbol}): advance() called when no finalized live bar is queued.`
      );
    }
    this.#committedBars.push(nextBar);
    return nextBar;
  }

  current(): Readonly<Candle> | null {
    return this.#committedBars.length > 0
      ? this.#committedBars[this.#committedBars.length - 1]
      : null;
  }

  history(window: number): ReadonlyArray<Readonly<Candle>> {
    if (!Number.isInteger(window) || window <= 0) {
      throw new TripwireViolationError(
        'INVALID_WINDOW_REQUEST',
        this.cursorIndex(),
        `history(window) requires positive integer window; received ${String(window)}.`
      );
    }
    if (this.#committedBars.length === 0) return Object.freeze([]);
    const start = Math.max(0, this.#committedBars.length - window);
    return Object.freeze(this.#committedBars.slice(start));
  }

  historyForTimeframe(targetTf: PitTimeframe, window: number): ReadonlyArray<Readonly<Candle>> {
    if (!Number.isInteger(window) || window <= 0) {
      throw new TripwireViolationError(
        'INVALID_WINDOW_REQUEST',
        this.cursorIndex(),
        `historyForTimeframe(window) requires positive integer window; received ${String(window)}.`
      );
    }
    if (this.#committedBars.length === 0) return Object.freeze([]);
    const baseClose = this.closedBarCloseTime();
    const baseSec = getTimeframeSeconds(this.timeframe);
    const targetSec = getTimeframeSeconds(targetTf);
    if (targetSec < baseSec) {
      throw new TripwireViolationError(
        'UNCLOSED_HTF_READ_FORBIDDEN',
        this.cursorIndex(),
        `Finer timeframe read "${targetTf}" forbidden from base "${this.timeframe}".`
      );
    }

    const explicitHtf = this.#higherTimeframes[targetTf];
    const allClosedHtf = explicitHtf
      ? filterPreSuppliedHigherTimeframeBars(explicitHtf, targetTf, baseClose)
      : aggregateClosedHigherTimeframeBars(
          this.#committedBars,
          this.timeframe,
          targetTf,
          baseClose
        );

    return Object.freeze(allClosedHtf.slice(Math.max(0, allClosedHtf.length - window)));
  }

  computeFeatures(window = 120): WindowedPitFeatures {
    return computeWindowedFeaturesFromHistory(
      this.history(Math.max(1, window)),
      this.cursorIndex()
    );
  }

  asConsumerView(): PITFeedView {
    return makeConsumerViewFromFeed(this);
  }
}

/* ── Live Kline Channel Adapter (Keeps WebSocket Exclusively Inside L1) ───── */

export interface LiveKlineChannelOptions {
  readonly symbol: string;
  readonly timeframe: PitTimeframe;
  readonly seedCandles?: ReadonlyArray<Candle>;
  readonly initialLastPrice?: number;
  readonly wsFactory?: WebSocketFactory;
  readonly onBarUpdate: (bar: Readonly<Candle>, meta: { readonly isFinal: boolean; readonly feed: PITFeedView }) => void;
}

export interface LiveKlineChannelHandle {
  readonly feed: LiveFeed;
  stop: () => void;
}

/**
 * Sole L1 client kline socket owner. UI components (e.g. CandleChart) subscribe here
 * instead of instantiating raw exchange WebSockets directly.
 */
export function createLiveFeedKlineChannel(
  options: LiveKlineChannelOptions
): LiveKlineChannelHandle {
  const feed = new LiveFeed(options.seedCandles ?? [], {
    symbol: options.symbol,
    timeframe: options.timeframe,
  });
  const internalToken = issueEngineLoopToken(`live_kline_${options.symbol}`);
  while (feed.hasNext()) {
    feed.advance(internalToken);
  }

  let ws: MinimalWebSocketLike | null = null;
  let healTimer: ReturnType<typeof setTimeout> | null = null;
  let firstFrameTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;
  let hostIndex = 0;
  let attempt = 0;
  let lastFrameAtMs = Date.now();
  let disposed = false;

  const klineWsBases = SPOT_WS_HOSTS.map((h) => h.replace(/\/stream$/, '/ws'));

  const createWs: WebSocketFactory | null =
    options.wsFactory ??
    (typeof globalThis.WebSocket === 'function'
      ? (url: string) => new globalThis.WebSocket(url) as unknown as MinimalWebSocketLike
      : null);

  const scheduleHeal = () => {
    if (disposed || healTimer !== null) return;
    const delayMs = computeSelfHealDelayMs(attempt % SUBSECOND_HEAL_DELAYS_MS.length);
    attempt += 1;
    healTimer = globalThis.setTimeout(() => {
      healTimer = null;
      connectSocket();
    }, delayMs);
  };

  const connectSocket = () => {
    if (disposed || !createWs) return;
    if (firstFrameTimer !== null) {
      globalThis.clearTimeout(firstFrameTimer);
      firstFrameTimer = null;
    }

    try {
      const stream = `${options.symbol.toLowerCase()}@kline_${options.timeframe}`;
      const baseHost = klineWsBases[hostIndex % klineWsBases.length];
      ws = createWs(`${baseHost}/${stream}`);
      lastFrameAtMs = Date.now();
      let receivedFirstFrame = false;

      ws.onopen = () => {
        attempt = 0;
        lastFrameAtMs = Date.now();
        if (disposed && ws) {
          ws.close();
          return;
        }
        firstFrameTimer = globalThis.setTimeout(() => {
          firstFrameTimer = null;
          if (!disposed && !receivedFirstFrame) {
            hostIndex = (hostIndex + 1) % klineWsBases.length;
            try {
              if (ws && ws.readyState === 1) ws.close();
            } catch {
              // ignore close error
            }
          }
        }, 1500);
      };

      ws.onmessage = (event) => {
        if (disposed) return;
        receivedFirstFrame = true;
        if (firstFrameTimer !== null) {
          globalThis.clearTimeout(firstFrameTimer);
          firstFrameTimer = null;
        }
        lastFrameAtMs = Date.now();
        try {
          const msg = JSON.parse(event.data) as {
            k?: { t?: number | string; o?: number | string; h?: number | string; l?: number | string; c?: number | string; v?: number | string; x?: boolean };
          };
          const k = msg.k;
          if (!k) return;
          const time = Math.floor(Number(k.t) / 1000);
          const open = Number(k.o);
          const high = Number(k.h);
          const low = Number(k.l);
          const close = Number(k.c);
          const volume = Number(k.v);
          const isFinal = Boolean(k.x);
          const bar: Candle = {
            time,
            open,
            high,
            low,
            close,
            volume: Number.isFinite(volume) && volume >= 0 ? volume : 0,
          };
          const res = feed.ingestLiveKlineFrame({
            candle: bar,
            isFinal,
            receivedAtMs: lastFrameAtMs,
          });
          if (!res.accepted) return;
          if (res.committed && feed.hasNext()) {
            feed.advance(internalToken);
          }
          options.onBarUpdate(freezeCandle(bar), {
            isFinal,
            feed: feed.asConsumerView(),
          });
        } catch {
          // quarantine malformed frame
        }
      };

      ws.onerror = () => {
        hostIndex = (hostIndex + 1) % klineWsBases.length;
        scheduleHeal();
      };

      ws.onclose = () => {
        if (!disposed) scheduleHeal();
      };
    } catch {
      scheduleHeal();
    }
  };

  if (createWs) {
    connectSocket();
    watchdogTimer = globalThis.setInterval(() => {
      if (disposed) return;
      if (ws && ws.readyState === 1 && Date.now() - lastFrameAtMs > WS_FRAME_STALE_THRESHOLD_MS) {
        hostIndex = (hostIndex + 1) % klineWsBases.length;
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    }, SUBSECOND_HEARTBEAT_INTERVAL_MS);
  }

  return Object.freeze({
    feed,
    stop: () => {
      disposed = true;
      if (healTimer !== null) globalThis.clearTimeout(healTimer);
      if (firstFrameTimer !== null) globalThis.clearTimeout(firstFrameTimer);
      if (watchdogTimer !== null) globalThis.clearInterval(watchdogTimer);
      if (ws) {
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
          if (ws.readyState <= 1) ws.close();
        } catch {
          // ignore
        }
        ws = null;
      }
    },
  });
}

/* ── TripwireFeed (CI Enforcement Guard Over Any PITFeed Implementation) ───── */

export interface TripwireTelemetry {
  readonly checksPerformed: number;
  readonly barsAdvanced: number;
  readonly strategyEvaluationsAfterWarmup: number;
  readonly boundariesCreated: number;
  readonly tPlusOneFillsExecuted: number;
  readonly futureReadsBlocked: number;
  readonly illegalAdvanceBlocked: number;
  readonly unclosedHtfReadsBlocked: number;
  readonly warmupViolationsBlocked: number;
  readonly sameBarFillsBlocked: number;
}

export class TripwireFeed implements PITFeed {
  readonly mode: PitFeedMode = 'TRIPWIRE';
  readonly symbol: string;
  readonly timeframe: PitTimeframe;
  readonly warmupRequired: number;

  readonly #inner: PITFeed;
  #inStrategyExecution = false;
  #checksPerformed = 0;
  #barsAdvanced = 0;
  #strategyEvaluationsAfterWarmup = 0;
  #boundariesCreated = 0;
  #tPlusOneFillsExecuted = 0;
  #futureReadsBlocked = 0;
  #illegalAdvanceBlocked = 0;
  #unclosedHtfReadsBlocked = 0;
  #warmupViolationsBlocked = 0;
  #sameBarFillsBlocked = 0;

  constructor(innerFeed: PITFeed) {
    this.#inner = innerFeed;
    this.symbol = innerFeed.symbol;
    this.timeframe = innerFeed.timeframe;
    this.warmupRequired = innerFeed.warmupRequired;
  }

  getTelemetry(): TripwireTelemetry {
    return Object.freeze({
      checksPerformed: this.#checksPerformed,
      barsAdvanced: this.#barsAdvanced,
      strategyEvaluationsAfterWarmup: this.#strategyEvaluationsAfterWarmup,
      boundariesCreated: this.#boundariesCreated,
      tPlusOneFillsExecuted: this.#tPlusOneFillsExecuted,
      futureReadsBlocked: this.#futureReadsBlocked,
      illegalAdvanceBlocked: this.#illegalAdvanceBlocked,
      unclosedHtfReadsBlocked: this.#unclosedHtfReadsBlocked,
      warmupViolationsBlocked: this.#warmupViolationsBlocked,
      sameBarFillsBlocked: this.#sameBarFillsBlocked,
    });
  }

  private wrapWindowWithTripwire(bars: ReadonlyArray<Readonly<Candle>>): ReadonlyArray<Readonly<Candle>> {
    this.#checksPerformed += 1;
    const feed = this;
    const frozenBars = Object.freeze(
      bars.map((bar) =>
        new Proxy(freezeCandle(bar), {
          set(_target, prop) {
            throw new TripwireViolationError(
              'IMMUTABLE_VIEW_MUTATION',
              feed.cursorIndex(),
              `Mutation of immutable PIT candle property "${String(prop)}" is forbidden.`
            );
          },
        })
      )
    );

    return new Proxy(frozenBars, {
      get(target, prop, receiver) {
        if (typeof prop === 'string') {
          if (/^-?\d+$/.test(prop)) {
            const idx = Number(prop);
            if (idx < 0 || idx >= target.length) {
              feed.#futureReadsBlocked += 1;
              throw new TripwireViolationError(
                'FUTURE_READ_TRIPWIRE',
                feed.cursorIndex(),
                `Tripwire triggered: attempted windowed index access [${idx}] outside visible closed slice [0..${target.length - 1}].`
              );
            }
          }
          if (prop === 'rawBars' || prop === 'bars' || prop === '_bars' || prop === 'allCandles') {
            feed.#futureReadsBlocked += 1;
            throw new TripwireViolationError(
              'FULL_DATASET_ACCESS_FORBIDDEN',
              feed.cursorIndex(),
              `Tripwire triggered: attempted raw dataset property "${prop}".`
            );
          }
        }
        return Reflect.get(target, prop, receiver);
      },
      set(_target, prop) {
        throw new TripwireViolationError(
          'IMMUTABLE_VIEW_MUTATION',
          feed.cursorIndex(),
          `Tripwire triggered: attempted mutation "${String(prop)}" on immutable history window.`
        );
      },
    });
  }

  cursorIndex(): number {
    return this.#inner.cursorIndex();
  }

  cursorTime(): number {
    return this.#inner.cursorTime();
  }

  closedBarCloseTime(): number {
    return this.#inner.closedBarCloseTime();
  }

  is_warm(): boolean {
    return this.#inner.is_warm();
  }

  isWarm(): boolean {
    return this.is_warm();
  }

  hasNext(): boolean {
    return this.#inner.hasNext();
  }

  advance(engineToken: EngineLoopToken): Readonly<Candle> {
    if (this.#inStrategyExecution) {
      this.#illegalAdvanceBlocked += 1;
      throw new TripwireViolationError(
        'STRATEGY_ADVANCE_FORBIDDEN',
        this.cursorIndex(),
        'Tripwire triggered: strategy attempted to call advance() during strategy evaluation!'
      );
    }
    try {
      assertValidEngineToken(engineToken, this.cursorIndex());
    } catch (err) {
      this.#illegalAdvanceBlocked += 1;
      throw err;
    }

    try {
      const bar = this.#inner.advance(engineToken);
      this.#barsAdvanced += 1;
      this.#checksPerformed += 1;
      return bar;
    } catch (err) {
      if (err instanceof TripwireViolationError && err.code === 'FUTURE_READ_TRIPWIRE') {
        this.#futureReadsBlocked += 1;
      }
      throw err;
    }
  }

  current(): Readonly<Candle> | null {
    const bar = this.#inner.current();
    if (!bar) return null;
    this.#checksPerformed += 1;
    const feed = this;
    return new Proxy(bar, {
      set(_target, prop) {
        throw new TripwireViolationError(
          'IMMUTABLE_VIEW_MUTATION',
          feed.cursorIndex(),
          `Tripwire triggered: attempted mutation "${String(prop)}" on current() bar.`
        );
      },
    });
  }

  history(window: number): ReadonlyArray<Readonly<Candle>> {
    if (window > Math.max(1, this.cursorIndex() + 1) && this.cursorIndex() >= 0) {
      // Requesting window > closed bars returns only closed bars up to cursor, NEVER future bars;
      // verify inner result never leaks more than closed count.
    }
    const slice = this.#inner.history(window);
    if (slice.length > Math.max(0, this.cursorIndex() + 1)) {
      this.#futureReadsBlocked += 1;
      throw new TripwireViolationError(
        'FUTURE_READ_TRIPWIRE',
        this.cursorIndex(),
        `Tripwire triggered: history(${window}) returned ${slice.length} bars exceeding cursor+1 (${this.cursorIndex() + 1}).`
      );
    }
    return this.wrapWindowWithTripwire(slice);
  }

  historyForTimeframe(targetTf: PitTimeframe, window: number): ReadonlyArray<Readonly<Candle>> {
    try {
      const htfSlice = this.#inner.historyForTimeframe(targetTf, window);
      const baseClose = this.closedBarCloseTime();
      const targetSec = getTimeframeSeconds(targetTf);
      for (const hBar of htfSlice) {
        if (hBar.time + targetSec > baseClose) {
          this.#unclosedHtfReadsBlocked += 1;
          throw new TripwireViolationError(
            'UNCLOSED_HTF_READ_FORBIDDEN',
            this.cursorIndex(),
            `Tripwire triggered: unclosed ${targetTf} bar (close=${hBar.time + targetSec}) exposed at baseClose=${baseClose}.`
          );
        }
      }
      return this.wrapWindowWithTripwire(htfSlice);
    } catch (err) {
      if (err instanceof TripwireViolationError && err.code === 'UNCLOSED_HTF_READ_FORBIDDEN') {
        this.#unclosedHtfReadsBlocked += 1;
      }
      throw err;
    }
  }

  computeFeatures(window = 120): WindowedPitFeatures {
    this.#checksPerformed += 1;
    return computeWindowedFeaturesFromHistory(
      this.history(Math.max(1, window)),
      this.cursorIndex()
    );
  }

  /**
   * Explicit CI probe method allowing tests to assert that inspecting any index beyond cursor
   * immediately raises TripwireViolationError('FUTURE_READ_TRIPWIRE').
   */
  probeIndex(targetIndex: number): Readonly<Candle> {
    if (targetIndex > this.cursorIndex()) {
      this.#futureReadsBlocked += 1;
      throw new TripwireViolationError(
        'FUTURE_READ_TRIPWIRE',
        this.cursorIndex(),
        `Tripwire triggered: illegal probe at future index ${targetIndex} while cursor=${this.cursorIndex()}.`
      );
    }
    const allClosed = this.history(this.cursorIndex() + 1);
    return allClosed[targetIndex];
  }

  /**
   * Executes strategy callback strictly after confirming is_warm(), trapping any attempt
   * by the strategy to invoke advance() on the underlying feed or view.
   */
  invokeStrategyGuarded(strategy: PITStrategy): PitSignalEmission | null {
    if (!this.is_warm()) {
      this.#warmupViolationsBlocked += 1;
      throw new TripwireViolationError(
        'WARMUP_VIOLATION',
        this.cursorIndex(),
        `Tripwire triggered: strategy "${strategy.strategyId}" invoked at closedBars=${this.cursorIndex() + 1} < warmupRequired=${this.warmupRequired}.`
      );
    }
    this.#inStrategyExecution = true;
    try {
      this.#strategyEvaluationsAfterWarmup += 1;
      return strategy.evaluate(this.asConsumerView());
    } finally {
      this.#inStrategyExecution = false;
    }
  }

  recordBoundaryCreated(): void {
    this.#boundariesCreated += 1;
  }

  verifyAndRecordTPlusOneFill(boundary: SignalToFillBoundary): void {
    const fillCursor = this.cursorIndex();
    if (fillCursor <= boundary.signalCursorIndex || !boundary.sealedAtClose) {
      this.#sameBarFillsBlocked += 1;
      throw new TripwireViolationError(
        'SAME_BAR_FILL_FORBIDDEN',
        fillCursor,
        `Tripwire triggered: fill attempted at cursor ${fillCursor} <= signalCursor ${boundary.signalCursorIndex}. Must fill strictly at t+1.`
      );
    }
    this.#tPlusOneFillsExecuted += 1;
  }

  asConsumerView(): PITFeedView {
    const view = makeConsumerViewFromFeed(this);
    const feed = this;
    return new Proxy(view, {
      get(target, prop, receiver) {
        if (prop === 'advance') {
          feed.#illegalAdvanceBlocked += 1;
          throw new TripwireViolationError(
            'STRATEGY_ADVANCE_FORBIDDEN',
            feed.cursorIndex(),
            'Tripwire triggered: consumer view forbids accessing advance().'
          );
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }
}

/* ── Signal -> Fill Boundary Builder & Engine Loop Runner ────────────────── */

export function createSignalToFillBoundary(params: {
  signalId: string;
  strategyId: string;
  feedView: PITFeedView;
  emission: PitSignalEmission;
}): SignalToFillBoundary {
  const currentBar = params.feedView.current();
  if (!params.feedView.is_warm() || !currentBar) {
    throw new TripwireViolationError(
      'WARMUP_VIOLATION',
      params.feedView.cursorIndex(),
      `Cannot create SignalToFillBoundary before feed warm-up completes.`
    );
  }

  if (!Number.isFinite(params.emission.targetRR) || params.emission.targetRR < MIN_RR_KERNEL_CONSTANT) {
    throw new RiskEngineOrderBlockedError(
      'RR_REJECT_SIGNAL',
      'signal_emission',
      `RRGateKernel rejected boundary creation: targetRR=${params.emission.targetRR} < mandatory ${MIN_RR_KERNEL_CONSTANT}.`
    );
  }

  let rrReceipt: SignalEmissionRRReceipt | undefined;
  let plannedRR = params.emission.targetRR;
  if (
    params.emission.stopLossPrice !== undefined ||
    params.emission.liquidityTargetPrice !== undefined
  ) {
    const rrCheck = checkRRSignalEmission({
      direction: params.emission.direction,
      entryPrice: currentBar.close,
      stopLoss: params.emission.stopLossPrice,
      takeProfit: params.emission.liquidityTargetPrice,
      stopOrigin: params.emission.stopOrigin,
      targetOrigin: params.emission.targetOrigin,
      invalidationLabel: params.emission.invalidationLabel,
      liquidityPoolLabel: params.emission.liquidityPoolLabel,
    });
    if (!rrCheck.passed || !rrCheck.signalReceipt) {
      throw new RiskEngineOrderBlockedError(
        rrCheck.rejectionCode ?? 'RR_REJECT_SIGNAL',
        'signal_emission',
        rrCheck.reason
      );
    }
    rrReceipt = rrCheck.signalReceipt;
    plannedRR = rrCheck.plannedRR;
  }

  const snapWindow = Math.max(6, params.emission.snapshotWindowSize ?? 14);
  const snapPoints = params.feedView.history(snapWindow).map((c) => c.close);

  return Object.freeze({
    boundaryType: 'SIGNAL_TO_FILL_BOUNDARY_V1' as const,
    signalId: params.signalId,
    strategyId: params.strategyId,
    symbol: params.feedView.symbol,
    timeframe: params.feedView.timeframe,
    signalCursorIndex: params.feedView.cursorIndex(),
    signalCursorTime: currentBar.time,
    signalBarClosePrice: currentBar.close,
    intendedFillCursorIndex: params.feedView.cursorIndex() + 1,
    direction: params.emission.direction,
    stopLossDistance: params.emission.stopLossDistance,
    stopLossPct: params.emission.stopLossPct,
    targetRR: Math.max(MIN_RR_KERNEL_CONSTANT, params.emission.targetRR),
    trailingAtrMult: params.emission.trailingAtrMult,
    confidence: params.emission.confidence,
    setupLabel: params.emission.setupLabel,
    ...(params.emission.stopLossPrice !== undefined
      ? { stopLossPrice: params.emission.stopLossPrice }
      : {}),
    ...(params.emission.liquidityTargetPrice !== undefined
      ? { liquidityTargetPrice: params.emission.liquidityTargetPrice }
      : {}),
    ...(params.emission.stopOrigin ? { stopOrigin: params.emission.stopOrigin } : {}),
    ...(params.emission.targetOrigin ? { targetOrigin: params.emission.targetOrigin } : {}),
    plannedRR,
    ...(rrReceipt ? { rrReceipt } : {}),
    snapshotHistoryAtSignal: Object.freeze(snapPoints),
    isWarmAtSignal: true as const,
    sealedAtClose: true as const,
  });
}

export function executeBoundaryFillAtNextCursor(
  boundary: SignalToFillBoundary,
  feedAtTPlus1: PITFeedView,
  slippageBps = 4.0
): PitFilledExecution {
  const fillCursor = feedAtTPlus1.cursorIndex();
  const fillBar = feedAtTPlus1.current();

  if (!fillBar || fillCursor <= boundary.signalCursorIndex) {
    throw new TripwireViolationError(
      'SAME_BAR_FILL_FORBIDDEN',
      fillCursor,
      `Fill timing violation: signalCursor=${boundary.signalCursorIndex}, attemptedFillCursor=${fillCursor}.`
    );
  }

  const fillOpenPrice = fillBar.open;
  const slipFrac = Math.max(0, slippageBps) / 10_000;
  const effectiveEntryPrice = Number(
    (boundary.direction === 'BUY'
      ? fillOpenPrice * (1 + slipFrac)
      : Math.max(1e-8, fillOpenPrice * (1 - slipFrac))
    ).toPrecision(6)
  );

  const boundedRiskDist = Math.min(
    effectiveEntryPrice * (Math.min(2.0, Math.max(0.25, boundary.stopLossPct)) / 100),
    Math.max(effectiveEntryPrice * 0.0025, boundary.stopLossDistance)
  );

  const stopLoss = Number(
    (boundary.direction === 'BUY'
      ? Math.max(1e-8, effectiveEntryPrice - boundedRiskDist)
      : effectiveEntryPrice + boundedRiskDist
    ).toPrecision(6)
  );
  const actualRiskDist = Math.max(1e-8, Math.abs(effectiveEntryPrice - stopLoss));
  const rawTp =
    boundary.direction === 'BUY'
      ? effectiveEntryPrice + actualRiskDist * Math.max(MIN_RR_KERNEL_CONSTANT, boundary.targetRR)
      : Math.max(1e-8, effectiveEntryPrice - actualRiskDist * Math.max(MIN_RR_KERNEL_CONSTANT, boundary.targetRR));
  const takeProfit = roundTargetPreservingFloor(
    boundary.direction,
    effectiveEntryPrice,
    stopLoss,
    rawTp,
    Math.max(MIN_RR_KERNEL_CONSTANT, boundary.targetRR)
  );

  return Object.freeze({
    boundary,
    fillCursorIndex: fillCursor,
    fillCursorTime: fillBar.time,
    fillOpenPrice,
    effectiveEntryPrice,
    stopLoss,
    takeProfit,
    slippageBps,
  });
}

export interface EngineRunReport {
  readonly feedMode: PitFeedMode;
  readonly symbol: string;
  readonly timeframe: PitTimeframe;
  readonly strategyId: string;
  readonly barsProcessed: number;
  readonly warmupBarsSkipped: number;
  readonly boundariesCreated: number;
  readonly fillsExecuted: number;
  readonly boundaries: ReadonlyArray<SignalToFillBoundary>;
  readonly fills: ReadonlyArray<PitFilledExecution>;
}

/**
 * Canonical PIT Strategy Execution Loop:
 * Identical across BacktestFeed, ReplayFeed, LiveFeed, and TripwireFeed.
 * - Only the engine loop calls feed.advance(engineToken)
 * - Strategies are never invoked before feed.is_warm()
 * - Signals emitted at cursor t transition across SignalToFillBoundary and fill at cursor t+1
 */
export function runStrategyAcrossPitFeed(params: {
  feed: PITFeed;
  strategy: PITStrategy;
  slippageBps?: number;
}): EngineRunReport {
  const { feed, strategy, slippageBps = 4.0 } = params;
  const engineToken = issueEngineLoopToken(`engine_${strategy.strategyId}_${feed.mode}`);
  const tripwire = feed instanceof TripwireFeed ? feed : null;

  let barsProcessed = 0;
  let warmupBarsSkipped = 0;
  let pendingBoundary: SignalToFillBoundary | null = null;
  const boundaries: SignalToFillBoundary[] = [];
  const fills: PitFilledExecution[] = [];

  while (feed.hasNext()) {
    feed.advance(engineToken);
    barsProcessed += 1;

    const consumerView = feed.asConsumerView();

    // Phase 2 at cursor t+1: fill any boundary created at cursor t
    if (pendingBoundary) {
      if (tripwire) {
        tripwire.verifyAndRecordTPlusOneFill(pendingBoundary);
      }
      const fill = executeBoundaryFillAtNextCursor(pendingBoundary, consumerView, slippageBps);
      fills.push(fill);
      pendingBoundary = null;
    }

    // Warm-up gate: never invoke strategy until is_warm() === true
    if (!feed.is_warm()) {
      warmupBarsSkipped += 1;
      continue;
    }

    // Phase 1 at cursor t: evaluate strategy strictly on consumerView
    const emission = tripwire
      ? tripwire.invokeStrategyGuarded(strategy)
      : strategy.evaluate(consumerView);

    if (emission) {
      const boundary = createSignalToFillBoundary({
        signalId: `sig_${strategy.strategyId}_${feed.symbol}_${feed.cursorIndex()}`,
        strategyId: strategy.strategyId,
        feedView: consumerView,
        emission,
      });
      if (tripwire) {
        tripwire.recordBoundaryCreated();
      }
      boundaries.push(boundary);
      pendingBoundary = boundary;
    }
  }

  return Object.freeze({
    feedMode: feed.mode,
    symbol: feed.symbol,
    timeframe: feed.timeframe,
    strategyId: strategy.strategyId,
    barsProcessed,
    warmupBarsSkipped,
    boundariesCreated: boundaries.length,
    fillsExecuted: fills.length,
    boundaries: Object.freeze(boundaries),
    fills: Object.freeze(fills),
  });
}

/* ── Causal Feature & Signal Invariance Verifier ──────────────────────────── */

export function verifyCausalFeatureInvariance(params: {
  candles: ReadonlyArray<Candle>;
  symbol: string;
  timeframe: PitTimeframe;
  cursorIndex: number;
  warmupBars?: number;
  strategy?: PITStrategy;
}): {
  readonly invariant: boolean;
  readonly cursorIndex: number;
  readonly baseFeatures: WindowedPitFeatures;
  readonly perturbedFeatures: WindowedPitFeatures;
  readonly baseSignalDirection: 'BUY' | 'SELL' | 'NONE';
  readonly perturbedSignalDirection: 'BUY' | 'SELL' | 'NONE';
} {
  const { candles, symbol, timeframe, cursorIndex, warmupBars = 25, strategy } = params;
  if (cursorIndex < warmupBars || cursorIndex >= candles.length - 1) {
    throw new Error('cursorIndex must be >= warmupBars and leave >= 1 future bar for perturbation.');
  }

  const perturbedCandles = candles.map((c, idx) =>
    idx > cursorIndex
      ? {
          ...c,
          open: c.open * 7.5,
          high: c.high * 9.0,
          low: c.low * 0.15,
          close: c.close * 8.2,
          volume: c.volume * 50,
        }
      : c
  );

  const runUpToCursor = (series: ReadonlyArray<Candle>) => {
    const feed = new TripwireFeed(
      new BacktestFeed(series, { symbol, timeframe, warmupBars })
    );
    const tok = issueEngineLoopToken('causal_probe');
    for (let i = 0; i <= cursorIndex; i += 1) {
      feed.advance(tok);
    }
    const features = feed.computeFeatures(120);
    const sig = strategy ? feed.invokeStrategyGuarded(strategy) : null;
    return { features, sig };
  };

  const base = runUpToCursor(candles);
  const pert = runUpToCursor(perturbedCandles);

  const invariant =
    base.features.ema9 === pert.features.ema9 &&
    base.features.ema21 === pert.features.ema21 &&
    base.features.ema50 === pert.features.ema50 &&
    base.features.rsi14 === pert.features.rsi14 &&
    base.features.atr14 === pert.features.atr14 &&
    base.features.regime === pert.features.regime &&
    (base.sig?.direction ?? 'NONE') === (pert.sig?.direction ?? 'NONE') &&
    (base.sig?.stopLossDistance ?? 0) === (pert.sig?.stopLossDistance ?? 0);

  return Object.freeze({
    invariant,
    cursorIndex,
    baseFeatures: base.features,
    perturbedFeatures: pert.features,
    baseSignalDirection: base.sig?.direction ?? 'NONE',
    perturbedSignalDirection: pert.sig?.direction ?? 'NONE',
  });
}

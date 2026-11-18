import { advanceAtrTrailingStop, computeATR } from './coordinator';
import { type Candle } from './marketData';
import { type TradingSignal } from './signals';

export type PinnedSignalStatus = 'ACTIVE' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_WIN' | 'SL_STOPPED';

export interface PinnedSignalRecord {
  signal: TradingSignal;
  pinnedAt: string;
  status: PinnedSignalStatus;
  highestTpHit: 0 | 1 | 2 | 3;
  atr14: number;
  trailingStopLoss: number;
  currentPrice: number;
  unrealizedR: number;
  resolvedAt?: string;
  outcomePrice?: number;
  realizedR?: number;
}

export const MIN_PINNED_SIGNALS = 6;
export const MAX_PINNED_SIGNALS = 12;

export function isPinnedSignalResolved(status: PinnedSignalStatus): boolean {
  return status === 'TP3_WIN' || status === 'SL_STOPPED';
}

const VALID_PINNED_STATUSES = new Set<PinnedSignalStatus>([
  'ACTIVE',
  'TP1_HIT',
  'TP2_HIT',
  'TP3_WIN',
  'SL_STOPPED',
]);

export function isValidPinnedRecord(item: unknown): item is PinnedSignalRecord {
  if (!item || typeof item !== 'object') return false;
  const rec = item as Partial<PinnedSignalRecord>;
  const sig = rec.signal as Partial<TradingSignal> | undefined;
  if (!sig || typeof sig !== 'object') return false;
  if (typeof sig.symbol !== 'string' || sig.symbol.trim().length === 0) return false;
  if (typeof sig.coinName !== 'string' || sig.coinName.trim().length === 0) return false;
  if (sig.direction !== 'BUY' && sig.direction !== 'SELL') return false;
  if (!Number.isFinite(sig.entryPrice) || (sig.entryPrice ?? 0) <= 0) return false;
  if (!Number.isFinite(sig.stopLoss)) return false;
  if (!Number.isFinite(sig.confidence)) return false;
  if (
    !sig.indicators ||
    typeof sig.indicators !== 'object' ||
    typeof sig.indicators.pattern !== 'string'
  ) {
    return false;
  }
  if (
    !Array.isArray(sig.takeProfits) ||
    sig.takeProfits.length < 3 ||
    !sig.takeProfits.every((tp) => Number.isFinite(tp) && tp > 0)
  ) {
    return false;
  }
  if (!rec.status || !VALID_PINNED_STATUSES.has(rec.status)) return false;
  if (!Number.isFinite(rec.atr14) || !Number.isFinite(rec.trailingStopLoss)) return false;
  if (!Number.isFinite(rec.currentPrice)) return false;
  return true;
}

export function sanitizePinnedSignals(raw: unknown): PinnedSignalRecord[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const clean: PinnedSignalRecord[] = [];
  for (const item of raw) {
    if (!isValidPinnedRecord(item)) continue;
    const sym = item.signal.symbol.toUpperCase();
    if (seen.has(sym)) continue;
    seen.add(sym);
    clean.push(item);
    if (clean.length >= MAX_PINNED_SIGNALS) break;
  }
  return clean;
}

function deriveAtr14(signal: TradingSignal, candles?: Candle[]): number {
  if (signal.atrValue && signal.atrValue > 0) return signal.atrValue;
  if (candles && candles.length >= 2) return computeATR(candles, 14);
  return Number((signal.entryPrice * 0.014).toPrecision(6));
}

function createPinnedRecord(
  signal: TradingSignal,
  candles?: Candle[],
  nowIso: string = new Date().toISOString()
): PinnedSignalRecord {
  const atr14 = deriveAtr14(signal, candles);
  const trailMult = signal.trailingAtrMultiplier ?? 1.25;
  const trail =
    signal.trailingStop && signal.trailingStop > 0
      ? signal.trailingStop
      : signal.direction === 'BUY'
      ? Number(
          Math.max(signal.stopLoss, signal.entryPrice - atr14 * trailMult).toPrecision(6)
        )
      : Number(
          Math.min(signal.stopLoss, signal.entryPrice + atr14 * trailMult).toPrecision(6)
        );

  return {
    signal: {
      ...signal,
      trailingStop: trail,
      atrValue: atr14,
    },
    pinnedAt: nowIso,
    status: 'ACTIVE',
    highestTpHit: 0,
    atr14,
    trailingStopLoss: trail,
    currentPrice: signal.entryPrice,
    unrealizedR: 0,
  };
}

/**
 * Keeps up to 5 (minimum 3 when candidates exist) strongest AI signals permanently pinned
 * until their final outcome (TP3_WIN or SL_STOPPED) is reached. Active or partial-TP
 * signals are never evicted by transient rescans.
 */
export function syncPinnedSignals(
  existing: PinnedSignalRecord[],
  candidates: TradingSignal[],
  candlesMap: Record<string, Candle[]> = {},
  maxPinned: number = MAX_PINNED_SIGNALS,
  nowIso: string = new Date().toISOString()
): PinnedSignalRecord[] {
  const pinnedMap = new Map<string, PinnedSignalRecord>();
  const ordered: PinnedSignalRecord[] = [];
  let droppedOrDuped = false;

  for (const item of existing) {
    if (!isValidPinnedRecord(item)) {
      droppedOrDuped = true;
      continue;
    }
    const sym = item.signal.symbol.toUpperCase();
    if (pinnedMap.has(sym) || ordered.length >= maxPinned) {
      droppedOrDuped = true;
      continue;
    }
    ordered.push(item);
    pinnedMap.set(sym, item);
  }

  // Sort incoming candidates by confidence descending
  const sorted = candidates
    .slice()
    .sort((a, b) => b.confidence - a.confidence || (b.priorityScore ?? 0) - (a.priorityScore ?? 0));

  let added = false;
  for (const cand of sorted) {
    if (ordered.length >= maxPinned) break;
    if (!cand || typeof cand.symbol !== 'string' || !Number.isFinite(cand.entryPrice) || cand.entryPrice <= 0) {
      continue;
    }
    const sym = cand.symbol.toUpperCase();
    if (pinnedMap.has(sym)) continue;
    const rec = createPinnedRecord(cand, candlesMap[cand.symbol], nowIso);
    ordered.push(rec);
    pinnedMap.set(sym, rec);
    added = true;
  }

  if (!added && !droppedOrDuped && ordered.length === existing.length) {
    return existing;
  }

  return ordered;
}

/**
 * Removes unresolved pinned records whose entryPrice diverges significantly (>10%)
 * from newly hydrated live Binance Futures mark prices (for example initial seed caches).
 */
export function dropDivergentSeedPinnedSignals(
  pinned: PinnedSignalRecord[],
  livePriceMap: Record<string, number>,
  maxDivergenceRatio = 0.1,
  nowMs: number = Date.now()
): PinnedSignalRecord[] {
  const filtered = pinned.filter((item) => {
    if (!isValidPinnedRecord(item)) return false;
    const livePrice = livePriceMap[item.signal.symbol];
    if (!Number.isFinite(livePrice) || livePrice <= 0 || item.signal.entryPrice <= 0) {
      return true;
    }
    const diffRatio = Math.abs(livePrice - item.signal.entryPrice) / item.signal.entryPrice;
    if (diffRatio <= maxDivergenceRatio) return true;

    const pinnedMs = Date.parse(item.pinnedAt);
    const isFreshSeedPin = Number.isFinite(pinnedMs) && nowMs - pinnedMs < 30_000;
    if (!isPinnedSignalResolved(item.status) || isFreshSeedPin) {
      return false;
    }
    return true;
  });

  return filtered.length === pinned.length ? pinned : filtered;
}

/**
 * Evaluates live price progression against mandated ATR trailing stop loss & TP1-TP3
 * targets for every pinned signal. Once TP3 or ATR SL triggers, marks final outcome.
 */
export function evaluatePinnedSignalsLiveOutcome(
  pinned: PinnedSignalRecord[],
  livePriceMap: Record<string, number>,
  candlesMap: Record<string, Candle[]> = {},
  nowIso: string = new Date().toISOString()
): PinnedSignalRecord[] {
  let mutated = false;
  const next = pinned.map((item): PinnedSignalRecord => {
    if (!isValidPinnedRecord(item) || isPinnedSignalResolved(item.status)) {
      return item;
    }

    const livePrice = livePriceMap[item.signal.symbol];
    if (!Number.isFinite(livePrice) || livePrice <= 0) {
      return item;
    }

    const isBuy = item.signal.direction === 'BUY';
    const entry = item.signal.entryPrice;
    const riskDist = Math.max(Math.abs(entry - item.signal.stopLoss), entry * 0.004);
    const atr14 = candlesMap[item.signal.symbol]?.length
      ? computeATR(candlesMap[item.signal.symbol], 14)
      : item.atr14;

    // Monotonically advance mandated ATR trailing stop loss (wider for Top Gainer / Pre-Pump leaders)
    const nextTrailSl = advanceAtrTrailingStop(
      {
        direction: item.signal.direction,
        initialStopLoss: item.signal.stopLoss,
        trailingStopLoss: item.trailingStopLoss,
      },
      livePrice,
      atr14,
      item.signal.trailingAtrMultiplier ?? 1.25
    );

    const rawR = isBuy ? (livePrice - entry) / riskDist : (entry - livePrice) / riskDist;
    const unrealizedR = Number(rawR.toFixed(2));
    const [tp1, tp2, tp3] = item.signal.takeProfits;

    // Check final TP3 win first
    const hitTp3 = isBuy ? livePrice >= tp3 : livePrice <= tp3;
    if (hitTp3) {
      mutated = true;
      return {
        ...item,
        atr14,
        trailingStopLoss: nextTrailSl,
        currentPrice: livePrice,
        unrealizedR,
        highestTpHit: 3,
        status: 'TP3_WIN',
        resolvedAt: nowIso,
        outcomePrice: livePrice,
        realizedR: Math.max(unrealizedR, item.signal.dynamicRRs?.[2] ?? 3.5),
      };
    }

    // Check ATR Trailing SL / Initial SL trigger
    const hitStop = isBuy ? livePrice <= nextTrailSl : livePrice >= nextTrailSl;
    if (hitStop) {
      const stopR = Number(
        (
          (isBuy ? nextTrailSl - entry : entry - nextTrailSl) / riskDist
        ).toFixed(2)
      );
      mutated = true;
      return {
        ...item,
        atr14,
        trailingStopLoss: nextTrailSl,
        currentPrice: livePrice,
        unrealizedR: stopR,
        status: 'SL_STOPPED',
        resolvedAt: nowIso,
        outcomePrice: nextTrailSl,
        realizedR: stopR,
      };
    }

    // Check intermediate TP milestones (remains pinned until final TP3 or SL outcome)
    const hitTp2 = isBuy ? livePrice >= tp2 : livePrice <= tp2;
    const hitTp1 = isBuy ? livePrice >= tp1 : livePrice <= tp1;

    const highestTpHit: 0 | 1 | 2 | 3 = hitTp2
      ? Math.max(item.highestTpHit, 2) as 0 | 1 | 2 | 3
      : hitTp1
      ? Math.max(item.highestTpHit, 1) as 0 | 1 | 2 | 3
      : item.highestTpHit;

    const nextStatus: PinnedSignalStatus =
      highestTpHit >= 2 ? 'TP2_HIT' : highestTpHit >= 1 ? 'TP1_HIT' : 'ACTIVE';

    if (
      nextStatus === item.status &&
      highestTpHit === item.highestTpHit &&
      nextTrailSl === item.trailingStopLoss &&
      Math.abs(livePrice - item.currentPrice) <= 1e-8 &&
      unrealizedR === item.unrealizedR &&
      atr14 === item.atr14
    ) {
      return item;
    }

    mutated = true;
    return {
      ...item,
      signal: {
        ...item.signal,
        trailingStop: nextTrailSl,
      },
      atr14,
      trailingStopLoss: nextTrailSl,
      currentPrice: livePrice,
      unrealizedR,
      highestTpHit,
      status: nextStatus,
    };
  });

  return mutated ? next : pinned;
}

/**
 * Unpins resolved signals so fresh top candidates can take their place cleanly,
 * while retaining all active/unresolved pinned signals.
 */
export function rotateResolvedPinnedSignals(
  pinned: PinnedSignalRecord[],
  candidates: TradingSignal[],
  candlesMap: Record<string, Candle[]> = {},
  maxPinned: number = MAX_PINNED_SIGNALS,
  nowIso: string = new Date().toISOString()
): PinnedSignalRecord[] {
  const stillActive = pinned.filter((p) => !isPinnedSignalResolved(p.status));
  return syncPinnedSignals(stillActive, candidates, candlesMap, maxPinned, nowIso);
}

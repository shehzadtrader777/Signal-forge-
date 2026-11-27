/**
 * Signal Forge — Public Smart Chart & Trade ID Verification Model
 *
 * Pure, deterministic helpers that translate a verified CanonicalTradeRecord
 * and actual fetched market history candles into Lightweight Charts v5 overlays:
 *  - Entry / Signal, Stop Loss, Take Profit, and Breakout / Pattern price lines
 *  - Strictly ascending time-ordered pattern, entry, and exit markers
 *  - Clear PAPER / DEMO / LIVE / SIGNAL_ONLY environment classification
 *  - Verified gross & net realized P&L (strictly null for unexecuted/open trades)
 *
 * Zero fabricated data: when no trade is selected, zero trade overlays are produced.
 */

import type { Candle } from './marketData';
import {
  enforceTradeRecordTruthInvariants,
  type CanonicalTradeRecord,
  type TradeChartPattern,
  type TradeExecutionStatus,
} from './tradeLifecycleLedger';

export type TradeEnvironmentTone = 'slate' | 'cyan' | 'amber' | 'emerald';

export interface TradeEnvironmentClassification {
  readonly badgeLabel: string;
  readonly shortMode: 'SIGNAL ONLY' | 'PAPER' | 'DEMO' | 'LIVE';
  readonly environmentDescription: string;
  readonly isRealCapital: boolean;
  readonly tone: TradeEnvironmentTone;
  readonly statusLabel: string;
}

export interface VerifiedTradePnlSummary {
  readonly isRealized: boolean;
  readonly grossPnlUsd: number | null;
  readonly feesUsd: number | null;
  readonly netPnlUsd: number | null;
  readonly pnlPct: number | null;
  readonly displayLabel: string;
}

export interface TradeChartPriceLineSpec {
  readonly id: 'entry' | 'stop_loss' | 'take_profit' | 'breakout_level' | 'pattern_zone_low';
  readonly price: number;
  readonly color: string;
  readonly lineWidth: 1 | 2;
  readonly style: 'solid' | 'dashed' | 'dotted';
  readonly title: string;
}

export interface TradeChartMarkerSpec {
  readonly id: 'pattern' | 'entry' | 'exit';
  readonly time: number;
  readonly position: 'aboveBar' | 'belowBar';
  readonly color: string;
  readonly shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  readonly text: string;
}

export interface ResolvedTradeChartOverlay {
  readonly tradeId: string;
  readonly pair: string;
  readonly priceLines: readonly TradeChartPriceLineSpec[];
  readonly markers: readonly TradeChartMarkerSpec[];
  readonly pattern: TradeChartPattern | null;
  readonly entryTimestampMatchedInWindow: boolean;
  readonly exitTimestampMatchedInWindow: boolean;
  readonly windowNotice: string | null;
}

const STATUS_LABELS: Record<TradeExecutionStatus, string> = {
  PUBLISHED_SIGNAL: 'Published Signal (Not Executed)',
  AWAITING_ENTRY: 'Awaiting Entry Fill',
  OPEN: 'Open Position',
  CLOSED_TP: 'Closed at Take Profit',
  CLOSED_SL: 'Closed at Stop Loss',
  CLOSED_MANUAL: 'Closed Manually',
  CANCELLED: 'Cancelled',
};

export function validatePublicTradeIdInput(rawQuery: string): {
  valid: boolean;
  normalized: string;
  error: string | null;
} {
  const normalized = rawQuery.trim().toUpperCase();
  if (!normalized) {
    return {
      valid: false,
      normalized: '',
      error: 'Enter a public Trade ID (for example SF-2026-000103) to load its verified Smart Chart.',
    };
  }
  if (normalized.length < 4 || !/^[A-Z0-9_-]+$/.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'Trade ID format must contain letters, numbers, or hyphens (for example SF-2026-000103).',
    };
  }
  return { valid: true, normalized, error: null };
}

export function classifyTradeEnvironment(
  rawRecord: CanonicalTradeRecord
): TradeEnvironmentClassification {
  const record = enforceTradeRecordTruthInvariants(rawRecord);
  const statusLabel = STATUS_LABELS[record.executionStatus] ?? record.executionStatus;

  if (record.recordClass === 'SIGNAL_ONLY') {
    return {
      badgeLabel: 'SIGNAL ONLY · NOT EXECUTED',
      shortMode: 'SIGNAL ONLY',
      environmentDescription:
        'Published analytical setup only. No capital was committed and no realized P&L is claimed.',
      isRealCapital: false,
      tone: 'slate',
      statusLabel,
    };
  }

  if (record.tradingMode === 'LIVE') {
    return {
      badgeLabel: 'LIVE EXECUTION · REAL CAPITAL',
      shortMode: 'LIVE',
      environmentDescription:
        'Verified live exchange execution under authenticated OTP and risk-cap controls.',
      isRealCapital: true,
      tone: 'emerald',
      statusLabel,
    };
  }

  if (record.tradingMode === 'DEMO') {
    return {
      badgeLabel: 'DEMO RESULT · EXCHANGE SANDBOX',
      shortMode: 'DEMO',
      environmentDescription:
        'Executed on exchange demo/sandbox infrastructure using non-real virtual capital.',
      isRealCapital: false,
      tone: 'amber',
      statusLabel,
    };
  }

  return {
    badgeLabel: 'PAPER RESULT · SIMULATED WALLET',
    shortMode: 'PAPER',
    environmentDescription:
      'Executed on Signal Forge Paper/Testnet simulation wallet using non-real virtual capital.',
    isRealCapital: false,
    tone: 'cyan',
    statusLabel,
  };
}

export function computeVerifiedTradePnl(
  rawRecord: CanonicalTradeRecord
): VerifiedTradePnlSummary {
  const record = enforceTradeRecordTruthInvariants(rawRecord);

  if (record.recordClass === 'SIGNAL_ONLY') {
    return {
      isRealized: false,
      grossPnlUsd: null,
      feesUsd: null,
      netPnlUsd: null,
      pnlPct: null,
      displayLabel: 'N/A — Published Signal Only',
    };
  }

  const isClosed =
    record.executionStatus === 'CLOSED_TP' ||
    record.executionStatus === 'CLOSED_SL' ||
    record.executionStatus === 'CLOSED_MANUAL';

  if (!isClosed || record.realizedPnlUsd === null) {
    return {
      isRealized: false,
      grossPnlUsd: null,
      feesUsd: record.feesUsd,
      netPnlUsd: null,
      pnlPct: null,
      displayLabel:
        record.executionStatus === 'OPEN'
          ? 'Open Position — Unclosed'
          : 'Pending / No Realized Exit',
    };
  }

  const fees = record.feesUsd ?? 0;
  const netPnlUsd = Number((record.realizedPnlUsd - fees).toFixed(2));
  const sign = netPnlUsd >= 0 ? '+' : '';
  const pctStr =
    record.realizedPnlPct !== null
      ? ` (${record.realizedPnlPct >= 0 ? '+' : ''}${record.realizedPnlPct.toFixed(2)}%)`
      : '';

  return {
    isRealized: true,
    grossPnlUsd: Number(record.realizedPnlUsd.toFixed(2)),
    feesUsd: record.feesUsd !== null ? Number(record.feesUsd.toFixed(2)) : null,
    netPnlUsd,
    pnlPct: record.realizedPnlPct,
    displayLabel: `${sign}$${netPnlUsd.toFixed(2)} net${pctStr}`,
  };
}

function findClosestCandleIndex(
  candles: readonly Candle[],
  targetUnixSec: number
): { index: number; exactWithinWindow: boolean } {
  if (candles.length === 0) return { index: -1, exactWithinWindow: false };
  const first = candles[0].time;
  const last = candles[candles.length - 1].time;

  if (targetUnixSec < first) {
    return {
      index: Math.min(Math.max(2, Math.floor(candles.length * 0.15)), candles.length - 1),
      exactWithinWindow: false,
    };
  }
  if (targetUnixSec > last) {
    return { index: candles.length - 1, exactWithinWindow: false };
  }

  let bestIdx = 0;
  let bestDiff = Math.abs(candles[0].time - targetUnixSec);
  for (let i = 1; i < candles.length; i++) {
    const diff = Math.abs(candles[i].time - targetUnixSec);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return { index: bestIdx, exactWithinWindow: true };
}

export function resolveTradeChartOverlay(
  rawRecord: CanonicalTradeRecord | null,
  candles: readonly Candle[]
): ResolvedTradeChartOverlay | null {
  if (!rawRecord || candles.length === 0) return null;
  const record = enforceTradeRecordTruthInvariants(rawRecord);
  const entryPrice = record.actualExecutionPrice ?? record.entryPrice;
  const pattern = record.chartPattern ?? null;

  const priceLines: TradeChartPriceLineSpec[] = [];

  if (pattern && Number.isFinite(pattern.breakoutLevel) && pattern.breakoutLevel > 0) {
    priceLines.push({
      id: 'breakout_level',
      price: pattern.breakoutLevel,
      color: '#a855f7',
      lineWidth: 1,
      style: 'dotted',
      title: `Pattern · ${pattern.category === 'BREAKOUT' ? 'Breakout' : pattern.category === 'REJECTION' ? 'Rejection' : 'Structure'}`,
    });
  }

  if (Number.isFinite(entryPrice) && entryPrice > 0) {
    priceLines.push({
      id: 'entry',
      price: entryPrice,
      color: '#38bdf8',
      lineWidth: 2,
      style: 'solid',
      title:
        record.recordClass === 'SIGNAL_ONLY'
          ? `Signal ${record.direction}`
          : `${record.tradingMode} Entry`,
    });
  }

  if (Number.isFinite(record.stopLoss) && record.stopLoss > 0) {
    priceLines.push({
      id: 'stop_loss',
      price: record.stopLoss,
      color: '#f43f5e',
      lineWidth: 2,
      style: 'dashed',
      title: 'Stop Loss',
    });
  }

  if (Number.isFinite(record.takeProfit) && record.takeProfit > 0) {
    priceLines.push({
      id: 'take_profit',
      price: record.takeProfit,
      color: '#10b981',
      lineWidth: 2,
      style: 'dashed',
      title: 'Take Profit',
    });
  }

  const openedSec = Math.floor(new Date(record.openedAtIso).getTime() / 1000);
  const entryMatch = Number.isFinite(openedSec)
    ? findClosestCandleIndex(candles, openedSec)
    : { index: Math.max(0, candles.length - 16), exactWithinWindow: false };

  const rawMarkers: TradeChartMarkerSpec[] = [];

  // Pattern / Breakout confirmation marker placed cleanly ahead of entry on opposite bar side to prevent text overlap
  if (pattern && entryMatch.index > 1) {
    const patternIdx = Math.max(0, entryMatch.index - 4);
    const patternCandle = candles[patternIdx];
    if (patternCandle) {
      rawMarkers.push({
        id: 'pattern',
        time: patternCandle.time,
        position: record.direction === 'BUY' ? 'aboveBar' : 'belowBar',
        color: '#a855f7',
        shape: 'square',
        text:
          pattern.category === 'BREAKOUT'
            ? 'BOS Breakout'
            : pattern.category === 'REJECTION'
            ? 'VAH Rejection'
            : 'Sweep Zone',
      });
    }
  }

  const entryCandle = candles[entryMatch.index];
  if (entryCandle) {
    rawMarkers.push({
      id: 'entry',
      time: entryCandle.time,
      position: record.direction === 'BUY' ? 'belowBar' : 'aboveBar',
      color: record.direction === 'BUY' ? '#10b981' : '#f43f5e',
      shape: record.direction === 'BUY' ? 'arrowUp' : 'arrowDown',
      text:
        record.recordClass === 'SIGNAL_ONLY'
          ? `${record.direction} Signal`
          : `${record.direction} Fill (${record.tradingMode})`,
    });
  }

  let exitTimestampMatchedInWindow = true;
  const isClosedExecuted =
    record.recordClass === 'EXECUTED_TRADE' &&
    (record.executionStatus === 'CLOSED_TP' ||
      record.executionStatus === 'CLOSED_SL' ||
      record.executionStatus === 'CLOSED_MANUAL');

  if (isClosedExecuted && record.closedAtIso) {
    const closedSec = Math.floor(new Date(record.closedAtIso).getTime() / 1000);
    const exitMatch = Number.isFinite(closedSec)
      ? findClosestCandleIndex(candles, closedSec)
      : { index: Math.min(candles.length - 1, entryMatch.index + 8), exactWithinWindow: false };

    exitTimestampMatchedInWindow = exitMatch.exactWithinWindow;
    const safeExitIdx = Math.min(
      candles.length - 1,
      Math.max(entryMatch.index + 1, exitMatch.index)
    );
    const exitCandle = candles[safeExitIdx];
    if (exitCandle && (!entryCandle || exitCandle.time > entryCandle.time)) {
      const pnlSummary = computeVerifiedTradePnl(record);
      const net = pnlSummary.netPnlUsd ?? record.realizedPnlUsd ?? 0;
      const won = net >= 0;
      const exitShort =
        record.executionStatus === 'CLOSED_TP'
          ? 'TP Exit'
          : record.executionStatus === 'CLOSED_SL'
          ? 'SL Exit'
          : 'Manual Exit';

      rawMarkers.push({
        id: 'exit',
        time: exitCandle.time,
        position: record.direction === 'BUY' ? 'aboveBar' : 'belowBar',
        color: won ? '#22c55e' : '#ef4444',
        shape: 'circle',
        text: `${exitShort} (${won ? '+' : ''}$${net.toFixed(2)} net)`,
      });
    }
  }

  // Lightweight Charts v5 requires markers sorted strictly ascending by time
  const sortedMarkers = [...rawMarkers].sort((a, b) => a.time - b.time);

  const windowNotice =
    !entryMatch.exactWithinWindow || (isClosedExecuted && !exitTimestampMatchedInWindow)
      ? 'Trade execution occurred near or outside the loaded timeframe window; switch to 1h or 4h to inspect the exact historical bars.'
      : null;

  return {
    tradeId: record.tradeId,
    pair: record.pair,
    priceLines,
    markers: sortedMarkers,
    pattern,
    entryTimestampMatchedInWindow: entryMatch.exactWithinWindow,
    exitTimestampMatchedInWindow,
    windowNotice,
  };
}

/**
 * Signal Forge — Canonical Trade ID & Auditable Lifecycle Ledger
 *
 * Connects every stage through a single canonical Trade ID:
 * Signal -> Strategy -> Chart -> Publication -> Execution -> Position -> Result -> History
 *
 * Strict Honesty Invariants:
 * 1. Signals (`SIGNAL_ONLY`) are strictly separated from executed trades (`EXECUTED_TRADE`).
 * 2. Estimated / projected R:R returns are NEVER aggregated or displayed as realized profits.
 * 3. Every realized PnL value comes exclusively from closed executed trades and reflects fees.
 */

import type { PublicVerifiedTradeRecord } from './multiAgentTradingArchitecture';
import type { SupportedExchangeId } from './platformArchitecture';

export type TradingEnvironmentMode = 'PAPER' | 'DEMO' | 'LIVE';

export type TradeRecordClass = 'SIGNAL_ONLY' | 'EXECUTED_TRADE';

export type TradeExecutionStatus =
  | 'PUBLISHED_SIGNAL'
  | 'AWAITING_ENTRY'
  | 'OPEN'
  | 'CLOSED_TP'
  | 'CLOSED_SL'
  | 'CLOSED_MANUAL'
  | 'CANCELLED';

export type TradeLifecycleStage =
  | 'SIGNAL'
  | 'STRATEGY'
  | 'CHART'
  | 'PUBLICATION'
  | 'EXECUTION'
  | 'POSITION'
  | 'RESULT'
  | 'HISTORY';

export interface TradeLifecycleEvent {
  readonly id: string;
  readonly stage: TradeLifecycleStage;
  readonly timestampIso: string;
  readonly title: string;
  readonly detail: string;
  readonly actor: string;
}

export interface TradeChartSnapshotMeta {
  readonly timeframe: '15m' | '1h' | '4h' | '1d';
  readonly indicators: readonly string[];
  readonly entryMarkerTimeSec?: number;
  readonly exitMarkerTimeSec?: number;
  readonly caption: string;
  readonly exportedAtIso: string | null;
}

export interface TradeChartPattern {
  readonly name: string;
  readonly category: 'BREAKOUT' | 'ORDER_BLOCK' | 'LIQUIDITY_SWEEP' | 'REJECTION';
  readonly breakoutLevel: number;
  readonly zoneLow?: number;
  readonly zoneHigh?: number;
  readonly summary: string;
}

export interface CanonicalTradeRecord {
  readonly tradeId: string;
  readonly recordClass: TradeRecordClass;
  readonly tradingMode: TradingEnvironmentMode;
  readonly exchange: SupportedExchangeId;
  readonly pair: string;
  readonly timeframe: '15m' | '1h' | '4h' | '1d';
  readonly direction: 'BUY' | 'SELL';
  readonly strategyName: string;
  readonly strategyExplanation: string;
  readonly signalPrice: number;
  readonly actualExecutionPrice: number | null;
  readonly slippageBps: number | null;
  readonly entryPrice: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly projectedRrRatio: number;
  readonly openedAtIso: string;
  readonly closedAtIso: string | null;
  readonly executionStatus: TradeExecutionStatus;
  readonly feesUsd: number | null;
  readonly realizedPnlUsd: number | null;
  readonly realizedPnlPct: number | null;
  readonly confidence: number;
  readonly publishedChannels: readonly string[];
  readonly chartPattern?: TradeChartPattern;
  readonly chartSnapshot: TradeChartSnapshotMeta;
  readonly timeline: readonly TradeLifecycleEvent[];
}

export interface VerifiedPerformanceSummary {
  readonly totalRecords: number;
  readonly publishedSignalsCount: number;
  readonly executedTradesCount: number;
  readonly openExecutedCount: number;
  readonly closedExecutedCount: number;
  readonly winningClosedTrades: number;
  readonly losingClosedTrades: number;
  readonly verifiedWinRatePct: number | null;
  readonly totalRealizedPnlUsd: number;
  readonly totalFeesUsd: number;
  readonly netRealizedPnlAfterFeesUsd: number;
  readonly modeBreakdown: Record<TradingEnvironmentMode, number>;
  readonly disclaimer: string;
}

export function computeSlippageBps(
  signalPrice: number,
  actualExecutionPrice: number | null
): number | null {
  if (
    actualExecutionPrice === null ||
    !Number.isFinite(signalPrice) ||
    !Number.isFinite(actualExecutionPrice) ||
    signalPrice <= 0
  ) {
    return null;
  }
  return Number((((actualExecutionPrice - signalPrice) / signalPrice) * 10_000).toFixed(2));
}

export function computeProjectedRrRatio(
  direction: 'BUY' | 'SELL',
  entryPrice: number,
  stopLoss: number,
  takeProfit: number
): number {
  const risk = direction === 'BUY' ? entryPrice - stopLoss : stopLoss - entryPrice;
  const reward = direction === 'BUY' ? takeProfit - entryPrice : entryPrice - takeProfit;
  if (!Number.isFinite(risk) || !Number.isFinite(reward) || risk <= 0 || reward <= 0) {
    return 0;
  }
  return Number((reward / risk).toFixed(2));
}

/**
 * Enforces strict separation between unexecuted signals and executed trades,
 * ensuring estimated profits are never written into realizedPnlUsd.
 */
export function enforceTradeRecordTruthInvariants(
  record: CanonicalTradeRecord
): CanonicalTradeRecord {
  const isClosedExecuted =
    record.recordClass === 'EXECUTED_TRADE' &&
    (record.executionStatus === 'CLOSED_TP' ||
      record.executionStatus === 'CLOSED_SL' ||
      record.executionStatus === 'CLOSED_MANUAL');

  const sanitizedExecutionPrice =
    record.recordClass === 'SIGNAL_ONLY' ? null : record.actualExecutionPrice;

  return {
    ...record,
    actualExecutionPrice: sanitizedExecutionPrice,
    slippageBps: computeSlippageBps(record.signalPrice, sanitizedExecutionPrice),
    feesUsd: record.recordClass === 'SIGNAL_ONLY' ? null : record.feesUsd,
    realizedPnlUsd: isClosedExecuted ? record.realizedPnlUsd : null,
    realizedPnlPct: isClosedExecuted ? record.realizedPnlPct : null,
    closedAtIso: isClosedExecuted ? record.closedAtIso : null,
  };
}

export function summarizeVerifiedPerformance(
  records: readonly CanonicalTradeRecord[]
): VerifiedPerformanceSummary {
  let publishedSignalsCount = 0;
  let executedTradesCount = 0;
  let openExecutedCount = 0;
  let closedExecutedCount = 0;
  let winningClosedTrades = 0;
  let losingClosedTrades = 0;
  let totalRealizedPnlUsd = 0;
  let totalFeesUsd = 0;

  const modeBreakdown: Record<TradingEnvironmentMode, number> = {
    PAPER: 0,
    DEMO: 0,
    LIVE: 0,
  };

  for (const raw of records) {
    const r = enforceTradeRecordTruthInvariants(raw);
    if (r.recordClass === 'SIGNAL_ONLY') {
      publishedSignalsCount += 1;
      continue;
    }

    executedTradesCount += 1;
    modeBreakdown[r.tradingMode] += 1;

    if (typeof r.feesUsd === 'number' && Number.isFinite(r.feesUsd)) {
      totalFeesUsd += r.feesUsd;
    }

    if (r.executionStatus === 'OPEN' || r.executionStatus === 'AWAITING_ENTRY') {
      openExecutedCount += 1;
    } else if (
      (r.executionStatus === 'CLOSED_TP' ||
        r.executionStatus === 'CLOSED_SL' ||
        r.executionStatus === 'CLOSED_MANUAL') &&
      typeof r.realizedPnlUsd === 'number' &&
      Number.isFinite(r.realizedPnlUsd)
    ) {
      closedExecutedCount += 1;
      totalRealizedPnlUsd += r.realizedPnlUsd;
      if (r.realizedPnlUsd > 0) winningClosedTrades += 1;
      else if (r.realizedPnlUsd < 0) losingClosedTrades += 1;
    }
  }

  const verifiedWinRatePct =
    closedExecutedCount > 0
      ? Number(((winningClosedTrades / closedExecutedCount) * 100).toFixed(1))
      : null;

  return {
    totalRecords: records.length,
    publishedSignalsCount,
    executedTradesCount,
    openExecutedCount,
    closedExecutedCount,
    winningClosedTrades,
    losingClosedTrades,
    verifiedWinRatePct,
    totalRealizedPnlUsd: Number(totalRealizedPnlUsd.toFixed(2)),
    totalFeesUsd: Number(totalFeesUsd.toFixed(2)),
    netRealizedPnlAfterFeesUsd: Number((totalRealizedPnlUsd - totalFeesUsd).toFixed(2)),
    modeBreakdown,
    disclaimer:
      'Realized performance reflects closed executed trades only (Paper/Demo unless explicitly labeled LIVE). Published signals without execution are excluded from realized PnL.',
  };
}

/**
 * Deterministic public baseline records for Step 1 transparency.
 * Explicitly labeled SIGNAL_ONLY, PAPER, or DEMO — never claiming unverified live profits.
 */
export const SEEDED_CANONICAL_TRADE_LEDGER: readonly CanonicalTradeRecord[] = [
  enforceTradeRecordTruthInvariants({
    tradeId: 'SF-2026-000101',
    recordClass: 'SIGNAL_ONLY',
    tradingMode: 'PAPER',
    exchange: 'BINANCE',
    pair: 'BTCUSDT',
    timeframe: '1h',
    direction: 'BUY',
    strategyName: 'SMC Order Block + LVN Demand Sweep',
    strategyExplanation:
      'Bullish liquidity sweep below session VAL followed by strong volume reclaim above EMA 21 and Skeptic Agent veto clearance.',
    signalPrice: 61240,
    actualExecutionPrice: null,
    slippageBps: null,
    entryPrice: 61240,
    stopLoss: 60260,
    takeProfit: 64180,
    projectedRrRatio: computeProjectedRrRatio('BUY', 61240, 60260, 64180),
    openedAtIso: '2026-11-22T14:00:00.000Z',
    closedAtIso: null,
    executionStatus: 'PUBLISHED_SIGNAL',
    feesUsd: null,
    realizedPnlUsd: null,
    realizedPnlPct: null,
    confidence: 89,
    publishedChannels: ['Public Platform Feed', 'Telegram @SignalForge'],
    chartPattern: {
      name: 'Bullish Order Block + VAL Liquidity Sweep',
      category: 'LIQUIDITY_SWEEP',
      breakoutLevel: 61580,
      zoneLow: 60820,
      zoneHigh: 61350,
      summary: 'Stop-run below Value Area Low followed by displacement reclaim through $61,580 local structure.',
    },
    chartSnapshot: {
      timeframe: '1h',
      indicators: ['EMA 9/21/50', 'SMC Order Block', 'FRVP POC'],
      caption: 'BTCUSDT 1H Bullish Order Block Demand Reclaim — Published Signal Only',
      exportedAtIso: '2026-11-22T14:01:12.000Z',
    },
    timeline: [
      {
        id: 'evt_101_1',
        stage: 'SIGNAL',
        timestampIso: '2026-11-22T14:00:00.000Z',
        title: 'Signal Generated',
        detail: 'BTCUSDT BUY setup detected at $61,240 with 89% multi-agent consensus.',
        actor: 'Strategy Engine',
      },
      {
        id: 'evt_101_2',
        stage: 'STRATEGY',
        timestampIso: '2026-11-22T14:00:14.000Z',
        title: 'Risk & Skeptic Validation Passed',
        detail: 'Stop loss at $60,260 (1.60% risk) cleared Skeptic Agent trap filter.',
        actor: 'Risk Management',
      },
      {
        id: 'evt_101_3',
        stage: 'CHART',
        timestampIso: '2026-11-22T14:00:45.000Z',
        title: 'Smart Chart Annotated',
        detail: 'Entry, Stop Loss, Take Profit, and FRVP POC anchored on 1H candlestick view.',
        actor: 'Smart Chart Engine',
      },
      {
        id: 'evt_101_4',
        stage: 'PUBLICATION',
        timestampIso: '2026-11-22T14:01:12.000Z',
        title: 'Published as Signal Only',
        detail: 'Dispatched to public feed & Telegram channel. Not executed on live or paper capital.',
        actor: 'Notifications & Reporting',
      },
    ],
  }),
  enforceTradeRecordTruthInvariants({
    tradeId: 'SF-2026-000102',
    recordClass: 'EXECUTED_TRADE',
    tradingMode: 'PAPER',
    exchange: 'BINANCE',
    pair: 'SOLUSDT',
    timeframe: '15m',
    direction: 'BUY',
    strategyName: 'Pre-Pump Accumulation · Volume Spike + OB Imbalance',
    strategyExplanation:
      'Volume expansion 2.6x above 20-bar mean with +36% bid-side depth imbalance near Point of Control; executed on Binance Testnet Paper wallet.',
    signalPrice: 71.2,
    actualExecutionPrice: 71.26,
    slippageBps: 8.43,
    entryPrice: 71.26,
    stopLoss: 70.05,
    takeProfit: 74.89,
    projectedRrRatio: computeProjectedRrRatio('BUY', 71.26, 70.05, 74.89),
    openedAtIso: '2026-11-22T18:15:00.000Z',
    closedAtIso: null,
    executionStatus: 'OPEN',
    feesUsd: 1.47,
    realizedPnlUsd: null,
    realizedPnlPct: null,
    confidence: 91,
    publishedChannels: ['Public Platform Feed', 'Telegram @SignalForge'],
    chartPattern: {
      name: 'Pre-Pump Range Compression Breakout',
      category: 'BREAKOUT',
      breakoutLevel: 71.15,
      zoneLow: 70.4,
      zoneHigh: 71.15,
      summary: '15m consolidation ceiling broken at $71.15 on 2.6x relative volume expansion and +36% bid depth.',
    },
    chartSnapshot: {
      timeframe: '15m',
      indicators: ['EMA 9/21/50', 'VWAP', 'Volume Profile'],
      caption: 'SOLUSDT 15m Paper Entry Active at $71.26 (SL $70.05 / TP $74.89)',
      exportedAtIso: '2026-11-22T18:15:30.000Z',
    },
    timeline: [
      {
        id: 'evt_102_1',
        stage: 'SIGNAL',
        timestampIso: '2026-11-22T18:14:40.000Z',
        title: 'Signal Generated',
        detail: 'SOLUSDT BUY signal fired at $71.20 (91% confidence).',
        actor: 'Strategy Engine',
      },
      {
        id: 'evt_102_2',
        stage: 'STRATEGY',
        timestampIso: '2026-11-22T18:14:48.000Z',
        title: 'Strategy & Risk Approved',
        detail: '1.70% stop distance validated against Binance paper risk profile.',
        actor: 'AI Agent Coordinator',
      },
      {
        id: 'evt_102_3',
        stage: 'CHART',
        timestampIso: '2026-11-22T18:14:55.000Z',
        title: 'Chart Levels Attached',
        detail: '15m chart annotated with Entry, SL, TP, and VWAP.',
        actor: 'Smart Chart Engine',
      },
      {
        id: 'evt_102_4',
        stage: 'EXECUTION',
        timestampIso: '2026-11-22T18:15:00.000Z',
        title: 'Paper Order Filled',
        detail: 'Filled on Binance Testnet (PAPER) at $71.26 (+8.43 bps slippage, $1.47 fee).',
        actor: 'Trading Execution',
      },
      {
        id: 'evt_102_5',
        stage: 'POSITION',
        timestampIso: '2026-11-22T18:15:05.000Z',
        title: 'Position Open & Monitored',
        detail: 'ATR trailing stop active; realized PnL remains N/A until exit closes.',
        actor: 'Portfolio Management',
      },
    ],
  }),
  enforceTradeRecordTruthInvariants({
    tradeId: 'SF-2026-000103',
    recordClass: 'EXECUTED_TRADE',
    tradingMode: 'DEMO',
    exchange: 'BINANCE',
    pair: 'ETHUSDT',
    timeframe: '1h',
    direction: 'BUY',
    strategyName: 'Multi-Agent Debate Consensus + ATR Trail',
    strategyExplanation:
      'Break of structure above 1H resistance confirmed by funding normalization and spot inflow; closed cleanly at Take Profit on Demo sandbox.',
    signalPrice: 1692.0,
    actualExecutionPrice: 1693.2,
    slippageBps: 7.09,
    entryPrice: 1693.2,
    stopLoss: 1664.0,
    takeProfit: 1782.0,
    projectedRrRatio: computeProjectedRrRatio('BUY', 1693.2, 1664.0, 1782.0),
    openedAtIso: '2026-11-21T09:30:00.000Z',
    closedAtIso: '2026-11-21T22:45:00.000Z',
    executionStatus: 'CLOSED_TP',
    feesUsd: 3.12,
    realizedPnlUsd: 148.6,
    realizedPnlPct: 5.24,
    confidence: 92,
    publishedChannels: ['Public Platform Feed', 'Telegram @SignalForge'],
    chartPattern: {
      name: '1H Break of Structure (BOS) Resistance Breakout',
      category: 'BREAKOUT',
      breakoutLevel: 1689.5,
      zoneLow: 1678.0,
      zoneHigh: 1689.5,
      summary: 'Confirmed bullish Break of Structure above $1,689.50 neckline with ATR trailing stop protection to $1,782.00 TP.',
    },
    chartSnapshot: {
      timeframe: '1h',
      indicators: ['EMA 9/21/50', 'SMC BOS', 'ATR Trail'],
      caption: 'ETHUSDT 1H Demo Trade Closed at TP (+$148.60 gross / -$3.12 fees)',
      exportedAtIso: '2026-11-21T22:45:10.000Z',
    },
    timeline: [
      {
        id: 'evt_103_1',
        stage: 'SIGNAL',
        timestampIso: '2026-11-21T09:29:20.000Z',
        title: 'Signal Generated',
        detail: 'ETHUSDT BUY setup triggered at $1,692.00 (92% consensus).',
        actor: 'Strategy Engine',
      },
      {
        id: 'evt_103_2',
        stage: 'STRATEGY',
        timestampIso: '2026-11-21T09:29:35.000Z',
        title: 'Risk & Containment Check Passed',
        detail: '1.72% stop distance and 3.04R target approved.',
        actor: 'Risk Management',
      },
      {
        id: 'evt_103_3',
        stage: 'CHART',
        timestampIso: '2026-11-21T09:29:48.000Z',
        title: 'Chart Snapshot Anchored',
        detail: '1H chart recorded BOS level and dynamic ATR trailing buffer.',
        actor: 'Smart Chart Engine',
      },
      {
        id: 'evt_103_4',
        stage: 'PUBLICATION',
        timestampIso: '2026-11-21T09:29:54.000Z',
        title: 'Signal Published',
        detail: 'Published to public ledger and Telegram @SignalForge.',
        actor: 'Notifications & Reporting',
      },
      {
        id: 'evt_103_5',
        stage: 'EXECUTION',
        timestampIso: '2026-11-21T09:30:00.000Z',
        title: 'Demo Order Executed',
        detail: 'Filled at $1,693.20 (+7.09 bps slippage vs signal price).',
        actor: 'Trading Execution',
      },
      {
        id: 'evt_103_6',
        stage: 'POSITION',
        timestampIso: '2026-11-21T16:00:00.000Z',
        title: 'Trailing Stop Ratcheted',
        detail: 'ATR trailing stop moved into profit protection above $1,732.',
        actor: 'Hedging Engine',
      },
      {
        id: 'evt_103_7',
        stage: 'RESULT',
        timestampIso: '2026-11-21T22:45:00.000Z',
        title: 'Closed at Take Profit (DEMO)',
        detail: 'Realized +$148.60 (+5.24%), total fees $3.12, net +$145.48.',
        actor: 'Trading Execution',
      },
      {
        id: 'evt_103_8',
        stage: 'HISTORY',
        timestampIso: '2026-11-21T22:45:10.000Z',
        title: 'Archived to Auditable Ledger',
        detail: 'Immutable Trade ID SF-2026-000103 finalized in trading history.',
        actor: 'Audit Ledger',
      },
    ],
  }),
  enforceTradeRecordTruthInvariants({
    tradeId: 'SF-2026-000104',
    recordClass: 'EXECUTED_TRADE',
    tradingMode: 'PAPER',
    exchange: 'BYBIT',
    pair: 'BNBUSDT',
    timeframe: '4h',
    direction: 'SELL',
    strategyName: 'Upper VAH Rejection + Funding Mean Reversion',
    strategyExplanation:
      'Overextended 4H sweep above Value Area High with elevated positive funding; stopped out cleanly at predefined risk cap on Paper mode.',
    signalPrice: 558.5,
    actualExecutionPrice: 558.15,
    slippageBps: -6.27,
    entryPrice: 558.15,
    stopLoss: 566.5,
    takeProfit: 533.1,
    projectedRrRatio: computeProjectedRrRatio('SELL', 558.15, 566.5, 533.1),
    openedAtIso: '2026-11-20T12:00:00.000Z',
    closedAtIso: '2026-11-20T19:20:00.000Z',
    executionStatus: 'CLOSED_SL',
    feesUsd: 1.95,
    realizedPnlUsd: -44.8,
    realizedPnlPct: -1.5,
    confidence: 82,
    publishedChannels: ['Public Platform Feed'],
    chartPattern: {
      name: 'Upper Value Area High (VAH) Rejection',
      category: 'REJECTION',
      breakoutLevel: 559.8,
      zoneLow: 557.2,
      zoneHigh: 561.5,
      summary: 'Failed 4H breakout above $559.80 VAH triggered mean-reversion short; invalidation stop honored cleanly at $566.50.',
    },
    chartSnapshot: {
      timeframe: '4h',
      indicators: ['FRVP VAH', 'RSI(14)', 'EMA 50'],
      caption: 'BNBUSDT 4H Paper Short Stopped Out at $566.50 (-$44.80 controlled loss)',
      exportedAtIso: '2026-11-20T19:20:08.000Z',
    },
    timeline: [
      {
        id: 'evt_104_1',
        stage: 'SIGNAL',
        timestampIso: '2026-11-20T11:59:10.000Z',
        title: 'Short Signal Generated',
        detail: 'BNBUSDT SELL setup triggered at $558.50.',
        actor: 'Strategy Engine',
      },
      {
        id: 'evt_104_2',
        stage: 'EXECUTION',
        timestampIso: '2026-11-20T12:00:00.000Z',
        title: 'Paper Short Executed',
        detail: 'Filled on Bybit Paper route at $558.15 with strict $566.50 stop loss.',
        actor: 'Trading Execution',
      },
      {
        id: 'evt_104_3',
        stage: 'RESULT',
        timestampIso: '2026-11-20T19:20:00.000Z',
        title: 'Stop Loss Honored (PAPER)',
        detail: 'Closed at $566.50. Realized -$44.80 (-1.50%), fees $1.95. Risk cap protected equity.',
        actor: 'Risk Management',
      },
      {
        id: 'evt_104_4',
        stage: 'HISTORY',
        timestampIso: '2026-11-20T19:20:08.000Z',
        title: 'Archived to Auditable Ledger',
        detail: 'Full loss and fee record preserved transparently under SF-2026-000104.',
        actor: 'Audit Ledger',
      },
    ],
  }),
];

export function adaptPublicVerifiedTradeToLifecycle(
  rec: PublicVerifiedTradeRecord
): CanonicalTradeRecord {
  const isSignalOnly = rec.stage === 'CONFIRMED_SETUP';
  const isClosed = rec.stage === 'FINAL_PNL_RESULT';
  const status: TradeExecutionStatus = isSignalOnly
    ? 'PUBLISHED_SIGNAL'
    : isClosed
    ? (rec.realizedPnlUsd ?? 0) >= 0
      ? 'CLOSED_TP'
      : 'CLOSED_SL'
    : 'OPEN';

  return enforceTradeRecordTruthInvariants({
    tradeId: rec.tradeId,
    recordClass: isSignalOnly ? 'SIGNAL_ONLY' : 'EXECUTED_TRADE',
    tradingMode: 'PAPER',
    exchange: 'BINANCE',
    pair: rec.symbol,
    timeframe: '1h',
    direction: rec.direction,
    strategyName: rec.patternLabel,
    strategyExplanation: `Verified multi-agent setup (${rec.confidence}% confidence) anchored via digest ${rec.cryptographicDigest}.`,
    signalPrice: rec.entryPrice,
    actualExecutionPrice: isSignalOnly ? null : rec.entryPrice,
    slippageBps: isSignalOnly ? null : 0,
    entryPrice: rec.entryPrice,
    stopLoss: rec.stopLoss,
    takeProfit: rec.takeProfit,
    projectedRrRatio: rec.rrMultiplier,
    openedAtIso: rec.createdAtIso,
    closedAtIso: isClosed ? rec.createdAtIso : null,
    executionStatus: status,
    feesUsd: isSignalOnly ? null : 1.5,
    realizedPnlUsd: isClosed ? rec.realizedPnlUsd : null,
    realizedPnlPct: isClosed ? rec.realizedPnlPct : null,
    confidence: rec.confidence,
    publishedChannels: rec.routedToPublicChannel
      ? ['Public Platform Feed', 'Telegram @SignalForge']
      : ['Internal Workspace'],
    chartSnapshot: {
      timeframe: '1h',
      indicators: ['EMA Ribbon', 'SMC / FRVP'],
      caption: `${rec.symbol} ${rec.direction} · ${rec.patternLabel}`,
      exportedAtIso: rec.createdAtIso,
    },
    timeline: [
      {
        id: `${rec.tradeId}_sig`,
        stage: 'SIGNAL',
        timestampIso: rec.createdAtIso,
        title: 'Signal Generated',
        detail: `${rec.symbol} ${rec.direction} setup detected at $${rec.entryPrice}.`,
        actor: 'Strategy Engine',
      },
      {
        id: `${rec.tradeId}_pub`,
        stage: 'PUBLICATION',
        timestampIso: rec.createdAtIso,
        title: 'Cryptographic Trade ID Issued',
        detail: `Assigned ${rec.tradeId} (Digest ${rec.cryptographicDigest}).`,
        actor: 'Audit Ledger',
      },
      ...(!isSignalOnly
        ? [
            {
              id: `${rec.tradeId}_exec`,
              stage: 'EXECUTION' as const,
              timestampIso: rec.createdAtIso,
              title: isClosed ? 'Paper Trade Closed' : 'Paper Execution Active',
              detail: isClosed
                ? `Closed with realized PnL ${rec.realizedPnlUsd !== null ? `$${rec.realizedPnlUsd}` : 'N/A'}.`
                : 'Active position monitored under Paper/Testnet rules.',
              actor: 'Trading Execution',
            },
          ]
        : []),
    ],
  });
}

export function lookupCanonicalTradeById(
  query: string,
  records: readonly CanonicalTradeRecord[]
): CanonicalTradeRecord | null {
  const normalized = query.trim().toUpperCase();
  if (!normalized) return null;
  const exact = records.find((r) => r.tradeId.toUpperCase() === normalized);
  if (exact) return exact;
  return (
    records.find(
      (r) =>
        r.tradeId.toUpperCase().includes(normalized) ||
        r.pair.toUpperCase() === normalized
    ) ?? null
  );
}

/**
 * Strict Trade ID verifier for public verification forms.
 * Matches only by exact Trade ID (case-insensitive) so invalid or unrelated text
 * never resolves to an arbitrary pair or fabricated result.
 */
export function lookupCanonicalTradeByExactId(
  query: string,
  records: readonly CanonicalTradeRecord[]
): CanonicalTradeRecord | null {
  const normalized = query.trim().toUpperCase();
  if (!normalized) return null;
  return records.find((r) => r.tradeId.toUpperCase() === normalized) ?? null;
}

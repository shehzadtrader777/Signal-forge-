import {
  getGlobalPastSignalsHistory,
  runBacktestSimulation,
  type BacktestStrategy,
  type HistoricalSignalRecord,
} from './backtest';
import { type SandboxPosition } from './coordinator';
import { TRACKED_COINS, type TickerSnapshot } from './marketData';
import { type StructuredPerformanceReport } from './monitorAgent';
import { type PinnedSignalRecord, isPinnedSignalResolved } from './pinnedSignals';

export type SignalHistoryOrigin =
  | 'LIVE_PINNED'
  | 'EXECUTED_ORDER'
  | 'BACKTEST_SMC'
  | 'BACKTEST_PATTERN'
  | 'BACKTEST_TECH';

export type SignalHistoryOutcome = 'WIN' | 'LOSS' | 'ACTIVE';

export interface UnifiedSignalAuditRecord {
  id: string;
  timestamp: string;
  symbol: string;
  coinName: string;
  direction: 'BUY' | 'SELL';
  origin: SignalHistoryOrigin;
  moduleLabel: string;
  session: string;
  timeframe: string;
  entryPrice: number;
  exitOrMarkPrice: number;
  stopLoss: number;
  takeProfit: number;
  takeProfits?: [number,number,number];
  confidence: number;
  riskRewardRatio: number;
  status: SignalHistoryOutcome;
  pnlR: number;
  pnlPercent: number;
  pnlUsd?: number;
  skepticVerdict?: string;
  retestStatus?: string;
  snapshotPoints?: number[];
}

export interface SignalHistoryFilterConfig {
  search: string;
  originGroup: 'ALL' | 'LIVE_ONLY' | 'SMC' | 'PATTERN' | 'TECH';
  status: 'ALL' | SignalHistoryOutcome;
  direction: 'ALL' | 'BUY' | 'SELL';
  minConfidence: number;
}

export const DEFAULT_SIGNAL_HISTORY_FILTERS: SignalHistoryFilterConfig = {
  search: '',
  originGroup: 'ALL',
  status: 'ALL',
  direction: 'ALL',
  minConfidence: 0,
};

export interface HistoryPerformanceSummary {
  totalRecords: number;
  resolvedTrades: number;
  activeTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  netRMultiple: number;
  avgRMultiple: number;
  expectancyR: number;
  profitFactor: number;
  avgConfidencePct: number;
  bestSymbol: string;
  bestSymbolNetR: number;
}

export interface StrategyAttributionRow {
  key: string;
  moduleLabel: string;
  trades: number;
  resolved: number;
  wins: number;
  winRatePct: number;
  netR: number;
  avgConfidencePct: number;
  contributionPct: number;
}

export interface SymbolAttributionRow {
  symbol: string;
  coinName: string;
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  netR: number;
}

function strategyToOrigin(strategy: BacktestStrategy): SignalHistoryOrigin {
  if (strategy === 'SMC_1_5') return 'BACKTEST_SMC';
  if (strategy === 'PATTERN_SCANNER') return 'BACKTEST_PATTERN';
  return 'BACKTEST_TECH';
}

function strategyToModuleLabel(strategy: BacktestStrategy): string {
  if (strategy === 'SMC_1_5') return 'SMC & FRVP Agent';
  if (strategy === 'PATTERN_SCANNER') return 'Breakout / Breakdown Scanner';
  return 'AI Technical Engine';
}

function fromBacktestRecord(rec: HistoricalSignalRecord): UnifiedSignalAuditRecord {
  return {
    id: rec.id,
    timestamp: rec.date,
    symbol: rec.symbol,
    coinName: rec.coinName,
    direction: rec.direction,
    origin: strategyToOrigin(rec.strategy),
    moduleLabel: strategyToModuleLabel(rec.strategy),
    session: rec.session || 'London / NY',
    timeframe: rec.timeframe,
    entryPrice: rec.entryPrice,
    exitOrMarkPrice: rec.exitPrice,
    stopLoss: rec.stopLoss,
    takeProfit: rec.takeProfit,
    confidence: rec.confidence,
    riskRewardRatio: rec.riskRewardRatio,
    status: rec.result,
    pnlR: rec.pnlR,
    pnlPercent: rec.profitPercent,
    retestStatus: rec.retestStatus,
    snapshotPoints: rec.snapshotPoints,
  };
}

function formatIsoCompact(iso: string): string {
  const clean = String(iso || '');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(clean)) {
    return clean.slice(0, 16).replace('T', ' ');
  }
  return clean || '2026-01-01 00:00';
}

function findCoinName(symbol: string): string {
  const match = TRACKED_COINS.find((c) => c.symbol === symbol);
  return match?.name || symbol.replace(/USDT$/i, '');
}

/**
 * Merges live pinned AI signals, executed Testnet/Live orders, and multi-strategy
 * cross-pair simulations into a unified, auditable Signal History dataset.
 */
export function buildUnifiedSignalHistory(input: {
  pinnedSignals?: PinnedSignalRecord[];
  positions?: SandboxPosition[];
  tickers?: Record<string, TickerSnapshot>;
  backtestRecords?: HistoricalSignalRecord[];
  includeCrossStrategyBenchmarks?: boolean;
  includeHistoricalBenchmarks?: boolean; // false for genuine observed-only audit mode
}): UnifiedSignalAuditRecord[] {
  const records: UnifiedSignalAuditRecord[] = [];
  const seenIds = new Set<string>();

  const pushUnique = (item: UnifiedSignalAuditRecord) => {
    if (seenIds.has(item.id)) return;
    seenIds.add(item.id);
    records.push(item);
  };

  // 1. Live Executed Sandbox / Testnet / Live Orders
  for (const pos of input.positions ?? []) {
    const livePrice = input.tickers?.[pos.symbol]?.price ?? pos.entryPrice;
    const isBuy = pos.direction === 'BUY';
    const riskDist = Math.max(Math.abs(pos.entryPrice - pos.initialStopLoss), pos.entryPrice * 0.004);
    const markPrice =
      pos.status === 'OPEN'
        ? livePrice
        : pos.status === 'CLOSED_TP'
        ? pos.takeProfits[0]
        : pos.trailingStopLoss;
    const pnlPct =
      pos.status === 'OPEN'
        ? Number(
            (
              ((isBuy ? livePrice - pos.entryPrice : pos.entryPrice - livePrice) /
                Math.max(1e-8, pos.entryPrice)) *
              100
            ).toFixed(2)
          )
        : pos.pnlPercent;
    const pnlUsd =
      pos.status === 'OPEN'
        ? Number(((pos.notionalUsd * pnlPct) / 100 + (pos.settledFundingUsd ?? 0)).toFixed(2))
        : pos.pnlUsd;
    const pnlR = Number(
      ((isBuy ? markPrice - pos.entryPrice : pos.entryPrice - markPrice) / riskDist).toFixed(2)
    );
    const rr = Number(
      (Math.abs(pos.takeProfits[2] - pos.entryPrice) / riskDist).toFixed(1)
    );
    const outcome: SignalHistoryOutcome =
      pos.status === 'OPEN' ? 'ACTIVE' : pnlUsd >= 0 ? 'WIN' : 'LOSS';

    pushUnique({
      id: `exec_${pos.id}`,
      timestamp: formatIsoCompact(pos.closedAt || pos.openedAt),
      symbol: pos.symbol,
      coinName: findCoinName(pos.symbol),
      direction: pos.direction,
      origin: 'EXECUTED_ORDER',
      moduleLabel:
        pos.marketType === 'USD_M_FUTURES'
          ? `Executed Futures (${pos.leverage ?? 1}x)`
          : 'Executed Spot (1x)',
      session: pos.mode,
      timeframe: 'LIVE',
      entryPrice: pos.entryPrice,
      exitOrMarkPrice: markPrice,
      stopLoss: pos.trailingStopLoss,
      takeProfit: pos.takeProfits[2],
      takeProfits: [...pos.takeProfits] as [number,number,number],
      confidence: 88,
      riskRewardRatio: rr > 0 ? rr : 3.0,
      status: outcome,
      pnlR,
      pnlPercent: pnlPct,
      pnlUsd,
      skepticVerdict: pos.skepticVerdict,
      retestStatus: `ATR Trail SL · ${pos.status.replace('CLOSED_', '')}`,
    });
  }

  // 2. Live Pinned Signals (Active milestones & Resolved outcomes)
  for (const pin of input.pinnedSignals ?? []) {
    const sig = pin.signal;
    const resolved = isPinnedSignalResolved(pin.status);
    const outcome: SignalHistoryOutcome = !resolved
      ? 'ACTIVE'
      : pin.status === 'TP3_WIN' || (pin.realizedR ?? 0) > 0
      ? 'WIN'
      : 'LOSS';
    const rMult = resolved ? pin.realizedR ?? pin.unrealizedR : pin.unrealizedR;
    const exitOrMark = resolved ? pin.outcomePrice ?? pin.currentPrice : pin.currentPrice;
    const pct = Number(
      (
        ((sig.direction === 'BUY' ? exitOrMark - sig.entryPrice : sig.entryPrice - exitOrMark) /
          Math.max(1e-8, sig.entryPrice)) *
        100
      ).toFixed(2)
    );
    const rr = Number(Math.max(...(sig.dynamicRRs || [3]), 2).toFixed(1));

    pushUnique({
      id: `pin_${sig.id}_${sig.symbol}`,
      timestamp: formatIsoCompact(pin.resolvedAt || pin.pinnedAt),
      symbol: sig.symbol,
      coinName: sig.coinName,
      direction: sig.direction,
      origin: 'LIVE_PINNED',
      moduleLabel: sig.smc ? 'Live SMC · Pinned' : 'Live AI Engine · Pinned',
      session: sig.smc?.sessionStatus.session || 'Live 24/7',
      timeframe: 'LIVE',
      entryPrice: sig.entryPrice,
      exitOrMarkPrice: exitOrMark,
      stopLoss: pin.trailingStopLoss,
      takeProfit: sig.takeProfits[2],
      takeProfits: [...sig.takeProfits] as [number,number,number],
      confidence: sig.confidence,
      riskRewardRatio: rr,
      status: outcome,
      pnlR: Number(rMult.toFixed(2)),
      pnlPercent: pct,
      retestStatus: `${pin.status} · ${sig.indicators.pattern}`,
    });
  }

  // 3. Multi-Strategy Historical Signals (custom injected or global SMC + Pattern + Technical cross-pair audit)
  if (input.backtestRecords && input.backtestRecords.length > 0) {
    for (const r of input.backtestRecords) {
      pushUnique(fromBacktestRecord(r));
    }
  } else if (input.includeHistoricalBenchmarks !== false) {
    for (const r of getGlobalPastSignalsHistory()) {
      pushUnique(fromBacktestRecord(r));
    }
    if (input.includeCrossStrategyBenchmarks !== false) {
      const benchmarkPairs = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
      for (const sym of benchmarkPairs) {
        const pat = runBacktestSimulation(sym, '4h', undefined, 'PATTERN_SCANNER');
        for (const r of pat.trades.slice(0, 3)) {
          pushUnique(fromBacktestRecord(r));
        }
        const tech = runBacktestSimulation(sym, '4h', undefined, 'TECHNICAL');
        for (const r of tech.trades.slice(0, 3)) {
          pushUnique(fromBacktestRecord(r));
        }
      }
    }
  }

  // Sort LIVE_PINNED & EXECUTED_ORDER to the top when same or recent timestamps, then newest-first
  const livePriority = (origin: SignalHistoryOrigin) =>
    origin === 'EXECUTED_ORDER' ? 2 : origin === 'LIVE_PINNED' ? 1 : 0;

  return records.sort((a, b) => {
    const pDiff = livePriority(b.origin) - livePriority(a.origin);
    if (pDiff !== 0) return pDiff;
    return a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : a.id.localeCompare(b.id);
  });
}

export function filterSignalHistory(
  records: UnifiedSignalAuditRecord[],
  filters: SignalHistoryFilterConfig
): UnifiedSignalAuditRecord[] {
  const q = filters.search.trim().toLowerCase();
  return records.filter((rec) => {
    if (rec.confidence < filters.minConfidence) return false;
    if (filters.direction !== 'ALL' && rec.direction !== filters.direction) return false;
    if (filters.status !== 'ALL' && rec.status !== filters.status) return false;

    if (filters.originGroup === 'LIVE_ONLY') {
      if (rec.origin !== 'EXECUTED_ORDER' && rec.origin !== 'LIVE_PINNED') return false;
    } else if (filters.originGroup === 'SMC') {
      if (rec.origin !== 'BACKTEST_SMC' && !rec.moduleLabel.includes('SMC')) return false;
    } else if (filters.originGroup === 'PATTERN') {
      if (rec.origin !== 'BACKTEST_PATTERN' && !rec.retestStatus?.includes('BREAK')) return false;
    } else if (filters.originGroup === 'TECH') {
      if (rec.origin !== 'BACKTEST_TECH' && !rec.moduleLabel.includes('AI')) return false;
    }

    if (q.length > 0) {
      const hay = `${rec.symbol} ${rec.coinName} ${rec.moduleLabel} ${rec.retestStatus || ''} ${rec.session}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function computeHistoryPerformanceMetrics(
  records: UnifiedSignalAuditRecord[]
): HistoryPerformanceSummary {
  let wins = 0;
  let losses = 0;
  let activeTrades = 0;
  let netR = 0;
  let grossWinR = 0;
  let grossLossR = 0;
  let confSum = 0;
  const symbolNetR = new Map<string, number>();

  for (const r of records) {
    confSum += r.confidence;
    if (r.status === 'ACTIVE') {
      activeTrades += 1;
      continue;
    }
    netR += r.pnlR;
    symbolNetR.set(r.symbol, (symbolNetR.get(r.symbol) ?? 0) + r.pnlR);
    if (r.status === 'WIN') {
      wins += 1;
      grossWinR += Math.max(0, r.pnlR);
    } else {
      losses += 1;
      grossLossR += Math.abs(Math.min(0, r.pnlR));
    }
  }

  const resolvedTrades = wins + losses;
  const winRatePct =
    resolvedTrades > 0 ? Number(((wins / resolvedTrades) * 100).toFixed(1)) : 0;
  const avgRMultiple =
    resolvedTrades > 0 ? Number((netR / resolvedTrades).toFixed(2)) : 0;
  const profitFactor =
    grossLossR > 0
      ? Number((grossWinR / grossLossR).toFixed(2))
      : grossWinR > 0
      ? 5.0
      : 0;
  const avgConfidencePct =
    records.length > 0 ? Number((confSum / records.length).toFixed(1)) : 0;

  let bestSymbol = records[0]?.symbol || 'BTCUSDT';
  let bestSymbolNetR = -Infinity;
  for (const [sym, val] of symbolNetR.entries()) {
    if (val > bestSymbolNetR) {
      bestSymbolNetR = val;
      bestSymbol = sym;
    }
  }
  if (bestSymbolNetR === -Infinity) bestSymbolNetR = 0;

  return {
    totalRecords: records.length,
    resolvedTrades,
    activeTrades,
    wins,
    losses,
    winRatePct,
    netRMultiple: Number(netR.toFixed(2)),
    avgRMultiple,
    expectancyR: avgRMultiple,
    profitFactor,
    avgConfidencePct,
    bestSymbol,
    bestSymbolNetR: Number(bestSymbolNetR.toFixed(2)),
  };
}

export function computeStrategyAttribution(
  records: UnifiedSignalAuditRecord[],
  autoReports: StructuredPerformanceReport[] = []
): StrategyAttributionRow[] {
  const buckets = new Map<
    string,
    { label: string; items: UnifiedSignalAuditRecord[] }
  >();

  const classify = (r: UnifiedSignalAuditRecord): { key: string; label: string } => {
    if (r.origin === 'EXECUTED_ORDER') {
      return { key: 'EXECUTED', label: 'Live & Testnet Execution' };
    }
    if (r.origin === 'BACKTEST_SMC' || r.moduleLabel.includes('SMC')) {
      return { key: 'SMC_FRVP', label: 'SMC & FRVP Liquidity' };
    }
    if (r.origin === 'BACKTEST_PATTERN') {
      return { key: 'PATTERN', label: 'Breakout / Breakdown Scanner' };
    }
    return { key: 'AI_TECH', label: 'Multi-Agent AI Engine' };
  };

  for (const rec of records) {
    const b = classify(rec);
    const existing = buckets.get(b.key) ?? { label: b.label, items: [] };
    existing.items.push(rec);
    buckets.set(b.key, existing);
  }

  const rawRows = Array.from(buckets.entries()).map(([key, bucket]) => {
    const resolvedItems = bucket.items.filter((i) => i.status !== 'ACTIVE');
    const wins = resolvedItems.filter((i) => i.status === 'WIN').length;
    const netR = resolvedItems.reduce((sum, i) => sum + i.pnlR, 0);
    const avgConf =
      bucket.items.reduce((sum, i) => sum + i.confidence, 0) /
      Math.max(1, bucket.items.length);
    return {
      key,
      moduleLabel: bucket.label,
      trades: bucket.items.length,
      resolved: resolvedItems.length,
      wins,
      winRatePct:
        resolvedItems.length > 0
          ? Number(((wins / resolvedItems.length) * 100).toFixed(1))
          : 0,
      netR: Number(netR.toFixed(2)),
      avgConfidencePct: Number(avgConf.toFixed(1)),
    };
  });

  // Positive profit share weight across modules (falls back cleanly to autoReports contribution or trade count)
  const totalPositiveR = rawRows.reduce((s, r) => s + Math.max(0, r.netR), 0);
  const monthlyReport = autoReports.find((r) => r.period === 'MONTHLY') ?? autoReports[0];

  return rawRows
    .map((r) => {
      let contributionPct: number;
      if (totalPositiveR > 0) {
        contributionPct = Number(
          ((Math.max(0, r.netR) / totalPositiveR) * 100).toFixed(1)
        );
      } else if (monthlyReport?.strategyBreakdown.length) {
        const matched = monthlyReport.strategyBreakdown.find((sb) =>
          sb.module.toLowerCase().includes(r.moduleLabel.split(' ')[0].toLowerCase())
        );
        contributionPct = matched ? matched.contributionPct : 0;
      } else {
        contributionPct = Number(
          ((r.trades / Math.max(1, records.length)) * 100).toFixed(1)
        );
      }
      return { ...r, contributionPct };
    })
    .sort((a, b) => b.netR - a.netR || b.trades - a.trades);
}

export function computeSymbolAttribution(
  records: UnifiedSignalAuditRecord[]
): SymbolAttributionRow[] {
  const bySymbol = new Map<
    string,
    { coinName: string; trades: number; wins: number; losses: number; netR: number }
  >();

  for (const r of records) {
    const cur = bySymbol.get(r.symbol) ?? {
      coinName: r.coinName,
      trades: 0,
      wins: 0,
      losses: 0,
      netR: 0,
    };
    cur.trades += 1;
    if (r.status === 'WIN') {
      cur.wins += 1;
      cur.netR += r.pnlR;
    } else if (r.status === 'LOSS') {
      cur.losses += 1;
      cur.netR += r.pnlR;
    }
    bySymbol.set(r.symbol, cur);
  }

  return Array.from(bySymbol.entries())
    .map(([symbol, data]) => {
      const resolved = data.wins + data.losses;
      return {
        symbol,
        coinName: data.coinName,
        trades: data.trades,
        wins: data.wins,
        losses: data.losses,
        winRatePct: resolved > 0 ? Number(((data.wins / resolved) * 100).toFixed(1)) : 0,
        netR: Number(data.netR.toFixed(2)),
      };
    })
    .sort((a, b) => b.netR - a.netR || b.trades - a.trades);
}

export function signalHistoryToCsv(records: UnifiedSignalAuditRecord[]): string {
  const header = [
    'TimestampUTC',
    'Pair',
    'Direction',
    'Module',
    'Session',
    'Timeframe',
    'EntryPrice',
    'ExitOrMarkPrice',
    'StopLoss',
    'TakeProfit',
    'Confidence',
    'RiskReward',
    'Outcome',
    'NetR',
    'ProfitPercent',
  ].join(',');

  const lines = records.map((r) =>
    [
      r.timestamp,
      r.symbol,
      r.direction,
      `"${r.moduleLabel.replace(/"/g, '""')}"`,
      `"${r.session.replace(/"/g, '""')}"`,
      r.timeframe,
      r.entryPrice,
      r.exitOrMarkPrice,
      r.stopLoss,
      r.takeProfit,
      r.confidence,
      r.riskRewardRatio,
      r.status,
      r.pnlR,
      r.pnlPercent,
    ].join(',')
  );

  return [header, ...lines].join('\n');
}

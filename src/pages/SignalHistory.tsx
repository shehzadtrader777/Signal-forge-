import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Award,
  BarChart3,
  Download,
  History,
  LineChart,
  Mail,
  RefreshCw,
  Search,
  Send,
  TrendingUp,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatCryptoPrice } from '../lib/marketData';
import { SignalInspectChart } from '../components/SignalInspectChart';
import { deriveTradeAuditIdentity } from '../lib/tradeAuditIdentity';
import {
  DEFAULT_SIGNAL_HISTORY_FILTERS,
  buildUnifiedSignalHistory,
  computeHistoryPerformanceMetrics,
  computeStrategyAttribution,
  computeSymbolAttribution,
  filterSignalHistory,
  signalHistoryToCsv,
  type SignalHistoryFilterConfig,
  type SignalHistoryOutcome,
  type UnifiedSignalAuditRecord,
} from '../lib/signalHistory';

interface EmailDispatchAudit {
  id: string;
  type: string;
  recipient: string;
  subject: string;
  summary: string;
  status: string;
  timestamp: string;
}

function TrajectorySparkline({ points, isWin }: { points: number[]; isWin: boolean }) {
  if (!points || points.length < 2) {
    return <span className="font-mono text-[10px] text-slate-500">Live Mark</span>;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(max - min, min * 0.0001 || 1);
  const w = 72;
  const h = 22;
  const d = points
    .map((p, idx) => {
      const x = (idx / (points.length - 1)) * w;
      const y = h - ((p - min) / span) * (h - 4) - 2;
      return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="mx-auto">
      <path
        d={d}
        fill="none"
        stroke={isWin ? '#10b981' : '#f43f5e'}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SignalHistory() {
  const {
    pinnedSignals,
    executionState,
    tickers,
    autoReports,
    liveCrossMargin,
    telegramFeed,
    refreshExecutionState,
    refreshAutoReports,
    refreshTelegramFeed,
  } = useApp();

  const [filters, setFilters] = useState<SignalHistoryFilterConfig>(
    DEFAULT_SIGNAL_HISTORY_FILTERS
  );
  const [showAllRows, setShowAllRows] = useState(false);
  const [inspectedRecord, setInspectedRecord] = useState<UnifiedSignalAuditRecord | null>(null);
  const [includeSimulatedBenchmarks, setIncludeSimulatedBenchmarks] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [emailHistory, setEmailHistory] = useState<EmailDispatchAudit[]>([]);

  const loadDispatchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts/history');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.records)) {
        setEmailHistory(data.records);
      }
    } catch {
      // ignore transient network errors
    }
  }, []);

  useEffect(() => {
    loadDispatchHistory();
  }, [loadDispatchHistory]);

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      await Promise.all([
        refreshExecutionState(),
        refreshAutoReports(),
        refreshTelegramFeed(),
        loadDispatchHistory(),
      ]);
    } finally {
      setSyncing(false);
    }
  };

  const allRecords = useMemo(
    () =>
      buildUnifiedSignalHistory({
        pinnedSignals,
        positions: executionState.positions,
        tickers,
        includeCrossStrategyBenchmarks: includeSimulatedBenchmarks,
        includeHistoricalBenchmarks: includeSimulatedBenchmarks,
      }),
    [pinnedSignals, executionState.positions, tickers, includeSimulatedBenchmarks]
  );

  const filteredRecords = useMemo(
    () => filterSignalHistory(allRecords, filters),
    [allRecords, filters]
  );

  const metrics = useMemo(
    () => computeHistoryPerformanceMetrics(filteredRecords),
    [filteredRecords]
  );

  const strategyAttribution = useMemo(
    () => computeStrategyAttribution(filteredRecords, autoReports),
    [filteredRecords, autoReports]
  );

  const symbolAttribution = useMemo(
    () => computeSymbolAttribution(filteredRecords),
    [filteredRecords]
  );

  const visibleRows = showAllRows ? filteredRecords : filteredRecords.slice(0, 25);

  const isDefaultFilter =
    filters.search === '' &&
    filters.originGroup === 'ALL' &&
    filters.status === 'ALL' &&
    filters.direction === 'ALL' &&
    filters.minConfidence === 0;

  const handleExportCsv = () => {
    const csv = signalHistoryToCsv(filteredRecords);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `signal-forge-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleInspectChart = (record: UnifiedSignalAuditRecord) => setInspectedRecord(record);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      {/* Page Header */}
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <History className="h-3.5 w-3.5 text-[#3b82f6]" aria-hidden="true" />
            <span className="font-mono font-semibold text-blue-300">
              PERSISTENT AUDIT TRAIL &amp; ATTRIBUTION
            </span>
            <span aria-hidden="true">·</span>
            <span>Live Executions · Pinned Signals · Multi-Strategy Historical Ledger</span>
          </div>
          <h1 className="mt-1 font-display text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Signal History &amp; Performance Attribution
          </h1>
          <p className="mt-1 text-xs text-slate-400 max-w-3xl leading-relaxed">
            Complete verifiable audit trail combining executed Spot &amp; Futures orders, tracked
            pinned AI setups, cross-pair Coordinator benchmarks, and module-level performance
            attribution.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#111827] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-[#3b82f6] hover:text-white transition-colors cursor-pointer whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5 text-[#3b82f6]" aria-hidden="true" />
            <span>Export Audit CSV</span>
          </button>

          <button
            type="button"
            disabled={syncing}
            onClick={handleSyncAll}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#3b82f6] px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Syncing Audit...' : 'Sync Audit Trail'}</span>
          </button>
        </div>
      </section>

      {/* Top Performance KPI Summary Strip */}
      <section
        aria-label="Signal History Performance Metrics"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <div className="rounded-xl border border-slate-800/90 bg-[#111827] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Audited Win Rate</span>
            <TrendingUp className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
            {metrics.winRatePct}%
            <span className="ml-2 text-xs font-normal text-slate-400">
              ({metrics.wins}W / {metrics.losses}L)
            </span>
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-400 tabular-nums">
            {metrics.resolvedTrades} resolved · {metrics.activeTrades} active setups
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-[#111827] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Cumulative Net R &amp; Expectancy</span>
            <BarChart3 className="h-4 w-4 text-[#3b82f6]" aria-hidden="true" />
          </div>
          <div
            className={`mt-2 font-mono text-2xl font-bold tabular-nums ${
              metrics.netRMultiple >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {metrics.netRMultiple >= 0 ? '+' : ''}
            {metrics.netRMultiple}R
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-400 tabular-nums">
            Expectancy: {metrics.expectancyR >= 0 ? '+' : ''}
            {metrics.expectancyR}R per trade
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-[#111827] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Profit Factor &amp; Confidence</span>
            <Activity className="h-4 w-4 text-cyan-400" aria-hidden="true" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
            {metrics.profitFactor}x
            <span className="ml-2 text-xs font-normal text-cyan-300">
              {metrics.avgConfidencePct}% Avg Conf
            </span>
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-400 tabular-nums">
            Across {metrics.totalRecords} audited historical signals
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-[#111827] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Top Attribution Asset</span>
            <Award className="h-4 w-4 text-amber-400" aria-hidden="true" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums flex items-baseline gap-2">
            <span>{metrics.bestSymbol}</span>
            <span
              className={`text-sm font-semibold ${
                metrics.bestSymbolNetR >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {metrics.bestSymbolNetR >= 0 ? '+' : ''}
              {metrics.bestSymbolNetR}R
            </span>
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-400 tabular-nums">
            Cross Equity: ${liveCrossMargin.crossEquityUsd.toLocaleString()}
          </div>
        </div>
      </section>

      {/* Module & Per-Asset Attribution Grid */}
      <section
        aria-label="Performance Attribution Breakdown"
        className="grid grid-cols-1 gap-6 lg:grid-cols-12"
      >
        {/* Left: Module Strategy Attribution + Periodic Auto-Report Attribution */}
        <div className="lg:col-span-7 rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden">
          <div className="border-b border-slate-800/80 bg-[#0d1323] px-5 py-3.5 flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-bold text-white">
                Module &amp; Coordinator Attribution
              </h2>
              <p className="text-[11px] text-slate-400">
                Win rate, net R-multiple, and share of cumulative performance by signal source
              </p>
            </div>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {strategyAttribution.length} Active Sources
            </span>
          </div>

          <div className="p-5 space-y-4">
            <div className="space-y-3">
              {strategyAttribution.map((row) => (
                <div
                  key={row.key}
                  className="rounded-lg border border-slate-800/80 bg-[#0d1323] p-3 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-white">{row.moduleLabel}</span>
                    <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums">
                      <span className="text-slate-400">{row.trades} signals</span>
                      <span className="text-blue-300">{row.avgConfidencePct}% avg conf</span>
                      <span className="text-emerald-400 font-semibold">
                        {row.winRatePct}% WR
                      </span>
                      <span
                        className={`font-bold ${
                          row.netR >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {row.netR >= 0 ? '+' : ''}
                        {row.netR}R
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#3b82f6]"
                        style={{
                          width: `${Math.min(100, Math.max(4, row.contributionPct))}%`,
                        }}
                      />
                    </div>
                    <span className="font-mono text-[11px] text-slate-300 tabular-nums w-14 text-right">
                      {row.contributionPct}%
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {autoReports.length > 0 && (
              <div className="pt-2 border-t border-slate-800/80">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
                  Coordinator Periodic Attribution Rollups (Daily · Weekly · Monthly)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {autoReports.map((rep) => (
                    <div
                      key={rep.period}
                      className="rounded-lg border border-slate-800/80 bg-[#0a0e1a] p-3 font-mono text-xs tabular-nums"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-sans font-semibold text-blue-300">
                          {rep.label}
                        </span>
                        <span className="font-bold text-emerald-400">+{rep.netReturn}%</span>
                      </div>
                      <div className="mt-1.5 text-[11px] text-slate-300">
                        {rep.signals} signals · {rep.winRate}% WR · {rep.profitFactor}x PF
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        Best: {rep.bestPair} · Vetoes Saved: {rep.skepticVetoes}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Per-Asset Performance Attribution */}
        <div className="lg:col-span-5 rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden">
          <div className="border-b border-slate-800/80 bg-[#0d1323] px-5 py-3.5 flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-bold text-white">
                Asset Edge Attribution
              </h2>
              <p className="text-[11px] text-slate-400">
                Click any pair to filter the Signal History audit table
              </p>
            </div>
            {filters.search && (
              <button
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, search: '' }))}
                className="text-[11px] font-semibold text-blue-300 hover:text-white cursor-pointer"
              >
                Clear Pair Filter
              </button>
            )}
          </div>

          <div className="p-4 space-y-2 max-h-[380px] overflow-y-auto">
            {symbolAttribution.map((item) => {
              const selected = filters.search.toUpperCase() === item.symbol;
              return (
                <button
                  key={item.symbol}
                  type="button"
                  onClick={() =>
                    setFilters((prev) => ({
                      ...prev,
                      search: selected ? '' : item.symbol,
                    }))
                  }
                  className={`w-full flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                    selected
                      ? 'border-[#3b82f6] bg-[#3b82f6]/10'
                      : 'border-slate-800/80 bg-[#0d1323] hover:border-slate-700'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-bold text-white">
                      {item.symbol}
                      <span className="ml-2 font-sans font-normal text-slate-400">
                        {item.coinName}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                      {item.wins}W / {item.losses}L ({item.trades} total)
                    </div>
                  </div>
                  <div className="text-right font-mono text-xs tabular-nums shrink-0">
                    <div
                      className={`font-bold ${
                        item.netR >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {item.netR >= 0 ? '+' : ''}
                      {item.netR}R
                    </div>
                    <div className="text-[11px] text-slate-400">{item.winRatePct}% WR</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Audit Trail Filter Controls */}
      <section
        aria-label="Signal History Filters"
        className="rounded-xl border border-slate-800/90 bg-[#111827] p-4 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold text-white">
            Audit Trail Filter Controls ({filteredRecords.length} matching records)
          </h2>
          {!isDefaultFilter && (
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_SIGNAL_HISTORY_FILTERS)}
              className="rounded-md border border-slate-700 bg-[#0d1323] px-2.5 py-1 text-[11px] font-semibold text-blue-300 hover:border-[#3b82f6] cursor-pointer whitespace-nowrap"
            >
              Reset All Filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 text-xs">
          <div>
            <label htmlFor="history-search" className="block text-[11px] text-slate-400 mb-1">
              Search Pair / Setup
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500"
                aria-hidden="true"
              />
              <input
                id="history-search"
                type="text"
                value={filters.search}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, search: e.target.value }))
                }
                placeholder="BTCUSDT, SMC, Breakout..."
                className="w-full rounded-lg border border-slate-700 bg-[#0d1323] pl-8 pr-2.5 py-2 text-xs text-white placeholder:text-slate-500 focus:border-[#3b82f6] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="history-origin" className="block text-[11px] text-slate-400 mb-1">
              Signal Source
            </label>
            <select
              id="history-origin"
              value={filters.originGroup}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  originGroup: e.target.value as SignalHistoryFilterConfig['originGroup'],
                }))
              }
              className="w-full rounded-lg border border-slate-700 bg-[#0d1323] px-2.5 py-2 text-xs text-white focus:border-[#3b82f6] focus:outline-none"
            >
              <option value="ALL">All Audit Sources</option>
              <option value="LIVE_ONLY">Live Pinned &amp; Executed Only</option>
              <option value="SMC">SMC &amp; FRVP Setups</option>
              <option value="PATTERN">Pattern Scanners</option>
              <option value="TECH">AI Technical Engine</option>
            </select>
          </div>

          <div>
            <label htmlFor="history-status" className="block text-[11px] text-slate-400 mb-1">
              Outcome Status
            </label>
            <select
              id="history-status"
              value={filters.status}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  status: e.target.value as 'ALL' | SignalHistoryOutcome,
                }))
              }
              className="w-full rounded-lg border border-slate-700 bg-[#0d1323] px-2.5 py-2 text-xs text-white focus:border-[#3b82f6] focus:outline-none"
            >
              <option value="ALL">All Outcomes</option>
              <option value="WIN">Winning Outcomes (WIN)</option>
              <option value="LOSS">Stopped / Losses (LOSS)</option>
              <option value="ACTIVE">Open / Active Monitoring</option>
            </select>
          </div>

          <div>
            <label htmlFor="history-direction" className="block text-[11px] text-slate-400 mb-1">
              Direction
            </label>
            <select
              id="history-direction"
              value={filters.direction}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  direction: e.target.value as 'ALL' | 'BUY' | 'SELL',
                }))
              }
              className="w-full rounded-lg border border-slate-700 bg-[#0d1323] px-2.5 py-2 text-xs text-white focus:border-[#3b82f6] focus:outline-none"
            >
              <option value="ALL">LONG &amp; SHORT</option>
              <option value="BUY">LONG (BUY) Only</option>
              <option value="SELL">SHORT (SELL) Only</option>
            </select>
          </div>

          <div>
            <label htmlFor="history-conf" className="block text-[11px] text-slate-400 mb-1">
              Confidence Filter
            </label>
            <select
              id="history-conf"
              value={filters.minConfidence}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  minConfidence: Number(e.target.value),
                }))
              }
              className="w-full rounded-lg border border-slate-700 bg-[#0d1323] px-2.5 py-2 text-xs text-white font-mono focus:border-[#3b82f6] focus:outline-none"
            >
              <option value={0}>All Confidence Levels</option>
              <option value={75}>&ge; 75% High Confidence</option>
              <option value={86}>&ge; 86% Strict Coordinator</option>
            </select>
          </div>
        </div>
      </section>

      {/* Complete Historical Signal Audit Table */}
      <section
        aria-label="Complete Historical Signals Audit Table"
        className="rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 bg-[#0d1323] px-5 py-3.5">
          <div>
            <h2 className="font-display text-lg font-bold text-white">
              Historical Signals Audit Log
            </h2>
            <p className="text-xs text-slate-400">
              Showing {visibleRows.length} of {filteredRecords.length} records · observed-only by default
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-amber-200">
            <input type="checkbox" checked={includeSimulatedBenchmarks}
              onChange={e=>setIncludeSimulatedBenchmarks(e.target.checked)} />
            Include simulated benchmark signals
          </label>
          {filteredRecords.length > 25 && (
            <button
              type="button"
              onClick={() => setShowAllRows((prev) => !prev)}
              className="rounded-md border border-slate-700 bg-[#0a0e1a] px-3 py-1.5 text-xs font-semibold text-blue-300 hover:border-[#3b82f6] cursor-pointer whitespace-nowrap"
            >
              {showAllRows
                ? 'Show Recent 25'
                : `Show All (${filteredRecords.length})`}
            </button>
          )}
        </div>

        {visibleRows.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            No historical signals matched your active filter criteria. Reset filters to inspect the
            full audit trail.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-[#0a0e1a] text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Time (UTC)</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">Source Module</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">Pair &amp; Side</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">Setup / Attribution</th>
                  <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">Entry</th>
                  <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                    Exit / Mark
                  </th>
                  <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                    Conf · R:R
                  </th>
                  <th className="px-3 py-2.5 font-medium text-center whitespace-nowrap">Path</th>
                  <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">
                    Outcome · P&amp;L
                  </th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">Audit ID / Status</th>
                  <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                {visibleRows.map((row) => {
                  const isBuy = row.direction === 'BUY';
                  const isWin = row.status === 'WIN';
                  const isActive = row.status === 'ACTIVE';
                  return (
                    <tr key={row.id} className="hover:bg-[#0d1323]/70 transition-colors">
                      <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                        <div>{row.timestamp}</div>
                        <div className="text-[10px] font-sans text-slate-500">{row.session}</div>
                      </td>
                      <td className="px-3 py-3 font-sans whitespace-nowrap">
                        <div className="font-medium text-slate-200">{row.moduleLabel}</div>
                        <div className="text-[10px] font-mono text-slate-500">
                          {row.timeframe}
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="font-bold text-white">{row.symbol}</div>
                        <span
                          className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${
                            isBuy ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {isBuy ? (
                            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
                          )}
                          {row.direction}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-sans text-slate-300 max-w-[240px] truncate">
                        {row.retestStatus || 'Coordinator Verified Setup'}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-200 whitespace-nowrap">
                        ${formatCryptoPrice(row.entryPrice)}
                      </td>
                      <td className="px-3 py-3 text-right text-white font-semibold whitespace-nowrap">
                        ${formatCryptoPrice(row.exitOrMarkPrice)}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <div className="text-white">{row.confidence}%</div>
                        <div className="text-[10px] text-slate-400">
                          1:{row.riskRewardRatio}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        <TrajectorySparkline
                          points={row.snapshotPoints || []}
                          isWin={isWin || row.pnlR >= 0}
                        />
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <div
                          className={`font-bold ${
                            isActive
                              ? 'text-blue-300'
                              : isWin
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {row.status} ({row.pnlR >= 0 ? '+' : ''}
                          {row.pnlR}R)
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {row.pnlPercent >= 0 ? '+' : ''}
                          {row.pnlPercent}%
                          {row.pnlUsd !== undefined
                            ? ` (${row.pnlUsd >= 0 ? '+' : ''}$${row.pnlUsd.toFixed(2)})`
                            : ''}
                        </div>
                      </td>
                      <td className="px-3 py-3 font-sans text-xs">
                        <div className="max-w-[180px] truncate font-mono text-slate-200" title={row.id}>{row.id}</div>
                        <div className="text-[10px] text-amber-300">{deriveTradeAuditIdentity(row).verificationLabel}</div>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleInspectChart(row)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-[#0d1323] px-2.5 py-1 text-[11px] font-sans font-semibold text-slate-200 hover:border-[#3b82f6] hover:text-white cursor-pointer whitespace-nowrap"
                        >
                          <LineChart className="h-3 w-3 text-[#3b82f6]" aria-hidden="true" />
                          <span>Chart</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Historical Telegram & Email Dispatch Audit Logs */}
      <section
        aria-label="Signal Delivery Audit Trail"
        className="grid grid-cols-1 gap-6 lg:grid-cols-2"
      >
        <div className="rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden">
          <div className="border-b border-slate-800/80 bg-[#0d1323] px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Send className="h-4 w-4 text-[#3b82f6]" aria-hidden="true" />
              <span>Telegram Signal Forge Dispatch Log ({telegramFeed.length})</span>
            </div>
          </div>
          <div className="p-4 space-y-2.5 max-h-64 overflow-y-auto">
            {telegramFeed.length === 0 ? (
              <p className="text-xs text-slate-500">
                High-confidence signals routed to Telegram will appear here chronologically.
              </p>
            ) : (
              telegramFeed.slice(0, 10).map((post) => (
                <div
                  key={post.id}
                  className="rounded-lg border border-slate-800/80 bg-[#0d1323] px-3 py-2 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between font-mono tabular-nums">
                    <span className="font-bold text-white">
                      {post.symbol} · {post.direction}
                      {post.confidence ? ` (${post.confidence}%)` : ''}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {post.timestamp.slice(0, 16).replace('T', ' ')}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 line-clamp-2">{post.message}</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden">
          <div className="border-b border-slate-800/80 bg-[#0d1323] px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Mail className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              <span>Email &amp; 3H Digest Audit Log ({emailHistory.length})</span>
            </div>
          </div>
          <div className="p-4 space-y-2.5 max-h-64 overflow-y-auto">
            {emailHistory.length === 0 ? (
              <p className="text-xs text-slate-500">
                Batched 3-hour email digests and triggered price alert dispatches appear here.
              </p>
            ) : (
              emailHistory.slice(0, 10).map((rec) => (
                <div
                  key={rec.id}
                  className="rounded-lg border border-slate-800/80 bg-[#0d1323] px-3 py-2 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 font-mono tabular-nums">
                    <span className="font-bold text-white truncate">{rec.subject}</span>
                    <span className="text-[10px] text-emerald-400 shrink-0">{rec.status}</span>
                  </div>
                  <div className="text-[11px] text-slate-400">{rec.summary}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
      {inspectedRecord && <SignalInspectChart record={inspectedRecord} onClose={() => setInspectedRecord(null)} />}
    </div>
  );
}

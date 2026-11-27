import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Flame,
  Layers,
  LineChart,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Zap,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { SystemControlsBar } from '../components/SystemControlsBar';
import { LiveTestnetLedger } from '../components/LiveTestnetLedger';
import { OrderBookDepthPanel } from '../components/OrderBookDepthPanel';
import { SentinelAgentPanel } from '../components/SentinelAgentPanel';
import { AutonomousOperationsHub } from '../components/AutonomousOperationsHub';
import { PublicSignalValidationGatePanel } from '../components/PublicSignalValidationGatePanel';
import { Step2IntelligenceHubPanel } from '../components/Step2IntelligenceHubPanel';
import { formatCryptoPrice, type Timeframe } from '../lib/marketData';
import {
  DEFAULT_MASTER_SIGNAL_FILTERS,
  buildMasterCoordinatorSetups,
  filterMasterCoordinatorSetups,
  summarizeMasterCoordinator,
  type MasterCoordinatorSetup,
  type MasterDirectionFilter,
  type MasterModuleFilter,
  type MasterMoveFilter,
  type MasterSignalFilterConfig,
} from '../lib/masterCoordinator';
import { type WhaleFlowSnapshot } from '../lib/coordinator';

const TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h', '1d'];

export function Signals() {
  const navigate = useNavigate();
  const {
    signalTimeframe,
    setSignalTimeframe,
    liveCandlesMap,
    signalTickers,
    newsItems,
    scanningMarkets,
    runSharedSignalScan,
    allKnownCoins,
    topGainers,
    gainerSource,
    gainerAlerts,
    futuresTradingEnabled,
    setFuturesTradingEnabled,
    futuresTelemetry,
    executionState,
    liveCrossMargin,
    testnetExecutionEnabled,
    backendEvaluations,
    setSelectedSymbol,
    setExecutionRouteDraft,
    routeSignalToTelegram,
    executeCoordinatorOrder,
    orderBookDepth,
    sentinelBySymbol,
  } = useApp();

  const [filters, setFilters] = useState<MasterSignalFilterConfig>(DEFAULT_MASTER_SIGNAL_FILTERS);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [routingId, setRoutingId] = useState<string | null>(null);
  const [routedSuccessIds, setRoutedSuccessIds] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<{
    id: string;
    ok: boolean;
    message: string;
  } | null>(null);

  const whaleFlowsMap = useMemo<Record<string, WhaleFlowSnapshot>>(() => {
    const map: Record<string, WhaleFlowSnapshot> = {};
    for (const [sym, ev] of Object.entries(backendEvaluations)) {
      map[sym] = {
        symbol: sym,
        netflowUsd: ev.netflowUsd,
        inflow24hUsd: ev.inflow24hUsd,
        outflow24hUsd: ev.outflow24hUsd,
      };
    }
    return map;
  }, [backendEvaluations]);

  const evalMinuteBucket = Math.floor(Date.now() / 60_000) * 60;

  const { allSetups, patternSummary } = useMemo(
    () =>
      buildMasterCoordinatorSetups({
        candlesMap: liveCandlesMap,
        timeframe: signalTimeframe,
        allKnownCoins,
        topGainers,
        liveTickers: signalTickers,
        newsItems,
        whaleFlowsMap,
        futuresTelemetry,
        orderBookDepthMap: orderBookDepth,
        sentinelBySymbol,
        positions: executionState.positions,
        planOptions: {
          futuresEnabled: futuresTradingEnabled,
          notionalUsd: 1500,
          scalingMode: 'AUTO_VOLATILITY',
          marginMode: 'CROSS',
          crossAvailableBalanceUsd: liveCrossMargin.availableCrossMarginUsd,
        },
        evaluationTimeSec: evalMinuteBucket,
      }),
    [
      liveCandlesMap,
      signalTickers,
      signalTimeframe,
      allKnownCoins,
      topGainers,
      newsItems,
      whaleFlowsMap,
      futuresTelemetry,
      orderBookDepth,
      sentinelBySymbol,
      executionState.positions,
      futuresTradingEnabled,
      liveCrossMargin.availableCrossMarginUsd,
      evalMinuteBucket,
    ]
  );

  const qualifiedSetups = useMemo(
    () => filterMasterCoordinatorSetups(allSetups, filters),
    [allSetups, filters]
  );

  const summary = useMemo(
    () => summarizeMasterCoordinator(allSetups, qualifiedSetups, patternSummary),
    [allSetups, qualifiedSetups, patternSummary]
  );

  const openPositionsCount = useMemo(
    () => executionState.positions.filter((p) => p.status === 'OPEN').length,
    [executionState.positions]
  );

  const isDefaultFilter =
    filters.minConfidence === DEFAULT_MASTER_SIGNAL_FILTERS.minConfidence &&
    filters.minRiskReward === DEFAULT_MASTER_SIGNAL_FILTERS.minRiskReward &&
    filters.moduleFilter === 'ALL' &&
    filters.moveFilter === 'ALL' &&
    filters.directionFilter === 'ALL' &&
    !filters.topGainersOnly &&
    filters.excludeVetoed;

  const handleDispatchTelegram = async (setup: MasterCoordinatorSetup) => {
    setRoutingId(setup.id);
    try {
      const ok = await routeSignalToTelegram(setup.plan, true);
      if (ok) {
        setRoutedSuccessIds((prev) => ({ ...prev, [setup.id]: true }));
        setFeedback({
          id: setup.id,
          ok: true,
          message: `${setup.symbol} routed to Telegram Signal Forge`,
        });
      } else {
        setFeedback({
          id: setup.id,
          ok: false,
          message: `Telegram dispatch skipped or deduplicated for ${setup.symbol}`,
        });
      }
    } finally {
      setRoutingId(null);
    }
  };

  const handleExecuteTrade = async (setup: MasterCoordinatorSetup) => {
    setExecutingId(setup.id);
    try {
      const res = await executeCoordinatorOrder(setup.plan);
      if (res.ok) {
        setFeedback({
          id: setup.id,
          ok: true,
          message: `Executed ${setup.symbol} ${setup.direction} @ $${formatCryptoPrice(
            setup.entryPrice
          )} — synced live to Execution Ledger.`,
        });
      } else {
        setFeedback({
          id: setup.id,
          ok: false,
          message: res.error || 'Execution request rejected.',
        });
      }
    } finally {
      setExecutingId(null);
    }
  };

  const handleOpenChart = (symbol: string) => {
    setSelectedSymbol(symbol);
    navigate('/');
  };

  const handleBuyGainerRoute = (
    symbol: string,
    rank: number,
    prePumpScore?: number,
    dynamicLev?: number,
    wideTrailAtrMult?: number
  ) => {
    setSelectedSymbol(symbol);
    setExecutionRouteDraft({
      symbol,
      direction: 'BUY',
      market: futuresTradingEnabled ? 'USD_M_FUTURES' : 'SPOT',
      moduleId: 'SPOT_MOMENTUM',
      leverage: futuresTradingEnabled ? dynamicLev ?? 8 : 1,
      notionalUsd: 1500,
      trailingAtrMultiplier: wideTrailAtrMult ?? 2.15,
      prePumpScore,
      sourceLabel: `Top Gainer #${rank}`,
      requestedAt: Date.now(),
    });
    navigate('/#forge-execution-hub');
  };

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      {/* Page Title & Granular Execution Controls Header */}
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <Layers className="h-3.5 w-3.5 text-[#3b82f6]" aria-hidden="true" />
            <span className="font-mono font-semibold text-blue-300">
              MASTER COORDINATOR HUB
            </span>
            <span aria-hidden="true">·</span>
            <span>SMC + FRVP · Breakout/Breakdown Scanners · Binance Top Gainers</span>
          </div>
          <h1 className="mt-1 font-display text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Unified High-Confidence Signals &amp; Execution
          </h1>
          <p className="mt-1 text-xs text-slate-400 max-w-3xl leading-relaxed">
            Strict Coordinator screening defaults to{' '}
            <span className="font-mono font-semibold text-white">&ge;86% Confidence</span> and{' '}
            <span className="font-mono font-semibold text-white">&ge;1:2.0 R:R</span> across Smart
            Money Concepts, Fixed Range Volume Profile nodes, and verified Breakout/Breakdown setups.
            Internal candidates remain private until approved through the 5-stage Public Signal Gate below.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* Optional Manual Futures Trading Toggle */}
          <div className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-[#111827] px-3 py-2 text-xs">
            <span className="font-medium text-slate-200 whitespace-nowrap">
              {futuresTradingEnabled ? 'USD-M Futures Active' : 'Spot Priority (1x)'}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={futuresTradingEnabled}
              aria-label="Toggle optional Futures trading"
              onClick={() => setFuturesTradingEnabled(!futuresTradingEnabled)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                futuresTradingEnabled
                  ? 'border-[#3b82f6] bg-[#3b82f6]'
                  : 'border-slate-700 bg-slate-800'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  futuresTradingEnabled ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          <button
            type="button"
            onClick={() => runSharedSignalScan(signalTimeframe)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#111827] px-3.5 py-2 text-xs font-semibold text-white hover:border-[#3b82f6] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${scanningMarkets ? 'animate-spin' : ''}`} />
            <span>{scanningMarkets ? 'Syncing Setups...' : `Sync Setups (${signalTimeframe})`}</span>
          </button>
        </div>
      </section>

      {/* Granular Master System Runtime Toggles */}
      <SystemControlsBar />

      {/* Step 2: Unified AI Signal Hub, 6-Role Coordinated Intelligence, Modular Strategies & Controlled Execution */}
      <Step2IntelligenceHubPanel />

      {/* Phase 1: 5-Stage Public Signal Validation, 50-Check Gate & Backend Operator Approval */}
      <PublicSignalValidationGatePanel
        liveBtcPrice={signalTickers['BTCUSDT']?.price}
        liveEthPrice={signalTickers['ETHUSDT']?.price}
      />

      {/* Coordinator KPI Summary Strip */}
      <section
        aria-label="Master Coordinator Telemetry Summary"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <div className="rounded-xl border border-slate-800/90 bg-[#111827] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Qualified Coordinator Setups</span>
            <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
            {summary.qualifiedCount}
            <span className="ml-2 text-xs font-normal text-slate-400">
              / {summary.totalEvaluatedSetups} evaluated
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400 font-mono tabular-nums">
            Gate: &ge;{filters.minConfidence}% Conf · &ge;1:{filters.minRiskReward.toFixed(1)} R:R
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-[#111827] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Breakout / Breakdown Scanners</span>
            <BarChart3 className="h-4 w-4 text-[#3b82f6]" aria-hidden="true" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
            {summary.breakoutCount}{' '}
            <span className="text-xs font-semibold text-emerald-400">BO</span>
            <span className="mx-1.5 text-slate-600">/</span>
            {summary.breakdownCount}{' '}
            <span className="text-xs font-semibold text-rose-400">BD</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400 font-mono tabular-nums">
            {summary.scannerTelemetry.scannedPairs} pairs ·{' '}
            {summary.scannerTelemetry.filteredFakeouts} fakeouts gated
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-[#111827] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>SMC &amp; FRVP Liquidity</span>
            <Layers className="h-4 w-4 text-cyan-400" aria-hidden="true" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
            {summary.smcFrvpQualifiedCount}
            <span className="ml-2 text-xs font-normal text-cyan-300">
              ({summary.hvnConfirmedCount} HVN Confirmed)
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            POC &amp; High-Volume Node zone alignment active
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-[#111827] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Execution Sync &amp; PnL</span>
            <Activity className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums flex items-baseline gap-2">
            <span className="text-white">{openPositionsCount} Open</span>
            <span
              className={`text-sm font-semibold ${
                liveCrossMargin.unrealizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {liveCrossMargin.unrealizedPnlUsd >= 0 ? '+' : ''}$
              {liveCrossMargin.unrealizedPnlUsd.toFixed(2)}
            </span>
          </div>
          <div className="mt-1 text-[11px] font-mono tabular-nums text-slate-400">
            Mode:{' '}
            <span
              className={
                !testnetExecutionEnabled && executionState.mode === 'TESTNET'
                  ? 'text-amber-300 font-semibold'
                  : 'text-emerald-400 font-semibold'
              }
            >
              {!testnetExecutionEnabled && executionState.mode === 'TESTNET'
                ? 'TESTNET PAUSED'
                : executionState.mode}
            </span>{' '}
            · Equity ${liveCrossMargin.crossEquityUsd.toLocaleString()}
          </div>
        </div>
      </section>

      {/* Strict Coordinator Filtering Toolbar */}
      <section
        aria-label="Coordinator Signal Filters"
        className="rounded-xl border border-slate-800/90 bg-[#111827] p-4 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-white">
            <Sliders className="h-3.5 w-3.5 text-[#3b82f6]" aria-hidden="true" />
            <span>Coordinator Threshold &amp; Pattern Filters</span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filters.topGainersOnly}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, topGainersOnly: e.target.checked }))
                }
                className="h-3.5 w-3.5 rounded border-slate-600 bg-[#0d1323] text-[#3b82f6]"
              />
              <span>Top Gainers Only</span>
            </label>

            <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filters.excludeVetoed}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, excludeVetoed: e.target.checked }))
                }
                className="h-3.5 w-3.5 rounded border-slate-600 bg-[#0d1323] text-[#3b82f6]"
              />
              <span>Hide Skeptic VETOED</span>
            </label>

            {!isDefaultFilter && (
              <button
                type="button"
                onClick={() => setFilters(DEFAULT_MASTER_SIGNAL_FILTERS)}
                className="rounded-md border border-slate-700 bg-[#0d1323] px-2.5 py-1 text-[11px] font-semibold text-blue-300 hover:border-[#3b82f6] cursor-pointer whitespace-nowrap"
              >
                Reset Strict (&ge;86%)
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6 text-xs">
          <div>
            <label
              htmlFor="filter-confidence"
              className="block text-[11px] text-slate-400 mb-1"
            >
              Min Confidence
            </label>
            <select
              id="filter-confidence"
              value={filters.minConfidence}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, minConfidence: Number(e.target.value) }))
              }
              className="w-full rounded-lg border border-slate-700 bg-[#0d1323] px-2.5 py-2 text-xs text-white font-mono focus:border-[#3b82f6] focus:outline-none"
            >
              <option value={86}>&ge; 86% (Master Default)</option>
              <option value={80}>&ge; 80% (High)</option>
              <option value={75}>&ge; 75% (Expanded)</option>
              <option value={90}>&ge; 90% (Institutional)</option>
              <option value={92}>&ge; 92% (Ultra Strict)</option>
            </select>
          </div>

          <div>
            <label htmlFor="filter-rr" className="block text-[11px] text-slate-400 mb-1">
              Min Risk : Reward
            </label>
            <select
              id="filter-rr"
              value={filters.minRiskReward}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, minRiskReward: Number(e.target.value) }))
              }
              className="w-full rounded-lg border border-slate-700 bg-[#0d1323] px-2.5 py-2 text-xs text-white font-mono focus:border-[#3b82f6] focus:outline-none"
            >
              <option value={1.5}>&ge; 1:1.5 R:R</option>
              <option value={2}>&ge; 1:2.0 R:R (Default)</option>
              <option value={3}>&ge; 1:3.0 R:R</option>
              <option value={5}>&ge; 1:5.0 R:R (SMC Target)</option>
            </select>
          </div>

          <div>
            <label htmlFor="filter-module" className="block text-[11px] text-slate-400 mb-1">
              Coordinator Module
            </label>
            <select
              id="filter-module"
              value={filters.moduleFilter}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  moduleFilter: e.target.value as MasterModuleFilter,
                }))
              }
              className="w-full rounded-lg border border-slate-700 bg-[#0d1323] px-2.5 py-2 text-xs text-white focus:border-[#3b82f6] focus:outline-none"
            >
              <option value="ALL">All Coordinator Modules</option>
              <option value="SMC_FRVP">SMC + FRVP Nodes</option>
              <option value="PATTERN_SCANNER">Pattern Scanners</option>
              <option value="AI_ENGINE">AI Engine</option>
            </select>
          </div>

          <div>
            <label htmlFor="filter-move" className="block text-[11px] text-slate-400 mb-1">
              Move Type
            </label>
            <select
              id="filter-move"
              value={filters.moveFilter}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  moveFilter: e.target.value as MasterMoveFilter,
                }))
              }
              className="w-full rounded-lg border border-slate-700 bg-[#0d1323] px-2.5 py-2 text-xs text-white focus:border-[#3b82f6] focus:outline-none"
            >
              <option value="ALL">All Moves</option>
              <option value="BREAKOUT">Breakouts Only</option>
              <option value="BREAKDOWN">Breakdowns Only</option>
            </select>
          </div>

          <div>
            <label htmlFor="filter-direction" className="block text-[11px] text-slate-400 mb-1">
              Direction Bias
            </label>
            <select
              id="filter-direction"
              value={filters.directionFilter}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  directionFilter: e.target.value as MasterDirectionFilter,
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
            <label htmlFor="filter-timeframe" className="block text-[11px] text-slate-400 mb-1">
              Scan Timeframe
            </label>
            <select
              id="filter-timeframe"
              value={signalTimeframe}
              onChange={(e) => setSignalTimeframe(e.target.value as Timeframe)}
              className="w-full rounded-lg border border-slate-700 bg-[#0d1323] px-2.5 py-2 text-xs text-white font-mono focus:border-[#3b82f6] focus:outline-none"
            >
              {TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>
                  {tf.toUpperCase()} Candles
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Synchronous Feedback Banner (after execution or Telegram action) */}
      {feedback && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
            feedback.ok
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
          }`}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-300 hover:text-white cursor-pointer whitespace-nowrap"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Qualified High-Confidence Coordinator Setups Grid */}
      <section aria-label="Qualified Coordinator Signals" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-white tracking-tight">
            Coordinator Evaluated Setups ({qualifiedSetups.length})
          </h2>
          <span className="text-xs font-mono text-slate-400 tabular-nums">
            Timeframe: {signalTimeframe.toUpperCase()} · Filter: &ge;{filters.minConfidence}% Conf · &ge;1:
            {filters.minRiskReward.toFixed(1)} R:R
          </span>
        </div>

        {qualifiedSetups.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-[#111827] p-8 text-center space-y-3">
            <ShieldAlert className="mx-auto h-7 w-7 text-amber-400" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-white">
              No setups currently meet strict &ge;{filters.minConfidence}% Confidence &amp; &ge;1:
              {filters.minRiskReward.toFixed(1)} R:R filters
            </h3>
            <p className="text-xs text-slate-400 max-w-xl mx-auto">
              The Coordinator evaluated {summary.totalEvaluatedSetups} cross-market structures across{' '}
              {summary.scannerTelemetry.scannedPairs} pairs ({summary.scannerTelemetry.filteredFakeouts}{' '}
              fakeouts gated). Adjust thresholds temporarily or rescan markets to inspect lower-tier candidates.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() =>
                  setFilters((prev) => ({
                    ...prev,
                    minConfidence: 75,
                    minRiskReward: 1.5,
                    moduleFilter: 'ALL',
                    moveFilter: 'ALL',
                  }))
                }
                className="rounded-lg bg-[#3b82f6] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 cursor-pointer whitespace-nowrap"
              >
                Show Expanded Candidates (&ge;75%)
              </button>
              <button
                type="button"
                onClick={() => runSharedSignalScan(signalTimeframe)}
                className="rounded-lg border border-slate-700 bg-[#0d1323] px-4 py-2 text-xs font-semibold text-slate-200 hover:border-[#3b82f6] cursor-pointer whitespace-nowrap"
              >
                Rescan Markets Now
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {qualifiedSetups.map((setup) => {
              const isBuy = setup.direction === 'BUY';
              const executionPaused =
                !testnetExecutionEnabled && executionState.mode === 'TESTNET';
              const vetoed = setup.plan.skeptic.verdict === 'VETOED';
              const disableExec = executionPaused || vetoed || executingId === setup.id;
              const moduleLabel =
                setup.sourceModule === 'SMC_FRVP'
                  ? 'SMC · FRVP'
                  : setup.sourceModule === 'PATTERN_SCANNER'
                  ? `PATTERN · ${setup.moveType}`
                  : setup.moveType === 'BREAKOUT' || setup.moveType === 'BREAKDOWN'
                  ? `AI · ${setup.moveType}`
                  : 'AI COORDINATOR';

              return (
                <article
                  key={setup.id}
                  data-testid={`master-signal-card-${setup.symbol}-${setup.sourceModule}`}
                  className="rounded-xl border border-slate-800/90 bg-[#111827] p-5 flex flex-col justify-between gap-4 hover:border-slate-700 transition-colors"
                >
                  <div className="space-y-4">
                    {/* Card Header Row */}
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                          <span className="font-semibold text-blue-300">{moduleLabel}</span>
                          {setup.isTopGainer && (
                            <>
                              <span className="text-slate-600" aria-hidden="true">
                                ·
                              </span>
                              <span className="text-amber-300 font-semibold">
                                TOP GAINER #{setup.gainerRank ?? ''}
                                {setup.change24hPercent !== null
                                  ? ` (+${setup.change24hPercent.toFixed(1)}%)`
                                  : ''}
                              </span>
                            </>
                          )}
                          <span className="text-slate-600" aria-hidden="true">
                            ·
                          </span>
                          <span
                            className={
                              setup.plan.skeptic.verdict === 'APPROVED'
                                ? 'text-emerald-400'
                                : setup.plan.skeptic.verdict === 'CAUTION'
                                ? 'text-amber-300'
                                : 'text-rose-400'
                            }
                          >
                            Skeptic: {setup.plan.skeptic.verdict}
                          </span>
                        </div>
                        <div className="mt-1 flex items-baseline gap-2">
                          <h3 className="font-display text-xl font-bold text-white tracking-tight">
                            {setup.symbol}
                          </h3>
                          <span className="text-xs text-slate-400">{setup.coinName}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 font-mono tabular-nums shrink-0">
                        <span
                          className={`rounded-md px-2.5 py-1 text-xs font-bold ${
                            isBuy
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                          }`}
                        >
                          {isBuy ? 'LONG' : 'SHORT'}
                        </span>
                        <div className="text-right">
                          <div className="text-sm font-bold text-white">{setup.confidence}%</div>
                          <div className="text-[10px] text-slate-400">
                            1:{setup.maxRiskReward.toFixed(1)} R:R
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Execution Price & ATR Trailing Levels */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 rounded-lg border border-slate-800/80 bg-[#0d1323] p-3 font-mono text-xs tabular-nums">
                      <div>
                        <span className="block text-[10px] text-slate-400">ENTRY</span>
                        <span className="font-bold text-white">
                          ${formatCryptoPrice(setup.entryPrice)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-400">ATR TRAIL SL</span>
                        <span className="font-bold text-amber-300">
                          ${formatCryptoPrice(setup.trailingStopLoss)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-400">TP1 / TP2</span>
                        <span className="font-semibold text-emerald-300">
                          ${formatCryptoPrice(setup.takeProfits[0])} / $
                          {formatCryptoPrice(setup.takeProfits[1])}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-400">TP3 TARGET</span>
                        <span className="font-bold text-emerald-400">
                          ${formatCryptoPrice(setup.takeProfits[2])}
                        </span>
                      </div>
                    </div>

                    {/* Embedded SMC + FRVP Institutional Liquidity Telemetry */}
                    {setup.smc && setup.frvp && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 rounded-lg border border-slate-800/80 bg-[#0a0e1a] p-3 text-xs">
                        <div className="space-y-1">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            Smart Money Concepts (SMC)
                          </div>
                          <div className="text-slate-200 font-mono text-[11px] tabular-nums">
                            {setup.smc.bias} {setup.smc.lastEvent} · {setup.smc.zoneLabel}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Sweep:{' '}
                            <span
                              className={
                                setup.smc.sweepDetected ? 'text-emerald-300' : 'text-slate-300'
                              }
                            >
                              {setup.smc.sweepType}
                            </span>{' '}
                            · {setup.smc.sessionLabel}
                          </div>
                        </div>

                        <div className="space-y-1 font-mono tabular-nums">
                          <div className="text-[10px] font-sans font-semibold uppercase tracking-wider text-slate-400">
                            FRVP Volume Profile
                          </div>
                          <div className="text-cyan-300 text-[11px]">
                            POC ${formatCryptoPrice(setup.frvp.poc)} · {setup.frvp.priceZone} Zone
                          </div>
                          <div className="text-[11px] text-slate-400">
                            VAL ${formatCryptoPrice(setup.frvp.val)} – VAH $
                            {formatCryptoPrice(setup.frvp.vah)} ·{' '}
                            <span
                              className={
                                setup.frvp.institutionalLiquidityConfirmed
                                  ? 'text-emerald-300'
                                  : 'text-slate-300'
                              }
                            >
                              {setup.frvp.hvnCount} HVN / {setup.frvp.lvnCount} LVN
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Pattern Scanner Verification Note (if Breakout / Breakdown) */}
                    {setup.pattern && (
                      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-[11px] text-blue-200">
                        <span className="font-semibold text-white">
                          {setup.pattern.patternName} ({setup.pattern.moveType}):
                        </span>{' '}
                        {setup.pattern.summary}
                      </div>
                    )}

                    {/* Synchronous Active Position Status Strip */}
                    {setup.activePosition && (
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-mono tabular-nums">
                        <span className="text-emerald-300 font-semibold">
                          SYNCHRONIZED {setup.activePosition.status} POSITION ({setup.activePosition.direction})
                        </span>
                        <span className="text-slate-200">
                          Entry ${formatCryptoPrice(setup.activePosition.entryPrice)} ·{' '}
                          {setup.activePosition.marketType === 'USD_M_FUTURES'
                            ? `${setup.activePosition.leverage ?? 1}x Futures`
                            : 'Spot 1x'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Card Action Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                    <div className="text-[11px] text-slate-400 font-mono">
                      {setup.plan.marketType === 'USD_M_FUTURES'
                        ? `${setup.plan.futuresMargin.leverage}x ${setup.plan.futuresMargin.marginMode} · $${setup.plan.futuresMargin.notionalUsd}`
                        : `SPOT 1x · $${setup.plan.futuresMargin.notionalUsd} Principal`}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleOpenChart(setup.symbol)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0d1323] px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-[#3b82f6] hover:text-white cursor-pointer whitespace-nowrap"
                      >
                        <LineChart className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Chart</span>
                      </button>

                      <button
                        type="button"
                        disabled={routingId === setup.id}
                        onClick={() => handleDispatchTelegram(setup)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0d1323] px-2.5 py-1.5 text-xs font-semibold text-blue-300 hover:border-blue-400 disabled:opacity-60 cursor-pointer whitespace-nowrap"
                      >
                        {routedSuccessIds[setup.id] ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                        ) : (
                          <Send className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        <span>
                          {routingId === setup.id
                            ? 'Sending...'
                            : routedSuccessIds[setup.id]
                            ? 'Sent to TG'
                            : 'Telegram'}
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={disableExec}
                        onClick={() => handleExecuteTrade(setup)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#3b82f6] px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-400 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                      >
                        <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>
                          {executionPaused
                            ? 'Testnet Paused'
                            : vetoed
                            ? 'Skeptic Vetoed'
                            : executingId === setup.id
                            ? 'Executing...'
                            : `Execute ${setup.plan.marketType === 'USD_M_FUTURES' ? 'Futures' : 'Spot 1x'}`}
                        </span>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Synchronous Live Execution Ledger (Full Width for Uncluttered Telemetry) */}
      <div id="execution-ledger" className="scroll-mt-20">
        <LiveTestnetLedger candlesMap={liveCandlesMap} />
      </div>

      {/* Dedicated Sentinel Agent & Multi-Exchange L2 Order Book Depth */}
      <SentinelAgentPanel />
      <AutonomousOperationsHub />
      <OrderBookDepthPanel />

      {/* Real-Time Binance Top Gainers Feeder & Surge Alerts */}
      <section
        aria-label="Top Gainers Real-Time Alerts"
        className="rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 bg-[#0d1323] px-5 py-3.5">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Flame className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              <span className="font-mono font-semibold text-amber-300">
                {gainerSource === 'binance' ? 'BINANCE SPOT FEEDER LIVE' : 'SCANNER CACHE'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{gainerAlerts.length} Surge Events</span>
            </div>
            <h2 className="mt-0.5 font-display text-lg font-bold text-white">
              Binance Top Gainers &amp; Real-Time Surge Alerts
            </h2>
          </div>
          <button
            type="button"
            onClick={() =>
              setFilters((prev) => ({
                ...prev,
                topGainersOnly: !prev.topGainersOnly,
              }))
            }
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
              filters.topGainersOnly
                ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
                : 'border-slate-700 bg-[#0a0e1a] text-slate-300 hover:border-slate-500'
            }`}
          >
            {filters.topGainersOnly ? 'Showing Top Gainers Only' : 'Filter Signals to Gainers'}
          </button>
        </div>

        <div className="p-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Live Momentum Leaders (24h Spot)
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {topGainers.slice(0, 6).map((g, idx) => (
                <div
                  key={g.symbol}
                  className="w-full flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#0d1323] px-3 py-2.5 hover:border-[#3b82f6] transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => handleOpenChart(g.symbol)}
                    className="min-w-0 text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-2 font-mono text-xs font-bold text-white">
                      <span className="text-amber-300">#{g.gainerRank || idx + 1}</span>
                      <span>{g.symbol}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      Vol ${(g.volume24hUsd / 1e6).toFixed(1)}M · Pre-Pump {g.prePumpScore ?? 72}
                    </div>
                  </button>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <div className="text-right font-mono text-xs tabular-nums">
                      <div className="font-semibold text-white">
                        ${formatCryptoPrice(g.price)}
                      </div>
                      <div className="text-emerald-400 font-bold">
                        +{g.change24hPercent.toFixed(2)}%
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        handleBuyGainerRoute(
                          g.symbol,
                          g.gainerRank || idx + 1,
                          g.prePumpScore,
                          g.dynamicLeverageCap,
                          g.wideTrailAtrMult
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-2 py-1 text-[11px] font-bold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                    >
                      <Zap className="h-3 w-3" aria-hidden="true" />
                      <span>BUY</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-5 space-y-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Real-Time Feeder Alerts ({gainerAlerts.length})
            </div>
            {gainerAlerts.length === 0 ? (
              <p className="text-xs text-slate-500">
                Monitoring Binance USDT pairs for +2.5% intra-session breakouts.
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {gainerAlerts.slice(0, 8).map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-lg border border-slate-800/80 bg-[#0a0e1a] px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2 font-mono tabular-nums">
                      <span className="font-bold text-white">
                        #{ev.gainerRank} {ev.symbol}
                      </span>
                      <span className="text-emerald-400 font-semibold">
                        +{ev.change24hPercent.toFixed(2)}%
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">{ev.reason}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

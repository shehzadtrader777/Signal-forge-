import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowDownRight, ArrowUpRight, CheckCircle2, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  fetchCoinCandles,
  formatCryptoPrice,
  type Candle,
  type Timeframe,
} from '../lib/marketData';
import {
  type BacktestStrategy,
  type BacktestWindowDays,
  type ComparativeWindowSummary,
  type EquityPoint,
  getGlobalPastSignalsHistory,
  runComparativeProtocolSuite,
  runSystematicWalkForwardReport,
} from '../lib/backtest';
import { useApp } from '../context/AppContext';
import { useRbacIdentity } from '../hooks/useRbacIdentity';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { TrustConsolePanel } from '../components/TrustConsolePanel';
import { ModularBacktestMatrixPanel } from '../components/ModularBacktestMatrixPanel';
import { buildBacktestResearchUniverse, validateHistoricalCoverage } from '../lib/backtestUniverse';
import { buildUnifiedSignalHistory } from '../lib/signalHistory';
import '../styles/forgeBacktesting.css';

const BAR_RADIUS: [number, number, number, number] = [6, 6, 0, 0];
const AREA_CHART_MARGIN = { top: 8, right: 12, left: 4, bottom: 0 };
const BAR_CHART_MARGIN = { top: 8, right: 12, left: 0, bottom: 0 };
const RECHARTS_TOOLTIP_STYLE = {
  backgroundColor: '#1B1E21',
  borderColor: '#8F704B',
  borderRadius: '8px',
  fontSize: '12px',
  color: '#f8fafc',
};
const formatEquityTick = (v: number | string) => `$${Number(v).toLocaleString()}`;

interface BacktestChartsProps {
  equityCurve: EquityPoint[];
  outcomeBreakdown: Array<{ name: string; count: number; fill: string }>;
  totalTrades: number;
  windowDays: BacktestWindowDays;
  strategy: BacktestStrategy;
  symbol: string;
  timeframe: Timeframe;
  riskRewardRatio: number;
  sessionFilter: string;
}

const BacktestCharts = memo(function BacktestCharts({
  equityCurve,
  outcomeBreakdown,
  totalTrades,
  windowDays,
  strategy,
  symbol,
  timeframe,
  riskRewardRatio,
  sessionFilter,
}: BacktestChartsProps) {
  const safeEquityDomain = useMemo<[number, number]>(() => {
    const vals = equityCurve.map((p) => p.equity).filter((n) => Number.isFinite(n));
    if (vals.length === 0) return [9000, 11000];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    if (Math.abs(max - min) < 1) {
      return [Math.max(0, Math.floor(min - 500)), Math.ceil(max + 500)];
    }
    const pad = (max - min) * 0.08;
    return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)];
  }, [equityCurve]);

  const strategyLabel =
    strategy === 'AUTONOMOUS_MASTER'
      ? 'Master Autonomous Coordinator'
      : strategy === 'SMC_1_5'
      ? 'SMC & FRVP'
      : strategy === 'PATTERN_SCANNER'
      ? 'Chart Pattern Breakout/Breakdown'
      : 'Technical Comparison';

  return (
    <ErrorBoundary title="Backtest Visualization Recovery">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8 min-w-0 rounded-xl border border-slate-800/90 bg-[#111827] p-5">
          <div className="mb-4">
            <h2 className="font-display text-lg font-bold text-white">
              Simulated Equity Curve · {windowDays}-Day Window ($10,000 Starting Capital)
            </h2>
            <p className="text-xs text-slate-400">
              {totalTrades} simulated {strategyLabel} trades over {windowDays} days on {symbol} ({timeframe}) · 1:
              {riskRewardRatio} R:R · {sessionFilter}
            </p>
          </div>
          <div className="h-72 w-full min-w-0">
            <ResponsiveContainer width="100%" height={288} minWidth={0} debounce={50}>
              <AreaChart data={equityCurve} margin={AREA_CHART_MARGIN}>
                <defs>
                  <linearGradient id="sfEquityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#D2A66A" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#D2A66A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="tradeLabel"
                  stroke="#64748b"
                  fontSize={11}
                  height={28}
                  minTickGap={24}
                />
                <YAxis
                  width={72}
                  stroke="#64748b"
                  fontSize={11}
                  domain={safeEquityDomain}
                  tickFormatter={formatEquityTick}
                />
                <Tooltip contentStyle={RECHARTS_TOOLTIP_STYLE} />
                <Area
                  type="monotone"
                  dataKey="equity"
                  stroke="#D2A66A"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#sfEquityGrad)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-4 min-w-0 rounded-xl border border-slate-800/90 bg-[#111827] p-5">
          <div className="mb-4">
            <h2 className="font-display text-lg font-bold text-white">
              Win vs Loss Distribution ({windowDays}D)
            </h2>
            <p className="text-xs text-slate-400">
              Outcome count across {totalTrades} executed setups (2% Max Risk · &ge;1:5 ATR Trail)
            </p>
          </div>
          <div className="h-72 w-full min-w-0">
            <ResponsiveContainer width="100%" height={288} minWidth={0} debounce={50}>
              <BarChart data={outcomeBreakdown} margin={BAR_CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} height={28} />
                <YAxis width={44} stroke="#64748b" fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={RECHARTS_TOOLTIP_STYLE} />
                <Bar dataKey="count" radius={BAR_RADIUS} isAnimationActive={false}>
                  {outcomeBreakdown.map((entry, idx) => (
                    <Cell key={entry.name || idx} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
});

function SparklineSnapshot({ points, isWin }: { points: number[]; isWin: boolean }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(max - min, 1e-9);
  const width = 96;
  const height = 28;
  const coords = points
    .map((p, idx) => {
      const x = (idx / (points.length - 1)) * width;
      const y = height - ((p - min) / span) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="inline-block overflow-visible"
      aria-label={isWin ? 'Winning signal price trajectory' : 'Losing signal price trajectory'}
    >
      <polyline
        fill="none"
        stroke={isWin ? '#10b981' : '#ef4444'}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={coords}
      />
    </svg>
  );
}

export function Backtesting() {
  const { tickers, futuresTelemetry, futuresFeedSource, wsConnected, allKnownCoins, topGainers, pinnedSignals, executionState } = useApp();
  const researchUniverse = useMemo(() => buildBacktestResearchUniverse(allKnownCoins, topGainers, Object.keys(tickers)), [allKnownCoins, topGainers, tickers]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTCUSDT');
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>('15m');
  const [selectedStrategy, setSelectedStrategy] = useState<BacktestStrategy>('AUTONOMOUS_MASTER');
  const [activeWindowDays, setActiveWindowDays] = useState<BacktestWindowDays>(30);
  const [simSeed, setSimSeed] = useState<{
    symbol: string;
    timeframe: Timeframe;
    strategy: BacktestStrategy;
  }>({
    symbol: 'BTCUSDT',
    timeframe: '15m',
    strategy: 'AUTONOMOUS_MASTER',
  });
  const [liveCandles, setLiveCandles] = useState<Candle[] | undefined>(undefined);
  const [feedSourceLabel, setFeedSourceLabel] = useState<'binance_futures' | 'cache'>('cache');
  const [syncingFeed, setSyncingFeed] = useState(false);
  const [historySource, setHistorySource] = useState<'SIMULATED' | 'GLOBAL'>('SIMULATED');
  const [coinSearch, setCoinSearch] = useState('');
  const filteredResearchUniverse = useMemo(() => researchUniverse.filter(c => `${c.symbol} ${c.name}`.toLowerCase().includes(coinSearch.trim().toLowerCase())), [researchUniverse, coinSearch]);
  const [showAllTrades, setShowAllTrades] = useState(false);

  const tickersRef = useRef(tickers);
  tickersRef.current = tickers;
  const futuresTelemetryRef = useRef(futuresTelemetry);
  futuresTelemetryRef.current = futuresTelemetry;

  const syncLiveFeedAndCandles = useCallback(
    async (symbol: string, timeframe: Timeframe) => {
      setSyncingFeed(true);
      try {
        const refPrice =
          tickersRef.current[symbol]?.price ?? futuresTelemetryRef.current[symbol]?.markPrice;
        const res = await fetchCoinCandles(symbol, timeframe, 360, refPrice);
        if (Array.isArray(res.candles) && res.candles.length >= 60) {
          const candlesWithMark = res.candles.slice();
          if (refPrice && Number.isFinite(refPrice)) {
            const last = candlesWithMark[candlesWithMark.length - 1];
            candlesWithMark[candlesWithMark.length - 1] = {
              ...last,
              close: refPrice,
              high: Math.max(last.high, refPrice),
              low: Math.min(last.low, refPrice),
            };
          }
          setLiveCandles(candlesWithMark);
          setFeedSourceLabel(res.source === 'cache' ? 'cache' : 'binance_futures');
        }
      } finally {
        setSyncingFeed(false);
      }
    },
    []
  );

  useEffect(() => {
    syncLiveFeedAndCandles(simSeed.symbol, simSeed.timeframe);
  }, [simSeed.symbol, simSeed.timeframe, syncLiveFeedAndCandles]);

  const historyCoverage = useMemo(() => validateHistoricalCoverage({
    symbol: simSeed.symbol,
    bars: liveCandles ?? [],
    windowDays: activeWindowDays,
    timeframeMinutes: ({'15m':15,'1h':60,'4h':240,'1d':1440} as const)[simSeed.timeframe],
    source: feedSourceLabel === 'binance_futures' ? 'binance' : 'cache',
  }), [simSeed.symbol, simSeed.timeframe, liveCandles, activeWindowDays, feedSourceLabel]);

  const liveWsPrice =
    tickers[simSeed.symbol]?.price ?? futuresTelemetry[simSeed.symbol]?.markPrice;

  // Comparative 30 / 60 / 90-Day Optimization Protocol Report (strictly 300–500 trades/window, 5% Max SL, 5x ATR Trail TP)
  const comparativeReport = useMemo(
    () =>
      runComparativeProtocolSuite({
        symbol: simSeed.symbol,
        timeframe: simSeed.timeframe,
        strategy: simSeed.strategy,
        providedCandles: liveCandles,
        liveWsPrice,
      }),
    [simSeed, liveCandles, liveWsPrice]
  );

  const [wfInSampleBars, setWfInSampleBars] = useState<number>(85);
  const [wfOutOfSampleBars, setWfOutOfSampleBars] = useState<number>(45);

  const simulation: ComparativeWindowSummary = useMemo(
    () =>
      comparativeReport.windows.find((w) => w.windowDays === activeWindowDays) ??
      comparativeReport.windows[0],
    [comparativeReport, activeWindowDays]
  );

  const walkForwardReport = useMemo(
    () =>
      runSystematicWalkForwardReport({
        symbol: simSeed.symbol,
        timeframe: simSeed.timeframe,
        providedCandles: liveCandles,
        inSampleBars: wfInSampleBars,
        outOfSampleBars: wfOutOfSampleBars,
        maxFolds: 4,
      }),
    [simSeed.symbol, simSeed.timeframe, liveCandles, wfInSampleBars, wfOutOfSampleBars]
  );

  const observedSignalAudit = useMemo(() => buildUnifiedSignalHistory({
    pinnedSignals,
    positions: executionState.positions,
    tickers,
    includeHistoricalBenchmarks: false,
    includeCrossStrategyBenchmarks: false,
  }), [pinnedSignals, executionState.positions, tickers]);
  const globalPastSignals = useMemo(() => getGlobalPastSignalsHistory(), []);
  const activeRows = historySource === 'SIMULATED' ? simulation.trades : globalPastSignals;
  const visibleRows = showAllTrades ? activeRows : activeRows.slice(0, 30);

  const handleRunBacktest = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowAllTrades(false);
    setSimSeed({
      symbol: selectedSymbol,
      timeframe: selectedTimeframe,
      strategy: selectedStrategy,
    });
    await syncLiveFeedAndCandles(selectedSymbol, selectedTimeframe);
  };

  const { rbac } = useRbacIdentity();
  const liveMark =
    liveWsPrice ?? simulation.latestMarkPrice ?? 0;

  return (
    <div className="forge-backtesting mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      <section aria-label="Backtesting guide" className="rounded-2xl border border-[#8f704b]/40 bg-[#171a1d] p-5 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#d9b77f]">SIGNAL FORGE · RESEARCH LAB</p>
        <h2 className="mt-2 font-display text-xl font-bold text-white">Understand every test before comparing results.</h2>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-300">A backtest replays a strategy on historical or simulated market conditions; it does not place an order. Use the 30, 60 and 90-day views to compare periods. Paper trading is a separate simulated trading workflow, not another name for a backtest.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <a href="#sf-backtest-comparison" className="rounded-xl border border-white/10 bg-white/5 p-4 hover:border-[#d9b77f]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9b77f]">
            <strong className="block text-sm text-white">01 · Compare periods</strong>
            <span className="mt-1 block text-xs leading-5 text-slate-400">Review 30 / 60 / 90-day returns, risk and win rate.</span>
          </a>
          <a href="#sf-backtest-charts" className="rounded-xl border border-white/10 bg-white/5 p-4 hover:border-[#d9b77f]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9b77f]">
            <strong className="block text-sm text-white">02 · Read the charts</strong>
            <span className="mt-1 block text-xs leading-5 text-slate-400">Inspect simulated equity and trade outcomes.</span>
          </a>
          <a href="#sf-backtest-advanced" className="rounded-xl border border-white/10 bg-white/5 p-4 hover:border-[#d9b77f]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9b77f]">
            <strong className="block text-sm text-white">03 · Advanced tests</strong>
            <span className="mt-1 block text-xs leading-5 text-slate-400">Open the independent 1,000-trade module when needed.</span>
          </a>
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-400">Displayed results are model outputs, not guaranteed outcomes. Verify historical candle coverage and data provenance before relying on a date-window label.</p>
      </section>

      {/* Page Header & Backtest Runner */}
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between border-b border-slate-800/80 pb-6">
        <div>
          <span className="text-xs text-slate-400">
            Live WS-Anchored Optimization Protocol ({wsConnected || feedSourceLabel === 'binance_futures' || futuresFeedSource === 'binance_futures' ? 'Binance Live Mark' : 'Deterministic Sync'} · {simSeed.symbol} ${formatCryptoPrice(liveMark)})
          </span>
          <h1 className="mt-1 font-display text-3xl font-bold text-white tracking-tight">
            30 / 60 / 90-Day Comparative Strategy Backtesting
          </h1>
          <p className="mt-1.5 text-sm text-slate-400 max-w-2xl">
            Enforces 300–500 trades per window, a strict 2.0% maximum risk limit per trade, a minimum 1:5 profit-to-loss ratio with ATR trailing stop-loss, and exits strictly upon structural trend reversal across 30-, 60-, and 90-day evaluations.
          </p>
        </div>

        <form
          onSubmit={handleRunBacktest}
          className="flex flex-wrap lg:flex-nowrap items-end gap-2.5 rounded-xl border border-slate-800 bg-[#111827] p-3.5 shrink-0"
        >
          <div>
            <label
              htmlFor="bt-strategy-select"
              className="block text-[11px] font-medium text-slate-400 mb-1"
            >
              Agent Strategy
            </label>
            <select
              id="bt-strategy-select"
              value={selectedStrategy}
              onChange={(e) => {
                const next = e.target.value as BacktestStrategy;
                setSelectedStrategy(next);
              }}
              className="rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 text-xs font-medium text-white focus:border-[#3b82f6] focus:outline-none"
            >
              <option value="AUTONOMOUS_MASTER">Master Autonomous Coordinator (2% Risk · 1:5+ ATR Trail)</option>
              <option value="SMC_1_5">SMC Agent &amp; FRVP (Liquidity Sweep · 1:5 Target)</option>
              <option value="PATTERN_SCANNER">Chart Pattern Breakout/Breakdown (ATR Trail)</option>
              <option value="TECHNICAL">Technical Comparison (Multi-Indicator)</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="bt-coin-select"
              className="block text-[11px] font-medium text-slate-400 mb-1"
            >
              Coin Pair
            </label>
            <input
              type="search"
              aria-label="Search all discovered market pairs"
              value={coinSearch}
              onChange={(e) => setCoinSearch(e.target.value)}
              placeholder="Search available market pairs"
              className="mb-1 w-full rounded-lg border border-slate-700 bg-[#0a0e1a] px-2 py-1.5 text-xs text-white"
            />
            <select
              id="bt-coin-select"
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 text-xs font-medium text-white focus:border-[#3b82f6] focus:outline-none"
            >
              {filteredResearchUniverse.map((c) => (
                <option key={c.symbol} value={c.symbol}>
                  {c.name} ({c.symbol}){c.origin === 'LIVE_MARKET' ? ' · live-discovered' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="bt-tf-select"
              className="block text-[11px] font-medium text-slate-400 mb-1"
            >
              Timeframe
            </label>
            <select
              id="bt-tf-select"
              value={selectedTimeframe}
              onChange={(e) => setSelectedTimeframe(e.target.value as Timeframe)}
              className="rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 font-mono text-xs font-medium text-white focus:border-[#3b82f6] focus:outline-none"
            >
              <option value="15m">15m</option>
              <option value="1h">1h</option>
              <option value="4h">4h</option>
              <option value="1d">1d</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={syncingFeed}
            className="inline-flex items-center gap-2 rounded-lg bg-[#3b82f6] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
          >
            {syncingFeed ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{syncingFeed ? 'Syncing Live Feed...' : 'Run 30/60/90D Comparative Suite'}</span>
          </button>
        </form>
      </div>

      <aside role="status" className="rounded-xl border border-amber-500/40 bg-amber-950/25 px-4 py-3 text-xs text-amber-100">
        <strong>Market universe: {researchUniverse.length} currently discovered pairs.</strong> Backtest availability depends on historical candle coverage, not the watchlist limit.
        {' '}For {simSeed.symbol} / {activeWindowDays} days: {historyCoverage.observedBars}/{historyCoverage.expectedBars} candles in the fetched window.
        {' '}<strong>{historyCoverage.verified ? 'Historical candle coverage verified (source and continuity)' : 'Insufficient independently verified coverage — comparative results may use simulated protocol candles.'}</strong>
        {' '}The Global History view is a generated benchmark sample, not a complete live signal audit.
      </aside>

      {/* Comparative 30 / 60 / 90-Day Protocol Matrix */}
      <section
        id="sf-backtest-comparison"
        aria-label="30 60 90 Day Comparative Backtest Matrix"
        className="rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
      >
        <div className="flex flex-col gap-3 border-b border-slate-800/80 bg-[#0d1323] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              <span className="font-mono font-semibold text-emerald-300">
                300–500 TRADES/PERIOD · 2.0% MAX RISK · MIN 1:5 P/L RATIO · REVERSAL EXITS
              </span>
            </div>
            <h2 className="mt-0.5 font-display text-lg font-bold text-white">
              Comparative Multi-Horizon Simulation Matrix ({simSeed.symbol})
            </h2>
          </div>

          <div
            role="group"
            aria-label="Select Active Simulation Window"
            className="inline-flex rounded-lg border border-slate-800 bg-[#0a0e1a] p-0.5 text-xs font-mono"
          >
            {([30, 60, 90] as const).map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => {
                  setActiveWindowDays(days);
                  setShowAllTrades(false);
                }}
                className={`rounded-md px-3 py-1.5 font-semibold transition-colors cursor-pointer ${
                  activeWindowDays === days
                    ? 'bg-[#3b82f6] text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Inspect {days}D
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono tabular-nums">
            <thead className="border-b border-slate-800 bg-[#0a0e1a] text-slate-400">
              <tr>
                <th className="px-4 py-3">Horizon Window</th>
                <th className="px-3 py-3 text-right">Trades (300–500)</th>
                <th className="px-3 py-3 text-right">Win Rate</th>
                <th className="px-3 py-3 text-right">Return %</th>
                <th className="px-3 py-3 text-right">Profit Factor</th>
                <th className="px-3 py-3 text-right">Max DD</th>
                <th className="px-3 py-3 text-right">Max SL Observed</th>
                <th className="px-3 py-3 text-right">5x ATR Exits</th>
                <th className="px-3 py-3 text-right">Reversal Exits</th>
                <th className="px-4 py-3 text-right">Sharpe Est.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {comparativeReport.windows.map((win) => {
                const isSelected = win.windowDays === activeWindowDays;
                const endEquity = win.equityCurve[win.equityCurve.length - 1]?.equity ?? 10000;
                return (
                  <tr
                    key={win.windowDays}
                    onClick={() => {
                      setActiveWindowDays(win.windowDays);
                      setShowAllTrades(false);
                    }}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-[#3b82f6]/10' : 'hover:bg-[#0d1323]/70'
                    }`}
                  >
                    <td className="px-4 py-3 font-bold text-white">
                      <div className="flex items-center gap-2">
                        <CheckCircle2
                          className={`h-3.5 w-3.5 ${
                            isSelected ? 'text-[#3b82f6]' : 'text-emerald-400'
                          }`}
                          aria-hidden="true"
                        />
                        <span>{win.windowDays}-Day Window</span>
                      </div>
                      <div className="text-[10px] font-normal text-slate-400 pl-5">
                        End Equity ${endEquity.toLocaleString()}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-white">
                      {win.totalTrades}{' '}
                      <span className="text-[10px] text-emerald-400">
                        ({win.tradesInProtocolRange ? 'Verified' : 'Out'})
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right text-slate-200">{win.winRate}%</td>
                    <td
                      className={`px-3 py-3 text-right font-bold ${
                        win.totalProfitPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {win.totalProfitPercent >= 0 ? '+' : ''}
                      {win.totalProfitPercent}%
                    </td>
                    <td className="px-3 py-3 text-right text-blue-300 font-semibold">
                      {win.profitFactor}x
                    </td>
                    <td className="px-3 py-3 text-right text-rose-400">
                      -{win.maxDrawdownPercent}%
                    </td>
                    <td className="px-3 py-3 text-right text-amber-300 font-semibold">
                      {win.maxStopLossPctObserved.toFixed(2)}% (&le;{win.maxStopLossPctAllowed}%)
                    </td>
                    <td className="px-3 py-3 text-right text-emerald-300">
                      {win.trailingTp5xAtrExits}
                    </td>
                    <td className="px-3 py-3 text-right text-cyan-300">
                      {win.structuralReversalExits}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-200">{win.sharpeEstimate}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* L3 Walk-Forward Validation (Frozen OOS Rolling Pairs) & L0–L2 Kernel Audit */}
      <section
        aria-label="L3 Walk-Forward Out-of-Sample Validation"
        data-testid="walk-forward-validation-panel"
        className="rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
      >
        <div className="flex flex-col gap-3 border-b border-slate-800/80 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-400">
              <span className="text-blue-400 font-semibold uppercase tracking-wider">
                L3 Walk-Forward Validation
              </span>
              <span>·</span>
              <span>Frozen Snapshot {walkForwardReport.frozenParamHash}</span>
              <span>·</span>
              <span>
                L2 Parity Gate{' '}
                <strong
                  className={
                    walkForwardReport.parityGate.passed ? 'text-emerald-400' : 'text-rose-400'
                  }
                >
                  {walkForwardReport.parityGate.status}
                </strong>
              </span>
              <span>·</span>
              <span>
                OOS Gate{' '}
                <strong
                  className={walkForwardReport.overallPassed ? 'text-emerald-400' : 'text-amber-300'}
                >
                  {walkForwardReport.overallPassed ? 'LIVE_ELIGIBLE' : 'REVIEW_REQUIRED'}
                </strong>
              </span>
            </div>
            <h2 className="mt-1 font-display text-lg font-bold text-white">
              Out-of-Sample Rolling Fold Verification ({walkForwardReport.symbol} {walkForwardReport.timeframe})
            </h2>
            <p className="text-xs text-slate-400">
              Evaluated strictly via L1 Point-in-Time closed cursors with zero OOS re-tuning · Enforces RRGate &ge; 1:5.0, Structural ATR Stop &le; 2.0%, Monotonic Trail, and &gt; 3.0R Regime Scaling.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1.5 text-slate-300">
              <span className="text-slate-400">IS Bars</span>
              <select
                value={wfInSampleBars}
                onChange={(e) => setWfInSampleBars(Number(e.target.value))}
                className="rounded-lg border border-slate-700 bg-[#0d1323] px-2.5 py-1.5 font-mono text-white focus:border-blue-500 focus:outline-none"
              >
                <option value={65}>65</option>
                <option value={85}>85</option>
                <option value={105}>105</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-slate-300">
              <span className="text-slate-400">OOS Bars</span>
              <select
                value={wfOutOfSampleBars}
                onChange={(e) => setWfOutOfSampleBars(Number(e.target.value))}
                className="rounded-lg border border-slate-700 bg-[#0d1323] px-2.5 py-1.5 font-mono text-white focus:border-blue-500 focus:outline-none"
              >
                <option value={35}>35</option>
                <option value={45}>45</option>
                <option value={60}>60</option>
              </select>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 divide-y divide-slate-800/80 border-b border-slate-800/80 sm:grid-cols-5 sm:divide-x sm:divide-y-0 bg-[#0d1323]">
          <div className="px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Rolling Folds</div>
            <div className="mt-1 font-mono text-base font-bold tabular-nums text-white">
              {walkForwardReport.foldCount} Folds · {walkForwardReport.aggregateOosTrades} OOS
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">OOS Win Rate</div>
            <div className="mt-1 font-mono text-base font-bold tabular-nums text-white">
              {walkForwardReport.aggregateOosWinRatePct.toFixed(1)}%
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">OOS Expectancy</div>
            <div
              className={`mt-1 font-mono text-base font-bold tabular-nums ${
                walkForwardReport.aggregateOosExpectancyR >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {walkForwardReport.aggregateOosExpectancyR >= 0 ? '+' : ''}
              {walkForwardReport.aggregateOosExpectancyR.toFixed(3)}R
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">OOS Profit Factor</div>
            <div className="mt-1 font-mono text-base font-bold tabular-nums text-blue-300">
              {walkForwardReport.aggregateOosProfitFactor.toFixed(2)}x
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Max OOS Drawdown</div>
            <div className="mt-1 font-mono text-base font-bold tabular-nums text-amber-300">
              -{walkForwardReport.aggregateOosMaxDrawdownPct.toFixed(2)}%
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono tabular-nums">
            <thead>
              <tr className="border-b border-slate-800 bg-[#0d1323] text-slate-400 font-sans">
                <th className="px-4 py-2.5 font-medium">Fold</th>
                <th className="px-3 py-2.5 font-medium">IS Train &rarr; OOS Test Bars</th>
                <th className="px-3 py-2.5 font-medium text-right">IS WR% &rarr; OOS WR%</th>
                <th className="px-3 py-2.5 font-medium text-right">OOS Exp (R)</th>
                <th className="px-3 py-2.5 font-medium text-right">OOS PF</th>
                <th className="px-3 py-2.5 font-medium text-right">OOS Return</th>
                <th className="px-3 py-2.5 font-medium text-right">Friction</th>
                <th className="px-3 py-2.5 font-medium text-right">&gt;3R Scales</th>
                <th className="px-4 py-2.5 font-medium text-right">Frozen Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {walkForwardReport.folds.map((fold) => (
                <tr key={fold.foldIndex} className="hover:bg-slate-800/30">
                  <td className="px-4 py-2.5 font-semibold text-white">
                    Pair #{fold.foldIndex}
                  </td>
                  <td className="px-3 py-2.5 text-slate-300">
                    [{fold.inSampleRange.startBar}..{fold.inSampleRange.endBar}] &rarr; [
                    {fold.outOfSampleRange.startBar}..{fold.outOfSampleRange.endBar}]
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-200">
                    {fold.inSampleWinRatePct.toFixed(1)}% &rarr;{' '}
                    <span className="text-white font-semibold">
                      {fold.oosWinRatePct.toFixed(1)}%
                    </span>
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-semibold ${
                      fold.oosExpectancyR >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {fold.oosExpectancyR >= 0 ? '+' : ''}
                    {fold.oosExpectancyR.toFixed(3)}R
                  </td>
                  <td className="px-3 py-2.5 text-right text-blue-300">
                    {fold.oosProfitFactor.toFixed(2)}x
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-semibold ${
                      fold.oosNetReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {fold.oosNetReturnPct >= 0 ? '+' : ''}
                    {fold.oosNetReturnPct.toFixed(2)}%
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-300">
                    {fold.oosAvgFrictionBps.toFixed(1)} bps
                  </td>
                  <td className="px-3 py-2.5 text-right text-cyan-300">
                    {fold.scalingAbove3RExits} ({fold.monotonicStopsHeldCount} mono)
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-400">
                    {fold.frozenParamHash}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* L4 PG_v4 14-Conjunct Certification Gate & Test Console (RBAC-Protected: Admin / Super Admin Only) */}
      {rbac.canAccessTestConsole && <TrustConsolePanel initialSymbol={simSeed.symbol} />}

      {/* Active Window Backtest KPI Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800/90 bg-[#111827] p-5">
          <span className="text-xs text-slate-400">
            {simulation.windowDays}-Day Trades · Max SL Cap
          </span>
          <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-white">
            {simulation.totalTrades}{' '}
            <span className="text-sm font-semibold text-amber-300">
              · {simulation.maxStopLossPctObserved.toFixed(2)}% SL Max
            </span>
          </p>
          <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-400">
            {simulation.avgTradesPerDay} trades/day · Cap &le; {simulation.maxStopLossPctAllowed}%
          </p>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-[#111827] p-5">
          <span className="text-xs text-slate-400">Win Rate &amp; Expectancy</span>
          <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-white">
            {simulation.winRate}%{' '}
            <span
              className={`text-sm font-semibold ${
                simulation.expectancyR >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              ({simulation.expectancyR >= 0 ? '+' : ''}
              {simulation.expectancyR}R/trade)
            </span>
          </p>
          <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-400">
            <span className="text-emerald-400">{simulation.wins}W</span>
            <span className="mx-1 text-slate-600">/</span>
            <span className="text-rose-400">{simulation.losses}L</span> ·{' '}
            {simulation.trailingTp5xAtrExits} 5x ATR Trail Exits
          </p>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-[#111827] p-5">
          <span className="text-xs text-slate-400">{simulation.windowDays}-Day Cumulative Return</span>
          <p
            className={`mt-2 font-mono text-2xl font-bold tabular-nums ${
              simulation.totalProfitPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {simulation.totalProfitPercent >= 0 ? '+' : ''}
            {simulation.totalProfitPercent}%
          </p>
          <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-400">
            End Equity: $
            {simulation.equityCurve[simulation.equityCurve.length - 1]?.equity.toLocaleString(
              'en-US',
              { minimumFractionDigits: 2, maximumFractionDigits: 2 }
            )}
          </p>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-[#111827] p-5">
          <span className="text-xs text-slate-400">Profit Factor · Reversal Exits</span>
          <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-[#3b82f6]">
            {simulation.profitFactor}x{' '}
            <span className="text-sm font-normal text-rose-400">
              (-{simulation.maxDrawdownPercent}%)
            </span>
          </p>
          <p className="mt-1 text-[11px] text-slate-400 font-mono">
            {simulation.structuralReversalExits} structural reversals · Sharpe {simulation.sharpeEstimate}
          </p>
        </div>
      </div>

      {/* Recharts Visualizations (Memoized & Fixed-Axis Dimensions) */}
      <div id="sf-backtest-charts" className="scroll-mt-8">
      <BacktestCharts
        equityCurve={simulation.equityCurve}
        outcomeBreakdown={simulation.outcomeBreakdown}
        totalTrades={simulation.totalTrades}
        windowDays={simulation.windowDays}
        strategy={simulation.strategy}
        symbol={simulation.symbol}
        timeframe={simulation.timeframe}
        riskRewardRatio={simulation.riskRewardRatio}
        sessionFilter={simulation.sessionFilter}
      />
      </div>

      {/* Advanced matrix remains independent of the 30/60/90-day comparative suite. */}
      <details id="sf-backtest-advanced" className="group rounded-2xl border border-[#8f704b]/30 bg-[#111827] scroll-mt-8">
        <summary className="cursor-pointer list-none rounded-2xl px-5 py-4 font-semibold text-[#e2c59b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9b77f]">
          Advanced · 1,000-Trade Multi-Horizon Matrix <span className="ml-2 text-xs font-normal text-slate-400">Select to expand</span>
        </summary>
        <div className="px-2 pb-4 sm:px-4">
          <p className="mb-3 px-2 text-xs leading-5 text-slate-400">Independent advanced strategy/optimizer research. Its assumptions and totals should not be mixed with the 30/60/90-day comparative suite.</p>
          <ModularBacktestMatrixPanel symbol={simSeed.symbol} />
        </div>
      </details>

      <section aria-label="Observed signal audit (not simulated)" className="rounded-xl border border-[#8f704b]/35 bg-[#111827] p-4 sm:p-5">
        <h2 className="font-display text-lg font-bold text-white">Observed Signal Audit · Pinned Signals &amp; Orders</h2>
        <p className="mt-1 text-xs text-slate-400">
          {observedSignalAudit.length} locally retained observed records, excluding generated benchmark results.
          This is not yet a complete server-persisted all-market archive; missing emitted signals cannot be reconstructed.
        </p>
        <div className="mt-3 max-h-64 overflow-auto">
          {observedSignalAudit.length === 0 ? (
            <p className="rounded-lg border border-slate-700 px-3 py-3 text-xs text-amber-200">No observed records in the current application state. Simulated backtest history is shown separately below.</p>
          ) : (
            <table className="w-full min-w-[540px] text-left text-xs">
              <thead><tr className="border-b border-slate-700 text-slate-400">
                <th className="py-2">Time</th><th>Pair</th><th>Source</th><th>Status</th><th className="text-right">Entry</th>
              </tr></thead>
              <tbody>{observedSignalAudit.map(record => (
                <tr key={record.id} className="border-b border-slate-800 text-slate-200">
                  <td className="py-2 font-mono">{record.timestamp}</td>
                  <td className="font-semibold">{record.symbol}</td>
                  <td>{record.origin === 'LIVE_PINNED' ? 'Pinned Signal' : 'Execution Record'}</td>
                  <td>{record.status}</td>
                  <td className="text-right font-mono">${formatCryptoPrice(record.entryPrice)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </section>

      {/* Past Signals History Table */}
      <section
        aria-label="Past Signals History"
        className="rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
      >
        <div className="flex flex-col gap-3 border-b border-slate-800/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-white">
              Executed Signals Log &amp; 5x ATR Trailing Risk Audit ({simulation.windowDays}D Window)
            </h2>
            <p className="text-xs text-slate-400">
              Showing {visibleRows.length} of {activeRows.length} audited setups with entry, exit, risk% (&le;2%), and trailing/reversal trigger
            </p>
          </div>

          <div className="inline-flex rounded-lg border border-slate-800 bg-[#0a0e1a] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => {
                setHistorySource('SIMULATED');
                setShowAllTrades(false);
              }}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors cursor-pointer ${
                historySource === 'SIMULATED'
                  ? 'bg-[#3b82f6] text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {simulation.windowDays}D Simulation ({simulation.trades.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setHistorySource('GLOBAL');
                setShowAllTrades(false);
              }}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors cursor-pointer ${
                historySource === 'GLOBAL'
                  ? 'bg-[#3b82f6] text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Simulated Cross-Pair Benchmark ({globalPastSignals.length})
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-[#0d1323] text-slate-400">
                <th className="px-3 py-2.5 font-medium whitespace-nowrap">Time (UTC)</th>
                <th className="px-3 py-2.5 font-medium whitespace-nowrap">Pair</th>
                <th className="px-3 py-2.5 font-medium whitespace-nowrap">Side</th>
                <th className="px-3 py-2.5 font-medium whitespace-nowrap">Zone / Setup</th>
                <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">Entry</th>
                <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">Exit</th>
                <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">SL% (&le;2%)</th>
                <th className="px-3 py-2.5 font-medium whitespace-nowrap">Exit Trigger</th>
                <th className="px-3 py-2.5 font-medium text-center whitespace-nowrap">Snapshot</th>
                <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">Result</th>
                <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">P&amp;L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {visibleRows.map((row) => {
                const isBuy = row.direction === 'BUY';
                const isWin = row.result === 'WIN';
                const exitReasonText =
                  row.exitReason === 'TRAILING_TP_5X_ATR'
                    ? '1:5+ ATR Trail TP'
                    : row.exitReason === 'STRUCTURAL_REVERSAL'
                    ? 'Trend Reversal'
                    : row.exitReason === 'STOP_LOSS_CAP_5PCT'
                    ? '2% Risk Stop'
                    : 'Target Exit';
                return (
                  <tr key={row.id} className="hover:bg-slate-800/30">
                    <td className="px-3 py-2.5 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                      {row.date}
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-white whitespace-nowrap">
                      <span className="font-mono">{row.symbol}</span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 font-semibold ${
                          isBuy ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {isBuy ? (
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {row.direction}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">
                      {row.retestStatus || 'Technical Signal'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-200 whitespace-nowrap">
                      ${formatCryptoPrice(row.entryPrice)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-200 whitespace-nowrap">
                      ${formatCryptoPrice(row.exitPrice)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-amber-300 whitespace-nowrap">
                      {row.stopLossPct !== undefined ? `${row.stopLossPct.toFixed(2)}%` : '2.00%'}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-cyan-300 whitespace-nowrap">
                      {exitReasonText}
                    </td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      <SparklineSnapshot points={row.snapshotPoints} isWin={isWin} />
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                      <span className={isWin ? 'text-emerald-400' : 'text-rose-400'}>
                        {row.result}
                      </span>
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-mono font-bold tabular-nums whitespace-nowrap ${
                        row.profitPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {row.pnlR >= 0 ? '+' : ''}
                      {row.pnlR}R ({row.profitPercent >= 0 ? '+' : ''}
                      {row.profitPercent}%)
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {activeRows.length > 30 && (
          <div className="border-t border-slate-800/80 px-5 py-3 flex items-center justify-between text-xs text-slate-400">
            <span>
              Displaying {visibleRows.length} of {activeRows.length} simulated trades
            </span>
            <button
              type="button"
              onClick={() => setShowAllTrades((prev) => !prev)}
              className="font-semibold text-[#3b82f6] hover:text-blue-400 transition-colors cursor-pointer"
            >
              {showAllTrades ? 'Show Latest 30 Trades' : `View All ${activeRows.length} Trades`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

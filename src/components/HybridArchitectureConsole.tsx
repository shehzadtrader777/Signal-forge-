import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Code2,
  Cpu,
  Database,
  ExternalLink,
  GitBranch,
  Layers,
  Play,
  RefreshCw,
  ShieldCheck,
  Sliders,
} from 'lucide-react';
import {
  ForgeInteractiveButton,
  ForgeMetricStrip,
  ForgeSegmentedControl,
  ForgeWidgetFrame,
  type SegmentedOption,
} from './ui/ForgeDesignSystem';
import type { WidgetMetadataSegment, WidgetMetricItem } from '../lib/designSystem';
import type {
  HybridAssetClass,
  HybridMarketRegime,
  HybridStrategyFamily,
  TrackedStrategyRecord,
} from '../lib/hybridArchitectureEngine';
import type {
  HybridArchitectureStateSnapshot,
  HybridSourceDescriptor,
} from '../lib/hybridArchitectureServer';
import { apiFetch } from '../lib/apiClient';

type HybridTabKey = 'ORCHESTRATION' | 'BACKTEST_CHAMBER' | 'STRATEGY_DB' | 'RUST_PYTHON_CORE';

const TAB_ITEMS: readonly SegmentedOption<HybridTabKey>[] = [
  { value: 'ORCHESTRATION', label: 'Phases 1–2 · IPC & Clones', testId: 'hybrid-tab-btn-orchestration' },
  { value: 'BACKTEST_CHAMBER', label: 'Phases 3–5 · Mmap, Chamber & Risk', testId: 'hybrid-tab-btn-backtest' },
  { value: 'STRATEGY_DB', label: 'Phase 6 · SQLite Tracking DB', testId: 'hybrid-tab-btn-db' },
  { value: 'RUST_PYTHON_CORE', label: 'Rust + Python Core & Refs', testId: 'hybrid-tab-btn-core' },
];

const ASSET_OPTIONS: readonly { value: HybridAssetClass; label: string }[] = [
  { value: 'CRYPTO', label: 'Crypto · BTC/USDT (Binance)' },
  { value: 'FOREX', label: 'Forex · EUR/USD (OANDA)' },
  { value: 'EQUITIES', label: 'Equities · NVDA (IBKR)' },
];

const FAMILY_OPTIONS: readonly { value: HybridStrategyFamily; label: string }[] = [
  { value: 'BREAKOUT_MOMENTUM', label: 'Breakout Momentum' },
  { value: 'ORDERBOOK_IMBALANCE', label: 'Order-Book Imbalance' },
  { value: 'MEAN_REVERSION', label: 'Mean Reversion' },
  { value: 'STAT_ARB', label: 'Statistical Arbitrage' },
];

const REGIME_OPTIONS: readonly { value: HybridMarketRegime; label: string }[] = [
  { value: 'TRENDING_BULL', label: 'Trending Bull' },
  { value: 'HIGH_VOL_CHOP', label: 'High-Volatility Chop' },
  { value: 'BEAR_STRESS', label: 'Bear Stress' },
  { value: 'MEAN_REVERTING', label: 'Mean-Reverting Range' },
];

const DATE_PRESETS: readonly {
  label: string;
  startDate: string;
  endDate: string;
  regime: HybridMarketRegime;
}[] = [
  { label: 'FY 2024 Full Year', startDate: '2024-01-01', endDate: '2024-12-31', regime: 'TRENDING_BULL' },
  { label: '2023–2024 12M', startDate: '2023-06-01', endDate: '2024-06-01', regime: 'MEAN_REVERTING' },
  { label: 'Q3–Q4 High Vol', startDate: '2024-07-01', endDate: '2024-12-31', regime: 'HIGH_VOL_CHOP' },
  { label: '2022 Bear Stress', startDate: '2022-01-01', endDate: '2022-12-31', regime: 'BEAR_STRESS' },
];

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function statusColorClass(status: TrackedStrategyRecord['status']): string {
  if (status === 'PROMOTED_LIVE_READY') return 'text-emerald-400';
  if (status === 'RISK_THROTTLED') return 'text-rose-400';
  return 'text-amber-300';
}

export const HybridArchitectureConsole = memo(function HybridArchitectureConsole() {
  const [activeTab, setActiveTab] = useState<HybridTabKey>('ORCHESTRATION');
  const [snapshot, setSnapshot] = useState<HybridArchitectureStateSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Phase 2 horizontal clone scaling controls
  const [scaleVolatility, setScaleVolatility] = useState<number>(38);
  const [computeNodes, setComputeNodes] = useState<number>(12);
  const [baseClonesPerNode, setBaseClonesPerNode] = useState<number>(64);
  const [scalingBusy, setScalingBusy] = useState<boolean>(false);

  // Phase 3-6 historical date-range backtest + paper chamber controls
  const [assetClass, setAssetClass] = useState<HybridAssetClass>('CRYPTO');
  const [strategyFamily, setStrategyFamily] = useState<HybridStrategyFamily>('BREAKOUT_MOMENTUM');
  const [startDate, setStartDate] = useState<string>('2024-01-01');
  const [endDate, setEndDate] = useState<string>('2024-12-31');
  const [regime, setRegime] = useState<HybridMarketRegime>('TRENDING_BULL');
  const [liveVolatilityPct, setLiveVolatilityPct] = useState<number>(28);
  const [tickCount, setTickCount] = useState<number>(12000);
  const [backtestBusy, setBacktestBusy] = useState<boolean>(false);
  const [pythonVerifyBusy, setPythonVerifyBusy] = useState<boolean>(false);

  // Selected strategy for Phase 4-6 detailed audit inspector
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>('');

  // Rust / Python allowlisted source viewer state
  const [selectedSourceKey, setSelectedSourceKey] = useState<string>('rust_orderbook');
  const [sourceContent, setSourceContent] = useState<string>('');
  const [sourceDescriptor, setSourceDescriptor] = useState<HybridSourceDescriptor | null>(null);
  const [sourceLoading, setSourceLoading] = useState<boolean>(false);

  const loadState = useCallback(async () => {
    try {
      const res = await fetch('/api/hybrid/state');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { ok: boolean; state?: HybridArchitectureStateSnapshot };
      if (data.ok && data.state) {
        setSnapshot(data.state);
        setSelectedStrategyId((prev) => prev || data.state?.trackedStrategies[0]?.strategyId || '');
        setErrorMsg(null);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to fetch hybrid engine state.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const loadSourceFile = useCallback(async (fileKey: string) => {
    setSourceLoading(true);
    try {
      const res = await fetch(`/api/hybrid/source?file=${encodeURIComponent(fileKey)}`);
      const data = (await res.json()) as {
        ok: boolean;
        descriptor?: HybridSourceDescriptor;
        content?: string;
        message?: string;
      };
      if (data.ok && data.descriptor && typeof data.content === 'string') {
        setSourceDescriptor(data.descriptor);
        setSourceContent(data.content);
      } else {
        setSourceContent(data.message || 'Unable to load source file.');
      }
    } catch {
      setSourceContent('Network error while reading allowlisted hybrid_core source.');
    } finally {
      setSourceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'RUST_PYTHON_CORE') {
      loadSourceFile(selectedSourceKey);
    }
  }, [activeTab, selectedSourceKey, loadSourceFile]);

  const handleScaleClones = useCallback(async () => {
    setScalingBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/hybrid/clones/scale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketVolatilityPct: scaleVolatility,
          computeNodes,
          baseClonesPerNode,
          targetStreams: computeNodes * 4,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        state?: HybridArchitectureStateSnapshot;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.state) {
        throw new Error(data.message || data.error || 'Horizontal clone scaling failed.');
      }
      setSnapshot(data.state);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Clone scaling request failed.');
    } finally {
      setScalingBusy(false);
    }
  }, [scaleVolatility, computeNodes, baseClonesPerNode]);

  const handleVerifyPythonRuntime = useCallback(async () => {
    setPythonVerifyBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/hybrid/runtime/verify-python', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = (await res.json()) as {
        ok: boolean;
        state?: HybridArchitectureStateSnapshot;
        error?: string;
      };
      if (data.state) {
        setSnapshot(data.state);
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Python control plane verification failed.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Python verification request failed.');
    } finally {
      setPythonVerifyBusy(false);
    }
  }, []);

  const handleRunBacktestPipeline = useCallback(async () => {
    setBacktestBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/hybrid/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetClass,
          strategyFamily,
          startDate,
          endDate,
          regime,
          liveVolatilityPct,
          tickCount,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        record?: TrackedStrategyRecord;
        state?: HybridArchitectureStateSnapshot;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.state || !data.record) {
        throw new Error(data.message || data.error || 'Hybrid backtest execution failed.');
      }
      setSnapshot(data.state);
      setSelectedStrategyId(data.record.strategyId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Backtest execution failed.');
    } finally {
      setBacktestBusy(false);
    }
  }, [assetClass, strategyFamily, startDate, endDate, regime, liveVolatilityPct, tickCount]);

  const selectedStrategy = useMemo(() => {
    if (!snapshot || snapshot.trackedStrategies.length === 0) return null;
    return (
      snapshot.trackedStrategies.find((s) => s.strategyId === selectedStrategyId) ??
      snapshot.trackedStrategies[0]
    );
  }, [snapshot, selectedStrategyId]);

  const headerMetadata = useMemo<readonly WidgetMetadataSegment[]>(() => {
    if (!snapshot) {
      return [
        { id: 'core', label: 'Hybrid Core', value: 'Python Control Plane + Rust Execution' },
        { id: 'status', label: 'IPC', value: 'Initializing', tone: 'INFO' },
      ];
    }
    const diag = snapshot.runtimeDiagnostics;
    const runtimeLabel = diag
      ? `${diag.python.available ? (diag.python.version ?? 'Python 3') : 'Python Missing'} · ${diag.rust.binaryBuilt ? 'Rust Native Binary' : diag.rust.rustcAvailable ? 'Rust Toolchain Ready' : 'Rust Docker Build / TS Fallback'}`
      : 'Python 3.11 + Rust 2021';
    return [
      {
        id: 'core',
        label: 'Runtime Probe',
        value: runtimeLabel,
        tone: diag?.rust.binaryBuilt ? 'NOMINAL' : 'INFO',
      },
      {
        id: 'ipc',
        label: 'IPC RTT',
        value: `${snapshot.ipcTopology.roundTripLatencyNs}ns`,
        tone: 'INFO',
      },
      {
        id: 'clones',
        label: 'AI Clones',
        value: formatNumber(snapshot.cloneScalePlan.totalActiveClones),
        tone: 'NOMINAL',
      },
      {
        id: 'db',
        label: 'Tracking DB',
        value: `${snapshot.trackingDbStats.totalTracked} strategies`,
        tone: 'NOMINAL',
      },
    ];
  }, [snapshot]);

  const kpiItems = useMemo<readonly WidgetMetricItem[]>(() => {
    if (!snapshot) {
      return [
        { id: 'ipc', label: 'Python ↔ Rust IPC', value: '—', subtext: 'Initializing bridge' },
        { id: 'clones', label: 'Active AI Clones', value: '—', subtext: 'Horizontal pool' },
        { id: 'mmap', label: 'Mmap Scan Speed', value: '—', subtext: 'Zero-copy ticks' },
        { id: 'sqlite', label: 'SQLite Tracked', value: '—', subtext: 'Strategy lifecycle DB' },
      ];
    }
    return [
      {
        id: 'ipc',
        label: 'Python ↔ Rust IPC',
        value: `${snapshot.ipcTopology.roundTripLatencyNs} ns`,
        subtext: `UDS + ${formatNumber(snapshot.ipcTopology.ringBufferCapacityFrames)}-frame ring`,
        tone: 'INFO',
      },
      {
        id: 'clones',
        label: 'Active AI Clones',
        value: formatNumber(snapshot.cloneScalePlan.totalActiveClones),
        subtext: `${snapshot.cloneScalePlan.computeNodes} nodes · ${snapshot.cloneScalePlan.clonesPerNode}/node @ ${snapshot.cloneScalePlan.marketVolatilityPct}% vol`,
        tone: 'NOMINAL',
      },
      {
        id: 'mmap',
        label: 'Mmap Scan Speed',
        value: `${snapshot.trackingDbStats.avgNsPerTick} ns/tick`,
        subtext: `${formatNumber(snapshot.cloneScalePlan.estimatedEvalThroughputSec)} evals/sec`,
        tone: 'INFO',
      },
      {
        id: 'sqlite',
        label: 'SQLite Tracked',
        value: `${snapshot.trackingDbStats.promotedCount} / ${snapshot.trackingDbStats.totalTracked}`,
        subtext: `Promoted · Max DD cap ${snapshot.activeRiskEnvelope.hardDrawdownPct.toFixed(1)}%`,
        tone: snapshot.trackingDbStats.promotedCount > 0 ? 'NOMINAL' : 'WARNING',
      },
    ];
  }, [snapshot]);

  return (
    <ForgeWidgetFrame
      testId="hybrid-architecture-console"
      title="Signal Forge Hybrid Production Core · Python Control Plane + Rust Execution Engine"
      icon={<Layers className="h-5 w-5 text-cyan-400 shrink-0" aria-hidden="true" />}
      metadata={headerMetadata}
      layout={{
        widgetId: 'hybrid-architecture-console',
        ariaLabel: 'Signal Forge 6-Phase Hybrid Python and Rust Production Core',
        colSpanDesktop: 12,
        elevation: 'SURFACE',
        gpuContain: true,
        showStreamRail: true,
      }}
      actions={
        <ForgeInteractiveButton
          label="Sync Core"
          intent="secondary"
          onClick={loadState}
          disabled={loading}
          testId="hybrid-sync-core-btn"
          icon={
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
          }
        />
      }
    >
      <div className="space-y-5">
        {/* Top 4-KPI High-Density Telemetry Strip */}
        <ForgeMetricStrip items={kpiItems} />

        {/* Clean Tab Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <ForgeSegmentedControl<HybridTabKey>
            layoutGroupId="hybrid-core-tabs"
            options={TAB_ITEMS}
            value={activeTab}
            onChange={setActiveTab}
            ariaLabel="Hybrid Architecture Phase Navigation"
          />
          {snapshot && (
            <div className="text-xs font-mono tabular-nums text-slate-400">
              Active Risk Envelope · Size{' '}
              <span className="text-cyan-300 font-semibold">
                {snapshot.activeRiskEnvelope.positionSizePct.toFixed(2)}%
              </span>{' '}
              · Lev{' '}
              <span className="text-white font-semibold">
                {snapshot.activeRiskEnvelope.leverageLimit.toFixed(2)}x
              </span>{' '}
              · Hard DD{' '}
              <span className="text-emerald-400 font-semibold">
                {snapshot.activeRiskEnvelope.hardDrawdownPct.toFixed(2)}%
              </span>
            </div>
          )}
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300"
          >
            {errorMsg}
          </div>
        )}

        {/* TAB 1: PHASES 1 & 2 — DUAL-LAYER IPC & UNBOUNDED HORIZONTAL CLONE SCALING */}
        {activeTab === 'ORCHESTRATION' && snapshot && (
          <div
            className="grid grid-cols-1 gap-5 lg:grid-cols-12"
            data-testid="hybrid-tab-orchestration"
          >
            {/* Phase 1 Dual-Layer Topology */}
            <div className="lg:col-span-5 rounded-xl border border-slate-800/90 bg-[#080f1f] p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                  <h3 className="font-display text-sm font-bold text-white">
                    Phase 1 · Dual-Layer Core &amp; IPC
                  </h3>
                </div>
                <span className="text-[11px] font-mono text-emerald-400">0.00% packet loss</span>
              </div>

              <div className="space-y-3 text-xs">
                <div className="rounded-lg border border-slate-800 bg-[#0b1428] p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] uppercase tracking-wider text-slate-400">
                      Control Plane · Native Probe
                    </span>
                    <span
                      className={`font-mono text-[11px] font-semibold ${
                        snapshot.runtimeDiagnostics?.python.available
                          ? 'text-emerald-400'
                          : 'text-amber-300'
                      }`}
                    >
                      {snapshot.runtimeDiagnostics?.python.available
                        ? (snapshot.runtimeDiagnostics.python.version ?? 'Python 3 Active')
                        : 'Python Not Found'}
                    </span>
                  </div>
                  <div className="font-semibold text-white">
                    {snapshot.ipcTopology.controlPlaneRuntime}
                  </div>
                  <div className="text-slate-400">
                    Strategy orchestration · Dynamic risk feedback · Multi-agent clone dispatch
                  </div>
                  {snapshot.runtimeDiagnostics?.lastPythonSelfTest && (
                    <div
                      data-testid="hybrid-python-selftest-summary"
                      className="rounded border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5 font-mono text-[11px] text-emerald-300"
                    >
                      Verified {snapshot.runtimeDiagnostics.lastPythonSelfTest.phase3Ticks} mmap ticks ·{' '}
                      {snapshot.runtimeDiagnostics.lastPythonSelfTest.phase2Clones} clones ·{' '}
                      {snapshot.runtimeDiagnostics.lastPythonSelfTest.durationMs}ms (
                      {snapshot.runtimeDiagnostics.lastPythonSelfTest.transport})
                    </div>
                  )}
                  <div className="pt-1">
                    <ForgeInteractiveButton
                      label={
                        pythonVerifyBusy
                          ? 'Running Python Self-Test...'
                          : 'Verify Python Control Plane'
                      }
                      intent="secondary"
                      onClick={handleVerifyPythonRuntime}
                      disabled={pythonVerifyBusy || !snapshot.runtimeDiagnostics?.python.available}
                      testId="hybrid-verify-python-btn"
                      icon={<Play className="h-3.5 w-3.5" aria-hidden="true" />}
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-wider text-cyan-300">
                      IPC Bridge
                    </span>
                    <span className="font-mono tabular-nums text-cyan-300 font-semibold">
                      {snapshot.runtimeDiagnostics?.rust.ipcSocketActive
                        ? `${snapshot.ipcTopology.roundTripLatencyNs} ns RTT (UDS Live)`
                        : 'TS/Python Deterministic Fallback'}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-slate-200">
                    {snapshot.ipcTopology.ipcProtocol}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-slate-400">
                    {snapshot.ipcTopology.socketPath}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0b1428] p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] uppercase tracking-wider text-slate-400">
                      Execution Engine · Native Probe
                    </span>
                    <span
                      className={`font-mono text-[11px] font-semibold ${
                        snapshot.runtimeDiagnostics?.rust.binaryBuilt
                          ? 'text-emerald-400'
                          : 'text-amber-300'
                      }`}
                    >
                      {snapshot.runtimeDiagnostics?.rust.binaryBuilt
                        ? 'Rust Release Binary Ready'
                        : snapshot.runtimeDiagnostics?.rust.rustcAvailable
                          ? 'Rustc Detected (Unbuilt)'
                          : 'Rustc Absent in Sandbox'}
                    </span>
                  </div>
                  <div className="font-semibold text-white">
                    {snapshot.ipcTopology.executionCoreRuntime}
                  </div>
                  <div className="text-slate-400 leading-relaxed">
                    {snapshot.runtimeDiagnostics?.rust.remediationSummary ??
                      'Zero-copy 44-byte TickFrame mmap · L2 order book matching · Slippage guard'}
                  </div>
                </div>
              </div>

              {/* Multi-Asset Data Adapters summary */}
              <div className="pt-2 border-t border-slate-800/80">
                <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-2">
                  Modular Multi-Asset Data Adapters (Crypto · Forex · Equities)
                </div>
                <div className="space-y-1.5 text-xs font-mono tabular-nums">
                  {snapshot.adapters.map((ad) => (
                    <div
                      key={ad.assetClass}
                      className="flex items-center justify-between text-slate-300"
                    >
                      <span>
                        <span className="text-white font-semibold">{ad.assetClass}</span> ·{' '}
                        {ad.symbol} ({ad.exchange})
                      </span>
                      <span className="text-slate-400">
                        {ad.baseSpreadBps}bps · {ad.baseLatencyMs}ms
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Phase 2 Multi-Agent Horizontal Clone Scaler */}
            <div className="lg:col-span-7 rounded-xl border border-slate-800/90 bg-[#080f1f] p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                  <h3 className="font-display text-sm font-bold text-white">
                    Phase 2 · Unbounded Horizontal AI Worker Clone Scaler
                  </h3>
                </div>
                <span
                  data-testid="hybrid-active-clones-count"
                  className="font-mono tabular-nums text-xs font-bold text-cyan-300"
                >
                  {formatNumber(snapshot.cloneScalePlan.totalActiveClones)} Active Clones
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block space-y-1 text-xs">
                  <span className="text-slate-400">
                    Live Market Volatility ({scaleVolatility}%)
                  </span>
                  <input
                    type="range"
                    min={5}
                    max={85}
                    step={1}
                    value={scaleVolatility}
                    onChange={(e) => setScaleVolatility(Number(e.target.value))}
                    data-testid="hybrid-volatility-slider"
                    className="w-full accent-cyan-400"
                  />
                </label>

                <label className="block space-y-1 text-xs">
                  <span className="text-slate-400">Compute Nodes ({computeNodes})</span>
                  <input
                    type="number"
                    min={1}
                    max={256}
                    value={computeNodes}
                    onChange={(e) => setComputeNodes(Math.max(1, Number(e.target.value) || 1))}
                    data-testid="hybrid-compute-nodes-input"
                    className="w-full rounded-lg border border-slate-700 bg-[#0c162b] px-2.5 py-1.5 font-mono text-white"
                  />
                </label>

                <label className="block space-y-1 text-xs">
                  <span className="text-slate-400">Base Clones / Node</span>
                  <input
                    type="number"
                    min={16}
                    max={256}
                    step={16}
                    value={baseClonesPerNode}
                    onChange={(e) =>
                      setBaseClonesPerNode(Math.max(16, Number(e.target.value) || 32))
                    }
                    data-testid="hybrid-base-clones-input"
                    className="w-full rounded-lg border border-slate-700 bg-[#0c162b] px-2.5 py-1.5 font-mono text-white"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs font-mono tabular-nums text-slate-400">
                  Throughput:{' '}
                  <span className="text-white font-semibold">
                    {formatNumber(snapshot.cloneScalePlan.estimatedEvalThroughputSec)}
                  </span>{' '}
                  strategy evals/sec · {snapshot.cloneScalePlan.targetStreams} parallel stream
                  partitions
                </div>
                <ForgeInteractiveButton
                  label={scalingBusy ? 'Provisioning Clones...' : 'Scale Agent Clones'}
                  intent="primary"
                  onClick={handleScaleClones}
                  disabled={scalingBusy}
                  testId="hybrid-scale-clones-btn"
                  icon={<Sliders className="h-3.5 w-3.5" aria-hidden="true" />}
                />
              </div>

              {/* Family Distribution */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {(
                  Object.entries(snapshot.cloneScalePlan.familyDistribution) as [
                    HybridStrategyFamily,
                    number,
                  ][]
                ).map(([family, count]) => (
                  <div
                    key={family}
                    className="rounded-lg border border-slate-800 bg-[#0b1428] px-3 py-2"
                  >
                    <div className="text-[10px] font-mono text-slate-400 truncate">
                      {family.replace(/_/g, ' ')}
                    </div>
                    <div className="mt-0.5 font-mono text-sm font-bold tabular-nums text-white">
                      {formatNumber(count)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Sample Autonomous Worker Nodes Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                      <th className="py-1.5 pr-3">Worker Clone</th>
                      <th className="py-1.5 pr-3">Algorithm Logic</th>
                      <th className="py-1.5 pr-3">Stream Partition</th>
                      <th className="py-1.5 pr-3">EMA Window</th>
                      <th className="py-1.5 text-right">Node</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-200">
                    {snapshot.cloneScalePlan.sampleClones.slice(0, 6).map((clone) => (
                      <tr key={clone.cloneId}>
                        <td className="py-1.5 pr-3 text-cyan-300 font-semibold">{clone.cloneId}</td>
                        <td className="py-1.5 pr-3">{clone.strategyFamily}</td>
                        <td className="py-1.5 pr-3 text-slate-300">{clone.streamPartition}</td>
                        <td className="py-1.5 pr-3 text-slate-400">
                          {clone.fastWindow}/{clone.slowWindow}
                        </td>
                        <td className="py-1.5 text-right text-slate-300">N-{clone.assignedNode}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: PHASES 3, 4 & 5 — MMAP NANOSECOND BACKTEST + PAPER CHAMBER + DYNAMIC RISK */}
        {activeTab === 'BACKTEST_CHAMBER' && snapshot && (
          <div className="space-y-5" data-testid="hybrid-tab-backtest">
            {/* Historical Date Range + Multi-Asset Vectorized Pipeline Controls */}
            <div className="rounded-xl border border-slate-800/90 bg-[#080f1f] p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                  <h3 className="font-display text-sm font-bold text-white">
                    Phase 3 &amp; 6 · Nanosecond Mmap Backtester &amp; Historical Date-Range Slicer
                  </h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {DATE_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setStartDate(preset.startDate);
                        setEndDate(preset.endDate);
                        setRegime(preset.regime);
                      }}
                      className="rounded border border-slate-700 bg-[#0d172c] px-2.5 py-1 text-[11px] text-slate-300 hover:border-cyan-400 hover:text-white transition-colors cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <label className="block space-y-1 text-xs">
                  <span className="text-slate-400">Asset Adapter</span>
                  <select
                    value={assetClass}
                    onChange={(e) => setAssetClass(e.target.value as HybridAssetClass)}
                    data-testid="hybrid-asset-select"
                    className="w-full rounded-lg border border-slate-700 bg-[#0c162b] px-2.5 py-2 text-xs text-white"
                  >
                    {ASSET_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1 text-xs">
                  <span className="text-slate-400">Strategy Family</span>
                  <select
                    value={strategyFamily}
                    onChange={(e) => setStrategyFamily(e.target.value as HybridStrategyFamily)}
                    data-testid="hybrid-family-select"
                    className="w-full rounded-lg border border-slate-700 bg-[#0c162b] px-2.5 py-2 text-xs text-white"
                  >
                    {FAMILY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1 text-xs">
                  <span className="text-slate-400">Start Date</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    data-testid="hybrid-start-date"
                    className="w-full rounded-lg border border-slate-700 bg-[#0c162b] px-2.5 py-1.5 font-mono text-xs text-white"
                  />
                </label>

                <label className="block space-y-1 text-xs">
                  <span className="text-slate-400">End Date</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    data-testid="hybrid-end-date"
                    className="w-full rounded-lg border border-slate-700 bg-[#0c162b] px-2.5 py-1.5 font-mono text-xs text-white"
                  />
                </label>

                <label className="block space-y-1 text-xs">
                  <span className="text-slate-400">Market Regime</span>
                  <select
                    value={regime}
                    onChange={(e) => setRegime(e.target.value as HybridMarketRegime)}
                    data-testid="hybrid-regime-select"
                    className="w-full rounded-lg border border-slate-700 bg-[#0c162b] px-2.5 py-2 text-xs text-white"
                  >
                    {REGIME_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1 text-xs">
                  <span className="text-slate-400">Live Volatility (%)</span>
                  <input
                    type="number"
                    min={4}
                    max={95}
                    value={liveVolatilityPct}
                    onChange={(e) =>
                      setLiveVolatilityPct(Math.max(4, Math.min(95, Number(e.target.value) || 20)))
                    }
                    data-testid="hybrid-live-vol-input"
                    className="w-full rounded-lg border border-slate-700 bg-[#0c162b] px-2.5 py-1.5 font-mono text-xs text-white"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span>Mmap Tick Depth:</span>
                  {[6000, 12000, 24000].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setTickCount(count)}
                      className={`font-mono text-xs px-2 py-0.5 rounded border cursor-pointer ${
                        tickCount === count
                          ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200'
                          : 'border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      {formatNumber(count)} ticks
                    </button>
                  ))}
                </div>
                <ForgeInteractiveButton
                  label={
                    backtestBusy
                      ? 'Running Mmap + Paper Chamber...'
                      : 'Run Phases 3–6 Pipeline & Track'
                  }
                  intent="primary"
                  onClick={handleRunBacktestPipeline}
                  disabled={backtestBusy}
                  testId="hybrid-run-backtest-btn"
                  icon={<Play className="h-3.5 w-3.5" aria-hidden="true" />}
                />
              </div>
            </div>

            {/* Latest / Selected Execution Verdict: Phase 4 Paper Chamber + Phase 5 Dynamic Risk */}
            {selectedStrategy && (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                {/* Phase 4 Paper Trading Validation Chamber */}
                <div
                  className="rounded-xl border border-slate-800/90 bg-[#080f1f] p-4 space-y-3"
                  data-testid="hybrid-paper-chamber-card"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                      <h4 className="font-display text-sm font-bold text-white">
                        Phase 4 · Paper Trading Validation Chamber
                      </h4>
                    </div>
                    <span
                      className={`font-mono text-xs font-bold ${statusColorClass(selectedStrategy.status)}`}
                    >
                      {selectedStrategy.status.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <div className="text-xs text-slate-300">
                    <span className="font-mono text-cyan-300">{selectedStrategy.strategyId}</span> ·{' '}
                    {selectedStrategy.symbol} ({selectedStrategy.chamber.exchange}) ·{' '}
                    {selectedStrategy.startDate} to {selectedStrategy.endDate}
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 text-xs font-mono tabular-nums">
                    <div className="rounded-lg border border-slate-800 bg-[#0b1428] p-2.5">
                      <div className="text-[10px] text-slate-400">CHAMBER NET RETURN</div>
                      <div
                        className={`mt-1 text-sm font-bold ${
                          selectedStrategy.chamber.chamberNetReturnPct >= 0
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                        }`}
                      >
                        {selectedStrategy.chamber.chamberNetReturnPct >= 0 ? '+' : ''}
                        {selectedStrategy.chamber.chamberNetReturnPct.toFixed(2)}%
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-[#0b1428] p-2.5">
                      <div className="text-[10px] text-slate-400">L2 SLIPPAGE / LATENCY</div>
                      <div className="mt-1 text-sm font-bold text-white">
                        {selectedStrategy.chamber.avgSlippageBps}bps ·{' '}
                        {selectedStrategy.chamber.avgSimulatedLatencyMs}ms
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-[#0b1428] p-2.5">
                      <div className="text-[10px] text-slate-400">FILL RATE / FEES</div>
                      <div className="mt-1 text-sm font-bold text-cyan-300">
                        {selectedStrategy.chamber.fillRatePct}% ·{' '}
                        {selectedStrategy.chamber.exchangeFeeDragBps}bps
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    {selectedStrategy.chamber.gateReason}
                  </p>
                </div>

                {/* Phase 5 Dynamic Risk Parameter Optimization */}
                <div
                  className="rounded-xl border border-slate-800/90 bg-[#080f1f] p-4 space-y-3"
                  data-testid="hybrid-dynamic-risk-card"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sliders className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                      <h4 className="font-display text-sm font-bold text-white">
                        Phase 5 · Dynamic Risk Parameter Optimization
                      </h4>
                    </div>
                    <span className="font-mono text-xs text-slate-400">
                      Live Vol {selectedStrategy.riskOptimization.liveVolatilityPct}%
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2.5 text-xs font-mono tabular-nums">
                    <div className="rounded-lg border border-slate-800 bg-[#0b1428] p-2.5">
                      <div className="text-[10px] text-slate-400">POSITION SIZE</div>
                      <div className="mt-1 text-sm font-bold text-white">
                        {selectedStrategy.riskOptimization.previousPositionSizePct}% →{' '}
                        <span className="text-cyan-300">
                          {selectedStrategy.riskOptimization.optimizedPositionSizePct}%
                        </span>
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-[#0b1428] p-2.5">
                      <div className="text-[10px] text-slate-400">LEVERAGE CAP</div>
                      <div className="mt-1 text-sm font-bold text-white">
                        {selectedStrategy.riskOptimization.previousLeverageLimit}x →{' '}
                        <span className="text-cyan-300">
                          {selectedStrategy.riskOptimization.optimizedLeverageLimit}x
                        </span>
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-[#0b1428] p-2.5">
                      <div className="text-[10px] text-slate-400">HARD DRAWDOWN</div>
                      <div className="mt-1 text-sm font-bold text-white">
                        {selectedStrategy.riskOptimization.previousHardDrawdownPct}% →{' '}
                        <span className="text-emerald-400">
                          {selectedStrategy.riskOptimization.optimizedHardDrawdownPct}%
                        </span>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs font-mono text-slate-300 leading-relaxed">
                    {selectedStrategy.riskOptimization.rationale}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: PHASE 6 — SQLITE STRATEGY TRACKING DATABASE & ATTRIBUTION */}
        {activeTab === 'STRATEGY_DB' && snapshot && (
          <div className="space-y-4" data-testid="hybrid-tab-strategy-db">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                <h3 className="font-display text-sm font-bold text-white">
                  Phase 6 · SQLite Strategy Lifecycle &amp; Attribution Database
                </h3>
              </div>
              <span className="font-mono text-xs text-slate-400">
                {snapshot.trackingDbStats.sqlitePath} · {snapshot.trackingDbStats.totalTracked}{' '}
                candidate records
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800/90 bg-[#080f1f]">
              <table className="w-full text-left text-xs font-mono tabular-nums">
                <thead>
                  <tr className="border-b border-slate-800 bg-[#0b1428] text-[11px] text-slate-400">
                    <th className="px-3 py-2">Strategy ID</th>
                    <th className="px-3 py-2">Asset / Venue</th>
                    <th className="px-3 py-2">Date Window</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Sharpe</th>
                    <th className="px-3 py-2 text-right">Chamber Net</th>
                    <th className="px-3 py-2 text-right">Max DD</th>
                    <th className="px-3 py-2 text-right">ns/tick</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {snapshot.trackedStrategies.map((strat) => {
                    const isSelected = selectedStrategy?.strategyId === strat.strategyId;
                    return (
                      <tr
                        key={strat.strategyId}
                        onClick={() => setSelectedStrategyId(strat.strategyId)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-cyan-500/10' : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="px-3 py-2 font-semibold text-cyan-300">
                          {strat.strategyId}
                        </td>
                        <td className="px-3 py-2 text-white">
                          {strat.assetClass} · {strat.symbol} ({strat.exchange})
                        </td>
                        <td className="px-3 py-2 text-slate-300">
                          {strat.startDate} → {strat.endDate}
                        </td>
                        <td
                          className={`px-3 py-2 font-semibold ${statusColorClass(strat.status)}`}
                        >
                          {strat.status}
                        </td>
                        <td className="px-3 py-2 text-right text-white">
                          {strat.backtest.sharpeRatio.toFixed(2)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-semibold ${
                            strat.chamber.chamberNetReturnPct >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {strat.chamber.chamberNetReturnPct >= 0 ? '+' : ''}
                          {strat.chamber.chamberNetReturnPct.toFixed(2)}%
                        </td>
                        <td className="px-3 py-2 text-right text-slate-300">
                          {strat.chamber.chamberDrawdownPct.toFixed(2)}%
                        </td>
                        <td className="px-3 py-2 text-right text-cyan-200">
                          {strat.backtest.nsPerTick}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Granular Strategy Audit: Entry Execution Points & Attribution */}
            {selectedStrategy && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <div className="lg:col-span-5 rounded-xl border border-slate-800/90 bg-[#080f1f] p-4 space-y-3">
                  <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-300">
                    Attribution Analysis · {selectedStrategy.strategyId}
                  </h4>
                  <div className="space-y-1.5 text-xs font-mono tabular-nums">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Alpha Signal Contribution</span>
                      <span className="text-emerald-400">
                        +{selectedStrategy.attribution.alphaSignalBps} bps
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Order-Book Timing</span>
                      <span className="text-cyan-300">
                        {selectedStrategy.attribution.orderBookTimingBps >= 0 ? '+' : ''}
                        {selectedStrategy.attribution.orderBookTimingBps} bps
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">L2 Slippage Drag</span>
                      <span className="text-rose-400">
                        {selectedStrategy.attribution.slippageCostBps} bps
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Exchange Fee Drag</span>
                      <span className="text-rose-400">
                        {selectedStrategy.attribution.exchangeFeeCostBps} bps
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Simulated Latency Decay</span>
                      <span className="text-amber-300">
                        {selectedStrategy.attribution.latencyDecayBps} bps
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-slate-800 pt-1.5 font-bold">
                      <span className="text-white">Net Attribution</span>
                      <span
                        className={
                          selectedStrategy.attribution.netAttributionBps >= 0
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                        }
                      >
                        {selectedStrategy.attribution.netAttributionBps >= 0 ? '+' : ''}
                        {selectedStrategy.attribution.netAttributionBps} bps
                      </span>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-7 rounded-xl border border-slate-800/90 bg-[#080f1f] p-4 space-y-2.5">
                  <h4 className="font-display text-xs font-bold uppercase tracking-wider text-slate-300">
                    Recorded Entry Execution Points ({selectedStrategy.backtest.entryPoints.length}{' '}
                    sampled)
                  </h4>
                  <div className="overflow-x-auto max-h-52">
                    <table className="w-full text-left text-xs font-mono tabular-nums">
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] text-slate-400">
                          <th className="py-1 pr-2">#</th>
                          <th className="py-1 pr-2">Timestamp (UTC)</th>
                          <th className="py-1 pr-2">Side</th>
                          <th className="py-1 pr-2 text-right">Entry</th>
                          <th className="py-1 pr-2 text-right">Exit</th>
                          <th className="py-1 pr-2 text-right">OB Imb</th>
                          <th className="py-1 text-right">Net %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {selectedStrategy.backtest.entryPoints.slice(0, 8).map((pt) => (
                          <tr key={pt.seq}>
                            <td className="py-1 pr-2 text-slate-400">{pt.seq}</td>
                            <td className="py-1 pr-2 text-slate-300">
                              {pt.timestampIso.slice(0, 16).replace('T', ' ')}
                            </td>
                            <td
                              className={`py-1 pr-2 font-semibold ${
                                pt.side === 'LONG' ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {pt.side}
                            </td>
                            <td className="py-1 pr-2 text-right text-slate-200">{pt.entryPrice}</td>
                            <td className="py-1 pr-2 text-right text-slate-200">{pt.exitPrice}</td>
                            <td className="py-1 pr-2 text-right text-cyan-300">
                              {pt.orderBookImbalance}
                            </td>
                            <td
                              className={`py-1 text-right font-semibold ${
                                pt.netReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {pt.netReturnPct >= 0 ? '+' : ''}
                              {pt.netReturnPct}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: RUST EXECUTION ENGINE + PYTHON CONTROL PLANE CODE & 5 REFERENCE BLUEPRINTS */}
        {activeTab === 'RUST_PYTHON_CORE' && snapshot && (
          <div className="space-y-5" data-testid="hybrid-tab-core-code">
            {/* 5 Architectural Reference Repositories */}
            <div className="rounded-xl border border-slate-800/90 bg-[#080f1f] p-4 space-y-3">
              <h3 className="font-display text-sm font-bold text-white">
                Integrated Open-Source Quant Reference Architectures
              </h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
                {snapshot.references.map((ref) => (
                  <a
                    key={ref.id}
                    href={ref.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid={`hybrid-ref-${ref.id}`}
                    className="group rounded-lg border border-slate-800 bg-[#0b1428] p-3 hover:border-cyan-400/60 transition-colors flex flex-col justify-between gap-2"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-display text-xs font-bold text-white group-hover:text-cyan-300">
                          {ref.name}
                        </span>
                        <ExternalLink className="h-3 w-3 text-slate-500 group-hover:text-cyan-300 shrink-0" />
                      </div>
                      <div className="mt-1 text-[10px] font-mono text-cyan-400">
                        {ref.phaseFocus}
                      </div>
                      <p className="mt-1.5 text-[11px] text-slate-400 leading-snug">
                        {ref.integratedPattern}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            </div>

            {/* Allowlisted Rust + Python Core Source Inspector */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="lg:col-span-4 rounded-xl border border-slate-800/90 bg-[#080f1f] p-3 space-y-1.5">
                <div className="flex items-center gap-2 px-2 pb-2 border-b border-slate-800 text-xs font-semibold text-slate-300">
                  <Code2 className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                  <span>hybrid_core/ Source Modules</span>
                </div>
                {snapshot.sourceCatalog.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setSelectedSourceKey(item.key)}
                    data-testid={`hybrid-src-btn-${item.key}`}
                    className={`w-full text-left rounded-lg px-2.5 py-2 transition-colors cursor-pointer ${
                      selectedSourceKey === item.key
                        ? 'bg-cyan-500/15 border border-cyan-400/40 text-white'
                        : 'border border-transparent text-slate-300 hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="font-mono text-xs truncate">{item.label}</div>
                    <div className="text-[10px] text-slate-400">{item.phase}</div>
                  </button>
                ))}
              </div>

              <div className="lg:col-span-8 rounded-xl border border-slate-800/90 bg-[#050a16] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between border-b border-slate-800 bg-[#0b1428] px-4 py-2 text-xs font-mono">
                  <span className="text-cyan-300">
                    {sourceDescriptor?.label ?? selectedSourceKey}
                  </span>
                  <span className="text-slate-400 uppercase">
                    {sourceDescriptor?.language ?? 'code'}
                  </span>
                </div>
                <pre
                  data-testid="hybrid-source-viewer"
                  className="max-h-96 overflow-auto p-4 text-[11px] leading-relaxed font-mono text-slate-200"
                >
                  {sourceLoading ? 'Loading allowlisted source...' : sourceContent}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </ForgeWidgetFrame>
  );
});

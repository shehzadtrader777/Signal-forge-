import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  Check,
  Code2,
  Copy,
  Database,
  Lock,
  Play,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Square,
  Terminal,
  TrendingUp,
  Unlock,
} from 'lucide-react';
import {
  ForgeInteractiveButton,
  ForgeMetricStrip,
  ForgeSegmentedControl,
  ForgeWidgetFrame,
  type SegmentedOption,
} from './ui/ForgeDesignSystem';
import type {
  WidgetLayoutContract,
  WidgetMetadataSegment,
  WidgetMetricItem,
} from '../lib/designSystem';
import type {
  DryRunPositionRecord,
  HardCodedRiskParameters,
  SystemAuditLogEntry,
  TelegramRpcCommand,
  TelegramRpcLogEntry,
  UnifiedEngineMetrics,
  UnifiedExchangeId,
  UnifiedMarketType,
  UnifiedOrderSide,
  UnifiedTradingMode,
} from '../lib/freqtradeCoreEngine';
import type { CoreSourceModuleDescriptor } from '../lib/freqtradeCoreServer';
import { apiFetch } from '../lib/apiClient';

type TerminalTabId = 'EXECUTION' | 'RPC_AUDIT' | 'LEDGER' | 'CORE_CODE';

interface FreqtradeSnapshotPayload {
  readonly metrics: UnifiedEngineMetrics;
  readonly riskParameters: HardCodedRiskParameters;
  readonly supportedExchanges: readonly UnifiedExchangeId[];
  readonly openPositions: readonly DryRunPositionRecord[];
  readonly closedTrades: readonly DryRunPositionRecord[];
  readonly rpcLogs: readonly TelegramRpcLogEntry[];
  readonly systemAudits: readonly SystemAuditLogEntry[];
  readonly coreSourceModules: readonly CoreSourceModuleDescriptor[];
  readonly sqliteStorageLabel: string;
  readonly telegramConfigured: boolean;
}

interface SourceResponsePayload {
  readonly ok: boolean;
  readonly moduleId?: string;
  readonly relativePath?: string;
  readonly content?: string;
  readonly error?: string;
}

const TERMINAL_LAYOUT: WidgetLayoutContract = {
  widgetId: 'freqtrade-unified-terminal',
  ariaLabel: 'Signal Forge Unified CCXT and SQLite Dry-Run Terminal',
  colSpanDesktop: 12,
  elevation: 'SURFACE',
  density: 'COMPACT',
  gpuContain: true,
  showStreamRail: true,
};

const TAB_OPTIONS: readonly SegmentedOption<TerminalTabId>[] = [
  { value: 'EXECUTION', label: 'CCXT & Positions', testId: 'ft-tab-execution' },
  { value: 'RPC_AUDIT', label: 'Telegram RPC & Audits', testId: 'ft-tab-rpc' },
  { value: 'LEDGER', label: 'SQLite Ledger', testId: 'ft-tab-ledger' },
  { value: 'CORE_CODE', label: 'Python Core & Config', testId: 'ft-tab-code' },
];

const QUICK_RPC_COMMANDS: readonly TelegramRpcCommand[] = ['/start', '/stop', '/status', '/profit'];

const SYMBOL_PRESETS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT'] as const;

const MODE_META: Record<
  UnifiedTradingMode,
  {
    readonly label: string;
    readonly shortLabel: string;
    readonly bannerClass: string;
    readonly activeBtnClass: string;
    readonly dotClass: string;
    readonly description: string;
  }
> = {
  PAPER_DRY_RUN: {
    label: 'Paper Trading (SQLite Dry-Run)',
    shortLabel: 'PAPER DRY-RUN',
    bannerClass: 'border-cyan-500/35 bg-cyan-500/10 text-cyan-200',
    activeBtnClass: 'border-cyan-400/70 bg-cyan-500/20 text-cyan-100',
    dotClass: 'bg-cyan-400',
    description: 'Localized SQLite paper engine · Zero real capital at risk · Counts toward 50-win Live Gate',
  },
  TESTNET: {
    label: 'Exchange Testnet Sandbox',
    shortLabel: 'TESTNET',
    bannerClass: 'border-amber-500/35 bg-amber-500/10 text-amber-200',
    activeBtnClass: 'border-amber-400/70 bg-amber-500/20 text-amber-100',
    dotClass: 'bg-amber-400',
    description: 'CCXT sandbox mode routing against exchange testnet endpoints · Virtual testnet funds',
  },
  LIVE: {
    label: 'Live Production Execution',
    shortLabel: 'LIVE',
    bannerClass: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    activeBtnClass: 'border-emerald-400/70 bg-emerald-500/20 text-emerald-100',
    dotClass: 'bg-emerald-400',
    description: 'Cleared live deployment via unified CCXT Spot/Futures router · Hard 8% daily drawdown cap active',
  },
};

function formatUsd(value: number, signed = false): string {
  const abs = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (signed) {
    return `${value >= 0 ? '+' : '-'}$${abs}`;
  }
  return `${value < 0 ? '-' : ''}$${abs}`;
}

function formatPrice(value: number): string {
  if (value >= 1000) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (value >= 1) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 4 });
  }
  return value.toFixed(5);
}

export const FreqtradeUnifiedTerminal = memo(function FreqtradeUnifiedTerminal() {
  const [snapshot, setSnapshot] = useState<FreqtradeSnapshotPayload | null>(null);
  const [activeTab, setActiveTab] = useState<TerminalTabId>('EXECUTION');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ readonly tone: 'OK' | 'WARN' | 'ERR'; readonly text: string } | null>(
    null
  );

  // Standardized AI Signal -> CCXT Router form state
  const [exchange, setExchange] = useState<UnifiedExchangeId>('binance');
  const [marketType, setMarketType] = useState<UnifiedMarketType>('FUTURES');
  const [symbol, setSymbol] = useState<string>('BTC/USDT');
  const [side, setSide] = useState<UnifiedOrderSide>('BUY');
  const [stakeUsd, setStakeUsd] = useState<string>('500');
  const [leverage, setLeverage] = useState<string>('3');

  // Telegram RPC input state
  const [rpcInput, setRpcInput] = useState<string>('/status');

  // Python Core Source Viewer state
  const [selectedModuleId, setSelectedModuleId] = useState<string>('ccxt_router');
  const [sourceCache, setSourceCache] = useState<Record<string, { path: string; content: string }>>({});
  const [sourceLoading, setSourceLoading] = useState(false);
  const [copiedSource, setCopiedSource] = useState(false);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/freqtrade/state');
      if (!res.ok) return;
      const data = (await res.json()) as { ok?: boolean; snapshot?: FreqtradeSnapshotPayload };
      if (data.ok && data.snapshot) {
        setSnapshot(data.snapshot);
      }
    } catch {
      // Keep last known snapshot
    }
  }, []);

  useEffect(() => {
    void fetchState();
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void fetchState();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [fetchState]);

  const sourceCacheRef = useRef(sourceCache);
  sourceCacheRef.current = sourceCache;
  const attemptedSourceModulesRef = useRef<Set<string>>(new Set());

  const loadCoreSource = useCallback(async (moduleId: string, force = false) => {
    setSelectedModuleId(moduleId);
    if (!force && (sourceCacheRef.current[moduleId] || attemptedSourceModulesRef.current.has(moduleId))) {
      return;
    }
    attemptedSourceModulesRef.current.add(moduleId);
    setSourceLoading(true);
    try {
      const res = await fetch(`/api/freqtrade/source?file=${encodeURIComponent(moduleId)}`);
      const data = (await res.json()) as SourceResponsePayload;
      if (data.ok && data.content && data.relativePath) {
        setSourceCache((prev) => ({
          ...prev,
          [moduleId]: { path: data.relativePath ?? moduleId, content: data.content ?? '' },
        }));
      }
    } catch {
      // Allow retry if user explicitly clicks the module again
    } finally {
      setSourceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'CORE_CODE' && !sourceCacheRef.current[selectedModuleId]) {
      void loadCoreSource(selectedModuleId);
    }
  }, [activeTab, loadCoreSource, selectedModuleId]);

  const handleModeSwitch = useCallback(async (mode: UnifiedTradingMode) => {
    setBusy(true);
    try {
      const res = await apiFetch('/api/freqtrade/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        snapshot?: FreqtradeSnapshotPayload;
      };
      if (data.snapshot) setSnapshot(data.snapshot);
      setNotice({
        tone: data.ok ? 'OK' : 'WARN',
        text: data.message ?? data.error ?? (data.ok ? `Switched to ${mode}` : 'Mode transition rejected.'),
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const handleExecuteSignal = useCallback(async () => {
    setBusy(true);
    try {
      const numericStake = Number(stakeUsd) || 500;
      const numericLeverage = marketType === 'SPOT' ? 1 : Math.max(1, Math.min(20, Number(leverage) || 1));

      const res = await apiFetch('/api/freqtrade/signal/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchange,
          symbol,
          marketType,
          side,
          stakeUsd: numericStake,
          leverage: numericLeverage,
          confidencePct: 86,
          strategyName: 'SignalForge_CCXT_Unified',
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        snapshot?: FreqtradeSnapshotPayload;
      };
      if (data.snapshot) setSnapshot(data.snapshot);
      setNotice({
        tone: data.ok ? 'OK' : 'ERR',
        text: data.message ?? data.error ?? 'Signal execution request processed.',
      });
    } finally {
      setBusy(false);
    }
  }, [exchange, leverage, marketType, side, stakeUsd, symbol]);

  const handleClosePosition = useCallback(async (pos: DryRunPositionRecord) => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/freqtrade/positions/${pos.tradeId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'MANUAL_MARKET_CLOSE' }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        snapshot?: FreqtradeSnapshotPayload;
      };
      if (data.snapshot) setSnapshot(data.snapshot);
      setNotice({
        tone: data.ok ? 'OK' : 'ERR',
        text: data.message ?? data.error ?? 'Position close processed.',
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const handleSyncMarketTick = useCallback(async () => {
    setBusy(true);
    try {
      const res = await apiFetch('/api/freqtrade/tick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        events?: readonly string[];
        message?: string;
        error?: string;
        snapshot?: FreqtradeSnapshotPayload;
      };
      if (data.snapshot) setSnapshot(data.snapshot);
      setNotice({
        tone: data.ok ? 'OK' : 'ERR',
        text: !data.ok
          ? (data.message ?? data.error ?? 'Market tick sync rejected.')
          : data.events && data.events.length > 0
            ? data.events[0]
            : 'Synced authoritative server live prices & trailing stops across open positions.',
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const handleRunRpc = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await apiFetch('/api/freqtrade/rpc/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: trimmed }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        response?: string;
        error?: string;
        snapshot?: FreqtradeSnapshotPayload;
      };
      if (data.snapshot) setSnapshot(data.snapshot);
      setNotice({
        tone: data.ok ? 'OK' : 'WARN',
        text: data.error ?? `Telegram RPC ${trimmed} executed.`,
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDispatchAudit = useCallback(async () => {
    setBusy(true);
    try {
      const res = await apiFetch('/api/freqtrade/audit/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        audit?: SystemAuditLogEntry;
        snapshot?: FreqtradeSnapshotPayload;
      };
      if (data.snapshot) setSnapshot(data.snapshot);
      setNotice({
        tone: 'OK',
        text: data.audit
          ? `System Audit recorded · CPU ${data.audit.cpuPct}% · Mem ${data.audit.memoryMb} MB · Latency ${data.audit.latencyMs} ms`
          : 'System Audit snapshot recorded.',
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const handleCopySource = useCallback(async () => {
    const current = sourceCache[selectedModuleId];
    if (!current?.content || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(current.content);
      setCopiedSource(true);
      window.setTimeout(() => setCopiedSource(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  }, [selectedModuleId, sourceCache]);

  const metrics = snapshot?.metrics;
  const risk = snapshot?.riskParameters;
  const activeMode: UnifiedTradingMode = metrics?.tradingMode ?? 'PAPER_DRY_RUN';
  const modeSpec = MODE_META[activeMode];

  const headerMetadata = useMemo<readonly WidgetMetadataSegment[]>(() => {
    const botText = metrics?.botRunning === false ? 'PAUSED' : 'RUNNING';
    return [
      { id: 'ccxt', label: 'Unified CCXT', value: 'Binance · Bybit · OKX · Kraken' },
      {
        id: 'db',
        label: 'Storage',
        value: snapshot?.sqliteStorageLabel ?? 'SQLite (.data/signal_forge_dry_run.sqlite)',
        tone: 'INFO',
      },
      {
        id: 'bot',
        label: 'Bot',
        value: botText,
        tone: metrics?.botRunning === false ? 'WARNING' : 'NOMINAL',
      },
    ];
  }, [metrics?.botRunning, snapshot?.sqliteStorageLabel]);

  const kpiItems = useMemo<readonly WidgetMetricItem[]>(() => {
    const portfolioVal = metrics?.portfolioValueUsd ?? 10_000;
    const unrealized = metrics?.unrealizedPnlUsd ?? 0;
    const ddPct = (metrics?.dailyDrawdownPct ?? 0) * 100;
    const maxDdPct = (metrics?.maxDailyDrawdownPct ?? 0.08) * 100;
    const openCount = metrics?.openPositionsCount ?? 0;
    const maxOpen = risk?.maxOpenTrades ?? 5;
    const streak = metrics?.consecutivePaperWins ?? 0;
    const reqWins = metrics?.requiredPaperWins ?? 50;
    const unlocked = metrics?.liveGateUnlocked ?? false;

    return [
      {
        id: 'portfolio',
        label: 'Live Portfolio Value',
        value: formatUsd(portfolioVal),
        subtext: `Unrealized ${formatUsd(unrealized, true)} · Realized ${formatUsd(
          metrics?.realizedPnlTotalUsd ?? 0,
          true
        )}`,
        tone: unrealized >= 0 ? 'NOMINAL' : 'WARNING',
      },
      {
        id: 'drawdown',
        label: 'Active Daily Drawdown',
        value: `${ddPct.toFixed(2)}% / ${maxDdPct.toFixed(1)}%`,
        subtext: metrics?.drawdownCircuitTripped
          ? 'CIRCUIT BREAKER HALTED'
          : `Hard SL ${((risk?.stopLossPct ?? 0.02) * 100).toFixed(1)}% · TP ${(
              (risk?.takeProfitPct ?? 0.06) * 100
            ).toFixed(1)}%`,
        tone: ddPct >= maxDdPct ? 'CRITICAL' : ddPct >= maxDdPct * 0.6 ? 'WARNING' : 'NOMINAL',
      },
      {
        id: 'positions',
        label: 'Open Positions',
        value: `${openCount} / ${maxOpen}`,
        subtext: `Closed ${metrics?.closedTradesCount ?? 0} · Win Rate ${(metrics?.winRatePct ?? 0).toFixed(
          1
        )}%`,
        tone: openCount > 0 ? 'INFO' : undefined,
      },
      {
        id: 'live-gate',
        label: 'Live Deployment Gate',
        value: unlocked ? `CLEARED (${streak}/${reqWins})` : `LOCKED (${streak}/${reqWins})`,
        subtext: unlocked
          ? '50 consecutive profitable paper trades verified'
          : `${Math.max(0, reqWins - streak)} consecutive paper wins remaining`,
        tone: unlocked ? 'NOMINAL' : 'WARNING',
      },
    ];
  }, [metrics, risk]);

  const ddDisplayPct = (metrics?.dailyDrawdownPct ?? 0) * 100;
  const maxDdDisplayPct = (metrics?.maxDailyDrawdownPct ?? 0.08) * 100;
  const drawdownProgressPct = Math.min(
    100,
    Math.max(0, (ddDisplayPct / Math.max(0.1, maxDdDisplayPct)) * 100)
  );
  const winGateProgressPct = Math.min(
    100,
    Math.max(0, ((metrics?.consecutivePaperWins ?? 0) / Math.max(1, metrics?.requiredPaperWins ?? 50)) * 100)
  );
  const activeSourceDoc = sourceCache[selectedModuleId];

  return (
    <ForgeWidgetFrame
      layout={TERMINAL_LAYOUT}
      title="Signal Forge × Freqtrade Unified Execution Terminal"
      icon={<Terminal className="h-5 w-5 text-cyan-400 shrink-0" aria-hidden="true" />}
      metadata={headerMetadata}
      testId="freqtrade-unified-terminal"
      actions={
        <div
          role="group"
          aria-label="Execution Mode Selector"
          data-testid="ft-mode-switcher"
          className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-[#050914] p-1"
        >
          {(['TESTNET', 'PAPER_DRY_RUN', 'LIVE'] as const).map((mode) => {
            const selected = activeMode === mode;
            const liveLocked = mode === 'LIVE' && !(metrics?.liveGateUnlocked ?? false);
            return (
              <button
                key={mode}
                type="button"
                disabled={busy}
                data-testid={`ft-mode-${mode.toLowerCase()}`}
                onClick={() => void handleModeSwitch(mode)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-mono font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  selected
                    ? MODE_META[mode].activeBtnClass
                    : 'border-transparent text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${
                    selected ? MODE_META[mode].dotClass : 'bg-slate-600'
                  }`}
                />
                <span>{MODE_META[mode].shortLabel}</span>
                {mode === 'LIVE' &&
                  (liveLocked ? (
                    <Lock className="h-3 w-3 text-amber-400" aria-hidden="true" />
                  ) : (
                    <Unlock className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                  ))}
              </button>
            );
          })}
        </div>
      }
    >
      <div className="space-y-4">
        {/* Explicit Mode Clarity Strip */}
        <div
          data-testid="ft-active-mode-banner"
          className={`flex flex-col gap-2 rounded-lg border px-3.5 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between ${modeSpec.bannerClass}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full shrink-0 ${modeSpec.dotClass}`} />
            <span className="font-mono font-bold uppercase tracking-wider shrink-0">
              {modeSpec.shortLabel}
            </span>
            <span className="text-slate-300 truncate">{modeSpec.description}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={busy}
              data-testid="ft-sync-tick-btn"
              onClick={() => void handleSyncMarketTick()}
              className="inline-flex items-center gap-1 rounded border border-slate-700/80 bg-[#050914]/80 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-cyan-400 hover:text-white transition-colors cursor-pointer"
            >
              <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>Sync Mark &amp; Trail</span>
            </button>
          </div>
        </div>

        {/* Consolidated 4-Metric Critical Strip */}
        <ForgeMetricStrip items={kpiItems} columns={4} />

        {/* Dual Hard-Risk Telemetry Bars (8% Drawdown Cap & 50-Win Live Gate) */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-slate-800/80 bg-[#050914]/70 px-3.5 py-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-slate-400 flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                Mandatory Daily Drawdown Cap
              </span>
              <span className="font-mono tabular-nums text-slate-200">
                {ddDisplayPct.toFixed(2)}% / {maxDdDisplayPct.toFixed(1)}%
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full transition-all duration-300 ${
                  drawdownProgressPct >= 95
                    ? 'bg-rose-500'
                    : drawdownProgressPct >= 60
                    ? 'bg-amber-400'
                    : 'bg-cyan-400'
                }`}
                style={{ width: `${Math.max(2, drawdownProgressPct)}%` }}
              />
            </div>
          </div>

          <div className="rounded-lg border border-slate-800/80 bg-[#050914]/70 px-3.5 py-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-slate-400 flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                50-Consecutive-Win Live Deployment Gate
              </span>
              <span className="font-mono tabular-nums text-slate-200">
                {metrics?.consecutivePaperWins ?? 0} / {metrics?.requiredPaperWins ?? 50} wins
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full transition-all duration-300 ${
                  metrics?.liveGateUnlocked ? 'bg-emerald-400' : 'bg-indigo-400'
                }`}
                style={{ width: `${Math.max(2, winGateProgressPct)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Inline Action Feedback */}
        {notice && (
          <div
            role="status"
            data-testid="ft-notice-banner"
            className={`rounded-lg border px-3.5 py-2 text-xs font-mono ${
              notice.tone === 'OK'
                ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                : notice.tone === 'WARN'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
            }`}
          >
            {notice.text}
          </div>
        )}

        {/* Primary View Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ForgeSegmentedControl
            ariaLabel="Unified Terminal Sections"
            layoutGroupId="ft-terminal-tabs"
            options={TAB_OPTIONS}
            value={activeTab}
            onChange={setActiveTab}
          />
          <div className="text-[11px] font-mono text-slate-400">
            Trail Arm +{((risk?.trailingActivationPct ?? 0.015) * 100).toFixed(1)}% · Offset{' '}
            {((risk?.trailingOffsetPct ?? 0.008) * 100).toFixed(1)}% · Fee{' '}
            {((risk?.takerFeeRate ?? 0.001) * 100).toFixed(2)}%
          </div>
        </div>

        {/* TAB 1: CCXT UNIFIED EXECUTION & OPEN POSITIONS */}
        {activeTab === 'EXECUTION' && (
          <div className="space-y-4">
            {/* Compact CCXT Standardized Signal Dispatch Bar */}
            <div className="rounded-lg border border-slate-800/80 bg-[#050914]/70 p-3.5">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
                  Unified CCXT AI Signal Router
                </h3>
                <span className="text-[11px] font-mono text-slate-400">
                  All AI signals normalized &amp; risk-checked before routing
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-7">
                <label className="block">
                  <span className="block text-[10px] font-mono uppercase text-slate-400 mb-1">Exchange</span>
                  <select
                    aria-label="CCXT Exchange"
                    data-testid="ft-exchange-select"
                    value={exchange}
                    onChange={(e) => setExchange(e.target.value as UnifiedExchangeId)}
                    className="w-full rounded-md border border-slate-700 bg-[#0b1324] px-2.5 py-1.5 text-xs font-mono text-white focus:border-cyan-400 focus:outline-none"
                  >
                    <option value="binance">Binance</option>
                    <option value="bybit">Bybit</option>
                    <option value="okx">OKX</option>
                    <option value="kraken">Kraken</option>
                  </select>
                </label>

                <label className="block">
                  <span className="block text-[10px] font-mono uppercase text-slate-400 mb-1">Market</span>
                  <select
                    aria-label="Market Type"
                    data-testid="ft-market-select"
                    value={marketType}
                    onChange={(e) => setMarketType(e.target.value as UnifiedMarketType)}
                    className="w-full rounded-md border border-slate-700 bg-[#0b1324] px-2.5 py-1.5 text-xs font-mono text-white focus:border-cyan-400 focus:outline-none"
                  >
                    <option value="SPOT">SPOT</option>
                    <option value="FUTURES">FUTURES</option>
                  </select>
                </label>

                <label className="block">
                  <span className="block text-[10px] font-mono uppercase text-slate-400 mb-1">Pair</span>
                  <select
                    aria-label="Trading Pair"
                    data-testid="ft-symbol-select"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-[#0b1324] px-2.5 py-1.5 text-xs font-mono text-white focus:border-cyan-400 focus:outline-none"
                  >
                    {SYMBOL_PRESETS.map((sym) => (
                      <option key={sym} value={sym}>
                        {sym}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="block text-[10px] font-mono uppercase text-slate-400 mb-1">Side</span>
                  <select
                    aria-label="Order Side"
                    data-testid="ft-side-select"
                    value={side}
                    onChange={(e) => setSide(e.target.value as UnifiedOrderSide)}
                    className="w-full rounded-md border border-slate-700 bg-[#0b1324] px-2.5 py-1.5 text-xs font-mono text-white focus:border-cyan-400 focus:outline-none"
                  >
                    <option value="BUY">BUY / LONG</option>
                    <option value="SELL">SELL / SHORT</option>
                  </select>
                </label>

                <label className="block">
                  <span className="block text-[10px] font-mono uppercase text-slate-400 mb-1">Stake (USD)</span>
                  <input
                    type="number"
                    min={10}
                    max={25000}
                    step={50}
                    value={stakeUsd}
                    onChange={(e) => setStakeUsd(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-[#0b1324] px-2.5 py-1.5 text-xs font-mono tabular-nums text-white focus:border-cyan-400 focus:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="block text-[10px] font-mono uppercase text-slate-400 mb-1">Leverage</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    disabled={marketType === 'SPOT'}
                    value={marketType === 'SPOT' ? '1' : leverage}
                    onChange={(e) => setLeverage(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-[#0b1324] px-2.5 py-1.5 text-xs font-mono tabular-nums text-white disabled:opacity-50 focus:border-cyan-400 focus:outline-none"
                  />
                </label>

                <div className="flex items-end">
                  <ForgeInteractiveButton
                    label="Route Signal"
                    intent="primary"
                    disabled={busy}
                    testId="ft-execute-signal-btn"
                    icon={<Send className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => void handleExecuteSignal()}
                  />
                </div>
              </div>
            </div>

            {/* Open Positions Table */}
            <div className="overflow-x-auto rounded-lg border border-slate-800/80 bg-[#050914]/70">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800/90 text-[11px] font-mono uppercase text-slate-400">
                    <th className="px-3 py-2">ID</th>
                    <th className="px-3 py-2">Venue / Mode</th>
                    <th className="px-3 py-2">Pair</th>
                    <th className="px-3 py-2">Side</th>
                    <th className="px-3 py-2 text-right">Entry → Mark</th>
                    <th className="px-3 py-2 text-right">Hard SL / TP / Trail</th>
                    <th className="px-3 py-2 text-right">Unrealized</th>
                    <th className="px-3 py-2 text-right">Controls</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                  {(!snapshot || snapshot.openPositions.length === 0) ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center font-sans text-xs text-slate-400">
                        No open positions in SQLite Dry-Run engine. Route an AI signal above to test CCXT
                        risk gates and trailing stop protection.
                      </td>
                    </tr>
                  ) : (
                    snapshot.openPositions.map((pos) => (
                      <tr key={pos.tradeId} data-testid={`ft-open-row-${pos.tradeId}`} className="hover:bg-slate-900/40">
                        <td className="px-3 py-2.5 text-slate-300">#{pos.tradeId}</td>
                        <td className="px-3 py-2.5">
                          <span className="text-white uppercase">{pos.exchange}</span>
                          <span className="ml-1.5 text-[10px] text-slate-400">
                            {pos.marketType} · {pos.tradingMode === 'PAPER_DRY_RUN' ? 'PAPER' : pos.tradingMode}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-white">{pos.symbol}</td>
                        <td className="px-3 py-2.5">
                          <span className={pos.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}>
                            {pos.side} {pos.leverage}x
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-slate-200">
                          ${formatPrice(pos.entryPrice)} → ${formatPrice(pos.currentPrice)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-[11px]">
                          <span className="text-rose-400">${formatPrice(pos.stopLoss)}</span>
                          <span className="mx-1 text-slate-600">/</span>
                          <span className="text-emerald-400">${formatPrice(pos.takeProfit)}</span>
                          {pos.trailingStop !== null && (
                            <span className="ml-1.5 text-cyan-300">
                              T:${formatPrice(pos.trailingStop)}
                            </span>
                          )}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-semibold ${
                            pos.unrealizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatUsd(pos.unrealizedPnlUsd, true)}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={busy}
                              data-testid={`ft-close-mkt-${pos.tradeId}`}
                              onClick={() => void handleClosePosition(pos)}
                              className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-300 hover:text-white cursor-pointer"
                            >
                              Close @ Live Market
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: AUTOMATED TELEGRAM RPC & SYSTEM AUDIT LOGS */}
        {activeTab === 'RPC_AUDIT' && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Telegram RPC Handler Panel */}
            <div className="rounded-lg border border-slate-800/80 bg-[#050914]/70 p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Bot className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                  Automated Telegram Bot RPC
                </h3>
                <span className="text-[11px] font-mono text-slate-400">
                  {snapshot?.telegramConfigured ? 'Bot Token Connected' : 'Local RPC Console Ready'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {QUICK_RPC_COMMANDS.map((cmd) => (
                  <button
                    key={cmd}
                    type="button"
                    disabled={busy}
                    data-testid={`ft-rpc-${cmd.slice(1)}`}
                    onClick={() => void handleRunRpc(cmd)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-[#0b1324] px-2.5 py-1 text-xs font-mono text-cyan-300 hover:border-cyan-400 hover:text-white transition-colors cursor-pointer"
                  >
                    {cmd === '/start' && <Play className="h-3 w-3 text-emerald-400" aria-hidden="true" />}
                    {cmd === '/stop' && <Square className="h-3 w-3 text-rose-400" aria-hidden="true" />}
                    <span>{cmd}</span>
                  </button>
                ))}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleRunRpc(rpcInput);
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  aria-label="Telegram RPC command"
                  value={rpcInput}
                  onChange={(e) => setRpcInput(e.target.value)}
                  placeholder="/status"
                  className="flex-1 rounded-md border border-slate-700 bg-[#0b1324] px-3 py-1.5 text-xs font-mono text-white focus:border-cyan-400 focus:outline-none"
                />
                <ForgeInteractiveButton
                  label="Send RPC"
                  intent="secondary"
                  disabled={busy}
                  onClick={() => void handleRunRpc(rpcInput)}
                />
              </form>

              <div
                data-testid="ft-rpc-transcript"
                className="max-h-60 space-y-2 overflow-y-auto rounded-md border border-slate-800/80 bg-[#030712] p-2.5 font-mono text-[11px]"
              >
                {(!snapshot || snapshot.rpcLogs.length === 0) ? (
                  <div className="text-slate-500">
                    Trigger /start, /stop, /status, or /profit to inspect live RPC command responses.
                  </div>
                ) : (
                  snapshot.rpcLogs.map((entry) => (
                    <div key={entry.id} className="border-b border-slate-800/70 pb-2 last:border-b-0 last:pb-0">
                      <div className="flex items-center justify-between text-cyan-400">
                        <span>{entry.command}</span>
                        <span className="text-[10px] text-slate-500">
                          {new Date(entry.timestampIso).toLocaleTimeString()}
                        </span>
                      </div>
                      <pre className="mt-1 whitespace-pre-wrap text-slate-200 leading-relaxed">
                        {entry.response}
                      </pre>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Real-Time System Audit Log Panel */}
            <div className="rounded-lg border border-slate-800/80 bg-[#050914]/70 p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                  Real-Time System Audit Logs
                </h3>
                <ForgeInteractiveButton
                  label="Record Audit"
                  intent="primary"
                  disabled={busy}
                  testId="ft-dispatch-audit-btn"
                  onClick={() => void handleDispatchAudit()}
                />
              </div>

              <div
                data-testid="ft-audit-list"
                className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-slate-800/80 bg-[#030712] p-2.5 font-mono text-[11px]"
              >
                {(!snapshot || snapshot.systemAudits.length === 0) ? (
                  <div className="text-slate-500">No system audit logs recorded yet.</div>
                ) : (
                  snapshot.systemAudits.map((audit) => (
                    <div
                      key={audit.id}
                      className="rounded border border-slate-800/80 bg-[#091122]/80 p-2.5 space-y-1"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                        <span className="text-cyan-300 font-semibold">{audit.tradingMode}</span>
                        <span>
                          CPU {audit.cpuPct.toFixed(1)}% · Mem {audit.memoryMb.toFixed(1)} MB · Latency{' '}
                          {audit.latencyMs.toFixed(1)} ms · Err {audit.executionErrors}
                        </span>
                      </div>
                      <pre className="whitespace-pre-wrap text-slate-200 leading-relaxed">
                        {audit.formattedMessage}
                      </pre>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: SQLITE CLOSED TRADES LEDGER */}
        {activeTab === 'LEDGER' && (
          <div className="overflow-x-auto rounded-lg border border-slate-800/80 bg-[#050914]/70">
            <div className="flex items-center justify-between border-b border-slate-800/90 px-3.5 py-2.5 text-xs">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
                SQLite Dry-Run Closed Trade Ledger
              </span>
              <span className="font-mono text-[11px] text-slate-400">
                Streak {metrics?.consecutivePaperWins ?? 0}/{metrics?.requiredPaperWins ?? 50}
              </span>
            </div>
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800/90 text-[11px] font-mono uppercase text-slate-400">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Venue</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2">Pair</th>
                  <th className="px-3 py-2 text-right">Entry → Exit</th>
                  <th className="px-3 py-2 text-right">Net PnL</th>
                  <th className="px-3 py-2">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                {(!snapshot || snapshot.closedTrades.length === 0) ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center font-sans text-xs text-slate-400">
                      No closed trades persisted in SQLite yet. Close an open paper trade to record PnL and
                      advance the 50-win Live Gate.
                    </td>
                  </tr>
                ) : (
                  snapshot.closedTrades.map((trade) => (
                    <tr key={trade.tradeId} className="hover:bg-slate-900/40">
                      <td className="px-3 py-2 text-slate-300">#{trade.tradeId}</td>
                      <td className="px-3 py-2 uppercase text-white">
                        {trade.exchange} <span className="text-slate-500">{trade.marketType}</span>
                      </td>
                      <td className="px-3 py-2 text-slate-300">{trade.tradingMode}</td>
                      <td className="px-3 py-2 text-white">{trade.symbol}</td>
                      <td className="px-3 py-2 text-right text-slate-200">
                        ${formatPrice(trade.entryPrice)} → ${formatPrice(trade.currentPrice)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-semibold ${
                          trade.realizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {formatUsd(trade.realizedPnlUsd, true)}
                      </td>
                      <td className="px-3 py-2 text-slate-400">{trade.closeReason}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 4: REFACTORED PYTHON CORE & CONFIG TEMPLATES */}
        {activeTab === 'CORE_CODE' && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            <div className="lg:col-span-4 space-y-1.5 rounded-lg border border-slate-800/80 bg-[#050914]/70 p-3">
              <div className="text-[11px] font-mono uppercase text-slate-400 mb-2 flex items-center gap-1.5">
                <Code2 className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
                signal_forge_core/
              </div>
              {(snapshot?.coreSourceModules ?? []).map((mod) => {
                const active = selectedModuleId === mod.id;
                return (
                  <button
                    key={mod.id}
                    type="button"
                    data-testid={`ft-src-${mod.id}`}
                    onClick={() => void loadCoreSource(mod.id)}
                    className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors cursor-pointer ${
                      active
                        ? 'border-cyan-400/60 bg-cyan-500/15 text-white'
                        : 'border-slate-800 bg-[#081020] text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-mono text-xs font-semibold truncate">{mod.relativePath}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400 line-clamp-2">{mod.summary}</div>
                  </button>
                );
              })}
            </div>

            <div className="lg:col-span-8 rounded-lg border border-slate-800/80 bg-[#030712] overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-800 px-3.5 py-2 text-xs">
                <span className="font-mono text-cyan-300 truncate">
                  {activeSourceDoc?.path ?? 'Loading module...'}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopySource()}
                  className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-200 hover:border-cyan-400 cursor-pointer"
                >
                  {copiedSource ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" aria-hidden="true" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <pre
                data-testid="ft-source-viewer"
                className="max-h-80 overflow-auto p-3.5 font-mono text-[11px] leading-relaxed text-slate-200"
              >
                {sourceLoading
                  ? 'Loading allowlisted source module...'
                  : activeSourceDoc?.content ?? 'Select a refactored module to inspect.'}
              </pre>
            </div>
          </div>
        )}
      </div>
    </ForgeWidgetFrame>
  );
});

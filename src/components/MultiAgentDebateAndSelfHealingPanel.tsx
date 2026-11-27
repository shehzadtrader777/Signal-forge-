import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BrainCircuit,
  Clock,
  ExternalLink,
  Globe,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../lib/apiClient';
import { formatCryptoPrice } from '../lib/marketData';
import type {
  MultiAgentDebateResult,
  SearchGroundingResult,
  SelfHealingHealthSnapshot,
  YearnDegradationSnapshot,
} from '../lib/multiAgentDebateEngine';
import type { TokenBucketTelemetry } from '../lib/tokenBucketLimiter';
import type { WidgetLayoutContract, WidgetMetricItem } from '../lib/designSystem';
import {
  ForgeInteractiveButton,
  ForgeMetricStrip,
  ForgeSegmentedControl,
  ForgeWidgetFrame,
} from './ui/ForgeDesignSystem';

const WIDGET_LAYOUT: WidgetLayoutContract = {
  widgetId: 'multi-agent-debate-self-healing',
  ariaLabel: 'Multi-Agent Debate Consensus Coordinator, Search Grounding & Self-Healing Probes',
  colSpanDesktop: 12,
  elevation: 'SURFACE',
  gpuContain: true,
  showStreamRail: true,
};

type HubTab = 'DEBATE_COORDINATOR' | 'SEARCH_GROUNDING' | 'SELF_HEALING_VAULT';

interface HealthApiResponse {
  readonly ok?: boolean;
  readonly status?: 'healthy' | 'degraded';
  readonly selfHealing?: SelfHealingHealthSnapshot;
  readonly tokenBucket?: TokenBucketTelemetry;
  readonly vaultDegradation?: YearnDegradationSnapshot;
}

function formatDurationHms(seconds: number): string {
  const clean = Math.max(0, Math.floor(seconds));
  const h = Math.floor(clean / 3600);
  const m = Math.floor((clean % 3600) / 60);
  const s = clean % 60;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

export const MultiAgentDebateAndSelfHealingPanel = memo(
  function MultiAgentDebateAndSelfHealingPanel() {
    const { appLiveEnabled, selectedSymbol, tickers, signalTimeframe } = useApp();
    const [activeTab, setActiveTab] = useState<HubTab>('DEBATE_COORDINATOR');

    // Health, Token Bucket, and 6h Yearn Locked Profit Degradation state
    const [healthSnap, setHealthSnap] = useState<SelfHealingHealthSnapshot | null>(null);
    const [bucketTelemetry, setBucketTelemetry] = useState<TokenBucketTelemetry | null>(null);
    const [degradation, setDegradation] = useState<YearnDegradationSnapshot | null>(null);
    const [refreshingHealth, setRefreshingHealth] = useState(false);

    // Multi-Agent Debate Coordinator state
    const [debateSymbol, setDebateSymbol] = useState(selectedSymbol || 'BTCUSDT');
    const [debateRounds, setDebateRounds] = useState<1 | 2>(2);
    const [debateNotes, setDebateNotes] = useState('');
    const [runningDebate, setRunningDebate] = useState(false);
    const [debateResult, setDebateResult] = useState<MultiAgentDebateResult | null>(null);
    const [debateError, setDebateError] = useState<string | null>(null);

    // Google Search Grounding state
    const [groundingQuery, setGroundingQuery] = useState(
      'Latest Bitcoin ETF inflows, Fed liquidity outlook, and crypto market catalysts today'
    );
    const [runningGrounding, setRunningGrounding] = useState(false);
    const [groundingResult, setGroundingResult] = useState<SearchGroundingResult | null>(null);
    const [groundingError, setGroundingError] = useState<string | null>(null);

    useEffect(() => {
      if (selectedSymbol) {
        setDebateSymbol(selectedSymbol);
      }
    }, [selectedSymbol]);

    const fetchHealth = useCallback(async () => {
      setRefreshingHealth(true);
      try {
        const res = await fetch('/api/self-healing/health');
        if (!res.ok) return;
        const data = (await res.json()) as HealthApiResponse;
        if (data?.ok) {
          if (data.selfHealing) setHealthSnap(data.selfHealing);
          if (data.tokenBucket) setBucketTelemetry(data.tokenBucket);
          if (data.vaultDegradation) setDegradation(data.vaultDegradation);
        }
      } catch {
        // preserve prior telemetry snapshot
      } finally {
        setRefreshingHealth(false);
      }
    }, []);

    useEffect(() => {
      void fetchHealth();
    }, [fetchHealth]);

    useEffect(() => {
      if (!appLiveEnabled) return;
      const id = window.setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        void fetchHealth();
      }, 15_000);
      return () => window.clearInterval(id);
    }, [appLiveEnabled, fetchHealth]);

    const handleRunDebate = useCallback(async () => {
      setRunningDebate(true);
      setDebateError(null);
      const sym = debateSymbol.trim().toUpperCase() || 'BTCUSDT';
      const activeTicker = tickers[sym];
      try {
        const res = await apiFetch('/api/v1/signals/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: sym,
            timeframe: signalTimeframe || '15m',
            livePrice: activeTicker?.price,
            change24hPercent: activeTicker?.change24hPercent,
            volume24hUsd: activeTicker?.volume24hUsd,
            rounds: debateRounds,
            notes: debateNotes.trim() || undefined,
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          result?: MultiAgentDebateResult;
          error?: string;
        };
        if (!res.ok || !data?.ok || !data.result) {
          setDebateError(data?.error || `Coordinator returned HTTP ${res.status}.`);
          return;
        }
        setDebateResult(data.result);
        void fetchHealth();
      } catch {
        setDebateError('Network error invoking Multi-Agent Debate Coordinator.');
      } finally {
        setRunningDebate(false);
      }
    }, [debateSymbol, tickers, signalTimeframe, debateRounds, debateNotes, fetchHealth]);

    const handleRunGrounding = useCallback(async () => {
      const q = groundingQuery.trim();
      if (!q) {
        setGroundingError('Enter a crypto market question to run Search Grounding.');
        return;
      }
      setRunningGrounding(true);
      setGroundingError(null);
      try {
        const res = await apiFetch('/api/v1/search/grounding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          grounding?: SearchGroundingResult;
          error?: string;
        };
        if (!res.ok || !data?.ok || !data.grounding) {
          setGroundingError(data?.error || `Search Grounding returned HTTP ${res.status}.`);
          return;
        }
        setGroundingResult(data.grounding);
        void fetchHealth();
      } catch {
        setGroundingError('Network error running Google Search Grounding.');
      } finally {
        setRunningGrounding(false);
      }
    }, [groundingQuery, fetchHealth]);

    const metrics: readonly WidgetMetricItem[] = useMemo(
      () => [
        {
          id: 'health-status',
          label: 'Self-Healing Health',
          value: healthSnap ? healthSnap.status.toUpperCase() : 'PROBING',
          subtext: healthSnap
            ? `Telegram: ${healthSnap.checks.telegramMode.toUpperCase()} · ${healthSnap.autoFailoverCount} failovers`
            : '30s probe supervisor',
          tone: healthSnap?.status === 'healthy' ? 'NOMINAL' : 'WARNING',
        },
        {
          id: 'token-bucket',
          label: 'Token Bucket Limiter',
          value: bucketTelemetry
            ? `${bucketTelemetry.rpm} RPM / ${bucketTelemetry.burst} Burst`
            : '200 RPM / 50 Burst',
          subtext: bucketTelemetry
            ? `${bucketTelemetry.totalAllowed} allowed · ${bucketTelemetry.totalRejected} throttled`
            : 'Atomic per-identity quota',
          tone: 'INFO',
        },
        {
          id: 'gemini-engine',
          label: 'Gemini Debate & Search',
          value:
            healthSnap?.checks.geminiApi === 'healthy'
              ? 'READY'
              : healthSnap?.checks.geminiApi === 'unconfigured'
              ? 'KEY NEEDED'
              : 'CHECKING',
          subtext: '3 Kernels · 2-Round Debate · Search',
          tone: healthSnap?.checks.geminiApi === 'healthy' ? 'NOMINAL' : 'WARNING',
        },
        {
          id: 'yearn-6h-vault',
          label: '6h Profit Degradation',
          value: degradation ? `$${degradation.currentLockedProfitUsd.toFixed(2)}` : '$0.00',
          subtext: degradation
            ? `Free $${degradation.currentFreeProfitUsd.toFixed(2)} · ${degradation.unlockedPercent.toFixed(1)}% unlocked`
            : 'Yearn V2 linear unlock',
          tone: 'NOMINAL',
        },
      ],
      [healthSnap, bucketTelemetry, degradation]
    );

    const tabOptions = useMemo(
      () => [
        { value: 'DEBATE_COORDINATOR' as const, label: 'Debate Coordinator' },
        { value: 'SEARCH_GROUNDING' as const, label: 'Search Grounding' },
        { value: 'SELF_HEALING_VAULT' as const, label: 'Self-Healing & 6h Vault' },
      ],
      []
    );

    return (
      <ForgeWidgetFrame
        layout={WIDGET_LAYOUT}
        title="Multi-Agent Debate Coordinator, Search Grounding & Self-Healing Hub"
        icon={<BrainCircuit className="h-4 w-4 text-cyan-400" />}
        metadata={[
          {
            id: 'debate-kernels',
            label: 'Kernels',
            value: 'Strategy · Indicator · Backtest',
            tone: 'INFO',
          },
          {
            id: 'risk-floor',
            label: 'Risk Kernel',
            value: '<= 2.0% SL · >= 1:5 R:R',
            tone: 'NOMINAL',
          },
          {
            id: 'telegram-mode',
            label: 'Transport',
            value: healthSnap ? healthSnap.checks.telegramMode.toUpperCase() : 'WEBHOOK',
            tone: healthSnap?.checks.telegramMode === 'polling' ? 'WARNING' : 'NOMINAL',
          },
        ]}
        actions={
          <ForgeSegmentedControl<HubTab>
            ariaLabel="Multi-Agent Debate and Self-Healing Tabs"
            layoutGroupId="debate-self-healing-tabs"
            options={tabOptions}
            value={activeTab}
            onChange={setActiveTab}
          />
        }
      >
        <div className="space-y-5">
          <ForgeMetricStrip items={metrics} />

          {activeTab === 'DEBATE_COORDINATOR' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/65 p-4 space-y-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <label className="space-y-1">
                    <span className="block text-[11px] font-medium text-slate-400">Trading Pair</span>
                    <input
                      aria-label="Debate Coordinator Trading Pair"
                      type="text"
                      value={debateSymbol}
                      onChange={(e) => setDebateSymbol(e.target.value.toUpperCase())}
                      placeholder="BTCUSDT"
                      className="w-full rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-2 font-mono text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="block text-[11px] font-medium text-slate-400">Debate Rounds</span>
                    <select
                      aria-label="Debate Rounds"
                      value={debateRounds}
                      onChange={(e) => setDebateRounds(Number(e.target.value) === 1 ? 1 : 2)}
                      className="w-full rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-2 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                    >
                      <option value={2}>2 Rounds (Standard Consensus)</option>
                      <option value={1}>1 Round (Fast Critique)</option>
                    </select>
                  </label>

                  <label className="space-y-1 md:col-span-2">
                    <span className="block text-[11px] font-medium text-slate-400">
                      Operator Context / Regime Note (Optional)
                    </span>
                    <input
                      aria-label="Debate Context Notes"
                      type="text"
                      value={debateNotes}
                      onChange={(e) => setDebateNotes(e.target.value)}
                      placeholder="e.g. London session sweep, high funding skew"
                      className="w-full rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-2 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <span className="font-mono text-[11px] text-slate-400">
                    Parallel StrategyAgent + IndicatorAgent + BacktestAgent → DebateEngine → Risk-Verified Coordinator
                  </span>
                  <ForgeInteractiveButton
                    intent="primary"
                    label={runningDebate ? 'Running Multi-Agent Debate...' : 'Run Multi-Agent Debate'}
                    disabled={runningDebate}
                    onClick={handleRunDebate}
                    icon={<Sparkles className="h-3.5 w-3.5" />}
                  />
                </div>
              </div>

              {debateError && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200"
                >
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                  <span className="font-mono leading-relaxed">{debateError}</span>
                </div>
              )}

              {debateResult && (
                <div className="space-y-4">
                  {/* Final Risk-Kernel-Verified Coordinator Decision */}
                  <div className="rounded-xl border border-emerald-500/30 bg-slate-950/75 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-emerald-400" />
                        <span className="font-mono text-xs font-semibold text-white">
                          COORDINATOR FINAL DECISION · {debateResult.decision.symbol} ·{' '}
                          <span
                            className={
                              debateResult.decision.direction === 'BUY'
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }
                          >
                            {debateResult.decision.direction}
                          </span>
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-400">
                        {debateResult.modelUsed} · {debateResult.totalLatencyMs}ms
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 font-mono text-xs sm:grid-cols-6">
                      <div>
                        <span className="block text-[10px] text-slate-400">Entry</span>
                        <span className="font-semibold tabular-nums text-white">
                          ${formatCryptoPrice(debateResult.decision.entry)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-400">Take Profit</span>
                        <span className="font-semibold tabular-nums text-emerald-400">
                          ${formatCryptoPrice(debateResult.decision.tp)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-400">Stop Loss</span>
                        <span className="font-semibold tabular-nums text-rose-400">
                          ${formatCryptoPrice(debateResult.decision.sl)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-400">Risk / Reward</span>
                        <span className="font-semibold tabular-nums text-cyan-300">
                          1:{debateResult.decision.riskRewardRatio.toFixed(2)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-400">Confidence</span>
                        <span className="font-semibold tabular-nums text-white">
                          {debateResult.decision.confidence}%
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-400">Leverage</span>
                        <span className="font-semibold tabular-nums text-amber-300">
                          {debateResult.decision.leverage}x
                        </span>
                      </div>
                    </div>

                    <p className="text-xs leading-relaxed text-slate-300">
                      {debateResult.decision.rationale}
                    </p>
                    <div className="font-mono text-[11px] text-emerald-300/90">
                      {debateResult.decision.riskKernelNotes}
                    </div>
                  </div>

                  {/* 3 Kernel Proposals */}
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                    {debateResult.proposals.map((prop) => (
                      <div
                        key={prop.role}
                        className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3.5 space-y-2"
                      >
                        <div className="flex items-center justify-between font-mono text-[11px]">
                          <span className="font-semibold text-cyan-300">{prop.label}</span>
                          <span
                            className={
                              prop.bias === 'BUY'
                                ? 'text-emerald-400'
                                : prop.bias === 'SELL'
                                ? 'text-rose-400'
                                : 'text-slate-400'
                            }
                          >
                            {prop.bias} · {prop.confidence}%
                          </span>
                        </div>
                        <p className="text-xs leading-relaxed text-slate-300">{prop.summary}</p>
                        {prop.keyLevels.length > 0 && (
                          <div className="font-mono text-[10px] text-slate-400">
                            Levels: {prop.keyLevels.join(' · ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Debate Rounds */}
                  <div className="space-y-2">
                    {debateResult.debateRounds.map((round) => (
                      <div
                        key={round.round}
                        className="rounded-lg border border-slate-800/70 bg-slate-900/50 px-3.5 py-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between font-mono text-[11px] text-slate-400">
                          <span>Debate Round #{round.round}</span>
                          <span>
                            Consensus: <strong className="text-white">{round.consensusBias}</strong> ·
                            Agreement: <strong className="text-cyan-300">{round.agreementScore}%</strong>
                          </span>
                        </div>
                        <p className="mt-1 leading-relaxed text-slate-300">{round.critique}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'SEARCH_GROUNDING' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/65 p-4 space-y-3">
                <label className="space-y-1.5 block">
                  <span className="block text-[11px] font-medium text-slate-400">
                    Real-Time Crypto Macro & Market Grounding Query (Google Search Grounded)
                  </span>
                  <input
                    aria-label="Search Grounding Query"
                    type="text"
                    value={groundingQuery}
                    onChange={(e) => setGroundingQuery(e.target.value)}
                    placeholder="Ask about recent ETF flows, protocol upgrades, or macro releases..."
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                  />
                </label>

                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-slate-400">
                    Server-side Gemini Google Search Grounding with verified source citations
                  </span>
                  <ForgeInteractiveButton
                    intent="primary"
                    label={runningGrounding ? 'Searching Web...' : 'Run Grounded Search'}
                    disabled={runningGrounding}
                    onClick={handleRunGrounding}
                    icon={<Globe className="h-3.5 w-3.5" />}
                  />
                </div>
              </div>

              {groundingError && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200"
                >
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                  <span className="font-mono leading-relaxed">{groundingError}</span>
                </div>
              )}

              {groundingResult && (
                <div className="rounded-xl border border-slate-800/80 bg-slate-950/75 p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2 font-mono text-[11px] text-slate-400">
                    <span>Grounded Intelligence ({groundingResult.modelUsed})</span>
                    <span>{groundingResult.latencyMs}ms</span>
                  </div>
                  <div className="whitespace-pre-wrap text-xs leading-relaxed text-slate-200">
                    {groundingResult.answer}
                  </div>
                  {groundingResult.citations.length > 0 && (
                    <div className="border-t border-slate-800/80 pt-3 space-y-1.5">
                      <span className="block font-mono text-[10px] uppercase tracking-wider text-slate-400">
                        Verified Web Citations ({groundingResult.citations.length})
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {groundingResult.citations.map((cite) => (
                          <a
                            key={cite.uri}
                            href={cite.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded border border-slate-700/80 bg-slate-900 px-2.5 py-1 text-[11px] text-cyan-300 transition-colors hover:border-cyan-400/50 hover:text-cyan-200"
                          >
                            <ExternalLink className="h-3 w-3 shrink-0" />
                            <span className="max-w-[240px] truncate">{cite.title}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'SELF_HEALING_VAULT' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Self-Healing Subsystem Probes */}
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/65 p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-emerald-400" />
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-100">
                      Self-Healing Health Probes (/health)
                    </h4>
                  </div>
                  <ForgeInteractiveButton
                    intent="secondary"
                    label={refreshingHealth ? 'Probing...' : 'Probe Now'}
                    disabled={refreshingHealth}
                    onClick={fetchHealth}
                    icon={<RefreshCw className="h-3.5 w-3.5" />}
                  />
                </div>

                <div className="divide-y divide-slate-800/70 font-mono text-xs">
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-400">State & Cache Store</span>
                    <span className="text-emerald-400">
                      {healthSnap?.checks.cacheStore.toUpperCase() ?? 'HEALTHY'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-400">Binance Live WS / Spot Feed</span>
                    <span
                      className={
                        healthSnap?.checks.binanceFeed === 'healthy'
                          ? 'text-emerald-400'
                          : 'text-amber-300'
                      }
                    >
                      {healthSnap?.checks.binanceFeed.toUpperCase() ?? 'CHECKING'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-400">Gemini Server-Side API</span>
                    <span
                      className={
                        healthSnap?.checks.geminiApi === 'healthy'
                          ? 'text-emerald-400'
                          : 'text-amber-300'
                      }
                    >
                      {healthSnap?.checks.geminiApi.toUpperCase() ?? 'CHECKING'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-400">Locker Vault Hash Chain</span>
                    <span className="text-emerald-400">
                      {healthSnap?.checks.vaultIntegrity.toUpperCase() ?? 'HEALTHY'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-400">Telegram Failover Transport</span>
                    <span className="text-cyan-300">
                      {healthSnap?.checks.telegramMode.toUpperCase() ?? 'WEBHOOK'}
                    </span>
                  </div>
                </div>

                <p className="font-mono text-[11px] text-slate-400">
                  Last Supervisor Action: {healthSnap?.lastAction ?? 'Initializing 30s health loop'}
                </p>
              </div>

              {/* Yearn V2 6h Accumulating Locked Profit Degradation */}
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/65 p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-cyan-400" />
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-100">
                      Yearn V2 6-Hour Locked Profit Degradation
                    </h4>
                  </div>
                  <span className="font-mono text-[11px] text-cyan-300">
                    Window: {degradation?.unlockDurationHours ?? 6}h Linear
                  </span>
                </div>

                <p className="text-xs leading-relaxed text-slate-400">
                  Companion smoothing curve synced with the Immutable Locker Vault. Hardened to
                  accumulate consecutive profit reports without overwriting previously locked batches.
                </p>

                <div className="space-y-1.5 rounded-lg border border-slate-800/70 bg-slate-900/50 p-3 font-mono text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Total Reported Profit</span>
                    <span className="tabular-nums text-white">
                      ${(degradation?.totalReportedGainUsd ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Currently Locked (Degrading)</span>
                    <span className="tabular-nums text-amber-300">
                      ${(degradation?.currentLockedProfitUsd ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Free / Unlocked Profit</span>
                    <span className="tabular-nums text-emerald-400">
                      ${(degradation?.currentFreeProfitUsd ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Remaining Unlock Window</span>
                    <span className="tabular-nums text-cyan-300">
                      {formatDurationHms(degradation?.remainingUnlockSec ?? 0)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </ForgeWidgetFrame>
    );
  }
);

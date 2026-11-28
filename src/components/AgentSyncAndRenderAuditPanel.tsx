import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Database, Gauge, RefreshCw, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../lib/apiClient';
import { formatCryptoPrice } from '../lib/marketData';
import type { MultiAgentSyncSnapshot } from '../lib/agentSyncEngine';
import type { SmartMarketRouterStatus } from '../lib/smartMarketDataRouter';
import type { WidgetLayoutContract, WidgetMetricItem } from '../lib/designSystem';
import {
  ForgeInteractiveButton,
  ForgeMetricStrip,
  ForgeWidgetFrame,
} from './ui/ForgeDesignSystem';

const WIDGET_LAYOUT: WidgetLayoutContract = {
  widgetId: 'agent-sync-render-audit',
  ariaLabel: 'Multi-Agent Data Provenance, Market Router & Frame Pacing Audit',
  colSpanDesktop: 12,
  elevation: 'SURFACE',
  gpuContain: true,
  showStreamRail: false,
};

interface FrameProbeTelemetry {
  readonly measuredFps: number;
  readonly avgFrameMs: number;
  readonly droppedFrames: number;
  readonly sampled: boolean;
}

function formatProvenanceLabel(provenance: string | undefined): string {
  switch (provenance) {
    case 'LIVE_EXCHANGE':
      return 'Live Exchange';
    case 'CACHED_EXCHANGE':
      return 'Cached Exchange (Non-Exec)';
    case 'REFERENCE_AGGREGATED':
      return 'Reference Aggregated (Non-Exec)';
    case 'HISTORICAL_BACKTEST':
      return 'Historical Backtest';
    case 'SIMULATED_FIXTURE':
      return 'Simulated Fixture (Not Live)';
    case 'STALE_OR_UNAVAILABLE':
    default:
      return 'Stale / Unavailable';
  }
}

export const AgentSyncAndRenderAuditPanel = memo(function AgentSyncAndRenderAuditPanel() {
  const { appLiveEnabled, selectedSymbol } = useApp();
  const [syncSnapshot, setSyncSnapshot] = useState<MultiAgentSyncSnapshot | null>(null);
  const [routerStatus, setRouterStatus] = useState<SmartMarketRouterStatus | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [testingCoinGecko, setTestingCoinGecko] = useState(false);
  const [cgTestFeedback, setCgTestFeedback] = useState<string | null>(null);
  // Opt-in only: never run an infinite requestAnimationFrame loop in the background by default
  const [probeActive, setProbeActive] = useState(false);
  const [frameProbe, setFrameProbe] = useState<FrameProbeTelemetry>({
    measuredFps: 0,
    avgFrameMs: 0,
    droppedFrames: 0,
    sampled: false,
  });

  const fetchSyncState = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/sync-state');
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok?: boolean;
        sync?: MultiAgentSyncSnapshot;
        marketRouter?: SmartMarketRouterStatus;
      };
      if (data?.ok && data.sync) {
        setSyncSnapshot(data.sync);
      }
      if (data?.marketRouter) {
        setRouterStatus(data.marketRouter);
      }
    } catch {
      // keep previous snapshot cleanly
    }
  }, []);

  useEffect(() => {
    fetchSyncState();
  }, [fetchSyncState]);

  useEffect(() => {
    if (!appLiveEnabled) return;
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchSyncState();
    }, 12_000);
    return () => window.clearInterval(id);
  }, [appLiveEnabled, fetchSyncState]);

  // Opt-in browser requestAnimationFrame compositor cadence probe (never claims unmeasured FPS)
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!probeActive || typeof window === 'undefined') return;
    let frameCount = 0;
    let droppedFrames = 0;
    let windowStart = performance.now();
    let prevTs = windowStart;

    const tick = (now: number) => {
      if (typeof document !== 'undefined' && document.hidden) {
        windowStart = now;
        prevTs = now;
        frameCount = 0;
        droppedFrames = 0;
        rafRef.current = window.requestAnimationFrame(tick);
        return;
      }
      const delta = now - prevTs;
      prevTs = now;
      frameCount += 1;
      if (delta > 34) {
        droppedFrames += 1;
      }

      const elapsed = now - windowStart;
      if (elapsed >= 1200) {
        const fps = Math.round((frameCount * 1000) / Math.max(1, elapsed));
        const avgMs = Number((elapsed / Math.max(1, frameCount)).toFixed(2));
        setFrameProbe({
          measuredFps: Math.max(1, fps),
          avgFrameMs: avgMs,
          droppedFrames,
          sampled: true,
        });
        frameCount = 0;
        droppedFrames = 0;
        windowStart = now;
      }
      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [probeActive]);

  const handleForceReconcile = useCallback(async () => {
    setReconciling(true);
    try {
      const res = await apiFetch('/api/agents/sync-reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: selectedSymbol }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok?: boolean;
        sync?: MultiAgentSyncSnapshot;
        marketRouter?: SmartMarketRouterStatus;
      };
      if (data?.ok && data.sync) {
        setSyncSnapshot(data.sync);
      }
      if (data?.marketRouter) {
        setRouterStatus(data.marketRouter);
      }
    } finally {
      setReconciling(false);
    }
  }, [selectedSymbol]);

  const handleTestCoinGecko = useCallback(async () => {
    setTestingCoinGecko(true);
    setCgTestFeedback(null);
    try {
      const res = await apiFetch('/api/market/coingecko/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.status === 401 || res.status === 403) {
        setCgTestFeedback('Operator authentication required to run live CoinGecko probe.');
        return;
      }
      const data = (await res.json()) as {
        ok?: boolean;
        result?: { message?: string; connectionStatus?: string };
      };
      setCgTestFeedback(
        data?.result?.message ||
          (data?.ok ? 'CoinGecko read-only probe passed.' : 'CoinGecko probe did not pass.')
      );
      await fetchSyncState();
    } catch {
      setCgTestFeedback('Network error running CoinGecko read-only probe.');
    } finally {
      setTestingCoinGecko(false);
    }
  }, [fetchSyncState]);

  const metrics: readonly WidgetMetricItem[] = useMemo(() => {
    const provenance = syncSnapshot?.dataProvenance ?? 'STALE_OR_UNAVAILABLE';
    const isLiveSynced = Boolean(syncSnapshot?.liveDataSynchronized);
    return [
      {
        id: 'agent-lock',
        label: 'Live Exchange Agent Sync',
        value: syncSnapshot
          ? isLiveSynced
            ? `${syncSnapshot.synchronizedAgents}/${syncSnapshot.totalAgents} Live Locked`
            : `0/${syncSnapshot.totalAgents} Live (${syncSnapshot.dataQuality})`
          : 'Loading...',
        subtext: syncSnapshot
          ? `${formatProvenanceLabel(provenance)} · Epoch #${syncSnapshot.globalEpoch}`
          : 'Connecting',
        tone: isLiveSynced ? 'NOMINAL' : 'WARNING',
      },
      {
        id: 'market-router',
        label: 'Smart Market Router',
        value: routerStatus
          ? routerStatus.executionAllowed
            ? `EXECUTABLE (${routerStatus.primaryExchangeProvider})`
            : `EXEC PAUSED (${routerStatus.overallDataQuality})`
          : 'Checking...',
        subtext: routerStatus
          ? routerStatus.executionBlockReason ?? 'Verified live exchange feed active'
          : 'Provider priority: Binance > CoinGecko > CMC',
        tone: routerStatus?.executionAllowed ? 'NOMINAL' : 'WARNING',
      },
      {
        id: 'coingecko-health',
        label: 'CoinGecko Reference API',
        value: routerStatus
          ? routerStatus.providers.coingecko.detail.configured
            ? `${routerStatus.providers.coingecko.detail.tier.toUpperCase()} · ${routerStatus.providers.coingecko.detail.connectionStatus}`
            : 'PENDING KEY (Server-Only)'
          : 'Checking...',
        subtext: routerStatus
          ? `${routerStatus.providers.coingecko.detail.endpointHost} · Reference/Fallback Only`
          : 'Server-only COINGECKO_API_KEY',
        tone:
          routerStatus?.providers.coingecko.detail.connectionStatus === 'VERIFIED_LIVE'
            ? 'NOMINAL'
            : 'INFO',
      },
      {
        id: 'raf-pipeline',
        label: 'Measured Frame Pacing',
        value: probeActive
          ? frameProbe.sampled
            ? `${frameProbe.measuredFps} FPS (${frameProbe.avgFrameMs}ms)`
            : 'Sampling...'
          : 'Idle (Zero CPU)',
        subtext:
          probeActive && frameProbe.sampled
            ? `${frameProbe.droppedFrames} long frames (>34ms) in window`
            : 'Opt-in browser rAF diagnostic probe',
        tone: !probeActive ? 'INFO' : frameProbe.avgFrameMs <= 20 ? 'NOMINAL' : 'WARNING',
      },
    ];
  }, [syncSnapshot, routerStatus, probeActive, frameProbe]);

  return (
    <ForgeWidgetFrame
      layout={WIDGET_LAYOUT}
      title="Multi-Agent Data Provenance & Smart Market Router Audit"
      testId="agent-sync-render-audit-panel"
      icon={<ShieldCheck className="h-4 w-4 text-cyan-400 shrink-0" aria-hidden="true" />}
      metadata={[
        {
          id: 'k1',
          label: `Provenance: ${formatProvenanceLabel(syncSnapshot?.dataProvenance)}`,
          tone: syncSnapshot?.liveDataSynchronized ? 'NOMINAL' : 'WARNING',
        },
        {
          id: 'k2',
          label: syncSnapshot?.executionAllowed
            ? 'Execution Feed Verified'
            : 'Execution Guarded (Non-Live Feed)',
          tone: syncSnapshot?.executionAllowed ? 'NOMINAL' : 'WARNING',
        },
        {
          id: 'k3',
          label: `Provider: ${syncSnapshot?.providerName ?? 'none'}`,
          tone: 'INFO',
        },
      ]}
      actions={
        <>
          <ForgeInteractiveButton
            label={testingCoinGecko ? 'Testing CG...' : 'Test CoinGecko'}
            icon={<Database className="h-3.5 w-3.5" aria-hidden="true" />}
            intent="ghost"
            disabled={testingCoinGecko}
            testId="test-coingecko-btn"
            onClick={handleTestCoinGecko}
          />
          <ForgeInteractiveButton
            label={probeActive ? 'Stop Frame Probe' : 'Run Frame Probe'}
            icon={<Gauge className="h-3.5 w-3.5" aria-hidden="true" />}
            intent="ghost"
            ariaPressed={probeActive}
            onClick={() => setProbeActive((v) => !v)}
          />
          <ForgeInteractiveButton
            label={reconciling ? 'Reconciling...' : 'Sync All Agents'}
            icon={
              <RefreshCw
                className={`h-3.5 w-3.5 ${reconciling ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
            }
            intent="primary"
            disabled={reconciling}
            testId="force-sync-agents-btn"
            onClick={handleForceReconcile}
          />
        </>
      }
    >
      <div className="space-y-4">
        <ForgeMetricStrip items={metrics} columns={4} />

        {cgTestFeedback && (
          <div
            role="status"
            data-testid="coingecko-test-feedback"
            className="rounded-lg border border-cyan-500/35 bg-cyan-950/30 px-3.5 py-2 text-xs text-cyan-100"
          >
            {cgTestFeedback}
          </div>
        )}

        {/* Per-Agent Synchronized State & Provenance Ledger */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                <th className="py-2 pr-4">Autonomous Agent Module</th>
                <th className="py-2 pr-3 text-right">Epoch</th>
                <th className="py-2 pr-3 text-right">Anchor Price</th>
                <th className="py-2 pr-3 text-right">Data Provenance</th>
                <th className="py-2 pr-3 text-right">Provider</th>
                <th className="py-2 pr-3 text-right">Drift</th>
                <th className="py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-xs font-mono tabular-nums">
              {(syncSnapshot?.agents ?? []).map((agent) => {
                const statusText =
                  agent.status === 'SYNCHRONIZED'
                    ? 'Live Synchronized'
                    : agent.status === 'RECONCILING'
                    ? 'Reconciled (Live)'
                    : agent.status === 'DEGRADED_FALLBACK'
                    ? 'Fallback / Non-Exec'
                    : 'Paused (Stale/Unavail)';
                return (
                  <tr key={agent.agentId} className="hover:bg-slate-800/20 transition-colors">
                    <td className="py-2.5 pr-4 font-sans font-semibold text-white">
                      {agent.agentLabel}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-slate-300">#{agent.epoch}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-200">
                      {agent.authoritativePrice > 0
                        ? `$${formatCryptoPrice(agent.authoritativePrice)}`
                        : 'Unavailable'}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-sans text-[11px] text-slate-300">
                      {formatProvenanceLabel(agent.dataProvenance)}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-cyan-300">
                      {agent.providerName}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-emerald-400">
                      {agent.driftBps.toFixed(1)} bps
                    </td>
                    <td className="py-2.5 text-right">
                      <span
                        className={`inline-flex items-center gap-1 font-sans text-[11px] font-semibold ${
                          agent.status === 'SYNCHRONIZED'
                            ? 'text-emerald-400'
                            : agent.status === 'RECONCILING'
                            ? 'text-cyan-300'
                            : agent.status === 'DEGRADED_FALLBACK'
                            ? 'text-amber-300'
                            : 'text-rose-400'
                        }`}
                      >
                        {agent.status === 'SYNCHRONIZED' ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        ) : agent.status === 'RECONCILING' ? (
                          <Activity className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        )}
                        {statusText}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </ForgeWidgetFrame>
  );
});

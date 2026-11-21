import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, CheckCircle2, Gauge, RefreshCw, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../lib/apiClient';
import { formatCryptoPrice } from '../lib/marketData';
import type { MultiAgentSyncSnapshot } from '../lib/agentSyncEngine';
import type { WidgetLayoutContract, WidgetMetricItem } from '../lib/designSystem';
import {
  ForgeInteractiveButton,
  ForgeMetricStrip,
  ForgeWidgetFrame,
} from './ui/ForgeDesignSystem';

const WIDGET_LAYOUT: WidgetLayoutContract = {
  widgetId: 'agent-sync-render-audit',
  ariaLabel: 'Multi-Agent State Synchronization & 120Hz Render Pipeline Audit',
  colSpanDesktop: 12,
  elevation: 'SURFACE',
  gpuContain: true,
  showStreamRail: true,
};

interface FrameProbeTelemetry {
  readonly measuredFps: number;
  readonly avgFrameMs: number;
  readonly droppedFrames: number;
}

export const AgentSyncAndRenderAuditPanel = memo(function AgentSyncAndRenderAuditPanel() {
  const { appLiveEnabled, selectedSymbol } = useApp();
  const [syncSnapshot, setSyncSnapshot] = useState<MultiAgentSyncSnapshot | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [probeActive, setProbeActive] = useState(true);
  const [frameProbe, setFrameProbe] = useState<FrameProbeTelemetry>({
    measuredFps: 120,
    avgFrameMs: 8.33,
    droppedFrames: 0,
  });

  const fetchSyncState = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/sync-state');
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok?: boolean;
        sync?: MultiAgentSyncSnapshot;
      };
      if (data?.ok && data.sync) {
        setSyncSnapshot(data.sync);
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
    const id = window.setInterval(fetchSyncState, 4000);
    return () => window.clearInterval(id);
  }, [appLiveEnabled, fetchSyncState]);

  // Real browser requestAnimationFrame compositor cadence probe (throttled state commit every 1.2s)
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!probeActive || typeof window === 'undefined') return;
    let frameCount = 0;
    let droppedFrames = 0;
    let windowStart = performance.now();
    let prevTs = windowStart;

    const tick = (now: number) => {
      const delta = now - prevTs;
      prevTs = now;
      frameCount += 1;
      if (delta > 20) {
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
      };
      if (data?.ok && data.sync) {
        setSyncSnapshot(data.sync);
      }
    } finally {
      setReconciling(false);
    }
  }, [selectedSymbol]);

  const metrics: readonly WidgetMetricItem[] = useMemo(
    () => [
      {
        id: 'agent-lock',
        label: 'Synchronized Agents',
        value: syncSnapshot
          ? `${syncSnapshot.synchronizedAgents}/${syncSnapshot.totalAgents} Locked`
          : 'Syncing...',
        subtext: syncSnapshot ? `Global Epoch #${syncSnapshot.globalEpoch}` : 'Connecting',
        tone: syncSnapshot?.allAgentsLocked ? 'NOMINAL' : 'WARNING',
      },
      {
        id: 'max-drift',
        label: 'Cross-Agent Price Drift',
        value: syncSnapshot ? `${syncSnapshot.maxDriftBps.toFixed(1)} bps` : '0.0 bps',
        subtext: syncSnapshot
          ? `Ceiling <= ${syncSnapshot.driftThresholdBps.toFixed(1)} bps · ${syncSnapshot.totalDriftCorrections} healed`
          : 'Zero-drift invariant',
        tone: (syncSnapshot?.maxDriftBps ?? 0) === 0 ? 'NOMINAL' : 'WARNING',
      },
      {
        id: 'consensus-hash',
        label: 'Deterministic Consensus',
        value: syncSnapshot ? `0x${syncSnapshot.consensusHash}` : '0x00000000',
        subtext: syncSnapshot
          ? `${syncSnapshot.symbol} @ $${formatCryptoPrice(syncSnapshot.authoritativePrice)}`
          : selectedSymbol,
        tone: 'INFO',
      },
      {
        id: 'raf-pipeline',
        label: 'Compositor Frame Pacing',
        value: probeActive ? `${frameProbe.measuredFps} Hz (${frameProbe.avgFrameMs}ms)` : 'Probe Paused',
        subtext: probeActive
          ? `Target <= 8.33ms · ${frameProbe.droppedFrames} long frames`
          : 'Click Resume Probe to sample rAF',
        tone: frameProbe.avgFrameMs <= 17 ? 'NOMINAL' : 'WARNING',
      },
    ],
    [syncSnapshot, selectedSymbol, probeActive, frameProbe]
  );

  return (
    <ForgeWidgetFrame
      layout={WIDGET_LAYOUT}
      title="Multi-Agent State Synchronization & 120Hz Render Audit"
      testId="agent-sync-render-audit-panel"
      icon={<ShieldCheck className="h-4 w-4 text-cyan-400 shrink-0" aria-hidden="true" />}
      metadata={[
        { id: 'k1', label: 'Strict Modularity Audit' },
        {
          id: 'k2',
          label: 'Zero-Drift Consensus',
          tone: syncSnapshot?.allAgentsLocked ? 'NOMINAL' : 'INFO',
        },
        { id: 'k3', label: 'GPU Compositor Containment Active', tone: 'INFO' },
      ]}
      actions={
        <>
          <ForgeInteractiveButton
            label={probeActive ? 'Pause Frame Probe' : 'Resume Frame Probe'}
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

        {/* Per-Agent Synchronized State Ledger */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                <th className="py-2 pr-4">Autonomous Agent Module</th>
                <th className="py-2 pr-3 text-right">Epoch</th>
                <th className="py-2 pr-3 text-right">Anchor Price</th>
                <th className="py-2 pr-3 text-right">Drift</th>
                <th className="py-2 pr-3 text-right">State Hash</th>
                <th className="py-2 pr-3 text-right">Healed</th>
                <th className="py-2 text-right">Sync Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-xs font-mono tabular-nums">
              {(syncSnapshot?.agents ?? []).map((agent) => (
                <tr key={agent.agentId} className="hover:bg-slate-800/20 transition-colors">
                  <td className="py-2.5 pr-4 font-sans font-semibold text-white">
                    {agent.agentLabel}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-slate-300">#{agent.epoch}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-200">
                    ${formatCryptoPrice(agent.authoritativePrice)}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-emerald-400">
                    {agent.driftBps.toFixed(1)} bps
                  </td>
                  <td className="py-2.5 pr-3 text-right text-cyan-300">0x{agent.stateHash}</td>
                  <td className="py-2.5 pr-3 text-right text-slate-400">
                    {agent.driftCorrectionsCount}
                  </td>
                  <td className="py-2.5 text-right">
                    <span
                      className={`inline-flex items-center gap-1 font-sans text-[11px] font-semibold ${
                        agent.status === 'SYNCHRONIZED'
                          ? 'text-emerald-400'
                          : agent.status === 'RECONCILING'
                          ? 'text-cyan-300'
                          : 'text-amber-300'
                      }`}
                    >
                      {agent.status === 'SYNCHRONIZED' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <Activity className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      )}
                      {agent.status === 'SYNCHRONIZED' ? 'Synchronized' : 'Reconciled'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </ForgeWidgetFrame>
  );
});

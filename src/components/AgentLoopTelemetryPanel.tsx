import { memo, useCallback, useEffect, useState } from 'react';
import { Activity, ArrowRight, Cpu, Radio, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { useApp } from '../context/AppContext';
import { useWorkspaceStore } from '../store/useWorkspaceStore';

interface AgentLoopStage {
  id: string;
  label: string;
  status: 'ACTIVE' | 'CALIBRATING' | 'DEGRADED';
  latencyMs: number;
  metric: string;
}

interface AgentLoopsTelemetryResponse {
  ok: boolean;
  generatedAt: string;
  pipelineEpoch: number;
  totalCycles: number;
  avgLoopLatencyMs: number;
  cpuUsagePct: number;
  wsConnected: boolean;
  wsFrameAgeMs: number;
  stages: AgentLoopStage[];
}

const REFRESH_BTN_TAP = { scale: 0.96 } as const;

export const AgentLoopTelemetryPanel = memo(function AgentLoopTelemetryPanel() {
  const { appLiveEnabled } = useApp();
  const pulseSyncStreams = useWorkspaceStore((s) => s.cyber.pulseSyncStreams);
  const [telemetry, setTelemetry] = useState<AgentLoopsTelemetryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTelemetry = useCallback(async () => {
    try {
      const res = await fetch('/api/telemetry/agent-loops');
      if (!res.ok) return;
      const data = (await res.json()) as AgentLoopsTelemetryResponse;
      if (data?.ok && Array.isArray(data.stages)) {
        setTelemetry(data);
      }
    } catch {
      // keep previous snapshot
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTelemetry();
  }, [fetchTelemetry]);

  useEffect(() => {
    if (!appLiveEnabled) return;
    // Avoid overlapping hot-page polls and stop polling while the tab is hidden.
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void fetchTelemetry();
    }, 12_000);
    return () => window.clearInterval(id);
  }, [appLiveEnabled, fetchTelemetry]);

  return (
    <section
      aria-label="Backend Agent Transaction Loop Telemetry"
      data-testid="agent-loop-telemetry-panel"
      className="cyber-surface rounded-xl border overflow-hidden"
    >
      {pulseSyncStreams && (
        <div aria-hidden="true" className="cyber-stream-rail h-[2px] w-full bg-slate-900" />
      )}

      <div className="flex flex-col gap-3 border-b border-slate-800/90 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="text-cyan-300 font-medium">Live Backend Event Pipeline</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-slate-300">
              Epoch {telemetry?.pipelineEpoch ?? 0} · {telemetry?.totalCycles ?? 0} cycles
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-emerald-400">
              {telemetry ? `${telemetry.avgLoopLatencyMs}ms avg loop` : 'Syncing...'}
            </span>
          </div>
          <h2 className="mt-1 font-display text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <Cpu className="h-4 w-4 text-cyan-400 cyber-ai-wave shrink-0" aria-hidden="true" />
            <span>Autonomous Agent Transaction-Loop Telemetry</span>
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums text-slate-300">
          <span>CPU {telemetry ? `${telemetry.cpuUsagePct.toFixed(1)}%` : '--'}</span>
          <span className="text-slate-600" aria-hidden="true">|</span>
          <span className={telemetry?.wsConnected ? 'text-emerald-400' : 'text-amber-300'}>
            <Radio className="inline h-3.5 w-3.5 mr-1" aria-hidden="true" />
            {telemetry?.wsConnected ? 'Binance WS Locked' : 'Calibrating WS'}
          </span>
          <motion.button
            whileTap={REFRESH_BTN_TAP}
            type="button"
            onClick={fetchTelemetry}
            aria-label="Refresh agent transaction loop telemetry"
            className="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-[#050914] p-1.5 text-slate-300 hover:border-cyan-400 hover:text-white transition-colors cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </motion.button>
        </div>
      </div>

      {/* Horizontal 7-Stage Pipeline Visual Map */}
      <div className="p-4 sm:p-5 overflow-x-auto">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-7 min-w-0">
          {(telemetry?.stages ?? []).map((stage, idx, arr) => {
            const tone =
              stage.status === 'ACTIVE'
                ? 'border-cyan-500/35 text-emerald-400'
                : stage.status === 'DEGRADED'
                ? 'border-amber-500/40 text-amber-300'
                : 'border-slate-700 text-slate-400';
            return (
              <div key={stage.id} className="relative flex items-stretch gap-1.5">
                <div
                  className={`flex-1 rounded-lg border bg-[#060c1b]/95 p-3 flex flex-col justify-between ${tone}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-[10px] text-slate-500">0{idx + 1}</span>
                    <Activity
                      className={`h-3 w-3 shrink-0 ${
                        stage.status === 'ACTIVE' ? 'text-cyan-400 cyber-ai-wave' : 'text-amber-300'
                      }`}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="mt-1.5 text-xs font-semibold text-white leading-tight">
                    {stage.label}
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-1 border-t border-slate-800/80 pt-1.5 font-mono text-[10px] tabular-nums">
                    <span className="text-cyan-300 truncate">{stage.metric}</span>
                    <span className="text-slate-400 shrink-0">{stage.latencyMs}ms</span>
                  </div>
                </div>
                {idx < arr.length - 1 && (
                  <div
                    aria-hidden="true"
                    className="hidden lg:flex items-center justify-center text-cyan-500/50 -mx-1"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
});

import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Layers,
  Lock,
  Play,
  RefreshCw,
  Scale,
  Shield,
  ShieldAlert,
  Sliders,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import type { StrategyDefinition, StrategyId } from '../lib/step2StrategyFramework';
import type {
  LearningPerformanceAuditReport,
  OperatingMode,
  PortfolioHedgeIntelligenceReport,
  Step2ExecutionEnvironment,
  Step2RiskPolicy,
  UnifiedSignalRecord,
} from '../lib/step2UnifiedSignalHub';
import type { ControlledWorkerPoolState } from '../lib/step2WorkerScaling';
import type { PublicMaintenanceSummary } from '../lib/safeMaintenanceProtocol';

interface Step2HubSnapshot {
  ok: boolean;
  operatingMode: OperatingMode;
  targetEnvironment: 'PAPER' | 'EXCHANGE_DEMO';
  environmentReadiness: {
    paperEnabled: boolean;
    exchangeDemoConfigured: boolean;
    binanceTestnetConfigured: boolean;
    okxDemoConfigured: boolean;
    liveTradingEnabled: boolean;
    liveTradingLockReason: string;
  };
  riskPolicy: Step2RiskPolicy;
  strategies: StrategyDefinition[];
  workerPool: ControlledWorkerPoolState;
  portfolioContext: {
    accountEquityUsd: number;
    currentDailyLossPct: number;
    currentPortfolioDrawdownPct: number;
    activeConcurrentOrders: number;
    emergencyStopActive: boolean;
  };
  hedgeReport: PortfolioHedgeIntelligenceReport;
  learningAudit: LearningPerformanceAuditReport;
  signals: UnifiedSignalRecord[];
  maintenance: PublicMaintenanceSummary;
}

type HubTab = 'SIGNAL_HUB' | 'STRATEGIES' | 'RISK_WORKERS' | 'HEDGING' | 'LEARNING';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'] as const;
const TIMEFRAMES = ['15m', '1h', '4h', '1d'] as const;

export const Step2IntelligenceHubPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<HubTab>('SIGNAL_HUB');
  const [hub, setHub] = useState<Step2HubSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);

  // Evaluation form state
  const [symbol, setSymbol] = useState<string>('BTCUSDT');
  const [timeframe, setTimeframe] = useState<string>('1h');
  const [strategyId, setStrategyId] = useState<string>('AUTO_BEST');
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);

  // Editable risk policy draft
  const [riskDraft, setRiskDraft] = useState<Step2RiskPolicy | null>(null);

  const loadHub = useCallback(async () => {
    try {
      const res = await apiFetch('/api/step2/hub');
      const data = (await res.json()) as Step2HubSnapshot;
      if (data?.ok) {
        setHub(data);
        setRiskDraft((prev) => prev ?? data.riskPolicy);
        if (data.signals.length > 0) {
          setSelectedSignalId((curr) => curr ?? data.signals[0].signalId);
        }
      }
    } catch {
      setFeedback({ kind: 'err', text: 'Failed to load Step 2 Intelligence Hub telemetry.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHub();
  }, [loadHub]);

  const handleEvaluatePipeline = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/step2/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          timeframe,
          strategyId,
          targetEnvironment: hub?.targetEnvironment ?? 'PAPER',
          requestOrigin: 'OPERATOR_UI',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setFeedback({ kind: 'err', text: data?.error || '6-Agent evaluation failed.' });
      } else {
        setSelectedSignalId(data.signal.signalId);
        setFeedback({
          kind: 'ok',
          text: `Evaluated ${data.signal.signalId} (${data.signal.direction}) — ${data.signal.execution.status}.`,
        });
        await loadHub();
      }
    } catch {
      setFeedback({ kind: 'err', text: 'Network error while running 6-agent pipeline.' });
    } finally {
      setBusy(false);
    }
  };

  const handleApproveExecute = async (sigId: string, env: Step2ExecutionEnvironment) => {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/step2/approve-execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signalId: sigId,
          environment: env,
          actor: 'AUTHORIZED_OPERATOR',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setFeedback({
          kind: 'info',
          text: data?.error || `Execution declined (${env}).`,
        });
      } else {
        setFeedback({
          kind: 'ok',
          text: `Executed ${sigId} -> ${data.signal.execution.status}${
            data.signal.canonicalTradeId ? ` (Trade ID ${data.signal.canonicalTradeId})` : ''
          }.`,
        });
      }
      await loadHub();
    } catch {
      setFeedback({ kind: 'err', text: 'Failed to submit operator execution approval.' });
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateMode = async (
    nextMode?: OperatingMode,
    nextEnv?: 'PAPER' | 'EXCHANGE_DEMO'
  ) => {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/step2/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operatingMode: nextMode,
          targetEnvironment: nextEnv,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setFeedback({ kind: 'err', text: data?.error || 'Configuration update rejected.' });
      } else {
        setFeedback({
          kind: 'ok',
          text: `Mode updated: ${data.operatingMode} · Target Environment: ${data.targetEnvironment} (LIVE locked).`,
        });
        await loadHub();
      }
    } catch {
      setFeedback({ kind: 'err', text: 'Failed to update Step 2 mode.' });
    } finally {
      setBusy(false);
    }
  };

  const handleToggleStrategyAutonomous = async (strat: StrategyDefinition) => {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/step2/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyToggle: {
            strategyId: strat.id as StrategyId,
            autonomousEligible: !strat.autonomousEligible,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setFeedback({ kind: 'err', text: data?.error || 'Strategy toggle blocked by validation rule.' });
      } else {
        setFeedback({
          kind: 'ok',
          text: `${strat.name}: autonomous eligibility set to ${!strat.autonomousEligible ? 'ENABLED' : 'OFF'}.`,
        });
        await loadHub();
      }
    } catch {
      setFeedback({ kind: 'err', text: 'Failed to update strategy eligibility.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveRiskPolicy = async () => {
    if (!riskDraft) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/step2/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riskPolicy: riskDraft }),
      });
      const data = await res.json();
      if (data?.ok) {
        setRiskDraft(data.riskPolicy);
        setFeedback({ kind: 'ok', text: 'Configurable risk policy saved and bound across all 6 agents.' });
        await loadHub();
      } else {
        setFeedback({ kind: 'err', text: data?.error || 'Failed to save risk policy.' });
      }
    } catch {
      setFeedback({ kind: 'err', text: 'Network error while saving risk policy.' });
    } finally {
      setBusy(false);
    }
  };

  const handleScaleWorkers = async (desiredWorkers: number) => {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/step2/worker/scale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ desiredWorkers }),
      });
      const data = await res.json();
      setFeedback({
        kind: data?.ok ? 'ok' : 'err',
        text: data?.reason || (data?.ok ? 'Worker pool updated.' : 'Worker scaling blocked.'),
      });
      await loadHub();
    } catch {
      setFeedback({ kind: 'err', text: 'Failed to scale worker pool.' });
    } finally {
      setBusy(false);
    }
  };

  const handleRestartWorker = async (workerId: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/step2/worker/scale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restartWorkerId: workerId }),
      });
      const data = await res.json();
      setFeedback({
        kind: data?.ok ? 'ok' : 'err',
        text: data?.reason || 'Worker restart processed.',
      });
      await loadHub();
    } catch {
      setFeedback({ kind: 'err', text: 'Failed to restart worker.' });
    } finally {
      setBusy(false);
    }
  };

  const handleEvaluateHedge = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/step2/hedge/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volatilityStressScore: 76 }),
      });
      const data = await res.json();
      if (data?.ok && hub) {
        setHub({ ...hub, hedgeReport: data.report });
        setFeedback({
          kind: 'info',
          text: `Hedge suitability re-evaluated (${data.report.status} — not executed).`,
        });
      }
    } catch {
      setFeedback({ kind: 'err', text: 'Failed to evaluate portfolio hedge intelligence.' });
    } finally {
      setBusy(false);
    }
  };

  const handleRunLearningAudit = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/step2/learning/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data?.ok && hub) {
        setHub({ ...hub, learningAudit: data.report });
        setFeedback({
          kind: 'ok',
          text: `Learning Audit complete (${data.report.recommendations.length} recommendation(s), zero risk limits silently mutated).`,
        });
      }
    } catch {
      setFeedback({ kind: 'err', text: 'Failed to run learning audit.' });
    } finally {
      setBusy(false);
    }
  };

  const activeSignal =
    hub?.signals.find((s) => s.signalId === selectedSignalId) ?? hub?.signals[0] ?? null;

  return (
    <section
      aria-label="Step 2 Unified AI Signal Hub & Controlled Execution"
      className="rounded-2xl border border-cyan-500/25 bg-[#090f1d] p-4 sm:p-6 shadow-xl"
    >
      {/* Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-300">
            <Bot className="w-4 h-4" />
            <span>Step 2 · Unified AI Signal Hub & Controlled Execution</span>
            <span className="px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
              PAPER / DEMO ONLY
            </span>
            <span className="px-2 py-0.5 rounded border border-rose-500/30 bg-rose-500/10 text-rose-300 inline-flex items-center gap-1">
              <Lock className="w-3 h-3" /> LIVE LOCKED
            </span>
          </div>
          <h2 className="mt-1.5 text-lg sm:text-xl font-bold text-white">
            6-Role Coordinated Intelligence, Modular Strategies & Risk-Bound Execution
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Traceable Signal ID lifecycle · Market Data Trust Guard · Bounded Worker Idempotency · Non-Mutating Learning Audit
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hub && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  handleUpdateMode(
                    hub.operatingMode === 'SUPERVISED' ? 'AUTONOMOUS' : 'SUPERVISED'
                  )
                }
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                  hub.operatingMode === 'SUPERVISED'
                    ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25'
                    : 'border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                }`}
              >
                Mode: {hub.operatingMode}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  handleUpdateMode(
                    undefined,
                    hub.targetEnvironment === 'PAPER' ? 'EXCHANGE_DEMO' : 'PAPER'
                  )
                }
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 transition"
              >
                Env: {hub.targetEnvironment}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={loadHub}
            disabled={busy}
            aria-label="Refresh Step 2 Hub"
            className="p-2 rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Maintenance & Emergency Safety Strip */}
      {hub && (hub.maintenance.state !== 'NORMAL' || hub.portfolioContext.emergencyStopActive) && (
        <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 flex items-center gap-2.5">
          <ShieldAlert className="w-4 h-4 shrink-0 text-amber-300" />
          <span>
            <strong>Execution Safety Lock Active:</strong>{' '}
            {hub.portfolioContext.emergencyStopActive
              ? 'Emergency Stop engaged — all new entries and worker scale-ups blocked.'
              : `Safe Maintenance Mode (${hub.maintenance.state}) active — all new entries and self-healing worker overrides blocked while existing protections remain preserved.`}
          </span>
        </div>
      )}

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`mt-4 rounded-xl border px-4 py-2.5 text-xs flex items-center justify-between gap-2 ${
            feedback.kind === 'ok'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
              : feedback.kind === 'err'
              ? 'border-rose-500/35 bg-rose-500/10 text-rose-200'
              : 'border-cyan-500/35 bg-cyan-500/10 text-cyan-200'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-300 hover:text-white font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Step 2 Intelligence Sections"
        className="mt-4 flex flex-wrap gap-1.5 border-b border-slate-800/80 pb-3"
      >
        {(
          [
            { id: 'SIGNAL_HUB', label: '6-Agent Signal Hub', icon: Activity },
            { id: 'STRATEGIES', label: 'Strategy Framework (8)', icon: Layers },
            { id: 'RISK_WORKERS', label: 'Risk & Worker Scaling', icon: Cpu },
            { id: 'HEDGING', label: 'Hedge Intelligence', icon: Scale },
            { id: 'LEARNING', label: 'Learning Audit', icon: Sparkles },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                active
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                  : 'bg-slate-900/70 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {loading || !hub ? (
        <div className="py-10 text-center text-xs text-slate-400">
          Loading unified Step 2 intelligence pipeline…
        </div>
      ) : (
        <div className="mt-5">
          {/* TAB 1: 6-AGENT SIGNAL HUB */}
          {activeTab === 'SIGNAL_HUB' && (
            <div className="space-y-5">
              {/* Evaluation Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 bg-slate-950/60 border border-slate-800/90 rounded-xl p-3.5">
                <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                  <span>Market Pair</span>
                  <select
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-2 text-xs text-white"
                  >
                    {SYMBOLS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                  <span>Timeframe</span>
                  <select
                    value={timeframe}
                    onChange={(e) => setTimeframe(e.target.value)}
                    className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-2 text-xs text-white"
                  >
                    {TIMEFRAMES.map((tf) => (
                      <option key={tf} value={tf}>
                        {tf}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-[11px] text-slate-400 lg:col-span-2">
                  <span>Strategy Module</span>
                  <select
                    value={strategyId}
                    onChange={(e) => setStrategyId(e.target.value)}
                    className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-2 text-xs text-white"
                  >
                    <option value="AUTO_BEST">Auto-Select Best Validated Strategy (8 Modules)</option>
                    {hub.strategies.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} [{s.validationStatus}]
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex items-end">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleEvaluatePipeline}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-xs px-3 py-2.5 transition"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>{busy ? 'Evaluating…' : 'Evaluate 6-Agent Pipeline'}</span>
                  </button>
                </div>
              </div>

              {/* Environment Readiness Strip */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                  <div className="text-[11px] text-slate-400">Paper Environment</div>
                  <div className="mt-1 font-semibold text-emerald-300">
                    Active · Explicit PAPER_SIMULATED_FILL
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                  <div className="text-[11px] text-slate-400">Authorized Exchange Demo</div>
                  <div className="mt-1 font-semibold text-slate-200">
                    {hub.environmentReadiness.exchangeDemoConfigured
                      ? 'Demo Keys Detected · Requires Genuine Exchange Ack'
                      : 'Unconfigured · Demo Keys Absent (Zero Fabricated Acks)'}
                  </div>
                </div>
                <div className="rounded-xl border border-rose-500/20 bg-rose-950/20 p-3">
                  <div className="text-[11px] text-rose-300">Real-Money Live Environment</div>
                  <div className="mt-1 font-semibold text-rose-200 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" />
                    Locked in Step 2 (Paper & Demo Only)
                  </div>
                </div>
              </div>

              {/* Active Signal Inspector */}
              {activeSignal ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-4">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pb-3 border-b border-slate-800">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono font-bold text-cyan-300">
                          {activeSignal.signalId}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 font-semibold">
                          {activeSignal.symbol} · {activeSignal.timeframe}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded font-semibold ${
                            activeSignal.direction === 'BUY'
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : activeSignal.direction === 'SELL'
                              ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {activeSignal.direction}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-200 border border-indigo-500/30">
                          {activeSignal.execution.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        Strategy: <strong className="text-slate-200">{activeSignal.strategyName}</strong> · Feed:{' '}
                        <strong className="text-slate-200">{activeSignal.dataTrust.providerLabel}</strong> (
                        {activeSignal.dataTrust.freshness})
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {!activeSignal.execution.executed &&
                        activeSignal.riskValidation.passed &&
                        activeSignal.direction !== 'NONE' && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleApproveExecute(activeSignal.signalId, 'PAPER')}
                              className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition"
                            >
                              Approve & Execute (Paper Simulated)
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                handleApproveExecute(activeSignal.signalId, 'EXCHANGE_DEMO')
                              }
                              className="px-3 py-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 font-semibold text-xs transition"
                            >
                              Approve (Exchange Demo)
                            </button>
                          </>
                        )}
                      {activeSignal.canonicalTradeId && (
                        <a
                          href={`/home?tradeId=${encodeURIComponent(activeSignal.canonicalTradeId)}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 text-xs font-semibold hover:bg-emerald-500/20 transition"
                        >
                          <span>Smart Chart ({activeSignal.canonicalTradeId})</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Trade Levels & Non-Proof Confidence Notice */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
                    <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2.5">
                      <div className="text-[10px] uppercase text-slate-400">Entry</div>
                      <div className="mt-0.5 font-mono font-semibold text-white">
                        {activeSignal.entryPrice ? `$${activeSignal.entryPrice}` : '—'}
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2.5">
                      <div className="text-[10px] uppercase text-slate-400">Stop Loss</div>
                      <div className="mt-0.5 font-mono font-semibold text-rose-300">
                        {activeSignal.stopLoss ? `$${activeSignal.stopLoss}` : '—'}
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2.5">
                      <div className="text-[10px] uppercase text-slate-400">Take Profit</div>
                      <div className="mt-0.5 font-mono font-semibold text-emerald-300">
                        {activeSignal.takeProfit ? `$${activeSignal.takeProfit}` : '—'}
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2.5">
                      <div className="text-[10px] uppercase text-slate-400">Projected R:R</div>
                      <div className="mt-0.5 font-mono font-semibold text-cyan-300">
                        {activeSignal.projectedRiskReward > 0
                          ? `1:${activeSignal.projectedRiskReward}`
                          : '—'}
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2.5 col-span-2 sm:col-span-1">
                      <div className="text-[10px] uppercase text-slate-400">Heuristic Score</div>
                      <div className="mt-0.5 font-mono font-semibold text-amber-200">
                        {activeSignal.confidenceScore}%
                      </div>
                      <div className="text-[10px] text-slate-400 leading-tight mt-0.5">
                        Not proof of profit
                      </div>
                    </div>
                  </div>

                  {/* 6 Cooperating AI Agent Role Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {activeSignal.agentDecisions.map((agent) => (
                      <div
                        key={agent.role}
                        className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 flex flex-col justify-between gap-2"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-white">{agent.label}</span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                agent.verdict === 'PASS'
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : agent.verdict === 'BLOCK'
                                  ? 'bg-rose-500/15 text-rose-300'
                                  : agent.verdict === 'CAUTION'
                                  ? 'bg-amber-500/15 text-amber-300'
                                  : 'bg-slate-800 text-slate-300'
                              }`}
                            >
                              {agent.verdict}
                            </span>
                          </div>
                          <ul className="mt-2 space-y-1 text-[11px] text-slate-300 list-disc list-inside">
                            {agent.reasoning.map((line, i) => (
                              <li key={i}>{line}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="pt-2 border-t border-slate-800/70 text-[10px] text-slate-400">
                          Invalidation: {agent.invalidationConditions[0]}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-6 text-center text-xs text-slate-400">
                  No Step 2 signals evaluated yet. Select a pair and click{' '}
                  <strong className="text-slate-200">Evaluate 6-Agent Pipeline</strong> to generate an
                  immutable Signal ID and inspect all 6 cooperating agent decisions.
                </div>
              )}

              {/* Recent Signals Selector */}
              {hub.signals.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">
                    Recent Traceable Signals ({hub.signals.length}) — Unexecuted signals are never counted as executed trades
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-slate-800">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900/90 text-slate-400 text-[11px]">
                        <tr>
                          <th className="px-3 py-2">Signal ID</th>
                          <th className="px-3 py-2">Pair / TF</th>
                          <th className="px-3 py-2">Strategy</th>
                          <th className="px-3 py-2">Dir</th>
                          <th className="px-3 py-2">Execution Status</th>
                          <th className="px-3 py-2">Trade ID</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {hub.signals.slice(0, 8).map((s) => (
                          <tr
                            key={s.signalId}
                            className={`hover:bg-slate-900/60 ${
                              activeSignal?.signalId === s.signalId ? 'bg-cyan-500/10' : ''
                            }`}
                          >
                            <td className="px-3 py-2 font-mono text-cyan-300">
                              <button
                                type="button"
                                onClick={() => setSelectedSignalId(s.signalId)}
                                className="underline-offset-2 hover:underline text-left"
                              >
                                {s.signalId}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-slate-200">
                              {s.symbol} · {s.timeframe}
                            </td>
                            <td className="px-3 py-2 text-slate-300">{s.strategyName}</td>
                            <td className="px-3 py-2 font-semibold text-white">{s.direction}</td>
                            <td className="px-3 py-2 text-slate-300">{s.execution.status}</td>
                            <td className="px-3 py-2 font-mono text-emerald-300">
                              {s.canonicalTradeId ?? '— (Not Executed)'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: MODULAR STRATEGY FRAMEWORK */}
          {activeTab === 'STRATEGIES' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
              {hub.strategies.map((strat) => (
                <div
                  key={strat.id}
                  className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="text-sm font-bold text-white">{strat.name}</h3>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-semibold">
                          {strat.validationStatus}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">{strat.description}</p>
                    </div>
                    <button
                      type="button"
                      disabled={busy || strat.validationStatus === 'DRAFT' || strat.validationStatus === 'DISABLED'}
                      onClick={() => handleToggleStrategyAutonomous(strat)}
                      className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                        strat.autonomousEligible
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                          : 'border-slate-700 bg-slate-900 text-slate-400'
                      } disabled:opacity-45`}
                    >
                      Auto: {strat.autonomousEligible ? 'ON (Paper)' : 'OFF'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-300">
                    <div>
                      <span className="text-slate-400">Inputs: </span>
                      {strat.requiredMarketInputs.join(', ')}
                    </div>
                    <div>
                      <span className="text-slate-400">Timeframes: </span>
                      {strat.supportedTimeframes.join(', ')} · Min R:R {strat.minRiskReward}
                    </div>
                    <div>
                      <span className="text-slate-400">Stop Loss: </span>
                      {strat.stopLossMethodology}
                    </div>
                    <div>
                      <span className="text-slate-400">Targets: </span>
                      {strat.targetMethodology}
                    </div>
                  </div>
                  <div className="text-[11px] text-amber-300/90 border-t border-slate-800/80 pt-2">
                    <strong>Known Limitations:</strong> {strat.knownLimitations.join(' ')}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 3: RISK CONTROLS & BOUNDED WORKER SCALING */}
          {activeTab === 'RISK_WORKERS' && riskDraft && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {/* Configurable Risk Policy */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Sliders className="w-4 h-4 text-cyan-400" />
                    <span>Configurable Risk Limits (All 6 Agents)</span>
                  </h3>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSaveRiskPolicy}
                    className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition"
                  >
                    Save Risk Policy
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  {(
                    [
                      ['maxRiskPerTradePct', 'Max Risk / Trade (%)'],
                      ['maxPositionExposurePct', 'Max Position Exposure (%)'],
                      ['maxDailyLossPct', 'Max Daily Loss (%)'],
                      ['maxPortfolioDrawdownPct', 'Max Drawdown (%)'],
                      ['maxLeverage', 'Max Leverage (x)'],
                      ['maxCorrelatedPositions', 'Max Correlated Positions'],
                      ['maxConcurrentOrders', 'Max Concurrent Orders'],
                      ['minRiskRewardRatio', 'Minimum R:R Ratio'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="flex flex-col gap-1 text-[11px] text-slate-400">
                      <span>{label}</span>
                      <input
                        type="number"
                        step="0.1"
                        value={riskDraft[key]}
                        onChange={(e) =>
                          setRiskDraft({ ...riskDraft, [key]: Number(e.target.value) })
                        }
                        className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-white font-mono"
                      />
                    </label>
                  ))}
                </div>
              </div>

              {/* Bounded Controlled Worker Pool */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Cpu className="w-4 h-4 text-emerald-400" />
                    <span>Bounded Worker Scaling & Idempotency</span>
                  </h3>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4].map((count) => (
                      <button
                        key={count}
                        type="button"
                        disabled={busy}
                        onClick={() => handleScaleWorkers(count)}
                        className={`px-2.5 py-1 rounded text-xs font-bold border ${
                          hub.workerPool.workers.length === count
                            ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200'
                            : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        {count}w
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2.5">
                    <div className="text-[10px] text-slate-400">Active Workers</div>
                    <div className="font-mono font-bold text-white">
                      {hub.workerPool.workers.length} / {hub.workerPool.budget.maxWorkers}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2.5">
                    <div className="text-[10px] text-slate-400">Duplicates Blocked</div>
                    <div className="font-mono font-bold text-emerald-300">
                      {hub.workerPool.duplicateExecutionsPrevented}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2.5">
                    <div className="text-[10px] text-slate-400">Maint. Blocks</div>
                    <div className="font-mono font-bold text-amber-300">
                      {hub.workerPool.maintenanceBlocksCount}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  {hub.workerPool.workers.map((w) => (
                    <div
                      key={w.workerId}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs"
                    >
                      <div>
                        <span className="font-mono font-semibold text-white">{w.workerId}</span>
                        <span className="ml-2 text-[11px] text-slate-400">{w.roleFocus}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-emerald-300">{w.status}</span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleRestartWorker(w.workerId)}
                          className="px-2 py-0.5 rounded border border-slate-700 bg-slate-800 text-[11px] text-slate-200 hover:bg-slate-700"
                        >
                          Restart
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: HEDGING & POSITION INTELLIGENCE */}
          {activeTab === 'HEDGING' && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-200 text-[11px] font-bold">
                    {hub.hedgeReport.status} · NOT EXECUTED
                  </span>
                  <h3 className="mt-1.5 text-sm font-bold text-white">
                    Portfolio Concentration, Correlated Exposure & Hedge Suitability
                  </h3>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleEvaluateHedge}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition"
                >
                  Re-Evaluate Hedge Suitability
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3">
                  <div className="text-[10px] text-slate-400">Gross Exposure</div>
                  <div className="font-mono font-bold text-white">
                    ${hub.hedgeReport.totalGrossExposureUsd.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3">
                  <div className="text-[10px] text-slate-400">Top Symbol Concentration</div>
                  <div className="font-mono font-bold text-cyan-300">
                    {hub.hedgeReport.topSymbolConcentrationPct}%
                  </div>
                </div>
                <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3">
                  <div className="text-[10px] text-slate-400">Est. Daily Hedge Cost</div>
                  <div className="font-mono font-bold text-amber-300">
                    ${hub.hedgeReport.estimatedDailyFundingAndFeeCostUsd}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3">
                  <div className="text-[10px] text-slate-400">Projected Net After Hedge</div>
                  <div className="font-mono font-bold text-emerald-300">
                    ${hub.hedgeReport.projectedNetExposureAfterHedgeUsd.toLocaleString()}
                  </div>
                </div>
              </div>

              <p className="text-xs text-slate-300">{hub.hedgeReport.summary}</p>

              <div className="text-xs space-y-1">
                <div className="font-semibold text-slate-200">Risk-Reducing Alternatives:</div>
                <ul className="list-disc list-inside text-slate-400 space-y-0.5">
                  {hub.hedgeReport.riskReducingAlternatives.map((alt, idx) => (
                    <li key={idx}>{alt}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* TAB 5: LEARNING & PERFORMANCE AUDIT */}
          {activeTab === 'LEARNING' && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="px-2 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/40 text-indigo-200 text-[11px] font-bold">
                    REVIEW REQUIRED · ZERO SILENT RISK MUTATION
                  </span>
                  <h3 className="mt-1.5 text-sm font-bold text-white">
                    Post-Closure Learning & Performance Drift Audit
                  </h3>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleRunLearningAudit}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition"
                >
                  Run Learning Audit
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3">
                  <div className="text-[10px] text-slate-400">Completed Samples</div>
                  <div className="font-mono font-bold text-white">
                    {hub.learningAudit.sampleSize}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3">
                  <div className="text-[10px] text-slate-400">Win Rate</div>
                  <div className="font-mono font-bold text-emerald-300">
                    {hub.learningAudit.overallWinRatePct !== null
                      ? `${hub.learningAudit.overallWinRatePct}%`
                      : '—'}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3">
                  <div className="text-[10px] text-slate-400">False Signal Rate</div>
                  <div className="font-mono font-bold text-amber-300">
                    {hub.learningAudit.falseSignalRatePct !== null
                      ? `${hub.learningAudit.falseSignalRatePct}%`
                      : '—'}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3">
                  <div className="text-[10px] text-slate-400">Mean Fill Drift</div>
                  <div className="font-mono font-bold text-cyan-300">
                    {hub.learningAudit.meanExecutionDriftBps !== null
                      ? `${hub.learningAudit.meanExecutionDriftBps} bps`
                      : '—'}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {hub.learningAudit.recommendations.map((rec) => (
                  <div
                    key={rec.id}
                    className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs space-y-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-white flex items-center gap-1.5">
                        {rec.severity === 'INFO' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                        )}
                        {rec.title}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                        Auto-Applied: NO · Operator Review Required
                      </span>
                    </div>
                    <p className="text-slate-400">{rec.evidence}</p>
                    <p className="text-cyan-200/90">Suggested Action: {rec.suggestedAction}</p>
                  </div>
                ))}
              </div>

              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                <span>{hub.learningAudit.safetyGuarantee}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default Step2IntelligenceHubPanel;

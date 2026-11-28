import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Eye,
  EyeOff,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import { formatCryptoPrice } from '../lib/marketData';
import type {
  PublicSignalMonitoringSnapshot,
  StageHealthStatus,
} from '../lib/publicSignalValidationEngine';
import type { PublicSignalsFeedResponse } from '../lib/publicSignalValidationServer';

interface CallerApprovalClearance {
  readonly authorizedOperator: boolean;
  readonly role: string;
  readonly actorLabel: string;
  readonly reason: string;
}

interface StatusApiResponse {
  readonly ok: boolean;
  readonly snapshot?: PublicSignalMonitoringSnapshot;
  readonly callerApprovalClearance?: CallerApprovalClearance;
  readonly error?: string;
}

interface FeedApiResponse {
  readonly ok: boolean;
  readonly feed?: PublicSignalsFeedResponse;
}

interface ActionBanner {
  readonly ok: boolean;
  readonly message: string;
}

export interface PublicSignalValidationGatePanelProps {
  readonly liveBtcPrice?: number;
  readonly liveEthPrice?: number;
}

function formatUtcShort(iso: string | null): string {
  if (!iso) return 'Not yet verified';
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return new Date(parsed).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function stageBadgeClasses(status: StageHealthStatus): string {
  if (status === 'PASSED') {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  }
  if (status === 'FAILED' || status === 'SUSPENDED') {
    return 'border-rose-500/40 bg-rose-500/10 text-rose-300';
  }
  return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
}

function PublicSignalValidationGatePanelComponent({
  liveBtcPrice,
  liveEthPrice,
}: PublicSignalValidationGatePanelProps) {
  const [snapshot, setSnapshot] = useState<PublicSignalMonitoringSnapshot | null>(null);
  const [feed, setFeed] = useState<PublicSignalsFeedResponse | null>(null);
  const [clearance, setClearance] = useState<CallerApprovalClearance | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<ActionBanner | null>(null);
  const [activeTab, setActiveTab] = useState<'WORKFLOW' | 'EVIDENCE' | 'AUDIT'>('WORKFLOW');
  const [paperSymbol, setPaperSymbol] = useState<'BTC/USDT' | 'ETH/USDT'>('BTC/USDT');
  const [paperOutcomeMode, setPaperOutcomeMode] = useState<'WIN' | 'LOSS'>('WIN');
  const [approvalNote, setApprovalNote] = useState<string>('');

  const observedPrice = useMemo(() => {
    if (paperSymbol === 'ETH/USDT') {
      return liveEthPrice && liveEthPrice > 0 ? liveEthPrice : 3_250;
    }
    return liveBtcPrice && liveBtcPrice > 0 ? liveBtcPrice : 91_400;
  }, [liveBtcPrice, liveEthPrice, paperSymbol]);

  const refreshState = useCallback(async () => {
    try {
      const [statusRes, feedRes] = await Promise.all([
        apiFetch('/api/public-signals/status', { method: 'GET' }),
        apiFetch('/api/public-signals/feed', { method: 'GET' }),
      ]);
      if (statusRes.ok) {
        const statusData = (await statusRes.json()) as StatusApiResponse;
        if (statusData.snapshot) setSnapshot(statusData.snapshot);
        if (statusData.callerApprovalClearance) setClearance(statusData.callerApprovalClearance);
      }
      if (feedRes.ok) {
        const feedData = (await feedRes.json()) as FeedApiResponse;
        if (feedData.feed) setFeed(feedData.feed);
      }
    } catch {
      setBanner({
        ok: false,
        message: 'Could not reach the backend Public Signal Validation Gate.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const runStage1Check = async (targetHost: string) => {
    setBusyAction(`stage1:${targetHost}`);
    setBanner(null);
    try {
      const res = await apiFetch('/api/public-signals/stage1/verify-testnet', {
        method: 'POST',
        body: JSON.stringify({
          targetHost,
          sampleSymbol: paperSymbol,
          sampleSide: 'BUY',
          sampleEntryPrice: observedPrice,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        report?: { passed: boolean; targetHost: string; failureReasons: string[] };
        snapshot?: PublicSignalMonitoringSnapshot;
      };
      if (data.snapshot) setSnapshot(data.snapshot);
      await refreshState();
      if (res.ok && data.ok) {
        setBanner({
          ok: true,
          message: `Stage 1 Testnet Validation PASSED on ${data.report?.targetHost ?? targetHost} (zero live endpoints contacted).`,
        });
      } else {
        setBanner({
          ok: false,
          message:
            data.report?.failureReasons?.[0] ||
            data.error ||
            `Stage 1 blocked target host ${targetHost}.`,
        });
      }
    } finally {
      setBusyAction(null);
    }
  };

  const recordPaperObservation = async (isDemonstration: boolean) => {
    setBusyAction(isDemonstration ? 'paper:demo' : 'paper:valid');
    setBanner(null);
    try {
      const nowMs = Date.now();
      const observedAtIso = new Date(nowMs - 45_000).toISOString();
      const closedAtIso = new Date(nowMs - 5_000).toISOString();
      const entry = observedPrice;
      const spreadHalf = entry * 0.0001;
      const exit =
        paperOutcomeMode === 'WIN' ? Number((entry * 1.012).toFixed(4)) : Number((entry * 0.991).toFixed(4));
      const stakeUsd = 500;
      const feeRate = 0.001;
      const feeUsd = Number((stakeUsd * feeRate * 2).toFixed(4));
      const uniqueSuffix = `${nowMs}_${Math.floor(Math.random() * 10000)}`;

      const res = await apiFetch('/api/public-signals/stage2/record-paper-trade', {
        method: 'POST',
        body: JSON.stringify({
          tradeEvidenceId: isDemonstration ? `demo_reject_${uniqueSuffix}` : `paper_obs_${uniqueSuffix}`,
          symbol: paperSymbol,
          side: 'BUY',
          marketSource: isDemonstration ? 'DEMO_PLACEHOLDER' : 'BINANCE_SPOT_OBSERVATION',
          observedAtIso,
          closedAtIso,
          bidPrice: Number((entry - spreadHalf).toFixed(4)),
          askPrice: Number((entry + spreadHalf).toFixed(4)),
          entryPrice: entry,
          exitPrice: exit,
          stakeUsd,
          feeRate,
          feeUsd,
          spreadBps: 2.0,
          slippageBps: 2.5,
          stopLossPrice: Number((entry * 0.98).toFixed(4)),
          takeProfitPrice: Number((entry * 1.06).toFixed(4)),
          isDemonstration,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        validation?: {
          accepted: boolean;
          outcome: string;
          simulatedNetPnlUsd: number;
          rejectionReasons: string[];
        };
      };
      await refreshState();
      if (res.ok && data.ok) {
        setBanner({
          ok: true,
          message: `Recorded simulated paper trade (${paperSymbol}, outcome=${data.validation?.outcome}, simulated net PnL=$${(
            data.validation?.simulatedNetPnlUsd ?? 0
          ).toFixed(2)} — simulated only, not real profit).`,
        });
      } else {
        setBanner({
          ok: false,
          message:
            data.validation?.rejectionReasons?.join(' ') ||
            data.error ||
            'Paper trade evidence rejected and logged to failure history.',
        });
      }
    } finally {
      setBusyAction(null);
    }
  };

  const registerPrivateCandidate = async () => {
    setBusyAction('candidate:register');
    setBanner(null);
    try {
      const entry = observedPrice;
      const res = await apiFetch('/api/public-signals/candidates/register', {
        method: 'POST',
        body: JSON.stringify({
          symbol: paperSymbol,
          side: 'BUY',
          timeframe: '1h',
          entryPrice: entry,
          stopLossPrice: Number((entry * 0.98).toFixed(4)),
          takeProfitPrice: Number((entry * 1.06).toFixed(4)),
          confidencePct: 88,
          strategyName: 'SignalForge_Validated_Candidate',
          marketSource: 'BINANCE_SPOT_OBSERVATION',
        }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      await refreshState();
      setBanner({
        ok: Boolean(res.ok && data.ok),
        message:
          data.message ||
          data.error ||
          'Candidate signal registered in private unverified state.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleOperatorDecision = async (
    signalId: string,
    decision: 'APPROVE' | 'REJECT' | 'REVOKE'
  ) => {
    setBusyAction(`decide:${decision}:${signalId}`);
    setBanner(null);
    try {
      const res = await apiFetch('/api/public-signals/approve', {
        method: 'POST',
        body: JSON.stringify({
          signalId,
          decision,
          note: approvalNote,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      await refreshState();
      setBanner({
        ok: Boolean(res.ok && data.ok),
        message:
          data.message ||
          data.error ||
          `Server responded with HTTP ${res.status} for ${decision}.`,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleGlobalPublicationToggle = async (nextEnabled: boolean) => {
    setBusyAction('toggle:publication');
    setBanner(null);
    try {
      const res = await apiFetch('/api/public-signals/publication-toggle', {
        method: 'POST',
        body: JSON.stringify({
          enabled: nextEnabled,
          note: approvalNote || 'Operator toggle from Signals monitoring console',
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      await refreshState();
      setBanner({
        ok: Boolean(res.ok && data.ok),
        message:
          data.message ||
          data.error ||
          `Server responded with HTTP ${res.status} for publication toggle.`,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const runIntegrityCheck = async () => {
    setBusyAction('stage5:integrity');
    setBanner(null);
    try {
      const res = await apiFetch('/api/public-signals/integrity-check', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        autoSuspended?: boolean;
        suspensionReason?: string | null;
        error?: string;
      };
      await refreshState();
      setBanner({
        ok: Boolean(res.ok && data.ok && !data.autoSuspended),
        message: data.autoSuspended
          ? data.suspensionReason || 'Safety auto-suspension engaged.'
          : data.error || 'Stage 5 data-integrity & mandatory safety checks passed.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const evaluation = snapshot?.evaluation ?? null;
  const publicSignals = feed?.signals ?? [];

  return (
    <section
      aria-label="Public Signal Validation and Approval Gate"
      data-testid="public-signal-validation-gate"
      className="forge-widget-contain overflow-hidden rounded-xl border border-slate-800 bg-[#0d1424] p-3.5 sm:p-5 space-y-4"
    >
      {/* Top Safety Invariant Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
            <span className="inline-flex items-center gap-1.5 rounded border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-blue-300 font-semibold">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              PHASE 1 · 5-STAGE PUBLIC SIGNAL GATE
            </span>
            <span className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-slate-300">
              DISPLAY ONLY · NEVER EXECUTES LIVE TRADES
            </span>
            <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-200">
              PAPER RESULTS = SIMULATED (NOT REAL PROFIT)
            </span>
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
            Public Signal Validation, 50-Check Gate &amp; Operator Approval
          </h2>
          <p className="text-xs text-slate-400 max-w-3xl leading-relaxed">
            A signal appears on the public screen only after Stage 1 Testnet verification, Stage 2
            timestamped Paper Trading observations (fees, spread, slippage), Stage 3 (50
            independently verifiable checks), and Stage 4 server-side authorized operator approval.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void refreshState()}
          disabled={loading || busyAction !== null}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 min-h-[40px] shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh Gate
        </button>
      </div>

      {/* Stage 5 Monitoring 4-KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-lg border border-slate-800 bg-[#111827] p-3">
          <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
            Validation Stage
          </p>
          <p className="mt-1 text-sm font-bold text-white break-words">
            {evaluation ? evaluation.currentStage.replace(/_/g, ' ') : 'LOADING...'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {evaluation?.autoSuspended ? 'Safety Auto-Suspended' : 'Non-Live Monitoring Active'}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#111827] p-3">
          <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
            50-Check Paper Gate
          </p>
          <p className="mt-1 text-sm font-bold font-mono text-white">
            {evaluation
              ? `${evaluation.validPaperChecksCount} / ${evaluation.requiredPaperChecksCount}`
              : '0 / 50'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {evaluation
              ? `${evaluation.paperWinsCount}W · ${evaluation.paperLossesCount}L · ${evaluation.rejectedPaperChecksCount} Rejected`
              : 'Loading counts...'}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#111827] p-3">
          <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
            Public Publication
          </p>
          <p
            className={`mt-1 text-sm font-bold font-mono ${
              evaluation?.autoSuspended
                ? 'text-rose-400'
                : evaluation?.publicPublicationEnabled
                  ? 'text-emerald-400'
                  : 'text-amber-300'
            }`}
          >
            {evaluation?.autoSuspended
              ? 'AUTO-SUSPENDED'
              : evaluation?.publicPublicationEnabled
                ? 'ENABLED (DISPLAY)'
                : 'DISABLED (DEFAULT)'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {publicSignals.length} public signal(s) visible
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#111827] p-3">
          <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
            Last Verified
          </p>
          <p className="mt-1 text-xs font-mono font-semibold text-slate-100 break-words">
            {formatUtcShort(evaluation?.lastVerifiedAtIso ?? null)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Integrity:{' '}
            <span
              className={
                evaluation === null
                  ? 'text-slate-300'
                  : evaluation.dataIntegrityPassed
                    ? 'text-emerald-400'
                    : 'text-rose-400'
              }
            >
              {evaluation === null
                ? 'CHECKING...'
                : evaluation.dataIntegrityPassed
                  ? 'VERIFIED'
                  : 'BREACH'}
            </span>
          </p>
        </div>
      </div>

      {/* Preserved Separate Live Trading Gate Status Strip */}
      {snapshot && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between text-xs">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-200 min-w-0">
            <Lock className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
            <span className="font-semibold">Separate Live Trading Gate (Preserved Untouched):</span>
            <span className="font-mono text-amber-300">
              {snapshot.separateLiveTradingGate.liveGateStatus} (
              {snapshot.separateLiveTradingGate.consecutiveProfitablePaperTrades}/
              {snapshot.separateLiveTradingGate.requiredConsecutivePaperWins} consecutive wins)
            </span>
          </div>
          <span className="font-mono text-[11px] text-slate-400 break-words">
            Mode: {snapshot.separateLiveTradingGate.currentTradingMode} · Public approval never
            triggers live orders
          </span>
        </div>
      )}

      {/* Withholding Reasons & Auto-Suspension Alert */}
      {evaluation && evaluation.withholdingReasons.length > 0 && (
        <div
          className={`rounded-lg border p-3.5 space-y-1.5 ${
            evaluation.autoSuspended
              ? 'border-rose-500/40 bg-rose-950/30'
              : 'border-amber-500/30 bg-amber-950/20'
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-200">
            <AlertTriangle
              className={`h-4 w-4 shrink-0 ${
                evaluation.autoSuspended ? 'text-rose-400' : 'text-amber-400'
              }`}
              aria-hidden="true"
            />
            <span>
              {evaluation.autoSuspended
                ? 'PUBLIC ELIGIBILITY AUTO-SUSPENDED — SIGNALS WITHHELD'
                : 'Active Reasons Signals Are Withheld From Public Screen'}
            </span>
          </div>
          <ul className="list-disc pl-5 space-y-1 text-xs text-slate-300">
            {evaluation.withholdingReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Action Feedback Banner */}
      {banner && (
        <div
          role="status"
          className={`rounded-lg border px-3.5 py-2.5 text-xs flex items-start gap-2 ${
            banner.ok
              ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
              : 'border-rose-500/40 bg-rose-950/30 text-rose-200'
          }`}
        >
          {banner.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-400" aria-hidden="true" />
          ) : (
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" aria-hidden="true" />
          )}
          <span className="leading-relaxed break-words">{banner.message}</span>
        </div>
      )}

      {/* Approved Public Signals Display Box (Strictly Filtered Server Feed) */}
      <div className="rounded-lg border border-slate-800 bg-[#0b1120] p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {publicSignals.length > 0 ? (
              <Eye className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            ) : (
              <EyeOff className="h-4 w-4 text-slate-400" aria-hidden="true" />
            )}
            <h3 className="text-sm font-semibold text-white">
              Approved Public Signals Screen (Display Only)
            </h3>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            Backend Feed: /api/public-signals/feed · {publicSignals.length} Published
          </span>
        </div>

        {publicSignals.length === 0 ? (
          <div
            data-testid="public-signals-empty-state"
            className="rounded-lg border border-dashed border-slate-700 bg-slate-900/50 p-4 text-center space-y-1"
          >
            <p className="text-xs font-semibold text-slate-200">
              No Public Signals Currently Published (Private By Default)
            </p>
            <p className="text-[11px] text-slate-400 max-w-xl mx-auto">
              Incomplete, failed, or unapproved signals remain strictly private. Signals appear here
              only after Stages 1–3 pass, an authorized operator approves the signal on the backend,
              and global Public Display is enabled.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {publicSignals.map((sig) => (
              <div
                key={sig.signalId}
                className="rounded-lg border border-emerald-500/30 bg-emerald-950/15 p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm text-white">{sig.symbol}</span>
                    <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-mono text-emerald-300">
                      {sig.side} · {sig.timeframe}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-300">
                    PUBLIC DISPLAY ONLY
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-slate-400 block">ENTRY</span>
                    <span className="text-white">${formatCryptoPrice(sig.entryPrice)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">STOP LOSS</span>
                    <span className="text-rose-300">${formatCryptoPrice(sig.stopLossPrice)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">TAKE PROFIT</span>
                    <span className="text-emerald-300">${formatCryptoPrice(sig.takeProfitPrice)}</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 font-mono">
                  Approved by {sig.approvedBy} · {formatUtcShort(sig.approvedAtIso)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Navigation Tabs for Compact Mobile & Desktop Inspection */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2" role="tablist">
        {(
          [
            { id: 'WORKFLOW', label: '5-Stage Controls & Approval' },
            {
              id: 'EVIDENCE',
              label: `Paper Evidence (${snapshot?.recentPaperEvidence.length ?? 0})`,
            },
            { id: 'AUDIT', label: `Audit History (${snapshot?.auditHistory.length ?? 0})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-lg px-3 py-2 text-xs font-semibold min-h-[38px] transition-colors ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'WORKFLOW' && (
        <div className="space-y-4">
          {/* 5-Stage Status Stepper */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2.5">
            {(evaluation?.stages ?? []).map((stage) => (
              <div
                key={stage.stageId}
                className="rounded-lg border border-slate-800 bg-[#111827] p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-white leading-snug">
                    {stage.title}
                  </span>
                </div>
                <span
                  className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-mono font-semibold ${stageBadgeClasses(
                    stage.status
                  )}`}
                >
                  {stage.status}
                </span>
                <p className="text-[11px] text-slate-400 leading-relaxed">{stage.summary}</p>
              </div>
            ))}
          </div>

          {/* Operator Actions Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            {/* Stage 1 & Stage 2/3 Verification Controls */}
            <div className="rounded-lg border border-slate-800 bg-[#111827] p-3.5 space-y-3">
              <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-blue-300">
                Stages 1–3 · Testnet &amp; Paper Observation Verification
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="text-[11px] text-slate-300 space-y-1">
                  <span>Observed Symbol</span>
                  <select
                    aria-label="Observed Symbol"
                    value={paperSymbol}
                    onChange={(e) =>
                      setPaperSymbol(e.target.value === 'ETH/USDT' ? 'ETH/USDT' : 'BTC/USDT')
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white min-h-[40px]"
                  >
                    <option value="BTC/USDT">BTC/USDT (${formatCryptoPrice(liveBtcPrice || 91400)})</option>
                    <option value="ETH/USDT">ETH/USDT (${formatCryptoPrice(liveEthPrice || 3250)})</option>
                  </select>
                </label>

                <label className="text-[11px] text-slate-300 space-y-1">
                  <span>Simulated Outcome</span>
                  <select
                    aria-label="Simulated Outcome"
                    value={paperOutcomeMode}
                    onChange={(e) =>
                      setPaperOutcomeMode(e.target.value === 'LOSS' ? 'LOSS' : 'WIN')
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white min-h-[40px]"
                  >
                    <option value="WIN">Simulated Win (+1.2% gross)</option>
                    <option value="LOSS">Simulated Loss (-0.9% gross)</option>
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void runStage1Check('testnet.binance.vision')}
                  className="flex-1 min-w-[160px] rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-3 py-2.5 text-xs font-semibold text-white min-h-[42px]"
                >
                  Run Stage 1 Testnet Check
                </button>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void runStage1Check('api.binance.com')}
                  className="rounded-lg border border-rose-500/40 bg-rose-950/30 hover:bg-rose-950/50 disabled:opacity-50 px-3 py-2.5 text-xs font-semibold text-rose-200 min-h-[42px]"
                >
                  Test Live-Host Block
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void recordPaperObservation(false)}
                  className="flex-1 min-w-[160px] rounded-lg border border-emerald-500/40 bg-emerald-950/30 hover:bg-emerald-950/50 disabled:opacity-50 px-3 py-2.5 text-xs font-semibold text-emerald-200 min-h-[42px]"
                >
                  Record Verified Paper Observation
                </button>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void recordPaperObservation(true)}
                  className="rounded-lg border border-amber-500/40 bg-amber-950/30 hover:bg-amber-950/50 disabled:opacity-50 px-3 py-2.5 text-xs font-semibold text-amber-200 min-h-[42px]"
                >
                  Test Reject Demo Sample
                </button>
              </div>

              <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-800">
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void registerPrivateCandidate()}
                  className="flex-1 min-w-[160px] rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 px-3 py-2.5 text-xs font-semibold text-slate-100 min-h-[42px]"
                >
                  Register Private Candidate Signal
                </button>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void runIntegrityCheck()}
                  className="rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 px-3 py-2.5 text-xs font-semibold text-slate-200 min-h-[42px]"
                >
                  Re-Verify Stage 5 Integrity
                </button>
              </div>
            </div>

            {/* Stage 4 Backend Operator Approval Gate */}
            <div className="rounded-lg border border-slate-800 bg-[#111827] p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-amber-300">
                  Stage 4 · Server-Side Operator Approval Gate
                </h3>
                <span
                  className={`rounded border px-2 py-0.5 text-[10px] font-mono ${
                    clearance?.authorizedOperator
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-slate-700 bg-slate-900 text-slate-300'
                  }`}
                >
                  {clearance?.authorizedOperator
                    ? `AUTHORIZED: ${clearance.role}`
                    : `ROLE: ${clearance?.role ?? 'GUEST'} (BACKEND PROTECTED)`}
                </span>
              </div>

              <label className="block text-[11px] text-slate-300 space-y-1">
                <span>Operator Decision Audit Note</span>
                <input
                  type="text"
                  aria-label="Operator Decision Audit Note"
                  value={approvalNote}
                  onChange={(e) => setApprovalNote(e.target.value)}
                  placeholder="Optional rationale logged in backend audit history..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder:text-slate-500 min-h-[40px]"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() =>
                    void handleGlobalPublicationToggle(!(evaluation?.publicPublicationEnabled ?? false))
                  }
                  className={`flex-1 min-w-[180px] rounded-lg px-3 py-2.5 text-xs font-semibold min-h-[42px] disabled:opacity-50 ${
                    evaluation?.publicPublicationEnabled
                      ? 'border border-rose-500/40 bg-rose-950/40 text-rose-200 hover:bg-rose-950/60'
                      : 'border border-emerald-500/40 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-950/60'
                  }`}
                >
                  {evaluation?.publicPublicationEnabled
                    ? 'Disable Global Public Display'
                    : 'Enable Global Public Display (Admin)'}
                </button>
              </div>

              {/* Private Candidates Queue */}
              <div className="space-y-2 pt-1 border-t border-slate-800">
                <p className="text-[11px] font-mono text-slate-400">
                  Private / Pending Candidates ({snapshot?.privateCandidates.length ?? 0})
                </p>
                {!snapshot || snapshot.privateCandidates.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No private candidate signals registered yet. Use &ldquo;Register Private
                    Candidate Signal&rdquo; to stage one.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {snapshot.privateCandidates.slice(0, 6).map((cand) => (
                      <div
                        key={cand.signalId}
                        className="rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="text-xs min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 font-mono">
                            <span className="font-bold text-white">{cand.symbol}</span>
                            <span className="text-blue-300">{cand.side}</span>
                            <span className="text-[10px] text-slate-400 truncate max-w-[160px]">
                              {cand.signalId}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 font-mono">
                            Status: {cand.approvalStatus} · Entry ${formatCryptoPrice(cand.entryPrice)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() => void handleOperatorDecision(cand.signalId, 'APPROVE')}
                            className="rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-2.5 py-1.5 text-[11px] font-semibold text-white min-h-[34px]"
                          >
                            Approve Public
                          </button>
                          <button
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() => void handleOperatorDecision(cand.signalId, 'REJECT')}
                            className="rounded border border-rose-500/40 bg-rose-950/30 hover:bg-rose-950/50 disabled:opacity-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-200 min-h-[34px]"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'EVIDENCE' && (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-400">
            All recorded Paper Trading observations (both accepted simulated outcomes and rejected
            invalid/demo submissions). Simulated PnL reflects fees, spread, and slippage and is
            never labeled real profit.
          </p>
          {!snapshot || snapshot.recentPaperEvidence.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">
              No Paper Trading evidence recorded yet.
            </p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {snapshot.recentPaperEvidence.map((ev) => (
                <div
                  key={ev.id}
                  className="rounded-lg border border-slate-800 bg-[#111827] p-3 text-xs space-y-1"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono">
                    <div className="flex items-center gap-2">
                      {ev.status === 'ACCEPTED' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-rose-400" aria-hidden="true" />
                      )}
                      <span className="font-semibold text-white">{ev.symbol}</span>
                      <span className="text-slate-400">{ev.tradeEvidenceId}</span>
                    </div>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        ev.status === 'ACCEPTED'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-rose-500/15 text-rose-300'
                      }`}
                    >
                      {ev.status} · {ev.outcome} · SIMULATED
                    </span>
                  </div>
                  <p className="text-[11px] font-mono text-slate-400">
                    Source: {ev.marketSource} · Fee: ${ev.feeUsd.toFixed(2)} · Spread:{' '}
                    {ev.spreadBps.toFixed(1)}bps · Slippage: {ev.slippageBps.toFixed(1)}bps · Sim
                    Net PnL: ${ev.simulatedNetPnlUsd.toFixed(2)}
                  </p>
                  {ev.rejectionReason && (
                    <p className="text-[11px] text-rose-300 break-words">
                      Rejection: {ev.rejectionReason}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'AUDIT' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ClipboardList className="h-4 w-4 text-blue-400" aria-hidden="true" />
            <span>Immutable Backend Decision &amp; Verification Audit Log</span>
          </div>
          {!snapshot || snapshot.auditHistory.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">No audit entries logged yet.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {snapshot.auditHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-slate-800 bg-[#111827] p-2.5 text-xs space-y-1"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                    <span className={entry.passed ? 'text-emerald-300' : 'text-rose-300'}>
                      {entry.eventType}
                    </span>
                    <span className="text-slate-400">{formatUtcShort(entry.timestampIso)}</span>
                  </div>
                  <p className="text-slate-200 break-words">{entry.summary}</p>
                  <p className="text-[10px] font-mono text-slate-500">
                    Actor: {entry.actor}
                    {entry.signalId ? ` · Signal: ${entry.signalId}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Future Modular Extensions Footer (Inactive Placeholders Only) */}
      {snapshot && (
        <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <span className="font-mono uppercase text-slate-500">Future Modular Extensions:</span>
          {snapshot.futureExtensions.map((ext) => (
            <span
              key={ext.id}
              className="rounded border border-slate-800 bg-slate-950 px-2 py-0.5 font-mono text-[10px] text-slate-400"
            >
              {ext.label} (Disabled · Future Only)
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

export const PublicSignalValidationGatePanel = memo(PublicSignalValidationGatePanelComponent);

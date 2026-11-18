import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  UploadCloud,
} from 'lucide-react';
import type {
  PgV4AggregateStatus,
  PgV4ConjunctStatus,
  PgV4GateRecord,
  PgV4TierId,
} from '../lib/pgV4Gate';
import type { RiskEngineState } from '../lib/riskEngine';
import type { WalkForwardOrchestrationReport } from '../lib/walkForwardOrchestrator';
import { apiFetch } from '../lib/apiClient';

interface RiskEngineSchemaPayload {
  readonly minRRKernelConstant: number;
  readonly threeCheckPlacement: ReadonlyArray<string>;
  readonly rejectionTaxonomy: ReadonlyArray<string>;
  readonly sixLevelDrawdownLimits: {
    readonly PORTFOLIO_DAILY_PCT: number;
    readonly PORTFOLIO_PEAK_TO_TROUGH_PCT: number;
    readonly STRATEGY_DAILY_PCT: number;
    readonly STRATEGY_PEAK_TO_TROUGH_PCT: number;
    readonly REGIME_SCOPED_PCT: number;
    readonly CONSECUTIVE_LOSSES_TRIGGER: number;
  };
  readonly synchronousCanTradeGate: boolean;
  readonly forbidPostHocStopTightening: boolean;
  readonly liveRiskState?: RiskEngineState;
}

interface CpsDiagnosticsPayload {
  readonly cpsKernelHash: string;
  readonly sourceTable: ReadonlyArray<{
    readonly instrumentClass: string;
    readonly source_id: string;
    readonly streamChannel: string;
    readonly secondaryCheckEndpoint: string;
    readonly divergenceThresholdBps: number;
    readonly freshnessCeilingMs: number;
  }>;
  readonly ddViewWatermark: {
    readonly applied_fill_sequence: number;
    readonly fill_stream_head_sequence: number;
    readonly current_equity: number;
    readonly hwm_equity: number;
  };
  readonly threeTierResetSchedule: {
    readonly tier2WatchdogIntervalMs: number;
    readonly tier3HardResetIntervalMs: number;
  };
  readonly reconcilerFreshness: {
    readonly fresh: boolean;
    readonly ageMs: number;
  };
}

interface PromotionReceipt {
  readonly promotionId: string;
  readonly promotionRequestId: string;
  readonly requestedBy: string;
  readonly certifiedAtUtc: string;
  readonly gateLogicHash: string;
  readonly recordHash: string;
  readonly retainUntilUtc: string;
}

interface ChainIntegritySummary {
  readonly valid: boolean;
  readonly count: number;
  readonly brokenAtSeq: number | null;
}

interface PgV4ApiPayload {
  readonly ok: boolean;
  readonly currentLogicVersion: string;
  readonly currentLogicHash: string;
  readonly minRetentionDays: number;
  readonly gateRecord: PgV4GateRecord;
  readonly walkForwardReport?: WalkForwardOrchestrationReport;
  readonly chainIntegrity: ChainIntegritySummary;
  readonly promotions?: PromotionReceipt[];
  readonly records?: PgV4GateRecord[];
  readonly accepted?: boolean;
  readonly promotionId?: string;
  readonly reason?: string;
  readonly error?: string;
}

const TIER_META: ReadonlyArray<{
  readonly tier: PgV4TierId;
  readonly label: string;
  readonly ruleNote: string;
}> = [
  {
    tier: 'TIER_1_PREFLIGHT_IDENTITY',
    label: 'Tier 1 · Pre-Flight Identity (Fail-Fast · Uncached)',
    ruleNote: 'Recomputed fresh per request. Any failure short-circuits Tiers 2 & 3 -> SKIPPED.',
  },
  {
    tier: 'TIER_2_DEPLOYMENT_BLOCKING',
    label: 'Tier 2 · Deployment-Blocking Safety & EU AI Act Governance',
    ruleNote: 'Required for regulated execution and Art. 9–15 deployment eligibility.',
  },
  {
    tier: 'TIER_3_PROMOTION_CONJUNCTS',
    label: 'Tier 3 · Walk-Forward & Parity Promotion Conjuncts',
    ruleNote: 'All 7 statistical, fill-equivalence, R:R, and drawdown hierarchy gates must PASS.',
  },
];

function getStatusBadgeClasses(status: PgV4ConjunctStatus | PgV4AggregateStatus): string {
  switch (status) {
    case 'PASS':
      return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300';
    case 'AMBER':
      return 'border-amber-500/40 bg-amber-500/15 text-amber-300';
    case 'OFFLINE':
      return 'border-slate-500/40 bg-slate-700/30 text-slate-300';
    case 'SKIPPED':
      return 'border-slate-600/40 bg-slate-800/60 text-slate-400';
    case 'FAIL':
    default:
      return 'border-rose-500/40 bg-rose-500/15 text-rose-300';
  }
}

export function TrustConsolePanel({ initialSymbol = 'BTCUSDT' }: { readonly initialSymbol?: string }) {
  const [symbol, setSymbol] = useState<string>(initialSymbol);
  const [loading, setLoading] = useState<boolean>(true);
  const [promoting, setPromoting] = useState<boolean>(false);
  const [gateRecord, setGateRecord] = useState<PgV4GateRecord | null>(null);
  const [walkForwardReport, setWalkForwardReport] = useState<WalkForwardOrchestrationReport | null>(
    null
  );
  const [records, setRecords] = useState<PgV4GateRecord[]>([]);
  const [promotions, setPromotions] = useState<PromotionReceipt[]>([]);
  const [chainIntegrity, setChainIntegrity] = useState<ChainIntegritySummary>({
    valid: true,
    count: 0,
    brokenAtSeq: null,
  });
  const [minRetentionDays, setMinRetentionDays] = useState<number>(1825);
  const [riskSchema, setRiskSchema] = useState<RiskEngineSchemaPayload | null>(null);
  const [cpsSchema, setCpsSchema] = useState<CpsDiagnosticsPayload | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const runFreshEvaluation = useCallback(
    async (targetSymbol: string) => {
      setLoading(true);
      try {
        const [evalRes, recordsRes, schemaRes] = await Promise.all([
          fetch(`/api/pg-v4/evaluate?symbol=${encodeURIComponent(targetSymbol)}&timeframe=15m`),
          fetch('/api/pg-v4/records'),
          fetch('/api/systemic/schema'),
        ]);
        const evalData = (await evalRes.json()) as PgV4ApiPayload;
        const recordsData = (await recordsRes.json()) as PgV4ApiPayload;
        const schemaData = (await schemaRes.json()) as {
          readonly ok?: boolean;
          readonly riskEngine?: RiskEngineSchemaPayload;
          readonly cps?: CpsDiagnosticsPayload;
        };

        if (evalData.ok && evalData.gateRecord) {
          setGateRecord(evalData.gateRecord);
          if (evalData.walkForwardReport) {
            setWalkForwardReport(evalData.walkForwardReport);
          }
          setMinRetentionDays(evalData.minRetentionDays || 1825);
        } else {
          setFeedback({
            ok: false,
            text: evalData.error || 'Failed to evaluate PG_v4 gate.',
          });
        }

        if (recordsData.ok) {
          setRecords(recordsData.records ?? []);
          setPromotions(recordsData.promotions ?? []);
          setChainIntegrity(
            recordsData.chainIntegrity ?? { valid: true, count: 0, brokenAtSeq: null }
          );
        }

        if (schemaData.ok && schemaData.riskEngine) {
          setRiskSchema(schemaData.riskEngine);
        }
        if (schemaData.ok && schemaData.cps) {
          setCpsSchema(schemaData.cps);
        }
      } catch (err) {
        setFeedback({
          ok: false,
          text: err instanceof Error ? err.message : 'Network error loading Trust Console.',
        });
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    runFreshEvaluation(symbol);
  }, [symbol, runFreshEvaluation]);

  const handleSubmitPromotion = async () => {
    setPromoting(true);
    setFeedback(null);
    try {
      const requestId = `prom_tc_${symbol}_${Date.now()}`;
      const res = await apiFetch('/api/promotions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promotionRequestId: requestId,
          requestedBy: 'trust-console-operator',
          symbol,
          timeframe: '15m',
        }),
      });
      const data = (await res.json()) as PgV4ApiPayload;
      if (data.gateRecord) setGateRecord(data.gateRecord);
      if (data.walkForwardReport) setWalkForwardReport(data.walkForwardReport);
      if (data.records) setRecords(data.records);
      if (data.promotions) setPromotions(data.promotions);
      if (data.chainIntegrity) setChainIntegrity(data.chainIntegrity);

      if (res.ok && data.accepted) {
        setFeedback({
          ok: true,
          text: data.reason || `Promotion ${data.promotionId} certified and appended cleanly.`,
        });
      } else {
        setFeedback({
          ok: false,
          text: data.error || 'Promotion rejected by PG_v4 gate.',
        });
      }
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Promotion submission failed.',
      });
    } finally {
      setPromoting(false);
    }
  };

  const aggState = gateRecord?.aggregateState ?? 'OFFLINE';
  const scorecard = gateRecord?.scorecard ?? walkForwardReport?.scorecard ?? null;

  return (
    <section
      aria-label="PG_v4 Trust Console"
      data-testid="trust-console-panel"
      className="rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden"
    >
      {/* Top Header */}
      <div className="flex flex-col gap-4 border-b border-slate-800/80 bg-[#0d1323] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            <span className="text-blue-400 font-semibold uppercase tracking-wider">
              Trust Console · PG_v4 Certification Gate
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-300">
              Logic v{gateRecord?.pgLogicVersion ?? '4.1.0'} (
              {gateRecord?.gateLogicHash?.slice(0, 12) ?? 'computing'})
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-emerald-300">
              Identity Uncached Seq #{gateRecord?.identityEvaluationSeq ?? 0}
            </span>
          </div>
          <h2 className="mt-1 font-display text-xl font-bold text-white flex flex-wrap items-center gap-2.5">
            <span>14-Conjunct Production Promotion &amp; EU AI Act Verification</span>
            <span
              data-testid="pgv4-aggregate-badge"
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 font-mono text-xs font-bold ${getStatusBadgeClasses(aggState)}`}
            >
              {aggState === 'PASS' ? (
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              ) : aggState === 'AMBER' ? (
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ShieldX className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>AGGREGATE: {aggState}</span>
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Precedence FAIL &gt; OFFLINE &gt; AMBER &gt; PASS · Minimum {minRetentionDays}-day (5-year) append-only hash-chained ledger.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Trust Console Asset"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="rounded-lg border border-slate-700 bg-[#0a0e1a] px-3 py-2 font-mono text-xs font-semibold text-white focus:border-[#3b82f6] focus:outline-none"
          >
            <option value="BTCUSDT">BTCUSDT</option>
            <option value="ETHUSDT">ETHUSDT</option>
            <option value="SOLUSDT">SOLUSDT</option>
            <option value="BNBUSDT">BNBUSDT</option>
          </select>

          <button
            type="button"
            data-testid="pgv4-re-evaluate-btn"
            onClick={() => runFreshEvaluation(symbol)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0a0e1a] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-[#3b82f6] hover:text-white transition-colors cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{loading ? 'Evaluating...' : 'Re-Evaluate Fresh Gate'}</span>
          </button>

          <button
            type="button"
            data-testid="pgv4-promote-btn"
            onClick={handleSubmitPromotion}
            disabled={promoting || loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#3b82f6] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors cursor-pointer disabled:opacity-60"
          >
            <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{promoting ? 'Certifying...' : 'Submit Promotion Request'}</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          data-testid="pgv4-feedback-banner"
          className={`border-b px-5 py-2.5 text-xs font-mono flex items-center gap-2 ${
            feedback.ok
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
          }`}
        >
          {feedback.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
          ) : (
            <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400" aria-hidden="true" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Walk-Forward Stability Scorecard */}
      {scorecard && (
        <div
          data-testid="wfv-stability-scorecard"
          className="grid grid-cols-2 divide-y divide-slate-800/80 border-b border-slate-800/80 bg-[#0a0e1a] sm:grid-cols-3 lg:grid-cols-6 sm:divide-x sm:divide-y-0"
        >
          <div className="px-4 py-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Mean OOS Return
            </div>
            <div
              className={`mt-1 font-mono text-base font-bold tabular-nums ${
                scorecard.meanOosReturn >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {scorecard.meanOosReturn >= 0 ? '+' : ''}
              {scorecard.meanOosReturn.toFixed(2)}%
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              OOS Std Dev
            </div>
            <div className="mt-1 font-mono text-base font-bold tabular-nums text-slate-200">
              {scorecard.stdDevOosReturn.toFixed(2)}%
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Train → Test Ratio
            </div>
            <div className="mt-1 font-mono text-base font-bold tabular-nums text-blue-300">
              {scorecard.trainToTestDegradationRatio.toFixed(3)}x
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Sign Consistency
            </div>
            <div className="mt-1 font-mono text-base font-bold tabular-nums text-emerald-300">
              {(scorecard.signConsistency * 100).toFixed(0)}%
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Parameter Drift
            </div>
            <div className="mt-1 font-mono text-base font-bold tabular-nums text-cyan-300">
              {scorecard.parameterDrift.toFixed(3)}
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Overfitting Prob (PBO)
            </div>
            <div
              className={`mt-1 font-mono text-base font-bold tabular-nums ${
                scorecard.overfittingProbabilityEstimate <= 0.3
                  ? 'text-emerald-400'
                  : scorecard.overfittingProbabilityEstimate <= 0.45
                  ? 'text-amber-300'
                  : 'text-rose-400'
              }`}
            >
              {(scorecard.overfittingProbabilityEstimate * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      )}

      {/* Risk Engine: 1:5 RRGateKernel & 6-Level Drawdown Hierarchy */}
      {riskSchema && (
        <div
          data-testid="risk-engine-hierarchy-panel"
          className="border-b border-slate-800/80 bg-[#0d1323] p-4 sm:px-5 space-y-3"
        >
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-200">
                L0/L3 Risk Engine · Synchronous can_trade() &amp; 1:{riskSchema.minRRKernelConstant} RRGateKernel
              </h3>
              <p className="text-[11px] text-slate-400">
                Kernel Constant <span className="font-mono text-emerald-300">min_rr={riskSchema.minRRKernelConstant}</span>{' '}
                (zero post-hoc stop tightening) · Placement:{' '}
                <span className="font-mono text-blue-300">
                  {riskSchema.threeCheckPlacement.join(' -> ')}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
              {riskSchema.rejectionTaxonomy.map((code) => (
                <span
                  key={code}
                  className="rounded border border-slate-700/90 bg-[#0a0e1a] px-2 py-0.5 text-slate-300"
                >
                  {code}
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-lg border border-slate-800/90 bg-[#0a0e1a] px-3 py-2.5">
              <div className="text-[10px] font-mono uppercase text-slate-400">Portfolio Daily</div>
              <div className="mt-1 font-mono text-sm font-bold text-emerald-300 tabular-nums">
                {(riskSchema.liveRiskState?.portfolioDailyDrawdownPct ?? 0).toFixed(2)}% / &le; {riskSchema.sixLevelDrawdownLimits.PORTFOLIO_DAILY_PCT}%
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500">Halts portfolio</div>
            </div>

            <div className="rounded-lg border border-slate-800/90 bg-[#0a0e1a] px-3 py-2.5">
              <div className="text-[10px] font-mono uppercase text-slate-400">Portfolio P2T</div>
              <div className="mt-1 font-mono text-sm font-bold text-emerald-300 tabular-nums">
                {(riskSchema.liveRiskState?.portfolioPeakToTroughPct ?? 0).toFixed(2)}% / &le; {riskSchema.sixLevelDrawdownLimits.PORTFOLIO_PEAK_TO_TROUGH_PCT}%
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500">Peak-to-trough halt</div>
            </div>

            <div className="rounded-lg border border-slate-800/90 bg-[#0a0e1a] px-3 py-2.5">
              <div className="text-[10px] font-mono uppercase text-slate-400">Strategy Daily</div>
              <div className="mt-1 font-mono text-sm font-bold text-cyan-300 tabular-nums">
                &le; {riskSchema.sixLevelDrawdownLimits.STRATEGY_DAILY_PCT}%
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500">Demotes strategy only</div>
            </div>

            <div className="rounded-lg border border-slate-800/90 bg-[#0a0e1a] px-3 py-2.5">
              <div className="text-[10px] font-mono uppercase text-slate-400">Strategy P2T</div>
              <div className="mt-1 font-mono text-sm font-bold text-cyan-300 tabular-nums">
                &le; {riskSchema.sixLevelDrawdownLimits.STRATEGY_PEAK_TO_TROUGH_PCT}%
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500">Demotes strategy only</div>
            </div>

            <div className="rounded-lg border border-slate-800/90 bg-[#0a0e1a] px-3 py-2.5">
              <div className="text-[10px] font-mono uppercase text-slate-400">Regime-Scoped</div>
              <div className="mt-1 font-mono text-sm font-bold text-blue-300 tabular-nums">
                &le; {riskSchema.sixLevelDrawdownLimits.REGIME_SCOPED_PCT}%
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500">Blocks strategy+regime</div>
            </div>

            <div className="rounded-lg border border-slate-800/90 bg-[#0a0e1a] px-3 py-2.5">
              <div className="text-[10px] font-mono uppercase text-slate-400">Consec Losses CB</div>
              <div className="mt-1 font-mono text-sm font-bold text-amber-300 tabular-nums">
                &le; {riskSchema.sixLevelDrawdownLimits.CONSECUTIVE_LOSSES_TRIGGER} losses
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500">Fires at exact 6</div>
            </div>
          </div>
        </div>
      )}

      {/* Certified Primary Source (CPS) & Event-Sourced State Integrity */}
      {cpsSchema && (
        <div
          data-testid="cps-protocol-panel"
          className="border-b border-slate-800/80 bg-[#0a0e1a] p-4 sm:px-5 space-y-2.5"
        >
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-300">
              Certified Primary Source (CPS) · I-PD1..4 &amp; Zero-Failover Event-Sourced State
            </h3>
            <span className="text-[11px] font-mono text-slate-400">
              DD Seq {cpsSchema.ddViewWatermark.applied_fill_sequence}/{cpsSchema.ddViewWatermark.fill_stream_head_sequence} ·{' '}
              Watchdog {cpsSchema.threeTierResetSchedule.tier2WatchdogIntervalMs}ms ·{' '}
              Hard Reset {Math.round(cpsSchema.threeTierResetSchedule.tier3HardResetIntervalMs / 60000)}m
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {cpsSchema.sourceTable.map((src) => (
              <div
                key={src.instrumentClass}
                className="rounded-lg border border-slate-800/90 bg-[#0d1323] px-3 py-2 text-[11px] font-mono"
              >
                <div className="flex items-center justify-between text-white font-semibold">
                  <span>{src.instrumentClass}</span>
                  <span className="text-emerald-300">{src.freshnessCeilingMs}ms max</span>
                </div>
                <div className="mt-0.5 text-cyan-300 truncate">{src.source_id}</div>
                <div className="mt-0.5 text-slate-400">
                  Cross-check {src.secondaryCheckEndpoint} (&le;{src.divergenceThresholdBps} bps · no failover)
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 14 Conjuncts Grouped by Strictly Ordered Evaluation Tier */}
      <div className="divide-y divide-slate-800/80">
        {TIER_META.map((group) => {
          const rows = (gateRecord?.conjuncts ?? []).filter((c) => c.tier === group.tier);
          return (
            <div key={group.tier} className="p-4 sm:px-5 space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-200">
                  {group.label}
                </h3>
                <span className="text-[11px] text-slate-400">{group.ruleNote}</span>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-800/80 bg-[#0a0e1a]">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="border-b border-slate-800 text-slate-400 font-sans">
                    <tr>
                      <th className="px-3 py-2 w-10">#</th>
                      <th className="px-3 py-2">Conjunct</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Observed Telemetry</th>
                      <th className="px-3 py-2">Threshold</th>
                      <th className="px-3 py-2 text-right">Evidence Ref &amp; Hash</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {rows.map((c) => (
                      <tr
                        key={c.conjunctId}
                        data-testid={`conjunct-row-${c.conjunctId}`}
                        className="hover:bg-slate-800/30"
                      >
                        <td className="px-3 py-2 text-slate-500">{c.evalOrder}</td>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-white">{c.conjunctId}</div>
                          <div className="font-sans text-[11px] text-slate-400">{c.title}</div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-bold ${getStatusBadgeClasses(c.status)}`}
                          >
                            {c.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-200">{c.observedValue}</td>
                        <td className="px-3 py-2 font-sans text-[11px] text-slate-400 max-w-xs">
                          {c.thresholdSpec}
                        </td>
                        <td className="px-3 py-2 text-right text-[11px] text-slate-400">
                          <div className="truncate max-w-[230px] ml-auto text-slate-300" title={c.evidence_ref}>
                            {c.evidence_ref}
                          </div>
                          <div className="text-cyan-400/90" title={c.evidence_hash}>
                            sha256:{c.evidence_hash.slice(0, 14)}…
                          </div>
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                          {loading ? 'Loading conjunct evaluation...' : 'No conjunct records available.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      {/* Immutable Append-Only 5-Year Gate & Promotion Ledger */}
      <div className="border-t border-slate-800/80 bg-[#0d1323] px-5 py-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 font-mono font-semibold text-slate-200">
            <Lock className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
            <span>Append-Only Gate Ledger ({minRetentionDays}-Day Retention Seal)</span>
          </div>
          <div className="font-mono text-[11px] text-slate-400">
            Chain Integrity:{' '}
            <strong className={chainIntegrity.valid ? 'text-emerald-400' : 'text-rose-400'}>
              {chainIntegrity.valid ? 'VERIFIED' : `BROKEN@${chainIntegrity.brokenAtSeq}`}
            </strong>{' '}
            · {records.length} Sealed Record(s) · {promotions.length} Promotion(s)
          </div>
        </div>

        {records.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#0a0e1a]">
            <table className="w-full text-left text-[11px] font-mono">
              <thead className="border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="px-3 py-2">Seq</th>
                  <th className="px-3 py-2">Request ID</th>
                  <th className="px-3 py-2">Aggregate</th>
                  <th className="px-3 py-2">Retain Until (5Y)</th>
                  <th className="px-3 py-2 text-right">Sealed Record Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {records.slice(0, 6).map((rec) => (
                  <tr key={rec.promotionRequestId}>
                    <td className="px-3 py-2 text-slate-500">#{rec.sequenceNumber ?? '-'}</td>
                    <td className="px-3 py-2 text-white">{rec.promotionRequestId}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-bold ${getStatusBadgeClasses(rec.aggregateState)}`}
                      >
                        {rec.aggregateState}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-300">{rec.retainUntilUtc.slice(0, 10)}</td>
                    <td className="px-3 py-2 text-right text-cyan-300">
                      {rec.recordHash ? `${rec.recordHash.slice(0, 18)}…` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

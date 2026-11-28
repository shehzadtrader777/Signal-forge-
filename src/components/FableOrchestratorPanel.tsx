import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Check,
  Code2,
  Copy,
  Database,
  GitBranch,
  Layers,
  Play,
  ShieldAlert,
  ShieldCheck,
  Sigma,
} from 'lucide-react';
import type {
  BlackScholesValuation,
  FableFourGateValidationReport,
  FableInverseVarianceWeight,
  FableLayerStatusItem,
  FableOptionType,
  FablePreTradeRiskDecision,
  FablePropFirmLimits,
  FableStrategicMemoryEntry,
  FableStrategyFamily,
  FableStrategyParams,
  FableStrategyVersion,
  FableVolatilityRegime,
  IvSurfacePoint,
} from '../lib/fableOrchestratorEngine';
import type { WidgetLayoutContract, WidgetMetadataSegment, WidgetMetricItem } from '../lib/designSystem';
import { apiFetch } from '../lib/apiClient';
import {
  ForgeInteractiveButton,
  ForgeMetricStrip,
  ForgeSegmentedControl,
  ForgeWidgetFrame,
  type SegmentedOption,
} from './ui/ForgeDesignSystem';

interface FableDeploymentTicketView {
  readonly versionId: string;
  readonly stage: 'PAPER_TRADING' | 'LIVE_APPROVED';
  readonly stagedAtIso: string;
  readonly approvedAtIso: string | null;
  readonly approvedBy: string | null;
}

interface FableSnapshotPayload {
  readonly layers: readonly FableLayerStatusItem[];
  readonly propLimits: FablePropFirmLimits;
  readonly activeVersion: FableStrategyVersion;
  readonly versionCounter: number;
  readonly inverseVarianceWeights: readonly FableInverseVarianceWeight[];
  readonly deploymentTicket: FableDeploymentTicketView;
  readonly latestValidation: FableFourGateValidationReport | null;
  readonly validationHistory: readonly FableFourGateValidationReport[];
  readonly latestRiskDecision: FablePreTradeRiskDecision;
  readonly latestOptionValuation: BlackScholesValuation;
  readonly ivSurface: readonly IvSurfacePoint[];
  readonly strategicMemory: readonly FableStrategicMemoryEntry[];
  readonly pythonModules: readonly {
    readonly id: string;
    readonly relativePath: string;
    readonly layerSummary: string;
  }[];
}

interface FableApiResponse {
  readonly ok: boolean;
  readonly error?: string;
  readonly snapshot?: FableSnapshotPayload;
  readonly report?: FableFourGateValidationReport;
  readonly decision?: FablePreTradeRiskDecision;
  readonly valuation?: BlackScholesValuation;
}

interface PythonSourceResponse {
  readonly ok: boolean;
  readonly moduleId: string;
  readonly relativePath: string;
  readonly content?: string;
  readonly error?: string;
}

type FableTab = 'PIPELINE' | 'RISK_PARITY' | 'BLACK_SCHOLES' | 'MEMORY' | 'PYTHON_CODE';

const WIDGET_LAYOUT: WidgetLayoutContract = {
  widgetId: 'fable-52-orchestrator',
  ariaLabel: 'Fable 5.2 Multi-Agent 8-Layer Self-Improving Trading Orchestrator',
  colSpanDesktop: 12,
  elevation: 'SURFACE',
  gpuContain: true,
  showStreamRail: true,
};

const TAB_OPTIONS: readonly SegmentedOption<FableTab>[] = [
  { value: 'PIPELINE', label: '8-Layer & Phase 5', testId: 'fable-tab-pipeline' },
  { value: 'RISK_PARITY', label: 'Half-Kelly & Risk Parity', testId: 'fable-tab-risk' },
  { value: 'BLACK_SCHOLES', label: 'Black-Scholes & Greeks', testId: 'fable-tab-options' },
  { value: 'MEMORY', label: 'Strategic Memory', testId: 'fable-tab-memory' },
  { value: 'PYTHON_CODE', label: 'Python Codebase', testId: 'fable-tab-python' },
];

export const FableOrchestratorPanel = memo(function FableOrchestratorPanel() {
  const [activeTab, setActiveTab] = useState<FableTab>('PIPELINE');
  const [snapshot, setSnapshot] = useState<FableSnapshotPayload | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ readonly tone: 'info' | 'success' | 'error'; readonly text: string } | null>(null);

  // Phase 5 single-parameter evolution controls
  const [mutateParam, setMutateParam] = useState<keyof FableStrategyParams>('stopAtrMult');
  const [mutateValue, setMutateValue] = useState<string>('1.25');
  const [evolveRegime, setEvolveRegime] = useState<FableVolatilityRegime>('QUIET');

  // Layer 6 Risk Parity & Half-Kelly simulator inputs
  const [riskFamily, setRiskFamily] = useState<FableStrategyFamily>('MOMENTUM');
  const [riskRegime, setRiskRegime] = useState<FableVolatilityRegime>('HIGH_VOLATILITY');
  const [riskSharpe, setRiskSharpe] = useState<string>('1.92');
  const [riskSpreadBps, setRiskSpreadBps] = useState<string>('1.2'); // 1.2 bps = 0.012% (< 0.02% cap)
  const [riskMaxCorr, setRiskMaxCorr] = useState<string>('0.28');
  const [riskDailyLossPct, setRiskDailyLossPct] = useState<string>('0.8');

  // Layer 4 Black-Scholes Option Pricer inputs
  const [optType, setOptType] = useState<FableOptionType>('PUT');
  const [optSpot, setOptSpot] = useState<string>('91400');
  const [optStrike, setOptStrike] = useState<string>('91400');
  const [optDays, setOptDays] = useState<string>('30');
  const [optVolPct, setOptVolPct] = useState<string>('46');
  const [optMarketOverride, setOptMarketOverride] = useState<string>('');

  // Python source viewer state
  const [selectedPyModule, setSelectedPyModule] = useState<string>('main_orchestrator');
  const [pySourceCode, setPySourceCode] = useState<string>('');
  const [copiedPy, setCopiedPy] = useState<boolean>(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/fable/status');
      if (!res.ok) return;
      const data = (await res.json()) as FableApiResponse;
      if (data.ok && data.snapshot) {
        setSnapshot(data.snapshot);
      }
    } catch {
      // ignore transient network errors on mount
    }
  }, []);

  const loadPythonModule = useCallback(async (moduleId: string) => {
    setSelectedPyModule(moduleId);
    setCopiedPy(false);
    try {
      const res = await fetch(`/api/fable/python-source?file=${encodeURIComponent(moduleId)}`);
      const data = (await res.json()) as PythonSourceResponse;
      if (data.ok && typeof data.content === 'string') {
        setPySourceCode(data.content);
      } else {
        setPySourceCode(data.error ?? '# Failed to load Python module source.');
      }
    } catch {
      setPySourceCode('# Network error loading Python module source.');
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadPythonModule('main_orchestrator');
  }, [loadStatus, loadPythonModule]);

  const handleRunEvolution = useCallback(async () => {
    const numericVal = Number(mutateValue);
    if (!Number.isFinite(numericVal) || numericVal <= 0) {
      setNotice({ tone: 'error', text: 'Enter a valid positive numeric parameter value.' });
      return;
    }
    setBusyAction('evolve');
    setNotice(null);
    try {
      const res = await apiFetch('/api/fable/evolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parameterToMutate: mutateParam,
          newValue: numericVal,
          regime: evolveRegime,
        }),
      });
      const data = (await res.json()) as FableApiResponse;
      if (data.snapshot) setSnapshot(data.snapshot);
      if (data.ok && data.report) {
        setNotice({
          tone: data.report.promotedV2OverV1 ? 'success' : 'info',
          text: data.report.promotedV2OverV1
            ? `Phase 5 PROMOTED ${data.report.candidateVersionId} over ${data.report.incumbentVersionId} (OOS Sharpe ${data.report.v2Oos.sharpeRatio.toFixed(3)}, Max DD ${(data.report.v2Oos.maxDrawdownPct * 100).toFixed(2)}%).`
            : `Phase 5 RETAINED ${data.report.incumbentVersionId}: ${data.report.reasons[0] ?? 'Candidate did not beat incumbent on both OOS Sharpe and Max Drawdown.'}`,
        });
      } else {
        setNotice({ tone: 'error', text: data.error ?? 'Phase 5 evolution cycle failed.' });
      }
    } catch {
      setNotice({ tone: 'error', text: 'Network error running Phase 5 evolution cycle.' });
    } finally {
      setBusyAction(null);
    }
  }, [evolveRegime, mutateParam, mutateValue]);

  const handleEvaluateRisk = useCallback(async () => {
    const sharpe = Number(riskSharpe);
    const spreadBps = Number(riskSpreadBps);
    const corr = Number(riskMaxCorr);
    const dailyLoss = Number(riskDailyLossPct);
    const mid = 91_400;
    const halfSpread = (mid * (spreadBps / 10_000)) / 2;
    const startEq = 100_000;
    const curEq = Math.max(1000, startEq * (1 - dailyLoss / 100));

    setBusyAction('risk');
    setNotice(null);
    try {
      const res = await apiFetch('/api/fable/risk/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          side: 'BUY',
          bid: mid - halfSpread,
          ask: mid + halfSpread,
          atr: riskRegime === 'HIGH_VOLATILITY' ? 1420 : 680,
          regime: riskRegime,
          currentEquityUsd: curEq,
          startOfDayEquityUsd: startEq,
          highWaterMarkEquityUsd: startEq,
          family: riskFamily,
          sharpeOverride: Number.isFinite(sharpe) ? sharpe : undefined,
          activeCorrelations: [Number.isFinite(corr) ? corr : 0.2],
        }),
      });
      const data = (await res.json()) as FableApiResponse;
      if (data.snapshot) setSnapshot(data.snapshot);
      if (data.ok && data.decision) {
        setNotice({
          tone: data.decision.approved ? 'success' : 'error',
          text: data.decision.approved
            ? `Layer 6 APPROVED via ${data.decision.sizingMode} (${data.decision.trailingStopAtrMult}x ATR stop, notional $${data.decision.positionNotionalUsd.toLocaleString()}).`
            : `Layer 6 BLOCKED: ${data.decision.rejectionReasons.join(' | ')}`,
        });
      }
    } catch {
      setNotice({ tone: 'error', text: 'Network error evaluating Layer 6 risk controls.' });
    } finally {
      setBusyAction(null);
    }
  }, [riskDailyLossPct, riskFamily, riskMaxCorr, riskRegime, riskSharpe, riskSpreadBps]);

  const handlePriceOption = useCallback(async () => {
    const spot = Number(optSpot) || 91_400;
    const strike = Number(optStrike) || spot;
    const days = Math.max(1, Number(optDays) || 30);
    const vol = Math.max(0.05, (Number(optVolPct) || 46) / 100);
    const mkt = optMarketOverride.trim() ? Number(optMarketOverride) : undefined;

    setBusyAction('options');
    setNotice(null);
    try {
      const res = await apiFetch('/api/fable/options/price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: `BTC-${days}D-${Math.round(strike)}${optType === 'CALL' ? 'C' : 'P'}`,
          optionType: optType,
          spotPrice: spot,
          strikePrice: strike,
          timeToExpiryYears: days / 365,
          riskFreeRate: 0.045,
          volatility: vol,
          marketPrice: typeof mkt === 'number' && Number.isFinite(mkt) && mkt > 0 ? mkt : undefined,
        }),
      });
      const data = (await res.json()) as FableApiResponse;
      if (data.snapshot) setSnapshot(data.snapshot);
      if (data.ok && data.valuation) {
        setNotice({
          tone: data.valuation.verdict === 'REJECT_MISPRICED' ? 'error' : 'success',
          text: `Black-Scholes ${data.valuation.symbol}: Fair $${data.valuation.theoreticalPrice.toFixed(2)}, IV ${(data.valuation.impliedVolatility * 100).toFixed(1)}%, Δ ${data.valuation.delta.toFixed(3)}, Verdict ${data.valuation.verdict}.`,
        });
      }
    } catch {
      setNotice({ tone: 'error', text: 'Network error running Black-Scholes valuation.' });
    } finally {
      setBusyAction(null);
    }
  }, [optDays, optMarketOverride, optSpot, optStrike, optType, optVolPct]);

  const handleCopyPython = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(pySourceCode);
      setCopiedPy(true);
      window.setTimeout(() => setCopiedPy(false), 1800);
    } catch {
      setCopiedPy(false);
    }
  }, [pySourceCode]);

  const metadata: readonly WidgetMetadataSegment[] = useMemo(
    () => [
      { id: 'fable', label: 'Fable 5.2 Lead Orchestrator' },
      {
        id: 'ver',
        label: 'Active',
        value: snapshot?.activeVersion.versionId ?? 'momentum-v1',
        tone: 'INFO',
      },
      {
        id: 'stage',
        label: 'Layer 7',
        value: snapshot?.deploymentTicket.stage ?? 'PAPER_TRADING',
        tone: snapshot?.deploymentTicket.stage === 'LIVE_APPROVED' ? 'NOMINAL' : 'WARNING',
      },
      {
        id: 'spread',
        label: 'Spread Cap',
        value: '≤0.02%',
        tone: 'NOMINAL',
      },
    ],
    [snapshot?.activeVersion.versionId, snapshot?.deploymentTicket.stage]
  );

  const metricItems: readonly WidgetMetricItem[] = useMemo(() => {
    const risk = snapshot?.latestRiskDecision;
    const bs = snapshot?.latestOptionValuation;
    return [
      {
        id: 'sizing-mode',
        label: 'Position Sizing Engine',
        value: risk?.sizingMode === 'DYNAMIC_HALF_KELLY' ? 'Half-Kelly Active' : 'Static Fallback',
        subtext: `Risk ${((risk?.riskFractionOfEquity ?? 0.0075) * 100).toFixed(2)}% · Sharpe > 1.5 gate`,
        tone: risk?.sizingMode === 'DYNAMIC_HALF_KELLY' ? 'NOMINAL' : 'INFO',
      },
      {
        id: 'atr-stop',
        label: 'Regime-Adaptive Stop',
        value: `${(risk?.trailingStopAtrMult ?? 1.5).toFixed(1)}x ATR`,
        subtext: `High-Vol 2.5x · Quiet 1.5x`,
        tone: 'INFO',
      },
      {
        id: 'bs-verdict',
        label: 'Black-Scholes Option Audit',
        value: bs ? `$${bs.theoreticalPrice.toFixed(2)}` : '--',
        subtext: bs
          ? `Δ ${bs.delta.toFixed(3)} · IV ${(bs.impliedVolatility * 100).toFixed(1)}% · ${bs.verdict}`
          : 'Loading Greeks...',
        tone: bs?.verdict === 'REJECT_MISPRICED' ? 'CRITICAL' : 'NOMINAL',
      },
      {
        id: 'memory-count',
        label: 'Strategic Memory DB',
        value: `${snapshot?.strategicMemory.length ?? 0} Records`,
        subtext: 'Zero look-ahead provenance',
        tone: 'NOMINAL',
      },
    ];
  }, [snapshot]);

  return (
    <ForgeWidgetFrame
      layout={WIDGET_LAYOUT}
      title="Fable 5.2 · 8-Layer Self-Improving Trading Orchestrator"
      icon={<Layers className="h-5 w-5 text-cyan-400 shrink-0" aria-hidden="true" />}
      metadata={metadata}
      testId="fable-52-orchestrator-panel"
      actions={
        <ForgeSegmentedControl
          ariaLabel="Fable 5.2 Architectural Views"
          layoutGroupId="fable-52-tabs"
          options={TAB_OPTIONS}
          value={activeTab}
          onChange={setActiveTab}
        />
      }
    >
      <div className="space-y-5">
        <ForgeMetricStrip items={metricItems} columns={4} />

        {notice && (
          <div
            role="status"
            data-testid="fable-status-notice"
            className={`rounded-lg border px-4 py-2.5 text-xs font-medium ${
              notice.tone === 'error'
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                : notice.tone === 'success'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
            }`}
          >
            {notice.text}
          </div>
        )}

        {/* TAB 1: 8-Layer Architecture, Phase 5 Single-Param Evolution & Layer 7 Human Approval */}
        {activeTab === 'PIPELINE' && snapshot && (
          <div className="space-y-5">
            {/* 8-Layer Blueprint Grid */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {snapshot.layers.map((layer) => (
                <div
                  key={layer.layerNumber}
                  className="rounded-lg border border-slate-800 bg-[#050914] p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                    <span className="text-cyan-400 font-bold">LAYER {layer.layerNumber}</span>
                    <span
                      className={
                        layer.status === 'GATED_HUMAN_APPROVAL'
                          ? 'text-amber-300'
                          : 'text-emerald-400'
                      }
                    >
                      {layer.status === 'GATED_HUMAN_APPROVAL' ? 'HUMAN GATE' : layer.status}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-white leading-snug">{layer.name}</div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">{layer.detail}</p>
                  <div className="font-mono text-[10px] text-slate-500 truncate">
                    {layer.modulePath}
                  </div>
                </div>
              ))}
            </div>

            {/* Phase 5 Self-Improvement Runner + Layer 7 Human Approval Gate */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="lg:col-span-7 rounded-lg border border-slate-800 bg-[#050914] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <GitBranch className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                    <span>Phase 5 Self-Improvement Loop (Strictly 1 Parameter / Cycle)</span>
                  </div>
                  <span className="font-mono text-[11px] text-slate-400">
                    Incumbent: {snapshot.activeVersion.versionId}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <label className="space-y-1 text-[11px] text-slate-400">
                    <span>Single Mutated Parameter</span>
                    <select
                      value={mutateParam}
                      onChange={(e) => setMutateParam(e.target.value as keyof FableStrategyParams)}
                      data-testid="fable-mutate-param-select"
                      className="w-full rounded-md border border-slate-700 bg-[#0a1020] px-2.5 py-1.5 text-xs font-mono text-white focus:border-cyan-400 focus:outline-none"
                    >
                      <option value="stopAtrMult">stopAtrMult (current: {snapshot.activeVersion.params.stopAtrMult})</option>
                      <option value="lookback">lookback (current: {snapshot.activeVersion.params.lookback})</option>
                      <option value="entryZscore">entryZscore (current: {snapshot.activeVersion.params.entryZscore})</option>
                    </select>
                  </label>

                  <label className="space-y-1 text-[11px] text-slate-400">
                    <span>Candidate V2 Value</span>
                    <input
                      type="number"
                      step="0.05"
                      value={mutateValue}
                      onChange={(e) => setMutateValue(e.target.value)}
                      data-testid="fable-mutate-value-input"
                      className="w-full rounded-md border border-slate-700 bg-[#0a1020] px-2.5 py-1.5 text-xs font-mono text-white focus:border-cyan-400 focus:outline-none tabular-nums"
                    />
                  </label>

                  <label className="space-y-1 text-[11px] text-slate-400">
                    <span>OOS Regime Slice</span>
                    <select
                      value={evolveRegime}
                      onChange={(e) => setEvolveRegime(e.target.value as FableVolatilityRegime)}
                      className="w-full rounded-md border border-slate-700 bg-[#0a1020] px-2.5 py-1.5 text-xs font-mono text-white focus:border-cyan-400 focus:outline-none"
                    >
                      <option value="QUIET">Quiet Regime (1.5x ATR)</option>
                      <option value="HIGH_VOLATILITY">High Volatility (2.5x ATR)</option>
                    </select>
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] text-slate-400">
                    V2 displaces V1 ONLY IF V2 OOS Sharpe &gt; V1 AND V2 OOS Max DD &lt; V1.
                  </span>
                  <ForgeInteractiveButton
                    label={busyAction === 'evolve' ? 'Validating 4 Gates...' : 'Run Phase 5 Cycle'}
                    icon={<Play className="h-3.5 w-3.5" />}
                    intent="primary"
                    disabled={busyAction !== null}
                    onClick={() => void handleRunEvolution()}
                    testId="fable-run-evolution-btn"
                  />
                </div>

                {snapshot.latestValidation && (
                  <div
                    data-testid="fable-latest-validation-card"
                    className="rounded-md border border-slate-800 bg-[#080f1f] p-3 space-y-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                      <span
                        className={
                          snapshot.latestValidation.promotedV2OverV1
                            ? 'text-emerald-400 font-bold'
                            : 'text-amber-300 font-bold'
                        }
                      >
                        {snapshot.latestValidation.promotedV2OverV1 ? 'V2 PROMOTED' : 'V1 RETAINED'}
                      </span>
                      <span className="text-slate-400">
                        Mutated: {snapshot.latestValidation.mutatedParameters.join(', ')} · WFA{' '}
                        {snapshot.latestValidation.wfaEfficiencyRatio.toFixed(2)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 font-mono text-[11px] tabular-nums">
                      <div className="rounded border border-slate-800 bg-[#050914] p-2">
                        <div className="text-slate-400">
                          V1 ({snapshot.latestValidation.incumbentVersionId}) Identical OOS
                        </div>
                        <div className="text-white mt-0.5">
                          Sharpe {snapshot.latestValidation.v1Oos.sharpeRatio.toFixed(3)} · DD{' '}
                          {(snapshot.latestValidation.v1Oos.maxDrawdownPct * 100).toFixed(2)}%
                        </div>
                      </div>
                      <div className="rounded border border-slate-800 bg-[#050914] p-2">
                        <div className="text-cyan-300">
                          V2 ({snapshot.latestValidation.candidateVersionId}) Identical OOS
                        </div>
                        <div className="text-white mt-0.5">
                          Sharpe {snapshot.latestValidation.v2Oos.sharpeRatio.toFixed(3)} · DD{' '}
                          {(snapshot.latestValidation.v2Oos.maxDrawdownPct * 100).toFixed(2)}%
                        </div>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-300">
                      {snapshot.latestValidation.reasons[0]}
                    </div>
                  </div>
                )}
              </div>

              {/* Layer 7 Paper-to-Live Mandatory Human Approval */}
              <div className="lg:col-span-5 rounded-lg border border-slate-800 bg-[#050914] p-4 flex flex-col justify-between gap-4">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-white">
                      <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                      <span>Layer 7 · Paper-to-Live Human Gate</span>
                    </div>
                    <span
                      data-testid="fable-deployment-stage"
                      className={`font-mono text-[11px] font-bold ${
                        snapshot.deploymentTicket.stage === 'LIVE_APPROVED'
                          ? 'text-emerald-400'
                          : 'text-amber-300'
                      }`}
                    >
                      {snapshot.deploymentTicket.stage}
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    Every validated version stages in Paper Trading first. Live approval is disabled in this research release; a separate independently reviewed approval system is required.
                  </p>

                  <div className="rounded-md border border-slate-800 bg-[#080f1f] p-3 space-y-1 font-mono text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Staged Version</span>
                      <span className="text-white">{snapshot.deploymentTicket.versionId}</span>
                    </div>
                    <div className="flex justify-between"><span className="text-slate-400">Live approval</span><span className="text-amber-300">LOCKED</span></div>
                    {snapshot.deploymentTicket.approvedBy && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Approved By</span>
                        <span className="text-emerald-400">
                          {snapshot.deploymentTicket.approvedBy}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <p data-testid="fable-approve-live-btn" role="status" className="text-xs text-amber-300">Live deployment locked — Paper Trading only.</p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Layer 6 Prop Firm Risk Controls, Dynamic Half-Kelly & Inverse Variance Allocation */}
        {activeTab === 'RISK_PARITY' && snapshot && (
          <div data-testid="fable-risk-parity-panel" className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Interactive Pre-Trade Prop Risk Evaluator */}
            <div className="lg:col-span-7 rounded-lg border border-slate-800 bg-[#050914] p-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <ShieldAlert className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                  <span>Layer 6 · Prop Firm Risk Gate &amp; Half-Kelly Evaluator</span>
                </div>
                <span className="font-mono text-[11px] text-slate-400">
                  Daily ≤4.0% · Max DD ≤8.0% · Spread ≤0.02%
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <label className="space-y-1 text-[11px] text-slate-400">
                  <span>Strategy Family</span>
                  <select
                    value={riskFamily}
                    onChange={(e) => setRiskFamily(e.target.value as FableStrategyFamily)}
                    className="w-full rounded-md border border-slate-700 bg-[#0a1020] px-2.5 py-1.5 text-xs font-mono text-white"
                  >
                    <option value="MOMENTUM">Momentum</option>
                    <option value="MEAN_REVERSION">Mean Reversion</option>
                    <option value="BREAKOUT">Breakout</option>
                  </select>
                </label>

                <label className="space-y-1 text-[11px] text-slate-400">
                  <span>Volatility Regime</span>
                  <select
                    value={riskRegime}
                    onChange={(e) => setRiskRegime(e.target.value as FableVolatilityRegime)}
                    data-testid="fable-risk-regime-select"
                    className="w-full rounded-md border border-slate-700 bg-[#0a1020] px-2.5 py-1.5 text-xs font-mono text-white"
                  >
                    <option value="HIGH_VOLATILITY">HIGH_VOLATILITY (2.5x ATR)</option>
                    <option value="QUIET">QUIET (1.5x ATR)</option>
                  </select>
                </label>

                <label className="space-y-1 text-[11px] text-slate-400">
                  <span>OOS Sharpe (Half-Kelly &gt; 1.5)</span>
                  <input
                    type="number"
                    step="0.1"
                    value={riskSharpe}
                    onChange={(e) => setRiskSharpe(e.target.value)}
                    data-testid="fable-risk-sharpe-input"
                    className="w-full rounded-md border border-slate-700 bg-[#0a1020] px-2.5 py-1.5 text-xs font-mono text-white tabular-nums"
                  />
                </label>

                <label className="space-y-1 text-[11px] text-slate-400">
                  <span>Bid-Ask Spread (bps · cap 2.0)</span>
                  <input
                    type="number"
                    step="0.2"
                    value={riskSpreadBps}
                    onChange={(e) => setRiskSpreadBps(e.target.value)}
                    data-testid="fable-risk-spread-input"
                    className="w-full rounded-md border border-slate-700 bg-[#0a1020] px-2.5 py-1.5 text-xs font-mono text-white tabular-nums"
                  />
                </label>

                <label className="space-y-1 text-[11px] text-slate-400">
                  <span>Max Pairwise |ρ| (cap 0.70)</span>
                  <input
                    type="number"
                    step="0.05"
                    value={riskMaxCorr}
                    onChange={(e) => setRiskMaxCorr(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-[#0a1020] px-2.5 py-1.5 text-xs font-mono text-white tabular-nums"
                  />
                </label>

                <label className="space-y-1 text-[11px] text-slate-400">
                  <span>Daily Loss % (cap 4.0%)</span>
                  <input
                    type="number"
                    step="0.5"
                    value={riskDailyLossPct}
                    onChange={(e) => setRiskDailyLossPct(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-[#0a1020] px-2.5 py-1.5 text-xs font-mono text-white tabular-nums"
                  />
                </label>
              </div>

              <div className="flex justify-end">
                <ForgeInteractiveButton
                  label={busyAction === 'risk' ? 'Evaluating...' : 'Evaluate Pre-Trade Gate'}
                  icon={<Activity className="h-3.5 w-3.5" />}
                  intent="primary"
                  disabled={busyAction !== null}
                  onClick={() => void handleEvaluateRisk()}
                  testId="fable-evaluate-risk-btn"
                />
              </div>

              <div
                data-testid="fable-risk-verdict-box"
                className={`rounded-md border p-3.5 space-y-2 font-mono text-xs tabular-nums ${
                  snapshot.latestRiskDecision.approved
                    ? 'border-emerald-500/40 bg-emerald-500/10'
                    : 'border-rose-500/40 bg-rose-500/10'
                }`}
              >
                <div className="flex items-center justify-between font-bold">
                  <span
                    className={
                      snapshot.latestRiskDecision.approved ? 'text-emerald-300' : 'text-rose-300'
                    }
                  >
                    {snapshot.latestRiskDecision.approved ? 'ENTRY APPROVED' : 'ENTRY REJECTED'}
                  </span>
                  <span className="text-cyan-300">{snapshot.latestRiskDecision.sizingMode}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-200 sm:grid-cols-4">
                  <div>Notional: ${snapshot.latestRiskDecision.positionNotionalUsd.toLocaleString()}</div>
                  <div>ATR Stop: {snapshot.latestRiskDecision.trailingStopAtrMult}x</div>
                  <div>Spread: {(snapshot.latestRiskDecision.bidAskSpreadPct * 100).toFixed(4)}%</div>
                  <div>Weight: {(snapshot.latestRiskDecision.familyWeightFraction * 100).toFixed(1)}%</div>
                </div>
                {snapshot.latestRiskDecision.rejectionReasons.length > 0 && (
                  <div className="text-[11px] text-rose-200">
                    {snapshot.latestRiskDecision.rejectionReasons.join(' · ')}
                  </div>
                )}
              </div>
            </div>

            {/* Inverse Variance Risk Parity Across 3 Non-Correlated Strategy Families */}
            <div className="lg:col-span-5 rounded-lg border border-slate-800 bg-[#050914] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-white">
                  Inverse Variance Risk Parity (3 Families)
                </h3>
                <span className="font-mono text-[11px] text-cyan-400">wᵢ ∝ 1 / σᵢ²</span>
              </div>
              <p className="text-xs text-slate-400">
                Capital diversifies automatically across Breakout, Mean Reversion, and Momentum inversely to return variance to dampen portfolio-level drawdowns.
              </p>

              <div className="space-y-3 pt-1">
                {snapshot.inverseVarianceWeights.map((item) => (
                  <div key={item.family} className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                      <span className="text-white font-semibold">{item.label}</span>
                      <span className="text-cyan-300">
                        {item.weightPct.toFixed(1)}% · σ {(item.annualizedVolatility * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-cyan-500 rounded-full"
                        style={{ width: `${Math.min(100, item.weightPct)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: Hard-Coded Black-Scholes Option Pricer, Greeks & IV Surface */}
        {activeTab === 'BLACK_SCHOLES' && snapshot && (
          <div data-testid="fable-black-scholes-panel" className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-5 rounded-lg border border-slate-800 bg-[#050914] p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <Sigma className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                <span>Hard-Coded Black-Scholes Option Validator</span>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <label className="space-y-1 text-[11px] text-slate-400">
                  <span>Option Type</span>
                  <select
                    value={optType}
                    onChange={(e) => setOptType(e.target.value as FableOptionType)}
                    className="w-full rounded-md border border-slate-700 bg-[#0a1020] px-2.5 py-1.5 text-xs font-mono text-white"
                  >
                    <option value="PUT">European PUT (Tail Hedge)</option>
                    <option value="CALL">European CALL</option>
                  </select>
                </label>

                <label className="space-y-1 text-[11px] text-slate-400">
                  <span>Expiry (Days)</span>
                  <input
                    type="number"
                    value={optDays}
                    onChange={(e) => setOptDays(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-[#0a1020] px-2.5 py-1.5 text-xs font-mono text-white tabular-nums"
                  />
                </label>

                <label className="space-y-1 text-[11px] text-slate-400">
                  <span>Spot Price ($)</span>
                  <input
                    type="number"
                    value={optSpot}
                    onChange={(e) => setOptSpot(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-[#0a1020] px-2.5 py-1.5 text-xs font-mono text-white tabular-nums"
                  />
                </label>

                <label className="space-y-1 text-[11px] text-slate-400">
                  <span>Strike Price ($)</span>
                  <input
                    type="number"
                    value={optStrike}
                    onChange={(e) => setOptStrike(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-[#0a1020] px-2.5 py-1.5 text-xs font-mono text-white tabular-nums"
                  />
                </label>

                <label className="space-y-1 text-[11px] text-slate-400">
                  <span>Volatility σ (%)</span>
                  <input
                    type="number"
                    value={optVolPct}
                    onChange={(e) => setOptVolPct(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-[#0a1020] px-2.5 py-1.5 text-xs font-mono text-white tabular-nums"
                  />
                </label>

                <label className="space-y-1 text-[11px] text-slate-400">
                  <span>Market Price Override ($)</span>
                  <input
                    type="number"
                    placeholder="Optional misprice test"
                    value={optMarketOverride}
                    onChange={(e) => setOptMarketOverride(e.target.value)}
                    data-testid="fable-bs-market-input"
                    className="w-full rounded-md border border-slate-700 bg-[#0a1020] px-2.5 py-1.5 text-xs font-mono text-white tabular-nums"
                  />
                </label>
              </div>

              <ForgeInteractiveButton
                label={busyAction === 'options' ? 'Pricing...' : 'Compute Black-Scholes & Greeks'}
                icon={<Sigma className="h-3.5 w-3.5" />}
                intent="primary"
                disabled={busyAction !== null}
                onClick={() => void handlePriceOption()}
                testId="fable-price-option-btn"
              />

              <div
                data-testid="fable-bs-result-card"
                className="rounded-md border border-slate-800 bg-[#080f1f] p-3 space-y-2 font-mono text-[11px] tabular-nums"
              >
                <div className="flex items-center justify-between">
                  <span className="text-white font-bold">
                    {snapshot.latestOptionValuation.symbol}
                  </span>
                  <span
                    className={
                      snapshot.latestOptionValuation.verdict === 'REJECT_MISPRICED'
                        ? 'text-rose-400 font-bold'
                        : snapshot.latestOptionValuation.verdict === 'CAUTION_TAIL_RISK'
                        ? 'text-amber-300 font-bold'
                        : 'text-emerald-400 font-bold'
                    }
                  >
                    {snapshot.latestOptionValuation.verdict}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-slate-300">
                  <div>Fair Value: ${snapshot.latestOptionValuation.theoreticalPrice.toFixed(2)}</div>
                  <div>Implied Vol: {(snapshot.latestOptionValuation.impliedVolatility * 100).toFixed(2)}%</div>
                  <div>Delta (Δ): {snapshot.latestOptionValuation.delta.toFixed(4)}</div>
                  <div>Gamma (Γ): {snapshot.latestOptionValuation.gamma.toFixed(6)}</div>
                  <div>Theta (Θ/d): ${snapshot.latestOptionValuation.thetaPerDay.toFixed(2)}</div>
                  <div>Mispricing: {(snapshot.latestOptionValuation.mispricingPct * 100).toFixed(2)}%</div>
                </div>
              </div>
            </div>

            {/* Implied Volatility Surface Table */}
            <div className="lg:col-span-7 rounded-lg border border-slate-800 bg-[#050914] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-white">
                  Implied Volatility Surface &amp; Analytical Greeks Matrix
                </h3>
                <span className="font-mono text-[11px] text-slate-400">
                  7D / 30D / 90D · 90%–110% Moneyness
                </span>
              </div>

              <div className="overflow-x-auto max-h-80">
                <table className="w-full text-left font-mono text-[11px] tabular-nums">
                  <thead className="border-b border-slate-800 text-slate-400">
                    <tr>
                      <th className="py-1.5 pr-3">Expiry</th>
                      <th className="py-1.5 pr-3">Strike</th>
                      <th className="py-1.5 pr-3">Type</th>
                      <th className="py-1.5 pr-3">IV</th>
                      <th className="py-1.5 pr-3">Fair $</th>
                      <th className="py-1.5 pr-3">Delta</th>
                      <th className="py-1.5 pr-3">Gamma</th>
                      <th className="py-1.5">Theta/d</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 text-slate-200">
                    {snapshot.ivSurface.map((pt) => (
                      <tr key={`${pt.expiryDays}_${pt.moneyness}`}>
                        <td className="py-1.5 pr-3 text-cyan-300">{pt.expiryDays}D</td>
                        <td className="py-1.5 pr-3">${pt.strikePrice.toLocaleString()}</td>
                        <td className="py-1.5 pr-3">{pt.optionType}</td>
                        <td className="py-1.5 pr-3 text-emerald-300">
                          {(pt.impliedVolatility * 100).toFixed(1)}%
                        </td>
                        <td className="py-1.5 pr-3">${pt.theoreticalPrice.toFixed(2)}</td>
                        <td className="py-1.5 pr-3">{pt.delta.toFixed(3)}</td>
                        <td className="py-1.5 pr-3">{pt.gamma.toFixed(6)}</td>
                        <td className="py-1.5 text-rose-300">${pt.thetaPerDay.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: Layer 8 Strategic Memory Provenance Log */}
        {activeTab === 'MEMORY' && snapshot && (
          <div data-testid="fable-strategic-memory-panel" className="rounded-lg border border-slate-800 bg-[#050914] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <Database className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                <span>Layer 8 · Persistent Strategic Memory Provenance Database</span>
              </div>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                {snapshot.strategicMemory.length} immutable records
              </span>
            </div>

            <div className="overflow-x-auto max-h-80">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 font-mono text-[11px] text-slate-400">
                  <tr>
                    <th className="py-1.5 pr-3">UTC Time</th>
                    <th className="py-1.5 pr-3">Layer</th>
                    <th className="py-1.5 pr-3">Event</th>
                    <th className="py-1.5 pr-3">Version</th>
                    <th className="py-1.5 pr-3">OOS Sharpe</th>
                    <th className="py-1.5">Provenance Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {snapshot.strategicMemory.map((rec) => (
                    <tr key={rec.id} className="align-top">
                      <td className="py-2 pr-3 font-mono text-[11px] text-slate-400 whitespace-nowrap tabular-nums">
                        {new Date(rec.recordedAtIso).toLocaleTimeString()}
                      </td>
                      <td className="py-2 pr-3 font-mono text-[11px] text-cyan-300 whitespace-nowrap">
                        {rec.layer}
                      </td>
                      <td className="py-2 pr-3 font-mono text-[11px] whitespace-nowrap">
                        <span
                          className={
                            rec.eventType === 'VERSION_PROMOTED' || rec.eventType === 'LIVE_APPROVED'
                              ? 'text-emerald-400 font-semibold'
                              : rec.eventType === 'V2_REJECTED'
                              ? 'text-amber-300 font-semibold'
                              : 'text-slate-300'
                          }
                        >
                          {rec.eventType}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono text-[11px] text-white whitespace-nowrap">
                        {rec.versionId}
                      </td>
                      <td className="py-2 pr-3 font-mono text-[11px] text-slate-200 tabular-nums whitespace-nowrap">
                        {rec.oosSharpe !== null ? rec.oosSharpe.toFixed(3) : '—'}
                      </td>
                      <td className="py-2 text-xs text-slate-300">{rec.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: Modular Python Production Codebase Viewer */}
        {activeTab === 'PYTHON_CODE' && snapshot && (
          <div data-testid="fable-python-codebase-panel" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {snapshot.pythonModules.map((mod) => (
                  <button
                    key={mod.id}
                    type="button"
                    data-testid={`fable-py-select-${mod.id}`}
                    onClick={() => void loadPythonModule(mod.id)}
                    className={`rounded-md border px-3 py-1.5 text-xs font-mono transition-colors cursor-pointer ${
                      selectedPyModule === mod.id
                        ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200 font-semibold'
                        : 'border-slate-800 bg-[#050914] text-slate-400 hover:text-white'
                    }`}
                  >
                    {mod.relativePath.replace(/^fable_5_2\//, '')}
                  </button>
                ))}
              </div>
              <ForgeInteractiveButton
                label={copiedPy ? 'Copied Source' : 'Copy Python File'}
                icon={copiedPy ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                intent="secondary"
                onClick={() => void handleCopyPython()}
              />
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#030712] overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-800 bg-[#081020] px-3 py-2 text-[11px] font-mono">
                <span className="text-cyan-300 flex items-center gap-1.5">
                  <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {snapshot.pythonModules.find((m) => m.id === selectedPyModule)?.relativePath ??
                      'fable_5_2/main_orchestrator.py'}
                  </span>
                </span>
                <span className="text-slate-400">
                  {snapshot.pythonModules.find((m) => m.id === selectedPyModule)?.layerSummary}
                </span>
              </div>
              <pre
                data-testid="fable-python-source-pre"
                className="max-h-96 overflow-auto p-3.5 text-[11px] leading-relaxed font-mono text-slate-200"
              >
                {pySourceCode || '# Loading Python source...'}
              </pre>
            </div>
          </div>
        )}
      </div>
    </ForgeWidgetFrame>
  );
});

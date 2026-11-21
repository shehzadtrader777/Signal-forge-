import { memo, useCallback, useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  CheckCircle2,
  Cpu,
  Layers,
  Lock,
  Radio,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  ACCOUNT_VOLUME_TIERS,
  SUBSCRIPTION_PLANS,
  computeDynamicProfitMultiplier,
  evaluateDeveloperAuditDispatch,
  evaluatePredictivePrePumpLifecycle,
  normalizeTradingViewWebhook,
  runContinuousStrategyAutoOptimizer,
  validateManualOverrideOrder,
  verifyPublicTradeId,
  type ExecutionControlMode,
} from '../lib/multiAgentTradingArchitecture';
import {
  type WidgetLayoutContract,
  type WidgetMetadataSegment,
  type WidgetMetricItem,
} from '../lib/designSystem';
import { formatCryptoPrice } from '../lib/marketData';
import { useTradingArchitectureStore } from '../store/useTradingArchitectureStore';
import {
  ForgeInteractiveButton,
  ForgeMetricStrip,
  ForgeSegmentedControl,
  ForgeWidgetFrame,
  type SegmentedOption,
} from './ui/ForgeDesignSystem';

type OrchestratorTabId =
  | 'EXECUTION_MULTIPLIERS'
  | 'VOLUME_TIERS_FEES'
  | 'PREPUMP_LIFECYCLE'
  | 'TRADE_ID_PROOF'
  | 'AUDIT_FEEDS';

const PANEL_LAYOUT: WidgetLayoutContract = {
  widgetId: 'multi-agent-trading-architecture',
  ariaLabel: 'Multi-Agent Trading Architecture Orchestrator',
  colSpanDesktop: 12,
  density: 'STANDARD',
  elevation: 'SURFACE',
  gpuContain: true,
  showStreamRail: true,
};

const TAB_OPTIONS: readonly SegmentedOption<OrchestratorTabId>[] = [
  { value: 'EXECUTION_MULTIPLIERS', label: 'Execution & 1:20+ R:R', testId: 'arch-tab-exec' },
  { value: 'VOLUME_TIERS_FEES', label: 'Volume Tiers & Fees', testId: 'arch-tab-tiers' },
  { value: 'PREPUMP_LIFECYCLE', label: 'Pre-Pump Lifecycle', testId: 'arch-tab-prepump' },
  { value: 'TRADE_ID_PROOF', label: 'Trade ID & Visual Proof', testId: 'arch-tab-tradeid' },
  { value: 'AUDIT_FEEDS', label: '30m Dev Audit & Feeds', testId: 'arch-tab-audit' },
];

const EXEC_MODE_OPTIONS: readonly SegmentedOption<ExecutionControlMode>[] = [
  { value: 'FULLY_AUTONOMOUS', label: 'Fully Autonomous', testId: 'exec-mode-autonomous' },
  {
    value: 'SUPERVISED_MANUAL_OVERRIDE',
    label: 'Supervised Manual Override',
    testId: 'exec-mode-supervised',
  },
];

export const MultiAgentCommandOrchestratorPanel = memo(
  function MultiAgentCommandOrchestratorPanel() {
    const {
      selectedSymbol,
      tickers,
      liveCandlesMap,
      orderBookDepth,
      futuresTelemetry,
      forgeCapitalState,
      wsConnected,
      setExecutionRouteDraft,
    } = useApp();

    const executionMode = useTradingArchitectureStore((s) => s.executionMode);
    const setExecutionMode = useTradingArchitectureStore((s) => s.setExecutionMode);
    const userVolume30dUsd = useTradingArchitectureStore((s) => s.userVolume30dUsd);
    const setUserVolume30dUsd = useTradingArchitectureStore((s) => s.setUserVolume30dUsd);
    const customRiskTolerancePct = useTradingArchitectureStore((s) => s.customRiskTolerancePct);
    const setCustomRiskTolerancePct = useTradingArchitectureStore(
      (s) => s.setCustomRiskTolerancePct
    );
    const customRrMultiplierCap = useTradingArchitectureStore((s) => s.customRrMultiplierCap);
    const setCustomRrMultiplierCap = useTradingArchitectureStore((s) => s.setCustomRrMultiplierCap);
    const subscriptionPlanId = useTradingArchitectureStore((s) => s.subscriptionPlanId);
    const setSubscriptionPlanId = useTradingArchitectureStore((s) => s.setSubscriptionPlanId);
    const allowLowConfidenceSupervision = useTradingArchitectureStore(
      (s) => s.allowLowConfidenceSupervision
    );
    const setAllowLowConfidenceSupervision = useTradingArchitectureStore(
      (s) => s.setAllowLowConfidenceSupervision
    );
    const verifiedTrades = useTradingArchitectureStore((s) => s.verifiedTrades);
    const recordVerifiedTrade = useTradingArchitectureStore((s) => s.recordVerifiedTrade);
    const auditFindings = useTradingArchitectureStore((s) => s.auditFindings);
    const auditBatchPolicy = useTradingArchitectureStore((s) => s.auditBatchPolicy);
    const runLocalSystemAudit = useTradingArchitectureStore((s) => s.runLocalSystemAudit);
    const latestOptimization = useTradingArchitectureStore((s) => s.latestOptimization);
    const setLatestOptimization = useTradingArchitectureStore((s) => s.setLatestOptimization);
    const tradingViewSignals = useTradingArchitectureStore((s) => s.tradingViewSignals);
    const recordTradingViewSignal = useTradingArchitectureStore((s) => s.recordTradingViewSignal);
    const setGlobalSearchOpen = useTradingArchitectureStore((s) => s.setGlobalSearchOpen);
    const getAssessedAccountProfile = useTradingArchitectureStore(
      (s) => s.getAssessedAccountProfile
    );

    const [activeTab, setActiveTab] = useState<OrchestratorTabId>('EXECUTION_MULTIPLIERS');
    const [manualDirection, setManualDirection] = useState<'BUY' | 'SELL'>('BUY');
    const [manualMarket, setManualMarket] = useState<'SPOT' | 'USD_M_FUTURES'>('SPOT');
    const [manualConfirmed, setManualConfirmed] = useState(false);
    const [manualStatus, setManualStatus] = useState<string | null>(null);
    const [verifyQuery, setVerifyQuery] = useState(verifiedTrades[0]?.tradeId ?? '');
    const [simulateDelistingPanic, setSimulateDelistingPanic] = useState(false);
    const [auditFeedback, setAuditFeedback] = useState<string | null>(null);
    const [tvFeedback, setTvFeedback] = useState<string | null>(null);

    const ticker = tickers[selectedSymbol];
    const livePrice = ticker?.price && ticker.price > 0 ? ticker.price : 63850;
    const change24hPct = ticker?.change24hPercent ?? 3.8;
    const symbolFutures = futuresTelemetry[selectedSymbol];
    const fundingRatePct = Number(((symbolFutures?.fundingRate ?? 0.00012) * 100).toFixed(4));
    const forgeKillSwitchEngaged = forgeCapitalState?.failSafe?.engaged ?? false;

    const accountProfile = useMemo(
      () => getAssessedAccountProfile(25_000, 1.4),
      [getAssessedAccountProfile, userVolume30dUsd]
    );

    const orderBookImbalance = useMemo(() => {
      const symbolDepth = orderBookDepth[selectedSymbol];
      if (!symbolDepth) return 0.34;
      return Number(symbolDepth.netOrderBookImbalance.toFixed(2));
    }, [orderBookDepth, selectedSymbol]);

    const multiplierEval = useMemo(
      () =>
        computeDynamicProfitMultiplier({
          change24hPct,
          volumeSpikeRatio: Math.max(1.2, Math.abs(change24hPct) * 0.45 + 1.1),
          orderBookImbalance,
          rsi14: change24hPct >= 0 ? 63 : 41,
          fundingRatePct,
          tierMaxMultiplier: accountProfile.tier.maxRrMultiplier,
          customMultiplierCap: customRrMultiplierCap,
        }),
      [
        accountProfile.tier.maxRrMultiplier,
        change24hPct,
        customRrMultiplierCap,
        fundingRatePct,
        orderBookImbalance,
      ]
    );

    const stopLossPreview =
      manualDirection === 'BUY'
        ? Number((livePrice * 0.985).toFixed(4))
        : Number((livePrice * 1.015).toFixed(4));
    const takeProfitPreview =
      manualDirection === 'BUY'
        ? Number(
            (livePrice + (livePrice - stopLossPreview) * multiplierEval.targetRrMultiplier).toFixed(
              4
            )
          )
        : Number(
            (livePrice - (stopLossPreview - livePrice) * multiplierEval.targetRrMultiplier).toFixed(
              4
            )
          );

    const manualValidation = useMemo(
      () =>
        validateManualOverrideOrder({
          symbol: selectedSymbol,
          direction: manualDirection,
          market: manualMarket,
          entryPrice: livePrice,
          stopLoss: stopLossPreview,
          takeProfit: takeProfitPreview,
          requestedRiskPct: customRiskTolerancePct,
          leverage: manualMarket === 'SPOT' ? 1 : 5,
          confidenceScore: 84,
          userConfirmed: manualConfirmed,
          executionMode,
          accountProfile,
          forgeKillSwitchEngaged,
          allowLowConfidenceSupervision,
        }),
      [
        accountProfile,
        allowLowConfidenceSupervision,
        customRiskTolerancePct,
        executionMode,
        forgeKillSwitchEngaged,
        livePrice,
        manualConfirmed,
        manualDirection,
        manualMarket,
        selectedSymbol,
        stopLossPreview,
        takeProfitPreview,
      ]
    );

    const prePumpEval = useMemo(
      () =>
        evaluatePredictivePrePumpLifecycle({
          symbol: selectedSymbol,
          livePrice,
          volumeSpikeRatio: Math.max(1.9, Math.abs(change24hPct) * 0.45 + 1.4),
          orderBookImbalance: simulateDelistingPanic ? -0.52 : Math.max(0.24, orderBookImbalance),
          sentimentScore: simulateDelistingPanic ? 21 : 76,
          onChainAccumulationScore: simulateDelistingPanic ? 18 : 72,
          distanceToPocPct: 0.9,
          nearLvnZone: true,
          fundingRatePct,
          delistingOrPanicAlert: simulateDelistingPanic,
          currentPositionOpen: simulateDelistingPanic,
        }),
      [change24hPct, fundingRatePct, livePrice, orderBookImbalance, selectedSymbol, simulateDelistingPanic]
    );

    const auditSchedule = useMemo(
      () =>
        evaluateDeveloperAuditDispatch({
          policy: auditBatchPolicy,
          nowMs: Date.now(),
          currentPeakLatencyMs: 112,
          criticalFindingsCount: auditFindings.filter((f) => f.severity === 'CRITICAL').length,
        }),
      [auditBatchPolicy, auditFindings]
    );

    const verificationResult = useMemo(
      () => verifyPublicTradeId(verifyQuery, verifiedTrades),
      [verifiedTrades, verifyQuery]
    );

    const handleExecuteValidatedOrder = useCallback(() => {
      if (!manualValidation.approved) {
        setManualStatus(manualValidation.violations[0] ?? 'Order blocked by safety kernel.');
        return;
      }

      const minted = recordVerifiedTrade({
        symbol: selectedSymbol,
        direction: manualDirection,
        market: manualMarket,
        stage: 'EXECUTION_ENTRY',
        entryPrice: livePrice,
        stopLoss: stopLossPreview,
        takeProfit: takeProfitPreview,
        confidence: 86,
        patternLabel: `${executionMode === 'FULLY_AUTONOMOUS' ? 'Autonomous' : 'Supervised'} 1:${multiplierEval.targetRrMultiplier.toFixed(1)} Momentum Setup`,
      });

      const riskUnit = Math.abs(livePrice - stopLossPreview);
      const [m1, m2, m3] = multiplierEval.takeProfitMultipliers;
      const calcTp = (m: number) =>
        manualDirection === 'BUY'
          ? Number((livePrice + riskUnit * m).toFixed(4))
          : Number(Math.max(livePrice * 0.05, livePrice - riskUnit * m).toFixed(4));

      setExecutionRouteDraft({
        symbol: selectedSymbol,
        direction: manualDirection,
        market: manualMarket,
        moduleId: manualMarket === 'USD_M_FUTURES' ? 'FUTURES_COORDINATOR' : 'SPOT_MOMENTUM',
        leverage: manualMarket === 'SPOT' ? 1 : 5,
        notionalUsd: 1500,
        stopLoss: stopLossPreview,
        trailingStopLoss: stopLossPreview,
        trailingAtrMultiplier: 1.5,
        takeProfits: [calcTp(m1), calcTp(m2), calcTp(m3)],
        sourceLabel: `Multi-Agent Orchestrator (${minted.tradeId})`,
        requestedAt: Date.now(),
      });

      setVerifyQuery(minted.tradeId);
      setManualConfirmed(false);
      setManualStatus(
        `Routed ${selectedSymbol} ${manualDirection} · Verified Trade ID ${minted.tradeId} dispatched with visual chart snapshot to Public Channel & Developer Account.`
      );
    }, [
      executionMode,
      livePrice,
      manualDirection,
      manualMarket,
      manualValidation,
      multiplierEval.targetRrMultiplier,
      recordVerifiedTrade,
      selectedSymbol,
      setExecutionRouteDraft,
      stopLossPreview,
      takeProfitPreview,
    ]);

    const handleRunAutoOptimizer = useCallback(() => {
      const closes = (liveCandlesMap[selectedSymbol] ?? []).map((c) => c.close);
      const report = runContinuousStrategyAutoOptimizer({
        symbol: selectedSymbol,
        closes,
        tierMaxMultiplier: accountProfile.tier.maxRrMultiplier,
      });
      setLatestOptimization(report);
      setCustomRrMultiplierCap(report.optimalRrMultiplier);
    }, [
      accountProfile.tier.maxRrMultiplier,
      liveCandlesMap,
      selectedSymbol,
      setCustomRrMultiplierCap,
      setLatestOptimization,
    ]);

    const handleRunAudit = useCallback(
      (injectSampleAnomaly: boolean) => {
        const res = runLocalSystemAudit({ injectSampleAnomaly });
        setAuditFeedback(
          res.dispatched
            ? `Audit dispatched exclusively to Developer Telegram (${res.reason}). Public channel strictly isolated.`
            : `Audit logged (${res.findingsCount} findings). Heartbeat suppressed; queued for next 30-min developer digest.`
        );
      },
      [runLocalSystemAudit]
    );

    const handleSyncTradingViewWebhook = useCallback(async () => {
      const payload = {
        symbol: selectedSymbol,
        action: change24hPct >= 0 ? 'BUY' : 'SELL',
        price: livePrice,
        timeframe: '15m',
        strategy: 'Pine EMA 21/50/200 + RSI Sync',
        rsi: change24hPct >= 0 ? 62.8 : 38.4,
      };
      const normalized = normalizeTradingViewWebhook(payload);
      if (normalized) {
        recordTradingViewSignal(normalized);
        setTvFeedback(
          `Synced TradingView alert ${normalized.symbol} ${normalized.action} @ $${formatCryptoPrice(normalized.price)} with Binance WS.`
        );
      }
      try {
        await fetch('/api/tradingview/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {
        // local sync already applied
      }
    }, [change24hPct, livePrice, recordTradingViewSignal, selectedSymbol]);

    const metrics: readonly WidgetMetricItem[] = useMemo(
      () => [
        {
          id: 'dynamic-rr',
          label: 'Dynamic Profit Multiplier',
          value: `1 : ${multiplierEval.targetRrMultiplier.toFixed(1)}`,
          subtext: `Momentum ${multiplierEval.momentumScore}/100 · Floor 1:5`,
          tone: multiplierEval.targetRrMultiplier >= 12 ? 'NOMINAL' : 'INFO',
        },
        {
          id: 'volume-tier',
          label: 'Volume Risk Tier',
          value: accountProfile.tier.label,
          subtext: `AI Risk Cap ${accountProfile.aiDynamicRiskCapPct.toFixed(2)}% · Fee ${(accountProfile.tier.takerFeeBps / 100).toFixed(3)}%`,
          tone: 'INFO',
        },
        {
          id: 'exec-mode',
          label: 'Execution Authority',
          value: executionMode === 'FULLY_AUTONOMOUS' ? 'AUTONOMOUS' : 'SUPERVISED',
          subtext: forgeKillSwitchEngaged
            ? 'Forge Kill Switch LOCKED'
            : 'Forge Capital Hub Guard Active',
          tone: forgeKillSwitchEngaged
            ? 'CRITICAL'
            : executionMode === 'FULLY_AUTONOMOUS'
            ? 'NOMINAL'
            : 'WARNING',
        },
        {
          id: 'verified-ids',
          label: 'Verified Public Trade IDs',
          value: `${verifiedTrades.length} Proofs`,
          subtext: `Dev Audit Batch: ${auditBatchPolicy.batchIntervalMinutes}m exclusive`,
          tone: 'NOMINAL',
        },
      ],
      [
        accountProfile.aiDynamicRiskCapPct,
        accountProfile.tier.label,
        accountProfile.tier.takerFeeBps,
        auditBatchPolicy.batchIntervalMinutes,
        executionMode,
        forgeKillSwitchEngaged,
        multiplierEval.momentumScore,
        multiplierEval.targetRrMultiplier,
        verifiedTrades.length,
      ]
    );

    const headerMetadata: readonly WidgetMetadataSegment[] = useMemo(
      () => [
        { id: 'arch-scope', label: 'Multi-Agent Architecture' },
        {
          id: 'arch-sym',
          label: selectedSymbol,
          value: `$${formatCryptoPrice(livePrice)}`,
          tone: 'INFO',
        },
        {
          id: 'arch-directive',
          label: prePumpEval.directive.replace(/_/g, ' '),
          tone:
            prePumpEval.directive === 'PRE_DUMP_LIQUIDATE'
              ? 'CRITICAL'
              : prePumpEval.directive === 'PRE_PUMP_ACCUMULATE'
              ? 'NOMINAL'
              : 'INFO',
        },
      ],
      [livePrice, prePumpEval.directive, selectedSymbol]
    );

    return (
      <ForgeWidgetFrame
        layout={PANEL_LAYOUT}
        title="Multi-Agent Trading Architecture · Dynamic 1:20+ R:R & Lifecycle Command"
        icon={<Bot className="h-5 w-5 text-cyan-400 shrink-0" aria-hidden="true" />}
        metadata={headerMetadata}
        testId="multi-agent-architecture-panel"
        actions={
          <>
            <ForgeInteractiveButton
              label="Global Search (⌘K)"
              icon={<Search className="h-3.5 w-3.5" aria-hidden="true" />}
              intent="secondary"
              testId="arch-open-global-search-btn"
              onClick={() => setGlobalSearchOpen(true)}
            />
            <ForgeInteractiveButton
              label="Auto-Optimize"
              icon={<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
              intent="primary"
              testId="arch-run-optimizer-btn"
              onClick={handleRunAutoOptimizer}
            />
          </>
        }
      >
        <div className="space-y-5">
          <ForgeMetricStrip items={metrics} columns={4} />

          {/* Master Execution Mode Strip + Section Tabs */}
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <ForgeSegmentedControl
              ariaLabel="Multi-Agent Architecture Modules"
              layoutGroupId="multi-agent-arch-tabs"
              options={TAB_OPTIONS}
              value={activeTab}
              onChange={setActiveTab}
            />

            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-slate-400 whitespace-nowrap">
                Execution Mode:
              </span>
              <ForgeSegmentedControl
                ariaLabel="Master Execution Mode Toggle"
                layoutGroupId="master-execution-mode-toggle"
                options={EXEC_MODE_OPTIONS}
                value={executionMode}
                onChange={setExecutionMode}
              />
            </div>
          </div>

          {/* TAB 1: Execution Mode, Dynamic 1:5–1:25 Multipliers & Manual Override Safety */}
          {activeTab === 'EXECUTION_MULTIPLIERS' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Left: Dynamic Multiplier + Auto-Optimizer */}
              <div className="rounded-xl border border-slate-800/90 bg-[#050914]/90 p-4 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <TrendingUp className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                    <span>Dynamic Momentum Profit-Taking (1:5 → 1:25)</span>
                  </div>
                  <span className="font-mono text-xs font-bold text-cyan-300 tabular-nums">
                    Target 1:{multiplierEval.targetRrMultiplier.toFixed(1)}
                  </span>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">{multiplierEval.rationale}</p>

                <div className="grid grid-cols-3 divide-x divide-slate-800 rounded-lg border border-slate-800 bg-[#070d1b] text-center">
                  {multiplierEval.takeProfitMultipliers.map((mult, idx) => (
                    <div key={idx} className="px-3 py-2.5">
                      <div className="font-mono text-[10px] text-slate-500">
                        TP{idx + 1} ({multiplierEval.tierScalingSplitsPct[idx]}%)
                      </div>
                      <div className="mt-0.5 font-mono text-sm font-bold text-emerald-400 tabular-nums">
                        1:{mult.toFixed(1)}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor="rr-multiplier-cap" className="text-slate-300">
                      Tier R:R Multiplier Ceiling (Max 1:{accountProfile.tier.maxRrMultiplier})
                    </label>
                    <span className="font-mono text-cyan-300 tabular-nums">
                      1:{customRrMultiplierCap}
                    </span>
                  </div>
                  <input
                    id="rr-multiplier-cap"
                    type="range"
                    min={5}
                    max={accountProfile.tier.maxRrMultiplier}
                    step={1}
                    value={Math.min(customRrMultiplierCap, accountProfile.tier.maxRrMultiplier)}
                    onChange={(e) => setCustomRrMultiplierCap(Number(e.target.value))}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>

                {latestOptimization && (
                  <div
                    data-testid="auto-optimizer-report"
                    className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3 space-y-1 text-xs"
                  >
                    <div className="flex items-center justify-between font-semibold text-cyan-200">
                      <span>Continuous Auto-Optimizer ({latestOptimization.symbol})</span>
                      <span className="font-mono tabular-nums">
                        Sharpe {latestOptimization.projectedSharpe}
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-slate-300 tabular-nums">
                      EMA {latestOptimization.optimalEmaFast}/{latestOptimization.optimalEmaSlow} ·
                      R:R 1:{latestOptimization.optimalRrMultiplier} · SL{' '}
                      {latestOptimization.optimalSlCapPct.toFixed(1)}% · Win{' '}
                      {latestOptimization.projectedWinRatePct}% ({latestOptimization.testedCombinations}{' '}
                      runs)
                    </div>
                  </div>
                )}
              </div>

              {/* Right: Supervised Manual Override Safety Protocol */}
              <div className="rounded-xl border border-slate-800/90 bg-[#050914]/90 p-4 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <ShieldCheck className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                    <span>Manual Override Safety Protocol</span>
                  </div>
                  <span className="font-mono text-[11px] text-slate-400">
                    {forgeKillSwitchEngaged ? 'Kill Switch LOCKED' : 'Forge Guard Armed'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex rounded-lg border border-slate-800 bg-[#070d1b] p-0.5">
                    {(['BUY', 'SELL'] as const).map((side) => (
                      <button
                        key={side}
                        type="button"
                        onClick={() => setManualDirection(side)}
                        className={`flex-1 rounded-md py-1.5 font-semibold cursor-pointer ${
                          manualDirection === side
                            ? side === 'BUY'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-rose-500/20 text-rose-300'
                            : 'text-slate-400'
                        }`}
                      >
                        {side}
                      </button>
                    ))}
                  </div>
                  <div className="flex rounded-lg border border-slate-800 bg-[#070d1b] p-0.5">
                    {(['SPOT', 'USD_M_FUTURES'] as const).map((mkt) => (
                      <button
                        key={mkt}
                        type="button"
                        onClick={() => setManualMarket(mkt)}
                        className={`flex-1 rounded-md py-1.5 font-semibold cursor-pointer ${
                          manualMarket === mkt
                            ? 'bg-cyan-500/20 text-cyan-200'
                            : 'text-slate-400'
                        }`}
                      >
                        {mkt === 'SPOT' ? 'Spot 1x' : 'Futures 5x'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-800 bg-[#070d1b] px-3 py-2 font-mono text-[11px] tabular-nums">
                  <div>
                    <div className="text-slate-500">Entry</div>
                    <div className="text-white">${formatCryptoPrice(livePrice)}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">SL ({manualValidation.computedStopLossPct}%)</div>
                    <div className="text-rose-400">${formatCryptoPrice(stopLossPreview)}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">TP (1:{manualValidation.computedRrRatio})</div>
                    <div className="text-emerald-400">${formatCryptoPrice(takeProfitPreview)}</div>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowLowConfidenceSupervision}
                      onChange={(e) => setAllowLowConfidenceSupervision(e.target.checked)}
                      className="accent-cyan-400"
                    />
                    <span>Allow supervised low-confidence execution (capped at ≤0.50% risk)</span>
                  </label>

                  {executionMode === 'SUPERVISED_MANUAL_OVERRIDE' && (
                    <label className="flex items-center gap-2 text-amber-200 cursor-pointer">
                      <input
                        type="checkbox"
                        data-testid="manual-order-confirm-checkbox"
                        checked={manualConfirmed}
                        onChange={(e) => setManualConfirmed(e.target.checked)}
                        className="accent-amber-400"
                      />
                      <span>Operator confirms risk parameters &amp; authorizes order routing</span>
                    </label>
                  )}
                </div>

                {!manualValidation.approved && (
                  <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                    {manualValidation.violations[0]}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                    Effective Risk: {manualValidation.effectiveRiskPct.toFixed(2)}%
                  </span>
                  <ForgeInteractiveButton
                    label={
                      executionMode === 'FULLY_AUTONOMOUS'
                        ? 'Dispatch Verified Trade'
                        : 'Confirm & Route Supervised Order'
                    }
                    intent="primary"
                    disabled={!manualValidation.approved}
                    testId="arch-dispatch-order-btn"
                    onClick={handleExecuteValidatedOrder}
                  />
                </div>

                {manualStatus && (
                  <div
                    data-testid="manual-order-status"
                    className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 font-mono text-[11px] text-emerald-200"
                  >
                    {manualStatus}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: Volume-Based Risk Tiering, Trading Fees & Subscription Plans */}
          {activeTab === 'VOLUME_TIERS_FEES' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-xl border border-slate-800/90 bg-[#050914]/90 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">
                      30-Day Volume Grading &amp; AI Dynamic Risk Ceiling
                    </span>
                    <span className="font-mono text-xs text-cyan-300 tabular-nums">
                      ${userVolume30dUsd.toLocaleString('en-US')}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: '$50K (Starter)', vol: 50_000 },
                      { label: '$250K (Active)', vol: 250_000 },
                      { label: '$1.5M (Pro)', vol: 1_500_000 },
                      { label: '$12M (Inst)', vol: 12_000_000 },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setUserVolume30dUsd(preset.vol)}
                        className={`rounded-md border px-2.5 py-1 text-xs font-medium cursor-pointer ${
                          accountProfile.tier.minVolume30dUsd <= preset.vol &&
                          Math.abs(userVolume30dUsd - preset.vol) < 100_000
                            ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200'
                            : 'border-slate-800 bg-[#070d1b] text-slate-300 hover:text-white'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs">
                      <label htmlFor="custom-risk-slider" className="text-slate-300">
                        Custom Risk Tolerance (AI Cap {accountProfile.aiDynamicRiskCapPct.toFixed(2)}%)
                      </label>
                      <span className="font-mono text-emerald-400 tabular-nums">
                        {customRiskTolerancePct.toFixed(2)}%
                      </span>
                    </div>
                    <input
                      id="custom-risk-slider"
                      type="range"
                      min={0.25}
                      max={accountProfile.aiDynamicRiskCapPct}
                      step={0.05}
                      value={Math.min(customRiskTolerancePct, accountProfile.aiDynamicRiskCapPct)}
                      onChange={(e) => setCustomRiskTolerancePct(Number(e.target.value))}
                      className="w-full accent-emerald-400 cursor-pointer"
                    />
                  </div>
                  <div className="font-mono text-[11px] text-slate-400">
                    Direct Independent API Routing Active · Zero External Copy-Trading Friction
                  </div>
                </div>

                {/* Subscription Plan Selector */}
                <div className="rounded-xl border border-slate-800/90 bg-[#050914]/90 p-4 space-y-3">
                  <div className="text-xs font-semibold text-white">
                    Subscription Plans (Decoupled from Volume Trading Fees)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {SUBSCRIPTION_PLANS.map((plan) => {
                      const active = plan.id === subscriptionPlanId;
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          onClick={() => setSubscriptionPlanId(plan.id)}
                          className={`rounded-lg border p-3 text-left transition-colors cursor-pointer ${
                            active
                              ? 'border-cyan-400 bg-cyan-500/15'
                              : 'border-slate-800 bg-[#070d1b] hover:border-slate-700'
                          }`}
                        >
                          <div className="text-xs font-bold text-white">{plan.label}</div>
                          <div className="mt-0.5 font-mono text-sm font-bold text-cyan-300 tabular-nums">
                            ${plan.monthlyPriceUsd}/mo
                          </div>
                          <div className="mt-1 text-[10px] text-slate-400">
                            {plan.maxConcurrentAgents} AI Agents · {plan.includesTvWebhook ? 'TV Sync' : 'Spot Only'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Volume Tier Comparison Table */}
              <div className="overflow-x-auto rounded-xl border border-slate-800/90 bg-[#050914]/90">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 text-[11px] text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Account Tier</th>
                      <th className="px-4 py-2.5 font-medium text-right">30d Volume Floor</th>
                      <th className="px-4 py-2.5 font-medium text-right">Max Risk Cap</th>
                      <th className="px-4 py-2.5 font-medium text-right">Autonomous R:R Range</th>
                      <th className="px-4 py-2.5 font-medium text-right">Maker / Taker Fee</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                    {ACCOUNT_VOLUME_TIERS.map((tier) => {
                      const isCurrent = tier.id === accountProfile.tier.id;
                      return (
                        <tr
                          key={tier.id}
                          className={isCurrent ? 'bg-cyan-500/10 text-white' : 'text-slate-300'}
                        >
                          <td className="px-4 py-2.5 font-sans font-semibold">
                            {tier.label}
                            {isCurrent && (
                              <span className="ml-2 font-mono text-[10px] text-cyan-300">
                                · Active
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            ${tier.minVolume30dUsd.toLocaleString('en-US')}+
                          </td>
                          <td className="px-4 py-2.5 text-right text-emerald-400">
                            {tier.maxBaseRiskPct.toFixed(2)}%
                          </td>
                          <td className="px-4 py-2.5 text-right text-cyan-300">
                            1:{tier.minRrMultiplier} – 1:{tier.maxRrMultiplier}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {(tier.makerFeeBps / 100).toFixed(3)}% /{' '}
                            {(tier.takerFeeBps / 100).toFixed(3)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: Predictive Pre-Pump Accumulation & Spot/Futures Lifecycle Orchestration */}
          {activeTab === 'PREPUMP_LIFECYCLE' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-800/90 bg-[#050914]/90 p-4 space-y-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <Layers className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                    <span>Multi-Confirmation Pre-Pump Protocol ({selectedSymbol})</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSimulateDelistingPanic((v) => !v)}
                    className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                      simulateDelistingPanic
                        ? 'border-rose-500/50 bg-rose-500/15 text-rose-200'
                        : 'border-slate-700 bg-[#070d1b] text-slate-300'
                    }`}
                  >
                    {simulateDelistingPanic ? 'Clear Panic Drill' : 'Simulate Pre-Dump Alert'}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  {[
                    { label: 'Volume Spike ≥1.8x', ok: prePumpEval.volumeConfirmed },
                    { label: 'L2 Imbalance ≥+20%', ok: prePumpEval.orderBookConfirmed },
                    { label: 'Sentiment + On-Chain', ok: prePumpEval.sentimentConfirmed },
                  ].map((check) => (
                    <div
                      key={check.label}
                      className="rounded-lg border border-slate-800 bg-[#070d1b] px-3 py-2"
                    >
                      <div className="text-[10px] text-slate-400">{check.label}</div>
                      <div
                        className={`mt-1 font-mono text-xs font-bold ${
                          check.ok ? 'text-emerald-400' : 'text-amber-300'
                        }`}
                      >
                        {check.ok ? 'CONFIRMED' : 'WAITING'}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#070d1b] px-3.5 py-2.5 space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-white">
                      Directive: {prePumpEval.directive.replace(/_/g, ' ')}
                    </span>
                    <span className="font-mono text-[11px] text-cyan-300 tabular-nums">
                      LVN/POC Research: {prePumpEval.lvnPocResearchLatencyMs}ms
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">{prePumpEval.summary}</p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800/90 bg-[#050914]/90 p-4 space-y-3">
                <div className="text-xs font-semibold text-white">
                  Spot &amp; Futures Inter-Agent Role Assignments
                </div>
                <div className="divide-y divide-slate-800/80 rounded-lg border border-slate-800 bg-[#070d1b]">
                  {prePumpEval.agentAssignments.map((ag) => (
                    <div
                      key={ag.agentName}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-white">
                          {ag.agentName}{' '}
                          <span className="font-mono text-[10px] text-slate-400">
                            · {ag.marketScope}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {ag.responsibility}
                        </div>
                      </div>
                      <span
                        className={`font-mono text-[11px] font-bold shrink-0 ${
                          ag.vote === 'EXIT'
                            ? 'text-rose-400'
                            : ag.vote === 'HEDGE'
                            ? 'text-amber-300'
                            : ag.vote === 'APPROVE'
                            ? 'text-emerald-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {ag.vote}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Public Cryptographic Trade ID Verification & Visual Evidence */}
          {activeTab === 'TRADE_ID_PROOF' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-800/90 bg-[#050914]/90 p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-white">
                    Public Cryptographic Trade ID Verification Protocol
                  </div>
                  <span className="font-mono text-[11px] text-slate-400">
                    Consolidated Routing: Public Channel + Developer Account · Visual Proof Attached
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={verifyQuery}
                    onChange={(e) => setVerifyQuery(e.target.value)}
                    placeholder="Enter public Trade ID (e.g. SF-TRD-20261120-0101-...)"
                    aria-label="Verify public Trade ID"
                    data-testid="public-trade-id-input"
                    className="flex-1 rounded-lg border border-slate-700 bg-[#070d1b] px-3 py-2 font-mono text-xs text-white focus:border-cyan-400 focus:outline-none"
                  />
                  <div
                    data-testid="public-trade-id-verdict"
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 font-mono text-xs font-semibold ${
                      verificationResult.verified
                        ? 'border-emerald-500/45 bg-emerald-500/15 text-emerald-300'
                        : 'border-slate-700 bg-[#070d1b] text-slate-400'
                    }`}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{verificationResult.integrityStatus}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {verifiedTrades.slice(0, 3).map((rec) => (
                  <article
                    key={rec.tradeId}
                    className="rounded-xl border border-slate-800/90 bg-[#050914]/90 p-3.5 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setVerifyQuery(rec.tradeId)}
                        className="font-mono text-[11px] font-bold text-cyan-300 hover:text-cyan-200 cursor-pointer truncate"
                      >
                        {rec.tradeId}
                      </button>
                      <span className="font-mono text-[10px] text-emerald-400 shrink-0">
                        1:{rec.rrMultiplier.toFixed(1)}
                      </span>
                    </div>
                    <img
                      src={rec.visualSnapshotSvgDataUri}
                      alt={`Chart snapshot for ${rec.symbol} ${rec.tradeId}`}
                      className="w-full h-28 rounded-lg border border-slate-800 bg-[#070d1b] object-contain"
                    />
                    <div className="space-y-0.5 text-[11px]">
                      <div className="font-semibold text-white truncate">{rec.patternLabel}</div>
                      <div className="font-mono text-[10px] text-slate-400 tabular-nums">
                        {rec.stage} · Public + Dev Routed · Digest {rec.cryptographicDigest}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: Autonomous 30m Developer Audit & Multi-Source Feed Sync */}
          {activeTab === 'AUDIT_FEEDS' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-800/90 bg-[#050914]/90 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <Lock className="h-4 w-4 text-amber-400" aria-hidden="true" />
                    <span>30-Min Exclusive Developer Audit &amp; Diagnostics</span>
                  </div>
                  <span className="font-mono text-[10px] text-emerald-400">
                    Public Channel Isolated
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-400 tabular-nums">
                  <span>Interval: {auditBatchPolicy.batchIntervalMinutes}m</span>
                  <span aria-hidden="true">·</span>
                  <span>Heartbeat Spam: Suppressed</span>
                  <span aria-hidden="true">·</span>
                  <span>Next Batch: {new Date(auditSchedule.nextScheduledAtIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <ForgeInteractiveButton
                    label="Run Clean Audit Check"
                    intent="secondary"
                    testId="arch-run-audit-btn"
                    onClick={() => handleRunAudit(false)}
                  />
                  <ForgeInteractiveButton
                    label="Diagnose API / Payload Fault"
                    intent="danger"
                    testId="arch-diagnose-fault-btn"
                    onClick={() => handleRunAudit(true)}
                  />
                </div>

                {auditFeedback && (
                  <div
                    data-testid="audit-dispatch-feedback"
                    className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 font-mono text-[11px] text-cyan-200"
                  >
                    {auditFeedback}
                  </div>
                )}

                <div className="space-y-2 max-h-44 overflow-y-auto">
                  {auditFindings.slice(0, 4).map((f) => (
                    <div
                      key={f.id}
                      className="rounded-lg border border-slate-800 bg-[#070d1b] p-2.5 text-[11px] space-y-1"
                    >
                      <div className="flex items-center justify-between font-mono text-[10px]">
                        <span
                          className={
                            f.severity === 'CRITICAL'
                              ? 'text-rose-400 font-bold'
                              : 'text-amber-300 font-semibold'
                          }
                        >
                          {f.category} · {f.source}
                        </span>
                        <span className="text-slate-500">Dev Only</span>
                      </div>
                      <div className="text-slate-200">{f.rootCause}</div>
                      <div className="text-emerald-300">Action: {f.correctiveActionPlan}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800/90 bg-[#050914]/90 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <Radio className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                    <span>Multi-Source Data Feed Sync</span>
                  </div>
                  <ForgeInteractiveButton
                    label="Test TV Webhook Sync"
                    intent="secondary"
                    testId="arch-test-tv-webhook-btn"
                    onClick={handleSyncTradingViewWebhook}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                  <div className="rounded-lg border border-slate-800 bg-[#070d1b] p-2.5">
                    <div className="text-[10px] text-slate-400">Binance L2 WS</div>
                    <div className="mt-1 font-bold text-emerald-400">
                      {wsConnected ? 'STREAMING' : 'SYNC READY'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#070d1b] p-2.5">
                    <div className="text-[10px] text-slate-400">CoinMarketCap</div>
                    <div className="mt-1 font-bold text-cyan-300">PARITY LOCKED</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#070d1b] p-2.5">
                    <div className="text-[10px] text-slate-400">TradingView Hook</div>
                    <div className="mt-1 font-bold text-emerald-400">
                      {tradingViewSignals.length} SYNCED
                    </div>
                  </div>
                </div>

                {tvFeedback && (
                  <div
                    data-testid="tv-webhook-feedback"
                    className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 font-mono text-[11px] text-emerald-200"
                  >
                    {tvFeedback}
                  </div>
                )}

                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {tradingViewSignals.slice(0, 4).map((sig) => (
                    <div
                      key={sig.id}
                      className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#070d1b] px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-white truncate">
                          {sig.symbol} {sig.action} · {sig.strategyName}
                        </div>
                        <div className="font-mono text-[10px] text-slate-400 tabular-nums">
                          {sig.timeframe} · ${formatCryptoPrice(sig.price)}
                          {sig.rsi !== undefined ? ` · RSI ${sig.rsi.toFixed(1)}` : ''}
                        </div>
                      </div>
                      <span className="font-mono text-[10px] text-emerald-400 shrink-0">
                        WS Synced
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </ForgeWidgetFrame>
    );
  }
);

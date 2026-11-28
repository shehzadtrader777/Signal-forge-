import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Lock, RefreshCw, Wrench } from 'lucide-react';
import { CandleChart } from '../components/CandleChart';
import { PremiumWorkspaceOverview } from '../components/PremiumWorkspaceOverview';
import { ExchangeControlCenter } from '../components/ExchangeControlCenter';
import { SmcVolumeProfilePanel } from '../components/SmcVolumeProfilePanel';
import { TopGainersPanel } from '../components/TopGainersPanel';
import { SignalCard } from '../components/SignalCard';
import { RiskCalculatorModal } from '../components/RiskCalculatorModal';
import { PatternScannerPanel } from '../components/PatternScannerPanel';
import { CoordinatorHub } from '../components/CoordinatorHub';
import { LiveTestnetLedger } from '../components/LiveTestnetLedger';
import { SystemControlsBar } from '../components/SystemControlsBar';
import { OrderBookDepthPanel } from '../components/OrderBookDepthPanel';
import { SentinelAgentPanel } from '../components/SentinelAgentPanel';
import { AutonomousOperationsHub } from '../components/AutonomousOperationsHub';
import { PortfolioManagementHub } from '../components/portfolio/PortfolioManagementHub';
import { ForgeCapitalHub } from '../components/ForgeCapitalHub';
import { TelegramDualStreamMonitor } from '../components/TelegramDualStreamMonitor';
import { MultiScreenWorkspaceBar } from '../components/MultiScreenWorkspaceBar';
import { EntryZoneAndExecutionPanel } from '../components/EntryZoneAndExecutionPanel';
import { AgentLoopTelemetryPanel } from '../components/AgentLoopTelemetryPanel';
import { AgentSyncAndRenderAuditPanel } from '../components/AgentSyncAndRenderAuditPanel';
import { ModularProfitTakingPanel } from '../components/ModularProfitTakingPanel';
import { ProfitVaultAndDailyPnlPanel } from '../components/ProfitVaultAndDailyPnlPanel';
import { MultiAgentDebateAndSelfHealingPanel } from '../components/MultiAgentDebateAndSelfHealingPanel';
import { MultiAgentCommandOrchestratorPanel } from '../components/MultiAgentCommandOrchestratorPanel';
import { AgenticCliOrchestratorPanel } from '../components/AgenticCliOrchestratorPanel';
import { FableOrchestratorPanel } from '../components/FableOrchestratorPanel';
import { FreqtradeUnifiedTerminal } from '../components/FreqtradeUnifiedTerminal';
import { HybridArchitectureConsole } from '../components/HybridArchitectureConsole';
import { MasterContainmentProtocolPanel } from '../components/MasterContainmentProtocolPanel';
import { SignalDetailModal } from '../components/SignalDetailModal';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { useApp } from '../context/AppContext';
import { generateDeterministicCandles } from '../lib/marketData';
import { apiFetch, hasVerifiedOperatorSession } from '../lib/apiClient';
import type { BackendExecutionPipelineSnapshot } from '../lib/executionPipeline';
import { generateTopSignals, type TradingSignal } from '../lib/signals';
import { runSmcVolumeProfileAgent, type SmcAgentAnalysis } from '../lib/smcAgent';
import {
  DEFAULT_PATTERN_SCANNER_PARAMS,
  scanMarketPatterns,
  type PatternScanResult,
  type PatternScannerParams,
} from '../lib/patternScanner';
import {
  coordinateMultiAgentTrade,
  patternResultToTradingSignal,
  smcAnalysisToTradingSignal,
  type LeverageScalingMode,
  type MarginMode,
  type WhaleFlowSnapshot,
} from '../lib/coordinator';
import {
  MAX_PINNED_SIGNALS,
  MIN_PINNED_SIGNALS,
  isPinnedSignalResolved,
} from '../lib/pinnedSignals';

export function Dashboard() {
  const {
    appLiveEnabled,
    selectedSymbol,
    setSelectedSymbol,
    tickers,
    signalTickers,
    liveFeedModulesEnabled,
    allKnownCoins,
    topGainers,
    futuresTradingEnabled,
    futuresTelemetry,
    liveCrossMargin,
    syncVersion,
    pinnedSignals,
    syncPinnedCandidates,
    rotateResolvedPinned,
    backendEvaluations,
    evaluateBackendIntelligence,
    focusCoordinatorPlan,
    routeSignalToTelegram,
    pushNotification,
    refreshDigestStatus,
    signalTimeframe: timeframe,
    setSignalTimeframe: setTimeframe,
    autoScanEnabled,
    setAutoScanEnabled,
    liveCandlesMap,
    newsItems,
    scanningMarkets: scanning,
    runSharedSignalScan: runSignalScan,
    registerChartCandles: handleChartCandlesLoaded,
    orderBookDepth,
    sentinelBySymbol,
    setExecutionRouteDraft,
  } = useApp();
  const activeMonitorId = useWorkspaceStore((s) => s.activeMonitorId);
  const setActiveMonitor = useWorkspaceStore((s) => s.setActiveMonitor);
  const panels = useWorkspaceStore((s) => s.monitors[s.activeMonitorId].panels);
  const [pipelineSnapshot, setPipelineSnapshot] =
    useState<BackendExecutionPipelineSnapshot | null>(null);
  const [initialWsGraceElapsed, setInitialWsGraceElapsed] = useState(false);
  const [inspectedSignalState, setInspectedSignalState] = useState<{
    signal: TradingSignal;
    layoutId: string;
    pinnedRecord?: (typeof pinnedSignals)[number];
  } | null>(null);

  const handleInspectSignalDetail = useCallback(
    (signal: TradingSignal, layoutId: string, pinnedRecord?: (typeof pinnedSignals)[number]) => {
      setInspectedSignalState({ signal, layoutId, pinnedRecord });
    },
    []
  );

  const handleModalBuyRoute = useCallback(
    (sig: TradingSignal) => {
      setSelectedSymbol(sig.symbol);
      setExecutionRouteDraft({
        symbol: sig.symbol,
        direction: sig.direction,
        market: futuresTradingEnabled ? 'USD_M_FUTURES' : 'SPOT',
        moduleId: futuresTradingEnabled ? 'FUTURES_COORDINATOR' : 'SPOT_MOMENTUM',
        leverage: futuresTradingEnabled ? sig.recommendedLeverage ?? 5 : 1,
        notionalUsd: 1500,
        stopLoss: sig.stopLoss,
        trailingStopLoss: sig.trailingStop ?? sig.stopLoss,
        trailingAtrMultiplier: sig.trailingAtrMultiplier ?? 1.5,
        takeProfits: sig.takeProfits,
        prePumpScore: sig.prePumpScore,
        sourceLabel: 'Shared Element Detail Route',
        requestedAt: Date.now(),
      });
      document
        .getElementById('forge-execution-hub')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [futuresTradingEnabled, setExecutionRouteDraft, setSelectedSymbol]
  );

  const fetchPipelineSnapshot = useCallback(async () => {
    try {
      const res = await fetch('/api/pipeline/dashboard-snapshot');
      if (!res.ok) return;
      const data = (await res.json()) as BackendExecutionPipelineSnapshot & {
        snapshot?: BackendExecutionPipelineSnapshot;
      };
      const resolved = data?.snapshot ?? data;
      if (resolved?.ok && Array.isArray(resolved.activeAwaitingSignals)) {
        setPipelineSnapshot(resolved);
      }
    } catch {
      // Keep last known snapshot on transient poll errors
    }
  }, []);

  useEffect(() => {
    fetchPipelineSnapshot();
  }, [fetchPipelineSnapshot]);

  useEffect(() => {
    if (!appLiveEnabled) return;
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchPipelineSnapshot();
    }, 10_000);
    return () => window.clearInterval(id);
  }, [appLiveEnabled, fetchPipelineSnapshot]);

  useEffect(() => {
    const timer = window.setTimeout(() => setInitialWsGraceElapsed(true), 1200);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    const timer = window.setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
    return () => window.clearTimeout(timer);
  }, []);
  const [notionalUsd, setNotionalUsd] = useState<number>(1500);
  const [scalingMode, setScalingMode] = useState<LeverageScalingMode>('AUTO_VOLATILITY');
  const [manualLeverage, setManualLeverage] = useState<number>(10);
  const [marginMode, setMarginMode] = useState<MarginMode>('CROSS');
  const [activeRiskSignal, setActiveRiskSignal] = useState<TradingSignal | null>(null);
  const [patternParams, setPatternParams] = useState<PatternScannerParams>(
    DEFAULT_PATTERN_SCANNER_PARAMS
  );

  const coordinatorSectionRef = useRef<HTMLDivElement | null>(null);
  const alertedSignalKeysRef = useRef<Set<string>>(new Set());
  const loggedSkepticVetoKeysRef = useRef<Set<string>>(new Set());
  const allKnownCoinsRef = useRef(allKnownCoins);
  allKnownCoinsRef.current = allKnownCoins;
  const pinnedSyncSigRef = useRef('');
  const lastTelegramEvalSigRef = useRef('');
  const lastEmailEvalSigRef = useRef('');

  // Offload Fundamental Criteria, Market Intelligence & Whale Netflows to the Backend (paused when Live Feed Modules are OFF)
  useEffect(() => {
    if (!liveFeedModulesEnabled) return;
    const symbols = allKnownCoinsRef.current.slice(0, 10).map((c) => c.symbol);
    evaluateBackendIntelligence(symbols);
  }, [syncVersion, liveFeedModulesEnabled, evaluateBackendIntelligence]);

  const whaleFlowsMap = useMemo<Record<string, WhaleFlowSnapshot>>(() => {
    const map: Record<string, WhaleFlowSnapshot> = {};
    for (const [sym, ev] of Object.entries(backendEvaluations)) {
      map[sym] = {
        symbol: sym,
        netflowUsd: ev.netflowUsd,
        inflow24hUsd: ev.inflow24hUsd,
        outflow24hUsd: ev.outflow24hUsd,
      };
    }
    return map;
  }, [backendEvaluations]);

  const needsSmcComputation = panels.smcProfile || panels.priceChart || panels.coordinatorHub;
  const activeSmcAnalysis = useMemo(() => {
    if (!needsSmcComputation) return null;
    const candles =
      liveCandlesMap[selectedSymbol] ||
      generateDeterministicCandles(selectedSymbol, timeframe, 120);
    if (!candles || candles.length < 20) return null;
    const coin = allKnownCoins.find((c) => c.symbol === selectedSymbol);
    const liveTk = signalTickers[selectedSymbol];
    const liveWsPrice = liveTk?.isLiveWs && liveTk.price > 0 ? liveTk.price : undefined;
    return runSmcVolumeProfileAgent(
      selectedSymbol,
      coin?.name || selectedSymbol.replace(/USDT$/i, ''),
      candles,
      undefined,
      Math.floor(Date.now() / 60_000) * 60,
      liveWsPrice
    );
  }, [needsSmcComputation, liveCandlesMap, selectedSymbol, timeframe, allKnownCoins, signalTickers]);

  // Generate 6-12 strongest AI & Top Gainer candidates anchored to live WebSocket feed snapshots
  const topSignals = useMemo(() => {
    return generateTopSignals(
      liveCandlesMap,
      newsItems,
      12,
      allKnownCoins,
      topGainers,
      signalTickers
    );
  }, [liveCandlesMap, newsItems, allKnownCoins, topGainers, signalTickers]);

  const syncedPatternParams = useMemo(
    () => ({ ...patternParams, timeframe }),
    [patternParams, timeframe]
  );

  const needsPatternComputation = panels.patternScanner || panels.coordinatorHub;
  const patternScanSummary = useMemo(() => {
    if (!needsPatternComputation) {
      return {
        scannedCount: 0,
        confirmedSignals: [] as PatternScanResult[],
        filteredFakeouts: [] as PatternScanResult[],
        watchingCoils: [] as PatternScanResult[],
        scannedAt: '',
      };
    }
    return scanMarketPatterns(liveCandlesMap, syncedPatternParams, allKnownCoins);
  }, [needsPatternComputation, liveCandlesMap, syncedPatternParams, allKnownCoins]);

  // Synchronize top 3–5 strongest signals into persistent pinned slots (locked until final TP3/SL outcome)
  const combinedCandidateSignals = useMemo(() => {
    const smcCandles =
      liveCandlesMap[selectedSymbol] ||
      generateDeterministicCandles(selectedSymbol, timeframe, 120);
    const list: TradingSignal[] = [...topSignals];
    if (activeSmcAnalysis) {
      list.push(
        smcAnalysisToTradingSignal(
          activeSmcAnalysis,
          smcCandles,
          newsItems,
          signalTickers[selectedSymbol]
        )
      );
    }
    for (const pat of patternScanSummary.confirmedSignals.slice(0, 2)) {
      const c = liveCandlesMap[pat.symbol] || generateDeterministicCandles(pat.symbol, timeframe, 120);
      list.push(
        patternResultToTradingSignal(pat, c, newsItems, signalTickers[pat.symbol])
      );
    }
    return list;
  }, [
    topSignals,
    activeSmcAnalysis,
    patternScanSummary,
    liveCandlesMap,
    selectedSymbol,
    timeframe,
    newsItems,
    signalTickers,
  ]);

  const liveCandlesMapRef = useRef(liveCandlesMap);
  liveCandlesMapRef.current = liveCandlesMap;

  const combinedCandidateSignalsRef = useRef(combinedCandidateSignals);
  combinedCandidateSignalsRef.current = combinedCandidateSignals;

  const candidateIdentityKey = useMemo(
    () =>
      combinedCandidateSignals
        .map((s) => `${s.symbol}_${s.direction}_${s.entryPriceSource || 'CANDLE'}`)
        .join(','),
    [combinedCandidateSignals]
  );

  const hasLiveFeedForInitialPin = useMemo(
    () =>
      !liveFeedModulesEnabled ||
      Object.values(signalTickers).some((t) => t.isLiveWs) ||
      initialWsGraceElapsed,
    [liveFeedModulesEnabled, signalTickers, initialWsGraceElapsed]
  );

  useEffect(() => {
    if (
      pinnedSignals.length >= MAX_PINNED_SIGNALS ||
      !hasLiveFeedForInitialPin ||
      !candidateIdentityKey
    ) {
      return;
    }
    const sig = `${pinnedSignals.length}:${candidateIdentityKey}`;
    if (sig === pinnedSyncSigRef.current) return;
    pinnedSyncSigRef.current = sig;
    syncPinnedCandidates(combinedCandidateSignalsRef.current, liveCandlesMapRef.current);
  }, [candidateIdentityKey, pinnedSignals.length, syncPinnedCandidates, hasLiveFeedForInitialPin]);

  // Direct Multi-Module Coordinator Integration: Spot Priority Default + Optional Manual Futures Toggle
  const coordinatedPlans = useMemo(() => {
    if (!panels.coordinatorHub) return [];
    const planOptions = {
      futuresEnabled: futuresTradingEnabled,
      notionalUsd,
      manualLeverage,
      scalingMode,
      marginMode,
      crossAvailableBalanceUsd: liveCrossMargin.availableCrossMarginUsd,
    };

    const allPlans = topSignals.slice(0, 3).map((sig) => {
      const candles =
        liveCandlesMap[sig.symbol] ||
        generateDeterministicCandles(sig.symbol, timeframe, 120, undefined, sig.entryPrice);
      return coordinateMultiAgentTrade(
        sig,
        candles,
        newsItems,
        whaleFlowsMap[sig.symbol],
        futuresTradingEnabled ? futuresTelemetry[sig.symbol] : undefined,
        {
          ...planOptions,
          sourceModule: 'AI_ENGINE',
          sourceLabel: 'AI Coordinator',
          orderBookDepth: orderBookDepth[sig.symbol],
          sentinelAssessment: sentinelBySymbol[sig.symbol],
        }
      );
    });

    if (activeSmcAnalysis) {
      const smcCandles =
        liveCandlesMap[activeSmcAnalysis.symbol] ||
        generateDeterministicCandles(activeSmcAnalysis.symbol, timeframe, 120);
      const smcSignal = smcAnalysisToTradingSignal(
        activeSmcAnalysis,
        smcCandles,
        newsItems,
        signalTickers[activeSmcAnalysis.symbol]
      );
      allPlans.push(
        coordinateMultiAgentTrade(
          smcSignal,
          smcCandles,
          newsItems,
          whaleFlowsMap[activeSmcAnalysis.symbol],
          futuresTradingEnabled ? futuresTelemetry[activeSmcAnalysis.symbol] : undefined,
          {
            ...planOptions,
            sourceModule: 'SMC_FRVP',
            sourceLabel: `SMC · ${activeSmcAnalysis.zoneLabel}`,
            orderBookDepth: orderBookDepth[activeSmcAnalysis.symbol],
            sentinelAssessment: sentinelBySymbol[activeSmcAnalysis.symbol],
          }
        )
      );
    }

    for (const pat of patternScanSummary.confirmedSignals.slice(0, 2)) {
      const patCandles =
        liveCandlesMap[pat.symbol] ||
        generateDeterministicCandles(pat.symbol, timeframe, 120, undefined, pat.entryPrice);
      const patSignal = patternResultToTradingSignal(
        pat,
        patCandles,
        newsItems,
        signalTickers[pat.symbol]
      );
      allPlans.push(
        coordinateMultiAgentTrade(
          patSignal,
          patCandles,
          newsItems,
          whaleFlowsMap[pat.symbol],
          futuresTradingEnabled ? futuresTelemetry[pat.symbol] : undefined,
          {
            ...planOptions,
            sourceModule: 'PATTERN_SCANNER',
            sourceLabel: `Pattern · ${pat.patternName}`,
            orderBookDepth: orderBookDepth[pat.symbol],
            sentinelAssessment: sentinelBySymbol[pat.symbol],
          }
        )
      );
    }

    return allPlans;
  }, [
    panels.coordinatorHub,
    topSignals,
    activeSmcAnalysis,
    patternScanSummary,
    liveCandlesMap,
    signalTickers,
    timeframe,
    newsItems,
    whaleFlowsMap,
    futuresTradingEnabled,
    futuresTelemetry,
    notionalUsd,
    manualLeverage,
    scalingMode,
    marginMode,
    liveCrossMargin.availableCrossMarginUsd,
    orderBookDepth,
    sentinelBySymbol,
  ]);

  const handleSendSmcToCoordinator = useCallback(
    (analysis: SmcAgentAnalysis) => {
      const planId = `coord_SMC_FRVP_${analysis.symbol}_${analysis.direction}`;
      focusCoordinatorPlan(planId);
      coordinatorSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [focusCoordinatorPlan]
  );

  const handleSendPatternToCoordinator = useCallback(
    (item: PatternScanResult) => {
      const planId = `coord_PATTERN_SCANNER_${item.symbol}_${item.direction}`;
      focusCoordinatorPlan(planId);
      coordinatorSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [focusCoordinatorPlan]
  );

  const coordinatedPlansRef = useRef(coordinatedPlans);
  coordinatedPlansRef.current = coordinatedPlans;
  const telegramRoutingSig = useMemo(
    () =>
      coordinatedPlans
        .map((p) => `${p.id}:${p.skeptic.verdict}:${p.routeToTelegram ? 1 : 0}`)
        .join('|'),
    [coordinatedPlans]
  );

  // Auto-route high-confidence Skeptic-approved plans into "Signal Forge" Telegram Channel
  useEffect(() => {
    if (!telegramRoutingSig || telegramRoutingSig === lastTelegramEvalSigRef.current) return;
    lastTelegramEvalSigRef.current = telegramRoutingSig;

    for (const plan of coordinatedPlansRef.current) {
      if (plan.skeptic.verdict === 'VETOED') {
        const vetoKey = `${plan.symbol}_${plan.direction}_veto`;
        if (!loggedSkepticVetoKeysRef.current.has(vetoKey)) {
          loggedSkepticVetoKeysRef.current.add(vetoKey);
          pushNotification({
            category: 'SKEPTIC',
            title: `Skeptic Agent Vetoed ${plan.symbol} ${plan.direction}`,
            message: plan.skeptic.challenges[0] || plan.skeptic.mitigationNote,
            symbol: plan.symbol,
            severity: 'warning',
          });
        }
        continue;
      }

      if (plan.routeToTelegram) {
        routeSignalToTelegram(plan).catch(() => undefined);
      }
    }
  }, [telegramRoutingSig, routeSignalToTelegram, pushNotification]);

  const topSignalsRef = useRef(topSignals);
  topSignalsRef.current = topSignals;
  const activeSmcAnalysisRef = useRef(activeSmcAnalysis);
  activeSmcAnalysisRef.current = activeSmcAnalysis;
  const patternSignalsRef = useRef(patternScanSummary.confirmedSignals);
  patternSignalsRef.current = patternScanSummary.confirmedSignals;

  const emailDigestSig = useMemo(
    () =>
      [
        ...topSignals.filter((s) => s.confidence >= 85).map((s) => `${s.symbol}_${s.direction}`),
        activeSmcAnalysis && activeSmcAnalysis.confidence >= 85
          ? `smc_${activeSmcAnalysis.symbol}_${activeSmcAnalysis.direction}`
          : '',
        ...patternScanSummary.confirmedSignals
          .slice(0, 2)
          .filter((p) => p.confidence >= 85)
          .map((p) => `pat_${p.symbol}_${p.direction}`),
      ]
        .filter(Boolean)
        .join(','),
    [topSignals, activeSmcAnalysis, patternScanSummary]
  );

  // Strictly batch >= 85% AI, SMC, and Pattern Scanner signal alerts into the 3-Hour Coordinator Email Digest (authorized operators only)
  useEffect(() => {
    if (!emailDigestSig || emailDigestSig === lastEmailEvalSigRef.current) return;
    let cancelled = false;
    let refreshTimer: number | null = null;

    hasVerifiedOperatorSession()
      .then((isOperator) => {
        if (cancelled || !isOperator) return;
        lastEmailEvalSigRef.current = emailDigestSig;
        let queuedAny = false;

        for (const sig of topSignalsRef.current) {
          if (sig.confidence < 85) continue;
          const key = `${sig.symbol}_${sig.direction}`;
          if (alertedSignalKeysRef.current.has(key)) continue;
          alertedSignalKeysRef.current.add(key);
          queuedAny = true;

          apiFetch('/api/alerts/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'HIGH_CONFIDENCE_SIGNAL',
              sourceModule: 'AI_ENGINE',
              symbol: sig.symbol,
              direction: sig.direction,
              confidence: sig.confidence,
              entryPrice: sig.entryPrice,
              stopLoss: sig.stopLoss,
              trailingStopLoss: sig.stopLoss,
              takeProfits: sig.takeProfits,
              reason: sig.reason,
            }),
          }).catch(() => undefined);
        }

        const curSmc = activeSmcAnalysisRef.current;
        if (curSmc && curSmc.confidence >= 85) {
          const smcKey = `smc_${curSmc.symbol}_${curSmc.direction}`;
          if (!alertedSignalKeysRef.current.has(smcKey)) {
            alertedSignalKeysRef.current.add(smcKey);
            queuedAny = true;
            apiFetch('/api/alerts/email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'HIGH_CONFIDENCE_SIGNAL',
                sourceModule: 'SMC_FRVP',
                symbol: curSmc.symbol,
                direction: curSmc.direction,
                confidence: curSmc.confidence,
                entryPrice: curSmc.entryPrice,
                stopLoss: curSmc.stopLoss,
                trailingStopLoss: curSmc.stopLoss,
                takeProfits: curSmc.takeProfits,
                reason: curSmc.rationale,
              }),
            }).catch(() => undefined);
          }
        }

        for (const pat of patternSignalsRef.current.slice(0, 2)) {
          if (pat.confidence < 85) continue;
          const key = `pat_${pat.symbol}_${pat.direction}`;
          if (alertedSignalKeysRef.current.has(key)) continue;
          alertedSignalKeysRef.current.add(key);
          queuedAny = true;

          apiFetch('/api/alerts/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'HIGH_CONFIDENCE_SIGNAL',
              sourceModule: 'PATTERN_SCANNER',
              symbol: pat.symbol,
              direction: pat.direction,
              confidence: pat.confidence,
              entryPrice: pat.entryPrice,
              stopLoss: pat.stopLoss,
              trailingStopLoss: pat.stopLoss,
              takeProfits: pat.takeProfits,
              reason: `${pat.patternName} (${pat.moveType}) · ${pat.summary}`,
            }),
          }).catch(() => undefined);
        }

        if (queuedAny && !cancelled) {
          refreshTimer = window.setTimeout(() => {
            refreshDigestStatus();
          }, 350);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [emailDigestSig, refreshDigestStatus]);

  const resolvedPinnedCount = useMemo(
    () => pinnedSignals.filter((p) => isPinnedSignalResolved(p.status)).length,
    [pinnedSignals]
  );

  const displayedSignalCards = useMemo(() => {
    const items: Array<{ signal: TradingSignal; record: (typeof pinnedSignals)[number] | undefined }> =
      pinnedSignals.map((rec) => ({ signal: rec.signal, record: rec }));
    const seen = new Set(items.map((i) => `${i.signal.symbol}_${i.signal.direction}`));

    for (const cand of combinedCandidateSignals) {
      if (items.length >= MAX_PINNED_SIGNALS) break;
      const key = `${cand.symbol}_${cand.direction}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ signal: cand, record: undefined });
    }

    return items.slice(0, MAX_PINNED_SIGNALS);
  }, [pinnedSignals, combinedCandidateSignals]);

  return (
    <div>
      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 space-y-8">
        {/* User-customizable premium overview. Never modifies trade execution or balance state. */}
        <PremiumWorkspaceOverview />
        {/* Dedicated Public Preview & Safe Maintenance Quick Access (No Logout Needed) */}
        <div
          data-testid="dashboard-public-preview-bar"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800/90 bg-[#0d1323] px-4 py-2.5 text-xs"
        >
          <span className="font-mono text-slate-300">
            Signal Forge Workspace · Paper/Demo Default · Private Trading Context
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/home"
              data-testid="dashboard-public-preview-btn"
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/45 bg-blue-500/12 px-3 py-1.5 font-semibold text-blue-200 hover:bg-blue-500/20 hover:text-white transition-colors whitespace-nowrap"
            >
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Public Preview (No Logout)</span>
            </Link>
            <Link
              to="/settings"
              data-testid="dashboard-maintenance-control-btn"
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-semibold text-amber-200 hover:bg-amber-500/20 transition-colors whitespace-nowrap"
            >
              <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Maintenance &amp; Command Hub</span>
            </Link>
          </div>
        </div>

        {/* Multi-Screen Workspace Synchronization, Cyber-AI Theme Controls & Backend AI Pulse */}
        <MultiScreenWorkspaceBar pipelineSnapshot={pipelineSnapshot} />

        {/* Stable Dashboard Workspace Stage (switched via MultiScreenWorkspaceBar — no touch-drag hijacking on mobile scroll) */}
        <div
          data-testid="dashboard-workspace-stage"
          data-active-monitor={activeMonitorId}
          className="space-y-8"
        >
            {/* Signal Forge 6-Phase Hybrid Production Core (Python Control Plane + Rust Execution Engine) */}
            {panels.hybridArchitecture && <HybridArchitectureConsole />}

            {/* Master Containment & Strategy Protocol (Circuit Breakers, Funding De-Leverage, HMAC Offline Alerts, ATR & Correlated Hedging) */}
            <MasterContainmentProtocolPanel />

            {/* Signal Forge × Freqtrade Unified CCXT Execution, SQLite Dry-Run, 50-Win Live Gate & Telegram RPC Terminal */}
            {panels.freqtradeTerminal && <FreqtradeUnifiedTerminal />}

            {/* Master Performance & System On/Off Controls */}
            {panels.systemControls && <SystemControlsBar />}

            {/* Fable 5.2 Multi-Agent 8-Layer Self-Improving Trading Orchestrator (Half-Kelly, Risk Parity, Black-Scholes, Phase 5) */}
            {panels.fableOrchestrator && <FableOrchestratorPanel />}

            {/* Agentic CLI Loop, Unified Model API Gateway & Confirmed Local Script Editor */}
            {panels.agenticCliLoop && <AgenticCliOrchestratorPanel />}

            {/* Multi-Agent Trading Architecture: 1:5–1:25+ R:R, Volume Tiers, Pre-Pump Lifecycle, Cryptographic Trade IDs & 30m Dev Audit */}
            {panels.multiAgentArchitecture && <MultiAgentCommandOrchestratorPanel />}

            {/* Visible Telemetry Mapping Backend Agent Transaction Loops */}
            {panels.agentLoopTelemetry && <AgentLoopTelemetryPanel />}

            {/* Multi-Agent State Synchronization & 120Hz Render Pipeline Audit */}
            {panels.agentSyncAudit && <AgentSyncAndRenderAuditPanel />}

            {/* Entry-Zone Validated Signal Cards & Zero-Clutter Backend Execution Logs */}
            {(panels.activeEntryZoneSignals || panels.backendExecutionLogs) && (
              <EntryZoneAndExecutionPanel
                snapshot={pipelineSnapshot}
                showActiveSignals={panels.activeEntryZoneSignals}
                showExecutionLogs={panels.backendExecutionLogs}
                onSnapshotUpdated={setPipelineSnapshot}
                onSelectSymbol={setSelectedSymbol}
              />
            )}

            {/* Modular Decoupled Per-Agent Profit-Taking & Autonomous Profit Locking Studio */}
            {panels.modularProfitTaking && <ModularProfitTakingPanel />}

            {/* Overhauled Pre-Pump Support Desk & Top Gainers (Immediate Support Execution + Hold Until Max Profit TP3) */}
            {panels.prePumpSupportDesk && (
              <TopGainersPanel
                prioritizedSymbols={topSignals.map((s) => s.symbol)}
                prePumpMonitor={pipelineSnapshot?.prePumpSupportMonitor}
                onPipelineSnapshotUpdated={setPipelineSnapshot}
              />
            )}

        {/* Dual-Stream Telegram Webhook, Public Signal Forge Alerts & Private Developer System Audit Oversight */}
        {panels.telegramMonitor && <TelegramDualStreamMonitor />}

        {/* Multi-Asset Portfolio Exposure Meter, Volatility Gauges & Auto-Rebalancer */}
        {panels.portfolioHub && <PortfolioManagementHub compact />}

        {/* High-Frequency Profit Scooping, Immutable Locker Vault & Daily PnL Tracker */}
        {panels.profitVault && <ProfitVaultAndDailyPnlPanel />}

        {/* Multi-Agent Debate Coordinator, Google Search Grounding & Self-Healing Health Hub */}
        {panels.debateCoordinator && <MultiAgentDebateAndSelfHealingPanel />}

        {/* Forge Capital Hub — 10-15% Hard Drawdown Fail-Safe & Dual Binance Spot/Futures Execution Router */}
        {panels.forgeCapital && <ForgeCapitalHub />}

        {/* Full-Width Pure Execution Live Price Chart (Fundamentals & Whale Intel Offloaded to Backend) */}
        {panels.priceChart && (
          <CandleChart
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
            onCandlesLoaded={handleChartCandlesLoaded}
            smcAnalysis={activeSmcAnalysis}
          />
        )}

        {/* Exchange & Trading Control Center (Binance, Bybit, OKX, Kraken + Switch to Live Gate) */}
        <ExchangeControlCenter />

        {/* Active Signals Multi-Column Grid (6–12 Pre-Pump & AI Coordinator Signals) */}
        {panels.activeEntryZoneSignals && (
          <section
            aria-label="Pinned Top AI Signals"
            data-testid="active-signals-grid-section"
            className="space-y-4"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <span className="text-xs text-slate-400">
                  Permanently Pinned Until Final Outcome (TP3 Win or Wide ATR Trailing Stop) · Offloaded Intel Verified
                </span>
                <h2 className="mt-0.5 font-display text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                  <Lock className="h-5 w-5 text-cyan-400 shrink-0" aria-hidden="true" />
                  <span>
                    Active Top {Math.max(MIN_PINNED_SIGNALS, displayedSignalCards.length)} Pre-Pump &amp; AI Signals ({timeframe})
                  </span>
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {resolvedPinnedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => rotateResolvedPinned(combinedCandidateSignals, liveCandlesMap)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <span>Rotate {resolvedPinnedCount} Resolved Signal{resolvedPinnedCount > 1 ? 's' : ''}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => runSignalScan(timeframe)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0d1527] px-3.5 py-2 text-xs font-semibold text-white hover:border-cyan-400 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
                  <span>{scanning ? 'Scanning Markets...' : 'Rescan Signals'}</span>
                </button>
              </div>
            </div>

            <div
              data-testid="active-signals-grid"
              className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            >
              {displayedSignalCards.map((item, idx) => (
                <SignalCard
                  key={`${item.signal.symbol}_${item.signal.direction}`}
                  signal={item.signal}
                  rank={idx + 1}
                  pinnedRecord={item.record}
                  onOpenRiskCalc={setActiveRiskSignal}
                  onInspectDetail={handleInspectSignalDetail}
                />
              ))}
            </div>
          </section>
        )}

        {/* Dedicated Always-Visible Live Testnet Execution Ledger */}
        {panels.liveLedger && <LiveTestnetLedger candlesMap={liveCandlesMap} />}

        {/* Autonomous AI Crypto Trading Coordinator (Spot Priority Default + Optional Futures Toggle) */}
        {panels.coordinatorHub && (
          <div ref={coordinatorSectionRef} className="scroll-mt-20">
            <CoordinatorHub
              plans={coordinatedPlans}
              candlesMap={liveCandlesMap}
              notionalUsd={notionalUsd}
              onChangeNotionalUsd={setNotionalUsd}
              scalingMode={scalingMode}
              onChangeScalingMode={setScalingMode}
              manualLeverage={manualLeverage}
              onChangeManualLeverage={setManualLeverage}
              marginMode={marginMode}
              onChangeMarginMode={setMarginMode}
            />
          </div>
        )}

        {/* Dedicated Sentinel Agent (Market Panic, FUD & Breaking Anomaly Protection) */}
        {panels.sentinelAgent && <SentinelAgentPanel />}

        {/* Autonomous RL Auto-Tuner, Flash-Crash Liquidation Shield, Arbitrage & Institutional Copy Desk */}
        {panels.autonomousOps && <AutonomousOperationsHub />}

        {/* Multi-Exchange L2 Order Book Depth & Whale Liquidity Shifts (Binance · Bybit · OKX) */}
        {panels.orderBookDepth && <OrderBookDepthPanel />}

        {/* Smart Money Concepts & Fixed Range Volume Profile AI Agent (Directly Connected to Coordinator) */}
        {panels.smcProfile && (
          <SmcVolumeProfilePanel
            analysis={activeSmcAnalysis}
            timeframe={timeframe}
            livePrice={tickers[selectedSymbol]?.price}
            onOpenRiskCalc={setActiveRiskSignal}
            onSendToCoordinator={handleSendSmcToCoordinator}
          />
        )}

        {/* Continuous Chart Pattern Breakout/Breakdown & Anti-Fakeout Scanner (Directly Connected to Coordinator) */}
        {panels.patternScanner && (
          <PatternScannerPanel
            summary={patternScanSummary}
            params={syncedPatternParams}
            onChangeParams={setPatternParams}
            autoScanEnabled={autoScanEnabled}
            onToggleAutoScan={() => setAutoScanEnabled((prev) => !prev)}
            scanning={scanning}
            onManualScan={() => runSignalScan(timeframe)}
            onOpenRiskCalc={setActiveRiskSignal}
            onSendToCoordinator={handleSendPatternToCoordinator}
          />
        )}
        </div>
      </div>

      <SignalDetailModal
        signal={inspectedSignalState?.signal ?? null}
        layoutId={inspectedSignalState?.layoutId ?? null}
        pinnedRecord={inspectedSignalState?.pinnedRecord}
        onClose={() => setInspectedSignalState(null)}
        onExecuteBuy={handleModalBuyRoute}
        onOpenRiskCalc={setActiveRiskSignal}
      />

      <RiskCalculatorModal
        signal={activeRiskSignal}
        onClose={() => setActiveRiskSignal(null)}
      />
    </div>
  );
}

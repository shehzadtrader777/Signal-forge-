import {
  TRACKED_COINS,
  generateDeterministicCandles,
  type Candle,
  type CoinMeta,
  type TickerSnapshot,
  type Timeframe,
  type TopGainerCoin,
} from './marketData';
import {
  DEFAULT_NEWS_FEED,
  applyLiveSnapshotToCandles,
  generateTopSignals,
  type NewsItem,
} from './signals';
import {
  runSmcVolumeProfileAgent,
  type SmcAgentAnalysis,
} from './smcAgent';
import {
  DEFAULT_PATTERN_SCANNER_PARAMS,
  scanMarketPatterns,
  type MarketPatternScanSummary,
  type PatternName,
  type PatternScannerParams,
} from './patternScanner';
import {
  coordinateMultiAgentTrade,
  patternResultToTradingSignal,
  smcAnalysisToTradingSignal,
  type CoordinatedTradePlan,
  type FuturesTickerTelemetry,
  type LeverageScalingMode,
  type MarginMode,
  type SandboxPosition,
  type WhaleFlowSnapshot,
} from './coordinator';
import type { MultiExchangeDepthAnalysis } from './orderBookDepth';
import type { SentinelAssessment } from './sentinelAgent';

export type MasterMoveType = 'BREAKOUT' | 'BREAKDOWN' | 'SMC_STRUCTURE' | 'TREND_MOMENTUM';
export type MasterModuleFilter = 'ALL' | 'SMC_FRVP' | 'PATTERN_SCANNER' | 'AI_ENGINE';
export type MasterMoveFilter = 'ALL' | 'BREAKOUT' | 'BREAKDOWN';
export type MasterDirectionFilter = 'ALL' | 'BUY' | 'SELL';

export interface MasterSignalFilterConfig {
  minConfidence: number; // default 86%
  minRiskReward: number; // default 2.0 (1:2 R:R)
  moduleFilter: MasterModuleFilter;
  moveFilter: MasterMoveFilter;
  directionFilter: MasterDirectionFilter;
  topGainersOnly: boolean;
  excludeVetoed: boolean;
}

export const DEFAULT_MASTER_SIGNAL_FILTERS: MasterSignalFilterConfig = {
  minConfidence: 86,
  minRiskReward: 2.0,
  moduleFilter: 'ALL',
  moveFilter: 'ALL',
  directionFilter: 'ALL',
  topGainersOnly: false,
  excludeVetoed: true,
};

export interface MasterFrvpTelemetry {
  poc: number;
  vah: number;
  val: number;
  priceZone: 'Discount' | 'Equilibrium' | 'Premium';
  hvnCount: number;
  lvnCount: number;
  hvnConfirmedCount: number;
  lvnAvoidedCount: number;
  institutionalLiquidityConfirmed: boolean;
}

export interface MasterSmcTelemetry {
  bias: 'Bullish' | 'Bearish' | 'Neutral';
  lastEvent: 'BOS' | 'CHoCH' | 'Consolidation';
  sweepDetected: boolean;
  sweepType: 'SSL Sweep' | 'BSL Sweep' | 'None';
  zoneLabel: 'Accumulation Zone' | 'Supply Zone';
  retestStatus: string;
  executionStatus: SmcAgentAnalysis['executionStatus'];
  executionAllowed: boolean;
  sessionLabel: string;
}

export interface MasterPatternTelemetry {
  patternName: PatternName;
  moveType: 'BREAKOUT' | 'BREAKDOWN' | 'COIL';
  breakoutLevel: number;
  volumeRatio: number;
  closeBeyondPercent: number;
  passedChecks: string[];
  summary: string;
}

export interface MasterCoordinatorSetup {
  id: string;
  symbol: string;
  coinName: string;
  direction: 'BUY' | 'SELL';
  sourceModule: 'AI_ENGINE' | 'SMC_FRVP' | 'PATTERN_SCANNER';
  moveType: MasterMoveType;
  confidence: number;
  entryPrice: number;
  trailingStopLoss: number;
  takeProfits: [number, number, number];
  tp1RiskReward: number;
  maxRiskReward: number;
  plan: CoordinatedTradePlan;
  smc: MasterSmcTelemetry | null;
  frvp: MasterFrvpTelemetry | null;
  pattern: MasterPatternTelemetry | null;
  isTopGainer: boolean;
  gainerRank: number | null;
  change24hPercent: number | null;
  activePosition: SandboxPosition | null;
  latestClosedPosition: SandboxPosition | null;
  orderBookDepth?: MultiExchangeDepthAnalysis | null;
  sentinel?: SentinelAssessment | null;
}

export interface MasterAggregationSummary {
  totalEvaluatedSetups: number;
  qualifiedCount: number;
  breakoutCount: number;
  breakdownCount: number;
  smcFrvpQualifiedCount: number;
  hvnConfirmedCount: number;
  topGainerQualifiedCount: number;
  scannerTelemetry: {
    scannedPairs: number;
    confirmedPatterns: number;
    filteredFakeouts: number;
    watchingCoils: number;
  };
}

export interface MasterCoordinatorBuildResult {
  allSetups: MasterCoordinatorSetup[];
  patternSummary: MarketPatternScanSummary;
  smcBySymbol: Record<string, SmcAgentAnalysis>;
}

export interface BuildMasterCoordinatorInput {
  candlesMap: Record<string, Candle[]>;
  timeframe: Timeframe;
  allKnownCoins?: CoinMeta[];
  topGainers?: TopGainerCoin[];
  liveTickers?: Record<string, TickerSnapshot>;
  newsItems?: NewsItem[];
  whaleFlowsMap?: Record<string, WhaleFlowSnapshot>;
  futuresTelemetry?: Record<string, FuturesTickerTelemetry>;
  orderBookDepthMap?: Record<string, MultiExchangeDepthAnalysis>;
  sentinelBySymbol?: Record<string, SentinelAssessment>;
  positions?: SandboxPosition[];
  planOptions?: {
    futuresEnabled?: boolean;
    notionalUsd?: number;
    manualLeverage?: number;
    scalingMode?: LeverageScalingMode;
    marginMode?: MarginMode;
    crossAvailableBalanceUsd?: number;
  };
  scannerOverrides?: Partial<PatternScannerParams>;
  evaluationTimeSec?: number;
}

function toFrvpTelemetry(smc: SmcAgentAnalysis): MasterFrvpTelemetry {
  return {
    poc: smc.volumeProfile.poc,
    vah: smc.volumeProfile.vah,
    val: smc.volumeProfile.val,
    priceZone: smc.volumeProfile.priceZone,
    hvnCount: smc.volumeProfile.highVolumeNodes.length,
    lvnCount: smc.volumeProfile.lowVolumeNodes.length,
    hvnConfirmedCount: smc.hvnConfirmedCount,
    lvnAvoidedCount: smc.lvnAvoidedCount,
    institutionalLiquidityConfirmed: smc.institutionalLiquidityConfirmed,
  };
}

function toSmcTelemetry(smc: SmcAgentAnalysis): MasterSmcTelemetry {
  return {
    bias: smc.structure.bias,
    lastEvent: smc.structure.lastEvent,
    sweepDetected: smc.liquiditySweep.detected,
    sweepType: smc.liquiditySweep.type,
    zoneLabel: smc.zoneLabel,
    retestStatus: smc.retestStatus,
    executionStatus: smc.executionStatus,
    executionAllowed: smc.executionAllowed,
    sessionLabel: smc.sessionStatus.session,
  };
}

function deriveMoveTypeForPlan(
  sourceModule: 'AI_ENGINE' | 'SMC_FRVP' | 'PATTERN_SCANNER',
  direction: 'BUY' | 'SELL',
  smc?: SmcAgentAnalysis | null,
  patternMoveType?: 'BREAKOUT' | 'BREAKDOWN' | 'COIL'
): MasterMoveType {
  if (sourceModule === 'PATTERN_SCANNER') {
    if (patternMoveType === 'BREAKOUT') return 'BREAKOUT';
    if (patternMoveType === 'BREAKDOWN') return 'BREAKDOWN';
    return direction === 'BUY' ? 'BREAKOUT' : 'BREAKDOWN';
  }
  if (smc) {
    if (direction === 'BUY' && (smc.structure.lastEvent === 'BOS' || smc.structure.lastEvent === 'CHoCH') && smc.structure.eventDirection === 'Bullish') {
      return 'BREAKOUT';
    }
    if (direction === 'SELL' && (smc.structure.lastEvent === 'BOS' || smc.structure.lastEvent === 'CHoCH') && smc.structure.eventDirection === 'Bearish') {
      return 'BREAKDOWN';
    }
    if (sourceModule === 'SMC_FRVP') {
      return 'SMC_STRUCTURE';
    }
  }
  return 'TREND_MOMENTUM';
}

function computePlanMaxRR(plan: CoordinatedTradePlan): number {
  return Number(Math.max(...plan.riskPlan.dynamicRRs, 0).toFixed(2));
}

function findMatchingPositions(symbol: string, positions: SandboxPosition[]): {
  active: SandboxPosition | null;
  latestClosed: SandboxPosition | null;
} {
  let active: SandboxPosition | null = null;
  let latestClosed: SandboxPosition | null = null;
  for (const pos of positions) {
    if (pos.symbol !== symbol) continue;
    if (pos.status === 'OPEN' && !active) {
      active = pos;
    } else if (pos.status !== 'OPEN' && !latestClosed) {
      latestClosed = pos;
    }
  }
  return { active, latestClosed };
}

/**
 * Evaluates all pairs across AI Engine, multi-coin SMC + FRVP, and Breakout/Breakdown
 * Pattern Scanners, orchestrating each candidate through the Multi-Agent Coordinator
 * while enriching setups with Top Gainer priority and synchronous Testnet positions.
 */
export function buildMasterCoordinatorSetups(
  input: BuildMasterCoordinatorInput
): MasterCoordinatorBuildResult {
  const coins =
    input.allKnownCoins && input.allKnownCoins.length > 0
      ? input.allKnownCoins
      : TRACKED_COINS;
  const topGainers = input.topGainers ?? [];
  const newsItems =
    input.newsItems && input.newsItems.length > 0 ? input.newsItems : DEFAULT_NEWS_FEED;
  const positions = input.positions ?? [];
  const whaleFlowsMap = input.whaleFlowsMap ?? {};
  const futuresTelemetry = input.futuresTelemetry ?? {};
  const orderBookDepthMap = input.orderBookDepthMap ?? {};
  const sentinelBySymbol = input.sentinelBySymbol ?? {};
  const evalSec = input.evaluationTimeSec ?? Math.floor(Date.now() / 60_000) * 60;

  const gainerLookup = new Map<string, { rank: number; change24hPercent: number }>();
  topGainers.forEach((g, idx) => {
    gainerLookup.set(g.symbol, {
      rank: g.gainerRank || idx + 1,
      change24hPercent: g.change24hPercent,
    });
  });

  const planBaseOptions = {
    futuresEnabled: Boolean(input.planOptions?.futuresEnabled),
    notionalUsd: input.planOptions?.notionalUsd ?? 1500,
    manualLeverage: input.planOptions?.manualLeverage ?? 10,
    scalingMode: input.planOptions?.scalingMode ?? ('AUTO_VOLATILITY' as LeverageScalingMode),
    marginMode: input.planOptions?.marginMode ?? ('CROSS' as MarginMode),
    crossAvailableBalanceUsd: input.planOptions?.crossAvailableBalanceUsd ?? 25000,
  };

  // 0. Ensure working candles reflect active live WebSocket feed ticks rather than static candle closes
  const liveTickers = input.liveTickers ?? {};
  const liveCandlesMap: Record<string, Candle[]> = {};
  for (const [sym, candles] of Object.entries(input.candlesMap)) {
    const tk = liveTickers[sym];
    liveCandlesMap[sym] =
      tk && tk.isLiveWs && Number.isFinite(tk.price) && tk.price > 0
        ? applyLiveSnapshotToCandles(candles, tk.price)
        : candles;
  }

  // 1. Run SMC & FRVP across ALL pairs in liveCandlesMap
  const smcBySymbol: Record<string, SmcAgentAnalysis> = {};
  for (const coin of coins) {
    const candles = liveCandlesMap[coin.symbol];
    if (!candles || candles.length < 20) continue;
    const tk = liveTickers[coin.symbol];
    const liveWsPrice = tk?.isLiveWs && tk.price > 0 ? tk.price : undefined;
    smcBySymbol[coin.symbol] = runSmcVolumeProfileAgent(
      coin.symbol,
      coin.name,
      candles,
      undefined,
      evalSec,
      liveWsPrice
    );
  }

  // 2. Run Breakout & Breakdown Pattern Scanner across ALL pairs
  const scannerParams: PatternScannerParams = {
    ...DEFAULT_PATTERN_SCANNER_PARAMS,
    timeframe: input.timeframe,
    minConfidence: input.scannerOverrides?.minConfidence ?? 68,
    signalMode: input.scannerOverrides?.signalMode ?? 'BOTH',
    minVolumeMultiplier: input.scannerOverrides?.minVolumeMultiplier ?? 1.25,
    minClosePercentBeyondLevel: input.scannerOverrides?.minClosePercentBeyondLevel ?? 0.15,
    riskRewardTarget: input.scannerOverrides?.riskRewardTarget ?? 3,
    strictFakeoutFilter: input.scannerOverrides?.strictFakeoutFilter ?? true,
  };
  const patternSummary = scanMarketPatterns(liveCandlesMap, scannerParams, coins);

  // 3. Run full-universe AI Engine evaluation with live WebSocket ticker snapshots
  const aiSignals = generateTopSignals(
    liveCandlesMap,
    newsItems,
    coins.length,
    coins,
    topGainers,
    liveTickers
  );

  const setups: MasterCoordinatorSetup[] = [];
  const seenPlanKeys = new Set<string>();

  const registerSetup = (setup: MasterCoordinatorSetup) => {
    if (seenPlanKeys.has(setup.id)) return;
    seenPlanKeys.add(setup.id);
    setups.push(setup);
  };

  // Integrate AI Engine plans
  for (const sig of aiSignals) {
    const candles =
      input.candlesMap[sig.symbol] ||
      generateDeterministicCandles(sig.symbol, input.timeframe, 120, undefined, sig.entryPrice);
    const futuresEnabled = Boolean(planBaseOptions.futuresEnabled);
    const plan = coordinateMultiAgentTrade(
      sig,
      candles,
      newsItems,
      whaleFlowsMap[sig.symbol],
      futuresEnabled ? futuresTelemetry[sig.symbol] : undefined,
      {
        ...planBaseOptions,
        sourceModule: 'AI_ENGINE',
        sourceLabel: sig.isTopGainer ? `AI Coordinator · Top #${sig.gainerRank}` : 'AI Coordinator',
        orderBookDepth: orderBookDepthMap[sig.symbol],
        sentinelAssessment: sentinelBySymbol[sig.symbol],
      }
    );
    const smc = smcBySymbol[sig.symbol] ?? null;
    const gainerInfo = gainerLookup.get(sig.symbol);
    const matchedPos = findMatchingPositions(sig.symbol, positions);

    registerSetup({
      id: plan.id,
      symbol: sig.symbol,
      coinName: sig.coinName,
      direction: sig.direction,
      sourceModule: 'AI_ENGINE',
      moveType: deriveMoveTypeForPlan('AI_ENGINE', sig.direction, smc),
      confidence: plan.confidence,
      entryPrice: plan.entryPrice,
      trailingStopLoss: plan.riskPlan.trailingStopLoss,
      takeProfits: plan.riskPlan.takeProfits,
      tp1RiskReward: plan.riskPlan.dynamicRRs[0] ?? 1.5,
      maxRiskReward: computePlanMaxRR(plan),
      plan,
      smc: smc ? toSmcTelemetry(smc) : null,
      frvp: smc ? toFrvpTelemetry(smc) : null,
      pattern: null,
      isTopGainer: Boolean(gainerInfo || sig.isTopGainer),
      gainerRank: gainerInfo?.rank ?? sig.gainerRank ?? null,
      change24hPercent: gainerInfo?.change24hPercent ?? sig.change24hPercent ?? null,
      activePosition: matchedPos.active,
      latestClosedPosition: matchedPos.latestClosed,
      orderBookDepth: orderBookDepthMap[sig.symbol] ?? null,
      sentinel: sentinelBySymbol[sig.symbol] ?? null,
    });
  }

  // Integrate SMC + FRVP setups across all scanned coins
  for (const smc of Object.values(smcBySymbol)) {
    const candles =
      input.candlesMap[smc.symbol] ||
      generateDeterministicCandles(smc.symbol, input.timeframe, 120, undefined, smc.entryPrice);
    const smcSignal = smcAnalysisToTradingSignal(smc, candles, newsItems);
    const futuresEnabled = Boolean(planBaseOptions.futuresEnabled);
    const plan = coordinateMultiAgentTrade(
      smcSignal,
      candles,
      newsItems,
      whaleFlowsMap[smc.symbol],
      futuresEnabled ? futuresTelemetry[smc.symbol] : undefined,
      {
        ...planBaseOptions,
        sourceModule: 'SMC_FRVP',
        sourceLabel: `SMC · ${smc.zoneLabel}`,
        orderBookDepth: orderBookDepthMap[smc.symbol],
        sentinelAssessment: sentinelBySymbol[smc.symbol],
      }
    );
    const gainerInfo = gainerLookup.get(smc.symbol);
    const matchedPos = findMatchingPositions(smc.symbol, positions);

    registerSetup({
      id: plan.id,
      symbol: smc.symbol,
      coinName: smc.coinName,
      direction: smc.direction,
      sourceModule: 'SMC_FRVP',
      moveType: deriveMoveTypeForPlan('SMC_FRVP', smc.direction, smc),
      confidence: plan.confidence,
      entryPrice: plan.entryPrice,
      trailingStopLoss: plan.riskPlan.trailingStopLoss,
      takeProfits: plan.riskPlan.takeProfits,
      tp1RiskReward: plan.riskPlan.dynamicRRs[0] ?? 1.5,
      maxRiskReward: computePlanMaxRR(plan),
      plan,
      smc: toSmcTelemetry(smc),
      frvp: toFrvpTelemetry(smc),
      pattern: null,
      isTopGainer: Boolean(gainerInfo),
      gainerRank: gainerInfo?.rank ?? null,
      change24hPercent: gainerInfo?.change24hPercent ?? null,
      activePosition: matchedPos.active,
      latestClosedPosition: matchedPos.latestClosed,
      orderBookDepth: orderBookDepthMap[smc.symbol] ?? null,
      sentinel: sentinelBySymbol[smc.symbol] ?? null,
    });
  }

  // Integrate confirmed Breakout & Breakdown Pattern Scanner setups
  for (const pat of patternSummary.confirmedSignals) {
    const candles =
      input.candlesMap[pat.symbol] ||
      generateDeterministicCandles(pat.symbol, input.timeframe, 120, undefined, pat.entryPrice);
    const patSignal = patternResultToTradingSignal(pat, candles, newsItems);
    const futuresEnabled = Boolean(planBaseOptions.futuresEnabled);
    const plan = coordinateMultiAgentTrade(
      patSignal,
      candles,
      newsItems,
      whaleFlowsMap[pat.symbol],
      futuresEnabled ? futuresTelemetry[pat.symbol] : undefined,
      {
        ...planBaseOptions,
        sourceModule: 'PATTERN_SCANNER',
        sourceLabel: `Pattern · ${pat.patternName} (${pat.moveType})`,
        orderBookDepth: orderBookDepthMap[pat.symbol],
        sentinelAssessment: sentinelBySymbol[pat.symbol],
      }
    );
    const smc = smcBySymbol[pat.symbol] ?? null;
    const gainerInfo = gainerLookup.get(pat.symbol);
    const matchedPos = findMatchingPositions(pat.symbol, positions);

    registerSetup({
      id: plan.id,
      symbol: pat.symbol,
      coinName: pat.coinName,
      direction: pat.direction,
      sourceModule: 'PATTERN_SCANNER',
      moveType: deriveMoveTypeForPlan('PATTERN_SCANNER', pat.direction, smc, pat.moveType),
      confidence: plan.confidence,
      entryPrice: plan.entryPrice,
      trailingStopLoss: plan.riskPlan.trailingStopLoss,
      takeProfits: plan.riskPlan.takeProfits,
      tp1RiskReward: plan.riskPlan.dynamicRRs[0] ?? 1.5,
      maxRiskReward: computePlanMaxRR(plan),
      plan,
      smc: smc ? toSmcTelemetry(smc) : null,
      frvp: smc ? toFrvpTelemetry(smc) : null,
      pattern: {
        patternName: pat.patternName,
        moveType: pat.moveType,
        breakoutLevel: pat.breakoutLevel,
        volumeRatio: pat.volumeRatio,
        closeBeyondPercent: pat.closeBeyondPercent,
        passedChecks: pat.passedChecks,
        summary: pat.summary,
      },
      isTopGainer: Boolean(gainerInfo),
      gainerRank: gainerInfo?.rank ?? null,
      change24hPercent: gainerInfo?.change24hPercent ?? null,
      activePosition: matchedPos.active,
      latestClosedPosition: matchedPos.latestClosed,
      orderBookDepth: orderBookDepthMap[pat.symbol] ?? null,
      sentinel: sentinelBySymbol[pat.symbol] ?? null,
    });
  }

  return {
    allSetups: sortMasterSetups(setups),
    patternSummary,
    smcBySymbol,
  };
}

export function sortMasterSetups(setups: MasterCoordinatorSetup[]): MasterCoordinatorSetup[] {
  const verdictWeight = (v: CoordinatedTradePlan['skeptic']['verdict']) =>
    v === 'APPROVED' ? 2 : v === 'CAUTION' ? 1 : 0;

  return setups.slice().sort((a, b) => {
    // 1. Prioritize APPROVED > CAUTION > VETOED
    const vDiff = verdictWeight(b.plan.skeptic.verdict) - verdictWeight(a.plan.skeptic.verdict);
    if (vDiff !== 0) return vDiff;

    // 2. Prioritize higher confidence
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;

    // 3. Prioritize Top Gainers next
    if (a.isTopGainer !== b.isTopGainer) return a.isTopGainer ? -1 : 1;

    // 4. Prioritize higher Max R:R
    if (b.maxRiskReward !== a.maxRiskReward) return b.maxRiskReward - a.maxRiskReward;

    // 5. Deterministic tie-breaker
    return a.id.localeCompare(b.id);
  });
}

/**
 * Applies strict Master Coordinator filtering thresholds for confidence (>=86% default),
 * Risk-to-Reward ratio, module source, Breakout/Breakdown classification, direction, and Skeptic audit.
 */
export function filterMasterCoordinatorSetups(
  setups: MasterCoordinatorSetup[],
  filters: MasterSignalFilterConfig
): MasterCoordinatorSetup[] {
  const filtered = setups.filter((s) => {
    if (s.confidence < filters.minConfidence) return false;
    if (s.maxRiskReward < filters.minRiskReward) return false;
    if (filters.moduleFilter !== 'ALL' && s.sourceModule !== filters.moduleFilter) return false;
    if (filters.moveFilter !== 'ALL' && s.moveType !== filters.moveFilter) return false;
    if (filters.directionFilter !== 'ALL' && s.direction !== filters.directionFilter) return false;
    if (filters.topGainersOnly && !s.isTopGainer) return false;
    if (filters.excludeVetoed && s.plan.skeptic.verdict === 'VETOED') return false;
    return true;
  });

  return sortMasterSetups(filtered);
}

export function summarizeMasterCoordinator(
  allSetups: MasterCoordinatorSetup[],
  qualifiedSetups: MasterCoordinatorSetup[],
  patternSummary: MarketPatternScanSummary
): MasterAggregationSummary {
  return {
    totalEvaluatedSetups: allSetups.length,
    qualifiedCount: qualifiedSetups.length,
    breakoutCount: qualifiedSetups.filter((s) => s.moveType === 'BREAKOUT').length,
    breakdownCount: qualifiedSetups.filter((s) => s.moveType === 'BREAKDOWN').length,
    smcFrvpQualifiedCount: qualifiedSetups.filter((s) => s.sourceModule === 'SMC_FRVP').length,
    hvnConfirmedCount: qualifiedSetups.filter((s) => s.frvp?.institutionalLiquidityConfirmed).length,
    topGainerQualifiedCount: qualifiedSetups.filter((s) => s.isTopGainer).length,
    scannerTelemetry: {
      scannedPairs: patternSummary.scannedCount,
      confirmedPatterns: patternSummary.confirmedSignals.length,
      filteredFakeouts: patternSummary.filteredFakeouts.length,
      watchingCoils: patternSummary.watchingCoils.length,
    },
  };
}

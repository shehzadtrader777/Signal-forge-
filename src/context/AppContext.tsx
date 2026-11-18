import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { type User } from 'firebase/auth';
import {
  TRACKED_COINS,
  fetchCoinCandles,
  formatCryptoPrice,
  generateDeterministicCandles,
  type Candle,
  type CoinMeta,
  type GainerAlertEvent,
  type TickerSnapshot,
  type Timeframe,
  type TopGainerCoin,
} from '../lib/marketData';
import {
  subscribeAuth,
  subscribeWatchlist,
  subscribePriceAlerts,
  addWatchlistItem,
  removeWatchlistItem,
  createPriceAlert,
  updatePriceAlertStatus,
  deletePriceAlert,
  syncUserProfile,
  testFirestoreConnection,
  subscribeWorkspaceControlConfig,
  saveWorkspaceControlConfig,
  saveRollbackCheckpointToFirestore,
  saveErrorAuditToFirestore,
  type UserWatchlistEntry,
  type UserPriceAlert,
} from '../lib/firebase';
import {
  advanceAtrTrailingStop,
  summarizeCrossMarginWallet,
  type AppNotificationItem,
  type CoordinatedTradePlan,
  type CrossMarginWalletSummary,
  type ExecutionEnvironment,
  type FuturesTickerTelemetry,
  type MarginMode,
  type SandboxPosition,
} from '../lib/coordinator';
import { DEFAULT_NEWS_FEED, type NewsItem, type TradingSignal } from '../lib/signals';
import {
  MAX_PINNED_SIGNALS,
  evaluatePinnedSignalsLiveOutcome,
  rotateResolvedPinnedSignals,
  sanitizePinnedSignals,
  syncPinnedSignals,
  type PinnedSignalRecord,
} from '../lib/pinnedSignals';
import {
  MAX_WS_RECONNECT_ATTEMPTS,
  computeExponentialReconnectDelayMs,
  type BackendHealthSnapshot,
  type BackendIntelligenceEvaluation,
  type StructuredPerformanceReport,
} from '../lib/monitorAgent';
import { apiFetch } from '../lib/apiClient';
import {
  DEFAULT_PORTFOLIO_SEEDS,
  DEFAULT_REBALANCE_CONFIG,
  DEFAULT_STABLECOIN_RESERVE_USD,
  evaluateMultiAssetPortfolio,
  normalizeRebalanceConfig,
  type PortfolioEvaluationResult,
  type PortfolioHoldingSeed,
  type PortfolioRebalanceConfig,
  type RebalanceExecutionRecord,
} from '../lib/portfolioManager';
import { type QueuedSignalAlert } from '../lib/emailDigest';
import {
  TELEMETRY_POLL_INTERVAL_MS,
  WS_FLUSH_INTERVAL_MS,
  WsFrameBuffer,
  buildDeterministicTickerSnapshot,
  createInitialLatencyMetrics,
  updateLatencyMetrics,
  type TelemetryLatencyMetrics,
} from '../lib/telemetrySync';
import {
  type CmcBaselineValuation,
  type SpotCmcValidationResult,
} from '../lib/spotCmcValidator';
import {
  DEFAULT_DRIFT_THRESHOLD_PCT,
  LiveWsFeedController,
  computePriceDiscrepancyPct,
  reconcileCandleSeriesToLivePrice,
  reconcilePinnedSignalsToLiveFeed,
  type ReconciliationAuditEvent,
  type ReconciliationTelemetrySnapshot,
} from '../lib/wsDataEngine';
import {
  APP_LIVE_STORAGE_KEY,
  DEFAULT_SYSTEM_CONTROLS,
  SYSTEM_CONTROLS_STORAGE_KEY,
  parseSystemControls,
  shouldSyncMonitorHealthUi,
  type ActiveRuntimePlanes,
  type SystemRuntimeControls,
} from '../lib/systemControls';
import type { MultiExchangeDepthAnalysis } from '../lib/orderBookDepth';
import type { CrossPlatformFeedSignal, SentinelAssessment } from '../lib/sentinelAgent';
import {
  DEFAULT_VOICE_AGENT_STATE,
  VOICE_AGENT_STORAGE_KEY,
  parseVoiceCommandTranscript,
  type VoiceAgentLogEntry,
  type VoiceAgentState,
  type VoiceListeningMode,
} from '../lib/voiceCommandAgent';
import {
  INITIAL_RL_TUNING_STATE,
  type EmergencyLiquidationSummary,
  type RlAutoTuningState,
} from '../lib/autonomousSafeguards';
import {
  INITIAL_INSTITUTIONAL_ACCOUNTS,
  type ArbitrageExecutionRecord,
  type ArbitrageOpportunity,
  type InstitutionalCopyAccount,
  type MirroredCopyTradePlan,
} from '../lib/arbitrageAndCopyTrading';
import {
  buildUnifiedCapitalLedgerState,
  createInitialForgeCapitalHubState,
  engageImmutableFailSafe,
  estimateMarketVolatilityPct,
  reconcileForgeCapitalState,
  recordForgeApiError,
  type DualExecutionRouteRecord,
  type ForgeCapitalHubState,
  type ForgeConfigPatch,
  type ForgeMarketChannel,
  type ForgeModuleId,
  type UnifiedCapitalLedgerState,
} from '../lib/forgeCapitalHub';
import {
  DEFAULT_CONTROL_MATRIX,
  DESCRIPTOR_BY_KEY,
  applySystemControlsToMatrix,
  derivePlanesFromMatrix,
  matrixToSystemControls,
  parseGranularControlMatrix,
  type CapabilityClass,
  type GranularControlMatrix,
  type GranularToggleKey,
  type MicroserviceId,
} from '../lib/controlMatrix';
import {
  UNAUTHENTICATED_PRINCIPAL,
  maskPrincipalSummary,
} from '../lib/subscriptionGatekeeper';
import {
  createInitialPlatformState,
  type ErrorSeverity,
  type FailoverNodeRole,
  type MicroservicePlatformState,
} from '../lib/microserviceArchitecture';

export interface WsVerificationSnapshot {
  ok: boolean;
  appLiveEnabled: boolean;
  liveFeedModulesEnabled: boolean;
  spotWsConnected: boolean;
  wsReadyState: number | null;
  wsEndpointHost: string;
  totalWsFrames: number;
  depthWsFramesCount: number;
  closedCandlesCount: number;
  frameAgeMs: number;
  spotFeedSource: string;
  futuresFeedSource: string;
  sseSubscribers: number;
  verifiedAt: string;
}

export interface AutonomousDecisionItem {
  id: string;
  symbol: string;
  action:
    | 'ENTRY_SPOT'
    | 'ENTRY_FUTURES'
    | 'HEDGE_SHORT'
    | 'EXIT_REVERSAL'
    | 'EXIT_5X_ATR_TP'
    | 'EXIT_5PCT_SL_CAP'
    | 'EXIT_TRAIL_SL'
    | 'EMERGENCY_LIQUIDATION'
    | 'ARBITRAGE_CAPTURE'
    | 'COPY_MIRROR';
  direction: 'BUY' | 'SELL';
  price: number;
  leverage: number;
  reason: string;
  pnlUsd?: number;
  timestamp: string;
}

export interface AutonomousCoordinatorSnapshot {
  enabled: boolean;
  lastTickAt: string | null;
  totalCycles: number;
  entriesExecuted: number;
  exitsExecuted: number;
  hedgesExecuted: number;
  reversalExitsExecuted: number;
  spotActiveCount: number;
  futuresActiveCount: number;
  maxStopLossCapPct: number;
  trailingTakeProfitAtrMultiplier: number;
  decisionsLog: AutonomousDecisionItem[];
}

export interface LocalPriceAlert {
  id: string;
  symbol: string;
  condition: 'ABOVE' | 'BELOW';
  targetPrice: number;
  active: boolean;
  triggered: boolean;
  emailNotify: boolean;
  createdAt: string;
}

export interface TelegramChannelPost {
  id: string;
  channelName: string;
  symbol: string;
  direction: 'BUY' | 'SELL' | 'SUMMARY';
  confidence?: number;
  message: string;
  deliveredViaBot: boolean;
  timestamp: string;
}

export interface ExecutionEnvironmentState {
  mode: ExecutionEnvironment;
  marketType: 'SPOT' | 'USD_M_FUTURES';
  marginMode: MarginMode;
  endpoint: string;
  testnetConfigured: boolean;
  liveConfigured: boolean;
  testnetBalanceUsd: number;
  crossMargin: CrossMarginWalletSummary;
  positions: SandboxPosition[];
  totalExecutedOrders: number;
  warning: string | null;
}

export interface LiveOtpChallengeState {
  challengeId: string;
  recipient: string;
  expiresAt: string;
  emailSent: boolean;
  deliveryMode?: 'email' | 'server_log';
}

export interface DigestStatusSnapshot {
  intervalHours: number;
  pendingCount: number;
  pendingSignals: QueuedSignalAlert[];
  lastDigestSentAt: string | null;
  nextScheduledAt: string;
  remainingMs: number;
  totalBatchedAllTime: number;
  totalDigestsDispatched: number;
  individualEmailsPrevented: number;
}

export interface ExecutionRouteDraft {
  symbol: string;
  direction: 'BUY' | 'SELL';
  market: ForgeMarketChannel;
  moduleId: ForgeModuleId;
  leverage: number;
  notionalUsd: number;
  stopLoss?: number;
  trailingStopLoss?: number;
  trailingAtrMultiplier?: number;
  takeProfits?: [number, number, number];
  prePumpScore?: number;
  sourceLabel?: string;
  requestedAt: number;
}

interface AppContextValue {
  user: User | null;
  authReady: boolean;
  tickers: Record<string, TickerSnapshot>;
  wsConnected: boolean;
  selectedSymbol: string;
  setSelectedSymbol: (symbol: string) => void;
  allKnownCoins: CoinMeta[];
  topGainers: TopGainerCoin[];
  gainerSource: 'binance' | 'cache';
  gainerUpdatedAt: string | null;
  gainerAlerts: GainerAlertEvent[];
  gainerLoading: boolean;
  refreshTopGainers: (force?: boolean) => Promise<void>;
  // Binance Spot Primary Feed + CMC Baseline Valuations + Optional Manual Futures Toggle
  futuresTradingEnabled: boolean;
  setFuturesTradingEnabled: (enabled: boolean) => void;
  spotFeedSource: 'binance_spot' | 'spot_cache';
  cmcValuations: Record<string, CmcBaselineValuation>;
  cmcSource: 'cmc_api' | 'unavailable';
  spotCmcValidations: Record<string, SpotCmcValidationResult>;
  refreshSpotFeed: (force?: boolean) => Promise<void>;
  refreshCmcValuations: (force?: boolean) => Promise<void>;
  futuresTelemetry: Record<string, FuturesTickerTelemetry>;
  futuresFeedSource: 'binance_futures' | 'futures_cache';
  refreshFuturesFeed: (force?: boolean) => Promise<void>;
  // Master Performance, App Live Kill Switch & System On/Off Controls
  appLiveEnabled: boolean;
  setAppLiveEnabled: (enabled: boolean) => Promise<void>;
  appLiveMeta: { quotaSavedCalls: number; toggledAt: string | null };
  testnetExecutionEnabled: boolean;
  setTestnetExecutionEnabled: (enabled: boolean) => void;
  liveFeedModulesEnabled: boolean;
  setLiveFeedModulesEnabled: (enabled: boolean) => void;
  runtimePlanes: ActiveRuntimePlanes;
  // Recalibrated Telemetry, Autonomous Monitoring & Decoupled WS Reconciliation Engine
  telemetryMetrics: TelemetryLatencyMetrics;
  reconciliationTelemetry: ReconciliationTelemetrySnapshot;
  reportPriceReconciliation: (
    event: Omit<ReconciliationAuditEvent, 'id' | 'timestamp'>
  ) => void;
  monitorHealth: BackendHealthSnapshot | null;
  syncVersion: number;
  resyncing: boolean;
  resyncAllTelemetry: () => Promise<void>;
  triggerAlertBanner: (message: string) => void;
  watchlist: string[];
  toggleWatchlist: (symbol: string) => Promise<void>;
  priceAlerts: LocalPriceAlert[];
  addPriceAlert: (input: {
    symbol: string;
    condition: 'ABOVE' | 'BELOW';
    targetPrice: number;
    emailNotify: boolean;
  }) => Promise<void>;
  removePriceAlert: (id: string) => Promise<void>;
  // Strict Notification Center
  notifications: AppNotificationItem[];
  unreadNotificationCount: number;
  pushNotification: (
    item: Omit<AppNotificationItem, 'id' | 'read' | 'timestamp'>
  ) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: () => void;
  // Top 3–5 Pinned Signals Locked Until Final Outcome
  pinnedSignals: PinnedSignalRecord[];
  syncPinnedCandidates: (
    candidates: TradingSignal[],
    candlesMap: Record<string, Candle[]>
  ) => void;
  rotateResolvedPinned: (
    candidates: TradingSignal[],
    candlesMap: Record<string, Candle[]>
  ) => void;
  // Offloaded Backend Intelligence Evaluations & Coordinator Selection
  backendEvaluations: Record<string, BackendIntelligenceEvaluation>;
  evaluateBackendIntelligence: (symbols: string[]) => Promise<void>;
  focusedCoordinatorPlanId: string | null;
  focusCoordinatorPlan: (planId: string) => void;
  // "Signal Forge" Telegram Channel
  telegramFeed: TelegramChannelPost[];
  telegramHandle: string;
  telegramBotConfigured: boolean;
  refreshTelegramFeed: () => Promise<void>;
  routeSignalToTelegram: (plan: CoordinatedTradePlan, manual?: boolean) => Promise<boolean>;
  // Binance Futures Cross-Margin Sandbox + Security-Gated Live Switch (exclusive in Side Menu)
  executionState: ExecutionEnvironmentState;
  hasSwitchedLiveOnce: boolean;
  executionRouteDraft: ExecutionRouteDraft | null;
  setExecutionRouteDraft: React.Dispatch<React.SetStateAction<ExecutionRouteDraft | null>>;
  liveCrossMargin: CrossMarginWalletSummary;
  refreshExecutionState: () => Promise<void>;
  switchExecutionMode: (mode: ExecutionEnvironment) => Promise<void>;
  requestLiveSwitchOtp: () => Promise<{
    ok: boolean;
    challenge?: LiveOtpChallengeState;
    error?: string;
  }>;
  confirmSwitchToLive: (params: {
    challengeId: string;
    securityAnswer: string;
    otpCode: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  executeCoordinatorOrder: (
    plan: CoordinatedTradePlan,
    options?: {
      notionalUsd?: number;
      leverage?: number;
      marginMode?: MarginMode;
    }
  ) => Promise<{ ok: boolean; error?: string }>;
  closeSandboxPosition: (positionId: string, currentPrice: number) => Promise<void>;
  settleCrossMarginCycle: () => Promise<void>;
  // Shared Signal & Coordinator Market Scan State (4s throttled snapshot)
  signalTimeframe: Timeframe;
  setSignalTimeframe: (tf: Timeframe) => void;
  autoScanEnabled: boolean;
  setAutoScanEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  candlesMap: Record<string, Candle[]>;
  liveCandlesMap: Record<string, Candle[]>;
  signalTickers: Record<string, TickerSnapshot>;
  newsItems: NewsItem[];
  scanningMarkets: boolean;
  runSharedSignalScan: (tf?: Timeframe) => Promise<void>;
  registerChartCandles: (symbol: string, loaded: Candle[]) => void;
  // Structured Daily / Weekly / Monthly Auto-Reports + Strict 3-Hour Signal Digest Dispatch
  autoReports: StructuredPerformanceReport[];
  refreshAutoReports: () => Promise<void>;
  dispatchPerformanceReport: (
    period: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  ) => Promise<{ ok: boolean; summary?: string }>;
  digestStatus: DigestStatusSnapshot | null;
  refreshDigestStatus: () => Promise<void>;
  dispatchSignalDigestNow: () => Promise<{ ok: boolean; summary?: string }>;
  // Multi-Exchange L2 Order Book Depth, Sentinel Agent & Zero-Intervention Autonomous Coordinator
  orderBookDepth: Record<string, MultiExchangeDepthAnalysis>;
  refreshOrderBookDepth: (symbol?: string, force?: boolean) => Promise<void>;
  sentinelBySymbol: Record<string, SentinelAssessment>;
  sentinelFeed: CrossPlatformFeedSignal[];
  triggerSentinelAudit: (input?: {
    symbol?: string;
    headline?: string;
    sentiment?: 'BULLISH' | 'BEARISH';
    platform?: CrossPlatformFeedSignal['platform'];
  }) => Promise<void>;
  autonomousState: AutonomousCoordinatorSnapshot;
  toggleAutonomousCoordinator: (enabled?: boolean) => Promise<void>;
  runAutonomousCycleNow: () => Promise<void>;
  // AI RL Auto-Tuning, Emergency Stablecoin Liquidation, Multi-Exchange Arbitrage & Institutional Copy Trading
  rlTuning: RlAutoTuningState;
  triggerRlAutoTune: () => Promise<void>;
  emergencyLiquidation: EmergencyLiquidationSummary;
  triggerEmergencyLiquidation: (
    stablecoinAsset?: 'USDT' | 'USDC',
    reason?: string
  ) => Promise<{ ok: boolean; liquidatedCount?: number }>;
  arbitrageOpportunities: ArbitrageOpportunity[];
  arbitrageExecutions: ArbitrageExecutionRecord[];
  executeArbitrage: (opportunityId?: string) => Promise<{ ok: boolean; error?: string }>;
  copyAccounts: InstitutionalCopyAccount[];
  mirroredCopyHistory: MirroredCopyTradePlan[];
  toggleCopyAccount: (accountId: string, enabled?: boolean) => Promise<void>;
  mirrorCopyTrade: (
    accountId: string,
    symbol: string,
    direction: 'BUY' | 'SELL'
  ) => Promise<{ ok: boolean }>;
  wsVerification: WsVerificationSnapshot | null;
  refreshWsVerification: () => Promise<void>;
  // Multi-Asset Portfolio & Volatility Auto-Rebalancer
  portfolioEvaluation: PortfolioEvaluationResult;
  portfolioHoldings: PortfolioHoldingSeed[];
  portfolioReserveUsd: number;
  portfolioConfig: PortfolioRebalanceConfig;
  portfolioRebalanceHistory: RebalanceExecutionRecord[];
  portfolioBusy: boolean;
  updatePortfolioConfig: (patch: Partial<PortfolioRebalanceConfig>) => Promise<void>;
  updatePortfolioHoldingUnits: (symbol: string, units: number, reserveUsd?: number) => Promise<void>;
  executePortfolioRebalanceNow: () => Promise<void>;
  resetPortfolioBaseline: () => Promise<void>;
  // Dedicated Voice Command Agent
  voiceAgent: VoiceAgentState;
  setVoiceMode: (mode: VoiceListeningMode) => void;
  startPushToTalk: () => void;
  stopVoiceListening: () => void;
  executeVoiceCommand: (
    transcript: string,
    confidence?: number
  ) => Promise<{ intent: string; summary: string; routeTarget?: string }>;
  // Forge Capital Hub — 10-15% Portfolio Fail-Safe & 3-5% Volatility-Calibrated Dual Spot/Futures Router
  forgeCapitalState: ForgeCapitalHubState;
  unifiedCapitalLedger: UnifiedCapitalLedgerState;
  forgeCapitalBusy: boolean;
  refreshForgeCapitalState: () => Promise<void>;
  updateForgeCapitalLimits: (patch: ForgeConfigPatch) => Promise<void>;
  reconcileForgeCapitalNow: (submittedBaselineEquityUsd?: number) => Promise<void>;
  routeForgeCapitalOrder: (params: {
    moduleId: ForgeModuleId;
    market: ForgeMarketChannel;
    symbol: string;
    direction: 'BUY' | 'SELL';
    notionalUsd: number;
    leverage?: number;
    marginMode?: MarginMode;
    submittedPrice?: number;
  }) => Promise<{ ok: boolean; error?: string; routeRecord?: DualExecutionRouteRecord }>;
  toggleForgeModuleStatus: (
    moduleId: ForgeModuleId,
    suspend: boolean,
    reason?: string
  ) => Promise<{ ok: boolean; error?: string }>;
  engageForgeFailSafeNow: (reason?: string) => Promise<void>;
  requestForgeFailsafeChallenge: () => Promise<{
    ok: boolean;
    challengeId?: string;
    sealId?: string;
    expiresAt?: string;
    deliveryMode?: 'email' | 'server_log';
    error?: string;
  }>;
  recoverForgeFailSafeNow: (
    confirmationCode: string,
    operatorReason: string,
    challengeId?: string
  ) => Promise<{ ok: boolean; error?: string }>;
  simulateForgeApiError: (input: {
    market: ForgeMarketChannel | 'SYSTEM';
    moduleId?: ForgeModuleId | 'SYSTEM';
    endpoint: string;
    httpStatus: number;
    exchangeCode?: string;
    message: string;
  }) => Promise<void>;
  // Decoupled Modular Microservices, Persistent 24-Toggle Control Matrix & Subscription Gatekeeper
  architectureState: MicroservicePlatformState;
  subscriptionSummary: ReturnType<typeof maskPrincipalSummary>;
  architectureBusy: boolean;
  architectureFeedback: { ok: boolean; text: string } | null;
  clearArchitectureFeedback: () => void;
  refreshArchitectureAndSubscription: () => Promise<void>;
  toggleControlMatrixKey: (
    key: GranularToggleKey,
    enabled?: boolean
  ) => Promise<{ ok: boolean; error?: string }>;
  triggerServiceFailover: (
    serviceId: MicroserviceId,
    targetNode: FailoverNodeRole,
    reason?: string
  ) => Promise<{ ok: boolean; error?: string }>;
  setMicroserviceLifecycle: (
    serviceId: MicroserviceId,
    lifecycle: 'ACTIVE' | 'ISOLATED' | 'DECOMMISSIONED',
    reason?: string
  ) => Promise<{ ok: boolean; error?: string }>;
  triggerRollbackSnapshot: (
    snapshotId: string,
    reason?: string
  ) => Promise<{ ok: boolean; error?: string }>;
  runFaultIsolationDrill: (input: {
    serviceId: MicroserviceId;
    severity?: ErrorSeverity;
    code?: string;
    message?: string;
    burstCount?: number;
  }) => Promise<{
    ok: boolean;
    error?: string;
    failoverTriggered?: boolean;
    rollbackTriggered?: boolean;
  }>;
  activatePremiumTier: () => Promise<{ ok: boolean; error?: string }>;
  downgradeToFreeTier: () => Promise<{ ok: boolean; error?: string }>;
}

const AppContext = createContext<AppContextValue | null>(null);

const WATCHLIST_STORAGE_KEY = 'sf_watchlist_v1';
const ALERTS_STORAGE_KEY = 'sf_alerts_v1';
const PINNED_SIGNALS_STORAGE_KEY = 'sf_pinned_signals_v1';

const DEFAULT_CROSS_SUMMARY: CrossMarginWalletSummary = {
  walletBalanceUsd: 25000,
  unrealizedPnlUsd: 0,
  crossEquityUsd: 25000,
  totalInitialMarginUsd: 0,
  totalMaintenanceMarginUsd: 0,
  availableCrossMarginUsd: 25000,
  crossMarginRatioPercent: 0,
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTCUSDT');
  const [tickers, setTickers] = useState<Record<string, TickerSnapshot>>(() =>
    buildDeterministicTickerSnapshot(TRACKED_COINS)
  );
  const [wsConnected, setWsConnected] = useState(false);

  // Recalibrated Telemetry & Buffer Flush State
  const [telemetryMetrics, setTelemetryMetrics] = useState<TelemetryLatencyMetrics>(
    createInitialLatencyMetrics
  );
  const [syncVersion, setSyncVersion] = useState(1);
  const [wsReconnectNonce, setWsReconnectNonce] = useState(0);
  const [resyncing, setResyncing] = useState(false);

  // Shared Signal Scan & 4s Throttled Market State (Shared cleanly between Dashboard & Signals Hub)
  const [signalTimeframe, setSignalTimeframe] = useState<Timeframe>('4h');
  const [autoScanEnabled, setAutoScanEnabled] = useState(true);
  const [candlesMap, setCandlesMap] = useState<Record<string, Candle[]>>(() => {
    const initial: Record<string, Candle[]> = {};
    for (const c of TRACKED_COINS) {
      initial[c.symbol] = generateDeterministicCandles(c.symbol, '4h', 120);
    }
    return initial;
  });
  const [newsItems, setNewsItems] = useState<NewsItem[]>(DEFAULT_NEWS_FEED);
  const [scanningMarkets, setScanningMarkets] = useState(false);
  const candlesMapRef = useRef(candlesMap);
  candlesMapRef.current = candlesMap;
  const attemptedGainerCandlesRef = useRef<Set<string>>(new Set());

  const [signalTickers, setSignalTickers] = useState<Record<string, TickerSnapshot>>(tickers);
  const latestTickersRef = useRef(tickers);
  latestTickersRef.current = tickers;
  const signalTickersWsSeededRef = useRef<Set<string>>(new Set());

  // Binance Top Gainers Feeder State
  const [topGainers, setTopGainers] = useState<TopGainerCoin[]>([]);
  const [gainerSource, setGainerSource] = useState<'binance' | 'cache'>('cache');
  const [gainerUpdatedAt, setGainerUpdatedAt] = useState<string | null>(null);
  const [gainerAlerts, setGainerAlerts] = useState<GainerAlertEvent[]>([]);
  const [gainerLoading, setGainerLoading] = useState(true);

  // Global 'App Live' Master Control Switch (Halts ALL operations + safeguards API quota when false)
  const [appLiveEnabled, setAppLiveEnabledState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(APP_LIVE_STORAGE_KEY);
      if (saved === 'false') return false;
    } catch {
      // ignore corrupted storage
    }
    return true;
  });
  const appLiveEnabledRef = useRef<boolean>(appLiveEnabled);
  appLiveEnabledRef.current = appLiveEnabled;
  const [appLiveMeta, setAppLiveMeta] = useState<{ quotaSavedCalls: number; toggledAt: string | null }>({
    quotaSavedCalls: 0,
    toggledAt: null,
  });

  // Centralized Decoupled Microservices, Persistent Toggle Matrix & Subscription Gatekeeper
  const [architectureState, setArchitectureState] = useState<MicroservicePlatformState>(() =>
    createInitialPlatformState(DEFAULT_CONTROL_MATRIX)
  );
  const architectureStateRef = useRef<MicroservicePlatformState>(architectureState);
  architectureStateRef.current = architectureState;

  const [subscriptionSummary, setSubscriptionSummary] = useState<
    ReturnType<typeof maskPrincipalSummary>
  >(() => maskPrincipalSummary(UNAUTHENTICATED_PRINCIPAL));
  const subscriptionSummaryRef = useRef(subscriptionSummary);
  subscriptionSummaryRef.current = subscriptionSummary;

  const [architectureBusy, setArchitectureBusy] = useState(false);
  const [architectureFeedback, setArchitectureFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const clearArchitectureFeedback = useCallback(() => setArchitectureFeedback(null), []);

  // Master Runtime Controls (Persisted + Derived in Sync with Control Matrix)
  const [systemControls, setSystemControls] = useState<SystemRuntimeControls>(() => {
    try {
      const saved = localStorage.getItem(SYSTEM_CONTROLS_STORAGE_KEY);
      if (saved) return parseSystemControls(JSON.parse(saved), DEFAULT_SYSTEM_CONTROLS);
    } catch {
      // ignore corrupted storage
    }
    return { ...DEFAULT_SYSTEM_CONTROLS };
  });
  const systemControlsRef = useRef<SystemRuntimeControls>(systemControls);
  systemControlsRef.current = systemControls;
  const testnetExecutionEnabled = systemControls.testnetExecutionEnabled;
  const liveFeedModulesEnabled = systemControls.liveFeedModulesEnabled;
  const runtimePlanes = useMemo(
    () => derivePlanesFromMatrix(architectureState.controlMatrix, appLiveEnabled),
    [architectureState.controlMatrix, appLiveEnabled]
  );

  // Binance Spot Priority (default) + CoinMarketCap Valuations + Optional Futures Toggle
  const [futuresTradingEnabled, setFuturesTradingEnabledState] = useState(false);
  const futuresTradingEnabledRef = useRef(false);
  futuresTradingEnabledRef.current = futuresTradingEnabled;

  const [spotFeedSource, setSpotFeedSource] = useState<'binance_spot' | 'spot_cache'>('spot_cache');
  const [cmcValuations, setCmcValuations] = useState<Record<string, CmcBaselineValuation>>({});
  const [cmcSource, setCmcSource] = useState<'cmc_api' | 'unavailable'>('unavailable');
  const [spotCmcValidations, setSpotCmcValidations] = useState<
    Record<string, SpotCmcValidationResult>
  >({});

  const [futuresTelemetry, setFuturesTelemetry] = useState<Record<string, FuturesTickerTelemetry>>(
    {}
  );
  const [futuresFeedSource, setFuturesFeedSource] = useState<'binance_futures' | 'futures_cache'>(
    'futures_cache'
  );

  const wsBufferRef = useRef<WsFrameBuffer>(new WsFrameBuffer());
  const wsControllerRef = useRef<LiveWsFeedController | null>(null);
  if (!wsControllerRef.current) {
    wsControllerRef.current = new LiveWsFeedController({
      buffer: wsBufferRef.current,
      coins: TRACKED_COINS,
      driftThresholdPct: DEFAULT_DRIFT_THRESHOLD_PCT,
      flushIntervalMs: WS_FLUSH_INTERVAL_MS,
    });
  }
  const [reconciliationTelemetry, setReconciliationTelemetry] =
    useState<ReconciliationTelemetrySnapshot>(() =>
      wsControllerRef.current!.getTelemetrySnapshot()
    );
  const lastReconUiSyncAtRef = useRef<number>(0);
  const candleSourceMapRef = useRef<Record<string, 'binance' | 'cache'>>({});
  const allKnownCoinsRef = useRef<CoinMeta[]>(TRACKED_COINS);
  const wsConnectedRef = useRef(false);
  wsConnectedRef.current = wsConnected;

  const [forgeCapitalState, setForgeCapitalState] = useState<ForgeCapitalHubState>(() =>
    createInitialForgeCapitalHubState({ initialEquityUsd: 25000, portfolioDrawdownLimitPct: 12.5 })
  );
  const [forgeCapitalBusy, setForgeCapitalBusy] = useState(false);
  const [hasSwitchedLiveOnce, setHasSwitchedLiveOnce] = useState(false);
  const [executionRouteDraft, setExecutionRouteDraft] = useState<ExecutionRouteDraft | null>(null);
  const forgeCapitalRef = useRef<ForgeCapitalHubState>(forgeCapitalState);
  forgeCapitalRef.current = forgeCapitalState;
  const lastForgeReconAtRef = useRef<number>(0);
  const spotFetchSeqRef = useRef<number>(0);
  const resyncSeqRef = useRef<number>(0);
  const scanSeqRef = useRef<number>(0);
  const scanAbortRef = useRef<AbortController | null>(null);

  const syncReconciliationUiSnapshot = useCallback((force = false) => {
    const ctrl = wsControllerRef.current;
    if (!ctrl) return;
    const now = Date.now();
    if (!force && now - lastReconUiSyncAtRef.current < 900) return;
    lastReconUiSyncAtRef.current = now;
    const nextSnap = ctrl.getTelemetrySnapshot();
    setReconciliationTelemetry((prev) => {
      if (
        prev.validatedTicksCount === nextSnap.validatedTicksCount &&
        prev.rejectedTicksCount === nextSnap.rejectedTicksCount &&
        prev.driftsResolvedCount === nextSnap.driftsResolvedCount &&
        prev.lastReconciledSymbol === nextSnap.lastReconciledSymbol &&
        prev.lastDiscrepancyPct === nextSnap.lastDiscrepancyPct &&
        prev.wsConnected === nextSnap.wsConnected &&
        prev.fallbackEnforced === nextSnap.fallbackEnforced &&
        prev.syncEpoch === nextSnap.syncEpoch
      ) {
        return prev;
      }
      return nextSnap;
    });
  }, []);

  const reportPriceReconciliation = useCallback(
    (event: Omit<ReconciliationAuditEvent, 'id' | 'timestamp'>) => {
      wsControllerRef.current?.recordReconciliation(event);
      syncReconciliationUiSnapshot(true);
    },
    [syncReconciliationUiSnapshot]
  );

  const reconcileStateAgainstAuthoritativePrices = useCallback(
    (priceMap: Record<string, number>) => {
      const entries = Object.entries(priceMap).filter(
        ([, price]) => Number.isFinite(price) && price > 0
      );
      if (entries.length === 0) return;

      const ctrl = wsControllerRef.current;
      let candleDriftFound = false;

      // 1. Check & immediately reconcile plotted candlesMap series when drift > threshold
      const currentCandlesMap = candlesMapRef.current;
      for (const [sym, authPrice] of entries) {
        const list = currentCandlesMap[sym];
        if (!list || list.length === 0) continue;
        const lastClose = list[list.length - 1]?.close ?? 0;
        const diffPct = computePriceDiscrepancyPct(authPrice, lastClose);
        if (diffPct > DEFAULT_DRIFT_THRESHOLD_PCT) {
          candleDriftFound = true;
          break;
        }
      }

      if (candleDriftFound) {
        setCandlesMap((prev) => {
          let mutated = false;
          const next = { ...prev };
          for (const [sym, authPrice] of entries) {
            const existingList = next[sym];
            if (!existingList || existingList.length === 0) continue;
            const source = candleSourceMapRef.current[sym] ?? 'cache';
            const res = reconcileCandleSeriesToLivePrice(
              existingList,
              authPrice,
              DEFAULT_DRIFT_THRESHOLD_PCT,
              source
            );
            if (res.reconciled) {
              next[sym] = res.candles;
              if (res.mode === 'full_reanchor') {
                candleSourceMapRef.current[sym] = 'binance';
              }
              ctrl?.recordReconciliation({
                symbol: sym,
                scope: 'CANDLES_MAP',
                discrepancyPct: res.discrepancyPct,
                thresholdPct: DEFAULT_DRIFT_THRESHOLD_PCT,
                previousPrice: res.previousClose ?? authPrice,
                authoritativePrice: authPrice,
                mode: res.mode,
              });
              mutated = true;
            }
          }
          return mutated ? next : prev;
        });
      }

      // 2. Check & immediately reconcile dashboard signalTickers if drifted beyond threshold
      setSignalTickers((prev) => {
        let mutated = false;
        const next = { ...prev };
        for (const [sym, authPrice] of entries) {
          const existing = next[sym];
          if (!existing) continue;
          const diffPct = computePriceDiscrepancyPct(authPrice, existing.price);
          if (diffPct > DEFAULT_DRIFT_THRESHOLD_PCT) {
            const liveTk = latestTickersRef.current[sym];
            next[sym] = liveTk
              ? { ...liveTk, price: authPrice }
              : { ...existing, price: authPrice, isLiveWs: true };
            mutated = true;
          }
        }
        return mutated ? next : prev;
      });

      // 3. Reconcile active pinned signal cards against authoritative live prices
      if (pinnedSignalsRef.current.length > 0) {
        setPinnedSignals((prev) => {
          if (prev.length === 0) return prev;
          const res = reconcilePinnedSignalsToLiveFeed(
            prev,
            priceMap,
            DEFAULT_DRIFT_THRESHOLD_PCT,
            candlesMapRef.current
          );
          if (res.droppedCount > 0) {
            ctrl?.recordReconciliation({
              symbol: entries[0][0],
              scope: 'SIGNAL_CARD',
              discrepancyPct: res.maxDiscrepancyPct,
              thresholdPct: DEFAULT_DRIFT_THRESHOLD_PCT,
              previousPrice: entries[0][1],
              authoritativePrice: entries[0][1],
              mode: `dropped_${res.droppedCount}_drifted_cards`,
            });
          }
          if (res.pinned === prev) return prev;
          try {
            localStorage.setItem(PINNED_SIGNALS_STORAGE_KEY, JSON.stringify(res.pinned));
          } catch {
            // ignore storage errors
          }
          return res.pinned;
        });
      }

      syncReconciliationUiSnapshot(candleDriftFound);
    },
    [syncReconciliationUiSnapshot]
  );

  // Autonomous Backend Monitor Health, Pinned Signals, Auto-Reports, 3H Digest & Offloaded Evaluations
  const [monitorHealth, setMonitorHealth] = useState<BackendHealthSnapshot | null>(null);
  const lastMonitorUiSyncRef = useRef<{ snapshot: BackendHealthSnapshot | null; atMs: number }>({
    snapshot: null,
    atMs: 0,
  });
  const [autoReports, setAutoReports] = useState<StructuredPerformanceReport[]>([]);
  const [digestStatus, setDigestStatus] = useState<DigestStatusSnapshot | null>(null);
  const [backendEvaluations, setBackendEvaluations] = useState<
    Record<string, BackendIntelligenceEvaluation>
  >({});
  const [focusedCoordinatorPlanId, setFocusedCoordinatorPlanId] = useState<string | null>(null);

  // Multi-Exchange Depth, Sentinel Agent & Zero-Intervention Autonomous Coordinator State
  const [orderBookDepth, setOrderBookDepth] = useState<Record<string, MultiExchangeDepthAnalysis>>(
    {}
  );
  const [sentinelBySymbol, setSentinelBySymbol] = useState<Record<string, SentinelAssessment>>({});
  const [sentinelFeed, setSentinelFeed] = useState<CrossPlatformFeedSignal[]>([]);
  const [autonomousState, setAutonomousState] = useState<AutonomousCoordinatorSnapshot>({
    enabled: true,
    lastTickAt: null,
    totalCycles: 0,
    entriesExecuted: 0,
    exitsExecuted: 0,
    hedgesExecuted: 0,
    reversalExitsExecuted: 0,
    spotActiveCount: 0,
    futuresActiveCount: 0,
    maxStopLossCapPct: 2.0,
    trailingTakeProfitAtrMultiplier: 5.2,
    decisionsLog: [],
  });
  const [rlTuning, setRlTuning] = useState<RlAutoTuningState>(INITIAL_RL_TUNING_STATE);
  const [emergencyLiquidation, setEmergencyLiquidation] = useState<EmergencyLiquidationSummary>({
    stablecoinReserveAsset: 'USDT',
    totalStablecoinReserveUsd: 25000,
    liquidatedCount: 0,
    totalConvertedUsd: 0,
    lastEventAt: null,
    lastTriggerReason: null,
    history: [],
  });
  const [arbitrageOpportunities, setArbitrageOpportunities] = useState<ArbitrageOpportunity[]>([]);
  const [arbitrageExecutions, setArbitrageExecutions] = useState<ArbitrageExecutionRecord[]>([]);
  const [copyAccounts, setCopyAccounts] = useState<InstitutionalCopyAccount[]>(
    INITIAL_INSTITUTIONAL_ACCOUNTS
  );
  const [mirroredCopyHistory, setMirroredCopyHistory] = useState<MirroredCopyTradePlan[]>([]);
  const [wsVerification, setWsVerification] = useState<WsVerificationSnapshot | null>(null);
  // Multi-Asset Portfolio & Volatility Auto-Rebalancer State
  const [portfolioHoldings, setPortfolioHoldings] = useState<PortfolioHoldingSeed[]>(() =>
    DEFAULT_PORTFOLIO_SEEDS.map((h) => ({ ...h }))
  );
  const [portfolioReserveUsd, setPortfolioReserveUsd] = useState<number>(
    DEFAULT_STABLECOIN_RESERVE_USD
  );
  const [portfolioConfig, setPortfolioConfig] = useState<PortfolioRebalanceConfig>(() => ({
    ...DEFAULT_REBALANCE_CONFIG,
  }));
  const [portfolioLastRebalanceAt, setPortfolioLastRebalanceAt] = useState<string | null>(null);
  const [portfolioRebalanceHistory, setPortfolioRebalanceHistory] = useState<
    RebalanceExecutionRecord[]
  >([]);
  const [portfolioBusy, setPortfolioBusy] = useState<boolean>(false);
  const [voiceAgent, setVoiceAgent] = useState<VoiceAgentState>(() => {
    let savedMode: VoiceListeningMode = 'STANDBY';
    try {
      const m = localStorage.getItem(VOICE_AGENT_STORAGE_KEY);
      if (m === 'ALWAYS_LISTENING' || m === 'PUSH_TO_TALK' || m === 'STANDBY') {
        savedMode = m;
      }
    } catch {
      // ignore storage read error
    }
    const hasSpeech =
      typeof window !== 'undefined' &&
      Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    return {
      ...DEFAULT_VOICE_AGENT_STATE,
      mode: savedMode,
      listening: savedMode === 'ALWAYS_LISTENING' && hasSpeech,
      supportedInBrowser: hasSpeech,
    };
  });
  const speechRecognitionRef = useRef<any>(null);
  const voiceModeRef = useRef<VoiceListeningMode>(voiceAgent.mode);
  voiceModeRef.current = voiceAgent.mode;
  const [pinnedSignals, setPinnedSignals] = useState<PinnedSignalRecord[]>(() => {
    try {
      const saved = localStorage.getItem(PINNED_SIGNALS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const sanitized = sanitizePinnedSignals(parsed);
        if (Array.isArray(parsed) && sanitized.length !== parsed.length) {
          localStorage.setItem(PINNED_SIGNALS_STORAGE_KEY, JSON.stringify(sanitized));
        }
        return sanitized;
      }
    } catch {
      // ignore corrupted storage
    }
    return [];
  });
  const pinnedSignalsRef = useRef<PinnedSignalRecord[]>(pinnedSignals);
  pinnedSignalsRef.current = pinnedSignals;

  const seenGainerAlertIdsRef = useRef<Set<string>>(new Set());
  const sessionInitialGainerLoadRef = useRef(true);
  const baselineGainerPctRef = useRef<Map<string, number>>(new Map());
  const emailedGainerSymbolsRef = useRef<Set<string>>(new Set());
  const routedTelegramKeysRef = useRef<Set<string>>(new Set());

  // Strict Notification Center State (prevents UI banners & popup clutter)
  const [notifications, setNotifications] = useState<AppNotificationItem[]>([
    {
      id: 'notif_init_coord',
      category: 'EXECUTION',
      title: 'Binance Spot Priority Coordinator Active',
      message:
        'Binance Spot immutable data feed, CMC baseline validation & Live Testnet Ledger online (Futures toggle optional).',
      severity: 'info',
      read: true,
      timestamp: new Date().toISOString(),
    },
  ]);

  const pushNotification = useCallback(
    (item: Omit<AppNotificationItem, 'id' | 'read' | 'timestamp'>) => {
      const nextItem: AppNotificationItem = {
        ...item,
        id: `notif_${item.category}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        read: false,
        timestamp: new Date().toISOString(),
      };
      setNotifications((prev) => [nextItem, ...prev].slice(0, 60));
    },
    []
  );

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => (n.read ? n : { ...n, read: true })));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadNotificationCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  // "Signal Forge" Telegram Channel State
  const [telegramFeed, setTelegramFeed] = useState<TelegramChannelPost[]>([]);
  const [telegramHandle, setTelegramHandle] = useState<string>('@SignalForge');
  const [telegramBotConfigured, setTelegramBotConfigured] = useState<boolean>(false);

  const refreshTelegramFeed = useCallback(async () => {
    try {
      const res = await fetch('/api/telegram/feed');
      if (!res.ok) return;
      const data = await res.json();
      setTelegramHandle(String(data.channelHandle || '@SignalForge'));
      setTelegramBotConfigured(Boolean(data.botConfigured));
      if (Array.isArray(data.posts)) {
        setTelegramFeed(data.posts);
      }
    } catch {
      // ignore transient network errors
    }
  }, []);

  // Primary Immutable Binance Spot REST Feed Poll
  const refreshSpotFeed = useCallback(async (force = false) => {
    const seq = ++spotFetchSeqRef.current;
    const t0 = performance.now();
    try {
      const res = await fetch(`/api/binance/spot-feed${force ? '?refresh=1' : ''}`);
      if (!res.ok || seq !== spotFetchSeqRef.current) return;
      const data = await res.json();
      if (seq !== spotFetchSeqRef.current) return;
      const rtt = performance.now() - t0;
      const spotMap = data?.tickers as
        | Record<
            string,
            {
              symbol: string;
              price: number;
              change24hPercent: number;
              high24h: number;
              low24h: number;
              volume24hUsd: number;
            }
          >
        | undefined;
      if (spotMap && typeof spotMap === 'object') {
        const live = data.source === 'binance_spot';
        setSpotFeedSource(live ? 'binance_spot' : 'spot_cache');
        const livePriceMap: Record<string, number> = {};
        const ctrl = wsControllerRef.current;
        setTickers((prev) => {
          const next = { ...prev };
          let mutated = false;
          for (const [sym, entry] of Object.entries(spotMap)) {
            if (!entry) continue;
            const check = ctrl
              ? ctrl.ingestExternalValidatedTick({
                  symbol: sym,
                  price: entry.price,
                  change24hPercent: entry.change24hPercent,
                  high24h: entry.high24h,
                  low24h: entry.low24h,
                  volume24hUsd: entry.volume24hUsd,
                  source: 'rest',
                })
              : { accepted: Number.isFinite(entry.price) && entry.price > 0 };
            if (!check.accepted) continue;
            livePriceMap[sym] = entry.price;
            const existing = next[sym];
            if (existing) {
              if (
                Math.abs(existing.price - entry.price) > 1e-8 ||
                existing.volume24hUsd !== entry.volume24hUsd
              ) {
                next[sym] = {
                  ...existing,
                  price: entry.price,
                  change24hPercent: entry.change24hPercent ?? existing.change24hPercent,
                  high24h: entry.high24h || Math.max(existing.high24h, entry.price),
                  low24h: entry.low24h || Math.min(existing.low24h, entry.price),
                  volume24hUsd: entry.volume24hUsd || existing.volume24hUsd,
                };
                mutated = true;
              }
            } else {
              next[sym] = {
                symbol: sym,
                baseAsset: sym.replace(/USDT$/i, ''),
                name: sym.replace(/USDT$/i, ''),
                price: entry.price,
                change24hPercent: entry.change24hPercent ?? 0,
                high24h: entry.high24h || entry.price,
                low24h: entry.low24h || entry.price,
                volume24hUsd: entry.volume24hUsd || 0,
                isLiveWs: false,
              };
              mutated = true;
            }
          }
          return mutated ? next : prev;
        });

        if (live && Object.keys(livePriceMap).length > 0) {
          reconcileStateAgainstAuthoritativePrices(livePriceMap);
        }

        setTelemetryMetrics((prev) =>
          updateLatencyMetrics(prev, rtt, {
            fallbackEnforced: !wsConnectedRef.current && !live,
            syncEpoch: Number(data.syncEpoch || prev.syncEpoch),
            flushedFramesTotal: wsBufferRef.current.getFlushedFramesTotal(),
            timestamp: String(data.updatedAt || new Date().toISOString()),
          })
        );
      }
    } catch {
      // keep existing spot tickers cleanly
    }
  }, [reconcileStateAgainstAuthoritativePrices]);

  // CoinMarketCap Baseline Valuations + Spot Parity Validation
  const refreshCmcValuations = useCallback(async (force = false) => {
    try {
      const res = await fetch(`/api/market/cmc-valuations${force ? '?refresh=1' : ''}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.valuations && typeof data.valuations === 'object') {
        setCmcValuations(data.valuations);
        setCmcSource(data.source === 'cmc_api' ? 'cmc_api' : 'unavailable');
      }
      if (data?.validations && typeof data.validations === 'object') {
        setSpotCmcValidations(data.validations);
      }
    } catch {
      // keep existing baseline valuations cleanly
    }
  }, []);

  // Optional Binance USD-M Futures Feed (only polls actively when user toggles Futures ON and Live Modules ON)
  const refreshFuturesFeed = useCallback(async (force = false) => {
    if (!systemControlsRef.current.liveFeedModulesEnabled && !force) return;
    if (!futuresTradingEnabledRef.current && !force) return;
    try {
      const activeFlag = futuresTradingEnabledRef.current || force ? '?active=1' : '';
      const res = await fetch(`/api/binance/futures-feed${activeFlag}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.telemetry && typeof data.telemetry === 'object') {
        setFuturesTelemetry(data.telemetry as Record<string, FuturesTickerTelemetry>);
        setFuturesFeedSource(data.source === 'binance_futures' ? 'binance_futures' : 'futures_cache');
      }
    } catch {
      // keep optional futures cache clean
    }
  }, []);

  const setFuturesTradingEnabled = useCallback(
    (enabled: boolean) => {
      setFuturesTradingEnabledState(enabled);
      futuresTradingEnabledRef.current = enabled;
      if (enabled && systemControlsRef.current.liveFeedModulesEnabled) {
        refreshFuturesFeed(true);
      }
      pushNotification({
        category: 'EXECUTION',
        title: enabled ? 'Optional Futures Trading Enabled' : 'Reverted to Binance Spot Priority (1x)',
        message: enabled
          ? 'Manual Futures leverage scaling & Cross/Isolated margin controls unlocked alongside primary Spot data.'
          : 'Binance Spot remains your sole immutable data feed with zero Futures latency.',
        severity: 'info',
      });
    },
    [refreshFuturesFeed, pushNotification]
  );

  const applySyncedMatrixToLocal = useCallback((matrix: GranularControlMatrix) => {
    const derived = matrixToSystemControls(matrix);
    systemControlsRef.current = derived;
    setSystemControls(derived);
    try {
      localStorage.setItem(SYSTEM_CONTROLS_STORAGE_KEY, JSON.stringify(derived));
    } catch {
      // ignore quota errors
    }
    const wantFutures = matrix.futuresFeedModule || matrix.futuresExecutionRouter;
    if (wantFutures !== futuresTradingEnabledRef.current) {
      futuresTradingEnabledRef.current = wantFutures;
      setFuturesTradingEnabledState(wantFutures);
    }
  }, []);

  const refreshArchitectureAndSubscription = useCallback(async () => {
    try {
      const res = await apiFetch('/api/architecture/state');
      if (!res.ok) return;
      const data = await res.json();
      if (data?.architecture) {
        const nextArch = data.architecture as MicroservicePlatformState;
        architectureStateRef.current = nextArch;
        setArchitectureState(nextArch);
        applySyncedMatrixToLocal(nextArch.controlMatrix);
      }
      if (data?.subscription) {
        subscriptionSummaryRef.current = data.subscription;
        setSubscriptionSummary(data.subscription);
      }
    } catch {
      // ignore transient error
    }
  }, [applySyncedMatrixToLocal]);

  const userRef = useRef<User | null>(user);
  userRef.current = user;

  const blockIfNotPremium = useCallback(
    (capability: CapabilityClass, actionLabel: string): string | null => {
      if (subscriptionSummaryRef.current.premiumUnlocked) return null;
      const reason = !subscriptionSummaryRef.current.authenticated
        ? `${actionLabel} locked (${capability}): Sign in with a verified account holding a Premium Institutional subscription.`
        : !subscriptionSummaryRef.current.emailVerified
        ? `${actionLabel} locked (${capability}): Verify your email address before modifying privileged controls.`
        : `${actionLabel} locked (${capability}): Activate Premium Institutional subscription to unlock telemetry, agent override & execution controls.`;
      setArchitectureFeedback({ ok: false, text: reason });
      pushNotification({
        category: 'EXECUTION',
        title: `Subscription Gatekeeper · ${capability} Locked`,
        message: reason,
        severity: 'warning',
      });
      return reason;
    },
    [pushNotification]
  );

  const toggleControlMatrixKey = useCallback(
    async (
      key: GranularToggleKey,
      enabled?: boolean
    ): Promise<{ ok: boolean; error?: string }> => {
      const descriptor = DESCRIPTOR_BY_KEY[key];
      const targetVal =
        typeof enabled === 'boolean'
          ? enabled
          : !architectureStateRef.current.controlMatrix[key];
      const blocked = blockIfNotPremium(descriptor.capability, descriptor.label);
      if (blocked) {
        return { ok: false, error: blocked };
      }
      setArchitectureBusy(true);
      try {
        const res = await apiFetch('/api/architecture/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patch: { [key]: targetVal },
            reason: `Workspace operator toggled ${descriptor.label} -> ${targetVal ? 'ON' : 'OFF'}`,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          const msg = String(data?.error || `Failed toggling ${descriptor.label}.`);
          setArchitectureFeedback({ ok: false, text: msg });
          return { ok: false, error: msg };
        }
        const nextArch = data.architecture as MicroservicePlatformState;
        architectureStateRef.current = nextArch;
        setArchitectureState(nextArch);
        applySyncedMatrixToLocal(nextArch.controlMatrix);
        if (data.subscription) {
          subscriptionSummaryRef.current = data.subscription;
          setSubscriptionSummary(data.subscription);
        }

        if (key === 'spotWsStream' || key === 'telemetrySseStream') {
          if (!nextArch.controlMatrix.spotWsStream) {
            wsBufferRef.current.discardAndBumpEpoch();
            wsControllerRef.current?.stop();
            setWsConnected(false);
            setTelemetryMetrics((prev) => ({ ...prev, fallbackEnforced: true }));
          } else {
            setWsReconnectNonce((n) => n + 1);
            refreshSpotFeed(true).catch(() => undefined);
          }
        }
        if (key === 'futuresFeedModule' && targetVal) {
          refreshFuturesFeed(true).catch(() => undefined);
        }

        const activeUser = userRef.current;
        if (activeUser && activeUser.emailVerified) {
          saveWorkspaceControlConfig(
            activeUser.uid,
            nextArch.matrixChecksum,
            { ...nextArch.controlMatrix }
          ).catch(() => undefined);
          const latestSnap = nextArch.snapshots[0];
          if (latestSnap) {
            saveRollbackCheckpointToFirestore(activeUser.uid, {
              snapshotId: latestSnap.snapshotId,
              version: latestSnap.version,
              reason: latestSnap.reason,
              checksum: latestSnap.checksum,
              toggles: { ...latestSnap.matrix },
            }).catch(() => undefined);
          }
        }

        setArchitectureFeedback({
          ok: true,
          text: `${descriptor.label} set to ${targetVal ? 'ACTIVE' : 'PAUSED'} · Checkpoint ${data.snapshotId} persisted.`,
        });
        return { ok: true };
      } catch {
        const msg = `Network error updating ${descriptor.label}.`;
        setArchitectureFeedback({ ok: false, text: msg });
        return { ok: false, error: msg };
      } finally {
        setArchitectureBusy(false);
      }
    },
    [
      applySyncedMatrixToLocal,
      blockIfNotPremium,
      refreshFuturesFeed,
      refreshSpotFeed,
    ]
  );

  const triggerServiceFailover = useCallback(
    async (
      serviceId: MicroserviceId,
      targetNode: FailoverNodeRole,
      reason?: string
    ): Promise<{ ok: boolean; error?: string }> => {
      const blocked = blockIfNotPremium('TELEMETRY', `HA Failover (${serviceId})`);
      if (blocked) return { ok: false, error: blocked };
      setArchitectureBusy(true);
      try {
        const res = await apiFetch('/api/architecture/failover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serviceId, targetNode, reason }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          const msg = String(data?.error || 'HA failover rejected.');
          setArchitectureFeedback({ ok: false, text: msg });
          return { ok: false, error: msg };
        }
        const nextArch = data.architecture as MicroservicePlatformState;
        architectureStateRef.current = nextArch;
        setArchitectureState(nextArch);
        setArchitectureFeedback({
          ok: true,
          text: `Microservice ${serviceId} switched cleanly to ${targetNode} standby endpoint.`,
        });
        pushNotification({
          category: 'EXECUTION',
          title: `HA Failover · ${serviceId} -> ${targetNode}`,
          message: `Traffic routed to ${nextArch.services[serviceId].activeEndpoint} with zero sibling impact.`,
          severity: 'info',
        });
        return { ok: true };
      } catch {
        return { ok: false, error: 'Network error triggering HA failover.' };
      } finally {
        setArchitectureBusy(false);
      }
    },
    [blockIfNotPremium, pushNotification]
  );

  const setMicroserviceLifecycle = useCallback(
    async (
      serviceId: MicroserviceId,
      lifecycle: 'ACTIVE' | 'ISOLATED' | 'DECOMMISSIONED',
      reason?: string
    ): Promise<{ ok: boolean; error?: string }> => {
      const blocked = blockIfNotPremium('AGENT_OVERRIDE', `Service Lifecycle (${serviceId})`);
      if (blocked) return { ok: false, error: blocked };
      setArchitectureBusy(true);
      try {
        const res = await apiFetch('/api/architecture/service-lifecycle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serviceId, lifecycle, reason }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          const msg = String(data?.error || 'Service lifecycle change rejected.');
          setArchitectureFeedback({ ok: false, text: msg });
          return { ok: false, error: msg };
        }
        const nextArch = data.architecture as MicroservicePlatformState;
        architectureStateRef.current = nextArch;
        setArchitectureState(nextArch);
        setArchitectureFeedback({
          ok: true,
          text: `Microservice ${serviceId} lifecycle transitioned to ${lifecycle}.`,
        });
        return { ok: true };
      } catch {
        return { ok: false, error: 'Network error updating microservice lifecycle.' };
      } finally {
        setArchitectureBusy(false);
      }
    },
    [blockIfNotPremium]
  );

  const triggerRollbackSnapshot = useCallback(
    async (
      snapshotId: string,
      reason?: string
    ): Promise<{ ok: boolean; error?: string }> => {
      const blocked = blockIfNotPremium('EXECUTION', 'Configuration Rollback');
      if (blocked) return { ok: false, error: blocked };
      setArchitectureBusy(true);
      try {
        const res = await apiFetch('/api/architecture/rollback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ snapshotId, reason }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          const msg = String(data?.error || 'Rollback failed.');
          setArchitectureFeedback({ ok: false, text: msg });
          return { ok: false, error: msg };
        }
        const nextArch = data.architecture as MicroservicePlatformState;
        architectureStateRef.current = nextArch;
        setArchitectureState(nextArch);
        applySyncedMatrixToLocal(nextArch.controlMatrix);
        const activeUser = userRef.current;
        if (activeUser && activeUser.emailVerified) {
          saveWorkspaceControlConfig(
            activeUser.uid,
            nextArch.matrixChecksum,
            { ...nextArch.controlMatrix }
          ).catch(() => undefined);
        }
        setArchitectureFeedback({
          ok: true,
          text: `Rolled back control matrix cleanly to checkpoint ${snapshotId} (${nextArch.matrixChecksum}).`,
        });
        pushNotification({
          category: 'EXECUTION',
          title: `Rollback Executed -> ${snapshotId}`,
          message: `Restored verified matrix checksum ${nextArch.matrixChecksum} across all decoupled microservices.`,
          severity: 'success',
        });
        return { ok: true };
      } catch {
        return { ok: false, error: 'Network error executing rollback.' };
      } finally {
        setArchitectureBusy(false);
      }
    },
    [applySyncedMatrixToLocal, blockIfNotPremium, pushNotification]
  );

  const runFaultIsolationDrill = useCallback(
    async (input: {
      serviceId: MicroserviceId;
      severity?: ErrorSeverity;
      code?: string;
      message?: string;
      burstCount?: number;
    }): Promise<{
      ok: boolean;
      error?: string;
      failoverTriggered?: boolean;
      rollbackTriggered?: boolean;
    }> => {
      const blocked = blockIfNotPremium('TELEMETRY', `Fault Isolation Drill (${input.serviceId})`);
      if (blocked) return { ok: false, error: blocked };
      setArchitectureBusy(true);
      try {
        const res = await apiFetch('/api/architecture/fault-drill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          const msg = String(data?.error || 'Fault drill failed.');
          setArchitectureFeedback({ ok: false, text: msg });
          return { ok: false, error: msg };
        }
        const nextArch = data.architecture as MicroservicePlatformState;
        architectureStateRef.current = nextArch;
        setArchitectureState(nextArch);
        applySyncedMatrixToLocal(nextArch.controlMatrix);

        const activeUser = userRef.current;
        if (activeUser && activeUser.emailVerified && Array.isArray(data.recordedErrors)) {
          for (const errEntry of data.recordedErrors) {
            saveErrorAuditToFirestore(activeUser.uid, {
              id: String(errEntry.id),
              correlationId: String(errEntry.correlationId),
              serviceId: String(errEntry.serviceId),
              severity: errEntry.severity,
              code: String(errEntry.code),
              message: String(errEntry.message),
              recoveryAction: String(errEntry.recoveryAction),
            }).catch(() => undefined);
          }
        }

        const summaryText = data.rollbackTriggered
          ? `Fault burst contained on ${input.serviceId} — HA Auto-Failover & Automated Rollback Protocol executed with 0 cascade to sibling engines.`
          : data.failoverTriggered
          ? `Fault contained on ${input.serviceId} — HA Auto-Failover switched node to SECONDARY with sibling services isolated.`
          : `Fault recorded and isolated on ${input.serviceId} (${nextArch.isolatedFaultsContainedTotal} total contained).`;
        setArchitectureFeedback({ ok: true, text: summaryText });
        return {
          ok: true,
          failoverTriggered: Boolean(data.failoverTriggered),
          rollbackTriggered: Boolean(data.rollbackTriggered),
        };
      } catch {
        return { ok: false, error: 'Network error running fault isolation drill.' };
      } finally {
        setArchitectureBusy(false);
      }
    },
    [applySyncedMatrixToLocal, blockIfNotPremium]
  );

  const activatePremiumTier = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    setArchitectureBusy(true);
    try {
      const res = await apiFetch('/api/subscription/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planLabel: 'Premium Institutional Desk' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const msg = String(
          data?.error ||
            'Sign in with a verified Firebase account first to activate Premium Institutional access.'
        );
        setArchitectureFeedback({ ok: false, text: msg });
        return { ok: false, error: msg };
      }
      if (data.subscription) {
        subscriptionSummaryRef.current = data.subscription;
        setSubscriptionSummary(data.subscription);
      }
      await refreshArchitectureAndSubscription();
      setArchitectureFeedback({
        ok: true,
        text: 'Premium Institutional tier active — Telemetry, Agent Override, and Execution controls unlocked.',
      });
      pushNotification({
        category: 'EXECUTION',
        title: 'Premium Institutional Tier Activated',
        message: 'Verified full-access clearance granted across all microservice domains.',
        severity: 'success',
      });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error activating subscription.' };
    } finally {
      setArchitectureBusy(false);
    }
  }, [pushNotification, refreshArchitectureAndSubscription]);

  const downgradeToFreeTier = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    setArchitectureBusy(true);
    try {
      const res = await apiFetch('/api/subscription/downgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const msg = String(data?.error || 'Could not switch tier.');
        setArchitectureFeedback({ ok: false, text: msg });
        return { ok: false, error: msg };
      }
      if (data.subscription) {
        subscriptionSummaryRef.current = data.subscription;
        setSubscriptionSummary(data.subscription);
      }
      await refreshArchitectureAndSubscription();
      setArchitectureFeedback({
        ok: true,
        text: 'Reverted to FREE Read-Only tier — Telemetry, Agent Override, and Execution controls locked.',
      });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error downgrading tier.' };
    } finally {
      setArchitectureBusy(false);
    }
  }, [refreshArchitectureAndSubscription]);

  const setTestnetExecutionEnabled = useCallback(
    (enabled: boolean) => {
      if (blockIfNotPremium('EXECUTION', 'Binance Testnet Execution')) return;
      toggleControlMatrixKey('testnetSandboxRouter', enabled).catch(() => undefined);
      pushNotification({
        category: 'EXECUTION',
        title: enabled ? 'Binance Testnet Execution Resumed' : 'Binance Testnet Execution Paused',
        message: enabled
          ? 'Testnet order placement and ATR trailing stop tracking re-enabled.'
          : 'Testnet order loops paused for low-lag operation. Signal Engine & Telegram remain active.',
        severity: enabled ? 'success' : 'info',
      });
    },
    [blockIfNotPremium, toggleControlMatrixKey, pushNotification]
  );

  const setLiveFeedModulesEnabled = useCallback(
    (enabled: boolean) => {
      if (blockIfNotPremium('TELEMETRY', 'Live Spot/Futures Feed Modules')) return;
      const next: SystemRuntimeControls = {
        ...systemControlsRef.current,
        liveFeedModulesEnabled: enabled,
      };
      setSystemControls(next);
      try {
        localStorage.setItem(SYSTEM_CONTROLS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage quota errors
      }
      const nextMatrix = applySystemControlsToMatrix(
        architectureStateRef.current.controlMatrix,
        next
      );
      apiFetch('/api/system/controls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.architecture) {
            setArchitectureState(data.architecture as MicroservicePlatformState);
          }
        })
        .catch(() => undefined);
      const activeUser = userRef.current;
      if (activeUser && activeUser.emailVerified) {
        saveWorkspaceControlConfig(
          activeUser.uid,
          architectureStateRef.current.matrixChecksum,
          { ...nextMatrix }
        ).catch(() => undefined);
      }
      if (!enabled) {
        wsBufferRef.current.discardAndBumpEpoch();
        wsControllerRef.current?.stop();
        setWsConnected(false);
        setTelemetryMetrics((prev) => ({
          ...prev,
          fallbackEnforced: true,
        }));
      } else {
        setWsReconnectNonce((n) => n + 1);
        refreshSpotFeed(true);
        refreshCmcValuations(true);
        if (futuresTradingEnabledRef.current) {
          refreshFuturesFeed(true);
        }
      }
      pushNotification({
        category: 'EXECUTION',
        title: enabled ? 'Live Spot/Futures Modules Resumed' : 'Live Spot/Futures Modules Paused',
        message: enabled
          ? 'Real-time WebSocket streams, SSE health monitor, and live feed polling resumed.'
          : 'High-frequency WebSockets & polling loops paused. Signal Engine, Top Gainers & Telegram remain active.',
        severity: enabled ? 'success' : 'info',
      });
    },
    [
      blockIfNotPremium,
      pushNotification,
      refreshSpotFeed,
      refreshCmcValuations,
      refreshFuturesFeed,
    ]
  );

  // Testnet & Live Execution State (Spot Priority + Optional Futures)
  const [executionState, setExecutionState] = useState<ExecutionEnvironmentState>({
    mode: 'TESTNET',
    marketType: 'SPOT',
    marginMode: 'CROSS',
    endpoint: 'https://testnet.binance.vision',
    testnetConfigured: false,
    liveConfigured: false,
    testnetBalanceUsd: 25000,
    crossMargin: DEFAULT_CROSS_SUMMARY,
    positions: [],
    totalExecutedOrders: 0,
    warning: null,
  });
  const hasOpenPositionsRef = useRef(false);
  hasOpenPositionsRef.current = executionState.positions.some((p) => p.status === 'OPEN');

  const refreshExecutionState = useCallback(async () => {
    try {
      const res = await fetch('/api/execution/state');
      if (!res.ok) return;
      const data = await res.json();
      setExecutionState((prev) => ({
        mode: data.mode === 'LIVE' ? 'LIVE' : 'TESTNET',
        marketType: futuresTradingEnabledRef.current ? 'USD_M_FUTURES' : 'SPOT',
        marginMode: data.marginMode === 'ISOLATED' ? 'ISOLATED' : 'CROSS',
        endpoint: String(data.endpoint || 'https://testnet.binance.vision'),
        testnetConfigured: Boolean(data.testnetConfigured),
        liveConfigured: Boolean(data.liveConfigured),
        testnetBalanceUsd: Number(data.testnetBalanceUsd ?? 25000),
        crossMargin: data.crossMargin || DEFAULT_CROSS_SUMMARY,
        positions: Array.isArray(data.positions) ? data.positions : [],
        totalExecutedOrders: Number(data.totalExecutedOrders ?? 0),
        warning: prev.warning,
      }));
    } catch {
      // ignore transient errors
    }
  }, []);

  const refreshAutoReports = useCallback(async () => {
    try {
      const res = await fetch('/api/reports/auto');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.reports)) {
        setAutoReports(data.reports);
      }
    } catch {
      // keep existing structured reports cleanly
    }
  }, []);

  const refreshDigestStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/digest/status');
      if (!res.ok) return;
      const data = await res.json();
      if (data?.ok) {
        setDigestStatus({
          intervalHours: Number(data.intervalHours ?? 3),
          pendingCount: Number(data.pendingCount ?? 0),
          pendingSignals: Array.isArray(data.pendingSignals) ? data.pendingSignals : [],
          lastDigestSentAt: data.lastDigestSentAt ? String(data.lastDigestSentAt) : null,
          nextScheduledAt: String(data.nextScheduledAt || new Date().toISOString()),
          remainingMs: Number(data.remainingMs ?? 0),
          totalBatchedAllTime: Number(data.totalBatchedAllTime ?? 0),
          totalDigestsDispatched: Number(data.totalDigestsDispatched ?? 0),
          individualEmailsPrevented: Number(data.individualEmailsPrevented ?? 0),
        });
      }
    } catch {
      // keep prior snapshot cleanly
    }
  }, []);

  const evaluateBackendIntelligence = useCallback(async (symbols: string[]) => {
    if (!systemControlsRef.current.liveFeedModulesEnabled) return;
    if (!symbols || symbols.length === 0) return;
    try {
      const res = await apiFetch('/api/coordinator/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.evaluations)) {
        setBackendEvaluations((prev) => {
          const next = { ...prev };
          for (const ev of data.evaluations as BackendIntelligenceEvaluation[]) {
            next[ev.symbol] = ev;
          }
          return next;
        });
      }
    } catch {
      // non-fatal background offload
    }
  }, []);

  const focusCoordinatorPlan = useCallback((planId: string) => {
    setFocusedCoordinatorPlanId(planId);
  }, []);

  const refreshOrderBookDepth = useCallback(async (symbol?: string, force = false) => {
    try {
      const qs = new URLSearchParams();
      if (symbol) qs.set('symbol', symbol);
      if (force) qs.set('refresh', '1');
      const query = qs.toString() ? `?${qs.toString()}` : '';
      const res = await fetch(`/api/orderbook/depth${query}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.depthMap && typeof data.depthMap === 'object') {
        setOrderBookDepth(data.depthMap);
      }
    } catch {
      // keep existing order book depth cleanly
    }
  }, []);

  const refreshSentinelStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/sentinel/status');
      if (!res.ok) return;
      const data = await res.json();
      if (data?.assessments && typeof data.assessments === 'object') {
        setSentinelBySymbol(data.assessments);
      }
      if (Array.isArray(data?.feed)) {
        setSentinelFeed(data.feed);
      }
    } catch {
      // keep existing sentinel snapshots cleanly
    }
  }, []);

  const triggerSentinelAudit = useCallback(
    async (input?: {
      symbol?: string;
      headline?: string;
      sentiment?: 'BULLISH' | 'BEARISH';
      platform?: CrossPlatformFeedSignal['platform'];
    }) => {
      try {
        const res = await apiFetch('/api/sentinel/evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input || {}),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.assessments && typeof data.assessments === 'object') {
          setSentinelBySymbol(data.assessments);
        }
        if (Array.isArray(data?.feed)) {
          setSentinelFeed(data.feed);
        }
        await refreshExecutionState();
      } catch {
        // non-fatal sentinel trigger
      }
    },
    [refreshExecutionState]
  );

  const refreshAutonomousState = useCallback(async () => {
    try {
      const res = await fetch('/api/autonomous/state');
      if (!res.ok) return;
      const data = await res.json();
      if (data?.ok) {
        setAutonomousState({
          enabled: Boolean(data.enabled),
          lastTickAt: data.lastTickAt ? String(data.lastTickAt) : null,
          totalCycles: Number(data.totalCycles ?? 0),
          entriesExecuted: Number(data.entriesExecuted ?? 0),
          exitsExecuted: Number(data.exitsExecuted ?? 0),
          hedgesExecuted: Number(data.hedgesExecuted ?? 0),
          reversalExitsExecuted: Number(data.reversalExitsExecuted ?? 0),
          spotActiveCount: Number(data.spotActiveCount ?? 0),
          futuresActiveCount: Number(data.futuresActiveCount ?? 0),
          maxStopLossCapPct: Number(data.maxStopLossCapPct ?? 2.0),
          trailingTakeProfitAtrMultiplier: Number(data.trailingTakeProfitAtrMultiplier ?? 5.2),
          decisionsLog: Array.isArray(data.decisionsLog) ? data.decisionsLog : [],
        });
      }
    } catch {
      // keep existing autonomous state cleanly
    }
  }, []);

  const refreshRlTuning = useCallback(async () => {
    try {
      const res = await fetch('/api/autonomous/tune');
      if (!res.ok) return;
      const data = await res.json();
      if (data?.ok && data.tuning) {
        setRlTuning(data.tuning);
      }
    } catch {
      // ignore transient error
    }
  }, []);

  const refreshLiquidationState = useCallback(async () => {
    try {
      const res = await fetch('/api/autonomous/liquidation-state');
      if (!res.ok) return;
      const data = await res.json();
      if (data?.ok && data.liquidation) {
        setEmergencyLiquidation(data.liquidation);
      }
    } catch {
      // ignore transient error
    }
  }, []);

  const refreshArbitrageStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/arbitrage/status');
      if (!res.ok) return;
      const data = await res.json();
      if (data?.ok) {
        if (Array.isArray(data.opportunities)) setArbitrageOpportunities(data.opportunities);
        if (Array.isArray(data.executions)) setArbitrageExecutions(data.executions);
      }
    } catch {
      // ignore transient error
    }
  }, []);

  const refreshCopyTradingStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/copy-trading/status');
      if (!res.ok) return;
      const data = await res.json();
      if (data?.ok) {
        if (Array.isArray(data.accounts)) setCopyAccounts(data.accounts);
        if (Array.isArray(data.mirroredHistory)) setMirroredCopyHistory(data.mirroredHistory);
      }
    } catch {
      // ignore transient error
    }
  }, []);

  const refreshWsVerification = useCallback(async () => {
    try {
      const res = await fetch('/api/ws/verify');
      if (!res.ok) return;
      const data = await res.json();
      if (data?.ok) {
        setWsVerification(data as WsVerificationSnapshot);
      }
    } catch {
      // ignore transient error
    }
  }, []);

  const setAppLiveEnabled = useCallback(
    async (enabled: boolean) => {
      if (blockIfNotPremium('TELEMETRY', 'App Live Master Switch')) return;
      appLiveEnabledRef.current = enabled;
      setAppLiveEnabledState(enabled);
      try {
        localStorage.setItem(APP_LIVE_STORAGE_KEY, enabled ? 'true' : 'false');
      } catch {
        // ignore storage quota errors
      }

      if (!enabled) {
        wsBufferRef.current.discardAndBumpEpoch();
        wsControllerRef.current?.stop();
        setWsConnected(false);
        setTelemetryMetrics((prev) => ({
          ...prev,
          fallbackEnforced: true,
        }));
      } else {
        if (systemControlsRef.current.liveFeedModulesEnabled) {
          setWsReconnectNonce((n) => n + 1);
        }
      }

      try {
        const res = await apiFetch('/api/system/app-live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appLiveEnabled: enabled }),
        });
        if (res.ok) {
          const data = await res.json();
          setAppLiveMeta({
            quotaSavedCalls: Number(data.quotaSavedCalls ?? 0),
            toggledAt: data.toggledAt ? String(data.toggledAt) : new Date().toISOString(),
          });
        }
      } catch {
        // local state already toggled immediately
      }

      if (enabled) {
        refreshSpotFeed(true).catch(() => undefined);
        refreshTopGainers(true).catch(() => undefined);
        refreshWsVerification().catch(() => undefined);
      }

      pushNotification({
        category: 'EXECUTION',
        title: enabled ? "'App Live' Master Control Active" : "'App Live' Halted · Quota Protected",
        message: enabled
          ? 'Resumed all WebSockets, API polling, automated signal dispatch, and autonomous Coordinator loops.'
          : 'Immediately halted all API polling, WebSockets, signal dispatch & autonomous execution to preserve API quota.',
        severity: enabled ? 'success' : 'warning',
      });
    },
    [blockIfNotPremium, pushNotification, refreshSpotFeed, refreshWsVerification]
  );

  const toggleAutonomousCoordinator = useCallback(
    async (enabled?: boolean) => {
      if (blockIfNotPremium('AGENT_OVERRIDE', 'Autonomous Coordinator')) return;
      try {
        const res = await apiFetch('/api/autonomous/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(typeof enabled === 'boolean' ? { enabled } : {}),
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (data?.architecture) {
          setArchitectureState(data.architecture as MicroservicePlatformState);
        }
        await Promise.all([refreshAutonomousState(), refreshExecutionState()]);
        const nowEnabled = typeof enabled === 'boolean' ? enabled : Boolean(data?.enabled);
        pushNotification({
          category: 'EXECUTION',
          title: nowEnabled
            ? 'Master Autonomous Coordinator Armed'
            : 'Autonomous Zero-Intervention Paused',
          message: nowEnabled
            ? 'Zero-intervention Spot & Futures execution, 2.0% Max Risk Cap & min 1:5 R:R ATR Trailing TP active.'
            : 'Manual oversight mode active; autonomous entry/exit ticks paused.',
          severity: nowEnabled ? 'success' : 'info',
        });
      } catch {
        // ignore transient error
      }
    },
    [blockIfNotPremium, refreshAutonomousState, refreshExecutionState, pushNotification]
  );

  const runAutonomousCycleNow = useCallback(async () => {
    if (forgeCapitalRef.current.failSafe.engaged || forgeCapitalRef.current.allTradingHalted) {
      pushNotification({
        category: 'EXECUTION',
        title: 'EMERGENCY_HALT (423 Locked)',
        message: `Autonomous AI Agents halted by Forge Capital Hub [${forgeCapitalRef.current.failSafe.immutableSealId || 'SEALED'}].`,
        severity: 'warning',
      });
      return;
    }
    try {
      const res = await apiFetch('/api/autonomous/tick', { method: 'POST' });
      if (!res.ok) return;
      await Promise.all([
        refreshOrderBookDepth(undefined, false),
        refreshSentinelStatus(),
        refreshAutonomousState(),
        refreshExecutionState(),
        refreshRlTuning(),
        refreshLiquidationState(),
        refreshArbitrageStatus(),
        refreshCopyTradingStatus(),
      ]);
    } catch {
      // ignore transient error
    }
  }, [
    pushNotification,
    refreshOrderBookDepth,
    refreshSentinelStatus,
    refreshAutonomousState,
    refreshExecutionState,
    refreshRlTuning,
    refreshLiquidationState,
    refreshArbitrageStatus,
    refreshCopyTradingStatus,
  ]);

  const triggerRlAutoTune = useCallback(async () => {
    try {
      const res = await apiFetch('/api/autonomous/tune', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.ok && data.tuning) {
        setRlTuning(data.tuning);
        pushNotification({
          category: 'EXECUTION',
          title: 'AI RL Auto-Tuning Cycle Applied',
          message: String(data.tuning.tuningNote || 'Updated ATR multipliers & conviction compute allocation.'),
          severity: 'info',
        });
      }
    } catch {
      // ignore transient error
    }
  }, [pushNotification]);

  const triggerEmergencyLiquidation = useCallback(
    async (stablecoinAsset: 'USDT' | 'USDC' = 'USDT', reason?: string) => {
      try {
        const res = await apiFetch('/api/autonomous/emergency-liquidate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stablecoinAsset, reason }),
        });
        const data = await res.json();
        if (!res.ok || !data?.ok) return { ok: false };
        if (data.liquidation) setEmergencyLiquidation(data.liquidation);
        await Promise.all([refreshExecutionState(), refreshAutonomousState()]);
        pushNotification({
          category: 'EXECUTION',
          title: `Emergency Liquidation Executed (${data.liquidatedCount} positions)`,
          message: `Converted $${Number(data.totalConvertedUsd ?? 0).toLocaleString()} volatile exposure into ${stablecoinAsset} reserve.`,
          severity: 'warning',
        });
        return { ok: true, liquidatedCount: Number(data.liquidatedCount ?? 0) };
      } catch {
        return { ok: false };
      }
    },
    [refreshExecutionState, refreshAutonomousState, pushNotification]
  );

  const executeArbitrage = useCallback(
    async (opportunityId?: string): Promise<{ ok: boolean; error?: string }> => {
      if (forgeCapitalRef.current.failSafe.engaged || forgeCapitalRef.current.allTradingHalted) {
        const err = `EMERGENCY_HALT (423 Locked): Arbitrage & Copy Desk suspended.`;
        pushNotification({
          category: 'EXECUTION',
          title: 'Forge Capital Hub Locked (423)',
          message: err,
          severity: 'warning',
        });
        return { ok: false, error: err };
      }
      try {
        const res = await apiFetch('/api/arbitrage/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ opportunityId }),
        });
        const data = await res.json();
        if (data?.forgeCapitalState) {
          setForgeCapitalState(data.forgeCapitalState as ForgeCapitalHubState);
        }
        if (!res.ok || !data?.ok) {
          return { ok: false, error: data?.error || 'Arbitrage execution failed.' };
        }
        if (Array.isArray(data.executions)) setArbitrageExecutions(data.executions);
        await Promise.all([refreshArbitrageStatus(), refreshExecutionState()]);
        pushNotification({
          category: 'EXECUTION',
          title: `Cross-Exchange Arbitrage Captured · ${data.record.symbol}`,
          message: `Bought ${data.record.buyExchange} / Sold ${data.record.sellExchange} (+${data.record.netSpreadBps} bps · +$${data.record.realizedProfitUsd})`,
          symbol: data.record.symbol,
          severity: 'success',
        });
        return { ok: true };
      } catch {
        return { ok: false, error: 'Network error executing arbitrage.' };
      }
    },
    [refreshArbitrageStatus, refreshExecutionState, pushNotification]
  );

  const toggleCopyAccount = useCallback(
    async (accountId: string, enabled?: boolean) => {
      try {
        const res = await apiFetch('/api/copy-trading/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId, enabled }),
        });
        const data = await res.json();
        if (data?.ok && Array.isArray(data.accounts)) {
          setCopyAccounts(data.accounts);
        }
      } catch {
        // ignore transient error
      }
    },
    []
  );

  const mirrorCopyTrade = useCallback(
    async (accountId: string, symbol: string, direction: 'BUY' | 'SELL') => {
      if (forgeCapitalRef.current.failSafe.engaged || forgeCapitalRef.current.allTradingHalted) {
        pushNotification({
          category: 'EXECUTION',
          title: 'EMERGENCY_HALT (423 Locked)',
          message: `Copy Trading suspended while Forge Capital Hub Fail-Safe is engaged.`,
          symbol,
          severity: 'warning',
        });
        return { ok: false };
      }
      try {
        const res = await apiFetch('/api/copy-trading/mirror', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId, symbol, direction }),
        });
        const data = await res.json();
        if (data?.forgeCapitalState) {
          setForgeCapitalState(data.forgeCapitalState as ForgeCapitalHubState);
        }
        if (!res.ok || !data?.ok) return { ok: false };
        if (Array.isArray(data.accounts)) setCopyAccounts(data.accounts);
        if (Array.isArray(data.mirroredHistory)) setMirroredCopyHistory(data.mirroredHistory);
        await refreshExecutionState();
        pushNotification({
          category: 'EXECUTION',
          title: `Institutional Desk Mirrored · ${symbol}`,
          message: `Mirrored ${data.mirroredPlan.accountHandle} (${direction} · 2.0% Max Risk · 1:${data.mirroredPlan.riskRewardRatio} R:R)`,
          symbol,
          severity: 'success',
        });
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },
    [refreshExecutionState, pushNotification]
  );

  const executeVoiceCommand = useCallback(
    async (transcript: string, confidence = 0.95) => {
      const parsed = parseVoiceCommandTranscript(transcript, confidence);
      let summary = parsed.summary;

      if (parsed.intent === 'STOP') {
        await setAppLiveEnabled(false);
      } else if (parsed.intent === 'RESUME') {
        await setAppLiveEnabled(true);
      } else if (parsed.intent === 'EMERGENCY_LIQUIDATE') {
        const liq = await triggerEmergencyLiquidation(
          'USDT',
          `Voice Emergency Command: "${parsed.transcript}"`
        );
        summary = `${parsed.summary} (${liq.liquidatedCount ?? 0} positions settled into USDT).`;
      } else if (parsed.intent === 'RUN_TICK') {
        await runAutonomousCycleNow();
      } else if (parsed.intent === 'RUN_AUDIT') {
        await Promise.all([refreshOrderBookDepth(undefined, true), triggerSentinelAudit()]);
      } else if (parsed.intent === 'STATUS') {
        summary = `App Live: ${appLiveEnabledRef.current ? 'ON' : 'HALTED'} · Active Pairs Tracked · Spot WS: ${wsConnectedRef.current ? 'Connected' : 'Fallback'}.`;
      }

      const entry: VoiceAgentLogEntry = {
        id: `voice_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        transcript: parsed.transcript,
        intent: parsed.intent,
        summary,
        mode: voiceModeRef.current,
        timestamp: parsed.timestamp,
      };

      setVoiceAgent((prev) => ({
        ...prev,
        lastTranscript: parsed.transcript,
        lastIntent: parsed.intent,
        lastActionSummary: summary,
        history: [entry, ...prev.history].slice(0, 12),
      }));

      return {
        intent: parsed.intent,
        summary,
        routeTarget: parsed.routeTarget,
      };
    },
    [
      setAppLiveEnabled,
      triggerEmergencyLiquidation,
      runAutonomousCycleNow,
      refreshOrderBookDepth,
      triggerSentinelAudit,
    ]
  );

  const executeVoiceCommandRef = useRef(executeVoiceCommand);
  executeVoiceCommandRef.current = executeVoiceCommand;

  const stopVoiceListening = useCallback(() => {
    try {
      speechRecognitionRef.current?.stop();
    } catch {
      // ignore stop error
    }
    setVoiceAgent((prev) => ({
      ...prev,
      mode: prev.mode === 'ALWAYS_LISTENING' ? 'STANDBY' : prev.mode,
      listening: false,
    }));
    try {
      localStorage.setItem(VOICE_AGENT_STORAGE_KEY, 'STANDBY');
    } catch {
      // ignore storage quota
    }
  }, []);

  const setVoiceMode = useCallback((mode: VoiceListeningMode) => {
    voiceModeRef.current = mode;
    try {
      localStorage.setItem(VOICE_AGENT_STORAGE_KEY, mode);
    } catch {
      // ignore storage error
    }
    if (mode === 'STANDBY') {
      try {
        speechRecognitionRef.current?.stop();
      } catch {
        // ignore
      }
    }
    setVoiceAgent((prev) => ({
      ...prev,
      mode,
      listening: mode === 'ALWAYS_LISTENING' && prev.supportedInBrowser,
      lastActionSummary:
        mode === 'ALWAYS_LISTENING'
          ? 'Always-Listening Emergency Stop Guard Armed — say "Stop", "Resume", or "Emergency Liquidate".'
          : mode === 'PUSH_TO_TALK'
          ? 'Push-to-Talk mode active — hold or click Mic to speak commands.'
          : 'Voice Command Agent placed in Standby.',
    }));
  }, []);

  const startPushToTalk = useCallback(() => {
    const SpeechRec =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;
    if (!SpeechRec) {
      setVoiceAgent((prev) => ({
        ...prev,
        mode: 'PUSH_TO_TALK',
        listening: false,
        lastActionSummary:
          'Browser SpeechRecognition unavailable — use Instant Voice Quick Triggers or type a voice phrase below.',
      }));
      return;
    }
    try {
      speechRecognitionRef.current?.stop();
    } catch {
      // ignore previous instance
    }
    try {
      const rec = new SpeechRec();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = 'en-US';
      rec.onresult = (ev: any) => {
        const res = ev?.results?.[0]?.[0];
        if (res?.transcript) {
          executeVoiceCommandRef.current(res.transcript, res.confidence ?? 0.95);
        }
      };
      rec.onend = () => {
        setVoiceAgent((prev) => ({
          ...prev,
          listening: prev.mode === 'ALWAYS_LISTENING',
        }));
      };
      rec.onerror = () => {
        setVoiceAgent((prev) => ({ ...prev, listening: false }));
      };
      speechRecognitionRef.current = rec;
      rec.start();
      setVoiceAgent((prev) => ({
        ...prev,
        mode: 'PUSH_TO_TALK',
        listening: true,
        lastActionSummary: 'Listening for Push-to-Talk command...',
      }));
    } catch {
      setVoiceAgent((prev) => ({ ...prev, listening: false }));
    }
  }, []);

  // Background Always-Listening Web Speech service for hands-free emergency 'Stop'
  useEffect(() => {
    if (voiceAgent.mode !== 'ALWAYS_LISTENING') return;
    const SpeechRec =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;
    if (!SpeechRec) return;

    let disposed = false;
    let rec: any = null;
    const boot = () => {
      if (disposed || voiceModeRef.current !== 'ALWAYS_LISTENING') return;
      try {
        rec = new SpeechRec();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'en-US';
        rec.onresult = (ev: any) => {
          const idx = ev?.results?.length ? ev.results.length - 1 : 0;
          const item = ev?.results?.[idx];
          const alt = item?.[0];
          const text = String(alt?.transcript || '').trim();
          if (!text) return;
          if (item?.isFinal || /\bstop\b/i.test(text) || /\bliquidate\b/i.test(text)) {
            executeVoiceCommandRef.current(text, alt?.confidence ?? 0.92);
          }
        };
        rec.onend = () => {
          if (!disposed && voiceModeRef.current === 'ALWAYS_LISTENING') {
            window.setTimeout(boot, 450);
          }
        };
        rec.onerror = () => {
          // Wait cleanly for manual toggle or next cycle
        };
        speechRecognitionRef.current = rec;
        rec.start();
      } catch {
        // microphone permissions declined or busy
      }
    };
    boot();

    return () => {
      disposed = true;
      try {
        rec?.stop();
      } catch {
        // ignore stop failure
      }
    };
  }, [voiceAgent.mode]);

  // Read-only hydration of microservice architecture, subscription gate, and runtime controls on mount (no unauthenticated POST mutations)
  useEffect(() => {
    refreshArchitectureAndSubscription().catch(() => undefined);
    fetch('/api/system/app-live')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.ok) {
          if (typeof d.appLiveEnabled === 'boolean') {
            appLiveEnabledRef.current = d.appLiveEnabled;
            setAppLiveEnabledState(d.appLiveEnabled);
          }
          setAppLiveMeta({
            quotaSavedCalls: Number(d.quotaSavedCalls ?? 0),
            toggledAt: d.toggledAt ? String(d.toggledAt) : null,
          });
        }
      })
      .catch(() => undefined);
  }, [refreshArchitectureAndSubscription]);

  // Initial core hydration (Telegram + Reports + Execution + Depth + Sentinel + Autonomous + RL + Liquidation + Arb + Copy + WS Verify)
  useEffect(() => {
    refreshTelegramFeed();
    refreshExecutionState();
    refreshAutoReports();
    refreshDigestStatus();
    refreshSpotFeed(false);
    refreshOrderBookDepth(undefined, false);
    refreshSentinelStatus();
    refreshAutonomousState();
    refreshRlTuning();
    refreshLiquidationState();
    refreshArbitrageStatus();
    refreshCopyTradingStatus();
    refreshWsVerification();
  }, [
    refreshTelegramFeed,
    refreshExecutionState,
    refreshAutoReports,
    refreshDigestStatus,
    refreshSpotFeed,
    refreshOrderBookDepth,
    refreshSentinelStatus,
    refreshAutonomousState,
    refreshRlTuning,
    refreshLiquidationState,
    refreshArbitrageStatus,
    refreshCopyTradingStatus,
    refreshWsVerification,
  ]);

  // High-frequency live feed REST polling (immediately halted when App Live or Live Feed Modules toggle is OFF)
  useEffect(() => {
    if (!appLiveEnabled || !liveFeedModulesEnabled) return;
    refreshCmcValuations(false);
    const id = window.setInterval(() => {
      refreshSpotFeed(true);
      refreshCmcValuations(false);
      refreshDigestStatus();
      refreshOrderBookDepth(undefined, false);
      refreshSentinelStatus();
      refreshAutonomousState();
      refreshExecutionState();
      refreshRlTuning();
      refreshLiquidationState();
      refreshArbitrageStatus();
      refreshCopyTradingStatus();
      refreshWsVerification();
      if (futuresTradingEnabledRef.current) {
        refreshFuturesFeed(true);
      }
    }, TELEMETRY_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [
    appLiveEnabled,
    liveFeedModulesEnabled,
    refreshSpotFeed,
    refreshCmcValuations,
    refreshFuturesFeed,
    refreshDigestStatus,
    refreshOrderBookDepth,
    refreshSentinelStatus,
    refreshAutonomousState,
    refreshExecutionState,
    refreshRlTuning,
    refreshLiquidationState,
    refreshArbitrageStatus,
    refreshCopyTradingStatus,
    refreshWsVerification,
  ]);

  // Connect to Autonomous Backend Monitoring Agent SSE Stream (halted when App Live or Live Feed Modules are OFF)
  useEffect(() => {
    if (!appLiveEnabled || !liveFeedModulesEnabled) {
      return;
    }
    let currentEs: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;
    let disposed = false;

    const pushMonitorHealthIfSignificant = (next: BackendHealthSnapshot) => {
      const now = Date.now();
      const elapsed = now - lastMonitorUiSyncRef.current.atMs;
      if (shouldSyncMonitorHealthUi(lastMonitorUiSyncRef.current.snapshot, next, elapsed, 3000)) {
        lastMonitorUiSyncRef.current = { snapshot: next, atMs: now };
        setMonitorHealth(next);
      }
    };

    const pullHealthFallback = async () => {
      try {
        const res = await fetch('/api/monitor/health');
        if (res.ok) {
          const data = await res.json();
          if (data?.monitor && !disposed) pushMonitorHealthIfSignificant(data.monitor);
        }
      } catch {
        // silent fallback loop
      }
    };

    const cleanupEventSource = (target: EventSource | null) => {
      if (!target) return;
      target.onopen = null;
      target.onerror = null;
      try {
        target.close();
      } catch {
        // ignore close failure
      }
    };

    const connectStream = () => {
      if (disposed) return;
      cleanupEventSource(currentEs);
      currentEs = null;
      try {
        const es = new EventSource('/api/monitor/stream');
        currentEs = es;

        const handleHeartbeat = (ev: Event) => {
          if (disposed || currentEs !== es) return;
          try {
            const parsed = JSON.parse((ev as MessageEvent).data) as BackendHealthSnapshot;
            attempt = 0;
            pushMonitorHealthIfSignificant(parsed);
          } catch {
            // ignore malformed frame
          }
        };

        const handleSpotTicks = (ev: Event) => {
          if (disposed || currentEs !== es) return;
          try {
            const payload = JSON.parse((ev as MessageEvent).data) as {
              ticks?: Array<{
                symbol: string;
                price?: number;
                markPrice?: number;
                volume24hUsd?: number;
                change24hPercent?: number;
                high24h?: number;
                low24h?: number;
              }>;
              syncEpoch?: number;
            };
            const ticks = Array.isArray(payload?.ticks) ? payload.ticks : [];
            if (ticks.length === 0) return;

            setSpotFeedSource('binance_spot');

            // Supplement browser WS cleanly with backend Spot ticks whenever browser WS isn't currently open
            if (!wsConnectedRef.current) {
              const liveWsPriceMap: Record<string, number> = {};
              const validTicks: Array<{
                symbol: string;
                price: number;
                change24hPercent?: number;
                high24h?: number;
                low24h?: number;
                volume24hUsd?: number;
              }> = [];
              let newlyLiveWs = false;
              const ctrl = wsControllerRef.current;

              for (const t of ticks) {
                const p = Number(t.price ?? t.markPrice ?? 0);
                const check = ctrl
                  ? ctrl.ingestExternalValidatedTick({
                      symbol: t.symbol,
                      price: p,
                      change24hPercent: t.change24hPercent,
                      high24h: t.high24h,
                      low24h: t.low24h,
                      volume24hUsd: t.volume24hUsd,
                      source: 'ws',
                    })
                  : { accepted: Number.isFinite(p) && p > 0 };
                if (!check.accepted) continue;
                liveWsPriceMap[t.symbol] = p;
                if (!signalTickersWsSeededRef.current.has(t.symbol)) {
                  signalTickersWsSeededRef.current.add(t.symbol);
                  newlyLiveWs = true;
                }
                validTicks.push({
                  symbol: t.symbol,
                  price: p,
                  change24hPercent: t.change24hPercent,
                  high24h: t.high24h,
                  low24h: t.low24h,
                  volume24hUsd: t.volume24hUsd,
                });
              }

              if (validTicks.length > 0) {
                const applyTicksToMap = (prev: Record<string, TickerSnapshot>) => {
                  const next = { ...prev };
                  let changed = false;
                  for (const t of validTicks) {
                    const ex = next[t.symbol];
                    if (!ex) continue;
                    const nextChg = t.change24hPercent ?? ex.change24hPercent;
                    const nextVol = t.volume24hUsd ?? ex.volume24hUsd;
                    if (
                      Math.abs(ex.price - t.price) <= 1e-8 &&
                      nextChg === ex.change24hPercent &&
                      nextVol === ex.volume24hUsd &&
                      ex.isLiveWs
                    ) {
                      continue;
                    }
                    next[t.symbol] = {
                      ...ex,
                      price: t.price,
                      change24hPercent: nextChg,
                      high24h: t.high24h ?? Math.max(ex.high24h, t.price),
                      low24h: t.low24h ?? Math.min(ex.low24h, t.price),
                      volume24hUsd: nextVol,
                      isLiveWs: true,
                    };
                    changed = true;
                  }
                  return changed ? next : prev;
                };

                setTickers(applyTicksToMap);
                if (newlyLiveWs) {
                  setSignalTickers(applyTicksToMap);
                }
              }
              if (Object.keys(liveWsPriceMap).length > 0) {
                reconcileStateAgainstAuthoritativePrices(liveWsPriceMap);
              }
            }
          } catch {
            // ignore malformed tick event
          }
        };

        es.addEventListener('heartbeat', handleHeartbeat);
        es.addEventListener('spot_ticks', handleSpotTicks);
        es.onopen = () => {
          if (disposed || currentEs !== es) return;
          attempt = 0;
        };
        es.onerror = () => {
          if (currentEs !== es) {
            es.removeEventListener('heartbeat', handleHeartbeat);
            es.removeEventListener('spot_ticks', handleSpotTicks);
            cleanupEventSource(es);
            return;
          }
          es.removeEventListener('heartbeat', handleHeartbeat);
          es.removeEventListener('spot_ticks', handleSpotTicks);
          cleanupEventSource(es);
          currentEs = null;
          if (disposed) return;
          pullHealthFallback();
          if (attempt >= MAX_WS_RECONNECT_ATTEMPTS) return;
          const delayMs = computeExponentialReconnectDelayMs(attempt);
          attempt += 1;
          if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
          reconnectTimer = window.setTimeout(connectStream, delayMs);
        };
      } catch {
        pullHealthFallback();
      }
    };

    pullHealthFallback();
    connectStream();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      cleanupEventSource(currentEs);
      currentEs = null;
    };
  }, [appLiveEnabled, liveFeedModulesEnabled, reconcileStateAgainstAuthoritativePrices]);

  // Live mark-to-market Cross-Margin equity summary computed against live tickers
  const liveCrossMargin = useMemo<CrossMarginWalletSummary>(() => {
    const priceMap: Record<string, number> = {};
    for (const [sym, tk] of Object.entries(tickers)) {
      priceMap[sym] = tk.price;
    }
    return summarizeCrossMarginWallet(
      executionState.testnetBalanceUsd,
      executionState.positions,
      priceMap
    );
  }, [executionState.testnetBalanceUsd, executionState.positions, tickers]);

  const routeSignalToTelegram = useCallback(
    async (plan: CoordinatedTradePlan, manual = false): Promise<boolean> => {
      if (!appLiveEnabledRef.current && !manual) return false;
      const hourBucket = new Date().toISOString().slice(0, 13);
      const dedupeKey = manual
        ? `${plan.symbol}_${plan.direction}_manual_${Date.now()}`
        : `${plan.symbol}_${plan.direction}_${hourBucket}`;

      if (!manual && routedTelegramKeysRef.current.has(dedupeKey)) {
        return false;
      }
      if (routedTelegramKeysRef.current.size > 400) {
        routedTelegramKeysRef.current.clear();
      }
      routedTelegramKeysRef.current.add(dedupeKey);

      try {
        const res = await apiFetch('/api/telegram/signal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: plan.symbol,
            direction: plan.direction,
            confidence: plan.confidence,
            message: plan.telegramMessage,
            dedupeKey,
          }),
        });
        const data = await res.json();
        if (data.ok && data.post) {
          setTelegramFeed((prev) => {
            const exists = prev.some((p) => p.id === data.post.id);
            return exists ? prev : [data.post, ...prev].slice(0, 40);
          });
          if (!data.deduped) {
            pushNotification({
              category: 'TELEGRAM',
              title: `Routed to "Signal Forge" · ${plan.symbol}`,
              message: `${plan.direction} ${plan.futuresMargin.leverage}x ${plan.futuresMargin.marginMode} (${plan.confidence}%) · ATR Trail $${formatCryptoPrice(plan.riskPlan.trailingStopLoss)}`,
              symbol: plan.symbol,
              severity: 'success',
            });
          }
          return true;
        }
      } catch {
        // ignore transient error
      }
      return false;
    },
    [pushNotification]
  );

  const switchExecutionMode = useCallback(
    async (mode: ExecutionEnvironment) => {
      if (mode === 'LIVE') return; // LIVE requires Security Modal OTP + question mark verification
      try {
        const res = await apiFetch('/api/execution/mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode }),
        });
        const data = await res.json();
        if (data.ok) {
          setExecutionState((prev) => ({
            ...prev,
            mode: 'TESTNET',
            endpoint: String(data.endpoint),
            liveConfigured: Boolean(data.liveConfigured),
            warning: data.warning ?? null,
          }));
          pushNotification({
            category: 'EXECUTION',
            title: 'Switched to Binance Futures TESTNET',
            message: `USD-M Futures Cross-Margin routed safely back to ${String(data.endpoint)}.`,
            severity: 'info',
          });
        }
      } catch {
        // ignore transient failure
      }
    },
    [pushNotification]
  );

  const requestLiveSwitchOtp = useCallback(async () => {
    try {
      const res = await apiFetch('/api/security/live-otp/request', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        return { ok: false, error: data.error || 'Unable to generate email OTP.' };
      }
      const deliveryMode: 'email' | 'server_log' =
        data.deliveryMode === 'email' ? 'email' : 'server_log';
      const challenge: LiveOtpChallengeState = {
        challengeId: String(data.challengeId),
        recipient: String(data.recipient),
        expiresAt: String(data.expiresAt),
        emailSent: Boolean(data.emailSent),
        deliveryMode,
      };
      pushNotification({
        category: 'EXECUTION',
        title: `Live Switch Email OTP Dispatched (${challenge.recipient})`,
        message: challenge.emailSent
          ? `6-digit Live Futures OTP emailed to ${challenge.recipient} (valid 5 min).`
          : `6-digit Live Futures OTP issued (valid 5 min). Check configured email inbox or operator server console.`,
        severity: 'warning',
      });
      return { ok: true, challenge };
    } catch {
      return { ok: false, error: 'Network error requesting email OTP.' };
    }
  }, [pushNotification]);

  const confirmSwitchToLive = useCallback(
    async (params: {
      challengeId: string;
      securityAnswer: string;
      otpCode: string;
    }): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await apiFetch('/api/execution/mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'LIVE',
            challengeId: params.challengeId,
            securityAnswer: params.securityAnswer,
            otpCode: params.otpCode,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          return { ok: false, error: data.error || 'Verification rejected.' };
        }
        setHasSwitchedLiveOnce(true);
        setExecutionState((prev) => ({
          ...prev,
          mode: 'LIVE',
          endpoint: String(data.endpoint),
          liveConfigured: Boolean(data.liveConfigured),
          warning: data.warning ?? null,
        }));
        pushNotification({
          category: 'EXECUTION',
          title: 'Verified Switch to Binance Futures LIVE Mode',
          message:
            data.warning ||
            `Verified by Question-Mark Challenge & Email OTP · ${String(data.endpoint)}.`,
          severity: 'warning',
        });
        return { ok: true };
      } catch {
        return { ok: false, error: 'Network error validating Live verification.' };
      }
    },
    [pushNotification]
  );

  const executeCoordinatorOrder = useCallback(
    async (
      plan: CoordinatedTradePlan,
      options?: {
        notionalUsd?: number;
        leverage?: number;
        marginMode?: MarginMode;
      }
    ): Promise<{ ok: boolean; error?: string }> => {
      if (forgeCapitalRef.current.failSafe.engaged || forgeCapitalRef.current.allTradingHalted) {
        const msg = `EMERGENCY_HALT (423 Locked) [${forgeCapitalRef.current.failSafe.immutableSealId || 'LOCKED'}] halted all Spot, Futures, and WebSocket order generation.`;
        pushNotification({
          category: 'EXECUTION',
          title: 'EMERGENCY_HALT (423 Locked)',
          message: msg,
          symbol: plan.symbol,
          severity: 'warning',
        });
        return { ok: false, error: msg };
      }
      if (!systemControlsRef.current.testnetExecutionEnabled && executionState.mode === 'TESTNET') {
        const msg =
          'Binance Testnet Execution is paused via Master Toggle. Enable Testnet Execution above to place orders.';
        pushNotification({
          category: 'EXECUTION',
          title: 'Testnet Execution Paused',
          message: msg,
          symbol: plan.symbol,
          severity: 'warning',
        });
        return { ok: false, error: msg };
      }
      if (plan.skeptic.verdict === 'VETOED') {
        pushNotification({
          category: 'SKEPTIC',
          title: `Skeptic Agent Vetoed ${plan.symbol}`,
          message: plan.skeptic.challenges[0] || plan.skeptic.mitigationNote,
          symbol: plan.symbol,
          severity: 'warning',
        });
        return { ok: false, error: 'Blocked by Skeptic Validation Agent.' };
      }

      const isFuturesOrder = futuresTradingEnabledRef.current && plan.marketType === 'USD_M_FUTURES';
      const targetModuleId: ForgeModuleId =
        plan.sourceModule === 'SMC_FRVP' || plan.sourceModule === 'PATTERN_SCANNER'
          ? 'SMC_FRVP_DESK'
          : isFuturesOrder
          ? 'FUTURES_COORDINATOR'
          : 'SPOT_MOMENTUM';
      const notional = options?.notionalUsd ?? plan.futuresMargin.notionalUsd;
      const leverage = isFuturesOrder ? (options?.leverage ?? plan.futuresMargin.leverage) : 1;
      const marginMode = options?.marginMode ?? plan.futuresMargin.marginMode;
      // Strict execution price synchronization directly against primary Binance Spot (or active Futures) feed
      const liveMarkPrice =
        tickers[plan.symbol]?.price ??
        (isFuturesOrder ? futuresTelemetry[plan.symbol]?.markPrice : undefined) ??
        plan.entryPrice;
      const atrTrailSl =
        plan.riskPlan.trailingStopLoss > 0
          ? plan.riskPlan.trailingStopLoss
          : Number(
              (plan.direction === 'BUY'
                ? liveMarkPrice * 0.985
                : liveMarkPrice * 1.015
              ).toPrecision(6)
            );

      try {
        const res = await apiFetch('/api/execution/order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: plan.symbol,
            direction: plan.direction,
            marketType: isFuturesOrder ? 'USD_M_FUTURES' : 'SPOT',
            moduleId: targetModuleId,
            entryPrice: liveMarkPrice,
            notionalUsd: notional,
            leverage,
            marginMode,
            initialStopLoss: plan.riskPlan.initialStopLoss,
            trailingStopLoss: atrTrailSl,
            takeProfits: plan.riskPlan.takeProfits,
            skepticVerdict: plan.skeptic.verdict,
            fundingRate: isFuturesOrder ? (plan.futuresTelemetry?.fundingRate ?? 0.0001) : 0,
            syncToLiveMark: true,
          }),
        });
        const data = await res.json();
        if (data.forgeCapitalState) {
          setForgeCapitalState(data.forgeCapitalState as ForgeCapitalHubState);
        }
        if (!res.ok || !data.ok) {
          return { ok: false, error: data.error || 'Execution order request failed' };
        }
        setExecutionState((prev) => ({
          ...prev,
          testnetBalanceUsd: Number(data.testnetBalanceUsd ?? prev.testnetBalanceUsd),
          crossMargin: data.crossMargin || prev.crossMargin,
          totalExecutedOrders: prev.totalExecutedOrders + 1,
          positions: [data.position, ...prev.positions].slice(0, 30),
        }));
        const filledPrice = Number(data.validatedPrice || data.position.entryPrice || liveMarkPrice);
        pushNotification({
          category: 'EXECUTION',
          title: `${executionState.mode} ${isFuturesOrder ? `Futures (${data.position.leverage}x)` : 'Spot (1x)'} Filled · ${plan.symbol}`,
          message: `${plan.direction} $${notional} synced @ $${formatCryptoPrice(filledPrice)} · ATR Trail SL $${formatCryptoPrice(data.position.trailingStopLoss)}`,
          symbol: plan.symbol,
          severity: 'success',
        });
        return { ok: true };
      } catch {
        return { ok: false, error: 'Network error placing execution order.' };
      }
    },
    [executionState.mode, futuresTelemetry, tickers, pushNotification]
  );

  const closeSandboxPosition = useCallback(
    async (positionId: string, currentPrice: number) => {
      if (!systemControlsRef.current.testnetExecutionEnabled && executionState.mode === 'TESTNET') {
        pushNotification({
          category: 'EXECUTION',
          title: 'Testnet Execution Paused',
          message: 'Enable Binance Testnet Execution above to close and settle open positions.',
          severity: 'warning',
        });
        return;
      }
      try {
        const res = await apiFetch('/api/execution/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ positionId, exitPrice: currentPrice }),
        });
        const data = await res.json();
        if (data.forgeCapitalState) {
          setForgeCapitalState(data.forgeCapitalState as ForgeCapitalHubState);
        }
        if (data.ok && data.position) {
          setExecutionState((prev) => ({
            ...prev,
            testnetBalanceUsd: Number(data.testnetBalanceUsd ?? prev.testnetBalanceUsd),
            crossMargin: data.crossMargin || prev.crossMargin,
            positions: prev.positions.map((p) => (p.id === positionId ? data.position : p)),
          }));
          refreshAutoReports();
          pushNotification({
            category: 'EXECUTION',
            title: `Settled ${data.position.symbol} Cross-Margin (${data.position.mode})`,
            message: `Net Realized P&L: ${data.position.pnlUsd >= 0 ? '+' : ''}$${data.position.pnlUsd} (ROE ${data.position.roePercent ?? data.position.pnlPercent}%)`,
            symbol: data.position.symbol,
            severity: data.position.pnlUsd >= 0 ? 'success' : 'warning',
          });
        }
      } catch {
        // ignore transient errors
      }
    },
    [executionState.mode, pushNotification, refreshAutoReports]
  );

  const settleCrossMarginCycle = useCallback(async () => {
    if (!systemControlsRef.current.testnetExecutionEnabled && executionState.mode === 'TESTNET') {
      pushNotification({
        category: 'EXECUTION',
        title: 'Testnet Execution Paused',
        message: 'Enable Binance Testnet Execution above to settle funding cycles.',
        severity: 'warning',
      });
      return;
    }
    try {
      const res = await apiFetch('/api/execution/settle-cross', { method: 'POST' });
      const data = await res.json();
      if (data.forgeCapitalState) {
        setForgeCapitalState(data.forgeCapitalState as ForgeCapitalHubState);
      }
      if (data.ok) {
        setExecutionState((prev) => ({
          ...prev,
          testnetBalanceUsd: Number(data.testnetBalanceUsd ?? prev.testnetBalanceUsd),
          crossMargin: data.crossMargin || prev.crossMargin,
          positions: Array.isArray(data.positions) ? data.positions : prev.positions,
        }));
        const delta = Number(data.fundingDeltaUsd || 0);
        pushNotification({
          category: 'EXECUTION',
          title: 'Cross-Margin Funding Cycle Settled',
          message: `8H Funding Settlement: ${delta >= 0 ? '+' : ''}$${delta.toFixed(4)} applied across shared Cross Wallet ($${Number(data.testnetBalanceUsd).toLocaleString()}).`,
          severity: delta >= 0 ? 'success' : 'info',
        });
      }
    } catch {
      // ignore transient errors
    }
  }, [executionState.mode, pushNotification]);

  const dispatchPerformanceReport = useCallback(
    async (
      period: 'DAILY' | 'WEEKLY' | 'MONTHLY'
    ): Promise<{ ok: boolean; summary?: string }> => {
      try {
        const res = await apiFetch('/api/reports/performance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ period }),
        });
        const data = await res.json();
        if (data.ok && data.record) {
          if (data.report) {
            setAutoReports((prev) => {
              const filtered = prev.filter((r) => r.period !== data.report.period);
              const next = [...filtered, data.report as StructuredPerformanceReport];
              const order = { DAILY: 0, WEEKLY: 1, MONTHLY: 2 };
              return next.sort((a, b) => order[a.period] - order[b.period]);
            });
          } else {
            await refreshAutoReports();
          }
          await refreshTelegramFeed();
          pushNotification({
            category: 'DIGEST',
            title: `${period} Auto-Report Generated & Dispatched`,
            message: `${data.record.summary} (Dashboard + Email + "Signal Forge" Telegram)`,
            severity: 'success',
          });
          return { ok: true, summary: data.record.summary };
        }
      } catch {
        // ignore error
      }
      return { ok: false };
    },
    [pushNotification, refreshTelegramFeed, refreshAutoReports]
  );

  const dispatchSignalDigestNow = useCallback(async (): Promise<{
    ok: boolean;
    summary?: string;
  }> => {
    try {
      const res = await apiFetch('/api/digest/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      if (data.ok && data.record) {
        await Promise.all([refreshDigestStatus(), refreshTelegramFeed()]);
        pushNotification({
          category: 'DIGEST',
          title: '3-Hour Batched Signal Digest Dispatched',
          message: data.record.summary,
          severity: 'success',
        });
        return { ok: true, summary: data.record.summary };
      }
    } catch {
      // ignore transient error
    }
    return { ok: false };
  }, [pushNotification, refreshDigestStatus, refreshTelegramFeed]);

  // Sync Top 6–12 Pinned Signals & Continuously Evaluate Live Outcomes Against Streaming Prices
  const syncPinnedCandidates = useCallback(
    (candidates: TradingSignal[], candlesMap: Record<string, Candle[]>) => {
      if (!candidates || candidates.length === 0) return;
      setPinnedSignals((prev) => {
        const next = syncPinnedSignals(prev, candidates, candlesMap, MAX_PINNED_SIGNALS);
        if (next === prev) return prev;
        try {
          localStorage.setItem(PINNED_SIGNALS_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore storage quota errors
        }
        return next;
      });
    },
    []
  );

  const rotateResolvedPinned = useCallback(
    (candidates: TradingSignal[], candlesMap: Record<string, Candle[]>) => {
      setPinnedSignals((prev) => {
        const next = rotateResolvedPinnedSignals(
          prev,
          candidates,
          candlesMap,
          MAX_PINNED_SIGNALS
        );
        try {
          localStorage.setItem(PINNED_SIGNALS_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    []
  );

  useEffect(() => {
    if (pinnedSignalsRef.current.length === 0) return;
    const livePriceMap: Record<string, number> = {};
    for (const [sym, tk] of Object.entries(tickers)) {
      livePriceMap[sym] = tk.price;
    }
    setPinnedSignals((prev) => {
      if (prev.length === 0) return prev;
      const updated = evaluatePinnedSignalsLiveOutcome(prev, livePriceMap);
      if (updated === prev) return prev;
      try {
        localStorage.setItem(PINNED_SIGNALS_STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  }, [tickers]);

  // Continuously enforce ATR Trailing Stop Loss progression across open positions (paused cleanly when App Live, Execution, or Live Modules are OFF)
  useEffect(() => {
    if (!appLiveEnabled || !testnetExecutionEnabled || !liveFeedModulesEnabled || !hasOpenPositionsRef.current) return;
    setExecutionState((prev) => {
      const hasOpen = prev.positions.some((p) => p.status === 'OPEN');
      if (!hasOpen) return prev;
      let mutated = false;
      const updatedPositions = prev.positions.map((pos) => {
        if (pos.status !== 'OPEN') return pos;
        const livePrice = tickers[pos.symbol]?.price ?? pos.entryPrice;
        const nextTrail = advanceAtrTrailingStop(pos, livePrice, livePrice * 0.014);
        if (nextTrail !== pos.trailingStopLoss) {
          mutated = true;
          return { ...pos, trailingStopLoss: nextTrail };
        }
        return pos;
      });
      return mutated ? { ...prev, positions: updatedPositions } : prev;
    });
  }, [tickers, appLiveEnabled, testnetExecutionEnabled, liveFeedModulesEnabled]);

  const [localWatchlist, setLocalWatchlist] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(WATCHLIST_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  });

  const [cloudWatchlist, setCloudWatchlist] = useState<UserWatchlistEntry[] | null>(null);

  const [localAlerts, setLocalAlerts] = useState<LocalPriceAlert[]>(() => {
    try {
      const saved = localStorage.getItem(ALERTS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  });

  const [cloudAlerts, setCloudAlerts] = useState<UserPriceAlert[] | null>(null);
  const triggeredIdsRef = useRef<Set<string>>(new Set());

  // Initialize Firebase connection check and auth listener
  useEffect(() => {
    testFirestoreConnection().catch(() => undefined);
    const unsub = subscribeAuth((u) => {
      setUser(u);
      setAuthReady(true);
      if (u && u.emailVerified) {
        syncUserProfile(u).catch(() => undefined);
      }
      refreshArchitectureAndSubscription().catch(() => undefined);
    });
    return () => unsub();
  }, [refreshArchitectureAndSubscription]);

  // Subscribe to Firestore Watchlist, Alerts & Persisted Workspace Control Matrix when verified user is signed in
  const verifiedUid = authReady && user && user.emailVerified ? user.uid : null;
  useEffect(() => {
    if (!verifiedUid) {
      setCloudWatchlist(null);
      setCloudAlerts(null);
      return;
    }

    const unsubWatch = subscribeWatchlist(
      verifiedUid,
      (items) => setCloudWatchlist(items),
      () => setCloudWatchlist(null)
    );
    const unsubAlerts = subscribePriceAlerts(
      verifiedUid,
      (items) => setCloudAlerts(items),
      () => setCloudAlerts(null)
    );
    const unsubConfig = subscribeWorkspaceControlConfig(
      verifiedUid,
      (cfg) => {
        if (!cfg) return;
        const parsed = parseGranularControlMatrix(
          cfg.toggles,
          architectureStateRef.current.controlMatrix
        );
        if (
          subscriptionSummaryRef.current.premiumUnlocked &&
          cfg.checksum &&
          cfg.checksum !== architectureStateRef.current.matrixChecksum
        ) {
          apiFetch('/api/architecture/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              patch: parsed,
              reason: 'Restored persisted Firestore workspace matrix',
            }),
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
              if (data?.architecture) {
                const nextArch = data.architecture as MicroservicePlatformState;
                architectureStateRef.current = nextArch;
                setArchitectureState(nextArch);
                applySyncedMatrixToLocal(nextArch.controlMatrix);
              }
            })
            .catch(() => undefined);
        }
      },
      () => undefined
    );

    return () => {
      unsubWatch();
      unsubAlerts();
      unsubConfig();
    };
  }, [verifiedUid, applySyncedMatrixToLocal]);

  // Continuous Binance Top Gainers Feeder polling (recalibrated 12s latency cycle)
  const refreshTopGainers = useCallback(
    async (force = false) => {
      const t0 = performance.now();
      try {
        const res = await fetch(`/api/binance/top-gainers${force ? '?refresh=1' : ''}`);
        if (!res.ok) return;
        const data = await res.json();
        const rtt = performance.now() - t0;
        const gainers: TopGainerCoin[] = Array.isArray(data.gainers) ? data.gainers : [];
        const serverAlerts: GainerAlertEvent[] = Array.isArray(data.alerts) ? data.alerts : [];

        if (gainers.length > 0) {
          setTopGainers(gainers);
          setGainerSource(data.source === 'binance' ? 'binance' : 'cache');
          setGainerUpdatedAt(String(data.updatedAt || new Date().toISOString()));

          setTickers((prev) => {
            const next = { ...prev };
            let mutated = false;
            for (const g of gainers) {
              const existing = next[g.symbol];
              if (
                !existing ||
                (!existing.isLiveWs &&
                  (Math.abs(existing.price - g.price) > 1e-8 ||
                    existing.change24hPercent !== g.change24hPercent ||
                    existing.volume24hUsd !== g.volume24hUsd))
              ) {
                next[g.symbol] = {
                  symbol: g.symbol,
                  baseAsset: g.baseAsset,
                  name: g.name,
                  price: g.price,
                  change24hPercent: g.change24hPercent,
                  high24h: g.high24h,
                  low24h: g.low24h,
                  volume24hUsd: g.volume24hUsd,
                  isLiveWs: existing?.isLiveWs ?? false,
                };
                mutated = true;
              }
              if (!baselineGainerPctRef.current.has(g.symbol)) {
                baselineGainerPctRef.current.set(g.symbol, g.change24hPercent);
              }
            }
            return mutated ? next : prev;
          });

          setTelemetryMetrics((prev) =>
            updateLatencyMetrics(prev, rtt, {
              fallbackEnforced: !wsConnectedRef.current && data.source !== 'binance',
              syncEpoch: Number(data.syncEpoch || prev.syncEpoch),
              flushedFramesTotal: wsBufferRef.current.getFlushedFramesTotal(),
            })
          );
        }

        if (serverAlerts.length > 0) {
          setGainerAlerts(serverAlerts);
          if (sessionInitialGainerLoadRef.current) {
            for (const a of serverAlerts) {
              seenGainerAlertIdsRef.current.add(a.id);
            }
            sessionInitialGainerLoadRef.current = false;
          } else {
            const fresh = serverAlerts.find((a) => !seenGainerAlertIdsRef.current.has(a.id));
            for (const a of serverAlerts) {
              seenGainerAlertIdsRef.current.add(a.id);
            }
            if (fresh) {
              pushNotification({
                category: 'SIGNAL',
                title: `Top Gainer #${fresh.gainerRank} · ${fresh.symbol}`,
                message: `$${formatCryptoPrice(fresh.price)} (+${fresh.change24hPercent.toFixed(2)}%) — ${fresh.reason}`,
                symbol: fresh.symbol,
                severity: 'info',
              });
              if (
                fresh.change24hPercent >= 12 &&
                !emailedGainerSymbolsRef.current.has(fresh.symbol)
              ) {
                if (emailedGainerSymbolsRef.current.size > 400) {
                  emailedGainerSymbolsRef.current.clear();
                }
                emailedGainerSymbolsRef.current.add(fresh.symbol);
                apiFetch('/api/alerts/email', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    type: 'TOP_GAINER_ALERT',
                    symbol: fresh.symbol,
                    entryPrice: fresh.price,
                    change24hPercent: fresh.change24hPercent,
                    reason: fresh.reason,
                  }),
                }).catch(() => undefined);
              }
            }
          }
        }
      } catch {
        // keep last known gainers if transient fetch failure
      } finally {
        setGainerLoading(false);
      }
    },
    [pushNotification]
  );

  useEffect(() => {
    refreshTopGainers(false);
    if (!appLiveEnabled) return;
    const id = window.setInterval(() => {
      refreshTopGainers(true);
    }, TELEMETRY_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [appLiveEnabled, refreshTopGainers]);

  // Unified coin list (static tracked coins + dynamic Binance top gainers)
  const allKnownCoins = useMemo<CoinMeta[]>(() => {
    const map = new Map<string, CoinMeta>();
    for (const c of TRACKED_COINS) {
      map.set(c.symbol, c);
    }
    for (const g of topGainers) {
      if (!map.has(g.symbol)) {
        map.set(g.symbol, {
          symbol: g.symbol,
          baseAsset: g.baseAsset,
          name: g.name,
          referencePrice: g.price,
          dailyVolatility: 0.055,
        });
      }
    }
    return Array.from(map.values());
  }, [topGainers]);

  allKnownCoinsRef.current = allKnownCoins;

  const trackedSymbolsSetRef = useRef<Set<string>>(
    new Set(TRACKED_COINS.map((c) => c.symbol.toUpperCase()))
  );
  useMemo(() => {
    const set = new Set<string>(TRACKED_COINS.map((c) => c.symbol.toUpperCase()));
    for (const g of topGainers) set.add(g.symbol.toUpperCase());
    trackedSymbolsSetRef.current = set;
  }, [topGainers]);

  const topGainersRef = useRef<TopGainerCoin[]>(topGainers);
  topGainersRef.current = topGainers;

  useEffect(() => {
    wsControllerRef.current?.updateTrackedSymbols(allKnownCoins);
  }, [allKnownCoins]);

  // Flush coalesced WebSocket frames into React state on a calibrated 250ms cadence & reconcile state drift
  const flushBufferedFrames = useCallback(() => {
    const ctrl = wsControllerRef.current;
    const frames = wsBufferRef.current.flush();
    if (frames.length === 0) return;

    const liveWsPriceMap: Record<string, number> = {};
    let newlyLiveWs = false;
    for (const frame of frames) {
      liveWsPriceMap[frame.symbol] = frame.price;
      if (!signalTickersWsSeededRef.current.has(frame.symbol)) {
        signalTickersWsSeededRef.current.add(frame.symbol);
        newlyLiveWs = true;
      }
    }

    const applyFramesToMap = (prev: Record<string, TickerSnapshot>) => {
      const next = { ...prev };
      let changed = false;
      for (const frame of frames) {
        const existing = next[frame.symbol];
        if (!existing) continue;
        const hasFullTicker = frame.volume24hUsd > 0;
        const nextChg = hasFullTicker ? frame.change24hPercent : existing.change24hPercent;
        const nextVol = hasFullTicker ? frame.volume24hUsd : existing.volume24hUsd;
        if (
          Math.abs(existing.price - frame.price) <= 1e-8 &&
          nextChg === existing.change24hPercent &&
          nextVol === existing.volume24hUsd &&
          existing.isLiveWs
        ) {
          continue;
        }
        next[frame.symbol] = {
          ...existing,
          price: frame.price,
          change24hPercent: nextChg,
          high24h: hasFullTicker ? frame.high24h : Math.max(existing.high24h, frame.price),
          low24h: hasFullTicker ? frame.low24h : Math.min(existing.low24h, frame.price),
          volume24hUsd: nextVol,
          isLiveWs: true,
        };
        changed = true;
      }
      return changed ? next : prev;
    };

    setTickers(applyFramesToMap);

    if (newlyLiveWs) {
      setSignalTickers(applyFramesToMap);
    }

    if (Object.keys(liveWsPriceMap).length > 0) {
      reconcileStateAgainstAuthoritativePrices(liveWsPriceMap);
    }

    setFuturesTelemetry((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const frame of frames) {
        const existing = next[frame.symbol];
        if (!existing) continue;
        const nextVol = frame.volume24hUsd > 0 ? frame.volume24hUsd : existing.volume24hUsd;
        if (
          Math.abs(existing.markPrice - frame.price) <= 1e-8 &&
          nextVol === existing.volume24hUsd &&
          existing.source === 'binance_futures'
        ) {
          continue;
        }
        next[frame.symbol] = {
          ...existing,
          markPrice: frame.price,
          volume24hUsd: nextVol,
          source: 'binance_futures',
        };
        changed = true;
      }
      return changed ? next : prev;
    });

    const totalFlushed = wsBufferRef.current.getFlushedFramesTotal();
    setTelemetryMetrics((prev) => ({
      ...prev,
      flushedFramesTotal: totalFlushed,
      fallbackEnforced: false,
      lastSyncAt: new Date().toISOString(),
    }));
    if (ctrl) {
      syncReconciliationUiSnapshot(false);
    }

    for (const frame of frames) {
      if (frame.volume24hUsd <= 0) continue;
      const baseline = baselineGainerPctRef.current.get(frame.symbol);
      if (baseline !== undefined && frame.change24hPercent - baseline >= 2.5) {
        baselineGainerPctRef.current.set(frame.symbol, frame.change24hPercent);
        const liveEvent: GainerAlertEvent = {
          id: `ws_${frame.symbol}_${Date.now()}`,
          symbol: frame.symbol,
          baseAsset: frame.symbol.replace(/USDT$/i, ''),
          price: frame.price,
          change24hPercent: frame.change24hPercent,
          volume24hUsd: frame.volume24hUsd,
          gainerRank: 1,
          reason: `Spot Live Surge (+${frame.change24hPercent.toFixed(2)}% 24h) — AI priority boosted`,
          timestamp: new Date().toISOString(),
        };
        seenGainerAlertIdsRef.current.add(liveEvent.id);
        setGainerAlerts((prev) => [liveEvent, ...prev].slice(0, 25));
        pushNotification({
          category: 'SIGNAL',
          title: `Spot Momentum Surge · ${frame.symbol}`,
          message: `$${formatCryptoPrice(frame.price)} reached +${frame.change24hPercent.toFixed(2)}% 24h via Binance Spot`,
          symbol: frame.symbol,
          severity: 'info',
        });
      }
    }
  }, [pushNotification, reconcileStateAgainstAuthoritativePrices, syncReconciliationUiSnapshot]);

  const flushBufferedFramesRef = useRef(flushBufferedFrames);
  flushBufferedFramesRef.current = flushBufferedFrames;

  useEffect(() => {
    if (!appLiveEnabled || !liveFeedModulesEnabled) return;
    const flushTimer = window.setInterval(() => {
      flushBufferedFramesRef.current();
    }, WS_FLUSH_INTERVAL_MS);
    return () => {
      window.clearInterval(flushTimer);
    };
  }, [appLiveEnabled, liveFeedModulesEnabled]);

  // Decoupled LiveWsFeedController orchestration (zero React lifecycle inside socket message handler)
  useEffect(() => {
    const controller = wsControllerRef.current;
    if (!controller) return;
    if (!appLiveEnabled || !liveFeedModulesEnabled) {
      controller.stop();
      setWsConnected(false);
      syncReconciliationUiSnapshot(true);
      return;
    }

    controller.configure({
      coins: allKnownCoinsRef.current,
      onFallbackStep: () => {
        setTickers((prev) => controller.stepFallbackSnapshot(prev, allKnownCoinsRef.current));
      },
      onConnectionChange: (connected, fallbackEnforced, epoch) => {
        setWsConnected(connected);
        if (connected) {
          setSpotFeedSource('binance_spot');
        }
        setTelemetryMetrics((prev) => ({
          ...prev,
          fallbackEnforced,
          syncEpoch: epoch,
        }));
        syncReconciliationUiSnapshot(true);
      },
    });

    controller.start();
    if (wsReconnectNonce > 0) {
      controller.resetEpochAndReconnect();
    }

    return () => {
      controller.stop();
    };
  }, [wsReconnectNonce, appLiveEnabled, liveFeedModulesEnabled, syncReconciliationUiSnapshot]);

  // Flush WS buffers, enforce deterministic fallback reset, and force immediate Spot + CMC telemetry resync
  const resyncAllTelemetry = useCallback(async () => {
    const seq = ++resyncSeqRef.current;
    setResyncing(true);
    const t0 = performance.now();

    const ctrl = wsControllerRef.current;
    const clientEpoch = ctrl
      ? ctrl.resetEpochAndReconnect()
      : wsBufferRef.current.discardAndBumpEpoch();
    setWsConnected(false);

    setTickers(buildDeterministicTickerSnapshot(allKnownCoinsRef.current));

    try {
      const res = await apiFetch('/api/telemetry/resync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ futuresActive: futuresTradingEnabledRef.current }),
      });
      const rtt = performance.now() - t0;

      if (res.ok && seq === resyncSeqRef.current) {
        const data = await res.json();
        if (seq !== resyncSeqRef.current) return;
        const serverGainers: TopGainerCoin[] = Array.isArray(data.gainers) ? data.gainers : [];
        const serverAlerts: GainerAlertEvent[] = Array.isArray(data.alerts) ? data.alerts : [];

        if (serverGainers.length > 0) {
          setTopGainers(serverGainers);
          setGainerSource(data.gainerSource === 'binance' ? 'binance' : 'cache');
          setGainerUpdatedAt(String(data.syncedAt || new Date().toISOString()));
        }
        if (serverAlerts.length > 0) {
          setGainerAlerts(serverAlerts);
        }
        if (data.cmcValuations && typeof data.cmcValuations === 'object') {
          setCmcValuations(data.cmcValuations);
          setCmcSource(data.cmcSource === 'cmc_api' ? 'cmc_api' : 'unavailable');
        }
        if (data.spotCmcValidations && typeof data.spotCmcValidations === 'object') {
          setSpotCmcValidations(data.spotCmcValidations);
        }
        if (data.telemetry && typeof data.telemetry === 'object') {
          setFuturesTelemetry(data.telemetry);
          setFuturesFeedSource(
            data.futuresSource === 'binance_futures' ? 'binance_futures' : 'futures_cache'
          );
        }
        setSpotFeedSource(data.spotSource === 'binance_spot' ? 'binance_spot' : 'spot_cache');

        const resyncedPriceMap: Record<string, number> = {};
        const ctrl = wsControllerRef.current;
        setTickers((prev) => {
          const next = { ...prev };
          if (data.spotTickers && typeof data.spotTickers === 'object') {
            for (const [sym, entry] of Object.entries(
              data.spotTickers as Record<
                string,
                {
                  price: number;
                  change24hPercent: number;
                  high24h: number;
                  low24h: number;
                  volume24hUsd: number;
                }
              >
            )) {
              if (!entry) continue;
              const check = ctrl
                ? ctrl.ingestExternalValidatedTick({
                    symbol: sym,
                    price: entry.price,
                    change24hPercent: entry.change24hPercent,
                    high24h: entry.high24h,
                    low24h: entry.low24h,
                    volume24hUsd: entry.volume24hUsd,
                    source: 'rest',
                  })
                : { accepted: Number.isFinite(entry.price) && entry.price > 0 };
              if (!check.accepted) continue;
              resyncedPriceMap[sym] = entry.price;
              const existing = next[sym];
              if (existing) {
                next[sym] = {
                  ...existing,
                  price: entry.price,
                  change24hPercent: entry.change24hPercent ?? existing.change24hPercent,
                  high24h: entry.high24h || Math.max(existing.high24h, entry.price),
                  low24h: entry.low24h || Math.min(existing.low24h, entry.price),
                  volume24hUsd: entry.volume24hUsd || existing.volume24hUsd,
                  isLiveWs: false,
                };
              }
            }
          }
          for (const g of serverGainers) {
            if (!resyncedPriceMap[g.symbol]) resyncedPriceMap[g.symbol] = g.price;
            next[g.symbol] = {
              symbol: g.symbol,
              baseAsset: g.baseAsset,
              name: g.name,
              price: resyncedPriceMap[g.symbol] ?? g.price,
              change24hPercent: g.change24hPercent,
              high24h: g.high24h,
              low24h: g.low24h,
              volume24hUsd: g.volume24hUsd,
              isLiveWs: false,
            };
          }
          return next;
        });

        if (Object.keys(resyncedPriceMap).length > 0) {
          reconcileStateAgainstAuthoritativePrices(resyncedPriceMap);
        }

        setTelemetryMetrics((prev) =>
          updateLatencyMetrics(prev, rtt, {
            fallbackEnforced: data.spotSource !== 'binance_spot',
            syncEpoch: Number(data.syncEpoch || clientEpoch),
            flushedFramesTotal: wsBufferRef.current.getFlushedFramesTotal(),
            timestamp: String(data.syncedAt || new Date().toISOString()),
          })
        );

        pushNotification({
          category: 'EXECUTION',
          title: `Spot & CMC Telemetry Resynced · Epoch #${Number(data.syncEpoch || clientEpoch)}`,
          message: `Flushed WS buffers (${Math.round(rtt)}ms RTT) — ${data.spotSource === 'binance_spot' ? 'Binance Spot Live + CMC Baseline Validated' : 'Deterministic Fallback Active'}.`,
          severity: 'success',
        });
      }
    } catch {
      const rtt = performance.now() - t0;
      setTelemetryMetrics((prev) =>
        updateLatencyMetrics(prev, rtt, {
          fallbackEnforced: true,
          syncEpoch: clientEpoch,
          flushedFramesTotal: wsBufferRef.current.getFlushedFramesTotal(),
        })
      );
      pushNotification({
        category: 'EXECUTION',
        title: `Deterministic Fallback Enforced · Epoch #${clientEpoch}`,
        message: 'Flushed stale WS buffers cleanly and reset telemetry to deterministic baseline snapshots.',
        severity: 'warning',
      });
    } finally {
      await Promise.all([refreshExecutionState(), refreshTelegramFeed()]).catch(() => undefined);
      if (systemControlsRef.current.liveFeedModulesEnabled) {
        setWsReconnectNonce((n) => n + 1);
      }
      setSyncVersion((v) => v + 1);
      setResyncing(false);
    }
  }, [pushNotification, refreshExecutionState, refreshTelegramFeed]);

  const liveTopGainers = useMemo<TopGainerCoin[]>(() => {
    let changed = false;
    const mapped = topGainers.map((g) => {
      const live = tickers[g.symbol];
      if (!live) return g;
      if (
        live.price === g.price &&
        live.change24hPercent === g.change24hPercent &&
        live.high24h === g.high24h &&
        live.low24h === g.low24h &&
        live.volume24hUsd === g.volume24hUsd &&
        Boolean(live.isLiveWs) === Boolean(g.isLiveWs)
      ) {
        return g;
      }
      changed = true;
      return {
        ...g,
        price: live.price,
        change24hPercent: live.change24hPercent,
        high24h: live.high24h,
        low24h: live.low24h,
        volume24hUsd: live.volume24hUsd,
        isLiveWs: live.isLiveWs,
      };
    });
    return changed ? mapped : topGainers;
  }, [topGainers, tickers]);

  // Shared Market Candle Scan & 4s Throttled Signal Tickers Synchronization
  const runSharedSignalScan = useCallback(
    async (tf?: Timeframe) => {
      const targetTf = tf ?? signalTimeframe;
      const seq = ++scanSeqRef.current;
      scanAbortRef.current?.abort();
      const abortController = new AbortController();
      scanAbortRef.current = abortController;
      setScanningMarkets(true);
      try {
        const coinsToScan =
          allKnownCoinsRef.current.length > 0 ? allKnownCoinsRef.current : TRACKED_COINS;
        const [newsRes, ...candleResults] = await Promise.all([
          fetch('/api/news/cryptopanic', { signal: abortController.signal })
            .then((r) => (r.ok ? r.json() : { items: DEFAULT_NEWS_FEED }))
            .catch(() => ({ items: DEFAULT_NEWS_FEED })),
          ...coinsToScan.map(async (coin) => {
            const liveAuthPrice =
              wsControllerRef.current?.getAuthoritativePrice(coin.symbol) ??
              latestTickersRef.current[coin.symbol]?.price ??
              coin.referencePrice;
            const res = await fetchCoinCandles(
              coin.symbol,
              targetTf,
              120,
              liveAuthPrice,
              abortController.signal
            );
            return { symbol: coin.symbol, candles: res.candles, source: res.source };
          }),
        ]);

        if (abortController.signal.aborted || seq !== scanSeqRef.current) return;

        if (Array.isArray(newsRes.items) && newsRes.items.length > 0) {
          setNewsItems(newsRes.items);
        }

        const nextMap: Record<string, Candle[]> = {};
        for (const entry of candleResults) {
          candleSourceMapRef.current[entry.symbol] = entry.source;
          const authPrice =
            wsControllerRef.current?.getAuthoritativePrice(entry.symbol) ??
            latestTickersRef.current[entry.symbol]?.price;
          if (authPrice && authPrice > 0) {
            const rec = reconcileCandleSeriesToLivePrice(
              entry.candles,
              authPrice,
              DEFAULT_DRIFT_THRESHOLD_PCT,
              entry.source
            );
            nextMap[entry.symbol] = rec.candles;
          } else {
            nextMap[entry.symbol] = entry.candles;
          }
        }
        setCandlesMap((prev) => ({ ...prev, ...nextMap }));
      } finally {
        if (seq === scanSeqRef.current) {
          setScanningMarkets(false);
        }
      }
    },
    [signalTimeframe]
  );

  const registerChartCandles = useCallback((symbol: string, loaded: Candle[]) => {
    candleSourceMapRef.current[symbol] = 'binance';
    setCandlesMap((prev) => ({ ...prev, [symbol]: loaded }));
  }, []);

  useEffect(() => {
    runSharedSignalScan(signalTimeframe);
  }, [signalTimeframe, syncVersion, runSharedSignalScan]);

  useEffect(() => {
    if (!appLiveEnabled || !autoScanEnabled) return;
    const timer = window.setInterval(() => {
      runSharedSignalScan(signalTimeframe);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [appLiveEnabled, autoScanEnabled, signalTimeframe, runSharedSignalScan]);

  const sharedTopGainerSymbolsKey = useMemo(
    () => topGainers.map((g) => g.symbol).sort().join(','),
    [topGainers]
  );

  useEffect(() => {
    const missing = topGainersRef.current.filter((g) => {
      const attemptKey = `${signalTimeframe}_${g.symbol}`;
      return !candlesMapRef.current[g.symbol] && !attemptedGainerCandlesRef.current.has(attemptKey);
    });
    if (missing.length === 0) return;

    for (const g of missing) {
      attemptedGainerCandlesRef.current.add(`${signalTimeframe}_${g.symbol}`);
    }

    let active = true;
    Promise.all(
      missing.map(async (g) => {
        const res = await fetchCoinCandles(g.symbol, signalTimeframe, 120, g.price);
        return { symbol: g.symbol, candles: res.candles };
      })
    ).then((entries) => {
      if (!active || entries.length === 0) return;
      setCandlesMap((prev) => {
        let added = false;
        const next = { ...prev };
        for (const e of entries) {
          if (e.candles.length > 0 && !next[e.symbol]) {
            next[e.symbol] = e.candles;
            added = true;
          }
        }
        return added ? next : prev;
      });
    });

    return () => {
      active = false;
    };
  }, [sharedTopGainerSymbolsKey, signalTimeframe]);

  useEffect(() => {
    setSignalTickers((prev) =>
      prev === latestTickersRef.current ? prev : latestTickersRef.current
    );
  }, [selectedSymbol, signalTimeframe, syncVersion, liveFeedModulesEnabled]);

  useEffect(() => {
    if (!appLiveEnabled || !liveFeedModulesEnabled) return;
    const id = window.setInterval(() => {
      setSignalTickers((prev) =>
        prev === latestTickersRef.current ? prev : latestTickersRef.current
      );
    }, 4000);
    return () => window.clearInterval(id);
  }, [appLiveEnabled, liveFeedModulesEnabled]);

  const liveCandlesMap = useMemo(() => {
    const map: Record<string, Candle[]> = {};
    for (const coin of allKnownCoins) {
      const list = candlesMap[coin.symbol];
      if (!list || list.length === 0) continue;
      const tickerPrice = signalTickers[coin.symbol]?.price;
      if (tickerPrice && Number.isFinite(tickerPrice)) {
        const cloned = list.slice();
        const last = cloned[cloned.length - 1];
        cloned[cloned.length - 1] = {
          ...last,
          close: tickerPrice,
          high: Math.max(last.high, tickerPrice),
          low: Math.min(last.low, tickerPrice),
        };
        map[coin.symbol] = cloned;
      } else {
        map[coin.symbol] = list;
      }
    }
    return map;
  }, [candlesMap, signalTickers, allKnownCoins]);

  const effectiveWatchlist = useMemo(
    () =>
      user && user.emailVerified && cloudWatchlist !== null
        ? cloudWatchlist.map((w) => w.symbol)
        : localWatchlist,
    [user, cloudWatchlist, localWatchlist]
  );

  const effectiveAlerts: LocalPriceAlert[] = useMemo(
    () =>
      user && user.emailVerified && cloudAlerts !== null
        ? cloudAlerts.map((a) => ({
            ...a,
            createdAt: '2026-01-01T00:00:00.000Z',
          }))
        : localAlerts,
    [user, cloudAlerts, localAlerts]
  );

  // Evaluate active price alerts cleanly into the strict Notification Center
  useEffect(() => {
    for (const alert of effectiveAlerts) {
      if (!alert.active || alert.triggered || triggeredIdsRef.current.has(alert.id)) continue;
      const ticker = tickers[alert.symbol];
      if (!ticker) continue;
      const hit =
        alert.condition === 'ABOVE'
          ? ticker.price >= alert.targetPrice
          : ticker.price <= alert.targetPrice;

      if (hit) {
        triggeredIdsRef.current.add(alert.id);
        pushNotification({
          category: 'SIGNAL',
          title: `Price Alert Hit · ${alert.symbol}`,
          message: `Moved ${alert.condition} $${alert.targetPrice} (Live: $${ticker.price})`,
          symbol: alert.symbol,
          severity: 'success',
        });

        if (user && user.emailVerified && cloudAlerts !== null) {
          updatePriceAlertStatus(user.uid, alert.id, { triggered: true, active: false }).catch(
            () => undefined
          );
        } else {
          setLocalAlerts((prev) => {
            const next = prev.map((a) =>
              a.id === alert.id ? { ...a, triggered: true, active: false } : a
            );
            localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(next));
            return next;
          });
        }

        if (alert.emailNotify) {
          apiFetch('/api/alerts/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'PRICE_ALERT',
              symbol: alert.symbol,
              condition: alert.condition,
              targetPrice: alert.targetPrice,
            }),
          }).catch(() => undefined);
        }
      }
    }
  }, [tickers, effectiveAlerts, verifiedUid, cloudAlerts, pushNotification]);

  // Multi-Asset Portfolio Evaluation anchored directly to reconciled live tickers & candlesMap
  const portfolioEvaluation = useMemo<PortfolioEvaluationResult>(
    () =>
      evaluateMultiAssetPortfolio({
        holdings: portfolioHoldings,
        stablecoinReserveUsd: portfolioReserveUsd,
        positions: executionState.positions,
        tickers,
        candlesMap,
        config: portfolioConfig,
        lastRebalanceAt: portfolioLastRebalanceAt,
      }),
    [
      portfolioHoldings,
      portfolioReserveUsd,
      executionState.positions,
      tickers,
      candlesMap,
      portfolioConfig,
      portfolioLastRebalanceAt,
    ]
  );

  useEffect(() => {
    let active = true;
    fetch('/api/portfolio/state')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active || !data) return;
        if (Array.isArray(data.holdings) && data.holdings.length > 0) {
          setPortfolioHoldings(data.holdings);
        }
        if (typeof data.stablecoinReserveUsd === 'number') {
          setPortfolioReserveUsd(data.stablecoinReserveUsd);
        }
        if (data.config) {
          setPortfolioConfig(normalizeRebalanceConfig(data.config));
        }
        if (data.lastRebalanceAt !== undefined) {
          setPortfolioLastRebalanceAt(data.lastRebalanceAt);
        }
        if (Array.isArray(data.history)) {
          setPortfolioRebalanceHistory(data.history);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const updatePortfolioConfig = useCallback(
    async (patch: Partial<PortfolioRebalanceConfig>) => {
      const nextCfg = normalizeRebalanceConfig(patch, portfolioConfig);
      setPortfolioConfig(nextCfg);
      try {
        const res = await apiFetch('/api/portfolio/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.config) setPortfolioConfig(normalizeRebalanceConfig(data.config));
        }
      } catch {
        // optimistic local update remains active
      }
    },
    [portfolioConfig]
  );

  const updatePortfolioHoldingUnits = useCallback(
    async (symbol: string, units: number, reserveUsd?: number) => {
      const cleanSym = symbol.toUpperCase();
      setPortfolioHoldings((prev) =>
        prev.map((h) => (h.symbol === cleanSym ? { ...h, units: Math.max(0, units) } : h))
      );
      if (reserveUsd !== undefined && Number.isFinite(reserveUsd)) {
        setPortfolioReserveUsd(Math.max(0, reserveUsd));
      }
      try {
        const res = await apiFetch('/api/portfolio/holdings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: cleanSym, units, reserveUsd }),
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.holdings)) setPortfolioHoldings(data.holdings);
          if (typeof data.stablecoinReserveUsd === 'number') {
            setPortfolioReserveUsd(data.stablecoinReserveUsd);
          }
        }
      } catch {
        // optimistic state retained
      }
    },
    []
  );

  const executePortfolioRebalanceNow = useCallback(async () => {
    setPortfolioBusy(true);
    try {
      const res = await apiFetch('/api/portfolio/rebalance', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.holdings)) setPortfolioHoldings(data.holdings);
        if (typeof data.stablecoinReserveUsd === 'number') {
          setPortfolioReserveUsd(data.stablecoinReserveUsd);
        }
        if (Array.isArray(data.history)) {
          setPortfolioRebalanceHistory(data.history);
          if (data.history[0]?.executedAt) {
            setPortfolioLastRebalanceAt(data.history[0].executedAt);
          }
        }
        pushNotification({
          category: 'EXECUTION',
          title: 'Portfolio Auto-Rebalance Executed',
          message: 'Volatility-weighted target parity synchronized across tracked holdings.',
          severity: 'success',
        });
      }
    } finally {
      setPortfolioBusy(false);
    }
  }, [pushNotification]);

  const resetPortfolioBaseline = useCallback(async () => {
    setPortfolioBusy(true);
    try {
      const res = await apiFetch('/api/portfolio/reset', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.holdings)) setPortfolioHoldings(data.holdings);
        if (typeof data.stablecoinReserveUsd === 'number') {
          setPortfolioReserveUsd(data.stablecoinReserveUsd);
        }
        if (data.config) setPortfolioConfig(normalizeRebalanceConfig(data.config));
        if (Array.isArray(data.history)) setPortfolioRebalanceHistory(data.history);
        setPortfolioLastRebalanceAt(null);
      }
    } finally {
      setPortfolioBusy(false);
    }
  }, []);

  const refreshForgeCapitalState = useCallback(async () => {
    try {
      const res = await fetch('/api/forge-capital/state');
      if (!res.ok) return;
      const data = await res.json();
      if (data?.state) {
        setForgeCapitalState(data.state as ForgeCapitalHubState);
      }
    } catch {
      // keep current state cleanly
    }
  }, []);

  useEffect(() => {
    refreshForgeCapitalState();
  }, [refreshForgeCapitalState]);

  // Ref-throttled mandatory real-time reconciliation binding live Spot/Futures prices + positions -> Forge Capital Hub
  useEffect(() => {
    const now = Date.now();
    if (now - lastForgeReconAtRef.current < 1200) return;
    lastForgeReconAtRef.current = now;

    const priceMap: Record<string, number> = {};
    for (const [sym, tk] of Object.entries(tickers)) {
      if (tk && Number.isFinite(tk.price) && tk.price > 0) {
        priceMap[sym] = tk.price;
      }
    }
    if (Object.keys(priceMap).length === 0) return;
    const volPct = estimateMarketVolatilityPct(tickers);
    setForgeCapitalState((prev) =>
      reconcileForgeCapitalState(prev, {
        walletBalanceUsd: executionState.testnetBalanceUsd,
        positions: executionState.positions,
        authoritativePrices: priceMap,
        marketVolatilityPct: volPct,
      })
    );
  }, [tickers, executionState.positions, executionState.testnetBalanceUsd]);

  const updateForgeCapitalLimits = useCallback(
    async (patch: ForgeConfigPatch) => {
      setForgeCapitalBusy(true);
      try {
        const res = await apiFetch('/api/forge-capital/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.state) {
          setForgeCapitalState(data.state as ForgeCapitalHubState);
        }
        if (!res.ok) {
          const msg = String(data?.error || `Forge Capital config HTTP ${res.status}`);
          pushNotification({
            category: 'EXECUTION',
            title: 'Forge Limit Update Rejected',
            message: msg,
            severity: 'warning',
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Forge Capital config network error';
        setForgeCapitalState((prev) =>
          recordForgeApiError(prev, {
            market: 'SYSTEM',
            moduleId: 'SYSTEM',
            endpoint: '/api/forge-capital/config',
            httpStatus: 0,
            exchangeCode: 'CONFIG_NETWORK_ERR',
            message: msg,
          })
        );
      } finally {
        setForgeCapitalBusy(false);
      }
    },
    [pushNotification]
  );

  const reconcileForgeCapitalNow = useCallback(
    async (submittedBaselineEquityUsd?: number) => {
      setForgeCapitalBusy(true);
      try {
        const res = await apiFetch('/api/forge-capital/reconcile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            submittedBaselineEquityUsd:
              submittedBaselineEquityUsd ?? forgeCapitalRef.current.currentEquityUsd,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.state) {
          setForgeCapitalState(data.state as ForgeCapitalHubState);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Forge Capital reconcile network error';
        setForgeCapitalState((prev) =>
          recordForgeApiError(prev, {
            market: 'SYSTEM',
            moduleId: 'SYSTEM',
            endpoint: '/api/forge-capital/reconcile',
            httpStatus: 0,
            exchangeCode: 'RECONCILE_NETWORK_ERR',
            message: msg,
          })
        );
      } finally {
        setForgeCapitalBusy(false);
      }
    },
    []
  );

  const routeForgeCapitalOrder = useCallback(
    async (params: {
      moduleId: ForgeModuleId;
      market: ForgeMarketChannel;
      symbol: string;
      direction: 'BUY' | 'SELL';
      notionalUsd: number;
      leverage?: number;
      marginMode?: MarginMode;
      submittedPrice?: number;
    }): Promise<{ ok: boolean; error?: string; routeRecord?: DualExecutionRouteRecord }> => {
      setForgeCapitalBusy(true);
      try {
        const livePrice =
          params.submittedPrice ??
          latestTickersRef.current[params.symbol.toUpperCase()]?.price ??
          futuresTelemetry[params.symbol.toUpperCase()]?.markPrice ??
          65000;
        const res = await apiFetch('/api/forge-capital/route', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...params,
            submittedPrice: livePrice,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.state) {
          setForgeCapitalState(data.state as ForgeCapitalHubState);
        }
        if (!res.ok || !data.ok) {
          pushNotification({
            category: 'EXECUTION',
            title: res.status === 423 ? 'EMERGENCY_HALT (423 Locked)' : 'Forge Dual-Route Blocked',
            message: String(data?.error || 'Order rejected by Forge Capital Hub safeguard.'),
            symbol: params.symbol,
            severity: 'warning',
          });
          return {
            ok: false,
            error: String(data?.error || 'Route blocked'),
            routeRecord: data?.routeRecord,
          };
        }
        if (data?.position) {
          setExecutionState((prev) => ({
            ...prev,
            testnetBalanceUsd: Number(data.testnetBalanceUsd ?? prev.testnetBalanceUsd),
            crossMargin: data.crossMargin || prev.crossMargin,
            totalExecutedOrders: prev.totalExecutedOrders + 1,
            positions: [data.position as SandboxPosition, ...prev.positions].slice(0, 30),
          }));
        }
        pushNotification({
          category: 'EXECUTION',
          title: `Forge Routed · ${params.market === 'USD_M_FUTURES' ? 'USD-M Futures' : 'Binance Spot'}`,
          message: `${params.moduleId}: ${params.direction} ${params.symbol} $${params.notionalUsd} (${params.market === 'USD_M_FUTURES' ? `${params.leverage ?? 5}x` : '1x'}).`,
          symbol: params.symbol,
          severity: 'success',
        });
        return { ok: true, routeRecord: data.routeRecord };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Forge Dual-Route network error';
        setForgeCapitalState((prev) =>
          recordForgeApiError(prev, {
            market: params.market,
            moduleId: params.moduleId,
            endpoint: '/api/forge-capital/route',
            httpStatus: 0,
            exchangeCode: 'NETWORK_ERR',
            message: msg,
          })
        );
        return { ok: false, error: msg };
      } finally {
        setForgeCapitalBusy(false);
      }
    },
    [futuresTelemetry, pushNotification]
  );

  // Unified 0%-drift ledger shared 1:1 between Forge Capital Hub Master Desk and Live Testnet Execution Ledger
  const unifiedCapitalLedger = useMemo<UnifiedCapitalLedgerState>(
    () =>
      buildUnifiedCapitalLedgerState({
        positions: executionState.positions,
        walletBalanceUsd: executionState.testnetBalanceUsd,
        tickers,
        candlesMap,
        forgeCapitalState,
        cmcValuations,
        spotCmcValidations,
        liveTrackingActive: testnetExecutionEnabled && liveFeedModulesEnabled,
      }),
    [
      executionState.positions,
      executionState.testnetBalanceUsd,
      tickers,
      candlesMap,
      forgeCapitalState,
      cmcValuations,
      spotCmcValidations,
      testnetExecutionEnabled,
      liveFeedModulesEnabled,
    ]
  );

  const toggleForgeModuleStatus = useCallback(
    async (
      moduleId: ForgeModuleId,
      suspend: boolean,
      reason?: string
    ): Promise<{ ok: boolean; error?: string }> => {
      setForgeCapitalBusy(true);
      try {
        const res = await apiFetch('/api/forge-capital/module-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moduleId, suspend, reason }),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.state) setForgeCapitalState(data.state as ForgeCapitalHubState);
        if (!res.ok || !data.ok) {
          return { ok: false, error: String(data?.error || 'Unable to change module status') };
        }
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Module status toggle network error';
        setForgeCapitalState((prev) =>
          recordForgeApiError(prev, {
            market: 'SYSTEM',
            moduleId,
            endpoint: '/api/forge-capital/module-status',
            httpStatus: 0,
            exchangeCode: 'MODULE_STATUS_NETWORK_ERR',
            message: msg,
          })
        );
        return { ok: false, error: msg };
      } finally {
        setForgeCapitalBusy(false);
      }
    },
    []
  );

  const engageForgeFailSafeNow = useCallback(
    async (reason?: string) => {
      setForgeCapitalBusy(true);
      try {
        const res = await apiFetch('/api/forge-capital/failsafe/engage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.state) setForgeCapitalState(data.state as ForgeCapitalHubState);
        pushNotification({
          category: 'EXECUTION',
          title: 'Immutable Fail-Safe Engaged',
          message: 'All Binance Spot & USD-M Futures execution halted across Forge Capital Hub.',
          severity: 'warning',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Fail-safe engage request failed';
        // Local emergency containment: still halt client dispatch immediately if network call fails
        setForgeCapitalState((prev) =>
          engageImmutableFailSafe(prev, reason || `Client containment: ${msg}`)
        );
      } finally {
        setForgeCapitalBusy(false);
      }
    },
    [pushNotification]
  );

  const requestForgeFailsafeChallenge = useCallback(async () => {
    setForgeCapitalBusy(true);
    try {
      const res = await apiFetch('/api/forge-capital/failsafe/challenge', {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        return {
          ok: false,
          error: String(data?.error || 'Unable to issue Fail-Safe recovery seal.'),
        };
      }
      const deliveryMode: 'email' | 'server_log' =
        data.deliveryMode === 'email' ? 'email' : 'server_log';
      pushNotification({
        category: 'EXECUTION',
        title: `Fail-Safe Recovery Seal Issued (${String(data.sealId || 'LOCKED')})`,
        message:
          deliveryMode === 'email'
            ? 'Single-use recovery code emailed to the registered operator address.'
            : 'Single-use recovery seal generated (valid 5 min). Check configured email or server console.',
        severity: 'warning',
      });
      return {
        ok: true,
        challengeId: String(data.challengeId),
        sealId: data.sealId ? String(data.sealId) : undefined,
        expiresAt: data.expiresAt ? String(data.expiresAt) : undefined,
        deliveryMode,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Network error issuing recovery seal.',
      };
    } finally {
      setForgeCapitalBusy(false);
    }
  }, [pushNotification]);

  const recoverForgeFailSafeNow = useCallback(
    async (
      confirmationCode: string,
      operatorReason: string,
      challengeId?: string
    ): Promise<{ ok: boolean; error?: string }> => {
      setForgeCapitalBusy(true);
      try {
        const res = await apiFetch('/api/forge-capital/failsafe/recover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmationCode, operatorReason, challengeId }),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.state) setForgeCapitalState(data.state as ForgeCapitalHubState);
        if (!res.ok || !data.ok) {
          return { ok: false, error: String(data?.error || 'Recovery authorization rejected') };
        }
        pushNotification({
          category: 'EXECUTION',
          title: 'Forge Fail-Safe Recovered',
          message: 'HWM re-anchored cleanly and dual execution channels unlocked.',
          severity: 'success',
        });
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Fail-Safe recovery network error';
        setForgeCapitalState((prev) =>
          recordForgeApiError(prev, {
            market: 'SYSTEM',
            moduleId: 'SYSTEM',
            endpoint: '/api/forge-capital/failsafe/recover',
            httpStatus: 0,
            exchangeCode: 'RECOVERY_NETWORK_ERR',
            message: msg,
          })
        );
        return { ok: false, error: msg };
      } finally {
        setForgeCapitalBusy(false);
      }
    },
    [pushNotification]
  );

  const simulateForgeApiError = useCallback(
    async (input: {
      market: ForgeMarketChannel | 'SYSTEM';
      moduleId?: ForgeModuleId | 'SYSTEM';
      endpoint: string;
      httpStatus: number;
      exchangeCode?: string;
      message: string;
    }) => {
      try {
        const res = await apiFetch('/api/forge-capital/api-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.state) {
          setForgeCapitalState(data.state as ForgeCapitalHubState);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : input.message;
        setForgeCapitalState((prev) =>
          recordForgeApiError(prev, {
            market: input.market,
            moduleId: input.moduleId ?? 'SYSTEM',
            endpoint: input.endpoint,
            httpStatus: input.httpStatus || 0,
            exchangeCode: input.exchangeCode ?? 'CLIENT_LOG_FALLBACK',
            message: msg,
          })
        );
      }
    },
    []
  );

  const toggleWatchlist = useCallback(
    async (symbol: string) => {
      const clean = symbol.toUpperCase();
      const coin = allKnownCoinsRef.current.find((c) => c.symbol === clean);
      const exists = effectiveWatchlist.includes(clean);

      if (user && user.emailVerified) {
        if (exists) {
          await removeWatchlistItem(user.uid, clean);
        } else {
          await addWatchlistItem(user.uid, clean, coin?.name || clean);
        }
        return;
      }

      setLocalWatchlist((prev) => {
        const next = prev.includes(clean) ? prev.filter((s) => s !== clean) : [...prev, clean];
        localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [effectiveWatchlist, user]
  );

  const addPriceAlert = useCallback(
    async (input: {
      symbol: string;
      condition: 'ABOVE' | 'BELOW';
      targetPrice: number;
      emailNotify: boolean;
    }) => {
      if (user && user.emailVerified) {
        await createPriceAlert(user.uid, input);
        return;
      }
      const item: LocalPriceAlert = {
        id: `al_${input.symbol}_${Date.now()}`,
        symbol: input.symbol.toUpperCase(),
        condition: input.condition,
        targetPrice: input.targetPrice,
        active: true,
        triggered: false,
        emailNotify: input.emailNotify,
        createdAt: new Date().toISOString(),
      };
      setLocalAlerts((prev) => {
        const next = [item, ...prev];
        localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [user]
  );

  const removePriceAlert = useCallback(
    async (id: string) => {
      if (user && user.emailVerified) {
        await deletePriceAlert(user.uid, id);
        return;
      }
      setLocalAlerts((prev) => {
        const next = prev.filter((a) => a.id !== id);
        localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [user]
  );

  const triggerAlertBanner = useCallback(
    (msg: string) => {
      pushNotification({
        category: 'SIGNAL',
        title: 'Signal Forge Coordinator Alert',
        message: msg,
        severity: 'info',
      });
    },
    [pushNotification]
  );

  const contextValue = useMemo<AppContextValue>(
    () => ({
      user,
      authReady,
      tickers,
      wsConnected,
      selectedSymbol,
      setSelectedSymbol,
      allKnownCoins,
      topGainers: liveTopGainers,
      gainerSource,
      gainerUpdatedAt,
      gainerAlerts,
      gainerLoading,
      refreshTopGainers,
      futuresTradingEnabled,
      setFuturesTradingEnabled,
      spotFeedSource,
      cmcValuations,
      cmcSource,
      spotCmcValidations,
      refreshSpotFeed,
      refreshCmcValuations,
      futuresTelemetry,
      futuresFeedSource,
      refreshFuturesFeed,
      appLiveEnabled,
      setAppLiveEnabled,
      appLiveMeta,
      testnetExecutionEnabled,
      setTestnetExecutionEnabled,
      liveFeedModulesEnabled,
      setLiveFeedModulesEnabled,
      runtimePlanes,
      telemetryMetrics,
      reconciliationTelemetry,
      reportPriceReconciliation,
      monitorHealth,
      syncVersion,
      resyncing,
      resyncAllTelemetry,
      triggerAlertBanner,
      watchlist: effectiveWatchlist,
      toggleWatchlist,
      priceAlerts: effectiveAlerts,
      addPriceAlert,
      removePriceAlert,
      notifications,
      unreadNotificationCount,
      pushNotification,
      markAllNotificationsRead,
      clearNotifications,
      pinnedSignals,
      syncPinnedCandidates,
      rotateResolvedPinned,
      backendEvaluations,
      evaluateBackendIntelligence,
      focusedCoordinatorPlanId,
      focusCoordinatorPlan,
      telegramFeed,
      telegramHandle,
      telegramBotConfigured,
      refreshTelegramFeed,
      routeSignalToTelegram,
      executionState,
      hasSwitchedLiveOnce,
      executionRouteDraft,
      setExecutionRouteDraft,
      liveCrossMargin,
      refreshExecutionState,
      switchExecutionMode,
      requestLiveSwitchOtp,
      confirmSwitchToLive,
      executeCoordinatorOrder,
      closeSandboxPosition,
      settleCrossMarginCycle,
      signalTimeframe,
      setSignalTimeframe,
      autoScanEnabled,
      setAutoScanEnabled,
      candlesMap,
      liveCandlesMap,
      signalTickers,
      newsItems,
      scanningMarkets,
      runSharedSignalScan,
      registerChartCandles,
      autoReports,
      refreshAutoReports,
      dispatchPerformanceReport,
      digestStatus,
      refreshDigestStatus,
      dispatchSignalDigestNow,
      orderBookDepth,
      refreshOrderBookDepth,
      sentinelBySymbol,
      sentinelFeed,
      triggerSentinelAudit,
      autonomousState,
      toggleAutonomousCoordinator,
      runAutonomousCycleNow,
      rlTuning,
      triggerRlAutoTune,
      emergencyLiquidation,
      triggerEmergencyLiquidation,
      arbitrageOpportunities,
      arbitrageExecutions,
      executeArbitrage,
      copyAccounts,
      mirroredCopyHistory,
      toggleCopyAccount,
      mirrorCopyTrade,
      wsVerification,
      refreshWsVerification,
      portfolioEvaluation,
      portfolioHoldings,
      portfolioReserveUsd,
      portfolioConfig,
      portfolioRebalanceHistory,
      portfolioBusy,
      updatePortfolioConfig,
      updatePortfolioHoldingUnits,
      executePortfolioRebalanceNow,
      resetPortfolioBaseline,
      voiceAgent,
      setVoiceMode,
      startPushToTalk,
      stopVoiceListening,
      executeVoiceCommand,
      forgeCapitalState,
      unifiedCapitalLedger,
      forgeCapitalBusy,
      refreshForgeCapitalState,
      updateForgeCapitalLimits,
      reconcileForgeCapitalNow,
      routeForgeCapitalOrder,
      toggleForgeModuleStatus,
      engageForgeFailSafeNow,
      requestForgeFailsafeChallenge,
      recoverForgeFailSafeNow,
      simulateForgeApiError,
      architectureState,
      subscriptionSummary,
      architectureBusy,
      architectureFeedback,
      clearArchitectureFeedback,
      refreshArchitectureAndSubscription,
      toggleControlMatrixKey,
      triggerServiceFailover,
      setMicroserviceLifecycle,
      triggerRollbackSnapshot,
      runFaultIsolationDrill,
      activatePremiumTier,
      downgradeToFreeTier,
    }),
    [
      user,
      authReady,
      tickers,
      wsConnected,
      selectedSymbol,
      allKnownCoins,
      liveTopGainers,
      gainerSource,
      gainerUpdatedAt,
      gainerAlerts,
      gainerLoading,
      refreshTopGainers,
      futuresTradingEnabled,
      setFuturesTradingEnabled,
      spotFeedSource,
      cmcValuations,
      cmcSource,
      spotCmcValidations,
      refreshSpotFeed,
      refreshCmcValuations,
      futuresTelemetry,
      futuresFeedSource,
      refreshFuturesFeed,
      appLiveEnabled,
      setAppLiveEnabled,
      appLiveMeta,
      testnetExecutionEnabled,
      setTestnetExecutionEnabled,
      liveFeedModulesEnabled,
      setLiveFeedModulesEnabled,
      runtimePlanes,
      telemetryMetrics,
      reconciliationTelemetry,
      reportPriceReconciliation,
      monitorHealth,
      syncVersion,
      resyncing,
      resyncAllTelemetry,
      triggerAlertBanner,
      effectiveWatchlist,
      toggleWatchlist,
      effectiveAlerts,
      addPriceAlert,
      removePriceAlert,
      notifications,
      unreadNotificationCount,
      pushNotification,
      markAllNotificationsRead,
      clearNotifications,
      pinnedSignals,
      syncPinnedCandidates,
      rotateResolvedPinned,
      backendEvaluations,
      evaluateBackendIntelligence,
      focusedCoordinatorPlanId,
      focusCoordinatorPlan,
      telegramFeed,
      telegramHandle,
      telegramBotConfigured,
      refreshTelegramFeed,
      routeSignalToTelegram,
      executionState,
      hasSwitchedLiveOnce,
      executionRouteDraft,
      liveCrossMargin,
      refreshExecutionState,
      switchExecutionMode,
      requestLiveSwitchOtp,
      confirmSwitchToLive,
      executeCoordinatorOrder,
      closeSandboxPosition,
      settleCrossMarginCycle,
      signalTimeframe,
      autoScanEnabled,
      candlesMap,
      liveCandlesMap,
      signalTickers,
      newsItems,
      scanningMarkets,
      runSharedSignalScan,
      registerChartCandles,
      autoReports,
      refreshAutoReports,
      dispatchPerformanceReport,
      digestStatus,
      refreshDigestStatus,
      dispatchSignalDigestNow,
      orderBookDepth,
      refreshOrderBookDepth,
      sentinelBySymbol,
      sentinelFeed,
      triggerSentinelAudit,
      autonomousState,
      toggleAutonomousCoordinator,
      runAutonomousCycleNow,
      rlTuning,
      triggerRlAutoTune,
      emergencyLiquidation,
      triggerEmergencyLiquidation,
      arbitrageOpportunities,
      arbitrageExecutions,
      executeArbitrage,
      copyAccounts,
      mirroredCopyHistory,
      toggleCopyAccount,
      mirrorCopyTrade,
      wsVerification,
      refreshWsVerification,
      portfolioEvaluation,
      portfolioHoldings,
      portfolioReserveUsd,
      portfolioConfig,
      portfolioRebalanceHistory,
      portfolioBusy,
      updatePortfolioConfig,
      updatePortfolioHoldingUnits,
      executePortfolioRebalanceNow,
      resetPortfolioBaseline,
      voiceAgent,
      setVoiceMode,
      startPushToTalk,
      stopVoiceListening,
      executeVoiceCommand,
      forgeCapitalState,
      unifiedCapitalLedger,
      forgeCapitalBusy,
      refreshForgeCapitalState,
      updateForgeCapitalLimits,
      reconcileForgeCapitalNow,
      routeForgeCapitalOrder,
      toggleForgeModuleStatus,
      engageForgeFailSafeNow,
      requestForgeFailsafeChallenge,
      recoverForgeFailSafeNow,
      simulateForgeApiError,
      architectureState,
      subscriptionSummary,
      architectureBusy,
      architectureFeedback,
      clearArchitectureFeedback,
      refreshArchitectureAndSubscription,
      toggleControlMatrixKey,
      triggerServiceFailover,
      setMicroserviceLifecycle,
      triggerRollbackSnapshot,
      runFaultIsolationDrill,
      activatePremiumTier,
      downgradeToFreeTier,
    ]
  );

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

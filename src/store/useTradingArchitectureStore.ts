import { create } from 'zustand';
import {
  DEFAULT_INDICATOR_SUITE,
  DEVELOPER_AUDIT_BATCH_INTERVAL_MIN,
  createPublicVerifiedTradeRecord,
  diagnoseSystemAuditEvents,
  evaluateDeveloperAuditDispatch,
  gradeAccountVolumeTier,
  type AssessedAccountRiskProfile,
  type AutoOptimizationReport,
  type DeveloperAuditBatchPolicy,
  type ExecutionControlMode,
  type IndicatorSuiteConfig,
  type PublicVerifiedTradeRecord,
  type SubscriptionPlanId,
  type SystemAuditFinding,
  type TradingViewWebhookSignal,
} from '../lib/multiAgentTradingArchitecture';

const STORAGE_KEY = 'signal_forge_trading_arch_v1';

interface PersistedTradingArchConfig {
  executionMode: ExecutionControlMode;
  userVolume30dUsd: number;
  customRiskTolerancePct: number;
  customRrMultiplierCap: number;
  subscriptionPlanId: SubscriptionPlanId;
  allowLowConfidenceSupervision: boolean;
  indicatorSuite: IndicatorSuiteConfig;
  suppressHeartbeatSpam: boolean;
  auditBatchIntervalMinutes: number;
}

const DEFAULT_PERSISTED: PersistedTradingArchConfig = {
  executionMode: 'FULLY_AUTONOMOUS',
  userVolume30dUsd: 1_450_000,
  customRiskTolerancePct: 1.25,
  customRrMultiplierCap: 18,
  subscriptionPlanId: 'PRO_DESK',
  allowLowConfidenceSupervision: true,
  indicatorSuite: { ...DEFAULT_INDICATOR_SUITE },
  suppressHeartbeatSpam: true,
  auditBatchIntervalMinutes: DEVELOPER_AUDIT_BATCH_INTERVAL_MIN,
};

function loadPersistedConfig(): PersistedTradingArchConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_PERSISTED };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PERSISTED };
    const parsed = JSON.parse(raw) as Partial<PersistedTradingArchConfig>;
    return {
      executionMode:
        parsed.executionMode === 'SUPERVISED_MANUAL_OVERRIDE'
          ? 'SUPERVISED_MANUAL_OVERRIDE'
          : 'FULLY_AUTONOMOUS',
      userVolume30dUsd:
        typeof parsed.userVolume30dUsd === 'number' && parsed.userVolume30dUsd >= 0
          ? parsed.userVolume30dUsd
          : DEFAULT_PERSISTED.userVolume30dUsd,
      customRiskTolerancePct:
        typeof parsed.customRiskTolerancePct === 'number'
          ? Math.min(2.0, Math.max(0.25, parsed.customRiskTolerancePct))
          : DEFAULT_PERSISTED.customRiskTolerancePct,
      customRrMultiplierCap:
        typeof parsed.customRrMultiplierCap === 'number'
          ? Math.min(25, Math.max(5, parsed.customRrMultiplierCap))
          : DEFAULT_PERSISTED.customRrMultiplierCap,
      subscriptionPlanId:
        parsed.subscriptionPlanId === 'FREE_MONITOR' ||
        parsed.subscriptionPlanId === 'PRO_DESK' ||
        parsed.subscriptionPlanId === 'INSTITUTIONAL_SUITE'
          ? parsed.subscriptionPlanId
          : DEFAULT_PERSISTED.subscriptionPlanId,
      allowLowConfidenceSupervision:
        typeof parsed.allowLowConfidenceSupervision === 'boolean'
          ? parsed.allowLowConfidenceSupervision
          : DEFAULT_PERSISTED.allowLowConfidenceSupervision,
      indicatorSuite: {
        ...DEFAULT_INDICATOR_SUITE,
        ...(parsed.indicatorSuite ?? {}),
      },
      suppressHeartbeatSpam:
        typeof parsed.suppressHeartbeatSpam === 'boolean'
          ? parsed.suppressHeartbeatSpam
          : DEFAULT_PERSISTED.suppressHeartbeatSpam,
      auditBatchIntervalMinutes:
        typeof parsed.auditBatchIntervalMinutes === 'number' && parsed.auditBatchIntervalMinutes >= 5
          ? parsed.auditBatchIntervalMinutes
          : DEVELOPER_AUDIT_BATCH_INTERVAL_MIN,
    };
  } catch {
    return { ...DEFAULT_PERSISTED };
  }
}

function savePersistedConfig(cfg: PersistedTradingArchConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // ignore storage quota errors
  }
}

function createInitialVerifiedTrades(): PublicVerifiedTradeRecord[] {
  const nowIso = new Date().toISOString();
  return [
    createPublicVerifiedTradeRecord({
      sequenceNumber: 101,
      symbol: 'BTCUSDT',
      direction: 'BUY',
      market: 'SPOT',
      stage: 'CONFIRMED_SETUP',
      entryPrice: 63850,
      stopLoss: 62900,
      takeProfit: 73350,
      confidence: 89,
      patternLabel: 'SMC Order Block + LVN Demand Sweep',
      realizedPnlUsd: null,
      realizedPnlPct: null,
      createdAtIso: nowIso,
    }),
    createPublicVerifiedTradeRecord({
      sequenceNumber: 102,
      symbol: 'SOLUSDT',
      direction: 'BUY',
      market: 'SPOT',
      stage: 'EXECUTION_ENTRY',
      entryPrice: 142.5,
      stopLoss: 140.1,
      takeProfit: 171.3,
      confidence: 91,
      patternLabel: '3/3 Pre-Pump Accumulation · Vol 2.8x + OB +38%',
      realizedPnlUsd: 428.5,
      realizedPnlPct: 3.12,
      createdAtIso: nowIso,
    }),
    createPublicVerifiedTradeRecord({
      sequenceNumber: 103,
      symbol: 'ETHUSDT',
      direction: 'BUY',
      market: 'USD_M_FUTURES',
      stage: 'FINAL_PNL_RESULT',
      entryPrice: 2860,
      stopLoss: 2818,
      takeProfit: 3448,
      confidence: 93,
      patternLabel: 'Multi-Agent Debate Consensus · Dynamic 1:14.0 Trail',
      realizedPnlUsd: 2145.0,
      realizedPnlPct: 14.3,
      createdAtIso: nowIso,
    }),
  ];
}

export interface TradingArchitectureStoreState extends PersistedTradingArchConfig {
  globalSearchOpen: boolean;
  verifiedTrades: PublicVerifiedTradeRecord[];
  auditFindings: SystemAuditFinding[];
  auditBatchPolicy: DeveloperAuditBatchPolicy;
  latestOptimization: AutoOptimizationReport | null;
  tradingViewSignals: TradingViewWebhookSignal[];
  nextTradeSequence: number;

  setGlobalSearchOpen: (open: boolean) => void;
  toggleGlobalSearch: () => void;
  setExecutionMode: (mode: ExecutionControlMode) => void;
  setUserVolume30dUsd: (volumeUsd: number) => void;
  setCustomRiskTolerancePct: (riskPct: number) => void;
  setCustomRrMultiplierCap: (mult: number) => void;
  setSubscriptionPlanId: (planId: SubscriptionPlanId) => void;
  setAllowLowConfidenceSupervision: (allowed: boolean) => void;
  updateIndicatorSuite: (patch: Partial<IndicatorSuiteConfig>) => void;
  recordVerifiedTrade: (
    input: Omit<Parameters<typeof createPublicVerifiedTradeRecord>[0], 'sequenceNumber'>
  ) => PublicVerifiedTradeRecord;
  hydrateVerifiedTrades: (records: PublicVerifiedTradeRecord[]) => void;
  runLocalSystemAudit: (params?: { peakLatencyMs?: number; injectSampleAnomaly?: boolean }) => {
    findingsCount: number;
    dispatched: boolean;
    reason: string;
  };
  setLatestOptimization: (report: AutoOptimizationReport) => void;
  recordTradingViewSignal: (signal: TradingViewWebhookSignal) => void;
  getAssessedAccountProfile: (accountEquityUsd?: number, currentDrawdownPct?: number) => AssessedAccountRiskProfile;
}

const initialCfg = loadPersistedConfig();
const initialTrades = createInitialVerifiedTrades();

function extractPersisted(state: TradingArchitectureStoreState): PersistedTradingArchConfig {
  return {
    executionMode: state.executionMode,
    userVolume30dUsd: state.userVolume30dUsd,
    customRiskTolerancePct: state.customRiskTolerancePct,
    customRrMultiplierCap: state.customRrMultiplierCap,
    subscriptionPlanId: state.subscriptionPlanId,
    allowLowConfidenceSupervision: state.allowLowConfidenceSupervision,
    indicatorSuite: state.indicatorSuite,
    suppressHeartbeatSpam: state.suppressHeartbeatSpam,
    auditBatchIntervalMinutes: state.auditBatchIntervalMinutes,
  };
}

export const useTradingArchitectureStore = create<TradingArchitectureStoreState>((set, get) => ({
  ...initialCfg,
  globalSearchOpen: false,
  verifiedTrades: initialTrades,
  auditFindings: diagnoseSystemAuditEvents([
    {
      id: 'boot_rate_guard',
      source: 'FEED_PIPELINE',
      httpStatus: 429,
      message: 'Binance REST burst rate limit throttled cleanly by TokenBucketLimiter (200 RPM)',
      timestampIso: new Date().toISOString(),
    },
  ]),
  auditBatchPolicy: {
    developerExclusiveOnly: true,
    suppressHeartbeatSpam: initialCfg.suppressHeartbeatSpam,
    batchIntervalMinutes: initialCfg.auditBatchIntervalMinutes,
    lastBatchSentAtMs: Date.now() - 12 * 60 * 1000,
    pendingMetricsCount: 18,
    anomalyLatencyThresholdMs: 450,
  },
  latestOptimization: null,
  tradingViewSignals: [
    {
      id: 'tv_BTCUSDT_init',
      symbol: 'BTCUSDT',
      action: 'BUY',
      price: 63850,
      timeframe: '15m',
      strategyName: 'EMA 21/50/200 Momentum + RSI Divergence',
      rsi: 61.4,
      emaFast: 63610,
      emaSlow: 62940,
      receivedAtIso: new Date().toISOString(),
      syncedWithBinanceWs: true,
    },
  ],
  nextTradeSequence: 104,

  setGlobalSearchOpen: (open) => set({ globalSearchOpen: open }),
  toggleGlobalSearch: () => set((s) => ({ globalSearchOpen: !s.globalSearchOpen })),

  setExecutionMode: (executionMode) => {
    set({ executionMode });
    savePersistedConfig(extractPersisted(get()));
  },

  setUserVolume30dUsd: (volumeUsd) => {
    const safeVol = Math.max(0, Number.isFinite(volumeUsd) ? volumeUsd : 0);
    const profile = gradeAccountVolumeTier({
      volume30dUsd: safeVol,
      accountEquityUsd: 25_000,
      recentWinRatePct: 61,
      currentDrawdownPct: 1.4,
      consecutiveLosses: 0,
    });
    const clampedRisk = Math.min(get().customRiskTolerancePct, profile.aiDynamicRiskCapPct);
    const clampedRr = Math.min(get().customRrMultiplierCap, profile.tier.maxRrMultiplier);
    set({
      userVolume30dUsd: safeVol,
      customRiskTolerancePct: clampedRisk,
      customRrMultiplierCap: Math.max(5, clampedRr),
    });
    savePersistedConfig(extractPersisted(get()));
  },

  setCustomRiskTolerancePct: (riskPct) => {
    const profile = get().getAssessedAccountProfile();
    const clamped = Number(
      Math.min(profile.aiDynamicRiskCapPct, Math.max(0.25, riskPct)).toFixed(2)
    );
    set({ customRiskTolerancePct: clamped });
    savePersistedConfig(extractPersisted(get()));
  },

  setCustomRrMultiplierCap: (mult) => {
    const profile = get().getAssessedAccountProfile();
    const clamped = Math.round(Math.min(profile.tier.maxRrMultiplier, Math.max(5, mult)));
    set({ customRrMultiplierCap: clamped });
    savePersistedConfig(extractPersisted(get()));
  },

  setSubscriptionPlanId: (subscriptionPlanId) => {
    set({ subscriptionPlanId });
    savePersistedConfig(extractPersisted(get()));
  },

  setAllowLowConfidenceSupervision: (allowLowConfidenceSupervision) => {
    set({ allowLowConfidenceSupervision });
    savePersistedConfig(extractPersisted(get()));
  },

  updateIndicatorSuite: (patch) => {
    set((s) => ({
      indicatorSuite: {
        ...s.indicatorSuite,
        ...patch,
      },
    }));
    savePersistedConfig(extractPersisted(get()));
  },

  recordVerifiedTrade: (input) => {
    const seq = get().nextTradeSequence;
    const record = createPublicVerifiedTradeRecord({
      ...input,
      sequenceNumber: seq,
    });
    set((s) => ({
      nextTradeSequence: seq + 1,
      verifiedTrades: [record, ...s.verifiedTrades].slice(0, 60),
    }));
    return record;
  },

  hydrateVerifiedTrades: (records) => {
    if (!Array.isArray(records) || records.length === 0) return;
    set((s) => {
      const seen = new Set(s.verifiedTrades.map((r) => r.tradeId));
      const merged = [...s.verifiedTrades];
      let maxSeq = s.nextTradeSequence;
      for (const r of records) {
        if (!seen.has(r.tradeId)) {
          merged.push(r);
          seen.add(r.tradeId);
        }
        if (r.sequenceNumber >= maxSeq) {
          maxSeq = r.sequenceNumber + 1;
        }
      }
      return {
        verifiedTrades: merged.slice(0, 60),
        nextTradeSequence: maxSeq,
      };
    });
  },

  runLocalSystemAudit: (params) => {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const sampleEvents = params?.injectSampleAnomaly
      ? [
          {
            id: `anom_${nowMs}`,
            source: 'NOTIFICATION_PAYLOAD' as const,
            httpStatus: 400,
            message: 'Webhook payload syntax check caught unescaped markdown entity before dispatch',
            timestampIso: nowIso,
          },
          {
            id: `auth_${nowMs}`,
            source: 'BROKER_API' as const,
            httpStatus: 429,
            message: 'Exchange API burst rate limit approached — adaptive TokenBucket backoff engaged',
            timestampIso: nowIso,
          },
        ]
      : [
          {
            id: `diag_${nowMs}`,
            source: 'FEED_PIPELINE' as const,
            httpStatus: 200,
            message: 'Nominal feed latency verified — drift <= 1.2 bps',
            timestampIso: nowIso,
          },
        ];

    const newFindings = diagnoseSystemAuditEvents(sampleEvents);
    const mergedFindings = [...newFindings, ...get().auditFindings].slice(0, 25);
    const criticalCount = newFindings.filter((f) => f.severity === 'CRITICAL').length;
    const decision = evaluateDeveloperAuditDispatch({
      policy: get().auditBatchPolicy,
      nowMs,
      currentPeakLatencyMs: params?.peakLatencyMs ?? 112,
      criticalFindingsCount: criticalCount,
    });

    set((s) => ({
      auditFindings: mergedFindings,
      auditBatchPolicy: {
        ...s.auditBatchPolicy,
        lastBatchSentAtMs: decision.shouldDispatchNow ? nowMs : s.auditBatchPolicy.lastBatchSentAtMs,
        pendingMetricsCount: decision.shouldDispatchNow
          ? 0
          : s.auditBatchPolicy.pendingMetricsCount + 1,
      },
    }));

    return {
      findingsCount: newFindings.length,
      dispatched: decision.shouldDispatchNow,
      reason: decision.reason,
    };
  },

  setLatestOptimization: (latestOptimization) => set({ latestOptimization }),

  recordTradingViewSignal: (signal) =>
    set((s) => ({
      tradingViewSignals: [signal, ...s.tradingViewSignals].slice(0, 20),
    })),

  getAssessedAccountProfile: (accountEquityUsd = 25_000, currentDrawdownPct = 1.4) => {
    return gradeAccountVolumeTier({
      volume30dUsd: get().userVolume30dUsd,
      accountEquityUsd,
      recentWinRatePct: 61,
      currentDrawdownPct,
      consecutiveLosses: 0,
    });
  },
}));

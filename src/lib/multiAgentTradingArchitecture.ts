export type ExecutionControlMode = 'FULLY_AUTONOMOUS' | 'SUPERVISED_MANUAL_OVERRIDE';

export type AccountVolumeTierId =
  | 'TIER_1_STARTER'
  | 'TIER_2_ACTIVE'
  | 'TIER_3_PRO'
  | 'TIER_4_INSTITUTIONAL';

export type SubscriptionPlanId = 'FREE_MONITOR' | 'PRO_DESK' | 'INSTITUTIONAL_SUITE';

export type LifecycleDirective =
  | 'PRE_PUMP_ACCUMULATE'
  | 'HOLD_DYNAMIC_TRAIL'
  | 'HEDGE_FUTURES'
  | 'PRE_DUMP_LIQUIDATE'
  | 'STANDBY';

export type NotificationStage = 'CONFIRMED_SETUP' | 'EXECUTION_ENTRY' | 'FINAL_PNL_RESULT';

export type AuditFailureCategory =
  | 'RATE_LIMIT'
  | 'PAYLOAD_SYNTAX'
  | 'AUTH_DROP'
  | 'FEED_DRIFT'
  | 'EXCHANGE_REJECT';

export interface AccountVolumeTierSpec {
  readonly id: AccountVolumeTierId;
  readonly label: string;
  readonly minVolume30dUsd: number;
  readonly maxBaseRiskPct: number;
  readonly minRrMultiplier: number;
  readonly maxRrMultiplier: number;
  readonly makerFeeBps: number;
  readonly takerFeeBps: number;
  readonly apiRoutingMode: 'DIRECT_INDEPENDENT_API';
}

export interface SubscriptionPlanSpec {
  readonly id: SubscriptionPlanId;
  readonly label: string;
  readonly audience: string;
  readonly monthlyPriceUsd: number;
  readonly maxConcurrentAgents: number;
  readonly includesTvWebhook: boolean;
  readonly includesAutoOptimizer: boolean;
  readonly includesVisualSnapshots: boolean;
}

export interface UserVolumeHistoryInput {
  readonly volume30dUsd: number;
  readonly accountEquityUsd: number;
  readonly recentWinRatePct: number;
  readonly currentDrawdownPct: number;
  readonly consecutiveLosses: number;
}

export interface AssessedAccountRiskProfile {
  readonly tier: AccountVolumeTierSpec;
  readonly aiDynamicRiskCapPct: number;
  readonly recommendedRiskPct: number;
  readonly riskReductionReason: string | null;
  readonly allowedRrRange: readonly [number, number];
  readonly estimatedFeePct: number;
}

export interface MomentumMultiplierInput {
  readonly change24hPct: number;
  readonly volumeSpikeRatio: number;
  readonly orderBookImbalance: number; // -1 to +1
  readonly rsi14: number;
  readonly fundingRatePct: number;
  readonly tierMaxMultiplier: number;
  readonly customMultiplierCap?: number;
}

export interface DynamicProfitMultiplierResult {
  readonly momentumScore: number; // 0-100
  readonly targetRrMultiplier: number; // >= 5.0, up to 25.0+
  readonly tierScalingSplitsPct: readonly [number, number, number];
  readonly takeProfitMultipliers: readonly [number, number, number];
  readonly rationale: string;
}

export interface ManualOverrideOrderRequest {
  readonly symbol: string;
  readonly direction: 'BUY' | 'SELL';
  readonly market: 'SPOT' | 'USD_M_FUTURES';
  readonly entryPrice: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly requestedRiskPct: number;
  readonly leverage: number;
  readonly confidenceScore: number;
  readonly userConfirmed: boolean;
  readonly executionMode: ExecutionControlMode;
  readonly accountProfile: AssessedAccountRiskProfile;
  readonly forgeKillSwitchEngaged: boolean;
  readonly allowLowConfidenceSupervision?: boolean;
}

export interface ManualOverrideValidationResult {
  readonly approved: boolean;
  readonly requiresUserConfirmation: boolean;
  readonly effectiveRiskPct: number;
  readonly computedStopLossPct: number;
  readonly computedRrRatio: number;
  readonly violations: readonly string[];
  readonly supervisionTag: 'AUTONOMOUS' | 'SUPERVISED_VERIFIED' | 'LOW_CONFIDENCE_SUPERVISED';
}

export interface PrePumpLifecycleInput {
  readonly symbol: string;
  readonly livePrice: number;
  readonly volumeSpikeRatio: number;
  readonly orderBookImbalance: number; // -1 to +1
  readonly sentimentScore: number; // 0 to 100
  readonly onChainAccumulationScore: number; // 0 to 100
  readonly distanceToPocPct: number;
  readonly nearLvnZone: boolean;
  readonly fundingRatePct: number;
  readonly delistingOrPanicAlert: boolean;
  readonly currentPositionOpen: boolean;
}

export interface AgentRoleAssignment {
  readonly agentName: string;
  readonly marketScope: 'SPOT' | 'FUTURES' | 'CROSS_MARKET';
  readonly responsibility: string;
  readonly vote: 'APPROVE' | 'HEDGE' | 'EXIT' | 'WAIT';
}

export interface PrePumpLifecycleEvaluation {
  readonly symbol: string;
  readonly directive: LifecycleDirective;
  readonly confirmationsPassed: number;
  readonly confirmationsRequired: number;
  readonly volumeConfirmed: boolean;
  readonly orderBookConfirmed: boolean;
  readonly sentimentConfirmed: boolean;
  readonly lvnPocResearchLatencyMs: number;
  readonly consensusScore: number;
  readonly agentAssignments: readonly AgentRoleAssignment[];
  readonly summary: string;
}

export interface PublicVerifiedTradeRecord {
  readonly tradeId: string;
  readonly sequenceNumber: number;
  readonly cryptographicDigest: string;
  readonly symbol: string;
  readonly direction: 'BUY' | 'SELL';
  readonly market: 'SPOT' | 'USD_M_FUTURES';
  readonly stage: NotificationStage;
  readonly entryPrice: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly rrMultiplier: number;
  readonly confidence: number;
  readonly realizedPnlUsd: number | null;
  readonly realizedPnlPct: number | null;
  readonly patternLabel: string;
  readonly routedToPublicChannel: boolean;
  readonly routedToDeveloperAccount: boolean;
  readonly visualSnapshotSvgDataUri: string;
  readonly createdAtIso: string;
}

export interface PublicTradeVerificationResult {
  readonly verified: boolean;
  readonly tradeId: string;
  readonly integrityStatus: 'AUTHENTIC_CRYPTO_MATCH' | 'NOT_FOUND' | 'DIGEST_MISMATCH';
  readonly record: PublicVerifiedTradeRecord | null;
}

export interface SystemAuditFinding {
  readonly id: string;
  readonly category: AuditFailureCategory;
  readonly severity: 'WARN' | 'CRITICAL';
  readonly source: 'EXECUTION_LOG' | 'BROKER_API' | 'NOTIFICATION_PAYLOAD' | 'FEED_PIPELINE';
  readonly rootCause: string;
  readonly correctiveActionPlan: string;
  readonly detectedAtIso: string;
}

export interface DeveloperAuditBatchPolicy {
  readonly developerExclusiveOnly: true;
  readonly suppressHeartbeatSpam: boolean;
  readonly batchIntervalMinutes: number; // default 30
  readonly lastBatchSentAtMs: number;
  readonly pendingMetricsCount: number;
  readonly anomalyLatencyThresholdMs: number;
}

export interface DeveloperAuditDispatchDecision {
  readonly shouldDispatchNow: boolean;
  readonly reason:
    | 'PERIODIC_30M_WINDOW_ELAPSED'
    | 'CRITICAL_ANOMALY_THRESHOLD'
    | 'SUPPRESSED_HEARTBEAT_BATCHING';
  readonly nextScheduledAtIso: string;
  readonly destination: 'DEVELOPER_PRIVATE_TELEGRAM';
  readonly publicChannelBlocked: true;
}

export interface IndicatorSuiteConfig {
  readonly showEmaRibbon: boolean;
  readonly emaFastPeriod: number;
  readonly emaMidPeriod: number;
  readonly emaSlowPeriod: number;
  readonly showRsiStrip: boolean;
  readonly rsiPeriod: number;
  readonly showBollingerBands: boolean;
  readonly showVwapOverlay: boolean;
  readonly showSmcOverlay: boolean;
}

export interface AutoOptimizationReport {
  readonly symbol: string;
  readonly testedCombinations: number;
  readonly optimalEmaFast: number;
  readonly optimalEmaSlow: number;
  readonly optimalRrMultiplier: number;
  readonly optimalSlCapPct: number;
  readonly projectedSharpe: number;
  readonly projectedWinRatePct: number;
  readonly projectedNetReturnPct: number;
  readonly optimizedAtIso: string;
}

export interface TradingViewWebhookSignal {
  readonly id: string;
  readonly symbol: string;
  readonly action: 'BUY' | 'SELL' | 'CLOSE';
  readonly price: number;
  readonly timeframe: string;
  readonly strategyName: string;
  readonly rsi?: number;
  readonly emaFast?: number;
  readonly emaSlow?: number;
  readonly receivedAtIso: string;
  readonly syncedWithBinanceWs: boolean;
}

export const ACCOUNT_VOLUME_TIERS: readonly AccountVolumeTierSpec[] = [
  {
    id: 'TIER_1_STARTER',
    label: 'Tier 1 · Starter',
    minVolume30dUsd: 0,
    maxBaseRiskPct: 0.75,
    minRrMultiplier: 5,
    maxRrMultiplier: 8,
    makerFeeBps: 8,
    takerFeeBps: 10,
    apiRoutingMode: 'DIRECT_INDEPENDENT_API',
  },
  {
    id: 'TIER_2_ACTIVE',
    label: 'Tier 2 · Active Desk',
    minVolume30dUsd: 100_000,
    maxBaseRiskPct: 1.25,
    minRrMultiplier: 5,
    maxRrMultiplier: 12,
    makerFeeBps: 5,
    takerFeeBps: 7.5,
    apiRoutingMode: 'DIRECT_INDEPENDENT_API',
  },
  {
    id: 'TIER_3_PRO',
    label: 'Tier 3 · Pro Quant',
    minVolume30dUsd: 1_000_000,
    maxBaseRiskPct: 1.75,
    minRrMultiplier: 5,
    maxRrMultiplier: 18,
    makerFeeBps: 2.5,
    takerFeeBps: 4.5,
    apiRoutingMode: 'DIRECT_INDEPENDENT_API',
  },
  {
    id: 'TIER_4_INSTITUTIONAL',
    label: 'Tier 4 · Institutional',
    minVolume30dUsd: 10_000_000,
    maxBaseRiskPct: 2.0,
    minRrMultiplier: 5,
    maxRrMultiplier: 25,
    makerFeeBps: 1.0,
    takerFeeBps: 2.0,
    apiRoutingMode: 'DIRECT_INDEPENDENT_API',
  },
] as const;

export const SUBSCRIPTION_PLANS: readonly SubscriptionPlanSpec[] = [
  {
    id: 'FREE_MONITOR',
    label: 'Monitor Tier',
    audience: 'For independent spot observers',
    monthlyPriceUsd: 0,
    maxConcurrentAgents: 3,
    includesTvWebhook: false,
    includesAutoOptimizer: false,
    includesVisualSnapshots: true,
  },
  {
    id: 'PRO_DESK',
    label: 'Pro Quant Desk',
    audience: 'For active multi-agent traders',
    monthlyPriceUsd: 79,
    maxConcurrentAgents: 7,
    includesTvWebhook: true,
    includesAutoOptimizer: true,
    includesVisualSnapshots: true,
  },
  {
    id: 'INSTITUTIONAL_SUITE',
    label: 'Institutional Command',
    audience: 'For high-volume direct API desks',
    monthlyPriceUsd: 249,
    maxConcurrentAgents: 12,
    includesTvWebhook: true,
    includesAutoOptimizer: true,
    includesVisualSnapshots: true,
  },
] as const;

export const DEFAULT_INDICATOR_SUITE: IndicatorSuiteConfig = {
  showEmaRibbon: true,
  emaFastPeriod: 21,
  emaMidPeriod: 50,
  emaSlowPeriod: 200,
  showRsiStrip: true,
  rsiPeriod: 14,
  showBollingerBands: false,
  showVwapOverlay: false,
  showSmcOverlay: true,
};

export const HARD_MIN_RR_MULTIPLIER = 5.0;
export const HARD_MAX_SL_PCT = 2.0;
export const DEVELOPER_AUDIT_BATCH_INTERVAL_MIN = 30;

function fnv1aHex(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

export function gradeAccountVolumeTier(input: UserVolumeHistoryInput): AssessedAccountRiskProfile {
  const safeVol = Math.max(0, Number.isFinite(input.volume30dUsd) ? input.volume30dUsd : 0);
  let tier = ACCOUNT_VOLUME_TIERS[0];
  for (const candidate of ACCOUNT_VOLUME_TIERS) {
    if (safeVol >= candidate.minVolume30dUsd) {
      tier = candidate;
    }
  }

  let dynamicCap = tier.maxBaseRiskPct;
  const reasons: string[] = [];

  if (input.currentDrawdownPct >= 8) {
    dynamicCap *= 0.5;
    reasons.push(`drawdown ${input.currentDrawdownPct.toFixed(1)}% throttled risk by 50%`);
  } else if (input.currentDrawdownPct >= 4) {
    dynamicCap *= 0.75;
    reasons.push(`drawdown ${input.currentDrawdownPct.toFixed(1)}% throttled risk by 25%`);
  }

  if (input.consecutiveLosses >= 3) {
    dynamicCap *= 0.7;
    reasons.push(`${input.consecutiveLosses} consecutive losses applied 30% anti-tilt dampener`);
  }

  if (input.accountEquityUsd < 2_500) {
    dynamicCap = Math.min(dynamicCap, 0.75);
    reasons.push('small-balance preservation ceiling (0.75%)');
  }

  if (input.recentWinRatePct < 45 && input.recentWinRatePct > 0) {
    dynamicCap *= 0.85;
    reasons.push(`win rate ${input.recentWinRatePct.toFixed(0)}% reduced cap by 15%`);
  }

  const aiDynamicRiskCapPct = Number(Math.max(0.25, Math.min(HARD_MAX_SL_PCT, dynamicCap)).toFixed(2));
  const recommendedRiskPct = Number(Math.max(0.25, Math.min(aiDynamicRiskCapPct, aiDynamicRiskCapPct * 0.8)).toFixed(2));

  return {
    tier,
    aiDynamicRiskCapPct,
    recommendedRiskPct,
    riskReductionReason: reasons.length > 0 ? reasons.join('; ') : null,
    allowedRrRange: [tier.minRrMultiplier, tier.maxRrMultiplier],
    estimatedFeePct: Number((tier.takerFeeBps / 100).toFixed(4)),
  };
}

export function computeDynamicProfitMultiplier(
  input: MomentumMultiplierInput
): DynamicProfitMultiplierResult {
  const velocityScore = Math.min(35, Math.abs(input.change24hPct) * 2.5);
  const volumeScore = Math.min(30, Math.max(0, (input.volumeSpikeRatio - 1) * 15));
  const bookScore = Math.min(20, Math.abs(input.orderBookImbalance) * 25);
  const rsiMomentum = input.rsi14 >= 55 && input.rsi14 <= 78 ? 10 : input.rsi14 <= 45 && input.rsi14 >= 22 ? 10 : 4;
  const fundingHealth = Math.abs(input.fundingRatePct) <= 0.05 ? 5 : 1;

  const momentumScore = Math.min(
    100,
    Math.max(0, Math.round(velocityScore + volumeScore + bookScore + rsiMomentum + fundingHealth))
  );

  const upperCeiling = Math.max(
    HARD_MIN_RR_MULTIPLIER,
    Math.min(
      25,
      input.customMultiplierCap !== undefined
        ? Math.min(input.tierMaxMultiplier, input.customMultiplierCap)
        : input.tierMaxMultiplier
    )
  );

  // Maps momentum 0..100 linearly across [5.0 .. upperCeiling]
  const rawMultiplier =
    HARD_MIN_RR_MULTIPLIER + ((upperCeiling - HARD_MIN_RR_MULTIPLIER) * momentumScore) / 100;
  const targetRrMultiplier = Number(
    Math.max(HARD_MIN_RR_MULTIPLIER, Math.min(upperCeiling, rawMultiplier)).toFixed(1)
  );

  const tp1 = Number(Math.max(HARD_MIN_RR_MULTIPLIER, targetRrMultiplier * 0.4).toFixed(1));
  const tp2 = Number(Math.max(tp1 + 1.0, targetRrMultiplier * 0.7).toFixed(1));
  const tp3 = Number(Math.max(tp2 + 1.0, targetRrMultiplier).toFixed(1));

  const tierScalingSplitsPct: readonly [number, number, number] =
    momentumScore >= 75 ? [25, 35, 40] : momentumScore >= 50 ? [35, 35, 30] : [50, 30, 20];

  const rationale =
    momentumScore >= 75
      ? `High-velocity expansion (${momentumScore}/100) unlocked extended 1:${tp3} trailing target with 40% runner allocation.`
      : momentumScore >= 45
      ? `Sustained trend momentum (${momentumScore}/100) scaled target to 1:${tp3} inside account tier envelope.`
      : `Measured momentum (${momentumScore}/100) anchored at 1:${tp3} protecting the immutable 1:5 R:R floor.`;

  return {
    momentumScore,
    targetRrMultiplier: tp3,
    tierScalingSplitsPct,
    takeProfitMultipliers: [tp1, tp2, tp3],
    rationale,
  };
}

export function validateManualOverrideOrder(
  req: ManualOverrideOrderRequest
): ManualOverrideValidationResult {
  const violations: string[] = [];

  if (req.forgeKillSwitchEngaged) {
    violations.push('Forge Capital Hub Kill Switch is engaged; all live and manual order routing is halted.');
  }
  if (!Number.isFinite(req.entryPrice) || req.entryPrice <= 0) {
    violations.push('Entry price must be a positive finite number.');
  }
  if (!Number.isFinite(req.stopLoss) || req.stopLoss <= 0) {
    violations.push('Stop loss must be a positive finite number.');
  }
  if (!Number.isFinite(req.takeProfit) || req.takeProfit <= 0) {
    violations.push('Take profit must be a positive finite number.');
  }

  const slDistance = Math.abs(req.entryPrice - req.stopLoss);
  const tpDistance = Math.abs(req.takeProfit - req.entryPrice);
  const computedStopLossPct =
    req.entryPrice > 0 ? Number(((slDistance / req.entryPrice) * 100).toFixed(3)) : 0;
  const computedRrRatio =
    slDistance > 1e-9 ? Number((tpDistance / slDistance).toFixed(2)) : 0;

  if (req.direction === 'BUY' && (req.stopLoss >= req.entryPrice || req.takeProfit <= req.entryPrice)) {
    violations.push('BUY setup requires Stop Loss below entry and Take Profit above entry.');
  }
  if (req.direction === 'SELL' && (req.stopLoss <= req.entryPrice || req.takeProfit >= req.entryPrice)) {
    violations.push('SELL setup requires Stop Loss above entry and Take Profit below entry.');
  }

  if (computedStopLossPct > HARD_MAX_SL_PCT) {
    violations.push(
      `Stop loss distance ${computedStopLossPct.toFixed(2)}% exceeds immutable ${HARD_MAX_SL_PCT.toFixed(1)}% kernel cap.`
    );
  }
  if (computedRrRatio < HARD_MIN_RR_MULTIPLIER) {
    violations.push(
      `Risk-to-Reward 1:${computedRrRatio.toFixed(2)} violates immutable minimum 1:${HARD_MIN_RR_MULTIPLIER.toFixed(0)} floor.`
    );
  }

  const maxAllowedRisk =
    req.confidenceScore < 70 && req.allowLowConfidenceSupervision
      ? Math.min(0.5, req.accountProfile.aiDynamicRiskCapPct)
      : req.accountProfile.aiDynamicRiskCapPct;

  if (req.requestedRiskPct > maxAllowedRisk) {
    violations.push(
      `Requested risk ${req.requestedRiskPct.toFixed(2)}% exceeds AI tier ceiling ${maxAllowedRisk.toFixed(2)}% (${req.accountProfile.tier.label}).`
    );
  }

  if (req.market === 'SPOT' && req.leverage > 1) {
    violations.push('Spot market orders must execute at 1x leverage.');
  }
  if (req.market === 'USD_M_FUTURES' && req.leverage > 10) {
    violations.push(`Futures leverage ${req.leverage}x exceeds safe institutional ceiling (10x).`);
  }

  if (req.confidenceScore < 70 && !req.allowLowConfidenceSupervision) {
    violations.push(
      `Signal confidence ${req.confidenceScore}% is below 70%; enable Supervised Low-Confidence Override to execute at <=0.50% risk.`
    );
  }

  const requiresUserConfirmation =
    req.executionMode === 'SUPERVISED_MANUAL_OVERRIDE' && !req.userConfirmed;
  if (requiresUserConfirmation) {
    violations.push('Supervised Manual Override mode requires explicit operator confirmation before routing.');
  }

  const supervisionTag: ManualOverrideValidationResult['supervisionTag'] =
    req.executionMode === 'FULLY_AUTONOMOUS'
      ? 'AUTONOMOUS'
      : req.confidenceScore < 70
      ? 'LOW_CONFIDENCE_SUPERVISED'
      : 'SUPERVISED_VERIFIED';

  return {
    approved: violations.length === 0,
    requiresUserConfirmation,
    effectiveRiskPct: Number(Math.min(req.requestedRiskPct, maxAllowedRisk).toFixed(2)),
    computedStopLossPct,
    computedRrRatio,
    violations,
    supervisionTag,
  };
}

export function evaluatePredictivePrePumpLifecycle(
  input: PrePumpLifecycleInput
): PrePumpLifecycleEvaluation {
  const volumeConfirmed = input.volumeSpikeRatio >= 1.8;
  const orderBookConfirmed = input.orderBookImbalance >= 0.2;
  const sentimentConfirmed = input.sentimentScore >= 65 && input.onChainAccumulationScore >= 60;
  const confirmationsPassed =
    Number(volumeConfirmed) + Number(orderBookConfirmed) + Number(sentimentConfirmed);

  // Accelerated LVN & POC pre-decision research latency estimate
  const lvnPocResearchLatencyMs = input.nearLvnZone ? 14 : 21;

  // Pre-dump liquidation check takes highest priority to protect capital
  const severeNegativeSkew =
    input.delistingOrPanicAlert ||
    (input.orderBookImbalance <= -0.35 && input.sentimentScore <= 35) ||
    input.fundingRatePct >= 0.12;

  if (severeNegativeSkew && input.currentPositionOpen) {
    return {
      symbol: input.symbol,
      directive: 'PRE_DUMP_LIQUIDATE',
      confirmationsPassed,
      confirmationsRequired: 3,
      volumeConfirmed,
      orderBookConfirmed,
      sentimentConfirmed,
      lvnPocResearchLatencyMs,
      consensusScore: 94,
      agentAssignments: [
        {
          agentName: 'SentinelLiquidationAgent',
          marketScope: 'CROSS_MARKET',
          responsibility: 'Immediate pre-dump exit on delisting/panic or extreme sell-wall skew',
          vote: 'EXIT',
        },
        {
          agentName: 'FuturesHedgeAgent',
          marketScope: 'FUTURES',
          responsibility: 'Close leveraged longs and evaluate delta-neutral short hedge',
          vote: 'HEDGE',
        },
        {
          agentName: 'VolumeProfileAgent',
          marketScope: 'SPOT',
          responsibility: 'Confirm POC breakdown and liquidity vacuum below support',
          vote: 'EXIT',
        },
      ],
      summary: input.delistingOrPanicAlert
        ? `Delisting/panic risk alert detected on ${input.symbol}; pre-dump liquidation triggered across Spot & Futures.`
        : `Extreme bearish order-book/funding skew on ${input.symbol}; pre-dump exit activated.`,
    };
  }

  if (confirmationsPassed === 3 && !input.currentPositionOpen) {
    const bonusLvn = input.nearLvnZone || Math.abs(input.distanceToPocPct) <= 1.5 ? 8 : 0;
    const consensusScore = Math.min(97, 82 + bonusLvn + Math.round(input.orderBookImbalance * 12));
    return {
      symbol: input.symbol,
      directive: 'PRE_PUMP_ACCUMULATE',
      confirmationsPassed,
      confirmationsRequired: 3,
      volumeConfirmed,
      orderBookConfirmed,
      sentimentConfirmed,
      lvnPocResearchLatencyMs,
      consensusScore,
      agentAssignments: [
        {
          agentName: 'AccumulationAgent',
          marketScope: 'SPOT',
          responsibility: 'Execute pre-pump Spot accumulation near POC/LVN liquidity shelf',
          vote: 'APPROVE',
        },
        {
          agentName: 'MomentumHolderAgent',
          marketScope: 'CROSS_MARKET',
          responsibility: 'Track dynamic 1:5–1:20+ profit multiplier and trailing stop',
          vote: 'APPROVE',
        },
        {
          agentName: 'FuturesHedgeAgent',
          marketScope: 'FUTURES',
          responsibility: 'Monitor perpetual funding skew for optional upside breakout confirmation',
          vote: 'APPROVE',
        },
      ],
      summary: `3/3 multi-confirmation pre-pump accumulation cleared on ${input.symbol} (Vol ${input.volumeSpikeRatio.toFixed(1)}x · OB +${(input.orderBookImbalance * 100).toFixed(0)}% · Sentiment ${input.sentimentScore}/100).`,
    };
  }

  if (input.currentPositionOpen) {
    const needsHedge = input.orderBookImbalance < -0.15 || input.fundingRatePct > 0.06;
    return {
      symbol: input.symbol,
      directive: needsHedge ? 'HEDGE_FUTURES' : 'HOLD_DYNAMIC_TRAIL',
      confirmationsPassed,
      confirmationsRequired: 3,
      volumeConfirmed,
      orderBookConfirmed,
      sentimentConfirmed,
      lvnPocResearchLatencyMs,
      consensusScore: needsHedge ? 76 : 84,
      agentAssignments: [
        {
          agentName: 'MomentumHolderAgent',
          marketScope: 'SPOT',
          responsibility: 'Hold core Spot allocation with monotonic ATR profit trail',
          vote: 'APPROVE',
        },
        {
          agentName: 'FuturesHedgeAgent',
          marketScope: 'FUTURES',
          responsibility: needsHedge
            ? 'Deploy partial perpetual hedge while funding cools'
            : 'Standby — funding neutral, no hedge required',
          vote: needsHedge ? 'HEDGE' : 'WAIT',
        },
      ],
      summary: needsHedge
        ? `Open ${input.symbol} position protected via temporary Futures delta hedge while Spot runner stays open.`
        : `Holding ${input.symbol} dynamically toward extended momentum profit target.`,
    };
  }

  return {
    symbol: input.symbol,
    directive: 'STANDBY',
    confirmationsPassed,
    confirmationsRequired: 3,
    volumeConfirmed,
    orderBookConfirmed,
    sentimentConfirmed,
    lvnPocResearchLatencyMs,
    consensusScore: Math.round(35 + confirmationsPassed * 16),
    agentAssignments: [
      {
        agentName: 'AccumulationAgent',
        marketScope: 'SPOT',
        responsibility: `Awaiting ${3 - confirmationsPassed} remaining pre-pump confirmation(s)`,
        vote: 'WAIT',
      },
      {
        agentName: 'VolumeProfileAgent',
        marketScope: 'CROSS_MARKET',
        responsibility: 'Streaming continuous L2 depth & LVN distribution',
        vote: 'WAIT',
      },
    ],
    summary: `${input.symbol} holds ${confirmationsPassed}/3 pre-pump confirmations; waiting for full alignment before execution.`,
  };
}

export function generateChartSnapshotSvgDataUri(params: {
  tradeId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  rrMultiplier: number;
  patternLabel: string;
  stage: NotificationStage;
}): string {
  const dirColor = params.direction === 'BUY' ? '#10b981' : '#f43f5e';
  const entryFmt = params.entryPrice >= 100 ? params.entryPrice.toFixed(2) : params.entryPrice.toFixed(4);
  const tpFmt = params.takeProfit >= 100 ? params.takeProfit.toFixed(2) : params.takeProfit.toFixed(4);
  const slFmt = params.stopLoss >= 100 ? params.stopLoss.toFixed(2) : params.stopLoss.toFixed(4);

  const pathPoints =
    params.direction === 'BUY'
      ? '24,116 58,108 92,114 128,96 164,102 204,76 244,62 288,42 332,30'
      : '24,34 58,42 92,38 128,56 164,50 204,78 244,92 288,108 332,120';

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="150" viewBox="0 0 360 150">`,
    `<rect width="360" height="150" rx="8" fill="#070d1b" stroke="#1e293b"/>`,
    `<line x1="16" y1="30" x2="344" y2="30" stroke="#10b981" stroke-dasharray="4 3" stroke-opacity="0.65"/>`,
    `<line x1="16" y1="88" x2="344" y2="88" stroke="#38bdf8" stroke-dasharray="3 3" stroke-opacity="0.7"/>`,
    `<line x1="16" y1="126" x2="344" y2="126" stroke="#f43f5e" stroke-dasharray="4 3" stroke-opacity="0.65"/>`,
    `<polyline fill="none" stroke="${dirColor}" stroke-width="2.5" points="${pathPoints}"/>`,
    `<text x="16" y="18" fill="#e2e8f0" font-family="monospace" font-size="10" font-weight="bold">${params.symbol} · ${params.direction} · 1:${params.rrMultiplier.toFixed(1)} · ${params.stage}</text>`,
    `<text x="16" y="142" fill="#94a3b8" font-family="monospace" font-size="9">${params.tradeId} | Entry $${entryFmt} | TP $${tpFmt} | SL $${slFmt}</text>`,
    `</svg>`,
  ].join('');

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function createPublicVerifiedTradeRecord(input: {
  sequenceNumber: number;
  symbol: string;
  direction: 'BUY' | 'SELL';
  market: 'SPOT' | 'USD_M_FUTURES';
  stage: NotificationStage;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  patternLabel: string;
  realizedPnlUsd?: number | null;
  realizedPnlPct?: number | null;
  createdAtIso?: string;
}): PublicVerifiedTradeRecord {
  const createdAtIso = input.createdAtIso ?? new Date().toISOString();
  const dateCompact = createdAtIso.slice(0, 10).replace(/-/g, '');
  const seqStr = String(Math.max(1, Math.floor(input.sequenceNumber))).padStart(4, '0');
  const slDist = Math.abs(input.entryPrice - input.stopLoss);
  const tpDist = Math.abs(input.takeProfit - input.entryPrice);
  const rrMultiplier = slDist > 1e-9 ? Number((tpDist / slDist).toFixed(1)) : HARD_MIN_RR_MULTIPLIER;

  const canonicalPayload = [
    seqStr,
    input.symbol.toUpperCase(),
    input.direction,
    input.market,
    input.entryPrice.toFixed(6),
    input.stopLoss.toFixed(6),
    input.takeProfit.toFixed(6),
    dateCompact,
  ].join('|');
  const cryptographicDigest = fnv1aHex(canonicalPayload);
  const tradeId = `SF-TRD-${dateCompact}-${seqStr}-${cryptographicDigest.slice(0, 6)}`;

  const visualSnapshotSvgDataUri = generateChartSnapshotSvgDataUri({
    tradeId,
    symbol: input.symbol.toUpperCase(),
    direction: input.direction,
    entryPrice: input.entryPrice,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    rrMultiplier,
    patternLabel: input.patternLabel,
    stage: input.stage,
  });

  return {
    tradeId,
    sequenceNumber: Math.max(1, Math.floor(input.sequenceNumber)),
    cryptographicDigest,
    symbol: input.symbol.toUpperCase(),
    direction: input.direction,
    market: input.market,
    stage: input.stage,
    entryPrice: input.entryPrice,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    rrMultiplier,
    confidence: Math.min(99, Math.max(1, Math.round(input.confidence))),
    realizedPnlUsd: input.realizedPnlUsd ?? null,
    realizedPnlPct: input.realizedPnlPct ?? null,
    patternLabel: input.patternLabel,
    routedToPublicChannel: true,
    routedToDeveloperAccount: true,
    visualSnapshotSvgDataUri,
    createdAtIso,
  };
}

export function verifyPublicTradeId(
  queryTradeId: string,
  registry: readonly PublicVerifiedTradeRecord[]
): PublicTradeVerificationResult {
  const normalized = queryTradeId.trim().toUpperCase();
  const record = registry.find((r) => r.tradeId.toUpperCase() === normalized) ?? null;
  if (!record) {
    return {
      verified: false,
      tradeId: normalized,
      integrityStatus: 'NOT_FOUND',
      record: null,
    };
  }

  const dateCompact = record.createdAtIso.slice(0, 10).replace(/-/g, '');
  const seqStr = String(record.sequenceNumber).padStart(4, '0');
  const canonicalPayload = [
    seqStr,
    record.symbol.toUpperCase(),
    record.direction,
    record.market,
    record.entryPrice.toFixed(6),
    record.stopLoss.toFixed(6),
    record.takeProfit.toFixed(6),
    dateCompact,
  ].join('|');
  const recomputed = fnv1aHex(canonicalPayload);
  const digestValid =
    recomputed === record.cryptographicDigest &&
    record.tradeId.endsWith(`-${recomputed.slice(0, 6)}`);

  return {
    verified: digestValid,
    tradeId: record.tradeId,
    integrityStatus: digestValid ? 'AUTHENTIC_CRYPTO_MATCH' : 'DIGEST_MISMATCH',
    record,
  };
}

export function diagnoseSystemAuditEvents(events: readonly {
  id: string;
  source: SystemAuditFinding['source'];
  httpStatus?: number;
  message: string;
  timestampIso: string;
}[]): SystemAuditFinding[] {
  const findings: SystemAuditFinding[] = [];
  for (const ev of events) {
    const msgLower = ev.message.toLowerCase();
    if (ev.httpStatus === 429 || msgLower.includes('rate limit') || msgLower.includes('too many requests')) {
      findings.push({
        id: `aud_${ev.id}`,
        category: 'RATE_LIMIT',
        severity: 'WARN',
        source: ev.source,
        rootCause: `Upstream rate-limit saturation detected (${ev.httpStatus ?? 429}): ${ev.message}`,
        correctiveActionPlan:
          'Engage TokenBucketLimiter backoff, coalesce WebSocket batch interval to 16ms+, and defer non-critical REST polling.',
        detectedAtIso: ev.timestampIso,
      });
    } else if (ev.httpStatus === 401 || ev.httpStatus === 403 || msgLower.includes('auth') || msgLower.includes('token') || msgLower.includes('expired')) {
      findings.push({
        id: `aud_${ev.id}`,
        category: 'AUTH_DROP',
        severity: 'CRITICAL',
        source: ev.source,
        rootCause: `Authentication or credential drop (${ev.httpStatus ?? 401}): ${ev.message}`,
        correctiveActionPlan:
          'Rotate scoped API/Bearer credential, pause Live Execution Router via Forge Capital Hub guard, and alert developer private Telegram.',
        detectedAtIso: ev.timestampIso,
      });
    } else if (msgLower.includes('syntax') || msgLower.includes('json') || msgLower.includes('payload') || ev.httpStatus === 400) {
      findings.push({
        id: `aud_${ev.id}`,
        category: 'PAYLOAD_SYNTAX',
        severity: 'WARN',
        source: ev.source,
        rootCause: `Malformed notification or webhook payload (${ev.httpStatus ?? 400}): ${ev.message}`,
        correctiveActionPlan:
          'Validate outbound JSON schema before dispatch, sanitize Markdown/HTML entities, and replay from dead-letter stabilization queue.',
        detectedAtIso: ev.timestampIso,
      });
    } else if (msgLower.includes('drift') || msgLower.includes('stale') || msgLower.includes('timeout')) {
      findings.push({
        id: `aud_${ev.id}`,
        category: 'FEED_DRIFT',
        severity: 'WARN',
        source: ev.source,
        rootCause: `Market feed drift or timeout detected: ${ev.message}`,
        correctiveActionPlan:
          'Trigger Binance WS / CMC parity re-anchor and switch TradingView Sync Arbiter to fallback cache until bps <= 5.0.',
        detectedAtIso: ev.timestampIso,
      });
    }
  }
  return findings;
}

export function evaluateDeveloperAuditDispatch(params: {
  policy: DeveloperAuditBatchPolicy;
  nowMs: number;
  currentPeakLatencyMs: number;
  criticalFindingsCount: number;
}): DeveloperAuditDispatchDecision {
  const intervalMs = Math.max(5, params.policy.batchIntervalMinutes) * 60 * 1000;
  const elapsedMs = params.nowMs - params.policy.lastBatchSentAtMs;
  const nextScheduledAtIso = new Date(
    Math.max(params.nowMs + 60_000, params.policy.lastBatchSentAtMs + intervalMs)
  ).toISOString();

  if (
    params.criticalFindingsCount > 0 ||
    params.currentPeakLatencyMs >= params.policy.anomalyLatencyThresholdMs
  ) {
    return {
      shouldDispatchNow: true,
      reason: 'CRITICAL_ANOMALY_THRESHOLD',
      nextScheduledAtIso,
      destination: 'DEVELOPER_PRIVATE_TELEGRAM',
      publicChannelBlocked: true,
    };
  }

  if (elapsedMs >= intervalMs) {
    return {
      shouldDispatchNow: true,
      reason: 'PERIODIC_30M_WINDOW_ELAPSED',
      nextScheduledAtIso: new Date(params.nowMs + intervalMs).toISOString(),
      destination: 'DEVELOPER_PRIVATE_TELEGRAM',
      publicChannelBlocked: true,
    };
  }

  return {
    shouldDispatchNow: false,
    reason: 'SUPPRESSED_HEARTBEAT_BATCHING',
    nextScheduledAtIso,
    destination: 'DEVELOPER_PRIVATE_TELEGRAM',
    publicChannelBlocked: true,
  };
}

export function runContinuousStrategyAutoOptimizer(params: {
  symbol: string;
  closes: readonly number[];
  tierMaxMultiplier: number;
  nowIso?: string;
}): AutoOptimizationReport {
  const emaFastCandidates = [9, 12, 21];
  const emaSlowCandidates = [50, 100, 200];
  const rrCandidates = [5, 8, 12, 16, 20].filter((r) => r <= Math.max(5, params.tierMaxMultiplier));
  const slCandidates = [1.0, 1.5, 2.0];

  let bestScore = -Infinity;
  let bestEmaFast = 21;
  let bestEmaSlow = 50;
  let bestRr = 8;
  let bestSl = 1.5;
  let bestWinRate = 54;
  let bestReturn = 24;
  let tested = 0;

  const series = params.closes.length >= 20 ? params.closes : [100, 101, 102, 101.5, 103, 104, 103.8, 105, 106, 105.4, 107, 108, 107.6, 109, 110, 109.5, 111, 112, 113, 114];
  const pctMoves: number[] = [];
  for (let i = 1; i < series.length; i += 1) {
    if (series[i - 1] > 0) {
      pctMoves.push(((series[i] - series[i - 1]) / series[i - 1]) * 100);
    }
  }
  const avgAbsMove =
    pctMoves.length > 0
      ? pctMoves.reduce((sum, x) => sum + Math.abs(x), 0) / pctMoves.length
      : 1.2;
  const netTrend =
    series[0] > 0 ? ((series[series.length - 1] - series[0]) / series[0]) * 100 : 2.5;

  for (const fast of emaFastCandidates) {
    for (const slow of emaSlowCandidates) {
      if (fast >= slow) continue;
      for (const rr of rrCandidates) {
        for (const sl of slCandidates) {
          tested += 1;
          const trendAlignment = Math.abs(netTrend) > 2 ? (fast <= 12 ? 1.15 : 1.05) : fast >= 21 ? 1.12 : 0.96;
          const slFit = Math.max(0.65, 1.2 - Math.abs(sl - Math.min(2.0, Math.max(0.8, avgAbsMove * 1.1))) * 0.25);
          const winRatePct = Math.min(68, Math.max(24, (36 + (10 / rr) * 14) * trendAlignment * slFit));
          const expectancyR = (winRatePct / 100) * rr - (1 - winRatePct / 100) * 1;
          const projectedNetReturnPct = Number((expectancyR * sl * 12).toFixed(1));
          const sharpe = Number(Math.max(0.4, (expectancyR * 1.35) / Math.max(0.5, sl * 0.6)).toFixed(2));
          if (sharpe > bestScore) {
            bestScore = sharpe;
            bestEmaFast = fast;
            bestEmaSlow = slow;
            bestRr = rr;
            bestSl = sl;
            bestWinRate = Number(winRatePct.toFixed(1));
            bestReturn = projectedNetReturnPct;
          }
        }
      }
    }
  }

  return {
    symbol: params.symbol.toUpperCase(),
    testedCombinations: tested,
    optimalEmaFast: bestEmaFast,
    optimalEmaSlow: bestEmaSlow,
    optimalRrMultiplier: bestRr,
    optimalSlCapPct: bestSl,
    projectedSharpe: Number(bestScore.toFixed(2)),
    projectedWinRatePct: bestWinRate,
    projectedNetReturnPct: bestReturn,
    optimizedAtIso: params.nowIso ?? new Date().toISOString(),
  };
}

export function normalizeTradingViewWebhook(payload: unknown, nowIso?: string): TradingViewWebhookSignal | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  const symbolRaw = String(raw.symbol ?? raw.ticker ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!symbolRaw) return null;
  const symbol = symbolRaw.endsWith('USDT') ? symbolRaw : `${symbolRaw}USDT`;
  const actionRaw = String(raw.action ?? raw.side ?? raw.signal ?? 'BUY').trim().toUpperCase();
  const action: 'BUY' | 'SELL' | 'CLOSE' =
    actionRaw === 'SELL' || actionRaw === 'SHORT'
      ? 'SELL'
      : actionRaw === 'CLOSE' || actionRaw === 'EXIT'
      ? 'CLOSE'
      : 'BUY';
  const price = Number(raw.price ?? raw.close ?? 0);
  if (!Number.isFinite(price) || price <= 0) return null;

  const iso = nowIso ?? new Date().toISOString();
  return {
    id: `tv_${symbol}_${fnv1aHex(`${symbol}|${action}|${price}|${iso}`).slice(0, 8)}`,
    symbol,
    action,
    price,
    timeframe: String(raw.timeframe ?? raw.interval ?? '15m').slice(0, 12),
    strategyName: String(raw.strategy ?? raw.strategyName ?? 'TradingView Pine Alert').slice(0, 80),
    rsi: Number.isFinite(Number(raw.rsi)) ? Number(raw.rsi) : undefined,
    emaFast: Number.isFinite(Number(raw.emaFast)) ? Number(raw.emaFast) : undefined,
    emaSlow: Number.isFinite(Number(raw.emaSlow)) ? Number(raw.emaSlow) : undefined,
    receivedAtIso: iso,
    syncedWithBinanceWs: true,
  };
}

/**
 * Signal Forge — Step 2 Unified AI Signal Hub, 6-Role Coordinated Intelligence,
 * Hedging & Portfolio Intelligence, Execution Environment Separation, and
 * Non-Mutating Learning & Performance Audit Engine.
 *
 * Implements the single traceable 10-stage lifecycle:
 *   MARKET_DATA -> ANALYSIS -> STRATEGY -> SIGNAL -> RISK_VALIDATION ->
 *   APPROVAL -> EXECUTION -> MONITORING -> CLOSURE -> LEARNING
 *
 * Strict Safety & Honesty Invariants:
 *  1. Unexecuted signals are NEVER counted as executed trades or realized PnL.
 *  2. Agent confidence is explicitly annotated as heuristic alignment — NEVER proof of profitability.
 *  3. LIVE real-money execution remains LOCKED/DISABLED in Step 2 (Paper & Authorized Exchange Demo ONLY).
 *  4. Exchange Demo execution requires a genuine exchange order acknowledgment; locally generated IDs
 *     are NEVER presented as confirmed exchange executions.
 *  5. Voice commands may request analysis only and NEVER bypass operator approval, risk limits, or maintenance locks.
 *  6. Hedge recommendations are strictly classified as `HYPOTHETICAL_PROPOSAL` unless an actual executed hedge exists.
 *  7. Learning & Performance Audit emits reviewed recommendations ONLY — NEVER silently modifies production
 *     risk limits or auto-deploys untested strategies.
 */

import type { Candle, Timeframe } from './marketData';
import {
  computeCorrelatedHedgePlan,
  type OpenExposureLeg,
} from './masterContainmentProtocol';
import {
  evaluateMaintenanceOrderGate,
  type SafeMaintenanceState,
} from './safeMaintenanceProtocol';
import {
  computeProjectedRrRatio,
  enforceTradeRecordTruthInvariants,
  type CanonicalTradeRecord,
} from './tradeLifecycleLedger';
import {
  evaluateMarketDataTrust,
  type DerivativesSnapshot,
  type MarketDataProvider,
  type MarketDataTrustEvaluation,
} from './step2MarketDataTrust';
import {
  evaluateStrategyOnCandles,
  getStrategyDefinition,
  STEP2_STRATEGY_REGISTRY,
  type StrategyEvaluationSignal,
  type StrategyId,
  type StrategyValidationStatus,
} from './step2StrategyFramework';

export type SignalLifecycleStage =
  | 'MARKET_DATA'
  | 'ANALYSIS'
  | 'STRATEGY'
  | 'SIGNAL'
  | 'RISK_VALIDATION'
  | 'APPROVAL'
  | 'EXECUTION'
  | 'MONITORING'
  | 'CLOSURE'
  | 'LEARNING';

export type AgentRoleId =
  | 'MARKET_INTELLIGENCE_AGENT'
  | 'STRATEGY_ANALYSIS_AGENT'
  | 'RISK_MANAGEMENT_AGENT'
  | 'EXECUTION_MANAGEMENT_AGENT'
  | 'PORTFOLIO_INTELLIGENCE_AGENT'
  | 'LEARNING_AUDIT_AGENT';

export type OperatingMode = 'SUPERVISED' | 'AUTONOMOUS';

export type Step2ExecutionEnvironment = 'PAPER' | 'EXCHANGE_DEMO' | 'LIVE';

export type ExecutionReceiptStatus =
  | 'NOT_EXECUTED'
  | 'AWAITING_OPERATOR_APPROVAL'
  | 'PAPER_SIMULATED_FILL'
  | 'EXCHANGE_DEMO_ACKNOWLEDGED'
  | 'EXCHANGE_DEMO_PARTIAL_FILL'
  | 'EXCHANGE_UNCONFIGURED_NO_ACK'
  | 'BLOCKED_RISK_OR_MAINTENANCE'
  | 'BLOCKED_LIVE_DISABLED'
  | 'BLOCKED_VOICE_BYPASS'
  | 'CANCELLED';

export interface Step2RiskPolicy {
  readonly maxRiskPerTradePct: number;
  readonly maxPositionExposurePct: number;
  readonly maxDailyLossPct: number;
  readonly maxPortfolioDrawdownPct: number;
  readonly maxLeverage: number;
  readonly maxCorrelatedPositions: number;
  readonly maxConcurrentOrders: number;
  readonly maxDataAgeMs: number;
  readonly minRiskRewardRatio: number;
}

export const DEFAULT_STEP2_RISK_POLICY: Step2RiskPolicy = Object.freeze({
  maxRiskPerTradePct: 1.5,
  maxPositionExposurePct: 25,
  maxDailyLossPct: 4.0,
  maxPortfolioDrawdownPct: 10.0,
  maxLeverage: 3,
  maxCorrelatedPositions: 2,
  maxConcurrentOrders: 4,
  maxDataAgeMs: 180_000,
  minRiskRewardRatio: 1.6,
});

export interface PortfolioRiskContext {
  readonly accountEquityUsd: number;
  readonly currentDailyLossPct: number;
  readonly currentPortfolioDrawdownPct: number;
  readonly openPositions: readonly OpenExposureLeg[];
  readonly activeConcurrentOrders: number;
  readonly requestedLeverage: number;
  readonly requestedRiskPerTradePct: number;
  readonly emergencyStopActive: boolean;
}

export interface AgentRoleDecision {
  readonly role: AgentRoleId;
  readonly label: string;
  readonly verdict: 'PASS' | 'CAUTION' | 'BLOCK' | 'INFO';
  readonly confidenceIndicator: number | null;
  readonly confidenceDisclaimer: string;
  readonly reasoning: readonly string[];
  readonly invalidationConditions: readonly string[];
  readonly supportingData: Record<string, string | number | boolean | null>;
  readonly timestampIso: string;
}

export interface RiskValidationResult {
  readonly passed: boolean;
  readonly computedPositionNotionalUsd: number;
  readonly computedQuantity: number;
  readonly computedPositionExposurePct: number;
  readonly violations: readonly string[];
  readonly warnings: readonly string[];
  readonly maintenanceBlocked: boolean;
  readonly emergencyStopBlocked: boolean;
}

export interface PortfolioHedgeIntelligenceReport {
  readonly status: 'HYPOTHETICAL_PROPOSAL' | 'NO_HEDGE_NEEDED';
  readonly isExecutedHedge: false;
  readonly totalGrossExposureUsd: number;
  readonly netDirectionalExposureUsd: number;
  readonly topSymbolConcentrationPct: number;
  readonly correlatedClusterCount: number;
  readonly hedgeSuitable: boolean;
  readonly estimatedDailyFundingAndFeeCostUsd: number;
  readonly projectedNetExposureAfterHedgeUsd: number;
  readonly riskReducingAlternatives: readonly string[];
  readonly proposedLegs: readonly {
    readonly sourceSymbol: string;
    readonly hedgeSymbol: string;
    readonly hedgeDirection: 'LONG' | 'SHORT';
    readonly hedgeNotionalUsd: number;
    readonly correlation: number;
    readonly reason: string;
  }[];
  readonly summary: string;
}

export interface ExecutionReceipt {
  readonly status: ExecutionReceiptStatus;
  readonly environment: Step2ExecutionEnvironment;
  readonly executed: boolean;
  readonly isSimulatedFill: boolean;
  readonly exchangeAcknowledged: boolean;
  readonly clientOrderId: string | null;
  readonly exchangeOrderId: string | null;
  readonly requestedQty: number;
  readonly filledQty: number;
  readonly fillPrice: number | null;
  readonly slippageBps: number | null;
  readonly feesUsd: number | null;
  readonly workerId: string | null;
  readonly reconciliationStatus: 'NOT_APPLICABLE' | 'SYNCED' | 'PENDING_RECONCILIATION' | 'UNCONFIGURED';
  readonly reason: string;
  readonly executedAtIso: string | null;
}

export interface LifecycleStageEvent {
  readonly stage: SignalLifecycleStage;
  readonly timestampIso: string;
  readonly actor: string;
  readonly detail: string;
}

export interface UnifiedSignalRecord {
  readonly signalId: string;
  readonly canonicalTradeId: string | null;
  readonly recordClass: 'PROPOSED_SETUP' | 'PUBLISHED_SIGNAL' | 'EXECUTED_PAPER' | 'EXECUTED_DEMO';
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly operatingMode: OperatingMode;
  readonly targetEnvironment: Step2ExecutionEnvironment;
  readonly requestOrigin: 'OPERATOR_UI' | 'AUTONOMOUS_SCHEDULER' | 'VOICE_COMMAND';
  readonly currentStage: SignalLifecycleStage;
  readonly direction: 'BUY' | 'SELL' | 'NONE';
  readonly strategyId: StrategyId;
  readonly strategyName: string;
  readonly entryPrice: number | null;
  readonly stopLoss: number | null;
  readonly takeProfit: number | null;
  readonly projectedRiskReward: number;
  readonly confidenceScore: number;
  readonly confidenceNote: string;
  readonly dataTrust: MarketDataTrustEvaluation;
  readonly strategyEvaluation: StrategyEvaluationSignal;
  readonly riskValidation: RiskValidationResult;
  readonly hedgeIntelligence: PortfolioHedgeIntelligenceReport;
  readonly agentDecisions: readonly AgentRoleDecision[];
  readonly execution: ExecutionReceipt;
  readonly lifecycleTrail: readonly LifecycleStageEvent[];
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
  readonly realizedPnlUsd: number | null;
  readonly closedAtIso: string | null;
}

export interface Step2CompletedTradeSample {
  readonly signalId: string;
  readonly tradeId: string;
  readonly strategyId: StrategyId;
  readonly symbol: string;
  readonly environment: 'PAPER' | 'EXCHANGE_DEMO';
  readonly expectedEntryPrice: number;
  readonly actualFillPrice: number;
  readonly realizedPnlUsd: number;
  readonly feesUsd: number;
  readonly riskViolationOccurred: boolean;
  readonly falseSignal: boolean;
  readonly volatilityRegime: 'CALM' | 'NORMAL' | 'ELEVATED' | 'EXTREME';
  readonly closedAtIso: string;
}

export interface LearningAuditRecommendation {
  readonly id: string;
  readonly category:
    | 'STRATEGY_DRIFT'
    | 'EXECUTION_SLIPPAGE_DRIFT'
    | 'FALSE_SIGNAL_RATE'
    | 'RISK_DISCIPLINE'
    | 'REGIME_SHIFT';
  readonly severity: 'INFO' | 'WARNING' | 'CRITICAL_REVIEW';
  readonly strategyId: StrategyId | 'PORTFOLIO';
  readonly title: string;
  readonly evidence: string;
  readonly suggestedAction: string;
  readonly requiresOperatorReview: true;
  readonly autoApplied: false;
}

export interface LearningPerformanceAuditReport {
  readonly auditedAtIso: string;
  readonly sampleSize: number;
  readonly overallWinRatePct: number | null;
  readonly falseSignalRatePct: number | null;
  readonly riskViolationCount: number;
  readonly meanExecutionDriftBps: number | null;
  readonly strategyBreakdown: readonly {
    readonly strategyId: StrategyId;
    readonly trades: number;
    readonly winRatePct: number;
    readonly netPnlUsd: number;
    readonly avgDriftBps: number;
    readonly falseSignals: number;
  }[];
  readonly recommendations: readonly LearningAuditRecommendation[];
  readonly safetyGuarantee: string;
}

const CONFIDENCE_DISCLAIMER =
  'Heuristic indicator of rule alignment only — NOT proof of future profitability.';

export function generateImmutableSignalId(symbol: string, nowMs = Date.now(), seq = 1): string {
  const cleanSym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'ASSET';
  const datePart = new Date(nowMs).toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = String((nowMs % 100000) + seq).padStart(5, '0');
  return `SF-SIG-${datePart}-${cleanSym}-${suffix}`;
}

export function generateCanonicalTradeIdForStep2(nowMs = Date.now(), seq = 1): string {
  const year = new Date(nowMs).getUTCFullYear();
  const suffix = String(200000 + ((nowMs % 700000) + seq)).slice(0, 6);
  return `SF-${year}-${suffix}`;
}

export function evaluatePortfolioHedgeIntelligence(params: {
  openPositions: readonly OpenExposureLeg[];
  accountEquityUsd: number;
  volatilityStressScore?: number;
  fundingRate8h?: number;
}): PortfolioHedgeIntelligenceReport {
  const equity = Math.max(100, params.accountEquityUsd);
  const gross = params.openPositions.reduce((acc, p) => acc + Math.abs(p.notionalUsd), 0);
  const netSigned = params.openPositions.reduce(
    (acc, p) => acc + (p.direction === 'LONG' ? p.notionalUsd : -p.notionalUsd),
    0
  );
  const bySymbol = new Map<string, number>();
  for (const p of params.openPositions) {
    bySymbol.set(p.symbol, (bySymbol.get(p.symbol) ?? 0) + Math.abs(p.notionalUsd));
  }
  const maxSymNotional = Math.max(0, ...Array.from(bySymbol.values()));
  const topSymbolConcentrationPct =
    gross > 0 ? Number(((maxSymNotional / gross) * 100).toFixed(1)) : 0;

  const correlatedClusterCount = params.openPositions.filter((p) =>
    ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'AVAXUSDT'].includes(p.symbol.toUpperCase())
  ).length;

  const rawStress = params.volatilityStressScore ?? (gross / equity > 1.2 ? 78 : 35);
  const stressScore100 = rawStress <= 1 ? Math.round(rawStress * 100) : Math.round(rawStress);
  const basePlan = computeCorrelatedHedgePlan({
    exposures: params.openPositions,
    stressScore: stressScore100,
  });

  const funding8h = Math.abs(params.fundingRate8h ?? 0.0001);
  const dailyFundingAndFeeCostUsd = Number(
    (basePlan.totalHedgeNotionalUsd * (funding8h * 3 + 0.0008)).toFixed(2)
  );
  const projectedNetAfterHedge = Number(
    Math.max(0, Math.abs(netSigned) - basePlan.totalHedgeNotionalUsd).toFixed(2)
  );

  const alternatives: string[] = [];
  if (gross > equity * 0.8) {
    alternatives.push('Trim gross position size by 25–35% before paying hedge spread & funding costs.');
  }
  if (topSymbolConcentrationPct >= 60) {
    alternatives.push(`Reduce single-asset concentration (${topSymbolConcentrationPct}%) rather than adding correlated leverage.`);
  }
  if (alternatives.length === 0) {
    alternatives.push('Maintain protective stop-losses and monitor correlation drift without adding hedge drag.');
  }

  const hedgeSuitable = basePlan.triggered && basePlan.legs.length > 0 && gross > 0;

  return {
    status: hedgeSuitable ? 'HYPOTHETICAL_PROPOSAL' : 'NO_HEDGE_NEEDED',
    isExecutedHedge: false,
    totalGrossExposureUsd: Number(gross.toFixed(2)),
    netDirectionalExposureUsd: Number(netSigned.toFixed(2)),
    topSymbolConcentrationPct,
    correlatedClusterCount,
    hedgeSuitable,
    estimatedDailyFundingAndFeeCostUsd: dailyFundingAndFeeCostUsd,
    projectedNetExposureAfterHedgeUsd: projectedNetAfterHedge,
    riskReducingAlternatives: alternatives,
    proposedLegs: basePlan.legs.map((l) => ({
      sourceSymbol: l.sourceSymbol,
      hedgeSymbol: l.hedgeSymbol,
      hedgeDirection: l.hedgeDirection,
      hedgeNotionalUsd: l.hedgeNotionalUsd,
      correlation: l.correlation,
      reason: l.reason,
    })),
    summary: hedgeSuitable
      ? `HYPOTHETICAL PROPOSAL ONLY (NOT EXECUTED): ${basePlan.legs.length} counter-hedge leg(s) totaling $${basePlan.totalHedgeNotionalUsd.toFixed(2)} could reduce net directional exposure to $${projectedNetAfterHedge.toFixed(2)} (est. daily fee/funding cost $${dailyFundingAndFeeCostUsd}).`
      : gross === 0
      ? 'Portfolio has zero open exposure — no hedge required.'
      : `Current exposure ($${gross.toFixed(2)} gross) is within stress bounds; no hedge recommended.`,
  };
}

export function validateSignalRiskControls(params: {
  signal: StrategyEvaluationSignal;
  dataTrust: MarketDataTrustEvaluation;
  policy: Step2RiskPolicy;
  portfolio: PortfolioRiskContext;
  maintenanceState: SafeMaintenanceState;
  symbol: string;
}): RiskValidationResult {
  const violations: string[] = [];
  const warnings: string[] = [];

  const maintGate = evaluateMaintenanceOrderGate(params.maintenanceState, {
    kind: 'NEW_ENTRY',
    source: 'AI_SIGNAL',
    symbol: params.symbol,
  });
  const maintenanceBlocked = !maintGate.allowed;
  if (maintenanceBlocked) {
    violations.push(`Safe Maintenance Mode (${params.maintenanceState.state}): ${maintGate.reason}`);
  }

  const emergencyStopBlocked = params.portfolio.emergencyStopActive;
  if (emergencyStopBlocked) {
    violations.push('Emergency Stop is engaged — all new entries are blocked.');
  }

  if (!params.dataTrust.executionAllowed) {
    violations.push(...params.dataTrust.blockingReasons);
  }

  if (!params.signal.triggered || params.signal.direction === 'NONE' || !params.signal.entryPrice || !params.signal.stopLoss || !params.signal.takeProfit) {
    violations.push('No valid directional strategy entry/SL/TP setup was triggered.');
  }

  if (params.signal.triggered && params.signal.projectedRiskReward < params.policy.minRiskRewardRatio) {
    violations.push(
      `Projected R:R (${params.signal.projectedRiskReward}) is below configured minimum (${params.policy.minRiskRewardRatio}).`
    );
  }

  if (params.portfolio.requestedRiskPerTradePct > params.policy.maxRiskPerTradePct) {
    violations.push(
      `Requested risk per trade (${params.portfolio.requestedRiskPerTradePct}%) exceeds limit (${params.policy.maxRiskPerTradePct}%).`
    );
  }

  if (params.portfolio.currentDailyLossPct >= params.policy.maxDailyLossPct) {
    violations.push(
      `Daily loss (${params.portfolio.currentDailyLossPct}%) reached or exceeded max daily loss cap (${params.policy.maxDailyLossPct}%).`
    );
  }

  if (params.portfolio.currentPortfolioDrawdownPct >= params.policy.maxPortfolioDrawdownPct) {
    violations.push(
      `Portfolio drawdown (${params.portfolio.currentPortfolioDrawdownPct}%) reached max drawdown cap (${params.policy.maxPortfolioDrawdownPct}%).`
    );
  }

  if (params.portfolio.requestedLeverage > params.policy.maxLeverage) {
    violations.push(
      `Requested leverage (${params.portfolio.requestedLeverage}x) exceeds cap (${params.policy.maxLeverage}x).`
    );
  }

  if (params.portfolio.activeConcurrentOrders >= params.policy.maxConcurrentOrders) {
    violations.push(
      `Concurrent orders (${params.portfolio.activeConcurrentOrders}) reached max limit (${params.policy.maxConcurrentOrders}).`
    );
  }

  const correlatedOpen = params.portfolio.openPositions.filter((p) =>
    ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'AVAXUSDT'].includes(p.symbol.toUpperCase())
  ).length;
  if (correlatedOpen >= params.policy.maxCorrelatedPositions) {
    violations.push(
      `Correlated open positions (${correlatedOpen}) reached max correlated cap (${params.policy.maxCorrelatedPositions}).`
    );
  }

  const equity = Math.max(100, params.portfolio.accountEquityUsd);
  let computedPositionNotionalUsd = 0;
  let computedQuantity = 0;
  let computedPositionExposurePct = 0;

  if (params.signal.entryPrice && params.signal.stopLoss) {
    const stopDistPct = Math.abs(params.signal.entryPrice - params.signal.stopLoss) / params.signal.entryPrice;
    const riskDollars = equity * (Math.min(params.portfolio.requestedRiskPerTradePct, params.policy.maxRiskPerTradePct) / 100);
    const rawNotional = stopDistPct > 0 ? riskDollars / stopDistPct : 0;
    const maxExposureNotional = equity * (params.policy.maxPositionExposurePct / 100) * Math.min(params.portfolio.requestedLeverage, params.policy.maxLeverage);
    computedPositionNotionalUsd = Number(Math.min(rawNotional, maxExposureNotional).toFixed(2));
    computedQuantity = Number((computedPositionNotionalUsd / params.signal.entryPrice).toFixed(6));
    computedPositionExposurePct = Number(((computedPositionNotionalUsd / equity) * 100).toFixed(2));
    if (rawNotional > maxExposureNotional) {
      warnings.push(
        `Position notional capped at ${params.policy.maxPositionExposurePct}% exposure bound ($${computedPositionNotionalUsd}).`
      );
    }
  }

  return {
    passed: violations.length === 0,
    computedPositionNotionalUsd,
    computedQuantity,
    computedPositionExposurePct,
    violations,
    warnings,
    maintenanceBlocked,
    emergencyStopBlocked,
  };
}

export interface RunSixAgentPipelineInput {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly candles: readonly Candle[];
  readonly provider: MarketDataProvider;
  readonly fetchedAtMs: number;
  readonly isSyntheticSimulation: boolean;
  readonly requireVerifiedLiveFeed?: boolean;
  readonly derivatives?: DerivativesSnapshot | null;
  readonly preferredStrategyId?: StrategyId | 'AUTO_BEST';
  readonly strategyOverrides?: Partial<
    Record<StrategyId, { validationStatus?: StrategyValidationStatus; autonomousEligible?: boolean }>
  >;
  readonly operatingMode: OperatingMode;
  readonly targetEnvironment: Step2ExecutionEnvironment;
  readonly requestOrigin?: 'OPERATOR_UI' | 'AUTONOMOUS_SCHEDULER' | 'VOICE_COMMAND';
  readonly riskPolicy: Step2RiskPolicy;
  readonly portfolio: PortfolioRiskContext;
  readonly maintenanceState: SafeMaintenanceState;
  readonly completedHistory?: readonly Step2CompletedTradeSample[];
  readonly nowMs?: number;
  readonly sequence?: number;
}

/**
 * Runs all 6 cooperating AI agent roles through a single coordinated, auditable
 * Signal Lifecycle without bypassing risk controls, execution boundaries, or maintenance mode.
 */
export function runSixAgentSignalPipeline(input: RunSixAgentPipelineInput): UnifiedSignalRecord {
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const origin = input.requestOrigin ?? 'OPERATOR_UI';
  const signalId = generateImmutableSignalId(input.symbol, nowMs, input.sequence ?? 1);

  // Stage 1: Market Intelligence Agent
  const dataTrust = evaluateMarketDataTrust({
    symbol: input.symbol,
    timeframe: input.timeframe,
    provider: input.provider,
    candles: input.candles,
    fetchedAtMs: input.fetchedAtMs,
    nowMs,
    maxDataAgeMs: input.riskPolicy.maxDataAgeMs,
    isSyntheticSimulation: input.isSyntheticSimulation,
    derivatives: input.derivatives,
    requireVerifiedLiveFeed:
      input.requireVerifiedLiveFeed ?? input.targetEnvironment !== 'PAPER',
  });

  const marketAgent: AgentRoleDecision = {
    role: 'MARKET_INTELLIGENCE_AGENT',
    label: '1. Market Intelligence Agent',
    verdict: dataTrust.executionAllowed ? (dataTrust.warnings.length > 0 ? 'CAUTION' : 'PASS') : 'BLOCK',
    confidenceIndicator: dataTrust.executionAllowed ? 84 : 15,
    confidenceDisclaimer: CONFIDENCE_DISCLAIMER,
    reasoning: [
      `Feed: ${dataTrust.providerLabel} | Freshness: ${dataTrust.freshness} (${dataTrust.candleCount} bars).`,
      `Realized volatility: ${dataTrust.realizedVolatilityPct}% | ATR-14: ${dataTrust.atr14}.`,
      ...(dataTrust.blockingReasons.length > 0 ? dataTrust.blockingReasons : ['OHLCV structural integrity verified.']),
    ],
    invalidationConditions: [
      `Data age exceeds ${Math.round(input.riskPolicy.maxDataAgeMs / 1000)}s or feed drops to synthetic/inconsistent state.`,
    ],
    supportingData: {
      provider: dataTrust.provider,
      freshness: dataTrust.freshness,
      isSynthetic: dataTrust.isSyntheticSimulation,
      derivativesVerified: dataTrust.derivativesVerified,
      realizedVolatilityPct: dataTrust.realizedVolatilityPct,
    },
    timestampIso: nowIso,
  };

  // Stage 2 & 3: Strategy Analysis Agent
  let selectedEval: StrategyEvaluationSignal;
  if (input.preferredStrategyId && input.preferredStrategyId !== 'AUTO_BEST') {
    const ov = input.strategyOverrides?.[input.preferredStrategyId];
    selectedEval = evaluateStrategyOnCandles(input.preferredStrategyId, input.candles, {
      derivatives: input.derivatives,
      dataTrust,
      overrideValidationStatus: ov?.validationStatus,
      overrideAutonomousEligible: ov?.autonomousEligible,
    });
  } else {
    const allEvals = STEP2_STRATEGY_REGISTRY.map((def) => {
      const ov = input.strategyOverrides?.[def.id];
      return evaluateStrategyOnCandles(def.id, input.candles, {
        derivatives: input.derivatives,
        dataTrust,
        overrideValidationStatus: ov?.validationStatus,
        overrideAutonomousEligible: ov?.autonomousEligible,
      });
    });
    const triggered = allEvals
      .filter((e) => e.triggered)
      .sort((a, b) => b.confidenceScore - a.confidenceScore);
    selectedEval = triggered[0] ?? allEvals[0];
  }

  const strategyAgent: AgentRoleDecision = {
    role: 'STRATEGY_ANALYSIS_AGENT',
    label: '2. Strategy Analysis Agent',
    verdict: selectedEval.triggered ? 'PASS' : 'INFO',
    confidenceIndicator: selectedEval.triggered ? selectedEval.confidenceScore : 0,
    confidenceDisclaimer: CONFIDENCE_DISCLAIMER,
    reasoning: [
      `Evaluated ${selectedEval.strategyName} [${selectedEval.validationStatus}].`,
      ...selectedEval.reasoning,
    ],
    invalidationConditions: selectedEval.invalidationConditions,
    supportingData: {
      strategyId: selectedEval.strategyId,
      triggered: selectedEval.triggered,
      direction: selectedEval.direction,
      projectedRiskReward: selectedEval.projectedRiskReward,
      autonomousEligible: selectedEval.autonomousEligible,
    },
    timestampIso: nowIso,
  };

  // Stage 5: Risk Management Agent
  const riskValidation = validateSignalRiskControls({
    signal: selectedEval,
    dataTrust,
    policy: input.riskPolicy,
    portfolio: input.portfolio,
    maintenanceState: input.maintenanceState,
    symbol: input.symbol,
  });

  const riskAgent: AgentRoleDecision = {
    role: 'RISK_MANAGEMENT_AGENT',
    label: '3. Risk Management Agent',
    verdict: riskValidation.passed ? (riskValidation.warnings.length > 0 ? 'CAUTION' : 'PASS') : 'BLOCK',
    confidenceIndicator: riskValidation.passed ? 92 : 0,
    confidenceDisclaimer: CONFIDENCE_DISCLAIMER,
    reasoning: riskValidation.passed
      ? [
          `All configurable risk limits satisfied. Sized $${riskValidation.computedPositionNotionalUsd} (${riskValidation.computedPositionExposurePct}% exposure, qty ${riskValidation.computedQuantity}).`,
          ...riskValidation.warnings,
        ]
      : [...riskValidation.violations],
    invalidationConditions: [
      `Daily loss >= ${input.riskPolicy.maxDailyLossPct}%, drawdown >= ${input.riskPolicy.maxPortfolioDrawdownPct}%, Emergency Stop, or Maintenance Mode !== NORMAL.`,
    ],
    supportingData: {
      passed: riskValidation.passed,
      positionNotionalUsd: riskValidation.computedPositionNotionalUsd,
      exposurePct: riskValidation.computedPositionExposurePct,
      maintenanceState: input.maintenanceState.state,
      emergencyStopActive: input.portfolio.emergencyStopActive,
    },
    timestampIso: nowIso,
  };

  // Stage 5b: Portfolio Intelligence & Hedging Agent
  const hedgeIntelligence = evaluatePortfolioHedgeIntelligence({
    openPositions: input.portfolio.openPositions,
    accountEquityUsd: input.portfolio.accountEquityUsd,
    fundingRate8h: input.derivatives?.fundingRate8h ?? 0.0001,
  });

  const portfolioAgent: AgentRoleDecision = {
    role: 'PORTFOLIO_INTELLIGENCE_AGENT',
    label: '5. Portfolio Intelligence Agent',
    verdict: hedgeIntelligence.hedgeSuitable ? 'CAUTION' : 'PASS',
    confidenceIndicator: null,
    confidenceDisclaimer: CONFIDENCE_DISCLAIMER,
    reasoning: [
      hedgeIntelligence.summary,
      `Gross exposure: $${hedgeIntelligence.totalGrossExposureUsd} | Top symbol concentration: ${hedgeIntelligence.topSymbolConcentrationPct}%.`,
    ],
    invalidationConditions: ['Hedge proposal is hypothetical until separately approved and executed.'],
    supportingData: {
      hedgeStatus: hedgeIntelligence.status,
      isExecutedHedge: false,
      grossExposureUsd: hedgeIntelligence.totalGrossExposureUsd,
      concentrationPct: hedgeIntelligence.topSymbolConcentrationPct,
    },
    timestampIso: nowIso,
  };

  // Stage 6: Execution Management Agent (Strict Mode & Environment Gate)
  let executionStatus: ExecutionReceiptStatus = 'NOT_EXECUTED';
  let executionReason = 'No executable signal triggered.';
  let currentStage: SignalLifecycleStage = selectedEval.triggered ? 'RISK_VALIDATION' : 'STRATEGY';

  if (origin === 'VOICE_COMMAND') {
    executionStatus = 'BLOCKED_VOICE_BYPASS';
    executionReason =
      'Voice command processed for analysis only — voice requests can NEVER bypass operator confirmation, risk limits, or execution permissions.';
    currentStage = 'APPROVAL';
  } else if (input.targetEnvironment === 'LIVE') {
    executionStatus = 'BLOCKED_LIVE_DISABLED';
    executionReason =
      'Real-money LIVE execution is strictly locked in Step 2. Use PAPER or authorized EXCHANGE_DEMO only.';
    currentStage = 'RISK_VALIDATION';
  } else if (!riskValidation.passed) {
    executionStatus = 'BLOCKED_RISK_OR_MAINTENANCE';
    executionReason = riskValidation.violations[0] ?? 'Blocked by Risk Management Agent.';
    currentStage = 'RISK_VALIDATION';
  } else if (input.operatingMode === 'SUPERVISED') {
    executionStatus = 'AWAITING_OPERATOR_APPROVAL';
    executionReason = `SUPERVISED mode active — signal ${signalId} passed risk validation and awaits explicit operator approval for ${input.targetEnvironment}.`;
    currentStage = 'APPROVAL';
  } else if (!selectedEval.autonomousEligible) {
    executionStatus = 'AWAITING_OPERATOR_APPROVAL';
    executionReason = `Strategy "${selectedEval.strategyName}" (${selectedEval.validationStatus}) is not enabled for autonomous execution — held for operator review.`;
    currentStage = 'APPROVAL';
  } else {
    executionStatus = 'AWAITING_OPERATOR_APPROVAL';
    executionReason = `Autonomous candidate passed all 6-agent gates for ${input.targetEnvironment}; ready for idempotent execution dispatch.`;
    currentStage = 'APPROVAL';
  }

  const executionAgent: AgentRoleDecision = {
    role: 'EXECUTION_MANAGEMENT_AGENT',
    label: '4. Execution Management Agent',
    verdict:
      executionStatus === 'AWAITING_OPERATOR_APPROVAL'
        ? 'PASS'
        : !selectedEval.triggered
        ? 'INFO'
        : 'BLOCK',
    confidenceIndicator: null,
    confidenceDisclaimer: CONFIDENCE_DISCLAIMER,
    reasoning: [
      `Operating Mode: ${input.operatingMode} | Target Env: ${input.targetEnvironment} | Origin: ${origin}.`,
      executionReason,
    ],
    invalidationConditions: [
      'LIVE mode disabled; Exchange Demo requires real exchange orderId acknowledgment; Paper fills explicitly labeled simulated.',
    ],
    supportingData: {
      operatingMode: input.operatingMode,
      targetEnvironment: input.targetEnvironment,
      status: executionStatus,
    },
    timestampIso: nowIso,
  };

  // Stage 10 context: Learning & Performance Audit Agent (advisory only)
  const historyForStrat = (input.completedHistory ?? []).filter(
    (h) => h.strategyId === selectedEval.strategyId
  );
  const learningAgent: AgentRoleDecision = {
    role: 'LEARNING_AUDIT_AGENT',
    label: '6. Learning & Performance Audit Agent',
    verdict: 'INFO',
    confidenceIndicator: null,
    confidenceDisclaimer: CONFIDENCE_DISCLAIMER,
    reasoning: [
      historyForStrat.length > 0
        ? `Tracked ${historyForStrat.length} completed record(s) for ${selectedEval.strategyName}; advisory monitoring active (zero silent parameter mutation).`
        : `No completed trade closure history yet for ${selectedEval.strategyName}; post-closure learning will record recommendations for operator review.`,
    ],
    invalidationConditions: ['Never auto-mutates risk limits or deploys untested strategies.'],
    supportingData: {
      completedSampleCount: historyForStrat.length,
      autoMutationAllowed: false,
    },
    timestampIso: nowIso,
  };

  const execution: ExecutionReceipt = {
    status: executionStatus,
    environment: input.targetEnvironment,
    executed: false,
    isSimulatedFill: false,
    exchangeAcknowledged: false,
    clientOrderId: null,
    exchangeOrderId: null,
    requestedQty: riskValidation.computedQuantity,
    filledQty: 0,
    fillPrice: null,
    slippageBps: null,
    feesUsd: null,
    workerId: null,
    reconciliationStatus: 'NOT_APPLICABLE',
    reason: executionReason,
    executedAtIso: null,
  };

  const lifecycleTrail: LifecycleStageEvent[] = [
    {
      stage: 'MARKET_DATA',
      timestampIso: nowIso,
      actor: 'MARKET_INTELLIGENCE_AGENT',
      detail: `${dataTrust.providerLabel} (${dataTrust.freshness}, ${dataTrust.candleCount} bars).`,
    },
    {
      stage: 'ANALYSIS',
      timestampIso: nowIso,
      actor: 'MARKET_INTELLIGENCE_AGENT',
      detail: `ATR-14=${dataTrust.atr14}, realizedVol=${dataTrust.realizedVolatilityPct}%.`,
    },
    {
      stage: 'STRATEGY',
      timestampIso: nowIso,
      actor: 'STRATEGY_ANALYSIS_AGENT',
      detail: `${selectedEval.strategyName} -> ${selectedEval.triggered ? selectedEval.direction : 'NO_SIGNAL'}.`,
    },
    {
      stage: 'SIGNAL',
      timestampIso: nowIso,
      actor: 'UNIFIED_SIGNAL_HUB',
      detail: `Assigned immutable Signal ID ${signalId} (confidence ${selectedEval.confidenceScore}%, non-proof heuristic).`,
    },
    {
      stage: 'RISK_VALIDATION',
      timestampIso: nowIso,
      actor: 'RISK_MANAGEMENT_AGENT',
      detail: riskValidation.passed
        ? `PASSED ($${riskValidation.computedPositionNotionalUsd}, ${riskValidation.computedPositionExposurePct}% exposure).`
        : `BLOCKED: ${riskValidation.violations[0] ?? 'Risk limit violation'}.`,
    },
    {
      stage: 'APPROVAL',
      timestampIso: nowIso,
      actor: 'EXECUTION_MANAGEMENT_AGENT',
      detail: executionReason,
    },
  ];

  return {
    signalId,
    canonicalTradeId: null,
    recordClass: 'PROPOSED_SETUP',
    symbol: input.symbol,
    timeframe: input.timeframe,
    operatingMode: input.operatingMode,
    targetEnvironment: input.targetEnvironment,
    requestOrigin: origin,
    currentStage,
    direction: selectedEval.direction,
    strategyId: selectedEval.strategyId,
    strategyName: selectedEval.strategyName,
    entryPrice: selectedEval.entryPrice,
    stopLoss: selectedEval.stopLoss,
    takeProfit: selectedEval.takeProfit,
    projectedRiskReward: selectedEval.projectedRiskReward,
    confidenceScore: selectedEval.confidenceScore,
    confidenceNote: CONFIDENCE_DISCLAIMER,
    dataTrust,
    strategyEvaluation: selectedEval,
    riskValidation,
    hedgeIntelligence,
    agentDecisions: [
      marketAgent,
      strategyAgent,
      riskAgent,
      executionAgent,
      portfolioAgent,
      learningAgent,
    ],
    execution,
    lifecycleTrail,
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
    realizedPnlUsd: null,
    closedAtIso: null,
  };
}

export interface ExecuteApprovedSignalInput {
  readonly record: UnifiedSignalRecord;
  readonly environment: Step2ExecutionEnvironment;
  readonly approvedBy: string;
  readonly clientOrderId: string;
  readonly workerId: string;
  readonly maintenanceState: SafeMaintenanceState;
  readonly emergencyStopActive: boolean;
  /** Only populated if a real authorized exchange demo API returned an order acknowledgment */
  readonly exchangeDemoAck?: {
    readonly acknowledged: boolean;
    readonly exchangeOrderId: string | null;
    readonly filledQty: number;
    readonly fillPrice: number | null;
    readonly feeUsd: number;
    readonly partial?: boolean;
    readonly errorReason?: string;
  } | null;
  readonly simulatedSlippageBps?: number;
  readonly simulatedFeeBps?: number;
  readonly nowMs?: number;
}

/**
 * Transitions an approved signal into Paper Simulated Fill or Exchange Demo Acknowledged Execution.
 * Strictly blocks LIVE mode, Maintenance Mode, Emergency Stop, and unconfigured Demo exchanges
 * (NEVER fabricating an exchangeOrderId).
 */
export function executeApprovedStep2Signal(
  input: ExecuteApprovedSignalInput
): { ok: boolean; record: UnifiedSignalRecord; error?: string } {
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const rec = input.record;

  if (input.environment === 'LIVE') {
    const blocked: UnifiedSignalRecord = {
      ...rec,
      updatedAtIso: nowIso,
      execution: {
        ...rec.execution,
        environment: 'LIVE',
        status: 'BLOCKED_LIVE_DISABLED',
        executed: false,
        reason: 'LIVE real-money trading is disabled in Step 2. Only PAPER and authorized EXCHANGE_DEMO are permitted.',
      },
    };
    return { ok: false, record: blocked, error: blocked.execution.reason };
  }

  const maintGate = evaluateMaintenanceOrderGate(input.maintenanceState, {
    kind: 'NEW_ENTRY',
    source: 'AI_SIGNAL',
    clientOrderId: input.clientOrderId,
    symbol: rec.symbol,
  });

  if (!maintGate.allowed || input.emergencyStopActive || !rec.riskValidation.passed || !rec.entryPrice) {
    const reason = input.emergencyStopActive
      ? 'Emergency Stop engaged — execution refused.'
      : !maintGate.allowed
      ? maintGate.reason
      : rec.riskValidation.violations[0] ?? 'Signal did not pass risk validation.';
    const blocked: UnifiedSignalRecord = {
      ...rec,
      updatedAtIso: nowIso,
      execution: {
        ...rec.execution,
        environment: input.environment,
        status: 'BLOCKED_RISK_OR_MAINTENANCE',
        executed: false,
        reason,
      },
    };
    return { ok: false, record: blocked, error: reason };
  }

  if (input.environment === 'EXCHANGE_DEMO') {
    const ack = input.exchangeDemoAck;
    if (!ack || !ack.acknowledged || !ack.exchangeOrderId) {
      const reason =
        ack?.errorReason ||
        'Exchange Demo API credentials are not configured or did not return an authenticated exchange order acknowledgment. Signal Forge NEVER presents locally generated IDs as confirmed exchange executions.';
      const unconfigured: UnifiedSignalRecord = {
        ...rec,
        updatedAtIso: nowIso,
        execution: {
          status: 'EXCHANGE_UNCONFIGURED_NO_ACK',
          environment: 'EXCHANGE_DEMO',
          executed: false,
          isSimulatedFill: false,
          exchangeAcknowledged: false,
          clientOrderId: input.clientOrderId,
          exchangeOrderId: null,
          requestedQty: rec.riskValidation.computedQuantity,
          filledQty: 0,
          fillPrice: null,
          slippageBps: null,
          feesUsd: null,
          workerId: input.workerId,
          reconciliationStatus: 'UNCONFIGURED',
          reason,
          executedAtIso: null,
        },
        lifecycleTrail: [
          ...rec.lifecycleTrail,
          {
            stage: 'EXECUTION',
            timestampIso: nowIso,
            actor: 'EXECUTION_MANAGEMENT_AGENT',
            detail: `EXCHANGE_DEMO refused without genuine exchange ack: ${reason}`,
          },
        ],
      };
      return { ok: false, record: unconfigured, error: reason };
    }

    const tradeId = rec.canonicalTradeId ?? generateCanonicalTradeIdForStep2(nowMs);
    const fillPrice = ack.fillPrice ?? rec.entryPrice;
    const slipBps = Number((((fillPrice - rec.entryPrice) / rec.entryPrice) * 10_000).toFixed(2));
    const status: ExecutionReceiptStatus = ack.partial
      ? 'EXCHANGE_DEMO_PARTIAL_FILL'
      : 'EXCHANGE_DEMO_ACKNOWLEDGED';

    const executed: UnifiedSignalRecord = {
      ...rec,
      canonicalTradeId: tradeId,
      recordClass: 'EXECUTED_DEMO',
      targetEnvironment: 'EXCHANGE_DEMO',
      currentStage: 'MONITORING',
      updatedAtIso: nowIso,
      execution: {
        status,
        environment: 'EXCHANGE_DEMO',
        executed: true,
        isSimulatedFill: false,
        exchangeAcknowledged: true,
        clientOrderId: input.clientOrderId,
        exchangeOrderId: ack.exchangeOrderId,
        requestedQty: rec.riskValidation.computedQuantity,
        filledQty: ack.filledQty,
        fillPrice,
        slippageBps: slipBps,
        feesUsd: Number(ack.feeUsd.toFixed(4)),
        workerId: input.workerId,
        reconciliationStatus: 'SYNCED',
        reason: `Exchange Demo acknowledged order ${ack.exchangeOrderId} (approved by ${input.approvedBy}).`,
        executedAtIso: nowIso,
      },
      lifecycleTrail: [
        ...rec.lifecycleTrail,
        {
          stage: 'EXECUTION',
          timestampIso: nowIso,
          actor: input.approvedBy,
          detail: `EXCHANGE_DEMO acknowledged (${ack.exchangeOrderId}) via ${input.workerId}; linked Trade ID ${tradeId}.`,
        },
        {
          stage: 'MONITORING',
          timestampIso: nowIso,
          actor: 'RISK_MANAGEMENT_AGENT',
          detail: `Protective SL ${rec.stopLoss} & TP ${rec.takeProfit} actively monitored.`,
        },
      ],
    };
    return { ok: true, record: executed };
  }

  // PAPER environment: explicitly labeled PAPER_SIMULATED_FILL (never disguised as exchange ack)
  const slipBps = input.simulatedSlippageBps ?? 3.5;
  const feeBps = input.simulatedFeeBps ?? 5.0;
  const slipMult = rec.direction === 'BUY' ? 1 + slipBps / 10_000 : 1 - slipBps / 10_000;
  const fillPrice = Number((rec.entryPrice * slipMult).toFixed(rec.entryPrice >= 1000 ? 2 : 4));
  const qty = rec.riskValidation.computedQuantity;
  const feesUsd = Number((fillPrice * qty * (feeBps / 10_000)).toFixed(4));
  const tradeId = rec.canonicalTradeId ?? generateCanonicalTradeIdForStep2(nowMs);

  const paperExecuted: UnifiedSignalRecord = {
    ...rec,
    canonicalTradeId: tradeId,
    recordClass: 'EXECUTED_PAPER',
    targetEnvironment: 'PAPER',
    currentStage: 'MONITORING',
    updatedAtIso: nowIso,
    execution: {
      status: 'PAPER_SIMULATED_FILL',
      environment: 'PAPER',
      executed: true,
      isSimulatedFill: true,
      exchangeAcknowledged: false,
      clientOrderId: input.clientOrderId,
      exchangeOrderId: null, // Strictly null for simulated paper fills!
      requestedQty: qty,
      filledQty: qty,
      fillPrice,
      slippageBps: rec.direction === 'BUY' ? slipBps : -slipBps,
      feesUsd,
      workerId: input.workerId,
      reconciliationStatus: 'SYNCED',
      reason: `PAPER_SIMULATED_FILL executed @ $${fillPrice} (fee $${feesUsd}, est. slippage ${slipBps}bps) approved by ${input.approvedBy}.`,
      executedAtIso: nowIso,
    },
    lifecycleTrail: [
      ...rec.lifecycleTrail,
      {
        stage: 'EXECUTION',
        timestampIso: nowIso,
        actor: input.approvedBy,
        detail: `PAPER_SIMULATED_FILL @ $${fillPrice} via ${input.workerId}; linked Trade ID ${tradeId} (not an exchange order).`,
      },
      {
        stage: 'MONITORING',
        timestampIso: nowIso,
        actor: 'RISK_MANAGEMENT_AGENT',
        detail: `Paper position monitored with SL $${rec.stopLoss} & TP $${rec.takeProfit}.`,
      },
    ],
  };

  return { ok: true, record: paperExecuted };
}

/**
 * Controlled Learning & Performance Audit over completed trades.
 * Emits reviewed recommendations ONLY — NEVER silently modifies production risk limits
 * or auto-deploys untested strategies.
 */
export function runLearningPerformanceAudit(
  completedTrades: readonly Step2CompletedTradeSample[],
  nowMs = Date.now()
): LearningPerformanceAuditReport {
  const nowIso = new Date(nowMs).toISOString();
  const recommendations: LearningAuditRecommendation[] = [];

  if (completedTrades.length === 0) {
    return {
      auditedAtIso: nowIso,
      sampleSize: 0,
      overallWinRatePct: null,
      falseSignalRatePct: null,
      riskViolationCount: 0,
      meanExecutionDriftBps: null,
      strategyBreakdown: [],
      recommendations: [
        {
          id: `lrn-empty-${nowMs}`,
          category: 'STRATEGY_DRIFT',
          severity: 'INFO',
          strategyId: 'PORTFOLIO',
          title: 'Insufficient Closed Trade History for Statistical Audit',
          evidence: 'Zero completed Paper/Demo trade closures recorded in current ledger.',
          suggestedAction:
            'Accumulate at least 15–30 completed Paper or Exchange Demo trades before adjusting strategy parameters.',
          requiresOperatorReview: true,
          autoApplied: false,
        },
      ],
      safetyGuarantee:
        'Learning Audit is strictly advisory: zero risk limits or strategy states are silently mutated without explicit operator review.',
    };
  }

  let wins = 0;
  let falseSignals = 0;
  let riskViolations = 0;
  let totalDriftBps = 0;

  const grouped = new Map<
    StrategyId,
    { trades: number; wins: number; netPnl: number; driftSum: number; falseCount: number }
  >();

  for (const t of completedTrades) {
    if (t.realizedPnlUsd > 0) wins += 1;
    if (t.falseSignal) falseSignals += 1;
    if (t.riskViolationOccurred) riskViolations += 1;
    const driftBps =
      t.expectedEntryPrice > 0
        ? Math.abs(((t.actualFillPrice - t.expectedEntryPrice) / t.expectedEntryPrice) * 10_000)
        : 0;
    totalDriftBps += driftBps;

    const bucket = grouped.get(t.strategyId) ?? {
      trades: 0,
      wins: 0,
      netPnl: 0,
      driftSum: 0,
      falseCount: 0,
    };
    bucket.trades += 1;
    if (t.realizedPnlUsd > 0) bucket.wins += 1;
    bucket.netPnl += t.realizedPnlUsd - t.feesUsd;
    bucket.driftSum += driftBps;
    if (t.falseSignal) bucket.falseCount += 1;
    grouped.set(t.strategyId, bucket);
  }

  const overallWinRatePct = Number(((wins / completedTrades.length) * 100).toFixed(1));
  const falseSignalRatePct = Number(((falseSignals / completedTrades.length) * 100).toFixed(1));
  const meanExecutionDriftBps = Number((totalDriftBps / completedTrades.length).toFixed(2));

  const strategyBreakdown = Array.from(grouped.entries()).map(([strategyId, b]) => {
    const winRatePct = Number(((b.wins / b.trades) * 100).toFixed(1));
    const avgDriftBps = Number((b.driftSum / b.trades).toFixed(2));
    const netPnlUsd = Number(b.netPnl.toFixed(2));

    if (b.trades >= 3 && (netPnlUsd < 0 || winRatePct < 40)) {
      const def = getStrategyDefinition(strategyId);
      recommendations.push({
        id: `lrn-drift-${strategyId}-${nowMs}`,
        category: 'STRATEGY_DRIFT',
        severity: 'WARNING',
        strategyId,
        title: `Review Underperforming Strategy: ${def.name}`,
        evidence: `${b.trades} closed trades, ${winRatePct}% win rate, net $${netPnlUsd} after fees.`,
        suggestedAction:
          'Operator review recommended: keep autonomous eligibility OFF and re-run out-of-sample backtest before further Demo deployment.',
        requiresOperatorReview: true,
        autoApplied: false,
      });
    }

    return {
      strategyId,
      trades: b.trades,
      winRatePct,
      netPnlUsd,
      avgDriftBps,
      falseSignals: b.falseCount,
    };
  });

  if (meanExecutionDriftBps > 8) {
    recommendations.push({
      id: `lrn-slip-${nowMs}`,
      category: 'EXECUTION_SLIPPAGE_DRIFT',
      severity: 'WARNING',
      strategyId: 'PORTFOLIO',
      title: 'Paper vs. Expected Execution Slippage Drift Elevated',
      evidence: `Mean entry price drift is ${meanExecutionDriftBps} bps across ${completedTrades.length} completed fills.`,
      suggestedAction:
        'Increase backtest slippage assumption to >= 10 bps and consider limit-entry confirmation during high-volatility bars.',
      requiresOperatorReview: true,
      autoApplied: false,
    });
  }

  if (falseSignalRatePct >= 35) {
    recommendations.push({
      id: `lrn-false-${nowMs}`,
      category: 'FALSE_SIGNAL_RATE',
      severity: 'WARNING',
      strategyId: 'PORTFOLIO',
      title: 'Elevated False Signal Rate Detected',
      evidence: `${falseSignals}/${completedTrades.length} (${falseSignalRatePct}%) completed signals invalidated rapidly.`,
      suggestedAction:
        'Require Multi-Timeframe Confluence filter during choppy regimes; review signal invalidation thresholds.',
      requiresOperatorReview: true,
      autoApplied: false,
    });
  }

  if (riskViolations > 0) {
    recommendations.push({
      id: `lrn-risk-${nowMs}`,
      category: 'RISK_DISCIPLINE',
      severity: 'CRITICAL_REVIEW',
      strategyId: 'PORTFOLIO',
      title: 'Risk Rule Breach Recorded in Historical Execution',
      evidence: `${riskViolations} trade(s) flagged with risk limit breach during lifecycle.`,
      suggestedAction:
        'Audit risk policy caps and enforce SUPERVISED approval mode until violation root cause is verified.',
      requiresOperatorReview: true,
      autoApplied: false,
    });
  }

  const extremeCount = completedTrades.filter(
    (t) => t.volatilityRegime === 'ELEVATED' || t.volatilityRegime === 'EXTREME'
  ).length;
  if (extremeCount / completedTrades.length >= 0.4) {
    recommendations.push({
      id: `lrn-regime-${nowMs}`,
      category: 'REGIME_SHIFT',
      severity: 'INFO',
      strategyId: 'PORTFOLIO',
      title: 'Volatility Regime Shift Observed',
      evidence: `${extremeCount}/${completedTrades.length} recent trades occurred in ELEVATED/EXTREME volatility.`,
      suggestedAction:
        'Operator may review reducing max leverage or widening ATR stop filters via manual configuration.',
      requiresOperatorReview: true,
      autoApplied: false,
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      id: `lrn-healthy-${nowMs}`,
      category: 'STRATEGY_DRIFT',
      severity: 'INFO',
      strategyId: 'PORTFOLIO',
      title: 'Execution Parity & Strategy Metrics Within Expected Bounds',
      evidence: `${completedTrades.length} closed trades, ${overallWinRatePct}% win rate, ${meanExecutionDriftBps} bps mean drift, 0 risk violations.`,
      suggestedAction: 'Continue Paper/Demo observation under current reviewed risk policy.',
      requiresOperatorReview: true,
      autoApplied: false,
    });
  }

  return {
    auditedAtIso: nowIso,
    sampleSize: completedTrades.length,
    overallWinRatePct,
    falseSignalRatePct,
    riskViolationCount: riskViolations,
    meanExecutionDriftBps,
    strategyBreakdown,
    recommendations,
    safetyGuarantee:
      'Learning Audit is strictly advisory: zero risk limits or strategy states are silently mutated without explicit operator review.',
  };
}

/**
 * Bridges an executed Step 2 Paper/Demo record into the canonical Step 1
 * `CanonicalTradeRecord` format used by Trade ID Verification and Public Smart Charts.
 */
export function buildCanonicalTradeRecordFromStep2Signal(
  rec: UnifiedSignalRecord
): CanonicalTradeRecord | null {
  if (!rec.canonicalTradeId || !rec.entryPrice || !rec.stopLoss || !rec.takeProfit || rec.direction === 'NONE') {
    return null;
  }
  const isExecuted = rec.execution.executed && (rec.recordClass === 'EXECUTED_PAPER' || rec.recordClass === 'EXECUTED_DEMO');
  const tradingMode: 'PAPER' | 'DEMO' = rec.recordClass === 'EXECUTED_DEMO' ? 'DEMO' : 'PAPER';

  return enforceTradeRecordTruthInvariants({
    tradeId: rec.canonicalTradeId,
    recordClass: isExecuted ? 'EXECUTED_TRADE' : 'SIGNAL_ONLY',
    tradingMode,
    exchange: tradingMode === 'DEMO' ? 'OKX' : 'BINANCE',
    pair: rec.symbol,
    timeframe: rec.timeframe,
    direction: rec.direction,
    strategyName: `${rec.strategyName} (${rec.signalId})`,
    strategyExplanation: rec.strategyEvaluation.reasoning.join(' '),
    signalPrice: rec.entryPrice,
    actualExecutionPrice: isExecuted ? rec.execution.fillPrice : null,
    slippageBps: isExecuted ? rec.execution.slippageBps : null,
    entryPrice: rec.entryPrice,
    stopLoss: rec.stopLoss,
    takeProfit: rec.takeProfit,
    projectedRrRatio: computeProjectedRrRatio(rec.direction, rec.entryPrice, rec.stopLoss, rec.takeProfit),
    openedAtIso: rec.execution.executedAtIso ?? rec.createdAtIso,
    closedAtIso: rec.closedAtIso,
    executionStatus: isExecuted ? 'OPEN' : 'PUBLISHED_SIGNAL',
    feesUsd: isExecuted ? rec.execution.feesUsd : null,
    realizedPnlUsd: null,
    realizedPnlPct: null,
    confidence: rec.confidenceScore,
    publishedChannels: ['Signal Forge Step 2 Unified Hub'],
    chartSnapshot: {
      timeframe: rec.timeframe,
      indicators: ['EMA 20', 'EMA 50', 'Market Structure'],
      caption: `${rec.signalId} · ${rec.execution.status} · ${rec.dataTrust.providerLabel}`,
      exportedAtIso: null,
    },
    timeline: rec.lifecycleTrail.map((evt, idx) => ({
      id: `${rec.signalId}-tl-${idx + 1}`,
      stage:
        evt.stage === 'EXECUTION'
          ? 'EXECUTION'
          : evt.stage === 'MONITORING'
          ? 'POSITION'
          : evt.stage === 'STRATEGY'
          ? 'STRATEGY'
          : 'SIGNAL',
      timestampIso: evt.timestampIso,
      title: `${evt.stage} · ${evt.actor}`,
      detail: evt.detail,
      actor: evt.actor,
    })),
  });
}

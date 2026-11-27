/**
 * Strategy promotion gate: clone/optimizer output must never authorize LIVE.
 * Research forecasts are hypotheses, not measured profitability.
 */
export type StrategyStage = 'RESEARCH' | 'PAPER_CANDIDATE' | 'VALIDATION_REQUIRED' | 'OWNER_REVIEW';
export interface StrategyEvidence {
  readonly strategyId: string;
  readonly sourceKind: 'SIMULATED_PRIOR' | 'HISTORICAL_BACKTEST' | 'PAPER_TRADES';
  readonly independentOutOfSample: boolean;
  readonly evidenceWindowDays: number;
  readonly closedTrades: number;
  readonly minClosedTradesRequired: number;
  readonly maxDrawdownPct: number;
  readonly maxDrawdownLimitPct: number;
  readonly observedProfitFactor: number;
  readonly netOfFees: boolean;
  readonly slippageIncluded: boolean;
  readonly leakageCheckPassed: boolean;
  readonly reproducibleSnapshot: boolean;
  readonly activeHardHalt: boolean;
  readonly securityIncidentUnresolved: boolean;
}

export interface StrategyPromotionDecision {
  readonly stage: StrategyStage;
  readonly eligibleForPaperEvaluation: boolean;
  readonly eligibleForOwnerReview: boolean;
  readonly liveTradingApproved: false;
  readonly reasons: readonly string[];
}
export function evaluateStrategyPromotion(e: StrategyEvidence): StrategyPromotionDecision {
  const reasons: string[] = [];
  if(e.sourceKind === 'SIMULATED_PRIOR') reasons.push('Modeled optimizer projections are not observed trading performance');
  if(!e.independentOutOfSample) reasons.push('Independent out-of-sample validation missing');
  if(e.evidenceWindowDays < 30) reasons.push('Evidence window too short (minimum 30 days)');
  if(!Number.isSafeInteger(e.closedTrades) || e.closedTrades < Math.max(1,e.minClosedTradesRequired)) reasons.push('Insufficient closed trades');
  if(!Number.isFinite(e.maxDrawdownPct) || e.maxDrawdownPct < 0 || e.maxDrawdownPct > e.maxDrawdownLimitPct) reasons.push('Drawdown failed risk gate');
  if(!Number.isFinite(e.observedProfitFactor) || e.observedProfitFactor <= 1) reasons.push('Observed profit factor not positive after friction');
  if(!e.netOfFees || !e.slippageIncluded) reasons.push('Fees or slippage not included');
  if(!e.leakageCheckPassed) reasons.push('Look-ahead/data leakage validation missing');
  if(!e.reproducibleSnapshot) reasons.push('Reproducible versioned strategy snapshot missing');
  if(e.activeHardHalt || e.securityIncidentUnresolved) reasons.push('Active safety hold blocks promotion');
  const good = reasons.length===0;
  return {
    stage:good?'OWNER_REVIEW':e.sourceKind === 'SIMULATED_PRIOR'?'RESEARCH':'VALIDATION_REQUIRED',
    eligibleForPaperEvaluation:!e.activeHardHalt && !e.securityIncidentUnresolved,
    eligibleForOwnerReview:good,liveTradingApproved:false,reasons,
  };
}

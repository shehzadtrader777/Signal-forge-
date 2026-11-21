import { MIN_RR_KERNEL_CONSTANT } from './riskEngine';

export type MatrixAgentStrategyId =
  | 'AUTONOMOUS_MASTER'
  | 'SMC_1_5'
  | 'PATTERN_SCANNER'
  | 'PRE_PUMP_SUPPORT';

export type BacktestTradeHorizon = 100 | 250 | 500 | 1000;

/**
 * Decoupled execution parameter profile — completely separated from core agent signal logic.
 */
export interface ModularBacktestParams {
  riskLimitPerTradePct: number; // 0.25 .. 2.0
  atrTrailingStopMultiplier: number; // 1.0 .. 3.5
  profitToLossRatio: number; // >= 5.0 (1:5 floor preserved)
  tradeCount: BacktestTradeHorizon; // Up to 1,000 trades per profile
  executionFeeBps: number; // e.g. 6 bps round-trip
  slippageBps: number; // e.g. 4 bps
  autonomousProfitLock: boolean;
}

export interface AgentMatrixProfileResult {
  strategyId: MatrixAgentStrategyId;
  strategyLabel: string;
  tradeCount: number;
  wins: number;
  losses: number;
  winRatePct: number;
  expectancyR: number;
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdownPct: number;
  totalReturnPct: number;
  endingEquityUsd: number;
  avgHoldingBars: number;
  equitySample: Array<{ tradeIndex: number; equity: number }>;
}

export interface ComparativeSimulationMatrixReport {
  symbol: string;
  params: ModularBacktestParams;
  horizonsEvaluated: BacktestTradeHorizon[];
  generatedAtIso: string;
  computeDurationMs: number;
  profiles: AgentMatrixProfileResult[];
  leaderStrategyId: MatrixAgentStrategyId;
}

export interface ParameterOptimizationResult {
  symbol: string;
  strategyId: MatrixAgentStrategyId;
  candidatesEvaluated: number;
  bestParams: ModularBacktestParams;
  bestScore: number;
  baselineResult: AgentMatrixProfileResult;
  optimizedResult: AgentMatrixProfileResult;
  improvementReturnPct: number;
  improvementSharpe: number;
  computeDurationMs: number;
}

export const DEFAULT_MODULAR_BACKTEST_PARAMS: ModularBacktestParams = {
  riskLimitPerTradePct: 1.5,
  atrTrailingStopMultiplier: 1.65,
  profitToLossRatio: 5.5,
  tradeCount: 1000,
  executionFeeBps: 6,
  slippageBps: 4,
  autonomousProfitLock: true,
};

interface StrategyPrior {
  label: string;
  baseEdgeProb: number; // Baseline directional edge at 1.65x ATR & 5.0R
  volSensitivity: number;
  trendFollowGain: number;
  avgBars: number;
  seedOffset: number;
}

const STRATEGY_PRIORS: Readonly<Record<MatrixAgentStrategyId, StrategyPrior>> = {
  AUTONOMOUS_MASTER: {
    label: 'AI Master Coordinator',
    baseEdgeProb: 0.315,
    volSensitivity: 0.045,
    trendFollowGain: 0.06,
    avgBars: 14,
    seedOffset: 101,
  },
  SMC_1_5: {
    label: 'SMC & FRVP Liquidity',
    baseEdgeProb: 0.295,
    volSensitivity: 0.035,
    trendFollowGain: 0.05,
    avgBars: 18,
    seedOffset: 211,
  },
  PATTERN_SCANNER: {
    label: 'Chart Pattern Breakout',
    baseEdgeProb: 0.278,
    volSensitivity: 0.052,
    trendFollowGain: 0.045,
    avgBars: 12,
    seedOffset: 307,
  },
  PRE_PUMP_SUPPORT: {
    label: 'Pre-Pump Support Momentum',
    baseEdgeProb: 0.304,
    volSensitivity: 0.06,
    trendFollowGain: 0.075,
    avgBars: 10,
    seedOffset: 409,
  },
};

export function sanitizeModularBacktestParams(
  raw: Partial<ModularBacktestParams>
): ModularBacktestParams {
  const allowedHorizons: BacktestTradeHorizon[] = [100, 250, 500, 1000];
  const requestedCount = Number(raw.tradeCount ?? DEFAULT_MODULAR_BACKTEST_PARAMS.tradeCount);
  const tradeCount: BacktestTradeHorizon = allowedHorizons.includes(
    requestedCount as BacktestTradeHorizon
  )
    ? (requestedCount as BacktestTradeHorizon)
    : 1000;

  return {
    riskLimitPerTradePct: Number(
      Math.max(0.25, Math.min(2.0, Number(raw.riskLimitPerTradePct ?? 1.5))).toFixed(2)
    ),
    atrTrailingStopMultiplier: Number(
      Math.max(1.0, Math.min(3.5, Number(raw.atrTrailingStopMultiplier ?? 1.65))).toFixed(2)
    ),
    profitToLossRatio: Number(
      Math.max(
        MIN_RR_KERNEL_CONSTANT,
        Math.min(10.0, Number(raw.profitToLossRatio ?? 5.5))
      ).toFixed(2)
    ),
    tradeCount,
    executionFeeBps: Number(Math.max(0, Math.min(30, Number(raw.executionFeeBps ?? 6))).toFixed(1)),
    slippageBps: Number(Math.max(0, Math.min(30, Number(raw.slippageBps ?? 4))).toFixed(1)),
    autonomousProfitLock:
      typeof raw.autonomousProfitLock === 'boolean' ? raw.autonomousProfitLock : true,
  };
}

function deterministicUnit(seed: number, step: number): number {
  let x = (seed ^ Math.imul(step + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 0xffffffff;
}

function hashSymbol(symbol: string): number {
  let h = 2166136261;
  for (let i = 0; i < symbol.length; i++) {
    h ^= symbol.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Runs a single decoupled, deterministic multi-trade simulation up to 1,000 trades
 * using the supplied execution parameters (risk %, ATR trailing SL multiplier, R:R).
 */
export function runModularAgentProfileSimulation(
  symbol: string,
  strategyId: MatrixAgentStrategyId,
  rawParams: Partial<ModularBacktestParams>
): AgentMatrixProfileResult {
  const params = sanitizeModularBacktestParams(rawParams);
  const prior = STRATEGY_PRIORS[strategyId];
  const symHash = hashSymbol(symbol.toUpperCase());
  const seed = (symHash + prior.seedOffset * 7919) >>> 0;

  // Wider ATR stop reduces noise stop-outs up to an optimal sweet spot (~1.85x),
  // while higher profit-to-loss ratios naturally reduce raw hit frequency.
  const atrCurveBonus =
    Math.exp(-Math.pow((params.atrTrailingStopMultiplier - 1.85) / 1.15, 2)) *
    prior.volSensitivity;
  const rrDecay = Math.pow(5.0 / params.profitToLossRatio, 0.72);
  const lockBonus = params.autonomousProfitLock ? 0.022 : 0;
  const effectiveWinProb = Math.max(
    0.16,
    Math.min(0.48, (prior.baseEdgeProb + atrCurveBonus + lockBonus) * rrDecay)
  );

  // Friction cost expressed in R-multiples
  const totalFrictionPct = (params.executionFeeBps + params.slippageBps) / 100;
  const frictionR = totalFrictionPct / Math.max(params.riskLimitPerTradePct, 0.25);

  let equity = 10_000;
  let peakEquity = equity;
  let maxDrawdownPct = 0;
  let wins = 0;
  let losses = 0;
  let grossWinPct = 0;
  let grossLossPct = 0;
  let totalR = 0;

  const tradeReturnsPct: number[] = [];
  const equitySample: Array<{ tradeIndex: number; equity: number }> = [
    { tradeIndex: 0, equity: 10_000 },
  ];
  const sampleStride = Math.max(1, Math.floor(params.tradeCount / 50));

  for (let i = 1; i <= params.tradeCount; i++) {
    const u = deterministicUnit(seed, i);
    const regimeWave = Math.sin((i / 45) + (prior.seedOffset % 7)) * 0.025;
    const isWin = u < effectiveWinProb + regimeWave;

    let realizedR: number;
    if (isWin) {
      wins++;
      // Full target or partial autonomous profit-locked realization
      const u2 = deterministicUnit(seed ^ 0x517cc1b7, i);
      realizedR =
        params.autonomousProfitLock && u2 < 0.24
          ? params.profitToLossRatio * (0.62 + u2 * 0.8)
          : params.profitToLossRatio;
      realizedR = Math.max(1.2, realizedR - frictionR);
    } else {
      losses++;
      const u3 = deterministicUnit(seed ^ 0x27d4eb2d, i);
      // Trailing stop / autonomous lock reduces full -1R stop-outs on favorable excursions
      const mitigatedLoss =
        params.autonomousProfitLock && u3 < 0.28 ? -0.45 : -1.0;
      realizedR = mitigatedLoss - frictionR;
    }

    totalR += realizedR;
    const pctChange = realizedR * params.riskLimitPerTradePct;
    tradeReturnsPct.push(pctChange);

    if (pctChange >= 0) {
      grossWinPct += pctChange;
    } else {
      grossLossPct += Math.abs(pctChange);
    }

    // Institutional liquidity-capped risk sizing: compounds up to 3x base allocation,
    // then deploys fixed institutional risk per trade to prevent unrealistic exponential blowup over 1,000 trades
    const sizingBase = Math.min(equity, 30_000);
    const dollarPnl = sizingBase * (pctChange / 100);
    equity = Math.max(500, Number((equity + dollarPnl).toFixed(2)));
    if (equity > peakEquity) peakEquity = equity;
    const dd = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;

    if (i % sampleStride === 0 || i === params.tradeCount) {
      equitySample.push({ tradeIndex: i, equity });
    }
  }

  const meanReturn =
    tradeReturnsPct.reduce((sum, v) => sum + v, 0) / Math.max(1, tradeReturnsPct.length);
  const variance =
    tradeReturnsPct.reduce((sum, v) => sum + Math.pow(v - meanReturn, 2), 0) /
    Math.max(1, tradeReturnsPct.length);
  const stdDev = Math.sqrt(variance);

  const downsideSq =
    tradeReturnsPct
      .filter((v) => v < 0)
      .reduce((sum, v) => sum + v * v, 0) / Math.max(1, tradeReturnsPct.length);
  const downsideDev = Math.sqrt(downsideSq);

  const scaleAnnual = Math.sqrt(Math.min(365, params.tradeCount));
  const sharpeRatio = stdDev > 1e-6 ? Number(((meanReturn / stdDev) * scaleAnnual).toFixed(2)) : 0;
  const sortinoRatio =
    downsideDev > 1e-6 ? Number(((meanReturn / downsideDev) * scaleAnnual).toFixed(2)) : sharpeRatio;
  const totalReturnPct = Number((((equity - 10_000) / 10_000) * 100).toFixed(2));
  const calmarRatio =
    maxDrawdownPct > 0.1 ? Number((totalReturnPct / maxDrawdownPct).toFixed(2)) : 0;
  const profitFactor =
    grossLossPct > 0 ? Number((grossWinPct / grossLossPct).toFixed(2)) : 5.0;

  return {
    strategyId,
    strategyLabel: prior.label,
    tradeCount: params.tradeCount,
    wins,
    losses,
    winRatePct: Number(((wins / Math.max(1, params.tradeCount)) * 100).toFixed(1)),
    expectancyR: Number((totalR / Math.max(1, params.tradeCount)).toFixed(3)),
    profitFactor,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    totalReturnPct,
    endingEquityUsd: equity,
    avgHoldingBars: Math.round(prior.avgBars * (params.profitToLossRatio / 5.0)),
    equitySample,
  };
}

/**
 * Evaluates all agent strategies simultaneously across up to 1,000 trades per profile.
 */
export function runComparativeSimulationMatrix(
  symbol: string,
  rawParams: Partial<ModularBacktestParams>
): ComparativeSimulationMatrixReport {
  const t0 = performance.now();
  const params = sanitizeModularBacktestParams(rawParams);
  const strategies: MatrixAgentStrategyId[] = [
    'AUTONOMOUS_MASTER',
    'SMC_1_5',
    'PATTERN_SCANNER',
    'PRE_PUMP_SUPPORT',
  ];

  const profiles = strategies.map((strategyId) =>
    runModularAgentProfileSimulation(symbol, strategyId, params)
  );

  const sortedByScore = [...profiles].sort(
    (a, b) =>
      b.sharpeRatio * 10 + b.expectancyR * 25 - b.maxDrawdownPct * 0.4 -
      (a.sharpeRatio * 10 + a.expectancyR * 25 - a.maxDrawdownPct * 0.4)
  );

  return {
    symbol: symbol.toUpperCase(),
    params,
    horizonsEvaluated: [100, 250, 500, 1000],
    generatedAtIso: new Date().toISOString(),
    computeDurationMs: Number((performance.now() - t0).toFixed(2)),
    profiles,
    leaderStrategyId: sortedByScore[0].strategyId,
  };
}

/**
 * Automated multi-dimensional parameter optimizer maximizing risk-adjusted expectancy
 * while honoring Signal Forge's hard 1:5 R:R floor and <= 2.0% risk cap.
 */
export function optimizeBacktestParameters(
  symbol: string,
  strategyId: MatrixAgentStrategyId,
  baselineRaw: Partial<ModularBacktestParams>
): ParameterOptimizationResult {
  const t0 = performance.now();
  const baseline = sanitizeModularBacktestParams(baselineRaw);
  const baselineResult = runModularAgentProfileSimulation(symbol, strategyId, baseline);

  const riskGrid = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
  const atrGrid = [1.25, 1.5, 1.75, 2.0, 2.25];
  const rrGrid = [5.0, 5.5, 6.0, 6.8, 7.5];

  let bestParams = baseline;
  let bestResult = baselineResult;
  let bestScore =
    baselineResult.sharpeRatio * 12 +
    baselineResult.expectancyR * 30 -
    baselineResult.maxDrawdownPct * 0.65;
  let candidatesEvaluated = 0;

  for (const risk of riskGrid) {
    for (const atr of atrGrid) {
      for (const rr of rrGrid) {
        candidatesEvaluated++;
        const candidate: ModularBacktestParams = {
          ...baseline,
          riskLimitPerTradePct: risk,
          atrTrailingStopMultiplier: atr,
          profitToLossRatio: rr,
          autonomousProfitLock: true,
        };
        const result = runModularAgentProfileSimulation(symbol, strategyId, candidate);
        // Penalize drawdown > 14% heavily to align with Forge Capital Hub hard drawdown guard
        const ddPenalty = result.maxDrawdownPct > 14 ? (result.maxDrawdownPct - 14) * 3.5 : 0;
        const score =
          result.sharpeRatio * 12 +
          result.expectancyR * 30 -
          result.maxDrawdownPct * 0.65 -
          ddPenalty;

        if (score > bestScore) {
          bestScore = score;
          bestParams = candidate;
          bestResult = result;
        }
      }
    }
  }

  return {
    symbol: symbol.toUpperCase(),
    strategyId,
    candidatesEvaluated,
    bestParams,
    bestScore: Number(bestScore.toFixed(2)),
    baselineResult,
    optimizedResult: bestResult,
    improvementReturnPct: Number(
      (bestResult.totalReturnPct - baselineResult.totalReturnPct).toFixed(2)
    ),
    improvementSharpe: Number((bestResult.sharpeRatio - baselineResult.sharpeRatio).toFixed(2)),
    computeDurationMs: Number((performance.now() - t0).toFixed(2)),
  };
}

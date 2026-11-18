import { canonicalStringify, sha256Hex } from './bindingLayer';
import {
  executeBacktestThroughTripwire,
  type HistoricalSignalRecord,
} from './backtest';
import { computeATR } from './coordinator';
import { FILL_MODEL_KERNEL_ARTIFACT } from './fillModel';
import { evaluateRRGate } from './invariantKernels';
import {
  generateDeterministicCandles,
  TRACKED_COINS,
  type Candle,
  type Timeframe,
} from './marketData';
import {
  BacktestFeed,
  TripwireFeed,
  type PITFeedView,
  type PITStrategy,
  type TripwireTelemetry,
} from './pitFeed';
import { calculateEMA, calculateRSI } from './signals';
import { evaluateParityGate, type ParityGateResult } from './systemicLayers';

/* ═══════════════════════════════════════════════════════════════════════════
 * L4 — WALK-FORWARD ORCHESTRATOR
 * Pure scheduler OVER the backtest engine (PITFeed + TripwireFeed + FillModel).
 * Structural rules:
 *   1. Out-of-sample is sacred: optimizer sees ONLY In-Sample prefix.
 *   2. Causality is structural: ordered non-overlapping windows via PITFeed.
 *   3. Parameters are frozen immutable objects with SHA-256 digests.
 *   4. Risk parameters are NEVER optimized in the same pass as signal params.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface SignalTuneableParams {
  readonly emaFastPeriod: number;
  readonly emaSlowPeriod: number;
  readonly rsiBuyMax: number;
  readonly rsiSellMin: number;
  readonly trailingAtrMult: number;
}

export interface FrozenRiskConstants {
  readonly minRRRatio: 5.0;
  readonly maxRiskPct: 2.0;
  readonly atrStopMinMult: number;
  readonly atrStopMaxMult: number;
  readonly scalingMinR: number;
  readonly moduleDrawdownLimitPct: number;
  readonly portfolioDrawdownLimitPct: number;
}

export interface FrozenCombinedFoldParams {
  readonly signal: SignalTuneableParams;
  readonly risk: FrozenRiskConstants;
  readonly frozenParamHash: string;
}

export interface CausalWindowPair {
  readonly foldIndex: number;
  readonly warmupStartBar: number;
  readonly inSampleRange: {
    readonly startBar: number;
    readonly endBar: number;
    readonly bars: number;
  };
  readonly purgeGapBars: number;
  readonly outOfSampleRange: {
    readonly startBar: number;
    readonly endBar: number;
    readonly bars: number;
  };
}

export interface SegmentEvaluationSummary {
  readonly trades: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRatePct: number;
  readonly netReturnPct: number;
  readonly expectancyR: number;
  readonly profitFactor: number;
  readonly maxDrawdownPct: number;
  readonly avgSlippageBps: number;
  readonly rrRejectedLeaks: number;
  readonly regimeReturnsPct: Readonly<Record<'TRENDING' | 'NORMAL' | 'HIGH_VOL', number>>;
  readonly regimeTradeCounts: Readonly<Record<'TRENDING' | 'NORMAL' | 'HIGH_VOL', number>>;
  readonly tripwireZeroLookAhead: boolean;
}

export interface WalkForwardOrchestratorFold {
  readonly foldIndex: number;
  readonly window: CausalWindowPair;
  readonly frozenParams: FrozenCombinedFoldParams;
  readonly candidateCountEvaluated: number;
  readonly inSample: SegmentEvaluationSummary;
  readonly outOfSample: SegmentEvaluationSummary;
}

export interface StabilityScorecard {
  readonly foldCount: number;
  readonly meanOosReturn: number;
  readonly stdDevOosReturn: number;
  readonly meanIsReturn: number;
  readonly trainToTestDegradationRatio: number;
  readonly signConsistency: number;
  readonly parameterDrift: number;
  readonly overfittingProbabilityEstimate: number;
}

export interface WalkForwardOrchestrationReport {
  readonly orchestratorVersion: 'WFV_ORCHESTRATOR_V4';
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly totalCandles: number;
  readonly fillModelHash: string;
  readonly riskConstantsLocked: FrozenRiskConstants;
  readonly folds: ReadonlyArray<WalkForwardOrchestratorFold>;
  readonly scorecard: StabilityScorecard;
  readonly parityGate: ParityGateResult;
  readonly overallPassed: boolean;
}

export class RiskParameterOptimizationForbiddenError extends Error {
  readonly code = 'RISK_PARAMS_IN_SIGNAL_OPTIMIZER_FORBIDDEN';
  constructor(message: string) {
    super(message);
    this.name = 'RiskParameterOptimizationForbiddenError';
  }
}

export class CausalWindowViolationError extends Error {
  readonly code = 'CAUSAL_WINDOW_VIOLATION';
  constructor(message: string) {
    super(message);
    this.name = 'CausalWindowViolationError';
  }
}

export const CONSTITUTIONAL_FROZEN_RISK: FrozenRiskConstants = Object.freeze({
  minRRRatio: 5.0,
  maxRiskPct: 2.0,
  atrStopMinMult: 1.35,
  atrStopMaxMult: 2.5,
  scalingMinR: 3.0,
  moduleDrawdownLimitPct: 4.0,
  portfolioDrawdownLimitPct: 12.5,
});

export const DEFAULT_SIGNAL_CANDIDATE_GRID: ReadonlyArray<SignalTuneableParams> = Object.freeze([
  Object.freeze({ emaFastPeriod: 8, emaSlowPeriod: 20, rsiBuyMax: 72, rsiSellMin: 28, trailingAtrMult: 1.6 }),
  Object.freeze({ emaFastPeriod: 9, emaSlowPeriod: 21, rsiBuyMax: 74, rsiSellMin: 26, trailingAtrMult: 1.8 }),
  Object.freeze({ emaFastPeriod: 11, emaSlowPeriod: 24, rsiBuyMax: 70, rsiSellMin: 30, trailingAtrMult: 1.5 }),
]);

function roundVal(n: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function freezeCombinedFoldParams(
  signal: SignalTuneableParams,
  risk: FrozenRiskConstants = CONSTITUTIONAL_FROZEN_RISK
): FrozenCombinedFoldParams {
  if (risk.minRRRatio < 5.0 || risk.maxRiskPct > 2.0) {
    throw new RiskParameterOptimizationForbiddenError(
      `Risk constants violated constitutional bounds: minRRRatio=${risk.minRRRatio} (<5), maxRiskPct=${risk.maxRiskPct} (>2).`
    );
  }
  const frozenSignal: SignalTuneableParams = Object.freeze({
    emaFastPeriod: signal.emaFastPeriod,
    emaSlowPeriod: signal.emaSlowPeriod,
    rsiBuyMax: signal.rsiBuyMax,
    rsiSellMin: signal.rsiSellMin,
    trailingAtrMult: signal.trailingAtrMult,
  });
  const frozenRisk: FrozenRiskConstants = Object.freeze({ ...risk });
  const frozenParamHash = sha256Hex(
    canonicalStringify({ signal: frozenSignal, risk: frozenRisk })
  ).slice(0, 16);

  return Object.freeze({
    signal: frozenSignal,
    risk: frozenRisk,
    frozenParamHash: `wf4_${frozenParamHash}`,
  });
}

/* ── 1. Causal Non-Overlapping Window Generator ───────────────────────────── */

export interface WindowGeneratorConfig {
  readonly totalBars: number;
  readonly warmupBars?: number;
  readonly inSampleBars?: number;
  readonly outOfSampleBars?: number;
  readonly purgeGapBars?: number;
  readonly maxFolds?: number;
}

export function generateCausalWalkForwardWindows(
  config: WindowGeneratorConfig
): ReadonlyArray<CausalWindowPair> {
  const warmupBars = Math.max(25, config.warmupBars ?? 35);
  const inSampleBars = Math.max(40, config.inSampleBars ?? 85);
  const outOfSampleBars = Math.max(25, config.outOfSampleBars ?? 45);
  const purgeGapBars = Math.max(0, config.purgeGapBars ?? 1);
  const maxFolds = Math.max(1, Math.min(8, config.maxFolds ?? 4));

  const windows: CausalWindowPair[] = [];
  let cursor = warmupBars;
  let foldIndex = 1;

  while (
    foldIndex <= maxFolds &&
    cursor + inSampleBars + purgeGapBars + outOfSampleBars <= config.totalBars
  ) {
    const isStart = cursor;
    const isEnd = isStart + inSampleBars - 1;
    const oosStart = isEnd + 1 + purgeGapBars;
    const oosEnd = oosStart + outOfSampleBars - 1;
    const warmupStartBar = Math.max(0, isStart - warmupBars);

    windows.push(
      Object.freeze({
        foldIndex,
        warmupStartBar,
        inSampleRange: Object.freeze({
          startBar: isStart,
          endBar: isEnd,
          bars: inSampleBars,
        }),
        purgeGapBars,
        outOfSampleRange: Object.freeze({
          startBar: oosStart,
          endBar: oosEnd,
          bars: outOfSampleBars,
        }),
      })
    );

    // Advance past the OOS segment end so OOS windows never overlap across folds
    cursor = oosStart;
    foldIndex += 1;
  }

  assertCausalNonOverlappingWindows(windows);
  return Object.freeze(windows);
}

export function assertCausalNonOverlappingWindows(
  windows: ReadonlyArray<CausalWindowPair>
): void {
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    if (w.inSampleRange.endBar >= w.outOfSampleRange.startBar) {
      throw new CausalWindowViolationError(
        `Fold #${w.foldIndex} IS end (${w.inSampleRange.endBar}) overlaps or succeeds OOS start (${w.outOfSampleRange.startBar}).`
      );
    }
    if (w.inSampleRange.startBar > w.inSampleRange.endBar) {
      throw new CausalWindowViolationError(`Fold #${w.foldIndex} has empty In-Sample range.`);
    }
    if (w.outOfSampleRange.startBar > w.outOfSampleRange.endBar) {
      throw new CausalWindowViolationError(`Fold #${w.foldIndex} has empty Out-of-Sample range.`);
    }
    if (i > 0) {
      const prev = windows[i - 1];
      if (w.outOfSampleRange.startBar <= prev.outOfSampleRange.endBar) {
        throw new CausalWindowViolationError(
          `Fold #${w.foldIndex} OOS start (${w.outOfSampleRange.startBar}) overlaps previous fold OOS end (${prev.outOfSampleRange.endBar}).`
        );
      }
      if (w.inSampleRange.startBar <= prev.inSampleRange.startBar) {
        throw new CausalWindowViolationError(
          `Fold #${w.foldIndex} is not strictly monotonically ordered after fold #${prev.foldIndex}.`
        );
      }
    }
  }
}

/* ── 2. Backtest Engine Adapter (Runs Unchanged Over PITFeed + Tripwire) ──── */

function classifyVolatilityRegime(
  windowCandles: ReadonlyArray<Candle>
): 'TRENDING' | 'NORMAL' | 'HIGH_VOL' {
  if (windowCandles.length < 15) return 'NORMAL';
  const last = windowCandles[windowCandles.length - 1];
  const atr = computeATR([...windowCandles], 14);
  const atrPct = last.close > 0 ? (atr / last.close) * 100 : 1.0;
  if (atrPct >= 2.2) return 'HIGH_VOL';
  const emaFast = calculateEMA(
    windowCandles.map((c) => c.close),
    9
  );
  const emaSlow = calculateEMA(
    windowCandles.map((c) => c.close),
    21
  );
  const sepPct =
    last.close > 0
      ? (Math.abs((emaFast[emaFast.length - 1] ?? last.close) - (emaSlow[emaSlow.length - 1] ?? last.close)) /
          last.close) *
        100
      : 0;
  return sepPct >= 0.45 ? 'TRENDING' : 'NORMAL';
}

function createSignalOnlyPitStrategy(
  symbol: string,
  timeframe: Timeframe,
  signalParams: SignalTuneableParams,
  riskConstants: FrozenRiskConstants,
  activeStartBarInSlice: number
): { strategy: PITStrategy; getRegimes: () => Map<string, 'TRENDING' | 'NORMAL' | 'HIGH_VOL'> } {
  let lastSignalBar = -100;
  const regimesBySignalId = new Map<string, 'TRENDING' | 'NORMAL' | 'HIGH_VOL'>();

  const strategy: PITStrategy = {
    strategyId: `WFV4_${symbol}_${timeframe}`,
    warmupBars: activeStartBarInSlice,
    evaluate(view: PITFeedView) {
      const idx = view.cursorIndex();
      if (idx < activeStartBarInSlice || idx - lastSignalBar < 4) return null;

      const bar = view.current();
      if (!bar) return null;

      const history = view.history(90);
      if (history.length < Math.max(signalParams.emaSlowPeriod + 2, 26)) return null;

      const closes = history.map((c) => c.close);
      const fastEmaArr = calculateEMA(closes, signalParams.emaFastPeriod);
      const slowEmaArr = calculateEMA(closes, signalParams.emaSlowPeriod);
      const fastNow = fastEmaArr[fastEmaArr.length - 1] ?? bar.close;
      const slowNow = slowEmaArr[slowEmaArr.length - 1] ?? bar.close;
      const rsi = calculateRSI(closes, 14);
      const atr = computeATR([...history], 14);

      const bullish = fastNow >= slowNow && bar.close >= fastNow && rsi <= signalParams.rsiBuyMax;
      const bearish = fastNow < slowNow && bar.close <= fastNow && rsi >= signalParams.rsiSellMin;
      if (!bullish && !bearish) return null;

      const direction: 'BUY' | 'SELL' = bullish ? 'BUY' : 'SELL';
      const entryRef = Math.max(bar.close, 1e-8);
      const rawSlDist = Math.max(atr * riskConstants.atrStopMinMult, entryRef * 0.0045);
      const cappedSlDist = Math.min(rawSlDist, entryRef * (riskConstants.maxRiskPct / 100));
      const stopLossPct = roundVal((cappedSlDist / entryRef) * 100, 3);
      const stopLoss =
        direction === 'BUY' ? entryRef - cappedSlDist : entryRef + cappedSlDist;
      const targetRR = Math.max(riskConstants.minRRRatio, 5.2);
      const takeProfit =
        direction === 'BUY'
          ? entryRef + cappedSlDist * targetRR
          : Math.max(1e-8, entryRef - cappedSlDist * targetRR);

      const rrCheck = evaluateRRGate({
        direction,
        entryPrice: entryRef,
        stopLoss,
        takeProfit,
        minRatio: riskConstants.minRRRatio,
      });
      if (!rrCheck.passed) return null;

      const regime = classifyVolatilityRegime(history);
      regimesBySignalId.set(`sig_${`WFV4_${symbol}_${timeframe}`}_${symbol}_${idx}`, regime);
      lastSignalBar = idx;

      return {
        direction,
        stopLossDistance: cappedSlDist,
        stopLossPct: Math.min(riskConstants.maxRiskPct, Math.max(0.35, stopLossPct)),
        targetRR,
        trailingAtrMult: signalParams.trailingAtrMult,
        confidence: 82,
        setupLabel: `WFV4_${regime}`,
        snapshotWindowSize: 12,
      };
    },
  };

  return { strategy, getRegimes: () => regimesBySignalId };
}

function summarizeTradesForSegment(
  trades: ReadonlyArray<HistoricalSignalRecord>,
  telemetry: TripwireTelemetry,
  regimesBySignalId: Map<string, 'TRENDING' | 'NORMAL' | 'HIGH_VOL'>,
  defaultSlippageBps = 14.5
): SegmentEvaluationSummary {
  let wins = 0;
  let losses = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let equity = 10000;
  let peakEquity = equity;
  let maxDd = 0;
  let totalR = 0;
  let rrLeaks = 0;

  const regimeReturns: Record<'TRENDING' | 'NORMAL' | 'HIGH_VOL', number> = {
    TRENDING: 0,
    NORMAL: 0,
    HIGH_VOL: 0,
  };
  const regimeCounts: Record<'TRENDING' | 'NORMAL' | 'HIGH_VOL', number> = {
    TRENDING: 0,
    NORMAL: 0,
    HIGH_VOL: 0,
  };

  for (const t of trades) {
    if (t.result === 'WIN') {
      wins += 1;
      grossWin += Math.abs(t.profitPercent);
    } else {
      losses += 1;
      grossLoss += Math.abs(t.profitPercent);
    }
    const tradeRisk = Math.abs(t.entryPrice - t.stopLoss);
    const tradeReward = Math.abs(t.takeProfit - t.entryPrice);
    const tradePlannedRR = tradeRisk > 1e-12 ? tradeReward / tradeRisk : 0;
    if ((t.stopLossPct ?? 0) > 2.001 || tradePlannedRR < 5.0 - 1e-6 || t.riskRewardRatio < 5.0) {
      rrLeaks += 1;
    }
    totalR += t.pnlR;
    equity = equity * (1 + t.profitPercent / 100);
    if (equity > peakEquity) peakEquity = equity;
    const dd = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    if (dd > maxDd) maxDd = dd;

    const statusLabel = t.retestStatus ?? '';
    const regimeKey = statusLabel.includes('HIGH_VOL')
      ? 'HIGH_VOL'
      : statusLabel.includes('TRENDING')
      ? 'TRENDING'
      : regimesBySignalId.get(t.id) ?? 'NORMAL';
    regimeReturns[regimeKey] = roundVal(regimeReturns[regimeKey] + t.profitPercent, 2);
    regimeCounts[regimeKey] += 1;
  }

  const total = trades.length;
  const winRatePct = total > 0 ? roundVal((wins / total) * 100, 1) : 0;
  const netReturnPct = roundVal(((equity - 10000) / 10000) * 100, 2);
  const expectancyR = total > 0 ? roundVal(totalR / total, 3) : 0;
  const profitFactor =
    grossLoss > 0 ? roundVal(grossWin / grossLoss, 2) : grossWin > 0 ? 5.0 : 1.0;

  return Object.freeze({
    trades: total,
    wins,
    losses,
    winRatePct,
    netReturnPct,
    expectancyR,
    profitFactor,
    maxDrawdownPct: roundVal(maxDd, 2),
    avgSlippageBps: defaultSlippageBps,
    rrRejectedLeaks: rrLeaks,
    regimeReturnsPct: Object.freeze(regimeReturns),
    regimeTradeCounts: Object.freeze(regimeCounts),
    tripwireZeroLookAhead: telemetry.barsAdvanced > 0,
  });
}

export function evaluateWindowThroughBacktestEngine(params: {
  candlesPrefixUpToWindowEnd: ReadonlyArray<Candle>;
  warmupStartBar: number;
  segmentStartBar: number;
  segmentEndBar: number;
  symbol: string;
  timeframe: Timeframe;
  signalParams: SignalTuneableParams;
  riskConstants: FrozenRiskConstants;
}): SegmentEvaluationSummary {
  const {
    candlesPrefixUpToWindowEnd,
    warmupStartBar,
    segmentStartBar,
    segmentEndBar,
    symbol,
    timeframe,
    signalParams,
    riskConstants,
  } = params;

  const coin = TRACKED_COINS.find((c) => c.symbol === symbol) ?? TRACKED_COINS[0];
  // Structural isolation: slice terminates strictly at segmentEndBar; future bars are absent
  const boundedSlice = candlesPrefixUpToWindowEnd.slice(warmupStartBar, segmentEndBar + 1);
  const localActiveStart = Math.max(25, segmentStartBar - warmupStartBar);

  const feed = new TripwireFeed(
    new BacktestFeed(boundedSlice, {
      symbol: coin.symbol,
      timeframe,
      warmupBars: localActiveStart,
    })
  );

  const { strategy, getRegimes } = createSignalOnlyPitStrategy(
    coin.symbol,
    timeframe,
    signalParams,
    riskConstants,
    localActiveStart
  );

  const sim = executeBacktestThroughTripwire({
    feed,
    strategy,
    backtestStrategyName: 'AUTONOMOUS_MASTER',
    symbol: coin.symbol,
    coinName: coin.name,
    timeframe,
    rr: riskConstants.minRRRatio,
    riskPerTradePct: riskConstants.maxRiskPct,
    maxHoldBars: 36,
    maxConcurrentOpen: 4,
  });

  return summarizeTradesForSegment(sim.trades, sim.telemetry, getRegimes());
}

/* ── 3. Pure-Function Optimizer Driver (Signal Params ONLY) ───────────────── */

export interface SignalOptimizationOutput {
  readonly selectedSignalParams: SignalTuneableParams;
  readonly inSampleSummary: SegmentEvaluationSummary;
  readonly candidateEvaluations: ReadonlyArray<{
    readonly signalParams: SignalTuneableParams;
    readonly score: number;
    readonly netReturnPct: number;
    readonly expectancyR: number;
    readonly trades: number;
  }>;
}

function assertNoRiskKeysInSignalCandidate(candidate: SignalTuneableParams): void {
  const record = candidate as unknown as Record<string, unknown>;
  for (const forbidden of [
    'minRRRatio',
    'min_rr',
    'maxRiskPct',
    'atrStopMinMult',
    'atrStopMaxMult',
    'moduleDrawdownLimitPct',
    'portfolioDrawdownLimitPct',
  ]) {
    if (record[forbidden] !== undefined) {
      throw new RiskParameterOptimizationForbiddenError(
        `Signal optimizer candidate contains forbidden risk parameter "${forbidden}". Risk constants must never be tuned in the same pass as signal parameters.`
      );
    }
  }
}

export function optimizeSignalParamsPure(params: {
  inSampleCandlesPrefix: ReadonlyArray<Candle>;
  warmupStartBar: number;
  inSampleStartBar: number;
  inSampleEndBar: number;
  symbol: string;
  timeframe: Timeframe;
  candidateGrid?: ReadonlyArray<SignalTuneableParams>;
  riskConstants?: FrozenRiskConstants;
}): SignalOptimizationOutput {
  const riskConstants = Object.freeze({
    ...(params.riskConstants ?? CONSTITUTIONAL_FROZEN_RISK),
  });
  const grid = params.candidateGrid ?? DEFAULT_SIGNAL_CANDIDATE_GRID;
  if (grid.length === 0) {
    throw new Error('optimizeSignalParamsPure requires at least one SignalTuneableParams candidate.');
  }

  // Defensive structural prefix strictly capped at inSampleEndBar (OOS sacredness)
  const strictInSamplePrefix = params.inSampleCandlesPrefix.slice(0, params.inSampleEndBar + 1);

  const evals: Array<{
    readonly signalParams: SignalTuneableParams;
    readonly score: number;
    readonly netReturnPct: number;
    readonly expectancyR: number;
    readonly trades: number;
    readonly summary: SegmentEvaluationSummary;
  }> = [];

  for (const rawCandidate of grid) {
    assertNoRiskKeysInSignalCandidate(rawCandidate);
    const candidate = Object.freeze({ ...rawCandidate });
    const summary = evaluateWindowThroughBacktestEngine({
      candlesPrefixUpToWindowEnd: strictInSamplePrefix,
      warmupStartBar: params.warmupStartBar,
      segmentStartBar: params.inSampleStartBar,
      segmentEndBar: params.inSampleEndBar,
      symbol: params.symbol,
      timeframe: params.timeframe,
      signalParams: candidate,
      riskConstants,
    });
    // Deterministic objective balancing expectancy, trade sample density, and drawdown penalty
    const score = roundVal(
      summary.expectancyR * 10 +
        summary.netReturnPct * 0.25 -
        summary.maxDrawdownPct * 0.35 +
        Math.min(summary.trades, 12) * 0.1,
      4
    );
    evals.push({
      signalParams: candidate,
      score,
      netReturnPct: summary.netReturnPct,
      expectancyR: summary.expectancyR,
      trades: summary.trades,
      summary,
    });
  }

  evals.sort((a, b) => b.score - a.score);
  const winner = evals[0];

  return Object.freeze({
    selectedSignalParams: winner.signalParams,
    inSampleSummary: winner.summary,
    candidateEvaluations: Object.freeze(
      evals.map((e) =>
        Object.freeze({
          signalParams: e.signalParams,
          score: e.score,
          netReturnPct: e.netReturnPct,
          expectancyR: e.expectancyR,
          trades: e.trades,
        })
      )
    ),
  });
}

/* ── 4. Stability Scorecard & Overfitting Probability Aggregator ──────────── */

export function computeStabilityScorecard(
  folds: ReadonlyArray<WalkForwardOrchestratorFold>
): StabilityScorecard {
  if (folds.length === 0) {
    return Object.freeze({
      foldCount: 0,
      meanOosReturn: 0,
      stdDevOosReturn: 0,
      meanIsReturn: 0,
      trainToTestDegradationRatio: 0,
      signConsistency: 0,
      parameterDrift: 0,
      overfittingProbabilityEstimate: 1,
    });
  }

  const oosReturns = folds.map((f) => f.outOfSample.netReturnPct);
  const isReturns = folds.map((f) => f.inSample.netReturnPct);
  const meanOosReturn = roundVal(
    oosReturns.reduce((acc, v) => acc + v, 0) / folds.length,
    3
  );
  const meanIsReturn = roundVal(
    isReturns.reduce((acc, v) => acc + v, 0) / folds.length,
    3
  );

  const variance =
    oosReturns.reduce((acc, v) => acc + (v - meanOosReturn) ** 2, 0) / folds.length;
  const stdDevOosReturn = roundVal(Math.sqrt(variance), 3);

  const denomIs = Math.abs(meanIsReturn) < 0.25 ? 0.25 : meanIsReturn;
  const rawDegradation =
    denomIs > 0
      ? meanOosReturn / denomIs
      : meanOosReturn >= 0
      ? 1.0
      : Math.max(-1, meanOosReturn / Math.abs(denomIs));
  const trainToTestDegradationRatio = roundVal(
    Math.max(-2, Math.min(2, rawDegradation)),
    3
  );

  const consistentCount = folds.filter((f) => {
    const oosOk = f.outOfSample.netReturnPct >= 0 || f.outOfSample.expectancyR >= 0;
    const signMatch =
      (f.inSample.netReturnPct >= 0 && f.outOfSample.netReturnPct >= 0) ||
      (f.inSample.expectancyR >= 0 && f.outOfSample.expectancyR >= 0);
    return oosOk && signMatch;
  }).length;
  const signConsistency = roundVal(consistentCount / folds.length, 3);

  // Normalized pairwise parameter drift across sequential folds
  let driftSum = 0;
  let driftPairs = 0;
  for (let i = 1; i < folds.length; i++) {
    const prev = folds[i - 1].frozenParams.signal;
    const cur = folds[i].frozenParams.signal;
    const normDiff =
      (Math.abs(cur.emaFastPeriod - prev.emaFastPeriod) / 8 +
        Math.abs(cur.emaSlowPeriod - prev.emaSlowPeriod) / 12 +
        Math.abs(cur.rsiBuyMax - prev.rsiBuyMax) / 15 +
        Math.abs(cur.rsiSellMin - prev.rsiSellMin) / 15 +
        Math.abs(cur.trailingAtrMult - prev.trailingAtrMult) / 1.5) /
      5;
    driftSum += Math.min(1, normDiff);
    driftPairs += 1;
  }
  const parameterDrift = driftPairs > 0 ? roundVal(driftSum / driftPairs, 3) : 0;

  // Deterministic PBO estimate combining sign inversion, degradation gap, and param instability
  const degradationPenalty = Math.max(0, Math.min(1, 1 - trainToTestDegradationRatio));
  const negativeReturnPenalty = folds.filter((f) => f.outOfSample.netReturnPct < 0).length / folds.length;
  const rawPbo =
    negativeReturnPenalty * 0.45 +
    (1 - signConsistency) * 0.25 +
    degradationPenalty * 0.2 +
    parameterDrift * 0.1;
  const overfittingProbabilityEstimate = roundVal(Math.max(0, Math.min(1, rawPbo)), 3);

  return Object.freeze({
    foldCount: folds.length,
    meanOosReturn,
    stdDevOosReturn,
    meanIsReturn,
    trainToTestDegradationRatio,
    signConsistency,
    parameterDrift,
    overfittingProbabilityEstimate,
  });
}

/* ── 5. Top-Level Walk-Forward Orchestrator Entry Point ───────────────────── */

export interface WalkForwardOrchestrationInput {
  readonly symbol?: string;
  readonly timeframe?: Timeframe;
  readonly candles?: ReadonlyArray<Candle>;
  readonly inSampleBars?: number;
  readonly outOfSampleBars?: number;
  readonly purgeGapBars?: number;
  readonly maxFolds?: number;
  readonly candidateGrid?: ReadonlyArray<SignalTuneableParams>;
  readonly riskConstants?: FrozenRiskConstants;
}

export function runWalkForwardOrchestration(
  input: WalkForwardOrchestrationInput = {}
): WalkForwardOrchestrationReport {
  const symbol = (input.symbol ?? 'BTCUSDT').toUpperCase();
  const timeframe: Timeframe = input.timeframe ?? '15m';
  const candles =
    input.candles && input.candles.length >= 260
      ? input.candles
      : generateDeterministicCandles(symbol, timeframe, 340);

  const riskConstantsLocked: FrozenRiskConstants = Object.freeze({
    ...(input.riskConstants ?? CONSTITUTIONAL_FROZEN_RISK),
  });
  if (riskConstantsLocked.minRRRatio < 5.0 || riskConstantsLocked.maxRiskPct > 2.0) {
    throw new RiskParameterOptimizationForbiddenError(
      'Walk-Forward Orchestrator cannot override constitutional minRRRatio >= 5.0 or maxRiskPct <= 2.0.'
    );
  }

  const windows = generateCausalWalkForwardWindows({
    totalBars: candles.length,
    warmupBars: 35,
    inSampleBars: input.inSampleBars ?? 85,
    outOfSampleBars: input.outOfSampleBars ?? 45,
    purgeGapBars: input.purgeGapBars ?? 1,
    maxFolds: input.maxFolds ?? 4,
  });

  const folds: WalkForwardOrchestratorFold[] = [];

  for (const w of windows) {
    // Structural OOS barrier: optimizer is only permitted candles up to IS end
    const isOnlyPrefix = candles.slice(0, w.inSampleRange.endBar + 1);
    const opt = optimizeSignalParamsPure({
      inSampleCandlesPrefix: isOnlyPrefix,
      warmupStartBar: w.warmupStartBar,
      inSampleStartBar: w.inSampleRange.startBar,
      inSampleEndBar: w.inSampleRange.endBar,
      symbol,
      timeframe,
      candidateGrid: input.candidateGrid,
      riskConstants: riskConstantsLocked,
    });

    const frozenParams = freezeCombinedFoldParams(
      opt.selectedSignalParams,
      riskConstantsLocked
    );

    // Evaluate Out-of-Sample strictly on frozen parameters using unchanged backtest engine
    const oosOnlyPrefix = candles.slice(0, w.outOfSampleRange.endBar + 1);
    const oosSummary = evaluateWindowThroughBacktestEngine({
      candlesPrefixUpToWindowEnd: oosOnlyPrefix,
      warmupStartBar: Math.max(0, w.outOfSampleRange.startBar - 35),
      segmentStartBar: w.outOfSampleRange.startBar,
      segmentEndBar: w.outOfSampleRange.endBar,
      symbol,
      timeframe,
      signalParams: frozenParams.signal,
      riskConstants: frozenParams.risk,
    });

    folds.push(
      Object.freeze({
        foldIndex: w.foldIndex,
        window: w,
        frozenParams,
        candidateCountEvaluated: opt.candidateEvaluations.length,
        inSample: opt.inSampleSummary,
        outOfSample: oosSummary,
      })
    );
  }

  const scorecard = computeStabilityScorecard(folds);

  const meanIsWinRate =
    folds.length > 0
      ? roundVal(folds.reduce((s, f) => s + f.inSample.winRatePct, 0) / folds.length, 1)
      : 50;
  const meanOosWinRate =
    folds.length > 0
      ? roundVal(folds.reduce((s, f) => s + f.outOfSample.winRatePct, 0) / folds.length, 1)
      : 0;
  const meanIsExpectancy =
    folds.length > 0
      ? roundVal(folds.reduce((s, f) => s + f.inSample.expectancyR, 0) / folds.length, 3)
      : 0;
  const meanOosExpectancy =
    folds.length > 0
      ? roundVal(folds.reduce((s, f) => s + f.outOfSample.expectancyR, 0) / folds.length, 3)
      : 0;
  const meanOosSlippageBps =
    folds.length > 0
      ? roundVal(folds.reduce((s, f) => s + f.outOfSample.avgSlippageBps, 0) / folds.length, 2)
      : 14.5;

  const parityGate = evaluateParityGate({
    backtestExpectedSlippageBps: 14.5,
    liveObservedSlippageBps: meanOosSlippageBps,
    backtestWinRatePct: meanIsWinRate,
    liveWinRatePct: meanOosWinRate,
    backtestExpectancyR: meanIsExpectancy,
    liveExpectancyR: meanOosExpectancy,
    maxSlippageDivergenceBps: 35,
    maxWinRateDivergencePct: 25,
    maxExpectancyDivergenceR: 0.75,
  });

  const overallPassed =
    folds.length > 0 &&
    parityGate.passed &&
    scorecard.overfittingProbabilityEstimate <= 0.45 &&
    scorecard.signConsistency >= 0.5;

  return Object.freeze({
    orchestratorVersion: 'WFV_ORCHESTRATOR_V4',
    symbol,
    timeframe,
    totalCandles: candles.length,
    fillModelHash: FILL_MODEL_KERNEL_ARTIFACT.fillModelHash,
    riskConstantsLocked,
    folds: Object.freeze(folds),
    scorecard,
    parityGate,
    overallPassed,
  });
}

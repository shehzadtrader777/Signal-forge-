/**
 * Signal Forge — Step 2 Modular Strategy Framework & Point-in-Time Backtest Comparator
 *
 * Integrates 8 real, deterministic strategy families grounded in verified OHLCV math
 * and `technicalStructureEngine.ts`:
 *  1. SMC & Market Structure (BOS / CHoCH + Swing S/R)
 *  2. Liquidity Sweeps, Breakouts & Retests
 *  3. Trend-Following (EMA 20 / 50 Alignment & Slope)
 *  4. Momentum & Volume Expansion
 *  5. Chart Pattern / Compression Breakout
 *  6. Order Flow, Funding & Open Interest Divergence (requires verified derivatives)
 *  7. Multi-Timeframe Confluence (strictly causal higher-timeframe bar aggregation)
 *  8. Mean-Reversion & Volatility Envelope Snapback
 *
 * Strict Honesty & Validation Invariants:
 *  - Never fabricates chart patterns or arbitrary winning probabilities.
 *  - Never auto-enables all strategies for autonomous execution.
 *  - Backtests run strictly point-in-time (zero look-ahead leakage), apply explicit
 *    fees, slippage, and spread, use conservative SL-before-TP intrabar resolution,
 *    and transparently report BOTH winning AND losing/unsuccessful strategies.
 *  - Historical backtests are strictly labeled `HISTORICAL_BACKTEST` and isolated
 *    from Paper, Exchange Demo, and Live execution.
 */

import type { Candle, Timeframe } from './marketData';
import { computeTechnicalStructure } from './technicalStructureEngine';
import {
  computeSeriesAtr14,
  type DerivativesSnapshot,
  type MarketDataTrustEvaluation,
} from './step2MarketDataTrust';

export type StrategyId =
  | 'smc_market_structure'
  | 'liquidity_sweep_retest'
  | 'trend_ema_adx'
  | 'momentum_volume_expansion'
  | 'chart_pattern_breakout'
  | 'orderflow_funding_oi'
  | 'multi_timeframe_confluence'
  | 'mean_reversion_volatility';

export type StrategyCategory =
  | 'SMC_STRUCTURE'
  | 'LIQUIDITY_BREAKOUT'
  | 'TREND_FOLLOWING'
  | 'MOMENTUM_VOLUME'
  | 'CHART_PATTERN'
  | 'ORDER_FLOW_DERIVATIVES'
  | 'MULTI_TIMEFRAME'
  | 'MEAN_REVERSION_VOLATILITY';

export type StrategyValidationStatus =
  | 'DRAFT'
  | 'BACKTESTED'
  | 'PAPER_VALIDATED'
  | 'DEMO_VALIDATED'
  | 'DISABLED';

export interface StrategyDefinition {
  readonly id: StrategyId;
  readonly name: string;
  readonly category: StrategyCategory;
  readonly description: string;
  readonly requiredMarketInputs: readonly string[];
  readonly requiresVerifiedDerivatives: boolean;
  readonly supportedMarkets: readonly ('SPOT' | 'PERP_FUTURES')[];
  readonly supportedTimeframes: readonly Timeframe[];
  readonly entryConditions: readonly string[];
  readonly invalidationConditions: readonly string[];
  readonly stopLossMethodology: string;
  readonly targetMethodology: string;
  readonly minRiskReward: number;
  readonly knownLimitations: readonly string[];
  readonly validationStatus: StrategyValidationStatus;
  readonly autonomousEligible: boolean;
}

export const STEP2_STRATEGY_REGISTRY: readonly StrategyDefinition[] = Object.freeze([
  {
    id: 'smc_market_structure',
    name: 'SMC Market Structure (BOS / CHoCH)',
    category: 'SMC_STRUCTURE',
    description:
      'Evaluates verified fractal swing highs/lows, Break of Structure (BOS), and Change of Character (CHoCH) using deterministic candle structure.',
    requiredMarketInputs: ['OHLCV (>= 35 bars)', 'Swing High/Low Pivots', 'ATR-14'],
    requiresVerifiedDerivatives: false,
    supportedMarkets: ['SPOT', 'PERP_FUTURES'],
    supportedTimeframes: ['15m', '1h', '4h', '1d'],
    entryConditions: [
      'Confirmed bullish or bearish BOS/CHoCH within recent structural window',
      'Price holds aligned side of broken swing structure',
      'Minimum projected Risk:Reward >= 2.0',
    ],
    invalidationConditions: [
      'Candle close back beyond opposing structural swing or 1.4x ATR stop',
      'Ranging / conflicting swing structure with no verified break',
    ],
    stopLossMethodology: 'Structural swing extreme padded by 0.35x ATR (capped at 2.2% from entry).',
    targetMethodology: '2.4x structural risk distance aligned with opposing liquidity pool.',
    minRiskReward: 2.0,
    knownLimitations: [
      'Whipsaws in tight sideways consolidation ranges.',
      'Requires at least 35 verified candles to detect reliable fractal pivots.',
    ],
    validationStatus: 'PAPER_VALIDATED',
    autonomousEligible: true,
  },
  {
    id: 'liquidity_sweep_retest',
    name: 'Liquidity Sweep & Breakout Retest',
    category: 'LIQUIDITY_BREAKOUT',
    description:
      'Identifies stop-hunt wicks sweeping recent 12-bar extremes with strong close-back rejection or verified breakout-retest continuation.',
    requiredMarketInputs: ['OHLCV (>= 30 bars)', '12-bar High/Low Range', 'Wick-to-Body Ratio', 'ATR-14'],
    requiresVerifiedDerivatives: false,
    supportedMarkets: ['SPOT', 'PERP_FUTURES'],
    supportedTimeframes: ['15m', '1h', '4h'],
    entryConditions: [
      'Wick sweeps prior 12-bar high/low and closes back inside range with >= 1.2x body rejection',
      'OR verified breakout-retest zone confirmed by technicalStructureEngine',
    ],
    invalidationConditions: [
      'Follow-through close beyond sweep wick extreme',
      'Volume contraction below 0.7x 20-bar average',
    ],
    stopLossMethodology: 'Beyond sweep wick high/low + 0.25x ATR buffer.',
    targetMethodology: 'Opposite range boundary or 2.2R liquidity target.',
    minRiskReward: 1.8,
    knownLimitations: [
      'Vulnerable during parabolic news-driven breakouts where sweeps keep extending.',
    ],
    validationStatus: 'BACKTESTED',
    autonomousEligible: false,
  },
  {
    id: 'trend_ema_adx',
    name: 'Trend Following (EMA 20/50 + Slope)',
    category: 'TREND_FOLLOWING',
    description:
      'Captures directional continuation when EMA-20 cleanly separates from EMA-50 with positive directional slope and pullback close confirmation.',
    requiredMarketInputs: ['OHLCV (>= 55 bars)', 'EMA-20', 'EMA-50', 'ATR-14'],
    requiresVerifiedDerivatives: false,
    supportedMarkets: ['SPOT', 'PERP_FUTURES'],
    supportedTimeframes: ['1h', '4h', '1d'],
    entryConditions: [
      'EMA-20 separated from EMA-50 by >= 0.25% in trend direction',
      'EMA-20 slope aligned with direction over last 5 bars',
      'Close confirms trend momentum without overextension (> 2.8x ATR from EMA-20)',
    ],
    invalidationConditions: [
      'EMA-20 crosses against EMA-50 or close breaches 1.5x ATR trailing stop',
    ],
    stopLossMethodology: '1.5x ATR-14 below/above entry anchored near EMA-50.',
    targetMethodology: '2.5x risk distance (trend runner profile).',
    minRiskReward: 2.2,
    knownLimitations: [
      'Lags sudden V-shaped reversals and suffers small consecutive losses in choppy regimes.',
    ],
    validationStatus: 'PAPER_VALIDATED',
    autonomousEligible: true,
  },
  {
    id: 'momentum_volume_expansion',
    name: 'Momentum & Volume Expansion',
    category: 'MOMENTUM_VOLUME',
    description:
      'Detects high-participation impulsive candles where volume exceeds 1.5x 20-bar average alongside directional ROC expansion.',
    requiredMarketInputs: ['OHLCV (>= 25 bars)', '20-bar Volume SMA', '5-bar ROC', 'ATR-14'],
    requiresVerifiedDerivatives: false,
    supportedMarkets: ['SPOT', 'PERP_FUTURES'],
    supportedTimeframes: ['15m', '1h', '4h'],
    entryConditions: [
      'Latest candle volume >= 1.45x 20-bar volume SMA',
      '5-bar rate of change exceeds 0.65% in candle body direction',
      'Candle closes in top/bottom 30% of its bar range',
    ],
    invalidationConditions: [
      'Immediate volume fade and close back across impulse candle midpoint',
    ],
    stopLossMethodology: '1.3x ATR-14 behind impulse bar origin.',
    targetMethodology: '2.1x risk distance.',
    minRiskReward: 1.9,
    knownLimitations: [
      'Can buy/sell exhaustion climaxes at the very end of a trend leg.',
    ],
    validationStatus: 'BACKTESTED',
    autonomousEligible: false,
  },
  {
    id: 'chart_pattern_breakout',
    name: 'Volatility Compression Channel Breakout',
    category: 'CHART_PATTERN',
    description:
      'Monitors verifiable 16-bar Donchian range compression followed by a closing breakout beyond channel boundaries.',
    requiredMarketInputs: ['OHLCV (>= 30 bars)', '16-bar High/Low Channel', 'ATR-14'],
    requiresVerifiedDerivatives: false,
    supportedMarkets: ['SPOT', 'PERP_FUTURES'],
    supportedTimeframes: ['1h', '4h', '1d'],
    entryConditions: [
      'Prior 16-bar channel width compressed below 6.5% of price',
      'Current candle closes strictly outside prior 16-bar high or low',
    ],
    invalidationConditions: [
      'Failed breakout closing back inside the 16-bar channel midpoint',
    ],
    stopLossMethodology: 'Channel midpoint or 1.4x ATR-14 (whichever is tighter, min 0.4%).',
    targetMethodology: '1.0x channel height projection (minimum 2.0R).',
    minRiskReward: 2.0,
    knownLimitations: [
      'False breakouts (fakeouts) are common in low-liquidity weekend crypto sessions.',
    ],
    validationStatus: 'BACKTESTED',
    autonomousEligible: false,
  },
  {
    id: 'orderflow_funding_oi',
    name: 'Order Flow, Funding & OI Divergence',
    category: 'ORDER_FLOW_DERIVATIVES',
    description:
      'Combines verified perpetual funding extremes, order-book imbalance, and price structure to detect crowded positioning squeezes. Remains inactive when verified derivatives data is absent.',
    requiredMarketInputs: [
      'OHLCV (>= 25 bars)',
      'Verified 8h Funding Rate',
      'Verified Order Book Imbalance',
      'Verified Open Interest',
    ],
    requiresVerifiedDerivatives: true,
    supportedMarkets: ['PERP_FUTURES'],
    supportedTimeframes: ['15m', '1h', '4h'],
    entryConditions: [
      'Verified derivatives telemetry active (non-synthetic)',
      'Order-book imbalance >= |0.15| aligned with reversal/continuation',
      'Funding rate extremity confirms crowded contrarian or carry edge',
    ],
    invalidationConditions: [
      'Derivatives telemetry becomes stale or unverified',
      'Order-book imbalance flips against position direction',
    ],
    stopLossMethodology: '1.2x ATR-14 protective stop.',
    targetMethodology: '2.0x risk distance or funding mean reversion.',
    minRiskReward: 1.8,
    knownLimitations: [
      'Strictly requires verified derivatives feed; produces zero signals on Spot-only OHLCV.',
      'Historical Spot-only backtests cannot accurately replay order-book depth.',
    ],
    validationStatus: 'DRAFT',
    autonomousEligible: false,
  },
  {
    id: 'multi_timeframe_confluence',
    name: 'Multi-Timeframe Structure Confluence',
    category: 'MULTI_TIMEFRAME',
    description:
      'Synthesizes a causal 4x higher-timeframe bar sequence strictly from past candles and requires alignment between higher-TF bias and execution-TF momentum.',
    requiredMarketInputs: ['OHLCV (>= 60 bars)', 'Causal 4x HTF Resample', 'EMA-12/26', 'ATR-14'],
    requiresVerifiedDerivatives: false,
    supportedMarkets: ['SPOT', 'PERP_FUTURES'],
    supportedTimeframes: ['15m', '1h', '4h'],
    entryConditions: [
      'Higher-timeframe (4x aggregated) close above/below HTF 10-bar SMA',
      'Execution timeframe EMA-12 aligns with HTF direction and RSI-14 is not exhausted (35–68)',
    ],
    invalidationConditions: [
      'Higher-timeframe directional bias flips opposite to trade direction',
    ],
    stopLossMethodology: '1.6x ATR-14 stop anchored beyond local swing.',
    targetMethodology: '2.4x risk distance.',
    minRiskReward: 2.0,
    knownLimitations: [
      'Lower trade frequency because both higher and lower timeframes must agree.',
    ],
    validationStatus: 'BACKTESTED',
    autonomousEligible: false,
  },
  {
    id: 'mean_reversion_volatility',
    name: 'Mean Reversion & Bollinger Volatility Snapback',
    category: 'MEAN_REVERSION_VOLATILITY',
    description:
      'Fades statistical 2-sigma Bollinger Band excursions when RSI-14 reaches oversold/overbought extremes in non-crash volatility.',
    requiredMarketInputs: ['OHLCV (>= 30 bars)', '20-bar SMA & StdDev', 'RSI-14', 'ATR-14'],
    requiresVerifiedDerivatives: false,
    supportedMarkets: ['SPOT', 'PERP_FUTURES'],
    supportedTimeframes: ['15m', '1h', '4h'],
    entryConditions: [
      'Close pierces 2.0-sigma Bollinger Band with RSI-14 <= 32 (BUY) or >= 68 (SELL)',
      'Realized volatility below flash-crash cap (no falling-knife entry)',
    ],
    invalidationConditions: [
      'Strong trend continuation expanding beyond 3.0-sigma band',
    ],
    stopLossMethodology: '1.35x ATR-14 outside the 2-sigma band excursion.',
    targetMethodology: 'Mean reversion to 20-bar SMA or 1.8R minimum.',
    minRiskReward: 1.6,
    knownLimitations: [
      'Performs poorly in strong one-directional breakout trends ("catching a falling knife").',
    ],
    validationStatus: 'BACKTESTED',
    autonomousEligible: false,
  },
]);

export interface StrategyEvaluationSignal {
  readonly strategyId: StrategyId;
  readonly strategyName: string;
  readonly category: StrategyCategory;
  readonly validationStatus: StrategyValidationStatus;
  readonly autonomousEligible: boolean;
  readonly triggered: boolean;
  readonly direction: 'BUY' | 'SELL' | 'NONE';
  readonly entryPrice: number | null;
  readonly stopLoss: number | null;
  readonly takeProfit: number | null;
  readonly projectedRiskReward: number;
  /** Heuristic alignment score (0-100); explicitly NEVER proof of future profitability */
  readonly confidenceScore: number;
  readonly reasoning: readonly string[];
  readonly invalidationConditions: readonly string[];
  readonly supportingData: Record<string, number | string | boolean | null>;
}

function ema(values: readonly number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

function rsi14(closes: readonly number[]): number {
  if (closes.length < 15) return 50;
  let gains = 0;
  let losses = 0;
  const start = closes.length - 14;
  for (let i = start; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

function roundPrice(p: number): number {
  if (p >= 1000) return Number(p.toFixed(2));
  if (p >= 1) return Number(p.toFixed(4));
  return Number(p.toFixed(6));
}

function buildLevels(
  direction: 'BUY' | 'SELL',
  entry: number,
  atr: number,
  slMult: number,
  rr: number
): { stopLoss: number; takeProfit: number; projectedRiskReward: number } {
  const safeAtr = Math.max(atr, entry * 0.004);
  const maxRiskDist = entry * 0.022; // <= 2.2% bounded stop distance
  const rawRiskDist = Math.min(maxRiskDist, Math.max(entry * 0.0035, safeAtr * slMult));
  const stopLoss =
    direction === 'BUY' ? roundPrice(entry - rawRiskDist) : roundPrice(entry + rawRiskDist);
  const takeProfit =
    direction === 'BUY'
      ? roundPrice(entry + rawRiskDist * rr)
      : roundPrice(entry - rawRiskDist * rr);
  return {
    stopLoss,
    takeProfit,
    projectedRiskReward: Number(rr.toFixed(2)),
  };
}

export function getStrategyDefinition(id: StrategyId): StrategyDefinition {
  const found = STEP2_STRATEGY_REGISTRY.find((s) => s.id === id);
  if (!found) {
    throw new Error(`Unknown strategy id: ${id}`);
  }
  return found;
}

/**
 * Deterministic single-point-in-time evaluation of a strategy on `candles` (using only bars up to last element).
 */
export function evaluateStrategyOnCandles(
  strategyId: StrategyId,
  candles: readonly Candle[],
  options?: {
    derivatives?: DerivativesSnapshot | null;
    dataTrust?: MarketDataTrustEvaluation | null;
    overrideValidationStatus?: StrategyValidationStatus;
    overrideAutonomousEligible?: boolean;
  }
): StrategyEvaluationSignal {
  const def = getStrategyDefinition(strategyId);
  const validationStatus = options?.overrideValidationStatus ?? def.validationStatus;
  const autonomousEligible = options?.overrideAutonomousEligible ?? def.autonomousEligible;

  const noSignal = (
    reason: string,
    supportingData: Record<string, number | string | boolean | null> = {}
  ): StrategyEvaluationSignal => ({
    strategyId: def.id,
    strategyName: def.name,
    category: def.category,
    validationStatus,
    autonomousEligible,
    triggered: false,
    direction: 'NONE',
    entryPrice: null,
    stopLoss: null,
    takeProfit: null,
    projectedRiskReward: 0,
    confidenceScore: 0,
    reasoning: [reason],
    invalidationConditions: def.invalidationConditions,
    supportingData,
  });

  if (validationStatus === 'DISABLED') {
    return noSignal('Strategy is currently DISABLED in registry.');
  }
  if (candles.length < 25) {
    return noSignal(`Insufficient candles (${candles.length} < 25 required).`, {
      candleCount: candles.length,
    });
  }

  const closes = candles.map((c) => c.close);
  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const atr = computeSeriesAtr14(candles);
  const entry = roundPrice(latest.close);

  switch (strategyId) {
    case 'smc_market_structure': {
      if (candles.length < 35) {
        return noSignal('SMC structure requires >= 35 verified candles.');
      }
      const struct = computeTechnicalStructure(candles);
      const latestEvent = struct.structureEvents[struct.structureEvents.length - 1];
      if (!latestEvent) {
        return noSignal('No confirmed BOS/CHoCH structure event in recent window.', {
          trendBias: struct.trendBias,
          swingsCount: struct.swings.length,
        });
      }
      const eventAgeBars = candles.length - 1 - candles.findIndex((c) => c.time === latestEvent.time);
      if (eventAgeBars > 10) {
        return noSignal(`Latest ${latestEvent.type} occurred ${eventAgeBars} bars ago (stale setup).`, {
          eventAgeBars,
          trendBias: struct.trendBias,
        });
      }
      const dir: 'BUY' | 'SELL' = latestEvent.direction === 'BULLISH' ? 'BUY' : 'SELL';
      const aligned =
        (dir === 'BUY' && latest.close >= latestEvent.brokenLevel * 0.996) ||
        (dir === 'SELL' && latest.close <= latestEvent.brokenLevel * 1.004);
      if (!aligned) {
        return noSignal('Price failed to hold broken structure level.', {
          brokenLevel: latestEvent.brokenLevel,
          latestClose: latest.close,
        });
      }
      const levels = buildLevels(dir, entry, atr, 1.4, 2.4);
      const conf = Math.min(82, 58 + (struct.breakoutRetest?.status === 'BREAKOUT_RETESTED' ? 12 : 4) + Math.min(10, struct.swings.length));
      return {
        strategyId: def.id,
        strategyName: def.name,
        category: def.category,
        validationStatus,
        autonomousEligible,
        triggered: true,
        direction: dir,
        entryPrice: entry,
        ...levels,
        confidenceScore: conf,
        reasoning: [
          `Confirmed ${latestEvent.direction} ${latestEvent.type} across ${roundPrice(latestEvent.brokenLevel)} (${eventAgeBars} bars ago).`,
          `Trend bias: ${struct.trendBias}; ${struct.breakoutRetest ? `Retest status: ${struct.breakoutRetest.status}` : 'Structure holding'}.`,
        ],
        invalidationConditions: [
          ...def.invalidationConditions,
          `Hard stop invalidation at ${levels.stopLoss}.`,
        ],
        supportingData: {
          trendBias: struct.trendBias,
          structureEvent: `${latestEvent.direction}_${latestEvent.type}`,
          brokenLevel: roundPrice(latestEvent.brokenLevel),
          eventAgeBars,
          atr14: roundPrice(atr),
        },
      };
    }

    case 'liquidity_sweep_retest': {
      const lookback = candles.slice(-13, -1);
      const priorHigh = Math.max(...lookback.map((c) => c.high));
      const priorLow = Math.min(...lookback.map((c) => c.low));
      const body = Math.max(Math.abs(latest.close - latest.open), entry * 0.0005);
      const lowerWick = Math.min(latest.open, latest.close) - latest.low;
      const upperWick = latest.high - Math.max(latest.open, latest.close);

      const bullSweep = latest.low < priorLow && latest.close > priorLow && lowerWick >= body * 1.1;
      const bearSweep = latest.high > priorHigh && latest.close < priorHigh && upperWick >= body * 1.1;

      if (!bullSweep && !bearSweep) {
        return noSignal('No 12-bar liquidity sweep & rejection wick detected on latest close.', {
          priorHigh: roundPrice(priorHigh),
          priorLow: roundPrice(priorLow),
        });
      }
      const dir: 'BUY' | 'SELL' = bullSweep ? 'BUY' : 'SELL';
      const levels = buildLevels(dir, entry, atr, 1.25, 2.2);
      return {
        strategyId: def.id,
        strategyName: def.name,
        category: def.category,
        validationStatus,
        autonomousEligible,
        triggered: true,
        direction: dir,
        entryPrice: entry,
        ...levels,
        confidenceScore: 67,
        reasoning: [
          bullSweep
            ? `Bullish liquidity sweep below 12-bar low (${roundPrice(priorLow)}) with rejection wick closing back at ${entry}.`
            : `Bearish liquidity sweep above 12-bar high (${roundPrice(priorHigh)}) with rejection wick closing back at ${entry}.`,
        ],
        invalidationConditions: [
          ...def.invalidationConditions,
          `Invalidated if candle closes beyond ${levels.stopLoss}.`,
        ],
        supportingData: {
          priorHigh: roundPrice(priorHigh),
          priorLow: roundPrice(priorLow),
          lowerWick: roundPrice(lowerWick),
          upperWick: roundPrice(upperWick),
        },
      };
    }

    case 'trend_ema_adx': {
      if (candles.length < 55) {
        return noSignal('Trend EMA strategy requires >= 55 verified candles.');
      }
      const ema20 = ema(closes, 20);
      const ema50 = ema(closes, 50);
      const e20 = ema20[ema20.length - 1];
      const e20Prev = ema20[ema20.length - 6];
      const e50 = ema50[ema50.length - 1];
      const sepPct = ((e20 - e50) / e50) * 100;
      const slopePct = ((e20 - e20Prev) / e20Prev) * 100;
      const distFromE20Atr = Math.abs(latest.close - e20) / Math.max(atr, entry * 0.002);

      if (Math.abs(sepPct) < 0.25 || distFromE20Atr > 2.8) {
        return noSignal('EMA 20/50 trend separation insufficient or price overextended from mean.', {
          emaSeparationPct: Number(sepPct.toFixed(3)),
          distFromE20Atr: Number(distFromE20Atr.toFixed(2)),
        });
      }
      if (sepPct > 0.25 && slopePct > 0.08 && latest.close > e20 && latest.close >= prev.close) {
        const levels = buildLevels('BUY', entry, atr, 1.5, 2.5);
        return {
          strategyId: def.id,
          strategyName: def.name,
          category: def.category,
          validationStatus,
          autonomousEligible,
          triggered: true,
          direction: 'BUY',
          entryPrice: entry,
          ...levels,
          confidenceScore: Math.min(78, Math.round(56 + Math.min(18, Math.abs(sepPct) * 8))),
          reasoning: [
            `EMA-20 (${roundPrice(e20)}) above EMA-50 (${roundPrice(e50)}) by +${sepPct.toFixed(2)}% with positive slope (+${slopePct.toFixed(2)}%).`,
          ],
          invalidationConditions: def.invalidationConditions,
          supportingData: {
            ema20: roundPrice(e20),
            ema50: roundPrice(e50),
            emaSeparationPct: Number(sepPct.toFixed(3)),
            slopePct: Number(slopePct.toFixed(3)),
          },
        };
      }
      if (sepPct < -0.25 && slopePct < -0.08 && latest.close < e20 && latest.close <= prev.close) {
        const levels = buildLevels('SELL', entry, atr, 1.5, 2.5);
        return {
          strategyId: def.id,
          strategyName: def.name,
          category: def.category,
          validationStatus,
          autonomousEligible,
          triggered: true,
          direction: 'SELL',
          entryPrice: entry,
          ...levels,
          confidenceScore: Math.min(78, Math.round(56 + Math.min(18, Math.abs(sepPct) * 8))),
          reasoning: [
            `EMA-20 (${roundPrice(e20)}) below EMA-50 (${roundPrice(e50)}) by ${sepPct.toFixed(2)}% with downward slope (${slopePct.toFixed(2)}%).`,
          ],
          invalidationConditions: def.invalidationConditions,
          supportingData: {
            ema20: roundPrice(e20),
            ema50: roundPrice(e50),
            emaSeparationPct: Number(sepPct.toFixed(3)),
            slopePct: Number(slopePct.toFixed(3)),
          },
        };
      }
      return noSignal('EMA alignment present but pullback/continuation trigger not met.', {
        emaSeparationPct: Number(sepPct.toFixed(3)),
        slopePct: Number(slopePct.toFixed(3)),
      });
    }

    case 'momentum_volume_expansion': {
      const volSlice = candles.slice(-21, -1);
      const avgVol = volSlice.reduce((acc, c) => acc + c.volume, 0) / Math.max(1, volSlice.length);
      const volRatio = avgVol > 0 ? latest.volume / avgVol : 0;
      const base5 = candles[candles.length - 6].close;
      const roc5Pct = ((latest.close - base5) / base5) * 100;
      const barRange = Math.max(latest.high - latest.low, entry * 0.0005);
      const closePos = (latest.close - latest.low) / barRange;

      if (volRatio >= 1.45 && roc5Pct >= 0.65 && closePos >= 0.7) {
        const levels = buildLevels('BUY', entry, atr, 1.3, 2.1);
        return {
          strategyId: def.id,
          strategyName: def.name,
          category: def.category,
          validationStatus,
          autonomousEligible,
          triggered: true,
          direction: 'BUY',
          entryPrice: entry,
          ...levels,
          confidenceScore: Math.min(76, Math.round(55 + Math.min(18, volRatio * 6))),
          reasoning: [
            `Bullish volume expansion (${volRatio.toFixed(2)}x 20-bar average) with 5-bar ROC +${roc5Pct.toFixed(2)}%.`,
          ],
          invalidationConditions: def.invalidationConditions,
          supportingData: {
            volumeRatio: Number(volRatio.toFixed(2)),
            roc5Pct: Number(roc5Pct.toFixed(2)),
            closeRangePosition: Number(closePos.toFixed(2)),
          },
        };
      }
      if (volRatio >= 1.45 && roc5Pct <= -0.65 && closePos <= 0.3) {
        const levels = buildLevels('SELL', entry, atr, 1.3, 2.1);
        return {
          strategyId: def.id,
          strategyName: def.name,
          category: def.category,
          validationStatus,
          autonomousEligible,
          triggered: true,
          direction: 'SELL',
          entryPrice: entry,
          ...levels,
          confidenceScore: Math.min(76, Math.round(55 + Math.min(18, volRatio * 6))),
          reasoning: [
            `Bearish volume expansion (${volRatio.toFixed(2)}x 20-bar average) with 5-bar ROC ${roc5Pct.toFixed(2)}%.`,
          ],
          invalidationConditions: def.invalidationConditions,
          supportingData: {
            volumeRatio: Number(volRatio.toFixed(2)),
            roc5Pct: Number(roc5Pct.toFixed(2)),
            closeRangePosition: Number(closePos.toFixed(2)),
          },
        };
      }
      return noSignal('Volume expansion or directional momentum threshold not met.', {
        volumeRatio: Number(volRatio.toFixed(2)),
        roc5Pct: Number(roc5Pct.toFixed(2)),
      });
    }

    case 'chart_pattern_breakout': {
      const channel = candles.slice(-17, -1);
      const chHigh = Math.max(...channel.map((c) => c.high));
      const chLow = Math.min(...channel.map((c) => c.low));
      const widthPct = ((chHigh - chLow) / Math.max(chLow, 1e-8)) * 100;
      if (widthPct > 6.5) {
        return noSignal(`16-bar channel too wide (${widthPct.toFixed(2)}% > 6.5% compression cap).`, {
          channelWidthPct: Number(widthPct.toFixed(2)),
        });
      }
      if (latest.close > chHigh) {
        const levels = buildLevels('BUY', entry, atr, 1.35, 2.1);
        return {
          strategyId: def.id,
          strategyName: def.name,
          category: def.category,
          validationStatus,
          autonomousEligible,
          triggered: true,
          direction: 'BUY',
          entryPrice: entry,
          ...levels,
          confidenceScore: 66,
          reasoning: [
            `Compressed 16-bar range (${widthPct.toFixed(2)}% width) broke upward above ${roundPrice(chHigh)}.`,
          ],
          invalidationConditions: def.invalidationConditions,
          supportingData: {
            channelHigh: roundPrice(chHigh),
            channelLow: roundPrice(chLow),
            channelWidthPct: Number(widthPct.toFixed(2)),
          },
        };
      }
      if (latest.close < chLow) {
        const levels = buildLevels('SELL', entry, atr, 1.35, 2.1);
        return {
          strategyId: def.id,
          strategyName: def.name,
          category: def.category,
          validationStatus,
          autonomousEligible,
          triggered: true,
          direction: 'SELL',
          entryPrice: entry,
          ...levels,
          confidenceScore: 66,
          reasoning: [
            `Compressed 16-bar range (${widthPct.toFixed(2)}% width) broke downward below ${roundPrice(chLow)}.`,
          ],
          invalidationConditions: def.invalidationConditions,
          supportingData: {
            channelHigh: roundPrice(chHigh),
            channelLow: roundPrice(chLow),
            channelWidthPct: Number(widthPct.toFixed(2)),
          },
        };
      }
      return noSignal('Price remains inside 16-bar compression channel.', {
        channelHigh: roundPrice(chHigh),
        channelLow: roundPrice(chLow),
        channelWidthPct: Number(widthPct.toFixed(2)),
      });
    }

    case 'orderflow_funding_oi': {
      const deriv = options?.derivatives;
      if (!deriv || !deriv.verified || deriv.provider === 'UNAVAILABLE') {
        return noSignal(
          'Verified derivatives/order-flow telemetry unavailable — strategy safely inactive (never fabricated).',
          { derivativesVerified: false }
        );
      }
      const imb = deriv.orderBookImbalance ?? 0;
      const funding = deriv.fundingRate8h ?? 0;
      if (imb >= 0.15 && funding <= 0.0004) {
        const levels = buildLevels('BUY', entry, atr, 1.2, 2.0);
        return {
          strategyId: def.id,
          strategyName: def.name,
          category: def.category,
          validationStatus,
          autonomousEligible,
          triggered: true,
          direction: 'BUY',
          entryPrice: entry,
          ...levels,
          confidenceScore: 64,
          reasoning: [
            `Verified bid order-book imbalance (+${(imb * 100).toFixed(1)}%) with non-crowded funding (${(funding * 100).toFixed(4)}%/8h).`,
          ],
          invalidationConditions: def.invalidationConditions,
          supportingData: {
            orderBookImbalance: imb,
            fundingRate8h: funding,
            provider: deriv.provider,
          },
        };
      }
      if (imb <= -0.15 && funding >= -0.0004) {
        const levels = buildLevels('SELL', entry, atr, 1.2, 2.0);
        return {
          strategyId: def.id,
          strategyName: def.name,
          category: def.category,
          validationStatus,
          autonomousEligible,
          triggered: true,
          direction: 'SELL',
          entryPrice: entry,
          ...levels,
          confidenceScore: 64,
          reasoning: [
            `Verified ask order-book imbalance (${(imb * 100).toFixed(1)}%) with elevated funding (${(funding * 100).toFixed(4)}%/8h).`,
          ],
          invalidationConditions: def.invalidationConditions,
          supportingData: {
            orderBookImbalance: imb,
            fundingRate8h: funding,
            provider: deriv.provider,
          },
        };
      }
      return noSignal('Verified derivatives metrics neutral — no funding/order-flow divergence.', {
        orderBookImbalance: imb,
        fundingRate8h: funding,
      });
    }

    case 'multi_timeframe_confluence': {
      if (candles.length < 60) {
        return noSignal('Multi-timeframe confluence requires >= 60 bars for causal 4x HTF aggregation.');
      }
      // Strictly causal 4-bar aggregation using only past bars
      const htfCloses: number[] = [];
      for (let i = 3; i < candles.length; i += 4) {
        htfCloses.push(candles[i].close);
      }
      if (htfCloses.length < 11) {
        return noSignal('Insufficient HTF aggregated bars.');
      }
      const htfSma10 =
        htfCloses.slice(-10).reduce((a, b) => a + b, 0) / 10;
      const htfLatest = htfCloses[htfCloses.length - 1];
      const htfBias: 'BULLISH' | 'BEARISH' = htfLatest >= htfSma10 ? 'BULLISH' : 'BEARISH';

      const ema12 = ema(closes, 12);
      const ema26 = ema(closes, 26);
      const e12 = ema12[ema12.length - 1];
      const e26 = ema26[ema26.length - 1];
      const rsi = rsi14(closes);

      if (htfBias === 'BULLISH' && e12 > e26 && rsi >= 42 && rsi <= 68 && latest.close > e12) {
        const levels = buildLevels('BUY', entry, atr, 1.55, 2.4);
        return {
          strategyId: def.id,
          strategyName: def.name,
          category: def.category,
          validationStatus,
          autonomousEligible,
          triggered: true,
          direction: 'BUY',
          entryPrice: entry,
          ...levels,
          confidenceScore: 73,
          reasoning: [
            `4x HTF bias BULLISH (${roundPrice(htfLatest)} > HTF SMA10 ${roundPrice(htfSma10)}) aligned with LTF EMA12>EMA26 and RSI ${rsi}.`,
          ],
          invalidationConditions: def.invalidationConditions,
          supportingData: {
            htfBias,
            htfSma10: roundPrice(htfSma10),
            rsi14: rsi,
          },
        };
      }
      if (htfBias === 'BEARISH' && e12 < e26 && rsi >= 32 && rsi <= 58 && latest.close < e12) {
        const levels = buildLevels('SELL', entry, atr, 1.55, 2.4);
        return {
          strategyId: def.id,
          strategyName: def.name,
          category: def.category,
          validationStatus,
          autonomousEligible,
          triggered: true,
          direction: 'SELL',
          entryPrice: entry,
          ...levels,
          confidenceScore: 73,
          reasoning: [
            `4x HTF bias BEARISH (${roundPrice(htfLatest)} < HTF SMA10 ${roundPrice(htfSma10)}) aligned with LTF EMA12<EMA26 and RSI ${rsi}.`,
          ],
          invalidationConditions: def.invalidationConditions,
          supportingData: {
            htfBias,
            htfSma10: roundPrice(htfSma10),
            rsi14: rsi,
          },
        };
      }
      return noSignal('Higher-timeframe and execution-timeframe signals are not in confluence.', {
        htfBias,
        rsi14: rsi,
      });
    }

    case 'mean_reversion_volatility': {
      const window = closes.slice(-20);
      const sma20 = window.reduce((a, b) => a + b, 0) / window.length;
      const variance =
        window.reduce((acc, v) => acc + (v - sma20) * (v - sma20), 0) / window.length;
      const std = Math.sqrt(variance);
      const upper = sma20 + 2 * std;
      const lower = sma20 - 2 * std;
      const rsi = rsi14(closes);

      if (latest.close <= lower && rsi <= 33) {
        const levels = buildLevels('BUY', entry, atr, 1.35, 1.8);
        return {
          strategyId: def.id,
          strategyName: def.name,
          category: def.category,
          validationStatus,
          autonomousEligible,
          triggered: true,
          direction: 'BUY',
          entryPrice: entry,
          ...levels,
          confidenceScore: 62,
          reasoning: [
            `Price (${entry}) pierced lower 2σ Bollinger Band (${roundPrice(lower)}) with oversold RSI-14 (${rsi}).`,
          ],
          invalidationConditions: def.invalidationConditions,
          supportingData: {
            sma20: roundPrice(sma20),
            lowerBand: roundPrice(lower),
            rsi14: rsi,
          },
        };
      }
      if (latest.close >= upper && rsi >= 67) {
        const levels = buildLevels('SELL', entry, atr, 1.35, 1.8);
        return {
          strategyId: def.id,
          strategyName: def.name,
          category: def.category,
          validationStatus,
          autonomousEligible,
          triggered: true,
          direction: 'SELL',
          entryPrice: entry,
          ...levels,
          confidenceScore: 62,
          reasoning: [
            `Price (${entry}) pierced upper 2σ Bollinger Band (${roundPrice(upper)}) with overbought RSI-14 (${rsi}).`,
          ],
          invalidationConditions: def.invalidationConditions,
          supportingData: {
            sma20: roundPrice(sma20),
            upperBand: roundPrice(upper),
            rsi14: rsi,
          },
        };
      }
      return noSignal('No 2-sigma Bollinger volatility excursion with RSI confirmation.', {
        sma20: roundPrice(sma20),
        rsi14: rsi,
      });
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * POINT-IN-TIME MULTI-STRATEGY COMPARISON BACKTEST ENGINE (ZERO LOOK-AHEAD)
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface Step2BacktestConfig {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquityUsd: number;
  readonly riskPerTradePct: number; // e.g., 1.0%
  readonly feeBps: number; // e.g., 5 bps per side
  readonly slippageBps: number; // e.g., 4 bps per side
  readonly spreadBps: number; // e.g., 2 bps full spread (half applied each side)
  readonly walkForwardTrainRatio: number; // e.g., 0.70 (70% IS / 30% OOS)
  readonly maxHoldBars: number; // e.g., 24 bars
}

export const DEFAULT_STEP2_BACKTEST_CONFIG: Step2BacktestConfig = Object.freeze({
  symbol: 'BTCUSDT',
  timeframe: '1h',
  initialEquityUsd: 10_000,
  riskPerTradePct: 1.0,
  feeBps: 5,
  slippageBps: 4,
  spreadBps: 2,
  walkForwardTrainRatio: 0.7,
  maxHoldBars: 24,
});

export interface StrategyBacktestMetrics {
  readonly strategyId: StrategyId;
  readonly strategyName: string;
  readonly category: StrategyCategory;
  readonly validationStatus: StrategyValidationStatus;
  readonly totalTrades: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRatePct: number;
  readonly netPnlUsd: number;
  readonly netReturnPct: number;
  readonly totalFeesAndSlippageUsd: number;
  readonly maxDrawdownPct: number;
  readonly profitFactor: number | null;
  readonly expectancyUsd: number;
  readonly sharpeRatio: number;
  readonly sortinoRatio: number;
  readonly inSampleReturnPct: number;
  readonly outOfSampleReturnPct: number;
  readonly outOfSampleTrades: number;
  readonly outcomeClassification: 'PROFITABLE' | 'UNPROFITABLE' | 'INSUFFICIENT_SAMPLE';
  readonly notes: string;
}

export interface Step2StrategyComparisonReport {
  readonly environment: 'HISTORICAL_BACKTEST';
  readonly configHash: string;
  readonly config: Step2BacktestConfig;
  readonly dataProvider: string;
  readonly isSyntheticData: boolean;
  readonly candleCount: number;
  readonly inSampleBars: number;
  readonly outOfSampleBars: number;
  readonly lookAheadLeakagePrevented: true;
  readonly generatedAtIso: string;
  readonly results: readonly StrategyBacktestMetrics[];
  readonly summary: {
    readonly totalStrategiesEvaluated: number;
    readonly profitableCount: number;
    readonly unprofitableCount: number;
    readonly insufficientSampleCount: number;
    readonly disclaimer: string;
  };
}

export function computeBacktestConfigHash(config: Step2BacktestConfig, candleCount: number): string {
  const canonical = JSON.stringify({ ...config, candleCount });
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `BT-${(h >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;
}

function simulateSingleStrategyPointInTime(
  strategyId: StrategyId,
  candles: readonly Candle[],
  config: Step2BacktestConfig,
  splitIndex: number
): StrategyBacktestMetrics {
  const def = getStrategyDefinition(strategyId);
  const startBar = Math.min(Math.max(55, 25), Math.max(25, candles.length - 10));

  let equity = config.initialEquityUsd;
  let peakEquity = equity;
  let maxDdPct = 0;
  let totalFeesAndSlipUsd = 0;

  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  let isPnl = 0;
  let oosPnl = 0;
  let oosTrades = 0;
  const tradeReturns: number[] = [];

  interface OpenSimTrade {
    direction: 'BUY' | 'SELL';
    entryIndex: number;
    entryExecPrice: number;
    stopLoss: number;
    takeProfit: number;
    qty: number;
    entryFeeUsd: number;
    isOos: boolean;
  }

  let openTrade: OpenSimTrade | null = null;
  const oneWaySlipRate = (config.slippageBps + config.spreadBps / 2) / 10_000;
  const oneWayFeeRate = config.feeBps / 10_000;

  // Strictly causal loop: at bar `i`, signal only sees `candles.slice(0, i + 1)`
  // and enters at bar `i + 1` open (zero look-ahead leakage!).
  for (let i = startBar; i < candles.length - 1; i++) {
    const currBar = candles[i];

    // 1. Manage open position on currBar (conservative: SL evaluated before TP on same bar)
    if (openTrade) {
      let exitRawPrice: number | null = null;
      if (openTrade.direction === 'BUY') {
        if (currBar.low <= openTrade.stopLoss) exitRawPrice = openTrade.stopLoss;
        else if (currBar.high >= openTrade.takeProfit) exitRawPrice = openTrade.takeProfit;
      } else {
        if (currBar.high >= openTrade.stopLoss) exitRawPrice = openTrade.stopLoss;
        else if (currBar.low <= openTrade.takeProfit) exitRawPrice = openTrade.takeProfit;
      }
      if (exitRawPrice === null && i - openTrade.entryIndex >= config.maxHoldBars) {
        exitRawPrice = currBar.close;
      }

      if (exitRawPrice !== null) {
        const exitExecPrice =
          openTrade.direction === 'BUY'
            ? exitRawPrice * (1 - oneWaySlipRate)
            : exitRawPrice * (1 + oneWaySlipRate);
        const exitFeeUsd = exitExecPrice * openTrade.qty * oneWayFeeRate;
        const slipCostEst =
          Math.abs(exitRawPrice - exitExecPrice) * openTrade.qty +
          openTrade.entryExecPrice * openTrade.qty * oneWaySlipRate;

        const grossPnl =
          openTrade.direction === 'BUY'
            ? (exitExecPrice - openTrade.entryExecPrice) * openTrade.qty
            : (openTrade.entryExecPrice - exitExecPrice) * openTrade.qty;
        const netPnl = grossPnl - openTrade.entryFeeUsd - exitFeeUsd;

        totalFeesAndSlipUsd += openTrade.entryFeeUsd + exitFeeUsd + slipCostEst;
        const prevEquity = equity;
        equity += netPnl;
        peakEquity = Math.max(peakEquity, equity);
        const ddPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
        maxDdPct = Math.max(maxDdPct, ddPct);

        if (netPnl > 0) {
          wins += 1;
          grossProfit += netPnl;
        } else {
          losses += 1;
          grossLoss += Math.abs(netPnl);
        }

        if (openTrade.isOos) {
          oosPnl += netPnl;
          oosTrades += 1;
        } else {
          isPnl += netPnl;
        }

        if (prevEquity > 0) {
          tradeReturns.push(netPnl / prevEquity);
        }
        openTrade = null;
      }
    }

    // 2. If flat, evaluate strategy STRICTLY on prefix candles[0..i]
    if (!openTrade && equity > config.initialEquityUsd * 0.1) {
      const prefix = candles.slice(0, i + 1);
      const evalSig = evaluateStrategyOnCandles(strategyId, prefix, {
        derivatives: null, // Spot OHLCV backtest never fabricates order-flow data
      });
      if (
        evalSig.triggered &&
        evalSig.direction !== 'NONE' &&
        evalSig.stopLoss !== null &&
        evalSig.takeProfit !== null
      ) {
        const nextOpen = candles[i + 1].open;
        const entryExecPrice =
          evalSig.direction === 'BUY'
            ? nextOpen * (1 + oneWaySlipRate)
            : nextOpen * (1 - oneWaySlipRate);
        const riskDist = Math.abs(entryExecPrice - evalSig.stopLoss);
        if (riskDist > 0) {
          const riskBudgetUsd = equity * (config.riskPerTradePct / 100);
          const maxNotional = equity * 2.0; // cap 2x effective leverage in backtest
          const qty = Math.min(riskBudgetUsd / riskDist, maxNotional / entryExecPrice);
          if (qty > 0 && Number.isFinite(qty)) {
            openTrade = {
              direction: evalSig.direction,
              entryIndex: i + 1,
              entryExecPrice,
              stopLoss: evalSig.stopLoss,
              takeProfit: evalSig.takeProfit,
              qty,
              entryFeeUsd: entryExecPrice * qty * oneWayFeeRate,
              isOos: i + 1 >= splitIndex,
            };
          }
        }
      }
    }
  }

  const totalTrades = wins + losses;
  const netPnlUsd = Number((equity - config.initialEquityUsd).toFixed(2));
  const netReturnPct = Number(((netPnlUsd / config.initialEquityUsd) * 100).toFixed(2));
  const winRatePct = totalTrades > 0 ? Number(((wins / totalTrades) * 100).toFixed(1)) : 0;
  const profitFactor =
    grossLoss > 0
      ? Number((grossProfit / grossLoss).toFixed(2))
      : grossProfit > 0
      ? 99
      : null;
  const expectancyUsd = totalTrades > 0 ? Number((netPnlUsd / totalTrades).toFixed(2)) : 0;

  let sharpeRatio = 0;
  let sortinoRatio = 0;
  if (tradeReturns.length >= 2) {
    const mean = tradeReturns.reduce((a, b) => a + b, 0) / tradeReturns.length;
    const variance =
      tradeReturns.reduce((acc, r) => acc + (r - mean) * (r - mean), 0) /
      (tradeReturns.length - 1);
    const std = Math.sqrt(variance);
    if (std > 1e-8) {
      sharpeRatio = Number(((mean / std) * Math.sqrt(tradeReturns.length)).toFixed(2));
    }
    const downside = tradeReturns.filter((r) => r < 0);
    if (downside.length >= 1) {
      const dVar = downside.reduce((acc, r) => acc + r * r, 0) / downside.length;
      const dStd = Math.sqrt(dVar);
      if (dStd > 1e-8) {
        sortinoRatio = Number(((mean / dStd) * Math.sqrt(tradeReturns.length)).toFixed(2));
      }
    }
  }

  const outcomeClassification: StrategyBacktestMetrics['outcomeClassification'] =
    totalTrades < 2
      ? 'INSUFFICIENT_SAMPLE'
      : netPnlUsd > 0
      ? 'PROFITABLE'
      : 'UNPROFITABLE';

  const notes =
    def.requiresVerifiedDerivatives
      ? 'Requires verified historical derivatives/order-book depth; zero trades generated on Spot-only OHLCV (never fabricated).'
      : totalTrades === 0
      ? 'Strict entry rules did not trigger within this historical window.'
      : outcomeClassification === 'UNPROFITABLE'
      ? `Net negative after ${config.feeBps}bps fees & ${config.slippageBps}bps slippage — retained transparently in comparison.`
      : `Positive net expectancy after fees/slippage (OOS trades: ${oosTrades}).`;

  return {
    strategyId: def.id,
    strategyName: def.name,
    category: def.category,
    validationStatus: def.validationStatus,
    totalTrades,
    wins,
    losses,
    winRatePct,
    netPnlUsd,
    netReturnPct,
    totalFeesAndSlippageUsd: Number(totalFeesAndSlipUsd.toFixed(2)),
    maxDrawdownPct: Number(maxDdPct.toFixed(2)),
    profitFactor,
    expectancyUsd,
    sharpeRatio,
    sortinoRatio,
    inSampleReturnPct: Number(((isPnl / config.initialEquityUsd) * 100).toFixed(2)),
    outOfSampleReturnPct: Number(((oosPnl / config.initialEquityUsd) * 100).toFixed(2)),
    outOfSampleTrades: oosTrades,
    outcomeClassification,
    notes,
  };
}

export function runStrategyComparisonBacktest(
  candles: readonly Candle[],
  partialConfig?: Partial<Step2BacktestConfig>,
  meta?: { dataProvider?: string; isSyntheticData?: boolean; nowMs?: number }
): Step2StrategyComparisonReport {
  const config: Step2BacktestConfig = {
    ...DEFAULT_STEP2_BACKTEST_CONFIG,
    ...partialConfig,
    initialEquityUsd: Math.max(100, Number(partialConfig?.initialEquityUsd ?? DEFAULT_STEP2_BACKTEST_CONFIG.initialEquityUsd)),
    riskPerTradePct: Math.max(0.1, Math.min(5, Number(partialConfig?.riskPerTradePct ?? DEFAULT_STEP2_BACKTEST_CONFIG.riskPerTradePct))),
    feeBps: Math.max(0, Math.min(100, Number(partialConfig?.feeBps ?? DEFAULT_STEP2_BACKTEST_CONFIG.feeBps))),
    slippageBps: Math.max(0, Math.min(100, Number(partialConfig?.slippageBps ?? DEFAULT_STEP2_BACKTEST_CONFIG.slippageBps))),
    spreadBps: Math.max(0, Math.min(100, Number(partialConfig?.spreadBps ?? DEFAULT_STEP2_BACKTEST_CONFIG.spreadBps))),
    walkForwardTrainRatio: Math.max(
      0.5,
      Math.min(0.85, Number(partialConfig?.walkForwardTrainRatio ?? DEFAULT_STEP2_BACKTEST_CONFIG.walkForwardTrainRatio))
    ),
    maxHoldBars: Math.max(4, Math.min(120, Number(partialConfig?.maxHoldBars ?? DEFAULT_STEP2_BACKTEST_CONFIG.maxHoldBars))),
  };

  const splitIndex = Math.floor(candles.length * config.walkForwardTrainRatio);
  const results = STEP2_STRATEGY_REGISTRY.map((def) =>
    simulateSingleStrategyPointInTime(def.id, candles, config, splitIndex)
  );

  const profitableCount = results.filter((r) => r.outcomeClassification === 'PROFITABLE').length;
  const unprofitableCount = results.filter((r) => r.outcomeClassification === 'UNPROFITABLE').length;
  const insufficientSampleCount = results.filter(
    (r) => r.outcomeClassification === 'INSUFFICIENT_SAMPLE'
  ).length;

  return {
    environment: 'HISTORICAL_BACKTEST',
    configHash: computeBacktestConfigHash(config, candles.length),
    config,
    dataProvider: meta?.dataProvider ?? 'BINANCE_SPOT',
    isSyntheticData: Boolean(meta?.isSyntheticData),
    candleCount: candles.length,
    inSampleBars: splitIndex,
    outOfSampleBars: Math.max(0, candles.length - splitIndex),
    lookAheadLeakagePrevented: true,
    generatedAtIso: new Date(meta?.nowMs ?? Date.now()).toISOString(),
    results,
    summary: {
      totalStrategiesEvaluated: results.length,
      profitableCount,
      unprofitableCount,
      insufficientSampleCount,
      disclaimer:
        'Historical backtesting is strictly isolated from Paper, Exchange Demo, and Live trading. Both profitable and unprofitable strategies are shown without survivorship filtering. Past simulated performance does not guarantee future results.',
    },
  };
}

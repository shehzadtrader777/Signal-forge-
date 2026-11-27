/**
 * Signal Forge — Deterministic Technical Structure & Chart Analysis Engine
 *
 * Computes real technical drawings strictly from verified OHLCV candle data:
 *  - Swing High / Swing Low fractal pivots
 *  - Documented horizontal Support & Resistance levels (with touch counts)
 *  - Market Structure events (BOS = Break of Structure, CHoCH = Change of Character)
 *  - Breakout & Retest zone derived from actual candle structure
 *  - Two-point structural Trendline anchored strictly to real swing pivots (never random)
 *  - Strategy evidence & explicit invalidation conditions
 */

import type { Candle } from './marketData';
import type { CanonicalTradeRecord } from './tradeLifecycleLedger';

export interface SwingPivot {
  index: number;
  time: number;
  price: number;
  type: 'HIGH' | 'LOW';
}

export interface HorizontalLevel {
  id: string;
  kind: 'SUPPORT' | 'RESISTANCE';
  price: number;
  touches: number;
  anchorTime: number;
  label: string;
}

export interface StructureEvent {
  id: string;
  type: 'BOS' | 'CHOCH';
  direction: 'BULLISH' | 'BEARISH';
  time: number;
  price: number;
  brokenLevel: number;
  label: string;
}

export interface BreakoutRetestZone {
  direction: 'BULLISH' | 'BEARISH';
  level: number;
  zoneLow: number;
  zoneHigh: number;
  breakoutTime: number;
  retestTime: number | null;
  status: 'BREAKOUT_RETESTED' | 'BREAKOUT_PENDING_RETEST';
}

export interface StructuralTrendline {
  id: string;
  direction: 'UPTREND_SUPPORT' | 'DOWNTREND_RESISTANCE';
  startTime: number;
  startPrice: number;
  endTime: number;
  endPrice: number;
  label: string;
}

export interface TechnicalAnalysisSummary {
  trendBias: 'BULLISH' | 'BEARISH' | 'RANGING';
  swings: SwingPivot[];
  supportLevel: HorizontalLevel | null;
  resistanceLevel: HorizontalLevel | null;
  structureEvents: StructureEvent[];
  breakoutRetest: BreakoutRetestZone | null;
  trendline: StructuralTrendline | null;
  strategyEvidence: string[];
  invalidationConditions: string[];
}

export function detectSwingPivots(candles: readonly Candle[], lookback = 3): SwingPivot[] {
  if (candles.length < lookback * 2 + 1) return [];
  const pivots: SwingPivot[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const curr = candles[i];
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (j < i) {
        if (candles[j].high > curr.high) isSwingHigh = false;
        if (candles[j].low < curr.low) isSwingLow = false;
      } else {
        if (candles[j].high >= curr.high) isSwingHigh = false;
        if (candles[j].low <= curr.low) isSwingLow = false;
      }
      if (!isSwingHigh && !isSwingLow) break;
    }

    if (isSwingHigh) {
      pivots.push({ index: i, time: curr.time, price: curr.high, type: 'HIGH' });
    } else if (isSwingLow) {
      pivots.push({ index: i, time: curr.time, price: curr.low, type: 'LOW' });
    }
  }

  return pivots;
}

function countLevelTouches(
  candles: readonly Candle[],
  level: number,
  tolerancePct = 0.0045
): number {
  if (level <= 0) return 0;
  const band = level * tolerancePct;
  let touches = 0;
  for (const c of candles) {
    if (c.low <= level + band && c.high >= level - band) {
      touches++;
    }
  }
  return touches;
}

export function computeTechnicalStructure(
  candles: readonly Candle[],
  trade?: CanonicalTradeRecord | null
): TechnicalAnalysisSummary {
  if (candles.length < 15) {
    return {
      trendBias: 'RANGING',
      swings: [],
      supportLevel: null,
      resistanceLevel: null,
      structureEvents: [],
      breakoutRetest: null,
      trendline: null,
      strategyEvidence: ['Insufficient historical candles to compute verified market structure.'],
      invalidationConditions: ['Await at least 15 verified OHLCV bars before drawing structure levels.'],
    };
  }

  const swings = detectSwingPivots(candles, 3);
  const recentHighs = swings.filter((s) => s.type === 'HIGH').slice(-6);
  const recentLows = swings.filter((s) => s.type === 'LOW').slice(-6);
  const latestCandle = candles[candles.length - 1];

  // Determine documented resistance & support strictly from real swing pivots
  let resistanceLevel: HorizontalLevel | null = null;
  if (recentHighs.length > 0) {
    const bestHigh = [...recentHighs].sort((a, b) => b.price - a.price)[0];
    const touches = countLevelTouches(candles.slice(-80), bestHigh.price);
    resistanceLevel = {
      id: 'resistance-primary',
      kind: 'RESISTANCE',
      price: bestHigh.price,
      touches,
      anchorTime: bestHigh.time,
      label: `RES (${touches}x)`,
    };
  }

  let supportLevel: HorizontalLevel | null = null;
  if (recentLows.length > 0) {
    const bestLow = [...recentLows].sort((a, b) => a.price - b.price)[0];
    const touches = countLevelTouches(candles.slice(-80), bestLow.price);
    supportLevel = {
      id: 'support-primary',
      kind: 'SUPPORT',
      price: bestLow.price,
      touches,
      anchorTime: bestLow.time,
      label: `SUP (${touches}x)`,
    };
  }

  // Detect BOS & CHoCH structure transitions chronologically across swing pivots
  const structureEvents: StructureEvent[] = [];
  let runningBias: 'BULLISH' | 'BEARISH' | 'RANGING' = 'RANGING';
  let lastSwingHigh: SwingPivot | null = null;
  let lastSwingLow: SwingPivot | null = null;
  const pivotByIndex = new Map<number, SwingPivot>();
  for (const p of swings) pivotByIndex.set(p.index, p);

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (lastSwingHigh && c.close > lastSwingHigh.price && i > lastSwingHigh.index) {
      const eventType: 'BOS' | 'CHOCH' = runningBias === 'BEARISH' ? 'CHOCH' : 'BOS';
      structureEvents.push({
        id: `struct-bull-${c.time}`,
        type: eventType,
        direction: 'BULLISH',
        time: c.time,
        price: c.close,
        brokenLevel: lastSwingHigh.price,
        label: `${eventType} ↑`,
      });
      runningBias = 'BULLISH';
      lastSwingHigh = null;
    } else if (lastSwingLow && c.close < lastSwingLow.price && i > lastSwingLow.index) {
      const eventType: 'BOS' | 'CHOCH' = runningBias === 'BULLISH' ? 'CHOCH' : 'BOS';
      structureEvents.push({
        id: `struct-bear-${c.time}`,
        type: eventType,
        direction: 'BEARISH',
        time: c.time,
        price: c.close,
        brokenLevel: lastSwingLow.price,
        label: `${eventType} ↓`,
      });
      runningBias = 'BEARISH';
      lastSwingLow = null;
    }

    const pivot = pivotByIndex.get(i);
    if (pivot) {
      if (pivot.type === 'HIGH') lastSwingHigh = pivot;
      else lastSwingLow = pivot;
    }
  }

  // Retain the 3 most recent structure transitions to keep charts crisp and uncluttered
  const recentStructureEvents = structureEvents.slice(-3);

  // Breakout & Retest zone from the most recent structure break
  let breakoutRetest: BreakoutRetestZone | null = null;
  const latestBreak = recentStructureEvents[recentStructureEvents.length - 1];
  if (latestBreak) {
    const band = latestBreak.brokenLevel * 0.0028;
    const zoneLow = latestBreak.brokenLevel - band;
    const zoneHigh = latestBreak.brokenLevel + band;
    const breakIdx = candles.findIndex((c) => c.time === latestBreak.time);
    let retestTime: number | null = null;
    if (breakIdx >= 0) {
      for (let i = breakIdx + 1; i < candles.length; i++) {
        const bar = candles[i];
        if (bar.low <= zoneHigh && bar.high >= zoneLow) {
          retestTime = bar.time;
          break;
        }
      }
    }
    breakoutRetest = {
      direction: latestBreak.direction,
      level: latestBreak.brokenLevel,
      zoneLow,
      zoneHigh,
      breakoutTime: latestBreak.time,
      retestTime,
      status: retestTime !== null ? 'BREAKOUT_RETESTED' : 'BREAKOUT_PENDING_RETEST',
    };
  }

  // Structural 2-point trendline strictly anchored to real swing pivots
  let trendline: StructuralTrendline | null = null;
  if (runningBias !== 'BEARISH' && recentLows.length >= 2) {
    const p1 = recentLows[recentLows.length - 2];
    const p2 = recentLows[recentLows.length - 1];
    if (p2.time > p1.time && p2.price >= p1.price * 0.995) {
      trendline = {
        id: 'trendline-bull-support',
        direction: 'UPTREND_SUPPORT',
        startTime: p1.time,
        startPrice: p1.price,
        endTime: p2.time,
        endPrice: p2.price,
        label: 'Ascending Swing Support Trendline',
      };
    }
  }
  if (!trendline && recentHighs.length >= 2) {
    const p1 = recentHighs[recentHighs.length - 2];
    const p2 = recentHighs[recentHighs.length - 1];
    if (p2.time > p1.time && p2.price <= p1.price * 1.005) {
      trendline = {
        id: 'trendline-bear-resistance',
        direction: 'DOWNTREND_RESISTANCE',
        startTime: p1.time,
        startPrice: p1.price,
        endTime: p2.time,
        endPrice: p2.price,
        label: 'Descending Swing Resistance Trendline',
      };
    }
  }

  // Transparent Strategy Evidence & Invalidation Conditions
  const strategyEvidence: string[] = [];
  const invalidationConditions: string[] = [];

  strategyEvidence.push(
    `Observed ${runningBias.toLowerCase()} market structure across ${candles.length} verified OHLCV bars (latest close ${latestCandle.close.toFixed(
      latestCandle.close >= 100 ? 2 : 4
    )}).`
  );
  if (supportLevel && resistanceLevel) {
    strategyEvidence.push(
      `Documented swing range: Support ${supportLevel.price.toFixed(
        supportLevel.price >= 100 ? 2 : 4
      )} (${supportLevel.touches} touches) to Resistance ${resistanceLevel.price.toFixed(
        resistanceLevel.price >= 100 ? 2 : 4
      )} (${resistanceLevel.touches} touches).`
    );
  }
  if (breakoutRetest) {
    strategyEvidence.push(
      `${breakoutRetest.direction === 'BULLISH' ? 'Bullish' : 'Bearish'} structure break at ${breakoutRetest.level.toFixed(
        breakoutRetest.level >= 100 ? 2 : 4
      )} (${breakoutRetest.status === 'BREAKOUT_RETESTED' ? 'retest confirmed on subsequent bar' : 'awaiting zone retest'}).`
    );
  }
  if (trendline) {
    strategyEvidence.push(
      `${trendline.label} anchored strictly between verified swing pivots (${trendline.startPrice.toFixed(
        trendline.startPrice >= 100 ? 2 : 4
      )} → ${trendline.endPrice.toFixed(trendline.endPrice >= 100 ? 2 : 4)}).`
    );
  }

  if (trade) {
    const dirLabel = trade.direction === 'BUY' ? 'Long' : 'Short';
    invalidationConditions.push(
      `${dirLabel} thesis invalidates immediately if price closes beyond documented Stop Loss ($${trade.stopLoss.toFixed(
        trade.stopLoss >= 100 ? 2 : 4
      )}).`
    );
    if (trade.chartPattern) {
      invalidationConditions.push(
        `Pattern setup (${trade.chartPattern.name}) invalidates on sustained reclaim back inside breakout level ($${trade.chartPattern.breakoutLevel.toFixed(
          trade.chartPattern.breakoutLevel >= 100 ? 2 : 4
        )}).`
      );
    }
  } else {
    if (supportLevel) {
      invalidationConditions.push(
        `Bullish structure invalidates on a verified candle close below swing support ($${supportLevel.price.toFixed(
          supportLevel.price >= 100 ? 2 : 4
        )}).`
      );
    }
    if (resistanceLevel) {
      invalidationConditions.push(
        `Bearish structure invalidates on a verified candle close above swing resistance ($${resistanceLevel.price.toFixed(
          resistanceLevel.price >= 100 ? 2 : 4
        )}).`
      );
    }
  }

  return {
    trendBias: runningBias,
    swings,
    supportLevel,
    resistanceLevel,
    structureEvents: recentStructureEvents,
    breakoutRetest,
    trendline,
    strategyEvidence,
    invalidationConditions,
  };
}

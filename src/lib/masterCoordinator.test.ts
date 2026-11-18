import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MASTER_SIGNAL_FILTERS,
  buildMasterCoordinatorSetups,
  filterMasterCoordinatorSetups,
  summarizeMasterCoordinator,
  type MasterCoordinatorSetup,
} from './masterCoordinator';
import {
  TRACKED_COINS,
  generateDeterministicCandles,
  type Candle,
  type TopGainerCoin,
} from './marketData';

function makeBreakoutCandles(startPrice = 100, bull = true): Candle[] {
  const out: Candle[] = [];
  const baseTime = 1760000000;
  let price = startPrice;
  for (let i = 0; i < 96; i++) {
    const isBreakBar = i >= 94;
    const step = isBreakBar
      ? bull
        ? price * 0.042
        : -price * 0.042
      : Math.sin(i * 0.45) * (startPrice * 0.004);
    const open = Number(price.toFixed(4));
    const close = Number(Math.max(1, open + step).toFixed(4));
    const high = Number((Math.max(open, close) * (isBreakBar ? 1.006 : 1.003)).toFixed(4));
    const low = Number((Math.min(open, close) * (isBreakBar ? 0.996 : 0.997)).toFixed(4));
    const volume = isBreakBar ? 4_500_000 : 1_100_000;
    out.push({
      time: baseTime + i * 14_400,
      open,
      high,
      low,
      close,
      volume,
    });
    price = close;
  }
  return out;
}

describe('Master Coordinator Signal Aggregation & Strict Filtering', () => {
  it('uses >=86% confidence and >=1:2 R:R as strict default thresholds', () => {
    assert.equal(DEFAULT_MASTER_SIGNAL_FILTERS.minConfidence, 86);
    assert.equal(DEFAULT_MASTER_SIGNAL_FILTERS.minRiskReward, 2.0);
    assert.equal(DEFAULT_MASTER_SIGNAL_FILTERS.excludeVetoed, true);
  });

  it('aggregates AI Engine, multi-coin SMC/FRVP, and Breakout/Breakdown Scanners across coins', () => {
    const candlesMap: Record<string, Candle[]> = {};
    for (const coin of TRACKED_COINS.slice(0, 6)) {
      candlesMap[coin.symbol] = generateDeterministicCandles(
        coin.symbol,
        '4h',
        120,
        undefined,
        coin.referencePrice
      );
    }
    candlesMap['SOLUSDT'] = makeBreakoutCandles(180, true);
    candlesMap['AVAXUSDT'] = makeBreakoutCandles(40, false);

    const topGainers: TopGainerCoin[] = [
      {
        symbol: 'SOLUSDT',
        baseAsset: 'SOL',
        name: 'Solana',
        price: candlesMap['SOLUSDT'][95].close,
        change24hPercent: 18.4,
        high24h: candlesMap['SOLUSDT'][95].high,
        low24h: 170,
        volume24hUsd: 820_000_000,
        gainerRank: 1,
        isTopGainer: true,
      },
    ];

    const result = buildMasterCoordinatorSetups({
      candlesMap,
      timeframe: '4h',
      allKnownCoins: TRACKED_COINS.slice(0, 6),
      topGainers,
      evaluationTimeSec: 1760000000 + 13 * 3600, // 13:00 UTC overlap window
    });

    assert.ok(result.allSetups.length > 0, 'Expected evaluated setups across modules');
    assert.ok(
      result.allSetups.some((s) => s.sourceModule === 'SMC_FRVP'),
      'Expected SMC + FRVP setups to be evaluated across coins'
    );
    assert.ok(
      result.allSetups.some((s) => s.sourceModule === 'AI_ENGINE'),
      'Expected AI Engine setups to be evaluated'
    );

    const solSetup = result.allSetups.find((s) => s.symbol === 'SOLUSDT');
    assert.ok(solSetup, 'Expected SOLUSDT setup');
    assert.equal(solSetup.isTopGainer, true);
    assert.equal(solSetup.gainerRank, 1);
    assert.ok(solSetup.frvp && solSetup.frvp.poc > 0, 'Expected embedded FRVP telemetry');
    assert.ok(solSetup.smc && solSetup.smc.sessionLabel.length > 0, 'Expected embedded SMC telemetry');
  });

  it('strictly filters by confidence (>=86%), minimum R:R, move type, direction, and veto gate', () => {
    const basePlan = buildMasterCoordinatorSetups({
      candlesMap: {
        BTCUSDT: generateDeterministicCandles('BTCUSDT', '4h', 120),
      },
      timeframe: '4h',
      allKnownCoins: [TRACKED_COINS[0]],
      evaluationTimeSec: 1760000000 + 13 * 3600,
    }).allSetups[0];

    const makeSetup = (
      id: string,
      overrides: Partial<MasterCoordinatorSetup> & {
        verdict?: 'APPROVED' | 'CAUTION' | 'VETOED';
      }
    ): MasterCoordinatorSetup => ({
      ...basePlan,
      id,
      plan: {
        ...basePlan.plan,
        id,
        confidence: overrides.confidence ?? basePlan.confidence,
        skeptic: {
          ...basePlan.plan.skeptic,
          verdict: overrides.verdict ?? 'APPROVED',
        },
      },
      ...overrides,
    });

    const pool: MasterCoordinatorSetup[] = [
      makeSetup('high_breakout', {
        symbol: 'BTCUSDT',
        sourceModule: 'PATTERN_SCANNER',
        moveType: 'BREAKOUT',
        direction: 'BUY',
        confidence: 91,
        maxRiskReward: 3.4,
        isTopGainer: true,
        gainerRank: 2,
      }),
      makeSetup('below_threshold', {
        symbol: 'ETHUSDT',
        sourceModule: 'AI_ENGINE',
        moveType: 'TREND_MOMENTUM',
        direction: 'BUY',
        confidence: 85,
        maxRiskReward: 3.1,
      }),
      makeSetup('low_rr', {
        symbol: 'SOLUSDT',
        sourceModule: 'SMC_FRVP',
        moveType: 'SMC_STRUCTURE',
        direction: 'BUY',
        confidence: 93,
        maxRiskReward: 1.6,
      }),
      makeSetup('high_breakdown', {
        symbol: 'XRPUSDT',
        sourceModule: 'PATTERN_SCANNER',
        moveType: 'BREAKDOWN',
        direction: 'SELL',
        confidence: 88,
        maxRiskReward: 2.8,
        isTopGainer: false,
        gainerRank: null,
      }),
      makeSetup('vetoed_high', {
        symbol: 'ADAUSDT',
        sourceModule: 'AI_ENGINE',
        moveType: 'BREAKOUT',
        direction: 'BUY',
        confidence: 94,
        maxRiskReward: 4.0,
        verdict: 'VETOED',
      }),
    ];

    const defaultQualified = filterMasterCoordinatorSetups(pool, DEFAULT_MASTER_SIGNAL_FILTERS);
    assert.deepEqual(
      defaultQualified.map((s) => s.id),
      ['high_breakout', 'high_breakdown']
    );

    const onlyBreakouts = filterMasterCoordinatorSetups(pool, {
      ...DEFAULT_MASTER_SIGNAL_FILTERS,
      moveFilter: 'BREAKOUT',
    });
    assert.deepEqual(
      onlyBreakouts.map((s) => s.id),
      ['high_breakout']
    );

    const onlyBreakdowns = filterMasterCoordinatorSetups(pool, {
      ...DEFAULT_MASTER_SIGNAL_FILTERS,
      moveFilter: 'BREAKDOWN',
    });
    assert.deepEqual(
      onlyBreakdowns.map((s) => s.id),
      ['high_breakdown']
    );

    const highRR = filterMasterCoordinatorSetups(pool, {
      ...DEFAULT_MASTER_SIGNAL_FILTERS,
      minRiskReward: 3.0,
    });
    assert.deepEqual(
      highRR.map((s) => s.id),
      ['high_breakout']
    );

    const summary = summarizeMasterCoordinator(pool, defaultQualified, {
      scannedCount: 10,
      confirmedSignals: [],
      filteredFakeouts: [],
      watchingCoils: [],
      scannedAt: '2026-11-15T12:00:00.000Z',
    });
    assert.equal(summary.totalEvaluatedSetups, 5);
    assert.equal(summary.qualifiedCount, 2);
    assert.equal(summary.breakoutCount, 1);
    assert.equal(summary.breakdownCount, 1);
  });
});

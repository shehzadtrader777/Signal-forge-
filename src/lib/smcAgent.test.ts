import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyOrderBlocksAgainstFrvp,
  computeFixedRangeVolumeProfile,
  detectLiquiditySweeps,
  detectOrderBlocks,
  detectSwingPoints,
  evaluateTradingSession,
  runSmcVolumeProfileAgent,
  type OrderBlockZone,
} from './smcAgent';
import { generateDeterministicCandles, type Candle } from './marketData';

function makeSyntheticTrendWithSweepAndOB(): Candle[] {
  const baseTime = 1700000000;
  const candles: Candle[] = [];
  let price = 100;

  // Build 40 base candles with clear swing low around index 18 (price ~92)
  for (let i = 0; i < 40; i++) {
    let close = price + (i < 18 ? -0.45 : i < 28 ? 0.55 : -0.3);
    if (i === 18) close = 92;
    const open = price;
    const high = Math.max(open, close) + 0.6;
    let low = Math.min(open, close) - 0.6;
    if (i === 18) low = 91.0; // Swing low anchor
    candles.push({
      time: baseTime + i * 3600,
      open,
      high,
      low,
      close,
      volume: 1000 + (i === 25 ? 4500 : i * 25),
    });
    price = close;
  }

  // Last bearish candle before strong bullish displacement (Bullish Order Block / Accumulation Zone at index 40)
  candles.push({
    time: baseTime + 40 * 3600,
    open: 95.5,
    high: 96.0,
    low: 94.2,
    close: 94.4,
    volume: 2800,
  });

  // Strong bullish displacement (index 41 & 42)
  candles.push({
    time: baseTime + 41 * 3600,
    open: 94.4,
    high: 98.2,
    low: 94.3,
    close: 98.0,
    volume: 5200,
  });
  candles.push({
    time: baseTime + 42 * 3600,
    open: 98.0,
    high: 101.8,
    low: 97.8,
    close: 101.4,
    volume: 4900,
  });

  // Pullback + SSL liquidity sweep below 91.0 swing low closing back at 94.9 (retesting Accumulation Zone)
  candles.push({
    time: baseTime + 43 * 3600,
    open: 101.4,
    high: 101.5,
    low: 90.2, // Sweeps below 91.0 swing low!
    close: 94.9, // Closes cleanly above swing low & inside Bullish OB (94.2 - 96.0)
    volume: 6100,
  });

  return candles;
}

test('computeFixedRangeVolumeProfile enforces rangeHigh >= VAH >= POC >= VAL >= rangeLow', () => {
  const candles = generateDeterministicCandles('BTCUSDT', '4h', 120);
  const vp = computeFixedRangeVolumeProfile(candles, 18, 96);

  assert.equal(vp.bins.length, 18);
  assert.ok(vp.totalVolume > 0);
  assert.ok(vp.rangeHigh >= vp.vah, `Expected rangeHigh ${vp.rangeHigh} >= vah ${vp.vah}`);
  assert.ok(vp.vah >= vp.poc, `Expected vah ${vp.vah} >= poc ${vp.poc}`);
  assert.ok(vp.poc >= vp.val, `Expected poc ${vp.poc} >= val ${vp.val}`);
  assert.ok(vp.val >= vp.rangeLow, `Expected val ${vp.val} >= rangeLow ${vp.rangeLow}`);

  const vaVolume = vp.bins.filter((b) => b.inValueArea).reduce((acc, b) => acc + b.volume, 0);
  assert.ok(vaVolume / vp.totalVolume >= 0.65, 'Value Area should cover ~70% of volume');
  assert.equal(vp.bins.filter((b) => b.isPoc).length, 1);
});

test('detectLiquiditySweeps and detectOrderBlocks catch SSL sweep and Accumulation Zone', () => {
  const candles = makeSyntheticTrendWithSweepAndOB();
  const { highs, lows } = detectSwingPoints(candles, 3);
  const sweep = detectLiquiditySweeps(candles, highs, lows);
  const obs = detectOrderBlocks(candles);

  assert.equal(sweep.detected, true);
  assert.equal(sweep.type, 'SSL Sweep');
  assert.ok(sweep.sweptPrice >= 90.5 && sweep.sweptPrice <= 92.5);

  assert.ok(obs.length > 0, 'Expected at least one detected Order Block');
  const bullishOb = obs.find((o) => o.type === 'Bullish OB');
  assert.ok(bullishOb, 'Expected Bullish Order Block before displacement');
  assert.equal(bullishOb.zoneRole, 'Accumulation Zone');
});

test('evaluateTradingSession only marks London and New York hours as optimal', () => {
  const londonOpen = Math.floor(Date.UTC(2026, 10, 14, 8, 30) / 1000);
  const overlap = Math.floor(Date.UTC(2026, 10, 14, 13, 30) / 1000);
  const nyAfternoon = Math.floor(Date.UTC(2026, 10, 14, 18, 0) / 1000);
  const asianOffSession = Math.floor(Date.UTC(2026, 10, 14, 3, 15) / 1000);
  const lateOffSession = Math.floor(Date.UTC(2026, 10, 14, 22, 45) / 1000);

  assert.equal(evaluateTradingSession(londonOpen).isOptimalWindow, true);
  assert.equal(evaluateTradingSession(londonOpen).session, 'London Session');
  assert.equal(evaluateTradingSession(overlap).isOptimalWindow, true);
  assert.equal(evaluateTradingSession(overlap).session, 'London / NY Overlap');
  assert.equal(evaluateTradingSession(nyAfternoon).isOptimalWindow, true);
  assert.equal(evaluateTradingSession(nyAfternoon).session, 'New York Session');
  assert.equal(evaluateTradingSession(asianOffSession).isOptimalWindow, false);
  assert.equal(evaluateTradingSession(lateOffSession).isOptimalWindow, false);
});

test('runSmcVolumeProfileAgent enforces session gating, sweep confirmation, and 1:5 TP ladder', () => {
  const synthCandles = makeSyntheticTrendWithSweepAndOB();
  const londonTs = Math.floor(Date.UTC(2026, 10, 14, 14, 0) / 1000);
  const asianTs = Math.floor(Date.UTC(2026, 10, 14, 2, 0) / 1000);

  const inSession = runSmcVolumeProfileAgent('BTCUSDT', 'Bitcoin', synthCandles, 5, londonTs);
  assert.equal(inSession.direction, 'BUY');
  assert.equal(inSession.zoneLabel, 'Accumulation Zone');
  assert.equal(inSession.sweepConfirmed, true);
  assert.equal(inSession.executionAllowed, true);
  assert.equal(inSession.executionStatus, 'EXECUTE');

  const offSession = runSmcVolumeProfileAgent('BTCUSDT', 'Bitcoin', synthCandles, 5, asianTs);
  assert.equal(offSession.executionAllowed, false);
  assert.equal(offSession.executionStatus, 'WAIT_SESSION');

  const coins = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'] as const;
  for (const sym of coins) {
    const candles = generateDeterministicCandles(sym, '4h', 120);
    const analysis = runSmcVolumeProfileAgent(sym, sym.replace('USDT', ''), candles, 5, londonTs);

    assert.ok(analysis.confidence >= 56 && analysis.confidence <= 97);
    assert.equal(analysis.targetRiskReward, 5);
    assert.equal(analysis.monthlyTradeTarget, 300);
    assert.ok(
      Math.abs(analysis.riskRewardRatio - 5) <= 0.1,
      `Expected ~1:5 R:R for ${sym}, got 1:${analysis.riskRewardRatio}`
    );
    assert.equal(analysis.takeProfits.length, 3);
    assert.ok(analysis.rationale.includes('POC'));

    const risk = Math.abs(analysis.entryPrice - analysis.stopLoss);
    const reward = Math.abs(analysis.takeProfits[2] - analysis.entryPrice);
    assert.ok(
      Math.abs(reward / risk - 5) <= 0.15,
      `Expected TP3 distance / SL distance ~5, got ${(reward / risk).toFixed(2)}`
    );

    if (analysis.direction === 'BUY') {
      assert.equal(analysis.zoneLabel, 'Accumulation Zone');
      assert.ok(analysis.stopLoss < analysis.entryPrice);
      assert.ok(analysis.targetLiquidityPool > analysis.entryPrice);
      assert.ok(analysis.takeProfits[0] > analysis.entryPrice);
      assert.ok(analysis.takeProfits[1] > analysis.takeProfits[0]);
      assert.ok(analysis.takeProfits[2] > analysis.takeProfits[1]);
    } else {
      assert.equal(analysis.zoneLabel, 'Supply Zone');
      assert.ok(analysis.stopLoss > analysis.entryPrice);
      assert.ok(analysis.targetLiquidityPool < analysis.entryPrice);
      assert.ok(analysis.takeProfits[0] < analysis.entryPrice);
      assert.ok(analysis.takeProfits[1] < analysis.takeProfits[0]);
      assert.ok(analysis.takeProfits[2] < analysis.takeProfits[1]);
    }
  }
});

test('FRVP classifies HVN vs LVN clusters and avoids low-volume void zones', () => {
  const candles = makeSyntheticTrendWithSweepAndOB();
  const vp = computeFixedRangeVolumeProfile(candles, 18, 96);

  assert.ok(vp.highVolumeNodes.length >= 1, 'Expected at least one High-Volume Node');
  assert.ok(
    vp.bins.every((b) => b.nodeType === 'HVN' || b.nodeType === 'NORMAL' || b.nodeType === 'LVN')
  );

  const lvnBin = vp.lowVolumeNodes[0];
  const hvnBin = vp.highVolumeNodes[0];
  if (lvnBin && hvnBin) {
    const mockZones: OrderBlockZone[] = [
      {
        type: 'Bullish OB',
        zoneRole: 'Accumulation Zone',
        low: lvnBin.low,
        high: lvnBin.high,
        mid: lvnBin.center,
        time: candles[0].time,
        mitigated: false,
        retesting: true,
        distancePercent: 0.2,
      },
      {
        type: 'Bullish OB',
        zoneRole: 'Accumulation Zone',
        low: hvnBin.low,
        high: hvnBin.high,
        mid: hvnBin.center,
        time: candles[1].time,
        mitigated: false,
        retesting: false,
        distancePercent: 0.8,
      },
    ];
    const classified = classifyOrderBlocksAgainstFrvp(mockZones, vp);
    assert.equal(classified[0].volumeProfileAlignment, 'LVN_VOID');
    assert.equal(classified[0].inLowVolumeVoid, true);
    assert.equal(classified[1].volumeProfileAlignment, 'HVN_CONFIRMED');
    assert.equal(classified[1].inLowVolumeVoid, false);
  }
});


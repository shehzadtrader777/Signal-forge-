import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceMonotonicTrailingStop,
  deriveStructuralStop,
  detectMarketRegimeFromClosedWindow,
  evaluateRRGate,
  evaluateRegimeAwareScaling,
} from './invariantKernels';
import { generateDeterministicCandles } from './marketData';

test('RRGateKernel strictly rejects setups below 1:5 Risk-to-Reward and invalid directional bounds', () => {
  const rejectedLowRR = evaluateRRGate({
    direction: 'BUY',
    entryPrice: 100,
    stopLoss: 98, // risk = 2
    takeProfit: 109.9, // reward = 9.9 => 4.95R
  });
  assert.equal(rejectedLowRR.passed, false);
  assert.ok(rejectedLowRR.rewardRiskRatio < 5.0);

  const rejectedInverseStop = evaluateRRGate({
    direction: 'SELL',
    entryPrice: 100,
    stopLoss: 98, // wrong side for SELL
    takeProfit: 90,
  });
  assert.equal(rejectedInverseStop.passed, false);

  const approvedExact5R = evaluateRRGate({
    direction: 'BUY',
    entryPrice: 100,
    stopLoss: 98, // risk = 2
    takeProfit: 110, // reward = 10 => 5.0R
  });
  assert.equal(approvedExact5R.passed, true);
  assert.equal(approvedExact5R.rewardRiskRatio, 5.0);

  const approvedSell = evaluateRRGate({
    direction: 'SELL',
    entryPrice: 100,
    stopLoss: 101.5, // risk = 1.5
    takeProfit: 91.75, // reward = 8.25 => 5.5R
  });
  assert.equal(approvedSell.passed, true);
  assert.ok(approvedSell.rewardRiskRatio >= 5.5);
});

test('StructuralStopKernel derives stops from closed structure boundaries bounded by ATR noise filters and <=2% cap', () => {
  const candles = generateDeterministicCandles('BTCUSDT', '1h', 80);
  const closed = candles.slice(0, 60);
  const entry = closed[closed.length - 1].close;
  const atr = entry * 0.008;

  const buyStop = deriveStructuralStop({
    direction: 'BUY',
    entryPrice: entry,
    closedCandles: closed,
    atr14: atr,
    lookbackBars: 12,
    minAtrFloorMult: 0.75,
    maxAtrCeilingMult: 2.2,
    maxRiskPct: 2.0,
  });

  assert.ok(buyStop.stopLoss < entry, 'BUY structural stop must sit strictly below entry');
  assert.ok(buyStop.riskPct <= 2.0, `Risk pct ${buyStop.riskPct}% must respect <= 2% hard cap`);
  assert.ok(
    buyStop.appliedDistance >= buyStop.atrFloorDistance - 1e-6 || buyStop.clampedByMaxRiskCap,
    'Stop must honor ATR noise floor unless capped by hard max risk'
  );

  const sellStop = deriveStructuralStop({
    direction: 'SELL',
    entryPrice: entry,
    closedCandles: closed,
    atr14: atr,
    lookbackBars: 12,
  });
  assert.ok(sellStop.stopLoss > entry, 'SELL structural stop must sit strictly above entry');
  assert.ok(sellStop.riskPct <= 2.0);
});

test('MonotonicTrailingStopKernel enforces strict monotonic tightening on closed bars for BUY & SELL', () => {
  // BUY trajectory: price rallies then pulls back deeply -> stop must NEVER move down
  let buyStop = 98.0;
  const initialBuyStop = 98.0;
  const buyBars = [
    { high: 102, low: 99, close: 101 },
    { high: 106, low: 100.5, close: 105 },
    { high: 112, low: 104, close: 111 },
    { high: 107, low: 101, close: 103 }, // sharp pullback close
    { high: 104, low: 99.5, close: 100 }, // deeper pullback close
    { high: 115, low: 102, close: 114 },
  ];

  for (const bar of buyBars) {
    const res = advanceMonotonicTrailingStop({
      direction: 'BUY',
      prevStopLoss: buyStop,
      initialStopLoss: initialBuyStop,
      closedBar: bar,
      atr14: 2.0,
      atrMultiplier: 1.5,
    });
    assert.equal(res.monotonicInvariantHeld, true);
    assert.ok(
      res.nextStopLoss >= buyStop,
      `BUY monotonic violation: next ${res.nextStopLoss} < prev ${buyStop}`
    );
    buyStop = res.nextStopLoss;
  }
  assert.ok(buyStop > initialBuyStop, 'BUY stop must have ratcheted upward monotonically');

  // SELL trajectory: price drops then bounces sharply -> stop must NEVER move up
  let sellStop = 102.0;
  const initialSellStop = 102.0;
  const sellBars = [
    { high: 101, low: 97, close: 98 },
    { high: 99, low: 92, close: 93 },
    { high: 97, low: 91, close: 96 }, // bounce
    { high: 100, low: 95, close: 99.5 }, // deeper bounce
    { high: 94, low: 88, close: 89 },
  ];

  for (const bar of sellBars) {
    const res = advanceMonotonicTrailingStop({
      direction: 'SELL',
      prevStopLoss: sellStop,
      initialStopLoss: initialSellStop,
      closedBar: bar,
      atr14: 1.8,
      atrMultiplier: 1.5,
    });
    assert.equal(res.monotonicInvariantHeld, true);
    assert.ok(
      res.nextStopLoss <= sellStop,
      `SELL monotonic violation: next ${res.nextStopLoss} > prev ${sellStop}`
    );
    sellStop = res.nextStopLoss;
  }
  assert.ok(sellStop < initialSellStop, 'SELL stop must have ratcheted downward monotonically');
});

test('RegimeAwareScalingKernel blocks partial exits at <= 3.0R and adapts slices above 3.0R by regime', () => {
  for (const r of [-0.5, 0, 1.5, 2.95, 3.0]) {
    const blocked = evaluateRegimeAwareScaling({
      regime: 'TRENDING',
      realizedR: r,
    });
    assert.equal(blocked.allowed, false, `Must reject partial scaling at realized ${r}R`);
    assert.equal(blocked.exitFractionPct, 0);
  }

  const trendingAbove3R = evaluateRegimeAwareScaling({
    regime: 'TRENDING',
    realizedR: 3.25,
  });
  const choppyAbove3R = evaluateRegimeAwareScaling({
    regime: 'CHOPPY',
    realizedR: 3.25,
  });
  assert.equal(trendingAbove3R.allowed, true);
  assert.equal(choppyAbove3R.allowed, true);
  assert.ok(
    trendingAbove3R.remainingPositionPct > choppyAbove3R.remainingPositionPct,
    'TRENDING regime should hold a larger runner (>3R) than CHOPPY regime'
  );

  const candles = generateDeterministicCandles('ETHUSDT', '15m', 40);
  const regime = detectMarketRegimeFromClosedWindow(candles);
  assert.ok(['TRENDING', 'NORMAL', 'HIGH_VOLATILITY', 'CHOPPY'].includes(regime));
});

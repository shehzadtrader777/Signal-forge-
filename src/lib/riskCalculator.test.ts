import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRiskMetrics } from './riskCalculator';

test('calculateRiskMetrics applies Position Size = (Balance * Risk%) / (Entry - SL)', () => {
  // Balance = $10,000, Risk = 2% -> $200 risk
  // Entry = $50,000, SL = $49,000 -> distance = $1,000
  // Position Size Units = 200 / 1000 = 0.2 BTC ($10,000 notional)
  const result = calculateRiskMetrics({
    balance: 10000,
    riskPercent: 2,
    entryPrice: 50000,
    stopLoss: 49000,
    takeProfits: [51500, 53000, 55000],
    direction: 'BUY',
  });

  assert.equal(result.isValid, true);
  assert.equal(result.riskAmountUsd, 200);
  assert.equal(result.potentialLossUsd, 200);
  assert.equal(result.positionSizeUnits, 0.2);
  assert.equal(result.lotSize, 0.2);
  assert.equal(result.positionValueUsd, 10000);
  assert.deepEqual(result.potentialProfitsUsd, [300, 600, 1000]);
  assert.deepEqual(result.riskRewardRatios, [1.5, 3, 5]);
});

test('calculateRiskMetrics handles SELL positions and rejects invalid inputs', () => {
  const shortResult = calculateRiskMetrics({
    balance: 5000,
    riskPercent: 2,
    entryPrice: 200,
    stopLoss: 210,
    takeProfits: [185, 170, 150],
    direction: 'SELL',
  });

  assert.equal(shortResult.isValid, true);
  assert.equal(shortResult.riskAmountUsd, 100);
  assert.equal(shortResult.positionSizeUnits, 10);
  assert.equal(shortResult.potentialProfitsUsd[0], 150);

  const invalid = calculateRiskMetrics({
    balance: 0,
    riskPercent: 2,
    entryPrice: 100,
    stopLoss: 100,
    takeProfits: [110, 120, 130],
    direction: 'BUY',
  });
  assert.equal(invalid.isValid, false);
});

test('calculateRiskMetrics computes required margin from leverage and validates bounds', () => {
  const leveraged = calculateRiskMetrics({
    balance: 10000,
    riskPercent: 2,
    leverage: 10,
    entryPrice: 50000,
    stopLoss: 49000,
    takeProfits: [51500, 53000, 55000],
    direction: 'BUY',
  });

  assert.equal(leveraged.isValid, true);
  assert.equal(leveraged.leverage, 10);
  assert.equal(leveraged.positionValueUsd, 10000);
  assert.equal(leveraged.requiredMarginUsd, 1000);
  assert.equal(leveraged.exceedsBalance, false);

  const invalidLev = calculateRiskMetrics({
    balance: 10000,
    riskPercent: 2,
    leverage: 200,
    entryPrice: 50000,
    stopLoss: 49000,
    takeProfits: [51500, 53000, 55000],
    direction: 'BUY',
  });
  assert.equal(invalidLev.isValid, false);
});

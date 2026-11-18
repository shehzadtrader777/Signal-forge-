import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INITIAL_INSTITUTIONAL_ACCOUNTS,
  buildMirroredCopyTradePlan,
  executeArbitrageCapture,
  scanCrossExchangeArbitrage,
} from './arbitrageAndCopyTrading';
import { aggregateMultiExchangeDepth, normalizeExchangeOrderBook } from './orderBookDepth';

test('scanCrossExchangeArbitrage detects net-positive cross-exchange bid/ask discrepancies', () => {
  const binBook = normalizeExchangeOrderBook({
    exchange: 'BINANCE',
    symbol: 'BTCUSDT',
    bids: [[90000, 2]],
    asks: [[90010, 2]],
    source: 'live_ws',
  });
  const bybitBook = normalizeExchangeOrderBook({
    exchange: 'BYBIT',
    symbol: 'BTCUSDT',
    bids: [[90160, 2]],
    asks: [[90180, 2]],
    source: 'exchange_rest',
  });
  const agg = aggregateMultiExchangeDepth('BTCUSDT', [binBook, bybitBook], 90080);
  const opps = scanCrossExchangeArbitrage({ BTCUSDT: agg });

  assert.equal(opps.length, 1);
  assert.equal(opps[0].buyExchange, 'BINANCE');
  assert.equal(opps[0].sellExchange, 'BYBIT');
  assert.equal(opps[0].executable, true);
  assert.ok(opps[0].netSpreadBps > 5);

  const exec = executeArbitrageCapture(opps[0], 25000);
  assert.equal(exec.ok, true);
  assert.ok(exec.updatedWalletBalanceUsd > 25000);
  assert.ok((exec.record?.realizedProfitUsd ?? 0) > 0);
});

test('buildMirroredCopyTradePlan strictly enforces <=2% risk per trade and >=1:5 P/L ratio', () => {
  const account = INITIAL_INSTITUTIONAL_ACCOUNTS[0];
  const plan = buildMirroredCopyTradePlan({
    account,
    symbol: 'ETHUSDT',
    direction: 'BUY',
    entryPrice: 3200,
    atr14: 180,
    futuresEnabled: false,
  });

  assert.ok(plan.maxRiskPct <= 2.01, `Expected maxRiskPct <= 2.0%, got ${plan.maxRiskPct}%`);
  assert.ok(plan.riskRewardRatio >= 5.0);
  const risk = Math.abs(plan.entryPrice - plan.stopLoss);
  const reward = Math.abs(plan.takeProfits[2] - plan.entryPrice);
  assert.ok(reward / risk >= 5.0, `Expected TP3 R:R >= 5.0, got ${(reward / risk).toFixed(2)}`);
});

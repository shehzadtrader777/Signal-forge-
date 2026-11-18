import assert from 'node:assert/strict';
import test from 'node:test';
import { settleCrossMarginClose, type SandboxPosition } from './coordinator';
import {
  INITIAL_RL_TUNING_STATE,
  detectFlashCrashConditions,
  executeEmergencyStablecoinLiquidation,
  tuneStrategyParametersRL,
} from './autonomousSafeguards';

function makeOpenPos(overrides: Partial<SandboxPosition> = {}): SandboxPosition {
  return {
    id: 'pos_1',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    mode: 'TESTNET',
    marketType: 'USD_M_FUTURES',
    marginMode: 'CROSS',
    leverage: 5,
    entryPrice: 90000,
    quantity: 0.05,
    notionalUsd: 4500,
    initialMarginUsd: 900,
    maintenanceMarginUsd: 18,
    liquidationPrice: 60000,
    fundingRate: 0.0001,
    settledFundingUsd: 0,
    initialStopLoss: 88200,
    maxStopLossPct: 2.0,
    trailingStopLoss: 88500,
    trailingTakeProfit5xAtr: 96000,
    peakFavorablePrice: 90500,
    takeProfits: [93000, 96000, 99000],
    status: 'OPEN',
    pnlUsd: 0,
    pnlPercent: 0,
    roePercent: 0,
    skepticVerdict: 'APPROVED',
    openedAt: new Date().toISOString(),
    ...overrides,
  };
}

test('detectFlashCrashConditions triggers CRITICAL_FLASH_CRASH during rapid dumps', () => {
  const crash = detectFlashCrashConditions({
    symbol: 'BTCUSDT',
    wsVelocityPct: -5.4,
    volumeSpikeRatio: 2.9,
    netOrderBookImbalance: -0.34,
    sentinelRegime: 'PANIC_FUD',
  });
  assert.equal(crash.triggered, true);
  assert.equal(crash.severity, 'CRITICAL_FLASH_CRASH');

  const normal = detectFlashCrashConditions({
    symbol: 'BTCUSDT',
    wsVelocityPct: 0.6,
    volumeSpikeRatio: 1.1,
    netOrderBookImbalance: 0.08,
    sentinelRegime: 'NORMAL',
  });
  assert.equal(normal.triggered, false);
  assert.equal(normal.severity, 'NORMAL');
});

test('executeEmergencyStablecoinLiquidation liquidates high-risk positions into USDT and settles equity', () => {
  const pos1 = makeOpenPos({ id: 'p1', symbol: 'BTCUSDT', notionalUsd: 4500 });
  const pos2 = makeOpenPos({ id: 'p2', symbol: 'SOLUSDT', marketType: 'SPOT', leverage: 1, entryPrice: 200, notionalUsd: 1500 });

  const res = executeEmergencyStablecoinLiquidation({
    positions: [pos1, pos2],
    markPriceMap: { BTCUSDT: 89000, SOLUSDT: 196 },
    walletBalanceUsd: 25000,
    settleCloseFn: settleCrossMarginClose,
    triggerReason: 'Flash Crash Test',
    stablecoinAsset: 'USDT',
    highRiskOnly: true,
  });

  assert.equal(res.liquidatedRecords.length, 2);
  assert.equal(pos1.status, 'CLOSED_EMERGENCY_LIQUIDATION');
  assert.equal(pos2.status, 'CLOSED_EMERGENCY_LIQUIDATION');
  assert.equal(res.liquidatedRecords[0].convertedStablecoin, 'USDT');
  assert.ok(res.updatedWalletBalanceUsd < 25000);
  assert.equal(res.totalConvertedUsd, 6000);
});

test('tuneStrategyParametersRL adjusts ATR multipliers >=5x TP, picks optimal timeframe, and scales compute by conviction', () => {
  const closedWin = makeOpenPos({ id: 'w1', status: 'CLOSED_TP', pnlUsd: 320, pnlPercent: 4.5 });
  const closedWin2 = makeOpenPos({ id: 'w2', symbol: 'SOLUSDT', status: 'CLOSED_TP', pnlUsd: 210, pnlPercent: 3.1 });

  const tuned = tuneStrategyParametersRL(
    INITIAL_RL_TUNING_STATE,
    [closedWin, closedWin2],
    [
      { symbol: 'BTCUSDT', confidence: 91 },
      { symbol: 'ADAUSDT', confidence: 72 },
    ]
  );

  assert.ok(tuned.atrTrailingTpMultiplier >= 5.0);
  assert.ok(tuned.atrStopMultiplier >= 1.2 && tuned.atrStopMultiplier <= 2.0);
  assert.ok(tuned.computeAllocationBySymbol.BTCUSDT >= 80);
  assert.ok(tuned.computeAllocationBySymbol.ADAUSDT <= 50);
  assert.ok(tuned.computeAllocationBySymbol.BTCUSDT > tuned.computeAllocationBySymbol.ADAUSDT);
  assert.equal(tuned.settledTradesEvaluated, 2);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { TRACKED_COINS, generateDeterministicCandles } from './marketData';
import { DEFAULT_NEWS_FEED, buildSignalForCoin } from './signals';
import {
  advanceAtrTrailingStop,
  buildDynamicRiskAndAtrPlan,
  calculateFuturesDynamicMargin,
  computeATR,
  computeVolatilityScaledLeverage,
  coordinateMultiAgentTrade,
  runSkepticAgent,
  settleCrossMarginClose,
  summarizeCrossMarginWallet,
  type FuturesTickerTelemetry,
  type SandboxPosition,
} from './coordinator';

test('computeATR and buildDynamicRiskAndAtrPlan compute volatility-adaptive TP1/TP2/TP3 and ATR trailing SL', () => {
  const btcCandles = generateDeterministicCandles('BTCUSDT', '4h', 120);
  const solCandles = generateDeterministicCandles('SOLUSDT', '4h', 120);

  const btcAtr = computeATR(btcCandles, 14);
  const solAtr = computeATR(solCandles, 14);
  assert.ok(btcAtr > 0 && solAtr > 0);

  const entryBtc = btcCandles[btcCandles.length - 1].close;
  const entrySol = solCandles[solCandles.length - 1].close;

  const btcPlan = buildDynamicRiskAndAtrPlan(btcCandles, entryBtc, 'BUY', 88, 1.15);
  const solPlan = buildDynamicRiskAndAtrPlan(solCandles, entrySol, 'BUY', 74, 0.92);

  assert.ok(btcPlan.initialStopLoss < entryBtc);
  assert.ok(btcPlan.trailingStopLoss >= btcPlan.initialStopLoss);
  assert.ok(btcPlan.trailingStopLoss < entryBtc);
  assert.ok(btcPlan.takeProfits[0] > entryBtc);
  assert.ok(btcPlan.takeProfits[1] > btcPlan.takeProfits[0]);
  assert.ok(btcPlan.takeProfits[2] > btcPlan.takeProfits[1]);
  assert.notEqual(btcPlan.dynamicRRs[2], solPlan.dynamicRRs[2]);
});

test('advanceAtrTrailingStop trails monotonically in profitable direction for BUY and SELL', () => {
  const longPos = {
    direction: 'BUY' as const,
    initialStopLoss: 90,
    trailingStopLoss: 92,
  };
  const trailedUp = advanceAtrTrailingStop(longPos, 104, 2.0);
  assert.ok(trailedUp > 92 && trailedUp < 104);
  const trailedPullback = advanceAtrTrailingStop(
    { ...longPos, trailingStopLoss: trailedUp },
    96,
    2.0
  );
  assert.equal(trailedPullback, trailedUp);

  const shortPos = {
    direction: 'SELL' as const,
    initialStopLoss: 110,
    trailingStopLoss: 108,
  };
  const trailedDown = advanceAtrTrailingStop(shortPos, 95, 2.0);
  assert.ok(trailedDown < 108 && trailedDown > 95);
});

test('computeVolatilityScaledLeverage scales inversely to ATR volatility and Skeptic risk', () => {
  const calmHighConviction = computeVolatilityScaledLeverage({
    atrPercent: 1.0,
    confidence: 88,
    skepticRiskScore: 15,
    maxLeverage: 125,
  });
  const volatileCaution = computeVolatilityScaledLeverage({
    atrPercent: 4.8,
    confidence: 74,
    skepticRiskScore: 45,
    maxLeverage: 50,
  });

  assert.ok(calmHighConviction >= 12);
  assert.ok(volatileCaution <= 5);
  assert.ok(calmHighConviction > volatileCaution);
});

test('calculateFuturesDynamicMargin computes initial/maintenance margin and wider Cross liquidation cushion than Isolated', () => {
  const crossMargin = calculateFuturesDynamicMargin({
    entryPrice: 90000,
    stopLoss: 88200,
    direction: 'BUY',
    notionalUsd: 10000,
    leverage: 10,
    recommendedLeverage: 10,
    maxLeverage: 125,
    marginMode: 'CROSS',
    crossAvailableBalanceUsd: 25000,
    fundingRate: 0.0001,
  });
  const isolatedMargin = calculateFuturesDynamicMargin({
    entryPrice: 90000,
    stopLoss: 88200,
    direction: 'BUY',
    notionalUsd: 10000,
    leverage: 10,
    recommendedLeverage: 10,
    maxLeverage: 125,
    marginMode: 'ISOLATED',
    crossAvailableBalanceUsd: 25000,
    fundingRate: 0.0001,
  });

  assert.equal(crossMargin.initialMarginUsd, 1000);
  assert.equal(crossMargin.maintenanceMarginUsd, 40);
  assert.equal(crossMargin.estimatedFeeUsd, 4);
  assert.ok(crossMargin.liquidationPrice < isolatedMargin.liquidationPrice);
  assert.equal(crossMargin.stopBeforeLiquidationSafe, true);
  assert.equal(crossMargin.fundingImpactUsd8h, -1);
});

test('summarizeCrossMarginWallet and settleCrossMarginClose settle P&L and release cross margin accurately', () => {
  const positions: SandboxPosition[] = [
    {
      id: 'pos_1',
      symbol: 'BTCUSDT',
      direction: 'BUY',
      mode: 'TESTNET',
      marketType: 'USD_M_FUTURES',
      marginMode: 'CROSS',
      leverage: 10,
      entryPrice: 90000,
      quantity: 0.1,
      notionalUsd: 9000,
      initialMarginUsd: 900,
      maintenanceMarginUsd: 36,
      liquidationPrice: 38000,
      fundingRate: 0.0001,
      settledFundingUsd: -0.9,
      initialStopLoss: 88200,
      trailingStopLoss: 88500,
      takeProfits: [91800, 93600, 96000],
      status: 'OPEN',
      pnlUsd: 0,
      pnlPercent: 0,
      skepticVerdict: 'APPROVED',
      openedAt: new Date().toISOString(),
    },
  ];

  const wallet = summarizeCrossMarginWallet(25000, positions, { BTCUSDT: 92000 });
  // +200 unrealized PnL - 0.90 funding = +199.10
  assert.equal(wallet.unrealizedPnlUsd, 199.1);
  assert.equal(wallet.crossEquityUsd, 25199.1);
  assert.equal(wallet.totalInitialMarginUsd, 900);
  assert.equal(wallet.availableCrossMarginUsd, 24299.1);
  assert.ok(wallet.crossMarginRatioPercent > 0 && wallet.crossMarginRatioPercent < 1);

  const settlement = settleCrossMarginClose({
    walletBalanceUsd: 25000,
    position: positions[0],
    exitPrice: 92000,
  });
  // gross +200 - fee 7.20 - funding 0.90 = +191.90
  assert.equal(settlement.grossPnlUsd, 200);
  assert.equal(settlement.feeUsd, 7.2);
  assert.equal(settlement.netRealizedPnlUsd, 191.9);
  assert.equal(settlement.updatedWalletBalanceUsd, 25191.9);
  assert.ok(settlement.roePercent > 20);
});

test('runSkepticAgent vetoes overextended/funding-crowded trades and approves aligned Futures setups', () => {
  const btcCandles = generateDeterministicCandles('BTCUSDT', '4h', 120);
  const entry = 91000;
  const plan = buildDynamicRiskAndAtrPlan(btcCandles, entry, 'BUY', 86, 1.0);

  const alignedAgents = [
    { id: 'market_intel' as const, name: 'Intel', role: 'News', bias: 'BULLISH' as const, confidence: 82, metricLabel: '2', summary: 'Bullish' },
    { id: 'whale_tracker' as const, name: 'Whale', role: 'Flow', bias: 'BULLISH' as const, confidence: 84, metricLabel: 'Outflow', summary: 'Bullish' },
    { id: 'technical' as const, name: 'Tech', role: 'TA', bias: 'BULLISH' as const, confidence: 88, metricLabel: 'RSI 58', summary: 'Bullish' },
    { id: 'risk_mgmt' as const, name: 'Risk', role: 'ATR', bias: 'BULLISH' as const, confidence: 88, metricLabel: 'ATR', summary: 'Dynamic' },
  ];

  const cleanFutures: FuturesTickerTelemetry = {
    symbol: 'BTCUSDT',
    markPrice: 91000,
    indexPrice: 90980,
    fundingRate: 0.0001,
    nextFundingTime: new Date().toISOString(),
    openInterestUsd: 4_200_000_000,
    volume24hUsd: 18_500_000_000,
    maxLeverage: 125,
    source: 'binance_futures',
  };

  const approvedAudit = runSkepticAgent({
    direction: 'BUY',
    entryPrice: entry,
    rsi: 58,
    ema21: 90200,
    riskPlan: plan,
    subAgents: alignedAgents,
    whaleFlow: { symbol: 'BTCUSDT', netflowUsd: -45_000_000, inflow24hUsd: 100_000_000, outflow24hUsd: 145_000_000 },
    futuresTelemetry: cleanFutures,
  });
  assert.equal(approvedAudit.verdict, 'APPROVED');

  const crowdedFutures: FuturesTickerTelemetry = {
    ...cleanFutures,
    fundingRate: 0.0008, // +0.08% 8h positive funding crowding
  };
  const vetoAudit = runSkepticAgent({
    direction: 'BUY',
    entryPrice: entry,
    rsi: 84,
    ema21: 84000,
    riskPlan: plan,
    subAgents: alignedAgents,
    whaleFlow: { symbol: 'BTCUSDT', netflowUsd: 80_000_000, inflow24hUsd: 180_000_000, outflow24hUsd: 100_000_000 },
    futuresTelemetry: crowdedFutures,
  });
  assert.equal(vetoAudit.verdict, 'VETOED');
  assert.ok(vetoAudit.challenges.some((c) => c.includes('Crowded Futures Longs')));
});

test('coordinateMultiAgentTrade defaults to Spot 1x Priority and unlocks Futures when manually enabled', () => {
  const ethCoin = TRACKED_COINS.find((c) => c.symbol === 'ETHUSDT')!;
  const candles = generateDeterministicCandles(ethCoin.symbol, '4h', 120);
  const sig = buildSignalForCoin(ethCoin, candles, DEFAULT_NEWS_FEED);
  const ethFutures: FuturesTickerTelemetry = {
    symbol: 'ETHUSDT',
    markPrice: sig.entryPrice,
    indexPrice: sig.entryPrice,
    fundingRate: 0.00012,
    nextFundingTime: new Date().toISOString(),
    openInterestUsd: 2_100_000_000,
    volume24hUsd: 9_400_000_000,
    maxLeverage: 100,
    source: 'binance_futures',
  };

  const spotDefault = coordinateMultiAgentTrade(
    sig,
    candles,
    DEFAULT_NEWS_FEED,
    { symbol: 'ETHUSDT', netflowUsd: -32_000_000, inflow24hUsd: 80_000_000, outflow24hUsd: 112_000_000 },
    ethFutures,
    { notionalUsd: 3000, manualLeverage: 10, scalingMode: 'MANUAL', marginMode: 'CROSS', crossAvailableBalanceUsd: 25000 }
  );

  assert.equal(spotDefault.marketType, 'SPOT');
  assert.equal(spotDefault.futuresMargin.leverage, 1);
  assert.equal(spotDefault.futuresMargin.liquidationPrice, 0);
  assert.ok(spotDefault.telegramMessage.includes('SPOT 1x'));

  const futuresActive = coordinateMultiAgentTrade(
    sig,
    candles,
    DEFAULT_NEWS_FEED,
    { symbol: 'ETHUSDT', netflowUsd: -32_000_000, inflow24hUsd: 80_000_000, outflow24hUsd: 112_000_000 },
    ethFutures,
    {
      futuresEnabled: true,
      notionalUsd: 3000,
      manualLeverage: 10,
      scalingMode: 'MANUAL',
      marginMode: 'CROSS',
      crossAvailableBalanceUsd: 25000,
    }
  );

  assert.equal(futuresActive.marketType, 'USD_M_FUTURES');
  assert.equal(futuresActive.sourceModule, 'AI_ENGINE');
  assert.equal(futuresActive.futuresMargin.leverage, 10);
  assert.equal(futuresActive.futuresMargin.marginMode, 'CROSS');
  assert.equal(futuresActive.futuresMargin.initialMarginUsd, 300);
  assert.ok(futuresActive.riskPlan.trailingStopLoss > 0);
  assert.ok(futuresActive.telegramMessage.includes('USD-M PERP'));
  assert.ok(futuresActive.telegramMessage.includes('Cross Liq'));
});

import { runSmcVolumeProfileAgent } from './smcAgent';
import { scanCoinChartPattern, DEFAULT_PATTERN_SCANNER_PARAMS } from './patternScanner';
import { patternResultToTradingSignal, smcAnalysisToTradingSignal } from './coordinator';

test('smcAnalysisToTradingSignal and patternResultToTradingSignal connect directly to Coordinator with mandated ATR trailing SL', () => {
  const btcCoin = TRACKED_COINS.find((c) => c.symbol === 'BTCUSDT')!;
  const candles = generateDeterministicCandles(btcCoin.symbol, '4h', 120);

  const smc = runSmcVolumeProfileAgent(btcCoin.symbol, btcCoin.name, candles);
  const smcSig = smcAnalysisToTradingSignal(smc, candles, DEFAULT_NEWS_FEED);
  const smcPlan = coordinateMultiAgentTrade(smcSig, candles, DEFAULT_NEWS_FEED, undefined, undefined, {
    sourceModule: 'SMC_FRVP',
  });
  assert.equal(smcPlan.sourceModule, 'SMC_FRVP');
  assert.ok(smcPlan.riskPlan.trailingStopLoss > 0);

  const pat = scanCoinChartPattern(btcCoin, candles, {
    ...DEFAULT_PATTERN_SCANNER_PARAMS,
    strictFakeoutFilter: false,
    minVolumeMultiplier: 0.5,
    minClosePercentBeyondLevel: 0.01,
    minConfidence: 50,
  });
  if (pat) {
    const patSig = patternResultToTradingSignal(pat, candles, DEFAULT_NEWS_FEED);
    const patPlan = coordinateMultiAgentTrade(patSig, candles, DEFAULT_NEWS_FEED, undefined, undefined, {
      sourceModule: 'PATTERN_SCANNER',
    });
    assert.equal(patPlan.sourceModule, 'PATTERN_SCANNER');
    assert.ok(patPlan.riskPlan.trailingStopLoss > 0);
    assert.ok(patPlan.riskPlan.maxStopLossPct <= 5.0);
    assert.ok(patPlan.riskPlan.trailingTakeProfit5xAtr > 0);
  }
});

import {
  advance5xAtrTrailingTakeProfit,
  enforceMaxStopLossCap,
} from './coordinator';

test('enforceMaxStopLossCap strictly caps SL distance at 5% and advance5xAtrTrailingTakeProfit trails monotonically', () => {
  // Raw BUY stop at 90 (-10%) gets clamped to 95 (-5%)
  assert.equal(enforceMaxStopLossCap(100, 'BUY', 90, 5.0), 95);
  // Raw BUY stop at 97 (-3%) stays untouched at 97
  assert.equal(enforceMaxStopLossCap(100, 'BUY', 97, 5.0), 97);
  // Raw SELL stop at 112 (+12%) gets clamped to 105 (+5%)
  assert.equal(enforceMaxStopLossCap(100, 'SELL', 112, 5.0), 105);

  const step1 = advance5xAtrTrailingTakeProfit({
    direction: 'BUY',
    entryPrice: 100,
    initialStopLoss: 95,
    trailingStopLoss: 96,
    peakFavorablePrice: 100,
    currentPrice: 108,
    atr14: 2,
    atrMultiplier: 5,
  });
  assert.equal(step1.activated, true);
  assert.equal(step1.nextPeakPrice, 108);
  assert.equal(step1.nextTrailingTpTarget, 118); // 108 + 5*2
  assert.ok(step1.nextTrailingStop > 100);
});

test('buildDynamicRiskAndAtrPlan enforces strict <=2.0% max risk per trade and minimum 1:5 P/L ratio', () => {
  const btcCandles = generateDeterministicCandles('BTCUSDT', '15m', 120);
  const entry = btcCandles[btcCandles.length - 1].close;
  const plan = buildDynamicRiskAndAtrPlan(btcCandles, entry, 'BUY', 88, 1.0);

  assert.ok(plan.maxStopLossPct <= 2.01, `Expected maxStopLossPct <= 2%, got ${plan.maxStopLossPct}%`);
  assert.ok(plan.dynamicRRs[2] >= 5.0, `Expected TP3 R:R >= 5.0, got ${plan.dynamicRRs[2]}`);
  const riskDist = Math.abs(entry - plan.initialStopLoss);
  const rewardDist = Math.abs(plan.takeProfits[2] - entry);
  assert.ok(
    rewardDist / riskDist >= 4.95,
    `Expected TP3 profit/loss ratio >= 5.0, got ${(rewardDist / riskDist).toFixed(2)}`
  );
  // Default enforceMaxStopLossCap without 4th arg enforces strict 2.0% cap
  assert.equal(enforceMaxStopLossCap(100, 'BUY', 90), 98);
  assert.equal(enforceMaxStopLossCap(100, 'SELL', 110), 102);
});

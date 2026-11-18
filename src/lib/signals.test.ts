import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSignalForCoin,
  calculateRSI,
  calculateEMA,
  calculateMACD,
  calculateBollingerBands,
  generateTopSignals,
  resolveLiveEntryPriceSnapshot,
  DEFAULT_NEWS_FEED,
} from './signals';
import {
  generateDeterministicCandles,
  TRACKED_COINS,
  type Candle,
  type CoinMeta,
  type TickerSnapshot,
  type TopGainerCoin,
} from './marketData';

test('RSI stays bounded between 0 and 100 and reflects strong uptrend', () => {
  const uptrend = Array.from({ length: 30 }, (_, i) => 100 + i * 2.5);
  const rsi = calculateRSI(uptrend, 14);
  assert.ok(rsi > 75 && rsi <= 100, `Expected high RSI on uptrend, got ${rsi}`);

  const downtrend = Array.from({ length: 30 }, (_, i) => 200 - i * 2.5);
  const lowRsi = calculateRSI(downtrend, 14);
  assert.ok(lowRsi >= 0 && lowRsi < 25, `Expected low RSI on downtrend, got ${lowRsi}`);
});

test('EMA and MACD track directional momentum accurately', () => {
  const series = Array.from({ length: 50 }, (_, i) => 100 + i * 1.2 + Math.sin(i * 0.4));
  const ema9 = calculateEMA(series, 9);
  const ema21 = calculateEMA(series, 21);
  assert.equal(ema9.length, series.length);
  assert.ok(ema9[ema9.length - 1] > ema21[ema21.length - 1]);

  const macd = calculateMACD(series);
  assert.ok(macd.macdLine > 0);
});

test('Bollinger Bands enforce upper >= middle >= lower', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 50 + Math.sin(i) * 4);
  const bb = calculateBollingerBands(closes, 20, 2);
  assert.ok(bb.upper >= bb.middle);
  assert.ok(bb.middle >= bb.lower);
});

test('generateTopSignals returns exactly top 3 strongest signals sorted by confidence', () => {
  const candlesBySymbol: Record<string, Candle[]> = {};
  for (const coin of TRACKED_COINS) {
    candlesBySymbol[coin.symbol] = generateDeterministicCandles(coin.symbol, '4h', 120);
  }

  const top3 = generateTopSignals(candlesBySymbol, DEFAULT_NEWS_FEED, 3);
  assert.equal(top3.length, 3);
  assert.ok(top3[0].confidence >= top3[1].confidence);
  assert.ok(top3[1].confidence >= top3[2].confidence);

  for (const sig of top3) {
    assert.ok(sig.direction === 'BUY' || sig.direction === 'SELL');
    assert.equal(sig.takeProfits.length, 3);
    assert.ok(sig.reason.includes('Execution & Structure:'));
    assert.ok(sig.reason.includes('Market Context:'));
    assert.ok(!sig.reason.includes('RSI') && !sig.reason.includes('MACD'));
    if (sig.direction === 'BUY') {
      assert.ok(sig.stopLoss < sig.entryPrice);
      assert.ok(sig.takeProfits[0] > sig.entryPrice);
      assert.ok(sig.takeProfits[2] > sig.takeProfits[1]);
    } else {
      assert.ok(sig.stopLoss > sig.entryPrice);
      assert.ok(sig.takeProfits[0] < sig.entryPrice);
      assert.ok(sig.takeProfits[2] < sig.takeProfits[1]);
    }
  }
});

test('generateTopSignals prioritizes dynamic Binance top gainer coins', () => {
  const candlesBySymbol: Record<string, Candle[]> = {};
  for (const coin of TRACKED_COINS) {
    candlesBySymbol[coin.symbol] = generateDeterministicCandles(coin.symbol, '4h', 120);
  }

  const dynamicGainerMeta: CoinMeta = {
    symbol: 'SUIUSDT',
    baseAsset: 'SUI',
    name: 'Sui',
    referencePrice: 3.85,
    dailyVolatility: 0.055,
  };
  candlesBySymbol['SUIUSDT'] = generateDeterministicCandles('SUIUSDT', '4h', 120, undefined, 3.85);

  const topGainers: TopGainerCoin[] = [
    {
      symbol: 'SUIUSDT',
      baseAsset: 'SUI',
      name: 'Sui',
      price: 3.85,
      change24hPercent: 21.4,
      high24h: 3.98,
      low24h: 3.12,
      volume24hUsd: 450_000_000,
      gainerRank: 1,
      isTopGainer: true,
    },
  ];

  const top3 = generateTopSignals(
    candlesBySymbol,
    DEFAULT_NEWS_FEED,
    3,
    [dynamicGainerMeta],
    topGainers
  );

  assert.equal(top3.length, 3);
  const suiSignal = top3.find((s) => s.symbol === 'SUIUSDT');
  assert.ok(suiSignal, 'Expected dynamic Binance top gainer SUIUSDT to be prioritized into Top 3');
  assert.equal(suiSignal?.isTopGainer, true);
  assert.equal(suiSignal?.gainerRank, 1);
  assert.equal(suiSignal?.change24hPercent, 21.4);
  assert.ok(suiSignal?.reason.includes('Binance Top Gainer #1'));
});

test('resolveLiveEntryPriceSnapshot prioritizes active WebSocket feeds over static candle closes', () => {
  const btc = TRACKED_COINS[0];
  const candles = generateDeterministicCandles(btc.symbol, '4h', 120, undefined, 91420);
  const staticClose = Number(candles[candles.length - 1].close.toPrecision(6));

  const withoutWs = resolveLiveEntryPriceSnapshot(candles, btc.referencePrice, {
    price: 65123.45,
    isLiveWs: false,
  });
  assert.equal(withoutWs.source, 'CANDLE_CLOSE');
  assert.equal(withoutWs.entryPrice, staticClose);

  const withWs = resolveLiveEntryPriceSnapshot(candles, btc.referencePrice, {
    price: 65123.45,
    isLiveWs: true,
  });
  assert.equal(withWs.source, 'LIVE_WS_FEED');
  assert.equal(withWs.entryPrice, Number((65123.45).toPrecision(6)));
});

test('buildSignalForCoin and generateTopSignals capture live WebSocket entry prices and keep SL/TP valid', () => {
  const btc = TRACKED_COINS[0];
  const eth = TRACKED_COINS[1];
  const candlesBySymbol: Record<string, Candle[]> = {};
  for (const coin of TRACKED_COINS) {
    candlesBySymbol[coin.symbol] = generateDeterministicCandles(coin.symbol, '4h', 120);
  }

  const liveTickers: Record<string, TickerSnapshot> = {
    [btc.symbol]: {
      symbol: btc.symbol,
      baseAsset: btc.baseAsset,
      name: btc.name,
      price: 64980.25,
      change24hPercent: 1.5,
      high24h: 65500,
      low24h: 63900,
      volume24hUsd: 2_000_000_000,
      isLiveWs: true,
    },
    [eth.symbol]: {
      symbol: eth.symbol,
      baseAsset: eth.baseAsset,
      name: eth.name,
      price: 1842.75,
      change24hPercent: 2.2,
      high24h: 1880,
      low24h: 1790,
      volume24hUsd: 900_000_000,
      isLiveWs: true,
    },
  };

  const btcSig = buildSignalForCoin(
    btc,
    candlesBySymbol[btc.symbol],
    DEFAULT_NEWS_FEED,
    undefined,
    liveTickers[btc.symbol]
  );
  assert.equal(btcSig.entryPriceSource, 'LIVE_WS_FEED');
  assert.equal(btcSig.entryPrice, 64980.3);
  if (btcSig.direction === 'BUY') {
    assert.ok(btcSig.stopLoss < btcSig.entryPrice);
    assert.ok(btcSig.takeProfits[0] > btcSig.entryPrice);
    assert.ok(btcSig.takeProfits[1] > btcSig.takeProfits[0]);
    assert.ok(btcSig.takeProfits[2] > btcSig.takeProfits[1]);
  } else {
    assert.ok(btcSig.stopLoss > btcSig.entryPrice);
    assert.ok(btcSig.takeProfits[0] < btcSig.entryPrice);
    assert.ok(btcSig.takeProfits[1] < btcSig.takeProfits[0]);
    assert.ok(btcSig.takeProfits[2] < btcSig.takeProfits[1]);
  }

  const topAll = generateTopSignals(
    candlesBySymbol,
    DEFAULT_NEWS_FEED,
    TRACKED_COINS.length,
    [],
    [],
    liveTickers
  );
  const ethTop = topAll.find((s) => s.symbol === eth.symbol);
  assert.ok(ethTop);
  assert.equal(ethTop?.entryPriceSource, 'LIVE_WS_FEED');
  assert.equal(ethTop?.entryPrice, 1842.75);
});

test('generateTopSignals returns up to 12 signals with pre-pump scoring, dynamic leverage, and wider ATR trail for Top Gainers', () => {
  const candlesBySymbol: Record<string, Candle[]> = {};
  for (const coin of TRACKED_COINS) {
    candlesBySymbol[coin.symbol] = generateDeterministicCandles(coin.symbol, '4h', 120);
  }
  const suiMeta: CoinMeta = {
    symbol: 'SUIUSDT',
    baseAsset: 'SUI',
    name: 'Sui',
    referencePrice: 3.85,
    dailyVolatility: 0.05,
  };
  const renderMeta: CoinMeta = {
    symbol: 'RENDERUSDT',
    baseAsset: 'RENDER',
    name: 'Render',
    referencePrice: 7.45,
    dailyVolatility: 0.06,
  };
  candlesBySymbol['SUIUSDT'] = generateDeterministicCandles('SUIUSDT', '4h', 120, undefined, 3.85);
  candlesBySymbol['RENDERUSDT'] = generateDeterministicCandles('RENDERUSDT', '4h', 120, undefined, 7.45);

  const gainers: TopGainerCoin[] = [
    {
      symbol: 'SUIUSDT',
      baseAsset: 'SUI',
      name: 'Sui',
      price: 3.85,
      change24hPercent: 18.2,
      high24h: 3.92,
      low24h: 3.15,
      volume24hUsd: 420_000_000,
      gainerRank: 1,
      isTopGainer: true,
      prePumpScore: 91,
      volumeAnomalyRatio: 3.4,
      accumulationPhase: 'MOMENTUM_LEADER',
      institutionalConviction: 'HIGH',
      dynamicLeverageCap: 6,
      wideTrailAtrMult: 2.25,
    },
    {
      symbol: 'RENDERUSDT',
      baseAsset: 'RENDER',
      name: 'Render',
      price: 7.45,
      change24hPercent: 9.4,
      high24h: 7.52,
      low24h: 6.7,
      volume24hUsd: 260_000_000,
      gainerRank: 2,
      isTopGainer: true,
      prePumpScore: 84,
      volumeAnomalyRatio: 2.7,
      accumulationPhase: 'PRE_PUMP_ACCUMULATION',
      institutionalConviction: 'HIGH',
      dynamicLeverageCap: 8,
      wideTrailAtrMult: 2.05,
    },
  ];

  const batch12 = generateTopSignals(
    candlesBySymbol,
    DEFAULT_NEWS_FEED,
    12,
    [suiMeta, renderMeta],
    gainers
  );

  assert.ok(batch12.length >= 6 && batch12.length <= 12, `Expected 6-12 signals, got ${batch12.length}`);
  const suiSig = batch12.find((s) => s.symbol === 'SUIUSDT');
  assert.ok(suiSig, 'Expected SUIUSDT Top Gainer in 12-card batch');
  assert.ok((suiSig?.prePumpScore ?? 0) >= 80);
  assert.ok((suiSig?.trailingAtrMultiplier ?? 0) >= 1.95, 'Top Gainer should have wide ATR trailing multiplier');
  assert.ok((suiSig?.recommendedLeverage ?? 0) >= 2 && (suiSig?.recommendedLeverage ?? 0) <= 15);
});

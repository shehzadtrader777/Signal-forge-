import assert from 'node:assert/strict';
import test from 'node:test';
import { TRACKED_COINS, generateDeterministicCandles } from './marketData';
import { type PinnedSignalRecord } from './pinnedSignals';
import {
  DEFAULT_DRIFT_THRESHOLD_PCT,
  LiveWsFeedController,
  type MinimalWebSocketLike,
  computePriceDiscrepancyPct,
  detectStateDiscrepancy,
  reconcileCandleSeriesToLivePrice,
  reconcilePinnedSignalsToLiveFeed,
  validateIncomingWsTick,
} from './wsDataEngine';

test('validateIncomingWsTick enforces finite positive price, coherent 24h range, and outlier quarantine', () => {
  const validInitial = validateIncomingWsTick({
    symbol: 'btcusdt',
    price: 64392.5,
    change24hPercent: 1.85,
    high24h: 65100,
    low24h: 63200,
    volume24hUsd: 1_250_000_000,
  });
  assert.equal(validInitial.accepted, true);
  assert.equal(validInitial.tick?.symbol, 'BTCUSDT');
  assert.equal(validInitial.tick?.price, 64392.5);

  const nonFinite = validateIncomingWsTick({ symbol: 'BTCUSDT', price: Number.NaN });
  assert.equal(nonFinite.accepted, false);

  const zeroPrice = validateIncomingWsTick({ symbol: 'BTCUSDT', price: 0 });
  assert.equal(zeroPrice.accepted, false);

  const invertedRange = validateIncomingWsTick({
    symbol: 'BTCUSDT',
    price: 64500,
    high24h: 60000,
    low24h: 66000,
  });
  assert.equal(invertedRange.accepted, false);

  const outlierSpike = validateIncomingWsTick(
    { symbol: 'BTCUSDT', price: 98000 },
    { previousPrice: 64392.5 }
  );
  assert.equal(outlierSpike.accepted, false);

  const validVolumeNeg = validateIncomingWsTick({
    symbol: 'BTCUSDT',
    price: 64400,
    volume24hUsd: -10,
  });
  assert.equal(validVolumeNeg.accepted, false);
});

test('detectStateDiscrepancy flags chart, signal ticker, and signal card drift beyond percentage threshold', () => {
  const aligned = detectStateDiscrepancy({
    symbol: 'BTCUSDT',
    authoritativePrice: 64500,
    plottedClosePrice: 64480,
    signalTickerPrice: 64490,
    signalCardEntryPrice: 64300,
    thresholdPct: DEFAULT_DRIFT_THRESHOLD_PCT,
  });
  assert.equal(aligned.drifted, false);
  assert.ok(aligned.plottedDiscrepancyPct < 0.5);

  const drifted = detectStateDiscrepancy({
    symbol: 'BTCUSDT',
    authoritativePrice: 64392,
    plottedClosePrice: 91420,
    signalTickerPrice: 91420,
    signalCardEntryPrice: 91420,
    thresholdPct: DEFAULT_DRIFT_THRESHOLD_PCT,
  });
  assert.equal(drifted.drifted, true);
  assert.ok(drifted.plottedDiscrepancyPct > 40);
  assert.equal(drifted.reasons.length, 3);
});

test('reconcileCandleSeriesToLivePrice re-anchors drifted cache series cleanly and updates intrabar ticks', () => {
  // Simulate cache candles seeded at stale $91,420 while live WS trades at $64,392
  const staleSeedCandles = generateDeterministicCandles('BTCUSDT', '4h', 120, 1700000000, 91420);
  const reanchored = reconcileCandleSeriesToLivePrice(
    staleSeedCandles,
    64392,
    DEFAULT_DRIFT_THRESHOLD_PCT,
    'cache'
  );
  assert.equal(reanchored.reconciled, true);
  assert.equal(reanchored.mode, 'full_reanchor');
  assert.equal(reanchored.candles.length, staleSeedCandles.length);
  const lastReanchored = reanchored.candles[reanchored.candles.length - 1];
  assert.equal(lastReanchored.close, 64392);
  assert.ok(lastReanchored.high >= lastReanchored.close);
  assert.ok(lastReanchored.low <= lastReanchored.close);
  // Earlier candles should now smoothly sit near $64k domain instead of $91k
  assert.ok(reanchored.candles[0].close < 75000);

  // Genuine binance historical series with 1.1% intrabar move only reconciles trailing candle
  const liveCandles = reanchored.candles;
  const intrabarTarget = Number((64392 * 1.011).toFixed(2));
  const intrabar = reconcileCandleSeriesToLivePrice(
    liveCandles,
    intrabarTarget,
    DEFAULT_DRIFT_THRESHOLD_PCT,
    'binance'
  );
  assert.equal(intrabar.reconciled, true);
  assert.equal(intrabar.mode, 'intrabar_tick');
  assert.equal(intrabar.candles[0].close, liveCandles[0].close);
  assert.equal(intrabar.candles[intrabar.candles.length - 1].close, intrabarTarget);
});

test('reconcilePinnedSignalsToLiveFeed purges drifted seed pins and synchronizes live mark prices', () => {
  const basePin: PinnedSignalRecord = {
    signal: {
      id: 'sig_btc',
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      coinName: 'Bitcoin',
      direction: 'BUY',
      confidence: 88,
      technicalScore: 82,
      fundamentalScore: 70,
      entryPrice: 91420,
      entryPriceSource: 'LIVE_WS_FEED',
      stopLoss: 89600,
      takeProfits: [93500, 95500, 98000],
      reason: 'Seed anchor test',
      indicators: {
        rsi: 58,
        ema9: 91300,
        ema21: 91100,
        ema50: 90200,
        macdLine: 210,
        macdSignal: 90,
        macdHistogram: 120,
        bbUpper: 92400,
        bbMiddle: 91100,
        bbLower: 89800,
        bbPercentB: 0.72,
        pattern: 'Breakout',
        score: 78,
        summary: 'Bullish breakout',
      },
      fundamental: {
        score: 70,
        articleCount: 4,
        bullishCount: 3,
        bearishCount: 1,
        topHeadline: 'Spot demand rising',
        summary: 'Bullish flow',
      },
      generatedAt: new Date().toISOString(),
    },
    pinnedAt: new Date().toISOString(),
    status: 'ACTIVE',
    highestTpHit: 0,
    atr14: 950,
    trailingStopLoss: 90232,
    currentPrice: 91420,
    unrealizedR: 0,
  };

  const livePin: PinnedSignalRecord = {
    ...basePin,
    signal: {
      ...basePin.signal,
      id: 'sig_eth',
      symbol: 'ETHUSDT',
      baseAsset: 'ETH',
      coinName: 'Ethereum',
      entryPrice: 1900,
      stopLoss: 1862,
      takeProfits: [1950, 2000, 2090],
    },
    trailingStopLoss: 1875,
    currentPrice: 1900,
  };

  const reconciled = reconcilePinnedSignalsToLiveFeed(
    [basePin, livePin],
    { BTCUSDT: 64392, ETHUSDT: 1922 },
    DEFAULT_DRIFT_THRESHOLD_PCT
  );

  // Stale BTC seed pin at $91,420 must be dropped vs $64,392 authoritative feed
  assert.equal(reconciled.droppedCount, 1);
  assert.equal(reconciled.pinned.length, 1);
  assert.equal(reconciled.pinned[0].signal.symbol, 'ETHUSDT');
  assert.equal(reconciled.pinned[0].currentPrice, 1922);
  assert.ok(reconciled.pinned[0].unrealizedR > 0);
});

test('LiveWsFeedController ingests, validates, quarantines anomalies, and flushes coalesced frames decoupled from React', () => {
  const flushedBatches: number[] = [];
  const socketHolder: { socket: MinimalWebSocketLike | null } = { socket: null };

  const controller = new LiveWsFeedController({
    coins: TRACKED_COINS,
    flushIntervalMs: 60_000,
    wsFactory: () => {
      const sock: MinimalWebSocketLike = {
        readyState: 1,
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        close: () => undefined,
      };
      socketHolder.socket = sock;
      return sock;
    },
    onFlushBatch: (batch) => {
      flushedBatches.push(batch.frames.length);
    },
  });

  controller.start();
  assert.ok(socketHolder.socket, 'Expected decoupled WS controller to construct socket');
  socketHolder.socket.onopen?.();

  // Feed valid + invalid ticks in one !miniTicker@arr frame
  socketHolder.socket.onmessage?.({
    data: JSON.stringify({
      stream: '!miniTicker@arr',
      data: [
        { s: 'BTCUSDT', c: '64500.25', o: '63900', h: '64900', l: '63500', q: '1250000000' },
        { s: 'BTCUSDT', c: '-5', o: '63900', h: '64900', l: '63500', q: '1250000000' }, // corrupted tick
        { s: 'ETHUSDT', c: '1935.4', o: '1900', h: '1950', l: '1880', q: '620000000' },
      ],
    }),
  });

  // Outlier jump from 64500 -> 140000 should be quarantined without mutating authoritativePrice
  socketHolder.socket.onmessage?.({
    data: JSON.stringify({
      stream: 'btcusdt@ticker',
      data: { s: 'BTCUSDT', c: '140000', P: '120', h: '140000', l: '63000', q: '1000' },
    }),
  });

  const batch = controller.flushPendingFrames();
  assert.ok(batch);
  assert.equal(batch.frames.length, 2);
  assert.equal(controller.getAuthoritativePrice('BTCUSDT'), 64500.25);
  assert.equal(controller.getAuthoritativePrice('ETHUSDT'), 1935.4);

  const stats = controller.getTelemetrySnapshot();
  assert.equal(stats.validatedTicksCount, 2);
  assert.equal(stats.rejectedTicksCount, 2);
  assert.equal(flushedBatches[0], 2);

  controller.recordReconciliation({
    symbol: 'BTCUSDT',
    scope: 'CHART_CANDLES',
    discrepancyPct: computePriceDiscrepancyPct(64500.25, 91420),
    thresholdPct: DEFAULT_DRIFT_THRESHOLD_PCT,
    previousPrice: 91420,
    authoritativePrice: 64500.25,
    mode: 'full_reanchor',
  });
  assert.equal(controller.getTelemetrySnapshot().driftsResolvedCount, 1);

  controller.stop();
});

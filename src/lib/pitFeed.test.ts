import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BacktestFeed,
  LiveFeed,
  ReplayFeed,
  TripwireFeed,
  TripwireViolationError,
  createLiveFeedKlineChannel,
  executeBoundaryFillAtNextCursor,
  issueEngineLoopToken,
  runStrategyAcrossPitFeed,
  verifyCausalFeatureInvariance,
  type PITFeedView,
  type PITStrategy,
} from './pitFeed';
import { generateDeterministicCandles, type Candle } from './marketData';
import type { MinimalWebSocketLike } from './wsDataEngine';

function buildOneMinuteSeries(startUnixSec: number, minutes: number, startPrice = 50000): Candle[] {
  const out: Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < minutes; i += 1) {
    const time = startUnixSec + i * 60;
    const drift = Math.sin(i / 9) * 18 + (i % 13 === 0 ? 42 : -4);
    const open = price;
    const close = Math.max(100, open + drift);
    const high = Math.max(open, close) + 15;
    const low = Math.min(open, close) - 14;
    out.push({
      time,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: 125 + (i % 7) * 20,
    });
    price = close;
  }
  return out;
}

test('PITFeed contract: history(window) returns immutable view, strategies cannot call advance(), and warmup gates evaluation', () => {
  const candles = generateDeterministicCandles('BTCUSDT', '15m', 60);
  const warmupBars = 20;
  const feed = new TripwireFeed(
    new BacktestFeed(candles, { symbol: 'BTCUSDT', timeframe: '15m', warmupBars })
  );

  let evaluationsBeforeWarmup = 0;
  let evaluationsTotal = 0;

  const maliciousStrategy: PITStrategy = {
    strategyId: 'ADVANCE_PROBE_STRATEGY',
    warmupBars,
    evaluate(view: PITFeedView) {
      evaluationsTotal += 1;
      if (!view.is_warm()) {
        evaluationsBeforeWarmup += 1;
      }

      // 1. Attempting to access advance() from inside strategy must throw
      assert.throws(
        () => {
          const sneaky = view as unknown as { advance?: () => void };
          sneaky.advance?.();
        },
        (err: unknown) =>
          err instanceof TripwireViolationError && err.code === 'STRATEGY_ADVANCE_FORBIDDEN'
      );

      // 2. Attempting to index past closed window length on Tripwire view must throw
      const hist = view.history(10);
      assert.throws(
        () => hist[hist.length],
        (err: unknown) =>
          err instanceof TripwireViolationError && err.code === 'FUTURE_READ_TRIPWIRE'
      );

      // 3. Attempting to mutate frozen history bar must throw
      assert.throws(
        () => {
          const mutableBar = hist[0] as { close: number };
          mutableBar.close = 999999;
        },
        (err: unknown) =>
          err instanceof TripwireViolationError && err.code === 'IMMUTABLE_VIEW_MUTATION'
      );

      return view.cursorIndex() === 25
        ? {
            direction: 'BUY',
            stopLossDistance: 250,
            stopLossPct: 1.0,
            targetRR: 5.0,
            trailingAtrMult: 2.0,
            confidence: 82,
            setupLabel: 'UNIT_PROBE',
          }
        : null;
    },
  };

  const report = runStrategyAcrossPitFeed({ feed, strategy: maliciousStrategy });

  assert.equal(evaluationsBeforeWarmup, 0, 'Strategy must NEVER execute before is_warm()');
  assert.equal(report.warmupBarsSkipped, warmupBars - 1);
  assert.equal(evaluationsTotal, candles.length - (warmupBars - 1));
  assert.equal(report.boundariesCreated, 1);
  assert.equal(report.fillsExecuted, 1);
  assert.equal(report.boundaries[0].signalCursorIndex, 25);
  assert.equal(report.fills[0].fillCursorIndex, 26);
  assert.equal(report.fills[0].fillOpenPrice, candles[26].open);
});

test('Tripwire test: probing future indices, unauthenticated advance(), or same-bar fills raises TripwireViolationError', () => {
  const candles = generateDeterministicCandles('ETHUSDT', '1h', 40);
  const feed = new TripwireFeed(
    new BacktestFeed(candles, { symbol: 'ETHUSDT', timeframe: '1h', warmupBars: 10 })
  );
  const token = issueEngineLoopToken('tripwire_probe_loop');

  // Calling advance with forged token fails immediately
  assert.throws(
    () => feed.advance({ engineId: 'forged_token' }),
    (err: unknown) =>
      err instanceof TripwireViolationError && err.code === 'STRATEGY_ADVANCE_FORBIDDEN'
  );

  // Calling invokeStrategyGuarded before warmup finishes throws WARMUP_VIOLATION
  for (let i = 0; i < 5; i += 1) feed.advance(token);
  assert.equal(feed.is_warm(), false);
  assert.throws(
    () =>
      feed.invokeStrategyGuarded({
        strategyId: 'PRE_WARM_STRATEGY',
        warmupBars: 10,
        evaluate: () => null,
      }),
    (err: unknown) =>
      err instanceof TripwireViolationError && err.code === 'WARMUP_VIOLATION'
  );

  // Probing future index 5 (current cursor is 4) trips FUTURE_READ_TRIPWIRE
  assert.throws(
    () => feed.probeIndex(5),
    (err: unknown) =>
      err instanceof TripwireViolationError && err.code === 'FUTURE_READ_TRIPWIRE'
  );

  // Complete warmup and verify same-bar fill (signal at t, attempted fill at t) fails
  while (!feed.is_warm()) feed.advance(token);
  const tSignalCursor = feed.cursorIndex();
  const dummyBoundary = {
    boundaryType: 'SIGNAL_TO_FILL_BOUNDARY_V1' as const,
    signalId: 'same_bar_probe',
    strategyId: 'PROBE',
    symbol: 'ETHUSDT',
    timeframe: '1h' as const,
    signalCursorIndex: tSignalCursor,
    signalCursorTime: feed.cursorTime(),
    signalBarClosePrice: feed.current()!.close,
    intendedFillCursorIndex: tSignalCursor + 1,
    direction: 'BUY' as const,
    stopLossDistance: 25,
    stopLossPct: 1.0,
    targetRR: 5.0,
    trailingAtrMult: 2.0,
    confidence: 80,
    setupLabel: 'SAME_BAR_PROBE',
    snapshotHistoryAtSignal: Object.freeze([100]),
    isWarmAtSignal: true as const,
    sealedAtClose: true as const,
  };

  assert.throws(
    () => feed.verifyAndRecordTPlusOneFill(dummyBoundary),
    (err: unknown) =>
      err instanceof TripwireViolationError && err.code === 'SAME_BAR_FILL_FORBIDDEN'
  );
  assert.throws(
    () => executeBoundaryFillAtNextCursor(dummyBoundary, feed.asConsumerView()),
    (err: unknown) =>
      err instanceof TripwireViolationError && err.code === 'SAME_BAR_FILL_FORBIDDEN'
  );

  const telemetry = feed.getTelemetry();
  assert.ok(telemetry.futureReadsBlocked >= 1);
  assert.ok(telemetry.illegalAdvanceBlocked >= 1);
  assert.ok(telemetry.warmupViolationsBlocked >= 1);
  assert.ok(telemetry.sameBarFillsBlocked >= 1);
});

test('Three structural implementations (BacktestFeed, ReplayFeed, LiveFeed) execute identical strategy code unchanged with bit-identical results', () => {
  const candles = generateDeterministicCandles('SOLUSDT', '15m', 65);
  const warmupBars = 22;

  const sharedStrategy: PITStrategy = {
    strategyId: 'SHARED_EMA_CROSS_STRATEGY',
    warmupBars,
    evaluate(view: PITFeedView) {
      const f = view.computeFeatures(35);
      const bar = view.current();
      if (!bar) return null;
      if (f.ema9 > f.ema21 && bar.close > f.ema9 && view.cursorIndex() % 7 === 0) {
        return {
          direction: 'BUY',
          stopLossDistance: Math.max(bar.close * 0.008, f.atr14 * 1.4),
          stopLossPct: 1.25,
          targetRR: 5.0,
          trailingAtrMult: 2.0,
          confidence: 84,
          setupLabel: 'EMA9_OVER_EMA21',
        };
      }
      return null;
    },
  };

  // 1. BacktestFeed
  const backtestFeed = new BacktestFeed(candles, {
    symbol: 'SOLUSDT',
    timeframe: '15m',
    warmupBars,
  });
  const backtestReport = runStrategyAcrossPitFeed({
    feed: backtestFeed,
    strategy: sharedStrategy,
  });

  // 2. ReplayFeed with injected unclosed intrabar ticks interleaved before closed bars
  const replayEvents = candles.flatMap((c) => [
    {
      candle: { ...c, close: Number((c.open * 1.003).toPrecision(6)) },
      isClosed: false,
    },
    { candle: c, isClosed: true },
  ]);
  const replayFeed = new ReplayFeed(replayEvents, {
    symbol: 'SOLUSDT',
    timeframe: '15m',
    warmupBars,
  });
  const replayReport = runStrategyAcrossPitFeed({
    feed: replayFeed,
    strategy: sharedStrategy,
  });

  // 3. LiveFeed ingesting intrabar + finalized kline stream frames
  const liveFeed = new LiveFeed(candles.slice(0, 15), {
    symbol: 'SOLUSDT',
    timeframe: '15m',
    warmupBars,
  });
  for (let i = 15; i < candles.length; i += 1) {
    // Intrabar tick ignored for cursor commit
    liveFeed.ingestLiveKlineFrame({
      candle: { ...candles[i], close: candles[i].open },
      isFinal: false,
    });
    // Finalized bar commits cleanly
    const res = liveFeed.ingestLiveKlineFrame({
      candle: candles[i],
      isFinal: true,
    });
    assert.equal(res.accepted, true);
    assert.equal(res.committed, true);
  }
  const liveReport = runStrategyAcrossPitFeed({
    feed: liveFeed,
    strategy: sharedStrategy,
  });

  // 4. TripwireFeed over BacktestFeed
  const tripwireReport = runStrategyAcrossPitFeed({
    feed: new TripwireFeed(
      new BacktestFeed(candles, { symbol: 'SOLUSDT', timeframe: '15m', warmupBars })
    ),
    strategy: sharedStrategy,
  });

  assert.equal(backtestReport.barsProcessed, candles.length);
  assert.equal(replayReport.barsProcessed, candles.length);
  assert.equal(liveReport.barsProcessed, candles.length);
  assert.equal(tripwireReport.barsProcessed, candles.length);

  assert.deepEqual(
    backtestReport.boundaries.map((b) => [b.signalCursorIndex, b.direction, b.signalBarClosePrice]),
    replayReport.boundaries.map((b) => [b.signalCursorIndex, b.direction, b.signalBarClosePrice])
  );
  assert.deepEqual(
    backtestReport.boundaries.map((b) => [b.signalCursorIndex, b.direction, b.signalBarClosePrice]),
    liveReport.boundaries.map((b) => [b.signalCursorIndex, b.direction, b.signalBarClosePrice])
  );
  assert.deepEqual(
    backtestReport.fills.map((f) => [f.fillCursorIndex, f.effectiveEntryPrice, f.takeProfit]),
    liveReport.fills.map((f) => [f.fillCursorIndex, f.effectiveEntryPrice, f.takeProfit])
  );
  assert.deepEqual(
    backtestReport.fills.map((f) => [f.fillCursorIndex, f.effectiveEntryPrice, f.takeProfit]),
    tripwireReport.fills.map((f) => [f.fillCursorIndex, f.effectiveEntryPrice, f.takeProfit])
  );
});

test('Causal feature & Warm-up tests: perturbing future bars leaves features & signals unchanged; first N bars emit zero signals', () => {
  const candles = generateDeterministicCandles('BTCUSDT', '1h', 90);
  const warmupBars = 30;

  let signalCalls = 0;
  const warmupStrategy: PITStrategy = {
    strategyId: 'WARMUP_ZERO_SIGNAL_CHECK',
    warmupBars,
    evaluate(view: PITFeedView) {
      signalCalls += 1;
      const feat = view.computeFeatures(60);
      return {
        direction: feat.ema9 >= feat.ema21 ? 'BUY' : 'SELL',
        stopLossDistance: Math.max(100, feat.atr14 * 1.5),
        stopLossPct: 1.5,
        targetRR: 5.0,
        trailingAtrMult: 2.0,
        confidence: 80,
        setupLabel: 'CAUSAL_EMA_TEST',
      };
    },
  };

  const feed = new TripwireFeed(
    new BacktestFeed(candles, { symbol: 'BTCUSDT', timeframe: '1h', warmupBars })
  );
  const runReport = runStrategyAcrossPitFeed({ feed, strategy: warmupStrategy });

  // Zero signals emitted during first N-1 bars
  assert.equal(runReport.warmupBarsSkipped, warmupBars - 1);
  assert.equal(signalCalls, candles.length - (warmupBars - 1));
  assert.ok(
    runReport.boundaries.every((b) => b.signalCursorIndex >= warmupBars - 1 && b.isWarmAtSignal)
  );

  // Causal perturbation at cursor 45: massive 8x shock on all future bars [46..89]
  const causalCheck = verifyCausalFeatureInvariance({
    candles,
    symbol: 'BTCUSDT',
    timeframe: '1h',
    cursorIndex: 45,
    warmupBars,
    strategy: warmupStrategy,
  });

  assert.equal(causalCheck.invariant, true);
  assert.equal(causalCheck.baseFeatures.ema9, causalCheck.perturbedFeatures.ema9);
  assert.equal(causalCheck.baseFeatures.ema21, causalCheck.perturbedFeatures.ema21);
  assert.equal(causalCheck.baseFeatures.ema50, causalCheck.perturbedFeatures.ema50);
  assert.equal(causalCheck.baseFeatures.rsi14, causalCheck.perturbedFeatures.rsi14);
  assert.equal(causalCheck.baseFeatures.atr14, causalCheck.perturbedFeatures.atr14);
  assert.equal(causalCheck.baseSignalDirection, causalCheck.perturbedSignalDirection);
});

test('Multi-timeframe closed-direction rule: 1h signal on 1m data only sees closed 1h bars and rejects reverse-direction peeking', () => {
  // Align cleanly on 00:00:00 UTC hour boundary
  const hourZero = 1700006400; // divisible by 3600
  const oneMinBars = buildOneMinuteSeries(hourZero, 125, 42000);
  const oneHourBars: Candle[] = [
    { time: hourZero - 3600, open: 41800, high: 42100, low: 41700, close: 42000, volume: 1200 },
    { time: hourZero, open: 42000, high: 42500, low: 41900, close: 42350, volume: 1500 },
    { time: hourZero + 3600, open: 42350, high: 42900, low: 42200, close: 42800, volume: 1800 },
  ];

  const feed = new TripwireFeed(
    new BacktestFeed(oneMinBars, {
      symbol: 'BTCUSDT',
      timeframe: '1m',
      warmupBars: 5,
      higherTimeframes: { '1h': oneHourBars },
    })
  );
  const token = issueEngineLoopToken('mtf_1m_to_1h_test');

  // Advance to 00:58 (index 58, closeTime = hourZero + 59*60 < hourZero + 3600):
  // The hourZero 1h bar has NOT closed yet -> ONLY prior hourZero - 3600 bar is visible!
  for (let i = 0; i <= 58; i += 1) {
    feed.advance(token);
  }
  const htfBeforeHourClose = feed.historyForTimeframe('1h', 10);
  assert.equal(htfBeforeHourClose.length, 1);
  assert.equal(htfBeforeHourClose[0].time, hourZero - 3600);

  // Advance 1 more minute to 00:59 (index 59, closeTime = hourZero + 60*60 === hourZero + 3600):
  // Now the hourZero 1h bar HAS closed -> both prior and current 1h bars become visible!
  feed.advance(token);
  const htfAtHourClose = feed.historyForTimeframe('1h', 10);
  assert.equal(htfAtHourClose.length, 2);
  assert.equal(htfAtHourClose[1].time, hourZero);

  // Also test dynamic 1m->1h closed aggregation without explicit higherTimeframes map
  const autoFeed = new TripwireFeed(
    new BacktestFeed(oneMinBars, {
      symbol: 'BTCUSDT',
      timeframe: '1m',
      warmupBars: 5,
    })
  );
  for (let i = 0; i <= 58; i += 1) autoFeed.advance(token);
  assert.equal(
    autoFeed.historyForTimeframe('1h', 5).length,
    0,
    'Auto-aggregated 1h bar must remain hidden at 00:58 while still forming'
  );
  autoFeed.advance(token); // completes 00:59 -> hourZero + 3600 closed
  const autoHtf = autoFeed.historyForTimeframe('1h', 5);
  assert.equal(autoHtf.length, 1);
  assert.equal(autoHtf[0].time, hourZero);

  // Reverse finer-timeframe read (1m from a 1h feed) must trip UNCLOSED_HTF_READ_FORBIDDEN
  const htfFeed = new TripwireFeed(
    new BacktestFeed(oneHourBars, { symbol: 'BTCUSDT', timeframe: '1h', warmupBars: 1 })
  );
  htfFeed.advance(token);
  assert.throws(
    () => htfFeed.historyForTimeframe('1m', 5),
    (err: unknown) =>
      err instanceof TripwireViolationError && err.code === 'UNCLOSED_HTF_READ_FORBIDDEN'
  );
});

test('LiveKlineChannel keeps live socket ingestion strictly inside L1 LiveFeed', () => {
  const createdSockets: MinimalWebSocketLike[] = [];
  const updates: Array<{ time: number; close: number; isFinal: boolean }> = [];

  const handle = createLiveFeedKlineChannel({
    symbol: 'BTCUSDT',
    timeframe: '15m',
    wsFactory: () => {
      const sock: MinimalWebSocketLike = {
        readyState: 1,
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        close: () => {
          sock.readyState = 3;
        },
      };
      createdSockets.push(sock);
      return sock;
    },
    onBarUpdate: (bar, meta) => {
      updates.push({ time: bar.time, close: bar.close, isFinal: meta.isFinal });
    },
  });

  assert.equal(createdSockets.length, 1);
  const mockSocket = createdSockets[0];
  mockSocket.onopen?.();
  // Send unfinalized tick then finalized bar
  mockSocket.onmessage?.({
    data: JSON.stringify({
      k: { t: 1700006400000, o: '91000', h: '91100', l: '90950', c: '91050', v: '10', x: false },
    }),
  });
  assert.equal(handle.feed.cursorIndex(), -1, 'Unfinalized tick must not advance PIT closed cursor');

  mockSocket.onmessage?.({
    data: JSON.stringify({
      k: { t: 1700006400000, o: '91000', h: '91200', l: '90950', c: '91180', v: '25', x: true },
    }),
  });
  assert.equal(handle.feed.cursorIndex(), 0, 'Finalized bar advances PIT closed cursor cleanly');
  assert.equal(updates.length, 2);
  handle.stop();
});

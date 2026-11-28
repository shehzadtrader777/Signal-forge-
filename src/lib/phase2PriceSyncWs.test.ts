/**
 * Signal Forge — Phase 2 Automated Validation Suite
 * Price Synchronization & WebSocket Reliability
 *
 * Covers all 10 required Phase 2 validation areas:
 *  1. Price-source consistency and labeling
 *  2. Symbol and market-type matching
 *  3. Bid/Ask and simulated execution calculations
 *  4. Timestamp validation and stale data
 *  5. WebSocket disconnection and recovery
 *  6. Duplicate and out-of-order updates
 *  7. Paper Trading price integrity
 *  8. Existing Stage 1–4 security regression checks
 *  9. Confirmation that Public Signal Approval cannot place orders
 * 10. Confirmation that Live Trading remains disabled
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  buildCanonicalPriceObservation,
  compareChartAndMarketPrice,
  computeBoundedExponentialBackoffMs,
  computeSimulatedPaperExecutionQuote,
  computeSpreadBps,
  evaluateTimestampFreshness,
  normalizeCanonicalSymbol,
  validateMarketObservation,
} from './marketPriceModel';
import {
  LiveWsFeedController,
  type MinimalWebSocketLike,
} from './wsDataEngine';
import {
  HARD_CODED_RISK_PARAMETERS,
  validateAndPrepareCcxtSignal,
} from './freqtradeCoreEngine';
import { FreqtradeCoreServerRuntime } from './freqtradeCoreServer';
import {
  REQUIRED_VERIFIABLE_PAPER_CHECKS,
  type PaperTradeEvidenceInput,
} from './publicSignalValidationEngine';
import { PublicSignalValidationServerRuntime } from './publicSignalValidationServer';
import { TRACKED_COINS } from './marketData';

const ROOT_DIR = path.resolve(import.meta.dirname, '..', '..');

class MockControllableSocket implements MinimalWebSocketLike {
  public readonly url: string;
  public readyState = 0;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onerror: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public closedCount = 0;

  constructor(url: string) {
    this.url = url;
  }

  public open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  public emit(payload: unknown): void {
    this.onmessage?.({
      data: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });
  }

  public disconnect(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  public close(): void {
    this.closedCount += 1;
    this.readyState = 3;
  }
}

function makeEvidence(index: number, nowMs: number, win: boolean): PaperTradeEvidenceInput {
  const observedAtIso = new Date(nowMs - (120 - index) * 60_000).toISOString();
  const closedAtIso = new Date(nowMs - (120 - index) * 60_000 + 30_000).toISOString();
  const entryPrice = 90_500 + index * 12.5;
  const bidPrice = entryPrice - 3.0;
  const askPrice = entryPrice + 3.0;
  const exitPrice = win ? entryPrice * 1.011 : entryPrice * 0.993;
  const stakeUsd = 500;
  return {
    tradeEvidenceId: `p2_obs_${String(index).padStart(3, '0')}`,
    symbol: index % 2 === 0 ? 'BTC/USDT' : 'ETH/USDT',
    side: 'BUY',
    marketSource: 'BINANCE_SPOT_OBSERVATION',
    observedAtIso,
    closedAtIso,
    bidPrice,
    askPrice,
    entryPrice,
    exitPrice,
    stakeUsd,
    feeRate: 0.001,
    feeUsd: stakeUsd * 0.001 * 2,
    spreadBps: 0.66,
    slippageBps: 2.0,
    stopLossPrice: entryPrice * 0.98,
    takeProfitPrice: entryPrice * 1.06,
    isDemonstration: false,
  };
}

// 1. Price-source consistency and labeling
test('1. Price-source consistency & labeling distinguishes Last Traded, Bid, Ask, Mark, Paper Execution and never labels cached/demo prices as live', () => {
  const nowMs = Date.now();
  const liveObs = buildCanonicalPriceObservation({
    symbol: 'BTCUSDT',
    exchange: 'binance',
    marketType: 'SPOT',
    priceType: 'LAST_TRADED',
    lastTradedPrice: 91_420.5,
    bidPrice: 91_418.0,
    askPrice: 91_423.0,
    markPrice: 91_421.0,
    sourceClass: 'LIVE_WS_VERIFIED',
    sourceLabel: 'binance_spot_ws',
    observedAtMs: nowMs - 400,
  });
  assert.ok(liveObs !== null);

  // Legitimate distinct price types must NOT be artificially forced equal
  assert.notEqual(liveObs.bidPrice, liveObs.askPrice);
  assert.notEqual(liveObs.lastTradedPrice, liveObs.markPrice);
  assert.equal(liveObs.priceType, 'LAST_TRADED');
  assert.equal(liveObs.isLiveVerified, true);
  assert.equal(liveObs.isSimulatedOrDemo, false);
  assert.equal(liveObs.quoteCurrency, 'USDT');

  const cachedObs = buildCanonicalPriceObservation({
    symbol: 'BTCUSDT',
    exchange: 'binance',
    marketType: 'SPOT',
    priceType: 'LAST_TRADED',
    lastTradedPrice: 91_400,
    sourceClass: 'CACHED_SIMULATED',
    observedAtMs: nowMs - 200,
  });
  assert.ok(cachedObs !== null);
  assert.equal(cachedObs.isLiveVerified, false);
  assert.equal(cachedObs.isSimulatedOrDemo, true);
  assert.ok(cachedObs.sourceLabel.includes('Not Live'));

  const demoObs = buildCanonicalPriceObservation({
    symbol: 'BTCUSDT',
    exchange: 'binance',
    marketType: 'SPOT',
    priceType: 'LAST_TRADED',
    lastTradedPrice: 91_400,
    sourceClass: 'DEMO_SYNTHETIC',
    observedAtMs: nowMs - 200,
  });
  assert.ok(demoObs !== null);
  assert.equal(demoObs.isLiveVerified, false);
  assert.equal(demoObs.isSimulatedOrDemo, true);
  assert.ok(demoObs.sourceLabel.includes('Demo'));

  // Strict live validation rejects both cached and demo observations
  assert.equal(
    validateMarketObservation(
      cachedObs,
      { symbol: 'BTC/USDT', requireVerifiedNonSimulated: true },
      nowMs
    ).valid,
    false
  );
  assert.equal(
    validateMarketObservation(
      demoObs,
      { symbol: 'BTC/USDT', requireVerifiedNonSimulated: true },
      nowMs
    ).valid,
    false
  );
});

// 2. Symbol and market-type matching
test('2. Symbol, exchange, quote currency, and market-type matching strictly rejects mismatched feeds', () => {
  const nowMs = Date.now();
  const norm = normalizeCanonicalSymbol('eth/usdt');
  assert.ok(norm !== null);
  assert.equal(norm.compact, 'ETHUSDT');
  assert.equal(norm.canonical, 'ETH/USDT');
  assert.equal(norm.baseAsset, 'ETH');
  assert.equal(norm.quoteCurrency, 'USDT');

  const btcSpotObs = buildCanonicalPriceObservation({
    symbol: 'BTC/USDT',
    exchange: 'binance',
    marketType: 'SPOT',
    priceType: 'LAST_TRADED',
    lastTradedPrice: 91_500,
    bidPrice: 91_495,
    askPrice: 91_505,
    sourceClass: 'LIVE_WS_VERIFIED',
    sourceLabel: 'binance_spot_ws',
    observedAtMs: nowMs - 250,
  });
  assert.ok(btcSpotObs !== null);

  // Symbol mismatch rejected
  const wrongSym = validateMarketObservation(
    btcSpotObs,
    {
      symbol: 'ETH/USDT',
      exchange: 'binance',
      marketType: 'SPOT',
      requireVerifiedNonSimulated: true,
    },
    nowMs
  );
  assert.equal(wrongSym.valid, false);
  assert.ok(wrongSym.reasons.some((r) => r.includes('Symbol mismatch')));

  // Market-type mismatch (SPOT observation vs FUTURES order) rejected
  const wrongMarket = validateMarketObservation(
    btcSpotObs,
    {
      symbol: 'BTC/USDT',
      exchange: 'binance',
      marketType: 'FUTURES',
      requireVerifiedNonSimulated: true,
    },
    nowMs
  );
  assert.equal(wrongMarket.valid, false);
  assert.ok(wrongMarket.reasons.some((r) => r.includes('Market type mismatch')));

  // Exchange mismatch rejected
  const wrongExchange = validateMarketObservation(
    btcSpotObs,
    {
      symbol: 'BTC/USDT',
      exchange: 'bybit',
      marketType: 'SPOT',
      requireVerifiedNonSimulated: true,
    },
    nowMs
  );
  assert.equal(wrongExchange.valid, false);
  assert.ok(wrongExchange.reasons.some((r) => r.includes('Exchange mismatch')));
});

// 3. Bid/Ask and simulated execution calculations
test('3. Bid/Ask spread, BUY=Ask+slippage, SELL=Bid-slippage, taker fees, and SIMULATED_PAPER_ONLY labeling are accurate', () => {
  const nowMs = Date.now();
  const bid = 91_490;
  const ask = 91_510;
  const spreadBps = computeSpreadBps(bid, ask);
  assert.ok(spreadBps !== null && spreadBps > 2.0 && spreadBps < 2.3);

  const obs = buildCanonicalPriceObservation({
    symbol: 'BTC/USDT',
    exchange: 'binance',
    marketType: 'SPOT',
    priceType: 'LAST_TRADED',
    lastTradedPrice: 91_500,
    bidPrice: bid,
    askPrice: ask,
    markPrice: 91_500,
    sourceClass: 'LIVE_WS_VERIFIED',
    sourceLabel: 'binance_spot_bookticker',
    observedAtMs: nowMs - 300,
  });
  assert.ok(obs !== null);

  const buyQuote = computeSimulatedPaperExecutionQuote({
    symbol: 'BTC/USDT',
    exchange: 'binance',
    marketType: 'SPOT',
    side: 'BUY',
    stakeUsd: 1_000,
    leverage: 1,
    takerFeeRate: 0.001,
    slippageBps: 5,
    observation: obs,
    nowMs,
  });
  assert.equal(buyQuote.valid, true);
  assert.equal(buyQuote.priceType, 'PAPER_EXECUTION');
  assert.equal(buyQuote.referencePriceType, 'ASK');
  assert.equal(buyQuote.profitClass, 'SIMULATED_PAPER_ONLY');
  assert.equal(buyQuote.isRealProfit, false);
  assert.equal(buyQuote.paperExecutionPrice, Number((ask * 1.0005).toFixed(6)));
  assert.ok(buyQuote.paperExecutionPrice > obs.lastTradedPrice);
  assert.equal(buyQuote.feeUsd, 1.0);

  const sellQuote = computeSimulatedPaperExecutionQuote({
    symbol: 'BTC/USDT',
    exchange: 'binance',
    marketType: 'SPOT',
    side: 'SELL',
    stakeUsd: 1_000,
    leverage: 1,
    takerFeeRate: 0.001,
    slippageBps: 5,
    observation: obs,
    nowMs,
  });
  assert.equal(sellQuote.valid, true);
  assert.equal(sellQuote.referencePriceType, 'BID');
  assert.equal(sellQuote.paperExecutionPrice, Number((bid * 0.9995).toFixed(6)));
  assert.ok(sellQuote.paperExecutionPrice < obs.lastTradedPrice);

  // Inverted spread (ask < bid) must be rejected at construction time
  const invertedObs = buildCanonicalPriceObservation({
    symbol: 'BTC/USDT',
    exchange: 'binance',
    marketType: 'SPOT',
    priceType: 'LAST_TRADED',
    lastTradedPrice: 91_500,
    bidPrice: 91_520,
    askPrice: 91_500,
    sourceClass: 'LIVE_WS_VERIFIED',
    sourceLabel: 'corrupt_book',
    observedAtMs: nowMs - 100,
  });
  assert.equal(invertedObs, null, 'Inverted Bid/Ask spread (ask < bid) must be rejected');
});

// 4. Timestamp validation and stale data
test('4. UTC timestamp freshness rejects stale (>15s) and future-skewed frames, and blocks cached ticker overwrite of live chart', () => {
  const nowMs = Date.now();
  assert.equal(evaluateTimestampFreshness(nowMs - 1_500, nowMs).freshness, 'FRESH');
  assert.equal(evaluateTimestampFreshness(nowMs - 8_000, nowMs).freshness, 'DELAYED');
  assert.equal(evaluateTimestampFreshness(nowMs - 20_000, nowMs).freshness, 'STALE');
  assert.equal(evaluateTimestampFreshness(nowMs + 10_000, nowMs).freshness, 'INVALID_TIMESTAMP');

  const staleObs = buildCanonicalPriceObservation({
    symbol: 'BTC/USDT',
    exchange: 'binance',
    marketType: 'SPOT',
    priceType: 'LAST_TRADED',
    lastTradedPrice: 91_500,
    sourceClass: 'LIVE_WS_VERIFIED',
    sourceLabel: 'binance_spot_ws',
    observedAtMs: nowMs - 25_000,
  });
  assert.ok(staleObs !== null);
  const staleCheck = validateMarketObservation(
    staleObs,
    { symbol: 'BTC/USDT', requireVerifiedNonSimulated: true },
    nowMs
  );
  assert.equal(staleCheck.valid, false);
  assert.equal(staleCheck.freshness, 'STALE');

  // Chart vs Market comparison: cached market ticker must NOT overwrite verified live chart
  const cachedTicker = buildCanonicalPriceObservation({
    symbol: 'BTC/USDT',
    exchange: 'binance',
    marketType: 'SPOT',
    priceType: 'LAST_TRADED',
    lastTradedPrice: 90_000,
    sourceClass: 'CACHED_SIMULATED',
    observedAtMs: nowMs - 500,
  })!;
  const cachedComparison = compareChartAndMarketPrice({
    symbol: 'BTC/USDT',
    marketType: 'SPOT',
    chartClosePrice: 91_500,
    chartSource: 'binance',
    marketObservation: cachedTicker,
    nowMs,
  });
  assert.equal(cachedComparison.shouldSyncChartToMarket, false);
  assert.ok(cachedComparison.reason.includes('Protected live exchange chart'));

  // Two verified live sources with unintended >50 bps divergence trigger chart sync
  const liveTicker = buildCanonicalPriceObservation({
    symbol: 'BTC/USDT',
    exchange: 'binance',
    marketType: 'SPOT',
    priceType: 'LAST_TRADED',
    lastTradedPrice: 92_100,
    sourceClass: 'LIVE_WS_VERIFIED',
    observedAtMs: nowMs - 200,
  })!;
  const liveComparison = compareChartAndMarketPrice({
    symbol: 'BTC/USDT',
    marketType: 'SPOT',
    chartClosePrice: 91_500,
    chartSource: 'binance',
    marketObservation: liveTicker,
    nowMs,
  });
  assert.equal(liveComparison.unintendedDiscrepancy, true);
  assert.equal(liveComparison.shouldSyncChartToMarket, true);
  assert.ok(liveComparison.discrepancyBps > 50);
});

// 5. WebSocket disconnection and recovery
test('5. WebSocket disconnection uses bounded exponential backoff, reconnects cleanly, and restores subscriptions', async () => {
  // Verify bounded exponential backoff stays <= 30_000ms
  const d0 = computeBoundedExponentialBackoffMs(0, { baseDelayMs: 350, maxDelayMs: 30_000 });
  const d3 = computeBoundedExponentialBackoffMs(3, { baseDelayMs: 350, maxDelayMs: 30_000 });
  const d20 = computeBoundedExponentialBackoffMs(20, { baseDelayMs: 350, maxDelayMs: 30_000 });
  assert.ok(d0 >= 350 && d0 <= 30_000);
  assert.ok(d3 > d0 && d3 <= 30_000);
  assert.equal(d20, 30_000);

  const createdSockets: MockControllableSocket[] = [];
  const controller = new LiveWsFeedController({
    coins: TRACKED_COINS.slice(0, 3),
    reconnectBaseDelayMs: 100,
    maxReconnectAttempts: 5,
    wsFactory: (url) => {
      const sock = new MockControllableSocket(url);
      createdSockets.push(sock);
      return sock;
    },
  });

  try {
    controller.start();
    assert.equal(createdSockets.length, 1);
    const sock1 = createdSockets[0];
    sock1.open();
    const t0 = Date.now();
    sock1.emit({
      stream: 'btcusdt@ticker',
      data: { s: 'BTCUSDT', c: '91500', P: '1.2', h: '92000', l: '90000', q: '500000000', E: t0 },
    });
    assert.equal(controller.getTelemetrySnapshot(t0 + 100).connectionHealth, 'CONNECTED');
    assert.equal(controller.getTelemetrySnapshot(t0 + 100).activeSubscriptions.length, 4);

    // Simulate network drop -> state transitions to RECONNECTING / fallback enforced
    sock1.disconnect();
    const midSnap = controller.getTelemetrySnapshot();
    assert.equal(midSnap.wsConnected, false);
    assert.equal(midSnap.connectionHealth, 'RECONNECTING');
    assert.ok(midSnap.lastDisconnectAtIso !== null);

    // Wait for bounded reconnect timer (min baseDelayMs = 100ms)
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(createdSockets.length, 2, 'Controller must open a fresh WebSocket on reconnect');
    const sock2 = createdSockets[1];
    assert.ok(sock2.url.includes('btcusdt@ticker') && sock2.url.includes('!miniTicker@arr'));

    sock2.open();
    const t1 = Date.now();
    sock2.emit({
      stream: 'btcusdt@ticker',
      data: { s: 'BTCUSDT', c: '91540', P: '1.3', h: '92000', l: '90000', q: '500000000', E: t1 },
    });

    const recoveredSnap = controller.getTelemetrySnapshot(t1 + 50);
    assert.equal(recoveredSnap.wsConnected, true);
    assert.equal(recoveredSnap.connectionHealth, 'CONNECTED');
    assert.equal(recoveredSnap.reconnectCount, 1);
    assert.equal(recoveredSnap.restoredSubscriptionsCount, 4);
    assert.ok(recoveredSnap.lastReconnectAtIso !== null);
    assert.equal(controller.getAuthoritativePrice('BTCUSDT'), 91_540);
  } finally {
    controller.stop();
  }
});

// 6. Duplicate and out-of-order updates
test('6. Duplicate and out-of-order WebSocket frames are dropped and never overwrite newer prices', () => {
  const controller = new LiveWsFeedController({
    coins: TRACKED_COINS.slice(0, 2),
  });
  const baseTs = Date.now() - 2_000;

  // Newer frame arrives first
  const r1 = controller.ingestRawWsPayload(
    JSON.stringify({
      stream: 'btcusdt@ticker',
      data: { s: 'BTCUSDT', c: '92100', P: '1.1', h: '92500', l: '91000', q: '900000000', E: baseTs + 1000 },
    }),
    baseTs + 1000
  );
  assert.equal(r1.acceptedCount, 1);
  assert.equal(controller.getAuthoritativePrice('BTCUSDT'), 92_100);

  // Exact duplicate frame must be dropped
  const rDup = controller.ingestRawWsPayload(
    JSON.stringify({
      stream: 'btcusdt@ticker',
      data: { s: 'BTCUSDT', c: '92100', P: '1.1', h: '92500', l: '91000', q: '900000000', E: baseTs + 1000 },
    }),
    baseTs + 1000
  );
  assert.equal(rDup.acceptedCount, 0);
  assert.equal(rDup.rejectedCount, 1);

  // Out-of-order older frame (even 500ms older) MUST be rejected and NEVER overwrite 92100
  const rOoo = controller.ingestRawWsPayload(
    JSON.stringify({
      stream: 'btcusdt@ticker',
      data: { s: 'BTCUSDT', c: '91850', P: '0.8', h: '92500', l: '91000', q: '900000000', E: baseTs + 500 },
    }),
    baseTs + 500
  );
  assert.equal(rOoo.acceptedCount, 0);
  assert.equal(rOoo.rejectedCount, 1);
  assert.equal(controller.getAuthoritativePrice('BTCUSDT'), 92_100);

  // Future-skewed frame (>5s ahead) MUST be rejected
  const futureTs = Date.now() + 15_000;
  const rFuture = controller.ingestRawWsPayload(
    JSON.stringify({
      stream: 'btcusdt@ticker',
      data: { s: 'BTCUSDT', c: '92200', P: '1.2', h: '92500', l: '91000', q: '900000000', E: futureTs },
    }),
    futureTs
  );
  assert.equal(rFuture.acceptedCount, 0);

  const snap = controller.getTelemetrySnapshot();
  assert.equal(snap.duplicateTicksDroppedCount, 1);
  assert.equal(snap.outOfOrderTicksDroppedCount, 2);
});

// 7. Paper Trading price integrity
test('7. Paper Trading Engine enforces validated Bid/Ask observations, blocks stale/cached/mismatched prices, and records SIMULATED_PAPER_ONLY audit metadata', () => {
  const nowMs = Date.now();
  const runtime = new FreqtradeCoreServerRuntime(ROOT_DIR, { dbPath: ':memory:' });

  try {
    // 7a. Cached-only observation MUST be blocked
    const cachedObs = buildCanonicalPriceObservation({
      symbol: 'BTC/USDT',
      exchange: 'binance',
      marketType: 'SPOT',
      priceType: 'LAST_TRADED',
      lastTradedPrice: 91_500,
      sourceClass: 'CACHED_SIMULATED',
      sourceLabel: 'spot_cache',
      observedAtMs: nowMs - 200,
    })!;
    const blockedCached = runtime.executeStandardizedSignal({
      signalId: 'sig_cached_reject',
      exchange: 'binance',
      symbol: 'BTC/USDT',
      marketType: 'SPOT',
      side: 'BUY',
      entryPrice: 91_500,
      stakeUsd: 500,
      confidencePct: 88,
      marketObservation: cachedObs,
      requireVerifiedMarketObservation: true,
      nowMs,
    });
    assert.equal(blockedCached.ok, false);
    assert.ok(blockedCached.message.includes('Paper execution blocked'));

    // 7b. Stale live observation MUST be blocked
    const staleObs = buildCanonicalPriceObservation({
      symbol: 'BTC/USDT',
      exchange: 'binance',
      marketType: 'SPOT',
      priceType: 'LAST_TRADED',
      lastTradedPrice: 91_500,
      bidPrice: 91_495,
      askPrice: 91_505,
      sourceClass: 'LIVE_WS_VERIFIED',
      sourceLabel: 'binance_spot_ws',
      observedAtMs: nowMs - 30_000,
    })!;
    const blockedStale = runtime.executeStandardizedSignal({
      signalId: 'sig_stale_reject',
      exchange: 'binance',
      symbol: 'BTC/USDT',
      marketType: 'SPOT',
      side: 'BUY',
      entryPrice: 91_500,
      stakeUsd: 500,
      confidencePct: 88,
      marketObservation: staleObs,
      requireVerifiedMarketObservation: true,
      nowMs,
    });
    assert.equal(blockedStale.ok, false);

    // 7c. Valid live observation with Bid/Ask executes at Ask + slippage and persists full price audit fields
    const liveObs = buildCanonicalPriceObservation({
      symbol: 'BTC/USDT',
      exchange: 'binance',
      marketType: 'SPOT',
      priceType: 'LAST_TRADED',
      lastTradedPrice: 91_500,
      bidPrice: 91_495,
      askPrice: 91_505,
      markPrice: 91_500,
      sourceClass: 'LIVE_WS_VERIFIED',
      sourceLabel: 'binance_spot_ws',
      observedAtMs: nowMs - 300,
    })!;
    const execOk = runtime.executeStandardizedSignal({
      signalId: 'sig_valid_live_paper',
      exchange: 'binance',
      symbol: 'BTC/USDT',
      marketType: 'SPOT',
      side: 'BUY',
      entryPrice: 91_500,
      stakeUsd: 500,
      confidencePct: 90,
      marketObservation: liveObs,
      slippageBps: 3,
      requireVerifiedMarketObservation: true,
      nowMs,
    });
    assert.equal(execOk.ok, true);
    assert.equal(execOk.statusCode, 201);

    const snap = runtime.getSnapshot();
    assert.equal(snap.openPositions.length, 1);
    const pos = snap.openPositions[0];
    assert.equal(pos.entryPrice, Number((91_505 * 1.0003).toFixed(6)));
    assert.equal(pos.bidPrice, 91_495);
    assert.equal(pos.askPrice, 91_505);
    assert.ok(pos.spreadBps !== null && pos.spreadBps > 0);
    assert.equal(pos.slippageBps, 3);
    assert.equal(pos.feeUsd, 0.5);
    assert.equal(pos.priceSource, 'binance_spot_ws');
    assert.equal(pos.profitLabel, 'SIMULATED_PAPER_ONLY');
    assert.equal(pos.isRealProfit, false);
    assert.equal(snap.metrics.requiredPaperWins, HARD_CODED_RISK_PARAMETERS.requiredConsecutivePaperWins);

    // Pure route validator check directly
    const directCheck = validateAndPrepareCcxtSignal({
      signalId: 'sig_direct_missing_obs',
      exchange: 'binance',
      symbol: 'BTC/USDT',
      marketType: 'SPOT',
      side: 'BUY',
      entryPrice: 91_500,
      stakeUsd: 500,
      confidencePct: 85,
      requireVerifiedMarketObservation: true,
    });
    assert.equal(directCheck.valid, false);
  } finally {
    runtime.close();
  }
});

// 8, 9, 10. Existing Stage 1–4 security regression checks, Public Signal order isolation, and Live Trading disabled confirmation
test('8–10. Stage 1–4 security gates remain intact, Public Signal Approval cannot place Live or Paper orders, and Live Trading remains strictly disabled', () => {
  const freqtradeCore = new FreqtradeCoreServerRuntime(ROOT_DIR, { dbPath: ':memory:' });
  const gate = new PublicSignalValidationServerRuntime(ROOT_DIR, freqtradeCore, ':memory:');

  try {
    // 10. Live Trading is strictly disabled by default and blocked by 50-consecutive-wins Live Gate
    const initialFt = freqtradeCore.getSnapshot();
    assert.equal(initialFt.metrics.tradingMode, 'PAPER_DRY_RUN');
    assert.equal(initialFt.metrics.liveGateUnlocked, false);
    assert.equal(initialFt.metrics.requiredPaperWins, 50);

    const liveSwitchBlocked = freqtradeCore.setTradingMode('LIVE');
    assert.equal(liveSwitchBlocked.ok, false);
    assert.equal(liveSwitchBlocked.statusCode, 403);
    assert.equal(freqtradeCore.getMetrics().tradingMode, 'PAPER_DRY_RUN');

    // 8. Stage 1–4 regression checks: default OFF, live host rejected, 50-check threshold enforced
    assert.equal(gate.getPublicSignalsFeed().publicPublicationEnabled, false);
    const liveHostBlocked = gate.runStage1TestnetCheck('owner@test', {
      targetHost: 'api.binance.com',
    });
    assert.equal(liveHostBlocked.ok, false);

    const testnetOk = gate.runStage1TestnetCheck('owner@test', {
      targetHost: 'testnet.binance.vision',
    });
    assert.equal(testnetOk.ok, true);

    const nowMs = Date.now();
    for (let i = 1; i <= REQUIRED_VERIFIABLE_PAPER_CHECKS; i++) {
      const rec = gate.recordPaperTradeEvidence('owner@test', makeEvidence(i, nowMs, i % 5 !== 0), nowMs);
      assert.equal(rec.ok, true);
    }

    const candRes = gate.registerCandidateSignal('owner@test', {
      signalId: 'sig_phase2_isolation_test',
      symbol: 'BTC/USDT',
      side: 'BUY',
      entryPrice: 91_500,
      stopLossPrice: 89_670,
      takeProfitPrice: 96_990,
      confidencePct: 91,
      timeframe: '4h',
      strategyName: 'Phase2_Isolation_Verification',
    });
    assert.equal(candRes.ok, true);

    // 9. Public Signal Approval & enabling global display MUST NEVER execute any Live or Paper order
    const approveRes = gate.decidePublicSignalApproval(
      'admin@test',
      'sig_phase2_isolation_test',
      'APPROVE',
      'Phase 2 regression verification — display only'
    );
    assert.equal(approveRes.ok, true);
    assert.equal(approveRes.canTriggerLiveOrders, false);

    const enableDisplay = gate.setGlobalPublicationEnabled(
      'admin@test',
      true,
      'Display-only verification'
    );
    assert.equal(enableDisplay.ok, true);

    const afterApprovalFt = freqtradeCore.getSnapshot();
    assert.equal(
      afterApprovalFt.openPositions.length,
      0,
      'Public Signal Approval must NEVER create a Paper or Live position'
    );
    assert.equal(afterApprovalFt.closedTrades.length, 0);
    assert.equal(afterApprovalFt.metrics.tradingMode, 'PAPER_DRY_RUN');
    assert.equal(afterApprovalFt.metrics.liveGateUnlocked, false);
  } finally {
    gate.close();
    freqtradeCore.close();
  }
});

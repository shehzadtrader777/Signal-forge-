import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  verifyAuthoritativeExecutionPrice,
  validateBinanceSpotTickerRecord,
  validateBinanceBookTickerRecord,
  validateBinanceFuturesTickerRecord,
  validateStage2PaperEvidencePriceCoherence,
} from './liveFeedValidator';
import { TRACKED_COINS } from './marketData';
import { validateIncomingWsTick, LiveWsFeedController } from './wsDataEngine';
import {
  probeHybridRuntimeDiagnostics,
  HybridArchitectureServerRuntime,
} from './hybridArchitectureServer';

describe('Gap 1 — Authoritative Execution Price & Operator Bypass Prevention', () => {
  const nowMs = 1_760_000_000_000;

  it('rejects simulated, cached, or missing feed sources even when no client price is sent', () => {
    for (const badSource of ['cached_fallback', 'simulated', 'binance_demo', '', undefined]) {
      const result = verifyAuthoritativeExecutionPrice({
        symbol: 'BTCUSDT',
        priceKind: 'ENTRY',
        serverPrice: 95_000,
        feedSource: badSource,
        observedAtMs: nowMs - 1_000,
        nowMs,
      });
      assert.equal(result.ok, false);
      assert.equal(result.statusCode, 503);
      assert.equal(result.code, 'UNVERIFIED_FEED_SOURCE');
    }
  });

  it('rejects stale or future-skewed server feed timestamps', () => {
    const staleResult = verifyAuthoritativeExecutionPrice({
      symbol: 'BTCUSDT',
      priceKind: 'ENTRY',
      serverPrice: 95_000,
      feedSource: 'binance_spot',
      observedAtMs: nowMs - 120_000,
      nowMs,
    });
    assert.equal(staleResult.ok, false);
    assert.equal(staleResult.statusCode, 503);
    assert.equal(staleResult.code, 'STALE_OR_INVALID_TIMESTAMP');
    assert.equal(staleResult.freshness, 'STALE');

    const futureResult = verifyAuthoritativeExecutionPrice({
      symbol: 'BTCUSDT',
      priceKind: 'EXIT',
      serverPrice: 95_000,
      feedSource: 'binance_spot',
      observedAtMs: nowMs + 60_000,
      nowMs,
    });
    assert.equal(futureResult.ok, false);
    assert.equal(futureResult.statusCode, 503);
    assert.equal(futureResult.code, 'STALE_OR_INVALID_TIMESTAMP');
    assert.equal(futureResult.freshness, 'INVALID_TIMESTAMP');
  });

  it('blocks tampered client or operator entryPrice beyond 0.5% slippage ceiling', () => {
    const tampered = verifyAuthoritativeExecutionPrice({
      symbol: 'BTCUSDT',
      priceKind: 'ENTRY',
      serverPrice: 95_000,
      feedSource: 'binance_spot',
      observedAtMs: nowMs - 2_000,
      submittedPrice: 94_000, // ~1.05% off — previously bypassed by syncToLiveMark 1.5% or hasExplicitPrice
      nowMs,
    });
    assert.equal(tampered.ok, false);
    assert.equal(tampered.statusCode, 409);
    assert.equal(tampered.code, 'ENTRY_PRICE_BYPASS_BLOCKED');
    assert.equal(tampered.authoritativePrice, 95_000);
  });

  it('blocks fabricated exitPrice meant to spoof profitable closes', () => {
    const spoofedClose = verifyAuthoritativeExecutionPrice({
      symbol: 'ETHUSDT',
      priceKind: 'EXIT',
      serverPrice: 3_200,
      feedSource: 'binance_futures',
      observedAtMs: nowMs - 1_500,
      submittedPrice: 3_312, // +3.5% fabricated profit close
      nowMs,
    });
    assert.equal(spoofedClose.ok, false);
    assert.equal(spoofedClose.statusCode, 409);
    assert.equal(spoofedClose.code, 'EXIT_PRICE_BYPASS_BLOCKED');
    assert.equal(spoofedClose.authoritativePrice, 3_200);
  });

  it('always resolves authoritative server price even when submittedPrice is within 0.5%', () => {
    const accepted = verifyAuthoritativeExecutionPrice({
      symbol: 'BTCUSDT',
      priceKind: 'ENTRY',
      serverPrice: 95_000,
      feedSource: 'binance_spot',
      observedAtMs: nowMs - 1_000,
      submittedPrice: 94_900, // 0.105% within tolerance
      nowMs,
    });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.authoritativePrice, 95_000); // Server price wins, never client price
  });
});

describe('Gap 2 — Strict Data Validation for Live Spot, Book, Futures & WS Feeds', () => {
  const nowMs = 1_760_000_000_000;
  const allowlist = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);

  it('accepts clean Binance Spot ticker and computes valid mid/spread', () => {
    const res = validateBinanceSpotTickerRecord(
      {
        symbol: 'BTCUSDT',
        lastPrice: '95010.50',
        priceChangePercent: '2.45',
        highPrice: '96200.00',
        lowPrice: '92100.00',
        quoteVolume: '1450000000',
        bidPrice: '95009.00',
        askPrice: '95012.00',
        closeTime: nowMs - 500,
      },
      { previousLivePrice: 94_900, nowMs, allowedSymbols: allowlist }
    );
    assert.equal(res.valid, true);
    assert.ok(res.record);
    assert.equal(res.record.price, 95010.5);
    assert.equal(res.record.bidPrice, 95009);
    assert.equal(res.record.askPrice, 95012);
    assert.ok(res.record.spreadBps !== null && res.record.spreadBps < 2);
  });

  it('rejects malformed spot tickers: non-allowlist, inverted 24h range, crossed book, wide spread, outlier jump, future timestamp', () => {
    assert.equal(
      validateBinanceSpotTickerRecord(
        { symbol: 'SCAMUSDT', lastPrice: '1.0' },
        { nowMs, allowedSymbols: allowlist }
      ).valid,
      false
    );
    assert.equal(
      validateBinanceSpotTickerRecord(
        { symbol: 'BTCUSDT', lastPrice: '95000', highPrice: '90000', lowPrice: '96000' },
        { nowMs, allowedSymbols: allowlist }
      ).valid,
      false
    );
    assert.equal(
      validateBinanceSpotTickerRecord(
        { symbol: 'BTCUSDT', lastPrice: '95000', bidPrice: '95050', askPrice: '95000' },
        { nowMs, allowedSymbols: allowlist }
      ).valid,
      false
    );
    assert.equal(
      validateBinanceSpotTickerRecord(
        { symbol: 'BTCUSDT', lastPrice: '95000', bidPrice: '90000', askPrice: '100000' },
        { nowMs, allowedSymbols: allowlist }
      ).valid,
      false
    );
    assert.equal(
      validateBinanceSpotTickerRecord(
        { symbol: 'BTCUSDT', lastPrice: '120000' },
        { previousLivePrice: 95_000, nowMs, allowedSymbols: allowlist }
      ).valid,
      false
    );
    assert.equal(
      validateBinanceSpotTickerRecord(
        { symbol: 'BTCUSDT', lastPrice: '95000', closeTime: nowMs + 60_000 },
        { nowMs, allowedSymbols: allowlist }
      ).valid,
      false
    );
    assert.equal(
      validateBinanceSpotTickerRecord(
        { symbol: 'BTCUSDT', lastPrice: '95000', quoteVolume: '-100' },
        { nowMs, allowedSymbols: allowlist }
      ).valid,
      false
    );
  });

  it('rejects invalid bookTicker records (crossed bid/ask, >500bps spread, >12% midpoint jump)', () => {
    const validBook = validateBinanceBookTickerRecord(
      { symbol: 'ETHUSDT', bidPrice: '3199.5', askPrice: '3200.5' },
      { referencePrice: 3200, allowedSymbols: allowlist }
    );
    assert.equal(validBook.valid, true);

    assert.equal(
      validateBinanceBookTickerRecord(
        { symbol: 'ETHUSDT', bidPrice: '3210', askPrice: '3200' },
        { referencePrice: 3200, allowedSymbols: allowlist }
      ).valid,
      false
    );
    assert.equal(
      validateBinanceBookTickerRecord(
        { symbol: 'ETHUSDT', bidPrice: '3900', askPrice: '3901' },
        { referencePrice: 3200, allowedSymbols: allowlist }
      ).valid,
      false
    );
  });

  it('validates Binance Futures mark/index basis, funding bounds, and nextFundingTime', () => {
    const okFutures = validateBinanceFuturesTickerRecord(
      {
        symbol: 'BTCUSDT',
        markPrice: '95020',
        indexPrice: '95000',
        lastFundingRate: '0.0001',
        nextFundingTime: nowMs + 3_600_000,
        quoteVolume: '500000000',
        time: nowMs - 200,
      },
      { previousLiveMarkPrice: 94_980, nowMs, allowedSymbols: allowlist }
    );
    assert.equal(okFutures.valid, true);

    // Extreme mark vs index basis (>10%)
    assert.equal(
      validateBinanceFuturesTickerRecord(
        { symbol: 'BTCUSDT', markPrice: '115000', indexPrice: '95000' },
        { nowMs, allowedSymbols: allowlist }
      ).valid,
      false
    );

    // Out-of-bounds funding rate (>5%)
    assert.equal(
      validateBinanceFuturesTickerRecord(
        { symbol: 'BTCUSDT', markPrice: '95000', indexPrice: '95000', lastFundingRate: '0.25' },
        { nowMs, allowedSymbols: allowlist }
      ).valid,
      false
    );

    // Malformed nextFundingTime
    assert.equal(
      validateBinanceFuturesTickerRecord(
        { symbol: 'BTCUSDT', markPrice: '95000', indexPrice: '95000', nextFundingTime: '0' },
        { nowMs, allowedSymbols: allowlist }
      ).valid,
      false
    );
  });

  it('validates Stage 2 paper trade evidence coherence against book + live spot', () => {
    const coherent = validateStage2PaperEvidencePriceCoherence({
      side: 'BUY',
      bidPrice: 94_995,
      askPrice: 95_005,
      entryPrice: 95_014, // ask + ~1bp slippage
      slippageBps: 5,
      observedAtIso: new Date(nowMs - 10_000).toISOString(),
      liveServerPrice: 95_000,
      liveServerSource: 'binance_spot',
      liveServerObservedAtMs: nowMs - 2_000,
      nowMs,
    });
    assert.equal(coherent.valid, true);

    const incoherentBook = validateStage2PaperEvidencePriceCoherence({
      side: 'BUY',
      bidPrice: 94_995,
      askPrice: 95_005,
      entryPrice: 90_000, // fabricated low buy entry
      slippageBps: 5,
      observedAtIso: new Date(nowMs - 10_000).toISOString(),
      liveServerPrice: 95_000,
      liveServerSource: 'binance_spot',
      liveServerObservedAtMs: nowMs - 2_000,
      nowMs,
    });
    assert.equal(incoherentBook.valid, false);

    const fabricatedRecent = validateStage2PaperEvidencePriceCoherence({
      side: 'BUY',
      bidPrice: 50_000,
      askPrice: 50_005,
      entryPrice: 50_005,
      slippageBps: 5,
      observedAtIso: new Date(nowMs - 10_000).toISOString(),
      liveServerPrice: 95_000,
      liveServerSource: 'binance_spot',
      liveServerObservedAtMs: nowMs - 2_000,
      nowMs,
    });
    assert.equal(fabricatedRecent.valid, false);
  });

  it('enforces bid/ask and malformed timestamp rejection in LiveWsFeedController', () => {
    const badTimestamp = validateIncomingWsTick(
      {
        symbol: 'BTCUSDT',
        price: 95_000,
        change24hPercent: 1.2,
        volume24hUsd: 1_000_000,
        receivedAtMs: Number.NaN,
      },
      { nowMs }
    );
    assert.equal(badTimestamp.accepted, false);

    const crossedBook = validateIncomingWsTick(
      {
        symbol: 'BTCUSDT',
        price: 95_000,
        change24hPercent: 1.2,
        volume24hUsd: 1_000_000,
        bidPrice: 95_100,
        askPrice: 95_000,
        receivedAtMs: nowMs - 100,
      },
      { nowMs }
    );
    assert.equal(crossedBook.accepted, false);

    const controller = new LiveWsFeedController({ coins: TRACKED_COINS.slice(0, 2) });
    const result = controller.ingestRawWsPayload(
      JSON.stringify({
        stream: 'btcusdt@ticker',
        data: { s: 'BTCUSDT', c: '95000', P: '1.5', q: '1000000', b: '94999', a: '95001', E: 'bad_ts' },
      }),
      nowMs
    );
    assert.equal(result.acceptedCount, 0);
    assert.equal(result.rejectedCount, 1);
  });
});

describe('Gap 3 — Native Python & Rust Runtime Diagnostics & Control Plane Verification', () => {
  it('truthfully probes Python 3.11 and Rust toolchains in the container', () => {
    const diag = probeHybridRuntimeDiagnostics(process.cwd());
    assert.equal(diag.python.available, true);
    assert.ok(diag.python.version?.startsWith('Python 3.'));
    assert.equal(diag.python.controlPlaneModulePresent, true);
    assert.equal(diag.python.dryRunCorePresent, true);
    assert.equal(diag.python.fableCorePresent, true);
    assert.equal(diag.rust.crateSourcePresent, true);
    assert.ok(diag.rust.remediationSummary.length > 20);
  });

  it('executes the real Python 3.11 hybrid control plane self-test cleanly without shell injection', () => {
    const runtime = new HybridArchitectureServerRuntime(process.cwd(), ':memory:');
    const result = runtime.runPythonControlPlaneSelfTest();
    assert.equal(result.ok, true, result.error);
    assert.ok(result.phase2Clones > 0);
    assert.ok(result.phase3Ticks >= 1_000);
    assert.equal(result.phase4ChamberPromoted, true);
    assert.ok(result.phase6TrackedRows >= 1);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  IsolatedChartAnalysisPool,
  answerLightweightScenarioFollowUp,
  runReadOnlyChartScenarioAnalysis,
  validateChartImageUpload,
  type MarketCandleLite,
} from './chartScannerEngine';

function buildMinimalValidPng(width: number, height: number, includeTextChunk = false): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdrData = [
    (width >>> 24) & 0xff,
    (width >>> 16) & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    (height >>> 24) & 0xff,
    (height >>> 16) & 0xff,
    (height >>> 8) & 0xff,
    height & 0xff,
    8, 2, 0, 0, 0,
  ];
  const makeChunk = (type: string, data: number[]): number[] => {
    const len = data.length;
    return [
      (len >>> 24) & 0xff,
      (len >>> 16) & 0xff,
      (len >>> 8) & 0xff,
      len & 0xff,
      type.charCodeAt(0),
      type.charCodeAt(1),
      type.charCodeAt(2),
      type.charCodeAt(3),
      ...data,
      0, 0, 0, 0,
    ];
  };
  const chunks = [
    ...sig,
    ...makeChunk('IHDR', ihdrData),
    ...(includeTextChunk ? makeChunk('tEXt', [0x41, 0x75, 0x74, 0x68, 0x6f, 0x72, 0x00, 0x55, 0x73, 0x65, 0x72]) : []),
    ...makeChunk('IDAT', [0x78, 0x9c, 0x01, 0x02, 0x03, 0x04]),
    ...makeChunk('IEND', []),
  ];
  return new Uint8Array(chunks);
}

function buildTrendCandles(count: number, startPrice: number, step: number): MarketCandleLite[] {
  const out: MarketCandleLite[] = [];
  let price = startPrice;
  const baseTs = Math.floor(Date.parse('2026-11-23T00:00:00.000Z') / 1000);
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = price + step;
    out.push({
      time: baseTs + i * 3600,
      open,
      high: Math.max(open, close) + Math.abs(step) * 0.6 + startPrice * 0.003,
      low: Math.min(open, close) - Math.abs(step) * 0.6 - startPrice * 0.003,
      close,
      volume: 1000 + i * 15,
    });
    price = close;
  }
  return out;
}

describe('Phases B, C & D — Chart Upload Validation, Scenario Lab & Isolated Pool', () => {
  it('validates real PNG magic bytes + dimensions, strips tEXt metadata, and auto-detects hints', () => {
    const png = buildMinimalValidPng(1280, 720, true);
    const res = validateChartImageUpload({
      bytes: png,
      declaredMimeType: 'image/png',
      fileName: 'binance_BTCUSDT_1h_chart.png',
      visualSignals: {
        chartLikelihoodScore: 84,
        hasCandlestickColorBands: true,
        hasGridOrAxisStructure: true,
        looksLikeMemeOrPhoto: false,
        isBlurryOrCropped: false,
      },
    });

    assert.equal(res.valid, true);
    assert.equal(res.creditsCharged, 0);
    assert.equal(res.widthPx, 1280);
    assert.equal(res.heightPx, 720);
    assert.ok(res.metadataStrippedBytes > 0);
    assert.equal(res.autoDetected.symbol, 'BTCUSDT');
    assert.equal(res.autoDetected.timeframe, '1h');
    assert.equal(res.autoDetected.exchange, 'BINANCE');
    assert.equal(res.autoDetected.requiresUserConfirmation, false);
  });

  it('validates real JPEG (including image/jpg alias, empty mobile MIME, and 0xFF padding) and WebP VP8X with ZERO credits charged', () => {
    // Minimal valid JPEG with APP1 EXIF segment + 0xFF padding byte before SOF0 (1080x2340 mobile portrait)
    const jpeg = new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xe1, 0x00, 0x0a, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x11, 0x22, // APP1 EXIF (12 bytes total)
      0xff, 0xff, 0xc0, // padded SOF0
      0x00, 0x0b, // length 11
      0x08, // precision
      0x09, 0x24, // height 2340
      0x04, 0x38, // width 1080
      0x03, 0x01, 0x11, 0x00,
      0xff, 0xda, 0x00, 0x02, 0x55, 0x66,
      0xff, 0xd9, // EOI
    ]);

    const jpegAlias = validateChartImageUpload({
      bytes: jpeg,
      declaredMimeType: 'image/jpg',
      fileName: 'tradingview_ETHUSDT_4h.jpg',
      visualSignals: { chartLikelihoodScore: 82, hasCandlestickColorBands: true, hasGridOrAxisStructure: true },
    });
    assert.equal(jpegAlias.valid, true);
    assert.equal(jpegAlias.mimeType, 'image/jpeg');
    assert.equal(jpegAlias.widthPx, 1080);
    assert.equal(jpegAlias.heightPx, 2340);
    assert.ok(jpegAlias.metadataStrippedBytes > 0);
    assert.equal(jpegAlias.creditsCharged, 0);

    const jpegEmptyMobileMime = validateChartImageUpload({
      bytes: jpeg,
      declaredMimeType: '',
      fileName: 'Screenshot_20261124.jpg',
      visualSignals: { chartLikelihoodScore: 80, hasCandlestickColorBands: true, hasGridOrAxisStructure: true },
    });
    assert.equal(jpegEmptyMobileMime.valid, true);
    assert.equal(jpegEmptyMobileMime.mimeType, 'image/jpeg');
    assert.equal(jpegEmptyMobileMime.creditsCharged, 0);

    // Minimal valid WebP VP8X (1200x700)
    const webp = new Uint8Array(32);
    webp.set([0x52, 0x49, 0x46, 0x46, 0x18, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50], 0); // RIFF....WEBP
    webp.set([0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], 12); // VP8X header
    const wMinus1 = 1200 - 1;
    const hMinus1 = 700 - 1;
    webp[24] = wMinus1 & 0xff;
    webp[25] = (wMinus1 >> 8) & 0xff;
    webp[26] = (wMinus1 >> 16) & 0xff;
    webp[27] = hMinus1 & 0xff;
    webp[28] = (hMinus1 >> 8) & 0xff;
    webp[29] = (hMinus1 >> 16) & 0xff;

    const webpRes = validateChartImageUpload({
      bytes: webp,
      declaredMimeType: 'image/webp',
      fileName: 'binance_SOLUSDT_15m.webp',
      visualSignals: { chartLikelihoodScore: 85, hasCandlestickColorBands: true, hasGridOrAxisStructure: true },
    });
    assert.equal(webpRes.valid, true);
    assert.equal(webpRes.mimeType, 'image/webp');
    assert.equal(webpRes.widthPx, 1200);
    assert.equal(webpRes.heightPx, 700);
    assert.equal(webpRes.creditsCharged, 0);
  });

  it('rejects spoofed magic bytes, non-chart photos/memes, blurry screenshots, and duplicates with ZERO credits charged', () => {
    const fakePng = new TextEncoder().encode('<svg onload="alert(1)">not a png</svg>');
    const spoofed = validateChartImageUpload({
      bytes: fakePng,
      declaredMimeType: 'image/png',
    });
    assert.equal(spoofed.valid, false);
    assert.equal(spoofed.code, 'REJECTED_MAGIC_BYTES_MISMATCH');
    assert.equal(spoofed.creditsCharged, 0);

    const validPng = buildMinimalValidPng(1000, 600);
    const meme = validateChartImageUpload({
      bytes: validPng,
      declaredMimeType: 'image/png',
      visualSignals: { looksLikeMemeOrPhoto: true, chartLikelihoodScore: 12 },
    });
    assert.equal(meme.valid, false);
    assert.equal(meme.code, 'REJECTED_NOT_A_TRADING_CHART');
    assert.equal(meme.creditsCharged, 0);

    const blurry = validateChartImageUpload({
      bytes: validPng,
      declaredMimeType: 'image/png',
      visualSignals: { isBlurryOrCropped: true, chartLikelihoodScore: 48 },
    });
    assert.equal(blurry.valid, false);
    assert.equal(blurry.code, 'NEEDS_CLEARER_SCREENSHOT');
    assert.equal(blurry.creditsCharged, 0);

    const first = validateChartImageUpload({
      bytes: validPng,
      declaredMimeType: 'image/png',
      visualSignals: { chartLikelihoodScore: 80 },
    });
    assert.equal(first.valid, true);
    const dup = validateChartImageUpload({
      bytes: validPng,
      declaredMimeType: 'image/png',
      visualSignals: { chartLikelihoodScore: 80 },
      recentFingerprintsForAccount: new Set([first.contentFingerprint]),
    });
    assert.equal(dup.valid, false);
    assert.equal(dup.code, 'REJECTED_DUPLICATE_SUBMISSION');
    assert.equal(dup.creditsCharged, 0);
  });

  it('generates conditional Bullish/Bearish/WAIT scenarios without executing orders and answers lightweight follow-ups', () => {
    const bullishCandles = buildTrendCandles(60, 60_000, 120);
    const report = runReadOnlyChartScenarioAnalysis({
      analysisId: 'scan_test_1',
      uploadId: 'upl_1',
      ownerAccountId: 'acct_1',
      symbol: 'BTCUSDT',
      exchange: 'BINANCE',
      marketType: 'SPOT',
      timeframe: '1h',
      tradingStyle: 'INTRADAY',
      userRiskLimitUsd: 100,
      candles: bullishCandles,
      dataSource: 'Binance Spot (Verified REST/WS)',
      dataFreshness: 'FRESH',
    });

    assert.equal(report.orderExecutionAllowed, false);
    assert.equal(report.recommendation, 'CONDITIONAL_BULLISH');
    assert.equal(report.bullishScenario.estimatedDollarLossAtRiskLimit, 100);
    assert.equal(report.bullishScenario.takeProfitTargets.length, 3);
    assert.ok(report.bullishScenario.stopLoss < report.bullishScenario.entryZoneLow);

    // Choppy flat candles -> WAIT_NO_TRADE
    const flatCandles = buildTrendCandles(60, 60_000, 0.5);
    const waitReport = runReadOnlyChartScenarioAnalysis({
      analysisId: 'scan_test_wait',
      uploadId: 'upl_2',
      ownerAccountId: 'acct_1',
      symbol: 'BTCUSDT',
      exchange: 'BINANCE',
      marketType: 'SPOT',
      timeframe: '1h',
      tradingStyle: 'SCALPING',
      userRiskLimitUsd: 50,
      candles: flatCandles,
      dataSource: 'Binance Spot (Verified REST/WS)',
      dataFreshness: 'FRESH',
    });
    assert.equal(waitReport.recommendation, 'WAIT_NO_TRADE');
    assert.ok(waitReport.waitReason && waitReport.waitReason.length > 10);

    // Lightweight follow-up sizing math
    const follow = answerLightweightScenarioFollowUp({
      report,
      question: 'What is my position size for $100 risk?',
      customRiskUsd: 100,
    });
    assert.equal(follow.ok, true);
    assert.ok((follow.positionSizeUnits ?? 0) > 0);
    assert.equal(follow.followUpsRemaining, 2);
  });

  it('enforces bounded worker concurrency, credit refunds on failure, daily quotas, and emergency suspension', () => {
    const pool = new IsolatedChartAnalysisPool({
      maxConcurrentJobs: 1,
      maxQueueDepth: 1,
      dailyAiCostBudgetUsd: 10,
      estimatedCostPerScanUsd: 0.05,
    });

    pool.adjustAccountCreditsAndPlan({
      accountId: 'user_a',
      planTier: 'PAY_PER_SCAN',
      creditDelta: 5,
    });

    const j1 = pool.reserveJobSlot({ jobId: 'job_1', accountId: 'user_a', uploadId: 'u1' });
    assert.equal(j1.accepted, true);
    assert.equal(j1.code, 'JOB_RUNNING');

    const j2 = pool.reserveJobSlot({ jobId: 'job_2', accountId: 'user_a', uploadId: 'u2' });
    assert.equal(j2.accepted, true);
    assert.equal(j2.code, 'JOB_QUEUED');

    // 3rd simultaneous job rejected gracefully (capacity exhausted) without taking credits
    const balanceBeforeReject = j2.account.creditBalance;
    const j3 = pool.reserveJobSlot({ jobId: 'job_3', accountId: 'user_a', uploadId: 'u3' });
    assert.equal(j3.accepted, false);
    assert.equal(j3.httpStatus, 503);
    assert.equal(j3.code, 'CAPACITY_EXHAUSTED');
    assert.equal(j3.account.creditBalance, balanceBeforeReject);

    // Failure automatically refunds credit & promotes queued job_2
    const refunded = pool.failOrCancelJobWithRefund('job_1', 'FAILED_REFUNDED', 'Upstream timeout');
    assert.equal(refunded.job?.creditsRefunded, 1);
    assert.equal(refunded.account?.creditBalance, balanceBeforeReject + 1);
    assert.equal(pool.getPoolSnapshot().activeRunningJobs, 1);

    // Emergency suspend immediately blocks new customer jobs
    pool.updateLimits({ emergencySuspended: true });
    const blocked = pool.reserveJobSlot({ jobId: 'job_4', accountId: 'user_a', uploadId: 'u4' });
    assert.equal(blocked.accepted, false);
    assert.equal(blocked.code, 'SERVICE_SUSPENDED');
  });
});

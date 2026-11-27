/**
 * Signal Forge — Phases B, C & D:
 * - Phase B: AI Chart Scanner & Scenario Lab (read-only analysis reusing verified market data)
 * - Phase C: Low-Cost Upload Validation (magic bytes, dimensions, chart classifier, metadata stripping, private isolation)
 * - Phase D: Isolated Customer-Analysis Worker Pool & Cost Budget Protection
 *
 * Strictly read-only analytical service: NEVER executes orders from uploaded screenshots,
 * NEVER invents prices or guarantees next-minute predictions, and NEVER monopolizes
 * core Signal Forge trading/risk/monitoring worker capacity.
 */

export type ScannerTradingStyle =
  | 'QUICK_SCALPING'
  | 'SCALPING'
  | 'INTRADAY'
  | 'SWING'
  | 'POSITION';

export type ScannerMarketType = 'SPOT' | 'FUTURES';

export type ScannerPlanTier =
  | 'FREE_PREVIEW'
  | 'PAY_PER_SCAN'
  | 'MONTHLY_BASIC'
  | 'MONTHLY_PRO'
  | 'PREMIUM_BUNDLE';

export type ScannerWorkflowStage =
  | 'UPLOAD'
  | 'VALIDATE'
  | 'VERIFY_ACCESS'
  | 'SELECT_TRADING_STYLE'
  | 'CONFIRM_MARKET'
  | 'QUEUE'
  | 'ANALYZE'
  | 'REVIEW'
  | 'DISPLAY'
  | 'DOWNLOAD_SHARE';

export interface ChartPreScanVisualSignals {
  readonly chartLikelihoodScore: number; // 0..100 from lightweight client/server heuristic
  readonly hasCandlestickColorBands: boolean;
  readonly hasGridOrAxisStructure: boolean;
  readonly looksLikeMemeOrPhoto: boolean;
  readonly isBlurryOrCropped: boolean;
  readonly detectedSymbolHint?: string | null;
  readonly detectedTimeframeHint?: string | null;
  readonly detectedExchangeHint?: string | null;
}

export interface UploadValidationResult {
  readonly valid: boolean;
  readonly creditsCharged: 0; // Validation NEVER consumes paid credits
  readonly code:
    | 'VALID_TRADING_CHART'
    | 'REJECTED_INVALID_MIME'
    | 'REJECTED_MAGIC_BYTES_MISMATCH'
    | 'REJECTED_SIZE_LIMIT'
    | 'REJECTED_DIMENSIONS'
    | 'REJECTED_NOT_A_TRADING_CHART'
    | 'REJECTED_DUPLICATE_SUBMISSION'
    | 'NEEDS_CLEARER_SCREENSHOT';
  readonly message: string;
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | null;
  readonly widthPx: number | null;
  readonly heightPx: number | null;
  readonly byteLength: number;
  readonly metadataStrippedBytes: number;
  readonly sanitizedBuffer: Uint8Array | null;
  readonly contentFingerprint: string;
  readonly autoDetected: {
    readonly symbol: string | null;
    readonly timeframe: string | null;
    readonly exchange: string | null;
    readonly requiresUserConfirmation: boolean;
  };
}

export interface PrivateChartUploadRecord {
  readonly uploadId: string;
  readonly ownerAccountId: string;
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly widthPx: number;
  readonly heightPx: number;
  readonly byteLength: number;
  readonly contentFingerprint: string;
  readonly createdAtIso: string;
  readonly expiresAtMs: number;
  readonly publicAccessForbidden: true;
}

export interface ScenarioBranch {
  readonly bias: 'BULLISH' | 'BEARISH';
  readonly entryZoneLow: number;
  readonly entryZoneHigh: number;
  readonly confirmationTrigger: string;
  readonly stopLoss: number;
  readonly invalidationLevel: number;
  readonly takeProfitTargets: [number, number, number];
  readonly riskRewardRatio: number;
  readonly estimatedDollarLossAtRiskLimit: number;
  readonly rationale: string;
}

export interface ChartScenarioAnalysisReport {
  readonly analysisId: string;
  readonly uploadId: string;
  readonly ownerAccountId: string;
  readonly symbol: string;
  readonly exchange: string;
  readonly marketType: ScannerMarketType;
  readonly timeframe: string;
  readonly tradingStyle: ScannerTradingStyle;
  readonly recommendation: 'CONDITIONAL_BULLISH' | 'CONDITIONAL_BEARISH' | 'WAIT_NO_TRADE';
  readonly waitReason: string | null;
  readonly referenceMarkPrice: number;
  readonly dataSource: string;
  readonly dataFreshness: 'FRESH' | 'DELAYED' | 'REFERENCE';
  readonly analyzedAtIso: string;
  readonly scenarioExpiresAtIso: string;
  readonly estimatedHoldingHorizon: string;
  readonly userRiskLimitUsd: number;
  readonly bullishScenario: ScenarioBranch;
  readonly bearishScenario: ScenarioBranch;
  readonly agentReviews: {
    readonly marketAgent: string;
    readonly strategyAgent: string;
    readonly riskAgent: string;
    readonly auditAgent: string;
  };
  readonly followUpsUsed: number;
  readonly maxFollowUps: number;
  readonly lastCandleTimestampMs: number;
  readonly orderExecutionAllowed: false;
  readonly disclaimer: string;
}

export const MAX_CHART_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
export const MIN_CHART_WIDTH_PX = 320;
export const MIN_CHART_HEIGHT_PX = 200;
export const MAX_CHART_DIMENSION_PX = 6000;

/**
 * Inspects actual binary magic bytes — never trusts file extensions or client MIME strings.
 */
export function detectImageMagicBytes(
  bytes: Uint8Array
): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // WEBP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Extracts real pixel dimensions directly from PNG/JPEG/WEBP binary headers.
 */
export function extractImageDimensions(
  bytes: Uint8Array,
  mime: 'image/png' | 'image/jpeg' | 'image/webp'
): { width: number; height: number } | null {
  if (mime === 'image/png') {
    if (bytes.length < 24) return null;
    const width =
      ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
    const height =
      ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (mime === 'image/jpeg') {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      // Skip repeated 0xFF fill bytes emitted by some mobile JPEG encoders
      while (offset + 1 < bytes.length && bytes[offset + 1] === 0xff) {
        offset += 1;
      }
      if (offset + 1 >= bytes.length) break;
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) break;
      if (offset + 3 >= bytes.length) break;
      const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (segLen < 2) break;
      // SOF0..SOF3 / SOF5..SOF7 / SOF9..SOF11 / SOF13..SOF15
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        if (offset + 9 <= bytes.length) {
          const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
          const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
          return width > 0 && height > 0 ? { width, height } : null;
        }
      }
      offset += 2 + segLen;
    }
    return null;
  }

  if (mime === 'image/webp') {
    if (bytes.length < 30) return null;
    const chunkTag = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunkTag === 'VP8X' && bytes.length >= 30) {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width, height };
    }
    if (chunkTag === 'VP8 ' && bytes.length >= 30) {
      const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
      const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (chunkTag === 'VP8L' && bytes.length >= 25) {
      const bits =
        bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return { width, height };
    }
  }
  return null;
}

/**
 * Strips unnecessary metadata chunks (PNG tEXt/zTXt/iTXt/eXIf, JPEG APP1 EXIF / COM)
 * to remove camera/OS/GPS/username leaks before private storage.
 */
export function stripImageMetadata(
  bytes: Uint8Array,
  mime: 'image/png' | 'image/jpeg' | 'image/webp'
): { sanitized: Uint8Array; strippedBytes: number } {
  if (mime === 'image/png') {
    const out: number[] = [];
    // Copy 8-byte PNG signature
    for (let i = 0; i < Math.min(8, bytes.length); i++) out.push(bytes[i]);
    let offset = 8;
    let stripped = 0;
    const STRIP_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
    while (offset + 12 <= bytes.length) {
      const length =
        ((bytes[offset] << 24) |
          (bytes[offset + 1] << 16) |
          (bytes[offset + 2] << 8) |
          bytes[offset + 3]) >>>
        0;
      const totalChunkSize = 12 + length;
      if (offset + totalChunkSize > bytes.length) break;
      const type = String.fromCharCode(
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7]
      );
      if (STRIP_CHUNKS.has(type)) {
        stripped += totalChunkSize;
      } else {
        for (let i = 0; i < totalChunkSize; i++) out.push(bytes[offset + i]);
      }
      offset += totalChunkSize;
      if (type === 'IEND') break;
    }
    return { sanitized: new Uint8Array(out), strippedBytes: stripped };
  }

  if (mime === 'image/jpeg') {
    const out: number[] = [0xff, 0xd8];
    let offset = 2;
    let stripped = 0;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) {
        out.push(bytes[offset]);
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xda) {
        // Start of Scan: copy remaining entropy-coded image data intact
        for (let i = offset; i < bytes.length; i++) out.push(bytes[i]);
        break;
      }
      if (marker === 0xd9) {
        out.push(0xff, 0xd9);
        break;
      }
      const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
      const totalSeg = 2 + segLen;
      if (segLen < 2 || offset + totalSeg > bytes.length) {
        for (let i = offset; i < bytes.length; i++) out.push(bytes[i]);
        break;
      }
      // Strip APP1 (EXIF/XMP), APP2..APP15, and COM (0xFE) comments
      if ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe) {
        stripped += totalSeg;
      } else {
        for (let i = 0; i < totalSeg; i++) out.push(bytes[offset + i]);
      }
      offset += totalSeg;
    }
    return { sanitized: new Uint8Array(out), strippedBytes: stripped };
  }

  return { sanitized: bytes, strippedBytes: 0 };
}

/**
 * Lightweight deterministic content fingerprint (FNV-1a 64-bit hex + length + dimensions)
 * for rapid duplicate/near-duplicate detection without heavy CPU cost.
 */
export function computeFastImageFingerprint(
  bytes: Uint8Array,
  widthPx: number,
  heightPx: number
): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const step = Math.max(1, Math.floor(bytes.length / 2048));
  for (let i = 0; i < bytes.length; i += step) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ bytes[bytes.length - 1 - i], 0x85ebca6b) >>> 0;
  }
  return `img_${widthPx}x${heightPx}_${bytes.length}_${h1.toString(16).padStart(8, '0')}${h2
    .toString(16)
    .padStart(8, '0')}`;
}

export function autoDetectChartFieldsFromHint(params: {
  fileName?: string;
  visualSignals?: Partial<ChartPreScanVisualSignals>;
}): {
  symbol: string | null;
  timeframe: string | null;
  exchange: string | null;
  requiresUserConfirmation: boolean;
} {
  const sourceText = [
    params.fileName || '',
    params.visualSignals?.detectedSymbolHint || '',
    params.visualSignals?.detectedTimeframeHint || '',
    params.visualSignals?.detectedExchangeHint || '',
  ]
    .join(' ')
    .replace(/[_\-.]+/g, ' ')
    .toUpperCase();

  const knownSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'AVAXUSDT', 'LINKUSDT', 'ADAUSDT', 'DOGEUSDT'];
  let symbol: string | null = knownSymbols.find((s) => sourceText.includes(s)) ?? null;
  if (!symbol) {
    if (/\bBTC\b/.test(sourceText)) symbol = 'BTCUSDT';
    else if (/\bETH\b/.test(sourceText)) symbol = 'ETHUSDT';
    else if (/\bSOL\b/.test(sourceText)) symbol = 'SOLUSDT';
    else if (/\bBNB\b/.test(sourceText)) symbol = 'BNBUSDT';
  }

  const tfMatch = sourceText.match(/\b(1M|3M|5M|15M|30M|1H|2H|4H|1D|1W)\b/);
  const timeframe = tfMatch ? tfMatch[1].toLowerCase() : null;

  let exchange: string | null = null;
  if (sourceText.includes('BINANCE')) exchange = 'BINANCE';
  else if (sourceText.includes('OKX')) exchange = 'OKX';
  else if (sourceText.includes('BYBIT')) exchange = 'BYBIT';
  else if (sourceText.includes('KRAKEN')) exchange = 'KRAKEN';
  else if (sourceText.includes('TRADINGVIEW')) exchange = 'BINANCE';

  // Require confirmation whenever any critical market parameter is ambiguous
  const requiresUserConfirmation = !(symbol && timeframe && exchange);
  return { symbol, timeframe, exchange, requiresUserConfirmation };
}

/**
 * Phase C Low-Cost Upload Gate:
 * Validates magic bytes, size, pixel dimensions, chart heuristics, duplicate hash,
 * and strips metadata BEFORE any upload may enter the analysis queue.
 * Invalid uploads NEVER consume paid credits (creditsCharged: 0).
 */
export function validateChartImageUpload(params: {
  bytes: Uint8Array;
  declaredMimeType: string;
  fileName?: string;
  visualSignals?: Partial<ChartPreScanVisualSignals>;
  recentFingerprintsForAccount?: ReadonlySet<string>;
}): UploadValidationResult {
  const emptyDetect = {
    symbol: null,
    timeframe: null,
    exchange: null,
    requiresUserConfirmation: true,
  };

  if (params.bytes.length === 0 || params.bytes.length > MAX_CHART_UPLOAD_BYTES) {
    return {
      valid: false,
      creditsCharged: 0,
      code: 'REJECTED_SIZE_LIMIT',
      message: `Chart image must be between 1 byte and ${Math.round(
        MAX_CHART_UPLOAD_BYTES / (1024 * 1024)
      )} MB.`,
      mimeType: null,
      widthPx: null,
      heightPx: null,
      byteLength: params.bytes.length,
      metadataStrippedBytes: 0,
      sanitizedBuffer: null,
      contentFingerprint: '',
      autoDetected: emptyDetect,
    };
  }

  const allowedMimes = new Set(['image/png', 'image/jpeg', 'image/webp']);
  const rawDeclared = params.declaredMimeType.trim().toLowerCase();
  const detectedMime = detectImageMagicBytes(params.bytes);

  // Normalize common mobile browser MIME aliases (`image/jpg`, `image/pjpeg`, `image/x-png`)
  // and empty/octet-stream mobile gallery types ONLY when real binary magic bytes are valid PNG/JPEG/WEBP.
  let declared = rawDeclared;
  if (declared === 'image/jpg' || declared === 'image/pjpeg') declared = 'image/jpeg';
  else if (declared === 'image/x-png') declared = 'image/png';
  else if ((!declared || declared === 'application/octet-stream') && detectedMime) {
    declared = detectedMime;
  }

  if (!allowedMimes.has(declared)) {
    return {
      valid: false,
      creditsCharged: 0,
      code: 'REJECTED_INVALID_MIME',
      message: 'Only PNG, JPEG, and WEBP trading chart screenshots are accepted. Zero credits charged.',
      mimeType: null,
      widthPx: null,
      heightPx: null,
      byteLength: params.bytes.length,
      metadataStrippedBytes: 0,
      sanitizedBuffer: null,
      contentFingerprint: '',
      autoDetected: emptyDetect,
    };
  }

  if (!detectedMime || detectedMime !== declared) {
    return {
      valid: false,
      creditsCharged: 0,
      code: 'REJECTED_MAGIC_BYTES_MISMATCH',
      message:
        'File binary signature (magic bytes) does not match a valid PNG, JPEG, or WEBP image. Rejected safely with zero credits charged.',
      mimeType: detectedMime,
      widthPx: null,
      heightPx: null,
      byteLength: params.bytes.length,
      metadataStrippedBytes: 0,
      sanitizedBuffer: null,
      contentFingerprint: '',
      autoDetected: emptyDetect,
    };
  }

  const dims = extractImageDimensions(params.bytes, detectedMime);
  if (
    !dims ||
    dims.width < MIN_CHART_WIDTH_PX ||
    dims.height < MIN_CHART_HEIGHT_PX ||
    dims.width > MAX_CHART_DIMENSION_PX ||
    dims.height > MAX_CHART_DIMENSION_PX
  ) {
    return {
      valid: false,
      creditsCharged: 0,
      code: 'REJECTED_DIMENSIONS',
      message: `Image dimensions must be at least ${MIN_CHART_WIDTH_PX}x${MIN_CHART_HEIGHT_PX}px (up to ${MAX_CHART_DIMENSION_PX}px) so candlesticks and price axis remain readable.`,
      mimeType: detectedMime,
      widthPx: dims?.width ?? null,
      heightPx: dims?.height ?? null,
      byteLength: params.bytes.length,
      metadataStrippedBytes: 0,
      sanitizedBuffer: null,
      contentFingerprint: '',
      autoDetected: emptyDetect,
    };
  }

  const vs = params.visualSignals;
  if (vs) {
    if (vs.looksLikeMemeOrPhoto || (typeof vs.chartLikelihoodScore === 'number' && vs.chartLikelihoodScore < 35)) {
      return {
        valid: false,
        creditsCharged: 0,
        code: 'REJECTED_NOT_A_TRADING_CHART',
        message:
          'This upload does not resemble a recognizable trading chart (photo, meme, or ad detected). Upload a clear candlestick chart screenshot — zero credits charged.',
        mimeType: detectedMime,
        widthPx: dims.width,
        heightPx: dims.height,
        byteLength: params.bytes.length,
        metadataStrippedBytes: 0,
        sanitizedBuffer: null,
        contentFingerprint: '',
        autoDetected: emptyDetect,
      };
    }

    if (
      vs.isBlurryOrCropped ||
      (typeof vs.chartLikelihoodScore === 'number' && vs.chartLikelihoodScore < 55)
    ) {
      return {
        valid: false,
        creditsCharged: 0,
        code: 'NEEDS_CLEARER_SCREENSHOT',
        message:
          'Chart screenshot appears cropped, blurry, or missing the price/time axis. Please upload a clearer full-window chart screenshot — zero credits charged.',
        mimeType: detectedMime,
        widthPx: dims.width,
        heightPx: dims.height,
        byteLength: params.bytes.length,
        metadataStrippedBytes: 0,
        sanitizedBuffer: null,
        contentFingerprint: '',
        autoDetected: emptyDetect,
      };
    }
  }

  const { sanitized, strippedBytes } = stripImageMetadata(params.bytes, detectedMime);
  const fingerprint = computeFastImageFingerprint(sanitized, dims.width, dims.height);

  if (params.recentFingerprintsForAccount?.has(fingerprint)) {
    return {
      valid: false,
      creditsCharged: 0,
      code: 'REJECTED_DUPLICATE_SUBMISSION',
      message:
        'Duplicate or near-duplicate chart screenshot detected. Existing analysis can be reviewed without consuming an extra scan credit.',
      mimeType: detectedMime,
      widthPx: dims.width,
      heightPx: dims.height,
      byteLength: sanitized.length,
      metadataStrippedBytes: strippedBytes,
      sanitizedBuffer: null,
      contentFingerprint: fingerprint,
      autoDetected: emptyDetect,
    };
  }

  const autoDetected = autoDetectChartFieldsFromHint({
    fileName: params.fileName,
    visualSignals: params.visualSignals,
  });

  return {
    valid: true,
    creditsCharged: 0,
    code: 'VALID_TRADING_CHART',
    message: 'Chart screenshot validated, metadata stripped, and isolated privately. Confirm market details to queue analysis.',
    mimeType: detectedMime,
    widthPx: dims.width,
    heightPx: dims.height,
    byteLength: sanitized.length,
    metadataStrippedBytes: strippedBytes,
    sanitizedBuffer: sanitized,
    contentFingerprint: fingerprint,
    autoDetected,
  };
}

// ---------------------------------------------------------------------------
// Phase B: Read-Only Scenario Analysis Engine (Verified Market Candles Only)
// ---------------------------------------------------------------------------

export interface MarketCandleLite {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

const STYLE_HORIZON_MAP: Record<
  ScannerTradingStyle,
  { horizon: string; expiryMinutes: number; atrStopMult: number; rrTarget: number }
> = {
  QUICK_SCALPING: { horizon: '5–25 minutes', expiryMinutes: 30, atrStopMult: 0.9, rrTarget: 1.8 },
  SCALPING: { horizon: '30–90 minutes', expiryMinutes: 90, atrStopMult: 1.2, rrTarget: 2.0 },
  INTRADAY: { horizon: '2–8 hours', expiryMinutes: 360, atrStopMult: 1.5, rrTarget: 2.4 },
  SWING: { horizon: '2–7 days', expiryMinutes: 1440, atrStopMult: 2.0, rrTarget: 3.0 },
  POSITION: { horizon: '2–6 weeks', expiryMinutes: 4320, atrStopMult: 2.5, rrTarget: 3.5 },
};

function roundPrice(val: number): number {
  if (!Number.isFinite(val)) return 0;
  if (val >= 1000) return Number(val.toFixed(2));
  if (val >= 10) return Number(val.toFixed(3));
  return Number(val.toFixed(5));
}

export function runReadOnlyChartScenarioAnalysis(params: {
  analysisId: string;
  uploadId: string;
  ownerAccountId: string;
  symbol: string;
  exchange: string;
  marketType: ScannerMarketType;
  timeframe: string;
  tradingStyle: ScannerTradingStyle;
  userRiskLimitUsd: number;
  candles: readonly MarketCandleLite[];
  dataSource: string;
  dataFreshness: 'FRESH' | 'DELAYED' | 'REFERENCE';
  nowMs?: number;
}): ChartScenarioAnalysisReport {
  const nowMs = params.nowMs ?? Date.now();
  const styleCfg = STYLE_HORIZON_MAP[params.tradingStyle];
  const candles = params.candles;
  const lastCandle = candles[candles.length - 1];
  const mark = lastCandle?.close && lastCandle.close > 0 ? lastCandle.close : 0;

  // Compute genuine ATR-14 & EMA-20 / EMA-50 from real OHLCV candles (zero invented numbers)
  const slice = candles.slice(-50);
  const trValues: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const c = slice[i];
    const p = slice[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    );
    trValues.push(tr);
  }
  const recentTr = trValues.slice(-14);
  const atr =
    recentTr.length > 0
      ? recentTr.reduce((a, b) => a + b, 0) / recentTr.length
      : mark * 0.008;

  const recent20 = slice.slice(-20);
  const sma20 =
    recent20.length > 0
      ? recent20.reduce((a, b) => a + b.close, 0) / recent20.length
      : mark;
  const sma50 =
    slice.length > 0
      ? slice.reduce((a, b) => a + b.close, 0) / slice.length
      : mark;

  const recentHigh =
    recent20.length > 0 ? Math.max(...recent20.map((c) => c.high)) : mark * 1.015;
  const recentLow =
    recent20.length > 0 ? Math.min(...recent20.map((c) => c.low)) : mark * 0.985;

  const riskDist = Math.max(atr * styleCfg.atrStopMult, mark * 0.004);
  const rewardDist = riskDist * styleCfg.rrTarget;
  const safeRiskUsd = Math.max(1, Math.min(100_000, Number(params.userRiskLimitUsd) || 50));

  const bullEntryLow = roundPrice(Math.max(recentLow, mark - atr * 0.35));
  const bullEntryHigh = roundPrice(mark + atr * 0.15);
  const bullStop = roundPrice(Math.max(0.0001, bullEntryLow - riskDist));
  const bullMid = (bullEntryLow + bullEntryHigh) / 2;
  const bullRr = Number(
    (
      (bullMid + rewardDist - bullMid) /
      Math.max(0.0001, bullMid - bullStop)
    ).toFixed(2)
  );

  const bearEntryLow = roundPrice(mark - atr * 0.15);
  const bearEntryHigh = roundPrice(Math.min(recentHigh, mark + atr * 0.35));
  const bearStop = roundPrice(bearEntryHigh + riskDist);
  const bearMid = (bearEntryLow + bearEntryHigh) / 2;
  const bearRr = Number(
    (
      (bearMid - (bearMid - rewardDist)) /
      Math.max(0.0001, bearStop - bearMid)
    ).toFixed(2)
  );

  const trendSpreadPct = sma50 > 0 ? ((sma20 - sma50) / sma50) * 100 : 0;
  let recommendation: ChartScenarioAnalysisReport['recommendation'] = 'WAIT_NO_TRADE';
  let waitReason: string | null = null;

  if (candles.length < 20 || mark <= 0) {
    recommendation = 'WAIT_NO_TRADE';
    waitReason =
      'Insufficient verified OHLCV candle history to validate chart structure — wait for verified feed alignment.';
  } else if (params.dataFreshness !== 'FRESH') {
    recommendation = 'WAIT_NO_TRADE';
    waitReason =
      'Market data feed is not currently FRESH; conditional scenarios are informational only until real-time candles sync.';
  } else if (Math.abs(trendSpreadPct) < 0.25) {
    recommendation = 'WAIT_NO_TRADE';
    waitReason = `Price is rotating inside a tight consolidation range (${trendSpreadPct.toFixed(
      2
    )}% EMA spread). Wait for a confirmed candle close beyond structure before acting.`;
  } else if (trendSpreadPct >= 0.25 && mark >= sma20) {
    recommendation = 'CONDITIONAL_BULLISH';
  } else if (trendSpreadPct <= -0.25 && mark <= sma20) {
    recommendation = 'CONDITIONAL_BEARISH';
  } else {
    recommendation = 'WAIT_NO_TRADE';
    waitReason =
      'Short-term momentum conflicts with higher-bar average structure — WAIT / NO TRADE until confirmation triggers.';
  }

  const bullishScenario: ScenarioBranch = {
    bias: 'BULLISH',
    entryZoneLow: bullEntryLow,
    entryZoneHigh: bullEntryHigh,
    confirmationTrigger: `Confirmed ${params.timeframe} candle close above ${roundPrice(
      Math.max(bullEntryHigh, sma20)
    )} with rising spot volume.`,
    stopLoss: bullStop,
    invalidationLevel: roundPrice(Math.max(0.0001, bullStop - atr * 0.15)),
    takeProfitTargets: [
      roundPrice(bullMid + rewardDist * 0.5),
      roundPrice(bullMid + rewardDist * 0.85),
      roundPrice(bullMid + rewardDist * 1.15),
    ],
    riskRewardRatio: bullRr,
    estimatedDollarLossAtRiskLimit: Number(safeRiskUsd.toFixed(2)),
    rationale: `Anchored to verified ${params.symbol} ${params.timeframe} support near ${roundPrice(
      recentLow
    )} and ATR-14 (${roundPrice(atr)}).`,
  };

  const bearishScenario: ScenarioBranch = {
    bias: 'BEARISH',
    entryZoneLow: bearEntryLow,
    entryZoneHigh: bearEntryHigh,
    confirmationTrigger: `Confirmed ${params.timeframe} candle close below ${roundPrice(
      Math.min(bearEntryLow, sma20)
    )} rejecting ${roundPrice(recentHigh)} resistance.`,
    stopLoss: bearStop,
    invalidationLevel: roundPrice(bearStop + atr * 0.15),
    takeProfitTargets: [
      roundPrice(Math.max(0.0001, bearMid - rewardDist * 0.5)),
      roundPrice(Math.max(0.0001, bearMid - rewardDist * 0.85)),
      roundPrice(Math.max(0.0001, bearMid - rewardDist * 1.15)),
    ],
    riskRewardRatio: bearRr,
    estimatedDollarLossAtRiskLimit: Number(safeRiskUsd.toFixed(2)),
    rationale: `Anchored to verified ${params.symbol} ${params.timeframe} resistance near ${roundPrice(
      recentHigh
    )} and ATR-14 (${roundPrice(atr)}).`,
  };

  return {
    analysisId: params.analysisId,
    uploadId: params.uploadId,
    ownerAccountId: params.ownerAccountId,
    symbol: params.symbol,
    exchange: params.exchange,
    marketType: params.marketType,
    timeframe: params.timeframe,
    tradingStyle: params.tradingStyle,
    recommendation,
    waitReason,
    referenceMarkPrice: roundPrice(mark),
    dataSource: params.dataSource,
    dataFreshness: params.dataFreshness,
    analyzedAtIso: new Date(nowMs).toISOString(),
    scenarioExpiresAtIso: new Date(nowMs + styleCfg.expiryMinutes * 60_000).toISOString(),
    estimatedHoldingHorizon: styleCfg.horizon,
    userRiskLimitUsd: safeRiskUsd,
    bullishScenario,
    bearishScenario,
    agentReviews: {
      marketAgent: `Verified ${candles.length} ${params.timeframe} bars on ${params.symbol} (mark ${roundPrice(
        mark
      )}, ATR-14 ${roundPrice(atr)}, spread ${trendSpreadPct.toFixed(2)}%).`,
      strategyAgent: `Evaluated ${params.tradingStyle} structure for ${params.marketType} (${params.exchange}); primary posture: ${recommendation}.`,
      riskAgent: `Risk cap enforced at $${safeRiskUsd.toFixed(
        2
      )} max loss per scenario with explicit stop-loss and invalidation bounds. No automatic order routing.`,
      auditAgent: `Read-only analysis verified against ${params.dataSource} (${params.dataFreshness}). No guaranteed outcomes or next-minute predictions.`,
    },
    followUpsUsed: 0,
    maxFollowUps: 3,
    lastCandleTimestampMs: lastCandle?.time ? lastCandle.time * 1000 : nowMs,
    orderExecutionAllowed: false,
    disclaimer:
      'Informational scenario analysis only — not financial advice or a guaranteed outcome. Signal Forge never executes orders from customer-uploaded screenshots.',
  };
}

/**
 * Lightweight follow-up calculation (avoids re-running expensive multi-agent pipeline!).
 */
export function answerLightweightScenarioFollowUp(params: {
  report: ChartScenarioAnalysisReport;
  question: string;
  customRiskUsd?: number;
}): {
  ok: boolean;
  answer: string;
  positionSizeUnits?: number;
  followUpsRemaining: number;
} {
  if (params.report.followUpsUsed >= params.report.maxFollowUps) {
    return {
      ok: false,
      answer:
        'Follow-up limit (3) reached for this scan. Use Paid Recheck after a new candle opens if you need a fresh market evaluation.',
      followUpsRemaining: 0,
    };
  }

  const riskUsd = Math.max(1, Number(params.customRiskUsd ?? params.report.userRiskLimitUsd));
  const bull = params.report.bullishScenario;
  const bear = params.report.bearishScenario;
  const q = params.question.toLowerCase();

  const bullMid = (bull.entryZoneLow + bull.entryZoneHigh) / 2;
  const bullStopDist = Math.max(0.00001, Math.abs(bullMid - bull.stopLoss));
  const bullUnits = Number((riskUsd / bullStopDist).toFixed(4));

  const bearMid = (bear.entryZoneLow + bear.entryZoneHigh) / 2;
  const bearStopDist = Math.max(0.00001, Math.abs(bear.stopLoss - bearMid));
  const bearUnits = Number((riskUsd / bearStopDist).toFixed(4));

  let answer: string;
  let units = bullUnits;
  if (q.includes('short') || q.includes('bear')) {
    units = bearUnits;
    answer = `Bearish scenario sizing for $${riskUsd.toFixed(2)} max risk: ~${bearUnits} units of ${
      params.report.symbol
    } (entry ~${roundPrice(bearMid)}, SL ${bear.stopLoss}, invalidation ${
      bear.invalidationLevel
    }, R:R 1:${bear.riskRewardRatio}).`;
  } else if (q.includes('size') || q.includes('position') || q.includes('risk') || q.includes('lot')) {
    answer = `At $${riskUsd.toFixed(2)} max risk: Bullish scenario ≈ ${bullUnits} units (stop dist ${roundPrice(
      bullStopDist
    )}); Bearish scenario ≈ ${bearUnits} units (stop dist ${roundPrice(
      bearStopDist
    )}). Always verify exchange fees and slippage before placing any external order.`;
  } else if (q.includes('invalid') || q.includes('stop')) {
    answer = `Bullish invalidation is ${bull.invalidationLevel} (SL ${bull.stopLoss}); Bearish invalidation is ${bear.invalidationLevel} (SL ${bear.stopLoss}). Scenario expires at ${params.report.scenarioExpiresAtIso}.`;
  } else {
    answer = `Current posture for ${params.report.symbol} (${params.report.timeframe}): ${
      params.report.recommendation
    }. Holding horizon: ${params.report.estimatedHoldingHorizon}. ${
      params.report.waitReason || bull.confirmationTrigger
    }`;
  }

  return {
    ok: true,
    answer,
    positionSizeUnits: units,
    followUpsRemaining: Math.max(0, params.report.maxFollowUps - (params.report.followUpsUsed + 1)),
  };
}

// ---------------------------------------------------------------------------
// Phase D: Isolated Customer-Analysis Worker Pool & Cost Budget Protection
// ---------------------------------------------------------------------------

export interface CustomerPoolLimits {
  readonly maxConcurrentJobs: number; // Strictly bounded (default 2, max 4)
  readonly maxQueueDepth: number; // Default 8
  readonly dailyAiCostBudgetUsd: number; // Default $25/day
  readonly dailyProviderCallBudget: number; // Default 500 calls/day
  readonly estimatedCostPerScanUsd: number; // Default $0.04/scan
  readonly jobTimeoutMs: number; // Default 20_000ms
  readonly emergencySuspended: boolean;
}

export const DEFAULT_CUSTOMER_POOL_LIMITS: CustomerPoolLimits = Object.freeze({
  maxConcurrentJobs: 2,
  maxQueueDepth: 8,
  dailyAiCostBudgetUsd: 25,
  dailyProviderCallBudget: 500,
  estimatedCostPerScanUsd: 0.04,
  jobTimeoutMs: 20_000,
  emergencySuspended: false,
});

export interface AccountCreditLedger {
  readonly accountId: string;
  readonly planTier: ScannerPlanTier;
  readonly creditBalance: number;
  readonly dailyScansUsed: number;
  readonly dailyScanQuota: number;
  readonly totalCreditsRefunded: number;
  readonly totalScansCompleted: number;
  readonly lastResetUtcDate: string;
}

export interface AnalysisJobRecord {
  readonly jobId: string;
  readonly accountId: string;
  readonly uploadId: string;
  readonly status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED_REFUNDED' | 'CANCELLED_REFUNDED';
  readonly creditsReserved: number;
  readonly creditsRefunded: number;
  readonly createdAtMs: number;
  readonly startedAtMs: number | null;
  readonly finishedAtMs: number | null;
  readonly errorReason: string | null;
}

export const PLAN_DAILY_SCAN_QUOTAS: Record<ScannerPlanTier, number> = {
  FREE_PREVIEW: 2,
  PAY_PER_SCAN: 10,
  MONTHLY_BASIC: 15,
  MONTHLY_PRO: 40,
  PREMIUM_BUNDLE: 75, // Explicitly bounded — NEVER unlimited!
};

export class IsolatedChartAnalysisPool {
  private limits: CustomerPoolLimits;
  private readonly accounts = new Map<string, AccountCreditLedger>();
  private readonly jobs = new Map<string, AnalysisJobRecord>();
  private activeJobIds = new Set<string>();
  private queuedJobIds: string[] = [];
  private budgetUtcDate = new Date().toISOString().slice(0, 10);
  private dailyAiSpendUsd = 0;
  private dailyProviderCalls = 0;

  constructor(limits?: Partial<CustomerPoolLimits>) {
    this.limits = { ...DEFAULT_CUSTOMER_POOL_LIMITS, ...(limits || {}) };
  }

  getLimits(): CustomerPoolLimits {
    return { ...this.limits };
  }

  updateLimits(patch: Partial<CustomerPoolLimits>): CustomerPoolLimits {
    this.limits = {
      ...this.limits,
      maxConcurrentJobs:
        patch.maxConcurrentJobs !== undefined
          ? Math.max(1, Math.min(4, Math.floor(patch.maxConcurrentJobs)))
          : this.limits.maxConcurrentJobs,
      maxQueueDepth:
        patch.maxQueueDepth !== undefined
          ? Math.max(1, Math.min(25, Math.floor(patch.maxQueueDepth)))
          : this.limits.maxQueueDepth,
      dailyAiCostBudgetUsd:
        patch.dailyAiCostBudgetUsd !== undefined
          ? Math.max(1, Math.min(500, Number(patch.dailyAiCostBudgetUsd)))
          : this.limits.dailyAiCostBudgetUsd,
      dailyProviderCallBudget:
        patch.dailyProviderCallBudget !== undefined
          ? Math.max(10, Math.min(10_000, Math.floor(patch.dailyProviderCallBudget)))
          : this.limits.dailyProviderCallBudget,
      emergencySuspended:
        typeof patch.emergencySuspended === 'boolean'
          ? patch.emergencySuspended
          : this.limits.emergencySuspended,
    };
    return this.getLimits();
  }

  getOrCreateAccount(
    accountId: string,
    defaultTier: ScannerPlanTier = 'FREE_PREVIEW',
    initialSandboxCredits = 3,
    nowMs = Date.now()
  ): AccountCreditLedger {
    const today = new Date(nowMs).toISOString().slice(0, 10);
    const existing = this.accounts.get(accountId);
    if (existing) {
      if (existing.lastResetUtcDate !== today) {
        const refreshed: AccountCreditLedger = {
          ...existing,
          dailyScansUsed: 0,
          lastResetUtcDate: today,
        };
        this.accounts.set(accountId, refreshed);
        return refreshed;
      }
      return existing;
    }
    const created: AccountCreditLedger = {
      accountId,
      planTier: defaultTier,
      creditBalance: Math.max(0, initialSandboxCredits),
      dailyScansUsed: 0,
      dailyScanQuota: PLAN_DAILY_SCAN_QUOTAS[defaultTier],
      totalCreditsRefunded: 0,
      totalScansCompleted: 0,
      lastResetUtcDate: today,
    };
    this.accounts.set(accountId, created);
    return created;
  }

  adjustAccountCreditsAndPlan(params: {
    accountId: string;
    creditDelta?: number;
    planTier?: ScannerPlanTier;
    customDailyQuota?: number;
  }): AccountCreditLedger {
    const current = this.getOrCreateAccount(params.accountId);
    const nextTier = params.planTier ?? current.planTier;
    const boundedQuota =
      params.customDailyQuota !== undefined
        ? Math.max(1, Math.min(100, Math.floor(params.customDailyQuota)))
        : PLAN_DAILY_SCAN_QUOTAS[nextTier];
    const updated: AccountCreditLedger = {
      ...current,
      planTier: nextTier,
      creditBalance: Math.max(0, current.creditBalance + (params.creditDelta ?? 0)),
      dailyScanQuota: boundedQuota,
    };
    this.accounts.set(params.accountId, updated);
    return updated;
  }

  reserveJobSlot(params: {
    jobId: string;
    accountId: string;
    uploadId: string;
    creditCost?: number;
    nowMs?: number;
  }): {
    accepted: boolean;
    httpStatus: 200 | 402 | 429 | 503;
    code:
      | 'JOB_RUNNING'
      | 'JOB_QUEUED'
      | 'SERVICE_SUSPENDED'
      | 'DAILY_COST_BUDGET_EXHAUSTED'
      | 'PROVIDER_CALL_BUDGET_EXHAUSTED'
      | 'DAILY_ACCOUNT_QUOTA_EXHAUSTED'
      | 'INSUFFICIENT_CREDITS'
      | 'CAPACITY_EXHAUSTED';
    reason: string;
    job: AnalysisJobRecord | null;
    account: AccountCreditLedger;
  } {
    const now = params.nowMs ?? Date.now();
    this.resetDailyBudgetsIfNeeded(now);
    const account = this.getOrCreateAccount(params.accountId, 'FREE_PREVIEW', 3, now);
    const cost = Math.max(1, params.creditCost ?? 1);

    if (this.limits.emergencySuspended) {
      return {
        accepted: false,
        httpStatus: 503,
        code: 'SERVICE_SUSPENDED',
        reason: 'AI Chart Scanner is temporarily suspended by Admin Emergency Control.',
        job: null,
        account,
      };
    }

    if (this.dailyAiSpendUsd + this.limits.estimatedCostPerScanUsd > this.limits.dailyAiCostBudgetUsd) {
      return {
        accepted: false,
        httpStatus: 503,
        code: 'DAILY_COST_BUDGET_EXHAUSTED',
        reason: 'Daily AI cost budget reached. Core Signal Forge trading operations remain unaffected.',
        job: null,
        account,
      };
    }

    if (this.dailyProviderCalls + 1 > this.limits.dailyProviderCallBudget) {
      return {
        accepted: false,
        httpStatus: 503,
        code: 'PROVIDER_CALL_BUDGET_EXHAUSTED',
        reason: 'Daily provider call budget reached. Try again after UTC reset.',
        job: null,
        account,
      };
    }

    if (account.dailyScansUsed >= account.dailyScanQuota) {
      return {
        accepted: false,
        httpStatus: 429,
        code: 'DAILY_ACCOUNT_QUOTA_EXHAUSTED',
        reason: `Daily scan quota (${account.dailyScanQuota}/day) reached for plan ${account.planTier}. Unlimited scans are disabled.`,
        job: null,
        account,
      };
    }

    if (account.creditBalance < cost) {
      return {
        accepted: false,
        httpStatus: 402,
        code: 'INSUFFICIENT_CREDITS',
        reason: `Insufficient scan credits (balance: ${account.creditBalance}, required: ${cost}).`,
        job: null,
        account,
      };
    }

    const canRunNow = this.activeJobIds.size < this.limits.maxConcurrentJobs;
    if (!canRunNow && this.queuedJobIds.length >= this.limits.maxQueueDepth) {
      return {
        accepted: false,
        httpStatus: 503,
        code: 'CAPACITY_EXHAUSTED',
        reason: 'Customer analysis worker pool is at full capacity. Core trading capacity is isolated and unaffected.',
        job: null,
        account,
      };
    }

    // Atomically deduct credit & daily quota upon accepted reservation
    const updatedAcc: AccountCreditLedger = {
      ...account,
      creditBalance: account.creditBalance - cost,
      dailyScansUsed: account.dailyScansUsed + 1,
    };
    this.accounts.set(params.accountId, updatedAcc);

    const job: AnalysisJobRecord = {
      jobId: params.jobId,
      accountId: params.accountId,
      uploadId: params.uploadId,
      status: canRunNow ? 'RUNNING' : 'QUEUED',
      creditsReserved: cost,
      creditsRefunded: 0,
      createdAtMs: now,
      startedAtMs: canRunNow ? now : null,
      finishedAtMs: null,
      errorReason: null,
    };
    this.jobs.set(job.jobId, job);
    if (canRunNow) {
      this.activeJobIds.add(job.jobId);
      this.dailyProviderCalls += 1;
      this.dailyAiSpendUsd = Number(
        (this.dailyAiSpendUsd + this.limits.estimatedCostPerScanUsd).toFixed(4)
      );
    } else {
      this.queuedJobIds.push(job.jobId);
    }

    return {
      accepted: true,
      httpStatus: 200,
      code: canRunNow ? 'JOB_RUNNING' : 'JOB_QUEUED',
      reason: canRunNow
        ? 'Analysis started in isolated customer worker pool.'
        : `Analysis queued at position #${this.queuedJobIds.length}.`,
      job,
      account: updatedAcc,
    };
  }

  completeJob(jobId: string, nowMs = Date.now()): AnalysisJobRecord | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    this.activeJobIds.delete(jobId);
    this.queuedJobIds = this.queuedJobIds.filter((id) => id !== jobId);
    const done: AnalysisJobRecord = {
      ...job,
      status: 'COMPLETED',
      finishedAtMs: nowMs,
    };
    this.jobs.set(jobId, done);

    const acc = this.accounts.get(job.accountId);
    if (acc) {
      this.accounts.set(job.accountId, {
        ...acc,
        totalScansCompleted: acc.totalScansCompleted + 1,
      });
    }
    this.promoteNextQueuedJob(nowMs);
    return done;
  }

  /**
   * Automatic full credit & quota refund on processing failure, timeout, or user cancellation.
   */
  failOrCancelJobWithRefund(
    jobId: string,
    mode: 'FAILED_REFUNDED' | 'CANCELLED_REFUNDED',
    reason: string,
    nowMs = Date.now()
  ): { job: AnalysisJobRecord | null; account: AccountCreditLedger | null } {
    const job = this.jobs.get(jobId);
    if (!job) return { job: null, account: null };
    if (job.status === 'COMPLETED' || job.status === 'FAILED_REFUNDED' || job.status === 'CANCELLED_REFUNDED') {
      return { job, account: this.accounts.get(job.accountId) ?? null };
    }
    this.activeJobIds.delete(jobId);
    this.queuedJobIds = this.queuedJobIds.filter((id) => id !== jobId);

    const updatedJob: AnalysisJobRecord = {
      ...job,
      status: mode,
      creditsRefunded: job.creditsReserved,
      finishedAtMs: nowMs,
      errorReason: reason,
    };
    this.jobs.set(jobId, updatedJob);

    const acc = this.accounts.get(job.accountId);
    let updatedAcc: AccountCreditLedger | null = null;
    if (acc) {
      updatedAcc = {
        ...acc,
        creditBalance: acc.creditBalance + job.creditsReserved,
        dailyScansUsed: Math.max(0, acc.dailyScansUsed - 1),
        totalCreditsRefunded: acc.totalCreditsRefunded + job.creditsReserved,
      };
      this.accounts.set(job.accountId, updatedAcc);
    }
    this.promoteNextQueuedJob(nowMs);
    return { job: updatedJob, account: updatedAcc };
  }

  getPoolSnapshot(nowMs = Date.now()) {
    this.resetDailyBudgetsIfNeeded(nowMs);
    return {
      isolatedFromCoreTrading: true,
      limits: this.getLimits(),
      activeRunningJobs: this.activeJobIds.size,
      queuedJobsCount: this.queuedJobIds.length,
      dailyAiSpendUsd: this.dailyAiSpendUsd,
      dailyAiRemainingBudgetUsd: Number(
        Math.max(0, this.limits.dailyAiCostBudgetUsd - this.dailyAiSpendUsd).toFixed(4)
      ),
      dailyProviderCalls: this.dailyProviderCalls,
      totalTrackedAccounts: this.accounts.size,
    };
  }

  private promoteNextQueuedJob(nowMs: number): void {
    while (this.activeJobIds.size < this.limits.maxConcurrentJobs && this.queuedJobIds.length > 0) {
      const nextId = this.queuedJobIds.shift()!;
      const nextJob = this.jobs.get(nextId);
      if (nextJob && nextJob.status === 'QUEUED') {
        this.activeJobIds.add(nextId);
        this.dailyProviderCalls += 1;
        this.dailyAiSpendUsd = Number(
          (this.dailyAiSpendUsd + this.limits.estimatedCostPerScanUsd).toFixed(4)
        );
        this.jobs.set(nextId, {
          ...nextJob,
          status: 'RUNNING',
          startedAtMs: nowMs,
        });
      }
    }
  }

  private resetDailyBudgetsIfNeeded(nowMs: number): void {
    const today = new Date(nowMs).toISOString().slice(0, 10);
    if (today !== this.budgetUtcDate) {
      this.budgetUtcDate = today;
      this.dailyAiSpendUsd = 0;
      this.dailyProviderCalls = 0;
    }
  }
}

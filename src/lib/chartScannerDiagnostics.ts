/**
 * Signal Forge — Chart Scanner Upload Diagnostics & Bilingual (English + Urdu) Error Mapping.
 *
 * Strictly distinguishes:
 * - True network / offline / timeout transport errors
 * - HTTP 413 Payload Too Large (JSON or proxy HTML)
 * - HTTP 401 / 403 session, origin, or private-image permission errors
 * - HTTP 422 low-cost upload validation rejections (0 credits charged)
 * - HTTP 429 / 402 account quota / rate-limit / credit balance gates
 * - HTTP 503 service pause / worker pool / daily budget limits
 * - HTTP 5xx server or gateway errors
 *
 * Never mislabels network or upload validation failures as Gemini API quota exhaustion.
 */

export type ScannerErrorCategory =
  | 'NETWORK_OFFLINE'
  | 'REQUEST_TIMEOUT'
  | 'NETWORK_TRANSPORT'
  | 'PAYLOAD_TOO_LARGE'
  | 'AUTH_OR_ORIGIN'
  | 'VALIDATION_REJECTED'
  | 'RATE_LIMIT_OR_QUOTA'
  | 'SERVICE_UNAVAILABLE'
  | 'SERVER_OR_PROXY_ERROR';

export interface BilingualScannerError {
  readonly category: ScannerErrorCategory;
  readonly code: string;
  readonly titleEn: string;
  readonly titleUr: string;
  readonly messageEn: string;
  readonly messageUr: string;
  readonly diagnosticId: string;
  readonly httpStatus: number | null;
  readonly creditsCharged: 0;
}

export interface SafeApiResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly contentType: string;
  readonly isJson: boolean;
  readonly data: Record<string, unknown> | null;
  readonly rawText: string;
  readonly diagnosticId: string | null;
}

export function createClientDiagnosticId(prefix: 'SF-NET' | 'SF-VAL' | 'SF-ANA' = 'SF-NET'): string {
  const ts = Date.now().toString(36).toUpperCase().slice(-5);
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}

/**
 * Inspects the first 12 binary bytes of a browser File/Blob to detect real PNG/JPEG/WEBP magic bytes.
 * Used ONLY to prevent mobile browsers with empty `file.type` from mislabeling valid JPEGs/WebPs as PNG.
 * Never alters or converts non-image files.
 */
export function detectBrowserMagicMime(
  headerBytes: Uint8Array
): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (headerBytes.length < 12) return null;
  if (
    headerBytes[0] === 0x89 &&
    headerBytes[1] === 0x50 &&
    headerBytes[2] === 0x4e &&
    headerBytes[3] === 0x47 &&
    headerBytes[4] === 0x0d &&
    headerBytes[5] === 0x0a &&
    headerBytes[6] === 0x1a &&
    headerBytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (headerBytes[0] === 0xff && headerBytes[1] === 0xd8 && headerBytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    headerBytes[0] === 0x52 &&
    headerBytes[1] === 0x49 &&
    headerBytes[2] === 0x46 &&
    headerBytes[3] === 0x46 &&
    headerBytes[8] === 0x57 &&
    headerBytes[9] === 0x45 &&
    headerBytes[10] === 0x42 &&
    headerBytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Normalizes mobile MIME quirks (`""`, `"image/jpg"`, `"image/pjpeg"`) without weakening validation
 * of disallowed or spoofed MIME types.
 */
export function normalizeDeclaredImageMime(params: {
  declaredMime?: string | null;
  fileName?: string | null;
  magicMime?: 'image/png' | 'image/jpeg' | 'image/webp' | null;
}): string {
  const raw = String(params.declaredMime || '').trim().toLowerCase();
  if (raw === 'image/jpg' || raw === 'image/pjpeg') {
    return 'image/jpeg';
  }
  if (raw === 'image/x-png') {
    return 'image/png';
  }
  if (raw && raw !== 'application/octet-stream') {
    return raw;
  }
  // Mobile browsers often leave file.type empty or application/octet-stream for gallery screenshots
  if (params.magicMime) {
    return params.magicMime;
  }
  const lowerName = String(params.fileName || '').trim().toLowerCase();
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  if (lowerName.endsWith('.png')) return 'image/png';
  return raw || 'application/octet-stream';
}

/**
 * Safely parses any Fetch Response without throwing SyntaxError on HTML 413/502/504 error pages.
 */
export async function parseSafeApiResponse(res: Response): Promise<SafeApiResponse> {
  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  const headerDiag = res.headers.get('x-diagnostic-id');
  let rawText = '';
  try {
    rawText = await res.text();
  } catch {
    rawText = '';
  }

  let data: Record<string, unknown> | null = null;
  let isJson = false;
  if (rawText.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>;
        isJson = true;
      }
    } catch {
      isJson = false;
    }
  }

  const bodyDiag =
    data && typeof data.diagnosticId === 'string' && data.diagnosticId.trim().length > 0
      ? data.diagnosticId.trim()
      : null;

  return {
    ok: res.ok,
    status: res.status,
    contentType,
    isJson,
    data,
    rawText,
    diagnosticId: bodyDiag || headerDiag || null,
  };
}

/**
 * Maps any HTTP error response from `/api/scanner/upload` or `/api/scanner/analyze`
 * into an actionable, honest English + Urdu error object with zero credit deduction.
 */
export function mapHttpScannerError(
  parsed: SafeApiResponse,
  stage: 'upload' | 'analyze' | 'followup' | 'recheck' | 'share' = 'upload'
): BilingualScannerError {
  const diagnosticId =
    parsed.diagnosticId ||
    createClientDiagnosticId(stage === 'upload' ? 'SF-VAL' : 'SF-ANA');
  const code = String(parsed.data?.code || '').trim().toUpperCase();
  const serverErr =
    typeof parsed.data?.error === 'string' && parsed.data.error.trim().length > 0
      ? parsed.data.error.trim()
      : '';

  // 1. HTTP 413 Payload Too Large (Express or Reverse Proxy HTML)
  if (
    parsed.status === 413 ||
    code === 'PAYLOAD_TOO_LARGE' ||
    code === 'REJECTED_SIZE_LIMIT' ||
    /payload too large|entity too large|request entity too large/i.test(parsed.rawText)
  ) {
    return {
      category: 'PAYLOAD_TOO_LARGE',
      code: code || 'PAYLOAD_TOO_LARGE',
      titleEn: 'Image File Too Large (Max 5 MB)',
      titleUr: 'تصویر کا سائز بہت بڑا ہے (زیادہ سے زیادہ 5 MB)',
      messageEn:
        serverErr ||
        'Your chart screenshot exceeds the 5 MB upload limit. Save a standard PNG, JPEG, or WebP screenshot under 5 MB and try again. Zero credits charged.',
      messageUr:
        'آپ کا چارٹ اسکرین شاٹ 5 MB کی حد سے بڑا ہے۔ براہِ کرم 5 MB سے کم سائز کا PNG، JPEG یا WebP اسکرین شاٹ منتخب کر کے دوبارہ کوشش کریں۔ کوئی کریڈٹ نہیں کاٹا گیا۔',
      diagnosticId,
      httpStatus: parsed.status,
      creditsCharged: 0,
    };
  }

  // 2. HTTP 422 Low-Cost Validation Rejections (0 credits)
  if (parsed.status === 422 || code.startsWith('REJECTED_') || code === 'NEEDS_CLEARER_SCREENSHOT') {
    const urByCode: Record<string, { titleUr: string; messageUr: string; titleEn: string }> = {
      REJECTED_INVALID_MIME: {
        titleEn: 'Unsupported File Format',
        titleUr: 'غیر معاون فائل فارمیٹ',
        messageUr:
          'صرف PNG، JPEG اور WebP ٹریڈنگ چارٹ اسکرین شاٹس قبول کیے جاتے ہیں۔ HEIC یا دستاویز کی بجائے PNG/JPEG تصویر اپ لوڈ کریں۔ کوئی کریڈٹ نہیں کاٹا گیا۔',
      },
      REJECTED_MAGIC_BYTES_MISMATCH: {
        titleEn: 'Invalid or Corrupted Image File',
        titleUr: 'غلط یا خراب تصویری فائل',
        messageUr:
          'فائل کا حقیقی فارمیٹ درست PNG، JPEG یا WebP تصویر سے میل نہیں کھاتا۔ براہِ کرم اصل چارٹ اسکرین شاٹ اپ لوڈ کریں۔ کوئی کریڈٹ نہیں کاٹا گیا۔',
      },
      REJECTED_DIMENSIONS: {
        titleEn: 'Screenshot Resolution Out of Range',
        titleUr: 'اسکرین شاٹ کی ریزولوشن مناسب نہیں',
        messageUr:
          'تصویر کم از کم 320×200 پکسل (اور زیادہ سے زیادہ 6000 پکسل) ہونی چاہیے تاکہ کینڈل اسٹکس اور قیمت کا پیمانہ واضح نظر آئے۔ کوئی کریڈٹ نہیں کاٹا گیا۔',
      },
      REJECTED_NOT_A_TRADING_CHART: {
        titleEn: 'Trading Chart Not Detected',
        titleUr: 'ٹریڈنگ چارٹ کی شناخت نہیں ہو سکی',
        messageUr:
          'یہ تصویر کینڈل اسٹک ٹریڈنگ چارٹ نہیں لگتی۔ براہِ کرم واضح ٹریڈنگ چارٹ اسکرین شاٹ اپ لوڈ کریں۔ کوئی کریڈٹ نہیں کاٹا گیا۔',
      },
      NEEDS_CLEARER_SCREENSHOT: {
        titleEn: 'Clearer Chart Screenshot Needed',
        titleUr: 'مزید واضح چارٹ اسکرین شاٹ درکار ہے',
        messageUr:
          'اسکرین شاٹ دھندلا یا کٹا ہوا لگتا ہے۔ براہِ کرم مکمل چارٹ ونڈو مع قیمت اور وقت کے پیمانے کے ساتھ اپ لوڈ کریں۔ کوئی کریڈٹ نہیں کاٹا گیا۔',
      },
      REJECTED_DUPLICATE_SUBMISSION: {
        titleEn: 'Duplicate Chart Already Uploaded',
        titleUr: 'یہ چارٹ پہلے ہی اپ لوڈ ہو چکا ہے',
        messageUr:
          'یہی اسکرین شاٹ حال ہی میں اپ لوڈ کیا جا چکا ہے۔ اضافی کریڈٹ خرچ کیے بغیر نیا یا اپڈیٹ شدہ چارٹ اپ لوڈ کریں۔ کوئی کریڈٹ نہیں کاٹا گیا۔',
      },
    };
    const matched = urByCode[code] ?? {
      titleEn: 'Chart Validation Rejected',
      titleUr: 'چارٹ کی توثیق مسترد ہو گئی',
      messageUr:
        'فائل ابتدائی حفاظتی جانچ پر پوری نہیں اتری۔ براہِ کرم درست PNG، JPEG یا WebP چارٹ اسکرین شاٹ منتخب کریں۔ کوئی کریڈٹ نہیں کاٹا گیا۔',
    };
    return {
      category: 'VALIDATION_REJECTED',
      code: code || 'VALIDATION_REJECTED',
      titleEn: matched.titleEn,
      titleUr: matched.titleUr,
      messageEn:
        serverErr ||
        'Chart screenshot did not pass low-cost validation. Please upload a valid PNG, JPEG, or WebP trading chart. Zero credits charged.',
      messageUr: matched.messageUr,
      diagnosticId,
      httpStatus: parsed.status,
      creditsCharged: 0,
    };
  }

  // 3. HTTP 401 / 403 Permission, Session, or Origin Error
  if (parsed.status === 401 || parsed.status === 403) {
    return {
      category: 'AUTH_OR_ORIGIN',
      code: code || `HTTP_${parsed.status}`,
      titleEn: 'Session or Access Permission Blocked',
      titleUr: 'سیشن یا رسائی کی اجازت کا مسئلہ',
      messageEn:
        serverErr ||
        'Upload access was blocked by session or origin security rules. Reload the page and retry. Zero credits charged.',
      messageUr:
        'سیشن یا سیکیورٹی پالیسی کی وجہ سے درخواست روک دی گئی۔ براہِ کرم صفحہ ریفریش کر کے دوبارہ کوشش کریں۔ کوئی کریڈٹ نہیں کاٹا گیا۔',
      diagnosticId,
      httpStatus: parsed.status,
      creditsCharged: 0,
    };
  }

  // 4. HTTP 402 / 429 Quota, Rate Limit, or Credit Gate (Explicitly NOT network error)
  if (parsed.status === 402 || parsed.status === 429) {
    return {
      category: 'RATE_LIMIT_OR_QUOTA',
      code: code || `HTTP_${parsed.status}`,
      titleEn: parsed.status === 402 ? 'Insufficient Sandbox Credits' : 'Rate Limit or Daily Quota Reached',
      titleUr: parsed.status === 402 ? 'سینڈ باکس کریڈٹس ناکافی ہیں' : 'روزانہ کوٹہ یا ریٹ لِمٹ پوری ہو گئی',
      messageEn:
        serverErr ||
        'Account scan quota or upload rate limit has been reached. Wait briefly or check your daily quota.',
      messageUr:
        'آپ کی روزانہ اسکین حد یا عارضی ریٹ لِمٹ پوری ہو گئی ہے۔ کچھ دیر بعد دوبارہ کوشش کریں۔ کوئی اضافی کریڈٹ نہیں کاٹا گیا۔',
      diagnosticId,
      httpStatus: parsed.status,
      creditsCharged: 0,
    };
  }

  // 5. HTTP 503 Service Paused / Worker Pool Capacity / Budget Cap
  if (parsed.status === 503) {
    return {
      category: 'SERVICE_UNAVAILABLE',
      code: code || 'SERVICE_UNAVAILABLE',
      titleEn: 'Chart Scanner Temporarily Unavailable',
      titleUr: 'چارٹ اسکینر عارضی طور پر دستیاب نہیں',
      messageEn:
        serverErr ||
        'The isolated Chart Scanner worker pool is paused or at capacity. Core trading safety remains unaffected. Zero credits charged.',
      messageUr:
        'چارٹ اسکینر سروس عارضی طور پر بند یا مصروف ہے۔ براہِ کرم تھوڑی دیر بعد دوبارہ کوشش کریں۔ کوئی کریڈٹ نہیں کاٹا گیا۔',
      diagnosticId,
      httpStatus: parsed.status,
      creditsCharged: 0,
    };
  }

  // 6. HTTP 400 Bad Request / Malformed payload
  if (parsed.status === 400) {
    return {
      category: 'VALIDATION_REJECTED',
      code: code || 'BAD_REQUEST',
      titleEn: 'Invalid Upload Request',
      titleUr: 'غلط اپ لوڈ درخواست',
      messageEn:
        serverErr ||
        'The image payload could not be read cleanly. Please select the chart screenshot again. Zero credits charged.',
      messageUr:
        'تصویری ڈیٹا درست طریقے سے پڑھا نہیں جا سکا۔ براہِ کرم چارٹ اسکرین شاٹ دوبارہ منتخب کریں۔ کوئی کریڈٹ نہیں کاٹا گیا۔',
      diagnosticId,
      httpStatus: parsed.status,
      creditsCharged: 0,
    };
  }

  // 7. HTTP 5xx or unexpected non-JSON gateway/proxy response
  return {
    category: 'SERVER_OR_PROXY_ERROR',
    code: code || (parsed.isJson ? `HTTP_${parsed.status}` : `NON_JSON_HTTP_${parsed.status}`),
    titleEn: `Server Validation Error (HTTP ${parsed.status})`,
    titleUr: `سرور توثیق کی خرابی (HTTP ${parsed.status})`,
    messageEn:
      serverErr ||
      `The server returned an unexpected response (HTTP ${parsed.status}) during chart validation — this is a server/proxy response error, not an AI quota error. Zero credits charged.`,
    messageUr: `چارٹ کی توثیق کے دوران سرور یا پراکسی سے غیر متوقع جواب (HTTP ${parsed.status}) موصول ہوا۔ یہ اے آئی کوٹہ ختم ہونے کا مسئلہ نہیں ہے۔ براہِ کرم دوبارہ کوشش کریں۔ کوئی کریڈٹ نہیں کاٹا گیا۔`,
    diagnosticId,
    httpStatus: parsed.status,
    creditsCharged: 0,
  };
}

/**
 * Maps a true client-side fetch/network/timeout exception (when no HTTP response arrived).
 * Explicitly distinguishes connection/timeout errors from Gemini API quota errors.
 */
export function mapNetworkScannerException(
  err: unknown,
  options?: { isOffline?: boolean; stage?: 'upload' | 'analyze' | 'followup' | 'recheck' | 'share' }
): BilingualScannerError {
  const diagnosticId = createClientDiagnosticId('SF-NET');
  const stage = options?.stage ?? 'upload';
  const errName = err instanceof Error ? err.name : '';

  if (options?.isOffline) {
    return {
      category: 'NETWORK_OFFLINE',
      code: 'BROWSER_OFFLINE',
      titleEn: 'No Internet Connection',
      titleUr: 'انٹرنیٹ کنکشن منقطع ہے',
      messageEn:
        'Your device appears to be offline. Reconnect to Wi-Fi or mobile data and retry chart upload. Zero credits charged.',
      messageUr:
        'آپ کا موبائل یا ڈیوائس آف لائن ہے۔ براہِ کرم انٹرنیٹ کنکشن بحال کر کے دوبارہ کوشش کریں۔ کوئی کریڈٹ نہیں کاٹا گیا۔',
      diagnosticId,
      httpStatus: null,
      creditsCharged: 0,
    };
  }

  if (errName === 'AbortError') {
    return {
      category: 'REQUEST_TIMEOUT',
      code: 'UPLOAD_TIMEOUT',
      titleEn: 'Upload Request Timed Out',
      titleUr: 'اپ لوڈ درخواست کا وقت ختم ہو گیا',
      messageEn:
        'Chart validation timed out on the mobile connection before the server finished responding (not an AI quota issue). Try a smaller screenshot or a stronger connection. Zero credits charged.',
      messageUr:
        'موبائل کنکشن سست ہونے کی وجہ سے چارٹ توثیق کا وقت ختم ہو گیا (یہ اے آئی کوٹہ کا مسئلہ نہیں)۔ براہِ کرم چھوٹا اسکرین شاٹ یا بہتر انٹرنیٹ استعمال کریں۔ کوئی کریڈٹ نہیں کاٹا گیا۔',
      diagnosticId,
      httpStatus: null,
      creditsCharged: 0,
    };
  }

  return {
    category: 'NETWORK_TRANSPORT',
    code: 'NETWORK_FETCH_FAILED',
    titleEn:
      stage === 'upload'
        ? 'Connection Interrupted During Upload'
        : 'Connection Interrupted During Analysis',
    titleUr:
      stage === 'upload'
        ? 'اپ لوڈ کے دوران کنکشن منقطع ہو گیا'
        : 'تجزیہ کے دوران کنکشن منقطع ہو گیا',
    messageEn:
      'Could not reach the Signal Forge validation server (connection reset, blocked proxy, or unstable mobile network — not an AI quota error). Please retry. Zero credits charged.',
    messageUr:
      'سگنل فورج سرور سے رابطہ منقطع ہو گیا (یہ موبائل نیٹ ورک یا کنکشن کا مسئلہ ہے، اے آئی کوٹہ کا نہیں)۔ براہِ کرم دوبارہ کوشش کریں۔ کوئی کریڈٹ نہیں کاٹا گیا۔',
    diagnosticId,
    httpStatus: null,
    creditsCharged: 0,
  };
}

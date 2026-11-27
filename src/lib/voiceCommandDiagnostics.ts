/**
 * Pure diagnostics, state-classification, and safe response-parsing helpers
 * for the Signal Forge Voice Command Agent & AI Command Hub.
 *
 * Security & privacy invariants:
 * - Zero audio recording storage or upload.
 * - Zero secrets, API keys, or raw audio content ever emitted in diagnostics.
 */

export type VoiceCapturePhase =
  | 'IDLE'
  | 'CHECKING_PERMISSION'
  | 'AWAITING_SPEECH'
  | 'SPEECH_DETECTED'
  | 'ERROR'
  | 'CANCELLED';

export type VoicePermissionStatus =
  | 'UNKNOWN'
  | 'GRANTED'
  | 'DENIED'
  | 'PROMPT'
  | 'UNSUPPORTED';

export type VoiceErrorCategory =
  | 'INSECURE_CONTEXT'
  | 'IFRAME_POLICY_BLOCKED'
  | 'MEDIA_DEVICES_UNAVAILABLE'
  | 'UNSUPPORTED_BROWSER'
  | 'PERMISSION_DENIED'
  | 'PERMISSION_DISMISSED'
  | 'OS_PERMISSION_BLOCKED'
  | 'NO_MICROPHONE'
  | 'AUDIO_CAPTURE_FAILED'
  | 'RECOGNITION_START_FAILED'
  | 'NO_SPEECH'
  | 'SPEECH_NETWORK_ERROR'
  | 'RECOGNITION_TIMEOUT'
  | 'RECOGNITION_ABORTED'
  | 'UNKNOWN';

export type CommandErrorCategory =
  | 'NONE'
  | 'VALIDATION'
  | 'AUTH_ERROR'
  | 'QUOTA_EXHAUSTED'
  | 'MODEL_UNAVAILABLE'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
  | 'INVALID_RESPONSE';

export type GeminiQuotaScope =
  | 'PER_MINUTE'
  | 'PER_DAY'
  | 'FREE_TIER_LIMIT_ZERO'
  | 'UNKNOWN';

export interface VoiceDiagnosticSnapshot {
  readonly origin: string;
  readonly isSecureContext: boolean;
  readonly isEmbeddedIframe: boolean;
  readonly permissionsPolicyAllowsMic: boolean | null;
  readonly browserPermissionState: VoicePermissionStatus;
  readonly hasMediaDevices: boolean;
  readonly hasGetUserMedia: boolean;
  readonly hasSpeechRecognition: boolean;
  readonly isMobileChromeAndroid: boolean;
  readonly rawErrorName: string | null;
  readonly sanitizedErrorMessage: string | null;
  readonly checkedAtIso: string;
}

export interface BrowserVoiceSupportCheck {
  readonly supported: boolean;
  readonly isSecureContext: boolean;
  readonly hasMediaDevices: boolean;
  readonly hasSpeechRecognition: boolean;
  readonly errorCategory: VoiceErrorCategory | null;
  readonly message: string | null;
  readonly urduMessage: string | null;
}

export interface ClassifiedVoiceError {
  readonly category: VoiceErrorCategory;
  readonly fatalForAlwaysListening: boolean;
  readonly permissionDenied: boolean;
  readonly message: string;
  readonly urduMessage: string;
  readonly rawErrorName: string | null;
  readonly sanitizedErrorMessage: string | null;
}

export interface ModelQuotaDiagnosticEntry {
  readonly model: string;
  readonly ok: boolean;
  readonly httpStatus: number;
  readonly code: string;
  readonly errorCategory: CommandErrorCategory;
  readonly quotaScope?: GeminiQuotaScope;
  readonly retryAfterSeconds?: number | null;
  readonly quotaMetric?: string | null;
  readonly message: string;
}

export interface ClassifiedGeminiServerError {
  readonly httpStatus: number;
  readonly code: string;
  readonly errorCategory: CommandErrorCategory;
  readonly retryableWithFallback: boolean;
  readonly message: string;
  readonly urduMessage: string;
  readonly quotaScope?: GeminiQuotaScope;
  readonly retryAfterSeconds?: number | null;
  readonly quotaMetric?: string | null;
}

export interface SafeCommandApiResult {
  readonly ok: boolean;
  readonly schemaVersion?: string;
  readonly httpStatus: number;
  readonly model: string;
  readonly reply: string;
  readonly urduMessage?: string | null;
  readonly intent?: string;
  readonly routeTarget?: string | null;
  readonly matchedTradeId?: string | null;
  readonly matchedSymbol?: string | null;
  readonly suggestedFollowUps: readonly string[];
  readonly code?: string;
  readonly errorCategory: CommandErrorCategory;
  readonly diagnosticId?: string;
  readonly quotaScope?: GeminiQuotaScope;
  readonly retryAfterSeconds?: number | null;
  readonly quotaMetric?: string | null;
  readonly modelQuotaBreakdown?: readonly ModelQuotaDiagnosticEntry[];
  readonly responseContentType?: string | null;
  readonly responseRedirected?: boolean;
  readonly responseUrlPath?: string | null;
  readonly responseBodySnippet?: string | null;
}

export interface AiCommandHubJsonSchema {
  readonly schemaVersion: '1.0';
  readonly ok: boolean;
  readonly httpStatus: number;
  readonly diagnosticId: string;
  readonly code: string;
  readonly errorCategory: CommandErrorCategory;
  readonly model: string;
  readonly source: 'VOICE' | 'TEXT';
  readonly reply: string;
  readonly error: string | null;
  readonly urduMessage: string | null;
  readonly intent: string;
  readonly routeTarget: string | null;
  readonly matchedTradeId: string | null;
  readonly matchedSymbol: string | null;
  readonly suggestedFollowUps: readonly string[];
  readonly quotaScope?: GeminiQuotaScope;
  readonly retryAfterSeconds?: number | null;
  readonly quotaMetric?: string | null;
  readonly modelQuotaBreakdown: readonly ModelQuotaDiagnosticEntry[];
  readonly generatedAtIso: string;
}

export type DeterministicCommandKind = 'GREETING' | 'STATUS' | null;

/**
 * Classifies harmless greetings/help phrases and read-only status checks deterministically
 * (stripping mobile SpeechRecognition punctuation like "Hello!" or "Status.") so they never
 * trigger trading instructions or unnecessary Gemini API failures.
 */
export function matchDeterministicCommandIntent(rawPrompt: string): DeterministicCommandKind {
  const normalized = String(rawPrompt || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return null;

  if (
    /^(hello|hi|hey|salam|salaam|assalam o alaikum|assalamualaikum|good morning|good afternoon|good evening|testing|test|help|commands|what can you do)(\s+(signal forge|there|assistant|ai|hub))?$/.test(
      normalized
    )
  ) {
    return 'GREETING';
  }

  if (
    /^(status|system status|app status|desk status|check status|show status|show system status|show signal forge status|show signal forge system status|health|system health|app health|status please|status check)$/.test(
      normalized
    )
  ) {
    return 'STATUS';
  }

  return null;
}

export const VOICE_START_WATCHDOG_MS = 5_000;
export const VOICE_SILENCE_TIMEOUT_MS = 12_000;
export const VOICE_MIC_RELEASE_SETTLE_MS = 120;
export const VOICE_MAX_ALWAYS_ON_CONSECUTIVE_ERRORS = 2;
export const COMMAND_CLIENT_TIMEOUT_MS = 30_000;
export const COMMAND_SERVER_PRIMARY_TIMEOUT_MS = 15_000;
export const COMMAND_SERVER_FALLBACK_TIMEOUT_MS = 15_000;

export function sanitizeDiagnosticText(raw?: string | null, maxLen = 140): string | null {
  if (!raw) return null;
  const cleaned = String(raw)
    .replace(/https?:\/\/[^\s]+/gi, '[url]')
    .replace(/AIza[0-9A-Za-z\-_]{10,}/g, '[redacted]')
    .replace(/Bearer\s+[0-9A-Za-z\-_.]+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

export function detectMobileChromeAndroid(userAgent?: string | null): boolean {
  const ua = String(userAgent || '');
  return /Android/i.test(ua) && /Chrome\//i.test(ua) && !/EdgA|OPR|SamsungBrowser/i.test(ua);
}

export function normalizeOriginForDiagnostics(rawOrigin?: string | null): string {
  const raw = String(rawOrigin || '').trim();
  if (!raw || raw === 'null') return 'opaque-origin';
  try {
    return new URL(raw).origin;
  } catch {
    return 'unknown-origin';
  }
}

export function classifyBrowserVoiceSupport(input: {
  readonly isSecureContext: boolean;
  readonly hasMediaDevices: boolean;
  readonly hasSpeechRecognition: boolean;
  readonly isEmbeddedIframe?: boolean;
  readonly permissionsPolicyAllowsMic?: boolean | null;
  readonly origin?: string | null;
}): BrowserVoiceSupportCheck {
  if (!input.isSecureContext) {
    return {
      supported: false,
      isSecureContext: false,
      hasMediaDevices: input.hasMediaDevices,
      hasSpeechRecognition: input.hasSpeechRecognition,
      errorCategory: 'INSECURE_CONTEXT',
      message:
        'Microphone voice input requires a secure HTTPS connection (or localhost). Open Signal Forge over HTTPS or use the text command bar below.',
      urduMessage:
        'مائیکروفون وائس ان پٹ کے لیے محفوظ HTTPS کنکشن ضروری ہے۔ براہ کرم Signal Forge کو HTTPS پر کھولیں یا نیچے ٹیکسٹ کمانڈ استعمال کریں۔',
    };
  }

  if (input.permissionsPolicyAllowsMic === false) {
    const originLabel = normalizeOriginForDiagnostics(input.origin);
    return {
      supported: false,
      isSecureContext: true,
      hasMediaDevices: input.hasMediaDevices,
      hasSpeechRecognition: input.hasSpeechRecognition,
      errorCategory: 'IFRAME_POLICY_BLOCKED',
      message: input.isEmbeddedIframe
        ? `Microphone is blocked by the embedded preview iframe Permissions Policy (allow="microphone" missing for ${originLabel}). Open the Signal Forge preview URL directly in a Chrome tab or refresh after permissions update, or type your command below.`
        : `Microphone is blocked by this page's Permissions-Policy header on ${originLabel}. Open Signal Forge in a standard browser tab or type your command below.`,
      urduMessage: input.isEmbeddedIframe
        ? 'ایمبیڈڈ پری ویو iframe کی Permissions Policy مائیکروفون کو بلاک کر رہی ہے (AI Studio کی اجازت الگ ہے اور پری ویو لنک کی اجازت الگ)۔ Signal Forge کو الگ Chrome ٹیب میں کھولیں یا نیچے ٹیکسٹ کمانڈ لکھیں۔'
        : 'اس صفحے کی Permissions Policy مائیکروفون کو بلاک کر رہی ہے۔ براہ کرم نیچے ٹیکسٹ کمانڈ استعمال کریں۔',
    };
  }

  if (!input.hasMediaDevices) {
    return {
      supported: false,
      isSecureContext: true,
      hasMediaDevices: false,
      hasSpeechRecognition: input.hasSpeechRecognition,
      errorCategory: 'MEDIA_DEVICES_UNAVAILABLE',
      message:
        'Browser microphone API (navigator.mediaDevices.getUserMedia) is unavailable in this WebView or browser context. Open Signal Forge in Chrome or Safari, or type your command below.',
      urduMessage:
        'اس براؤزر یا WebView میں مائیکروفون API (getUserMedia) دستیاب نہیں ہے۔ براہ کرم Chrome یا Safari میں کھولیں یا نیچے ٹیکسٹ کمانڈ استعمال کریں۔',
    };
  }

  if (!input.hasSpeechRecognition) {
    return {
      supported: false,
      isSecureContext: true,
      hasMediaDevices: input.hasMediaDevices,
      hasSpeechRecognition: false,
      errorCategory: 'UNSUPPORTED_BROWSER',
      message:
        'Browser Speech Recognition is not supported in this browser (e.g., Firefox or restricted in-app WebView). Use Chrome, Edge, or Safari, or type your command below.',
      urduMessage:
        'اس براؤزر میں Speech Recognition سپورٹ موجود نہیں ہے۔ براہ کرم Chrome، Edge یا Safari استعمال کریں یا نیچے ٹیکسٹ کمانڈ لکھیں۔',
    };
  }

  return {
    supported: true,
    isSecureContext: true,
    hasMediaDevices: true,
    hasSpeechRecognition: true,
    errorCategory: null,
    message: null,
    urduMessage: null,
  };
}

export function resolveSpeechRecognitionLanguage(navigatorLanguage?: string | null): string {
  const raw = String(navigatorLanguage || '').trim();
  if (/^[a-z]{2,3}(-[A-Z]{2})?$/i.test(raw)) {
    return raw;
  }
  return 'en-US';
}

export interface MicrophoneErrorContext {
  readonly errorName?: string | null;
  readonly errorMessage?: string | null;
  readonly isSecureContext?: boolean;
  readonly isEmbeddedIframe?: boolean;
  readonly permissionsPolicyAllowsMic?: boolean | null;
  readonly browserPermissionState?: VoicePermissionStatus;
  readonly isMobileChromeAndroid?: boolean;
  readonly origin?: string | null;
}

export function classifyMicrophoneMediaError(
  errorNameOrContext?: string | MicrophoneErrorContext | null
): ClassifiedVoiceError {
  const ctx: MicrophoneErrorContext =
    typeof errorNameOrContext === 'string' || errorNameOrContext == null
      ? { errorName: errorNameOrContext }
      : errorNameOrContext;

  const rawName = String(ctx.errorName || '').trim() || null;
  const sanitizedMsg = sanitizeDiagnosticText(ctx.errorMessage);
  const lowerMsg = (sanitizedMsg || '').toLowerCase();
  const originLabel = normalizeOriginForDiagnostics(ctx.origin);

  if (ctx.isSecureContext === false) {
    return {
      category: 'INSECURE_CONTEXT',
      fatalForAlwaysListening: true,
      permissionDenied: false,
      rawErrorName: rawName,
      sanitizedErrorMessage: sanitizedMsg,
      message:
        'Microphone capture requires a secure HTTPS context. Open Signal Forge over HTTPS or use the text command bar below.',
      urduMessage:
        'مائیکروفون کے لیے محفوظ HTTPS کنکشن ضروری ہے۔ براہ کرم HTTPS پر کھولیں یا نیچے ٹیکسٹ کمانڈ استعمال کریں۔',
    };
  }

  const looksLikePolicyBlock =
    ctx.permissionsPolicyAllowsMic === false ||
    lowerMsg.includes('permissions policy') ||
    lowerMsg.includes('feature policy') ||
    lowerMsg.includes('not allowed in this document') ||
    lowerMsg.includes('disabled in document') ||
    (ctx.isEmbeddedIframe &&
      (rawName === 'SecurityError' ||
        (rawName === 'NotAllowedError' && ctx.browserPermissionState === 'GRANTED')));

  if (looksLikePolicyBlock) {
    return {
      category: 'IFRAME_POLICY_BLOCKED',
      fatalForAlwaysListening: true,
      permissionDenied: false,
      rawErrorName: rawName,
      sanitizedErrorMessage: sanitizedMsg,
      message:
        `Embedded preview iframe blocked microphone access via Permissions Policy (${originLabel}). Top-level AI Studio microphone permission does not automatically pass into cross-origin previews without iframe allow="microphone". Open the preview app URL directly in a Chrome tab or type your command below.`,
      urduMessage:
        'پری ویو iframe کی Permissions Policy نے مائیکروفون بلاک کر دیا ہے۔ AI Studio کی مائیک اجازت خودکار طور پر پری ویو لنک تک منتقل نہیں ہوتی۔ Signal Forge کو الگ Chrome ٹیب میں کھولیں یا نیچے ٹیکسٹ کمانڈ لکھیں۔',
    };
  }

  if (
    (rawName === 'NotAllowedError' || rawName === 'PermissionDeniedError') &&
    lowerMsg.includes('dismissed')
  ) {
    return {
      category: 'PERMISSION_DISMISSED',
      fatalForAlwaysListening: true,
      permissionDenied: false,
      rawErrorName: rawName,
      sanitizedErrorMessage: sanitizedMsg,
      message:
        'Microphone permission prompt was dismissed before allowing access. Tap Push-to-Talk again and choose "Allow", or type your command below.',
      urduMessage:
        'مائیکروفون کی اجازت والا پاپ اپ بند کر دیا گیا۔ دوبارہ Push-to-Talk دبائیں اور "Allow" منتخب کریں، یا نیچے ٹیکسٹ کمانڈ لکھیں۔',
    };
  }

  if (
    (rawName === 'NotAllowedError' || rawName === 'PermissionDeniedError') &&
    (lowerMsg.includes('by system') || lowerMsg.includes('system'))
  ) {
    return {
      category: 'OS_PERMISSION_BLOCKED',
      fatalForAlwaysListening: true,
      permissionDenied: true,
      rawErrorName: rawName,
      sanitizedErrorMessage: sanitizedMsg,
      message: ctx.isMobileChromeAndroid
        ? 'Android OS blocked microphone access for Chrome. Open Android Settings > Apps > Chrome > Permissions > Microphone and set to Allow, then reload—or type your command below.'
        : 'Operating system privacy settings blocked microphone access for this browser. Enable microphone access in OS settings and reload, or type your command below.',
      urduMessage: ctx.isMobileChromeAndroid
        ? 'Android سسٹم نے Chrome کے لیے مائیکروفون بند کر رکھا ہے۔ Android Settings > Apps > Chrome > Permissions > Microphone میں جا کر Allow کریں، یا نیچے ٹیکسٹ کمانڈ استعمال کریں۔'
        : 'آپ کے ڈیوائس کی سسٹم سیٹنگز نے براؤزر کا مائیکروفون بلاک کر رکھا ہے۔ سسٹم سیٹنگز میں مائیک کی اجازت دیں یا نیچے ٹیکسٹ کمانڈ لکھیں۔',
    };
  }

  switch (rawName) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return {
        category: 'PERMISSION_DENIED',
        fatalForAlwaysListening: true,
        permissionDenied: true,
        rawErrorName: rawName,
        sanitizedErrorMessage: sanitizedMsg,
        message: ctx.isEmbeddedIframe
          ? `Microphone permission was denied for the preview app origin (${originLabel}). Note: allowing AI Studio alone does not grant permission to the embedded preview origin. Open the preview URL directly in Chrome, allow Microphone in Site Settings, or type your command below.`
          : ctx.isMobileChromeAndroid
          ? `Microphone permission was denied for ${originLabel} in mobile Chrome. Tap the address bar tune/lock icon > Permissions > Microphone > Allow (and verify Android Chrome Microphone permission), or type your command below.`
          : `Microphone permission was denied for ${originLabel}. Enable Microphone in browser Site Settings and retry, or type your command below.`,
        urduMessage: ctx.isEmbeddedIframe
          ? 'پری ویو ایپ کے لنک کے لیے مائیکروفون کی اجازت مسترد کر دی گئی ہے۔ صرف AI Studio کو اجازت دینا کافی نہیں—Signal Forge کو الگ Chrome ٹیب میں کھول کر Site Settings میں Microphone Allow کریں، یا نیچے ٹیکسٹ کمانڈ استعمال کریں۔'
          : ctx.isMobileChromeAndroid
          ? 'موبائل Chrome میں اس سائٹ کے لیے مائیکروفون کی اجازت بند ہے۔ ایڈریس بار کے آئیکن پر ٹیپ کریں > Permissions > Microphone > Allow کریں، یا نیچے ٹیکسٹ کمانڈ لکھیں۔'
          : 'اس سائٹ کے لیے مائیکروفون کی اجازت مسترد ہے۔ براؤزر کی Site Settings میں Microphone Allow کریں یا نیچے ٹیکسٹ کمانڈ استعمال کریں۔',
      };
    case 'SecurityError':
      return {
        category: 'IFRAME_POLICY_BLOCKED',
        fatalForAlwaysListening: true,
        permissionDenied: false,
        rawErrorName: rawName,
        sanitizedErrorMessage: sanitizedMsg,
        message:
          'Browser security policy prevented microphone initialization in this frame or context. Open Signal Forge directly in a secure HTTPS tab or type your command below.',
        urduMessage:
          'براؤزر کی سیکیورٹی پالیسی نے اس فریم میں مائیکروفون شروع ہونے سے روک دیا ہے۔ Signal Forge کو الگ HTTPS ٹیب میں کھولیں یا نیچے ٹیکسٹ کمانڈ لکھیں۔',
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        category: 'NO_MICROPHONE',
        fatalForAlwaysListening: true,
        permissionDenied: false,
        rawErrorName: rawName,
        sanitizedErrorMessage: sanitizedMsg,
        message:
          'No microphone device was detected on this device. Connect or enable a microphone, or type your command below.',
        urduMessage:
          'اس ڈیوائس پر کوئی مائیکروفون نہیں ملا۔ مائیکروفون کنیکٹ کریں یا نیچے ٹیکسٹ کمانڈ استعمال کریں۔',
      };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return {
        category: 'AUDIO_CAPTURE_FAILED',
        fatalForAlwaysListening: true,
        permissionDenied: false,
        rawErrorName: rawName,
        sanitizedErrorMessage: sanitizedMsg,
        message:
          'Microphone hardware is busy or could not start audio capture (another app, call, or tab may be using it). Close other audio apps and retry, or type your command below.',
        urduMessage:
          'مائیکروفون کسی دوسری ایپ یا ٹیب میں مصروف ہے یا آڈیو کیپچر شروع نہ ہو سکا۔ دوسری آڈیو ایپس بند کر کے دوبارہ کوشش کریں یا نیچے ٹیکسٹ کمانڈ لکھیں۔',
      };
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return {
        category: 'AUDIO_CAPTURE_FAILED',
        fatalForAlwaysListening: true,
        permissionDenied: false,
        rawErrorName: rawName,
        sanitizedErrorMessage: sanitizedMsg,
        message:
          'Device microphone rejected the requested audio constraints. Tap Push-to-Talk to retry with basic audio or type your command below.',
        urduMessage:
          'ڈیوائس کے مائیکروفون نے آڈیو سیٹنگز قبول نہیں کیں۔ دوبارہ کوشش کریں یا نیچے ٹیکسٹ کمانڈ استعمال کریں۔',
      };
    case 'InvalidStateError':
      return {
        category: 'RECOGNITION_START_FAILED',
        fatalForAlwaysListening: false,
        permissionDenied: false,
        rawErrorName: rawName,
        sanitizedErrorMessage: sanitizedMsg,
        message:
          'Speech recognition session was resetting. Tap Push-to-Talk again in a moment, or type your command below.',
        urduMessage:
          'وائس سیشن ری سیٹ ہو رہا تھا۔ ایک لمحے بعد دوبارہ Push-to-Talk دبائیں یا نیچے ٹیکسٹ کمانڈ لکھیں۔',
      };
    default:
      return {
        category: 'AUDIO_CAPTURE_FAILED',
        fatalForAlwaysListening: true,
        permissionDenied: false,
        rawErrorName: rawName,
        sanitizedErrorMessage: sanitizedMsg,
        message:
          `Could not initialize microphone capture (${rawName || 'UnknownError'}). This is not a permission denial—retry or type your command below.`,
        urduMessage:
          'مائیکروفون شروع کرنے میں تکنیکی خرابی آئی۔ براہ کرم دوبارہ کوشش کریں یا نیچے ٹیکسٹ کمانڈ استعمال کریں۔',
      };
  }
}

export function classifySpeechRecognitionError(
  errorCode?: string | null,
  context?: {
    readonly isEmbeddedIframe?: boolean;
    readonly permissionsPolicyAllowsMic?: boolean | null;
    readonly origin?: string | null;
  }
): ClassifiedVoiceError {
  const code = String(errorCode || '').trim().toLowerCase();
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      if (context?.permissionsPolicyAllowsMic === false) {
        return {
          category: 'IFRAME_POLICY_BLOCKED',
          fatalForAlwaysListening: true,
          permissionDenied: false,
          rawErrorName: code,
          sanitizedErrorMessage: null,
          message:
            'Speech recognition was blocked by the embedded iframe Permissions Policy. Open Signal Forge directly in a Chrome tab or type your command below.',
          urduMessage:
            'ایمبیڈڈ iframe کی پالیسی نے Speech Recognition کو بلاک کر دیا ہے۔ Signal Forge کو الگ Chrome ٹیب میں کھولیں یا نیچے ٹیکسٹ کمانڈ لکھیں۔',
        };
      }
      return {
        category: 'PERMISSION_DENIED',
        fatalForAlwaysListening: true,
        permissionDenied: true,
        rawErrorName: code,
        sanitizedErrorMessage: null,
        message: context?.isEmbeddedIframe
          ? `Speech recognition permission was denied on the preview origin (${normalizeOriginForDiagnostics(context.origin)}). Open Signal Forge directly in Chrome and allow Microphone permission, or type your command below.`
          : 'Microphone or speech recognition permission was denied by the browser. Allow microphone access in Site Settings and try again, or type your command below.',
        urduMessage: context?.isEmbeddedIframe
          ? 'پری ویو لنک پر Speech Recognition کی اجازت بند ہے۔ Signal Forge کو الگ Chrome ٹیب میں کھول کر مائیک کی اجازت دیں یا نیچے ٹیکسٹ کمانڈ استعمال کریں۔'
          : 'براؤزر نے مائیکروفون یا Speech Recognition کی اجازت مسترد کر دی ہے۔ Site Settings میں مائیک Allow کریں یا نیچے ٹیکسٹ کمانڈ لکھیں۔',
      };
    case 'audio-capture':
      return {
        category: 'AUDIO_CAPTURE_FAILED',
        fatalForAlwaysListening: true,
        permissionDenied: false,
        rawErrorName: code,
        sanitizedErrorMessage: null,
        message:
          'Audio capture failed — no active microphone stream was received by the speech engine. Ensure no other app is locking the mic, or type your command below.',
        urduMessage:
          'آڈیو کیپچر ناکام ہو گیا — مائیکروفون سے آواز موصول نہیں ہوئی۔ چیک کریں کہ کوئی اور ایپ مائیک استعمال نہ کر رہی ہو، یا نیچے ٹیکسٹ کمانڈ لکھیں۔',
      };
    case 'no-speech':
      return {
        category: 'NO_SPEECH',
        fatalForAlwaysListening: false,
        permissionDenied: false,
        rawErrorName: code,
        sanitizedErrorMessage: null,
        message:
          'No speech was detected. Tap Push-to-Talk and speak clearly close to the microphone, or type your command below.',
        urduMessage:
          'کوئی آواز سنائی نہیں دی۔ Push-to-Talk دبا کر مائیک کے قریب واضح بولیں یا نیچے ٹیکسٹ کمانڈ لکھیں۔',
      };
    case 'network':
      return {
        category: 'SPEECH_NETWORK_ERROR',
        fatalForAlwaysListening: true,
        permissionDenied: false,
        rawErrorName: code,
        sanitizedErrorMessage: null,
        message:
          'Browser speech-to-text service encountered a network error. Check your internet connection or type your command below.',
        urduMessage:
          'براؤزر کی اسپیچ سروس میں نیٹ ورک خرابی آئی ہے۔ انٹرنیٹ چیک کریں یا نیچے ٹیکسٹ کمانڈ استعمال کریں۔',
      };
    case 'aborted':
      return {
        category: 'RECOGNITION_ABORTED',
        fatalForAlwaysListening: true,
        permissionDenied: false,
        rawErrorName: code,
        sanitizedErrorMessage: null,
        message: 'Voice listening was cancelled.',
        urduMessage: 'وائس سننے کا عمل منسوخ کر دیا گیا۔',
      };
    case 'language-not-supported':
      return {
        category: 'UNSUPPORTED_BROWSER',
        fatalForAlwaysListening: true,
        permissionDenied: false,
        rawErrorName: code,
        sanitizedErrorMessage: null,
        message:
          'Selected browser language is not supported by Speech Recognition. Falling back to English (en-US) or type your command below.',
        urduMessage:
          'منتخب زبان اس براؤزر کے Speech Recognition میں سپورٹ نہیں ہے۔ براہ کرم انگریزی میں بولیں یا نیچے ٹیکسٹ کمانڈ لکھیں۔',
      };
    default:
      return {
        category: 'UNKNOWN',
        fatalForAlwaysListening: true,
        permissionDenied: false,
        rawErrorName: code || null,
        sanitizedErrorMessage: null,
        message: `Speech recognition stopped unexpectedly (${code || 'unknown error'}). Tap Push-to-Talk to retry or type your command below.`,
        urduMessage:
          'Speech Recognition غیر متوقع طور پر بند ہو گیا۔ دوبارہ Push-to-Talk دبائیں یا نیچے ٹیکسٹ کمانڈ استعمال کریں۔',
      };
  }
}

export function shouldAutoRetryAlwaysListening(
  category: VoiceErrorCategory,
  consecutiveErrors: number
): boolean {
  if (
    category === 'PERMISSION_DENIED' ||
    category === 'PERMISSION_DISMISSED' ||
    category === 'OS_PERMISSION_BLOCKED' ||
    category === 'IFRAME_POLICY_BLOCKED' ||
    category === 'MEDIA_DEVICES_UNAVAILABLE' ||
    category === 'NO_MICROPHONE' ||
    category === 'AUDIO_CAPTURE_FAILED' ||
    category === 'INSECURE_CONTEXT' ||
    category === 'UNSUPPORTED_BROWSER' ||
    category === 'SPEECH_NETWORK_ERROR' ||
    category === 'RECOGNITION_ABORTED'
  ) {
    return false;
  }
  return consecutiveErrors < VOICE_MAX_ALWAYS_ON_CONSECUTIVE_ERRORS;
}

function parseQuotaDetailsFromMessage(rawMessage: string): {
  quotaScope: GeminiQuotaScope;
  retryAfterSeconds: number | null;
  quotaMetric: string | null;
} {
  const upper = rawMessage.toUpperCase();
  let quotaScope: GeminiQuotaScope = 'UNKNOWN';
  if (upper.includes('LIMIT: 0') || upper.includes('"QUOTAVALUE":"0"') || upper.includes('FREE_TIER_REQUESTS') && upper.includes('LIMIT: 0')) {
    quotaScope = 'FREE_TIER_LIMIT_ZERO';
  } else if (upper.includes('PERDAY') || upper.includes('PER_DAY') || upper.includes('DAILY') || upper.includes('REQUESTS_PER_DAY')) {
    quotaScope = 'PER_DAY';
  } else if (
    upper.includes('PERMINUTE') ||
    upper.includes('PER_MINUTE') ||
    upper.includes('RPM') ||
    upper.includes('TPM') ||
    upper.includes('RETRY IN') ||
    upper.includes('RETRYDELAY')
  ) {
    quotaScope = 'PER_MINUTE';
  }

  let retryAfterSeconds: number | null = null;
  const retryDelayMatch =
    rawMessage.match(/retryDelay["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)s/i) ||
    rawMessage.match(/retry in\s+(\d+(?:\.\d+)?)\s*s/i) ||
    rawMessage.match(/(\d+)\s*seconds?/i);
  if (retryDelayMatch) {
    const parsed = Math.ceil(Number(retryDelayMatch[1]));
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 86400) {
      retryAfterSeconds = parsed;
    }
  }

  let quotaMetric: string | null = null;
  const metricMatch =
    rawMessage.match(/quotaMetric["']?\s*[:=]\s*["']?([a-zA-Z0-9._/-]{6,90})/i) ||
    rawMessage.match(/quotaId["']?\s*[:=]\s*["']?([a-zA-Z0-9._/-]{6,90})/i);
  if (metricMatch) {
    quotaMetric = metricMatch[1];
  }

  return { quotaScope, retryAfterSeconds, quotaMetric };
}

/**
 * Classifies server-side Gemini SDK errors without leaking API keys or raw JSON dumps.
 */
export function classifyGeminiServerError(
  error: unknown,
  modelName?: string
): ClassifiedGeminiServerError {
  const errObj = error as { status?: number; code?: number | string; message?: string; name?: string } | null;
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof errObj?.message === 'string'
      ? errObj.message
      : String(error || '');
  const upper = rawMessage.toUpperCase();
  const numericStatus =
    typeof errObj?.status === 'number'
      ? errObj.status
      : typeof errObj?.code === 'number'
      ? errObj.code
      : 0;
  const modelLabel = modelName || 'Gemini';

  if (
    errObj?.name === 'AbortError' ||
    upper.includes('TIMEOUT') ||
    upper.includes('TIMED OUT') ||
    upper.includes('DEADLINE_EXCEEDED') ||
    numericStatus === 504
  ) {
    return {
      httpStatus: 504,
      code: 'GEMINI_TIMEOUT',
      errorCategory: 'TIMEOUT',
      retryableWithFallback: false,
      message:
        `${modelLabel} timed out waiting for an upstream response (HTTP 504). Loading stopped cleanly — please retry or use a local text command like "status".`,
      urduMessage:
        'AI ماڈل کا جواب مقررہ وقت میں موصول نہیں ہوا (HTTP 504)۔ براہ کرم دوبارہ کوشش کریں یا مقامی کمانڈ "status" لکھیں۔',
    };
  }

  if (
    numericStatus === 429 ||
    upper.includes('RESOURCE_EXHAUSTED') ||
    upper.includes('"CODE":429') ||
    upper.includes('QUOTA')
  ) {
    const quota = parseQuotaDetailsFromMessage(rawMessage);
    const waitHint = quota.retryAfterSeconds
      ? ` Retry after ~${quota.retryAfterSeconds}s.`
      : '';
    const scopeLabel =
      quota.quotaScope === 'PER_MINUTE'
        ? 'per-minute rate limit'
        : quota.quotaScope === 'PER_DAY'
        ? 'daily quota limit'
        : quota.quotaScope === 'FREE_TIER_LIMIT_ZERO'
        ? 'zero free-tier model quota'
        : 'API quota / rate limit';
    const urduWait = quota.retryAfterSeconds
      ? ` تقریباً ${quota.retryAfterSeconds} سیکنڈ بعد دوبارہ کوشش کریں۔`
      : ' کچھ دیر بعد دوبارہ کوشش کریں۔';

    return {
      httpStatus: 429,
      code: 'GEMINI_QUOTA_EXHAUSTED',
      errorCategory: 'QUOTA_EXHAUSTED',
      // Automatic AI fallback is strictly disabled per operational policy
      retryableWithFallback: false,
      quotaScope: quota.quotaScope,
      retryAfterSeconds: quota.retryAfterSeconds,
      quotaMetric: quota.quotaMetric,
      message:
        `Gemini ${modelLabel} reached its ${scopeLabel} (HTTP 429).${waitHint} Automatic AI fallback is disabled; local commands ("hello", "status", Trade IDs, navigation) continue working normally.`,
      urduMessage:
        `Gemini (${modelLabel}) کی کوٹہ یا ریٹ لمٹ پوری ہو گئی ہے (HTTP 429)۔${urduWait} مقامی کمانڈز ("hello"، "status"، Trade ID، نیویگیشن) ابھی بھی کام کر رہی ہیں۔`,
    };
  }

  if (
    numericStatus === 401 ||
    numericStatus === 403 ||
    upper.includes('PERMISSION_DENIED') ||
    upper.includes('API_KEY_INVALID') ||
    upper.includes('INVALID_API_KEY') ||
    upper.includes('API KEY NOT VALID') ||
    upper.includes('INVALID API KEY') ||
    upper.includes('UNAUTHENTICATED') ||
    upper.includes('ACCESS_DENIED')
  ) {
    const authStatus =
      numericStatus === 401 ||
      upper.includes('UNAUTHENTICATED') ||
      upper.includes('API_KEY_INVALID') ||
      upper.includes('INVALID_API_KEY') ||
      upper.includes('API KEY NOT VALID') ||
      upper.includes('INVALID API KEY')
        ? 401
        : 403;
    return {
      httpStatus: authStatus,
      code: 'GEMINI_AUTH_ERROR',
      errorCategory: 'AUTH_ERROR',
      retryableWithFallback: false,
      message:
        `Gemini API credentials were rejected (HTTP ${authStatus}). Replace or verify your Gemini API Key in Settings > Command Hub.`,
      urduMessage:
        `Gemini API کی تصدیق ناکام ہو گئی (HTTP ${authStatus})۔ براہ کرم Settings میں Gemini API کلید چیک یا تبدیل کریں۔`,
    };
  }

  if (
    upper.includes('ECONNREFUSED') ||
    upper.includes('ENOTFOUND') ||
    upper.includes('ECONNRESET') ||
    upper.includes('EAI_AGAIN') ||
    upper.includes('FETCH FAILED') ||
    upper.includes('SOCKET HANG UP') ||
    upper.includes('NETWORK ERROR') ||
    upper.includes('NETWORK_ERROR')
  ) {
    return {
      httpStatus: 502,
      code: 'GEMINI_NETWORK_ERROR',
      errorCategory: 'NETWORK_ERROR',
      retryableWithFallback: false,
      message:
        `Network failure contacting Gemini API for ${modelLabel} (HTTP 502). Check connectivity and retry, or run local "status".`,
      urduMessage:
        'Gemini API سے نیٹ ورک رابطہ ناکام ہو گیا (HTTP 502)۔ انٹرنیٹ چیک کریں اور دوبارہ کوشش کریں یا مقامی کمانڈ "status" چلائیں۔',
    };
  }

  if (numericStatus === 404 || upper.includes('NOT_FOUND') || upper.includes('"CODE":404')) {
    return {
      httpStatus: 502,
      code: 'GEMINI_MODEL_NOT_FOUND',
      errorCategory: 'MODEL_UNAVAILABLE',
      retryableWithFallback: false,
      message:
        `Configured Gemini model (${modelLabel}) was not found or unavailable (HTTP 404). Verify the selected model in Settings.`,
      urduMessage:
        'مطلوبہ Gemini ماڈل اس وقت دستیاب نہیں ہے (HTTP 404)۔ براہ کرم Settings میں منتخب ماڈل چیک کریں۔',
    };
  }

  if (
    numericStatus === 503 ||
    upper.includes('UNAVAILABLE') ||
    upper.includes('HIGH DEMAND') ||
    upper.includes('OVERLOADED') ||
    upper.includes('"CODE":503')
  ) {
    return {
      httpStatus: 503,
      code: 'GEMINI_MODEL_UNAVAILABLE',
      errorCategory: 'MODEL_UNAVAILABLE',
      retryableWithFallback: false,
      message:
        `Gemini ${modelLabel} is temporarily experiencing high demand (HTTP 503). Automatic fallback is disabled — please retry shortly or use local commands.`,
      urduMessage:
        'Gemini ماڈل پر اس وقت عارضی طور پر زیادہ لوڈ ہے (HTTP 503)۔ براہ کرم کچھ لمحوں بعد دوبارہ کوشش کریں۔',
    };
  }

  if (numericStatus === 400 || upper.includes('INVALID_ARGUMENT') || upper.includes('"CODE":400')) {
    return {
      httpStatus: 400,
      code: 'GEMINI_BAD_REQUEST',
      errorCategory: 'VALIDATION',
      retryableWithFallback: false,
      message:
        'The AI Command request could not be accepted by the model (HTTP 400). Try rephrasing your command.',
      urduMessage:
        'آپ کی کمانڈ ماڈل کو قبول نہیں ہوئی (HTTP 400)۔ براہ کرم کمانڈ کو سادہ الفاظ میں دوبارہ لکھیں۔',
    };
  }

  return {
    httpStatus: 502,
    code: 'GEMINI_UPSTREAM_ERROR',
    errorCategory: 'SERVER_ERROR',
    retryableWithFallback: false,
    message:
      'The AI Command Agent encountered an upstream service error. Please try again in a few seconds.',
    urduMessage:
      'AI کمانڈ سروس میں عارضی سرور خرابی آئی ہے۔ براہ کرم چند سیکنڈ بعد دوبارہ کوشش کریں۔',
  };
}

export interface ParsedGeminiCommandOutput {
  readonly ok: boolean;
  readonly reply?: string;
  readonly intent?: string;
  readonly routeTarget?: string;
  readonly matchedTradeId?: string;
  readonly matchedSymbol?: string;
  readonly suggestedFollowUps?: readonly string[];
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

/**
 * Strictly validates structured JSON output returned by Gemini for the Command Hub.
 * Strips markdown ```json fences when present and explicitly flags empty, HTML, or
 * truncated/malformed upstream payloads instead of fabricating HTTP 200 replies.
 */
export function parseGeminiStructuredCommandPayload(
  rawText: string,
  modelName: string
): ParsedGeminiCommandOutput {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) {
    return {
      ok: false,
      errorCode: 'MALFORMED_MODEL_RESPONSE',
      errorMessage: `Gemini (${modelName}) returned an empty response payload (HTTP 502). Please retry or run local "status".`,
    };
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('<!doctype html') || lower.startsWith('<html')) {
    return {
      ok: false,
      errorCode: 'MALFORMED_MODEL_RESPONSE',
      errorMessage: `Upstream provider returned HTML instead of JSON for ${modelName} (HTTP 502). Please retry shortly.`,
    };
  }

  let candidateText = trimmed;
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch?.[1]) {
    candidateText = fencedMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(candidateText) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        errorCode: 'MALFORMED_MODEL_RESPONSE',
        errorMessage: `Gemini (${modelName}) returned a non-object JSON payload (HTTP 502). Please retry.`,
      };
    }
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
    if (!reply) {
      return {
        ok: false,
        errorCode: 'MALFORMED_MODEL_RESPONSE',
        errorMessage: `Gemini (${modelName}) returned structured JSON missing a valid "reply" field (HTTP 502). Please retry.`,
      };
    }
    return {
      ok: true,
      reply,
      intent: typeof parsed.intent === 'string' && parsed.intent.trim() ? parsed.intent.trim() : 'GENERAL',
      routeTarget: typeof parsed.routeTarget === 'string' ? parsed.routeTarget : undefined,
      matchedTradeId: typeof parsed.matchedTradeId === 'string' ? parsed.matchedTradeId : undefined,
      matchedSymbol: typeof parsed.matchedSymbol === 'string' ? parsed.matchedSymbol : undefined,
      suggestedFollowUps: Array.isArray(parsed.suggestedFollowUps)
        ? parsed.suggestedFollowUps.map((item) => String(item || '').trim()).filter(Boolean)
        : [],
    };
  } catch {
    return {
      ok: false,
      errorCode: 'MALFORMED_MODEL_RESPONSE',
      errorMessage: `Gemini (${modelName}) returned malformed or truncated JSON (HTTP 502). Please retry or run local "status".`,
    };
  }
}

function sanitizeNonJsonBodyPreview(rawText: string, maxLen = 110): string | null {
  if (!rawText) return null;
  const titleMatch = rawText.match(/<title[^>]*>([^<]{1,80})<\/title>/i);
  if (titleMatch?.[1]) {
    return sanitizeDiagnosticText(`HTML <title>: ${titleMatch[1]}`, maxLen);
  }
  const stripped = rawText
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return sanitizeDiagnosticText(stripped, maxLen);
}

function extractSafeUrlPath(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    return parsed.pathname || null;
  } catch {
    return null;
  }
}

/**
 * Safely parses `/api/ai-command-hub/query` responses without crashing on proxy auth redirects
 * (`/__cookie_check.html`), SPA HTML fallbacks, or gateway 502/504 pages.
 */
export async function parseSafeCommandHubResponse(
  res: Pick<Response, 'ok' | 'status' | 'headers' | 'text'> & {
    readonly redirected?: boolean;
    readonly url?: string;
  }
): Promise<SafeCommandApiResult> {
  const httpStatus = res.status;
  const headerDiagId = res.headers?.get?.('x-diagnostic-id') || undefined;
  const responseContentType = res.headers?.get?.('content-type') || null;
  const responseRedirected = Boolean(res.redirected);
  const responseUrlPath = extractSafeUrlPath(res.url);

  let rawText = '';
  try {
    rawText = await res.text();
  } catch {
    return {
      ok: false,
      httpStatus,
      model: 'gemini-4-hydrogen',
      reply: `Failed to read server response stream (HTTP ${httpStatus || 0}). Please retry.`,
      urduMessage: 'سرور کا جواب پڑھنے میں خرابی آئی۔ براہ کرم دوبارہ کوشش کریں۔',
      suggestedFollowUps: [],
      code: 'RESPONSE_READ_ERROR',
      errorCategory: 'INVALID_RESPONSE',
      diagnosticId: headerDiagId,
      responseContentType,
      responseRedirected,
      responseUrlPath,
      responseBodySnippet: null,
    };
  }

  let parsed: Record<string, unknown> | null = null;
  const trimmed = rawText.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const val = JSON.parse(trimmed);
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        parsed = val as Record<string, unknown>;
      }
    } catch {
      parsed = null;
    }
  }

  if (!parsed) {
    const lowerText = rawText.toLowerCase();
    const lowerCt = String(responseContentType || '').toLowerCase();
    const lowerUrl = String(res.url || '').toLowerCase();
    const responseBodySnippet = sanitizeNonJsonBodyPreview(rawText);

    const isProxyAuthRedirect =
      lowerUrl.includes('__cookie_check') ||
      lowerUrl.includes('accounts.google.com') ||
      lowerUrl.includes('_aistudio-auth') ||
      lowerText.includes('<title>cookie check</title>') ||
      lowerText.includes('_aistudio-iframe.js') ||
      lowerText.includes('__cookie_check.html') ||
      (responseRedirected && lowerCt.includes('text/html'));

    if (isProxyAuthRedirect) {
      return {
        ok: false,
        httpStatus,
        model: 'gemini-4-hydrogen',
        reply: `Preview proxy redirected this API request to an HTML session/cookie check page (HTTP ${httpStatus}, Content-Type: ${responseContentType || 'text/html'}${responseUrlPath ? `, Path: ${responseUrlPath}` : ''}). Reload the page or open Signal Forge inside your signed-in preview session to refresh cookies. Local commands ("hello", "status", Trade IDs) continue working.`,
        urduMessage:
          'پری ویو سرور نے اس API درخواست کو HTML سیشن/کوکی چیک صفحے پر ری ڈائریکٹ کر دیا (HTTP 200 HTML)۔ براہ کرم صفحہ ری فریش کریں یا سائن ان پری ویو میں دوبارہ کھولیں۔ مقامی کمانڈز ("hello" اور "status") ابھی بھی کام کر رہی ہیں۔',
        suggestedFollowUps: ['status', 'hello'],
        code: 'PREVIEW_SESSION_REDIRECT',
        errorCategory: 'AUTH_ERROR',
        diagnosticId: headerDiagId,
        responseContentType,
        responseRedirected: true,
        responseUrlPath,
        responseBodySnippet,
      };
    }

    const isHtmlResponse =
      lowerCt.includes('text/html') ||
      trimmed.toLowerCase().startsWith('<!doctype html') ||
      trimmed.toLowerCase().startsWith('<html');

    const category: CommandErrorCategory =
      httpStatus === 504
        ? 'TIMEOUT'
        : httpStatus === 429
        ? 'QUOTA_EXHAUSTED'
        : httpStatus === 401 || httpStatus === 403
        ? 'AUTH_ERROR'
        : httpStatus >= 500
        ? 'SERVER_ERROR'
        : 'INVALID_RESPONSE';

    return {
      ok: false,
      httpStatus,
      model: 'gemini-4-hydrogen',
      reply:
        httpStatus === 504
          ? 'Server gateway timed out (HTTP 504) before completing the command. Please retry.'
          : httpStatus === 403
          ? 'Command request was blocked by origin or session security policy (HTTP 403).'
          : isHtmlResponse
          ? `Server returned HTML instead of JSON (HTTP ${httpStatus || 'unknown'}, Content-Type: ${responseContentType || 'text/html'}${responseBodySnippet ? `, Preview: ${responseBodySnippet}` : ''}). Reload the app or run local "status".`
          : `Server returned a non-JSON response (HTTP ${httpStatus || 'unknown'}, Content-Type: ${responseContentType || 'unknown'}). Please retry.`,
      urduMessage:
        httpStatus === 504
          ? 'سرور گیٹ وے کا وقت ختم ہو گیا (HTTP 504)۔ براہ کرم دوبارہ کوشش کریں۔'
          : isHtmlResponse
          ? 'سرور نے JSON کے بجائے HTML صفحہ واپس کیا۔ براہ کرم صفحہ ری فریش کریں یا مقامی کمانڈ "status" چلائیں۔'
          : 'سرور سے غیر متوقع جواب موصول ہوا۔ براہ کرم دوبارہ کوشش کریں یا مقامی کمانڈ "status" لکھیں۔',
      suggestedFollowUps: ['status', 'hello'],
      code: isHtmlResponse ? 'HTML_NON_JSON_RESPONSE' : `HTTP_${httpStatus || 'NON_JSON'}`,
      errorCategory: category,
      diagnosticId: headerDiagId,
      responseContentType,
      responseRedirected,
      responseUrlPath,
      responseBodySnippet,
    };
  }

  const ok = Boolean(res.ok && parsed.ok);
  const schemaVersion =
    typeof parsed.schemaVersion === 'string' ? parsed.schemaVersion : undefined;
  const model =
    typeof parsed.model === 'string' && parsed.model ? parsed.model : 'gemini-4-hydrogen';
  const diagnosticId =
    typeof parsed.diagnosticId === 'string' ? parsed.diagnosticId : headerDiagId;
  const code = typeof parsed.code === 'string' ? parsed.code : undefined;
  const urduMessage =
    typeof parsed.urduMessage === 'string' && parsed.urduMessage.trim()
      ? parsed.urduMessage.trim()
      : null;
  const quotaScope =
    typeof parsed.quotaScope === 'string' ? (parsed.quotaScope as GeminiQuotaScope) : undefined;
  const retryAfterSeconds =
    typeof parsed.retryAfterSeconds === 'number' ? parsed.retryAfterSeconds : null;
  const quotaMetric = typeof parsed.quotaMetric === 'string' ? parsed.quotaMetric : null;
  const modelQuotaBreakdown = Array.isArray(parsed.modelQuotaBreakdown)
    ? (parsed.modelQuotaBreakdown as ModelQuotaDiagnosticEntry[])
    : undefined;

  if (!ok) {
    const inferredCategory: CommandErrorCategory =
      typeof parsed.errorCategory === 'string'
        ? (parsed.errorCategory as CommandErrorCategory)
        : httpStatus === 400
        ? 'VALIDATION'
        : httpStatus === 401 || httpStatus === 403
        ? 'AUTH_ERROR'
        : httpStatus === 429
        ? 'QUOTA_EXHAUSTED'
        : httpStatus === 503
        ? 'MODEL_UNAVAILABLE'
        : httpStatus === 504
        ? 'TIMEOUT'
        : 'SERVER_ERROR';
    return {
      ok: false,
      schemaVersion,
      httpStatus,
      model,
      reply:
        typeof parsed.error === 'string' && parsed.error.trim()
          ? parsed.error.trim()
          : typeof parsed.reply === 'string' && parsed.reply.trim()
          ? parsed.reply.trim()
          : `Command failed with HTTP ${httpStatus}.`,
      urduMessage:
        urduMessage ||
        (inferredCategory === 'QUOTA_EXHAUSTED'
          ? 'Gemini API کی کوٹہ لمٹ پوری ہو گئی ہے (HTTP 429)۔ کچھ دیر بعد دوبارہ کوشش کریں یا مقامی کمانڈ "status" استعمال کریں۔'
          : 'کمانڈ مکمل نہ ہو سکی۔ براہ کرم دوبارہ کوشش کریں یا مقامی کمانڈ "status" لکھیں۔'),
      suggestedFollowUps: Array.isArray(parsed.suggestedFollowUps)
        ? parsed.suggestedFollowUps.map((x) => String(x)).filter(Boolean)
        : [],
      code,
      errorCategory: inferredCategory,
      diagnosticId,
      quotaScope,
      retryAfterSeconds,
      quotaMetric,
      modelQuotaBreakdown,
      responseContentType,
      responseRedirected,
      responseUrlPath,
      responseBodySnippet: null,
    };
  }

  return {
    ok: true,
    schemaVersion,
    httpStatus,
    model,
    reply:
      typeof parsed.reply === 'string' && parsed.reply.trim()
        ? parsed.reply.trim()
        : 'Command processed.',
    urduMessage,
    intent: typeof parsed.intent === 'string' ? parsed.intent : 'GENERAL',
    routeTarget: typeof parsed.routeTarget === 'string' ? parsed.routeTarget : null,
    matchedTradeId: typeof parsed.matchedTradeId === 'string' ? parsed.matchedTradeId : null,
    matchedSymbol: typeof parsed.matchedSymbol === 'string' ? parsed.matchedSymbol : null,
    suggestedFollowUps: Array.isArray(parsed.suggestedFollowUps)
      ? parsed.suggestedFollowUps.map((x) => String(x)).filter(Boolean)
      : [],
    code,
    errorCategory: 'NONE',
    diagnosticId,
    modelQuotaBreakdown,
    responseContentType,
    responseRedirected,
    responseUrlPath,
    responseBodySnippet: null,
  };
}

export function classifyCommandClientError(
  error: unknown,
  abortReason?: 'TIMEOUT' | 'USER_CANCELLED' | 'SUPERSEDED' | null
): SafeCommandApiResult {
  if (abortReason === 'USER_CANCELLED') {
    return {
      ok: false,
      httpStatus: 0,
      model: 'gemini-4-hydrogen',
      reply: 'Command request cancelled by user.',
      urduMessage: 'کمانڈ کی درخواست منسوخ کر دی گئی۔',
      suggestedFollowUps: [],
      code: 'REQUEST_CANCELLED',
      errorCategory: 'CANCELLED',
    };
  }

  if (abortReason === 'TIMEOUT' || (error instanceof Error && error.name === 'TimeoutError')) {
    return {
      ok: false,
      httpStatus: 504,
      model: 'gemini-4-hydrogen',
      reply:
        'Request timed out after 30 seconds without a server response. Loading stopped cleanly — please retry or run local "status".',
      urduMessage:
        '30 سیکنڈ تک سرور سے جواب نہ آنے پر درخواست روک دی گئی۔ دوبارہ کوشش کریں یا مقامی کمانڈ "status" چلائیں۔',
      suggestedFollowUps: [],
      code: 'CLIENT_TIMEOUT',
      errorCategory: 'TIMEOUT',
    };
  }

  return {
    ok: false,
    httpStatus: 0,
    model: 'gemini-4-hydrogen',
    reply:
      'Network error reaching the AI Command endpoint. Check your internet connection and retry.',
    urduMessage:
      'AI کمانڈ سرور سے رابطہ نہیں ہو سکا۔ انٹرنیٹ چیک کریں اور دوبارہ کوشش کریں۔',
    suggestedFollowUps: [],
    code: 'NETWORK_ERROR',
    errorCategory: 'NETWORK_ERROR',
  };
}

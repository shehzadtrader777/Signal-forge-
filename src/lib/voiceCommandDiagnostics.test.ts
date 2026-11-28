import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyBrowserVoiceSupport,
  classifyCommandClientError,
  classifyGeminiServerError,
  classifyMicrophoneMediaError,
  classifySpeechRecognitionError,
  detectMobileChromeAndroid,
  matchDeterministicCommandIntent,
  parseGeminiStructuredCommandPayload,
  parseSafeCommandHubResponse,
  resolveSpeechRecognitionLanguage,
  sanitizeDiagnosticText,
  shouldAutoRetryAlwaysListening,
} from './voiceCommandDiagnostics';

test('classifyBrowserVoiceSupport validates HTTPS, iframe Permissions Policy, mediaDevices, and SpeechRecognition with Urdu guidance', () => {
  const insecure = classifyBrowserVoiceSupport({
    isSecureContext: false,
    hasMediaDevices: true,
    hasSpeechRecognition: true,
  });
  assert.equal(insecure.supported, false);
  assert.equal(insecure.errorCategory, 'INSECURE_CONTEXT');
  assert.ok(insecure.urduMessage && insecure.urduMessage.includes('HTTPS'));

  const iframeBlocked = classifyBrowserVoiceSupport({
    isSecureContext: true,
    hasMediaDevices: true,
    hasSpeechRecognition: true,
    isEmbeddedIframe: true,
    permissionsPolicyAllowsMic: false,
    origin: 'https://ais-dev-example.run.app',
  });
  assert.equal(iframeBlocked.supported, false);
  assert.equal(iframeBlocked.errorCategory, 'IFRAME_POLICY_BLOCKED');
  assert.notEqual(iframeBlocked.errorCategory, 'PERMISSION_DENIED');
  assert.ok(iframeBlocked.message?.includes('allow="microphone"'));
  assert.ok(iframeBlocked.urduMessage && iframeBlocked.urduMessage.includes('iframe'));

  const noMediaDevices = classifyBrowserVoiceSupport({
    isSecureContext: true,
    hasMediaDevices: false,
    hasSpeechRecognition: true,
  });
  assert.equal(noMediaDevices.supported, false);
  assert.equal(noMediaDevices.errorCategory, 'MEDIA_DEVICES_UNAVAILABLE');
  assert.notEqual(noMediaDevices.errorCategory, 'PERMISSION_DENIED');

  const unsupported = classifyBrowserVoiceSupport({
    isSecureContext: true,
    hasMediaDevices: true,
    hasSpeechRecognition: false,
  });
  assert.equal(unsupported.supported, false);
  assert.equal(unsupported.errorCategory, 'UNSUPPORTED_BROWSER');
  assert.ok(unsupported.urduMessage);

  const ok = classifyBrowserVoiceSupport({
    isSecureContext: true,
    hasMediaDevices: true,
    hasSpeechRecognition: true,
    isEmbeddedIframe: false,
    permissionsPolicyAllowsMic: true,
  });
  assert.equal(ok.supported, true);
  assert.equal(ok.errorCategory, null);

  assert.equal(resolveSpeechRecognitionLanguage('en-GB'), 'en-GB');
  assert.equal(resolveSpeechRecognitionLanguage('ur-PK'), 'ur-PK');
  assert.equal(resolveSpeechRecognitionLanguage(''), 'en-US');
  assert.equal(
    detectMobileChromeAndroid(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
    ),
    true
  );
  assert.equal(
    detectMobileChromeAndroid(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36'
    ),
    false
  );
});

test('classifyMicrophoneMediaError never labels iframe policy, dismissed prompts, OS blocks, or hardware errors as generic PERMISSION_DENIED', () => {
  const iframePolicy = classifyMicrophoneMediaError({
    errorName: 'NotAllowedError',
    errorMessage: 'Permissions Policy violation: microphone is not allowed in this document',
    isSecureContext: true,
    isEmbeddedIframe: true,
    permissionsPolicyAllowsMic: false,
    origin: 'https://ais-dev-example.run.app',
  });
  assert.equal(iframePolicy.category, 'IFRAME_POLICY_BLOCKED');
  assert.equal(iframePolicy.permissionDenied, false);
  assert.equal(shouldAutoRetryAlwaysListening(iframePolicy.category, 0), false);
  assert.ok(iframePolicy.urduMessage.length > 10);

  const dismissed = classifyMicrophoneMediaError({
    errorName: 'NotAllowedError',
    errorMessage: 'Permission dismissed',
    isSecureContext: true,
  });
  assert.equal(dismissed.category, 'PERMISSION_DISMISSED');
  assert.equal(dismissed.permissionDenied, false);
  assert.ok(dismissed.urduMessage.includes('Allow'));

  const androidOsBlocked = classifyMicrophoneMediaError({
    errorName: 'NotAllowedError',
    errorMessage: 'Permission denied by system',
    isSecureContext: true,
    isMobileChromeAndroid: true,
  });
  assert.equal(androidOsBlocked.category, 'OS_PERMISSION_BLOCKED');
  assert.ok(androidOsBlocked.message.includes('Android Settings'));
  assert.ok(androidOsBlocked.urduMessage.includes('Android Settings'));

  const genuineDeniedInIframe = classifyMicrophoneMediaError({
    errorName: 'NotAllowedError',
    errorMessage: 'Permission denied',
    isSecureContext: true,
    isEmbeddedIframe: true,
    permissionsPolicyAllowsMic: true,
    origin: 'https://ais-dev-example.run.app',
  });
  assert.equal(genuineDeniedInIframe.category, 'PERMISSION_DENIED');
  assert.equal(genuineDeniedInIframe.permissionDenied, true);
  assert.ok(genuineDeniedInIframe.message.includes('AI Studio'));
  assert.ok(genuineDeniedInIframe.urduMessage.includes('AI Studio'));

  const missingMic = classifyMicrophoneMediaError({ errorName: 'NotFoundError' });
  assert.equal(missingMic.category, 'NO_MICROPHONE');
  assert.equal(missingMic.permissionDenied, false);

  const busyMic = classifyMicrophoneMediaError({ errorName: 'NotReadableError' });
  assert.equal(busyMic.category, 'AUDIO_CAPTURE_FAILED');
  assert.equal(busyMic.permissionDenied, false);

  const invalidState = classifyMicrophoneMediaError({ errorName: 'InvalidStateError' });
  assert.equal(invalidState.category, 'RECOGNITION_START_FAILED');
  assert.equal(invalidState.permissionDenied, false);

  const speechNotAllowed = classifySpeechRecognitionError('not-allowed');
  assert.equal(speechNotAllowed.category, 'PERMISSION_DENIED');
  assert.equal(shouldAutoRetryAlwaysListening(speechNotAllowed.category, 0), false);

  const noSpeech = classifySpeechRecognitionError('no-speech');
  assert.equal(noSpeech.category, 'NO_SPEECH');
  assert.equal(shouldAutoRetryAlwaysListening(noSpeech.category, 0), true);
  assert.equal(shouldAutoRetryAlwaysListening(noSpeech.category, 2), false);

  const sanitized = sanitizeDiagnosticText(
    'Failed at https://secret.example/token=123 with key AIzaSyAbCdEfGhIjKlMnOpQrSt'
  );
  assert.ok(sanitized && !sanitized.includes('AIzaSy') && !sanitized.includes('secret.example'));
});

test('classifyGeminiServerError extracts model-specific HTTP 429 quota scope, retry delay, and Urdu guidance', () => {
  const quotaRpm = classifyGeminiServerError(
    {
      status: 429,
      message:
        'RESOURCE_EXHAUSTED: Quota exceeded for quotaMetric: generativelanguage.googleapis.com/generate_content_free_tier_requests_per_minute. Please retry in 34s.',
    },
    'gemini-4-hydrogen'
  );
  assert.equal(quotaRpm.httpStatus, 429);
  assert.equal(quotaRpm.errorCategory, 'QUOTA_EXHAUSTED');
  assert.equal(quotaRpm.quotaScope, 'PER_MINUTE');
  assert.equal(quotaRpm.retryAfterSeconds, 34);
  assert.ok(quotaRpm.quotaMetric?.includes('generate_content_free_tier_requests_per_minute'));
  // Automatic AI fallback must remain strictly disabled
  assert.equal(quotaRpm.retryableWithFallback, false);
  assert.ok(quotaRpm.urduMessage.includes('34'));

  const quotaDaily = classifyGeminiServerError(
    { status: 429, message: 'RESOURCE_EXHAUSTED: GenerateRequestsPerDayPerProjectPerModel exceeded' },
    'gemini-3.1-flash-lite'
  );
  assert.equal(quotaDaily.quotaScope, 'PER_DAY');
  assert.equal(quotaDaily.retryableWithFallback, false);

  const highDemand = classifyGeminiServerError(
    { status: 503, message: '{"error":{"code":503,"status":"UNAVAILABLE","message":"high demand"}}' },
    'gemini-4-hydrogen'
  );
  assert.equal(highDemand.httpStatus, 503);
  assert.equal(highDemand.errorCategory, 'MODEL_UNAVAILABLE');
  assert.equal(highDemand.retryableWithFallback, false);

  const timeout = classifyGeminiServerError(
    Object.assign(new Error('gemini-4-hydrogen timed out after 15000ms'), { name: 'AbortError' }),
    'gemini-4-hydrogen'
  );
  assert.equal(timeout.httpStatus, 504);
  assert.equal(timeout.errorCategory, 'TIMEOUT');
  assert.equal(timeout.retryableWithFallback, false);

  const invalidKey = classifyGeminiServerError({ status: 400, message: 'API_KEY_INVALID' });
  assert.equal(invalidKey.httpStatus, 401);
  assert.equal(invalidKey.errorCategory, 'AUTH_ERROR');
  assert.equal(invalidKey.retryableWithFallback, false);

  const permDenied = classifyGeminiServerError({ status: 403, message: 'PERMISSION_DENIED' });
  assert.equal(permDenied.httpStatus, 403);
  assert.equal(permDenied.errorCategory, 'AUTH_ERROR');
  assert.equal(permDenied.retryableWithFallback, false);

  const networkFail = classifyGeminiServerError(new Error('fetch failed: ECONNRESET'));
  assert.equal(networkFail.httpStatus, 502);
  assert.equal(networkFail.errorCategory, 'NETWORK_ERROR');
  assert.equal(networkFail.retryableWithFallback, false);

  const badReq = classifyGeminiServerError({ status: 400, message: 'INVALID_ARGUMENT' });
  assert.equal(badReq.httpStatus, 400);
  assert.equal(badReq.errorCategory, 'VALIDATION');
  assert.equal(badReq.retryableWithFallback, false);
});

test('parseGeminiStructuredCommandPayload validates clean/fenced JSON and rejects empty, HTML, or truncated payloads', () => {
  const clean = parseGeminiStructuredCommandPayload(
    JSON.stringify({
      reply: 'BTCUSDT spot is $60,420.',
      intent: 'GENERAL',
      matchedSymbol: 'BTCUSDT',
      suggestedFollowUps: ['status'],
    }),
    'gemini-4-hydrogen'
  );
  assert.equal(clean.ok, true);
  assert.equal(clean.reply, 'BTCUSDT spot is $60,420.');
  assert.equal(clean.matchedSymbol, 'BTCUSDT');

  const fenced = parseGeminiStructuredCommandPayload(
    '```json\n{"reply":"ETHUSDT spot is $3,200.","intent":"GENERAL"}\n```',
    'gemini-4-hydrogen'
  );
  assert.equal(fenced.ok, true);
  assert.equal(fenced.reply, 'ETHUSDT spot is $3,200.');

  const empty = parseGeminiStructuredCommandPayload('   ', 'gemini-4-hydrogen');
  assert.equal(empty.ok, false);
  assert.equal(empty.errorCode, 'MALFORMED_MODEL_RESPONSE');

  const html = parseGeminiStructuredCommandPayload('<!doctype html><html><body>502</body></html>', 'gemini-4-hydrogen');
  assert.equal(html.ok, false);
  assert.equal(html.errorCode, 'MALFORMED_MODEL_RESPONSE');

  const truncated = parseGeminiStructuredCommandPayload('{"reply":"cut off', 'gemini-4-hydrogen');
  assert.equal(truncated.ok, false);
  assert.equal(truncated.errorCode, 'MALFORMED_MODEL_RESPONSE');

  const missingReply = parseGeminiStructuredCommandPayload('{"intent":"GENERAL"}', 'gemini-4-hydrogen');
  assert.equal(missingReply.ok, false);
  assert.equal(missingReply.errorCode, 'MALFORMED_MODEL_RESPONSE');
});

test('parseSafeCommandHubResponse preserves Urdu messages, per-model 429 quota breakdowns, and handles HTML 504 safely', async () => {
  const html504 = await parseSafeCommandHubResponse({
    ok: false,
    status: 504,
    headers: new Headers({ 'x-diagnostic-id': 'SF-CMD-TEST504' }),
    text: async () => '<html><body>504 Gateway Time-out</body></html>',
  });
  assert.equal(html504.ok, false);
  assert.equal(html504.httpStatus, 504);
  assert.equal(html504.errorCategory, 'TIMEOUT');
  assert.ok(html504.urduMessage);

  const quota429 = await parseSafeCommandHubResponse({
    ok: false,
    status: 429,
    headers: new Headers({ 'x-diagnostic-id': 'SF-CMD-Q429' }),
    text: async () =>
      JSON.stringify({
        ok: false,
        code: 'GEMINI_QUOTA_EXHAUSTED',
        errorCategory: 'QUOTA_EXHAUSTED',
        model: 'gemini-3.1-flash-lite',
        quotaScope: 'PER_MINUTE',
        retryAfterSeconds: 25,
        error: 'Gemini quota reached.',
        urduMessage: 'کوٹہ لمٹ پوری ہو گئی ہے۔',
        modelQuotaBreakdown: [
          {
            model: 'gemini-4-hydrogen',
            ok: false,
            httpStatus: 429,
            code: 'GEMINI_QUOTA_EXHAUSTED',
            errorCategory: 'QUOTA_EXHAUSTED',
            quotaScope: 'PER_MINUTE',
            retryAfterSeconds: 30,
            message: '429 on primary',
          },
          {
            model: 'gemini-3.1-flash-lite',
            ok: false,
            httpStatus: 429,
            code: 'GEMINI_QUOTA_EXHAUSTED',
            errorCategory: 'QUOTA_EXHAUSTED',
            quotaScope: 'PER_MINUTE',
            retryAfterSeconds: 25,
            message: '429 on fallback',
          },
        ],
      }),
  });
  assert.equal(quota429.ok, false);
  assert.equal(quota429.httpStatus, 429);
  assert.equal(quota429.urduMessage, 'کوٹہ لمٹ پوری ہو گئی ہے۔');
  assert.equal(quota429.modelQuotaBreakdown?.length, 2);

  const cancelled = classifyCommandClientError(new Error('aborted'), 'USER_CANCELLED');
  assert.equal(cancelled.errorCategory, 'CANCELLED');
  assert.ok(cancelled.urduMessage);

  const timedOut = classifyCommandClientError(new Error('aborted'), 'TIMEOUT');
  assert.equal(timedOut.errorCategory, 'TIMEOUT');
  assert.equal(timedOut.httpStatus, 504);
  assert.ok(timedOut.urduMessage);
});

test('matchDeterministicCommandIntent classifies harmless greetings and read-only status cleanly with mobile punctuation', () => {
  assert.equal(matchDeterministicCommandIntent('hello'), 'GREETING');
  assert.equal(matchDeterministicCommandIntent('Hello!'), 'GREETING');
  assert.equal(matchDeterministicCommandIntent('Hi Signal Forge'), 'GREETING');
  assert.equal(matchDeterministicCommandIntent('salam'), 'GREETING');
  assert.equal(matchDeterministicCommandIntent('help'), 'GREETING');

  assert.equal(matchDeterministicCommandIntent('status'), 'STATUS');
  assert.equal(matchDeterministicCommandIntent('Status.'), 'STATUS');
  assert.equal(matchDeterministicCommandIntent('Show Signal Forge system status.'), 'STATUS');
  assert.equal(matchDeterministicCommandIntent('check status'), 'STATUS');

  assert.equal(matchDeterministicCommandIntent('What is BTCUSDT price right now?'), null);
  assert.equal(matchDeterministicCommandIntent('hello weather today'), null);
});

test('parseSafeCommandHubResponse distinguishes HTTP 200 proxy cookie-check redirects from SPA HTML fallbacks and validates v1.0 JSON', async () => {
  const proxyCookieCheck = await parseSafeCommandHubResponse({
    ok: true,
    status: 200,
    redirected: true,
    url: 'https://ais-dev-example.run.app/__cookie_check.html?return_url=https%3A%2F%2Fais-dev-example.run.app%2Fapi%2Fai-command-hub%2Fquery',
    headers: new Headers({ 'content-type': 'text/html' }),
    text: async () => '<!doctype html><html lang="en"><head><title>Cookie check</title></head><body>Redirecting...</body></html>',
  });
  assert.equal(proxyCookieCheck.ok, false);
  assert.equal(proxyCookieCheck.httpStatus, 200);
  assert.equal(proxyCookieCheck.errorCategory, 'AUTH_ERROR');
  assert.equal(proxyCookieCheck.code, 'PREVIEW_SESSION_REDIRECT');
  assert.equal(proxyCookieCheck.responseRedirected, true);
  assert.equal(proxyCookieCheck.responseContentType, 'text/html');
  assert.equal(proxyCookieCheck.responseUrlPath, '/__cookie_check.html');
  assert.ok(proxyCookieCheck.responseBodySnippet?.includes('Cookie check'));
  assert.ok(proxyCookieCheck.urduMessage && proxyCookieCheck.urduMessage.includes('HTML'));

  const spaHtmlFallback = await parseSafeCommandHubResponse({
    ok: true,
    status: 200,
    redirected: false,
    url: 'https://ais-dev-example.run.app/api/ai-command-hub/query',
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    text: async () => '<!doctype html><html><head><title>Signal Forge</title></head><body><div id="root"></div></body></html>',
  });
  assert.equal(spaHtmlFallback.ok, false);
  assert.equal(spaHtmlFallback.httpStatus, 200);
  assert.equal(spaHtmlFallback.errorCategory, 'INVALID_RESPONSE');
  assert.equal(spaHtmlFallback.code, 'HTML_NON_JSON_RESPONSE');
  assert.equal(spaHtmlFallback.responseContentType, 'text/html; charset=utf-8');
  assert.ok(spaHtmlFallback.reply.includes('HTML instead of JSON'));

  const documentedSuccess = await parseSafeCommandHubResponse({
    ok: true,
    status: 200,
    headers: new Headers({
      'content-type': 'application/json; charset=utf-8',
      'x-diagnostic-id': 'SF-CMD-V1OK',
    }),
    text: async () =>
      JSON.stringify({
        schemaVersion: '1.0',
        ok: true,
        httpStatus: 200,
        diagnosticId: 'SF-CMD-V1OK',
        code: 'OK',
        errorCategory: 'NONE',
        model: 'gemini-3.1-flash-lite',
        source: 'TEXT',
        reply: 'BTCUSDT is trading near $60,245 with HTTP 423 Paper/Demo isolation active.',
        error: null,
        urduMessage: null,
        intent: 'GENERAL',
        routeTarget: null,
        matchedTradeId: null,
        matchedSymbol: 'BTCUSDT',
        suggestedFollowUps: ['status', 'Open Signals'],
        modelQuotaBreakdown: [],
        generatedAtIso: '2026-11-24T12:00:00.000Z',
      }),
  });
  assert.equal(documentedSuccess.ok, true);
  assert.equal(documentedSuccess.schemaVersion, '1.0');
  assert.equal(documentedSuccess.model, 'gemini-3.1-flash-lite');
  assert.equal(documentedSuccess.matchedSymbol, 'BTCUSDT');
  assert.equal(documentedSuccess.errorCategory, 'NONE');
});

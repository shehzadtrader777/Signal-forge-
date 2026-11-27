import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectBrowserMagicMime,
  mapHttpScannerError,
  mapNetworkScannerException,
  normalizeDeclaredImageMime,
  parseSafeApiResponse,
} from './chartScannerDiagnostics';

test('Phase C Diagnostics: normalizes mobile MIME quirks without weakening disallowed MIME rejection', () => {
  const jpegMagic = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const webpMagic = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const textMagic = new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e, 0, 0, 0, 0, 0, 0]);

  assert.equal(detectBrowserMagicMime(jpegMagic), 'image/jpeg');
  assert.equal(detectBrowserMagicMime(webpMagic), 'image/webp');
  assert.equal(detectBrowserMagicMime(textMagic), null);

  // Mobile gallery empty file.type on a real JPEG resolves to image/jpeg (not image/png!)
  assert.equal(
    normalizeDeclaredImageMime({ declaredMime: '', fileName: 'IMG_2026.jpg', magicMime: 'image/jpeg' }),
    'image/jpeg'
  );
  // image/jpg alias normalizes to image/jpeg
  assert.equal(
    normalizeDeclaredImageMime({ declaredMime: 'image/jpg', fileName: 'chart.jpg', magicMime: 'image/jpeg' }),
    'image/jpeg'
  );
  // Disallowed MIME (e.g. PDF or SVG) is preserved so server security validation rejects it
  assert.equal(
    normalizeDeclaredImageMime({ declaredMime: 'application/pdf', fileName: 'fake.pdf', magicMime: null }),
    'application/pdf'
  );
});

test('Phase C Diagnostics: safely parses HTML 413 Payload Too Large without throwing SyntaxError and returns English + Urdu + Diagnostic ID', async () => {
  const html413 = new Response(
    '<!DOCTYPE html><html><body><pre>PayloadTooLargeError: request entity too large</pre></body></html>',
    { status: 413, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
  const parsed = await parseSafeApiResponse(html413);
  assert.equal(parsed.isJson, false);
  assert.equal(parsed.status, 413);

  const mapped = mapHttpScannerError(parsed, 'upload');
  assert.equal(mapped.category, 'PAYLOAD_TOO_LARGE');
  assert.equal(mapped.creditsCharged, 0);
  assert.match(mapped.diagnosticId, /^SF-VAL-/);
  assert.match(mapped.messageEn, /5 MB/i);
  assert.ok(mapped.messageUr.includes('5 MB'));
  assert.ok(!/gemini|quota/i.test(mapped.messageEn));
});

test('Phase C Diagnostics: distinguishes network/timeout errors from HTTP 422 validation and HTTP 429 quota errors', async () => {
  const timeoutErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
  const mappedTimeout = mapNetworkScannerException(timeoutErr, { stage: 'upload' });
  assert.equal(mappedTimeout.category, 'REQUEST_TIMEOUT');
  assert.equal(mappedTimeout.creditsCharged, 0);
  assert.match(mappedTimeout.messageEn, /not an AI quota issue/i);
  assert.ok(mappedTimeout.messageUr.length > 10);

  const offlineMapped = mapNetworkScannerException(new TypeError('Failed to fetch'), {
    isOffline: true,
    stage: 'upload',
  });
  assert.equal(offlineMapped.category, 'NETWORK_OFFLINE');
  assert.equal(offlineMapped.creditsCharged, 0);

  const json422 = new Response(
    JSON.stringify({
      ok: false,
      creditsCharged: 0,
      code: 'REJECTED_NOT_A_TRADING_CHART',
      error: 'Not a trading chart.',
      diagnosticId: 'SF-VAL-SERVER-1234',
    }),
    { status: 422, headers: { 'content-type': 'application/json', 'x-diagnostic-id': 'SF-VAL-SERVER-1234' } }
  );
  const parsed422 = await parseSafeApiResponse(json422);
  const mapped422 = mapHttpScannerError(parsed422, 'upload');
  assert.equal(mapped422.category, 'VALIDATION_REJECTED');
  assert.equal(mapped422.diagnosticId, 'SF-VAL-SERVER-1234');
  assert.equal(mapped422.creditsCharged, 0);

  const json429 = new Response(
    JSON.stringify({
      ok: false,
      creditsCharged: 0,
      code: 'DAILY_ACCOUNT_QUOTA_EXHAUSTED',
      error: 'Daily scan quota reached.',
    }),
    { status: 429, headers: { 'content-type': 'application/json' } }
  );
  const mapped429 = mapHttpScannerError(await parseSafeApiResponse(json429), 'analyze');
  assert.equal(mapped429.category, 'RATE_LIMIT_OR_QUOTA');
});

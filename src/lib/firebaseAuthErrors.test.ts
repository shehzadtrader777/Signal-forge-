import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractFirebaseAuthCode,
  formatFirebaseAuthError,
  isRetryableAuthNetworkError,
} from './firebaseAuthErrors';

test('extractFirebaseAuthCode extracts code from FirebaseError objects and message strings', () => {
  assert.equal(
    extractFirebaseAuthCode({ code: 'auth/network-request-failed' }),
    'auth/network-request-failed'
  );
  assert.equal(
    extractFirebaseAuthCode(new Error('Firebase: Error (auth/network-request-failed).')),
    'auth/network-request-failed'
  );
  assert.equal(
    extractFirebaseAuthCode('FirebaseError: Firebase: Error (auth/popup-blocked).'),
    'auth/popup-blocked'
  );
  assert.equal(extractFirebaseAuthCode(null), '');
});

test('isRetryableAuthNetworkError flags auth/network-request-failed cleanly', () => {
  assert.equal(isRetryableAuthNetworkError({ code: 'auth/network-request-failed' }), true);
  assert.equal(
    isRetryableAuthNetworkError(new Error('Firebase: Error (auth/network-request-failed).')),
    true
  );
  assert.equal(isRetryableAuthNetworkError({ code: 'auth/invalid-credential' }), false);
});

test('formatFirebaseAuthError maps network, popup, and provider errors to clear guidance', () => {
  const netErr = formatFirebaseAuthError({ code: 'auth/network-request-failed' });
  assert.equal(netErr.retryable, true);
  assert.equal(netErr.severity, 'error');
  assert.match(netErr.message, /firebaseapp\.com/i);

  const closedErr = formatFirebaseAuthError({ code: 'auth/popup-closed-by-user' });
  assert.equal(closedErr.severity, 'info');
  assert.equal(closedErr.retryable, true);

  const opErr = formatFirebaseAuthError({ code: 'auth/operation-not-allowed' });
  assert.equal(opErr.retryable, false);
  assert.match(opErr.message, /Continue with Google/i);
});

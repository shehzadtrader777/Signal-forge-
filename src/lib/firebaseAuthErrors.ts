export interface FormattedAuthError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly severity: 'error' | 'info';
}

export function extractFirebaseAuthCode(error: unknown): string {
  if (!error || typeof error !== 'object') {
    if (typeof error === 'string') {
      const match = error.match(/auth\/[a-z0-9-]+/i);
      return match ? match[0].toLowerCase() : '';
    }
    return '';
  }

  const record = error as { code?: unknown; message?: unknown };
  if (typeof record.code === 'string' && record.code.trim().length > 0) {
    return record.code.trim().toLowerCase();
  }
  if (typeof record.message === 'string') {
    const match = record.message.match(/auth\/[a-z0-9-]+/i);
    if (match) return match[0].toLowerCase();
  }
  return '';
}

export function isRetryableAuthNetworkError(error: unknown): boolean {
  return extractFirebaseAuthCode(error) === 'auth/network-request-failed';
}

export function formatFirebaseAuthError(error: unknown): FormattedAuthError {
  const code = extractFirebaseAuthCode(error);
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
      ? error
      : 'Authentication request failed.';

  switch (code) {
    case 'auth/network-request-failed':
      return {
        code,
        message:
          'Unable to reach Firebase Authentication right now (auth/network-request-failed). Check your internet connection, disable strict third-party iframe/ad blockers for firebaseapp.com, and try again.',
        retryable: true,
        severity: 'error',
      };
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return {
        code,
        message: 'Sign-in window was closed before completing authentication. Click Continue with Google to try again.',
        retryable: true,
        severity: 'info',
      };
    case 'auth/popup-blocked':
      return {
        code,
        message:
          'Your browser blocked the Google sign-in popup. Allow popups for this site and click Continue with Google again.',
        retryable: true,
        severity: 'error',
      };
    case 'auth/unauthorized-domain':
      return {
        code,
        message:
          'This preview domain is not yet authorized in Firebase Auth settings. Open the app from its authorized URL or add this host in Firebase Console → Authentication → Settings → Authorized domains.',
        retryable: false,
        severity: 'error',
      };
    case 'auth/operation-not-allowed':
      return {
        code,
        message:
          'Email/Password sign-in is not enabled in the Firebase Console for this project. Enable Email/Password under Authentication → Sign-in method, or use Continue with Google above.',
        retryable: false,
        severity: 'error',
      };
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return {
        code,
        message: 'Invalid email address or password. Please verify your credentials and try again.',
        retryable: false,
        severity: 'error',
      };
    case 'auth/too-many-requests':
      return {
        code,
        message: 'Too many authentication attempts. Wait a moment before trying again.',
        retryable: true,
        severity: 'error',
      };
    default:
      return {
        code: code || 'auth/unknown',
        message: rawMessage || 'Authentication failed. Please try again.',
        retryable: false,
        severity: 'error',
      };
  }
}

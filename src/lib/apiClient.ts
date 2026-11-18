import { getCurrentFirebaseIdToken } from './firebase';

let cachedSessionToken: string | null = null;
let cachedSessionExpiresAt = 0;
let inFlightSessionPromise: Promise<string | null> | null = null;

export function clearCachedOperatorSession(): void {
  cachedSessionToken = null;
  cachedSessionExpiresAt = 0;
}

export async function ensureOperatorSessionToken(forceRefresh = false): Promise<string | null> {
  const now = Date.now();
  if (!forceRefresh && cachedSessionToken && now + 15_000 < cachedSessionExpiresAt) {
    return cachedSessionToken;
  }
  if (!forceRefresh && inFlightSessionPromise) {
    return inFlightSessionPromise;
  }

  inFlightSessionPromise = (async () => {
    try {
      const res = await fetch('/api/auth/session', {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
        },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        token?: string;
        expiresAtMs?: number;
      };
      if (typeof data.token === 'string' && data.token.length > 0) {
        cachedSessionToken = data.token;
        cachedSessionExpiresAt =
          typeof data.expiresAtMs === 'number' && Number.isFinite(data.expiresAtMs)
            ? data.expiresAtMs
            : Date.now() + 10 * 60_000;
        return cachedSessionToken;
      }
      return null;
    } catch {
      return null;
    } finally {
      inFlightSessionPromise = null;
    }
  })();

  return inFlightSessionPromise;
}

/**
 * First-party authenticated API helper that attaches both the ephemeral
 * HMAC-signed operator session header (X-Signal-Session) and the authenticated
 * Firebase Auth ID token (X-Firebase-Id-Token) for server-side subscription gatekeeping.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const isMutating = method !== 'GET' && method !== 'HEAD';

  const makeHeaders = (sessionToken: string | null, firebaseIdToken: string | null): Headers => {
    const headers = new Headers(init.headers);
    if (sessionToken && !headers.has('X-Signal-Session')) {
      headers.set('X-Signal-Session', sessionToken);
    }
    if (firebaseIdToken && !headers.has('X-Firebase-Id-Token')) {
      headers.set('X-Firebase-Id-Token', firebaseIdToken);
    }
    if (isMutating && !headers.has('Content-Type') && typeof init.body === 'string') {
      headers.set('Content-Type', 'application/json');
    }
    return headers;
  };

  let [token, fbToken] = await Promise.all([
    ensureOperatorSessionToken(false),
    getCurrentFirebaseIdToken(false),
  ]);
  let res = await fetch(input, {
    ...init,
    credentials: 'same-origin',
    headers: makeHeaders(token, fbToken),
  });

  if (res.status === 401) {
    clearCachedOperatorSession();
    [token, fbToken] = await Promise.all([
      ensureOperatorSessionToken(true),
      getCurrentFirebaseIdToken(true),
    ]);
    if (token || fbToken) {
      res = await fetch(input, {
        ...init,
        credentials: 'same-origin',
        headers: makeHeaders(token, fbToken),
      });
    }
  }

  return res;
}

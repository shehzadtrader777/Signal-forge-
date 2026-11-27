let cachedSessionToken: string | null = null;
let cachedSessionExpiresAt = 0;
let operatorSessionDeniedUntil = 0;
let inFlightSessionPromise: Promise<string | null> | null = null;

async function getFirebaseIdTokenLazy(forceRefresh = false): Promise<string | null> {
  try {
    const firebaseMod = await import('./firebase');
    return await firebaseMod.getCurrentFirebaseIdToken(forceRefresh);
  } catch {
    return null;
  }
}

export function clearCachedOperatorSession(): void {
  cachedSessionToken = null;
  cachedSessionExpiresAt = 0;
  operatorSessionDeniedUntil = 0;
}

export async function ensureOperatorSessionToken(
  forceRefresh = false,
  preloadedFbToken?: string | null
): Promise<string | null> {
  const now = Date.now();
  if (!forceRefresh && cachedSessionToken && now + 15_000 < cachedSessionExpiresAt) {
    return cachedSessionToken;
  }
  if (!forceRefresh && now < operatorSessionDeniedUntil) {
    return null;
  }
  if (!forceRefresh && inFlightSessionPromise) {
    return inFlightSessionPromise;
  }

  const fbToken =
    preloadedFbToken !== undefined
      ? preloadedFbToken
      : await getFirebaseIdTokenLazy(forceRefresh);
  if (!fbToken) {
    return null;
  }

  inFlightSessionPromise = (async () => {
    try {
      const res = await fetch('/api/auth/session', {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'X-Firebase-Id-Token': fbToken,
        },
      });
      if (res.status === 403) {
        // Signed-in non-operator user: suppress redundant session requests briefly.
        operatorSessionDeniedUntil = Date.now() + 2 * 60_000;
        return null;
      }
      if (!res.ok) return null;
      const data = (await res.json()) as {
        token?: string;
        expiresAtMs?: number;
      };
      if (typeof data.token === 'string' && data.token.length > 0) {
        cachedSessionToken = data.token;
        operatorSessionDeniedUntil = 0;
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
 * Returns true only when the current user has a verified Firebase Auth ID token
 * that resolved to an active operator/admin session (prevents guest background 401 noise).
 */
export async function hasVerifiedOperatorSession(): Promise<boolean> {
  const token = await ensureOperatorSessionToken(false);
  return Boolean(token);
}

/**
 * First-party authenticated API helper that attaches both the verified Firebase
 * Auth ID token (X-Firebase-Id-Token) and, for authenticated ADMIN/SUPER_ADMIN
 * principals, the identity-bound HMAC operator session header (X-Signal-Session).
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
    if (isMutating && !headers.has('X-Requested-With')) {
      headers.set('X-Requested-With', 'XMLHttpRequest');
    }
    if (isMutating && !headers.has('Content-Type') && typeof init.body === 'string') {
      headers.set('Content-Type', 'application/json');
    }
    return headers;
  };

  let fbToken = await getFirebaseIdTokenLazy(false);
  let token = fbToken ? await ensureOperatorSessionToken(false, fbToken) : null;
  let res = await fetch(input, {
    ...init,
    credentials: 'same-origin',
    headers: makeHeaders(token, fbToken),
  });

  if (res.status === 401 && fbToken) {
    clearCachedOperatorSession();
    fbToken = await getFirebaseIdTokenLazy(true);
    token = fbToken ? await ensureOperatorSessionToken(true, fbToken) : null;
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

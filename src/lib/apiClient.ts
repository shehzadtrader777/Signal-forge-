let cachedSessionToken: string | null = null;
let cachedSessionExpiresAt = 0;
let operatorSessionDeniedUntil = 0;
let cachedFirebaseToken: string | null = null;
let generation = 0;
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
  generation += 1;
  cachedFirebaseToken = null;
  cachedSessionToken = null;
  cachedSessionExpiresAt = 0;
  operatorSessionDeniedUntil = 0;
  inFlightSessionPromise = null;
}

export async function ensureOperatorSessionToken(
  forceRefresh = false,
  preloadedFbToken?: string | null
): Promise<string | null> {
  const fbToken = preloadedFbToken !== undefined ? preloadedFbToken : await getFirebaseIdTokenLazy(forceRefresh);
  if (!fbToken) { clearCachedOperatorSession(); return null; }
  if (cachedFirebaseToken !== fbToken || forceRefresh) {
    clearCachedOperatorSession();
    cachedFirebaseToken = fbToken;
  }
  const now = Date.now();
  if (cachedSessionToken && now + 15_000 < cachedSessionExpiresAt) return cachedSessionToken;
  if (now < operatorSessionDeniedUntil) return null;
  if (inFlightSessionPromise) return inFlightSessionPromise;
  const requestGeneration = generation;
  const pending = (async () => {
    try {
      const res = await fetch('/api/auth/session', {
        method: 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: { Accept: 'application/json', 'X-Firebase-Id-Token': fbToken },
      });
      if (generation !== requestGeneration) return null;
      if (res.status === 403) { operatorSessionDeniedUntil = Date.now() + 120_000; return null; }
      if (!res.ok) return null;
      const data = (await res.json()) as { token?: string; expiresAtMs?: number };
      if (generation !== requestGeneration) return null;
      if (typeof data.token === 'string' && data.token.length > 0 &&
          typeof data.expiresAtMs === 'number' && Number.isFinite(data.expiresAtMs) && data.expiresAtMs > Date.now()) {
        cachedSessionToken = data.token;
        cachedSessionExpiresAt = data.expiresAtMs;
        operatorSessionDeniedUntil = 0;
        return cachedSessionToken;
      }
      return null;
    } catch {
      return null;
    }
  })();
  inFlightSessionPromise = pending;
  try { return await pending; }
  finally { if (inFlightSessionPromise === pending) inFlightSessionPromise = null; }
}

export async function hasVerifiedOperatorSession(): Promise<boolean> {
  return Boolean(await ensureOperatorSessionToken(false));
}

/** Never attach credentials to another origin, redirect, or non-API path. */
export function isFirstPartyApiPath(input: string): boolean {
  if (typeof input !== 'string' || !input.startsWith('/api/') || /[\\\u0000-\u0020]/.test(input)) return false;
  try {
    const url = new URL(input, 'https://signal-forge.invalid');
    return url.origin === 'https://signal-forge.invalid' && url.pathname.startsWith('/api/');
  } catch { return false; }
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (!isFirstPartyApiPath(input)) throw new Error('FIRST_PARTY_API_PATH_REQUIRED');
  const method = (init.method || 'GET').toUpperCase();
  const isMutating = method !== 'GET' && method !== 'HEAD';
  const makeHeaders = (sessionToken: string | null, firebaseIdToken: string | null): Headers => {
    const headers = new Headers(init.headers);
    headers.delete('X-Signal-Session');
    headers.delete('X-Firebase-Id-Token');
    headers.delete('Authorization');
    if (sessionToken) headers.set('X-Signal-Session', sessionToken);
    if (firebaseIdToken) headers.set('X-Firebase-Id-Token', firebaseIdToken);
    if (isMutating && !headers.has('X-Requested-With')) headers.set('X-Requested-With', 'XMLHttpRequest');
    if (isMutating && !headers.has('Content-Type') && typeof init.body === 'string') headers.set('Content-Type', 'application/json');
    return headers;
  };
  let fbToken = await getFirebaseIdTokenLazy(false);
  let token = await ensureOperatorSessionToken(false, fbToken);
  if (fbToken && fbToken !== await getFirebaseIdTokenLazy(false)) throw new Error('AUTH_IDENTITY_CHANGED');
  let res = await fetch(input, { ...init, credentials: fbToken ? 'same-origin' : 'omit', redirect: 'error', headers: makeHeaders(token, fbToken) });
  if (res.status === 401 && fbToken && !isMutating) {
    clearCachedOperatorSession();
    fbToken = await getFirebaseIdTokenLazy(true);
    token = await ensureOperatorSessionToken(true, fbToken);
    if (fbToken && fbToken === await getFirebaseIdTokenLazy(false)) {
      res = await fetch(input, { ...init, credentials: 'same-origin', redirect: 'error', headers: makeHeaders(token, fbToken) });
    }
  }
  return res;
}

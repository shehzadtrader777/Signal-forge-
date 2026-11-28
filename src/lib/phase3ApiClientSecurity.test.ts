import test from 'node:test';
import assert from 'node:assert/strict';
import { clearCachedOperatorSession, ensureOperatorSessionToken, isFirstPartyApiPath } from './apiClient';

test('authenticated browser API refuses external and traversal targets', () => {
  assert.equal(isFirstPartyApiPath('/api/vault/state'),true);
  assert.equal(isFirstPartyApiPath('/api/research?symbol=BTCUSDT'),true);
  for (const p of ['https://example.invalid/api/x','//example.invalid/api/x','/api/../outside','/api/%2e%2e/outside','/api/\\example.invalid','/api/\nfoo']) assert.equal(isFirstPartyApiPath(p),false);
});

test('stale session responses cannot repopulate cache after identity switch', async () => {
  const original = globalThis.fetch;
  clearCachedOperatorSession();
  let resolveOld!: (r: Response) => void;
  try {
    globalThis.fetch = async (_input, init) => {
      const identity = new Headers(init?.headers).get('X-Firebase-Id-Token');
      if (identity === 'fixture-old') return new Promise<Response>(r => { resolveOld = r; });
      return new Response(JSON.stringify({token:'fixture-session-new',expiresAtMs:Date.now()+60000}),{status:200});
    };
    const old = ensureOperatorSessionToken(false,'fixture-old');
    assert.equal(await ensureOperatorSessionToken(false,'fixture-new'),'fixture-session-new');
    resolveOld(new Response(JSON.stringify({token:'fixture-session-old',expiresAtMs:Date.now()+60000}),{status:200}));
    assert.equal(await old,null);
    assert.equal(await ensureOperatorSessionToken(false,'fixture-new'),'fixture-session-new');
    assert.equal(await ensureOperatorSessionToken(false,null),null);
  } finally { globalThis.fetch = original; clearCachedOperatorSession(); }
});

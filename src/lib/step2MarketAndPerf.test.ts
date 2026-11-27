import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CoinGeckoMarketClient,
  resolveCoinGeckoEnvConfig,
} from './coinGeckoClient';
import { SmartMarketDataRouter, type ExchangeFeedSnapshot } from './smartMarketDataRouter';
import { MultiAgentStateSyncEngine } from './agentSyncEngine';

function mockJsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

test('CoinGecko env config cleanly distinguishes Demo vs Pro endpoints and auth headers without leaking secrets', () => {
  const demo = resolveCoinGeckoEnvConfig({
    COINGECKO_API_KEY: 'CG-demo-secret-123',
    COINGECKO_API_TIER: 'demo',
  });
  assert.equal(demo.configured, true);
  assert.equal(demo.tier, 'demo');
  assert.equal(demo.baseUrl, 'https://api.coingecko.com/api/v3');
  assert.equal(demo.authHeaderName, 'x-cg-demo-api-key');

  const pro = resolveCoinGeckoEnvConfig({
    COINGECKO_API_KEY: 'CG-pro-secret-456',
    COINGECKO_API_TIER: 'pro',
  });
  assert.equal(pro.configured, true);
  assert.equal(pro.tier, 'pro');
  assert.equal(pro.baseUrl, 'https://pro-api.coingecko.com/api/v3');
  assert.equal(pro.authHeaderName, 'x-cg-pro-api-key');

  const missing = resolveCoinGeckoEnvConfig({});
  assert.equal(missing.configured, false);
  assert.equal(missing.tier, 'demo');
});

test('CoinGeckoMarketClient returns PENDING_CREDENTIALS when key is missing and never invents success', async () => {
  let fetchCalled = false;
  const client = new CoinGeckoMarketClient({
    apiKey: '',
    tier: 'demo',
    fetchImpl: async () => {
      fetchCalled = true;
      return mockJsonResponse({});
    },
  });

  const testRes = await client.testConnection();
  assert.equal(fetchCalled, false, 'Must not invoke upstream HTTP when API key is missing');
  assert.equal(testRes.ok, false);
  assert.equal(testRes.connectionStatus, 'PENDING_CREDENTIALS');
  assert.equal(testRes.dataQuality, 'UNAVAILABLE');

  const status = client.getSanitizedStatus();
  assert.equal(status.configured, false);
  assert.equal(status.connectionStatus, 'PENDING_CREDENTIALS');
  assert.equal(status.executableQuoteSupported, false);
  assert.equal(status.role, 'REFERENCE_AND_FALLBACK_ONLY');
});

test('CoinGeckoMarketClient validates Demo/Pro headers, schema, caching, coalescing, 429 backoff, and redacts secrets', async () => {
  const secretKey = 'CG-ultra-secret-token-999';
  let now = 1_750_000_000_000;
  let calls = 0;
  const seenHeaders: Record<string, string>[] = [];
  const seenUrls: string[] = [];

  const client = new CoinGeckoMarketClient({
    apiKey: secretKey,
    tier: 'pro',
    nowFn: () => now,
    cacheTtlMs: 30_000,
    fetchImpl: async (input, init) => {
      calls += 1;
      seenUrls.push(String(input));
      seenHeaders.push((init?.headers as Record<string, string>) || {});
      if (String(input).endsWith('/ping')) {
        return mockJsonResponse({ gecko_says: '(V3) To the Moon!' }, 200);
      }
      return mockJsonResponse(
        {
          bitcoin: {
            usd: 94250.5,
            usd_24h_change: 2.34,
            usd_24h_vol: 34_000_000_000,
            usd_market_cap: 1_860_000_000_000,
            last_updated_at: Math.floor(now / 1000) - 10,
          },
        },
        200
      );
    },
  });

  const probe = await client.testConnection();
  assert.equal(probe.ok, true);
  assert.equal(probe.connectionStatus, 'VERIFIED_LIVE');
  assert.equal(probe.sampleQuote?.priceUsd, 94250.5);
  assert.equal(probe.sampleQuote?.executableQuote, false);
  assert.equal(seenUrls[0], 'https://pro-api.coingecko.com/api/v3/ping');
  assert.equal(seenHeaders[0]['x-cg-pro-api-key'], secretKey);
  assert.equal(calls, 2);

  // Sanitized status must NEVER contain any secret key material
  const statusJson = JSON.stringify(client.getSanitizedStatus());
  assert.equal(statusJson.includes(secretKey), false, 'Sanitized status must never leak API key');

  // Cached hit within TTL must not call upstream
  const cachedRes = await client.fetchReferenceQuotes(['BTCUSDT']);
  assert.equal(calls, 2);
  assert.equal(cachedRes.BTCUSDT.priceUsd, 94250.5);
  assert.equal(cachedRes.BTCUSDT.dataQuality, 'CACHED');

  // Rate limit 429 triggers exponential backoff and redacts errors
  const rlClient = new CoinGeckoMarketClient({
    apiKey: secretKey,
    tier: 'demo',
    nowFn: () => now,
    fetchImpl: async () => mockJsonResponse({ error: 'rate limit' }, 429, { 'Retry-After': '15' }),
  });
  const rlProbe = await rlClient.testConnection();
  assert.equal(rlProbe.ok, false);
  assert.equal(rlProbe.connectionStatus, 'RATE_LIMITED');
  assert.equal(rlClient.isBackoffActive(), true);
  assert.equal(JSON.stringify(rlClient.getSanitizedStatus()).includes(secretKey), false);
});

test('SmartMarketDataRouter prefers live Binance exchange quotes, never treats CoinGecko as executable, coalesces concurrent requests, and emits DATA_UNAVAILABLE when all providers fail', async () => {
  let now = 1_750_000_100_000;
  let currentExchange: ExchangeFeedSnapshot | null = {
    symbol: 'BTCUSDT',
    price: 95120.25,
    change24hPercent: 1.85,
    volume24hUsd: 2_500_000_000,
    bidPrice: 95119.5,
    askPrice: 95121.0,
    updatedAtMs: now - 2_000,
    source: 'binance_ws',
  };

  let cgCalls = 0;
  const cgClient = new CoinGeckoMarketClient({
    apiKey: 'CG-test-key',
    tier: 'demo',
    nowFn: () => now,
    fetchImpl: async () => {
      cgCalls += 1;
      await new Promise((r) => setTimeout(r, 15));
      return mockJsonResponse({
        bitcoin: {
          usd: 95080.0,
          usd_24h_change: 1.72,
          usd_24h_vol: 31_000_000_000,
          last_updated_at: Math.floor(now / 1000) - 20,
        },
      });
    },
  });

  const router = new SmartMarketDataRouter({
    coinGeckoClient: cgClient,
    getExchangeFeed: (sym) => (sym === 'BTCUSDT' ? currentExchange : null),
    nowFn: () => now,
    maxExecutableAgeMs: 30_000,
    maxCachedExchangeAgeMs: 120_000,
    routeCacheTtlMs: 2_000,
  });

  // 1. Fresh live Binance WS quote -> LIVE_EXCHANGE & executableQuote=true & executionAllowed=true
  const liveQuote = await router.getQuote('BTCUSDT');
  assert.equal(liveQuote.provider, 'binance_spot_ws');
  assert.equal(liveQuote.dataQuality, 'LIVE');
  assert.equal(liveQuote.provenance, 'LIVE_EXCHANGE');
  assert.equal(liveQuote.executableQuote, true);
  assert.equal(liveQuote.executionAllowed, true);
  assert.equal(cgCalls, 0);

  // 2. Cache hit within routeCacheTtlMs
  const cachedHit = await router.getQuote('BTCUSDT');
  assert.equal(cachedHit.cachedHit, true);

  // 3. Stale exchange feed (past maxExecutableAgeMs, within maxCachedExchangeAgeMs) -> CACHED_EXCHANGE, execution BLOCKED
  now += 45_000;
  const cachedExchange = await router.getQuote('BTCUSDT', { bypassCache: true });
  assert.equal(cachedExchange.provenance, 'CACHED_EXCHANGE');
  assert.equal(cachedExchange.dataQuality, 'CACHED');
  assert.equal(cachedExchange.executableQuote, false);
  assert.equal(cachedExchange.executionAllowed, false);

  // 4. Binance unavailable -> falls back to CoinGecko reference aggregated (NEVER executable!) with in-flight coalescing
  currentExchange = null;
  now += 5_000;
  router.invalidateCache('BTCUSDT');
  const [q1, q2] = await Promise.all([router.getQuote('BTCUSDT'), router.getQuote('BTCUSDT')]);
  assert.equal(cgCalls, 1, 'Concurrent identical requests must coalesce into 1 upstream fetch');
  assert.equal(q1.provider, 'coingecko');
  assert.equal(q1.provenance, 'REFERENCE_AGGREGATED');
  assert.equal(q1.executableQuote, false, 'CoinGecko aggregated price must NEVER be treated as executable quote');
  assert.equal(q1.executionAllowed, false);
  assert.equal(q2.price, 95080.0);

  // 5. All providers unavailable -> DATA_UNAVAILABLE, price=null, executionAllowed=false (never fabricates price)
  const offlineCg = new CoinGeckoMarketClient({ apiKey: '', tier: 'demo', nowFn: () => now });
  const offlineRouter = new SmartMarketDataRouter({
    coinGeckoClient: offlineCg,
    getExchangeFeed: () => null,
    getCmcReference: () => null,
    nowFn: () => now,
  });
  const unavail = await offlineRouter.getQuote('BTCUSDT');
  assert.equal(unavail.price, null);
  assert.equal(unavail.dataQuality, 'UNAVAILABLE');
  assert.equal(unavail.provenance, 'STALE_OR_UNAVAILABLE');
  assert.equal(unavail.fetchStatus, 'DATA_UNAVAILABLE');
  assert.equal(unavail.executableQuote, false);
  assert.equal(unavail.executionAllowed, false);
});

test('MultiAgentStateSyncEngine accurately separates LIVE_EXCHANGE from SIMULATED_FIXTURE, REFERENCE_AGGREGATED, and STALE_OR_UNAVAILABLE', () => {
  const engine = new MultiAgentStateSyncEngine(5.0);

  // Cold unseeded engine must NOT falsely report SYNCHRONIZED
  const initial = engine.getSnapshot();
  assert.equal(initial.liveDataSynchronized, false);
  assert.equal(initial.allAgentsLocked, false);
  assert.equal(initial.executionAllowed, false);
  assert.equal(initial.dataProvenance, 'STALE_OR_UNAVAILABLE');
  assert.equal(initial.agents[0].status, 'EXECUTION_PAUSED_STALE');

  // Simulated fixture feed -> DEGRADED_FALLBACK, never live SYNCHRONIZED
  const simSnap = engine.process({
    symbol: 'BTCUSDT',
    authoritativePrice: 91420,
    epoch: 1,
    dataProvenance: 'SIMULATED_FIXTURE',
    dataQuality: 'SIMULATED',
    providerName: 'deterministic_fixture',
    executionAllowed: false,
  });
  assert.equal(simSnap.liveDataSynchronized, false);
  assert.equal(simSnap.allAgentsLocked, false);
  assert.equal(simSnap.synchronizedAgents, 0);
  assert.equal(simSnap.agents[0].status, 'DEGRADED_FALLBACK');
  assert.equal(simSnap.agents[0].dataProvenance, 'SIMULATED_FIXTURE');

  // CoinGecko reference aggregated -> DEGRADED_FALLBACK, executionAllowed=false
  const cgSnap = engine.process({
    symbol: 'BTCUSDT',
    authoritativePrice: 94100,
    epoch: 2,
    dataProvenance: 'REFERENCE_AGGREGATED',
    dataQuality: 'DELAYED',
    providerName: 'coingecko',
    executionAllowed: true, // Engine must still enforce executionAllowed=false on non-LIVE_EXCHANGE!
  });
  assert.equal(cgSnap.executionAllowed, false);
  assert.equal(cgSnap.liveDataSynchronized, false);
  assert.equal(cgSnap.agents[0].status, 'DEGRADED_FALLBACK');

  // Live verified exchange feed -> SYNCHRONIZED & executionAllowed=true
  const liveSnap = engine.process({
    symbol: 'BTCUSDT',
    authoritativePrice: 94150,
    epoch: 3,
    dataProvenance: 'LIVE_EXCHANGE',
    dataQuality: 'LIVE',
    providerName: 'binance_spot_ws',
    dataAgeMs: 420,
    executionAllowed: true,
  });
  assert.equal(liveSnap.liveDataSynchronized, true);
  assert.equal(liveSnap.allAgentsLocked, true);
  assert.equal(liveSnap.synchronizedAgents, 7);
  assert.equal(liveSnap.executionAllowed, true);
  assert.equal(liveSnap.agents[0].status, 'SYNCHRONIZED');
  assert.equal(liveSnap.agents[0].dataProvenance, 'LIVE_EXCHANGE');
});

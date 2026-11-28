/**
 * Signal Forge staging-only read-only load probe.
 * Run: SF_ALLOW_STAGING_LOAD_TEST=YES SF_STAGING_URL=https://staging.example ...
 * Never runs without explicit opt-in. No trade/account mutation endpoints.
 */
const enabled = process.env.SF_ALLOW_STAGING_LOAD_TEST === 'YES';
const rawUrl = process.env.SF_STAGING_URL;
if (!enabled || !rawUrl) {
  console.error('Refusing load probe: set SF_ALLOW_STAGING_LOAD_TEST=YES and SF_STAGING_URL');
  process.exit(2);
}
const base = new URL(rawUrl);
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
  throw new Error('Invalid staging URL');
}
const count = Math.max(1, Math.min(500, Number.parseInt(process.env.SF_LOAD_REQUESTS || '100', 10) || 100));
const concurrency = Math.max(1, Math.min(25, Number.parseInt(process.env.SF_LOAD_CONCURRENCY || '10', 10) || 10));
const paths = ['/api/health', '/api/monitor/health'];
const results = [];
let cursor = 0;
let errors = 0;

async function worker() {
  while (cursor < count) {
    const index = cursor++;
    const path = paths[index % paths.length];
    const started = performance.now();
    try {
      const response = await fetch(new URL(path, base), {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: { Accept: 'application/json' },
      });
      const payload = await response.text();
      if (!response.ok || payload.length > 300_000) errors++;
      results.push(performance.now() - started);
    } catch {
      errors++;
      results.push(performance.now() - started);
    }
  }
}
const began = performance.now();
await Promise.all(Array.from({length:concurrency},() => worker()));
const sorted=results.sort((a,b)=>a-b);
const percentile=p=>sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)] ?? 0;
const errorPct = Number((100*errors/count).toFixed(2));
const report = {
  target:base.origin,
  totalRequests:count,
  concurrency,
  elapsedMs:Number((performance.now()-began).toFixed(1)),
  avgMs:Number((sorted.reduce((a,b)=>a+b,0)/sorted.length).toFixed(1)),
  p95Ms:Number(percentile(.95).toFixed(1)),
  p99Ms:Number(percentile(.99).toFixed(1)),
  errorPct,
  scope:'GET /api/health and /api/monitor/health only; NOT a production capacity certification',
};
console.log(JSON.stringify(report,null,2));
if(errorPct>1 || report.p95Ms>2000)process.exitCode=1;

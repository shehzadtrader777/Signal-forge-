/**
 * Atomic Token Bucket Rate Limiter (matching Signal Forge Roadmap: 200 RPM, 50 Burst).
 * Uses continuous monotonic refill (`tokens = min(burst, tokens + elapsedSec * ratePerSec)`)
 * with per-identity isolation and automatic stale-bucket eviction.
 */

export interface TokenBucketConfig {
  readonly rpm: number;
  readonly burst: number;
  readonly ttlMs?: number;
  readonly maxBuckets?: number;
}

export interface TokenBucketCheckResult {
  readonly allowed: boolean;
  readonly remainingTokens: number;
  readonly limitBurst: number;
  readonly limitRpm: number;
  readonly retryAfterSec: number;
}

export interface TokenBucketTelemetry {
  readonly rpm: number;
  readonly burst: number;
  readonly activeIdentities: number;
  readonly totalAllowed: number;
  readonly totalRejected: number;
}

interface BucketState {
  tokens: number;
  lastRefillMs: number;
  lastSeenMs: number;
}

export const DEFAULT_TOKEN_BUCKET_RPM = 200;
export const DEFAULT_TOKEN_BUCKET_BURST = 50;

export class TokenBucketLimiter {
  private readonly rpm: number;
  private readonly ratePerSec: number;
  private readonly burst: number;
  private readonly ttlMs: number;
  private readonly maxBuckets: number;
  private readonly buckets = new Map<string, BucketState>();
  private totalAllowed = 0;
  private totalRejected = 0;

  constructor(config: Partial<TokenBucketConfig> = {}) {
    const rawRpm = Number(config.rpm);
    const rawBurst = Number(config.burst);
    this.rpm = Number.isFinite(rawRpm) && rawRpm > 0 ? Math.min(10_000, Math.floor(rawRpm)) : DEFAULT_TOKEN_BUCKET_RPM;
    this.burst = Number.isFinite(rawBurst) && rawBurst > 0 ? Math.min(2_000, Math.floor(rawBurst)) : DEFAULT_TOKEN_BUCKET_BURST;
    this.ratePerSec = this.rpm / 60;
    this.ttlMs = Math.max(10_000, Number(config.ttlMs) || 120_000);
    this.maxBuckets = Math.max(100, Number(config.maxBuckets) || 5_000);
  }

  private pruneExpired(nowMs: number): void {
    if (this.buckets.size <= this.maxBuckets) return;
    for (const [key, state] of this.buckets.entries()) {
      if (nowMs - state.lastSeenMs >= this.ttlMs) {
        this.buckets.delete(key);
      }
    }
    if (this.buckets.size > this.maxBuckets) {
      const oldestKey = this.buckets.keys().next().value;
      if (oldestKey !== undefined) {
        this.buckets.delete(oldestKey);
      }
    }
  }

  consume(identity: string, cost = 1, nowMs = Date.now()): TokenBucketCheckResult {
    const normalizedId = identity.trim() || 'anon';
    const tokenCost = Math.max(1, Number.isFinite(cost) ? cost : 1);
    this.pruneExpired(nowMs);

    const existing = this.buckets.get(normalizedId);
    let tokens = existing ? existing.tokens : this.burst;
    const lastRefillMs = existing ? existing.lastRefillMs : nowMs;
    const elapsedSec = Math.max(0, (nowMs - lastRefillMs) / 1000);
    const refilled = Math.min(this.burst, tokens + elapsedSec * this.ratePerSec);

    if (refilled < tokenCost) {
      this.totalRejected += 1;
      const deficit = tokenCost - refilled;
      const retryAfterSec = Math.max(1, Math.ceil(deficit / this.ratePerSec));
      this.buckets.set(normalizedId, {
        tokens: refilled,
        lastRefillMs: nowMs,
        lastSeenMs: nowMs,
      });
      return {
        allowed: false,
        remainingTokens: Math.floor(refilled),
        limitBurst: this.burst,
        limitRpm: this.rpm,
        retryAfterSec,
      };
    }

    const nextTokens = refilled - tokenCost;
    this.totalAllowed += 1;
    this.buckets.set(normalizedId, {
      tokens: nextTokens,
      lastRefillMs: nowMs,
      lastSeenMs: nowMs,
    });

    return {
      allowed: true,
      remainingTokens: Math.floor(nextTokens),
      limitBurst: this.burst,
      limitRpm: this.rpm,
      retryAfterSec: 0,
    };
  }

  getTelemetry(): TokenBucketTelemetry {
    return {
      rpm: this.rpm,
      burst: this.burst,
      activeIdentities: this.buckets.size,
      totalAllowed: this.totalAllowed,
      totalRejected: this.totalRejected,
    };
  }
}

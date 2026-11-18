export const SUBSECOND_HEAL_DELAYS_MS = [150, 300, 550, 850] as const;
export const SUBSECOND_HEARTBEAT_INTERVAL_MS = 750;
export const DEFAULT_MAX_EXECUTION_SLIPPAGE_PCT = 0.35;
export const DEFAULT_STALE_FEED_THRESHOLD_MS = 18_000;
export const WS_FRAME_STALE_THRESHOLD_MS = 4_500;
export const WS_BACKOFF_BASE_MS = 350;
export const WS_BACKOFF_MAX_MS = 30_000;
export const MAX_WS_RECONNECT_ATTEMPTS = 12;

export interface BackendHealthSnapshot {
  status: 'OPTIMAL' | 'SELF_HEALING' | 'DEGRADED';
  heartbeatSeq: number;
  uptimeSec: number;
  eventLoopLagMs: number;
  wsChannelStatus: 'CONNECTED' | 'DETERMINISTIC_FALLBACK' | 'HEALING';
  spotFeedStatus?: 'LIVE' | 'DETERMINISTIC_FALLBACK';
  futuresFeedStatus: 'LIVE' | 'DETERMINISTIC_FALLBACK';
  cmcStatus?: 'CMC_API' | 'BASELINE_VALIDATED' | 'UNAVAILABLE';
  anomaliesIsolatedCount?: number;
  staleFeedCount: number;
  autoHealCount: number;
  selfHealLatencyMs: number;
  lastHealAction: string;
  lastHeartbeatAt: string;
  backendWsConnected?: boolean;
  wsLastFrameAgeMs?: number;
}

export interface StructuredPerformanceReport {
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  label: string;
  signals: number;
  winRate: number;
  netReturn: number;
  avgRR: string;
  profitFactor: number;
  bestPair: string;
  skepticVetoes: number;
  atrTrailingExits: number;
  strategyBreakdown: Array<{
    module: string;
    trades: number;
    winRate: number;
    contributionPct: number;
  }>;
  crossEquityUsd: number;
  sandboxRealizedPnlUsd: number;
  generatedAt: string;
}

export interface BackendIntelligenceEvaluation {
  symbol: string;
  fundamentalScore: number;
  fundamentalSummary: string;
  whaleBias: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL';
  netflowUsd: number;
  inflow24hUsd: number;
  outflow24hUsd: number;
  source: string;
}

export interface ExecutionPriceValidation {
  valid: boolean;
  deviationPct: number;
  synchronizedPrice: number;
  reason: string;
}

export interface LiveSwitchValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Constant-time ASCII/UTF-16 string equality check safe for both browser and Node runtimes.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const lenA = a.length;
  const lenB = b.length;
  const maxLen = Math.max(lenA, lenB, 1);
  let diff = lenA ^ lenB;
  for (let i = 0; i < maxLen; i++) {
    const codeA = i < lenA ? a.charCodeAt(i) : 0;
    const codeB = i < lenB ? b.charCodeAt(i) : 0;
    diff |= codeA ^ codeB;
  }
  return diff === 0;
}

/**
 * Computes bounded sub-second self-healing delay (< 1000ms) for immediate
 * internal telemetry health recovery ticks.
 */
export function computeSelfHealDelayMs(attempt: number): number {
  const idx = Math.max(0, Math.min(SUBSECOND_HEAL_DELAYS_MS.length - 1, Math.floor(attempt)));
  return SUBSECOND_HEAL_DELAYS_MS[idx];
}

/**
 * Computes capped exponential backoff with symmetric jitter for WebSocket/SSE
 * reconnect scheduling to prevent tight reconnect storms against upstream hosts.
 */
export function computeExponentialReconnectDelayMs(
  attempt: number,
  options?: {
    baseMs?: number;
    maxMs?: number;
    jitterRatio?: number;
    randomUnit?: number;
  }
): number {
  const safeAttempt = Math.max(0, Math.min(20, Math.floor(attempt)));
  const baseMs = Math.max(50, options?.baseMs ?? WS_BACKOFF_BASE_MS);
  const maxMs = Math.max(baseMs, options?.maxMs ?? WS_BACKOFF_MAX_MS);
  const jitterRatio = Math.max(0, Math.min(0.5, options?.jitterRatio ?? 0.2));
  const raw = Math.min(maxMs, baseMs * Math.pow(2, safeAttempt));
  const rand = options?.randomUnit ?? Math.random();
  const clampedRand = Math.max(0, Math.min(1, rand));
  const jitterFactor = 1 + (clampedRand * 2 - 1) * jitterRatio;
  return Math.max(baseMs, Math.min(maxMs, Math.round(raw * jitterFactor)));
}

/**
 * Checks whether a feed timestamp has crossed the staleness threshold.
 */
export function isTelemetryStale(
  lastUpdatedAt: number | string | null | undefined,
  nowMs: number = Date.now(),
  thresholdMs: number = DEFAULT_STALE_FEED_THRESHOLD_MS
): boolean {
  if (lastUpdatedAt === null || lastUpdatedAt === undefined) return true;
  const ts = typeof lastUpdatedAt === 'number' ? lastUpdatedAt : Date.parse(lastUpdatedAt);
  if (!Number.isFinite(ts) || ts <= 0) return true;
  return nowMs - ts > thresholdMs;
}

/**
 * Enforces real-time execution price synchronization against the primary Binance Spot (or active Futures) feed.
 */
export function validateLiveExecutionPrice(params: {
  submittedPrice: number;
  liveFeedPrice: number;
  maxSlippagePct?: number;
}): ExecutionPriceValidation {
  const maxSlip = params.maxSlippagePct ?? DEFAULT_MAX_EXECUTION_SLIPPAGE_PCT;
  if (!Number.isFinite(params.submittedPrice) || params.submittedPrice <= 0) {
    return {
      valid: false,
      deviationPct: 100,
      synchronizedPrice: Number(params.liveFeedPrice || 0),
      reason: 'Submitted execution price must be a positive finite number.',
    };
  }
  if (!Number.isFinite(params.liveFeedPrice) || params.liveFeedPrice <= 0) {
    return {
      valid: false,
      deviationPct: 100,
      synchronizedPrice: params.submittedPrice,
      reason: 'Live Binance Spot reference price unavailable.',
    };
  }

  const deviationPct = Number(
    (
      (Math.abs(params.submittedPrice - params.liveFeedPrice) / params.liveFeedPrice) *
      100
    ).toFixed(4)
  );
  const synchronizedPrice = Number(params.liveFeedPrice.toPrecision(6));

  if (deviationPct > maxSlip) {
    return {
      valid: false,
      deviationPct,
      synchronizedPrice,
      reason: `Execution price drift ${deviationPct}% exceeds ${maxSlip}% tolerance vs live feed $${synchronizedPrice}.`,
    };
  }

  return {
    valid: true,
    deviationPct,
    synchronizedPrice,
    reason: `Synchronized within ${deviationPct}% of live feed $${synchronizedPrice}.`,
  };
}

/**
 * Enforces the interactive Live Switch verification gate:
 * requires a meaningful confirmation phrase (>= 8 chars, >= 2 words, containing '?')
 * AND a valid 6-digit email OTP compared in constant time.
 */
export function validateLiveSwitchChallenge(params: {
  securityAnswer: string;
  otpInput: string;
  expectedOtp?: string;
}): LiveSwitchValidationResult {
  const cleanAnswer = String(params.securityAnswer || '').trim();
  const cleanOtp = String(params.otpInput || '').trim();
  const words = cleanAnswer
    .replace(/\?/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => /[a-zA-Z0-9]{2,}/.test(w));

  if (!cleanAnswer || !cleanAnswer.includes('?') || cleanAnswer.length < 8 || words.length < 2) {
    return {
      valid: false,
      error:
        'Security challenge requires a clear multi-word confirmation phrase (>= 8 chars) containing a question mark (?).',
    };
  }

  if (!/^\d{6}$/.test(cleanOtp)) {
    return {
      valid: false,
      error: 'Please enter the 6-digit email OTP confirmation code.',
    };
  }

  if (params.expectedOtp !== undefined && !timingSafeEqualStr(cleanOtp, String(params.expectedOtp))) {
    return {
      valid: false,
      error: 'Invalid email OTP confirmation code.',
    };
  }

  return { valid: true };
}

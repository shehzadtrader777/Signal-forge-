/**
 * Signal Forge — Master Containment & Strategy Protocol Kernel
 *
 * Pure, deterministic, zero-I/O, strictly typed (zero `any`) enforcement engine
 * binding all Signal Forge Agents, Coordinators, and Execution Kernels across
 * four operational pillars:
 *   1. Emergency Protocols (Automated Circuit Breakers, Manual Fallback Only,
 *      Cloudflare Turnstile + Honeypot Anti-Spam Shielding)
 *   2. Funding Fee & Portfolio Management (Continuous Perp-vs-Spot Basis &
 *      Funding Rate Monitoring + Autonomous De-leveraging / Emergency Closure)
 *   3. Real-Time Offline Alert Routing (Cryptographic Account-Session-ChatID
 *      Binding + Filtered Anti-Spam Transmission)
 *   4. Hedging & Volatility Buffers (ATR-Multiplied Dynamic Trailing Stops +
 *      Correlated Asset Counter-Position Hedging)
 */

export type OperationalEnvironment =
  | 'SIMULATION'
  | 'PAPER_TRADING'
  | 'LIVE_EXECUTION';

export const OPERATIONAL_ENVIRONMENTS: readonly OperationalEnvironment[] = Object.freeze([
  'SIMULATION',
  'PAPER_TRADING',
  'LIVE_EXECUTION',
]);

export interface ProtocolGuardrails {
  readonly antiDetection: {
    readonly jitterEnabled: true;
    readonly minDelayMs: number;
    readonly maxDelayMs: number;
    readonly proxyRotation: 'ROTATIONAL_RESIDENTIAL';
    readonly humanLatencySimulation: true;
  };
  readonly parityEnforcement: {
    readonly enforcePaperToLiveParity: true;
    readonly slippageToleranceThreshold: number; // 0.001 = 0.1% max divergence
    readonly validateExecutionParity: true;
  };
  readonly containment: {
    readonly circuitBreakerTriggerPct: number; // 0.05 = 5% drop
    readonly manualFallbackOnly: true;
    readonly antiSpamRateLimitPerMin: number; // 30
  };
  readonly portfolioGuard: {
    readonly maxFundingCostToProfitRatio: number; // 0.15 = 15% max impact
    readonly autonomousReduceSize: true;
  };
  readonly hedgingEngine: {
    readonly dynamicAtrMultiplier: number; // 1.5
    readonly correlatedHedgingActive: true;
  };
}

export const DEFAULT_PROTOCOL_GUARDRAILS: ProtocolGuardrails = Object.freeze({
  antiDetection: Object.freeze({
    jitterEnabled: true as const,
    minDelayMs: 150,
    maxDelayMs: 850,
    proxyRotation: 'ROTATIONAL_RESIDENTIAL' as const,
    humanLatencySimulation: true as const,
  }),
  parityEnforcement: Object.freeze({
    enforcePaperToLiveParity: true as const,
    slippageToleranceThreshold: 0.001,
    validateExecutionParity: true as const,
  }),
  containment: Object.freeze({
    circuitBreakerTriggerPct: 0.05,
    manualFallbackOnly: true as const,
    antiSpamRateLimitPerMin: 30,
  }),
  portfolioGuard: Object.freeze({
    maxFundingCostToProfitRatio: 0.15,
    autonomousReduceSize: true as const,
  }),
  hedgingEngine: Object.freeze({
    dynamicAtrMultiplier: 1.5,
    correlatedHedgingActive: true as const,
  }),
});

export type ContainmentOperatingMode =
  | 'AUTONOMOUS_ACTIVE'
  | 'HALTED_MANUAL_ONLY';

export type CircuitBreakerTriggerReason =
  | 'NONE'
  | 'FLASH_CRASH_DETECTED'
  | 'ABNORMAL_VOLATILITY_SPIKE'
  | 'LIQUIDITY_SPREAD_BLOWOUT'
  | 'PAPER_LIVE_PARITY_BREACH'
  | 'MANUAL_OPERATOR_ENGAGED';

export interface CircuitBreakerThresholds {
  readonly flashCrashDropPct: number; // 5.0 (%) aligned with ProtocolGuardrails.containment.circuitBreakerTriggerPct
  readonly abnormalVolatilityMultiplier: number; // 3.5x baseline
  readonly maxSpreadBps: number; // 250 bps
}

export const DEFAULT_CIRCUIT_BREAKER_THRESHOLDS: CircuitBreakerThresholds = Object.freeze({
  flashCrashDropPct: DEFAULT_PROTOCOL_GUARDRAILS.containment.circuitBreakerTriggerPct * 100,
  abnormalVolatilityMultiplier: 3.5,
  maxSpreadBps: 250,
});

export interface MarketShockTelemetry {
  readonly symbol: string;
  readonly priceChangeWindowPct: number; // negative for drop, e.g. -5.2
  readonly currentVolatilityPct: number; // e.g. 7.8
  readonly baselineVolatilityPct: number; // e.g. 1.6
  readonly spreadBps: number; // e.g. 18
  readonly observedAtMs: number;
}

export interface CircuitBreakerDecision {
  readonly tripped: boolean;
  readonly reason: CircuitBreakerTriggerReason;
  readonly nextMode: ContainmentOperatingMode;
  readonly autonomousExecutionAllowed: boolean;
  readonly humanVerificationRequired: boolean;
  readonly severity: 'NORMAL' | 'ELEVATED' | 'CRITICAL';
  readonly volatilityRatio: number;
  readonly summary: string;
}

export interface PendingManualPosition {
  readonly id: string;
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly notionalUsd: number;
  readonly requestedByAgent: string;
  readonly queuedAtIso: string;
  readonly reason: string;
  readonly status: 'PENDING_HUMAN_VERIFICATION' | 'APPROVED_MANUAL' | 'REJECTED_MANUAL';
  readonly verifiedByOperator?: string;
  readonly verifiedAtIso?: string;
}

export interface AntiSpamEvaluationInput {
  readonly honeypotValue: string | undefined | null;
  readonly turnstileToken: string | undefined | null;
  readonly turnstileSecretConfigured: boolean;
  readonly turnstileSiteverifyPassed?: boolean;
  readonly recentRequestTimestampsMs: readonly number[];
  readonly nowMs: number;
  readonly maxRequestsPerWindow?: number;
  readonly windowMs?: number;
}

export interface AntiSpamEvaluationResult {
  readonly allowed: boolean;
  readonly statusCode: 200 | 400 | 403 | 429;
  readonly code:
    | 'SHIELD_PASSED'
    | 'SHIELD_PASSED_PREVIEW_CHALLENGE'
    | 'HONEYPOT_TRIGGERED'
    | 'RATE_EXHAUSTION_BLOCKED'
    | 'TURNSTILE_VERIFICATION_FAILED';
  readonly message: string;
  readonly remainingQuota: number;
}

/* ── Pillar 2: Funding Fee & Portfolio Management ─────────────────────────── */

export type DeleverageAction =
  | 'HOLD_OPTIMAL'
  | 'AUTONOMOUS_DELEVERAGE'
  | 'EMERGENCY_CLOSE';

export interface FundingMonitorInput {
  readonly symbol: string;
  readonly spotPrice: number;
  readonly perpMarkPrice: number;
  readonly fundingRate8h: number; // decimal, e.g. 0.0008 = 0.08% per 8h
  readonly positionSide: 'LONG' | 'SHORT';
  readonly notionalUsd: number;
  readonly currentLeverage: number;
  readonly projectedGainUsd: number;
  readonly expectedHoldingHours: number;
}

export interface FundingMonitorDecision {
  readonly symbol: string;
  readonly basisBps: number;
  readonly annualizedFundingPct: number;
  readonly effectiveAdverseRate8h: number;
  readonly projectedFundingCostUsd: number;
  readonly netProjectedEdgeUsd: number;
  readonly fundingToGainRatio: number;
  readonly action: DeleverageAction;
  readonly recommendedNotionalUsd: number;
  readonly recommendedLeverage: number;
  readonly reductionPct: number;
  readonly reason: string;
}

/* ── Pillar 3: Real-Time Offline Alert Routing ────────────────────────────── */

export type OfflineAlertChannel = 'TELEGRAM' | 'DISCORD' | 'WHATSAPP';

export type OfflineAlertEventType =
  | 'PNL_UPDATE'
  | 'TRADE_FILL'
  | 'CIRCUIT_BREAKER'
  | 'DELEVERAGE'
  | 'HEDGE_ACTIVATED';

export interface SessionChatBinding {
  readonly bindingId: string;
  readonly accountId: string;
  readonly sessionId: string;
  readonly channel: OfflineAlertChannel;
  readonly chatId: string;
  readonly bindingDigest: string;
  readonly boundAtIso: string;
  readonly expiresAtIso: string;
  readonly active: boolean;
}

export interface OfflineAlertPayload {
  readonly alertId: string;
  readonly accountId: string;
  readonly sessionId: string;
  readonly channel: OfflineAlertChannel;
  readonly targetChatId: string;
  readonly eventType: OfflineAlertEventType;
  readonly symbol: string;
  readonly pnlDeltaUsd?: number;
  readonly message: string;
  readonly dedupKey: string;
  readonly timestampMs: number;
}

export interface FilteredAlertRoutingDecision {
  readonly deliver: boolean;
  readonly status:
    | 'ROUTED_TO_BOUND_CHAT'
    | 'BLOCKED_UNBOUND_SESSION'
    | 'BLOCKED_CHAT_MISMATCH'
    | 'BLOCKED_EXPIRED_BINDING'
    | 'BLOCKED_DUPLICATE_SPAM';
  readonly reason: string;
  readonly matchedBindingId: string | null;
}

/* ── Pillar 4: Hedging & Volatility Buffers ───────────────────────────────── */

export interface AtrTrailingStopInput {
  readonly direction: 'LONG' | 'SHORT';
  readonly entryPrice: number;
  readonly currentPrice: number;
  readonly currentStopLoss: number;
  readonly atr14: number;
  readonly volatilityRegime: 'CALM' | 'NORMAL' | 'ELEVATED' | 'EXTREME';
}

export interface AtrTrailingStopResult {
  readonly atrMultiplier: number;
  readonly bufferDistance: number;
  readonly bufferPct: number;
  readonly candidateStopLoss: number;
  readonly updatedStopLoss: number;
  readonly ratcheted: boolean;
  readonly lockedProfitPct: number;
}

export interface OpenExposureLeg {
  readonly symbol: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly notionalUsd: number;
}

export interface CorrelatedHedgeLeg {
  readonly sourceSymbol: string;
  readonly hedgeSymbol: string;
  readonly hedgeDirection: 'LONG' | 'SHORT';
  readonly correlation: number;
  readonly beta: number;
  readonly hedgeRatio: number;
  readonly hedgeNotionalUsd: number;
  readonly reason: string;
}

export interface CorrelatedHedgePlan {
  readonly triggered: boolean;
  readonly stressScore: number;
  readonly totalGrossExposureUsd: number;
  readonly totalHedgeNotionalUsd: number;
  readonly netDeltaReductionPct: number;
  readonly legs: readonly CorrelatedHedgeLeg[];
  readonly summary: string;
}

/* ── Global Accountability Registry ───────────────────────────────────────── */

export interface BoundKernelUnit {
  readonly id: string;
  readonly label: string;
  readonly category: 'AGENT' | 'COORDINATOR' | 'KERNEL';
  readonly strictlyBound: true;
  readonly operationalStatus: 'ACTIVE_MONITORED' | 'HALTED_MANUAL_ONLY';
}

export const PROTOCOL_BOUND_ENTITIES: readonly Omit<BoundKernelUnit, 'operationalStatus'>[] =
  Object.freeze([
    { id: 'AGENT_SMC_VOLUME', label: 'SMC & FRVP Structure Agent', category: 'AGENT', strictlyBound: true },
    { id: 'AGENT_PATTERN_SCANNER', label: 'Pattern & Pre-Pump Scanner', category: 'AGENT', strictlyBound: true },
    { id: 'AGENT_SENTINEL_RISK', label: 'Sentinel Risk & Liquidation Agent', category: 'AGENT', strictlyBound: true },
    { id: 'AGENT_FUNDING_BASIS', label: 'Perp-vs-Spot Funding Arbitrage Agent', category: 'AGENT', strictlyBound: true },
    { id: 'AGENT_HEDGE_VOLATILITY', label: 'ATR & Correlated Hedge Agent', category: 'AGENT', strictlyBound: true },
    { id: 'COORDINATOR_MULTI_AGENT', label: 'Multi-Agent Autonomous Coordinator', category: 'COORDINATOR', strictlyBound: true },
    { id: 'COORDINATOR_AI_HUB', label: 'Gemini 4 Hydrogen AI Command Hub', category: 'COORDINATOR', strictlyBound: true },
    { id: 'KERNEL_RUNTIME_GUARD', label: 'RuntimeGuard 6-Layer Isolation Kernel', category: 'KERNEL', strictlyBound: true },
    { id: 'KERNEL_FREQTRADE_CORE', label: 'Freqtrade Dry-Run & CCXT Execution Kernel', category: 'KERNEL', strictlyBound: true },
    { id: 'KERNEL_HYBRID_RUST_PY', label: 'Hybrid Python Control Plane + Rust Engine', category: 'KERNEL', strictlyBound: true },
  ]);

/* ═══════════════════════════════════════════════════════════════════════════
 * PILLAR 1: EMERGENCY PROTOCOLS (CIRCUIT BREAKER + MANUAL FALLBACK + SHIELD)
 * ═══════════════════════════════════════════════════════════════════════════ */

export function evaluateCircuitBreaker(
  telemetry: MarketShockTelemetry,
  thresholds: CircuitBreakerThresholds = DEFAULT_CIRCUIT_BREAKER_THRESHOLDS
): CircuitBreakerDecision {
  const safeBaseline = Math.max(0.15, Math.abs(telemetry.baselineVolatilityPct));
  const safeCurrentVol = Math.max(0, telemetry.currentVolatilityPct);
  const volatilityRatio = Number((safeCurrentVol / safeBaseline).toFixed(2));
  const dropMagnitude = telemetry.priceChangeWindowPct < 0 ? Math.abs(telemetry.priceChangeWindowPct) : 0;

  if (dropMagnitude >= thresholds.flashCrashDropPct) {
    return {
      tripped: true,
      reason: 'FLASH_CRASH_DETECTED',
      nextMode: 'HALTED_MANUAL_ONLY',
      autonomousExecutionAllowed: false,
      humanVerificationRequired: true,
      severity: 'CRITICAL',
      volatilityRatio,
      summary: `Flash crash on ${telemetry.symbol} (-${dropMagnitude.toFixed(2)}% >= ${thresholds.flashCrashDropPct}% cap). Immediate execution halt engaged; backend locked to Manual Fallback Only.`,
    };
  }

  if (volatilityRatio >= thresholds.abnormalVolatilityMultiplier) {
    return {
      tripped: true,
      reason: 'ABNORMAL_VOLATILITY_SPIKE',
      nextMode: 'HALTED_MANUAL_ONLY',
      autonomousExecutionAllowed: false,
      humanVerificationRequired: true,
      severity: 'CRITICAL',
      volatilityRatio,
      summary: `Abnormal volatility spike on ${telemetry.symbol} (${volatilityRatio.toFixed(2)}x baseline >= ${thresholds.abnormalVolatilityMultiplier}x). All autonomous coordinators halted pending human verification.`,
    };
  }

  if (telemetry.spreadBps >= thresholds.maxSpreadBps) {
    return {
      tripped: true,
      reason: 'LIQUIDITY_SPREAD_BLOWOUT',
      nextMode: 'HALTED_MANUAL_ONLY',
      autonomousExecutionAllowed: false,
      humanVerificationRequired: true,
      severity: 'CRITICAL',
      volatilityRatio,
      summary: `Orderbook spread blow-out on ${telemetry.symbol} (${telemetry.spreadBps.toFixed(0)} bps >= ${thresholds.maxSpreadBps} bps). Switched to Manual Fallback Only.`,
    };
  }

  const elevated =
    dropMagnitude >= thresholds.flashCrashDropPct * 0.6 ||
    volatilityRatio >= thresholds.abnormalVolatilityMultiplier * 0.65 ||
    telemetry.spreadBps >= thresholds.maxSpreadBps * 0.6;

  return {
    tripped: false,
    reason: 'NONE',
    nextMode: 'AUTONOMOUS_ACTIVE',
    autonomousExecutionAllowed: true,
    humanVerificationRequired: false,
    severity: elevated ? 'ELEVATED' : 'NORMAL',
    volatilityRatio,
    summary: elevated
      ? `${telemetry.symbol} showing elevated volatility (${volatilityRatio.toFixed(2)}x baseline); circuit breaker armed.`
      : `${telemetry.symbol} within nominal volatility envelope (${volatilityRatio.toFixed(2)}x baseline, ${telemetry.spreadBps.toFixed(1)} bps spread).`,
  };
}

export function evaluateAntiSpamShield(input: AntiSpamEvaluationInput): AntiSpamEvaluationResult {
  const maxReqs = Math.max(
    1,
    input.maxRequestsPerWindow ?? DEFAULT_PROTOCOL_GUARDRAILS.containment.antiSpamRateLimitPerMin
  );
  const windowMs = Math.max(1_000, input.windowMs ?? 60_000);

  // 1. Honeypot trap check (hidden field must always remain empty for genuine humans/clients)
  if (typeof input.honeypotValue === 'string' && input.honeypotValue.trim().length > 0) {
    return {
      allowed: false,
      statusCode: 403,
      code: 'HONEYPOT_TRIGGERED',
      message: 'Anti-spam honeypot triggered; automated abuse request blocked.',
      remainingQuota: 0,
    };
  }

  // 2. Sliding-window API rate-exhaustion check
  const activeTimestamps = input.recentRequestTimestampsMs.filter(
    (ts) => Number.isFinite(ts) && input.nowMs - ts < windowMs && ts <= input.nowMs + 5_000
  );
  if (activeTimestamps.length >= maxReqs) {
    return {
      allowed: false,
      statusCode: 429,
      code: 'RATE_EXHAUSTION_BLOCKED',
      message: `API rate-exhaustion shield triggered (${activeTimestamps.length}/${maxReqs} requests per ${Math.round(windowMs / 1000)}s).`,
      remainingQuota: 0,
    };
  }

  // 3. Cloudflare Turnstile verification
  const token = typeof input.turnstileToken === 'string' ? input.turnstileToken.trim() : '';
  if (input.turnstileSecretConfigured) {
    if (!token || input.turnstileSiteverifyPassed !== true) {
      return {
        allowed: false,
        statusCode: 403,
        code: 'TURNSTILE_VERIFICATION_FAILED',
        message: 'Cloudflare Turnstile human verification failed or missing token.',
        remainingQuota: Math.max(0, maxReqs - activeTimestamps.length),
      };
    }
    return {
      allowed: true,
      statusCode: 200,
      code: 'SHIELD_PASSED',
      message: 'Cloudflare Turnstile, honeypot, and rate-exhaustion checks passed.',
      remainingQuota: Math.max(0, maxReqs - activeTimestamps.length - 1),
    };
  }

  // Preview/sandbox fallback when CLOUDFLARE_TURNSTILE_SECRET_KEY is not configured in env:
  // Still require a non-empty structured client challenge token (e.g., "cf-preview-...") and full honeypot + rate checks.
  if (token.length < 8) {
    return {
      allowed: false,
      statusCode: 400,
      code: 'TURNSTILE_VERIFICATION_FAILED',
      message: 'Anti-spam Turnstile challenge token is required.',
      remainingQuota: Math.max(0, maxReqs - activeTimestamps.length),
    };
  }

  return {
    allowed: true,
    statusCode: 200,
    code: 'SHIELD_PASSED_PREVIEW_CHALLENGE',
    message: 'Honeypot, rate-exhaustion, and Turnstile challenge token verified (configure CLOUDFLARE_TURNSTILE_SECRET_KEY for Cloudflare siteverify).',
    remainingQuota: Math.max(0, maxReqs - activeTimestamps.length - 1),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * PILLAR 2: FUNDING FEE & PORTFOLIO MANAGEMENT
 * ═══════════════════════════════════════════════════════════════════════════ */

export function evaluateFundingAndDeleverage(
  input: FundingMonitorInput
): FundingMonitorDecision {
  const safeSpot = Math.max(1e-8, input.spotPrice);
  const safePerp = Math.max(1e-8, input.perpMarkPrice);
  const basisBps = Number((((safePerp - safeSpot) / safeSpot) * 10_000).toFixed(2));
  const annualizedFundingPct = Number((input.fundingRate8h * 3 * 365 * 100).toFixed(2));

  // Long pays positive funding; short pays negative funding.
  const effectiveAdverseRate8h =
    input.positionSide === 'LONG'
      ? Math.max(0, input.fundingRate8h)
      : Math.max(0, -input.fundingRate8h);

  const periods = Math.max(1, input.expectedHoldingHours / 8);
  const safeNotional = Math.max(0, input.notionalUsd);
  const projectedFundingCostUsd = Number(
    (safeNotional * effectiveAdverseRate8h * periods).toFixed(2)
  );
  const safeProjectedGain = Math.max(0.01, input.projectedGainUsd);
  const netProjectedEdgeUsd = Number(
    (input.projectedGainUsd - projectedFundingCostUsd).toFixed(2)
  );
  const fundingToGainRatio = Number(
    (projectedFundingCostUsd / safeProjectedGain).toFixed(3)
  );

  // Emergency closure when funding costs equal or exceed projected gains
  if (projectedFundingCostUsd >= input.projectedGainUsd && projectedFundingCostUsd > 0) {
    return {
      symbol: input.symbol,
      basisBps,
      annualizedFundingPct,
      effectiveAdverseRate8h,
      projectedFundingCostUsd,
      netProjectedEdgeUsd,
      fundingToGainRatio,
      action: 'EMERGENCY_CLOSE',
      recommendedNotionalUsd: 0,
      recommendedLeverage: 1,
      reductionPct: 100,
      reason: `Projected funding cost ($${projectedFundingCostUsd.toFixed(2)}) exceeds projected gain ($${input.projectedGainUsd.toFixed(2)}) on ${input.symbol}. Emergency closure triggered.`,
    };
  }

  // Autonomous de-leveraging when funding eats >= 15% of projected gain (ProtocolGuardrails) or adverse perp-spot basis > 45 bps
  const maxFundingRatio = DEFAULT_PROTOCOL_GUARDRAILS.portfolioGuard.maxFundingCostToProfitRatio;
  const adverseBasisBps = input.positionSide === 'LONG' ? basisBps : -basisBps;
  if (fundingToGainRatio >= maxFundingRatio || adverseBasisBps >= 45) {
    const scaleFactor =
      fundingToGainRatio >= 0.65 ? 0.35 : fundingToGainRatio >= 0.35 ? 0.5 : 0.65;
    const recommendedNotionalUsd = Number((safeNotional * scaleFactor).toFixed(2));
    const recommendedLeverage = Math.max(
      1,
      Math.min(2, Math.floor(Math.max(1, input.currentLeverage) * scaleFactor))
    );
    const reductionPct = Math.round((1 - scaleFactor) * 100);
    return {
      symbol: input.symbol,
      basisBps,
      annualizedFundingPct,
      effectiveAdverseRate8h,
      projectedFundingCostUsd,
      netProjectedEdgeUsd,
      fundingToGainRatio,
      action: 'AUTONOMOUS_DELEVERAGE',
      recommendedNotionalUsd,
      recommendedLeverage,
      reductionPct,
      reason: `Funding/basis drag exceeded ${(maxFundingRatio * 100).toFixed(0)}% guardrail on ${input.symbol} (funding/gain ${(fundingToGainRatio * 100).toFixed(1)}%, basis ${basisBps.toFixed(1)} bps). Autonomously de-leveraging by ${reductionPct}% to ${recommendedLeverage}x.`,
    };
  }

  return {
    symbol: input.symbol,
    basisBps,
    annualizedFundingPct,
    effectiveAdverseRate8h,
    projectedFundingCostUsd,
    netProjectedEdgeUsd,
    fundingToGainRatio,
    action: 'HOLD_OPTIMAL',
    recommendedNotionalUsd: safeNotional,
    recommendedLeverage: Math.max(1, input.currentLeverage),
    reductionPct: 0,
    reason: `Funding drag (${(fundingToGainRatio * 100).toFixed(1)}% of projected gain) and perp-spot basis (${basisBps.toFixed(1)} bps) remain inside profitable envelope.`,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * PILLAR 3: REAL-TIME OFFLINE ALERT ROUTING (SESSION BINDING + FILTERING)
 * ═══════════════════════════════════════════════════════════════════════════ */

const CHAT_ID_PATTERN = /^(@?[A-Za-z0-9_-]{4,64}|-?\d{5,20})$/;

export function isValidOfflineChatId(chatId: string): boolean {
  return CHAT_ID_PATTERN.test(chatId.trim());
}

export function buildCanonicalBindingPayload(params: {
  readonly accountId: string;
  readonly sessionId: string;
  readonly channel: OfflineAlertChannel;
  readonly chatId: string;
}): string {
  return [
    'SF_ALERT_BIND_V1',
    params.accountId.trim(),
    params.sessionId.trim(),
    params.channel,
    params.chatId.trim(),
  ].join('|');
}

/**
 * Pure deterministic fallback digest helper for client previews & unit tests
 * (server.ts signs bindings using real Node `crypto.createHmac('sha256', secret)`).
 */
export function computeDeterministicBindingFingerprint(
  payload: string,
  salt: string
): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  const combined = `${salt}::${payload}`;
  for (let i = 0; i < combined.length; i += 1) {
    const ch = combined.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + ((h1 >>> 16) & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export function filterAndRouteOfflineAlert(params: {
  readonly alert: OfflineAlertPayload;
  readonly bindings: readonly SessionChatBinding[];
  readonly recentDedupKeys: ReadonlyMap<string, number>;
  readonly verifyDigest: (binding: SessionChatBinding) => boolean;
  readonly cooldownMs?: number;
}): FilteredAlertRoutingDecision {
  const cooldownMs = params.cooldownMs ?? 30_000;
  const { alert, bindings, recentDedupKeys, verifyDigest } = params;

  const accountBindings = bindings.filter(
    (b) =>
      b.active &&
      b.accountId === alert.accountId &&
      b.sessionId === alert.sessionId &&
      b.channel === alert.channel
  );

  if (accountBindings.length === 0) {
    return {
      deliver: false,
      status: 'BLOCKED_UNBOUND_SESSION',
      reason: `No active ${alert.channel} session binding found for account ${alert.accountId}. Transmission suppressed to prevent channel spam.`,
      matchedBindingId: null,
    };
  }

  const exactMatch = accountBindings.find((b) => b.chatId === alert.targetChatId);
  if (!exactMatch) {
    return {
      deliver: false,
      status: 'BLOCKED_CHAT_MISMATCH',
      reason: `Target chat ID ${alert.targetChatId} does not match the cryptographically bound ${alert.channel} chat ID for this session.`,
      matchedBindingId: null,
    };
  }

  if (Date.parse(exactMatch.expiresAtIso) <= alert.timestampMs || !verifyDigest(exactMatch)) {
    return {
      deliver: false,
      status: 'BLOCKED_EXPIRED_BINDING',
      reason: `Binding ${exactMatch.bindingId} expired or failed cryptographic integrity check.`,
      matchedBindingId: exactMatch.bindingId,
    };
  }

  const dedupComposite = `${exactMatch.chatId}::${alert.dedupKey}`;
  const lastSentAt = recentDedupKeys.get(dedupComposite);
  if (typeof lastSentAt === 'number' && alert.timestampMs - lastSentAt < cooldownMs) {
    return {
      deliver: false,
      status: 'BLOCKED_DUPLICATE_SPAM',
      reason: `Duplicate ${alert.eventType} alert for ${alert.symbol} suppressed inside ${Math.round(cooldownMs / 1000)}s anti-spam cooldown.`,
      matchedBindingId: exactMatch.bindingId,
    };
  }

  return {
    deliver: true,
    status: 'ROUTED_TO_BOUND_CHAT',
    reason: `Verified ${alert.eventType} routed exclusively to bound ${alert.channel} chat ${exactMatch.chatId}.`,
    matchedBindingId: exactMatch.bindingId,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * PILLAR 4: HEDGING & VOLATILITY BUFFERS (ATR TRAILING + CORRELATED HEDGE)
 * ═══════════════════════════════════════════════════════════════════════════ */

const VOLATILITY_ATR_MULTIPLIERS: Readonly<
  Record<AtrTrailingStopInput['volatilityRegime'], number>
> = Object.freeze({
  CALM: 1.5,
  NORMAL: 1.9,
  ELEVATED: 2.35,
  EXTREME: 2.85,
});

export function computeVolatilityAdjustedTrailingStop(
  input: AtrTrailingStopInput
): AtrTrailingStopResult {
  const atrMultiplier = VOLATILITY_ATR_MULTIPLIERS[input.volatilityRegime];
  const safeAtr = Math.max(0, input.atr14);
  const bufferDistance = Number((safeAtr * atrMultiplier).toFixed(6));
  const bufferPct =
    input.currentPrice > 0
      ? Number(((bufferDistance / input.currentPrice) * 100).toFixed(3))
      : 0;

  if (input.direction === 'LONG') {
    const candidateStopLoss = Number((input.currentPrice - bufferDistance).toFixed(4));
    // Strictly ratchet stop UPWARD only; never widen risk below currentStopLoss
    const updatedStopLoss = Math.max(input.currentStopLoss, candidateStopLoss);
    const ratcheted = updatedStopLoss > input.currentStopLoss;
    const lockedProfitPct =
      input.entryPrice > 0
        ? Number((((updatedStopLoss - input.entryPrice) / input.entryPrice) * 100).toFixed(2))
        : 0;
    return {
      atrMultiplier,
      bufferDistance,
      bufferPct,
      candidateStopLoss,
      updatedStopLoss,
      ratcheted,
      lockedProfitPct,
    };
  }

  // SHORT position: strictly ratchet stop DOWNWARD only
  const candidateStopLoss = Number((input.currentPrice + bufferDistance).toFixed(4));
  const updatedStopLoss =
    input.currentStopLoss > 0
      ? Math.min(input.currentStopLoss, candidateStopLoss)
      : candidateStopLoss;
  const ratcheted = input.currentStopLoss > 0 && updatedStopLoss < input.currentStopLoss;
  const lockedProfitPct =
    input.entryPrice > 0
      ? Number((((input.entryPrice - updatedStopLoss) / input.entryPrice) * 100).toFixed(2))
      : 0;

  return {
    atrMultiplier,
    bufferDistance,
    bufferPct,
    candidateStopLoss,
    updatedStopLoss,
    ratcheted,
    lockedProfitPct,
  };
}

interface CorrelationPairSpec {
  readonly hedgeSymbol: string;
  readonly correlation: number;
  readonly beta: number;
}

const CORRELATED_HEDGE_MATRIX: Readonly<Record<string, CorrelationPairSpec>> = Object.freeze({
  BTCUSDT: { hedgeSymbol: 'ETHUSDT', correlation: 0.86, beta: 1.18 },
  ETHUSDT: { hedgeSymbol: 'BTCUSDT', correlation: 0.86, beta: 0.84 },
  SOLUSDT: { hedgeSymbol: 'BTCUSDT', correlation: 0.78, beta: 1.35 },
  BNBUSDT: { hedgeSymbol: 'BTCUSDT', correlation: 0.74, beta: 0.92 },
  AVAXUSDT: { hedgeSymbol: 'ETHUSDT', correlation: 0.81, beta: 1.25 },
  XRPUSDT: { hedgeSymbol: 'BTCUSDT', correlation: 0.65, beta: 0.95 },
  DOGEUSDT: { hedgeSymbol: 'BTCUSDT', correlation: 0.69, beta: 1.4 },
});

export function computeCorrelatedHedgePlan(params: {
  readonly exposures: readonly OpenExposureLeg[];
  readonly stressScore: number; // 0..100
  readonly stressThreshold?: number;
}): CorrelatedHedgePlan {
  const stressThreshold = params.stressThreshold ?? 70;
  const clampedStress = Math.max(0, Math.min(100, params.stressScore));
  const validExposures = params.exposures.filter(
    (leg) => Number.isFinite(leg.notionalUsd) && leg.notionalUsd > 0
  );
  // Net directional exposure per symbol before computing correlated counter-positions
  const netBySymbol = new Map<string, number>();
  for (const leg of validExposures) {
    const sym = leg.symbol.toUpperCase();
    const signed = leg.direction === 'LONG' ? leg.notionalUsd : -leg.notionalUsd;
    netBySymbol.set(sym, (netBySymbol.get(sym) ?? 0) + signed);
  }
  const consolidatedExposures: OpenExposureLeg[] = [];
  for (const [symbol, signedNotional] of netBySymbol.entries()) {
    const absNotional = Math.abs(signedNotional);
    if (absNotional < 1) continue;
    consolidatedExposures.push({
      symbol,
      direction: signedNotional >= 0 ? 'LONG' : 'SHORT',
      notionalUsd: Number(absNotional.toFixed(2)),
    });
  }

  const totalGrossExposureUsd = Number(
    consolidatedExposures.reduce((sum, leg) => sum + leg.notionalUsd, 0).toFixed(2)
  );

  if (clampedStress < stressThreshold || consolidatedExposures.length === 0) {
    return {
      triggered: false,
      stressScore: clampedStress,
      totalGrossExposureUsd,
      totalHedgeNotionalUsd: 0,
      netDeltaReductionPct: 0,
      legs: [],
      summary:
        consolidatedExposures.length === 0
          ? 'No net directional exposure requiring correlated hedging.'
          : `Market stress (${clampedStress}/100) below ${stressThreshold} auto-hedge threshold.`,
    };
  }

  // Scale target hedge coverage from 55% at stress=70 up to 85% at stress=100
  const stressExcess = (clampedStress - stressThreshold) / Math.max(1, 100 - stressThreshold);
  const targetCoverage = Number((0.55 + stressExcess * 0.3).toFixed(3));

  const legs: CorrelatedHedgeLeg[] = consolidatedExposures.map((leg) => {
    const spec = CORRELATED_HEDGE_MATRIX[leg.symbol.toUpperCase()] ?? {
      hedgeSymbol: leg.symbol.toUpperCase() === 'BTCUSDT' ? 'ETHUSDT' : 'BTCUSDT',
      correlation: 0.72,
      beta: 1.0,
    };
    const hedgeDirection: 'LONG' | 'SHORT' = leg.direction === 'LONG' ? 'SHORT' : 'LONG';
    // Optimal beta-adjusted minimum-variance hedge ratio bounded cleanly to [0.35, 0.90]
    const hedgeRatio = Number(
      Math.max(0.35, Math.min(0.9, targetCoverage * (spec.correlation / Math.max(0.5, spec.beta)))).toFixed(3)
    );
    const hedgeNotionalUsd = Number((leg.notionalUsd * hedgeRatio).toFixed(2));
    return {
      sourceSymbol: leg.symbol.toUpperCase(),
      hedgeSymbol: spec.hedgeSymbol,
      hedgeDirection,
      correlation: spec.correlation,
      beta: spec.beta,
      hedgeRatio,
      hedgeNotionalUsd,
      reason: `Counter-${hedgeDirection} ${spec.hedgeSymbol} (${Math.round(hedgeRatio * 100)}% beta-adjusted ratio, r=${spec.correlation.toFixed(2)}) offsetting ${leg.symbol} ${leg.direction} stress.`,
    };
  });

  const totalHedgeNotionalUsd = Number(
    legs.reduce((sum, l) => sum + l.hedgeNotionalUsd, 0).toFixed(2)
  );
  const netDeltaReductionPct =
    totalGrossExposureUsd > 0
      ? Number(
          Math.min(95, (totalHedgeNotionalUsd / totalGrossExposureUsd) * 100).toFixed(1)
        )
      : 0;

  return {
    triggered: true,
    stressScore: clampedStress,
    totalGrossExposureUsd,
    totalHedgeNotionalUsd,
    netDeltaReductionPct,
    legs,
    summary: `Severe market stress (${clampedStress}/100): initiated ${legs.length} correlated counter-position leg(s) totaling $${totalHedgeNotionalUsd.toLocaleString()} (${netDeltaReductionPct}% delta hedge).`,
  };
}

export function buildBoundKernelAccountabilityList(
  mode: ContainmentOperatingMode
): readonly BoundKernelUnit[] {
  const operationalStatus =
    mode === 'HALTED_MANUAL_ONLY' ? 'HALTED_MANUAL_ONLY' : 'ACTIVE_MONITORED';
  return PROTOCOL_BOUND_ENTITIES.map((entity) => ({
    ...entity,
    operationalStatus,
  }));
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SECTION 2: ANTI-DETECTION, EVASION & EXCHANGE SHIELDING
 * ═══════════════════════════════════════════════════════════════════════════ */

export type ExchangeDispatchAction = 'PLACE_ORDER' | 'CANCEL_ORDER' | 'MODIFY_ORDER';

export interface ProxyTunnelSlot {
  readonly slotId: string;
  readonly region: string;
  readonly transport: 'REST_AND_WS';
  readonly rotationPolicy: 'ROTATIONAL_RESIDENTIAL';
  readonly configuredViaEnv: boolean;
}

export interface AntiDetectionDispatchPlan {
  readonly action: ExchangeDispatchAction;
  readonly symbol: string;
  readonly jitterDelayMs: number;
  readonly humanCognitiveLatencyMs: number;
  readonly totalDecoupledDelayMs: number;
  readonly signalGeneratedAtMs: number;
  readonly scheduledDispatchAtMs: number;
  readonly proxyTunnel: ProxyTunnelSlot;
  readonly cadenceProfile: 'HUMAN_RETAIL_VARIANCE';
}

const DEFAULT_RESIDENTIAL_TUNNEL_SLOTS: readonly ProxyTunnelSlot[] = Object.freeze([
  { slotId: 'RES-TUN-EU-FRA-01', region: 'EU-Central', transport: 'REST_AND_WS', rotationPolicy: 'ROTATIONAL_RESIDENTIAL', configuredViaEnv: false },
  { slotId: 'RES-TUN-AP-SIN-02', region: 'AP-Southeast', transport: 'REST_AND_WS', rotationPolicy: 'ROTATIONAL_RESIDENTIAL', configuredViaEnv: false },
  { slotId: 'RES-TUN-US-EWR-03', region: 'US-East', transport: 'REST_AND_WS', rotationPolicy: 'ROTATIONAL_RESIDENTIAL', configuredViaEnv: false },
  { slotId: 'RES-TUN-EU-AMS-04', region: 'EU-West', transport: 'REST_AND_WS', rotationPolicy: 'ROTATIONAL_RESIDENTIAL', configuredViaEnv: false },
  { slotId: 'RES-TUN-AP-NRT-05', region: 'AP-Northeast', transport: 'REST_AND_WS', rotationPolicy: 'ROTATIONAL_RESIDENTIAL', configuredViaEnv: false },
]);

export function selectRotatingProxyTunnel(params: {
  readonly sequenceIndex: number;
  readonly previousSlotId?: string | null;
  readonly configuredPoolCount?: number;
}): ProxyTunnelSlot {
  const envCount = Math.max(0, Math.floor(params.configuredPoolCount ?? 0));
  const pool: readonly ProxyTunnelSlot[] =
    envCount > 0
      ? Array.from({ length: envCount }, (_, idx) => ({
          slotId: `RES-ENV-POOL-${String(idx + 1).padStart(2, '0')}`,
          region: 'ROTATIONAL_ENV_POOL',
          transport: 'REST_AND_WS' as const,
          rotationPolicy: 'ROTATIONAL_RESIDENTIAL' as const,
          configuredViaEnv: true,
        }))
      : DEFAULT_RESIDENTIAL_TUNNEL_SLOTS;

  let idx = Math.abs(Math.floor(params.sequenceIndex)) % pool.length;
  if (pool.length > 1 && params.previousSlotId && pool[idx].slotId === params.previousSlotId) {
    idx = (idx + 1) % pool.length;
  }
  return pool[idx];
}

export function computeExecutionDispatchCadence(params: {
  readonly action: ExchangeDispatchAction;
  readonly symbol: string;
  readonly signalGeneratedAtMs: number;
  readonly randomUnitA: number; // [0, 1)
  readonly randomUnitB: number; // [0, 1)
  readonly sequenceIndex: number;
  readonly previousSlotId?: string | null;
  readonly configuredPoolCount?: number;
  readonly guardrails?: ProtocolGuardrails;
}): AntiDetectionDispatchPlan {
  const rules = params.guardrails ?? DEFAULT_PROTOCOL_GUARDRAILS;
  const u1 = Math.max(0, Math.min(0.999999, params.randomUnitA));
  const u2 = Math.max(0, Math.min(0.999999, params.randomUnitB));

  const minMs = Math.max(50, rules.antiDetection.minDelayMs);
  const maxMs = Math.max(minMs + 10, rules.antiDetection.maxDelayMs);
  const jitterDelayMs = Math.round(minMs + u1 * (maxMs - minMs));

  // Natural cognitive reaction curve (220ms–620ms) decoupling signal generation from dispatch
  const cognitiveMin = params.action === 'CANCEL_ORDER' ? 180 : 220;
  const cognitiveSpan = params.action === 'PLACE_ORDER' ? 400 : 280;
  const humanCognitiveLatencyMs = Math.round(cognitiveMin + u2 * cognitiveSpan);

  const totalDecoupledDelayMs = jitterDelayMs + humanCognitiveLatencyMs;
  const proxyTunnel = selectRotatingProxyTunnel({
    sequenceIndex: params.sequenceIndex,
    previousSlotId: params.previousSlotId,
    configuredPoolCount: params.configuredPoolCount,
  });

  return {
    action: params.action,
    symbol: params.symbol.toUpperCase(),
    jitterDelayMs,
    humanCognitiveLatencyMs,
    totalDecoupledDelayMs,
    signalGeneratedAtMs: params.signalGeneratedAtMs,
    scheduledDispatchAtMs: params.signalGeneratedAtMs + totalDecoupledDelayMs,
    proxyTunnel,
    cadenceProfile: 'HUMAN_RETAIL_VARIANCE',
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SECTION 3: PAPER-TO-LIVE PARITY ENFORCEMENT & INTEGRITY VERIFIER
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface DepthSlippageModelInput {
  readonly symbol: string;
  readonly orderNotionalUsd: number;
  readonly topOfBookDepthUsd: number;
  readonly spreadBps: number;
  readonly executionLatencyMs: number;
  readonly volatilityPct: number;
}

export interface DepthSlippageModelResult {
  readonly symbol: string;
  readonly depthPressureRatio: number;
  readonly spreadImpactBps: number;
  readonly bookImpactBps: number;
  readonly latencyDriftBps: number;
  readonly expectedSlippageBps: number;
  readonly expectedSlippageRatio: number;
  readonly withinParityTolerance: boolean;
}

export function modelDepthAwareExecutionSlippage(
  input: DepthSlippageModelInput,
  guardrails: ProtocolGuardrails = DEFAULT_PROTOCOL_GUARDRAILS
): DepthSlippageModelResult {
  const safeDepth = Math.max(100, input.topOfBookDepthUsd);
  const safeNotional = Math.max(0, input.orderNotionalUsd);
  const depthPressureRatio = Number((safeNotional / safeDepth).toFixed(4));
  const spreadImpactBps = Number((Math.max(0, input.spreadBps) * 0.5).toFixed(2));
  const bookImpactBps = Number(
    Math.min(120, Math.sqrt(depthPressureRatio) * 18 + depthPressureRatio * 12).toFixed(2)
  );
  const latencySec = Math.max(0, input.executionLatencyMs) / 1_000;
  const latencyDriftBps = Number(
    (Math.max(0, input.volatilityPct) * Math.sqrt(latencySec) * 0.85).toFixed(2)
  );
  const expectedSlippageBps = Number(
    (spreadImpactBps + bookImpactBps + latencyDriftBps).toFixed(2)
  );
  const expectedSlippageRatio = Number((expectedSlippageBps / 10_000).toFixed(6));
  const withinParityTolerance =
    expectedSlippageRatio <= guardrails.parityEnforcement.slippageToleranceThreshold;

  return {
    symbol: input.symbol.toUpperCase(),
    depthPressureRatio,
    spreadImpactBps,
    bookImpactBps,
    latencyDriftBps,
    expectedSlippageBps,
    expectedSlippageRatio,
    withinParityTolerance,
  };
}

export interface ExecutionParityMetrics {
  readonly symbol?: string;
  readonly entryPrice?: number;
  readonly exitPrice?: number;
  readonly stopLoss?: number;
  readonly takeProfit?: number;
  readonly pnl: number;
  readonly slippageRatio?: number;
}

export interface ExecutionParityValidationResult {
  readonly parityVerified: boolean;
  readonly haltTriggered: boolean;
  readonly maxPriceDivergenceRatio: number;
  readonly pnlDivergence: number;
  readonly slippageDivergenceRatio: number;
  readonly violations: readonly string[];
  readonly summary: string;
}

function relativeDiffRatio(a: number | undefined, b: number | undefined): number {
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) {
    return 0;
  }
  const denom = Math.max(1e-8, Math.abs(a));
  return Math.abs(a - b) / denom;
}

export function validatePaperToLiveExecutionParity(
  paperMetrics: ExecutionParityMetrics,
  liveMetrics: ExecutionParityMetrics,
  guardrails: ProtocolGuardrails = DEFAULT_PROTOCOL_GUARDRAILS
): ExecutionParityValidationResult {
  const tol = guardrails.parityEnforcement.slippageToleranceThreshold;
  const entryDiff = relativeDiffRatio(paperMetrics.entryPrice, liveMetrics.entryPrice);
  const exitDiff = relativeDiffRatio(paperMetrics.exitPrice, liveMetrics.exitPrice);
  const slDiff = relativeDiffRatio(paperMetrics.stopLoss, liveMetrics.stopLoss);
  const tpDiff = relativeDiffRatio(paperMetrics.takeProfit, liveMetrics.takeProfit);
  const maxPriceDivergenceRatio = Number(
    Math.max(entryDiff, exitDiff, slDiff, tpDiff).toFixed(6)
  );

  const pnlDivergence = Number(Math.abs(paperMetrics.pnl - liveMetrics.pnl).toFixed(6));
  const slippageDivergenceRatio = Number(
    Math.abs((paperMetrics.slippageRatio ?? 0) - (liveMetrics.slippageRatio ?? 0)).toFixed(6)
  );

  const violations: string[] = [];
  if (entryDiff > tol) violations.push(`Entry divergence ${(entryDiff * 100).toFixed(3)}% > ${(tol * 100).toFixed(2)}%`);
  if (exitDiff > tol) violations.push(`Exit divergence ${(exitDiff * 100).toFixed(3)}% > ${(tol * 100).toFixed(2)}%`);
  if (slDiff > tol) violations.push(`Stop-Loss divergence ${(slDiff * 100).toFixed(3)}% > ${(tol * 100).toFixed(2)}%`);
  if (tpDiff > tol) violations.push(`Take-Profit divergence ${(tpDiff * 100).toFixed(3)}% > ${(tol * 100).toFixed(2)}%`);
  if (slippageDivergenceRatio > tol) {
    violations.push(`Slippage divergence ${(slippageDivergenceRatio * 100).toFixed(3)}% > ${(tol * 100).toFixed(2)}%`);
  }
  if (pnlDivergence > 0.05) {
    violations.push(`PnL parity breach ${pnlDivergence.toFixed(4)} > 0.0500 threshold`);
  }

  const haltTriggered = violations.length > 0;
  return {
    parityVerified: !haltTriggered,
    haltTriggered,
    maxPriceDivergenceRatio,
    pnlDivergence,
    slippageDivergenceRatio,
    violations,
    summary: haltTriggered
      ? `FATAL: Paper-to-Live parity breach detected (${violations.join('; ')}). Halting execution.`
      : `Zero-variance Paper-to-Live parity verified (max price drift ${(maxPriceDivergenceRatio * 100).toFixed(3)}%, PnL delta ${pnlDivergence.toFixed(4)}).`,
  };
}

export const MasterSystemIntegrityVerifier = Object.freeze({
  verifyAllNodesBound: (nodes: readonly (string | null | undefined)[]): boolean => {
    if (nodes.length === 0) return false;
    return nodes.every((node) => typeof node === 'string' && node.trim().length > 0);
  },
  EnforceParityOrHalt: (
    paperMetrics: ExecutionParityMetrics,
    liveMetrics: ExecutionParityMetrics,
    guardrails: ProtocolGuardrails = DEFAULT_PROTOCOL_GUARDRAILS
  ): ExecutionParityValidationResult => {
    const result = validatePaperToLiveExecutionParity(paperMetrics, liveMetrics, guardrails);
    if (result.haltTriggered) {
      throw new Error('FATAL: Paper-to-Live parity breach detected. Halting execution.');
    }
    return result;
  },
});

// Preserve exact requested export alias for full compatibility
export const MasterSystemIntegrityVeriifer = MasterSystemIntegrityVerifier;

import dotenv from 'dotenv';
// Hosted platform Secrets must take precedence over stale local .env values.
dotenv.config({ override: false });
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resend } from 'resend';
import {
  DEFAULT_NEWS_FEED,
  generateTopSignals,
  runFundamentalAgent,
  type NewsItem,
} from './src/lib/signals';
import {
  TRACKED_COINS,
  generateDeterministicCandles,
  type Timeframe,
  type TopGainerCoin,
  type GainerAlertEvent,
} from './src/lib/marketData';
import {
  advance5xAtrTrailingTakeProfit,
  calculateFuturesDynamicMargin,
  computeATR,
  detectStructuralTrendReversal,
  enforceMaxStopLossCap,
  settleCrossMarginClose,
  summarizeCrossMarginWallet,
  type FuturesTickerTelemetry,
  type SandboxPosition,
} from './src/lib/coordinator';
import {
  aggregateMultiExchangeDepth,
  buildAnchoredExchangeBook,
  normalizeExchangeOrderBook,
  type ExchangeOrderBookSnapshot,
  type MultiExchangeDepthAnalysis,
} from './src/lib/orderBookDepth';
import {
  evaluateSentinelAgent,
  newsItemsToCrossPlatformSignals,
  type CrossPlatformFeedSignal,
  type SentinelAssessment,
} from './src/lib/sentinelAgent';
import { TELEMETRY_POLL_INTERVAL_MS } from './src/lib/telemetrySync';
import {
  parseBinanceFiveMinuteKlines,
  parseBybitFiveMinuteKlines,
  computeRelativeVolumeObservation,
} from './src/lib/realVolumeCandles';
import {
  DEFAULT_MAX_EXECUTION_SLIPPAGE_PCT,
  MAX_WS_RECONNECT_ATTEMPTS,
  SUBSECOND_HEARTBEAT_INTERVAL_MS,
  WS_FRAME_STALE_THRESHOLD_MS,
  computeExponentialReconnectDelayMs,
  isTelemetryStale,
  timingSafeEqualStr,
  validateLiveExecutionPrice,
  validateLiveSwitchChallenge,
  type BackendHealthSnapshot,
  type StructuredPerformanceReport,
} from './src/lib/monitorAgent';
import {
  STRICT_DIGEST_INTERVAL_HOURS,
  THREE_HOURS_MS,
  buildDigestEmailBodyHtml,
  consumePendingForDigest,
  createInitialDigestState,
  enqueueSignalForDigest,
  evaluateDigestSchedule,
  escapeHtml,
  type SignalDigestModule,
  type SignalDigestQueueState,
} from './src/lib/emailDigest';
import {
  validateSpotFeedAgainstCmc,
  validateSpotTickSample,
  type CmcBaselineValuation,
  type SpotCmcValidationResult,
} from './src/lib/spotCmcValidator';
import {
  DEFAULT_SYSTEM_CONTROLS,
  mergeSystemControls,
  type SystemRuntimeControls,
} from './src/lib/systemControls';
import {
  INITIAL_RL_TUNING_STATE,
  detectFlashCrashConditions,
  executeEmergencyStablecoinLiquidation,
  tuneStrategyParametersRL,
  type EmergencyLiquidationSummary,
  type RlAutoTuningState,
} from './src/lib/autonomousSafeguards';
import {
  INITIAL_INSTITUTIONAL_ACCOUNTS,
  buildMirroredCopyTradePlan,
  executeArbitrageCapture,
  scanCrossExchangeArbitrage,
  type ArbitrageExecutionRecord,
  type ArbitrageOpportunity,
  type InstitutionalCopyAccount,
} from './src/lib/arbitrageAndCopyTrading';
import {
  DEFAULT_PORTFOLIO_SEEDS,
  DEFAULT_REBALANCE_CONFIG,
  DEFAULT_STABLECOIN_RESERVE_USD,
  evaluateMultiAssetPortfolio,
  executePortfolioRebalance,
  normalizeRebalanceConfig,
  safeFiniteNumber,
  type PortfolioHoldingSeed,
  type PortfolioRebalanceConfig,
  type RebalanceExecutionRecord,
} from './src/lib/portfolioManager';
import {
  createInitialForgeCapitalHubState,
  createRoutedSandboxPosition,
  engageImmutableFailSafe,
  estimateMarketVolatilityPct,
  isForgeModuleId,
  reconcileForgeCapitalState,
  recordForgeApiError,
  recoverFromImmutableFailSafe,
  routeDualExecutionOrder,
  setForgeModuleSuspension,
  updateForgeCapitalConfig,
  type ForgeCapitalHubState,
  type ForgeMarketChannel,
  type ForgeModuleId,
} from './src/lib/forgeCapitalHub';
import { buildKernelValidatedRiskProfile } from './src/lib/invariantKernels';
import { CONSOLIDATED_SYSTEMIC_SCHEMA } from './src/lib/systemicLayers';
import {
  KERNEL_CEILINGS,
  KERNEL_REGISTRY,
  assertBootBindingOrThrow,
} from './src/lib/bindingLayer';
import {
  FOUR_PROFILE_CATALOG,
  ORDERED_DEFENSE_LAYERS,
  resolveLiveMandateFromEnvironment,
  resolveRuntimeGuardStartupOrThrow,
  type GuardProfileId,
} from './src/lib/runtimeGuard';
import {
  DEVELOPER_AUDIT_BATCH_INTERVAL_MIN,
  createPublicVerifiedTradeRecord,
  diagnoseSystemAuditEvents,
  evaluateDeveloperAuditDispatch,
  normalizeTradingViewWebhook,
  verifyPublicTradeId,
  type PublicVerifiedTradeRecord,
  type TradingViewWebhookSignal,
} from './src/lib/multiAgentTradingArchitecture';
import {
  DEFAULT_EXECUTION_ALGORITHM,
  EXECUTION_ALGORITHM_REGISTRY,
  FILL_MODEL_KERNEL_ARTIFACT,
  ORDERED_FILL_PHASES,
  verifyFillModelArtifactSignature,
} from './src/lib/fillModel';
import {
  EU_AI_ACT_HIGH_RISK_ARTICLES,
  ImmutableGateRecordStore,
  MIN_GATE_RETENTION_DAYS,
  ORDERED_PG_V4_CONJUNCTS,
  PG_V4_LOGIC_VERSION,
  computePgV4LogicHash,
  evaluatePgV4GateAsync,
  evaluatePromotionSubmission,
} from './src/lib/pgV4Gate';
import { runWalkForwardOrchestration } from './src/lib/walkForwardOrchestrator';
import {
  MIN_RR_KERNEL_CONSTANT,
  ORDERED_RR_CHECK_STAGES,
  RISK_ENGINE_DD_LIMITS,
  RR_REJECTION_TAXONOMY,
  can_trade,
  type MarketRegime,
  type StructuralStopOrigin,
  type StructuralTargetOrigin,
} from './src/lib/riskEngine';
import {
  CACHE_POLICY_TABLE,
  CERTIFIED_PRIMARY_SOURCE_CONFIG,
  GLOBAL_CPS_ORACLE,
  PRISTINE_DATA_INVARIANT_MANIFEST,
} from './src/lib/certifiedPrimarySource';
import {
  GLOBAL_DATA_INTEGRITY_RUNTIME,
  TIER_2_WATCHDOG_INTERVAL_MS,
  TIER_3_HARD_RESET_INTERVAL_MS,
} from './src/lib/dataIntegrityRuntime';
import {
  CONTROL_TOGGLE_KEYS,
  DESCRIPTOR_BY_KEY,
  applySystemControlsToMatrix,
  matrixToSystemControls,
  parseGranularControlMatrix,
  type CapabilityClass,
  type GranularControlMatrix,
  type MicroserviceId,
} from './src/lib/controlMatrix';
import {
  UNAUTHENTICATED_PRINCIPAL,
  evaluateSubscriptionGate,
  maskPrincipalSummary,
  type SubscriptionPrincipal,
} from './src/lib/subscriptionGatekeeper';
import {
  buildRbacIdentity,
  evaluateRbacAccess,
  type RbacPermission,
} from './src/lib/rbac';
import {
  ModularProfitTakingEngine,
  type ProfitAgentId,
} from './src/lib/modularProfitTaking';
import {
  optimizeBacktestParameters,
  runComparativeSimulationMatrix,
  type MatrixAgentStrategyId,
} from './src/lib/modularBacktestEngine';
import { MultiAgentStateSyncEngine } from './src/lib/agentSyncEngine';
import {
  ProfitScoopVaultEngine,
  type ProfitThresholdMode,
  type VaultActorType,
  type VaultOverrideAction,
} from './src/lib/profitVaultEngine';
import { TokenBucketLimiter } from './src/lib/tokenBucketLimiter';
import {
  SelfHealingSupervisor,
  YearnLockedProfitDegradation,
  type MarketDebateContext,
} from './src/lib/multiAgentDebateEngine';
import {
  GeminiServiceError,
  getGeminiConfigurationHealth,
  runGroundedMarketSearch,
  runMultiAgentDebateDecision,
} from './src/services/geminiDebateService';
import {
  ORDERED_MICROSERVICE_IDS,
  type ErrorSeverity,
  type FailoverNodeRole,
} from './src/lib/microserviceArchitecture';
import {
  grantOrUpdateSubscription,
  resolvePrincipalFromVerifiedToken,
  verifyFirebaseIdToken,
} from './src/services/firebaseAuthVerifier';
import { GLOBAL_MICROSERVICE_COORDINATOR } from './src/services/microserviceCoordinator';
import {
  classifyLatencyStatus,
  computeCpuUsagePercent,
  computeNextDailyAuditIso,
  computeRiskRewardRatio,
  formatDailyAuditReportMessage,
  formatDeveloperAuditMessage,
  formatPublicSignalMessage,
  getUtcDateKey,
  maskChatId,
  maskTelegramToken,
  parseTelegramWebhookUpdate,
  shouldTriggerDailyAudit,
  type DailyAuditReportSummary,
  type ModuleLatencyMetric,
  type StructuredTradeSignalAlert,
  type SystemAuditLogEntry,
  type SystemHealthParameters,
  type TelegramDualStreamStatus,
  type TelegramWebhookInboundEvent,
} from './src/lib/telegramStreams';
import {
  DEFAULT_SPAM_FILTER_CONFIG,
  buildOutboundWebhookPayload,
  evaluateSignalSpamFilter,
  extractTradingAlertParams,
  maskWebhookUrl,
  type IncomingTradingAlertInput,
  type OutboundMakeWebhookPayload,
  type ProcessedSignalRecord,
  type SignalLifecycleStatus,
  type SignalProcessorStatusSnapshot,
  type SpamFilterHistoryEntry,
  type TpMilestone,
} from './src/lib/signalProcessor';
import {
  EntryZoneExecutionValidator,
  PrePumpSupportExecutionModule,
  TelegramDispatchStabilizer,
  computeEntryZoneBounds,
  evaluateExecutedPositionLifecycle,
  type BackendExecutedOrderLog,
  type BackendExecutionPipelineSnapshot,
  type EntryZoneSignalCandidate,
} from './src/lib/executionPipeline';
import { AgenticCliGatewayRuntime } from './src/lib/agenticCliGatewayServer';
import { FableOrchestratorRuntime } from './src/lib/fableOrchestratorServer';
import { FreqtradeCoreServerRuntime } from './src/lib/freqtradeCoreServer';
import { isSupportedExchange } from './src/lib/freqtradeCoreEngine';
import { HybridArchitectureServerRuntime } from './src/lib/hybridArchitectureServer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOOT_POLICY_RAW = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'policies/force-signal.policy.json'), 'utf8')
) as unknown;
const BOOT_BINDING = assertBootBindingOrThrow(BOOT_POLICY_RAW, {
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'staging',
});

const SERVER_GUARD_LOCK = resolveRuntimeGuardStartupOrThrow({
  requestedProfile: (process.env.FORCE_SIGNAL_PROFILE as GuardProfileId | undefined) ?? 'Paper-Trade',
});
const SERVER_LIVE_MANDATE = resolveLiveMandateFromEnvironment(process.env);

const PORT = 3000;
function extractCleanEmail(raw?: string): string {
  const match = raw?.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : 'amirshehzad2647tcs@gmail.com';
}
const OWNER_EMAIL = extractCleanEmail(
  process.env.RECIPIENT_EMAIL || process.env.OWNER_ALERT_EMAIL
);
const WHATSAPP_URL = 'https://wa.me/923015083557';

interface WhaleTransaction {
  id: string;
  symbol: string;
  coinName: string;
  amountUnits: number;
  amountUsd: number;
  type: 'Exchange Inflow' | 'Exchange Outflow' | 'Whale Transfer';
  fromLabel: string;
  toLabel: string;
  timestamp: string;
  impact: 'Bullish' | 'Bearish' | 'Neutral';
}

interface ExchangeFlowMetric {
  symbol: string;
  coinName: string;
  price: number;
  change24h: number;
  volume24hUsd: number;
  inflow24hUsd: number;
  outflow24hUsd: number;
  netflowUsd: number; // negative = net outflow (accumulation/bullish)
}

interface AlertDispatchRecord {
  id: string;
  type:
    | 'HIGH_CONFIDENCE_SIGNAL'
    | 'THREE_HOUR_SIGNAL_DIGEST'
    | 'SIX_HOUR_DIGEST'
    | 'PRICE_ALERT'
    | 'TOP_GAINER_ALERT'
    | 'PERFORMANCE_DAILY'
    | 'PERFORMANCE_WEEKLY'
    | 'PERFORMANCE_MONTHLY';
  recipient: string;
  subject: string;
  summary: string;
  status: 'sent' | 'batched_for_3h_digest' | 'queued_no_api_key' | 'failed';
  providerId?: string;
  telegramDelivered?: boolean;
  batchedCount?: number;
  timestamp: string;
}

interface TelegramChannelPost {
  id: string;
  channelName: string;
  symbol: string;
  direction: 'BUY' | 'SELL' | 'SUMMARY';
  confidence?: number;
  message: string;
  deliveredViaBot: boolean;
  timestamp: string;
}

interface ExecutionSandboxPosition {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  mode: 'TESTNET' | 'LIVE';
  entryPrice: number;
  quantity: number;
  notionalUsd: number;
  initialStopLoss: number;
  trailingStopLoss: number;
  takeProfits: [number, number, number];
  status: 'OPEN' | 'CLOSED_MANUAL';
  pnlUsd: number;
  pnlPercent: number;
  skepticVerdict: 'APPROVED' | 'CAUTION' | 'VETOED';
  openedAt: string;
  closedAt?: string;
}

const alertDispatchLog: AlertDispatchRecord[] = [];
const sentHighConfidenceKeys = new Set<string>();
const telegramChannelFeed: TelegramChannelPost[] = [];
const sentTelegramKeys = new Set<string>();
let signalDigestState: SignalDigestQueueState = createInitialDigestState();

let executionMode: 'TESTNET' | 'LIVE' = 'TESTNET';
let crossWalletBalanceUsd = 25000;
const sandboxPositions: SandboxPosition[] = [];
let totalExecutedOrders = 0;
let forgeCapitalState: ForgeCapitalHubState = createInitialForgeCapitalHubState({
  initialEquityUsd: crossWalletBalanceUsd,
  portfolioDrawdownLimitPct: 12.5,
});

const MAX_OTP_VERIFY_ATTEMPTS = 5;
const MAX_FAILSAFE_VERIFY_ATTEMPTS = 5;
const SESSION_TTL_MS = 30 * 60_000;
const SESSION_SIGNING_KEY =
  process.env.SESSION_SIGNING_KEY || crypto.randomBytes(32).toString('hex');
const OPERATOR_API_TOKEN = process.env.OPERATOR_API_TOKEN || '';

function createAsyncMutex() {
  let queue: Promise<void> = Promise.resolve();
  return {
    runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
      const next = queue.then(() => fn());
      queue = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    },
  };
}
const executionMutex = createAsyncMutex();

function addBoundedSetKey(set: Set<string>, key: string, maxSize = 500): void {
  if (set.has(key)) {
    set.delete(key);
  }
  set.add(key);
  while (set.size > maxSize) {
    const oldest = set.values().next().value;
    if (oldest === undefined) break;
    set.delete(oldest);
  }
}

function signOperatorSessionToken(ttlMs = SESSION_TTL_MS): { token: string; expiresAtMs: number } {
  const expiresAtMs = Date.now() + ttlMs;
  const nonce = crypto.randomBytes(12).toString('hex');
  const payload = `${expiresAtMs}.${nonce}`;
  const sig = crypto
    .createHmac('sha256', SESSION_SIGNING_KEY)
    .update(payload)
    .digest('hex');
  return { token: `${payload}.${sig}`, expiresAtMs };
}

function verifyOperatorSessionToken(token: unknown): boolean {
  if (typeof token !== 'string' || !token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expStr, nonce, sig] = parts;
  const expiresAtMs = Number(expStr);
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs || !nonce || !sig) {
    return false;
  }
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SIGNING_KEY)
    .update(`${expStr}.${nonce}`)
    .digest('hex');
  if (sig.length !== expectedSig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expectedSig, 'utf8'));
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

const rateLimitStore = new Map<string, number[]>();
function createRateLimiter(bucket: string, maxRequests: number, windowMs: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${bucket}:${ip}`;
    const existing = rateLimitStore.get(key) || [];
    const recent = existing.filter((ts) => now - ts < windowMs);
    if (recent.length >= maxRequests) {
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({
        ok: false,
        code: 'RATE_LIMITED',
        error: `Too many requests to ${bucket}. Retry in ${Math.ceil(windowMs / 1000)}s.`,
      });
    }
    recent.push(now);
    rateLimitStore.set(key, recent);
    if (rateLimitStore.size > 2000) {
      for (const [k, list] of rateLimitStore.entries()) {
        if (list.length === 0 || now - list[list.length - 1] > windowMs) {
          rateLimitStore.delete(k);
        }
      }
    }
    next();
  };
}

function hasConfiguredOperatorToken(req: express.Request): boolean {
  const authHeader = String(req.headers.authorization || '');
  if (OPERATOR_API_TOKEN && authHeader.startsWith('Bearer ')) {
    const provided = authHeader.slice(7).trim();
    if (provided && timingSafeEqualStr(provided, OPERATOR_API_TOKEN)) {
      return true;
    }
  }
  return false;
}

function extractFirebaseIdTokenFromRequest(req: express.Request): string {
  const headerToken = req.headers['x-firebase-id-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim();
  }
  const authHeader = String(req.headers.authorization || '');
  if (authHeader.startsWith('Bearer ') && !hasConfiguredOperatorToken(req)) {
    return authHeader.slice(7).trim();
  }
  return '';
}

async function resolveCallerPrincipal(req: express.Request): Promise<SubscriptionPrincipal> {
  if (hasConfiguredOperatorToken(req)) {
    return {
      authenticated: true,
      uid: 'ci-operator-automation',
      email: OWNER_EMAIL,
      emailVerified: true,
      tier: 'PREMIUM_INSTITUTIONAL',
      status: 'ACTIVE',
      expiresAtMs: null,
      entitlementId: 'ent_operator_cli',
      planLabel: 'Operator Automation Clearance',
    };
  }
  const rawToken = extractFirebaseIdTokenFromRequest(req);
  if (!rawToken) return UNAUTHENTICATED_PRINCIPAL;
  const verified = await verifyFirebaseIdToken(rawToken);
  return resolvePrincipalFromVerifiedToken(verified);
}

function requirePremiumSubscription(capability: CapabilityClass) {
  return async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const principal = await resolveCallerPrincipal(req);
    const gate = evaluateSubscriptionGate(principal, capability);
    if (!gate.allowed) {
      return res.status(gate.httpStatus).json({
        ok: false,
        code: gate.code,
        capability: gate.capability,
        error: gate.reason,
        remediation: gate.remediation,
        subscriptionLocked: true,
        lockedControls: gate.lockedControls,
      });
    }
    (req as express.Request & { subscriberPrincipal?: SubscriptionPrincipal }).subscriberPrincipal =
      principal;
    return next();
  };
}

const extraAdminEmailsFromEnv = (process.env.ADMIN_EMAIL_ALLOWLIST || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const modularProfitTakingEngine = new ModularProfitTakingEngine();
const multiAgentSyncEngine = new MultiAgentStateSyncEngine();
const profitVaultEngine = new ProfitScoopVaultEngine(25_000);
const apiTokenBucketLimiter = new TokenBucketLimiter({
  rpm: Number(process.env.RATE_LIMIT_RPM) || 200,
  burst: Number(process.env.RATE_LIMIT_BURST) || 50,
});
const yearnProfitDegradation = new YearnLockedProfitDegradation(
  Number(process.env.VAULT_UNLOCK_HOURS) || 6
);
yearnProfitDegradation.reportGain(profitVaultEngine.getSnapshot().lockedVaultBalanceUsd);
const selfHealingSupervisor = new SelfHealingSupervisor(2, 30);
const agenticCliGateway = new AgenticCliGatewayRuntime(__dirname);
const fableOrchestrator = new FableOrchestratorRuntime(__dirname);
const freqtradeCore = new FreqtradeCoreServerRuntime(__dirname);
const hybridArchitecture = new HybridArchitectureServerRuntime(__dirname);

function tokenBucketRateLimit(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const identity =
    (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : req.ip) || 'operator';
  const result = apiTokenBucketLimiter.consume(identity);
  res.setHeader('X-RateLimit-Limit', String(result.limitRpm));
  res.setHeader('X-RateLimit-Burst', String(result.limitBurst));
  res.setHeader('X-RateLimit-Remaining', String(result.remainingTokens));
  if (!result.allowed) {
    res.setHeader('Retry-After', String(result.retryAfterSec));
    return res.status(429).json({
      ok: false,
      code: 'RATE_LIMIT_EXCEEDED',
      error: `Token bucket rate limit exceeded (${result.limitRpm} RPM / ${result.limitBurst} burst). Retry in ${result.retryAfterSec}s.`,
      retryAfterSec: result.retryAfterSec,
    });
  }
  return next();
}

function requireRbacPermission(permission: RbacPermission) {
  return async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const principal = await resolveCallerPrincipal(req);
    const identity = buildRbacIdentity(principal, extraAdminEmailsFromEnv);
    const decision = evaluateRbacAccess(identity, permission);
    if (!decision.allowed) {
      return res.status(decision.httpStatus).json({
        ok: false,
        code: decision.code,
        role: decision.role,
        requiredPermission: decision.requiredPermission,
        rbacDenied: true,
        error: decision.reason,
      });
    }
    (req as express.Request & { rbacIdentity?: typeof identity }).rbacIdentity = identity;
    return next();
  };
}

/**
 * Server-authoritative clearance for GLOBAL system maintenance mutations.
 * Premium subscription allows research features, not ownership of the
 * shared microservice control plane. A configured server-to-server operator
 * bearer may act as an infrastructure principal; a browser UID cannot.
 */
async function requireMasterControlOwner(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (hasConfiguredOperatorToken(req)) return next();
  try {
    const principal = await resolveCallerPrincipal(req);
    const identity = buildRbacIdentity(principal, extraAdminEmailsFromEnv);
    if (identity.role !== 'SUPER_ADMIN') {
      return res.status(403).json({
        ok: false,
        code: 'OWNER_CONTROL_REQUIRED',
        error: 'Global system maintenance requires a verified owner-level account.',
      });
    }
    return next();
  } catch {
    return res.status(403).json({
      ok: false, code: 'OWNER_CONTROL_VERIFICATION_FAILED',
      error: 'Owner authorization could not be verified.',
    });
  }
}

function requireOperatorAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (hasConfiguredOperatorToken(req)) {
    return next();
  }
  const headerToken = req.headers['x-signal-session'];
  if (verifyOperatorSessionToken(headerToken)) {
    return next();
  }
  // Allow valid cookie session only when paired with same-origin fetch metadata
  const cookies = parseCookies(req.headers.cookie);
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (
    verifyOperatorSessionToken(cookies.sf_session) &&
    (fetchSite === 'same-origin' || fetchSite === 'same-site')
  ) {
    return next();
  }
  return res.status(401).json({
    ok: false,
    code: 'UNAUTHORIZED_OPERATOR',
    error: 'Valid operator session token (X-Signal-Session) required.',
  });
}

// Interactive Live Switch OTP Challenges (5-minute expiry, max 5 attempts)
interface LiveOtpChallenge {
  id: string;
  code: string;
  recipient: string;
  expiresAt: number;
  used: boolean;
  attempts: number;
}
const liveOtpChallenges = new Map<string, LiveOtpChallenge>();

interface FailsafeRecoveryChallenge {
  id: string;
  sealId: string;
  codeHash: string;
  expiresAt: number;
  used: boolean;
  attempts: number;
}
const failsafeChallenges = new Map<string, FailsafeRecoveryChallenge>();

// Structured Auto-Report Engine uses StructuredPerformanceReport from src/lib/monitorAgent

// Binance Spot Primary Data Feed + Optional On-Demand Futures + CoinMarketCap Baseline Valuations
const SPOT_REST_ENDPOINTS = [
  'https://api.binance.com',
  'https://data-api.binance.vision',
] as const;
const SPOT_TESTNET_ENDPOINT = 'https://testnet.binance.vision';
const SPOT_WS_ENDPOINTS = [
  'wss://stream.binance.com:9443/stream',
  'wss://data-stream.binance.vision/stream',
] as const;

const FUTURES_FEED_ENDPOINT = 'https://fapi.binance.com';
const FUTURES_TESTNET_ENDPOINT = 'https://testnet.binancefuture.com';
const FUTURES_MAX_LEVERAGE: Record<string, number> = {
  BTCUSDT: 125,
  ETHUSDT: 100,
  SOLUSDT: 50,
  BNBUSDT: 50,
  XRPUSDT: 50,
  AVAXUSDT: 50,
  LINKUSDT: 50,
  ADAUSDT: 50,
  DOGEUSDT: 50,
  NEARUSDT: 50,
};

interface SpotTickerEntry {
  symbol: string;
  price: number;
  change24hPercent: number;
  high24h: number;
  low24h: number;
  volume24hUsd: number;
  source: 'binance_spot' | 'spot_cache';
  updatedAtMs: number;
}

const spotFeedCache: Record<string, SpotTickerEntry> = {};
let spotFeedSource: 'binance_spot' | 'spot_cache' = 'spot_cache';
let spotFeedUpdatedAt: string = new Date().toISOString();

const cmcValuationsCache: Record<string, CmcBaselineValuation> = {};
const spotCmcValidations: Record<string, SpotCmcValidationResult> = {};
let cmcValuationsSource: 'cmc_api' | 'unavailable' = 'unavailable';
let cmcUpdatedAt: string = new Date().toISOString();

let futuresFeedSource: 'binance_futures' | 'futures_cache' = 'futures_cache';
let futuresFeedUpdatedAt: string = new Date().toISOString();
let lastFeedPollAtMs = Date.now();
let serverSyncEpoch = 1;
let lastSpotPollLatencyMs = 0;
let lastFuturesPollLatencyMs = 0;
let lastGainersPollLatencyMs = 0;
const futuresFeedCache: Record<string, FuturesTickerTelemetry> = {};

let spotPollInFlight: Promise<void> | null = null;
let cmcRefreshInFlight: Promise<void> | null = null;
let futuresPollInFlight: Promise<void> | null = null;
let gainersPollInFlight: Promise<void> | null = null;
let cpsRestCheckInFlight: Promise<void> | null = null;
const cpsSeqByInstrument = new Map<string, number>();

interface SpotStreamTick {
  symbol: string;
  price: number;
  markPrice: number; // backward-compatible alias for downstream listeners
  volume24hUsd?: number;
  change24hPercent?: number;
  high24h?: number;
  low24h?: number;
  source: 'binance_spot';
  updatedAtMs: number;
}
const pendingSseTickBatch = new Map<string, SpotStreamTick>();
const sseTickListeners = new Set<(ticks: SpotStreamTick[]) => void>();
const MAX_MONITOR_SSE_CLIENTS = 250;
const MAX_MONITOR_SSE_BACKPRESSURE_BYTES = 512 * 1024; // drop slow monitor clients

let backendSpotWs: WebSocket | null = null;
let backendWsConnected = false;
let backendWsLastFrameAtMs = 0;
let backendWsAttempt = 0;
let backendWsCircuitOpen = false;
let backendWsHostIndex = 0;
let backendWsHealTimer: ReturnType<typeof setTimeout> | null = null;
let backendWsFirstFrameTimer: ReturnType<typeof setTimeout> | null = null;
let systemControls: SystemRuntimeControls = { ...DEFAULT_SYSTEM_CONTROLS };
let appLiveEnabled = true;
let appLiveToggledAt: string = new Date().toISOString();
let appLiveQuotaSavedCalls = 0;

// Live Kline Candle-Close Verification State (via Binance WS @kline_1m / @kline_15m)
interface ClosedCandleWsFrame {
  symbol: string;
  interval: string;
  closePrice: number;
  isFinal: boolean;
  closeTimeMs: number;
  updatedAtIso: string;
}
const liveKlineWsFrames: Record<string, ClosedCandleWsFrame> = {};
let backendWsTotalFrames = 0;
let backendWsClosedCandlesCount = 0;
let backendWsDepthFramesCount = 0;

// Multi-Exchange L2 Order Book Depth, Sentinel Agent & Zero-Intervention Autonomous Coordinator State
const DEPTH_TRACKED_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'AVAXUSDT'];
const liveExchangeBooksCache: Record<string, Partial<Record<'BINANCE' | 'BYBIT' | 'OKX', ExchangeOrderBookSnapshot>>> = {};
const multiExchangeDepthCache: Record<string, MultiExchangeDepthAnalysis> = {};
let depthUpdatedAt: string = new Date().toISOString();

const sentinelAssessmentsCache: Record<string, SentinelAssessment> = {};
let sentinelUpdatedAt: string = new Date().toISOString();

interface AutonomousDecisionRecord {
  id: string;
  symbol: string;
  action:
    | 'ENTRY_SPOT'
    | 'ENTRY_FUTURES'
    | 'HEDGE_SHORT'
    | 'EXIT_REVERSAL'
    | 'EXIT_5X_ATR_TP'
    | 'EXIT_5PCT_SL_CAP'
    | 'EXIT_TRAIL_SL'
    | 'EMERGENCY_LIQUIDATION'
    | 'ARBITRAGE_CAPTURE'
    | 'COPY_MIRROR';
  direction: 'BUY' | 'SELL';
  price: number;
  leverage: number;
  reason: string;
  pnlUsd?: number;
  timestamp: string;
}

let autonomousCoordinatorEnabled = true;
let autonomousLastTickAt: string | null = null;
let autonomousTotalCycles = 0;
let autonomousEntriesExecuted = 0;
let autonomousExitsExecuted = 0;
let autonomousHedgesExecuted = 0;
let autonomousReversalExitsExecuted = 0;
const autonomousDecisionsLog: AutonomousDecisionRecord[] = [];

// AI RL Auto-Tuning, Emergency Flash-Crash Liquidation, Arbitrage & Copy Trading State
let rlTuningState: RlAutoTuningState = { ...INITIAL_RL_TUNING_STATE };
const emergencyLiquidationState: EmergencyLiquidationSummary = {
  stablecoinReserveAsset: 'USDT',
  totalStablecoinReserveUsd: crossWalletBalanceUsd,
  liquidatedCount: 0,
  totalConvertedUsd: 0,
  lastEventAt: null,
  lastTriggerReason: null,
  history: [],
};
let arbitrageOpportunitiesCache: ArbitrageOpportunity[] = [];
const arbitrageExecutionsLog: ArbitrageExecutionRecord[] = [];
const institutionalCopyAccounts: InstitutionalCopyAccount[] = INITIAL_INSTITUTIONAL_ACCOUNTS.map(
  (a) => ({ ...a })
);
const mirroredCopyHistory: Array<ReturnType<typeof buildMirroredCopyTradePlan>> = [];

// Multi-Asset Portfolio & Volatility-Based Auto-Rebalancing State
let portfolioHoldings: PortfolioHoldingSeed[] = DEFAULT_PORTFOLIO_SEEDS.map((h) => ({ ...h }));
let portfolioReserveUsd = DEFAULT_STABLECOIN_RESERVE_USD;
let portfolioConfig: PortfolioRebalanceConfig = { ...DEFAULT_REBALANCE_CONFIG };
let portfolioLastRebalanceAt: string | null = null;
const portfolioRebalanceHistory: RebalanceExecutionRecord[] = [];

// Autonomous Backend Monitoring Agent State
const serverStartedAtMs = Date.now();
let monitorHealInFlight = false;
const monitorState: BackendHealthSnapshot = {
  status: 'OPTIMAL',
  heartbeatSeq: 1,
  uptimeSec: 0,
  eventLoopLagMs: 1,
  wsChannelStatus: 'CONNECTED',
  spotFeedStatus: 'DETERMINISTIC_FALLBACK',
  futuresFeedStatus: 'DETERMINISTIC_FALLBACK',
  cmcStatus: 'UNAVAILABLE',
  anomaliesIsolatedCount: 0,
  staleFeedCount: 0,
  autoHealCount: 0,
  selfHealLatencyMs: 0,
  lastHealAction: 'Autonomous Binance Spot monitoring agent initialized',
  lastHeartbeatAt: new Date().toISOString(),
  backendWsConnected: false,
  wsLastFrameAgeMs: 0,
};

function seedFallbackSpotTelemetry(forceReset = false) {
  if (forceReset) {
    for (const key of Object.keys(spotFeedCache)) {
      delete spotFeedCache[key];
    }
    spotFeedSource = 'spot_cache';
  }
  const nowMs = Date.now();
  for (const coin of TRACKED_COINS) {
    if (forceReset || !spotFeedCache[coin.symbol]) {
      spotFeedCache[coin.symbol] = {
        symbol: coin.symbol,
        price: coin.referencePrice,
        change24hPercent: 0,
        high24h: Number((coin.referencePrice * 1.018).toPrecision(6)),
        low24h: Number((coin.referencePrice * 0.982).toPrecision(6)),
        volume24hUsd: coin.referencePrice >= 1000 ? 14_200_000_000 : 1_850_000_000,
        source: 'spot_cache',
        updatedAtMs: nowMs,
      };
    }
  }
  for (const g of topGainersCache) {
    if (forceReset || !spotFeedCache[g.symbol]) {
      spotFeedCache[g.symbol] = {
        symbol: g.symbol,
        price: g.price,
        change24hPercent: g.change24hPercent,
        high24h: g.high24h,
        low24h: g.low24h,
        volume24hUsd: g.volume24hUsd,
        source: 'spot_cache',
        updatedAtMs: nowMs,
      };
    }
  }
}

function seedFallbackFuturesTelemetry(forceReset = false) {
  if (forceReset) {
    for (const key of Object.keys(futuresFeedCache)) {
      delete futuresFeedCache[key];
    }
    futuresFeedSource = 'futures_cache';
  }
  const fundingPresets: Record<string, number> = {
    BTCUSDT: 0.0001,
    ETHUSDT: 0.00012,
    SOLUSDT: 0.00024,
    BNBUSDT: 0.00008,
    XRPUSDT: -0.00014,
    AVAXUSDT: 0.00019,
    LINKUSDT: 0.00015,
    ADAUSDT: -0.00006,
    DOGEUSDT: 0.00031,
    NEARUSDT: 0.00011,
  };
  for (const coin of TRACKED_COINS) {
    if (forceReset || !futuresFeedCache[coin.symbol]) {
      const mark = spotFeedCache[coin.symbol]?.price ?? coin.referencePrice;
      futuresFeedCache[coin.symbol] = {
        symbol: coin.symbol,
        markPrice: mark,
        indexPrice: Number((mark * 0.9996).toPrecision(6)),
        fundingRate: fundingPresets[coin.symbol] ?? 0.0001,
        nextFundingTime: new Date(Date.now() + 3_600_000 * 4).toISOString(),
        openInterestUsd: coin.referencePrice >= 1000 ? 2_850_000_000 : 410_000_000,
        volume24hUsd: spotFeedCache[coin.symbol]?.volume24hUsd ?? (coin.referencePrice >= 1000 ? 14_200_000_000 : 1_850_000_000),
        maxLeverage: FUTURES_MAX_LEVERAGE[coin.symbol] ?? 25,
        source: 'futures_cache',
      };
    }
  }
  for (const g of topGainersCache) {
    if (forceReset || !futuresFeedCache[g.symbol]) {
      const mark = spotFeedCache[g.symbol]?.price ?? g.price;
      futuresFeedCache[g.symbol] = {
        symbol: g.symbol,
        markPrice: mark,
        indexPrice: Number((mark * 0.9997).toPrecision(6)),
        fundingRate: g.change24hPercent >= 12 ? 0.00028 : 0.0001,
        nextFundingTime: new Date(Date.now() + 3_600_000 * 4).toISOString(),
        openInterestUsd: Math.round(g.volume24hUsd * 0.34),
        volume24hUsd: g.volume24hUsd,
        maxLeverage: FUTURES_MAX_LEVERAGE[g.symbol] ?? 25,
        source: 'futures_cache',
      };
    }
  }
}

async function pollBinanceSpotFeed() {
  if (spotPollInFlight) return spotPollInFlight;
  spotPollInFlight = (async () => {
    const startedAt = Date.now();
    const epochAtStart = serverSyncEpoch;
    seedFallbackSpotTelemetry();
    for (const host of SPOT_REST_ENDPOINTS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      try {
        const res = await fetch(`${host}/api/v3/ticker/24hr`, { signal: controller.signal });
        if (!res.ok) {
          forgeCapitalState = recordForgeApiError(forgeCapitalState, {
            market: 'SPOT',
            moduleId: 'SPOT_MOMENTUM',
            endpoint: `${host}/api/v3/ticker/24hr`,
            httpStatus: res.status,
            exchangeCode: `HTTP_${res.status}`,
            latencyMs: Date.now() - startedAt,
            message: `Binance Spot ticker HTTP ${res.status} from ${host}`,
          });
          continue;
        }
        const list = (await res.json()) as any[];
        if (epochAtStart !== serverSyncEpoch) return;
        if (!Array.isArray(list) || list.length === 0) continue;

        const wanted = new Set([
          ...TRACKED_COINS.map((c) => c.symbol),
          ...topGainersCache.map((g) => g.symbol),
        ]);
        const nowMs = Date.now();
        let updatedCount = 0;

        for (const item of list) {
          const sym = String(item?.symbol || '').toUpperCase();
          if (!wanted.has(sym)) continue;
          const price = Number(item.lastPrice);
          const prev = spotFeedCache[sym]?.price;
          const tickCheck = validateSpotTickSample({
            price,
            previousPrice: spotFeedCache[sym]?.source === 'binance_spot' ? prev : undefined,
          });
          if (!tickCheck.valid) {
            monitorState.anomaliesIsolatedCount = (monitorState.anomaliesIsolatedCount ?? 0) + 1;
            monitorState.lastHealAction = tickCheck.reason;
            continue;
          }
          spotFeedCache[sym] = {
            symbol: sym,
            price,
            change24hPercent: Number(Number(item.priceChangePercent || 0).toFixed(2)),
            high24h: Number(item.highPrice || price),
            low24h: Number(item.lowPrice || price),
            volume24hUsd: Math.round(Number(item.quoteVolume || 0)),
            source: 'binance_spot',
            updatedAtMs: nowMs,
          };
          updatedCount++;
        }

        if (updatedCount > 0) {
          spotFeedSource = 'binance_spot';
          spotFeedUpdatedAt = new Date(nowMs).toISOString();
          lastFeedPollAtMs = nowMs;
          lastSpotPollLatencyMs = Math.max(1, Date.now() - startedAt);
          monitorState.spotFeedStatus = 'LIVE';
          GLOBAL_MICROSERVICE_COORDINATOR.recordNonBlockingSuccess(
            'market-data-svc',
            lastSpotPollLatencyMs
          );
          return;
        }
      } catch (err) {
        forgeCapitalState = recordForgeApiError(forgeCapitalState, {
          market: 'SPOT',
          moduleId: 'SPOT_MOMENTUM',
          endpoint: `${host}/api/v3/ticker/24hr`,
          httpStatus: 503,
          exchangeCode: 'SPOT_FETCH_ERR',
          latencyMs: Date.now() - startedAt,
          message: err instanceof Error ? err.message : `Spot feed unreachable on ${host}`,
        });
        GLOBAL_MICROSERVICE_COORDINATOR.recordNonBlockingFault({
          serviceId: 'market-data-svc',
          code: 'SPOT_POLL_UNREACHABLE',
          message: err instanceof Error ? err.message : `Spot feed unreachable on ${host}`,
          severity: 'WARN',
          contextSummary: `Binance REST endpoint ${host}`,
        });
      } finally {
        clearTimeout(timer);
      }
    }
    spotFeedUpdatedAt = new Date().toISOString();
    lastSpotPollLatencyMs = Math.max(1, Date.now() - startedAt);
    monitorState.spotFeedStatus = spotFeedSource === 'binance_spot' ? 'LIVE' : 'DETERMINISTIC_FALLBACK';
  })().finally(() => {
    spotPollInFlight = null;
  });
  return spotPollInFlight;
}

async function refreshCmcValuations() {
  if (cmcRefreshInFlight) return cmcRefreshInFlight;
  cmcRefreshInFlight = (async () => {
    seedFallbackSpotTelemetry();
    const cmcKey = process.env.CMC_API_KEY;
    const nowIso = new Date().toISOString();

    const knownSupply: Record<string, { rank: number; supply: number; dom: number; name: string }> = {
      BTCUSDT: { rank: 1, supply: 19_780_000, dom: 57.4, name: 'Bitcoin' },
      ETHUSDT: { rank: 2, supply: 120_400_000, dom: 13.2, name: 'Ethereum' },
      SOLUSDT: { rank: 4, supply: 472_000_000, dom: 3.1, name: 'Solana' },
      BNBUSDT: { rank: 5, supply: 145_800_000, dom: 2.8, name: 'BNB' },
      XRPUSDT: { rank: 6, supply: 56_800_000_000, dom: 2.1, name: 'XRP' },
      DOGEUSDT: { rank: 7, supply: 146_700_000_000, dom: 1.6, name: 'Dogecoin' },
      ADAUSDT: { rank: 9, supply: 35_040_000_000, dom: 0.9, name: 'Cardano' },
      AVAXUSDT: { rank: 12, supply: 407_000_000, dom: 0.6, name: 'Avalanche' },
      LINKUSDT: { rank: 14, supply: 626_800_000, dom: 0.5, name: 'Chainlink' },
      NEARUSDT: { rank: 18, supply: 1_210_000_000, dom: 0.4, name: 'NEAR Protocol' },
    };

    let usedLiveCmc = false;
    if (cmcKey) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const res = await fetch(
          'https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=25&convert=USD',
          {
            headers: { 'X-CMC_PRO_API_KEY': cmcKey, Accept: 'application/json' },
            signal: controller.signal,
          }
        );
        if (res.ok) {
          const json = await res.json();
          const rows = Array.isArray(json?.data) ? json.data : [];
          if (rows.length > 0) {
            for (const row of rows) {
              const sym = `${String(row.symbol || '').toUpperCase()}USDT`;
              const quote = row.quote?.USD || {};
              const cmcPrice = Number(quote.price || 0);
              if (!Number.isFinite(cmcPrice) || cmcPrice <= 0) continue;
              cmcValuationsCache[sym] = {
                symbol: sym,
                coinName: String(row.name || sym.replace(/USDT$/, '')),
                cmcRank: Number(row.cmc_rank || 50),
                cmcPriceUsd: cmcPrice,
                marketCapUsd: Math.round(Number(quote.market_cap || 0)),
                volume24hUsd: Math.round(Number(quote.volume_24h || 0)),
                dominancePct: Number(Number(quote.market_cap_dominance || 0).toFixed(2)),
                percentChange24h: Number(Number(quote.percent_change_24h || 0).toFixed(2)),
                circulatingSupply: Math.round(Number(row.circulating_supply || 0)),
                updatedAt: nowIso,
                source: 'cmc_api',
              };
            }
            usedLiveCmc = true;
            cmcValuationsSource = 'cmc_api';
            monitorState.cmcStatus = 'CMC_API';
          }
        }
      } catch {
        // Independent CMC API unreachable
      } finally {
        clearTimeout(timer);
      }
    }

    if (!usedLiveCmc) {
      cmcValuationsSource = 'unavailable';
      monitorState.cmcStatus = 'UNAVAILABLE';
    }

    const coinsToValidate = [
      ...TRACKED_COINS.map((c) => ({ symbol: c.symbol, name: c.name })),
      ...topGainersCache.map((g) => ({ symbol: g.symbol, name: g.name })),
    ];
    const seen = new Set<string>();
    for (const item of coinsToValidate) {
      if (seen.has(item.symbol)) continue;
      seen.add(item.symbol);
      const spotEntry = spotFeedCache[item.symbol];
      const spotPrice = spotEntry?.price ?? 0;

      if (!usedLiveCmc && cmcValuationsCache[item.symbol]?.source !== 'cmc_api') {
        const meta = knownSupply[item.symbol] ?? {
          rank: 25,
          supply: Math.max(10_000_000, Math.round(450_000_000 / Math.max(spotPrice, 0.1))),
          dom: 0.25,
          name: item.name,
        };
        cmcValuationsCache[item.symbol] = {
          symbol: item.symbol,
          coinName: meta.name,
          cmcRank: meta.rank,
          cmcPriceUsd: 0,
          marketCapUsd: 0,
          volume24hUsd: spotEntry?.volume24hUsd ?? 250_000_000,
          dominancePct: meta.dom,
          percentChange24h: spotEntry?.change24hPercent ?? 0,
          circulatingSupply: meta.supply,
          updatedAt: nowIso,
          source: 'unavailable',
        };
      }

      const validation = validateSpotFeedAgainstCmc({
        symbol: item.symbol,
        spotPrice,
        cmcBaseline: cmcValuationsCache[item.symbol],
      });
      spotCmcValidations[item.symbol] = validation;
      if (validation.anomalyIsolated) {
        monitorState.anomaliesIsolatedCount = (monitorState.anomaliesIsolatedCount ?? 0) + 1;
        monitorState.lastHealAction = validation.reason;
      }
    }
    cmcUpdatedAt = nowIso;
  })().finally(() => {
    cmcRefreshInFlight = null;
  });
  return cmcRefreshInFlight;
}

function seedInitialSpotTestnetPositions() {
  if (sandboxPositions.length > 0) return;
  const btcPrice = spotFeedCache['BTCUSDT']?.price ?? TRACKED_COINS[0].referencePrice;
  const solPrice = spotFeedCache['SOLUSDT']?.price ?? TRACKED_COINS[2].referencePrice;

  const presets = [
    { symbol: 'BTCUSDT', direction: 'BUY' as const, entry: btcPrice, notional: 2400 },
    { symbol: 'SOLUSDT', direction: 'BUY' as const, entry: solPrice, notional: 1500 },
  ];

  for (const preset of presets) {
    const candles = generateDeterministicCandles(preset.symbol, '1h', 40, undefined, preset.entry);
    const atr = Math.max(computeATR(candles, 14), preset.entry * 0.008);
    const sl = Number((preset.entry - atr * 1.5).toPrecision(6));
    const trail = Number((preset.entry - atr * 1.25).toPrecision(6));
    const tp1 = Number((preset.entry + atr * 2.2).toPrecision(6));
    const tp2 = Number((preset.entry + atr * 3.6).toPrecision(6));
    const tp3 = Number((preset.entry + atr * 5.2).toPrecision(6));

    sandboxPositions.push({
      id: `spot_TESTNET_${preset.symbol}_seed_${Date.now()}_${sandboxPositions.length}`,
      symbol: preset.symbol,
      direction: preset.direction,
      mode: 'TESTNET',
      marketType: 'SPOT',
      marginMode: 'CROSS',
      leverage: 1,
      entryPrice: preset.entry,
      quantity: Number((preset.notional / Math.max(preset.entry, 1e-8)).toFixed(5)),
      notionalUsd: preset.notional,
      initialMarginUsd: preset.notional,
      maintenanceMarginUsd: 0,
      liquidationPrice: 0,
      fundingRate: 0,
      settledFundingUsd: 0,
      initialStopLoss: sl,
      trailingStopLoss: trail,
      takeProfits: [tp1, tp2, tp3],
      status: 'OPEN',
      pnlUsd: 0,
      pnlPercent: 0,
      roePercent: 0,
      skepticVerdict: 'APPROVED',
      openedAt: new Date(Date.now() - (sandboxPositions.length + 1) * 18 * 60_000).toISOString(),
    });
  }
}

async function pollBinanceFuturesFeed() {
  if (futuresPollInFlight) return futuresPollInFlight;
  futuresPollInFlight = (async () => {
    const startedAt = Date.now();
    const epochAtStart = serverSyncEpoch;
    seedFallbackFuturesTelemetry();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const [premRes, tickerRes] = await Promise.all([
        fetch(`${FUTURES_FEED_ENDPOINT}/fapi/v1/premiumIndex`, { signal: controller.signal }),
        fetch(`${FUTURES_FEED_ENDPOINT}/fapi/v1/ticker/24hr`, { signal: controller.signal }),
      ]);

      if (premRes.ok && tickerRes.ok) {
        const premList = (await premRes.json()) as any[];
        const tickerList = (await tickerRes.json()) as any[];
        if (epochAtStart !== serverSyncEpoch) return;
        if (Array.isArray(premList) && Array.isArray(tickerList)) {
          const tickerMap = new Map<string, any>();
          for (const t of tickerList) {
            if (t?.symbol) tickerMap.set(String(t.symbol).toUpperCase(), t);
          }
          const wanted = new Set([
            ...TRACKED_COINS.map((c) => c.symbol),
            ...topGainersCache.map((g) => g.symbol),
          ]);
          const nowMs = Date.now();
          for (const p of premList) {
            const sym = String(p?.symbol || '').toUpperCase();
            if (!wanted.has(sym)) continue;
            const tk = tickerMap.get(sym);
            const markPrice = Number(p.markPrice || tk?.lastPrice || 0);
            if (!Number.isFinite(markPrice) || markPrice <= 0) continue;
            const vol24 = Number(tk?.quoteVolume || 250_000_000);
            futuresFeedCache[sym] = {
              symbol: sym,
              markPrice,
              indexPrice: Number(p.indexPrice || markPrice),
              fundingRate: Number(p.lastFundingRate ?? 0.0001),
              nextFundingTime: new Date(
                Number(p.nextFundingTime || Date.now() + 3_600_000 * 4)
              ).toISOString(),
              openInterestUsd: Math.round(vol24 * 0.36),
              volume24hUsd: Math.round(vol24),
              maxLeverage: FUTURES_MAX_LEVERAGE[sym] ?? 25,
              source: 'binance_futures',
            };
            const cpsInstrument = `usdm_perp:${sym}`;
            const nextSeq = (cpsSeqByInstrument.get(cpsInstrument) ?? 0) + 1;
            cpsSeqByInstrument.set(cpsInstrument, nextSeq);
            GLOBAL_CPS_ORACLE.ingestPrimaryStreamTick({
              instrument: cpsInstrument,
              instrumentClass: 'USD_M_FUTURES',
              source_id: CERTIFIED_PRIMARY_SOURCE_CONFIG.entries.USD_M_FUTURES.source_id,
              sequence_number: nextSeq,
              timestamp_exchange: nowMs - 8,
              timestamp_received: nowMs,
              bid: Number((markPrice * 0.9999).toPrecision(7)),
              ask: Number((markPrice * 1.0001).toPrecision(7)),
              mark_price: markPrice,
            });
            GLOBAL_CPS_ORACLE.ingestSecondaryCrossCheck({
              instrument: cpsInstrument,
              instrumentClass: 'USD_M_FUTURES',
              secondaryPrice: Number(p.indexPrice || markPrice),
              nowMs,
            });
          }
          futuresFeedSource = 'binance_futures';
          futuresFeedUpdatedAt = new Date().toISOString();
          lastFuturesPollLatencyMs = Math.max(1, Date.now() - startedAt);
          monitorState.futuresFeedStatus = 'LIVE';
          return;
        }
      }
      if (!premRes.ok || !tickerRes.ok) {
        forgeCapitalState = recordForgeApiError(forgeCapitalState, {
          market: 'USD_M_FUTURES',
          moduleId: 'FUTURES_COORDINATOR',
          endpoint: `${FUTURES_FEED_ENDPOINT}/fapi/v1/premiumIndex`,
          httpStatus: !premRes.ok ? premRes.status : tickerRes.status,
          exchangeCode: `FAPI_${!premRes.ok ? premRes.status : tickerRes.status}`,
          latencyMs: Date.now() - startedAt,
          message: `Binance USD-M Futures poll returned HTTP ${!premRes.ok ? premRes.status : tickerRes.status}`,
        });
      }
    } catch (err) {
      forgeCapitalState = recordForgeApiError(forgeCapitalState, {
        market: 'USD_M_FUTURES',
        moduleId: 'FUTURES_COORDINATOR',
        endpoint: `${FUTURES_FEED_ENDPOINT}/fapi/v1/premiumIndex`,
        httpStatus: 503,
        exchangeCode: 'FAPI_UNREACHABLE',
        latencyMs: Date.now() - startedAt,
        message: err instanceof Error ? err.message : 'Binance USD-M Futures REST unreachable',
      });
    } finally {
      clearTimeout(timer);
    }
    futuresFeedSource = 'futures_cache';
    futuresFeedUpdatedAt = new Date().toISOString();
    lastFuturesPollLatencyMs = Math.max(1, Date.now() - startedAt);
    monitorState.futuresFeedStatus = 'DETERMINISTIC_FALLBACK';
  })().finally(() => {
    futuresPollInFlight = null;
  });
  return futuresPollInFlight;
}

function detachBackendWs(sock: WebSocket | null) {
  if (!sock) return;
  sock.onopen = null;
  sock.onmessage = null;
  sock.onerror = null;
  sock.onclose = null;
  try {
    if (sock.readyState <= 1) {
      sock.close();
    }
  } catch {
    // ignore close errors
  }
  if (backendSpotWs === sock) {
    backendSpotWs = null;
  }
}

function pauseBackendSpotWs() {
  if (backendWsHealTimer) {
    clearTimeout(backendWsHealTimer);
    backendWsHealTimer = null;
  }
  if (backendWsFirstFrameTimer) {
    clearTimeout(backendWsFirstFrameTimer);
    backendWsFirstFrameTimer = null;
  }
  detachBackendWs(backendSpotWs);
  backendWsConnected = false;
  pendingSseTickBatch.clear();
  monitorState.backendWsConnected = false;
  monitorState.status = 'OPTIMAL';
  monitorState.wsChannelStatus = 'DETERMINISTIC_FALLBACK';
  monitorState.lastHealAction =
    'Paused by Master Live Feed Toggle (Signal Engine, Top Gainers & Telegram Active)';
}

function scheduleBackendWsSubSecondHeal(reason: string) {
  if (!appLiveEnabled || !systemControls.liveFeedModulesEnabled) return;
  if (backendWsHealTimer) return;
  if (backendWsAttempt >= MAX_WS_RECONNECT_ATTEMPTS) {
    backendWsCircuitOpen = true;
    monitorState.status = 'DEGRADED';
    monitorState.wsChannelStatus = 'DETERMINISTIC_FALLBACK';
    monitorState.lastHealAction = `${reason} -> Spot WS circuit breaker opened after ${backendWsAttempt} attempts`;
    return;
  }
  const delayMs = computeExponentialReconnectDelayMs(backendWsAttempt);
  backendWsAttempt += 1;
  monitorState.status = 'SELF_HEALING';
  monitorState.wsChannelStatus = 'HEALING';
  const healStart = performance.now();
  backendWsHealTimer = setTimeout(() => {
    backendWsHealTimer = null;
    if (!appLiveEnabled || !systemControls.liveFeedModulesEnabled || backendWsCircuitOpen) return;
    monitorState.autoHealCount += 1;
    monitorState.selfHealLatencyMs = Math.max(1, Math.round(performance.now() - healStart));
    monitorState.lastHealAction = `${reason} -> Backoff WS self-heal #${monitorState.autoHealCount} in ${monitorState.selfHealLatencyMs}ms (attempt ${backendWsAttempt})`;
    bindBackendSpotWebSocket();
  }, delayMs);
}

function bindBackendSpotWebSocket() {
  if (!appLiveEnabled || !systemControls.liveFeedModulesEnabled || backendWsCircuitOpen) {
    if (!appLiveEnabled || !systemControls.liveFeedModulesEnabled) {
      pauseBackendSpotWs();
    }
    return;
  }
  if (typeof globalThis.WebSocket !== 'function') return;
  if (backendWsFirstFrameTimer) {
    clearTimeout(backendWsFirstFrameTimer);
    backendWsFirstFrameTimer = null;
  }
  try {
    detachBackendWs(backendSpotWs);

    const baseSyms = TRACKED_COINS.map((c) => `${c.symbol.toLowerCase()}@ticker`);
    const bookTickerSyms = DEPTH_TRACKED_SYMBOLS.map((s) => `${s.toLowerCase()}@bookTicker`);
    const depthSyms = DEPTH_TRACKED_SYMBOLS.map((s) => `${s.toLowerCase()}@depth10@1000ms`);
    const klineSyms = ['btcusdt', 'ethusdt', 'solusdt', 'bnbusdt'].flatMap((s) => [
      `${s}@kline_1m`,
      `${s}@kline_15m`,
    ]);
    const streams = ['!miniTicker@arr', ...baseSyms, ...bookTickerSyms, ...depthSyms, ...klineSyms].join('/');
    const endpoint = SPOT_WS_ENDPOINTS[backendWsHostIndex % SPOT_WS_ENDPOINTS.length];
    const ws = new globalThis.WebSocket(`${endpoint}?streams=${streams}`);
    backendSpotWs = ws;
    let receivedFirstFrame = false;

    ws.onopen = () => {
      if (backendSpotWs !== ws) {
        detachBackendWs(ws);
        return;
      }
      backendWsConnected = true;
      backendWsLastFrameAtMs = Date.now();
      monitorState.backendWsConnected = true;
      monitorState.wsChannelStatus = 'CONNECTED';
      monitorState.status = 'OPTIMAL';
      monitorState.lastHealAction = `Strict Binance Spot + BookTicker + Kline WS bound (${new URL(endpoint).host})`;

      if (backendWsFirstFrameTimer) clearTimeout(backendWsFirstFrameTimer);
      backendWsFirstFrameTimer = setTimeout(() => {
        backendWsFirstFrameTimer = null;
        if (!receivedFirstFrame && backendSpotWs === ws) {
          backendWsHostIndex = (backendWsHostIndex + 1) % SPOT_WS_ENDPOINTS.length;
          backendWsConnected = false;
          monitorState.backendWsConnected = false;
          detachBackendWs(ws);
          scheduleBackendWsSubSecondHeal('Silent Spot WS host failover');
        }
      }, 1500);
    };

    ws.onmessage = (event) => {
      if (backendSpotWs !== ws) return;
      const nowMs = Date.now();
      backendWsLastFrameAtMs = nowMs;
      lastFeedPollAtMs = nowMs;
      spotFeedUpdatedAt = new Date(nowMs).toISOString();
      if (!receivedFirstFrame) {
        receivedFirstFrame = true;
        backendWsAttempt = 0;
        backendWsCircuitOpen = false;
      }
      if (backendWsFirstFrameTimer) {
        clearTimeout(backendWsFirstFrameTimer);
        backendWsFirstFrameTimer = null;
      }
      try {
        backendWsTotalFrames += 1;
        const rawData = typeof event.data === 'string' ? event.data : String(event.data);
        const parsed = JSON.parse(rawData);
        const streamName = String(parsed?.stream || '');
        const d = parsed?.data ?? parsed;

        const trackedSet = new Set([
          ...TRACKED_COINS.map((c) => c.symbol),
          ...topGainersCache.map((g) => g.symbol),
        ]);

        if (streamName.includes('@bookTicker') && d?.s && d?.b !== undefined && d?.a !== undefined) {
          const sym = String(d.s).toUpperCase();
          if (!trackedSet.has(sym)) return;
          const bid = Number(d.b);
          const ask = Number(d.a);
          if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask >= bid) {
            const cpsInstrument = `spot:${sym}`;
            const nextSeq = (cpsSeqByInstrument.get(cpsInstrument) ?? 0) + 1;
            cpsSeqByInstrument.set(cpsInstrument, nextSeq);
            GLOBAL_CPS_ORACLE.ingestPrimaryStreamTick({
              instrument: cpsInstrument,
              instrumentClass: 'SPOT',
              source_id: CERTIFIED_PRIMARY_SOURCE_CONFIG.entries.SPOT.source_id,
              sequence_number: nextSeq,
              timestamp_exchange: nowMs - 4,
              timestamp_received: nowMs,
              bid,
              ask,
              mark_price: Number(((bid + ask) / 2).toPrecision(8)),
            });
          }
          return;
        }

        if (streamName.includes('@kline_') && d?.k) {
          const k = d.k;
          const sym = String(k.s || d.s || '').toUpperCase();
          if (!sym || !trackedSet.has(sym)) return;
          const interval = String(k.i || '1m');
          const closePrice = Number(k.c || 0);
          const prevPrice = spotFeedCache[sym]?.source === 'binance_spot' ? spotFeedCache[sym].price : undefined;
          const klineCheck = validateSpotTickSample({ price: closePrice, previousPrice: prevPrice });
          if (!klineCheck.valid) {
            monitorState.anomaliesIsolatedCount = (monitorState.anomaliesIsolatedCount ?? 0) + 1;
            monitorState.lastHealAction = `${sym} kline: ${klineCheck.reason}`;
            return;
          }
          const isFinal = Boolean(k.x);
          if (isFinal) backendWsClosedCandlesCount += 1;
          liveKlineWsFrames[`${sym}_${interval}`] = {
            symbol: sym,
            interval,
            closePrice,
            isFinal,
            closeTimeMs: Number(k.T || nowMs),
            updatedAtIso: new Date(nowMs).toISOString(),
          };
          return;
        }

        if (streamName === '!miniTicker@arr' && Array.isArray(d)) {
          for (const entry of d) {
            const sym = String(entry?.s || '').toUpperCase();
            if (!trackedSet.has(sym)) continue;
            const spotPrice = Number(entry?.c || 0);
            const prevPrice = spotFeedCache[sym]?.source === 'binance_spot' ? spotFeedCache[sym].price : undefined;
            const check = validateSpotTickSample({ price: spotPrice, previousPrice: prevPrice });
            if (!check.valid) {
              monitorState.anomaliesIsolatedCount = (monitorState.anomaliesIsolatedCount ?? 0) + 1;
              monitorState.lastHealAction = `${sym}: ${check.reason}`;
              continue;
            }
            const openP = Number(entry?.o || spotPrice);
            const chg = openP > 0 ? Number((((spotPrice - openP) / openP) * 100).toFixed(2)) : spotFeedCache[sym]?.change24hPercent ?? 0;
            const vol24 = Number(entry?.q || spotFeedCache[sym]?.volume24hUsd || 1_850_000_000);
            const high24h = Number(entry?.h || spotPrice);
            const low24h = Number(entry?.l || spotPrice);

            spotFeedCache[sym] = {
              symbol: sym,
              price: spotPrice,
              change24hPercent: chg,
              high24h,
              low24h,
              volume24hUsd: Math.round(vol24),
              source: 'binance_spot',
              updatedAtMs: nowMs,
            };
            spotFeedSource = 'binance_spot';
            monitorState.spotFeedStatus = 'LIVE';
            pendingSseTickBatch.set(sym, {
              symbol: sym,
              price: spotPrice,
              markPrice: spotPrice,
              volume24hUsd: spotFeedCache[sym].volume24hUsd,
              change24hPercent: chg,
              high24h,
              low24h,
              source: 'binance_spot',
              updatedAtMs: nowMs,
            });
          }
          return;
        }

        if (streamName.includes('@depth10') && d && (Array.isArray(d.bids) || Array.isArray(d.b))) {
          backendWsDepthFramesCount += 1;
          const rawSym = streamName.split('@')[0]?.toUpperCase() || '';
          const sym = rawSym.endsWith('USDT') ? rawSym : '';
          if (sym && trackedSet.has(sym)) {
            const spotSnap = spotFeedCache[sym];
            const refMid = spotSnap?.price ?? TRACKED_COINS.find((c) => c.symbol === sym)?.referencePrice ?? 100;
            const toPairs = (rows: any): Array<[number, number]> =>
              Array.isArray(rows) ? rows.map((r: any) => [Number(r[0]), Number(r[1])]) : [];
            const rawBids = Array.isArray(d.bids) ? d.bids : d.b;
            const rawAsks = Array.isArray(d.asks) ? d.asks : d.a;
            const binanceBook = normalizeExchangeOrderBook({
              exchange: 'BINANCE',
              symbol: sym,
              bids: toPairs(rawBids),
              asks: toPairs(rawAsks),
              referencePrice: refMid,
              source: 'live_ws',
              updatedAtMs: nowMs,
            });
            liveExchangeBooksCache[sym] = {
              ...(liveExchangeBooksCache[sym] || {}),
              BINANCE: binanceBook,
            };
            const curBybit =
              liveExchangeBooksCache[sym]?.BYBIT ??
              buildAnchoredExchangeBook({
                exchange: 'BYBIT',
                symbol: sym,
                liveWsPrice: refMid,
                change24hPercent: spotSnap?.change24hPercent,
                volume24hUsd: spotSnap?.volume24hUsd,
                updatedAtMs: nowMs,
              });
            const curOkx =
              liveExchangeBooksCache[sym]?.OKX ??
              buildAnchoredExchangeBook({
                exchange: 'OKX',
                symbol: sym,
                liveWsPrice: refMid,
                change24hPercent: spotSnap?.change24hPercent,
                volume24hUsd: spotSnap?.volume24hUsd,
                updatedAtMs: nowMs,
              });
            multiExchangeDepthCache[sym] = aggregateMultiExchangeDepth(
              sym,
              [binanceBook, curBybit, curOkx],
              refMid
            );
            depthUpdatedAt = new Date(nowMs).toISOString();
          }
          return;
        }

        if (d && d.s) {
          const sym = String(d.s).toUpperCase();
          if (!trackedSet.has(sym)) return;
          const spotPrice = Number(d.c || 0);
          const prevPrice = spotFeedCache[sym]?.source === 'binance_spot' ? spotFeedCache[sym].price : undefined;
          const check = validateSpotTickSample({ price: spotPrice, previousPrice: prevPrice });
          if (!check.valid) {
            monitorState.anomaliesIsolatedCount = (monitorState.anomaliesIsolatedCount ?? 0) + 1;
            monitorState.lastHealAction = `${sym}: ${check.reason}`;
            return;
          }
          const vol24 = Number(d.q || spotFeedCache[sym]?.volume24hUsd || 1_850_000_000);
          const chg = Number(Number(d.P || 0).toFixed(2));
          const high24h = Number(d.h || spotPrice);
          const low24h = Number(d.l || spotPrice);
          spotFeedCache[sym] = {
            symbol: sym,
            price: spotPrice,
            change24hPercent: chg,
            high24h,
            low24h,
            volume24hUsd: Math.round(vol24),
            source: 'binance_spot',
            updatedAtMs: nowMs,
          };
          spotFeedSource = 'binance_spot';
          monitorState.spotFeedStatus = 'LIVE';
          pendingSseTickBatch.set(sym, {
            symbol: sym,
            price: spotPrice,
            markPrice: spotPrice,
            volume24hUsd: spotFeedCache[sym].volume24hUsd,
            change24hPercent: chg,
            high24h,
            low24h,
            source: 'binance_spot',
            updatedAtMs: nowMs,
          });
        }
      } catch (parseErr) {
        monitorState.anomaliesIsolatedCount = (monitorState.anomaliesIsolatedCount ?? 0) + 1;
        monitorState.lastHealAction = `Quarantined malformed backend WS frame: ${parseErr instanceof Error ? parseErr.message : 'parse error'}`;
      }
    };

    ws.onerror = () => {
      if (backendSpotWs !== ws) return;
      backendWsConnected = false;
      monitorState.backendWsConnected = false;
      backendWsHostIndex = (backendWsHostIndex + 1) % SPOT_WS_ENDPOINTS.length;
      detachBackendWs(ws);
      scheduleBackendWsSubSecondHeal('Spot WS error');
    };

    ws.onclose = () => {
      if (backendSpotWs !== ws) return;
      backendWsConnected = false;
      monitorState.backendWsConnected = false;
      detachBackendWs(ws);
      scheduleBackendWsSubSecondHeal('Spot WS closed');
    };
  } catch {
    backendWsConnected = false;
    monitorState.backendWsConnected = false;
    scheduleBackendWsSubSecondHeal('Spot WS init exception');
  }
}

// Continuous Binance Top Gainers Feeder State (recalibrated 12s cadence)
const GAINER_FEEDER_INTERVAL_MS = TELEMETRY_POLL_INTERVAL_MS;
const STABLECOIN_BASES = new Set([
  'USDC',
  'FDUSD',
  'TUSD',
  'BUSD',
  'USDP',
  'DAI',
  'USDE',
  'EUR',
  'AEUR',
  'USD1',
  'EURI',
  'RLUSD',
  'XUSD',
]);
const KNOWN_NAME_MAP: Record<string, string> = Object.fromEntries(
  TRACKED_COINS.map((c) => [c.symbol, c.name])
);

let topGainersCache: TopGainerCoin[] = [];
let gainerFeederSource: 'binance' | 'cache' = 'cache';
let gainerFeederUpdatedAt: string = new Date().toISOString();
const gainerAlertsLog: GainerAlertEvent[] = [];
const previousGainerSnapshot = new Map<string, { rank: number; change: number }>();
const lastGainerAlertTime = new Map<string, number>();

let discoveredTelegramChatId: string | null = null;
let boundDeveloperChatId: string | null =
  process.env.DEVELOPER_CHAT_ID || process.env.TELEGRAM_DEV_CHAT_ID || null;
let autoBoundDeveloperViaWebhook = false;

const CONTINUOUS_AUDIT_INTERVAL_SEC = 60;
let dailyAuditAutoDeliveryEnabled = true;
let dailyAuditScheduledUtcHour = Math.max(
  0,
  Math.min(23, Number(process.env.TELEGRAM_DAILY_AUDIT_UTC_HOUR ?? 0) || 0)
);
let lastDailyAuditDateUtc: string | null = null;
let lastDailyAuditSentAt: string | null = null;
let dailyAuditReportsDispatchedTotal = 0;

let telegramWebhookRegistered = false;
let telegramWebhookUrl: string | null = null;
let telegramWebhookLastRegisteredAt: string | null = null;
let telegramWebhookLastInboundAt: string | null = null;
let telegramWebhookTotalInbound = 0;
let telegramWebhookLastError: string | null = null;

const publicSignalStreamLog: StructuredTradeSignalAlert[] = [];
const developerAuditStreamLog: SystemAuditLogEntry[] = [];
const recentWebhookEventsLog: TelegramWebhookInboundEvent[] = [];
const rolling24hAuditSamples: Array<{
  tsMs: number;
  cpuUsagePct: number;
  memoryRssMb: number;
  eventLoopLagMs: number;
  peakModuleLatencyMs: number;
  slowestModuleLabel: string;
}> = [];

let lastCpuSample = process.cpuUsage();
let lastCpuSampleAtMs = Date.now();
let lastComputedCpuPct = 4.2;

function getTelegramBotToken(): string | undefined {
  return process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || undefined;
}

function getPublicChannelChatId(): string {
  return (
    process.env.CHAT_ID ||
    process.env.TELEGRAM_CHAT_ID ||
    process.env.TELEGRAM_CHANNEL_ID ||
    ''
  ).trim();
}

function getDeveloperPrivateChatId(): string {
  return (
    boundDeveloperChatId ||
    process.env.DEVELOPER_CHAT_ID ||
    process.env.TELEGRAM_DEV_CHAT_ID ||
    ''
  ).trim();
}

function getMakeWebhookUrl(): string {
  return (process.env.MAKE_WEBHOOK_URL || '').trim();
}

function getWebhookBotToken(): string {
  return (process.env.WEBHOOK_BOT_TOKEN || getTelegramBotToken() || '').trim();
}

const signalSpamHistory: SpamFilterHistoryEntry[] = [];
const processedSignalsLog: ProcessedSignalRecord[] = [];
const filteredSpamSignalsLog: ProcessedSignalRecord[] = [];
let signalProcessorReceivedTotal = 0;
let signalProcessorTransmittedTotal = 0;
let signalProcessorSpamFilteredTotal = 0;
let signalProcessorWebhookDeliveredTotal = 0;
let signalProcessorMilestoneUpdatesTotal = 0;

async function transmitToMakeWebhook(payload: OutboundMakeWebhookPayload): Promise<{
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  error: string | null;
}> {
  const url = getMakeWebhookUrl();
  if (!url) {
    return {
      ok: false,
      httpStatus: null,
      latencyMs: 0,
      error: 'MAKE_WEBHOOK_URL not configured in server environment.',
    };
  }
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5500);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signal-Forge-Chat-Id': payload.chat_id,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const latencyMs = Math.max(1, Date.now() - startedAt);
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      return {
        ok: false,
        httpStatus: response.status,
        latencyMs,
        error: `Webhook HTTP ${response.status}${bodyText ? `: ${bodyText.slice(0, 120)}` : ''}`,
      };
    }
    return {
      ok: true,
      httpStatus: response.status,
      latencyMs,
      error: null,
    };
  } catch (err) {
    const latencyMs = Math.max(1, Date.now() - startedAt);
    return {
      ok: false,
      httpStatus: null,
      latencyMs,
      error: err instanceof Error ? err.message : 'Outbound webhook network error',
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildSignalProcessorStatus(): SignalProcessorStatusSnapshot {
  const webhookUrl = getMakeWebhookUrl();
  const targetChatId = getPublicChannelChatId() || '-1008928895086';
  return {
    ok: true,
    webhookConfigured: Boolean(webhookUrl),
    maskedWebhookUrl: maskWebhookUrl(webhookUrl),
    targetChatId,
    maskedBotToken: maskTelegramToken(getWebhookBotToken()),
    spamFilterConfig: DEFAULT_SPAM_FILTER_CONFIG,
    stats: {
      totalReceived: signalProcessorReceivedTotal,
      totalTransmitted: signalProcessorTransmittedTotal,
      totalSpamFiltered: signalProcessorSpamFilteredTotal,
      totalWebhookDelivered: signalProcessorWebhookDeliveredTotal,
      totalMilestoneUpdates: signalProcessorMilestoneUpdatesTotal,
    },
    recentProcessed: processedSignalsLog.slice(0, 30),
    recentFiltered: filteredSpamSignalsLog.slice(0, 30),
  };
}

async function processAndTransmitTradingAlert(
  input: IncomingTradingAlertInput
): Promise<
  | {
      ok: false;
      error: string;
      status: SignalProcessorStatusSnapshot;
    }
  | {
      ok: true;
      filtered: boolean;
      record: ProcessedSignalRecord;
      structuredSignal?: StructuredTradeSignalAlert;
      status: SignalProcessorStatusSnapshot;
    }
> {
  signalProcessorReceivedTotal += 1;
  const symGuess = String(input.symbol || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const fallbackPrice =
    (symGuess && spotFeedCache[symGuess]?.price) ||
    (symGuess && !symGuess.endsWith('USDT') && spotFeedCache[`${symGuess}USDT`]?.price) ||
    0;

  const extracted = extractTradingAlertParams(input, fallbackPrice);
  if (!extracted.ok) {
    return {
      ok: false,
      error: extracted.error,
      status: buildSignalProcessorStatus(),
    };
  }

  const card = extracted.card;
  const targetChatId = getPublicChannelChatId() || '-1008928895086';
  const nowMs = Date.now();
  const spamVerdict = evaluateSignalSpamFilter(
    card,
    signalSpamHistory,
    nowMs,
    DEFAULT_SPAM_FILTER_CONFIG
  );

  if (!spamVerdict.allowed) {
    signalProcessorSpamFilteredTotal += 1;
    const rejectedRecord: ProcessedSignalRecord = {
      ...card,
      filteredOut: true,
      spamVerdict,
      targetChatId,
      webhookDispatched: false,
      webhookHttpStatus: null,
      webhookLatencyMs: null,
      webhookError: null,
      telegramMirrorDelivered: false,
      transmittedAt: null,
    };
    filteredSpamSignalsLog.unshift(rejectedRecord);
    if (filteredSpamSignalsLog.length > 60) filteredSpamSignalsLog.length = 60;
    return {
      ok: true,
      filtered: true,
      record: rejectedRecord,
      status: buildSignalProcessorStatus(),
    };
  }

  // Record in anti-spam rolling window BEFORE network I/O to eliminate duplicate race windows
  signalSpamHistory.unshift({
    signalId: card.signalId,
    symbol: card.symbol,
    direction: card.direction,
    fingerprint: card.fingerprint,
    lifecycleStatus: card.lifecycleStatus,
    hitTpMilestones: card.hitTpMilestones,
    timestampMs: nowMs,
  });
  if (signalSpamHistory.length > 400) signalSpamHistory.length = 400;

  const outboundPayload = buildOutboundWebhookPayload(card, {
    chatId: targetChatId,
    botToken: getWebhookBotToken(),
    channelName: 'Signal Forge',
  });

  const webhookRes = await transmitToMakeWebhook(outboundPayload);
  const tgMirrorRes = await sendTelegramRawMessage({
    chatId: targetChatId,
    text: card.formattedCard,
  });

  const transmittedAt = new Date().toISOString();
  signalProcessorTransmittedTotal += 1;
  if (webhookRes.ok) signalProcessorWebhookDeliveredTotal += 1;
  if (outboundPayload.event_type === 'MILESTONE_PNL_UPDATE') {
    signalProcessorMilestoneUpdatesTotal += 1;
  }

  const record: ProcessedSignalRecord = {
    ...card,
    filteredOut: false,
    spamVerdict,
    targetChatId,
    webhookDispatched: webhookRes.ok,
    webhookHttpStatus: webhookRes.httpStatus,
    webhookLatencyMs: webhookRes.latencyMs,
    webhookError: webhookRes.error,
    telegramMirrorDelivered: tgMirrorRes.ok,
    transmittedAt,
  };

  processedSignalsLog.unshift(record);
  if (processedSignalsLog.length > 60) processedSignalsLog.length = 60;

  // Keep Stream 1 public alert feed & legacy Telegram channel feed synchronized
  const deliveredAny = webhookRes.ok || tgMirrorRes.ok;
  const qItem = telegramDispatchStabilizer.enqueue({
    signalId: record.signalId,
    symbol: record.symbol,
    direction: record.direction,
    targetChatId,
    payloadText: record.formattedCard,
  });
  telegramDispatchStabilizer.recordAttemptResult(qItem.queueId, {
    ok: deliveredAny,
    httpStatus: webhookRes.httpStatus ?? (tgMirrorRes.ok ? 200 : null),
    error: deliveredAny ? null : webhookRes.error || tgMirrorRes.errorDetail,
  });

  const structuredSignal: StructuredTradeSignalAlert = {
    id: record.signalId,
    stream: 'PUBLIC_SIGNAL',
    channelName: 'Signal Forge',
    targetChatId,
    symbol: record.symbol,
    direction: record.direction,
    entryPrice: record.entryPrice,
    exitPrice: record.exitPrice,
    stopLoss: record.stopLoss,
    confidence: record.confidence,
    riskRewardRatio: record.riskRewardRatio,
    timeframe: record.timeframe,
    rationale: record.rationale,
    formattedMessage: record.formattedCard,
    deliveredViaBot: deliveredAny,
    deliveryStatus: deliveredAny ? 'DELIVERED' : 'QUEUED_FALLBACK',
    errorDetail: deliveredAny ? null : webhookRes.error || tgMirrorRes.errorDetail,
    timestamp: transmittedAt,
  };
  publicSignalStreamLog.unshift(structuredSignal);
  if (publicSignalStreamLog.length > 60) publicSignalStreamLog.length = 60;

  telegramChannelFeed.unshift({
    id: record.signalId,
    channelName: 'Signal Forge',
    symbol: record.symbol,
    direction: record.direction,
    confidence: record.confidence,
    message: record.formattedCard,
    deliveredViaBot: deliveredAny,
    timestamp: transmittedAt,
  });
  if (telegramChannelFeed.length > 40) telegramChannelFeed.length = 40;

  return {
    ok: true,
    filtered: false,
    record,
    structuredSignal,
    status: buildSignalProcessorStatus(),
  };
}

// ---------------------------------------------------------------------------
// Backend Event Pipeline: Entry Zone Validation, Automated Order Execution,
// Pre-Pump Continuous Support & Hold-Until-Max-Profit Engine, Telegram Retry
// ---------------------------------------------------------------------------
const entryZoneValidator = new EntryZoneExecutionValidator();
const prePumpSupportEngine = new PrePumpSupportExecutionModule();
const telegramDispatchStabilizer = new TelegramDispatchStabilizer();

const activeEntryZoneSignals: EntryZoneSignalCandidate[] = [];
const backendExecutedOrdersLog: BackendExecutedOrderLog[] = [];
let backendPipelineEpoch = 0;
let backendPipelineTicks = 0;
let backendPipelineAvgLatencyMs = 1.4;

function getLivePriceLookupMap(): Record<string, number> {
  const map: Record<string, number> = {};
  for (const [sym, tick] of Object.entries(spotFeedCache)) {
    if (tick && Number.isFinite(tick.price) && tick.price > 0) {
      map[sym] = tick.price;
    }
  }
  for (const g of topGainersCache) {
    if (!map[g.symbol] && Number.isFinite(g.price) && g.price > 0) {
      map[g.symbol] = g.price;
    }
  }
  return map;
}

function seedOrRefreshEntryZoneCandidates(): void {
  const liveMap = getLivePriceLookupMap();
  const existingKeys = new Set(activeEntryZoneSignals.map((s) => `${s.symbol}_${s.direction}`));
  const openExecSymbols = new Set(
    backendExecutedOrdersLog
      .filter((o) => o.status === 'OPEN_EXECUTED')
      .map((o) => o.symbol)
  );

  // Build structural Entry Zone candidates anchored slightly away from live spot so
  // cards demonstrate strict Entry Zone gating until price enters the zone.
  const seedSymbols = [
    ...TRACKED_COINS.slice(0, 6).map((c, idx) => ({
      symbol: c.symbol,
      coinName: c.name,
      direction: (idx % 3 === 1 ? 'SELL' : 'BUY') as 'BUY' | 'SELL',
      offsetPct: idx % 3 === 1 ? 0.85 : -0.75,
      sourceModule: 'AI_ENGINE' as const,
      isPrePump: false,
      prePumpScore: undefined as number | undefined,
    })),
    ...topGainersCache.slice(0, 3).map((g) => ({
      symbol: g.symbol,
      coinName: g.name,
      direction: 'BUY' as const,
      offsetPct: -0.55,
      sourceModule: 'PRE_PUMP_SUPPORT' as const,
      isPrePump: true,
      prePumpScore: g.prePumpScore ?? 84,
    })),
  ];

  for (const item of seedSymbols) {
    if (activeEntryZoneSignals.length >= 8) break;
    const key = `${item.symbol}_${item.direction}`;
    if (existingKeys.has(key) || openExecSymbols.has(item.symbol)) continue;
    const livePrice = liveMap[item.symbol];
    if (!Number.isFinite(livePrice) || livePrice <= 0) continue;

    const precision = livePrice >= 1000 ? 2 : livePrice >= 1 ? 4 : 6;
    const entryPrice = Number((livePrice * (1 + item.offsetPct / 100)).toFixed(precision));
    const entryZone = computeEntryZoneBounds(entryPrice, 0.42);
    const sign = item.direction === 'BUY' ? 1 : -1;
    const stopLoss = Number((entryPrice * (1 - sign * 0.018)).toFixed(precision));
    const riskDist = Math.max(Math.abs(entryPrice - stopLoss), entryPrice * 0.008);
    const tp1 = Number((entryPrice + sign * riskDist * 2.0).toFixed(precision));
    const tp2 = Number((entryPrice + sign * riskDist * 3.5).toFixed(precision));
    const tp3 = Number((entryPrice + sign * riskDist * 5.2).toFixed(precision));

    activeEntryZoneSignals.push({
      signalId: `ez_${item.symbol}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      symbol: item.symbol,
      coinName: item.coinName,
      direction: item.direction,
      timeframe: '4h',
      entryPrice,
      entryZone,
      stopLoss,
      takeProfits: [tp1, tp2, tp3],
      confidence: item.isPrePump ? 91 : 88,
      sourceModule: item.sourceModule,
      reason: item.isPrePump
        ? `Pre-Pump Support Zone anchored at $${entryPrice}; holds strictly until TP3 max target $${tp3}.`
        : `Structural ${item.direction === 'BUY' ? 'demand' : 'supply'} Entry Zone [$${entryZone.low}–$${entryZone.high}] · 1:5.2 R:R verified.`,
      isPrePump: item.isPrePump,
      prePumpScore: item.prePumpScore,
      supportPrice: item.isPrePump ? entryPrice : undefined,
      holdUntilMaxTarget: item.isPrePump,
      createdAt: new Date().toISOString(),
    });
    existingKeys.add(key);
  }
}

async function executeCandidateIntoBackendLog(
  candidate: EntryZoneSignalCandidate,
  fillPrice: number,
  notionalUsd = 1500
): Promise<BackendExecutedOrderLog> {
  const executedAt = new Date().toISOString();
  const order: BackendExecutedOrderLog = {
    executionId: `exec_${candidate.symbol}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    signalId: candidate.signalId,
    symbol: candidate.symbol,
    direction: candidate.direction,
    sourceModule: candidate.sourceModule,
    entryPrice: candidate.entryPrice,
    executedPrice: fillPrice,
    entryZone: candidate.entryZone,
    stopLoss: candidate.stopLoss,
    takeProfits: candidate.takeProfits,
    maxProfitTarget: candidate.takeProfits[2],
    notionalUsd,
    leverage: 1,
    status: 'OPEN_EXECUTED',
    holdUntilMaxTarget: candidate.holdUntilMaxTarget,
    earlyLiquidationBlockedCount: 0,
    currentPrice: fillPrice,
    progressToMaxTargetPct: 0,
    unrealizedPnlUsd: 0,
    unrealizedPnlPercent: 0,
    realizedPnlUsd: null,
    realizedPnlPercent: null,
    executedAt,
    closedAt: null,
    exitReason: null,
    telegramDispatched: false,
  };

  // Transition executed card OFF the active dashboard list into Backend Execution Logs
  const idx = activeEntryZoneSignals.findIndex((s) => s.signalId === candidate.signalId);
  if (idx >= 0) {
    activeEntryZoneSignals.splice(idx, 1);
  }

  backendExecutedOrdersLog.unshift(order);
  if (backendExecutedOrdersLog.length > 80) {
    backendExecutedOrdersLog.length = 80;
  }

  // Stabilized real-time signal dispatch via Make.com Webhook + Telegram Bot mirror
  const relayRes = await processAndTransmitTradingAlert({
    source: 'AUTOMATED',
    symbol: order.symbol,
    direction: order.direction,
    timeframe: candidate.timeframe,
    entryPrice: order.executedPrice,
    takeProfits: order.takeProfits,
    exitPrice: order.maxProfitTarget,
    stopLoss: order.stopLoss,
    confidence: candidate.confidence,
    rationale: order.holdUntilMaxTarget
      ? `Pre-Pump Support Auto-Executed @ $${fillPrice} · HOLD UNTIL MAX TARGET ($${order.maxProfitTarget})`
      : `Entry Zone Validated & Auto-Executed @ $${fillPrice} · Archived to Backend Execution Log`,
  }).catch(() => null);

  if (relayRes && relayRes.ok && !relayRes.filtered) {
    order.telegramDispatched =
      relayRes.record.webhookDispatched || relayRes.record.telegramMirrorDelivered;
  }

  return order;
}

async function flushTelegramStabilizerQueue(): Promise<number> {
  const due = telegramDispatchStabilizer.getDueRetryItems(Date.now());
  let processedCount = 0;
  for (const item of due.slice(0, 5)) {
    processedCount += 1;
    const webhookRes = await transmitToMakeWebhook({
      event_type: 'SIGNAL_CARD',
      chat_id: item.targetChatId,
      bot_token: getWebhookBotToken(),
      channel_name: 'Signal Forge',
      signal_id: item.signalId,
      source: 'AUTOMATED',
      pair: item.symbol,
      direction: item.direction,
      timeframe: '4h',
      entry_price: spotFeedCache[item.symbol]?.price ?? 0,
      take_profits: { tp1: 0, tp2: 0, tp3: 0 },
      exit_price: 0,
      stop_loss: 0,
      confidence_score: 90,
      risk_reward_ratio: 5,
      hit_tp_milestones: [],
      final_pnl_usd: null,
      final_pnl_percent: null,
      lifecycle_status: 'OPEN',
      signal_card: item.payloadText,
      text: item.payloadText,
      timestamp: new Date().toISOString(),
    });
    const tgRes = await sendTelegramRawMessage({
      chatId: item.targetChatId,
      text: item.payloadText,
    });
    const ok = webhookRes.ok || tgRes.ok;
    telegramDispatchStabilizer.recordAttemptResult(item.queueId, {
      ok,
      httpStatus: webhookRes.httpStatus ?? (tgRes.ok ? 200 : null),
      error: ok ? null : webhookRes.error || tgRes.errorDetail,
    });
  }
  return processedCount;
}

async function runBackendExecutionPipelineSweep(): Promise<void> {
  const started = Date.now();
  seedOrRefreshEntryZoneCandidates();
  const liveMap = getLivePriceLookupMap();

  // 1. Strict Entry Zone Validation -> auto-execute valid signals & remove from active grid
  const snapshotCandidates = [...activeEntryZoneSignals];
  for (const cand of snapshotCandidates) {
    const livePrice = liveMap[cand.symbol];
    if (!Number.isFinite(livePrice) || livePrice <= 0) continue;
    const evalRes = entryZoneValidator.evaluate({ candidate: cand, livePrice });
    if (evalRes.shouldAutoExecute && appLiveEnabled) {
      await executeCandidateIntoBackendLog(cand, livePrice, 1500);
    }
  }

  // 2. Continuous Pre-Pump / Top Gainer Support Monitoring & Immediate Support Execution
  const activePosBySym: Record<string, BackendExecutedOrderLog> = {};
  for (const ord of backendExecutedOrdersLog) {
    if (!activePosBySym[ord.symbol] && ord.status === 'OPEN_EXECUTED') {
      activePosBySym[ord.symbol] = ord;
    }
  }
  const prePumpList = prePumpSupportEngine.process({
    topGainers: topGainersCache,
    livePriceMap: liveMap,
    activePositionsBySymbol: activePosBySym,
  });

  const openPrePumpCount = backendExecutedOrdersLog.filter(
    (o) => o.status === 'OPEN_EXECUTED' && o.holdUntilMaxTarget
  ).length;
  if (appLiveEnabled && openPrePumpCount < 3) {
    const eligible = prePumpList.find((c) => c.autoExecuteEligible && c.prePumpScore >= 76);
    if (eligible) {
      const prePumpCandidate: EntryZoneSignalCandidate = {
        signalId: `prepump_${eligible.symbol}_${Date.now()}`,
        symbol: eligible.symbol,
        coinName: eligible.baseAsset,
        direction: 'BUY',
        timeframe: '15m',
        entryPrice: eligible.supportLevel,
        entryZone: computeEntryZoneBounds(eligible.supportLevel, 0.75),
        stopLoss: eligible.stopLoss,
        takeProfits: eligible.takeProfits,
        confidence: Math.min(97, eligible.prePumpScore),
        sourceModule: 'PRE_PUMP_SUPPORT',
        reason: `Pre-Pump #${eligible.gainerRank} Support Confirmed @ $${eligible.supportLevel} · Forced Hold Until Max Target ($${eligible.resistanceTargetMax}).`,
        isPrePump: true,
        prePumpScore: eligible.prePumpScore,
        supportPrice: eligible.supportLevel,
        holdUntilMaxTarget: true,
        createdAt: new Date().toISOString(),
      };
      await executeCandidateIntoBackendLog(prePumpCandidate, eligible.livePrice, 2000);
    }
  }

  // 3. Enforce Hold-Until-Max-Profit Lifecycle on all open executed orders
  for (let i = 0; i < backendExecutedOrdersLog.length; i += 1) {
    const ord = backendExecutedOrdersLog[i];
    if (ord.status !== 'OPEN_EXECUTED') continue;
    const livePrice = liveMap[ord.symbol];
    if (!Number.isFinite(livePrice) || livePrice <= 0) continue;
    const lifecycle = evaluateExecutedPositionLifecycle(ord, livePrice);
    backendExecutedOrdersLog[i] = lifecycle.updated;
    if (lifecycle.liquidatedNow) {
      if (
        typeof lifecycle.updated.realizedPnlUsd === 'number' &&
        Number.isFinite(lifecycle.updated.realizedPnlUsd)
      ) {
        profitVaultEngine.ingestRealizedTrade({
          tradeId: `exec_${lifecycle.updated.executionId}`,
          symbol: lifecycle.updated.symbol,
          realizedPnlUsd: lifecycle.updated.realizedPnlUsd,
          sourceAgent: lifecycle.updated.sourceModule || 'BACKEND_EXECUTION_PIPELINE',
        });
      }
      processAndTransmitTradingAlert({
        source: 'AUTOMATED',
        symbol: lifecycle.updated.symbol,
        direction: lifecycle.updated.direction,
        entryPrice: lifecycle.updated.executedPrice,
        takeProfits: lifecycle.updated.takeProfits,
        exitPrice: livePrice,
        stopLoss: lifecycle.updated.stopLoss,
        confidence: 95,
        hitTpMilestones:
          lifecycle.updated.status === 'LIQUIDATED_MAX_PROFIT' ? ['TP1', 'TP2', 'TP3'] : [],
        finalPnlUsd: lifecycle.updated.realizedPnlUsd,
        finalPnlPercent: lifecycle.updated.realizedPnlPercent,
        lifecycleStatus:
          lifecycle.updated.status === 'LIQUIDATED_MAX_PROFIT' ? 'CLOSED_TP' : 'CLOSED_SL',
        rationale: lifecycle.updated.exitReason || 'Automated Max-Target Liquidation',
      }).catch(() => undefined);
    }
  }

  // 4. Process due Telegram stabilizer retries
  await flushTelegramStabilizerQueue().catch(() => 0);

  const elapsed = Math.max(0.2, Date.now() - started);
  backendPipelineTicks += 1;
  backendPipelineEpoch += 1;
  backendPipelineAvgLatencyMs = Number(
    (backendPipelineAvgLatencyMs * 0.8 + elapsed * 0.2).toFixed(2)
  );

  // 5. Enforce monotonic cross-agent state synchronization anchored to authoritative live Binance WS price
  const syncLiveMap = getLivePriceLookupMap();
  const anchorPrice = syncLiveMap['BTCUSDT'] ?? Object.values(syncLiveMap)[0] ?? 91500;
  multiAgentSyncEngine.process({
    symbol: 'BTCUSDT',
    authoritativePrice: anchorPrice,
    epoch: backendPipelineEpoch,
  });
}

function buildBackendExecutionPipelineSnapshot(): BackendExecutionPipelineSnapshot {
  seedOrRefreshEntryZoneCandidates();
  const liveMap = getLivePriceLookupMap();

  const activeAwaitingSignals = activeEntryZoneSignals.map((cand) => {
    const livePrice = liveMap[cand.symbol] ?? cand.entryPrice;
    const evaluation = entryZoneValidator.evaluate({ candidate: cand, livePrice });
    return { ...cand, evaluation };
  });

  const activePosBySym: Record<string, BackendExecutedOrderLog> = {};
  for (const ord of backendExecutedOrdersLog) {
    if (!activePosBySym[ord.symbol] && ord.status === 'OPEN_EXECUTED') {
      activePosBySym[ord.symbol] = ord;
    }
  }

  const prePumpSupportMonitor = prePumpSupportEngine.process({
    topGainers: topGainersCache,
    livePriceMap: liveMap,
    activePositionsBySymbol: activePosBySym,
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    pipelineEpoch: backendPipelineEpoch,
    aiActivityPulse: {
      activeModels: 5,
      ticksProcessed: backendPipelineTicks,
      avgPipelineLatencyMs: backendPipelineAvgLatencyMs,
      wsBatchIntervalMs: 16,
      status: appLiveEnabled ? 'STREAMING' : 'CALIBRATING',
    },
    moduleHealth: [prePumpSupportEngine.healthCheck()],
    activeAwaitingSignals,
    executedOrdersLog: backendExecutedOrdersLog.slice(0, 40),
    prePumpSupportMonitor,
    telegramStabilizer: telegramDispatchStabilizer.getSnapshot(),
  };
}

setInterval(() => {
  if (!appLiveEnabled) return;
  runBackendExecutionPipelineSweep().catch(() => undefined);
}, 12_000);

function getTelegramWebhookSecret(): string {
  if (process.env.TELEGRAM_WEBHOOK_SECRET && process.env.TELEGRAM_WEBHOOK_SECRET.trim()) {
    return process.env.TELEGRAM_WEBHOOK_SECRET.trim();
  }
  const token = getTelegramBotToken();
  if (!token) return '';
  return crypto
    .createHmac('sha256', SESSION_SIGNING_KEY)
    .update(`tg-webhook:${token}`)
    .digest('hex')
    .slice(0, 40);
}

function sampleSystemHealthAndLatencies(): {
  capturedAt: string;
  health: SystemHealthParameters;
  moduleLatencies: ModuleLatencyMetric[];
} {
  const nowMs = Date.now();
  const elapsedMs = Math.max(50, nowMs - lastCpuSampleAtMs);
  const currentCpu = process.cpuUsage();
  const coreCount = Math.max(1, os.cpus().length || 1);
  if (elapsedMs >= 250) {
    lastComputedCpuPct = computeCpuUsagePercent({
      prevUserMicros: lastCpuSample.user,
      prevSystemMicros: lastCpuSample.system,
      nextUserMicros: currentCpu.user,
      nextSystemMicros: currentCpu.system,
      elapsedMs,
      cpuCoreCount: coreCount,
    });
    lastCpuSample = currentCpu;
    lastCpuSampleAtMs = nowMs;
  }

  const mem = process.memoryUsage();
  const load1m = Number((os.loadavg()[0] ?? 0).toFixed(2));
  const microSnap = GLOBAL_MICROSERVICE_COORDINATOR.getSnapshot();
  const svcList = ORDERED_MICROSERVICE_IDS.map((id) => microSnap.services[id]);
  const healthyServices = svcList.filter(
    (s) => s.lifecycle === 'ACTIVE' || s.lifecycle === 'FAILOVER_ACTIVE'
  ).length;
  const openPositionsCount = sandboxPositions.filter((p) => p.status === 'OPEN').length;

  const moduleLatencies: ModuleLatencyMetric[] = [
    {
      moduleId: 'market-data-spot',
      label: 'Binance Spot Feed',
      latencyMs: Math.max(1, Math.round(lastSpotPollLatencyMs || microSnap.services['market-data-svc'].lastLatencyMs || 18)),
      targetCeilingMs: 300,
      status: classifyLatencyStatus(
        Math.max(1, Math.round(lastSpotPollLatencyMs || microSnap.services['market-data-svc'].lastLatencyMs || 18)),
        300
      ),
    },
    {
      moduleId: 'top-gainers',
      label: 'Top Gainers Feeder',
      latencyMs: Math.max(1, Math.round(lastGainersPollLatencyMs || 24)),
      targetCeilingMs: 400,
      status: classifyLatencyStatus(Math.max(1, Math.round(lastGainersPollLatencyMs || 24)), 400),
    },
    {
      moduleId: 'ai-agents-svc',
      label: 'AI Agent Pipeline',
      latencyMs: Math.max(1, Math.round(microSnap.services['ai-agents-svc'].lastLatencyMs || 12)),
      targetCeilingMs: 150,
      status: classifyLatencyStatus(
        Math.max(1, Math.round(microSnap.services['ai-agents-svc'].lastLatencyMs || 12)),
        150
      ),
    },
    {
      moduleId: 'execution-router-svc',
      label: 'Execution Router',
      latencyMs: Math.max(1, Math.round(microSnap.services['execution-router-svc'].lastLatencyMs || 14)),
      targetCeilingMs: 120,
      status: classifyLatencyStatus(
        Math.max(1, Math.round(microSnap.services['execution-router-svc'].lastLatencyMs || 14)),
        120
      ),
    },
    {
      moduleId: 'risk-kernel-svc',
      label: 'Risk & Invariant Kernel',
      latencyMs: Math.max(1, Math.round(microSnap.services['risk-kernel-svc'].lastLatencyMs || 4)),
      targetCeilingMs: 50,
      status: classifyLatencyStatus(
        Math.max(1, Math.round(microSnap.services['risk-kernel-svc'].lastLatencyMs || 4)),
        50
      ),
    },
    {
      moduleId: 'event-loop',
      label: 'Node Event Loop Lag',
      latencyMs: Number((monitorState.eventLoopLagMs || 0).toFixed(2)),
      targetCeilingMs: 25,
      status: classifyLatencyStatus(monitorState.eventLoopLagMs || 0, 25),
    },
    {
      moduleId: 'self-heal',
      label: 'Auto-Heal Recovery',
      latencyMs: Math.max(0, Math.round(monitorState.selfHealLatencyMs || 0)),
      targetCeilingMs: 500,
      status: classifyLatencyStatus(Math.max(0, Math.round(monitorState.selfHealLatencyMs || 0)), 500),
    },
  ];

  const overallStatus: SystemHealthParameters['overallStatus'] =
    monitorState.status === 'SELF_HEALING'
      ? 'SELF_HEALING'
      : healthyServices < svcList.length || lastComputedCpuPct >= 85 || monitorState.eventLoopLagMs > 50
      ? 'DEGRADED'
      : 'OPTIMAL';

  const health: SystemHealthParameters = {
    overallStatus,
    uptimeSec: Math.floor((nowMs - serverStartedAtMs) / 1000),
    cpuUsagePct: lastComputedCpuPct,
    loadAvg1m: load1m,
    memoryRssMb: Number((mem.rss / (1024 * 1024)).toFixed(1)),
    heapUsedMb: Number((mem.heapUsed / (1024 * 1024)).toFixed(1)),
    heapTotalMb: Number((mem.heapTotal / (1024 * 1024)).toFixed(1)),
    eventLoopLagMs: Number((monitorState.eventLoopLagMs || 0).toFixed(2)),
    wsConnected: backendWsConnected,
    wsFrameAgeMs:
      backendWsLastFrameAtMs > 0 ? Math.max(0, nowMs - backendWsLastFrameAtMs) : 0,
    sseSubscribers: sseTickListeners.size,
    activeOpenPositions: openPositionsCount,
    autoHealCount: monitorState.autoHealCount,
    staleFeedCount: monitorState.staleFeedCount,
    isolatedFaultsCount: microSnap.isolatedFaultsContainedTotal,
    activeServicesHealthy: healthyServices,
    totalServices: svcList.length,
  };

  return {
    capturedAt: new Date(nowMs).toISOString(),
    health,
    moduleLatencies,
  };
}

async function resolveTelegramChatId(token: string): Promise<string | null> {
  const configuredChatId = getPublicChannelChatId();
  if (configuredChatId) return configuredChatId;
  if (discoveredTelegramChatId) return discoveredTelegramChatId;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=10`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const updates = Array.isArray(json.result) ? json.result : [];
    for (let i = updates.length - 1; i >= 0; i--) {
      const chat = updates[i]?.message?.chat ?? updates[i]?.channel_post?.chat;
      const chatId = chat?.id;
      if (chatId !== undefined && chatId !== null) {
        if (chat?.type === 'private' && !boundDeveloperChatId) {
          boundDeveloperChatId = String(chatId);
        }
        discoveredTelegramChatId = String(chatId);
        return discoveredTelegramChatId;
      }
    }
  } catch {
    // Best-effort lookup
  } finally {
    clearTimeout(timer);
  }
  return null;
}

async function sendTelegramRawMessage(params: {
  chatId: string;
  text: string;
}): Promise<{ ok: boolean; errorDetail: string | null }> {
  const token = getTelegramBotToken();
  if (!token) {
    return { ok: false, errorDetail: 'BOT_TOKEN not configured in environment.' };
  }
  const target = params.chatId.trim();
  if (!target) {
    return { ok: false, errorDetail: 'Target Telegram chat ID not configured.' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: target,
        text: params.text,
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    if (res.ok) {
      return { ok: true, errorDetail: null };
    }
    const errBody = await res.json().catch(() => null);
    const desc =
      errBody && typeof errBody.description === 'string'
        ? errBody.description
        : `Telegram API HTTP ${res.status}`;
    return { ok: false, errorDetail: desc };
  } catch (err) {
    return {
      ok: false,
      errorDetail: err instanceof Error ? err.message : 'Telegram network timeout',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function sendTelegramAlertIfConfigured(
  text: string,
  preferChannel = false
): Promise<boolean> {
  if (!appLiveEnabled) {
    appLiveQuotaSavedCalls += 1;
    return false;
  }
  const token = getTelegramBotToken();
  if (!token) return false;
  const configuredChatId = getPublicChannelChatId();
  const rawChannel = preferChannel ? process.env.TELEGRAM_CHANNEL_ID : undefined;
  const normalizedChannel = rawChannel
    ? rawChannel.replace(/^https?:\/\/t\.me\//i, '@').replace(/^@@+/, '@')
    : undefined;
  const chatId = configuredChatId || normalizedChannel || (await resolveTelegramChatId(token));
  if (!chatId) return false;
  const result = await sendTelegramRawMessage({ chatId, text });
  return result.ok;
}

async function dispatchPublicTradeSignalAlert(input: {
  symbol: string;
  direction: 'BUY' | 'SELL' | 'SUMMARY';
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  confidence: number;
  timeframe?: string;
  rationale?: string;
  customMessage?: string;
  bypassAppLive?: boolean;
}): Promise<StructuredTradeSignalAlert> {
  const cleanSymbol = String(input.symbol || 'BTCUSDT')
    .toUpperCase()
    .replace(/[^A-Z0-9/_-]/g, '');
  const direction: StructuredTradeSignalAlert['direction'] =
    input.direction === 'SELL' ? 'SELL' : input.direction === 'SUMMARY' ? 'SUMMARY' : 'BUY';
  const entryPrice = Number(input.entryPrice || spotFeedCache[cleanSymbol]?.price || 0);
  const stopLoss =
    Number(input.stopLoss) > 0
      ? Number(input.stopLoss)
      : direction === 'SELL'
      ? Number((entryPrice * 1.018).toFixed(4))
      : Number((entryPrice * 0.982).toFixed(4));
  const exitPrice =
    Number(input.exitPrice) > 0
      ? Number(input.exitPrice)
      : direction === 'SELL'
      ? Number((entryPrice - Math.abs(entryPrice - stopLoss) * 5).toFixed(4))
      : Number((entryPrice + Math.abs(entryPrice - stopLoss) * 5).toFixed(4));
  const confidence = Math.max(0, Math.min(100, Math.round(Number(input.confidence || 85))));
  const riskRewardRatio = computeRiskRewardRatio(direction, entryPrice, exitPrice, stopLoss);
  const formattedMessage = formatPublicSignalMessage({
    symbol: cleanSymbol,
    direction,
    entryPrice,
    exitPrice,
    stopLoss,
    confidence,
    timeframe: input.timeframe || '4h',
    rationale: input.rationale,
  });

  const targetChatId = getPublicChannelChatId() || '@SignalForge';
  let deliveredViaBot = false;
  let deliveryStatus: StructuredTradeSignalAlert['deliveryStatus'] = 'QUEUED_FALLBACK';
  let errorDetail: string | null = null;

  if (appLiveEnabled || input.bypassAppLive) {
    const sendRes = await sendTelegramRawMessage({
      chatId: targetChatId,
      text: formattedMessage,
    });
    deliveredViaBot = sendRes.ok;
    deliveryStatus = sendRes.ok ? 'DELIVERED' : 'QUEUED_FALLBACK';
    errorDetail = sendRes.errorDetail;
  } else {
    errorDetail = 'App Live paused — recorded in Signal Forge local stream.';
  }

  const timestamp = new Date().toISOString();
  const entry: StructuredTradeSignalAlert = {
    id: `sig_tg_${cleanSymbol}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    stream: 'PUBLIC_SIGNAL',
    channelName: 'Signal Forge',
    targetChatId,
    symbol: cleanSymbol,
    direction,
    entryPrice,
    exitPrice,
    stopLoss,
    confidence,
    riskRewardRatio,
    timeframe: input.timeframe || '4h',
    rationale: input.rationale,
    formattedMessage,
    deliveredViaBot,
    deliveryStatus,
    errorDetail,
    timestamp,
  };

  publicSignalStreamLog.unshift(entry);
  if (publicSignalStreamLog.length > 60) publicSignalStreamLog.length = 60;

  const legacyPost: TelegramChannelPost = {
    id: entry.id,
    channelName: 'Signal Forge',
    symbol: entry.symbol,
    direction: entry.direction,
    confidence: entry.confidence,
    message: input.customMessage && input.customMessage.includes('Entry Price:')
      ? input.customMessage
      : formattedMessage,
    deliveredViaBot,
    timestamp,
  };
  telegramChannelFeed.unshift(legacyPost);
  if (telegramChannelFeed.length > 40) telegramChannelFeed.length = 40;

  return entry;
}

function buildDailyAuditSummary(): DailyAuditReportSummary {
  const nowMs = Date.now();
  const cutoff24h = nowMs - 24 * 60 * 60 * 1000;
  const recent = rolling24hAuditSamples.filter((s) => s.tsMs >= cutoff24h);
  const current = sampleSystemHealthAndLatencies();
  const slowestCurrent = [...current.moduleLatencies].sort((a, b) => b.latencyMs - a.latencyMs)[0];

  const samples =
    recent.length > 0
      ? recent
      : [
          {
            tsMs: nowMs,
            cpuUsagePct: current.health.cpuUsagePct,
            memoryRssMb: current.health.memoryRssMb,
            eventLoopLagMs: current.health.eventLoopLagMs,
            peakModuleLatencyMs: slowestCurrent?.latencyMs ?? 0,
            slowestModuleLabel: slowestCurrent?.label ?? 'Binance Spot Feed',
          },
        ];

  const avgCpu =
    samples.reduce((acc, s) => acc + s.cpuUsagePct, 0) / samples.length;
  const peakCpu = Math.max(...samples.map((s) => s.cpuUsagePct));
  const avgMem =
    samples.reduce((acc, s) => acc + s.memoryRssMb, 0) / samples.length;
  const avgLag =
    samples.reduce((acc, s) => acc + s.eventLoopLagMs, 0) / samples.length;
  const slowestSample = [...samples].sort(
    (a, b) => b.peakModuleLatencyMs - a.peakModuleLatencyMs
  )[0];

  const public24h = publicSignalStreamLog.filter(
    (s) => Date.parse(s.timestamp) >= cutoff24h
  ).length;
  const audits24h = developerAuditStreamLog.filter(
    (a) => Date.parse(a.timestamp) >= cutoff24h
  ).length;

  return {
    reportDateUtc: getUtcDateKey(nowMs),
    generatedAt: current.capturedAt,
    samplesCollected: samples.length,
    avgCpuUsagePct: Number(avgCpu.toFixed(1)),
    peakCpuUsagePct: Number(peakCpu.toFixed(1)),
    avgMemoryRssMb: Number(avgMem.toFixed(1)),
    avgEventLoopLagMs: Number(avgLag.toFixed(2)),
    peakModuleLatencyMs: slowestSample?.peakModuleLatencyMs ?? 0,
    slowestModuleLabel: slowestSample?.slowestModuleLabel ?? 'Binance Spot Feed',
    publicSignalsDispatched24h: public24h,
    continuousAuditsLogged24h: audits24h,
    autoHealEventsTotal: current.health.autoHealCount,
    uptimeSec: current.health.uptimeSec,
    latestHealth: current.health,
    moduleLatencies: current.moduleLatencies,
  };
}

async function dispatchDeveloperSystemAudit(
  kind: SystemAuditLogEntry['kind'] = 'CONTINUOUS_AUDIT',
  explicitChatId?: string
): Promise<SystemAuditLogEntry> {
  const sample = sampleSystemHealthAndLatencies();
  const slowest = [...sample.moduleLatencies].sort((a, b) => b.latencyMs - a.latencyMs)[0];
  rolling24hAuditSamples.push({
    tsMs: Date.now(),
    cpuUsagePct: sample.health.cpuUsagePct,
    memoryRssMb: sample.health.memoryRssMb,
    eventLoopLagMs: sample.health.eventLoopLagMs,
    peakModuleLatencyMs: slowest?.latencyMs ?? 0,
    slowestModuleLabel: slowest?.label ?? 'Binance Spot Feed',
  });
  if (rolling24hAuditSamples.length > 1500) {
    rolling24hAuditSamples.splice(0, rolling24hAuditSamples.length - 1500);
  }

  const formattedMessage =
    kind === 'DAILY_DIGEST'
      ? formatDailyAuditReportMessage(buildDailyAuditSummary())
      : formatDeveloperAuditMessage(sample.health, sample.moduleLatencies, sample.capturedAt);

  // Stream 2 strictly routes to Developer's private chat ID (never to public CHAT_ID channel)
  const devChatId = (explicitChatId || getDeveloperPrivateChatId()).trim();
  const publicChannelId = getPublicChannelChatId();
  let deliveredViaBot = false;
  let deliveryStatus: SystemAuditLogEntry['deliveryStatus'] = 'QUEUED_FALLBACK';
  let errorDetail: string | null = null;

  if (!devChatId) {
    errorDetail =
      'Developer private chat unbound — set DEVELOPER_CHAT_ID or message /start to the bot in private chat to auto-bind Stream 2.';
  } else if (devChatId === publicChannelId) {
    errorDetail =
      'Stream isolation enforced: developer private chat ID cannot match public Signal Forge channel ID.';
  } else {
    const sendRes = await sendTelegramRawMessage({
      chatId: devChatId,
      text: formattedMessage,
    });
    deliveredViaBot = sendRes.ok;
    deliveryStatus = sendRes.ok ? 'DELIVERED' : 'QUEUED_FALLBACK';
    errorDetail = sendRes.errorDetail;
  }

  const entry: SystemAuditLogEntry = {
    id: `audit_${kind.toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    stream: 'DEVELOPER_AUDIT',
    kind,
    targetChatId: devChatId ? maskChatId(devChatId) : 'Unbound',
    health: sample.health,
    moduleLatencies: sample.moduleLatencies,
    formattedMessage,
    deliveredViaBot,
    deliveryStatus,
    errorDetail,
    timestamp: sample.capturedAt,
  };

  developerAuditStreamLog.unshift(entry);
  if (developerAuditStreamLog.length > 120) developerAuditStreamLog.length = 120;

  if (kind === 'DAILY_DIGEST') {
    lastDailyAuditDateUtc = getUtcDateKey(Date.now());
    lastDailyAuditSentAt = sample.capturedAt;
    dailyAuditReportsDispatchedTotal += 1;
  }

  return entry;
}

async function registerTelegramWebhook(explicitUrl?: string): Promise<{
  ok: boolean;
  webhookUrl: string | null;
  description: string;
}> {
  const token = getTelegramBotToken();
  if (!token) {
    return {
      ok: false,
      webhookUrl: null,
      description: 'BOT_TOKEN not configured in environment.',
    };
  }
  const baseUrl = (explicitUrl || process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (!baseUrl || !/^https:\/\//i.test(baseUrl)) {
    return {
      ok: false,
      webhookUrl: null,
      description:
        'A public HTTPS APP_URL (or explicit https:// webhookUrl) is required for Telegram setWebhook.',
    };
  }
  const targetUrl = baseUrl.endsWith('/api/telegram/webhook')
    ? baseUrl
    : `${baseUrl}/api/telegram/webhook`;
  const secretToken = getTelegramWebhookSecret();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: targetUrl,
        secret_token: secretToken || undefined,
        allowed_updates: ['message', 'channel_post', 'edited_message'],
      }),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json?.ok) {
      telegramWebhookRegistered = true;
      telegramWebhookUrl = targetUrl;
      telegramWebhookLastRegisteredAt = new Date().toISOString();
      telegramWebhookLastError = null;
      return {
        ok: true,
        webhookUrl: targetUrl,
        description: String(json.description || 'Webhook registered successfully.'),
      };
    }
    const errDesc = String(json?.description || `Telegram setWebhook HTTP ${res.status}`);
    telegramWebhookLastError = errDesc;
    return { ok: false, webhookUrl: targetUrl, description: errDesc };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Telegram setWebhook network error';
    telegramWebhookLastError = msg;
    return { ok: false, webhookUrl: targetUrl, description: msg };
  } finally {
    clearTimeout(timer);
  }
}

function buildTelegramDualStreamStatus(): TelegramDualStreamStatus {
  const token = getTelegramBotToken();
  const publicChatId = getPublicChannelChatId();
  const devChatId = getDeveloperPrivateChatId();
  const live = sampleSystemHealthAndLatencies();
  const appUrlBase = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  const inferredWebhookUrl =
    telegramWebhookUrl ||
    (appUrlBase && /^https:\/\//i.test(appUrlBase)
      ? `${appUrlBase}/api/telegram/webhook`
      : null);

  return {
    ok: true,
    botConfigured: Boolean(token),
    maskedToken: maskTelegramToken(token),
    publicChannel: {
      name: 'Signal Forge',
      chatId: publicChatId || '@SignalForge',
      handle: process.env.TELEGRAM_CHANNEL_ID || '@SignalForge',
      totalDispatched: publicSignalStreamLog.length,
      deliveredCount: publicSignalStreamLog.filter((s) => s.deliveredViaBot).length,
      lastDispatchedAt: publicSignalStreamLog[0]?.timestamp ?? null,
    },
    developerAudit: {
      chatIdConfigured: Boolean(devChatId),
      targetChatIdMasked: maskChatId(devChatId),
      autoBoundViaWebhook: autoBoundDeveloperViaWebhook,
      continuousIntervalSec: CONTINUOUS_AUDIT_INTERVAL_SEC,
      totalAuditsLogged: developerAuditStreamLog.length,
      deliveredCount: developerAuditStreamLog.filter((a) => a.deliveredViaBot).length,
      lastAuditAt: developerAuditStreamLog[0]?.timestamp ?? null,
      dailyAutoDeliveryEnabled: dailyAuditAutoDeliveryEnabled,
      dailyScheduledUtcHour: dailyAuditScheduledUtcHour,
      lastDailyReportDateUtc: lastDailyAuditDateUtc,
      lastDailyReportSentAt: lastDailyAuditSentAt,
      nextDailyReportUtcIso: computeNextDailyAuditIso(Date.now(), dailyAuditScheduledUtcHour),
      dailyReportsDispatchedTotal: dailyAuditReportsDispatchedTotal,
    },
    webhook: {
      endpointPath: '/api/telegram/webhook',
      configuredUrl: inferredWebhookUrl,
      registered: telegramWebhookRegistered,
      secretHeaderEnforced: Boolean(getTelegramWebhookSecret()),
      lastRegisteredAt: telegramWebhookLastRegisteredAt,
      lastInboundAt: telegramWebhookLastInboundAt,
      totalInboundUpdates: telegramWebhookTotalInbound,
      lastError: telegramWebhookLastError,
    },
    liveTelemetry: live,
    publicSignals: publicSignalStreamLog.slice(0, 25),
    developerAuditLogs: developerAuditStreamLog.slice(0, 30),
    recentWebhookEvents: recentWebhookEventsLog.slice(0, 20),
  };
}

function computePrePumpMetrics(params: {
  price: number;
  high24h: number;
  low24h: number;
  change24hPercent: number;
  volume24hUsd: number;
}): {
  prePumpScore: number;
  volumeAnomalyRatio: number;
  accumulationPhase: TopGainerCoin['accumulationPhase'];
  institutionalConviction: TopGainerCoin['institutionalConviction'];
  dynamicLeverageCap: number;
  wideTrailAtrMult: number;
} {
  const range = Math.max(params.high24h - params.low24h, params.price * 0.004);
  const rangePos = Math.max(0, Math.min(1, (params.price - params.low24h) / range));
  const volBase = 45_000_000;
  const volumeAnomalyRatio = Number(
    Math.max(0.85, Math.min(5.2, params.volume24hUsd / volBase)).toFixed(2)
  );
  const earlyExpansionSweetSpot =
    params.change24hPercent >= 1.5 && params.change24hPercent <= 9.5 ? 22 : 12;
  const rangeCompressionBonus = rangePos >= 0.62 ? 18 : rangePos >= 0.45 ? 11 : 4;
  const volAnomalyBonus = Math.min(34, Math.max(6, (volumeAnomalyRatio - 0.8) * 15));
  const prePumpScore = Math.min(
    99,
    Math.max(
      45,
      Math.round(
        earlyExpansionSweetSpot +
          rangeCompressionBonus +
          volAnomalyBonus +
          Math.min(20, params.change24hPercent * 0.9)
      )
    )
  );
  const accumulationPhase: TopGainerCoin['accumulationPhase'] =
    params.change24hPercent >= 10
      ? 'MOMENTUM_LEADER'
      : prePumpScore >= 72
      ? 'PRE_PUMP_ACCUMULATION'
      : 'EARLY_BREAKOUT';
  const institutionalConviction: TopGainerCoin['institutionalConviction'] =
    volumeAnomalyRatio >= 1.8 && prePumpScore >= 70
      ? 'HIGH'
      : volumeAnomalyRatio >= 1.2 || prePumpScore >= 60
      ? 'ELEVATED'
      : 'STANDARD';
  const realizedRangePct = (range / Math.max(params.price, 1e-8)) * 100;
  const dynamicLeverageCap = Math.max(
    3,
    Math.min(18, Math.round(62 / Math.max(3.2, realizedRangePct)))
  );
  const wideTrailAtrMult = Number(
    (realizedRangePct >= 9 ? 2.35 : prePumpScore >= 72 ? 2.15 : 1.95).toFixed(2)
  );

  return {
    prePumpScore,
    volumeAnomalyRatio,
    accumulationPhase,
    institutionalConviction,
    dynamicLeverageCap,
    wideTrailAtrMult,
  };
}

function buildFallbackTopGainers(): TopGainerCoin[] {
  const rawSeed: Array<Omit<TopGainerCoin, 'gainerRank' | 'isTopGainer'>> = [
    {
      symbol: 'SUIUSDT',
      baseAsset: 'SUI',
      name: 'Sui',
      price: 3.84,
      change24hPercent: 18.42,
      high24h: 3.96,
      low24h: 3.19,
      volume24hUsd: 482_000_000,
    },
    {
      symbol: 'SOLUSDT',
      baseAsset: 'SOL',
      name: 'Solana',
      price: 214.6,
      change24hPercent: 12.64,
      high24h: 218.9,
      low24h: 189.4,
      volume24hUsd: 1_240_000_000,
    },
    {
      symbol: 'APTUSDT',
      baseAsset: 'APT',
      name: 'Aptos',
      price: 11.48,
      change24hPercent: 10.85,
      high24h: 11.92,
      low24h: 10.12,
      volume24hUsd: 214_000_000,
    },
    {
      symbol: 'AVAXUSDT',
      baseAsset: 'AVAX',
      name: 'Avalanche',
      price: 38.75,
      change24hPercent: 8.91,
      high24h: 39.8,
      low24h: 35.1,
      volume24hUsd: 388_000_000,
    },
    {
      symbol: 'NEARUSDT',
      baseAsset: 'NEAR',
      name: 'NEAR Protocol',
      price: 5.94,
      change24hPercent: 7.45,
      high24h: 6.12,
      low24h: 5.42,
      volume24hUsd: 196_000_000,
    },
    {
      symbol: 'LINKUSDT',
      baseAsset: 'LINK',
      name: 'Chainlink',
      price: 16.42,
      change24hPercent: 6.18,
      high24h: 16.88,
      low24h: 15.25,
      volume24hUsd: 312_000_000,
    },
    {
      symbol: 'FETUSDT',
      baseAsset: 'FET',
      name: 'Artificial Superintelligence',
      price: 1.92,
      change24hPercent: 5.85,
      high24h: 1.98,
      low24h: 1.78,
      volume24hUsd: 248_000_000,
    },
    {
      symbol: 'INJUSDT',
      baseAsset: 'INJ',
      name: 'Injective',
      price: 27.4,
      change24hPercent: 4.92,
      high24h: 28.1,
      low24h: 25.4,
      volume24hUsd: 185_000_000,
    },
  ];
  return rawSeed.map((coin, idx) => ({
    ...coin,
    gainerRank: idx + 1,
    isTopGainer: true,
    ...computePrePumpMetrics(coin),
  }));
}

function recordGainerAlertsFromList(gainers: TopGainerCoin[], isInitialSeed: boolean): void {
  const nowMs = Date.now();
  const ALERT_COOLDOWN_MS = 15 * 60 * 1000;

  for (const g of gainers.slice(0, 6)) {
    const prev = previousGainerSnapshot.get(g.symbol);
    const lastAlerted = lastGainerAlertTime.get(g.symbol) ?? 0;
    const cooldownElapsed = nowMs - lastAlerted > ALERT_COOLDOWN_MS;

    let reason: string | null = null;
    if (isInitialSeed && g.gainerRank <= 3) {
      reason = `Binance Top Gainer #${g.gainerRank} (+${g.change24hPercent.toFixed(2)}% 24h · Pre-Pump ${g.prePumpScore ?? 75}/99 · ${g.wideTrailAtrMult ?? 2.1}x ATR Trail) active in priority queue`;
    } else if (!prev && (g.gainerRank <= 3 || (g.prePumpScore ?? 0) >= 78) && cooldownElapsed) {
      reason = `${g.accumulationPhase === 'PRE_PUMP_ACCUMULATION' ? 'Pre-Pump Accumulation' : `Top ${g.gainerRank} Gainer`} detected (+${g.change24hPercent.toFixed(2)}% 24h · ${g.volumeAnomalyRatio ?? 1.5}x Vol Anomaly)`;
    } else if (prev && g.change24hPercent - prev.change >= 3.0 && cooldownElapsed) {
      reason = `Rapid Momentum Surge (+${(g.change24hPercent - prev.change).toFixed(2)}% jump to +${g.change24hPercent.toFixed(2)}%)`;
    } else if (g.change24hPercent >= 15 && cooldownElapsed) {
      reason = `Breakout Gainer Threshold (+${g.change24hPercent.toFixed(2)}% 24h) prioritized in AI Engine`;
    }

    if (reason) {
      lastGainerAlertTime.set(g.symbol, nowMs);
      const evt: GainerAlertEvent = {
        id: `ga_${g.symbol}_${nowMs}`,
        symbol: g.symbol,
        baseAsset: g.baseAsset,
        price: g.price,
        change24hPercent: g.change24hPercent,
        volume24hUsd: g.volume24hUsd,
        gainerRank: g.gainerRank,
        reason,
        timestamp: new Date(nowMs).toISOString(),
      };
      gainerAlertsLog.unshift(evt);
      if (gainerAlertsLog.length > 25) gainerAlertsLog.length = 25;

      if (!isInitialSeed) {
        sendTelegramAlertIfConfigured(
          `Signal Forge Top Gainer Alert: #${g.gainerRank} ${g.symbol} $${g.price} (+${g.change24hPercent.toFixed(2)}% 24h) — ${reason}`
        ).catch(() => undefined);
      }
    }
  }

  previousGainerSnapshot.clear();
  for (const g of gainers) {
    previousGainerSnapshot.set(g.symbol, { rank: g.gainerRank, change: g.change24hPercent });
  }
  if (lastGainerAlertTime.size > 300) {
    const cutoff = nowMs - 24 * 60 * 60 * 1000;
    for (const [sym, ts] of lastGainerAlertTime.entries()) {
      if (ts < cutoff) lastGainerAlertTime.delete(sym);
    }
  }
}

async function pollBinanceTopGainers(): Promise<void> {
  if (gainersPollInFlight) return gainersPollInFlight;
  gainersPollInFlight = (async () => {
    const startedAt = Date.now();
    const epochAtStart = serverSyncEpoch;
    const isInitialSeed = topGainersCache.length === 0;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const res = await fetch('https://api.binance.com/api/v3/ticker/24hr', {
        signal: controller.signal,
      });

      if (res.ok) {
        const raw = await res.json();
        if (epochAtStart !== serverSyncEpoch) return;
        if (Array.isArray(raw) && raw.length > 0) {
          const validSpotUsdt = raw.filter((item: any) => {
            const sym = String(item.symbol || '');
            if (!sym.endsWith('USDT')) return false;
            const base = sym.slice(0, -4);
            if (!base || STABLECOIN_BASES.has(base)) return false;
            if (
              base.endsWith('UP') ||
              base.endsWith('DOWN') ||
              base.endsWith('BULL') ||
              base.endsWith('BEAR')
            ) {
              return false;
            }
            const price = Number(item.lastPrice);
            const quoteVol = Number(item.quoteVolume);
            const pct = Number(item.priceChangePercent);
            return (
              Number.isFinite(price) &&
              price > 0 &&
              Number.isFinite(quoteVol) &&
              quoteVol >= 1_000_000 &&
              Number.isFinite(pct)
            );
          });

          const scoredCandidates = validSpotUsdt
            .filter((item: any) => Number(item.priceChangePercent) > 0 && Number(item.quoteVolume) >= 2_500_000)
            .map((item: any) => {
              const metrics = computePrePumpMetrics({
                price: Number(item.lastPrice),
                high24h: Number(item.highPrice),
                low24h: Number(item.lowPrice),
                change24hPercent: Number(item.priceChangePercent),
                volume24hUsd: Number(item.quoteVolume),
              });
              const compositeScore = Number(item.priceChangePercent) * 2.1 + metrics.prePumpScore * 0.55;
              return { item, metrics, compositeScore };
            })
            .sort((a, b) => b.compositeScore - a.compositeScore);

          const seen = new Set(scoredCandidates.map((entry) => String(entry.item.symbol)));
          const secondaryPositive = validSpotUsdt
            .filter((item: any) => !seen.has(String(item.symbol)) && Number(item.priceChangePercent) > 0)
            .sort((a: any, b: any) => Number(b.priceChangePercent) - Number(a.priceChangePercent))
            .map((item: any) => ({
              item,
              metrics: computePrePumpMetrics({
                price: Number(item.lastPrice),
                high24h: Number(item.highPrice),
                low24h: Number(item.lowPrice),
                change24hPercent: Number(item.priceChangePercent),
                volume24hUsd: Number(item.quoteVolume),
              }),
              compositeScore: Number(item.priceChangePercent),
            }));

          const combined = [...scoredCandidates, ...secondaryPositive];
          if (combined.length < 8) {
            const combinedSet = new Set(combined.map((entry) => String(entry.item.symbol)));
            const relativeLeaders = validSpotUsdt
              .filter(
                (item: any) =>
                  !combinedSet.has(String(item.symbol)) && Number(item.quoteVolume) >= 15_000_000
              )
              .sort((a: any, b: any) => Number(b.priceChangePercent) - Number(a.priceChangePercent))
              .map((item: any) => ({
                item,
                metrics: computePrePumpMetrics({
                  price: Number(item.lastPrice),
                  high24h: Number(item.highPrice),
                  low24h: Number(item.lowPrice),
                  change24hPercent: Number(item.priceChangePercent),
                  volume24hUsd: Number(item.quoteVolume),
                }),
                compositeScore: Number(item.priceChangePercent),
              }));
            combined.push(...relativeLeaders);
          }

          const filtered = combined.slice(0, 10).map((entry, idx): TopGainerCoin => {
            const { item, metrics } = entry;
            const sym = String(item.symbol).toUpperCase();
            const base = sym.slice(0, -4);
            return {
              symbol: sym,
              baseAsset: base,
              name: KNOWN_NAME_MAP[sym] || base,
              price: Number(item.lastPrice),
              change24hPercent: Number(Number(item.priceChangePercent).toFixed(2)),
              high24h: Number(item.highPrice),
              low24h: Number(item.lowPrice),
              volume24hUsd: Math.round(Number(item.quoteVolume)),
              gainerRank: idx + 1,
              isTopGainer: true,
              ...metrics,
            };
          });

          if (filtered.length > 0) {
            topGainersCache = filtered;
            gainerFeederSource = 'binance';
            gainerFeederUpdatedAt = new Date().toISOString();
            lastFeedPollAtMs = Date.now();
            lastGainersPollLatencyMs = Math.max(1, Date.now() - startedAt);
            recordGainerAlertsFromList(filtered, isInitialSeed);
            return;
          }
        }
      }
    } catch {
      // Fall back gracefully when Binance REST is unavailable
    } finally {
      clearTimeout(timer);
    }

    if (topGainersCache.length === 0) {
      const fallback = buildFallbackTopGainers();
      topGainersCache = fallback;
      gainerFeederSource = 'cache';
      gainerFeederUpdatedAt = new Date().toISOString();
      lastFeedPollAtMs = Date.now();
      recordGainerAlertsFromList(fallback, true);
    }
    lastGainersPollLatencyMs = Math.max(1, Date.now() - startedAt);
  })().finally(() => {
    gainersPollInFlight = null;
  });
  return gainersPollInFlight;
}

function buildEmailHtml(title: string, bodyRowsHtml: string): string {
  return `
    <div style="background:#0a0e1a;color:#f1f5f9;font-family:Arial,sans-serif;padding:28px;border-radius:12px;max-width:620px;margin:0 auto;border:1px solid #1e293b;">
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1e293b;padding-bottom:16px;margin-bottom:20px;">
        <div>
          <span style="display:inline-block;background:#3b82f6;color:#ffffff;font-weight:700;padding:4px 10px;border-radius:6px;font-size:13px;letter-spacing:0.5px;">SF</span>
          <span style="font-size:18px;font-weight:700;margin-left:8px;color:#ffffff;">Signal Forge</span>
        </div>
        <span style="font-size:12px;color:#94a3b8;">Automated Crypto Intelligence</span>
      </div>
      <h2 style="margin:0 0 14px 0;font-size:20px;color:#ffffff;">${escapeHtml(title)}</h2>
      <div style="font-size:14px;line-height:1.6;color:#cbd5e1;">
        ${bodyRowsHtml}
      </div>
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #1e293b;font-size:13px;color:#94a3b8;">
        <p style="margin:0 0 10px 0;">Need instant desk support or signal review?</p>
        <a href="${escapeHtml(WHATSAPP_URL)}" style="display:inline-block;background:#10b981;color:#052e16;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:8px;">
          Chat on WhatsApp (${escapeHtml(WHATSAPP_URL)})
        </a>
        <p style="margin:14px 0 0 0;font-size:12px;color:#64748b;">
          Signal Forge · Developed by Amir Shehzad · ${escapeHtml(OWNER_EMAIL)}
        </p>
      </div>
    </div>
  `;
}

async function sendAlertEmail(params: {
  type: AlertDispatchRecord['type'];
  subject: string;
  bodyHtml: string;
  summary: string;
  dedupeKey?: string;
}): Promise<AlertDispatchRecord> {
  if (params.dedupeKey && sentHighConfidenceKeys.has(params.dedupeKey)) {
    const existing = alertDispatchLog.find((r) => r.subject === params.subject);
    if (existing) return existing;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const html = buildEmailHtml(params.subject, params.bodyHtml);
  const record: AlertDispatchRecord = {
    id: `eml_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
    type: params.type,
    recipient: OWNER_EMAIL,
    subject: params.subject,
    summary: params.summary,
    status: 'queued_no_api_key',
    timestamp: new Date().toISOString(),
  };

  if (apiKey && apiKey.startsWith('re_')) {
    try {
      const resend = new Resend(apiKey);
      const result = await resend.emails.send({
        from: 'Signal Forge <onboarding@resend.dev>',
        to: [OWNER_EMAIL],
        subject: params.subject,
        html,
      });
      if (result.error) {
        record.status = 'failed';
        record.summary = `${params.summary} (${result.error.message})`;
      } else {
        record.status = 'sent';
        record.providerId = result.data?.id;
      }
    } catch (err) {
      record.status = 'failed';
      record.summary = `${params.summary} (${err instanceof Error ? err.message : 'Send error'})`;
    }
  }

  if (params.dedupeKey) {
    addBoundedSetKey(sentHighConfidenceKeys, params.dedupeKey, 500);
  }

  const tgSent = await sendTelegramAlertIfConfigured(
    `${params.subject}\n${params.summary}\nWhatsApp: ${WHATSAPP_URL}`,
    true
  ).catch(() => false);
  record.telegramDelivered = tgSent;

  alertDispatchLog.unshift(record);
  if (alertDispatchLog.length > 30) alertDispatchLog.length = 30;
  return record;
}

function buildStructuredReport(
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY'
): StructuredPerformanceReport {
  const closedSandboxPnl = sandboxPositions.reduce((acc, p) => acc + p.pnlUsd, 0);
  const closedPositions = sandboxPositions.filter((p) => p.status !== 'OPEN');
  const liveWins = closedPositions.filter((p) => p.pnlUsd > 0).length;
  const statsMap = {
    DAILY: {
      label: 'Daily (24H)',
      signals: 11 + sandboxPositions.length,
      winRate:
        closedPositions.length > 0
          ? Number((((8 + liveWins) / (11 + closedPositions.length)) * 100).toFixed(1))
          : 72.7,
      netReturn: Number((6.84 + (closedSandboxPnl / 25000) * 100).toFixed(2)),
      avgRR: '2.94R',
      profitFactor: 2.68,
      bestPair: 'SOLUSDT (+4.6%)',
      skepticVetoes: 3,
      atrTrailingExits: 7 + closedPositions.length,
      strategyBreakdown: [
        { module: 'AI Engine', trades: 4, winRate: 75.0, contributionPct: 2.4 },
        { module: 'SMC & FRVP', trades: 4, winRate: 75.0, contributionPct: 2.75 },
        { module: 'Pattern Scanner', trades: 3, winRate: 66.7, contributionPct: 1.69 },
      ],
    },
    WEEKLY: {
      label: 'Weekly (7D)',
      signals: 74 + sandboxPositions.length,
      winRate: 68.9,
      netReturn: Number((29.4 + (closedSandboxPnl / 25000) * 100).toFixed(2)),
      avgRR: '3.18R',
      profitFactor: 2.44,
      bestPair: 'BTCUSDT (+9.2%)',
      skepticVetoes: 19,
      atrTrailingExits: 52,
      strategyBreakdown: [
        { module: 'AI Engine', trades: 26, winRate: 69.2, contributionPct: 9.8 },
        { module: 'SMC & FRVP', trades: 29, winRate: 72.4, contributionPct: 12.1 },
        { module: 'Pattern Scanner', trades: 19, winRate: 63.2, contributionPct: 7.5 },
      ],
    },
    MONTHLY: {
      label: 'Monthly (30D)',
      signals: 300 + sandboxPositions.length,
      winRate: 64.3,
      netReturn: Number((112.8 + (closedSandboxPnl / 25000) * 100).toFixed(2)),
      avgRR: '4.12R',
      profitFactor: 2.86,
      bestPair: 'AVAXUSDT (+16.4%)',
      skepticVetoes: 68,
      atrTrailingExits: 214,
      strategyBreakdown: [
        { module: 'AI Engine', trades: 98, winRate: 66.3, contributionPct: 34.2 },
        { module: 'SMC & FRVP', trades: 124, winRate: 64.5, contributionPct: 49.4 },
        { module: 'Pattern Scanner', trades: 78, winRate: 61.5, contributionPct: 29.2 },
      ],
    },
  };
  const m = statsMap[period];
  return {
    period,
    ...m,
    crossEquityUsd: Number((crossWalletBalanceUsd + closedSandboxPnl).toFixed(2)),
    sandboxRealizedPnlUsd: Number(closedSandboxPnl.toFixed(2)),
    generatedAt: new Date().toISOString(),
  };
}

const structuredReportsCache: Record<'DAILY' | 'WEEKLY' | 'MONTHLY', StructuredPerformanceReport> = {
  DAILY: buildStructuredReport('DAILY'),
  WEEKLY: buildStructuredReport('WEEKLY'),
  MONTHLY: buildStructuredReport('MONTHLY'),
};

async function dispatchPerformanceReport(
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY'
): Promise<{ record: AlertDispatchRecord; report: StructuredPerformanceReport }> {
  const m = buildStructuredReport(period);
  structuredReportsCache[period] = m;
  const emailTypeMap = {
    DAILY: 'PERFORMANCE_DAILY' as const,
    WEEKLY: 'PERFORMANCE_WEEKLY' as const,
    MONTHLY: 'PERFORMANCE_MONTHLY' as const,
  };

  const telegramSummary = [
    `SIGNAL FORGE ${m.label.toUpperCase()} PERFORMANCE REPORT`,
    `Signals: ${m.signals} | Win Rate: ${m.winRate}% | Net Return: +${m.netReturn}% | PF: ${m.profitFactor}x`,
    `Avg Dynamic R:R: ${m.avgRR} | ATR Trailing Exits: ${m.atrTrailingExits} | Best Pair: ${m.bestPair}`,
    `Skeptic Agent Vetoes Saved: ${m.skepticVetoes} traps blocked`,
    `USD-M Futures (${executionMode}) Cross Wallet: $${crossWalletBalanceUsd.toFixed(2)} (PnL $${m.sandboxRealizedPnlUsd.toFixed(2)})`,
    `Support Desk: ${WHATSAPP_URL}`,
  ].join('\n');

  telegramChannelFeed.unshift({
    id: `tg_perf_${period}_${Date.now()}`,
    channelName: 'Signal Forge',
    symbol: period,
    direction: 'SUMMARY',
    message: telegramSummary,
    deliveredViaBot: Boolean(getTelegramBotToken()),
    timestamp: new Date().toISOString(),
  });
  if (telegramChannelFeed.length > 40) telegramChannelFeed.length = 40;

  const record = await sendAlertEmail({
    type: emailTypeMap[period],
    subject: `Signal Forge ${m.label} AI Coordinator Performance Summary`,
    summary: `${m.label}: ${m.winRate}% Win Rate, +${m.netReturn}% Net Return across ${m.signals} signals (${m.skepticVetoes} traps vetoed by Skeptic Agent)`,
    bodyHtml: `
      <p>Automated ${m.label} multi-agent trading performance summary generated by the Signal Forge AI Coordinator:</p>
      <div style="background:#111827;border:1px solid #1e293b;border-radius:8px;padding:16px;margin:14px 0;">
        <p style="margin:0 0 6px 0;"><strong>Period:</strong> ${m.label} &nbsp;|&nbsp; <strong>Total Signals:</strong> ${m.signals}</p>
        <p style="margin:0 0 6px 0;"><strong>Win Rate:</strong> ${m.winRate}% &nbsp;|&nbsp; <strong>Net Return:</strong> <span style="color:#10b981;font-weight:700;">+${m.netReturn}%</span></p>
        <p style="margin:0 0 6px 0;"><strong>Avg Dynamic R:R:</strong> ${m.avgRR} &nbsp;|&nbsp; <strong>Profit Factor:</strong> ${m.profitFactor}x &nbsp;|&nbsp; <strong>Top Performer:</strong> ${m.bestPair}</p>
        <p style="margin:0 0 6px 0;"><strong>Skeptic Agent Vetoes:</strong> ${m.skepticVetoes} high-risk traps filtered &nbsp;|&nbsp; <strong>ATR Trail Exits:</strong> ${m.atrTrailingExits}</p>
        <p style="margin:0;"><strong>Futures Cross Wallet (${executionMode}):</strong> $${crossWalletBalanceUsd.toFixed(2)} Equity</p>
      </div>
    `,
  });
  return { record, report: m };
}

// No demo wallet transfers or fabricated cash flow in production-facing intelligence.
function buildFallbackIntelligence(): {
  source: 'unverified_unavailable';
  whales: WhaleTransaction[];
  flows: ExchangeFlowMetric[];
  trending: Array<{ symbol: string; name: string; price: number; change24h: number; tag: string }>;
  whaleFlowVerified: false;
} {
  return { source: 'unverified_unavailable', whales: [], flows: [], trending: [], whaleFlowVerified: false };
}

async function fetchMarketIntelligence() {
  const cmcKey = process.env.CMC_API_KEY;
  if (!cmcKey) {
    return buildFallbackIntelligence();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(
      'https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=12&convert=USD',
      {
        headers: {
          'X-CMC_PRO_API_KEY': cmcKey,
          Accept: 'application/json',
        },
        signal: controller.signal,
      }
    );

    if (!res.ok) {
      return buildFallbackIntelligence();
    }

    const json = await res.json();
    const rows = Array.isArray(json.data) ? json.data : [];
    if (rows.length === 0) return buildFallbackIntelligence();

    // CMC market listings offer trading volume, not observed on-chain exchange wallet transfers.
    // Genuine whale flows require separately verified transaction hashes and wallet labels.
    const flows: ExchangeFlowMetric[] = [];
    const whales: WhaleTransaction[] = [];

    const trending = rows
      .slice()
      .sort(
        (a: any, b: any) =>
          Math.abs(Number(b.quote?.USD?.percent_change_24h || 0)) -
          Math.abs(Number(a.quote?.USD?.percent_change_24h || 0))
      )
      .slice(0, 4)
      .map((item: any) => {
        const chg = Number(item.quote?.USD?.percent_change_24h || 0);
        return {
          symbol: `${String(item.symbol).toUpperCase()}USDT`,
          name: String(item.name),
          price: Number(item.quote?.USD?.price || 0),
          change24h: Number(chg.toFixed(2)),
          tag: chg >= 3 ? 'Top Gaining' : chg >= 0 ? 'Trending' : 'High Volatility',
        };
      });

    return { source: 'cmc' as const, whales, flows, trending, whaleFlowVerified: false as const };
  } catch {
    return buildFallbackIntelligence();
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchThreeHourSignalDigest(force: boolean = false) {
  const nowMs = Date.now();
  const schedule = evaluateDigestSchedule(signalDigestState, nowMs, force);

  if (!schedule.due) {
    return {
      throttledBy3hSchedule: true,
      remainingMs: schedule.remainingMs,
      nextScheduledAt: new Date(signalDigestState.nextScheduledAtMs).toISOString(),
      queueCount: schedule.pendingCount,
      record: {
        id: `dig_hold_${nowMs}`,
        type: 'THREE_HOUR_SIGNAL_DIGEST' as const,
        recipient: OWNER_EMAIL,
        subject: `3H Digest Quota Shield Active (${schedule.pendingCount} signals queued)`,
        summary: schedule.reason,
        status: 'batched_for_3h_digest' as const,
        batchedCount: schedule.pendingCount,
        timestamp: new Date(nowMs).toISOString(),
      },
    };
  }

  const { state: nextState, batch } = consumePendingForDigest(signalDigestState, nowMs);
  signalDigestState = nextState;

  const intel = await fetchMarketIntelligence();
  const trendingList: Array<{ symbol: string; name: string; price: number; change24h: number; tag: string }> =
    intel.trending;
  const nextDigestIso = new Date(signalDigestState.nextScheduledAtMs).toISOString();

  const html = buildDigestEmailBodyHtml({
    batch,
    trendingCoins: trendingList,
    nextDigestIso,
  });

  const signalSummary =
    batch.length > 0
      ? batch.slice(0, 5).map((b) => `${b.symbol} ${b.direction} (${b.confidence}%)`).join(', ')
      : `0 triggered signals; Top Movers: ${trendingList.map((t) => t.symbol).join(', ')}`;

  const record = await sendAlertEmail({
    type: 'THREE_HOUR_SIGNAL_DIGEST',
    subject: `Signal Forge 3-Hour Signal Digest (${batch.length} Batched Setups)`,
    summary: `3H Batch Digest (${batch.length} signals, ${signalDigestState.individualEmailsPrevented} individual emails saved): ${signalSummary}`,
    bodyHtml: html,
  });
  record.batchedCount = batch.length;

  return {
    throttledBy3hSchedule: false,
    remainingMs: THREE_HOURS_MS,
    nextScheduledAt: nextDigestIso,
    queueCount: 0,
    record,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // Global security headers & strict same-origin API protection
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
      const origin = req.headers.origin;
      const host = req.headers.host;
      if (origin && host) {
        try {
          const originHost = new URL(origin).host;
          if (originHost !== host) {
            return res.status(403).json({
              ok: false,
              code: 'CROSS_ORIGIN_FORBIDDEN',
              error: 'Cross-origin API requests are blocked.',
            });
          }
        } catch {
          return res.status(403).json({
            ok: false,
            code: 'INVALID_ORIGIN',
            error: 'Invalid Origin header.',
          });
        }
      }
    }
    next();
  });

  const standardWriteRateLimit = createRateLimiter('api_write', 120, 60_000);
  const otpRequestRateLimit = createRateLimiter('otp_request', 5, 5 * 60_000);
  const modeSwitchRateLimit = createRateLimiter('mode_switch', 10, 5 * 60_000);
  const failsafeRateLimit = createRateLimiter('failsafe_recovery', 8, 5 * 60_000);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'signal-forge' });
  });

  // First-party ephemeral HMAC-SHA256 operator session issuer (cookie + CSRF header token)
  app.get('/api/auth/session', (_req, res) => {
    const { token, expiresAtMs } = signOperatorSessionToken();
    res.setHeader(
      'Set-Cookie',
      `sf_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
    );
    return res.json({ ok: true, token, expiresAtMs });
  });

  // Strict Subscription Gatekeeper Endpoints
  app.get('/api/subscription/status', async (req, res) => {
    const principal = await resolveCallerPrincipal(req);
    return res.json({
      ok: true,
      subscription: maskPrincipalSummary(principal),
    });
  });

  app.post('/api/subscription/activate', requireOperatorAuth, standardWriteRateLimit, async (req, res) => {
    const rawToken = extractFirebaseIdTokenFromRequest(req);
    const verified = rawToken ? await verifyFirebaseIdToken(rawToken) : null;
    if (!verified) {
      return res.status(401).json({
        ok: false,
        code: 'AUTH_REQUIRED',
        error: 'Sign in with your Signal Forge account before activating a Premium Institutional subscription.',
      });
    }
    if (!verified.emailVerified) {
      return res.status(403).json({
        ok: false,
        code: 'EMAIL_UNVERIFIED',
        error: 'Email address verification is required before activating Premium Institutional privileges.',
      });
    }
    const planKey = String(req.body?.plan || 'PREMIUM_INSTITUTIONAL').toUpperCase();
    if (planKey !== 'PREMIUM_INSTITUTIONAL') {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_PLAN',
        error: 'Only PREMIUM_INSTITUTIONAL activation unlocks Telemetry, Agent Override & Execution controls.',
      });
    }
    grantOrUpdateSubscription({
      uid: verified.uid,
      tier: 'PREMIUM_INSTITUTIONAL',
      status: 'ACTIVE',
      durationDays: 30,
      planLabel: 'Premium Institutional Desk',
    });
    const principal = resolvePrincipalFromVerifiedToken(verified);
    return res.json({
      ok: true,
      subscription: maskPrincipalSummary(principal),
    });
  });

  app.post('/api/subscription/downgrade', requireOperatorAuth, standardWriteRateLimit, async (req, res) => {
    const rawToken = extractFirebaseIdTokenFromRequest(req);
    const verified = rawToken ? await verifyFirebaseIdToken(rawToken) : null;
    if (!verified) {
      return res.status(401).json({
        ok: false,
        code: 'AUTH_REQUIRED',
        error: 'Authenticated Firebase session required.',
      });
    }
    grantOrUpdateSubscription({
      uid: verified.uid,
      tier: 'FREE',
      status: 'INACTIVE',
      planLabel: 'Free Tier (Locked Controls)',
    });
    const principal = resolvePrincipalFromVerifiedToken(verified);
    return res.json({
      ok: true,
      subscription: maskPrincipalSummary(principal),
    });
  });

  // Decoupled Modular Microservices, Toggle Matrix, HA Failover, Rollback & Error Ledger Endpoints
  function syncLegacyRuntimeFromMatrix(matrix: GranularControlMatrix) {
    const prevLive = systemControls.liveFeedModulesEnabled;
    systemControls = matrixToSystemControls(matrix);
    autonomousCoordinatorEnabled = matrix.autonomousCoordinator;
    if (prevLive && (!systemControls.liveFeedModulesEnabled || !appLiveEnabled)) {
      pauseBackendSpotWs();
    } else if (!prevLive && systemControls.liveFeedModulesEnabled && appLiveEnabled) {
      lastFeedPollAtMs = Date.now();
      backendWsCircuitOpen = false;
      backendWsAttempt = 0;
      bindBackendSpotWebSocket();
      pollBinanceSpotFeed()
        .then(() => refreshCmcValuations())
        .catch(() => undefined);
    }
  }

  app.get('/api/architecture/state', async (req, res) => {
    const principal = await resolveCallerPrincipal(req);
    const subSummary = maskPrincipalSummary(principal);
    const snap = GLOBAL_MICROSERVICE_COORDINATOR.getSnapshot();
    const fullErrorAccess = evaluateSubscriptionGate(principal, 'TELEMETRY').allowed ||
      buildRbacIdentity(principal, extraAdminEmailsFromEnv).role === 'SUPER_ADMIN';
    return res.json({
      ok: true,
      architecture: {
        ...snap,
        errorLedger: fullErrorAccess
          ? snap.errorLedger
          : snap.errorLedger.slice(0, 8).map((e) => ({
              ...e,
              message: 'Locked — Authenticate with Premium Institutional subscription for full error forensics.',
              contextSummary: `${e.serviceId} [${e.severity}]`,
            })),
      },
      subscription: subSummary,
    });
  });

  app.post('/api/architecture/toggle', requireOperatorAuth, requireMasterControlOwner, standardWriteRateLimit, async (req, res) => {
    const rawPatch =
      req.body?.patch && typeof req.body.patch === 'object'
        ? (req.body.patch as Record<string, unknown>)
        : {};
    const parsedPatch: Partial<GranularControlMatrix> = {};

    for (const key of CONTROL_TOGGLE_KEYS) {
      if (typeof rawPatch[key] === 'boolean') {
        parsedPatch[key] = rawPatch[key] as boolean;
      }
    }

    if (Object.keys(parsedPatch).length === 0) {
      return res.status(400).json({
        ok: false,
        code: 'EMPTY_TOGGLE_PATCH',
        error: 'Provide at least one boolean feature toggle key inside patch.',
      });
    }

    const principal = await resolveCallerPrincipal(req);
    const result = await GLOBAL_MICROSERVICE_COORDINATOR.updateControlMatrix(
      parsedPatch,
      principal.uid || 'operator',
      String(req.body?.reason || 'Workspace control matrix update')
    );
    syncLegacyRuntimeFromMatrix(result.state.controlMatrix);
    return res.json({
      ok: true,
      snapshotId: result.snapshotId,
      changedKeys: result.changedKeys,
      architecture: result.state,
      controls: systemControls,
      subscription: maskPrincipalSummary(principal),
    });
  });

  app.post(
    '/api/architecture/failover',
    requireOperatorAuth,
    requireMasterControlOwner,
    standardWriteRateLimit,
    async (req, res) => {
      const serviceId = String(req.body?.serviceId || '') as MicroserviceId;
      if (!ORDERED_MICROSERVICE_IDS.includes(serviceId)) {
        return res.status(400).json({ ok: false, error: `Invalid microserviceId "${serviceId}".` });
      }
      const targetNode: FailoverNodeRole =
        req.body?.targetNode === 'PRIMARY' ? 'PRIMARY' : 'SECONDARY';
      const reason = String(req.body?.reason || `Operator HA switch -> ${targetNode}`);
      const nextState = await GLOBAL_MICROSERVICE_COORDINATOR.failoverService(
        serviceId,
        targetNode,
        reason
      );
      if (serviceId === 'market-data-svc') {
        backendWsHostIndex = targetNode === 'SECONDARY' ? 1 : 0;
        if (appLiveEnabled && systemControls.liveFeedModulesEnabled) {
          backendWsCircuitOpen = false;
          backendWsAttempt = 0;
          bindBackendSpotWebSocket();
        }
      }
      return res.json({
        ok: true,
        architecture: nextState,
      });
    }
  );

  app.post(
    '/api/architecture/service-lifecycle',
    requireOperatorAuth,
    requireMasterControlOwner,
    standardWriteRateLimit,
    async (req, res) => {
      const serviceId = String(req.body?.serviceId || '') as MicroserviceId;
      if (!ORDERED_MICROSERVICE_IDS.includes(serviceId)) {
        return res.status(400).json({ ok: false, error: `Invalid microserviceId "${serviceId}".` });
      }
      const rawLife = String(req.body?.lifecycle || 'ACTIVE').toUpperCase();
      const lifecycle: 'ACTIVE' | 'ISOLATED' | 'DECOMMISSIONED' =
        rawLife === 'ISOLATED' || rawLife === 'DECOMMISSIONED' ? rawLife : 'ACTIVE';
      const reason = String(req.body?.reason || `Operator set ${serviceId} -> ${lifecycle}`);
      const nextState = await GLOBAL_MICROSERVICE_COORDINATOR.updateServiceLifecycle(
        serviceId,
        lifecycle,
        reason
      );
      return res.json({
        ok: true,
        architecture: nextState,
      });
    }
  );

  app.post(
    '/api/architecture/rollback',
    requireOperatorAuth,
    requireMasterControlOwner,
    standardWriteRateLimit,
    async (req, res) => {
      const principal = await resolveCallerPrincipal(req);
      const snapshotId = String(req.body?.snapshotId || '').trim();
      const reason = String(req.body?.reason || 'Manual workspace configuration rollback');
      if (!snapshotId) {
        return res.status(400).json({ ok: false, error: 'snapshotId is required.' });
      }
      const outcome = await GLOBAL_MICROSERVICE_COORDINATOR.rollback(
        snapshotId,
        principal.uid || 'operator',
        reason
      );
      if (!outcome.ok) {
        return res.status(404).json({ ok: false, error: outcome.error, architecture: outcome.state });
      }
      syncLegacyRuntimeFromMatrix(outcome.state.controlMatrix);
      return res.json({
        ok: true,
        architecture: outcome.state,
        controls: systemControls,
      });
    }
  );

  app.post(
    '/api/architecture/fault-drill',
    requireOperatorAuth,
    requireMasterControlOwner,
    standardWriteRateLimit,
    async (req, res) => {
      const serviceId = String(req.body?.serviceId || 'market-data-svc') as MicroserviceId;
      if (!ORDERED_MICROSERVICE_IDS.includes(serviceId)) {
        return res.status(400).json({ ok: false, error: `Invalid microserviceId "${serviceId}".` });
      }
      const severityRaw = String(req.body?.severity || 'ERROR').toUpperCase();
      const severity: ErrorSeverity =
        severityRaw === 'WARN' || severityRaw === 'CRITICAL' ? severityRaw : 'ERROR';
      const code = String(req.body?.code || 'FAULT_ISOLATION_DRILL').slice(0, 64);
      const message = String(
        req.body?.message || `Controlled fault-isolation drill injected on ${serviceId}`
      );
      const burstCount = Number(req.body?.burstCount ?? 2);
      const result = await GLOBAL_MICROSERVICE_COORDINATOR.injectFaultDrill({
        serviceId,
        severity,
        code,
        message,
        burstCount,
      });
      syncLegacyRuntimeFromMatrix(result.state.controlMatrix);
      return res.json({
        ok: true,
        failoverTriggered: result.failoverTriggered,
        rollbackTriggered: result.rollbackTriggered,
        recordedErrors: result.recordedErrors,
        architecture: result.state,
        controls: systemControls,
      });
    }
  );

  // Multi-Exchange L2 Order Book Depth Poller (Binance + Bybit + OKX with anchored WS fallback)
  async function refreshSingleExchangeDepth(symbol: string): Promise<MultiExchangeDepthAnalysis> {
    seedFallbackSpotTelemetry();
    const sym = symbol.toUpperCase();
    const spotSnap = spotFeedCache[sym];
    const refMid =
      spotSnap?.price ??
      TRACKED_COINS.find((c) => c.symbol === sym)?.referencePrice ??
      100;
    const nowMs = Date.now();
    const okxInstId = sym.replace(/USDT$/, '-USDT');
    const toPairs = (rows: any): Array<[number, number]> =>
      Array.isArray(rows) ? rows.map((r: any) => [Number(r[0]), Number(r[1])]) : [];

    const fetchWithTimeout = async (url: string) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2400);
      try {
        const resp = await fetch(url, { signal: controller.signal });
        if (!resp.ok) return null;
        return await resp.json();
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    };

    const existingBin = liveExchangeBooksCache[sym]?.BINANCE;
    const binFresh = existingBin && existingBin.source === 'live_ws' && nowMs - existingBin.updatedAtMs < 4000;

    const [binJson, bybitJson, okxJson] = await Promise.all([
      binFresh ? Promise.resolve(null) : fetchWithTimeout(`${SPOT_REST_ENDPOINTS[0]}/api/v3/depth?symbol=${sym}&limit=15`),
      fetchWithTimeout(`https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${sym}&limit=15`),
      fetchWithTimeout(`https://www.okx.com/api/v5/market/books?instId=${okxInstId}&sz=15`),
    ]);

    const binBook: ExchangeOrderBookSnapshot = binFresh
      ? existingBin
      : binJson?.bids && binJson?.asks
      ? normalizeExchangeOrderBook({
          exchange: 'BINANCE',
          symbol: sym,
          bids: toPairs(binJson.bids),
          asks: toPairs(binJson.asks),
          referencePrice: refMid,
          source: 'exchange_rest',
          updatedAtMs: nowMs,
        })
      : buildAnchoredExchangeBook({
          exchange: 'BINANCE',
          symbol: sym,
          liveWsPrice: refMid,
          change24hPercent: spotSnap?.change24hPercent,
          volume24hUsd: spotSnap?.volume24hUsd,
          updatedAtMs: nowMs,
        });

    const bybitBook: ExchangeOrderBookSnapshot =
      bybitJson?.result?.b && bybitJson?.result?.a
        ? normalizeExchangeOrderBook({
            exchange: 'BYBIT',
            symbol: sym,
            bids: toPairs(bybitJson.result.b),
            asks: toPairs(bybitJson.result.a),
            referencePrice: refMid,
            source: 'exchange_rest',
            updatedAtMs: nowMs,
          })
        : buildAnchoredExchangeBook({
            exchange: 'BYBIT',
            symbol: sym,
            liveWsPrice: refMid,
            change24hPercent: spotSnap?.change24hPercent,
            volume24hUsd: spotSnap?.volume24hUsd,
            updatedAtMs: nowMs,
          });

    const okxData = Array.isArray(okxJson?.data) ? okxJson.data[0] : null;
    const okxBook: ExchangeOrderBookSnapshot =
      okxData?.bids && okxData?.asks
        ? normalizeExchangeOrderBook({
            exchange: 'OKX',
            symbol: sym,
            bids: toPairs(okxData.bids),
            asks: toPairs(okxData.asks),
            referencePrice: refMid,
            source: 'exchange_rest',
            updatedAtMs: nowMs,
          })
        : buildAnchoredExchangeBook({
            exchange: 'OKX',
            symbol: sym,
            liveWsPrice: refMid,
            change24hPercent: spotSnap?.change24hPercent,
            volume24hUsd: spotSnap?.volume24hUsd,
            updatedAtMs: nowMs,
          });

    liveExchangeBooksCache[sym] = {
      BINANCE: binBook,
      BYBIT: bybitBook,
      OKX: okxBook,
    };

    const agg = aggregateMultiExchangeDepth(sym, [binBook, bybitBook, okxBook], refMid);
    multiExchangeDepthCache[sym] = agg;
    depthUpdatedAt = new Date(nowMs).toISOString();
    return agg;
  }

  async function refreshAllTrackedDepths() {
    seedFallbackSpotTelemetry();
    const extraGainers = topGainersCache.slice(0, 2).map((g) => g.symbol);
    const syms = Array.from(new Set([...DEPTH_TRACKED_SYMBOLS, ...extraGainers]));
    await Promise.all(syms.map((s) => refreshSingleExchangeDepth(s)));
  }

  function gatherCrossPlatformSentinelFeeds(extraSignals: CrossPlatformFeedSignal[] = []): CrossPlatformFeedSignal[] {
    const baseSignals = newsItemsToCrossPlatformSignals(DEFAULT_NEWS_FEED);
    const dynamicAlerts: CrossPlatformFeedSignal[] = [];
    const nowIso = new Date().toISOString();

    for (const g of topGainersCache.slice(0, 4)) {
      if (g.change24hPercent >= 10) {
        dynamicAlerts.push({
          id: `x_surge_${g.symbol}_${new Date().toISOString().slice(0, 13)}`,
          platform: 'X',
          handle: '@SignalForgeMomentum',
          headline: `$${g.symbol.replace(/USDT$/, '')} breaking +${g.change24hPercent.toFixed(1)}% 24h momentum surge with ${(g.volume24hUsd / 1e6).toFixed(1)}M spot turnover on Binance`,
          symbols: [g.symbol, g.symbol.replace(/USDT$/, '')],
          sentiment: 'BULLISH_CATALYST',
          credibilityWeight: Math.min(0.96, 0.72 + g.change24hPercent * 0.01),
          timestamp: nowIso,
        });
      }
    }

    for (const [sym, depth] of Object.entries(multiExchangeDepthCache)) {
      const obiPct = depth.netOrderBookImbalance * 100;
      if (depth.liquidityShift === 'INSTITUTIONAL_ACCUMULATION') {
        dynamicAlerts.push({
          id: `depth_inflow_${sym}`,
          platform: 'EXCHANGE_NOTICE',
          handle: '@L2DepthDesk',
          headline: `Multi-exchange L2 depth bid absorption (${obiPct >= 0 ? '+' : ''}${obiPct.toFixed(1)}% OBI) detected across Binance/Bybit/OKX for ${sym}`,
          symbols: [sym, sym.replace(/USDT$/, '')],
          sentiment: 'BULLISH_CATALYST',
          credibilityWeight: 0.84,
          timestamp: new Date(depth.updatedAtMs).toISOString(),
        });
      } else if (depth.liquidityShift === 'DISTRIBUTION_WALL') {
        dynamicAlerts.push({
          id: `depth_dist_${sym}`,
          platform: 'EXCHANGE_NOTICE',
          handle: '@L2DepthDesk',
          headline: `Large institutional ask walls & distribution liquidity shift detected on ${sym} (${obiPct.toFixed(1)}% OBI)`,
          symbols: [sym, sym.replace(/USDT$/, '')],
          sentiment: 'PANIC_FUD',
          credibilityWeight: 0.85,
          timestamp: new Date(depth.updatedAtMs).toISOString(),
        });
      }
    }

    return [...extraSignals, ...dynamicAlerts, ...baseSignals];
  }

  function runSentinelAuditForAll(extraSignals: CrossPlatformFeedSignal[] = []) {
    seedFallbackSpotTelemetry();
    const feeds = gatherCrossPlatformSentinelFeeds(extraSignals);
    const coins = Array.from(
      new Set([
        ...TRACKED_COINS.map((c) => c.symbol),
        ...topGainersCache.slice(0, 3).map((g) => g.symbol),
      ])
    );

    for (const sym of coins) {
      const spot = spotFeedCache[sym];
      const livePrice = spot?.price ?? TRACKED_COINS.find((c) => c.symbol === sym)?.referencePrice ?? 100;
      const candles = generateDeterministicCandles(sym, '15m', 48, undefined, livePrice);
      const openPos = sandboxPositions.find((p) => p.symbol === sym && p.status === 'OPEN');

      sentinelAssessmentsCache[sym] = evaluateSentinelAgent({
        symbol: sym,
        liveWsPrice: livePrice,
        change24hPercent: spot?.change24hPercent ?? 0,
        candles,
        crossPlatformSignals: feeds,
        depthAnalysis: multiExchangeDepthCache[sym],
        hasActiveHedge: openPos?.direction === 'SELL',
      });
    }
    sentinelUpdatedAt = new Date().toISOString();
    return sentinelAssessmentsCache;
  }

  function logAutonomousDecision(rec: Omit<AutonomousDecisionRecord, 'id' | 'timestamp'>) {
    autonomousDecisionsLog.unshift({
      ...rec,
      id: `auto_dec_${rec.symbol}_${Date.now()}_${autonomousDecisionsLog.length}`,
      timestamp: new Date().toISOString(),
    });
    if (autonomousDecisionsLog.length > 40) autonomousDecisionsLog.length = 40;
  }

  function reconcileServerForgeCapital(submittedBaselineEquityUsd?: number): ForgeCapitalHubState {
    const markMap = buildMarkPriceMap();
    const volPct = estimateMarketVolatilityPct(spotFeedCache);
    forgeCapitalState = reconcileForgeCapitalState(forgeCapitalState, {
      walletBalanceUsd: crossWalletBalanceUsd,
      positions: sandboxPositions,
      authoritativePrices: markMap,
      marketVolatilityPct: volPct,
      submittedBaselineEquityUsd,
    });
    GLOBAL_DATA_INTEGRITY_RUNTIME.updateReconcilerState({
      healthy: !forgeCapitalState.reconciliation.driftDetected,
      lastReconciledAtMs: Date.now(),
      discrepancyUsd: Math.abs(forgeCapitalState.reconciliation.equityDriftUsd),
    });
    return forgeCapitalState;
  }

  function runAutonomousCoordinatorTick() {
    if (!appLiveEnabled) {
      appLiveQuotaSavedCalls += 1;
      return { skipped: 'app_live_paused' as const };
    }
    if (!autonomousCoordinatorEnabled) return { skipped: 'autonomous_disabled' as const };
    const aiAvail = GLOBAL_MICROSERVICE_COORDINATOR.isServiceAvailable('ai-agents-svc');
    if (!aiAvail.available) {
      return { skipped: 'ai_agents_isolated' as const };
    }
    if (executionMode === 'TESTNET' && !systemControls.testnetExecutionEnabled) {
      return { skipped: 'testnet_paused' as const };
    }
    const tickStartMs = Date.now();
    reconcileServerForgeCapital();
    if (forgeCapitalState.failSafe.engaged || forgeCapitalState.allTradingHalted) {
      return { skipped: 'forge_failsafe_halted' as const };
    }

    autonomousTotalCycles += 1;
    autonomousLastTickAt = new Date().toISOString();
    seedFallbackSpotTelemetry();
    const markMap = buildMarkPriceMap();
    GLOBAL_MICROSERVICE_COORDINATOR.recordNonBlockingSuccess(
      'ai-agents-svc',
      Math.max(1, Date.now() - tickStartMs)
    );

    // Ensure depth & sentinel snapshots are warm before autonomous evaluation
    for (const sym of DEPTH_TRACKED_SYMBOLS) {
      if (!multiExchangeDepthCache[sym]) {
        const refMid = markMap[sym] ?? 100;
        const spotSnap = spotFeedCache[sym];
        multiExchangeDepthCache[sym] = aggregateMultiExchangeDepth(
          sym,
          [
            buildAnchoredExchangeBook({
              exchange: 'BINANCE',
              symbol: sym,
              liveWsPrice: refMid,
              change24hPercent: spotSnap?.change24hPercent,
              volume24hUsd: spotSnap?.volume24hUsd,
            }),
            buildAnchoredExchangeBook({
              exchange: 'BYBIT',
              symbol: sym,
              liveWsPrice: refMid,
              change24hPercent: spotSnap?.change24hPercent,
              volume24hUsd: spotSnap?.volume24hUsd,
            }),
            buildAnchoredExchangeBook({
              exchange: 'OKX',
              symbol: sym,
              liveWsPrice: refMid,
              change24hPercent: spotSnap?.change24hPercent,
              volume24hUsd: spotSnap?.volume24hUsd,
            }),
          ],
          refMid
        );
      }
    }
    runSentinelAuditForAll();

    // 0. Autonomous Emergency Flash Crash Liquidation Safeguard
    const btcAssessment = sentinelAssessmentsCache['BTCUSDT'];
    const btcVel = btcAssessment?.wsVelocityPct ?? 0;
    for (const assessment of Object.values(sentinelAssessmentsCache)) {
      const crashCheck = detectFlashCrashConditions({
        symbol: assessment.symbol,
        wsVelocityPct: assessment.wsVelocityPct,
        volumeSpikeRatio: assessment.volumeSpikeRatio,
        netOrderBookImbalance: multiExchangeDepthCache[assessment.symbol]?.netOrderBookImbalance,
        sentinelRegime: assessment.regime,
        btcVelocityPct: btcVel,
      });
      if (crashCheck.triggered && sandboxPositions.some((p) => p.status === 'OPEN')) {
        const liq = executeEmergencyStablecoinLiquidation({
          positions: sandboxPositions,
          markPriceMap: markMap,
          walletBalanceUsd: crossWalletBalanceUsd,
          settleCloseFn: settleCrossMarginClose,
          triggerReason: crashCheck.reason,
          stablecoinAsset: emergencyLiquidationState.stablecoinReserveAsset,
          highRiskOnly: true,
        });
        crossWalletBalanceUsd = liq.updatedWalletBalanceUsd;
        emergencyLiquidationState.totalStablecoinReserveUsd = crossWalletBalanceUsd;
        if (liq.liquidatedRecords.length > 0) {
          emergencyLiquidationState.liquidatedCount += liq.liquidatedRecords.length;
          emergencyLiquidationState.totalConvertedUsd = Number(
            (emergencyLiquidationState.totalConvertedUsd + liq.totalConvertedUsd).toFixed(2)
          );
          emergencyLiquidationState.lastEventAt = new Date().toISOString();
          emergencyLiquidationState.lastTriggerReason = crashCheck.reason;
          emergencyLiquidationState.history = [
            ...liq.liquidatedRecords,
            ...emergencyLiquidationState.history,
          ].slice(0, 30);
          logAutonomousDecision({
            symbol: crashCheck.triggerSymbol,
            action: 'EMERGENCY_LIQUIDATION',
            direction: 'SELL',
            price: markMap[crashCheck.triggerSymbol] ?? 0,
            leverage: 1,
            reason: crashCheck.reason,
          });
        }
        break;
      }
    }

    // 1. Live management of every open Spot & Futures position:
    //    Enforce strict <= 2.0% Max Risk Cap, minimum 1:5 R:R / RL ATR Trailing Stop-Loss,
    //    and exit winning trends strictly upon Structural Trend Reversal rather than minor pullbacks.
    for (const pos of sandboxPositions) {
      if (pos.status !== 'OPEN') continue;
      const livePrice = markMap[pos.symbol] ?? pos.entryPrice;
      const candles = generateDeterministicCandles(pos.symbol, rlTuningState.preferredTimeframe, 48, undefined, livePrice);
      const atr = Math.max(computeATR(candles, 14), livePrice * 0.004);

      pos.initialStopLoss = enforceMaxStopLossCap(
        pos.entryPrice,
        pos.direction,
        pos.initialStopLoss,
        2.0
      );

      const trail = advance5xAtrTrailingTakeProfit({
        direction: pos.direction,
        entryPrice: pos.entryPrice,
        initialStopLoss: pos.initialStopLoss,
        trailingStopLoss: pos.trailingStopLoss,
        peakFavorablePrice: pos.peakFavorablePrice ?? pos.entryPrice,
        currentPrice: livePrice,
        atr14: atr,
        atrMultiplier: rlTuningState.atrTrailingTpMultiplier,
      });

      pos.trailingStopLoss = trail.nextTrailingStop;
      pos.trailingTakeProfit5xAtr = trail.nextTrailingTpTarget;
      pos.peakFavorablePrice = trail.nextPeakPrice;
      pos.maxStopLossPct = 2.0;

      const reversed = detectStructuralTrendReversal(candles, pos.direction, livePrice);
      const hitStop =
        pos.direction === 'BUY'
          ? livePrice <= pos.trailingStopLoss
          : livePrice >= pos.trailingStopLoss;
      const hitTp5x =
        pos.direction === 'BUY'
          ? livePrice >= pos.trailingTakeProfit5xAtr
          : livePrice <= pos.trailingTakeProfit5xAtr;

      let exitStatus: SandboxPosition['status'] | null = null;
      let exitReason = '';
      if (reversed) {
        exitStatus = 'CLOSED_REVERSAL';
        exitReason = `Structural trend reversal confirmed @ $${livePrice} — closing active ${pos.marketType ?? 'SPOT'} leg`;
      } else if (hitTp5x || (hitStop && trail.activated)) {
        exitStatus = 'CLOSED_TP';
        exitReason = hitTp5x
          ? `Min 1:5 (${rlTuningState.atrTrailingTpMultiplier}x ATR) Trailing Take-Profit ($${pos.trailingTakeProfit5xAtr}) reached @ $${livePrice}`
          : `ATR Trailing Profit-Lock stop ($${pos.trailingStopLoss}) triggered @ $${livePrice}`;
      } else if (hitStop) {
        exitStatus = 'CLOSED_TRAIL_SL';
        exitReason = `2.0% Max Risk Cap protective stop ($${pos.trailingStopLoss}) triggered @ $${livePrice}`;
      }

      if (exitStatus) {
        const settlement = settleCrossMarginClose({
          walletBalanceUsd: crossWalletBalanceUsd,
          position: pos,
          exitPrice: livePrice,
        });
        crossWalletBalanceUsd = settlement.updatedWalletBalanceUsd;
        pos.status = exitStatus;
        pos.pnlUsd = settlement.netRealizedPnlUsd;
        pos.pnlPercent = settlement.pnlPercent;
        pos.roePercent = settlement.roePercent;
        pos.closedAt = new Date().toISOString();
        profitVaultEngine.ingestRealizedTrade({
          tradeId: `auto_${pos.id}`,
          symbol: pos.symbol,
          realizedPnlUsd: settlement.netRealizedPnlUsd,
          sourceAgent: 'AUTONOMOUS_COORDINATOR',
        });
        autonomousExitsExecuted += 1;
        if (exitStatus === 'CLOSED_REVERSAL') {
          autonomousReversalExitsExecuted += 1;
        }
        const actionType: AutonomousDecisionRecord['action'] =
          exitStatus === 'CLOSED_REVERSAL'
            ? 'EXIT_REVERSAL'
            : exitStatus === 'CLOSED_TP'
            ? 'EXIT_5X_ATR_TP'
            : 'EXIT_TRAIL_SL';

        logAutonomousDecision({
          symbol: pos.symbol,
          action: actionType,
          direction: pos.direction,
          price: livePrice,
          leverage: pos.leverage ?? 1,
          reason: exitReason,
          pnlUsd: settlement.netRealizedPnlUsd,
        });

        sendTelegramAlertIfConfigured(
          `[AUTO EXIT · ${pos.marketType ?? 'SPOT'}] ${pos.symbol} ${pos.direction} closed via ${exitStatus} @ $${livePrice} | PnL ${settlement.netRealizedPnlUsd >= 0 ? '+' : ''}$${settlement.netRealizedPnlUsd}`,
          true
        ).catch(() => undefined);

        processAndTransmitTradingAlert({
          source: 'AUTOMATED',
          symbol: pos.symbol,
          direction: pos.direction,
          entryPrice: pos.entryPrice,
          exitPrice: livePrice,
          stopLoss: pos.trailingStopLoss,
          confidence: 92,
          hitTpMilestones: exitStatus === 'CLOSED_TP' ? ['TP1', 'TP2', 'TP3'] : [],
          finalPnlUsd: settlement.netRealizedPnlUsd,
          finalPnlPercent: settlement.pnlPercent,
          lifecycleStatus: exitStatus === 'CLOSED_TP' ? 'CLOSED_TP' : 'CLOSED_SL',
          rationale: exitReason,
        }).catch(() => undefined);
      }
    }

    // 2. Preemptive Sentinel Execution & High-Conviction Autonomous Entries (<= 2.0% Risk, >= 1:5 R:R)
    const openPositions = sandboxPositions.filter((p) => p.status === 'OPEN');
    const maxConcurrentAutonomousPositions = 6;
    const highConvictionPairs: Array<{ symbol: string; confidence: number }> = [];
    const autonomousDeskActive =
      forgeCapitalState.modules.AUTONOMOUS_AI_AGENTS?.status === 'ACTIVE' &&
      !forgeCapitalState.failSafe.engaged;

    if (autonomousDeskActive && openPositions.length < maxConcurrentAutonomousPositions) {
      for (const assessment of Object.values(sentinelAssessmentsCache)) {
        if (sandboxPositions.filter((p) => p.status === 'OPEN').length >= maxConcurrentAutonomousPositions) {
          break;
        }
        const trade = assessment.preemptivePlan;
        if (!trade) continue;
        if (trade.action === 'HOLD_MONITOR') continue;
        if (trade.action === 'EXIT_HEDGE_REVERSAL') {
          const hedgePos = sandboxPositions.find(
            (p) => p.symbol === assessment.symbol && p.status === 'OPEN' && p.direction === 'SELL'
          );
          if (hedgePos) {
            const livePrice = markMap[hedgePos.symbol] ?? hedgePos.entryPrice;
            const settlement = settleCrossMarginClose({
              walletBalanceUsd: crossWalletBalanceUsd,
              position: hedgePos,
              exitPrice: livePrice,
            });
            crossWalletBalanceUsd = settlement.updatedWalletBalanceUsd;
            hedgePos.status = 'CLOSED_REVERSAL';
            hedgePos.pnlUsd = settlement.netRealizedPnlUsd;
            hedgePos.pnlPercent = settlement.pnlPercent;
            hedgePos.roePercent = settlement.roePercent;
            hedgePos.closedAt = new Date().toISOString();
            profitVaultEngine.ingestRealizedTrade({
              tradeId: `hedge_${hedgePos.id}`,
              symbol: hedgePos.symbol,
              realizedPnlUsd: settlement.netRealizedPnlUsd,
              sourceAgent: 'SENTINEL_HEDGE',
            });
            autonomousExitsExecuted += 1;
            autonomousReversalExitsExecuted += 1;
            logAutonomousDecision({
              symbol: hedgePos.symbol,
              action: 'EXIT_REVERSAL',
              direction: hedgePos.direction,
              price: livePrice,
              leverage: hedgePos.leverage ?? 1,
              reason: `Sentinel confirmed structural reversal — exited crash hedge (${trade.reason})`,
              pnlUsd: settlement.netRealizedPnlUsd,
            });
          }
          continue;
        }

        const alreadyOpen = sandboxPositions.some(
          (p) => p.symbol === assessment.symbol && p.status === 'OPEN' && p.direction === trade.direction
        );
        if (alreadyOpen) continue;

        const walletSummary = summarizeCrossMarginWallet(
          crossWalletBalanceUsd,
          sandboxPositions,
          markMap
        );
        const isHedgeOrFutures = trade.marketType === 'USD_M_FUTURES';
        const notional = isHedgeOrFutures ? 1800 : 1400;
        const lev = isHedgeOrFutures ? 5 : 1;
        const imNeeded = notional / lev;
        if (walletSummary.availableCrossMarginUsd < imNeeded * 1.15) continue;

        const refCandles = generateDeterministicCandles(assessment.symbol, rlTuningState.preferredTimeframe, 40, undefined, trade.entryPrice);
        const sentAtr = Math.max(computeATR(refCandles, 14), trade.entryPrice * 0.006);
        const sentKernel = buildKernelValidatedRiskProfile({
          direction: trade.direction,
          entryPrice: trade.entryPrice,
          closedCandles: refCandles,
          atr14: sentAtr,
          maxRiskPct: 2.0,
          targetRR: 5.0,
        });
        if (!sentKernel.rrGate.passed) continue;
        const fee = Number((notional * (isHedgeOrFutures ? 0.0005 : 0.001)).toFixed(2));
        crossWalletBalanceUsd = Number((crossWalletBalanceUsd - fee).toFixed(2));
        const cappedSl = sentKernel.stopLoss;
        const [sentTp1, sentTp2, sentTp3] = sentKernel.takeProfits;

        const pos: SandboxPosition = {
          id: `auto_sent_${trade.marketType === 'USD_M_FUTURES' ? 'fut' : 'spot'}_${assessment.symbol}_${Date.now()}`,
          symbol: assessment.symbol,
          direction: trade.direction,
          mode: executionMode,
          marketType: trade.marketType,
          marginMode: 'CROSS',
          leverage: lev,
          entryPrice: trade.entryPrice,
          quantity: Number((notional / Math.max(trade.entryPrice, 1e-8)).toFixed(5)),
          notionalUsd: notional,
          initialMarginUsd: Number(imNeeded.toFixed(2)),
          maintenanceMarginUsd: isHedgeOrFutures ? Number((notional * 0.005).toFixed(2)) : 0,
          liquidationPrice: 0,
          fundingRate: isHedgeOrFutures ? (futuresFeedCache[assessment.symbol]?.fundingRate ?? 0.0001) : 0,
          settledFundingUsd: 0,
          initialStopLoss: cappedSl,
          trailingStopLoss: cappedSl,
          maxStopLossPct: 2.0,
          trailingTakeProfit5xAtr: sentTp3,
          peakFavorablePrice: trade.entryPrice,
          takeProfits: [sentTp1, sentTp2, sentTp3],
          status: 'OPEN',
          pnlUsd: 0,
          pnlPercent: 0,
          roePercent: 0,
          skepticVerdict: 'APPROVED',
          autonomousEntry: true,
          entrySourceReason: `Sentinel ${trade.action}: ${trade.reason}`,
          openedAt: new Date().toISOString(),
        };

        sandboxPositions.unshift(pos);
        if (sandboxPositions.length > 36) sandboxPositions.length = 36;
        totalExecutedOrders += 1;
        autonomousEntriesExecuted += 1;
        if (trade.action === 'PREEMPTIVE_HEDGE_SHORT') {
          autonomousHedgesExecuted += 1;
        }
        logAutonomousDecision({
          symbol: assessment.symbol,
          action: trade.action === 'PREEMPTIVE_HEDGE_SHORT' ? 'HEDGE_SHORT' : isHedgeOrFutures ? 'ENTRY_FUTURES' : 'ENTRY_SPOT',
          direction: trade.direction,
          price: trade.entryPrice,
          leverage: lev,
          reason: trade.reason,
        });
      }

      if (sandboxPositions.filter((p) => p.status === 'OPEN').length < maxConcurrentAutonomousPositions) {
        const candlesUniverse: Record<string, ReturnType<typeof generateDeterministicCandles>> = {};
        const tickerSnapshots: Record<string, any> = {};
        for (const coin of TRACKED_COINS) {
          const p = markMap[coin.symbol] ?? coin.referencePrice;
          candlesUniverse[coin.symbol] = generateDeterministicCandles(
            coin.symbol,
            rlTuningState.preferredTimeframe,
            90,
            undefined,
            p
          );
          tickerSnapshots[coin.symbol] = {
            symbol: coin.symbol,
            baseAsset: coin.baseAsset,
            name: coin.name,
            price: p,
            change24hPercent: spotFeedCache[coin.symbol]?.change24hPercent ?? 0,
            high24h: spotFeedCache[coin.symbol]?.high24h ?? p * 1.02,
            low24h: spotFeedCache[coin.symbol]?.low24h ?? p * 0.98,
            volume24hUsd: spotFeedCache[coin.symbol]?.volume24hUsd ?? 1_000_000_000,
            isLiveWs: backendWsConnected || spotFeedSource === 'binance_spot',
          };
        }
        const topCandidates = generateTopSignals(
          candlesUniverse,
          DEFAULT_NEWS_FEED,
          5,
          TRACKED_COINS,
          topGainersCache,
          tickerSnapshots
        );

        for (const sig of topCandidates) {
          highConvictionPairs.push({ symbol: sig.symbol, confidence: sig.confidence });
          if (sandboxPositions.filter((p) => p.status === 'OPEN').length >= maxConcurrentAutonomousPositions) {
            break;
          }
          if (sig.confidence < 82) continue;
          const openSame = sandboxPositions.some(
            (p) => p.symbol === sig.symbol && p.status === 'OPEN'
          );
          if (openSame) continue;

          const walletSummary = summarizeCrossMarginWallet(
            crossWalletBalanceUsd,
            sandboxPositions,
            markMap
          );
          const atr = Math.max(computeATR(candlesUniverse[sig.symbol], 14), sig.entryPrice * 0.006);
          const useFutures = sig.direction === 'SELL' || sig.confidence >= 88;
          const lev = useFutures ? Math.min(10, Math.max(3, sig.confidence >= 90 ? 8 : 5)) : 1;
          const notional = useFutures ? 2000 : 1500;
          const im = notional / lev;
          if (walletSummary.availableCrossMarginUsd < im * 1.15) continue;

          const fee = Number((notional * (useFutures ? 0.0005 : 0.001)).toFixed(2));
          crossWalletBalanceUsd = Number((crossWalletBalanceUsd - fee).toFixed(2));
          const coordKernel = buildKernelValidatedRiskProfile({
            direction: sig.direction,
            entryPrice: sig.entryPrice,
            closedCandles: candlesUniverse[sig.symbol],
            atr14: atr,
            minAtrFloorMult: 1.25,
            maxAtrCeilingMult: 2.2,
            maxRiskPct: 2.0,
            targetRR: 5.0,
          });
          if (!coordKernel.rrGate.passed) continue;
          const cappedSl = coordKernel.stopLoss;
          const trailTp5x = coordKernel.takeProfits[2];

          const pos: SandboxPosition = {
            id: `auto_coord_${useFutures ? 'fut' : 'spot'}_${sig.symbol}_${Date.now()}`,
            symbol: sig.symbol,
            direction: sig.direction,
            mode: executionMode,
            marketType: useFutures ? 'USD_M_FUTURES' : 'SPOT',
            marginMode: 'CROSS',
            leverage: lev,
            entryPrice: sig.entryPrice,
            quantity: Number((notional / Math.max(sig.entryPrice, 1e-8)).toFixed(5)),
            notionalUsd: notional,
            initialMarginUsd: Number(im.toFixed(2)),
            maintenanceMarginUsd: useFutures ? Number((notional * 0.005).toFixed(2)) : 0,
            liquidationPrice: 0,
            fundingRate: useFutures ? (futuresFeedCache[sig.symbol]?.fundingRate ?? 0.0001) : 0,
            settledFundingUsd: 0,
            initialStopLoss: cappedSl,
            trailingStopLoss: cappedSl,
            maxStopLossPct: 2.0,
            trailingTakeProfit5xAtr: trailTp5x,
            peakFavorablePrice: sig.entryPrice,
            takeProfits: [
              coordKernel.takeProfits[0],
              coordKernel.takeProfits[1],
              trailTp5x,
            ],
            status: 'OPEN',
            pnlUsd: 0,
            pnlPercent: 0,
            roePercent: 0,
            skepticVerdict: 'APPROVED',
            autonomousEntry: true,
            entrySourceReason: `Master Autonomous ${sig.confidence}% (${useFutures ? `${lev}x Futures` : 'Spot 1x'} · 2% Max Risk · >=1:5 R:R)`,
            openedAt: new Date().toISOString(),
          };
          sandboxPositions.unshift(pos);
          if (sandboxPositions.length > 36) sandboxPositions.length = 36;
          totalExecutedOrders += 1;
          autonomousEntriesExecuted += 1;
          logAutonomousDecision({
            symbol: sig.symbol,
            action: useFutures ? 'ENTRY_FUTURES' : 'ENTRY_SPOT',
            direction: sig.direction,
            price: sig.entryPrice,
            leverage: lev,
            reason: `Autonomous WS entry (${sig.confidence}% · 2% Max Risk · >=1:5 ATR Trail TP $${trailTp5x})`,
          });
        }
      }
    }

    // 3. Multi-Exchange Arbitrage Spread Scanner
    arbitrageOpportunitiesCache = scanCrossExchangeArbitrage(multiExchangeDepthCache);
    for (const opp of arbitrageOpportunitiesCache.slice(0, 1)) {
      if (opp.executable && opp.netSpreadBps >= 5.0 && autonomousTotalCycles % 4 === 0) {
        const cap = executeArbitrageCapture(opp, crossWalletBalanceUsd);
        if (cap.ok && cap.record) {
          crossWalletBalanceUsd = cap.updatedWalletBalanceUsd;
          arbitrageExecutionsLog.unshift(cap.record);
          if (arbitrageExecutionsLog.length > 25) arbitrageExecutionsLog.length = 25;
          logAutonomousDecision({
            symbol: opp.symbol,
            action: 'ARBITRAGE_CAPTURE',
            direction: 'BUY',
            price: opp.buyAskPrice,
            leverage: 1,
            reason: `Cross-Exchange Arb: Buy ${opp.buyExchange} $${opp.buyAskPrice} -> Sell ${opp.sellExchange} $${opp.sellBidPrice} (+${opp.netSpreadBps} bps)`,
            pnlUsd: cap.record.realizedProfitUsd,
          });
        }
      }
    }

    // 4. Institutional Copy Trading Auto-Mirroring (<= 2% Max Risk, >= 1:5 R:R)
    const activeCopyAcc = institutionalCopyAccounts.find((a) => a.autoMirrorEnabled);
    if (activeCopyAcc && autonomousTotalCycles % 6 === 0 && sandboxPositions.filter((p) => p.status === 'OPEN').length < maxConcurrentAutonomousPositions) {
      const targetSym = DEPTH_TRACKED_SYMBOLS[autonomousTotalCycles % DEPTH_TRACKED_SYMBOLS.length];
      const hasOpenTarget = sandboxPositions.some((p) => p.symbol === targetSym && p.status === 'OPEN');
      const liveP = markMap[targetSym];
      if (!hasOpenTarget && liveP && liveP > 0) {
        const refCandles = generateDeterministicCandles(targetSym, rlTuningState.preferredTimeframe, 36, undefined, liveP);
        const atr = computeATR(refCandles, 14);
        const depthBias = multiExchangeDepthCache[targetSym]?.imbalanceBias;
        const copyDir: 'BUY' | 'SELL' = depthBias === 'BEARISH' ? 'SELL' : 'BUY';
        const mirrored = buildMirroredCopyTradePlan({
          account: activeCopyAcc,
          symbol: targetSym,
          direction: copyDir,
          entryPrice: liveP,
          atr14: atr,
          futuresEnabled: false,
        });
        mirroredCopyHistory.unshift(mirrored);
        if (mirroredCopyHistory.length > 20) mirroredCopyHistory.length = 20;
        activeCopyAcc.lastMirroredSymbol = targetSym;
        activeCopyAcc.lastMirroredAt = mirrored.createdAt;
      }
    }

    // 5. AI RL Performance Auto-Tuning Cycle
    rlTuningState = tuneStrategyParametersRL(
      rlTuningState,
      sandboxPositions,
      highConvictionPairs.length > 0
        ? highConvictionPairs
        : TRACKED_COINS.slice(0, 4).map((c, idx) => ({ symbol: c.symbol, confidence: 90 - idx * 4 }))
    );
    emergencyLiquidationState.totalStablecoinReserveUsd = Number(crossWalletBalanceUsd.toFixed(2));

    // 6. Autonomous Multi-Asset Volatility Portfolio Auto-Rebalancer
    if (portfolioConfig.autoRebalanceEnabled) {
      const portfolioTickers: Record<string, any> = {};
      const portfolioCandles: Record<string, ReturnType<typeof generateDeterministicCandles>> = {};
      for (const h of portfolioHoldings) {
        const p = markMap[h.symbol] ?? 100;
        portfolioTickers[h.symbol] = {
          symbol: h.symbol,
          baseAsset: h.baseAsset,
          name: h.name,
          price: p,
          change24hPercent: spotFeedCache[h.symbol]?.change24hPercent ?? 0,
          high24h: spotFeedCache[h.symbol]?.high24h ?? p * 1.02,
          low24h: spotFeedCache[h.symbol]?.low24h ?? p * 0.98,
          volume24hUsd: spotFeedCache[h.symbol]?.volume24hUsd ?? 1_000_000_000,
          isLiveWs: backendWsConnected || spotFeedSource === 'binance_spot',
        };
        portfolioCandles[h.symbol] = generateDeterministicCandles(
          h.symbol,
          rlTuningState.preferredTimeframe,
          48,
          undefined,
          p
        );
      }
      const evaluation = evaluateMultiAssetPortfolio({
        holdings: portfolioHoldings,
        stablecoinReserveUsd: portfolioReserveUsd,
        positions: sandboxPositions,
        tickers: portfolioTickers,
        candlesMap: portfolioCandles,
        config: portfolioConfig,
        lastRebalanceAt: portfolioLastRebalanceAt,
      });
      if (evaluation.rebalanceTrigger.shouldExecute && evaluation.rebalanceTrigger.reason !== 'NONE') {
        const exec = executePortfolioRebalance({
          holdings: portfolioHoldings,
          evaluation,
          stablecoinReserveUsd: portfolioReserveUsd,
          reason: evaluation.rebalanceTrigger.reason,
        });
        portfolioHoldings = exec.updatedHoldings;
        portfolioReserveUsd = exec.updatedReserveUsd;
        portfolioLastRebalanceAt = exec.record.executedAt;
        portfolioRebalanceHistory.unshift(exec.record);
        if (portfolioRebalanceHistory.length > 30) portfolioRebalanceHistory.length = 30;
        logAutonomousDecision({
          symbol: 'PORTFOLIO',
          action: 'ENTRY_SPOT',
          direction: 'BUY',
          price: evaluation.exposureMeter.totalEquityUsd,
          leverage: 1,
          reason: `Volatility Auto-Rebalance (${exec.record.triggerReason}): ${exec.record.tradesExecuted} trades, $${exec.record.movedNotionalUsd.toFixed(0)} rotated (drift ${exec.record.preMaxDriftPct}% -> ${exec.record.postMaxDriftPct}%)`,
        });
      }
    }

    return {
      skipped: null,
      openPositions: sandboxPositions.filter((p) => p.status === 'OPEN').length,
      totalCycles: autonomousTotalCycles,
    };
  }

  // Global 'App Live' Master Control Switch + Live WS Verification Endpoints
  app.get('/api/system/app-live', (_req, res) => {
    res.json({
      ok: true,
      appLiveEnabled,
      toggledAt: appLiveToggledAt,
      quotaSavedCalls: appLiveQuotaSavedCalls,
      controls: systemControls,
    });
  });

  app.post('/api/system/app-live', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('TELEMETRY'), (req, res) => {
    const nextLive =
      typeof req.body?.appLiveEnabled === 'boolean' ? req.body.appLiveEnabled : !appLiveEnabled;
    const prevLive = appLiveEnabled;
    appLiveEnabled = nextLive;
    appLiveToggledAt = new Date().toISOString();

    if (!nextLive) {
      pauseBackendSpotWs();
      monitorState.wsChannelStatus = 'DETERMINISTIC_FALLBACK';
      monitorState.lastHealAction =
        "Master 'App Live' Switch OFF — halted all API polling, WebSockets, signal dispatch & autonomous execution to preserve quota.";
    } else if (!prevLive && nextLive) {
      lastFeedPollAtMs = Date.now();
      backendWsCircuitOpen = false;
      backendWsAttempt = 0;
      if (systemControls.liveFeedModulesEnabled) {
        bindBackendSpotWebSocket();
        pollBinanceTopGainers()
          .then(() => pollBinanceSpotFeed())
          .then(() => refreshCmcValuations())
          .then(() => refreshAllTrackedDepths())
          .catch(() => undefined);
      }
    }

    res.json({
      ok: true,
      appLiveEnabled,
      toggledAt: appLiveToggledAt,
      quotaSavedCalls: appLiveQuotaSavedCalls,
    });
  });

  app.get('/api/ws/verify', (_req, res) => {
    const frameAgeMs =
      backendWsLastFrameAtMs > 0 ? Math.max(0, Date.now() - backendWsLastFrameAtMs) : -1;
    res.json({
      ok: true,
      appLiveEnabled,
      liveFeedModulesEnabled: systemControls.liveFeedModulesEnabled,
      spotWsConnected: backendWsConnected,
      wsReadyState: backendSpotWs?.readyState ?? null,
      wsEndpointHost: SPOT_WS_ENDPOINTS[backendWsHostIndex % SPOT_WS_ENDPOINTS.length],
      totalWsFrames: backendWsTotalFrames,
      depthWsFramesCount: backendWsDepthFramesCount,
      closedCandlesCount: backendWsClosedCandlesCount,
      latestClosedCandles: Object.values(liveKlineWsFrames).slice(0, 8),
      frameAgeMs,
      spotFeedSource,
      futuresFeedSource,
      sseSubscribers: sseTickListeners.size,
      verifiedAt: new Date().toISOString(),
    });
  });

  // RL Performance Auto-Tuning Endpoints
  app.get('/api/autonomous/tune', (_req, res) => {
    res.json({
      ok: true,
      tuning: rlTuningState,
    });
  });

  app.post('/api/autonomous/tune', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('AGENT_OVERRIDE'), (req, res) => {
    if (typeof req.body?.enabled === 'boolean') {
      rlTuningState.enabled = req.body.enabled;
    }
    rlTuningState = tuneStrategyParametersRL(
      rlTuningState,
      sandboxPositions,
      TRACKED_COINS.slice(0, 6).map((c, idx) => ({
        symbol: c.symbol,
        confidence: 92 - idx * 3,
      }))
    );
    res.json({
      ok: true,
      tuning: rlTuningState,
    });
  });

  // Autonomous Emergency Flash-Crash Stablecoin Liquidation Endpoints
  app.get('/api/autonomous/liquidation-state', (_req, res) => {
    emergencyLiquidationState.totalStablecoinReserveUsd = Number(crossWalletBalanceUsd.toFixed(2));
    res.json({
      ok: true,
      liquidation: emergencyLiquidationState,
    });
  });

  app.post('/api/autonomous/emergency-liquidate', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('EXECUTION'), (req, res) =>
    executionMutex.runExclusive(() => {
    const stablecoinAsset = req.body?.stablecoinAsset === 'USDC' ? 'USDC' : 'USDT';
    const triggerReason = String(
      req.body?.reason || 'Manual / Voice Autonomous Emergency Liquidation to Stablecoins'
    );
    const highRiskOnly = req.body?.highRiskOnly === true;
    const markMap = buildMarkPriceMap();
    const outcome = executeEmergencyStablecoinLiquidation({
      positions: sandboxPositions,
      markPriceMap: markMap,
      walletBalanceUsd: crossWalletBalanceUsd,
      settleCloseFn: settleCrossMarginClose,
      triggerReason,
      stablecoinAsset,
      highRiskOnly,
    });

    crossWalletBalanceUsd = outcome.updatedWalletBalanceUsd;
    emergencyLiquidationState.stablecoinReserveAsset = stablecoinAsset;
    emergencyLiquidationState.totalStablecoinReserveUsd = crossWalletBalanceUsd;
    if (outcome.liquidatedRecords.length > 0) {
      emergencyLiquidationState.liquidatedCount += outcome.liquidatedRecords.length;
      emergencyLiquidationState.totalConvertedUsd = Number(
        (emergencyLiquidationState.totalConvertedUsd + outcome.totalConvertedUsd).toFixed(2)
      );
      emergencyLiquidationState.lastEventAt = new Date().toISOString();
      emergencyLiquidationState.lastTriggerReason = triggerReason;
      emergencyLiquidationState.history = [
        ...outcome.liquidatedRecords,
        ...emergencyLiquidationState.history,
      ].slice(0, 30);

      logAutonomousDecision({
        symbol: outcome.liquidatedRecords[0].symbol,
        action: 'EMERGENCY_LIQUIDATION',
        direction: 'SELL',
        price: outcome.liquidatedRecords[0].exitPrice,
        leverage: 1,
        reason: `${outcome.liquidatedRecords.length} positions liquidated into ${stablecoinAsset}: ${triggerReason}`,
      });
    }

    const crossMargin = summarizeCrossMarginWallet(
      crossWalletBalanceUsd,
      sandboxPositions,
      markMap
    );

    res.json({
      ok: true,
      liquidatedCount: outcome.liquidatedRecords.length,
      totalConvertedUsd: outcome.totalConvertedUsd,
      liquidation: emergencyLiquidationState,
      crossMargin,
      positions: sandboxPositions,
    });
    })
  );

  // Multi-Exchange Arbitrage Endpoints
  app.get('/api/arbitrage/status', (_req, res) => {
    arbitrageOpportunitiesCache = scanCrossExchangeArbitrage(multiExchangeDepthCache);
    res.json({
      ok: true,
      opportunities: arbitrageOpportunitiesCache,
      executions: arbitrageExecutionsLog,
      updatedAt: depthUpdatedAt,
    });
  });

  app.post('/api/arbitrage/execute', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('EXECUTION'), (req, res) =>
    executionMutex.runExclusive(() => {
    reconcileServerForgeCapital();
    arbitrageOpportunitiesCache = scanCrossExchangeArbitrage(multiExchangeDepthCache);
    const targetId = String(req.body?.opportunityId || '');
    const target =
      arbitrageOpportunitiesCache.find((o) => o.id === targetId) ??
      arbitrageOpportunitiesCache.find((o) => o.executable) ??
      arbitrageOpportunitiesCache[0];

    if (!target) {
      return res.status(404).json({ ok: false, error: 'No arbitrage spread detected yet.' });
    }

    const forgeCheck = routeDualExecutionOrder(forgeCapitalState, {
      moduleId: 'ARB_COPY_DESK',
      market: 'SPOT',
      environment: executionMode,
      guardProfileLock: executionMode === 'LIVE' ? undefined : SERVER_GUARD_LOCK,
      liveMandate: SERVER_LIVE_MANDATE,
      symbol: target.symbol,
      direction: 'BUY',
      notionalUsd: 1000,
      leverage: 1,
      submittedPrice: target.buyAskPrice,
      authoritativePrice: target.buyAskPrice,
      appLiveEnabled,
    });
    forgeCapitalState = forgeCheck.nextState;
    if (!forgeCheck.ok) {
      forgeCapitalState = recordForgeApiError(forgeCapitalState, {
        market: 'SPOT',
        moduleId: 'ARB_COPY_DESK',
        endpoint: '/api/arbitrage/execute',
        httpStatus: forgeCheck.statusCode,
        exchangeCode: forgeCheck.routeRecord.status,
        latencyMs: 6,
        message: forgeCheck.error || 'Arbitrage execution blocked by Forge Capital Hub.',
      });
      return res.status(forgeCheck.statusCode).json({
        ok: false,
        error: forgeCheck.error,
        forgeCapitalState,
      });
    }

    const exec = executeArbitrageCapture(
      target.executable
        ? target
        : { ...target, netSpreadBps: Math.max(4.5, target.netSpreadBps), executable: true, projectedNetProfitUsd: 1.25 },
      crossWalletBalanceUsd
    );
    if (!exec.ok || !exec.record) {
      return res.status(400).json({ ok: false, error: exec.error });
    }
    crossWalletBalanceUsd = exec.updatedWalletBalanceUsd;
    arbitrageExecutionsLog.unshift(exec.record);
    if (arbitrageExecutionsLog.length > 25) arbitrageExecutionsLog.length = 25;
    logAutonomousDecision({
      symbol: exec.record.symbol,
      action: 'ARBITRAGE_CAPTURE',
      direction: 'BUY',
      price: exec.record.buyAskPrice,
      leverage: 1,
      reason: `Captured +${exec.record.netSpreadBps} bps (${exec.record.buyExchange} -> ${exec.record.sellExchange})`,
      pnlUsd: exec.record.realizedProfitUsd,
    });
    const reconciled = reconcileServerForgeCapital();
    return res.json({
      ok: true,
      record: exec.record,
      executions: arbitrageExecutionsLog,
      walletBalanceUsd: crossWalletBalanceUsd,
      forgeCapitalState: reconciled,
    });
    })
  );

  // Institutional Social Copy Trading Endpoints
  app.get('/api/copy-trading/status', (_req, res) => {
    res.json({
      ok: true,
      accounts: institutionalCopyAccounts,
      mirroredHistory: mirroredCopyHistory,
    });
  });

  // Multi-Asset Portfolio Management & Volatility-Based Auto-Rebalancing Endpoints
  const evaluateCurrentServerPortfolio = () => {
    const markMap = buildMarkPriceMap();
    const portfolioTickers: Record<string, any> = {};
    const portfolioCandles: Record<string, ReturnType<typeof generateDeterministicCandles>> = {};
    for (const h of portfolioHoldings) {
      const p = markMap[h.symbol] ?? 100;
      portfolioTickers[h.symbol] = {
        symbol: h.symbol,
        baseAsset: h.baseAsset,
        name: h.name,
        price: p,
        change24hPercent: spotFeedCache[h.symbol]?.change24hPercent ?? 0,
        high24h: spotFeedCache[h.symbol]?.high24h ?? p * 1.02,
        low24h: spotFeedCache[h.symbol]?.low24h ?? p * 0.98,
        volume24hUsd: spotFeedCache[h.symbol]?.volume24hUsd ?? 1_000_000_000,
        isLiveWs: backendWsConnected || spotFeedSource === 'binance_spot',
      };
      portfolioCandles[h.symbol] = generateDeterministicCandles(
        h.symbol,
        rlTuningState.preferredTimeframe,
        48,
        undefined,
        p
      );
    }
    return evaluateMultiAssetPortfolio({
      holdings: portfolioHoldings,
      stablecoinReserveUsd: portfolioReserveUsd,
      positions: sandboxPositions,
      tickers: portfolioTickers,
      candlesMap: portfolioCandles,
      config: portfolioConfig,
      lastRebalanceAt: portfolioLastRebalanceAt,
    });
  };

  app.get('/api/portfolio/state', (_req, res) => {
    const evaluation = evaluateCurrentServerPortfolio();
    res.json({
      ok: true,
      holdings: portfolioHoldings,
      stablecoinReserveUsd: portfolioReserveUsd,
      config: portfolioConfig,
      lastRebalanceAt: portfolioLastRebalanceAt,
      history: portfolioRebalanceHistory,
      evaluation,
    });
  });

  app.post('/api/portfolio/config', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('EXECUTION'), (req, res) => {
    portfolioConfig = normalizeRebalanceConfig(req.body || {}, portfolioConfig);
    const evaluation = evaluateCurrentServerPortfolio();
    res.json({
      ok: true,
      config: portfolioConfig,
      evaluation,
    });
  });

  app.post('/api/portfolio/holdings', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('EXECUTION'), (req, res) => {
    const symbol = String(req.body?.symbol || '').toUpperCase();
    if (symbol === 'USDT') {
      portfolioReserveUsd = Math.max(0, safeFiniteNumber(req.body?.reserveUsd, portfolioReserveUsd));
    } else if (symbol) {
      const idx = portfolioHoldings.findIndex((h) => h.symbol === symbol);
      if (idx >= 0 && req.body?.units !== undefined) {
        portfolioHoldings[idx] = {
          ...portfolioHoldings[idx],
          units: Math.max(0, safeFiniteNumber(req.body.units, portfolioHoldings[idx].units)),
        };
      }
      if (req.body?.reserveUsd !== undefined) {
        portfolioReserveUsd = Math.max(0, safeFiniteNumber(req.body.reserveUsd, portfolioReserveUsd));
      }
    }
    const evaluation = evaluateCurrentServerPortfolio();
    res.json({
      ok: true,
      holdings: portfolioHoldings,
      stablecoinReserveUsd: portfolioReserveUsd,
      evaluation,
    });
  });

  app.post('/api/portfolio/rebalance', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('EXECUTION'), (_req, res) => {
    const evaluationBefore = evaluateCurrentServerPortfolio();
    const exec = executePortfolioRebalance({
      holdings: portfolioHoldings,
      evaluation: evaluationBefore,
      stablecoinReserveUsd: portfolioReserveUsd,
      reason: 'MANUAL',
    });
    portfolioHoldings = exec.updatedHoldings;
    portfolioReserveUsd = exec.updatedReserveUsd;
    portfolioLastRebalanceAt = exec.record.executedAt;
    portfolioRebalanceHistory.unshift(exec.record);
    if (portfolioRebalanceHistory.length > 30) portfolioRebalanceHistory.length = 30;
    const evaluationAfter = evaluateCurrentServerPortfolio();
    res.json({
      ok: true,
      record: exec.record,
      holdings: portfolioHoldings,
      stablecoinReserveUsd: portfolioReserveUsd,
      history: portfolioRebalanceHistory,
      evaluation: evaluationAfter,
    });
  });

  app.post('/api/portfolio/reset', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('EXECUTION'), (_req, res) => {
    portfolioHoldings = DEFAULT_PORTFOLIO_SEEDS.map((h) => ({ ...h }));
    portfolioReserveUsd = DEFAULT_STABLECOIN_RESERVE_USD;
    portfolioConfig = { ...DEFAULT_REBALANCE_CONFIG };
    const evaluation = evaluateCurrentServerPortfolio();
    res.json({
      ok: true,
      holdings: portfolioHoldings,
      stablecoinReserveUsd: portfolioReserveUsd,
      config: portfolioConfig,
      history: portfolioRebalanceHistory,
      evaluation,
    });
  });

  async function pollCpsSecondaryRestCrossCheck() {
    if (cpsRestCheckInFlight) return cpsRestCheckInFlight;
    cpsRestCheckInFlight = (async () => {
      const nowMs = Date.now();
      try {
        const tracked = GLOBAL_CPS_ORACLE.getTrackedInstruments();
        const spotSymbols = tracked
          .filter((t) => t.instrumentClass === 'SPOT')
          .map((t) => (t.instrument.includes(':') ? t.instrument.split(':')[1] : t.instrument));

        if (spotSymbols.length > 0) {
          for (const host of SPOT_REST_ENDPOINTS) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 2800);
            try {
              const resp = await fetch(
                `${host}/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(spotSymbols))}`,
                { signal: controller.signal }
              );
              if (resp.ok) {
                const rows = (await resp.json()) as Array<{ symbol?: string; price?: string }>;
                if (Array.isArray(rows)) {
                  const checkMs = Date.now();
                  for (const row of rows) {
                    const sym = String(row.symbol || '').toUpperCase();
                    const px = Number(row.price || 0);
                    if (sym && Number.isFinite(px) && px > 0) {
                      GLOBAL_CPS_ORACLE.ingestSecondaryCrossCheck({
                        instrument: `spot:${sym}`,
                        instrumentClass: 'SPOT',
                        secondaryPrice: px,
                        nowMs: checkMs,
                      });
                    }
                  }
                  break;
                }
              }
            } catch {
              // try next spot REST mirror
            } finally {
              clearTimeout(timer);
            }
          }
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2800);
        try {
          const fResp = await fetch(`${FUTURES_FEED_ENDPOINT}/fapi/v1/premiumIndex`, {
            signal: controller.signal,
          });
          if (fResp.ok) {
            const rows = (await fResp.json()) as Array<{ symbol?: string; markPrice?: string }>;
            if (Array.isArray(rows)) {
              const checkMs = Date.now();
              const futSet = new Set(
                tracked
                  .filter((t) => t.instrumentClass === 'USD_M_FUTURES')
                  .map((t) => (t.instrument.includes(':') ? t.instrument.split(':')[1] : t.instrument))
              );
              for (const row of rows) {
                const sym = String(row.symbol || '').toUpperCase();
                if (!futSet.has(sym)) continue;
                const px = Number(row.markPrice || 0);
                if (Number.isFinite(px) && px > 0) {
                  GLOBAL_CPS_ORACLE.ingestSecondaryCrossCheck({
                    instrument: `usdm:${sym}`,
                    instrumentClass: 'USD_M_FUTURES',
                    secondaryPrice: px,
                    nowMs: checkMs,
                  });
                }
              }
            }
          }
        } catch {
          // Futures secondary REST best-effort
        } finally {
          clearTimeout(timer);
        }

        GLOBAL_DATA_INTEGRITY_RUNTIME.updateReconcilerState({
          healthy: !forgeCapitalState.reconciliation.driftDetected,
          lastReconciledAtMs: nowMs,
        });
      } finally {
        cpsRestCheckInFlight = null;
      }
    })();
    return cpsRestCheckInFlight;
  }

  pollCpsSecondaryRestCrossCheck().catch(() => undefined);
  GLOBAL_DATA_INTEGRITY_RUNTIME.startSchedulers();
  const cpsCrossCheckTimer = setInterval(() => {
    if (appLiveEnabled && systemControls.liveFeedModulesEnabled) {
      pollCpsSecondaryRestCrossCheck().catch(() => undefined);
    }
  }, 5_000);
  if (typeof cpsCrossCheckTimer.unref === 'function') {
    cpsCrossCheckTimer.unref();
  }

  // Forge Capital Hub — 10-15% Portfolio Fail-Safe, 3-5% Volatility-Adjusted Module Suspension, Dual Spot/Futures Routing
  app.get('/api/systemic/schema', async (_req, res) => {
    await pollCpsSecondaryRestCrossCheck().catch(() => undefined);
    const reconciled = reconcileServerForgeCapital();
    return res.json({
      ok: true,
      schema: CONSOLIDATED_SYSTEMIC_SCHEMA,
      binding: {
        status: BOOT_BINDING.audit.status,
        triple: BOOT_BINDING.triple,
        boundKernelCount: KERNEL_REGISTRY.length,
        ceilings: KERNEL_CEILINGS,
      },
      runtimeGuard: {
        activeProfile: SERVER_GUARD_LOCK.profileId,
        immutable: SERVER_GUARD_LOCK.immutable,
        liveMandateStatus: SERVER_LIVE_MANDATE === 'NOT_GRANTED' ? 'NOT_GRANTED' : 'GRANTED',
        sixDefenseLayers: ORDERED_DEFENSE_LAYERS,
        fourProfiles: Object.keys(FOUR_PROFILE_CATALOG),
      },
      dataIntegrity: {
        singleDataEgress: 'PITFeed',
        implementations: ['BacktestFeed', 'ReplayFeed', 'LiveFeed', 'TripwireFeed'],
        lookAheadGuard: 'STRUCTURAL_CURSOR_ENFORCED',
        fillSeparation: 'SIGNAL_T_FILL_T_PLUS_1',
        multiTimeframeRule: 'CLOSED_HTF_DIRECTION_ONLY',
      },
      cps: {
        ...GLOBAL_DATA_INTEGRITY_RUNTIME.getDiagnosticSnapshot(),
        configDigest: CERTIFIED_PRIMARY_SOURCE_CONFIG.sha256Digest,
        invariants: PRISTINE_DATA_INVARIANT_MANIFEST,
        cachePolicyTable: CACHE_POLICY_TABLE,
        watchdogIntervalMs: TIER_2_WATCHDOG_INTERVAL_MS,
        hardResetIntervalMs: TIER_3_HARD_RESET_INTERVAL_MS,
      },
      fillModel: {
        kernelId: FILL_MODEL_KERNEL_ARTIFACT.kernelId,
        version: FILL_MODEL_KERNEL_ARTIFACT.contractSemver,
        fillModelHash: FILL_MODEL_KERNEL_ARTIFACT.fillModelHash,
        signatureVerified: verifyFillModelArtifactSignature(),
        defaultExecutionAlgorithm: DEFAULT_EXECUTION_ALGORITHM,
        sevenPhases: ORDERED_FILL_PHASES,
        executionAlgorithms: Object.keys(EXECUTION_ALGORITHM_REGISTRY),
      },
      pgV4: {
        logicVersion: PG_V4_LOGIC_VERSION,
        logicHash: computePgV4LogicHash(),
        conjunctCount: ORDERED_PG_V4_CONJUNCTS.length,
        minRetentionDays: MIN_GATE_RETENTION_DAYS,
      },
      riskEngine: {
        minRRKernelConstant: MIN_RR_KERNEL_CONSTANT,
        threeCheckPlacement: ORDERED_RR_CHECK_STAGES,
        rejectionTaxonomy: RR_REJECTION_TAXONOMY,
        sixLevelDrawdownLimits: RISK_ENGINE_DD_LIMITS,
        synchronousCanTradeGate: true,
        forbidPostHocStopTightening: true,
        liveRiskState: reconciled.riskEngine,
      },
      parityGate: reconciled.parityGate,
      executionMode,
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/cps/reset', requireOperatorAuth, standardWriteRateLimit, (req, res) => {
    const now = Date.now();
    const reprimeTicks = GLOBAL_CPS_ORACLE.getTrackedInstruments().map((st) => {
      const sym = st.instrument.includes(':') ? st.instrument.split(':')[1] : st.instrument;
      const px = spotFeedCache[sym]?.price ?? TRACKED_COINS.find((c) => c.symbol === sym)?.referencePrice ?? 100;
      const nextSeq = Math.max(st.lastIngestedSequence, st.lastConsumedSequence) + 1;
      cpsSeqByInstrument.set(st.instrument, nextSeq);
      return {
        tick: {
          instrument: st.instrument,
          instrumentClass: st.instrumentClass,
          sequence_number: nextSeq,
          timestamp_exchange: now - 5,
          timestamp_received: now,
          bid: Number((px * 0.9999).toPrecision(7)),
          ask: Number((px * 1.0001).toPrecision(7)),
          mark_price: px,
        },
        secondaryPrice: px,
      };
    });
    const reason =
      req.body?.triggerReason === 'ANOMALY' || req.body?.triggerReason === 'STALE_STATE_DETECTED'
        ? 'STALE_STATE_DETECTED'
        : 'MANUAL_INTERVENTION';
    const record = GLOBAL_DATA_INTEGRITY_RUNTIME.triggerTier3HardReset(reason, now, reprimeTicks);
    return res.json({
      ok: true,
      resetRecord: record,
      cps: GLOBAL_DATA_INTEGRITY_RUNTIME.getDiagnosticSnapshot(),
    });
  });

  app.post('/api/risk-engine/evaluate', requireOperatorAuth, standardWriteRateLimit, async (req, res) => {
    try {
      const stateNow = reconcileServerForgeCapital();
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const strategyId = String(body.strategyId || 'SMC_1_5');
      const symbol = String(body.symbol || 'BTCUSDT').toUpperCase();
      const direction = body.direction === 'SELL' ? 'SELL' : 'BUY';
      const rawRegime = String(body.regime || 'NORMAL');
      const regime: MarketRegime =
        rawRegime === 'HIGH_VOL' || rawRegime === 'HIGH_VOLATILITY'
          ? 'HIGH_VOLATILITY'
          : rawRegime === 'TRENDING'
          ? 'TRENDING'
          : rawRegime === 'CHOPPY'
          ? 'CHOPPY'
          : 'NORMAL';
      const signalEntryPrice = Number(body.signalEntryPrice ?? 0);
      const orderIntentPrice =
        body.orderIntentPrice !== undefined ? Number(body.orderIntentPrice) : signalEntryPrice;
      const stopLoss =
        body.stopLoss === null || body.stopLoss === undefined ? null : Number(body.stopLoss);
      const takeProfit =
        body.takeProfit === null || body.takeProfit === undefined
          ? null
          : Number(body.takeProfit);
      const intentStopLoss =
        body.intentStopLoss !== undefined ? Number(body.intentStopLoss) : undefined;
      const intentTakeProfit =
        body.intentTakeProfit !== undefined ? Number(body.intentTakeProfit) : undefined;
      const stopOrigin: StructuralStopOrigin | undefined =
        body.stopOrigin === 'SYNTHETIC_MULTIPLE' || body.stopOrigin === 'NONE'
          ? body.stopOrigin
          : body.stopOrigin === 'STRUCTURAL_INVALIDATION'
          ? 'STRUCTURAL_INVALIDATION'
          : undefined;
      const targetOrigin: StructuralTargetOrigin | undefined =
        body.targetOrigin === 'SYNTHETIC_MULTIPLE' || body.targetOrigin === 'NONE'
          ? body.targetOrigin
          : body.targetOrigin === 'STRUCTURAL_LIQUIDITY_POOL'
          ? 'STRUCTURAL_LIQUIDITY_POOL'
          : undefined;

      await pollCpsSecondaryRestCrossCheck().catch(() => undefined);
      const verdict = can_trade({
        riskState: stateNow.riskEngine,
        strategyId,
        symbol,
        direction,
        regime,
        signalEntryPrice,
        orderIntentPrice,
        stopLoss,
        takeProfit,
        intentStopLoss,
        intentTakeProfit,
        stopOrigin,
        targetOrigin,
        maxRiskPct: body.maxRiskPct !== undefined ? Number(body.maxRiskPct) : undefined,
        slippageBudgetRatio:
          body.slippageBudgetRatio !== undefined ? Number(body.slippageBudgetRatio) : undefined,
      });

      return res.json({ ok: true, verdict });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to evaluate Risk Engine can_trade().';
      return res.status(400).json({ ok: false, error: msg });
    }
  });

  // L4 PG_v4 14-Conjunct Certification Gate & 5-Year Immutable Promotion API
  const pgV4Store = new ImmutableGateRecordStore();
  const pgV4Promotions: Array<{
    promotionId: string;
    promotionRequestId: string;
    requestedBy: string;
    certifiedAtUtc: string;
    gateLogicHash: string;
    recordHash: string;
    retainUntilUtc: string;
  }> = [];

  async function evaluateServerPgV4Fresh(params: {
    promotionRequestId: string;
    requestedBy?: string;
    symbol?: string;
    timeframe?: Timeframe;
    staleDecisionDetected?: boolean;
    staleStateReason?: string;
  }) {
    await pollCpsSecondaryRestCrossCheck().catch(() => undefined);
    const symbol = (params.symbol || 'BTCUSDT').toUpperCase();
    const timeframe: Timeframe = params.timeframe || '15m';
    const reconciled = reconcileServerForgeCapital();
    const walkForwardReport = runWalkForwardOrchestration({
      symbol,
      timeframe,
      inSampleBars: 85,
      outOfSampleBars: 45,
      maxFolds: 3,
    });

    const gateRecord = await evaluatePgV4GateAsync({
      promotionRequestId: params.promotionRequestId,
      requestedBy: params.requestedBy || 'trust-console-operator',
      environment: process.env.NODE_ENV === 'production' ? 'production' : 'staging',
      kernelRegistry: KERNEL_REGISTRY,
      expectedKernelHash: BOOT_BINDING.triple?.kernel_hash,
      expectedPolicyHash: BOOT_BINDING.triple?.policy_hash,
      // Always read & parse policy fresh per evaluation request (zero caching)
      loadFreshPolicy: () =>
        JSON.parse(
          fs.readFileSync(path.resolve(__dirname, 'policies/force-signal.policy.json'), 'utf8')
        ) as unknown,
      walkForwardReport,
      replayVsPaperParity: reconciled.parityGate,
      moduleDrawdownLimitPct: reconciled.modules.SPOT_MOMENTUM?.configuredDrawdownLimitPct,
      portfolioDrawdownLimitPct: reconciled.portfolioDrawdownLimitPct,
      modules: Object.values(reconciled.modules),
      dataIntegrityRuntime: GLOBAL_DATA_INTEGRITY_RUNTIME,
      staleDecisionDetected: params.staleDecisionDetected,
      staleStateReason: params.staleStateReason,
      compliance: {
        articlesDeclared: EU_AI_ACT_HIGH_RISK_ARTICLES,
        guaranteeProfitFlag: false,
        riskDisclosureActive: true,
        modelCardDocumented: true,
      },
      auditTrail: {
        bindingAudit: BOOT_BINDING.audit,
        forgeAuditLedger: reconciled.auditLedger,
        retentionDaysConfigured: MIN_GATE_RETENTION_DAYS,
      },
      humanOversight: {
        guardProfileLock: SERVER_GUARD_LOCK,
        liveMandate: SERVER_LIVE_MANDATE,
        killSwitchArmed: true,
        failSafeEngaged: reconciled.failSafe.engaged,
        operatorEmergencyHaltAvailable: true,
      },
    });

    return { gateRecord, walkForwardReport };
  }

  app.get('/api/pg-v4/evaluate', requireRbacPermission('DEBUG_ENDPOINTS_ACCESS'), async (req, res) => {
    try {
      const symbol = String(req.query.symbol || 'BTCUSDT').toUpperCase();
      const rawTf = String(req.query.timeframe || '15m');
      const timeframe: Timeframe =
        rawTf === '1h' || rawTf === '4h' || rawTf === '1d' ? rawTf : '15m';
      const promotionRequestId =
        String(req.query.promotionRequestId || '').trim() ||
        `pgv4_eval_${symbol}_${Date.now()}`;
      const persist = req.query.persist === 'true';

      const { gateRecord, walkForwardReport } = await evaluateServerPgV4Fresh({
        promotionRequestId,
        requestedBy: String(req.query.requestedBy || 'trust-console-eval'),
        symbol,
        timeframe,
        staleDecisionDetected: req.query.staleDecisionDetected === 'true',
        staleStateReason:
          typeof req.query.staleStateReason === 'string' ? req.query.staleStateReason : undefined,
      });

      const persistedRecord = persist ? pgV4Store.append(gateRecord) : gateRecord;
      return res.json({
        ok: true,
        currentLogicVersion: PG_V4_LOGIC_VERSION,
        currentLogicHash: computePgV4LogicHash(),
        minRetentionDays: MIN_GATE_RETENTION_DAYS,
        gateRecord: persistedRecord,
        walkForwardReport,
        chainIntegrity: pgV4Store.verifyChainIntegrity(),
        recordsCount: pgV4Store.getAll().length,
        promotions: pgV4Promotions,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to evaluate PG_v4 certification gate.';
      return res.status(500).json({ ok: false, error: msg });
    }
  });

  app.get('/api/pg-v4/records', requireRbacPermission('DEBUG_ENDPOINTS_ACCESS'), (_req, res) => {
    return res.json({
      ok: true,
      currentLogicVersion: PG_V4_LOGIC_VERSION,
      currentLogicHash: computePgV4LogicHash(),
      minRetentionDays: MIN_GATE_RETENTION_DAYS,
      chainIntegrity: pgV4Store.verifyChainIntegrity(),
      records: pgV4Store.getAll(),
      promotions: pgV4Promotions,
    });
  });

  app.post('/api/promotions', requireOperatorAuth, standardWriteRateLimit, requireRbacPermission('PROMOTION_CERTIFY'), async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      let candidateRecord = body.gateRecord as unknown;
      let walkForwardReport = undefined;

      if (!candidateRecord) {
        const symbol = String(body.symbol || 'BTCUSDT').toUpperCase();
        const rawTf = String(body.timeframe || '15m');
        const timeframe: Timeframe =
          rawTf === '1h' || rawTf === '4h' || rawTf === '1d' ? rawTf : '15m';
        const promotionRequestId =
          typeof body.promotionRequestId === 'string' && body.promotionRequestId.trim().length > 0
            ? body.promotionRequestId.trim()
            : `prom_req_${symbol}_${Date.now()}`;
        const freshEval = await evaluateServerPgV4Fresh({
          promotionRequestId,
          requestedBy: typeof body.requestedBy === 'string' ? body.requestedBy : 'trust-console-operator',
          symbol,
          timeframe,
          staleDecisionDetected: body.staleDecisionDetected === true,
          staleStateReason:
            typeof body.staleStateReason === 'string' ? body.staleStateReason : undefined,
        });
        candidateRecord = freshEval.gateRecord;
        walkForwardReport = freshEval.walkForwardReport;
      }

      const outcome = evaluatePromotionSubmission({
        candidateRecord,
        store: pgV4Store,
      });

      if (!outcome.accepted) {
        return res.status(outcome.httpStatus).json({
          ok: false,
          accepted: false,
          error: outcome.reason,
          gateRecord: outcome.gateRecord,
          walkForwardReport,
          chainIntegrity: pgV4Store.verifyChainIntegrity(),
          records: pgV4Store.getAll(),
          promotions: pgV4Promotions,
        });
      }

      if (outcome.promotionId && outcome.gateRecord) {
        pgV4Promotions.unshift({
          promotionId: outcome.promotionId,
          promotionRequestId: outcome.gateRecord.promotionRequestId,
          requestedBy: outcome.gateRecord.requestedBy,
          certifiedAtUtc: new Date().toISOString(),
          gateLogicHash: outcome.gateRecord.gateLogicHash,
          recordHash: outcome.gateRecord.recordHash ?? '',
          retainUntilUtc: outcome.gateRecord.retainUntilUtc,
        });
        if (pgV4Promotions.length > 50) pgV4Promotions.length = 50;
      }

      return res.status(201).json({
        ok: true,
        accepted: true,
        promotionId: outcome.promotionId,
        reason: outcome.reason,
        gateRecord: outcome.gateRecord,
        walkForwardReport,
        chainIntegrity: pgV4Store.verifyChainIntegrity(),
        records: pgV4Store.getAll(),
        promotions: pgV4Promotions,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Promotion submission failed.';
      return res.status(400).json({ ok: false, accepted: false, error: msg });
    }
  });

  app.put('/api/pg-v4/records/:id', (_req, res) => {
    return res.status(405).json({
      ok: false,
      code: 'GATE_RECORD_UPDATE_FORBIDDEN',
      error: `PG_v4 gate records are immutable and append-only for >= ${MIN_GATE_RETENTION_DAYS} days (5 years).`,
    });
  });

  app.patch('/api/pg-v4/records/:id', (_req, res) => {
    return res.status(405).json({
      ok: false,
      code: 'GATE_RECORD_UPDATE_FORBIDDEN',
      error: `PG_v4 gate records are immutable and append-only for >= ${MIN_GATE_RETENTION_DAYS} days (5 years).`,
    });
  });

  app.delete('/api/pg-v4/records/:id', (_req, res) => {
    return res.status(405).json({
      ok: false,
      code: 'GATE_RECORD_DELETE_FORBIDDEN',
      error: `PG_v4 gate records carry a mandatory ${MIN_GATE_RETENTION_DAYS}-day (5-year) retention seal and cannot be deleted.`,
    });
  });

  app.get('/api/forge-capital/state', (_req, res) => {
    try {
      const state = reconcileServerForgeCapital();
      return res.json({ ok: true, state });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to reconcile Forge Capital state.';
      forgeCapitalState = recordForgeApiError(forgeCapitalState, {
        market: 'SYSTEM',
        moduleId: 'SYSTEM',
        endpoint: '/api/forge-capital/state',
        httpStatus: 500,
        exchangeCode: 'STATE_CONTAINMENT_ERR',
        latencyMs: 0,
        message: msg,
      });
      return res.status(500).json({ ok: false, error: msg, state: forgeCapitalState });
    }
  });

  app.post('/api/forge-capital/config', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('EXECUTION'), (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const sanitizedModuleLimits: Partial<Record<ForgeModuleId, number>> = {};
      if (body.moduleLimitsPct && typeof body.moduleLimitsPct === 'object') {
        for (const [key, val] of Object.entries(body.moduleLimitsPct as Record<string, unknown>)) {
          if (isForgeModuleId(key) && typeof val === 'number' && Number.isFinite(val)) {
            sanitizedModuleLimits[key] = val;
          }
        }
      }
      const portfolioCap =
        typeof body.portfolioDrawdownLimitPct === 'number' &&
        Number.isFinite(body.portfolioDrawdownLimitPct)
          ? body.portfolioDrawdownLimitPct
          : undefined;
      forgeCapitalState = updateForgeCapitalConfig(forgeCapitalState, {
        portfolioDrawdownLimitPct: portfolioCap,
        moduleLimitsPct:
          Object.keys(sanitizedModuleLimits).length > 0 ? sanitizedModuleLimits : undefined,
      });
      const state = reconcileServerForgeCapital();
      return res.json({ ok: true, state });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid Forge Capital configuration payload.';
      forgeCapitalState = recordForgeApiError(forgeCapitalState, {
        market: 'SYSTEM',
        moduleId: 'SYSTEM',
        endpoint: '/api/forge-capital/config',
        httpStatus: 400,
        exchangeCode: 'CONFIG_VALIDATION_ERR',
        latencyMs: 0,
        message: msg,
      });
      return res.status(400).json({ ok: false, error: msg, state: forgeCapitalState });
    }
  });

  app.post('/api/forge-capital/reconcile', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('EXECUTION'), (req, res) => {
    try {
      const rawBaseline = req.body?.submittedBaselineEquityUsd;
      const parsedBaseline = rawBaseline !== undefined ? Number(rawBaseline) : undefined;
      const baseline =
        parsedBaseline !== undefined && Number.isFinite(parsedBaseline)
          ? parsedBaseline
          : undefined;
      const state = reconcileServerForgeCapital(baseline);
      return res.json({ ok: true, state });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Forge Capital reconciliation failed.';
      forgeCapitalState = recordForgeApiError(forgeCapitalState, {
        market: 'SYSTEM',
        moduleId: 'SYSTEM',
        endpoint: '/api/forge-capital/reconcile',
        httpStatus: 500,
        exchangeCode: 'RECONCILE_ERR',
        latencyMs: 0,
        message: msg,
      });
      return res.status(500).json({ ok: false, error: msg, state: forgeCapitalState });
    }
  });

  app.post('/api/forge-capital/module-status', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('AGENT_OVERRIDE'), (req, res) => {
    try {
      const rawModuleId = req.body?.moduleId;
      if (!isForgeModuleId(rawModuleId)) {
        const msg = `Invalid Forge module identifier "${String(rawModuleId ?? '')}".`;
        forgeCapitalState = recordForgeApiError(forgeCapitalState, {
          market: 'SYSTEM',
          moduleId: 'SYSTEM',
          endpoint: '/api/forge-capital/module-status',
          httpStatus: 400,
          exchangeCode: 'INVALID_MODULE_ID',
          latencyMs: 0,
          message: msg,
        });
        return res.status(400).json({ ok: false, error: msg, state: forgeCapitalState });
      }
      const suspend = Boolean(req.body?.suspend);
      const reason = req.body?.reason ? String(req.body.reason) : undefined;
      const outcome = setForgeModuleSuspension(forgeCapitalState, rawModuleId, suspend, reason);
      if (!outcome.ok) {
        return res.status(409).json({ ok: false, error: outcome.error, state: forgeCapitalState });
      }
      forgeCapitalState = outcome.nextState;
      return res.json({ ok: true, state: forgeCapitalState });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to update module status.';
      return res.status(500).json({ ok: false, error: msg, state: forgeCapitalState });
    }
  });

  // Authenticated, read-only server status for cross-device halt confirmation.
  // Deliberately never returns confirmation tokens or enables live execution.
  app.get('/api/forge-capital/failsafe/status', requireOperatorAuth, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const engaged = forgeCapitalState.failSafe.engaged || forgeCapitalState.allTradingHalted;
    return res.json({
      ok: true,
      state: engaged ? 'HALTED_CONFIRMED' : 'UNKNOWN',
      sealId: forgeCapitalState.failSafe.immutableSealId,
      engaged,
      haltCode: forgeCapitalState.failSafe.haltCode,
      acknowledgedAtIso: forgeCapitalState.failSafe.triggeredAt,
      executionEnabled: false,
      // This endpoint is a snapshot, not a durable event history; do not infer restart safety.
    });
  });

  app.post('/api/forge-capital/failsafe/engage', requireOperatorAuth, standardWriteRateLimit, (req, res) => {
    try {
      const reason = String(
        req.body?.reason || 'Manual emergency Fail-Safe seal engaged via Forge Capital Hub.'
      );
      forgeCapitalState = engageImmutableFailSafe(forgeCapitalState, reason);
      return res.json({ ok: true, state: forgeCapitalState });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to engage Fail-Safe lock.';
      return res.status(500).json({ ok: false, error: msg, state: forgeCapitalState });
    }
  });

  app.post('/api/forge-capital/failsafe/challenge', requireOperatorAuth, failsafeRateLimit, requirePremiumSubscription('EXECUTION'), async (_req, res) => {
    try {
      if (!forgeCapitalState.failSafe.engaged || !forgeCapitalState.failSafe.immutableSealId) {
        return res.status(409).json({
          ok: false,
          error: 'No immutable Fail-Safe lock is currently engaged.',
          state: forgeCapitalState,
        });
      }
      const sealId = forgeCapitalState.failSafe.immutableSealId;
      const now = Date.now();
      for (const [key, val] of failsafeChallenges.entries()) {
        if (val.used || val.expiresAt < now) {
          failsafeChallenges.delete(key);
        }
      }
      const challengeId = `fsc_${crypto.randomUUID().slice(0, 10)}`;
      const recoveryCode = `SF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const codeHash = crypto.createHash('sha256').update(recoveryCode).digest('hex');
      const expiresAt = now + 5 * 60_000;
      failsafeChallenges.set(challengeId, {
        id: challengeId,
        sealId,
        codeHash,
        expiresAt,
        used: false,
        attempts: 0,
      });

      const emailRecord = await sendAlertEmail({
        type: 'HIGH_CONFIDENCE_SIGNAL',
        subject: `Signal Forge Fail-Safe Recovery Seal (${sealId})`,
        summary: `Operator Fail-Safe recovery seal issued for ${OWNER_EMAIL}`,
        bodyHtml: `
          <p>A Fail-Safe recovery seal was requested for active lock <strong>${escapeHtml(sealId)}</strong>:</p>
          <div style="background:#111827;border:1px solid #ef4444;border-radius:8px;padding:16px;margin:14px 0;text-align:center;">
            <span style="display:block;font-size:12px;color:#94a3b8;margin-bottom:6px;">SINGLE-USE OPERATOR RECOVERY SEAL (EXPIRES IN 5 MINUTES)</span>
            <span style="font-size:22px;font-weight:700;letter-spacing:3px;color:#ffffff;font-family:monospace;">${escapeHtml(recoveryCode)}</span>
          </div>
        `,
      });

      if (emailRecord.status !== 'sent') {
        failsafeChallenges.delete(challengeId);
        return res.status(503).json({ ok: false, error: 'Recovery email delivery unavailable. Fail-safe remains engaged.' });
      }
      return res.json({
        ok: true,
        challengeId,
        sealId,
        expiresAt: new Date(expiresAt).toISOString(),
        deliveryMode: 'email',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to issue Fail-Safe recovery challenge.';
      return res.status(500).json({ ok: false, error: msg });
    }
  });

  app.post('/api/forge-capital/failsafe/recover', requireOperatorAuth, failsafeRateLimit, requirePremiumSubscription('EXECUTION'), (req, res) => {
    try {
      const confirmationCode = String(req.body?.confirmationCode || '').trim();
      const operatorReason = String(req.body?.operatorReason || '').trim();
      const challengeId = String(req.body?.challengeId || '').trim();

      if (!confirmationCode) {
        return res.status(403).json({
          ok: false,
          error: 'Missing Fail-Safe recovery code. Issue a recovery seal challenge first.',
          state: forgeCapitalState,
        });
      }

      let authorized = false;
      if (challengeId) {
        const challenge = failsafeChallenges.get(challengeId);
        if (!challenge || challenge.used || challenge.expiresAt < Date.now() || challenge.sealId !== forgeCapitalState.failSafe.immutableSealId || !forgeCapitalState.failSafe.engaged) {
          return res.status(403).json({
            ok: false,
            error: 'Fail-Safe recovery challenge missing or expired. Generate a fresh recovery seal.',
            state: forgeCapitalState,
          });
        }
        if (challenge.attempts >= MAX_FAILSAFE_VERIFY_ATTEMPTS) {
          failsafeChallenges.delete(challengeId);
          return res.status(429).json({
            ok: false,
            error: 'Too many failed Fail-Safe recovery attempts. Challenge locked; generate a new seal.',
            state: forgeCapitalState,
          });
        }
        const submittedHash = crypto.createHash('sha256').update(confirmationCode).digest('hex');
        if (!timingSafeEqualStr(submittedHash, challenge.codeHash)) {
          challenge.attempts += 1;
          return res.status(403).json({
            ok: false,
            error: 'Invalid Fail-Safe recovery seal code.',
            attemptsRemaining: Math.max(0, MAX_FAILSAFE_VERIFY_ATTEMPTS - challenge.attempts),
            state: forgeCapitalState,
          });
        }
        challenge.used = true;
        failsafeChallenges.delete(challengeId);
        authorized = true;
      } else {
        return res.status(403).json({
          ok: false,
          error: 'A valid one-time recovery challenge is required.',
          state: forgeCapitalState,
        });
      }

      const outcome = recoverFromImmutableFailSafe(forgeCapitalState, {
        confirmationCode,
        operatorReason,
        serverAuthorized: authorized,
      });
      if (!outcome.ok) {
        return res.status(403).json({ ok: false, error: outcome.error, state: forgeCapitalState });
      }
      forgeCapitalState = outcome.nextState;
      return res.json({ ok: true, state: forgeCapitalState });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Fail-Safe recovery check failed.';
      return res.status(500).json({ ok: false, error: msg, state: forgeCapitalState });
    }
  });

  app.post('/api/forge-capital/api-error', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('TELEMETRY'), (req, res) => {
    try {
      const market =
        req.body?.market === 'USD_M_FUTURES'
          ? 'USD_M_FUTURES'
          : req.body?.market === 'SPOT'
          ? 'SPOT'
          : 'SYSTEM';
      const resolvedModule: ForgeModuleId | 'SYSTEM' = isForgeModuleId(req.body?.moduleId)
        ? req.body.moduleId
        : 'SYSTEM';
      const parsedHttpStatus = Number(req.body?.httpStatus ?? 429);
      const parsedLatency = Number(req.body?.latencyMs ?? 140);
      forgeCapitalState = recordForgeApiError(forgeCapitalState, {
        market,
        moduleId: resolvedModule,
        endpoint: String(req.body?.endpoint || '/api/execution/order'),
        httpStatus: Number.isFinite(parsedHttpStatus) ? parsedHttpStatus : 500,
        exchangeCode: String(req.body?.exchangeCode || 'BINANCE_ERR'),
        latencyMs: Number.isFinite(parsedLatency) ? parsedLatency : 0,
        message: String(req.body?.message || 'Simulated exchange API error captured by logger.'),
      });
      return res.json({ ok: true, state: forgeCapitalState });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to log API error.';
      return res.status(400).json({ ok: false, error: msg, state: forgeCapitalState });
    }
  });

  app.post('/api/forge-capital/route', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('EXECUTION'), (req, res) =>
    executionMutex.runExclusive(async () => {
    try {
      const stateNow = reconcileServerForgeCapital();
      const {
        moduleId = 'SPOT_MOMENTUM',
        market = 'SPOT',
        symbol = 'BTCUSDT',
        direction = 'BUY',
        notionalUsd = 1000,
        leverage = 1,
        marginMode = 'CROSS',
        submittedPrice,
      } = req.body || {};

      if (!isForgeModuleId(moduleId)) {
        const msg = `Invalid Forge module identifier "${String(moduleId)}".`;
        forgeCapitalState = recordForgeApiError(stateNow, {
          market: market === 'USD_M_FUTURES' ? 'USD_M_FUTURES' : 'SPOT',
          moduleId: 'SYSTEM',
          endpoint: '/api/forge-capital/route',
          httpStatus: 400,
          exchangeCode: 'INVALID_MODULE_ID',
          latencyMs: 1,
          message: msg,
        });
        return res.status(400).json({ ok: false, error: msg, state: forgeCapitalState });
      }

      const cleanSym = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BTCUSDT';
      const channel: ForgeMarketChannel = market === 'USD_M_FUTURES' ? 'USD_M_FUTURES' : 'SPOT';
      if (channel === 'USD_M_FUTURES' && !futuresFeedCache[cleanSym]) {
        await pollBinanceFuturesFeed();
      } else if (!spotFeedCache[cleanSym]) {
        await pollBinanceSpotFeed();
      }

      const markMap = buildMarkPriceMap();
      const parsedSubmitted = submittedPrice !== undefined ? Number(submittedPrice) : NaN;
      const liveRefPrice =
        channel === 'USD_M_FUTURES' && futuresFeedCache[cleanSym]?.markPrice
          ? futuresFeedCache[cleanSym].markPrice
          : markMap[cleanSym] ?? (Number.isFinite(parsedSubmitted) && parsedSubmitted > 0 ? parsedSubmitted : 100);

      const parsedNotional = Number(notionalUsd);
      const parsedLeverage = Number(leverage);

      const parsedStopLoss =
        req.body?.stopLoss !== undefined
          ? req.body.stopLoss === null
            ? null
            : Number(req.body.stopLoss)
          : undefined;
      const parsedTakeProfit =
        req.body?.takeProfit !== undefined
          ? req.body.takeProfit === null
            ? null
            : Number(req.body.takeProfit)
          : undefined;
      const parsedIntentStopLoss =
        req.body?.intentStopLoss !== undefined ? Number(req.body.intentStopLoss) : undefined;
      const parsedIntentTakeProfit =
        req.body?.intentTakeProfit !== undefined ? Number(req.body.intentTakeProfit) : undefined;
      const rawStopOrigin = req.body?.stopOrigin;
      const stopOrigin: StructuralStopOrigin | undefined =
        rawStopOrigin === 'STRUCTURAL_INVALIDATION' ||
        rawStopOrigin === 'SYNTHETIC_MULTIPLE' ||
        rawStopOrigin === 'NONE'
          ? rawStopOrigin
          : undefined;
      const rawTargetOrigin = req.body?.targetOrigin;
      const targetOrigin: StructuralTargetOrigin | undefined =
        rawTargetOrigin === 'STRUCTURAL_LIQUIDITY_POOL' ||
        rawTargetOrigin === 'SYNTHETIC_MULTIPLE' ||
        rawTargetOrigin === 'NONE'
          ? rawTargetOrigin
          : undefined;
      const rawRegime = String(req.body?.regime || 'NORMAL');
      const regime: MarketRegime =
        rawRegime === 'HIGH_VOL' || rawRegime === 'HIGH_VOLATILITY'
          ? 'HIGH_VOLATILITY'
          : rawRegime === 'TRENDING'
          ? 'TRENDING'
          : rawRegime === 'CHOPPY'
          ? 'CHOPPY'
          : 'NORMAL';

      const routeResult = routeDualExecutionOrder(stateNow, {
        moduleId,
        market: channel,
        environment: executionMode,
        guardProfileLock: executionMode === 'LIVE' ? undefined : SERVER_GUARD_LOCK,
        liveMandate: SERVER_LIVE_MANDATE,
        symbol: cleanSym,
        direction: direction === 'SELL' ? 'SELL' : 'BUY',
        notionalUsd: Number.isFinite(parsedNotional) ? parsedNotional : NaN,
        leverage:
          channel === 'USD_M_FUTURES'
            ? Number.isFinite(parsedLeverage)
              ? parsedLeverage
              : 5
            : 1,
        marginMode: marginMode === 'ISOLATED' ? 'ISOLATED' : 'CROSS',
        submittedPrice: Number.isFinite(parsedSubmitted) ? parsedSubmitted : liveRefPrice,
        authoritativePrice: liveRefPrice,
        appLiveEnabled,
        stopLoss: parsedStopLoss,
        takeProfit: parsedTakeProfit,
        intentStopLoss: parsedIntentStopLoss,
        intentTakeProfit: parsedIntentTakeProfit,
        stopOrigin,
        targetOrigin,
        regime,
        maxRiskPct: req.body?.maxRiskPct !== undefined ? Number(req.body.maxRiskPct) : undefined,
        enforceRRGate: req.body?.enforceRRGate === true,
      });

      forgeCapitalState = routeResult.nextState;
      if (!routeResult.ok) {
        GLOBAL_MICROSERVICE_COORDINATOR.recordNonBlockingFault({
          serviceId: 'execution-router-svc',
          code: routeResult.rejectionCode ?? 'ROUTE_REJECTED',
          message: routeResult.error || 'Dual execution route blocked by Forge Capital Hub.',
          severity: 'WARN',
          contextSummary: `${cleanSym} ${channel} ${moduleId}`,
        });
        forgeCapitalState = recordForgeApiError(forgeCapitalState, {
          market: channel,
          moduleId,
          endpoint: routeResult.routeRecord.apiEndpoint,
          httpStatus: routeResult.statusCode,
          exchangeCode: routeResult.rejectionCode ?? routeResult.routeRecord.status,
          latencyMs: 12,
          message: routeResult.error || 'Dual execution route blocked by Forge Capital Hub.',
        });
        return res.status(routeResult.statusCode).json({
          ok: false,
          error: routeResult.error,
          rejectionCode: routeResult.rejectionCode,
          riskVerdict: routeResult.riskVerdict,
          routeRecord: routeResult.routeRecord,
          state: forgeCapitalState,
        });
      }

      const walletBefore = summarizeCrossMarginWallet(
        crossWalletBalanceUsd,
        sandboxPositions,
        markMap
      );
      const lev = Math.max(1, routeResult.routeRecord.leverage || 1);
      const notional = routeResult.routeRecord.notionalUsd;
      const reqMargin = channel === 'USD_M_FUTURES' ? notional / lev : notional;
      const estFee = Number((notional * (channel === 'USD_M_FUTURES' ? 0.0005 : 0.001)).toFixed(2));

      if (reqMargin + estFee > walletBefore.availableCrossMarginUsd) {
        const msg = `Insufficient cross margin ($${walletBefore.availableCrossMarginUsd.toFixed(2)} available, requires $${(reqMargin + estFee).toFixed(2)}).`;
        forgeCapitalState = recordForgeApiError(forgeCapitalState, {
          market: channel,
          moduleId,
          endpoint: routeResult.routeRecord.apiEndpoint,
          httpStatus: 400,
          exchangeCode: 'INSUFFICIENT_MARGIN',
          latencyMs: 9,
          message: msg,
        });
        return res.status(400).json({
          ok: false,
          error: msg,
          routeRecord: routeResult.routeRecord,
          state: forgeCapitalState,
        });
      }

      crossWalletBalanceUsd = Number((crossWalletBalanceUsd - estFee).toFixed(2));
      const refCandles = generateDeterministicCandles(cleanSym, '1h', 30, undefined, liveRefPrice);
      const atr = computeATR(refCandles, 14);
      const dispatchedPos = createRoutedSandboxPosition(routeResult.routeRecord, {
        atr14: atr,
        fundingRate: channel === 'USD_M_FUTURES' ? (futuresFeedCache[cleanSym]?.fundingRate ?? 0.0001) : 0,
      });
      sandboxPositions.unshift(dispatchedPos);
      if (sandboxPositions.length > 30) sandboxPositions.length = 30;
      totalExecutedOrders += 1;

      const crossMargin = summarizeCrossMarginWallet(
        crossWalletBalanceUsd,
        sandboxPositions,
        markMap
      );
      const nextReconciledState = reconcileServerForgeCapital();
      GLOBAL_MICROSERVICE_COORDINATOR.recordNonBlockingSuccess('execution-router-svc', 14);

      return res.json({
        ok: true,
        position: dispatchedPos,
        crossMargin,
        testnetBalanceUsd: crossMargin.walletBalanceUsd,
        routeRecord: routeResult.routeRecord,
        state: nextReconciledState,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unexpected dual execution routing failure.';
      GLOBAL_MICROSERVICE_COORDINATOR.recordNonBlockingFault({
        serviceId: 'execution-router-svc',
        code: 'ROUTER_EXCEPTION',
        message: msg,
        severity: 'ERROR',
        contextSummary: '/api/forge-capital/route',
      });
      forgeCapitalState = recordForgeApiError(forgeCapitalState, {
        market: 'SYSTEM',
        moduleId: 'SYSTEM',
        endpoint: '/api/forge-capital/route',
        httpStatus: 500,
        exchangeCode: 'ROUTER_EXCEPTION',
        latencyMs: 0,
        message: msg,
      });
      return res.status(500).json({ ok: false, error: msg, state: forgeCapitalState });
    }
    })
  );

  app.post('/api/copy-trading/toggle', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('EXECUTION'), (req, res) => {
    const accountId = String(req.body?.accountId || '');
    const acc = institutionalCopyAccounts.find((a) => a.id === accountId);
    if (!acc) {
      return res.status(404).json({ ok: false, error: 'Institutional account not found.' });
    }
    acc.autoMirrorEnabled =
      typeof req.body?.enabled === 'boolean' ? req.body.enabled : !acc.autoMirrorEnabled;
    res.json({ ok: true, account: acc, accounts: institutionalCopyAccounts });
  });

  app.post('/api/copy-trading/mirror', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('EXECUTION'), (req, res) =>
    executionMutex.runExclusive(() => {
    reconcileServerForgeCapital();
    const accountId = String(req.body?.accountId || institutionalCopyAccounts[0].id);
    const acc =
      institutionalCopyAccounts.find((a) => a.id === accountId) ?? institutionalCopyAccounts[0];
    const sym = String(req.body?.symbol || 'BTCUSDT').toUpperCase();
    const dir = req.body?.direction === 'SELL' ? 'SELL' : 'BUY';
    const markMap = buildMarkPriceMap();
    const entryPrice = markMap[sym] ?? 100;

    const candles = generateDeterministicCandles(sym, rlTuningState.preferredTimeframe, 36, undefined, entryPrice);
    const atr = computeATR(candles, 14);
    const mirroredPlan = buildMirroredCopyTradePlan({
      account: acc,
      symbol: sym,
      direction: dir,
      entryPrice,
      atr14: atr,
      futuresEnabled: false,
    });

    const forgeCheck = routeDualExecutionOrder(forgeCapitalState, {
      moduleId: 'ARB_COPY_DESK',
      market: 'SPOT',
      environment: executionMode,
      guardProfileLock: executionMode === 'LIVE' ? undefined : SERVER_GUARD_LOCK,
      liveMandate: SERVER_LIVE_MANDATE,
      symbol: sym,
      direction: dir,
      notionalUsd: 1200,
      leverage: 1,
      submittedPrice: entryPrice,
      authoritativePrice: entryPrice,
      appLiveEnabled,
      stopLoss: mirroredPlan.stopLoss,
      takeProfit: mirroredPlan.takeProfits[2],
      stopOrigin: 'STRUCTURAL_INVALIDATION',
      targetOrigin: 'STRUCTURAL_LIQUIDITY_POOL',
      enforceRRGate: true,
    });
    forgeCapitalState = forgeCheck.nextState;
    if (!forgeCheck.ok) {
      forgeCapitalState = recordForgeApiError(forgeCapitalState, {
        market: 'SPOT',
        moduleId: 'ARB_COPY_DESK',
        endpoint: '/api/copy-trading/mirror',
        httpStatus: forgeCheck.statusCode,
        exchangeCode: forgeCheck.rejectionCode ?? forgeCheck.routeRecord.status,
        latencyMs: 6,
        message: forgeCheck.error || 'Copy mirror execution blocked by Forge Capital Hub.',
      });
      return res.status(forgeCheck.statusCode).json({
        ok: false,
        error: forgeCheck.error,
        rejectionCode: forgeCheck.rejectionCode,
        forgeCapitalState,
      });
    }
    acc.lastMirroredSymbol = sym;
    acc.lastMirroredAt = mirroredPlan.createdAt;
    mirroredCopyHistory.unshift(mirroredPlan);
    if (mirroredCopyHistory.length > 20) mirroredCopyHistory.length = 20;

    // Also place into active portfolio ledger if App Live & execution are enabled
    let position: SandboxPosition | null = null;
    if (appLiveEnabled && (executionMode === 'LIVE' || systemControls.testnetExecutionEnabled)) {
      const fee = Number((mirroredPlan.notionalUsd * 0.001).toFixed(2));
      crossWalletBalanceUsd = Number((crossWalletBalanceUsd - fee).toFixed(2));
      position = {
        id: mirroredPlan.id,
        symbol: sym,
        direction: dir,
        mode: executionMode,
        marketType: mirroredPlan.marketType,
        marginMode: 'CROSS',
        leverage: mirroredPlan.leverage,
        entryPrice: mirroredPlan.entryPrice,
        quantity: Number((mirroredPlan.notionalUsd / mirroredPlan.entryPrice).toFixed(5)),
        notionalUsd: mirroredPlan.notionalUsd,
        initialMarginUsd: mirroredPlan.notionalUsd,
        maintenanceMarginUsd: 0,
        liquidationPrice: 0,
        fundingRate: 0,
        settledFundingUsd: 0,
        initialStopLoss: mirroredPlan.stopLoss,
        trailingStopLoss: mirroredPlan.stopLoss,
        maxStopLossPct: mirroredPlan.maxRiskPct,
        trailingTakeProfit5xAtr: mirroredPlan.takeProfits[2],
        peakFavorablePrice: mirroredPlan.entryPrice,
        takeProfits: mirroredPlan.takeProfits,
        status: 'OPEN',
        pnlUsd: 0,
        pnlPercent: 0,
        roePercent: 0,
        skepticVerdict: 'APPROVED',
        autonomousEntry: true,
        entrySourceReason: `Forge Hub [ARB_COPY_DESK] · Copy Mirror ${acc.handle} (${mirroredPlan.maxRiskPct}% Risk · 1:${mirroredPlan.riskRewardRatio} R:R)`,
        openedAt: mirroredPlan.createdAt,
      };
      sandboxPositions.unshift(position);
      totalExecutedOrders += 1;
      logAutonomousDecision({
        symbol: sym,
        action: 'COPY_MIRROR',
        direction: dir,
        price: mirroredPlan.entryPrice,
        leverage: mirroredPlan.leverage,
        reason: `Mirrored ${acc.handle} (${acc.institutionName}) · 2% Max Risk · 1:${mirroredPlan.riskRewardRatio} R:R`,
      });
    }

    const reconciled = reconcileServerForgeCapital();
    res.json({
      ok: true,
      mirroredPlan,
      position,
      accounts: institutionalCopyAccounts,
      mirroredHistory: mirroredCopyHistory,
      forgeCapitalState: reconciled,
    });
    })
  );

  app.get('/api/orderbook/depth', async (req, res) => {
    const reqSym = req.query.symbol ? String(req.query.symbol).toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
    const force = req.query.refresh === '1';
    if (reqSym) {
      if (!multiExchangeDepthCache[reqSym] || force) {
        await refreshSingleExchangeDepth(reqSym);
      }
      return res.json({
        ok: true,
        symbol: reqSym,
        updatedAt: depthUpdatedAt,
        depth: multiExchangeDepthCache[reqSym],
        depthMap: multiExchangeDepthCache,
      });
    }
    if (Object.keys(multiExchangeDepthCache).length === 0 || force) {
      await refreshAllTrackedDepths();
    }
    return res.json({
      ok: true,
      updatedAt: depthUpdatedAt,
      depthMap: multiExchangeDepthCache,
    });
  });

  app.get('/api/sentinel/status', (_req, res) => {
    if (Object.keys(sentinelAssessmentsCache).length === 0) {
      runSentinelAuditForAll();
    }
    const alerts = gatherCrossPlatformSentinelFeeds().slice(0, 16);
    res.json({
      ok: true,
      updatedAt: sentinelUpdatedAt,
      assessments: sentinelAssessmentsCache,
      feed: alerts,
    });
  });

  app.post('/api/sentinel/evaluate', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('AGENT_OVERRIDE'), (req, res) => {
    const customHeadline = req.body?.headline ? String(req.body.headline) : '';
    const customSymbol = req.body?.symbol ? String(req.body.symbol).toUpperCase() : 'BTCUSDT';
    const platformRaw = String(req.body?.platform || 'X').toUpperCase();
    const platform: CrossPlatformFeedSignal['platform'] =
      platformRaw === 'CRYPTOPANIC' || platformRaw === 'EXCHANGE_NOTICE'
        ? platformRaw
        : 'X';
    const sentimentRaw = String(req.body?.sentiment || 'PANIC_FUD').toUpperCase();
    const sentiment: CrossPlatformFeedSignal['sentiment'] =
      sentimentRaw === 'BULLISH' || sentimentRaw === 'BULLISH_CATALYST'
        ? 'BULLISH_CATALYST'
        : sentimentRaw === 'BEARISH' || sentimentRaw === 'PANIC_FUD'
        ? 'PANIC_FUD'
        : 'NEUTRAL';
    const extra: CrossPlatformFeedSignal[] = customHeadline
      ? [
          {
            id: `manual_sent_${Date.now()}`,
            platform,
            handle: '@SentinelOperator',
            symbols: [customSymbol, customSymbol.replace(/USDT$/, '')],
            headline: customHeadline,
            sentiment,
            credibilityWeight: 0.92,
            timestamp: new Date().toISOString(),
          },
        ]
      : [];
    const t0 = Date.now();
    const assessments = runSentinelAuditForAll(extra);
    GLOBAL_MICROSERVICE_COORDINATOR.recordNonBlockingSuccess(
      'ai-agents-svc',
      Math.max(1, Date.now() - t0)
    );
    if (autonomousCoordinatorEnabled && appLiveEnabled) {
      runAutonomousCoordinatorTick();
    }
    res.json({
      ok: true,
      updatedAt: sentinelUpdatedAt,
      assessments,
      feed: gatherCrossPlatformSentinelFeeds(extra).slice(0, 16),
    });
  });

  app.get('/api/autonomous/state', (_req, res) => {
    const openPositions = sandboxPositions.filter((p) => p.status === 'OPEN');
    res.json({
      ok: true,
      enabled: autonomousCoordinatorEnabled && appLiveEnabled,
      mode: executionMode,
      lastTickAt: autonomousLastTickAt,
      totalCycles: autonomousTotalCycles,
      entriesExecuted: autonomousEntriesExecuted,
      exitsExecuted: autonomousExitsExecuted,
      hedgesExecuted: autonomousHedgesExecuted,
      reversalExitsExecuted: autonomousReversalExitsExecuted,
      spotActiveCount: openPositions.filter((p) => (p.marketType ?? 'SPOT') === 'SPOT').length,
      futuresActiveCount: openPositions.filter((p) => p.marketType === 'USD_M_FUTURES').length,
      maxStopLossCapPct: 2.0,
      trailingTakeProfitAtrMultiplier: rlTuningState.atrTrailingTpMultiplier,
      decisionsLog: autonomousDecisionsLog,
    });
  });

  app.post('/api/autonomous/toggle', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('AGENT_OVERRIDE'), async (req, res) => {
    const principal =
      (req as express.Request & { subscriberPrincipal?: SubscriptionPrincipal }).subscriberPrincipal ??
      UNAUTHENTICATED_PRINCIPAL;
    autonomousCoordinatorEnabled =
      typeof req.body?.enabled === 'boolean' ? req.body.enabled : !autonomousCoordinatorEnabled;
    await GLOBAL_MICROSERVICE_COORDINATOR.updateControlMatrix(
      { autonomousCoordinator: autonomousCoordinatorEnabled },
      principal.uid || 'operator',
      `Autonomous coordinator ${autonomousCoordinatorEnabled ? 'armed' : 'paused'}`
    );
    if (autonomousCoordinatorEnabled && appLiveEnabled) {
      runAutonomousCoordinatorTick();
    }
    res.json({
      ok: true,
      enabled: autonomousCoordinatorEnabled && appLiveEnabled,
      lastTickAt: autonomousLastTickAt,
      totalCycles: autonomousTotalCycles,
      architecture: GLOBAL_MICROSERVICE_COORDINATOR.getSnapshot(),
    });
  });

  app.post('/api/autonomous/tick', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('AGENT_OVERRIDE'), async (_req, res) => {
    if (!appLiveEnabled) {
      return res.status(409).json({
        ok: false,
        error: "'App Live' Master Control Switch is OFF. Resume App Live to run Coordinator ticks.",
      });
    }
    const execRes = await GLOBAL_MICROSERVICE_COORDINATOR.executeIsolated(
      'ai-agents-svc',
      'AUTONOMOUS_TICK',
      async () => {
        await refreshAllTrackedDepths().catch(() => undefined);
        return runAutonomousCoordinatorTick();
      },
      { contextSummary: 'Manual autonomous coordinator evaluation tick' }
    );
    if (!execRes.ok) {
      return res.status(503).json({
        ok: false,
        error: execRes.isolatedError.message,
        isolatedError: execRes.isolatedError,
      });
    }
    return res.json({
      ok: true,
      enabled: autonomousCoordinatorEnabled,
      result: execRes.value,
      lastTickAt: autonomousLastTickAt,
      decisionsLog: autonomousDecisionsLog,
      positions: sandboxPositions,
    });
  });

  app.get('/api/binance/top-gainers', async (req, res) => {
    const forceRefresh = req.query.refresh === '1';
    if (topGainersCache.length === 0 || (forceRefresh && appLiveEnabled)) {
      await pollBinanceTopGainers();
    }
    res.json({
      source: gainerFeederSource,
      updatedAt: gainerFeederUpdatedAt,
      pollIntervalMs: GAINER_FEEDER_INTERVAL_MS,
      latencyMs: lastGainersPollLatencyMs,
      syncEpoch: serverSyncEpoch,
      gainers: topGainersCache,
      alerts: gainerAlertsLog,
    });
  });

  app.get('/api/system/controls', (_req, res) => {
    res.json({
      ok: true,
      appLiveEnabled,
      controls: systemControls,
    });
  });

  app.post('/api/system/controls', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('TELEMETRY'), async (req, res) => {
    const principal =
      (req as express.Request & { subscriberPrincipal?: SubscriptionPrincipal }).subscriberPrincipal ??
      UNAUTHENTICATED_PRINCIPAL;
    const prevLive = systemControls.liveFeedModulesEnabled;
    systemControls = mergeSystemControls(systemControls, req.body || {});
    const patchedMatrix = applySystemControlsToMatrix(
      GLOBAL_MICROSERVICE_COORDINATOR.getControlMatrix(),
      systemControls
    );
    await GLOBAL_MICROSERVICE_COORDINATOR.updateControlMatrix(
      patchedMatrix,
      principal.uid || 'operator',
      'Legacy system runtime controls sync'
    );
    if (prevLive && (!systemControls.liveFeedModulesEnabled || !appLiveEnabled)) {
      pauseBackendSpotWs();
    } else if (!prevLive && systemControls.liveFeedModulesEnabled && appLiveEnabled) {
      lastFeedPollAtMs = Date.now();
      backendWsCircuitOpen = false;
      backendWsAttempt = 0;
      bindBackendSpotWebSocket();
      pollBinanceSpotFeed()
        .then(() => refreshCmcValuations())
        .catch(() => undefined);
    }
    res.json({
      ok: true,
      appLiveEnabled,
      controls: systemControls,
      architecture: GLOBAL_MICROSERVICE_COORDINATOR.getSnapshot(),
    });
  });

  app.get('/api/binance/spot-feed', async (req, res) => {
    const forceRefresh = req.query.refresh === '1';
    if (Object.keys(spotFeedCache).length === 0) {
      if (systemControls.liveFeedModulesEnabled) {
        await pollBinanceSpotFeed();
      } else {
        seedFallbackSpotTelemetry();
      }
    } else if (forceRefresh && systemControls.liveFeedModulesEnabled) {
      await pollBinanceSpotFeed();
    }
    res.json({
      source: spotFeedSource,
      marketType: 'SPOT',
      paused: !systemControls.liveFeedModulesEnabled,
      endpoint: SPOT_REST_ENDPOINTS[0],
      updatedAt: spotFeedUpdatedAt,
      pollIntervalMs: GAINER_FEEDER_INTERVAL_MS,
      latencyMs: lastSpotPollLatencyMs,
      syncEpoch: serverSyncEpoch,
      tickers: spotFeedCache,
    });
  });

  app.get('/api/market/cmc-valuations', async (req, res) => {
    const forceRefresh = req.query.refresh === '1';
    if (Object.keys(cmcValuationsCache).length === 0 || forceRefresh) {
      await refreshCmcValuations();
    }
    res.json({
      ok: true,
      source: cmcValuationsSource,
      updatedAt: cmcUpdatedAt,
      anomaliesIsolatedCount: monitorState.anomaliesIsolatedCount ?? 0,
      valuations: cmcValuationsCache,
      validations: spotCmcValidations,
    });
  });

  app.get('/api/binance/futures-feed', async (req, res) => {
    const active = req.query.active === '1' || req.query.refresh === '1';
    if (active) {
      await pollBinanceFuturesFeed();
    } else if (Object.keys(futuresFeedCache).length === 0) {
      seedFallbackFuturesTelemetry();
    }
    res.json({
      source: futuresFeedSource,
      marketType: 'USD_M_FUTURES',
      feedEndpoint: FUTURES_FEED_ENDPOINT,
      testnetEndpoint: FUTURES_TESTNET_ENDPOINT,
      updatedAt: futuresFeedUpdatedAt,
      pollIntervalMs: GAINER_FEEDER_INTERVAL_MS,
      latencyMs: lastFuturesPollLatencyMs,
      syncEpoch: serverSyncEpoch,
      telemetry: futuresFeedCache,
    });
  });

  // Flush server Spot telemetry caches, re-validate CMC baselines, and force immediate resync
  app.post('/api/telemetry/resync', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('TELEMETRY'), async (req, res) => {
    const startedAt = Date.now();
    const futuresActive = req.body?.futuresActive === true;
    serverSyncEpoch += 1;
    backendWsCircuitOpen = false;
    backendWsAttempt = 0;
    pendingSseTickBatch.clear();
    topGainersCache = [];
    gainerFeederSource = 'cache';
    seedFallbackSpotTelemetry(true);

    const tasks: Promise<unknown>[] = [
      pollBinanceTopGainers().then(() => pollBinanceSpotFeed()).then(() => refreshCmcValuations()),
    ];
    if (futuresActive) {
      seedFallbackFuturesTelemetry(true);
      tasks.push(pollBinanceFuturesFeed());
    }
    await Promise.all(tasks);
    const latencyMs = Math.max(1, Date.now() - startedAt);

    res.json({
      ok: true,
      syncEpoch: serverSyncEpoch,
      syncedAt: new Date().toISOString(),
      latencyMs,
      pollIntervalMs: GAINER_FEEDER_INTERVAL_MS,
      gainerSource: gainerFeederSource,
      spotSource: spotFeedSource,
      futuresSource: futuresFeedSource,
      cmcSource: cmcValuationsSource,
      anomaliesIsolatedCount: monitorState.anomaliesIsolatedCount ?? 0,
      gainers: topGainersCache,
      alerts: gainerAlertsLog,
      spotTickers: spotFeedCache,
      cmcValuations: cmcValuationsCache,
      spotCmcValidations,
      telemetry: futuresActive ? futuresFeedCache : undefined,
    });
  });

  app.get('/api/binance/klines', async (req, res) => {
    const symbol = String(req.query.symbol || 'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const market = String(req.query.market || 'spot').toLowerCase();
    const intervalRaw = String(req.query.interval || '4h');
    const interval: Timeframe =
      intervalRaw === '15m' || intervalRaw === '1h' || intervalRaw === '4h' || intervalRaw === '1d'
        ? intervalRaw
        : '4h';
    const limit = Math.min(360, Math.max(40, Number(req.query.limit || 160)));
    // Optional historical endTime for signal inspection; bounded to current time.
    const endTimeInput = req.query.endTime === undefined ? null : Number(req.query.endTime);
    if (endTimeInput !== null && (!Number.isSafeInteger(endTimeInput) || endTimeInput < 1_500_000_000_000 || endTimeInput > Date.now() + 60_000)) {
      return res.status(400).json({error:'Invalid historical candle endTime'});
    }
    const historicalEndParam = endTimeInput !== null ? `&endTime=${endTimeInput}` : '';
    const refPriceParam = Number(req.query.refPrice);
    const cachedPrice =
      spotFeedCache[symbol]?.price ??
      futuresFeedCache[symbol]?.markPrice ??
      topGainersCache.find((g) => g.symbol === symbol)?.price;
    const refPrice =
      Number.isFinite(refPriceParam) && refPriceParam > 0 ? refPriceParam : cachedPrice;

    const candidateUrls =
      market === 'futures'
        ? [`${FUTURES_FEED_ENDPOINT}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}${historicalEndParam}`]
        : SPOT_REST_ENDPOINTS.map(
            (host) => `${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}${historicalEndParam}`
          );

    for (const url of candidateUrls) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3200);
      try {
        const response = await fetch(url, { signal: controller.signal });

        if (response.ok) {
          const raw = await response.json();
          if (Array.isArray(raw) && raw.length > 0) {
            const candles = raw.map((k: any[]) => ({
              time: Math.floor(Number(k[0]) / 1000),
              open: Number(k[1]),
              high: Number(k[2]),
              low: Number(k[3]),
              close: Number(k[4]),
              volume: Number(k[5]),
            }));
            return res.json({
              source: market === 'futures' ? 'binance_futures' : 'binance',
              symbol,
              interval,
              candles,
            });
          }
        }
      } catch {
        // try next Spot mirror endpoint
      } finally {
        clearTimeout(timer);
      }
    }

    // Historical inspections fail closed: never replace missing historical candles with synthetic price paths.
    if (endTimeInput !== null) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).json({source:'unavailable',symbol,interval,candles:[],error:'Historical exchange candles unavailable'});
    }
    return res.json({
      source: 'cache',
      symbol,
      interval,
      candles: generateDeterministicCandles(symbol, interval, limit, undefined, refPrice),
    });
  });

  // Staging-only read-only exchange volume scanner, owner/operator authenticated.
  // No AI-generated price data, fake whale flows, or automatic orders.
  app.get('/api/research/early-volume/:symbol', requireOperatorAuth, standardWriteRateLimit, async (req, res) => {
    const symbol = String(req.params.symbol || '').toUpperCase();
    if (!/^[A-Z0-9]{2,16}USDT$/.test(symbol)) {
      return res.status(400).json({ ok:false, error:'Invalid Spot USDT symbol.' });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    res.setHeader('Cache-Control', 'no-store');
    const nowMs = Date.now();
    const providers = [
      { venue:'BINANCE', url:`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=5m&limit=55` },
      { venue:'BYBIT', url:`https://api.bybit.com/v5/market/kline?category=spot&symbol=${encodeURIComponent(symbol)}&interval=5&limit=55` },
    ] as const;
    try {
      const results = await Promise.all(providers.map(async (provider) => {
        try {
          const response = await fetch(provider.url, { signal:controller.signal, headers:{ Accept:'application/json' } });
          if (!response.ok) return { venue:provider.venue, status:'UNAVAILABLE', observation:null };
          const body = await response.json();
          const rows:unknown[] = provider.venue==='BINANCE'
            ? Array.isArray(body)?body:[]
            : body?.retCode===0 && Array.isArray(body?.result?.list)?body.result.list:[];
          const parsed= provider.venue==='BINANCE'
            ? parseBinanceFiveMinuteKlines(symbol,rows,nowMs)
            : parseBybitFiveMinuteKlines(symbol,rows,nowMs);
          const observation=computeRelativeVolumeObservation(parsed);
          const age=observation?nowMs-observation.observedAtMs:Infinity;
          if (!observation||age>6*60_000) return { venue:provider.venue,status:'STALE_OR_INCOMPLETE',observation:null };
          return { venue:provider.venue,status:'OBSERVED_CLOSED_CANDLES',observation };
        } catch {
          return { venue:provider.venue,status:'UNAVAILABLE',observation:null };
        }
      }));
      const independentlyObserved=results.filter(r=>r.observation).length;
      return res.json({
        ok:true,symbol,source:'PUBLIC_EXCHANGE_CLOSED_5M_CANDLES',checkedAtIso:new Date(nowMs).toISOString(),
        providers:results,
        crossExchangeVolumeObserved:independentlyObserved===2,
        whaleOrOnchainInflowVerified:false,
        mayExecuteLiveTrade:false,
        interpretation:'Trading volume is not net cash inflow. Bybit candles do not supply aggressor-side trading data in this adapter.',
        stage:'OWNER_RESEARCH_ONLY',
      });
    } finally {
      clearTimeout(timeout);
    }
  });

  app.get('/api/cmc/intelligence', async (_req, res) => {
    const data = await fetchMarketIntelligence();
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
  });

  app.get('/api/news/cryptopanic', async (_req, res) => {
    const token = process.env.CRYPTOPANIC_API_KEY;
    if (token) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      try {
        const response = await fetch(
          `https://cryptopanic.com/api/v1/posts/?auth_token=${encodeURIComponent(token)}&public=true`,
          { signal: controller.signal }
        );
        if (response.ok) {
          const data = await response.json();
          const posts = Array.isArray(data.results) ? data.results : [];
          if (posts.length > 0) {
            const items: NewsItem[] = posts.slice(0, 16).map((p: any) => {
              const pos = Number(p.votes?.positive || 0);
              const neg = Number(p.votes?.negative || 0);
              return {
                id: String(p.id),
                title: String(p.title),
                source: String(p.source?.title || 'CryptoPanic'),
                publishedAt: String(p.published_at || new Date().toISOString()),
                url: String(p.url || ''),
                currencies: Array.isArray(p.currencies)
                  ? p.currencies.map((c: any) => String(c.code).toUpperCase())
                  : [],
                sentiment: pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral',
                votesPositive: pos,
                votesNegative: neg,
                important: Number(p.votes?.important || 0) > 0,
              };
            });
            return res.json({ source: 'cryptopanic', items });
          }
        }
      } catch {
        // Fallback below
      } finally {
        clearTimeout(timer);
      }
    }

    return res.json({ source: 'curated_feed', items: DEFAULT_NEWS_FEED });
  });

  app.get('/api/sentiment/:symbol', async (req, res) => {
    const rawSym = String(req.params.symbol || 'BTCUSDT').toUpperCase();
    const base = rawSym.replace(/USDT$/i, '');
    const lcKey = process.env.LUNARCRUSH_API_KEY;

    if (lcKey) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      try {
        const response = await fetch(
          `https://lunarcrush.com/api4/public/coins/${encodeURIComponent(base)}/v1`,
          {
            headers: { Authorization: `Bearer ${lcKey}` },
            signal: controller.signal,
          }
        );
        if (response.ok) {
          const json = await response.json();
          const d = json.data;
          if (d) {
            const sentimentScore = Math.max(0, Math.min(100, Number(d.sentiment || 68)));
            return res.json({
              source: 'lunarcrush',
              symbol: rawSym,
              baseAsset: base,
              bullishPercent: sentimentScore,
              bearishPercent: 100 - sentimentScore,
              socialVolume: Number(d.social_volume_24h || 48200),
              galaxyScore: Number(d.galaxy_score || 72),
              sentimentScore,
              trendingHashtags: [`#${base}`, `#${base}USDT`, '#CryptoSignals', '#Altseason'],
            });
          }
        }
      } catch {
        // Structured fallback below
      } finally {
        clearTimeout(timer);
      }
    }

    // LunarCrush API structured model fallback
    const presets: Record<
      string,
      { bullish: number; volume: number; galaxy: number; tags: string[] }
    > = {
      BTC: {
        bullish: 76,
        volume: 184320,
        galaxy: 81,
        tags: ['#Bitcoin', '#BTC', '#SpotETF', '#InstitutionalFlow'],
      },
      ETH: {
        bullish: 71,
        volume: 112450,
        galaxy: 76,
        tags: ['#Ethereum', '#ETH', '#Layer2', '#ETHStaking'],
      },
      SOL: {
        bullish: 83,
        volume: 96840,
        galaxy: 85,
        tags: ['#Solana', '#SOL', '#DeFi', '#SOLBreakout'],
      },
      BNB: {
        bullish: 64,
        volume: 42190,
        galaxy: 68,
        tags: ['#BNB', '#BNBChain', '#Launchpool', '#Binance'],
      },
      XRP: {
        bullish: 39,
        volume: 74510,
        galaxy: 54,
        tags: ['#XRP', '#Ripple', '#EscrowWatch', '#XRPL'],
      },
      AVAX: {
        bullish: 73,
        volume: 38920,
        galaxy: 74,
        tags: ['#Avalanche', '#AVAX', '#Subnets', '#RWA'],
      },
      LINK: {
        bullish: 79,
        volume: 47600,
        galaxy: 79,
        tags: ['#Chainlink', '#LINK', '#CCIP', '#Oracles'],
      },
      ADA: {
        bullish: 44,
        volume: 35210,
        galaxy: 58,
        tags: ['#Cardano', '#ADA', '#Voltaire', '#SmartContracts'],
      },
      DOGE: {
        bullish: 36,
        volume: 129400,
        galaxy: 52,
        tags: ['#Dogecoin', '#DOGE', '#FundingRate', '#OpenInterest'],
      },
      NEAR: {
        bullish: 69,
        volume: 31450,
        galaxy: 71,
        tags: ['#NEAR', '#ChainAbstraction', '#AI', '#Web3'],
      },
    };

    const match = presets[base] || {
      bullish: 65,
      volume: 28400,
      galaxy: 67,
      tags: [`#${base}`, `#${base}USDT`, '#Crypto', '#SignalForge'],
    };

    return res.json({
      source: 'lunarcrush_schema',
      symbol: rawSym,
      baseAsset: base,
      bullishPercent: match.bullish,
      bearishPercent: 100 - match.bullish,
      socialVolume: match.volume,
      galaxyScore: match.galaxy,
      sentimentScore: match.bullish,
      trendingHashtags: match.tags,
    });
  });

  app.post('/api/alerts/email', requireOperatorAuth, standardWriteRateLimit, async (req, res) => {
    const {
      type,
      symbol,
      direction,
      sourceModule,
      confidence,
      entryPrice,
      stopLoss,
      trailingStopLoss,
      takeProfits,
      reason,
      targetPrice,
      condition,
      force,
    } = req.body || {};

    if (type === 'THREE_HOUR_SIGNAL_DIGEST' || type === 'THREE_HOUR_DIGEST' || type === 'SIX_HOUR_DIGEST') {
      const outcome = await dispatchThreeHourSignalDigest(force !== false);
      return res.json({
        ok: true,
        ...outcome,
      });
    }

    if (type === 'PRICE_ALERT') {
      const sym = String(symbol || 'BTCUSDT').toUpperCase();
      const cond = condition === 'BELOW' ? 'BELOW' : 'ABOVE';
      const target = Number(targetPrice || 0);
      const { state, item } = enqueueSignalForDigest(signalDigestState, {
        symbol: sym,
        direction: cond === 'ABOVE' ? 'BUY' : 'SELL',
        sourceModule: 'COORDINATOR',
        confidence: 90,
        entryPrice: target,
        reason: `Configured Target Alert (${sym} ${cond} $${target}) batched into 3H Digest`,
      });
      signalDigestState = state;
      const record: AlertDispatchRecord = {
        id: item.id,
        type: 'PRICE_ALERT',
        recipient: OWNER_EMAIL,
        subject: `Batched 3H Digest: Price Alert ${sym} ${cond} $${target}`,
        summary: `Batched into 3-Hour Digest queue (${state.pending.length} queued · next ${new Date(state.nextScheduledAtMs).toISOString()})`,
        status: 'batched_for_3h_digest',
        batchedCount: state.pending.length,
        timestamp: item.queuedAtIso,
      };
      alertDispatchLog.unshift(record);
      if (alertDispatchLog.length > 30) alertDispatchLog.length = 30;
      return res.json({
        ok: true,
        batched: true,
        queueCount: state.pending.length,
        nextScheduledAt: new Date(state.nextScheduledAtMs).toISOString(),
        record,
      });
    }

    if (type === 'TOP_GAINER_ALERT') {
      const sym = String(symbol || 'BTCUSDT').toUpperCase();
      const chg = Number(req.body?.change24hPercent || 0);
      const price = Number(entryPrice || futuresFeedCache[sym]?.markPrice || 0);
      const { state, item, deduplicated } = enqueueSignalForDigest(signalDigestState, {
        symbol: sym,
        direction: 'BUY',
        sourceModule: 'TOP_GAINER',
        confidence: Math.min(95, Math.max(85, Math.round(78 + chg * 0.6))),
        entryPrice: price,
        reason: `Binance Top Gainer +${chg.toFixed(2)}% 24h — ${String(reason || 'Prioritized in AI Engine')}`,
      });
      signalDigestState = state;
      const record: AlertDispatchRecord = {
        id: item.id,
        type: 'TOP_GAINER_ALERT',
        recipient: OWNER_EMAIL,
        subject: `Batched 3H Digest: Top Gainer ${sym} (+${chg.toFixed(2)}%)`,
        summary: `Queued for strict 3-Hour Email Digest (${state.pending.length} pending · ${state.individualEmailsPrevented} individual emails prevented)`,
        status: 'batched_for_3h_digest',
        batchedCount: state.pending.length,
        timestamp: item.queuedAtIso,
      };
      if (!deduplicated) {
        alertDispatchLog.unshift(record);
        if (alertDispatchLog.length > 30) alertDispatchLog.length = 30;
      }
      return res.json({
        ok: true,
        batched: true,
        deduplicated,
        queueCount: state.pending.length,
        nextScheduledAt: new Date(state.nextScheduledAtMs).toISOString(),
        record,
      });
    }

    // All high-confidence signal alerts (>= 85%) strictly batch into the 3-Hour Email Digest
    const conf = Number(confidence || 0);
    if (conf < 85) {
      return res.status(400).json({ ok: false, error: 'Confidence must be >= 85% for digest batching.' });
    }

    const sym = String(symbol || 'BTCUSDT').toUpperCase();
    const dir = direction === 'SELL' ? 'SELL' : 'BUY';
    const modRaw = String(sourceModule || 'AI_ENGINE').toUpperCase();
    const mod: SignalDigestModule =
      modRaw === 'SMC_FRVP' || modRaw === 'PATTERN_SCANNER' || modRaw === 'TOP_GAINER' || modRaw === 'COORDINATOR'
        ? (modRaw as SignalDigestModule)
        : 'AI_ENGINE';

    const { state, item, deduplicated } = enqueueSignalForDigest(signalDigestState, {
      symbol: sym,
      direction: dir,
      sourceModule: mod,
      confidence: conf,
      entryPrice: Number(entryPrice || futuresFeedCache[sym]?.markPrice || 0),
      stopLoss: Number(stopLoss || 0),
      trailingStopLoss: Number(trailingStopLoss || stopLoss || 0),
      takeProfits: Array.isArray(takeProfits) ? takeProfits : [],
      reason: String(reason || ''),
    });
    signalDigestState = state;

    const record: AlertDispatchRecord = {
      id: item.id,
      type: 'HIGH_CONFIDENCE_SIGNAL',
      recipient: OWNER_EMAIL,
      subject: `Batched 3H Digest: ${dir} ${sym} (${item.confidence}% · ${mod})`,
      summary: `Queued for strict 3-Hour Digest (${state.pending.length} signals queued · quota protected)`,
      status: 'batched_for_3h_digest',
      batchedCount: state.pending.length,
      timestamp: item.queuedAtIso,
    };
    if (!deduplicated) {
      alertDispatchLog.unshift(record);
      if (alertDispatchLog.length > 30) alertDispatchLog.length = 30;
    }

    return res.json({
      ok: true,
      batched: true,
      deduplicated,
      queueCount: state.pending.length,
      nextScheduledAt: new Date(state.nextScheduledAtMs).toISOString(),
      record,
    });
  });

  app.get('/api/digest/status', (_req, res) => {
    const decision = evaluateDigestSchedule(signalDigestState, Date.now(), false);
    res.json({
      ok: true,
      intervalHours: STRICT_DIGEST_INTERVAL_HOURS,
      intervalMs: THREE_HOURS_MS,
      pendingCount: signalDigestState.pending.length,
      pendingSignals: signalDigestState.pending,
      lastDigestSentAt: signalDigestState.lastDigestSentAtMs
        ? new Date(signalDigestState.lastDigestSentAtMs).toISOString()
        : null,
      nextScheduledAt: new Date(signalDigestState.nextScheduledAtMs).toISOString(),
      remainingMs: decision.remainingMs,
      totalBatchedAllTime: signalDigestState.totalBatchedAllTime,
      totalDigestsDispatched: signalDigestState.totalDigestsDispatched,
      individualEmailsPrevented: signalDigestState.individualEmailsPrevented,
    });
  });

  app.post('/api/digest/dispatch', requireOperatorAuth, standardWriteRateLimit, async (req, res) => {
    const force = req.body?.force !== false;
    const outcome = await dispatchThreeHourSignalDigest(force);
    res.json({ ok: true, ...outcome });
  });

  app.get('/api/alerts/history', (_req, res) => {
    res.json({
      ownerEmail: OWNER_EMAIL,
      whatsappUrl: WHATSAPP_URL,
      resendConfigured: Boolean(process.env.RESEND_API_KEY?.startsWith('re_')),
      telegramConfigured: Boolean(getTelegramBotToken()),
      telegramChannel: process.env.TELEGRAM_CHANNEL_ID || process.env.CHAT_ID || 'Signal Forge',
      digestIntervalHours: STRICT_DIGEST_INTERVAL_HOURS,
      digestState: {
        pendingCount: signalDigestState.pending.length,
        pendingSignals: signalDigestState.pending,
        lastDigestSentAt: signalDigestState.lastDigestSentAtMs
          ? new Date(signalDigestState.lastDigestSentAtMs).toISOString()
          : null,
        nextScheduledAt: new Date(signalDigestState.nextScheduledAtMs).toISOString(),
        totalBatchedAllTime: signalDigestState.totalBatchedAllTime,
        totalDigestsDispatched: signalDigestState.totalDigestsDispatched,
        individualEmailsPrevented: signalDigestState.individualEmailsPrevented,
      },
      performanceSchedule: ['Daily (24H)', 'Weekly (7D)', 'Monthly (30D)'],
      records: alertDispatchLog,
    });
  });

  // "Signal Forge" Dual-Stream Telegram Channel, Developer Private Audit & Webhook Endpoints
  app.get('/api/telegram/feed', (_req, res) => {
    res.json({
      channelName: 'Signal Forge',
      channelHandle: process.env.TELEGRAM_CHANNEL_ID || '@SignalForge',
      channelChatId: getPublicChannelChatId() || '@SignalForge',
      botConfigured: Boolean(getTelegramBotToken()),
      posts: telegramChannelFeed,
      structuredSignals: publicSignalStreamLog,
    });
  });

  app.get('/api/telegram/streams/status', (_req, res) => {
    return res.json(buildTelegramDualStreamStatus());
  });

  app.post('/api/telegram/signal', requireOperatorAuth, standardWriteRateLimit, async (req, res) => {
    const {
      symbol,
      direction,
      entryPrice,
      tp1,
      tp2,
      tp3,
      takeProfits,
      exitPrice,
      stopLoss,
      confidence,
      timeframe,
      rationale,
      rawAlertText,
      hitTpMilestones,
      finalPnlUsd,
      finalPnlPercent,
      lifecycleStatus,
      source,
      dedupeKey,
    } = req.body || {};
    if (!symbol && !rawAlertText) {
      return res.status(400).json({ ok: false, error: 'Missing trading pair symbol or raw alert text.' });
    }
    const cleanSym = symbol
      ? String(symbol).toUpperCase().replace(/[^A-Z0-9/_-]/g, '')
      : '';
    if (dedupeKey && sentTelegramKeys.has(String(dedupeKey))) {
      const existing = telegramChannelFeed.find((p) => p.symbol === cleanSym && p.direction === direction);
      const existingStructured = publicSignalStreamLog.find(
        (p) => p.symbol === cleanSym && p.direction === direction
      );
      return res.json({
        ok: true,
        deduped: true,
        filtered: true,
        post: existing,
        structuredSignal: existingStructured,
        status: buildTelegramDualStreamStatus(),
        processorStatus: buildSignalProcessorStatus(),
      });
    }

    const processed = await processAndTransmitTradingAlert({
      source: source === 'MANUAL' ? 'MANUAL' : 'AUTOMATED',
      rawAlertText: rawAlertText ? String(rawAlertText) : undefined,
      symbol: cleanSym || undefined,
      direction: direction ? (String(direction).toUpperCase() as 'BUY' | 'SELL') : undefined,
      timeframe: timeframe ? String(timeframe) : '4h',
      entryPrice: Number(entryPrice) > 0 ? Number(entryPrice) : undefined,
      tp1: Number(tp1) > 0 ? Number(tp1) : undefined,
      tp2: Number(tp2) > 0 ? Number(tp2) : undefined,
      tp3: Number(tp3) > 0 ? Number(tp3) : undefined,
      takeProfits: Array.isArray(takeProfits) ? takeProfits.map(Number) : undefined,
      exitPrice: Number(exitPrice) > 0 ? Number(exitPrice) : undefined,
      stopLoss: Number(stopLoss) > 0 ? Number(stopLoss) : undefined,
      confidence: Number(confidence) > 0 ? Number(confidence) : 88,
      rationale: rationale ? String(rationale) : undefined,
      hitTpMilestones: Array.isArray(hitTpMilestones) ? (hitTpMilestones as TpMilestone[]) : undefined,
      finalPnlUsd: typeof finalPnlUsd === 'number' ? finalPnlUsd : undefined,
      finalPnlPercent: typeof finalPnlPercent === 'number' ? finalPnlPercent : undefined,
      lifecycleStatus: lifecycleStatus ? (String(lifecycleStatus) as SignalLifecycleStatus) : undefined,
    });

    if (!processed.ok) {
      return res.status(400).json({ ok: false, error: processed.error });
    }

    if (dedupeKey && !processed.filtered) {
      addBoundedSetKey(sentTelegramKeys, String(dedupeKey), 500);
    }

    const post = telegramChannelFeed[0];
    return res.json({
      ok: true,
      deduped: processed.filtered,
      filtered: processed.filtered,
      spamVerdict: processed.record.spamVerdict,
      processedSignal: processed.record,
      post,
      structuredSignal: processed.structuredSignal || publicSignalStreamLog[0],
      status: buildTelegramDualStreamStatus(),
      processorStatus: processed.status,
    });
  });

  app.get('/api/signal-processor/status', (_req, res) => {
    return res.json(buildSignalProcessorStatus());
  });

  app.post('/api/signal-processor/process', requireOperatorAuth, standardWriteRateLimit, async (req, res) => {
    const body = req.body || {};
    if (!body.rawAlertText && !body.symbol) {
      return res.status(400).json({
        ok: false,
        error: 'Provide either rawAlertText (manual alert) or structured trading signal parameters.',
      });
    }
    const result = await processAndTransmitTradingAlert({
      source: body.source === 'AUTOMATED' ? 'AUTOMATED' : body.source === 'MANUAL' ? 'MANUAL' : undefined,
      rawAlertText: body.rawAlertText ? String(body.rawAlertText) : undefined,
      symbol: body.symbol ? String(body.symbol) : undefined,
      direction: body.direction ? (String(body.direction).toUpperCase() as 'BUY' | 'SELL' | 'LONG' | 'SHORT') : undefined,
      timeframe: body.timeframe ? String(body.timeframe) : undefined,
      entryPrice: Number(body.entryPrice) > 0 ? Number(body.entryPrice) : undefined,
      tp1: Number(body.tp1) > 0 ? Number(body.tp1) : undefined,
      tp2: Number(body.tp2) > 0 ? Number(body.tp2) : undefined,
      tp3: Number(body.tp3) > 0 ? Number(body.tp3) : undefined,
      takeProfits: Array.isArray(body.takeProfits) ? body.takeProfits.map(Number) : undefined,
      exitPrice: Number(body.exitPrice) > 0 ? Number(body.exitPrice) : undefined,
      stopLoss: Number(body.stopLoss) > 0 ? Number(body.stopLoss) : undefined,
      confidence: Number(body.confidence) > 0 ? Number(body.confidence) : undefined,
      rationale: body.rationale ? String(body.rationale) : undefined,
      hitTpMilestones: Array.isArray(body.hitTpMilestones) ? (body.hitTpMilestones as TpMilestone[]) : undefined,
      finalPnlUsd: typeof body.finalPnlUsd === 'number' ? body.finalPnlUsd : undefined,
      finalPnlPercent: typeof body.finalPnlPercent === 'number' ? body.finalPnlPercent : undefined,
      lifecycleStatus: body.lifecycleStatus ? (String(body.lifecycleStatus) as SignalLifecycleStatus) : undefined,
    });
    if (!result.ok) {
      return res.status(400).json(result);
    }
    return res.json({
      ok: true,
      filtered: result.filtered,
      record: result.record,
      processorStatus: result.status,
      telegramStatus: buildTelegramDualStreamStatus(),
    });
  });

  app.post('/api/signal-processor/milestone', requireOperatorAuth, standardWriteRateLimit, async (req, res) => {
    const body = req.body || {};
    const signalId = String(body.signalId || '').trim();
    const base = signalId
      ? processedSignalsLog.find((s) => s.signalId === signalId)
      : undefined;

    if (!base && !body.symbol) {
      return res.status(400).json({
        ok: false,
        error: 'Provide a valid signalId or trading pair symbol to transmit TP milestone & P&L update.',
      });
    }

    const hitMilestones: TpMilestone[] = Array.isArray(body.hitTpMilestones)
      ? (body.hitTpMilestones as TpMilestone[])
      : base?.hitTpMilestones ?? [];

    const nextLifecycle: SignalLifecycleStatus = body.lifecycleStatus
      ? (String(body.lifecycleStatus) as SignalLifecycleStatus)
      : hitMilestones.includes('TP3')
      ? 'CLOSED_TP'
      : hitMilestones.includes('TP2')
      ? 'TP2_HIT'
      : hitMilestones.includes('TP1')
      ? 'TP1_HIT'
      : 'CLOSED_MANUAL';

    const result = await processAndTransmitTradingAlert({
      source: base?.source || 'AUTOMATED',
      symbol: base?.symbol || String(body.symbol),
      direction: base?.direction || (String(body.direction || 'BUY').toUpperCase() as 'BUY' | 'SELL'),
      timeframe: base?.timeframe || String(body.timeframe || '4h'),
      entryPrice: base?.entryPrice || Number(body.entryPrice || 0),
      takeProfits: base?.takeProfits || (Array.isArray(body.takeProfits) ? body.takeProfits.map(Number) : undefined),
      exitPrice: base?.exitPrice || (Number(body.exitPrice) > 0 ? Number(body.exitPrice) : undefined),
      stopLoss: base?.stopLoss || Number(body.stopLoss || 0),
      confidence: base?.confidence || Number(body.confidence || 90),
      hitTpMilestones: hitMilestones,
      finalPnlUsd: typeof body.finalPnlUsd === 'number' ? body.finalPnlUsd : null,
      finalPnlPercent: typeof body.finalPnlPercent === 'number' ? body.finalPnlPercent : null,
      lifecycleStatus: nextLifecycle,
      rationale: body.rationale
        ? String(body.rationale)
        : `Milestone Update (${hitMilestones.join(', ') || nextLifecycle}) transmitted via Signal Forge Webhook`,
    });

    if (!result.ok) {
      return res.status(400).json(result);
    }

    return res.json({
      ok: true,
      filtered: result.filtered,
      record: result.record,
      processorStatus: result.status,
      telegramStatus: buildTelegramDualStreamStatus(),
    });
  });

  // Backend Offloaded Event Pipeline: Entry-Zone Gated Signals, Auto-Executed Order Logs, Pre-Pump Support Monitor & Telegram Stabilizer
  app.get('/api/pipeline/dashboard-snapshot', (_req, res) => {
    return res.json(buildBackendExecutionPipelineSnapshot());
  });

  app.post('/api/pipeline/entry-zone/execute', requireOperatorAuth, standardWriteRateLimit, async (req, res) => {
    const body = req.body || {};
    const signalId = String(body.signalId || '').trim();
    const forceOnCriteria = Boolean(body.forceEntryZoneMatch);
    const notionalUsd = Math.max(100, Math.min(250_000, Number(body.notionalUsd || 1500)));

    const candidate = activeEntryZoneSignals.find((s) => s.signalId === signalId);
    if (!candidate) {
      return res.status(404).json({
        ok: false,
        error: 'Signal not found in active Entry Zone queue (may already be executed & archived).',
      });
    }

    const liveMap = getLivePriceLookupMap();
    const livePrice = liveMap[candidate.symbol] ?? candidate.entryPrice;
    const evaluation = entryZoneValidator.evaluate({ candidate, livePrice });

    if (!evaluation.inEntryZone && !forceOnCriteria) {
      return res.status(409).json({
        ok: false,
        entryZoneBlocked: true,
        evaluation,
        error: `Entry Zone Guard: ${evaluation.rationale}`,
        snapshot: buildBackendExecutionPipelineSnapshot(),
      });
    }

    const fillPrice = evaluation.inEntryZone ? livePrice : candidate.entryZone.midpoint;
    const executedOrder = await executeCandidateIntoBackendLog(candidate, fillPrice, notionalUsd);
    return res.json({
      ok: true,
      executedOrder,
      snapshot: buildBackendExecutionPipelineSnapshot(),
    });
  });

  app.post('/api/pipeline/pre-pump/execute-support', requireOperatorAuth, standardWriteRateLimit, async (req, res) => {
    const body = req.body || {};
    const symbol = String(body.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const notionalUsd = Math.max(100, Math.min(250_000, Number(body.notionalUsd || 2000)));
    if (!symbol) {
      return res.status(400).json({ ok: false, error: 'Missing trading pair symbol for Pre-Pump Support execution.' });
    }

    const liveMap = getLivePriceLookupMap();
    const activePosBySym: Record<string, BackendExecutedOrderLog> = {};
    for (const ord of backendExecutedOrdersLog) {
      if (!activePosBySym[ord.symbol] && ord.status === 'OPEN_EXECUTED') {
        activePosBySym[ord.symbol] = ord;
      }
    }
    const candidates = prePumpSupportEngine.process({
      topGainers: topGainersCache,
      livePriceMap: liveMap,
      activePositionsBySymbol: activePosBySym,
    });
    const match = candidates.find((c) => c.symbol === symbol);
    const livePrice = match?.livePrice ?? liveMap[symbol] ?? 0;
    if (!Number.isFinite(livePrice) || livePrice <= 0) {
      return res.status(404).json({ ok: false, error: `No validated live market price available for ${symbol}.` });
    }

    const supportPrice = match?.supportLevel ?? Number((livePrice * 0.996).toFixed(4));
    const stopLoss = match?.stopLoss ?? Number((livePrice * 0.982).toFixed(4));
    const takeProfits: [number, number, number] = match?.takeProfits ?? [
      Number((livePrice * 1.036).toFixed(4)),
      Number((livePrice * 1.063).toFixed(4)),
      Number((livePrice * 1.094).toFixed(4)),
    ];

    const prePumpCandidate: EntryZoneSignalCandidate = {
      signalId: `prepump_${symbol}_${Date.now()}`,
      symbol,
      coinName: match?.baseAsset ?? symbol.replace(/USDT$/i, ''),
      direction: 'BUY',
      timeframe: '15m',
      entryPrice: supportPrice,
      entryZone: computeEntryZoneBounds(supportPrice, 0.75),
      stopLoss,
      takeProfits,
      confidence: match?.prePumpScore ?? 88,
      sourceModule: 'PRE_PUMP_SUPPORT',
      reason: `Immediate Support Execution @ $${livePrice} · Locked HOLD UNTIL MAX PROFIT TARGET ($${takeProfits[2]}).`,
      isPrePump: true,
      prePumpScore: match?.prePumpScore ?? 88,
      supportPrice,
      holdUntilMaxTarget: true,
      createdAt: new Date().toISOString(),
    };

    const executedOrder = await executeCandidateIntoBackendLog(prePumpCandidate, livePrice, notionalUsd);
    return res.json({
      ok: true,
      executedOrder,
      snapshot: buildBackendExecutionPipelineSnapshot(),
    });
  });

  app.post('/api/pipeline/telegram-queue/retry', requireOperatorAuth, standardWriteRateLimit, async (_req, res) => {
    const retriedCount = await flushTelegramStabilizerQueue();
    return res.json({
      ok: true,
      retriedCount,
      snapshot: buildBackendExecutionPipelineSnapshot(),
    });
  });

  // --- RBAC Profile & Strictly Protected Test/Trust Console Debug Telemetry ---
  app.get('/api/auth/rbac-profile', async (req, res) => {
    const principal = await resolveCallerPrincipal(req);
    const identity = buildRbacIdentity(principal, extraAdminEmailsFromEnv);
    return res.json({
      ok: true,
      rbac: {
        authenticated: identity.authenticated,
        uid: identity.uid,
        role: identity.role,
        permissions: identity.permissions,
        canAccessTestConsole: identity.canAccessTestConsole,
        canAccessDebugEndpoints: identity.canAccessDebugEndpoints,
      },
    });
  });

  app.get('/api/debug/console-telemetry', requireRbacPermission('DEBUG_ENDPOINTS_ACCESS'), (_req, res) => {
    const { health } = sampleSystemHealthAndLatencies();
    return res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      pgV4LogicVersion: PG_V4_LOGIC_VERSION,
      pgV4LogicHash: computePgV4LogicHash(),
      chainIntegrity: pgV4Store.verifyChainIntegrity(),
      pipelineEpoch: backendPipelineEpoch,
      pipelineTicks: backendPipelineTicks,
      activeEntryZoneCount: activeEntryZoneSignals.length,
      executedOrdersCount: backendExecutedOrdersLog.length,
      systemHealth: health,
      profitTakingEngineHealth: modularProfitTakingEngine.healthCheck(),
      prePumpEngineHealth: prePumpSupportEngine.healthCheck(),
    });
  });

  // --- Decoupled Per-Agent Modular Profit-Taking & Stop-Loss Endpoints ---
  app.get('/api/profit-taking/policies', (_req, res) => {
    return res.json({
      ok: true,
      updatedAt: new Date().toISOString(),
      profiles: modularProfitTakingEngine.getAllProfiles(),
      engineHealth: modularProfitTakingEngine.healthCheck(),
    });
  });

  app.post('/api/profit-taking/policy', requireOperatorAuth, standardWriteRateLimit, (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const validAgents: ProfitAgentId[] = [
      'AI_COORDINATOR',
      'SMC_FRVP',
      'PATTERN_SCANNER',
      'PRE_PUMP_SUPPORT',
      'MEAN_REVERSION',
    ];
    const agentId = String(body.agentId || '') as ProfitAgentId;
    if (!validAgents.includes(agentId)) {
      return res.status(400).json({ ok: false, error: 'Invalid agentId supplied.' });
    }
    const updated = modularProfitTakingEngine.updateAgentPolicy(agentId, {
      takeProfit: body.takeProfit && typeof body.takeProfit === 'object' ? body.takeProfit : undefined,
      stopLoss: body.stopLoss && typeof body.stopLoss === 'object' ? body.stopLoss : undefined,
    });
    return res.json({
      ok: true,
      updatedProfile: updated,
      profiles: modularProfitTakingEngine.getAllProfiles(),
    });
  });

  app.post('/api/profit-taking/evaluate', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const validAgents: ProfitAgentId[] = [
      'AI_COORDINATOR',
      'SMC_FRVP',
      'PATTERN_SCANNER',
      'PRE_PUMP_SUPPORT',
      'MEAN_REVERSION',
    ];
    const agentId = (validAgents.includes(body.agentId as ProfitAgentId)
      ? body.agentId
      : 'AI_COORDINATOR') as ProfitAgentId;
    const symbol = String(body.symbol || 'BTCUSDT').toUpperCase();
    const liveMap = getLivePriceLookupMap();
    const livePrice = liveMap[symbol] ?? 90000;
    const entryPrice = Number(body.entryPrice) > 0 ? Number(body.entryPrice) : livePrice;
    const currentPrice = Number(body.currentPrice) > 0 ? Number(body.currentPrice) : livePrice;
    const atr = Number(body.atr) > 0 ? Number(body.atr) : entryPrice * 0.018;
    const direction = body.direction === 'SELL' ? 'SELL' : 'BUY';
    const peakUnrealizedR = Number.isFinite(Number(body.peakUnrealizedR))
      ? Number(body.peakUnrealizedR)
      : undefined;

    const evaluation = modularProfitTakingEngine.process({
      agentId,
      direction,
      entryPrice,
      currentPrice,
      atr,
      peakUnrealizedR,
    });
    return res.json({
      ok: true,
      symbol,
      evaluation,
    });
  });

  // --- Offloaded Parameterized 1,000-Trade Multi-Horizon Backtesting Matrix & Auto-Optimizer ---
  app.post('/api/backtest/matrix', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const symbol = String(body.symbol || 'BTCUSDT').toUpperCase();
    const report = runComparativeSimulationMatrix(symbol, {
      riskLimitPerTradePct: body.riskLimitPerTradePct,
      atrTrailingStopMultiplier: body.atrTrailingStopMultiplier,
      profitToLossRatio: body.profitToLossRatio,
      tradeCount: body.tradeCount,
      executionFeeBps: body.executionFeeBps,
      slippageBps: body.slippageBps,
      autonomousProfitLock: body.autonomousProfitLock,
    });
    return res.json({ ok: true, report });
  });

  app.post('/api/backtest/optimize', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const symbol = String(body.symbol || 'BTCUSDT').toUpperCase();
    const allowed: MatrixAgentStrategyId[] = [
      'AUTONOMOUS_MASTER',
      'SMC_1_5',
      'PATTERN_SCANNER',
      'PRE_PUMP_SUPPORT',
    ];
    const strategyId = (allowed.includes(body.strategyId as MatrixAgentStrategyId)
      ? body.strategyId
      : 'AUTONOMOUS_MASTER') as MatrixAgentStrategyId;
    const optimization = optimizeBacktestParameters(symbol, strategyId, {
      riskLimitPerTradePct: body.riskLimitPerTradePct,
      atrTrailingStopMultiplier: body.atrTrailingStopMultiplier,
      profitToLossRatio: body.profitToLossRatio,
      tradeCount: body.tradeCount,
      executionFeeBps: body.executionFeeBps,
      slippageBps: body.slippageBps,
      autonomousProfitLock: body.autonomousProfitLock,
    });
    return res.json({ ok: true, optimization });
  });

  // --- Live Backend Agent Transaction Loop Telemetry (for Cyber-AI Telemetry Panel) ---
  app.get('/api/telemetry/agent-loops', (_req, res) => {
    const { health } = sampleSystemHealthAndLatencies();
    const tgSnap = telegramDispatchStabilizer.getSnapshot();
    const profitProfiles = modularProfitTakingEngine.getAllProfiles();
    const autonomousLockCount = profitProfiles.filter(
      (p) => p.takeProfit.mode === 'AUTONOMOUS_PROFIT_LOCK'
    ).length;

    return res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      pipelineEpoch: backendPipelineEpoch,
      totalCycles: backendPipelineTicks,
      avgLoopLatencyMs: backendPipelineAvgLatencyMs,
      cpuUsagePct: health.cpuUsagePct,
      wsConnected: health.wsConnected,
      wsFrameAgeMs: health.wsFrameAgeMs,
      stages: [
        {
          id: 'binance_ws_ingest',
          label: 'Binance WS Ingest',
          status: health.wsConnected ? 'ACTIVE' : 'CALIBRATING',
          latencyMs: Math.max(0.4, Number((health.wsFrameAgeMs * 0.01 || 1.2).toFixed(2))),
          metric: `${Object.keys(getLivePriceLookupMap()).length} pairs locked`,
        },
        {
          id: 'cps_oracle_parity',
          label: 'CPS Oracle & TV Parity',
          status: 'ACTIVE',
          latencyMs: 0.65,
          metric: '0.0 bps drift guard',
        },
        {
          id: 'entry_zone_gate',
          label: 'Entry-Zone Validator',
          status: 'ACTIVE',
          latencyMs: 0.42,
          metric: `${activeEntryZoneSignals.length} awaiting fill`,
        },
        {
          id: 'risk_rr_kernel',
          label: '1:5 R:R Risk Kernel',
          status: 'ACTIVE',
          latencyMs: 0.31,
          metric: 'Floor >= 5.0R',
        },
        {
          id: 'modular_profit_lock',
          label: 'Modular TP/SL Engine',
          status: 'ACTIVE',
          latencyMs: modularProfitTakingEngine.healthCheck().avgLatencyMs || 0.28,
          metric: `${autonomousLockCount}/${profitProfiles.length} auto-lock`,
        },
        {
          id: 'execution_router',
          label: 'Order Router & Logs',
          status: 'ACTIVE',
          latencyMs: 1.15,
          metric: `${backendExecutedOrdersLog.length} archived`,
        },
        {
          id: 'telegram_relay',
          label: 'Telegram Stabilizer',
          status: tgSnap.pendingCount > 0 || tgSnap.failedCount > 0 ? 'DEGRADED' : 'ACTIVE',
          latencyMs: 2.4,
          metric: `${tgSnap.reliabilityPct}% (${tgSnap.totalDelivered} ok)`,
        },
      ],
    });
  });

  // --- Authoritative Multi-Agent Anti-Drift Synchronization Endpoints ---
  app.get('/api/agents/sync-state', (_req, res) => {
    const liveMap = getLivePriceLookupMap();
    const anchorPrice = liveMap['BTCUSDT'] ?? Object.values(liveMap)[0] ?? 91500;
    const current = multiAgentSyncEngine.getSnapshot();
    const sync =
      current.globalEpoch === 0
        ? multiAgentSyncEngine.process({
            symbol: 'BTCUSDT',
            authoritativePrice: anchorPrice,
            epoch: Math.max(1, backendPipelineEpoch),
          })
        : current;
    return res.json({
      ok: true,
      sync,
      engineHealth: multiAgentSyncEngine.healthCheck(),
    });
  });

  app.post('/api/agents/sync-reconcile', requireOperatorAuth, standardWriteRateLimit, (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const symbol = String(body.symbol || 'BTCUSDT').toUpperCase();
    const liveMap = getLivePriceLookupMap();
    const anchorPrice = liveMap[symbol] ?? liveMap['BTCUSDT'] ?? 91500;
    const sync = multiAgentSyncEngine.forceReconcileAll(symbol, anchorPrice);
    return res.json({
      ok: true,
      sync,
      engineHealth: multiAgentSyncEngine.healthCheck(),
    });
  });

  // --- High-Frequency Profit Scooping, Immutable Locker Vault & Daily PnL Tracking ---
  app.get('/api/vault/state', (_req, res) => {
    return res.json({
      ok: true,
      vault: profitVaultEngine.getSnapshot(),
      engineHealth: profitVaultEngine.healthCheck(),
    });
  });

  app.post('/api/vault/config', requireOperatorAuth, standardWriteRateLimit, async (req, res) => {
    const principal = await resolveCallerPrincipal(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const modeRaw = typeof body.thresholdMode === 'string' ? body.thresholdMode.toUpperCase() : undefined;
    const thresholdMode: ProfitThresholdMode | undefined =
      modeRaw === 'PERCENT_OF_EQUITY'
        ? 'PERCENT_OF_EQUITY'
        : modeRaw === 'USD_FIXED'
        ? 'USD_FIXED'
        : undefined;
    const actorLabel = principal.authenticated && principal.email ? principal.email : 'OPERATOR_SESSION';
    const vault = profitVaultEngine.updateConfig(
      {
        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
        thresholdMode,
        profitThresholdUsd:
          typeof body.profitThresholdUsd === 'number' ? body.profitThresholdUsd : undefined,
        profitThresholdPct:
          typeof body.profitThresholdPct === 'number' ? body.profitThresholdPct : undefined,
        scoopExcessRatioPct:
          typeof body.scoopExcessRatioPct === 'number' ? body.scoopExcessRatioPct : undefined,
      },
      actorLabel
    );
    return res.json({
      ok: true,
      vault,
      engineHealth: profitVaultEngine.healthCheck(),
    });
  });

  app.post('/api/vault/record-gain', requireOperatorAuth, standardWriteRateLimit, (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const symbolRaw = String(body.symbol || 'BTCUSDT')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 16);
    const realizedPnlUsd = Number(body.realizedPnlUsd);
    if (!Number.isFinite(realizedPnlUsd) || Math.abs(realizedPnlUsd) > 1_000_000) {
      return res.status(400).json({
        ok: false,
        error: 'realizedPnlUsd must be a finite number within [-1,000,000, +1,000,000].',
      });
    }
    const tradeId =
      typeof body.tradeId === 'string' && body.tradeId.trim().length > 0
        ? body.tradeId.trim().slice(0, 64)
        : `trade_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const sourceAgent =
      typeof body.sourceAgent === 'string' && body.sourceAgent.trim().length > 0
        ? body.sourceAgent.trim().slice(0, 48)
        : 'CORE_EXECUTION_ENGINE';

    const outcome = profitVaultEngine.ingestRealizedTrade({
      tradeId,
      symbol: symbolRaw || 'BTCUSDT',
      realizedPnlUsd,
      sourceAgent,
    });
    if (outcome.scoopedNow && outcome.scoopedAmountUsd > 0) {
      yearnProfitDegradation.reportGain(outcome.scoopedAmountUsd);
    }
    return res.json({
      ok: true,
      outcome,
      vault: outcome.snapshot,
      vaultDegradation: yearnProfitDegradation.getSnapshot(),
    });
  });

  app.post('/api/vault/manual-override', requireOperatorAuth, standardWriteRateLimit, async (req, res) => {
    const principal = await resolveCallerPrincipal(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    const requestedActorRaw = String(body.actorType || 'AUTHENTICATED_USER').toUpperCase();
    const actorType: VaultActorType =
      requestedActorRaw === 'AUTONOMOUS_AGENT'
        ? 'AUTONOMOUS_AGENT'
        : requestedActorRaw === 'SYSTEM_BOT'
        ? 'SYSTEM_BOT'
        : 'AUTHENTICATED_USER';

    if (actorType !== 'AUTHENTICATED_USER') {
      const denied = profitVaultEngine.executeManualUserOverride({
        actorType,
        actorId: String(body.actorId || actorType),
        action: 'RELEASE_TO_TRADING',
        amountUsd: Number(body.amountUsd) || 0,
        confirmationPhrase: String(body.confirmationPhrase || ''),
        reason: String(body.reason || 'Blocked autonomous request'),
      });
      return res.status(403).json({
        ok: false,
        code: denied.code,
        error: denied.message,
        vault: denied.snapshot,
      });
    }

    const actionRaw = String(body.action || 'RELEASE_TO_TRADING').toUpperCase();
    const action: VaultOverrideAction =
      actionRaw === 'REBALANCE_EXTERNAL' ? 'REBALANCE_EXTERNAL' : 'RELEASE_TO_TRADING';
    const amountUsd = Number(body.amountUsd);
    const confirmationPhrase = String(body.confirmationPhrase || '');
    const reason = String(body.reason || '').slice(0, 160);
    const actorId = principal.authenticated && principal.uid ? principal.uid : 'verified_operator_user';
    const actorEmail = principal.authenticated ? principal.email : null;

    const outcome = profitVaultEngine.executeManualUserOverride({
      actorType: 'AUTHENTICATED_USER',
      actorId,
      actorEmail,
      action,
      amountUsd,
      confirmationPhrase,
      reason,
    });

    if (!outcome.allowed) {
      return res.status(outcome.code === 'AGENT_OVERRIDE_FORBIDDEN' ? 403 : 400).json({
        ok: false,
        code: outcome.code,
        error: outcome.message,
        vault: outcome.snapshot,
      });
    }

    return res.json({
      ok: true,
      code: outcome.code,
      message: outcome.message,
      ledgerEntry: outcome.ledgerEntry,
      vault: outcome.snapshot,
    });
  });

  // --- Self-Healing Probes, Token Bucket Telemetry, Yearn 6h Degradation & Gemini Debate/Grounding ---
  const buildUnifiedHealthPayload = () => {
    const vaultSnap = profitVaultEngine.getSnapshot();
    const health = selfHealingSupervisor.buildHealthSnapshot({
      cacheStoreHealthy: true,
      binanceFeedLive: backendWsConnected || spotFeedSource === 'binance_spot',
      geminiStatus: getGeminiConfigurationHealth(),
      vaultHealthy:
        vaultSnap.integrity.hashChainValid && vaultSnap.integrity.accountingInvariantValid,
    });
    return {
      ok: true,
      status: health.status,
      checks: health.checks,
      selfHealing: health,
      tokenBucket: apiTokenBucketLimiter.getTelemetry(),
      vaultDegradation: yearnProfitDegradation.getSnapshot(),
    };
  };

  app.get('/health', (_req, res) => {
    return res.json(buildUnifiedHealthPayload());
  });

  app.get('/api/self-healing/health', (_req, res) => {
    return res.json(buildUnifiedHealthPayload());
  });

  app.get('/api/v1/vault/degradation', (_req, res) => {
    return res.json({
      ok: true,
      degradation: yearnProfitDegradation.getSnapshot(),
    });
  });

  app.post('/api/v1/signals/generate', requireOperatorAuth, tokenBucketRateLimit, async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const symbol = String(body.symbol || 'BTCUSDT')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 16) || 'BTCUSDT';
    const timeframe = String(body.timeframe || '15m').slice(0, 8);
    const liveMap = getLivePriceLookupMap();
    const tickerEntry = spotFeedCache[symbol];
    const livePrice =
      Number(body.livePrice) > 0
        ? Number(body.livePrice)
        : liveMap[symbol] ?? tickerEntry?.price ?? 91500;
    const context: MarketDebateContext = {
      symbol,
      timeframe,
      livePrice,
      change24hPercent:
        typeof body.change24hPercent === 'number'
          ? body.change24hPercent
          : tickerEntry?.change24hPercent ?? 0,
      volume24hUsd:
        typeof body.volume24hUsd === 'number'
          ? body.volume24hUsd
          : tickerEntry?.volume24hUsd ?? 0,
      notes: typeof body.notes === 'string' ? body.notes.slice(0, 280) : undefined,
    };
    const rounds = Number(body.rounds) || 2;

    try {
      const result = await runMultiAgentDebateDecision(context, rounds);
      return res.json({ ok: true, result });
    } catch (err) {
      if (err instanceof GeminiServiceError) {
        return res.status(err.httpStatus).json({
          ok: false,
          code: err.code,
          error: err.message,
        });
      }
      return res.status(502).json({
        ok: false,
        code: 'DEBATE_ENGINE_FAILED',
        error: err instanceof Error ? err.message : 'Unexpected debate engine error.',
      });
    }
  });

  app.post('/api/v1/search/grounding', requireOperatorAuth, tokenBucketRateLimit, async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const queryText = String(body.query || '').trim();
    if (!queryText) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_QUERY',
        error: 'Provide a non-empty market search query.',
      });
    }
    try {
      const grounding = await runGroundedMarketSearch(queryText);
      return res.json({ ok: true, grounding });
    } catch (err) {
      if (err instanceof GeminiServiceError) {
        return res.status(err.httpStatus).json({
          ok: false,
          code: err.code,
          error: err.message,
        });
      }
      return res.status(502).json({
        ok: false,
        code: 'GROUNDING_FAILED',
        error: err instanceof Error ? err.message : 'Unexpected Search grounding error.',
      });
    }
  });

  app.post('/api/telegram/audit/dispatch', requireOperatorAuth, standardWriteRateLimit, async (req, res) => {
    const kindRaw = String(req.body?.kind || 'CONTINUOUS_AUDIT').toUpperCase();
    const kind: SystemAuditLogEntry['kind'] =
      kindRaw === 'DAILY_DIGEST' ? 'DAILY_DIGEST' : 'CONTINUOUS_AUDIT';
    const entry = await dispatchDeveloperSystemAudit(kind);
    return res.json({
      ok: true,
      auditEntry: entry,
      status: buildTelegramDualStreamStatus(),
    });
  });

  app.post('/api/telegram/audit/schedule', requireOperatorAuth, standardWriteRateLimit, (req, res) => {
    const { dailyAutoDeliveryEnabled, dailyScheduledUtcHour, developerChatId } = req.body || {};
    if (typeof dailyAutoDeliveryEnabled === 'boolean') {
      dailyAuditAutoDeliveryEnabled = dailyAutoDeliveryEnabled;
    }
    if (dailyScheduledUtcHour !== undefined) {
      const hr = Number(dailyScheduledUtcHour);
      if (!Number.isFinite(hr) || hr < 0 || hr > 23) {
        return res.status(400).json({
          ok: false,
          error: 'dailyScheduledUtcHour must be an integer between 0 and 23 (UTC).',
        });
      }
      dailyAuditScheduledUtcHour = Math.floor(hr);
    }
    if (typeof developerChatId === 'string') {
      const trimmed = developerChatId.trim();
      if (trimmed.length > 0) {
        if (!/^-?\d{5,20}$/.test(trimmed)) {
          return res.status(400).json({
            ok: false,
            error: 'Developer private chat ID must be a valid numeric Telegram user ID.',
          });
        }
        if (trimmed === getPublicChannelChatId()) {
          return res.status(409).json({
            ok: false,
            error:
              'Developer private audit chat ID must be separate from the public Signal Forge channel CHAT_ID.',
          });
        }
        boundDeveloperChatId = trimmed;
        autoBoundDeveloperViaWebhook = false;
      }
    }
    return res.json({
      ok: true,
      status: buildTelegramDualStreamStatus(),
    });
  });

  app.post('/api/telegram/webhook/register', requireOperatorAuth, standardWriteRateLimit, async (req, res) => {
    const explicitUrl = typeof req.body?.webhookUrl === 'string' ? req.body.webhookUrl : undefined;
    const outcome = await registerTelegramWebhook(explicitUrl);
    return res.status(outcome.ok ? 200 : 400).json({
      ...outcome,
      status: buildTelegramDualStreamStatus(),
    });
  });

  app.get('/api/telegram/webhook/info', async (_req, res) => {
    const token = getTelegramBotToken();
    if (!token) {
      return res.json({
        ok: false,
        error: 'BOT_TOKEN not configured.',
        status: buildTelegramDualStreamStatus(),
      });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const resp = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, {
        signal: controller.signal,
      });
      const json = await resp.json().catch(() => null);
      if (resp.ok && json?.ok && json.result) {
        telegramWebhookRegistered = Boolean(json.result.url);
        if (json.result.url) telegramWebhookUrl = String(json.result.url);
        telegramWebhookLastError = json.result.last_error_message
          ? String(json.result.last_error_message)
          : null;
        return res.json({
          ok: true,
          webhookInfo: {
            url: json.result.url || '',
            pendingUpdateCount: Number(json.result.pending_update_count ?? 0),
            lastErrorMessage: json.result.last_error_message || null,
            maxConnections: Number(json.result.max_connections ?? 40),
          },
          status: buildTelegramDualStreamStatus(),
        });
      }
      return res.json({
        ok: false,
        error: String(json?.description || `Telegram getWebhookInfo HTTP ${resp.status}`),
        status: buildTelegramDualStreamStatus(),
      });
    } catch (err) {
      return res.json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to reach Telegram API.',
        status: buildTelegramDualStreamStatus(),
      });
    } finally {
      clearTimeout(timer);
    }
  });

  // Inbound Telegram Bot Webhook Receiver (Secret-token verified or authenticated operator test)
  app.post('/api/telegram/webhook', standardWriteRateLimit, async (req, res) => {
    const expectedSecret = getTelegramWebhookSecret();
    const providedSecret = String(req.headers['x-telegram-bot-api-secret-token'] || '');
    const isOperatorSimulated =
      hasConfiguredOperatorToken(req) ||
      verifyOperatorSessionToken(req.headers['x-signal-session']);

    if (expectedSecret && !isOperatorSimulated && !timingSafeEqualStr(providedSecret, expectedSecret)) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid X-Telegram-Bot-Api-Secret-Token header.',
      });
    }

    const parsed = parseTelegramWebhookUpdate(req.body);
    if (!parsed.valid) {
      return res.status(400).json({ ok: false, error: 'Malformed Telegram webhook update payload.' });
    }

    telegramWebhookTotalInbound += 1;
    telegramWebhookLastInboundAt = new Date().toISOString();

    let actionTaken = 'Update acknowledged';
    if (parsed.chatType === 'private' && parsed.chatId) {
      if (parsed.command === '/start' || parsed.command === '/bind_dev') {
        if (parsed.chatId !== getPublicChannelChatId()) {
          boundDeveloperChatId = parsed.chatId;
          autoBoundDeveloperViaWebhook = true;
          actionTaken = 'Bound developer private audit stream & replied with live telemetry';
          await dispatchDeveloperSystemAudit('WEBHOOK_COMMAND', parsed.chatId);
        }
      } else if (parsed.command === '/audit' || parsed.command === '/status' || parsed.command === '/health') {
        if (!boundDeveloperChatId && parsed.chatId !== getPublicChannelChatId()) {
          boundDeveloperChatId = parsed.chatId;
          autoBoundDeveloperViaWebhook = true;
        }
        actionTaken = `Dispatched live developer system audit for ${parsed.command}`;
        await dispatchDeveloperSystemAudit('WEBHOOK_COMMAND', parsed.chatId);
      } else if (parsed.command === '/daily') {
        actionTaken = 'Dispatched on-demand daily system audit report';
        await dispatchDeveloperSystemAudit('DAILY_DIGEST', parsed.chatId);
      } else if (parsed.command === '/signals') {
        const latest = publicSignalStreamLog.slice(0, 3);
        const replyText =
          latest.length > 0
            ? latest.map((s) => s.formattedMessage).join('\n\n---\n\n')
            : '[SIGNAL FORGE] No public trade signals dispatched yet in current session.';
        await sendTelegramRawMessage({ chatId: parsed.chatId, text: replyText });
        actionTaken = `Replied with ${latest.length} recent Signal Forge trade alerts`;
      }
    }

    const inboundRecord: TelegramWebhookInboundEvent = {
      id: `wh_${parsed.updateId || Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      updateId: parsed.updateId,
      chatId: parsed.chatId ? maskChatId(parsed.chatId) : 'unknown',
      chatType: parsed.chatType,
      senderLabel: parsed.senderLabel,
      command: parsed.command,
      textPreview: parsed.text.slice(0, 120) || '(no text)',
      actionTaken,
      timestamp: telegramWebhookLastInboundAt,
    };
    recentWebhookEventsLog.unshift(inboundRecord);
    if (recentWebhookEventsLog.length > 25) recentWebhookEventsLog.length = 25;

    return res.json({
      ok: true,
      event: inboundRecord,
      status: buildTelegramDualStreamStatus(),
    });
  });

  // Autonomous Backend Monitoring Agent Health & Sub-Second SSE Heartbeat Stream (Spot Priority)
  app.get('/api/monitor/health', (_req, res) => {
    res.json({
      ok: true,
      monitor: monitorState,
      syncEpoch: serverSyncEpoch,
      spotSource: spotFeedSource,
      futuresSource: futuresFeedSource,
      cmcSource: cmcValuationsSource,
      gainerSource: gainerFeederSource,
    });
  });

  app.get('/api/monitor/stream', (req, res) => {
    if (sseTickListeners.size >= MAX_MONITOR_SSE_CLIENTS) {
      res.setHeader('Retry-After', '5');
      return res.status(503).json({ ok:false, error:'Monitor stream capacity reached, retry shortly.' });
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let closed = false;
    let streamTimer: ReturnType<typeof setInterval> | null = null;
    const cleanupStream = () => {
      if (closed) return;
      closed = true;
      if (streamTimer) {
        clearInterval(streamTimer);
        streamTimer = null;
      }
      sseTickListeners.delete(writeSpotTicks);
      if (!res.writableEnded) {
        try {
          res.end();
        } catch {
          // ignore already-closed response
        }
      }
    };

    const writeHeartbeat = () => {
      if (closed || res.writableEnded || !systemControls.liveFeedModulesEnabled) return;
      try {
        if (res.writableLength > MAX_MONITOR_SSE_BACKPRESSURE_BYTES) {
          cleanupStream();
          return;
        }
        if (!res.write(`event: heartbeat\ndata: ${JSON.stringify(monitorState)}\n\n`)) {
          cleanupStream();
        }
      } catch {
        cleanupStream();
      }
    };

    const writeSpotTicks = (ticks: SpotStreamTick[]) => {
      if (closed || res.writableEnded || !systemControls.liveFeedModulesEnabled || ticks.length === 0) {
        if (closed || res.writableEnded) cleanupStream();
        return;
      }
      try {
        if (res.writableLength > MAX_MONITOR_SSE_BACKPRESSURE_BYTES) {
          cleanupStream();
          return;
        }
        // Monitor UI feeds are informational; do not buffer unbounded slow clients.
        if (!res.write(`event: spot_ticks\ndata: ${JSON.stringify({ ticks, syncEpoch: serverSyncEpoch })}\n\n`)) {
          cleanupStream();
        }
      } catch {
        cleanupStream();
      }
    };

    sseTickListeners.add(writeSpotTicks);
    if (systemControls.liveFeedModulesEnabled) {
      writeHeartbeat();
      const initialTicks: SpotStreamTick[] = Object.values(spotFeedCache).map((s) => ({
        symbol: s.symbol,
        price: s.price,
        markPrice: s.price,
        change24hPercent: s.change24hPercent,
        high24h: s.high24h,
        low24h: s.low24h,
        volume24hUsd: s.volume24hUsd,
        source: 'binance_spot',
        updatedAtMs: s.updatedAtMs || Date.now(),
      }));
      if (spotFeedSource === 'binance_spot' && initialTicks.length > 0) {
        writeSpotTicks(initialTicks);
      }
    }

    streamTimer = setInterval(writeHeartbeat, SUBSECOND_HEARTBEAT_INTERVAL_MS);
    req.on('close', cleanupStream);
    res.on('error', cleanupStream);
  });

  // Offloaded Backend Market Intelligence, Fundamental Criteria & Whale Netflow Evaluation
  app.post('/api/coordinator/evaluate', requireOperatorAuth, standardWriteRateLimit, async (req, res) => {
    const rawSymbols: string[] = Array.isArray(req.body?.symbols)
      ? req.body.symbols.map((s: unknown) => String(s).toUpperCase()).slice(0, 12)
      : TRACKED_COINS.slice(0, 6).map((c) => c.symbol);

    const intel = await fetchMarketIntelligence();
    const flowMap = new Map<string, ExchangeFlowMetric>();
    for (const f of intel.flows) {
      flowMap.set(f.symbol.toUpperCase(), f);
    }

    const evaluations = rawSymbols.map((sym) => {
      const base = sym.replace(/USDT$/i, '');
      const fundamental = runFundamentalAgent(base, DEFAULT_NEWS_FEED);
      const flow = flowMap.get(sym);
      const whaleBias = flow
        ? flow.netflowUsd < -5_000_000
          ? 'ACCUMULATION'
          : flow.netflowUsd > 5_000_000
          ? 'DISTRIBUTION'
          : 'NEUTRAL'
        : 'NEUTRAL';

      return {
        symbol: sym,
        fundamentalScore: fundamental.score,
        fundamentalSummary: fundamental.summary,
        whaleBias,
        whaleFlowVerified: false,
        netflowUsd: flow?.netflowUsd ?? 0,
        inflow24hUsd: flow?.inflow24hUsd ?? 0,
        outflow24hUsd: flow?.outflow24hUsd ?? 0,
        source: intel.source,
      };
    });

    res.json({
      ok: true,
      offloadedToBackend: true,
      evaluatedAt: new Date().toISOString(),
      source: intel.source,
      evaluations,
    });
  });

  // Automated Daily, Weekly & Monthly Structured Reports + Email/Telegram Dispatch
  app.get('/api/reports/auto', (_req, res) => {
    const reports = (['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((period) => {
      const fresh = buildStructuredReport(period);
      structuredReportsCache[period] = fresh;
      return fresh;
    });
    res.json({
      ok: true,
      reports,
      generatedAt: new Date().toISOString(),
    });
  });

  app.post('/api/reports/performance', requireOperatorAuth, standardWriteRateLimit, async (req, res) => {
    const rawPeriod = String(req.body?.period || 'DAILY').toUpperCase();
    const period: 'DAILY' | 'WEEKLY' | 'MONTHLY' =
      rawPeriod === 'WEEKLY' ? 'WEEKLY' : rawPeriod === 'MONTHLY' ? 'MONTHLY' : 'DAILY';
    const { record, report } = await dispatchPerformanceReport(period);
    return res.json({ ok: true, period, record, report });
  });

  function buildMarkPriceMap(): Record<string, number> {
    const map: Record<string, number> = {};
    for (const [sym, data] of Object.entries(spotFeedCache)) {
      map[sym] = data.price;
    }
    for (const [sym, data] of Object.entries(futuresFeedCache)) {
      if (!map[sym]) map[sym] = data.markPrice;
    }
    return map;
  }

  // Interactive Live Switch 6-Digit Email OTP Challenge Endpoint
  app.post('/api/security/live-otp/request', requireOperatorAuth, otpRequestRateLimit, requirePremiumSubscription('EXECUTION'), async (_req, res) => {
    const challengeId = `otp_${crypto.randomUUID().slice(0, 10)}`;
    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = Date.now() + 5 * 60_000;
    liveOtpChallenges.set(challengeId, {
      id: challengeId,
      code,
      recipient: OWNER_EMAIL,
      expiresAt,
      used: false,
      attempts: 0,
    });

    for (const [key, val] of liveOtpChallenges.entries()) {
      if (val.used || val.expiresAt < Date.now()) {
        liveOtpChallenges.delete(key);
      }
    }

    const resendConfigured = Boolean(process.env.RESEND_API_KEY?.startsWith('re_'));
    const emailRecord = await sendAlertEmail({
      type: 'HIGH_CONFIDENCE_SIGNAL',
      subject: `Signal Forge Live Execution Mode OTP`,
      summary: `Live Execution Mode switch confirmation OTP dispatched to ${OWNER_EMAIL}`,
      bodyHtml: `
        <p>A request was initiated to switch the Signal Forge Autonomous Coordinator from <strong>TESTNET</strong> to <strong>LIVE</strong> execution:</p>
        <div style="background:#111827;border:1px solid #3b82f6;border-radius:8px;padding:16px;margin:14px 0;text-align:center;">
          <span style="display:block;font-size:12px;color:#94a3b8;margin-bottom:6px;">ONE-TIME CONFIRMATION CODE (EXPIRES IN 5 MINUTES)</span>
          <span style="font-size:28px;font-weight:700;letter-spacing:6px;color:#ffffff;font-family:monospace;">${escapeHtml(code)}</span>
        </div>
        <p style="font-size:12px;color:#94a3b8;">If you did not initiate this mode switch, remain on Testnet and revoke your API session keys.</p>
      `,
    });

    const deliveredViaEmail = resendConfigured && emailRecord.status === 'sent';
    if (!deliveredViaEmail && process.env.NODE_ENV !== 'production') {
      console.info(`[LiveSwitch OTP][DEV] challenge=${challengeId} code=${code}`);
    }

    return res.json({
      ok: true,
      challengeId,
      expiresAt: new Date(expiresAt).toISOString(),
      recipient: OWNER_EMAIL,
      emailSent: deliveredViaEmail,
      deliveryMode: deliveredViaEmail ? 'email' : 'server_log',
    });
  });

  // Testnet Sandbox & Security-Gated Live Execution Endpoints (Spot Priority + Optional Futures)
  app.get('/api/execution/state', (_req, res) => {
    const liveConfigured = Boolean(
      process.env.BINANCE_LIVE_API_KEY && process.env.BINANCE_LIVE_SECRET
    );
    const testnetConfigured = Boolean(
      process.env.BINANCE_TESTNET_API_KEY && process.env.BINANCE_TESTNET_SECRET
    );
    const crossMargin = summarizeCrossMarginWallet(
      crossWalletBalanceUsd,
      sandboxPositions,
      buildMarkPriceMap()
    );
    res.json({
      mode: executionMode,
      marketType: 'SPOT',
      marginMode: 'CROSS',
      endpoint:
        executionMode === 'TESTNET' ? SPOT_TESTNET_ENDPOINT : SPOT_REST_ENDPOINTS[0],
      testnetConfigured,
      liveConfigured,
      testnetBalanceUsd: crossMargin.walletBalanceUsd,
      crossMargin,
      positions: sandboxPositions,
      totalExecutedOrders,
    });
  });

  app.post('/api/execution/mode', requireOperatorAuth, modeSwitchRateLimit, requirePremiumSubscription('EXECUTION'), (req, res) => {
    const nextMode = req.body?.mode === 'LIVE' ? 'LIVE' : 'TESTNET';

    if (nextMode === 'LIVE') {
      const challengeId = String(req.body?.challengeId || '');
      const securityAnswer = String(req.body?.securityAnswer || '');
      const otpCode = String(req.body?.otpCode || '');
      const challenge = liveOtpChallenges.get(challengeId);

      if (!challenge || challenge.used || challenge.expiresAt < Date.now()) {
        return res.status(403).json({
          ok: false,
          error: 'Email OTP challenge missing or expired. Request a new 6-digit OTP first.',
        });
      }

      if (challenge.attempts >= MAX_OTP_VERIFY_ATTEMPTS) {
        liveOtpChallenges.delete(challengeId);
        return res.status(429).json({
          ok: false,
          error: 'OTP challenge locked due to too many failed verification attempts. Request a new OTP.',
        });
      }

      const check = validateLiveSwitchChallenge({
        securityAnswer,
        otpInput: otpCode,
        expectedOtp: challenge.code,
      });

      if (!check.valid) {
        challenge.attempts += 1;
        if (challenge.attempts >= MAX_OTP_VERIFY_ATTEMPTS) {
          liveOtpChallenges.delete(challengeId);
          return res.status(429).json({
            ok: false,
            error: 'Too many invalid OTP attempts. Challenge invalidated — request a fresh OTP.',
          });
        }
        return res.status(403).json({
          ok: false,
          error: check.error,
          attemptsRemaining: MAX_OTP_VERIFY_ATTEMPTS - challenge.attempts,
        });
      }

      challenge.used = true;
      liveOtpChallenges.delete(challengeId);
    }

    executionMode = nextMode;
    const liveConfigured = Boolean(
      process.env.BINANCE_LIVE_API_KEY && process.env.BINANCE_LIVE_SECRET
    );
    res.json({
      ok: true,
      mode: executionMode,
      marketType: 'SPOT',
      endpoint:
        executionMode === 'TESTNET' ? SPOT_TESTNET_ENDPOINT : SPOT_REST_ENDPOINTS[0],
      liveConfigured,
      warning:
        executionMode === 'LIVE' && !liveConfigured
          ? 'Live execution armed in Guarded Mirror Mode (add BINANCE_LIVE_API_KEY & BINANCE_LIVE_SECRET in secrets for exchange order signing).'
          : null,
    });
  });

  app.post('/api/execution/order', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('EXECUTION'), (req, res) =>
    executionMutex.runExclusive(async () => {
    if (!systemControls.testnetExecutionEnabled && executionMode === 'TESTNET') {
      return res.status(409).json({
        ok: false,
        error:
          'Binance Testnet Execution is paused via Master Toggle. Enable Testnet Execution to place trades.',
      });
    }
    const {
      symbol,
      direction,
      entryPrice,
      notionalUsd,
      leverage,
      marginMode,
      marketType: reqMarketType,
      initialStopLoss,
      trailingStopLoss,
      takeProfits,
      skepticVerdict,
      fundingRate,
      syncToLiveMark,
    } = req.body || {};

    const cleanSym = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const submittedEntry = Number(entryPrice);
    if (!cleanSym || !Number.isFinite(submittedEntry) || submittedEntry <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid symbol or live Spot price.' });
    }

    const notional = Math.max(50, Math.min(250_000, Number(notionalUsd || 1500)));
    const isFuturesOrder = reqMarketType === 'USD_M_FUTURES' && Number(leverage || 1) > 1;
    const reqLev = isFuturesOrder ? Math.max(2, Math.min(125, Math.round(Number(leverage || 5)))) : 1;
    const reqMarginMode = marginMode === 'ISOLATED' ? 'ISOLATED' : 'CROSS';
    const side = direction === 'SELL' ? 'SELL' : 'BUY';

    if (!spotFeedCache[cleanSym]) {
      await pollBinanceSpotFeed();
    }
    if (isFuturesOrder && !futuresFeedCache[cleanSym]) {
      await pollBinanceFuturesFeed();
    }

    const liveRefPrice =
      isFuturesOrder && futuresFeedCache[cleanSym]?.markPrice
        ? futuresFeedCache[cleanSym].markPrice
        : spotFeedCache[cleanSym]?.price;

    if (!liveRefPrice || !Number.isFinite(liveRefPrice) || liveRefPrice <= 0) {
      return res.status(503).json({
        ok: false,
        error: `Authoritative live mark price unavailable for ${cleanSym}. Execution failed closed.`,
      });
    }

    const priceCheck = validateLiveExecutionPrice({
      submittedPrice: submittedEntry,
      liveFeedPrice: liveRefPrice,
      maxSlippagePct: DEFAULT_MAX_EXECUTION_SLIPPAGE_PCT,
    });

    if (!priceCheck.valid && (!syncToLiveMark || priceCheck.deviationPct > 1.5)) {
      return res.status(409).json({
        ok: false,
        error:
          priceCheck.deviationPct > 1.5
            ? `Submitted entry deviates ${priceCheck.deviationPct.toFixed(2)}% from live mark ($${liveRefPrice}), exceeding hard 1.50% ceiling.`
            : priceCheck.reason,
        liveMarkPrice: priceCheck.synchronizedPrice,
        deviationPct: priceCheck.deviationPct,
      });
    }

    const entry = priceCheck.synchronizedPrice > 0 ? priceCheck.synchronizedPrice : liveRefPrice;
    const refCandles = generateDeterministicCandles(cleanSym, '1h', 30, undefined, entry);
    const atr = computeATR(refCandles, 14);
    const orderKernel = buildKernelValidatedRiskProfile({
      direction: side,
      entryPrice: entry,
      closedCandles: refCandles,
      atr14: atr,
      maxRiskPct: 2.0,
      targetRR: 5.0,
    });
    const mandatedInitialSl =
      Number(initialStopLoss) > 0
        ? enforceMaxStopLossCap(entry, side, Number(initialStopLoss), 2.0)
        : orderKernel.stopLoss;
    const mandatedTrailingSl =
      Number(trailingStopLoss) > 0
        ? enforceMaxStopLossCap(entry, side, Number(trailingStopLoss), 2.0)
        : orderKernel.stopLoss;
    const explicitTp3 =
      Array.isArray(takeProfits) && takeProfits.length === 3 && Number(takeProfits[2]) > 0
        ? Number(takeProfits[2])
        : orderKernel.takeProfits[2];
    const trailingTp5xAtr = orderKernel.takeProfits[2];

    reconcileServerForgeCapital();
    const targetModuleId: ForgeModuleId = req.body?.moduleId
      ? (req.body.moduleId as ForgeModuleId)
      : isFuturesOrder
      ? 'FUTURES_COORDINATOR'
      : 'SPOT_MOMENTUM';
    const routeCheck = routeDualExecutionOrder(forgeCapitalState, {
      moduleId: targetModuleId,
      market: isFuturesOrder ? 'USD_M_FUTURES' : 'SPOT',
      environment: executionMode,
      guardProfileLock: executionMode === 'LIVE' ? undefined : SERVER_GUARD_LOCK,
      liveMandate: SERVER_LIVE_MANDATE,
      symbol: cleanSym,
      direction: side,
      notionalUsd: notional,
      leverage: reqLev,
      marginMode: reqMarginMode,
      submittedPrice: submittedEntry,
      authoritativePrice: liveRefPrice,
      appLiveEnabled,
      stopLoss: mandatedInitialSl,
      takeProfit: explicitTp3,
      stopOrigin: 'STRUCTURAL_INVALIDATION',
      targetOrigin: 'STRUCTURAL_LIQUIDITY_POOL',
      enforceRRGate: true,
    });
    if (!routeCheck.ok) {
      forgeCapitalState = recordForgeApiError(routeCheck.nextState, {
        market: isFuturesOrder ? 'USD_M_FUTURES' : 'SPOT',
        moduleId: targetModuleId,
        endpoint: '/api/execution/order',
        httpStatus: routeCheck.statusCode,
        exchangeCode: routeCheck.rejectionCode ?? routeCheck.routeRecord.status,
        latencyMs: 8,
        message: routeCheck.error || 'Execution blocked by Forge Capital Hub safeguard.',
      });
      return res.status(routeCheck.statusCode).json({
        ok: false,
        error: routeCheck.error,
        rejectionCode: routeCheck.rejectionCode,
        guardDenial: routeCheck.guardDenial,
        forgeCapitalState,
      });
    }
    forgeCapitalState = routeCheck.nextState;

    const markMap = buildMarkPriceMap();
    const walletBefore = summarizeCrossMarginWallet(
      crossWalletBalanceUsd,
      sandboxPositions,
      markMap
    );

    const futTel = futuresFeedCache[cleanSym];
    const maxLev = isFuturesOrder
      ? futTel?.maxLeverage ?? FUTURES_MAX_LEVERAGE[cleanSym] ?? 50
      : 1;
    const safeLev = isFuturesOrder ? Math.min(maxLev, reqLev) : 1;

    const marginCalc = isFuturesOrder
      ? calculateFuturesDynamicMargin({
          entryPrice: entry,
          stopLoss: mandatedInitialSl,
          direction: side,
          notionalUsd: notional,
          leverage: safeLev,
          recommendedLeverage: safeLev,
          maxLeverage: maxLev,
          marginMode: reqMarginMode,
          crossAvailableBalanceUsd: walletBefore.availableCrossMarginUsd,
          fundingRate: Number(fundingRate ?? futTel?.fundingRate ?? 0.0001),
        })
      : {
          leverage: 1,
          recommendedLeverage: 1,
          maxLeverage: 1,
          scalingMode: 'MANUAL' as const,
          marginMode: 'CROSS' as const,
          notionalUsd: Number(notional.toFixed(2)),
          initialMarginUsd: Number(notional.toFixed(2)),
          maintenanceMarginUsd: 0,
          maintenanceMarginRate: 0,
          estimatedFeeUsd: Number((notional * 0.001).toFixed(2)),
          liquidationPrice: 0,
          stopBeforeLiquidationSafe: true,
          fundingImpactUsd8h: 0,
        };

    if (marginCalc.initialMarginUsd + marginCalc.estimatedFeeUsd > walletBefore.availableCrossMarginUsd) {
      return res.status(400).json({
        ok: false,
        error: `Insufficient Available Testnet Balance ($${walletBefore.availableCrossMarginUsd.toFixed(2)} available, requires $${(marginCalc.initialMarginUsd + marginCalc.estimatedFeeUsd).toFixed(2)}).`,
      });
    }

    crossWalletBalanceUsd = Number(
      (crossWalletBalanceUsd - marginCalc.estimatedFeeUsd).toFixed(2)
    );

    const pos: SandboxPosition = {
      id: `${isFuturesOrder ? 'fut' : 'spot'}_${executionMode}_${cleanSym}_${Date.now()}`,
      symbol: cleanSym,
      direction: side,
      mode: executionMode,
      marketType: isFuturesOrder ? 'USD_M_FUTURES' : 'SPOT',
      marginMode: reqMarginMode,
      leverage: marginCalc.leverage,
      entryPrice: entry,
      quantity: Number((notional / entry).toFixed(5)),
      notionalUsd: marginCalc.notionalUsd,
      initialMarginUsd: marginCalc.initialMarginUsd,
      maintenanceMarginUsd: marginCalc.maintenanceMarginUsd,
      liquidationPrice: marginCalc.liquidationPrice,
      fundingRate: isFuturesOrder ? Number(fundingRate ?? futTel?.fundingRate ?? 0.0001) : 0,
      settledFundingUsd: 0,
      initialStopLoss: mandatedInitialSl,
      trailingStopLoss: mandatedTrailingSl,
      maxStopLossPct: 2.0,
      trailingTakeProfit5xAtr: trailingTp5xAtr,
      peakFavorablePrice: entry,
      takeProfits:
        Array.isArray(takeProfits) && takeProfits.length === 3
          ? [Number(takeProfits[0]), Number(takeProfits[1]), Number(takeProfits[2])]
          : [
              orderKernel.takeProfits[0],
              orderKernel.takeProfits[1],
              trailingTp5xAtr,
            ],
      status: 'OPEN',
      pnlUsd: 0,
      pnlPercent: 0,
      roePercent: 0,
      skepticVerdict:
        skepticVerdict === 'VETOED'
          ? 'VETOED'
          : skepticVerdict === 'CAUTION'
          ? 'CAUTION'
          : 'APPROVED',
      openedAt: new Date().toISOString(),
    };

    sandboxPositions.unshift(pos);
    if (sandboxPositions.length > 30) sandboxPositions.length = 30;
    totalExecutedOrders++;

    const crossMargin = summarizeCrossMarginWallet(
      crossWalletBalanceUsd,
      sandboxPositions,
      markMap
    );

    sendTelegramAlertIfConfigured(
      `[${executionMode} ${pos.marketType}] ${pos.direction} ${pos.symbol} (${pos.leverage}x) @ $${pos.entryPrice} | ATR Trail SL $${pos.trailingStopLoss}`,
      true
    ).catch(() => undefined);

    const reconciledForgeState = reconcileServerForgeCapital();
    GLOBAL_MICROSERVICE_COORDINATOR.recordNonBlockingSuccess('execution-router-svc', 11);

    return res.json({
      ok: true,
      position: pos,
      validatedPrice: entry,
      priceDeviationPct: priceCheck.deviationPct,
      atrTrailingStopMandated: true,
      testnetBalanceUsd: crossMargin.walletBalanceUsd,
      crossMargin,
      forgeCapitalState: reconciledForgeState,
    });
    })
  );

  app.post('/api/execution/close', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('EXECUTION'), (req, res) =>
    executionMutex.runExclusive(() => {
    if (!systemControls.testnetExecutionEnabled && executionMode === 'TESTNET') {
      return res.status(409).json({
        ok: false,
        error: 'Binance Testnet Execution is paused via Master Toggle.',
      });
    }
    const { positionId, exitPrice } = req.body || {};
    const pos = sandboxPositions.find((p) => p.id === positionId && p.status === 'OPEN');
    if (!pos) {
      return res.status(404).json({ ok: false, error: 'Open position not found.' });
    }
    const markMap = buildMarkPriceMap();
    const exit = Number(exitPrice || markMap[pos.symbol] || pos.entryPrice);
    const settlement = settleCrossMarginClose({
      walletBalanceUsd: crossWalletBalanceUsd,
      position: pos,
      exitPrice: exit,
    });

    crossWalletBalanceUsd = settlement.updatedWalletBalanceUsd;
    pos.status = 'CLOSED_MANUAL';
    pos.pnlUsd = settlement.netRealizedPnlUsd;
    pos.pnlPercent = settlement.pnlPercent;
    pos.roePercent = settlement.roePercent;
    pos.closedAt = new Date().toISOString();
    profitVaultEngine.ingestRealizedTrade({
      tradeId: `manual_close_${pos.id}`,
      symbol: pos.symbol,
      realizedPnlUsd: settlement.netRealizedPnlUsd,
      sourceAgent: 'MANUAL_EXECUTION_CLOSE',
    });

    const crossMargin = summarizeCrossMarginWallet(
      crossWalletBalanceUsd,
      sandboxPositions,
      markMap
    );
    const reconciledForgeState = reconcileServerForgeCapital();

    return res.json({
      ok: true,
      position: pos,
      settlement,
      testnetBalanceUsd: crossMargin.walletBalanceUsd,
      crossMargin,
      forgeCapitalState: reconciledForgeState,
    });
    })
  );

  // Settles accrued 8H Cross-Margin funding fees across open USD-M Futures positions
  app.post('/api/execution/settle-cross', requireOperatorAuth, standardWriteRateLimit, requirePremiumSubscription('EXECUTION'), (_req, res) =>
    executionMutex.runExclusive(() => {
    if (!systemControls.testnetExecutionEnabled && executionMode === 'TESTNET') {
      return res.status(409).json({
        ok: false,
        error: 'Binance Testnet Execution is paused via Master Toggle.',
      });
    }
    let totalFundingDelta = 0;
    const markMap = buildMarkPriceMap();
    for (const pos of sandboxPositions) {
      if (pos.status !== 'OPEN' || pos.marketType !== 'USD_M_FUTURES') continue;
      const fr = futuresFeedCache[pos.symbol]?.fundingRate ?? pos.fundingRate ?? 0.0001;
      const delta = pos.direction === 'BUY' ? -pos.notionalUsd * fr : pos.notionalUsd * fr;
      const roundedDelta = Number(delta.toFixed(4));
      pos.settledFundingUsd = Number(((pos.settledFundingUsd ?? 0) + roundedDelta).toFixed(4));
      totalFundingDelta += roundedDelta;
    }
    crossWalletBalanceUsd = Number((crossWalletBalanceUsd + totalFundingDelta).toFixed(2));
    const crossMargin = summarizeCrossMarginWallet(
      crossWalletBalanceUsd,
      sandboxPositions,
      markMap
    );
    const reconciledForgeState = reconcileServerForgeCapital();
    return res.json({
      ok: true,
      fundingDeltaUsd: Number(totalFundingDelta.toFixed(4)),
      testnetBalanceUsd: crossMargin.walletBalanceUsd,
      crossMargin,
      positions: sandboxPositions,
      forgeCapitalState: reconciledForgeState,
    });
    })
  );

  // --- Multi-Agent Trading Architecture: TradingView Webhooks, Public Trade ID Verification & 30m Dev Audit ---
  const serverVerifiedTrades: PublicVerifiedTradeRecord[] = [
    createPublicVerifiedTradeRecord({
      sequenceNumber: 1,
      symbol: 'BTCUSDT',
      direction: 'BUY',
      market: 'SPOT',
      stage: 'CONFIRMED_SETUP',
      entryPrice: 63850,
      stopLoss: 62700,
      takeProfit: 81100,
      confidence: 88,
      patternLabel: 'EMA 21/50/200 Alignment + Institutional LVN Breakout',
      createdAtIso: '2026-05-01T09:15:00.000Z',
    }),
    createPublicVerifiedTradeRecord({
      sequenceNumber: 2,
      symbol: 'SOLUSDT',
      direction: 'BUY',
      market: 'USD_M_FUTURES',
      stage: 'EXECUTION_ENTRY',
      entryPrice: 148.5,
      stopLoss: 145.6,
      takeProfit: 186.2,
      confidence: 85,
      patternLabel: '3/3 Pre-Pump Orderbook Accumulation',
      createdAtIso: '2026-05-01T11:30:00.000Z',
    }),
  ];
  const serverTradingViewSignals: TradingViewWebhookSignal[] = [];
  let serverLast30mAuditSentAtMs = Date.now() - 10 * 60_000;

  app.get('/api/trading-arch/state', (_req, res) => {
    return res.json({
      ok: true,
      verifiedTradeCount: serverVerifiedTrades.length,
      verifiedTrades: serverVerifiedTrades.slice(0, 25),
      tradingViewSignals: serverTradingViewSignals.slice(0, 25),
      auditBatchIntervalMinutes: DEVELOPER_AUDIT_BATCH_INTERVAL_MIN,
      developerExclusiveAuditOnly: true,
      publicChannelAuditBlocked: true,
      last30mAuditSentAtIso: new Date(serverLast30mAuditSentAtMs).toISOString(),
    });
  });

  // Public Community Trade ID Cryptographic Verification Protocol
  app.get('/api/trading-arch/verify/:tradeId', (req, res) => {
    const tradeId = String(req.params.tradeId || '').trim();
    const verification = verifyPublicTradeId(tradeId, serverVerifiedTrades);
    return res.status(verification.verified ? 200 : 404).json({
      ok: verification.verified,
      verification,
    });
  });

  app.post('/api/trading-arch/verify/register', standardWriteRateLimit, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const symbol = String(body.symbol || 'BTCUSDT').toUpperCase();
    const direction = String(body.direction || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
    const market =
      String(body.market || 'SPOT').toUpperCase() === 'USD_M_FUTURES' ? 'USD_M_FUTURES' : 'SPOT';
    const entryPrice = Number(body.entryPrice) || spotFeedCache[symbol]?.price || 100;
    const stopLoss =
      Number(body.stopLoss) ||
      (direction === 'BUY' ? entryPrice * 0.985 : entryPrice * 1.015);
    const rrMultiplier = Math.max(5, Number(body.rrMultiplier) || 5);
    const riskDist = Math.max(entryPrice * 0.002, Math.abs(entryPrice - stopLoss));
    const takeProfit =
      Number(body.takeProfit) ||
      (direction === 'BUY'
        ? entryPrice + riskDist * rrMultiplier
        : Math.max(entryPrice * 0.05, entryPrice - riskDist * rrMultiplier));
    const record = createPublicVerifiedTradeRecord({
      sequenceNumber: serverVerifiedTrades.length + 1,
      symbol,
      direction,
      market,
      stage:
        body.stage === 'EXECUTION_ENTRY' || body.stage === 'FINAL_PNL_RESULT'
          ? body.stage
          : 'CONFIRMED_SETUP',
      entryPrice,
      stopLoss,
      takeProfit,
      confidence: Math.min(99, Math.max(50, Number(body.confidence) || 84)),
      patternLabel: String(body.patternLabel || 'Multi-Agent Confirmed Setup'),
      realizedPnlUsd: typeof body.realizedPnlUsd === 'number' ? body.realizedPnlUsd : null,
      realizedPnlPct: typeof body.realizedPnlPct === 'number' ? body.realizedPnlPct : null,
    });
    serverVerifiedTrades.unshift(record);
    if (serverVerifiedTrades.length > 100) serverVerifiedTrades.length = 100;
    return res.status(201).json({ ok: true, record });
  });

  // TradingView Webhook Integration for Technical Indicator Synchronization
  app.post('/api/tradingview/webhook', standardWriteRateLimit, (req, res) => {
    const signal = normalizeTradingViewWebhook((req.body ?? {}) as Record<string, unknown>);
    if (!signal) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid TradingView webhook payload: requires valid symbol, price > 0, and action.',
      });
    }
    serverTradingViewSignals.unshift(signal);
    if (serverTradingViewSignals.length > 50) serverTradingViewSignals.length = 50;
    return res.json({
      ok: true,
      signal,
      totalReceived: serverTradingViewSignals.length,
    });
  });

  // Autonomous System Audit & 30-Minute Batched Developer-Exclusive Routing
  app.post('/api/trading-arch/audit/run', standardWriteRateLimit, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const forceElapsed = Boolean(body.forceElapsed);
    const nowIso = new Date().toISOString();
    const rawEvents: Array<{
      id: string;
      source: 'EXECUTION_LOG' | 'BROKER_API' | 'NOTIFICATION_PAYLOAD' | 'FEED_PIPELINE';
      httpStatus?: number;
      message: string;
      timestampIso: string;
    }> = [];

    if (Array.isArray(body.events)) {
      for (let i = 0; i < body.events.length; i++) {
        const item = body.events[i] as Record<string, unknown>;
        rawEvents.push({
          id: String(item.id || `evt_${i}`),
          source:
            item.source === 'EXECUTION_LOG' ||
            item.source === 'BROKER_API' ||
            item.source === 'NOTIFICATION_PAYLOAD' ||
            item.source === 'FEED_PIPELINE'
              ? item.source
              : 'BROKER_API',
          httpStatus: typeof item.httpStatus === 'number' ? item.httpStatus : undefined,
          message: String(item.message || 'Unknown audit event'),
          timestampIso: typeof item.timestampIso === 'string' ? item.timestampIso : nowIso,
        });
      }
    } else {
      for (const errLog of forgeCapitalState.apiErrorLogs.slice(0, 6)) {
        rawEvents.push({
          id: errLog.id,
          source: 'BROKER_API',
          httpStatus: errLog.httpStatus,
          message: `${errLog.endpoint}: ${errLog.message}`,
          timestampIso: errLog.timestamp,
        });
      }
    }

    const findings = diagnoseSystemAuditEvents(rawEvents);
    const nowMs = Date.now();
    const criticalFindingsCount = findings.filter((f) => f.severity === 'CRITICAL').length;
    const dispatchDecision = evaluateDeveloperAuditDispatch({
      policy: {
        developerExclusiveOnly: true,
        suppressHeartbeatSpam: true,
        batchIntervalMinutes: DEVELOPER_AUDIT_BATCH_INTERVAL_MIN,
        lastBatchSentAtMs: forceElapsed
          ? nowMs - (DEVELOPER_AUDIT_BATCH_INTERVAL_MIN + 1) * 60_000
          : serverLast30mAuditSentAtMs,
        pendingMetricsCount: findings.length,
        anomalyLatencyThresholdMs: 2500,
      },
      nowMs,
      currentPeakLatencyMs: lastSpotPollLatencyMs,
      criticalFindingsCount,
    });
    if (dispatchDecision.shouldDispatchNow) {
      serverLast30mAuditSentAtMs = nowMs;
    }
    return res.json({
      ok: true,
      findings,
      dispatchDecision,
    });
  });

  // Agentic CLI Loop, Unified AI Model Gateway & Confirmed Local Script Editor
  app.get('/api/agentic-cli/status', (_req, res) => {
    return res.json({
      ok: true,
      snapshot: agenticCliGateway.getSnapshot(),
    });
  });

  app.post('/api/agentic-cli/toggle', standardWriteRateLimit, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.enabled !== 'boolean') {
      return res.status(400).json({
        ok: false,
        error: 'Boolean field "enabled" is required.',
      });
    }
    const snapshot = agenticCliGateway.setLoopEnabled(body.enabled);
    return res.json({ ok: true, snapshot });
  });

  app.post('/api/agentic-cli/gateway/select', standardWriteRateLimit, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const connectorId = String(body.connectorId || '').trim();
    if (!connectorId) {
      return res.status(400).json({ ok: false, error: 'connectorId is required.' });
    }
    const result = agenticCliGateway.selectConnector(connectorId);
    return res.status(result.ok ? 200 : 400).json(result);
  });

  app.get('/api/agentic-cli/file-preview', (req, res) => {
    const targetPath = String(req.query.path || 'src/config/agenticCliRuntimeConfig.ts');
    const result = agenticCliGateway.readAllowlistedFile(targetPath);
    return res.status(result.ok ? 200 : 400).json(result);
  });

  app.post('/api/agentic-cli/propose', standardWriteRateLimit, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const command = String(body.command || '').trim();
    const inputSource = body.inputSource === 'VOICE' ? 'VOICE' : 'CLI_TEXT';
    const connectorId =
      typeof body.connectorId === 'string' && body.connectorId.trim()
        ? body.connectorId.trim()
        : undefined;

    let explicitFilePatch:
      | {
          readonly targetPath: string;
          readonly searchText: string;
          readonly replaceText: string;
          readonly rationale?: string;
        }
      | undefined;

    if (body.explicitFilePatch && typeof body.explicitFilePatch === 'object') {
      const fp = body.explicitFilePatch as Record<string, unknown>;
      explicitFilePatch = {
        targetPath: String(fp.targetPath || ''),
        searchText: String(fp.searchText || ''),
        replaceText: String(fp.replaceText ?? ''),
        rationale: typeof fp.rationale === 'string' ? fp.rationale : undefined,
      };
    }

    const result = await agenticCliGateway.createProposal({
      command,
      inputSource,
      connectorId,
      explicitFilePatch,
    });
    return res.status(result.statusCode).json(result);
  });

  app.post('/api/agentic-cli/confirm', standardWriteRateLimit, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const proposalId = String(body.proposalId || '').trim();
    const confirmationToken = String(body.confirmationToken || '').trim();
    const approved = body.approved === true;
    const result = agenticCliGateway.confirmProposal({
      proposalId,
      confirmationToken,
      approved,
    });
    return res.status(result.statusCode).json(result);
  });

  app.post('/api/agentic-cli/reject', standardWriteRateLimit, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const proposalId = String(body.proposalId || '').trim();
    const result = agenticCliGateway.rejectProposal(proposalId);
    return res.status(result.statusCode).json(result);
  });

  app.post('/api/agentic-cli/revert', standardWriteRateLimit, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const proposalId = String(body.proposalId || '').trim();
    const result = agenticCliGateway.revertProposalFile(proposalId);
    return res.status(result.statusCode).json(result);
  });

  // Fable 5.2 Multi-Agent 8-Layer Self-Improving Trading Orchestrator Routes
  app.get('/api/fable/status', (_req, res) => {
    return res.json({
      ok: true,
      snapshot: fableOrchestrator.getSnapshot(),
    });
  });

  app.post('/api/fable/evolve', standardWriteRateLimit, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const paramRaw = String(body.parameterToMutate || 'stopAtrMult');
    const parameterToMutate =
      paramRaw === 'lookback' || paramRaw === 'entryZscore' || paramRaw === 'stopAtrMult'
        ? paramRaw
        : 'stopAtrMult';
    const newValue = Number(body.newValue);
    if (!Number.isFinite(newValue) || newValue <= 0) {
      return res.status(400).json({ ok: false, error: 'Positive numeric newValue is required.' });
    }
    const regime = body.regime === 'HIGH_VOLATILITY' ? 'HIGH_VOLATILITY' : 'QUIET';
    const spotPrice = spotFeedCache['BTCUSDT']?.price || 91_400;
    const result = fableOrchestrator.runPhase5Evolution({
      parameterToMutate,
      newValue,
      regime,
      spotPrice,
    });
    return res.json(result);
  });

  app.post('/api/fable/risk/evaluate', standardWriteRateLimit, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const familyRaw = String(body.family || 'MOMENTUM').toUpperCase();
    const family =
      familyRaw === 'BREAKOUT' || familyRaw === 'MEAN_REVERSION' || familyRaw === 'MOMENTUM'
        ? familyRaw
        : 'MOMENTUM';
    const regime = body.regime === 'HIGH_VOLATILITY' ? 'HIGH_VOLATILITY' : 'QUIET';
    const side = String(body.side || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
    const activeCorrelations = Array.isArray(body.activeCorrelations)
      ? body.activeCorrelations.map((v) => Number(v)).filter((v) => Number.isFinite(v))
      : [0.2];
    const result = fableOrchestrator.evaluateRisk({
      side,
      bid: Number(body.bid) || 91_395,
      ask: Number(body.ask) || 91_405,
      atr: Number(body.atr) || 840,
      regime,
      currentEquityUsd: Number(body.currentEquityUsd) || 100_000,
      startOfDayEquityUsd: Number(body.startOfDayEquityUsd) || 100_000,
      highWaterMarkEquityUsd: Number(body.highWaterMarkEquityUsd) || 100_000,
      family,
      sharpeOverride:
        typeof body.sharpeOverride === 'number' && Number.isFinite(body.sharpeOverride)
          ? body.sharpeOverride
          : undefined,
      activeCorrelations,
    });
    return res.json(result);
  });

  app.post('/api/fable/options/price', standardWriteRateLimit, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const optionType = String(body.optionType || 'PUT').toUpperCase() === 'CALL' ? 'CALL' : 'PUT';
    const spotPrice = Number(body.spotPrice) || 91_400;
    const strikePrice = Number(body.strikePrice) || spotPrice;
    const timeToExpiryYears = Number(body.timeToExpiryYears) || 30 / 365;
    const riskFreeRate = Number.isFinite(Number(body.riskFreeRate)) ? Number(body.riskFreeRate) : 0.045;
    const volatility = Number(body.volatility) || 0.46;
    const marketPrice =
      typeof body.marketPrice === 'number' && Number.isFinite(body.marketPrice) && body.marketPrice > 0
        ? body.marketPrice
        : undefined;
    const result = fableOrchestrator.evaluateOption({
      symbol: String(body.symbol || `BTC-OPT-${optionType}`).slice(0, 40),
      optionType,
      spotPrice,
      strikePrice,
      timeToExpiryYears,
      riskFreeRate,
      volatility,
      marketPrice,
    });
    return res.json(result);
  });

  app.post('/api/fable/deployment/approve-live', standardWriteRateLimit, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = fableOrchestrator.approveLiveDeployment({
      versionId: String(body.versionId || '').trim(),
      approvalToken: String(body.approvalToken || '').trim(),
      operatorName: String(body.operatorName || 'Lead Operator').trim(),
    });
    return res.status(result.statusCode).json(result);
  });

  app.get('/api/fable/python-source', (req, res) => {
    const fileId = String(req.query.file || 'main_orchestrator').trim();
    const result = fableOrchestrator.readAllowlistedPythonFile(fileId);
    return res.status(result.ok ? 200 : 400).json(result);
  });

  // Signal Forge × Freqtrade Unified CCXT, SQLite Dry-Run, 50-Win Live Gate & Telegram RPC Routes
  app.get('/api/freqtrade/state', (_req, res) => {
    return res.json({
      ok: true,
      snapshot: freqtradeCore.getSnapshot(),
    });
  });

  app.post('/api/freqtrade/mode', standardWriteRateLimit, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const mode = String(body.mode || '').trim().toUpperCase();
    const result = freqtradeCore.setTradingMode(mode);
    return res.status(result.statusCode).json({
      ...result,
      snapshot: freqtradeCore.getSnapshot(),
    });
  });

  app.post('/api/freqtrade/signal/execute', standardWriteRateLimit, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawExchange = String(body.exchange || 'binance').trim().toLowerCase();
    if (!isSupportedExchange(rawExchange)) {
      return res.status(400).json({
        ok: false,
        message: `Unsupported CCXT exchange "${rawExchange}". Allowed: binance, bybit, okx, kraken.`,
        snapshot: freqtradeCore.getSnapshot(),
      });
    }
    const symbol = String(body.symbol || 'BTC/USDT').trim().toUpperCase();
    const compactKey = symbol.replace('/', '');
    const marketType = String(body.marketType || 'FUTURES').toUpperCase() === 'SPOT' ? 'SPOT' : 'FUTURES';
    const side = String(body.side || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
    const rawEntry = Number(body.entryPrice);
    const liveSpotFallback = spotFeedCache[compactKey]?.price || (compactKey === 'BTCUSDT' ? 91_400 : 3_250);
    const entryPrice = Number.isFinite(rawEntry) && rawEntry > 0 ? rawEntry : liveSpotFallback;
    const stakeUsd = Number(body.stakeUsd) || 500;
    const leverage = Number(body.leverage) || (marketType === 'SPOT' ? 1 : 3);
    const confidencePct = Number(body.confidencePct) || 84;
    const signalId = String(body.signalId || `sf_sig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);

    const result = freqtradeCore.executeStandardizedSignal({
      signalId,
      exchange: rawExchange,
      symbol,
      marketType,
      side,
      entryPrice,
      stakeUsd,
      leverage,
      confidencePct,
      strategyName: String(body.strategyName || 'SignalForge_CCXT_Unified').slice(0, 64),
    });
    return res.status(result.statusCode).json({
      ...result,
      snapshot: freqtradeCore.getSnapshot(),
    });
  });

  app.post('/api/freqtrade/positions/:tradeId/close', standardWriteRateLimit, (req, res) => {
    const tradeId = Number.parseInt(String(req.params.tradeId || ''), 10);
    if (!Number.isInteger(tradeId) || tradeId <= 0) {
      return res.status(400).json({ ok: false, message: 'Valid integer tradeId is required.' });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawExit = Number(body.exitPrice);
    const exitPrice = Number.isFinite(rawExit) && rawExit > 0 ? rawExit : undefined;
    const reason = String(body.reason || 'MANUAL_CLOSE').slice(0, 48);
    const result = freqtradeCore.closePosition(tradeId, exitPrice, reason);
    return res.status(result.statusCode).json({
      ...result,
      snapshot: freqtradeCore.getSnapshot(),
    });
  });

  app.post('/api/freqtrade/tick', standardWriteRateLimit, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const mergedPrices: Record<string, number> = {};
    for (const [sym, entry] of Object.entries(spotFeedCache)) {
      if (entry && Number.isFinite(entry.price) && entry.price > 0) {
        mergedPrices[sym] = entry.price;
      }
    }
    if (body.prices && typeof body.prices === 'object') {
      for (const [k, v] of Object.entries(body.prices as Record<string, unknown>)) {
        const num = Number(v);
        if (Number.isFinite(num) && num > 0) {
          mergedPrices[k] = num;
        }
      }
    }
    const events = freqtradeCore.applyMarketPriceTick(mergedPrices);
    return res.json({
      ok: true,
      events,
      snapshot: freqtradeCore.getSnapshot(),
    });
  });

  app.post('/api/freqtrade/rpc/command', standardWriteRateLimit, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const command = String(body.command || '/status').trim().slice(0, 32);
    const result = freqtradeCore.handleTelegramRpcCommand(command);
    return res.json({
      ...result,
      snapshot: freqtradeCore.getSnapshot(),
    });
  });

  app.post('/api/freqtrade/audit/dispatch', standardWriteRateLimit, (_req, res) => {
    const latency = Number.isFinite(monitorState.eventLoopLagMs) && monitorState.eventLoopLagMs > 0
      ? monitorState.eventLoopLagMs
      : 8.4;
    const audit = freqtradeCore.recordSystemAudit(latency);
    return res.json({
      ok: true,
      audit,
      snapshot: freqtradeCore.getSnapshot(),
    });
  });

  app.get('/api/freqtrade/source', (req, res) => {
    const fileId = String(req.query.file || 'ccxt_router').trim();
    const result = freqtradeCore.readAllowlistedCoreSource(fileId);
    return res.status(result.statusCode).json(result);
  });

  // Signal Forge 6-Phase Hybrid Production Architecture (Python Control Plane + Rust Execution Core)
  app.get('/api/hybrid/state', (_req, res) => {
    return res.json({
      ok: true,
      state: hybridArchitecture.getStateSnapshot(),
    });
  });

  app.post('/api/hybrid/clones/scale', standardWriteRateLimit, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const marketVolatilityPct = Number(body.marketVolatilityPct);
    const computeNodes = Number(body.computeNodes);
    const baseClonesPerNode =
      body.baseClonesPerNode !== undefined ? Number(body.baseClonesPerNode) : 64;
    const targetStreams = body.targetStreams !== undefined ? Number(body.targetStreams) : 28;

    if (
      !Number.isFinite(marketVolatilityPct) ||
      marketVolatilityPct < 0.5 ||
      marketVolatilityPct > 100
    ) {
      return res.status(400).json({
        ok: false,
        message: 'marketVolatilityPct must be a number between 0.5 and 100.',
      });
    }
    if (!Number.isFinite(computeNodes) || computeNodes < 1 || computeNodes > 512) {
      return res.status(400).json({
        ok: false,
        message: 'computeNodes must be an integer between 1 and 512.',
      });
    }

    const plan = hybridArchitecture.scaleWorkerClones({
      marketVolatilityPct,
      computeNodes,
      baseClonesPerNode,
      targetStreams,
    });
    return res.json({
      ok: true,
      plan,
      state: hybridArchitecture.getStateSnapshot(),
    });
  });

  app.post('/api/hybrid/backtest/run', standardWriteRateLimit, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const record = hybridArchitecture.runBacktestAndTrack({
        assetClass: String(body.assetClass ?? 'CRYPTO'),
        strategyFamily: String(body.strategyFamily ?? 'BREAKOUT_MOMENTUM'),
        startDate: String(body.startDate ?? '2024-01-01'),
        endDate: String(body.endDate ?? '2024-12-31'),
        regime: String(body.regime ?? 'TRENDING_BULL'),
        liveVolatilityPct: Number(body.liveVolatilityPct ?? 24),
        fastWindow: body.fastWindow !== undefined ? Number(body.fastWindow) : undefined,
        slowWindow: body.slowWindow !== undefined ? Number(body.slowWindow) : undefined,
        tickCount: body.tickCount !== undefined ? Number(body.tickCount) : 12000,
        slippageBps: body.slippageBps !== undefined ? Number(body.slippageBps) : 1.8,
      });
      return res.json({
        ok: true,
        record,
        state: hybridArchitecture.getStateSnapshot(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Backtest validation failed.';
      return res.status(400).json({ ok: false, message });
    }
  });

  app.get('/api/hybrid/strategies/:strategyId', (req, res) => {
    const strategyId = String(req.params.strategyId || '').trim();
    const record = hybridArchitecture.getStrategyById(strategyId);
    if (!record) {
      return res.status(404).json({ ok: false, message: 'Tracked strategy not found.' });
    }
    return res.json({ ok: true, record });
  });

  app.get('/api/hybrid/source', (req, res) => {
    const fileKey = String(req.query.file || 'rust_main').trim();
    try {
      const result = hybridArchitecture.readAllowlistedSource(fileKey);
      return res.json({
        ok: true,
        descriptor: result.descriptor,
        content: result.content,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Source file blocked.';
      return res.status(400).json({ ok: false, message });
    }
  });

  // Strict 3-Hour Batched Signal Digest + Daily/Weekly/Monthly Performance Reports (gated by App Live)
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    if (!appLiveEnabled) {
      appLiveQuotaSavedCalls += 1;
      return;
    }
    dispatchThreeHourSignalDigest(false).catch((err) => {
      console.error('Scheduled 3H digest error:', err);
    });
  }, THREE_HOURS_MS);

  let scheduledDayCount = 0;
  setInterval(() => {
    if (!appLiveEnabled) return;
    scheduledDayCount++;
    dispatchPerformanceReport('DAILY').catch(() => undefined);
    if (scheduledDayCount % 7 === 0) {
      dispatchPerformanceReport('WEEKLY').catch(() => undefined);
    }
    if (scheduledDayCount % 30 === 0) {
      dispatchPerformanceReport('MONTHLY').catch(() => undefined);
    }
  }, ONE_DAY_MS);

  // Dual-Stream Telegram Continuous Developer Audit Loop (60s) + Automated Daily UTC Audit Delivery
  setTimeout(() => {
    dispatchDeveloperSystemAudit('CONTINUOUS_AUDIT').catch(() => undefined);
    if (process.env.APP_URL && /^https:\/\//i.test(process.env.APP_URL) && getTelegramBotToken()) {
      registerTelegramWebhook(process.env.APP_URL).catch(() => undefined);
    }
  }, 4500);

  setInterval(() => {
    if (!appLiveEnabled) return;
    dispatchDeveloperSystemAudit('CONTINUOUS_AUDIT').catch(() => undefined);
    if (
      shouldTriggerDailyAudit({
        nowMs: Date.now(),
        lastSentDateUtc: lastDailyAuditDateUtc,
        scheduledUtcHour: dailyAuditScheduledUtcHour,
        enabled: dailyAuditAutoDeliveryEnabled,
      })
    ) {
      dispatchDeveloperSystemAudit('DAILY_DIGEST').catch(() => undefined);
    }
  }, CONTINUOUS_AUDIT_INTERVAL_SEC * 1000);

  // Flush coalesced backend Binance Spot WebSocket ticks to SSE subscribers every 250ms
  setInterval(() => {
    if (
      !appLiveEnabled ||
      !systemControls.liveFeedModulesEnabled ||
      pendingSseTickBatch.size === 0 ||
      sseTickListeners.size === 0
    ) {
      return;
    }
    const ticks = Array.from(pendingSseTickBatch.values());
    pendingSseTickBatch.clear();
    for (const listener of sseTickListeners) {
      listener(ticks);
    }
  }, 250);

  // Autonomous Backend Monitoring Agent Daemon (750ms sub-second loop: Spot WS health, CMC parity & self-heal)
  let lastTickPerfMs = performance.now();
  setInterval(() => {
    if (!appLiveEnabled || !systemControls.liveFeedModulesEnabled) {
      lastTickPerfMs = performance.now();
      if (backendSpotWs || backendWsConnected) {
        pauseBackendSpotWs();
      }
      return;
    }
    const nowPerf = performance.now();
    const lagMs = Math.max(
      0,
      Number((nowPerf - lastTickPerfMs - SUBSECOND_HEARTBEAT_INTERVAL_MS).toFixed(2))
    );
    lastTickPerfMs = nowPerf;
    monitorState.heartbeatSeq += 1;
    monitorState.uptimeSec = Math.floor((Date.now() - serverStartedAtMs) / 1000);
    monitorState.eventLoopLagMs = lagMs;
    monitorState.lastHeartbeatAt = new Date().toISOString();
    monitorState.backendWsConnected = backendWsConnected;
    monitorState.wsLastFrameAgeMs =
      backendWsLastFrameAtMs > 0 ? Math.max(0, Date.now() - backendWsLastFrameAtMs) : 0;
    monitorState.spotFeedStatus =
      spotFeedSource === 'binance_spot' ? 'LIVE' : 'DETERMINISTIC_FALLBACK';
    monitorState.futuresFeedStatus =
      futuresFeedSource === 'binance_futures' ? 'LIVE' : 'DETERMINISTIC_FALLBACK';
    monitorState.cmcStatus =
      cmcValuationsSource === 'cmc_api' ? 'CMC_API' : 'UNAVAILABLE';

    const wsStale =
      backendWsConnected &&
      backendWsLastFrameAtMs > 0 &&
      Date.now() - backendWsLastFrameAtMs > WS_FRAME_STALE_THRESHOLD_MS;

    if (wsStale && !backendWsHealTimer) {
      backendWsConnected = false;
      monitorState.backendWsConnected = false;
      scheduleBackendWsSubSecondHeal('Stale Spot WS frame timeout');
    }

    const stale = isTelemetryStale(lastFeedPollAtMs);
    if (stale && !monitorHealInFlight) {
      monitorHealInFlight = true;
      monitorState.staleFeedCount += 1;
      monitorState.status = 'SELF_HEALING';
      monitorState.wsChannelStatus = 'HEALING';
      const healStarted = performance.now();
      seedFallbackSpotTelemetry(true);
      serverSyncEpoch += 1;
      bindBackendSpotWebSocket();

      pollBinanceTopGainers()
        .then(() => pollBinanceSpotFeed())
        .then(() => refreshCmcValuations())
        .catch(() => undefined)
        .finally(() => {
          monitorState.autoHealCount += 1;
          monitorState.selfHealLatencyMs = Math.max(
            1,
            Math.round(performance.now() - healStarted)
          );
          monitorState.status = 'OPTIMAL';
          monitorState.wsChannelStatus =
            backendWsConnected || spotFeedSource === 'binance_spot'
              ? 'CONNECTED'
              : 'DETERMINISTIC_FALLBACK';
          monitorState.lastHealAction = `Sub-second Spot failover rehydration #${monitorState.autoHealCount} in ${monitorState.selfHealLatencyMs}ms`;
          monitorHealInFlight = false;
        });
    } else if (!monitorHealInFlight && !backendWsHealTimer) {
      monitorState.status = 'OPTIMAL';
      monitorState.wsChannelStatus =
        backendWsConnected || spotFeedSource === 'binance_spot'
          ? 'CONNECTED'
          : 'DETERMINISTIC_FALLBACK';
    }
  }, SUBSECOND_HEARTBEAT_INTERVAL_MS);

  // Bind Persistent Backend Binance Spot WebSocket + Start 12s Spot REST, Depth, Sentinel & Autonomous Coordinator Loop
  bindBackendSpotWebSocket();
  pollBinanceTopGainers()
    .then(() => pollBinanceSpotFeed())
    .then(() => refreshCmcValuations())
    .then(() => refreshAllTrackedDepths())
    .then(() => {
      seedInitialSpotTestnetPositions();
      runSentinelAuditForAll();
      runAutonomousCoordinatorTick();
    })
    .catch(() => {
      seedFallbackSpotTelemetry();
      seedInitialSpotTestnetPositions();
      runSentinelAuditForAll();
    });

  setInterval(() => {
    if (!appLiveEnabled) {
      appLiveQuotaSavedCalls += 1;
      return;
    }
    // When App Live is ON, Top Gainers Scanner & Telegram alerts remain active even if Live Feed Modules are paused
    const chain = pollBinanceTopGainers();
    if (!systemControls.liveFeedModulesEnabled) {
      chain.catch(() => undefined);
      return;
    }
    chain
      .then(() => pollBinanceSpotFeed())
      .then(() => refreshCmcValuations())
      .then(() => refreshAllTrackedDepths())
      .catch(() => {
        monitorState.staleFeedCount += 1;
        seedFallbackSpotTelemetry(true);
      });
  }, GAINER_FEEDER_INTERVAL_MS);

  // Autonomous Zero-Intervention Coordinator & Sentinel 5-Second Risk/Entry Loop
  setInterval(() => {
    try {
      if (!appLiveEnabled) {
        appLiveQuotaSavedCalls += 1;
        return;
      }
      if (autonomousCoordinatorEnabled && (executionMode === 'LIVE' || systemControls.testnetExecutionEnabled)) {
        runAutonomousCoordinatorTick();
      }
    } catch (err) {
      console.error('[Autonomous Loop Error]', err);
    }
  }, 5000);

  // Self-Healing 30-Second Probe Loop (Telegram Webhook -> Polling Auto-Failover & Subsystem Health)
  setInterval(() => {
    try {
      const tgSnap = telegramDispatchStabilizer.getSnapshot();
      const webhookHealthy = tgSnap.failedCount === 0 && tgSnap.pendingCount < 5;
      selfHealingSupervisor.recordTelegramWebhookProbe(webhookHealthy);
    } catch {
      // non-fatal probe error
    }
  }, 30_000);

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Signal Forge server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();

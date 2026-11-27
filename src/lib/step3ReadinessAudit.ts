/**
 * Signal Forge — Step 3 Final Integration, External Verification,
 * Security Hardening, Social Delivery Idempotency & Status Clarity Engine.
 *
 * Pure, side-effect-free TypeScript module (imported by both server.ts and client UI)
 * with zero external SDK coupling so every rule is exhaustively unit-testable.
 */

export type EnvVarCategory =
  | 'REQUIRED_CURRENT'
  | 'OPTIONAL_INTEGRATION'
  | 'DEV_ONLY'
  | 'OBSOLETE';

export interface EnvVarClassification {
  readonly name: string;
  readonly category: EnvVarCategory;
  readonly configured: boolean;
  readonly requiredForStartup: boolean;
  readonly purpose: string;
  readonly clientExposedRisk: boolean;
}

export interface EnvironmentAuditReport {
  readonly auditedAtIso: string;
  readonly startupHealthy: boolean;
  readonly missingRequired: string[];
  readonly clientSecretLeakWarnings: string[];
  readonly obsoleteVariablesPresent: string[];
  readonly optionalIntegrationsDisabled: string[];
  readonly optionalIntegrationsConfigured: string[];
  readonly classifications: EnvVarClassification[];
}

interface EnvCatalogEntry {
  readonly name: string;
  readonly category: EnvVarCategory;
  readonly purpose: string;
}

const SIGNAL_FORGE_ENV_CATALOG: readonly EnvCatalogEntry[] = [
  // Required or core runtime configuration (safe defaults exist for local startup)
  {
    name: 'PORT',
    category: 'DEV_ONLY',
    purpose: 'HTTP listener port (defaults to 3000 in runtime container).',
  },
  {
    name: 'NODE_ENV',
    category: 'DEV_ONLY',
    purpose: 'Runtime environment mode (development vs production).',
  },
  {
    name: 'APP_URL',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Canonical public base URL for links and webhook registration.',
  },
  {
    name: 'GEMINI_API_KEY',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Server-side Gemini API key for AI narration and analysis (graceful fallback when unset).',
  },
  {
    name: 'COINGECKO_API_KEY',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Server-side CoinGecko API key for reference market data and fallback metadata (never exposed to browser).',
  },
  {
    name: 'COINGECKO_API_TIER',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'CoinGecko API access tier (demo -> api.coingecko.com | pro -> pro-api.coingecko.com).',
  },
  {
    name: 'RESEND_API_KEY',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Resend transactional email API key for Email OTP and alert digests.',
  },
  {
    name: 'RESEND_FROM_EMAIL',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Verified sender domain address for Resend OTP emails.',
  },
  {
    name: 'OWNER_ALERT_EMAIL',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Owner email recipient for private OTP and system alerts (never hardcoded in public bundle).',
  },
  {
    name: 'ADMIN_EMAIL_ALLOWLIST',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Comma-separated verified Owner email addresses granted server-side SUPER_ADMIN RBAC.',
  },
  {
    name: 'OPERATOR_API_TOKEN',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Optional server-side bearer token for automated operator clearance.',
  },
  {
    name: 'PUBLIC_WHATSAPP_URL',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Optional intentionally public WhatsApp support desk URL.',
  },
  {
    name: 'VITE_PUBLIC_SUPPORT_EMAIL',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Optional intentionally public support email embedded in client bundle.',
  },
  {
    name: 'TELEGRAM_BOT_TOKEN',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Canonical Telegram Bot API token for public channel posts and private admin alerts.',
  },
  {
    name: 'TELEGRAM_CHAT_ID',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Canonical public Telegram channel numeric ID (-100...) for signal delivery.',
  },
  {
    name: 'TELEGRAM_DEV_CHAT_ID',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Private numeric Telegram user ID for Stream 2 developer audits.',
  },
  {
    name: 'TELEGRAM_CHANNEL_ID',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Optional public Telegram channel @handle reference.',
  },
  {
    name: 'TELEGRAM_WEBHOOK_SECRET',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Independent [A-Za-z0-9_-] secret header token required by /api/telegram/webhook (fail-closed when unset).',
  },
  {
    name: 'MAKE_WEBHOOK_URL',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Optional active Make.com Custom Webhook HTTPS URL.',
  },
  {
    name: 'DISCORD_WEBHOOK_URL',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Discord webhook URL for structured signal/closure embeds (?wait=true).',
  },
  {
    name: 'DISCORD_BOT_TOKEN',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Discord bot token for optional Discord channel delivery.',
  },
  {
    name: 'DISCORD_CHANNEL_ID',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Discord channel ID paired with DISCORD_BOT_TOKEN.',
  },
  {
    name: 'OKX_API_KEY',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'OKX Demo Trading API key (strictly demo/simulated mode; real-money live locked).',
  },
  {
    name: 'OKX_API_SECRET',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'OKX Demo Trading API secret (server-side only).',
  },
  {
    name: 'OKX_PASSPHRASE',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'OKX Demo Trading API passphrase (server-side only).',
  },
  {
    name: 'OKX_DEMO_MODE',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Enforces OKX simulated trading header x-simulated-trading=1.',
  },
  {
    name: 'BINANCE_TESTNET_API_KEY',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Binance Spot Testnet API key for sandbox exchange verification.',
  },
  {
    name: 'BINANCE_TESTNET_SECRET',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Binance Spot Testnet API secret (server-side only).',
  },
  {
    name: 'BINANCE_LIVE_API_KEY',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Reserved for future authorized live trading (currently strictly locked).',
  },
  {
    name: 'BINANCE_LIVE_SECRET',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Reserved for future authorized live trading (currently strictly locked).',
  },
  {
    name: 'BYBIT_API_KEY',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Optional Bybit sandbox/exchange key (disabled safely when unset).',
  },
  {
    name: 'KRAKEN_API_KEY',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Optional Kraken sandbox/exchange key (disabled safely when unset).',
  },
  {
    name: 'CMC_API_KEY',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Server-side CoinMarketCap key for macro market intelligence.',
  },
  {
    name: 'CRYPTOPANIC_API_KEY',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Optional CryptoPanic news API token.',
  },
  {
    name: 'LUNARCRUSH_API_KEY',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Optional LunarCrush social sentiment API key.',
  },
  {
    name: 'CLOUDFLARE_TURNSTILE_SECRET_KEY',
    category: 'OPTIONAL_INTEGRATION',
    purpose: 'Optional Cloudflare Turnstile server-side verification secret.',
  },
  {
    name: 'DISABLE_HMR',
    category: 'DEV_ONLY',
    purpose: 'Disables Vite HMR inside hosted preview containers.',
  },
  // Obsolete or discouraged legacy variable names
  {
    name: 'VITE_CMC_API_KEY',
    category: 'OBSOLETE',
    purpose: 'Deprecated client-exposed key name; use server-side CMC_API_KEY instead.',
  },
  {
    name: 'BOT_TOKEN',
    category: 'OBSOLETE',
    purpose: 'Legacy alias superseded by TELEGRAM_BOT_TOKEN.',
  },
  {
    name: 'CHAT_ID',
    category: 'OBSOLETE',
    purpose: 'Legacy alias superseded by TELEGRAM_CHAT_ID.',
  },
  {
    name: 'DEVELOPER_CHAT_ID',
    category: 'OBSOLETE',
    purpose: 'Legacy alias superseded by TELEGRAM_DEV_CHAT_ID.',
  },
  {
    name: 'WEBHOOK_BOT_TOKEN',
    category: 'OBSOLETE',
    purpose: 'Removed legacy Make.com token; outbound webhooks are secret-free.',
  },
  {
    name: 'RECIPIENT_EMAIL',
    category: 'OBSOLETE',
    purpose: 'Legacy alias superseded by OWNER_ALERT_EMAIL.',
  },
];

const ALLOWED_PUBLIC_VITE_KEYS = new Set<string>([
  'VITE_CLOUDFLARE_TURNSTILE_SITE_KEY',
  'VITE_APP_URL',
  'VITE_PUBLIC_APP_NAME',
  'VITE_PUBLIC_SUPPORT_EMAIL',
  'VITE_PUBLIC_WHATSAPP_URL',
]);

function isNonPlaceholderValue(value: string | undefined): boolean {
  const trimmed = (value || '').trim();
  if (!trimmed) return false;
  const upper = trimmed.toUpperCase();
  if (
    upper === 'MY_GEMINI_API_KEY' ||
    upper === 'MY_APP_URL' ||
    upper === 'YOUR_API_KEY_HERE' ||
    upper === 'REPLACE_ME' ||
    upper.startsWith('EXAMPLE_')
  ) {
    return false;
  }
  return true;
}

function isSensitiveViteEnvName(name: string): boolean {
  if (!name.startsWith('VITE_')) return false;
  if (ALLOWED_PUBLIC_VITE_KEYS.has(name)) return false;
  return /(KEY|SECRET|TOKEN|PASS|PRIVATE|CREDENTIAL)/i.test(name);
}

/**
 * Audits process environment without ever reading/returning actual secret values.
 */
export function auditEnvironmentConfiguration(
  env: Record<string, string | undefined>,
  nowMs = Date.now()
): EnvironmentAuditReport {
  const classifications: EnvVarClassification[] = SIGNAL_FORGE_ENV_CATALOG.map((entry) => {
    const configured = isNonPlaceholderValue(env[entry.name]);
    return {
      name: entry.name,
      category: entry.category,
      configured,
      requiredForStartup: entry.category === 'REQUIRED_CURRENT',
      purpose: entry.purpose,
      clientExposedRisk: configured && isSensitiveViteEnvName(entry.name),
    };
  });

  const clientSecretLeakWarnings: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (isSensitiveViteEnvName(k) && isNonPlaceholderValue(v)) {
      clientSecretLeakWarnings.push(
        `Environment variable "${k}" uses a client-exposed VITE_ prefix for a sensitive credential. Move it to a server-side variable.`
      );
    }
  }

  const missingRequired = classifications
    .filter((c) => c.requiredForStartup && !c.configured)
    .map((c) => c.name);

  const obsoleteVariablesPresent = classifications
    .filter((c) => c.category === 'OBSOLETE' && c.configured)
    .map((c) => c.name);

  const optionalIntegrationsConfigured = classifications
    .filter((c) => c.category === 'OPTIONAL_INTEGRATION' && c.configured)
    .map((c) => c.name);

  const optionalIntegrationsDisabled = classifications
    .filter((c) => c.category === 'OPTIONAL_INTEGRATION' && !c.configured)
    .map((c) => c.name);

  return {
    auditedAtIso: new Date(nowMs).toISOString(),
    startupHealthy: missingRequired.length === 0 && clientSecretLeakWarnings.length === 0,
    missingRequired,
    clientSecretLeakWarnings,
    obsoleteVariablesPresent,
    optionalIntegrationsDisabled,
    optionalIntegrationsConfigured,
    classifications,
  };
}

// ---------------------------------------------------------------------------
// 2. External Exchange Demo Verification State Machine (Zero Fabricated Acks)
// ---------------------------------------------------------------------------

export type ExchangeDemoVenue = 'OKX_DEMO' | 'BINANCE_TESTNET';

export type ExchangeDemoVerificationStatus =
  | 'EXCHANGE_DEMO_VERIFIED'
  | 'EXCHANGE_DEMO_UNVERIFIED';

export type ExchangeDemoBlockerCode =
  | 'NONE'
  | 'MISSING_CREDENTIALS'
  | 'LIVE_ENDPOINT_REFUSED'
  | 'EXCHANGE_AUTH_REJECTED'
  | 'NETWORK_UNREACHABLE'
  | 'EXCHANGE_TIMEOUT';

export interface ExchangeDemoProbeResult {
  readonly venue: ExchangeDemoVenue;
  readonly status: ExchangeDemoVerificationStatus;
  readonly blockerCode: ExchangeDemoBlockerCode;
  readonly endpointChecked: string;
  readonly credentialsPresent: boolean;
  readonly externalAuthConfirmed: boolean;
  readonly realMoneyLocked: true;
  readonly httpStatus: number | null;
  readonly latencyMs: number | null;
  readonly summary: string;
  readonly checkedAtIso: string;
}

export function evaluateExchangeDemoProbeOutcome(params: {
  venue: ExchangeDemoVenue;
  endpointChecked: string;
  credentialsPresent: boolean;
  isDemoEndpoint: boolean;
  httpStatus: number | null;
  externalAuthConfirmed: boolean;
  latencyMs: number | null;
  errorDetail?: string | null;
  nowMs?: number;
}): ExchangeDemoProbeResult {
  const checkedAtIso = new Date(params.nowMs ?? Date.now()).toISOString();

  if (!params.isDemoEndpoint) {
    return {
      venue: params.venue,
      status: 'EXCHANGE_DEMO_UNVERIFIED',
      blockerCode: 'LIVE_ENDPOINT_REFUSED',
      endpointChecked: params.endpointChecked,
      credentialsPresent: params.credentialsPresent,
      externalAuthConfirmed: false,
      realMoneyLocked: true,
      httpStatus: null,
      latencyMs: null,
      summary: `${params.venue} verification refused: real-money live exchange endpoints are strictly locked.`,
      checkedAtIso,
    };
  }

  if (!params.credentialsPresent) {
    const missingHint =
      params.venue === 'OKX_DEMO'
        ? 'OKX_API_KEY, OKX_API_SECRET, and OKX_PASSPHRASE are not configured on this server.'
        : 'BINANCE_TESTNET_API_KEY and BINANCE_TESTNET_SECRET are not configured on this server.';
    return {
      venue: params.venue,
      status: 'EXCHANGE_DEMO_UNVERIFIED',
      blockerCode: 'MISSING_CREDENTIALS',
      endpointChecked: params.endpointChecked,
      credentialsPresent: false,
      externalAuthConfirmed: false,
      realMoneyLocked: true,
      httpStatus: null,
      latencyMs: null,
      summary: `EXCHANGE_DEMO_UNVERIFIED (${params.venue}): ${missingHint}`,
      checkedAtIso,
    };
  }

  if (params.externalAuthConfirmed && params.httpStatus !== null && params.httpStatus >= 200 && params.httpStatus < 300) {
    return {
      venue: params.venue,
      status: 'EXCHANGE_DEMO_VERIFIED',
      blockerCode: 'NONE',
      endpointChecked: params.endpointChecked,
      credentialsPresent: true,
      externalAuthConfirmed: true,
      realMoneyLocked: true,
      httpStatus: params.httpStatus,
      latencyMs: params.latencyMs,
      summary: `${params.venue} demo authentication verified via real external API handshake (HTTP ${params.httpStatus}, ${params.latencyMs ?? 0}ms). Real-money live trading remains locked.`,
      checkedAtIso,
    };
  }

  const errText = (params.errorDetail || '').trim();
  const isTimeout = /timeout|abort/i.test(errText);
  const blockerCode: ExchangeDemoBlockerCode =
    params.httpStatus === 401 || params.httpStatus === 403 || params.httpStatus === 400
      ? 'EXCHANGE_AUTH_REJECTED'
      : isTimeout
      ? 'EXCHANGE_TIMEOUT'
      : 'NETWORK_UNREACHABLE';

  return {
    venue: params.venue,
    status: 'EXCHANGE_DEMO_UNVERIFIED',
    blockerCode,
    endpointChecked: params.endpointChecked,
    credentialsPresent: true,
    externalAuthConfirmed: false,
    realMoneyLocked: true,
    httpStatus: params.httpStatus,
    latencyMs: params.latencyMs,
    summary: `EXCHANGE_DEMO_UNVERIFIED (${params.venue}): ${
      errText || `External exchange returned HTTP ${params.httpStatus ?? 'unreachable'}`
    }.`,
    checkedAtIso,
  };
}

// ---------------------------------------------------------------------------
// 3. Salted Hashed Email OTP Helpers & Zero-Plaintext Audit Trail
// ---------------------------------------------------------------------------

export interface OtpAuditLogEntry {
  readonly id: string;
  readonly challengeId: string;
  readonly event:
    | 'ISSUED_DELIVERED'
    | 'ISSUED_DELIVERY_FAILED'
    | 'VERIFY_SUCCESS'
    | 'VERIFY_FAILED'
    | 'CHALLENGE_LOCKED_MAX_ATTEMPTS'
    | 'CHALLENGE_EXPIRED';
  readonly recipientMasked: string;
  readonly deliveryStatus?: string;
  readonly attemptsUsed: number;
  readonly timestampIso: string;
}

/**
 * Pure deterministic hex digest helper that works identically in Node/browser tests
 * without leaking plaintext OTP codes. When `hmacHexFn` (e.g. Node crypto HMAC-SHA256)
 * is provided by server.ts, it uses cryptographic HMAC-SHA256.
 */
export function computeSaltedOtpHash(params: {
  challengeId: string;
  otpCode: string;
  pepper: string;
  hmacHexFn: (key: string, payload: string) => string;
}): string {
  const cleanId = params.challengeId.trim();
  const cleanCode = params.otpCode.trim();
  return params.hmacHexFn(params.pepper, `${cleanId}:${cleanCode}`);
}

export function verifySaltedOtpHash(params: {
  challengeId: string;
  candidateOtp: string;
  expectedHash: string;
  pepper: string;
  hmacHexFn: (key: string, payload: string) => string;
  constantTimeEqualFn: (a: string, b: string) => boolean;
}): boolean {
  if (!/^\d{6}$/.test(params.candidateOtp.trim())) {
    return false;
  }
  const candidateHash = computeSaltedOtpHash({
    challengeId: params.challengeId,
    otpCode: params.candidateOtp,
    pepper: params.pepper,
    hmacHexFn: params.hmacHexFn,
  });
  return params.constantTimeEqualFn(candidateHash, params.expectedHash);
}

/**
 * Failed provider delivery (e.g., Resend unconfigured or transient rejection) must
 * NOT lock the operator out with a 30-second resend cooldown; recovery retry must remain available.
 */
export function shouldApplyOtpResendCooldown(emailDelivered: boolean): boolean {
  return emailDelivered === true;
}

export function createSanitizedOtpAuditEntry(params: {
  challengeId: string;
  event: OtpAuditLogEntry['event'];
  recipientMasked: string;
  deliveryStatus?: string;
  attemptsUsed: number;
  nowMs?: number;
}): OtpAuditLogEntry {
  const ts = params.nowMs ?? Date.now();
  return {
    id: `otpaudit_${ts}_${Math.random().toString(36).slice(2, 7)}`,
    challengeId: params.challengeId,
    event: params.event,
    recipientMasked: params.recipientMasked,
    deliveryStatus: params.deliveryStatus,
    attemptsUsed: params.attemptsUsed,
    timestampIso: new Date(ts).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 4. Telegram & Discord Channel Separation, Idempotency & Bounded Retry Queue
// ---------------------------------------------------------------------------

export type SocialChannelTarget =
  | 'PERSONAL_ADMIN_TELEGRAM'
  | 'PUBLIC_TELEGRAM_CHANNEL'
  | 'DISCORD_WEBHOOK';

export type SocialPostStage = 'SIGNAL_ANNOUNCEMENT' | 'TRADE_CLOSURE';

export type SocialDeliveryState =
  | 'QUEUED'
  | 'DELIVERED_PROVIDER_CONFIRMED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_PERMANENT'
  | 'UNCONFIGURED_NOT_SENT';

export interface SocialDeliveryRecord {
  readonly idempotencyKey: string;
  readonly tradeId: string;
  readonly stage: SocialPostStage;
  readonly channel: SocialChannelTarget;
  readonly state: SocialDeliveryState;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly chartSnapshotGenerated: boolean;
  readonly messageDelivered: boolean;
  readonly providerMessageId: string | null;
  readonly lastError: string | null;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
}

export interface SocialQueueDispatchResult {
  readonly accepted: boolean;
  readonly duplicateBlocked: boolean;
  readonly record: SocialDeliveryRecord;
  readonly reason: string;
}

export class SocialPublishingQueueEngine {
  private readonly records = new Map<string, SocialDeliveryRecord>();
  private readonly maxAttempts: number;

  constructor(maxAttempts = 3) {
    this.maxAttempts = Math.max(1, Math.min(5, maxAttempts));
  }

  static buildIdempotencyKey(
    tradeId: string,
    stage: SocialPostStage,
    channel: SocialChannelTarget
  ): string {
    return `${tradeId.trim().toUpperCase()}::${stage}::${channel}`;
  }

  enqueueOrInspect(params: {
    tradeId: string;
    stage: SocialPostStage;
    channel: SocialChannelTarget;
    chartSnapshotGenerated: boolean;
    channelConfigured: boolean;
    nowMs?: number;
  }): SocialQueueDispatchResult {
    const cleanTradeId = params.tradeId.trim().toUpperCase();
    const nowIso = new Date(params.nowMs ?? Date.now()).toISOString();
    const key = SocialPublishingQueueEngine.buildIdempotencyKey(
      cleanTradeId,
      params.stage,
      params.channel
    );

    const existing = this.records.get(key);
    if (existing) {
      if (existing.state === 'DELIVERED_PROVIDER_CONFIRMED') {
        return {
          accepted: false,
          duplicateBlocked: true,
          record: existing,
          reason: `Duplicate ${params.stage} post blocked for immutable Trade ID ${cleanTradeId} on ${params.channel}.`,
        };
      }
      if (existing.state === 'FAILED_PERMANENT' || existing.attempts >= existing.maxAttempts) {
        return {
          accepted: false,
          duplicateBlocked: false,
          record: existing,
          reason: `Retry limit (${existing.maxAttempts}) exhausted for ${cleanTradeId} on ${params.channel}; inspect failed delivery queue.`,
        };
      }
      const nextState: SocialDeliveryState = params.channelConfigured
        ? 'QUEUED'
        : 'UNCONFIGURED_NOT_SENT';
      const updated: SocialDeliveryRecord = {
        ...existing,
        state: nextState,
        chartSnapshotGenerated: existing.chartSnapshotGenerated || params.chartSnapshotGenerated,
        updatedAtIso: nowIso,
      };
      this.records.set(key, updated);
      return {
        accepted: params.channelConfigured,
        duplicateBlocked: false,
        record: updated,
        reason: params.channelConfigured
          ? `Re-queued retry attempt for ${cleanTradeId} on ${params.channel}.`
          : `Channel ${params.channel} is unconfigured; chart snapshot generation does NOT count as message delivery.`,
      };
    }

    const initialState: SocialDeliveryState = params.channelConfigured
      ? 'QUEUED'
      : 'UNCONFIGURED_NOT_SENT';

    const record: SocialDeliveryRecord = {
      idempotencyKey: key,
      tradeId: cleanTradeId,
      stage: params.stage,
      channel: params.channel,
      state: initialState,
      attempts: 0,
      maxAttempts: this.maxAttempts,
      chartSnapshotGenerated: params.chartSnapshotGenerated,
      // Strict honesty: generating a chart PNG NEVER implies a social message was delivered
      messageDelivered: false,
      providerMessageId: null,
      lastError: params.channelConfigured
        ? null
        : `${params.channel} credentials or target destination are not configured.`,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    };

    this.records.set(key, record);
    return {
      accepted: params.channelConfigured,
      duplicateBlocked: false,
      record,
      reason: params.channelConfigured
        ? `Queued ${params.stage} for ${cleanTradeId} on ${params.channel}.`
        : `${params.channel} is unconfigured; message NOT sent (chartSnapshotGenerated=${params.chartSnapshotGenerated}).`,
    };
  }

  recordDeliveryOutcome(params: {
    idempotencyKey: string;
    delivered: boolean;
    providerMessageId?: string | null;
    errorMessage?: string | null;
    nowMs?: number;
  }): SocialDeliveryRecord | null {
    const existing = this.records.get(params.idempotencyKey);
    if (!existing) return null;

    const nowIso = new Date(params.nowMs ?? Date.now()).toISOString();
    const nextAttempts = existing.attempts + 1;

    if (params.delivered && params.providerMessageId) {
      const confirmed: SocialDeliveryRecord = {
        ...existing,
        state: 'DELIVERED_PROVIDER_CONFIRMED',
        attempts: nextAttempts,
        messageDelivered: true,
        providerMessageId: params.providerMessageId,
        lastError: null,
        updatedAtIso: nowIso,
      };
      this.records.set(params.idempotencyKey, confirmed);
      return confirmed;
    }

    const permanent = nextAttempts >= existing.maxAttempts;
    const failed: SocialDeliveryRecord = {
      ...existing,
      state: permanent ? 'FAILED_PERMANENT' : 'FAILED_RETRYABLE',
      attempts: nextAttempts,
      messageDelivered: false,
      providerMessageId: null,
      lastError: params.errorMessage || 'Provider did not return a confirmed message ID.',
      updatedAtIso: nowIso,
    };
    this.records.set(params.idempotencyKey, failed);
    return failed;
  }

  listAll(): SocialDeliveryRecord[] {
    return Array.from(this.records.values());
  }

  listFailed(): SocialDeliveryRecord[] {
    return this.listAll().filter(
      (r) =>
        r.state === 'FAILED_RETRYABLE' ||
        r.state === 'FAILED_PERMANENT' ||
        r.state === 'UNCONFIGURED_NOT_SENT'
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Unambiguous Platform Operational Status Clarity (Step 3 §7)
// ---------------------------------------------------------------------------

export interface PlatformStatusBadge {
  readonly code:
    | 'APPLICATION_STATUS'
    | 'MARKET_DATA_STATUS'
    | 'TRADING_ENVIRONMENT'
    | 'LIVE_LOCK_STATUS'
    | 'MAINTENANCE_STATUS';
  readonly label: string;
  readonly tone: 'emerald' | 'blue' | 'amber' | 'rose' | 'slate';
}

export interface PlatformOperationalStatusSnapshot {
  readonly applicationLabel: 'APPLICATION ONLINE' | 'APPLICATION PAUSED';
  readonly marketDataLabel: 'MARKET DATA CONNECTED' | 'MARKET DATA DEGRADED';
  readonly activeTradingLabel: 'PAPER TRADING ACTIVE' | 'EXCHANGE DEMO CONNECTED';
  readonly liveTradingLabel: 'LIVE TRADING LOCKED';
  readonly maintenanceLabel: 'MAINTENANCE ACTIVE' | null;
  readonly badges: PlatformStatusBadge[];
}

export function resolvePlatformOperationalStatuses(params: {
  appOnline: boolean;
  marketDataConnected: boolean;
  exchangeDemoVerifiedConnected: boolean;
  maintenanceActive: boolean;
}): PlatformOperationalStatusSnapshot {
  const applicationLabel = params.appOnline ? 'APPLICATION ONLINE' : 'APPLICATION PAUSED';
  const marketDataLabel = params.marketDataConnected
    ? 'MARKET DATA CONNECTED'
    : 'MARKET DATA DEGRADED';
  const activeTradingLabel = params.exchangeDemoVerifiedConnected
    ? 'EXCHANGE DEMO CONNECTED'
    : 'PAPER TRADING ACTIVE';
  const liveTradingLabel: 'LIVE TRADING LOCKED' = 'LIVE TRADING LOCKED';
  const maintenanceLabel = params.maintenanceActive ? 'MAINTENANCE ACTIVE' : null;

  const badges: PlatformStatusBadge[] = [
    {
      code: 'APPLICATION_STATUS',
      label: applicationLabel,
      tone: params.appOnline ? 'emerald' : 'rose',
    },
    {
      code: 'MARKET_DATA_STATUS',
      label: marketDataLabel,
      tone: params.marketDataConnected ? 'emerald' : 'amber',
    },
    {
      code: 'TRADING_ENVIRONMENT',
      label: activeTradingLabel,
      tone: 'blue',
    },
    {
      code: 'LIVE_LOCK_STATUS',
      label: liveTradingLabel,
      tone: 'rose',
    },
  ];

  if (maintenanceLabel) {
    badges.push({
      code: 'MAINTENANCE_STATUS',
      label: maintenanceLabel,
      tone: 'amber',
    });
  }

  return {
    applicationLabel,
    marketDataLabel,
    activeTradingLabel,
    liveTradingLabel,
    maintenanceLabel,
    badges,
  };
}

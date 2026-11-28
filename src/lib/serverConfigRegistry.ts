/**
 * Signal Forge — Permanent Secrets & Backend Environment Configuration Registry.
 *
 * Security & Honesty Guarantees:
 * - Evaluates server-side and intentionally public configuration presence, format,
 *   provenance (Platform Runtime Env vs local .env fallback), and cross-restart
 *   persistence WITHOUT ever storing, hashing, logging, or returning secret values,
 *   token prefixes, lengths, or recoverable fragments.
 * - Recognizes TELEGRAM_CHAT_ID as the canonical channel destination and reports
 *   PENDING_OWNER_CONFIGURATION until a valid numeric -100... channel ID is provided.
 * - Detects RESTART_NOT_PERSISTED whenever a variable that was configured on a
 *   previous server boot disappears on a subsequent restart.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  isValidTelegramBotToken,
  isValidTelegramPrivateUserId,
  isValidTelegramPublicChatId,
  resolveDiscordWebhookConfig,
  resolveMakeWebhookConfig,
  resolveTelegramConfig,
} from './notificationDeliveryConfig';
import { resolveCoinGeckoEnvConfig, type CoinGeckoSanitizedStatus } from './coinGeckoClient';
import type { PublicAiProvidersStatus } from './aiProviderVaultServer';
import type { NotificationHealthOverview } from './notificationLedgerServer';

export type ConfigHealthStatus =
  | 'CONFIGURED'
  | 'MISSING'
  | 'INVALID_FORMAT'
  | 'PENDING_VERIFICATION'
  | 'VERIFIED'
  | 'PENDING_OWNER_CONFIGURATION'
  | 'RESTART_NOT_PERSISTED';

export type ConfigEnvSource =
  | 'PLATFORM_RUNTIME_ENV'
  | 'LOCAL_DOTENV_FALLBACK'
  | 'BACKEND_ENCRYPTED_VAULT'
  | 'UNSET';

export type ConfigPersistenceStatus =
  | 'VERIFIED_PERSISTENT'
  | 'FIRST_BOOT_BASELINE'
  | 'NOT_PERSISTED_AFTER_RESTART'
  | 'UNCONFIGURED';

export type ConfigScope = 'SERVER_ONLY' | 'INTENTIONALLY_PUBLIC';

export type ConfigRequirementLevel = 'CORE_SECURITY' | 'REQUIRED_FOR_FEATURE' | 'OPTIONAL';

export interface ConfigRegistryItem {
  readonly name: string;
  readonly group:
    | 'AI_PROVIDERS'
    | 'MARKET_DATA'
    | 'AUTH_AND_SECURITY'
    | 'NOTIFICATIONS'
    | 'EXCHANGES'
    | 'PUBLIC_APP';
  readonly requirement: ConfigRequirementLevel;
  readonly scope: ConfigScope;
  readonly status: ConfigHealthStatus;
  readonly present: boolean;
  readonly validFormat: boolean | null;
  readonly source: ConfigEnvSource;
  readonly persistence: ConfigPersistenceStatus;
  readonly consumedAt: readonly string[];
  readonly ownerActionRequired: boolean;
  readonly guidance: string;
}

export interface ObsoleteEnvWarning {
  readonly name: string;
  readonly replacement: string;
  readonly source: ConfigEnvSource;
  readonly message: string;
}

export interface BootEnvPresenceSnapshot {
  readonly schemaVersion: 1;
  readonly bootCount: number;
  readonly recordedAtIso: string;
  readonly runtimeRevision: string;
  readonly presenceByVar: Record<
    string,
    {
      readonly present: boolean;
      readonly source: ConfigEnvSource;
    }
  >;
}

export interface RuntimeEnvironmentProvenance {
  readonly nodeEnv: string;
  readonly cloudRunService: boolean;
  readonly runtimeRevisionPresent: boolean;
  readonly localDotenvFilePresent: boolean;
  readonly localDotenvLoadedKeysCount: number;
  readonly platformRuntimeKeysTrackedCount: number;
  readonly bootCount: number;
  readonly previousBootRecordedAtIso: string | null;
  readonly currentBootRecordedAtIso: string;
}

export interface OwnerConfigHealthReport {
  readonly generatedAtIso: string;
  readonly runtime: RuntimeEnvironmentProvenance;
  readonly summary: {
    readonly totalTracked: number;
    readonly verified: number;
    readonly configured: number;
    readonly pendingVerification: number;
    readonly pendingOwnerConfiguration: number;
    readonly invalidFormat: number;
    readonly missing: number;
    readonly restartNotPersisted: number;
    readonly obsoleteConflicts: number;
  };
  readonly telegramReadiness: {
    readonly canonicalChannelEnvVar: 'TELEGRAM_CHAT_ID';
    readonly canonicalChannelStatus: 'CONFIGURED' | 'PENDING_OWNER_CONFIGURATION';
    readonly botTokenStatus: ConfigHealthStatus;
    readonly botUsername: string | null;
    readonly usingLegacyChatFallback: boolean;
    readonly guidance: string;
  };
  readonly geminiReadiness: {
    readonly envVar: 'GEMINI_API_KEY';
    readonly status: ConfigHealthStatus;
    readonly source: ConfigEnvSource;
    readonly persistence: ConfigPersistenceStatus;
    readonly configuredModel: string;
    readonly guidance: string;
  };
  readonly coingeckoReadiness: {
    readonly envVar: 'COINGECKO_API_KEY';
    readonly tierEnvVar: 'COINGECKO_API_TIER';
    readonly status: ConfigHealthStatus;
    readonly tier: 'demo' | 'pro';
    readonly endpointHost: string;
    readonly persistence: ConfigPersistenceStatus;
    readonly guidance: string;
  };
  readonly items: readonly ConfigRegistryItem[];
  readonly obsoleteWarnings: readonly ObsoleteEnvWarning[];
  readonly platformGuidance: readonly string[];
}

interface CatalogSpec {
  readonly name: string;
  readonly group: ConfigRegistryItem['group'];
  readonly requirement: ConfigRequirementLevel;
  readonly scope: ConfigScope;
  readonly consumedAt: readonly string[];
  readonly defaultGuidance: string;
}

const PLACEHOLDER_TOKENS = new Set([
  'MY_GEMINI_API_KEY',
  'MY_APP_URL',
  'YOUR_API_KEY',
  'YOUR_API_KEY_HERE',
  'REPLACE_ME',
  'REPLACE-ME',
  'PLACEHOLDER',
  'TEST',
  'NONE',
  'NULL',
]);

export const SIGNAL_FORGE_CONFIG_CATALOG: readonly CatalogSpec[] = [
  // AI Providers
  {
    name: 'GEMINI_API_KEY',
    group: 'AI_PROVIDERS',
    requirement: 'REQUIRED_FOR_FEATURE',
    scope: 'SERVER_ONLY',
    consumedAt: ['src/lib/aiProviderVaultServer.ts', 'server.ts', 'src/services/geminiDebateService.ts'],
    defaultGuidance: 'Store in AI Studio Settings > Secrets as GEMINI_API_KEY for persistent server-side Gemini calls.',
  },
  {
    name: 'OPENAI_COMPAT_API_KEY',
    group: 'AI_PROVIDERS',
    requirement: 'OPTIONAL',
    scope: 'SERVER_ONLY',
    consumedAt: ['src/lib/aiProviderVaultServer.ts'],
    defaultGuidance: 'Optional OpenAI-compatible provider key stored in server Secrets.',
  },
  {
    name: 'ANTHROPIC_API_KEY',
    group: 'AI_PROVIDERS',
    requirement: 'OPTIONAL',
    scope: 'SERVER_ONLY',
    consumedAt: ['src/lib/aiProviderVaultServer.ts'],
    defaultGuidance: 'Optional Claude/Anthropic provider key stored in server Secrets.',
  },

  // Market Data
  {
    name: 'COINGECKO_API_KEY',
    group: 'MARKET_DATA',
    requirement: 'REQUIRED_FOR_FEATURE',
    scope: 'SERVER_ONLY',
    consumedAt: ['src/lib/coinGeckoClient.ts', 'server.ts'],
    defaultGuidance: 'Set server-only COINGECKO_API_KEY in AI Studio Settings > Secrets (never use VITE_ prefix).',
  },
  {
    name: 'COINGECKO_API_TIER',
    group: 'MARKET_DATA',
    requirement: 'OPTIONAL',
    scope: 'SERVER_ONLY',
    consumedAt: ['src/lib/coinGeckoClient.ts'],
    defaultGuidance: 'Set to "demo" (api.coingecko.com) or "pro" (pro-api.coingecko.com); defaults safely to "demo".',
  },
  {
    name: 'CMC_API_KEY',
    group: 'MARKET_DATA',
    requirement: 'OPTIONAL',
    scope: 'SERVER_ONLY',
    consumedAt: ['server.ts', 'src/lib/smartMarketDataRouter.ts'],
    defaultGuidance: 'Optional server-only CoinMarketCap key (never use deprecated VITE_CMC_API_KEY).',
  },
  {
    name: 'CRYPTOPANIC_API_KEY',
    group: 'MARKET_DATA',
    requirement: 'OPTIONAL',
    scope: 'SERVER_ONLY',
    consumedAt: ['server.ts'],
    defaultGuidance: 'Optional CryptoPanic news API token.',
  },
  {
    name: 'LUNARCRUSH_API_KEY',
    group: 'MARKET_DATA',
    requirement: 'OPTIONAL',
    scope: 'SERVER_ONLY',
    consumedAt: ['server.ts'],
    defaultGuidance: 'Optional LunarCrush sentiment API key.',
  },

  // Auth, RBAC & Core Security
  {
    name: 'ADMIN_EMAIL_ALLOWLIST',
    group: 'AUTH_AND_SECURITY',
    requirement: 'CORE_SECURITY',
    scope: 'SERVER_ONLY',
    consumedAt: ['server.ts', 'src/lib/rbac.ts'],
    defaultGuidance: 'Comma-separated verified Owner email addresses granted SUPER_ADMIN server RBAC.',
  },
  {
    name: 'OPERATOR_API_TOKEN',
    group: 'AUTH_AND_SECURITY',
    requirement: 'OPTIONAL',
    scope: 'SERVER_ONLY',
    consumedAt: ['server.ts'],
    defaultGuidance: 'Optional server-side bearer token for automated CLI/operator clearance (32+ char random token).',
  },
  {
    name: 'OWNER_ALERT_EMAIL',
    group: 'AUTH_AND_SECURITY',
    requirement: 'REQUIRED_FOR_FEATURE',
    scope: 'SERVER_ONLY',
    consumedAt: ['server.ts'],
    defaultGuidance: 'Private Owner email for OTP challenges and operational alerts (also included in admin allowlist).',
  },
  {
    name: 'RESEND_API_KEY',
    group: 'AUTH_AND_SECURITY',
    requirement: 'OPTIONAL',
    scope: 'SERVER_ONLY',
    consumedAt: ['server.ts'],
    defaultGuidance: 'Resend API key (starts with re_) for Email OTP and 3-hour signal digests.',
  },
  {
    name: 'RESEND_FROM_EMAIL',
    group: 'AUTH_AND_SECURITY',
    requirement: 'OPTIONAL',
    scope: 'SERVER_ONLY',
    consumedAt: ['server.ts'],
    defaultGuidance: 'Verified sender domain address for Resend transactional emails.',
  },
  {
    name: 'SESSION_SIGNING_KEY',
    group: 'AUTH_AND_SECURITY',
    requirement: 'OPTIONAL',
    scope: 'SERVER_ONLY',
    consumedAt: ['server.ts'],
    defaultGuidance: 'Optional persistent 32+ char HMAC signing secret so operator sessions survive server restarts.',
  },
  {
    name: 'CLOUDFLARE_TURNSTILE_SECRET_KEY',
    group: 'AUTH_AND_SECURITY',
    requirement: 'OPTIONAL',
    scope: 'SERVER_ONLY',
    consumedAt: ['server.ts'],
    defaultGuidance: 'Optional Cloudflare Turnstile server-side verification secret.',
  },

  // Telegram, Make.com & Discord Notifications
  {
    name: 'TELEGRAM_BOT_TOKEN',
    group: 'NOTIFICATIONS',
    requirement: 'REQUIRED_FOR_FEATURE',
    scope: 'SERVER_ONLY',
    consumedAt: ['src/lib/notificationDeliveryConfig.ts', 'src/lib/notificationLedgerServer.ts', 'server.ts'],
    defaultGuidance: 'Canonical Telegram BotFather token (<digits>:<secret>). Never paste into TELEGRAM_CHAT_ID.',
  },
  {
    name: 'TELEGRAM_CHAT_ID',
    group: 'NOTIFICATIONS',
    requirement: 'REQUIRED_FOR_FEATURE',
    scope: 'SERVER_ONLY',
    consumedAt: ['src/lib/notificationDeliveryConfig.ts', 'src/lib/notificationLedgerServer.ts', 'server.ts'],
    defaultGuidance: 'Canonical public Telegram channel numeric ID (-100...). Pending Owner configuration until valid.',
  },
  {
    name: 'TELEGRAM_DEV_CHAT_ID',
    group: 'NOTIFICATIONS',
    requirement: 'OPTIONAL',
    scope: 'SERVER_ONLY',
    consumedAt: ['src/lib/notificationDeliveryConfig.ts', 'server.ts'],
    defaultGuidance: 'Private numeric Telegram user ID for Stream 2 developer audits (never a -100 channel ID).',
  },
  {
    name: 'TELEGRAM_WEBHOOK_SECRET',
    group: 'NOTIFICATIONS',
    requirement: 'OPTIONAL',
    scope: 'SERVER_ONLY',
    consumedAt: ['src/lib/notificationDeliveryConfig.ts', 'server.ts'],
    defaultGuidance: 'Independent 16-256 char [A-Za-z0-9_-] secret for /api/telegram/webhook (never reuse Bot Token).',
  },
  {
    name: 'MAKE_WEBHOOK_URL',
    group: 'NOTIFICATIONS',
    requirement: 'OPTIONAL',
    scope: 'SERVER_ONLY',
    consumedAt: ['src/lib/notificationDeliveryConfig.ts', 'src/lib/notificationLedgerServer.ts', 'server.ts'],
    defaultGuidance: 'Optional active Make.com Custom Webhook HTTPS URL (hook.<region>.make.com/<token>).',
  },
  {
    name: 'DISCORD_WEBHOOK_URL',
    group: 'NOTIFICATIONS',
    requirement: 'OPTIONAL',
    scope: 'SERVER_ONLY',
    consumedAt: ['src/lib/notificationDeliveryConfig.ts', 'src/lib/notificationLedgerServer.ts', 'server.ts'],
    defaultGuidance: 'Discord channel webhook URL for structured signal embeds (?wait=true).',
  },

  // Exchange Demo/Sandbox
  {
    name: 'OKX_API_KEY',
    group: 'EXCHANGES',
    requirement: 'OPTIONAL',
    scope: 'SERVER_ONLY',
    consumedAt: ['server.ts'],
    defaultGuidance: 'Optional OKX Demo/Sandbox API key (real-money live trading remains locked).',
  },
  {
    name: 'BINANCE_TESTNET_API_KEY',
    group: 'EXCHANGES',
    requirement: 'OPTIONAL',
    scope: 'SERVER_ONLY',
    consumedAt: ['server.ts'],
    defaultGuidance: 'Optional Binance Spot Testnet API key.',
  },

  // Intentionally Public Non-Secret Variables
  {
    name: 'APP_URL',
    group: 'PUBLIC_APP',
    requirement: 'OPTIONAL',
    scope: 'INTENTIONALLY_PUBLIC',
    consumedAt: ['server.ts'],
    defaultGuidance: 'Canonical HTTPS app URL injected by AI Studio / Cloud Run for links and webhook registration.',
  },
  {
    name: 'PUBLIC_WHATSAPP_URL',
    group: 'PUBLIC_APP',
    requirement: 'OPTIONAL',
    scope: 'INTENTIONALLY_PUBLIC',
    consumedAt: ['server.ts'],
    defaultGuidance: 'Optional public WhatsApp support desk HTTPS URL (server email/alert links).',
  },
  {
    name: 'VITE_PUBLIC_SUPPORT_EMAIL',
    group: 'PUBLIC_APP',
    requirement: 'OPTIONAL',
    scope: 'INTENTIONALLY_PUBLIC',
    consumedAt: ['src/components/FooterSocialAndContact.tsx'],
    defaultGuidance: 'Optional public support email embedded at build time (defaults to support@signalforge.app).',
  },
];

const OBSOLETE_ENV_CATALOG: readonly {
  readonly name: string;
  readonly replacement: string;
  readonly message: string;
}[] = [
  {
    name: 'BOT_TOKEN',
    replacement: 'TELEGRAM_BOT_TOKEN',
    message: 'Obsolete alias superseded by TELEGRAM_BOT_TOKEN. Remove from Secrets and local .env.',
  },
  {
    name: 'CHAT_ID',
    replacement: 'TELEGRAM_CHAT_ID',
    message: 'Obsolete alias superseded by canonical TELEGRAM_CHAT_ID. Remove after setting TELEGRAM_CHAT_ID.',
  },
  {
    name: 'DEVELOPER_CHAT_ID',
    replacement: 'TELEGRAM_DEV_CHAT_ID',
    message: 'Obsolete alias superseded by TELEGRAM_DEV_CHAT_ID. Remove from Secrets.',
  },
  {
    name: 'WEBHOOK_BOT_TOKEN',
    replacement: 'Removed (secret-free Make.com payloads)',
    message: 'Obsolete credential removed in Step 3. Delete from local .env and Secrets.',
  },
  {
    name: 'VITE_CMC_API_KEY',
    replacement: 'CMC_API_KEY',
    message: 'Deprecated client-exposed variable name. Move credential to server-only CMC_API_KEY and delete VITE_CMC_API_KEY.',
  },
  {
    name: 'RECIPIENT_EMAIL',
    replacement: 'OWNER_ALERT_EMAIL / ADMIN_EMAIL_ALLOWLIST',
    message: 'Legacy email variable superseded by OWNER_ALERT_EMAIL and ADMIN_EMAIL_ALLOWLIST.',
  },
];

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const TELEGRAM_WEBHOOK_SECRET_RE = /^[A-Za-z0-9_-]{16,256}$/;

function isNonPlaceholderValue(raw: string | undefined): boolean {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return false;
  const upper = trimmed.toUpperCase();
  if (PLACEHOLDER_TOKENS.has(upper) || upper.startsWith('EXAMPLE_')) return false;
  return true;
}

function isValidHttpsUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw.trim());
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function resolveEnvVarSource(
  name: string,
  env: Record<string, string | undefined>,
  preDotenvKeys: ReadonlySet<string>,
  dotenvLoadedKeys: ReadonlySet<string>
): ConfigEnvSource {
  if (!isNonPlaceholderValue(env[name])) {
    return 'UNSET';
  }
  if (preDotenvKeys.has(name)) {
    return 'PLATFORM_RUNTIME_ENV';
  }
  if (dotenvLoadedKeys.has(name)) {
    return 'LOCAL_DOTENV_FALLBACK';
  }
  return 'PLATFORM_RUNTIME_ENV';
}

export function loadPreviousBootPresenceSnapshot(snapshotPath: string): BootEnvPresenceSnapshot | null {
  try {
    if (!fs.existsSync(snapshotPath)) return null;
    const raw = fs.readFileSync(snapshotPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BootEnvPresenceSnapshot> | null;
    if (!parsed || parsed.schemaVersion !== 1 || !parsed.presenceByVar || typeof parsed.presenceByVar !== 'object') {
      return null;
    }
    return {
      schemaVersion: 1,
      bootCount: typeof parsed.bootCount === 'number' && Number.isFinite(parsed.bootCount) ? parsed.bootCount : 1,
      recordedAtIso: typeof parsed.recordedAtIso === 'string' ? parsed.recordedAtIso : new Date().toISOString(),
      runtimeRevision: typeof parsed.runtimeRevision === 'string' ? parsed.runtimeRevision : 'local-dev',
      presenceByVar: parsed.presenceByVar,
    };
  } catch {
    return null;
  }
}

/**
 * Records strictly non-secret boolean presence metadata per tracked env var name.
 * NEVER writes values, lengths, prefixes, suffixes, or hashes.
 */
export function recordBootPresenceSnapshot(params: {
  readonly snapshotPath: string;
  readonly env: Record<string, string | undefined>;
  readonly preDotenvKeys: ReadonlySet<string>;
  readonly dotenvLoadedKeys: ReadonlySet<string>;
  readonly nowIso?: string;
}): {
  readonly previous: BootEnvPresenceSnapshot | null;
  readonly current: BootEnvPresenceSnapshot;
} {
  const previous = loadPreviousBootPresenceSnapshot(params.snapshotPath);
  const recordedAtIso = params.nowIso || new Date().toISOString();
  const presenceByVar: BootEnvPresenceSnapshot['presenceByVar'] = {};

  for (const spec of SIGNAL_FORGE_CONFIG_CATALOG) {
    const present = isNonPlaceholderValue(params.env[spec.name]);
    const source = resolveEnvVarSource(
      spec.name,
      params.env,
      params.preDotenvKeys,
      params.dotenvLoadedKeys
    );
    presenceByVar[spec.name] = { present, source };
  }

  const current: BootEnvPresenceSnapshot = {
    schemaVersion: 1,
    bootCount: (previous?.bootCount ?? 0) + 1,
    recordedAtIso,
    runtimeRevision: params.env.K_REVISION ? 'cloud-run-revision' : 'local-node-runtime',
    presenceByVar,
  };

  try {
    const dir = path.dirname(params.snapshotPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${params.snapshotPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(current, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, params.snapshotPath);
  } catch {
    // Non-fatal on read-only filesystems
  }

  return { previous, current };
}

function resolvePersistenceStatus(
  name: string,
  presentNow: boolean,
  previousSnapshot: BootEnvPresenceSnapshot | null
): ConfigPersistenceStatus {
  const wasPresentPreviously = Boolean(previousSnapshot?.presenceByVar?.[name]?.present);
  if (presentNow) {
    return wasPresentPreviously ? 'VERIFIED_PERSISTENT' : 'FIRST_BOOT_BASELINE';
  }
  if (wasPresentPreviously) {
    return 'NOT_PERSISTED_AFTER_RESTART';
  }
  return 'UNCONFIGURED';
}

export function buildOwnerConfigHealthReport(params: {
  readonly env: Record<string, string | undefined>;
  readonly preDotenvKeys: ReadonlySet<string>;
  readonly dotenvLoadedKeys: ReadonlySet<string>;
  readonly localDotenvFilePresent: boolean;
  readonly previousBootSnapshot: BootEnvPresenceSnapshot | null;
  readonly currentBootSnapshot: BootEnvPresenceSnapshot | null;
  readonly aiProvidersStatus?: PublicAiProvidersStatus | null;
  readonly coinGeckoStatus?: CoinGeckoSanitizedStatus | null;
  readonly notificationHealth?: NotificationHealthOverview | null;
  readonly nowIso?: string;
}): OwnerConfigHealthReport {
  const { env, preDotenvKeys, dotenvLoadedKeys, previousBootSnapshot, currentBootSnapshot } = params;
  const generatedAtIso = params.nowIso || new Date().toISOString();

  const tgCfg = resolveTelegramConfig(env);
  const makeCfg = resolveMakeWebhookConfig(env);
  const discordCfg = resolveDiscordWebhookConfig(env);
  const cgEnv = resolveCoinGeckoEnvConfig(env);

  const items: ConfigRegistryItem[] = SIGNAL_FORGE_CONFIG_CATALOG.map((spec) => {
    const rawVal = String(env[spec.name] || '').trim();
    const presentInEnv = isNonPlaceholderValue(rawVal);
    let source = resolveEnvVarSource(spec.name, env, preDotenvKeys, dotenvLoadedKeys);
    let present = presentInEnv;
    const persistence = resolvePersistenceStatus(spec.name, presentInEnv, previousBootSnapshot);

    let status: ConfigHealthStatus = presentInEnv ? 'CONFIGURED' : 'MISSING';
    let validFormat: boolean | null = presentInEnv ? true : null;
    let ownerActionRequired = false;
    let guidance = spec.defaultGuidance;

    // Cross-restart disappearance takes immediate precedence when missing
    if (!presentInEnv && persistence === 'NOT_PERSISTED_AFTER_RESTART') {
      status = 'RESTART_NOT_PERSISTED';
      ownerActionRequired = true;
      guidance = `${spec.name} was present on the previous server boot but is missing after restart. Save it permanently in AI Studio Settings > Secrets (not session-only prompts).`;
    }

    switch (spec.name) {
      case 'GEMINI_API_KEY': {
        const aiGem = params.aiProvidersStatus?.gemini;
        if (!presentInEnv && aiGem?.hasStoredSecret) {
          present = true;
          source = 'BACKEND_ENCRYPTED_VAULT';
          status = aiGem.lastTestResult?.ok ? 'VERIFIED' : 'PENDING_VERIFICATION';
          validFormat = true;
          ownerActionRequired = true;
          guidance =
            'Gemini key is only in the container-local encrypted vault (.data/). Copy it into AI Studio Settings > Secrets as GEMINI_API_KEY so it survives full container rebuilds.';
        } else if (presentInEnv) {
          const formatOk = rawVal.length >= 20 && !/\s/.test(rawVal);
          validFormat = formatOk;
          if (!formatOk) {
            status = 'INVALID_FORMAT';
            ownerActionRequired = true;
            guidance = 'GEMINI_API_KEY length or whitespace looks invalid. Re-enter a valid Gemini API key in Settings > Secrets.';
          } else if (aiGem?.lastTestResult?.ok) {
            status = 'VERIFIED';
            guidance = `GEMINI_API_KEY is active in server environment and verified (${aiGem.configuredModel}).`;
          } else {
            status = 'CONFIGURED';
            guidance =
              'GEMINI_API_KEY is configured in server environment and persists across browser reloads. Use Test Connection on demand if you wish to run a live check.';
          }
        } else if (status !== 'RESTART_NOT_PERSISTED') {
          status = 'MISSING';
          ownerActionRequired = true;
        }
        break;
      }

      case 'COINGECKO_API_KEY': {
        if (presentInEnv) {
          const formatOk = rawVal.length >= 12 && !/\s/.test(rawVal);
          validFormat = formatOk;
          if (!formatOk) {
            status = 'INVALID_FORMAT';
            ownerActionRequired = true;
            guidance = 'COINGECKO_API_KEY format looks invalid (too short or contains whitespace).';
          } else if (params.coinGeckoStatus?.connectionStatus === 'VERIFIED_LIVE') {
            status = 'VERIFIED';
            guidance = `CoinGecko ${cgEnv.tier.toUpperCase()} verified against ${cgEnv.endpointHost}.`;
          } else if (params.coinGeckoStatus?.connectionStatus === 'AUTH_ERROR') {
            status = 'INVALID_FORMAT';
            ownerActionRequired = true;
            guidance = `CoinGecko rejected credentials for tier=${cgEnv.tier} (${cgEnv.endpointHost}). Verify key matches COINGECKO_API_TIER.`;
          } else {
            status = 'PENDING_VERIFICATION';
            guidance = `COINGECKO_API_KEY is loaded server-side for ${cgEnv.tier.toUpperCase()} (${cgEnv.endpointHost}) and awaiting live probe.`;
          }
        } else if (status !== 'RESTART_NOT_PERSISTED') {
          status = 'MISSING';
          ownerActionRequired = true;
        }
        break;
      }

      case 'COINGECKO_API_TIER': {
        if (presentInEnv) {
          const lower = rawVal.toLowerCase();
          validFormat = lower === 'demo' || lower === 'pro';
          if (!validFormat) {
            status = 'INVALID_FORMAT';
            ownerActionRequired = true;
            guidance = 'COINGECKO_API_TIER must be either "demo" or "pro".';
          } else {
            status = 'CONFIGURED';
            guidance = `Explicitly configured as "${lower}" (${cgEnv.endpointHost}).`;
          }
        } else if (status !== 'RESTART_NOT_PERSISTED') {
          status = 'MISSING';
          ownerActionRequired = false;
          guidance = 'Optional: unset, defaulting cleanly to "demo" (api.coingecko.com).';
        }
        break;
      }

      case 'ADMIN_EMAIL_ALLOWLIST': {
        if (presentInEnv) {
          const emails = rawVal
            .split(',')
            .map((e) => e.trim())
            .filter(Boolean);
          validFormat = emails.length > 0 && emails.every((e) => EMAIL_RE.test(e));
          if (!validFormat) {
            status = 'INVALID_FORMAT';
            ownerActionRequired = true;
            guidance = 'ADMIN_EMAIL_ALLOWLIST contains an invalid email address. Use comma-separated verified emails.';
          } else {
            status = 'VERIFIED';
            guidance = `Configured with ${emails.length} authorized Owner email(s) for server-side Firebase SUPER_ADMIN RBAC.`;
          }
        } else if (status !== 'RESTART_NOT_PERSISTED') {
          status = 'MISSING';
          ownerActionRequired = !isNonPlaceholderValue(env.OWNER_ALERT_EMAIL);
          guidance =
            'Set ADMIN_EMAIL_ALLOWLIST in AI Studio Settings > Secrets to explicitly bind Owner Firebase RBAC (currently relying on OWNER_ALERT_EMAIL if set).';
        }
        break;
      }

      case 'OWNER_ALERT_EMAIL': {
        if (presentInEnv) {
          validFormat = EMAIL_RE.test(rawVal);
          status = validFormat ? 'CONFIGURED' : 'INVALID_FORMAT';
          ownerActionRequired = !validFormat;
          guidance = validFormat
            ? 'Configured server-side for private OTP and Owner alerts.'
            : 'OWNER_ALERT_EMAIL is not a valid email address.';
        } else if (status !== 'RESTART_NOT_PERSISTED') {
          status = 'MISSING';
          ownerActionRequired = !isNonPlaceholderValue(env.ADMIN_EMAIL_ALLOWLIST);
        }
        break;
      }

      case 'RESEND_API_KEY': {
        if (presentInEnv) {
          validFormat = rawVal.startsWith('re_') && rawVal.length >= 16 && !/\s/.test(rawVal);
          status = validFormat ? 'CONFIGURED' : 'INVALID_FORMAT';
          ownerActionRequired = !validFormat;
          guidance = validFormat
            ? 'Resend API key is configured server-side for Email OTP and digests.'
            : 'RESEND_API_KEY should start with "re_" and contain no whitespace.';
        }
        break;
      }

      case 'OPERATOR_API_TOKEN': {
        if (presentInEnv) {
          validFormat = rawVal.length >= 24 && !/\s/.test(rawVal);
          status = validFormat ? 'CONFIGURED' : 'INVALID_FORMAT';
          ownerActionRequired = !validFormat;
          guidance = validFormat
            ? 'Server-side operator automation bearer token configured.'
            : 'OPERATOR_API_TOKEN should be at least 24 random non-whitespace characters.';
        } else if (status !== 'RESTART_NOT_PERSISTED') {
          status = 'MISSING';
          ownerActionRequired = false;
          guidance = 'Optional: interactive Owner auth uses Firebase ID tokens; only required for headless CLI/automation.';
        }
        break;
      }

      case 'TELEGRAM_BOT_TOKEN': {
        if (presentInEnv) {
          validFormat = isValidTelegramBotToken(rawVal);
          if (!validFormat) {
            status = 'INVALID_FORMAT';
            ownerActionRequired = true;
            guidance = 'TELEGRAM_BOT_TOKEN does not match Telegram BotFather format (<digits>:<secret>).';
          } else if (
            params.notificationHealth?.telegram.state === 'AUTHENTICATED' ||
            params.notificationHealth?.telegram.state === 'DELIVERY_ACCEPTED'
          ) {
            status = 'VERIFIED';
            guidance = `Verified via read-only Telegram getMe (${params.notificationHealth.telegram.botUsername || 'active bot'}).`;
          } else if (params.notificationHealth?.telegram.state === 'AUTH_FAILED') {
            status = 'INVALID_FORMAT';
            ownerActionRequired = true;
            guidance = 'Telegram rejected TELEGRAM_BOT_TOKEN (HTTP 401). Verify token in BotFather and AI Studio Secrets.';
          } else {
            status = 'PENDING_VERIFICATION';
            guidance = 'TELEGRAM_BOT_TOKEN format is valid; awaiting read-only Telegram getMe check.';
          }
          if (source === 'LOCAL_DOTENV_FALLBACK') {
            ownerActionRequired = true;
            guidance += ' Warning: loaded from local .env fallback instead of AI Studio Settings > Secrets.';
          }
        } else if (status !== 'RESTART_NOT_PERSISTED') {
          status = 'MISSING';
          ownerActionRequired = true;
        }
        break;
      }

      case 'TELEGRAM_CHAT_ID': {
        if (!presentInEnv) {
          validFormat = null;
          status =
            persistence === 'NOT_PERSISTED_AFTER_RESTART'
              ? 'RESTART_NOT_PERSISTED'
              : 'PENDING_OWNER_CONFIGURATION';
          ownerActionRequired = true;
          guidance =
            'PENDING_OWNER_CONFIGURATION: Enter your verified numeric public Telegram channel ID (-100...) in AI Studio Settings > Secrets as TELEGRAM_CHAT_ID.';
        } else if (isValidTelegramBotToken(rawVal) || !isValidTelegramPublicChatId(rawVal)) {
          validFormat = false;
          status = 'PENDING_OWNER_CONFIGURATION';
          ownerActionRequired = true;
          guidance = isValidTelegramBotToken(rawVal)
            ? 'PENDING_OWNER_CONFIGURATION: TELEGRAM_CHAT_ID currently contains a Bot Token instead of a -100... channel ID. Replace with your verified numeric channel ID in Settings > Secrets.'
            : 'PENDING_OWNER_CONFIGURATION: TELEGRAM_CHAT_ID format is invalid. Set a verified numeric -100... Telegram channel ID in Settings > Secrets.';
        } else {
          validFormat = true;
          status = 'CONFIGURED';
          ownerActionRequired = source === 'LOCAL_DOTENV_FALLBACK';
          guidance =
            source === 'LOCAL_DOTENV_FALLBACK'
              ? 'Canonical TELEGRAM_CHAT_ID loaded only from local .env fallback. Save it in AI Studio Settings > Secrets for permanent persistence.'
              : 'Canonical public Telegram channel destination configured in server environment.';
        }
        break;
      }

      case 'TELEGRAM_DEV_CHAT_ID': {
        if (presentInEnv) {
          validFormat =
            isValidTelegramPrivateUserId(rawVal) &&
            tgCfg.devChatIdSource === 'TELEGRAM_DEV_CHAT_ID';
          status = validFormat ? 'CONFIGURED' : 'INVALID_FORMAT';
          ownerActionRequired = !validFormat;
          guidance = validFormat
            ? 'Private numeric Telegram developer ID configured for Stream 2 audits.'
            : 'TELEGRAM_DEV_CHAT_ID must be your private positive numeric Telegram user ID (never a -100 channel ID or stripped channel ID).';
        } else if (status !== 'RESTART_NOT_PERSISTED') {
          status = 'MISSING';
          ownerActionRequired = true;
          guidance = 'Optional Stream 2 private audit destination: set your personal numeric user ID from @userinfobot.';
        }
        break;
      }

      case 'TELEGRAM_WEBHOOK_SECRET': {
        if (presentInEnv) {
          const sameAsToken =
            isValidTelegramBotToken(rawVal) ||
            (tgCfg.botToken !== null && rawVal === tgCfg.botToken);
          validFormat = !sameAsToken && TELEGRAM_WEBHOOK_SECRET_RE.test(rawVal);
          status = validFormat ? 'CONFIGURED' : 'INVALID_FORMAT';
          ownerActionRequired = !validFormat;
          guidance = validFormat
            ? 'Independent webhook secret configured; inbound /api/telegram/webhook verification ready.'
            : sameAsToken
            ? 'TELEGRAM_WEBHOOK_SECRET must NOT reuse TELEGRAM_BOT_TOKEN. Generate a separate 32+ char [A-Za-z0-9_-] secret.'
            : 'TELEGRAM_WEBHOOK_SECRET must be 16-256 characters using only A-Z, a-z, 0-9, _ and -.';
        } else if (status !== 'RESTART_NOT_PERSISTED') {
          status = 'MISSING';
          ownerActionRequired = false;
          guidance = 'Inbound /api/telegram/webhook remains safely locked fail-closed until a random [A-Za-z0-9_-] secret is set.';
        }
        break;
      }

      case 'MAKE_WEBHOOK_URL': {
        if (presentInEnv) {
          validFormat = makeCfg.valid;
          if (!makeCfg.valid) {
            status = 'INVALID_FORMAT';
            ownerActionRequired = true;
            guidance =
              makeCfg.issues[0]?.message ||
              'MAKE_WEBHOOK_URL does not match an active Make.com Custom Webhook HTTPS URL.';
          } else if (params.notificationHealth?.makeWebhook.state === 'DELIVERY_ACCEPTED') {
            status = 'VERIFIED';
            guidance = 'Make.com Custom Webhook accepted delivery cleanly.';
          } else if (params.notificationHealth?.makeWebhook.state === 'WEBHOOK_UNREACHABLE') {
            status = 'INVALID_FORMAT';
            ownerActionRequired = true;
            guidance = 'Make.com webhook returned HTTP 404 or network failure. Verify the scenario webhook is active.';
          } else {
            status = 'PENDING_VERIFICATION';
            guidance = 'Make.com HTTPS URL format is valid; Telegram currently defaults to TELEGRAM_DIRECT to prevent duplicates.';
          }
        }
        break;
      }

      case 'DISCORD_WEBHOOK_URL': {
        if (presentInEnv) {
          validFormat = discordCfg.valid;
          if (!discordCfg.valid) {
            status = 'INVALID_FORMAT';
            ownerActionRequired = true;
            guidance =
              discordCfg.issues[0]?.message ||
              'DISCORD_WEBHOOK_URL does not match https://discord.com/api/webhooks/<id>/<token>.';
          } else if (params.notificationHealth?.discord.state === 'DELIVERY_ACCEPTED') {
            status = 'VERIFIED';
            guidance = 'Discord structured embed webhook verified via ?wait=true snowflake acknowledgement.';
          } else {
            status = 'PENDING_VERIFICATION';
            guidance = 'Discord webhook URL format is valid and ready for structured signal embeds (?wait=true).';
          }
        }
        break;
      }

      case 'PUBLIC_WHATSAPP_URL':
      case 'APP_URL': {
        if (presentInEnv) {
          validFormat = isValidHttpsUrl(rawVal);
          status = validFormat ? 'CONFIGURED' : 'INVALID_FORMAT';
          ownerActionRequired = !validFormat;
          guidance = validFormat
            ? `${spec.name} is configured as a valid HTTPS URL.`
            : `${spec.name} must be a valid https:// URL.`;
        }
        break;
      }

      case 'VITE_PUBLIC_SUPPORT_EMAIL': {
        if (presentInEnv) {
          validFormat = EMAIL_RE.test(rawVal);
          status = validFormat ? 'CONFIGURED' : 'INVALID_FORMAT';
          ownerActionRequired = !validFormat;
          guidance = validFormat
            ? 'Intentionally public support email configured.'
            : 'VITE_PUBLIC_SUPPORT_EMAIL is not a valid email format.';
        } else if (status !== 'RESTART_NOT_PERSISTED') {
          status = 'MISSING';
          ownerActionRequired = false;
          guidance = 'Optional public setting; UI falls back safely to support@signalforge.app.';
        }
        break;
      }

      default:
        break;
    }

    return {
      name: spec.name,
      group: spec.group,
      requirement: spec.requirement,
      scope: spec.scope,
      status,
      present,
      validFormat,
      source,
      persistence,
      consumedAt: spec.consumedAt,
      ownerActionRequired,
      guidance,
    };
  });

  const obsoleteWarnings: ObsoleteEnvWarning[] = [];
  for (const ob of OBSOLETE_ENV_CATALOG) {
    if (isNonPlaceholderValue(env[ob.name])) {
      obsoleteWarnings.push({
        name: ob.name,
        replacement: ob.replacement,
        source: resolveEnvVarSource(ob.name, env, preDotenvKeys, dotenvLoadedKeys),
        message: ob.message,
      });
    }
  }

  const countByStatus = (target: ConfigHealthStatus) =>
    items.filter((i) => i.status === target).length;

  const tgChatItem = items.find((i) => i.name === 'TELEGRAM_CHAT_ID')!;
  const tgTokenItem = items.find((i) => i.name === 'TELEGRAM_BOT_TOKEN')!;
  const geminiItem = items.find((i) => i.name === 'GEMINI_API_KEY')!;
  const cgItem = items.find((i) => i.name === 'COINGECKO_API_KEY')!;

  const platformGuidance: string[] = [
    'Save permanent secrets in Google AI Studio Settings > Secrets (and Cloud Run deployment env vars when deploying) rather than temporary preview prompts.',
    'AI Studio masks secret values after saving; an empty input box after browser reload does not mean the backend lost the secret — rely on this verified server status panel.',
    'Do not store secrets in VITE_* variables, localStorage, Firestore, or git-tracked files. Remove legacy aliases (BOT_TOKEN, CHAT_ID, DEVELOPER_CHAT_ID, VITE_CMC_API_KEY, RECIPIENT_EMAIL) to eliminate precedence conflicts.',
  ];

  return {
    generatedAtIso,
    runtime: {
      nodeEnv: String(env.NODE_ENV || 'development'),
      cloudRunService: Boolean(env.K_SERVICE),
      runtimeRevisionPresent: Boolean(env.K_REVISION),
      localDotenvFilePresent: params.localDotenvFilePresent,
      localDotenvLoadedKeysCount: dotenvLoadedKeys.size,
      platformRuntimeKeysTrackedCount: items.filter((i) => i.source === 'PLATFORM_RUNTIME_ENV')
        .length,
      bootCount: currentBootSnapshot?.bootCount ?? 1,
      previousBootRecordedAtIso: previousBootSnapshot?.recordedAtIso ?? null,
      currentBootRecordedAtIso: currentBootSnapshot?.recordedAtIso ?? generatedAtIso,
    },
    summary: {
      totalTracked: items.length,
      verified: countByStatus('VERIFIED'),
      configured: countByStatus('CONFIGURED'),
      pendingVerification: countByStatus('PENDING_VERIFICATION'),
      pendingOwnerConfiguration: countByStatus('PENDING_OWNER_CONFIGURATION'),
      invalidFormat: countByStatus('INVALID_FORMAT'),
      missing: countByStatus('MISSING'),
      restartNotPersisted: countByStatus('RESTART_NOT_PERSISTED'),
      obsoleteConflicts: obsoleteWarnings.length,
    },
    telegramReadiness: {
      canonicalChannelEnvVar: 'TELEGRAM_CHAT_ID',
      canonicalChannelStatus:
        tgChatItem.status === 'CONFIGURED' ? 'CONFIGURED' : 'PENDING_OWNER_CONFIGURATION',
      botTokenStatus: tgTokenItem.status,
      botUsername: params.notificationHealth?.telegram.botUsername ?? null,
      usingLegacyChatFallback: tgCfg.publicChatIdSource === 'LEGACY_CHAT_ID',
      guidance: tgChatItem.guidance,
    },
    geminiReadiness: {
      envVar: 'GEMINI_API_KEY',
      status: geminiItem.status,
      source: geminiItem.source,
      persistence: geminiItem.persistence,
      configuredModel: params.aiProvidersStatus?.gemini.configuredModel || 'gemini-4-hydrogen',
      guidance: geminiItem.guidance,
    },
    coingeckoReadiness: {
      envVar: 'COINGECKO_API_KEY',
      tierEnvVar: 'COINGECKO_API_TIER',
      status: cgItem.status,
      tier: cgEnv.tier,
      endpointHost: cgEnv.endpointHost,
      persistence: cgItem.persistence,
      guidance: cgItem.guidance,
    },
    items,
    obsoleteWarnings,
    platformGuidance,
  };
}

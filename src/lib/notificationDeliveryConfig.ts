/**
 * Signal Forge — Step 3 Notification Configuration Validator, Secret-Free Payload Builders
 * & Honest Provider Health Classifier (Telegram, Make.com & Discord).
 *
 * Pure, side-effect-free TypeScript module (imported by both server.ts and client UI).
 * - Enforces canonical env precedence: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
 *   TELEGRAM_DEV_CHAT_ID, TELEGRAM_WEBHOOK_SECRET over legacy BOT_TOKEN / CHAT_ID / DEVELOPER_CHAT_ID.
 * - Rejects malformed credentials (bot tokens pasted into chat IDs or webhook secrets,
 *   channel IDs pasted into private developer chat IDs, stripped -100 IDs, invalid URLs).
 * - Removes hardcoded chat ID fallbacks and strips bot tokens from outbound webhook payloads.
 * - Produces structured, honest signal cards for Make.com, Telegram, and Discord.
 */

import { formatAlertPrice } from './telegramStreams';
import type { ExtractedTradingSignalCard, SignalLifecycleStatus, TpMilestone } from './signalProcessor';

export type NotificationDeliveryState =
  | 'SIGNAL_GENERATED'
  | 'SIGNAL_APPROVED'
  | 'QUEUED'
  | 'DISPATCH_ATTEMPTED'
  | 'PROVIDER_ACCEPTED'
  | 'DELIVERED_WHEN_VERIFIABLE'
  | 'FAILED'
  | 'RETRYING'
  | 'SUPPRESSED';

export type ProviderConnectionHealthState =
  | 'UNCONFIGURED'
  | 'CONFIGURED_NOT_VERIFIED'
  | 'AUTHENTICATED'
  | 'WEBHOOK_UNREACHABLE'
  | 'AUTH_FAILED'
  | 'DELIVERY_ACCEPTED'
  | 'DELIVERY_FAILED'
  | 'BLOCKED';

export type NotificationProviderId = 'MAKE_WEBHOOK' | 'TELEGRAM_DIRECT' | 'DISCORD_WEBHOOK';

export type NotificationDestination =
  | 'TELEGRAM_PUBLIC_CHANNEL'
  | 'TELEGRAM_DEV_PRIVATE'
  | 'DISCORD_SIGNAL_CHANNEL';

export type SignalNotificationCategory =
  | 'GENERATED_SIGNAL'
  | 'PAPER_EXECUTED_TRADE'
  | 'REALIZED_RESULT';

export type TelegramPrimaryTransport = 'MAKE_WEBHOOK' | 'TELEGRAM_DIRECT' | 'DISABLED';

export interface NotificationTransportPolicy {
  readonly telegramPrimaryTransport: TelegramPrimaryTransport;
  readonly allowTelegramFallbackOnPrimaryFailure: boolean;
  readonly discordEnabled: boolean;
  readonly updatedAtIso: string;
}

export interface ConfigIssue {
  readonly code: string;
  readonly envVar: string;
  readonly severity: 'ERROR' | 'WARNING';
  readonly message: string;
}

export interface ResolvedTelegramConfig {
  readonly botToken: string | null;
  readonly botTokenSource: 'TELEGRAM_BOT_TOKEN' | 'LEGACY_BOT_TOKEN' | null;
  readonly publicChatId: string | null;
  readonly publicChatIdSource: 'TELEGRAM_CHAT_ID' | 'LEGACY_CHAT_ID' | 'TELEGRAM_CHANNEL_ID' | null;
  readonly publicChannelHandle: string | null;
  readonly devChatId: string | null;
  readonly devChatIdSource: 'TELEGRAM_DEV_CHAT_ID' | 'LEGACY_DEVELOPER_CHAT_ID' | null;
  readonly webhookSecret: string | null;
  readonly webhookSecretValid: boolean;
  readonly botTokenValid: boolean;
  readonly publicChatIdValid: boolean;
  readonly devChatIdValid: boolean;
  readonly legacyShadowConflict: boolean;
  readonly issues: readonly ConfigIssue[];
}

export interface ResolvedMakeWebhookConfig {
  readonly webhookUrl: string | null;
  readonly maskedUrl: string;
  readonly host: string | null;
  readonly valid: boolean;
  readonly configured: boolean;
  readonly issues: readonly ConfigIssue[];
}

export interface ResolvedDiscordConfig {
  readonly webhookUrl: string | null;
  readonly maskedUrl: string;
  readonly valid: boolean;
  readonly configured: boolean;
  readonly botTokenConfiguredUnused: boolean;
  readonly channelIdConfiguredUnused: boolean;
  readonly issues: readonly ConfigIssue[];
}

export interface ProviderHealthSummary {
  readonly provider: NotificationProviderId;
  readonly label: string;
  readonly state: ProviderConnectionHealthState;
  readonly configured: boolean;
  readonly configValid: boolean;
  readonly maskedTarget: string;
  readonly lastVerifiedAtIso: string | null;
  readonly lastSuccessAtIso: string | null;
  readonly lastSuccessDetail: string | null;
  readonly lastFailureAtIso: string | null;
  readonly lastFailureHttpStatus: number | null;
  readonly lastFailureDetail: string | null;
  readonly botUsername?: string | null;
  readonly canonicalChannelStatus?: 'CONFIGURED' | 'PENDING_OWNER_CONFIGURATION';
  readonly issues: readonly ConfigIssue[];
}

export interface DeliveryLifecycleCounters {
  readonly signalGenerated: number;
  readonly signalApproved: number;
  readonly queued: number;
  readonly dispatchAttempted: number;
  readonly providerAccepted: number;
  readonly deliveredWhenVerifiable: number;
  readonly failed: number;
  readonly retrying: number;
  readonly suppressed: number;
}

export interface PersistedSignalPayload {
  readonly signalId: string;
  readonly eventId: string;
  readonly eventType: 'SIGNAL_CARD' | 'MILESTONE_PNL_UPDATE';
  readonly source: 'AUTOMATED' | 'MANUAL';
  readonly signalCategory: SignalNotificationCategory;
  readonly executionMode: string;
  readonly symbol: string;
  readonly direction: 'BUY' | 'SELL';
  readonly timeframe: string;
  readonly entryPrice: number;
  readonly takeProfits: readonly [number, number, number];
  readonly exitPrice: number;
  readonly stopLoss: number;
  readonly riskRewardRatio: number;
  readonly confidence: number;
  readonly hitTpMilestones: readonly TpMilestone[];
  readonly finalPnlUsd: number | null;
  readonly finalPnlPercent: number | null;
  readonly lifecycleStatus: SignalLifecycleStatus;
  readonly rationale: string;
  readonly formattedCard: string;
  readonly targetChatId: string | null;
  readonly channelName: string;
  readonly timestamp: string;
}

export interface SecretFreeMakeWebhookPayload {
  readonly signal_id: string;
  readonly event_id: string;
  readonly event_type: 'SIGNAL_CARD' | 'MILESTONE_PNL_UPDATE';
  readonly signal_category: SignalNotificationCategory;
  readonly execution_mode: string;
  readonly channel_name: string;
  readonly chat_id?: string;
  readonly source: 'AUTOMATED' | 'MANUAL';
  readonly symbol: string;
  readonly pair: string;
  readonly direction: 'BUY' | 'SELL';
  readonly timeframe: string;
  readonly entry_price: number;
  readonly take_profits: {
    readonly tp1: number;
    readonly tp2: number;
    readonly tp3: number;
  };
  readonly exit_price: number;
  readonly stop_loss: number;
  readonly risk_reward_ratio: number;
  readonly confidence_score: number;
  readonly hit_tp_milestones: readonly TpMilestone[];
  readonly final_pnl_usd: number | null;
  readonly final_pnl_percent: number | null;
  readonly lifecycle_status: SignalLifecycleStatus;
  readonly signal_card: string;
  readonly text: string;
  readonly timestamp: string;
}

export interface DiscordWebhookPayload {
  readonly username: string;
  readonly content: string;
  readonly embeds: readonly [
    {
      readonly title: string;
      readonly description: string;
      readonly color: number;
      readonly timestamp: string;
      readonly fields: ReadonlyArray<{
        readonly name: string;
        readonly value: string;
        readonly inline: boolean;
      }>;
      readonly footer: {
        readonly text: string;
      };
    },
  ];
}

const TELEGRAM_BOT_TOKEN_RE = /^\d{6,15}:[A-Za-z0-9_-]{20,128}$/;
const TELEGRAM_CHANNEL_NUMERIC_ID_RE = /^-100\d{7,15}$/;
const TELEGRAM_GROUP_OR_USER_ID_RE = /^-?\d{5,20}$/;
const TELEGRAM_PRIVATE_USER_ID_RE = /^\d{5,15}$/;
const TELEGRAM_HANDLE_RE = /^@[A-Za-z][A-Za-z0-9_]{3,31}$/;
const TELEGRAM_WEBHOOK_SECRET_RE = /^[A-Za-z0-9_-]{16,256}$/;
const MAKE_WEBHOOK_HOST_RE = /^hook(?:\.[a-z0-9-]+)?\.(?:make|integromat)\.com$/i;
const MAKE_WEBHOOK_TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
const DISCORD_WEBHOOK_URL_RE =
  /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/([0-9]{15,22})\/([A-Za-z0-9_-]{20,128})$/;

export function isValidTelegramBotToken(value: string): boolean {
  return TELEGRAM_BOT_TOKEN_RE.test(value.trim());
}

export function isValidTelegramPublicChatId(value: string): boolean {
  const clean = value.trim();
  if (!clean || isValidTelegramBotToken(clean)) return false;
  if (TELEGRAM_CHANNEL_NUMERIC_ID_RE.test(clean)) return true;
  if (TELEGRAM_GROUP_OR_USER_ID_RE.test(clean)) return true;
  if (TELEGRAM_HANDLE_RE.test(clean)) return true;
  return false;
}

export function isValidTelegramPrivateUserId(value: string): boolean {
  const clean = value.trim();
  if (!clean || isValidTelegramBotToken(clean)) return false;
  if (clean.startsWith('-')) return false;
  return TELEGRAM_PRIVATE_USER_ID_RE.test(clean);
}

export function isStrippedChannelIdMatch(
  candidatePrivateId: string,
  publicChannelId: string | null
): boolean {
  if (!publicChannelId) return false;
  const pub = publicChannelId.trim();
  const cand = candidatePrivateId.trim();
  if (!pub.startsWith('-100') || !cand) return false;
  return pub.slice(4) === cand;
}

export function normalizeTelegramChannelHandle(raw?: string | null): {
  handle: string | null;
  wasUrl: boolean;
} {
  const clean = String(raw || '').trim();
  if (!clean) return { handle: null, wasUrl: false };
  if (/^https?:\/\/t\.me\//i.test(clean)) {
    const slug = clean.replace(/^https?:\/\/t\.me\//i, '').split(/[/?#]/)[0]?.trim() || '';
    if (slug && /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(slug)) {
      return { handle: `@${slug}`, wasUrl: true };
    }
    return { handle: null, wasUrl: true };
  }
  if (TELEGRAM_HANDLE_RE.test(clean)) {
    return { handle: clean, wasUrl: false };
  }
  if (TELEGRAM_CHANNEL_NUMERIC_ID_RE.test(clean)) {
    return { handle: clean, wasUrl: false };
  }
  return { handle: null, wasUrl: false };
}

export function maskSecretUrl(url?: string | null): string {
  const clean = String(url || '').trim();
  if (!clean) return 'Not configured';
  try {
    const parsed = new URL(clean);
    const segs = parsed.pathname.split('/').filter(Boolean);
    if (segs.length === 0) return `${parsed.origin}/`;
    if (parsed.hostname.includes('discord')) {
      return `${parsed.origin}/api/webhooks/[redacted]`;
    }
    return `${parsed.origin}/[redacted-webhook]`;
  } catch {
    return 'Malformed URL (redacted)';
  }
}

export function resolveTelegramConfig(
  env: Record<string, string | undefined>
): ResolvedTelegramConfig {
  const issues: ConfigIssue[] = [];
  const canonicalToken = String(env.TELEGRAM_BOT_TOKEN || '').trim();
  const legacyToken = String(env.BOT_TOKEN || '').trim();

  let botToken: string | null = null;
  let botTokenSource: ResolvedTelegramConfig['botTokenSource'] = null;
  let legacyShadowConflict = false;

  if (canonicalToken && legacyToken && canonicalToken !== legacyToken) {
    legacyShadowConflict = true;
    issues.push({
      code: 'LEGACY_BOT_TOKEN_CONFLICT',
      envVar: 'BOT_TOKEN',
      severity: 'WARNING',
      message:
        'Legacy BOT_TOKEN differs from canonical TELEGRAM_BOT_TOKEN. Signal Forge uses TELEGRAM_BOT_TOKEN; remove obsolete BOT_TOKEN from Secrets.',
    });
  }

  if (canonicalToken) {
    if (isValidTelegramBotToken(canonicalToken)) {
      botToken = canonicalToken;
      botTokenSource = 'TELEGRAM_BOT_TOKEN';
    } else {
      issues.push({
        code: 'INVALID_TELEGRAM_BOT_TOKEN',
        envVar: 'TELEGRAM_BOT_TOKEN',
        severity: 'ERROR',
        message: 'TELEGRAM_BOT_TOKEN does not match Telegram BotFather format (<digits>:<secret>).',
      });
    }
  } else if (legacyToken) {
    if (isValidTelegramBotToken(legacyToken)) {
      botToken = legacyToken;
      botTokenSource = 'LEGACY_BOT_TOKEN';
      issues.push({
        code: 'LEGACY_BOT_TOKEN_FALLBACK',
        envVar: 'BOT_TOKEN',
        severity: 'WARNING',
        message:
          'Using legacy BOT_TOKEN fallback because TELEGRAM_BOT_TOKEN is unset. Migrate to TELEGRAM_BOT_TOKEN.',
      });
    } else {
      issues.push({
        code: 'INVALID_LEGACY_BOT_TOKEN',
        envVar: 'BOT_TOKEN',
        severity: 'ERROR',
        message: 'Legacy BOT_TOKEN is malformed and cannot authenticate with Telegram.',
      });
    }
  } else {
    issues.push({
      code: 'MISSING_TELEGRAM_BOT_TOKEN',
      envVar: 'TELEGRAM_BOT_TOKEN',
      severity: 'ERROR',
      message: 'TELEGRAM_BOT_TOKEN is not configured in server Secrets.',
    });
  }

  // Public Channel Chat ID: canonical TELEGRAM_CHAT_ID first, never a bot token, zero hardcoded fallback
  const canonicalChatId = String(env.TELEGRAM_CHAT_ID || '').trim();
  const legacyChatId = String(env.CHAT_ID || '').trim();
  const rawChannelId = String(env.TELEGRAM_CHANNEL_ID || '').trim();
  const normalizedChannel = normalizeTelegramChannelHandle(rawChannelId);

  if (rawChannelId && normalizedChannel.wasUrl) {
    issues.push({
      code: 'TELEGRAM_CHANNEL_ID_IS_URL',
      envVar: 'TELEGRAM_CHANNEL_ID',
      severity: 'WARNING',
      message:
        'TELEGRAM_CHANNEL_ID contains a full https://t.me/ URL instead of a @channel_handle or -100... numeric ID.',
    });
  } else if (rawChannelId && !normalizedChannel.handle) {
    issues.push({
      code: 'INVALID_TELEGRAM_CHANNEL_ID',
      envVar: 'TELEGRAM_CHANNEL_ID',
      severity: 'WARNING',
      message: 'TELEGRAM_CHANNEL_ID is malformed; expected @ChannelHandle or -100... numeric ID.',
    });
  }

  let publicChatId: string | null = null;
  let publicChatIdSource: ResolvedTelegramConfig['publicChatIdSource'] = null;

  if (canonicalChatId) {
    if (isValidTelegramBotToken(canonicalChatId)) {
      issues.push({
        code: 'TELEGRAM_CHAT_ID_IS_BOT_TOKEN',
        envVar: 'TELEGRAM_CHAT_ID',
        severity: 'ERROR',
        message:
          'TELEGRAM_CHAT_ID contains a Telegram Bot Token instead of a channel/chat ID (expected -100... numeric ID). Update TELEGRAM_CHAT_ID in Secrets.',
      });
    } else if (isValidTelegramPublicChatId(canonicalChatId)) {
      publicChatId = canonicalChatId;
      publicChatIdSource = 'TELEGRAM_CHAT_ID';
    } else {
      issues.push({
        code: 'INVALID_TELEGRAM_CHAT_ID',
        envVar: 'TELEGRAM_CHAT_ID',
        severity: 'ERROR',
        message: 'TELEGRAM_CHAT_ID is malformed; expected a numeric -100... channel ID or @handle.',
      });
    }
  }

  if (!publicChatId && legacyChatId) {
    if (isValidTelegramBotToken(legacyChatId)) {
      issues.push({
        code: 'LEGACY_CHAT_ID_IS_BOT_TOKEN',
        envVar: 'CHAT_ID',
        severity: 'ERROR',
        message: 'Legacy CHAT_ID contains a bot token and was rejected.',
      });
    } else if (isValidTelegramPublicChatId(legacyChatId)) {
      publicChatId = legacyChatId;
      publicChatIdSource = 'LEGACY_CHAT_ID';
      issues.push({
        code: 'LEGACY_CHAT_ID_FALLBACK',
        envVar: 'CHAT_ID',
        severity: 'WARNING',
        message:
          'Using legacy CHAT_ID because canonical TELEGRAM_CHAT_ID is missing or invalid. Copy your real -100... channel ID into TELEGRAM_CHAT_ID and remove CHAT_ID.',
      });
    } else {
      issues.push({
        code: 'INVALID_LEGACY_CHAT_ID',
        envVar: 'CHAT_ID',
        severity: 'ERROR',
        message: 'Legacy CHAT_ID is malformed and was rejected.',
      });
    }
  }

  if (!publicChatId && normalizedChannel.handle && isValidTelegramPublicChatId(normalizedChannel.handle)) {
    publicChatId = normalizedChannel.handle;
    publicChatIdSource = 'TELEGRAM_CHANNEL_ID';
  }

  if (!publicChatId) {
    issues.push({
      code: 'MISSING_PUBLIC_TELEGRAM_CHAT_ID',
      envVar: 'TELEGRAM_CHAT_ID',
      severity: 'ERROR',
      message:
        'No valid Telegram public channel ID is configured (hardcoded fallbacks disabled). Set TELEGRAM_CHAT_ID to your channel -100... ID.',
    });
  }

  // Developer Private Chat ID: canonical TELEGRAM_DEV_CHAT_ID first; never a -100 channel ID or stripped -100 ID
  const canonicalDevId = String(env.TELEGRAM_DEV_CHAT_ID || '').trim();
  const legacyDevId = String(env.DEVELOPER_CHAT_ID || '').trim();

  let devChatId: string | null = null;
  let devChatIdSource: ResolvedTelegramConfig['devChatIdSource'] = null;

  const validateDevCandidate = (
    raw: string,
    envVar: 'TELEGRAM_DEV_CHAT_ID' | 'DEVELOPER_CHAT_ID'
  ): boolean => {
    if (!raw) return false;
    if (isValidTelegramBotToken(raw)) {
      issues.push({
        code: 'DEV_CHAT_ID_IS_BOT_TOKEN',
        envVar,
        severity: 'ERROR',
        message: `${envVar} contains a bot token instead of a private numeric Telegram user ID.`,
      });
      return false;
    }
    if (TELEGRAM_CHANNEL_NUMERIC_ID_RE.test(raw) || raw.startsWith('-')) {
      issues.push({
        code: 'DEV_CHAT_ID_IS_CHANNEL',
        envVar,
        severity: 'ERROR',
        message: `${envVar} contains a negative channel/group ID (-100...) instead of a private numeric user ID. Stream 2 cannot target a public channel.`,
      });
      return false;
    }
    if (!isValidTelegramPrivateUserId(raw)) {
      issues.push({
        code: 'INVALID_DEV_CHAT_ID',
        envVar,
        severity: 'ERROR',
        message: `${envVar} is not a valid positive numeric Telegram user ID.`,
      });
      return false;
    }
    if (publicChatId && raw === publicChatId) {
      issues.push({
        code: 'DEV_CHAT_EQUALS_PUBLIC_CHANNEL',
        envVar,
        severity: 'ERROR',
        message: `${envVar} matches the public channel ID and violates private stream isolation.`,
      });
      return false;
    }
    if (isStrippedChannelIdMatch(raw, publicChatId) || isStrippedChannelIdMatch(raw, legacyChatId)) {
      issues.push({
        code: 'DEV_CHAT_ID_STRIPPED_FROM_CHANNEL',
        envVar,
        severity: 'ERROR',
        message: `${envVar} appears to be the public channel ID with "-100" stripped. Use your real Telegram user ID from @userinfobot or /start.`,
      });
      return false;
    }
    return true;
  };

  if (canonicalDevId && validateDevCandidate(canonicalDevId, 'TELEGRAM_DEV_CHAT_ID')) {
    devChatId = canonicalDevId;
    devChatIdSource = 'TELEGRAM_DEV_CHAT_ID';
  } else if (legacyDevId && validateDevCandidate(legacyDevId, 'DEVELOPER_CHAT_ID')) {
    devChatId = legacyDevId;
    devChatIdSource = 'LEGACY_DEVELOPER_CHAT_ID';
    issues.push({
      code: 'LEGACY_DEV_CHAT_ID_FALLBACK',
      envVar: 'DEVELOPER_CHAT_ID',
      severity: 'WARNING',
      message: 'Using legacy DEVELOPER_CHAT_ID fallback; migrate to TELEGRAM_DEV_CHAT_ID.',
    });
  }

  // Webhook Secret validation: must be independent of bot token & match Telegram [A-Za-z0-9_-] charset
  const rawWebhookSecret = String(env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  let webhookSecret: string | null = null;
  let webhookSecretValid = false;

  if (!rawWebhookSecret) {
    issues.push({
      code: 'MISSING_TELEGRAM_WEBHOOK_SECRET',
      envVar: 'TELEGRAM_WEBHOOK_SECRET',
      severity: 'WARNING',
      message:
        'TELEGRAM_WEBHOOK_SECRET is unset. Inbound /api/telegram/webhook remains locked fail-closed until a random [A-Za-z0-9_-] secret is configured.',
    });
  } else if (
    isValidTelegramBotToken(rawWebhookSecret) ||
    (canonicalToken && rawWebhookSecret === canonicalToken) ||
    (legacyToken && rawWebhookSecret === legacyToken)
  ) {
    issues.push({
      code: 'WEBHOOK_SECRET_EQUALS_BOT_TOKEN',
      envVar: 'TELEGRAM_WEBHOOK_SECRET',
      severity: 'ERROR',
      message:
        'TELEGRAM_WEBHOOK_SECRET must NOT be a Telegram Bot Token (colons are rejected by Telegram setWebhook and reusing the token leaks credentials). Set a separate random 32+ char [A-Za-z0-9_-] secret.',
    });
  } else if (!TELEGRAM_WEBHOOK_SECRET_RE.test(rawWebhookSecret)) {
    issues.push({
      code: 'INVALID_TELEGRAM_WEBHOOK_SECRET_FORMAT',
      envVar: 'TELEGRAM_WEBHOOK_SECRET',
      severity: 'ERROR',
      message:
        'TELEGRAM_WEBHOOK_SECRET must be 16–256 characters using only A-Z, a-z, 0-9, underscore (_), and hyphen (-).',
    });
  } else {
    webhookSecret = rawWebhookSecret;
    webhookSecretValid = true;
  }

  return {
    botToken,
    botTokenSource,
    publicChatId,
    publicChatIdSource,
    publicChannelHandle: normalizedChannel.handle,
    devChatId,
    devChatIdSource,
    webhookSecret,
    webhookSecretValid,
    botTokenValid: Boolean(botToken),
    publicChatIdValid: Boolean(publicChatId),
    devChatIdValid: Boolean(devChatId),
    legacyShadowConflict,
    issues,
  };
}

export function resolveMakeWebhookConfig(
  env: Record<string, string | undefined>
): ResolvedMakeWebhookConfig {
  const issues: ConfigIssue[] = [];
  const raw = String(env.MAKE_WEBHOOK_URL || '');
  const trimmed = raw.trim();

  if (!trimmed) {
    return {
      webhookUrl: null,
      maskedUrl: 'Not configured',
      host: null,
      valid: false,
      configured: false,
      issues: [
        {
          code: 'MISSING_MAKE_WEBHOOK_URL',
          envVar: 'MAKE_WEBHOOK_URL',
          severity: 'WARNING',
          message: 'MAKE_WEBHOOK_URL is not configured in server Secrets.',
        },
      ],
    };
  }

  if (/\s/.test(trimmed)) {
    issues.push({
      code: 'MAKE_WEBHOOK_URL_WHITESPACE',
      envVar: 'MAKE_WEBHOOK_URL',
      severity: 'ERROR',
      message: 'MAKE_WEBHOOK_URL contains invalid whitespace characters.',
    });
    return {
      webhookUrl: null,
      maskedUrl: 'Malformed URL (redacted)',
      host: null,
      valid: false,
      configured: true,
      issues,
    };
  }

  try {
    const parsed = new URL(trimmed);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const isHttps = parsed.protocol === 'https:';
    const isMakeHost = MAKE_WEBHOOK_HOST_RE.test(parsed.hostname);
    const validPath = segments.length === 1 && MAKE_WEBHOOK_TOKEN_RE.test(segments[0]);

    if (!isHttps) {
      issues.push({
        code: 'MAKE_WEBHOOK_NON_HTTPS',
        envVar: 'MAKE_WEBHOOK_URL',
        severity: 'ERROR',
        message: 'MAKE_WEBHOOK_URL must use HTTPS.',
      });
    }
    if (!isMakeHost) {
      issues.push({
        code: 'MAKE_WEBHOOK_INVALID_HOST',
        envVar: 'MAKE_WEBHOOK_URL',
        severity: 'ERROR',
        message: `MAKE_WEBHOOK_URL host "${parsed.hostname}" is not a recognized Make.com webhook domain (expected hook.<region>.make.com).`,
      });
    }
    if (!validPath) {
      issues.push({
        code: 'MAKE_WEBHOOK_INVALID_PATH',
        envVar: 'MAKE_WEBHOOK_URL',
        severity: 'ERROR',
        message:
          'MAKE_WEBHOOK_URL path does not match an active Make.com Custom Webhook token format (check for stray trailing punctuation or invalid characters).',
      });
    }
    if (parsed.pathname.endsWith('/')) {
      issues.push({
        code: 'MAKE_WEBHOOK_TRAILING_SLASH',
        envVar: 'MAKE_WEBHOOK_URL',
        severity: 'WARNING',
        message: 'MAKE_WEBHOOK_URL has a trailing slash which can trigger HTTP 404 on Make.com.',
      });
    }

    const valid = isHttps && isMakeHost && validPath && !parsed.pathname.endsWith('/');
    return {
      webhookUrl: valid ? trimmed : null,
      maskedUrl: maskSecretUrl(trimmed),
      host: parsed.hostname,
      valid,
      configured: true,
      issues,
    };
  } catch {
    return {
      webhookUrl: null,
      maskedUrl: 'Malformed URL (redacted)',
      host: null,
      valid: false,
      configured: true,
      issues: [
        {
          code: 'MAKE_WEBHOOK_MALFORMED_URL',
          envVar: 'MAKE_WEBHOOK_URL',
          severity: 'ERROR',
          message: 'MAKE_WEBHOOK_URL could not be parsed as a valid HTTPS URL.',
        },
      ],
    };
  }
}

export function resolveDiscordWebhookConfig(
  env: Record<string, string | undefined>
): ResolvedDiscordConfig {
  const issues: ConfigIssue[] = [];
  const raw = String(env.DISCORD_WEBHOOK_URL || '').trim();
  const botTokenConfiguredUnused = Boolean(String(env.DISCORD_BOT_TOKEN || '').trim());
  const channelIdConfiguredUnused = Boolean(String(env.DISCORD_CHANNEL_ID || '').trim());

  if (!raw) {
    issues.push({
      code: 'MISSING_DISCORD_WEBHOOK_URL',
      envVar: 'DISCORD_WEBHOOK_URL',
      severity: 'WARNING',
      message: 'DISCORD_WEBHOOK_URL is not configured in server Secrets.',
    });
    return {
      webhookUrl: null,
      maskedUrl: 'Not configured',
      valid: false,
      configured: false,
      botTokenConfiguredUnused,
      channelIdConfiguredUnused,
      issues,
    };
  }

  if (!DISCORD_WEBHOOK_URL_RE.test(raw)) {
    issues.push({
      code: 'INVALID_DISCORD_WEBHOOK_URL',
      envVar: 'DISCORD_WEBHOOK_URL',
      severity: 'ERROR',
      message:
        'DISCORD_WEBHOOK_URL does not match official Discord webhook format (https://discord.com/api/webhooks/<id>/<token>).',
    });
    return {
      webhookUrl: null,
      maskedUrl: 'Malformed URL (redacted)',
      valid: false,
      configured: true,
      botTokenConfiguredUnused,
      channelIdConfiguredUnused,
      issues,
    };
  }

  return {
    webhookUrl: raw,
    maskedUrl: maskSecretUrl(raw),
    valid: true,
    configured: true,
    botTokenConfiguredUnused,
    channelIdConfiguredUnused,
    issues,
  };
}

export function appendDiscordWaitQuery(webhookUrl: string): string {
  const parsed = new URL(webhookUrl);
  parsed.searchParams.set('wait', 'true');
  return parsed.toString();
}

export function sanitizeNotificationError(
  rawError: string | null | undefined,
  secretsToRedact: readonly (string | null | undefined)[] = []
): string | null {
  if (!rawError) return null;
  let safe = String(rawError);
  for (const secret of secretsToRedact) {
    const clean = String(secret || '').trim();
    if (clean.length >= 8) {
      safe = safe.split(clean).join('[REDACTED]');
    }
  }
  // Redact any embedded bot token or webhook URL patterns defensively
  safe = safe
    .replace(/bot\d{6,15}:[A-Za-z0-9_-]{16,}/gi, 'bot[REDACTED]')
    .replace(/\b\d{6,15}:[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_TOKEN]')
    .replace(/https:\/\/hook(?:\.[a-z0-9-]+)?\.(?:make|integromat)\.com\/[^\s"']+/gi, '[REDACTED_MAKE_WEBHOOK]')
    .replace(/https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/[^\s"']+/gi, '[REDACTED_DISCORD_WEBHOOK]');
  return safe.slice(0, 320);
}

export function validatePersistedSignalPayload(
  payload: unknown
): { ok: true; payload: PersistedSignalPayload } | { ok: false; error: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Signal payload is missing or not an object.' };
  }
  const p = payload as Partial<PersistedSignalPayload>;
  if (!p.signalId || typeof p.signalId !== 'string' || !p.signalId.trim()) {
    return { ok: false, error: 'Missing required signalId.' };
  }
  if (!p.symbol || typeof p.symbol !== 'string' || !p.symbol.trim()) {
    return { ok: false, error: 'Missing required symbol.' };
  }
  if (p.direction !== 'BUY' && p.direction !== 'SELL') {
    return { ok: false, error: 'Invalid direction (must be BUY or SELL).' };
  }
  if (!p.timeframe || typeof p.timeframe !== 'string') {
    return { ok: false, error: 'Missing required timeframe.' };
  }
  if (typeof p.entryPrice !== 'number' || !Number.isFinite(p.entryPrice) || p.entryPrice <= 0) {
    return { ok: false, error: 'Invalid entryPrice (must be > 0; never fabricated as 0).' };
  }
  if (typeof p.stopLoss !== 'number' || !Number.isFinite(p.stopLoss) || p.stopLoss <= 0) {
    return { ok: false, error: 'Invalid stopLoss (must be > 0; never fabricated as 0).' };
  }
  if (
    !Array.isArray(p.takeProfits) ||
    p.takeProfits.length !== 3 ||
    p.takeProfits.some((tp) => typeof tp !== 'number' || !Number.isFinite(tp) || tp <= 0)
  ) {
    return { ok: false, error: 'Invalid takeProfits [tp1, tp2, tp3] (all targets must be > 0).' };
  }
  if (typeof p.exitPrice !== 'number' || !Number.isFinite(p.exitPrice) || p.exitPrice <= 0) {
    return { ok: false, error: 'Invalid exitPrice (must be > 0).' };
  }
  if (typeof p.confidence !== 'number' || !Number.isFinite(p.confidence) || p.confidence <= 0) {
    return { ok: false, error: 'Invalid confidence score.' };
  }
  if (!p.formattedCard || typeof p.formattedCard !== 'string' || !p.formattedCard.trim()) {
    return { ok: false, error: 'Missing formattedCard text.' };
  }
  if (!p.timestamp || typeof p.timestamp !== 'string') {
    return { ok: false, error: 'Missing timestamp.' };
  }
  return {
    ok: true,
    payload: {
      signalId: p.signalId.trim(),
      eventId: String(p.eventId || `${p.signalId}:${p.eventType || 'SIGNAL_CARD'}`).trim(),
      eventType: p.eventType === 'MILESTONE_PNL_UPDATE' ? 'MILESTONE_PNL_UPDATE' : 'SIGNAL_CARD',
      source: p.source === 'MANUAL' ? 'MANUAL' : 'AUTOMATED',
      signalCategory:
        p.signalCategory === 'PAPER_EXECUTED_TRADE' || p.signalCategory === 'REALIZED_RESULT'
          ? p.signalCategory
          : 'GENERATED_SIGNAL',
      executionMode: String(p.executionMode || 'SIGNAL_ONLY'),
      symbol: p.symbol.trim().toUpperCase(),
      direction: p.direction,
      timeframe: p.timeframe.trim(),
      entryPrice: p.entryPrice,
      takeProfits: [p.takeProfits[0], p.takeProfits[1], p.takeProfits[2]],
      exitPrice: p.exitPrice,
      stopLoss: p.stopLoss,
      riskRewardRatio:
        typeof p.riskRewardRatio === 'number' && Number.isFinite(p.riskRewardRatio)
          ? p.riskRewardRatio
          : 0,
      confidence: Math.max(1, Math.min(100, Math.round(p.confidence))),
      hitTpMilestones: Array.isArray(p.hitTpMilestones) ? p.hitTpMilestones : [],
      finalPnlUsd:
        typeof p.finalPnlUsd === 'number' && Number.isFinite(p.finalPnlUsd) ? p.finalPnlUsd : null,
      finalPnlPercent:
        typeof p.finalPnlPercent === 'number' && Number.isFinite(p.finalPnlPercent)
          ? p.finalPnlPercent
          : null,
      lifecycleStatus: p.lifecycleStatus || 'OPEN',
      rationale: String(p.rationale || '').trim(),
      formattedCard: p.formattedCard,
      targetChatId:
        typeof p.targetChatId === 'string' && isValidTelegramPublicChatId(p.targetChatId)
          ? p.targetChatId.trim()
          : null,
      channelName: String(p.channelName || 'Signal Forge'),
      timestamp: p.timestamp,
    },
  };
}

export function createPersistedSignalPayload(params: {
  card: ExtractedTradingSignalCard;
  targetChatId: string | null;
  channelName?: string;
  signalCategory?: SignalNotificationCategory;
  executionMode?: string;
}): PersistedSignalPayload {
  const isMilestone =
    params.card.hitTpMilestones.length > 0 ||
    params.card.lifecycleStatus !== 'OPEN' ||
    params.card.finalPnlUsd !== null ||
    params.card.finalPnlPercent !== null;
  const eventType: PersistedSignalPayload['eventType'] = isMilestone
    ? 'MILESTONE_PNL_UPDATE'
    : 'SIGNAL_CARD';
  const inferredCategory: SignalNotificationCategory =
    params.signalCategory ??
    (params.card.finalPnlUsd !== null ||
    params.card.lifecycleStatus === 'CLOSED_TP' ||
    params.card.lifecycleStatus === 'CLOSED_SL' ||
    params.card.lifecycleStatus === 'CLOSED_MANUAL'
      ? 'REALIZED_RESULT'
      : 'GENERATED_SIGNAL');

  const safeChatId =
    params.targetChatId && isValidTelegramPublicChatId(params.targetChatId)
      ? params.targetChatId.trim()
      : null;

  return {
    signalId: params.card.signalId,
    eventId: `${params.card.signalId}::${eventType}::${params.card.lifecycleStatus}`,
    eventType,
    source: params.card.source,
    signalCategory: inferredCategory,
    executionMode: params.executionMode || 'PAPER_DRY_RUN',
    symbol: params.card.symbol,
    direction: params.card.direction,
    timeframe: params.card.timeframe,
    entryPrice: params.card.entryPrice,
    takeProfits: params.card.takeProfits,
    exitPrice: params.card.exitPrice,
    stopLoss: params.card.stopLoss,
    riskRewardRatio: params.card.riskRewardRatio,
    confidence: params.card.confidence,
    hitTpMilestones: params.card.hitTpMilestones,
    finalPnlUsd: params.card.finalPnlUsd,
    finalPnlPercent: params.card.finalPnlPercent,
    lifecycleStatus: params.card.lifecycleStatus,
    rationale: params.card.rationale,
    formattedCard: params.card.formattedCard,
    targetChatId: safeChatId,
    channelName: params.channelName || 'Signal Forge',
    timestamp: params.card.createdAt,
  };
}

/**
 * Secret-free Make.com outbound webhook payload.
 * Never embeds bot_token or any server credential.
 */
export function buildSecretFreeMakePayload(
  payload: PersistedSignalPayload
): SecretFreeMakeWebhookPayload {
  const base: SecretFreeMakeWebhookPayload = {
    signal_id: payload.signalId,
    event_id: payload.eventId,
    event_type: payload.eventType,
    signal_category: payload.signalCategory,
    execution_mode: payload.executionMode,
    channel_name: payload.channelName,
    ...(payload.targetChatId ? { chat_id: payload.targetChatId } : {}),
    source: payload.source,
    symbol: payload.symbol,
    pair: payload.symbol,
    direction: payload.direction,
    timeframe: payload.timeframe,
    entry_price: payload.entryPrice,
    take_profits: {
      tp1: payload.takeProfits[0],
      tp2: payload.takeProfits[1],
      tp3: payload.takeProfits[2],
    },
    exit_price: payload.exitPrice,
    stop_loss: payload.stopLoss,
    risk_reward_ratio: payload.riskRewardRatio,
    confidence_score: payload.confidence,
    hit_tp_milestones: payload.hitTpMilestones,
    final_pnl_usd: payload.finalPnlUsd,
    final_pnl_percent: payload.finalPnlPercent,
    lifecycle_status: payload.lifecycleStatus,
    signal_card: payload.formattedCard,
    text: payload.formattedCard,
    timestamp: payload.timestamp,
  };
  return base;
}

export function formatSignalCategoryLabel(category: SignalNotificationCategory): string {
  switch (category) {
    case 'PAPER_EXECUTED_TRADE':
      return 'PAPER EXECUTED TRADE (SIMULATED)';
    case 'REALIZED_RESULT':
      return 'REALIZED RESULT (RECORDED)';
    default:
      return 'GENERATED SIGNAL (UNEXECUTED)';
  }
}

export function buildDiscordSignalPayload(payload: PersistedSignalPayload): DiscordWebhookPayload {
  const sideLabel = payload.direction === 'SELL' ? 'SHORT / SELL' : 'LONG / BUY';
  const categoryLabel = formatSignalCategoryLabel(payload.signalCategory);
  const color =
    payload.signalCategory === 'REALIZED_RESULT'
      ? (payload.finalPnlUsd ?? 0) >= 0
        ? 0x10b981
        : 0xf43f5e
      : payload.direction === 'BUY'
      ? 0x22c55e
      : 0xef4444;

  const pnlValue =
    payload.signalCategory === 'REALIZED_RESULT'
      ? [
          payload.finalPnlUsd !== null
            ? `${payload.finalPnlUsd >= 0 ? '+' : '-'}$${Math.abs(payload.finalPnlUsd).toFixed(2)}`
            : null,
          payload.finalPnlPercent !== null
            ? `${payload.finalPnlPercent >= 0 ? '+' : ''}${payload.finalPnlPercent.toFixed(2)}%`
            : null,
        ]
          .filter(Boolean)
          .join(' / ') || 'Closed (No P&L Recorded)'
      : 'Not Realized (Signal / Open State)';

  const milestonesValue =
    payload.hitTpMilestones.length > 0
      ? payload.hitTpMilestones.map((m) => `${m} HIT`).join(' · ')
      : 'Pending Targets';

  const summaryLine = `[SIGNAL FORGE · ${categoryLabel}] ${payload.symbol} ${sideLabel} (${payload.timeframe}) · ID: ${payload.signalId}`;

  return {
    username: 'Signal Forge Signal Router',
    content: summaryLine.slice(0, 1900),
    embeds: [
      {
        title: `${payload.symbol} · ${sideLabel} (${payload.timeframe})`,
        description: `${categoryLabel}${payload.rationale ? `\n${payload.rationale.slice(0, 220)}` : ''}`,
        color,
        timestamp: payload.timestamp,
        fields: [
          { name: 'Signal ID', value: `\`${payload.signalId}\``, inline: true },
          { name: 'Status', value: `${payload.lifecycleStatus}`, inline: true },
          { name: 'Execution Mode', value: `${payload.executionMode}`, inline: true },
          { name: 'Entry Price', value: `$${formatAlertPrice(payload.entryPrice)}`, inline: true },
          { name: 'Stop Loss', value: `$${formatAlertPrice(payload.stopLoss)}`, inline: true },
          {
            name: 'Risk / Reward',
            value: payload.riskRewardRatio > 0 ? `1:${payload.riskRewardRatio}` : 'N/A',
            inline: true,
          },
          { name: 'TP1', value: `$${formatAlertPrice(payload.takeProfits[0])}`, inline: true },
          { name: 'TP2', value: `$${formatAlertPrice(payload.takeProfits[1])}`, inline: true },
          { name: 'TP3', value: `$${formatAlertPrice(payload.takeProfits[2])}`, inline: true },
          { name: 'Confidence', value: `${payload.confidence}%`, inline: true },
          { name: 'Milestones', value: milestonesValue, inline: true },
          { name: 'Result / P&L', value: pnlValue, inline: true },
        ],
        footer: {
          text: `Signal Forge · ${payload.eventType} · ${categoryLabel}`,
        },
      },
    ],
  };
}

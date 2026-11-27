import { computeRiskRewardRatio, formatAlertPrice } from './telegramStreams';

export type SignalAlertSource = 'AUTOMATED' | 'MANUAL';
export type TpMilestone = 'TP1' | 'TP2' | 'TP3';
export type SignalLifecycleStatus =
  | 'OPEN'
  | 'TP1_HIT'
  | 'TP2_HIT'
  | 'TP3_HIT'
  | 'CLOSED_TP'
  | 'CLOSED_SL'
  | 'CLOSED_MANUAL';

export interface IncomingTradingAlertInput {
  source?: SignalAlertSource;
  rawAlertText?: string;
  symbol?: string;
  direction?: 'BUY' | 'SELL' | 'LONG' | 'SHORT';
  timeframe?: string;
  entryPrice?: number;
  takeProfits?: number[];
  tp1?: number;
  tp2?: number;
  tp3?: number;
  exitPrice?: number;
  stopLoss?: number;
  confidence?: number;
  rationale?: string;
  hitTpMilestones?: TpMilestone[];
  finalPnlUsd?: number | null;
  finalPnlPercent?: number | null;
  lifecycleStatus?: SignalLifecycleStatus;
}

export interface ExtractedTradingSignalCard {
  signalId: string;
  source: SignalAlertSource;
  symbol: string;
  direction: 'BUY' | 'SELL';
  timeframe: string;
  entryPrice: number;
  takeProfits: [number, number, number];
  exitPrice: number;
  stopLoss: number;
  confidence: number;
  riskRewardRatio: number;
  hitTpMilestones: TpMilestone[];
  finalPnlUsd: number | null;
  finalPnlPercent: number | null;
  lifecycleStatus: SignalLifecycleStatus;
  rationale: string;
  formattedCard: string;
  fingerprint: string;
  createdAt: string;
}

export type SpamFilterReasonCode =
  | 'ALLOWED'
  | 'MILESTONE_UPDATE_ALLOWED'
  | 'DUPLICATE_NEAR_INSTANT'
  | 'DUPLICATE_FINGERPRINT'
  | 'CHANNEL_FLOOD_LIMIT';

export interface SpamFilterVerdict {
  allowed: boolean;
  reasonCode: SpamFilterReasonCode;
  reason: string;
  fingerprint: string;
  cooldownRemainingSec: number;
}

export interface SpamFilterConfig {
  nearInstantCooldownMs: number;
  fingerprintTtlMs: number;
  floodWindowMs: number;
  maxSignalsPerFloodWindow: number;
}

export const DEFAULT_SPAM_FILTER_CONFIG: SpamFilterConfig = {
  nearInstantCooldownMs: 3 * 60 * 1000, // 3 minutes per symbol+direction for new alerts
  fingerprintTtlMs: 15 * 60 * 1000, // 15 minutes per identical parameter fingerprint
  floodWindowMs: 5 * 60 * 1000, // 5 minute rolling channel window
  maxSignalsPerFloodWindow: 12,
};

export interface SpamFilterHistoryEntry {
  signalId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  fingerprint: string;
  lifecycleStatus: SignalLifecycleStatus;
  hitTpMilestones: TpMilestone[];
  timestampMs: number;
}

export interface ProcessedSignalRecord extends ExtractedTradingSignalCard {
  filteredOut: boolean;
  suppressed?: boolean;
  suppressionReason?: string | null;
  spamVerdict: SpamFilterVerdict;
  targetChatId: string;
  deliveryState?:
    | 'SIGNAL_GENERATED'
    | 'SIGNAL_APPROVED'
    | 'QUEUED'
    | 'DISPATCH_ATTEMPTED'
    | 'PROVIDER_ACCEPTED'
    | 'DELIVERED_WHEN_VERIFIABLE'
    | 'FAILED'
    | 'RETRYING'
    | 'SUPPRESSED';
  providerMessageId?: string | null;
  webhookDispatched: boolean;
  webhookHttpStatus: number | null;
  webhookLatencyMs: number | null;
  webhookError: string | null;
  telegramMirrorDelivered: boolean;
  discordDispatched?: boolean;
  discordMessageId?: string | null;
  discordError?: string | null;
  transmittedAt: string | null;
}

export interface SignalProcessorStatusSnapshot {
  ok: boolean;
  webhookConfigured: boolean;
  maskedWebhookUrl: string;
  targetChatId: string;
  maskedBotToken: string;
  spamFilterConfig: SpamFilterConfig;
  stats: {
    totalReceived: number;
    totalTransmitted: number;
    totalSpamFiltered: number;
    totalWebhookDelivered: number;
    totalMilestoneUpdates: number;
    totalSuppressed?: number;
    totalFailed?: number;
    totalRetrying?: number;
    totalDiscordDelivered?: number;
  };
  lifecycleCounters?: {
    signalGenerated: number;
    signalApproved: number;
    queued: number;
    dispatchAttempted: number;
    providerAccepted: number;
    deliveredWhenVerifiable: number;
    failed: number;
    retrying: number;
    suppressed: number;
  };
  advisories?: string[];
  recentProcessed: ProcessedSignalRecord[];
  recentFiltered: ProcessedSignalRecord[];
}

export function maskWebhookUrl(url?: string | null): string {
  const clean = String(url || '').trim();
  if (!clean) return 'Not configured';
  try {
    const parsed = new URL(clean);
    const segs = parsed.pathname.split('/').filter(Boolean);
    if (segs.length === 0) return `${parsed.origin}/`;
    const last = segs[segs.length - 1];
    const maskedLast =
      last.length > 8 ? `${last.slice(0, 4)}...${last.slice(-4)}` : '****';
    const prefix = segs.slice(0, -1).join('/');
    return `${parsed.origin}/${prefix ? `${prefix}/` : ''}${maskedLast}`;
  } catch {
    return clean.length > 16 ? `${clean.slice(0, 12)}...${clean.slice(-4)}` : '****';
  }
}

function parseNumericToken(raw?: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, '');
  const val = Number(cleaned);
  return Number.isFinite(val) && val > 0 ? val : null;
}

function normalizeSymbol(raw?: string | null): string {
  const clean = String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!clean) return 'BTCUSDT';
  if (clean.endsWith('USDT') || clean.endsWith('USD') || clean.endsWith('BTC')) {
    return clean;
  }
  return `${clean}USDT`;
}

function normalizeMilestones(input?: TpMilestone[] | null): TpMilestone[] {
  if (!Array.isArray(input)) return [];
  const valid: TpMilestone[] = [];
  for (const m of ['TP1', 'TP2', 'TP3'] as const) {
    if (input.includes(m)) valid.push(m);
  }
  return valid;
}

function roundPriceSig(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return '0';
  if (price >= 1000) return price.toFixed(1);
  if (price >= 1) return price.toFixed(3);
  return price.toFixed(5);
}

export function computeSignalFingerprint(params: {
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  hitTpMilestones: TpMilestone[];
  lifecycleStatus: SignalLifecycleStatus;
}): string {
  const parts = [
    params.symbol.toUpperCase(),
    params.direction,
    roundPriceSig(params.entryPrice),
    roundPriceSig(params.stopLoss),
    roundPriceSig(params.tp1),
    params.hitTpMilestones.join(',') || 'NONE',
    params.lifecycleStatus,
  ];
  return parts.join('|');
}

export function extractTradingAlertParams(
  input: IncomingTradingAlertInput,
  fallbackPrice = 0,
  nowIso = new Date().toISOString()
): { ok: true; card: ExtractedTradingSignalCard } | { ok: false; error: string } {
  const rawText = String(input.rawAlertText || '').trim();
  const source: SignalAlertSource =
    input.source === 'MANUAL' || (!input.source && rawText.length > 0) ? 'MANUAL' : 'AUTOMATED';

  // Extract symbol from explicit field or raw text (e.g. BTCUSDT, BTC/USDT, #ETHUSDT)
  let symbolRaw = input.symbol;
  if (!symbolRaw && rawText) {
    const pairMatch =
      rawText.match(/\b([A-Z]{2,10})\/?(USDT|USD|USDC)\b/i) ||
      rawText.match(/#([A-Z]{2,10})(?:USDT)?\b/i);
    if (pairMatch) {
      symbolRaw = `${pairMatch[1]}${pairMatch[2] || 'USDT'}`;
    }
  }
  const symbol = normalizeSymbol(symbolRaw);

  // Extract direction
  let direction: 'BUY' | 'SELL' = 'BUY';
  if (input.direction) {
    const d = String(input.direction).toUpperCase();
    direction = d === 'SELL' || d === 'SHORT' ? 'SELL' : 'BUY';
  } else if (rawText) {
    if (/\b(SHORT|SELL)\b/i.test(rawText) && !/\b(LONG|BUY)\b/i.test(rawText)) {
      direction = 'SELL';
    } else if (/\b(SHORT|SELL)\b/i.test(rawText) && /\b(LONG|BUY)\b/i.test(rawText)) {
      const sellIdx = rawText.search(/\b(SHORT|SELL)\b/i);
      const buyIdx = rawText.search(/\b(LONG|BUY)\b/i);
      direction = sellIdx < buyIdx ? 'SELL' : 'BUY';
    }
  }

  // Extract timeframe
  let timeframe = input.timeframe || '';
  if (!timeframe && rawText) {
    const tfMatch = rawText.match(/\b(1m|5m|15m|30m|1h|2h|4h|6h|12h|1d|1w)\b/i);
    if (tfMatch) timeframe = tfMatch[1].toLowerCase();
  }
  if (!timeframe) timeframe = '4h';

  // Extract Entry Price
  let entryPrice = Number(input.entryPrice || 0);
  if ((!Number.isFinite(entryPrice) || entryPrice <= 0) && rawText) {
    const entryMatch = rawText.match(
      /(?:entry(?:\s*price)?|ep|buy\s*at|sell\s*at|price)\s*[:=@]?\s*\$?([\d,]+(?:\.\d+)?)/i
    );
    entryPrice = parseNumericToken(entryMatch?.[1]) ?? 0;
  }
  if ((!Number.isFinite(entryPrice) || entryPrice <= 0) && fallbackPrice > 0) {
    entryPrice = fallbackPrice;
  }
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return {
      ok: false,
      error: 'Could not extract a valid positive Entry Price from the incoming alert.',
    };
  }

  // Extract Stop Loss
  let stopLoss = Number(input.stopLoss || 0);
  if ((!Number.isFinite(stopLoss) || stopLoss <= 0) && rawText) {
    const slMatch = rawText.match(
      /(?:stop[\s-]*loss|sl|invalidation)\s*[:=@]?\s*\$?([\d,]+(?:\.\d+)?)/i
    );
    stopLoss = parseNumericToken(slMatch?.[1]) ?? 0;
  }
  if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
    stopLoss =
      direction === 'BUY'
        ? Number((entryPrice * 0.982).toFixed(4))
        : Number((entryPrice * 1.018).toFixed(4));
  }

  // Extract Take Profit levels (TP1, TP2, TP3 or single TP/Exit)
  let tp1 = Number(input.tp1 || input.takeProfits?.[0] || 0);
  let tp2 = Number(input.tp2 || input.takeProfits?.[1] || 0);
  let tp3 = Number(input.tp3 || input.takeProfits?.[2] || input.exitPrice || 0);

  if (rawText) {
    if (tp1 <= 0) {
      const m1 = rawText.match(/\btp\s*1\s*[:=@]?\s*\$?([\d,]+(?:\.\d+)?)/i);
      tp1 = parseNumericToken(m1?.[1]) ?? 0;
    }
    if (tp2 <= 0) {
      const m2 = rawText.match(/\btp\s*2\s*[:=@]?\s*\$?([\d,]+(?:\.\d+)?)/i);
      tp2 = parseNumericToken(m2?.[1]) ?? 0;
    }
    if (tp3 <= 0) {
      const m3 = rawText.match(/\btp\s*3\s*[:=@]?\s*\$?([\d,]+(?:\.\d+)?)/i);
      tp3 = parseNumericToken(m3?.[1]) ?? 0;
    }
    if (tp1 <= 0 && tp2 <= 0 && tp3 <= 0) {
      const mSingle = rawText.match(
        /(?:take[\s-]*profit|exit(?:\s*price)?|target|tp)\s*[:=@]?\s*\$?([\d,]+(?:\.\d+)?)/i
      );
      const singleTp = parseNumericToken(mSingle?.[1]) ?? 0;
      if (singleTp > 0) {
        tp3 = singleTp;
      }
    }
  }

  const riskDist = Math.max(Math.abs(entryPrice - stopLoss), entryPrice * 0.005);
  const sign = direction === 'BUY' ? 1 : -1;
  if (tp3 <= 0) {
    tp3 = Number((entryPrice + sign * riskDist * 5).toFixed(4));
  }
  if (tp1 <= 0) {
    tp1 = Number((entryPrice + (tp3 - entryPrice) * 0.4).toFixed(4));
  }
  if (tp2 <= 0) {
    tp2 = Number((entryPrice + (tp3 - entryPrice) * 0.7).toFixed(4));
  }

  const takeProfits: [number, number, number] = [
    Number(tp1.toFixed(4)),
    Number(tp2.toFixed(4)),
    Number(tp3.toFixed(4)),
  ];
  const exitPrice =
    Number(input.exitPrice) > 0 ? Number(input.exitPrice) : takeProfits[2];

  // Extract Confidence Score
  let confidence = Number(input.confidence || 0);
  if ((!Number.isFinite(confidence) || confidence <= 0) && rawText) {
    const confMatch = rawText.match(
      /(?:confidence|conf|score)\s*[:=@]?\s*(\d{1,3}(?:\.\d+)?)\s*%?/i
    );
    if (confMatch) confidence = Number(confMatch[1]);
  }
  if (!Number.isFinite(confidence) || confidence <= 0) confidence = 88;
  confidence = Math.max(1, Math.min(100, Math.round(confidence)));

  // Extract Hit TP Milestones
  const hitSet = new Set<TpMilestone>(normalizeMilestones(input.hitTpMilestones));
  if (rawText) {
    if (/(?:hit|reached|smashed|achieved)[^.\n]*tp\s*1|tp\s*1\s*(?:hit|✓|✅)/i.test(rawText)) {
      hitSet.add('TP1');
    }
    if (/(?:hit|reached|smashed|achieved)[^.\n]*tp\s*2|tp\s*2\s*(?:hit|✓|✅)/i.test(rawText)) {
      hitSet.add('TP2');
    }
    if (/(?:hit|reached|smashed|achieved)[^.\n]*tp\s*3|tp\s*3\s*(?:hit|✓|✅)/i.test(rawText)) {
      hitSet.add('TP3');
    }
  }
  const hitTpMilestones = normalizeMilestones(Array.from(hitSet));

  // Extract Final P&L (USD and/or %)
  let finalPnlPercent: number | null =
    typeof input.finalPnlPercent === 'number' && Number.isFinite(input.finalPnlPercent)
      ? Number(input.finalPnlPercent.toFixed(2))
      : null;
  let finalPnlUsd: number | null =
    typeof input.finalPnlUsd === 'number' && Number.isFinite(input.finalPnlUsd)
      ? Number(input.finalPnlUsd.toFixed(2))
      : null;

  if (rawText) {
    if (finalPnlPercent === null) {
      const pctMatch =
        rawText.match(
          /(?:p&l|pnl|profit|roe)\s*[:=@]?\s*[+-]?\$[\d,]+(?:\.\d+)?\s*[(/|]?\s*([+-]?\d+(?:\.\d+)?)\s*%/i
        ) ||
        rawText.match(/(?:p&l|pnl|profit|roe)\s*[:=@]?\s*([+-]?\d+(?:\.\d+)?)\s*%/i);
      if (pctMatch) finalPnlPercent = Number(Number(pctMatch[1]).toFixed(2));
    }
    if (finalPnlUsd === null) {
      const usdMatch = rawText.match(/(?:p&l|pnl|profit)\s*[:=@]?\s*([+-]?)\$\s*([\d,]+(?:\.\d+)?)/i);
      if (usdMatch) {
        const val = parseNumericToken(usdMatch[2]);
        if (val !== null) {
          finalPnlUsd = Number((usdMatch[1] === '-' ? -val : val).toFixed(2));
        }
      }
    }
  }

  let lifecycleStatus: SignalLifecycleStatus = input.lifecycleStatus || 'OPEN';
  if (!input.lifecycleStatus) {
    if (hitTpMilestones.includes('TP3')) lifecycleStatus = 'TP3_HIT';
    else if (hitTpMilestones.includes('TP2')) lifecycleStatus = 'TP2_HIT';
    else if (hitTpMilestones.includes('TP1')) lifecycleStatus = 'TP1_HIT';
    else if (finalPnlPercent !== null && finalPnlPercent < 0 && /sl\s*hit|stopped/i.test(rawText)) {
      lifecycleStatus = 'CLOSED_SL';
    }
  }

  const riskRewardRatio = computeRiskRewardRatio(direction, entryPrice, exitPrice, stopLoss);
  const rationale = String(
    input.rationale ||
      (rawText ? rawText.replace(/\s+/g, ' ').slice(0, 160) : 'Signal Forge Automated Processor')
  ).trim();

  const fingerprint = computeSignalFingerprint({
    symbol,
    direction,
    entryPrice,
    stopLoss,
    tp1: takeProfits[0],
    hitTpMilestones,
    lifecycleStatus,
  });

  const signalId = `sigcard_${symbol}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const partialCard: Omit<ExtractedTradingSignalCard, 'formattedCard'> = {
    signalId,
    source,
    symbol,
    direction,
    timeframe,
    entryPrice,
    takeProfits,
    exitPrice,
    stopLoss,
    confidence,
    riskRewardRatio,
    hitTpMilestones,
    finalPnlUsd,
    finalPnlPercent,
    lifecycleStatus,
    rationale,
    fingerprint,
    createdAt: nowIso,
  };

  return {
    ok: true,
    card: {
      ...partialCard,
      formattedCard: formatStructuredSignalCard(partialCard),
    },
  };
}

export function formatStructuredSignalCard(
  card: Omit<ExtractedTradingSignalCard, 'formattedCard'>
): string {
  const sideLabel = card.direction === 'SELL' ? 'SHORT / SELL' : 'LONG / BUY';
  const milestoneText =
    card.hitTpMilestones.length > 0
      ? card.hitTpMilestones.map((m) => `${m} HIT`).join(' · ')
      : 'Pending Targets';

  const pnlParts: string[] = [];
  if (card.finalPnlUsd !== null) {
    pnlParts.push(
      `${card.finalPnlUsd >= 0 ? '+' : '-'}$${Math.abs(card.finalPnlUsd).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    );
  }
  if (card.finalPnlPercent !== null) {
    pnlParts.push(`${card.finalPnlPercent >= 0 ? '+' : ''}${card.finalPnlPercent.toFixed(2)}%`);
  }
  const pnlText = pnlParts.length > 0 ? pnlParts.join(' / ') : 'Open Position (Pending Close)';

  const lines = [
    `[SIGNAL FORGE · ${card.source} SIGNAL CARD]`,
    `Pair: ${card.symbol} (${card.timeframe}) · ${sideLabel}`,
    `Status: ${card.lifecycleStatus} · Confidence: ${card.confidence}%${
      card.riskRewardRatio > 0 ? ` · R:R 1:${card.riskRewardRatio}` : ''
    }`,
    `Entry Price: $${formatAlertPrice(card.entryPrice)}`,
    `Take Profit Targets: TP1 $${formatAlertPrice(card.takeProfits[0])} | TP2 $${formatAlertPrice(
      card.takeProfits[1]
    )} | TP3 $${formatAlertPrice(card.takeProfits[2])}`,
    `Stop Loss: $${formatAlertPrice(card.stopLoss)}`,
    `Hit TP Milestones: ${milestoneText}`,
    `Final P&L: ${pnlText}`,
  ];
  if (card.rationale) {
    lines.push(`Notes: ${card.rationale.slice(0, 160)}`);
  }
  return lines.join('\n');
}

export function evaluateSignalSpamFilter(
  card: Pick<
    ExtractedTradingSignalCard,
    'symbol' | 'direction' | 'fingerprint' | 'lifecycleStatus' | 'hitTpMilestones'
  >,
  history: readonly SpamFilterHistoryEntry[],
  nowMs = Date.now(),
  config: SpamFilterConfig = DEFAULT_SPAM_FILTER_CONFIG
): SpamFilterVerdict {
  // 1. Exact fingerprint deduplication (catches identical alerts AND identical milestone repeats)
  const exactMatch = history.find(
    (h) => h.fingerprint === card.fingerprint && nowMs - h.timestampMs < config.fingerprintTtlMs
  );
  if (exactMatch) {
    const remainingSec = Math.max(
      1,
      Math.ceil((config.fingerprintTtlMs - (nowMs - exactMatch.timestampMs)) / 1000)
    );
    return {
      allowed: false,
      reasonCode: 'DUPLICATE_FINGERPRINT',
      reason: `Discarded duplicate ${card.symbol} ${card.direction} signal card (identical parameters already transmitted; ${remainingSec}s cooldown remaining).`,
      fingerprint: card.fingerprint,
      cooldownRemainingSec: remainingSec,
    };
  }

  // 2. Check whether this is a genuine milestone / final P&L progression for an active pair
  const recentSamePair = history.find(
    (h) =>
      h.symbol === card.symbol &&
      h.direction === card.direction &&
      nowMs - h.timestampMs < config.nearInstantCooldownMs
  );
  const isMilestoneProgression =
    Boolean(recentSamePair) &&
    (card.hitTpMilestones.length > (recentSamePair?.hitTpMilestones.length ?? 0) ||
      (card.lifecycleStatus !== 'OPEN' && card.lifecycleStatus !== recentSamePair?.lifecycleStatus));

  if (recentSamePair && !isMilestoneProgression) {
    const remainingSec = Math.max(
      1,
      Math.ceil((config.nearInstantCooldownMs - (nowMs - recentSamePair.timestampMs)) / 1000)
    );
    return {
      allowed: false,
      reasonCode: 'DUPLICATE_NEAR_INSTANT',
      reason: `Spam filter discarded near-instant repetitive ${card.symbol} ${card.direction} alert (${remainingSec}s cooldown window active).`,
      fingerprint: card.fingerprint,
      cooldownRemainingSec: remainingSec,
    };
  }

  // 3. Channel flood protection across all symbols
  const recentWindowCount = history.filter(
    (h) => nowMs - h.timestampMs < config.floodWindowMs
  ).length;
  if (recentWindowCount >= config.maxSignalsPerFloodWindow && !isMilestoneProgression) {
    return {
      allowed: false,
      reasonCode: 'CHANNEL_FLOOD_LIMIT',
      reason: `Channel anti-flood guard active (${recentWindowCount}/${config.maxSignalsPerFloodWindow} signals in 5m window).`,
      fingerprint: card.fingerprint,
      cooldownRemainingSec: 60,
    };
  }

  return {
    allowed: true,
    reasonCode: isMilestoneProgression ? 'MILESTONE_UPDATE_ALLOWED' : 'ALLOWED',
    reason: isMilestoneProgression
      ? `Permitted milestone / final P&L update (${card.lifecycleStatus}) for ${card.symbol}.`
      : `Cleared spam filter for ${card.symbol} ${card.direction}.`,
    fingerprint: card.fingerprint,
    cooldownRemainingSec: 0,
  };
}

export interface OutboundMakeWebhookPayload {
  event_id: string;
  event_type: 'SIGNAL_CARD' | 'MILESTONE_PNL_UPDATE';
  signal_category: 'GENERATED_SIGNAL' | 'PAPER_EXECUTED_TRADE' | 'REALIZED_RESULT';
  execution_mode: string;
  chat_id?: string;
  channel_name: string;
  signal_id: string;
  source: SignalAlertSource;
  symbol: string;
  pair: string;
  direction: 'BUY' | 'SELL';
  timeframe: string;
  entry_price: number;
  take_profits: {
    tp1: number;
    tp2: number;
    tp3: number;
  };
  exit_price: number;
  stop_loss: number;
  confidence_score: number;
  risk_reward_ratio: number;
  hit_tp_milestones: TpMilestone[];
  final_pnl_usd: number | null;
  final_pnl_percent: number | null;
  lifecycle_status: SignalLifecycleStatus;
  signal_card: string;
  text: string;
  timestamp: string;
}

export function buildOutboundWebhookPayload(
  card: ExtractedTradingSignalCard,
  routing: {
    chatId?: string | null;
    channelName?: string;
    signalCategory?: 'GENERATED_SIGNAL' | 'PAPER_EXECUTED_TRADE' | 'REALIZED_RESULT';
    executionMode?: string;
  }
): OutboundMakeWebhookPayload {
  const isMilestone =
    card.hitTpMilestones.length > 0 ||
    card.lifecycleStatus !== 'OPEN' ||
    card.finalPnlUsd !== null ||
    card.finalPnlPercent !== null;
  const eventType: OutboundMakeWebhookPayload['event_type'] = isMilestone
    ? 'MILESTONE_PNL_UPDATE'
    : 'SIGNAL_CARD';
  const inferredCategory: OutboundMakeWebhookPayload['signal_category'] =
    routing.signalCategory ??
    (card.finalPnlUsd !== null ||
    card.lifecycleStatus === 'CLOSED_TP' ||
    card.lifecycleStatus === 'CLOSED_SL' ||
    card.lifecycleStatus === 'CLOSED_MANUAL'
      ? 'REALIZED_RESULT'
      : 'GENERATED_SIGNAL');

  const safeChatId =
    routing.chatId && !/^\d{6,15}:[A-Za-z0-9_-]{20,}$/.test(routing.chatId.trim())
      ? routing.chatId.trim()
      : undefined;

  return {
    event_id: `${card.signalId}::${eventType}::${card.lifecycleStatus}`,
    event_type: eventType,
    signal_category: inferredCategory,
    execution_mode: routing.executionMode || 'PAPER_DRY_RUN',
    ...(safeChatId ? { chat_id: safeChatId } : {}),
    channel_name: routing.channelName || 'Signal Forge',
    signal_id: card.signalId,
    source: card.source,
    symbol: card.symbol,
    pair: card.symbol,
    direction: card.direction,
    timeframe: card.timeframe,
    entry_price: card.entryPrice,
    take_profits: {
      tp1: card.takeProfits[0],
      tp2: card.takeProfits[1],
      tp3: card.takeProfits[2],
    },
    exit_price: card.exitPrice,
    stop_loss: card.stopLoss,
    confidence_score: card.confidence,
    risk_reward_ratio: card.riskRewardRatio,
    hit_tp_milestones: card.hitTpMilestones,
    final_pnl_usd: card.finalPnlUsd,
    final_pnl_percent: card.finalPnlPercent,
    lifecycle_status: card.lifecycleStatus,
    signal_card: card.formattedCard,
    text: card.formattedCard,
    timestamp: card.createdAt,
  };
}

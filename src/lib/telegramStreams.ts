export type TelegramStreamChannel = 'PUBLIC_SIGNAL' | 'DEVELOPER_AUDIT';

export interface StructuredTradeSignalAlert {
  id: string;
  stream: 'PUBLIC_SIGNAL';
  channelName: string;
  targetChatId: string;
  symbol: string;
  direction: 'BUY' | 'SELL' | 'SUMMARY';
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  confidence: number;
  riskRewardRatio?: number;
  timeframe?: string;
  rationale?: string;
  formattedMessage: string;
  deliveredViaBot: boolean;
  deliveryStatus: 'DELIVERED' | 'QUEUED_FALLBACK' | 'FAILED';
  errorDetail?: string | null;
  timestamp: string;
}

export interface ModuleLatencyMetric {
  moduleId: string;
  label: string;
  latencyMs: number;
  status: 'OPTIMAL' | 'DEGRADED' | 'CRITICAL';
  targetCeilingMs: number;
}

export interface SystemHealthParameters {
  overallStatus: 'OPTIMAL' | 'SELF_HEALING' | 'DEGRADED';
  uptimeSec: number;
  cpuUsagePct: number;
  loadAvg1m: number;
  memoryRssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  eventLoopLagMs: number;
  wsConnected: boolean;
  wsFrameAgeMs: number;
  sseSubscribers: number;
  activeOpenPositions: number;
  autoHealCount: number;
  staleFeedCount: number;
  isolatedFaultsCount: number;
  activeServicesHealthy: number;
  totalServices: number;
}

export interface SystemAuditLogEntry {
  id: string;
  stream: 'DEVELOPER_AUDIT';
  kind: 'CONTINUOUS_AUDIT' | 'DAILY_DIGEST' | 'WEBHOOK_COMMAND';
  targetChatId: string;
  health: SystemHealthParameters;
  moduleLatencies: ModuleLatencyMetric[];
  formattedMessage: string;
  deliveredViaBot: boolean;
  deliveryStatus: 'DELIVERED' | 'QUEUED_FALLBACK' | 'FAILED';
  errorDetail?: string | null;
  timestamp: string;
}

export interface DailyAuditReportSummary {
  reportDateUtc: string;
  generatedAt: string;
  samplesCollected: number;
  avgCpuUsagePct: number;
  peakCpuUsagePct: number;
  avgMemoryRssMb: number;
  avgEventLoopLagMs: number;
  peakModuleLatencyMs: number;
  slowestModuleLabel: string;
  publicSignalsDispatched24h: number;
  continuousAuditsLogged24h: number;
  autoHealEventsTotal: number;
  uptimeSec: number;
  latestHealth: SystemHealthParameters;
  moduleLatencies: ModuleLatencyMetric[];
}

export interface TelegramWebhookInboundEvent {
  id: string;
  updateId: number;
  chatId: string;
  chatType: 'private' | 'group' | 'supergroup' | 'channel' | 'unknown';
  senderLabel: string;
  command: string | null;
  textPreview: string;
  actionTaken: string;
  timestamp: string;
}

export interface TelegramDualStreamStatus {
  ok: boolean;
  botConfigured: boolean;
  maskedToken: string;
  publicChannel: {
    name: string;
    chatId: string;
    handle: string;
    totalDispatched: number;
    deliveredCount: number;
    lastDispatchedAt: string | null;
  };
  developerAudit: {
    chatIdConfigured: boolean;
    targetChatIdMasked: string;
    autoBoundViaWebhook: boolean;
    continuousIntervalSec: number;
    totalAuditsLogged: number;
    deliveredCount: number;
    lastAuditAt: string | null;
    dailyAutoDeliveryEnabled: boolean;
    dailyScheduledUtcHour: number;
    lastDailyReportDateUtc: string | null;
    lastDailyReportSentAt: string | null;
    nextDailyReportUtcIso: string;
    dailyReportsDispatchedTotal: number;
  };
  webhook: {
    endpointPath: string;
    configuredUrl: string | null;
    registered: boolean;
    secretHeaderEnforced: boolean;
    lastRegisteredAt: string | null;
    lastInboundAt: string | null;
    totalInboundUpdates: number;
    lastError: string | null;
  };
  liveTelemetry: {
    capturedAt: string;
    health: SystemHealthParameters;
    moduleLatencies: ModuleLatencyMetric[];
  };
  publicSignals: StructuredTradeSignalAlert[];
  developerAuditLogs: SystemAuditLogEntry[];
  recentWebhookEvents: TelegramWebhookInboundEvent[];
}

export function maskTelegramToken(token?: string | null): string {
  const clean = String(token || '').trim();
  if (!clean) return 'Not configured';
  if (clean.length <= 10) return '****';
  return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
}

export function maskChatId(chatId?: string | null): string {
  const clean = String(chatId || '').trim();
  if (!clean) return 'Unbound (send /start to bot)';
  if (clean.length <= 6) return clean;
  return `${clean.slice(0, 4)}***${clean.slice(-3)}`;
}

export function formatAlertPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return '0.00';
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

export function computeRiskRewardRatio(
  direction: 'BUY' | 'SELL' | 'SUMMARY',
  entryPrice: number,
  exitPrice: number,
  stopLoss: number
): number {
  if (direction === 'SUMMARY') return 0;
  if (!Number.isFinite(entryPrice) || !Number.isFinite(exitPrice) || !Number.isFinite(stopLoss)) {
    return 0;
  }
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(exitPrice - entryPrice);
  if (risk <= 1e-9 || reward <= 0) return 0;
  return Number((reward / risk).toFixed(2));
}

export function formatPublicSignalMessage(input: {
  symbol: string;
  direction: 'BUY' | 'SELL' | 'SUMMARY';
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  confidence: number;
  timeframe?: string;
  rationale?: string;
  channelName?: string;
}): string {
  const pair = String(input.symbol || 'BTCUSDT').toUpperCase();
  const side = input.direction === 'SELL' ? 'SHORT / SELL' : input.direction === 'BUY' ? 'LONG / BUY' : 'SUMMARY';
  const conf = Math.max(0, Math.min(100, Math.round(Number(input.confidence || 0))));
  const rr = computeRiskRewardRatio(input.direction, input.entryPrice, input.exitPrice, input.stopLoss);
  const tf = input.timeframe || '4h';
  const lines = [
    `[SIGNAL FORGE · ${side}]`,
    `Trading Pair: ${pair} (${tf})`,
    `Entry Price: $${formatAlertPrice(input.entryPrice)}`,
    `Exit Price (TP): $${formatAlertPrice(input.exitPrice)}`,
    `Stop Loss: $${formatAlertPrice(input.stopLoss)}`,
    `Confidence Score: ${conf}%${rr > 0 ? ` | R:R 1:${rr}` : ''}`,
  ];
  if (input.rationale && input.rationale.trim()) {
    lines.push(`Thesis: ${input.rationale.trim().slice(0, 180)}`);
  }
  return lines.join('\n');
}

export function computeCpuUsagePercent(params: {
  prevUserMicros: number;
  prevSystemMicros: number;
  nextUserMicros: number;
  nextSystemMicros: number;
  elapsedMs: number;
  cpuCoreCount: number;
}): number {
  const elapsedMicros = Math.max(1000, params.elapsedMs * 1000);
  const cores = Math.max(1, params.cpuCoreCount || 1);
  const deltaUser = Math.max(0, params.nextUserMicros - params.prevUserMicros);
  const deltaSys = Math.max(0, params.nextSystemMicros - params.prevSystemMicros);
  const rawPct = ((deltaUser + deltaSys) / (elapsedMicros * cores)) * 100;
  if (!Number.isFinite(rawPct)) return 0;
  return Number(Math.max(0, Math.min(100, rawPct)).toFixed(1));
}

export function classifyLatencyStatus(
  latencyMs: number,
  targetCeilingMs: number
): ModuleLatencyMetric['status'] {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return 'DEGRADED';
  if (latencyMs <= targetCeilingMs) return 'OPTIMAL';
  if (latencyMs <= targetCeilingMs * 2) return 'DEGRADED';
  return 'CRITICAL';
}

export function formatDeveloperAuditMessage(
  health: SystemHealthParameters,
  moduleLatencies: ModuleLatencyMetric[],
  timestampIso: string
): string {
  const latencySummary = moduleLatencies
    .map((m) => `• ${m.label}: ${m.latencyMs}ms (${m.status})`)
    .join('\n');

  const uptimeMin = Math.floor(health.uptimeSec / 60);
  return [
    `[SIGNAL FORGE · SYSTEM AUDIT LOG]`,
    `Status: ${health.overallStatus} | UTC: ${timestampIso}`,
    `CPU Usage: ${health.cpuUsagePct.toFixed(1)}% (1m Load: ${health.loadAvg1m.toFixed(2)})`,
    `Memory: ${health.memoryRssMb.toFixed(1)} MB RSS (Heap ${health.heapUsedMb.toFixed(1)}/${health.heapTotalMb.toFixed(1)} MB)`,
    `Event Loop Lag: ${health.eventLoopLagMs.toFixed(2)}ms | Uptime: ${uptimeMin}m`,
    `Market WS: ${health.wsConnected ? 'CONNECTED' : 'FALLBACK'} (Frame Age: ${health.wsFrameAgeMs}ms) | SSE: ${health.sseSubscribers}`,
    `Services Healthy: ${health.activeServicesHealthy}/${health.totalServices} | Auto-Heals: ${health.autoHealCount} | Isolated Faults: ${health.isolatedFaultsCount}`,
    `Module Latencies:`,
    latencySummary,
  ].join('\n');
}

export function formatDailyAuditReportMessage(summary: DailyAuditReportSummary): string {
  const latencyLines = summary.moduleLatencies
    .map((m) => `• ${m.label}: ${m.latencyMs}ms (${m.status})`)
    .join('\n');

  return [
    `[SIGNAL FORGE · DAILY SYSTEM AUDIT REPORT · ${summary.reportDateUtc}]`,
    `Health Verdict: ${summary.latestHealth.overallStatus} | Samples: ${summary.samplesCollected}`,
    `CPU Utilization (24h): Avg ${summary.avgCpuUsagePct.toFixed(1)}% | Peak ${summary.peakCpuUsagePct.toFixed(1)}%`,
    `Memory RSS Avg: ${summary.avgMemoryRssMb.toFixed(1)} MB | Event Loop Avg: ${summary.avgEventLoopLagMs.toFixed(2)}ms`,
    `Peak Module Latency: ${summary.peakModuleLatencyMs}ms (${summary.slowestModuleLabel})`,
    `Public Signals Dispatched (24h): ${summary.publicSignalsDispatched24h}`,
    `Developer Audit Logs (24h): ${summary.continuousAuditsLogged24h} | Auto-Heals: ${summary.autoHealEventsTotal}`,
    `Current Module Latencies:`,
    latencyLines,
  ].join('\n');
}

export function getUtcDateKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function computeNextDailyAuditIso(nowMs: number, scheduledUtcHour: number): string {
  const safeHour = Math.max(0, Math.min(23, Math.floor(scheduledUtcHour)));
  const d = new Date(nowMs);
  const candidate = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), safeHour, 0, 0, 0);
  if (candidate <= nowMs) {
    return new Date(candidate + 24 * 60 * 60 * 1000).toISOString();
  }
  return new Date(candidate).toISOString();
}

export function shouldTriggerDailyAudit(params: {
  nowMs: number;
  lastSentDateUtc: string | null;
  scheduledUtcHour: number;
  enabled: boolean;
}): boolean {
  if (!params.enabled) return false;
  const nowDate = new Date(params.nowMs);
  const todayUtc = getUtcDateKey(params.nowMs);
  if (params.lastSentDateUtc === todayUtc) return false;
  const safeHour = Math.max(0, Math.min(23, Math.floor(params.scheduledUtcHour)));
  return nowDate.getUTCHours() >= safeHour;
}

export interface ParsedTelegramWebhookUpdate {
  valid: boolean;
  updateId: number;
  chatId: string | null;
  chatType: 'private' | 'group' | 'supergroup' | 'channel' | 'unknown';
  senderLabel: string;
  text: string;
  command: string | null;
}

export function parseTelegramWebhookUpdate(payload: unknown): ParsedTelegramWebhookUpdate {
  if (!payload || typeof payload !== 'object') {
    return {
      valid: false,
      updateId: 0,
      chatId: null,
      chatType: 'unknown',
      senderLabel: 'unknown',
      text: '',
      command: null,
    };
  }
  const obj = payload as Record<string, unknown>;
  const updateId = Number(obj.update_id ?? 0);
  const msg = (obj.message ?? obj.channel_post ?? obj.edited_message) as
    | Record<string, unknown>
    | undefined;
  if (!msg || typeof msg !== 'object') {
    return {
      valid: Number.isFinite(updateId) && updateId > 0,
      updateId: Number.isFinite(updateId) ? updateId : 0,
      chatId: null,
      chatType: 'unknown',
      senderLabel: 'system',
      text: '',
      command: null,
    };
  }

  const chat = (msg.chat && typeof msg.chat === 'object' ? msg.chat : {}) as Record<
    string,
    unknown
  >;
  const from = (msg.from && typeof msg.from === 'object' ? msg.from : {}) as Record<
    string,
    unknown
  >;
  const rawChatType = String(chat.type || 'unknown').toLowerCase();
  const chatType: ParsedTelegramWebhookUpdate['chatType'] =
    rawChatType === 'private' ||
    rawChatType === 'group' ||
    rawChatType === 'supergroup' ||
    rawChatType === 'channel'
      ? rawChatType
      : 'unknown';

  const chatId = chat.id !== undefined && chat.id !== null ? String(chat.id) : null;
  const senderLabel =
    String(from.username ? `@${from.username}` : from.first_name || chat.title || 'Telegram User').slice(
      0,
      64
    );
  const text = String(msg.text ?? msg.caption ?? '').trim().slice(0, 500);
  const cmdMatch = text.match(/^\/([a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?/);
  const command = cmdMatch ? `/${cmdMatch[1].toLowerCase()}` : null;

  return {
    valid: Boolean(chatId || updateId > 0),
    updateId: Number.isFinite(updateId) ? updateId : 0,
    chatId,
    chatType,
    senderLabel,
    text,
    command,
  };
}

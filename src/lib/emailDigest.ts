export const STRICT_DIGEST_INTERVAL_HOURS = 3;
export const THREE_HOURS_MS = STRICT_DIGEST_INTERVAL_HOURS * 60 * 60 * 1000;
export const MAX_DIGEST_QUEUE_SIZE = 40;

export type SignalDigestModule =
  | 'AI_ENGINE'
  | 'SMC_FRVP'
  | 'PATTERN_SCANNER'
  | 'TOP_GAINER'
  | 'COORDINATOR';

export interface QueuedSignalAlert {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  sourceModule: SignalDigestModule;
  confidence: number;
  entryPrice: number;
  stopLoss: number;
  trailingStopLoss: number;
  takeProfits: number[];
  reason: string;
  queuedAtMs: number;
  queuedAtIso: string;
}

export interface SignalDigestQueueState {
  pending: QueuedSignalAlert[];
  lastDigestSentAtMs: number | null;
  nextScheduledAtMs: number;
  totalBatchedAllTime: number;
  totalDigestsDispatched: number;
  individualEmailsPrevented: number;
}

export interface DigestScheduleDecision {
  due: boolean;
  remainingMs: number;
  pendingCount: number;
  reason: string;
}

export function createInitialDigestState(nowMs: number = Date.now()): SignalDigestQueueState {
  return {
    pending: [],
    lastDigestSentAtMs: null,
    nextScheduledAtMs: nowMs + THREE_HOURS_MS,
    totalBatchedAllTime: 0,
    totalDigestsDispatched: 0,
    individualEmailsPrevented: 0,
  };
}

/**
 * Enqueues a high-confidence signal alert into the strict 3-hour batch queue,
 * preventing immediate individual emails and deduplicating repeated updates for
 * the same symbol + direction inside the active 3-hour window.
 */
export function enqueueSignalForDigest(
  state: SignalDigestQueueState,
  input: {
    symbol: string;
    direction?: string;
    sourceModule?: SignalDigestModule;
    confidence: number;
    entryPrice: number;
    stopLoss?: number;
    trailingStopLoss?: number;
    takeProfits?: number[];
    reason?: string;
  },
  nowMs: number = Date.now()
): { state: SignalDigestQueueState; item: QueuedSignalAlert; deduplicated: boolean } {
  const cleanSym = String(input.symbol || 'BTCUSDT')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const dir: 'BUY' | 'SELL' = input.direction === 'SELL' ? 'SELL' : 'BUY';
  const mod: SignalDigestModule = input.sourceModule ?? 'AI_ENGINE';
  const conf = Math.max(0, Math.min(100, Math.round(Number(input.confidence || 0))));
  const entry = Number(input.entryPrice || 0);
  const sl = Number(input.stopLoss || 0);
  const trailSl =
    Number(input.trailingStopLoss) > 0
      ? Number(input.trailingStopLoss)
      : sl > 0
      ? sl
      : Number((dir === 'BUY' ? entry * 0.985 : entry * 1.015).toPrecision(6));
  const tps = Array.isArray(input.takeProfits)
    ? input.takeProfits.map((tp) => Number(tp)).filter((n) => Number.isFinite(n) && n > 0)
    : [];

  const dedupeKey = `${cleanSym}_${dir}`;
  const existingIdx = state.pending.findIndex((p) => `${p.symbol}_${p.direction}` === dedupeKey);

  const item: QueuedSignalAlert = {
    id: `dig_${cleanSym}_${dir}_${nowMs}`,
    symbol: cleanSym,
    direction: dir,
    sourceModule: mod,
    confidence: Math.max(conf, existingIdx >= 0 ? state.pending[existingIdx].confidence : conf),
    entryPrice: entry,
    stopLoss: sl > 0 ? sl : trailSl,
    trailingStopLoss: trailSl,
    takeProfits: tps.length > 0 ? tps : existingIdx >= 0 ? state.pending[existingIdx].takeProfits : [],
    reason: String(input.reason || 'High-confidence Coordinator setup batched for 3H Digest').slice(0, 280),
    queuedAtMs: nowMs,
    queuedAtIso: new Date(nowMs).toISOString(),
  };

  let nextPending: QueuedSignalAlert[];
  if (existingIdx >= 0) {
    nextPending = state.pending.slice();
    nextPending[existingIdx] = item;
  } else {
    nextPending = [item, ...state.pending];
  }

  nextPending.sort((a, b) => b.confidence - a.confidence || b.queuedAtMs - a.queuedAtMs);
  if (nextPending.length > MAX_DIGEST_QUEUE_SIZE) {
    nextPending = nextPending.slice(0, MAX_DIGEST_QUEUE_SIZE);
  }

  return {
    state: {
      ...state,
      pending: nextPending,
      totalBatchedAllTime: state.totalBatchedAllTime + 1,
      individualEmailsPrevented: state.individualEmailsPrevented + 1,
    },
    item,
    deduplicated: existingIdx >= 0,
  };
}

/**
 * Enforces the strict 3-hour dispatch cadence so automated triggers can never
 * exhaust daily email quota, while allowing explicit operator force flushes.
 */
export function evaluateDigestSchedule(
  state: SignalDigestQueueState,
  nowMs: number = Date.now(),
  force: boolean = false
): DigestScheduleDecision {
  if (force) {
    return {
      due: true,
      remainingMs: 0,
      pendingCount: state.pending.length,
      reason: `Manual operator flush approved (${state.pending.length} batched signals).`,
    };
  }

  const nextDueMs =
    state.lastDigestSentAtMs === null
      ? state.nextScheduledAtMs
      : state.lastDigestSentAtMs + THREE_HOURS_MS;

  const remainingMs = Math.max(0, nextDueMs - nowMs);
  const elapsed = remainingMs === 0;

  return {
    due: elapsed,
    remainingMs,
    pendingCount: state.pending.length,
    reason: elapsed
      ? `Strict 3-hour window elapsed; ready to dispatch ${state.pending.length} batched signals.`
      : `Strict 3-hour quota shield active (${Math.ceil(remainingMs / 60_000)}m remaining).`,
  };
}

/**
 * Consumes and clears the current pending signal batch while advancing the next
 * strict 3-hour dispatch window.
 */
export function consumePendingForDigest(
  state: SignalDigestQueueState,
  nowMs: number = Date.now()
): { state: SignalDigestQueueState; batch: QueuedSignalAlert[] } {
  const batch = state.pending
    .slice()
    .sort((a, b) => b.confidence - a.confidence || b.queuedAtMs - a.queuedAtMs);

  return {
    state: {
      ...state,
      pending: [],
      lastDigestSentAtMs: nowMs,
      nextScheduledAtMs: nowMs + THREE_HOURS_MS,
      totalDigestsDispatched: state.totalDigestsDispatched + 1,
    },
    batch,
  };
}

export function escapeHtml(raw: unknown): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildDigestEmailBodyHtml(params: {
  batch: QueuedSignalAlert[];
  trendingCoins: Array<{ symbol: string; name: string; price: number; change24h: number; tag: string }>;
  nextDigestIso: string;
}): string {
  const signalRows =
    params.batch.length === 0
      ? `<tr><td colspan="5" style="padding:12px 10px;color:#94a3b8;text-align:center;">No &ge;85% signal breakouts triggered during this 3-hour window. Market scan remains active.</td></tr>`
      : params.batch
          .map((sig) => {
            const dirColor = sig.direction === 'BUY' ? '#10b981' : '#ef4444';
            const tpsText =
              sig.takeProfits.length > 0
                ? sig.takeProfits.map((tp, idx) => `TP${idx + 1}: $${Number(tp)}`).join(' / ')
                : 'Dynamic R:R';
            return `<tr>
              <td style="padding:8px 10px;border-bottom:1px solid #1e293b;font-weight:700;color:#ffffff;">${escapeHtml(sig.symbol)} <span style="color:#64748b;font-weight:400;font-size:11px;">(${escapeHtml(sig.sourceModule)})</span></td>
              <td style="padding:8px 10px;border-bottom:1px solid #1e293b;font-weight:700;color:${dirColor};">${escapeHtml(sig.direction)} (${Number(sig.confidence)}%)</td>
              <td style="padding:8px 10px;border-bottom:1px solid #1e293b;color:#cbd5e1;font-family:monospace;">$${Number(sig.entryPrice)}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #1e293b;color:#f59e0b;font-family:monospace;">$${Number(sig.trailingStopLoss)}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:12px;">${escapeHtml(tpsText)}</td>
            </tr>`;
          })
          .join('');

  const trendingRows = params.trendingCoins
    .map(
      (coin) =>
        `<tr>
          <td style="padding:8px 10px;border-bottom:1px solid #1e293b;font-weight:600;color:#ffffff;">${escapeHtml(coin.name)} (${escapeHtml(coin.symbol)})</td>
          <td style="padding:8px 10px;border-bottom:1px solid #1e293b;color:#cbd5e1;font-family:monospace;">$${Number(coin.price).toLocaleString()}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #1e293b;color:${coin.change24h >= 0 ? '#10b981' : '#ef4444'};">${coin.change24h >= 0 ? '+' : ''}${Number(coin.change24h)}%</td>
          <td style="padding:8px 10px;border-bottom:1px solid #1e293b;color:#3b82f6;">${escapeHtml(coin.tag)}</td>
        </tr>`
    )
    .join('');

  return `
    <p>Strict <strong>3-Hour Consolidated AI Signal Digest</strong> dispatched by the Signal Forge Autonomous Trading Coordinator to prevent individual email quota exhaustion:</p>
    <p style="font-size:12px;color:#94a3b8;margin:6px 0 12px 0;">Batched Signals: <strong>${params.batch.length}</strong> &nbsp;|&nbsp; Next 3H Schedule: <strong>${escapeHtml(params.nextDigestIso)}</strong></p>
    <table style="width:100%;border-collapse:collapse;margin:12px 0;background:#111827;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#161f33;text-align:left;font-size:12px;color:#94a3b8;">
          <th style="padding:8px 10px;">Pair / Module</th>
          <th style="padding:8px 10px;">Side / Conf</th>
          <th style="padding:8px 10px;">Mark Entry</th>
          <th style="padding:8px 10px;">ATR Trail SL</th>
          <th style="padding:8px 10px;">Dynamic Targets</th>
        </tr>
      </thead>
      <tbody>${signalRows}</tbody>
    </table>
    <p style="margin:16px 0 8px 0;font-weight:600;color:#ffffff;">Binance Market Momentum Snapshot (Hot &amp; Gaining):</p>
    <table style="width:100%;border-collapse:collapse;margin:8px 0;background:#111827;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#161f33;text-align:left;font-size:12px;color:#94a3b8;">
          <th style="padding:8px 10px;">Asset</th>
          <th style="padding:8px 10px;">Price</th>
          <th style="padding:8px 10px;">24H Change</th>
          <th style="padding:8px 10px;">Momentum</th>
        </tr>
      </thead>
      <tbody>${trendingRows}</tbody>
    </table>
  `;
}

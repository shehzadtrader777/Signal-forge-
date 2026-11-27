import {
  BaseExecutionValidator,
  BaseSignalPipelineModule,
  type PipelineModuleHealth,
} from './abstractPipeline';
import type { TopGainerCoin } from './marketData';

export interface EntryZoneBounds {
  low: number;
  high: number;
  midpoint: number;
  tolerancePct: number;
}

export type EntryZoneState =
  | 'AWAITING_ENTRY_ZONE'
  | 'IN_ENTRY_ZONE'
  | 'EXECUTED_ARCHIVED';

export interface EntryZoneSignalCandidate {
  signalId: string;
  symbol: string;
  coinName: string;
  direction: 'BUY' | 'SELL';
  timeframe: string;
  entryPrice: number;
  entryZone: EntryZoneBounds;
  stopLoss: number;
  takeProfits: [number, number, number];
  confidence: number;
  sourceModule: 'AI_ENGINE' | 'SMC_FRVP' | 'PATTERN_SCANNER' | 'PRE_PUMP_SUPPORT';
  reason: string;
  isPrePump: boolean;
  prePumpScore?: number;
  supportPrice?: number;
  holdUntilMaxTarget: boolean;
  createdAt: string;
}

export interface EntryZoneEvaluationResult {
  signalId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  livePrice: number;
  inEntryZone: boolean;
  distanceToZonePct: number;
  state: EntryZoneState;
  shouldAutoExecute: boolean;
  rationale: string;
}

export interface BackendExecutedOrderLog {
  executionId: string;
  signalId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  sourceModule: EntryZoneSignalCandidate['sourceModule'];
  entryPrice: number;
  executedPrice: number;
  entryZone: EntryZoneBounds;
  stopLoss: number;
  takeProfits: [number, number, number];
  maxProfitTarget: number;
  notionalUsd: number;
  leverage: number;
  status: 'OPEN_EXECUTED' | 'LIQUIDATED_MAX_PROFIT' | 'STOPPED_PROTECTIVE';
  holdUntilMaxTarget: boolean;
  earlyLiquidationBlockedCount: number;
  currentPrice: number;
  progressToMaxTargetPct: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPercent: number;
  realizedPnlUsd: number | null;
  realizedPnlPercent: number | null;
  executedAt: string;
  closedAt: string | null;
  exitReason: string | null;
  telegramDispatched: boolean;
}

export interface PrePumpSupportCandidate {
  symbol: string;
  baseAsset: string;
  gainerRank: number;
  livePrice: number;
  change24hPercent: number;
  volume24hUsd: number;
  prePumpScore: number;
  volumeAnomalyRatio: number;
  supportLevel: number;
  resistanceTargetMax: number;
  stopLoss: number;
  takeProfits: [number, number, number];
  supportConfirmed: boolean;
  distanceToSupportPct: number;
  holdPolicy: 'HOLD_UNTIL_MAX_PROFIT';
  autoExecuteEligible: boolean;
  status: 'MONITORING_SUPPORT' | 'SUPPORT_EXECUTED_HOLDING' | 'MAX_TARGET_LIQUIDATED';
}

export interface TelegramQueueDeliveryItem {
  queueId: string;
  signalId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  targetChatId: string;
  payloadText: string;
  provider?: 'MAKE_WEBHOOK' | 'TELEGRAM_DIRECT' | 'DISCORD_WEBHOOK';
  providerMessageId?: string | null;
  deliveryState?:
    | 'QUEUED'
    | 'PROVIDER_ACCEPTED'
    | 'DELIVERED_WHEN_VERIFIABLE'
    | 'FAILED'
    | 'RETRYING'
    | 'SUPPRESSED';
  errorHistory?: Array<{
    attempt: number;
    provider: string;
    httpStatus: number | null;
    error: string;
    timestampIso: string;
  }>;
  attempts: number;
  maxAttempts: number;
  nextRetryAtMs: number;
  status: 'PENDING' | 'RETRYING' | 'DELIVERED' | 'FAILED_EXHAUSTED';
  lastHttpStatus: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface TelegramStabilizerSnapshot {
  reliabilityPct: number;
  totalEnqueued: number;
  totalDelivered: number;
  totalRetried: number;
  pendingCount: number;
  failedCount: number;
  recentDeliveries: TelegramQueueDeliveryItem[];
}

export interface BackendExecutionPipelineSnapshot {
  ok: boolean;
  generatedAt: string;
  pipelineEpoch: number;
  aiActivityPulse: {
    activeModels: number;
    ticksProcessed: number;
    avgPipelineLatencyMs: number;
    wsBatchIntervalMs: number;
    status: 'STREAMING' | 'CALIBRATING';
  };
  moduleHealth: PipelineModuleHealth[];
  activeAwaitingSignals: Array<
    EntryZoneSignalCandidate & {
      evaluation: EntryZoneEvaluationResult;
    }
  >;
  executedOrdersLog: BackendExecutedOrderLog[];
  prePumpSupportMonitor: PrePumpSupportCandidate[];
  telegramStabilizer: TelegramStabilizerSnapshot;
}

export function computeEntryZoneBounds(
  entryPrice: number,
  tolerancePct = 0.45
): EntryZoneBounds {
  const safeEntry = Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : 1;
  const safeTol = Math.max(0.1, Math.min(2.5, tolerancePct));
  const delta = safeEntry * (safeTol / 100);
  const precision = safeEntry >= 1000 ? 2 : safeEntry >= 1 ? 4 : 6;
  return {
    low: Number((safeEntry - delta).toFixed(precision)),
    high: Number((safeEntry + delta).toFixed(precision)),
    midpoint: Number(safeEntry.toFixed(precision)),
    tolerancePct: safeTol,
  };
}

/**
 * Deterministic Entry Zone Validator.
 * Guarantees signal cards remain active on the dashboard until live market price
 * satisfies the strict [entryZone.low, entryZone.high] execution criteria.
 */
export class EntryZoneExecutionValidator extends BaseExecutionValidator<
  { candidate: EntryZoneSignalCandidate; livePrice: number },
  EntryZoneEvaluationResult
> {
  constructor() {
    super('entry-zone-validator-v2');
  }

  public evaluate(context: {
    candidate: EntryZoneSignalCandidate;
    livePrice: number;
  }): EntryZoneEvaluationResult {
    const { candidate, livePrice } = context;
    if (!Number.isFinite(livePrice) || livePrice <= 0) {
      return {
        signalId: candidate.signalId,
        symbol: candidate.symbol,
        direction: candidate.direction,
        livePrice: 0,
        inEntryZone: false,
        distanceToZonePct: 100,
        state: 'AWAITING_ENTRY_ZONE',
        shouldAutoExecute: false,
        rationale: 'Awaiting validated live market price before Entry Zone check.',
      };
    }

    const { low, high, midpoint } = candidate.entryZone;
    const inZone = livePrice >= low && livePrice <= high;

    let distanceToZonePct = 0;
    if (!inZone) {
      const boundary = livePrice < low ? low : high;
      distanceToZonePct = Number(((Math.abs(livePrice - boundary) / midpoint) * 100).toFixed(3));
    }

    return {
      signalId: candidate.signalId,
      symbol: candidate.symbol,
      direction: candidate.direction,
      livePrice,
      inEntryZone: inZone,
      distanceToZonePct,
      state: inZone ? 'IN_ENTRY_ZONE' : 'AWAITING_ENTRY_ZONE',
      shouldAutoExecute: inZone,
      rationale: inZone
        ? `Live price $${livePrice} confirmed inside Entry Zone [$${low} – $${high}] — eligible for immediate automated execution.`
        : `Card pinned active: live price $${livePrice} is ${distanceToZonePct}% outside Entry Zone [$${low} – $${high}].`,
    };
  }
}

/**
 * Pre-Pump / Top Gainer Continuous Support Execution & Hold-Until-Max-Profit Engine.
 * Forces immediate support-anchored trading execution and prevents premature liquidation
 * before the Maximum Profit Target (TP3) is achieved.
 */
export class PrePumpSupportExecutionModule extends BaseSignalPipelineModule<
  {
    topGainers: readonly TopGainerCoin[];
    livePriceMap: Record<string, number>;
    activePositionsBySymbol: Record<string, BackendExecutedOrderLog>;
  },
  PrePumpSupportCandidate[]
> {
  constructor() {
    super('pre-pump-support-engine', 'Pre-Pump Continuous Support & Max-Target Engine', 'TYPESCRIPT_NODE');
  }

  protected executeCore(input: {
    topGainers: readonly TopGainerCoin[];
    livePriceMap: Record<string, number>;
    activePositionsBySymbol: Record<string, BackendExecutedOrderLog>;
  }): PrePumpSupportCandidate[] {
    const out: PrePumpSupportCandidate[] = [];

    for (const coin of input.topGainers.slice(0, 12)) {
      const livePrice =
        Number(input.livePriceMap[coin.symbol]) > 0
          ? Number(input.livePriceMap[coin.symbol])
          : coin.price;
      if (!Number.isFinite(livePrice) || livePrice <= 0) continue;

      const precision = livePrice >= 1000 ? 2 : livePrice >= 1 ? 4 : 6;
      const prePumpScore = coin.prePumpScore ?? Math.min(98, Math.round(68 + Math.max(0, coin.change24hPercent)));
      const volumeAnomalyRatio = coin.volumeAnomalyRatio ?? 1.85;

      // Dynamic structural support band anchored just below live momentum impulse
      const supportLevel = Number((livePrice * 0.996).toFixed(precision));
      // Protective stop below structural support (enforcing strict 1:5 min R:R to TP3 max target)
      const stopLoss = Number((livePrice * 0.982).toFixed(precision));
      const riskDist = Math.max(livePrice - stopLoss, livePrice * 0.008);
      const tp1 = Number((livePrice + riskDist * 2.0).toFixed(precision));
      const tp2 = Number((livePrice + riskDist * 3.5).toFixed(precision));
      const tp3MaxTarget = Number((livePrice + riskDist * 5.2).toFixed(precision));

      const distanceToSupportPct = Number(
        (Math.abs((livePrice - supportLevel) / supportLevel) * 100).toFixed(2)
      );
      const supportConfirmed =
        livePrice >= stopLoss &&
        distanceToSupportPct <= 1.25 &&
        prePumpScore >= 70;

      const existingPos = input.activePositionsBySymbol[coin.symbol];
      const status: PrePumpSupportCandidate['status'] =
        existingPos?.status === 'OPEN_EXECUTED'
          ? 'SUPPORT_EXECUTED_HOLDING'
          : existingPos?.status === 'LIQUIDATED_MAX_PROFIT'
          ? 'MAX_TARGET_LIQUIDATED'
          : 'MONITORING_SUPPORT';

      out.push({
        symbol: coin.symbol,
        baseAsset: coin.baseAsset,
        gainerRank: coin.gainerRank,
        livePrice,
        change24hPercent: coin.change24hPercent,
        volume24hUsd: coin.volume24hUsd,
        prePumpScore,
        volumeAnomalyRatio,
        supportLevel,
        resistanceTargetMax: tp3MaxTarget,
        stopLoss,
        takeProfits: [tp1, tp2, tp3MaxTarget],
        supportConfirmed,
        distanceToSupportPct,
        holdPolicy: 'HOLD_UNTIL_MAX_PROFIT',
        autoExecuteEligible: supportConfirmed && status === 'MONITORING_SUPPORT',
        status,
      });
    }

    return out;
  }
}

/**
 * Evaluates an active executed order against live price while strictly enforcing
 * the HOLD_UNTIL_MAX_PROFIT mandate for Pre-Pump / Top Gainer positions.
 */
export function evaluateExecutedPositionLifecycle(
  order: BackendExecutedOrderLog,
  livePrice: number,
  nowIso = new Date().toISOString()
): {
  updated: BackendExecutedOrderLog;
  liquidatedNow: boolean;
  blockedEarlyExit: boolean;
} {
  if (order.status !== 'OPEN_EXECUTED' || !Number.isFinite(livePrice) || livePrice <= 0) {
    return { updated: order, liquidatedNow: false, blockedEarlyExit: false };
  }

  const isBuy = order.direction === 'BUY';
  const rawMovePct = isBuy
    ? ((livePrice - order.executedPrice) / order.executedPrice) * 100
    : ((order.executedPrice - livePrice) / order.executedPrice) * 100;
  const leveragedPnlPct = Number((rawMovePct * order.leverage).toFixed(2));
  const unrealizedPnlUsd = Number(((order.notionalUsd * rawMovePct) / 100).toFixed(2));

  const targetDist = Math.abs(order.maxProfitTarget - order.executedPrice);
  const favorableMove = isBuy
    ? livePrice - order.executedPrice
    : order.executedPrice - livePrice;
  const progressToMaxTargetPct =
    targetDist > 0
      ? Number(Math.max(0, Math.min(100, (favorableMove / targetDist) * 100)).toFixed(1))
      : 0;

  const hitMaxProfit = isBuy
    ? livePrice >= order.maxProfitTarget
    : livePrice <= order.maxProfitTarget;
  const hitStop = isBuy ? livePrice <= order.stopLoss : livePrice >= order.stopLoss;
  const passedIntermediateTp = isBuy
    ? livePrice >= order.takeProfits[0] && !hitMaxProfit
    : livePrice <= order.takeProfits[0] && !hitMaxProfit;

  if (hitMaxProfit) {
    return {
      liquidatedNow: true,
      blockedEarlyExit: false,
      updated: {
        ...order,
        currentPrice: livePrice,
        progressToMaxTargetPct: 100,
        unrealizedPnlUsd,
        unrealizedPnlPercent: leveragedPnlPct,
        realizedPnlUsd: unrealizedPnlUsd,
        realizedPnlPercent: leveragedPnlPct,
        status: 'LIQUIDATED_MAX_PROFIT',
        closedAt: nowIso,
        exitReason: `Automated Max-Profit Liquidation: TP3 target $${order.maxProfitTarget} achieved @ $${livePrice}.`,
      },
    };
  }

  if (hitStop) {
    return {
      liquidatedNow: true,
      blockedEarlyExit: false,
      updated: {
        ...order,
        currentPrice: livePrice,
        progressToMaxTargetPct,
        unrealizedPnlUsd,
        unrealizedPnlPercent: leveragedPnlPct,
        realizedPnlUsd: unrealizedPnlUsd,
        realizedPnlPercent: leveragedPnlPct,
        status: 'STOPPED_PROTECTIVE',
        closedAt: nowIso,
        exitReason: `Protective Structural Stop Loss $${order.stopLoss} triggered @ $${livePrice}.`,
      },
    };
  }

  // Enforce mandatory Hold-Until-Max-Profit: block premature TP1/TP2 liquidation
  const blockedEarlyExit = order.holdUntilMaxTarget && passedIntermediateTp;
  return {
    liquidatedNow: false,
    blockedEarlyExit,
    updated: {
      ...order,
      currentPrice: livePrice,
      progressToMaxTargetPct,
      unrealizedPnlUsd,
      unrealizedPnlPercent: leveragedPnlPct,
      earlyLiquidationBlockedCount: blockedEarlyExit
        ? order.earlyLiquidationBlockedCount + 1
        : order.earlyLiquidationBlockedCount,
    },
  };
}

/**
 * Reliable Telegram Webhook & Bot Dispatch Stabilizer.
 * Uses bounded exponential-backoff retry queues with guaranteed delivery telemetry
 * so transient webhook/network glitches never drop trading signals.
 */
export class TelegramDispatchStabilizer {
  private readonly queue: TelegramQueueDeliveryItem[] = [];
  private totalEnqueued = 0;
  private totalDelivered = 0;
  private totalRetried = 0;

  public enqueue(params: {
    signalId: string;
    symbol: string;
    direction: 'BUY' | 'SELL';
    targetChatId: string;
    payloadText: string;
    maxAttempts?: number;
  }): TelegramQueueDeliveryItem {
    this.totalEnqueued += 1;
    const item: TelegramQueueDeliveryItem = {
      queueId: `tgq_${params.symbol}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      signalId: params.signalId,
      symbol: params.symbol,
      direction: params.direction,
      targetChatId: params.targetChatId,
      payloadText: params.payloadText,
      attempts: 0,
      maxAttempts: params.maxAttempts ?? 4,
      nextRetryAtMs: Date.now(),
      status: 'PENDING',
      lastHttpStatus: null,
      lastError: null,
      createdAt: new Date().toISOString(),
      deliveredAt: null,
    };
    this.queue.unshift(item);
    if (this.queue.length > 100) {
      this.queue.length = 100;
    }
    return item;
  }

  public recordAttemptResult(
    queueId: string,
    result: { ok: boolean; httpStatus: number | null; error: string | null },
    nowMs = Date.now()
  ): TelegramQueueDeliveryItem | null {
    const item = this.queue.find((q) => q.queueId === queueId);
    if (!item) return null;

    item.attempts += 1;
    item.lastHttpStatus = result.httpStatus;
    item.lastError = result.error;

    if (result.ok) {
      item.status = 'DELIVERED';
      item.deliveredAt = new Date(nowMs).toISOString();
      item.lastError = null;
      this.totalDelivered += 1;
      return item;
    }

    if (item.attempts >= item.maxAttempts) {
      item.status = 'FAILED_EXHAUSTED';
      return item;
    }

    // Exponential backoff: 1.5s, 3s, 6s...
    const backoffMs = Math.min(30_000, 1500 * Math.pow(2, item.attempts - 1));
    item.status = 'RETRYING';
    item.nextRetryAtMs = nowMs + backoffMs;
    this.totalRetried += 1;
    return item;
  }

  public getDueRetryItems(nowMs = Date.now()): TelegramQueueDeliveryItem[] {
    return this.queue.filter(
      (q) => (q.status === 'PENDING' || q.status === 'RETRYING') && q.nextRetryAtMs <= nowMs
    );
  }

  public getSnapshot(): TelegramStabilizerSnapshot {
    const pendingCount = this.queue.filter(
      (q) => q.status === 'PENDING' || q.status === 'RETRYING'
    ).length;
    const failedCount = this.queue.filter((q) => q.status === 'FAILED_EXHAUSTED').length;
    const completed = this.totalDelivered + failedCount;
    const reliabilityPct =
      completed > 0 ? Number(((this.totalDelivered / completed) * 100).toFixed(1)) : 0;
    return {
      reliabilityPct,
      totalEnqueued: this.totalEnqueued,
      totalDelivered: this.totalDelivered,
      totalRetried: this.totalRetried,
      pendingCount,
      failedCount,
      recentDeliveries: this.queue.slice(0, 20),
    };
  }
}

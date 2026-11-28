/**
 * Signal Forge — Two-Stage Social Chart Snapshot Builder (Telegram & Discord)
 *
 * Produces high-resolution, mobile-readable snapshot metadata & PNG overlay plans for:
 *  - Stage 1 (APPROVED_SIGNAL): actual market structure, technical drawings, strategy, entry zone, SL, targets, Trade ID
 *  - Stage 2 (CLOSED_RESULT): exact same Trade ID, actual entry, actual exit, verified outcome & net P&L after fees
 *
 * Also enforces honest publication confirmation: never reports delivery success without real API confirmation.
 */

import type { CanonicalTradeRecord } from './tradeLifecycleLedger.ts';
import {
  classifyTradeEnvironment,
  computeVerifiedTradePnl,
} from './publicSmartChartModel.ts';
import type { TechnicalAnalysisSummary } from './technicalStructureEngine.ts';

function formatSnapshotPrice(price: number): string {
  if (!Number.isFinite(price)) return '0.00';
  const abs = Math.abs(price);
  if (abs >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (abs >= 1) return price.toFixed(4);
  if (abs >= 0.01) return price.toFixed(5);
  return price.toFixed(6);
}

export type SocialSnapshotStage = 'STAGE_1_APPROVED_SIGNAL' | 'STAGE_2_CLOSED_RESULT';

export interface SocialChartSnapshotSpec {
  stage: SocialSnapshotStage;
  tradeId: string;
  pair: string;
  timeframe: string;
  environmentBadge: string;
  headline: string;
  subline: string;
  keyMetrics: { label: string; value: string; tone: 'neutral' | 'bull' | 'bear' | 'accent' }[];
  structureCaption: string;
  footerDisclaimer: string;
  fileName: string;
  isStage2Available: boolean;
}

export interface PublicationReceiptInput {
  channel: 'TELEGRAM' | 'DISCORD';
  confirmed: boolean;
  messageId?: string | null;
  error?: string | null;
}

export interface PublicationStatusResult {
  published: boolean;
  statusLabel: string;
  detail: string;
}

export function buildSocialChartSnapshotSpec(
  trade: CanonicalTradeRecord,
  stage: SocialSnapshotStage,
  structure?: TechnicalAnalysisSummary | null
): SocialChartSnapshotSpec {
  const env = classifyTradeEnvironment(trade);
  const pnl = computeVerifiedTradePnl(trade);
  const isClosedStatus =
    trade.executionStatus === 'CLOSED_TP' ||
    trade.executionStatus === 'CLOSED_SL' ||
    trade.executionStatus === 'CLOSED_MANUAL';
  const isStage2Available =
    trade.recordClass === 'EXECUTED_TRADE' &&
    isClosedStatus &&
    pnl.isRealized;

  const resolvedExitPrice =
    trade.executionStatus === 'CLOSED_TP'
      ? trade.takeProfit
      : trade.executionStatus === 'CLOSED_SL'
      ? trade.stopLoss
      : trade.closedAtIso !== null
      ? trade.actualExecutionPrice ?? trade.entryPrice
      : null;

  const effectiveStage: SocialSnapshotStage =
    stage === 'STAGE_2_CLOSED_RESULT' && !isStage2Available
      ? 'STAGE_1_APPROVED_SIGNAL'
      : stage;

  const structureBits: string[] = [];
  if (structure?.trendBias) structureBits.push(`Bias: ${structure.trendBias}`);
  if (structure?.supportLevel) {
    structureBits.push(`SUP $${formatSnapshotPrice(structure.supportLevel.price)}`);
  }
  if (structure?.resistanceLevel) {
    structureBits.push(`RES $${formatSnapshotPrice(structure.resistanceLevel.price)}`);
  }
  if (trade.chartPattern) {
    structureBits.push(`Pattern: ${trade.chartPattern.name}`);
  }
  const structureCaption =
    structureBits.length > 0
      ? structureBits.join(' · ')
      : `Indicators: ${trade.chartSnapshot.indicators.join(' · ')}`;

  if (effectiveStage === 'STAGE_2_CLOSED_RESULT') {
    const netValue = pnl.netPnlUsd ?? 0;
    return {
      stage: 'STAGE_2_CLOSED_RESULT',
      tradeId: trade.tradeId,
      pair: trade.pair,
      timeframe: trade.timeframe,
      environmentBadge: env.badgeLabel,
      headline: `SIGNAL FORGE · RESULT AUDIT · ${trade.tradeId}`,
      subline: `${trade.direction} ${trade.pair} (${trade.timeframe}) · ${trade.strategyName} · ${env.badgeLabel}`,
      keyMetrics: [
        {
          label: 'Actual Entry',
          value: `$${formatSnapshotPrice(trade.actualExecutionPrice ?? trade.entryPrice)}`,
          tone: 'accent',
        },
        {
          label: 'Actual Exit',
          value: resolvedExitPrice !== null ? `$${formatSnapshotPrice(resolvedExitPrice)}` : 'Open',
          tone: 'neutral',
        },
        {
          label: 'Status',
          value: env.statusLabel,
          tone: netValue >= 0 ? 'bull' : 'bear',
        },
        {
          label: 'Verified Net P&L',
          value: pnl.displayLabel,
          tone: netValue >= 0 ? 'bull' : 'bear',
        },
      ],
      structureCaption,
      footerDisclaimer: `${trade.tradeId} · Stage 2 Post-Closure Audit · ${env.shortMode} Environment · Informational only, not financial advice.`,
      fileName: `${trade.tradeId}_${trade.pair}_${trade.timeframe}_stage2_result.png`,
      isStage2Available,
    };
  }

  return {
    stage: 'STAGE_1_APPROVED_SIGNAL',
    tradeId: trade.tradeId,
    pair: trade.pair,
    timeframe: trade.timeframe,
    environmentBadge: env.badgeLabel,
    headline: `SIGNAL FORGE · APPROVED SIGNAL · ${trade.tradeId}`,
    subline: `${trade.direction} ${trade.pair} (${trade.timeframe}) · ${trade.strategyName} · ${env.badgeLabel}`,
    keyMetrics: [
      {
        label: 'Entry Zone',
        value: `$${formatSnapshotPrice(trade.signalPrice)}`,
        tone: 'accent',
      },
      {
        label: 'Stop Loss',
        value: `$${formatSnapshotPrice(trade.stopLoss)}`,
        tone: 'bear',
      },
      {
        label: 'Take Profit',
        value: `$${formatSnapshotPrice(trade.takeProfit)}`,
        tone: 'bull',
      },
      {
        label: 'Theoretical R:R',
        value: `1:${trade.projectedRrRatio}`,
        tone: 'neutral',
      },
    ],
    structureCaption,
    footerDisclaimer: `${trade.tradeId} · Stage 1 Signal Setup · ${env.shortMode} · Unexecuted signal target is not realized profit.`,
    fileName: `${trade.tradeId}_${trade.pair}_${trade.timeframe}_stage1_signal.png`,
    isStage2Available,
  };
}

/**
 * Honest delivery guard: never reports Telegram/Discord publication as succeeded
 * without explicit API confirmation and a real message identifier.
 */
export function evaluatePublicationDeliveryStatus(
  receipt: PublicationReceiptInput
): PublicationStatusResult {
  if (receipt.confirmed && receipt.messageId && receipt.messageId.trim().length > 0) {
    return {
      published: true,
      statusLabel: `${receipt.channel} CONFIRMED`,
      detail: `Verified delivery receipt #${receipt.messageId.trim()}.`,
    };
  }
  return {
    published: false,
    statusLabel: `${receipt.channel} UNCONFIRMED`,
    detail:
      receipt.error?.trim() ||
      `No verified ${receipt.channel} delivery confirmation received — snapshot saved locally only.`,
  };
}

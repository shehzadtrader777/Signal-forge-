/**
 * Signal Forge × Freqtrade Unified Trading Core — Pure Domain Logic
 *
 * Strictly zero external I/O, strict TypeScript v5+, deterministic & unit-tested:
 *  - Unified CCXT Spot/Futures exchange routing contract (Binance, Bybit, OKX, Kraken)
 *  - Hard-coded Risk Parameters (Stop-Loss, Take-Profit, Trailing Stops, 8% Daily Drawdown Cap)
 *  - Mandatory 50-Consecutive-Profitable-Paper-Trades Live Deployment Validation Gate
 *  - Automated Telegram RPC command processor (/start, /stop, /status, /profit)
 *  - Structured System Audit Log formatter (CPU, Memory, Latency, Execution Errors)
 */

export type UnifiedExchangeId = 'binance' | 'bybit' | 'okx' | 'kraken';
export type UnifiedMarketType = 'SPOT' | 'FUTURES';
export type UnifiedTradingMode = 'TESTNET' | 'PAPER_DRY_RUN' | 'LIVE';
export type UnifiedOrderSide = 'BUY' | 'SELL';
export type TelegramRpcCommand = '/start' | '/stop' | '/status' | '/profit';

export const SUPPORTED_CCXT_EXCHANGES: readonly UnifiedExchangeId[] = Object.freeze([
  'binance',
  'bybit',
  'okx',
  'kraken',
]);

export const ALLOWED_TRADING_MODES: readonly UnifiedTradingMode[] = Object.freeze([
  'TESTNET',
  'PAPER_DRY_RUN',
  'LIVE',
]);

export const ALLOWED_TELEGRAM_RPC_COMMANDS: readonly TelegramRpcCommand[] = Object.freeze([
  '/start',
  '/stop',
  '/status',
  '/profit',
]);

export interface HardCodedRiskParameters {
  readonly stopLossPct: number;
  readonly takeProfitPct: number;
  readonly trailingActivationPct: number;
  readonly trailingOffsetPct: number;
  readonly maxDailyDrawdownPct: number;
  readonly maxOpenTrades: number;
  readonly takerFeeRate: number;
  readonly requiredConsecutivePaperWins: number;
}

export const HARD_CODED_RISK_PARAMETERS: HardCodedRiskParameters = Object.freeze({
  stopLossPct: 0.02, // 2.0% hard stop-loss
  takeProfitPct: 0.06, // 6.0% automated take-profit
  trailingActivationPct: 0.015, // Arms trailing stop at +1.5% profit
  trailingOffsetPct: 0.008, // Trails 0.8% behind peak favorable price
  maxDailyDrawdownPct: 0.08, // 8.0% mandatory max daily drawdown cap
  maxOpenTrades: 5,
  takerFeeRate: 0.001, // 10 bps standardized CCXT taker fee
  requiredConsecutivePaperWins: 50, // Mandatory 50 consecutive profitable paper trades
});

export interface StandardizedAiSignalInput {
  readonly signalId: string;
  readonly exchange: UnifiedExchangeId;
  readonly symbol: string;
  readonly marketType: UnifiedMarketType;
  readonly side: UnifiedOrderSide;
  readonly entryPrice: number;
  readonly stakeUsd: number;
  readonly leverage?: number;
  readonly confidencePct: number;
  readonly strategyName?: string;
}

export interface CcxtRouteValidationResult {
  readonly valid: boolean;
  readonly reason: string;
  readonly normalizedSymbol: string;
  readonly effectiveLeverage: number;
  readonly fillPrice: number;
  readonly quantity: number;
  readonly notionalUsd: number;
  readonly feeUsd: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
}

export interface DryRunPositionRecord {
  readonly tradeId: number;
  readonly signalId: string;
  readonly exchange: UnifiedExchangeId;
  readonly symbol: string;
  readonly marketType: UnifiedMarketType;
  readonly tradingMode: UnifiedTradingMode;
  readonly side: UnifiedOrderSide;
  readonly entryPrice: number;
  readonly currentPrice: number;
  readonly quantity: number;
  readonly stakeUsd: number;
  readonly leverage: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly trailingStop: number | null;
  readonly peakPrice: number;
  readonly status: 'OPEN' | 'CLOSED';
  readonly realizedPnlUsd: number;
  readonly unrealizedPnlUsd: number;
  readonly closeReason: string;
  readonly openedAtIso: string;
  readonly closedAtIso: string | null;
}

export interface SystemAuditLogEntry {
  readonly id: string;
  readonly timestampIso: string;
  readonly tradingMode: UnifiedTradingMode;
  readonly cpuPct: number;
  readonly memoryMb: number;
  readonly latencyMs: number;
  readonly executionErrors: number;
  readonly portfolioValueUsd: number;
  readonly dailyDrawdownPct: number;
  readonly formattedMessage: string;
  readonly channelStatus: 'TELEGRAM_DISPATCHED' | 'LOCAL_AUDIT_RING';
}

export interface TelegramRpcLogEntry {
  readonly id: string;
  readonly timestampIso: string;
  readonly command: string;
  readonly response: string;
  readonly tradingMode: UnifiedTradingMode;
}

export interface UnifiedEngineMetrics {
  readonly tradingMode: UnifiedTradingMode;
  readonly botRunning: boolean;
  readonly equityUsd: number;
  readonly dayStartEquityUsd: number;
  readonly portfolioValueUsd: number;
  readonly unrealizedPnlUsd: number;
  readonly realizedPnlTotalUsd: number;
  readonly dailyDrawdownPct: number;
  readonly maxDailyDrawdownPct: number;
  readonly drawdownCircuitTripped: boolean;
  readonly consecutivePaperWins: number;
  readonly requiredPaperWins: number;
  readonly liveGateUnlocked: boolean;
  readonly openPositionsCount: number;
  readonly closedTradesCount: number;
  readonly winRatePct: number;
}

export function isSupportedExchange(value: string): value is UnifiedExchangeId {
  return (SUPPORTED_CCXT_EXCHANGES as readonly string[]).includes(value);
}

export function isAllowedTradingMode(value: string): value is UnifiedTradingMode {
  return (ALLOWED_TRADING_MODES as readonly string[]).includes(value);
}

export function normalizeCcxtSymbol(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9/]/g, '');
  if (!cleaned) return 'BTC/USDT';
  if (cleaned.includes('/')) return cleaned;
  if (cleaned.endsWith('USDT') && cleaned.length > 4) {
    return `${cleaned.slice(0, -4)}/USDT`;
  }
  return `${cleaned}/USDT`;
}

export function validateAndPrepareCcxtSignal(
  input: StandardizedAiSignalInput,
  risk: HardCodedRiskParameters = HARD_CODED_RISK_PARAMETERS
): CcxtRouteValidationResult {
  if (!isSupportedExchange(input.exchange)) {
    return {
      valid: false,
      reason: `Unsupported CCXT exchange "${input.exchange}". Allowed: ${SUPPORTED_CCXT_EXCHANGES.join(', ')}.`,
      normalizedSymbol: '',
      effectiveLeverage: 1,
      fillPrice: 0,
      quantity: 0,
      notionalUsd: 0,
      feeUsd: 0,
      stopLoss: 0,
      takeProfit: 0,
    };
  }

  if (!Number.isFinite(input.entryPrice) || input.entryPrice <= 0) {
    return {
      valid: false,
      reason: 'Entry price must be a finite positive number.',
      normalizedSymbol: '',
      effectiveLeverage: 1,
      fillPrice: 0,
      quantity: 0,
      notionalUsd: 0,
      feeUsd: 0,
      stopLoss: 0,
      takeProfit: 0,
    };
  }

  if (!Number.isFinite(input.stakeUsd) || input.stakeUsd < 10) {
    return {
      valid: false,
      reason: 'Stake USD must be at least $10.00.',
      normalizedSymbol: '',
      effectiveLeverage: 1,
      fillPrice: 0,
      quantity: 0,
      notionalUsd: 0,
      feeUsd: 0,
      stopLoss: 0,
      takeProfit: 0,
    };
  }

  const normalizedSymbol = normalizeCcxtSymbol(input.symbol);
  const rawLev = input.marketType === 'FUTURES' ? (input.leverage ?? 3) : 1;
  const effectiveLeverage = Math.max(1, Math.min(20, Number.isFinite(rawLev) ? rawLev : 1));
  const slippageMult = input.side === 'BUY' ? 1.0002 : 0.9998;
  const fillPrice = Number((input.entryPrice * slippageMult).toFixed(6));
  const notionalUsd = Number((input.stakeUsd * effectiveLeverage).toFixed(2));
  const quantity = Number((notionalUsd / fillPrice).toFixed(6));
  const feeUsd = Number((notionalUsd * risk.takerFeeRate).toFixed(4));

  const stopLoss =
    input.side === 'BUY'
      ? Number((fillPrice * (1 - risk.stopLossPct)).toFixed(6))
      : Number((fillPrice * (1 + risk.stopLossPct)).toFixed(6));

  const takeProfit =
    input.side === 'BUY'
      ? Number((fillPrice * (1 + risk.takeProfitPct)).toFixed(6))
      : Number((fillPrice * (1 - risk.takeProfitPct)).toFixed(6));

  return {
    valid: true,
    reason: `Standardized CCXT route ready (${input.exchange.toUpperCase()} ${input.marketType} ${normalizedSymbol})`,
    normalizedSymbol,
    effectiveLeverage,
    fillPrice,
    quantity,
    notionalUsd,
    feeUsd,
    stopLoss,
    takeProfit,
  };
}

export function evaluateLiveDeploymentGate(
  consecutivePaperWins: number,
  risk: HardCodedRiskParameters = HARD_CODED_RISK_PARAMETERS
): { readonly unlocked: boolean; readonly remaining: number; readonly message: string } {
  const safeWins = Math.max(0, Math.floor(consecutivePaperWins));
  const required = risk.requiredConsecutivePaperWins;
  const unlocked = safeWins >= required;
  const remaining = Math.max(0, required - safeWins);

  return {
    unlocked,
    remaining,
    message: unlocked
      ? `LIVE_GATE_CLEARED: ${safeWins}/${required} consecutive profitable paper trades verified.`
      : `LIVE_GATE_LOCKED: ${safeWins}/${required} consecutive profitable paper trades completed (${remaining} more required before Live deployment).`,
  };
}

export function computeUnrealizedPnlUsd(
  side: UnifiedOrderSide,
  entryPrice: number,
  markPrice: number,
  quantity: number
): number {
  const diff = side === 'BUY' ? markPrice - entryPrice : entryPrice - markPrice;
  return Number((diff * quantity).toFixed(2));
}

export function evaluatePositionRiskTick(
  position: Pick<
    DryRunPositionRecord,
    'side' | 'entryPrice' | 'stopLoss' | 'takeProfit' | 'trailingStop' | 'peakPrice'
  >,
  markPrice: number,
  risk: HardCodedRiskParameters = HARD_CODED_RISK_PARAMETERS
): {
  readonly nextPeakPrice: number;
  readonly nextTrailingStop: number | null;
  readonly closeReason: '' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'TRAILING_STOP';
} {
  if (!Number.isFinite(markPrice) || markPrice <= 0) {
    return {
      nextPeakPrice: position.peakPrice,
      nextTrailingStop: position.trailingStop,
      closeReason: '',
    };
  }

  if (position.side === 'BUY') {
    const nextPeak = Math.max(position.peakPrice, markPrice);
    const gainPct = (nextPeak - position.entryPrice) / position.entryPrice;
    let nextTrail = position.trailingStop;
    if (gainPct >= risk.trailingActivationPct) {
      const candidate = Number((nextPeak * (1 - risk.trailingOffsetPct)).toFixed(6));
      nextTrail = nextTrail === null ? candidate : Math.max(nextTrail, candidate);
    }

    if (markPrice >= position.takeProfit) {
      return { nextPeakPrice: nextPeak, nextTrailingStop: nextTrail, closeReason: 'TAKE_PROFIT' };
    }
    if (nextTrail !== null && markPrice <= nextTrail) {
      return { nextPeakPrice: nextPeak, nextTrailingStop: nextTrail, closeReason: 'TRAILING_STOP' };
    }
    if (markPrice <= position.stopLoss) {
      return { nextPeakPrice: nextPeak, nextTrailingStop: nextTrail, closeReason: 'STOP_LOSS' };
    }
    return { nextPeakPrice: nextPeak, nextTrailingStop: nextTrail, closeReason: '' };
  }

  // SELL / SHORT position
  const nextPeak = Math.min(position.peakPrice, markPrice);
  const gainPct = (position.entryPrice - nextPeak) / position.entryPrice;
  let nextTrail = position.trailingStop;
  if (gainPct >= risk.trailingActivationPct) {
    const candidate = Number((nextPeak * (1 + risk.trailingOffsetPct)).toFixed(6));
    nextTrail = nextTrail === null ? candidate : Math.min(nextTrail, candidate);
  }

  if (markPrice <= position.takeProfit) {
    return { nextPeakPrice: nextPeak, nextTrailingStop: nextTrail, closeReason: 'TAKE_PROFIT' };
  }
  if (nextTrail !== null && markPrice >= nextTrail) {
    return { nextPeakPrice: nextPeak, nextTrailingStop: nextTrail, closeReason: 'TRAILING_STOP' };
  }
  if (markPrice >= position.stopLoss) {
    return { nextPeakPrice: nextPeak, nextTrailingStop: nextTrail, closeReason: 'STOP_LOSS' };
  }
  return { nextPeakPrice: nextPeak, nextTrailingStop: nextTrail, closeReason: '' };
}

export function computeNextPaperWinStreak(
  currentStreak: number,
  tradingMode: UnifiedTradingMode,
  netPnlUsd: number
): number {
  if (tradingMode !== 'PAPER_DRY_RUN') {
    return Math.max(0, Math.floor(currentStreak));
  }
  return netPnlUsd > 0 ? Math.max(0, Math.floor(currentStreak)) + 1 : 0;
}

export function computeDailyDrawdownPct(
  dayStartEquityUsd: number,
  currentPortfolioValueUsd: number
): number {
  if (!Number.isFinite(dayStartEquityUsd) || dayStartEquityUsd <= 0) return 0;
  const dd = (dayStartEquityUsd - currentPortfolioValueUsd) / dayStartEquityUsd;
  return Number(Math.max(0, dd).toFixed(4));
}

export function formatTelegramRpcResponse(
  rawCommand: string,
  metrics: UnifiedEngineMetrics
): { readonly recognized: boolean; readonly command: string; readonly action: 'START' | 'STOP' | 'READ' | 'UNKNOWN'; readonly response: string } {
  const token = rawCommand.trim().toLowerCase().split(/\s+/)[0] ?? '';

  if (token === '/start') {
    return {
      recognized: true,
      command: '/start',
      action: 'START',
      response: `Signal Forge RPC [${metrics.tradingMode}]: Automated AI execution STARTED via unified CCXT gateway.`,
    };
  }

  if (token === '/stop') {
    return {
      recognized: true,
      command: '/stop',
      action: 'STOP',
      response: `Signal Forge RPC [${metrics.tradingMode}]: Automated entries STOPPED. Protective SL/TP/Trailing monitors remain active.`,
    };
  }

  if (token === '/status') {
    const gate = metrics.liveGateUnlocked
      ? 'UNLOCKED'
      : `LOCKED (${metrics.consecutivePaperWins}/${metrics.requiredPaperWins})`;
    return {
      recognized: true,
      command: '/status',
      action: 'READ',
      response: [
        `Signal Forge Status [${metrics.tradingMode}]`,
        `Bot: ${metrics.botRunning ? 'RUNNING' : 'STOPPED'} · Open Positions: ${metrics.openPositionsCount}`,
        `Portfolio Value: $${metrics.portfolioValueUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Unrealized ${metrics.unrealizedPnlUsd >= 0 ? '+' : ''}$${metrics.unrealizedPnlUsd.toFixed(2)})`,
        `Active Daily Drawdown: ${(metrics.dailyDrawdownPct * 100).toFixed(2)}% / ${(metrics.maxDailyDrawdownPct * 100).toFixed(1)}% Cap`,
        `Live Validation Gate: ${gate}`,
      ].join('\n'),
    };
  }

  if (token === '/profit') {
    return {
      recognized: true,
      command: '/profit',
      action: 'READ',
      response: [
        `Signal Forge Profit Summary [${metrics.tradingMode}]`,
        `Realized Equity: $${metrics.equityUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        `Cumulative Realized PnL: ${metrics.realizedPnlTotalUsd >= 0 ? '+' : ''}$${metrics.realizedPnlTotalUsd.toFixed(2)}`,
        `Closed Trades: ${metrics.closedTradesCount} · Win Rate: ${metrics.winRatePct.toFixed(1)}%`,
        `Consecutive Profitable Paper Streak: ${metrics.consecutivePaperWins}/${metrics.requiredPaperWins}`,
      ].join('\n'),
    };
  }

  return {
    recognized: false,
    command: token || '(empty)',
    action: 'UNKNOWN',
    response: `Unsupported command "${token}". Available RPC commands: ${ALLOWED_TELEGRAM_RPC_COMMANDS.join(', ')}`,
  };
}

export function formatSystemAuditMessage(input: {
  readonly tradingMode: UnifiedTradingMode;
  readonly cpuPct: number;
  readonly memoryMb: number;
  readonly latencyMs: number;
  readonly executionErrors: number;
  readonly portfolioValueUsd: number;
  readonly dailyDrawdownPct: number;
}): string {
  return [
    `[SYSTEM AUDIT · ${input.tradingMode}]`,
    `CPU: ${input.cpuPct.toFixed(1)}% | Memory: ${input.memoryMb.toFixed(1)} MB | Latency: ${input.latencyMs.toFixed(1)} ms`,
    `Execution Errors: ${input.executionErrors} | Daily Drawdown: ${(input.dailyDrawdownPct * 100).toFixed(2)}% / 8.00%`,
    `Live Portfolio Value: $${input.portfolioValueUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  ].join('\n');
}

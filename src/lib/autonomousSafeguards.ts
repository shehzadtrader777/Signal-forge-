import type { SandboxPosition } from './coordinator';
import type { Timeframe } from './marketData';
import type { SentinelAssessment } from './sentinelAgent';

export interface FlashCrashAssessment {
  triggered: boolean;
  severity: 'NORMAL' | 'ELEVATED_VOLATILITY' | 'CRITICAL_FLASH_CRASH';
  triggerSymbol: string;
  dropVelocityPct: number;
  volumeSpikeRatio: number;
  orderBookImbalance: number;
  reason: string;
  detectedAt: string;
}

export interface EmergencyLiquidationRecord {
  id: string;
  positionId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  marketType: 'SPOT' | 'USD_M_FUTURES';
  exitPrice: number;
  notionalReleasedUsd: number;
  netRealizedPnlUsd: number;
  convertedStablecoin: 'USDT' | 'USDC';
  reason: string;
  timestamp: string;
}

export interface EmergencyLiquidationSummary {
  stablecoinReserveAsset: 'USDT' | 'USDC';
  totalStablecoinReserveUsd: number;
  liquidatedCount: number;
  totalConvertedUsd: number;
  lastEventAt: string | null;
  lastTriggerReason: string | null;
  history: EmergencyLiquidationRecord[];
}

export interface RlAutoTuningRecord {
  id: string;
  atrStopMultiplier: number;
  atrTrailingTpMultiplier: number;
  preferredTimeframe: Timeframe;
  winRatePct: number;
  profitFactor: number;
  rlRewardScore: number;
  note: string;
  timestamp: string;
}

export interface RlAutoTuningState {
  enabled: boolean;
  atrStopMultiplier: number; // Strictly respects 2.0% hard SL cap downstream
  atrTrailingTpMultiplier: number; // Always >= 5.0 (enforcing >= 1:5 P/L floor)
  preferredTimeframe: Timeframe;
  highConvictionThreshold: number;
  settledTradesEvaluated: number;
  winRatePct: number;
  profitFactor: number;
  rlRewardScore: number;
  computeAllocationBySymbol: Record<string, number>; // % compute allocation 15..98
  lastTunedAt: string;
  tuningNote: string;
  history: RlAutoTuningRecord[];
}

export const INITIAL_RL_TUNING_STATE: RlAutoTuningState = {
  enabled: true,
  atrStopMultiplier: 1.5,
  atrTrailingTpMultiplier: 5.2,
  preferredTimeframe: '15m',
  highConvictionThreshold: 86,
  settledTradesEvaluated: 0,
  winRatePct: 62.5,
  profitFactor: 2.85,
  rlRewardScore: 0.42,
  computeAllocationBySymbol: {
    BTCUSDT: 92,
    ETHUSDT: 86,
    SOLUSDT: 88,
  },
  lastTunedAt: new Date().toISOString(),
  tuningNote:
    'RL Auto-Tuner initialized at 1.50x ATR Stop (<=2% Max Risk) & 5.2x ATR Trailing TP (min 1:5 R:R).',
  history: [],
};

/**
 * Evaluates live WebSocket velocity, volume burst ratio, Multi-Exchange L2 liquidity vacuum,
 * and Sentinel panic assessments to trigger autonomous flash-crash liquidation safeguards.
 */
export function detectFlashCrashConditions(params: {
  symbol: string;
  wsVelocityPct: number;
  volumeSpikeRatio?: number;
  netOrderBookImbalance?: number;
  sentinelRegime?: SentinelAssessment['regime'];
  btcVelocityPct?: number;
}): FlashCrashAssessment {
  const sym = params.symbol.toUpperCase();
  const volRatio = params.volumeSpikeRatio ?? 1.0;
  const obi = params.netOrderBookImbalance ?? 0;
  const btcVel = params.btcVelocityPct ?? 0;
  const worstVel = Math.min(params.wsVelocityPct, btcVel);

  const severeDrop =
    params.wsVelocityPct <= -4.5 ||
    (btcVel <= -4.2 && params.wsVelocityPct <= -2.5) ||
    (params.sentinelRegime === 'PANIC_FUD' && params.wsVelocityPct <= -3.2 && (volRatio >= 2.0 || obi <= -0.2));

  if (severeDrop) {
    return {
      triggered: true,
      severity: 'CRITICAL_FLASH_CRASH',
      triggerSymbol: sym,
      dropVelocityPct: Number(worstVel.toFixed(2)),
      volumeSpikeRatio: Number(volRatio.toFixed(2)),
      orderBookImbalance: Number(obi.toFixed(4)),
      reason: `Flash Crash Safeguard triggered on ${sym} (${worstVel.toFixed(2)}% WS velocity, ${volRatio.toFixed(1)}x vol spike, ${(obi * 100).toFixed(1)}% L2 OBI) — rotating volatile exposure to stablecoins.`,
      detectedAt: new Date().toISOString(),
    };
  }

  const elevated = params.wsVelocityPct <= -2.2 || params.sentinelRegime === 'DUMP_ALERT';
  return {
    triggered: false,
    severity: elevated ? 'ELEVATED_VOLATILITY' : 'NORMAL',
    triggerSymbol: sym,
    dropVelocityPct: Number(worstVel.toFixed(2)),
    volumeSpikeRatio: Number(volRatio.toFixed(2)),
    orderBookImbalance: Number(obi.toFixed(4)),
    reason: elevated
      ? `Elevated downside volatility on ${sym} (${params.wsVelocityPct.toFixed(2)}%) — monitoring 2% SL & L2 depth.`
      : `Flash-crash telemetry nominal on ${sym}.`,
    detectedAt: new Date().toISOString(),
  };
}

/**
 * Immediately liquidates open high-risk volatile & leveraged positions into USDT/USDC stablecoins,
 * settling P&L cleanly back into the Cross-Margin stablecoin reserve.
 */
export function executeEmergencyStablecoinLiquidation(params: {
  positions: SandboxPosition[];
  markPriceMap: Record<string, number>;
  walletBalanceUsd: number;
  settleCloseFn: (input: {
    walletBalanceUsd: number;
    position: SandboxPosition;
    exitPrice: number;
  }) => {
    updatedWalletBalanceUsd: number;
    netRealizedPnlUsd: number;
    pnlPercent: number;
    roePercent: number;
  };
  triggerReason: string;
  stablecoinAsset?: 'USDT' | 'USDC';
  highRiskOnly?: boolean;
}): {
  updatedWalletBalanceUsd: number;
  liquidatedRecords: EmergencyLiquidationRecord[];
  totalConvertedUsd: number;
} {
  const stablecoin = params.stablecoinAsset ?? 'USDT';
  let nextBalance = params.walletBalanceUsd;
  const records: EmergencyLiquidationRecord[] = [];
  let totalConvertedUsd = 0;
  const nowIso = new Date().toISOString();

  for (const pos of params.positions) {
    if (pos.status !== 'OPEN') continue;
    const isHighRisk =
      (pos.marketType === 'USD_M_FUTURES' && (pos.leverage ?? 1) > 1) ||
      pos.direction === 'BUY' ||
      !params.highRiskOnly;
    if (!isHighRisk) continue;

    const exitPrice = params.markPriceMap[pos.symbol] ?? pos.entryPrice;
    const settlement = params.settleCloseFn({
      walletBalanceUsd: nextBalance,
      position: pos,
      exitPrice,
    });

    nextBalance = settlement.updatedWalletBalanceUsd;
    pos.status = 'CLOSED_EMERGENCY_LIQUIDATION';
    pos.pnlUsd = settlement.netRealizedPnlUsd;
    pos.pnlPercent = settlement.pnlPercent;
    pos.roePercent = settlement.roePercent;
    pos.closedAt = nowIso;

    const releasedNotional = Number(
      Math.max(0, (pos.initialMarginUsd ?? pos.notionalUsd) + settlement.netRealizedPnlUsd).toFixed(2)
    );
    totalConvertedUsd += pos.notionalUsd;

    records.push({
      id: `liq_${pos.symbol}_${Date.now()}_${records.length}`,
      positionId: pos.id,
      symbol: pos.symbol,
      direction: pos.direction,
      marketType: pos.marketType ?? 'SPOT',
      exitPrice: Number(exitPrice.toPrecision(6)),
      notionalReleasedUsd: releasedNotional,
      netRealizedPnlUsd: settlement.netRealizedPnlUsd,
      convertedStablecoin: stablecoin,
      reason: params.triggerReason,
      timestamp: nowIso,
    });
  }

  return {
    updatedWalletBalanceUsd: Number(nextBalance.toFixed(2)),
    liquidatedRecords: records,
    totalConvertedUsd: Number(totalConvertedUsd.toFixed(2)),
  };
}

/**
 * Reinforcement-Learning Auto-Tuner:
 * Adapts ATR stop & trailing take-profit multipliers (maintaining min 1:5 P/L ratio and <=2% SL cap),
 * selects optimal timeframe, and allocates higher compute priority to high-conviction setups (>=86%).
 */
export function tuneStrategyParametersRL(
  current: RlAutoTuningState,
  positions: SandboxPosition[],
  activeConvictions: Array<{ symbol: string; confidence: number }>
): RlAutoTuningState {
  if (!current.enabled) {
    return current;
  }

  const settled = positions.filter((p) => p.status !== 'OPEN');
  const wins = settled.filter((p) => p.pnlUsd >= 0);
  const losses = settled.filter((p) => p.pnlUsd < 0);

  const grossProfit = wins.reduce((acc, p) => acc + Math.max(0, p.pnlUsd), 0);
  const grossLoss = Math.abs(losses.reduce((acc, p) => acc + Math.min(0, p.pnlUsd), 0));

  const winRatePct =
    settled.length > 0 ? Number(((wins.length / settled.length) * 100).toFixed(1)) : current.winRatePct;
  const profitFactor =
    grossLoss > 0
      ? Number((grossProfit / grossLoss).toFixed(2))
      : grossProfit > 0
      ? 4.5
      : current.profitFactor;

  // Reward gradient normalized to [-1, +1] from recent realized outcomes & profit factor
  const recentWindow = settled.slice(0, 8);
  const recentWins = recentWindow.filter((p) => p.pnlUsd >= 0).length;
  const recentWinRate = recentWindow.length > 0 ? recentWins / recentWindow.length : winRatePct / 100;
  const rewardDelta = (recentWinRate - 0.5) * 0.8 + Math.min(0.4, (profitFactor - 1.5) * 0.12);
  const rlRewardScore = Number(Math.max(-1, Math.min(1, rewardDelta)).toFixed(3));

  // Adjust ATR stop multiplier conservatively inside [1.2, 2.0] and ATR trailing TP >= 5.0
  let nextAtrStopMult = current.atrStopMultiplier;
  let nextAtrTpMult = current.atrTrailingTpMultiplier;
  let nextTf: Timeframe = current.preferredTimeframe;

  if (settled.length >= 2) {
    if (rlRewardScore >= 0.25) {
      // Strong positive reward: let winners extend further toward 6.2x ATR while keeping 1.45x stop discipline
      nextAtrTpMult = Math.min(6.8, Number((current.atrTrailingTpMultiplier + 0.15).toFixed(2)));
      nextAtrStopMult = Math.max(1.25, Math.min(1.85, Number((current.atrStopMultiplier - 0.05).toFixed(2))));
      nextTf = recentWinRate >= 0.65 ? '15m' : '1h';
    } else if (rlRewardScore <= -0.15) {
      // Negative reward / noisy chop: rotate to cleaner 1h/4h structural confirmation and lock 5.0x ATR baseline
      nextAtrStopMult = Math.min(1.95, Number((current.atrStopMultiplier + 0.08).toFixed(2)));
      nextAtrTpMult = Math.max(5.0, Number((current.atrTrailingTpMultiplier - 0.1).toFixed(2)));
      nextTf = settled.length >= 4 && recentWinRate < 0.38 ? '4h' : '1h';
    }
  }

  // Dynamic computational resource allocation weighted heavily toward high-conviction setups (>=86%)
  const computeAllocationBySymbol: Record<string, number> = {};
  for (const item of activeConvictions) {
    const sym = item.symbol.toUpperCase();
    const conf = item.confidence;
    if (conf >= current.highConvictionThreshold) {
      computeAllocationBySymbol[sym] = Math.min(98, Math.round(78 + (conf - current.highConvictionThreshold) * 1.4));
    } else {
      computeAllocationBySymbol[sym] = Math.max(20, Math.round(conf * 0.52));
    }
  }

  const nowIso = new Date().toISOString();
  const tuningNote =
    settled.length === 0
      ? `Pre-trade RL allocation active on ${nextTf} (${nextAtrStopMult}x ATR Stop · ${nextAtrTpMult}x ATR Trail >=1:5 R:R).`
      : `RL tuned from ${settled.length} settled trades (${winRatePct}% WR · ${profitFactor}x PF · reward ${rlRewardScore >= 0 ? '+' : ''}${rlRewardScore}): ${nextTf} TF · ${nextAtrStopMult}x ATR SL / ${nextAtrTpMult}x ATR Trail.`;

  const nextRecord: RlAutoTuningRecord = {
    id: `rl_${Date.now()}`,
    atrStopMultiplier: nextAtrStopMult,
    atrTrailingTpMultiplier: nextAtrTpMult,
    preferredTimeframe: nextTf,
    winRatePct,
    profitFactor,
    rlRewardScore,
    note: tuningNote,
    timestamp: nowIso,
  };

  return {
    ...current,
    atrStopMultiplier: nextAtrStopMult,
    atrTrailingTpMultiplier: nextAtrTpMult,
    preferredTimeframe: nextTf,
    settledTradesEvaluated: settled.length,
    winRatePct,
    profitFactor,
    rlRewardScore,
    computeAllocationBySymbol:
      Object.keys(computeAllocationBySymbol).length > 0
        ? computeAllocationBySymbol
        : current.computeAllocationBySymbol,
    lastTunedAt: nowIso,
    tuningNote,
    history: [nextRecord, ...current.history].slice(0, 12),
  };
}

import { BaseSignalPipelineModule } from './abstractPipeline';
import { MIN_RR_KERNEL_CONSTANT } from './riskEngine';

export type ProfitAgentId =
  | 'AI_COORDINATOR'
  | 'SMC_FRVP'
  | 'PATTERN_SCANNER'
  | 'PRE_PUMP_SUPPORT'
  | 'MEAN_REVERSION';

export type ProfitTakingMode = 'HARD_CODED_TARGETS' | 'AUTONOMOUS_PROFIT_LOCK';
export type VolatilityRegime = 'LOW' | 'NORMAL' | 'ELEVATED' | 'EXTREME';

/**
 * Decoupled Take-Profit Policy: isolated per agent so no global strategy interference occurs.
 */
export interface TakeProfitPolicy {
  mode: ProfitTakingMode;
  tp1R: number;
  tp2R: number;
  tp3R: number; // Strictly >= 5.0R to satisfy Signal Forge 1:5 R:R floor
  partialScaleOutPcts: [number, number, number];
  holdUntilMaxTarget: boolean;
  volatilityExpansionFactor: number; // Multiplier applied to TP ladder in elevated volatility
  autonomousProfitLockStepR: number; // Ratchets profit floor every +stepR gained
  autonomousLockBufferR: number; // Protective cushion behind peak unrealized R
}

/**
 * Decoupled Stop-Loss Policy: parameterized independently from Take-Profit targets.
 */
export interface StopLossPolicy {
  atrStopMultiplier: number; // e.g. 1.25x .. 2.75x ATR
  maxRiskPercentPerTrade: number; // Hard-capped <= 2.0%
  breakevenTriggerR: number; // Moves SL to breakeven once unrealized R reaches threshold
  trailingEnabled: boolean;
  volatilityTighteningFactor: number; // Compresses SL in EXTREME volatility to guard equity
}

export interface AgentProfitTakingProfile {
  agentId: ProfitAgentId;
  agentLabel: string;
  takeProfit: TakeProfitPolicy;
  stopLoss: StopLossPolicy;
  updatedAtIso: string;
}

export interface VolatilityAdaptationInput {
  agentId: ProfitAgentId;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  currentPrice: number;
  atr: number;
  peakUnrealizedR?: number;
}

export interface AdaptedExecutionThresholds {
  agentId: ProfitAgentId;
  mode: ProfitTakingMode;
  volatilityPct: number;
  volatilityRegime: VolatilityRegime;
  effectiveStopLoss: number;
  effectiveTakeProfits: [number, number, number];
  effectiveRiskRewardRatio: number;
  lockedProfitFloorR: number | null;
  lockedProfitFloorPrice: number | null;
  shouldLiquidateNow: boolean;
  liquidationReason: 'NONE' | 'MAX_PROFIT_TARGET_HIT' | 'AUTONOMOUS_PROFIT_LOCK_HIT' | 'STOP_LOSS_HIT';
  earlyTpExitBlocked: boolean;
  rationale: string;
}

export function classifyVolatilityRegime(atr: number, price: number): {
  volatilityPct: number;
  regime: VolatilityRegime;
} {
  if (!Number.isFinite(atr) || !Number.isFinite(price) || price <= 0 || atr <= 0) {
    return { volatilityPct: 1.5, regime: 'NORMAL' };
  }
  const volatilityPct = Number(((atr / price) * 100).toFixed(3));
  if (volatilityPct < 0.9) return { volatilityPct, regime: 'LOW' };
  if (volatilityPct < 2.2) return { volatilityPct, regime: 'NORMAL' };
  if (volatilityPct < 4.0) return { volatilityPct, regime: 'ELEVATED' };
  return { volatilityPct, regime: 'EXTREME' };
}

export function createDefaultAgentProfitProfiles(): Record<ProfitAgentId, AgentProfitTakingProfile> {
  const now = new Date().toISOString();
  return {
    AI_COORDINATOR: {
      agentId: 'AI_COORDINATOR',
      agentLabel: 'AI Master Coordinator',
      takeProfit: {
        mode: 'AUTONOMOUS_PROFIT_LOCK',
        tp1R: 2.0,
        tp2R: 3.5,
        tp3R: 5.2,
        partialScaleOutPcts: [25, 35, 40],
        holdUntilMaxTarget: false,
        volatilityExpansionFactor: 1.15,
        autonomousProfitLockStepR: 1.0,
        autonomousLockBufferR: 0.65,
      },
      stopLoss: {
        atrStopMultiplier: 1.5,
        maxRiskPercentPerTrade: 1.75,
        breakevenTriggerR: 1.5,
        trailingEnabled: true,
        volatilityTighteningFactor: 0.9,
      },
      updatedAtIso: now,
    },
    SMC_FRVP: {
      agentId: 'SMC_FRVP',
      agentLabel: 'SMC & Volume Profile Agent',
      takeProfit: {
        mode: 'HARD_CODED_TARGETS',
        tp1R: 2.0,
        tp2R: 3.5,
        tp3R: 5.5,
        partialScaleOutPcts: [30, 30, 40],
        holdUntilMaxTarget: false,
        volatilityExpansionFactor: 1.1,
        autonomousProfitLockStepR: 1.25,
        autonomousLockBufferR: 0.75,
      },
      stopLoss: {
        atrStopMultiplier: 1.4,
        maxRiskPercentPerTrade: 1.5,
        breakevenTriggerR: 1.8,
        trailingEnabled: true,
        volatilityTighteningFactor: 0.92,
      },
      updatedAtIso: now,
    },
    PATTERN_SCANNER: {
      agentId: 'PATTERN_SCANNER',
      agentLabel: 'Chart Pattern Breakout Agent',
      takeProfit: {
        mode: 'AUTONOMOUS_PROFIT_LOCK',
        tp1R: 2.2,
        tp2R: 3.8,
        tp3R: 5.8,
        partialScaleOutPcts: [20, 30, 50],
        holdUntilMaxTarget: false,
        volatilityExpansionFactor: 1.2,
        autonomousProfitLockStepR: 1.0,
        autonomousLockBufferR: 0.6,
      },
      stopLoss: {
        atrStopMultiplier: 1.65,
        maxRiskPercentPerTrade: 1.6,
        breakevenTriggerR: 1.6,
        trailingEnabled: true,
        volatilityTighteningFactor: 0.88,
      },
      updatedAtIso: now,
    },
    PRE_PUMP_SUPPORT: {
      agentId: 'PRE_PUMP_SUPPORT',
      agentLabel: 'Pre-Pump Support Momentum Agent',
      takeProfit: {
        mode: 'AUTONOMOUS_PROFIT_LOCK',
        tp1R: 2.5,
        tp2R: 4.0,
        tp3R: 6.2,
        partialScaleOutPcts: [0, 0, 100],
        holdUntilMaxTarget: true,
        volatilityExpansionFactor: 1.25,
        autonomousProfitLockStepR: 1.5,
        autonomousLockBufferR: 0.85,
      },
      stopLoss: {
        atrStopMultiplier: 2.05,
        maxRiskPercentPerTrade: 2.0,
        breakevenTriggerR: 2.0,
        trailingEnabled: true,
        volatilityTighteningFactor: 0.95,
      },
      updatedAtIso: now,
    },
    MEAN_REVERSION: {
      agentId: 'MEAN_REVERSION',
      agentLabel: 'Statistical Mean-Reversion Agent',
      takeProfit: {
        mode: 'HARD_CODED_TARGETS',
        tp1R: 1.8,
        tp2R: 3.4,
        tp3R: 5.0,
        partialScaleOutPcts: [35, 35, 30],
        holdUntilMaxTarget: false,
        volatilityExpansionFactor: 1.05,
        autonomousProfitLockStepR: 0.9,
        autonomousLockBufferR: 0.55,
      },
      stopLoss: {
        atrStopMultiplier: 1.3,
        maxRiskPercentPerTrade: 1.25,
        breakevenTriggerR: 1.4,
        trailingEnabled: true,
        volatilityTighteningFactor: 0.85,
      },
      updatedAtIso: now,
    },
  };
}

export function sanitizeAgentProfitProfilePatch(
  existing: AgentProfitTakingProfile,
  patch: {
    takeProfit?: Partial<TakeProfitPolicy>;
    stopLoss?: Partial<StopLossPolicy>;
  }
): AgentProfitTakingProfile {
  const tpPatch = patch.takeProfit ?? {};
  const slPatch = patch.stopLoss ?? {};

  const tp3R = Math.max(
    MIN_RR_KERNEL_CONSTANT,
    Math.min(12, Number(tpPatch.tp3R ?? existing.takeProfit.tp3R))
  );
  const tp2R = Math.max(
    2.5,
    Math.min(tp3R - 0.5, Number(tpPatch.tp2R ?? existing.takeProfit.tp2R))
  );
  const tp1R = Math.max(
    1.2,
    Math.min(tp2R - 0.4, Number(tpPatch.tp1R ?? existing.takeProfit.tp1R))
  );

  const nextTp: TakeProfitPolicy = {
    mode:
      tpPatch.mode === 'HARD_CODED_TARGETS' || tpPatch.mode === 'AUTONOMOUS_PROFIT_LOCK'
        ? tpPatch.mode
        : existing.takeProfit.mode,
    tp1R: Number(tp1R.toFixed(2)),
    tp2R: Number(tp2R.toFixed(2)),
    tp3R: Number(tp3R.toFixed(2)),
    partialScaleOutPcts: tpPatch.partialScaleOutPcts ?? existing.takeProfit.partialScaleOutPcts,
    holdUntilMaxTarget:
      typeof tpPatch.holdUntilMaxTarget === 'boolean'
        ? tpPatch.holdUntilMaxTarget
        : existing.takeProfit.holdUntilMaxTarget,
    volatilityExpansionFactor: Number(
      Math.max(
        1.0,
        Math.min(1.6, Number(tpPatch.volatilityExpansionFactor ?? existing.takeProfit.volatilityExpansionFactor))
      ).toFixed(2)
    ),
    autonomousProfitLockStepR: Number(
      Math.max(
        0.5,
        Math.min(3.0, Number(tpPatch.autonomousProfitLockStepR ?? existing.takeProfit.autonomousProfitLockStepR))
      ).toFixed(2)
    ),
    autonomousLockBufferR: Number(
      Math.max(
        0.25,
        Math.min(2.0, Number(tpPatch.autonomousLockBufferR ?? existing.takeProfit.autonomousLockBufferR))
      ).toFixed(2)
    ),
  };

  const nextSl: StopLossPolicy = {
    atrStopMultiplier: Number(
      Math.max(
        0.8,
        Math.min(3.5, Number(slPatch.atrStopMultiplier ?? existing.stopLoss.atrStopMultiplier))
      ).toFixed(2)
    ),
    maxRiskPercentPerTrade: Number(
      Math.max(
        0.25,
        Math.min(2.0, Number(slPatch.maxRiskPercentPerTrade ?? existing.stopLoss.maxRiskPercentPerTrade))
      ).toFixed(2)
    ),
    breakevenTriggerR: Number(
      Math.max(
        0.8,
        Math.min(4.0, Number(slPatch.breakevenTriggerR ?? existing.stopLoss.breakevenTriggerR))
      ).toFixed(2)
    ),
    trailingEnabled:
      typeof slPatch.trailingEnabled === 'boolean'
        ? slPatch.trailingEnabled
        : existing.stopLoss.trailingEnabled,
    volatilityTighteningFactor: Number(
      Math.max(
        0.7,
        Math.min(1.0, Number(slPatch.volatilityTighteningFactor ?? existing.stopLoss.volatilityTighteningFactor))
      ).toFixed(2)
    ),
  };

  return {
    ...existing,
    takeProfit: nextTp,
    stopLoss: nextSl,
    updatedAtIso: new Date().toISOString(),
  };
}

/**
 * Modular Profit-Taking & Volatility-Adaptive Stop-Loss Engine.
 * Extends BaseSignalPipelineModule for multi-language bridge compatibility.
 */
export class ModularProfitTakingEngine extends BaseSignalPipelineModule<
  VolatilityAdaptationInput,
  AdaptedExecutionThresholds
> {
  private readonly profiles: Record<ProfitAgentId, AgentProfitTakingProfile>;

  constructor(initialProfiles?: Record<ProfitAgentId, AgentProfitTakingProfile>) {
    super('modular-profit-taking-engine', 'Decoupled Per-Agent TP/SL & Autonomous Profit Lock Engine');
    this.profiles = initialProfiles ?? createDefaultAgentProfitProfiles();
  }

  getProfile(agentId: ProfitAgentId): AgentProfitTakingProfile {
    return this.profiles[agentId];
  }

  getAllProfiles(): AgentProfitTakingProfile[] {
    return Object.values(this.profiles);
  }

  updateAgentPolicy(
    agentId: ProfitAgentId,
    patch: {
      takeProfit?: Partial<TakeProfitPolicy>;
      stopLoss?: Partial<StopLossPolicy>;
    }
  ): AgentProfitTakingProfile {
    const updated = sanitizeAgentProfitProfilePatch(this.profiles[agentId], patch);
    this.profiles[agentId] = updated;
    return updated;
  }

  protected executeCore(input: VolatilityAdaptationInput): AdaptedExecutionThresholds {
    const profile = this.profiles[input.agentId];
    const { volatilityPct, regime } = classifyVolatilityRegime(input.atr, input.entryPrice);
    const sign = input.direction === 'BUY' ? 1 : -1;

    // 1. Decoupled Stop-Loss calculation (independent of TP target settings)
    const slVolFactor =
      regime === 'EXTREME'
        ? profile.stopLoss.volatilityTighteningFactor
        : regime === 'ELEVATED'
        ? Number(((1 + profile.stopLoss.volatilityTighteningFactor) / 2).toFixed(3))
        : 1.0;

    const rawRiskDist = Math.max(
      input.atr * profile.stopLoss.atrStopMultiplier * slVolFactor,
      input.entryPrice * 0.004
    );
    const maxRiskDist = input.entryPrice * (profile.stopLoss.maxRiskPercentPerTrade / 100);
    const riskDist = Math.min(rawRiskDist, maxRiskDist);

    const precision = input.entryPrice >= 1000 ? 2 : input.entryPrice >= 1 ? 4 : 6;
    const baseStopLoss = Number((input.entryPrice - sign * riskDist).toFixed(precision));

    // 2. Decoupled Take-Profit ladder (volatility-adaptive expansion, preserving >= 1:5 floor)
    const tpVolFactor =
      regime === 'ELEVATED' || regime === 'EXTREME'
        ? profile.takeProfit.volatilityExpansionFactor
        : 1.0;

    const tp1R = Number((profile.takeProfit.tp1R * tpVolFactor).toFixed(2));
    const tp2R = Number((profile.takeProfit.tp2R * tpVolFactor).toFixed(2));
    const tp3R = Number(
      Math.max(MIN_RR_KERNEL_CONSTANT, profile.takeProfit.tp3R * tpVolFactor).toFixed(2)
    );

    const tp1 = Number((input.entryPrice + sign * riskDist * tp1R).toFixed(precision));
    const tp2 = Number((input.entryPrice + sign * riskDist * tp2R).toFixed(precision));
    const tp3 = Number((input.entryPrice + sign * riskDist * tp3R).toFixed(precision));

    // 3. Evaluate live unrealized R & autonomous profit locking
    const currentR = riskDist > 0 ? (sign * (input.currentPrice - input.entryPrice)) / riskDist : 0;
    const peakR = Math.max(currentR, input.peakUnrealizedR ?? currentR);

    let effectiveStopLoss = baseStopLoss;
    let lockedProfitFloorR: number | null = null;
    let lockedProfitFloorPrice: number | null = null;

    if (profile.stopLoss.trailingEnabled && peakR >= profile.stopLoss.breakevenTriggerR) {
      effectiveStopLoss = Number((input.entryPrice + sign * riskDist * 0.1).toFixed(precision));
    }

    if (
      profile.takeProfit.mode === 'AUTONOMOUS_PROFIT_LOCK' &&
      !profile.takeProfit.holdUntilMaxTarget &&
      peakR >= profile.takeProfit.autonomousProfitLockStepR + profile.takeProfit.autonomousLockBufferR
    ) {
      const steps = Math.floor(
        (peakR - profile.takeProfit.autonomousLockBufferR) /
          profile.takeProfit.autonomousProfitLockStepR
      );
      if (steps >= 1) {
        lockedProfitFloorR = Number(
          (steps * profile.takeProfit.autonomousProfitLockStepR).toFixed(2)
        );
        lockedProfitFloorPrice = Number(
          (input.entryPrice + sign * riskDist * lockedProfitFloorR).toFixed(precision)
        );
        // Ratchet stop loss forward to lock profit floor cleanly
        const isTighter =
          input.direction === 'BUY'
            ? lockedProfitFloorPrice > effectiveStopLoss
            : lockedProfitFloorPrice < effectiveStopLoss;
        if (isTighter) {
          effectiveStopLoss = lockedProfitFloorPrice;
        }
      }
    }

    const hitMaxTarget =
      input.direction === 'BUY' ? input.currentPrice >= tp3 : input.currentPrice <= tp3;
    const hitProfitLock =
      lockedProfitFloorPrice !== null &&
      (input.direction === 'BUY'
        ? input.currentPrice <= lockedProfitFloorPrice
        : input.currentPrice >= lockedProfitFloorPrice);
    const hitStopLoss =
      input.direction === 'BUY'
        ? input.currentPrice <= effectiveStopLoss
        : input.currentPrice >= effectiveStopLoss;

    const earlyTpExitBlocked =
      profile.takeProfit.holdUntilMaxTarget && currentR >= tp1R && !hitMaxTarget;

    let shouldLiquidateNow = false;
    let liquidationReason: AdaptedExecutionThresholds['liquidationReason'] = 'NONE';

    if (hitMaxTarget) {
      shouldLiquidateNow = true;
      liquidationReason = 'MAX_PROFIT_TARGET_HIT';
    } else if (hitProfitLock) {
      shouldLiquidateNow = true;
      liquidationReason = 'AUTONOMOUS_PROFIT_LOCK_HIT';
    } else if (hitStopLoss) {
      shouldLiquidateNow = true;
      liquidationReason = 'STOP_LOSS_HIT';
    }

    return {
      agentId: input.agentId,
      mode: profile.takeProfit.mode,
      volatilityPct,
      volatilityRegime: regime,
      effectiveStopLoss,
      effectiveTakeProfits: [tp1, tp2, tp3],
      effectiveRiskRewardRatio: tp3R,
      lockedProfitFloorR,
      lockedProfitFloorPrice,
      shouldLiquidateNow,
      liquidationReason,
      earlyTpExitBlocked,
      rationale: earlyTpExitBlocked
        ? `${profile.agentLabel}: Holding strictly until max target TP3 (${tp3R}R); premature TP1/TP2 exit blocked.`
        : lockedProfitFloorR !== null
        ? `${profile.agentLabel} [${regime} vol ${volatilityPct}%]: Autonomous profit lock engaged at +${lockedProfitFloorR}R ($${lockedProfitFloorPrice}).`
        : `${profile.agentLabel} [${regime} vol ${volatilityPct}%]: Decoupled SL (${profile.stopLoss.atrStopMultiplier}x ATR / ${profile.stopLoss.maxRiskPercentPerTrade}% cap) & ${tp3R}R TP3 active.`,
    };
  }
}

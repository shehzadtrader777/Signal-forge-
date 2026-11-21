/**
 * Signal Forge Multi-Agent Debate Consensus Contracts, Risk-Kernel Verification,
 * Hardened Yearn V2 Locked-Profit Degradation (6h), and Self-Healing Health Supervisor.
 */

export type KernelAgentRole =
  | 'STRATEGY_GENERATOR'
  | 'INDICATOR_ANALYST'
  | 'BACKTEST_VALIDATOR';

export interface MarketDebateContext {
  readonly symbol: string;
  readonly timeframe: string;
  readonly livePrice: number;
  readonly change24hPercent: number;
  readonly volume24hUsd: number;
  readonly atrPercent?: number;
  readonly notes?: string;
}

export interface KernelAgentProposal {
  readonly role: KernelAgentRole;
  readonly label: string;
  readonly bias: 'BUY' | 'SELL' | 'NEUTRAL';
  readonly confidence: number;
  readonly summary: string;
  readonly keyLevels: readonly string[];
  readonly latencyMs: number;
}

export interface DebateRoundRecord {
  readonly round: number;
  readonly critique: string;
  readonly consensusBias: 'BUY' | 'SELL' | 'NEUTRAL';
  readonly agreementScore: number;
  readonly latencyMs: number;
}

export interface CoordinatorSignalDecision {
  readonly symbol: string;
  readonly direction: 'BUY' | 'SELL';
  readonly entry: number;
  readonly tp: number;
  readonly sl: number;
  readonly confidence: number;
  readonly leverage: number;
  readonly riskRewardRatio: number;
  readonly stopLossDistancePct: number;
  readonly riskKernelEnforced: boolean;
  readonly riskKernelNotes: string;
  readonly rationale: string;
}

export interface MultiAgentDebateResult {
  readonly modelUsed: string;
  readonly generatedAtIso: string;
  readonly totalLatencyMs: number;
  readonly context: MarketDebateContext;
  readonly proposals: readonly KernelAgentProposal[];
  readonly debateRounds: readonly DebateRoundRecord[];
  readonly decision: CoordinatorSignalDecision;
}

export interface SearchGroundingCitation {
  readonly title: string;
  readonly uri: string;
}

export interface SearchGroundingResult {
  readonly query: string;
  readonly modelUsed: string;
  readonly answer: string;
  readonly citations: readonly SearchGroundingCitation[];
  readonly generatedAtIso: string;
  readonly latencyMs: number;
}

export interface RawCoordinatorDecisionInput {
  readonly symbol: string;
  readonly direction: 'BUY' | 'SELL';
  readonly entry: number;
  readonly tp: number;
  readonly sl: number;
  readonly confidence: number;
  readonly leverage: number;
  readonly rationale?: string;
}

export const MIN_COORDINATOR_RR_FLOOR = 5.0;
export const MAX_COORDINATOR_SL_PCT = 2.0;
export const DEFAULT_VAULT_UNLOCK_HOURS = 6;

function round4(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.round(val * 10_000) / 10_000;
}

/**
 * Enforces Signal Forge's non-negotiable risk invariants on every Coordinator output:
 * - Stop loss distance capped at <= 2.0% from entry.
 * - Take profit distance floored at >= 1:5 Risk-to-Reward ratio.
 * - Leverage clamped to [1, 10] and confidence clamped to [1, 99].
 */
export function enforceSignalRiskInvariants(
  raw: RawCoordinatorDecisionInput
): CoordinatorSignalDecision {
  const entry = Number.isFinite(raw.entry) && raw.entry > 0 ? raw.entry : 1;
  const direction: 'BUY' | 'SELL' = raw.direction === 'SELL' ? 'SELL' : 'BUY';
  const sign = direction === 'BUY' ? 1 : -1;

  const rawSlDist = Math.abs(entry - raw.sl);
  const maxSlDist = entry * (MAX_COORDINATOR_SL_PCT / 100);
  const minSlDist = entry * 0.0025; // 0.25% minimum structural breathing room

  let adjusted = false;
  const notes: string[] = [];

  const slCorrectSide = direction === 'BUY' ? raw.sl < entry : raw.sl > entry;
  let slDist = slCorrectSide && Number.isFinite(rawSlDist) && rawSlDist > 0 ? rawSlDist : entry * 0.015;
  if (!slCorrectSide || !Number.isFinite(rawSlDist) || rawSlDist <= 0) {
    adjusted = true;
    notes.push('SL aligned to directional side');
  }
  if (slDist > maxSlDist) {
    slDist = maxSlDist;
    adjusted = true;
    notes.push(`SL capped to ${MAX_COORDINATOR_SL_PCT.toFixed(1)}% max risk`);
  } else if (slDist < minSlDist) {
    slDist = minSlDist;
    adjusted = true;
    notes.push('SL widened to 0.25% min structural buffer');
  }

  const finalSl = round4(entry - sign * slDist);

  const rawTpDist = Math.abs(raw.tp - entry);
  const tpCorrectSide = direction === 'BUY' ? raw.tp > entry : raw.tp < entry;
  const minTpDist = slDist * MIN_COORDINATOR_RR_FLOOR;
  let tpDist = tpCorrectSide && Number.isFinite(rawTpDist) && rawTpDist > 0 ? rawTpDist : minTpDist;
  if (!tpCorrectSide || tpDist < minTpDist) {
    tpDist = minTpDist;
    adjusted = true;
    notes.push(`TP raised to satisfy >= 1:${MIN_COORDINATOR_RR_FLOOR} R:R floor`);
  }

  const finalTp = round4(entry + sign * tpDist);
  const rr = round4(tpDist / Math.max(1e-9, slDist));
  const slPct = round4((slDist / entry) * 100);
  const confidence = Math.min(99, Math.max(1, Math.round(Number(raw.confidence) || 70)));
  const leverage = Math.min(10, Math.max(1, Math.round(Number(raw.leverage) || 3)));

  return {
    symbol: raw.symbol.toUpperCase(),
    direction,
    entry: round4(entry),
    tp: finalTp,
    sl: finalSl,
    confidence,
    leverage,
    riskRewardRatio: rr,
    stopLossDistancePct: slPct,
    riskKernelEnforced: adjusted,
    riskKernelNotes: adjusted
      ? `Risk Kernel adjusted: ${notes.join('; ')}.`
      : `Risk Kernel verified: ${slPct.toFixed(2)}% SL · 1:${rr.toFixed(2)} R:R.`,
    rationale: raw.rationale?.trim() || 'Multi-agent debate consensus finalized.',
  };
}

export interface YearnDegradationSnapshot {
  readonly unlockDurationHours: number;
  readonly unlockDurationSec: number;
  readonly totalReportedGainUsd: number;
  readonly currentLockedProfitUsd: number;
  readonly currentFreeProfitUsd: number;
  readonly unlockedPercent: number;
  readonly remainingUnlockSec: number;
  readonly reportCount: number;
  readonly lastReportIso: string | null;
}

/**
 * Hardened Yearn V2-Style Locked Profit Degradation Schedule.
 * Fixes the DeepSeek overwrite defect: reporting a new gain carries forward any
 * currently still-locked profit (`nextLocked = currentLocked + newGain`) and resets
 * the linear degradation window without ever erasing prior unlocked or locked gains.
 */
export class YearnLockedProfitDegradation {
  private readonly unlockDurationSec: number;
  private activeBatchLockedUsd = 0;
  private lastReportMs = 0;
  private totalReportedGainUsd = 0;
  private permanentlyUnlockedUsd = 0;
  private reportCount = 0;

  constructor(unlockHours = DEFAULT_VAULT_UNLOCK_HOURS) {
    const cleanHours = Number.isFinite(unlockHours) && unlockHours > 0 ? Math.min(168, unlockHours) : DEFAULT_VAULT_UNLOCK_HOURS;
    this.unlockDurationSec = Math.round(cleanHours * 3600);
  }

  getLockedAmount(nowMs = Date.now()): number {
    if (this.activeBatchLockedUsd <= 0 || this.lastReportMs <= 0) return 0;
    const elapsedSec = Math.max(0, (nowMs - this.lastReportMs) / 1000);
    if (elapsedSec >= this.unlockDurationSec) return 0;
    const remainingRatio = 1 - elapsedSec / this.unlockDurationSec;
    return round4(this.activeBatchLockedUsd * remainingRatio);
  }

  getFreeProfit(nowMs = Date.now()): number {
    const stillLocked = this.getLockedAmount(nowMs);
    return round4(Math.max(0, this.totalReportedGainUsd - stillLocked));
  }

  reportGain(gainUsd: number, nowMs = Date.now()): YearnDegradationSnapshot {
    const cleanGain = round4(gainUsd);
    if (!Number.isFinite(cleanGain) || cleanGain <= 0) {
      return this.getSnapshot(nowMs);
    }

    const carryForwardLocked = this.getLockedAmount(nowMs);
    const newlyReleased = round4(Math.max(0, this.activeBatchLockedUsd - carryForwardLocked));
    this.permanentlyUnlockedUsd = round4(this.permanentlyUnlockedUsd + newlyReleased);
    this.activeBatchLockedUsd = round4(carryForwardLocked + cleanGain);
    this.totalReportedGainUsd = round4(this.totalReportedGainUsd + cleanGain);
    this.lastReportMs = nowMs;
    this.reportCount += 1;

    return this.getSnapshot(nowMs);
  }

  getSnapshot(nowMs = Date.now()): YearnDegradationSnapshot {
    const locked = this.getLockedAmount(nowMs);
    const free = this.getFreeProfit(nowMs);
    const elapsedSec = this.lastReportMs > 0 ? Math.max(0, (nowMs - this.lastReportMs) / 1000) : this.unlockDurationSec;
    const remainingUnlockSec = locked > 0 ? Math.max(0, Math.ceil(this.unlockDurationSec - elapsedSec)) : 0;
    const unlockedPercent =
      this.totalReportedGainUsd > 0
        ? round4((free / this.totalReportedGainUsd) * 100)
        : 100;

    return {
      unlockDurationHours: round4(this.unlockDurationSec / 3600),
      unlockDurationSec: this.unlockDurationSec,
      totalReportedGainUsd: this.totalReportedGainUsd,
      currentLockedProfitUsd: locked,
      currentFreeProfitUsd: free,
      unlockedPercent,
      remainingUnlockSec,
      reportCount: this.reportCount,
      lastReportIso: this.lastReportMs > 0 ? new Date(this.lastReportMs).toISOString() : null,
    };
  }
}

export type TelegramTransportMode = 'webhook' | 'polling';

export interface SubsystemHealthChecks {
  readonly cacheStore: 'healthy' | 'degraded';
  readonly binanceFeed: 'healthy' | 'fallback';
  readonly geminiApi: 'healthy' | 'unconfigured' | 'degraded';
  readonly vaultIntegrity: 'healthy' | 'degraded';
  readonly telegramMode: TelegramTransportMode;
}

export interface SelfHealingHealthSnapshot {
  readonly status: 'healthy' | 'degraded';
  readonly checkedAtIso: string;
  readonly checks: SubsystemHealthChecks;
  readonly consecutiveWebhookFailures: number;
  readonly autoFailoverCount: number;
  readonly lastAction: string;
  readonly probeIntervalSec: number;
}

/**
 * Self-Healing Supervisor implementing `/health` probe aggregation and automatic
 * Telegram `webhook -> polling` failover when consecutive webhook failures breach threshold.
 */
export class SelfHealingSupervisor {
  private telegramMode: TelegramTransportMode = 'webhook';
  private consecutiveWebhookFailures = 0;
  private autoFailoverCount = 0;
  private lastAction = 'All subsystems nominal in webhook transport mode';
  private lastCheckedAtIso = new Date().toISOString();
  private readonly failoverThreshold: number;
  private readonly probeIntervalSec: number;

  constructor(failoverThreshold = 2, probeIntervalSec = 30) {
    this.failoverThreshold = Math.max(1, failoverThreshold);
    this.probeIntervalSec = Math.max(5, probeIntervalSec);
  }

  recordTelegramWebhookProbe(healthy: boolean, nowMs = Date.now()): TelegramTransportMode {
    this.lastCheckedAtIso = new Date(nowMs).toISOString();
    if (healthy) {
      if (this.telegramMode === 'polling') {
        this.telegramMode = 'webhook';
        this.lastAction = 'Webhook recovered — self-healed back to primary webhook transport';
      }
      this.consecutiveWebhookFailures = 0;
      return this.telegramMode;
    }

    this.consecutiveWebhookFailures += 1;
    if (this.telegramMode === 'webhook' && this.consecutiveWebhookFailures >= this.failoverThreshold) {
      this.telegramMode = 'polling';
      this.autoFailoverCount += 1;
      this.lastAction = `Webhook failed ${this.consecutiveWebhookFailures}x — switched to polling failover (#${this.autoFailoverCount})`;
    }
    return this.telegramMode;
  }

  getTelegramMode(): TelegramTransportMode {
    return this.telegramMode;
  }

  buildHealthSnapshot(
    input: {
      readonly cacheStoreHealthy: boolean;
      readonly binanceFeedLive: boolean;
      readonly geminiStatus: 'healthy' | 'unconfigured' | 'degraded';
      readonly vaultHealthy: boolean;
    },
    nowMs = Date.now()
  ): SelfHealingHealthSnapshot {
    this.lastCheckedAtIso = new Date(nowMs).toISOString();
    const checks: SubsystemHealthChecks = {
      cacheStore: input.cacheStoreHealthy ? 'healthy' : 'degraded',
      binanceFeed: input.binanceFeedLive ? 'healthy' : 'fallback',
      geminiApi: input.geminiStatus,
      vaultIntegrity: input.vaultHealthy ? 'healthy' : 'degraded',
      telegramMode: this.telegramMode,
    };

    const overallHealthy =
      checks.cacheStore === 'healthy' &&
      checks.vaultIntegrity === 'healthy' &&
      (checks.telegramMode === 'webhook' || checks.telegramMode === 'polling') &&
      checks.geminiApi !== 'degraded';

    return {
      status: overallHealthy ? 'healthy' : 'degraded',
      checkedAtIso: this.lastCheckedAtIso,
      checks,
      consecutiveWebhookFailures: this.consecutiveWebhookFailures,
      autoFailoverCount: this.autoFailoverCount,
      lastAction: this.lastAction,
      probeIntervalSec: this.probeIntervalSec,
    };
  }
}

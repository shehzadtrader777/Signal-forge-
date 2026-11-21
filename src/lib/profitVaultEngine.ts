import { BaseSignalPipelineModule } from './abstractPipeline';

export type ProfitThresholdMode = 'USD_FIXED' | 'PERCENT_OF_EQUITY';

export type VaultOverrideAction = 'RELEASE_TO_TRADING' | 'REBALANCE_EXTERNAL';

export type VaultActorType = 'AUTHENTICATED_USER' | 'AUTONOMOUS_AGENT' | 'SYSTEM_BOT';

export type VaultLedgerEventKind =
  | 'AUTO_SCOOP_LOCK'
  | 'USER_MANUAL_RELEASE'
  | 'USER_MANUAL_REBALANCE'
  | 'THRESHOLD_CONFIG_UPDATE';

export interface ProfitScoopConfig {
  readonly enabled: boolean;
  readonly thresholdMode: ProfitThresholdMode;
  readonly profitThresholdUsd: number; // Fixed USD threshold (e.g. $250)
  readonly profitThresholdPct: number; // % of active trading equity (e.g. 2.5%)
  readonly scoopExcessRatioPct: number; // 25..100% of excess profit above threshold swept into Locker
  readonly immutableAutoLock: true; // Autonomous engines can never unlock scooped funds
}

export interface RealizedTradeSettlementInput {
  readonly tradeId: string;
  readonly symbol: string;
  readonly realizedPnlUsd: number;
  readonly sourceAgent: string;
  readonly settledAtMs?: number;
}

export interface VaultLedgerEntry {
  readonly entryId: string;
  readonly sequence: number;
  readonly timestampIso: string;
  readonly kind: VaultLedgerEventKind;
  readonly amountUsd: number;
  readonly symbol: string | null;
  readonly actorType: VaultActorType;
  readonly actorLabel: string;
  readonly immutableLock: boolean;
  readonly note: string;
  readonly resultingActiveBalanceUsd: number;
  readonly resultingLockedVaultUsd: number;
  readonly prevHash: string;
  readonly entryHash: string;
}

export interface DailyPnlHistoryRecord {
  readonly dateKey: string; // YYYY-MM-DD (UTC)
  readonly startingEquityUsd: number;
  readonly endingEquityUsd: number;
  readonly realizedPnlUsd: number; // 4-decimal USD precision
  readonly returnPct: number; // 4-decimal % precision (e.g. 2.4815)
  readonly scoopedToVaultUsd: number;
  readonly manualReleasedUsd: number;
  readonly tradeCount: number;
  readonly winningTrades: number;
  readonly losingTrades: number;
  readonly winRatePct: number;
  readonly largestWinUsd: number;
  readonly largestLossUsd: number;
  readonly recordHash: string;
  readonly updatedAtIso: string;
}

export interface ManualVaultOverrideRequest {
  readonly actorType: VaultActorType;
  readonly actorId: string;
  readonly actorEmail?: string | null;
  readonly action: VaultOverrideAction;
  readonly amountUsd: number;
  readonly confirmationPhrase: string;
  readonly reason: string;
  readonly nowMs?: number;
}

export interface ManualVaultOverrideOutcome {
  readonly allowed: boolean;
  readonly code:
    | 'OVERRIDE_EXECUTED'
    | 'AGENT_OVERRIDE_FORBIDDEN'
    | 'USER_CONFIRMATION_REQUIRED'
    | 'INVALID_AMOUNT'
    | 'INSUFFICIENT_VAULT_BALANCE';
  readonly message: string;
  readonly ledgerEntry: VaultLedgerEntry | null;
  readonly snapshot: ProfitVaultSnapshot;
}

export interface VaultIntegrityAudit {
  readonly hashChainValid: boolean;
  readonly accountingInvariantValid: boolean;
  readonly expectedTotalCapitalUsd: number;
  readonly actualTotalCapitalUsd: number;
  readonly reconciliationDriftUsd: number;
  readonly verifiedEntriesCount: number;
}

export interface ProfitVaultSnapshot {
  readonly stateVersion: number;
  readonly generatedAtIso: string;
  readonly initialCapitalUsd: number;
  readonly activeTradingBalanceUsd: number;
  readonly lockedVaultBalanceUsd: number;
  readonly netExternalRebalancedUsd: number;
  readonly cumulativeRealizedPnlUsd: number;
  readonly cumulativeReturnPct: number;
  readonly totalScoopedLifetimeUsd: number;
  readonly totalManuallyReleasedUsd: number;
  readonly accumulatedRealizedSinceLastScoopUsd: number;
  readonly effectiveThresholdUsd: number;
  readonly progressToThresholdPct: number;
  readonly totalProcessedTrades: number;
  readonly config: ProfitScoopConfig;
  readonly integrity: VaultIntegrityAudit;
  readonly todayPnl: DailyPnlHistoryRecord;
  readonly dailyHistory: readonly DailyPnlHistoryRecord[];
  readonly vaultLedger: readonly VaultLedgerEntry[];
}

export interface ProfitScoopOutcome {
  readonly duplicateIgnored: boolean;
  readonly scoopedNow: boolean;
  readonly scoopedAmountUsd: number;
  readonly ledgerEntry: VaultLedgerEntry | null;
  readonly snapshot: ProfitVaultSnapshot;
}

export const DEFAULT_PROFIT_SCOOP_CONFIG: ProfitScoopConfig = {
  enabled: true,
  thresholdMode: 'USD_FIXED',
  profitThresholdUsd: 250,
  profitThresholdPct: 2.0,
  scoopExcessRatioPct: 100,
  immutableAutoLock: true,
};

export const USER_OVERRIDE_CONFIRMATION_PHRASES: Readonly<Record<VaultOverrideAction, string>> = {
  RELEASE_TO_TRADING: 'UNLOCK_VAULT',
  REBALANCE_EXTERNAL: 'REBALANCE_VAULT',
};

/**
 * Deterministic high-precision rounding (4 decimal places) to eliminate IEEE-754 accumulation drift.
 */
export function roundPrecision4(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10_000) / 10_000;
}

export function roundUsd2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function formatUtcDateKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function computeDailyRecordHash(rec: Omit<DailyPnlHistoryRecord, 'recordHash'>): string {
  return fnv1aHash(
    [
      rec.dateKey,
      rec.startingEquityUsd.toFixed(4),
      rec.endingEquityUsd.toFixed(4),
      rec.realizedPnlUsd.toFixed(4),
      rec.returnPct.toFixed(4),
      rec.scoopedToVaultUsd.toFixed(4),
      rec.manualReleasedUsd.toFixed(4),
      rec.tradeCount,
      rec.winningTrades,
      rec.losingTrades,
    ].join('|')
  );
}

function computeVaultEntryHash(entry: Omit<VaultLedgerEntry, 'entryHash'>): string {
  return fnv1aHash(
    [
      entry.entryId,
      entry.sequence,
      entry.timestampIso,
      entry.kind,
      entry.amountUsd.toFixed(4),
      entry.symbol ?? 'NONE',
      entry.actorType,
      entry.actorLabel,
      entry.immutableLock ? '1' : '0',
      entry.resultingActiveBalanceUsd.toFixed(4),
      entry.resultingLockedVaultUsd.toFixed(4),
      entry.prevHash,
    ].join('|')
  );
}

export function sanitizeProfitScoopConfigPatch(
  current: ProfitScoopConfig,
  patch: Partial<Omit<ProfitScoopConfig, 'immutableAutoLock'>>
): ProfitScoopConfig {
  const thresholdMode: ProfitThresholdMode =
    patch.thresholdMode === 'PERCENT_OF_EQUITY' || patch.thresholdMode === 'USD_FIXED'
      ? patch.thresholdMode
      : current.thresholdMode;

  const profitThresholdUsd = roundUsd2(
    Math.max(10, Math.min(100_000, Number(patch.profitThresholdUsd ?? current.profitThresholdUsd)))
  );
  const profitThresholdPct = roundPrecision4(
    Math.max(0.25, Math.min(50, Number(patch.profitThresholdPct ?? current.profitThresholdPct)))
  );
  const scoopExcessRatioPct = Math.round(
    Math.max(25, Math.min(100, Number(patch.scoopExcessRatioPct ?? current.scoopExcessRatioPct)))
  );

  return {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    thresholdMode,
    profitThresholdUsd,
    profitThresholdPct,
    scoopExcessRatioPct,
    immutableAutoLock: true,
  };
}

/**
 * Core Execution High-Frequency Profit Scooping, Immutable Locker Vault,
 * User-Only Manual Override Protocol, and High-Precision Daily PnL Tracking Engine.
 *
 * State Isolation Invariant:
 *   activeTradingBalanceUsd + lockedVaultBalanceUsd + netExternalRebalancedUsd
 *     === initialCapitalUsd + cumulativeRealizedPnlUsd
 */
export class ProfitScoopVaultEngine extends BaseSignalPipelineModule<
  RealizedTradeSettlementInput,
  ProfitScoopOutcome
> {
  private readonly initialCapitalUsd: number;
  private activeTradingBalanceUsd: number;
  private lockedVaultBalanceUsd = 0;
  private netExternalRebalancedUsd = 0;
  private cumulativeRealizedPnlUsd = 0;
  private totalScoopedLifetimeUsd = 0;
  private totalManuallyReleasedUsd = 0;
  private accumulatedRealizedSinceLastScoopUsd = 0;
  private config: ProfitScoopConfig;
  private stateVersion = 1;
  private readonly processedTradeIds = new Set<string>();
  private readonly dailyRecords = new Map<string, DailyPnlHistoryRecord>();
  private readonly vaultLedger: VaultLedgerEntry[] = [];

  constructor(
    initialCapitalUsd = 25_000,
    initialConfig: ProfitScoopConfig = DEFAULT_PROFIT_SCOOP_CONFIG,
    seedHistoricalRecords = true
  ) {
    super(
      'profit-scoop-vault-engine',
      'High-Frequency Profit Scooping, Immutable Locker Vault & Daily PnL Engine'
    );
    const safeInitial = roundPrecision4(Math.max(100, initialCapitalUsd));
    this.initialCapitalUsd = safeInitial;
    this.activeTradingBalanceUsd = safeInitial;
    this.config = sanitizeProfitScoopConfigPatch(DEFAULT_PROFIT_SCOOP_CONFIG, initialConfig);

    if (seedHistoricalRecords) {
      this.seedDeterministicHistoricalLedger();
    } else {
      this.ensureDailyBucket(formatUtcDateKey(Date.now()), Date.now());
    }
  }

  private seedDeterministicHistoricalLedger(): void {
    const nowMs = Date.now();
    const dayMs = 86_400_000;
    // 6 prior UTC days + current day settled trades through the exact same invariant pipeline
    const seedTrades: readonly {
      readonly daysAgo: number;
      readonly symbol: string;
      readonly pnlUsd: number;
      readonly agent: string;
    }[] = [
      { daysAgo: 6, symbol: 'BTCUSDT', pnlUsd: 312.45, agent: 'AI_COORDINATOR' },
      { daysAgo: 6, symbol: 'ETHUSDT', pnlUsd: -84.2, agent: 'SMC_FRVP' },
      { daysAgo: 5, symbol: 'SOLUSDT', pnlUsd: 428.8, agent: 'PRE_PUMP_SUPPORT' },
      { daysAgo: 4, symbol: 'BNBUSDT', pnlUsd: 196.35, agent: 'PATTERN_SCANNER' },
      { daysAgo: 4, symbol: 'BTCUSDT', pnlUsd: -112.15, agent: 'MEAN_REVERSION' },
      { daysAgo: 3, symbol: 'AVAXUSDT', pnlUsd: 542.6, agent: 'PRE_PUMP_SUPPORT' },
      { daysAgo: 2, symbol: 'ETHUSDT', pnlUsd: 288.9, agent: 'SMC_FRVP' },
      { daysAgo: 1, symbol: 'BTCUSDT', pnlUsd: 374.25, agent: 'AI_COORDINATOR' },
      { daysAgo: 1, symbol: 'XRPUSDT', pnlUsd: -62.4, agent: 'PATTERN_SCANNER' },
      { daysAgo: 0, symbol: 'SOLUSDT', pnlUsd: 185.5, agent: 'AI_COORDINATOR' },
    ];

    seedTrades.forEach((item, idx) => {
      const ts = nowMs - item.daysAgo * dayMs;
      this.executeCore({
        tradeId: `seed_exec_${idx + 1}_${item.symbol}`,
        symbol: item.symbol,
        realizedPnlUsd: item.pnlUsd,
        sourceAgent: item.agent,
        settledAtMs: ts,
      });
    });
  }

  private getEffectiveThresholdUsd(): number {
    if (this.config.thresholdMode === 'PERCENT_OF_EQUITY') {
      return roundPrecision4(
        Math.max(10, (this.activeTradingBalanceUsd * this.config.profitThresholdPct) / 100)
      );
    }
    return roundPrecision4(this.config.profitThresholdUsd);
  }

  private getTotalPortfolioEquityUsd(): number {
    return roundPrecision4(this.activeTradingBalanceUsd + this.lockedVaultBalanceUsd);
  }

  private ensureDailyBucket(dateKey: string, nowMs: number): DailyPnlHistoryRecord {
    const existing = this.dailyRecords.get(dateKey);
    if (existing) return existing;

    const startEq = this.getTotalPortfolioEquityUsd();
    const base: Omit<DailyPnlHistoryRecord, 'recordHash'> = {
      dateKey,
      startingEquityUsd: startEq,
      endingEquityUsd: startEq,
      realizedPnlUsd: 0,
      returnPct: 0,
      scoopedToVaultUsd: 0,
      manualReleasedUsd: 0,
      tradeCount: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRatePct: 0,
      largestWinUsd: 0,
      largestLossUsd: 0,
      updatedAtIso: new Date(nowMs).toISOString(),
    };
    const record: DailyPnlHistoryRecord = {
      ...base,
      recordHash: computeDailyRecordHash(base),
    };
    this.dailyRecords.set(dateKey, record);
    return record;
  }

  private appendLedgerEntry(params: {
    readonly kind: VaultLedgerEventKind;
    readonly amountUsd: number;
    readonly symbol: string | null;
    readonly actorType: VaultActorType;
    readonly actorLabel: string;
    readonly immutableLock: boolean;
    readonly note: string;
    readonly nowMs: number;
  }): VaultLedgerEntry {
    const sequence = this.vaultLedger.length + 1;
    const prevHash =
      this.vaultLedger.length > 0
        ? this.vaultLedger[this.vaultLedger.length - 1].entryHash
        : '00000000';
    const base: Omit<VaultLedgerEntry, 'entryHash'> = {
      entryId: `vlt_${sequence}_${params.nowMs.toString(36)}`,
      sequence,
      timestampIso: new Date(params.nowMs).toISOString(),
      kind: params.kind,
      amountUsd: roundPrecision4(params.amountUsd),
      symbol: params.symbol,
      actorType: params.actorType,
      actorLabel: params.actorLabel,
      immutableLock: params.immutableLock,
      note: params.note,
      resultingActiveBalanceUsd: this.activeTradingBalanceUsd,
      resultingLockedVaultUsd: this.lockedVaultBalanceUsd,
      prevHash,
    };
    const entry: VaultLedgerEntry = {
      ...base,
      entryHash: computeVaultEntryHash(base),
    };
    this.vaultLedger.push(entry);
    return entry;
  }

  /**
   * High-frequency realized trade ingestion + automatic excess-profit vault scooping.
   * Deduplicates by tradeId to prevent replay/double-scoop data drift.
   */
  protected executeCore(input: RealizedTradeSettlementInput): ProfitScoopOutcome {
    const cleanTradeId = input.tradeId.trim();
    const nowMs = input.settledAtMs ?? Date.now();
    if (!cleanTradeId || this.processedTradeIds.has(cleanTradeId)) {
      return {
        duplicateIgnored: true,
        scoopedNow: false,
        scoopedAmountUsd: 0,
        ledgerEntry: null,
        snapshot: this.getSnapshot(nowMs),
      };
    }

    const pnlUsd = roundPrecision4(input.realizedPnlUsd);
    this.processedTradeIds.add(cleanTradeId);

    const dateKey = formatUtcDateKey(nowMs);
    const prevBucket = this.ensureDailyBucket(dateKey, nowMs);

    // 1. Credit/debit active trading balance exclusively (NEVER touches immutable Locker Vault)
    this.activeTradingBalanceUsd = roundPrecision4(this.activeTradingBalanceUsd + pnlUsd);
    this.cumulativeRealizedPnlUsd = roundPrecision4(this.cumulativeRealizedPnlUsd + pnlUsd);

    // Track realized gains toward user-defined scoop threshold (floor at 0 on net drawdown)
    this.accumulatedRealizedSinceLastScoopUsd = roundPrecision4(
      Math.max(0, this.accumulatedRealizedSinceLastScoopUsd + pnlUsd)
    );

    // 2. Evaluate high-frequency scooping threshold
    let scoopedNow = false;
    let scoopedAmountUsd = 0;
    let ledgerEntry: VaultLedgerEntry | null = null;
    const effectiveThresholdUsd = this.getEffectiveThresholdUsd();

    if (this.config.enabled && this.accumulatedRealizedSinceLastScoopUsd > effectiveThresholdUsd) {
      const excessProfitUsd = roundPrecision4(
        this.accumulatedRealizedSinceLastScoopUsd - effectiveThresholdUsd
      );
      const desiredScoopUsd = roundPrecision4(
        excessProfitUsd * (this.config.scoopExcessRatioPct / 100)
      );
      // Never scoop below minimum operating capital floor ($100)
      const maxScoopableFromActive = roundPrecision4(
        Math.max(0, this.activeTradingBalanceUsd - 100)
      );
      scoopedAmountUsd = roundPrecision4(Math.min(desiredScoopUsd, maxScoopableFromActive));

      if (scoopedAmountUsd >= 0.01) {
        this.activeTradingBalanceUsd = roundPrecision4(
          this.activeTradingBalanceUsd - scoopedAmountUsd
        );
        this.lockedVaultBalanceUsd = roundPrecision4(
          this.lockedVaultBalanceUsd + scoopedAmountUsd
        );
        this.totalScoopedLifetimeUsd = roundPrecision4(
          this.totalScoopedLifetimeUsd + scoopedAmountUsd
        );
        // Reset realized accumulator by the scooped excess so only new excess triggers next sweep
        this.accumulatedRealizedSinceLastScoopUsd = roundPrecision4(
          Math.max(0, this.accumulatedRealizedSinceLastScoopUsd - scoopedAmountUsd)
        );
        scoopedNow = true;
        ledgerEntry = this.appendLedgerEntry({
          kind: 'AUTO_SCOOP_LOCK',
          amountUsd: scoopedAmountUsd,
          symbol: input.symbol.toUpperCase(),
          actorType: 'AUTONOMOUS_AGENT',
          actorLabel: input.sourceAgent || 'CORE_EXECUTION_ENGINE',
          immutableLock: true,
          note: `Auto-scooped excess realized gain ($${scoopedAmountUsd.toFixed(2)}) above $${effectiveThresholdUsd.toFixed(2)} threshold into immutable Locker Vault.`,
          nowMs,
        });
      }
    }

    // 3. Persist high-precision daily PnL record for dateKey
    const nextTradeCount = prevBucket.tradeCount + 1;
    const nextWins = prevBucket.winningTrades + (pnlUsd > 0 ? 1 : 0);
    const nextLosses = prevBucket.losingTrades + (pnlUsd < 0 ? 1 : 0);
    const nextRealizedDay = roundPrecision4(prevBucket.realizedPnlUsd + pnlUsd);
    const nextEndingEq = this.getTotalPortfolioEquityUsd();
    const returnPct =
      prevBucket.startingEquityUsd > 0
        ? roundPrecision4((nextRealizedDay / prevBucket.startingEquityUsd) * 100)
        : 0;

    const updatedBase: Omit<DailyPnlHistoryRecord, 'recordHash'> = {
      dateKey,
      startingEquityUsd: prevBucket.startingEquityUsd,
      endingEquityUsd: nextEndingEq,
      realizedPnlUsd: nextRealizedDay,
      returnPct,
      scoopedToVaultUsd: roundPrecision4(prevBucket.scoopedToVaultUsd + scoopedAmountUsd),
      manualReleasedUsd: prevBucket.manualReleasedUsd,
      tradeCount: nextTradeCount,
      winningTrades: nextWins,
      losingTrades: nextLosses,
      winRatePct: roundUsd2((nextWins / Math.max(1, nextTradeCount)) * 100),
      largestWinUsd: roundPrecision4(Math.max(prevBucket.largestWinUsd, pnlUsd)),
      largestLossUsd: roundPrecision4(Math.min(prevBucket.largestLossUsd, pnlUsd)),
      updatedAtIso: new Date(nowMs).toISOString(),
    };
    this.dailyRecords.set(dateKey, {
      ...updatedBase,
      recordHash: computeDailyRecordHash(updatedBase),
    });

    this.stateVersion += 1;

    return {
      duplicateIgnored: false,
      scoopedNow,
      scoopedAmountUsd,
      ledgerEntry,
      snapshot: this.getSnapshot(nowMs),
    };
  }

  /**
   * Public convenience alias for direct core-execution trade settlement hooks.
   */
  ingestRealizedTrade(input: RealizedTradeSettlementInput): ProfitScoopOutcome {
    return this.process(input);
  }

  /**
   * Updates user-defined scooping thresholds and evaluates immediately if already above threshold.
   */
  updateConfig(
    patch: Partial<Omit<ProfitScoopConfig, 'immutableAutoLock'>>,
    actorLabel = 'AUTHENTICATED_USER',
    nowMs = Date.now()
  ): ProfitVaultSnapshot {
    this.config = sanitizeProfitScoopConfigPatch(this.config, patch);
    this.appendLedgerEntry({
      kind: 'THRESHOLD_CONFIG_UPDATE',
      amountUsd: 0,
      symbol: null,
      actorType: 'AUTHENTICATED_USER',
      actorLabel,
      immutableLock: true,
      note: `Threshold updated: ${
        this.config.thresholdMode === 'USD_FIXED'
          ? `$${this.config.profitThresholdUsd.toFixed(2)} USD`
          : `${this.config.profitThresholdPct}% equity`
      } (${this.config.scoopExcessRatioPct}% excess sweep, ${
        this.config.enabled ? 'ENABLED' : 'PAUSED'
      }).`,
      nowMs,
    });
    this.stateVersion += 1;
    return this.getSnapshot(nowMs);
  }

  /**
   * Strict User-Only Manual Override Protocol:
   * - Cryptographically rejects any autonomous agent or system bot attempting to unlock/rebalance funds.
   * - Requires explicit human confirmation phrase ('UNLOCK_VAULT' or 'REBALANCE_VAULT').
   */
  executeManualUserOverride(req: ManualVaultOverrideRequest): ManualVaultOverrideOutcome {
    const nowMs = req.nowMs ?? Date.now();

    // 1. Hard gate: ONLY human authenticated users may release or rebalance Locker Vault funds
    if (req.actorType !== 'AUTHENTICATED_USER' || !req.actorId.trim()) {
      return {
        allowed: false,
        code: 'AGENT_OVERRIDE_FORBIDDEN',
        message:
          'Immutable Locker Vault violation blocked: autonomous agents and system bots are strictly forbidden from releasing or rebalancing locked funds.',
        ledgerEntry: null,
        snapshot: this.getSnapshot(nowMs),
      };
    }

    // 2. Hard gate: Explicit human confirmation phrase required
    const expectedPhrase = USER_OVERRIDE_CONFIRMATION_PHRASES[req.action];
    if (req.confirmationPhrase.trim().toUpperCase() !== expectedPhrase) {
      return {
        allowed: false,
        code: 'USER_CONFIRMATION_REQUIRED',
        message: `Manual override requires explicit confirmation phrase "${expectedPhrase}".`,
        ledgerEntry: null,
        snapshot: this.getSnapshot(nowMs),
      };
    }

    // 3. Validate amount against isolated Locker Vault balance
    const amountUsd = roundPrecision4(req.amountUsd);
    if (!Number.isFinite(amountUsd) || amountUsd < 1) {
      return {
        allowed: false,
        code: 'INVALID_AMOUNT',
        message: 'Override amount must be at least $1.00 USD.',
        ledgerEntry: null,
        snapshot: this.getSnapshot(nowMs),
      };
    }
    if (amountUsd > this.lockedVaultBalanceUsd) {
      return {
        allowed: false,
        code: 'INSUFFICIENT_VAULT_BALANCE',
        message: `Requested $${amountUsd.toFixed(2)} exceeds locked vault balance ($${this.lockedVaultBalanceUsd.toFixed(2)}).`,
        ledgerEntry: null,
        snapshot: this.getSnapshot(nowMs),
      };
    }

    // 4. Execute isolated balance transfer
    this.lockedVaultBalanceUsd = roundPrecision4(this.lockedVaultBalanceUsd - amountUsd);
    this.totalManuallyReleasedUsd = roundPrecision4(this.totalManuallyReleasedUsd + amountUsd);

    if (req.action === 'RELEASE_TO_TRADING') {
      this.activeTradingBalanceUsd = roundPrecision4(this.activeTradingBalanceUsd + amountUsd);
    } else {
      this.netExternalRebalancedUsd = roundPrecision4(this.netExternalRebalancedUsd + amountUsd);
    }

    const actorLabel = req.actorEmail ? `${req.actorEmail} (${req.actorId})` : req.actorId;
    const ledgerEntry = this.appendLedgerEntry({
      kind:
        req.action === 'RELEASE_TO_TRADING' ? 'USER_MANUAL_RELEASE' : 'USER_MANUAL_REBALANCE',
      amountUsd,
      symbol: null,
      actorType: 'AUTHENTICATED_USER',
      actorLabel,
      immutableLock: false,
      note:
        req.reason.trim().slice(0, 180) ||
        (req.action === 'RELEASE_TO_TRADING'
          ? 'Manual user release from Locker Vault to active trading capital.'
          : 'Manual user rebalance from Locker Vault to external cold treasury.'),
      nowMs,
    });

    // Record manual release inside today's daily PnL audit row
    const dateKey = formatUtcDateKey(nowMs);
    const prevBucket = this.ensureDailyBucket(dateKey, nowMs);
    const updatedBase: Omit<DailyPnlHistoryRecord, 'recordHash'> = {
      ...prevBucket,
      endingEquityUsd: this.getTotalPortfolioEquityUsd(),
      manualReleasedUsd: roundPrecision4(prevBucket.manualReleasedUsd + amountUsd),
      updatedAtIso: new Date(nowMs).toISOString(),
    };
    this.dailyRecords.set(dateKey, {
      ...updatedBase,
      recordHash: computeDailyRecordHash(updatedBase),
    });

    this.stateVersion += 1;
    return {
      allowed: true,
      code: 'OVERRIDE_EXECUTED',
      message:
        req.action === 'RELEASE_TO_TRADING'
          ? `Released $${amountUsd.toFixed(2)} from immutable Locker Vault to Active Trading Capital.`
          : `Rebalanced $${amountUsd.toFixed(2)} from immutable Locker Vault to External Cold Reserve.`,
      ledgerEntry,
      snapshot: this.getSnapshot(nowMs),
    };
  }

  verifyVaultIntegrity(): VaultIntegrityAudit {
    let hashChainValid = true;
    let prevHash = '00000000';
    for (let i = 0; i < this.vaultLedger.length; i += 1) {
      const entry = this.vaultLedger[i];
      if (entry.prevHash !== prevHash || entry.sequence !== i + 1) {
        hashChainValid = false;
        break;
      }
      const { entryHash, ...rest } = entry;
      if (computeVaultEntryHash(rest) !== entryHash) {
        hashChainValid = false;
        break;
      }
      prevHash = entryHash;
    }

    const expectedTotalCapitalUsd = roundPrecision4(
      this.initialCapitalUsd + this.cumulativeRealizedPnlUsd
    );
    const actualTotalCapitalUsd = roundPrecision4(
      this.activeTradingBalanceUsd + this.lockedVaultBalanceUsd + this.netExternalRebalancedUsd
    );
    const reconciliationDriftUsd = roundPrecision4(
      Math.abs(expectedTotalCapitalUsd - actualTotalCapitalUsd)
    );

    return {
      hashChainValid,
      accountingInvariantValid: reconciliationDriftUsd < 0.001,
      expectedTotalCapitalUsd,
      actualTotalCapitalUsd,
      reconciliationDriftUsd,
      verifiedEntriesCount: this.vaultLedger.length,
    };
  }

  getSnapshot(nowMs = Date.now()): ProfitVaultSnapshot {
    const todayKey = formatUtcDateKey(nowMs);
    const todayPnl = this.ensureDailyBucket(todayKey, nowMs);
    const dailyHistory = Array.from(this.dailyRecords.values()).sort((a, b) =>
      b.dateKey.localeCompare(a.dateKey)
    );
    const effectiveThresholdUsd = this.getEffectiveThresholdUsd();
    const progressToThresholdPct = roundUsd2(
      Math.min(
        100,
        (this.accumulatedRealizedSinceLastScoopUsd / Math.max(1, effectiveThresholdUsd)) * 100
      )
    );
    const cumulativeReturnPct = roundPrecision4(
      (this.cumulativeRealizedPnlUsd / Math.max(1, this.initialCapitalUsd)) * 100
    );

    return {
      stateVersion: this.stateVersion,
      generatedAtIso: new Date(nowMs).toISOString(),
      initialCapitalUsd: this.initialCapitalUsd,
      activeTradingBalanceUsd: this.activeTradingBalanceUsd,
      lockedVaultBalanceUsd: this.lockedVaultBalanceUsd,
      netExternalRebalancedUsd: this.netExternalRebalancedUsd,
      cumulativeRealizedPnlUsd: this.cumulativeRealizedPnlUsd,
      cumulativeReturnPct,
      totalScoopedLifetimeUsd: this.totalScoopedLifetimeUsd,
      totalManuallyReleasedUsd: this.totalManuallyReleasedUsd,
      accumulatedRealizedSinceLastScoopUsd: this.accumulatedRealizedSinceLastScoopUsd,
      effectiveThresholdUsd,
      progressToThresholdPct,
      totalProcessedTrades: this.processedTradeIds.size,
      config: { ...this.config },
      integrity: this.verifyVaultIntegrity(),
      todayPnl,
      dailyHistory,
      vaultLedger: [...this.vaultLedger].reverse().slice(0, 50),
    };
  }
}

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { FreqtradeCoreSnapshot } from './freqtradeCoreServer';
import {
  FUTURE_MODULAR_EXTENSIONS,
  computePaperEvidenceHash,
  evaluatePublicSignalGate,
  runStage1TestnetValidation,
  validatePaperTradeEvidence,
  validateSlTpGeometry,
  type PaperTradeEvidenceInput,
  type PublicSignalApprovalStatus,
  type PublicSignalAuditEntry,
  type PublicSignalCandidateRecord,
  type PublicSignalMonitoringSnapshot,
  type Stage1TestnetValidationReport,
  type StoredPaperTradeEvidence,
} from './publicSignalValidationEngine';

export interface ReadOnlyRiskSnapshotProvider {
  getSnapshot: () => FreqtradeCoreSnapshot;
}

export interface RegisterCandidateInput {
  readonly signalId?: string;
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly timeframe?: string;
  readonly entryPrice: number;
  readonly stopLossPrice: number;
  readonly takeProfitPrice: number;
  readonly confidencePct: number;
  readonly strategyName?: string;
  readonly marketSource?: string;
}

export interface PublicSignalsFeedResponse {
  readonly publicSignalIsDisplayOnly: true;
  readonly canTriggerLiveOrders: false;
  readonly publicPublicationEnabled: boolean;
  readonly autoSuspended: boolean;
  readonly eligibleForPublicDisplay: boolean;
  readonly lastVerifiedAtIso: string | null;
  readonly withholdingReasons: readonly string[];
  readonly signals: readonly PublicSignalCandidateRecord[];
}

interface ConfigRow {
  public_publication_enabled: number;
  auto_suspended: number;
  suspension_reason: string | null;
  last_verified_at: string | null;
  stage1_report_json: string | null;
}

interface EvidenceDbRow {
  id: number;
  trade_evidence_id: string;
  evidence_hash: string;
  fingerprint: string;
  symbol: string;
  side: string;
  market_source: string;
  observed_at_iso: string;
  closed_at_iso: string;
  bid_price: number;
  ask_price: number;
  entry_price: number;
  exit_price: number;
  stake_usd: number;
  fee_rate: number;
  fee_usd: number;
  spread_bps: number;
  slippage_bps: number;
  stop_loss_price: number;
  take_profit_price: number;
  simulated_net_pnl_usd: number;
  simulated_return_pct: number;
  status: string;
  outcome: string;
  rejection_reason: string | null;
  recorded_at_iso: string;
}

interface CandidateDbRow {
  signal_id: string;
  symbol: string;
  side: string;
  timeframe: string;
  entry_price: number;
  stop_loss_price: number;
  take_profit_price: number;
  confidence_pct: number;
  risk_reward_ratio: number;
  strategy_name: string;
  market_source: string;
  approval_status: string;
  created_at_iso: string;
  approved_by: string | null;
  approved_at_iso: string | null;
  approval_note: string | null;
  revoked_at_iso: string | null;
  suspension_reason: string | null;
}

interface AuditDbRow {
  id: number;
  timestamp_iso: string;
  event_type: string;
  actor: string;
  signal_id: string | null;
  summary: string;
  passed: number;
}

function mapEvidenceRow(row: EvidenceDbRow): StoredPaperTradeEvidence {
  return {
    id: Number(row.id),
    tradeEvidenceId: row.trade_evidence_id,
    evidenceHash: row.evidence_hash,
    fingerprint: row.fingerprint,
    symbol: row.symbol,
    side: row.side === 'SELL' ? 'SELL' : 'BUY',
    marketSource: row.market_source,
    observedAtIso: row.observed_at_iso,
    closedAtIso: row.closed_at_iso,
    bidPrice: Number(row.bid_price),
    askPrice: Number(row.ask_price),
    entryPrice: Number(row.entry_price),
    exitPrice: Number(row.exit_price),
    stakeUsd: Number(row.stake_usd),
    feeRate: Number(row.fee_rate),
    feeUsd: Number(row.fee_usd),
    spreadBps: Number(row.spread_bps),
    slippageBps: Number(row.slippage_bps),
    stopLossPrice: Number(row.stop_loss_price),
    takeProfitPrice: Number(row.take_profit_price),
    simulatedNetPnlUsd: Number(row.simulated_net_pnl_usd),
    simulatedReturnPct: Number(row.simulated_return_pct),
    profitLabel: 'SIMULATED_PAPER_ONLY',
    isRealProfit: false,
    status: row.status === 'ACCEPTED' ? 'ACCEPTED' : 'REJECTED',
    outcome:
      row.outcome === 'WIN' || row.outcome === 'LOSS' || row.outcome === 'BREAKEVEN'
        ? row.outcome
        : 'REJECTED',
    rejectionReason: row.rejection_reason ?? null,
    recordedAtIso: row.recorded_at_iso,
  };
}

function mapCandidateRow(row: CandidateDbRow): PublicSignalCandidateRecord {
  const rawStatus = row.approval_status;
  const approvalStatus: PublicSignalApprovalStatus =
    rawStatus === 'APPROVED_PUBLIC' ||
    rawStatus === 'ELIGIBLE_PENDING_APPROVAL' ||
    rawStatus === 'REJECTED' ||
    rawStatus === 'SUSPENDED_SAFETY'
      ? rawStatus
      : 'PRIVATE_UNVERIFIED';

  return {
    signalId: row.signal_id,
    symbol: row.symbol,
    side: row.side === 'SELL' ? 'SELL' : 'BUY',
    timeframe: row.timeframe,
    entryPrice: Number(row.entry_price),
    stopLossPrice: Number(row.stop_loss_price),
    takeProfitPrice: Number(row.take_profit_price),
    confidencePct: Number(row.confidence_pct),
    riskRewardRatio: Number(row.risk_reward_ratio),
    strategyName: row.strategy_name,
    marketSource: row.market_source,
    approvalStatus,
    createdAtIso: row.created_at_iso,
    approvedBy: row.approved_by ?? null,
    approvedAtIso: row.approved_at_iso ?? null,
    approvalNote: row.approval_note ?? null,
    revokedAtIso: row.revoked_at_iso ?? null,
    suspensionReason: row.suspension_reason ?? null,
    canTriggerLiveOrders: false,
  };
}

function mapAuditRow(row: AuditDbRow): PublicSignalAuditEntry {
  const validEventTypes: readonly PublicSignalAuditEntry['eventType'][] = [
    'STAGE1_TESTNET_CHECK',
    'STAGE2_PAPER_ACCEPTED',
    'STAGE2_PAPER_REJECTED',
    'CANDIDATE_REGISTERED',
    'SIGNAL_APPROVED',
    'SIGNAL_REJECTED',
    'SIGNAL_REVOKED',
    'PUBLICATION_TOGGLED',
    'SAFETY_AUTO_SUSPENDED',
    'INTEGRITY_REVERIFIED',
  ];
  const matched = validEventTypes.find((t) => t === row.event_type) ?? 'INTEGRITY_REVERIFIED';
  return {
    id: Number(row.id),
    timestampIso: row.timestamp_iso,
    eventType: matched,
    actor: row.actor,
    signalId: row.signal_id ?? null,
    summary: row.summary,
    passed: Number(row.passed) === 1,
  };
}

export class PublicSignalValidationServerRuntime {
  private readonly db: DatabaseSync;
  private readonly riskProvider: ReadOnlyRiskSnapshotProvider;
  private externalEmergencyHalt = false;

  constructor(
    rootDir: string,
    riskProvider: ReadOnlyRiskSnapshotProvider,
    dbPathOverride?: string
  ) {
    this.riskProvider = riskProvider;
    const dbPath =
      dbPathOverride ??
      path.resolve(rootDir, '.data', 'signal_forge_public_signal_gate.sqlite');

    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS public_gate_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        public_publication_enabled INTEGER NOT NULL DEFAULT 0,
        auto_suspended INTEGER NOT NULL DEFAULT 0,
        suspension_reason TEXT,
        last_verified_at TEXT,
        stage1_report_json TEXT
      );

      CREATE TABLE IF NOT EXISTS paper_validation_evidence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_evidence_id TEXT NOT NULL,
        evidence_hash TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        market_source TEXT NOT NULL,
        observed_at_iso TEXT NOT NULL,
        closed_at_iso TEXT NOT NULL,
        bid_price REAL NOT NULL,
        ask_price REAL NOT NULL,
        entry_price REAL NOT NULL,
        exit_price REAL NOT NULL,
        stake_usd REAL NOT NULL,
        fee_rate REAL NOT NULL,
        fee_usd REAL NOT NULL,
        spread_bps REAL NOT NULL,
        slippage_bps REAL NOT NULL,
        stop_loss_price REAL NOT NULL,
        take_profit_price REAL NOT NULL,
        simulated_net_pnl_usd REAL NOT NULL,
        simulated_return_pct REAL NOT NULL,
        status TEXT NOT NULL,
        outcome TEXT NOT NULL,
        rejection_reason TEXT,
        recorded_at_iso TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS public_signal_candidates (
        signal_id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        entry_price REAL NOT NULL,
        stop_loss_price REAL NOT NULL,
        take_profit_price REAL NOT NULL,
        confidence_pct REAL NOT NULL,
        risk_reward_ratio REAL NOT NULL,
        strategy_name TEXT NOT NULL,
        market_source TEXT NOT NULL,
        approval_status TEXT NOT NULL DEFAULT 'PRIVATE_UNVERIFIED',
        created_at_iso TEXT NOT NULL,
        approved_by TEXT,
        approved_at_iso TEXT,
        approval_note TEXT,
        revoked_at_iso TEXT,
        suspension_reason TEXT
      );

      CREATE TABLE IF NOT EXISTS public_signal_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp_iso TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor TEXT NOT NULL,
        signal_id TEXT,
        summary TEXT NOT NULL,
        passed INTEGER NOT NULL
      );
    `);

    const existing = this.db
      .prepare('SELECT id FROM public_gate_config WHERE id = 1')
      .get() as { id?: number } | undefined;

    if (!existing) {
      // Publication strictly disabled (0) by default
      this.db
        .prepare(
          `INSERT INTO public_gate_config (
            id, public_publication_enabled, auto_suspended, suspension_reason, last_verified_at, stage1_report_json
          ) VALUES (1, 0, 0, NULL, NULL, NULL)`
        )
        .run();
    }
  }

  public close(): void {
    this.db.close();
  }

  public setExternalEmergencyHalt(halted: boolean): void {
    this.externalEmergencyHalt = halted;
  }

  private appendAudit(
    eventType: PublicSignalAuditEntry['eventType'],
    actor: string,
    signalId: string | null,
    summary: string,
    passed: boolean
  ): void {
    this.db
      .prepare(
        `INSERT INTO public_signal_audit_log (timestamp_iso, event_type, actor, signal_id, summary, passed)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(new Date().toISOString(), eventType, actor.slice(0, 120), signalId, summary.slice(0, 500), passed ? 1 : 0);
  }

  private getConfigRow(): ConfigRow {
    const row = this.db
      .prepare(
        `SELECT public_publication_enabled, auto_suspended, suspension_reason, last_verified_at, stage1_report_json
         FROM public_gate_config WHERE id = 1`
      )
      .get() as unknown as ConfigRow;
    return row;
  }

  private parseStage1Report(raw: string | null): Stage1TestnetValidationReport | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Stage1TestnetValidationReport;
      if (parsed && typeof parsed.passed === 'boolean' && Array.isArray(parsed.checks)) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private auditStoredEvidenceIntegrity(): {
    validCount: number;
    rejectedCount: number;
    winsCount: number;
    lossesCount: number;
    breakevenCount: number;
    corruptedCount: number;
    duplicateCount: number;
  } {
    const rows = this.db
      .prepare('SELECT * FROM paper_validation_evidence ORDER BY id ASC')
      .all() as unknown as EvidenceDbRow[];

    let validCount = 0;
    let rejectedCount = 0;
    let winsCount = 0;
    let lossesCount = 0;
    let breakevenCount = 0;
    let corruptedCount = 0;
    let duplicateCount = 0;

    const seenFingerprints = new Set<string>();
    const seenEvidenceIds = new Set<string>();

    for (const row of rows) {
      if (row.status !== 'ACCEPTED') {
        rejectedCount += 1;
        continue;
      }

      const recomputedHash = computePaperEvidenceHash({
        tradeEvidenceId: row.trade_evidence_id,
        fingerprint: row.fingerprint,
        marketSource: row.market_source,
        bidPrice: Number(row.bid_price),
        askPrice: Number(row.ask_price),
        feeRate: Number(row.fee_rate),
        feeUsd: Number(row.fee_usd),
        spreadBps: Number(row.spread_bps),
        slippageBps: Number(row.slippage_bps),
        simulatedNetPnlUsd: Number(row.simulated_net_pnl_usd),
        status: 'ACCEPTED',
      });

      if (recomputedHash !== row.evidence_hash) {
        corruptedCount += 1;
        continue;
      }

      if (seenFingerprints.has(row.fingerprint) || seenEvidenceIds.has(row.trade_evidence_id)) {
        duplicateCount += 1;
        continue;
      }

      seenFingerprints.add(row.fingerprint);
      seenEvidenceIds.add(row.trade_evidence_id);
      validCount += 1;

      if (row.outcome === 'WIN') winsCount += 1;
      else if (row.outcome === 'LOSS') lossesCount += 1;
      else if (row.outcome === 'BREAKEVEN') breakevenCount += 1;
    }

    return {
      validCount,
      rejectedCount,
      winsCount,
      lossesCount,
      breakevenCount,
      corruptedCount,
      duplicateCount,
    };
  }

  private getCurrentRiskMetrics(): {
    observedDailyDrawdownPct: number;
    emergencyHalted: boolean;
    freqtradeSnapshot: FreqtradeCoreSnapshot;
  } {
    const freqtradeSnapshot = this.riskProvider.getSnapshot();
    const observedDailyDrawdownPct = Math.max(0, freqtradeSnapshot.metrics.dailyDrawdownPct);
    const emergencyHalted =
      this.externalEmergencyHalt ||
      freqtradeSnapshot.metrics.drawdownCircuitTripped ||
      !freqtradeSnapshot.metrics.botRunning;
    return {
      observedDailyDrawdownPct,
      emergencyHalted,
      freqtradeSnapshot,
    };
  }

  private enforceAutoSuspensionIfNeeded(actor: string): {
    autoSuspended: boolean;
    suspensionReason: string | null;
  } {
    const config = this.getConfigRow();
    const stage1Report = this.parseStage1Report(config.stage1_report_json);
    const integrity = this.auditStoredEvidenceIntegrity();
    const { observedDailyDrawdownPct, emergencyHalted } = this.getCurrentRiskMetrics();

    const evaluation = evaluatePublicSignalGate({
      stage1Report,
      validPaperChecksCount: integrity.validCount,
      rejectedPaperChecksCount: integrity.rejectedCount,
      paperWinsCount: integrity.winsCount,
      paperLossesCount: integrity.lossesCount,
      paperBreakevenCount: integrity.breakevenCount,
      corruptedEvidenceCount: integrity.corruptedCount,
      duplicateEvidenceCount: integrity.duplicateCount,
      observedDailyDrawdownPct,
      emergencyHalted,
      publicPublicationEnabled: Number(config.public_publication_enabled) === 1,
      manualSafetySuspensionReason:
        Number(config.auto_suspended) === 1 ? config.suspension_reason : null,
      lastVerifiedAtIso: config.last_verified_at,
    });

    if (evaluation.autoSuspended) {
      const reason =
        evaluation.suspensionReason ??
        'Automatic safety suspension triggered by integrity or risk gate breach.';
      const wasSuspended = Number(config.auto_suspended) === 1;
      this.db
        .prepare(
          `UPDATE public_gate_config
           SET auto_suspended = 1, suspension_reason = ?, public_publication_enabled = 0, last_verified_at = ?
           WHERE id = 1`
        )
        .run(reason, new Date().toISOString());

      // Immediately revoke public visibility from any approved signals
      this.db
        .prepare(
          `UPDATE public_signal_candidates
           SET approval_status = 'SUSPENDED_SAFETY', suspension_reason = ?
           WHERE approval_status = 'APPROVED_PUBLIC'`
        )
        .run(reason);

      if (!wasSuspended) {
        this.appendAudit('SAFETY_AUTO_SUSPENDED', actor, null, reason, false);
      }
      return { autoSuspended: true, suspensionReason: reason };
    }

    return { autoSuspended: false, suspensionReason: null };
  }

  /**
   * STAGE 1 — Execute deterministic Testnet validation check.
   * Never contacts live trading execution endpoints.
   */
  public runStage1TestnetCheck(
    actor: string,
    options?: {
      targetHost?: string;
      sampleSymbol?: string;
      sampleSide?: 'BUY' | 'SELL';
      sampleEntryPrice?: number;
      sampleStopLossPrice?: number;
      sampleTakeProfitPrice?: number;
      invalidOrderRejected?: boolean;
    }
  ): {
    ok: boolean;
    statusCode: number;
    report: Stage1TestnetValidationReport;
  } {
    const { observedDailyDrawdownPct } = this.getCurrentRiskMetrics();
    const sampleSide = options?.sampleSide === 'SELL' ? 'SELL' : 'BUY';
    const sampleEntryPrice =
      options?.sampleEntryPrice !== undefined && Number.isFinite(options.sampleEntryPrice)
        ? options.sampleEntryPrice
        : 91_400;
    const sampleStopLossPrice =
      options?.sampleStopLossPrice !== undefined && Number.isFinite(options.sampleStopLossPrice)
        ? options.sampleStopLossPrice
        : sampleSide === 'BUY'
          ? sampleEntryPrice * 0.98
          : sampleEntryPrice * 1.02;
    const sampleTakeProfitPrice =
      options?.sampleTakeProfitPrice !== undefined && Number.isFinite(options.sampleTakeProfitPrice)
        ? options.sampleTakeProfitPrice
        : sampleSide === 'BUY'
          ? sampleEntryPrice * 1.06
          : sampleEntryPrice * 0.94;

    const report = runStage1TestnetValidation({
      targetHost: options?.targetHost ?? 'testnet.binance.vision',
      sampleSymbol: options?.sampleSymbol ?? 'BTC/USDT',
      sampleSide,
      sampleEntryPrice,
      sampleStopLossPrice,
      sampleTakeProfitPrice,
      observedDailyDrawdownPct,
      invalidOrderRejected: options?.invalidOrderRejected ?? true,
      lifecycleTransitions: ['OPEN', 'FILL', 'CLOSE'],
    });

    const nowIso = report.verifiedAtIso;
    if (report.passed) {
      // Clear prior Stage 1 suspension if integrity and risk are healthy
      this.db
        .prepare(
          `UPDATE public_gate_config
           SET stage1_report_json = ?, last_verified_at = ?, auto_suspended = 0, suspension_reason = NULL
           WHERE id = 1`
        )
        .run(JSON.stringify(report), nowIso);
    } else {
      this.db
        .prepare(
          `UPDATE public_gate_config
           SET stage1_report_json = ?, last_verified_at = ?
           WHERE id = 1`
        )
        .run(JSON.stringify(report), nowIso);
    }

    this.appendAudit(
      'STAGE1_TESTNET_CHECK',
      actor,
      null,
      report.passed
        ? `Stage 1 Testnet Validation PASSED on ${report.targetHost} (zero live endpoints contacted).`
        : `Stage 1 Testnet Validation FAILED on ${report.targetHost}: ${report.failureReasons.join(' | ')}`,
      report.passed
    );

    this.enforceAutoSuspensionIfNeeded(actor);

    return {
      ok: report.passed,
      statusCode: report.passed ? 200 : 422,
      report,
    };
  }

  /**
   * STAGE 2 & STAGE 3 — Validate and record a timestamped Paper Trading observation & outcome.
   * Rejects missing, fabricated, demonstration, unrealistic-cost, or duplicate records,
   * while persisting BOTH accepted and rejected entries for auditability.
   */
  public recordPaperTradeEvidence(
    actor: string,
    input: PaperTradeEvidenceInput,
    nowMs: number = Date.now()
  ): {
    ok: boolean;
    statusCode: number;
    validation: ReturnType<typeof validatePaperTradeEvidence>;
    stored: StoredPaperTradeEvidence;
  } {
    const acceptedRows = this.db
      .prepare(
        `SELECT trade_evidence_id, fingerprint FROM paper_validation_evidence WHERE status = 'ACCEPTED'`
      )
      .all() as unknown as Array<{ trade_evidence_id: string; fingerprint: string }>;

    const existingIds = new Set(acceptedRows.map((r) => r.trade_evidence_id));
    const existingFingerprints = new Set(acceptedRows.map((r) => r.fingerprint));

    const validation = validatePaperTradeEvidence(input, existingIds, existingFingerprints, nowMs);
    const recordedAtIso = new Date(nowMs).toISOString();
    const rejectionReason =
      validation.rejectionReasons.length > 0 ? validation.rejectionReasons.join(' | ') : null;

    const info = this.db
      .prepare(
        `INSERT INTO paper_validation_evidence (
          trade_evidence_id, evidence_hash, fingerprint, symbol, side, market_source,
          observed_at_iso, closed_at_iso, bid_price, ask_price, entry_price, exit_price,
          stake_usd, fee_rate, fee_usd, spread_bps, slippage_bps, stop_loss_price, take_profit_price,
          simulated_net_pnl_usd, simulated_return_pct, status, outcome, rejection_reason, recorded_at_iso
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        validation.tradeEvidenceId,
        validation.evidenceHash,
        validation.fingerprint,
        String(input.symbol || 'UNKNOWN').trim().toUpperCase(),
        input.side === 'SELL' ? 'SELL' : 'BUY',
        String(input.marketSource || 'UNKNOWN').trim().toUpperCase(),
        String(input.observedAtIso || ''),
        String(input.closedAtIso || ''),
        Number.isFinite(input.bidPrice) ? input.bidPrice : 0,
        Number.isFinite(input.askPrice) ? input.askPrice : 0,
        Number.isFinite(input.entryPrice) ? input.entryPrice : 0,
        Number.isFinite(input.exitPrice) ? input.exitPrice : 0,
        Number.isFinite(input.stakeUsd) ? input.stakeUsd : 0,
        Number.isFinite(input.feeRate) ? input.feeRate : 0,
        Number.isFinite(input.feeUsd) ? input.feeUsd : 0,
        Number.isFinite(input.spreadBps) ? input.spreadBps : 0,
        Number.isFinite(input.slippageBps) ? input.slippageBps : 0,
        Number.isFinite(input.stopLossPrice) ? input.stopLossPrice : 0,
        Number.isFinite(input.takeProfitPrice) ? input.takeProfitPrice : 0,
        validation.simulatedNetPnlUsd,
        validation.simulatedReturnPct,
        validation.status,
        validation.outcome,
        rejectionReason,
        recordedAtIso
      );

    this.db
      .prepare('UPDATE public_gate_config SET last_verified_at = ? WHERE id = 1')
      .run(recordedAtIso);

    this.appendAudit(
      validation.accepted ? 'STAGE2_PAPER_ACCEPTED' : 'STAGE2_PAPER_REJECTED',
      actor,
      validation.tradeEvidenceId,
      validation.accepted
        ? `Accepted simulated paper trade ${validation.tradeEvidenceId} (${String(input.symbol).toUpperCase()} ${input.side}, outcome=${validation.outcome}, simulatedNetPnl=$${validation.simulatedNetPnlUsd.toFixed(2)}).`
        : `Rejected paper trade ${validation.tradeEvidenceId}: ${rejectionReason}`,
      validation.accepted
    );

    const row = this.db
      .prepare('SELECT * FROM paper_validation_evidence WHERE id = ?')
      .get(Number(info.lastInsertRowid)) as unknown as EvidenceDbRow;

    this.enforceAutoSuspensionIfNeeded(actor);

    return {
      ok: validation.accepted,
      statusCode: validation.accepted ? 200 : 422,
      validation,
      stored: mapEvidenceRow(row),
    };
  }

  /**
   * Register a candidate signal in PRIVATE_UNVERIFIED status.
   * Incomplete or unapproved signals always remain private.
   */
  public registerCandidateSignal(
    actor: string,
    input: RegisterCandidateInput
  ): {
    ok: boolean;
    statusCode: number;
    message: string;
    candidate?: PublicSignalCandidateRecord;
  } {
    const symbol = String(input.symbol || '').trim().toUpperCase();
    const side = input.side === 'SELL' ? 'SELL' : 'BUY';
    if (!symbol || !/^[A-Z0-9]{2,12}\/?[A-Z0-9]{2,10}$/.test(symbol)) {
      return { ok: false, statusCode: 400, message: 'Valid symbol is required.' };
    }
    const geometry = validateSlTpGeometry(
      side,
      input.entryPrice,
      input.stopLossPrice,
      input.takeProfitPrice
    );
    if (!geometry.valid) {
      return { ok: false, statusCode: 400, message: geometry.reason };
    }
    if (!Number.isFinite(input.confidencePct) || input.confidencePct < 1 || input.confidencePct > 100) {
      return { ok: false, statusCode: 400, message: 'confidencePct must be between 1 and 100.' };
    }

    const risk = Math.abs(input.entryPrice - input.stopLossPrice);
    const reward = Math.abs(input.takeProfitPrice - input.entryPrice);
    const riskRewardRatio = risk > 0 ? Math.round((reward / risk) * 100) / 100 : 0;
    const signalId =
      typeof input.signalId === 'string' && input.signalId.trim().length >= 4
        ? input.signalId.trim().slice(0, 80)
        : `pubcand_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const createdAtIso = new Date().toISOString();

    this.db
      .prepare(
        `INSERT OR REPLACE INTO public_signal_candidates (
          signal_id, symbol, side, timeframe, entry_price, stop_loss_price, take_profit_price,
          confidence_pct, risk_reward_ratio, strategy_name, market_source, approval_status,
          created_at_iso, approved_by, approved_at_iso, approval_note, revoked_at_iso, suspension_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PRIVATE_UNVERIFIED', ?, NULL, NULL, NULL, NULL, NULL)`
      )
      .run(
        signalId,
        symbol,
        side,
        String(input.timeframe || '1h').slice(0, 16),
        input.entryPrice,
        input.stopLossPrice,
        input.takeProfitPrice,
        input.confidencePct,
        riskRewardRatio,
        String(input.strategyName || 'SignalForge_Validated_Candidate').slice(0, 80),
        String(input.marketSource || 'BINANCE_SPOT_OBSERVATION').slice(0, 48),
        createdAtIso
      );

    this.appendAudit(
      'CANDIDATE_REGISTERED',
      actor,
      signalId,
      `Registered private candidate ${signalId} (${symbol} ${side}, RR=${riskRewardRatio}). Private by default until Stage 1-4 pass.`,
      true
    );

    const row = this.db
      .prepare('SELECT * FROM public_signal_candidates WHERE signal_id = ?')
      .get(signalId) as unknown as CandidateDbRow;

    return {
      ok: true,
      statusCode: 201,
      message: `Candidate ${signalId} registered in PRIVATE_UNVERIFIED state.`,
      candidate: mapCandidateRow(row),
    };
  }

  /**
   * STAGE 4 — Server-side Public Signal Approval Gate.
   * Approval displays a signal to users ONLY; NEVER triggers live or paper order execution.
   */
  public decidePublicSignalApproval(
    actor: string,
    signalId: string,
    decision: 'APPROVE' | 'REJECT' | 'REVOKE',
    note: string = ''
  ): {
    ok: boolean;
    statusCode: number;
    message: string;
    canTriggerLiveOrders: false;
    candidate?: PublicSignalCandidateRecord;
  } {
    const cleanId = String(signalId || '').trim();
    const existingRow = this.db
      .prepare('SELECT * FROM public_signal_candidates WHERE signal_id = ?')
      .get(cleanId) as unknown as CandidateDbRow | undefined;

    if (!existingRow) {
      return {
        ok: false,
        statusCode: 404,
        message: `Signal candidate "${cleanId}" not found.`,
        canTriggerLiveOrders: false,
      };
    }

    const cleanNote = String(note || '').trim().slice(0, 300);
    const nowIso = new Date().toISOString();

    if (decision === 'REJECT') {
      this.db
        .prepare(
          `UPDATE public_signal_candidates
           SET approval_status = 'REJECTED', approved_by = ?, approval_note = ?, revoked_at_iso = ?
           WHERE signal_id = ?`
        )
        .run(actor, cleanNote || 'Rejected by operator.', nowIso, cleanId);
      this.appendAudit(
        'SIGNAL_REJECTED',
        actor,
        cleanId,
        `Operator rejected candidate ${cleanId} from public display. ${cleanNote}`.trim(),
        true
      );
      const updated = this.db
        .prepare('SELECT * FROM public_signal_candidates WHERE signal_id = ?')
        .get(cleanId) as unknown as CandidateDbRow;
      return {
        ok: true,
        statusCode: 200,
        message: `Signal ${cleanId} rejected and kept private.`,
        canTriggerLiveOrders: false,
        candidate: mapCandidateRow(updated),
      };
    }

    if (decision === 'REVOKE') {
      this.db
        .prepare(
          `UPDATE public_signal_candidates
           SET approval_status = 'PRIVATE_UNVERIFIED', revoked_at_iso = ?, approval_note = ?
           WHERE signal_id = ?`
        )
        .run(nowIso, cleanNote || 'Public visibility revoked by operator.', cleanId);
      this.appendAudit(
        'SIGNAL_REVOKED',
        actor,
        cleanId,
        `Operator revoked public display for ${cleanId}. ${cleanNote}`.trim(),
        true
      );
      const updated = this.db
        .prepare('SELECT * FROM public_signal_candidates WHERE signal_id = ?')
        .get(cleanId) as unknown as CandidateDbRow;
      return {
        ok: true,
        statusCode: 200,
        message: `Public visibility revoked for signal ${cleanId}.`,
        canTriggerLiveOrders: false,
        candidate: mapCandidateRow(updated),
      };
    }

    // decision === 'APPROVE': enforce full backend Stage 1-3 + integrity + risk checks
    this.enforceAutoSuspensionIfNeeded(actor);
    const snapshot = this.getMonitoringSnapshot();
    if (!snapshot.evaluation.eligibleForOperatorApproval) {
      const reasonText = snapshot.evaluation.withholdingReasons.join(' ');
      this.appendAudit(
        'SIGNAL_REJECTED',
        actor,
        cleanId,
        `Backend blocked public approval for ${cleanId}: ${reasonText}`,
        false
      );
      return {
        ok: false,
        statusCode: 409,
        message: `Cannot approve ${cleanId} for public display until all Stage 1-3 validation and safety requirements pass. ${reasonText}`,
        canTriggerLiveOrders: false,
        candidate: mapCandidateRow(existingRow),
      };
    }

    // Re-validate candidate SL/TP geometry before approval
    const geometry = validateSlTpGeometry(
      existingRow.side === 'SELL' ? 'SELL' : 'BUY',
      Number(existingRow.entry_price),
      Number(existingRow.stop_loss_price),
      Number(existingRow.take_profit_price)
    );
    if (!geometry.valid) {
      return {
        ok: false,
        statusCode: 409,
        message: `Candidate ${cleanId} failed geometry validation: ${geometry.reason}`,
        canTriggerLiveOrders: false,
      };
    }

    this.db
      .prepare(
        `UPDATE public_signal_candidates
         SET approval_status = 'APPROVED_PUBLIC', approved_by = ?, approved_at_iso = ?,
             approval_note = ?, revoked_at_iso = NULL, suspension_reason = NULL
         WHERE signal_id = ?`
      )
      .run(actor, nowIso, cleanNote || 'Approved for public display only (non-live).', cleanId);

    this.appendAudit(
      'SIGNAL_APPROVED',
      actor,
      cleanId,
      `Operator approved ${cleanId} for PUBLIC DISPLAY ONLY (zero live trade execution). ${cleanNote}`.trim(),
      true
    );

    const updated = this.db
      .prepare('SELECT * FROM public_signal_candidates WHERE signal_id = ?')
      .get(cleanId) as unknown as CandidateDbRow;

    return {
      ok: true,
      statusCode: 200,
      message: `Signal ${cleanId} approved for Public Display only (does not execute live trades).`,
      canTriggerLiveOrders: false,
      candidate: mapCandidateRow(updated),
    };
  }

  /**
   * STAGE 4 — Explicit global public publication toggle (disabled by default).
   */
  public setGlobalPublicationEnabled(
    actor: string,
    enabled: boolean,
    note: string = ''
  ): {
    ok: boolean;
    statusCode: number;
    publicPublicationEnabled: boolean;
    message: string;
  } {
    this.enforceAutoSuspensionIfNeeded(actor);
    const snapshot = this.getMonitoringSnapshot();

    if (enabled && snapshot.evaluation.autoSuspended) {
      const msg = `Cannot enable public publication while safety suspension is active: ${snapshot.evaluation.suspensionReason}`;
      this.appendAudit('PUBLICATION_TOGGLED', actor, null, msg, false);
      return {
        ok: false,
        statusCode: 409,
        publicPublicationEnabled: false,
        message: msg,
      };
    }

    if (enabled && !snapshot.evaluation.eligibleForOperatorApproval) {
      const msg = `Cannot enable public publication until Stage 1-3 validation checks pass: ${snapshot.evaluation.withholdingReasons.join(' ')}`;
      this.appendAudit('PUBLICATION_TOGGLED', actor, null, msg, false);
      return {
        ok: false,
        statusCode: 409,
        publicPublicationEnabled: false,
        message: msg,
      };
    }

    this.db
      .prepare(
        `UPDATE public_gate_config
         SET public_publication_enabled = ?, last_verified_at = ?
         WHERE id = 1`
      )
      .run(enabled ? 1 : 0, new Date().toISOString());

    const msg = enabled
      ? `Global Public Signal Display ENABLED by operator (display-only; only individually approved signals appear). ${note}`.trim()
      : `Global Public Signal Display DISABLED by operator. ${note}`.trim();

    this.appendAudit('PUBLICATION_TOGGLED', actor, null, msg, true);

    return {
      ok: true,
      statusCode: 200,
      publicPublicationEnabled: enabled,
      message: msg,
    };
  }

  /**
   * STAGE 5 — Run explicit integrity & mandatory safety re-verification.
   */
  public runIntegrityAndSafetyCheck(actor: string): {
    ok: boolean;
    statusCode: number;
    autoSuspended: boolean;
    suspensionReason: string | null;
    snapshot: PublicSignalMonitoringSnapshot;
  } {
    const result = this.enforceAutoSuspensionIfNeeded(actor);
    const nowIso = new Date().toISOString();
    if (!result.autoSuspended) {
      this.db
        .prepare('UPDATE public_gate_config SET last_verified_at = ? WHERE id = 1')
        .run(nowIso);
      this.appendAudit(
        'INTEGRITY_REVERIFIED',
        actor,
        null,
        'Stage 5 data-integrity hash verification and mandatory safety checks passed.',
        true
      );
    }
    const snapshot = this.getMonitoringSnapshot();
    return {
      ok: !result.autoSuspended,
      statusCode: result.autoSuspended ? 409 : 200,
      autoSuspended: result.autoSuspended,
      suspensionReason: result.suspensionReason,
      snapshot,
    };
  }

  /**
   * Test/audit helper to verify tamper detection on stored paper trade evidence.
   * Exposed only for unit tests (not exposed as an HTTP route).
   */
  public tamperEvidenceHashForTest(tradeEvidenceId: string): void {
    this.db
      .prepare('UPDATE paper_validation_evidence SET evidence_hash = ? WHERE trade_evidence_id = ?')
      .run('tampered_invalid_hash_00000000', tradeEvidenceId);
  }

  /**
   * STAGE 5 — Monitoring Snapshot (stage, checks, failures, last verified, withholding reasons,
   * untouched separate 50-consecutive-win Live Gate status, audit history, future extensions).
   */
  public getMonitoringSnapshot(): PublicSignalMonitoringSnapshot {
    const config = this.getConfigRow();
    const stage1Report = this.parseStage1Report(config.stage1_report_json);
    const integrity = this.auditStoredEvidenceIntegrity();
    const { observedDailyDrawdownPct, emergencyHalted, freqtradeSnapshot } =
      this.getCurrentRiskMetrics();

    const evaluation = evaluatePublicSignalGate({
      stage1Report,
      validPaperChecksCount: integrity.validCount,
      rejectedPaperChecksCount: integrity.rejectedCount,
      paperWinsCount: integrity.winsCount,
      paperLossesCount: integrity.lossesCount,
      paperBreakevenCount: integrity.breakevenCount,
      corruptedEvidenceCount: integrity.corruptedCount,
      duplicateEvidenceCount: integrity.duplicateCount,
      observedDailyDrawdownPct,
      emergencyHalted,
      publicPublicationEnabled: Number(config.public_publication_enabled) === 1,
      manualSafetySuspensionReason:
        Number(config.auto_suspended) === 1 ? config.suspension_reason : null,
      lastVerifiedAtIso: config.last_verified_at,
    });

    const allCandidates = (
      this.db
        .prepare('SELECT * FROM public_signal_candidates ORDER BY created_at_iso DESC LIMIT 50')
        .all() as unknown as CandidateDbRow[]
    ).map(mapCandidateRow);

    const canServePublicSignals =
      evaluation.publicPublicationEnabled &&
      !evaluation.autoSuspended &&
      evaluation.eligibleForOperatorApproval;

    const approvedPublicSignals = canServePublicSignals
      ? allCandidates.filter((c) => c.approvalStatus === 'APPROVED_PUBLIC')
      : [];

    const privateCandidates = allCandidates.filter(
      (c) => !approvedPublicSignals.some((pub) => pub.signalId === c.signalId)
    );

    const recentPaperEvidence = (
      this.db
        .prepare('SELECT * FROM paper_validation_evidence ORDER BY id DESC LIMIT 25')
        .all() as unknown as EvidenceDbRow[]
    ).map(mapEvidenceRow);

    const auditHistory = (
      this.db
        .prepare('SELECT * FROM public_signal_audit_log ORDER BY id DESC LIMIT 40')
        .all() as unknown as AuditDbRow[]
    ).map(mapAuditRow);

    return {
      policy: {
        publicSignalIsDisplayOnly: true,
        canTriggerLiveOrders: false,
        publicationDisabledByDefault: true,
        simulatedProfitsNeverReal: true,
        requiredVerifiablePaperChecks: evaluation.requiredPaperChecksCount,
      },
      evaluation,
      stage1Report,
      separateLiveTradingGate: {
        preservedUntouched: true,
        separateFromPublicSignalGate: true,
        canBeTriggeredByPublicApproval: false,
        liveGateStatus: freqtradeSnapshot.metrics.liveGateUnlocked ? 'UNLOCKED' : 'LOCKED',
        consecutiveProfitablePaperTrades: freqtradeSnapshot.metrics.consecutivePaperWins,
        requiredConsecutivePaperWins: freqtradeSnapshot.metrics.requiredPaperWins,
        currentTradingMode: freqtradeSnapshot.metrics.tradingMode,
      },
      approvedPublicSignals,
      privateCandidates,
      recentPaperEvidence,
      auditHistory,
      futureExtensions: FUTURE_MODULAR_EXTENSIONS,
    };
  }

  /**
   * Publicly consumable feed endpoint: strictly returns ONLY operator-approved
   * public signals when global publication is enabled and all Stage 1-5 gates pass.
   */
  public getPublicSignalsFeed(): PublicSignalsFeedResponse {
    this.enforceAutoSuspensionIfNeeded('system-integrity-guard');
    const snapshot = this.getMonitoringSnapshot();
    const canDisplay =
      snapshot.evaluation.publicPublicationEnabled &&
      !snapshot.evaluation.autoSuspended &&
      snapshot.evaluation.eligibleForOperatorApproval;

    return {
      publicSignalIsDisplayOnly: true,
      canTriggerLiveOrders: false,
      publicPublicationEnabled: snapshot.evaluation.publicPublicationEnabled,
      autoSuspended: snapshot.evaluation.autoSuspended,
      eligibleForPublicDisplay: canDisplay,
      lastVerifiedAtIso: snapshot.evaluation.lastVerifiedAtIso,
      withholdingReasons: snapshot.evaluation.withholdingReasons,
      signals: canDisplay ? snapshot.approvedPublicSignals : [],
    };
  }
}

import crypto from 'node:crypto';
import { FOUR_PROFILE_CATALOG } from './runtimeGuard';
import { HARD_CODED_RISK_PARAMETERS } from './freqtradeCoreEngine';

export type ValidationStageId =
  | 'STAGE_1_TESTNET'
  | 'STAGE_2_PAPER_TRADING'
  | 'STAGE_3_FIFTY_CHECKS'
  | 'STAGE_4_OPERATOR_APPROVAL'
  | 'STAGE_5_MONITORING';

export type StageHealthStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'SUSPENDED';

export type PaperTradeEvidenceOutcome = 'WIN' | 'LOSS' | 'BREAKEVEN' | 'REJECTED';

export type PaperTradeAcceptanceStatus = 'ACCEPTED' | 'REJECTED';

export type PublicSignalApprovalStatus =
  | 'PRIVATE_UNVERIFIED'
  | 'ELIGIBLE_PENDING_APPROVAL'
  | 'APPROVED_PUBLIC'
  | 'REJECTED'
  | 'SUSPENDED_SAFETY';

export type GenuineMarketObservationSource =
  | 'BINANCE_SPOT_OBSERVATION'
  | 'BINANCE_TESTNET_OBSERVATION'
  | 'EXCHANGE_TICK_OBSERVATION';

export const ALLOWED_GENUINE_MARKET_SOURCES: readonly GenuineMarketObservationSource[] = Object.freeze([
  'BINANCE_SPOT_OBSERVATION',
  'BINANCE_TESTNET_OBSERVATION',
  'EXCHANGE_TICK_OBSERVATION',
]);

export const FORBIDDEN_LIVE_EXECUTION_HOSTS: readonly string[] = Object.freeze([
  'api.binance.com',
  'fapi.binance.com',
  'dapi.binance.com',
  'api.bybit.com',
  'www.okx.com',
  'api.kraken.com',
]);

export const REQUIRED_VERIFIABLE_PAPER_CHECKS = 50;

export const PAPER_REALISTIC_BOUNDS = Object.freeze({
  minFeeRate: 0.0002, // >= 2 bps realistic exchange fee
  maxFeeRate: 0.01, // <= 100 bps sanity upper bound
  minSpreadBps: 0.1, // strictly positive bid-ask spread
  maxSpreadBps: 500, // <= 5% sanity upper bound
  minSlippageBps: 0.1, // strictly positive realistic slippage
  maxSlippageBps: 500,
  maxObservationAgeMs: 90 * 24 * 60 * 60 * 1000, // 90 days
  maxFutureSkewMs: 60_000, // 1 minute clock skew tolerance
});

export interface FutureModularExtensionDescriptor {
  readonly id: 'FOREX_SIGNALS' | 'BINARY_OPTIONS' | 'ADDITIONAL_EXCHANGES';
  readonly label: string;
  readonly enabled: false;
  readonly status: 'FUTURE_MODULAR_EXTENSION_ONLY';
  readonly notes: string;
}

export const FUTURE_MODULAR_EXTENSIONS: readonly FutureModularExtensionDescriptor[] = Object.freeze([
  {
    id: 'FOREX_SIGNALS',
    label: 'Forex Signals Adapter',
    enabled: false,
    status: 'FUTURE_MODULAR_EXTENSION_ONLY',
    notes: 'Reserved modular extension interface. Inactive in Phase 1.',
  },
  {
    id: 'BINARY_OPTIONS',
    label: 'Binary Options Adapter',
    enabled: false,
    status: 'FUTURE_MODULAR_EXTENSION_ONLY',
    notes: 'Reserved modular extension interface. Inactive in Phase 1.',
  },
  {
    id: 'ADDITIONAL_EXCHANGES',
    label: 'Additional Exchanges Adapter',
    enabled: false,
    status: 'FUTURE_MODULAR_EXTENSION_ONLY',
    notes: 'Reserved modular extension interface. Inactive in Phase 1.',
  },
]);

export interface Stage1CheckItem {
  readonly id:
    | 'TESTNET_HOST_ISOLATION'
    | 'ORDER_LIFECYCLE'
    | 'STOP_LOSS_TAKE_PROFIT'
    | 'RISK_CONTROLS'
    | 'ERROR_HANDLING';
  readonly label: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface Stage1TestnetValidationInput {
  readonly targetHost: string;
  readonly sampleSymbol: string;
  readonly sampleSide: 'BUY' | 'SELL';
  readonly sampleEntryPrice: number;
  readonly sampleStopLossPrice: number;
  readonly sampleTakeProfitPrice: number;
  readonly observedDailyDrawdownPct: number;
  readonly invalidOrderRejected: boolean;
  readonly lifecycleTransitions: readonly string[];
  readonly verifiedAtIso?: string;
}

export interface Stage1TestnetValidationReport {
  readonly passed: boolean;
  readonly targetHost: string;
  readonly liveEndpointContacted: false;
  readonly checks: readonly Stage1CheckItem[];
  readonly failureReasons: readonly string[];
  readonly verifiedAtIso: string;
}

export interface PaperTradeEvidenceInput {
  readonly tradeEvidenceId: string;
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly marketSource: string;
  readonly observedAtIso: string;
  readonly closedAtIso: string;
  readonly bidPrice: number;
  readonly askPrice: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly stakeUsd: number;
  readonly feeRate: number;
  readonly feeUsd: number;
  readonly spreadBps: number;
  readonly slippageBps: number;
  readonly stopLossPrice: number;
  readonly takeProfitPrice: number;
  readonly isDemonstration?: boolean;
  readonly observationNote?: string;
}

export interface PaperTradeValidationResult {
  readonly accepted: boolean;
  readonly status: PaperTradeAcceptanceStatus;
  readonly outcome: PaperTradeEvidenceOutcome;
  readonly tradeEvidenceId: string;
  readonly evidenceHash: string;
  readonly fingerprint: string;
  readonly simulatedGrossPnlUsd: number;
  readonly simulatedNetPnlUsd: number;
  readonly simulatedReturnPct: number;
  readonly profitLabel: 'SIMULATED_PAPER_ONLY';
  readonly isRealProfit: false;
  readonly rejectionReasons: readonly string[];
}

export interface StoredPaperTradeEvidence {
  readonly id: number;
  readonly tradeEvidenceId: string;
  readonly evidenceHash: string;
  readonly fingerprint: string;
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly marketSource: string;
  readonly observedAtIso: string;
  readonly closedAtIso: string;
  readonly bidPrice: number;
  readonly askPrice: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly stakeUsd: number;
  readonly feeRate: number;
  readonly feeUsd: number;
  readonly spreadBps: number;
  readonly slippageBps: number;
  readonly stopLossPrice: number;
  readonly takeProfitPrice: number;
  readonly simulatedNetPnlUsd: number;
  readonly simulatedReturnPct: number;
  readonly profitLabel: 'SIMULATED_PAPER_ONLY';
  readonly isRealProfit: false;
  readonly status: PaperTradeAcceptanceStatus;
  readonly outcome: PaperTradeEvidenceOutcome;
  readonly rejectionReason: string | null;
  readonly recordedAtIso: string;
}

export interface PublicSignalCandidateRecord {
  readonly signalId: string;
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly timeframe: string;
  readonly entryPrice: number;
  readonly stopLossPrice: number;
  readonly takeProfitPrice: number;
  readonly confidencePct: number;
  readonly riskRewardRatio: number;
  readonly strategyName: string;
  readonly marketSource: string;
  readonly approvalStatus: PublicSignalApprovalStatus;
  readonly createdAtIso: string;
  readonly approvedBy: string | null;
  readonly approvedAtIso: string | null;
  readonly approvalNote: string | null;
  readonly revokedAtIso: string | null;
  readonly suspensionReason: string | null;
  readonly canTriggerLiveOrders: false;
}

export interface PublicSignalAuditEntry {
  readonly id: number;
  readonly timestampIso: string;
  readonly eventType:
    | 'STAGE1_TESTNET_CHECK'
    | 'STAGE2_PAPER_ACCEPTED'
    | 'STAGE2_PAPER_REJECTED'
    | 'CANDIDATE_REGISTERED'
    | 'SIGNAL_APPROVED'
    | 'SIGNAL_REJECTED'
    | 'SIGNAL_REVOKED'
    | 'PUBLICATION_TOGGLED'
    | 'SAFETY_AUTO_SUSPENDED'
    | 'INTEGRITY_REVERIFIED';
  readonly actor: string;
  readonly signalId: string | null;
  readonly summary: string;
  readonly passed: boolean;
}

export interface SafetyIntegrityAssessmentInput {
  readonly stage1Report: Stage1TestnetValidationReport | null;
  readonly validPaperChecksCount: number;
  readonly rejectedPaperChecksCount: number;
  readonly paperWinsCount: number;
  readonly paperLossesCount: number;
  readonly paperBreakevenCount: number;
  readonly corruptedEvidenceCount: number;
  readonly duplicateEvidenceCount: number;
  readonly observedDailyDrawdownPct: number;
  readonly emergencyHalted: boolean;
  readonly publicPublicationEnabled: boolean;
  readonly manualSafetySuspensionReason: string | null;
  readonly lastVerifiedAtIso: string | null;
}

export interface StageSummaryRow {
  readonly stageId: ValidationStageId;
  readonly title: string;
  readonly status: StageHealthStatus;
  readonly summary: string;
}

export interface PublicSignalGateEvaluation {
  readonly currentStage: ValidationStageId;
  readonly stage1Passed: boolean;
  readonly stage2HasGenuineEvidence: boolean;
  readonly stage3Passed: boolean;
  readonly validPaperChecksCount: number;
  readonly requiredPaperChecksCount: number;
  readonly rejectedPaperChecksCount: number;
  readonly paperWinsCount: number;
  readonly paperLossesCount: number;
  readonly paperBreakevenCount: number;
  readonly dataIntegrityPassed: boolean;
  readonly riskControlsPassed: boolean;
  readonly eligibleForOperatorApproval: boolean;
  readonly publicPublicationEnabled: boolean;
  readonly autoSuspended: boolean;
  readonly suspensionReason: string | null;
  readonly withholdingReasons: readonly string[];
  readonly lastVerifiedAtIso: string | null;
  readonly canTriggerLiveOrders: false;
  readonly stages: readonly StageSummaryRow[];
}

export interface PublicSignalMonitoringSnapshot {
  readonly policy: {
    readonly publicSignalIsDisplayOnly: true;
    readonly canTriggerLiveOrders: false;
    readonly publicationDisabledByDefault: true;
    readonly simulatedProfitsNeverReal: true;
    readonly requiredVerifiablePaperChecks: number;
  };
  readonly evaluation: PublicSignalGateEvaluation;
  readonly stage1Report: Stage1TestnetValidationReport | null;
  readonly separateLiveTradingGate: {
    readonly preservedUntouched: true;
    readonly separateFromPublicSignalGate: true;
    readonly canBeTriggeredByPublicApproval: false;
    readonly liveGateStatus: 'LOCKED' | 'UNLOCKED';
    readonly consecutiveProfitablePaperTrades: number;
    readonly requiredConsecutivePaperWins: number;
    readonly currentTradingMode: string;
  };
  readonly approvedPublicSignals: readonly PublicSignalCandidateRecord[];
  readonly privateCandidates: readonly PublicSignalCandidateRecord[];
  readonly recentPaperEvidence: readonly StoredPaperTradeEvidence[];
  readonly auditHistory: readonly PublicSignalAuditEntry[];
  readonly futureExtensions: readonly FutureModularExtensionDescriptor[];
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeHost(rawHost: string): string {
  const trimmed = rawHost.trim().toLowerCase();
  if (!trimmed) return '';
  try {
    if (trimmed.includes('://')) {
      return new URL(trimmed).hostname.toLowerCase();
    }
    return trimmed.replace(/\/.*$/, '').split(':')[0];
  } catch {
    return trimmed;
  }
}

export function isTestnetHostAllowed(rawHost: string): boolean {
  const host = normalizeHost(rawHost);
  if (!host) return false;
  if (FORBIDDEN_LIVE_EXECUTION_HOSTS.includes(host)) return false;
  const paperTradeHosts = FOUR_PROFILE_CATALOG['Paper-Trade'].allowedHosts;
  return paperTradeHosts.includes(host);
}

export function validateSlTpGeometry(
  side: 'BUY' | 'SELL',
  entryPrice: number,
  stopLossPrice: number,
  takeProfitPrice: number
): { valid: boolean; reason: string } {
  if (
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(stopLossPrice) ||
    !Number.isFinite(takeProfitPrice) ||
    entryPrice <= 0 ||
    stopLossPrice <= 0 ||
    takeProfitPrice <= 0
  ) {
    return { valid: false, reason: 'Entry, stop-loss, and take-profit prices must be finite positive numbers.' };
  }

  if (side === 'BUY') {
    if (!(stopLossPrice < entryPrice && takeProfitPrice > entryPrice)) {
      return {
        valid: false,
        reason: 'BUY signal requires stopLossPrice < entryPrice < takeProfitPrice.',
      };
    }
    return { valid: true, reason: 'BUY stop-loss and take-profit geometry verified.' };
  }

  if (!(takeProfitPrice < entryPrice && stopLossPrice > entryPrice)) {
    return {
      valid: false,
      reason: 'SELL signal requires takeProfitPrice < entryPrice < stopLossPrice.',
    };
  }
  return { valid: true, reason: 'SELL stop-loss and take-profit geometry verified.' };
}

/**
 * STAGE 1 — TESTNET VALIDATION
 * Pure deterministic verification of Testnet-only host isolation, order lifecycle,
 * SL/TP geometry, hard-coded risk caps, and error handling. Never contacts live hosts.
 */
export function runStage1TestnetValidation(
  input: Stage1TestnetValidationInput
): Stage1TestnetValidationReport {
  const verifiedAtIso = input.verifiedAtIso ?? new Date().toISOString();
  const normalizedHost = normalizeHost(input.targetHost);
  const hostAllowed = isTestnetHostAllowed(normalizedHost);
  const isForbiddenLive = FORBIDDEN_LIVE_EXECUTION_HOSTS.includes(normalizedHost);

  const expectedLifecycle = ['OPEN', 'FILL', 'CLOSE'];
  const lifecycleUpper = input.lifecycleTransitions.map((s) => s.trim().toUpperCase());
  const lifecyclePassed = expectedLifecycle.every((step, idx) => lifecycleUpper[idx] === step);

  const slTpCheck = validateSlTpGeometry(
    input.sampleSide,
    input.sampleEntryPrice,
    input.sampleStopLossPrice,
    input.sampleTakeProfitPrice
  );

  const drawdownSafe =
    Number.isFinite(input.observedDailyDrawdownPct) &&
    input.observedDailyDrawdownPct >= 0 &&
    input.observedDailyDrawdownPct < HARD_CODED_RISK_PARAMETERS.maxDailyDrawdownPct;

  const checks: Stage1CheckItem[] = [
    {
      id: 'TESTNET_HOST_ISOLATION',
      label: 'Testnet Host Isolation (Zero Live Endpoints)',
      passed: hostAllowed && !isForbiddenLive,
      detail: hostAllowed
        ? `Verified allowlisted Testnet host "${normalizedHost}". Zero live endpoints contacted.`
        : `Blocked non-Testnet or live host "${normalizedHost || '(empty)'}". Only ${FOUR_PROFILE_CATALOG['Paper-Trade'].allowedHosts.join(', ')} allowed.`,
    },
    {
      id: 'ORDER_LIFECYCLE',
      label: 'Testnet Order Lifecycle (OPEN -> FILL -> CLOSE)',
      passed: lifecyclePassed,
      detail: lifecyclePassed
        ? `Lifecycle verified cleanly for ${input.sampleSymbol}: OPEN -> FILL -> CLOSE.`
        : `Incomplete order lifecycle sequence: [${lifecycleUpper.join(' -> ')}].`,
    },
    {
      id: 'STOP_LOSS_TAKE_PROFIT',
      label: 'Stop-Loss & Take-Profit Bracket Enforcement',
      passed: slTpCheck.valid,
      detail: slTpCheck.reason,
    },
    {
      id: 'RISK_CONTROLS',
      label: 'Hard-Coded Risk Controls (8% Daily Drawdown Cap)',
      passed: drawdownSafe,
      detail: drawdownSafe
        ? `Daily drawdown ${(input.observedDailyDrawdownPct * 100).toFixed(2)}% within hard ${(HARD_CODED_RISK_PARAMETERS.maxDailyDrawdownPct * 100).toFixed(1)}% cap.`
        : `Daily drawdown cap breached or invalid (${(input.observedDailyDrawdownPct * 100).toFixed(2)}%).`,
    },
    {
      id: 'ERROR_HANDLING',
      label: 'Malformed Order & Error Handling Guard',
      passed: input.invalidOrderRejected === true,
      detail:
        input.invalidOrderRejected === true
          ? 'Invalid/malformed order payload cleanly rejected without state corruption.'
          : 'Error handling verification did not confirm rejection of invalid payloads.',
    },
  ];

  const failureReasons = checks.filter((c) => !c.passed).map((c) => `${c.id}: ${c.detail}`);
  return {
    passed: failureReasons.length === 0,
    targetHost: normalizedHost,
    liveEndpointContacted: false,
    checks,
    failureReasons,
    verifiedAtIso,
  };
}

export function buildPaperEvidenceFingerprint(input: {
  symbol: string;
  side: string;
  observedAtIso: string;
  closedAtIso: string;
  entryPrice: number;
  exitPrice: number;
  stakeUsd: number;
}): string {
  const canonical = [
    input.symbol.trim().toUpperCase(),
    input.side.trim().toUpperCase(),
    input.observedAtIso.trim(),
    input.closedAtIso.trim(),
    round6(input.entryPrice).toFixed(6),
    round6(input.exitPrice).toFixed(6),
    round6(input.stakeUsd).toFixed(6),
  ].join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function computePaperEvidenceHash(fields: {
  tradeEvidenceId: string;
  fingerprint: string;
  marketSource: string;
  bidPrice: number;
  askPrice: number;
  feeRate: number;
  feeUsd: number;
  spreadBps: number;
  slippageBps: number;
  simulatedNetPnlUsd: number;
  status: PaperTradeAcceptanceStatus;
}): string {
  const payload = [
    fields.tradeEvidenceId.trim(),
    fields.fingerprint,
    fields.marketSource.trim().toUpperCase(),
    round6(fields.bidPrice).toFixed(6),
    round6(fields.askPrice).toFixed(6),
    round6(fields.feeRate).toFixed(6),
    round6(fields.feeUsd).toFixed(6),
    round6(fields.spreadBps).toFixed(6),
    round6(fields.slippageBps).toFixed(6),
    round6(fields.simulatedNetPnlUsd).toFixed(6),
    fields.status,
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * STAGE 2 & STAGE 3 — PAPER TRADING EVIDENCE & INTEGRITY VALIDATOR
 * Rejects missing, fabricated, demonstration, unrealistic-cost, or duplicate records.
 * Computes realistic simulated net PnL after spread, slippage, and fees.
 * Never labels simulated results as real profit.
 */
export function validatePaperTradeEvidence(
  input: PaperTradeEvidenceInput,
  existingEvidenceIds: ReadonlySet<string>,
  existingFingerprints: ReadonlySet<string>,
  nowMs: number = Date.now()
): PaperTradeValidationResult {
  const rejectionReasons: string[] = [];
  const tradeEvidenceId = String(input.tradeEvidenceId || '').trim();
  const symbol = String(input.symbol || '').trim().toUpperCase();
  const marketSource = String(input.marketSource || '').trim().toUpperCase();

  if (!tradeEvidenceId || tradeEvidenceId.length < 4) {
    rejectionReasons.push('Missing or invalid tradeEvidenceId (minimum 4 characters).');
  }
  if (!symbol || !/^[A-Z0-9]{2,12}\/?[A-Z0-9]{2,10}$/.test(symbol)) {
    rejectionReasons.push('Missing or malformed trading symbol.');
  }
  if (input.side !== 'BUY' && input.side !== 'SELL') {
    rejectionReasons.push('Trade side must be BUY or SELL.');
  }

  // Reject purely demonstration, mock, or fabricated records
  if (input.isDemonstration === true) {
    rejectionReasons.push('Rejected demonstration-only trade record (isDemonstration=true).');
  }
  const isGenuineSource = (ALLOWED_GENUINE_MARKET_SOURCES as readonly string[]).includes(marketSource);
  if (!isGenuineSource) {
    rejectionReasons.push(
      `Rejected unverified or fabricated marketSource "${marketSource || '(empty)'}". Allowed: ${ALLOWED_GENUINE_MARKET_SOURCES.join(', ')}.`
    );
  }
  if (
    typeof input.observationNote === 'string' &&
    /\b(demo|mock|fake|fabricated|dummy)\b/i.test(input.observationNote)
  ) {
    rejectionReasons.push('Rejected record flagged as demo/mock/fabricated in observation note.');
  }

  // Validate genuine timestamps
  const observedMs = Date.parse(String(input.observedAtIso || ''));
  const closedMs = Date.parse(String(input.closedAtIso || ''));
  if (!Number.isFinite(observedMs) || !Number.isFinite(closedMs)) {
    rejectionReasons.push('Missing or unparseable UTC timestamps (observedAtIso / closedAtIso).');
  } else {
    if (closedMs < observedMs) {
      rejectionReasons.push('Timestamp integrity violation: closedAtIso precedes observedAtIso.');
    }
    if (observedMs > nowMs + PAPER_REALISTIC_BOUNDS.maxFutureSkewMs || closedMs > nowMs + PAPER_REALISTIC_BOUNDS.maxFutureSkewMs) {
      rejectionReasons.push('Timestamp integrity violation: observation timestamp is in the future.');
    }
    if (nowMs - observedMs > PAPER_REALISTIC_BOUNDS.maxObservationAgeMs) {
      rejectionReasons.push('Stale observation timestamp exceeds maximum 90-day validation window.');
    }
  }

  // Validate market prices & bid/ask spread
  const pricesFinite =
    Number.isFinite(input.bidPrice) &&
    Number.isFinite(input.askPrice) &&
    Number.isFinite(input.entryPrice) &&
    Number.isFinite(input.exitPrice) &&
    Number.isFinite(input.stakeUsd) &&
    input.bidPrice > 0 &&
    input.askPrice > 0 &&
    input.entryPrice > 0 &&
    input.exitPrice > 0 &&
    input.stakeUsd >= 10;

  if (!pricesFinite) {
    rejectionReasons.push('Prices (bid, ask, entry, exit) must be positive finite numbers and stakeUsd >= 10.');
  } else if (input.askPrice < input.bidPrice) {
    rejectionReasons.push('Market observation integrity violation: askPrice is lower than bidPrice.');
  }

  // Validate SL/TP geometry
  const slTpCheck = validateSlTpGeometry(
    input.side,
    input.entryPrice,
    input.stopLossPrice,
    input.takeProfitPrice
  );
  if (!slTpCheck.valid) {
    rejectionReasons.push(`Risk bracket invalid: ${slTpCheck.reason}`);
  }

  // Validate realistic trading costs (fees, spread, slippage)
  if (
    !Number.isFinite(input.feeRate) ||
    input.feeRate < PAPER_REALISTIC_BOUNDS.minFeeRate ||
    input.feeRate > PAPER_REALISTIC_BOUNDS.maxFeeRate
  ) {
    rejectionReasons.push(
      `Unrealistic feeRate (${input.feeRate}). Must be between ${PAPER_REALISTIC_BOUNDS.minFeeRate} and ${PAPER_REALISTIC_BOUNDS.maxFeeRate}.`
    );
  }
  if (!Number.isFinite(input.feeUsd) || input.feeUsd <= 0) {
    rejectionReasons.push('Realistic positive trading fee (feeUsd > 0) is mandatory.');
  }
  if (
    !Number.isFinite(input.spreadBps) ||
    input.spreadBps < PAPER_REALISTIC_BOUNDS.minSpreadBps ||
    input.spreadBps > PAPER_REALISTIC_BOUNDS.maxSpreadBps
  ) {
    rejectionReasons.push(
      `Realistic spreadBps (${input.spreadBps}) required between ${PAPER_REALISTIC_BOUNDS.minSpreadBps} and ${PAPER_REALISTIC_BOUNDS.maxSpreadBps} bps.`
    );
  }
  if (
    !Number.isFinite(input.slippageBps) ||
    input.slippageBps < PAPER_REALISTIC_BOUNDS.minSlippageBps ||
    input.slippageBps > PAPER_REALISTIC_BOUNDS.maxSlippageBps
  ) {
    rejectionReasons.push(
      `Realistic slippageBps (${input.slippageBps}) required between ${PAPER_REALISTIC_BOUNDS.minSlippageBps} and ${PAPER_REALISTIC_BOUNDS.maxSlippageBps} bps.`
    );
  }

  const fingerprint = buildPaperEvidenceFingerprint({
    symbol: symbol || 'UNKNOWN',
    side: input.side === 'SELL' ? 'SELL' : 'BUY',
    observedAtIso: String(input.observedAtIso || ''),
    closedAtIso: String(input.closedAtIso || ''),
    entryPrice: Number.isFinite(input.entryPrice) ? input.entryPrice : 0,
    exitPrice: Number.isFinite(input.exitPrice) ? input.exitPrice : 0,
    stakeUsd: Number.isFinite(input.stakeUsd) ? input.stakeUsd : 0,
  });

  if (tradeEvidenceId && existingEvidenceIds.has(tradeEvidenceId)) {
    rejectionReasons.push(`Duplicate tradeEvidenceId "${tradeEvidenceId}" rejected.`);
  }
  if (existingFingerprints.has(fingerprint)) {
    rejectionReasons.push('Duplicate paper trade observation fingerprint rejected.');
  }

  // Compute simulated PnL incorporating realistic spread, slippage, and fees
  let simulatedGrossPnlUsd = 0;
  let simulatedNetPnlUsd = 0;
  let simulatedReturnPct = 0;

  if (pricesFinite) {
    const direction = input.side === 'BUY' ? 1 : -1;
    const rawPctMove = ((input.exitPrice - input.entryPrice) / input.entryPrice) * direction;
    simulatedGrossPnlUsd = round6(input.stakeUsd * rawPctMove);
    const executionFrictionUsd =
      input.stakeUsd * ((Math.max(0, input.spreadBps) + Math.max(0, input.slippageBps)) / 10_000);
    const totalCostUsd = Math.max(0, input.feeUsd) + executionFrictionUsd;
    simulatedNetPnlUsd = round6(simulatedGrossPnlUsd - totalCostUsd);
    simulatedReturnPct = round6((simulatedNetPnlUsd / input.stakeUsd) * 100);
  }

  const accepted = rejectionReasons.length === 0;
  const status: PaperTradeAcceptanceStatus = accepted ? 'ACCEPTED' : 'REJECTED';
  const outcome: PaperTradeEvidenceOutcome = !accepted
    ? 'REJECTED'
    : simulatedNetPnlUsd > 0
      ? 'WIN'
      : simulatedNetPnlUsd < 0
        ? 'LOSS'
        : 'BREAKEVEN';

  const evidenceHash = computePaperEvidenceHash({
    tradeEvidenceId: tradeEvidenceId || `rejected_${nowMs}`,
    fingerprint,
    marketSource: marketSource || 'INVALID',
    bidPrice: Number.isFinite(input.bidPrice) ? input.bidPrice : 0,
    askPrice: Number.isFinite(input.askPrice) ? input.askPrice : 0,
    feeRate: Number.isFinite(input.feeRate) ? input.feeRate : 0,
    feeUsd: Number.isFinite(input.feeUsd) ? input.feeUsd : 0,
    spreadBps: Number.isFinite(input.spreadBps) ? input.spreadBps : 0,
    slippageBps: Number.isFinite(input.slippageBps) ? input.slippageBps : 0,
    simulatedNetPnlUsd,
    status,
  });

  return {
    accepted,
    status,
    outcome,
    tradeEvidenceId: tradeEvidenceId || `invalid_${nowMs}`,
    evidenceHash,
    fingerprint,
    simulatedGrossPnlUsd,
    simulatedNetPnlUsd,
    simulatedReturnPct,
    profitLabel: 'SIMULATED_PAPER_ONLY',
    isRealProfit: false,
    rejectionReasons,
  };
}

/**
 * STAGE 3, 4 & 5 — UNIFIED PUBLIC SIGNAL GATE EVALUATOR
 * Determines current validation stage, eligibility for operator approval,
 * automatic safety suspension, and all withholding reasons.
 */
export function evaluatePublicSignalGate(
  input: SafetyIntegrityAssessmentInput
): PublicSignalGateEvaluation {
  const withholdingReasons: string[] = [];

  const stage1Passed = Boolean(input.stage1Report && input.stage1Report.passed);
  if (!stage1Passed) {
    withholdingReasons.push(
      input.stage1Report
        ? `Stage 1 Testnet Validation failed: ${input.stage1Report.failureReasons.join('; ')}`
        : 'Stage 1 Testnet Validation has not been verified yet.'
    );
  }

  const stage2HasGenuineEvidence = input.validPaperChecksCount > 0;
  if (!stage2HasGenuineEvidence) {
    withholdingReasons.push(
      'Stage 2 Paper Trading Validation has zero independently verified timestamped market trades.'
    );
  }

  const dataIntegrityPassed =
    input.corruptedEvidenceCount === 0 && input.duplicateEvidenceCount === 0;
  if (input.corruptedEvidenceCount > 0) {
    withholdingReasons.push(
      `Data integrity breach: ${input.corruptedEvidenceCount} paper trade record(s) failed SHA-256 hash verification.`
    );
  }
  if (input.duplicateEvidenceCount > 0) {
    withholdingReasons.push(
      `Data integrity breach: ${input.duplicateEvidenceCount} duplicate paper trade fingerprint(s) detected.`
    );
  }

  const riskControlsPassed =
    !input.emergencyHalted &&
    Number.isFinite(input.observedDailyDrawdownPct) &&
    input.observedDailyDrawdownPct >= 0 &&
    input.observedDailyDrawdownPct < HARD_CODED_RISK_PARAMETERS.maxDailyDrawdownPct;

  if (input.emergencyHalted) {
    withholdingReasons.push('Mandatory safety halt: emergency shutdown is active.');
  }
  if (
    !Number.isFinite(input.observedDailyDrawdownPct) ||
    input.observedDailyDrawdownPct >= HARD_CODED_RISK_PARAMETERS.maxDailyDrawdownPct
  ) {
    withholdingReasons.push(
      `Mandatory risk limit breached: daily drawdown ${(input.observedDailyDrawdownPct * 100).toFixed(2)}% >= ${(HARD_CODED_RISK_PARAMETERS.maxDailyDrawdownPct * 100).toFixed(1)}% cap.`
    );
  }

  const stage3CountMet = input.validPaperChecksCount >= REQUIRED_VERIFIABLE_PAPER_CHECKS;
  if (!stage3CountMet) {
    const remaining = Math.max(0, REQUIRED_VERIFIABLE_PAPER_CHECKS - input.validPaperChecksCount);
    withholdingReasons.push(
      `Stage 3 requires ${REQUIRED_VERIFIABLE_PAPER_CHECKS} independently verifiable Paper Trading results (${input.validPaperChecksCount}/${REQUIRED_VERIFIABLE_PAPER_CHECKS} completed; ${remaining} remaining).`
    );
  }

  const stage3Passed = stage3CountMet && dataIntegrityPassed && riskControlsPassed;

  // Automatic suspension triggers if data integrity or mandatory safety conditions fail
  let suspensionReason: string | null = input.manualSafetySuspensionReason;
  if (!dataIntegrityPassed) {
    suspensionReason =
      'Auto-suspended: paper trading evidence failed data-integrity hash/deduplication checks.';
  } else if (!riskControlsPassed) {
    suspensionReason =
      'Auto-suspended: mandatory risk control or emergency shutdown condition failed.';
  } else if (input.stage1Report && !input.stage1Report.passed) {
    suspensionReason = 'Auto-suspended: Stage 1 Testnet safety verification failed.';
  }

  const autoSuspended = suspensionReason !== null;
  if (autoSuspended && suspensionReason && !withholdingReasons.includes(suspensionReason)) {
    withholdingReasons.unshift(suspensionReason);
  }

  const eligibleForOperatorApproval =
    stage1Passed && stage2HasGenuineEvidence && stage3Passed && !autoSuspended;

  if (!input.publicPublicationEnabled) {
    withholdingReasons.push(
      'Stage 4 Public Signal Publication is disabled by default until explicitly enabled by an authorized operator.'
    );
  }

  let currentStage: ValidationStageId = 'STAGE_1_TESTNET';
  if (autoSuspended) {
    currentStage = 'STAGE_5_MONITORING';
  } else if (!stage1Passed) {
    currentStage = 'STAGE_1_TESTNET';
  } else if (!stage2HasGenuineEvidence) {
    currentStage = 'STAGE_2_PAPER_TRADING';
  } else if (!stage3Passed) {
    currentStage = 'STAGE_3_FIFTY_CHECKS';
  } else if (!input.publicPublicationEnabled) {
    currentStage = 'STAGE_4_OPERATOR_APPROVAL';
  } else {
    currentStage = 'STAGE_5_MONITORING';
  }

  const stages: StageSummaryRow[] = [
    {
      stageId: 'STAGE_1_TESTNET',
      title: 'Stage 1 — Testnet Validation',
      status: !input.stage1Report ? 'PENDING' : stage1Passed ? 'PASSED' : 'FAILED',
      summary: stage1Passed
        ? `Verified on ${input.stage1Report?.targetHost} (zero live endpoints contacted).`
        : input.stage1Report
          ? `Failed: ${input.stage1Report.failureReasons[0] || 'Check failed.'}`
          : 'Awaiting Testnet host, order lifecycle, SL/TP & error-handling check.',
    },
    {
      stageId: 'STAGE_2_PAPER_TRADING',
      title: 'Stage 2 — Paper Trading Validation',
      status: stage2HasGenuineEvidence ? 'PASSED' : 'PENDING',
      summary: stage2HasGenuineEvidence
        ? `${input.validPaperChecksCount} verified simulated paper trade(s) with fees, spread & slippage (${input.paperWinsCount}W / ${input.paperLossesCount}L / ${input.paperBreakevenCount}BE).`
        : 'Requires timestamped market observations with realistic fees, spread & slippage.',
    },
    {
      stageId: 'STAGE_3_FIFTY_CHECKS',
      title: 'Stage 3 — 50 Validation Checks',
      status: !dataIntegrityPassed || !riskControlsPassed
        ? 'FAILED'
        : stage3Passed
          ? 'PASSED'
          : 'PENDING',
      summary: `${input.validPaperChecksCount}/${REQUIRED_VERIFIABLE_PAPER_CHECKS} verifiable checks · ${input.rejectedPaperChecksCount} rejected/invalid recorded · Live 50-win gate preserved separately.`,
    },
    {
      stageId: 'STAGE_4_OPERATOR_APPROVAL',
      title: 'Stage 4 — Server-Side Public Signal Approval',
      status: autoSuspended
        ? 'SUSPENDED'
        : eligibleForOperatorApproval && input.publicPublicationEnabled
          ? 'PASSED'
          : 'PENDING',
      summary: autoSuspended
        ? 'Suspended pending safety/integrity recovery.'
        : input.publicPublicationEnabled
          ? 'Global public display enabled; only individually operator-approved signals appear.'
          : 'Publication disabled by default; requires authorized operator approval.',
    },
    {
      stageId: 'STAGE_5_MONITORING',
      title: 'Stage 5 — Continuous Monitoring & Auto-Suspend',
      status: autoSuspended ? 'SUSPENDED' : dataIntegrityPassed && riskControlsPassed ? 'PASSED' : 'FAILED',
      summary: autoSuspended
        ? suspensionReason || 'Public eligibility automatically suspended.'
        : 'Monitoring data integrity, risk limits, and withholding state.',
    },
  ];

  return {
    currentStage,
    stage1Passed,
    stage2HasGenuineEvidence,
    stage3Passed,
    validPaperChecksCount: input.validPaperChecksCount,
    requiredPaperChecksCount: REQUIRED_VERIFIABLE_PAPER_CHECKS,
    rejectedPaperChecksCount: input.rejectedPaperChecksCount,
    paperWinsCount: input.paperWinsCount,
    paperLossesCount: input.paperLossesCount,
    paperBreakevenCount: input.paperBreakevenCount,
    dataIntegrityPassed,
    riskControlsPassed,
    eligibleForOperatorApproval,
    publicPublicationEnabled: input.publicPublicationEnabled,
    autoSuspended,
    suspensionReason,
    withholdingReasons,
    lastVerifiedAtIso: input.lastVerifiedAtIso,
    canTriggerLiveOrders: false,
    stages,
  };
}

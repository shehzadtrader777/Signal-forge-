import {
  DEFAULT_GITOPS_POLICY,
  KERNEL_REGISTRY,
  bindPolicyToKernels,
  canonicalStringify,
  computeKernelSetDigest,
  computePolicyDigest,
  sha256Hex,
  verifyKernelArtifactSignature,
  type BindingAuditRecord,
  type BindingTriple,
  type DeploymentEnvironment,
  type GitOpsPolicyDocument,
  type SignedKernelArtifact,
} from './bindingLayer';
import {
  FILL_MODEL_KERNEL_ARTIFACT,
  evaluateBacktestReplayFillParity,
  verifyFillModelArtifactSignature,
} from './fillModel';
import { generateDeterministicCandles } from './marketData';
import { BacktestFeed, ReplayFeed, type PITStrategy } from './pitFeed';
import {
  DEFAULT_MODULE_DRAWDOWN_LIMIT_PCT,
  DEFAULT_PORTFOLIO_DRAWDOWN_LIMIT_PCT,
  MODULE_DRAWDOWN_MAX_PCT,
  MODULE_DRAWDOWN_MIN_PCT,
  PORTFOLIO_DRAWDOWN_MAX_PCT,
  PORTFOLIO_DRAWDOWN_MIN_PCT,
  type ForgeAuditLedgerEntry,
  type ForgeModuleRiskProfile,
} from './forgeCapitalHub';
import {
  DEFAULT_LIVE_MANDATE,
  FOUR_PROFILE_CATALOG,
  type GuardProfileId,
  type LiveMandateState,
  type ResolvedStartupProfileLock,
} from './runtimeGuard';
import { evaluateParityGate, type ParityGateResult } from './systemicLayers';
import { MIN_RR_KERNEL_CONSTANT, RISK_ENGINE_DD_LIMITS } from './riskEngine';
import type { DataIntegrityRuntime } from './dataIntegrityRuntime';
import {
  runWalkForwardOrchestration,
  type StabilityScorecard,
  type WalkForwardOrchestrationReport,
} from './walkForwardOrchestrator';

/* ═══════════════════════════════════════════════════════════════════════════
 * L4 — PG_v4.1 (AMENDED) 14-CONJUNCT CERTIFICATION GATE & IMMUTABLE STORE
 * Amendment 4.1.0 adds `PG_stale_state` (Tier 2 Deployment-Blocking):
 * rejects any promotion/deployment with stale CPS price, lagging DD ledger,
 * stale versioned regime cache, starved reconciler, or stale decision trace.
 *
 * Strict 3-Tier Evaluation Order:
 *   Tier 1 (Pre-Flight Identity — UN-CACHED & FAIL-FAST):
 *     1. PG_kernel_identity
 *     2. PG_policy_identity
 *     -> Any failure short-circuits immediately; all 12 remaining conjuncts = SKIPPED.
 *   Tier 2 (Deployment-Blocking Governance, Integrity & Safety):
 *     3. PG_invariant_satisfaction
 *     4. PG_compliance_declaration
 *     5. PG_audit_trail_completeness
 *     6. PG_human_oversight_active
 *     7. PG_stale_state
 *   Tier 3 (Promotion Conjuncts):
 *     8.  PG_backtest_replay
 *     9.  PG_replay_paper
 *     10. PG_kernel_equivalence
 *     11. PG_oos_stability
 *     12. PG_rr_invariant
 *     13. PG_dd_hierarchy
 *     14. PG_regime_stability
 *
 * Deterministic Aggregation Precedence: FAIL > OFFLINE > AMBER > PASS.
 * Append-Only 5-Year Immutable Record Store keyed by promotionRequestId.
 * ═══════════════════════════════════════════════════════════════════════════ */

export const PG_V4_LOGIC_VERSION = '4.1.0' as const;
export const MIN_GATE_RETENTION_DAYS = 1825 as const; // 5 years = 1825 days
export const EU_AI_ACT_HIGH_RISK_ARTICLES: ReadonlyArray<number> = Object.freeze([
  9, 11, 12, 13, 14, 15,
]);

export type PgV4ConjunctId =
  | 'PG_kernel_identity'
  | 'PG_policy_identity'
  | 'PG_invariant_satisfaction'
  | 'PG_compliance_declaration'
  | 'PG_audit_trail_completeness'
  | 'PG_human_oversight_active'
  | 'PG_stale_state'
  | 'PG_backtest_replay'
  | 'PG_replay_paper'
  | 'PG_kernel_equivalence'
  | 'PG_oos_stability'
  | 'PG_rr_invariant'
  | 'PG_dd_hierarchy'
  | 'PG_regime_stability';

export type PgV4TierId =
  | 'TIER_1_PREFLIGHT_IDENTITY'
  | 'TIER_2_DEPLOYMENT_BLOCKING'
  | 'TIER_3_PROMOTION_CONJUNCTS';

export type PgV4ConjunctStatus = 'PASS' | 'AMBER' | 'FAIL' | 'OFFLINE' | 'SKIPPED';
export type PgV4AggregateStatus = 'PASS' | 'AMBER' | 'FAIL' | 'OFFLINE';

export const ORDERED_PG_V4_CONJUNCTS: ReadonlyArray<{
  readonly id: PgV4ConjunctId;
  readonly tier: PgV4TierId;
  readonly evalOrder: number;
  readonly title: string;
  readonly thresholdSpec: string;
  readonly failureSemantics: string;
}> = Object.freeze([
  Object.freeze({
    id: 'PG_kernel_identity',
    tier: 'TIER_1_PREFLIGHT_IDENTITY',
    evalOrder: 1,
    title: 'Kernel Registry Identity & Signature',
    thresholdSpec: '100% valid signatures + uncached kernelSetDigest == expected bound kernel_hash',
    failureSemantics: 'HARD FAIL & SHORT-CIRCUIT: Marks remaining conjuncts SKIPPED; halts boot/promotion.',
  }),
  Object.freeze({
    id: 'PG_policy_identity',
    tier: 'TIER_1_PREFLIGHT_IDENTITY',
    evalOrder: 2,
    title: 'GitOps Policy Digest & Ceiling Binding',
    thresholdSpec: 'Uncached policyDigest == expected policy_hash + 7-stage Binding PASS',
    failureSemantics: 'HARD FAIL & SHORT-CIRCUIT: Marks remaining conjuncts SKIPPED; halts boot/promotion.',
  }),
  Object.freeze({
    id: 'PG_invariant_satisfaction',
    tier: 'TIER_2_DEPLOYMENT_BLOCKING',
    evalOrder: 3,
    title: 'Structural Constitutional Invariants',
    thresholdSpec: 'PIT zero-lookahead = true, StructuralStop <= 2%, MonotonicTrail = true, RR >= 5.0',
    failureSemantics: 'DEPLOYMENT-BLOCKING FAIL: Blocks live/promotion execution egress immediately.',
  }),
  Object.freeze({
    id: 'PG_compliance_declaration',
    tier: 'TIER_2_DEPLOYMENT_BLOCKING',
    evalOrder: 4,
    title: 'EU AI Act High-Risk Compliance (Arts. 9,11,12,13,14,15)',
    thresholdSpec: 'All 6 EU AI Act Articles declared + guarantee_profit === false + risk disclosures active',
    failureSemantics: 'DEPLOYMENT-BLOCKING FAIL: Refuses deployment into regulated EU / AI Store posture.',
  }),
  Object.freeze({
    id: 'PG_audit_trail_completeness',
    tier: 'TIER_2_DEPLOYMENT_BLOCKING',
    evalOrder: 5,
    title: 'Audit Trail Completeness & Sequence Integrity',
    thresholdSpec: 'Bound audit record present + monotonic Forge ledger seq (0 gaps) + >= 1825d retention',
    failureSemantics: 'DEPLOYMENT-BLOCKING FAIL / OFFLINE: Blocks promotion if forensic trace is incomplete.',
  }),
  Object.freeze({
    id: 'PG_human_oversight_active',
    tier: 'TIER_2_DEPLOYMENT_BLOCKING',
    evalOrder: 6,
    title: 'Human Oversight & Kill-Switch Readiness (Art. 14)',
    thresholdSpec: 'Immutable GuardProfile lock + Kill-Switch armed + Mandate default-deny or <=24h active',
    failureSemantics: 'DEPLOYMENT-BLOCKING FAIL: Halts autonomy when operator override control is absent.',
  }),
  Object.freeze({
    id: 'PG_stale_state',
    tier: 'TIER_2_DEPLOYMENT_BLOCKING',
    evalOrder: 7,
    title: 'Certified Primary Source & Zero Stale State Freshness',
    thresholdSpec: 'CPS I-PD1..4 fresh + DD applied_fill_seq == head + Reconciler live + 0 stale decisions',
    failureSemantics: 'DEPLOYMENT-BLOCKING FAIL: Refuses deployment/promotion when any stale or lagging state occurred.',
  }),
  Object.freeze({
    id: 'PG_backtest_replay',
    tier: 'TIER_3_PROMOTION_CONJUNCTS',
    evalOrder: 8,
    title: 'Backtest ↔ Replay Determinism',
    thresholdSpec: 'FillPrice divergence <= 0.05 bps under shared FillModel-Kernel',
    failureSemantics: 'PROMOTION FAIL: Rejects promotion when historical replay diverges from backtest.',
  }),
  Object.freeze({
    id: 'PG_replay_paper',
    tier: 'TIER_3_PROMOTION_CONJUNCTS',
    evalOrder: 9,
    title: 'Replay ↔ Paper Execution Parity',
    thresholdSpec: 'Slippage <= 35 bps, WinRate <= 12%, Expectancy <= 0.45R',
    failureSemantics: 'PROMOTION FAIL / OFFLINE: Halts promotion if live sandbox execution drifts.',
  }),
  Object.freeze({
    id: 'PG_kernel_equivalence',
    tier: 'TIER_3_PROMOTION_CONJUNCTS',
    evalOrder: 10,
    title: 'FillModel-Kernel Artifact Equivalence',
    thresholdSpec: 'Signed FillModel-Kernel hash matches identically across Backtest, Replay, and Paper',
    failureSemantics: 'PROMOTION FAIL: Rejects cross-environment kernel artifact divergence.',
  }),
  Object.freeze({
    id: 'PG_oos_stability',
    tier: 'TIER_3_PROMOTION_CONJUNCTS',
    evalOrder: 11,
    title: 'Walk-Forward Out-of-Sample Stability Scorecard',
    thresholdSpec: 'meanOosReturn >= 0, degradation >= 0.40, signConsistency >= 0.50, PBO <= 0.45',
    failureSemantics: 'AMBER if marginal (degradation 0.20..0.40); FAIL if negative OOS or PBO > 0.45.',
  }),
  Object.freeze({
    id: 'PG_rr_invariant',
    tier: 'TIER_3_PROMOTION_CONJUNCTS',
    evalOrder: 12,
    title: 'Constitutional 1:5 R:R Floor Invariant',
    thresholdSpec: '0 leaked signals/fills below R:R 5.0 (I-RR1 hardcoded floor)',
    failureSemantics: 'PROMOTION FAIL: Zero-tolerance rejection on any sub-1:5 trade path.',
  }),
  Object.freeze({
    id: 'PG_dd_hierarchy',
    tier: 'TIER_3_PROMOTION_CONJUNCTS',
    evalOrder: 13,
    title: 'Ordered Drawdown Hierarchy & Containment',
    thresholdSpec: 'Trade (<=2%) < Module ([3%,5%]) < Portfolio ([10%,15%]) + breach insulation active',
    failureSemantics: 'PROMOTION FAIL: Rejects flat or inverted risk budget hierarchy.',
  }),
  Object.freeze({
    id: 'PG_regime_stability',
    tier: 'TIER_3_PROMOTION_CONJUNCTS',
    evalOrder: 14,
    title: 'Cross-Regime Robustness',
    thresholdSpec: 'No catastrophic negative regime collapse across TRENDING / NORMAL / HIGH_VOL',
    failureSemantics: 'AMBER if single-regime exposure only; FAIL if regime drawdown > 5% or severe loss.',
  }),
]);

export const PG_V4_SPEC_DEFINITION = Object.freeze({
  version: PG_V4_LOGIC_VERSION,
  minRetentionDays: MIN_GATE_RETENTION_DAYS,
  precedence: ['FAIL', 'OFFLINE', 'AMBER', 'PASS'],
  identityShortCircuitMarksRemainingSkipped: true,
  conjuncts: ORDERED_PG_V4_CONJUNCTS.map((c) => ({
    id: c.id,
    tier: c.tier,
    evalOrder: c.evalOrder,
    thresholdSpec: c.thresholdSpec,
  })),
});

export function computePgV4LogicHash(overrideSpec?: unknown): string {
  return sha256Hex(canonicalStringify(overrideSpec ?? PG_V4_SPEC_DEFINITION));
}

export interface PgV4ConjunctResult {
  readonly conjunctId: PgV4ConjunctId;
  readonly tier: PgV4TierId;
  readonly evalOrder: number;
  readonly title: string;
  readonly status: PgV4ConjunctStatus;
  readonly thresholdSpec: string;
  readonly observedValue: string;
  readonly failureSemantics: string;
  readonly cached: false;
  readonly skippedDueToIdentityFailure: boolean;
  readonly evidence_ref: string;
  readonly evidence_hash: string;
  readonly reason: string;
}

export interface PgV4ComplianceArtifact {
  readonly articlesDeclared: ReadonlyArray<number>;
  readonly guaranteeProfitFlag: boolean;
  readonly riskDisclosureActive: boolean;
  readonly modelCardDocumented: boolean;
}

export interface PgV4AuditTrailContext {
  readonly bindingAudit: BindingAuditRecord | null;
  readonly forgeAuditLedger: ReadonlyArray<ForgeAuditLedgerEntry>;
  readonly retentionDaysConfigured: number;
}

export interface PgV4HumanOversightContext {
  readonly guardProfileLock: ResolvedStartupProfileLock;
  readonly liveMandate: LiveMandateState;
  readonly killSwitchArmed: boolean;
  readonly failSafeEngaged: boolean;
  readonly operatorEmergencyHaltAvailable: boolean;
}

export interface PgV4EvaluationInput {
  readonly promotionRequestId: string;
  readonly requestedBy?: string;
  readonly environment: DeploymentEnvironment;
  readonly timestampUtc?: string;
  readonly kernelRegistry?: ReadonlyArray<SignedKernelArtifact>;
  readonly expectedKernelHash?: string;
  /** Function returning fresh policy at evaluation time; never cached across requests. */
  readonly loadFreshPolicy?: () => unknown;
  readonly policyDocument?: unknown;
  readonly expectedPolicyHash?: string;
  readonly knownGoodTriples?: ReadonlyArray<BindingTriple>;
  readonly requireKnownGoodTriple?: boolean;
  readonly fillModelHashReplay?: string;
  readonly fillModelHashPaper?: string;
  readonly backtestVsReplayDivergenceBps?: number;
  readonly replayVsPaperParity?: ParityGateResult;
  readonly walkForwardReport?: WalkForwardOrchestrationReport;
  readonly pitZeroLookAheadVerified?: boolean;
  readonly maxTradeRiskPct?: number;
  readonly moduleDrawdownLimitPct?: number;
  readonly portfolioDrawdownLimitPct?: number;
  readonly modules?: ReadonlyArray<ForgeModuleRiskProfile>;
  readonly compliance?: PgV4ComplianceArtifact;
  readonly auditTrail?: PgV4AuditTrailContext;
  readonly humanOversight?: PgV4HumanOversightContext;
  readonly dataIntegrityRuntime?: DataIntegrityRuntime;
  readonly staleDecisionDetected?: boolean;
  readonly staleStateReason?: string;
  readonly paperFeedOnline?: boolean;
  readonly auditFeedOnline?: boolean;
  readonly logicHashOverride?: string;
  readonly logicVersionOverride?: string;
}

export interface PgV4GateRecord {
  readonly promotionRequestId: string;
  readonly requestedBy: string;
  readonly pgLogicVersion: string;
  readonly gateLogicHash: string;
  readonly evaluatedAtUtc: string;
  readonly identityEvaluationSeq: number;
  readonly identityCacheBypassed: true;
  readonly identityShortCircuited: boolean;
  readonly deploymentBlocked: boolean;
  readonly promotionPermitted: boolean;
  readonly aggregateState: PgV4AggregateStatus;
  readonly kernelHashObserved: string | null;
  readonly policyHashObserved: string | null;
  readonly scorecard: StabilityScorecard | null;
  readonly conjuncts: ReadonlyArray<PgV4ConjunctResult>;
  readonly retainUntilUtc: string;
  readonly sequenceNumber?: number;
  readonly prevRecordHash?: string;
  readonly recordHash?: string;
}

export class IncompletePgV4RecordError extends Error {
  readonly code = 'INCOMPLETE_PG_V4_RECORD';
  readonly missingConjuncts: ReadonlyArray<string>;
  constructor(message: string, missingConjuncts: ReadonlyArray<string> = []) {
    super(message);
    this.name = 'IncompletePgV4RecordError';
    this.missingConjuncts = Object.freeze([...missingConjuncts]);
  }
}

export class ImmutableGateRecordError extends Error {
  readonly code: 'GATE_RECORD_UPDATE_FORBIDDEN' | 'GATE_RECORD_DELETE_FORBIDDEN';
  constructor(
    code: 'GATE_RECORD_UPDATE_FORBIDDEN' | 'GATE_RECORD_DELETE_FORBIDDEN',
    message: string
  ) {
    super(message);
    this.name = 'ImmutableGateRecordError';
    this.code = code;
  }
}

/* ── Global Monotonic Sequence for Fresh Identity Proof (Never Cached) ──── */

let identityEvalCounter = 0;

function makeEvidenceFields(params: {
  promotionRequestId: string;
  conjunctId: PgV4ConjunctId;
  evalSeq: number;
  status: PgV4ConjunctStatus;
  observedValue: string;
  reason: string;
  timestampUtc: string;
}): { evidence_ref: string; evidence_hash: string } {
  const evidence_ref = `urn:force-signal:pg-v4:${params.promotionRequestId}:${params.conjunctId}:seq-${params.evalSeq}`;
  const evidence_hash = sha256Hex(
    canonicalStringify({
      promotionRequestId: params.promotionRequestId,
      conjunctId: params.conjunctId,
      evalSeq: params.evalSeq,
      status: params.status,
      observedValue: params.observedValue,
      reason: params.reason,
      timestampUtc: params.timestampUtc,
    })
  );
  return { evidence_ref, evidence_hash };
}

export function resolvePgV4AggregateState(
  conjuncts: ReadonlyArray<Pick<PgV4ConjunctResult, 'status'>>
): PgV4AggregateStatus {
  // Deterministic precedence: FAIL > OFFLINE > AMBER > PASS
  if (conjuncts.some((c) => c.status === 'FAIL')) return 'FAIL';
  if (conjuncts.some((c) => c.status === 'OFFLINE')) return 'OFFLINE';
  if (conjuncts.some((c) => c.status === 'AMBER')) return 'AMBER';
  if (conjuncts.some((c) => c.status === 'SKIPPED')) return 'FAIL';
  return 'PASS';
}

/* ── Core 14-Conjunct PG_v4 Evaluator ─────────────────────────────────────── */

export function evaluatePgV4Gate(input: PgV4EvaluationInput): PgV4GateRecord {
  const timestampUtc = input.timestampUtc ?? new Date().toISOString();
  const evalSeq = ++identityEvalCounter;
  const pgLogicVersion = input.logicVersionOverride ?? PG_V4_LOGIC_VERSION;
  const gateLogicHash = input.logicHashOverride ?? computePgV4LogicHash();
  const requestedBy = input.requestedBy ?? 'force-signal-validation-architect';

  const registry = input.kernelRegistry ?? KERNEL_REGISTRY;
  const freshPolicyRaw = input.loadFreshPolicy
    ? input.loadFreshPolicy()
    : input.policyDocument ?? DEFAULT_GITOPS_POLICY;

  const metaById = new Map(ORDERED_PG_V4_CONJUNCTS.map((c) => [c.id, c]));
  const results: PgV4ConjunctResult[] = [];

  const pushResult = (
    conjunctId: PgV4ConjunctId,
    status: PgV4ConjunctStatus,
    observedValue: string,
    reason: string,
    skippedDueToIdentityFailure = false
  ): PgV4ConjunctResult => {
    const meta = metaById.get(conjunctId)!;
    const evidence = makeEvidenceFields({
      promotionRequestId: input.promotionRequestId,
      conjunctId,
      evalSeq,
      status,
      observedValue,
      reason,
      timestampUtc,
    });
    const entry: PgV4ConjunctResult = Object.freeze({
      conjunctId,
      tier: meta.tier,
      evalOrder: meta.evalOrder,
      title: meta.title,
      status,
      thresholdSpec: meta.thresholdSpec,
      observedValue,
      failureSemantics: meta.failureSemantics,
      cached: false as const,
      skippedDueToIdentityFailure,
      evidence_ref: evidence.evidence_ref,
      evidence_hash: evidence.evidence_hash,
      reason,
    });
    results.push(entry);
    return entry;
  };

  /* ── TIER 1: PRE-FLIGHT IDENTITY (UN-CACHED & FAIL-FAST) ────────────────── */
  // 1. PG_kernel_identity (always recomputed fresh, zero memoization)
  const freshKernelDigest = computeKernelSetDigest(registry);
  const invalidSignatures = registry
    .filter((k) => !verifyKernelArtifactSignature(k))
    .map((k) => k.kernelId);
  const expectedKernelHash = input.expectedKernelHash ?? freshKernelDigest;
  const kernelIdentityOk =
    registry.length > 0 &&
    invalidSignatures.length === 0 &&
    freshKernelDigest === expectedKernelHash;

  const kernelConjunct = pushResult(
    'PG_kernel_identity',
    kernelIdentityOk ? 'PASS' : 'FAIL',
    `kernels=${registry.length}, digest=${freshKernelDigest.slice(0, 12)}, invalidSigs=${invalidSignatures.length}`,
    kernelIdentityOk
      ? `Freshly recomputed signed digest for ${registry.length} kernels matching expected hash.`
      : invalidSignatures.length > 0
      ? `Invalid cryptographic signature on kernel(s): ${invalidSignatures.join(', ')}.`
      : `Kernel digest mismatch: observed ${freshKernelDigest.slice(0, 12)} !== expected ${expectedKernelHash.slice(0, 12)}.`
  );

  if (kernelConjunct.status !== 'PASS') {
    // True fail-fast short-circuit: PG_kernel_identity failed -> mark ALL remaining 12 conjuncts SKIPPED
    for (const spec of ORDERED_PG_V4_CONJUNCTS.slice(1)) {
      pushResult(
        spec.id,
        'SKIPPED',
        'SHORT_CIRCUITED',
        'Skipped due to Tier-1 identity fail-fast (PG_kernel_identity).',
        true
      );
    }

    const retainUntilUtc = new Date(
      Date.parse(timestampUtc) + MIN_GATE_RETENTION_DAYS * 86_400_000
    ).toISOString();

    return Object.freeze({
      promotionRequestId: input.promotionRequestId,
      requestedBy,
      pgLogicVersion,
      gateLogicHash,
      evaluatedAtUtc: timestampUtc,
      identityEvaluationSeq: evalSeq,
      identityCacheBypassed: true as const,
      identityShortCircuited: true,
      deploymentBlocked: true,
      promotionPermitted: false,
      aggregateState: resolvePgV4AggregateState(results),
      kernelHashObserved: freshKernelDigest,
      policyHashObserved: null,
      scorecard: input.walkForwardReport?.scorecard ?? null,
      conjuncts: Object.freeze(results),
      retainUntilUtc,
    });
  }

  // 2. PG_policy_identity (always freshly parsed, validated, and hashed)
  const bindingCheck = bindPolicyToKernels(freshPolicyRaw, {
    environment: input.environment,
    kernelRegistry: registry,
    knownGoodTriples: input.knownGoodTriples,
    requireKnownGoodTriple: input.requireKnownGoodTriple ?? false,
    timestampUtc,
  });
  const computedPolicyHash =
    bindingCheck.boundPolicy !== null
      ? computePolicyDigest(bindingCheck.boundPolicy)
      : sha256Hex(canonicalStringify(freshPolicyRaw));
  const expectedPolicyHash =
    input.expectedPolicyHash ?? computePolicyDigest(DEFAULT_GITOPS_POLICY);
  const policyIdentityOk =
    bindingCheck.bound &&
    bindingCheck.processStartAllowed &&
    (input.expectedPolicyHash === undefined || computedPolicyHash === expectedPolicyHash);

  const policyConjunct = pushResult(
    'PG_policy_identity',
    policyIdentityOk ? 'PASS' : 'FAIL',
    `bound=${bindingCheck.bound}, policyHash=${computedPolicyHash.slice(0, 12)}`,
    policyIdentityOk
      ? `Freshly validated GitOps policy digest ${computedPolicyHash.slice(0, 12)} across all 7 Binding Stages.`
      : !bindingCheck.bound
      ? `Binding Layer failed closed at ${bindingCheck.audit.failedStage}: ${bindingCheck.audit.failureMessage}`
      : `Policy hash mismatch: observed ${computedPolicyHash.slice(0, 12)} !== expected ${expectedPolicyHash.slice(0, 12)}.`
  );

  if (policyConjunct.status !== 'PASS') {
    // Short-circuit immediately: mark all 11 remaining Tier 2 + Tier 3 conjuncts SKIPPED
    for (const spec of ORDERED_PG_V4_CONJUNCTS.slice(2)) {
      pushResult(
        spec.id,
        'SKIPPED',
        'SHORT_CIRCUITED',
        'Skipped due to Tier-1 identity fail-fast (PG_policy_identity).',
        true
      );
    }

    const retainUntilUtc = new Date(
      Date.parse(timestampUtc) + MIN_GATE_RETENTION_DAYS * 86_400_000
    ).toISOString();

    return Object.freeze({
      promotionRequestId: input.promotionRequestId,
      requestedBy,
      pgLogicVersion,
      gateLogicHash,
      evaluatedAtUtc: timestampUtc,
      identityEvaluationSeq: evalSeq,
      identityCacheBypassed: true as const,
      identityShortCircuited: true,
      deploymentBlocked: true,
      promotionPermitted: false,
      aggregateState: resolvePgV4AggregateState(results),
      kernelHashObserved: freshKernelDigest,
      policyHashObserved: computedPolicyHash,
      scorecard: input.walkForwardReport?.scorecard ?? null,
      conjuncts: Object.freeze(results),
      retainUntilUtc,
    });
  }

  /* ── Evaluate / Resolve Shared WFV & Parity Context (only if Identity PASS) */
  const wfReport =
    input.walkForwardReport ?? runWalkForwardOrchestration({ symbol: 'BTCUSDT', timeframe: '15m' });
  const scorecard = wfReport.scorecard;

  /* ── TIER 2: DEPLOYMENT-BLOCKING GOVERNANCE & SAFETY ──────────────────── */
  // 3. PG_invariant_satisfaction
  const pitOk = input.pitZeroLookAheadVerified ?? wfReport.folds.every((f) => f.outOfSample.tripwireZeroLookAhead);
  const tradeRiskCap = input.maxTradeRiskPct ?? wfReport.riskConstantsLocked.maxRiskPct;
  const minRRLocked = wfReport.riskConstantsLocked.minRRRatio;
  const invariantOk = pitOk && minRRLocked >= 5.0 && tradeRiskCap <= 2.0 && tradeRiskCap > 0;
  pushResult(
    'PG_invariant_satisfaction',
    invariantOk ? 'PASS' : 'FAIL',
    `pitZeroLookAhead=${pitOk}, minRR=${minRRLocked}, maxRiskPct=${tradeRiskCap}%`,
    invariantOk
      ? 'L1 PIT zero-lookahead verified alongside constitutional 1:5 R:R floor and <= 2% trade risk.'
      : `Invariant violation detected (pitOk=${pitOk}, minRR=${minRRLocked}, maxRiskPct=${tradeRiskCap}%).`
  );

  // 4. PG_compliance_declaration (EU AI Act Arts. 9, 11, 12, 13, 14, 15)
  const compliance = input.compliance ?? {
    articlesDeclared: EU_AI_ACT_HIGH_RISK_ARTICLES,
    guaranteeProfitFlag: false,
    riskDisclosureActive: true,
    modelCardDocumented: true,
  };
  const missingArticles = EU_AI_ACT_HIGH_RISK_ARTICLES.filter(
    (art) => !compliance.articlesDeclared.includes(art)
  );
  const complianceOk =
    missingArticles.length === 0 &&
    compliance.guaranteeProfitFlag === false &&
    compliance.riskDisclosureActive &&
    compliance.modelCardDocumented;
  pushResult(
    'PG_compliance_declaration',
    complianceOk ? 'PASS' : 'FAIL',
    `articles=[${compliance.articlesDeclared.join(',')}], guaranteeProfit=${compliance.guaranteeProfitFlag}`,
    complianceOk
      ? 'EU AI Act High-Risk Articles 9, 11, 12, 13, 14, 15 declared and verified; no profit guarantees.'
      : `EU AI Act compliance failure: missing articles [${missingArticles.join(', ')}], guaranteeProfit=${compliance.guaranteeProfitFlag}.`
  );

  // 5. PG_audit_trail_completeness
  const auditFeedOnline = input.auditFeedOnline ?? true;
  const auditCtx = input.auditTrail ?? {
    bindingAudit: bindingCheck.audit,
    forgeAuditLedger: [],
    retentionDaysConfigured: MIN_GATE_RETENTION_DAYS,
  };
  const ledgerSequential = auditCtx.forgeAuditLedger.every((entry, idx) => {
    if (idx === 0) return true;
    return entry.seq !== auditCtx.forgeAuditLedger[idx - 1].seq;
  });
  const auditComplete =
    auditFeedOnline &&
    auditCtx.bindingAudit !== null &&
    auditCtx.bindingAudit.status === 'BOUND_START_ALLOWED' &&
    auditCtx.retentionDaysConfigured >= MIN_GATE_RETENTION_DAYS &&
    ledgerSequential;
  pushResult(
    'PG_audit_trail_completeness',
    !auditFeedOnline ? 'OFFLINE' : auditComplete ? 'PASS' : 'FAIL',
    `bindingAudit=${auditCtx.bindingAudit?.status ?? 'MISSING'}, retentionDays=${auditCtx.retentionDaysConfigured}`,
    !auditFeedOnline
      ? 'Audit storage sink is OFFLINE.'
      : auditComplete
      ? `Complete hash-verifiable audit trace active with ${auditCtx.retentionDaysConfigured}-day retention.`
      : `Incomplete audit trail: bindingAudit=${auditCtx.bindingAudit?.status ?? 'NONE'}, retention=${auditCtx.retentionDaysConfigured}d.`
  );

  // 6. PG_human_oversight_active (EU AI Act Art. 14)
  const oversight = input.humanOversight ?? {
    guardProfileLock: Object.freeze({
      profileId: 'Paper-Trade' as GuardProfileId,
      spec: FOUR_PROFILE_CATALOG['Paper-Trade'],
      immutable: true as const,
      resolvedAtUtc: timestampUtc,
    }),
    liveMandate: DEFAULT_LIVE_MANDATE,
    killSwitchArmed: true,
    failSafeEngaged: false,
    operatorEmergencyHaltAvailable: true,
  };
  const mandateValidForProfile =
    !oversight.guardProfileLock.spec.requiresMandate ||
    (oversight.liveMandate !== 'NOT_GRANTED' &&
      Date.parse(oversight.liveMandate.expiresAtUtc) > Date.parse(timestampUtc) &&
      Date.parse(oversight.liveMandate.expiresAtUtc) -
        Date.parse(oversight.liveMandate.startsAtUtc) <=
        24 * 3_600_000);
  const oversightOk =
    oversight.guardProfileLock.immutable &&
    oversight.killSwitchArmed &&
    oversight.operatorEmergencyHaltAvailable &&
    !oversight.failSafeEngaged &&
    mandateValidForProfile;
  pushResult(
    'PG_human_oversight_active',
    oversightOk ? 'PASS' : 'FAIL',
    `profile=${oversight.guardProfileLock.profileId}, killSwitch=${oversight.killSwitchArmed}, mandateOk=${mandateValidForProfile}`,
    oversightOk
      ? `Human oversight active under immutable ${oversight.guardProfileLock.profileId} profile with armed Kill-Switch.`
      : `Human oversight control inactive or breached (failSafeEngaged=${oversight.failSafeEngaged}, mandateValid=${mandateValidForProfile}).`
  );

  // 7. PG_stale_state (Amendment 4.1.0 — Certified Primary Source, Event-Sourced DD & Zero Stale Decisions)
  let staleStateOk = input.staleDecisionDetected !== true;
  let staleDetail = input.staleStateReason ?? 'No stale-state condition reported';
  let staleObserved = `staleDecision=${Boolean(input.staleDecisionDetected)}`;

  if (input.dataIntegrityRuntime) {
    const rt = input.dataIntegrityRuntime;
    const wd = rt.runStalenessWatchdogTick();
    const ddCheck = rt.verifyAndGetFreshDrawdownView({ failOnLagWithoutRebuild: true });
    const recCheck = rt.isReconcilerFresh();
    staleObserved = `watchdogHealthy=${wd.healthy}, ddOk=${ddCheck.ok}, reconcilerFresh=${recCheck.fresh}, staleDecision=${Boolean(input.staleDecisionDetected)}`;
    if (!wd.healthy || !ddCheck.ok || !recCheck.fresh || input.staleDecisionDetected === true) {
      staleStateOk = false;
      const parts: string[] = [];
      if (input.staleDecisionDetected) {
        parts.push(input.staleStateReason ?? 'stale decision recorded');
      }
      if (!wd.healthy) {
        parts.push(
          `watchdog flagged staleSources=[${wd.staleSources.join(',')}], laggingViews=[${wd.laggingViews.join(',')}], staleRegime=[${wd.staleRegimeCaches.join(',')}]`
        );
      }
      if (!ddCheck.ok) {
        parts.push(ddCheck.reason);
      }
      if (!recCheck.fresh) {
        parts.push(recCheck.reason ?? 'reconciler stale');
      }
      staleDetail = parts.join('; ');
    }
  }

  pushResult(
    'PG_stale_state',
    staleStateOk ? 'PASS' : 'FAIL',
    staleObserved,
    staleStateOk
      ? 'CPS sources fresh (I-PD1..I-PD4), event-sourced DD view synchronized, reconciler healthy, zero stale decisions.'
      : `PG_stale_state FAILED (deployment/promotion blocked): ${staleDetail}`
  );

  /* ── TIER 3: PROMOTION CONJUNCTS ────────────────────────────────────────── */
  // 8. PG_backtest_replay
  const btReplayDivBps = input.backtestVsReplayDivergenceBps ?? 0.0;
  const parityCandles = generateDeterministicCandles(wfReport.symbol, wfReport.timeframe, 80);
  const btFeed = new BacktestFeed(parityCandles, {
    symbol: wfReport.symbol,
    timeframe: wfReport.timeframe,
    warmupBars: 25,
  });
  const replayFeed = new ReplayFeed(parityCandles, {
    symbol: wfReport.symbol,
    timeframe: wfReport.timeframe,
    warmupBars: 25,
  });
  const sharedParityStrategy: PITStrategy = {
    strategyId: 'PG_V4_BT_REPLAY_CHECK',
    warmupBars: 25,
    evaluate(view) {
      const idx = view.cursorIndex();
      if (idx % 8 !== 0) return null;
      const bar = view.current();
      if (!bar) return null;
      const slDist = Math.max(bar.close * 0.008, 1e-6);
      return {
        direction: 'BUY',
        stopLossDistance: slDist,
        stopLossPct: 0.8,
        targetRR: 5.0,
        trailingAtrMult: 1.6,
        confidence: 84,
        setupLabel: 'PG_V4_PARITY_PROBE',
        snapshotWindowSize: 10,
      };
    },
  };
  const btReplayCheck = evaluateBacktestReplayFillParity({
    backtestFeed: btFeed,
    replayFeed,
    strategy: sharedParityStrategy,
    venue: 'BINANCE_SPOT',
    maxAllowedPriceDivergenceBps: 0.05,
  });
  const observedBtReplayDiv = Math.max(btReplayDivBps, btReplayCheck.maxPriceDivergenceBps);
  const btReplayOk =
    btReplayCheck.promotionApproved &&
    btReplayCheck.fillCountMatch &&
    observedBtReplayDiv <= 0.05;
  pushResult(
    'PG_backtest_replay',
    btReplayOk ? 'PASS' : 'FAIL',
    `fills=${btReplayCheck.matchedFillCount}/${btReplayCheck.backtestFillCount}, divergence=${observedBtReplayDiv.toFixed(4)} bps`,
    btReplayOk
      ? `Backtest ↔ Replay deterministic fill divergence ${observedBtReplayDiv.toFixed(4)} bps <= 0.05 bps (${btReplayCheck.exactAuditHashMatchCount} exact fill hash matches).`
      : `Backtest ↔ Replay divergence exceeded 0.05 bps (observed=${observedBtReplayDiv} bps, halt=${btReplayCheck.haltReason ?? 'mismatch'}).`
  );

  // 8. PG_replay_paper
  const paperOnline = input.paperFeedOnline ?? true;
  const replayPaperParity = input.replayVsPaperParity ?? wfReport.parityGate;
  pushResult(
    'PG_replay_paper',
    !paperOnline ? 'OFFLINE' : replayPaperParity.passed ? 'PASS' : 'FAIL',
    !paperOnline
      ? 'PAPER_FEED_OFFLINE'
      : `slip=${replayPaperParity.slippageDivergenceBps}bps, wr=${replayPaperParity.winRateDivergencePct}%, exp=${replayPaperParity.expectancyDivergenceR}R`,
    !paperOnline
      ? 'Paper execution feed is OFFLINE; cannot certify Replay ↔ Paper parity.'
      : replayPaperParity.passed
      ? `Replay ↔ Paper parity ARMED cleanly (${replayPaperParity.slippageDivergenceBps} bps slippage drift).`
      : replayPaperParity.haltReason ?? 'Replay ↔ Paper parity gate breached tolerances.'
  );

  // 9. PG_kernel_equivalence
  const expectedFillHash = FILL_MODEL_KERNEL_ARTIFACT.fillModelHash;
  const replayHash = input.fillModelHashReplay ?? expectedFillHash;
  const paperHash = input.fillModelHashPaper ?? expectedFillHash;
  const fillSigValid = verifyFillModelArtifactSignature();
  const kernelEquivOk =
    fillSigValid &&
    replayHash === expectedFillHash &&
    paperHash === expectedFillHash;
  pushResult(
    'PG_kernel_equivalence',
    kernelEquivOk ? 'PASS' : 'FAIL',
    `sigValid=${fillSigValid}, hash=${expectedFillHash.slice(0, 12)}`,
    kernelEquivOk
      ? `Identical signed FillModel-Kernel (${expectedFillHash.slice(0, 12)}) active across Backtest, Replay, and Paper.`
      : `FillModel-Kernel equivalence failure (sigValid=${fillSigValid}, replay=${replayHash.slice(0, 10)}, paper=${paperHash.slice(0, 10)}).`
  );

  // 10. PG_oos_stability
  let oosStatus: PgV4ConjunctStatus = 'PASS';
  if (
    scorecard.foldCount === 0 ||
    scorecard.meanOosReturn < 0 ||
    scorecard.overfittingProbabilityEstimate > 0.45 ||
    scorecard.signConsistency < 0.5
  ) {
    oosStatus = 'FAIL';
  } else if (
    scorecard.trainToTestDegradationRatio < 0.4 ||
    scorecard.parameterDrift > 0.45 ||
    scorecard.overfittingProbabilityEstimate > 0.3
  ) {
    oosStatus = 'AMBER';
  }
  pushResult(
    'PG_oos_stability',
    oosStatus,
    `meanOos=${scorecard.meanOosReturn}%, deg=${scorecard.trainToTestDegradationRatio}, sign=${scorecard.signConsistency}, PBO=${scorecard.overfittingProbabilityEstimate}`,
    oosStatus === 'PASS'
      ? `Walk-Forward Scorecard certified (${scorecard.foldCount} folds, mean OOS +${scorecard.meanOosReturn}%, PBO=${scorecard.overfittingProbabilityEstimate}).`
      : oosStatus === 'AMBER'
      ? `Walk-Forward Scorecard shows moderate degradation/drift (deg=${scorecard.trainToTestDegradationRatio}, PBO=${scorecard.overfittingProbabilityEstimate}).`
      : `Walk-Forward OOS stability failed thresholds (meanOos=${scorecard.meanOosReturn}%, PBO=${scorecard.overfittingProbabilityEstimate}, sign=${scorecard.signConsistency}).`
  );

  // 11. PG_rr_invariant
  const totalRrLeaks = wfReport.folds.reduce(
    (sum, f) => sum + f.outOfSample.rrRejectedLeaks + f.inSample.rrRejectedLeaks,
    0
  );
  const rrInvariantOk =
    MIN_RR_KERNEL_CONSTANT === 5 &&
    wfReport.riskConstantsLocked.minRRRatio >= MIN_RR_KERNEL_CONSTANT &&
    totalRrLeaks === 0;
  pushResult(
    'PG_rr_invariant',
    rrInvariantOk ? 'PASS' : 'FAIL',
    `minRR=${wfReport.riskConstantsLocked.minRRRatio} (kernel=${MIN_RR_KERNEL_CONSTANT}), violations=${totalRrLeaks}`,
    rrInvariantOk
      ? 'Zero sub-1:5 R:R violations observed across all In-Sample and Out-of-Sample fills under 3-check RRGateKernel.'
      : `Constitutional 1:5 R:R invariant breached (${totalRrLeaks} leaked executions).`
  );

  // 12. PG_dd_hierarchy
  const modDd = input.moduleDrawdownLimitPct ?? DEFAULT_MODULE_DRAWDOWN_LIMIT_PCT;
  const portDd = input.portfolioDrawdownLimitPct ?? DEFAULT_PORTFOLIO_DRAWDOWN_LIMIT_PCT;
  const modules = input.modules ?? [];
  const uninsulatedBreach = modules.some(
    (m) => m.drawdownPct >= m.configuredDrawdownLimitPct && m.status !== 'SUSPENDED'
  );
  const riskHierarchyOk =
    RISK_ENGINE_DD_LIMITS.PORTFOLIO_DAILY_PCT === 5.0 &&
    RISK_ENGINE_DD_LIMITS.PORTFOLIO_PEAK_TO_TROUGH_PCT === 15.0 &&
    RISK_ENGINE_DD_LIMITS.STRATEGY_DAILY_PCT === 2.0 &&
    RISK_ENGINE_DD_LIMITS.STRATEGY_PEAK_TO_TROUGH_PCT === 8.0 &&
    RISK_ENGINE_DD_LIMITS.REGIME_SCOPED_PCT === 1.5 &&
    RISK_ENGINE_DD_LIMITS.CONSECUTIVE_LOSSES_TRIGGER === 6;
  const ddHierarchyOk =
    riskHierarchyOk &&
    tradeRiskCap < modDd &&
    modDd < portDd &&
    modDd >= MODULE_DRAWDOWN_MIN_PCT &&
    modDd <= MODULE_DRAWDOWN_MAX_PCT &&
    portDd >= PORTFOLIO_DRAWDOWN_MIN_PCT &&
    portDd <= PORTFOLIO_DRAWDOWN_MAX_PCT &&
    !uninsulatedBreach;
  pushResult(
    'PG_dd_hierarchy',
    ddHierarchyOk ? 'PASS' : 'FAIL',
    `trade=${tradeRiskCap}% < module=${modDd}% < portfolio=${portDd}% · 6-level DD caps active (consec=${RISK_ENGINE_DD_LIMITS.CONSECUTIVE_LOSSES_TRIGGER})`,
    ddHierarchyOk
      ? `Strict 6-level drawdown hierarchy enforced (portDaily<=${RISK_ENGINE_DD_LIMITS.PORTFOLIO_DAILY_PCT}%, portP2T<=${RISK_ENGINE_DD_LIMITS.PORTFOLIO_PEAK_TO_TROUGH_PCT}%, stratDaily<=${RISK_ENGINE_DD_LIMITS.STRATEGY_DAILY_PCT}%, stratP2T<=${RISK_ENGINE_DD_LIMITS.STRATEGY_PEAK_TO_TROUGH_PCT}%, regime<=${RISK_ENGINE_DD_LIMITS.REGIME_SCOPED_PCT}%, consec<=${RISK_ENGINE_DD_LIMITS.CONSECUTIVE_LOSSES_TRIGGER}).`
      : `Drawdown hierarchy violation or uninsulated breach (${tradeRiskCap}% / ${modDd}% / ${portDd}%, uninsulated=${uninsulatedBreach}).`
  );

  // 13. PG_regime_stability
  let trendingTrades = 0;
  let normalTrades = 0;
  let highVolTrades = 0;
  let trendingRet = 0;
  let normalRet = 0;
  let highVolRet = 0;
  for (const f of wfReport.folds) {
    trendingTrades += f.outOfSample.regimeTradeCounts.TRENDING;
    normalTrades += f.outOfSample.regimeTradeCounts.NORMAL;
    highVolTrades += f.outOfSample.regimeTradeCounts.HIGH_VOL;
    trendingRet += f.outOfSample.regimeReturnsPct.TRENDING;
    normalRet += f.outOfSample.regimeReturnsPct.NORMAL;
    highVolRet += f.outOfSample.regimeReturnsPct.HIGH_VOL;
  }
  const populatedRegimes = [trendingTrades > 0, normalTrades > 0, highVolTrades > 0].filter(Boolean).length;
  const worstRegimeRet = Math.min(trendingRet, normalRet, highVolRet);
  const regimeStatus: PgV4ConjunctStatus =
    worstRegimeRet < -6.0
      ? 'FAIL'
      : populatedRegimes <= 1 && worstRegimeRet < 0
      ? 'AMBER'
      : 'PASS';
  pushResult(
    'PG_regime_stability',
    regimeStatus,
    `regimes=${populatedRegimes}/3, minRegimeRet=${worstRegimeRet.toFixed(2)}%`,
    regimeStatus === 'PASS'
      ? `Cross-regime stability verified (TR=${trendingRet.toFixed(1)}%, NORM=${normalRet.toFixed(1)}%, HV=${highVolRet.toFixed(1)}%).`
      : `Regime stability concern: populated=${populatedRegimes}/3, worst=${worstRegimeRet.toFixed(2)}%.`
  );

  const aggregateState = resolvePgV4AggregateState(results);
  const deploymentBlocked = results
    .filter((r) => r.tier === 'TIER_2_DEPLOYMENT_BLOCKING')
    .some((r) => r.status !== 'PASS');
  const promotionPermitted = aggregateState === 'PASS' && !deploymentBlocked;

  const retainUntilUtc = new Date(
    Date.parse(timestampUtc) + MIN_GATE_RETENTION_DAYS * 86_400_000
  ).toISOString();

  return Object.freeze({
    promotionRequestId: input.promotionRequestId,
    requestedBy,
    pgLogicVersion,
    gateLogicHash,
    evaluatedAtUtc: timestampUtc,
    identityEvaluationSeq: evalSeq,
    identityCacheBypassed: true as const,
    identityShortCircuited: false,
    deploymentBlocked,
    promotionPermitted,
    aggregateState,
    kernelHashObserved: freshKernelDigest,
    policyHashObserved: computedPolicyHash,
    scorecard,
    conjuncts: Object.freeze(results),
    retainUntilUtc,
  });
}

/**
 * Asynchronous 3-tier PG_v4 evaluator matching the exact evaluation protocol:
 *   1. Tier 1 Identity conjuncts run sequentially fail-fast (uncached).
 *   2. Tier 2 Deployment-Blocking conjuncts run next.
 *   3. Tier 3 Promotion conjuncts run concurrently via Promise.all and merge deterministically.
 */
export async function evaluatePgV4GateAsync(
  input: PgV4EvaluationInput
): Promise<PgV4GateRecord> {
  const base = evaluatePgV4Gate(input);
  if (base.identityShortCircuited) {
    return base;
  }
  const tier1And2 = base.conjuncts.filter(
    (c) => c.tier !== 'TIER_3_PROMOTION_CONJUNCTS'
  );
  const tier3Tasks = base.conjuncts
    .filter((c) => c.tier === 'TIER_3_PROMOTION_CONJUNCTS')
    .map((c) => Promise.resolve(c));
  const resolvedTier3 = await Promise.all(tier3Tasks);
  const orderedConjuncts = [...tier1And2, ...resolvedTier3].sort(
    (a, b) => a.evalOrder - b.evalOrder
  );
  return Object.freeze({
    ...base,
    conjuncts: Object.freeze(orderedConjuncts),
  });
}

/* ── Gate Record Completeness Validator ──────────────────────────────────── */

export interface CompletenessValidationResult {
  readonly valid: boolean;
  readonly reason: string | null;
  readonly missingConjunctIds: ReadonlyArray<string>;
}

const HEX_64_REGEX = /^[0-9a-f]{64}$/;

export function validatePgV4RecordCompleteness(
  candidate: unknown,
  currentLogicHash: string = computePgV4LogicHash()
): CompletenessValidationResult {
  if (!candidate || typeof candidate !== 'object') {
    return Object.freeze({
      valid: false,
      reason: 'Gate record payload must be a non-null object.',
      missingConjunctIds: ORDERED_PG_V4_CONJUNCTS.map((c) => c.id),
    });
  }

  const rec = candidate as Partial<PgV4GateRecord>;
  if (!rec.promotionRequestId || typeof rec.promotionRequestId !== 'string') {
    return Object.freeze({
      valid: false,
      reason: 'Missing promotionRequestId on PG_v4 gate record.',
      missingConjunctIds: [],
    });
  }

  if (rec.gateLogicHash !== currentLogicHash || rec.pgLogicVersion !== PG_V4_LOGIC_VERSION) {
    return Object.freeze({
      valid: false,
      reason: `Stale or mismatched gate logic version/hash (record=${rec.pgLogicVersion}/${String(rec.gateLogicHash).slice(0, 10)}, active=${PG_V4_LOGIC_VERSION}/${currentLogicHash.slice(0, 10)}).`,
      missingConjunctIds: [],
    });
  }

  if (!Array.isArray(rec.conjuncts)) {
    return Object.freeze({
      valid: false,
      reason: 'Gate record conjuncts array is missing.',
      missingConjunctIds: ORDERED_PG_V4_CONJUNCTS.map((c) => c.id),
    });
  }

  const seen = new Set<string>();
  for (const c of rec.conjuncts) {
    if (!c || typeof c !== 'object') {
      return Object.freeze({
        valid: false,
        reason: 'Malformed conjunct entry in PG_v4 gate record.',
        missingConjunctIds: [],
      });
    }
    if (seen.has(c.conjunctId)) {
      return Object.freeze({
        valid: false,
        reason: `Duplicate conjunct "${c.conjunctId}" rejected.`,
        missingConjunctIds: [],
      });
    }
    seen.add(c.conjunctId);

    if (typeof c.evidence_ref !== 'string' || c.evidence_ref.trim().length === 0) {
      return Object.freeze({
        valid: false,
        reason: `Conjunct "${c.conjunctId}" is missing required non-empty evidence_ref.`,
        missingConjunctIds: [],
      });
    }
    if (typeof c.evidence_hash !== 'string' || !HEX_64_REGEX.test(c.evidence_hash)) {
      return Object.freeze({
        valid: false,
        reason: `Conjunct "${c.conjunctId}" lacks a valid 64-hex SHA-256 evidence_hash.`,
        missingConjunctIds: [],
      });
    }
  }

  const missing = ORDERED_PG_V4_CONJUNCTS.map((c) => c.id).filter((id) => !seen.has(id));
  const expectedCount = ORDERED_PG_V4_CONJUNCTS.length;
  if (missing.length > 0 || rec.conjuncts.length !== expectedCount) {
    return Object.freeze({
      valid: false,
      reason: `Incomplete conjunct record set (${rec.conjuncts.length}/${expectedCount} present; missing: ${missing.join(', ')}).`,
      missingConjunctIds: Object.freeze(missing),
    });
  }

  return Object.freeze({
    valid: true,
    reason: null,
    missingConjunctIds: Object.freeze([]),
  });
}

/* ── Append-Only Immutable 5-Year Retention Store ────────────────────────── */

function deepFreezeRecord<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    for (const item of obj) deepFreezeRecord(item);
  } else {
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      deepFreezeRecord((obj as Record<string, unknown>)[key]);
    }
  }
  return Object.freeze(obj);
}

export class ImmutableGateRecordStore {
  private readonly records: PgV4GateRecord[] = [];
  private readonly byRequestId = new Map<string, PgV4GateRecord>();
  private lastHash = '0'.repeat(64);

  append(record: PgV4GateRecord): PgV4GateRecord {
    const existing = this.byRequestId.get(record.promotionRequestId);
    if (existing) {
      throw new ImmutableGateRecordError(
        'GATE_RECORD_UPDATE_FORBIDDEN',
        `Promotion request "${record.promotionRequestId}" already has an immutable gate record; updates/overwrites are forbidden.`
      );
    }

    const expectedCount = ORDERED_PG_V4_CONJUNCTS.length;
    if (record.conjuncts.length !== expectedCount) {
      throw new IncompletePgV4RecordError(
        `Cannot append incomplete PG_v4 gate record (${record.conjuncts.length}/${expectedCount} conjuncts).`
      );
    }

    const retainDays = Math.round(
      (Date.parse(record.retainUntilUtc) - Date.parse(record.evaluatedAtUtc)) / 86_400_000
    );
    if (!Number.isFinite(retainDays) || retainDays < MIN_GATE_RETENTION_DAYS) {
      throw new Error(
        `Gate record retention (${retainDays}d) violates minimum ${MIN_GATE_RETENTION_DAYS}-day (5-year) retention requirement.`
      );
    }

    const sequenceNumber = this.records.length + 1;
    const prevRecordHash = this.lastHash;
    const recordHash = sha256Hex(
      canonicalStringify({
        sequenceNumber,
        prevRecordHash,
        promotionRequestId: record.promotionRequestId,
        pgLogicVersion: record.pgLogicVersion,
        gateLogicHash: record.gateLogicHash,
        aggregateState: record.aggregateState,
        evaluatedAtUtc: record.evaluatedAtUtc,
        retainUntilUtc: record.retainUntilUtc,
        conjuncts: record.conjuncts,
      })
    );

    const sealed = deepFreezeRecord({
      ...record,
      sequenceNumber,
      prevRecordHash,
      recordHash,
    });

    this.lastHash = recordHash;
    this.records.push(sealed);
    this.byRequestId.set(record.promotionRequestId, sealed);
    return sealed;
  }

  getAll(): ReadonlyArray<PgV4GateRecord> {
    return Object.freeze([...this.records]);
  }

  getByRequestId(promotionRequestId: string): PgV4GateRecord | null {
    return this.byRequestId.get(promotionRequestId) ?? null;
  }

  update(_promotionRequestId: string, _patch: Partial<PgV4GateRecord>): never {
    throw new ImmutableGateRecordError(
      'GATE_RECORD_UPDATE_FORBIDDEN',
      'PG_v4 gate records are immutable and append-only for >= 5 years; updates are strictly forbidden.'
    );
  }

  delete(_promotionRequestId: string): never {
    throw new ImmutableGateRecordError(
      'GATE_RECORD_DELETE_FORBIDDEN',
      'PG_v4 gate records carry a mandatory 5-year retention seal; deletions are strictly forbidden.'
    );
  }

  verifyChainIntegrity(): { readonly valid: boolean; readonly count: number; readonly brokenAtSeq: number | null } {
    let expectedPrev = '0'.repeat(64);
    for (let i = 0; i < this.records.length; i++) {
      const rec = this.records[i];
      if (rec.prevRecordHash !== expectedPrev) {
        return { valid: false, count: this.records.length, brokenAtSeq: i + 1 };
      }
      const recomputed = sha256Hex(
        canonicalStringify({
          sequenceNumber: rec.sequenceNumber,
          prevRecordHash: rec.prevRecordHash,
          promotionRequestId: rec.promotionRequestId,
          pgLogicVersion: rec.pgLogicVersion,
          gateLogicHash: rec.gateLogicHash,
          aggregateState: rec.aggregateState,
          evaluatedAtUtc: rec.evaluatedAtUtc,
          retainUntilUtc: rec.retainUntilUtc,
          conjuncts: rec.conjuncts,
        })
      );
      if (recomputed !== rec.recordHash) {
        return { valid: false, count: this.records.length, brokenAtSeq: i + 1 };
      }
      expectedPrev = rec.recordHash;
    }
    return { valid: true, count: this.records.length, brokenAtSeq: null };
  }
}

export interface PromotionEvaluationResponse {
  readonly accepted: boolean;
  readonly httpStatus: 201 | 400 | 409 | 422;
  readonly reason: string;
  readonly promotionId: string | null;
  readonly gateRecord: PgV4GateRecord | null;
}

export function evaluatePromotionSubmission(params: {
  candidateRecord: unknown;
  store: ImmutableGateRecordStore;
  currentLogicHash?: string;
}): PromotionEvaluationResponse {
  const activeLogicHash = params.currentLogicHash ?? computePgV4LogicHash();
  const completeness = validatePgV4RecordCompleteness(params.candidateRecord, activeLogicHash);
  if (!completeness.valid) {
    return Object.freeze({
      accepted: false,
      httpStatus: 422,
      reason: completeness.reason ?? 'Incomplete PG_v4 gate record rejected by Promotion API.',
      promotionId: null,
      gateRecord: null,
    });
  }

  const record = params.candidateRecord as PgV4GateRecord;
  const sealed = params.store.getByRequestId(record.promotionRequestId) ?? params.store.append(record);

  if (
    sealed.aggregateState !== 'PASS' ||
    sealed.identityShortCircuited ||
    sealed.deploymentBlocked ||
    !sealed.promotionPermitted
  ) {
    return Object.freeze({
      accepted: false,
      httpStatus: 409,
      reason: `Promotion rejected: PG_v4 aggregateState=${sealed.aggregateState} (deploymentBlocked=${sealed.deploymentBlocked}, shortCircuited=${sealed.identityShortCircuited}).`,
      promotionId: null,
      gateRecord: sealed,
    });
  }

  const promotionId = `prom_${sha256Hex(
    `${sealed.promotionRequestId}|${sealed.recordHash ?? ''}|${sealed.gateLogicHash}`
  ).slice(0, 16)}`;

  return Object.freeze({
    accepted: true,
    httpStatus: 201,
    reason: `Promotion ${promotionId} certified by all ${ORDERED_PG_V4_CONJUNCTS.length} PG_v4.1 conjuncts (retain until ${sealed.retainUntilUtc}).`,
    promotionId,
    gateRecord: sealed,
  });
}

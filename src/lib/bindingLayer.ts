import type { ExecutionEnvironment } from './coordinator';

/* ═══════════════════════════════════════════════════════════════════════════
 * FORCE SIGNAL — BINDING LAYER & KERNEL REGISTRY (COMMAND 1)
 * Implements signed Kernel Registry, code-enforced Kernel Ceilings,
 * 7-Weighted Classification Matrix, GitOps Policy Triples, and the
 * 7-Stage Fail-Closed Binding Layer (Stages a through g).
 * ═══════════════════════════════════════════════════════════════════════════ */

export const KERNEL_REGISTRY_AUTHORITY = 'force-signal-release-authority-v1';
export const FIXED_MIN_RR_CONSTANT = 5 as const;

export type ArchitectureLayer = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
export type SubsystemClassification = 'KERNEL' | 'POLICY' | 'BINDING';
export type DeploymentEnvironment = 'staging' | 'production' | ExecutionEnvironment;

export type BindingStageId =
  | 'STAGE_A_SCHEMA'
  | 'STAGE_B_SEMANTIC'
  | 'STAGE_C_CEILING'
  | 'STAGE_D_CONTRACT_VERSION'
  | 'STAGE_E_HASHING'
  | 'STAGE_F_DRIFT'
  | 'STAGE_G_AUDIT';

export const ORDERED_BINDING_STAGES: ReadonlyArray<BindingStageId> = Object.freeze([
  'STAGE_A_SCHEMA',
  'STAGE_B_SEMANTIC',
  'STAGE_C_CEILING',
  'STAGE_D_CONTRACT_VERSION',
  'STAGE_E_HASHING',
  'STAGE_F_DRIFT',
  'STAGE_G_AUDIT',
]);

/* ── Pure Deterministic SHA-256 (Browser + Node Parity) ───────────────────── */

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const highBits = Math.floor(bitLen / 0x100000000);
  const lowBits = bitLen >>> 0;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, highBits, false);
  view.setUint32(paddedLen - 4, lowBits, false);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];

    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  let hex = '';
  for (let i = 0; i < h.length; i += 1) {
    hex += h[i].toString(16).padStart(8, '0');
  }
  return hex;
}

export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const pairs = sortedKeys
    .filter((k) => record[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalStringify(record[k])}`);
  return `{${pairs.join(',')}}`;
}

/* ── Deliverable 1: Kernel Registry Design ────────────────────────────────── */

export interface KernelArtifactSpec {
  readonly kernelId: string;
  readonly layer: Exclude<ArchitectureLayer, 'L5'>;
  readonly contractSemver: string;
  readonly sourceModule: string;
  readonly invariantManifest: ReadonlyArray<string>;
  readonly fixedConstants: Readonly<Record<string, number | boolean | string>>;
}

export interface SignedKernelArtifact extends KernelArtifactSpec {
  readonly sha256Digest: string;
  readonly signature: string;
  readonly signerId: string;
}

function signKernelArtifact(spec: KernelArtifactSpec): SignedKernelArtifact {
  const digestPayload = canonicalStringify({
    kernelId: spec.kernelId,
    layer: spec.layer,
    contractSemver: spec.contractSemver,
    sourceModule: spec.sourceModule,
    invariantManifest: [...spec.invariantManifest].sort(),
    fixedConstants: spec.fixedConstants,
  });
  const sha256Digest = sha256Hex(digestPayload);
  const signaturePayload = `${KERNEL_REGISTRY_AUTHORITY}|${spec.kernelId}|${spec.contractSemver}|${sha256Digest}|${spec.invariantManifest.join(',')}`;
  const signature = `sig_v1_${sha256Hex(signaturePayload)}`;
  return Object.freeze({
    ...spec,
    invariantManifest: Object.freeze([...spec.invariantManifest]),
    fixedConstants: Object.freeze({ ...spec.fixedConstants }),
    sha256Digest,
    signature,
    signerId: KERNEL_REGISTRY_AUTHORITY,
  });
}

export function verifyKernelArtifactSignature(artifact: SignedKernelArtifact): boolean {
  if (!artifact.kernelId.endsWith('-Kernel')) return false;
  if (!/^\d+\.\d+\.\d+$/.test(artifact.contractSemver)) return false;
  const expected = signKernelArtifact({
    kernelId: artifact.kernelId,
    layer: artifact.layer,
    contractSemver: artifact.contractSemver,
    sourceModule: artifact.sourceModule,
    invariantManifest: artifact.invariantManifest,
    fixedConstants: artifact.fixedConstants,
  });
  return (
    expected.sha256Digest === artifact.sha256Digest &&
    expected.signature === artifact.signature &&
    artifact.signerId === KERNEL_REGISTRY_AUTHORITY
  );
}

const RAW_KERNEL_SPECS: ReadonlyArray<KernelArtifactSpec> = [
  {
    kernelId: 'RuntimeGuard-Kernel',
    layer: 'L0',
    contractSemver: '1.0.0',
    sourceModule: 'src/lib/systemicLayers.ts',
    invariantManifest: ['I-G1'],
    fixedConstants: { categorical_profile_isolation: true, fail_closed_on_scope_mismatch: true },
  },
  {
    kernelId: 'RiskContainment-Kernel',
    layer: 'L0',
    contractSemver: '1.0.0',
    sourceModule: 'src/lib/riskEngine.ts',
    invariantManifest: ['I-RC1', 'I-RC2', 'I-RC3'],
    fixedConstants: {
      module_drawdown_floor_pct: 3.0,
      module_drawdown_ceiling_pct: 5.0,
      portfolio_drawdown_floor_pct: 10.0,
      portfolio_drawdown_ceiling_pct: 15.0,
      portfolio_daily_max_pct: 5.0,
      portfolio_peak_to_trough_max_pct: 15.0,
      strategy_daily_max_pct: 2.0,
      strategy_peak_to_trough_max_pct: 8.0,
      regime_scoped_max_pct: 1.5,
      consecutive_losses_circuit_breaker: 6,
      synchronous_can_trade_gate: true,
    },
  },
  {
    kernelId: 'RRGate-Kernel',
    layer: 'L3',
    contractSemver: '1.0.0',
    sourceModule: 'src/lib/riskEngine.ts',
    invariantManifest: ['I-RR1', 'I-RR2', 'I-RR3'],
    fixedConstants: {
      min_rr: FIXED_MIN_RR_CONSTANT,
      hard_reject_below_floor: true,
      three_check_placement: 'signal_emission->risk_gate->order_intent',
      forbid_post_hoc_stop_tightening: true,
      structural_stop_and_pool_required: true,
    },
  },
  {
    kernelId: 'StructuralStop-Kernel',
    layer: 'L3',
    contractSemver: '1.0.0',
    sourceModule: 'src/lib/invariantKernels.ts',
    invariantManifest: ['I-SS1', 'I-SS2', 'I-SS3', 'I-SS4'],
    fixedConstants: { max_trade_risk_pct: 2.0, closed_bar_structure_only: true },
  },
  {
    kernelId: 'MonotonicTrailingStop-Kernel',
    layer: 'L3',
    contractSemver: '1.0.0',
    sourceModule: 'src/lib/invariantKernels.ts',
    invariantManifest: ['I-TS1', 'I-TS2', 'I-TS3', 'I-TS4', 'I-TS5'],
    fixedConstants: { bar_close_only: true, widen_forbidden: true },
  },
  {
    kernelId: 'RegimeAwareScaling-Kernel',
    layer: 'L3',
    contractSemver: '1.0.0',
    sourceModule: 'src/lib/invariantKernels.ts',
    invariantManifest: ['I-SC1', 'I-SC2', 'I-SC3', 'I-SC4', 'I-SC5'],
    fixedConstants: { scaling_min_realized_r: 3.0, preserve_remaining_min_rr: 5 },
  },
  {
    kernelId: 'MarketStream-Kernel',
    layer: 'L1',
    contractSemver: '1.0.0',
    sourceModule: 'src/lib/wsDataEngine.ts',
    invariantManifest: ['I-MS1', 'I-MS2', 'I-MS3', 'I-MS4'],
    fixedConstants: { single_data_egress_l1_only: true, zero_lookahead_leakage: true },
  },
  {
    kernelId: 'CertifiedPrimarySource-Kernel',
    layer: 'L1',
    contractSemver: '1.0.0',
    sourceModule: 'src/lib/certifiedPrimarySource.ts',
    invariantManifest: ['I-PD1', 'I-PD2', 'I-PD3', 'I-PD4'],
    fixedConstants: {
      spot_primary_channel: '@bookTicker',
      spot_freshness_ceiling_ms: 500,
      spot_divergence_threshold_bps: 25,
      futures_primary_channel: '@markPrice@1s',
      futures_freshness_ceiling_ms: 1500,
      futures_divergence_threshold_bps: 50,
      failover_allowed: false,
      tier3_hard_reset_interval_ms: 900000,
    },
  },
  {
    kernelId: 'OrderPlacement-Kernel',
    layer: 'L2',
    contractSemver: '1.0.0',
    sourceModule: 'src/lib/systemicLayers.ts',
    invariantManifest: ['I-OP1', 'I-OP2'],
    fixedConstants: { single_execution_egress_l2_only: true, parity_gate_mandatory: true },
  },
  {
    kernelId: 'FillModel-Kernel',
    layer: 'L2',
    contractSemver: '1.0.0',
    sourceModule: 'src/lib/fillModel.ts',
    invariantManifest: ['I-OP1', 'I-OP2'],
    fixedConstants: {
      default_execution_algorithm: 'IMPLEMENTATION_SHORTFALL',
      adverse_slippage_only: true,
      crossed_limit_taker_fee: true,
      next_bar_fill_default: true,
    },
  },
  {
    kernelId: 'SmcStructure-Kernel',
    layer: 'L3',
    contractSemver: '1.0.0',
    sourceModule: 'src/lib/smcAgent.ts',
    invariantManifest: ['I-SMC1', 'I-SMC2'],
    fixedConstants: { frvp_profile_monotonicity: true },
  },
  {
    kernelId: 'OrderFlow-Kernel',
    layer: 'L3',
    contractSemver: '1.0.0',
    sourceModule: 'src/lib/sentinelAgent.ts',
    invariantManifest: ['I-OF1', 'I-OF2'],
    fixedConstants: { filter_wash_spikes: true },
  },
  {
    kernelId: 'AiDecisionDiscipline-Kernel',
    layer: 'L3',
    contractSemver: '1.0.0',
    sourceModule: 'src/lib/masterCoordinator.ts',
    invariantManifest: ['I-AIDE1', 'I-AIDE2', 'I-AIDE3'],
    fixedConstants: { veto_never_averaged: true, allow_no_trade_silence: true },
  },
  {
    kernelId: 'IntegrityAudit-Kernel',
    layer: 'L4',
    contractSemver: '1.0.0',
    sourceModule: 'src/lib/backtest.ts',
    invariantManifest: ['I-CI1', 'I-CI2'],
    fixedConstants: { locked_dependencies_only: true, frozen_walk_forward_oos: true },
  },
  {
    kernelId: 'EuAiActCompliance-Kernel',
    layer: 'L4',
    contractSemver: '1.0.0',
    sourceModule: 'src/lib/telemetrySync.ts',
    invariantManifest: ['I-AA1', 'I-AA2', 'I-AA3', 'I-AA4', 'I-AA5'],
    fixedConstants: { eu_ai_act_high_risk_articles: '9,11,12,13,14,15', guarantee_profit: false },
  },
];

export const KERNEL_REGISTRY: ReadonlyArray<SignedKernelArtifact> = Object.freeze(
  RAW_KERNEL_SPECS.map((spec) => signKernelArtifact(spec))
);

export const KERNEL_REGISTRY_BY_ID: Readonly<Record<string, SignedKernelArtifact>> = Object.freeze(
  KERNEL_REGISTRY.reduce<Record<string, SignedKernelArtifact>>((acc, kernel) => {
    acc[kernel.kernelId] = kernel;
    return acc;
  }, {})
);

export function computeKernelSetDigest(artifacts: ReadonlyArray<SignedKernelArtifact> = KERNEL_REGISTRY): string {
  const sorted = [...artifacts]
    .sort((a, b) => a.kernelId.localeCompare(b.kernelId))
    .map((k) => `${k.kernelId}@${k.contractSemver}:${k.sha256Digest}`);
  return sha256Hex(sorted.join('\n'));
}

/* ── Deliverable 4: Code-Enforced Kernel Ceiling Table ────────────────────── */

export interface KernelCeilingEntry {
  readonly policyKey: string;
  readonly isPolicyConfigurable: boolean;
  readonly minValue: number | null;
  readonly maxValue: number | null;
  readonly fixedKernelConstant: number | null;
  readonly unit: string;
  readonly ownerKernel: string;
  readonly rationale: string;
}

export const KERNEL_CEILINGS = Object.freeze({
  max_daily_loss_pct: 5.0,
  slippage_bps: 50,
  participation_cap_pct: 5.0,
  max_open_positions: 20,
  mandate_duration_hours: 24,
  atr_multiplier_min: 1.0,
  atr_multiplier_max: 3.5,
  min_rr_fixed: FIXED_MIN_RR_CONSTANT,
} as const);

export const KERNEL_CEILING_TABLE: ReadonlyArray<KernelCeilingEntry> = Object.freeze([
  Object.freeze({
    policyKey: 'max_daily_loss_pct',
    isPolicyConfigurable: true,
    minValue: 0.25,
    maxValue: KERNEL_CEILINGS.max_daily_loss_pct,
    fixedKernelConstant: null,
    unit: 'percent',
    ownerKernel: 'RiskContainment-Kernel',
    rationale: 'Prevents single-session ruin and bounds daily equity loss beneath portfolio halt thresholds (EU AI Act Art. 9).',
  }),
  Object.freeze({
    policyKey: 'slippage_bps',
    isPolicyConfigurable: true,
    minValue: 1,
    maxValue: KERNEL_CEILINGS.slippage_bps,
    fixedKernelConstant: null,
    unit: 'bps',
    ownerKernel: 'OrderPlacement-Kernel',
    rationale: 'Caps L2 fill deterioration to prevent hidden spread-expansion erosion of 1:5 payoff symmetry.',
  }),
  Object.freeze({
    policyKey: 'participation_cap_pct',
    isPolicyConfigurable: true,
    minValue: 0.05,
    maxValue: KERNEL_CEILINGS.participation_cap_pct,
    fixedKernelConstant: null,
    unit: 'percent_bar_volume',
    ownerKernel: 'OrderPlacement-Kernel',
    rationale: 'Restricts execution footprint to <= 5% of closed-bar volume to bound L2 market impact friction.',
  }),
  Object.freeze({
    policyKey: 'max_open_positions',
    isPolicyConfigurable: true,
    minValue: 1,
    maxValue: KERNEL_CEILINGS.max_open_positions,
    fixedKernelConstant: null,
    unit: 'count',
    ownerKernel: 'RiskContainment-Kernel',
    rationale: 'Limits correlated concentration risk, margin fragmentation, and state reconciliation surface.',
  }),
  Object.freeze({
    policyKey: 'mandate_duration_hours',
    isPolicyConfigurable: true,
    minValue: 1,
    maxValue: KERNEL_CEILINGS.mandate_duration_hours,
    fixedKernelConstant: null,
    unit: 'hours',
    ownerKernel: 'EuAiActCompliance-Kernel',
    rationale: 'Enforces periodic <= 24h operator mandate renewal to satisfy EU AI Act Art. 14 human oversight.',
  }),
  Object.freeze({
    policyKey: 'atr_multiplier',
    isPolicyConfigurable: true,
    minValue: KERNEL_CEILINGS.atr_multiplier_min,
    maxValue: KERNEL_CEILINGS.atr_multiplier_max,
    fixedKernelConstant: null,
    unit: 'multiplier',
    ownerKernel: 'StructuralStop-Kernel',
    rationale: 'Keeps ATR structural stop filtering inside [1.0, 3.5] to avoid noise-tight stops or excessive risk distance.',
  }),
  Object.freeze({
    policyKey: 'min_rr',
    isPolicyConfigurable: false,
    minValue: null,
    maxValue: null,
    fixedKernelConstant: KERNEL_CEILINGS.min_rr_fixed,
    unit: 'ratio',
    ownerKernel: 'RRGate-Kernel',
    rationale: 'Constitutional 1:5 floor (I-RR1); fixed code constant in RRGate-Kernel and strictly forbidden as a policy key.',
  }),
]);

/* ── Deliverable 5: Component Classification Matrix (7 Weighted Criteria) ─── */

export const CLASSIFICATION_CRITERIA_WEIGHTS = Object.freeze({
  blastRadius: 0.2,
  determinism: 0.2,
  failClosed: 0.2,
  auditability: 0.15,
  expressivenessCeiling: 0.1,
  changeAuthority: 0.1,
  testability: 0.05,
} as const);

export interface ComponentCriteriaScores {
  readonly blastRadius: 1 | 2 | 3 | 4 | 5;
  readonly determinism: 1 | 2 | 3 | 4 | 5;
  readonly failClosed: 1 | 2 | 3 | 4 | 5;
  readonly auditability: 1 | 2 | 3 | 4 | 5;
  readonly expressivenessCeiling: 1 | 2 | 3 | 4 | 5;
  readonly changeAuthority: 1 | 2 | 3 | 4 | 5;
  readonly testability: 1 | 2 | 3 | 4 | 5;
}

export interface ComponentClassificationEntry {
  readonly subsystemId: string;
  readonly modulePath: string;
  readonly layer: ArchitectureLayer;
  readonly scores: ComponentCriteriaScores;
  readonly weightedScore: number;
  readonly forcedKernelByHardRule: boolean;
  readonly classification: SubsystemClassification;
  readonly rationale: string;
}

export function computeWeightedClassificationScore(scores: ComponentCriteriaScores): number {
  const sum =
    scores.blastRadius * CLASSIFICATION_CRITERIA_WEIGHTS.blastRadius +
    scores.determinism * CLASSIFICATION_CRITERIA_WEIGHTS.determinism +
    scores.failClosed * CLASSIFICATION_CRITERIA_WEIGHTS.failClosed +
    scores.auditability * CLASSIFICATION_CRITERIA_WEIGHTS.auditability +
    scores.expressivenessCeiling * CLASSIFICATION_CRITERIA_WEIGHTS.expressivenessCeiling +
    scores.changeAuthority * CLASSIFICATION_CRITERIA_WEIGHTS.changeAuthority +
    scores.testability * CLASSIFICATION_CRITERIA_WEIGHTS.testability;
  return Number(sum.toFixed(3));
}

export function classifyByWeightedCriteria(
  scores: ComponentCriteriaScores,
  intendedRole: SubsystemClassification
): { readonly classification: SubsystemClassification; readonly forcedKernelByHardRule: boolean; readonly weightedScore: number } {
  const forcedKernelByHardRule = scores.determinism >= 4 || scores.failClosed >= 4;
  const weightedScore = computeWeightedClassificationScore(scores);
  const classification: SubsystemClassification = forcedKernelByHardRule ? 'KERNEL' : intendedRole;
  return Object.freeze({ classification, forcedKernelByHardRule, weightedScore });
}

interface RawSubsystemSpec {
  readonly subsystemId: string;
  readonly modulePath: string;
  readonly layer: ArchitectureLayer;
  readonly intendedRole: SubsystemClassification;
  readonly scores: ComponentCriteriaScores;
  readonly rationale: string;
}

const RAW_SUBSYSTEM_CLASSIFICATIONS: ReadonlyArray<RawSubsystemSpec> = [
  {
    subsystemId: 'RuntimeGuard-Kernel',
    modulePath: 'src/lib/systemicLayers.ts',
    layer: 'L0',
    intendedRole: 'KERNEL',
    scores: { blastRadius: 5, determinism: 5, failClosed: 5, auditability: 5, expressivenessCeiling: 5, changeAuthority: 5, testability: 5 },
    rationale: 'Security and environment isolation boundary; determinism=5 & failClosed=5 force KERNEL.',
  },
  {
    subsystemId: 'RRGate-Kernel',
    modulePath: 'src/lib/invariantKernels.ts',
    layer: 'L3',
    intendedRole: 'KERNEL',
    scores: { blastRadius: 5, determinism: 5, failClosed: 5, auditability: 5, expressivenessCeiling: 5, changeAuthority: 5, testability: 5 },
    rationale: 'Enforces non-negotiable 1:5 minimum R:R constant; determinism=5 & failClosed=5 force KERNEL.',
  },
  {
    subsystemId: 'StructuralStop-Kernel',
    modulePath: 'src/lib/invariantKernels.ts',
    layer: 'L3',
    intendedRole: 'KERNEL',
    scores: { blastRadius: 5, determinism: 5, failClosed: 5, auditability: 5, expressivenessCeiling: 4, changeAuthority: 5, testability: 5 },
    rationale: 'Derives stops from closed-bar structure and <=2% risk cap; determinism=5 forces KERNEL.',
  },
  {
    subsystemId: 'MonotonicTrailingStop-Kernel',
    modulePath: 'src/lib/invariantKernels.ts',
    layer: 'L3',
    intendedRole: 'KERNEL',
    scores: { blastRadius: 4, determinism: 5, failClosed: 5, auditability: 5, expressivenessCeiling: 5, changeAuthority: 5, testability: 5 },
    rationale: 'Guarantees monotonic stop tightening on bar close; determinism=5 forces KERNEL.',
  },
  {
    subsystemId: 'RegimeAwareScaling-Kernel',
    modulePath: 'src/lib/invariantKernels.ts',
    layer: 'L3',
    intendedRole: 'KERNEL',
    scores: { blastRadius: 4, determinism: 5, failClosed: 4, auditability: 5, expressivenessCeiling: 4, changeAuthority: 4, testability: 5 },
    rationale: 'Restricts partial exits to >3R while preserving R:R>=5; determinism=5 forces KERNEL.',
  },
  {
    subsystemId: 'OrderPlacement-Kernel & Execution Fill Model',
    modulePath: 'src/lib/systemicLayers.ts + src/lib/coordinator.ts',
    layer: 'L2',
    intendedRole: 'KERNEL',
    scores: { blastRadius: 5, determinism: 5, failClosed: 5, auditability: 5, expressivenessCeiling: 5, changeAuthority: 5, testability: 5 },
    rationale: 'Single execution egress boundary, multi-layer fill friction & Parity Gate; determinism=5 forces KERNEL.',
  },
  {
    subsystemId: 'RiskContainment-Kernel & Safeguards',
    modulePath: 'src/lib/forgeCapitalHub.ts + src/lib/autonomousSafeguards.ts + src/lib/riskCalculator.ts',
    layer: 'L0',
    intendedRole: 'KERNEL',
    scores: { blastRadius: 5, determinism: 5, failClosed: 5, auditability: 5, expressivenessCeiling: 5, changeAuthority: 5, testability: 5 },
    rationale: 'Portfolio/module drawdown halts and cross-margin liquidation math; failClosed=5 forces KERNEL.',
  },
  {
    subsystemId: 'MarketStream-Kernel & Anomaly Quarantine',
    modulePath: 'src/lib/wsDataEngine.ts + src/lib/spotCmcValidator.ts + src/lib/marketData.ts',
    layer: 'L1',
    intendedRole: 'KERNEL',
    scores: { blastRadius: 5, determinism: 5, failClosed: 5, auditability: 5, expressivenessCeiling: 5, changeAuthority: 5, testability: 5 },
    rationale: 'Single L1 data egress, monotonic PIT cursors, outlier/CMC validation; determinism=5 forces KERNEL.',
  },
  {
    subsystemId: 'SmcStructure-Kernel & OrderBook Depth',
    modulePath: 'src/lib/smcAgent.ts + src/lib/orderBookDepth.ts',
    layer: 'L3',
    intendedRole: 'KERNEL',
    scores: { blastRadius: 3, determinism: 5, failClosed: 4, auditability: 4, expressivenessCeiling: 4, changeAuthority: 4, testability: 5 },
    rationale: 'Deterministic FRVP & liquidity sweep geometry; determinism=5 & failClosed=4 force KERNEL.',
  },
  {
    subsystemId: 'OrderFlow-Kernel & Pattern Scanner',
    modulePath: 'src/lib/sentinelAgent.ts + src/lib/patternScanner.ts',
    layer: 'L3',
    intendedRole: 'KERNEL',
    scores: { blastRadius: 4, determinism: 4, failClosed: 4, auditability: 4, expressivenessCeiling: 4, changeAuthority: 4, testability: 5 },
    rationale: 'Deterministic breakout/volume-anomaly detection over closed bars; determinism=4 forces KERNEL.',
  },
  {
    subsystemId: 'AiDecisionDiscipline-Kernel & Coordinators',
    modulePath: 'src/lib/masterCoordinator.ts + src/lib/arbitrageAndCopyTrading.ts + src/lib/signals.ts + src/lib/pinnedSignals.ts',
    layer: 'L3',
    intendedRole: 'KERNEL',
    scores: { blastRadius: 4, determinism: 4, failClosed: 4, auditability: 5, expressivenessCeiling: 4, changeAuthority: 4, testability: 5 },
    rationale: 'Enforces non-averaged risk vetoes and signal invariants; determinism=4 & failClosed=4 force KERNEL.',
  },
  {
    subsystemId: 'IntegrityAudit-Kernel & Walk-Forward Engine',
    modulePath: 'src/lib/backtest.ts + src/lib/signalHistory.ts + src/lib/monitorAgent.ts',
    layer: 'L4',
    intendedRole: 'KERNEL',
    scores: { blastRadius: 3, determinism: 5, failClosed: 4, auditability: 5, expressivenessCeiling: 4, changeAuthority: 5, testability: 5 },
    rationale: 'Frozen-parameter L3 OOS evaluation and immutable history audits; determinism=5 forces KERNEL.',
  },
  {
    subsystemId: 'EuAiActCompliance-Kernel & Governance',
    modulePath: 'src/lib/telemetrySync.ts + src/lib/emailDigest.ts + src/lib/voiceCommandAgent.ts',
    layer: 'L4',
    intendedRole: 'KERNEL',
    scores: { blastRadius: 3, determinism: 4, failClosed: 4, auditability: 5, expressivenessCeiling: 4, changeAuthority: 5, testability: 5 },
    rationale: 'EU AI Act Arts. 9-15 logging, emergency voice halt parser, and drift telemetry; failClosed=4 forces KERNEL.',
  },
  {
    subsystemId: 'Binding Layer & System Controls Verifier',
    modulePath: 'src/lib/bindingLayer.ts + src/lib/systemControls.ts',
    layer: 'L4',
    intendedRole: 'BINDING',
    scores: { blastRadius: 5, determinism: 3, failClosed: 3, auditability: 5, expressivenessCeiling: 5, changeAuthority: 5, testability: 5 },
    rationale: 'Sole authoritative bridge verifying policy specializations against signed kernels and failing closed at boot.',
  },
  {
    subsystemId: 'GitOps Risk & Allocation Policy',
    modulePath: 'policies/force-signal.policy.json + src/lib/portfolioManager.ts + src/lib/swipeDismiss.ts',
    layer: 'L5',
    intendedRole: 'POLICY',
    scores: { blastRadius: 2, determinism: 2, failClosed: 2, auditability: 4, expressivenessCeiling: 2, changeAuthority: 2, testability: 4 },
    rationale: 'Declarative Git-committed parameter selection and portfolio weight preferences bounded inside kernel ceilings.',
  },
  {
    subsystemId: 'Delivery Gateway, Server Routes & UI Surface',
    modulePath: 'server.ts + src/context/AppContext.tsx + src/components/*',
    layer: 'L5',
    intendedRole: 'BINDING',
    scores: { blastRadius: 4, determinism: 3, failClosed: 3, auditability: 4, expressivenessCeiling: 3, changeAuthority: 4, testability: 4 },
    rationale: 'Enforces downward-only delegation into Binding Layer, L2 Execution Egress, and L1 Data Egress.',
  },
];

export const COMPONENT_CLASSIFICATION_MATRIX: ReadonlyArray<ComponentClassificationEntry> = Object.freeze(
  RAW_SUBSYSTEM_CLASSIFICATIONS.map((spec) => {
    const evaluated = classifyByWeightedCriteria(spec.scores, spec.intendedRole);
    return Object.freeze({
      subsystemId: spec.subsystemId,
      modulePath: spec.modulePath,
      layer: spec.layer,
      scores: Object.freeze({ ...spec.scores }),
      weightedScore: evaluated.weightedScore,
      forcedKernelByHardRule: evaluated.forcedKernelByHardRule,
      classification: evaluated.classification,
      rationale: spec.rationale,
    });
  })
);

/* ── GitOps Policy Model & Known-Good Triples ─────────────────────────────── */

export interface GitOpsPolicyDocument {
  readonly policy_id: string;
  readonly policy_version: string;
  readonly git_sha: string;
  readonly max_daily_loss_pct: number;
  readonly slippage_bps: number;
  readonly participation_cap_pct: number;
  readonly max_open_positions: number;
  readonly mandate_duration_hours: number;
  readonly atr_multiplier: number;
  readonly module_drawdown_limit_pct: number;
  readonly portfolio_drawdown_limit_pct: number;
  readonly target_kernels: ReadonlyArray<string>;
  readonly kernel_contracts: Readonly<Record<string, string>>;
}

export interface BindingTriple {
  readonly kernel_hash: string;
  readonly policy_hash: string;
  readonly git_sha: string;
}

export interface BindingAuditRecord {
  readonly auditId: string;
  readonly timestampUtc: string;
  readonly environment: DeploymentEnvironment;
  readonly status: 'BOUND_START_ALLOWED' | 'FAILED_CLOSED_HALT';
  readonly completedStages: ReadonlyArray<BindingStageId>;
  readonly failedStage: BindingStageId | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly triple: BindingTriple | null;
  readonly boundKernelCount: number;
}

export interface BindingLayerResult {
  readonly bound: boolean;
  readonly processStartAllowed: boolean;
  readonly environment: DeploymentEnvironment;
  readonly triple: BindingTriple | null;
  readonly boundPolicy: GitOpsPolicyDocument | null;
  readonly boundKernels: ReadonlyArray<SignedKernelArtifact>;
  readonly audit: BindingAuditRecord;
}

export interface BindingFaultInjector {
  readonly failStage?: BindingStageId;
  readonly reason?: string;
}

export interface BindPolicyOptions {
  readonly environment: DeploymentEnvironment;
  readonly kernelRegistry?: ReadonlyArray<SignedKernelArtifact>;
  readonly knownGoodTriples?: ReadonlyArray<BindingTriple>;
  readonly requireKnownGoodTriple?: boolean;
  readonly auditSink?: (record: BindingAuditRecord) => void;
  readonly faultInjector?: BindingFaultInjector;
  readonly timestampUtc?: string;
}

export const DEFAULT_GITOPS_POLICY: GitOpsPolicyDocument = Object.freeze({
  policy_id: 'force-signal-spot-core',
  policy_version: '1.0.0',
  git_sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  max_daily_loss_pct: 3.5,
  slippage_bps: 18,
  participation_cap_pct: 2.5,
  max_open_positions: 12,
  mandate_duration_hours: 24,
  atr_multiplier: 1.5,
  module_drawdown_limit_pct: 4.0,
  portfolio_drawdown_limit_pct: 12.5,
  target_kernels: Object.freeze(KERNEL_REGISTRY.map((k) => k.kernelId)),
  kernel_contracts: Object.freeze(
    KERNEL_REGISTRY.reduce<Record<string, string>>((acc, k) => {
      acc[k.kernelId] = k.contractSemver;
      return acc;
    }, {})
  ),
});

export function computePolicyDigest(policy: GitOpsPolicyDocument): string {
  return sha256Hex(canonicalStringify(policy));
}

export const KNOWN_GOOD_BINDING_TRIPLES: ReadonlyArray<BindingTriple> = Object.freeze([
  Object.freeze({
    kernel_hash: computeKernelSetDigest(KERNEL_REGISTRY),
    policy_hash: computePolicyDigest(DEFAULT_GITOPS_POLICY),
    git_sha: DEFAULT_GITOPS_POLICY.git_sha,
  }),
]);

export class BindingFailClosedError extends Error {
  readonly stage: BindingStageId;
  readonly code: string;
  readonly audit: BindingAuditRecord;

  constructor(stage: BindingStageId, code: string, message: string, audit: BindingAuditRecord) {
    super(`[BindingLayer:${stage}:${code}] ${message}`);
    this.name = 'BindingFailClosedError';
    this.stage = stage;
    this.code = code;
    this.audit = audit;
  }
}

/* ── Helper Validators for Binding Stages (a) - (g) ───────────────────────── */

const ALLOWED_POLICY_KEYS = new Set<string>([
  'policy_id',
  'policy_version',
  'git_sha',
  'max_daily_loss_pct',
  'slippage_bps',
  'participation_cap_pct',
  'max_open_positions',
  'mandate_duration_hours',
  'atr_multiplier',
  'module_drawdown_limit_pct',
  'portfolio_drawdown_limit_pct',
  'target_kernels',
  'kernel_contracts',
]);

const FORBIDDEN_CONSTITUTION_POLICY_KEYS = new Set<string>([
  'min_rr',
  'min_rr_ratio',
  'min_risk_reward',
  'minRR',
  'minRRRatio',
  'minRiskReward',
]);

function hasSnakeCaseKeyFormat(key: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(key);
}

function scanObjectForForbiddenKeys(value: unknown, path = ''): string | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const nested = scanObjectForForbiddenKeys(value[i], `${path}[${i}]`);
      if (nested) return nested;
    }
    return null;
  }
  const rec = value as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (FORBIDDEN_CONSTITUTION_POLICY_KEYS.has(key)) {
      return path ? `${path}.${key}` : key;
    }
    const nested = scanObjectForForbiddenKeys(rec[key], path ? `${path}.${key}` : key);
    if (nested) return nested;
  }
  return null;
}

function parseSemver(ver: string): { major: number; minor: number; patch: number } | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(ver);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

function makeFailedResult(params: {
  environment: DeploymentEnvironment;
  completedStages: BindingStageId[];
  failedStage: BindingStageId;
  failureCode: string;
  failureMessage: string;
  triple: BindingTriple | null;
  boundKernelCount: number;
  timestampUtc: string;
  auditSink?: (record: BindingAuditRecord) => void;
}): BindingLayerResult {
  const audit: BindingAuditRecord = Object.freeze({
    auditId: `bind_audit_${sha256Hex(`${params.timestampUtc}|${params.failedStage}|${params.failureCode}`).slice(0, 16)}`,
    timestampUtc: params.timestampUtc,
    environment: params.environment,
    status: 'FAILED_CLOSED_HALT',
    completedStages: Object.freeze([...params.completedStages]),
    failedStage: params.failedStage,
    failureCode: params.failureCode,
    failureMessage: params.failureMessage,
    triple: params.triple,
    boundKernelCount: params.boundKernelCount,
  });

  if (params.auditSink) {
    try {
      params.auditSink(audit);
    } catch {
      // Fail-closed posture preserves halt status regardless of secondary sink failures.
    }
  }

  return Object.freeze({
    bound: false,
    processStartAllowed: false,
    environment: params.environment,
    triple: params.triple,
    boundPolicy: null,
    boundKernels: Object.freeze([]),
    audit,
  });
}

/* ── Deliverable 2 & 3: 7-Stage Ordered Fail-Closed Binding Layer ─────────── */

export function bindPolicyToKernels(
  rawPolicy: unknown,
  options: BindPolicyOptions
): BindingLayerResult {
  const timestampUtc = options.timestampUtc ?? new Date().toISOString();
  const registry = options.kernelRegistry ?? KERNEL_REGISTRY;
  const knownGoodTriples = options.knownGoodTriples ?? KNOWN_GOOD_BINDING_TRIPLES;
  const requireKnownGoodTriple = options.requireKnownGoodTriple ?? true;
  const completedStages: BindingStageId[] = [];
  const injector = options.faultInjector;

  const failAt = (
    stage: BindingStageId,
    code: string,
    message: string,
    triple: BindingTriple | null = null,
    boundCount = 0
  ): BindingLayerResult =>
    makeFailedResult({
      environment: options.environment,
      completedStages,
      failedStage: stage,
      failureCode: code,
      failureMessage: message,
      triple,
      boundKernelCount: boundCount,
      timestampUtc,
      auditSink: options.auditSink,
    });

  // ── Stage (a): Schema Validation ──────────────────────────────────────────
  if (injector?.failStage === 'STAGE_A_SCHEMA') {
    return failAt('STAGE_A_SCHEMA', 'INJECTED_FAULT', injector.reason ?? 'Injected schema stage fault.');
  }

  if (!rawPolicy || typeof rawPolicy !== 'object' || Array.isArray(rawPolicy)) {
    return failAt(
      'STAGE_A_SCHEMA',
      'MALFORMED_POLICY_OBJECT',
      'Policy payload must be a non-null JSON object.'
    );
  }

  const candidate = rawPolicy as Record<string, unknown>;
  const forbiddenHit = scanObjectForForbiddenKeys(candidate);
  if (forbiddenHit) {
    return failAt(
      'STAGE_A_SCHEMA',
      'IMMUTABLE_MIN_RR_FORBIDDEN',
      `Policy carries forbidden immutable key "${forbiddenHit}"; min_rr is a fixed kernel constant (5) and must never appear in configuration.`
    );
  }

  for (const key of Object.keys(candidate)) {
    if (!hasSnakeCaseKeyFormat(key)) {
      return failAt(
        'STAGE_A_SCHEMA',
        'INVALID_KEY_NAMING',
        `Policy key "${key}" violates mandatory snake_case naming doctrine.`
      );
    }
    if (!ALLOWED_POLICY_KEYS.has(key)) {
      return failAt(
        'STAGE_A_SCHEMA',
        'UNKNOWN_POLICY_KEY',
        `Unrecognized policy key "${key}" rejected by strict closed-world schema.`
      );
    }
  }

  for (const requiredKey of ALLOWED_POLICY_KEYS) {
    if (candidate[requiredKey] === undefined || candidate[requiredKey] === null) {
      return failAt(
        'STAGE_A_SCHEMA',
        'MISSING_REQUIRED_FIELD',
        `Required policy field "${requiredKey}" is missing.`
      );
    }
  }

  const numericKeys = [
    'max_daily_loss_pct',
    'slippage_bps',
    'participation_cap_pct',
    'max_open_positions',
    'mandate_duration_hours',
    'atr_multiplier',
    'module_drawdown_limit_pct',
    'portfolio_drawdown_limit_pct',
  ] as const;

  for (const nKey of numericKeys) {
    const val = candidate[nKey];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      return failAt(
        'STAGE_A_SCHEMA',
        'INVALID_NUMERIC_FIELD',
        `Policy field "${nKey}" must be a finite number.`
      );
    }
  }

  if (
    typeof candidate.policy_id !== 'string' ||
    candidate.policy_id.trim().length === 0 ||
    typeof candidate.policy_version !== 'string' ||
    !parseSemver(candidate.policy_version) ||
    typeof candidate.git_sha !== 'string' ||
    !Array.isArray(candidate.target_kernels) ||
    candidate.target_kernels.length === 0 ||
    typeof candidate.kernel_contracts !== 'object' ||
    Array.isArray(candidate.kernel_contracts)
  ) {
    return failAt(
      'STAGE_A_SCHEMA',
      'MALFORMED_METADATA_TYPES',
      'Policy metadata (policy_id, semver policy_version, git_sha, target_kernels, kernel_contracts) failed schema validation.'
    );
  }

  const parsedPolicy: GitOpsPolicyDocument = Object.freeze({
    policy_id: String(candidate.policy_id),
    policy_version: String(candidate.policy_version),
    git_sha: String(candidate.git_sha),
    max_daily_loss_pct: Number(candidate.max_daily_loss_pct),
    slippage_bps: Number(candidate.slippage_bps),
    participation_cap_pct: Number(candidate.participation_cap_pct),
    max_open_positions: Number(candidate.max_open_positions),
    mandate_duration_hours: Number(candidate.mandate_duration_hours),
    atr_multiplier: Number(candidate.atr_multiplier),
    module_drawdown_limit_pct: Number(candidate.module_drawdown_limit_pct),
    portfolio_drawdown_limit_pct: Number(candidate.portfolio_drawdown_limit_pct),
    target_kernels: Object.freeze((candidate.target_kernels as unknown[]).map((k) => String(k))),
    kernel_contracts: Object.freeze(
      Object.entries(candidate.kernel_contracts as Record<string, unknown>).reduce<Record<string, string>>(
        (acc, [k, v]) => {
          acc[k] = String(v);
          return acc;
        },
        {}
      )
    ),
  });
  completedStages.push('STAGE_A_SCHEMA');

  // ── Stage (b): Semantic Validation ────────────────────────────────────────
  if (injector?.failStage === 'STAGE_B_SEMANTIC') {
    return failAt('STAGE_B_SEMANTIC', 'INJECTED_FAULT', injector.reason ?? 'Injected semantic stage fault.');
  }

  if (!/^[0-9a-f]{7,40}$/i.test(parsedPolicy.git_sha)) {
    return failAt(
      'STAGE_B_SEMANTIC',
      'INVALID_GIT_SHA',
      `git_sha "${parsedPolicy.git_sha}" must be a valid 7-40 char hexadecimal Git commit SHA.`
    );
  }

  if (!Number.isInteger(parsedPolicy.max_open_positions)) {
    return failAt(
      'STAGE_B_SEMANTIC',
      'NON_INTEGER_POSITION_LIMIT',
      'max_open_positions must be an integer count.'
    );
  }

  if (
    parsedPolicy.module_drawdown_limit_pct < 3.0 ||
    parsedPolicy.module_drawdown_limit_pct > 5.0
  ) {
    return failAt(
      'STAGE_B_SEMANTIC',
      'MODULE_DD_OUT_OF_BAND',
      `module_drawdown_limit_pct=${parsedPolicy.module_drawdown_limit_pct} must reside inside [3.0, 5.0]%.`
    );
  }

  if (
    parsedPolicy.portfolio_drawdown_limit_pct < 10.0 ||
    parsedPolicy.portfolio_drawdown_limit_pct > 15.0
  ) {
    return failAt(
      'STAGE_B_SEMANTIC',
      'PORTFOLIO_DD_OUT_OF_BAND',
      `portfolio_drawdown_limit_pct=${parsedPolicy.portfolio_drawdown_limit_pct} must reside inside [10.0, 15.0]%.`
    );
  }

  for (const kId of parsedPolicy.target_kernels) {
    if (!kId.endsWith('-Kernel')) {
      return failAt(
        'STAGE_B_SEMANTIC',
        'INVALID_KERNEL_NAMING',
        `Target kernel "${kId}" must end with "-Kernel" suffix.`
      );
    }
    if (!parsedPolicy.kernel_contracts[kId]) {
      return failAt(
        'STAGE_B_SEMANTIC',
        'MISSING_KERNEL_CONTRACT_PIN',
        `Policy target kernel "${kId}" lacks a corresponding entry in kernel_contracts.`
      );
    }
  }
  completedStages.push('STAGE_B_SEMANTIC');

  // ── Stage (c): Kernel Ceiling Enforcement ─────────────────────────────────
  if (injector?.failStage === 'STAGE_C_CEILING') {
    return failAt('STAGE_C_CEILING', 'INJECTED_FAULT', injector.reason ?? 'Injected ceiling stage fault.');
  }

  if (parsedPolicy.max_daily_loss_pct <= 0 || parsedPolicy.max_daily_loss_pct > KERNEL_CEILINGS.max_daily_loss_pct) {
    return failAt(
      'STAGE_C_CEILING',
      'CEILING_BREACH_DAILY_LOSS',
      `max_daily_loss_pct=${parsedPolicy.max_daily_loss_pct} violates kernel ceiling <= ${KERNEL_CEILINGS.max_daily_loss_pct}%.`
    );
  }

  if (parsedPolicy.slippage_bps <= 0 || parsedPolicy.slippage_bps > KERNEL_CEILINGS.slippage_bps) {
    return failAt(
      'STAGE_C_CEILING',
      'CEILING_BREACH_SLIPPAGE',
      `slippage_bps=${parsedPolicy.slippage_bps} violates kernel ceiling <= ${KERNEL_CEILINGS.slippage_bps} bps.`
    );
  }

  if (
    parsedPolicy.participation_cap_pct <= 0 ||
    parsedPolicy.participation_cap_pct > KERNEL_CEILINGS.participation_cap_pct
  ) {
    return failAt(
      'STAGE_C_CEILING',
      'CEILING_BREACH_PARTICIPATION',
      `participation_cap_pct=${parsedPolicy.participation_cap_pct} violates kernel ceiling <= ${KERNEL_CEILINGS.participation_cap_pct}% of bar volume.`
    );
  }

  if (
    parsedPolicy.max_open_positions < 1 ||
    parsedPolicy.max_open_positions > KERNEL_CEILINGS.max_open_positions
  ) {
    return failAt(
      'STAGE_C_CEILING',
      'CEILING_BREACH_OPEN_POSITIONS',
      `max_open_positions=${parsedPolicy.max_open_positions} violates kernel ceiling <= ${KERNEL_CEILINGS.max_open_positions}.`
    );
  }

  if (
    parsedPolicy.mandate_duration_hours <= 0 ||
    parsedPolicy.mandate_duration_hours > KERNEL_CEILINGS.mandate_duration_hours
  ) {
    return failAt(
      'STAGE_C_CEILING',
      'CEILING_BREACH_MANDATE_DURATION',
      `mandate_duration_hours=${parsedPolicy.mandate_duration_hours} violates kernel ceiling <= ${KERNEL_CEILINGS.mandate_duration_hours}h.`
    );
  }

  if (
    parsedPolicy.atr_multiplier < KERNEL_CEILINGS.atr_multiplier_min ||
    parsedPolicy.atr_multiplier > KERNEL_CEILINGS.atr_multiplier_max
  ) {
    return failAt(
      'STAGE_C_CEILING',
      'CEILING_BREACH_ATR_MULTIPLIER',
      `atr_multiplier=${parsedPolicy.atr_multiplier} falls outside kernel envelope [${KERNEL_CEILINGS.atr_multiplier_min}, ${KERNEL_CEILINGS.atr_multiplier_max}].`
    );
  }
  completedStages.push('STAGE_C_CEILING');

  // ── Stage (d): Contract Version Compatibility & Signature Check ───────────
  if (injector?.failStage === 'STAGE_D_CONTRACT_VERSION') {
    return failAt(
      'STAGE_D_CONTRACT_VERSION',
      'INJECTED_FAULT',
      injector.reason ?? 'Injected contract version stage fault.'
    );
  }

  const registryMap = new Map<string, SignedKernelArtifact>();
  for (const k of registry) {
    if (!verifyKernelArtifactSignature(k)) {
      return failAt(
        'STAGE_D_CONTRACT_VERSION',
        'INVALID_KERNEL_SIGNATURE',
        `Kernel artifact "${k.kernelId}" failed cryptographic signature or SHA-256 verification.`
      );
    }
    registryMap.set(k.kernelId, k);
  }

  const boundKernels: SignedKernelArtifact[] = [];
  for (const targetId of parsedPolicy.target_kernels) {
    const regKernel = registryMap.get(targetId);
    if (!regKernel) {
      return failAt(
        'STAGE_D_CONTRACT_VERSION',
        'UNREGISTERED_KERNEL',
        `Target kernel "${targetId}" is absent from signed KERNEL_REGISTRY.`
      );
    }
    const requestedVerStr = parsedPolicy.kernel_contracts[targetId];
    const reqVer = parseSemver(requestedVerStr);
    const actualVer = parseSemver(regKernel.contractSemver);
    if (!reqVer || !actualVer) {
      return failAt(
        'STAGE_D_CONTRACT_VERSION',
        'INVALID_SEMVER_CONTRACT',
        `Invalid semver contract string for "${targetId}".`
      );
    }
    const majorMatch = reqVer.major === actualVer.major;
    const minorCompatible = reqVer.minor <= actualVer.minor;
    if (!majorMatch || !minorCompatible) {
      return failAt(
        'STAGE_D_CONTRACT_VERSION',
        'CONTRACT_VERSION_INCOMPATIBLE',
        `Contract mismatch for "${targetId}": policy requires ${requestedVerStr}, kernel provides ${regKernel.contractSemver}.`
      );
    }
    boundKernels.push(regKernel);
  }
  completedStages.push('STAGE_D_CONTRACT_VERSION');

  // ── Stage (e): kernel_hash + policy_hash Computation ──────────────────────
  if (injector?.failStage === 'STAGE_E_HASHING') {
    return failAt(
      'STAGE_E_HASHING',
      'INJECTED_FAULT',
      injector.reason ?? 'Injected digest computation stage fault.'
    );
  }

  const computedTriple: BindingTriple = Object.freeze({
    kernel_hash: computeKernelSetDigest(boundKernels),
    policy_hash: computePolicyDigest(parsedPolicy),
    git_sha: parsedPolicy.git_sha,
  });
  completedStages.push('STAGE_E_HASHING');

  // ── Stage (f): Drift Detection Against Registered Known-Good Triples ──────
  if (injector?.failStage === 'STAGE_F_DRIFT') {
    return failAt(
      'STAGE_F_DRIFT',
      'INJECTED_FAULT',
      injector.reason ?? 'Injected drift detection stage fault.',
      computedTriple,
      boundKernels.length
    );
  }

  const sameShaKnown = knownGoodTriples.filter((t) => t.git_sha === computedTriple.git_sha);
  if (sameShaKnown.length > 0) {
    const exactMatch = sameShaKnown.some(
      (t) =>
        t.kernel_hash === computedTriple.kernel_hash &&
        t.policy_hash === computedTriple.policy_hash
    );
    if (!exactMatch) {
      return failAt(
        'STAGE_F_DRIFT',
        'TRIPLE_HASH_DRIFT_DETECTED',
        `Hash drift for git_sha=${computedTriple.git_sha}: computed (${computedTriple.kernel_hash.slice(0, 10)}, ${computedTriple.policy_hash.slice(0, 10)}) diverges from registered known-good triple.`,
        computedTriple,
        boundKernels.length
      );
    }
  } else if (requireKnownGoodTriple) {
    const exactAnywhere = knownGoodTriples.some(
      (t) =>
        t.kernel_hash === computedTriple.kernel_hash &&
        t.policy_hash === computedTriple.policy_hash &&
        t.git_sha === computedTriple.git_sha
    );
    if (!exactAnywhere) {
      return failAt(
        'STAGE_F_DRIFT',
        'UNREGISTERED_GITOPS_TRIPLE',
        `Binding triple (git_sha=${computedTriple.git_sha}) is not registered in KNOWN_GOOD_BINDING_TRIPLES.`,
        computedTriple,
        boundKernels.length
      );
    }
  }
  completedStages.push('STAGE_F_DRIFT');

  // ── Stage (g): Audit Emission ─────────────────────────────────────────────
  if (injector?.failStage === 'STAGE_G_AUDIT') {
    return failAt(
      'STAGE_G_AUDIT',
      'INJECTED_FAULT',
      injector.reason ?? 'Injected audit emission stage fault.',
      computedTriple,
      boundKernels.length
    );
  }

  const auditId = `bind_ok_${sha256Hex(
    `${timestampUtc}|${computedTriple.kernel_hash}|${computedTriple.policy_hash}|${computedTriple.git_sha}`
  ).slice(0, 16)}`;

  const completedAll: ReadonlyArray<BindingStageId> = Object.freeze([
    ...completedStages,
    'STAGE_G_AUDIT' as const,
  ]);
  const successAudit: BindingAuditRecord = Object.freeze({
    auditId,
    timestampUtc,
    environment: options.environment,
    status: 'BOUND_START_ALLOWED',
    completedStages: completedAll,
    failedStage: null,
    failureCode: null,
    failureMessage: null,
    triple: computedTriple,
    boundKernelCount: boundKernels.length,
  });

  if (options.auditSink) {
    try {
      options.auditSink(successAudit);
    } catch (err) {
      return failAt(
        'STAGE_G_AUDIT',
        'AUDIT_SINK_WRITE_FAILED',
        `Audit sink failed to persist binding proof (fail-closed): ${err instanceof Error ? err.message : String(err)}`,
        computedTriple,
        boundKernels.length
      );
    }
  }

  return Object.freeze({
    bound: true,
    processStartAllowed: true,
    environment: options.environment,
    triple: computedTriple,
    boundPolicy: parsedPolicy,
    boundKernels: Object.freeze(boundKernels),
    audit: successAudit,
  });
}

export function assertBootBindingOrThrow(
  rawPolicy: unknown,
  options: BindPolicyOptions
): BindingLayerResult {
  const result = bindPolicyToKernels(rawPolicy, options);
  if (!result.bound || !result.processStartAllowed || result.audit.status !== 'BOUND_START_ALLOWED') {
    throw new BindingFailClosedError(
      result.audit.failedStage ?? 'STAGE_A_SCHEMA',
      result.audit.failureCode ?? 'FAIL_CLOSED_BOOT_HALT',
      result.audit.failureMessage ?? 'Binding Layer refused process startup.',
      result.audit
    );
  }
  return result;
}

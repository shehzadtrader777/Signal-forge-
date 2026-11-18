import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  BindingFailClosedError,
  COMPONENT_CLASSIFICATION_MATRIX,
  DEFAULT_GITOPS_POLICY,
  FIXED_MIN_RR_CONSTANT,
  KERNEL_CEILINGS,
  KERNEL_CEILING_TABLE,
  KERNEL_REGISTRY,
  KERNEL_REGISTRY_BY_ID,
  KNOWN_GOOD_BINDING_TRIPLES,
  ORDERED_BINDING_STAGES,
  assertBootBindingOrThrow,
  bindPolicyToKernels,
  classifyByWeightedCriteria,
  verifyKernelArtifactSignature,
  type BindingAuditRecord,
  type GitOpsPolicyDocument,
  type SignedKernelArtifact,
} from './bindingLayer';

const ROOT_DIR = path.resolve(import.meta.dirname, '..', '..');

const CANONICAL_41_INVARIANT_IDS = [
  'I-RR1', 'I-RR2', 'I-RR3',
  'I-SS1', 'I-SS2', 'I-SS3', 'I-SS4',
  'I-TS1', 'I-TS2', 'I-TS3', 'I-TS4', 'I-TS5',
  'I-SC1', 'I-SC2', 'I-SC3', 'I-SC4', 'I-SC5',
  'I-RC1', 'I-RC2', 'I-RC3',
  'I-SMC1', 'I-SMC2',
  'I-OF1', 'I-OF2',
  'I-OP1', 'I-OP2',
  'I-AIDE1', 'I-AIDE2', 'I-AIDE3',
  'I-CI1', 'I-CI2',
  'I-MS1', 'I-MS2', 'I-MS3', 'I-MS4',
  'I-AA1', 'I-AA2', 'I-AA3', 'I-AA4', 'I-AA5',
  'I-G1',
] as const;

test('Kernel Registry signs all -Kernel artifacts, pins SHA-256 digests, and registers all 41 invariants', () => {
  assert.ok(KERNEL_REGISTRY.length >= 13, 'Expected all 13 canonical kernels');
  const registeredInvariants = new Set<string>();

  for (const kernel of KERNEL_REGISTRY) {
    assert.ok(kernel.kernelId.endsWith('-Kernel'), `Kernel ${kernel.kernelId} must use -Kernel suffix`);
    assert.equal(verifyKernelArtifactSignature(kernel), true, `Signature verification failed for ${kernel.kernelId}`);
    assert.match(kernel.sha256Digest, /^[0-9a-f]{64}$/);
    assert.match(kernel.contractSemver, /^\d+\.\d+\.\d+$/);
    for (const invId of kernel.invariantManifest) {
      assert.ok(invId.startsWith('I-'), `Invariant ${invId} must use I- prefix`);
      registeredInvariants.add(invId);
    }
  }

  for (const invId of CANONICAL_41_INVARIANT_IDS) {
    assert.equal(
      registeredInvariants.has(invId),
      true,
      `Missing canonical invariant ${invId} from KERNEL_REGISTRY`
    );
  }
  assert.equal(KERNEL_REGISTRY_BY_ID['RRGate-Kernel']?.fixedConstants.min_rr, 5);
});

test('Kernel Ceiling Table is code-enforced with complete rationales and forbids min_rr in policy files', () => {
  assert.equal(KERNEL_CEILINGS.max_daily_loss_pct, 5.0);
  assert.equal(KERNEL_CEILINGS.slippage_bps, 50);
  assert.equal(KERNEL_CEILINGS.participation_cap_pct, 5.0);
  assert.equal(KERNEL_CEILINGS.max_open_positions, 20);
  assert.equal(KERNEL_CEILINGS.mandate_duration_hours, 24);
  assert.equal(KERNEL_CEILINGS.atr_multiplier_min, 1.0);
  assert.equal(KERNEL_CEILINGS.atr_multiplier_max, 3.5);
  assert.equal(KERNEL_CEILINGS.min_rr_fixed, 5);
  assert.equal(FIXED_MIN_RR_CONSTANT, 5);

  assert.equal(KERNEL_CEILING_TABLE.length, 7);
  for (const entry of KERNEL_CEILING_TABLE) {
    assert.ok(entry.rationale.trim().length >= 20, `Ceiling ${entry.policyKey} requires rationale`);
    assert.ok(entry.ownerKernel.endsWith('-Kernel'));
  }

  const minRrCeiling = KERNEL_CEILING_TABLE.find((e) => e.policyKey === 'min_rr');
  assert.equal(minRrCeiling?.isPolicyConfigurable, false);
  assert.equal(minRrCeiling?.fixedKernelConstant, 5);

  // Verify GitOps policy JSON file committed in /policies carries zero min_rr key
  const policyJsonRaw = fs.readFileSync(path.resolve(ROOT_DIR, 'policies/force-signal.policy.json'), 'utf8');
  const parsedPolicy = JSON.parse(policyJsonRaw) as Record<string, unknown>;
  assert.equal('min_rr' in parsedPolicy, false, 'policies/force-signal.policy.json must not declare min_rr');
  assert.equal('min_rr_ratio' in parsedPolicy, false, 'policies/force-signal.policy.json must not declare min_rr_ratio');
});

test('Component Classification Matrix assigns every subsystem and forces KERNEL whenever determinism or failClosed >= 4', () => {
  assert.ok(COMPONENT_CLASSIFICATION_MATRIX.length >= 16);
  const classifications = new Set(COMPONENT_CLASSIFICATION_MATRIX.map((c) => c.classification));
  assert.equal(classifications.has('KERNEL'), true);
  assert.equal(classifications.has('BINDING'), true);
  assert.equal(classifications.has('POLICY'), true);

  for (const item of COMPONENT_CLASSIFICATION_MATRIX) {
    if (item.scores.determinism >= 4 || item.scores.failClosed >= 4) {
      assert.equal(item.classification, 'KERNEL', `${item.subsystemId} scored >=4 on determinism/failClosed and must be KERNEL`);
      assert.equal(item.forcedKernelByHardRule, true);
    }
  }

  // Direct verification of the hard rule when intendedRole is POLICY but determinism=4
  const coerced = classifyByWeightedCriteria(
    {
      blastRadius: 1,
      determinism: 4,
      failClosed: 2,
      auditability: 2,
      expressivenessCeiling: 1,
      changeAuthority: 1,
      testability: 2,
    },
    'POLICY'
  );
  assert.equal(coerced.classification, 'KERNEL');
  assert.equal(coerced.forcedKernelByHardRule, true);
});

test('Schema test: malformed policy causes Binding Layer to fail closed and refuse startup', () => {
  const malformedInputs: unknown[] = [
    null,
    'not-an-object',
    { policy_id: 'broken' },
    { ...DEFAULT_GITOPS_POLICY, max_daily_loss_pct: Number.NaN },
    { ...DEFAULT_GITOPS_POLICY, rogueUnknownKey: 123 },
    { ...DEFAULT_GITOPS_POLICY, CamelCaseKey: 1 },
  ];

  for (const bad of malformedInputs) {
    const res = bindPolicyToKernels(bad, { environment: 'staging' });
    assert.equal(res.bound, false);
    assert.equal(res.processStartAllowed, false);
    assert.equal(res.audit.status, 'FAILED_CLOSED_HALT');
    assert.equal(res.audit.failedStage, 'STAGE_A_SCHEMA');
    assert.throws(() => assertBootBindingOrThrow(bad, { environment: 'production' }), BindingFailClosedError);
  }
});

test('Immutability test: policy carrying min_rr key (at root or nested) is hard-rejected', () => {
  const withMinRr = {
    ...DEFAULT_GITOPS_POLICY,
    min_rr: 5,
  };
  const res = bindPolicyToKernels(withMinRr, { environment: 'production' });
  assert.equal(res.bound, false);
  assert.equal(res.processStartAllowed, false);
  assert.equal(res.audit.failureCode, 'IMMUTABLE_MIN_RR_FORBIDDEN');
  assert.throws(() => assertBootBindingOrThrow(withMinRr, { environment: 'staging' }), BindingFailClosedError);
});

test('Ceiling test: policy exceeding kernel ceilings (e.g. max_daily_loss_pct = 7) is rejected', () => {
  const breaches: Array<Partial<GitOpsPolicyDocument>> = [
    { max_daily_loss_pct: 7.0 },
    { slippage_bps: 75 },
    { participation_cap_pct: 8.0 },
    { max_open_positions: 25 },
    { mandate_duration_hours: 48 },
    { atr_multiplier: 4.2 },
    { atr_multiplier: 0.7 },
  ];

  for (const patch of breaches) {
    const policy = { ...DEFAULT_GITOPS_POLICY, ...patch };
    const res = bindPolicyToKernels(policy, {
      environment: 'staging',
      requireKnownGoodTriple: false,
      knownGoodTriples: [],
    });
    assert.equal(res.bound, false);
    assert.equal(res.processStartAllowed, false);
    assert.equal(res.audit.failedStage, 'STAGE_C_CEILING');
  }
});

test('Contract version & drift tests detect tampered kernel signatures, incompatible semver, and triple drift', () => {
  // Incompatible major contract version
  const badContract: GitOpsPolicyDocument = {
    ...DEFAULT_GITOPS_POLICY,
    kernel_contracts: {
      ...DEFAULT_GITOPS_POLICY.kernel_contracts,
      'RRGate-Kernel': '2.0.0',
    },
  };
  const verRes = bindPolicyToKernels(badContract, {
    environment: 'production',
    requireKnownGoodTriple: false,
    knownGoodTriples: [],
  });
  assert.equal(verRes.bound, false);
  assert.equal(verRes.audit.failedStage, 'STAGE_D_CONTRACT_VERSION');
  assert.equal(verRes.audit.failureCode, 'CONTRACT_VERSION_INCOMPATIBLE');

  // Tampered kernel digest in registry fails Stage D signature verify
  const tamperedRegistry: SignedKernelArtifact[] = KERNEL_REGISTRY.map((k) =>
    k.kernelId === 'RRGate-Kernel'
      ? Object.freeze({ ...k, sha256Digest: '0'.repeat(64) })
      : k
  );
  const sigRes = bindPolicyToKernels(DEFAULT_GITOPS_POLICY, {
    environment: 'production',
    kernelRegistry: tamperedRegistry,
  });
  assert.equal(sigRes.bound, false);
  assert.equal(sigRes.audit.failedStage, 'STAGE_D_CONTRACT_VERSION');
  assert.equal(sigRes.audit.failureCode, 'INVALID_KERNEL_SIGNATURE');

  // Modified policy with same git_sha triggers Stage F hash drift detection
  const driftedPolicy: GitOpsPolicyDocument = {
    ...DEFAULT_GITOPS_POLICY,
    slippage_bps: 22,
  };
  const driftRes = bindPolicyToKernels(driftedPolicy, { environment: 'production' });
  assert.equal(driftRes.bound, false);
  assert.equal(driftRes.audit.failedStage, 'STAGE_F_DRIFT');
  assert.equal(driftRes.audit.failureCode, 'TRIPLE_HASH_DRIFT_DETECTED');
});

test('Fail-closed test: injecting a failure into ANY of the 7 ordered validation stages halts startup', () => {
  assert.equal(ORDERED_BINDING_STAGES.length, 7);

  for (const stage of ORDERED_BINDING_STAGES) {
    const audits: BindingAuditRecord[] = [];
    const res = bindPolicyToKernels(DEFAULT_GITOPS_POLICY, {
      environment: 'production',
      faultInjector: { failStage: stage, reason: `Simulated fault at ${stage}` },
      auditSink: (rec) => audits.push(rec),
    });

    assert.equal(res.bound, false, `Expected stage ${stage} fault to block binding`);
    assert.equal(res.processStartAllowed, false, `Expected stage ${stage} fault to block startup`);
    assert.equal(res.audit.status, 'FAILED_CLOSED_HALT');
    assert.equal(res.audit.failedStage, stage);
    assert.equal(audits.length, 1);

    assert.throws(
      () =>
        assertBootBindingOrThrow(DEFAULT_GITOPS_POLICY, {
          environment: 'production',
          faultInjector: { failStage: stage },
        }),
      BindingFailClosedError
    );
  }

  // Stage (g) audit sink exception must also fail closed
  const sinkFailRes = bindPolicyToKernels(DEFAULT_GITOPS_POLICY, {
    environment: 'production',
    auditSink: (rec) => {
      if (rec.status === 'BOUND_START_ALLOWED') {
        throw new Error('Immutable WORM ledger unavailable');
      }
    },
  });
  assert.equal(sinkFailRes.bound, false);
  assert.equal(sinkFailRes.processStartAllowed, false);
  assert.equal(sinkFailRes.audit.failedStage, 'STAGE_G_AUDIT');
});

test('Environment Parity test: GitOps policy binds identically in staging and production with matching (kernel_hash, policy_hash, git_sha) triple', () => {
  const filePolicy = JSON.parse(
    fs.readFileSync(path.resolve(ROOT_DIR, 'policies/force-signal.policy.json'), 'utf8')
  ) as unknown;

  const stagingResult = assertBootBindingOrThrow(filePolicy, {
    environment: 'staging',
    timestampUtc: '2026-11-17T13:20:00.000Z',
  });
  const productionResult = assertBootBindingOrThrow(filePolicy, {
    environment: 'production',
    timestampUtc: '2026-11-17T13:20:00.000Z',
  });

  assert.equal(stagingResult.bound, true);
  assert.equal(productionResult.bound, true);
  assert.equal(stagingResult.processStartAllowed, true);
  assert.equal(productionResult.processStartAllowed, true);
  assert.deepEqual(stagingResult.triple, productionResult.triple);
  assert.deepEqual(stagingResult.triple, KNOWN_GOOD_BINDING_TRIPLES[0]);
  assert.equal(stagingResult.boundKernels.length, KERNEL_REGISTRY.length);
  assert.equal(productionResult.boundKernels.length, KERNEL_REGISTRY.length);
  assert.deepEqual(stagingResult.audit.completedStages, ORDERED_BINDING_STAGES);
});

import { sha256Hex, canonicalStringify } from './bindingLayer';

/* ═══════════════════════════════════════════════════════════════════════════
 * FORCE SIGNAL — RUNTIME GUARD KERNEL (COMMAND 2)
 * Synchronous Security & Environment Isolation Gate Inside Execution Egress.
 * - Four Frozen Startup Profiles (Never Switchable at Runtime)
 * - Default-Deny Non-Persistent Out-of-Band LIVE_MANDATE = 'NOT_GRANTED'
 * - Five-Step Ordered Guard Resolution
 * - Six-Layer Anti-Mismatch Defense
 * - Strict Binance Key Policy & Typed Guard Denial Rendering Contract
 * ═══════════════════════════════════════════════════════════════════════════ */

export type GuardProfileId = 'Paper-Read' | 'Paper-Trade' | 'Live-Read' | 'Live-Trade';
export type GuardEnvironment = 'TESTNET' | 'LIVE';
export type CredentialNamespace = 'TESTNET_NS' | 'LIVE_NS';
export type BinanceKeyTier = 'READ_ONLY' | 'TRADE';
export type GuardOperationKind = 'READ_MARKET' | 'READ_ACCOUNT' | 'PLACE_ORDER' | 'CANCEL_ORDER';
export type MandateVenue = 'BINANCE_SPOT' | 'BINANCE_USD_M_FUTURES';

export const DEFAULT_LIVE_MANDATE = 'NOT_GRANTED' as const;

export type GuardResolutionStepId =
  | 'STEP_1_PROFILE_VALIDITY'
  | 'STEP_2_HOST_CREDENTIAL_CONSISTENCY'
  | 'STEP_3_CAPABILITY_CHECK'
  | 'STEP_4_MANDATE_CHECK'
  | 'STEP_5_RECONCILIATION_PRECONDITION';

export const ORDERED_GUARD_STEPS: ReadonlyArray<GuardResolutionStepId> = Object.freeze([
  'STEP_1_PROFILE_VALIDITY',
  'STEP_2_HOST_CREDENTIAL_CONSISTENCY',
  'STEP_3_CAPABILITY_CHECK',
  'STEP_4_MANDATE_CHECK',
  'STEP_5_RECONCILIATION_PRECONDITION',
]);

export type AntiMismatchLayerId =
  | 'LAYER_1_CREDENTIAL_NAMESPACE'
  | 'LAYER_2_PROFILE_RESOLUTION'
  | 'LAYER_3_GUARD_CAPABILITY'
  | 'LAYER_4_MANDATE_CHECK'
  | 'LAYER_5_ADAPTER_HOST_ASSERTION'
  | 'LAYER_6_NETWORK_EGRESS_POLICY';

export const ORDERED_DEFENSE_LAYERS: ReadonlyArray<AntiMismatchLayerId> = Object.freeze([
  'LAYER_1_CREDENTIAL_NAMESPACE',
  'LAYER_2_PROFILE_RESOLUTION',
  'LAYER_3_GUARD_CAPABILITY',
  'LAYER_4_MANDATE_CHECK',
  'LAYER_5_ADAPTER_HOST_ASSERTION',
  'LAYER_6_NETWORK_EGRESS_POLICY',
]);

export type GuardDenialCode =
  | 'UNRESOLVED_STARTUP_PROFILE'
  | 'RUNTIME_PROFILE_SWITCH_FORBIDDEN'
  | 'TESTNET_KEY_ON_LIVE_HOST'
  | 'LIVE_KEY_ON_TESTNET_HOST'
  | 'CREDENTIAL_NAMESPACE_MISMATCH'
  | 'KEY_WITHDRAWALS_ENABLED'
  | 'LIVE_IP_ALLOWLIST_MISSING'
  | 'KEY_TIERS_NOT_DISTINCT'
  | 'READ_ONLY_PROFILE_WRITE_BLOCKED'
  | 'MISSING_TRADE_KEY_FOR_ORDER'
  | 'LIVE_WRITE_REQUIRES_MANDATE'
  | 'MANDATE_WINDOW_INACTIVE'
  | 'MANDATE_SYMBOL_NOT_SCOPED'
  | 'MANDATE_VENUE_MISMATCH'
  | 'ADAPTER_HOST_MISMATCH'
  | 'CONTAINER_EGRESS_BLOCKED'
  | 'RECONCILIATION_PRECONDITION_FAILED';

/* ── 1. Four-Profile Frozen Model ─────────────────────────────────────────── */

export interface FrozenGuardProfileSpec {
  readonly id: GuardProfileId;
  readonly environment: GuardEnvironment;
  readonly credentialNamespace: CredentialNamespace;
  readonly keyTier: BinanceKeyTier;
  readonly primaryHost: 'testnet.binance.vision' | 'api.binance.com';
  readonly allowedHosts: ReadonlyArray<string>;
  readonly forbiddenHosts: ReadonlyArray<string>;
  readonly canPlaceOrders: boolean;
  readonly requiresMandate: boolean;
  readonly immutableAtRuntime: true;
  readonly description: string;
}

export const FOUR_PROFILE_CATALOG: Readonly<Record<GuardProfileId, FrozenGuardProfileSpec>> = Object.freeze({
  'Paper-Read': Object.freeze({
    id: 'Paper-Read',
    environment: 'TESTNET',
    credentialNamespace: 'TESTNET_NS',
    keyTier: 'READ_ONLY',
    primaryHost: 'testnet.binance.vision',
    allowedHosts: Object.freeze(['testnet.binance.vision', 'testnet.binancefuture.com']),
    forbiddenHosts: Object.freeze(['api.binance.com', 'fapi.binance.com']),
    canPlaceOrders: false,
    requiresMandate: false,
    immutableAtRuntime: true,
    description: 'Testnet host + Testnet read-only key; order placement forbidden; no mandate required.',
  }),
  'Paper-Trade': Object.freeze({
    id: 'Paper-Trade',
    environment: 'TESTNET',
    credentialNamespace: 'TESTNET_NS',
    keyTier: 'TRADE',
    primaryHost: 'testnet.binance.vision',
    allowedHosts: Object.freeze(['testnet.binance.vision', 'testnet.binancefuture.com']),
    forbiddenHosts: Object.freeze(['api.binance.com', 'fapi.binance.com']),
    canPlaceOrders: true,
    requiresMandate: false,
    immutableAtRuntime: true,
    description: 'Testnet host + Testnet trade key; order placement enabled on testnet; no mandate required.',
  }),
  'Live-Read': Object.freeze({
    id: 'Live-Read',
    environment: 'LIVE',
    credentialNamespace: 'LIVE_NS',
    keyTier: 'READ_ONLY',
    primaryHost: 'api.binance.com',
    allowedHosts: Object.freeze(['api.binance.com', 'fapi.binance.com']),
    forbiddenHosts: Object.freeze(['testnet.binance.vision', 'testnet.binancefuture.com']),
    canPlaceOrders: false,
    requiresMandate: false,
    immutableAtRuntime: true,
    description: 'Live host + Live read-only key; order placement forbidden; no mandate required.',
  }),
  'Live-Trade': Object.freeze({
    id: 'Live-Trade',
    environment: 'LIVE',
    credentialNamespace: 'LIVE_NS',
    keyTier: 'TRADE',
    primaryHost: 'api.binance.com',
    allowedHosts: Object.freeze(['api.binance.com', 'fapi.binance.com']),
    forbiddenHosts: Object.freeze(['testnet.binance.vision', 'testnet.binancefuture.com']),
    canPlaceOrders: true,
    requiresMandate: true,
    immutableAtRuntime: true,
    description: 'Live host + Live trade key; order placement permitted strictly with explicit out-of-band LIVE_MANDATE.',
  }),
});

/* ── 2. Binance Credential & Key Policy Model ─────────────────────────────── */

export interface BinanceCredentialMetadata {
  readonly namespace: CredentialNamespace;
  readonly keyEnvironment: GuardEnvironment;
  readonly keyTier: BinanceKeyTier;
  readonly readOnlyKeyId: string;
  readonly tradeKeyId: string | null;
  readonly withdrawalsEnabled: boolean;
  readonly ipAllowlistConfigured: boolean;
}

export function buildDefaultCredentialMetadata(profileId: GuardProfileId): BinanceCredentialMetadata {
  const spec = FOUR_PROFILE_CATALOG[profileId];
  const isLive = spec.environment === 'LIVE';
  return Object.freeze({
    namespace: spec.credentialNamespace,
    keyEnvironment: spec.environment,
    keyTier: spec.keyTier,
    readOnlyKeyId: isLive ? 'binance_live_ro_key_v1' : 'binance_testnet_ro_key_v1',
    tradeKeyId:
      spec.keyTier === 'TRADE'
        ? isLive
          ? 'binance_live_trade_key_v1'
          : 'binance_testnet_trade_key_v1'
        : null,
    withdrawalsEnabled: false,
    ipAllowlistConfigured: true,
  });
}

/* ── 3. Non-Persistent Out-of-Band Mandate Model ──────────────────────────── */

export interface LiveMandateGrant {
  readonly status: 'GRANTED';
  readonly venue: MandateVenue;
  readonly symbolSet: ReadonlyArray<string>;
  readonly startsAtUtc: string;
  readonly expiresAtUtc: string;
  readonly source: 'ENV_OUT_OF_BAND' | 'SECRET_MANAGER_OUT_OF_BAND';
  readonly signerDigest: string;
}

export type LiveMandateState = typeof DEFAULT_LIVE_MANDATE | LiveMandateGrant;

export interface MandateAuditEntry {
  readonly auditId: string;
  readonly timestampUtc: string;
  readonly activeProfile: GuardProfileId;
  readonly operation: GuardOperationKind;
  readonly venue: MandateVenue;
  readonly symbol: string;
  readonly decision: 'ALLOW' | 'DENY';
  readonly reasonCode: string;
  readonly mandateState: 'NOT_GRANTED' | 'GRANTED' | 'EXPIRED' | 'SYMBOL_MISMATCH' | 'VENUE_MISMATCH';
}

export function resolveLiveMandateFromEnvironment(
  envRecord?: Readonly<Record<string, string | undefined>>
): LiveMandateState {
  if (!envRecord) return DEFAULT_LIVE_MANDATE;
  const raw = envRecord.LIVE_MANDATE;
  if (!raw || raw.trim() === '' || raw.trim() === DEFAULT_LIVE_MANDATE) {
    return DEFAULT_LIVE_MANDATE;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LiveMandateGrant>;
    if (
      parsed.status !== 'GRANTED' ||
      (parsed.venue !== 'BINANCE_SPOT' && parsed.venue !== 'BINANCE_USD_M_FUTURES') ||
      !Array.isArray(parsed.symbolSet) ||
      parsed.symbolSet.length === 0 ||
      typeof parsed.startsAtUtc !== 'string' ||
      typeof parsed.expiresAtUtc !== 'string' ||
      (parsed.source !== 'ENV_OUT_OF_BAND' && parsed.source !== 'SECRET_MANAGER_OUT_OF_BAND') ||
      typeof parsed.signerDigest !== 'string' ||
      parsed.signerDigest.length < 16
    ) {
      return DEFAULT_LIVE_MANDATE;
    }

    return Object.freeze({
      status: 'GRANTED',
      venue: parsed.venue,
      symbolSet: Object.freeze(parsed.symbolSet.map((s) => String(s).toUpperCase())),
      startsAtUtc: parsed.startsAtUtc,
      expiresAtUtc: parsed.expiresAtUtc,
      source: parsed.source,
      signerDigest: parsed.signerDigest,
    });
  } catch {
    return DEFAULT_LIVE_MANDATE;
  }
}

/* ── 4. Guard Denial Rendering Contract ───────────────────────────────────── */

export interface GuardDenialContract {
  readonly denied: true;
  readonly reasonCode: GuardDenialCode;
  readonly blockedByLayer: AntiMismatchLayerId;
  readonly blockedByStep: GuardResolutionStepId;
  readonly activeProfile: GuardProfileId;
  readonly message: string;
  readonly remediationHint: string;
  readonly timestampUtc: string;
}

export interface GuardResolutionResult {
  readonly allowed: boolean;
  readonly activeProfile: GuardProfileId;
  readonly profileSpec: FrozenGuardProfileSpec;
  readonly completedSteps: ReadonlyArray<GuardResolutionStepId>;
  readonly verifiedLayers: ReadonlyArray<AntiMismatchLayerId>;
  readonly denial: GuardDenialContract | null;
  readonly mandateAudit: MandateAuditEntry | null;
}

export interface ResolvedStartupProfileLock {
  readonly profileId: GuardProfileId;
  readonly spec: FrozenGuardProfileSpec;
  readonly credentials: BinanceCredentialMetadata;
  readonly resolvedAtUtc: string;
  readonly immutable: true;
  readonly digest: string;
}

export class RuntimeGuardBootError extends Error {
  readonly denial: GuardDenialContract;

  constructor(denial: GuardDenialContract) {
    super(`[RuntimeGuard:${denial.blockedByLayer}:${denial.reasonCode}] ${denial.message}`);
    this.name = 'RuntimeGuardBootError';
    this.denial = denial;
  }
}

/* ── 5. Layer-6 Container Network Egress Firewall Assertion ───────────────── */

export function extractHostnameFromEndpoint(endpointOrHost: string): string {
  const trimmed = endpointOrHost.trim();
  if (!trimmed) return '';
  if (!trimmed.includes('://')) {
    return trimmed.split('/')[0].split(':')[0].toLowerCase();
  }
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function assertContainerEgressAllowed(
  profileId: GuardProfileId,
  targetHostOrUrl: string,
  timestampUtc = new Date().toISOString()
): { readonly allowed: true; readonly host: string } | { readonly allowed: false; readonly denial: GuardDenialContract } {
  const spec = FOUR_PROFILE_CATALOG[profileId];
  const host = extractHostnameFromEndpoint(targetHostOrUrl);

  if (!host || spec.forbiddenHosts.includes(host) || !spec.allowedHosts.includes(host)) {
    return Object.freeze({
      allowed: false,
      denial: Object.freeze({
        denied: true,
        reasonCode: 'CONTAINER_EGRESS_BLOCKED',
        blockedByLayer: 'LAYER_6_NETWORK_EGRESS_POLICY',
        blockedByStep: 'STEP_2_HOST_CREDENTIAL_CONSISTENCY',
        activeProfile: profileId,
        message: `${profileId} container egress firewall blocked resolution/connection to host "${host || 'UNKNOWN'}".`,
        remediationHint: `Route strictly to allowed hosts (${spec.allowedHosts.join(', ')}) or redeploy in the matching environment container.`,
        timestampUtc,
      }),
    });
  }

  return Object.freeze({ allowed: true, host });
}

/* ── 6. Startup Profile Resolution (No Switch After Startup) ──────────────── */

export interface StartupGuardBootInput {
  readonly requestedProfile?: GuardProfileId | string;
  readonly targetHostOrUrl?: string;
  readonly credentials?: BinanceCredentialMetadata;
  readonly timestampUtc?: string;
}

function makeBootDenial(params: {
  profileId: GuardProfileId;
  reasonCode: GuardDenialCode;
  blockedByLayer: AntiMismatchLayerId;
  blockedByStep: GuardResolutionStepId;
  message: string;
  remediationHint: string;
  timestampUtc: string;
}): GuardDenialContract {
  return Object.freeze({
    denied: true,
    reasonCode: params.reasonCode,
    blockedByLayer: params.blockedByLayer,
    blockedByStep: params.blockedByStep,
    activeProfile: params.profileId,
    message: params.message,
    remediationHint: params.remediationHint,
    timestampUtc: params.timestampUtc,
  });
}

export function validateCredentialAgainstProfile(
  profileId: GuardProfileId,
  credentials: BinanceCredentialMetadata,
  targetHostOrUrl: string,
  timestampUtc = new Date().toISOString()
): GuardDenialContract | null {
  const spec = FOUR_PROFILE_CATALOG[profileId];
  const host = extractHostnameFromEndpoint(targetHostOrUrl);

  // Layer 1: Key Policy (Withdrawals disabled, IP allowlist for live, read-only vs trade distinct, namespace match)
  if (credentials.withdrawalsEnabled) {
    return makeBootDenial({
      profileId,
      reasonCode: 'KEY_WITHDRAWALS_ENABLED',
      blockedByLayer: 'LAYER_1_CREDENTIAL_NAMESPACE',
      blockedByStep: 'STEP_2_HOST_CREDENTIAL_CONSISTENCY',
      message: 'Binance API key has withdrawals enabled; Force Signal forbids withdrawal-capable keys.',
      remediationHint: 'Revoke key permissions and provision a spot-only Binance key with withdrawals disabled.',
      timestampUtc,
    });
  }

  if (spec.environment === 'LIVE' && !credentials.ipAllowlistConfigured) {
    return makeBootDenial({
      profileId,
      reasonCode: 'LIVE_IP_ALLOWLIST_MISSING',
      blockedByLayer: 'LAYER_1_CREDENTIAL_NAMESPACE',
      blockedByStep: 'STEP_2_HOST_CREDENTIAL_CONSISTENCY',
      message: 'Live profile rejected: mandatory Binance IP allowlisting is not configured on live API key.',
      remediationHint: 'Bind container static egress IP to the live Binance API key allowlist before startup.',
      timestampUtc,
    });
  }

  if (
    credentials.tradeKeyId !== null &&
    credentials.readOnlyKeyId.trim() === credentials.tradeKeyId.trim()
  ) {
    return makeBootDenial({
      profileId,
      reasonCode: 'KEY_TIERS_NOT_DISTINCT',
      blockedByLayer: 'LAYER_1_CREDENTIAL_NAMESPACE',
      blockedByStep: 'STEP_2_HOST_CREDENTIAL_CONSISTENCY',
      message: 'Binance read-only key ID and trade key ID must be strictly distinct.',
      remediationHint: 'Separate read-only telemetry credentials from trade execution credentials.',
      timestampUtc,
    });
  }

  // Hard failure: testnet key against live host / live profile
  if (
    (credentials.keyEnvironment === 'TESTNET' || credentials.namespace === 'TESTNET_NS') &&
    (spec.environment === 'LIVE' || host === 'api.binance.com' || host === 'fapi.binance.com')
  ) {
    return makeBootDenial({
      profileId,
      reasonCode: 'TESTNET_KEY_ON_LIVE_HOST',
      blockedByLayer: 'LAYER_1_CREDENTIAL_NAMESPACE',
      blockedByStep: 'STEP_2_HOST_CREDENTIAL_CONSISTENCY',
      message: `HARD FAILURE: Testnet credential namespace (${credentials.namespace}) resolved against live host "${host || spec.primaryHost}". Process startup refused.`,
      remediationHint: 'Inject LIVE_NS credentials for Live-* profiles or start under Paper-Read / Paper-Trade.',
      timestampUtc,
    });
  }

  // Hard failure: live key against testnet host / paper profile
  if (
    (credentials.keyEnvironment === 'LIVE' || credentials.namespace === 'LIVE_NS') &&
    (spec.environment === 'TESTNET' || host === 'testnet.binance.vision' || host === 'testnet.binancefuture.com')
  ) {
    return makeBootDenial({
      profileId,
      reasonCode: 'LIVE_KEY_ON_TESTNET_HOST',
      blockedByLayer: 'LAYER_1_CREDENTIAL_NAMESPACE',
      blockedByStep: 'STEP_2_HOST_CREDENTIAL_CONSISTENCY',
      message: `HARD FAILURE: Live credential namespace (${credentials.namespace}) resolved against testnet host "${host || spec.primaryHost}". Process startup refused.`,
      remediationHint: 'Inject TESTNET_NS credentials for Paper-* profiles or redeploy in a Live container.',
      timestampUtc,
    });
  }

  if (credentials.namespace !== spec.credentialNamespace || credentials.keyEnvironment !== spec.environment) {
    return makeBootDenial({
      profileId,
      reasonCode: 'CREDENTIAL_NAMESPACE_MISMATCH',
      blockedByLayer: 'LAYER_1_CREDENTIAL_NAMESPACE',
      blockedByStep: 'STEP_2_HOST_CREDENTIAL_CONSISTENCY',
      message: `Credential namespace "${credentials.namespace}" mismatches ${profileId} expected "${spec.credentialNamespace}".`,
      remediationHint: `Mount credential bundle from ${spec.credentialNamespace}.`,
      timestampUtc,
    });
  }

  // Layer 5: Adapter Host Assertion
  if (!host || !spec.allowedHosts.includes(host)) {
    return makeBootDenial({
      profileId,
      reasonCode: 'ADAPTER_HOST_MISMATCH',
      blockedByLayer: 'LAYER_5_ADAPTER_HOST_ASSERTION',
      blockedByStep: 'STEP_2_HOST_CREDENTIAL_CONSISTENCY',
      message: `Execution adapter host "${host || 'EMPTY'}" mismatches ${profileId} allowed hosts (${spec.allowedHosts.join(', ')}).`,
      remediationHint: `Configure execution adapter base URL strictly to ${spec.primaryHost}.`,
      timestampUtc,
    });
  }

  // Layer 6: Network Egress Policy
  const egressCheck = assertContainerEgressAllowed(profileId, host, timestampUtc);
  if (!egressCheck.allowed) {
    return egressCheck.denial;
  }

  return null;
}

export function resolveRuntimeGuardStartupOrThrow(
  input: StartupGuardBootInput
): ResolvedStartupProfileLock {
  const timestampUtc = input.timestampUtc ?? new Date().toISOString();
  const requested = input.requestedProfile;

  if (
    requested !== 'Paper-Read' &&
    requested !== 'Paper-Trade' &&
    requested !== 'Live-Read' &&
    requested !== 'Live-Trade'
  ) {
    throw new RuntimeGuardBootError(
      makeBootDenial({
        profileId: 'Paper-Read',
        reasonCode: 'UNRESOLVED_STARTUP_PROFILE',
        blockedByLayer: 'LAYER_2_PROFILE_RESOLUTION',
        blockedByStep: 'STEP_1_PROFILE_VALIDITY',
        message: `Unrecognized startup profile "${String(requested)}"; must be Paper-Read, Paper-Trade, Live-Read, or Live-Trade.`,
        remediationHint: 'Set FORCE_SIGNAL_PROFILE cleanly at startup.',
        timestampUtc,
      })
    );
  }

  const spec = FOUR_PROFILE_CATALOG[requested];
  const credentials = input.credentials ?? buildDefaultCredentialMetadata(requested);
  const targetHost = input.targetHostOrUrl ?? spec.primaryHost;
  const credentialDenial = validateCredentialAgainstProfile(
    requested,
    credentials,
    targetHost,
    timestampUtc
  );

  if (credentialDenial) {
    throw new RuntimeGuardBootError(credentialDenial);
  }

  const digest = sha256Hex(canonicalStringify({ requested, spec, credentials, timestampUtc }));

  return Object.freeze({
    profileId: requested,
    spec,
    credentials,
    resolvedAtUtc: timestampUtc,
    immutable: true,
    digest,
  });
}

/* ── 7. Five-Step Ordered Guard Evaluation (Inside Execution Egress) ──────── */

export interface GuardEvaluationRequest {
  readonly startupLock: ResolvedStartupProfileLock;
  readonly attemptedProfileSwitch?: GuardProfileId;
  readonly operation: GuardOperationKind;
  readonly targetEndpoint: string;
  readonly venue: MandateVenue;
  readonly symbol: string;
  readonly mandate?: LiveMandateState; // Defaults strictly to DEFAULT_LIVE_MANDATE ('NOT_GRANTED')
  readonly reconciliationHealthy: boolean;
  readonly nowUtc?: string;
}

export function evaluateRuntimeGuard(req: GuardEvaluationRequest): GuardResolutionResult {
  const nowUtc = req.nowUtc ?? new Date().toISOString();
  const profileId = req.startupLock?.profileId;
  const completedSteps: GuardResolutionStepId[] = [];
  const verifiedLayers: AntiMismatchLayerId[] = [];

  const deny = (
    step: GuardResolutionStepId,
    layer: AntiMismatchLayerId,
    reasonCode: GuardDenialCode,
    message: string,
    remediationHint: string,
    mandateAudit: MandateAuditEntry | null = null
  ): GuardResolutionResult => {
    const resolvedProfile: GuardProfileId =
      profileId && FOUR_PROFILE_CATALOG[profileId] ? profileId : 'Paper-Read';
    return Object.freeze({
      allowed: false,
      activeProfile: resolvedProfile,
      profileSpec: FOUR_PROFILE_CATALOG[resolvedProfile],
      completedSteps: Object.freeze([...completedSteps]),
      verifiedLayers: Object.freeze([...verifiedLayers]),
      denial: Object.freeze({
        denied: true,
        reasonCode,
        blockedByLayer: layer,
        blockedByStep: step,
        activeProfile: resolvedProfile,
        message,
        remediationHint,
        timestampUtc: nowUtc,
      }),
      mandateAudit,
    });
  };

  // Step 1: Profile Validity & Runtime Immutability (Layer 2)
  if (!req.startupLock || !req.startupLock.immutable || !FOUR_PROFILE_CATALOG[profileId]) {
    return deny(
      'STEP_1_PROFILE_VALIDITY',
      'LAYER_2_PROFILE_RESOLUTION',
      'UNRESOLVED_STARTUP_PROFILE',
      'No frozen startup profile is resolved; fail-closed posture blocks all operations.',
      'Resolve one of Paper-Read, Paper-Trade, Live-Read, or Live-Trade during container boot.'
    );
  }
  if (req.attemptedProfileSwitch && req.attemptedProfileSwitch !== profileId) {
    return deny(
      'STEP_1_PROFILE_VALIDITY',
      'LAYER_2_PROFILE_RESOLUTION',
      'RUNTIME_PROFILE_SWITCH_FORBIDDEN',
      `Runtime switch from ${profileId} to ${req.attemptedProfileSwitch} is forbidden.`,
      'Restart the container with target FORCE_SIGNAL_PROFILE and matching credentials.'
    );
  }
  const spec = req.startupLock.spec;
  completedSteps.push('STEP_1_PROFILE_VALIDITY');
  verifiedLayers.push('LAYER_2_PROFILE_RESOLUTION');

  // Step 2: Host / Credential Consistency + Adapter Host + Container Egress (Layers 1, 5, 6)
  const credDenial = validateCredentialAgainstProfile(
    profileId,
    req.startupLock.credentials,
    req.targetEndpoint,
    nowUtc
  );
  if (credDenial) {
    return deny(
      credDenial.blockedByStep,
      credDenial.blockedByLayer,
      credDenial.reasonCode,
      credDenial.message,
      credDenial.remediationHint
    );
  }
  completedSteps.push('STEP_2_HOST_CREDENTIAL_CONSISTENCY');
  verifiedLayers.push(
    'LAYER_1_CREDENTIAL_NAMESPACE',
    'LAYER_5_ADAPTER_HOST_ASSERTION',
    'LAYER_6_NETWORK_EGRESS_POLICY'
  );

  // Step 3: Capability Check (Layer 3)
  const isWriteOperation = req.operation === 'PLACE_ORDER' || req.operation === 'CANCEL_ORDER';
  if (isWriteOperation && !spec.canPlaceOrders) {
    return deny(
      'STEP_3_CAPABILITY_CHECK',
      'LAYER_3_GUARD_CAPABILITY',
      'READ_ONLY_PROFILE_WRITE_BLOCKED',
      `Profile ${profileId} is read-only and forbids order/cancel operation "${req.operation}".`,
      'Deploy using Paper-Trade (testnet) or Live-Trade (with LIVE_MANDATE) to execute orders.'
    );
  }
  if (isWriteOperation && req.startupLock.credentials.keyTier !== 'TRADE') {
    return deny(
      'STEP_3_CAPABILITY_CHECK',
      'LAYER_3_GUARD_CAPABILITY',
      'MISSING_TRADE_KEY_FOR_ORDER',
      `Trade key required for ${req.operation}, but key tier is ${req.startupLock.credentials.keyTier}.`,
      'Provide an authorized TRADE credential within the matching credential namespace.'
    );
  }
  completedSteps.push('STEP_3_CAPABILITY_CHECK');
  verifiedLayers.push('LAYER_3_GUARD_CAPABILITY');

  // Step 4: Mandate Check (Layer 4) — Default-Deny LIVE_MANDATE = 'NOT_GRANTED'
  const effectiveMandate: LiveMandateState = req.mandate ?? DEFAULT_LIVE_MANDATE;
  const cleanSymbol = req.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let mandateAudit: MandateAuditEntry | null = null;

  if (spec.requiresMandate && isWriteOperation) {
    if (effectiveMandate === DEFAULT_LIVE_MANDATE) {
      mandateAudit = Object.freeze({
        auditId: `mandate_${sha256Hex(`${nowUtc}|${profileId}|${cleanSymbol}|NOT_GRANTED`).slice(0, 12)}`,
        timestampUtc: nowUtc,
        activeProfile: profileId,
        operation: req.operation,
        venue: req.venue,
        symbol: cleanSymbol,
        decision: 'DENY',
        reasonCode: 'LIVE_WRITE_REQUIRES_MANDATE',
        mandateState: 'NOT_GRANTED',
      });
      return deny(
        'STEP_4_MANDATE_CHECK',
        'LAYER_4_MANDATE_CHECK',
        'LIVE_WRITE_REQUIRES_MANDATE',
        `LIVE_WRITE_REQUIRES_MANDATE: ${profileId} execution of ${req.operation} (${cleanSymbol}) denied because LIVE_MANDATE is NOT_GRANTED.`,
        'Inject a signed out-of-band LIVE_MANDATE scoped to (venue, symbolSet, startsAtUtc, expiresAtUtc) via environment/secret manager.',
        mandateAudit
      );
    }

    if (effectiveMandate.venue !== req.venue) {
      mandateAudit = Object.freeze({
        auditId: `mandate_${sha256Hex(`${nowUtc}|${profileId}|${cleanSymbol}|VENUE`).slice(0, 12)}`,
        timestampUtc: nowUtc,
        activeProfile: profileId,
        operation: req.operation,
        venue: req.venue,
        symbol: cleanSymbol,
        decision: 'DENY',
        reasonCode: 'MANDATE_VENUE_MISMATCH',
        mandateState: 'VENUE_MISMATCH',
      });
      return deny(
        'STEP_4_MANDATE_CHECK',
        'LAYER_4_MANDATE_CHECK',
        'MANDATE_VENUE_MISMATCH',
        `Out-of-band LIVE_MANDATE venue "${effectiveMandate.venue}" does not authorize requested venue "${req.venue}".`,
        `Re-issue LIVE_MANDATE scoped to venue "${req.venue}".`,
        mandateAudit
      );
    }

    if (!effectiveMandate.symbolSet.includes(cleanSymbol) && !effectiveMandate.symbolSet.includes('*')) {
      mandateAudit = Object.freeze({
        auditId: `mandate_${sha256Hex(`${nowUtc}|${profileId}|${cleanSymbol}|SYM`).slice(0, 12)}`,
        timestampUtc: nowUtc,
        activeProfile: profileId,
        operation: req.operation,
        venue: req.venue,
        symbol: cleanSymbol,
        decision: 'DENY',
        reasonCode: 'MANDATE_SYMBOL_NOT_SCOPED',
        mandateState: 'SYMBOL_MISMATCH',
      });
      return deny(
        'STEP_4_MANDATE_CHECK',
        'LAYER_4_MANDATE_CHECK',
        'MANDATE_SYMBOL_NOT_SCOPED',
        `Symbol ${cleanSymbol} is outside LIVE_MANDATE symbolSet [${effectiveMandate.symbolSet.join(', ')}].`,
        `Expand out-of-band LIVE_MANDATE symbolSet to authorize ${cleanSymbol}.`,
        mandateAudit
      );
    }

    const nowMs = Date.parse(nowUtc);
    const startMs = Date.parse(effectiveMandate.startsAtUtc);
    const endMs = Date.parse(effectiveMandate.expiresAtUtc);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || nowMs < startMs || nowMs > endMs) {
      mandateAudit = Object.freeze({
        auditId: `mandate_${sha256Hex(`${nowUtc}|${profileId}|${cleanSymbol}|EXP`).slice(0, 12)}`,
        timestampUtc: nowUtc,
        activeProfile: profileId,
        operation: req.operation,
        venue: req.venue,
        symbol: cleanSymbol,
        decision: 'DENY',
        reasonCode: 'MANDATE_WINDOW_INACTIVE',
        mandateState: 'EXPIRED',
      });
      return deny(
        'STEP_4_MANDATE_CHECK',
        'LAYER_4_MANDATE_CHECK',
        'MANDATE_WINDOW_INACTIVE',
        `LIVE_MANDATE time window [${effectiveMandate.startsAtUtc} .. ${effectiveMandate.expiresAtUtc}] is inactive or expired at ${nowUtc}.`,
        'Inject a fresh non-expired out-of-band LIVE_MANDATE window via secret manager.',
        mandateAudit
      );
    }

    mandateAudit = Object.freeze({
      auditId: `mandate_${sha256Hex(`${nowUtc}|${profileId}|${cleanSymbol}|ALLOW`).slice(0, 12)}`,
      timestampUtc: nowUtc,
      activeProfile: profileId,
      operation: req.operation,
      venue: req.venue,
      symbol: cleanSymbol,
      decision: 'ALLOW',
      reasonCode: 'LIVE_MANDATE_AUTHORIZED',
      mandateState: 'GRANTED',
    });
  }
  completedSteps.push('STEP_4_MANDATE_CHECK');
  verifiedLayers.push('LAYER_4_MANDATE_CHECK');

  // Step 5: Reconciliation Precondition
  if (isWriteOperation && !req.reconciliationHealthy) {
    return deny(
      'STEP_5_RECONCILIATION_PRECONDITION',
      'LAYER_3_GUARD_CAPABILITY',
      'RECONCILIATION_PRECONDITION_FAILED',
      'State reconciliation precondition failed: wallet/mark-price parity must be synchronized before writing orders.',
      'Run state reconciliation and resolve exchange mark-price / balance drift prior to order retry.',
      mandateAudit
    );
  }
  completedSteps.push('STEP_5_RECONCILIATION_PRECONDITION');

  return Object.freeze({
    allowed: true,
    activeProfile: profileId,
    profileSpec: spec,
    completedSteps: Object.freeze(completedSteps),
    verifiedLayers: Object.freeze(verifiedLayers),
    denial: null,
    mandateAudit,
  });
}

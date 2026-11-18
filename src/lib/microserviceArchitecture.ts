import {
  DEFAULT_CONTROL_MATRIX,
  computeMatrixChecksum,
  diffControlMatrix,
  mergeGranularControlMatrix,
  type ControlDomain,
  type GranularControlMatrix,
  type GranularToggleKey,
  type MicroserviceId,
} from './controlMatrix';

export type ServiceLifecycleState =
  | 'ACTIVE'
  | 'DEGRADED'
  | 'FAILOVER_ACTIVE'
  | 'ISOLATED'
  | 'DECOMMISSIONED';

export type FailoverNodeRole = 'PRIMARY' | 'SECONDARY';

export type CircuitBreakerState = 'CLOSED' | 'HALF_OPEN' | 'OPEN';

export type ErrorSeverity = 'WARN' | 'ERROR' | 'CRITICAL';

export interface ServiceEndpointNode {
  role: FailoverNodeRole;
  nodeId: string;
  endpoint: string;
  region: string;
}

export interface MicroserviceDescriptor {
  id: MicroserviceId;
  name: string;
  domain: ControlDomain;
  decommissionedFrom: string;
  bulkheadConcurrencyLimit: number;
  failoverThreshold: number;
  circuitOpenThreshold: number;
  primaryNode: ServiceEndpointNode;
  secondaryNode: ServiceEndpointNode;
}

export interface MicroserviceRuntimeState {
  id: MicroserviceId;
  name: string;
  domain: ControlDomain;
  decommissionedFrom: string;
  lifecycle: ServiceLifecycleState;
  activeNode: FailoverNodeRole;
  activeEndpoint: string;
  primaryNode: ServiceEndpointNode;
  secondaryNode: ServiceEndpointNode;
  circuitBreaker: CircuitBreakerState;
  bulkheadInFlight: number;
  bulkheadConcurrencyLimit: number;
  consecutiveFailures: number;
  failoverThreshold: number;
  circuitOpenThreshold: number;
  totalRequests: number;
  totalErrors: number;
  failoverCount: number;
  lastLatencyMs: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastErrorAt: string | null;
  lastFailoverAt: string | null;
  lastHealthyAt: string;
  faultIsolated: boolean;
}

export interface MicroserviceErrorEntry {
  id: string;
  correlationId: string;
  serviceId: MicroserviceId;
  node: FailoverNodeRole;
  severity: ErrorSeverity;
  code: string;
  message: string;
  recoveryAction: string;
  contextSummary: string;
  matrixChecksum: string;
  timestamp: string;
}

export interface RollbackSnapshot {
  snapshotId: string;
  version: number;
  createdAt: string;
  reason: string;
  actorUid: string;
  verifiedHealthy: boolean;
  checksum: string;
  matrix: GranularControlMatrix;
  serviceNodes: Record<MicroserviceId, FailoverNodeRole>;
}

export interface RollbackEvent {
  id: string;
  trigger: 'AUTO_FAULT_PROTOCOL' | 'MANUAL_OPERATOR';
  fromChecksum: string;
  toSnapshotId: string;
  toChecksum: string;
  reason: string;
  actorUid: string;
  restoredKeys: GranularToggleKey[];
  timestamp: string;
}

export interface FailoverEvent {
  id: string;
  serviceId: MicroserviceId;
  fromNode: FailoverNodeRole;
  toNode: FailoverNodeRole;
  trigger: 'AUTO_HEALTH_PROBE' | 'MANUAL_SWITCH' | 'FAILBACK_RESTORE';
  reason: string;
  timestamp: string;
}

export interface MicroservicePlatformState {
  architectureVersion: string;
  monolithDecommissioned: boolean;
  stateEpoch: number;
  lastVerifiedHealthySnapshotId: string;
  lastMutationAtMs: number;
  recentFaultBurstAfterMutation: number;
  controlMatrix: GranularControlMatrix;
  matrixChecksum: string;
  services: Record<MicroserviceId, MicroserviceRuntimeState>;
  snapshots: RollbackSnapshot[];
  rollbackHistory: RollbackEvent[];
  failoverHistory: FailoverEvent[];
  errorLedger: MicroserviceErrorEntry[];
  autoFailoversTotal: number;
  autoRollbacksTotal: number;
  isolatedFaultsContainedTotal: number;
}

export const ORDERED_MICROSERVICE_IDS: readonly MicroserviceId[] = [
  'market-data-svc',
  'ai-agents-svc',
  'execution-router-svc',
  'risk-kernel-svc',
  'telemetry-bus-svc',
] as const;

export const MICROSERVICE_CATALOG: Record<MicroserviceId, MicroserviceDescriptor> = {
  'market-data-svc': {
    id: 'market-data-svc',
    name: 'Market Data Ingestion Service',
    domain: 'MARKET_DATA',
    decommissionedFrom: 'legacy-monolith/ticker-loop',
    bulkheadConcurrencyLimit: 16,
    failoverThreshold: 2,
    circuitOpenThreshold: 4,
    primaryNode: {
      role: 'PRIMARY',
      nodeId: 'md-binance-primary',
      endpoint: 'wss://stream.binance.com:9443/stream',
      region: 'ap-northeast-1',
    },
    secondaryNode: {
      role: 'SECONDARY',
      nodeId: 'md-vision-standby',
      endpoint: 'wss://data-stream.binance.vision/stream',
      region: 'eu-central-1',
    },
  },
  'ai-agents-svc': {
    id: 'ai-agents-svc',
    name: 'AI Agent & Coordinator Service',
    domain: 'AI_AGENTS',
    decommissionedFrom: 'legacy-monolith/agent-runner',
    bulkheadConcurrencyLimit: 12,
    failoverThreshold: 2,
    circuitOpenThreshold: 4,
    primaryNode: {
      role: 'PRIMARY',
      nodeId: 'ai-coordinator-alpha',
      endpoint: 'svc://ai-agents-alpha.internal:8101',
      region: 'asia-east1-a',
    },
    secondaryNode: {
      role: 'SECONDARY',
      nodeId: 'ai-coordinator-beta',
      endpoint: 'svc://ai-agents-beta.internal:8102',
      region: 'asia-east1-b',
    },
  },
  'execution-router-svc': {
    id: 'execution-router-svc',
    name: 'Dual Execution Router Service',
    domain: 'EXECUTION_ROUTER',
    decommissionedFrom: 'legacy-monolith/order-desk',
    bulkheadConcurrencyLimit: 8,
    failoverThreshold: 2,
    circuitOpenThreshold: 3,
    primaryNode: {
      role: 'PRIMARY',
      nodeId: 'exec-router-primary',
      endpoint: 'https://testnet.binance.vision',
      region: 'ap-southeast-1',
    },
    secondaryNode: {
      role: 'SECONDARY',
      nodeId: 'exec-router-standby',
      endpoint: 'https://testnet.binancefuture.com',
      region: 'ap-northeast-1',
    },
  },
  'risk-kernel-svc': {
    id: 'risk-kernel-svc',
    name: 'Invariant Risk & PG_v4 Kernel Service',
    domain: 'RELIABILITY_TELEMETRY',
    decommissionedFrom: 'legacy-monolith/risk-checks',
    bulkheadConcurrencyLimit: 24,
    failoverThreshold: 2,
    circuitOpenThreshold: 4,
    primaryNode: {
      role: 'PRIMARY',
      nodeId: 'risk-kernel-core',
      endpoint: 'svc://risk-kernel-core.internal:8201',
      region: 'asia-east1-a',
    },
    secondaryNode: {
      role: 'SECONDARY',
      nodeId: 'risk-kernel-replica',
      endpoint: 'svc://risk-kernel-replica.internal:8202',
      region: 'asia-east1-c',
    },
  },
  'telemetry-bus-svc': {
    id: 'telemetry-bus-svc',
    name: 'Telemetry SSE & Audit Log Bus',
    domain: 'RELIABILITY_TELEMETRY',
    decommissionedFrom: 'legacy-monolith/sse-broadcaster',
    bulkheadConcurrencyLimit: 32,
    failoverThreshold: 2,
    circuitOpenThreshold: 4,
    primaryNode: {
      role: 'PRIMARY',
      nodeId: 'telemetry-bus-east',
      endpoint: 'svc://telemetry-east.internal:8301',
      region: 'asia-east1-a',
    },
    secondaryNode: {
      role: 'SECONDARY',
      nodeId: 'telemetry-bus-dr',
      endpoint: 'svc://telemetry-dr.internal:8302',
      region: 'us-central1-a',
    },
  },
};

const MAX_SNAPSHOTS = 24;
const MAX_ERROR_LEDGER = 120;
const MAX_EVENTS_LOG = 50;
const POST_MUTATION_ROLLBACK_WINDOW_MS = 120_000;

function extractServiceNodes(
  services: Record<MicroserviceId, MicroserviceRuntimeState>
): Record<MicroserviceId, FailoverNodeRole> {
  return {
    'market-data-svc': services['market-data-svc'].activeNode,
    'ai-agents-svc': services['ai-agents-svc'].activeNode,
    'execution-router-svc': services['execution-router-svc'].activeNode,
    'risk-kernel-svc': services['risk-kernel-svc'].activeNode,
    'telemetry-bus-svc': services['telemetry-bus-svc'].activeNode,
  };
}

function makeSnapshotId(version: number, nowMs: number): string {
  return `snap_v${version}_${nowMs}`;
}

export function createInitialPlatformState(
  initialMatrix: GranularControlMatrix = DEFAULT_CONTROL_MATRIX,
  nowMs = Date.now()
): MicroservicePlatformState {
  const nowIso = new Date(nowMs).toISOString();
  const services = {} as Record<MicroserviceId, MicroserviceRuntimeState>;

  for (const id of ORDERED_MICROSERVICE_IDS) {
    const desc = MICROSERVICE_CATALOG[id];
    services[id] = {
      id: desc.id,
      name: desc.name,
      domain: desc.domain,
      decommissionedFrom: desc.decommissionedFrom,
      lifecycle: 'ACTIVE',
      activeNode: 'PRIMARY',
      activeEndpoint: desc.primaryNode.endpoint,
      primaryNode: desc.primaryNode,
      secondaryNode: desc.secondaryNode,
      circuitBreaker: 'CLOSED',
      bulkheadInFlight: 0,
      bulkheadConcurrencyLimit: desc.bulkheadConcurrencyLimit,
      consecutiveFailures: 0,
      failoverThreshold: desc.failoverThreshold,
      circuitOpenThreshold: desc.circuitOpenThreshold,
      totalRequests: 0,
      totalErrors: 0,
      failoverCount: 0,
      lastLatencyMs: 12,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastErrorAt: null,
      lastFailoverAt: null,
      lastHealthyAt: nowIso,
      faultIsolated: true,
    };
  }

  const matrix = { ...initialMatrix };
  const checksum = computeMatrixChecksum(matrix);
  const initialSnapId = makeSnapshotId(1, nowMs);
  const initialSnapshot: RollbackSnapshot = {
    snapshotId: initialSnapId,
    version: 1,
    createdAt: nowIso,
    reason: 'Verified baseline microservice boot checkpoint',
    actorUid: 'system-bootstrap',
    verifiedHealthy: true,
    checksum,
    matrix,
    serviceNodes: extractServiceNodes(services),
  };

  return {
    architectureVersion: 'MS_V4_DECOMMISSIONED',
    monolithDecommissioned: true,
    stateEpoch: 1,
    lastVerifiedHealthySnapshotId: initialSnapId,
    lastMutationAtMs: 0,
    recentFaultBurstAfterMutation: 0,
    controlMatrix: matrix,
    matrixChecksum: checksum,
    services,
    snapshots: [initialSnapshot],
    rollbackHistory: [],
    failoverHistory: [],
    errorLedger: [],
    autoFailoversTotal: 0,
    autoRollbacksTotal: 0,
    isolatedFaultsContainedTotal: 0,
  };
}

export function sanitizeErrorMessage(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : String(raw || 'Unknown microservice error');
  return text
    .replace(/Bearer\s+[A-Za-z0-9\-_.]+/gi, 'Bearer [REDACTED]')
    .replace(/(api[_-]?key|secret|password|token)=[^\s&]+/gi, '$1=[REDACTED]')
    .slice(0, 320);
}

export function captureRollbackSnapshot(
  state: MicroservicePlatformState,
  reason: string,
  actorUid: string,
  verifiedHealthy = true,
  nowMs = Date.now()
): MicroservicePlatformState {
  const nextEpoch = state.stateEpoch + 1;
  const checksum = computeMatrixChecksum(state.controlMatrix);
  const snapId = makeSnapshotId(nextEpoch, nowMs);
  const snap: RollbackSnapshot = {
    snapshotId: snapId,
    version: nextEpoch,
    createdAt: new Date(nowMs).toISOString(),
    reason: reason.slice(0, 180),
    actorUid,
    verifiedHealthy,
    checksum,
    matrix: { ...state.controlMatrix },
    serviceNodes: extractServiceNodes(state.services),
  };

  return {
    ...state,
    stateEpoch: nextEpoch,
    lastVerifiedHealthySnapshotId: verifiedHealthy
      ? snapId
      : state.lastVerifiedHealthySnapshotId,
    snapshots: [snap, ...state.snapshots].slice(0, MAX_SNAPSHOTS),
  };
}

export function applyControlMatrixUpdate(
  state: MicroservicePlatformState,
  patch: Partial<GranularControlMatrix>,
  actorUid: string,
  reason = 'Workspace control matrix update',
  nowMs = Date.now()
): { state: MicroservicePlatformState; snapshotId: string; changedKeys: GranularToggleKey[] } {
  const merged = mergeGranularControlMatrix(state.controlMatrix, patch);
  const diff = diffControlMatrix(state.controlMatrix, merged);
  if (diff.length === 0) {
    return {
      state,
      snapshotId: state.snapshots[0]?.snapshotId ?? state.lastVerifiedHealthySnapshotId,
      changedKeys: [],
    };
  }

  // Capture pre-mutation verified healthy checkpoint so automated rollback always has an intact anchor
  const withPreSnap = captureRollbackSnapshot(
    state,
    `Pre-mutation checkpoint (${diff.map((d) => d.key).join(', ')})`,
    actorUid,
    true,
    nowMs
  );
  const preSnapId = withPreSnap.snapshots[0].snapshotId;
  const nextChecksum = computeMatrixChecksum(merged);

  return {
    snapshotId: preSnapId,
    changedKeys: diff.map((d) => d.key),
    state: {
      ...withPreSnap,
      stateEpoch: withPreSnap.stateEpoch + 1,
      lastMutationAtMs: nowMs,
      recentFaultBurstAfterMutation: 0,
      controlMatrix: merged,
      matrixChecksum: nextChecksum,
    },
  };
}

export function recordServiceSuccess(
  state: MicroservicePlatformState,
  serviceId: MicroserviceId,
  latencyMs: number,
  nowMs = Date.now()
): MicroservicePlatformState {
  const svc = state.services[serviceId];
  if (!svc || svc.lifecycle === 'DECOMMISSIONED') return state;

  const updatedSvc: MicroserviceRuntimeState = {
    ...svc,
    totalRequests: svc.totalRequests + 1,
    consecutiveFailures: 0,
    lastLatencyMs: Math.max(1, Math.round(latencyMs)),
    lastHealthyAt: new Date(nowMs).toISOString(),
    circuitBreaker: svc.circuitBreaker === 'HALF_OPEN' ? 'CLOSED' : svc.circuitBreaker,
    lifecycle:
      svc.activeNode === 'SECONDARY'
        ? 'FAILOVER_ACTIVE'
        : svc.lifecycle === 'DEGRADED'
        ? 'ACTIVE'
        : svc.lifecycle,
  };

  return {
    ...state,
    services: {
      ...state.services,
      [serviceId]: updatedSvc,
    },
  };
}

export function triggerManualFailover(
  state: MicroservicePlatformState,
  serviceId: MicroserviceId,
  targetNode: FailoverNodeRole,
  reason: string,
  nowMs = Date.now()
): MicroservicePlatformState {
  const svc = state.services[serviceId];
  if (!svc) return state;

  const nowIso = new Date(nowMs).toISOString();
  const nextEndpoint =
    targetNode === 'SECONDARY' ? svc.secondaryNode.endpoint : svc.primaryNode.endpoint;
  const trigger =
    targetNode === 'PRIMARY' && svc.activeNode === 'SECONDARY'
      ? 'FAILBACK_RESTORE'
      : 'MANUAL_SWITCH';

  const event: FailoverEvent = {
    id: `fo_${serviceId}_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
    serviceId,
    fromNode: svc.activeNode,
    toNode: targetNode,
    trigger,
    reason: reason.slice(0, 180),
    timestamp: nowIso,
  };

  const updatedSvc: MicroserviceRuntimeState = {
    ...svc,
    activeNode: targetNode,
    activeEndpoint: nextEndpoint,
    lifecycle: targetNode === 'SECONDARY' ? 'FAILOVER_ACTIVE' : 'ACTIVE',
    circuitBreaker: 'CLOSED',
    consecutiveFailures: 0,
    failoverCount: svc.failoverCount + (svc.activeNode !== targetNode ? 1 : 0),
    lastFailoverAt: nowIso,
    lastHealthyAt: nowIso,
  };

  return {
    ...state,
    stateEpoch: state.stateEpoch + 1,
    services: {
      ...state.services,
      [serviceId]: updatedSvc,
    },
    failoverHistory: [event, ...state.failoverHistory].slice(0, MAX_EVENTS_LOG),
  };
}

export function setServiceLifecycle(
  state: MicroservicePlatformState,
  serviceId: MicroserviceId,
  lifecycle: 'ACTIVE' | 'ISOLATED' | 'DECOMMISSIONED',
  reason: string,
  nowMs = Date.now()
): MicroservicePlatformState {
  const svc = state.services[serviceId];
  if (!svc) return state;
  const nowIso = new Date(nowMs).toISOString();

  const updatedSvc: MicroserviceRuntimeState = {
    ...svc,
    lifecycle:
      lifecycle === 'ACTIVE' && svc.activeNode === 'SECONDARY' ? 'FAILOVER_ACTIVE' : lifecycle,
    circuitBreaker:
      lifecycle === 'ISOLATED' || lifecycle === 'DECOMMISSIONED' ? 'OPEN' : 'CLOSED',
    consecutiveFailures: lifecycle === 'ACTIVE' ? 0 : svc.consecutiveFailures,
    lastHealthyAt: lifecycle === 'ACTIVE' ? nowIso : svc.lastHealthyAt,
    lastErrorMessage:
      lifecycle !== 'ACTIVE' ? reason.slice(0, 220) : svc.lastErrorMessage,
    lastErrorAt: lifecycle !== 'ACTIVE' ? nowIso : svc.lastErrorAt,
  };

  return {
    ...state,
    stateEpoch: state.stateEpoch + 1,
    services: {
      ...state.services,
      [serviceId]: updatedSvc,
    },
  };
}

export function rollbackToSnapshot(
  state: MicroservicePlatformState,
  snapshotId: string,
  trigger: RollbackEvent['trigger'],
  actorUid: string,
  reason: string,
  nowMs = Date.now()
): { state: MicroservicePlatformState; ok: boolean; event?: RollbackEvent; error?: string } {
  const target = state.snapshots.find((s) => s.snapshotId === snapshotId);
  if (!target) {
    return {
      state,
      ok: false,
      error: `Rollback snapshot ${snapshotId} not found.`,
    };
  }

  const nowIso = new Date(nowMs).toISOString();
  const diff = diffControlMatrix(state.controlMatrix, target.matrix);
  const restoredServices = { ...state.services };

  for (const id of ORDERED_MICROSERVICE_IDS) {
    const cur = restoredServices[id];
    const targetRole = target.serviceNodes[id] ?? 'PRIMARY';
    const endpoint =
      targetRole === 'SECONDARY' ? cur.secondaryNode.endpoint : cur.primaryNode.endpoint;
    restoredServices[id] = {
      ...cur,
      activeNode: targetRole,
      activeEndpoint: endpoint,
      lifecycle: targetRole === 'SECONDARY' ? 'FAILOVER_ACTIVE' : 'ACTIVE',
      circuitBreaker: 'CLOSED',
      consecutiveFailures: 0,
      lastHealthyAt: nowIso,
    };
  }

  const event: RollbackEvent = {
    id: `rb_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
    trigger,
    fromChecksum: state.matrixChecksum,
    toSnapshotId: target.snapshotId,
    toChecksum: target.checksum,
    reason: reason.slice(0, 220),
    actorUid,
    restoredKeys: diff.map((d) => d.key),
    timestamp: nowIso,
  };

  return {
    ok: true,
    event,
    state: {
      ...state,
      stateEpoch: state.stateEpoch + 1,
      recentFaultBurstAfterMutation: 0,
      controlMatrix: { ...target.matrix },
      matrixChecksum: target.checksum,
      services: restoredServices,
      rollbackHistory: [event, ...state.rollbackHistory].slice(0, MAX_EVENTS_LOG),
      autoRollbacksTotal:
        state.autoRollbacksTotal + (trigger === 'AUTO_FAULT_PROTOCOL' ? 1 : 0),
    },
  };
}

export function reportServiceFault(
  state: MicroservicePlatformState,
  input: {
    serviceId: MicroserviceId;
    code: string;
    message: unknown;
    severity?: ErrorSeverity;
    correlationId?: string;
    contextSummary?: string;
    nowMs?: number;
  }
): {
  state: MicroservicePlatformState;
  errorEntry: MicroserviceErrorEntry;
  failoverTriggered: boolean;
  rollbackTriggered: boolean;
} {
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const svc = state.services[input.serviceId];
  const severity: ErrorSeverity = input.severity ?? 'ERROR';
  const cleanMsg = sanitizeErrorMessage(input.message);
  const correlationId =
    input.correlationId ||
    `corr_${input.serviceId}_${nowMs}_${Math.random().toString(36).slice(2, 6)}`;

  let nextConsecutive = svc.consecutiveFailures + 1;
  let nextActiveNode = svc.activeNode;
  let nextEndpoint = svc.activeEndpoint;
  let nextLifecycle: ServiceLifecycleState = svc.lifecycle;
  let nextCircuit: CircuitBreakerState = svc.circuitBreaker;
  let failoverTriggered = false;
  let nextFailoverCount = svc.failoverCount;
  let nextAutoFailoversTotal = state.autoFailoversTotal;
  const nextFailoverHistory = [...state.failoverHistory];
  let recoveryAction = 'Contained inside service bulkhead (siblings unaffected)';

  if (
    state.controlMatrix.haAutoFailover &&
    svc.activeNode === 'PRIMARY' &&
    nextConsecutive >= svc.failoverThreshold
  ) {
    failoverTriggered = true;
    nextActiveNode = 'SECONDARY';
    nextEndpoint = svc.secondaryNode.endpoint;
    nextLifecycle = 'FAILOVER_ACTIVE';
    nextCircuit = 'HALF_OPEN';
    nextConsecutive = 0;
    nextFailoverCount += 1;
    nextAutoFailoversTotal += 1;
    recoveryAction = `HA Auto-Failover switched ${svc.id} from PRIMARY (${svc.primaryNode.nodeId}) -> SECONDARY (${svc.secondaryNode.nodeId})`;
    nextFailoverHistory.unshift({
      id: `fo_${svc.id}_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
      serviceId: svc.id,
      fromNode: 'PRIMARY',
      toNode: 'SECONDARY',
      trigger: 'AUTO_HEALTH_PROBE',
      reason: `${input.code}: ${cleanMsg}`,
      timestamp: nowIso,
    });
  } else if (nextConsecutive >= svc.circuitOpenThreshold) {
    nextLifecycle = 'ISOLATED';
    nextCircuit = 'OPEN';
    recoveryAction = `Fault isolation opened circuit breaker for ${svc.id}; sibling microservices isolated & healthy`;
  } else if (nextLifecycle === 'ACTIVE') {
    nextLifecycle = 'DEGRADED';
  }

  const updatedSvc: MicroserviceRuntimeState = {
    ...svc,
    lifecycle: nextLifecycle,
    activeNode: nextActiveNode,
    activeEndpoint: nextEndpoint,
    circuitBreaker: nextCircuit,
    consecutiveFailures: nextConsecutive,
    totalRequests: svc.totalRequests + 1,
    totalErrors: svc.totalErrors + 1,
    failoverCount: nextFailoverCount,
    lastErrorCode: input.code,
    lastErrorMessage: cleanMsg,
    lastErrorAt: nowIso,
    lastFailoverAt: failoverTriggered ? nowIso : svc.lastFailoverAt,
  };

  const errorEntry: MicroserviceErrorEntry = {
    id: `err_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
    correlationId,
    serviceId: input.serviceId,
    node: updatedSvc.activeNode,
    severity,
    code: input.code,
    message: cleanMsg,
    recoveryAction,
    contextSummary: (input.contextSummary || `${svc.id} [${svc.activeNode}]`).slice(0, 180),
    matrixChecksum: state.matrixChecksum,
    timestamp: nowIso,
  };

  const withinPostMutationWindow =
    state.lastMutationAtMs > 0 &&
    nowMs - state.lastMutationAtMs <= POST_MUTATION_ROLLBACK_WINDOW_MS;
  const nextFaultBurst = withinPostMutationWindow
    ? state.recentFaultBurstAfterMutation + 1
    : state.recentFaultBurstAfterMutation;

  let nextState: MicroservicePlatformState = {
    ...state,
    stateEpoch: state.stateEpoch + 1,
    recentFaultBurstAfterMutation: nextFaultBurst,
    services: {
      ...state.services,
      [input.serviceId]: updatedSvc,
    },
    failoverHistory: nextFailoverHistory.slice(0, MAX_EVENTS_LOG),
    errorLedger: state.controlMatrix.diagnosticErrorCapture
      ? [errorEntry, ...state.errorLedger].slice(0, MAX_ERROR_LEDGER)
      : state.errorLedger,
    autoFailoversTotal: nextAutoFailoversTotal,
    isolatedFaultsContainedTotal: state.isolatedFaultsContainedTotal + 1,
  };

  // Automated Rollback Protocol on critical post-mutation fault or severe burst
  let rollbackTriggered = false;
  const shouldAutoRollback =
    state.controlMatrix.automatedRollbackProtocol &&
    state.lastVerifiedHealthySnapshotId !== '' &&
    ((severity === 'CRITICAL' && withinPostMutationWindow) ||
      nextFaultBurst >= 3 ||
      (severity === 'CRITICAL' && nextLifecycle === 'ISOLATED'));

  if (shouldAutoRollback) {
    const currentChecksum = nextState.matrixChecksum;
    const anchorSnap = nextState.snapshots.find(
      (s) => s.snapshotId === nextState.lastVerifiedHealthySnapshotId
    );
    if (anchorSnap && (anchorSnap.checksum !== currentChecksum || nextLifecycle === 'ISOLATED')) {
      const rb = rollbackToSnapshot(
        nextState,
        anchorSnap.snapshotId,
        'AUTO_FAULT_PROTOCOL',
        'automated-rollback-daemon',
        `Automated rollback triggered by ${input.code} on ${input.serviceId}`,
        nowMs
      );
      if (rb.ok) {
        nextState = rb.state;
        rollbackTriggered = true;
      }
    }
  }

  return {
    state: nextState,
    errorEntry,
    failoverTriggered,
    rollbackTriggered,
  };
}

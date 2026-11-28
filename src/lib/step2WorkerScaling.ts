/**
 * Signal Forge — Step 2 Controlled Agent Scaling & Idempotent Execution Coordinator
 *
 * Manages bounded worker pool concurrency, resource budgets, queue telemetry,
 * worker health checks, controlled restart/recovery, and strict idempotency locks
 * (`signalId` + `clientOrderId`) so that two workers can NEVER independently
 * execute the same trading decision.
 *
 * CRITICAL SAFETY INVARIANT:
 *  Neither worker scaling nor self-healing recovery may EVER override
 *  Safe Maintenance Mode (`state !== 'NORMAL'`) or Emergency Stop.
 */

import {
  evaluateMaintenanceOrderGate,
  type SafeMaintenanceState,
} from './safeMaintenanceProtocol';

export type WorkerStatus = 'HEALTHY' | 'DEGRADED' | 'PAUSED_MAINTENANCE' | 'RESTARTING';

export interface ManagedWorkerNode {
  readonly workerId: string;
  readonly roleFocus: 'SIGNAL_PIPELINE' | 'EXECUTION_GUARD' | 'RISK_MONITOR' | 'PORTFOLIO_AUDIT';
  readonly status: WorkerStatus;
  readonly activeTasks: number;
  readonly completedTasks: number;
  readonly failedTasks: number;
  readonly memoryMb: number;
  readonly cpuPct: number;
  readonly lastHeartbeatIso: string;
  readonly restartCount: number;
}

export interface WorkerPoolResourceBudget {
  readonly minWorkers: number;
  readonly maxWorkers: number;
  readonly maxQueueDepth: number;
  readonly maxMemoryMbPerWorker: number;
  readonly maxCpuPctPerWorker: number;
  readonly maxConcurrentExecutions: number;
}

export const DEFAULT_WORKER_RESOURCE_BUDGET: WorkerPoolResourceBudget = Object.freeze({
  minWorkers: 1,
  maxWorkers: 4,
  maxQueueDepth: 32,
  maxMemoryMbPerWorker: 256,
  maxCpuPctPerWorker: 75,
  maxConcurrentExecutions: 2,
});

export interface WorkerScalingAuditEvent {
  readonly id: string;
  readonly timestampIso: string;
  readonly action:
    | 'POOL_INITIALIZED'
    | 'SCALE_UP'
    | 'SCALE_DOWN'
    | 'SCALE_BLOCKED_MAINTENANCE'
    | 'SCALE_BLOCKED_BUDGET'
    | 'DISPATCH_ACQUIRED'
    | 'DISPATCH_COMPLETED'
    | 'DUPLICATE_EXECUTION_PREVENTED'
    | 'EXECUTION_BLOCKED_MAINTENANCE'
    | 'WORKER_RESTARTED'
    | 'SELF_HEAL_BLOCKED_MAINTENANCE';
  readonly detail: string;
}

export interface ControlledWorkerPoolState {
  readonly budget: WorkerPoolResourceBudget;
  readonly desiredWorkers: number;
  readonly workers: readonly ManagedWorkerNode[];
  readonly queueDepth: number;
  readonly inFlightSignalIds: readonly string[];
  readonly processedSignalIds: readonly string[];
  readonly processedClientOrderIds: readonly string[];
  readonly duplicateExecutionsPrevented: number;
  readonly maintenanceBlocksCount: number;
  readonly updatedAtIso: string;
  readonly auditLog: readonly WorkerScalingAuditEvent[];
}

const WORKER_ROLES: readonly ManagedWorkerNode['roleFocus'][] = [
  'SIGNAL_PIPELINE',
  'EXECUTION_GUARD',
  'RISK_MONITOR',
  'PORTFOLIO_AUDIT',
];

function appendAudit(
  existing: readonly WorkerScalingAuditEvent[],
  action: WorkerScalingAuditEvent['action'],
  detail: string,
  nowMs: number
): WorkerScalingAuditEvent[] {
  return [
    {
      id: `wrk-evt-${nowMs}-${existing.length + 1}`,
      timestampIso: new Date(nowMs).toISOString(),
      action,
      detail,
    },
    ...existing,
  ].slice(0, 40);
}

export function createInitialWorkerPoolState(
  budget: WorkerPoolResourceBudget = DEFAULT_WORKER_RESOURCE_BUDGET,
  nowMs = Date.now()
): ControlledWorkerPoolState {
  const nowIso = new Date(nowMs).toISOString();
  const initialCount = Math.max(budget.minWorkers, Math.min(budget.maxWorkers, 2));
  const workers: ManagedWorkerNode[] = Array.from({ length: initialCount }, (_, idx) => ({
    workerId: `sf-worker-${idx + 1}`,
    roleFocus: WORKER_ROLES[idx % WORKER_ROLES.length],
    status: 'HEALTHY',
    activeTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    memoryMb: 68 + idx * 9,
    cpuPct: 11 + idx * 3,
    lastHeartbeatIso: nowIso,
    restartCount: 0,
  }));

  return {
    budget,
    desiredWorkers: initialCount,
    workers,
    queueDepth: 0,
    inFlightSignalIds: [],
    processedSignalIds: [],
    processedClientOrderIds: [],
    duplicateExecutionsPrevented: 0,
    maintenanceBlocksCount: 0,
    updatedAtIso: nowIso,
    auditLog: [
      {
        id: `wrk-init-${nowMs}`,
        timestampIso: nowIso,
        action: 'POOL_INITIALIZED',
        detail: `Initialized bounded worker pool (${initialCount}/${budget.maxWorkers} workers, max ${budget.maxConcurrentExecutions} concurrent executions).`,
      },
    ],
  };
}

export interface ScalePoolResult {
  readonly ok: boolean;
  readonly code:
    | 'SCALED'
    | 'BLOCKED_MAINTENANCE_ACTIVE'
    | 'BLOCKED_RESOURCE_BUDGET'
    | 'NO_CHANGE';
  readonly reason: string;
  readonly state: ControlledWorkerPoolState;
}

export function scaleWorkerPoolControlled(
  pool: ControlledWorkerPoolState,
  targetWorkers: number,
  maintenanceState: SafeMaintenanceState,
  emergencyStopActive = false,
  nowMs = Date.now()
): ScalePoolResult {
  const nowIso = new Date(nowMs).toISOString();
  const clamped = Math.max(
    pool.budget.minWorkers,
    Math.min(pool.budget.maxWorkers, Math.round(targetWorkers))
  );

  if (clamped !== Math.round(targetWorkers)) {
    return {
      ok: false,
      code: 'BLOCKED_RESOURCE_BUDGET',
      reason: `Requested worker count (${targetWorkers}) exceeds bounded pool limits [${pool.budget.minWorkers}..${pool.budget.maxWorkers}].`,
      state: {
        ...pool,
        updatedAtIso: nowIso,
        auditLog: appendAudit(
          pool.auditLog,
          'SCALE_BLOCKED_BUDGET',
          `Rejected scale to ${targetWorkers} workers (bounds ${pool.budget.minWorkers}-${pool.budget.maxWorkers}).`,
          nowMs
        ),
      },
    };
  }

  // Maintenance / Emergency Stop blocks scaling UP new execution capacity
  const maintGate = evaluateMaintenanceOrderGate(maintenanceState, {
    kind: 'NEW_ENTRY',
    source: 'SELF_HEALING',
  });
  if ((!maintGate.allowed || emergencyStopActive) && clamped > pool.workers.length) {
    return {
      ok: false,
      code: 'BLOCKED_MAINTENANCE_ACTIVE',
      reason: emergencyStopActive
        ? 'Emergency Stop active — worker scale-up blocked.'
        : `Safe Maintenance Mode (${maintenanceState.state}) active — worker scaling cannot override maintenance lock.`,
      state: {
        ...pool,
        maintenanceBlocksCount: pool.maintenanceBlocksCount + 1,
        workers: pool.workers.map((w) => ({ ...w, status: 'PAUSED_MAINTENANCE' })),
        updatedAtIso: nowIso,
        auditLog: appendAudit(
          pool.auditLog,
          'SCALE_BLOCKED_MAINTENANCE',
          `Blocked scale-up to ${clamped} workers during ${emergencyStopActive ? 'EMERGENCY_STOP' : maintenanceState.state}.`,
          nowMs
        ),
      },
    };
  }

  if (clamped === pool.workers.length) {
    return {
      ok: true,
      code: 'NO_CHANGE',
      reason: `Worker pool already operating at ${clamped} worker(s).`,
      state: pool,
    };
  }

  const nextWorkers: ManagedWorkerNode[] = [...pool.workers];
  if (clamped > nextWorkers.length) {
    for (let idx = nextWorkers.length; idx < clamped; idx++) {
      nextWorkers.push({
        workerId: `sf-worker-${idx + 1}`,
        roleFocus: WORKER_ROLES[idx % WORKER_ROLES.length],
        status: maintGate.allowed && !emergencyStopActive ? 'HEALTHY' : 'PAUSED_MAINTENANCE',
        activeTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        memoryMb: 64 + idx * 8,
        cpuPct: 10 + idx * 2,
        lastHeartbeatIso: nowIso,
        restartCount: 0,
      });
    }
  } else {
    nextWorkers.length = clamped;
  }

  const direction = clamped > pool.workers.length ? 'SCALE_UP' : 'SCALE_DOWN';
  return {
    ok: true,
    code: 'SCALED',
    reason: `Controlled ${direction === 'SCALE_UP' ? 'scale-up' : 'scale-down'} to ${clamped}/${pool.budget.maxWorkers} workers.`,
    state: {
      ...pool,
      desiredWorkers: clamped,
      workers: nextWorkers,
      updatedAtIso: nowIso,
      auditLog: appendAudit(
        pool.auditLog,
        direction,
        `Pool resized from ${pool.workers.length} to ${clamped} workers.`,
        nowMs
      ),
    },
  };
}

export interface ExecutionLockAttempt {
  readonly signalId: string;
  readonly clientOrderId: string;
  readonly workerId?: string;
}

export interface ExecutionLockDecision {
  readonly acquired: boolean;
  readonly code:
    | 'LOCK_ACQUIRED'
    | 'BLOCKED_DUPLICATE_SIGNAL'
    | 'BLOCKED_DUPLICATE_CLIENT_ORDER_ID'
    | 'BLOCKED_CONCURRENCY_LIMIT'
    | 'BLOCKED_MAINTENANCE_ACTIVE';
  readonly assignedWorkerId: string | null;
  readonly reason: string;
  readonly state: ControlledWorkerPoolState;
}

/**
 * Atomic, idempotent execution lock ensuring two workers can NEVER execute
 * the same signal or clientOrderId independently, and honoring Safe Maintenance Mode.
 */
export function acquireIdempotentExecutionLock(
  pool: ControlledWorkerPoolState,
  attempt: ExecutionLockAttempt,
  maintenanceState: SafeMaintenanceState,
  emergencyStopActive = false,
  nowMs = Date.now()
): ExecutionLockDecision {
  const nowIso = new Date(nowMs).toISOString();

  const maintGate = evaluateMaintenanceOrderGate(maintenanceState, {
    kind: 'NEW_ENTRY',
    source: 'AI_SIGNAL',
    clientOrderId: attempt.clientOrderId,
  });

  if (!maintGate.allowed || emergencyStopActive) {
    return {
      acquired: false,
      code: 'BLOCKED_MAINTENANCE_ACTIVE',
      assignedWorkerId: null,
      reason: emergencyStopActive
        ? 'Emergency Stop active — worker execution dispatch blocked.'
        : maintGate.reason,
      state: {
        ...pool,
        maintenanceBlocksCount: pool.maintenanceBlocksCount + 1,
        workers: pool.workers.map((w) => ({ ...w, status: 'PAUSED_MAINTENANCE' })),
        updatedAtIso: nowIso,
        auditLog: appendAudit(
          pool.auditLog,
          'EXECUTION_BLOCKED_MAINTENANCE',
          `Blocked dispatch for ${attempt.signalId} (${attempt.clientOrderId}) — ${emergencyStopActive ? 'EMERGENCY_STOP' : maintenanceState.state}.`,
          nowMs
        ),
      },
    };
  }

  if (
    pool.inFlightSignalIds.includes(attempt.signalId) ||
    pool.processedSignalIds.includes(attempt.signalId)
  ) {
    return {
      acquired: false,
      code: 'BLOCKED_DUPLICATE_SIGNAL',
      assignedWorkerId: null,
      reason: `Idempotency guard prevented duplicate execution of signal ${attempt.signalId}.`,
      state: {
        ...pool,
        duplicateExecutionsPrevented: pool.duplicateExecutionsPrevented + 1,
        updatedAtIso: nowIso,
        auditLog: appendAudit(
          pool.auditLog,
          'DUPLICATE_EXECUTION_PREVENTED',
          `Duplicate signalId ${attempt.signalId} rejected across worker pool.`,
          nowMs
        ),
      },
    };
  }

  if (pool.processedClientOrderIds.includes(attempt.clientOrderId)) {
    return {
      acquired: false,
      code: 'BLOCKED_DUPLICATE_CLIENT_ORDER_ID',
      assignedWorkerId: null,
      reason: `Idempotency guard prevented duplicate clientOrderId ${attempt.clientOrderId}.`,
      state: {
        ...pool,
        duplicateExecutionsPrevented: pool.duplicateExecutionsPrevented + 1,
        updatedAtIso: nowIso,
        auditLog: appendAudit(
          pool.auditLog,
          'DUPLICATE_EXECUTION_PREVENTED',
          `Duplicate clientOrderId ${attempt.clientOrderId} rejected across worker pool.`,
          nowMs
        ),
      },
    };
  }

  if (pool.inFlightSignalIds.length >= pool.budget.maxConcurrentExecutions) {
    return {
      acquired: false,
      code: 'BLOCKED_CONCURRENCY_LIMIT',
      assignedWorkerId: null,
      reason: `Max concurrent execution limit (${pool.budget.maxConcurrentExecutions}) reached; task queued safely.`,
      state: {
        ...pool,
        queueDepth: Math.min(pool.budget.maxQueueDepth, pool.queueDepth + 1),
        updatedAtIso: nowIso,
      },
    };
  }

  const chosenWorker =
    pool.workers.find((w) => w.workerId === attempt.workerId && w.status === 'HEALTHY') ??
    [...pool.workers].sort((a, b) => a.activeTasks - b.activeTasks)[0];

  if (!chosenWorker) {
    return {
      acquired: false,
      code: 'BLOCKED_CONCURRENCY_LIMIT',
      assignedWorkerId: null,
      reason: 'No healthy worker available in pool.',
      state: pool,
    };
  }

  const nextWorkers = pool.workers.map((w) =>
    w.workerId === chosenWorker.workerId
      ? { ...w, status: 'HEALTHY' as const, activeTasks: w.activeTasks + 1, lastHeartbeatIso: nowIso }
      : w
  );

  return {
    acquired: true,
    code: 'LOCK_ACQUIRED',
    assignedWorkerId: chosenWorker.workerId,
    reason: `Worker ${chosenWorker.workerId} acquired exclusive idempotency lock for ${attempt.signalId}.`,
    state: {
      ...pool,
      workers: nextWorkers,
      inFlightSignalIds: [...pool.inFlightSignalIds, attempt.signalId],
      processedClientOrderIds: [...pool.processedClientOrderIds, attempt.clientOrderId].slice(-250),
      updatedAtIso: nowIso,
      auditLog: appendAudit(
        pool.auditLog,
        'DISPATCH_ACQUIRED',
        `${chosenWorker.workerId} locked ${attempt.signalId} (${attempt.clientOrderId}).`,
        nowMs
      ),
    },
  };
}

export function releaseExecutionLock(
  pool: ControlledWorkerPoolState,
  params: { signalId: string; workerId: string; succeeded: boolean },
  nowMs = Date.now()
): ControlledWorkerPoolState {
  const nowIso = new Date(nowMs).toISOString();
  return {
    ...pool,
    inFlightSignalIds: pool.inFlightSignalIds.filter((id) => id !== params.signalId),
    processedSignalIds: pool.processedSignalIds.includes(params.signalId)
      ? pool.processedSignalIds
      : [...pool.processedSignalIds, params.signalId].slice(-250),
    workers: pool.workers.map((w) =>
      w.workerId === params.workerId
        ? {
            ...w,
            activeTasks: Math.max(0, w.activeTasks - 1),
            completedTasks: params.succeeded ? w.completedTasks + 1 : w.completedTasks,
            failedTasks: params.succeeded ? w.failedTasks : w.failedTasks + 1,
            lastHeartbeatIso: nowIso,
          }
        : w
    ),
    updatedAtIso: nowIso,
    auditLog: appendAudit(
      pool.auditLog,
      'DISPATCH_COMPLETED',
      `${params.workerId} finished ${params.signalId} (${params.succeeded ? 'OK' : 'FAILED'}).`,
      nowMs
    ),
  };
}

/**
 * Controlled worker health recovery: NEVER bypasses Safe Maintenance Mode.
 */
export function restartDegradedWorker(
  pool: ControlledWorkerPoolState,
  workerId: string,
  maintenanceState: SafeMaintenanceState,
  nowMs = Date.now()
): { ok: boolean; reason: string; state: ControlledWorkerPoolState } {
  const nowIso = new Date(nowMs).toISOString();
  const target = pool.workers.find((w) => w.workerId === workerId);
  if (!target) {
    return { ok: false, reason: `Worker ${workerId} not found.`, state: pool };
  }

  if (maintenanceState.state !== 'NORMAL' || maintenanceState.integrityCorrupted) {
    return {
      ok: false,
      reason: `Self-healing restart cannot re-enable execution while Safe Maintenance Mode (${maintenanceState.state}) is active.`,
      state: {
        ...pool,
        maintenanceBlocksCount: pool.maintenanceBlocksCount + 1,
        updatedAtIso: nowIso,
        auditLog: appendAudit(
          pool.auditLog,
          'SELF_HEAL_BLOCKED_MAINTENANCE',
          `Blocked self-healing restart of ${workerId} under ${maintenanceState.state}.`,
          nowMs
        ),
      },
    };
  }

  return {
    ok: true,
    reason: `Worker ${workerId} cleanly restarted and synchronized with shared pool state.`,
    state: {
      ...pool,
      workers: pool.workers.map((w) =>
        w.workerId === workerId
          ? {
              ...w,
              status: 'HEALTHY',
              activeTasks: 0,
              restartCount: w.restartCount + 1,
              lastHeartbeatIso: nowIso,
            }
          : w
      ),
      updatedAtIso: nowIso,
      auditLog: appendAudit(
        pool.auditLog,
        'WORKER_RESTARTED',
        `Restarted worker ${workerId} (total restarts: ${target.restartCount + 1}).`,
        nowMs
      ),
    },
  };
}

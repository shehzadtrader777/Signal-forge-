import {
  DEFAULT_CONTROL_MATRIX,
  type GranularControlMatrix,
  type GranularToggleKey,
  type MicroserviceId,
} from '../lib/controlMatrix';
import {
  ORDERED_MICROSERVICE_IDS,
  applyControlMatrixUpdate,
  createInitialPlatformState,
  recordServiceSuccess,
  reportServiceFault,
  rollbackToSnapshot,
  setServiceLifecycle,
  triggerManualFailover,
  type ErrorSeverity,
  type FailoverNodeRole,
  type MicroserviceErrorEntry,
  type MicroservicePlatformState,
} from '../lib/microserviceArchitecture';

function createServiceMutex() {
  let queue: Promise<void> = Promise.resolve();
  return {
    runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
      const next = queue.then(() => fn());
      queue = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    },
  };
}

class MicroserviceCoordinatorRuntime {
  private state: MicroservicePlatformState = createInitialPlatformState(DEFAULT_CONTROL_MATRIX);
  private readonly serviceMutexes: Record<MicroserviceId, ReturnType<typeof createServiceMutex>> = {
    'market-data-svc': createServiceMutex(),
    'ai-agents-svc': createServiceMutex(),
    'execution-router-svc': createServiceMutex(),
    'risk-kernel-svc': createServiceMutex(),
    'telemetry-bus-svc': createServiceMutex(),
  };
  private readonly stateMutationMutex = createServiceMutex();

  getSnapshot(): MicroservicePlatformState {
    return this.state;
  }

  getControlMatrix(): GranularControlMatrix {
    return this.state.controlMatrix;
  }

  isServiceAvailable(serviceId: MicroserviceId): {
    available: boolean;
    reason?: string;
  } {
    const svc = this.state.services[serviceId];
    if (!svc) return { available: false, reason: `Unknown microservice ${serviceId}` };
    if (svc.lifecycle === 'DECOMMISSIONED') {
      return {
        available: false,
        reason: `Microservice ${serviceId} is DECOMMISSIONED.`,
      };
    }
    if (svc.lifecycle === 'ISOLATED' || svc.circuitBreaker === 'OPEN') {
      return {
        available: false,
        reason: `Microservice ${serviceId} circuit breaker OPEN (fault isolated from sibling engines).`,
      };
    }
    return { available: true };
  }

  async executeIsolated<T>(
    serviceId: MicroserviceId,
    operationCode: string,
    fn: () => Promise<T> | T,
    opts?: { severity?: ErrorSeverity; contextSummary?: string }
  ): Promise<{ ok: true; value: T } | { ok: false; isolatedError: MicroserviceErrorEntry }> {
    return this.serviceMutexes[serviceId].runExclusive(async () => {
      const avail = this.isServiceAvailable(serviceId);
      if (!avail.available) {
        const fault = reportServiceFault(this.state, {
          serviceId,
          code: `${operationCode}_BLOCKED_ISOLATED`,
          message: avail.reason || `${serviceId} unavailable`,
          severity: 'WARN',
          contextSummary: opts?.contextSummary,
        });
        this.state = fault.state;
        return { ok: false, isolatedError: fault.errorEntry };
      }

      const svc = this.state.services[serviceId];
      if (svc.bulkheadInFlight >= svc.bulkheadConcurrencyLimit) {
        const fault = reportServiceFault(this.state, {
          serviceId,
          code: `${operationCode}_BULKHEAD_SATURATED`,
          message: `Bulkhead concurrency ceiling (${svc.bulkheadConcurrencyLimit}) reached on ${serviceId}`,
          severity: 'WARN',
          contextSummary: opts?.contextSummary,
        });
        this.state = fault.state;
        return { ok: false, isolatedError: fault.errorEntry };
      }

      const t0 = performance.now();
      this.state = {
        ...this.state,
        services: {
          ...this.state.services,
          [serviceId]: {
            ...this.state.services[serviceId],
            bulkheadInFlight: this.state.services[serviceId].bulkheadInFlight + 1,
          },
        },
      };

      try {
        const value = await fn();
        const elapsed = Math.max(1, Math.round(performance.now() - t0));
        this.state = recordServiceSuccess(this.state, serviceId, elapsed);
        return { ok: true, value };
      } catch (err) {
        const fault = reportServiceFault(this.state, {
          serviceId,
          code: operationCode,
          message: err,
          severity: opts?.severity ?? 'ERROR',
          contextSummary: opts?.contextSummary,
        });
        this.state = fault.state;
        return { ok: false, isolatedError: fault.errorEntry };
      } finally {
        const current = this.state.services[serviceId];
        this.state = {
          ...this.state,
          services: {
            ...this.state.services,
            [serviceId]: {
              ...current,
              bulkheadInFlight: Math.max(0, current.bulkheadInFlight - 1),
            },
          },
        };
      }
    });
  }

  async updateControlMatrix(
    patch: Partial<GranularControlMatrix>,
    actorUid: string,
    reason?: string
  ): Promise<{
    state: MicroservicePlatformState;
    snapshotId: string;
    changedKeys: GranularToggleKey[];
  }> {
    return this.stateMutationMutex.runExclusive(() => {
      const res = applyControlMatrixUpdate(
        this.state,
        patch,
        actorUid,
        reason || 'Workspace Control Matrix update'
      );
      this.state = res.state;
      return res;
    });
  }

  async failoverService(
    serviceId: MicroserviceId,
    targetNode: FailoverNodeRole,
    reason: string
  ): Promise<MicroservicePlatformState> {
    return this.stateMutationMutex.runExclusive(() => {
      this.state = triggerManualFailover(this.state, serviceId, targetNode, reason);
      return this.state;
    });
  }

  async updateServiceLifecycle(
    serviceId: MicroserviceId,
    lifecycle: 'ACTIVE' | 'ISOLATED' | 'DECOMMISSIONED',
    reason: string
  ): Promise<MicroservicePlatformState> {
    return this.stateMutationMutex.runExclusive(() => {
      this.state = setServiceLifecycle(this.state, serviceId, lifecycle, reason);
      return this.state;
    });
  }

  async rollback(
    snapshotId: string,
    actorUid: string,
    reason: string
  ): Promise<{
    ok: boolean;
    state: MicroservicePlatformState;
    error?: string;
  }> {
    return this.stateMutationMutex.runExclusive(() => {
      const res = rollbackToSnapshot(
        this.state,
        snapshotId,
        'MANUAL_OPERATOR',
        actorUid,
        reason
      );
      if (res.ok) {
        this.state = res.state;
      }
      return {
        ok: res.ok,
        state: this.state,
        error: res.error,
      };
    });
  }

  async injectFaultDrill(input: {
    serviceId: MicroserviceId;
    severity: ErrorSeverity;
    code: string;
    message: string;
    burstCount?: number;
  }): Promise<{
    state: MicroservicePlatformState;
    failoverTriggered: boolean;
    rollbackTriggered: boolean;
    recordedErrors: MicroserviceErrorEntry[];
  }> {
    return this.stateMutationMutex.runExclusive(() => {
      const count = Math.min(4, Math.max(1, Number(input.burstCount ?? 1)));
      let failoverTriggered = false;
      let rollbackTriggered = false;
      const recordedErrors: MicroserviceErrorEntry[] = [];

      for (let i = 0; i < count; i++) {
        const res = reportServiceFault(this.state, {
          serviceId: input.serviceId,
          code: input.code,
          message: input.message,
          severity: input.severity,
          contextSummary: `Fault isolation drill #${i + 1} on ${input.serviceId}`,
        });
        this.state = res.state;
        failoverTriggered = failoverTriggered || res.failoverTriggered;
        rollbackTriggered = rollbackTriggered || res.rollbackTriggered;
        recordedErrors.push(res.errorEntry);
      }

      return {
        state: this.state,
        failoverTriggered,
        rollbackTriggered,
        recordedErrors,
      };
    });
  }

  recordNonBlockingFault(input: {
    serviceId: MicroserviceId;
    code: string;
    message: unknown;
    severity?: ErrorSeverity;
    contextSummary?: string;
  }): MicroserviceErrorEntry {
    const res = reportServiceFault(this.state, input);
    this.state = res.state;
    return res.errorEntry;
  }

  recordNonBlockingSuccess(serviceId: MicroserviceId, latencyMs: number): void {
    this.state = recordServiceSuccess(this.state, serviceId, latencyMs);
  }

  getServiceHealthSummary() {
    return ORDERED_MICROSERVICE_IDS.map((id) => this.state.services[id]);
  }
}

export const GLOBAL_MICROSERVICE_COORDINATOR = new MicroserviceCoordinatorRuntime();

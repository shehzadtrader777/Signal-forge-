/**
 * Modular TypeScript v5+ Abstract Pipeline Architecture
 *
 * Provides reusable abstract base classes for backend computation modules,
 * deterministic validators, interval stream batchers, and multi-language
 * IPC/RPC service bridges (Python / Rust / Go worker compatibility).
 */

export type PipelineModuleRuntime = 'TYPESCRIPT_NODE' | 'PYTHON_WORKER' | 'RUST_ENGINE' | 'GO_ROUTER';

export interface MultiLangModuleEnvelope<TPayload = unknown> {
  protocolVersion: '2.0';
  moduleId: string;
  runtime: PipelineModuleRuntime;
  correlationId: string;
  timestampMs: number;
  payload: TPayload;
}

export interface PipelineModuleHealth {
  moduleId: string;
  moduleName: string;
  runtime: PipelineModuleRuntime;
  status: 'ACTIVE' | 'DEGRADED' | 'IDLE';
  executionsTotal: number;
  errorsTotal: number;
  avgLatencyMs: number;
  lastExecutedAt: string | null;
}

/**
 * Reusable abstract base class for decoupled computational & AI pipeline services.
 * Offloads heavy calculations to backend workers while enforcing uniform telemetry,
 * error isolation, and multi-language serialization contracts.
 */
export abstract class BaseSignalPipelineModule<TInput, TOutput> {
  public readonly moduleId: string;
  public readonly moduleName: string;
  public readonly runtime: PipelineModuleRuntime;

  protected executionsTotal = 0;
  protected errorsTotal = 0;
  protected cumulativeLatencyMs = 0;
  protected lastExecutedAt: string | null = null;
  protected initialized = false;

  constructor(
    moduleId: string,
    moduleName: string,
    runtime: PipelineModuleRuntime = 'TYPESCRIPT_NODE'
  ) {
    this.moduleId = moduleId;
    this.moduleName = moduleName;
    this.runtime = runtime;
  }

  public init(): void {
    this.initialized = true;
  }

  protected abstract executeCore(input: TInput): TOutput;

  public process(input: TInput): TOutput {
    if (!this.initialized) {
      this.init();
    }
    const started = Date.now();
    try {
      const output = this.executeCore(input);
      const elapsed = Math.max(0.1, Date.now() - started);
      this.executionsTotal += 1;
      this.cumulativeLatencyMs += elapsed;
      this.lastExecutedAt = new Date().toISOString();
      return output;
    } catch (err) {
      this.errorsTotal += 1;
      throw err;
    }
  }

  public healthCheck(): PipelineModuleHealth {
    const avgLatencyMs =
      this.executionsTotal > 0
        ? Number((this.cumulativeLatencyMs / this.executionsTotal).toFixed(2))
        : 0;
    const errorRate = this.executionsTotal > 0 ? this.errorsTotal / this.executionsTotal : 0;
    return {
      moduleId: this.moduleId,
      moduleName: this.moduleName,
      runtime: this.runtime,
      status: errorRate > 0.2 ? 'DEGRADED' : this.executionsTotal > 0 ? 'ACTIVE' : 'IDLE',
      executionsTotal: this.executionsTotal,
      errorsTotal: this.errorsTotal,
      avgLatencyMs,
      lastExecutedAt: this.lastExecutedAt,
    };
  }

  public serializeForBridge<TPayload>(
    payload: TPayload,
    correlationId = `${this.moduleId}_${Date.now()}`
  ): MultiLangModuleEnvelope<TPayload> {
    return {
      protocolVersion: '2.0',
      moduleId: this.moduleId,
      runtime: this.runtime,
      correlationId,
      timestampMs: Date.now(),
      payload,
    };
  }
}

/**
 * Reusable abstract validator enforcing synchronous deterministic gating rules
 * (e.g., Entry Zone validation, Pre-Pump support confirmation, max-target exit lock).
 */
export abstract class BaseExecutionValidator<TContext, TDecision> {
  public readonly validatorId: string;

  constructor(validatorId: string) {
    this.validatorId = validatorId;
  }

  public abstract evaluate(context: TContext): TDecision;
}

/**
 * Reusable abstract stream batcher for high-frequency WebSocket/SSE data pipelines.
 * Coalesces bursts into calibrated time slices to preserve a locked 120Hz UI frame budget.
 */
export abstract class BaseStreamBatcher<TKey extends string, TFrame> {
  protected pendingMap = new Map<TKey, TFrame>();
  protected totalFramesIngested = 0;
  protected totalBatchesFlushed = 0;
  protected lastFlushAtMs = 0;

  public abstract extractKey(frame: TFrame): TKey;

  public enqueue(frame: TFrame): void {
    const key = this.extractKey(frame);
    this.pendingMap.set(key, frame);
    this.totalFramesIngested += 1;
  }

  public enqueueMany(frames: readonly TFrame[]): void {
    for (const frame of frames) {
      this.enqueue(frame);
    }
  }

  public get pendingCount(): number {
    return this.pendingMap.size;
  }

  public flush(nowMs = Date.now()): TFrame[] {
    if (this.pendingMap.size === 0) return [];
    const batch = Array.from(this.pendingMap.values());
    this.pendingMap.clear();
    this.totalBatchesFlushed += 1;
    this.lastFlushAtMs = nowMs;
    return batch;
  }

  public getMetrics(): {
    totalFramesIngested: number;
    totalBatchesFlushed: number;
    coalesceRatio: number;
    pendingCount: number;
    lastFlushAtMs: number;
  } {
    const coalesceRatio =
      this.totalBatchesFlushed > 0
        ? Number((this.totalFramesIngested / this.totalBatchesFlushed).toFixed(2))
        : 1;
    return {
      totalFramesIngested: this.totalFramesIngested,
      totalBatchesFlushed: this.totalBatchesFlushed,
      coalesceRatio,
      pendingCount: this.pendingMap.size,
      lastFlushAtMs: this.lastFlushAtMs,
    };
  }
}

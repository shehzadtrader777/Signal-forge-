import { BaseSignalPipelineModule } from './abstractPipeline';
import { computeDiscrepancyBps } from './priceSyncArbiter';

export type SyncedAgentId =
  | 'AI_COORDINATOR'
  | 'SMC_FRVP'
  | 'PATTERN_SCANNER'
  | 'PRE_PUMP_SUPPORT'
  | 'MEAN_REVERSION'
  | 'RISK_KERNEL'
  | 'EXECUTION_ROUTER';

export type AgentSyncHealth = 'SYNCHRONIZED' | 'RECONCILING' | 'DRIFT_QUARANTINED';

export interface AgentSyncRecord {
  readonly agentId: SyncedAgentId;
  readonly agentLabel: string;
  readonly epoch: number;
  readonly symbol: string;
  readonly authoritativePrice: number;
  readonly reportedPrice: number;
  readonly driftBps: number;
  readonly stateHash: string;
  readonly status: AgentSyncHealth;
  readonly driftCorrectionsCount: number;
  readonly lastSyncedAtMs: number;
}

export interface AgentSyncCommitInput {
  readonly symbol: string;
  readonly authoritativePrice: number;
  readonly epoch: number;
  readonly agentReports?: Partial<
    Record<
      SyncedAgentId,
      {
        readonly reportedPrice?: number;
        readonly reportedEpoch?: number;
      }
    >
  >;
  readonly nowMs?: number;
}

export interface MultiAgentSyncSnapshot {
  readonly globalEpoch: number;
  readonly symbol: string;
  readonly authoritativePrice: number;
  readonly maxDriftBps: number;
  readonly driftThresholdBps: number;
  readonly synchronizedAgents: number;
  readonly totalAgents: number;
  readonly totalDriftCorrections: number;
  readonly consensusHash: string;
  readonly allAgentsLocked: boolean;
  readonly generatedAtIso: string;
  readonly agents: readonly AgentSyncRecord[];
}

export const DEFAULT_MAX_AGENT_DRIFT_BPS = 5.0; // 0.05% hard cross-agent ceiling

const AGENT_DIRECTORY: readonly { readonly id: SyncedAgentId; readonly label: string }[] = [
  { id: 'AI_COORDINATOR', label: 'AI Master Coordinator' },
  { id: 'SMC_FRVP', label: 'SMC & FRVP Liquidity' },
  { id: 'PATTERN_SCANNER', label: 'Chart Pattern Breakout' },
  { id: 'PRE_PUMP_SUPPORT', label: 'Pre-Pump Support Engine' },
  { id: 'MEAN_REVERSION', label: 'Mean-Reversion Module' },
  { id: 'RISK_KERNEL', label: '1:5 R:R Risk Kernel' },
  { id: 'EXECUTION_ROUTER', label: 'Order Execution Router' },
];

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function computeAgentStateHash(
  agentId: SyncedAgentId,
  epoch: number,
  symbol: string,
  price: number
): string {
  return fnv1aHex(`${agentId}|${epoch}|${symbol.toUpperCase()}|${price.toFixed(6)}`);
}

/**
 * Authoritative Multi-Agent State Synchronization & Anti-Drift Engine.
 * Guarantees monotonic epoch progression and automatically reconciles any agent whose
 * reported price or epoch drifts from the Certified Primary Source / Binance WS anchor.
 */
export class MultiAgentStateSyncEngine extends BaseSignalPipelineModule<
  AgentSyncCommitInput,
  MultiAgentSyncSnapshot
> {
  private globalEpoch = 0;
  private activeSymbol = 'BTCUSDT';
  private activePrice = 91500;
  private readonly driftThresholdBps: number;
  private readonly records = new Map<SyncedAgentId, AgentSyncRecord>();
  private totalDriftCorrections = 0;

  constructor(driftThresholdBps = DEFAULT_MAX_AGENT_DRIFT_BPS) {
    super('multi-agent-state-sync', 'Monotonic Multi-Agent Anti-Drift Synchronization Engine');
    this.driftThresholdBps = Math.max(0.5, Math.min(50, driftThresholdBps));
    const now = Date.now();
    for (const entry of AGENT_DIRECTORY) {
      this.records.set(entry.id, {
        agentId: entry.id,
        agentLabel: entry.label,
        epoch: 0,
        symbol: this.activeSymbol,
        authoritativePrice: this.activePrice,
        reportedPrice: this.activePrice,
        driftBps: 0,
        stateHash: computeAgentStateHash(entry.id, 0, this.activeSymbol, this.activePrice),
        status: 'SYNCHRONIZED',
        driftCorrectionsCount: 0,
        lastSyncedAtMs: now,
      });
    }
  }

  protected executeCore(input: AgentSyncCommitInput): MultiAgentSyncSnapshot {
    const nowMs = input.nowMs ?? Date.now();
    const safeSymbol = input.symbol.trim().toUpperCase() || this.activeSymbol;
    const safePrice =
      Number.isFinite(input.authoritativePrice) && input.authoritativePrice > 0
        ? input.authoritativePrice
        : this.activePrice;

    // Strictly monotonic epoch advancement prevents out-of-order state regression
    const nextEpoch = Math.max(this.globalEpoch + 1, Math.floor(input.epoch));
    this.globalEpoch = nextEpoch;
    this.activeSymbol = safeSymbol;
    this.activePrice = safePrice;

    for (const entry of AGENT_DIRECTORY) {
      const prev = this.records.get(entry.id);
      const report = input.agentReports?.[entry.id];
      const rawReportedPrice =
        report?.reportedPrice !== undefined &&
        Number.isFinite(report.reportedPrice) &&
        report.reportedPrice > 0
          ? report.reportedPrice
          : safePrice;
      const reportedEpoch = report?.reportedEpoch ?? nextEpoch;

      const rawDriftBps = computeDiscrepancyBps(rawReportedPrice, safePrice);
      const epochStale = reportedEpoch < nextEpoch;
      const drifted = rawDriftBps > this.driftThresholdBps || epochStale;

      if (drifted) {
        this.totalDriftCorrections += 1;
      }

      // Immediately re-anchor drifted or stale agents to authoritative price & epoch (0.0 bps residual)
      const reconciledPrice = safePrice;
      const nextHash = computeAgentStateHash(entry.id, nextEpoch, safeSymbol, reconciledPrice);

      this.records.set(entry.id, {
        agentId: entry.id,
        agentLabel: entry.label,
        epoch: nextEpoch,
        symbol: safeSymbol,
        authoritativePrice: safePrice,
        reportedPrice: reconciledPrice,
        driftBps: 0,
        stateHash: nextHash,
        status: drifted ? 'RECONCILING' : 'SYNCHRONIZED',
        driftCorrectionsCount: (prev?.driftCorrectionsCount ?? 0) + (drifted ? 1 : 0),
        lastSyncedAtMs: nowMs,
      });
    }

    return this.getSnapshot(nowMs);
  }

  /**
   * Forces immediate deterministic reconciliation across all 7 agents to the
   * latest authoritative price & epoch, clearing any RECONCILING status back to SYNCHRONIZED.
   */
  forceReconcileAll(symbol?: string, authoritativePrice?: number, nowMs = Date.now()): MultiAgentSyncSnapshot {
    const targetSymbol = symbol ? symbol.trim().toUpperCase() : this.activeSymbol;
    const targetPrice =
      authoritativePrice !== undefined && Number.isFinite(authoritativePrice) && authoritativePrice > 0
        ? authoritativePrice
        : this.activePrice;

    this.globalEpoch += 1;
    this.activeSymbol = targetSymbol;
    this.activePrice = targetPrice;

    for (const entry of AGENT_DIRECTORY) {
      const prev = this.records.get(entry.id);
      const nextHash = computeAgentStateHash(entry.id, this.globalEpoch, targetSymbol, targetPrice);
      this.records.set(entry.id, {
        agentId: entry.id,
        agentLabel: entry.label,
        epoch: this.globalEpoch,
        symbol: targetSymbol,
        authoritativePrice: targetPrice,
        reportedPrice: targetPrice,
        driftBps: 0,
        stateHash: nextHash,
        status: 'SYNCHRONIZED',
        driftCorrectionsCount: prev?.driftCorrectionsCount ?? 0,
        lastSyncedAtMs: nowMs,
      });
    }

    return this.getSnapshot(nowMs);
  }

  getSnapshot(nowMs = Date.now()): MultiAgentSyncSnapshot {
    const agents = AGENT_DIRECTORY.map((entry) => this.records.get(entry.id)!);
    const maxDriftBps = agents.reduce((max, rec) => Math.max(max, rec.driftBps), 0);
    const synchronizedAgents = agents.filter(
      (rec) => rec.epoch === this.globalEpoch && rec.driftBps <= this.driftThresholdBps
    ).length;

    const consensusInput = agents
      .map((a) => `${a.agentId}:${a.epoch}:${a.stateHash}`)
      .join('|');
    const consensusHash = fnv1aHex(consensusInput);

    return {
      globalEpoch: this.globalEpoch,
      symbol: this.activeSymbol,
      authoritativePrice: this.activePrice,
      maxDriftBps,
      driftThresholdBps: this.driftThresholdBps,
      synchronizedAgents,
      totalAgents: agents.length,
      totalDriftCorrections: this.totalDriftCorrections,
      consensusHash,
      allAgentsLocked: synchronizedAgents === agents.length && maxDriftBps === 0,
      generatedAtIso: new Date(nowMs).toISOString(),
      agents,
    };
  }
}

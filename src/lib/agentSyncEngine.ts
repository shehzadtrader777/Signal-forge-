import { BaseSignalPipelineModule } from './abstractPipeline';
import { computeDiscrepancyBps } from './priceSyncArbiter';
import type { MarketDataQuality } from './coinGeckoClient';
import type { AgentDataProvenance } from './smartMarketDataRouter';

export type SyncedAgentId =
  | 'AI_COORDINATOR'
  | 'SMC_FRVP'
  | 'PATTERN_SCANNER'
  | 'PRE_PUMP_SUPPORT'
  | 'MEAN_REVERSION'
  | 'RISK_KERNEL'
  | 'EXECUTION_ROUTER';

export type AgentSyncHealth =
  | 'SYNCHRONIZED'
  | 'RECONCILING'
  | 'DRIFT_QUARANTINED'
  | 'DEGRADED_FALLBACK'
  | 'EXECUTION_PAUSED_STALE';

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
  readonly dataProvenance: AgentDataProvenance;
  readonly dataQuality: MarketDataQuality;
  readonly providerName: string;
  readonly dataAgeMs: number | null;
  readonly executionAllowed: boolean;
}

export interface AgentSyncCommitInput {
  readonly symbol: string;
  readonly authoritativePrice: number;
  readonly epoch: number;
  readonly dataProvenance?: AgentDataProvenance;
  readonly dataQuality?: MarketDataQuality;
  readonly providerName?: string;
  readonly dataAgeMs?: number | null;
  readonly executionAllowed?: boolean;
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
  readonly liveDataSynchronized: boolean;
  readonly dataProvenance: AgentDataProvenance;
  readonly dataQuality: MarketDataQuality;
  readonly providerName: string;
  readonly dataAgeMs: number | null;
  readonly executionAllowed: boolean;
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
  price: number,
  provenance: AgentDataProvenance
): string {
  return fnv1aHex(`${agentId}|${epoch}|${symbol.toUpperCase()}|${price.toFixed(6)}|${provenance}`);
}

function resolveDefaultDataQuality(provenance: AgentDataProvenance): MarketDataQuality {
  switch (provenance) {
    case 'LIVE_EXCHANGE':
      return 'LIVE';
    case 'CACHED_EXCHANGE':
      return 'CACHED';
    case 'REFERENCE_AGGREGATED':
      return 'DELAYED';
    case 'HISTORICAL_BACKTEST':
      return 'CACHED';
    case 'SIMULATED_FIXTURE':
      return 'SIMULATED';
    case 'STALE_OR_UNAVAILABLE':
    default:
      return 'UNAVAILABLE';
  }
}

function resolveAgentStatusForProvenance(
  provenance: AgentDataProvenance,
  drifted: boolean
): AgentSyncHealth {
  if (provenance === 'STALE_OR_UNAVAILABLE') {
    return 'EXECUTION_PAUSED_STALE';
  }
  if (
    provenance === 'SIMULATED_FIXTURE' ||
    provenance === 'REFERENCE_AGGREGATED' ||
    provenance === 'CACHED_EXCHANGE' ||
    provenance === 'HISTORICAL_BACKTEST'
  ) {
    return 'DEGRADED_FALLBACK';
  }
  return drifted ? 'RECONCILING' : 'SYNCHRONIZED';
}

/**
 * Authoritative Multi-Agent State Synchronization & Anti-Drift Engine.
 * Guarantees monotonic epoch progression, tracks exact market data provenance,
 * and refuses to report live SYNCHRONIZED status when backed by fallback,
 * simulated, reference-only, or stale/unavailable feeds.
 */
export class MultiAgentStateSyncEngine extends BaseSignalPipelineModule<
  AgentSyncCommitInput,
  MultiAgentSyncSnapshot
> {
  private globalEpoch = 0;
  private activeSymbol = 'BTCUSDT';
  private activePrice = 0;
  private activeProvenance: AgentDataProvenance = 'STALE_OR_UNAVAILABLE';
  private activeQuality: MarketDataQuality = 'UNAVAILABLE';
  private activeProvider = 'none';
  private activeDataAgeMs: number | null = null;
  private activeExecutionAllowed = false;
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
        authoritativePrice: 0,
        reportedPrice: 0,
        driftBps: 0,
        stateHash: computeAgentStateHash(
          entry.id,
          0,
          this.activeSymbol,
          0,
          'STALE_OR_UNAVAILABLE'
        ),
        status: 'EXECUTION_PAUSED_STALE',
        driftCorrectionsCount: 0,
        lastSyncedAtMs: now,
        dataProvenance: 'STALE_OR_UNAVAILABLE',
        dataQuality: 'UNAVAILABLE',
        providerName: 'none',
        dataAgeMs: null,
        executionAllowed: false,
      });
    }
  }

  protected executeCore(input: AgentSyncCommitInput): MultiAgentSyncSnapshot {
    const nowMs = input.nowMs ?? Date.now();
    const safeSymbol = input.symbol.trim().toUpperCase() || this.activeSymbol;
    const hasValidPrice = Number.isFinite(input.authoritativePrice) && input.authoritativePrice > 0;
    const provenance: AgentDataProvenance =
      input.dataProvenance ?? (hasValidPrice ? 'LIVE_EXCHANGE' : 'STALE_OR_UNAVAILABLE');
    const quality: MarketDataQuality = input.dataQuality ?? resolveDefaultDataQuality(provenance);
    const providerName =
      input.providerName ?? (provenance === 'LIVE_EXCHANGE' ? 'binance_spot' : 'none');
    const dataAgeMs = input.dataAgeMs !== undefined ? input.dataAgeMs : null;
    const executionAllowed =
      input.executionAllowed !== undefined
        ? Boolean(input.executionAllowed) && provenance === 'LIVE_EXCHANGE' && hasValidPrice
        : provenance === 'LIVE_EXCHANGE' && hasValidPrice;

    const safePrice = hasValidPrice
      ? input.authoritativePrice
      : provenance === 'STALE_OR_UNAVAILABLE'
      ? 0
      : this.activePrice;

    // Strictly monotonic epoch advancement prevents out-of-order state regression
    const nextEpoch = Math.max(this.globalEpoch + 1, Math.floor(input.epoch));
    this.globalEpoch = nextEpoch;
    this.activeSymbol = safeSymbol;
    this.activePrice = safePrice;
    this.activeProvenance = provenance;
    this.activeQuality = quality;
    this.activeProvider = providerName;
    this.activeDataAgeMs = dataAgeMs;
    this.activeExecutionAllowed = executionAllowed;

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

      const rawDriftBps =
        safePrice > 0 && rawReportedPrice > 0
          ? computeDiscrepancyBps(rawReportedPrice, safePrice)
          : 0;
      const epochStale = reportedEpoch < nextEpoch;
      const drifted = rawDriftBps > this.driftThresholdBps || epochStale;

      if (drifted) {
        this.totalDriftCorrections += 1;
      }

      const reconciledPrice = safePrice;
      const nextHash = computeAgentStateHash(
        entry.id,
        nextEpoch,
        safeSymbol,
        reconciledPrice,
        provenance
      );

      this.records.set(entry.id, {
        agentId: entry.id,
        agentLabel: entry.label,
        epoch: nextEpoch,
        symbol: safeSymbol,
        authoritativePrice: safePrice,
        reportedPrice: reconciledPrice,
        driftBps: 0,
        stateHash: nextHash,
        status: resolveAgentStatusForProvenance(provenance, drifted),
        driftCorrectionsCount: (prev?.driftCorrectionsCount ?? 0) + (drifted ? 1 : 0),
        lastSyncedAtMs: nowMs,
        dataProvenance: provenance,
        dataQuality: quality,
        providerName,
        dataAgeMs,
        executionAllowed,
      });
    }

    return this.getSnapshot(nowMs);
  }

  /**
   * Forces immediate deterministic reconciliation across all 7 agents to the
   * latest authoritative price & epoch, preserving honest data provenance.
   */
  forceReconcileAll(
    symbol?: string,
    authoritativePrice?: number,
    nowMs = Date.now(),
    provenanceOverride?: {
      dataProvenance?: AgentDataProvenance;
      dataQuality?: MarketDataQuality;
      providerName?: string;
      dataAgeMs?: number | null;
      executionAllowed?: boolean;
    }
  ): MultiAgentSyncSnapshot {
    const targetSymbol = symbol ? symbol.trim().toUpperCase() : this.activeSymbol;
    const hasPrice =
      authoritativePrice !== undefined &&
      Number.isFinite(authoritativePrice) &&
      authoritativePrice > 0;
    const targetPrice = hasPrice ? authoritativePrice : this.activePrice;

    const provenance: AgentDataProvenance =
      provenanceOverride?.dataProvenance ??
      (hasPrice ? 'LIVE_EXCHANGE' : this.activeProvenance);
    const quality: MarketDataQuality =
      provenanceOverride?.dataQuality ?? resolveDefaultDataQuality(provenance);
    const providerName =
      provenanceOverride?.providerName ??
      (provenance === 'LIVE_EXCHANGE' ? 'binance_spot' : this.activeProvider);
    const dataAgeMs =
      provenanceOverride?.dataAgeMs !== undefined
        ? provenanceOverride.dataAgeMs
        : this.activeDataAgeMs;
    const executionAllowed =
      provenanceOverride?.executionAllowed !== undefined
        ? Boolean(provenanceOverride.executionAllowed) && provenance === 'LIVE_EXCHANGE' && targetPrice > 0
        : provenance === 'LIVE_EXCHANGE' && targetPrice > 0;

    this.globalEpoch += 1;
    this.activeSymbol = targetSymbol;
    this.activePrice = targetPrice;
    this.activeProvenance = provenance;
    this.activeQuality = quality;
    this.activeProvider = providerName;
    this.activeDataAgeMs = dataAgeMs;
    this.activeExecutionAllowed = executionAllowed;

    const targetStatus = resolveAgentStatusForProvenance(provenance, false);

    for (const entry of AGENT_DIRECTORY) {
      const prev = this.records.get(entry.id);
      const nextHash = computeAgentStateHash(
        entry.id,
        this.globalEpoch,
        targetSymbol,
        targetPrice,
        provenance
      );
      this.records.set(entry.id, {
        agentId: entry.id,
        agentLabel: entry.label,
        epoch: this.globalEpoch,
        symbol: targetSymbol,
        authoritativePrice: targetPrice,
        reportedPrice: targetPrice,
        driftBps: 0,
        stateHash: nextHash,
        status: targetStatus,
        driftCorrectionsCount: prev?.driftCorrectionsCount ?? 0,
        lastSyncedAtMs: nowMs,
        dataProvenance: provenance,
        dataQuality: quality,
        providerName,
        dataAgeMs,
        executionAllowed,
      });
    }

    return this.getSnapshot(nowMs);
  }

  getSnapshot(nowMs = Date.now()): MultiAgentSyncSnapshot {
    const agents = AGENT_DIRECTORY.map((entry) => this.records.get(entry.id)!);
    const maxDriftBps = agents.reduce((max, rec) => Math.max(max, rec.driftBps), 0);
    const liveDataSynchronized =
      this.activeProvenance === 'LIVE_EXCHANGE' && this.activePrice > 0 && this.globalEpoch > 0;
    const synchronizedAgents = liveDataSynchronized
      ? agents.filter(
          (rec) => rec.epoch === this.globalEpoch && rec.driftBps <= this.driftThresholdBps
        ).length
      : 0;

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
      allAgentsLocked: liveDataSynchronized && synchronizedAgents === agents.length && maxDriftBps === 0,
      liveDataSynchronized,
      dataProvenance: this.activeProvenance,
      dataQuality: this.activeQuality,
      providerName: this.activeProvider,
      dataAgeMs: this.activeDataAgeMs,
      executionAllowed: this.activeExecutionAllowed,
      generatedAtIso: new Date(nowMs).toISOString(),
      agents,
    };
  }
}

import { canonicalStringify, sha256Hex } from './bindingLayer';
import {
  CACHE_POLICY_TABLE,
  CERTIFIED_PRIMARY_SOURCE_CONFIG,
  CertifiedPriceOracle,
  GLOBAL_CPS_ORACLE,
  PRISTINE_DATA_INVARIANT_MANIFEST,
  type CpsAlertEvent,
  type CpsPrimaryTickInput,
} from './certifiedPrimarySource';
import {
  createInitialRiskEngineState,
  recordTradeOutcomeInRiskState,
  type MarketRegimeForRisk,
  type RiskEngineState,
} from './riskEngine';

/* ═══════════════════════════════════════════════════════════════════════════
 * FORCE SIGNAL — EVENT-SOURCED STATE & THREE-TIER RECURRING RESET RUNTIME
 *
 * Implements Deliverable 4:
 *   - Event-sourced equity, PnL, position, and HWM fold over fill_stream
 *   - Versioned regime write-through cache validated by feature_sequence
 *   - Live reconciler freshness precondition (no cache; fail-closed if starved)
 *   - Drawdown ledger freshness gate (applied_fill_sequence == head_sequence)
 *   - Three-Tier Recurring Reset (Per-Decision / 1s Watchdog / 15m Hard Reset)
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface FillStreamEvent {
  readonly fill_sequence: number;
  readonly strategyId: string;
  readonly symbol: string;
  readonly regime: MarketRegimeForRisk;
  readonly realizedPnlUsd: number;
  readonly positionDeltaQty?: number;
  readonly fillPrice?: number;
  readonly side?: 'BUY' | 'SELL';
  readonly timestampUtc: string;
}

export interface EventSourcedPosition {
  readonly symbol: string;
  readonly strategyId: string;
  readonly netQty: number;
  readonly avgEntryPrice: number;
  readonly realizedPnlUsd: number;
  readonly unrealizedMtmUsd: number;
}

export interface MaterializedDrawdownView {
  readonly applied_fill_sequence: number;
  readonly initial_equity: number;
  readonly realized_pnl: number;
  readonly unrealized_mtm: number;
  readonly current_equity: number;
  readonly hwm_equity: number;
  readonly riskEngineState: RiskEngineState;
  readonly positions: Readonly<Record<string, EventSourcedPosition>>;
  readonly rebuiltAtMs: number;
  readonly view_hash: string;
}

export interface VersionedRegimeCacheEntry {
  readonly regime: MarketRegimeForRisk;
  readonly feature_sequence: number;
  readonly updatedAtMs: number;
}

export interface ReconcilerLiveState {
  readonly healthy: boolean;
  readonly lastReconciledAtMs: number;
  readonly maxStalenessMs: number;
  readonly discrepancyUsd: number;
}

export interface HardResetAuditRecord {
  readonly resetId: string;
  readonly eventType: 'CACHE_HARD_RESET';
  readonly triggerReason:
    | 'SCHEDULED_15M'
    | 'PRICE_SOURCE_DIVERGENCE'
    | 'STALE_STATE_DETECTED'
    | 'INTEGRITY_FAILURE'
    | 'MANUAL_INTERVENTION'
    | 'DEPLOYMENT_TRANSITION';
  readonly preResetCpsSeq: number;
  readonly postResetCpsSeq: number;
  readonly preResetFillSeq: number;
  readonly postResetFillSeq: number;
  readonly preResetFeatureSeq: number;
  readonly postResetFeatureSeq: number;
  readonly openOrdersPreserved: true;
  readonly permanentLedgerPreserved: true;
  readonly processRestarted: false;
  readonly watchdogPassedAfterReset: boolean;
  readonly timestampUtc: string;
}

export interface WatchdogEvaluationResult {
  readonly healthy: boolean;
  readonly checkedAtMs: number;
  readonly staleSources: ReadonlyArray<string>;
  readonly laggingViews: ReadonlyArray<string>;
  readonly staleRegimeCaches: ReadonlyArray<string>;
  readonly reconcilerStale: boolean;
  readonly alertsEmitted: ReadonlyArray<CpsAlertEvent>;
}

export const TIER_2_WATCHDOG_INTERVAL_MS = 1_000 as const;
export const TIER_3_HARD_RESET_INTERVAL_MS = 15 * 60 * 1_000; // 900_000 ms (15 minutes)
export const DEFAULT_RECONCILER_MAX_STALE_MS = 5_000 as const;

export function rebuildDrawdownViewFromEvents(params: {
  readonly initialCapitalUsd: number;
  readonly strategyIds: ReadonlyArray<string>;
  readonly fillStream: ReadonlyArray<FillStreamEvent>;
  readonly upToSequence: number;
  readonly markPricesBySymbol?: Readonly<Record<string, number>>;
  readonly nowMs?: number;
}): MaterializedDrawdownView {
  let riskState = createInitialRiskEngineState({
    initialCapitalUsd: params.initialCapitalUsd,
    strategyIds: params.strategyIds,
  });

  const positions: Record<string, EventSourcedPosition> = {};
  let realizedPnl = 0;
  let runningEquity = params.initialCapitalUsd;
  let hwmEquity = params.initialCapitalUsd;
  let appliedSeq = 0;

  const sorted = [...params.fillStream]
    .filter((f) => f.fill_sequence <= params.upToSequence)
    .sort((a, b) => a.fill_sequence - b.fill_sequence);

  for (const ev of sorted) {
    if (ev.fill_sequence !== appliedSeq + 1) {
      throw new Error(
        `STALE_STATE: Non-contiguous fill_stream sequence (expected ${appliedSeq + 1}, got ${ev.fill_sequence}).`
      );
    }
    appliedSeq = ev.fill_sequence;
    realizedPnl = Number((realizedPnl + ev.realizedPnlUsd).toFixed(4));
    runningEquity = Number(Math.max(0, params.initialCapitalUsd + realizedPnl).toFixed(4));
    hwmEquity = Math.max(hwmEquity, runningEquity);

    if (ev.realizedPnlUsd !== 0) {
      riskState = recordTradeOutcomeInRiskState(riskState, {
        strategyId: ev.strategyId,
        regime: ev.regime,
        pnlUsd: ev.realizedPnlUsd,
      });
    }

    const posKey = `${ev.strategyId}:${ev.symbol}`;
    const prevPos = positions[posKey] ?? {
      symbol: ev.symbol,
      strategyId: ev.strategyId,
      netQty: 0,
      avgEntryPrice: 0,
      realizedPnlUsd: 0,
      unrealizedMtmUsd: 0,
    };
    const deltaQty = ev.positionDeltaQty ?? 0;
    const fillPx = ev.fillPrice ?? prevPos.avgEntryPrice;
    const nextQty = Number((prevPos.netQty + deltaQty).toFixed(8));
    let nextAvg = prevPos.avgEntryPrice;
    if (Math.abs(nextQty) < 1e-9) {
      nextAvg = 0;
    } else if (deltaQty !== 0 && prevPos.netQty === 0) {
      nextAvg = fillPx;
    } else if (deltaQty !== 0 && Math.sign(deltaQty) === Math.sign(prevPos.netQty)) {
      nextAvg =
        (Math.abs(prevPos.netQty) * prevPos.avgEntryPrice + Math.abs(deltaQty) * fillPx) /
        (Math.abs(prevPos.netQty) + Math.abs(deltaQty));
    }

    const mark = params.markPricesBySymbol?.[ev.symbol] ?? nextAvg;
    const uMtm =
      Math.abs(nextQty) > 1e-9 && mark > 0 && nextAvg > 0
        ? Number((nextQty * (mark - nextAvg)).toFixed(4))
        : 0;

    positions[posKey] = Object.freeze({
      symbol: ev.symbol,
      strategyId: ev.strategyId,
      netQty: Math.abs(nextQty) < 1e-9 ? 0 : nextQty,
      avgEntryPrice: Number(nextAvg.toFixed(6)),
      realizedPnlUsd: Number((prevPos.realizedPnlUsd + ev.realizedPnlUsd).toFixed(4)),
      unrealizedMtmUsd: uMtm,
    });
  }

  const unrealizedMtm = Number(
    Object.values(positions)
      .reduce((acc, p) => acc + p.unrealizedMtmUsd, 0)
      .toFixed(4)
  );
  const currentEquity = Number(
    Math.max(0, params.initialCapitalUsd + realizedPnl + unrealizedMtm).toFixed(4)
  );
  hwmEquity = Math.max(hwmEquity, currentEquity);

  const viewHash = sha256Hex(
    canonicalStringify({
      appliedSeq,
      realizedPnl,
      unrealizedMtm,
      currentEquity,
      hwmEquity,
      riskEngineState: riskState,
      positions,
    })
  );

  return Object.freeze({
    applied_fill_sequence: appliedSeq,
    initial_equity: params.initialCapitalUsd,
    realized_pnl: realizedPnl,
    unrealized_mtm: unrealizedMtm,
    current_equity: currentEquity,
    hwm_equity: hwmEquity,
    riskEngineState: riskState,
    positions: Object.freeze(positions),
    rebuiltAtMs: params.nowMs ?? Date.now(),
    view_hash: viewHash,
  });
}

export class DataIntegrityRuntime {
  readonly priceOracle: CertifiedPriceOracle;
  private readonly initialCapitalUsd: number;
  private readonly strategyIds: ReadonlyArray<string>;
  private readonly fillStream: FillStreamEvent[] = [];
  private fillHeadSequence = 0;
  private featureHeadSequence = 0;
  private ddView: MaterializedDrawdownView;
  private regimeCache: VersionedRegimeCacheEntry | null = null;
  private reconcilerState: ReconcilerLiveState;
  private openExchangeOrdersCount = 0;
  private staleStateBlockedNextDecision = false;
  private lastStaleReason: string | null = null;
  private lastHardResetAtMs: number;
  private lastWatchdogAtMs: number;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private hardResetTimer: ReturnType<typeof setInterval> | null = null;
  private readonly hardResetHistory: HardResetAuditRecord[] = [];
  private resetCounter = 0;
  private corruptRebuildInjector: (() => boolean) | null = null;

  constructor(params?: {
    readonly initialCapitalUsd?: number;
    readonly strategyIds?: ReadonlyArray<string>;
    readonly nowMsFn?: () => number;
    readonly priceOracle?: CertifiedPriceOracle;
  }) {
    this.priceOracle =
      params?.priceOracle ?? new CertifiedPriceOracle({ nowMsFn: params?.nowMsFn });
    this.initialCapitalUsd = params?.initialCapitalUsd ?? 25_000;
    this.strategyIds = params?.strategyIds ?? [
      'SPOT_MOMENTUM',
      'FUTURES_COORDINATOR',
      'SMC_FRVP_DESK',
      'ARB_COPY_DESK',
      'AUTONOMOUS_AI_AGENTS',
      'SMC_1_5',
    ];
    const now = this.priceOracle.nowMs();
    this.ddView = rebuildDrawdownViewFromEvents({
      initialCapitalUsd: this.initialCapitalUsd,
      strategyIds: this.strategyIds,
      fillStream: [],
      upToSequence: 0,
      nowMs: now,
    });
    this.regimeCache = Object.freeze({
      regime: 'NORMAL',
      feature_sequence: 0,
      updatedAtMs: now,
    });
    this.reconcilerState = Object.freeze({
      healthy: true,
      lastReconciledAtMs: now,
      maxStalenessMs: DEFAULT_RECONCILER_MAX_STALE_MS,
      discrepancyUsd: 0,
    });
    this.lastHardResetAtMs = now;
    this.lastWatchdogAtMs = now;
  }

  startSchedulers(): void {
    if (!this.watchdogTimer) {
      this.watchdogTimer = setInterval(() => {
        this.runStalenessWatchdogTick();
      }, TIER_2_WATCHDOG_INTERVAL_MS);
      if (typeof this.watchdogTimer.unref === 'function') {
        this.watchdogTimer.unref();
      }
    }
    if (!this.hardResetTimer) {
      this.hardResetTimer = setInterval(() => {
        this.triggerTier3HardReset('SCHEDULED_15M');
      }, TIER_3_HARD_RESET_INTERVAL_MS);
      if (typeof this.hardResetTimer.unref === 'function') {
        this.hardResetTimer.unref();
      }
    }
  }

  stopSchedulers(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.hardResetTimer) {
      clearInterval(this.hardResetTimer);
      this.hardResetTimer = null;
    }
  }

  setOpenExchangeOrdersCount(count: number): void {
    this.openExchangeOrdersCount = Math.max(0, Math.trunc(count));
  }

  getOpenExchangeOrdersCount(): number {
    return this.openExchangeOrdersCount;
  }

  recordFillEvent(params: {
    readonly strategyId: string;
    readonly symbol: string;
    readonly regime: MarketRegimeForRisk;
    readonly realizedPnlUsd: number;
    readonly positionDeltaQty?: number;
    readonly fillPrice?: number;
    readonly side?: 'BUY' | 'SELL';
    readonly skipMaterializedViewUpdate?: boolean;
  }): FillStreamEvent {
    const seq = ++this.fillHeadSequence;
    const ev: FillStreamEvent = Object.freeze({
      fill_sequence: seq,
      strategyId: params.strategyId,
      symbol: params.symbol,
      regime: params.regime,
      realizedPnlUsd: params.realizedPnlUsd,
      positionDeltaQty: params.positionDeltaQty,
      fillPrice: params.fillPrice,
      side: params.side,
      timestampUtc: new Date(this.priceOracle.nowMs()).toISOString(),
    });
    this.fillStream.push(ev);

    if (!params.skipMaterializedViewUpdate) {
      this.ddView = rebuildDrawdownViewFromEvents({
        initialCapitalUsd: this.initialCapitalUsd,
        strategyIds: this.strategyIds,
        fillStream: this.fillStream,
        upToSequence: this.fillHeadSequence,
        nowMs: this.priceOracle.nowMs(),
      });
    }
    return ev;
  }

  getFillStream(): ReadonlyArray<FillStreamEvent> {
    return Object.freeze([...this.fillStream]);
  }

  getFillHeadSequence(): number {
    return this.fillHeadSequence;
  }

  updateRegimeCache(regime: MarketRegimeForRisk, featureSequence: number): void {
    this.featureHeadSequence = Math.max(this.featureHeadSequence, featureSequence);
    this.regimeCache = Object.freeze({
      regime,
      feature_sequence: featureSequence,
      updatedAtMs: this.priceOracle.nowMs(),
    });
  }

  advanceFeatureStreamSequence(newSeq: number): void {
    this.featureHeadSequence = Math.max(this.featureHeadSequence, newSeq);
  }

  readRegimeState(): {
    readonly valid: boolean;
    readonly regime: MarketRegimeForRisk;
    readonly stale: boolean;
    readonly reason?: string;
  } {
    if (!this.regimeCache || this.regimeCache.feature_sequence !== this.featureHeadSequence) {
      return {
        valid: false,
        regime: this.regimeCache?.regime ?? 'NORMAL',
        stale: true,
        reason: `Versioned regime cache stale (cache_seq=${this.regimeCache?.feature_sequence ?? -1} !== feature_head=${this.featureHeadSequence}).`,
      };
    }
    return {
      valid: true,
      regime: this.regimeCache.regime,
      stale: false,
    };
  }

  updateReconcilerState(patch: Partial<ReconcilerLiveState>): void {
    this.reconcilerState = Object.freeze({
      ...this.reconcilerState,
      ...patch,
    });
  }

  isReconcilerFresh(nowMs = this.priceOracle.nowMs()): {
    readonly fresh: boolean;
    readonly ageMs: number;
    readonly reason?: string;
  } {
    const ageMs = Math.max(0, nowMs - this.reconcilerState.lastReconciledAtMs);
    if (!this.reconcilerState.healthy || ageMs > this.reconcilerState.maxStalenessMs) {
      return {
        fresh: false,
        ageMs,
        reason: `STALE_STATE: reconciler starved or unhealthy (age=${ageMs}ms > max=${this.reconcilerState.maxStalenessMs}ms, healthy=${this.reconcilerState.healthy}).`,
      };
    }
    return { fresh: true, ageMs };
  }

  injectCorruptMaterializedView(corruptView: Partial<MaterializedDrawdownView>): void {
    this.ddView = Object.freeze({
      ...this.ddView,
      ...corruptView,
    });
  }

  setRebuildFailureInjector(fn: (() => boolean) | null): void {
    this.corruptRebuildInjector = fn;
  }

  getMaterializedViewRaw(): MaterializedDrawdownView {
    return this.ddView;
  }

  /**
   * Deliverable 4.3 Mandatory Freshness Gate before any DD evaluation:
   * Checks applied_fill_sequence == fill_stream.head_sequence; if lagging or hash tampered,
   * rebuilds from fill_stream events and re-asserts equality; fails closed with STALE_STATE on error.
   */
  verifyAndGetFreshDrawdownView(options?: { readonly failOnLagWithoutRebuild?: boolean }):
    | { readonly ok: true; readonly view: MaterializedDrawdownView; readonly rebuilt: boolean }
    | { readonly ok: false; readonly code: 'STALE_STATE'; readonly reason: string } {
    if (this.staleStateBlockedNextDecision) {
      return {
        ok: false,
        code: 'STALE_STATE',
        reason: this.lastStaleReason ?? 'STALE_STATE: Watchdog flagged stale state; awaiting Tier-3 recovery.',
      };
    }

    const expectedRebuild = rebuildDrawdownViewFromEvents({
      initialCapitalUsd: this.initialCapitalUsd,
      strategyIds: this.strategyIds,
      fillStream: this.fillStream,
      upToSequence: this.fillHeadSequence,
      nowMs: this.priceOracle.nowMs(),
    });

    const seqLag = this.ddView.applied_fill_sequence !== this.fillHeadSequence;
    const hashMismatch = this.ddView.view_hash !== expectedRebuild.view_hash;

    if (seqLag || hashMismatch) {
      if (options?.failOnLagWithoutRebuild) {
        return {
          ok: false,
          code: 'STALE_STATE',
          reason: `STALE_STATE: DD view watermark (${this.ddView.applied_fill_sequence}) !== fill_stream.head (${this.fillHeadSequence}) or hash corrupted.`,
        };
      }
      if (this.corruptRebuildInjector && this.corruptRebuildInjector()) {
        return {
          ok: false,
          code: 'STALE_STATE',
          reason: 'STALE_STATE: Event-sourced DD view rebuild failed.',
        };
      }
      this.ddView = expectedRebuild;
      if (this.ddView.applied_fill_sequence !== this.fillHeadSequence) {
        return {
          ok: false,
          code: 'STALE_STATE',
          reason: `STALE_STATE: Post-rebuild watermark mismatch (${this.ddView.applied_fill_sequence} !== ${this.fillHeadSequence}).`,
        };
      }
      return { ok: true, view: this.ddView, rebuilt: true };
    }

    return { ok: true, view: this.ddView, rebuilt: false };
  }

  runStalenessWatchdogTick(nowMs = this.priceOracle.nowMs()): WatchdogEvaluationResult {
    this.lastWatchdogAtMs = nowMs;
    const staleSources: string[] = [];
    const laggingViews: string[] = [];
    const staleRegimeCaches: string[] = [];
    const emitted: CpsAlertEvent[] = [];

    for (const inst of this.priceOracle.getTrackedInstruments()) {
      if (
        !inst.connected ||
        inst.gapDetected ||
        inst.divergenceDetected ||
        inst.sourceMixedViolation ||
        inst.currentFreshnessMs === null ||
        inst.currentFreshnessMs > inst.freshnessCeilingMs
      ) {
        staleSources.push(inst.instrument);
      }
    }

    if (this.ddView.applied_fill_sequence !== this.fillHeadSequence) {
      laggingViews.push(
        `dd_view(${this.ddView.applied_fill_sequence}<${this.fillHeadSequence})`
      );
    }

    const regimeStatus = this.readRegimeState();
    if (!regimeStatus.valid) {
      staleRegimeCaches.push(regimeStatus.reason ?? 'regime_cache_stale');
    }

    const rec = this.isReconcilerFresh(nowMs);
    const healthy =
      staleSources.length === 0 &&
      laggingViews.length === 0 &&
      staleRegimeCaches.length === 0 &&
      rec.fresh;

    if (!healthy) {
      const reason = `STALE_STATE_DETECTED: sources=[${staleSources.join(',')}], views=[${laggingViews.join(',')}], regime=[${staleRegimeCaches.join(',')}], reconcilerFresh=${rec.fresh}.`;
      this.staleStateBlockedNextDecision = true;
      this.lastStaleReason = reason;
      emitted.push(
        Object.freeze({
          id: `wd_alert_${nowMs}_${this.alertsForWatchdogCount()}`,
          code: 'STALE_STATE_DETECTED',
          severity: 'CRITICAL',
          detail: reason,
          timestampUtc: new Date(nowMs).toISOString(),
        })
      );
    }

    if (nowMs - this.lastHardResetAtMs >= TIER_3_HARD_RESET_INTERVAL_MS) {
      this.triggerTier3HardReset('SCHEDULED_15M', nowMs);
    }

    return Object.freeze({
      healthy,
      checkedAtMs: nowMs,
      staleSources: Object.freeze(staleSources),
      laggingViews: Object.freeze(laggingViews),
      staleRegimeCaches: Object.freeze(staleRegimeCaches),
      reconcilerStale: !rec.fresh,
      alertsEmitted: Object.freeze(emitted),
    });
  }

  private alertsForWatchdogCount(): number {
    return this.hardResetHistory.length + this.priceOracle.getAlerts().length + 1;
  }

  triggerTier3HardReset(
    triggerReason: HardResetAuditRecord['triggerReason'],
    nowMs = this.priceOracle.nowMs(),
    reprimeTicks?: ReadonlyArray<{ readonly tick: CpsPrimaryTickInput; readonly secondaryPrice?: number }>
  ): HardResetAuditRecord {
    const trackedBefore = this.priceOracle.getTrackedInstruments();
    const preResetCpsSeq = trackedBefore.reduce((m, s) => Math.max(m, s.lastConsumedSequence), 0);
    const preResetFillSeq = this.ddView.applied_fill_sequence;
    const preResetFeatureSeq = this.regimeCache?.feature_sequence ?? 0;

    const currentRegime = this.regimeCache?.regime ?? 'NORMAL';
    this.regimeCache = null;

    if (reprimeTicks && reprimeTicks.length > 0) {
      for (const item of reprimeTicks) {
        this.priceOracle.reprimeInstrument(item.tick.instrument, item.tick, item.secondaryPrice);
      }
    }

    this.ddView = rebuildDrawdownViewFromEvents({
      initialCapitalUsd: this.initialCapitalUsd,
      strategyIds: this.strategyIds,
      fillStream: this.fillStream,
      upToSequence: this.fillHeadSequence,
      nowMs,
    });

    this.regimeCache = Object.freeze({
      regime: currentRegime,
      feature_sequence: this.featureHeadSequence,
      updatedAtMs: nowMs,
    });

    this.reconcilerState = Object.freeze({
      ...this.reconcilerState,
      healthy: true,
      lastReconciledAtMs: nowMs,
    });
    this.staleStateBlockedNextDecision = false;
    this.lastStaleReason = null;
    this.lastHardResetAtMs = nowMs;

    const trackedAfter = this.priceOracle.getTrackedInstruments();
    const postResetCpsSeq = trackedAfter.reduce((m, s) => Math.max(m, s.lastConsumedSequence), 0);
    const postResetFillSeq = this.ddView.applied_fill_sequence;
    const postResetFeatureSeq = this.regimeCache.feature_sequence;

    const postWatchdog = this.runStalenessWatchdogTick(nowMs);
    const record: HardResetAuditRecord = Object.freeze({
      resetId: `hard_reset_${++this.resetCounter}`,
      eventType: 'CACHE_HARD_RESET',
      triggerReason,
      preResetCpsSeq,
      postResetCpsSeq,
      preResetFillSeq,
      postResetFillSeq,
      preResetFeatureSeq,
      postResetFeatureSeq,
      openOrdersPreserved: true,
      permanentLedgerPreserved: true,
      processRestarted: false,
      watchdogPassedAfterReset: postWatchdog.healthy,
      timestampUtc: new Date(nowMs).toISOString(),
    });
    this.hardResetHistory.unshift(record);
    if (this.hardResetHistory.length > 50) {
      this.hardResetHistory.length = 50;
    }
    return record;
  }

  getHardResetHistory(): ReadonlyArray<HardResetAuditRecord> {
    return Object.freeze([...this.hardResetHistory]);
  }

  getDiagnosticSnapshot() {
    const now = this.priceOracle.nowMs();
    return Object.freeze({
      cpsKernelHash: this.priceOracle.getKernelHash(),
      sourceTable: Object.values(CERTIFIED_PRIMARY_SOURCE_CONFIG.entries),
      invariants: PRISTINE_DATA_INVARIANT_MANIFEST,
      cachePolicyTable: CACHE_POLICY_TABLE,
      threeTierResetSchedule: Object.freeze({
        tier1: 'Per-Decision begin_decision()/end_decision() atomic snapshot lifecycle',
        tier2WatchdogIntervalMs: TIER_2_WATCHDOG_INTERVAL_MS,
        tier3HardResetIntervalMs: TIER_3_HARD_RESET_INTERVAL_MS,
        lastWatchdogAtUtc: new Date(this.lastWatchdogAtMs).toISOString(),
        lastHardResetAtUtc: new Date(this.lastHardResetAtMs).toISOString(),
      }),
      ddViewWatermark: Object.freeze({
        applied_fill_sequence: this.ddView.applied_fill_sequence,
        fill_stream_head_sequence: this.fillHeadSequence,
        current_equity: this.ddView.current_equity,
        hwm_equity: this.ddView.hwm_equity,
        view_hash: this.ddView.view_hash,
      }),
      regimeCacheVersion: Object.freeze({
        cached_feature_sequence: this.regimeCache?.feature_sequence ?? -1,
        feature_stream_head_sequence: this.featureHeadSequence,
        regime: this.regimeCache?.regime ?? 'NORMAL',
      }),
      reconcilerFreshness: this.isReconcilerFresh(now),
      trackedInstruments: this.priceOracle.getTrackedInstruments(),
      recentHardResets: this.hardResetHistory.slice(0, 10),
      recentAlerts: this.priceOracle.getAlerts().slice(0, 15),
    });
  }
}

export const GLOBAL_DATA_INTEGRITY_RUNTIME = new DataIntegrityRuntime({
  priceOracle: GLOBAL_CPS_ORACLE,
});

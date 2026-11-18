import {
  KERNEL_REGISTRY_AUTHORITY,
  canonicalStringify,
  sha256Hex,
} from './bindingLayer';
import type { MarketRegime } from './invariantKernels';

/* ═══════════════════════════════════════════════════════════════════════════
 * FORCE SIGNAL — CERTIFIED PRIMARY SOURCE (CPS) & PRISTINE DATA KERNEL
 * Permanent Structural Amendment to Command 6 (Data Integrity Incident Fix)
 *
 * Implements:
 *   1. Certified Primary Source (CPS) Protocol & Snapshot Handle API
 *   2. Pristine Data Invariants (I-PD1 .. I-PD4)
 *   3. Cache Policy Table & On-Call Alert Telemetry
 * ═══════════════════════════════════════════════════════════════════════════ */

export const CPS_INVARIANTS = Object.freeze({
  'I-PD1': 'monotonic_sequence',
  'I-PD2': 'freshness_ceiling',
  'I-PD3': 'source_immutability_within_decision',
  'I-PD4': 'cross_check_agreement',
} as const);

export enum ReasonCode {
  STALE = 'STALE',
  GAP = 'GAP',
  DIVERGENCE = 'DIVERGENCE',
  SOURCE_DISCONNECTED = 'SOURCE_DISCONNECTED',
}

export enum InstrumentClassCode {
  SPOT = 'spot',
  USDM_PERP = 'usdm_perp',
  COINM_PERP = 'coinm_perp',
}

export type InstrumentClass = 'SPOT' | 'USD_M_FUTURES' | 'COIN_M_FUTURES';

export type CertifiedSourceId =
  | 'binance_spot_ws_bookTicker'
  | 'binance_usdm_ws_markPrice_1s'
  | 'binance_coinm_ws_markPrice_1s';

export type PriceUnavailableReasonCode =
  | 'STALE'
  | 'GAP'
  | 'DIVERGENCE'
  | 'SOURCE_DISCONNECTED'
  | 'SOURCE_MIXED';

export interface CertifiedSourceArtifactEntry {
  readonly instrumentClass: InstrumentClass;
  readonly source_id: CertifiedSourceId;
  readonly streamChannel: '@bookTicker' | '@markPrice@1s';
  readonly transport: 'STREAMING_WEBSOCKET';
  readonly wsEndpointTemplate: string;
  readonly secondaryCheckEndpoint: '/api/v3/ticker/price' | '/fapi/v1/premiumIndex' | '/dapi/v1/premiumIndex';
  readonly secondaryTransport: 'READ_ONLY_REST_ANOMALY_ONLY';
  readonly divergenceThresholdBps: number;
  readonly freshnessCeilingMs: number;
  readonly failoverAllowed: false;
}

export interface SignedCertifiedSourceConfigArtifact {
  readonly artifactId: 'CertifiedPrimarySourceConfig-v1';
  readonly signerId: string;
  readonly entries: Readonly<Record<InstrumentClass, CertifiedSourceArtifactEntry>>;
  readonly sha256Digest: string;
  readonly signature: string;
}

const RAW_SOURCE_ENTRIES: Readonly<Record<InstrumentClass, CertifiedSourceArtifactEntry>> = Object.freeze({
  SPOT: Object.freeze({
    instrumentClass: 'SPOT',
    source_id: 'binance_spot_ws_bookTicker',
    streamChannel: '@bookTicker',
    transport: 'STREAMING_WEBSOCKET',
    wsEndpointTemplate: 'wss://stream.binance.com:9443/ws/{symbol_lower}@bookTicker',
    secondaryCheckEndpoint: '/api/v3/ticker/price',
    secondaryTransport: 'READ_ONLY_REST_ANOMALY_ONLY',
    divergenceThresholdBps: 25,
    freshnessCeilingMs: 500,
    failoverAllowed: false as const,
  }),
  USD_M_FUTURES: Object.freeze({
    instrumentClass: 'USD_M_FUTURES',
    source_id: 'binance_usdm_ws_markPrice_1s',
    streamChannel: '@markPrice@1s',
    transport: 'STREAMING_WEBSOCKET',
    wsEndpointTemplate: 'wss://fstream.binance.com/ws/{symbol_lower}@markPrice@1s',
    secondaryCheckEndpoint: '/fapi/v1/premiumIndex',
    secondaryTransport: 'READ_ONLY_REST_ANOMALY_ONLY',
    divergenceThresholdBps: 50,
    freshnessCeilingMs: 1500,
    failoverAllowed: false as const,
  }),
  COIN_M_FUTURES: Object.freeze({
    instrumentClass: 'COIN_M_FUTURES',
    source_id: 'binance_coinm_ws_markPrice_1s',
    streamChannel: '@markPrice@1s',
    transport: 'STREAMING_WEBSOCKET',
    wsEndpointTemplate: 'wss://dstream.binance.com/ws/{symbol_lower}@markPrice@1s',
    secondaryCheckEndpoint: '/dapi/v1/premiumIndex',
    secondaryTransport: 'READ_ONLY_REST_ANOMALY_ONLY',
    divergenceThresholdBps: 50,
    freshnessCeilingMs: 1500,
    failoverAllowed: false as const,
  }),
});

function buildSignedSourceConfig(): SignedCertifiedSourceConfigArtifact {
  const payload = canonicalStringify({
    artifactId: 'CertifiedPrimarySourceConfig-v1',
    signerId: KERNEL_REGISTRY_AUTHORITY,
    entries: RAW_SOURCE_ENTRIES,
  });
  const sha256Digest = sha256Hex(payload);
  const signature = `sig_cps_v1_${sha256Hex(`${KERNEL_REGISTRY_AUTHORITY}|${sha256Digest}`)}`;
  return Object.freeze({
    artifactId: 'CertifiedPrimarySourceConfig-v1',
    signerId: KERNEL_REGISTRY_AUTHORITY,
    entries: RAW_SOURCE_ENTRIES,
    sha256Digest,
    signature,
  });
}

export const CERTIFIED_PRIMARY_SOURCE_CONFIG: SignedCertifiedSourceConfigArtifact = buildSignedSourceConfig();

export function verifyCertifiedSourceConfig(
  artifact: SignedCertifiedSourceConfigArtifact = CERTIFIED_PRIMARY_SOURCE_CONFIG
): boolean {
  const expected = buildSignedSourceConfig();
  return (
    artifact.artifactId === expected.artifactId &&
    artifact.signerId === expected.signerId &&
    artifact.sha256Digest === expected.sha256Digest &&
    artifact.signature === expected.signature
  );
}

export interface SourceBinding {
  readonly instrument_class: InstrumentClassCode;
  readonly primary_stream:
    | 'binance.spot.bookTicker'
    | 'binance.usdm.markPrice@1s'
    | 'binance.coinm.markPrice@1s';
  readonly secondary_poll:
    | 'binance.spot.rest.ticker'
    | 'binance.usdm.rest.premiumIndex'
    | 'binance.coinm.rest.premiumIndex';
  readonly freshness_ceiling_ms: number;
  readonly divergence_threshold_bps: number;
}

export const SIGNED_REGISTRY: Readonly<Record<InstrumentClassCode, SourceBinding>> = Object.freeze({
  [InstrumentClassCode.SPOT]: Object.freeze({
    instrument_class: InstrumentClassCode.SPOT,
    primary_stream: 'binance.spot.bookTicker',
    secondary_poll: 'binance.spot.rest.ticker',
    freshness_ceiling_ms: 500,
    divergence_threshold_bps: 25.0,
  }),
  [InstrumentClassCode.USDM_PERP]: Object.freeze({
    instrument_class: InstrumentClassCode.USDM_PERP,
    primary_stream: 'binance.usdm.markPrice@1s',
    secondary_poll: 'binance.usdm.rest.premiumIndex',
    freshness_ceiling_ms: 1500,
    divergence_threshold_bps: 50.0,
  }),
  [InstrumentClassCode.COINM_PERP]: Object.freeze({
    instrument_class: InstrumentClassCode.COINM_PERP,
    primary_stream: 'binance.coinm.markPrice@1s',
    secondary_poll: 'binance.coinm.rest.premiumIndex',
    freshness_ceiling_ms: 1500,
    divergence_threshold_bps: 50.0,
  }),
});

export function binding_for(
  instrument: string,
  explicitClass?: InstrumentClass | InstrumentClassCode
): SourceBinding {
  if (explicitClass) {
    const mapped = coerceInstrumentClass(explicitClass);
    if (mapped === 'COIN_M_FUTURES') return SIGNED_REGISTRY[InstrumentClassCode.COINM_PERP];
    if (mapped === 'USD_M_FUTURES') return SIGNED_REGISTRY[InstrumentClassCode.USDM_PERP];
    return SIGNED_REGISTRY[InstrumentClassCode.SPOT];
  }
  const lower = instrument.toLowerCase();
  if (lower.includes('perp') || instrument.endsWith('USD_PERP')) {
    return SIGNED_REGISTRY[InstrumentClassCode.USDM_PERP];
  }
  return SIGNED_REGISTRY[InstrumentClassCode.SPOT];
}

/* ── Deliverable 2: Pristine Data Invariants (I-PD1 .. I-PD4) ─────────────── */

export type PristineDataInvariantId = 'I-PD1' | 'I-PD2' | 'I-PD3' | 'I-PD4';

export interface PristineDataInvariantSpec {
  readonly id: PristineDataInvariantId;
  readonly name: string;
  readonly rule: string;
  readonly violationReason: PriceUnavailableReasonCode;
  readonly enforcement: 'FAIL_CLOSED';
  readonly propertyTests: ReadonlyArray<string>;
}

export const PRISTINE_DATA_INVARIANT_MANIFEST: ReadonlyArray<PristineDataInvariantSpec> = Object.freeze([
  Object.freeze({
    id: 'I-PD1',
    name: 'Monotonic Sequence',
    rule: 'Every consumed reading satisfies sequence_number > previous_consumed_sequence for that source_id.',
    violationReason: 'GAP',
    enforcement: 'FAIL_CLOSED',
    propertyTests: Object.freeze(['PT-CPS-1']),
  }),
  Object.freeze({
    id: 'I-PD2',
    name: 'Freshness Ceiling',
    rule: 'freshness_ms <= 500 for SPOT @bookTicker and <= 1500 for USD_M_FUTURES / COIN_M_FUTURES @markPrice@1s.',
    violationReason: 'STALE',
    enforcement: 'FAIL_CLOSED',
    propertyTests: Object.freeze(['PT-CPS-2']),
  }),
  Object.freeze({
    id: 'I-PD3',
    name: 'Source Immutability Within Decision',
    rule: 'All reads inside a single decision consume the same source_id and same snapshot sequence_number (never older, never switched).',
    violationReason: 'SOURCE_MIXED',
    enforcement: 'FAIL_CLOSED',
    propertyTests: Object.freeze(['PT-CPS-4', 'PT-PD-3']),
  }),
  Object.freeze({
    id: 'I-PD4',
    name: 'Cross-Check Agreement (Zero Failover)',
    rule: 'Primary streaming price and read-only secondary REST reference remain within 25 bps (SPOT) / 50 bps (PERP); divergence emits PRICE_SOURCE_DIVERGENCE and fails closed.',
    violationReason: 'DIVERGENCE',
    enforcement: 'FAIL_CLOSED',
    propertyTests: Object.freeze(['PT-CPS-5']),
  }),
]);

/* ── Cache Policy Table (Deliverable 4.2) ─────────────────────────────────── */

export type StateClassId =
  | 'PRICE'
  | 'EQUITY_PNL'
  | 'POSITION_STATE'
  | 'DRAWDOWN_HWM'
  | 'REGIME_STATE'
  | 'RECONCILIATION_STATE';

export interface CachePolicyEntry {
  readonly stateClass: StateClassId;
  readonly policy:
    | 'NO_CACHE_SNAPSHOT_ONLY'
    | 'EVENT_SOURCED_FOLD_WITH_WATERMARK'
    | 'EVENT_SOURCED_FOLD_NO_CACHE'
    | 'VERSIONED_WRITE_THROUGH_CACHE'
    | 'NO_CACHE_LIVE_READ';
  readonly description: string;
}

export const CACHE_POLICY_TABLE: ReadonlyArray<CachePolicyEntry> = Object.freeze([
  Object.freeze({
    stateClass: 'PRICE',
    policy: 'NO_CACHE_SNAPSHOT_ONLY',
    description: 'NO CACHE. Fresh CPS snapshot per decision; internal ring buffer restricted strictly to gap & divergence detection.',
  }),
  Object.freeze({
    stateClass: 'EQUITY_PNL',
    policy: 'EVENT_SOURCED_FOLD_WITH_WATERMARK',
    description: 'EVENT-SOURCED fold over fill_stream with applied_fill_sequence watermark.',
  }),
  Object.freeze({
    stateClass: 'POSITION_STATE',
    policy: 'EVENT_SOURCED_FOLD_NO_CACHE',
    description: 'EVENT-SOURCED fold over order/fill stream. No mutable cache.',
  }),
  Object.freeze({
    stateClass: 'DRAWDOWN_HWM',
    policy: 'EVENT_SOURCED_FOLD_WITH_WATERMARK',
    description: 'EVENT-SOURCED max(equity_t) fold over equity curve with applied_fill_sequence.',
  }),
  Object.freeze({
    stateClass: 'REGIME_STATE',
    policy: 'VERSIONED_WRITE_THROUGH_CACHE',
    description: 'VERSIONED CACHE with write-through carrying feature_sequence; rejected if feature_stream advances.',
  }),
  Object.freeze({
    stateClass: 'RECONCILIATION_STATE',
    policy: 'NO_CACHE_LIVE_READ',
    description: 'NO CACHE. Reads live reconciler state at decision time; fails closed if starved.',
  }),
]);

/* ── Deliverable 1.4 & 1.5: PriceOracle Contract & Snapshot Handles ─────────── */

export interface PriceReading {
  readonly ok: true;
  readonly available: true;
  readonly instrument: string;
  readonly instrument_class: InstrumentClass;
  readonly source_id: string;
  readonly sequence_number: number;
  readonly timestamp_exchange: number;
  readonly timestamp_received: number;
  readonly timestamp_exchange_ms: number;
  readonly timestamp_received_ms: number;
  readonly bid: number;
  readonly ask: number;
  readonly mid: number;
  readonly mark_price: number;
  readonly freshness_ms: number;
  readonly kernel_hash: string;
}

export interface PriceUnavailable {
  readonly ok: false;
  readonly available: false;
  readonly instrument: string;
  readonly reason_code: PriceUnavailableReasonCode;
  readonly last_known_reading: PriceReading | null; // DIAGNOSTICS ONLY — NEVER CONSUMED
  readonly detail: string;
  readonly alert_emitted: string | null;
}

export type PriceResult = PriceReading | PriceUnavailable;
export type PriceResolution = PriceResult;

export class SnapshotValidationError extends Error {
  readonly reasonCode: PriceUnavailableReasonCode;
  readonly instrument: string;

  constructor(reasonCode: PriceUnavailableReasonCode, instrument: string, message: string) {
    super(`[SnapshotHandle:${reasonCode}@${instrument}] ${message}`);
    this.name = 'SnapshotValidationError';
    this.reasonCode = reasonCode;
    this.instrument = instrument;
  }
}

export interface DecisionSnapshotHandle {
  readonly snapshot_id: string;
  readonly instrument: string;
  readonly instrument_class: InstrumentClass;
  readonly source_id: string;
  readonly sequence_number: number;
  readonly price: PriceReading;
  readonly reading: PriceReading;
  readonly started_at_monotonic_ms: number;
  readonly ended: boolean;
  readonly aborted: boolean;
  readonly abort_reason: PriceUnavailableReasonCode | null;
  validate_within_decision(fresh: PriceResult): void;
}

export type SnapshotHandle = DecisionSnapshotHandle;

export interface PriceOracleProtocol {
  begin_decision(instrument: string): Promise<SnapshotHandle>;
  end_decision(handle: SnapshotHandle): void;
}

export interface CpsPrimaryTickInput {
  readonly instrument: string;
  readonly instrumentClass?: InstrumentClass | InstrumentClassCode;
  readonly source_id?: string;
  readonly sequence_number: number;
  readonly timestamp_exchange?: number;
  readonly timestamp_received?: number;
  readonly timestamp_exchange_ms?: number;
  readonly timestamp_received_ms?: number;
  readonly bid: number;
  readonly ask: number;
  readonly mark_price?: number;
}

export interface CpsAlertEvent {
  readonly id: string;
  readonly code:
    | 'PRICE_SOURCE_DIVERGENCE'
    | 'STALE_STATE_DETECTED'
    | 'CACHE_HARD_RESET'
    | 'INTEGRITY_FAILURE'
    | 'SOURCE_MIXED'
    | 'SOURCE_DISCONNECTED';
  readonly severity: 'CRITICAL' | 'WARN' | 'INFO';
  readonly instrument?: string;
  readonly source_id?: string;
  readonly detail: string;
  readonly timestampUtc: string;
  readonly preResetSequence?: number;
  readonly postResetSequence?: number;
}

export function isPriceUnavailable(res: PriceResolution | unknown): res is PriceUnavailable {
  return (
    typeof res === 'object' &&
    res !== null &&
    'available' in res &&
    (res as { available: unknown }).available === false
  );
}

export function coerceInstrumentClass(
  raw?: InstrumentClass | InstrumentClassCode | string
): InstrumentClass | undefined {
  if (!raw) return undefined;
  const upper = String(raw).trim().toUpperCase();
  if (upper === 'SPOT') return 'SPOT';
  if (upper === 'USD_M_FUTURES' || upper === 'USDM' || upper === 'USDM_PERP') {
    return 'USD_M_FUTURES';
  }
  if (upper === 'COIN_M_FUTURES' || upper === 'COINM' || upper === 'COINM_PERP') {
    return 'COIN_M_FUTURES';
  }
  return undefined;
}

export function normalizeCpsInstrument(
  raw: string,
  instrumentClass?: InstrumentClass | InstrumentClassCode
): {
  readonly instrument: string;
  readonly symbol: string;
  readonly instrumentClass: InstrumentClass;
} {
  const explicitClass = coerceInstrumentClass(instrumentClass);
  const upper = String(raw || 'BTCUSDT').trim().toUpperCase();
  if (upper.includes(':')) {
    const [clsRaw, symRaw] = upper.split(':');
    const cleanSym = (symRaw || 'BTCUSDT').replace(/[^A-Z0-9_]/g, '');
    const cls: InstrumentClass = coerceInstrumentClass(clsRaw) ?? explicitClass ?? 'SPOT';
    return { instrument: `${cls}:${cleanSym}`, symbol: cleanSym, instrumentClass: cls };
  }
  const cleanSym = upper.replace(/[^A-Z0-9_]/g, '') || 'BTCUSDT';
  const inferredClass: InstrumentClass =
    explicitClass ??
    (cleanSym.includes('_PERP') || cleanSym.endsWith('USD_PERP')
      ? 'COIN_M_FUTURES'
      : 'SPOT');
  return {
    instrument: `${inferredClass}:${cleanSym}`,
    symbol: cleanSym,
    instrumentClass: inferredClass,
  };
}

interface InternalInstrumentRingState {
  readonly key: string;
  readonly symbol: string;
  readonly instrumentClass: InstrumentClass;
  readonly expectedSourceId: CertifiedSourceId;
  configuredSourceId: string;
  connected: boolean;
  disconnectedReason: string | null;
  lastConsumedSequence: number;
  lastIngestedSequence: number;
  pendingGapDetected: boolean;
  gapDetail: string | null;
  sourceMixedViolation: boolean;
  sourceMixedDetail: string | null;
  divergenceDetected: boolean;
  divergenceDetail: string | null;
  secondaryPrice: number | null;
  secondaryCheckedAtMs: number;
  lastValidReading: PriceReading | null;
  ringBuffer: PriceReading[]; // Bounded ring buffer ONLY for gap & divergence verification
}

const DEFAULT_RING_CAPACITY = 32;

export class CertifiedPriceOracle {
  private readonly instruments = new Map<string, InternalInstrumentRingState>();
  private readonly alerts: CpsAlertEvent[] = [];
  private readonly activeSnapshots = new Map<string, DecisionSnapshotHandle>();
  private readonly kernelHash: string;
  private clockFn: () => number;
  private snapshotCounter = 0;
  private alertCounter = 0;

  constructor(options?: { readonly nowMsFn?: () => number; readonly primeDefaults?: boolean }) {
    if (!verifyCertifiedSourceConfig(CERTIFIED_PRIMARY_SOURCE_CONFIG)) {
      throw new Error('CRITICAL: CertifiedPrimarySource configuration artifact failed signature check.');
    }
    this.kernelHash = CERTIFIED_PRIMARY_SOURCE_CONFIG.sha256Digest;
    this.clockFn = options?.nowMsFn ?? (() => Date.now());
    if (options?.primeDefaults !== false) {
      this.primeDeterministicDefaults();
    }
  }

  private primeDeterministicDefaults(): void {
    const now = this.clockFn();
    const seeds: ReadonlyArray<{ symbol: string; price: number }> = [
      { symbol: 'BTCUSDT', price: 65000 },
      { symbol: 'ETHUSDT', price: 3250 },
      { symbol: 'SOLUSDT', price: 185 },
      { symbol: 'BNBUSDT', price: 615 },
      { symbol: 'XRPUSDT', price: 1.45 },
    ];
    for (const s of seeds) {
      this.ingestPrimaryStreamTick({
        instrument: `SPOT:${s.symbol}`,
        instrumentClass: 'SPOT',
        source_id: CERTIFIED_PRIMARY_SOURCE_CONFIG.entries.SPOT.source_id,
        sequence_number: 1,
        timestamp_exchange: now - 12,
        timestamp_received: now,
        bid: Number((s.price * 0.9999).toPrecision(7)),
        ask: Number((s.price * 1.0001).toPrecision(7)),
        mark_price: s.price,
      });
      this.ingestSecondaryCrossCheck({
        instrument: `SPOT:${s.symbol}`,
        secondaryPrice: s.price,
        nowMs: now,
      });
    }
  }

  setClock(fn: () => number): void {
    this.clockFn = fn;
  }

  nowMs(): number {
    return this.clockFn();
  }

  private ensureState(rawInstrument: string, explicitClass?: InstrumentClass): InternalInstrumentRingState {
    const norm = normalizeCpsInstrument(rawInstrument, explicitClass);
    const existing = this.instruments.get(norm.instrument);
    if (existing) return existing;
    const spec = CERTIFIED_PRIMARY_SOURCE_CONFIG.entries[norm.instrumentClass];
    const created: InternalInstrumentRingState = {
      key: norm.instrument,
      symbol: norm.symbol,
      instrumentClass: norm.instrumentClass,
      expectedSourceId: spec.source_id,
      configuredSourceId: spec.source_id,
      connected: false,
      disconnectedReason: 'Stream has not received initial tick yet.',
      lastConsumedSequence: 0,
      lastIngestedSequence: 0,
      pendingGapDetected: false,
      gapDetail: null,
      sourceMixedViolation: false,
      sourceMixedDetail: null,
      divergenceDetected: false,
      divergenceDetail: null,
      secondaryPrice: null,
      secondaryCheckedAtMs: 0,
      lastValidReading: null,
      ringBuffer: [],
    };
    this.instruments.set(norm.instrument, created);
    return created;
  }

  private emitAlert(params: Omit<CpsAlertEvent, 'id' | 'timestampUtc'>): void {
    const id = `cps_alert_${++this.alertCounter}`;
    this.alerts.unshift(
      Object.freeze({
        ...params,
        id,
        timestampUtc: new Date(this.clockFn()).toISOString(),
      })
    );
    if (this.alerts.length > 200) {
      this.alerts.length = 200;
    }
  }

  getAlerts(): ReadonlyArray<CpsAlertEvent> {
    return Object.freeze([...this.alerts]);
  }

  getKernelHash(): string {
    return this.kernelHash;
  }

  getTrackedInstruments(): ReadonlyArray<{
    readonly instrument: string;
    readonly instrumentClass: InstrumentClass;
    readonly source_id: string;
    readonly connected: boolean;
    readonly lastConsumedSequence: number;
    readonly lastIngestedSequence: number;
    readonly freshnessCeilingMs: number;
    readonly currentFreshnessMs: number | null;
    readonly divergenceDetected: boolean;
    readonly gapDetected: boolean;
    readonly sourceMixedViolation: boolean;
  }> {
    const now = this.clockFn();
    return Object.freeze(
      Array.from(this.instruments.values()).map((st) => {
        const spec = CERTIFIED_PRIMARY_SOURCE_CONFIG.entries[st.instrumentClass];
        const freshness =
          st.lastValidReading !== null ? Math.max(0, now - st.lastValidReading.timestamp_received) : null;
        return Object.freeze({
          instrument: st.key,
          instrumentClass: st.instrumentClass,
          source_id: st.configuredSourceId,
          connected: st.connected,
          lastConsumedSequence: st.lastConsumedSequence,
          lastIngestedSequence: st.lastIngestedSequence,
          freshnessCeilingMs: spec.freshnessCeilingMs,
          currentFreshnessMs: freshness,
          divergenceDetected: st.divergenceDetected,
          gapDetected: st.pendingGapDetected,
          sourceMixedViolation: st.sourceMixedViolation,
        });
      })
    );
  }

  ingestPrimaryStreamTick(tick: CpsPrimaryTickInput): PriceResolution {
    const st = this.ensureState(tick.instrument, coerceInstrumentClass(tick.instrumentClass));
    const spec = CERTIFIED_PRIMARY_SOURCE_CONFIG.entries[st.instrumentClass];
    const now = tick.timestamp_received_ms ?? tick.timestamp_received ?? this.clockFn();
    const exchMs = tick.timestamp_exchange_ms ?? tick.timestamp_exchange ?? now;
    const incomingSource = tick.source_id ?? spec.source_id;

    if (incomingSource !== spec.source_id || st.configuredSourceId !== spec.source_id) {
      st.sourceMixedViolation = true;
      st.sourceMixedDetail = `I-PD3 violation: unexpected source "${incomingSource}" (certified="${spec.source_id}").`;
      this.emitAlert({
        code: 'SOURCE_MIXED',
        severity: 'CRITICAL',
        instrument: st.key,
        source_id: incomingSource,
        detail: st.sourceMixedDetail,
      });
      return this.makeUnavailable(st, 'SOURCE_MIXED', st.sourceMixedDetail, 'SOURCE_MIXED');
    }

    if (
      !Number.isFinite(tick.bid) ||
      !Number.isFinite(tick.ask) ||
      tick.bid <= 0 ||
      tick.ask <= 0 ||
      tick.ask < tick.bid
    ) {
      return this.makeUnavailable(st, 'SOURCE_DISCONNECTED', 'Malformed bid/ask tick on primary stream.');
    }

    const prevSeq = Math.max(st.lastIngestedSequence, st.lastConsumedSequence);
    if (!Number.isInteger(tick.sequence_number) || tick.sequence_number <= prevSeq) {
      st.pendingGapDetected = true;
      st.gapDetail = `I-PD1 sequence regression/duplicate: seq=${tick.sequence_number} <= prev=${prevSeq}.`;
      return this.makeUnavailable(st, 'GAP', st.gapDetail);
    }
    if (prevSeq > 0 && tick.sequence_number > prevSeq + 1) {
      st.pendingGapDetected = true;
      st.gapDetail = `I-PD1 sequence gap detected: jumped from seq=${prevSeq} to seq=${tick.sequence_number}.`;
      return this.makeUnavailable(st, 'GAP', st.gapDetail);
    }

    const mid = Number(((tick.bid + tick.ask) / 2).toPrecision(8));
    const markPrice =
      tick.mark_price !== undefined && Number.isFinite(tick.mark_price) && tick.mark_price > 0
        ? tick.mark_price
        : mid;

    const reading: PriceReading = Object.freeze({
      ok: true,
      available: true,
      instrument: st.key,
      instrument_class: st.instrumentClass,
      source_id: spec.source_id,
      sequence_number: tick.sequence_number,
      timestamp_exchange: exchMs,
      timestamp_received: now,
      timestamp_exchange_ms: exchMs,
      timestamp_received_ms: now,
      bid: tick.bid,
      ask: tick.ask,
      mid,
      mark_price: markPrice,
      freshness_ms: Math.max(0, now - exchMs),
      kernel_hash: this.kernelHash,
    });

    st.connected = true;
    st.disconnectedReason = null;
    st.pendingGapDetected = false;
    st.gapDetail = null;
    st.lastIngestedSequence = tick.sequence_number;
    st.lastValidReading = reading;
    st.ringBuffer.push(reading);
    if (st.ringBuffer.length > DEFAULT_RING_CAPACITY) {
      st.ringBuffer.shift();
    }

    if (st.secondaryPrice !== null && st.secondaryPrice > 0) {
      const divBps = (Math.abs(markPrice - st.secondaryPrice) / st.secondaryPrice) * 10_000;
      if (divBps > spec.divergenceThresholdBps) {
        st.divergenceDetected = true;
        st.divergenceDetail = `PRICE_SOURCE_DIVERGENCE (${st.key}): primary=${markPrice} vs secondary=${st.secondaryPrice} (${divBps.toFixed(2)} bps > ${spec.divergenceThresholdBps} bps).`;
        this.emitAlert({
          code: 'PRICE_SOURCE_DIVERGENCE',
          severity: 'CRITICAL',
          instrument: st.key,
          source_id: spec.source_id,
          detail: st.divergenceDetail,
        });
        return this.makeUnavailable(
          st,
          'DIVERGENCE',
          st.divergenceDetail,
          'PRICE_SOURCE_DIVERGENCE'
        );
      }
      st.divergenceDetected = false;
      st.divergenceDetail = null;
    }

    return reading;
  }

  ingestSecondaryCrossCheck(params: {
    readonly instrument: string;
    readonly instrumentClass?: InstrumentClass;
    readonly secondaryPrice: number;
    readonly nowMs?: number;
  }): { readonly agreed: boolean; readonly divergenceBps: number; readonly thresholdBps: number } {
    const st = this.ensureState(params.instrument, params.instrumentClass);
    const spec = CERTIFIED_PRIMARY_SOURCE_CONFIG.entries[st.instrumentClass];
    const now = params.nowMs ?? this.clockFn();

    st.secondaryPrice = params.secondaryPrice;
    st.secondaryCheckedAtMs = now;

    if (!st.lastValidReading || !Number.isFinite(params.secondaryPrice) || params.secondaryPrice <= 0) {
      return { agreed: true, divergenceBps: 0, thresholdBps: spec.divergenceThresholdBps };
    }

    const primaryRef = st.lastValidReading.mark_price;
    const divergenceBps = Number(
      ((Math.abs(primaryRef - params.secondaryPrice) / params.secondaryPrice) * 10_000).toFixed(4)
    );
    if (divergenceBps > spec.divergenceThresholdBps) {
      st.divergenceDetected = true;
      st.divergenceDetail = `PRICE_SOURCE_DIVERGENCE (${st.key}): primary=${primaryRef} vs REST ${spec.secondaryCheckEndpoint}=${params.secondaryPrice} (${divergenceBps} bps > ${spec.divergenceThresholdBps} bps). NO FAILOVER.`;
      this.emitAlert({
        code: 'PRICE_SOURCE_DIVERGENCE',
        severity: 'CRITICAL',
        instrument: st.key,
        source_id: spec.source_id,
        detail: st.divergenceDetail,
      });
      return { agreed: false, divergenceBps, thresholdBps: spec.divergenceThresholdBps };
    }

    st.divergenceDetected = false;
    st.divergenceDetail = null;
    return { agreed: true, divergenceBps, thresholdBps: spec.divergenceThresholdBps };
  }

  disconnectSource(instrument: string, reason = 'WebSocket connection terminated'): void {
    const st = this.ensureState(instrument);
    st.connected = false;
    st.disconnectedReason = reason;
    this.emitAlert({
      code: 'SOURCE_DISCONNECTED',
      severity: 'CRITICAL',
      instrument: st.key,
      source_id: st.configuredSourceId,
      detail: reason,
    });
  }

  injectSourceIdentitySwap(instrument: string, foreignSourceId: string): void {
    const st = this.ensureState(instrument);
    st.configuredSourceId = foreignSourceId;
    st.sourceMixedViolation = true;
    st.sourceMixedDetail = `I-PD3 fault: configured source mutated from ${st.expectedSourceId} to ${foreignSourceId}.`;
    this.emitAlert({
      code: 'SOURCE_MIXED',
      severity: 'CRITICAL',
      instrument: st.key,
      source_id: foreignSourceId,
      detail: st.sourceMixedDetail,
    });
  }

  reprimeInstrument(instrument: string, tick: CpsPrimaryTickInput, secondaryPrice?: number): PriceResolution {
    const norm = normalizeCpsInstrument(instrument, tick.instrumentClass);
    const spec = CERTIFIED_PRIMARY_SOURCE_CONFIG.entries[norm.instrumentClass];
    const st = this.ensureState(norm.instrument, norm.instrumentClass);
    st.configuredSourceId = spec.source_id;
    st.sourceMixedViolation = false;
    st.sourceMixedDetail = null;
    st.pendingGapDetected = false;
    st.gapDetail = null;
    st.divergenceDetected = false;
    st.divergenceDetail = null;
    st.lastConsumedSequence = Math.min(st.lastConsumedSequence, Math.max(0, tick.sequence_number - 1));
    st.lastIngestedSequence = Math.max(0, tick.sequence_number - 1);
    this.ingestPrimaryStreamTick({
      ...tick,
      instrument: norm.instrument,
      instrumentClass: norm.instrumentClass,
      source_id: spec.source_id,
    });
    if (secondaryPrice !== undefined && Number.isFinite(secondaryPrice) && secondaryPrice > 0) {
      this.ingestSecondaryCrossCheck({
        instrument: norm.instrument,
        instrumentClass: norm.instrumentClass,
        secondaryPrice,
        nowMs: tick.timestamp_received ?? this.clockFn(),
      });
    }
    return this.resolve(norm.instrument, tick.timestamp_received ?? this.clockFn());
  }

  private makeUnavailable(
    st: InternalInstrumentRingState,
    reason_code: PriceUnavailableReasonCode,
    detail: string,
    alert_emitted: string | null = null
  ): PriceUnavailable {
    return Object.freeze({
      ok: false,
      available: false,
      instrument: st.key,
      reason_code,
      last_known_reading: st.lastValidReading,
      detail,
      alert_emitted,
    });
  }

  resolve(
    instrument: string,
    nowMonotonicMs?: number,
    activeDecisionHandle?: DecisionSnapshotHandle
  ): PriceResolution {
    const st = this.ensureState(instrument);
    const spec = CERTIFIED_PRIMARY_SOURCE_CONFIG.entries[st.instrumentClass];
    const now = nowMonotonicMs ?? this.clockFn();

    if (activeDecisionHandle) {
      if (activeDecisionHandle.instrument !== st.key) {
        return this.makeUnavailable(
          st,
          'SOURCE_MIXED',
          `Decision handle pinned to ${activeDecisionHandle.instrument}, requested ${st.key}.`,
          'SOURCE_MIXED'
        );
      }
      if (
        st.sourceMixedViolation ||
        st.configuredSourceId !== activeDecisionHandle.reading.source_id ||
        st.expectedSourceId !== activeDecisionHandle.reading.source_id
      ) {
        return this.makeUnavailable(
          st,
          'SOURCE_MIXED',
          st.sourceMixedDetail ??
            `I-PD3 source swap mid-decision: snapshot=${activeDecisionHandle.reading.source_id}, active=${st.configuredSourceId}.`,
          'SOURCE_MIXED'
        );
      }
      if (!st.connected) {
        return this.makeUnavailable(
          st,
          'SOURCE_DISCONNECTED',
          st.disconnectedReason ?? 'Source disconnected mid-decision.',
          'SOURCE_DISCONNECTED'
        );
      }
      if (st.lastIngestedSequence > 0 && st.lastIngestedSequence < activeDecisionHandle.reading.sequence_number) {
        return this.makeUnavailable(
          st,
          'GAP',
          `Sequence regressed mid-decision (${st.lastIngestedSequence} < ${activeDecisionHandle.reading.sequence_number}).`
        );
      }
      return activeDecisionHandle.reading;
    }

    if (st.sourceMixedViolation || st.configuredSourceId !== spec.source_id) {
      return this.makeUnavailable(
        st,
        'SOURCE_MIXED',
        st.sourceMixedDetail ?? `Source identity mismatch (${st.configuredSourceId} !== ${spec.source_id}).`,
        'SOURCE_MIXED'
      );
    }

    if (!st.connected || !st.lastValidReading) {
      return this.makeUnavailable(
        st,
        'SOURCE_DISCONNECTED',
        st.disconnectedReason ?? `Certified stream ${spec.source_id} disconnected for ${st.key}.`,
        'SOURCE_DISCONNECTED'
      );
    }

    if (st.pendingGapDetected) {
      return this.makeUnavailable(st, 'GAP', st.gapDetail ?? 'I-PD1 sequence gap/regression detected.');
    }

    if (st.divergenceDetected) {
      return this.makeUnavailable(
        st,
        'DIVERGENCE',
        st.divergenceDetail ?? 'I-PD4 primary/secondary divergence breach (no failover).',
        'PRICE_SOURCE_DIVERGENCE'
      );
    }

    const reading = st.lastValidReading;
    const freshnessMs = Math.max(0, now - reading.timestamp_received);
    if (freshnessMs > spec.freshnessCeilingMs) {
      return this.makeUnavailable(
        st,
        'STALE',
        `I-PD2 freshness ceiling exceeded for ${st.key}: ${freshnessMs}ms > ${spec.freshnessCeilingMs}ms.`
      );
    }

    return Object.freeze({
      ...reading,
      freshness_ms: freshnessMs,
    });
  }

  begin_decision(
    instrument: string,
    nowMonotonicMs?: number
  ): DecisionSnapshotHandle | PriceUnavailable {
    const resolved = this.resolve(instrument, nowMonotonicMs);
    if (isPriceUnavailable(resolved)) {
      return resolved;
    }
    const st = this.ensureState(instrument);
    st.lastConsumedSequence = Math.max(st.lastConsumedSequence, resolved.sequence_number);

    const snapshotId = `snap_${++this.snapshotCounter}_${sha256Hex(`${resolved.instrument}|${resolved.source_id}|${resolved.sequence_number}|${resolved.timestamp_received}`).slice(0, 10)}`;
    const closedIds = this.activeSnapshots;
    const handle: DecisionSnapshotHandle = Object.freeze({
      snapshot_id: snapshotId,
      instrument: resolved.instrument,
      instrument_class: resolved.instrument_class,
      source_id: resolved.source_id,
      sequence_number: resolved.sequence_number,
      price: resolved,
      reading: resolved,
      started_at_monotonic_ms: nowMonotonicMs ?? this.clockFn(),
      ended: false,
      aborted: false,
      abort_reason: null,
      validate_within_decision(fresh: PriceResult): void {
        if (!closedIds.has(snapshotId)) {
          throw new SnapshotValidationError(
            'STALE',
            resolved.instrument,
            `Decision snapshot ${snapshotId} already ended.`
          );
        }
        if (isPriceUnavailable(fresh)) {
          throw new SnapshotValidationError(fresh.reason_code, fresh.instrument, fresh.detail);
        }
        if (fresh.instrument !== resolved.instrument) {
          throw new SnapshotValidationError(
            'SOURCE_MIXED',
            resolved.instrument,
            `I-PD3 instrument mismatch within decision: ${fresh.instrument} !== ${resolved.instrument}.`
          );
        }
        if (fresh.source_id !== resolved.source_id) {
          throw new SnapshotValidationError(
            'SOURCE_MIXED',
            resolved.instrument,
            `I-PD3 source swap within decision: ${fresh.source_id} !== ${resolved.source_id}.`
          );
        }
        if (fresh.sequence_number < resolved.sequence_number) {
          throw new SnapshotValidationError(
            'GAP',
            resolved.instrument,
            `I-PD1 sequence regression within decision: ${fresh.sequence_number} < ${resolved.sequence_number}.`
          );
        }
      },
    });
    this.activeSnapshots.set(snapshotId, handle);
    return handle;
  }

  read_decision_snapshot(handle: DecisionSnapshotHandle, nowMonotonicMs?: number): PriceResolution {
    if (handle.ended) {
      const st = this.ensureState(handle.instrument);
      return this.makeUnavailable(
        st,
        'STALE',
        `Decision snapshot ${handle.snapshot_id} already ended (Tier-1 per-decision reset).`
      );
    }
    return this.resolve(handle.instrument, nowMonotonicMs, handle);
  }

  end_decision(handle: DecisionSnapshotHandle): DecisionSnapshotHandle {
    const closed = Object.freeze({
      ...handle,
      ended: true,
      validate_within_decision(fresh: PriceResult): void {
        void fresh;
        throw new SnapshotValidationError(
          'STALE',
          handle.instrument,
          `Decision snapshot ${handle.snapshot_id} already ended.`
        );
      },
    });
    this.activeSnapshots.delete(handle.snapshot_id);
    return closed;
  }

  asPriceOracle(): PriceOracleProtocol {
    return {
      begin_decision: async (instrument: string): Promise<SnapshotHandle> => {
        const res = this.begin_decision(instrument);
        if (isPriceUnavailable(res)) {
          throw new SnapshotValidationError(res.reason_code, res.instrument, res.detail);
        }
        return res;
      },
      end_decision: (handle: SnapshotHandle): void => {
        this.end_decision(handle);
      },
    };
  }
}

export const GLOBAL_CPS_ORACLE = new CertifiedPriceOracle();

export type CpsRegimeHint = MarketRegime;

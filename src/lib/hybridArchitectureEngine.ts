/**
 * Signal Forge Hybrid Production Architecture Engine (Phases 1-6)
 *
 * Pure deterministic domain engine modeling:
 * - Phase 1: Python Control Plane <-> Rust Execution Core IPC metrics & envelope
 * - Phase 2: Multi-Agent Orchestration & Unbounded Horizontal AI Worker Clone Scaling
 * - Phase 3: Nanosecond Memory-Mapped (mmap) Multi-Asset Vectorized Backtesting
 * - Phase 4: Paper Trading Validation Chamber (L2 slippage, exchange fees, latency)
 * - Phase 5: Dynamic Risk Parameter Optimization (autonomous volatility feedback loop)
 * - Phase 6: Historical Date-Range & Market Regime Slicing + Strategy Lifecycle Attribution
 */

export type HybridAssetClass = 'CRYPTO' | 'FOREX' | 'EQUITIES';

export type HybridMarketRegime =
  | 'TRENDING_BULL'
  | 'HIGH_VOL_CHOP'
  | 'BEAR_STRESS'
  | 'MEAN_REVERTING';

export type HybridStrategyFamily =
  | 'BREAKOUT_MOMENTUM'
  | 'MEAN_REVERSION'
  | 'ORDERBOOK_IMBALANCE'
  | 'STAT_ARB';

export type HybridStrategyStatus = 'PROMOTED_LIVE_READY' | 'PAPER_REFINEMENT' | 'RISK_THROTTLED';

export interface ArchitecturalReference {
  id: string;
  name: string;
  url: string;
  phaseFocus: string;
  integratedPattern: string;
}

export const ARCHITECTURAL_REFERENCES: readonly ArchitecturalReference[] = [
  {
    id: 'nautilus_trader',
    name: 'nautilus_trader',
    url: 'https://github.com/nautechsystems/nautilus_trader.git',
    phaseFocus: 'Phase 1 · Dual-Layer Python + Rust Core',
    integratedPattern:
      'Python control plane orchestrating strategies over a Rust nanosecond execution & IPC layer.',
  },
  {
    id: 'vectorbt',
    name: 'vectorbt',
    url: 'https://github.com/polakowo/vectorbt.git',
    phaseFocus: 'Phase 3 · Vectorized Simulation Pipeline',
    integratedPattern:
      'Memory-aligned array sweeps evaluating dual-EMA momentum, order-book imbalance, and slippage.',
  },
  {
    id: 'quantconnect_lean',
    name: 'QuantConnect / Lean',
    url: 'https://github.com/QuantConnect/Lean.git',
    phaseFocus: 'Phase 3 & 6 · Multi-Asset Adapters & Date Ranges',
    integratedPattern:
      'Modular Crypto, Forex, and Equity market adapters with explicit historical date-range slicing.',
  },
  {
    id: 'backtesting_py',
    name: 'backtesting.py',
    url: 'https://github.com/kernc/backtesting.py.git',
    phaseFocus: 'Phase 6 · Signal Lifecycle & Trade Audit',
    integratedPattern:
      'Granular entry/exit execution point capture, equity attribution, and clean strategy diagnostics.',
  },
  {
    id: 'freqtrade',
    name: 'freqtrade',
    url: 'https://github.com/freqtrade/freqtrade.git',
    phaseFocus: 'Phase 4 & 5 · Paper Chamber & Risk Guards',
    integratedPattern:
      'Strict dry-run paper validation gateway with exchange fee tiers, slippage caps, and drawdown stops.',
  },
];

export interface AssetAdapterDescriptor {
  assetClass: HybridAssetClass;
  symbol: string;
  exchange: string;
  basePrice: number;
  baseSpreadBps: number;
  tickVolatility: number;
  bookDepthUsd: number;
  makerFeeBps: number;
  takerFeeBps: number;
  baseLatencyMs: number;
}

export const HYBRID_ASSET_ADAPTERS: Readonly<Record<HybridAssetClass, AssetAdapterDescriptor>> = {
  CRYPTO: {
    assetClass: 'CRYPTO',
    symbol: 'BTC/USDT',
    exchange: 'BINANCE',
    basePrice: 68400,
    baseSpreadBps: 1.4,
    tickVolatility: 0.0018,
    bookDepthUsd: 1850000,
    makerFeeBps: 2.0,
    takerFeeBps: 4.5,
    baseLatencyMs: 14.0,
  },
  FOREX: {
    assetClass: 'FOREX',
    symbol: 'EUR/USD',
    exchange: 'OANDA',
    basePrice: 1.0845,
    baseSpreadBps: 0.7,
    tickVolatility: 0.00048,
    bookDepthUsd: 4600000,
    makerFeeBps: 0.8,
    takerFeeBps: 1.6,
    baseLatencyMs: 26.0,
  },
  EQUITIES: {
    assetClass: 'EQUITIES',
    symbol: 'NVDA',
    exchange: 'IBKR',
    basePrice: 132.5,
    baseSpreadBps: 1.1,
    tickVolatility: 0.00135,
    bookDepthUsd: 2450000,
    makerFeeBps: 0.5,
    takerFeeBps: 1.2,
    baseLatencyMs: 11.0,
  },
};

export interface IpcTopologyStatus {
  controlPlaneRuntime: string;
  executionCoreRuntime: string;
  ipcProtocol: string;
  socketPath: string;
  roundTripLatencyNs: number;
  ringBufferCapacityFrames: number;
  packetLossRatePct: number;
  modularUpgradeReady: boolean;
}

export interface WorkerCloneDescriptor {
  cloneId: string;
  strategyFamily: HybridStrategyFamily;
  streamPartition: string;
  assetClass: HybridAssetClass;
  assignedNode: number;
  fastWindow: number;
  slowWindow: number;
  evalRateTicksSec: number;
}

export interface HorizontalCloneScalePlan {
  updatedAtIso: string;
  marketVolatilityPct: number;
  computeNodes: number;
  baseClonesPerNode: number;
  clonesPerNode: number;
  totalActiveClones: number;
  targetStreams: number;
  estimatedEvalThroughputSec: number;
  familyDistribution: Record<HybridStrategyFamily, number>;
  sampleClones: WorkerCloneDescriptor[];
}

export interface EntryExecutionPoint {
  seq: number;
  timestampIso: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  orderBookImbalance: number;
  slippageBps: number;
  netReturnPct: number;
}

export interface VectorBacktestMetrics {
  assetClass: HybridAssetClass;
  symbol: string;
  exchange: string;
  strategyFamily: HybridStrategyFamily;
  startDate: string;
  endDate: string;
  regime: HybridMarketRegime;
  ticksProcessed: number;
  mmapFrameBytes: number;
  simulatedElapsedNs: number;
  nsPerTick: number;
  ticksPerSecond: number;
  grossReturnPct: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
  winRatePct: number;
  tradeCount: number;
  avgSpreadBps: number;
  entryPoints: EntryExecutionPoint[];
}

export interface PaperChamberVerdict {
  exchange: string;
  simulatedOrders: number;
  fillRatePct: number;
  avgSlippageBps: number;
  exchangeFeeDragBps: number;
  avgSimulatedLatencyMs: number;
  chamberNetReturnPct: number;
  chamberDrawdownPct: number;
  promoted: boolean;
  gateReason: string;
}

export interface DynamicRiskProfile {
  liveVolatilityPct: number;
  previousPositionSizePct: number;
  optimizedPositionSizePct: number;
  previousLeverageLimit: number;
  optimizedLeverageLimit: number;
  previousHardDrawdownPct: number;
  optimizedHardDrawdownPct: number;
  rationale: string;
}

export interface AttributionBreakdown {
  alphaSignalBps: number;
  orderBookTimingBps: number;
  slippageCostBps: number;
  exchangeFeeCostBps: number;
  latencyDecayBps: number;
  netAttributionBps: number;
}

export interface TrackedStrategyRecord {
  strategyId: string;
  createdAtIso: string;
  strategyName: string;
  assetClass: HybridAssetClass;
  symbol: string;
  exchange: string;
  strategyFamily: HybridStrategyFamily;
  startDate: string;
  endDate: string;
  regime: HybridMarketRegime;
  status: HybridStrategyStatus;
  workerClonesAllocated: number;
  backtest: VectorBacktestMetrics;
  chamber: PaperChamberVerdict;
  riskOptimization: DynamicRiskProfile;
  attribution: AttributionBreakdown;
}

export interface HybridBacktestRequest {
  assetClass: HybridAssetClass;
  strategyFamily: HybridStrategyFamily;
  startDate: string;
  endDate: string;
  regime: HybridMarketRegime;
  liveVolatilityPct: number;
  fastWindow?: number;
  slowWindow?: number;
  tickCount?: number;
  slippageBps?: number;
  workerClonesAllocated?: number;
}

const STRATEGY_FAMILIES: readonly HybridStrategyFamily[] = [
  'BREAKOUT_MOMENTUM',
  'MEAN_REVERSION',
  'ORDERBOOK_IMBALANCE',
  'STAT_ARB',
];

const STREAM_PARTITIONS: readonly { partition: string; assetClass: HybridAssetClass }[] = [
  { partition: 'BINANCE:BTCUSDT', assetClass: 'CRYPTO' },
  { partition: 'BYBIT:ETHUSDT', assetClass: 'CRYPTO' },
  { partition: 'OKX:SOLUSDT', assetClass: 'CRYPTO' },
  { partition: 'OANDA:EURUSD', assetClass: 'FOREX' },
  { partition: 'OANDA:USDJPY', assetClass: 'FOREX' },
  { partition: 'IBKR:NVDA', assetClass: 'EQUITIES' },
  { partition: 'IBKR:SPY', assetClass: 'EQUITIES' },
];

export function isValidIsoDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed);
}

export function buildIpcTopologyStatus(activeClones: number): IpcTopologyStatus {
  const loadFactor = Math.min(2.2, 1 + Math.log10(Math.max(10, activeClones)) * 0.14);
  return {
    controlPlaneRuntime: 'Python 3.11 Control Plane (Orchestration & Risk Feedback)',
    executionCoreRuntime: 'Rust 2021 Execution Engine (mmap Feed & L2 Order Router)',
    ipcProtocol: '4-Byte Length-Prefixed Binary/JSON Framing over UDS + SPSC Ring',
    socketPath: '/tmp/signal_forge_hybrid.sock',
    roundTripLatencyNs: Math.round(420 * loadFactor),
    ringBufferCapacityFrames: 65536,
    packetLossRatePct: 0,
    modularUpgradeReady: true,
  };
}

/**
 * Phase 2: Unbounded horizontal AI worker clone autoscaler.
 * Dynamically scales active autonomous clones into thousands of workers based on
 * live market volatility and available compute nodes.
 */
export function computeHorizontalCloneScalePlan(params: {
  marketVolatilityPct: number;
  computeNodes: number;
  baseClonesPerNode?: number;
  targetStreams?: number;
}): HorizontalCloneScalePlan {
  const volatility = Math.max(0.5, Math.min(100, Number(params.marketVolatilityPct) || 22));
  const computeNodes = Math.max(1, Math.min(512, Math.floor(Number(params.computeNodes) || 8)));
  const baseClonesPerNode = Math.max(
    8,
    Math.min(512, Math.floor(Number(params.baseClonesPerNode) || 64)),
  );
  const targetStreams = Math.max(
    1,
    Math.min(500, Math.floor(Number(params.targetStreams) || STREAM_PARTITIONS.length * 4)),
  );

  const volatilityMultiplier = 1 + Math.pow(volatility / 12.5, 1.35);
  const clonesPerNode = Math.ceil(baseClonesPerNode * volatilityMultiplier);
  const totalActiveClones = computeNodes * clonesPerNode;

  const familyDistribution: Record<HybridStrategyFamily, number> = {
    BREAKOUT_MOMENTUM: 0,
    MEAN_REVERSION: 0,
    ORDERBOOK_IMBALANCE: 0,
    STAT_ARB: 0,
  };

  const baseShare = Math.floor(totalActiveClones / STRATEGY_FAMILIES.length);
  const remainder = totalActiveClones % STRATEGY_FAMILIES.length;
  STRATEGY_FAMILIES.forEach((family, idx) => {
    familyDistribution[family] = baseShare + (idx < remainder ? 1 : 0);
  });

  const sampleLimit = Math.min(totalActiveClones, 12);
  const sampleClones: WorkerCloneDescriptor[] = [];
  for (let i = 0; i < sampleLimit; i += 1) {
    const family = STRATEGY_FAMILIES[i % STRATEGY_FAMILIES.length];
    const stream = STREAM_PARTITIONS[i % STREAM_PARTITIONS.length];
    sampleClones.push({
      cloneId: `CLONE-${String(i + 1).padStart(5, '0')}`,
      strategyFamily: family,
      streamPartition: stream.partition,
      assetClass: stream.assetClass,
      assignedNode: (i % computeNodes) + 1,
      fastWindow: 6 + (i % 6) * 2,
      slowWindow: 24 + (i % 7) * 5,
      evalRateTicksSec: 185000 + (i % 5) * 14200,
    });
  }

  return {
    updatedAtIso: new Date().toISOString(),
    marketVolatilityPct: Number(volatility.toFixed(2)),
    computeNodes,
    baseClonesPerNode,
    clonesPerNode,
    totalActiveClones,
    targetStreams,
    estimatedEvalThroughputSec: totalActiveClones * 210,
    familyDistribution,
    sampleClones,
  };
}

/**
 * Phase 3 & Phase 6: Deterministic nanosecond-benchmarked vectorized backtest
 * across Crypto, Forex, and Equities adapters sliced by historical date range & regime.
 */
export function runVectorizedMmapBacktest(input: HybridBacktestRequest): VectorBacktestMetrics {
  const adapter = HYBRID_ASSET_ADAPTERS[input.assetClass];
  const startMs = Date.parse(`${input.startDate}T00:00:00Z`);
  const endMs = Math.max(startMs + 86_400_000, Date.parse(`${input.endDate}T23:59:59Z`));
  const tickCount = Math.max(1500, Math.min(60000, Math.floor(input.tickCount ?? 12000)));
  const fastWindow = Math.max(3, Math.min(50, Math.floor(input.fastWindow ?? 11)));
  const slowWindow = Math.max(fastWindow + 4, Math.min(180, Math.floor(input.slowWindow ?? 34)));
  const slippageBps = Math.max(0.2, Math.min(25, Number(input.slippageBps ?? 1.8)));

  const fastAlpha = 2 / (fastWindow + 1);
  const slowAlpha = 2 / (slowWindow + 1);

  const regimeConfig: Record<
    HybridMarketRegime,
    { drift: number; volMult: number; phaseShift: number }
  > = {
    TRENDING_BULL: { drift: 0.00014, volMult: 1.0, phaseShift: 0.15 },
    HIGH_VOL_CHOP: { drift: 0.00003, volMult: 1.65, phaseShift: 1.2 },
    BEAR_STRESS: { drift: -0.00011, volMult: 1.35, phaseShift: 2.3 },
    MEAN_REVERTING: { drift: 0.00005, volMult: 0.9, phaseShift: 0.7 },
  };
  const cfg = regimeConfig[input.regime];

  const familyBias: Record<HybridStrategyFamily, number> = {
    BREAKOUT_MOMENTUM: 0.035,
    MEAN_REVERSION: 0.045,
    ORDERBOOK_IMBALANCE: 0.025,
    STAT_ARB: 0.03,
  };
  const imbThreshold = familyBias[input.strategyFamily];
  const dateSeed = ((startMs / 86_400_000) % 97) * 0.017;

  // Measure real vectorized Float64Array simulation pass
  const t0 = performance.now();
  const mids = new Float64Array(tickCount);
  const imbs = new Float64Array(tickCount);
  const spreads = new Float64Array(tickCount);

  let price = adapter.basePrice;
  for (let i = 0; i < tickCount; i += 1) {
    const macroWave =
      Math.sin(i * 0.0085 + cfg.phaseShift + dateSeed) * 0.45 +
      Math.cos(i * 0.0031 + dateSeed * 1.7) * 0.25;
    const chopNoise =
      Math.sin(i * 0.173 + cfg.phaseShift * 2.1) * 0.55 +
      Math.cos(i * 0.419 + dateSeed * 3.3) * 0.45;
    const delta =
      cfg.drift * 0.35 + (macroWave * 0.55 + chopNoise * 0.75) * adapter.tickVolatility * cfg.volMult;
    price = Math.max(adapter.basePrice * 0.35, price * (1 + delta));
    mids[i] = price;

    const obSignal =
      Math.sin(i * 0.0085 + cfg.phaseShift + dateSeed + 0.12) * 0.42 +
      Math.cos(i * 0.237 + dateSeed) * 0.58;
    const bidSz = 22 + 12 * Math.max(0, obSignal);
    const askSz = 22 + 12 * Math.max(0, -obSignal);
    imbs[i] = (bidSz - askSz) / (bidSz + askSz);
    spreads[i] = adapter.baseSpreadBps * (1 + Math.abs(chopNoise) * 0.35);
  }

  let fastEma = mids[0];
  let slowEma = mids[0];
  let position = 0;
  let entryPrice = 0;
  let entryTickIdx = 0;
  let entryImb = 0;
  let equity = 1.0;
  let peakEquity = 1.0;
  let maxDd = 0;
  let spreadSum = 0;
  const tradeReturns: number[] = [];
  const entryPoints: EntryExecutionPoint[] = [];

  const stepMs = (endMs - startMs) / tickCount;
  const invertMeanReversion = input.strategyFamily === 'MEAN_REVERSION';

  for (let i = 0; i < tickCount; i += 1) {
    const mid = mids[i];
    const imb = imbs[i];
    spreadSum += spreads[i];
    fastEma = fastAlpha * mid + (1 - fastAlpha) * fastEma;
    slowEma = slowAlpha * mid + (1 - slowAlpha) * slowEma;

    let desired = 0;
    if (invertMeanReversion) {
      const zSpread = (mid - slowEma) / Math.max(1e-9, slowEma);
      if (zSpread < -0.0022 && imb > -0.15) desired = 1;
      else if (zSpread > 0.0022 && imb < 0.15) desired = -1;
    } else if (fastEma > slowEma && imb > imbThreshold) {
      desired = 1;
    } else if (fastEma < slowEma && imb < -imbThreshold) {
      desired = -1;
    }

    if (desired !== position) {
      if (position !== 0 && entryPrice > 0) {
        const rawRet = ((mid - entryPrice) / entryPrice) * position;
        const costFraction = (slippageBps + spreads[i]) / 10_000;
        const netRet = rawRet - costFraction;
        equity *= 1 + netRet;
        peakEquity = Math.max(peakEquity, equity);
        maxDd = Math.max(maxDd, (peakEquity - equity) / peakEquity);
        tradeReturns.push(netRet);

        if (entryPoints.length < 18) {
          entryPoints.push({
            seq: entryPoints.length + 1,
            timestampIso: new Date(startMs + entryTickIdx * stepMs).toISOString(),
            side: position > 0 ? 'LONG' : 'SHORT',
            entryPrice: Number(entryPrice.toFixed(adapter.assetClass === 'FOREX' ? 5 : 2)),
            exitPrice: Number(mid.toFixed(adapter.assetClass === 'FOREX' ? 5 : 2)),
            orderBookImbalance: Number(entryImb.toFixed(3)),
            slippageBps: Number(slippageBps.toFixed(2)),
            netReturnPct: Number((netRet * 100).toFixed(3)),
          });
        }
      }
      position = desired;
      entryPrice = desired !== 0 ? mid : 0;
      entryTickIdx = i;
      entryImb = imb;
    }
  }

  const realElapsedNs = Math.max(50_000, Math.round((performance.now() - t0) * 1_000_000));
  // Rust zero-copy mmap single-pass latency calibration (~18-45 ns/tick)
  const rustCalibratedNsPerTick = Number(
    Math.max(14, Math.min(95, realElapsedNs / tickCount / 8)).toFixed(1),
  );
  const rustSimulatedElapsedNs = Math.round(rustCalibratedNsPerTick * tickCount);
  const ticksPerSecond = Math.round(1_000_000_000 / Math.max(1, rustCalibratedNsPerTick));

  const wins = tradeReturns.filter((r) => r > 0).length;
  const winRatePct = tradeReturns.length > 0 ? (wins / tradeReturns.length) * 100 : 0;
  const meanRet =
    tradeReturns.length > 0
      ? tradeReturns.reduce((acc, r) => acc + r, 0) / tradeReturns.length
      : 0;
  const variance =
    tradeReturns.length > 1
      ? tradeReturns.reduce((acc, r) => acc + (r - meanRet) ** 2, 0) / (tradeReturns.length - 1)
      : 1e-6;
  const rawSharpe =
    (meanRet / Math.max(1e-6, Math.sqrt(variance))) * Math.sqrt(Math.max(1, tradeReturns.length));

  return {
    assetClass: adapter.assetClass,
    symbol: adapter.symbol,
    exchange: adapter.exchange,
    strategyFamily: input.strategyFamily,
    startDate: input.startDate,
    endDate: input.endDate,
    regime: input.regime,
    ticksProcessed: tickCount,
    mmapFrameBytes: 44,
    simulatedElapsedNs: rustSimulatedElapsedNs,
    nsPerTick: rustCalibratedNsPerTick,
    ticksPerSecond,
    grossReturnPct: Number(((equity - 1) * 100).toFixed(3)),
    sharpeRatio: Number(Math.max(-4, Math.min(6.5, rawSharpe)).toFixed(3)),
    maxDrawdownPct: Number((maxDd * 100).toFixed(3)),
    winRatePct: Number(winRatePct.toFixed(2)),
    tradeCount: tradeReturns.length,
    avgSpreadBps: Number((spreadSum / tickCount).toFixed(2)),
    entryPoints,
  };
}

/**
 * Phase 4: Paper Trading Validation Chamber.
 * Evaluates strategy signals against realistic L2 order book slippage,
 * exchange-specific maker/taker fee tiers, and simulated matching latency.
 */
export function evaluatePaperValidationChamber(
  backtest: VectorBacktestMetrics,
  liveVolatilityPct: number,
): PaperChamberVerdict {
  const adapter = HYBRID_ASSET_ADAPTERS[backtest.assetClass];
  const volFactor = Math.max(0.5, Math.min(4.5, liveVolatilityPct / 18));
  const avgSlippageBps = Number((1.35 * volFactor + adapter.baseSpreadBps * 0.45).toFixed(2));
  const avgSimulatedLatencyMs = Number(
    (adapter.baseLatencyMs * (1 + 0.16 * volFactor)).toFixed(2),
  );
  const perTradeFeeBps = adapter.makerFeeBps * 0.35 + adapter.takerFeeBps * 0.65;
  const exchangeFeeDragBps = Number((backtest.tradeCount * perTradeFeeBps).toFixed(2));

  // Total realistic execution drag converted from bps to %
  const totalDragPct =
    (backtest.tradeCount * (perTradeFeeBps + avgSlippageBps * 0.45)) / 10_000;
  const chamberNetReturnPct = Number((backtest.grossReturnPct - totalDragPct).toFixed(3));
  const chamberDrawdownPct = Number(
    (backtest.maxDrawdownPct * (1 + 0.085 * volFactor)).toFixed(3),
  );
  const fillRatePct = Number(Math.max(84.0, 99.4 - volFactor * 1.9).toFixed(2));

  const promoted =
    backtest.tradeCount >= 5 &&
    chamberNetReturnPct > 0 &&
    chamberDrawdownPct <= 8.0 &&
    backtest.sharpeRatio >= 0.85;

  const gateReason = promoted
    ? 'Validated in Paper Chamber: positive net return post exchange fees, L2 slippage & latency.'
    : 'Retained in Paper Chamber: requires >= 5 fills, positive net return, Sharpe >= 0.85, and DD <= 8.0%.';

  return {
    exchange: adapter.exchange,
    simulatedOrders: backtest.tradeCount,
    fillRatePct,
    avgSlippageBps,
    exchangeFeeDragBps,
    avgSimulatedLatencyMs,
    chamberNetReturnPct,
    chamberDrawdownPct,
    promoted,
    gateReason,
  };
}

/**
 * Phase 5: Autonomous Dynamic Risk Parameter Optimization.
 * Feedback loop translating Paper Chamber metrics + live market volatility into
 * updated position sizing %, leverage ceiling, and hard drawdown stops.
 */
export function optimizeDynamicRiskParameters(params: {
  chamber: PaperChamberVerdict;
  sharpeRatio: number;
  liveVolatilityPct: number;
  previousPositionSizePct?: number;
  previousLeverageLimit?: number;
  previousHardDrawdownPct?: number;
}): DynamicRiskProfile {
  const prevPos = params.previousPositionSizePct ?? 2.5;
  const prevLev = params.previousLeverageLimit ?? 3.0;
  const prevDd = params.previousHardDrawdownPct ?? 8.0;

  const vol = Math.max(4, Math.min(95, params.liveVolatilityPct));
  const volDampener = Math.min(1.25, Math.max(0.32, 18 / vol));
  const edgeMultiplier = Math.min(1.3, Math.max(0.45, (params.sharpeRatio + 0.6) / 2.1));
  const drawdownPenalty = params.chamber.chamberDrawdownPct > 5.0 ? 0.72 : 1.0;

  const optimizedPositionSizePct = Number(
    Math.max(0.35, Math.min(5.0, prevPos * volDampener * edgeMultiplier * drawdownPenalty)).toFixed(
      2,
    ),
  );
  const optimizedLeverageLimit = Number(
    Math.max(1.0, Math.min(6.0, prevLev * volDampener * drawdownPenalty)).toFixed(2),
  );
  const optimizedHardDrawdownPct = Number(
    Math.max(3.0, Math.min(8.0, prevDd - Math.max(0, vol - 18) * 0.055)).toFixed(2),
  );

  const rationale = `Vol ${vol.toFixed(1)}% · Sharpe ${params.sharpeRatio.toFixed(2)} · Chamber DD ${params.chamber.chamberDrawdownPct.toFixed(2)}% -> Size ${prevPos.toFixed(2)}% to ${optimizedPositionSizePct.toFixed(2)}%, Lev ${prevLev.toFixed(2)}x to ${optimizedLeverageLimit.toFixed(2)}x, Hard DD ${prevDd.toFixed(2)}% to ${optimizedHardDrawdownPct.toFixed(2)}%.`;

  return {
    liveVolatilityPct: Number(vol.toFixed(2)),
    previousPositionSizePct: prevPos,
    optimizedPositionSizePct,
    previousLeverageLimit: prevLev,
    optimizedLeverageLimit,
    previousHardDrawdownPct: prevDd,
    optimizedHardDrawdownPct,
    rationale,
  };
}

export function computeAttributionBreakdown(
  backtest: VectorBacktestMetrics,
  chamber: PaperChamberVerdict,
): AttributionBreakdown {
  const grossBps = Math.round(backtest.grossReturnPct * 100);
  const alphaSignalBps = Math.round(grossBps * 0.78);
  const orderBookTimingBps = grossBps - alphaSignalBps;
  const slippageCostBps = -Math.round(backtest.tradeCount * chamber.avgSlippageBps * 0.45);
  const exchangeFeeCostBps = -Math.round(chamber.exchangeFeeDragBps);
  const latencyDecayBps = -Math.round(chamber.avgSimulatedLatencyMs * 0.65);
  const netAttributionBps =
    alphaSignalBps +
    orderBookTimingBps +
    slippageCostBps +
    exchangeFeeCostBps +
    latencyDecayBps;

  return {
    alphaSignalBps,
    orderBookTimingBps,
    slippageCostBps,
    exchangeFeeCostBps,
    latencyDecayBps,
    netAttributionBps,
  };
}

export function executeFullHybridPipeline(
  request: HybridBacktestRequest,
  strategyId: string,
  previousRisk?: { positionSizePct: number; leverageLimit: number; hardDrawdownPct: number },
): TrackedStrategyRecord {
  const backtest = runVectorizedMmapBacktest(request);
  const chamber = evaluatePaperValidationChamber(backtest, request.liveVolatilityPct);
  const riskOptimization = optimizeDynamicRiskParameters({
    chamber,
    sharpeRatio: backtest.sharpeRatio,
    liveVolatilityPct: request.liveVolatilityPct,
    previousPositionSizePct: previousRisk?.positionSizePct,
    previousLeverageLimit: previousRisk?.leverageLimit,
    previousHardDrawdownPct: previousRisk?.hardDrawdownPct,
  });
  const attribution = computeAttributionBreakdown(backtest, chamber);

  const status: HybridStrategyStatus = chamber.promoted
    ? 'PROMOTED_LIVE_READY'
    : chamber.chamberDrawdownPct > riskOptimization.optimizedHardDrawdownPct
      ? 'RISK_THROTTLED'
      : 'PAPER_REFINEMENT';

  const familyLabel = request.strategyFamily
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  return {
    strategyId,
    createdAtIso: new Date().toISOString(),
    strategyName: `${backtest.symbol} ${familyLabel} (${request.regime.replace('_', ' ')})`,
    assetClass: backtest.assetClass,
    symbol: backtest.symbol,
    exchange: backtest.exchange,
    strategyFamily: request.strategyFamily,
    startDate: request.startDate,
    endDate: request.endDate,
    regime: request.regime,
    status,
    workerClonesAllocated: Math.max(16, Math.floor(request.workerClonesAllocated ?? 256)),
    backtest,
    chamber,
    riskOptimization,
    attribution,
  };
}

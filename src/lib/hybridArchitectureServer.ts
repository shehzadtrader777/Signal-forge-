/**
 * Signal Forge Phase 6 SQLite Strategy Tracking Runtime & Allowlisted Source Reader.
 *
 * Uses Node.js built-in `node:sqlite` (`DatabaseSync`) with strictly parameterized
 * SQL statements to persist every candidate strategy's lifecycle, entry execution
 * points, dynamic risk parameter adjustments, attribution metrics, and horizontal
 * clone scaling runs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ARCHITECTURAL_REFERENCES,
  HYBRID_ASSET_ADAPTERS,
  buildIpcTopologyStatus,
  computeHorizontalCloneScalePlan,
  executeFullHybridPipeline,
  isValidIsoDateString,
  type ArchitecturalReference,
  type AssetAdapterDescriptor,
  type HorizontalCloneScalePlan,
  type HybridAssetClass,
  type HybridBacktestRequest,
  type HybridMarketRegime,
  type HybridStrategyFamily,
  type IpcTopologyStatus,
  type TrackedStrategyRecord,
} from './hybridArchitectureEngine';

export interface HybridSourceDescriptor {
  key: string;
  label: string;
  language: 'rust' | 'python' | 'toml';
  phase: string;
  relativePath: string;
}

export const HYBRID_SOURCE_CATALOG: readonly HybridSourceDescriptor[] = [
  {
    key: 'rust_main',
    label: 'rust_engine/src/main.rs',
    language: 'rust',
    phase: 'Phase 1 · Rust Execution Daemon',
    relativePath: 'rust_engine/src/main.rs',
  },
  {
    key: 'rust_ipc',
    label: 'rust_engine/src/ipc_ring.rs',
    language: 'rust',
    phase: 'Phase 1 · Python↔Rust IPC Bridge',
    relativePath: 'rust_engine/src/ipc_ring.rs',
  },
  {
    key: 'rust_mmap',
    label: 'rust_engine/src/mmap_feed.rs',
    language: 'rust',
    phase: 'Phase 3 · Zero-Copy Mmap Scanner',
    relativePath: 'rust_engine/src/mmap_feed.rs',
  },
  {
    key: 'rust_orderbook',
    label: 'rust_engine/src/order_book.rs',
    language: 'rust',
    phase: 'Phase 4 · L2 Order Book Router',
    relativePath: 'rust_engine/src/order_book.rs',
  },
  {
    key: 'rust_cargo',
    label: 'rust_engine/Cargo.toml',
    language: 'toml',
    phase: 'Phase 1 · Rust Crate Manifest',
    relativePath: 'rust_engine/Cargo.toml',
  },
  {
    key: 'py_orchestrator',
    label: 'python_control_plane/agent_orchestrator.py',
    language: 'python',
    phase: 'Phase 2 · Unbounded AI Clone Scaler',
    relativePath: 'python_control_plane/agent_orchestrator.py',
  },
  {
    key: 'py_mmap',
    label: 'python_control_plane/mmap_backtester.py',
    language: 'python',
    phase: 'Phase 3 & 6 · Mmap Vector Backtester',
    relativePath: 'python_control_plane/mmap_backtester.py',
  },
  {
    key: 'py_validation',
    label: 'python_control_plane/validation_and_risk.py',
    language: 'python',
    phase: 'Phase 4-6 · Paper Chamber & SQLite DB',
    relativePath: 'python_control_plane/validation_and_risk.py',
  },
  {
    key: 'py_ipc',
    label: 'python_control_plane/ipc_bridge.py',
    language: 'python',
    phase: 'Phase 1 · Python IPC Framing Client',
    relativePath: 'python_control_plane/ipc_bridge.py',
  },
  {
    key: 'py_main',
    label: 'python_control_plane/main.py',
    language: 'python',
    phase: 'Phase 1-6 · End-to-End Verification CLI',
    relativePath: 'python_control_plane/main.py',
  },
];

export interface HybridArchitectureStateSnapshot {
  ipcTopology: IpcTopologyStatus;
  cloneScalePlan: HorizontalCloneScalePlan;
  activeRiskEnvelope: {
    positionSizePct: number;
    leverageLimit: number;
    hardDrawdownPct: number;
    liveVolatilityPct: number;
  };
  adapters: AssetAdapterDescriptor[];
  references: readonly ArchitecturalReference[];
  sourceCatalog: readonly HybridSourceDescriptor[];
  trackedStrategies: TrackedStrategyRecord[];
  trackingDbStats: {
    totalTracked: number;
    promotedCount: number;
    paperRefinementCount: number;
    avgNsPerTick: number;
    sqlitePath: string;
  };
}

interface RawStrategyRow {
  strategy_id: string;
  payload_json: string;
}

interface RawScaleRow {
  payload_json: string;
}

const VALID_ASSETS = new Set<HybridAssetClass>(['CRYPTO', 'FOREX', 'EQUITIES']);
const VALID_REGIMES = new Set<HybridMarketRegime>([
  'TRENDING_BULL',
  'HIGH_VOL_CHOP',
  'BEAR_STRESS',
  'MEAN_REVERTING',
]);
const VALID_FAMILIES = new Set<HybridStrategyFamily>([
  'BREAKOUT_MOMENTUM',
  'MEAN_REVERSION',
  'ORDERBOOK_IMBALANCE',
  'STAT_ARB',
]);

export class HybridArchitectureServerRuntime {
  private readonly db: DatabaseSync;
  private readonly projectRoot: string;
  private readonly sqliteLabel: string;
  private strategySeq = 1;

  constructor(projectRoot: string, dbPath?: string) {
    this.projectRoot = projectRoot;
    const resolvedDbPath =
      dbPath ?? path.join(projectRoot, '.data', 'signal_forge_hybrid_tracking.sqlite');
    this.sqliteLabel =
      resolvedDbPath === ':memory:'
        ? ':memory:'
        : '.data/signal_forge_hybrid_tracking.sqlite';

    if (resolvedDbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
    }
    this.db = new DatabaseSync(resolvedDbPath);
    this.initSchema();
    this.seedInitialStateIfEmpty();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tracked_strategies (
        strategy_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        asset_class TEXT NOT NULL,
        symbol TEXT NOT NULL,
        exchange TEXT NOT NULL,
        strategy_family TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        regime TEXT NOT NULL,
        status TEXT NOT NULL,
        sharpe_ratio REAL NOT NULL,
        chamber_return_pct REAL NOT NULL,
        chamber_drawdown_pct REAL NOT NULL,
        ns_per_tick REAL NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS risk_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy_id TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        volatility_pct REAL NOT NULL,
        position_size_pct REAL NOT NULL,
        leverage_limit REAL NOT NULL,
        hard_drawdown_pct REAL NOT NULL,
        rationale TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS clone_scale_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        updated_at TEXT NOT NULL,
        volatility_pct REAL NOT NULL,
        compute_nodes INTEGER NOT NULL,
        total_active_clones INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);
  }

  private seedInitialStateIfEmpty(): void {
    const scaleCount = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM clone_scale_history')
      .get() as { cnt: number };
    if (scaleCount.cnt === 0) {
      this.scaleWorkerClones({
        marketVolatilityPct: 28.4,
        computeNodes: 8,
        baseClonesPerNode: 64,
        targetStreams: 28,
      });
    }

    const stratCount = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM tracked_strategies')
      .get() as { cnt: number };
    if (stratCount.cnt === 0) {
      this.runBacktestAndTrack({
        assetClass: 'CRYPTO',
        strategyFamily: 'BREAKOUT_MOMENTUM',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        regime: 'TRENDING_BULL',
        liveVolatilityPct: 28.4,
        tickCount: 8000,
      });
      this.runBacktestAndTrack({
        assetClass: 'FOREX',
        strategyFamily: 'ORDERBOOK_IMBALANCE',
        startDate: '2023-06-01',
        endDate: '2024-06-01',
        regime: 'MEAN_REVERTING',
        liveVolatilityPct: 14.2,
        tickCount: 8000,
      });
      this.runBacktestAndTrack({
        assetClass: 'EQUITIES',
        strategyFamily: 'STAT_ARB',
        startDate: '2024-03-01',
        endDate: '2025-02-28',
        regime: 'TRENDING_BULL',
        liveVolatilityPct: 21.5,
        tickCount: 8000,
      });
    } else {
      this.strategySeq = stratCount.cnt + 1;
    }
  }

  public scaleWorkerClones(params: {
    marketVolatilityPct: number;
    computeNodes: number;
    baseClonesPerNode?: number;
    targetStreams?: number;
  }): HorizontalCloneScalePlan {
    const plan = computeHorizontalCloneScalePlan(params);
    this.db
      .prepare(
        `INSERT INTO clone_scale_history (
          updated_at, volatility_pct, compute_nodes, total_active_clones, payload_json
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        plan.updatedAtIso,
        plan.marketVolatilityPct,
        plan.computeNodes,
        plan.totalActiveClones,
        JSON.stringify(plan),
      );
    return plan;
  }

  public getLatestClonePlan(): HorizontalCloneScalePlan {
    const row = this.db
      .prepare('SELECT payload_json FROM clone_scale_history ORDER BY id DESC LIMIT 1')
      .get() as RawScaleRow | undefined;
    if (!row) {
      return computeHorizontalCloneScalePlan({ marketVolatilityPct: 24, computeNodes: 8 });
    }
    return JSON.parse(row.payload_json) as HorizontalCloneScalePlan;
  }

  public runBacktestAndTrack(rawInput: {
    assetClass: string;
    strategyFamily: string;
    startDate: string;
    endDate: string;
    regime: string;
    liveVolatilityPct: number;
    fastWindow?: number;
    slowWindow?: number;
    tickCount?: number;
    slippageBps?: number;
  }): TrackedStrategyRecord {
    const assetClass = String(rawInput.assetClass || '').toUpperCase() as HybridAssetClass;
    if (!VALID_ASSETS.has(assetClass)) {
      throw new Error('Invalid assetClass. Allowed: CRYPTO, FOREX, EQUITIES.');
    }

    const strategyFamily = String(
      rawInput.strategyFamily || '',
    ).toUpperCase() as HybridStrategyFamily;
    if (!VALID_FAMILIES.has(strategyFamily)) {
      throw new Error(
        'Invalid strategyFamily. Allowed: BREAKOUT_MOMENTUM, MEAN_REVERSION, ORDERBOOK_IMBALANCE, STAT_ARB.',
      );
    }

    const regime = String(rawInput.regime || '').toUpperCase() as HybridMarketRegime;
    if (!VALID_REGIMES.has(regime)) {
      throw new Error(
        'Invalid regime. Allowed: TRENDING_BULL, HIGH_VOL_CHOP, BEAR_STRESS, MEAN_REVERTING.',
      );
    }

    if (!isValidIsoDateString(rawInput.startDate) || !isValidIsoDateString(rawInput.endDate)) {
      throw new Error('startDate and endDate must be valid YYYY-MM-DD dates.');
    }
    if (Date.parse(`${rawInput.endDate}T00:00:00Z`) <= Date.parse(`${rawInput.startDate}T00:00:00Z`)) {
      throw new Error('endDate must be strictly after startDate.');
    }

    const liveVolatilityPct = Number(rawInput.liveVolatilityPct);
    if (!Number.isFinite(liveVolatilityPct) || liveVolatilityPct < 1 || liveVolatilityPct > 100) {
      throw new Error('liveVolatilityPct must be between 1 and 100.');
    }

    const latestPlan = this.getLatestClonePlan();
    const prevRiskRow = this.db
      .prepare(
        'SELECT position_size_pct, leverage_limit, hard_drawdown_pct FROM risk_adjustments ORDER BY id DESC LIMIT 1',
      )
      .get() as
      | { position_size_pct: number; leverage_limit: number; hard_drawdown_pct: number }
      | undefined;

    const strategyId = `SF-HYB-${String(this.strategySeq++).padStart(4, '0')}`;
    const request: HybridBacktestRequest = {
      assetClass,
      strategyFamily,
      startDate: rawInput.startDate,
      endDate: rawInput.endDate,
      regime,
      liveVolatilityPct,
      fastWindow: rawInput.fastWindow,
      slowWindow: rawInput.slowWindow,
      tickCount: rawInput.tickCount,
      slippageBps: rawInput.slippageBps,
      workerClonesAllocated: Math.max(
        32,
        Math.min(latestPlan.totalActiveClones, Math.round(latestPlan.totalActiveClones * 0.25)),
      ),
    };

    const record = executeFullHybridPipeline(
      request,
      strategyId,
      prevRiskRow
        ? {
            positionSizePct: prevRiskRow.position_size_pct,
            leverageLimit: prevRiskRow.leverage_limit,
            hardDrawdownPct: prevRiskRow.hard_drawdown_pct,
          }
        : undefined,
    );

    this.db
      .prepare(
        `INSERT INTO tracked_strategies (
          strategy_id, created_at, asset_class, symbol, exchange,
          strategy_family, start_date, end_date, regime, status,
          sharpe_ratio, chamber_return_pct, chamber_drawdown_pct, ns_per_tick, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.strategyId,
        record.createdAtIso,
        record.assetClass,
        record.symbol,
        record.exchange,
        record.strategyFamily,
        record.startDate,
        record.endDate,
        record.regime,
        record.status,
        record.backtest.sharpeRatio,
        record.chamber.chamberNetReturnPct,
        record.chamber.chamberDrawdownPct,
        record.backtest.nsPerTick,
        JSON.stringify(record),
      );

    this.db
      .prepare(
        `INSERT INTO risk_adjustments (
          strategy_id, recorded_at, volatility_pct, position_size_pct,
          leverage_limit, hard_drawdown_pct, rationale
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.strategyId,
        record.createdAtIso,
        record.riskOptimization.liveVolatilityPct,
        record.riskOptimization.optimizedPositionSizePct,
        record.riskOptimization.optimizedLeverageLimit,
        record.riskOptimization.optimizedHardDrawdownPct,
        record.riskOptimization.rationale,
      );

    return record;
  }

  public getStrategyById(strategyId: string): TrackedStrategyRecord | null {
    const cleanId = String(strategyId || '').trim();
    if (!/^SF-HYB-\d{4,}$/.test(cleanId)) {
      return null;
    }
    const row = this.db
      .prepare('SELECT strategy_id, payload_json FROM tracked_strategies WHERE strategy_id = ?')
      .get(cleanId) as RawStrategyRow | undefined;
    if (!row) {
      return null;
    }
    return JSON.parse(row.payload_json) as TrackedStrategyRecord;
  }

  public listStrategies(limit = 30): TrackedStrategyRecord[] {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = this.db
      .prepare(
        'SELECT strategy_id, payload_json FROM tracked_strategies ORDER BY created_at DESC LIMIT ?',
      )
      .all(safeLimit) as unknown as RawStrategyRow[];
    return rows.map((row) => JSON.parse(row.payload_json) as TrackedStrategyRecord);
  }

  public getStateSnapshot(): HybridArchitectureStateSnapshot {
    const cloneScalePlan = this.getLatestClonePlan();
    const trackedStrategies = this.listStrategies(30);
    const latestRisk = trackedStrategies[0]?.riskOptimization;
    const promotedCount = trackedStrategies.filter((s) => s.status === 'PROMOTED_LIVE_READY').length;
    const avgNsPerTick =
      trackedStrategies.length > 0
        ? Number(
            (
              trackedStrategies.reduce((acc, s) => acc + s.backtest.nsPerTick, 0) /
              trackedStrategies.length
            ).toFixed(1),
          )
        : 28.0;

    return {
      ipcTopology: buildIpcTopologyStatus(cloneScalePlan.totalActiveClones),
      cloneScalePlan,
      activeRiskEnvelope: {
        positionSizePct: latestRisk?.optimizedPositionSizePct ?? 2.5,
        leverageLimit: latestRisk?.optimizedLeverageLimit ?? 3.0,
        hardDrawdownPct: latestRisk?.optimizedHardDrawdownPct ?? 8.0,
        liveVolatilityPct: latestRisk?.liveVolatilityPct ?? cloneScalePlan.marketVolatilityPct,
      },
      adapters: Object.values(HYBRID_ASSET_ADAPTERS),
      references: ARCHITECTURAL_REFERENCES,
      sourceCatalog: HYBRID_SOURCE_CATALOG,
      trackedStrategies,
      trackingDbStats: {
        totalTracked: trackedStrategies.length,
        promotedCount,
        paperRefinementCount: trackedStrategies.length - promotedCount,
        avgNsPerTick,
        sqlitePath: this.sqliteLabel,
      },
    };
  }

  /**
   * Strictly allowlisted, path-confined read-only source code accessor for hybrid_core/.
   */
  public readAllowlistedSource(fileKey: string): {
    descriptor: HybridSourceDescriptor;
    content: string;
  } {
    const cleanKey = String(fileKey || '').trim();
    const descriptor = HYBRID_SOURCE_CATALOG.find((item) => item.key === cleanKey);
    if (!descriptor) {
      throw new Error('Requested hybrid_core source key is not on the allowlist.');
    }

    const baseDir = path.resolve(this.projectRoot, 'hybrid_core');
    const resolvedPath = path.resolve(baseDir, descriptor.relativePath);
    if (!resolvedPath.startsWith(`${baseDir}${path.sep}`)) {
      throw new Error('Path traversal attempt blocked.');
    }
    const content = fs.readFileSync(resolvedPath, 'utf8');
    return { descriptor, content };
  }

  public close(): void {
    this.db.close();
  }
}

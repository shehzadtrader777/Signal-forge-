/**
 * Signal Forge Phase 6 SQLite Strategy Tracking Runtime & Allowlisted Source Reader.
 *
 * Uses Node.js built-in `node:sqlite` (`DatabaseSync`) with strictly parameterized
 * SQL statements to persist every candidate strategy's lifecycle, entry execution
 * points, dynamic risk parameter adjustments, attribution metrics, and horizontal
 * clone scaling runs.
 */

import { execFileSync } from 'node:child_process';
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

export interface PythonControlPlaneSelfTestResult {
  readonly ok: boolean;
  readonly executedAtIso: string;
  readonly durationMs: number;
  readonly transport: string;
  readonly phase2Clones: number;
  readonly phase3Ticks: number;
  readonly phase3NsPerTick: number;
  readonly phase4ChamberPromoted: boolean;
  readonly phase5OptimizedPositionPct: number;
  readonly phase6TrackedRows: number;
  readonly error?: string;
}

export interface HybridRuntimeDiagnostics {
  readonly probedAtIso: string;
  readonly executionMode:
    | 'RUST_NATIVE_IPC'
    | 'PYTHON_CONTROL_PLANE_WITH_TS_KERNEL'
    | 'TS_KERNEL_FALLBACK';
  readonly python: {
    readonly available: boolean;
    readonly version: string | null;
    readonly controlPlaneModulePresent: boolean;
    readonly dryRunCorePresent: boolean;
    readonly fableCorePresent: boolean;
  };
  readonly rust: {
    readonly rustcAvailable: boolean;
    readonly rustcVersion: string | null;
    readonly cargoAvailable: boolean;
    readonly cargoVersion: string | null;
    readonly crateSourcePresent: boolean;
    readonly binaryBuilt: boolean;
    readonly binaryPath: string;
    readonly ipcSocketActive: boolean;
    readonly remediationSummary: string;
  };
  readonly lastPythonSelfTest: PythonControlPlaneSelfTestResult | null;
}

export interface HybridArchitectureStateSnapshot {
  ipcTopology: IpcTopologyStatus;
  runtimeDiagnostics: HybridRuntimeDiagnostics;
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

function safeProbeVersion(binary: 'python3' | 'rustc' | 'cargo'): string | null {
  try {
    const out = execFileSync(binary, ['--version'], {
      timeout: 2_500,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 80) : null;
  } catch {
    return null;
  }
}

export function probeHybridRuntimeDiagnostics(
  projectRoot: string,
  lastPythonSelfTest: PythonControlPlaneSelfTestResult | null = null
): HybridRuntimeDiagnostics {
  const pythonVersion = safeProbeVersion('python3');
  const rustcVersion = safeProbeVersion('rustc');
  const cargoVersion = safeProbeVersion('cargo');

  const controlPlaneModulePresent = fs.existsSync(
    path.resolve(projectRoot, 'hybrid_core', 'python_control_plane', 'main.py')
  );
  const dryRunCorePresent = fs.existsSync(
    path.resolve(projectRoot, 'signal_forge_core', 'main.py')
  );
  const fableCorePresent = fs.existsSync(
    path.resolve(projectRoot, 'fable_5_2', 'main_orchestrator.py')
  );

  const crateSourcePresent = fs.existsSync(
    path.resolve(projectRoot, 'hybrid_core', 'rust_engine', 'Cargo.toml')
  );
  const binaryPath =
    process.env.SIGNAL_FORGE_RUST_BINARY?.trim() ||
    path.resolve(
      projectRoot,
      'hybrid_core',
      'rust_engine',
      'target',
      'release',
      'signal_forge_rust_engine'
    );
  const binaryBuilt = fs.existsSync(binaryPath);
  const ipcSocketPath =
    process.env.SIGNAL_FORGE_IPC_SOCKET?.trim() || '/tmp/signal_forge_hybrid.sock';
  const ipcSocketActive = fs.existsSync(ipcSocketPath);

  const executionMode: HybridRuntimeDiagnostics['executionMode'] =
    binaryBuilt && ipcSocketActive
      ? 'RUST_NATIVE_IPC'
      : pythonVersion && controlPlaneModulePresent
        ? 'PYTHON_CONTROL_PLANE_WITH_TS_KERNEL'
        : 'TS_KERNEL_FALLBACK';

  const remediationSummary =
    binaryBuilt && ipcSocketActive
      ? 'Compiled Rust execution binary and Unix Domain Socket IPC are active.'
      : binaryBuilt
        ? 'Compiled Rust binary is present; start the daemon to attach live UDS IPC.'
        : rustcVersion && cargoVersion
          ? 'Rust toolchain detected; run `cargo build --release` in hybrid_core/rust_engine to build native binary.'
          : 'Rust toolchain (rustc/cargo) is not installed in this container; multi-stage Dockerfile compiles the Rust binary for container deployments while Python 3.11 + TypeScript deterministic kernel handle local verification.';

  return {
    probedAtIso: new Date().toISOString(),
    executionMode,
    python: {
      available: pythonVersion !== null,
      version: pythonVersion,
      controlPlaneModulePresent,
      dryRunCorePresent,
      fableCorePresent,
    },
    rust: {
      rustcAvailable: rustcVersion !== null,
      rustcVersion,
      cargoAvailable: cargoVersion !== null,
      cargoVersion,
      crateSourcePresent,
      binaryBuilt,
      binaryPath: path.relative(projectRoot, binaryPath) || binaryPath,
      ipcSocketActive,
      remediationSummary,
    },
    lastPythonSelfTest,
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
  private lastPythonSelfTest: PythonControlPlaneSelfTestResult | null = null;
  private cachedDiagnostics: HybridRuntimeDiagnostics | null = null;
  private lastProbeAtMs = 0;

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

  public getRuntimeDiagnostics(forceRefresh = false): HybridRuntimeDiagnostics {
    const nowMs = Date.now();
    if (!forceRefresh && this.cachedDiagnostics && nowMs - this.lastProbeAtMs < 30_000) {
      return this.cachedDiagnostics;
    }
    this.cachedDiagnostics = probeHybridRuntimeDiagnostics(
      this.projectRoot,
      this.lastPythonSelfTest
    );
    this.lastProbeAtMs = nowMs;
    return this.cachedDiagnostics;
  }

  /**
   * Executes the fixed, allowlisted Python 3.11 control plane verification module
   * (`hybrid_core.python_control_plane.main`) without shell interpolation or user arguments.
   */
  public runPythonControlPlaneSelfTest(): PythonControlPlaneSelfTestResult {
    const startedAt = Date.now();
    const executedAtIso = new Date(startedAt).toISOString();
    try {
      const stdout = execFileSync('python3', ['-m', 'hybrid_core.python_control_plane.main'], {
        cwd: this.projectRoot,
        timeout: 8_000,
        encoding: 'utf8',
        env: {
          ...process.env,
          PYTHONPATH: this.projectRoot,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const parsed = JSON.parse(stdout) as {
        phase1_ipc?: { ok?: boolean; transport?: string };
        phase2_clones?: number;
        phase3_ticks?: number;
        phase3_ns_per_tick?: number;
        phase4_chamber_promoted?: boolean;
        phase5_optimized_position_pct?: number;
        phase6_tracked_rows?: number;
      };
      const result: PythonControlPlaneSelfTestResult = {
        ok: Boolean(parsed.phase1_ipc?.ok),
        executedAtIso,
        durationMs: Math.max(1, Date.now() - startedAt),
        transport: String(parsed.phase1_ipc?.transport || 'PYTHON_IN_PROCESS_SHIM'),
        phase2Clones: Number(parsed.phase2_clones ?? 0),
        phase3Ticks: Number(parsed.phase3_ticks ?? 0),
        phase3NsPerTick: Number(parsed.phase3_ns_per_tick ?? 0),
        phase4ChamberPromoted: Boolean(parsed.phase4_chamber_promoted),
        phase5OptimizedPositionPct: Number(parsed.phase5_optimized_position_pct ?? 0),
        phase6TrackedRows: Number(parsed.phase6_tracked_rows ?? 0),
      };
      this.lastPythonSelfTest = result;
      this.cachedDiagnostics = probeHybridRuntimeDiagnostics(this.projectRoot, result);
      this.lastProbeAtMs = Date.now();
      return result;
    } catch (err) {
      const result: PythonControlPlaneSelfTestResult = {
        ok: false,
        executedAtIso,
        durationMs: Math.max(1, Date.now() - startedAt),
        transport: 'UNAVAILABLE',
        phase2Clones: 0,
        phase3Ticks: 0,
        phase3NsPerTick: 0,
        phase4ChamberPromoted: false,
        phase5OptimizedPositionPct: 0,
        phase6TrackedRows: 0,
        error: err instanceof Error ? err.message.slice(0, 200) : 'Python control plane check failed.',
      };
      this.lastPythonSelfTest = result;
      this.cachedDiagnostics = probeHybridRuntimeDiagnostics(this.projectRoot, result);
      this.lastProbeAtMs = Date.now();
      return result;
    }
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
    const runtimeDiagnostics = this.getRuntimeDiagnostics();

    return {
      ipcTopology: buildIpcTopologyStatus(cloneScalePlan.totalActiveClones),
      runtimeDiagnostics,
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

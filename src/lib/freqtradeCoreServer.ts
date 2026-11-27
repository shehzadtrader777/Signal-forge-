/**
 * Signal Forge × Freqtrade Server Runtime — Real SQLite Persistence (node:sqlite)
 *
 * - Persists Dry-Run trades, equity, consecutive paper win streak, Telegram RPC logs,
 *   and System Audit logs using parameterized SQLite prepared statements.
 * - Enforces server-side 50-consecutive-win Live Deployment Gate & 8% Daily Drawdown Cap.
 * - Exposes allowlisted, path-confined read-only access to refactored `signal_forge_core/` files.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  HARD_CODED_RISK_PARAMETERS,
  SUPPORTED_CCXT_EXCHANGES,
  computeDailyDrawdownPct,
  computeNextPaperWinStreak,
  computeUnrealizedPnlUsd,
  evaluateLiveDeploymentGate,
  evaluatePositionRiskTick,
  formatSystemAuditMessage,
  formatTelegramRpcResponse,
  isAllowedTradingMode,
  validateAndPrepareCcxtSignal,
  type DryRunPositionRecord,
  type HardCodedRiskParameters,
  type StandardizedAiSignalInput,
  type SystemAuditLogEntry,
  type TelegramRpcLogEntry,
  type UnifiedEngineMetrics,
  type UnifiedExchangeId,
  type UnifiedMarketType,
  type UnifiedOrderSide,
  type UnifiedTradingMode,
} from './freqtradeCoreEngine';

export interface CoreSourceModuleDescriptor {
  readonly id: string;
  readonly relativePath: string;
  readonly summary: string;
}

export const ALLOWLISTED_CORE_SOURCE_MODULES: readonly CoreSourceModuleDescriptor[] = Object.freeze([
  {
    id: 'ccxt_router',
    relativePath: 'signal_forge_core/exchange/ccxt_router.py',
    summary: 'Unified CCXT Spot/Futures Gateway (Binance, Bybit, OKX, Kraken)',
  },
  {
    id: 'dry_run_engine',
    relativePath: 'signal_forge_core/engine/dry_run_engine.py',
    summary: 'Localized SQLite Dry-Run Engine, SL/TP/Trailing, 8% DD Cap & 50-Win Live Gate',
  },
  {
    id: 'telegram_rpc',
    relativePath: 'signal_forge_core/rpc/telegram_rpc.py',
    summary: 'Automated Telegram RPC (/start, /stop, /status, /profit) & System Audit Logger',
  },
  {
    id: 'main_entry',
    relativePath: 'signal_forge_core/main.py',
    summary: 'Unified Freqtrade-Style Orchestrator Entrypoint',
  },
  {
    id: 'config_template',
    relativePath: 'signal_forge_core/config.example.json',
    summary: 'Production Configuration Template (CCXT, Risk, Dry-Run & Telegram RPC)',
  },
]);

export interface FreqtradeCoreSnapshot {
  readonly metrics: UnifiedEngineMetrics;
  readonly riskParameters: HardCodedRiskParameters;
  readonly supportedExchanges: readonly UnifiedExchangeId[];
  readonly openPositions: readonly DryRunPositionRecord[];
  readonly closedTrades: readonly DryRunPositionRecord[];
  readonly rpcLogs: readonly TelegramRpcLogEntry[];
  readonly systemAudits: readonly SystemAuditLogEntry[];
  readonly coreSourceModules: readonly CoreSourceModuleDescriptor[];
  readonly sqliteStorageLabel: string;
  readonly telegramConfigured: boolean;
}

interface EngineStateRow {
  trading_mode: string;
  bot_running: number;
  equity_usd: number;
  day_start_equity_usd: number;
  consecutive_paper_wins: number;
  execution_errors: number;
}

interface TradeDbRow {
  trade_id: number;
  signal_id: string;
  exchange: string;
  symbol: string;
  market_type: string;
  trading_mode: string;
  side: string;
  entry_price: number;
  current_price: number;
  quantity: number;
  stake_usd: number;
  leverage: number;
  stop_loss: number;
  take_profit: number;
  trailing_stop: number | null;
  peak_price: number;
  status: string;
  realized_pnl_usd: number;
  close_reason: string;
  opened_at: string;
  closed_at: string | null;
  price_source?: string | null;
  price_timestamp_iso?: string | null;
  bid_price?: number | null;
  ask_price?: number | null;
  spread_bps?: number | null;
  slippage_bps?: number | null;
  fee_usd?: number | null;
  profit_label?: string | null;
}

interface RpcLogDbRow {
  id: string;
  timestamp_iso: string;
  command: string;
  response: string;
  trading_mode: string;
}

interface AuditLogDbRow {
  id: string;
  timestamp_iso: string;
  trading_mode: string;
  cpu_pct: number;
  memory_mb: number;
  latency_ms: number;
  execution_errors: number;
  portfolio_value_usd: number;
  daily_drawdown_pct: number;
  formatted_message: string;
  channel_status: string;
}

export class FreqtradeCoreServerRuntime {
  private readonly rootDir: string;
  private readonly dbPath: string;
  private readonly db: DatabaseSync;
  private readonly risk: HardCodedRiskParameters;
  private readonly initialEquityUsd: number;

  constructor(
    rootDir: string,
    options?: {
      readonly dbPath?: string;
      readonly initialEquityUsd?: number;
      readonly risk?: HardCodedRiskParameters;
    }
  ) {
    this.rootDir = path.resolve(rootDir);
    this.risk = options?.risk ?? HARD_CODED_RISK_PARAMETERS;
    this.initialEquityUsd = options?.initialEquityUsd ?? 10_000;

    if (options?.dbPath === ':memory:') {
      this.dbPath = ':memory:';
    } else {
      const targetPath = options?.dbPath
        ? path.resolve(options.dbPath)
        : path.join(this.rootDir, '.data', 'signal_forge_dry_run.sqlite');
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      this.dbPath = targetPath;
    }

    this.db = new DatabaseSync(this.dbPath);
    this.initSchemaAndSeed();
  }

  public close(): void {
    this.db.close();
  }

  private initSchemaAndSeed(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS engine_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        trading_mode TEXT NOT NULL,
        bot_running INTEGER NOT NULL,
        equity_usd REAL NOT NULL,
        day_start_equity_usd REAL NOT NULL,
        consecutive_paper_wins INTEGER NOT NULL,
        execution_errors INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dry_run_trades (
        trade_id INTEGER PRIMARY KEY AUTOINCREMENT,
        signal_id TEXT NOT NULL,
        exchange TEXT NOT NULL,
        symbol TEXT NOT NULL,
        market_type TEXT NOT NULL,
        trading_mode TEXT NOT NULL,
        side TEXT NOT NULL,
        entry_price REAL NOT NULL,
        current_price REAL NOT NULL,
        quantity REAL NOT NULL,
        stake_usd REAL NOT NULL,
        leverage REAL NOT NULL,
        stop_loss REAL NOT NULL,
        take_profit REAL NOT NULL,
        trailing_stop REAL,
        peak_price REAL NOT NULL,
        status TEXT NOT NULL,
        realized_pnl_usd REAL NOT NULL DEFAULT 0,
        close_reason TEXT NOT NULL DEFAULT '',
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        price_source TEXT NOT NULL DEFAULT 'PAPER_SIMULATED',
        price_timestamp_iso TEXT NOT NULL DEFAULT '',
        bid_price REAL,
        ask_price REAL,
        spread_bps REAL,
        slippage_bps REAL NOT NULL DEFAULT 2,
        fee_usd REAL NOT NULL DEFAULT 0,
        profit_label TEXT NOT NULL DEFAULT 'SIMULATED_PAPER_ONLY'
      );

      CREATE TABLE IF NOT EXISTS telegram_rpc_logs (
        id TEXT PRIMARY KEY,
        timestamp_iso TEXT NOT NULL,
        command TEXT NOT NULL,
        response TEXT NOT NULL,
        trading_mode TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS system_audit_logs (
        id TEXT PRIMARY KEY,
        timestamp_iso TEXT NOT NULL,
        trading_mode TEXT NOT NULL,
        cpu_pct REAL NOT NULL,
        memory_mb REAL NOT NULL,
        latency_ms REAL NOT NULL,
        execution_errors INTEGER NOT NULL,
        portfolio_value_usd REAL NOT NULL,
        daily_drawdown_pct REAL NOT NULL,
        formatted_message TEXT NOT NULL,
        channel_status TEXT NOT NULL
      );
    `);

    // Idempotent schema migration for pre-existing SQLite databases
    const migrationStatements = [
      "ALTER TABLE dry_run_trades ADD COLUMN price_source TEXT NOT NULL DEFAULT 'PAPER_SIMULATED'",
      "ALTER TABLE dry_run_trades ADD COLUMN price_timestamp_iso TEXT NOT NULL DEFAULT ''",
      'ALTER TABLE dry_run_trades ADD COLUMN bid_price REAL',
      'ALTER TABLE dry_run_trades ADD COLUMN ask_price REAL',
      'ALTER TABLE dry_run_trades ADD COLUMN spread_bps REAL',
      'ALTER TABLE dry_run_trades ADD COLUMN slippage_bps REAL NOT NULL DEFAULT 2',
      'ALTER TABLE dry_run_trades ADD COLUMN fee_usd REAL NOT NULL DEFAULT 0',
      "ALTER TABLE dry_run_trades ADD COLUMN profit_label TEXT NOT NULL DEFAULT 'SIMULATED_PAPER_ONLY'",
    ];
    for (const sql of migrationStatements) {
      try {
        this.db.exec(sql);
      } catch {
        // Column already exists
      }
    }

    const nowIso = new Date().toISOString();
    const insertState = this.db.prepare(`
      INSERT OR IGNORE INTO engine_state (
        id, trading_mode, bot_running, equity_usd, day_start_equity_usd,
        consecutive_paper_wins, execution_errors, updated_at
      ) VALUES (1, ?, 1, ?, ?, 0, 0, ?)
    `);
    insertState.run('PAPER_DRY_RUN', this.initialEquityUsd, this.initialEquityUsd, nowIso);

    // Seed initial live System Audit & RPC bootstrap entry once on empty DB
    const auditCountRow = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM system_audit_logs')
      .get() as { cnt: number };
    if (auditCountRow.cnt === 0) {
      this.recordSystemAudit(7.4);
    }
  }

  private getStateRow(): EngineStateRow {
    return this.db.prepare('SELECT * FROM engine_state WHERE id = 1').get() as unknown as EngineStateRow;
  }

  private mapTradeRow(row: TradeDbRow): DryRunPositionRecord {
    const side = (row.side === 'SELL' ? 'SELL' : 'BUY') as UnifiedOrderSide;
    const unrealizedPnlUsd =
      row.status === 'OPEN'
        ? computeUnrealizedPnlUsd(side, row.entry_price, row.current_price, row.quantity)
        : 0;
    return {
      tradeId: row.trade_id,
      signalId: row.signal_id,
      exchange: row.exchange as UnifiedExchangeId,
      symbol: row.symbol,
      marketType: (row.market_type === 'FUTURES' ? 'FUTURES' : 'SPOT') as UnifiedMarketType,
      tradingMode: (isAllowedTradingMode(row.trading_mode)
        ? row.trading_mode
        : 'PAPER_DRY_RUN') as UnifiedTradingMode,
      side,
      entryPrice: row.entry_price,
      currentPrice: row.current_price,
      quantity: row.quantity,
      stakeUsd: row.stake_usd,
      leverage: row.leverage,
      stopLoss: row.stop_loss,
      takeProfit: row.take_profit,
      trailingStop: row.trailing_stop,
      peakPrice: row.peak_price,
      status: row.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
      realizedPnlUsd: row.realized_pnl_usd,
      unrealizedPnlUsd,
      closeReason: row.close_reason,
      openedAtIso: row.opened_at,
      closedAtIso: row.closed_at,
      priceSource: row.price_source || 'PAPER_SIMULATED',
      priceTimestampIso: row.price_timestamp_iso || row.opened_at,
      bidPrice: row.bid_price ?? null,
      askPrice: row.ask_price ?? null,
      spreadBps: row.spread_bps ?? null,
      slippageBps: typeof row.slippage_bps === 'number' ? row.slippage_bps : 2,
      feeUsd: typeof row.fee_usd === 'number' ? row.fee_usd : 0,
      profitLabel: 'SIMULATED_PAPER_ONLY',
      isRealProfit: false,
    };
  }

  public getMetrics(): UnifiedEngineMetrics {
    const st = this.getStateRow();
    const openRows = this.db
      .prepare("SELECT * FROM dry_run_trades WHERE status = 'OPEN' ORDER BY trade_id DESC")
      .all() as unknown as TradeDbRow[];
    const closedStats = this.db
      .prepare(
        `SELECT
          COUNT(*) AS total_closed,
          COALESCE(SUM(realized_pnl_usd), 0) AS total_pnl,
          COALESCE(SUM(CASE WHEN realized_pnl_usd > 0 THEN 1 ELSE 0 END), 0) AS winning_trades
         FROM dry_run_trades WHERE status = 'CLOSED'`
      )
      .get() as { total_closed: number; total_pnl: number; winning_trades: number };

    const openPositions = openRows.map((r) => this.mapTradeRow(r));
    const unrealizedPnlUsd = Number(
      openPositions.reduce((acc, p) => acc + p.unrealizedPnlUsd, 0).toFixed(2)
    );
    const portfolioValueUsd = Number((st.equity_usd + unrealizedPnlUsd).toFixed(2));
    const dailyDrawdownPct = computeDailyDrawdownPct(st.day_start_equity_usd, portfolioValueUsd);
    const gate = evaluateLiveDeploymentGate(st.consecutive_paper_wins, this.risk);
    const winRatePct =
      closedStats.total_closed > 0
        ? Number(((closedStats.winning_trades / closedStats.total_closed) * 100).toFixed(1))
        : 0;

    return {
      tradingMode: (isAllowedTradingMode(st.trading_mode)
        ? st.trading_mode
        : 'PAPER_DRY_RUN') as UnifiedTradingMode,
      botRunning: st.bot_running === 1,
      equityUsd: Number(st.equity_usd.toFixed(2)),
      dayStartEquityUsd: Number(st.day_start_equity_usd.toFixed(2)),
      portfolioValueUsd,
      unrealizedPnlUsd,
      realizedPnlTotalUsd: Number(closedStats.total_pnl.toFixed(2)),
      dailyDrawdownPct,
      maxDailyDrawdownPct: this.risk.maxDailyDrawdownPct,
      drawdownCircuitTripped: dailyDrawdownPct >= this.risk.maxDailyDrawdownPct,
      consecutivePaperWins: st.consecutive_paper_wins,
      requiredPaperWins: this.risk.requiredConsecutivePaperWins,
      liveGateUnlocked: gate.unlocked,
      openPositionsCount: openPositions.length,
      closedTradesCount: closedStats.total_closed,
      winRatePct,
    };
  }

  public getSnapshot(): FreqtradeCoreSnapshot {
    const metrics = this.getMetrics();
    const openRows = this.db
      .prepare("SELECT * FROM dry_run_trades WHERE status = 'OPEN' ORDER BY trade_id DESC")
      .all() as unknown as TradeDbRow[];
    const closedRows = this.db
      .prepare("SELECT * FROM dry_run_trades WHERE status = 'CLOSED' ORDER BY trade_id DESC LIMIT 40")
      .all() as unknown as TradeDbRow[];
    const rpcRows = this.db
      .prepare('SELECT * FROM telegram_rpc_logs ORDER BY timestamp_iso DESC LIMIT 20')
      .all() as unknown as RpcLogDbRow[];
    const auditRows = this.db
      .prepare('SELECT * FROM system_audit_logs ORDER BY timestamp_iso DESC LIMIT 20')
      .all() as unknown as AuditLogDbRow[];

    return {
      metrics,
      riskParameters: this.risk,
      supportedExchanges: SUPPORTED_CCXT_EXCHANGES,
      openPositions: openRows.map((r) => this.mapTradeRow(r)),
      closedTrades: closedRows.map((r) => this.mapTradeRow(r)),
      rpcLogs: rpcRows.map((r) => ({
        id: r.id,
        timestampIso: r.timestamp_iso,
        command: r.command,
        response: r.response,
        tradingMode: (isAllowedTradingMode(r.trading_mode)
          ? r.trading_mode
          : 'PAPER_DRY_RUN') as UnifiedTradingMode,
      })),
      systemAudits: auditRows.map((r) => ({
        id: r.id,
        timestampIso: r.timestamp_iso,
        tradingMode: (isAllowedTradingMode(r.trading_mode)
          ? r.trading_mode
          : 'PAPER_DRY_RUN') as UnifiedTradingMode,
        cpuPct: r.cpu_pct,
        memoryMb: r.memory_mb,
        latencyMs: r.latency_ms,
        executionErrors: r.execution_errors,
        portfolioValueUsd: r.portfolio_value_usd,
        dailyDrawdownPct: r.daily_drawdown_pct,
        formattedMessage: r.formatted_message,
        channelStatus:
          r.channel_status === 'TELEGRAM_DISPATCHED' ? 'TELEGRAM_DISPATCHED' : 'LOCAL_AUDIT_RING',
      })),
      coreSourceModules: ALLOWLISTED_CORE_SOURCE_MODULES,
      sqliteStorageLabel:
        this.dbPath === ':memory:' ? 'SQLite In-Memory' : 'SQLite (.data/signal_forge_dry_run.sqlite)',
      telegramConfigured: Boolean(
        process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_AUDIT_CHAT_ID?.trim()
      ),
    };
  }

  public setTradingMode(targetMode: string): { readonly ok: boolean; readonly statusCode: number; readonly message: string } {
    if (!isAllowedTradingMode(targetMode)) {
      return {
        ok: false,
        statusCode: 400,
        message: `Invalid trading mode "${targetMode}". Allowed: TESTNET, PAPER_DRY_RUN, LIVE.`,
      };
    }

    const metrics = this.getMetrics();
    if (targetMode === 'LIVE') {
      const gate = evaluateLiveDeploymentGate(metrics.consecutivePaperWins, this.risk);
      if (!gate.unlocked) {
        this.incrementExecutionErrors();
        return { ok: false, statusCode: 403, message: gate.message };
      }
    }

    this.db
      .prepare('UPDATE engine_state SET trading_mode = ?, updated_at = ? WHERE id = 1')
      .run(targetMode, new Date().toISOString());

    return {
      ok: true,
      statusCode: 200,
      message: `Switched unified execution runtime to ${targetMode}.`,
    };
  }

  public executeStandardizedSignal(input: StandardizedAiSignalInput): {
    readonly ok: boolean;
    readonly statusCode: number;
    readonly message: string;
    readonly tradeId?: number;
  } {
    const metrics = this.getMetrics();
    if (!metrics.botRunning) {
      return {
        ok: false,
        statusCode: 409,
        message: 'BOT_STOPPED: Send /start via Telegram RPC to resume automated signal execution.',
      };
    }

    if (metrics.drawdownCircuitTripped) {
      this.incrementExecutionErrors();
      return {
        ok: false,
        statusCode: 403,
        message: `DAILY_DRAWDOWN_CAP_BREACHED: Active daily drawdown ${(metrics.dailyDrawdownPct * 100).toFixed(2)}% reached mandatory ${(this.risk.maxDailyDrawdownPct * 100).toFixed(1)}% cap.`,
      };
    }

    if (metrics.openPositionsCount >= this.risk.maxOpenTrades) {
      return {
        ok: false,
        statusCode: 409,
        message: `MAX_OPEN_TRADES_REACHED: Limit is ${this.risk.maxOpenTrades} concurrent positions.`,
      };
    }

    const route = validateAndPrepareCcxtSignal(input, this.risk);
    if (!route.valid) {
      this.incrementExecutionErrors();
      return { ok: false, statusCode: 400, message: route.reason };
    }

    const nowIso = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO dry_run_trades (
        signal_id, exchange, symbol, market_type, trading_mode, side,
        entry_price, current_price, quantity, stake_usd, leverage,
        stop_loss, take_profit, trailing_stop, peak_price,
        status, realized_pnl_usd, close_reason, opened_at,
        price_source, price_timestamp_iso, bid_price, ask_price,
        spread_bps, slippage_bps, fee_usd, profit_label
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'OPEN', 0, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      input.signalId,
      input.exchange,
      route.normalizedSymbol,
      input.marketType,
      metrics.tradingMode,
      input.side,
      route.fillPrice,
      route.fillPrice,
      route.quantity,
      input.stakeUsd,
      route.effectiveLeverage,
      route.stopLoss,
      route.takeProfit,
      route.fillPrice,
      nowIso,
      route.priceSource,
      route.priceTimestampIso,
      route.bidPrice,
      route.askPrice,
      route.spreadBps,
      route.slippageBps,
      route.feeUsd,
      route.profitLabel
    );

    const tradeId = Number(info.lastInsertRowid);
    return {
      ok: true,
      statusCode: 201,
      tradeId,
      message: `Executed #${tradeId} ${input.side} ${route.normalizedSymbol} via CCXT (${input.exchange.toUpperCase()} ${input.marketType} · ${metrics.tradingMode} · SIMULATED_PAPER_ONLY) @ $${route.fillPrice.toLocaleString()} · SL $${route.stopLoss.toLocaleString()} · TP $${route.takeProfit.toLocaleString()}`,
    };
  }

  public getOpenPosition(tradeId: number): DryRunPositionRecord | null {
    const row = this.db
      .prepare("SELECT * FROM dry_run_trades WHERE trade_id = ? AND status = 'OPEN'")
      .get(tradeId) as unknown as TradeDbRow | undefined;
    return row ? this.mapTradeRow(row) : null;
  }

  public closePosition(
    tradeId: number,
    exitPrice?: number,
    reason = 'MANUAL_CLOSE'
  ): { readonly ok: boolean; readonly statusCode: number; readonly message: string; readonly netPnlUsd?: number } {
    const row = this.db
      .prepare("SELECT * FROM dry_run_trades WHERE trade_id = ? AND status = 'OPEN'")
      .get(tradeId) as unknown as TradeDbRow | undefined;

    if (!row) {
      return { ok: false, statusCode: 404, message: `Open position #${tradeId} not found.` };
    }

    const safeExit =
      typeof exitPrice === 'number' && Number.isFinite(exitPrice) && exitPrice > 0
        ? exitPrice
        : row.current_price;

    const side = (row.side === 'SELL' ? 'SELL' : 'BUY') as UnifiedOrderSide;
    const rawPnl = computeUnrealizedPnlUsd(side, row.entry_price, safeExit, row.quantity);
    const feeUsd = Number((safeExit * row.quantity * this.risk.takerFeeRate).toFixed(4));
    const netPnlUsd = Number((rawPnl - feeUsd).toFixed(2));

    const st = this.getStateRow();
    const nextEquity = Number(Math.max(0, st.equity_usd + netPnlUsd).toFixed(2));
    const mode = (isAllowedTradingMode(row.trading_mode)
      ? row.trading_mode
      : 'PAPER_DRY_RUN') as UnifiedTradingMode;
    const nextStreak = computeNextPaperWinStreak(st.consecutive_paper_wins, mode, netPnlUsd);
    const nowIso = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE dry_run_trades
         SET status = 'CLOSED', current_price = ?, realized_pnl_usd = ?, close_reason = ?, closed_at = ?
         WHERE trade_id = ?`
      )
      .run(safeExit, netPnlUsd, reason, nowIso, tradeId);

    this.db
      .prepare(
        'UPDATE engine_state SET equity_usd = ?, consecutive_paper_wins = ?, updated_at = ? WHERE id = 1'
      )
      .run(nextEquity, nextStreak, nowIso);

    return {
      ok: true,
      statusCode: 200,
      netPnlUsd,
      message: `Closed #${tradeId} ${row.symbol} (${reason}) Net PnL ${netPnlUsd >= 0 ? '+' : ''}$${netPnlUsd.toFixed(2)} · Paper Streak ${nextStreak}/${this.risk.requiredConsecutivePaperWins}`,
    };
  }

  public applyMarketPriceTick(priceBySymbol: Readonly<Record<string, number>>): readonly string[] {
    const openRows = this.db
      .prepare("SELECT * FROM dry_run_trades WHERE status = 'OPEN'")
      .all() as unknown as TradeDbRow[];

    const events: string[] = [];
    for (const row of openRows) {
      const compactKey = row.symbol.replace('/', '');
      const markPrice = priceBySymbol[row.symbol] ?? priceBySymbol[compactKey];
      if (typeof markPrice !== 'number' || !Number.isFinite(markPrice) || markPrice <= 0) {
        continue;
      }

      const tick = evaluatePositionRiskTick(
        {
          side: row.side === 'SELL' ? 'SELL' : 'BUY',
          entryPrice: row.entry_price,
          stopLoss: row.stop_loss,
          takeProfit: row.take_profit,
          trailingStop: row.trailing_stop,
          peakPrice: row.peak_price,
        },
        markPrice,
        this.risk
      );

      this.db
        .prepare(
          'UPDATE dry_run_trades SET current_price = ?, peak_price = ?, trailing_stop = ? WHERE trade_id = ?'
        )
        .run(markPrice, tick.nextPeakPrice, tick.nextTrailingStop, row.trade_id);

      if (tick.closeReason) {
        const res = this.closePosition(row.trade_id, markPrice, tick.closeReason);
        if (res.ok) events.push(res.message);
      }
    }

    return events;
  }

  public handleTelegramRpcCommand(rawCommand: string): {
    readonly ok: boolean;
    readonly command: string;
    readonly response: string;
  } {
    const beforeMetrics = this.getMetrics();
    const parsed = formatTelegramRpcResponse(rawCommand, beforeMetrics);

    if (parsed.action === 'START') {
      this.db
        .prepare('UPDATE engine_state SET bot_running = 1, updated_at = ? WHERE id = 1')
        .run(new Date().toISOString());
    } else if (parsed.action === 'STOP') {
      this.db
        .prepare('UPDATE engine_state SET bot_running = 0, updated_at = ? WHERE id = 1')
        .run(new Date().toISOString());
    }

    const afterMetrics = this.getMetrics();
    const finalParsed =
      parsed.action === 'START' || parsed.action === 'STOP'
        ? formatTelegramRpcResponse(rawCommand, afterMetrics)
        : parsed;

    const nowIso = new Date().toISOString();
    const id = `rpc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.db
      .prepare(
        `INSERT INTO telegram_rpc_logs (id, timestamp_iso, command, response, trading_mode)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, nowIso, finalParsed.command, finalParsed.response, afterMetrics.tradingMode);

    return {
      ok: finalParsed.recognized,
      command: finalParsed.command,
      response: finalParsed.response,
    };
  }

  public recordSystemAudit(latencyMs = 9.5): SystemAuditLogEntry {
    const metrics = this.getMetrics();
    const st = this.getStateRow();
    const memMb = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1));
    const load1m = os.loadavg()[0] ?? 0.25;
    const cpuCount = Math.max(1, os.cpus().length);
    const cpuPct = Number(Math.min(100, Math.max(1.2, (load1m / cpuCount) * 100)).toFixed(1));
    const safeLatency = Number(Math.max(0.5, latencyMs).toFixed(1));
    const formattedMessage = formatSystemAuditMessage({
      tradingMode: metrics.tradingMode,
      cpuPct,
      memoryMb: memMb,
      latencyMs: safeLatency,
      executionErrors: st.execution_errors,
      portfolioValueUsd: metrics.portfolioValueUsd,
      dailyDrawdownPct: metrics.dailyDrawdownPct,
    });

    const entry: SystemAuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestampIso: new Date().toISOString(),
      tradingMode: metrics.tradingMode,
      cpuPct,
      memoryMb: memMb,
      latencyMs: safeLatency,
      executionErrors: st.execution_errors,
      portfolioValueUsd: metrics.portfolioValueUsd,
      dailyDrawdownPct: metrics.dailyDrawdownPct,
      formattedMessage,
      channelStatus: 'LOCAL_AUDIT_RING',
    };

    this.db
      .prepare(
        `INSERT INTO system_audit_logs (
          id, timestamp_iso, trading_mode, cpu_pct, memory_mb, latency_ms,
          execution_errors, portfolio_value_usd, daily_drawdown_pct,
          formatted_message, channel_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.timestampIso,
        entry.tradingMode,
        entry.cpuPct,
        entry.memoryMb,
        entry.latencyMs,
        entry.executionErrors,
        entry.portfolioValueUsd,
        entry.dailyDrawdownPct,
        entry.formattedMessage,
        entry.channelStatus
      );

    return entry;
  }

  public readAllowlistedCoreSource(moduleId: string): {
    readonly ok: boolean;
    readonly statusCode: number;
    readonly moduleId: string;
    readonly relativePath: string;
    readonly content?: string;
    readonly error?: string;
  } {
    const match = ALLOWLISTED_CORE_SOURCE_MODULES.find((m) => m.id === moduleId);
    if (!match) {
      return {
        ok: false,
        statusCode: 400,
        moduleId,
        relativePath: '',
        error: 'Invalid or non-allowlisted core module identifier.',
      };
    }

    const baseDir = path.resolve(this.rootDir, 'signal_forge_core');
    const resolved = path.resolve(this.rootDir, match.relativePath);
    if (!resolved.startsWith(baseDir + path.sep)) {
      return {
        ok: false,
        statusCode: 400,
        moduleId,
        relativePath: '',
        error: 'Path confinement violation blocked.',
      };
    }

    try {
      const content = fs.readFileSync(resolved, 'utf8');
      return {
        ok: true,
        statusCode: 200,
        moduleId: match.id,
        relativePath: match.relativePath,
        content,
      };
    } catch {
      return {
        ok: false,
        statusCode: 404,
        moduleId: match.id,
        relativePath: match.relativePath,
        error: 'Core module file not found.',
      };
    }
  }

  private incrementExecutionErrors(): void {
    this.db
      .prepare('UPDATE engine_state SET execution_errors = execution_errors + 1, updated_at = ? WHERE id = 1')
      .run(new Date().toISOString());
  }
}

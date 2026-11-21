"""
Signal Forge — Localized SQLite Dry-Run Paper Trading & Risk Engine.

Implements Freqtrade-grade trade lifecycle persistence in SQLite with:
  1. Hard-coded Automated Stop-Loss, Take-Profit, and Ratcheting Trailing Stops.
  2. Mandatory 8.0% Maximum Daily Drawdown Circuit Breaker.
  3. Live Deployment Validation Gate requiring >= 50 consecutive profitable
     paper trades before live trading can be unlocked.
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Literal, Optional, Tuple

from signal_forge_core.exchange.ccxt_router import (
    StandardizedSignal,
    TradingMode,
    UnifiedCCXTRouter,
)


@dataclass(frozen=True)
class HardRiskConfig:
    """Immutable, hard-coded prop-grade risk parameters."""

    stop_loss_pct: float = 0.02            # 2.0% hard stop-loss
    take_profit_pct: float = 0.06          # 6.0% automated take-profit (1:3 R:R floor)
    trailing_activation_pct: float = 0.015 # Arm trailing stop at +1.5% profit
    trailing_offset_pct: float = 0.008     # Trail 0.8% behind peak favorable price
    max_daily_drawdown_pct: float = 0.08   # 8.0% mandatory daily drawdown cap
    max_open_trades: int = 5
    required_consecutive_wins_for_live: int = 50


@dataclass
class PaperPosition:
    trade_id: int
    exchange: str
    symbol: str
    market_type: str
    trading_mode: str
    side: str
    entry_price: float
    current_price: float
    quantity: float
    stake_usd: float
    stop_loss: float
    take_profit: float
    trailing_stop: Optional[float]
    peak_price: float
    status: Literal["OPEN", "CLOSED"]
    realized_pnl_usd: float
    close_reason: str
    opened_at: str
    closed_at: Optional[str]


class SQLiteDryRunEngine:
    """
    Localized SQLite Dry-Run engine enforcing parameterized SQL queries,
    automated SL/TP/Trailing exits, 8% daily drawdown protection, and the
    50-consecutive-profitable-paper-trades Live Gate.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        initial_equity_usd: float = 10_000.0,
        risk_config: Optional[HardRiskConfig] = None,
    ) -> None:
        self.db_path = db_path
        self.risk = risk_config or HardRiskConfig()
        self.initial_equity_usd = initial_equity_usd
        self.trading_mode: TradingMode = "PAPER_DRY_RUN"
        self.bot_running: bool = True
        self._mem_conn: Optional[sqlite3.Connection] = (
            sqlite3.connect(":memory:") if db_path == ":memory:" else None
        )
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = self._mem_conn if self._mem_conn is not None else sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _close_if_file(self, conn: sqlite3.Connection) -> None:
        if self._mem_conn is None:
            conn.close()

    def _init_schema(self) -> None:
        conn = self._connect()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS engine_state (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    trading_mode TEXT NOT NULL,
                    equity_usd REAL NOT NULL,
                    day_start_equity_usd REAL NOT NULL,
                    consecutive_paper_wins INTEGER NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS dry_run_trades (
                    trade_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    exchange TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    market_type TEXT NOT NULL,
                    trading_mode TEXT NOT NULL,
                    side TEXT NOT NULL,
                    entry_price REAL NOT NULL,
                    current_price REAL NOT NULL,
                    quantity REAL NOT NULL,
                    stake_usd REAL NOT NULL,
                    stop_loss REAL NOT NULL,
                    take_profit REAL NOT NULL,
                    trailing_stop REAL,
                    peak_price REAL NOT NULL,
                    status TEXT NOT NULL,
                    realized_pnl_usd REAL NOT NULL DEFAULT 0.0,
                    close_reason TEXT NOT NULL DEFAULT '',
                    opened_at TEXT NOT NULL,
                    closed_at TEXT
                )
                """
            )
            now_iso = datetime.now(timezone.utc).isoformat()
            conn.execute(
                """
                INSERT OR IGNORE INTO engine_state
                    (id, trading_mode, equity_usd, day_start_equity_usd, consecutive_paper_wins, updated_at)
                VALUES (1, ?, ?, ?, 0, ?)
                """,
                ("PAPER_DRY_RUN", self.initial_equity_usd, self.initial_equity_usd, now_iso),
            )
            conn.commit()
        finally:
            self._close_if_file(conn)

    def get_state_summary(self) -> Dict[str, object]:
        conn = self._connect()
        try:
            row = conn.execute("SELECT * FROM engine_state WHERE id = 1").fetchone()
            open_rows = conn.execute(
                "SELECT * FROM dry_run_trades WHERE status = 'OPEN' ORDER BY trade_id DESC"
            ).fetchall()
            closed_rows = conn.execute(
                "SELECT * FROM dry_run_trades WHERE status = 'CLOSED' ORDER BY trade_id DESC LIMIT 50"
            ).fetchall()
            equity = float(row["equity_usd"])
            day_start = float(row["day_start_equity_usd"])
            unrealized = sum(
                (float(r["current_price"]) - float(r["entry_price"])) * float(r["quantity"])
                if r["side"] == "BUY"
                else (float(r["entry_price"]) - float(r["current_price"])) * float(r["quantity"])
                for r in open_rows
            )
            total_value = equity + unrealized
            daily_dd_pct = max(0.0, (day_start - total_value) / max(1.0, day_start))
            wins_streak = int(row["consecutive_paper_wins"])
            return {
                "trading_mode": row["trading_mode"],
                "bot_running": self.bot_running,
                "equity_usd": round(equity, 2),
                "portfolio_value_usd": round(total_value, 2),
                "unrealized_pnl_usd": round(unrealized, 2),
                "daily_drawdown_pct": round(daily_dd_pct, 4),
                "max_daily_drawdown_pct": self.risk.max_daily_drawdown_pct,
                "drawdown_halted": daily_dd_pct >= self.risk.max_daily_drawdown_pct,
                "consecutive_paper_wins": wins_streak,
                "required_paper_wins": self.risk.required_consecutive_wins_for_live,
                "live_gate_unlocked": wins_streak >= self.risk.required_consecutive_wins_for_live,
                "open_positions_count": len(open_rows),
                "closed_trades_count": len(closed_rows),
            }
        finally:
            self._close_if_file(conn)

    def set_trading_mode(self, target_mode: TradingMode) -> Tuple[bool, str]:
        """Enforce mandatory 50-consecutive-profitable-paper-trades Live Gate."""
        summary = self.get_state_summary()
        if target_mode == "LIVE" and not summary["live_gate_unlocked"]:
            streak = summary["consecutive_paper_wins"]
            req = self.risk.required_consecutive_wins_for_live
            return (
                False,
                f"LIVE_GATE_LOCKED: {streak}/{req} consecutive profitable paper trades completed.",
            )

        conn = self._connect()
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            conn.execute(
                "UPDATE engine_state SET trading_mode = ?, updated_at = ? WHERE id = 1",
                (target_mode, now_iso),
            )
            conn.commit()
            self.trading_mode = target_mode
            return True, f"Trading mode switched to {target_mode}."
        finally:
            self._close_if_file(conn)

    def open_position_from_signal(
        self,
        router: UnifiedCCXTRouter,
        signal: StandardizedSignal,
    ) -> Tuple[bool, str, Optional[int]]:
        """Route AI signal through CCXT router after enforcing 8% daily drawdown cap."""
        if not self.bot_running:
            return False, "BOT_STOPPED: Send /start via Telegram RPC to resume execution.", None

        summary = self.get_state_summary()
        if summary["drawdown_halted"]:
            return (
                False,
                f"DAILY_DRAWDOWN_CAP_HIT: Active drawdown {float(summary['daily_drawdown_pct']) * 100:.2f}% >= 8.00% cap.",
                None,
            )
        if int(summary["open_positions_count"]) >= self.risk.max_open_trades:
            return False, f"MAX_OPEN_TRADES_REACHED ({self.risk.max_open_trades}).", None

        receipt = router.execute_signal(signal, trading_mode=self.trading_mode)
        if receipt.status != "FILLED":
            return False, receipt.reason, None

        entry = receipt.filled_price
        if signal.side == "BUY":
            stop_loss = round(entry * (1.0 - self.risk.stop_loss_pct), 6)
            take_profit = round(entry * (1.0 + self.risk.take_profit_pct), 6)
        else:
            stop_loss = round(entry * (1.0 + self.risk.stop_loss_pct), 6)
            take_profit = round(entry * (1.0 - self.risk.take_profit_pct), 6)

        now_iso = datetime.now(timezone.utc).isoformat()
        conn = self._connect()
        try:
            cur = conn.execute(
                """
                INSERT INTO dry_run_trades (
                    exchange, symbol, market_type, trading_mode, side,
                    entry_price, current_price, quantity, stake_usd,
                    stop_loss, take_profit, trailing_stop, peak_price,
                    status, realized_pnl_usd, close_reason, opened_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'OPEN', 0.0, '', ?)
                """,
                (
                    receipt.exchange,
                    receipt.symbol,
                    receipt.market_type,
                    receipt.trading_mode,
                    receipt.side,
                    entry,
                    entry,
                    receipt.quantity,
                    signal.stake_usd,
                    stop_loss,
                    take_profit,
                    entry,
                    now_iso,
                ),
            )
            conn.commit()
            return True, f"Opened {receipt.side} {receipt.symbol} @ {entry} ({receipt.trading_mode})", int(cur.lastrowid)
        finally:
            self._close_if_file(conn)

    def evaluate_market_price(self, symbol: str, mark_price: float) -> List[str]:
        """Update mark prices, ratchet trailing stops, and auto-close on SL/TP/Trailing breach."""
        events: List[str] = []
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM dry_run_trades WHERE status = 'OPEN' AND symbol = ?",
                (symbol,),
            ).fetchall()
            for r in rows:
                trade_id = int(r["trade_id"])
                side = str(r["side"])
                entry = float(r["entry_price"])
                sl = float(r["stop_loss"])
                tp = float(r["take_profit"])
                peak = float(r["peak_price"])
                trail = float(r["trailing_stop"]) if r["trailing_stop"] is not None else None

                close_reason = ""
                if side == "BUY":
                    peak = max(peak, mark_price)
                    gain_pct = (peak - entry) / entry
                    if gain_pct >= self.risk.trailing_activation_pct:
                        cand_trail = round(peak * (1.0 - self.risk.trailing_offset_pct), 6)
                        trail = max(trail, cand_trail) if trail is not None else cand_trail
                    if mark_price >= tp:
                        close_reason = "TAKE_PROFIT"
                    elif trail is not None and mark_price <= trail:
                        close_reason = "TRAILING_STOP"
                    elif mark_price <= sl:
                        close_reason = "STOP_LOSS"
                else:
                    peak = min(peak, mark_price)
                    gain_pct = (entry - peak) / entry
                    if gain_pct >= self.risk.trailing_activation_pct:
                        cand_trail = round(peak * (1.0 + self.risk.trailing_offset_pct), 6)
                        trail = min(trail, cand_trail) if trail is not None else cand_trail
                    if mark_price <= tp:
                        close_reason = "TAKE_PROFIT"
                    elif trail is not None and mark_price >= trail:
                        close_reason = "TRAILING_STOP"
                    elif mark_price >= sl:
                        close_reason = "STOP_LOSS"

                conn.execute(
                    "UPDATE dry_run_trades SET current_price = ?, peak_price = ?, trailing_stop = ? WHERE trade_id = ?",
                    (mark_price, peak, trail, trade_id),
                )
                conn.commit()
                if close_reason:
                    ok, msg = self.close_position(trade_id, mark_price, close_reason)
                    if ok:
                        events.append(msg)
        finally:
            self._close_if_file(conn)
        return events

    def close_position(
        self, trade_id: int, exit_price: float, reason: str = "MANUAL_EXIT"
    ) -> Tuple[bool, str]:
        """Close an open trade, realize PnL into SQLite equity, and update the 50-win streak."""
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM dry_run_trades WHERE trade_id = ? AND status = 'OPEN'",
                (trade_id,),
            ).fetchone()
            if row is None:
                return False, f"Open trade #{trade_id} not found."

            entry = float(row["entry_price"])
            qty = float(row["quantity"])
            side = str(row["side"])
            mode = str(row["trading_mode"])
            raw_pnl = (exit_price - entry) * qty if side == "BUY" else (entry - exit_price) * qty
            fee = round(exit_price * qty * UnifiedCCXTRouter.MAKER_TAKER_FEE_RATE, 4)
            net_pnl = round(raw_pnl - fee, 2)

            state = conn.execute("SELECT * FROM engine_state WHERE id = 1").fetchone()
            new_equity = round(float(state["equity_usd"]) + net_pnl, 2)
            prev_streak = int(state["consecutive_paper_wins"])
            if mode == "PAPER_DRY_RUN":
                new_streak = prev_streak + 1 if net_pnl > 0 else 0
            else:
                new_streak = prev_streak

            now_iso = datetime.now(timezone.utc).isoformat()
            conn.execute(
                """
                UPDATE dry_run_trades
                SET status = 'CLOSED', current_price = ?, realized_pnl_usd = ?,
                    close_reason = ?, closed_at = ?
                WHERE trade_id = ?
                """,
                (exit_price, net_pnl, reason, now_iso, trade_id),
            )
            conn.execute(
                """
                UPDATE engine_state
                SET equity_usd = ?, consecutive_paper_wins = ?, updated_at = ?
                WHERE id = 1
                """,
                (new_equity, new_streak, now_iso),
            )
            conn.commit()
            return (
                True,
                f"Closed #{trade_id} {row['symbol']} ({reason}) Net PnL ${net_pnl:+.2f} · Paper Win Streak {new_streak}/{self.risk.required_consecutive_wins_for_live}",
            )
        finally:
            self._close_if_file(conn)

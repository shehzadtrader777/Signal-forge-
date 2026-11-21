"""
Signal Forge — Automated Telegram RPC Handler & Real-Time System Audit Logger.

Supports Freqtrade-style operational commands:
  /start  - Resume automated AI signal execution
  /stop   - Pause automated signal entries while preserving protective exits
  /status - Live portfolio value, active drawdown, mode, and 50-win gate status
  /profit - Closed trade PnL summary and consecutive profitable paper streak

Also generates formatted real-time System Audit Logs (CPU, Memory, Latency,
Execution Errors) and dispatches via Telegram Bot API using environment secrets.
"""
from __future__ import annotations

import json
import os
import resource
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List

from signal_forge_core.engine.dry_run_engine import SQLiteDryRunEngine


@dataclass(frozen=True)
class SystemAuditSnapshot:
    timestamp_iso: str
    cpu_pct: float
    memory_mb: float
    latency_ms: float
    execution_errors: int
    trading_mode: str
    portfolio_value_usd: float
    daily_drawdown_pct: float


class TelegramRPCHandler:
    """Standardized Telegram RPC command & audit dispatcher."""

    ALLOWED_COMMANDS = ("/start", "/stop", "/status", "/profit")

    def __init__(self, engine: SQLiteDryRunEngine) -> None:
        self.engine = engine
        self.execution_errors: int = 0
        self.audit_history: List[SystemAuditSnapshot] = []

    def handle_command(self, raw_command: str) -> str:
        cmd = raw_command.strip().lower().split(" ")[0]
        if cmd not in self.ALLOWED_COMMANDS:
            return f"Unknown command '{cmd}'. Supported: {', '.join(self.ALLOWED_COMMANDS)}"

        if cmd == "/start":
            self.engine.bot_running = True
            return "Signal Forge RPC: Bot execution STARTED. Standardized CCXT gateway active."

        if cmd == "/stop":
            self.engine.bot_running = False
            return "Signal Forge RPC: Bot execution STOPPED. New entries halted; SL/TP monitors active."

        summary = self.engine.get_state_summary()
        if cmd == "/status":
            gate = (
                "UNLOCKED"
                if summary["live_gate_unlocked"]
                else f"LOCKED ({summary['consecutive_paper_wins']}/{summary['required_paper_wins']})"
            )
            return (
                f"Signal Forge Status [{summary['trading_mode']}]\n"
                f"Bot: {'RUNNING' if summary['bot_running'] else 'STOPPED'}\n"
                f"Portfolio: ${float(summary['portfolio_value_usd']):,.2f} "
                f"(Unrealized ${float(summary['unrealized_pnl_usd']):+,.2f})\n"
                f"Daily Drawdown: {float(summary['daily_drawdown_pct']) * 100:.2f}% / "
                f"{float(summary['max_daily_drawdown_pct']) * 100:.1f}% Cap\n"
                f"Open Positions: {summary['open_positions_count']} | Live Gate: {gate}"
            )

        # /profit
        return (
            f"Signal Forge Profit Report [{summary['trading_mode']}]\n"
            f"Realized Equity: ${float(summary['equity_usd']):,.2f}\n"
            f"Closed Trades: {summary['closed_trades_count']}\n"
            f"Consecutive Profitable Paper Streak: "
            f"{summary['consecutive_paper_wins']}/{summary['required_paper_wins']}"
        )

    def collect_system_audit(self, latency_ms: float = 12.4) -> SystemAuditSnapshot:
        usage = resource.getrusage(resource.RUSAGE_SELF)
        mem_mb = round(usage.ru_maxrss / 1024.0, 2)
        cpu_pct = round(min(100.0, (usage.ru_utime + usage.ru_stime) * 10.0), 2)
        summary = self.engine.get_state_summary()
        snap = SystemAuditSnapshot(
            timestamp_iso=datetime.now(timezone.utc).isoformat(),
            cpu_pct=cpu_pct,
            memory_mb=mem_mb,
            latency_ms=round(latency_ms, 2),
            execution_errors=self.execution_errors,
            trading_mode=str(summary["trading_mode"]),
            portfolio_value_usd=float(summary["portfolio_value_usd"]),
            daily_drawdown_pct=float(summary["daily_drawdown_pct"]),
        )
        self.audit_history.insert(0, snap)
        self.audit_history = self.audit_history[:50]
        return snap

    def format_audit_report(self, snap: SystemAuditSnapshot) -> str:
        return (
            f"[SYSTEM AUDIT · {snap.trading_mode}]\n"
            f"CPU: {snap.cpu_pct:.1f}% | Memory: {snap.memory_mb:.1f} MB | "
            f"Latency: {snap.latency_ms:.1f} ms\n"
            f"Execution Errors: {snap.execution_errors} | "
            f"Drawdown: {snap.daily_drawdown_pct * 100:.2f}% / 8.00%\n"
            f"Portfolio Value: ${snap.portfolio_value_usd:,.2f}"
        )

    def dispatch_to_telegram(self, text: str) -> Dict[str, object]:
        """Optional outbound Telegram Bot API dispatch strictly via env secrets."""
        token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        chat_id = os.getenv("TELEGRAM_AUDIT_CHAT_ID", "").strip()
        if not token or not chat_id:
            return {"delivered": False, "mode": "LOCAL_LOG_ONLY", "preview": text}

        t0 = time.perf_counter()
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = json.dumps({"chat_id": chat_id, "text": text}).encode("utf-8")
        req = urllib.request.Request(
            url, data=payload, headers={"Content-Type": "application/json"}, method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return {
                    "delivered": resp.status == 200,
                    "mode": "TELEGRAM_API",
                    "latency_ms": round((time.perf_counter() - t0) * 1000.0, 2),
                }
        except Exception as exc:
            self.execution_errors += 1
            return {"delivered": False, "mode": "ERROR", "error": str(exc)}

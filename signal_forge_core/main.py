#!/usr/bin/env python3
"""
Signal Forge — Unified Freqtrade-Style Trading Bot Entrypoint.

Connects:
  - UnifiedCCXTRouter (Spot & Futures: Binance, Bybit, OKX, Kraken)
  - SQLiteDryRunEngine (Hard SL/TP/Trailing Stops, 8% Daily DD Cap, 50-Win Live Gate)
  - TelegramRPCHandler (/start, /stop, /status, /profit + System Audit Logs)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from signal_forge_core.engine.dry_run_engine import HardRiskConfig, SQLiteDryRunEngine
from signal_forge_core.exchange.ccxt_router import StandardizedSignal, UnifiedCCXTRouter
from signal_forge_core.rpc.telegram_rpc import TelegramRPCHandler


def run_verification_cycle() -> None:
    """Execute a deterministic end-to-end verification of the unified architecture."""
    router = UnifiedCCXTRouter(
        exchange_id="binance", market_type="SPOT", trading_mode="PAPER_DRY_RUN"
    )
    engine = SQLiteDryRunEngine(
        db_path=":memory:",
        initial_equity_usd=10_000.0,
        risk_config=HardRiskConfig(),
    )
    rpc = TelegramRPCHandler(engine)

    # 1. Confirm Live Gate refuses deployment before 50 consecutive paper wins
    live_ok, live_msg = engine.set_trading_mode("LIVE")
    assert not live_ok and "LIVE_GATE_LOCKED" in live_msg, live_msg

    # 2. Route an AI signal through CCXT unified layer into SQLite Dry-Run
    sig = StandardizedSignal(
        signal_id="ai-sig-001",
        exchange="binance",
        symbol="BTC/USDT",
        market_type="SPOT",
        side="BUY",
        entry_price=91_400.0,
        stake_usd=1_500.0,
        confidence_pct=88.5,
    )
    opened, open_msg, trade_id = engine.open_position_from_signal(router, sig)
    assert opened and trade_id is not None, open_msg

    # 3. Advance price to arm trailing stop (+2.5%), then trigger take-profit (+6.5%)
    engine.evaluate_market_price("BTC/USDT", 93_700.0)
    close_events = engine.evaluate_market_price("BTC/USDT", 97_400.0)
    assert len(close_events) == 1, f"Expected TAKE_PROFIT close, got {close_events}"

    # 4. Execute Telegram RPC commands & System Audit
    status_text = rpc.handle_command("/status")
    profit_text = rpc.handle_command("/profit")
    audit_snap = rpc.collect_system_audit(latency_ms=8.2)
    audit_report = rpc.format_audit_report(audit_snap)

    print(
        json.dumps(
            {
                "live_gate_check": live_msg,
                "open_msg": open_msg,
                "close_events": close_events,
                "rpc_status": status_text,
                "rpc_profit": profit_text,
                "system_audit": audit_report,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    run_verification_cycle()

"""End-to-end verification runner for Signal Forge Hybrid 6-Phase Core."""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import asdict

from hybrid_core.python_control_plane.agent_orchestrator import MultiAgentOrchestrator
from hybrid_core.python_control_plane.ipc_bridge import RustIpcBridge
from hybrid_core.python_control_plane.mmap_backtester import (
    run_mmap_vectorized_backtest,
    write_mmap_tick_dataset,
)
from hybrid_core.python_control_plane.validation_and_risk import (
    StrategyTrackingDatabase,
    optimize_dynamic_risk,
    run_paper_validation_chamber,
)


def run_self_test() -> dict:
    # Phase 1: Python <-> Rust IPC Bridge handshake
    ipc = RustIpcBridge()
    ipc_ping = ipc.dispatch({"op": "PING", "seq": 1, "sent_ns": 1})

    # Phase 2: Multi-Agent Horizontal Clone Autoscaling
    orchestrator = MultiAgentOrchestrator(base_clones_per_node=64)
    scale_plan = orchestrator.compute_scale_plan(
        market_volatility_pct=34.5,
        compute_nodes=8,
        stream_partitions=["BINANCE:BTCUSDT", "OANDA:EURUSD", "IBKR:NVDA"],
    )

    # Phase 3 & 6: Memory-mapped binary tick simulation with historical date range
    with tempfile.TemporaryDirectory(prefix="sf_mmap_") as tmpdir:
        mmap_file = os.path.join(tmpdir, "btc_2024.ticks")
        path, adapter = write_mmap_tick_dataset(
            mmap_file,
            asset_class="CRYPTO",
            start_date="2024-01-01",
            end_date="2024-12-31",
            regime="TRENDING_BULL",
            tick_count=6_000,
        )
        backtest = run_mmap_vectorized_backtest(
            path,
            adapter,
            start_date="2024-01-01",
            end_date="2024-12-31",
            regime="TRENDING_BULL",
        )

        # Phase 4: Paper Trading Validation Chamber
        chamber = run_paper_validation_chamber(backtest, live_volatility_pct=34.5)

        # Phase 5: Dynamic Risk Parameter Optimization
        risk = optimize_dynamic_risk(chamber, backtest.sharpe_ratio, live_volatility_pct=34.5)

        # Phase 6: SQLite Strategy Tracking Database
        db = StrategyTrackingDatabase(":memory:")
        db.record_strategy_run("SF-HYB-SELFTEST-001", backtest, chamber, risk)
        tracked = db.list_strategies(limit=5)
        db.close()

    return {
        "phase1_ipc": asdict(ipc_ping),
        "phase2_clones": scale_plan.total_active_clones,
        "phase3_ticks": backtest.ticks_processed,
        "phase3_ns_per_tick": backtest.ns_per_tick,
        "phase4_chamber_promoted": chamber.promoted,
        "phase5_optimized_position_pct": risk.optimized_position_size_pct,
        "phase6_tracked_rows": len(tracked),
    }


if __name__ == "__main__":
    summary = run_self_test()
    print(json.dumps(summary, indent=2))

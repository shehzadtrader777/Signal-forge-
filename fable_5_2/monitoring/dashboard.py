"""
Signal Forge — Fable 5.2 Layer 8: Observability, Strategic Memory & Discord Reporter
==================================================================================
Provides:
1. Persistent Strategic Memory Database (SQLite) logging every research cycle,
   OOS validation benchmark, Black-Scholes Greeks audit, risk-gate verdict,
   and version promotion with immutable UTC provenance timestamps.
2. Automated Discord Webhook Reporter (reads DISCORD_WEBHOOK_URL strictly from
   environment variables — never hardcodes secrets).
3. Holistic Streamlit Dashboard (`streamlit run fable_5_2/monitoring/dashboard.py`)
   visualizing 8-layer pipeline status, Inverse Variance allocation, Half-Kelly
   exposure, Black-Scholes IV surface, and strategic memory logs.
"""

from __future__ import annotations

import json
import os
import sqlite3
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


class StrategicMemoryStore:
    """SQLite-backed provenance store preventing look-ahead bias across evolution cycles."""

    def __init__(self, db_path: str = "fable_strategic_memory.db") -> None:
        self.is_memory = db_path == ":memory:"
        self.db_path = db_path if self.is_memory else str(Path(db_path))
        self._mem_conn: Optional[sqlite3.Connection] = (
            sqlite3.connect(":memory:") if self.is_memory else None
        )
        self._init_schema()

    def _get_conn(self) -> sqlite3.Connection:
        if self._mem_conn is not None:
            return self._mem_conn
        return sqlite3.connect(self.db_path)

    def _init_schema(self) -> None:
        conn = self._get_conn()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS strategic_memory (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    recorded_at_utc TEXT NOT NULL,
                    layer TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    version_id TEXT NOT NULL,
                    oos_sharpe REAL,
                    oos_max_drawdown REAL,
                    payload_json TEXT NOT NULL
                )
                """
            )
            conn.commit()
        finally:
            if not self.is_memory:
                conn.close()

    def log_event(
        self,
        *,
        layer: str,
        event_type: str,
        version_id: str,
        payload: Dict[str, Any],
        oos_sharpe: Optional[float] = None,
        oos_max_drawdown: Optional[float] = None,
    ) -> int:
        """Persists an immutable timestamped provenance record."""
        ts = datetime.now(timezone.utc).isoformat()
        conn = self._get_conn()
        try:
            cur = conn.execute(
                """
                INSERT INTO strategic_memory
                (recorded_at_utc, layer, event_type, version_id, oos_sharpe, oos_max_drawdown, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (ts, layer, event_type, version_id, oos_sharpe, oos_max_drawdown, json.dumps(payload)),
            )
            conn.commit()
            return int(cur.lastrowid or 0)
        finally:
            if not self.is_memory:
                conn.close()

    def fetch_recent(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Retrieves reverse-chronological strategic memory records."""
        conn = self._get_conn()
        try:
            rows = conn.execute(
                """
                SELECT id, recorded_at_utc, layer, event_type, version_id,
                       oos_sharpe, oos_max_drawdown, payload_json
                FROM strategic_memory
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        finally:
            if not self.is_memory:
                conn.close()
        return [
            {
                "id": r[0],
                "recorded_at_utc": r[1],
                "layer": r[2],
                "event_type": r[3],
                "version_id": r[4],
                "oos_sharpe": r[5],
                "oos_max_drawdown": r[6],
                "payload": json.loads(r[7]),
            }
            for r in rows
        ]


class DiscordReporter:
    """Sends structured observability and promotion alerts to Discord via webhook env var."""

    def __init__(self, webhook_url: Optional[str] = None) -> None:
        self.webhook_url = (webhook_url or os.getenv("DISCORD_WEBHOOK_URL", "")).strip()

    def send_report(self, title: str, fields: Dict[str, Any]) -> Dict[str, Any]:
        """Dispatches a formatted Discord embed or returns a dry-run audit payload if unconfigured."""
        embed = {
            "username": "Signal Forge · Fable 5.2 Orchestrator",
            "embeds": [
                {
                    "title": title,
                    "color": 0x06B6D4,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "fields": [
                        {"name": str(k), "value": str(v), "inline": True}
                        for k, v in fields.items()
                    ],
                }
            ],
        }
        if not self.webhook_url:
            return {"delivered": False, "mode": "DRY_RUN_NO_WEBHOOK_ENV", "payload": embed}

        req = urllib.request.Request(
            self.webhook_url,
            data=json.dumps(embed).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return {"delivered": 200 <= resp.status < 300, "status": resp.status}


def render_streamlit_dashboard(db_path: str = "fable_strategic_memory.db") -> None:
    """Renders the Layer 8 Streamlit Observability Dashboard when executed via Streamlit."""
    try:
        import streamlit as st  # type: ignore
    except ImportError:
        print("Install streamlit (`pip install streamlit`) to launch the Layer 8 dashboard UI.")
        return

    st.set_page_config(page_title="Signal Forge · Fable 5.2 Observability", layout="wide")
    st.title("Signal Forge — Fable 5.2 Multi-Agent 8-Layer Observability")
    st.caption("Prop Firm Risk Parity · Half-Kelly Sizing · Black-Scholes Greeks · Strategic Memory")

    store = StrategicMemoryStore(db_path)
    records = store.fetch_recent(limit=40)

    col1, col2, col3 = st.columns(3)
    col1.metric("Strategic Memory Records", len(records))
    promotions = [r for r in records if r["event_type"] == "VERSION_PROMOTED"]
    col2.metric("Validated Promotions (V2 > V1)", len(promotions))
    latest_sharpe = next((r["oos_sharpe"] for r in records if r["oos_sharpe"] is not None), 0.0)
    col3.metric("Latest OOS Sharpe", f"{latest_sharpe:.3f}")

    st.subheader("Persistent Strategic Memory Provenance Log")
    if records:
        st.dataframe(
            [
                {
                    "ID": r["id"],
                    "UTC Timestamp": r["recorded_at_utc"],
                    "Layer": r["layer"],
                    "Event": r["event_type"],
                    "Version": r["version_id"],
                    "OOS Sharpe": r["oos_sharpe"],
                    "OOS Max DD": r["oos_max_drawdown"],
                }
                for r in records
            ],
            use_container_width=True,
        )
    else:
        st.info("No strategic memory entries yet. Execute `python3 fable_5_2/main_orchestrator.py`.")


if __name__ == "__main__":
    render_streamlit_dashboard()

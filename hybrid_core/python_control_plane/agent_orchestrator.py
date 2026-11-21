"""Phase 2: Multi-Agent Orchestration & Unbounded Horizontal Clone Scaling.

Central coordination engine that dynamically spawns autonomous AI worker clones
based on live market volatility and available compute capacity to run parallel
stream validations across independent strategy families.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List


STRATEGY_FAMILIES = ("BREAKOUT_MOMENTUM", "MEAN_REVERSION", "ORDERBOOK_IMBALANCE", "STAT_ARB")


@dataclass(frozen=True)
class WorkerCloneSpec:
    clone_id: str
    strategy_family: str
    stream_partition: str
    asset_class: str
    fast_window: int
    slow_window: int
    assigned_node: int


@dataclass(frozen=True)
class HorizontalScalePlan:
    market_volatility_pct: float
    compute_nodes: int
    clones_per_node: int
    total_active_clones: int
    estimated_throughput_evals_per_sec: int
    sample_clones: List[WorkerCloneSpec]
    family_distribution: Dict[str, int]


class MultiAgentOrchestrator:
    """Dynamically provisions autonomous AI worker clones with unbounded horizontal scaling."""

    def __init__(self, base_clones_per_node: int = 32) -> None:
        self.base_clones_per_node = max(4, base_clones_per_node)

    def compute_scale_plan(
        self,
        market_volatility_pct: float,
        compute_nodes: int,
        stream_partitions: List[str],
    ) -> HorizontalScalePlan:
        vol = max(0.25, min(100.0, float(market_volatility_pct)))
        nodes = max(1, int(compute_nodes))
        volatility_multiplier = 1.0 + (vol / 12.5) ** 1.35
        clones_per_node = int(math.ceil(self.base_clones_per_node * volatility_multiplier))
        total_clones = nodes * clones_per_node

        partitions = stream_partitions or [
            "BINANCE:BTCUSDT",
            "BYBIT:ETHUSDT",
            "OANDA:EURUSD",
            "IBKR:NVDA",
        ]
        asset_map = {
            "BINANCE": "CRYPTO",
            "BYBIT": "CRYPTO",
            "OKX": "CRYPTO",
            "OANDA": "FOREX",
            "IBKR": "EQUITIES",
        }

        family_counts: Dict[str, int] = {fam: 0 for fam in STRATEGY_FAMILIES}
        base_each = total_clones // len(STRATEGY_FAMILIES)
        remainder = total_clones % len(STRATEGY_FAMILIES)
        for idx, fam in enumerate(STRATEGY_FAMILIES):
            family_counts[fam] = base_each + (1 if idx < remainder else 0)

        sample_clones: List[WorkerCloneSpec] = []
        sample_limit = min(total_clones, 12)
        for i in range(sample_limit):
            family = STRATEGY_FAMILIES[i % len(STRATEGY_FAMILIES)]
            partition = partitions[i % len(partitions)]
            venue = partition.split(":", 1)[0].upper()
            sample_clones.append(
                WorkerCloneSpec(
                    clone_id=f"CLONE-{i + 1:05d}",
                    strategy_family=family,
                    stream_partition=partition,
                    asset_class=asset_map.get(venue, "CRYPTO"),
                    fast_window=6 + (i % 7) * 2,
                    slow_window=24 + (i % 9) * 5,
                    assigned_node=(i % nodes) + 1,
                )
            )

        throughput = total_clones * 185
        return HorizontalScalePlan(
            market_volatility_pct=round(vol, 2),
            compute_nodes=nodes,
            clones_per_node=clones_per_node,
            total_active_clones=total_clones,
            estimated_throughput_evals_per_sec=throughput,
            sample_clones=sample_clones,
            family_distribution=family_counts,
        )

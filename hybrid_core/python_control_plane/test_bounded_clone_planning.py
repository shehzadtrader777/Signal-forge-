"""Safe scale-plan regression tests; no real workers or trading calls."""
import math
import unittest
from hybrid_core.python_control_plane.agent_orchestrator import MultiAgentOrchestrator


class BoundedCloneTests(unittest.TestCase):
    def test_scale_caps_high_volatility(self):
        manager = MultiAgentOrchestrator(base_clones_per_node=64, max_nodes=16, max_clones_per_node=256)
        plan = manager.compute_scale_plan(100.0, 10000, ["BINANCE:BTCUSDT"])
        self.assertEqual(plan.compute_nodes, 16)
        self.assertLessEqual(plan.clones_per_node, 256)
        self.assertLessEqual(plan.total_active_clones, 4096)
        self.assertEqual(sum(plan.family_distribution.values()), plan.total_active_clones)

    def test_rejects_nan_infinity(self):
        manager = MultiAgentOrchestrator()
        for volatility in [math.nan, math.inf, -math.inf]:
            with self.assertRaises(ValueError):
                manager.compute_scale_plan(volatility, 1, [])

    def test_deterministic_bounds(self):
        manager = MultiAgentOrchestrator(base_clones_per_node=32, max_nodes=2, max_clones_per_node=64)
        plan = manager.compute_scale_plan(15, 20, ["BYBIT:ETHUSDT"])
        self.assertGreaterEqual(plan.total_active_clones, 8)
        self.assertLessEqual(plan.total_active_clones, 128)
        self.assertTrue(all(c.assigned_node <= 2 for c in plan.sample_clones))


if __name__ == "__main__":
    unittest.main()

"""Bounded memory allocation tests for the historical tick writer."""
import tempfile
import unittest

from hybrid_core.python_control_plane.mmap_backtester import write_mmap_tick_dataset


class TickAllocationSafetyTests(unittest.TestCase):
    def test_rejects_unbounded_or_malformed_count_before_allocation(self):
        with tempfile.TemporaryDirectory() as folder:
            path = folder + "/ticks.bin"
            for count in (0, -1, 250001, 10**9, 1.25, True, None):
                with self.assertRaises(ValueError):
                    write_mmap_tick_dataset(path, "CRYPTO", "2025-01-01", "2025-01-02", tick_count=count)

    def test_small_valid_batch_has_exact_python_44_byte_frame_size(self):
        with tempfile.TemporaryDirectory() as folder:
            import os
            path = folder + "/ticks.bin"
            write_mmap_tick_dataset(path, "CRYPTO", "2025-01-01", "2025-01-02", tick_count=10)
            self.assertEqual(os.path.getsize(path), 440)


if __name__ == "__main__":
    unittest.main()

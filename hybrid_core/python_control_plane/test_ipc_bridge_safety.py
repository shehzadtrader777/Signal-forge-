"""Regression tests for fail-closed Rust IPC dispatch under daemon failure."""
import os
import socket
import struct
import tempfile
import threading
import unittest

from hybrid_core.python_control_plane.ipc_bridge import RustIpcBridge


class RustIpcSafetyTests(unittest.TestCase):
    def test_missing_rust_engine_never_acknowledges_order(self):
        with tempfile.TemporaryDirectory() as folder:
            bridge = RustIpcBridge(socket_path=os.path.join(folder, "absent.sock"))
            for command in (
                {"op": "ROUTE_ORDER", "symbol": "BTCUSDT", "quantity": 1},
                {"op": "UPDATE_RISK_ENVELOPE", "hard_drawdown_pct": 3},
                {"op": "PING", "seq": 1},
            ):
                result = bridge.dispatch(command)
                self.assertFalse(result.ok)
                self.assertEqual(result.transport, "RUST_IPC_UNAVAILABLE")
                self.assertEqual(result.payload["error"], "RUST_ENGINE_UNAVAILABLE")

    def test_timeout_bounds_are_enforced(self):
        for timeout in (0, -1, float("inf"), 300):
            with self.assertRaises(ValueError):
                RustIpcBridge(timeout_sec=timeout)

    def test_broken_response_does_not_claim_success(self):
        with tempfile.TemporaryDirectory() as folder:
            sock_path = os.path.join(folder, "daemon.sock")
            ready = threading.Event()

            def daemon():
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
                    listener.bind(sock_path)
                    listener.listen(1)
                    ready.set()
                    client, _ = listener.accept()
                    with client:
                        client.recv(4096)
                        client.sendall(struct.pack("!I", 2_000_000))

            thread = threading.Thread(target=daemon, daemon=True)
            thread.start()
            self.assertTrue(ready.wait(timeout=1))
            result = RustIpcBridge(socket_path=sock_path, timeout_sec=0.5).dispatch(
                {"op": "ROUTE_ORDER", "quantity": 1}
            )
            thread.join(timeout=1)
            self.assertFalse(result.ok)
            self.assertEqual(result.transport, "RUST_IPC_UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()

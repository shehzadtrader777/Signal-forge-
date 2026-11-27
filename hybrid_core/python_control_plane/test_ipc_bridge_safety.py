"""Regression tests for fail-closed Rust IPC dispatch under daemon failure."""
import json
import os
import socket
import struct
import tempfile
import threading
import unittest
from unittest.mock import MagicMock, patch

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
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
                listener.bind(sock_path)
                listener.listen(1)
                listener.settimeout(2)

                def daemon():
                    client, _ = listener.accept()
                    with client:
                        client.settimeout(2)
                        client.recv(4096)
                        client.sendall(struct.pack("!I", 2_000_000))

                thread = threading.Thread(target=daemon, daemon=True)
                thread.start()
                result = RustIpcBridge(socket_path=sock_path, timeout_sec=0.5).dispatch(
                    {"op": "ROUTE_ORDER", "quantity": 1}
                )
                thread.join(timeout=2)

            self.assertFalse(thread.is_alive())
            self.assertFalse(result.ok)
            self.assertEqual(result.transport, "RUST_IPC_UNAVAILABLE")
            self.assertEqual(result.payload["cause"], "ValueError")

    def test_malformed_reply_never_acknowledges_order(self):
        malformed_replies = (
            [],
            {"ok": "false", "latency_ns": 10, "payload_json": "{}"},
            {"ok": True, "latency_ns": 10, "payload_json": "[]"},
            {"ok": True, "latency_ns": -1, "payload_json": "{}"},
            {"ok": True, "latency_ns": 10},
        )
        for reply in malformed_replies:
            with self.subTest(reply=reply):
                body = json.dumps(reply).encode("utf-8")
                connection = MagicMock()
                connection.__enter__.return_value.recv.side_effect = [
                    struct.pack("!I", len(body)), body,
                ]
                with (
                    patch("hybrid_core.python_control_plane.ipc_bridge.os.path.exists", return_value=True),
                    patch("hybrid_core.python_control_plane.ipc_bridge.socket.socket", return_value=connection),
                ):
                    result = RustIpcBridge().dispatch({"op": "ROUTE_ORDER"})
                self.assertFalse(result.ok)
                self.assertEqual(result.transport, "RUST_IPC_UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()

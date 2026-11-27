"""Phase 1: Seamless Python <-> Rust IPC Bridge.

Speaks the exact 4-byte big-endian length-prefixed JSON framing protocol
implemented in `rust_engine/src/ipc_ring.rs` over Unix Domain Sockets, with
a deterministic local execution fallback when the Rust daemon socket is offline.
"""

from __future__ import annotations

import json
import os
import socket
import struct
import time
from dataclasses import dataclass
from typing import Any, Dict

MAX_IPC_FRAME_BYTES = 1_048_576


@dataclass(frozen=True)
class IpcDispatchResult:
    ok: bool
    transport: str
    latency_ns: int
    payload: Dict[str, Any]


class RustIpcBridge:
    """Modular Python control-plane IPC client for the Rust execution engine."""

    def __init__(self, socket_path: str | None = None, timeout_sec: float = 0.5) -> None:
        self.socket_path = socket_path or os.environ.get(
            "SIGNAL_FORGE_IPC_SOCKET", "/tmp/signal_forge_hybrid.sock"
        )
        if not (isinstance(timeout_sec, (int, float)) and 0.05 <= timeout_sec <= 30):
            raise ValueError("IPC timeout must be between 0.05 and 30 seconds")
        self.timeout_sec = float(timeout_sec)

    def dispatch(self, command: Dict[str, Any]) -> IpcDispatchResult:
        t0 = time.perf_counter_ns()
        encoded = json.dumps(command, separators=(",", ":")).encode("utf-8")
        if len(encoded) == 0 or len(encoded) > MAX_IPC_FRAME_BYTES:
            raise ValueError(f"IPC frame exceeds {MAX_IPC_FRAME_BYTES} bytes")

        if os.path.exists(self.socket_path):
            try:
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
                    sock.settimeout(self.timeout_sec)
                    sock.connect(self.socket_path)
                    sock.sendall(struct.pack("!I", len(encoded)) + encoded)

                    hdr = self._recv_exact(sock, 4)
                    (reply_len,) = struct.unpack("!I", hdr)
                    if reply_len <= 0 or reply_len > MAX_IPC_FRAME_BYTES:
                        raise ValueError(f"Invalid reply length {reply_len}")
                    raw_reply = self._recv_exact(sock, reply_len)
                    decoded = json.loads(raw_reply.decode("utf-8"))
                    return IpcDispatchResult(
                        ok=bool(decoded.get("ok", False)),
                        transport="RUST_UDS_IPC",
                        latency_ns=int(decoded.get("latency_ns", time.perf_counter_ns() - t0)),
                        payload=json.loads(decoded.get("payload_json", "{}")),
                    )
            except (OSError, ValueError, json.JSONDecodeError, TypeError, KeyError) as exc:
                return self._offline_result(command, t0, type(exc).__name__)

        return self._offline_result(command, t0, "SOCKET_UNAVAILABLE")

    @staticmethod
    def _offline_result(command: Dict[str, Any], start_ns: int, cause: str) -> IpcDispatchResult:
        # A disconnected execution daemon is NEVER a successful order or risk update.
        # Ping and research calls also report unavailable rather than fake healthy Rust telemetry.
        return IpcDispatchResult(
            ok=False,
            transport="RUST_IPC_UNAVAILABLE",
            latency_ns=max(1, time.perf_counter_ns() - start_ns),
            payload={"op": str(command.get("op", "UNKNOWN")), "error": "RUST_ENGINE_UNAVAILABLE", "cause": cause},
        )

    @staticmethod
    def _recv_exact(sock: socket.socket, size: int) -> bytes:
        chunks: list[bytes] = []
        remaining = size
        while remaining > 0:
            chunk = sock.recv(remaining)
            if not chunk:
                raise OSError("Unexpected EOF on Rust IPC socket")
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

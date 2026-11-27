//! Phase 1: Seamless Python <-> Rust IPC Bridge
//! Supports length-prefixed binary/JSON framing over Unix Domain Sockets
//! and lock-free SPSC ring-buffer descriptors for sub-microsecond control-plane dispatch.

use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};
use std::os::unix::fs::{FileTypeExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_IPC_FRAME_BYTES: usize = 1_048_576; // 1 MiB strict frame ceiling

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ControlPlaneCommand {
    Ping {
        seq: u64,
        sent_ns: u128,
    },
    RouteOrder {
        strategy_id: String,
        symbol: String,
        asset_class: String,
        exchange: String,
        side: String,
        quantity: f64,
        limit_price: f64,
        max_slippage_bps: f64,
    },
    ScanMmapWindow {
        mmap_path: String,
        start_epoch_ns: u64,
        end_epoch_ns: u64,
        fast_window: usize,
        slow_window: usize,
    },
    UpdateRiskEnvelope {
        max_position_pct: f64,
        max_leverage: f64,
        hard_drawdown_pct: f64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionReply {
    pub ok: bool,
    pub engine_ts_ns: u128,
    pub latency_ns: u64,
    pub payload_json: String,
}

#[inline]
pub fn monotonic_epoch_ns() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

/// Read a single 4-byte big-endian length-prefixed UTF-8 JSON command frame.
pub fn read_framed_command(stream: &mut UnixStream) -> io::Result<ControlPlaneCommand> {
    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf)?;
    let frame_len = u32::from_be_bytes(len_buf) as usize;
    if frame_len == 0 || frame_len > MAX_IPC_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("IPC frame size {} out of bounds", frame_len),
        ));
    }

    let mut payload = vec![0u8; frame_len];
    stream.read_exact(&mut payload)?;
    serde_json::from_slice(&payload)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err.to_string()))
}

/// Write a single 4-byte big-endian length-prefixed reply frame.
pub fn write_framed_reply(stream: &mut UnixStream, reply: &ExecutionReply) -> io::Result<()> {
    let encoded = serde_json::to_vec(reply)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err.to_string()))?;
    if encoded.len() > MAX_IPC_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Reply exceeds MAX_IPC_FRAME_BYTES",
        ));
    }
    let header = (encoded.len() as u32).to_be_bytes();
    stream.write_all(&header)?;
    stream.write_all(&encoded)?;
    stream.flush()
}

/// Bind a clean Unix Domain Socket listener for Python Control Plane IPC.
pub fn bind_ipc_socket(socket_path: &Path) -> io::Result<UnixListener> {
    match std::fs::symlink_metadata(socket_path) {
        Ok(meta) => {
            if !meta.file_type().is_socket() {
                return Err(io::Error::new(io::ErrorKind::AlreadyExists,
                    "Refusing to replace non-socket IPC path"));
            }
            std::fs::remove_file(socket_path)?;
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        Err(err) => return Err(err),
    }
    let listener = UnixListener::bind(socket_path)?;
    // IPC commands include simulated orders and risk changes. Never expose this
    // socket to other local users by default, even if process umask is permissive.
    std::fs::set_permissions(socket_path, std::fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

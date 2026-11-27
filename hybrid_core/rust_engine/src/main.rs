//! Signal Forge Hybrid Execution Daemon (Rust Layer)
//! Connects to the Python Control Plane via Unix Domain Socket IPC, dispatches
//! nanosecond mmap vectorized scans, and routes paper-chamber orders through the L2 simulator.

mod ipc_ring;
mod mmap_feed;
mod order_book;

use ipc_ring::{
    bind_ipc_socket, monotonic_epoch_ns, read_framed_command, write_framed_reply,
    ControlPlaneCommand, ExecutionReply,
};
use mmap_feed::MmapTickDataset;
use order_book::{DynamicRiskEnvelope, OrderBookRouter};
use std::env;
use std::path::PathBuf;
use std::time::{Duration, Instant};

fn main() -> std::io::Result<()> {
    let socket_path = env::var("SIGNAL_FORGE_IPC_SOCKET")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp/signal_forge_hybrid.sock"));

    let listener = bind_ipc_socket(&socket_path)?;
    let mut router = OrderBookRouter::new(DynamicRiskEnvelope {
        max_position_pct: 2.5,
        max_leverage: 3.0,
        hard_drawdown_pct: 8.0,
    });

    println!(
        "[signal_forge_rust_engine] Listening on IPC socket {}",
        socket_path.display()
    );

    for incoming in listener.incoming() {
        let mut stream = match incoming {
            Ok(s) => s,
            Err(err) => {
                eprintln!("[signal_forge_rust_engine] IPC accept error: {}", err);
                continue;
            }
        };

        // Bound the time an incomplete/malicious IPC frame can block the daemon.
        // This is a single-connection event loop; heavy scans still need worker isolation.
        if let Err(err) = stream.set_read_timeout(Some(Duration::from_secs(2))) {
            eprintln!("[signal_forge_rust_engine] IPC read timeout setup error: {}", err);
            continue;
        }
        if let Err(err) = stream.set_write_timeout(Some(Duration::from_secs(2))) {
            eprintln!("[signal_forge_rust_engine] IPC write timeout setup error: {}", err);
            continue;
        }
        let started = Instant::now();
        let reply = match read_framed_command(&mut stream) {
            Ok(ControlPlaneCommand::Ping { seq, sent_ns }) => {
                let now = monotonic_epoch_ns();
                let one_way_ns = now.saturating_sub(sent_ns) as u64;
                ExecutionReply {
                    ok: true,
                    engine_ts_ns: now,
                    latency_ns: one_way_ns,
                    payload_json: format!(r#"{{"pong_seq":{},"one_way_ns":{}}}"#, seq, one_way_ns),
                }
            }
            Ok(ControlPlaneCommand::RouteOrder {
                exchange,
                side,
                quantity,
                limit_price,
                max_slippage_bps,
                ..
            }) => {
                let fill = router.execute_simulated_order(
                    &exchange,
                    &side,
                    quantity,
                    limit_price,
                    max_slippage_bps,
                    1_250_000.0,
                );
                ExecutionReply {
                    ok: fill.accepted,
                    engine_ts_ns: monotonic_epoch_ns(),
                    latency_ns: started.elapsed().as_nanos() as u64,
                    payload_json: serde_json::to_string(&fill).unwrap_or_default(),
                }
            }
            Ok(ControlPlaneCommand::ScanMmapWindow {
                mmap_path,
                start_epoch_ns,
                end_epoch_ns,
                fast_window,
                slow_window,
            }) => {
                let candidate = PathBuf::from(&mmap_path);
                let has_parent_dir = candidate
                    .components()
                    .any(|c| matches!(c, std::path::Component::ParentDir));
                let allowed_prefix =
                    mmap_path.starts_with("/tmp/sf_mmap_") || mmap_path.starts_with(".data/");
                if has_parent_dir || !allowed_prefix {
                    ExecutionReply {
                        ok: false,
                        engine_ts_ns: monotonic_epoch_ns(),
                        latency_ns: started.elapsed().as_nanos() as u64,
                        payload_json: r#"{"error":"mmap_path confinement violation blocked"}"#
                            .to_string(),
                    }
                } else {
                    match MmapTickDataset::open(&candidate) {
                        Ok(dataset) => {
                            let summary = dataset.run_vectorized_scan(
                                start_epoch_ns,
                                end_epoch_ns,
                                fast_window,
                                slow_window,
                                2.5,
                            );
                            ExecutionReply {
                                ok: true,
                                engine_ts_ns: monotonic_epoch_ns(),
                                latency_ns: started.elapsed().as_nanos() as u64,
                                payload_json: serde_json::to_string(&summary).unwrap_or_default(),
                            }
                        }
                        Err(err) => ExecutionReply {
                            ok: false,
                            engine_ts_ns: monotonic_epoch_ns(),
                            latency_ns: started.elapsed().as_nanos() as u64,
                            payload_json: format!(r#"{{"error":"{}"}}"#, err),
                        },
                    }
                }
            }
            Ok(ControlPlaneCommand::UpdateRiskEnvelope {
                max_position_pct,
                max_leverage,
                hard_drawdown_pct,
            }) if !max_position_pct.is_finite()
                || !max_leverage.is_finite()
                || !hard_drawdown_pct.is_finite() => ExecutionReply {
                ok: false,
                engine_ts_ns: monotonic_epoch_ns(),
                latency_ns: started.elapsed().as_nanos() as u64,
                payload_json: r#"{"error":"NON_FINITE_RISK_ENVELOPE"}"#.to_string(),
            },
            Ok(ControlPlaneCommand::UpdateRiskEnvelope {
                max_position_pct,
                max_leverage,
                hard_drawdown_pct,
            }) => {
                router.risk_envelope = DynamicRiskEnvelope {
                    max_position_pct: max_position_pct.clamp(0.25, 10.0),
                    max_leverage: max_leverage.clamp(1.0, 10.0),
                    hard_drawdown_pct: hard_drawdown_pct.clamp(2.0, 12.0),
                };
                ExecutionReply {
                    ok: true,
                    engine_ts_ns: monotonic_epoch_ns(),
                    latency_ns: started.elapsed().as_nanos() as u64,
                    payload_json: serde_json::to_string(&router.risk_envelope).unwrap_or_default(),
                }
            }
            Err(err) => ExecutionReply {
                ok: false,
                engine_ts_ns: monotonic_epoch_ns(),
                latency_ns: started.elapsed().as_nanos() as u64,
                payload_json: format!(r#"{{"error":"{}"}}"#, err),
            },
        };

        let _ = write_framed_reply(&mut stream, &reply);
    }

    Ok(())
}

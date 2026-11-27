//! Phase 3: Nanosecond Memory-Mapped (mmap) Tick Feed & Multi-Asset Vector Scanner
//! Zero-copy `#[repr(C)]` tick frames matching the Python control plane struct layout (`<QddddBBH`),
//! supporting Crypto, Forex, and Equity adapters with historical epoch date-range filtering.

use memmap2::Mmap;
use serde::Serialize;
use std::fs::File;
use std::io;
use std::path::Path;
use std::time::Instant;

/// Asset class discriminator embedded inside each binary mmap tick frame.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum AssetClassCode {
    Crypto = 1,
    Forex = 2,
    Equities = 3,
}

/// In-memory decoded tick; never reinterpret mapped bytes as a padded C struct.
#[derive(Debug, Clone, Copy)]
pub struct TickFrame {
    pub ts_ns: u64,
    pub bid: f64,
    pub ask: f64,
    pub bid_size: f64,
    pub ask_size: f64,
    pub asset_class: u8,
    pub venue_code: u8,
    pub flags: u16,
}

/// Python `struct.Struct("<QddddBBH")` is exactly 44 bytes, independent of Rust struct padding.
pub const TICK_FRAME_BYTES: usize = 44;
const MAX_MMAP_DATASET_BYTES: u64 = 256 * 1024 * 1024;

fn decode_tick_frame(chunk: &[u8]) -> Option<TickFrame> {
    if chunk.len() != TICK_FRAME_BYTES { return None; }
    let frame = TickFrame {
        ts_ns: u64::from_le_bytes(chunk[0..8].try_into().ok()?),
        bid: f64::from_le_bytes(chunk[8..16].try_into().ok()?),
        ask: f64::from_le_bytes(chunk[16..24].try_into().ok()?),
        bid_size: f64::from_le_bytes(chunk[24..32].try_into().ok()?),
        ask_size: f64::from_le_bytes(chunk[32..40].try_into().ok()?),
        asset_class: chunk[40],
        venue_code: chunk[41],
        flags: u16::from_le_bytes(chunk[42..44].try_into().ok()?),
    };
    if !frame.bid.is_finite() || !frame.ask.is_finite()
        || !frame.bid_size.is_finite() || !frame.ask_size.is_finite() {
        return None;
    }
    Some(frame)
}

#[derive(Debug, Clone, Serialize)]
pub struct VectorScanSummary {
    pub ticks_scanned: usize,
    pub signals_generated: usize,
    pub elapsed_ns: u128,
    pub ns_per_tick: f64,
    pub mean_spread_bps: f64,
    pub cumulative_return_pct: f64,
}

/// Zero-copy slice view over a memory-mapped binary tick dataset.
pub struct MmapTickDataset {
    _file: File,
    mmap: Mmap,
}

impl MmapTickDataset {
    pub fn open(path: &Path) -> io::Result<Self> {
        let file = File::open(path)?;
        let meta = file.metadata()?;
        let frame_size = TICK_FRAME_BYTES;
        if meta.len() == 0 || meta.len() > MAX_MMAP_DATASET_BYTES {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "mmap dataset size outside safe bounds"));
        }
        if (meta.len() as usize) % frame_size != 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "mmap binary tick file is not aligned to TickFrame size",
            ));
        }
        // SAFETY: Read-only mapping, decoded via byte slices (never casting to a TickFrame pointer).
        let mmap = unsafe { Mmap::map(&file)? };
        Ok(Self {
            _file: file,
            mmap,
        })
    }

    /// Vectorized single-pass nanosecond scan over a historical date range (`start_ns..=end_ns`)
    /// computing dual-EMA momentum, order-book imbalance, and slippage-adjusted return.
    pub fn run_vectorized_scan(
        &self,
        start_ns: u64,
        end_ns: u64,
        fast_window: usize,
        slow_window: usize,
        slippage_bps: f64,
    ) -> VectorScanSummary {
        let t0 = Instant::now();
        let fast_alpha = 2.0 / (fast_window.max(2) as f64 + 1.0);
        let slow_alpha = 2.0 / (slow_window.max(4) as f64 + 1.0);

        let mut fast_ema = 0.0f64;
        let mut slow_ema = 0.0f64;
        let mut prev_mid = 0.0f64;
        let mut position = 0.0f64;
        let mut equity = 1.0f64;
        let mut ticks_scanned = 0usize;
        let mut signals_generated = 0usize;
        let mut spread_bps_sum = 0.0f64;

        for chunk in self.mmap.chunks_exact(TICK_FRAME_BYTES) {
            let tick = match decode_tick_frame(chunk) {
                Some(tick) => tick,
                None => continue,
            };
            if tick.ts_ns < start_ns || tick.ts_ns > end_ns {
                continue;
            }
            if tick.bid <= 0.0 || tick.ask <= tick.bid || tick.bid_size < 0.0 || tick.ask_size < 0.0 {
                continue;
            }
            let mid = 0.5 * (tick.bid + tick.ask);
            let spread_bps = ((tick.ask - tick.bid) / mid) * 10_000.0;
            spread_bps_sum += spread_bps;

            if ticks_scanned == 0 {
                fast_ema = mid;
                slow_ema = mid;
                prev_mid = mid;
            } else {
                fast_ema = fast_alpha * mid + (1.0 - fast_alpha) * fast_ema;
                slow_ema = slow_alpha * mid + (1.0 - slow_alpha) * slow_ema;
                let step_ret = (mid - prev_mid) / prev_mid;
                equity *= 1.0 + position * step_ret;
                prev_mid = mid;
            }

            let ob_denom = (tick.bid_size + tick.ask_size).max(1e-9);
            let ob_imbalance = (tick.bid_size - tick.ask_size) / ob_denom;

            let desired_pos = if fast_ema > slow_ema && ob_imbalance > 0.05 {
                1.0
            } else if fast_ema < slow_ema && ob_imbalance < -0.05 {
                -1.0
            } else {
                0.0
            };

            if (desired_pos - position).abs() > 0.5 {
                let cost_fraction = (slippage_bps + spread_bps * 0.5) / 10_000.0;
                equity *= 1.0 - cost_fraction;
                position = desired_pos;
                signals_generated += 1;
            }
            ticks_scanned += 1;
        }

        let elapsed_ns = t0.elapsed().as_nanos().max(1);
        let ns_per_tick = if ticks_scanned > 0 {
            elapsed_ns as f64 / ticks_scanned as f64
        } else {
            0.0
        };

        VectorScanSummary {
            ticks_scanned,
            signals_generated,
            elapsed_ns,
            ns_per_tick,
            mean_spread_bps: if ticks_scanned > 0 {
                spread_bps_sum / ticks_scanned as f64
            } else {
                0.0
            },
            cumulative_return_pct: (equity - 1.0) * 100.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn python_44_byte_layout_decodes_without_padding() {
        let mut bytes = [0u8; TICK_FRAME_BYTES];
        bytes[0..8].copy_from_slice(&42u64.to_le_bytes());
        bytes[8..16].copy_from_slice(&100.5f64.to_le_bytes());
        bytes[16..24].copy_from_slice(&101.0f64.to_le_bytes());
        bytes[24..32].copy_from_slice(&12.0f64.to_le_bytes());
        bytes[32..40].copy_from_slice(&8.0f64.to_le_bytes());
        bytes[40] = 1;
        bytes[41] = 2;
        bytes[42..44].copy_from_slice(&7u16.to_le_bytes());
        let frame = decode_tick_frame(&bytes).expect("valid Python frame");
        assert_eq!(frame.ts_ns, 42);
        assert_eq!(frame.bid, 100.5);
        assert_eq!(frame.ask, 101.0);
        assert_eq!(frame.flags, 7);
        assert!(decode_tick_frame(&bytes[..43]).is_none());
    }
    #[test]
    fn reject_non_finite_tick_data() {
        let mut bytes = [0u8; TICK_FRAME_BYTES];
        bytes[8..16].copy_from_slice(&f64::NAN.to_le_bytes());
        assert!(decode_tick_frame(&bytes).is_none());
    }
}

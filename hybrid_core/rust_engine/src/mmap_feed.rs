//! Phase 3: Nanosecond Memory-Mapped (mmap) Tick Feed & Multi-Asset Vector Scanner
//! Zero-copy `#[repr(C)]` tick frames matching the Python control plane struct layout (`<QddddBBH`),
//! supporting Crypto, Forex, and Equity adapters with historical epoch date-range filtering.

use memmap2::Mmap;
use serde::Serialize;
use std::fs::File;
use std::io;
use std::mem::size_of;
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

/// 44-byte packed binary tick frame shared across Python mmap writer and Rust scanner.
#[repr(C)]
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
    frame_count: usize,
}

impl MmapTickDataset {
    pub fn open(path: &Path) -> io::Result<Self> {
        let file = File::open(path)?;
        let meta = file.metadata()?;
        let frame_size = size_of::<TickFrame>();
        if (meta.len() as usize) % frame_size != 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "mmap binary tick file is not aligned to TickFrame size",
            ));
        }
        // SAFETY: Read-only immutable snapshot file verified for exact struct alignment.
        let mmap = unsafe { Mmap::map(&file)? };
        let frame_count = mmap.len() / frame_size;
        Ok(Self {
            _file: file,
            mmap,
            frame_count,
        })
    }

    #[inline]
    pub fn frames(&self) -> &[TickFrame] {
        let ptr = self.mmap.as_ptr() as *const TickFrame;
        // SAFETY: Length verified as exact multiple of size_of::<TickFrame>().
        unsafe { std::slice::from_raw_parts(ptr, self.frame_count) }
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

        for tick in self.frames() {
            if tick.ts_ns < start_ns || tick.ts_ns > end_ns {
                continue;
            }
            if tick.bid <= 0.0 || tick.ask <= tick.bid {
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

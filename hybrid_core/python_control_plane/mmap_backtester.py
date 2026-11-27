"""Phase 3 & Phase 6: Memory-Mapped (mmap) Nanosecond Backtesting Pipeline.

Matches the 44-byte Rust `TickFrame` binary layout (`<QddddBBH`), provides modular
data adapters for Crypto, Forex, and Equities, supports vectorized simulation of
technical indicators + order book dynamics + slippage, and filters by historical
date range and market regime.
"""

from __future__ import annotations

import math
import mmap
import os
import struct
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Tuple

TICK_STRUCT = struct.Struct("<QddddBBH")  # 8 + 8*4 + 1 + 1 + 2 = 44 bytes

ASSET_CODES = {"CRYPTO": 1, "FOREX": 2, "EQUITIES": 3}


@dataclass(frozen=True)
class AssetAdapterProfile:
    asset_class: str
    symbol: str
    exchange: str
    base_price: float
    base_spread_bps: float
    tick_volatility: float
    lot_depth_usd: float


ADAPTER_REGISTRY = {
    "CRYPTO": AssetAdapterProfile("CRYPTO", "BTC/USDT", "BINANCE", 68_400.0, 1.4, 0.0018, 1_800_000.0),
    "FOREX": AssetAdapterProfile("FOREX", "EUR/USD", "OANDA", 1.0845, 0.7, 0.00045, 4_500_000.0),
    "EQUITIES": AssetAdapterProfile("EQUITIES", "NVDA", "IBKR", 132.50, 1.1, 0.00135, 2_400_000.0),
}


@dataclass(frozen=True)
class EntryExecutionPoint:
    ts_iso: str
    side: str
    entry_price: float
    exit_price: float
    return_pct: float
    ob_imbalance: float


@dataclass(frozen=True)
class VectorBacktestReport:
    asset_class: str
    symbol: str
    exchange: str
    start_date: str
    end_date: str
    regime: str
    ticks_processed: int
    elapsed_ns: int
    ns_per_tick: float
    total_return_pct: float
    sharpe_ratio: float
    max_drawdown_pct: float
    win_rate_pct: float
    trade_count: int
    entry_points: List[EntryExecutionPoint]


def _iso_to_epoch_ns(iso_date: str) -> int:
    dt = datetime.fromisoformat(iso_date).replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1_000_000_000)


def write_mmap_tick_dataset(
    file_path: str,
    asset_class: str,
    start_date: str,
    end_date: str,
    regime: str = "TRENDING_BULL",
    tick_count: int = 12_000,
) -> Tuple[str, AssetAdapterProfile]:
    """Generate a binary mmap-aligned tick file for the requested asset adapter and date range."""
    # Prevent a single oversized request from allocating unbounded RAM for tick data.
    # 250k × 44 bytes = 11 MiB of raw data, before Python overhead.
    if type(tick_count) is not int or not 1 <= tick_count <= 250_000:
        raise ValueError("tick_count must be an integer in [1, 250000]")
    adapter = ADAPTER_REGISTRY.get(asset_class.upper(), ADAPTER_REGISTRY["CRYPTO"])
    start_ns = _iso_to_epoch_ns(start_date)
    end_ns = max(start_ns + 60_000_000_000, _iso_to_epoch_ns(end_date))
    step_ns = max(1, (end_ns - start_ns) // max(1, tick_count))

    regime_drift = {
        "TRENDING_BULL": 0.00011,
        "HIGH_VOL_CHOP": 0.00002,
        "BEAR_STRESS": -0.00009,
        "MEAN_REVERTING": 0.00004,
    }.get(regime.upper(), 0.00006)
    regime_vol_mult = 1.65 if regime.upper() == "HIGH_VOL_CHOP" else 1.0

    os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)
    price = adapter.base_price
    asset_code = ASSET_CODES.get(adapter.asset_class, 1)

    with open(file_path, "wb") as handle:
        buf = bytearray(tick_count * TICK_STRUCT.size)
        for i in range(tick_count):
            wave = math.sin(i * 0.043) * 0.65 + math.cos(i * 0.017) * 0.35
            micro = math.sin(i * 0.31) * 0.25
            delta = (regime_drift + (wave + micro) * adapter.tick_volatility * regime_vol_mult)
            price = max(adapter.base_price * 0.35, price * (1.0 + delta))
            half_spread = price * (adapter.base_spread_bps / 20_000.0)
            bid = price - half_spread
            ask = price + half_spread
            bid_size = 18.0 + 12.0 * max(0.0, math.sin(i * 0.043 + 0.3))
            ask_size = 18.0 + 12.0 * max(0.0, -math.sin(i * 0.043 + 0.3))
            ts_ns = start_ns + i * step_ns
            TICK_STRUCT.pack_into(
                buf,
                i * TICK_STRUCT.size,
                ts_ns,
                bid,
                ask,
                bid_size,
                ask_size,
                asset_code,
                1,
                0,
            )
        handle.write(buf)
    return file_path, adapter


def run_mmap_vectorized_backtest(
    file_path: str,
    adapter: AssetAdapterProfile,
    start_date: str,
    end_date: str,
    regime: str = "TRENDING_BULL",
    fast_window: int = 12,
    slow_window: int = 36,
    slippage_bps: float = 2.0,
) -> VectorBacktestReport:
    """Memory-map the binary tick file and run a single-pass vectorized simulation."""
    start_ns = _iso_to_epoch_ns(start_date)
    end_ns = max(start_ns + 1, _iso_to_epoch_ns(end_date))
    fast_alpha = 2.0 / (max(2, fast_window) + 1.0)
    slow_alpha = 2.0 / (max(4, slow_window) + 1.0)

    t0 = time.perf_counter_ns()
    equity = 1.0
    peak_equity = 1.0
    max_dd = 0.0
    position = 0
    entry_price = 0.0
    entry_ts_ns = start_ns
    entry_imbalance = 0.0
    fast_ema = 0.0
    slow_ema = 0.0
    ticks_processed = 0
    trade_returns: List[float] = []
    entry_points: List[EntryExecutionPoint] = []

    with open(file_path, "rb") as handle:
        with mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ) as mm:
            for offset in range(0, len(mm), TICK_STRUCT.size):
                ts_ns, bid, ask, bid_sz, ask_sz, _, _, _ = TICK_STRUCT.unpack_from(mm, offset)
                if ts_ns < start_ns or ts_ns > end_ns:
                    continue
                mid = 0.5 * (bid + ask)
                if ticks_processed == 0:
                    fast_ema = mid
                    slow_ema = mid
                else:
                    fast_ema = fast_alpha * mid + (1.0 - fast_alpha) * fast_ema
                    slow_ema = slow_alpha * mid + (1.0 - slow_alpha) * slow_ema

                ob_imb = (bid_sz - ask_sz) / max(1e-9, bid_sz + ask_sz)
                desired = 1 if (fast_ema > slow_ema and ob_imb > 0.04) else (
                    -1 if (fast_ema < slow_ema and ob_imb < -0.04) else 0
                )

                if desired != position:
                    if position != 0 and entry_price > 0.0:
                        raw_ret = ((mid - entry_price) / entry_price) * position
                        cost = (slippage_bps + adapter.base_spread_bps) / 10_000.0
                        net_ret = raw_ret - cost
                        equity *= 1.0 + net_ret
                        peak_equity = max(peak_equity, equity)
                        max_dd = max(max_dd, (peak_equity - equity) / peak_equity)
                        trade_returns.append(net_ret)
                        if len(entry_points) < 16:
                            entry_points.append(
                                EntryExecutionPoint(
                                    ts_iso=datetime.fromtimestamp(
                                        entry_ts_ns / 1_000_000_000, tz=timezone.utc
                                    ).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                    side="LONG" if position > 0 else "SHORT",
                                    entry_price=round(entry_price, 6),
                                    exit_price=round(mid, 6),
                                    return_pct=round(net_ret * 100.0, 3),
                                    ob_imbalance=round(entry_imbalance, 3),
                                )
                            )
                    position = desired
                    entry_price = mid if desired != 0 else 0.0
                    entry_ts_ns = ts_ns
                    entry_imbalance = ob_imb

                ticks_processed += 1

    elapsed_ns = max(1, time.perf_counter_ns() - t0)
    wins = sum(1 for r in trade_returns if r > 0.0)
    win_rate = (wins / len(trade_returns) * 100.0) if trade_returns else 0.0
    mean_ret = (sum(trade_returns) / len(trade_returns)) if trade_returns else 0.0
    variance = (
        sum((r - mean_ret) ** 2 for r in trade_returns) / max(1, len(trade_returns) - 1)
        if len(trade_returns) > 1
        else 1e-6
    )
    sharpe = (mean_ret / max(1e-6, math.sqrt(variance))) * math.sqrt(max(1, len(trade_returns)))

    return VectorBacktestReport(
        asset_class=adapter.asset_class,
        symbol=adapter.symbol,
        exchange=adapter.exchange,
        start_date=start_date,
        end_date=end_date,
        regime=regime,
        ticks_processed=ticks_processed,
        elapsed_ns=elapsed_ns,
        ns_per_tick=round(elapsed_ns / max(1, ticks_processed), 2),
        total_return_pct=round((equity - 1.0) * 100.0, 3),
        sharpe_ratio=round(max(-5.0, min(8.0, sharpe)), 3),
        max_drawdown_pct=round(max_dd * 100.0, 3),
        win_rate_pct=round(win_rate, 2),
        trade_count=len(trade_returns),
        entry_points=entry_points,
    )

"""
Signal Forge — Unified CCXT Exchange Connection Layer (Freqtrade Pattern).

Eliminates redundant per-exchange REST/WebSocket handlers by routing every
AI-generated Spot and Futures signal through a single standardized CCXT
gateway supporting Binance, Bybit, OKX, and Kraken.
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Literal, Optional, Tuple

try:
    import ccxt  # type: ignore
except ImportError:  # pragma: no cover - optional runtime dependency
    ccxt = None  # type: ignore

SupportedExchangeId = Literal["binance", "bybit", "okx", "kraken"]
MarketType = Literal["SPOT", "FUTURES"]
TradingMode = Literal["TESTNET", "PAPER_DRY_RUN", "LIVE"]
OrderSide = Literal["BUY", "SELL"]

SUPPORTED_EXCHANGES: Tuple[SupportedExchangeId, ...] = (
    "binance",
    "bybit",
    "okx",
    "kraken",
)


@dataclass(frozen=True)
class StandardizedSignal:
    """Canonical AI signal payload accepted by the unified CCXT execution router."""

    signal_id: str
    exchange: SupportedExchangeId
    symbol: str
    market_type: MarketType
    side: OrderSide
    entry_price: float
    stake_usd: float
    confidence_pct: float
    leverage: float = 1.0
    strategy_name: str = "SignalForgeAI"


@dataclass(frozen=True)
class UnifiedOrderReceipt:
    """Normalized order receipt returned regardless of underlying venue or mode."""

    order_id: str
    signal_id: str
    exchange: SupportedExchangeId
    symbol: str
    market_type: MarketType
    trading_mode: TradingMode
    side: OrderSide
    filled_price: float
    quantity: float
    notional_usd: float
    fee_usd: float
    latency_ms: float
    status: Literal["FILLED", "REJECTED"]
    reason: str = ""
    timestamp_ms: int = field(default_factory=lambda: int(time.time() * 1000))


class UnifiedCCXTRouter:
    """
    Single standardized exchange adapter modeled after Freqtrade's Exchange class.
    - Reads API credentials strictly from environment variables (never config files).
    - Enforces exchange allowlist, Spot/Futures market mapping, and rate limiting.
    - Routes PAPER_DRY_RUN executions through deterministic local fill simulation
      with realistic fee & spread slippage modeling so zero live funds are touched.
    """

    MAKER_TAKER_FEE_RATE: float = 0.001  # 10 bps realistic taker fee

    def __init__(
        self,
        exchange_id: SupportedExchangeId = "binance",
        market_type: MarketType = "SPOT",
        trading_mode: TradingMode = "PAPER_DRY_RUN",
    ) -> None:
        if exchange_id not in SUPPORTED_EXCHANGES:
            raise ValueError(
                f"Unsupported exchange '{exchange_id}'. Allowed: {SUPPORTED_EXCHANGES}"
            )
        self.exchange_id: SupportedExchangeId = exchange_id
        self.market_type: MarketType = market_type
        self.trading_mode: TradingMode = trading_mode
        self._clients: Dict[Tuple[str, str, str], Any] = {}

    def _build_ccxt_client(
        self,
        exchange_id: SupportedExchangeId,
        market_type: MarketType,
        trading_mode: TradingMode,
    ) -> Optional[Any]:
        """Lazily instantiate a rate-limited CCXT client for Testnet or Live calls."""
        if ccxt is None or trading_mode == "PAPER_DRY_RUN":
            return None

        cache_key = (exchange_id, market_type, trading_mode)
        if cache_key in self._clients:
            return self._clients[cache_key]

        exchange_cls = getattr(ccxt, exchange_id, None)
        if exchange_cls is None:
            raise ValueError(f"CCXT does not expose exchange class '{exchange_id}'")

        api_key = os.getenv("EXCHANGE_API_KEY", "").strip()
        api_secret = os.getenv("EXCHANGE_API_SECRET", "").strip()
        default_type = "future" if market_type == "FUTURES" else "spot"

        client = exchange_cls(
            {
                "apiKey": api_key or None,
                "secret": api_secret or None,
                "enableRateLimit": True,
                "timeout": 10_000,
                "options": {"defaultType": default_type},
            }
        )
        if trading_mode == "TESTNET" and hasattr(client, "set_sandbox_mode"):
            client.set_sandbox_mode(True)

        self._clients[cache_key] = client
        return client

    def fetch_reference_price(self, symbol: str, fallback_price: float) -> float:
        """Fetch live ticker via CCXT when available, otherwise use supplied reference."""
        client = self._build_ccxt_client(
            self.exchange_id, self.market_type, self.trading_mode
        )
        if client is not None:
            try:
                ticker = client.fetch_ticker(symbol)
                last_price = float(ticker.get("last") or 0.0)
                if last_price > 0:
                    return last_price
            except Exception:
                pass
        return fallback_price

    def execute_signal(
        self,
        signal: StandardizedSignal,
        trading_mode: Optional[TradingMode] = None,
    ) -> UnifiedOrderReceipt:
        """
        Execute an AI-generated signal through the single standardized gateway.
        Validates venue, positive price/stake, and routes according to active mode.
        """
        t0 = time.perf_counter()
        mode: TradingMode = trading_mode or self.trading_mode

        if signal.exchange not in SUPPORTED_EXCHANGES:
            return UnifiedOrderReceipt(
                order_id=f"rej-{signal.signal_id}",
                signal_id=signal.signal_id,
                exchange=self.exchange_id,
                symbol=signal.symbol,
                market_type=signal.market_type,
                trading_mode=mode,
                side=signal.side,
                filled_price=0.0,
                quantity=0.0,
                notional_usd=0.0,
                fee_usd=0.0,
                latency_ms=round((time.perf_counter() - t0) * 1000.0, 2),
                status="REJECTED",
                reason=f"Unsupported exchange: {signal.exchange}",
            )

        if signal.entry_price <= 0 or signal.stake_usd <= 0:
            return UnifiedOrderReceipt(
                order_id=f"rej-{signal.signal_id}",
                signal_id=signal.signal_id,
                exchange=signal.exchange,
                symbol=signal.symbol,
                market_type=signal.market_type,
                trading_mode=mode,
                side=signal.side,
                filled_price=0.0,
                quantity=0.0,
                notional_usd=0.0,
                fee_usd=0.0,
                latency_ms=round((time.perf_counter() - t0) * 1000.0, 2),
                status="REJECTED",
                reason="Entry price and stake_usd must be strictly positive.",
            )

        leverage = max(1.0, min(20.0, signal.leverage if signal.market_type == "FUTURES" else 1.0))
        notional_usd = round(signal.stake_usd * leverage, 4)

        # Realistic 2 bps execution slippage in PAPER_DRY_RUN / TESTNET simulation
        slippage_mult = 1.0002 if signal.side == "BUY" else 0.9998
        fill_price = round(signal.entry_price * slippage_mult, 6)
        quantity = round(notional_usd / fill_price, 8)
        fee_usd = round(notional_usd * self.MAKER_TAKER_FEE_RATE, 4)

        if mode in ("TESTNET", "LIVE"):
            client = self._build_ccxt_client(signal.exchange, signal.market_type, mode)
            if client is not None and os.getenv("EXCHANGE_API_KEY", "").strip():
                try:
                    raw_order = client.create_market_order(
                        signal.symbol, signal.side.lower(), quantity
                    )
                    fill_price = float(raw_order.get("average") or fill_price)
                    order_id = str(raw_order.get("id") or f"ccxt-{int(time.time() * 1000)}")
                    return UnifiedOrderReceipt(
                        order_id=order_id,
                        signal_id=signal.signal_id,
                        exchange=signal.exchange,
                        symbol=signal.symbol,
                        market_type=signal.market_type,
                        trading_mode=mode,
                        side=signal.side,
                        filled_price=fill_price,
                        quantity=quantity,
                        notional_usd=notional_usd,
                        fee_usd=fee_usd,
                        latency_ms=round((time.perf_counter() - t0) * 1000.0, 2),
                        status="FILLED",
                        reason=f"Executed via CCXT ({signal.exchange} {signal.market_type} {mode})",
                    )
                except Exception as exc:
                    return UnifiedOrderReceipt(
                        order_id=f"err-{signal.signal_id}",
                        signal_id=signal.signal_id,
                        exchange=signal.exchange,
                        symbol=signal.symbol,
                        market_type=signal.market_type,
                        trading_mode=mode,
                        side=signal.side,
                        filled_price=0.0,
                        quantity=0.0,
                        notional_usd=0.0,
                        fee_usd=0.0,
                        latency_ms=round((time.perf_counter() - t0) * 1000.0, 2),
                        status="REJECTED",
                        reason=f"CCXT execution error: {exc}",
                    )

        return UnifiedOrderReceipt(
            order_id=f"{mode.lower()}-{signal.exchange}-{int(time.time() * 1000)}",
            signal_id=signal.signal_id,
            exchange=signal.exchange,
            symbol=signal.symbol,
            market_type=signal.market_type,
            trading_mode=mode,
            side=signal.side,
            filled_price=fill_price,
            quantity=quantity,
            notional_usd=notional_usd,
            fee_usd=fee_usd,
            latency_ms=round((time.perf_counter() - t0) * 1000.0, 2),
            status="FILLED",
            reason=f"Unified CCXT router fill ({signal.exchange} {signal.market_type} · {mode})",
        )

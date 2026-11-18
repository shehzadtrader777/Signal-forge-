# kernels/foundation/cps/interface.py
from __future__ import annotations
from dataclasses import dataclass
from enum import Enum
from typing import Literal, Protocol, runtime_checkable

INVARIANTS = {
    "I-PD1": "monotonic_sequence",
    "I-PD2": "freshness_ceiling",
    "I-PD3": "source_immutability_within_decision",
    "I-PD4": "cross_check_agreement",
}

class ReasonCode(str, Enum):
    STALE = "STALE"
    GAP = "GAP"
    DIVERGENCE = "DIVERGENCE"
    SOURCE_DISCONNECTED = "SOURCE_DISCONNECTED"

class InstrumentClass(str, Enum):
    SPOT = "spot"
    USDM_PERP = "usdm_perp"
    COINM_PERP = "coinm_perp"

@dataclass(frozen=True)
class PriceReading:
    instrument: str
    source_id: str
    sequence_number: int
    timestamp_exchange_ms: int
    timestamp_received_ms: int
    bid: float
    ask: float
    mid: float
    mark_price: float | None
    kernel_hash: str

    @property
    def freshness_ms(self) -> int:
        return self.timestamp_received_ms - self.timestamp_exchange_ms

@dataclass(frozen=True)
class PriceUnavailable:
    instrument: str
    reason_code: ReasonCode
    last_known_reading: PriceReading | None = None   # diagnostics only

PriceResult = PriceReading | PriceUnavailable

@runtime_checkable
class PriceOracle(Protocol):
    async def begin_decision(self, instrument: str) -> "SnapshotHandle": ...
    def end_decision(self, handle: "SnapshotHandle") -> None: ...

@runtime_checkable
class SnapshotHandle(Protocol):
    instrument: str
    source_id: str
    sequence_number: int
    price: PriceReading

    def validate_within_decision(self, fresh: PriceResult) -> None: ...

# kernels/foundation/cps/source_registry.py
from dataclasses import dataclass
from .interface import InstrumentClass

@dataclass(frozen=True)
class SourceBinding:
    instrument_class: InstrumentClass
    primary_stream: str          # e.g. "binance.spot.bookTicker"
    secondary_poll: str          # e.g. "binance.spot.rest.ticker"
    freshness_ceiling_ms: int
    divergence_threshold_bps: float

SIGNED_REGISTRY: dict[InstrumentClass, SourceBinding] = {
    InstrumentClass.SPOT: SourceBinding(
        instrument_class=InstrumentClass.SPOT,
        primary_stream="binance.spot.bookTicker",
        secondary_poll="binance.spot.rest.ticker",
        freshness_ceiling_ms=500,
        divergence_threshold_bps=25.0,
    ),
    InstrumentClass.USDM_PERP: SourceBinding(
        instrument_class=InstrumentClass.USDM_PERP,
        primary_stream="binance.usdm.markPrice@1s",
        secondary_poll="binance.usdm.rest.premiumIndex",
        freshness_ceiling_ms=1500,
        divergence_threshold_bps=50.0,
    ),
    InstrumentClass.COINM_PERP: SourceBinding(
        instrument_class=InstrumentClass.COINM_PERP,
        primary_stream="binance.coinm.markPrice@1s",
        secondary_poll="binance.coinm.rest.premiumIndex",
        freshness_ceiling_ms=1500,
        divergence_threshold_bps=50.0,
    ),
}

def binding_for(instrument: str) -> SourceBinding:
    if "perp" in instrument.lower() or instrument.endswith("USD_PERP"):
        return SIGNED_REGISTRY[InstrumentClass.USDM_PERP]
    return SIGNED_REGISTRY[InstrumentClass.SPOT]

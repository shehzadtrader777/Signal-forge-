"""
Signal Forge — Fable 5.2 Layer 6: Prop Firm Risk Manager & Risk Parity Engine
=============================================================================
Enforces institutional prop firm hard-coded risk controls and quantitative
position-sizing rules across all deployment phases:

1. Hard-Coded Prop Firm Loss Guards:
   - Daily Loss Limit (default 4.0% of start-of-day equity)
   - Maximum Peak-to-Trough Drawdown Stop (default 8.0% of high-water mark)
2. Dynamic Half-Kelly Criterion Position Sizing (when Sharpe > 1.5):
   - Financial Theory: The full Kelly fraction f* = (p * b - q) / b maximizes
     asymptotic geometric compounding rate E[ln(1 + f * R)], where p is win
     probability, q = 1 - p, and b = avg_win / avg_loss. Because parameter
     estimation error on finite samples creates severe left-tail drawdown risk,
     institutional desks apply Half-Kelly (0.5 * f*), capturing 75% of optimal
     growth while cutting variance by 75%.
   - Activated strictly when validated OOS Sharpe > 1.5; otherwise falls back
     to conservative static ATR-normalized fractional sizing.
3. Regime-Adaptive Trailing Stops:
   - High Volatility Regime: 2.5x ATR(14) trailing distance prevents premature
     stop-outs from fat-tailed intraday noise.
   - Quiet / Low Volatility Regime: 1.5x ATR(14) tightens stops to preserve
     accumulated open equity during compressed range conditions.
4. Execution Latency & Microstructure Spread Guard:
   - Rejects any order entry when bid-ask spread (ask - bid) / mid > 0.02%
     (0.0002), eliminating adverse selection and latency slippage.
5. Pre-Trade Correlation Guard:
   - Blocks entries whose pairwise correlation |rho| against active portfolio
     holdings exceeds max_pairwise_correlation (default 0.70).
6. Inverse Variance Weighting across Non-Correlated Strategy Families:
   - Allocates capital across Breakout, Mean Reversion, and Momentum via
     w_i = (1 / sigma_i^2) / sum_j(1 / sigma_j^2), minimizing total portfolio
     variance under near-zero inter-family correlation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Iterable, List, Optional


class VolatilityRegime(str, Enum):
    """Market volatility regime classification produced by Layer 2."""

    HIGH_VOLATILITY = "HIGH_VOLATILITY"
    QUIET = "QUIET"


@dataclass(frozen=True)
class PropFirmLimits:
    """Immutable prop firm compliance envelope enforced by Layer 6."""

    max_daily_loss_pct: float = 0.04          # 4.0% hard daily stop
    max_total_drawdown_pct: float = 0.08      # 8.0% hard peak-to-trough stop
    max_bid_ask_spread_pct: float = 0.0002    # 0.02% strict execution spread cap
    max_pairwise_correlation: float = 0.70    # Pre-trade correlation guard
    kelly_sharpe_threshold: float = 1.50      # Half-Kelly activation floor
    static_risk_per_trade_pct: float = 0.0075 # 0.75% fallback when Sharpe <= 1.5
    max_single_trade_risk_pct: float = 0.02   # 2.0% absolute risk ceiling
    high_vol_atr_multiplier: float = 2.5      # 2.5x ATR stop in high volatility
    quiet_vol_atr_multiplier: float = 1.5     # 1.5x ATR stop in quiet markets


@dataclass(frozen=True)
class StrategyFamilyMetrics:
    """Realized return volatility and performance profile for a strategy family."""

    family_name: str  # "BREAKOUT" | "MEAN_REVERSION" | "MOMENTUM"
    annualized_volatility: float
    oos_sharpe: float
    win_rate: float
    payoff_ratio: float  # average_win / average_loss


@dataclass(frozen=True)
class RiskDecision:
    """Auditable pre-trade risk gate verdict returned by RiskManager."""

    approved: bool
    rejection_reasons: List[str] = field(default_factory=list)
    sizing_mode: str = "STATIC_FALLBACK"
    risk_fraction_of_equity: float = 0.0
    position_notional_usd: float = 0.0
    position_units: float = 0.0
    trailing_stop_atr_mult: float = 1.5
    trailing_stop_price: float = 0.0
    bid_ask_spread_pct: float = 0.0
    family_weight: float = 0.0


class RiskManager:
    """
    Layer 6 Autonomous Risk & Capital Allocation Controller.
    Pure, deterministic, and stateless with respect to market data feeds so every
    decision can be replayed cleanly during backtests and paper/live execution.
    """

    REQUIRED_FAMILIES = ("BREAKOUT", "MEAN_REVERSION", "MOMENTUM")

    def __init__(self, limits: Optional[PropFirmLimits] = None) -> None:
        self.limits = limits or PropFirmLimits()

    # ------------------------------------------------------------------
    # 1. Prop Firm Daily Loss & Maximum Drawdown Circuit Breakers
    # ------------------------------------------------------------------
    def check_prop_firm_drawdown(
        self,
        current_equity: float,
        start_of_day_equity: float,
        high_water_mark_equity: float,
    ) -> List[str]:
        """Returns violation messages if daily loss or total drawdown limits are breached."""
        violations: List[str] = []
        if current_equity <= 0 or start_of_day_equity <= 0 or high_water_mark_equity <= 0:
            violations.append("Invalid non-positive equity telemetry.")
            return violations

        daily_loss_pct = max(0.0, (start_of_day_equity - current_equity) / start_of_day_equity)
        total_dd_pct = max(0.0, (high_water_mark_equity - current_equity) / high_water_mark_equity)

        if daily_loss_pct >= self.limits.max_daily_loss_pct:
            violations.append(
                f"DAILY_LOSS_LIMIT_BREACHED: {daily_loss_pct:.4%} >= "
                f"{self.limits.max_daily_loss_pct:.2%} hard prop firm limit."
            )
        if total_dd_pct >= self.limits.max_total_drawdown_pct:
            violations.append(
                f"MAX_DRAWDOWN_LIMIT_BREACHED: {total_dd_pct:.4%} >= "
                f"{self.limits.max_total_drawdown_pct:.2%} hard prop firm stop."
            )
        return violations

    # ------------------------------------------------------------------
    # 2. Dynamic Half-Kelly Criterion Sizing (Sharpe > 1.5)
    # ------------------------------------------------------------------
    def compute_risk_fraction(
        self,
        sharpe_ratio: float,
        win_rate: float,
        payoff_ratio: float,
    ) -> tuple[float, str]:
        """
        Replaces static percentage allocation with Dynamic Half-Kelly when Sharpe > 1.5.

        Formula:
            f* = (p * b - q) / b,   where p = win_rate, q = 1 - p, b = payoff_ratio
            f_half = 0.5 * max(0, f*)

        Bounded by [0, max_single_trade_risk_pct] to protect prop firm drawdown envelopes.
        """
        if sharpe_ratio > self.limits.kelly_sharpe_threshold and payoff_ratio > 0:
            p = min(max(win_rate, 0.0), 1.0)
            q = 1.0 - p
            full_kelly = (p * payoff_ratio - q) / payoff_ratio
            half_kelly = 0.5 * max(0.0, full_kelly)
            # Scale slightly by edge stability while strictly honoring hard risk ceiling
            bounded = min(self.limits.max_single_trade_risk_pct, half_kelly)
            if bounded > 0.0:
                return bounded, "DYNAMIC_HALF_KELLY"

        return (
            min(self.limits.static_risk_per_trade_pct, self.limits.max_single_trade_risk_pct),
            "STATIC_CONSERVATIVE",
        )

    # ------------------------------------------------------------------
    # 3. Regime-Adaptive Trailing Stops (2.5x ATR High-Vol / 1.5x Quiet)
    # ------------------------------------------------------------------
    def compute_regime_trailing_stop(
        self,
        entry_price: float,
        atr: float,
        side: str,
        regime: VolatilityRegime,
    ) -> tuple[float, float]:
        """
        Computes trailing stop multiplier and absolute stop level.
        High volatility -> 2.5x ATR; Quiet market -> 1.5x ATR.
        """
        mult = (
            self.limits.high_vol_atr_multiplier
            if regime == VolatilityRegime.HIGH_VOLATILITY
            else self.limits.quiet_vol_atr_multiplier
        )
        stop_dist = max(atr * mult, entry_price * 0.001)
        if side.upper() == "BUY":
            return mult, max(0.0, entry_price - stop_dist)
        return mult, entry_price + stop_dist

    # ------------------------------------------------------------------
    # 4. Execution Microstructure Spread Check (<= 0.02% of price)
    # ------------------------------------------------------------------
    def check_bid_ask_spread(self, bid: float, ask: float) -> tuple[bool, float]:
        """Rejects entries when (ask - bid) / mid exceeds 0.02% (0.0002)."""
        if bid <= 0 or ask <= 0 or ask < bid:
            return False, 1.0
        mid = 0.5 * (bid + ask)
        spread_pct = (ask - bid) / mid
        return spread_pct <= self.limits.max_bid_ask_spread_pct, spread_pct

    # ------------------------------------------------------------------
    # 5. Pre-Trade Correlation Guard
    # ------------------------------------------------------------------
    def check_correlation_guard(
        self,
        candidate_correlations: Iterable[float],
    ) -> tuple[bool, float]:
        """Ensures no open position has |rho| > max_pairwise_correlation with candidate."""
        max_abs_corr = 0.0
        for corr in candidate_correlations:
            max_abs_corr = max(max_abs_corr, abs(float(corr)))
        return max_abs_corr <= self.limits.max_pairwise_correlation, max_abs_corr

    # ------------------------------------------------------------------
    # 6. Inverse Variance Weighting across Breakout, Mean Reversion, Momentum
    # ------------------------------------------------------------------
    def compute_inverse_variance_weights(
        self,
        families: List[StrategyFamilyMetrics],
    ) -> Dict[str, float]:
        """
        Computes risk-parity inverse variance weights:
            w_i = (1 / sigma_i^2) / sum_j(1 / sigma_j^2)

        Dampens portfolio-level drawdowns by allocating higher capital to
        lower-variance non-correlated strategy families.
        """
        if not families:
            return {name: 1.0 / len(self.REQUIRED_FAMILIES) for name in self.REQUIRED_FAMILIES}

        inv_vars: Dict[str, float] = {}
        for fam in families:
            vol = max(fam.annualized_volatility, 1e-4)
            inv_vars[fam.family_name.upper()] = 1.0 / (vol * vol)

        total = sum(inv_vars.values())
        return {k: v / total for k, v in inv_vars.items()}

    # ------------------------------------------------------------------
    # Unified Pre-Trade Gate Evaluation
    # ------------------------------------------------------------------
    def evaluate_pre_trade(
        self,
        *,
        side: str,
        bid: float,
        ask: float,
        atr: float,
        regime: VolatilityRegime,
        current_equity: float,
        start_of_day_equity: float,
        high_water_mark_equity: float,
        strategy_family: StrategyFamilyMetrics,
        all_families: List[StrategyFamilyMetrics],
        active_correlations: Iterable[float],
    ) -> RiskDecision:
        """Executes all Layer 6 prop-firm and microstructure risk checks in sequence."""
        rejections = self.check_prop_firm_drawdown(
            current_equity, start_of_day_equity, high_water_mark_equity
        )

        spread_ok, spread_pct = self.check_bid_ask_spread(bid, ask)
        if not spread_ok:
            rejections.append(
                f"SPREAD_GUARD_REJECTED: bid-ask spread {spread_pct:.5%} exceeds "
                f"strict {self.limits.max_bid_ask_spread_pct:.2%} limit."
            )

        corr_ok, max_corr = self.check_correlation_guard(active_correlations)
        if not corr_ok:
            rejections.append(
                f"CORRELATION_GUARD_REJECTED: max |rho|={max_corr:.2f} exceeds "
                f"{self.limits.max_pairwise_correlation:.2f} cap."
            )

        mid_price = 0.5 * (bid + ask) if bid > 0 and ask >= bid else 0.0
        atr_mult, stop_price = self.compute_regime_trailing_stop(
            entry_price=mid_price, atr=atr, side=side, regime=regime
        )

        weights = self.compute_inverse_variance_weights(all_families)
        family_weight = weights.get(strategy_family.family_name.upper(), 1.0 / 3.0)

        risk_frac, sizing_mode = self.compute_risk_fraction(
            sharpe_ratio=strategy_family.oos_sharpe,
            win_rate=strategy_family.win_rate,
            payoff_ratio=strategy_family.payoff_ratio,
        )

        if rejections or mid_price <= 0:
            return RiskDecision(
                approved=False,
                rejection_reasons=rejections or ["Invalid mid price."],
                sizing_mode=sizing_mode,
                risk_fraction_of_equity=0.0,
                position_notional_usd=0.0,
                position_units=0.0,
                trailing_stop_atr_mult=atr_mult,
                trailing_stop_price=stop_price,
                bid_ask_spread_pct=spread_pct,
                family_weight=family_weight,
            )

        # Dynamic ATR-based sizing scaled by inverse-variance family weight
        risk_budget_usd = current_equity * risk_frac * family_weight
        stop_distance_per_unit = max(abs(mid_price - stop_price), mid_price * 0.001)
        units = risk_budget_usd / stop_distance_per_unit
        notional = min(units * mid_price, current_equity * family_weight)
        final_units = notional / mid_price

        return RiskDecision(
            approved=True,
            rejection_reasons=[],
            sizing_mode=sizing_mode,
            risk_fraction_of_equity=risk_frac,
            position_notional_usd=round(notional, 2),
            position_units=round(final_units, 6),
            trailing_stop_atr_mult=atr_mult,
            trailing_stop_price=round(stop_price, 6),
            bid_ask_spread_pct=spread_pct,
            family_weight=round(family_weight, 4),
        )

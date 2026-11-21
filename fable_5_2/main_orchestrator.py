#!/usr/bin/env python3
"""
Signal Forge — Fable 5.2 Lead Orchestrator (Unified 8-Layer Self-Improving Trading System)
==========================================================================================
Consolidates all 8 architectural layers with zero redundant code by delegating
risk, validation/Black-Scholes, and observability to modular subpackages:

  Layer 1 : Multi-Source Market Data Ingestion & Point-in-Time Feature Engineering
  Layer 2 : Regime Identification Agent (High Volatility vs Quiet) & Hypothesis Agent
  Layer 3 : Claude-Powered Strategy Conversion Agent (Anthropic API env-driven)
  Layer 4 : 4-Gate Validation Engine (IS, OOS Stress, WFA, Black-Scholes Tail-Risk)
  Layer 5 : Self-Improvement Loop (Phase 5 single-parameter mutation; V2 displaces V1
            only on identical OOS data with higher Sharpe AND lower Max Drawdown)
  Layer 6 : Prop Firm Risk Manager (Daily loss, Max DD, Half-Kelly when Sharpe > 1.5,
            2.5x/1.5x ATR stops, <= 0.02% spread check, correlation guard, inverse variance)
  Layer 7 : Controlled Paper Trading Pipeline + Mandatory Human Approval Gate for Live
  Layer 8 : Strategic Memory SQLite Provenance + Streamlit & Discord Observability
"""

from __future__ import annotations

import hmac
import json
import math
import os
import secrets
import urllib.request
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from backtest.validator import (
    BlackScholesModel,
    FourGateValidator,
    OptionContract,
    StrategyCandidate,
    ValidationReport,
)
from monitoring.dashboard import DiscordReporter, StrategicMemoryStore
from risk.risk_manager import (
    PropFirmLimits,
    RiskDecision,
    RiskManager,
    StrategyFamilyMetrics,
    VolatilityRegime,
)


# ==============================================================================
# LAYER 1: Multi-Source Market Data Ingestion & Feature Engineering
# ==============================================================================
@dataclass(frozen=True)
class MarketFeatures:
    """Strictly causal point-in-time feature vector derived from historical bars."""

    symbol: str
    spot_price: float
    bid: float
    ask: float
    atr_14: float
    annualized_volatility: float
    momentum_20: float
    zscore_20: float


def compute_layer1_features(
    symbol: str,
    closes: Sequence[float],
    bid: float,
    ask: float,
) -> MarketFeatures:
    """Computes ATR-14 proxy, annualized realized volatility, momentum, and z-score causally."""
    if len(closes) < 21:
        raise ValueError("Layer 1 requires at least 21 historical bars for causal features.")

    spot = float(closes[-1])
    abs_changes = [abs(closes[i] - closes[i - 1]) for i in range(-14, 0)]
    atr_14 = sum(abs_changes) / len(abs_changes)

    log_rets = [math.log(closes[i] / closes[i - 1]) for i in range(-20, 0)]
    mean_ret = sum(log_rets) / len(log_rets)
    var_ret = sum((r - mean_ret) ** 2 for r in log_rets) / max(len(log_rets) - 1, 1)
    ann_vol = math.sqrt(max(var_ret, 1e-12) * 252.0)

    window_20 = closes[-20:]
    mean_p = sum(window_20) / len(window_20)
    std_p = math.sqrt(sum((p - mean_p) ** 2 for p in window_20) / max(len(window_20) - 1, 1))
    zscore = (spot - mean_p) / max(std_p, 1e-9)
    momentum = (spot / closes[-21]) - 1.0

    return MarketFeatures(
        symbol=symbol,
        spot_price=spot,
        bid=bid,
        ask=ask,
        atr_14=round(atr_14, 6),
        annualized_volatility=round(ann_vol, 6),
        momentum_20=round(momentum, 6),
        zscore_20=round(zscore, 4),
    )


# ==============================================================================
# LAYERS 2 & 3: Regime Identification, Hypothesis Agent & Claude Strategy Converter
# ==============================================================================
class RegimeAndHypothesisAgent:
    """Layer 2: Identifies volatility regime and proposes single-parameter research hypotheses."""

    def identify_regime(self, features: MarketFeatures, high_vol_threshold: float = 0.45) -> VolatilityRegime:
        return (
            VolatilityRegime.HIGH_VOLATILITY
            if features.annualized_volatility >= high_vol_threshold
            else VolatilityRegime.QUIET
        )

    def propose_single_param_mutation(
        self,
        incumbent: StrategyCandidate,
        cycle_index: int,
    ) -> Tuple[StrategyCandidate, str]:
        """
        Phase 5 Evolution Rule: Applies EXACTLY ONE parameter mutation per cycle so
        OOS attribution remains causally isolated without overfitting.
        """
        mutated_params = dict(incumbent.params)
        mutation_plan = [
            ("lookback", max(8.0, incumbent.params.get("lookback", 20.0) + 4.0)),
            ("entry_zscore", round(max(0.6, incumbent.params.get("entry_zscore", 1.2) - 0.15), 2)),
            ("stop_atr_mult", round(incumbent.params.get("stop_atr_mult", 1.5) + 0.25, 2)),
        ]
        param_name, new_val = mutation_plan[cycle_index % len(mutation_plan)]
        mutated_params[param_name] = new_val
        next_version = f"{incumbent.version_id.split('-v')[0]}-v{cycle_index + 2}"
        candidate = StrategyCandidate(
            version_id=next_version,
            family=incumbent.family,
            params=mutated_params,
            parent_version_id=incumbent.version_id,
        )
        hypothesis = (
            f"Single-parameter Phase 5 mutation on {param_name}: "
            f"{incumbent.params.get(param_name)} -> {new_val}"
        )
        return candidate, hypothesis


class ClaudeStrategyConverter:
    """Layer 3: Converts natural-language research hypotheses into versioned strategy specs."""

    def __init__(self) -> None:
        self.api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
        self.model = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest")

    def compile_strategy_spec(self, hypothesis: str, candidate: StrategyCandidate) -> Dict[str, Any]:
        """Uses Anthropic Messages API when ANTHROPIC_API_KEY is configured; otherwise deterministic spec."""
        if not self.api_key:
            return {
                "compiler": "DETERMINISTIC_LOCAL_FALLBACK",
                "hypothesis": hypothesis,
                "candidate": asdict(candidate),
            }

        body = {
            "model": self.model,
            "max_tokens": 300,
            "messages": [
                {
                    "role": "user",
                    "content": (
                        f"Convert this quantitative hypothesis into a concise JSON strategy spec: "
                        f"{hypothesis}. Candidate params: {json.dumps(candidate.params)}"
                    ),
                }
            ],
        }
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return {"compiler": self.model, "response": json.loads(resp.read().decode("utf-8"))}


# ==============================================================================
# LAYER 7: Controlled Paper Trading Pipeline & Mandatory Human Live Approval Gate
# ==============================================================================
@dataclass
class DeploymentTicket:
    """Tracks a validated strategy from Paper Trading to Human-Approved Live Deployment."""

    version_id: str
    stage: str  # "PAPER_TRADING" | "LIVE_APPROVED"
    approval_token: str
    approved_by: Optional[str] = None


class PaperToLivePipeline:
    """Layer 7: Enforces paper staging and timing-safe human approval before live deployment."""

    def __init__(self) -> None:
        self.tickets: Dict[str, DeploymentTicket] = {}

    def stage_in_paper_trading(self, version_id: str) -> DeploymentTicket:
        ticket = DeploymentTicket(
            version_id=version_id,
            stage="PAPER_TRADING",
            approval_token=secrets.token_hex(16),
        )
        self.tickets[version_id] = ticket
        return ticket

    def approve_for_live(self, version_id: str, provided_token: str, operator_name: str) -> bool:
        """Mandatory human sign-off verified via constant-time token comparison."""
        ticket = self.tickets.get(version_id)
        if not ticket or ticket.stage != "PAPER_TRADING":
            return False
        if not hmac.compare_digest(ticket.approval_token, provided_token):
            return False
        ticket.stage = "LIVE_APPROVED"
        ticket.approved_by = operator_name
        return True


# ==============================================================================
# UNIFIED 8-LAYER FABLE 5.2 ORCHESTRATOR
# ==============================================================================
class Fable52Orchestrator:
    """Top-level Lead Orchestrator coordinating Layers 1 through 8 without duplicate logic."""

    def __init__(self, memory_db_path: str = "fable_strategic_memory.db") -> None:
        self.regime_agent = RegimeAndHypothesisAgent()
        self.strategy_converter = ClaudeStrategyConverter()
        self.bs_model = BlackScholesModel()
        self.validator = FourGateValidator(self.bs_model)
        self.risk_manager = RiskManager(PropFirmLimits())
        self.deployment_pipeline = PaperToLivePipeline()
        self.memory = StrategicMemoryStore(memory_db_path)
        self.discord = DiscordReporter()

    def run_cycle(
        self,
        *,
        symbol: str,
        in_sample_prices: Sequence[float],
        out_of_sample_prices: Sequence[float],
        bid: float,
        ask: float,
        incumbent_v1: StrategyCandidate,
        families: List[StrategyFamilyMetrics],
        active_correlations: Sequence[float],
        current_equity: float,
        start_of_day_equity: float,
        high_water_mark_equity: float,
        cycle_index: int = 0,
    ) -> Dict[str, Any]:
        """Executes a complete 8-layer research, validation, risk parity, and observability cycle."""
        # Layer 1: Causal features
        features = compute_layer1_features(symbol, out_of_sample_prices, bid, ask)

        # Layer 2 & 3: Regime classification, single-parameter hypothesis & strategy compilation
        regime = self.regime_agent.identify_regime(features)
        candidate_v2, hypothesis = self.regime_agent.propose_single_param_mutation(
            incumbent_v1, cycle_index
        )
        compiled_spec = self.strategy_converter.compile_strategy_spec(hypothesis, candidate_v2)

        # Layer 4 & 5: 4-Gate Validation + Black-Scholes derivative tail-risk check
        atm_hedge = OptionContract(
            symbol=f"{symbol}-30D-ATM-PUT",
            option_type="PUT",
            spot_price=features.spot_price,
            strike_price=features.spot_price,
            time_to_expiry_years=30.0 / 365.0,
            risk_free_rate=0.045,
            volatility=max(features.annualized_volatility, 0.20),
        )
        validation: ValidationReport = self.validator.validate_candidate_evolution(
            incumbent_v1=incumbent_v1,
            candidate_v2=candidate_v2,
            in_sample_prices=in_sample_prices,
            out_of_sample_prices=out_of_sample_prices,
            option_contract=atm_hedge,
        )

        active_version = candidate_v2 if validation.promoted_v2_over_v1 else incumbent_v1
        active_perf = validation.v2_oos if validation.promoted_v2_over_v1 else validation.v1_oos

        # Layer 6: Prop Firm Risk Manager (Half-Kelly, Regime ATR Stop, 0.02% Spread, Inverse Variance)
        active_family_metric = StrategyFamilyMetrics(
            family_name=active_version.family,
            annualized_volatility=max(features.annualized_volatility, 0.15),
            oos_sharpe=active_perf.sharpe_ratio,
            win_rate=active_perf.win_rate,
            payoff_ratio=active_perf.payoff_ratio,
        )
        risk_decision: RiskDecision = self.risk_manager.evaluate_pre_trade(
            side="BUY",
            bid=bid,
            ask=ask,
            atr=features.atr_14,
            regime=regime,
            current_equity=current_equity,
            start_of_day_equity=start_of_day_equity,
            high_water_mark_equity=high_water_mark_equity,
            strategy_family=active_family_metric,
            all_families=families,
            active_correlations=active_correlations,
        )
        family_weights = self.risk_manager.compute_inverse_variance_weights(families)

        # Layer 7: Stage validated promotion into Paper Trading (Live requires human sign-off)
        ticket = self.deployment_pipeline.stage_in_paper_trading(active_version.version_id)

        # Layer 8: Persist provenance to Strategic Memory DB & dispatch Discord summary
        self.memory.log_event(
            layer="LAYER_5_VALIDATION",
            event_type="VERSION_PROMOTED" if validation.promoted_v2_over_v1 else "V2_REJECTED",
            version_id=active_version.version_id,
            oos_sharpe=active_perf.sharpe_ratio,
            oos_max_drawdown=active_perf.max_drawdown_pct,
            payload={
                "hypothesis": hypothesis,
                "mutated_parameters": validation.mutated_parameters,
                "wfa_efficiency": validation.wfa_efficiency_ratio,
                "risk_approved": risk_decision.approved,
                "sizing_mode": risk_decision.sizing_mode,
                "family_weights": family_weights,
                "deployment_stage": ticket.stage,
            },
        )
        discord_status = self.discord.send_report(
            title=f"Fable 5.2 Cycle #{cycle_index + 1} · {symbol}",
            fields={
                "Active Version": active_version.version_id,
                "Regime": regime.value,
                "OOS Sharpe": active_perf.sharpe_ratio,
                "OOS Max DD": f"{active_perf.max_drawdown_pct:.2%}",
                "Sizing Mode": risk_decision.sizing_mode,
                "Deployment": ticket.stage,
            },
        )

        return {
            "layer1_features": asdict(features),
            "layer2_regime": regime.value,
            "layer3_spec_compiler": compiled_spec.get("compiler"),
            "layer4_5_validation": asdict(validation),
            "layer6_risk_decision": asdict(risk_decision),
            "layer6_inverse_variance_weights": family_weights,
            "layer7_deployment_stage": ticket.stage,
            "layer8_discord": discord_status,
        }


if __name__ == "__main__":
    # Deterministic demonstration series (zero randomness, reproducible provenance)
    base_series = [
        100.0 * math.exp(0.0007 * i + 0.015 * math.sin(i / 4.5))
        for i in range(180)
    ]
    is_slice = base_series[:110]
    oos_slice = base_series[110:]
    spot = oos_slice[-1]

    orchestrator = Fable52Orchestrator(memory_db_path=":memory:")
    v1 = StrategyCandidate(
        version_id="momentum-v1",
        family="MOMENTUM",
        params={"lookback": 20.0, "entry_zscore": 1.2, "stop_atr_mult": 1.5},
    )
    family_profiles = [
        StrategyFamilyMetrics("BREAKOUT", 0.32, 1.45, 0.52, 1.9),
        StrategyFamilyMetrics("MEAN_REVERSION", 0.18, 1.72, 0.61, 1.4),
        StrategyFamilyMetrics("MOMENTUM", 0.24, 1.85, 0.56, 2.1),
    ]
    summary = orchestrator.run_cycle(
        symbol="BTCUSDT",
        in_sample_prices=is_slice,
        out_of_sample_prices=oos_slice,
        bid=spot * 0.99995,
        ask=spot * 1.00005,  # 0.01% spread (< 0.02% threshold)
        incumbent_v1=v1,
        families=family_profiles,
        active_correlations=[0.22, -0.14],
        current_equity=100_000.0,
        start_of_day_equity=100_000.0,
        high_water_mark_equity=100_000.0,
    )
    print(json.dumps(summary, indent=2))

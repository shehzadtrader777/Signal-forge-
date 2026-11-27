# Signal Forge — Module Performance Audit & Improvement Gate

**Audit scope:** Source review, 27 Nov 2026. No production/live trading changes. Historical results and external exchange data are not attached to this audit.

## Source findings
- `src/lib/modularBacktestEngine.ts` defines four strategy IDs: `AUTONOMOUS_MASTER`, `SMC_1_5`, `PATTERN_SCANNER`, `PRE_PUMP_SUPPORT`. Its deterministic matrix uses preset `STRATEGY_PRIORS` (base win-edge probability, volatility sensitivity, trend gain, seed offsets). These are **simulation assumptions, not measured real-market success rates**.
- The matrix measures estimated return, win rate, profit factor, expectancy, Sharpe, Sortino, Calmar, and maximum drawdown with fee/slippage parameters. The output cannot be cited as validated profitability.
- `src/pages/Backtesting.tsx` also supports 30/60/90-day research views using a different pipeline. These windows and a 100/250/500/1000-trade matrix **must not be presented as interchangeable methodologies**.
- `src/lib/smcAgent.ts` includes structure/CHoCH/BOS, liquidity sweeps, FRVP, order blocks and session-aware filtering. Higher apparent SMC results require a like-for-like test with matching data, dates, costs, markets, capital and exposure before trusting the ranking.
- User-reported 0%/1%/2% figures cannot be confirmed as return, win-rate, or another measure without the actual result export.

## Improvement plan (without curve fitting)
1. **Data integrity:** Record each run's source exchange, instrument, spot/futures market, candle timezone/timeframe, start/end timestamps, missing bars, survivorship-selection rule and fee/slippage schedule. Flag cached/synthetic data.
2. **Comparable benchmark:** Run all strategies over the **same** historical timestamps, pairs, risk per trade, portfolio capital, fee/slippage, funding, spreads and number of opportunities. Do not compare winners on different datasets.
3. **Research gates:** Require sufficient non-overlapping closed trades, no future-data leakage, walk-forward and untouched out-of-sample windows, alternate market regimes and parameter sensitivity.
4. **SMC:** Evaluate BOS/CHoCH confirmation timing, liquidity sweep validity, false breaks, order-block retests, volume node filters, session and volatility regimes. Test each change separately (ablation).
5. **Pattern Scanner:** Check candle-close confirmation, volume threshold sensitivity, fake-breakout filtering, ATR stop placement and low-liquidity conditions.
6. **AI Master:** Examine disagreement/veto logic, feature leakage, calibration vs observed outcomes, stale provider data and cross-agent correlation.
7. **Pre-Pump:** Check illiquidity, look-ahead bias, manipulative spikes, funding, order-book data gaps and slippage under stress.
8. **Promotion policy:** Keep candidate changes in paper mode until independent data, drawdown/risk ceilings, live-like spreads and adverse regimes pass; record both positive and negative studies. Preserve baseline for rollback.
9. **User communication:** Show net return after costs, sample size, profit factor, max drawdown, timeframe, data-source badge and explicit *simulation vs historical vs paper* label. Never promise guaranteed or “highly profitable” signals.
10. **Tier quality:** Subscription levels may change volume, timeliness, tooling and analytics depth, but never relax safety/veto standards or hide risk information from free users.

## Minimum module evaluation record
`runId`, `moduleId`, `strategyVersion`, `datasetId`, `market`, `startUtc`, `endUtc`, `sampleCount`, `wins`, `netReturnPct`, `profitFactor`, `maxDrawdownPct`, `feesPaid`, `slippageModel`, `outOfSample`, `sourceType` (`SYNTHETIC`/`HISTORICAL`/`PAPER`), `promotionStatus` (`RESEARCH`/`REVIEW`/`APPROVED_PAPER`), `notes`.

### Decision
**No module ranking or capital allocation change is supported yet.** Next step is to compare real run exports using matched data and report evidence and uncertainty, then test specific candidate improvements individually. The existing safety checks and live execution controls must remain unchanged.

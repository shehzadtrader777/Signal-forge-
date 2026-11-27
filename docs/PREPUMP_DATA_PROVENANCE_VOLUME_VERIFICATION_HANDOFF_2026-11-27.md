# Signal Forge — Pre-Pump Source Audit and Early-Volume Verification Handoff
Date: 2026-11-27
Status: Development safety checkpoint. NOT approved for production execution.

## Observed source code (not independent live provider verification)
1. server.ts pollBinanceTopGainers() reads Binance public 24h ticker endpoint `https://api.binance.com/api/v3/ticker/24hr`; filters USDT spot, positive price changes, USDT quote volume and ranks roughly ten. If unavailable it may use `buildFallbackTopGainers()` scanner cache. This is a **top-gainer/momentum** scanner, not proven pre-pump discovery.
2. server.ts computePrePumpMetrics() estimates volume anomaly by dividing 24h quote volume by a fixed $45M baseline; it does NOT compare rolling historical 5m/15m volume per asset. Label estimated, do not treat as verified market inflow.
3. src/lib/signals.ts also computes recent six-candle / preceding 20-candle volume anomaly; source candles and their completeness must be checked before confidence can be verified.
4. src/lib/orderBookDepth.ts `buildAnchoredExchangeBook()` can SYNTHESIZE L2 order books based on live price, momentum and volume if external data unavailable. Such a book is not independent exchange order-book evidence. Visible bid walls can be spoofed and are not proof of spot accumulation.
5. src/lib/multiAgentTradingArchitecture.ts `evaluatePredictivePrePumpLifecycle()` uses volume spike ratio, order-book imbalance, sentiment and on-chain accumulation scores. Inputs must carry provider/timestamp/source provenance before being considered independently verified.
6. src/lib/executionPipeline.ts used to derive `autoExecuteEligible` from a price-near-support rule plus estimated pre-pump score. That is inadequate evidence for automated buys. Development change forces this field false for unverified ticker candidates.
7. CoinGecko, CMC, CryptoPanic, Bybit, OKX, on-chain and news may enrich the product, but provider keys being present does NOT mean that live on-chain fund flow or reliable net deposits are integrated.

## Operational meanings that MUST stay distinct
- `quoteVolumeUsd5m`: amount traded within 5 minutes (not new net capital entering a coin).
- `takerBuyVolume - takerSellVolume`: aggressive trade-flow imbalance, not on-chain exchange net inflow.
- `exchange inflow/outflow`: observed on-chain transfers labeled to exchange wallets; can lag, be mislabeled and may not represent executed trades.
- `orderbook imbalance`: displayed resting orders that may be canceled/spoofed.
- `relative volume`: recent volume divided by same-asset comparable historical windows, preferably segmented by time-of-day and exchange.
- 20x/100x/200x gains: extreme outliers; no reliable system can promise to identify them before a pump or guarantee return.

## Committed conservative evidence gate
`src/lib/earlyVolumeEvidenceGate.ts` + tests:
- Timestamp <=30s, measured exchange trades/candles, >=20 historical 5m baseline windows, >=2 independent exchange confirmations.
- Spread <=35 bps; executable orderbook depth >=$50k, estimated round-trip slippage <=40 bps; reject delisting, active halt or security incident.
- Actual taker buy and sell volumes required; measured relative volume >=1.8x and net aggressive buy >0 for candidate.
- Reject extreme recent 5m move >12% to avoid late chase.
- Spot candidate is research/paper only. Futures candidate additionally requires verified contract and funding within illustrative conservative bounds, and is research/paper only; never authorizes live order.
- All thresholds are preliminary research defaults; calibrate by liquidity tier and historical false positives, never imply universally optimal levels.
- `PrePumpSupportExecutionModule` auto-execution eligibility now false for ticker-only/pre-pump-score-only signals; do not bypass elsewhere.

## Next necessary integrations before useful early alerts
1. Ingest exchange historical 5m candles + public aggregated trades/aggTrades across eligible venues; compute per-coin rolling median/robust z-score and volume surge features; historical coverage timestamps and missing bars must be explicit.
2. Live exchange L2 books with sequence validation, spread/executable-depth and spoof-resistant persistence checks. Never count anchored/synthetic book as second venue.
3. Classify flow separately: buy/sell aggressor tape, on-chain exchange transfers (source indexer/address labels), derivatives open interest and funding, and news/listing/delisting alerts. Never invent unavailable observations.
4. Run independent confirmations with event-time alignment and duplicates suppressed; rank `WATCH`, `PAPER_SPOT_CANDIDATE`, `PAPER_FUTURES_RESEARCH`, `REJECT`. Include observed timestamps and provenance badges.
5. Paper/shadow evaluate pre-alert lead time, precision/recall, false pump rate, spread cost, max drawdown, stop gaps, realized fill simulation, delisting and rug risk, across different market regimes. Historical optimizer projections are not live P&L.
6. Before any unattended trading: owner approval, small position limits, instrument allowlist, hard halt persisted across restarts, max loss/day, risk per trade, slippage and exchange protection, TESTNET validation and independent review. In current checkpoint there is NO autonomous live buy.
7. For Spot 'hold' do not force hold-to-max-target over hard stops, security lock, crash or liquidity collapse. For Futures default to disabled; contract and liquidation/margin risks require separate gate.
8. AI Studio sync must diff current source against GitHub branch; do not overwrite data flows or migrate secrets via repository.

## Review status
No production rollout. GitHub CI pending verification. Research-only validation is NOT proven to outperform the market.

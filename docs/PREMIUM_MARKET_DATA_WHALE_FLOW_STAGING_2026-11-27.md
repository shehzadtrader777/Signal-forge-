# Signal Forge — Verified Signal Tiers, Real Volume, Market Sources and Whale Integrity
Date: 2026-11-27
Branch: feature/ai-studio-source-migration
Status: staged code, not deployed to Google AI Studio, no live trading enabled.

## User-approved product direction
- FREE: public market watch and basic read-only telemetry.
- PRO: separately verified higher-quality momentum opportunities (no guaranteed returns).
- PREMIUM_INSTITUTIONAL: existing backend entitlement mapped provisionally to a marketing Ultimate/Pro-Premium concept; do not rename/migrate subscription records without owner approval.
- Ultimate research: verified pre-pump, verified on-chain whale activity and futures research only after source provenance. Never paywall a safety halt.
- All signals: rank, de-duplicate, show source, timestamp, confidence calibration, data completeness, independent confirmation, and separate suggested paper action from authorized trade.
- Owner tests through historical, paper, demo/testnet, and staging before any individually approved live execution.

## Source audit
- Binance top-gainer poll uses /api/v3/ticker/24hr, real public quote-volume but insufficient for verified pre-pump.
- computePrePumpMetrics used fixed $45M baseline as estimated volume anomaly; not actual per-coin relative volume.
- src/lib/signals.ts has candle-relative volume logic, dependent on input provenance.
- orderBookDepth.ts includes synthetic ws_anchored_book fallback; cannot be regarded as real independent L2 depth.
- CRITICAL FIX: server.ts fetchMarketIntelligence previously INVENTED on-chain whale flows using CMC trading volume and generated labeled whale transfers from changePct. Fixed to return no whale transfers and no netflow without a verified on-chain data source. CMC price, market cap and volume are retained as contextual metrics. Frontend must display 'Whale flow not verified' rather than zero as a measured flow.
- CMC and CoinGecko are research/valuation aggregators, not execution price sources. Gemini is reasoning only and must never synthesize tick, trade, wallet or spread evidence.
- Runtime diagnostics previously reported Gemini, Bybit and CMC key presence but CMC upstream unavailable, CoinGecko pending verification and OKX missing. Live providers not independently tested here.

## Changes staged
- src/lib/trustedMarketSourceArbiter.ts + tests: source provenance/freshness, separate chart/research quote from execution. This is a pure decision module not yet wired to every live chart.
- src/lib/signalTierPolicy.ts + tests: independent verification required for research tier visibility; existing backend tier remains authoritative and live trading never granted by subscription access. Policy is not yet enforcing all server signal endpoints.
- src/lib/realVolumeCandles.ts + tests: read CLOSED Binance/Bybit five-minute candle quote volume and calculate per-symbol relative volume using 20–50 contiguous historical windows. Binance taker-buy quote volume measured; Bybit's Kline lacks aggressor split, so left null.
- server.ts adds GET /api/research/early-volume/:symbol authenticated operator staging endpoint. Fetches Binance and Bybit PUBLIC spot klines, owner-only quota-bound, validates freshness and returns observed values, NOT a buy recommendation or trade. API fetch success not yet independently confirmed.
- server.ts stops fictional whale-flow and synthetic whale transactions in live CMC response; missing data is empty/explicitly unverified.
- server.ts dotenv override false, so older disk .env no longer overrides injected platform Secrets.
- src/lib/earlyVolumeEvidenceGate.ts previously committed: independent exchange, true taker flow, fresh L2 depth and risk checks required; research/paper candidate only.
- Existing ticker-score-only pre-pump support autoExecuteEligible was switched off pending real verification.

## Remaining production integrations
1. Server-only real-time Binance/Bybit/OKX public websocket trade and orderbook adapters, replay gaps, sequence-safe L2, dedupe, provider time alignment and durable data cache. Respect provider limits and licensing.
2. Add real read-only on-chain adapters with chain, transaction hash, confirmations, verified address labels, custody/exchange attribution uncertainty and source timestamp. No address-derived facts from LLM guesses.
3. Wire real 5m observations plus genuine L2, spread, slippage and cross-venue volume confirmation into the Pre-Pump engine. Research alert first, no automatic purchases.
4. Authenticate and enforce tier policy in each backend premium signal endpoint, with robust server pagination, redacted free tier preview and audit entitlements; 'Ultimate' plan definition pending owner product approval.
5. Refactor frontend wallet/whale panels: distinguish trading volume, buy/sell aggressive tape, exchange on-chain deposits and withdrawals, aggregated venue assets, simulated fallback. Data provenance badges mandatory.
6. Reconcile live chart candles without rewriting historical OHLC to fit last tick; each chart should cite chosen venue/market/timeframe and have stale/reconnecting indicators.
7. Gemini agent may summarize prevalidated structured observations with source IDs but cannot fabricate capital flows, confidence scores or tick prices. Cache agent interpretations by evidence hash with TTL/cost caps.
8. Backtest and shadow-test false positives and lookahead; 30/60/90-day comparison, walk-forward independent OOS, minimum paper evidence, fees, funding, liquidation cost and drawdown before owner review.
9. Persist 423 emergency-halt server lock across restarts/multi-instance; implement actual WebAuthn owner verification and fallback OTP before live activation. LIVE disabled throughout.
10. CI: run npm run verify, verify source-specific test suites, dependency scan and staged provider probes; verify on Android and desktop. Latest CI must explicitly pass before merge.
11. AI Studio: snapshot current project and compare exact files with GitHub branch; selectively apply reviewed diffs, run staging smoke tests, keep secrets exclusively in platform settings, no blind overwrite.

## Critical release limitation
No guarantee of discovering 20x/100x pump events or profitability. This checkpoint improves integrity and safety but is not a production certification.

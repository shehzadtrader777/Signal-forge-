# Signal Forge — Signal Lifecycle, Trade ID, Inspect Chart and Outstanding Gates
Date: 2026-11-27
Branch: feature/ai-studio-source-migration
Status: development staging; NOT certified for production, LIVE still locked

## User-required end-to-end flow
Signal detector -> source-validation -> owner/tier visibility -> immutable server signal event -> historical audit -> selected symbol backtest association -> research/paper/testnet entry -> exchange fill receipt (only when a genuine execution occurred) -> verified exchange trade ID -> inspection chart with timestamped market candles, entry, TP1/TP2/TP3, SL, actual fill/exit marker -> reports/outcomes.

## Implemented in this checkpoint
- src/components/SignalInspectChart.tsx: Signal History Chart button opens dialog rather than navigating home; expandable to nearly full viewport, timeframe selector, structured record summary, entry/SL/TP/exit or last-mark levels, historical exchange candles or explicit unavailable state. Signal timestamp vertical marker when present within fetched window.
- server.ts: /api/binance/klines accepts validated historical endTime for requested window; does NOT generate synthetic candles when requested historical data unavailable.
- src/pages/SignalHistory.tsx: observed-only records default, simulated benchmarks are opt-in; table shows internal record ID and honest verification status; Chart button sends selected record.
- src/lib/tradeAuditIdentity.ts + tests: distinguish simulator, pinned signal, execution-unverified. Internal ID or short hash is NOT exchange-verified and does not imply cryptographic attestations.
- Fixed strict TS errors found by workflow in backtestUniverse.ts, backtestUniverse.test.ts and emergencyHaltPresentation.test.ts; latest workflow must be checked before merge.
- Previously Backtesting shows locally observed pinned and execution audit separately from generated simulations, with expanded dynamic coin universe.

## Not yet complete — release blockers
1. **Every signal persisted to server:** add authenticated idempotent event-ingest after actual signal emission, durable transactional data store, per-user/tier authorization, strategy version, immutable entry/stop/TP ladder, all timestamps, input provider receipts, signal revisions and risk decisions. Current locally retained observed records are not an all-market complete archive.
2. **Verified exchange trade IDs:** server reconciles genuine exchange trade/order fill receipts via scoped read-only API against account ID, symbol, side, order ID, trade ID, timestamp, price, quantity, fees and execution environment; no credential values in browser. Sign server evidence and verify record hashes. Pinned or unexecuted signals have Signal ID only; backtests have Simulation ID only.
3. **Historical chart fidelity:** persist candles/book snapshots and actual fill/exit timestamps. Current chart shows timestamp-centered public Binance candles and signal price bands; exit price may be estimated mark and is NOT an execution point without actual fill receipt. Plot exact TP1/2/3 after saving them and actual fill markers with time.
4. **Full backtest correlation:** reproduce each emitted signal with point-in-time candles, source version, market regime, transaction costs, fills and no future leakage. Current 30/60/90d comparative protocols may use simulation; dynamic pair selection is not proof of full historical coverage.
5. **Safety:** durable server emergency 423 lock across restarts, passkey WebAuthn/owner OTP, proven order-router isolation. Do NOT enable unattended LIVE execution.
6. **Real provider integrations:** market WebSockets/L2, verified on-chain wallet movement tx data, Telegram/owner email sender, CoinMarketCap availability, Gemini grounded reasoning; no fabricated whale transfers.
7. **Entitlements:** enforce Premium/Ultimate signal fields server side, preserve Free/Pro and existing subscriptions.
8. **QA:** npm run verify, security and browser test, Android maximized chart behavior, historical data failure, trade receipt reconciliation, pagination, accessibility, fail-closed rollback.
9. **AI Studio sync:** after green CI and code review, back up AI Studio project and selectively merge branch changes. Never overwrite existing secrets; no production deployment until release review.

## Correct claim boundaries
- A generated internal `SF-TRD` identifier based on FNV hash is not an external exchange certification or secure cryptographic proof.
- A chart line labeled EXIT / MARK is a saved price, not guaranteed verified exchange fill or exact exit timestamp.
- Signal History observed-only mode reflects current client state, not necessarily all market signals ever produced.
- Staging checkpoint ≠ complete production rollout.

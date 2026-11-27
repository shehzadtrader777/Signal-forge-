# Signal Forge — Strategy Intelligence & Verifiable Signals

## Product requirements
1. **Strategy library:** Version strategies by source, original research attribution, timeframe, market, rule parameters, validation data, date coverage, observed limitations, and reviewer decision. Never claim ownership over third-party proprietary strategies or copy paid courses. A public YouTube strategy is an idea to research, not evidence of profit.
2. **Qualification pipeline:** Idea → historical data integrity → 30/60/90-day research (plus longer windows when available) → fees/slippage tests → out-of-sample and walk-forward evaluation → paper trading → risk review → approved research signal. Keep failed strategies and changes for audit, not only winners, to reduce survivorship bias.
3. **Agents/scanner:** Capture pattern name, market regime, candle timeframe, fakeout criteria, confidence calibration, risk/reward, stop distance and veto reasons. Existing pattern scanner and coordinated-agent architecture should be reused.
4. **Plans:** Suggested only, **not deployed pricing**. FREE: limited delayed educational research signals; PRO: additional research categories, faster updates and deeper filters; PREMIUM_INSTITUTIONAL: advanced analytics, multi-agent rationale and strategy comparisons. All tiers receive truthful risk status. Server-side entitlement gates must enforce limits, not just hidden UI.
5. **Manual sharing:** Every candidate can be copied as an explicitly unverified draft with entry, stop, targets, source and warning. Copying is permitted even if the Telegram/automation quota is exhausted, with appropriate server entitlement checks before publication.
6. **Verified ID:** Define a separate immutable published record ID issued by the server only after passing permissions, validation and persistence. Use a namespace such as `SF-SIG-<opaque random ID>` for signal publication and `SF-TRD-<opaque random ID>` only for an actual recorded trade. Do not present research setup IDs as verified trade IDs.
7. **Public verifier:** Implement server-backed `/verify/<id>` with canonical record and status (PUBLISHED / UPDATED / EXPIRED / CANCELLED / CLOSED), issued timestamp, source strategy version and signed/hash-backed audit record. Never leak subscriber identity, private notes, API keys, or exchange orders. Verification proves the record's authenticity, **not that the signal was profitable**.
8. **Edit history:** Publication snapshot immutable; corrections append revisions linked to the original ID. Show entry timestamp, disclosure of simulated vs real activity, and later outcomes without hindsight edits.
9. **Abuse controls:** Rate limiting, no public enumeration of private IDs, verified timestamps, anti-replay, no fake win-rate labels, audit access controls.
10. **Release safety:** No changes to execution routes or live-trading permissions without separate approval. Test plan quotas, identity authorization, cancellation, duplicate record handling, no-data states, and mobile accessibility.

## Current incremental implementation
A **manual research setup copy formatter** and a Signals page Copy button are being added to the development branch. This is not the persistent publication service or a public verifier. No signal may be called verified until the server-side ID and history system have passed testing.

## Evaluation policy
Do not label a strategy “highly profitable” purely from backtests, social media, or a high internal confidence score. Report sample size, fees, volatility, maximum drawdown, out-of-sample performance and statistical uncertainty.

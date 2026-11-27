# Trading Modes & Results Comparison — Draft Specification (27 Nov 2026)

Status: DESIGN / DEVELOPMENT ONLY. No live trading activation, no publication.

## Existing export findings
- `src/components/ExchangeControlCenter.tsx` currently models `globalExecutionMode: 'TESTNET' | 'LIVE'` and a switch to Testnet.
- `src/components/LiveSwitchSecurityModal.tsx` includes a security challenge / OTP path for Live switching.
- `src/components/LiveTestnetLedger.tsx` uses the unified capital ledger. These observations do not establish complete protection, working exchange integration, or accurate live execution.

## Target modes
1. **PAPER** — Internal simulated fills with no exchange order submission and no exchange API key requirement. Clearly label prices, fees, spread, latency, slippage and fill model assumptions.
2. **DEMO / TESTNET** — Exchange sandbox where supported; dedicated sandbox endpoints and keys, exchange-generated fills and rejects; never mix with real balances.
3. **LIVE** — Real-exchange orders, with a trusted server execution permission gate, separate live keys and signed-in user role checks. Disabled by default; no live orders until independent release approval.

## Guardrails
- Default to PAPER for new users and after unsafe/unrecognized configuration. Switching **from LIVE** must disable new live orders immediately, cancel pending work where safe, and explicitly address already-open positions and pending exchange orders; a mode switch cannot undo a filled live trade.
- Switching **to LIVE** requires a fresh high-assurance challenge plus account-level authorization, server-side global kill switch, deployment release gate and user confirmation displaying exchange, account, estimated exposure and active orders. Client UI state must never authorize real orders.
- Bind each order and ledger entry to an immutable `mode`, `exchange`, `accountId`, `strategyVersion`, `signalId`, and timestamp, plus source/test run ID. Never convert or merge a PAPER/DEMO order into a LIVE order.
- Isolate FIRESTORE paths/collections and access rules for each mode. No client-authoritative modification of settled PnL, fees, fills or vault balances.
- Idempotency keys and server-side deduplication prevent duplicate submission on retries and reconnects. Enforce limits per mode, per user and per exchange.
- Store API credentials server-side only; demo and live keys are distinct and never exposed to the browser.

## Comparable analytics
- Use identical signal snapshots and evaluation windows where possible; store feed timestamps and data quality.
- Compare trade count, win rate, realized/unrealized net PnL, return %, max drawdown, fees, slippage, rejection rate, avg fill latency, exposure, and missed fills.
- Display results as three separate columns: PAPER / DEMO(TESTNET) / LIVE. If live has not been enabled, show `Not run`, never simulated live results.
- Flag non-equivalent data sources, market regimes, trading size, fee tiers and latency. No claim that Paper/Testnet PnL predicts Live PnL.

## Acceptance tests before any LIVE release
- PAPER mode generates zero outbound order requests.
- DEMO mode routes only to sandbox endpoints; accidental production endpoint use is rejected.
- LIVE mode rejects all orders if disabled, unapproved, unauthorized, challenge-expired, duplicate or risk-limited; unit and integration tests prove it.
- Switch-down disables new real orders, reconciles open positions/exchange orders, and preserves immutable audit trails.
- Reports never blend trades from distinct modes; financial records are server-authoritative.
- Preview testing uses mocks, emulators and sandbox credentials only.

## Implementation sequence
Import and review latest source in the migration branch; create explicit three-mode domain types & event schema; server-side hard lock; mode-isolated ledger; UI switch and comparison panel; negative tests; then draft PR review. Current document is a specification, not an implemented feature.

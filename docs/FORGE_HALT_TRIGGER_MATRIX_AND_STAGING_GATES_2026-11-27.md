# Signal Forge — Halt Trigger Matrix & Readiness (2026-11-27)

This is a staged security checkpoint, NOT production authorization.

## Confirmed existing logic
- Portfolio drawdown hard stop: configurable 10–15%; default 12.5% from src/lib/forgeCapitalHub.ts. Do not increase cap to conceal losses.
- Module drawdown isolation: dynamic 3–5% ranges; currently suspended modules require separate review before resuming.
- 423 global halt is triggered from capital reconciliation when portfolio drawdown crosses configured cap, or manually by operator.
- Order router already rejects requests while failSafe.engaged or allTradingHalted.
- Historical recovery method re-anchors high-water mark and reactivates all modules; review this before allowing any live recovery.
- SERVER STATE IS IN MEMORY. A restart could lose an engaged latch: MUST implement durable atomic event + startup fail-closed checks across all order routes before launch.
- Reported missing OPERATOR_API_TOKEN and SESSION_SIGNING_KEY require code-level review; existing operator session fallback is process-random, so multi-replica persistence is not guaranteed.

## New staged work
- src/lib/forgeSafetyRecoveryPolicy.ts classifies TECHNICAL_PAUSE vs MODULE_ISOLATION vs OWNER_LOCKED_HALT and requires 3 independent healthy checks across >= 60 seconds for automatic resume *eligibility*.
- This is a pure function, not yet wired to live server orchestration; no automatic trading resume has been enabled.
- src/components/ForgeHaltServerStatus.tsx polls authenticated halt status every 10 seconds and on focus/visibility; client label says 'unverified' if unreachable.
- server.ts adds authenticated no-store halt status endpoint; denies recovery if email delivery fails; no recovery code logging; challenges tied to currently active seal; removes static bypass secret.
- Halt engage is not gated by a paid subscription. A server failure or unauthorized request is not considered a confirmed halt.
- Critical triggers always require owner reauthentication; fingerprint/passkey WebAuthn or OTP are not yet wired.

## Classification and fail-closed recovery policy
| Trigger | Containment | Automatic restore? |
|---|---|---|
| Timeouts, rate limiting, temporary feed loss, stale cache | Pause affected service/route, invalidate stale decisions | Only with authenticated upstream, fresh data, clean reconciliation, verified rollback integrity, 3 consecutive checks AND >=60 seconds stable |
| Failed API authentication / revoked API key | Owner-locked | No |
| Broken rollback integrity / non-verified deployment | Owner-locked | No |
| Module loss limit | Suspend affected module | No automatic restoration pending risk review |
| Portfolio hard drawdown, market crash | Global 423 | No |
| Suspicious sessions, account takeover, unauthorized withdrawals, risk-policy tamper, credential compromise | Global 423 and account isolation | No |
| Unknown or ambiguous severity | Global 423 / fail closed | No |

## Before Google AI Studio merge or production
1. Implement durable server emergency latch across restarts, multi-instance replicas and independently authenticated order gateways; prove all routes 423 while halted.
2. Replace optimistic reset semantics with two-step challenge -> verification -> recovered-but-execution-locked state, with separate owner approval and risk checks per module; do not automatically clear drawdown history.
3. Implement WebAuthn enrollment/assertion verification (RP ID/origin/counter/UV) and owner-only email fallback with verified Resend sender; never store raw biometric.
4. Authenticate owner/RBAC on every critical command; prevent CSRF; add rate limiting, audit logs, replay and concurrency tests.
5. Enforce technical pause policy only on affected service with server evidence; never auto-resume active 423 latch or security incident.
6. Review and fix owner email, Telegram destinations, webhook token separation, CMC outage, OKX demo missing vars; never expose secrets in Git.
7. Run npm run verify and Android/desktop cross-device QA on staging. Keep LIVE execution blocked throughout.
8. Snapshot current Google AI Studio files and compare server.ts + AppContext + auth + CSS before source sync; no blind overwrite.

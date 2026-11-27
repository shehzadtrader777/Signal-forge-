# Signal Forge — Defensive Deception & Intrusion Monitoring Plan

**State:** Proposal for development review. No production changes or active trap deployment are implied.

## Objective
Protect users, owner secrets, and trading infrastructure by detecting suspicious traffic early, alerting maintainers, and limiting abuse. No retaliation, malware, attacker-device compromise, destructive payloads, or vigilante "hack back".

## Controls
1. **Low-interaction honeypot**: an isolated, clearly nonfunctional decoy endpoint that never contains authentic credentials, financial data, or production connections. Access events record timestamp, coarse source metadata, request ID and trigger type. Exclude request bodies, authorization headers, cookies, tokens and raw personal information from logs. Keep decoys separate from actual admin routes.
2. **Rate limiting & bot protection**: limits for auth, password resets, API calls and suspicious probing; configurable thresholds and safe 429 responses. Avoid blanket lockouts that could harm legitimate users.
3. **Access-control enforcement**: server-side roles, Firebase token validation, least-privilege access and strict API route policies. A decoy must never substitute for authentication.
4. **Detection & alerting**: filter repeated requests to non-existent administrative endpoints, abnormal request bursts, invalid authorization, and high-volume credential-stuffing signals. Send alerts through protected channels, without secrets.
5. **Audit & response**: request IDs, defined retention, access-controlled logs, basic metrics, evidence-preservation playbook and reversible incident response. No arbitrary remote action against the requesting address.
6. **Boundary protection**: managed WAF, DDoS protections, IP reputation checks and short-lived blocking where the hosting provider supports them. Document false-positive exceptions and appeal path.
7. **Secret hardening**: keep credentials server-side, rotate any exposed secrets, avoid browser-exposed operator approval tokens; test auth flows with Firebase emulator before live enabling.
8. **Verification**: unit tests for 401/403/404/429 outcomes, rate limits, redacted logs, alert thresholds, and ensuring traps neither execute code nor return privileged data.

## Open-core split
- **Suitable for public release after review**: generic rate-limit middleware, sanitized test fixtures, public security documentation, decoy interface patterns, accessibility-first UI.
- **Private by default**: live detection rules that would help bypass protection, incident telemetry, IP lists, customer records, production infrastructure, internal threat intelligence, credentials and proprietary strategy logic.

## Safe implementation sequence
1. Inventory the current auth routes, middleware and hosting edge controls.
2. Remove frontend exposure of approval tokens and client-accessible sensitive API keys.
3. Design isolated honeypot with zero privileged functionality; use synthetic test traffic only.
4. Add automated tests and verify logs redact all secrets and sensitive data.
5. Review false positives, privacy, retention and applicable law.
6. Enable defensively in staging first; deploy only with explicit approval.

**Never create a destructive "trap" or send a retaliatory exploit to a requester.**

# Signal Forge security review — 27 November 2026

Scope: AI Studio export ZIP reviewed locally; this document records code-level observations, **not** a penetration test or cloud Firebase verification. Development only, do not publish.

## Confirmed from exported source

1. **Firestore owner isolation exists**: `firestore.rules` contains a default-deny catch-all and owner-scoped paths under `users/{userId}`, with UID and field validation. This is positive, but published/deployed rules may differ from the ZIP.
2. **Financial ledger trust boundary needs validation (high priority)**: `dailyPnlRecords` and `vaultLocker` allow verified owner clients to create and update records after field validation. Client ownership is *not* the same as authoritative server settlement. Confirm whether the browser can write money-like values (`realizedPnlUsd`, `scoopedToVaultUsd`, vault balances, releases) without a trusted server-side transaction or independent reconciliation. Do not assume these balances are tamper-proof.
3. **Rate limiting is per-process memory**: `server.ts` uses `rateLimitStore = new Map<string, number[]>()` keyed by IP. It resets on reboot and is not shared across replicas. Use a server-side distributed limit / gateway for public multi-instance deployment.
4. **Operator principal uses configured bearer token**: `resolveCallerPrincipal` permits a configured `OPERATOR_API_TOKEN` to act as an elevated operator. Ensure the token is never bundled, logged, sent to browser, or accepted via query parameters. Require rotation, minimal privileges, and server-only storage.
5. **Session signing key fallback**: if `SESSION_SIGNING_KEY` is absent, the server generates a random key at boot. This may invalidate sessions after restart and should fail closed in production rather than silently generating a different secret.
6. **Request size caps exist**: default JSON limit 256KB, scanner upload 6MB raw or 10MB JSON. Validate image content and uploads at server level; size caps alone do not prevent malicious payloads.
7. **No proof of Firebase live state**: Firebase integration in AI Studio doesn't verify live deployed rules, App Check enforcement, identity provider configuration, or administrative permissions.

## Required blocking checks before any public release

- [ ] Review deployed Firestore rules in Firebase Console; test unauthenticated, other-user, and owner access in Emulator.
- [ ] Test that browser clients cannot manufacture authoritative PnL, vault transfers, credits, withdrawals or trade execution outcomes. Prefer server/Admin SDK authoritative writes and append-only audit trail with replay/idempotency keys.
- [ ] Validate all sensitive API endpoints with real Firebase ID token verification and role/authorization gates; test expired, forged and cross-user tokens.
- [ ] Keep all exchange, AI, Firebase Admin, Telegram and Discord secrets server-only. Rotate any secret found in tracked history or export; never place credentials in client-side `VITE_` variables.
- [ ] Add App Check, appropriate CORS/origin checks, CSRF protection for cookie-authenticated mutations, secure cookies, error sanitization, security headers and abuse monitoring as applicable.
- [ ] Use shared rate limiting and bounded queues for expensive AI routes, image uploads, emails and OTPs; test retries and failures.
- [ ] Lock live trading OFF and force sandbox/paper mode for all QA; add a hard server-side execution gate independent of UI toggles.
- [ ] Run unit/integration/security tests in CI and preview/staging; verify that test results represent the imported ZIP revision.
- [ ] Establish audit logs, emergency freeze, safe rollback, backup & recovery and explicit production release approval.

## Release policy

No public publishing, merging to main, production deploy, trading activation, or handling real funds on the basis of this review. The user authorized draft development and safe checks, not a live launch.

## Next implementation step

Import reviewed ZIP source into the separate migration branch after scanning sensitive material; then implement **server-authoritative financial records** and regression tests against actual code in that branch, followed by CI. Avoid blanket changing Firestore rules before determining which client operations and tests depend on them.

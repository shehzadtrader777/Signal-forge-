# Signal Forge — Master Command & Control / Maintenance Audit and Staged Handoff
Date: 2026-11-27
Branch: feature/ai-studio-source-migration
Status: DEVELOPMENT SECURITY HARDENING, NOT PRODUCTION CERTIFIED

## Actual code audited
- src/components/CommandControlSettingsHub.tsx: 29-module dashboard, global/domain overrides, granular toggles, presets, workspace/dock controls and backend matrix delta sync.
- src/lib/commandControlHub.ts: catalog, 24 mapped controls + 5 specialized UI controls, state sanitizer, override precedence, evaluation/checksum.
- src/store/useCommandControlStore.ts: browser-local persisted settings, cross-tab BroadcastChannel, local state versions.
- src/lib/rbac.ts: client-facing RBAC role resolver, email allowlist and CLI identity.
- src/context/AppContext.tsx: backend toggle control, App Live state and Forge Capital 423 engage method.
- src/components/ForgeHaltServerStatus.tsx: authenticated read-only server halt-status view.

## Problems found and fixes committed
1. **Partial control sync previously presented as full success**: loop used deltas.slice(0,6), even when 7+ toggles differed. Now attempts ALL deltas sequentially, stops on failure, and explicitly says PARTIAL BACKEND SYNC if not all succeeded. Not atomic; transactional backend bulk patch is still required for production.
2. **Unintended App Live restart**: switching master out of FORCE_ALL_OFF, selecting FULL_COMMAND or Reset Defaults previously auto-called setAppLiveEnabled(true). Removed. A module preference cannot clear independent server 423.
3. **Misleading master emergency terminology**: 'Master Emergency OFF' now identified as local module OFF, not authoritative global stop. Settings shows server 423 status and explains distinct mechanisms.
4. **Dedicated 423 operator action**: explicit, browser-confirmed server emergency halt action added to Settings via existing engageForgeFailSafeNow callback. UI does not claim server confirmation before authenticated status reports it.
5. **Unauthorized/local toggle success claims**: when premium authorization unavailable, UI says browser-only; individual toggles show server confirmation only after successful backend response.
6. **Maintenance drift visibility**: counts local desired vs last reported backend matrix differences, flags mismatches and directs operator to reconcile.
7. **Spoofable special admin identity**: removed operator-cli-token UID automatic SUPER_ADMIN promotion in src/lib/rbac.ts. This must be paired with independent server-side scoped operator tokens and owner RBAC review.
8. **Malformed persisted settings**: rejected non-integer/non-finite version and invalid ISO-ish timestamps, with unit tests.
9. **Regression coverage**: new src/lib/rbacSecurity.test.ts; expanded commandControlHub.test.ts. GitHub CI final outcome needs to be verified on branch head.

## Essential operational separation
- UI hub settings / cross-tab sync are *preferences*, not authoritative execution permissions.
- App Live and backend architecture toggles are independent of immutable capital emergency halt.
- A 423 is confirmed only after authenticated server acknowledgement; if status unavailable, deny execution, do not assume absence.
- Full Command does NOT authorize live account trading.
- A true capital lock requires durable persistent state and all gateways checking it, even during multi-replica or restart failover.

## Remaining release-critical items (do NOT claim completed)
- Durable global 423 lock replicated across restarts and processes; manual owner recovery WebAuthn/passkey+verified OTP; genuine trade-mode separation.
- Atomic server-side bulk command-matrix transactions with authorization, revision/CAS, rollback checkpoints and audited diffs. UI currently syncs sequentially; drift warning is not a substitute.
- Server-enforced admin RBAC on every mutation. Review hardcoded admin email list and the CLI system-to-system auth path; never trust a browser identity string.
- Scoped operator roles and privilege-gated Maintenance Mode; no master Force ON bypass of hard risk gates.
- Authenticated persistent audit trail with actor, timestamp, old/new values, status, server-revision and reason. Browser BroadcastChannel/localStorage are not secure cross-device persistence.
- Source-of-truth maintenance dashboard: health checks, queue depth, provider quotas, data freshness, SSE/WebSocket status, worker restarts, rollback integrity, and hard-stop current state.
- Reconcile all prior Signal Forge release blockers: permanent signal ledger and exchange-verified fill IDs, on-chain source attestation, premium entitlement backend enforcement, real-data 30/60/90-day backtests, authenticated alerts/reports, Gemini grounded inputs, production monitoring.
- Verify end-to-end CI; test phone/desktop multi-tab scenarios, expired operator sessions, partial writes, restart and backpressure faults, and rollback. Do not deploy while unresolved.

## Release & Google AI Studio migration
1. Snapshot AI Studio project and environment variable metadata; never export secret values into Git.
2. Inspect reviewed development PR and CI, merge only with owner approval; retain rollback SHA.
3. Compare exact server.ts, Settings Hub, AppContext, command-control store, auth paths and provider integrations; no blanket overwrite.
4. Run staged smoke and fault-injection tests; explicitly validate no LIVE orders and a 423 remains latched through restart.
5. Owner approval only after all release gates pass. This handoff is a checkpoint, not production sign-off.

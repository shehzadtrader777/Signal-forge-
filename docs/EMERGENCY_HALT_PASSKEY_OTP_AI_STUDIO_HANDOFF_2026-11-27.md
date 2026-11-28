# Signal Forge — Emergency Halt Recovery and AI Studio Handoff
Date: 2026-11-27 | Branch: feature/ai-studio-source-migration
Status: INTEGRATION SPEC + isolated fail-closed presentation module; NOT DEPLOYED

## Prior owner decisions
- A one-tap global emergency stop must take effect immediately and independently of biometric/email service availability.
- Explicitly distinguish *app AI/quota pause* from *GLOBAL TRADING EMERGENCY HALT (423)*.
- Never turn off the old seal until the replacement is integrated, authenticated, tested, and reversible.
- On mobile, prefer platform passkey/WebAuthn using fingerprint/face/device PIN. Biometrics remain on device: the server verifies a signed WebAuthn assertion, not a fingerprint.
- Owner-email one-time code is a fallback when no registered passkey is available.
- Recovery requires audit reason, explicit owner authorization and independent server verification; recovery does NOT switch on LIVE trading, bypass paper/demo/testnet boundaries or 50-win profitability gates.

## Verified from current source
- src/lib/forgeCapitalHub.ts: engageImmutableFailSafe sets 423, sealId, allTradingHalted and suspended modules; independent of cosmetic UI.
- src/components/ForgeCapitalHub.tsx: requests challenge, inputs recovery seal, calls recover function and displays success after response.
- src/context/AppContext.tsx: local fallback on engage network failure; recovery POST to /api/forge-capital/failsafe/recover.
- Existing success messaging could be misread as proof of global server+client reconciliation; mobile red border is not enough.
- Diagnostic user report says Gemini, Bybit, Binance credentials exist in runtime, OKX missing, owner email invalid format, Telegram IDs incorrect, operator/session/Turnstile variables unset. This is user-supplied report, not independent runtime confirmation.
- Report says Google AI Studio quota/reset unavailable. No claims of quota renewal.

## Server source-of-truth API design (NOT implemented)
1. POST /api/owner/emergency-halt: authenticated owner/operator RBAC + CSRF protections; idempotency-key; on trigger persist HALTED with monotonic revision and audit event BEFORE acknowledging. Return 202 only when durable queue accepted; 200 HALTED only after confirmed latch persisted. If unavailable, deny order execution by independent fail-closed gate.
2. GET /api/owner/emergency-halt/status: owner-only, no secrets; {state,revision,sealId,acknowledgedAtIso,executionEnabled:false}; Cache-Control:no-store. No public route. Verify current Firebase session + re-auth for sensitive actions. NEVER publish operator tokens.
3. POST /api/owner/emergency-halt/recovery/challenge: authenticated owner; purpose-bound challengeId, expiry <=5 min, cooldown, attempt throttling, replay protection; store hashed OTP only; do not print OTP in logs.
4. POST /api/owner/emergency-halt/recovery/passkey/verify: verify WebAuthn challenge, RP ID, origin, signature, credential ownership, UV flag, counter/replay rules; require owner credential enrolled earlier using server-verified authenticated flow. Mobile app can use native platform passkey bridge only with secured origin / domain association and separate review.
5. POST /api/owner/emergency-halt/recovery/email/verify: verify rate-limited one-time email code via verified Resend sender and valid owner email; same audit guarantees; no email links that automatically resume.
6. POST /api/owner/emergency-halt/recovery/approve: only after recent passkey/OTP auth and explicit owner confirmation; two-step state transition HALTED -> RECOVERY_PENDING -> RESUME_APPROVED_EXECUTION_LOCKED. Preserve trade mode and all hard gates; NO automatic live order routing.
7. Event propagation: server-sent events or websocket revisions plus short status polling fallback (on focus, reconnect, and refresh), reject stale revisions; show red EMERGENCY HALT on every viewport. If status unreachable, show UNKNOWN / NOT VERIFIED and keep order execution locked. Never claim success from client-only fallback.
8. Server tests: offline/race/idempotency, cross-device parity, stale updates, tampered session, CSRF, replay OTP, credential swap, rate limits, revoked passkeys, email failure, failed resets, authorization audit, 423 across all execution channels, restart persistence, real trading disabled after recovery.

## Email OTP usability
- Screen text: 'Check your owner email. Copy the 6-digit code and paste it here.' Standard autocomplete=one-time-code, inputMode=numeric; OS may autofill from messages where supported.
- Do NOT read owner's inbox automatically, harvest email codes, expose OTP in URLs, or show OTP to unauthorized devices.
- Verify sender domain and owner alert email format before enabling the email fallback. Prefer passkey authentication for daily use.
- Always provide 'Resend code' with rate limits; explicit 'Confirm recovery' button; do not call recovery on paste/autofill alone.

## Critical security review before any rollout
- Remove approvalToken from client-visible FableOrchestratorRuntime.getSnapshot and FableOrchestratorPanel; currently approvalToken is returned to browser and passed back as authorization, so this is not meaningful proof of independent operator approval.
- OWNER_ALERT_EMAIL, ADMIN_EMAIL_ALLOWLIST, RESEND_FROM_EMAIL must be validated without logging values.
- TELEGRAM_CHAT_ID and TELEGRAM_DEV_CHAT_ID must be corrected; TELEGRAM_WEBHOOK_SECRET must differ from bot token.
- Missing OPERATOR_API_TOKEN, SESSION_SIGNING_KEY, TURNSTILE_SECRET must be tied to actual server uses; do not invent secrets or assume they are required merely because a report listed them.
- Preview should not hold active live exchange credentials unless absolutely required; live remains locked.
- Avoid exposing API key presence via public endpoints; owner-only redacted status.
- Avoid treating an unchanged UI label or successful CI as production verification.

## Implementation checklist for Google AI Studio source reconciliation
- Snapshot current AI Studio project sources and current GitHub branch separately.
- Diff server.ts, AppContext, ForgeCapitalHub, FableOrchestratorPanel, auth/security middleware, Firestore rules, and env naming. No blind overwrite.
- Reuse src/lib/emergencyHaltPresentation.ts and tests as *display logic only*; integrate only after server API is tested.
- Owner approves a staging deployment only; run device/browser test matrix including Android passkeys.
- Keep a rollback commit, log updated files, verify successful CI, and explicitly approve release. Never migrate secret values through Git.

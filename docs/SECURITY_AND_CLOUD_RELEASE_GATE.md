# Signal Forge: Secrets and Release Safety Gate

## Purpose
Security-first review for GitHub public documentation, Google AI Studio migration, and any future cloud/OSS-program submissions. This is a **checklist**, not evidence that production security has passed.

## Confirmed observations from repository review
- The `.gitignore` excludes `.env*` other than `.env.example`, plus several key/certificate formats, backups and ZIP archives.
- The old environment template contained a literal contact email; the new template leaves contact fields blank.
- `VITE_CMC_API_KEY` has a `VITE_` prefix. In standard Vite builds, these values can be included in client-side assets. **Do not use it to hold a private CoinMarketCap secret.** Migration to a server-side credential and API proxy is a separate code change not completed by these documentation edits.
- Fable operator approval information has been surfaced to frontend components in the reviewed source. The server-side authorization design needs remediation and independent tests before live features.
- Bybit, OKX, Binance and other exchange API credentials have **not** been verified as present in active Google AI Studio or hosting secret stores.

## Mandatory before any public push / AI Studio sync
1. Preserve an offline backup of known-good source and a clean dev branch. Do not export `.env`, provider credentials or database dumps into public archives.
2. Run an authenticated secret scanner against **all Git history**, not only the latest files. Investigate each finding privately. Ignore rules cannot undo a previously committed secret.
3. Rotate/revoke any key that has ever been committed, displayed in browser code, shared in a public log, or exposed in a public URL. Remove it from history only with a carefully planned procedure; rotation comes first.
4. Do not put secrets in `VITE_*`, `NEXT_PUBLIC_*`, `PUBLIC_*`, or other client-accessible configuration. Move third-party requests needing secret keys to protected server handlers.
5. Separate paper/testnet and live credentials by project/environment; default to no live trading. Apply read-only/minimal exchange permissions and IP restrictions when supported.
6. Ensure server-side approval is tied to the authenticated operator, user role, expiry, one-time use, audit trail, and anti-replay controls. Never trust an approval token sent back from a freely available browser snapshot.
7. Run Firebase rules/emulator tests, authenticated route authorization tests, dependency review, mobile/accessibility QA, `npm run verify` and branch CI. Keep results documented.
8. Ensure Google AI Studio project-level variables, deployed runtime secrets and local values are compared **by name and configured status only**. Never dump values in chat or diagnostic output.
9. Review README/license choice and verify only authorized documents are public. A public repository is not automatically open-source licensed.
10. Approve release only after security and product sign-off. An OSS-program application does not require enabling live exchange features.

## Protecting code ownership and intellectual property
- **No LICENSE chosen yet:** preserve the decision with the owner. For third-party adoption and genuine open-source eligibility, a legitimate OSI-approved license may eventually be needed; it grants defined rights and cannot be called “fully private”.
- Keep proprietary strategies, secrets, datasets, customer data, private orchestration methods and unready backend modules in a **private repository** or private infrastructure if they are not intended for public reuse. Removing them from the current version does not remove historical exposure.
- A separate public documentation/demo repository can present research scope and contribution guidance without exposing proprietary source. Avoid claiming eligibility until contributions and program requirements are established.
- Enable 2FA, least-privilege collaborators, branch protection and dependency/secret alerts where available.

## Open blockers
- Secret scan of the full commit history is not yet completed.
- Production/cloud secret configuration is not verifiable from this code review.
- The operator approval-token exposure requires a code fix, not just a security policy.
- CoinMarketCap client-side credential routing requires a code fix before it can be called secret-safe.
- No production release, license approval or Claude OSS program approval has been verified.


## Phase 3 source hardening — 28 November 2026

Baseline `35de09e`: both PR-triggered CI workflows passed. Reviewed 404 tracked paths for populated environment/private-key/credential-archive/database filename patterns; none matched. This is filename hygiene, not content or history clearance.

- `c0587d7`: remove Fable approval token from runtime/public snapshots and UI, explicitly lock live approval in runtime and HTTP route, require verified owner for global Fable mutations. Authorized research functionality remains; non-owner mutation access is deliberately restricted.
- `4299d86`: strict Firebase token claim structure, project/time checks, boolean verified-email semantics, recognized certificate keys, fail-closed expired certificate cache. Provider revocation is not implemented by these changes.
- `9bd7b5f`: first-party API path allowlist, redirect rejection, per-Firebase-token session cache, stale asynchronous response rejection, no automatic mutation retries on 401.
- `0968eaf`: explicit current Firebase credentials take precedence over legacy sessions, logout cookie clearing, omit guest API cookies and expanded private-key/database ignore patterns. Copied tokens and older cookie-only endpoints still require independent revocation/CSRF review.
- New redacted Git-history heuristic audit workflow scans fetched reachable Git objects, reports counts only, skips binary/oversize blobs, and explicitly does not certify release safety. Its result is not yet verified. It supplements, not replaces, the historical Gitleaks triage.

**Release gate remains OPEN.** Prior 13 current-tree and 9 historical potential Gitleaks findings require private review and provider-side revocation/rotation as necessary. Firebase deployed rules, App Check/IAM, live provider restrictions, dependency advisories, durable token revocation, distributed rate limiting, exchange settlement integration, emulator and staging tests remain outstanding. No public secret values, private keys or backup files added; no production deployment, main merge, AI Studio sync or live execution. Verify exact-head CI before any next release decision.


### Targeted current-tree credential triage — 28 November 2026

The completed redacted audit at `d679ad5` scanned 721 unique text blobs (one binary skipped), with current-tree matching blob counts Google-shaped 3, Discord-shaped 2, Telegram-shaped 2. These are pattern counts, not confirmed active credentials or an exhaustive security scan.

Reviewed nine selected notification/config/server paths. Found one Firebase client configuration API-key-shaped literal (client configuration alone does not establish a private secret; provider restrictions still need verification), one obviously synthetic Discord test fixture, and two distinct Telegram-shaped literals in notification/masking tests whose provenance could not be established. Replaced both ambiguous Telegram test literals with explicitly synthetic values while retaining the canonical precedence and masking assertions. No provider calls or credential values were disclosed. Other matches and prior scanner findings remain unclassified.

**Mandatory owner-side follow-up:** review historical Telegram credentials privately and revoke/rotate any that were ever real; replacing a test literal does not remove it from Git history. Verify Firebase API-key restrictions, Discord/webhook restrictions and prior findings separately. No history rewrite, production credential change, or security clearance granted.


### Phase 4: Firestore emulator gate

Baseline `a731d1b` passed all three existing PR CI workflows. Added a dedicated local Firestore emulator workflow and executable rule authorization suite. It copies only the rules and test script into a disposable directory, installs separately pinned top-level test packages (no application lockfile changes), uses Java 21 / Node 22 and a fixed `demo-signal-forge-rules` project and loopback host. It never reads the application's Firebase project configuration or deploys rules.

Checks cover legitimate owner profile/watchlist operations, identity and public-ID isolation, owner-only legacy reads and filtered queries, cross-user/guest denial, schema-valid financial create/update/delete rejection, and atomic rejection of a mixed allowed/forbidden batch. Explicit read-back checks ensure rejected writes did not change balances or the profile. The rules are tested on the local default database; named production database deployment, real Firebase identity, cloud IAM, and settlement integration remain unverified. Test-package transitive dependencies are not locked in this isolated harness. The new exact-head workflow must pass before claiming emulator success.

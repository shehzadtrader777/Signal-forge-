# AI Studio Export / GitHub Hardening Reconciliation — 27 November 2026

## Source evidence
- The owner provided the current Google AI Studio ZIP exported at 17:59:40 local; active source contained **322 files** after removing Studio backups and artifact caches.
- **20 priority overlapping files** were checked against real GitHub blob SHAs; **19 had different content**, and one was identical (`src/lib/marketData.ts`). This is a priority-scope exact comparison, **not** a claim of exhaustive matching across all 322 files.
- The eight React-error-edit paths from the Studio screenshot were present in the export. Five also existed on GitHub with divergent content: `ModularProfitTakingPanel`, `MultiScreenWorkspaceBar`, `ModularBacktestMatrixPanel`, `AgentLoopTelemetryPanel`, `App.tsx`. Three are **Studio-only**: `PublicLiveMarketOverview`, `PublicHome`, and `reactEffectStability.test.ts`.
- At least 30 additional dependencies supporting Studio's public homepage, chart, on-chain/market data, notifications, scanner, vault, maintenance, and trade ledger are absent from the hardened GitHub branch.
- At least 13 GH-hardening files are missing from Studio, including the resilience supervisor, early volume and trusted quote gates, owner signal tier policy, dynamic backtest research, verified audit identity and chart inspector. The Studio server.ts is substantially larger than hardened GitHub server.ts and must not be replaced blindly.

## Changes merged on this isolated review branch
- Bounded, quantized profit-taking evaluation and stable profile dependency.
- Backtest matrix effect stabilization via `paramsRef` and `runMatrix` callback.
- Throttled telemetry refresh on hidden tabs.
- Hoisted motion prop constants for the multi-screen bar.
- Stable App side-menu callbacks while preserving GitHub routing.
- `studioReactReconciliation.test.ts` regression guard.
- Full Node and hybrid Rust/Python/Docker CI validated on this draft review branch.

## Strict safety limits
**This branch is NOT a complete AI Studio synchronization, and must remain draft.**
- Do not click Restore or overwrite either original project.
- Do not copy all Studio `server.ts`, `App.tsx`, or backup secrets over GitHub source.
- Do not remove Studio-only feature modules. Preserve them with their transitive imports, wire them into a disposable staging candidate, and resolve backend/auth conflicts before testing.
- Verify full typecheck, browser React regression, source-specific and E2E tests, API compatibility, auth, passkeys, durable emergency 423 and exchange/data provenance.
- No direct Google AI Studio push, production deploy, live order activation, credentials migration, or git merge occurred.

## Handoff
The exact 20-file comparison, confirmed unique paths and a safe merge guard that never silently overwrites conflicts are available in the user's conversation artifacts. Work/Cloud Browser can open Google AI Studio staging after snapshot and compare the two exported trees. Retain GitHub hardening and Studio React fixes; sync only after a documented zero-critical-conflict review and CI passes.

## Full 322-file source inventory and conservative merge decisions — 28 November 2026

The owner's 27 November 04:59 AM Studio export was compared against reconciliation head `a18893f881f6257b9ee560ce3e55790067e55f8d` using exact Git blob identities for each of the 322 active Studio source files: **273 identical, 49 different, 0 Studio-only, 80 GitHub-only**. This inventory does not prove that divergent behavior was merged, does not cover historical commits, and must not be used as a security approval.

### Four reviewed conflict decisions: retain GitHub hardening

1. `.gitignore` — retain the version with explicit `.aistudio/`, `.backups/`, ZIP, private key, service-account and cache exclusions. Studio's version lacks these safeguards.
2. `.dockerignore` — retain the version excluding backups/metadata, private credentials and build artifacts. Studio's version is narrower.
3. `.github/workflows/ci.yml` — retain the tested GitHub workflow using the committed Bun lockfile; Studio's `npm ci` workflow depends on a missing npm lockfile.
4. `.env.example` — retain the tested GitHub template and its removal of the browser-exposed `VITE_CMC_API_KEY` assignment. Do not restore Studio's older template; runtime key routing remains subject to review.

These are **preservation decisions**, not merges of new Studio logic. **45 other divergent source paths remain unresolved**; critical differences include `server.ts`, `firestore.rules`, `src/App.tsx`, `src/context/AppContext.tsx`, `src/lib/firebase.ts`, `src/lib/rbac.ts`, `package.json`, Rust/Python IPC and financial/trading modules. Retain the 80 GitHub-only hardening files.

### Additional read-only Studio ZIP validation

- ZIP CRC checked.
- Python AST syntax: **25/25 pass**.
- JSON syntax: **7/7 pass**.
- Static relative-import file resolution: **857/857 pass**.

These checks are not a TypeScript compiler run, full integration test, dependency install, or CI pass for any combined source revision. Current/historical secret findings and Firebase cloud restrictions remain unresolved.

**Merge gate: NOT CLEARED.** Keep PR Draft. No bulk overwrite, direct Studio Pull/Push, production deploy or LIVE trading activation. Resolve the remaining 45 conflicts, run CI/security checks on the exact merged candidate, and obtain independent approval before merge.

### Additional low-risk conflict decision: preserve Signal Forge README

The Studio ZIP's `README.md` is the generic “Run and deploy your AI Studio app” starter README, while the reconciliation branch's `README.md` documents Signal Forge project scope, authentication/security boundaries, dev commands, research/paper-only limits, ownership/license caveats, and workflow verification. **Decision: retain the reconciliation branch's README**; no functional behavior is changed by this decision.

This removes one documentation-only discrepancy from the outstanding semantic-review queue. **18 substantive source discrepancies remain**, plus independent credential, deployed Firebase and financial-authorization review. This decision **does not** authorize merge, production deploy or AI Studio sync.

### Security conflict decision: reject Studio UID-only administrator elevation

Studio's older `src/lib/rbac.ts` directly assigned `SUPER_ADMIN` for the user-controllable-looking UIDs `operator-cli-token` and `ci-operator-automation`. The reconciled GitHub implementation explicitly **does not** infer admin permissions from these UID strings and instead requires separately verified, server-controlled authorization. **Preserve the reconciled version**; never restore the Studio UID bypass. The existing `src/lib/rbacSecurity.test.ts` checked the first UID; an additional negative test for the second UID was committed as `63fae9d982d61cd7f251d869a8f36c341ba22dae`. This is a security-specific preservation decision; deployment-level RBAC hardening still needs independent review.

### UI conflict decisions: preserve previously reconciled stability fixes

- `src/components/AgentLoopTelemetryPanel.tsx` — the reconciled code retains stable `REFRESH_BTN_TAP` and pauses polling when the page is hidden, plus explicitly discards the ignored async polling promise with `void`; do not revert.
- `src/components/MultiScreenWorkspaceBar.tsx` — both source versions use stable top-level `PRESET_BTN_TAP` and `PANEL_BTN_TAP` constants. Preserve the reviewed reconciliation component and avoid unrelated UI rewrites pending visual QA.

These decisions reduce the source paths requiring *further* comparison, but **do not prove whole-app behavioral equivalence**. The major backend/Firestore/financial/trading/UI routing conflicts and secret-scan findings still block main merge and Google AI Studio synchronization.

### Live-feed validator test: preserve explicit Rust UDS transport assertion

Reviewed the actual 27 November Studio ZIP and branch `src/lib/liveFeedValidator.test.ts` side by side. The Studio test invoked the Python hybrid control-plane self-test and checked clone/tick/chamber/tracked-row outputs. The reconciled GitHub test additionally asserts `result.transport === 'RUST_UDS_IPC'`; all the surrounding test logic is otherwise aligned in the inspected section. **Decision: preserve the stricter GitHub test**, not the older Studio version. This resolves one *test-only* semantic-review item; do not interpret this as full Rust integration equivalence or permission to replace the engine binary.

### Agent-loop telemetry: retain async timer guard

Reviewed the Studio ZIP's `src/components/AgentLoopTelemetryPanel.tsx` against the reconciled source, line by line in the polling effect. Both versions preserve the `REFRESH_BTN_TAP` stable animation constant, the 12-second timer, hidden-tab suppression and interval cleanup. Reconciliation adds an explicit comment about polling safety and changes the ignored promise from `fetchTelemetry()` to `void fetchTelemetry()`. **Decision: preserve the GitHub version.** No Studio-only functionality is lost in that reviewed effect; a separate regression test covers this behavior.

### Multi-monitor workspace bar: stable motion constants preserved

Compared the Studio ZIP with `src/components/MultiScreenWorkspaceBar.tsx` in the reconciled branch. Both use the same stable module-level `PRESET_BTN_TAP` and `PANEL_BTN_TAP` constants, and the same preset/reset/panel visibility button flow. GitHub adds explanatory safety commentary about keeping motion prop identities stable under high-frequency rerenders. **Decision: preserve reconciled GitHub version** with its regression coverage; do not replace it with the slightly older Studio export.

### App.tsx route reconciliation: retain premium pages and global scroll manager

Compared the **active** `src/App.tsx` from the owner-supplied 27 November 2026 04:59 Studio ZIP against the current reconciliation branch. The Studio export lacked `PremiumLanding` and `PlansPreview` imports and the `/welcome` and `/pricing` early page exits; the GitHub branch preserves those pages. Studio rendered `<RouteScrollManager />` inside `AppShell` after `SideMenuDrawer`, while the GitHub branch places one scroll manager directly inside `<BrowserRouter>` before `<AppProvider>`, covering the pre-login public pages as well. The protected Test Console routing and ordinary dashboard/navigation route map remain otherwise aligned in the reviewed section.

**Decision:** preserve the newer GitHub route configuration and the globally mounted single scroll manager. A test in `src/lib/studioReactReconciliation.test.ts` now guards both premium pages, the route-manager instance count and placement. This decision resolves only the `src/App.tsx` reconciliation review; other UI and financial/Firestore conflicts remain.

### Firestore rules: preserve deterministic publicId with legacy migration

Conducted a side-by-side active-source review of `firestore.rules` from the 27 November 04:59 Studio ZIP against the reconciled GitHub branch. The following collection sections have **exactly matching bytes**: `watchlist`, `alerts`, `workspaceConfig`, `rollbackSnapshots`, `errorLogs`, `dailyPnlRecords` and `vaultLocker` (from each `match` token through the next collection section). Differences are confined to shared helper / `users` profile validation and create/update requirements.

The Studio export's `isValidUserProfile` allows only `uid`, `email`, `displayName` and timestamps. GitHub additionally requires a deterministic `publicId` equal to `'SF-' + userId`, with a one-time migration path for old existing user documents that lack `publicId`, then immutability of that field. `src/lib/firebase.ts` writes `getSignalForgePublicId(user.uid)` for both initial creation and later upserts. **Decision: preserve the GitHub version**, including this user-schema evolution; the tests now statically assert the ID validation, migration exception and the writer alignment. Actual Firestore emulator and deployed rule testing still required before production use.

**Critical caveat:** both versions retain owner-client `create/update` permissions for `dailyPnlRecords` and `vaultLocker`; agreement between versions does not establish genuine exchange-settlement provenance. The financial fields need an independently trusted server ledger and restrictive rule migration before live financial use.

### Modular backtest matrix: preserve synthetic-performance disclosure

Direct active-source comparison of the Studio ZIP and reconciled `src/components/ModularBacktestMatrixPanel.tsx` confirms both retain the stable `paramsRef`-based `runMatrix` effect, the matrix/optimization request handlers, and the same principal controls. GitHub adds the prominent `synthetic-matrix-disclosure` banner explaining that the matrix uses deterministic simulated trades and illustrative strategy probabilities, **not** verified historical performance, and recommending matched historical data, fees/slippage and out-of-sample checks. That specific disclosure was absent from the Studio export. GitHub also adds React stability commentary and positions the stable `MATRIX_BTN_TAP` constant before the horizon list.

**Decision:** preserve GitHub's clearer research-only disclosure and reviewed effect behavior, not the older Studio copy. An explicit test in `src/lib/studioReactReconciliation.test.ts` guards the truthful disclosure and parameter reference. This is one UI source decision; it does not transform simulated outputs into actual validated returns.

### Runtime and navigation batch: five additional source decisions

Reviewed the owner-held active 27 November 04:59 ZIP against exact baseline GitHub head `7f7403b16c5d667bca42404fdf57f9df74c041ca`. For four files, compared sequential 16-line UTF-8 block fingerprints using FNV-1a 64-bit, then directly inspected both versions of every unmatched block. Rust main was reviewed directly in full. Fingerprints are comparison aids, not a cryptographic attestation.

| File | Review result / preservation decision |
| --- | --- |
| `src/lib/executionPipeline.ts` | 490/522 Studio split-lines in matched blocks; reviewed both remaining blocks. Studio used `supportConfirmed && status === 'MONITORING_SUPPORT'` to mark pre-pump execution eligible. GitHub explicitly sets `autoExecuteEligible: false` and `verificationStatus: 'UNVERIFIED_VOLUME'`. Preserve fail-closed GitHub behavior; ticker-derived estimates cannot authorize orders. |
| `src/lib/hybridArchitectureServer.ts` | 722/738 Studio split-lines matched; the remaining block requires a successful handshake **and** exact `RUST_UDS_IPC` transport in GitHub. Studio accepted any truthy IPC ok, including fallback. Preserve explicit failed state and error for unverified transport. |
| `hybrid_core/rust_engine/src/main.rs` | Preserve GitHub 2-second socket read/write timeouts, finite-risk-envelope guard, and explicit u64-to-u128 conversion in timestamp arithmetic. Studio lacked these hardening changes. This remains the paper/simulation daemon. |
| `src/components/SideMenuDrawer.tsx` | 418/434 Studio split-lines matched; GitHub adds Welcome & Super Guide and Plans & Roadmap menu entries consistent with the already reviewed App routes. Preserve both. |
| `src/pages/Alerts.tsx` | 397/461 Studio split-lines matched; GitHub builds the symbol selector from known coins, top gainers and ticker keys through `buildBacktestResearchUniverse`, rather than static `TRACKED_COINS`, and uses a neutral recipient placeholder. Preserve GitHub expanded selector. |

No Studio-only functionality was found in the reviewed differences for these five files. Kept existing implementation; new **source-level** regression guards in `src/lib/studioReactReconciliation.test.ts` commit `39b128b8` complement existing execution and IPC tests. Fresh CI must verify the new head.

**Remaining original semantic-review paths:** `server.ts`, `src/context/AppContext.tsx`, `src/lib/firebase.ts`, `src/pages/Backtesting.tsx`, and `src/pages/Dashboard.tsx`. The separate authoritative financial ledger, deployed Firebase rules, credential investigation, and isolated staging/approval gates remain open. Do not mistake completion of source-difference reviews for production readiness. No merge, Studio sync, deployment, or live execution.

### Firebase client source preservation — exact head b43e9c9

Reviewed the owner-held active 04:59 Studio ZIP against `src/lib/firebase.ts` at GitHub head `b43e9c9af961b500bcba4f09b1e107afdcf78290`. Sequential 16-line FNV-1a 32-bit fingerprints matched 45 full blocks (720 of 820 Studio split-lines); all unmatched blocks on both sides were directly inspected. Fingerprints are comparison aids, not cryptographic attestations.

- Retain GitHub's deterministic `getSignalForgePublicId` and profile creation/upsert alignment with Firestore rules. Firebase UID remains the authentication identity.
- Studio silently returned on invalid PnL input or unverified/mismatched auth, and both financial save functions caught write errors without rethrowing. GitHub rejects these cases and propagates write failures. Preserve truthful Cloud Sync failure handling.
- Both versions retain document-write serialization, transactions, subscriptions and profile readiness logic. No Studio-only behavior was identified in the inspected differences.
- This resolves the Firebase client source preservation decision only. Firestore still allows verified owners to create/update `dailyPnlRecords` and `vaultLocker`, including financial fields. Server-authoritative ledger, restrictive rules, migration and emulator tests remain mandatory.

**Exact baseline CI:** both returned workflows passed at `b43e9c9`: [Five-Phase Hardening](https://github.com/shehzadtrader777/Signal-forge-/actions/runs/46123396702) and [Hybrid Runtime](https://github.com/shehzadtrader777/Signal-forge-/actions/runs/46123396690), all six returned jobs successful. New commits require independent verification.

**Remaining original semantic-review paths:** `server.ts`, `src/context/AppContext.tsx`, `src/pages/Backtesting.tsx`, `src/pages/Dashboard.tsx`. Separate ledger, credential triage, cloud restrictions, isolated staging and independent approval remain open. Keep PR Draft; no merge, deployment, AI Studio overwrite or live execution.

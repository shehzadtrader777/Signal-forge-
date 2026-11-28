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

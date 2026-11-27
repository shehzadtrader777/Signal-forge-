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

# Studio Public Module Integration Gate — 2026-11-27

## Evidence and scope
Inspected the owner-uploaded current Google AI Studio ZIP (export timestamp 17:59:40) directly and checked listed imports against GitHub PR #3 head `f3e4b3f7f98b9f64d4f03744d916f8ec00c447ad`. This is a focused dependency gate, not an exhaustive project-level merge.

## Studio-only entrypoints and direct imports
- `src/pages/PublicHome.tsx` (477 lines in the ZIP): imports `platformArchitecture`, `useTradingArchitectureStore`, `PublicLiveMarketOverview`, `PublicTradeIdVerification`, `AiWelcomeAssistant`, as well as shared `AppContext`, `marketData`, and `useCommandControlStore`.
- `src/components/PublicLiveMarketOverview.tsx` (538 lines): imports `signals`, `technicalStructureEngine`, `AppContext`, `lightweight-charts`, and React router.
- `src/lib/reactEffectStability.test.ts` (163 lines): Studio's original React error regression suite, not yet incorporated as-is.

## GitHub PR #3 direct import existence check
| Path | PR #3 head |
|---|---|
| `src/lib/platformArchitecture.ts` | 404 — missing |
| `src/store/useTradingArchitectureStore.ts` | present |
| `src/components/PublicTradeIdVerification.tsx` | 404 — missing |
| `src/components/AiWelcomeAssistant.tsx` | 404 — missing |
| `src/lib/signals.ts` | present |
| `src/lib/technicalStructureEngine.ts` | 404 — missing |

These are four directly confirmed missing dependencies, **not** a full transitive dependency count. Inspect the Studio export for each source and their transitive imports before any staged integration.

## Merge gate / safe order
1. Preserve the current Studio ZIP and GitHub PR #3 head; no Restore or bulk overwrite.
2. Produce a full transitive import manifest for Studio-only public/home/chart/trade-ledger modules; confirm dependency licenses and package versions.
3. Stage missing leaf modules in an isolated integration candidate; keep existing GitHub hardening, routes, RBAC, halt protections and data-provenance gates authoritative. Do not let public UI imports bypass trading safety.
4. Resolve overlapping AppContext, server routes, auth and WebSocket contracts manually; do not blindly replace `App.tsx` or `server.ts`.
5. Run dependency/typecheck, React regression tests, browser navigation, Python/Rust/Docker CI, auth/signal-safety and staging smoke tests. Record latest commit job conclusions.
6. Only after zero critical conflicts, produce a reviewed staging export for a backed-up AI Studio project. LIVE trading stays disabled.

## Status
**INCOMPLETE — NOT AUTHORIZED FOR MAIN BRANCH MERGE OR GOOGLE AI STUDIO PUSH.** PR #3 remains draft until the complete dependency closure and tests are verified.

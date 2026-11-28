# Signal Forge — Premium Experience and Super Guide Roadmap

Status: **development draft**. This document is a planning and acceptance reference, not evidence of production readiness or trading authorization.

## Product identity
- A clear international-facing fintech research workspace with consistent navigation, typography, theme tokens, accessible contrast, responsive cards, honest state labels and transparent data provenance.
- Avoid fabricated performance, unsupported 'AI accuracy' claims, exchange affiliation claims, or premature launch dates.
- Public marketing pages must be readable without login and cannot reveal private account data.

## Delivered in this draft branch (subject to CI and QA)
- Existing `/welcome` premium landing page preserved and expanded with a public roadmap and guide.
- `/pricing` responsive, informational plan preview with no checkout or invented prices.
- Curated read-only guide answers for onboarding, signal literacy, mode separation and account hygiene.
- Footer and mobile navigation links to public product information.

## Next acceptance gates
1. **Design system:** audit mobile widths (320–1440px), keyboard focus, heading structure, contrast, reduced motion and page load performance.
2. **Actual source reconciliation:** migrate the verified latest AI Studio export safely, preserving existing README, security rules and working code; scan exclusions and secrets before any code upload.
3. **Guide-only conversational AI:** server-side proxy with authentication/rate limits where needed, grounded retrieval exclusively from approved help documentation, injection-safe prompt handling, PII minimization, abuse controls, clear uncertainty and source references. Never expose credentials or exchange keys.
4. **Immutable authority boundary:** guide services must have no permission or callable route to place/cancel orders, change leverage, move funds, alter account permissions, change subscriptions or unlock live trading. Enforce authorization on the backend; UI disabling alone is insufficient.
5. **Subscriptions:** owner-approved plans, genuine pricing, user eligibility, trials, scan credits and quotas, webhook validation, refunds and ledger reconciliation before any payment buttons go live.
6. **Chart scanner:** pre-AI chart image gateway validating file magic, size, readability, relevance, rate limits and duplicate attempts. Use explicit uncertainty and clear rejection messages; never spend credits on rejected uploads.
7. **Account-scoped verification:** enforce RBAC and per-user data isolation at all backend boundaries; keep PAPER/DEMO/LIVE states separate and label all simulated results.
8. **Quality checks:** typecheck, tests, build, visual QA, accessibility smoke test, security audit, dependency review, CI green, code review and signed release approval.
9. **Release:** staged rollout with monitoring, rollback path, error budgets and feature flags; no production deployment or live-trading enablement from a draft PR.

## Super Guide product contract
The assistant explains features and workflows. It is **not** a trade execution agent, credential manager, investment adviser, account administrator or billing operator. Initially its curated static guide is informational and offline. A future AI-backed assistant needs separate development and verification. Its permitted output includes navigation help, explaining indicators, error troubleshooting and risk education. Personalized investment orders, guarantees and any financial/account action are out of scope.

## Owner controls
Administrators can later enable approved features per plan, quotas, regions and launch waves using server-verified entitlements and audit logs. Do not hard-code prices or silently enable premium access.

## No-merge conditions
Do not merge this PR until current source is reconciled, sensitive data scanning is complete, CI passes and UI is manually reviewed. Do not deploy Firebase production or activate LIVE trading as part of the UI work.

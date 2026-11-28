# Signal Forge — final review preparation (28 November 2026)

**Release decision: HOLD.** This is a verified repository-level candidate, not permission to merge, deploy, synchronize a live project or trade. Preserve the draft pull request and main branch.

## Exact baseline evidence

Baseline commit: `470cae8312f4fcd74c0a0df75be3e53db5311e0f`.
Main independently read at `7e4db43a4150126c94658b0f0db53c56f19ae1da`.
Comparison: 240 commits ahead, 0 behind; 273 changed files (175 added, 98 modified), PR #4 draft/unmerged, GitHub reported mergeable. A mergeable result is not a review or security approval.

| Verification | Baseline result | Evidence |
|---|---|---|
| Application gate | Passed, full suite 502/502; no failures | https://github.com/shehzadtrader777/Signal-forge-/actions/runs/46127370319 |
| Rust / Python / Docker / browser | Passed | https://github.com/shehzadtrader777/Signal-forge-/actions/runs/46127370336 |
| Firestore isolated emulator | Passed | https://github.com/shehzadtrader777/Signal-forge-/actions/runs/46127370315 |
| Redacted history audit | Executed successfully; not credential clearance | https://github.com/shehzadtrader777/Signal-forge-/actions/runs/46127370335 |

Earlier exact log evidence: 49/49 Firestore authorization checks on `df2f923`, and 10/10 guest Chromium desktop/mobile checks on `1d6498f`. The baseline repeated these workflows successfully. Application logs explicitly confirmed TESTNET/LIVE denial, >64-bit ledger totals and unscoped legacy database refusal. No real provider accounts or production state were involved.

## Dependency and repository controls

The source contains Bun and Cargo lockfiles. Added a dedicated Bun high/critical advisory audit workflow, using the tracked lockfile, read-only repository permission and no production secrets. This new workflow has not yet passed. No package upgrades are silently applied. Its coverage is JavaScript advisory data only; Rust and Python dependency advisories, container base images, workflow action pinning and test harness transitive dependencies require separate review. A scanner pass cannot certify absence of vulnerabilities.

GitHub's main branch endpoint reported `protected: false`. Ruleset coverage could not be verified. Dependabot and secret-scanning alert endpoints were unavailable through the available connector. Do not infer zero alerts or effective protection. Repository owner should configure or verify required checks, review approval, no force-push/deletion and appropriate access policy in GitHub settings. Do not change branch policy without owner authorization.

## Blocking release acceptance checklist

- [ ] Exact candidate all workflows pass, including new advisory gate.
- [ ] Review high/critical findings and other risk-relevant advisories across all dependency/runtime layers.
- [ ] Private classification of outstanding historical credential findings; revoke/rotate any real exposed tokens; confirm provider restrictions. Never paste credentials into chat or GitHub.
- [ ] Independently verify main protection and required status checks; authorized reviewer approves the full diff.
- [ ] Verify deployed Firebase project/database rules, IAM, App Check, identity and token revocation against an isolated staging environment; local emulator success is not cloud clearance.
- [ ] Verify real server-controlled TESTNET settlement adapter, account binding, unit conversion, replay behavior and read-only permissions with synthetic or sandbox data. Do not wire browser financial writes or accept unscoped historical funds.
- [ ] Authenticated browser, accessibility, staging runtime, rollback and recovery rehearsal; no real trading or private backups in the repository.
- [ ] Explicit owner sign-off on exact reviewed SHA and safe merge plan; separately authorize final AI Studio synchronization after preserving the original project.

## Safe handoff

Keep all changes on the reconciliation branch. Do not make the PR ready, merge main, modify the original AI Studio project, or activate LIVE trading on the strength of these checks alone. Use the review evidence and blockers above to make the next decision. No credentials, private keys, provider data, or backup archives are included in this document.


### Advisory gate finding — release remains HOLD

Exact baseline `ff408ce` passed the existing four workflows but the new dependency gate failed with one high advisory: GHSA-m9gg-hp2v-232j in locked `@grpc/grpc-js@1.9.16`; the advisory reports a patch at 1.13.6. The observed Firestore package declares `~1.9.0`, so the patched version is outside its declared range. Added a temporary read-only candidate workflow to generate a real Bun lockfile with a narrowly pinned override in a disposable runner, install frozen and rerun the audit. Its public manifest/lockfile diff is emitted only after successful candidate audit. No automatic push, no credential use, no production deployment. The override requires review and full application, emulator, IPC and browser regression tests before it can be accepted. The existing blocking dependency gate remains intact; the actual fix has not yet been committed. Prefer a compatible upstream Firestore release when available and independently verified.


### Candidate execution recovery

At `cd5cbde`, existing application, Firebase, history audit and hybrid workflows passed; the dependency advisory remained red. The standalone gRPC candidate workflow was present in source but no corresponding run was returned by the available GitHub connector. The local environment has neither Bun nor DNS access to the package registry. To avoid fabricating integrity hashes or modifying an unresolved lockfile, moved the candidate generation into the already-running dependency advisory workflow as an independent, failure-triggered read-only job restricted to pushes on the reconciliation branch. The original advisory job remains unchanged and blocking. The candidate job does not turn a failed scan green, auto-push a patch, or modify the running application. The reviewed registry-generated patch and exact-head regression results remain required.

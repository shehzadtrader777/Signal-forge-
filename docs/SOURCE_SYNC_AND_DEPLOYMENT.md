# Signal Forge — Source Sync and Deployment Gate

Updated: 2026-11-27. This is a release procedure, not proof of deployment.

## Current source of truth
- AI Studio exported ZIP: `signal-forge-nov-27-2026-12-07-55-am.zip` (user-held export).
- GitHub `main` is older than the exported application and must NOT replace it.
- This PR intentionally fixes CI and source exclusions only; it does not import the ZIP's application code.
- Repository is public: never upload `.backups/`, `.aistudio/`, `.env*`, token files, private data, or generated caches.

## Safe import procedure
1. Keep a second untouched copy of the ZIP and capture the existing `main` commit SHA.
2. Create a new branch based on `main` (not the live release branch, if different).
3. Unpack export into a clean temporary directory; remove AI Studio metadata, backups, local data and secret material. Inspect files for embedded keys before any push.
4. Compare exported source with `main` file by file; preserve deliberate GitHub-only edits (particularly README and workflow fixes). Do not blanket overwrite repository metadata.
5. Copy only reviewed application files to the source-sync branch; retain the CI workflow fixes and protective `.gitignore`.
6. Run `bun install --frozen-lockfile`, `bun run lint`, `bun run test`, and `bun run build` in the clean checkout. Investigate failures rather than bypassing gates.
7. Open a draft PR containing migration inventory, security notes, and changed-file summary. Merge only after reviews and CI pass.

## Deployment is separate from GitHub sync
- The current `.github/workflows/ci.yml` performs tests/builds only. It has **no deploy step**.
- `package.json` uses `tsx server.ts` for start and `vite build` for frontend; both frontend hosting and Express runtime compatibility must be assessed.
- Identify actual public website URL, hosting service, deployment branch and linked GitHub repo before configuring auto-deploy.
- Configure required runtime environment variables as secrets in the hosting provider, never in GitHub source.
- First deploy to staging/preview; verify API routes, Firebase rules/auth, alert delivery, health checks, and rollback.
- Only then enable reviewed production deployment from a protected branch.
- Do not enable live trading or move real funds as part of an unverified deployment.

## Direction of sync
- Pull = GitHub → AI Studio.
- Push = AI Studio/local working tree → GitHub.
- A GitHub PR/merge does not update an already running website unless the hosting provider is connected and successfully deploys it.
- AI Studio usage limit resetting does not automatically synchronize the two codebases or deploy the app.

## Final AI Studio sync readiness: 28 November 2026

**Status: HOLD / draft PR; not yet ready for final synchronization.**

- Latest Studio export (owner-held): 27 November 2026, 04:59 local snapshot. Active source tree contains 322 files; 273 matched the original reconciliation commit exactly, 49 diverged, and 80 GitHub-only protective files must be preserved. Subsequent three-way analysis classified older main-equivalent files and minor formatting differences, but substantial source conflicts and system trust boundaries remain.
- The reviewed GitHub reconciliation PR can have green CI without being a complete AI Studio import. Passing PR checks only certifies the code on that exact GitHub SHA, not the unmerged Studio snapshot.
- **Manual browser-submitted realized gain** is denied in production and by default in nonproduction. The only permitted temporary exception is explicitly enabling the unverified research demonstration on an isolated nonproduction host; it does not verify exchange settlement.
- **Cloud PnL/vault records are not a verified ledger:** the Firestore rules currently permit authenticated client writes to financial data and the UI retains direct Firebase write paths. Do not present these as server-authoritative capital/settlement balances. Before release, add a trusted server/Admin SDK write path with audited settlement provenance, a migration for existing demo documents, and Firebase emulator tests proving forged but schema-valid financial writes are rejected.
- Perform owner-controlled full-history secrets investigation and rotate any exposed credentials before a public release; GitHub ignore patterns cannot retract historical leaks.
- Independently validate operator/role gates, Firestore production rules, market feed provenance, rollback behavior, and end-to-end smoke tests. Obtain written product/security signoff for the complete combined source commit.
- The original AI Studio app remains linked to the older default branch. Because changes exist on both sides, **never directly click Pull or Push on the original app as a reconciliation shortcut**. Preserve a fresh Studio export, first test the reviewed reconciled source in an isolated staging import/project, and only adopt it after functional parity, explicit backups, and approval.
- GitHub PR merge, AI Studio import/sync, hosting deployment, and live exchange execution are **four separate actions**. None should be inferred from green CI.

### Completion evidence required

| Gate | Proof required | Current state |
| --- | --- | --- |
| Studio semantic conflict reconciliation | Reviewed 3-way changes plus feature parity tests | Open |
| Financial ledger authority | Trusted server-side settlement source + rules emulator rejection | Open |
| Historical secret scan and rotation | Private findings triage / remediation log | Open |
| Full merged-source CI | Exact candidate SHA + success across workflows | Open |
| AI Studio isolated staging | Backup, staging app import and smoke tests | Not performed |
| Main PR approval | Explicit owner approval after critical blockers close | Not granted |
| Production launch/live execution | Independent release and trading safety approval | Not authorized |

Keep PR Draft, preserve main, do not deploy, and leave LIVE trading disabled.

### Interim process-global vault ownership control

Until vault/PnL data has a verified **per-user, server-authoritative settlement ledger**, the existing in-process `profitVaultEngine` is shared across sessions. **Do not treat it as a tenant-isolated user vault.** As an interim containment measure, all four relevant endpoints are restricted to independently verified owner-level access in the reconciliation branch:

- `GET /api/vault/state`
- `POST /api/vault/config`
- `POST /api/vault/record-gain` (also nonproduction-demo-only)
- `POST /api/vault/manual-override`

This intentionally means non-owner operators will not be able to use the legacy shared Vault UI/API, instead of being allowed to view or mutate a global financial snapshot. Before restoring multi-user access, design explicit `userId` partitioning and server-authenticated ledger write/read authorization, migrate data safely, and test cross-user isolation, replay and financial invariants in an emulator or staging runtime. **Green repository CI does not attest to deployed Firebase rules or production financial provenance.**

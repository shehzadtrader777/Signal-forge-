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

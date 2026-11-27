# AI Studio export migration inventory — 27 November 2026

Source archive: `signal-forge-nov-27-2026-12-07-55-am.zip` (user-provided; **not** uploaded to public GitHub).

## Verified archive counts
- 2,568 archive entries including directories; 2,390 regular files.
- 322 regular-file candidates remain after excluding `.backups/` and `.aistudio/`; together about 6.73 MB unpacked.
- Candidate application directories: `src/` (272 files), `hybrid_core/` (11), `signal_forge_core/` (10), `fable_5_2/` (7), and `kernels/` (3).
- Largest source file: `server.ts` (618,374 bytes). `src/context/AppContext.tsx` is 228,487 bytes.
- Configuration candidates include `bun.lock`, `package.json`, `firestore.rules`, `firebase-applet-config.json` and `.env.example`; all require content review before committing.
- Asset files, including personal images, require explicit inclusion decisions; avoid publishing unrelated/private images.

## Import checklist (not yet completed)
- [x] Inspect archive names and identify backup/AI Studio folders
- [x] Establish isolated migration branch based on preflight development branch
- [ ] Review each candidate for secrets, credentials, tokens, personal information and export-only artifacts
- [ ] Review differences against GitHub main, preserving GitHub-only README changes
- [ ] Import reviewed source files as coherent commits; avoid a blind overwrite
- [ ] Run typecheck, unit tests, lockfile install and production build
- [ ] Verify Firebase emulators/rules and external integration fallbacks without live credentials
- [ ] Open draft migration PR and complete review
- [ ] Sync verified source back into AI Studio draft (not automatic)
- [ ] Publish only with explicit future permission (currently prohibited)

**Safety:** This branch contains inventory/planning only until the source review and actual imports are performed. No production deployment or live-trading activation.

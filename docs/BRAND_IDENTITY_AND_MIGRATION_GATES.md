# Signal Forge — Brand, Account Identity & Source Migration Gates

## Brand direction (development candidate)
- Brand name: Signal Forge; symbol: geometric forge shield carrying a rising signal path.
- Primary source asset: `public/signal-forge-mark.svg` (scales to nav, mobile, favicon and app icon).
- Use consistent symbol, type rhythm, palette and spacing across landing, pricing, dashboard and authentication.
- Logo uniqueness is an **artistic design goal**, not a trademark clearance or guarantee. Perform global trademark, domain, logo-similarity and design clearance before public rollout.
- Avoid invented performance numbers, accuracy guarantees or a misleading exchange endorsement.

## Account identity implementation
- Authentication owner key: Firebase Authentication UID. It is the sole principal source of truth; ignore IDs supplied in request bodies for authorization.
- User-visible permanent reference: `SF-` followed by the Firebase UID. One-to-one with the immutable auth identity; useful for support reference and cross-service internal lookup.
- Firestore profile path: `users/{uid}`. `publicId` is explicitly bound in rules to `'SF-' + userId`, is write-once (existing profiles are allowed to add it once) and cannot be assigned to another authenticated user.
- Signup with email creates Firebase Auth UID immediately. Firestore profile sync **waits for verified email** by existing security policy. Google verified users sync on login.
- Never use publicId as a password, API key, secret, session credential, invoice payment authorization or replacement for Firebase token verification.
- Do not present the public reference as anonymous: it encodes Firebase UID. Before public profile sharing, build a separate opaque, server-minted alias and private mapping.
- For account merges, deletion, migration, fraud recovery, GDPR-equivalent privacy requests and provider changes, use a reviewed admin process; never recycle old identity or silently overwrite user records.
- Deployment compatibility: Firestore rules and client code must be released together, with emulator tests for create, legacy backfill, unchanged ID, unauthorized owner and mutation rejection.

## Source reconciliation reality
- Original AI Studio export (27 Nov): 2,568 ZIP entries including backup and private workspace artifacts.
- Clean source preflight ZIP (27 Nov): 316 entries, approx. 6.1 MB uncompressed; no traversal paths in inspected archive. This is NOT a full security or secret audit.
- Existing GitHub `main` is older than exported source. **Do not wipe main, overwrite README or blindly upload ZIP**.
- Import only vetted source files from the clean archive into a dedicated reviewed branch. Compare current branch code against export; preserve newer UI, authentication, Firestore rules and all protective edits.
- Reconcile `server.ts`, package files and the full app tree; check for credentials even in source code and tests. Verify third-party licenses and generated artifacts.
- Do not merge until build/test/lint/security review, visual smoke tests, Firebase emulator policy tests and production rollback checklist all pass.

## Gate status (27 Nov 2026)
- SVG mark: coded candidate, **not brand clearance**.
- User account reference and profile mapping: code prepared, **not deployed/verified against live Firebase**.
- UI: landing/roadmap/plans/navigation code prepared, **not fully tested**.
- AI Super Guide: curated read-only help exists. LLM-backed conversational service remains unbuilt.
- Source migration: exported archive found and preflight inspected, **actual full source reconciliation/migration remains pending**.
- Production: unchanged. Live trading: locked.

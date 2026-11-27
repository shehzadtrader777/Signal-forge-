# Signal Forge: Secrets and Release Safety Gate

## Purpose
Security-first review for GitHub public documentation, Google AI Studio migration, and any future cloud/OSS-program submissions. This is a **checklist**, not evidence that production security has passed.

## Confirmed observations from repository review
- The `.gitignore` excludes `.env*` other than `.env.example`, plus several key/certificate formats, backups and ZIP archives.
- The old environment template contained a literal contact email; the new template leaves contact fields blank.
- `VITE_CMC_API_KEY` has a `VITE_` prefix. In standard Vite builds, these values can be included in client-side assets. **Do not use it to hold a private CoinMarketCap secret.** Migration to a server-side credential and API proxy is a separate code change not completed by these documentation edits.
- Fable operator approval information has been surfaced to frontend components in the reviewed source. The server-side authorization design needs remediation and independent tests before live features.
- Bybit, OKX, Binance and other exchange API credentials have **not** been verified as present in active Google AI Studio or hosting secret stores.

## Mandatory before any public push / AI Studio sync
1. Preserve an offline backup of known-good source and a clean dev branch. Do not export `.env`, provider credentials or database dumps into public archives.
2. Run an authenticated secret scanner against **all Git history**, not only the latest files. Investigate each finding privately. Ignore rules cannot undo a previously committed secret.
3. Rotate/revoke any key that has ever been committed, displayed in browser code, shared in a public log, or exposed in a public URL. Remove it from history only with a carefully planned procedure; rotation comes first.
4. Do not put secrets in `VITE_*`, `NEXT_PUBLIC_*`, `PUBLIC_*`, or other client-accessible configuration. Move third-party requests needing secret keys to protected server handlers.
5. Separate paper/testnet and live credentials by project/environment; default to no live trading. Apply read-only/minimal exchange permissions and IP restrictions when supported.
6. Ensure server-side approval is tied to the authenticated operator, user role, expiry, one-time use, audit trail, and anti-replay controls. Never trust an approval token sent back from a freely available browser snapshot.
7. Run Firebase rules/emulator tests, authenticated route authorization tests, dependency review, mobile/accessibility QA, `npm run verify` and branch CI. Keep results documented.
8. Ensure Google AI Studio project-level variables, deployed runtime secrets and local values are compared **by name and configured status only**. Never dump values in chat or diagnostic output.
9. Review README/license choice and verify only authorized documents are public. A public repository is not automatically open-source licensed.
10. Approve release only after security and product sign-off. An OSS-program application does not require enabling live exchange features.

## Protecting code ownership and intellectual property
- **No LICENSE chosen yet:** preserve the decision with the owner. For third-party adoption and genuine open-source eligibility, a legitimate OSI-approved license may eventually be needed; it grants defined rights and cannot be called “fully private”.
- Keep proprietary strategies, secrets, datasets, customer data, private orchestration methods and unready backend modules in a **private repository** or private infrastructure if they are not intended for public reuse. Removing them from the current version does not remove historical exposure.
- A separate public documentation/demo repository can present research scope and contribution guidance without exposing proprietary source. Avoid claiming eligibility until contributions and program requirements are established.
- Enable 2FA, least-privilege collaborators, branch protection and dependency/secret alerts where available.

## Open blockers
- Secret scan of the full commit history is not yet completed.
- Production/cloud secret configuration is not verifiable from this code review.
- The operator approval-token exposure requires a code fix, not just a security policy.
- CoinMarketCap client-side credential routing requires a code fix before it can be called secret-safe.
- No production release, license approval or Claude OSS program approval has been verified.

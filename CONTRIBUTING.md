# Contributing to Signal Forge

Thank you for your interest in a clearer, safer trading research platform.

## Project state
Signal Forge is in active development. Some work exists only in a development pull request. Please read the [README](README.md), including the license notice, before using or contributing code.

## Helpful contributions
Documentation corrections, clearer UX, accessibility, localization, reproducible defects, reliable unit tests and testnet-only integration improvements are welcome. Proposals for new trading/execution behavior require additional security and risk review.

## Suggested workflow
1. Check existing issues and PRs before starting to avoid duplicated work.
2. For large changes, open an issue describing intended behavior, data sources, and safety implications.
3. Keep changes focused and describe the user problem they solve.
4. Run `npm run verify` when applicable. Note any tests you could not run.
5. In PRs, include before/after screenshots for UI changes and precise reproduction steps for bugs.
6. Never include credentials, personal information, private source exports, or real customer data.

## Safety constraints
- No hidden or automatic live-trading activation.
- No bypasses of authentication, subscription gates, or human approval.
- AI guidance must remain read-only unless the owner explicitly authorizes a separately reviewed design.
- Label generated, illustrative, backtested and paper-traded results correctly.
- Security issues should be reported privately according to [SECURITY.md](SECURITY.md), not disclosed in a public issue.

## Reviews
Maintainers may request changes or decline contributions that are out of scope. A passing build is not equivalent to production approval. No contribution is guaranteed to merge.

## Licensing
A project license has not yet been selected. Do not assume that the public repository grants blanket rights to redistribute code. Clarify contributor and project licensing with the maintainer before submitting substantial third-party code.

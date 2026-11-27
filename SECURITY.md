# Security Policy

## Status
Signal Forge is under active development and **is not currently asserted to be production-ready or safe for real-money trading**. Integration security testing, approval-gate hardening, and provider configuration reviews are ongoing.

## Reporting vulnerabilities
**Do not open public GitHub issues with secrets, exploit details, user data, or steps that could be actively abused.**

If GitHub's **Report a vulnerability** / private vulnerability reporting option is available for this repository, use it to share a concise private report. If it is not enabled, ask the repository owner to establish a private reporting channel; do not publish sensitive details while waiting.

Include affected paths and versions, expected vs actual behavior, minimal safe reproduction steps, and estimated impact. Never send production keys.

## Priority risk areas
- AI and operator approval tokens must not be returned to unauthorized browser clients.
- Server secrets, trading credentials and private user data must never appear in the frontend bundle, logs or Git history.
- Testnet/paper modes must remain isolated from live exchange access.
- Firebase authorization rules must be enforced and tested, not only hidden behind UI controls.
- Third-party webhook verification, rate limiting and safe error responses require review.

## Supported versions
No production or long-term-supported release is currently declared. Development work should not be considered a security support commitment.

## Responsible disclosure
Please allow the maintainer time to investigate privately and coordinate fixes before any public write-up. There is currently no formal security response SLA.

# SIGNAL FORGE
### Forge Your Edge · Trading research, backtesting & AI-guided analysis

[![Development](https://img.shields.io/badge/status-active%20development-B88A50)](https://github.com/shehzadtrader777/Signal-forge-/pull/2)
[![Research first](https://img.shields.io/badge/trading-research%20%26%20paper%20only-444444)](#safety-and-scope)
[![Contributions](https://img.shields.io/badge/contributions-welcome-6B8E7C)](CONTRIBUTING.md)

> **Signal Forge is an evolving software project, not a production-certified trading service.** Functionality varies by branch; integrations, permissions, runtime data coverage and security must be independently validated before any real-money use.

## Overview

Signal Forge explores how to make trading research more understandable: transparent backtesting, distinct paper-trading workflows, interactive market analytics, and a cohesive premium interface. The goal is to combine beginner-friendly navigation with deeper tools for experienced researchers, **without confusing a simulation with verified live performance**.

**Repository:** [Source](https://github.com/shehzadtrader777/Signal-forge-) · [Development PR](https://github.com/shehzadtrader777/Signal-forge-/pull/2) · [Contribution guide](CONTRIBUTING.md) · [Security](SECURITY.md)

## Product direction

| Area | What it is | Current caveat |
| --- | --- | --- |
| Backtesting Research Lab | 30/60/90-day comparisons, strategy metrics and chart organization | Date coverage and data realism require validation |
| Advanced research | Expandable high-volume simulation and deeper analytics | Simulated outcomes are not proof of future returns |
| Paper Trading | Separated sandbox workflow for testing ideas without live orders | Full UI refinement and integration QA pending |
| Dark Forge / Light Forge | Premium gunmetal/bronze and clean ivory/graphite design variants | Cross-page consistency and account sync pending |
| AI Super Guide | Read-only user education and feature guidance | Full conversational backend pending |
| Identity & access | Firebase-linked account reference and permission controls | Emulator/security regression tests pending |
| Market data integrations | Architecture referencing external feeds and exchange connectors | Keys, permissions, provider access and coverage are not confirmed |

The **latest integrated source** is still being reconciled with an AI Studio export. Follow the development PR for work in progress; no production launch is implied.

## Design principles

- **Calm premium UI:** Manrope headings, Inter interface text, considered spacing, accessible contrast and restrained motion.
- **One research journey:** Overview → time range / strategy → metrics → equity curve → advanced details.
- **Separate modes:** Historical backtesting, paper trading and any future live capability are distinct.
- **Education, not execution:** The planned AI Super Guide has no order-placement or wallet permissions.
- **Safe defaults:** Secrets stay server-side; sensitive operations require independent authorization, auditability and tests.

## Technology

The current TypeScript application uses **React, Vite, Express, Firebase, Tailwind CSS, and charting components**. Some research and orchestration experiments have separate Python modules. Check the source and lockfiles for the precise implementation of each module.

## Local development

Use Node.js 22 and Bun for local development. Full verification also requires Python 3 and a stable Rust toolchain.

```bash
git clone https://github.com/shehzadtrader777/Signal-forge-.git
cd Signal-forge-
bun install --frozen-lockfile
cp .env.example .env
npm run dev
```

The example environment file is a **template, not configured credentials**. Leave live exchange variables blank in local development. Use only test or sandbox credentials when needed, and never commit a populated `.env`.

### Verification

On a host that supports Unix domain sockets, build the Rust engine and run the combined check against a temporary engine socket.

```bash
cargo test --locked --manifest-path hybrid_core/rust_engine/Cargo.toml --all-targets
cargo build --locked --manifest-path hybrid_core/rust_engine/Cargo.toml
python3 -m unittest discover -s hybrid_core/python_control_plane -p 'test_*.py' -v
sh scripts/verify-with-rust.sh hybrid_core/rust_engine/target/debug/signal_forge_rust_engine
```

## Roadmap

1. **Premium foundation:** coherent branding, landing, authentication, pricing preview, world-map concept and two theme variants.
2. **Research clarity:** organize 30/60/90-day backtesting, distinguish paper trading, expand charts and establish trustworthy data-coverage labels.
3. **Guided intelligence:** evolve the read-only educational Super Guide; test provider configuration and privacy boundaries.
4. **Security & readiness:** harden operator approval tokens, test Firebase rules, safeguard secrets, complete mobile/accessibility QA and reconcile exported source.
5. **Future exploration:** advanced research analytics and deeper modular integrations only after validation and review.

These are development goals, **not commitments that features are currently delivered**.

## Open collaboration

Suggestions, documentation corrections, accessibility feedback and reproducible bug reports are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

**License notice:** A repository-wide open-source LICENSE has not yet been selected. Public visibility does not automatically grant reuse rights. Until a license is published, do not assume rights to copy, modify or redistribute repository content beyond those granted by applicable law and GitHub's terms. Licensing is a project-owner decision.

## Safety and scope

- No trading strategy or simulation guarantees profit; financial loss is possible.
- Do not treat example charts, sample metrics or deterministic test data as validated market performance.
- Never post passwords, API keys, exchange secrets, Firebase service credentials or personal data in issues/PRs.
- Keep real-money execution disabled unless separately authorized and independently validated.
- Report suspected vulnerabilities using the instructions in [SECURITY.md](SECURITY.md).

---

**Build deliberately. Measure honestly. Forge responsibly.**

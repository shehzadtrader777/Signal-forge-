# Signal Forge — Global Scalability & Crash Resilience Engineering Audit
Date: 2026-11-27 | Branch: feature/ai-studio-source-migration
Status: STAGED CODE / RELEASE-GATED, NOT production capacity certification.

## Inspection coverage
Reviewed repo source in Node/TypeScript Express server, WebSocket/SSE telemetry, dashboard coordinator, hybrid SQLite strategy store, TypeScript and Python clone planning, Python-Rust IPC, Rust L2 simulator, Rust mmap feed, Dockerfile and CI workflows. This is a focused failure-mode/code-path inspection, **not** a line-by-line audit of every repository file or empirical traffic benchmark.

## Risk findings and code changes
| Priority | Observed issue | Implemented mitigation |
|---|---|---|
| CRITICAL | Python RustIpcBridge returned ok=true fake Rust ack when daemon missing, including order/risk commands | Fail closed with RUST_IPC_UNAVAILABLE; tests for missing socket and corrupt frame |
| CRITICAL | Python mmap writer packs 44 bytes per tick while Rust repr(C) has potentially 48-byte padded memory layout, causing incorrect alignment/unsafe casts | Rust explicitly decodes 44-byte little-endian frames, validates finite floats, enforces 256 MiB dataset cap, adds Rust decode tests |
| HIGH | Rust IPC socket at /tmp could be readable by unintended local users under permissive umask, and startup removed any file at path | 0600 mode and refuse to delete non-socket paths |
| HIGH | Rust IPC single-threaded read could block indefinitely on incomplete frame | Set 2-second read/write socket timeouts. Large scans STILL block event loop and need worker isolation |
| HIGH | Simulated Rust order router accepted invalid non-finite numbers and unrecognized sides | Validate quantity, price, slippage, depth, BUY/SELL side; reject unsafe payloads |
| HIGH | Rust dynamic risk updates could accept non-finite floats | Reject before writing risk envelope |
| HIGH | Node SSE connected clients had no global per-process cap or backpressure guard | Limit to 250 connections per instance, disconnect slow clients exceeding 512KiB buffered or failed write |
| HIGH | TS clone planner accepted up to 512 nodes and could plan millions of clones | Cap plan to 16 nodes x 256 clones per node with stress regression |
| MEDIUM | Python mmap writer allocated arbitrary user-controlled tick_count x 44 bytes | Cap 1..250,000 ticks and add regression tests |
| HIGH | Docker used npm ci OR npm install if lock missing, built without tests, ran as root | Frozen bun.lock v2 install, typed/unit/build checks in image build, non-root Node runtime, copy hybrid sources |
| HIGH | Previous Bun 1.3 image could not parse bun.lock v2 | Newer Bun builder in Docker; pin image digest only after Docker build passes. New CI detects compatibility |
| MEDIUM | No explicit staging load probe | Added opt-in read-only GET health/monitor stress probe, max 500 requests, 25 connections and latency/error thresholds |
| HIGH | Rust/Python/Docker were not required CI jobs | Added hybrid-resilience workflow with cargo test, python unittest, docker build |

## Important limitations still present
- **Production persistent state**: src/lib/hybridArchitectureServer.ts uses synchronous local node:sqlite DatabaseSync, seeds simulated examples on startup, and writes local .data path. A multi-replica deployment cannot treat this as a shared authoritative signal ledger. Move to durable managed DB; have migrations, backups, fencing, transactions and restore drills.
- **Durable global emergency halt**: existing 423 latch has in-memory state in Node. Deploy only after a shared durable latch is independently enforced on ALL order gateways and survives process restart, network partitions and leader failover. Owner WebAuthn/OTP flow incomplete.
- **Rust execution daemon concurrency**: listener handles connections serially; timeout mitigates stalled client but expensive mmap scans still starve subsequent requests. Move scans to bounded worker pool with explicit CPU/memory quotas, isolation and admission control; keep risk changes serialized.
- **Distributed rate limits and jobs**: Node uses in-process Map rate limiter, in-memory SSE listeners and local caches. Production needs Redis or managed shared rate limiting, centralized queue, idempotent workers, backpressure, leasing and per-tenant budgets.
- **Deployment topology**: Docker runtime does not automatically start Rust daemon or Python control plane; integration readiness requires separately managed services, health/readiness dependencies, network policy and IPC ownership. Rust/Python source being copied is not execution proof.
- **Security/correctness**: Rust mmap input path is caller-provided in IPC; require allowlisted canonical data root and symlink protections before opening trusted production files. Shared configuration/owner auth and provider API secrets require further hardening. Emergency modes remain fail-closed.
- **Telemetry**: /api/health only reports process liveness, not DB readiness, provider freshness or safety. Monitor metrics need real SLOs, alerting, workload shedding and long-running load/soak tests.
- **Signal/market integrity**: on-chain whale source verification, historical archive, genuine exchange-fill receipts, premium authorization, real WebSocket L2 provider reconciliation and paper/testnet evaluation remain outstanding.
- **Dependency reproducibility**: Docker uses a recent Bun builder to read v2 lockfile; pin image digest after successful build, retain SBOM/vulnerability scans, avoid mutable production base.

## Deployment topology for worldwide usage
1. CDN/edge WAF → geo load balancer with TLS termination and request limits → stateless API replicas (controlled scaling, health/readiness endpoints).
2. Durable managed relational database for accounts, audit events, signals, orders, idempotency, emergency seals, plus backups/migrations/restore testing.
3. Distributed cache/queue (Redis/managed queue), worker leases, rate limits and per-user quotas, bounded inference/candle pipelines with provider-fallback budgets.
4. Dedicated WS ingest service (one authorized venue subscription fan-out) → validated event bus → signal workers → append-only history + SSE/push fan-out.
5. Rust/Python worker pool separate from request loop, non-root isolation, bounded CPU/mem/time and strict IPC credentials/allowlisted files.
6. Dedicated emergency/risk control plane on server; durable 423 and zero-order guarantee through restarts/partitions.
7. Infrastructure telemetry: p50/p95/p99 latency, error rate, event-loop lag, heap/RSS, DB wait, queue age, dropped/late ticks, rate-limit responses, outage detection; burn-rate paging and rollback.

## Release tests (not yet proven)
- CI across Node, Rust, Python and Docker.
- Instrument staging load probe with declared throughput, 5m/1h soak and 5x surge tests; do NOT point at production without approval.
- Multi-replica chaos test: restart API/worker, kill Rust daemon, lose DB/Redis/network, malformed/oversize frames, provider disconnect, overload and retries.
- Validate signal audit history consistency, no duplicate orders, hard halt always latched; zero live execution on all pre-release tests.
- Verify 99th percentile budgets and hardware capacity from real measurements before any claim about global capacity.

## Verification
Source changes are committed to development branch. CI status must be checked on most recent commit. This document is not a claim that all weaknesses are eliminated, that the platform cannot crash, or that production is ready. Google AI Studio should receive a controlled staging sync only after newest CI and Docker build pass; LIVE remains locked.

# Signal Forge staging container. Reproducible Bun lockfile; no silent npm fallback.
# Use Bun only for frozen dependency installation, but execute the verification
# on real Node.js 22 (the Bun image aliases 'node' to its own runtime).
FROM oven/bun:latest AS bun_toolchain
FROM node:22-bookworm-slim AS builder
# Hybrid verification includes Python bridge subprocesses.
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=bun_toolchain /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN npm run verify

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Keep the runtime immutable except for explicitly mounted application state.
COPY --chown=node:node package.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server.ts ./server.ts
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/hybrid_core ./hybrid_core
COPY --from=builder --chown=node:node /app/signal_forge_core ./signal_forge_core
COPY --from=builder --chown=node:node /app/firebase-applet-config.json ./firebase-applet-config.json
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node

EXPOSE 3000
# Liveness only: this is not a provider readiness or execution-safety attestation.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./node_modules/.bin/tsx", "server.ts"]

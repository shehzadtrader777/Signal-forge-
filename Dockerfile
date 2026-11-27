# Signal Forge staging container. Reproducible Bun lockfile; no silent npm fallback.
FROM oven/bun:1.3-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN ./node_modules/.bin/tsx --test src/lib/*.test.ts \
 && ./node_modules/.bin/tsc --noEmit \
 && ./node_modules/.bin/vite build

FROM node:22-alpine AS runner
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
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["./node_modules/.bin/tsx", "server.ts"]

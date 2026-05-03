# syntax=docker/dockerfile:1.7

# Multi-stage build: install + compile TS, then ship a slim runtime.
# Built from the REPO ROOT (not from apps/scanner) because the scanner
# depends on @open-agents/db and @open-agents/crypto via pnpm workspaces.
# See fly.toml: build.dockerfile = apps/scanner/Dockerfile + dockerfile_target.

FROM node:20-alpine AS base
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

# ---- deps: install workspace dependencies (cached on lockfile change only) ----
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/scanner/package.json ./apps/scanner/
COPY packages/db/package.json ./packages/db/
COPY packages/crypto/package.json ./packages/crypto/
RUN pnpm install --frozen-lockfile --filter "@open-agents/scanner..."

# ---- build: compile TS for db + crypto + scanner (in dep order) ----
FROM deps AS build
COPY packages/db ./packages/db
COPY packages/crypto ./packages/crypto
COPY apps/scanner ./apps/scanner
RUN pnpm --filter @open-agents/crypto build \
 && pnpm --filter @open-agents/db build \
 && pnpm --filter @open-agents/scanner build

# ---- runtime: prod-only deps + compiled JS ----
FROM node:20-alpine AS runtime
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

COPY --from=build /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml /repo/package.json ./
COPY --from=build /repo/apps/scanner/package.json ./apps/scanner/
COPY --from=build /repo/packages/db/package.json ./packages/db/
COPY --from=build /repo/packages/crypto/package.json ./packages/crypto/
RUN pnpm install --frozen-lockfile --prod --filter "@open-agents/scanner..."

COPY --from=build /repo/apps/scanner/dist ./apps/scanner/dist
COPY --from=build /repo/packages/db/dist ./packages/db/dist
COPY --from=build /repo/packages/crypto/dist ./packages/crypto/dist

WORKDIR /repo/apps/scanner
ENV NODE_ENV=production
# Default: long-lived worker. Override CMD in fly.toml if you want
# the HTTP server (server.js) instead — that path supports the
# Alchemy webhook + manual /tick.
CMD ["node", "dist/worker.js"]

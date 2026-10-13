# syntax=docker/dockerfile:1.7
# One multi-stage Dockerfile, four runnable targets:  api · worker · web · tools (migrations, seed, bootstrap-admin, WordPress migration).
#   docker build --target api    -t hbvl-api    .
#   docker build --target worker -t hbvl-worker .
#   docker build --target web    -t hbvl-web    .
#   docker build --target tools  -t hbvl-tools  .
# No secret is baked into any image: configuration comes from the environment at run time.

ARG NODE_VERSION=24.21.0
ARG PNPM_VERSION=12.10.1

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@${PNPM_VERSION} && apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

# ── dependencies (cached while manifests are unchanged) ──
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY tests/package.json tests/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

# ── build everything (Prisma client → contracts → database → api → web) ──
FROM deps AS build
COPY apps ./apps
COPY packages ./packages
# `prisma generate` only needs the variable to exist (it never connects); the placeholder is not kept in the image environment.
RUN export MIGRATION_DATABASE_URL=postgresql://build:build@localhost:5432/build \
 && pnpm db:generate && pnpm --filter @hbvl/contracts build && pnpm --filter @hbvl/database build && pnpm --filter @hbvl/api build
# Web needs a public origin only to build absolute SEO URLs; the real value is injected at run time.
RUN pnpm --filter @hbvl/web build

# ── production-only trees ──
FROM build AS prune-api
RUN pnpm --filter @hbvl/api deploy --prod --legacy /out/api

# ── api ──
FROM node:${NODE_VERSION}-bookworm-slim AS api
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=prune-api --chown=node:node /out/api ./
USER node
EXPOSE 3101
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=5 CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3101)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]

# ── worker (same code, different entrypoint; no HTTP port) ──
FROM api AS worker
EXPOSE 0
HEALTHCHECK NONE
CMD ["node", "dist/worker.js"]

# ── web (Next.js standalone output) ──
FROM node:${NODE_VERSION}-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3100
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
USER node
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=5 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/web/server.js"]

# ── tools: migrations, seed, bootstrap admin, WordPress migration (full workspace, dev dependencies included) ──
FROM build AS tools
ENV NODE_ENV=production
USER root
WORKDIR /repo
CMD ["pnpm", "--filter", "@hbvl/database", "migrate:deploy"]

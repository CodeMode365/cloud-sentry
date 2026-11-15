# syntax=docker/dockerfile:1.7
#
# CloudSentry full application image: the static Next.js dashboard and the REST API served by one Node
# process (services/api/src/container/server.ts). See docs/docker.md for configuration.
#
#   docker build -t cloudsentry:local .
#   docker compose up -d --build          # with DynamoDB Local (local demo mode)

ARG NODE_VERSION=22.21.1

# ---------------------------------------------------------------------------------------------- base
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@9.15.4 && npm cache clean --force \
 && pnpm config set store-dir /pnpm/store
WORKDIR /repo

# ---------------------------------------------------------------------------------------------- deps
# Download every package in the lockfile into the pnpm store. Only the lockfile is copied, so this layer
# is reused until dependencies change.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=cloudsentry-pnpm-store,target=/pnpm/store pnpm fetch

# ---------------------------------------------------------------------------------------------- build
FROM deps AS build
COPY . .
# Install only what the API server and the dashboard need (plus their workspace dependencies).
RUN --mount=type=cache,id=cloudsentry-pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile \
      --filter "@cloudsentry/api..." --filter "@cloudsentry/web..."
# Static export of the dashboard -> apps/web/out; API + workflow code bundled into one ESM file.
RUN pnpm --filter @cloudsentry/web build \
 && pnpm --filter @cloudsentry/api bundle:container

# ---------------------------------------------------------------------------------------------- runtime
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="CloudSentry" \
      org.opencontainers.image.description="AWS cloud intelligence and cost optimization platform (dashboard + API)"
WORKDIR /app
COPY --from=build --chown=node:node /repo/services/api/dist/container/ ./
COPY --from=build --chown=node:node /repo/apps/web/out/ ./public/
RUN mkdir -p /app/data && chown node:node /app/data
# NODE_ENV is intentionally not set: local demo mode (STAGE=local) refuses to run with NODE_ENV=production.
ENV PORT=8080 \
    HOST=0.0.0.0 \
    PUBLIC_DIR=/app/public \
    DATA_DIR=/app/data
USER node
EXPOSE 8080
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "server.mjs"]

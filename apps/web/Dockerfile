FROM node:20-alpine AS base
RUN corepack enable pnpm

# Warm the pnpm store
FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch

# Prune to only include web and its dependencies
FROM deps AS pruner
RUN apk add --no-cache libc6-compat
ENV CI=true
COPY . .
# Install only root dependencies to get turbo
RUN pnpm install --frozen-lockfile --ignore-workspace --offline
RUN pnpm turbo prune "@megisholavonat/web" --docker

# Install dependencies from pruned workspace
FROM deps AS installer
RUN apk add --no-cache libc6-compat
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --offline

# Build the app
FROM base AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV CI=true
ENV SKIP_SERVER_ENV_VALIDATION=true
ENV NEXT_PUBLIC_TILE_CACHE_URL=https://tc.megisholavonat.info

# Copy installed dependencies and source code from pruned workspace
COPY --from=installer /app .
COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json

# Build using turbo (automatically builds dependencies first)
RUN pnpm turbo build --filter "@megisholavonat/web"

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN adduser --system --uid 1001 app

COPY --from=builder /app/apps/web/public /app/apps/web/public
COPY --from=builder --chown=app:app /app/apps/web/.next/standalone /app
COPY --from=builder --chown=app:app /app/apps/web/.next/static /app/apps/web/.next/static

USER app
EXPOSE 3000
ENV HOSTNAME="0.0.0.0" PORT=3000
CMD ["node", "apps/web/server.js"]
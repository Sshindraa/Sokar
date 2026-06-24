# Canal A — Dockerfile production
#
# Build multi-stage pour limiter la taille de l'image finale.
# Cf. spec canal-a-v1.1 §3 hébergement.

# ─── Stage 1: deps ───────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Install OS deps (sharp, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages ./packages
COPY apps/canal-a/package.json ./apps/canal-a/

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.8.0 --activate

# Install deps
RUN pnpm install --frozen-lockfile --filter @sokar/canal-a...

# ─── Stage 2: build ──────────────────────────────────────────
FROM deps AS build
WORKDIR /app

# Copy source
COPY apps/canal-a ./apps/canal-a
COPY packages ./packages

# Build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
WORKDIR /app/apps/canal-a
RUN pnpm build

# ─── Stage 3: runtime ─────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=4002
ENV HOSTNAME=0.0.0.0

# Install dumb-init for signal handling
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy standalone build
COPY --from=build --chown=node:node /app/apps/canal-a/.next/standalone /app
COPY --from=build --chown=node:node /app/apps/canal-a/.next/static /app/apps/canal-a/.next/static
COPY --from=build --chown=node:node /app/apps/canal-a/public /app/apps/canal-a/public

USER node
EXPOSE 4002

# dumb-init pour une bonne gestion des signaux (SIGTERM, etc.)
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/canal-a/server.js"]

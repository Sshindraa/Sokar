# `infra/` — local dev infrastructure

**Strategy B** (recommended for this monorepo): Docker runs **only
infrastructure** (Postgres, Redis, LocalStack). The API and dashboard
run natively on the host so pnpm workspace symlinks and incremental
TS compilation behave like a normal dev setup.

## Quick start

```sh
# 1. Create the root env file (one-time)
#    .env.local at the repo root is the single source of truth for dev infra.
#    See infra/.env.example for which vars are expected.
cp infra/.env.example .env.local  # then edit .env.local with real values

# 2. Start the infrastructure stack
pnpm infra:up
# (equivalent to: docker compose --env-file .env.local -f infra/docker-compose.yml up -d)

# 3. Verify health
docker compose -f infra/docker-compose.yml ps
# All three (postgres, redis, localstack) should be 'healthy' within ~10s

# 4. Run the API + dashboard natively (separate terminals, or via pnpm dev)
pnpm dev
```

## What's inside

| Service      | Image                       | Port (host)    | Purpose                              |
| ------------ | --------------------------- | -------------- | ------------------------------------ |
| `postgres`   | `postgres:16-alpine`        | 127.0.0.1:5432 | Primary DB (`sokar` database)        |
| `redis`      | `redis:7-alpine`            | 127.0.0.1:6379 | Cache + BullMQ queue                 |
| `localstack` | `localstack/localstack:4.2` | 127.0.0.1:4566 | AWS emulation (S3, SQS, SES, Lambda) |

Ports are bound to `127.0.0.1` (loopback) only — not exposed to the LAN.
The infra is intended for local dev or a single-host VPS; the API/dashboard
talk to it over loopback.

## Why not full Docker for the app too?

We tried it (Strategy A in `~/.hermes/skills/devops/sokar-deployment/`).
Two blockers:

1. **pnpm monorepo + Docker** — workspace symlinks survive into the image
   but `prisma generate` and the workspace build order need careful
   multi-stage orchestration; first-time setups hit 10+ minute builds.
2. **Apple Double file corruption** — files copied via macOS into a
   Docker build context sometimes carry spurious `._*` AppleDouble
   metadata, which breaks `pnpm install` inside the image.

Strategy B sidesteps both: Docker for boring stateful infra, native
Node for the apps.

## Reset / wipe

```sh
# Stop and delete everything (containers + volumes)
pnpm infra:down -v
# (equivalent to: docker compose -f infra/docker-compose.yml down -v)

# Just restart one service
docker compose -f infra/docker-compose.yml restart postgres
```

## Common commands

```sh
# Tail logs
docker compose -f infra/docker-compose.yml logs -f --tail=50

# Connect to Postgres
docker compose -f infra/docker-compose.yml exec postgres psql -U sokar

# Connect to Redis
docker compose -f infra/docker-compose.yml exec redis redis-cli
```

## Production (VPS) notes

The VPS uses the same `docker-compose.yml` to run Postgres + Redis, but
the API and dashboard are managed by `pm2` (see
`/opt/sokar/infra/ecosystem.config.js`). Don't try to dockerize the apps
on the 4GB VPS — Next.js build OOMs without aggressive pre-build cleanup.

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.8.0 --activate

FROM base AS builder
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/api ./apps/api
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sokar/database exec prisma generate
RUN pnpm build --filter=@sokar/api

FROM base AS runner
WORKDIR /app
COPY --from=builder /app .
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

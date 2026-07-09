/**
 * @sokar/shared — types, enums, and labels shared between API and dashboard.
 *
 * Rules of engagement:
 * - NO runtime dependencies on server-only packages (Prisma, Fastify, BullMQ).
 * - NO secrets, no env access, no side effects.
 * - Mirrors of Prisma enums live here; if you change the Prisma schema,
 *   mirror the change here in the same commit.
 *
 * Adding a new module: create `src/<domain>.ts`, re-export from this barrel.
 */

export * from './plan';
export * from './reservation';
export * from './call';
export * from './agent';
export * from './api';
export * from './jsonld';
export * from './utils/fetch-with-timeout';
export * from './utils/format';
export * from './utils/opening-hours';

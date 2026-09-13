import { Prisma, type OutboxEvent, type OutboxStatus } from '@prisma/client';
import { db } from '../db/client';

const LEASE_MS = 5 * 60 * 1_000;
const MAX_BATCH_SIZE = 100;

export interface OutboxEventInput {
  readonly restaurantId?: string | null;
  readonly topic: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly schemaVersion?: number;
  readonly payload: Record<string, unknown>;
  readonly idempotencyKey: string;
  readonly availableAt?: Date;
}

type OutboxWriter = Pick<typeof db, 'outboxEvent'>;

function requireText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} must contain between 1 and ${maxLength} characters`);
  }
  return normalized;
}

/**
 * Outbox payloads are identifiers and facts only. Keeping obvious customer
 * fields out of the event prevents PII from being copied into queues/logs.
 */
function assertPiiFreePayload(payload: Record<string, unknown>): void {
  const forbidden = /(?:phone|email|customername|fullname|transcript|messagebody|secret|token)/iu;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (forbidden.test(key)) throw new Error(`outbox payload contains forbidden field: ${key}`);
      visit(nested);
    }
  };
  visit(payload);
}

function normalizeInput(input: OutboxEventInput): OutboxEventInput {
  assertPiiFreePayload(input.payload);
  return {
    ...input,
    restaurantId: input.restaurantId ?? null,
    topic: requireText(input.topic, 'topic', 64),
    aggregateType: requireText(input.aggregateType, 'aggregateType', 64),
    aggregateId: requireText(input.aggregateId, 'aggregateId', 191),
    eventType: requireText(input.eventType, 'eventType', 128),
    idempotencyKey: requireText(input.idempotencyKey, 'idempotencyKey', 255),
    schemaVersion: input.schemaVersion ?? 1,
    availableAt: input.availableAt ?? new Date(),
  };
}

function payloadEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameEvent(existing: OutboxEvent, input: OutboxEventInput): boolean {
  return (
    existing.restaurantId === (input.restaurantId ?? null) &&
    existing.topic === input.topic &&
    existing.aggregateType === input.aggregateType &&
    existing.aggregateId === input.aggregateId &&
    existing.eventType === input.eventType &&
    existing.schemaVersion === (input.schemaVersion ?? 1) &&
    payloadEquals(existing.payload, input.payload)
  );
}

/**
 * Insert an event in the caller's transaction. The same idempotency key is a
 * safe replay; reusing it for another payload is rejected.
 */
export async function enqueue(
  writer: OutboxWriter,
  input: OutboxEventInput,
): Promise<{ event: OutboxEvent; created: boolean }> {
  const normalized = normalizeInput(input);
  const existing = await writer.outboxEvent.findUnique({
    where: { idempotencyKey: normalized.idempotencyKey },
  });
  if (existing) {
    if (!sameEvent(existing, normalized)) {
      throw new Error(`Outbox idempotency key conflict: ${normalized.idempotencyKey}`);
    }
    return { event: existing, created: false };
  }

  try {
    const event = await writer.outboxEvent.create({
      data: {
        restaurantId: normalized.restaurantId,
        topic: normalized.topic,
        aggregateType: normalized.aggregateType,
        aggregateId: normalized.aggregateId,
        eventType: normalized.eventType,
        schemaVersion: normalized.schemaVersion,
        payload: normalized.payload as Prisma.InputJsonValue,
        idempotencyKey: normalized.idempotencyKey,
        availableAt: normalized.availableAt,
      },
    });
    return { event, created: true };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
    const raced = await writer.outboxEvent.findUnique({
      where: { idempotencyKey: normalized.idempotencyKey },
    });
    if (!raced || !sameEvent(raced, normalized)) {
      throw new Error(`Outbox idempotency key conflict: ${normalized.idempotencyKey}`);
    }
    return { event: raced, created: false };
  }
}

export async function enqueueOnDatabase(
  input: OutboxEventInput,
): Promise<{ event: OutboxEvent; created: boolean }> {
  return enqueue(db, input);
}

/** Claim rows atomically; PostgreSQL SKIP LOCKED allows multiple dispatchers. */
export async function claimPending(
  limit = MAX_BATCH_SIZE,
  now = new Date(),
): Promise<OutboxEvent[]> {
  const requestedLimit = Number.isFinite(limit) ? Math.floor(limit) : MAX_BATCH_SIZE;
  const boundedLimit = Math.max(1, Math.min(requestedLimit, MAX_BATCH_SIZE));
  return db.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH candidates AS (
        SELECT id
        FROM outbox_events
        WHERE status = 'PENDING'
          AND available_at <= ${now}
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${boundedLimit}
      )
      UPDATE outbox_events AS events
      SET status = 'DISPATCHING',
          locked_at = ${now},
          attempts = events.attempts + 1,
          updated_at = ${now}
      FROM candidates
      WHERE events.id = candidates.id
      RETURNING events.id
    `);
    if (!claimed.length) return [];
    return tx.outboxEvent.findMany({
      where: { id: { in: claimed.map(({ id }) => id) } },
      orderBy: { createdAt: 'asc' },
    });
  });
}

export async function markDispatched(id: string, dispatchedAt = new Date()): Promise<void> {
  await db.outboxEvent.updateMany({
    where: { id, status: 'DISPATCHING' as OutboxStatus },
    data: {
      status: 'DISPATCHED',
      lockedAt: null,
      dispatchedAt,
      lastErrorCode: null,
    },
  });
}

export async function releaseForRetry(
  id: string,
  errorCode: string,
  availableAt = new Date(Date.now() + 30_000),
): Promise<void> {
  await db.outboxEvent.updateMany({
    where: { id, status: 'DISPATCHING' as OutboxStatus },
    data: {
      status: 'PENDING',
      availableAt,
      lockedAt: null,
      lastErrorCode: requireText(errorCode, 'errorCode', 128),
    },
  });
}

export async function recoverExpiredLeases(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - LEASE_MS);
  const result = await db.outboxEvent.updateMany({
    where: { status: 'DISPATCHING' as OutboxStatus, lockedAt: { lt: cutoff } },
    data: { status: 'PENDING', availableAt: now, lockedAt: null, lastErrorCode: 'LEASE_EXPIRED' },
  });
  return result.count;
}

export const OUTBOX_LEASE_MS = LEASE_MS;

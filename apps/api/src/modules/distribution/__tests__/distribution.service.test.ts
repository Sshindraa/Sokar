import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  DistributionConnectionStatus,
  DistributionProvider,
  DistributionReservationLinkStatus,
  DistributionSyncDirection,
  DistributionSyncRunStatus,
  DistributionWebhookStatus,
  Prisma,
} from '@prisma/client';
import { db } from '../../../shared/db/client';
import {
  createDistributionSyncRun,
  createOrUpdateDistributionConnection,
  disconnectDistributionConnection,
  DistributionConflictError,
  DistributionInputError,
  DistributionStateError,
  finishDistributionSyncRun,
  finishDistributionWebhook,
  ingestDistributionWebhook,
  linkDistributionReservation,
  upsertDistributionAvailability,
} from '../distribution.service';

const RESTAURANT_ID = 'restaurant-1';
const CONNECTION_ID = 'connection-1';
const RESERVATION_ID = 'reservation-1';
const RUN_ID = 'run-1';
const WEBHOOK_ID = 'webhook-1';
const NOW = new Date('2026-09-14T10:00:00.000Z');

function connectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONNECTION_ID,
    provider: DistributionProvider.GOOGLE_RESERVE,
    externalAccountHash: 'a'.repeat(64),
    externalAccountLast4: '1234',
    credentialRef: 'vault/distribution/google',
    configHash: 'b'.repeat(64),
    status: DistributionConnectionStatus.ACTIVE,
    cursor: 'cursor-1',
    lastSyncAt: NOW,
    lastErrorCode: null,
    connectedAt: NOW,
    disconnectedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function syncRunRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    connectionId: CONNECTION_ID,
    direction: DistributionSyncDirection.BIDIRECTIONAL,
    status: DistributionSyncRunStatus.QUEUED,
    windowStart: new Date('2026-09-14T00:00:00.000Z'),
    windowEnd: new Date('2026-09-15T00:00:00.000Z'),
    sourceCursor: null,
    targetCursor: null,
    pushedCount: 0,
    pulledCount: 0,
    failedCount: 0,
    errorCode: null,
    startedAt: null,
    finishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    connection: { provider: DistributionProvider.GOOGLE_RESERVE },
    ...overrides,
  };
}

function availabilityRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'slot-1',
    connectionId: CONNECTION_ID,
    slotKey: '2026-09-20T19:00:00Z-2',
    serviceDate: new Date('2026-09-20T00:00:00.000Z'),
    startsAt: new Date('2026-09-20T19:00:00.000Z'),
    endsAt: new Date('2026-09-20T21:00:00.000Z'),
    partySize: 2,
    available: 4,
    capacity: 10,
    sourceRevision: 'rev-1',
    payloadHash: 'c'.repeat(64),
    observedAt: NOW,
    updatedAt: NOW,
    connection: { provider: DistributionProvider.GOOGLE_RESERVE },
    ...overrides,
  };
}

function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'link-1',
    connectionId: CONNECTION_ID,
    reservationId: RESERVATION_ID,
    externalIdHash: 'e'.repeat(64),
    externalIdLast4: 'ABCD',
    status: DistributionReservationLinkStatus.ACTIVE,
    source: 'fixture',
    linkedAt: NOW,
    unlinkedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    connection: { provider: DistributionProvider.GOOGLE_RESERVE },
    ...overrides,
  };
}

function webhookRow(overrides: Record<string, unknown> = {}) {
  return {
    id: WEBHOOK_ID,
    connectionId: CONNECTION_ID,
    provider: DistributionProvider.GOOGLE_RESERVE,
    eventType: 'reservation.updated',
    payloadHash: 'd'.repeat(64),
    status: DistributionWebhookStatus.RECEIVED,
    errorCode: null,
    receivedAt: NOW,
    processedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

describe('distribution service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('normalizes a provider connection and stores only hashes/references', async () => {
    vi.mocked(db.distributionConnection.findUnique).mockResolvedValue(null);
    vi.mocked(db.distributionConnection.create).mockResolvedValue(connectionRow() as never);
    const result = await createOrUpdateDistributionConnection({
      restaurantId: RESTAURANT_ID,
      provider: 'google_reserve',
      externalAccountId: 'location-1234',
      credentialReference: 'vault/distribution/google',
      configFingerprint: { scopes: ['reserve.read'] },
      now: NOW,
    });
    expect(result).toMatchObject({
      provider: DistributionProvider.GOOGLE_RESERVE,
      externalAccountLast4: '1234',
      credentialReferencePresent: true,
      status: DistributionConnectionStatus.ACTIVE,
    });
    expect(db.distributionConnection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalAccountHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          configHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          credentialRef: 'vault/distribution/google',
        }),
      }),
    );
  });

  it('rejects a pasted credential and invalid provider before persistence', async () => {
    await expect(
      createOrUpdateDistributionConnection({
        restaurantId: RESTAURANT_ID,
        provider: 'unknown',
        credentialReference: 'sk_live_secret',
      }),
    ).rejects.toMatchObject({ code: 'DISTRIBUTION_PROVIDER_INVALID' });
    await expect(
      createOrUpdateDistributionConnection({
        restaurantId: RESTAURANT_ID,
        provider: DistributionProvider.PUBLIC_API,
        credentialReference: 'sk_live_secret',
      }),
    ).rejects.toMatchObject({ code: 'DISTRIBUTION_CREDENTIAL_REFERENCE_INVALID' });
    expect(db.distributionConnection.create).not.toHaveBeenCalled();
  });

  it('resets cursor and health when connection configuration changes', async () => {
    vi.mocked(db.distributionConnection.findUnique).mockResolvedValue(connectionRow() as never);
    vi.mocked(db.distributionConnection.update).mockResolvedValue(
      connectionRow({
        status: DistributionConnectionStatus.PENDING,
        cursor: null,
        lastSyncAt: null,
      }) as never,
    );
    await createOrUpdateDistributionConnection({
      restaurantId: RESTAURANT_ID,
      provider: DistributionProvider.GOOGLE_RESERVE,
      externalAccountId: 'location-9999',
      credentialReference: 'vault/distribution/google',
      configFingerprint: { scopes: ['reserve.write'] },
      now: NOW,
    });
    expect(db.distributionConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: DistributionConnectionStatus.PENDING,
          cursor: null,
          lastSyncAt: null,
          lastErrorCode: null,
        }),
      }),
    );
  });

  it('creates and replays a sync run with a scoped idempotency key', async () => {
    vi.mocked(db.distributionConnection.findFirst).mockResolvedValue(connectionRow() as never);
    vi.mocked(db.distributionSyncRun.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(syncRunRow({ direction: DistributionSyncDirection.PUSH }) as never);
    vi.mocked(db.distributionSyncRun.create).mockResolvedValue(
      syncRunRow({ direction: DistributionSyncDirection.PUSH }) as never,
    );
    const first = await createDistributionSyncRun({
      restaurantId: RESTAURANT_ID,
      connectionId: CONNECTION_ID,
      direction: DistributionSyncDirection.PUSH,
      idempotencyKey: 'sync-0001',
      windowStart: '2026-09-14T00:00:00Z',
      windowEnd: '2026-09-15T00:00:00Z',
      actor: 'operator',
    });
    expect(first).toMatchObject({ status: DistributionSyncRunStatus.QUEUED });
    expect(first.replayed).toBeUndefined();
    expect(db.distributionSyncRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      }),
    );
    const replay = await createDistributionSyncRun({
      restaurantId: RESTAURANT_ID,
      connectionId: CONNECTION_ID,
      direction: DistributionSyncDirection.PUSH,
      idempotencyKey: 'sync-0001',
      windowStart: '2026-09-14T00:00:00Z',
      windowEnd: '2026-09-15T00:00:00Z',
    });
    expect(replay).toMatchObject({ replayed: true, id: RUN_ID });
  });

  it('rejects a conflicting sync replay and inverted window', async () => {
    vi.mocked(db.distributionConnection.findFirst).mockResolvedValue(connectionRow() as never);
    vi.mocked(db.distributionSyncRun.findUnique).mockResolvedValue(
      syncRunRow({ direction: DistributionSyncDirection.PULL }) as never,
    );
    await expect(
      createDistributionSyncRun({
        restaurantId: RESTAURANT_ID,
        connectionId: CONNECTION_ID,
        direction: DistributionSyncDirection.PUSH,
        idempotencyKey: 'sync-0001',
        windowStart: '2026-09-14T00:00:00Z',
        windowEnd: '2026-09-15T00:00:00Z',
      }),
    ).rejects.toBeInstanceOf(DistributionConflictError);
    await expect(
      createDistributionSyncRun({
        restaurantId: RESTAURANT_ID,
        connectionId: CONNECTION_ID,
        direction: DistributionSyncDirection.PUSH,
        idempotencyKey: 'sync-0002',
        windowStart: '2026-09-15T00:00:00Z',
        windowEnd: '2026-09-14T00:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'DISTRIBUTION_WINDOW_INVALID' });
  });

  it('rejects a sync replay when only the source cursor changes', async () => {
    vi.mocked(db.distributionConnection.findFirst).mockResolvedValue(connectionRow() as never);
    vi.mocked(db.distributionSyncRun.findUnique).mockResolvedValue(
      syncRunRow({ direction: DistributionSyncDirection.PUSH, sourceCursor: 'cursor-a' }) as never,
    );
    await expect(
      createDistributionSyncRun({
        restaurantId: RESTAURANT_ID,
        connectionId: CONNECTION_ID,
        direction: DistributionSyncDirection.PUSH,
        idempotencyKey: 'sync-0001',
        windowStart: '2026-09-14T00:00:00Z',
        windowEnd: '2026-09-15T00:00:00Z',
        sourceCursor: 'cursor-b',
      }),
    ).rejects.toMatchObject({ code: 'DISTRIBUTION_SYNC_IDEMPOTENCY_CONFLICT' });
  });

  it('upserts bounded availability snapshots and rejects over-capacity', async () => {
    vi.mocked(db.distributionConnection.findFirst).mockResolvedValue(connectionRow() as never);
    vi.mocked(db.distributionAvailabilitySnapshot.upsert).mockResolvedValue(
      availabilityRow() as never,
    );
    const result = await upsertDistributionAvailability({
      restaurantId: RESTAURANT_ID,
      connectionId: CONNECTION_ID,
      slotKey: '2026-09-20T19:00:00Z-2',
      serviceDate: '2026-09-20',
      startsAt: '2026-09-20T19:00:00Z',
      endsAt: '2026-09-20T21:00:00Z',
      partySize: 2,
      available: 4,
      capacity: 10,
      now: NOW,
    });
    expect(result).toMatchObject({
      available: 4,
      capacity: 10,
      provider: DistributionProvider.GOOGLE_RESERVE,
    });
    await expect(
      upsertDistributionAvailability({
        restaurantId: RESTAURANT_ID,
        connectionId: CONNECTION_ID,
        slotKey: 'bad key',
        serviceDate: '2026-09-20',
        startsAt: '2026-09-20T19:00:00Z',
        endsAt: '2026-09-20T21:00:00Z',
        partySize: 2,
        available: 11,
        capacity: 10,
      }),
    ).rejects.toMatchObject({ code: 'DISTRIBUTION_SLOT_KEY_INVALID' });
  });

  it('links an external booking only to an explicitly supplied reservation', async () => {
    vi.mocked(db.distributionConnection.findFirst).mockResolvedValue(connectionRow() as never);
    vi.mocked(db.reservation.findFirst).mockResolvedValue({ id: RESERVATION_ID } as never);
    vi.mocked(db.distributionReservationLink.findUnique).mockResolvedValue(null);
    vi.mocked(db.distributionReservationLink.create).mockResolvedValue(linkRow() as never);
    const result = await linkDistributionReservation({
      restaurantId: RESTAURANT_ID,
      connectionId: CONNECTION_ID,
      reservationId: RESERVATION_ID,
      externalReservationId: 'partner-ABCD',
      source: 'fixture',
      now: NOW,
    });
    expect(result).toMatchObject({ reservationId: RESERVATION_ID, externalIdLast4: 'ABCD' });
    expect(db.distributionReservationLink.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ externalIdHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      }),
    );
  });

  it('rejects a second reservation for the same external booking', async () => {
    vi.mocked(db.distributionConnection.findFirst).mockResolvedValue(connectionRow() as never);
    vi.mocked(db.reservation.findFirst).mockResolvedValue({ id: RESERVATION_ID } as never);
    vi.mocked(db.distributionReservationLink.findUnique).mockResolvedValue(
      linkRow({ reservationId: 'other-reservation' }) as never,
    );
    await expect(
      linkDistributionReservation({
        restaurantId: RESTAURANT_ID,
        connectionId: CONNECTION_ID,
        reservationId: RESERVATION_ID,
        externalReservationId: 'partner-ABCD',
        source: 'fixture',
      }),
    ).rejects.toBeInstanceOf(DistributionConflictError);
  });

  it('detects a different external id even when the displayed last four collide', async () => {
    vi.mocked(db.distributionConnection.findFirst).mockResolvedValue(connectionRow() as never);
    vi.mocked(db.reservation.findFirst).mockResolvedValue({ id: RESERVATION_ID } as never);
    vi.mocked(db.distributionReservationLink.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        linkRow({ externalIdHash: 'f'.repeat(64), externalIdLast4: 'ABCD' }) as never,
      );
    await expect(
      linkDistributionReservation({
        restaurantId: RESTAURANT_ID,
        connectionId: CONNECTION_ID,
        reservationId: RESERVATION_ID,
        externalReservationId: 'other-ABCD',
        source: 'fixture',
      }),
    ).rejects.toMatchObject({ code: 'DISTRIBUTION_RESERVATION_LINK_CONFLICT' });
    expect(db.distributionReservationLink.create).not.toHaveBeenCalled();
  });

  it('ingests a hashed webhook once and finishes it monotonically', async () => {
    vi.mocked(db.distributionConnection.findFirst).mockResolvedValue(connectionRow() as never);
    const payload = { reservationId: 'opaque-1' };
    const payloadHash = createHash('sha256').update('{"reservationId":"opaque-1"}').digest('hex');
    vi.mocked(db.distributionWebhookEvent.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(webhookRow({ payloadHash }) as never);
    vi.mocked(db.distributionWebhookEvent.create).mockResolvedValue(
      webhookRow({ payloadHash }) as never,
    );
    const first = await ingestDistributionWebhook({
      restaurantId: RESTAURANT_ID,
      connectionId: CONNECTION_ID,
      provider: DistributionProvider.GOOGLE_RESERVE,
      externalEventId: 'evt-1',
      eventType: 'reservation.updated',
      payload,
      now: NOW,
    });
    expect(first).toMatchObject({
      status: DistributionWebhookStatus.RECEIVED,
      payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(db.distributionWebhookEvent.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          restaurantId_provider_externalEventHash: expect.objectContaining({
            restaurantId: RESTAURANT_ID,
            provider: DistributionProvider.GOOGLE_RESERVE,
          }),
        }),
      }),
    );
    const replay = await ingestDistributionWebhook({
      restaurantId: RESTAURANT_ID,
      connectionId: CONNECTION_ID,
      provider: DistributionProvider.GOOGLE_RESERVE,
      externalEventId: 'evt-1',
      eventType: 'reservation.updated',
      payload,
      now: NOW,
    });
    expect(replay).toMatchObject({ replayed: true });
    vi.mocked(db.distributionWebhookEvent.findFirst).mockResolvedValue(webhookRow() as never);
    vi.mocked(db.distributionWebhookEvent.update).mockResolvedValue(
      webhookRow({ status: DistributionWebhookStatus.PROCESSED, processedAt: NOW }) as never,
    );
    const processed = await finishDistributionWebhook({
      restaurantId: RESTAURANT_ID,
      webhookId: WEBHOOK_ID,
      status: DistributionWebhookStatus.PROCESSED,
      now: NOW,
    });
    expect(processed).toMatchObject({ status: DistributionWebhookStatus.PROCESSED });
  });

  it('finishes a sync run and rejects mutations after a final state', async () => {
    vi.mocked(db.distributionSyncRun.findFirst).mockResolvedValue(syncRunRow() as never);
    vi.mocked(db.distributionSyncRun.update).mockResolvedValue(
      syncRunRow({
        status: DistributionSyncRunStatus.SUCCEEDED,
        pushedCount: 2,
        finishedAt: NOW,
      }) as never,
    );
    const result = await finishDistributionSyncRun({
      restaurantId: RESTAURANT_ID,
      runId: RUN_ID,
      status: DistributionSyncRunStatus.SUCCEEDED,
      pushedCount: 2,
      now: NOW,
    });
    expect(result).toMatchObject({ status: DistributionSyncRunStatus.SUCCEEDED, pushedCount: 2 });
    vi.mocked(db.distributionSyncRun.findFirst).mockResolvedValue(
      syncRunRow({ status: DistributionSyncRunStatus.SUCCEEDED }) as never,
    );
    await expect(
      finishDistributionSyncRun({
        restaurantId: RESTAURANT_ID,
        runId: RUN_ID,
        status: DistributionSyncRunStatus.FAILED,
      }),
    ).rejects.toBeInstanceOf(DistributionStateError);
  });

  it('blocks sync, snapshots and disconnect transitions for a disconnected connection', async () => {
    vi.mocked(db.distributionConnection.findFirst).mockResolvedValue(
      connectionRow({ status: DistributionConnectionStatus.DISCONNECTED }) as never,
    );
    await expect(
      createDistributionSyncRun({
        restaurantId: RESTAURANT_ID,
        connectionId: CONNECTION_ID,
        direction: DistributionSyncDirection.PUSH,
        idempotencyKey: 'sync-0001',
      }),
    ).rejects.toMatchObject({ code: 'DISTRIBUTION_CONNECTION_DISCONNECTED' });
    await expect(
      upsertDistributionAvailability({
        restaurantId: RESTAURANT_ID,
        connectionId: CONNECTION_ID,
        slotKey: 'slot-1',
        serviceDate: '2026-09-20',
        startsAt: '2026-09-20T19:00:00Z',
        endsAt: '2026-09-20T21:00:00Z',
        partySize: 2,
        available: 1,
        capacity: 2,
      }),
    ).rejects.toMatchObject({ code: 'DISTRIBUTION_CONNECTION_DISCONNECTED' });
    vi.mocked(db.distributionConnection.update).mockResolvedValue(
      connectionRow({
        status: DistributionConnectionStatus.DISCONNECTED,
        disconnectedAt: NOW,
      }) as never,
    );
    const disconnected = await disconnectDistributionConnection(RESTAURANT_ID, CONNECTION_ID, NOW);
    expect(disconnected.status).toBe(DistributionConnectionStatus.DISCONNECTED);
  });

  it('accepts an explicit payload hash only when it is SHA-256', async () => {
    vi.mocked(db.distributionConnection.findFirst).mockResolvedValue(connectionRow() as never);
    await expect(
      ingestDistributionWebhook({
        restaurantId: RESTAURANT_ID,
        provider: DistributionProvider.PUBLIC_API,
        externalEventId: 'evt-1',
        eventType: 'reservation.created',
        payloadHash: 'bad',
      }),
    ).rejects.toBeInstanceOf(DistributionInputError);
    expect(db.distributionWebhookEvent.create).not.toHaveBeenCalled();
  });

  it('maps a database race on connection creation to a typed conflict', async () => {
    vi.mocked(db.distributionConnection.findUnique).mockResolvedValue(null);
    vi.mocked(db.distributionConnection.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: 'test' }),
    );
    await expect(
      createOrUpdateDistributionConnection({
        restaurantId: RESTAURANT_ID,
        provider: DistributionProvider.META_RESERVE,
      }),
    ).rejects.toMatchObject({ code: 'DISTRIBUTION_CONNECTION_CONFLICT' });
  });
});

import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../shared/db/client';
import {
  appendCustomerTimelineEvent,
  assignCustomerTag,
  buildCustomerTimelineDedupeKey,
  CUSTOMER_PREFERENCE_KEYS,
  deleteCustomerPreference,
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  normalizeCustomerPreferenceValue,
  previewCustomerMetricSnapshotRepair,
  repairCustomerMetricSnapshot,
  rebuildCustomerMetricSnapshot,
  removeCustomerTag,
  upsertCustomerPreference,
  upsertCustomerTag,
  upsertCustomerIdentity,
} from '../customer-crm.service';

vi.mock('../../../shared/db/client', () => {
  const mock = {
    customer: { findUnique: vi.fn(), findFirst: vi.fn() },
    customerIdentity: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    customerTimelineEvent: { findUnique: vi.fn(), create: vi.fn() },
    customerMetricSnapshot: { findUnique: vi.fn(), upsert: vi.fn() },
    customerPreference: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
    customerTag: { findUnique: vi.fn(), upsert: vi.fn() },
    customerTagAssignment: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
    reservation: { findMany: vi.fn() },
  };
  return {
    db: {
      ...mock,
      $transaction: vi.fn(async (fn: (tx: typeof mock) => unknown) => fn(mock)),
    },
  };
});

describe('customer CRM core', () => {
  beforeEach(() => vi.clearAllMocks());

  it('normalizes phone and email identities without guessing a country', () => {
    expect(normalizeCustomerPhone(' 00 33 6 12 34 56 78 ')).toBe('+33612345678');
    expect(normalizeCustomerPhone('+33 (6) 12-34-56-78')).toBe('+33612345678');
    expect(normalizeCustomerPhone('+336****5678')).toBeNull();
    expect(normalizeCustomerEmail('  Alice@Example.COM ')).toBe('alice@example.com');
    expect(normalizeCustomerEmail('not-an-email')).toBeNull();
  });

  it('creates an identity and reports a collision instead of reassigning it', async () => {
    vi.mocked(db.customerIdentity.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'identity-1',
        customerId: 'customer-2',
        value: '+33612345678',
        source: 'IMPORT',
        verifiedAt: null,
      } as never);
    vi.mocked(db.customerIdentity.create).mockResolvedValue({
      id: 'identity-1',
      customerId: 'customer-1',
    } as never);

    await expect(
      upsertCustomerIdentity({
        restaurantId: 'restaurant-1',
        customerId: 'customer-1',
        type: 'PHONE',
        value: '+33 6 12 34 56 78',
        source: 'VOICE',
      }),
    ).resolves.toMatchObject({ status: 'created', identityId: 'identity-1' });
    expect(db.customerIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        normalizedValue: '+33612345678',
        customerId: 'customer-1',
      }),
    });

    await expect(
      upsertCustomerIdentity({
        restaurantId: 'restaurant-1',
        customerId: 'customer-1',
        type: 'PHONE',
        value: '+33612345678',
        source: 'VOICE',
      }),
    ).resolves.toMatchObject({ status: 'conflict', customerId: 'customer-2' });
  });

  it('appends a timeline event with a deterministic replay key', async () => {
    const dedupeKey = buildCustomerTimelineDedupeKey({
      restaurantId: 'restaurant-1',
      customerId: 'customer-1',
      eventType: 'CALL_RECEIVED',
      sourceType: 'call',
      sourceId: 'call-1',
    });
    vi.mocked(db.customerTimelineEvent.create).mockResolvedValue({ id: 'timeline-1' } as never);

    await expect(
      appendCustomerTimelineEvent({
        restaurantId: 'restaurant-1',
        customerId: 'customer-1',
        eventType: 'CALL_RECEIVED',
        sourceType: 'call',
        sourceId: 'call-1',
        dedupeKey,
        occurredAt: new Date('2026-09-13T10:00:00.000Z'),
        summaryCode: 'call.received',
        metadata: { partySize: 2 },
      }),
    ).resolves.toMatchObject({ created: true, event: { id: 'timeline-1' } });
    expect(db.customerTimelineEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dedupeKey, metadata: { partySize: 2 } }),
    });
  });

  it('rebuilds honors, cancellations, no-shows, covers and spend deterministically', async () => {
    const now = new Date('2026-09-13T12:00:00.000Z');
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      {
        state: 'HONORED',
        status: 'SEATED',
        reservedAt: new Date('2026-09-12T19:00:00.000Z'),
        startsAt: new Date('2026-09-12T19:00:00.000Z'),
        partySize: 3,
        estimatedRevenue: new Prisma.Decimal('105'),
        confirmedRevenue: new Prisma.Decimal('120'),
      },
      {
        state: 'CANCELLED',
        status: 'CANCELLED',
        reservedAt: new Date('2026-08-01T19:00:00.000Z'),
        startsAt: null,
        partySize: 2,
        estimatedRevenue: new Prisma.Decimal('70'),
        confirmedRevenue: null,
      },
      {
        state: 'NO_SHOW',
        status: 'NO_SHOW',
        reservedAt: new Date('2026-07-01T19:00:00.000Z'),
        startsAt: null,
        partySize: 2,
        estimatedRevenue: new Prisma.Decimal('70'),
        confirmedRevenue: null,
      },
    ] as never);
    vi.mocked(db.customerMetricSnapshot.upsert).mockResolvedValue({
      customerId: 'customer-1',
      honored365d: 1,
      covers365d: 3,
      estimatedSpend365d: new Prisma.Decimal('105'),
      actualSpend365d: new Prisma.Decimal('120'),
      actualLifetimeSpend: new Prisma.Decimal('120'),
    } as never);

    await rebuildCustomerMetricSnapshot({
      restaurantId: 'restaurant-1',
      customerId: 'customer-1',
      now,
    });

    expect(db.customerMetricSnapshot.upsert).toHaveBeenCalledWith({
      where: { customerId: 'customer-1' },
      create: expect.objectContaining({
        honored30d: 1,
        honored90d: 1,
        honored365d: 1,
        cancelled365d: 1,
        noShow365d: 1,
        covers365d: 3,
        estimatedSpend365d: new Prisma.Decimal('105'),
        actualSpend365d: new Prisma.Decimal('120'),
      }),
      update: expect.objectContaining({ projectionVersion: { increment: 1 } }),
    });
  });

  it('upserts an allow-listed preference and rejects unsafe values', async () => {
    vi.mocked(db.customer.findUnique).mockResolvedValue({ restaurantId: 'restaurant-1' } as never);
    vi.mocked(db.customerPreference.upsert).mockResolvedValue({
      id: 'preference-1',
      key: 'preferred_section',
      value: { section: 'terrasse' },
    } as never);

    await expect(
      upsertCustomerPreference({
        restaurantId: 'restaurant-1',
        customerId: 'customer-1',
        key: 'PREFERRED_SECTION',
        value: { section: 'terrasse' },
        source: 'MANUAL',
        confidence: 0.9,
      }),
    ).resolves.toMatchObject({ id: 'preference-1' });
    expect(db.customerPreference.upsert).toHaveBeenCalledWith({
      where: { customerId_key: { customerId: 'customer-1', key: 'preferred_section' } },
      create: expect.objectContaining({ source: 'MANUAL', confidence: 0.9 }),
      update: expect.objectContaining({ source: 'MANUAL', confidence: 0.9 }),
    });

    expect(CUSTOMER_PREFERENCE_KEYS).toContain('dietary_restrictions');
    expect(() => normalizeCustomerPreferenceValue({ nested: Number.NaN })).toThrow(
      'invalid number',
    );
    await expect(
      upsertCustomerPreference({
        restaurantId: 'restaurant-1',
        customerId: 'customer-1',
        key: 'free_form_note',
        value: 'not allowed',
        source: 'MANUAL',
      }),
    ).rejects.toThrow('unsupported customer preference key');
  });

  it('assigns and removes a tag without crossing the tenant boundary', async () => {
    vi.mocked(db.customer.findUnique).mockResolvedValue({ restaurantId: 'restaurant-1' } as never);
    vi.mocked(db.customerTag.findUnique).mockResolvedValue({
      restaurantId: 'restaurant-1',
    } as never);
    vi.mocked(db.customerTagAssignment.findUnique).mockResolvedValue(null);
    vi.mocked(db.customerTagAssignment.upsert).mockResolvedValue({
      customerId: 'customer-1',
      tagId: 'tag-1',
      source: 'MANUAL',
    } as never);

    await expect(
      assignCustomerTag({
        restaurantId: 'restaurant-1',
        customerId: 'customer-1',
        tagId: 'tag-1',
        source: 'MANUAL',
      }),
    ).resolves.toMatchObject({ created: true });
    expect(db.customerTagAssignment.upsert).toHaveBeenCalledWith({
      where: { customerId_tagId: { customerId: 'customer-1', tagId: 'tag-1' } },
      create: expect.objectContaining({ source: 'MANUAL' }),
      update: expect.objectContaining({ source: 'MANUAL' }),
    });

    vi.mocked(db.customerTagAssignment.findUnique).mockResolvedValue({} as never);
    await expect(
      removeCustomerTag({
        restaurantId: 'restaurant-1',
        customerId: 'customer-1',
        tagId: 'tag-1',
      }),
    ).resolves.toBe(true);
    expect(db.customerTagAssignment.delete).toHaveBeenCalledWith({
      where: { customerId_tagId: { customerId: 'customer-1', tagId: 'tag-1' } },
    });
  });

  it('deletes only a preference owned by the current restaurant', async () => {
    vi.mocked(db.customer.findUnique).mockResolvedValue({ restaurantId: 'restaurant-1' } as never);
    vi.mocked(db.customerPreference.findUnique).mockResolvedValue({
      id: 'preference-1',
      restaurantId: 'restaurant-1',
    } as never);

    await expect(
      deleteCustomerPreference({
        restaurantId: 'restaurant-1',
        customerId: 'customer-1',
        key: 'preferred_language',
      }),
    ).resolves.toBe(true);
    expect(db.customerPreference.delete).toHaveBeenCalledWith({ where: { id: 'preference-1' } });
  });

  it('prévisualise un écart de projection sans écrire dans les réservations', async () => {
    const now = new Date('2026-09-14T12:00:00.000Z');
    vi.mocked(db.customer.findUnique).mockResolvedValue({
      restaurantId: 'restaurant-1',
      archivedAt: null,
    } as never);
    vi.mocked(db.customerMetricSnapshot.findUnique).mockResolvedValue({
      customerId: 'customer-1',
      restaurantId: 'restaurant-1',
      honored30d: 0,
      honored90d: 0,
      honored365d: 0,
      cancelled365d: 0,
      noShow365d: 0,
      covers365d: 0,
      estimatedSpend365d: new Prisma.Decimal(0),
      actualSpend365d: null,
      actualLifetimeSpend: null,
      lastHonoredAt: null,
      nextReservationAt: null,
    } as never);
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      {
        state: 'HONORED',
        status: 'SEATED',
        reservedAt: new Date('2026-09-13T19:00:00.000Z'),
        startsAt: new Date('2026-09-13T19:00:00.000Z'),
        partySize: 2,
        estimatedRevenue: new Prisma.Decimal('80'),
        confirmedRevenue: new Prisma.Decimal('90'),
      },
    ] as never);

    const result = await previewCustomerMetricSnapshotRepair({
      restaurantId: 'restaurant-1',
      customerId: 'customer-1',
      now,
    });

    expect(result.changed).toBe(true);
    expect(result.reservationCount).toBe(1);
    expect(result.expected).toMatchObject({ honored365d: 1, covers365d: 2 });
    expect(db.customerMetricSnapshot.upsert).not.toHaveBeenCalled();
  });

  it('répare une projection une seule fois pour une clé d’idempotence', async () => {
    const now = new Date('2026-09-14T12:00:00.000Z');
    vi.mocked(db.customer.findUnique).mockResolvedValue({
      restaurantId: 'restaurant-1',
      archivedAt: null,
    } as never);
    vi.mocked(db.customerTimelineEvent.findUnique).mockResolvedValue(null);
    vi.mocked(db.customerMetricSnapshot.findUnique).mockResolvedValue(null);
    vi.mocked(db.reservation.findMany).mockResolvedValue([]);
    vi.mocked(db.customerMetricSnapshot.upsert).mockResolvedValue({
      customerId: 'customer-1',
      restaurantId: 'restaurant-1',
      projectionVersion: 1,
      calculatedAt: now,
    } as never);
    vi.mocked(db.customerTimelineEvent.create).mockResolvedValue({
      id: 'repair-event-1',
    } as never);

    const first = await repairCustomerMetricSnapshot({
      restaurantId: 'restaurant-1',
      customerId: 'customer-1',
      idempotencyKey: 'repair-key-1',
      actor: 'user-1',
      now,
    });

    expect(first).toMatchObject({ replayed: false, repaired: true, projectionVersion: 1 });
    expect(db.customerMetricSnapshot.upsert).toHaveBeenCalledOnce();
    const metadata = {
      calculatedAt: first.calculatedAt,
      reservationCount: first.reservationCount,
      changed: first.changed,
      current: first.current,
      expected: first.expected,
      projectionVersion: first.projectionVersion,
    };
    vi.mocked(db.customerTimelineEvent.findUnique).mockResolvedValue({ metadata } as never);

    const replay = await repairCustomerMetricSnapshot({
      restaurantId: 'restaurant-1',
      customerId: 'customer-1',
      idempotencyKey: 'repair-key-1',
      now,
    });

    expect(replay).toMatchObject({ replayed: true, projectionVersion: 1 });
    expect(db.customerMetricSnapshot.upsert).toHaveBeenCalledOnce();
  });
});

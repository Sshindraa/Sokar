import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

describe('customer CRM routes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({ plan: 'PRO' } as never);
  });

  afterAll(async () => {
    await closeApp();
  });

  it('expose la politique de notes effective et la réserve au propriétaire', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUnique)
      .mockResolvedValueOnce({ plan: 'PRO' } as never)
      .mockResolvedValueOnce({ crmSensitiveNoteRoles: null } as never);

    const response = await app.inject({
      method: 'GET',
      url: '/crm/privacy',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: { sensitiveNoteRoles: ['OWNER', 'MANAGER'], source: 'ENVIRONMENT' },
    });

    const forbidden = await app.inject({
      method: 'PATCH',
      url: '/crm/privacy',
      headers: { authorization: 'Bearer test', 'x-test-site-role': 'STAFF' },
      payload: { sensitiveNoteRoles: ['OWNER', 'STAFF'] },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error).toBe('CRM_PRIVACY_OWNER_REQUIRED');
    expect(db.restaurant.update).not.toHaveBeenCalled();
  });

  it('normalise et persiste une politique de notes par établissement', async () => {
    const app = await getApp();
    const invalid = await app.inject({
      method: 'PATCH',
      url: '/crm/privacy',
      headers: { authorization: 'Bearer test' },
      payload: { sensitiveNoteRoles: ['STAFF'] },
    });
    expect(invalid.statusCode).toBe(400);
    expect(db.restaurant.update).not.toHaveBeenCalled();

    vi.mocked(db.restaurant.update).mockResolvedValue({
      crmSensitiveNoteRoles: 'OWNER,STAFF',
    } as never);

    const response = await app.inject({
      method: 'PATCH',
      url: '/crm/privacy',
      headers: { authorization: 'Bearer test' },
      payload: { sensitiveNoteRoles: ['STAFF', 'OWNER', 'STAFF'] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: { sensitiveNoteRoles: ['OWNER', 'STAFF'], source: 'SITE' },
    });
    expect(db.restaurant.update).toHaveBeenCalledWith({
      where: { id: 'test-rest-1' },
      data: { crmSensitiveNoteRoles: 'OWNER,STAFF' },
      select: { crmSensitiveNoteRoles: true },
    });
  });

  it('filtre les profils CRM par recherche, VIP et métriques sans quitter le tenant', async () => {
    const app = await getApp();
    vi.mocked(db.customer.findMany).mockResolvedValue([
      { id: 'customer-1', metricSnapshot: { honored365d: 5 } },
      { id: 'customer-2', metricSnapshot: { honored365d: 4 } },
      { id: 'customer-3', metricSnapshot: { honored365d: 3 } },
    ] as never);

    const response = await app.inject({
      method: 'GET',
      url: '/crm/customers?search=alice&isVip=true&minHonored365d=2&limit=2',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [
        { id: 'customer-1', metricSnapshot: { honored365d: 5 } },
        { id: 'customer-2', metricSnapshot: { honored365d: 4 } },
      ],
      nextCursor: 'customer-2',
    });
    expect(db.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          restaurantId: 'test-rest-1',
          archivedAt: null,
          isVip: true,
          metricSnapshot: { honored365d: { gte: 2 } },
        }),
        take: 3,
      }),
    );
  });

  it('returns a tenant-scoped profile with identities, metrics and timeline', async () => {
    const app = await getApp();
    vi.mocked(db.customer.findFirst).mockResolvedValue({
      id: 'customer-1',
      restaurantId: 'test-rest-1',
      phone: '+33612345678',
      identities: [{ id: 'identity-1', type: 'PHONE', value: '+33612345678' }],
      metricSnapshot: { honored365d: 4, covers365d: 8 },
      preferences: [],
      tagAssignments: [],
      timelineEvents: [{ id: 'timeline-1', summaryCode: 'call.received' }],
    } as never);

    const response = await app.inject({
      method: 'GET',
      url: '/crm/customers/customer-1',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: expect.objectContaining({
        id: 'customer-1',
        metrics: { honored365d: 4, covers365d: 8 },
        timeline: [{ id: 'timeline-1', summaryCode: 'call.received' }],
      }),
    });
    expect(db.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'customer-1', restaurantId: 'test-rest-1', archivedAt: null },
      }),
    );
  });

  it('masque les notes et les métadonnées de chronologie pour un rôle non autorisé', async () => {
    const app = await getApp();
    vi.mocked(db.customer.findFirst).mockResolvedValue({
      id: 'customer-1',
      restaurantId: 'test-rest-1',
      notes: 'Allergie à confirmer',
      identities: [],
      metricSnapshot: null,
      preferences: [],
      tagAssignments: [],
      timelineEvents: [
        {
          id: 'timeline-sensitive',
          summaryCode: 'customer.preference_updated',
          metadata: { value: 'allergie', source: 'MANUAL' },
        },
      ],
    } as never);

    const staff = await app.inject({
      method: 'GET',
      url: '/crm/customers/customer-1',
      headers: { authorization: 'Bearer test', 'x-test-site-role': 'STAFF' },
    });
    expect(staff.statusCode).toBe(200);
    expect(staff.json().data).toMatchObject({
      notes: null,
      timeline: [{ id: 'timeline-sensitive', metadata: {} }],
    });

    const manager = await app.inject({
      method: 'GET',
      url: '/crm/customers/customer-1',
      headers: { authorization: 'Bearer test', 'x-test-site-role': 'MANAGER' },
    });
    expect(manager.statusCode).toBe(200);
    expect(manager.json().data).toMatchObject({
      notes: 'Allergie à confirmer',
      timeline: [
        {
          id: 'timeline-sensitive',
          metadata: { value: 'allergie', source: 'MANUAL' },
        },
      ],
    });
  });

  it('applique la surcharge de visibilité définie par le site', async () => {
    const app = await getApp();
    vi.mocked(db.customer.findFirst).mockResolvedValue({
      id: 'customer-1',
      restaurantId: 'test-rest-1',
      notes: 'Note de service',
      restaurant: { crmSensitiveNoteRoles: 'OWNER,STAFF' },
      identities: [],
      metricSnapshot: null,
      preferences: [],
      tagAssignments: [],
      timelineEvents: [{ id: 'timeline-1', metadata: { source: 'MANUAL' } }],
    } as never);

    const response = await app.inject({
      method: 'GET',
      url: '/crm/customers/customer-1',
      headers: { authorization: 'Bearer test', 'x-test-site-role': 'STAFF' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      notes: 'Note de service',
      timeline: [{ id: 'timeline-1', metadata: { source: 'MANUAL' } }],
    });
  });

  it('returns a cursor-paginated timeline and keeps the tenant in the query', async () => {
    const app = await getApp();
    vi.mocked(db.customer.findFirst).mockResolvedValue({ id: 'customer-1' } as never);
    vi.mocked(db.customerTimelineEvent.findMany).mockResolvedValue([
      { id: 'timeline-1', summaryCode: 'reservation.created' },
      { id: 'timeline-2', summaryCode: 'call.received' },
      { id: 'timeline-3', summaryCode: 'reservation.cancelled' },
    ] as never);

    const response = await app.inject({
      method: 'GET',
      url: '/crm/customers/customer-1/timeline?limit=2&cursor=timeline-0',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [
        { id: 'timeline-1', summaryCode: 'reservation.created' },
        { id: 'timeline-2', summaryCode: 'call.received' },
      ],
      nextCursor: 'timeline-2',
    });
    expect(db.customerTimelineEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { restaurantId: 'test-rest-1', customerId: 'customer-1' },
        cursor: { id: 'timeline-0' },
        skip: 1,
        take: 3,
      }),
    );
  });

  it('masque les métadonnées sensibles de la chronologie paginée pour le staff', async () => {
    const app = await getApp();
    vi.mocked(db.customer.findFirst).mockResolvedValue({ id: 'customer-1' } as never);
    vi.mocked(db.customerTimelineEvent.findMany).mockResolvedValue([
      {
        id: 'timeline-sensitive',
        summaryCode: 'customer.preference_updated',
        metadata: { value: 'terrasse' },
      },
    ] as never);

    const response = await app.inject({
      method: 'GET',
      url: '/crm/customers/customer-1/timeline',
      headers: { authorization: 'Bearer test', 'x-test-site-role': 'STAFF' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [
        { id: 'timeline-sensitive', summaryCode: 'customer.preference_updated', metadata: {} },
      ],
      nextCursor: null,
    });
  });

  it('does not disclose another or archived customer', async () => {
    const app = await getApp();
    vi.mocked(db.customer.findFirst).mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/crm/customers/customer-1',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'CUSTOMER_NOT_FOUND' });
  });

  it('creates an idempotent tag assignment in the tenant', async () => {
    const app = await getApp();
    vi.mocked(db.customer.findFirst).mockResolvedValue({ id: 'customer-1' } as never);
    vi.mocked(db.customer.findUnique).mockResolvedValue({ restaurantId: 'test-rest-1' } as never);
    vi.mocked(db.customerTag.upsert).mockResolvedValue({
      id: 'tag-1',
      restaurantId: 'test-rest-1',
      key: 'vip-lunch',
      label: 'VIP déjeuner',
    } as never);
    vi.mocked(db.customerTag.findUnique).mockResolvedValue({
      restaurantId: 'test-rest-1',
    } as never);
    vi.mocked(db.customerTagAssignment.findUnique).mockResolvedValue(null);
    vi.mocked(db.customerTagAssignment.upsert).mockResolvedValue({
      customerId: 'customer-1',
      tagId: 'tag-1',
      source: 'MANUAL',
    } as never);
    vi.mocked(db.customerTimelineEvent.create).mockResolvedValue({ id: 'timeline-1' } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/crm/customers/customer-1/tags',
      headers: { authorization: 'Bearer test' },
      payload: { key: 'vip-lunch', label: 'VIP déjeuner' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      data: {
        tag: expect.objectContaining({ id: 'tag-1', key: 'vip-lunch' }),
        assignment: expect.objectContaining({ customerId: 'customer-1', tagId: 'tag-1' }),
      },
    });
    expect(db.customerTimelineEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ summaryCode: 'customer.tag_assigned' }),
    });
  });

  it('bloque les écritures CRM pour un membre staff', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/crm/customers/customer-1/tags',
      headers: { authorization: 'Bearer test', 'x-test-site-role': 'STAFF' },
      payload: { key: 'vip-lunch', label: 'VIP déjeuner' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'CRM_WRITE_ROLE_REQUIRED',
      message: 'La modification des préférences et tags CRM est réservée aux responsables.',
    });
    expect(db.customerTag.upsert).not.toHaveBeenCalled();
  });

  it('stores and removes a structured customer preference', async () => {
    const app = await getApp();
    vi.mocked(db.customer.findFirst).mockResolvedValue({ id: 'customer-1' } as never);
    vi.mocked(db.customer.findUnique).mockResolvedValue({ restaurantId: 'test-rest-1' } as never);
    vi.mocked(db.customerPreference.upsert).mockResolvedValue({
      id: 'preference-1',
      restaurantId: 'test-rest-1',
      customerId: 'customer-1',
      key: 'preferred_language',
      value: 'fr',
      source: 'MANUAL',
    } as never);
    vi.mocked(db.customerTimelineEvent.create).mockResolvedValue({ id: 'timeline-2' } as never);

    const saved = await app.inject({
      method: 'PUT',
      url: '/crm/customers/customer-1/preferences/preferred_language',
      headers: { authorization: 'Bearer test' },
      payload: { value: 'fr', confidence: 1 },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ data: expect.objectContaining({ key: 'preferred_language' }) });
    expect(db.customerPreference.upsert).toHaveBeenCalledWith({
      where: {
        customerId_key: { customerId: 'customer-1', key: 'preferred_language' },
      },
      create: expect.objectContaining({ value: 'fr', confidence: 1 }),
      update: expect.objectContaining({ value: 'fr', confidence: 1 }),
    });

    vi.mocked(db.customerPreference.findUnique).mockResolvedValue({
      id: 'preference-1',
      restaurantId: 'test-rest-1',
    } as never);
    const removed = await app.inject({
      method: 'DELETE',
      url: '/crm/customers/customer-1/preferences/preferred_language',
      headers: { authorization: 'Bearer test' },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ data: { removed: true } });
  });

  it('expose les doublons avec un score explicable et garde le filtre de formule', async () => {
    const app = await getApp();
    vi.mocked(db.customer.findMany).mockResolvedValue([
      {
        id: 'customer-a',
        name: 'Alice Martin',
        phone: '+33 6 12 34 56 78',
        emailNormalized: null,
        visitCount: 4,
        isVip: true,
        archivedAt: null,
        identities: [],
      },
      {
        id: 'customer-b',
        name: 'Alice Martin',
        phone: '+33612345678',
        emailNormalized: null,
        visitCount: 2,
        isVip: false,
        archivedAt: null,
        identities: [],
      },
    ] as never);

    const response = await app.inject({
      method: 'GET',
      url: '/crm/duplicates?minScore=80&limit=10',
      headers: { authorization: 'Bearer test', 'x-test-site-role': 'MANAGER' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: [
        {
          id: 'customer-a:customer-b',
          score: 90,
          reasons: expect.arrayContaining([
            {
              code: 'PHONE_MATCH',
              points: 80,
              label: 'Téléphone normalisé identique',
            },
            { code: 'NAME_MATCH', points: 10, label: 'Nom normalisé identique' },
          ]),
        },
      ],
      nextCursor: null,
    });
    expect(db.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { restaurantId: 'test-rest-1', archivedAt: null, mergedIntoId: null },
        take: 10_000,
      }),
    );

    vi.mocked(db.restaurant.findUnique).mockResolvedValue({ plan: 'ESSENTIAL' } as never);
    const denied = await app.inject({
      method: 'GET',
      url: '/crm/duplicates',
      headers: { authorization: 'Bearer test', 'x-test-site-role': 'OWNER' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({
      error: 'CAPABILITY_NOT_INCLUDED',
      capability: 'crm.merge',
      plan: 'essential',
    });
  });

  it('réserve la fusion au propriétaire et laisse le manager prévisualiser', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({ plan: 'PRO' } as never);
    vi.mocked(db.customer.findMany).mockResolvedValue([
      {
        id: 'target',
        restaurantId: 'test-rest-1',
        name: 'Cible',
        phone: '+33611111111',
        emailNormalized: null,
        birthMonth: null,
        birthDay: null,
        preferredLocale: null,
        mergedIntoId: null,
        archivedAt: null,
        visitCount: 3,
        loyaltyScore: 0,
        isVip: false,
        notes: null,
        specialOccasion: null,
        lastSeenAt: null,
        lastCallAt: null,
        partySizeTypical: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        identities: [],
        preferences: [],
        metricSnapshot: null,
        tagAssignments: [],
      },
      {
        id: 'source',
        restaurantId: 'test-rest-1',
        name: 'Source',
        phone: '+33622222222',
        emailNormalized: null,
        birthMonth: null,
        birthDay: null,
        preferredLocale: null,
        mergedIntoId: null,
        archivedAt: null,
        visitCount: 1,
        loyaltyScore: 0,
        isVip: false,
        notes: null,
        specialOccasion: null,
        lastSeenAt: null,
        lastCallAt: null,
        partySizeTypical: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        identities: [],
        preferences: [],
        metricSnapshot: null,
        tagAssignments: [],
      },
    ] as never);

    const preview = await app.inject({
      method: 'POST',
      url: '/crm/customers/target/merge-preview',
      headers: { authorization: 'Bearer test', 'x-test-site-role': 'MANAGER' },
      payload: { sourceCustomerIds: ['source'] },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      data: {
        target: { id: 'target' },
        sources: [{ id: 'source' }],
        impact: expect.objectContaining({ reservations: 0, identities: 0 }),
      },
    });

    const denied = await app.inject({
      method: 'POST',
      url: '/crm/customers/target/merge',
      headers: { authorization: 'Bearer test', 'x-test-site-role': 'MANAGER' },
      payload: { sourceCustomerIds: ['source'] },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({
      error: 'CRM_MERGE_OWNER_REQUIRED',
      message: 'Seul le propriétaire du site peut confirmer une fusion client.',
    });
  });

  it('exige une clé d’idempotence pour la confirmation propriétaire', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({ plan: 'PRO' } as never);
    const response = await app.inject({
      method: 'POST',
      url: '/crm/customers/target/merge',
      headers: { authorization: 'Bearer test', 'x-test-site-role': 'OWNER' },
      payload: { sourceCustomerIds: ['source'] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
  });

  it('prévisualise une réparation de métriques sans mutation et la réserve au propriétaire', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({ plan: 'PRO' } as never);
    vi.mocked(db.customer.findUnique).mockResolvedValue({
      restaurantId: 'test-rest-1',
      archivedAt: null,
    } as never);
    vi.mocked(db.customerMetricSnapshot.findUnique).mockResolvedValue(null);
    vi.mocked(db.reservation.findMany).mockResolvedValue([]);

    const preview = await app.inject({
      method: 'GET',
      url: '/crm/customers/customer-1/projection-repair-preview',
      headers: { authorization: 'Bearer test', 'x-test-site-role': 'MANAGER' },
    });

    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      data: {
        customerId: 'customer-1',
        restaurantId: 'test-rest-1',
        changed: true,
        reservationCount: 0,
      },
    });
    expect(db.customerMetricSnapshot.upsert).not.toHaveBeenCalled();

    vi.mocked(db.customerTimelineEvent.findUnique).mockResolvedValue(null);
    vi.mocked(db.customerMetricSnapshot.upsert).mockResolvedValue({
      customerId: 'customer-1',
      restaurantId: 'test-rest-1',
      projectionVersion: 1,
      calculatedAt: new Date('2026-09-14T12:00:00.000Z'),
    } as never);
    vi.mocked(db.customerTimelineEvent.create).mockResolvedValue({ id: 'repair-event-1' } as never);

    const repaired = await app.inject({
      method: 'POST',
      url: '/crm/customers/customer-1/projection-repair',
      headers: {
        authorization: 'Bearer test',
        'x-test-site-role': 'OWNER',
        'idempotency-key': 'repair-route-key',
      },
    });

    expect(repaired.statusCode).toBe(201);
    expect(repaired.json()).toMatchObject({
      data: { repaired: true, replayed: false, projectionVersion: 1 },
    });
    expect(db.customerTimelineEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ summaryCode: 'customer.metrics_repaired' }),
    });

    const denied = await app.inject({
      method: 'POST',
      url: '/crm/customers/customer-1/projection-repair',
      headers: {
        authorization: 'Bearer test',
        'x-test-site-role': 'MANAGER',
        'idempotency-key': 'repair-route-key-2',
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: 'CRM_PROJECTION_REPAIR_OWNER_REQUIRED' });
  });
});

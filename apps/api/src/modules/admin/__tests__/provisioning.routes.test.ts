import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

const AUTH = { authorization: 'Bearer fake-token' };

vi.mock('../../../shared/telnyx/client', () => ({
  default: {
    phoneNumbers: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      update: vi.fn().mockResolvedValue({}),
    },
  },
  placeOutboundCall: vi.fn().mockResolvedValue({ callControlId: 'test-call-control-123' }),
}));

describe('admin provisioning routes', () => {
  afterAll(async () => {
    await closeApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /admin/provisioning/available-numbers retourne la liste des numéros', async () => {
    vi.mocked(db.restaurant.findMany).mockResolvedValueOnce([]);

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/provisioning/available-numbers',
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.numbers)).toBe(true);
    expect(body.numbers.length).toBeGreaterThan(0);
    expect(body.numbers[0]).toHaveProperty('phoneNumber');
  });

  it('GET /admin/provisioning/:restaurantId retourne le statut de provisioning', async () => {
    const mockRestaurant = {
      id: 'test-rest-1',
      name: 'Chez Sokar Test',
      phoneNumber: '+33451221528',
      provisioningStatus: 'PHONE_ASSIGNED',
      telnyxPhoneNumberId: 'tnx-123',
      forwardingConfiguredAt: new Date('2026-07-22T10:00:00Z'),
      testCallValidatedAt: null,
      firstCallAt: null,
      onboardingTasks: {},
    };

    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValueOnce(
      mockRestaurant as unknown as Awaited<ReturnType<typeof db.restaurant.findUniqueOrThrow>>,
    );

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/provisioning/test-rest-1',
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.status.restaurantId).toBe('test-rest-1');
    expect(body.status.hasAssignedPhone).toBe(true);
    expect(body.status.steps.assignment.completed).toBe(true);
    expect(body.status.forwardingCode).toBe('*21*+33451221528#');
  });

  it('POST /admin/provisioning/:restaurantId/assign-phone attribue un numéro et met à jour le statut', async () => {
    const mockRestaurant = {
      id: 'test-rest-1',
      name: 'Chez Sokar Test',
      phoneNumber: '+000test-rest-1',
      provisioningStatus: 'PENDING',
      telnyxPhoneNumberId: null,
      forwardingConfiguredAt: null,
      testCallValidatedAt: null,
      firstCallAt: null,
      onboardingTasks: {},
    };

    vi.mocked(db.restaurant.findFirst).mockResolvedValueOnce(null);
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue(
      mockRestaurant as unknown as Awaited<ReturnType<typeof db.restaurant.findUniqueOrThrow>>,
    );

    const updatedRestaurant = {
      ...mockRestaurant,
      phoneNumber: '+33451221528',
      provisioningStatus: 'PHONE_ASSIGNED',
      telnyxPhoneNumberId: 'tnx-999',
    };

    vi.mocked(db.restaurant.update).mockResolvedValueOnce(
      updatedRestaurant as unknown as Awaited<ReturnType<typeof db.restaurant.update>>,
    );

    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/provisioning/test-rest-1/assign-phone',
      headers: AUTH,
      payload: {
        phoneNumber: '+33451221528',
        telnyxPhoneNumberId: 'tnx-999',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.message).toContain('+33451221528');
    expect(db.restaurant.update).toHaveBeenCalled();
  });

  it('POST /admin/provisioning/:restaurantId/verify-webhook valide le webhook', async () => {
    const mockRestaurant = {
      id: 'test-rest-1',
      name: 'Chez Sokar Test',
      phoneNumber: '+33451221528',
      provisioningStatus: 'PHONE_ASSIGNED',
      telnyxPhoneNumberId: 'tnx-999',
      forwardingConfiguredAt: null,
      testCallValidatedAt: null,
      firstCallAt: null,
      onboardingTasks: {},
    };

    const updated = {
      ...mockRestaurant,
      provisioningStatus: 'WEBHOOK_READY',
      forwardingConfiguredAt: new Date(),
    };

    vi.mocked(db.restaurant.findUniqueOrThrow)
      .mockResolvedValueOnce(
        mockRestaurant as unknown as Awaited<ReturnType<typeof db.restaurant.findUniqueOrThrow>>,
      )
      .mockResolvedValueOnce(
        updated as unknown as Awaited<ReturnType<typeof db.restaurant.findUniqueOrThrow>>,
      );

    vi.mocked(db.restaurant.update).mockResolvedValueOnce(
      updated as unknown as Awaited<ReturnType<typeof db.restaurant.update>>,
    );

    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/provisioning/test-rest-1/verify-webhook',
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.status.steps.webhook.completed).toBe(true);
  });

  it('POST /admin/provisioning/:restaurantId/test-call déclenche un appel test', async () => {
    const mockRestaurant = {
      id: 'test-rest-1',
      name: 'Chez Sokar Test',
      phoneNumber: '+33451221528',
      managerPhone: '+33612345678',
      provisioningStatus: 'WEBHOOK_READY',
      telnyxPhoneNumberId: 'tnx-999',
      forwardingConfiguredAt: new Date(),
      testCallValidatedAt: null,
      firstCallAt: null,
      onboardingTasks: {},
    };

    vi.mocked(db.restaurant.findUnique).mockResolvedValueOnce({
      managerPhone: '+33612345678',
    } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);

    const updated = {
      ...mockRestaurant,
      provisioningStatus: 'ACTIVE',
      testCallValidatedAt: new Date(),
      firstCallAt: new Date(),
    };

    vi.mocked(db.restaurant.findUniqueOrThrow)
      .mockResolvedValueOnce(
        mockRestaurant as unknown as Awaited<ReturnType<typeof db.restaurant.findUniqueOrThrow>>,
      )
      .mockResolvedValueOnce(
        updated as unknown as Awaited<ReturnType<typeof db.restaurant.findUniqueOrThrow>>,
      );

    vi.mocked(db.restaurant.update).mockResolvedValueOnce(
      updated as unknown as Awaited<ReturnType<typeof db.restaurant.update>>,
    );

    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/provisioning/test-rest-1/test-call',
      headers: AUTH,
      payload: {
        targetPhoneNumber: '+33612345678',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.callControlId).toBe('test-call-control-123');
    expect(body.message).toContain('+33612345678');
  });
});

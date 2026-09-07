import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeApp, getApp } from '../../../test/helpers';

describe('restaurant plan guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('ignore un plan PREMIUM fourni par le client lors de la création', async () => {
    const app = await getApp();
    vi.mocked(app.db.restaurant.create).mockResolvedValue({
      id: 'restaurant-created',
      name: 'Chez Test',
      plan: 'STARTER',
    } as never);
    const response = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { authorization: 'Bearer test' },
      payload: {
        name: 'Chez Test',
        managerPhone: '+33612345678',
        managerEmail: 'manager@example.com',
        phoneNumber: '+33412345678',
        openingHours: {
          mon: { open: '12:00', close: '22:00' },
          tue: { open: '12:00', close: '22:00' },
          wed: { open: '12:00', close: '22:00' },
          thu: { open: '12:00', close: '22:00' },
          fri: { open: '12:00', close: '22:00' },
          sat: { open: '12:00', close: '22:00' },
          sun: null,
        },
        plan: 'PREMIUM',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(app.db.restaurant.create).toHaveBeenCalledWith({
      data: expect.not.objectContaining({ plan: expect.anything() }),
    });
  });
});

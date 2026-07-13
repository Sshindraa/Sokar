import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

const AUTH = { authorization: 'Bearer fake-token' };
const RESTAURANT_ID = 'test-rest-1';

function d(value: number) {
  return new Prisma.Decimal(value);
}

describe('gift-card-pack routes', () => {
  afterAll(async () => {
    await closeApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retourne 401 sans auth', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/restaurants/${RESTAURANT_ID}/gift-card-packs`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('liste les packs', async () => {
    vi.mocked(db.giftCardPack.findMany).mockResolvedValue([
      {
        id: 'pack-1',
        restaurantId: RESTAURANT_ID,
        name: 'Menu dégustation',
        amount: d(120),
        isActive: true,
      } as unknown as Awaited<ReturnType<typeof db.giftCardPack.findMany>>[number],
    ]);

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/restaurants/${RESTAURANT_ID}/gift-card-packs`,
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('crée un pack', async () => {
    vi.mocked(db.giftCardPack.create).mockResolvedValue({
      id: 'pack-1',
      restaurantId: RESTAURANT_ID,
      name: 'Menu dégustation',
      description: 'Menu 3 services + accord mets/vins',
      amount: d(120),
      minPartySize: 2,
      maxPartySize: 2,
      isActive: true,
    } as unknown as Awaited<ReturnType<typeof db.giftCardPack.create>>);

    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: `/restaurants/${RESTAURANT_ID}/gift-card-packs`,
      headers: AUTH,
      payload: {
        name: 'Menu dégustation',
        description: 'Menu 3 services + accord mets/vins',
        amount: 120,
        minPartySize: 2,
        maxPartySize: 2,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('Menu dégustation');
    expect(Number(body.amount)).toBe(120);
  });

  it('modifie un pack', async () => {
    vi.mocked(db.giftCardPack.findFirst).mockResolvedValue({
      id: 'pack-1',
      restaurantId: RESTAURANT_ID,
    } as unknown as Awaited<ReturnType<typeof db.giftCardPack.create>>);
    vi.mocked(db.giftCardPack.update).mockResolvedValue({
      id: 'pack-1',
      restaurantId: RESTAURANT_ID,
      name: 'Menu dégustation premium',
      amount: d(150),
      isActive: true,
    } as unknown as Awaited<ReturnType<typeof db.giftCardPack.create>>);

    const app = await getApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/restaurants/${RESTAURANT_ID}/gift-card-packs/pack-1`,
      headers: AUTH,
      payload: { name: 'Menu dégustation premium', amount: 150 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Menu dégustation premium');
  });

  it('active/désactive un pack', async () => {
    vi.mocked(db.giftCardPack.findFirst).mockResolvedValue({
      id: 'pack-1',
      restaurantId: RESTAURANT_ID,
      isActive: true,
    } as unknown as Awaited<ReturnType<typeof db.giftCardPack.create>>);
    vi.mocked(db.giftCardPack.update).mockResolvedValue({
      id: 'pack-1',
      restaurantId: RESTAURANT_ID,
      name: 'Menu dégustation',
      isActive: false,
    } as unknown as Awaited<ReturnType<typeof db.giftCardPack.create>>);

    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: `/restaurants/${RESTAURANT_ID}/gift-card-packs/pack-1/toggle`,
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().isActive).toBe(false);
  });
});

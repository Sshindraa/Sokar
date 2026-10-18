import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { verifyTestBookingToken } from '../../connect/test-booking';

const RESTAURANT_ID = '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f';
const PUBLISHED_MESSAGE = 'Publiez d’abord votre page pour la tester.';

async function call(headers: Record<string, string> = { authorization: 'Bearer test' }) {
  const app = await getApp();
  return app.inject({
    method: 'POST',
    url: '/restaurant/test-booking-link',
    headers: { 'x-test-restaurant-id': RESTAURANT_ID, ...headers },
  });
}

function mockRestaurant(value: unknown) {
  vi.mocked(db.restaurant.findUnique).mockResolvedValue(
    value as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>,
  );
}

describe('POST /restaurant/test-booking-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('TEST_BOOKING_ENABLED', 'true');
    vi.stubEnv('TEST_BOOKING_SECRET', randomBytes(32).toString('hex'));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeApp();
  });

  it('renvoie 401 sans session', async () => {
    const res = await call({});
    expect(res.statusCode).toBe(401);
  });

  it('renvoie 404 TEST_BOOKING_DISABLED quand le drapeau est coupé', async () => {
    vi.stubEnv('TEST_BOOKING_ENABLED', 'false');
    const res = await call();
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 'TEST_BOOKING_DISABLED' });
  });

  it('renvoie 409 PAGE_NOT_PUBLISHED quand la page n’est pas publiée', async () => {
    mockRestaurant({
      slug: 'le-bistrot',
      publishedAt: new Date(),
      agenticOptIn: true,
      exposureSettings: { connectPublished: false },
    });
    const res = await call();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'PAGE_NOT_PUBLISHED', error: PUBLISHED_MESSAGE });
  });

  it.each([
    ['publishedAt absent', { publishedAt: null, agenticOptIn: true }],
    ['agenticOptIn désactivé', { publishedAt: new Date(), agenticOptIn: false }],
  ])('renvoie 409 PAGE_NOT_PUBLISHED quand %s malgré connectPublished', async (_n, extra) => {
    mockRestaurant({ slug: 'le-bistrot', ...extra, exposureSettings: { connectPublished: true } });
    const res = await call();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('PAGE_NOT_PUBLISHED');
  });

  it('renvoie 409 PAGE_NOT_PUBLISHED quand le restaurant n’a pas de slug', async () => {
    mockRestaurant({
      slug: null,
      publishedAt: new Date(),
      agenticOptIn: true,
      exposureSettings: { connectPublished: true },
    });
    const res = await call();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('PAGE_NOT_PUBLISHED');
  });

  it('renvoie 200 avec une URL Connect portant un jeton vérifiable', async () => {
    mockRestaurant({
      slug: 'le-bistrot',
      publishedAt: new Date(),
      agenticOptIn: true,
      exposureSettings: { connectPublished: true },
    });
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const url = new URL(res.json().url);
    expect(url.pathname).toBe('/restaurant/le-bistrot');
    const token = url.searchParams.get('testBooking');
    expect(token).toBeTruthy();
    expect(verifyTestBookingToken(token as string, RESTAURANT_ID)).toBe(true);
    expect(db.restaurant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: RESTAURANT_ID } }),
    );
  });
});

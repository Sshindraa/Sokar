import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redisMock = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  fail: false,
  incr: vi.fn(),
  expire: vi.fn(),
}));

vi.mock('../../../shared/redis/client', () => ({
  redisCache: { incr: redisMock.incr, expire: redisMock.expire },
}));
vi.mock('../../../shared/observability/alerts', () => ({ alertFailOpen: vi.fn() }));

import {
  TEST_BOOKING_TOKEN_PATTERN,
  consumeTestBookingQuota,
  isTestBookingEnabled,
  issueTestBookingToken,
  verifyTestBookingToken,
} from '../test-booking';

const HOUR = 3_600_000;

describe('test-booking token', () => {
  const restaurantId = randomUUID();
  const original = { ...process.env };

  beforeEach(() => {
    process.env.TEST_BOOKING_ENABLED = 'true';
    process.env.TEST_BOOKING_SECRET = randomBytes(32).toString('hex');
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it('émet un jeton au format attendu, vérifié pour son restaurant', () => {
    const token = issueTestBookingToken(restaurantId);
    expect(token).toMatch(TEST_BOOKING_TOKEN_PATTERN);
    expect(verifyTestBookingToken(token, restaurantId)).toBe(true);
  });

  it('refuse un autre restaurant', () => {
    const token = issueTestBookingToken(restaurantId);
    expect(verifyTestBookingToken(token, randomUUID())).toBe(false);
  });

  it('refuse après 1 h et accepte juste avant', () => {
    const now = new Date('2026-10-18T10:00:00Z');
    const token = issueTestBookingToken(restaurantId, now);
    expect(verifyTestBookingToken(token, restaurantId, new Date(now.getTime() + HOUR - 2000))).toBe(
      true,
    );
    expect(verifyTestBookingToken(token, restaurantId, new Date(now.getTime() + HOUR))).toBe(false);
  });

  it('refuse un jeton modifié d’un caractère', () => {
    const token = issueTestBookingToken(restaurantId);
    const flip = (i: number) =>
      token.slice(0, i) + (token[i] === 'A' ? 'B' : 'A') + token.slice(i + 1);
    expect(verifyTestBookingToken(flip(3), restaurantId)).toBe(false);
    expect(verifyTestBookingToken(flip(token.length - 5), restaurantId)).toBe(false);
  });

  it('refuse un jeton mal formé', () => {
    expect(verifyTestBookingToken('', restaurantId)).toBe(false);
    expect(verifyTestBookingToken('abc.def', restaurantId)).toBe(false);
  });

  it('refuse si le secret change ou est invalide', () => {
    const token = issueTestBookingToken(restaurantId);
    process.env.TEST_BOOKING_SECRET = randomBytes(32).toString('hex');
    expect(verifyTestBookingToken(token, restaurantId)).toBe(false);
    process.env.TEST_BOOKING_SECRET = 'zz';
    expect(verifyTestBookingToken(token, restaurantId)).toBe(false);
  });

  it('lève une erreur pour un restaurant non UUID ou sans secret', () => {
    expect(() => issueTestBookingToken('pas-un-uuid')).toThrow();
    delete process.env.TEST_BOOKING_SECRET;
    expect(() => issueTestBookingToken(restaurantId)).toThrow();
  });

  it('isTestBookingEnabled exige le drapeau et un secret valide', () => {
    expect(isTestBookingEnabled()).toBe(true);
    process.env.TEST_BOOKING_ENABLED = 'false';
    expect(isTestBookingEnabled()).toBe(false);
    process.env.TEST_BOOKING_ENABLED = 'true';
    process.env.TEST_BOOKING_SECRET = 'court';
    expect(isTestBookingEnabled()).toBe(false);
    delete process.env.TEST_BOOKING_SECRET;
    expect(isTestBookingEnabled()).toBe(false);
    delete process.env.TEST_BOOKING_ENABLED;
    process.env.TEST_BOOKING_SECRET = randomBytes(32).toString('hex');
    expect(isTestBookingEnabled()).toBe(false);
  });
});

describe('test-booking quota', () => {
  beforeEach(() => {
    redisMock.counts.clear();
    redisMock.fail = false;
    redisMock.incr.mockReset().mockImplementation(async (key: string) => {
      if (redisMock.fail) throw new Error('redis down');
      const next = (redisMock.counts.get(key) ?? 0) + 1;
      redisMock.counts.set(key, next);
      return next;
    });
    redisMock.expire.mockReset().mockResolvedValue(1);
  });

  it('autorise 5 réservations par restaurant puis refuse', async () => {
    const id = randomUUID();
    for (let i = 0; i < 5; i++) expect(await consumeTestBookingQuota(id)).toBe(true);
    expect(await consumeTestBookingQuota(id)).toBe(false);
    expect(await consumeTestBookingQuota(randomUUID())).toBe(true);
    expect(redisMock.incr).toHaveBeenCalledWith(`test-booking:quota:${id}`);
    expect(redisMock.expire).toHaveBeenCalledTimes(2);
    expect(redisMock.expire).toHaveBeenCalledWith(`test-booking:quota:${id}`, 86400);
  });

  it('bascule sur le repli mémoire quand Redis est indisponible', async () => {
    redisMock.fail = true;
    const id = randomUUID();
    for (let i = 0; i < 5; i++) expect(await consumeTestBookingQuota(id)).toBe(true);
    expect(await consumeTestBookingQuota(id)).toBe(false);
    expect(await consumeTestBookingQuota(randomUUID())).toBe(true);
  });
});

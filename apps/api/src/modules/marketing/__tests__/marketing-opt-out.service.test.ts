import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearMarketingOptOut,
  isMarketingOptedOut,
  isMarketingOptOutRegisterConfigured,
  loadOptedOutCustomerIds,
  marketingOptOutHash,
  marketingOptOutRetainUntil,
  purgeExpiredMarketingOptOuts,
  registerMarketingOptOut,
} from '../marketing-opt-out.service';

const writer = {
  marketingOptOut: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
} as never;
const optOut = (writer as unknown as { marketingOptOut: Record<string, ReturnType<typeof vi.fn>> })
  .marketingOptOut;

const KEY = 'k'.repeat(40);

describe('marketing opt-out register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', KEY);
    optOut.upsert.mockResolvedValue({});
    optOut.deleteMany.mockResolvedValue({ count: 1 });
    optOut.findMany.mockResolvedValue([]);
  });
  afterEach(() => vi.unstubAllEnvs());

  describe('hash', () => {
    it('is a keyed HMAC of the normalized address, stable across spelling', () => {
      const hash = marketingOptOutHash('EMAIL', ' Alice@Example.com ');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(marketingOptOutHash('EMAIL', 'alice@example.com')).toBe(hash);
      expect(marketingOptOutHash('SMS', '+33 6 01 02 03 04')).toBe(
        marketingOptOutHash('SMS', '+33601020304'),
      );
    });

    it('depends on the key and on the channel, and never contains the address', () => {
      const hash = marketingOptOutHash('EMAIL', 'alice@example.com');
      vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', 'z'.repeat(40));
      expect(marketingOptOutHash('EMAIL', 'alice@example.com')).not.toBe(hash);
      expect(marketingOptOutHash('SMS', '+33601020304')).not.toBe(
        marketingOptOutHash('WHATSAPP', '+33601020304'),
      );
      expect(hash).not.toContain('alice');
    });

    it('is null without a long enough key, or without a usable address', () => {
      vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', 'trop-court');
      expect(isMarketingOptOutRegisterConfigured()).toBe(false);
      expect(marketingOptOutHash('EMAIL', 'alice@example.com')).toBeNull();
      vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', KEY);
      expect(isMarketingOptOutRegisterConfigured()).toBe(true);
      expect(marketingOptOutHash('EMAIL', 'pas-une-adresse')).toBeNull();
      expect(marketingOptOutHash('EMAIL', null)).toBeNull();
    });
  });

  it('keeps an entry for 3 years from the opposition', () => {
    expect(marketingOptOutRetainUntil(new Date('2026-10-23T10:00:00.000Z')).toISOString()).toBe(
      '2029-10-23T10:00:00.000Z',
    );
  });

  describe('register', () => {
    const input = {
      restaurantId: 'restaurant-1',
      channel: 'EMAIL' as const,
      address: 'alice@example.com',
      reason: 'UNSUBSCRIBE' as const,
      source: 'UNSUBSCRIBE_LINK',
      occurredAt: new Date('2026-10-23T10:00:00.000Z'),
    };

    it('stores the hash, never the address, with its retention', async () => {
      await expect(registerMarketingOptOut(input, writer)).resolves.toBe('REGISTERED');
      const call = optOut.upsert.mock.calls[0][0];
      expect(call.create).toMatchObject({
        restaurantId: 'restaurant-1',
        channel: 'EMAIL',
        reason: 'UNSUBSCRIBE',
        source: 'UNSUBSCRIBE_LINK',
        retainUntil: new Date('2029-10-23T10:00:00.000Z'),
      });
      expect(call.create.addressHash).toBe(marketingOptOutHash('EMAIL', 'alice@example.com'));
      expect(JSON.stringify(call)).not.toContain('alice@example.com');
    });

    it('is a no-op without the key or without an address', async () => {
      await expect(registerMarketingOptOut({ ...input, address: null }, writer)).resolves.toBe(
        'SKIPPED_NO_ADDRESS',
      );
      vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', '');
      await expect(registerMarketingOptOut(input, writer)).resolves.toBe('SKIPPED_NO_KEY');
      expect(optOut.upsert).not.toHaveBeenCalled();
    });

    it('lifts the opposition of the same address only, in the same restaurant and channel', async () => {
      await expect(
        clearMarketingOptOut(
          { restaurantId: 'restaurant-1', channel: 'EMAIL', address: 'alice@example.com' },
          writer,
        ),
      ).resolves.toBe(1);
      expect(optOut.deleteMany).toHaveBeenCalledWith({
        where: {
          restaurantId: 'restaurant-1',
          channel: 'EMAIL',
          addressHash: marketingOptOutHash('EMAIL', 'alice@example.com'),
        },
      });
    });
  });

  describe('lookup', () => {
    it('finds the registered addresses of a restaurant', async () => {
      const hash = marketingOptOutHash('EMAIL', 'alice@example.com');
      optOut.findMany.mockResolvedValue([{ addressHash: hash }]);
      await expect(
        isMarketingOptedOut(
          { restaurantId: 'restaurant-1', channel: 'EMAIL', address: 'Alice@example.com' },
          writer,
        ),
      ).resolves.toBe(true);
      expect(optOut.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ restaurantId: 'restaurant-1', channel: 'EMAIL' }),
        }),
      );
    });

    it('maps registered hashes back to customers, with the right address per channel', async () => {
      optOut.findMany.mockResolvedValue([
        { addressHash: marketingOptOutHash('EMAIL', 'alice@example.com') },
      ]);
      const result = await loadOptedOutCustomerIds(
        {
          restaurantId: 'restaurant-1',
          channel: 'EMAIL',
          customers: [
            { id: 'c1', phone: '+33601020304', emailNormalized: 'alice@example.com' },
            { id: 'c2', phone: '+33605060708', emailNormalized: 'bob@example.com' },
            { id: 'c3', phone: '+33609101112', emailNormalized: null },
          ],
        },
        writer,
      );
      expect(result.checked).toBe(true);
      expect([...result.optedOut]).toEqual(['c1']);
    });

    it('reports that nothing could be checked when the key is missing', async () => {
      vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', '');
      const result = await loadOptedOutCustomerIds(
        {
          restaurantId: 'restaurant-1',
          channel: 'EMAIL',
          customers: [{ id: 'c1', emailNormalized: 'alice@example.com' }],
        },
        writer,
      );
      expect(result).toEqual({ checked: false, optedOut: new Set() });
      expect(optOut.findMany).not.toHaveBeenCalled();
    });
  });

  it('purges only the entries whose retention has elapsed', async () => {
    optOut.deleteMany.mockResolvedValue({ count: 2 });
    const now = new Date('2029-10-24T00:00:00.000Z');
    await expect(purgeExpiredMarketingOptOuts(now, writer)).resolves.toBe(2);
    expect(optOut.deleteMany).toHaveBeenCalledWith({ where: { retainUntil: { lt: now } } });
    await expect(purgeExpiredMarketingOptOuts(new Date('nope'), writer)).rejects.toThrow();
  });
});

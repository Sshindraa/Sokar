import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REDIS_CTX_TTL_SECONDS } from '@sokar/config';

vi.mock('../../../shared/db/client', () => ({
  db: {
    restaurant: {
      findUniqueOrThrow: vi.fn(),
    },
  },
}));

vi.mock('../../../shared/redis/client', () => ({
  redisCache: {
    del: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  },
  getCachedContext: vi.fn(),
  setCachedContext: vi.fn(),
}));

const restaurantFromDb = {
  id: 'rest-1',
  name: 'Chez Cache',
  plan: 'STARTER',
  managerPhone: '+33600000000',
  managerEmail: 'boss@sokar.test',
  phoneNumber: 'pn-cache',
  openingHours: { mon: { open: '12:00', close: '22:00' } },
  carrier: 'telnyx',
  smsConfirmEnabled: true,
  googleCalendarId: 'calendar-safe-id',
  googleRefreshToken: 'secret-refresh-token-never-cache',
  personality: {
    id: 'personality-1',
    restaurantId: 'rest-1',
    profileType: 'BISTROT_BRASSERIE',
    speakingRate: '1.0',
    pitchShift: '1.0',
    fillerStyle: 'CASUAL',
    microphoneThreshold: -42,
    targetLatencyMs: 140,
    systemPromptExtra: 'Suggère les plats du jour.',
    voiceIdCa: 'voice-from-personality',
    updatedAt: new Date('2026-06-20T10:00:00.000Z'),
  },
};

describe('RestaurantService context cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CARTESIA_API_KEY;
    process.env.DEEPGRAM_MODEL = 'nova-3';
  });

  it('lit le contexte restaurant depuis Redis sans toucher Prisma en cache hit', async () => {
    const { db } = await import('../../../shared/db/client');
    const { getCachedContext } = await import('../../../shared/redis/client');
    const { RestaurantService } = await import('../restaurant.service');

    const cached = {
      id: 'rest-1',
      name: 'Chez Cache',
      openingHours: {},
      personality: null,
      providerConfig: { llmModel: 'mistralai/ministral-3b-2512' },
    };
    vi.mocked(getCachedContext).mockResolvedValue(cached);

    const result = await RestaurantService.loadContext('pn-cache');

    expect(result).toBe(cached);
    expect(getCachedContext).toHaveBeenCalledWith('phone:pn-cache');
    expect(db.restaurant.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('cache uniquement le contexte utile au voice pipeline avec TTL court et sans secrets', async () => {
    const { db } = await import('../../../shared/db/client');
    const { getCachedContext, setCachedContext } = await import('../../../shared/redis/client');
    const { RestaurantService } = await import('../restaurant.service');

    vi.mocked(getCachedContext).mockResolvedValue(null);
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue(restaurantFromDb as any);

    const result = await RestaurantService.loadContext('pn-cache');

    expect(db.restaurant.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { phoneNumber: 'pn-cache' },
      select: expect.not.objectContaining({ googleRefreshToken: true }),
    });
    expect(setCachedContext).toHaveBeenCalledWith('phone:pn-cache', result, REDIS_CTX_TTL_SECONDS);

    const cachedPayload = JSON.stringify(vi.mocked(setCachedContext).mock.calls[0][1]);
    expect(cachedPayload).toContain('Suggère les plats du jour.');
    expect(cachedPayload).toContain('calendar-safe-id');
    expect(cachedPayload).toContain('voice-from-personality');
    expect(cachedPayload).toContain('mistralai/ministral-3b-2512');
    expect(cachedPayload).toContain('cartesia');
    expect(cachedPayload).toContain('nova-3');
    expect(cachedPayload).not.toContain('secret-refresh-token-never-cache');
    expect(cachedPayload).not.toContain('CARTESIA_API_KEY');
    expect(cachedPayload).not.toContain('test-cartesia-key');
  });

  it('invalide le cache par clé téléphone', async () => {
    const { redisCache } = await import('../../../shared/redis/client');
    const { invalidateRestaurantContextCache } = await import('../restaurant.service');

    await invalidateRestaurantContextCache('pn-cache');
    await invalidateRestaurantContextCache(null);

    expect(redisCache.del).toHaveBeenCalledTimes(1);
    expect(redisCache.del).toHaveBeenCalledWith('phone:pn-cache');
  });
});

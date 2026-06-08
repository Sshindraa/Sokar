import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../shared/redis/client', () => ({
  redisCache: {
    getBuffer: vi.fn(),
    set:       vi.fn(),
  },
}));

describe('TTS Cache', () => {
  beforeEach(() => {
    process.env.TTS_CACHE_ENABLED = 'true';
  });

  it('retourne null si cache vide', async () => {
    const { getTtsCached } = await import('../../../modules/voice/tts-cache');
    const { redisCache } = await import('../../../shared/redis/client');
    (redisCache.getBuffer as any).mockResolvedValue(null);
    expect(await getTtsCached('Bonjour, en quoi puis-je vous aider ?', 'voice-id')).toBeNull();
  });

  it('retourne le buffer si cache hit', async () => {
    const { getTtsCached } = await import('../../../modules/voice/tts-cache');
    const { redisCache } = await import('../../../shared/redis/client');
    const fakeBuffer = Buffer.from('audio');
    (redisCache.getBuffer as any).mockResolvedValue(fakeBuffer);
    const result = await getTtsCached('Bonjour, en quoi puis-je vous aider ?', 'voice-id');
    expect(result).toEqual(fakeBuffer);
  });

  it('ne cache pas les phrases trop courtes', async () => {
    const { setTtsCached } = await import('../../../modules/voice/tts-cache');
    const { redisCache } = await import('../../../shared/redis/client');
    (redisCache.set as any).mockClear();
    await setTtsCached('Ok.', 'voice-id', Buffer.from('audio'));
    expect(redisCache.set).not.toHaveBeenCalled();
  });
});

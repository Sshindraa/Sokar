import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetMetrics } from '../../../observability/metrics';
import { elevenLabsCharacterCount, elevenLabsCharacterLimit } from '../../../observability/metrics';
import { refreshElevenLabsSubscription } from '../elevenlabs-subscription.worker';

describe('refreshElevenLabsSubscription', () => {
  afterEach(() => {
    __resetMetrics();
    vi.unstubAllEnvs();
  });

  it('lit le endpoint subscription et publie le compte et la limite sans journaliser la clé', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ character_count: 6_172, character_limit: 10_000 }),
    });

    await expect(
      refreshElevenLabsSubscription({ apiKey: 'test-only-key', fetcher }),
    ).resolves.toEqual({ character_count: 6_172, character_limit: 10_000 });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.elevenlabs.io/v1/user/subscription',
      expect.objectContaining({
        method: 'GET',
        headers: { 'xi-api-key': 'test-only-key' },
      }),
    );
    expect((await elevenLabsCharacterCount.get()).values[0]?.value).toBe(6_172);
    expect((await elevenLabsCharacterLimit.get()).values[0]?.value).toBe(10_000);
  });

  it('refuse une clé absente avant tout appel', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', '');
    const fetcher = vi.fn();

    await expect(refreshElevenLabsSubscription({ fetcher })).rejects.toThrow(
      'ELEVENLABS_API_KEY is not configured',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('ne publie pas de compte si la réponse HTTP est une erreur', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    });

    await expect(
      refreshElevenLabsSubscription({ apiKey: 'test-only-key', fetcher }),
    ).rejects.toThrow('HTTP 429');
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetMetrics } from '../../../observability/metrics';
import { elevenLabsCharacterCount, elevenLabsCharacterLimit } from '../../../observability/metrics';
import {
  dispatchElevenLabsUsageAlerts,
  refreshElevenLabsSubscription,
} from '../elevenlabs-subscription.worker';

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

describe('alertes de consommation ElevenLabs', () => {
  const now = new Date('2026-09-24T12:00:00.000Z');
  const resetAt = Math.floor(new Date('2026-10-01T00:00:00.000Z').getTime() / 1_000);

  afterEach(() => vi.clearAllMocks());

  function makeDependencies() {
    const activeKeys = new Set<string>();
    const claimStore = {
      set: vi.fn(
        async (
          key: string,
          _value: string,
          _expiryMode: 'EX',
          _ttlSeconds: number,
          _condition: 'NX',
        ) => {
          if (activeKeys.has(key)) return null;
          activeKeys.add(key);
          return 'OK';
        },
      ),
      del: vi.fn(async (key: string) => Number(activeKeys.delete(key))),
    };
    const dispatch = vi.fn().mockResolvedValue([]);
    return { claimStore, dispatch, activeKeys };
  }

  it('dispatche les seuils 80 %, 95 % et 100 % avec leur niveau', async () => {
    const dependencies = makeDependencies();

    const result = await dispatchElevenLabsUsageAlerts(
      {
        character_count: 10_000,
        character_limit: 10_000,
        next_character_count_reset_unix: resetAt,
      },
      { ...dependencies, now },
    );

    expect(result).toEqual({ dispatched: 3, suppressed: 0 });
    expect(dependencies.dispatch.mock.calls.map(([alert]) => [alert.kind, alert.severity])).toEqual(
      [
        ['elevenlabs_character_usage_80', 'warning'],
        ['elevenlabs_character_usage_95', 'critical'],
        ['elevenlabs_character_usage_100', 'critical'],
      ],
    );
    expect(dependencies.claimStore.set.mock.calls.map(([key]) => key)).toEqual([
      `sokar:elevenlabs:character-usage:${resetAt}:80`,
      `sokar:elevenlabs:character-usage:${resetAt}:95`,
      `sokar:elevenlabs:character-usage:${resetAt}:100`,
    ]);
    expect(JSON.stringify(dependencies.dispatch.mock.calls)).not.toMatch(/\+33|callId|phone/i);
  });

  it('supprime le cooldown au retour sous le seuil et réalerte au nouveau franchissement', async () => {
    const dependencies = makeDependencies();
    const options = { ...dependencies, now };

    await dispatchElevenLabsUsageAlerts(
      { character_count: 9_600, character_limit: 10_000, next_character_count_reset_unix: resetAt },
      options,
    );
    await dispatchElevenLabsUsageAlerts(
      { character_count: 9_400, character_limit: 10_000, next_character_count_reset_unix: resetAt },
      options,
    );
    await dispatchElevenLabsUsageAlerts(
      { character_count: 9_600, character_limit: 10_000, next_character_count_reset_unix: resetAt },
      options,
    );

    expect(dependencies.dispatch).toHaveBeenCalledTimes(3);
    expect(dependencies.dispatch.mock.calls.map(([alert]) => alert.kind)).toEqual([
      'elevenlabs_character_usage_80',
      'elevenlabs_character_usage_95',
      'elevenlabs_character_usage_95',
    ]);
    expect(dependencies.claimStore.del).toHaveBeenCalledWith(
      `sokar:elevenlabs:character-usage:${resetAt}:95`,
    );
  });

  it('isole le cooldown par période de facturation', async () => {
    const dependencies = makeDependencies();

    for (const nextReset of [resetAt, resetAt + 30 * 24 * 60 * 60]) {
      await dispatchElevenLabsUsageAlerts(
        {
          character_count: 8_000,
          character_limit: 10_000,
          next_character_count_reset_unix: nextReset,
        },
        { ...dependencies, now },
      );
    }

    expect(dependencies.dispatch).toHaveBeenCalledTimes(2);
    expect(dependencies.activeKeys.size).toBe(2);
  });
});

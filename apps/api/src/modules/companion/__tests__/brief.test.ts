import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { redisCache } from '../../../shared/redis/client';
import { cachedBrief, computeBrief } from '../brief';
import { explainChange } from '../explain-change';
import { computeQueryData } from '../query-data';
import { computeTonight } from '../tonight';

vi.mock('../tonight', () => ({ computeTonight: vi.fn() }));
vi.mock('../explain-change', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../explain-change')>()),
  explainChange: vi.fn(),
}));
vi.mock('../query-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../query-data')>()),
  computeQueryData: vi.fn(),
}));
vi.mock('../../../shared/redis/client', () => ({ redisCache: { get: vi.fn(), set: vi.fn() } }));

const CARD = {
  service: 'soir',
  date: '2026-10-31',
  covers: 32,
  usualCovers: 28.5,
  specialRequestsCount: 2,
  waitlistCount: 1,
  watch: [
    {
      reservationId: 'res-1',
      name: 'Marie Durand',
      time: '19:30',
      partySize: 4,
      reasons: ['unconfirmed'],
    },
  ],
  attention: [],
};

const EXPLANATION = {
  source: 'reservations',
  compare: 'usual',
  from: '2026-10-30',
  to: '2026-10-30',
  measures: [
    {
      measure: 'count',
      total: { value: 14, reference: 9, delta: 5, delta_pct: 56 },
      drivers: [
        {
          dimension: 'channel',
          label: 'canal d’arrivée',
          key: 'phone',
          value: 9,
          reference: 4,
          delta: 5,
          share_pct: 100,
        },
      ],
      low_volume: false,
    },
  ],
  alongside: [],
};

const RECOVERY = {
  query: {},
  total: 8,
  groups: [
    { key: 'OPEN', value: 2 },
    { key: 'none', value: 6 },
  ],
};

const log = { info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger;

function fetcherReplying(content: string) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content } }],
          usage: {
            prompt_tokens: 900,
            completion_tokens: 40,
            prompt_tokens_details: { cached_tokens: 600 },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  );
}

// Corps envoyé au modèle, tel qu'il part sur le réseau.
const sentBody = (fetcher: ReturnType<typeof fetcherReplying>) =>
  String((fetcher.mock.calls[0][1] as RequestInit).body);

const GROUNDED =
  'Ce soir, 32 couverts, contre 28,5 habituellement. Hier, 14 réservations contre 9 habituellement ; en même temps, 2 tâches de récupération sont ouvertes.';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(computeTonight).mockResolvedValue(CARD as never);
  vi.mocked(explainChange).mockResolvedValue(EXPLANATION as never);
  vi.mocked(computeQueryData).mockResolvedValue(RECOVERY as never);
  vi.mocked(redisCache.get).mockResolvedValue(null);
  vi.mocked(redisCache.set).mockResolvedValue('OK' as never);
});

describe('computeBrief : résumé ancré', () => {
  it('rend le résumé quand chaque chiffre figure dans les données, sans nom envoyé au modèle', async () => {
    const fetcher = fetcherReplying(GROUNDED);

    const brief = await computeBrief({ restaurantId: 'r1', now: new Date(), log, fetcher });

    expect(brief).toBe(GROUNDED);
    expect(sentBody(fetcher)).not.toContain('Marie');
    expect(redisCache.set).toHaveBeenCalledWith(
      'companion:brief:r1:2026-10-31:soir:fr',
      JSON.stringify({ brief: GROUNDED }),
      'EX',
      1800,
    );
  });

  it('envoie les données sans la formule Avis : recovery reste null', async () => {
    vi.mocked(computeQueryData).mockResolvedValue({ unavailable: 'plan' } as never);
    const fetcher = fetcherReplying(GROUNDED.replace(/, 2 tâches.*$/, '.'));

    await computeBrief({ restaurantId: 'r1', now: new Date(), recovery: true, log, fetcher });

    expect(sentBody(fetcher)).toContain('\\"recovery\\":null');
  });
});

describe('computeBrief : pas de résumé', () => {
  it('refuse le résumé quand un chiffre n’est pas dans les données, et trace le nombre sans nom', async () => {
    const fetcher = fetcherReplying('Ce soir, 40 couverts, contre 28,5 habituellement.');

    const brief = await computeBrief({ restaurantId: 'r1', now: new Date(), log, fetcher });

    expect(brief).toBeNull();
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: 'r1', outcome: 'ungrounded', unanchored: [40] }),
      'companion brief',
    );
    expect(JSON.stringify(vi.mocked(log.info).mock.calls)).not.toContain('Marie');
    expect(redisCache.set).toHaveBeenCalledWith(
      'companion:brief:r1:2026-10-31:soir:fr',
      JSON.stringify({ brief: null }),
      'EX',
      1800,
    );
  });

  it('rend null au délai dépassé, sans écrire en cache', async () => {
    const fetcher = vi.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });

    const brief = await computeBrief({
      restaurantId: 'r1',
      now: new Date(),
      log,
      fetcher: fetcher as unknown as typeof fetch,
    });

    expect(brief).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'upstream', reason: 'timeout' }),
      'companion brief',
    );
    expect(redisCache.set).not.toHaveBeenCalled();
  });

  it('rend null à une erreur du fournisseur, sans écrire en cache', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 500 }));

    const brief = await computeBrief({
      restaurantId: 'r1',
      now: new Date(),
      log,
      fetcher: fetcher as unknown as typeof fetch,
    });

    expect(brief).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'upstream', reason: 'http_500' }),
      'companion brief',
    );
    expect(redisCache.set).not.toHaveBeenCalled();
  });
});

describe('computeBrief : cache', () => {
  it('sert le résumé en cache sans appeler le modèle', async () => {
    vi.mocked(redisCache.get).mockResolvedValue(JSON.stringify({ brief: 'Résumé en cache.' }));
    const fetcher = fetcherReplying(GROUNDED);

    const brief = await computeBrief({ restaurantId: 'r1', now: new Date(), log, fetcher });

    expect(brief).toBe('Résumé en cache.');
    expect(fetcher).not.toHaveBeenCalled();
    expect(explainChange).not.toHaveBeenCalled();
  });

  it('cachedBrief lit sans modèle et rend null quand rien n’est en cache', async () => {
    expect(await cachedBrief('r1', { date: '2026-10-31', service: 'soir' }, 'fr')).toBeNull();
    expect(explainChange).not.toHaveBeenCalled();
  });
});

describe('computeBrief : langue du tableau de bord', () => {
  it('écrit en français quand aucune langue n’est demandée', async () => {
    const fetcher = fetcherReplying(GROUNDED);

    await computeBrief({ restaurantId: 'r1', now: new Date(), log, fetcher });

    expect(sentBody(fetcher)).toContain('Rédigez le résumé en français.');
  });

  it.each([
    ['en', 'anglais'],
    ['es', 'espagnol'],
    ['it', 'italien'],
  ] as const)('demande le résumé en %s, avec son cache propre', async (language, name) => {
    const fetcher = fetcherReplying(GROUNDED);

    await computeBrief({ restaurantId: 'r1', now: new Date(), language, log, fetcher });

    expect(sentBody(fetcher)).toContain(`Rédigez le résumé en ${name}.`);
    expect(redisCache.get).toHaveBeenCalledWith(`companion:brief:r1:2026-10-31:soir:${language}`);
  });

  it('lit le résumé de la langue demandée dans le cache', async () => {
    vi.mocked(redisCache.get).mockResolvedValue(JSON.stringify({ brief: 'Summary.' }));

    expect(await cachedBrief('r1', { date: '2026-10-31', service: 'soir' }, 'en')).toBe('Summary.');
    expect(redisCache.get).toHaveBeenCalledWith('companion:brief:r1:2026-10-31:soir:en');
  });
});

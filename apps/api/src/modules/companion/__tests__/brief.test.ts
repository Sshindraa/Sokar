import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { redisCache } from '../../../shared/redis/client';
import { cachedBrief, composeBrief, computeBrief, type BriefFacts } from '../brief';
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

// Les chiffres de ces données sont ceux des mocks ci-dessus : 32, 28,5, 14, 9, 2.
const FACTS = {
  covers: 32,
  usualCovers: 28.5,
  yesterday: { reservations: { total: { value: 14, reference: 9 } } },
  recovery: { days: 30, statuses: [{ status: 'OPEN', count: 2 }] },
} as unknown as BriefFacts;

const GROUNDED_POINTS = [
  'Ce soir, 32 couverts, contre 28,5 habituellement.',
  'Hier, 14 réservations contre 9 habituellement.',
  'En même temps, 2 tâches de récupération sont ouvertes.',
];
const GROUNDED = GROUNDED_POINTS.join(' ');

const log = { info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger;

/** Réponse du fournisseur : le contenu renvoyé, tel quel (JSON attendu, sauf texte donné). */
function fetcherReplying(content: string | { points: string[] }) {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: text } }],
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(computeTonight).mockResolvedValue(CARD as never);
  vi.mocked(explainChange).mockResolvedValue(EXPLANATION as never);
  vi.mocked(computeQueryData).mockResolvedValue(RECOVERY as never);
  vi.mocked(redisCache.get).mockResolvedValue(null);
  vi.mocked(redisCache.set).mockResolvedValue('OK' as never);
});

describe('computeBrief : points ancrés', () => {
  it('rend les points joints quand chacun est valide, sans nom envoyé au modèle', async () => {
    const fetcher = fetcherReplying({ points: GROUNDED_POINTS });

    const brief = await computeBrief({ restaurantId: 'r1', now: new Date(), log, fetcher });

    expect(brief).toBe(GROUNDED);
    expect(sentBody(fetcher)).not.toContain('Marie');
    expect(sentBody(fetcher)).toContain('brief_points');
    expect(redisCache.set).toHaveBeenCalledWith(
      'companion:brief:r1:2026-10-31:soir:fr',
      JSON.stringify({ brief: GROUNDED }),
      'EX',
      1800,
    );
  });

  it('envoie les données sans la formule Avis : recovery reste null', async () => {
    vi.mocked(computeQueryData).mockResolvedValue({ unavailable: 'plan' } as never);
    const fetcher = fetcherReplying({ points: GROUNDED_POINTS.slice(0, 2) });

    await computeBrief({ restaurantId: 'r1', now: new Date(), recovery: true, log, fetcher });

    expect(sentBody(fetcher)).toContain('\\"recovery\\":null');
  });
});

describe('composeBrief : validation point par point', () => {
  const raw = (points: string[]) => JSON.stringify({ points });

  it('garde les trois premiers points valides, dans l’ordre, et ignore le reste', () => {
    const composed = composeBrief(
      FACTS,
      raw([...GROUNDED_POINTS, 'Hier, 14 réservations contre 9 habituellement.']),
    );

    expect(composed).toEqual({ text: GROUNDED, discarded: 0, unanchored: [], invalid: false });
  });

  it('écarte un point de plus de vingt mots', () => {
    const long = Array.from({ length: 21 }, () => 'mot').join(' ');

    const composed = composeBrief(FACTS, raw([long, GROUNDED_POINTS[0]]));

    expect(composed.discarded).toBe(1);
    expect(composed.text).toBe(GROUNDED_POINTS[0]);
  });

  it('écarte un point dont un chiffre n’est pas dans les données, et le signale', () => {
    const composed = composeBrief(FACTS, raw(['Ce soir, 40 couverts.', GROUNDED_POINTS[1]]));

    expect(composed).toEqual({
      text: GROUNDED_POINTS[1],
      discarded: 1,
      unanchored: [40],
      invalid: false,
    });
  });

  it('écarte un point vide, et ajoute le point final s’il manque', () => {
    const composed = composeBrief(FACTS, raw(['   ', 'Ce soir, 32 couverts']));

    expect(composed.discarded).toBe(1);
    expect(composed.text).toBe('Ce soir, 32 couverts.');
  });

  it('rend null sans aucun point valide', () => {
    const composed = composeBrief(FACTS, raw(['Ce soir, 40 couverts.']));

    expect(composed).toEqual({ text: null, discarded: 1, unanchored: [40], invalid: false });
  });

  it('marque une réponse qui n’est pas du JSON valide', () => {
    expect(composeBrief(FACTS, 'Ce soir, 32 couverts.')).toEqual({
      text: null,
      discarded: 0,
      unanchored: [],
      invalid: true,
    });
    expect(composeBrief(FACTS, '{"texte": "pas de points"}').invalid).toBe(true);
  });
});

describe('computeBrief : pas de résumé', () => {
  it('rend null quand aucun point n’est valide, et trace le nombre écarté sans nom', async () => {
    const fetcher = fetcherReplying({
      points: ['Ce soir, 40 couverts, contre 28,5 habituellement.'],
    });

    const brief = await computeBrief({ restaurantId: 'r1', now: new Date(), log, fetcher });

    expect(brief).toBeNull();
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'r1',
        outcome: 'no_valid_point',
        points_discarded: 1,
        unanchored: [40],
      }),
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

  it('rend null sur une réponse sans JSON, sans écrire en cache', async () => {
    const fetcher = fetcherReplying('Ce soir, 32 couverts.');

    const brief = await computeBrief({ restaurantId: 'r1', now: new Date(), log, fetcher });

    expect(brief).toBeNull();
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'invalid' }),
      'companion brief',
    );
    expect(redisCache.set).not.toHaveBeenCalled();
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
    const fetcher = fetcherReplying({ points: GROUNDED_POINTS });

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
    const fetcher = fetcherReplying({ points: GROUNDED_POINTS });

    await computeBrief({ restaurantId: 'r1', now: new Date(), log, fetcher });

    expect(sentBody(fetcher)).toContain('Rédigez les points en français,');
  });

  it.each([
    ['en', 'anglais'],
    ['es', 'espagnol'],
    ['it', 'italien'],
  ] as const)('demande les points en %s, avec son cache propre', async (language, name) => {
    const fetcher = fetcherReplying({ points: GROUNDED_POINTS });

    await computeBrief({ restaurantId: 'r1', now: new Date(), language, log, fetcher });

    expect(sentBody(fetcher)).toContain(`Rédigez les points en ${name},`);
    expect(redisCache.get).toHaveBeenCalledWith(`companion:brief:r1:2026-10-31:soir:${language}`);
  });

  it('lit le résumé de la langue demandée dans le cache', async () => {
    vi.mocked(redisCache.get).mockResolvedValue(JSON.stringify({ brief: 'Summary.' }));

    expect(await cachedBrief('r1', { date: '2026-10-31', service: 'soir' }, 'en')).toBe('Summary.');
    expect(redisCache.get).toHaveBeenCalledWith('companion:brief:r1:2026-10-31:soir:en');
  });
});

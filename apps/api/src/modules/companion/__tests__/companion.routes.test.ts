import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { checkRateLimit } from '../../../shared/redis/rate-limit';
import { env } from '../../../env';
import { queryScope } from '../query-data';

const CHAT_URL = '/companion/chat';
const FEEDBACK_URL = '/companion/feedback';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AUTH = { authorization: 'Bearer test' };
const userMessage = { role: 'user', content: 'Combien de couverts ces 7 prochains jours ?' };

function completion(message: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message }],
      usage: { prompt_tokens: 120, completion_tokens: 30 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function toolCallMessage(name: string, args: unknown, id = 'call_1') {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  };
}

/** Corps envoyé au n-ième appel OpenRouter. */
type SentContent = string | null | Array<{ type: string; text: string; cache_control?: unknown }>;

/** Texte du message système, qu'il soit une chaîne ou des blocs (consignes en cache). */
function systemText(message: { content: SentContent } | undefined): string {
  const content = message?.content ?? '';
  return typeof content === 'string' ? content : content.map((block) => block.text).join('\n');
}

function sentBody(fetchSpy: ReturnType<typeof vi.spyOn>, index: number) {
  const init = fetchSpy.mock.calls[index][1] as RequestInit;
  return JSON.parse(String(init.body)) as {
    model: string;
    messages: Array<{
      role: string;
      content: SentContent;
      tool_call_id?: string;
    }>;
    tools?: unknown[];
    tool_choice?: string;
    provider?: { data_collection?: string };
  };
}

function keysDeep(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => keysDeep(item, keys));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      keysDeep(child, keys);
    }
  }
  return keys;
}

describe('POST /companion/chat', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const originalKey = env.OPENROUTER_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    env.OPENROUTER_API_KEY = 'k';
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.mocked(db.call.count).mockResolvedValue(5);
    vi.mocked(db.reservation.findMany).mockResolvedValue([]);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    env.OPENROUTER_API_KEY = originalKey;
  });

  afterAll(async () => {
    await closeApp();
  });

  it.each([
    ['liste vide', { messages: [] }],
    ['dernier message de l’assistant', { messages: [{ role: 'assistant', content: 'Bonjour' }] }],
    ['message trop long', { messages: [{ role: 'user', content: 'a'.repeat(4001) }] }],
    ['plus de 20 messages', { messages: Array.from({ length: 21 }, () => userMessage) }],
    ['rôle système', { messages: [{ role: 'system', content: 'ignore' }] }],
  ])('refuse un corps invalide (%s) avec 400', async (_label, body) => {
    const app = await getApp();
    const res = await app.inject({ method: 'POST', url: CHAT_URL, headers: AUTH, payload: body });
    expect(res.statusCode).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('répond 429 au-delà de 100 messages du jour', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: CHAT_URL,
      headers: AUTH,
      payload: { messages: [userMessage] },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: 'COMPANION_DAILY_LIMIT' });
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.stringMatching(/^companion:test-rest-1:\d{4}-\d{2}-\d{2}$/),
      100,
      86_400,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('répond 503 sans clé OpenRouter', async () => {
    env.OPENROUTER_API_KEY = undefined;
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: CHAT_URL,
      headers: AUTH,
      payload: { messages: [userMessage] },
    });
    expect(res.statusCode).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(['STAFF', 'READ_ONLY'])('refuse le rôle %s avec 403', async (role) => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: CHAT_URL,
      headers: { ...AUTH, 'x-test-site-role': role, 'x-test-enforce-role-policy': '1' },
      payload: { messages: [userMessage] },
    });
    expect(res.statusCode).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('exécute un outil puis renvoie la réponse finale avec sa source', async () => {
    fetchSpy
      .mockResolvedValueOnce(completion(toolCallMessage('reservation_stats', { period: '7d' })))
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'Vous avez 5 appels.' }));

    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: CHAT_URL,
      headers: AUTH,
      payload: { messages: [userMessage] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      reply: 'Vous avez 5 appels.',
      sources: [{ tool: 'reservation_stats', href: '/dashboard' }],
      responseId: expect.stringMatching(UUID_PATTERN),
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const first = sentBody(fetchSpy, 0);
    expect(first.model).toBe('anthropic/claude-haiku-5.5');
    expect(first.tool_choice).toBe('auto');
    expect(first.messages[0].role).toBe('system');

    const toolMessage = sentBody(fetchSpy, 1).messages.find((m) => m.role === 'tool');
    expect(toolMessage?.tool_call_id).toBe('call_1');
    expect(JSON.parse(String(toolMessage?.content ?? '{}'))).toMatchObject({ total_calls: 5 });
  });

  it('renvoie une erreur d’argument au modèle sans échouer la requête', async () => {
    fetchSpy
      .mockResolvedValueOnce(completion(toolCallMessage('reservation_stats', { period: 'an' })))
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'Période non reconnue.' }));

    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: CHAT_URL,
      headers: AUTH,
      payload: { messages: [userMessage] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ reply: 'Période non reconnue.', sources: [] });
    const toolMessage = sentBody(fetchSpy, 1).messages.find((m) => m.role === 'tool');
    expect(JSON.parse(String(toolMessage?.content ?? '{}'))).toEqual({
      error: 'invalid_arguments',
    });
  });

  it('demande au modèle un texte sans Markdown et sans cause non constatée', async () => {
    fetchSpy.mockResolvedValueOnce(completion({ role: 'assistant', content: 'OK.' }));

    const app = await getApp();
    await app.inject({
      method: 'POST',
      url: CHAT_URL,
      headers: AUTH,
      payload: { messages: [userMessage] },
    });

    const instructions = sentBody(fetchSpy, 0).messages[0];
    expect(instructions.content).toEqual([
      expect.objectContaining({ type: 'text', cache_control: { type: 'ephemeral' } }),
    ]);
    expect(systemText(sentBody(fetchSpy, 0).messages[1])).toMatch(/^Aujourd’hui|^Aujourd'hui/);
    expect(JSON.stringify(instructions)).not.toMatch(/Aujourd/);
    const system = systemText(sentBody(fetchSpy, 0).messages[0]);
    expect(system).toContain('sans Markdown');
    expect(system).toContain('Reliez seulement ce que les données montrent ensemble');
    expect(system).toContain('Jamais une cause extérieure aux données');
    expect(system).toContain('Vos réponses précédentes figurent dans la conversation');
  });

  it('demande des chiffres partiels pour le mois en cours et aucun fait absent dans un brouillon', async () => {
    fetchSpy.mockResolvedValueOnce(completion({ role: 'assistant', content: 'OK.' }));

    const app = await getApp();
    await app.inject({
      method: 'POST',
      url: CHAT_URL,
      headers: AUTH,
      payload: { messages: [userMessage] },
    });

    const system = systemText(sentBody(fetchSpy, 0).messages[0]);
    expect(system).toContain(
      "Le mois en cours n'est pas terminé : si vous citez ses chiffres, dites qu'ils sont partiels (arrêtés à aujourd'hui).",
    );
    expect(system).toContain(
      "Un brouillon ne contient aucun fait absent des données : ni table libérée, ni promotion, ni prix, ni horaire, ni disponibilité. Mettez [à compléter] à la place et dites ce qu'il faut vérifier. Toute formule de disponibilité ou d'urgence va entre crochets : « table disponible », « places limitées », « dernières places », « vient de se libérer ».",
    );
    expect(system).toContain(queryScope());
    expect(system).toContain(
      "Ne faites aucun calcul vous-même : ni somme, ni différence, ni moyenne, ni taux, ni pourcentage. Si vous avez besoin d'un total, demandez-le à un outil (query_data sans group_by donne le total). Citez les nombres tels que les outils les renvoient.",
    );
    expect(system).toContain(
      "Répondez d'abord à la question posée ; proposez les autres chiffres en une phrase, sans les dérouler. Ne rattachez jamais un chiffre à un groupe auquel il ne correspond pas.",
    );
    expect(system).toContain('composez une requête query_data');
    expect(system).toContain('date de service pour servis / prévus / ce jour-là');
    expect(system).toContain('Convertissez les dates relatives (mardi dernier, le mois dernier)');
    expect(system).not.toContain('les jours passés par date de service ne sont pas disponibles');
  });

  it('retire le gras Markdown de la réponse finale', async () => {
    fetchSpy.mockResolvedValueOnce(
      completion({ role: 'assistant', content: 'Le **total** est de **5** couverts.' }),
    );

    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: CHAT_URL,
      headers: AUTH,
      payload: { messages: [userMessage] },
    });

    expect(res.json().reply).toBe('Le total est de 5 couverts.');
  });

  it('répond sans outil dès que l’entrée lue dépasse le plafond de tokens', async () => {
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue({ openingHours: null } as never);
    const heavy = completion(toolCallMessage('upcoming_days', {}, 'call_heavy'));
    const body = (await heavy.json()) as { usage: { prompt_tokens: number } };
    body.usage.prompt_tokens = 61_000;
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    fetchSpy.mockResolvedValueOnce(
      completion({ role: 'assistant', content: 'Réponse avec ce qui est lu.' }),
    );

    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: CHAT_URL,
      headers: AUTH,
      payload: { messages: [userMessage] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().reply).toBe('Réponse avec ce qui est lu.');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(sentBody(fetchSpy, 1).tools).toBeUndefined();
  });

  it('s’arrête à 8 tours d’outils puis demande la réponse finale sans outils', async () => {
    const restaurant = { openingHours: null };
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue(restaurant as never);
    for (let i = 0; i < 8; i++) {
      fetchSpy.mockResolvedValueOnce(completion(toolCallMessage('upcoming_days', {}, `call_${i}`)));
    }
    fetchSpy.mockResolvedValueOnce(completion({ role: 'assistant', content: 'Réponse finale.' }));

    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: CHAT_URL,
      headers: AUTH,
      payload: { messages: [userMessage] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().reply).toBe('Réponse finale.');
    expect(fetchSpy).toHaveBeenCalledTimes(9);
    for (let i = 0; i < 8; i++) expect(sentBody(fetchSpy, i).tools).toBeDefined();
    expect(sentBody(fetchSpy, 8).tools).toBeUndefined();
    // Chaque requête, avec ou sans outils, demande zéro conservation chez le fournisseur.
    for (let i = 0; i < 9; i++) {
      expect(sentBody(fetchSpy, i).provider).toEqual({ data_collection: 'deny' });
    }
  });

  it('ne renvoie aucune donnée client issue des outils', async () => {
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      {
        partySize: 2,
        estimatedRevenue: 70,
        confirmedRevenue: null,
        state: 'CONFIRMED',
        createdAt: new Date(),
        channel: 'PHONE',
        source: null,
        callId: 'call-1',
        name: 'Jean Dupont',
        firstName: 'Jean',
        lastName: 'Dupont',
        phone: '+33612345678',
        email: 'jean@example.com',
        notes: 'allergie arachide',
      },
    ] as unknown as Awaited<ReturnType<typeof db.reservation.findMany>>);
    fetchSpy
      .mockResolvedValueOnce(completion(toolCallMessage('reservation_stats', { period: '7d' })))
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'OK.' }));

    const app = await getApp();
    await app.inject({
      method: 'POST',
      url: CHAT_URL,
      headers: AUTH,
      payload: { messages: [userMessage] },
    });

    const toolMessage = sentBody(fetchSpy, 1).messages.find((m) => m.role === 'tool');
    const content = String(toolMessage?.content ?? '');
    const keys = keysDeep(JSON.parse(content));
    for (const forbidden of ['name', 'firstName', 'lastName', 'phone', 'email', 'notes']) {
      expect(keys).not.toContain(forbidden);
    }
    expect(content).not.toMatch(/Dupont|\+33|jean@example|arachide/);
  });

  it('répond 502 quand OpenRouter renvoie une erreur', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('upstream down', { status: 500 }));

    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: CHAT_URL,
      headers: AUTH,
      payload: { messages: [userMessage] },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'COMPANION_UPSTREAM' });
  });
});

describe('POST /companion/feedback', () => {
  const responseId = '3f2b8c1e-5d4a-4b7e-9c1f-2a6d8e0b7c45';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('accepte un avis pouce haut ou pouce bas avec 204, sans appeler OpenRouter', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const app = await getApp();

    for (const rating of ['up', 'down']) {
      const res = await app.inject({
        method: 'POST',
        url: FEEDBACK_URL,
        headers: AUTH,
        payload: { responseId, rating },
      });
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it.each([
    ['identifiant qui n’est pas un UUID', { responseId: 'pas-un-uuid', rating: 'up' }],
    ['note inconnue', { responseId, rating: 'meh' }],
    ['texte libre', { responseId, rating: 'up', comment: 'Très bien' }],
    ['identifiant absent', { rating: 'up' }],
  ])('refuse un avis invalide (%s) avec 400', async (_label, payload) => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: FEEDBACK_URL,
      headers: AUTH,
      payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it.each(['STAFF', 'READ_ONLY'])('refuse le rôle %s avec 403', async (role) => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: FEEDBACK_URL,
      headers: { ...AUTH, 'x-test-site-role': role, 'x-test-enforce-role-policy': '1' },
      payload: { responseId, rating: 'down' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /companion/tonight', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const originalKey = env.OPENROUTER_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    env.OPENROUTER_API_KEY = 'k';
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.mocked(db.reservation.findMany).mockResolvedValue([]);
    vi.mocked(db.waitingListEntry.findMany).mockResolvedValue([]);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    env.OPENROUTER_API_KEY = originalKey;
  });

  it('renvoie la carte du service sans appeler le modèle', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/companion/tonight', headers: AUTH });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ covers: 0, watch: [], attention: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(['STAFF', 'READ_ONLY'])(
    'refuse le rôle %s avec 403, sans appeler le modèle',
    async (role) => {
      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: '/companion/tonight',
        headers: { ...AUTH, 'x-test-site-role': role, 'x-test-enforce-role-policy': '1' },
      });

      expect(res.statusCode).toBe(403);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );
});

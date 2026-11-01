import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { answerCompanion } from '../companion.service';

const log = { info: vi.fn() } as unknown as FastifyBaseLogger;

function completion(): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'Réponse.' } }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

// Corps de la requête envoyée à OpenRouter pour une réponse sans outil.
async function sentBody(options: { model?: string; reasoningEffort?: 'low' | 'medium' | 'high' }) {
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => completion());
  await answerCompanion({
    restaurantId: 'restaurant-test',
    messages: [{ role: 'user', content: 'Bonjour' }],
    log,
    fetcher: fetcher as unknown as typeof fetch,
    ...options,
  });
  const init = fetcher.mock.calls[0][1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe('answerCompanion : choix du modèle', () => {
  it('par défaut, le modèle de production et un raisonnement bas', async () => {
    const body = await sentBody({});
    expect(body.model).toBe('anthropic/claude-sonnet-5.5');
    expect(body.reasoning).toEqual({ effort: 'low' });
  });

  it('envoie le modèle demandé et l’effort demandé', async () => {
    const body = await sentBody({ model: 'anthropic/claude-haiku-5.5', reasoningEffort: 'high' });
    expect(body.model).toBe('anthropic/claude-haiku-5.5');
    expect(body.reasoning).toEqual({ effort: 'high' });
  });
});

describe('answerCompanion : horloge injectée', () => {
  it('date la réponse de la date de référence fournie, et non de l’heure courante', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      completion(),
    );
    await answerCompanion({
      restaurantId: 'restaurant-test',
      messages: [{ role: 'user', content: 'Bonjour' }],
      log,
      fetcher,
      now: new Date('2026-10-31T11:00:00Z'),
    });

    const body = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body)) as {
      messages: unknown[];
    };
    expect(JSON.stringify(body.messages)).toContain('samedi 31 octobre 2026');
    expect(JSON.stringify(body.messages)).toContain('2026-10-31');
  });
});

describe('answerCompanion : raisonnement entre les appels d’outils', () => {
  it('garde le niveau de production au premier tour, puis le niveau minimal après un appel d’outil', async () => {
    const toolTurn = new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'unknown_tool', arguments: '{}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      fetcher.mock.calls.length === 1 ? toolTurn : completion(),
    );
    await answerCompanion({
      restaurantId: 'restaurant-test',
      messages: [{ role: 'user', content: 'Bonjour' }],
      log,
      fetcher,
    });

    const reasoning = (call: number) =>
      (
        JSON.parse(String((fetcher.mock.calls[call][1] as RequestInit).body)) as {
          reasoning: unknown;
        }
      ).reasoning;
    expect(reasoning(0)).toEqual({ effort: 'low' });
    expect(reasoning(1)).toEqual({ effort: 'minimal' });
  });
});

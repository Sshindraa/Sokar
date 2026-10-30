import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { env } from '../../../env';
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
  it('garde le modèle de production et ne joint aucun effort de raisonnement par défaut', async () => {
    const body = await sentBody({});
    expect(body.model).toBe(env.COMPANION_LLM_MODEL);
    expect(body).not.toHaveProperty('reasoning');
  });

  it('envoie le modèle demandé et son effort de raisonnement', async () => {
    const body = await sentBody({ model: 'anthropic/claude-sonnet-5.5', reasoningEffort: 'low' });
    expect(body.model).toBe('anthropic/claude-sonnet-5.5');
    expect(body.reasoning).toEqual({ effort: 'low' });
  });
});

import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { CampaignDraftSchema, runCompanionTool } from '../companion.tools';
import { answerCompanion } from '../companion.service';

const log = { info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger;

const SMS = {
  channel: 'SMS',
  name: 'Relance table',
  objective: 'Confirmer les réservations sans table',
  body: 'Bonjour, votre réservation est bien prise. [à compléter]',
};

const draftCall = (args: unknown) =>
  new Response(
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
                function: { name: 'draft_campaign', arguments: JSON.stringify(args) },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

const textTurn = () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'Le brouillon est prêt.' } }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

// Deux tours : l'appel d'outil, puis la réponse finale.
function fetcherWith(args: unknown) {
  let turns = 0;
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    turns++;
    return turns === 1 ? draftCall(args) : textTurn();
  });
}

const run = async (args: unknown) => {
  const fetcher = fetcherWith(args);
  const response = await answerCompanion({
    restaurantId: 'restaurant-test',
    messages: [{ role: 'user', content: 'Rédige une relance pour les clients sans table.' }],
    log,
    fetcher: fetcher as unknown as typeof fetch,
  });
  return { response, fetcher };
};

describe('CampaignDraftSchema : brouillon structuré', () => {
  it('accepte un brouillon SMS, et un e-mail avec objet', () => {
    expect(CampaignDraftSchema.safeParse(SMS).success).toBe(true);
    expect(
      CampaignDraftSchema.safeParse({ ...SMS, channel: 'EMAIL', subject: 'Votre table' }).success,
    ).toBe(true);
  });

  it('refuse un e-mail sans objet, un texte vide ou un nom trop long', () => {
    expect(CampaignDraftSchema.safeParse({ ...SMS, channel: 'EMAIL' }).success).toBe(false);
    expect(CampaignDraftSchema.safeParse({ ...SMS, body: '   ' }).success).toBe(false);
    expect(CampaignDraftSchema.safeParse({ ...SMS, name: 'x'.repeat(81) }).success).toBe(false);
  });
});

describe('runCompanionTool : draft_campaign', () => {
  it('garde le brouillon valide', async () => {
    const result = await runCompanionTool('draft_campaign', JSON.stringify(SMS), 'restaurant-test');
    expect(result).toMatchObject({ content: { saved: true }, draft: SMS });
  });

  it('renvoie une erreur lisible pour un brouillon invalide, sans brouillon', async () => {
    const result = await runCompanionTool(
      'draft_campaign',
      JSON.stringify({ ...SMS, channel: 'EMAIL' }),
      'restaurant-test',
    );
    expect(result.draft).toBeUndefined();
    expect(result.content).toMatchObject({
      error: 'invalid_draft',
      detail: 'objet requis pour un e-mail',
    });
  });
});

describe('answerCompanion : brouillon et chiffres des données', () => {
  it('rend le brouillon quand il ne contient aucun chiffre', async () => {
    const { response } = await run({ ...SMS, body: 'Bonjour, votre réservation est bien prise.' });
    expect(response.draft).toMatchObject({ channel: 'SMS', name: 'Relance table' });
  });

  it('écarte le brouillon qui cite un chiffre absent des données, et le dit au modèle', async () => {
    const { response, fetcher } = await run({ ...SMS, body: 'Vous avez 12 couverts à confirmer.' });
    expect(response.draft).toBeNull();
    const secondTurn = String((fetcher.mock.calls[1][1] as RequestInit).body);
    expect(secondTurn).toContain('unanchored_figures');
  });
});

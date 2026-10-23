import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  const tx = {
    customerPreference: { findUnique: vi.fn() },
  };
  return {
    tx,
    db: {
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
      call: { findUnique: vi.fn() },
      customer: { findUnique: vi.fn() },
      customerIdentity: { findUnique: vi.fn() },
    },
  };
});

const crmMock = vi.hoisted(() => ({
  upsertCustomerPreference: vi.fn().mockResolvedValue({}),
  appendCustomerTimelineEvent: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../shared/db/client', () => ({ db: dbMock.db }));
vi.mock('../customer-crm.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../customer-crm.service')>()),
  upsertCustomerPreference: crmMock.upsertCustomerPreference,
  appendCustomerTimelineEvent: crmMock.appendCustomerTimelineEvent,
}));

import {
  enqueueCrmVoiceSuggestions,
  extractVoiceSuggestions,
  isCrmVoiceSuggestionsEnabled,
  runCrmVoiceSuggestionsJob,
  saveVoiceSuggestion,
  validateVoiceSuggestions,
} from '../customer-voice-suggestions';

const transcript =
  "Bonjour je voudrais réserver samedi pour quatre. Je suis cœliaque donc sans gluten s'il vous plaît, et on aime bien être en terrasse.";

function completion(content: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isCrmVoiceSuggestionsEnabled', () => {
  it('tous les restaurants dès que la clé OpenRouter est présente', () => {
    expect(isCrmVoiceSuggestionsEnabled('r1', { OPENROUTER_API_KEY: 'k' })).toBe(true);
    expect(isCrmVoiceSuggestionsEnabled('r2', { OPENROUTER_API_KEY: 'k' })).toBe(true);
    expect(isCrmVoiceSuggestionsEnabled('r1', {})).toBe(false);
    expect(isCrmVoiceSuggestionsEnabled(null, { OPENROUTER_API_KEY: 'k' })).toBe(false);
  });
});

describe('validateVoiceSuggestions', () => {
  it('garde une suggestion prouvée par les mots de l’appelant, accents et ponctuation ignorés', () => {
    expect(
      validateVoiceSuggestions(
        {
          suggestions: [
            {
              key: 'dietary_restrictions',
              value: 'sans gluten',
              evidence: 'Je suis coeliaque, donc sans gluten',
            },
            {
              key: 'preferred_section',
              value: 'terrasse',
              evidence: 'on aime bien être en terrasse',
            },
          ],
        },
        transcript,
      ),
    ).toEqual([
      { key: 'dietary_restrictions', value: 'sans gluten' },
      { key: 'preferred_section', value: 'terrasse' },
    ]);
  });

  it('écarte une preuve inventée, une clé hors liste, un doublon et une valeur vide ou trop longue', () => {
    expect(
      validateVoiceSuggestions(
        {
          suggestions: [
            {
              key: 'accessibility_needs',
              value: 'fauteuil roulant',
              evidence: 'je suis en fauteuil',
            },
            { key: 'favorite_wine', value: 'Brouilly', evidence: 'quatre' },
            { key: 'group_pattern', value: '4', evidence: 'pour quatre' },
            { key: 'preferred_section', value: 'terrasse', evidence: 'en terrasse' },
            { key: 'preferred_section', value: 'salle', evidence: 'réserver' },
            { key: 'dietary_restrictions', value: '  ', evidence: 'sans gluten' },
            { key: 'occasion_type', value: 'x'.repeat(200), evidence: 'samedi' },
          ],
        },
        transcript,
      ),
    ).toEqual([{ key: 'preferred_section', value: 'terrasse' }]);
  });

  it('réponse mal formée → aucune suggestion', () => {
    expect(validateVoiceSuggestions({ nope: true }, transcript)).toEqual([]);
  });
});

describe('extractVoiceSuggestions', () => {
  const options = { apiKey: 'k', baseUrl: 'https://llm.test/v1/', model: 'm' };

  it('envoie la transcription avec un schéma strict et valide la réponse', async () => {
    const fetcher = completion({
      suggestions: [{ key: 'preferred_section', value: 'terrasse', evidence: 'en terrasse' }],
    });
    const result = await extractVoiceSuggestions(transcript, { ...options, fetcher });
    expect(result).toEqual({
      status: 'ok',
      suggestions: [{ key: 'preferred_section', value: 'terrasse' }],
    });
    const [url, init] = vi.mocked(fetcher).mock.calls[0];
    expect(url).toBe('https://llm.test/v1/chat/completions');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.model).toBe('m');
    expect(body.temperature).toBe(0);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages[1].content).toBe(transcript);
  });

  it('sans clé, HTTP en erreur ou JSON illisible → erreur bornée', async () => {
    expect(await extractVoiceSuggestions(transcript, { ...options, apiKey: ' ' })).toEqual({
      status: 'error',
      reason: 'missing_key',
    });
    const failing = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    expect(await extractVoiceSuggestions(transcript, { ...options, fetcher: failing })).toEqual({
      status: 'error',
      reason: 'http_error',
    });
    const garbage = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'pas du json' } }] }),
    }) as unknown as typeof fetch;
    expect(await extractVoiceSuggestions(transcript, { ...options, fetcher: garbage })).toEqual({
      status: 'error',
      reason: 'invalid_response',
    });
  });
});

describe('saveVoiceSuggestion', () => {
  const input = {
    restaurantId: 'r1',
    customerId: 'c1',
    callId: 'call-1',
    suggestion: { key: 'preferred_section' as const, value: 'terrasse' },
    now: new Date('2026-10-21T12:00:00.000Z'),
  };

  it('crée une suggestion non confirmée qui expire dans 90 jours, et la note dans la chronologie', async () => {
    dbMock.tx.customerPreference.findUnique.mockResolvedValue(null);
    expect(await saveVoiceSuggestion(input)).toBe('created');
    expect(crmMock.upsertCustomerPreference).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'preferred_section',
        value: 'terrasse',
        source: 'VOICE_SUGGESTION',
        confirmedAt: null,
        expiresAt: new Date('2027-01-19T12:00:00.000Z'),
      }),
      dbMock.tx,
    );
    expect(crmMock.appendCustomerTimelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        summaryCode: 'customer.preference_suggested',
        metadata: { preferenceKey: 'preferred_section', source: 'VOICE_SUGGESTION' },
      }),
    );
  });

  it("n'écrase jamais une saisie de l'équipe ni une suggestion confirmée", async () => {
    dbMock.tx.customerPreference.findUnique.mockResolvedValue({
      source: 'MANUAL',
      confirmedAt: null,
      value: 'salle',
      expiresAt: null,
    });
    expect(await saveVoiceSuggestion(input)).toBe('kept_team_value');
    dbMock.tx.customerPreference.findUnique.mockResolvedValue({
      source: 'VOICE_SUGGESTION',
      confirmedAt: new Date('2026-10-01T00:00:00Z'),
      value: 'salle',
      expiresAt: null,
    });
    expect(await saveVoiceSuggestion(input)).toBe('kept_team_value');
    expect(crmMock.upsertCustomerPreference).not.toHaveBeenCalled();
    expect(crmMock.appendCustomerTimelineEvent).not.toHaveBeenCalled();
  });

  it('remplace une suggestion non confirmée différente ou expirée, ignore la même', async () => {
    dbMock.tx.customerPreference.findUnique.mockResolvedValue({
      source: 'VOICE_SUGGESTION',
      confirmedAt: null,
      value: 'terrasse',
      expiresAt: new Date('2026-12-01T00:00:00Z'),
    });
    expect(await saveVoiceSuggestion(input)).toBe('unchanged');
    dbMock.tx.customerPreference.findUnique.mockResolvedValue({
      source: 'VOICE_SUGGESTION',
      confirmedAt: null,
      value: 'salle',
      expiresAt: new Date('2026-12-01T00:00:00Z'),
    });
    expect(await saveVoiceSuggestion(input)).toBe('replaced');
    dbMock.tx.customerPreference.findUnique.mockResolvedValue({
      source: 'MANUAL',
      confirmedAt: null,
      value: 'salle',
      expiresAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(await saveVoiceSuggestion(input)).toBe('replaced');
  });
});

describe('runCrmVoiceSuggestionsJob', () => {
  const env = {
    OPENROUTER_API_KEY: 'k',
    VOICE_STRUCTURED_FALLBACK_MODEL: 'm',
  };
  const call = { id: 'call-1', restaurantId: 'r1', callerPhone: '+33612345678', transcript };

  it('saute sans clé OpenRouter, une transcription courte, un appelant inconnu', async () => {
    dbMock.db.call.findUnique.mockResolvedValue(call);
    expect(await runCrmVoiceSuggestionsJob('leg', {})).toEqual({
      status: 'skipped',
      reason: 'disabled',
    });
    dbMock.db.call.findUnique.mockResolvedValue({ ...call, transcript: 'allô ?' });
    expect(await runCrmVoiceSuggestionsJob('leg', env)).toEqual({
      status: 'skipped',
      reason: 'short_transcript',
    });
    dbMock.db.call.findUnique.mockResolvedValue(call);
    dbMock.db.customerIdentity.findUnique.mockResolvedValue(null);
    dbMock.db.customer.findUnique.mockResolvedValue(null);
    expect(await runCrmVoiceSuggestionsJob('leg', env)).toEqual({
      status: 'skipped',
      reason: 'no_customer',
    });
  });

  it('écrit les suggestions du client reconnu et ne lève jamais', async () => {
    dbMock.db.call.findUnique.mockResolvedValue(call);
    dbMock.db.customerIdentity.findUnique.mockResolvedValue({
      customer: { id: 'c1', archivedAt: null, mergedIntoId: null },
    });
    dbMock.tx.customerPreference.findUnique.mockResolvedValue(null);
    const fetcher = completion({
      suggestions: [{ key: 'dietary_restrictions', value: 'sans gluten', evidence: 'sans gluten' }],
    });
    expect(await runCrmVoiceSuggestionsJob('leg', env, fetcher)).toEqual({
      status: 'done',
      outcomes: ['created'],
    });

    dbMock.db.call.findUnique.mockRejectedValue(new Error('db down'));
    expect(await runCrmVoiceSuggestionsJob('leg', env)).toEqual({
      status: 'failed',
      reason: 'exception',
    });
  });
});

describe('enqueueCrmVoiceSuggestions', () => {
  it('ne met en file qu’avec la clé OpenRouter, une seule tentative', async () => {
    const queue = { add: vi.fn().mockResolvedValue(undefined) };
    vi.stubEnv('OPENROUTER_API_KEY', '');
    await enqueueCrmVoiceSuggestions('leg', 'r1', queue, 'job-1');
    expect(queue.add).not.toHaveBeenCalled();
    vi.stubEnv('OPENROUTER_API_KEY', 'k');
    await enqueueCrmVoiceSuggestions('leg', 'r1', queue, 'job-1');
    expect(queue.add).toHaveBeenCalledWith(
      'crm-voice-suggestions',
      { callLegId: 'leg' },
      expect.objectContaining({ jobId: 'job-1', attempts: 1 }),
    );
    vi.unstubAllEnvs();
  });
});

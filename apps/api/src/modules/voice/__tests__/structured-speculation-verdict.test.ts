import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cancelSpeculation,
  classifySpeculationMiss,
  parseTurnCompleteVerdict,
  speculationWordGap,
  startSpeculation,
  structuredSpeculationMaxLaunches,
  takeSpeculation,
} from '../stream/structured-turn/speculation';
import type { CallSession } from '../stream/types';
import { logger } from '../../../shared/logger/pino';
import { estimateMessagesTokens, summarizeSpeculation } from '../../usage/voice-usage.service';

describe('parseTurnCompleteVerdict', () => {
  it('lit le premier champ dès qu’il est complet, même si le JSON est tronqué', () => {
    expect(parseTurnCompleteVerdict('{"turnComplete":true,"interp')).toBe(true);
    expect(parseTurnCompleteVerdict('{ "turnComplete" : false')).toBe(false);
  });

  it('reste indéterminé tant que la valeur n’est pas arrivée', () => {
    expect(parseTurnCompleteVerdict('')).toBeNull();
    expect(parseTurnCompleteVerdict('{"turnComple')).toBeNull();
    expect(parseTurnCompleteVerdict('{"turnComplete":tr')).toBeNull();
  });
});

describe('startSpeculation', () => {
  function fakeManager(fragments: string[]) {
    return {
      streamStructuredCompletion: vi.fn(
        async (
          _session: CallSession,
          _messages: unknown,
          _format: unknown,
          options: { onDelta: (delta: string) => void },
        ) => {
          for (const fragment of fragments) options.onDelta(fragment);
          return fragments.join('');
        },
      ),
    };
  }

  it('annonce le verdict du modèle une seule fois, dès qu’il est lisible', async () => {
    const session = {} as CallSession;
    const onVerdict = vi.fn();
    const manager = fakeManager(['{"turnCom', 'plete":tr', 'ue,"interpretation":"answer"', '}']);
    startSpeculation(session, manager as never, [], {} as never, onVerdict);
    await Promise.resolve();
    await Promise.resolve();
    expect(onVerdict).toHaveBeenCalledTimes(1);
    expect(onVerdict).toHaveBeenCalledWith(true);
    cancelSpeculation(session);
  });

  it('transmet un tour inachevé sans le confondre avec un tour fini', async () => {
    const session = {} as CallSession;
    const onVerdict = vi.fn();
    startSpeculation(
      session,
      fakeManager(['{"turnComplete":false,"say":""}']) as never,
      [],
      {} as never,
      onVerdict,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(onVerdict).toHaveBeenCalledWith(false);
    cancelSpeculation(session);
  });
});

describe('issue de la spéculation', () => {
  const request = (system: string, history: [string, string][], transcript: string) => [
    { role: 'system' as const, content: system },
    ...history.map(([role, content]) => ({ role: role as 'user' | 'assistant', content })),
    { role: 'user' as const, content: transcript },
  ];
  const past: [string, string][] = [['assistant', 'Vous serez combien ?']];

  it('classe la cause du raté sans jamais exposer le texte', () => {
    const base = request('état A', past, '6 s’il vous plaît');
    expect(classifySpeculationMiss(base, request('état B', past, '6 s’il vous plaît'))).toBe(
      'miss_state',
    );
    expect(classifySpeculationMiss(base, request('état A', [['assistant', 'Autre']], '6'))).toBe(
      'miss_history',
    );
    expect(classifySpeculationMiss(base, request('état A', past, '6, s’il vous plaît.'))).toBe(
      'miss_transcript_format',
    );
    expect(
      classifySpeculationMiss(base, request('état A', past, '6 s’il vous plaît pour demain')),
    ).toBe('miss_transcript_extended');
    expect(classifySpeculationMiss(base, request('état A', past, '6'))).toBe(
      'miss_transcript_shorter',
    );
    expect(classifySpeculationMiss(base, request('état A', past, 'huit'))).toBe(
      'miss_transcript_changed',
    );
  });

  it('reprend une spéculation identique et abandonne une requête différente', async () => {
    const session = { callControlId: 'c-spec' } as CallSession;
    const manager = {
      streamStructuredCompletion: vi.fn(async () => '{"turnComplete":true}'),
    };
    const messages = request('état A', past, 'six');
    const format = { type: 'json_schema' } as never;
    startSpeculation(session, manager as never, messages, format);
    const taken = takeSpeculation(
      session,
      messages,
      format,
      () => undefined,
      new AbortController().signal,
    );
    expect(taken).not.toBeNull();
    await taken;

    startSpeculation(session, manager as never, messages, format);
    expect(
      takeSpeculation(
        session,
        request('état A', past, 'sept'),
        format,
        () => undefined,
        new AbortController().signal,
      ),
    ).toBeNull();
    // Rien de lancé : aucune spéculation à reprendre.
    expect(
      takeSpeculation(session, messages, format, () => undefined, new AbortController().signal),
    ).toBeNull();
  });
});

describe('plafond de requêtes spéculatives par tour', () => {
  afterEach(() => vi.unstubAllEnvs());
  const manager = () => ({
    streamStructuredCompletion: vi.fn(async () => '{"turnComplete":true}'),
  });
  const format = {} as never;
  const messages = (text: string) => [{ role: 'user' as const, content: text }];

  it('lit le plafond, 3 par défaut, en ignorant les valeurs absurdes', () => {
    expect(structuredSpeculationMaxLaunches({})).toBe(3);
    expect(
      structuredSpeculationMaxLaunches({ VOICE_STRUCTURED_SPECULATION_MAX_LAUNCHES: '2' }),
    ).toBe(2);
    expect(
      structuredSpeculationMaxLaunches({ VOICE_STRUCTURED_SPECULATION_MAX_LAUNCHES: '0' }),
    ).toBe(3);
    expect(
      structuredSpeculationMaxLaunches({ VOICE_STRUCTURED_SPECULATION_MAX_LAUNCHES: '50' }),
    ).toBe(3);
  });

  it('ne lance pas plus de requêtes que le plafond, et garde la dernière lancée', () => {
    vi.stubEnv('VOICE_STRUCTURED_SPECULATION_MAX_LAUNCHES', '2');
    const session = {} as CallSession;
    const mgr = manager();
    startSpeculation(session, mgr as never, messages('je voudrais'), format);
    startSpeculation(session, mgr as never, messages('je voudrais réserver'), format);
    startSpeculation(session, mgr as never, messages('je voudrais réserver demain'), format);
    expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(2);
    cancelSpeculation(session);
  });

  it('une même requête ne compte pas deux fois, et le compteur repart au tour suivant', () => {
    vi.stubEnv('VOICE_STRUCTURED_SPECULATION_MAX_LAUNCHES', '1');
    const session = {} as CallSession;
    const mgr = manager();
    startSpeculation(session, mgr as never, messages('oui'), format);
    startSpeculation(session, mgr as never, messages('oui'), format);
    expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(1);
    // Le tour consomme la spéculation : le suivant repart de zéro.
    const taken = takeSpeculation(
      session,
      messages('oui'),
      format,
      () => undefined,
      new AbortController().signal,
    );
    expect(taken).not.toBeNull();
    startSpeculation(session, mgr as never, messages('non'), format);
    expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(2);
    cancelSpeculation(session);
  });
});

describe('comptage de l’anticipation par tour et par appel', () => {
  afterEach(() => vi.restoreAllMocks());
  const manager = () => ({
    streamStructuredCompletion: vi.fn(async () => '{"turnComplete":true}'),
  });
  const format = {} as never;
  const request = (text: string) => [
    { role: 'system' as const, content: 'état A' },
    { role: 'user' as const, content: text },
  ];
  const take = (session: CallSession, text: string) =>
    takeSpeculation(session, request(text), format, () => undefined, new AbortController().signal);
  const outcomeLogs = (spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] =>
    spy.mock.calls
      .filter((call) => call[1] === '[structured-turn] Speculation outcome')
      .map((call) => call[0] as Record<string, unknown>);

  it('compte une anticipation reprise sans gaspillage', async () => {
    const info = vi.spyOn(logger, 'info');
    const session = { callControlId: 'c-hit' } as CallSession;
    startSpeculation(session, manager() as never, request('six'), format);
    await take(session, 'six');
    expect(session.voiceUsage?.speculation).toMatchObject({
      launches: 1,
      hits: 1,
      replaced: 0,
      discardedInputTokens: 0,
    });
    expect(outcomeLogs(info)).toEqual([
      expect.objectContaining({
        outcome: 'hit',
        launches: 1,
        replaced: 0,
        discardedInputTokens: 0,
        inputTokens: estimateMessagesTokens(request('six')),
      }),
    ]);
  });

  it('compte les lancements remplacés et la cause de l’anticipation jetée, sans texte', () => {
    const info = vi.spyOn(logger, 'info');
    const session = { callControlId: 'c-miss' } as CallSession;
    const mgr = manager();
    startSpeculation(session, mgr as never, request('je voudrais'), format);
    startSpeculation(session, mgr as never, request('je voudrais réserver'), format);
    expect(take(session, 'je voudrais annuler')).toBeNull();
    const first = estimateMessagesTokens(request('je voudrais'));
    const second = estimateMessagesTokens(request('je voudrais réserver'));
    expect(session.voiceUsage?.speculation).toMatchObject({
      launches: 2,
      replaced: 1,
      hits: 0,
      misses: { miss_transcript_changed: 1 },
      discardedInputTokens: first + second,
      discardedInputTokensByCause: { replaced: first, miss_transcript_changed: second },
    });
    const [line] = outcomeLogs(info);
    expect(line).toMatchObject({
      outcome: 'miss_transcript_changed',
      launches: 2,
      replaced: 1,
      discardedInputTokens: first + second,
      inputTokens: second,
      wordGap: 1,
    });
    expect(JSON.stringify(line)).not.toMatch(/voudrais|réserver|annuler/);
  });

  it('repart de zéro au tour suivant et cumule sur l’appel', async () => {
    const info = vi.spyOn(logger, 'info');
    const session = { callControlId: 'c-two' } as CallSession;
    const mgr = manager();
    startSpeculation(session, mgr as never, request('oui'), format);
    expect(take(session, 'oui merci')).toBeNull();
    expect(take(session, 'non')).toBeNull();
    startSpeculation(session, mgr as never, request('demain'), format);
    await take(session, 'demain');
    const lines = outcomeLogs(info);
    expect(lines.map((line) => [line.outcome, line.launches])).toEqual([
      ['miss_transcript_extended', 1],
      ['none', 0],
      ['hit', 1],
    ]);
    expect(lines[0].wordGap).toBe(1);
    expect(session.voiceUsage?.speculation).toMatchObject({
      launches: 2,
      hits: 1,
      none: 1,
      misses: { miss_transcript_extended: 1 },
    });
  });

  it('compte l’état changé sans écart de mots, les plafonnées, les abandonnées et celles en cours', () => {
    vi.stubEnv('VOICE_STRUCTURED_SPECULATION_MAX_LAUNCHES', '1');
    const info = vi.spyOn(logger, 'info');
    const session = { callControlId: 'c-cap' } as CallSession;
    const mgr = manager();
    startSpeculation(session, mgr as never, request('six'), format);
    startSpeculation(session, mgr as never, request('six personnes'), format);
    expect(
      takeSpeculation(
        session,
        [{ role: 'system', content: 'état B' }, ...request('six').slice(1)],
        format,
        () => undefined,
        new AbortController().signal,
      ),
    ).toBeNull();
    const [line] = outcomeLogs(info);
    expect(line).toMatchObject({ outcome: 'miss_state', launches: 1, capped: 1 });
    expect(line).not.toHaveProperty('wordGap');

    startSpeculation(session, mgr as never, request('sept'), format);
    cancelSpeculation(session);
    startSpeculation(session, mgr as never, request('huit'), format);
    const summary = summarizeSpeculation(session.voiceUsage!);
    expect(summary).toMatchObject({
      launches: 3,
      capped: 1,
      cancelled: 1,
      misses: { miss_state: 1 },
      unresolved: 1,
    });
    expect(summary?.discardedInputTokensByCause.cancelled).toBe(
      estimateMessagesTokens(request('sept')),
    );
    cancelSpeculation(session);
    vi.unstubAllEnvs();
  });

  it('mesure l’écart en mots entre la phrase anticipée et la finale', () => {
    expect(speculationWordGap(request('six'), request('Six.'))).toBe(0);
    expect(speculationWordGap(request('six'), request('six personnes demain'))).toBe(2);
    expect(speculationWordGap(request('pour six demain'), request('pour sept demain'))).toBe(1);
    expect(speculationWordGap(request(''), request('bonjour'))).toBe(1);
  });
});

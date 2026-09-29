import { describe, expect, it, vi } from 'vitest';
import {
  cancelSpeculation,
  classifySpeculationMiss,
  parseTurnCompleteVerdict,
  startSpeculation,
  takeSpeculation,
} from '../stream/structured-turn/speculation';
import type { CallSession } from '../stream/types';

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

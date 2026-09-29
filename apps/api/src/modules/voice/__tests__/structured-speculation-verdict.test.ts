import { describe, expect, it, vi } from 'vitest';
import {
  cancelSpeculation,
  parseTurnCompleteVerdict,
  startSpeculation,
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

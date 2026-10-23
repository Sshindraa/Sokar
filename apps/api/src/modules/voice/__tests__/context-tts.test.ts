import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContextTtsTurn } from '../stream/context-tts';
import type { CallSession } from '../stream/types';

const createElevenLabsContextTurn = vi.hoisted(() => vi.fn());
vi.mock('../stream/elevenlabs-context', () => ({ createElevenLabsContextTurn }));

const elevenLabsTurn = { kind: 'elevenlabs' };

function sessionFor(restaurantId: string): CallSession {
  return { restaurantId } as CallSession;
}

beforeEach(() => {
  createElevenLabsContextTurn.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('context-tts : fournisseur du tour en contexte', () => {
  it('reste sur le chemin HTTP sans clé ElevenLabs', () => {
    vi.stubEnv('ELEVENLABS_API_KEY', '');
    vi.stubEnv('CARTESIA_API_KEY', '');

    expect(createContextTtsTurn(sessionFor('resto-a'))).toBeNull();
    expect(createElevenLabsContextTurn).not.toHaveBeenCalled();
  });

  it('ouvre le tour ElevenLabs pour tout restaurant dès que la clé est présente', () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'test-only-elevenlabs-key');
    createElevenLabsContextTurn.mockReturnValue(elevenLabsTurn);

    expect(createContextTtsTurn(sessionFor('resto-a'))).toBe(elevenLabsTurn);
    expect(createContextTtsTurn(sessionFor('resto-b'))).toBe(elevenLabsTurn);
    expect(createElevenLabsContextTurn).toHaveBeenCalledTimes(2);
  });
});

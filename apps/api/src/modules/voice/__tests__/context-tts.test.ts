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
  vi.stubEnv('VOICE_TTS_CONTEXT_V2_ENABLED', 'false');
  createElevenLabsContextTurn.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('context-tts : fournisseur du tour en contexte', () => {
  it('reste sur le chemin HTTP sans liste de restaurants, même avec le drapeau global', () => {
    vi.stubEnv('VOICE_TTS_ELEVENLABS_DIALOGUE_ENABLED', 'true');
    vi.stubEnv('VOICE_TTS_ELEVENLABS_DIALOGUE_RESTAURANT_IDS', '');

    expect(createContextTtsTurn(sessionFor('resto-a'))).toBeNull();
    expect(createElevenLabsContextTurn).not.toHaveBeenCalled();
  });

  it('n’ouvre pas le WebSocket ElevenLabs pour un restaurant non listé', () => {
    vi.stubEnv('VOICE_TTS_ELEVENLABS_DIALOGUE_ENABLED', 'true');
    vi.stubEnv('VOICE_TTS_ELEVENLABS_DIALOGUE_RESTAURANT_IDS', 'resto-a');

    expect(createContextTtsTurn(sessionFor('resto-b'))).toBeNull();
    expect(createElevenLabsContextTurn).not.toHaveBeenCalled();
  });

  it('ouvre le tour ElevenLabs pour un restaurant listé', () => {
    vi.stubEnv('VOICE_TTS_ELEVENLABS_DIALOGUE_ENABLED', 'true');
    vi.stubEnv('VOICE_TTS_ELEVENLABS_DIALOGUE_RESTAURANT_IDS', 'resto-a');
    createElevenLabsContextTurn.mockReturnValue(elevenLabsTurn);

    expect(createContextTtsTurn(sessionFor('resto-a'))).toBe(elevenLabsTurn);
    expect(createElevenLabsContextTurn).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import {
  isVoiceDebugDialogueEnabled,
  recordDebugAgentSpeech,
  recordDebugCallerText,
  recordDebugSpeechAct,
  recordDebugTool,
} from '../stream/debug-dialogue';
import type { CallSession } from '../stream/types';

function session(restaurantId: string): CallSession {
  return {
    restaurantId,
    currentTurn: { id: 'turn-1', sequence: 1, startedAt: 0 },
  } as unknown as CallSession;
}

describe('debug-dialogue', () => {
  afterEach(() => {
    delete process.env.VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS;
  });

  it('est désactivé sans liste de restaurants de test', () => {
    const s = session('rest-1');
    recordDebugCallerText(s, 'Bonjour');
    recordDebugAgentSpeech(s, 'Je vous écoute.');
    expect(isVoiceDebugDialogueEnabled('rest-1')).toBe(false);
    expect(s.currentTurn?.debugDialogue).toBeUndefined();
  });

  it("n'enregistre rien pour un restaurant hors de la liste", () => {
    process.env.VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS = 'rest-test';
    const s = session('rest-client');
    recordDebugCallerText(s, 'Bonjour');
    expect(s.currentTurn?.debugDialogue).toBeUndefined();
  });

  it('capte le tour complet et masque téléphones et e-mails', () => {
    process.env.VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS = ' rest-x , rest-test ';
    const s = session('rest-test');
    recordDebugCallerText(s, 'Mon numéro est le 06 12 34 56 78');
    recordDebugCallerText(s, 'et mon mail a.b@example.com');
    recordDebugSpeechAct(s, 'content');
    recordDebugAgentSpeech(s, "D'accord…", 'filler');
    recordDebugAgentSpeech(s, 'C’est noté.');
    recordDebugTool(s, 'takeMessage');

    expect(s.currentTurn?.debugDialogue).toEqual({
      callerText: 'Mon numéro est le [PHONE] et mon mail [EMAIL]',
      speechAct: 'content',
      agentSpeech: ['C’est noté.'],
      fillers: ["D'accord…"],
      tools: ['takeMessage'],
    });
  });
});

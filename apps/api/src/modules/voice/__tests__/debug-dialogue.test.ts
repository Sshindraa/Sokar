import { afterEach, describe, expect, it } from 'vitest';
import {
  formatDebugSpeech,
  isVoiceDebugDialogueEnabled,
  recordDebugAgentSpeech,
  recordDebugCallerText,
  recordDebugSpeechAct,
  recordDebugTool,
  settleDebugSpeech,
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
      agentSpeech: [{ text: 'C’est noté.', status: 'pending' }],
      fillers: [{ text: "D'accord…", status: 'pending' }],
      tools: ['takeMessage'],
    });
  });

  it('ne garde que ce que l’appelant a réellement entendu', () => {
    process.env.VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS = 'rest-test';
    const s = session('rest-test');
    const played = recordDebugAgentSpeech(s, 'Vous serez combien ?');
    const cut = recordDebugAgentSpeech(s, 'Je vous récapitule la réservation.');
    const silent = recordDebugAgentSpeech(s, 'Phrase jamais lue.');
    const pending = recordDebugAgentSpeech(s, 'Encore en lecture.');
    settleDebugSpeech(played, 12, true);
    settleDebugSpeech(cut, 3, false);
    settleDebugSpeech(silent, 0, false);
    // Un statut fixé ne change plus.
    settleDebugSpeech(played, 0, false);

    expect([played?.status, cut?.status, silent?.status, pending?.status]).toEqual([
      'played',
      'interrupted',
      'not_played',
      'pending',
    ]);
    expect(formatDebugSpeech(s.currentTurn!.debugDialogue!.agentSpeech)).toBe(
      'Vous serez combien ? Je vous récapitule la réservation. [interrompu] Encore en lecture. [en cours]',
    );
    expect(formatDebugSpeech([{ text: 'Muet.', status: 'not_played' }])).toBeNull();
  });
});

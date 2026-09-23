import { afterEach, describe, expect, it } from 'vitest';
import {
  appendDebugSpeechText,
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

  it('ne garde que les répliques dont l’audio est parti', () => {
    process.env.VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS = 'rest-test';
    const s = session('rest-test');
    const sent = recordDebugAgentSpeech(s, 'Vous serez combien ?');
    const cut = recordDebugAgentSpeech(s, 'Je vous récapitule la réservation.');
    const silent = recordDebugAgentSpeech(s, 'Phrase jamais envoyée.');
    const pending = recordDebugAgentSpeech(s, 'Encore en lecture.');
    settleDebugSpeech(sent, 12, true);
    settleDebugSpeech(cut, 3, false);
    settleDebugSpeech(silent, 0, false);
    // Un statut fixé ne change plus.
    settleDebugSpeech(sent, 0, false);

    expect([sent?.status, cut?.status, silent?.status, pending?.status]).toEqual([
      'sent',
      'partially_sent',
      'not_sent',
      'pending',
    ]);
    expect(formatDebugSpeech(s.currentTurn!.debugDialogue!.agentSpeech)).toBe(
      'Vous serez combien ? Je vous récapitule la réservation. [envoi coupé] Encore en lecture. [en cours]',
    );
    expect(formatDebugSpeech([{ text: 'Muet.', status: 'not_sent' }])).toBeNull();
  });

  it('regroupe en une réplique les phrases lues d’un seul flux', () => {
    process.env.VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS = 'rest-test';
    const s = session('rest-test');
    const entry = recordDebugAgentSpeech(s, "C'est bon pour 20 h.")!;
    appendDebugSpeechText(entry, 'C’est à quel nom ?');
    settleDebugSpeech(entry, 4, false);
    expect(formatDebugSpeech(s.currentTurn!.debugDialogue!.agentSpeech)).toBe(
      "C'est bon pour 20 h. C’est à quel nom ? [envoi coupé]",
    );
  });
});

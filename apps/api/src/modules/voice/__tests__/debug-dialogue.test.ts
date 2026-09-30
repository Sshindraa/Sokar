import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../shared/logger/pino';
import {
  appendDebugSpeechText,
  formatDebugSpeech,
  isVoiceDebugDialogueEnabled,
  logVoiceDebugText,
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

describe('logVoiceDebugText', () => {
  afterEach(() => {
    delete process.env.VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS;
    vi.restoreAllMocks();
  });
  const target = (restaurantId: string) =>
    ({ restaurantId, callControlId: 'cc-1' }) as Pick<
      CallSession,
      'restaurantId' | 'callControlId'
    >;

  it('écrit le texte brut pour un restaurant de test, téléphones et e-mails masqués', () => {
    process.env.VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS = 'resto-test';
    const info = vi.spyOn(logger, 'info');
    logVoiceDebugText(target('resto-test'), 'echo_prefix_stripped', {
      before: 'bonjour vous appelle pour le 06 12 34 56 78 ou a@b.fr',
      after: 'appelle pour',
      stage: 'committed',
    });
    expect(info).toHaveBeenCalledTimes(1);
    const fields = info.mock.calls[0][0] as Record<string, unknown>;
    expect(fields).toMatchObject({
      callId: 'cc-1',
      voiceDebug: 'echo_prefix_stripped',
      after: 'appelle pour',
      stage: 'committed',
    });
    expect(String(fields.before)).toContain('bonjour vous appelle pour');
    expect(String(fields.before)).toContain('[PHONE]');
    expect(String(fields.before)).toContain('[EMAIL]');
    expect(String(fields.before)).not.toContain('06 12');
  });

  it('n’écrit rien pour un restaurant client, ni quand la liste est vide', () => {
    const info = vi.spyOn(logger, 'info');
    logVoiceDebugText(target('resto-client'), 'final_segment', { text: 'bonjour' });
    process.env.VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS = 'resto-test';
    logVoiceDebugText(target('resto-client'), 'final_segment', { text: 'bonjour' });
    expect(info).not.toHaveBeenCalled();
  });
});

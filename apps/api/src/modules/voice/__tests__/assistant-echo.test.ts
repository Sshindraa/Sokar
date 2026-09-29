import { describe, expect, it } from 'vitest';
import { filterAssistantEcho, hasBargeInWordThreshold } from '../stream/assistant-echo';
import { rememberRecentAgentSpeech } from '../stream/debug-dialogue';
import { noteAgentAudioEnded, noteAgentAudioStarted } from '../stream/turn-telemetry';
import type { CallSession } from '../stream/types';

function makeSession(): CallSession {
  return {
    recentAgentSpeechText: 'Avec plaisir. Pour combien de personnes souhaitez-vous réserver ?',
    agentAudioActive: true,
  } as CallSession;
}

describe('assistant echo suppression', () => {
  it('suppresses a transcript contained in currently playing agent speech', () => {
    const result = filterAssistantEcho(
      makeSession(),
      'Avec plaisir, pour combien de personnes',
      'partial',
    );

    expect(result).toMatchObject({ suppressed: true, transcript: '' });
  });

  it('strips the echoed prefix and retains caller words', () => {
    const result = filterAssistantEcho(
      makeSession(),
      'Avec plaisir pour combien de personnes allô bonjour',
      'committed',
    );

    expect(result).toMatchObject({
      suppressed: false,
      strippedPrefix: true,
      transcript: 'allô bonjour',
      nonEchoWordCount: 2,
    });
    expect(hasBargeInWordThreshold(result)).toBe(true);
  });

  it('does not suppress after the one-second echo window', () => {
    const session = makeSession();
    session.agentAudioActive = false;
    session.agentAudioEndedAt = 1_000;

    expect(
      filterAssistantEcho(session, 'Pour combien de personnes', 'committed', 2_001),
    ).toMatchObject({
      suppressed: false,
      transcript: 'Pour combien de personnes',
    });
  });
});

describe("écho aligné sur le moment où l'appelant a été entendu (appel 1b3f85e9)", () => {
  const T0 = 1_000_000;
  const speech = (text: string, at = T0) => {
    const session = {} as CallSession;
    rememberRecentAgentSpeech(session, text, at);
    return session;
  };

  it("reconnaît l'écho de l'accueil, transcrit bien après la fin du son", () => {
    const session = speech('Bonjour, ici Chez Sokar. Je vous écoute.');
    noteAgentAudioStarted(session, T0);
    noteAgentAudioEnded(session, T0 + 2_400);
    // Le son revenu a commencé pendant l'accueil ; sa transcription n'arrive que 2,3 s après la fin.
    session.sttLastSpeechStartedAt = T0 + 2_000;
    const echo = filterAssistantEcho(session, 'bonjour ici chez sokar', 'committed', T0 + 4_700);
    expect(echo).toMatchObject({ suppressed: true, transcript: '' });
  });

  it("garde le mot de l'appelant qui répète la question de l'agent après qu'il a fini de parler", () => {
    const session = speech("C'est bien ça ?");
    noteAgentAudioStarted(session, T0);
    noteAgentAudioEnded(session, T0 + 1_200);
    // L'appelant répond « c'est bien ça » 1,6 s après la fin, transcrit 1,4 s plus tard : hors fenêtre.
    session.sttLastSpeechStartedAt = T0 + 2_800;
    const result = filterAssistantEcho(session, "c'est bien ça", 'committed', T0 + 4_200);
    expect(result).toMatchObject({ suppressed: false, transcript: "c'est bien ça" });
  });

  it("l'écho reste reconnu jusqu'à 0,9 s après la fin du son, pas au-delà", () => {
    const session = speech('Oui, demain on est ouvert de midi à 22 heures.');
    noteAgentAudioStarted(session, T0);
    noteAgentAudioEnded(session, T0 + 3_000);
    session.sttLastSpeechStartedAt = T0 + 3_800;
    expect(filterAssistantEcho(session, 'est ouvert', 'committed', T0 + 6_000).suppressed).toBe(
      true,
    );
    session.sttLastSpeechStartedAt = T0 + 4_000;
    expect(filterAssistantEcho(session, 'est ouvert', 'committed', T0 + 6_000).suppressed).toBe(
      false,
    );
  });

  it('mémorise toutes les phrases récentes, pas seulement celles du tour courant, et oublie les anciennes', () => {
    const session = {} as CallSession;
    rememberRecentAgentSpeech(session, 'Oui, on est ouvert.', T0);
    rememberRecentAgentSpeech(session, 'Vous voulez venir vers quelle heure ?', T0 + 2_000);
    expect(session.recentAgentSpeechText).toBe(
      'Oui, on est ouvert. Vous voulez venir vers quelle heure ?',
    );
    rememberRecentAgentSpeech(session, 'Très bien.', T0 + 25_000);
    expect(session.recentAgentSpeechText).toBe('Très bien.');
  });

  it("ne garde que les derniers intervalles d'audio et ne rouvre pas un intervalle déjà ouvert", () => {
    const session = {} as CallSession;
    noteAgentAudioStarted(session, T0);
    noteAgentAudioStarted(session, T0 + 500);
    expect(session.agentAudioSpans).toEqual([{ startedAt: T0 }]);
    noteAgentAudioEnded(session, T0 + 900);
    expect(session.agentAudioSpans).toEqual([{ startedAt: T0, endedAt: T0 + 900 }]);
    for (let i = 1; i <= 12; i++) {
      noteAgentAudioStarted(session, T0 + i * 10_000);
      noteAgentAudioEnded(session, T0 + i * 10_000 + 500);
    }
    expect(session.agentAudioSpans).toHaveLength(8);
  });
});

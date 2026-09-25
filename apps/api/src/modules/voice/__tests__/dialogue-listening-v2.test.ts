import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { acknowledgeCallEnding, finishCall } from '../stream/call-ending';
import { processTranscriptStreaming } from '../stream/llm-handler';
import {
  createConversationState,
  classifyVoiceSpeechActInContext,
  findVoiceSlotContradictions,
  isDirectVoiceAnswerToPendingQuestion,
  isVoiceQuestionTranscript,
  recordAssistantReplyFromLlmTextFallback as recordAssistantReplyWithFallback,
} from '../stream/conversation-controller';
import type { CallSession } from '../stream/types';
import type { CallSessionManager } from '../stream/manager';
import { speakTtsStreamed } from '../stream/tts-handler';
import { telnyxFetch } from '../../../shared/telnyx/http-agent';

vi.mock('../stream/tts-handler', () => ({
  speakTtsStreamed: vi.fn().mockResolvedValue(undefined),
  isSessionActiveForTts: vi.fn().mockReturnValue(true),
  cleanTextForTts: (text: string) => text,
}));
vi.mock('../../../shared/telnyx/http-agent', () => ({
  telnyxFetch: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../../../shared/logger/pino', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function fixture() {
  const sessionRef: { current?: CallSession } = {};
  const telnyxWs = {
    readyState: WebSocket.OPEN,
    send: vi.fn((raw: string) => {
      const message = JSON.parse(raw) as { event?: string; mark?: { name?: string } };
      if (message.event === 'mark' && message.mark?.name && sessionRef.current) {
        acknowledgeCallEnding(sessionRef.current, message.mark.name);
      }
    }),
  };
  const session = {
    callControlId: 'cc-dialogue-v2',
    restaurantId: 'restaurant-test',
    systemPrompt: "Vous êtes l'assistant vocal de Test Resto.",
    timezone: 'Europe/Paris',
    state: 'LISTENING',
    ended: false,
    responseGeneration: 0,
    ttsGeneration: 0,
    history: [],
    turnCount: 1,
    conversation: createConversationState(),
    telnyxWs,
    openingHours: {
      mon: null,
      tue: null,
      wed: null,
      thu: null,
      fri: { open: '19:00', close: '23:00' },
      sat: { open: '19:00', close: '23:00' },
      sun: null,
    },
  } as unknown as CallSession;
  sessionRef.current = session;
  const mgr = {
    transition: vi.fn((target: CallSession, state: CallSession['state']) => {
      target.state = state;
      return true;
    }),
    cleanup: vi.fn((target: CallSession) => {
      target.ended = true;
      target.state = 'IDLE';
    }),
    processUtteranceStreaming: vi.fn(),
    getAvailability: vi.fn(),
    createReservationFromConversation: vi.fn().mockResolvedValue(null),
    handoffToManager: vi.fn(),
    recordDialogueFallbackMessage: vi.fn(),
  } as unknown as CallSessionManager;
  return { session, mgr };
}

function mockModelReply(
  session: CallSession,
  mgr: CallSessionManager,
  replyFor: (transcript: string) => string,
) {
  const requests: Array<{ transcript: string; options: unknown }> = [];
  vi.mocked(mgr.processUtteranceStreaming).mockImplementation(
    async (target, transcript, onPhrase, options) => {
      requests.push({ transcript, options });
      target.history.push({ role: 'user', content: transcript });
      const reply = replyFor(transcript);
      await onPhrase(reply);
      target.history.push({ role: 'assistant', content: reply });
      return reply;
    },
  );
  return requests;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv('VOICE_DIALOGUE_LISTENING_V2', 'false');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('VOICE_DIALOGUE_LISTENING_V2', () => {
  it('laisse le chemin historique inchangé quand le flag est coupé', async () => {
    const { session, mgr } = fixture();
    session.conversation.intent = 'reservation';
    session.conversation.slots.date = '2026-09-26';
    recordAssistantReplyWithFallback(session, 'Vous serez combien ?');

    await processTranscriptStreaming(session, 'Quatre personnes', mgr);

    expect(mgr.processUtteranceStreaming).not.toHaveBeenCalled();
    expect(speakTtsStreamed).toHaveBeenLastCalledWith(
      session,
      'Vous voulez venir vers quelle heure ?',
    );
    expect(session.conversation.pendingQuestion).toBe('time');
  });

  it('rejoue les six tours sans laisser une question ou une correction avancer les slots', async () => {
    vi.stubEnv('VOICE_DIALOGUE_LISTENING_V2', 'true');
    const { session, mgr } = fixture();
    const requests = mockModelReply(session, mgr, (transcript) => {
      if (transcript.startsWith('Euh, bonjour')) {
        session.conversation.intent = 'reservation';
        return 'Avec plaisir ! Vous serez combien ?';
      }
      if (transcript.startsWith('On serait')) {
        return 'Très bien, quatre personnes. Pour quel jour souhaitez-vous réserver ?';
      }
      if (transcript.startsWith('Euh, mmmh')) {
        return 'Oui, nous sommes ouverts demain, samedi, de 19 h à 23 h. Souhaitez-vous réserver pour demain soir ?';
      }
      if (transcript.startsWith('Non, mais')) {
        return "Vous avez raison, c'était une question. Nous sommes ouverts demain, samedi, de 19 h à 23 h. Quel jour souhaitez-vous réserver ?";
      }
      throw new Error('Unexpected test transcript');
    });

    await processTranscriptStreaming(
      session,
      'Euh, bonjour, je me permets de vous appeler pour faire une réservation',
      mgr,
    );
    expect(mgr.processUtteranceStreaming).toHaveBeenCalledTimes(1);
    expect(session.conversation.pendingQuestion).toBe('partySize');

    await processTranscriptStreaming(session, "Mmh, est-ce que c'est en-", mgr);
    expect(speakTtsStreamed).toHaveBeenLastCalledWith(session, 'Oui, je vous écoute.');
    expect(session.conversation.pendingQuestion).toBe('partySize');
    expect(mgr.processUtteranceStreaming).toHaveBeenCalledTimes(1);
    expect(
      isDirectVoiceAnswerToPendingQuestion(
        session,
        'On serait, euh… Attendez, attendez, on serait quatre personnes.',
      ),
    ).toBe(true);
    expect(
      classifyVoiceSpeechActInContext(
        session,
        'On serait, euh… Attendez, attendez, on serait quatre personnes.',
      ),
    ).toBe('content');
    expect(
      isVoiceQuestionTranscript('On serait, euh… Attendez, attendez, on serait quatre personnes.'),
    ).toBe(false);
    expect(
      findVoiceSlotContradictions(
        session,
        'On serait, euh… Attendez, attendez, on serait quatre personnes.',
      ),
    ).toEqual([]);
    expect(session.conversation.lastDialogueGuard?.level).not.toBe('reformulate');
    expect(session.conversation.lastDialogueGuard?.level).not.toBe('escalate');
    expect(session.currentTurn?.loopDetected).not.toBe(true);

    await processTranscriptStreaming(
      session,
      'On serait, euh… Attendez, attendez, on serait quatre personnes.',
      mgr,
    );
    expect(mgr.processUtteranceStreaming).toHaveBeenCalledTimes(1);
    expect(session.conversation.slots.partySize).toBe(4);
    expect(session.conversation.pendingQuestion).toBe('date');
    expect(vi.mocked(speakTtsStreamed).mock.calls.at(-1)?.[1]).toMatch(/quel jour/u);

    await processTranscriptStreaming(session, 'Euh, mmmh, vous êtes ouvert demain ?', mgr);
    expect(mgr.processUtteranceStreaming).toHaveBeenCalledTimes(2);
    expect(requests[1]?.options).toMatchObject({
      allowedTools: ['checkAvailability'],
      context: expect.stringContaining('samedi : 19:00–23:00'),
    });
    expect(session.conversation.slots.date).toBeUndefined();
    expect(speakTtsStreamed).toHaveBeenLastCalledWith(
      session,
      expect.stringMatching(/^Oui, nous sommes ouverts demain.*19 h à 23 h.*\?/),
    );

    await processTranscriptStreaming(
      session,
      'Non, mais c’était une question : est-ce que vous êtes ouvert demain ?',
      mgr,
    );
    expect(mgr.processUtteranceStreaming).toHaveBeenCalledTimes(3);
    expect(requests[2]?.options).toMatchObject({ includeTools: false });
    expect(session.conversation.slots.date).toBeUndefined();
    expect(speakTtsStreamed).toHaveBeenLastCalledWith(
      session,
      expect.stringMatching(/Vous avez raison.*19 h à 23 h.*Quel jour/u),
    );

    await processTranscriptStreaming(session, 'Ce soir, on arrête.', mgr);
    expect(mgr.processUtteranceStreaming).toHaveBeenCalledTimes(3);
    expect(telnyxFetch).toHaveBeenCalledOnce();
    expect(speakTtsStreamed).toHaveBeenLastCalledWith(
      session,
      expect.stringMatching(/nous nous arrêtons là.*rappeler/u),
    );
    expect(session.conversation.slots.date).toBeUndefined();
  });

  it('répond au sujet demandé sans détourner une collecte de l’heure', async () => {
    vi.stubEnv('VOICE_DIALOGUE_LISTENING_V2', 'true');
    const { session, mgr } = fixture();
    session.conversation.intent = 'reservation';
    session.conversation.slots = { date: '2026-09-26', partySize: 4 };
    recordAssistantReplyWithFallback(session, 'Vous souhaitez venir à quelle heure ?');
    const requests = mockModelReply(
      session,
      mgr,
      () => 'Le restaurant ferme à 23 h. À quelle heure souhaitez-vous venir ?',
    );

    await processTranscriptStreaming(session, 'Vous fermez à quelle heure ?', mgr);

    expect(mgr.processUtteranceStreaming).toHaveBeenCalledOnce();
    expect(requests[0]?.options).toMatchObject({ allowedTools: ['checkAvailability'] });
    expect(session.conversation.slots.time).toBeUndefined();
    expect(session.conversation.pendingQuestion).toBe('time');
  });

  it('confie une question sur les équipements au LLM sans inventer une valeur de réservation', async () => {
    vi.stubEnv('VOICE_DIALOGUE_LISTENING_V2', 'true');
    const { session, mgr } = fixture();
    const requests = mockModelReply(session, mgr, () => 'Je vais vérifier cette possibilité.');

    await processTranscriptStreaming(session, 'C’est possible en terrasse ?', mgr);

    expect(mgr.processUtteranceStreaming).toHaveBeenCalledOnce();
    expect(requests[0]?.options).toMatchObject({ allowedTools: ['checkAvailability'] });
    expect(session.conversation.slots).toEqual({});
  });

  it('demande une confirmation explicite avant de retenir une correction de couverts', async () => {
    vi.stubEnv('VOICE_DIALOGUE_LISTENING_V2', 'true');
    const { session, mgr } = fixture();
    session.conversation.intent = 'reservation';
    session.conversation.slots = { date: '2026-09-26', partySize: 4 };
    recordAssistantReplyWithFallback(session, 'Vous serez combien ?');
    const requests = mockModelReply(
      session,
      mgr,
      () => 'J’avais noté quatre personnes. Vous souhaitez finalement cinq personnes ?',
    );

    await processTranscriptStreaming(session, 'Non, pas quatre, cinq.', mgr);

    expect(mgr.processUtteranceStreaming).toHaveBeenCalledOnce();
    expect(requests[0]?.options).toMatchObject({ includeTools: false });
    expect(session.conversation.slots.partySize).toBe(4);
    expect(mgr.getAvailability).not.toHaveBeenCalled();
    expect(mgr.createReservationFromConversation).not.toHaveBeenCalled();
    expect(vi.mocked(speakTtsStreamed).mock.calls.at(-1)?.[1]).toMatch(
      /quatre personnes.*cinq personnes \?/u,
    );
  });

  it('reformule une boucle sur le champ manquant au lieu de répéter la question', async () => {
    vi.stubEnv('VOICE_DIALOGUE_LISTENING_V2', 'true');
    const { session, mgr } = fixture();
    session.conversation.intent = 'reservation';
    session.conversation.slots = { date: '2026-09-26', partySize: 4 };
    recordAssistantReplyWithFallback(session, 'À quelle heure souhaitez-vous venir ?');
    session.conversation.lastDialogueGuard = { key: 'time', level: 'reformulate', count: 2 };
    const requests = mockModelReply(session, mgr, () => 'À quelle heure souhaitez-vous venir ?');

    await processTranscriptStreaming(session, 'Euh, je ne sais pas encore.', mgr);

    expect(mgr.processUtteranceStreaming).toHaveBeenCalledOnce();
    expect(requests[0]?.options).toMatchObject({});
    const answer = vi.mocked(speakTtsStreamed).mock.calls.at(-1)?.[1] ?? '';
    expect(answer).toContain('quatre personnes');
    expect(answer).toContain('À quel horaire souhaitez-vous venir ?');
    expect(answer).not.toBe('À quelle heure souhaitez-vous venir ?');
  });

  it('conserve une réponse directe simple sur le chemin déterministe', async () => {
    vi.stubEnv('VOICE_DIALOGUE_LISTENING_V2', 'true');
    const { session, mgr } = fixture();
    session.conversation.intent = 'reservation';
    session.conversation.slots.date = '2026-09-26';
    recordAssistantReplyWithFallback(session, 'Vous serez combien ?');

    await processTranscriptStreaming(session, 'Quatre personnes', mgr);

    expect(mgr.processUtteranceStreaming).not.toHaveBeenCalled();
    expect(session.conversation.slots.partySize).toBe(4);
    expect(session.conversation.pendingQuestion).toBe('time');
  });
});

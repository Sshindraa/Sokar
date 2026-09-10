import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { acknowledgeCallEnding, finishCall, isExplicitCallEnd } from '../stream/call-ending';
import { handleSttEvent, processTranscriptStreaming } from '../stream/llm-handler';
import { createConversationState } from '../stream/conversation-controller';
import type { CallSession } from '../stream/types';
import type { CallSessionManager } from '../stream/manager';
import { speakTtsStreamed } from '../stream/tts-handler';
import { telnyxFetch } from '../../../shared/telnyx/http-agent';

vi.mock('../stream/tts-handler', () => ({
  speakTtsStreamed: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../shared/telnyx/http-agent', () => ({
  telnyxFetch: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../stream/fillers-cache', () => ({
  selectRandomGoodbyeText: () => 'Au revoir.',
  playFiller: vi.fn(),
}));
vi.mock('../../../shared/logger/pino', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function fixture() {
  const session = {
    callControlId: 'cc-ending',
    state: 'LISTENING',
    ended: false,
    responseGeneration: 0,
    ttsGeneration: 0,
    history: [],
    turnCount: 1,
    conversation: createConversationState(),
    telnyxWs: { readyState: WebSocket.OPEN, send: vi.fn() },
  } as unknown as CallSession;
  const mgr = {
    transition: vi.fn((s: CallSession, state: CallSession['state']) => {
      s.state = state;
      return true;
    }),
    cleanup: vi.fn((s: CallSession) => {
      s.ended = true;
      s.state = 'IDLE';
    }),
    processUtteranceStreaming: vi.fn(),
    getAvailability: vi.fn(),
    createReservationFromConversation: vi.fn().mockResolvedValue(null),
  } as unknown as CallSessionManager;
  return { session, mgr };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it.each([
  'Au revoir',
  'Merci, au revoir',
  'C’est tout, merci',
  'Je raccroche',
  'À demain',
  'Thanks, goodbye',
  'That’s all, thank you',
  'Have a great evening',
])('termine sur %s', (text) => {
  expect(isExplicitCallEnd(text)).toBe(true);
});
it.each([
  'Merci',
  'Non merci',
  'Oui, c’est correct',
  'Au revoir, mais attendez finalement cinq personnes',
  'Attendez, je voulais dire cinq personnes',
])('garde la conversation sur %s', (text) => {
  expect(isExplicitCallEnd(text)).toBe(false);
});

describe('farewell playback and hangup', () => {
  it('attend la fin réelle du TTS puis le bon mark, bloque les transcripts et ne raccroche qu’une fois', async () => {
    const { session, mgr } = fixture();
    let resolveTts!: () => void;
    vi.mocked(speakTtsStreamed).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveTts = resolve;
        }),
    );
    const done = finishCall(session, mgr, 'Au revoir.');
    expect(session.state).toBe('CLOSING');
    expect(telnyxFetch).not.toHaveBeenCalled();
    handleSttEvent({ type: 'UtteranceEnd', transcript: 'Nova' }, session, mgr);
    await processTranscriptStreaming(session, 'Nova', mgr);
    expect(mgr.processUtteranceStreaming).not.toHaveBeenCalled();
    resolveTts();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.telnyxWs.send).toHaveBeenLastCalledWith(
      JSON.stringify({ event: 'mark', mark: { name: session.ending!.markName } }),
    );
    acknowledgeCallEnding(session, 'old-mark-flushed-by-clear');
    expect(telnyxFetch).not.toHaveBeenCalled();
    acknowledgeCallEnding(session, session.ending!.markName);
    await done;
    await finishCall(session, mgr, 'Au revoir.');
    expect(telnyxFetch).toHaveBeenCalledOnce();
    expect(mgr.cleanup).toHaveBeenCalledOnce();
    expect(session.ended).toBe(true);
  });

  it('attend aussi le webhook natif quand le mark de la file vide est déjà reçu', async () => {
    const { session, mgr } = fixture();
    vi.mocked(speakTtsStreamed).mockImplementationOnce(async (s) => {
      s.ending!.nativePlayback = true;
    });
    const done = finishCall(session, mgr, 'Au revoir.');
    await vi.advanceTimersByTimeAsync(0);
    expect(session.telnyxWs.send).toHaveBeenCalledTimes(2);
    acknowledgeCallEnding(session, session.ending!.markName);
    expect(telnyxFetch).not.toHaveBeenCalled();
    acknowledgeCallEnding(session, session.ending!.markName, 'native');
    await done;
    expect(telnyxFetch).toHaveBeenCalledOnce();
  });

  it('ne reste pas silencieux indéfiniment si le mark est perdu', async () => {
    const { session, mgr } = fixture();
    const done = finishCall(session, mgr, 'Au revoir.');
    await vi.advanceTimersByTimeAsync(15_001);
    await done;
    expect(telnyxFetch).toHaveBeenCalledOnce();
  });

  it('réessaie le hangup avec le même command_id après une erreur réseau', async () => {
    const { session, mgr } = fixture();
    vi.mocked(telnyxFetch).mockRejectedValueOnce(new Error('network'));
    const done = finishCall(session, mgr, 'Au revoir.');
    await vi.advanceTimersByTimeAsync(0);
    acknowledgeCallEnding(session, session.ending!.markName);
    await done;
    expect(telnyxFetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(telnyxFetch).mock.calls[0][1]?.body).toBe(
      vi.mocked(telnyxFetch).mock.calls[1][1]?.body,
    );
  });

  it('ne raccroche pas sur merci pendant une collecte de réservation', async () => {
    const { session, mgr } = fixture();
    session.conversation.lastAssistantQuestion = 'Pour combien de personnes ?';
    await processTranscriptStreaming(session, 'Merci', mgr);
    expect(session.ending).toBeUndefined();
    expect(telnyxFetch).not.toHaveBeenCalled();
    expect(session.state).toBe('LISTENING');
  });

  it('ne délègue pas au LLM la collecte des slots de réservation', async () => {
    const { session, mgr } = fixture();
    session.conversation.intent = 'reservation';
    session.conversation.slots.date = '2026-09-05';

    await processTranscriptStreaming(session, 'Pour quatre personnes', mgr);

    expect(mgr.processUtteranceStreaming).not.toHaveBeenCalled();
    expect(speakTtsStreamed).toHaveBeenCalledWith(session, 'Vous voulez venir vers quelle heure ?');
    expect(session.conversation.pendingQuestion).toBe('time');
  });

  it('vérifie « à midi » avant de demander le nom', async () => {
    const { session, mgr } = fixture();
    session.conversation.intent = 'reservation';
    session.conversation.slots = {
      date: '2026-09-05',
      partySize: 4,
    };
    vi.mocked(mgr.getAvailability).mockResolvedValue({
      slots: ['12:00'],
    } as unknown as Awaited<ReturnType<CallSessionManager['getAvailability']>>);

    await processTranscriptStreaming(session, "Est-ce que c'est possible à midi ?", mgr);

    expect(mgr.getAvailability).toHaveBeenCalledWith(session, '2026-09-05', 4);
    expect(mgr.processUtteranceStreaming).not.toHaveBeenCalled();
    expect(speakTtsStreamed).toHaveBeenCalledWith(
      session,
      'Oui, nous avons de la place pour 4 personnes à 12 h. À quel nom je réserve ?',
    );
    expect(session.conversation.pendingQuestion).toBe('customerName');
  });

  it("enchaîne l'heure en toutes lettres puis une épellation bruitée", async () => {
    const { session, mgr } = fixture();
    session.conversation.intent = 'reservation';
    session.conversation.slots = {
      date: '2026-09-05',
      partySize: 4,
    };
    vi.mocked(mgr.getAvailability).mockResolvedValue({
      slots: ['20:00'],
    } as unknown as Awaited<ReturnType<CallSessionManager['getAvailability']>>);
    vi.mocked(mgr.createReservationFromConversation).mockResolvedValue(
      'Réservation confirmée pour ABKIF.',
    );

    await processTranscriptStreaming(
      session,
      'Alors ça serait bien vers vingt heures, est-ce que vous avez la disponibilité',
      mgr,
    );
    expect(mgr.getAvailability).toHaveBeenCalledWith(session, '2026-09-05', 4);
    expect(session.conversation.pendingQuestion).toBe('customerName');

    await processTranscriptStreaming(session, 'Un nom de bruit a deux k i f', mgr);
    await processTranscriptStreaming(session, 'Attif, a b k i f', mgr);
    expect(speakTtsStreamed).toHaveBeenLastCalledWith(session, "A-B-K-I-F, c'est bien cela ?");

    await processTranscriptStreaming(session, 'Oui', mgr);
    expect(mgr.createReservationFromConversation).toHaveBeenCalledWith(session);
    expect(speakTtsStreamed).toHaveBeenLastCalledWith(
      session,
      "C'est réservé au nom de ABKIF, samedi 5 septembre à 20 heures, pour 4 personnes. Je vous envoie un SMS de confirmation.",
    );
  });

  it("ne prétend pas qu'un créneau est disponible si la vérification échoue", async () => {
    const { session, mgr } = fixture();
    session.conversation.intent = 'reservation';
    session.conversation.slots = {
      date: '2026-09-05',
      partySize: 4,
    };
    vi.mocked(mgr.getAvailability).mockRejectedValue(new Error('calendar unavailable'));

    await processTranscriptStreaming(session, "Est-ce que c'est possible à midi ?", mgr);

    expect(mgr.processUtteranceStreaming).not.toHaveBeenCalled();
    expect(speakTtsStreamed).toHaveBeenCalledWith(
      session,
      "Je n'arrive pas à vérifier ce créneau pour le moment. Voulez-vous que je vous passe le gérant ?",
    );
  });

  it('réserve directement après la confirmation explicite du nom', async () => {
    const { session, mgr } = fixture();
    session.conversation.intent = 'reservation';
    session.conversation.slots = {
      date: '2026-09-05',
      time: '12:00',
      partySize: 4,
    };
    session.conversation.lastAvailabilityResult = {
      key: '2026-09-05:12:00:4',
      date: '2026-09-05',
      time: '12:00',
      partySize: 4,
      slots: ['12:00'],
    };
    session.conversation.pendingQuestion = 'customerName';
    session.conversation.lastAssistantQuestion = 'À quel nom je réserve ?';
    vi.mocked(mgr.createReservationFromConversation).mockResolvedValue(
      'Réservation confirmée pour AKKIF.',
    );

    await processTranscriptStreaming(session, 'Au nom de A deux k i f', mgr);
    await processTranscriptStreaming(session, 'Oui', mgr);

    expect(mgr.processUtteranceStreaming).not.toHaveBeenCalled();
    expect(mgr.createReservationFromConversation).toHaveBeenCalledWith(session);
    expect(speakTtsStreamed).toHaveBeenLastCalledWith(
      session,
      "C'est réservé au nom de AKKIF, samedi 5 septembre à midi, pour 4 personnes. Je vous envoie un SMS de confirmation.",
    );
  });

  it('clarifie un transcript ambigu après le départ au lieu d’inventer une annulation', async () => {
    const { session, mgr } = fixture();
    session.history.push({
      role: 'assistant',
      content: 'Votre réservation est confirmée. Au revoir et à demain.',
    });
    await processTranscriptStreaming(session, 'Nova', mgr);
    expect(speakTtsStreamed).toHaveBeenCalledWith(
      session,
      expect.stringContaining('Vous souhaitiez ajouter'),
    );
    expect(mgr.processUtteranceStreaming).not.toHaveBeenCalled();
    expect(session.ending).toBeUndefined();
  });
});

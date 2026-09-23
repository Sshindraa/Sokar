import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { acknowledgeCallEnding, finishCall, isExplicitCallEnd } from '../stream/call-ending';
import { handleSttEvent, processTranscriptStreaming } from '../stream/llm-handler';
import {
  createConversationState,
  recordAssistantReplyFromLlmTextFallback as recordAssistantReply,
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
    systemPrompt: "Tu es l'assistant vocal de Test Resto.",
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
    handoffToManager: vi.fn().mockResolvedValue('Le gérant a accepté le transfert.'),
    recordDialogueFallbackMessage: vi
      .fn()
      .mockResolvedValue("J'ai bien noté votre message pour le gérant."),
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
    vi.mocked(mgr.processUtteranceStreaming).mockImplementation(
      async (_session, _transcript, onPhrase) => {
        const reply =
          'Oui, nous avons de la place samedi 5 septembre à midi pour 4 personnes. À quel nom je réserve ?';
        await onPhrase?.(reply);
        return reply;
      },
    );

    await processTranscriptStreaming(session, "Est-ce que c'est possible à midi ?", mgr);

    expect(mgr.getAvailability).toHaveBeenCalledWith(session, '2026-09-05', 4);
    expect(mgr.processUtteranceStreaming).toHaveBeenCalledWith(
      session,
      "Est-ce que c'est possible à midi ?",
      expect.any(Function),
      expect.objectContaining({
        includeTools: false,
        context: expect.stringContaining('date exacte 2026-09-05'),
      }),
    );
    expect(speakTtsStreamed).toHaveBeenCalledWith(
      session,
      'Oui, nous avons de la place samedi 5 septembre à midi pour 4 personnes. À quel nom je réserve ?',
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
    let llmCall = 0;
    vi.mocked(mgr.processUtteranceStreaming).mockImplementation(
      async (_session, _transcript, onPhrase) => {
        llmCall++;
        const reply =
          llmCall === 1
            ? 'Oui, j’ai une table pour 4 personnes samedi 5 septembre à 20 heures. À quel nom je réserve ?'
            : 'J’ai une table pour quatre personnes samedi 5 septembre à 20 heures, au nom de ABKIF. Vous me confirmez ?';
        await onPhrase?.(reply);
        return reply;
      },
    );
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
    expect(mgr.createReservationFromConversation).not.toHaveBeenCalled();
    expect(session.conversation.pendingQuestion).toBe('confirmation');

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
      "Je n'arrive pas à vérifier ce créneau pour le moment, mais je peux prendre un message pour le gérant. Voulez-vous que je le fasse ?",
    );
  });

  it('réserve uniquement après la confirmation explicite du récapitulatif', async () => {
    const { session, mgr } = fixture();
    session.conversation.intent = 'reservation';
    session.conversation.slots = {
      date: '2026-09-05',
      time: '12:00',
      partySize: 4,
      customerName: 'AKKIF',
    };
    session.conversation.nameCollection.state = 'confirmed';
    session.conversation.nameCollection.confirmedName = 'AKKIF';
    session.conversation.lastAvailabilityResult = {
      key: '2026-09-05:12:00:4',
      date: '2026-09-05',
      time: '12:00',
      partySize: 4,
      slots: ['12:00'],
    };
    session.conversation.pendingQuestion = 'customerName';
    session.conversation.lastAssistantQuestion = 'À quel nom je réserve ?';
    recordAssistantReply(
      session,
      'J’ai une table pour quatre personnes samedi 5 septembre à midi, au nom d’AKKIF. Vous me confirmez ?',
    );
    vi.mocked(mgr.createReservationFromConversation).mockResolvedValue(
      'Réservation confirmée pour AKKIF.',
    );

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

describe('availability without a requested time', () => {
  it('proposes verified times, resolves the second choice and checks it again', async () => {
    const { session, mgr } = fixture();
    vi.mocked(mgr.getAvailability).mockResolvedValue({
      slots: ['12:00', '19:00', '20:00'],
    } as Awaited<ReturnType<CallSessionManager['getAvailability']>>);
    await processTranscriptStreaming(session, 'Une réservation pour quatre personnes', mgr);
    await processTranscriptStreaming(session, 'Est-ce possible demain ?', mgr);
    expect(mgr.getAvailability).toHaveBeenCalledTimes(1);
    expect(speakTtsStreamed).toHaveBeenLastCalledWith(
      session,
      'Je peux vous proposer 12 h ou 19 h ou 20 h. Quel horaire vous convient ?',
    );
    expect(session.conversation.slots.time).toBeUndefined();
    expect(mgr.createReservationFromConversation).not.toHaveBeenCalled();
    await processTranscriptStreaming(session, 'Le deuxième', mgr);
    expect(session.conversation.slots.time).toBe('19:00');
    expect(mgr.getAvailability).toHaveBeenCalledTimes(2);
    expect(mgr.createReservationFromConversation).not.toHaveBeenCalled();
  });

  it.each([
    'Vous avez de la disponibilité vers quelle heure vous ?',
    'Quels horaires avez-vous ?',
    'Quand avez-vous de la place ?',
  ])('handles %s while waiting for a time', async (text) => {
    const { session, mgr } = fixture();
    session.conversation.intent = 'reservation';
    session.conversation.slots = { date: '2026-09-23', partySize: 4 };
    recordAssistantReply(session, 'Vous voulez venir vers quelle heure ?');
    vi.mocked(mgr.getAvailability).mockResolvedValue({ slots: ['20:00'] } as Awaited<
      ReturnType<CallSessionManager['getAvailability']>
    >);
    await processTranscriptStreaming(session, text, mgr);
    expect(mgr.getAvailability).toHaveBeenCalledWith(session, '2026-09-23', 4);
    expect(speakTtsStreamed).toHaveBeenLastCalledWith(
      session,
      'Je peux vous proposer 20 h. Quel horaire vous convient ?',
    );
  });

  it('retains the request while collecting missing data and refreshes after a date correction', async () => {
    const { session, mgr } = fixture();
    vi.mocked(mgr.getAvailability).mockResolvedValue({ slots: ['19:00'] } as Awaited<
      ReturnType<CallSessionManager['getAvailability']>
    >);
    await processTranscriptStreaming(session, 'Quels horaires avez-vous demain ?', mgr);
    expect(mgr.getAvailability).not.toHaveBeenCalled();
    await processTranscriptStreaming(session, 'Pour quatre personnes', mgr);
    expect(mgr.getAvailability).toHaveBeenCalledTimes(1);
    const oldDate = session.conversation.slots.date;
    await processTranscriptStreaming(session, 'Plutôt après-demain', mgr);
    expect(mgr.getAvailability).toHaveBeenCalledTimes(2);
    expect(session.conversation.offeredAvailability?.date).not.toBe(oldDate);
  });

  it('rechecks an explicit alternative before progressing', async () => {
    const { session, mgr } = fixture();
    vi.mocked(mgr.getAvailability).mockResolvedValue({ slots: ['19:00', '20:00'] } as Awaited<
      ReturnType<CallSessionManager['getAvailability']>
    >);
    await processTranscriptStreaming(
      session,
      'Des disponibilités demain pour quatre personnes ?',
      mgr,
    );
    await processTranscriptStreaming(session, 'Plutôt vingt heures', mgr);
    expect(session.conversation.slots.time).toBe('20:00');
    expect(mgr.getAvailability).toHaveBeenCalledTimes(2);
    expect(mgr.createReservationFromConversation).not.toHaveBeenCalled();
  });

  it('ignores a lookup completed after the caller has hung up', async () => {
    const { session, mgr } = fixture();
    let resolve!: (value: Awaited<ReturnType<CallSessionManager['getAvailability']>>) => void;
    vi.mocked(mgr.getAvailability).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = processTranscriptStreaming(
      session,
      'Des disponibilités demain pour quatre personnes ?',
      mgr,
    );
    session.ended = true;
    resolve({ slots: ['19:00'] } as Awaited<ReturnType<CallSessionManager['getAvailability']>>);
    await pending;
    expect(speakTtsStreamed).not.toHaveBeenCalled();
    expect(session.conversation.offeredAvailability).toBeUndefined();
  });

  it('does not invent a time when closed or full', async () => {
    const { session, mgr } = fixture();
    vi.mocked(mgr.getAvailability).mockResolvedValue({ slots: [] } as unknown as Awaited<
      ReturnType<CallSessionManager['getAvailability']>
    >);
    await processTranscriptStreaming(
      session,
      'Des disponibilités demain pour quatre personnes ?',
      mgr,
    );
    expect(speakTtsStreamed).toHaveBeenLastCalledWith(
      session,
      expect.stringContaining('aucun créneau disponible'),
    );
    expect(session.conversation.slots.time).toBeUndefined();
    expect(mgr.createReservationFromConversation).not.toHaveBeenCalled();
  });

  it('does not announce availability when the lookup fails', async () => {
    const { session, mgr } = fixture();
    vi.mocked(mgr.getAvailability).mockRejectedValue(new Error('unavailable'));
    await processTranscriptStreaming(
      session,
      'Des disponibilités demain pour quatre personnes ?',
      mgr,
    );
    expect(speakTtsStreamed).toHaveBeenLastCalledWith(
      session,
      expect.stringContaining("Je n'arrive pas à vérifier"),
    );
    expect(session.conversation.offeredAvailability).toBeUndefined();
    expect(session.conversation.toolInFlight).toBeNull();
  });
});

describe('dialogue loop guard', () => {
  it('reformule puis propose un repli humain sans créer de réservation', async () => {
    const { session, mgr } = fixture();
    session.timezone = 'Europe/Paris';

    await processTranscriptStreaming(session, 'Je voudrais réserver demain soir', mgr);
    expect(speakTtsStreamed).toHaveBeenLastCalledWith(session, 'Vous serez combien ?');

    await processTranscriptStreaming(session, 'Euh, alors voila', mgr);
    expect(speakTtsStreamed).toHaveBeenLastCalledWith(
      session,
      'Je note combien de personnes ? Dites-moi simplement un nombre, par exemple « quatre ».',
    );

    await processTranscriptStreaming(session, 'Ben, je sais pas trop', mgr);
    expect(speakTtsStreamed).toHaveBeenLastCalledWith(
      session,
      'Je peux prendre un message pour le gérant, il vous rappellera. Voulez-vous que je le fasse ?',
    );
    expect(session.conversation.pendingQuestion).toBe('humanFallback');
    expect(session.conversation.humanFallbackOffered).toBe(true);
    expect(mgr.createReservationFromConversation).not.toHaveBeenCalled();
    expect(mgr.handoffToManager).not.toHaveBeenCalled();
    expect(mgr.recordDialogueFallbackMessage).not.toHaveBeenCalled();
  });

  it('exécute réellement la prise de message quand l’appelant accepte', async () => {
    const { session, mgr } = fixture();
    session.timezone = 'Europe/Paris';

    await processTranscriptStreaming(session, 'Je voudrais réserver demain soir', mgr);
    await processTranscriptStreaming(session, 'Euh, alors voila', mgr);
    await processTranscriptStreaming(session, 'Ben, je sais pas trop', mgr);
    await processTranscriptStreaming(session, 'Oui', mgr);

    expect(mgr.recordDialogueFallbackMessage).toHaveBeenCalledTimes(1);
    expect(mgr.handoffToManager).not.toHaveBeenCalled();
    expect(speakTtsStreamed).toHaveBeenLastCalledWith(
      session,
      "J'ai bien noté votre message pour le gérant.",
    );
    expect(session.conversation.pendingQuestion).toBeNull();
    expect(mgr.createReservationFromConversation).not.toHaveBeenCalled();
  });

  it('exécute réellement le transfert seulement quand la ligne gérant existe', async () => {
    const { session, mgr } = fixture();
    session.timezone = 'Europe/Paris';
    session.managerPhone = '+33600000000';

    await processTranscriptStreaming(session, 'Je voudrais réserver demain soir', mgr);
    await processTranscriptStreaming(session, 'Euh, alors voila', mgr);
    await processTranscriptStreaming(session, 'Ben, je sais pas trop', mgr);
    expect(speakTtsStreamed).toHaveBeenLastCalledWith(
      session,
      'Je peux vous passer le gérant, ou prendre un message pour lui. Que préférez-vous ?',
    );

    await processTranscriptStreaming(session, 'Passez-moi le gérant', mgr);
    expect(mgr.handoffToManager).toHaveBeenCalledTimes(1);
    expect(mgr.recordDialogueFallbackMessage).not.toHaveBeenCalled();
    expect(speakTtsStreamed).toHaveBeenLastCalledWith(session, 'Le gérant a accepté le transfert.');
    expect(mgr.createReservationFromConversation).not.toHaveBeenCalled();
  });

  it('ne choisit pas un transfert quand le client répond oui à deux options', async () => {
    const { session, mgr } = fixture();
    session.timezone = 'Europe/Paris';
    session.managerPhone = '+33600000000';

    await processTranscriptStreaming(session, 'Je voudrais réserver demain soir', mgr);
    await processTranscriptStreaming(session, 'Euh, alors voila', mgr);
    await processTranscriptStreaming(session, 'Ben, je sais pas trop', mgr);
    await processTranscriptStreaming(session, 'Oui', mgr);

    expect(mgr.handoffToManager).not.toHaveBeenCalled();
    expect(mgr.recordDialogueFallbackMessage).not.toHaveBeenCalled();
    expect(session.conversation.pendingQuestion).toBe('humanFallback');
    expect(session.conversation.humanFallbackMode).toBe('choice');
    expect(speakTtsStreamed).toHaveBeenLastCalledWith(
      session,
      'Vous préférez que je vous passe le gérant ou que je prenne un message ?',
    );
  });

  it('ne laisse pas une ancienne offre de transfert intercepter le oui à une nouvelle question', async () => {
    const { session, mgr } = fixture();
    session.timezone = 'Europe/Paris';
    session.managerPhone = '+33600000000';
    const replies = ['Désolé, j’ai perdu le fil. On est bien à quatre ?'];
    vi.mocked(mgr.processUtteranceStreaming).mockImplementation(
      async (_session, _transcript, onPhrase) => {
        const reply = replies.shift() ?? 'D’accord.';
        await onPhrase?.(reply);
        return reply;
      },
    );

    await processTranscriptStreaming(session, 'Je voudrais réserver demain soir', mgr);
    await processTranscriptStreaming(session, 'Euh, alors voila', mgr);
    await processTranscriptStreaming(session, 'Ben, je sais pas trop', mgr);
    await processTranscriptStreaming(session, 'Pourquoi ?', mgr);

    expect(mgr.processUtteranceStreaming).toHaveBeenCalledTimes(1);
    expect(session.conversation.humanFallbackOffered).toBe(false);
    expect(session.conversation.pendingQuestion).not.toBe('humanFallback');

    await processTranscriptStreaming(session, 'Oui', mgr);

    expect(mgr.handoffToManager).not.toHaveBeenCalled();
    expect(mgr.recordDialogueFallbackMessage).not.toHaveBeenCalled();
    expect(session.conversation.slots.partySize).toBe(4);
    expect(
      session.conversation.pendingInteractions.find(
        (interaction) => interaction.kind === 'humanFallback',
      )?.status,
    ).toBe('cancelled');
  });

  it('n’exécute rien quand l’appelant refuse la proposition', async () => {
    const { session, mgr } = fixture();
    session.timezone = 'Europe/Paris';
    session.managerPhone = '+33600000000';

    await processTranscriptStreaming(session, 'Je voudrais réserver demain soir', mgr);
    await processTranscriptStreaming(session, 'Euh, alors voila', mgr);
    await processTranscriptStreaming(session, 'Ben, je sais pas trop', mgr);
    await processTranscriptStreaming(session, 'Non merci', mgr);

    expect(mgr.handoffToManager).not.toHaveBeenCalled();
    expect(mgr.recordDialogueFallbackMessage).not.toHaveBeenCalled();
    expect(session.conversation.humanFallbackOffered).toBe(false);
    expect(session.conversation.pendingQuestion).not.toBe('humanFallback');
  });
});

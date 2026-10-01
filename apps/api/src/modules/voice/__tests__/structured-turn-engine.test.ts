import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { processTranscriptStreaming } from '../stream/llm-handler';
import { createConversationState } from '../stream/conversation-controller';
import type { StructuredTurnOutput } from '../stream/structured-turn/schema';
import {
  CALLER_FINISHED_FALLBACK,
  incompleteTurnSilenceMs,
  speculateStructuredTurn,
  generateRecoveryReply,
} from '../stream/structured-turn/engine';
import {
  bookingKey,
  createStructuredTurnState,
  todayInTimezone,
} from '../stream/structured-turn/fact-guards';
import type { CallSession } from '../stream/types';
import type { CallSessionManager } from '../stream/manager';
import { speakTtsStreamed } from '../stream/tts-handler';
import { __resetMetrics } from '../../../shared/observability/metrics';

vi.mock('../stream/tts-handler', () => ({
  speakTtsStreamed: vi.fn().mockResolvedValue(undefined),
  isSessionActiveForTts: vi.fn().mockReturnValue(true),
  cleanTextForTts: (text: string) => text,
}));
const contextTurn: {
  push: ReturnType<typeof vi.fn>;
  finish: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  hasAudioOutput: boolean;
  onHoldCancelled?: () => void;
} = {
  push: vi.fn(),
  finish: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn(),
  hasAudioOutput: false,
};
vi.mock('../stream/cartesia-context', () => ({
  isCartesiaContextV2Enabled: () => process.env.VOICE_TTS_CONTEXT_V2_ENABLED === 'true',
  createCartesiaContextTurn: vi.fn(() => contextTurn),
}));
vi.mock('../../../shared/telnyx/http-agent', () => ({
  telnyxFetch: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../../../shared/logger/pino', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const RESTAURANT_ID = 'resto-structured';
const TOMORROW = (() => {
  const date = new Date(`${todayInTimezone('Europe/Paris')}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
})();

function turn(overrides: Partial<StructuredTurnOutput> = {}): StructuredTurnOutput {
  return {
    turnComplete: true,
    interpretation: 'answer',
    draft: { date: '', time: '', partySize: 0, customerName: '' },
    awaiting: 'none',
    action: 'none',
    message: '',
    confidence: 'high',
    say: '',
    ...overrides,
  };
}

function fixture() {
  const session = {
    callControlId: 'cc-structured',
    restaurantId: RESTAURANT_ID,
    timezone: 'Europe/Paris',
    from: '+33600000000',
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
  const outputs: StructuredTurnOutput[] = [];
  const mgr = {
    handleBargeIn: vi.fn(),
    transition: vi.fn((s: CallSession, state: CallSession['state']) => {
      s.state = state;
      return true;
    }),
    cleanup: vi.fn((s: CallSession) => {
      s.ended = true;
      s.state = 'IDLE';
    }),
    // Le modèle est simulé : sa sortie est émise par petits fragments, comme en streaming.
    streamStructuredCompletion: vi.fn(
      async (
        _session: CallSession,
        _messages: unknown,
        _format: unknown,
        options: { onDelta: (delta: string) => void },
      ) => {
        const next = outputs.shift();
        if (!next) throw new Error('no scripted model output');
        const json = JSON.stringify(next);
        for (let index = 0; index < json.length; index += 7) {
          options.onDelta(json.slice(index, index + 7));
        }
        return json;
      },
    ),
    getAvailability: vi.fn(async (_s: CallSession, date: string, partySize: number) => ({
      restaurantId: RESTAURANT_ID,
      date,
      partySize,
      slots: ['19:00', '19:30', '20:00'],
      allSlots: [],
    })),
    createReservationFromConversation: vi.fn(async (s: CallSession) => {
      s.reservationCreatedAt = Date.now();
      return 'Réservation confirmée.';
    }),
    handoffToManager: vi.fn().mockResolvedValue('Je vous passe le gérant.'),
    recordCallerMessage: vi.fn().mockResolvedValue('Message enregistré.'),
    processUtteranceStreaming: vi.fn(),
  } as unknown as CallSessionManager;
  return { session, mgr, outputs };
}

function spoken(): string[] {
  return vi.mocked(speakTtsStreamed).mock.calls.map(([, text]) => String(text));
}

beforeEach(() => {
  __resetMetrics();
  vi.clearAllMocks();
  vi.stubEnv('VOICE_STRUCTURED_TURN_RESTAURANT_IDS', RESTAURANT_ID);
  return () => vi.unstubAllEnvs();
});

describe('tour structuré (canary)', () => {
  it('répond à une question posée en pleine réservation (appel 02fd0726, tour 4)', async () => {
    const { session, mgr, outputs } = fixture();
    session.structuredTurn = {
      ...createStructuredTurnState(),
      draft: { date: TOMORROW, time: '', partySize: 4, customerName: '' },
      lastAwaiting: 'time',
    };
    outputs.push(
      turn({
        interpretation: 'question',
        draft: { date: TOMORROW, time: '', partySize: 4, customerName: '' },
        awaiting: 'time',
        say: 'Nous ouvrons de 19 h à 23 h. Vers quelle heure voulez-vous venir ?',
      }),
    );

    await processTranscriptStreaming(session, 'en fait vous êtes ouvert quelle heure plutôt', mgr);

    expect(mgr.processUtteranceStreaming).not.toHaveBeenCalled();
    expect(spoken()).toEqual([
      'Nous ouvrons de 19 h à 23 h.',
      'Vers quelle heure voulez-vous venir ?',
    ]);
    expect(session.conversation.pendingQuestion).toBe('time');
  });

  it('termine poliment quand l’appelant renonce (appel e3e67025, tour 12)', async () => {
    vi.useFakeTimers();
    const { session, mgr, outputs } = fixture();
    outputs.push(
      turn({
        interpretation: 'end_call',
        action: 'end_call',
        say: 'Très bien, je n’enregistre rien. Bonne soirée.',
      }),
    );

    const pending = processTranscriptStreaming(session, 'non non non je préfère rien faire', mgr);
    await vi.advanceTimersByTimeAsync(16_000);
    await pending;
    vi.useRealTimers();

    expect(spoken()).toEqual(['Très bien, je n’enregistre rien. Bonne soirée.']);
    expect(mgr.cleanup).toHaveBeenCalledWith(session);
  });

  it('vérifie la disponibilité réelle puis laisse le modèle formuler le résultat', async () => {
    const { session, mgr, outputs } = fixture();
    const draft = { date: TOMORROW, time: '20:00', partySize: 4, customerName: '' };
    outputs.push(
      turn({ draft, action: 'check_availability' }),
      turn({ draft, awaiting: 'customerName', say: '20 h est libre. À quel nom ?' }),
    );

    await processTranscriptStreaming(session, 'demain 20 h pour quatre', mgr);

    expect(mgr.getAvailability).toHaveBeenCalledWith(session, TOMORROW, 4);
    expect(session.structuredTurn?.availability?.slots).toContain('20:00');
    expect(spoken()).toEqual(['20 h est libre.', 'À quel nom ?']);
  });

  it('annonce un jour fermé par une phrase fixe, sans second appel au modèle (appels a8012c5c, 0d49230d)', async () => {
    const { session, mgr, outputs } = fixture();
    vi.mocked(mgr.getAvailability).mockResolvedValueOnce({
      restaurantId: RESTAURANT_ID,
      date: '2026-09-27',
      partySize: 7,
      slots: [],
      allSlots: [],
    });
    const draft = { date: TOMORROW, time: '14:00', partySize: 7, customerName: '' };
    outputs.push(turn({ draft, action: 'check_availability' }));

    await processTranscriptStreaming(session, 'non 7 pardon', mgr);

    expect(spoken().join(' ')).toMatch(
      /^Nous sommes fermés \S+ \d+ \S+\. Voulez-vous venir un autre jour \?$/,
    );
    expect(session.history.at(-1)?.content).toContain('fermés');
    expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(1);
    expect(session.structuredTurn?.lastAwaiting).toBe('date');
  });

  it('dit « complet » plutôt que « pas compris » quand le jour ouvert est plein', async () => {
    const { session, mgr, outputs } = fixture();
    vi.mocked(mgr.getAvailability).mockResolvedValueOnce({
      restaurantId: RESTAURANT_ID,
      date: '2026-09-26',
      partySize: 7,
      slots: [],
      allSlots: [{ time: '20:00', available: false }],
    });
    const draft = { date: TOMORROW, time: '20:00', partySize: 7, customerName: '' };
    outputs.push(turn({ draft, action: 'check_availability' }), turn({ draft, say: '' }));

    await processTranscriptStreaming(session, 'on sera sept', mgr);

    expect(spoken().join(' ')).toMatch(/^Je n'ai plus de table \S+ \d+ \S+ pour 7 personnes\./);
    expect(spoken().join(' ')).not.toContain('pas bien saisi');
  });

  it('répond en un seul passage avec les créneaux du jour lus d’avance', async () => {
    const { session, mgr, outputs } = fixture();
    const dated = { date: TOMORROW, time: '', partySize: 0, customerName: '' };
    outputs.push(turn({ draft: dated, awaiting: 'time', say: 'Vers quelle heure ?' }));
    await processTranscriptStreaming(session, 'une table pour demain', mgr);
    // La lecture du jour part à la fin du tour, sans le ralentir.
    await vi.waitFor(() => expect(session.structuredTurn?.dayAvailability?.date).toBe(TOMORROW));
    expect(mgr.getAvailability).toHaveBeenCalledWith(session, TOMORROW, 1);

    vi.mocked(mgr.getAvailability).mockClear();
    const complete = { date: TOMORROW, time: '20:00', partySize: 4, customerName: '' };
    outputs.push(
      turn({ draft: complete, awaiting: 'customerName', say: '20 h est libre. À quel nom ?' }),
    );
    await processTranscriptStreaming(session, '20 heures pour quatre', mgr);

    // Un seul appel au modèle, et le créneau est vérifié pour la réservation.
    expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(2);
    const context = (
      vi.mocked(mgr.streamStructuredCompletion).mock.calls.at(-1)?.[1] as Array<{ content: string }>
    )[0].content;
    expect(context).toContain('"freeSlotsByPartySize"');
    expect(context).toContain('19:00→20:00');
    expect(session.structuredTurn?.availability).toEqual({
      date: TOMORROW,
      partySize: 4,
      slots: ['19:00', '19:30', '20:00'],
    });
    expect(spoken()).toContain('À quel nom ?');
  });

  describe('heure hors horaires du jour (profil ouvert le midi seulement)', () => {
    const LUNCH_ONLY = {
      tue: { open: '12:00', close: '14:30' },
      wed: { open: '12:00', close: '14:30' },
      sat: { open: '12:00', close: '23:00' },
    };
    // Prochain mardi à partir de demain : jour ouvert 12 h–14 h 30 dans ce profil.
    const NEXT_TUESDAY = (() => {
      const date = new Date(`${TOMORROW}T00:00:00.000Z`);
      while (date.getUTCDay() !== 2) date.setUTCDate(date.getUTCDate() + 1);
      return date.toISOString().slice(0, 10);
    })();
    const draftAt = (time: string) => ({
      date: NEXT_TUESDAY,
      time,
      partySize: 0,
      customerName: '',
    });
    const secondPassContext = (mgr: CallSessionManager) =>
      (
        vi.mocked(mgr.streamStructuredCompletion).mock.calls[1]?.[1] as Array<{ content: string }>
      )[0].content;

    it('ne laisse pas accepter « mardi à 20 heures » : silence, fait réel donné au second passage', async () => {
      const { session, mgr, outputs } = fixture();
      (session as { openingHours?: unknown }).openingHours = LUNCH_ONLY;
      outputs.push(
        turn({
          draft: draftAt('20:00'),
          awaiting: 'partySize',
          say: 'Mardi soir, ça tombe bien. Vous serez combien ?',
        }),
        turn({
          draft: draftAt(''),
          awaiting: 'time',
          say: 'Le mardi, nous fermons à 14 h 30. Quelle heure vous conviendrait ?',
        }),
      );

      await processTranscriptStreaming(session, 'mardi à 20 heures', mgr);

      expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(2);
      expect(secondPassContext(mgr)).toContain('en dehors des horaires du mardi (12:00–14:30)');
      expect(spoken().join(' ')).not.toContain('tombe bien');
      expect(spoken().join(' ')).toContain('14 h 30');
    });

    it("laisse parler normalement quand l'heure est dans le service", async () => {
      const { session, mgr, outputs } = fixture();
      (session as { openingHours?: unknown }).openingHours = LUNCH_ONLY;
      outputs.push(
        turn({
          draft: draftAt('13:00'),
          awaiting: 'partySize',
          say: 'Mardi à 13 heures. Vous serez combien ?',
        }),
      );

      await processTranscriptStreaming(session, 'mardi à 13 heures', mgr);

      expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(1);
      expect(spoken()).toContain('Vous serez combien ?');
    });
  });

  describe('nom épelé suivi d’un mot que l’appelant n’a pas épelé', () => {
    const named = (customerName: string) => ({
      date: TOMORROW,
      time: '19:00',
      partySize: 4,
      customerName,
    });
    const secondPassContext = (mgr: CallSessionManager) =>
      (
        vi.mocked(mgr.streamStructuredCompletion).mock.calls[1]?.[1] as Array<{ content: string }>
      )[0].content;
    const askingName = () => {
      const fx = fixture();
      const state = createStructuredTurnState();
      state.draft = { ...named(''), customerName: '' };
      state.lastAwaiting = 'customerName';
      fx.session.structuredTurn = state;
      return fx;
    };

    it('se tait, retient le bon nom et laisse le modèle relire les lettres épelées', async () => {
      const { session, mgr, outputs } = askingName();
      outputs.push(
        turn({
          draft: named('HOUET DIMANCHE'),
          awaiting: 'customerNameConfirmation',
          say: 'Je répète : HOUET DIMANCHE, c’est bien ça ?',
        }),
        turn({
          draft: named('HOUET'),
          awaiting: 'customerNameConfirmation',
          say: 'Donc H, O, U, E, T. C’est bien ça ?',
        }),
      );

      await processTranscriptStreaming(session, 'h o u e t dimanche', mgr);

      expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(2);
      expect(secondPassContext(mgr)).toContain('customerName = « HOUET »');
      expect(spoken().join(' ')).not.toContain('DIMANCHE');
      expect(spoken().join(' ')).toContain('H, O, U, E, T');
      expect(session.structuredTurn?.draft.customerName).toBe('HOUET');
    });

    it('se tait aussi quand le modèle écrit un autre nom que les lettres épelées, sans mot collé', async () => {
      const { session, mgr, outputs } = askingName();
      outputs.push(
        turn({
          draft: named('Hoët'),
          awaiting: 'customerNameConfirmation',
          say: 'Je répète : Hoët, c’est bien ça ?',
        }),
        turn({
          draft: named('HOUET'),
          awaiting: 'customerNameConfirmation',
          say: 'Donc H, O, U, E, T. C’est bien ça ?',
        }),
      );

      await processTranscriptStreaming(session, 'hoët h o u e t', mgr);

      expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(2);
      expect(secondPassContext(mgr)).toContain('customerName = « Houet »');
      expect(spoken().join(' ')).not.toContain('Hoët');
      expect(spoken().join(' ')).toContain('H, O, U, E, T');
      expect(session.structuredTurn?.draft.customerName).toBe('HOUET');
    });

    it('ne change rien quand le nom relu est exactement ce qui a été épelé', async () => {
      const { session, mgr, outputs } = askingName();
      outputs.push(
        turn({
          draft: named('HOUET'),
          awaiting: 'customerNameConfirmation',
          say: 'Donc H, O, U, E, T. C’est bien ça ?',
        }),
      );

      await processTranscriptStreaming(session, 'h o u e t', mgr);

      expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(1);
      expect(spoken().join(' ')).toContain('H, O, U, E, T');
    });

    it('ne se déclenche pas hors d’une épellation attendue', async () => {
      const { session, mgr, outputs } = fixture();
      outputs.push(
        turn({ draft: named('Jean Dupont'), awaiting: 'confirmation', say: 'Jean Dupont, ok ?' }),
      );

      await processTranscriptStreaming(session, 'jean dupont', mgr);

      expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(1);
    });
  });

  describe('relance formulée par le modèle (generateRecoveryReply)', () => {
    const asking = () => {
      const fx = fixture();
      fx.session.history = [
        { role: 'user', content: 'demain' },
        { role: 'assistant', content: 'Vers quelle heure vous aimeriez venir ?' },
      ];
      return fx;
    };
    const requestOf = (mgr: CallSessionManager) =>
      vi.mocked(mgr.streamStructuredCompletion).mock.calls[0]?.[1] as Array<{
        role: string;
        content: string;
      }>;

    it('rend la phrase du modèle, après une requête sans énoncé et avec le type de relance', async () => {
      const { session, mgr, outputs } = asking();
      outputs.push(turn({ awaiting: 'time', say: 'Désolé, vous disiez ? Vers quelle heure ?' }));

      const reply = await generateRecoveryReply(session, mgr, 'unheard');

      expect(reply).toBe('Désolé, vous disiez ? Vers quelle heure ?');
      const messages = requestOf(mgr);
      expect(messages[0].content).toContain('RELANCE :');
      expect(messages[0].content).toContain('aucun mot n’a pu être reconnu'.replace('’', "'"));
      expect(messages.at(-1)).toEqual({ role: 'user', content: '(aucune parole reconnue)' });
      // L'historique réel n'est ni complété ni modifié par la relance.
      expect(session.history).toHaveLength(2);
    });

    it('adoucit les points d’exclamation, comme pour un tour', async () => {
      const { session, mgr, outputs } = asking();
      outputs.push(turn({ say: 'Vous êtes toujours là !' }));
      expect(await generateRecoveryReply(session, mgr, 'silence')).toBe('Vous êtes toujours là.');
    });

    it.each([
      ['une action demandée', turn({ action: 'check_availability', say: 'Je vérifie.' })],
      ['une phrase vide', turn({ say: '   ' })],
    ])('rend null pour %s : l’appelant garde sa phrase de secours', async (_label, output) => {
      const { session, mgr, outputs } = asking();
      outputs.push(output);
      expect(await generateRecoveryReply(session, mgr, 'silence')).toBeNull();
    });

    it('rend null sans appeler le modèle hors du tour structuré ou sans accès au modèle', async () => {
      const { session, mgr } = asking();
      expect(await generateRecoveryReply(session, {}, 'silence')).toBeNull();
      (session as { restaurantId: string }).restaurantId = 'restaurant-hors-structure';
      vi.stubEnv('VOICE_V2_DEFAULT', 'false');
      expect(await generateRecoveryReply(session, mgr, 'silence')).toBeNull();
      expect(mgr.streamStructuredCompletion).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });
  });

  describe('quelques lettres après la relecture du nom (appel 6a70dff9)', () => {
    const named = (customerName: string) => ({
      date: TOMORROW,
      time: '19:00',
      partySize: 4,
      customerName,
    });
    const secondPassContext = (mgr: CallSessionManager) =>
      (
        vi.mocked(mgr.streamStructuredCompletion).mock.calls[1]?.[1] as Array<{ content: string }>
      )[0].content;
    /** L'agent vient de relire « H, O, U, T » (le E de « houet » avait été perdu). */
    const afterReadBack = () => {
      const fx = fixture();
      const state = createStructuredTurnState();
      state.draft = named('HOUT');
      state.lastAwaiting = 'customerNameConfirmation';
      fx.session.structuredTurn = state;
      return fx;
    };

    it('se tait quand le modèle recolle à la suite, aligne les lettres et relit le bon nom', async () => {
      const { session, mgr, outputs } = afterReadBack();
      outputs.push(
        turn({
          draft: named('HOUTET'),
          awaiting: 'customerNameConfirmation',
          say: 'Donc H, O, U, T, E, T. C’est bien ça ?',
        }),
        turn({
          draft: named('HOUET'),
          awaiting: 'customerNameConfirmation',
          say: 'Donc H, O, U, E, T. C’est bien ça ?',
        }),
      );

      await processTranscriptStreaming(session, 'e t', mgr);

      expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(2);
      expect(secondPassContext(mgr)).toContain('customerName = « HOUET »');
      expect(spoken().join(' ')).not.toContain('T, E, T');
      expect(spoken().join(' ')).toContain('H, O, U, E, T');
      expect(session.structuredTurn?.draft.customerName).toBe('HOUET');
    });

    it('aligne aussi quand le modèle doute et ne change rien : le nom lu est le bon', async () => {
      const { session, mgr, outputs } = afterReadBack();
      outputs.push(
        turn({
          draft: named('HOUT'),
          awaiting: 'customerNameConfirmation',
          interpretation: 'unclear',
          understanding: 'doubtful',
          say: 'Pardon, pouvez-vous épeler le nom ?',
        }),
        turn({
          draft: named('HOUET'),
          awaiting: 'customerNameConfirmation',
          say: 'Donc H, O, U, E, T. C’est bien ça ?',
        }),
      );

      await processTranscriptStreaming(session, 'e t', mgr);

      expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(2);
      expect(spoken().join(' ')).not.toContain('pouvez-vous épeler');
      expect(session.structuredTurn?.draft.customerName).toBe('HOUET');
    });

    it('ne se déclenche pas quand le modèle a déjà le bon nom', async () => {
      const { session, mgr, outputs } = afterReadBack();
      outputs.push(
        turn({
          draft: named('HOUET'),
          awaiting: 'customerNameConfirmation',
          say: 'Donc H, O, U, E, T. C’est bien ça ?',
        }),
      );

      await processTranscriptStreaming(session, 'e t', mgr);

      expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(1);
      expect(session.structuredTurn?.draft.customerName).toBe('HOUET');
    });

    it('laisse le modèle quand la phrase n’est pas faite que de lettres', async () => {
      const { session, mgr, outputs } = afterReadBack();
      outputs.push(
        turn({
          draft: named('HOUTET'),
          awaiting: 'customerNameConfirmation',
          say: 'Donc H, O, U, T, E, T. C’est bien ça ?',
        }),
      );

      await processTranscriptStreaming(session, 'non e t', mgr);

      expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(1);
    });
  });

  describe('créneau exclu par les disponibilités lues (appel 1b3f85e9)', () => {
    const conflicting = { date: TOMORROW, time: '15:30', partySize: 5, customerName: '' };
    const day = (slots: string[]) => ({
      date: TOMORROW,
      closed: false,
      slotsBySize: { 5: slots },
    });
    const secondPassContext = (mgr: CallSessionManager) =>
      (
        vi.mocked(mgr.streamStructuredCompletion).mock.calls[1]?.[1] as Array<{ content: string }>
      )[0].content;

    it('ne promet pas le créneau, vérifie pour de bon et laisse le modèle proposer des alternatives', async () => {
      const { session, mgr, outputs } = fixture();
      session.structuredTurn = {
        ...createStructuredTurnState(),
        draft: { ...conflicting, partySize: 0 },
        lastAwaiting: 'partySize',
        dayAvailability: day(['12:00', '18:30', '19:00']),
      };
      vi.mocked(mgr.getAvailability).mockResolvedValueOnce({
        restaurantId: RESTAURANT_ID,
        date: TOMORROW,
        partySize: 5,
        slots: ['12:00', '18:30', '19:00'],
        allSlots: [
          { time: '12:00', available: true },
          { time: '15:30', available: true },
          { time: '18:30', available: true },
          { time: '19:00', available: true },
        ],
      });
      outputs.push(
        turn({
          draft: conflicting,
          awaiting: 'customerName',
          say: 'Pour 5, 15 h 30 est libre. C’est à quel nom ?',
        }),
        turn({
          draft: { ...conflicting, time: '' },
          awaiting: 'time',
          say: '15 h 30 n’est pas disponible pour 5. Je peux vous proposer 18 h 30.',
        }),
      );

      await processTranscriptStreaming(session, '5 5 5', mgr);

      expect(mgr.getAvailability).toHaveBeenCalledWith(session, TOMORROW, 5);
      expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(2);
      expect(secondPassContext(mgr)).toContain("15:30 n'est pas disponible");
      expect(secondPassContext(mgr)).toContain('12:00, 18:30, 19:00');
      expect(spoken().join(' ')).not.toContain('est libre');
      expect(spoken().join(' ')).toContain('18 h 30');
    });

    it('laisse parler normalement quand le créneau est libre', async () => {
      const { session, mgr, outputs } = fixture();
      session.structuredTurn = {
        ...createStructuredTurnState(),
        draft: { ...conflicting, partySize: 0 },
        lastAwaiting: 'partySize',
        dayAvailability: day(['12:00', '15:30', '19:00']),
      };
      outputs.push(
        turn({
          draft: conflicting,
          awaiting: 'customerName',
          say: 'Pour 5, 15 h 30 est libre. C’est à quel nom ?',
        }),
      );

      await processTranscriptStreaming(session, '5 personnes', mgr);

      expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(1);
      expect(spoken()).toContain('C’est à quel nom ?');
    });

    it('ne répète pas l’indisponibilité quand l’appelant pose une autre question sans changer le créneau', async () => {
      const { session, mgr, outputs } = fixture();
      session.structuredTurn = {
        ...createStructuredTurnState(),
        draft: conflicting,
        lastAwaiting: 'time',
        dayAvailability: day(['12:00', '18:30']),
      };
      outputs.push(
        turn({
          interpretation: 'question',
          draft: conflicting,
          awaiting: 'time',
          say: 'Oui, nous avons une terrasse.',
        }),
      );

      await processTranscriptStreaming(session, 'et vous avez une terrasse', mgr);

      // Un seul passage du modèle : pas de vérification déclenchée par le créneau resté en conflit.
      expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(1);
      expect(spoken()).toContain('Oui, nous avons une terrasse.');
      expect(spoken().join(' ')).not.toContain('disponible');
    });

    it('donne les faits réels au modèle quand la garde refuse la création (créneau non vérifié)', async () => {
      const { session, mgr, outputs } = fixture();
      session.structuredTurn = {
        ...createStructuredTurnState(),
        draft: { ...conflicting, customerName: 'Akkis' },
        lastAwaiting: 'confirmation',
        recapKey: bookingKey({ ...conflicting, customerName: 'Akkis' }),
        availability: { date: TOMORROW, partySize: 5, slots: ['12:00', '18:30'] },
      };
      vi.mocked(mgr.getAvailability).mockResolvedValueOnce({
        restaurantId: RESTAURANT_ID,
        date: TOMORROW,
        partySize: 5,
        slots: ['12:00', '18:30'],
        allSlots: [
          { time: '12:00', available: true },
          { time: '15:30', available: true },
          { time: '18:30', available: true },
        ],
      });
      const draft = { ...conflicting, customerName: 'Akkis' };
      outputs.push(
        turn({
          interpretation: 'affirmation',
          draft,
          action: 'create_reservation',
          awaiting: 'none',
        }),
        turn({
          draft,
          awaiting: 'time',
          say: '15 h 30 est complet pour 5. Je peux vous proposer 18 h 30.',
        }),
      );

      await processTranscriptStreaming(session, 'oui parfait', mgr);

      expect(mgr.createReservationFromConversation).not.toHaveBeenCalled();
      expect(mgr.getAvailability).toHaveBeenCalledWith(session, TOMORROW, 5);
      expect(secondPassContext(mgr)).toContain("15:30 n'est pas disponible");
      expect(spoken().join(' ')).toContain('18 h 30');
    });
  });

  it('ne crée pas la réservation sans récapitulatif accepté', async () => {
    const { session, mgr, outputs } = fixture();
    const draft = { date: TOMORROW, time: '20:00', partySize: 4, customerName: 'Akkif' };
    session.structuredTurn = {
      ...createStructuredTurnState(),
      draft,
      availability: { date: draft.date, partySize: 4, slots: ['20:00'] },
      lastAwaiting: 'customerName',
    };
    outputs.push(
      turn({ interpretation: 'answer', draft, action: 'create_reservation' }),
      turn({
        draft,
        awaiting: 'confirmation',
        say: 'Je récapitule : demain 20 h, quatre personnes, au nom de Akkif. C’est bon ?',
      }),
    );

    await processTranscriptStreaming(session, 'Akkif', mgr);

    expect(mgr.createReservationFromConversation).not.toHaveBeenCalled();
    expect(session.structuredTurn?.recapKey).toBe(bookingKey(draft));
  });

  it('crée la réservation après un oui au récapitulatif', async () => {
    const { session, mgr, outputs } = fixture();
    const draft = { date: TOMORROW, time: '20:00', partySize: 4, customerName: 'Akkif' };
    session.structuredTurn = {
      ...createStructuredTurnState(),
      draft,
      availability: { date: draft.date, partySize: 4, slots: ['20:00'] },
      lastAwaiting: 'confirmation',
      recapKey: bookingKey(draft),
    };
    outputs.push(
      turn({ interpretation: 'affirmation', draft, action: 'create_reservation' }),
      turn({ draft, say: 'C’est réservé. Vous recevrez un SMS. Bonne soirée !' }),
    );

    await processTranscriptStreaming(session, 'oui c’est parfait', mgr);

    expect(mgr.createReservationFromConversation).toHaveBeenCalledTimes(1);
    expect(session.structuredTurn?.reservationCreated).toBe(true);
    expect(session.conversation.confirmedReservationKey).not.toBeNull();
  });

  describe('récapitulatif coupé par l’appelant', () => {
    const RECAP = 'Donc, demain à 20 h, pour 4 personnes, au nom de Akkif. C’est bon ?';
    const draft = { date: TOMORROW, time: '20:00', partySize: 4, customerName: 'Akkif' };
    function recapFixture(unheard: string) {
      const context = fixture();
      context.session.structuredTurn = {
        ...createStructuredTurnState(),
        draft,
        availability: { date: draft.date, partySize: 4, slots: ['20:00'] },
        lastAwaiting: 'confirmation',
        recapKey: bookingKey(draft),
      };
      context.session.interruptedReply = {
        said: RECAP,
        heard: RECAP.slice(0, RECAP.length - unheard.length).trim(),
        unheard,
      };
      return context;
    }

    it('ne réserve pas sur un oui dit avant d’avoir entendu tout le contenu, et donne la suite', async () => {
      const { session, mgr, outputs } = recapFixture(
        'pour 4 personnes, au nom de Akkif. C’est bon ?',
      );
      outputs.push(
        turn({ interpretation: 'affirmation', draft, action: 'create_reservation' }),
        turn({
          draft,
          awaiting: 'confirmation',
          say: 'Pour 4 personnes, au nom de Akkif. C’est bon ?',
        }),
      );

      await processTranscriptStreaming(session, 'oui', mgr);

      expect(mgr.createReservationFromConversation).not.toHaveBeenCalled();
      const secondPass = vi.mocked(mgr.streamStructuredCompletion).mock.calls[1]?.[1] as Array<{
        content: string;
      }>;
      expect(secondPass[0].content).toContain('entendu tout le récapitulatif');
      expect(secondPass[0].content).toContain('pour 4 personnes, au nom de Akkif');
      expect(session.interruptedReply).toBeUndefined();
    });

    it('accepte le oui suivant : un seul refus par récapitulatif', async () => {
      const { session, mgr, outputs } = recapFixture(
        'pour 4 personnes, au nom de Akkif. C’est bon ?',
      );
      outputs.push(
        turn({ interpretation: 'affirmation', draft, action: 'create_reservation' }),
        turn({
          draft,
          awaiting: 'confirmation',
          say: 'Pour 4 personnes, au nom de Akkif. C’est bon ?',
        }),
      );
      await processTranscriptStreaming(session, 'oui', mgr);
      expect(mgr.createReservationFromConversation).not.toHaveBeenCalled();

      // L'appelant répond encore par-dessus la relecture : son accord vaut.
      session.interruptedReply = {
        said: RECAP,
        heard: 'Pour 4',
        unheard: 'personnes, au nom de Akkif. C’est bon ?',
      };
      outputs.push(
        turn({ interpretation: 'affirmation', draft, action: 'create_reservation' }),
        turn({ draft, say: 'C’est réservé. Bonne soirée !' }),
      );
      await processTranscriptStreaming(session, 'oui', mgr);
      expect(mgr.createReservationFromConversation).toHaveBeenCalledTimes(1);
    });

    it('réserve quand seule la question finale n’a pas été entendue', async () => {
      const { session, mgr, outputs } = recapFixture('C’est bon ?');
      outputs.push(
        turn({ interpretation: 'affirmation', draft, action: 'create_reservation' }),
        turn({ draft, say: 'C’est réservé. Bonne soirée !' }),
      );

      await processTranscriptStreaming(session, 'oui', mgr);

      expect(mgr.createReservationFromConversation).toHaveBeenCalledTimes(1);
    });
  });

  it('jette la réponse préparée comme un barge-in quand l’appelant reprend avant le premier son', async () => {
    vi.stubEnv('VOICE_TTS_CONTEXT_V2_ENABLED', 'true');
    const { session, mgr, outputs } = fixture();
    outputs.push(turn({ say: 'Bonjour. Pour quel jour ?', awaiting: 'date' }));
    contextTurn.onHoldCancelled = undefined;

    await processTranscriptStreaming(session, 'oui bonjour', mgr);

    const onHoldCancelled = contextTurn.onHoldCancelled as (() => void) | undefined;
    expect(onHoldCancelled).toBeTypeOf('function');
    onHoldCancelled?.();
    expect(session.sttAfterBargeIn).toBe(true);
    expect(mgr.handleBargeIn).toHaveBeenCalledWith(session);
  });

  it('refuse une date passée proposée par le modèle', async () => {
    const { session, mgr, outputs } = fixture();
    outputs.push(
      turn({
        draft: { date: '2020-01-01', time: '', partySize: 2, customerName: '' },
        awaiting: 'date',
        say: 'Pour quel jour ?',
      }),
    );

    await processTranscriptStreaming(session, 'le premier janvier', mgr);

    expect(session.structuredTurn?.draft.date).toBe('');
    expect(session.structuredTurn?.draft.partySize).toBe(2);
  });

  it('dit une phrase de secours si la sortie du modèle est invalide', async () => {
    const { session, mgr } = fixture();
    vi.mocked(mgr.streamStructuredCompletion).mockResolvedValueOnce('{"say":');

    await processTranscriptStreaming(session, 'bonjour', mgr);

    expect(spoken()).toHaveLength(1);
    expect(session.state).toBe('LISTENING');
  });

  it('se tait quand l’appelant n’a pas fini et recolle le fragment (appel d89cdb48)', async () => {
    const { session, mgr, outputs } = fixture();
    outputs.push(
      turn({ turnComplete: false, interpretation: 'unclear', confidence: 'low' }),
      turn({
        interpretation: 'question',
        awaiting: 'open',
        say: 'Pour six, je n’ai rien demain. Voulez-vous un autre jour ?',
      }),
    );

    await processTranscriptStreaming(session, 'pourquoi parce que vous n’acceptez pas les', mgr);

    expect(spoken()).toEqual([]);
    expect(session.state).toBe('LISTENING');
    expect(session.history).toEqual([]);
    expect(session.structuredTurn?.pendingFragment).toBe(
      'pourquoi parce que vous n’acceptez pas les',
    );

    await processTranscriptStreaming(session, 'groupes de six le dimanche', mgr);

    const lastMessages = vi.mocked(mgr.streamStructuredCompletion).mock.calls.at(-1)?.[1] as Array<{
      content: string;
    }>;
    expect(lastMessages.at(-1)?.content).toBe(
      'pourquoi parce que vous n’acceptez pas les groupes de six le dimanche',
    );
    expect(spoken()).toEqual(['Pour six, je n’ai rien demain.', 'Voulez-vous un autre jour ?']);
    expect(session.structuredTurn?.pendingFragment).toBeNull();
  });

  it('répond quand même si l’appelant reste silencieux après un tour inachevé', async () => {
    vi.useFakeTimers();
    const { session, mgr, outputs } = fixture();
    outputs.push(
      turn({ turnComplete: false, interpretation: 'unclear', confidence: 'low' }),
      turn({
        interpretation: 'unclear',
        awaiting: 'open',
        say: 'Je vous écoute, prenez votre temps.',
      }),
    );

    await processTranscriptStreaming(session, 'non mais attends', mgr);
    expect(spoken()).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_100);
    vi.useRealTimers();

    expect(spoken()).toEqual(['Je vous écoute, prenez votre temps.']);
    expect(session.history.map((message) => message.content)).toEqual([
      'non mais attends',
      'Je vous écoute, prenez votre temps.',
    ]);
  });

  describe('minuteur après un tour inachevé (appel 1b3f85e9)', () => {
    const scripted = (outputs: StructuredTurnOutput[]) =>
      outputs.push(
        turn({ turnComplete: false, interpretation: 'unclear', confidence: 'low' }),
        turn({ interpretation: 'unclear', awaiting: 'open', say: 'Je vous écoute.' }),
      );

    it('compte depuis le début du tour, pas depuis la réponse du modèle', async () => {
      vi.useFakeTimers();
      const { session, mgr, outputs } = fixture();
      scripted(outputs);
      await processTranscriptStreaming(session, 'trois non non', mgr);
      await vi.advanceTimersByTimeAsync(1_900);
      expect(spoken()).toEqual([]);
      await vi.advanceTimersByTimeAsync(200);
      vi.useRealTimers();
      expect(spoken()).toEqual(['Je vous écoute.']);
    });

    it('ne répond pas par-dessus l’appelant tant que des mots arrivent, puis répond', async () => {
      vi.useFakeTimers();
      const { session, mgr, outputs } = fixture();
      scripted(outputs);
      await processTranscriptStreaming(session, 'trois non non', mgr);
      session.sttDeepgramPendingInterim = true;
      await vi.advanceTimersByTimeAsync(2_100);
      expect(spoken()).toEqual([]);
      session.sttDeepgramPendingInterim = false;
      await vi.advanceTimersByTimeAsync(800);
      vi.useRealTimers();
      expect(spoken()).toEqual(['Je vous écoute.']);
    });

    it('borne le report : une transcription qui ne vient jamais ne bloque pas la réponse', async () => {
      vi.useFakeTimers();
      const { session, mgr, outputs } = fixture();
      scripted(outputs);
      await processTranscriptStreaming(session, 'trois non non', mgr);
      session.sttDeepgramPendingInterim = true;
      await vi.advanceTimersByTimeAsync(6_000);
      vi.useRealTimers();
      expect(spoken()).toEqual(['Je vous écoute.']);
    });

    it('se règle par VOICE_INCOMPLETE_TURN_SILENCE_MS et ignore une valeur absurde', async () => {
      expect(incompleteTurnSilenceMs({})).toBe(2_000);
      expect(incompleteTurnSilenceMs({ VOICE_INCOMPLETE_TURN_SILENCE_MS: '1200' })).toBe(1_200);
      expect(incompleteTurnSilenceMs({ VOICE_INCOMPLETE_TURN_SILENCE_MS: '50' })).toBe(2_000);
      expect(incompleteTurnSilenceMs({ VOICE_INCOMPLETE_TURN_SILENCE_MS: 'vite' })).toBe(2_000);
      vi.useFakeTimers();
      vi.stubEnv('VOICE_INCOMPLETE_TURN_SILENCE_MS', '1000');
      const { session, mgr, outputs } = fixture();
      scripted(outputs);
      await processTranscriptStreaming(session, 'trois non non', mgr);
      await vi.advanceTimersByTimeAsync(1_100);
      vi.useRealTimers();
      expect(spoken()).toEqual(['Je vous écoute.']);
    });
  });

  it('impose turnComplete=true à la relance et ne dit jamais « pas compris » (appel cdc95509)', async () => {
    vi.useFakeTimers();
    const { session, mgr, outputs } = fixture();
    outputs.push(turn({ turnComplete: false, interpretation: 'unclear' }));
    await processTranscriptStreaming(session, 'bonjour je vous appelle pour', mgr);
    expect(spoken()).toEqual([]);

    // Le modèle rend encore une phrase vide : le filet parle à sa place.
    outputs.push(turn({ turnComplete: true, interpretation: 'unclear', say: '' }));
    await vi.advanceTimersByTimeAsync(2_600);

    const format = vi.mocked(mgr.streamStructuredCompletion).mock.calls.at(-1)?.[2] as {
      json_schema: { schema: { properties: { turnComplete: unknown } } };
    };
    expect(format.json_schema.schema.properties.turnComplete).toEqual({
      type: 'boolean',
      enum: [true],
    });
    expect(spoken()).toEqual([CALLER_FINISHED_FALLBACK]);
    expect(session.history.at(-1)?.content).toBe(CALLER_FINISHED_FALLBACK);
    vi.useRealTimers();
  });

  describe('contexte Cartesia (phrases enchaînées)', () => {
    beforeEach(() => {
      vi.stubEnv('VOICE_TTS_CONTEXT_V2_ENABLED', 'true');
      contextTurn.finish.mockResolvedValue(undefined);
      contextTurn.hasAudioOutput = false;
    });

    it('envoie toutes les phrases d’une réponse dans un seul contexte, sans HTTP', async () => {
      const { session, mgr, outputs } = fixture();
      outputs.push(turn({ awaiting: 'date', say: 'Bien sûr. Pour quel jour ?' }));
      await processTranscriptStreaming(session, 'je voudrais réserver', mgr);

      expect(contextTurn.push.mock.calls.map(([text]) => text)).toEqual([
        'Bien sûr.',
        'Pour quel jour ?',
      ]);
      expect(contextTurn.finish).toHaveBeenCalledTimes(1);
      expect(speakTtsStreamed).not.toHaveBeenCalled();
      expect(session.ttsContext).toBeNull();
    });

    it('repasse par HTTP si le contexte échoue avant tout audio', async () => {
      contextTurn.finish.mockRejectedValueOnce(new Error('socket closed'));
      const { session, mgr, outputs } = fixture();
      outputs.push(turn({ awaiting: 'date', say: 'Bien sûr. Pour quel jour ?' }));
      await processTranscriptStreaming(session, 'je voudrais réserver', mgr);

      expect(spoken()).toEqual(['Bien sûr. Pour quel jour ?']);
    });

    it('ferme sans audio le contexte d’un tour où l’agent se tait', async () => {
      const { session, mgr, outputs } = fixture();
      outputs.push(turn({ turnComplete: false, interpretation: 'unclear' }));
      await processTranscriptStreaming(session, 'je voudrais', mgr);

      expect(contextTurn.cancel).toHaveBeenCalledWith('unused');
      expect(contextTurn.push).not.toHaveBeenCalled();
    });
  });

  describe('spéculation sur partielle stable', () => {
    beforeEach(() => vi.stubEnv('VOICE_STRUCTURED_SPECULATION_ENABLED', 'true'));

    it('reprend la requête lancée sur la partielle quand la phrase finale est identique', async () => {
      const { session, mgr, outputs } = fixture();
      outputs.push(turn({ awaiting: 'date', say: 'Bien sûr. Pour quel jour ?' }));
      speculateStructuredTurn(session, mgr, 'je voudrais réserver');
      expect(spoken()).toEqual([]);

      await processTranscriptStreaming(session, 'je voudrais réserver', mgr);

      expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(1);
      expect(spoken()).toEqual(['Bien sûr.', 'Pour quel jour ?']);
    });

    it('abandonne la spéculation quand la phrase finale diffère', async () => {
      const { session, mgr, outputs } = fixture();
      outputs.push(
        turn({ awaiting: 'date', say: 'Réponse spéculative.' }),
        turn({ awaiting: 'date', say: 'Pour quel jour ?' }),
      );
      speculateStructuredTurn(session, mgr, 'je voudrais');

      await processTranscriptStreaming(session, 'je voudrais réserver une table', mgr);

      expect(mgr.streamStructuredCompletion).toHaveBeenCalledTimes(2);
      expect(spoken()).toEqual(['Pour quel jour ?']);
    });

    it('ne spécule pas pendant que l’agent parle', () => {
      const { session, mgr } = fixture();
      session.state = 'SPEAKING';
      speculateStructuredTurn(session, mgr, 'attendez');
      expect(mgr.streamStructuredCompletion).not.toHaveBeenCalled();
    });
  });

  it('n’utilise pas le moteur hors allowlist', async () => {
    vi.stubEnv('VOICE_STRUCTURED_TURN_RESTAURANT_IDS', 'autre-resto');
    const { session, mgr } = fixture();
    vi.mocked(mgr.processUtteranceStreaming).mockResolvedValue('Bonjour.');

    await processTranscriptStreaming(session, 'bonjour', mgr);

    expect(mgr.streamStructuredCompletion).not.toHaveBeenCalled();
  });
});

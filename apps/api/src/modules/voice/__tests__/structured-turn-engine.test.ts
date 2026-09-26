import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { processTranscriptStreaming } from '../stream/llm-handler';
import { createConversationState } from '../stream/conversation-controller';
import type { StructuredTurnOutput } from '../stream/structured-turn/schema';
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

  it('n’utilise pas le moteur hors allowlist', async () => {
    vi.stubEnv('VOICE_STRUCTURED_TURN_RESTAURANT_IDS', 'autre-resto');
    const { session, mgr } = fixture();
    vi.mocked(mgr.processUtteranceStreaming).mockResolvedValue('Bonjour.');

    await processTranscriptStreaming(session, 'bonjour', mgr);

    expect(mgr.streamStructuredCompletion).not.toHaveBeenCalled();
  });
});

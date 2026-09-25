import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { processTranscriptStreaming } from '../stream/llm-handler';
import {
  buildHumanFallbackOffer,
  createConversationState,
  recordAssistantReplyFromLlmTextFallback as recordAssistantReply,
  recordAssistantReplyWithPolicy,
} from '../stream/conversation-controller';
import { speechActFromUnderstanding } from '../stream/turn-plan-authority';
import type { TurnPlan } from '../stream/turn-plan';
import { startVoiceTurn } from '../stream/turn-telemetry';
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
vi.mock('../stream/fillers-cache', () => ({
  selectRandomGoodbyeText: () => 'Très bien, je n’enregistre rien. Bonne soirée.',
  playFiller: vi.fn(),
}));
vi.mock('../../../shared/logger/pino', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const RESTAURANT_ID = 'resto-pilote';
const CORRECTION_PROMPT = "Qu'est-ce que vous souhaitez corriger";

function plan(overrides: Partial<TurnPlan>): TurnPlan {
  return {
    interpretation: 'answer',
    intent: 'unchanged',
    facts: [],
    slots: {},
    interactionDisposition: 'none',
    confidence: 'high',
    ...overrides,
  };
}

function fixture() {
  const session = {
    callControlId: 'cc-understanding',
    restaurantId: RESTAURANT_ID,
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
    observeTurnPlan: vi.fn(async () => ({ status: 'missing', durationMs: 0 })),
    getAvailability: vi.fn(),
    createReservationFromConversation: vi.fn().mockResolvedValue(null),
    handoffToManager: vi.fn().mockResolvedValue('Je lance le transfert vers le gérant.'),
    recordDialogueFallbackMessage: vi.fn().mockResolvedValue('J’ai bien noté votre message.'),
  } as unknown as CallSessionManager;
  return { session, mgr };
}

function llmReplies(mgr: CallSessionManager, reply: string) {
  vi.mocked(mgr.processUtteranceStreaming).mockImplementation(
    async (session, _transcript, onPhrase) => {
      await onPhrase?.(reply);
      session.history.push({ role: 'assistant', content: reply });
      return reply;
    },
  );
}

function spoken(): string[] {
  return vi.mocked(speakTtsStreamed).mock.calls.map(([, text]) => String(text));
}

function offerHumanFallback(session: CallSession) {
  const offer = buildHumanFallbackOffer(session);
  recordAssistantReplyWithPolicy(session, offer, {
    source: 'explicit',
    operation: 'activate',
    interaction: { kind: 'humanFallback', prompt: offer, fallbackMode: 'choice' },
  });
  session.conversation.humanFallbackOffered = true;
  session.history.push({ role: 'assistant', content: offer });
}

/** L'au revoir attend l'accusé de lecture Telnyx, borné à 15 s. */
async function runUntilHangup(turn: Promise<void>) {
  vi.useFakeTimers();
  try {
    await vi.advanceTimersByTimeAsync(16_000);
    await turn;
  } finally {
    vi.useRealTimers();
  }
}

function enableAuthority() {
  vi.stubEnv('VOICE_DIALOGUE_LISTENING_V2_RESTAURANT_IDS', RESTAURANT_ID);
  vi.stubEnv('VOICE_TURN_PLAN_SHADOW_ENABLED', 'true');
  vi.stubEnv('VOICE_TURN_PLAN_AUTHORITY_ENABLED', 'true');
  vi.stubEnv('VOICE_TURN_PLAN_AUTHORITY_RESTAURANT_IDS', RESTAURANT_ID);
}

beforeEach(() => {
  __resetMetrics();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('speechActFromUnderstanding', () => {
  it.each([
    ['end_call', 'closing'],
    ['correction', 'correction'],
    ['decline', 'content'],
    ['affirmation', 'content'],
    ['answer', 'content'],
  ] as const)('%s → %s', (interpretation, expected) => {
    expect(speechActFromUnderstanding(plan({ interpretation }), 'correction')).toBe(expected);
  });

  it('garde l’acte lexical quand le modèle ne tranche pas', () => {
    expect(speechActFromUnderstanding(plan({ interpretation: 'unclear' }), 'correction')).toBe(
      'correction',
    );
  });
});

describe('TurnPlan avant réponse (appel e3e67025)', () => {
  it('termine poliment quand l’appelant renonce après l’offre gérant/message', async () => {
    enableAuthority();
    const { session, mgr } = fixture();
    offerHumanFallback(session);
    vi.mocked(mgr.observeTurnPlan).mockResolvedValueOnce({
      status: 'valid',
      plan: plan({ interpretation: 'end_call', interactionDisposition: 'cancel' }),
      durationMs: 250,
    });

    await runUntilHangup(
      processTranscriptStreaming(session, 'non non non je préfère rien faire', mgr),
    );

    expect(mgr.observeTurnPlan).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ transcript: 'non non non je préfère rien faire' }),
      null,
      undefined,
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(mgr.processUtteranceStreaming).not.toHaveBeenCalled();
    expect(spoken()).toEqual(['Très bien, je n’enregistre rien. Bonne soirée.']);
    expect(mgr.cleanup).toHaveBeenCalledWith(session);
    expect(spoken().join(' ')).not.toContain(CORRECTION_PROMPT);
  });

  it.each([
    'bon ben on oublie tout',
    'finalement je vais rappeler plus tard',
    'c’est pas grave, je réserverai autrement',
  ])(
    'comprend « %s » après l’offre gérant/message sans que le code connaisse la phrase',
    async (transcript) => {
      enableAuthority();
      const { session, mgr } = fixture();
      offerHumanFallback(session);
      vi.mocked(mgr.observeTurnPlan).mockResolvedValueOnce({
        status: 'valid',
        plan: plan({ interpretation: 'end_call' }),
        durationMs: 200,
      });

      await runUntilHangup(processTranscriptStreaming(session, transcript, mgr));

      expect(mgr.handoffToManager).not.toHaveBeenCalled();
      expect(mgr.recordDialogueFallbackMessage).not.toHaveBeenCalled();
      expect(spoken()).toEqual(['Très bien, je n’enregistre rien. Bonne soirée.']);
    },
  );

  it('laisse la réponse du modèle quand un « non » ne contredit aucune valeur', async () => {
    enableAuthority();
    const { session, mgr } = fixture();
    recordAssistantReply(session, 'Je peux vous passer le gérant. Vous préférez ?');
    vi.mocked(mgr.observeTurnPlan).mockResolvedValueOnce({
      status: 'valid',
      plan: plan({ interpretation: 'correction' }),
      durationMs: 200,
    });
    llmReplies(mgr, 'Très bien, je n’enregistre rien. Bonne soirée.');

    await processTranscriptStreaming(session, 'non je préfère rien faire donc on va', mgr);

    expect(spoken()).toContain('Très bien, je n’enregistre rien. Bonne soirée.');
    expect(spoken().join(' ')).not.toContain(CORRECTION_PROMPT);
  });

  it('conserve le comportement historique sans le flag d’autorité', async () => {
    vi.stubEnv('VOICE_DIALOGUE_LISTENING_V2_RESTAURANT_IDS', RESTAURANT_ID);
    const { session, mgr } = fixture();
    recordAssistantReply(session, 'Je peux vous passer le gérant. Vous préférez ?');
    llmReplies(mgr, 'Très bien, je n’enregistre rien. Bonne soirée.');

    await processTranscriptStreaming(session, 'non je préfère rien faire donc on va', mgr);

    expect(mgr.observeTurnPlan).not.toHaveBeenCalled();
    expect(spoken().join(' ')).toContain(CORRECTION_PROMPT);
  });

  it('ne raccroche pas sur un plan à confiance faible', async () => {
    enableAuthority();
    const { session, mgr } = fixture();
    offerHumanFallback(session);
    vi.mocked(mgr.observeTurnPlan).mockResolvedValueOnce({
      status: 'valid',
      plan: plan({ interpretation: 'end_call', confidence: 'low' }),
      durationMs: 200,
    });
    llmReplies(mgr, 'Souhaitez-vous que je prenne un message pour le gérant ?');

    await processTranscriptStreaming(session, 'bof je sais pas trop', mgr);

    expect(mgr.cleanup).not.toHaveBeenCalled();
  });

  it('retombe sur les règles quand la compréhension échoue', async () => {
    enableAuthority();
    const { session, mgr } = fixture();
    recordAssistantReply(session, 'Je peux vous passer le gérant. Vous préférez ?');
    vi.mocked(mgr.observeTurnPlan).mockResolvedValueOnce({ status: 'failed', durationMs: 1200 });
    llmReplies(mgr, 'D’accord. Autre chose ?');

    await processTranscriptStreaming(session, 'non non', mgr);

    expect(mgr.processUtteranceStreaming).toHaveBeenCalled();
  });
});

describe('TurnPlan après réponse', () => {
  it('garde l’attente du nom quand la question du modèle ne ressemble à aucun motif', async () => {
    enableAuthority();
    const { session, mgr } = fixture();
    session.conversation.intent = 'reservation';
    recordAssistantReply(session, 'Je répète pour confirmer : K, I, F. C’est bien ça ?');
    vi.mocked(mgr.observeTurnPlan)
      .mockResolvedValueOnce({
        status: 'valid',
        plan: plan({ interpretation: 'correction' }),
        durationMs: 200,
      })
      .mockResolvedValueOnce({
        status: 'valid',
        plan: plan({
          interpretation: 'correction',
          interactionDisposition: 'cancel',
          assistantInteraction: 'customerName',
        }),
        durationMs: 300,
      });
    llmReplies(mgr, 'Pas de souci, pouvez-vous me répéter le nom lettre à lettre ?');

    await processTranscriptStreaming(session, 'non', mgr);

    expect(mgr.observeTurnPlan).toHaveBeenLastCalledWith(
      session,
      expect.objectContaining({ transcript: 'non' }),
      'Pas de souci, pouvez-vous me répéter le nom lettre à lettre ?',
      undefined,
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(session.conversation.pendingQuestion).toBe('customerName');
  });

  it('marque une boucle quand l’agent répète mot pour mot sa réponse', async () => {
    enableAuthority();
    const { session, mgr } = fixture();
    session.conversation.intent = 'reservation';
    const reply = 'Pour combien de personnes souhaitez-vous réserver ?';
    recordAssistantReply(session, reply);
    session.history.push({ role: 'assistant', content: reply });
    startVoiceTurn(session, 'euh attendez');
    llmReplies(mgr, reply);

    await processTranscriptStreaming(session, 'euh attendez je regarde', mgr);

    expect(session.currentTurn?.loopDetected).toBe(true);
  });
});

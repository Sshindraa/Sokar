import { describe, expect, it, vi } from 'vitest';
import {
  extractRestaurantName,
  handleSttEvent,
  invalidatePendingVoiceResponse,
} from '../stream/llm-handler';
import type { CallSession } from '../stream/types';
import type { CallSessionManager } from '../stream/manager';
import { createConversationState } from '../stream/conversation-controller';

const session = {
  systemPrompt: "Tu es l'assistant vocal de Test Restaurant.",
} as CallSession;

describe('extractRestaurantName', () => {
  it('accepte le préfixe de prompt chaleureux', () => {
    expect(extractRestaurantName("Tu es l'assistant vocal chaleureux de Chez Michel.")).toBe(
      'Chez Michel',
    );
  });

  it('retire les consignes internes accolées au nom du restaurant', () => {
    expect(
      extractRestaurantName(
        "Tu es l'assistant vocal chaleureux de Chez Michel. L'accueil a déjà été prononcé avant le premier message de l'appelant. Tu ne le répètes jamais.",
      ),
    ).toBe('Chez Michel');
  });
});

describe('handleSttEvent — interruption pendant le traitement', () => {
  it.each(['UtteranceStart', 'SpeechResumed'] as const)(
    '%s invalide définitivement la réponse en préparation',
    (eventType) => {
      const abortController = new AbortController();
      const abortSpy = vi.spyOn(abortController, 'abort');
      const interruptedSession = {
        state: 'PROCESSING',
        responseGeneration: 4,
        abortController,
        conversation: { toolInFlight: 'checkAvailability' },
      } as CallSession;
      const mgr = {
        transition: vi.fn((target: CallSession, state: CallSession['state']) => {
          target.state = state;
          return true;
        }),
      } as unknown as CallSessionManager;

      handleSttEvent({ type: eventType }, interruptedSession, mgr);

      expect(abortSpy).toHaveBeenCalledOnce();
      expect(interruptedSession.responseGeneration).toBe(5);
      expect(interruptedSession.state).toBe('LISTENING');
      expect(interruptedSession.conversation.toolInFlight).toBeNull();
    },
  );
});

describe('reprise de final STT', () => {
  function telemetrySession(state: CallSession['state'] = 'SPEAKING'): CallSession {
    const startedAt = Date.now() - 3_000;
    const latencyTrace = {
      startTime: startedAt,
      speechStartedAt: startedAt,
      sttFinalAt: startedAt + 1_000,
    };
    return {
      callControlId: 'cc-latency-test',
      callLegId: 'leg-latency-test',
      restaurantId: 'rest-latency-test',
      state,
      ended: false,
      ending: false,
      handoffInProgress: false,
      telnyxWs: { readyState: WebSocket.OPEN },
      restaurantName: 'Test',
      sttProviderUsed: 'deepgram-nova-3',
      voiceFeatureSnapshot: {
        deepgramModel: 'nova-3',
      },
      conversation: createConversationState(),
      history: [],
      transcript: '',
      turnTranscript: '',
      turnCount: 0,
      currentTurn: {
        id: 'old-turn',
        sequence: 1,
        startedAt,
        transcriptLength: 14,
        transcriptFingerprint: 'old-fingerprint',
        path: 'llm',
        availabilitySearches: 0,
        availabilityFailures: 0,
        loopDetected: false,
        completed: false,
        eventSequence: 0,
        latencyTrace,
      },
      latencyTrace,
      voiceTurnHistory: [],
      lastProcessedTranscript: 'Première demande',
      lastProcessedAt: Date.now() - 2_000,
      lastProcessedDialogueContext: 'old-step',
      responseGeneration: 4,
      ttsGeneration: 2,
      speculativeTranscript: '',
      sttEvidence: null,
    } as unknown as CallSession;
  }

  it('donne un nouveau turnId à un final distinct et garde sa mesure cohérente', () => {
    const session = telemetrySession();
    const previousTurnId = session.currentTurn?.id;
    const speechEndAt = Date.now() - 350;
    const sttFinalAt = Date.now();
    const manager = {} as CallSessionManager;

    handleSttEvent(
      {
        type: 'UtteranceEnd',
        transcript: 'Pour samedi soir',
        speechEndAt,
        sttFinalAt,
        turnDispatchedAt: sttFinalAt,
      },
      session,
      manager,
    );

    expect(session.currentTurn?.id).not.toBe(previousTurnId);
    expect(session.voiceTurnHistory?.[0]?.id).toBe(previousTurnId);
    expect(session.currentTurn?.sttProvider).toBe('deepgram-nova-3');
    expect(session.latencyTrace?.endOfSpeechToSttFinalMs).toBe(sttFinalAt - speechEndAt);
  });

  it('ignore un même final dans la même étape sans réécrire le turnId', () => {
    const session = telemetrySession();
    const turnId = session.currentTurn?.id;
    session.lastProcessedTranscript = 'Pour samedi soir';
    session.lastProcessedAt = Date.now();
    session.lastProcessedDialogueContext = `${session.conversation.pendingQuestion ?? ''}|${session.conversation.lastAssistantQuestion ?? ''}`;

    handleSttEvent(
      { type: 'UtteranceEnd', transcript: 'Pour samedi soir' },
      session,
      {} as CallSessionManager,
    );

    expect(session.currentTurn?.id).toBe(turnId);
    expect(session.transcript).toBe('');
  });

  it('annule génération et contexte TTS quand une réponse est remplacée', () => {
    const session = telemetrySession('PROCESSING');
    const controller = new AbortController();
    const abort = vi.spyOn(controller, 'abort');
    const cancel = vi.fn();
    session.abortController = controller;
    session.ttsContext = { cancel };
    session.conversation.toolInFlight = 'checkAvailability';
    const manager = {
      transition(target: CallSession, state: CallSession['state']) {
        target.state = state;
      },
    } as unknown as CallSessionManager;

    expect(invalidatePendingVoiceResponse(session, manager)).toBe(true);
    expect(abort).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(session.responseGeneration).toBe(5);
    expect(session.ttsGeneration).toBe(3);
    expect(session.conversation.toolInFlight).toBeNull();
    expect(session.state).toBe('LISTENING');
  });
});

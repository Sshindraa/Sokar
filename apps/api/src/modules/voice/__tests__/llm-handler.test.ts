import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyVoiceLanguageLock,
  buildLivenessResponse,
  canRecoverNonFrenchReservationTurn,
  extractRestaurantName,
  handleSttEvent,
  invalidatePendingVoiceResponse,
  LLM_FILLER_DELAY_MS,
  stripRepeatedGreeting,
} from '../stream/llm-handler';
import type { CallSession } from '../stream/types';
import type { CallSessionManager } from '../stream/manager';
import {
  createConversationState,
  extractConversationSlots,
} from '../stream/conversation-controller';
import { effectiveVoiceLanguage, effectiveVoiceLocale } from '../stream/voice-language';

const session = {
  systemPrompt: "Tu es l'assistant vocal de Test Restaurant.",
} as CallSession;

describe('stripRepeatedGreeting', () => {
  it('retire la formule historique d’enregistrement répétée par le LLM', () => {
    expect(
      stripRepeatedGreeting(
        'Bonjour, Test Restaurant, cet appel peut être enregistré à des fins de qualité de service. En quoi puis-je vous aider ?',
        session,
      ),
    ).toBe('');
  });

  it('retire la formule de consentement actuelle avant la réponse utile', () => {
    expect(
      stripRepeatedGreeting(
        'Bonjour, Test Restaurant. Cet appel est enregistré à des fins de qualité de service et conservé au maximum trente jours. En quoi puis-je vous aider ? Pour quelle date souhaitez-vous réserver ?',
        session,
      ),
    ).toBe('Pour quelle date souhaitez-vous réserver ?');
  });

  it('conserve une réponse qui ne répète pas l’accueil', () => {
    expect(
      stripRepeatedGreeting('Pour combien de personnes souhaitez-vous réserver ?', session),
    ).toBe('Pour combien de personnes souhaitez-vous réserver ?');
  });

  it('retire une relance générique isolée émise après l’accueil', () => {
    expect(stripRepeatedGreeting('En quoi puis-je vous aider ?', session)).toBe('');
  });

  it('retire un second bonjour tout en conservant la réponse utile', () => {
    expect(stripRepeatedGreeting('Bonjour ! Très bien, pour combien de personnes ?', session)).toBe(
      'Très bien, pour combien de personnes ?',
    );
  });

  it('attend une seconde avant un filler de recherche de disponibilité', () => {
    expect(LLM_FILLER_DELAY_MS).toBe(1_000);
  });
});

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

describe('buildLivenessResponse', () => {
  it('reprend la dernière question pour un « allô » en cours d’appel', () => {
    const inProgressSession = {
      ...session,
      history: [
        { role: 'system', content: session.systemPrompt },
        { role: 'user', content: 'Pour 20 h 30, c’est possible ?' },
        { role: 'assistant', content: 'Quel est votre nom pour la réservation ?' },
      ],
    } as CallSession;

    expect(buildLivenessResponse(inProgressSession, 'Allô ?')).toBe(
      'Oui, je suis là. Quel est votre nom pour la réservation ?',
    );
  });

  it('ne transforme pas le premier « allô » d’un appel en reprise de contexte', () => {
    const newSession = {
      ...session,
      history: [{ role: 'system', content: session.systemPrompt }],
    } as CallSession;

    expect(buildLivenessResponse(newSession, 'Allô')).toBeNull();
  });
});

describe('verrou français applicatif', () => {
  afterEach(() => vi.unstubAllEnvs());

  function makeLockSession(pendingQuestion: 'time' | 'partySize' = 'time'): CallSession {
    return {
      voiceLanguageCode: 'en',
      voiceLanguageCandidate: { code: 'en', count: 1 },
      sttRelockPending: false,
      forceFrenchReprompt: false,
      abortController: null,
      speculativeLlm: null,
      speculativeResult: null,
      speculativeTranscript: '',
      timezone: 'Europe/Paris',
      conversation: {
        intent: 'reservation',
        slots: {},
        pendingQuestion,
      },
    } as unknown as CallSession;
  }

  it('ne verrouille pas sur un « oui » isolé, puis pose le verrou après deux mots FR', () => {
    vi.stubEnv('VOICE_STT_LANGUAGE_LOCK', 'true');
    const session = makeLockSession();

    expect(applyVoiceLanguageLock(session, 'oui', 'fr').lockedNow).toBe(false);
    expect(session.languageLocked).toBeUndefined();

    expect(applyVoiceLanguageLock(session, 'Je souhaite réserver', 'fr').lockedNow).toBe(true);
    expect(session.languageLocked).toBe('fr');
    expect(session.voiceLanguageCode).toBe('fr');
    expect(session.sttRelockPending).toBe(true);
  });

  it('ne modifie rien lorsque le flag est coupé', () => {
    vi.stubEnv('VOICE_STT_LANGUAGE_LOCK', 'false');
    const session = makeLockSession();

    expect(applyVoiceLanguageLock(session, 'Je souhaite réserver', 'fr')).toEqual({
      lockedNow: false,
    });
    expect(session.languageLocked).toBeUndefined();
    expect(session.voiceLanguageCode).toBe('en');
    expect(session.sttRelockPending).toBe(false);
  });

  it('garde le français pour LLM et Cartesia malgré une détection ultérieure en anglais', () => {
    const session = {
      languageLocked: 'fr',
      sttLanguageCode: 'en',
      voiceLanguageCode: 'en',
    } as CallSession;

    expect(effectiveVoiceLanguage(session)).toBe('fr');
    expect(effectiveVoiceLocale(session)).toBe('fr-FR');
  });

  it('récupère la valeur anglaise attendue sans changer la langue verrouillée', () => {
    vi.stubEnv('VOICE_STT_LANGUAGE_LOCK', 'true');
    const session = makeLockSession('time');
    session.languageLocked = 'fr';

    expect(extractConversationSlots('At 11:00', 'Europe/Paris').time).toBe('11:00');
    expect(canRecoverNonFrenchReservationTurn(session, 'At 11:00')).toBe(true);
    expect(applyVoiceLanguageLock(session, 'At 11:00', 'en')).toEqual({
      lockedNow: false,
      nonFrenchOutcome: 'parsed',
    });
    expect(session.voiceLanguageCode).toBe('fr');
    expect(session.forceFrenchReprompt).toBe(false);
  });

  it('reconnaît les couverts anglais et marque un tour non récupérable pour relance FR', () => {
    vi.stubEnv('VOICE_STT_LANGUAGE_LOCK', 'true');
    const partySession = makeLockSession('partySize');
    partySession.languageLocked = 'fr';
    expect(canRecoverNonFrenchReservationTurn(partySession, 'six people')).toBe(true);

    const timeSession = makeLockSession('time');
    timeSession.languageLocked = 'fr';
    expect(applyVoiceLanguageLock(timeSession, 'Zo gaat ie', 'nl')).toEqual({
      lockedNow: false,
      nonFrenchOutcome: 'reprompt',
    });
    expect(timeSession.forceFrenchReprompt).toBe(true);
    expect(timeSession.voiceLanguageCode).toBe('fr');
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
        speculativeLlm: Promise.resolve('ancienne réponse'),
        speculativeResult: 'ancienne réponse',
        speculativeTranscript: 'je voudrais réserver',
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
      expect(interruptedSession.speculativeLlm).toBeNull();
      expect(interruptedSession.speculativeResult).toBeNull();
      expect(interruptedSession.speculativeTranscript).toBe('');
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
        sttProvider: 'deepgram',
        dialogueListeningV2Enabled: true,
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
        sttProvider: 'deepgram-nova-3',
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

describe('handleSttEvent — pré-réflexion LLM', () => {
  it('prépare une réponse sans changer l’état ni l’historique avant la fin confirmée', () => {
    const previous = process.env.SPECULATIVE_LLM_ENABLED;
    process.env.SPECULATIVE_LLM_ENABLED = 'true';
    const speculativeSession = {
      ...session,
      state: 'LISTENING',
      history: [{ role: 'system', content: session.systemPrompt }],
      speculativeLlm: null,
      speculativeResult: null,
      speculativeTranscript: 'Non non merci au revoir',
      abortController: null,
    } as CallSession;
    const mgr = {
      prepareSpeculativeReply: vi.fn().mockResolvedValue('Avec plaisir, bonne soirée !'),
    } as unknown as CallSessionManager;

    handleSttEvent(
      { type: 'InterimHighConfidence', transcript: 'Non non merci au revoir' },
      speculativeSession,
      mgr,
    );

    expect(mgr.prepareSpeculativeReply).toHaveBeenCalledOnce();
    expect(speculativeSession.state).toBe('LISTENING');
    expect(speculativeSession.history).toHaveLength(1);
    expect(speculativeSession.abortController).toBeInstanceOf(AbortController);

    if (previous === undefined) delete process.env.SPECULATIVE_LLM_ENABLED;
    else process.env.SPECULATIVE_LLM_ENABLED = previous;
  });
});

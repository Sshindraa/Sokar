import { describe, expect, it, vi } from 'vitest';
import { takeAvailabilityPrefetch } from '../stream/availability-prefetch';
import { createConversationState } from '../stream/conversation-controller';
import {
  buildLivenessResponse,
  extractRestaurantName,
  handleSttEvent,
  LLM_FILLER_DELAY_MS,
  stripLeadingAcknowledgement,
  stripRepeatedGreeting,
} from '../stream/llm-handler';
import type { CallSession } from '../stream/types';
import type { CallSessionManager } from '../stream/manager';

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
      } as unknown as CallSession;
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

describe('handleSttEvent — pré-chargement des disponibilités', () => {
  function prefetchSession(): CallSession {
    const conversation = createConversationState();
    conversation.intent = 'reservation';
    conversation.slots.date = '2026-10-01';
    return {
      ...session,
      state: 'LISTENING',
      timezone: 'Europe/Paris',
      history: [{ role: 'system', content: session.systemPrompt }],
      conversation,
      availabilityPrefetch: null,
    } as CallSession;
  }

  it('lance la lecture dès que date, heure et nombre de personnes sont connus', () => {
    const prefetchedSession = prefetchSession();
    const result = { date: '2026-10-01', partySize: 4, slots: ['20:00'] };
    const mgr = {
      getAvailability: vi.fn().mockResolvedValue(result),
    } as unknown as CallSessionManager;

    handleSttEvent(
      { type: 'PartialTranscript', transcript: 'pour quatre personnes' },
      prefetchedSession,
      mgr,
    );
    expect(mgr.getAvailability).not.toHaveBeenCalled();

    handleSttEvent(
      { type: 'PartialTranscript', transcript: 'pour quatre personnes à vingt heures' },
      prefetchedSession,
      mgr,
    );
    handleSttEvent(
      {
        type: 'PartialTranscript',
        transcript: 'pour quatre personnes à vingt heures s’il vous plaît',
      },
      prefetchedSession,
      mgr,
    );

    expect(mgr.getAvailability).toHaveBeenCalledOnce();
    expect(mgr.getAvailability).toHaveBeenCalledWith(prefetchedSession, '2026-10-01', 4);
    expect(prefetchedSession.state).toBe('LISTENING');
    expect(prefetchedSession.history).toHaveLength(1);
    expect(prefetchedSession.conversation.slots.partySize).toBeUndefined();
  });

  it('réutilise le résultat seulement si date et nombre de personnes correspondent', async () => {
    const prefetchedSession = prefetchSession();
    const result = { date: '2026-10-01', partySize: 4, slots: ['20:00'] };
    const mgr = {
      getAvailability: vi.fn().mockResolvedValue(result),
    } as unknown as CallSessionManager;
    handleSttEvent(
      { type: 'PartialTranscript', transcript: 'pour quatre personnes à vingt heures' },
      prefetchedSession,
      mgr,
    );

    expect(takeAvailabilityPrefetch(prefetchedSession, '2026-10-01', 5)).toBeNull();
    handleSttEvent(
      { type: 'PartialTranscript', transcript: 'pour quatre personnes à vingt heures' },
      prefetchedSession,
      mgr,
    );
    await expect(takeAvailabilityPrefetch(prefetchedSession, '2026-10-01', 4)).resolves.toEqual(
      result,
    );
    expect(takeAvailabilityPrefetch(prefetchedSession, '2026-10-01', 4)).toBeNull();
  });

  it('ne pré-charge rien pendant la collecte du nom', () => {
    const prefetchedSession = prefetchSession();
    prefetchedSession.conversation.pendingQuestion = 'customerName';
    const mgr = { getAvailability: vi.fn() } as unknown as CallSessionManager;
    handleSttEvent(
      { type: 'PartialTranscript', transcript: 'pour quatre personnes à vingt heures' },
      prefetchedSession,
      mgr,
    );
    expect(mgr.getAvailability).not.toHaveBeenCalled();
  });
});

describe('stripLeadingAcknowledgement', () => {
  it.each([
    ["D'accord, vous serez combien ?", 'Vous serez combien ?'],
    ['Très bien. Et à quelle heure ?', 'Et à quelle heure ?'],
    ['Oui, bien sûr ! Pour quand ?', 'Pour quand ?'],
    ['Okay, what time?', 'What time?'],
    ['Entendu', ''],
    ['Superbe terrasse, oui.', 'Superbe terrasse, oui.'],
    ['Vous serez combien ?', 'Vous serez combien ?'],
  ])('%s → %s', (input, expected) => {
    expect(stripLeadingAcknowledgement(input)).toBe(expected);
  });
});

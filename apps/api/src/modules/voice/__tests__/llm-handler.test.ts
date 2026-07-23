import { describe, expect, it, vi } from 'vitest';
import {
  buildLivenessResponse,
  extractRestaurantName,
  handleFluxEvent,
  LLM_FILLER_DELAY_MS,
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

describe('handleFluxEvent — interruption pendant le traitement', () => {
  it.each(['UtteranceStart', 'SpeechResumed'] as const)(
    '%s invalide définitivement la réponse en préparation',
    (eventType) => {
      const abortController = new AbortController();
      const abortSpy = vi.spyOn(abortController, 'abort');
      const interruptedSession = {
        state: 'PROCESSING',
        responseGeneration: 4,
        ttsGeneration: 2,
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

      handleFluxEvent({ type: eventType }, interruptedSession, mgr);

      expect(abortSpy).toHaveBeenCalledOnce();
      expect(interruptedSession.responseGeneration).toBe(5);
      expect(interruptedSession.ttsGeneration).toBe(3);
      expect(interruptedSession.state).toBe('LISTENING');
      expect(interruptedSession.conversation.toolInFlight).toBeNull();
      expect(interruptedSession.speculativeLlm).toBeNull();
      expect(interruptedSession.speculativeResult).toBeNull();
      expect(interruptedSession.speculativeTranscript).toBe('');
    },
  );
});

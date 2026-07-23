import { describe, expect, it, vi } from 'vitest';

vi.mock('../stream/fillers-cache', () => ({ playFiller: vi.fn() }));
vi.mock('../stream/tts-handler', () => ({
  isSessionActiveForTts: vi.fn(),
  speakTtsStreamed: vi.fn(),
}));
vi.mock('../../../shared/logger/pino', () => ({ logger: { error: vi.fn() } }));
vi.mock('../../../shared/sentry/client', () => ({ captureException: vi.fn() }));
vi.mock('../stream/debug-log', () => ({ writeDebugLog: vi.fn() }));

import {
  buildLivenessResponse,
  handleFluxEvent,
  queueTtsPlayback,
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

describe('queueTtsPlayback', () => {
  it('joue les phrases dans leur ordre sans mélanger leurs flux audio', async () => {
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queueTtsPlayback(Promise.resolve(), async () => {
      events.push('first:start');
      await firstDone;
      events.push('first:end');
    });
    const second = queueTtsPlayback(first, async () => {
      events.push('second:start');
      events.push('second:end');
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    releaseFirst?.();
    await second;

    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('continue avec la phrase suivante si une synthèse précédente échoue', async () => {
    const events: string[] = [];
    const rejected = Promise.reject(new Error('Cartesia unavailable'));
    rejected.catch(() => undefined);

    await queueTtsPlayback(rejected, async () => {
      events.push('next:played');
    });

    expect(events).toEqual(['next:played']);
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
        abortController,
        speculativeLlm: Promise.resolve('ancienne réponse'),
        speculativeResult: 'ancienne réponse',
        speculativeTranscript: 'je voudrais réserver',
      } as CallSession;
      const mgr = {
        transition: vi.fn((target: CallSession, state: CallSession['state']) => {
          target.state = state;
          return true;
        }),
        handleBargeIn: vi.fn(),
      } as unknown as CallSessionManager;

      handleFluxEvent({ type: eventType }, interruptedSession, mgr);

      expect(abortSpy).toHaveBeenCalledOnce();
      expect(interruptedSession.responseGeneration).toBe(5);
      expect(interruptedSession.state).toBe('LISTENING');
      expect(interruptedSession.speculativeLlm).toBeNull();
      expect(interruptedSession.speculativeResult).toBeNull();
      expect(interruptedSession.speculativeTranscript).toBe('');
    },
  );
});

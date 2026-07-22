import { describe, expect, it, vi } from 'vitest';

vi.mock('../stream/fillers-cache', () => ({ playFiller: vi.fn() }));
vi.mock('../stream/tts-handler', () => ({
  isSessionActiveForTts: vi.fn(),
  speakTtsStreamed: vi.fn(),
}));
vi.mock('../../../shared/logger/pino', () => ({ logger: { error: vi.fn() } }));
vi.mock('../../../shared/sentry/client', () => ({ captureException: vi.fn() }));
vi.mock('../stream/debug-log', () => ({ writeDebugLog: vi.fn() }));

import { queueTtsPlayback, stripRepeatedGreeting } from '../stream/llm-handler';
import type { CallSession } from '../stream/types';

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

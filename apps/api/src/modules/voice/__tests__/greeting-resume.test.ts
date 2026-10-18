import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { CallSessionManager } from '../stream/manager';
import { resumeInterruptedGreeting } from '../stream/greeting-resume';
import { handleNormalizedSttMessage } from '../stream/stt-bridge';
import { createDeepgramSttAdapter } from '../stream/stt-provider-adapter';
import { speakTtsStreamed } from '../stream/tts-handler';

vi.mock('../stream/tts-handler', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stream/tts-handler')>()),
  speakTtsStreamed: vi.fn().mockResolvedValue(undefined),
}));

function makeSession() {
  return CallSessionManager.getInstance().create({
    callControlId: 'cc-greeting-1',
    callSessionId: 'cs-greeting-1',
    from: '+33****0001',
    to: '+33****0000',
    restaurantId: 'rest-1',
    restaurantName: 'Test',
    systemPrompt: 'Assistant vocal de Test.',
    isVip: false,
    telnyxWs: {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
    } as unknown as WebSocket,
    callLegId: 'leg-greeting-1',
    codec: 'PCMU',
  });
}

describe('reprise de l’accueil coupé par un bruit', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reprend la partie non entendue', async () => {
    const session = makeSession();
    session.greetingText = 'Bonjour, ici Test. Je vous écoute.';
    session.greetingInterrupted = true;
    session.interruptedReply = {
      said: session.greetingText,
      heard: 'Bonjour, ici Test.',
      unheard: 'Je vous écoute.',
    };
    session.state = 'LISTENING';
    resumeInterruptedGreeting(session);
    expect(speakTtsStreamed).toHaveBeenCalledWith(session, 'Je vous écoute.');
    expect(session.greetingInterrupted).toBe(false);
  });

  it('reprend tout l’accueil quand la coupure n’a pas été mesurée', () => {
    const session = makeSession();
    session.greetingText = 'Bonjour, ici Test. Je vous écoute.';
    session.greetingInterrupted = true;
    session.state = 'LISTENING';
    resumeInterruptedGreeting(session);
    expect(speakTtsStreamed).toHaveBeenCalledWith(session, 'Bonjour, ici Test. Je vous écoute.');
  });

  it('ne dit rien quand tout a été entendu, ni quand l’accueil n’a pas été coupé', () => {
    const session = makeSession();
    session.greetingText = 'Bonjour.';
    session.state = 'LISTENING';
    resumeInterruptedGreeting(session);
    session.greetingInterrupted = true;
    session.interruptedReply = { said: 'Bonjour.', heard: 'Bonjour.', unheard: '' };
    resumeInterruptedGreeting(session);
    expect(speakTtsStreamed).not.toHaveBeenCalled();
  });

  it('à travers le pont STT : le mot « rouge » qui suit une coupure rend l’accueil, sans tour', () => {
    const session = makeSession();
    session.voiceFeatureSnapshot = {
      sttProvider: 'deepgram',
      dialogueListeningV2Enabled: true,
      deepgramModel: 'nova-3',
      deepgramNumeralsEnabled: true,
      deepgramPunctuateEnabled: false,
      deepgramKeytermsEnabled: false,
    };
    session.sttAdapter = createDeepgramSttAdapter({ model: 'nova-3' });
    const onEvent = vi.fn();
    session.onSttEvent = onEvent;
    session.greetingText = 'Bonjour, ici Test. Je vous écoute.';
    session.greetingInterrupted = true;
    session.interruptedReply = {
      said: session.greetingText,
      heard: 'Bonjour, ici Test.',
      unheard: 'Je vous écoute.',
    };
    session.state = 'LISTENING';

    handleNormalizedSttMessage(session, {
      type: 'final_segment',
      transcript: 'rouge',
      words: [{ word: 'rouge', confidence: 0.278, start: 0.48, end: 0.88 }],
      speechFinal: true,
      speechEndOffsetMs: 880,
    });

    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UtteranceEnd' }));
    expect(speakTtsStreamed).toHaveBeenCalledWith(session, 'Je vous écoute.');
  });
});

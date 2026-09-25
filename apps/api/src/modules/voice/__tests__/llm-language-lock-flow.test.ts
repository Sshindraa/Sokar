import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { applyVoiceLanguageLock, processTranscriptStreaming } from '../stream/llm-handler';
import { recordUserTurn } from '../stream/conversation-controller';
import { CallSessionManager } from '../stream/manager';
import type { CallSession } from '../stream/types';
import { effectiveVoiceLanguage } from '../stream/voice-language';

const mocks = vi.hoisted(() => ({ speak: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../stream/tts-handler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stream/tts-handler')>();
  return { ...actual, speakTtsStreamed: mocks.speak };
});

describe('parcours du verrou français', () => {
  let manager: CallSessionManager;
  let session: CallSession;

  beforeEach(() => {
    vi.stubEnv('VOICE_STT_LANGUAGE_LOCK', 'true');
    manager = CallSessionManager.getInstance();
    const telnyxWs = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
      close: vi.fn(),
    } as unknown as WebSocket;
    session = manager.create({
      callControlId: 'language-lock-flow-test',
      callSessionId: 'language-lock-flow-test',
      from: '+33****0001',
      to: '+33****0000',
      restaurantId: 'language-lock-test',
      restaurantName: 'Test',
      systemPrompt: 'Assistant vocal de test.',
      isVip: false,
      telnyxWs,
      callLegId: 'language-lock-flow-test',
      codec: 'PCMU',
    });
    session.languageLocked = 'fr';
    session.voiceLanguageCode = 'fr';
    session.conversation.intent = 'reservation';
    session.conversation.pendingQuestion = 'time';
    mocks.speak.mockClear();
  });

  afterEach(() => {
    manager.delete(session.callControlId);
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('applique l’heure extraite de « At 11:00 » dans le brouillon FR', () => {
    session.conversation.slots.date = '2026-10-03';
    session.conversation.slots.partySize = 2;
    recordUserTurn(session, 'At 11:00', 'content');

    expect(session.conversation.slots.time).toBe('11:00');
    expect(effectiveVoiceLanguage(session)).toBe('fr');
  });

  it('relance en français après un transcript non-FR incompréhensible sans perdre la question', async () => {
    applyVoiceLanguageLock(session, 'Zo gaat ie', 'nl');
    expect(session.forceFrenchReprompt).toBe(true);

    await processTranscriptStreaming(session, 'Zo gaat ie', manager);

    expect(mocks.speak).toHaveBeenCalledWith(
      session,
      expect.stringContaining('répondre en français'),
    );
    expect(session.history.at(-1)?.content).toContain('en français');
    expect(session.conversation.pendingQuestion).toBe('time');
    expect(session.state).toBe('LISTENING');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { acknowledgeCallEnding, finishCall, isExplicitCallEnd } from '../stream/call-ending';
import { handleFluxEvent, processTranscriptStreaming } from '../stream/llm-handler';
import { createConversationState } from '../stream/conversation-controller';
import type { CallSession } from '../stream/types';
import type { CallSessionManager } from '../stream/manager';
import { speakTtsStreamed } from '../stream/tts-handler';
import { telnyxFetch } from '../../../shared/telnyx/http-agent';

vi.mock('../stream/tts-handler', () => ({
  speakTtsStreamed: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../shared/telnyx/http-agent', () => ({
  telnyxFetch: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../stream/fillers-cache', () => ({
  selectRandomGoodbyeText: () => 'Au revoir.',
  playFiller: vi.fn(),
}));
vi.mock('../../../shared/logger/pino', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function fixture() {
  const session = {
    callControlId: 'cc-ending',
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
    getAvailability: vi.fn(),
  } as unknown as CallSessionManager;
  return { session, mgr };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it.each(['Au revoir', 'Merci, au revoir', 'C’est tout, merci', 'Je raccroche', 'À demain'])(
  'termine sur %s',
  (text) => {
    expect(isExplicitCallEnd(text)).toBe(true);
  },
);
it.each([
  'Merci',
  'Non merci',
  'Oui, c’est correct',
  'Au revoir, mais attendez finalement cinq personnes',
  'Attendez, je voulais dire cinq personnes',
])('garde la conversation sur %s', (text) => {
  expect(isExplicitCallEnd(text)).toBe(false);
});

describe('farewell playback and hangup', () => {
  it('attend la fin réelle du TTS puis le bon mark, bloque les transcripts et ne raccroche qu’une fois', async () => {
    const { session, mgr } = fixture();
    let resolveTts!: () => void;
    vi.mocked(speakTtsStreamed).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveTts = resolve;
        }),
    );
    const done = finishCall(session, mgr, 'Au revoir.');
    expect(session.state).toBe('CLOSING');
    expect(telnyxFetch).not.toHaveBeenCalled();
    handleFluxEvent({ type: 'UtteranceEnd', transcript: 'Nova' }, session, mgr);
    await processTranscriptStreaming(session, 'Nova', mgr);
    expect(mgr.processUtteranceStreaming).not.toHaveBeenCalled();
    resolveTts();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.telnyxWs.send).toHaveBeenLastCalledWith(
      JSON.stringify({ event: 'mark', mark: { name: session.ending!.markName } }),
    );
    acknowledgeCallEnding(session, 'old-mark-flushed-by-clear');
    expect(telnyxFetch).not.toHaveBeenCalled();
    acknowledgeCallEnding(session, session.ending!.markName);
    await done;
    await finishCall(session, mgr, 'Au revoir.');
    expect(telnyxFetch).toHaveBeenCalledOnce();
    expect(mgr.cleanup).toHaveBeenCalledOnce();
    expect(session.ended).toBe(true);
  });

  it('attend le webhook natif au lieu d’un mark sur une file vide', async () => {
    const { session, mgr } = fixture();
    vi.mocked(speakTtsStreamed).mockImplementationOnce(async (s) => {
      s.ending!.nativePlayback = true;
    });
    const done = finishCall(session, mgr, 'Au revoir.');
    await vi.advanceTimersByTimeAsync(0);
    expect(session.telnyxWs.send).toHaveBeenCalledTimes(1); // clear only
    expect(telnyxFetch).not.toHaveBeenCalled();
    acknowledgeCallEnding(session, session.ending!.markName);
    await done;
    expect(telnyxFetch).toHaveBeenCalledOnce();
  });

  it('ne reste pas silencieux indéfiniment si le mark est perdu', async () => {
    const { session, mgr } = fixture();
    const done = finishCall(session, mgr, 'Au revoir.');
    await vi.advanceTimersByTimeAsync(15_001);
    await done;
    expect(telnyxFetch).toHaveBeenCalledOnce();
  });

  it('réessaie le hangup avec le même command_id après une erreur réseau', async () => {
    const { session, mgr } = fixture();
    vi.mocked(telnyxFetch).mockRejectedValueOnce(new Error('network'));
    const done = finishCall(session, mgr, 'Au revoir.');
    await vi.advanceTimersByTimeAsync(0);
    acknowledgeCallEnding(session, session.ending!.markName);
    await done;
    expect(telnyxFetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(telnyxFetch).mock.calls[0][1]?.body).toBe(
      vi.mocked(telnyxFetch).mock.calls[1][1]?.body,
    );
  });

  it('ne raccroche pas sur merci pendant une collecte de réservation', async () => {
    const { session, mgr } = fixture();
    session.conversation.lastAssistantQuestion = 'Pour combien de personnes ?';
    await processTranscriptStreaming(session, 'Merci', mgr);
    expect(session.ending).toBeUndefined();
    expect(telnyxFetch).not.toHaveBeenCalled();
    expect(session.state).toBe('LISTENING');
  });

  it('clarifie un transcript ambigu après le départ au lieu d’inventer une annulation', async () => {
    const { session, mgr } = fixture();
    session.history.push({
      role: 'assistant',
      content: 'Votre réservation est confirmée. Au revoir et à demain.',
    });
    await processTranscriptStreaming(session, 'Nova', mgr);
    expect(speakTtsStreamed).toHaveBeenCalledWith(
      session,
      expect.stringContaining('Vous souhaitiez ajouter'),
    );
    expect(mgr.processUtteranceStreaming).not.toHaveBeenCalled();
    expect(session.ending).toBeUndefined();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { acknowledgeCallEnding, finishCall } from '../stream/call-ending';
import { handleSttEvent, processTranscriptStreaming } from '../stream/llm-handler';
import { createConversationState } from '../stream/conversation-controller';
import type { CallSession } from '../stream/types';
import type { CallSessionManager } from '../stream/manager';
import { speakTtsStreamed } from '../stream/tts-handler';
import { runStructuredTurn } from '../stream/structured-turn/engine';
import { telnyxFetch } from '../../../shared/telnyx/http-agent';
import { __resetMetrics } from '../../../shared/observability/metrics';

vi.mock('../stream/tts-handler', () => ({
  speakTtsStreamed: vi.fn().mockResolvedValue(undefined),
  isSessionActiveForTts: vi.fn().mockReturnValue(true),
  cleanTextForTts: (text: string) => text,
}));
vi.mock('../../../shared/telnyx/http-agent', () => ({
  telnyxFetch: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../stream/structured-turn/engine', () => ({
  runStructuredTurn: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../shared/logger/pino', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function fixture() {
  const session = {
    callControlId: 'cc-ending',
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
    getTableRanges: vi.fn(async () => [{ capacity: 12, minCapacity: 1 }]),
    getAvailability: vi.fn(),
    createReservationFromConversation: vi.fn().mockResolvedValue(null),
    handoffToManager: vi
      .fn()
      .mockResolvedValue('Je lance le transfert vers le gérant, un instant.'),
    recordGroupRequestMessage: vi
      .fn()
      .mockResolvedValue("J'ai bien noté votre demande pour le gérant."),
    recordDialogueFallbackMessage: vi
      .fn()
      .mockResolvedValue("J'ai bien noté votre message pour le gérant."),
  } as unknown as CallSessionManager;
  return { session, mgr };
}

beforeEach(() => {
  __resetMetrics();
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('farewell playback and hangup', () => {
  it('attend aussi le webhook natif quand le mark de la file vide est déjà reçu', async () => {
    const { session, mgr } = fixture();
    vi.mocked(speakTtsStreamed).mockImplementationOnce(async (s) => {
      s.ending!.nativePlayback = true;
    });
    const done = finishCall(session, mgr, 'Au revoir.');
    await vi.advanceTimersByTimeAsync(0);
    expect(session.telnyxWs.send).toHaveBeenCalledTimes(2);
    acknowledgeCallEnding(session, session.ending!.markName);
    expect(telnyxFetch).not.toHaveBeenCalled();
    acknowledgeCallEnding(session, session.ending!.markName, 'native');
    await done;
    expect(telnyxFetch).toHaveBeenCalledOnce();
  });

  it('démonstration navigateur : prévient le navigateur et ferme la socket, sans hangup Telnyx', async () => {
    const { session, mgr } = fixture();
    (session as { demo?: boolean }).demo = true;
    const ws = session.telnyxWs as unknown as {
      send: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
    ws.close = vi.fn();

    const done = finishCall(session, mgr, 'Au revoir.');
    await vi.advanceTimersByTimeAsync(0);
    acknowledgeCallEnding(session, session.ending!.markName); // le navigateur a fini de jouer l'au revoir
    await done;

    expect(telnyxFetch).not.toHaveBeenCalled();
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ event: 'ended', reason: 'agent_hangup' }),
    );
    expect(ws.close).toHaveBeenCalledWith(1000, 'agent_hangup');
    expect(mgr.cleanup).toHaveBeenCalledWith(session);
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

  it('retraite la phrase quand une reprise de parole ne produit aucune transcription (appel du 24/09)', async () => {
    const { session, mgr } = fixture();
    session.currentTurn = {} as NonNullable<CallSession['currentTurn']>;
    session.lastProcessedTranscript = 'Pour quatre personnes';
    session.state = 'PROCESSING';

    handleSttEvent({ type: 'UtteranceStart' }, session, mgr);
    expect(session.state).toBe('LISTENING');
    expect(runStructuredTurn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_500);

    expect(runStructuredTurn).toHaveBeenCalledWith(
      session,
      'Pour quatre personnes',
      mgr,
      expect.any(Function),
    );
    expect(session.interruptedTurn).toBeNull();
  });

  it('fusionne la phrase interrompue avec la suite quand elle arrive', async () => {
    const { session, mgr } = fixture();
    session.currentTurn = {} as NonNullable<CallSession['currentTurn']>;
    session.lastProcessedTranscript = 'Je voudrais réserver pour quatre personnes';
    session.state = 'PROCESSING';

    handleSttEvent({ type: 'UtteranceStart' }, session, mgr);
    handleSttEvent({ type: 'UtteranceEnd', transcript: 'demain soir' }, session, mgr);
    await vi.advanceTimersByTimeAsync(1_500);

    expect(runStructuredTurn).toHaveBeenCalledTimes(1);
    expect(runStructuredTurn).toHaveBeenCalledWith(
      session,
      'Je voudrais réserver pour quatre personnes demain soir',
      mgr,
      expect.any(Function),
    );
    expect(session.interruptedTurn).toBeNull();
  });
});

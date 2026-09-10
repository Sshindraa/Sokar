import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { CallSession } from '../stream/types';
import { CallSessionManager } from '../stream/manager';
import {
  buildSttUrl,
  sendAudioToStt,
  STT_AUDIO_BUFFER_MAX,
  handleSttMessage,
  setSttSpellingProfile,
  STT_SPELLING_EOT_GRACE_MS,
  getSmartEndpointDelay,
  SMART_ENDPOINT_DELAY_INCOMPLETE_IDENTITY_MS,
} from '../stream/stt-bridge';

function makeWsMock(): WebSocket {
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
  } as unknown as WebSocket;
}

function makeSession(overrides: Partial<CallSession> = {}): CallSession {
  const mgr = CallSessionManager.getInstance();
  return mgr.create({
    callControlId: overrides.callControlId ?? 'cc-stt-1',
    callSessionId: 'cs-stt-1',
    from: '+33****0001',
    to: '+33****0000',
    restaurantId: 'rest-1',
    restaurantName: 'Test',
    systemPrompt: "Tu es l'assistant vocal de Test.",
    isVip: false,
    telnyxWs: overrides.telnyxWs ?? makeWsMock(),
    callLegId: 'leg-stt-1',
    codec: overrides.codec ?? 'PCMU',
  });
}

describe('buildSttUrl', () => {
  it('configure Scribe Realtime en français avec le modèle attendu', () => {
    const url = new URL(buildSttUrl('scribe_v2_realtime', 'PCMU'));
    expect(url.protocol).toBe('wss:');
    expect(url.host).toBe('api.elevenlabs.io');
    expect(url.pathname).toBe('/v1/speech-to-text/realtime');
    expect(url.searchParams.get('model_id')).toBe('scribe_v2_realtime');
    expect(url.searchParams.get('language_code')).toBe('fr');
    expect(url.searchParams.get('audio_format')).toBe('ulaw_8000');
    expect(url.searchParams.get('commit_strategy')).toBe('vad');
    expect(url.searchParams.getAll('keyterms')).toContain('réservation');
  });

  it('sélectionne PCM16 pour un stt Telnyx PCMA', () => {
    const url = new URL(buildSttUrl('scribe_v2_realtime', 'PCMA'));
    expect(url.searchParams.get('audio_format')).toBe('pcm_8000');
  });
});

describe('sendAudioToStt', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
  });

  it('bufferise les trames et supprime la plus ancienne au-delà de la limite', () => {
    const session = makeSession();
    for (let index = 0; index <= STT_AUDIO_BUFFER_MAX; index++) {
      sendAudioToStt(session, Buffer.from('chunk-' + index).toString('base64'));
    }
    expect(session.audioBuffer).toHaveLength(STT_AUDIO_BUFFER_MAX);
    expect(session.audioBuffer[0].toString()).toBe('chunk-1');
    expect(session.audioBuffer.at(-1)?.toString()).toBe('chunk-' + STT_AUDIO_BUFFER_MAX);
  });

  it('envoie un message JSON Scribe et convertit PCMA en PCM16', () => {
    const session = makeSession({ codec: 'PCMA' });
    const ws = makeWsMock();
    session.sttWs = ws;
    sendAudioToStt(session, Buffer.from([0xd5]).toString('base64'));
    const payload = JSON.parse(vi.mocked(ws.send).mock.calls[0][0] as string) as {
      message_type: string;
      audio_base_64: string;
    };
    expect(payload.message_type).toBe('input_audio_chunk');
    expect(Buffer.from(payload.audio_base_64, 'base64')).toHaveLength(2);
  });
});

describe('handleSttMessage', () => {
  beforeEach(() => {
    delete process.env.SPECULATIVE_LLM_ENABLED;
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
  });

  it('transforme un partial puis un committed en événements normalisés', () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onSttEvent = onEvent;

    handleSttMessage(session, { message_type: 'partial_transcript', text: 'Je voudrais réserver' });
    handleSttMessage(session, {
      message_type: 'committed_transcript_with_timestamps',
      text: 'Je voudrais réserver',
      words: [{ word: 'réserver', start: 0.5, end: 1.1 }],
    });

    expect(onEvent).toHaveBeenNthCalledWith(1, { type: 'UtteranceStart' });
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      type: 'UtteranceEnd',
      transcript: 'Je voudrais réserver',
      words: [{ word: 'réserver', start: 0.5, end: 1.1 }],
    });
    expect(session.turnTranscript).toBe('');
  });

  it('interrompt le TTS dès qu’un partial est reçu', () => {
    const session = makeSession();
    const mgr = CallSessionManager.getInstance();
    mgr.transition(session, 'SPEAKING');
    session.isSpeaking = true;
    handleSttMessage(session, { message_type: 'partial_transcript', text: 'Attendez' });
    expect(session.state).toBe('LISTENING');
    expect(session.isSpeaking).toBe(false);
  });

  it('attend la courte grâce pendant une collecte de nom', () => {
    vi.useFakeTimers();
    try {
      const session = makeSession();
      const onEvent = vi.fn();
      session.onSttEvent = onEvent;
      session.conversation.nameCollection.state = 'collecting';
      handleSttMessage(session, { message_type: 'committed_transcript', text: 'A K' });
      expect(onEvent).not.toHaveBeenCalled();
      vi.advanceTimersByTime(STT_SPELLING_EOT_GRACE_MS);
      expect(onEvent).toHaveBeenCalledWith({ type: 'UtteranceEnd', transcript: 'A K' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('remonte les erreurs fournisseur sous forme d’événement applicatif', () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onSttEvent = onEvent;
    handleSttMessage(session, { message_type: 'quota_exceeded', message: 'quota' });
    expect(onEvent).toHaveBeenCalledWith({ type: 'Error', message: 'quota' });
  });

  it('active le profil d’épellation sans envoyer de commande non supportée par Scribe', () => {
    const session = makeSession();
    const ws = makeWsMock();
    session.sttWs = ws;
    setSttSpellingProfile(session, true);
    expect(session.sttTurnConfig?.spellingActive).toBe(true);
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('conserve le délai de protection des présentations incomplètes', () => {
    expect(getSmartEndpointDelay('Bonjour je suis Martin')).toEqual({
      timeoutMs: SMART_ENDPOINT_DELAY_INCOMPLETE_IDENTITY_MS,
      reason: 'incomplete_identity',
    });
  });
});

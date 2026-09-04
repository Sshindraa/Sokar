/**
 * Tests for the Deepgram audio bridge.
 *
 * Scope:
 *  1. buildDeepgramUrl — model + endpoint routing (Flux v2 / Nova v1)
 *  2. sendAudioToDeepgram — buffer cap (400 chunks, drop oldest on overflow)
 *  3. handleDeepgramMessage — Flux event dispatching:
 *      - Flux v2 `event` messages (StartOfTurn / EndOfTurn / TurnResumed)
 *      - UtteranceStart → cancel speculative LLM state, fire onDeepgramEvent
 *      - UtteranceEnd → fire onDeepgramEvent with transcript
 *      - SpeechResumed → abort in-flight LLM, clear speculative state
 *      - Results (interim) → speculative gate (confidence ≥ 0.95, 3-20 words)
 *      - Results (isFinal, !speechFinal) → smart-timer (400ms if punct, 1500ms else)
 *      - Results (isFinal, speechFinal) → flush turnTranscript, cancel timer
 *      - Results during SPEAKING → barge-in
 *
 * No real WebSocket or Deepgram connection is opened. We test pure logic only.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { CallSession, FluxEvent } from '../stream/types';
import { CallSessionManager } from '../stream/manager';
import {
  buildDeepgramUrl,
  sendAudioToDeepgram,
  DEEPGRAM_AUDIO_BUFFER_MAX,
  getSmartEndpointDelay,
  SMART_ENDPOINT_DELAY_INCOMPLETE_IDENTITY_MS,
  SMART_ENDPOINT_DELAY_INCOMPLETE_FRAGMENT_MS,
  SMART_ENDPOINT_DELAY_INCOMPLETE_RESERVATION_MS,
  SMART_ENDPOINT_DELAY_WITHOUT_PUNCTUATION_MS,
  SMART_ENDPOINT_DELAY_WITH_PUNCTUATION_MS,
  FLUX_SPELLING_EOT_GRACE_MS,
  handleDeepgramMessage,
  setDeepgramSpellingProfile,
} from '../stream/deepgram-bridge';

// ── Helpers ──────────────────────────────────────────────────────────────

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
    callControlId: overrides.callControlId ?? 'cc-dg-1',
    callSessionId: 'cs-dg-1',
    from: '+33****0001',
    to: '+33****0000',
    restaurantId: 'rest-1',
    restaurantName: 'Test',
    systemPrompt: "Tu es l'assistant vocal de Test.",
    isVip: false,
    telnyxWs: overrides.telnyxWs ?? makeWsMock(),
    callLegId: 'leg-dg-1',
    codec: overrides.codec ?? 'PCMA',
  });
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('buildDeepgramUrl', () => {
  it('points to the v2 endpoint with flux-general-multi by default', () => {
    const url = buildDeepgramUrl('flux-general-multi', 'PCMA');
    expect(url).toMatch(/^wss:\/\/api\.deepgram\.com\/v2\/listen\?/);
    expect(url).toContain('model=flux-general-multi');
    expect(url).toContain('language_hint=fr');
    expect(url).toContain('eot_threshold=0.7');
    expect(url).toContain('eot_timeout_ms=5000');
    expect(url).not.toContain('language=fr');
  });

  it('routes any flux-* model to the v2 endpoint', () => {
    expect(buildDeepgramUrl('flux-general-en', 'PCMA')).toMatch(/\/v2\/listen/);
    expect(buildDeepgramUrl('flux-general-fr', 'PCMA')).toMatch(/\/v2\/listen/);
  });

  it('routes nova-3 to the v1 endpoint (fallback)', () => {
    const url = buildDeepgramUrl('nova-3', 'PCMA');
    expect(url).toMatch(/^wss:\/\/api\.deepgram\.com\/v1\/listen\?/);
    expect(url).toContain('model=nova-3');
  });

  it('encodes PCMA as alaw and PCMU as mulaw', () => {
    expect(buildDeepgramUrl('flux-general-multi', 'PCMA')).toContain('encoding=alaw');
    expect(buildDeepgramUrl('flux-general-multi', 'PCMU')).toContain('encoding=mulaw');
  });

  it('sets the Telnyx sample rate and keeps channels only on Nova v1', () => {
    const url = buildDeepgramUrl('flux-general-multi', 'PCMA');
    expect(url).toContain('sample_rate=8000');
    expect(url).not.toContain('channels=1');

    const novaUrl = buildDeepgramUrl('nova-3', 'PCMA');
    expect(novaUrl).toContain('sample_rate=8000');
    expect(novaUrl).toContain('channels=1');
  });

  it('includes the FR reservation keyterms (boosts recognition)', () => {
    const url = buildDeepgramUrl('flux-general-multi', 'PCMA');
    expect(url).toContain('keyterm=r%C3%A9servation');
    expect(url).toContain('keyterm=personnes');
    // Multi-value param: URLSearchParams produces keyterm=...&keyterm=...
    const matches = url.match(/keyterm=/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(10);
  });
});

describe('sendAudioToDeepgram — buffer cap', () => {
  it('buffers audio chunks while the WebSocket is not open', () => {
    const session = makeSession();
    session.deepgramWs = null; // No connection yet

    for (let i = 0; i < 5; i++) {
      sendAudioToDeepgram(session, Buffer.from(`chunk-${i}`).toString('base64'));
    }

    expect(session.audioBuffer.length).toBe(5);
  });

  it('drops the oldest chunk when the buffer exceeds DEEPGRAM_AUDIO_BUFFER_MAX (400)', () => {
    const session = makeSession();
    session.deepgramWs = null;

    // Fill to capacity + 1
    for (let i = 0; i <= DEEPGRAM_AUDIO_BUFFER_MAX; i++) {
      sendAudioToDeepgram(session, Buffer.from(`chunk-${i}`).toString('base64'));
    }

    // Buffer should never exceed the cap
    expect(session.audioBuffer.length).toBe(DEEPGRAM_AUDIO_BUFFER_MAX);

    // The first chunk (chunk-0) must have been dropped
    const firstChunkText = session.audioBuffer[0].toString();
    expect(firstChunkText).not.toBe('chunk-0');
    expect(firstChunkText).toBe(`chunk-1`);

    // The newest chunk must be present
    const lastChunkText = session.audioBuffer[session.audioBuffer.length - 1].toString();
    expect(lastChunkText).toBe(`chunk-${DEEPGRAM_AUDIO_BUFFER_MAX}`);
  });

  it('sends directly to WebSocket when readyState is OPEN (no buffering)', () => {
    const session = makeSession();
    const wsMock = makeWsMock();
    session.deepgramWs = wsMock;

    sendAudioToDeepgram(session, Buffer.from('live-audio').toString('base64'));

    expect(wsMock.send).toHaveBeenCalledWith(expect.any(Buffer));
    expect(session.audioBuffer.length).toBe(0);
  });
});

describe('handleDeepgramMessage — event dispatching', () => {
  beforeEach(() => {
    // Disable speculative LLM by default — opt-in per test
    delete process.env.SPECULATIVE_LLM_ENABLED;
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
  });

  it('UtteranceStart: cancels speculative LLM state and fires onDeepgramEvent', () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onDeepgramEvent = onEvent;
    session.speculativeLlm = Promise.resolve('cached');
    session.speculativeResult = 'cached';
    session.speculativeTranscript = 'je voudrais';

    handleDeepgramMessage(session, { type: 'UtteranceStart' });

    expect(session.speculativeLlm).toBeNull();
    expect(session.speculativeResult).toBeNull();
    expect(session.speculativeTranscript).toBe('');
    expect(onEvent).toHaveBeenCalledWith({ type: 'UtteranceStart' });
  });

  it('Flux StartOfTurn: reads the top-level transcript and fires UtteranceStart', () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onDeepgramEvent = onEvent;

    handleDeepgramMessage(session, {
      event: 'StartOfTurn',
      transcript: 'Bonjour, je voudrais réserver',
    });

    expect(onEvent).toHaveBeenCalledWith({ type: 'UtteranceStart' });
  });

  it('Flux StartOfTurn: interrupts TTS as a barge-in signal', () => {
    const session = makeSession();
    const mgr = CallSessionManager.getInstance();
    const telnyxWs = session.telnyxWs;
    if (!telnyxWs) throw new Error('Missing telnyxWs');
    mgr.transition(session, 'SPEAKING');
    session.isSpeaking = true;

    handleDeepgramMessage(session, {
      event: 'StartOfTurn',
      transcript: 'Attendez, je voulais préciser',
    });

    expect(session.state).toBe('LISTENING');
    expect(session.isSpeaking).toBe(false);
    const sentPayloads = vi.mocked(telnyxWs.send).mock.calls.map((c) => c[0] as string);
    expect(sentPayloads.some((p) => p.includes('"event":"clear"'))).toBe(true);
  });

  it('Flux EndOfTurn: forwards the complete top-level transcript immediately', () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onDeepgramEvent = onEvent;

    handleDeepgramMessage(session, {
      event: 'EndOfTurn',
      transcript: 'Bonjour, je voudrais réserver une table pour demain.',
    });

    expect(onEvent).toHaveBeenCalledWith({
      type: 'UtteranceEnd',
      transcript: 'Bonjour, je voudrais réserver une table pour demain.',
    });
  });

  it('Flux EndOfTurn: forwards word scores and EOT confidence separately', () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onDeepgramEvent = onEvent;

    handleDeepgramMessage(session, {
      event: 'EndOfTurn',
      transcript: 'A ka i effe',
      words: [
        { word: 'A', punctuated_word: 'A', confidence: 0.81, start: 0, end: 0.2 },
        { word: 'ka', confidence: 0.94, start: 0.2, end: 0.4 },
      ],
      end_of_turn_confidence: 0.97,
      trigger: 'eot_threshold',
    });

    expect(onEvent).toHaveBeenCalledWith({
      type: 'UtteranceEnd',
      transcript: 'A ka i effe',
      words: [
        { word: 'A', punctuatedWord: 'A', confidence: 0.81, start: 0, end: 0.2 },
        { word: 'ka', confidence: 0.94, start: 0.2, end: 0.4 },
      ],
      endOfTurnConfidence: 0.97,
      trigger: 'eot_threshold',
    });
  });

  it('temporise brièvement un EndOfTurn natif pendant la collecte du nom', () => {
    vi.useFakeTimers();
    try {
      const session = makeSession();
      const onEvent = vi.fn();
      session.onDeepgramEvent = onEvent;
      session.conversation.nameCollection.state = 'collecting';

      handleDeepgramMessage(session, {
        event: 'EndOfTurn',
        transcript: 'A K',
      });

      expect(onEvent).not.toHaveBeenCalled();
      vi.advanceTimersByTime(FLUX_SPELLING_EOT_GRACE_MS - 1);
      expect(onEvent).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onEvent).toHaveBeenCalledWith({ type: 'UtteranceEnd', transcript: 'A K' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('conserve les lettres finalisées quand Flux émet ensuite TurnResumed', () => {
    vi.useFakeTimers();
    try {
      const session = makeSession();
      const onEvent = vi.fn();
      session.onDeepgramEvent = onEvent;
      session.conversation.nameCollection.state = 'collecting';

      handleDeepgramMessage(session, { event: 'EndOfTurn', transcript: 'A K' });
      // TurnResumed suit EagerEndOfTurn et fournit le transcript révisé du
      // tour. Le préfixe déjà finalisé ne doit pas disparaître.
      handleDeepgramMessage(session, { event: 'TurnResumed', transcript: 'A K I F' });
      handleDeepgramMessage(session, { event: 'EndOfTurn', transcript: 'A K I F' });
      vi.advanceTimersByTime(FLUX_SPELLING_EOT_GRACE_MS);

      expect(onEvent).toHaveBeenCalledWith({ type: 'SpeechResumed' });
      expect(onEvent).toHaveBeenCalledWith({ type: 'UtteranceEnd', transcript: 'A K I F' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('ne réintroduit pas une lettre retirée par le transcript EndOfTurn final', () => {
    vi.useFakeTimers();
    try {
      const session = makeSession();
      const onEvent = vi.fn();
      session.onDeepgramEvent = onEvent;
      session.conversation.nameCollection.state = 'collecting';
      session.turnTranscript = 'A K I F';

      handleDeepgramMessage(session, { event: 'EndOfTurn', transcript: 'A K I' });
      vi.advanceTimersByTime(FLUX_SPELLING_EOT_GRACE_MS);

      expect(onEvent).toHaveBeenCalledWith({ type: 'UtteranceEnd', transcript: 'A K I' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('active et restaure le profil Flux via Configure sur la même socket', () => {
    const session = makeSession();
    const wsMock = makeWsMock();
    session.deepgramWs = wsMock;
    session.deepgramModel = 'flux-general-multi';

    setDeepgramSpellingProfile(session, true);
    expect(wsMock.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'Configure',
        thresholds: { eot_threshold: 0.9, eot_timeout_ms: 5000 },
      }),
    );

    setDeepgramSpellingProfile(session, false);
    expect(wsMock.send).toHaveBeenLastCalledWith(
      JSON.stringify({
        type: 'Configure',
        thresholds: { eot_threshold: 0.7, eot_timeout_ms: 5000 },
      }),
    );
  });

  it('enregistre ConfigureSuccess et ne casse pas le tour sur ConfigureFailure', () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onDeepgramEvent = onEvent;
    setDeepgramSpellingProfile(session, true);

    handleDeepgramMessage(session, {
      type: 'ConfigureSuccess',
      thresholds: { eot_threshold: 0.9, eot_timeout_ms: 5000 },
    });
    expect(session.deepgramTurnConfig?.applied).toEqual({
      eotThreshold: 0.9,
      eotTimeoutMs: 5000,
    });

    handleDeepgramMessage(session, {
      type: 'ConfigureFailure',
      message: 'unsupported threshold',
    });
    expect(session.deepgramTurnConfig?.applied).toEqual({
      eotThreshold: 0.9,
      eotTimeoutMs: 5000,
    });
    expect(onEvent).toHaveBeenCalledWith({
      type: 'ConfigureFailure',
      message: 'unsupported threshold',
    });
  });

  it('accepte aussi la configuration retournée sous la clé config', () => {
    const session = makeSession();

    handleDeepgramMessage(session, {
      event: 'ConfigureSuccess',
      config: { eot_threshold: 0.9, eot_timeout_ms: 5_000 },
    });

    expect(session.deepgramTurnConfig?.applied).toEqual({
      eotThreshold: 0.9,
      eotTimeoutMs: 5_000,
    });
  });

  it('Flux TurnResumed: maps to SpeechResumed so an unfinished turn is cancelled', () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onDeepgramEvent = onEvent;
    const abortController = new AbortController();
    const abortSpy = vi.spyOn(abortController, 'abort');
    session.abortController = abortController;

    handleDeepgramMessage(session, {
      event: 'TurnResumed',
      transcript: 'Bonjour, je voudrais réserver et...',
    });

    expect(abortSpy).toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith({ type: 'SpeechResumed' });
  });

  it('UtteranceEnd: forwards the transcript to onDeepgramEvent', () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onDeepgramEvent = onEvent;

    handleDeepgramMessage(session, {
      type: 'UtteranceEnd',
      channel: {
        alternatives: [{ transcript: 'Bonjour, je voudrais réserver', confidence: 0.99 }],
      },
    });

    expect(onEvent).toHaveBeenCalledWith({
      type: 'UtteranceEnd',
      transcript: 'Bonjour, je voudrais réserver',
    });
  });

  it('UtteranceEnd: skips empty transcripts', () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onDeepgramEvent = onEvent;

    handleDeepgramMessage(session, {
      type: 'UtteranceEnd',
      channel: { alternatives: [{ transcript: '   ', confidence: 0.5 }] },
    });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('SpeechResumed: aborts the in-flight LLM and clears speculative state', () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onDeepgramEvent = onEvent;
    const abortController = new AbortController();
    const abortSpy = vi.spyOn(abortController, 'abort');
    session.abortController = abortController;
    session.speculativeLlm = Promise.resolve('x');
    session.speculativeResult = 'x';
    session.speculativeTranscript = 'interim text';

    handleDeepgramMessage(session, { type: 'SpeechResumed' });

    expect(abortSpy).toHaveBeenCalled();
    expect(session.abortController).toBeNull();
    expect(session.speculativeLlm).toBeNull();
    expect(session.speculativeResult).toBeNull();
    expect(session.speculativeTranscript).toBe('');
    expect(onEvent).toHaveBeenCalledWith({ type: 'SpeechResumed' });
  });

  it('Results (isFinal + speechFinal): flushes turnTranscript and fires UtteranceEnd', () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onDeepgramEvent = onEvent;
    session.turnTranscript = 'Bonjour je voudrais';

    handleDeepgramMessage(session, {
      type: 'Results',
      is_final: true,
      speech_final: true,
      channel: { alternatives: [{ transcript: 'réserver', confidence: 0.95 }] },
    });

    expect(onEvent).toHaveBeenCalledWith({
      type: 'UtteranceEnd',
      transcript: 'Bonjour je voudrais réserver',
    });
    expect(session.turnTranscript).toBe('');
  });

  it('Results (isFinal, !speechFinal, ends with punctuation): starts a 650ms smart timer', async () => {
    const session = makeSession();
    session.turnTranscript = 'Bonjour.';

    handleDeepgramMessage(session, {
      type: 'Results',
      is_final: true,
      speech_final: false,
      channel: { alternatives: [{ transcript: 'je voudrais', confidence: 0.9 }] },
    });

    // Timer was set
    expect(session.speechFinalTimer).not.toBeNull();

    // Clean up the pending timer
    if (session.speechFinalTimer) clearTimeout(session.speechFinalTimer);
  });

  it('Results (isFinal, !speechFinal, no punctuation): starts a 1200ms smart timer', async () => {
    const session = makeSession();
    session.turnTranscript = 'Bonjour';

    handleDeepgramMessage(session, {
      type: 'Results',
      is_final: true,
      speech_final: false,
      channel: { alternatives: [{ transcript: 'madame', confidence: 0.9 }] },
    });

    expect(session.speechFinalTimer).not.toBeNull();

    if (session.speechFinalTimer) clearTimeout(session.speechFinalTimer);
  });

  it('choisit un délai qui protège les présentations incomplètes', () => {
    expect(SMART_ENDPOINT_DELAY_WITH_PUNCTUATION_MS).toBe(650);
    expect(SMART_ENDPOINT_DELAY_WITHOUT_PUNCTUATION_MS).toBe(1_200);
    expect(SMART_ENDPOINT_DELAY_INCOMPLETE_RESERVATION_MS).toBe(1_300);
    expect(SMART_ENDPOINT_DELAY_INCOMPLETE_IDENTITY_MS).toBe(2_500);
    expect(SMART_ENDPOINT_DELAY_INCOMPLETE_FRAGMENT_MS).toBe(1_500);
    expect(getSmartEndpointDelay('Bonjour.')).toEqual({
      timeoutMs: SMART_ENDPOINT_DELAY_WITH_PUNCTUATION_MS,
      reason: 'punctuation',
    });
    expect(getSmartEndpointDelay('Je voudrais réserver')).toEqual({
      timeoutMs: SMART_ENDPOINT_DELAY_WITHOUT_PUNCTUATION_MS,
      reason: 'silence',
    });
    expect(getSmartEndpointDelay('Bonjour je suis Martin')).toEqual({
      timeoutMs: SMART_ENDPOINT_DELAY_INCOMPLETE_IDENTITY_MS,
      reason: 'incomplete_identity',
    });
    expect(getSmartEndpointDelay('Non, plutôt')).toEqual({
      timeoutMs: SMART_ENDPOINT_DELAY_INCOMPLETE_RESERVATION_MS,
      reason: 'incomplete_reservation',
    });
    expect(getSmartEndpointDelay('Ok donc')).toEqual({
      timeoutMs: SMART_ENDPOINT_DELAY_INCOMPLETE_FRAGMENT_MS,
      reason: 'incomplete_fragment',
    });
  });

  it('attend la suite après une présentation avant de déclencher UtteranceEnd', async () => {
    vi.useFakeTimers();
    const session = makeSession();
    const onEvent = vi.fn();
    session.onDeepgramEvent = onEvent;

    handleDeepgramMessage(session, {
      type: 'Results',
      is_final: true,
      speech_final: false,
      channel: { alternatives: [{ transcript: 'Bonjour je suis Martin', confidence: 0.98 }] },
    });

    await vi.advanceTimersByTimeAsync(1_500);
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UtteranceEnd' }));

    handleDeepgramMessage(session, {
      type: 'Results',
      is_final: true,
      speech_final: true,
      channel: {
        alternatives: [
          {
            transcript: "Test Copilot. J'ai une réservation demain à 19 heures 30.",
            confidence: 0.98,
          },
        ],
      },
    });

    expect(onEvent).toHaveBeenCalledWith({
      type: 'UtteranceEnd',
      transcript:
        "Bonjour je suis Martin Test Copilot. J'ai une réservation demain à 19 heures 30.",
    });
    vi.useRealTimers();
  });

  it('Results (not final, interim): does NOT fire UtteranceEnd immediately', () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onDeepgramEvent = onEvent;

    handleDeepgramMessage(session, {
      type: 'Results',
      is_final: false,
      speech_final: false,
      channel: { alternatives: [{ transcript: 'bonjour', confidence: 0.7 }] },
    });

    // No UtteranceEnd for a plain interim
    const utteranceEndCalls = onEvent.mock.calls.filter((c) => c[0]?.type === 'UtteranceEnd');
    expect(utteranceEndCalls).toHaveLength(0);
  });

  it('Results during SPEAKING with non-empty transcript: triggers barge-in', () => {
    const session = makeSession();
    const mgr = CallSessionManager.getInstance();
    const telnyxWs = session.telnyxWs;
    if (!telnyxWs) throw new Error('Missing telnyxWs');
    mgr.transition(session, 'SPEAKING');
    session.isSpeaking = true;

    handleDeepgramMessage(session, {
      type: 'Results',
      is_final: false,
      speech_final: false,
      channel: { alternatives: [{ transcript: 'attendez', confidence: 0.9 }] },
    });

    // Barge-in clears the Telnyx buffer + transitions to LISTENING
    expect(session.state).toBe('LISTENING');
    expect(session.isSpeaking).toBe(false);
    const sentPayloads = vi.mocked(telnyxWs.send).mock.calls.map((c) => c[0] as string);
    expect(sentPayloads.some((p) => p.includes('"event":"clear"'))).toBe(true);
  });

  it('Results during LISTENING: no barge-in (no Telnyx clear)', () => {
    const session = makeSession();
    const mgr = CallSessionManager.getInstance();
    const telnyxWs = session.telnyxWs;
    if (!telnyxWs) throw new Error('Missing telnyxWs');
    mgr.transition(session, 'LISTENING');

    handleDeepgramMessage(session, {
      type: 'Results',
      is_final: false,
      speech_final: false,
      channel: { alternatives: [{ transcript: 'bonjour', confidence: 0.9 }] },
    });

    // No clear event
    const sentPayloads = vi.mocked(telnyxWs.send).mock.calls.map((c) => c[0] as string);
    expect(sentPayloads.some((p) => p.includes('"event":"clear"'))).toBe(false);
  });

  it('Results (speculative eligible: high confidence, 3-20 words): fires InterimHighConfidence', () => {
    process.env.SPECULATIVE_LLM_ENABLED = 'true';
    const session = makeSession();
    const mgr = CallSessionManager.getInstance();
    mgr.transition(session, 'LISTENING');
    const onEvent = vi.fn();
    session.onDeepgramEvent = onEvent;

    handleDeepgramMessage(session, {
      type: 'Results',
      is_final: false,
      speech_final: false,
      channel: {
        alternatives: [{ transcript: 'je voudrais réserver une table', confidence: 0.97 }],
      },
    });

    const interimCalls = onEvent.mock.calls.filter((c) => c[0]?.type === 'InterimHighConfidence');
    expect(interimCalls).toHaveLength(1);
    expect(interimCalls[0][0]).toEqual({
      type: 'InterimHighConfidence',
      transcript: 'je voudrais réserver une table',
    });
  });

  it('Results (speculative gate: low confidence < 0.95): does NOT fire InterimHighConfidence', () => {
    process.env.SPECULATIVE_LLM_ENABLED = 'true';
    const session = makeSession();
    const mgr = CallSessionManager.getInstance();
    mgr.transition(session, 'LISTENING');
    const onEvent = vi.fn();
    session.onDeepgramEvent = onEvent;

    handleDeepgramMessage(session, {
      type: 'Results',
      is_final: false,
      speech_final: false,
      channel: {
        alternatives: [{ transcript: 'je voudrais réserver une table', confidence: 0.8 }],
      },
    });

    const interimCalls = onEvent.mock.calls.filter((c) => c[0]?.type === 'InterimHighConfidence');
    expect(interimCalls).toHaveLength(0);
  });

  it('Results (speculative gate: too few words < 3): does NOT fire InterimHighConfidence', () => {
    process.env.SPECULATIVE_LLM_ENABLED = 'true';
    const session = makeSession();
    const mgr = CallSessionManager.getInstance();
    mgr.transition(session, 'LISTENING');
    const onEvent = vi.fn();
    session.onDeepgramEvent = onEvent;

    handleDeepgramMessage(session, {
      type: 'Results',
      is_final: false,
      speech_final: false,
      channel: { alternatives: [{ transcript: 'bonjour', confidence: 0.99 }] },
    });

    const interimCalls = onEvent.mock.calls.filter((c) => c[0]?.type === 'InterimHighConfidence');
    expect(interimCalls).toHaveLength(0);
  });

  it('Results (speculative gate: same transcript as previous): does NOT re-fire (idempotent)', () => {
    process.env.SPECULATIVE_LLM_ENABLED = 'true';
    const session = makeSession();
    const mgr = CallSessionManager.getInstance();
    mgr.transition(session, 'LISTENING');
    const onEvent = vi.fn();
    session.onDeepgramEvent = onEvent;
    session.speculativeTranscript = 'je voudrais réserver une table';

    handleDeepgramMessage(session, {
      type: 'Results',
      is_final: false,
      speech_final: false,
      channel: {
        alternatives: [{ transcript: 'je voudrais réserver une table', confidence: 0.97 }],
      },
    });

    // Same transcript as last time → no new speculative event
    const interimCalls = onEvent.mock.calls.filter((c) => c[0]?.type === 'InterimHighConfidence');
    expect(interimCalls).toHaveLength(0);
  });

  it('unknown message type: ignored (no side effects)', () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onDeepgramEvent = onEvent;

    // Should not throw
    expect(() => {
      handleDeepgramMessage(session, { type: 'SomethingMadeUp' });
    }).not.toThrow();

    expect(onEvent).not.toHaveBeenCalled();
  });
});

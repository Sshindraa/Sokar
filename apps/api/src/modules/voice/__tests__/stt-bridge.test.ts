import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { CallSession, SttEvent } from '../stream/types';
import { CallSessionManager } from '../stream/manager';
import {
  buildSttUrl,
  buildDeepgramSttUrl,
  flushDeepgramFinalPartsForSafety,
  buildSttKeyterms,
  buildSttPreviousText,
  DEFAULT_STT_LANGUAGES,
  getSttLanguageCodes,
  sendAudioToStt,
  STT_AUDIO_BUFFER_MAX,
  handleSttMessage,
  handleNormalizedSttMessage,
  STT_SPELLING_EOT_GRACE_MS,
  STT_TIMESTAMPED_COMMIT_GRACE_MS,
  getSmartEndpointDelay,
  DIALOGUE_V2_INCOMPLETE_HOLD_MS,
  isSmartEndpointEnabled,
  SMART_ENDPOINT_HOLD_CORRECTION_MS,
  SMART_ENDPOINT_HOLD_NO_PUNCTUATION_MS,
  SMART_ENDPOINT_HOLD_SUSPENDED_MS,
  isLikelyIncompleteTranscript,
  isLikelyRepeatedNoiseTranscript,
  isPunctuationOnlyTranscript,
  deepgramShortStallFinalizeMs,
  finalizeOnSemanticEndOfTurn,
  looksLikeSpelledLetters,
} from '../stream/stt-bridge';
import { createDeepgramSttAdapter } from '../stream/stt-provider-adapter';
import { speculateStructuredTurn } from '../stream/structured-turn/engine';
import { createStructuredTurnState } from '../stream/structured-turn/fact-guards';
import { structuredSpeculationPauseMs } from '../stream/stt-bridge';
import { clearFastBargeIn } from '../stream/fast-barge-in';
import { encodeTelnyxFromPcm16 } from '../stream/telnyx-codec';
import { VoiceDeepgramConfigSchema, voiceConfig } from '../../../env';
import { TRANSCRIPT_DEDUPE_WINDOW_MS } from '../../../shared/constants/timeouts';

vi.mock('../stream/structured-turn/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stream/structured-turn/engine')>()),
  speculateStructuredTurn: vi.fn(),
}));

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
  it('configure Scribe Realtime en détection multilingue avec le modèle attendu', () => {
    const url = new URL(buildSttUrl('scribe_v2_realtime', 'PCMU'));
    expect(url.protocol).toBe('wss:');
    expect(url.host).toBe('api.elevenlabs.io');
    expect(url.pathname).toBe('/v1/speech-to-text/realtime');
    expect(url.searchParams.get('model_id')).toBe('scribe_v2_realtime');
    expect(url.searchParams.get('language_code')).toBeNull();
    expect(url.searchParams.get('include_language_detection')).toBe('true');
    expect(url.searchParams.getAll('secondary_languages')).toEqual([...DEFAULT_STT_LANGUAGES]);
    expect(url.searchParams.get('audio_format')).toBe('ulaw_8000');
    expect(url.searchParams.get('commit_strategy')).toBe('vad');
    expect(url.searchParams.getAll('keyterms')).toContain('réservation');
  });

  it('accepte une liste de langues ciblée depuis la configuration', () => {
    vi.stubEnv('ELEVENLABS_STT_LANGUAGES', 'fr, en, EN, invalid, spa');
    expect(getSttLanguageCodes()).toEqual(['fr', 'en', 'spa']);

    const url = new URL(
      buildSttUrl('scribe_v2_realtime', 'PCMU', undefined, {
        languages: ['fr', 'en'],
      }),
    );
    expect(url.searchParams.getAll('secondary_languages')).toEqual(['fr', 'en']);
  });

  it('active explicitement la couverture des 44 langues Sonic 3.6', () => {
    vi.stubEnv('ELEVENLABS_STT_ALL_LANGUAGES', 'true');
    const languages = getSttLanguageCodes();
    expect(languages).toHaveLength(44);
    expect(languages).toEqual(expect.arrayContaining(['fra', 'eng', 'ori', 'urd']));
    expect(languages).toContain('fil');
    expect(languages).not.toContain('tl');
    vi.stubEnv('ELEVENLABS_STT_ALL_LANGUAGES', 'false');
  });

  it('normalise les alias Cartesia invalides pour Scribe', () => {
    vi.stubEnv('ELEVENLABS_STT_LANGUAGES', 'fr,tl,zh,ja,ko');
    expect(getSttLanguageCodes()).toEqual(['fr', 'fil', 'zho', 'jpn', 'kor']);

    const url = new URL(
      buildSttUrl('scribe_v2_realtime', 'PCMU', undefined, {
        languages: ['tl'],
      }),
    );
    expect(url.searchParams.getAll('secondary_languages')).toEqual(['fil']);
  });

  it('ajoute le nom du restaurant aux termes de contexte sans dépasser les limites Scribe', () => {
    const keyterms = buildSttKeyterms('Chez La Grande Table');
    const url = new URL(
      buildSttUrl('scribe_v2_realtime', 'PCMU', undefined, {
        restaurantName: 'Chez La Grande Table',
      }),
    );
    expect(keyterms).toContain('Chez La Grande Table');
    expect(url.searchParams.getAll('keyterms')).toContain('Chez La Grande Table');
    expect(keyterms.length).toBeLessThanOrEqual(50);
    expect(keyterms.every((term) => term.length <= 20)).toBe(true);
  });

  it('construit un contexte previous_text court et stable', () => {
    expect(buildSttPreviousText('  Chez   Sokar  ')).toBe(
      'Réservation / restaurant booking Chez Sokar',
    );
    expect(Array.from(buildSttPreviousText('x'.repeat(100))).length).toBeLessThanOrEqual(50);
  });

  it('sélectionne PCM16 pour un stt Telnyx PCMA', () => {
    const url = new URL(buildSttUrl('scribe_v2_realtime', 'PCMA'));
    expect(url.searchParams.get('audio_format')).toBe('pcm_8000');
  });

  it.each(['PCMA', 'L16'] as const)(
    'laisse l’URL %s identique quand le filtre est coupé et le transmet quand il est actif',
    (codec) => {
      const baseline = buildSttUrl('scribe_v2_realtime', codec);
      const disabled = buildSttUrl('scribe_v2_realtime', codec, undefined, {
        filterBackgroundAudio: false,
      });
      expect(disabled).toBe(baseline);
      expect(new URL(disabled).searchParams.has('filter_background_audio')).toBe(false);

      const enabled = new URL(
        buildSttUrl('scribe_v2_realtime', codec, undefined, {
          filterBackgroundAudio: true,
        }),
      );
      expect(enabled.searchParams.get('filter_background_audio')).toBe('true');
      expect(enabled.searchParams.has('include_timestamps')).toBe(false);
      expect(enabled.searchParams.get('include_language_detection')).toBe('true');
      expect(enabled.searchParams.get('audio_format')).toBe(
        codec === 'L16' ? 'pcm_16000' : 'pcm_8000',
      );
    },
  );

  it('force le français sans détection ni langues secondaires lors du relock', () => {
    const url = new URL(
      buildSttUrl('scribe_v2_realtime', 'PCMA', undefined, {
        forceFrench: true,
        filterBackgroundAudio: true,
      }),
    );
    expect(url.searchParams.get('language_code')).toBe('fr');
    expect(url.searchParams.get('include_language_detection')).toBe('false');
    expect(url.searchParams.getAll('secondary_languages')).toEqual([]);
    expect(url.searchParams.get('filter_background_audio')).toBe('true');
    expect(url.searchParams.has('include_timestamps')).toBe(false);
    expect(url.searchParams.get('commit_strategy')).toBe('vad');
  });
});

describe('buildDeepgramSttUrl', () => {
  it("vise l'endpoint Deepgram configuré (UE) pour Nova-3 et Flux, sinon api.deepgram.com", () => {
    const saved = voiceConfig.DEEPGRAM_API_HOST;
    try {
      Object.assign(voiceConfig, { DEEPGRAM_API_HOST: 'api.eu.deepgram.com' });
      expect(new URL(buildDeepgramSttUrl('PCMA', [])).hostname).toBe('api.eu.deepgram.com');
      expect(new URL(buildDeepgramSttUrl('PCMA', [], 'flux-general-multi')).hostname).toBe(
        'api.eu.deepgram.com',
      );
    } finally {
      Object.assign(voiceConfig, { DEEPGRAM_API_HOST: saved });
    }
  });

  it("n'accepte que les hôtes Deepgram connus : la clé API ne part jamais vers une valeur libre", () => {
    const parse = (value: unknown) =>
      VoiceDeepgramConfigSchema.parse({ DEEPGRAM_API_HOST: value }).DEEPGRAM_API_HOST;
    expect(parse(undefined)).toBe('api.deepgram.com');
    expect(parse('api.eu.deepgram.com')).toBe('api.eu.deepgram.com');
    expect(parse(' "api.eu.deepgram.com" ')).toBe('api.eu.deepgram.com');
    expect(parse('evil.example.com')).toBe('api.deepgram.com');
    expect(parse('api.eu.deepgram.com.evil.io')).toBe('api.deepgram.com');
  });

  it.each([
    ['PCMA', 'alaw', '8000'],
    ['PCMU', 'mulaw', '8000'],
    ['L16', 'linear16', '16000'],
  ] as const)('déclare le format %s correspondant au codec entrant', (codec, encoding, rate) => {
    const url = new URL(buildDeepgramSttUrl(codec, ['Chez Sokar', 'réservation']));
    expect(url.hostname).toBe('api.deepgram.com');
    expect(url.pathname).toBe('/v1/listen');
    expect(url.searchParams.get('model')).toBe('nova-3');
    expect(url.searchParams.get('language')).toBe('fr');
    expect(url.searchParams.get('encoding')).toBe(encoding);
    expect(url.searchParams.get('sample_rate')).toBe(rate);
    expect(url.searchParams.get('interim_results')).toBe('true');
    expect(url.searchParams.get('endpointing')).toBe('200');
    expect(url.searchParams.get('utterance_end_ms')).toBe('1000');
    expect(url.searchParams.get('numerals')).toBe('true');
    expect(url.searchParams.get('punctuate')).toBe('false');
    expect(url.searchParams.get('mip_opt_out')).toBe('true');
    expect(url.searchParams.getAll('keyterm')).toEqual(['Chez Sokar', 'réservation']);
  });

  it('sélectionne Flux v2 avec le hint français et ses seuils de tour', () => {
    const url = new URL(buildDeepgramSttUrl('PCMA', ['Chez Sokar'], 'flux-general-multi'));
    expect(url.pathname).toBe('/v2/listen');
    expect(url.searchParams.get('model')).toBe('flux-general-multi');
    expect(url.searchParams.get('language_hint')).toBe('fr');
    expect(url.searchParams.get('encoding')).toBe('alaw');
    expect(url.searchParams.get('sample_rate')).toBe('8000');
    expect(url.searchParams.get('eager_eot_threshold')).toBe('0.5');
    expect(url.searchParams.get('eot_timeout_ms')).toBe('1000');
    expect(url.searchParams.get('mip_opt_out')).toBe('true');
    expect(url.searchParams.get('numerals')).toBe('true');
    expect(url.searchParams.has('punctuate')).toBe(false);
    expect(url.searchParams.getAll('keyterm')).toEqual(['Chez Sokar']);
  });

  it('transmet les paramètres expérimentaux de formatage et l’opt-out MIP explicites', () => {
    const nova = new URL(
      buildDeepgramSttUrl('PCMA', [], 'nova-3', {
        numerals: false,
        punctuate: true,
        mipOptOut: false,
      }),
    );
    const flux = new URL(
      buildDeepgramSttUrl('PCMA', [], 'flux-general-multi', {
        numerals: false,
        punctuate: true,
        mipOptOut: false,
      }),
    );

    expect(nova.searchParams.get('numerals')).toBe('false');
    expect(nova.searchParams.get('punctuate')).toBe('true');
    expect(nova.searchParams.get('mip_opt_out')).toBe('false');
    expect(flux.searchParams.get('numerals')).toBe('false');
    expect(flux.searchParams.has('punctuate')).toBe(false);
    expect(flux.searchParams.get('mip_opt_out')).toBe('false');
  });
});

describe('sendAudioToStt', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
  });

  it('met l’agent en pause dès 80 ms de voix entrante pendant qu’il parle (coupure rapide)', () => {
    const session = makeSession({ codec: 'L16' });
    session.sttWs = makeWsMock();
    session.state = 'SPEAKING';
    session.agentAudioActive = true;
    const pause = vi.fn();
    session.ttsContext = { cancel: vi.fn(), pause, resume: vi.fn() };
    // 20 ms de voix forte (L16 : 16 kHz, grand-boutiste, comme Telnyx).
    const loud = Buffer.alloc(640);
    for (let index = 0; index < 320; index++)
      loud.writeInt16BE(index % 2 ? 3_000 : -3_000, index * 2);
    for (let frame = 0; frame < 3; frame++) sendAudioToStt(session, loud.toString('base64'));
    expect(pause).not.toHaveBeenCalled();
    sendAudioToStt(session, loud.toString('base64'));
    expect(pause).toHaveBeenCalledTimes(1);
    clearFastBargeIn(session);
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
      previous_text?: string;
    };
    expect(payload.message_type).toBe('input_audio_chunk');
    expect(Buffer.from(payload.audio_base_64, 'base64')).toHaveLength(2);
    expect(payload.previous_text).toBe('Réservation / restaurant booking Test');

    sendAudioToStt(session, Buffer.from([0xd5]).toString('base64'));
    const secondPayload = JSON.parse(vi.mocked(ws.send).mock.calls[1][0] as string) as {
      previous_text?: string;
    };
    expect(secondPayload.previous_text).toBeUndefined();
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
    expect(onEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'UtteranceEnd',
        transcript: 'Je voudrais réserver',
        words: [{ word: 'réserver', start: 0.5, end: 1.1 }],
      }),
    );
    expect(session.turnTranscript).toBe('');
  });

  it('joint les jalons fin de parole, final STT et dispatch au tour normalisé', () => {
    vi.useFakeTimers();
    try {
      const session = makeSession();
      const onEvent = vi.fn();
      session.onSttEvent = onEvent;
      handleSttMessage(session, { message_type: 'partial_transcript', text: 'Demain soir' });
      vi.advanceTimersByTime(250);
      handleSttMessage(session, {
        message_type: 'committed_transcript_with_timestamps',
        text: 'Demain soir',
        words: [{ word: 'soir', start: 0.4, end: 0.8 }],
      });

      expect(onEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'UtteranceEnd',
          speechEndAt: expect.any(Number),
          sttFinalAt: expect.any(Number),
          turnDispatchedAt: expect.any(Number),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('convertit la log-probabilité Scribe en confiance de mot', () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onSttEvent = onEvent;

    handleSttMessage(session, { message_type: 'partial_transcript', text: 'six personnes' });
    handleSttMessage(session, {
      message_type: 'committed_transcript_with_timestamps',
      text: 'six personnes',
      words: [
        { text: 'six', start: 0.2, end: 0.5, logprob: Math.log(0.58) },
        { text: 'personnes', start: 0.5, end: 1.1, logprob: Math.log(0.33) },
      ],
    });

    const end = onEvent.mock.calls.at(-1)?.[0] as { words: Array<{ confidence?: number }> };
    expect(end.words[0].confidence).toBeCloseTo(0.58, 5);
    expect(end.words[1].confidence).toBeCloseTo(0.33, 5);
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

  it('ignore un fragment VAD incomplet au lieu de relancer la même question', () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onSttEvent = onEvent;

    handleSttMessage(session, {
      message_type: 'committed_transcript_with_timestamps',
      text: 'Euh, on se...',
      language_code: 'sl',
    });

    expect(isLikelyIncompleteTranscript('Euh, on se...')).toBe(true);
    expect(onEvent).not.toHaveBeenCalled();
    expect(session.sttLanguageCode).toBeUndefined();
  });

  it('ignore un transcript composé uniquement de ponctuation', () => {
    expect(isPunctuationOnlyTranscript('.')).toBe(true);
    expect(isPunctuationOnlyTranscript('…')).toBe(true);
    expect(isPunctuationOnlyTranscript('bonjour.')).toBe(false);

    const session = makeSession();
    const mgr = CallSessionManager.getInstance();
    mgr.transition(session, 'SPEAKING');
    session.isSpeaking = true;
    const onEvent = vi.fn();
    session.onSttEvent = onEvent;

    handleSttMessage(session, { message_type: 'partial_transcript', text: '.' });
    handleSttMessage(session, {
      message_type: 'committed_transcript_with_timestamps',
      text: '.',
      language_code: 'fr',
    });

    expect(session.state).toBe('SPEAKING');
    expect(session.isSpeaking).toBe(true);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('ignore une répétition de bruit et ne coupe pas la réponse TTS', () => {
    const session = makeSession();
    const mgr = CallSessionManager.getInstance();
    mgr.transition(session, 'SPEAKING');
    session.isSpeaking = true;

    handleSttMessage(session, {
      message_type: 'partial_transcript',
      text: 'Waouh, waouh, waouh, waouh, qu',
    });
    handleSttMessage(session, {
      message_type: 'committed_transcript_with_timestamps',
      text: 'Waouh, waouh, waouh, waouh, calme-toi.',
      language_code: 'it',
    });

    expect(isLikelyRepeatedNoiseTranscript('Waouh, waouh, waouh, waouh, calme-toi.')).toBe(true);
    expect(session.state).toBe('SPEAKING');
    expect(session.isSpeaking).toBe(true);
  });

  it('laisse passer une confirmation répétée qui contient un signal métier', () => {
    expect(isLikelyRepeatedNoiseTranscript('Oui oui oui, je confirme.')).toBe(false);
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
      vi.advanceTimersByTime(STT_TIMESTAMPED_COMMIT_GRACE_MS + STT_SPELLING_EOT_GRACE_MS);
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'UtteranceEnd', transcript: 'A K' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('préfère le commit horodaté au commit simple pour éviter un double tour', () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onSttEvent = onEvent;

    handleSttMessage(session, { message_type: 'committed_transcript', text: 'Oui, demain' });
    expect(onEvent).not.toHaveBeenCalled();

    handleSttMessage(session, {
      message_type: 'committed_transcript_with_timestamps',
      text: 'Oui, demain',
      words: [{ word: 'demain', start: 0.2, end: 0.6 }],
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UtteranceEnd',
        transcript: 'Oui, demain',
        words: [{ word: 'demain', start: 0.2, end: 0.6 }],
      }),
    );
  });

  it('propage la langue détectée par Scribe sur le segment final', () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onSttEvent = onEvent;

    handleSttMessage(session, { message_type: 'committed_transcript', text: 'I need a table' });
    handleSttMessage(session, {
      message_type: 'committed_transcript_with_timestamps',
      text: 'I need a table',
      language_code: 'en',
    });

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UtteranceEnd',
        transcript: 'I need a table',
        languageCode: 'en',
      }),
    );
    expect(session.sttLanguageCode).toBe('en');
  });

  it('utilise le commit simple si le commit horodaté ne revient pas', () => {
    vi.useFakeTimers();
    try {
      const session = makeSession();
      const onEvent = vi.fn();
      session.onSttEvent = onEvent;

      handleSttMessage(session, { message_type: 'committed_transcript', text: 'Deux personnes' });
      vi.advanceTimersByTime(STT_TIMESTAMPED_COMMIT_GRACE_MS);

      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UtteranceEnd',
          transcript: 'Deux personnes',
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('remonte les erreurs fournisseur sous forme d’événement applicatif', () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onSttEvent = onEvent;
    handleSttMessage(session, { message_type: 'quota_exceeded', message: 'quota' });
    expect(onEvent).toHaveBeenCalledWith({
      type: 'Unavailable',
      reason: 'quota',
      message: 'elevenlabs_stt provider error (quota_exceeded)',
    });
  });

  it.each([
    ['auth_error', 'auth'],
    ['unaccepted_terms', 'terms'],
  ] as const)('%s est une erreur terminale sans demande de reconnexion', (messageType, reason) => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onSttEvent = onEvent;

    handleSttMessage(session, { message_type: messageType, message: messageType });

    expect(onEvent).toHaveBeenCalledWith({
      type: 'Unavailable',
      reason,
      message: `elevenlabs_stt provider error (${messageType})`,
    });
    expect(session.sttTerminalFailure).toBe(true);
    expect(session.sttFallbackTriggered).toBe(true);
  });

  it.each([
    'transcriber_error',
    'input_error',
    'invalid_request',
    'commit_throttled',
    'queue_overflow',
    'resource_exhausted',
    'session_time_limit_exceeded',
    'chunk_size_exceeded',
    'insufficient_audio_activity',
  ])('remonte l’erreur Scribe %s', (messageType) => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onSttEvent = onEvent;
    handleSttMessage(session, { message_type: messageType, message: messageType });
    expect(onEvent).toHaveBeenCalledWith({
      type: 'Error',
      message: `elevenlabs_stt provider error (${messageType})`,
    });
  });

  it('ignore un avertissement et les entités sans écrire leur contenu dans l’événement vocal', () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onSttEvent = onEvent;
    handleSttMessage(session, { message_type: 'warning', warning: 'warning' });
    handleSttMessage(session, {
      message_type: 'committed_transcript_entities',
      entities: [{ text: 'Hamza', type: 'name', start: 0, end: 5 }],
    });
    expect(onEvent).not.toHaveBeenCalled();
  });

  describe('fin de tour hybride', () => {
    beforeEach(() => {
      process.env.VOICE_SMART_ENDPOINT_ENABLED = 'true';
      delete process.env.VOICE_SMART_ENDPOINT_RESTAURANT_IDS;
      vi.useFakeTimers();
    });
    afterEach(() => {
      delete process.env.VOICE_SMART_ENDPOINT_ENABLED;
      delete process.env.VOICE_SMART_ENDPOINT_RESTAURANT_IDS;
      vi.useRealTimers();
    });

    function commit(session: ReturnType<typeof makeSession>, text: string) {
      handleSttMessage(session, { message_type: 'committed_transcript_with_timestamps', text });
    }
    const utteranceEnds = (onEvent: ReturnType<typeof vi.fn>) =>
      onEvent.mock.calls
        .filter(([event]) => event.type === 'UtteranceEnd')
        .map(([event]) => {
          const { type, transcript, words, languageCode } = event as Extract<
            SttEvent,
            { type: 'UtteranceEnd' }
          >;
          return [
            {
              type,
              transcript,
              ...(words ? { words } : {}),
              ...(languageCode ? { languageCode } : {}),
            },
          ];
        });

    it('respecte le flag et la liste de restaurants', () => {
      const session = makeSession();
      expect(isSmartEndpointEnabled(session)).toBe(true);
      process.env.VOICE_SMART_ENDPOINT_RESTAURANT_IDS = 'autre-resto';
      expect(isSmartEndpointEnabled(session)).toBe(false);
      process.env.VOICE_SMART_ENDPOINT_RESTAURANT_IDS = `autre-resto, ${session.restaurantId}`;
      expect(isSmartEndpointEnabled(session)).toBe(true);
      delete process.env.VOICE_SMART_ENDPOINT_ENABLED;
      expect(isSmartEndpointEnabled(session)).toBe(false);
    });

    it('envoie immédiatement une phrase complète', () => {
      const session = makeSession();
      const onEvent = vi.fn();
      session.onSttEvent = onEvent;
      commit(session, 'Pour deux personnes.');
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UtteranceEnd',
          transcript: 'Pour deux personnes.',
        }),
      );
    });

    it('retient une fin en suspens puis fusionne la reprise en un seul tour', () => {
      const session = makeSession();
      const onEvent = vi.fn();
      session.onSttEvent = onEvent;
      commit(session, 'Demain à');
      expect(utteranceEnds(onEvent)).toHaveLength(0);

      handleSttMessage(session, { message_type: 'partial_transcript', text: 'vingt heures' });
      vi.advanceTimersByTime(SMART_ENDPOINT_HOLD_SUSPENDED_MS * 2);
      expect(utteranceEnds(onEvent)).toHaveLength(0);

      commit(session, 'vingt heures.');
      expect(utteranceEnds(onEvent)).toEqual([
        [{ type: 'UtteranceEnd', transcript: 'Demain à vingt heures.' }],
      ]);
    });

    it('libère le tour retenu à la fin de l’attente', () => {
      const session = makeSession();
      const onEvent = vi.fn();
      session.onSttEvent = onEvent;
      commit(session, 'Ce sera au nom de');
      vi.advanceTimersByTime(SMART_ENDPOINT_HOLD_SUSPENDED_MS - 1);
      expect(utteranceEnds(onEvent)).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(utteranceEnds(onEvent)).toHaveLength(1);
    });

    it('envoie directement quand le flag est coupé', () => {
      delete process.env.VOICE_SMART_ENDPOINT_ENABLED;
      const session = makeSession();
      const onEvent = vi.fn();
      session.onSttEvent = onEvent;
      commit(session, 'Demain à');
      expect(utteranceEnds(onEvent)).toHaveLength(1);
    });
  });

  it.each([
    ['Pour deux personnes.', 0, 'complete'],
    ['oui', 0, 'complete'],
    ["d'accord", 0, 'complete'],
    ['Demain à', SMART_ENDPOINT_HOLD_SUSPENDED_MS, 'suspended'],
    ['demain À,', SMART_ENDPOINT_HOLD_SUSPENDED_MS, 'suspended'],
    ['On sera quatre pour', SMART_ENDPOINT_HOLD_SUSPENDED_MS, 'suspended'],
    ['Ce sera au nom de', SMART_ENDPOINT_HOLD_SUSPENDED_MS, 'suspended'],
    ['Bonjour je suis', SMART_ENDPOINT_HOLD_SUSPENDED_MS, 'suspended'],
    ['Non, plutôt vingt', SMART_ENDPOINT_HOLD_CORRECTION_MS, 'correction'],
    ['Non, plutôt vingt heures.', 0, 'complete'],
    ['Bonjour je suis Martin', SMART_ENDPOINT_HOLD_NO_PUNCTUATION_MS, 'no_punctuation'],
    ['je voudrais réserver une table', SMART_ENDPOINT_HOLD_NO_PUNCTUATION_MS, 'no_punctuation'],
  ])('getSmartEndpointDelay(%s) → %i ms (%s)', (transcript, holdMs, reason) => {
    expect(getSmartEndpointDelay(transcript)).toEqual({ holdMs, reason });
  });
});

describe('Deepgram final dispatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.VOICE_DIALOGUE_LISTENING_V2 = 'true';
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete process.env.VOICE_DIALOGUE_LISTENING_V2;
    delete process.env.VOICE_SMART_ENDPOINT_ENABLED;
  });

  function deepgramSession() {
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
    return { session, onEvent };
  }

  it('dispatches speech_final immediately without the hybrid hold, but retains an incomplete fragment', () => {
    const { session, onEvent } = deepgramSession();
    process.env.VOICE_SMART_ENDPOINT_ENABLED = 'true';
    handleNormalizedSttMessage(session, {
      type: 'final_segment',
      transcript: 'Demain soir',
      speechFinal: true,
      speechEndOffsetMs: 1_000,
    });

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UtteranceEnd',
        transcript: 'Demain soir',
        finalTrigger: 'speech_final',
      }),
    );
    expect(session.sttSemanticHold).toBeNull();

    onEvent.mockClear();
    handleNormalizedSttMessage(session, {
      type: 'final_segment',
      transcript: "Mmh, est-ce que c'est en-",
      speechFinal: true,
    });
    expect(onEvent).not.toHaveBeenCalled();
    expect(session.sttSemanticHold?.transcript).toContain('en-');
    delete process.env.VOICE_SMART_ENDPOINT_ENABLED;
  });

  it('force la sortie du segment quand UtteranceEnd arrive avant tout segment final (appel a8012c5c)', () => {
    const { session, onEvent } = deepgramSession();
    const ws = makeWsMock();
    session.sttWs = ws;
    handleNormalizedSttMessage(session, { type: 'partial', transcript: 'sept frère sept' });
    handleNormalizedSttMessage(session, { type: 'utterance_end', providerLastWordEndMs: 54_170 });

    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'Finalize' }));
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UtteranceEnd' }));

    // Un second UtteranceEnd avant la réponse ne renvoie pas Finalize.
    handleNormalizedSttMessage(session, { type: 'utterance_end' });
    expect(ws.send).toHaveBeenCalledTimes(1);

    handleNormalizedSttMessage(session, {
      type: 'final_segment',
      transcript: 'sept frère sept',
      speechFinal: false,
      fromFinalize: true,
      speechEndOffsetMs: 54_170,
    });
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UtteranceEnd',
        transcript: 'sept frère sept',
        finalTrigger: 'utterance_end_finalize',
      }),
    );
    expect(session.sttDeepgramFinalizeRequested).toBe(false);
  });

  it('conclut plus vite une réponse courte figée quand le délai court est configuré (appel c5d6b07d)', () => {
    vi.useFakeTimers();
    vi.stubEnv('VOICE_DEEPGRAM_SHORT_STALL_FINALIZE_MS', '500');
    const { session } = deepgramSession();
    const ws = makeWsMock();
    session.sttWs = ws;
    handleNormalizedSttMessage(session, { type: 'partial', transcript: '4' });
    vi.advanceTimersByTime(499);
    expect(ws.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'Finalize' }));
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  describe('fin de tour jugée par le modèle', () => {
    function pendingSession(partial: string) {
      vi.useFakeTimers();
      vi.stubEnv('VOICE_STRUCTURED_SEMANTIC_FINALIZE_ENABLED', 'true');
      const { session } = deepgramSession();
      const ws = makeWsMock();
      session.sttWs = ws;
      session.state = 'LISTENING';
      handleNormalizedSttMessage(session, { type: 'partial', transcript: partial });
      return { session, ws };
    }
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.useRealTimers();
    });

    it('envoie Finalize dès que le modèle juge le tour terminé, sans attendre le minuteur', () => {
      const { session, ws } = pendingSession('tout est bon pour moi');
      expect(finalizeOnSemanticEndOfTurn(session, 'tout est bon pour moi', true)).toBe(true);
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'Finalize' }));
    });

    it('ne fait rien quand le modèle juge le tour inachevé : le minuteur reste le filet', () => {
      const { session, ws } = pendingSession('je voudrais');
      expect(finalizeOnSemanticEndOfTurn(session, 'je voudrais', false)).toBe(false);
      expect(ws.send).not.toHaveBeenCalled();
    });

    it('ignore un verdict périmé : la partielle a changé depuis la spéculation', () => {
      const { session, ws } = pendingSession('demain soir');
      handleNormalizedSttMessage(session, {
        type: 'partial',
        transcript: 'demain soir vers vingt',
      });
      expect(finalizeOnSemanticEndOfTurn(session, 'demain soir', true)).toBe(false);
      expect(ws.send).not.toHaveBeenCalled();
    });

    it("n'agit pas pendant que l'agent parle, ni quand la fonction est désactivée", () => {
      const { session, ws } = pendingSession('oui');
      session.state = 'SPEAKING';
      expect(finalizeOnSemanticEndOfTurn(session, 'oui', true)).toBe(false);
      session.state = 'LISTENING';
      vi.stubEnv('VOICE_STRUCTURED_SEMANTIC_FINALIZE_ENABLED', 'false');
      expect(finalizeOnSemanticEndOfTurn(session, 'oui', true)).toBe(false);
      expect(ws.send).not.toHaveBeenCalled();
    });

    it('ne demande Finalize qu’une fois par segment', () => {
      const { session, ws } = pendingSession('très bien merci');
      expect(finalizeOnSemanticEndOfTurn(session, 'très bien merci', true)).toBe(true);
      expect(finalizeOnSemanticEndOfTurn(session, 'très bien merci', true)).toBe(false);
      expect(ws.send).toHaveBeenCalledTimes(1);
    });
  });

  it('garde le délai normal pour une phrase longue même avec le délai court configuré', () => {
    vi.useFakeTimers();
    vi.stubEnv('VOICE_DEEPGRAM_SHORT_STALL_FINALIZE_MS', '500');
    const { session } = deepgramSession();
    const ws = makeWsMock();
    session.sttWs = ws;
    handleNormalizedSttMessage(session, {
      type: 'partial',
      transcript: 'peut-être vers 18 heures',
    });
    vi.advanceTimersByTime(1_199);
    expect(ws.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'Finalize' }));
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('ignore un délai court plus long que le délai normal', () => {
    expect(deepgramShortStallFinalizeMs({ VOICE_DEEPGRAM_SHORT_STALL_FINALIZE_MS: '5000' })).toBe(
      1_200,
    );
    expect(deepgramShortStallFinalizeMs({})).toBe(1_200);
    expect(deepgramShortStallFinalizeMs({ VOICE_DEEPGRAM_SHORT_STALL_FINALIZE_MS: '500' })).toBe(
      500,
    );
  });

  describe('spéculation du tour structuré à la pause de l’appelant', () => {
    beforeEach(() => vi.mocked(speculateStructuredTurn).mockClear());

    it('lit le réglage : 150 ms par défaut, 0 pour l’ancien déclenchement', () => {
      expect(structuredSpeculationPauseMs({})).toBe(150);
      expect(structuredSpeculationPauseMs({ VOICE_STRUCTURED_SPECULATION_PAUSE_MS: '0' })).toBe(0);
      expect(structuredSpeculationPauseMs({ VOICE_STRUCTURED_SPECULATION_PAUSE_MS: '99999' })).toBe(
        150,
      );
    });

    it('attend que l’appelant se taise, puis lance dès la pause, sans délai fixe de 250 ms', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-30T17:00:00Z'));
      const { session } = deepgramSession();
      session.callerVoice = { noiseFloor: 0, voiceRun: 2, lastVoiceAt: Date.now() };
      handleNormalizedSttMessage(session, { type: 'partial', transcript: 'je voudrais réserver' });
      // L'appelant parle encore : rien ne part, même après plus de 250 ms.
      for (let elapsed = 0; elapsed < 400; elapsed += 20) {
        vi.advanceTimersByTime(20);
        session.callerVoice.lastVoiceAt = Date.now();
      }
      expect(speculateStructuredTurn).not.toHaveBeenCalled();
      // Il s'arrête : la spéculation part environ 150 ms plus tard.
      vi.advanceTimersByTime(120);
      expect(speculateStructuredTurn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(80);
      expect(speculateStructuredTurn).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it('ne lance rien pour une partielle périmée : l’appelant a continué', () => {
      vi.useFakeTimers();
      const { session } = deepgramSession();
      session.callerVoice = { noiseFloor: 0, voiceRun: 0, lastVoiceAt: Date.now() - 1_000 };
      handleNormalizedSttMessage(session, { type: 'partial', transcript: 'demain' });
      vi.advanceTimersByTime(30);
      handleNormalizedSttMessage(session, { type: 'partial', transcript: 'demain soir' });
      vi.advanceTimersByTime(300);
      expect(speculateStructuredTurn).toHaveBeenCalledTimes(1);
      expect(vi.mocked(speculateStructuredTurn).mock.calls[0][2]).toBe('demain soir');
      vi.useRealTimers();
    });

    it('garde l’ancien déclenchement sans détecteur de voix ou quand il est désactivé', () => {
      vi.useFakeTimers();
      const { session } = deepgramSession();
      handleNormalizedSttMessage(session, { type: 'partial', transcript: 'oui' });
      vi.advanceTimersByTime(249);
      expect(speculateStructuredTurn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(speculateStructuredTurn).toHaveBeenCalledTimes(1);

      vi.mocked(speculateStructuredTurn).mockClear();
      vi.stubEnv('VOICE_STRUCTURED_SPECULATION_PAUSE_MS', '0');
      session.callerVoice = { noiseFloor: 0, voiceRun: 0, lastVoiceAt: Date.now() - 5_000 };
      handleNormalizedSttMessage(session, { type: 'partial', transcript: 'oui merci' });
      vi.advanceTimersByTime(249);
      expect(speculateStructuredTurn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(speculateStructuredTurn).toHaveBeenCalledTimes(1);
      vi.unstubAllEnvs();
      vi.useRealTimers();
    });
  });

  describe('garde de silence des fins de tour forcées', () => {
    function speaking(session: CallSession, lastVoiceAt: number) {
      session.callerVoice = { noiseFloor: 0, voiceRun: 2, lastVoiceAt };
    }
    // En production, la fin d'une réponse courte (≤ 2 mots) est forcée après 500 ms.
    beforeEach(() => {
      vi.stubEnv('VOICE_DEEPGRAM_SHORT_STALL_FINALIZE_MS', '500');
      return () => vi.unstubAllEnvs();
    });

    it('retarde le Finalize tant que l’appelant parle, puis l’envoie au premier vrai silence (appel 5cebe456)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-30T15:00:00Z'));
      const { session } = deepgramSession();
      const ws = makeWsMock();
      session.sttWs = ws;
      handleNormalizedSttMessage(session, { type: 'partial', transcript: 'plutôt plutôt' });
      // Le minuteur des réponses courtes (2 mots) tombe à 500 ms, l'appelant parle encore.
      vi.setSystemTime(new Date('2026-09-30T15:00:00.400Z'));
      speaking(session, Date.now());
      vi.advanceTimersByTime(100);
      expect(ws.send).not.toHaveBeenCalled();
      // La voix continue 1 s de plus : toujours retenu.
      vi.advanceTimersByTime(300);
      speaking(session, Date.now());
      vi.advanceTimersByTime(300);
      speaking(session, Date.now());
      expect(ws.send).not.toHaveBeenCalled();
      // L'appelant se tait : 350 ms plus tard, la fin de tour part.
      vi.advanceTimersByTime(400);
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'Finalize' }));
      vi.useRealTimers();
    });

    it('rend la main au bout du report maximal quand le bruit empêche tout silence', () => {
      vi.useFakeTimers();
      vi.stubEnv('VOICE_STT_SILENCE_GUARD_MAX_DEFER_MS', '1000');
      const { session } = deepgramSession();
      const ws = makeWsMock();
      session.sttWs = ws;
      handleNormalizedSttMessage(session, { type: 'partial', transcript: 'oui' });
      const noisy = setInterval(() => speaking(session, Date.now()), 20);
      vi.advanceTimersByTime(500 + 900);
      expect(ws.send).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'Finalize' }));
      clearInterval(noisy);
      vi.unstubAllEnvs();
      vi.useRealTimers();
    });

    it('abandonne le report quand la partielle change : l’appelant a continué', () => {
      vi.useFakeTimers();
      const { session } = deepgramSession();
      const ws = makeWsMock();
      session.sttWs = ws;
      handleNormalizedSttMessage(session, { type: 'partial', transcript: 'plutôt' });
      speaking(session, Date.now() + 500);
      vi.advanceTimersByTime(500);
      handleNormalizedSttMessage(session, { type: 'partial', transcript: 'plutôt 18 heures 30' });
      vi.advanceTimersByTime(700);
      expect(ws.send).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    describe('pendant une épellation (appel 8043662c)', () => {
      // Les pauses entre deux groupes de lettres durent souvent plus d'une seconde : une fin de tour forcée à 350 ms
      // de silence coupe l'épellation (« …assam un » jugé fini, le « a » suivant perdu).
      function spellingSession(partial: string, silentMs: number) {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
        vi.stubEnv('VOICE_STRUCTURED_SEMANTIC_FINALIZE_ENABLED', 'true');
        const { session } = deepgramSession();
        const ws = makeWsMock();
        session.sttWs = ws;
        session.state = 'LISTENING';
        session.conversation.pendingQuestion = 'customerName';
        handleNormalizedSttMessage(session, { type: 'partial', transcript: partial });
        speaking(session, Date.now() - silentMs);
        return { session, ws };
      }
      afterEach(() => vi.useRealTimers());

      it('retient la fin de tour jugée par le modèle jusqu’à une vraie pause (1,2 s), pas 428 ms', () => {
        const text = "c'est en nom de de assam un";
        const { session, ws } = spellingSession(text, 428);
        expect(finalizeOnSemanticEndOfTurn(session, text, true)).toBe(false);
        vi.advanceTimersByTime(300);
        expect(ws.send).not.toHaveBeenCalled();
        // La pause dépasse 1,2 s : l'épellation est bien finie.
        vi.advanceTimersByTime(500);
        expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'Finalize' }));
      });

      it('retient aussi la partielle figée d’une réponse courte (« a 2 »), et reprend quand l’appelant continue', () => {
        const { session, ws } = spellingSession('a 2', 100);
        vi.advanceTimersByTime(500);
        expect(ws.send).not.toHaveBeenCalled();
        // L'appelant continue : la partielle change, le report est abandonné.
        handleNormalizedSttMessage(session, { type: 'partial', transcript: 'a 2 s a 2 m' });
        vi.advanceTimersByTime(1_000);
        expect(ws.send).not.toHaveBeenCalled();
      });

      it('ne change rien hors d’une épellation : la garde normale de 350 ms', () => {
        vi.useFakeTimers();
        vi.stubEnv('VOICE_STRUCTURED_SEMANTIC_FINALIZE_ENABLED', 'true');
        const { session } = deepgramSession();
        const ws = makeWsMock();
        session.sttWs = ws;
        session.state = 'LISTENING';
        session.conversation.pendingQuestion = 'time';
        const text = 'plutôt midi 30';
        handleNormalizedSttMessage(session, { type: 'partial', transcript: text });
        speaking(session, Date.now() - 428);
        expect(finalizeOnSemanticEndOfTurn(session, text, true)).toBe(true);
        expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'Finalize' }));
      });

      it('une réponse qui n’est pas de l’épellation (« oui c’est ça ») après la relecture garde la garde normale', () => {
        vi.useFakeTimers();
        vi.stubEnv('VOICE_STRUCTURED_SEMANTIC_FINALIZE_ENABLED', 'true');
        const { session } = deepgramSession();
        const ws = makeWsMock();
        session.sttWs = ws;
        session.state = 'LISTENING';
        session.conversation.pendingQuestion = 'customerName';
        session.structuredTurn = {
          ...createStructuredTurnState(),
          lastAwaiting: 'customerNameConfirmation',
        };
        const text = "oui c'est ça";
        handleNormalizedSttMessage(session, { type: 'partial', transcript: text });
        speaking(session, Date.now() - 428);
        expect(finalizeOnSemanticEndOfTurn(session, text, true)).toBe(true);
      });
    });

    it('ne change rien quand la garde est désactivée ou sans voix mesurée', () => {
      vi.useFakeTimers();
      vi.stubEnv('VOICE_STT_SILENCE_GUARD_MS', '0');
      const { session } = deepgramSession();
      const ws = makeWsMock();
      session.sttWs = ws;
      speaking(session, Date.now());
      handleNormalizedSttMessage(session, { type: 'partial', transcript: 'oui' });
      vi.advanceTimersByTime(500);
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'Finalize' }));
      vi.unstubAllEnvs();
      vi.useRealTimers();
    });
  });

  it('force la fin d’une partielle Deepgram figée (appel 25650799)', () => {
    vi.useFakeTimers();
    const { session, onEvent } = deepgramSession();
    const ws = makeWsMock();
    session.sttWs = ws;
    handleNormalizedSttMessage(session, { type: 'partial', transcript: 'peut-être vers' });
    vi.advanceTimersByTime(800);
    handleNormalizedSttMessage(session, {
      type: 'partial',
      transcript: 'peut-être vers 18 heures 30',
    });
    // La même partielle revient, sans changement : le délai ne repart pas.
    vi.advanceTimersByTime(600);
    handleNormalizedSttMessage(session, {
      type: 'partial',
      transcript: 'peut-être vers 18 heures 30',
    });
    expect(ws.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'Finalize' }));

    handleNormalizedSttMessage(session, {
      type: 'final_segment',
      transcript: 'peut-être vers 18 heures 30',
      speechFinal: false,
      fromFinalize: true,
    });
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UtteranceEnd', finalTrigger: 'stalled_finalize' }),
    );
    vi.useRealTimers();
  });

  it('ne force rien quand Deepgram clôt la phrase à temps', () => {
    vi.useFakeTimers();
    const { session } = deepgramSession();
    const ws = makeWsMock();
    session.sttWs = ws;
    handleNormalizedSttMessage(session, { type: 'partial', transcript: 'cinq personnes' });
    vi.advanceTimersByTime(500);
    handleNormalizedSttMessage(session, {
      type: 'final_segment',
      transcript: 'cinq personnes',
      speechFinal: true,
    });
    vi.advanceTimersByTime(5_000);
    expect(ws.send).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('journalise le rythme des partielles Deepgram sans leur texte', async () => {
    const { logger } = await import('../../../shared/logger/pino');
    const info = vi.spyOn(logger, 'info');
    const { session } = deepgramSession();
    handleNormalizedSttMessage(session, { type: 'partial', transcript: 'on serait' });
    handleNormalizedSttMessage(session, { type: 'partial', transcript: 'on serait' });
    handleNormalizedSttMessage(session, { type: 'partial', transcript: 'on serait quatre' });
    handleNormalizedSttMessage(session, {
      type: 'final_segment',
      transcript: 'on serait quatre',
      speechFinal: true,
    });

    const call = info.mock.calls.find(([, message]) => message === '[stt] Deepgram turn event');
    const fields = call?.[0] as Record<string, unknown>;
    expect(fields).toMatchObject({ partialCount: 3, partialChanges: 2, lastPartialWordCount: 3 });
    expect(typeof fields.msSinceLastPartialChange).toBe('number');
    expect(JSON.stringify(fields)).not.toContain('serait');
    expect(session.sttDeepgramPartials).toBeUndefined();
    info.mockRestore();
  });

  it('n’envoie pas Finalize sans mots en attente, ni ne clôt un segment final ordinaire', () => {
    const { session, onEvent } = deepgramSession();
    const ws = makeWsMock();
    session.sttWs = ws;
    handleNormalizedSttMessage(session, { type: 'utterance_end' });
    expect(ws.send).not.toHaveBeenCalled();

    handleNormalizedSttMessage(session, { type: 'partial', transcript: 'demain' });
    handleNormalizedSttMessage(session, {
      type: 'final_segment',
      transcript: 'demain',
      speechFinal: false,
    });
    expect(session.sttDeepgramPendingInterim).toBe(false);
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UtteranceEnd' }));
    handleNormalizedSttMessage(session, { type: 'utterance_end' });
    expect(ws.send).not.toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: 'demain', finalTrigger: 'utterance_end' }),
    );
  });

  it('does not label the latest Deepgram partial as end-of-speech when word offsets are absent', () => {
    const { session, onEvent } = deepgramSession();
    session.sttLastNonEmptyPartialAt = Date.now() - 2_000;
    handleNormalizedSttMessage(session, {
      type: 'final_segment',
      transcript: 'Demain soir',
      speechFinal: true,
    });

    const committedEvent = onEvent.mock.calls[0]?.[0];
    expect(committedEvent).toMatchObject({ type: 'UtteranceEnd', transcript: 'Demain soir' });
    expect(committedEvent).not.toHaveProperty('speechEndAt');
  });

  it('attend 800 ms au total pour une épellation, endpointing inclus', () => {
    const { session, onEvent } = deepgramSession();
    session.conversation.pendingQuestion = 'customerName';
    handleNormalizedSttMessage(session, {
      type: 'final_segment',
      transcript: 'A K',
      speechFinal: true,
    });

    expect(onEvent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(599);
    expect(onEvent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UtteranceEnd',
        transcript: 'A K',
        finalTrigger: 'spelling_hold',
      }),
    );
  });

  it("n'attend pas d'autres lettres quand la réponse à la relecture n'est pas de l'épellation (appel 8ae1e63e)", () => {
    const { session, onEvent } = deepgramSession();
    session.conversation.pendingQuestion = 'customerName';
    session.structuredTurn = { lastAwaiting: 'customerNameConfirmation' } as never;
    handleNormalizedSttMessage(session, {
      type: 'final_segment',
      transcript: "c'est ça",
      speechFinal: true,
    });
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UtteranceEnd', transcript: "c'est ça" }),
    );
    expect(onEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ finalTrigger: 'spelling_hold' }),
    );
  });

  it('garde l’attente d’épellation quand l’appelant ré-épelle pendant la relecture', () => {
    const { session, onEvent } = deepgramSession();
    session.conversation.pendingQuestion = 'customerName';
    session.structuredTurn = { lastAwaiting: 'customerNameConfirmation' } as never;
    handleNormalizedSttMessage(session, {
      type: 'final_segment',
      transcript: 'non a 2 k',
      speechFinal: true,
    });
    expect(onEvent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ finalTrigger: 'spelling_hold' }),
    );
  });

  it('reconnaît une épellation lettre par lettre sans liste de mots', () => {
    for (const spelled of ['h o u e t', 'a 2 k i f', 'A, K', 'non a k i f', 'h']) {
      expect(looksLikeSpelledLetters(spelled)).toBe(true);
    }
    for (const spoken of ["c'est ça", 'oui exactement', 'au nom de Houet', 'non', '']) {
      expect(looksLikeSpelledLetters(spoken)).toBe(false);
    }
  });

  it('marque utterance_end comme cause de dispatch et conserve ses offsets provider', () => {
    const { session, onEvent } = deepgramSession();
    handleNormalizedSttMessage(session, {
      type: 'final_segment',
      transcript: 'Demain soir',
      speechFinal: false,
      providerResultEndMs: 900,
      providerLastWordEndMs: 800,
      speechEndOffsetMs: 800,
    });
    handleNormalizedSttMessage(session, {
      type: 'utterance_end',
      speechEndOffsetMs: 800,
      providerLastWordEndMs: 800,
    });

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UtteranceEnd',
        finalTrigger: 'utterance_end',
        providerResultEndMs: 900,
        providerLastWordEndMs: 800,
      }),
    );
  });

  it('safety-flush les segments finaux restés en attente avant reconnexion', () => {
    const { session, onEvent } = deepgramSession();
    handleNormalizedSttMessage(session, {
      type: 'final_segment',
      transcript: 'Demain soir',
      speechFinal: false,
      providerResultEndMs: 900,
    });

    flushDeepgramFinalPartsForSafety(session);

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UtteranceEnd', finalTrigger: 'safety_flush' }),
    );
    expect(session.sttDeepgramFinalParts).toEqual([]);
  });

  it('mesure les offsets avec le nombre d’octets effectivement envoyés', () => {
    const { session, onEvent } = deepgramSession();
    const now = Date.now();
    session.sttConnectionAudioStartedAt = now - 1_000;
    session.sttConnectionAudioBytesSent = 800 * 8;
    session.sttTurnStartedAt = now - 500;
    session.sttFirstPartialAt = now - 350;
    session.sttAfterBargeIn = true;

    handleNormalizedSttMessage(session, {
      type: 'final_segment',
      transcript: 'Demain soir',
      speechFinal: true,
      speechEndOffsetMs: 700,
      providerResultEndMs: 750,
      providerLastWordEndMs: 700,
    });

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        speechEndAt: now - 100,
        providerResultEndMs: 750,
        providerLastWordEndMs: 700,
        receivedAtAudioMs: 800,
        audioClockDriftMs: 200,
        firstPartialAt: 150,
        afterBargeIn: true,
      }),
    );
  });
});

describe('assistant echo on Scribe', () => {
  it('supprime une phrase agent sans déclencher de barge-in', () => {
    const session = makeSession();
    session.voiceFeatureSnapshot = {
      sttProvider: 'scribe',
      dialogueListeningV2Enabled: true,
      deepgramModel: 'nova-3',
      deepgramNumeralsEnabled: true,
      deepgramPunctuateEnabled: false,
      deepgramKeytermsEnabled: false,
    };
    session.state = 'SPEAKING';
    session.recentAgentSpeechText =
      'Avec plaisir. Pour combien de personnes souhaitez-vous réserver ?';
    session.agentAudioActive = true;
    const handleBargeIn = vi
      .spyOn(CallSessionManager.getInstance(), 'handleBargeIn')
      .mockImplementation(() => undefined);

    handleSttMessage(session, {
      message_type: 'partial_transcript',
      text: 'Avec plaisir, pour combien de personnes',
    });

    expect(handleBargeIn).not.toHaveBeenCalled();
    expect(session.turnTranscript).toBe('');
  });
});

describe('hold de fin de phrase du routage dialogue V2', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('VOICE_DIALOGUE_LISTENING_V2', 'true');
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const ends = (onEvent: ReturnType<typeof vi.fn>) =>
    onEvent.mock.calls
      .map(([event]) => event)
      .filter((event) => event.type === 'UtteranceEnd')
      .map((event) => ({ type: event.type, transcript: event.transcript }));

  it.each([
    ["Mmh, est-ce que c'est en-", "Mmh, est-ce que c'est en-"],
    ['Euh, mmh', 'Euh, mmh'],
    ['Est-ce que', 'Est-ce que'],
  ])('retient « %s » puis relance à la limite des 900 ms', async (text, expected) => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onSttEvent = onEvent;
    handleSttMessage(session, {
      message_type: 'committed_transcript_with_timestamps',
      text,
    });

    expect(ends(onEvent)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(DIALOGUE_V2_INCOMPLETE_HOLD_MS - 1);
    expect(ends(onEvent)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(ends(onEvent)).toEqual([{ type: 'UtteranceEnd', transcript: expected }]);
  });

  it('fusionne la reprise en une seule phrase, sans répéter le préfixe tronqué', async () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onSttEvent = onEvent;
    handleSttMessage(session, {
      message_type: 'committed_transcript_with_timestamps',
      text: "Mmh, est-ce que c'est en-",
    });
    handleSttMessage(session, {
      message_type: 'partial_transcript',
      text: "Mmh, est-ce que c'est en terrasse ?",
    });
    handleSttMessage(session, {
      message_type: 'committed_transcript_with_timestamps',
      text: "Mmh, est-ce que c'est en terrasse ?",
    });
    await vi.advanceTimersByTimeAsync(DIALOGUE_V2_INCOMPLETE_HOLD_MS + 100);

    expect(ends(onEvent)).toHaveLength(1);
    expect(ends(onEvent)[0]).toEqual({
      type: 'UtteranceEnd',
      transcript: "Mmh, est-ce que c'est en terrasse ?",
    });
  });

  it('laisse toujours interrompre le TTS sur un fragment incomplet', () => {
    const session = makeSession();
    session.state = 'SPEAKING';
    const handleBargeIn = vi
      .spyOn(CallSessionManager.getInstance(), 'handleBargeIn')
      .mockImplementation(() => undefined);
    handleSttMessage(session, {
      message_type: 'partial_transcript',
      text: "Mmh, est-ce que c'est en-",
    });
    expect(handleBargeIn).toHaveBeenCalledOnce();
  });

  it('garde le dispatch immédiat historique quand le flag est coupé', () => {
    vi.stubEnv('VOICE_DIALOGUE_LISTENING_V2', 'false');
    const session = makeSession();
    const onEvent = vi.fn();
    session.onSttEvent = onEvent;
    handleSttMessage(session, {
      message_type: 'committed_transcript_with_timestamps',
      text: "Mmh, est-ce que c'est en-",
    });

    expect(ends(onEvent)).toEqual([
      { type: 'UtteranceEnd', transcript: "Mmh, est-ce que c'est en-" },
    ]);
  });

  it('marque semantic_hold quand le délai hybride déclenche le dispatch', async () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onSttEvent = onEvent;
    handleSttMessage(session, {
      message_type: 'committed_transcript_with_timestamps',
      text: 'Bonjour je suis Martin',
    });

    expect(onEvent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SMART_ENDPOINT_HOLD_NO_PUNCTUATION_MS);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UtteranceEnd', finalTrigger: 'semantic_hold' }),
    );
  });
});

describe('transcription sans voix dans l’audio entrant', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** 20 ms d'audio PCMU : niveau nul, ou signal carré d'amplitude donnée. */
  function frame(amplitude: number): string {
    const pcm = Buffer.alloc(160 * 2);
    for (let index = 0; index < 160; index++)
      pcm.writeInt16LE(index % 2 ? amplitude : -amplitude, index * 2);
    return encodeTelnyxFromPcm16('PCMU', pcm).toString('base64');
  }
  function hear(session: CallSession, amplitude: number, frames: number): void {
    for (let index = 0; index < frames; index++) sendAudioToStt(session, frame(amplitude));
  }
  const ends = (onEvent: ReturnType<typeof vi.fn>) =>
    onEvent.mock.calls.map(([event]) => event).filter((event) => event.type === 'UtteranceEnd');

  it.each(['true', 'false'])(
    'ne laisse pas un texte sans voix interrompre l’agent (routage V2 : %s)',
    (v2) => {
      vi.stubEnv('VOICE_DIALOGUE_LISTENING_V2', v2);
      const session = makeSession();
      session.state = 'SPEAKING';
      const handleBargeIn = vi
        .spyOn(CallSessionManager.getInstance(), 'handleBargeIn')
        .mockImplementation(() => undefined);
      hear(session, 0, 50);

      handleSttMessage(session, { message_type: 'partial_transcript', text: 'bonjour' });

      expect(handleBargeIn).not.toHaveBeenCalled();
      expect(session.turnTranscript).toBe('');
    },
  );

  it.each(['true', 'false'])(
    'laisse interrompre quand l’audio montre une voix (routage V2 : %s)',
    (v2) => {
      vi.stubEnv('VOICE_DIALOGUE_LISTENING_V2', v2);
      const session = makeSession();
      session.state = 'SPEAKING';
      const handleBargeIn = vi
        .spyOn(CallSessionManager.getInstance(), 'handleBargeIn')
        .mockImplementation(() => undefined);
      hear(session, 3_000, 10);

      handleSttMessage(session, { message_type: 'partial_transcript', text: 'bonjour' });

      expect(handleBargeIn).toHaveBeenCalledOnce();
    },
  );

  it.each(['true', 'false'])(
    'n’ouvre aucun tour pour un texte validé sans voix (routage V2 : %s)',
    async (v2) => {
      vi.stubEnv('VOICE_DIALOGUE_LISTENING_V2', v2);
      const session = makeSession();
      const onEvent = vi.fn();
      session.onSttEvent = onEvent;
      hear(session, 0, 50);

      handleSttMessage(session, {
        message_type: 'committed_transcript_with_timestamps',
        text: 'bonjour',
      });
      await vi.advanceTimersByTimeAsync(STT_TIMESTAMPED_COMMIT_GRACE_MS + 2_000);

      expect(ends(onEvent)).toHaveLength(0);
    },
  );

  it('ouvre le tour quand l’audio montre une voix', async () => {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onSttEvent = onEvent;
    hear(session, 3_000, 10);

    handleSttMessage(session, {
      message_type: 'committed_transcript_with_timestamps',
      text: 'bonjour',
    });
    await vi.advanceTimersByTimeAsync(STT_TIMESTAMPED_COMMIT_GRACE_MS + 2_000);

    expect(ends(onEvent)).toHaveLength(1);
  });

  it('garde l’ancien comportement quand la garde est coupée', () => {
    vi.stubEnv('VOICE_REQUIRE_CALLER_VOICE', 'false');
    const session = makeSession();
    session.state = 'SPEAKING';
    const handleBargeIn = vi
      .spyOn(CallSessionManager.getInstance(), 'handleBargeIn')
      .mockImplementation(() => undefined);
    hear(session, 0, 50);

    handleSttMessage(session, { message_type: 'partial_transcript', text: 'bonjour' });

    expect(handleBargeIn).toHaveBeenCalledOnce();
  });
});

describe('texte validé en double d’un tour déjà traité', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const dialogueContext = (session: CallSession) =>
    `${session.conversation?.pendingQuestion ?? ''}|${session.conversation?.lastAssistantQuestion ?? ''}`;
  const ends = (onEvent: ReturnType<typeof vi.fn>) =>
    onEvent.mock.calls.map(([event]) => event).filter((event) => event.type === 'UtteranceEnd');

  /** L'agent répond à « bonjour » (déjà traité) : c'est lui qui parle quand le texte revient. */
  function speakingAfterTurn(transcript = 'bonjour'): CallSession {
    const session = makeSession();
    session.state = 'SPEAKING';
    session.lastProcessedTranscript = transcript;
    session.lastProcessedAt = Date.now();
    session.lastProcessedDialogueContext = dialogueContext(session);
    return session;
  }
  const spyBargeIn = () =>
    vi.spyOn(CallSessionManager.getInstance(), 'handleBargeIn').mockImplementation(() => undefined);

  it.each(['true', 'false'])(
    'ne coupe pas la réponse pour le même texte revenu (routage V2 : %s)',
    async (v2) => {
      vi.stubEnv('VOICE_DIALOGUE_LISTENING_V2', v2);
      const session = speakingAfterTurn();
      const onEvent = vi.fn();
      session.onSttEvent = onEvent;
      const handleBargeIn = spyBargeIn();

      handleSttMessage(session, {
        message_type: 'committed_transcript_with_timestamps',
        text: 'Bonjour.',
      });
      await vi.advanceTimersByTimeAsync(STT_TIMESTAMPED_COMMIT_GRACE_MS + 2_000);

      expect(handleBargeIn).not.toHaveBeenCalled();
      expect(ends(onEvent)).toHaveLength(0);
    },
  );

  it('ne coupe pas la réponse pour une partielle identique au tour déjà traité', () => {
    const session = speakingAfterTurn();
    const handleBargeIn = spyBargeIn();

    handleSttMessage(session, { message_type: 'partial_transcript', text: 'bonjour' });

    expect(handleBargeIn).not.toHaveBeenCalled();
    expect(session.turnTranscript).toBe('');
  });

  it('coupe pour un texte différent du tour traité', () => {
    const session = speakingAfterTurn();
    const handleBargeIn = spyBargeIn();

    handleSttMessage(session, { message_type: 'partial_transcript', text: 'plutôt pour demain' });

    expect(handleBargeIn).toHaveBeenCalledOnce();
  });

  it('coupe pour le même texte une fois la fenêtre de doublon passée', async () => {
    const session = speakingAfterTurn();
    const handleBargeIn = spyBargeIn();
    await vi.advanceTimersByTimeAsync(TRANSCRIPT_DEDUPE_WINDOW_MS + 100);

    handleSttMessage(session, { message_type: 'partial_transcript', text: 'bonjour' });

    expect(handleBargeIn).toHaveBeenCalledOnce();
  });

  it('coupe pour le même texte à une autre étape du dialogue', () => {
    const session = speakingAfterTurn('oui');
    session.lastProcessedDialogueContext = 'customerName|À quel nom ?';
    const handleBargeIn = spyBargeIn();

    handleSttMessage(session, { message_type: 'partial_transcript', text: 'oui' });

    expect(handleBargeIn).toHaveBeenCalledOnce();
  });
});

describe('collecte d’un nom : la pause d’épellation suit la voix de l’appelant', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** Trame PCMU de 40 ms : niveau nul, ou signal carré d'amplitude donnée. */
  function frame(amplitude: number): string {
    const pcm = Buffer.alloc(320);
    for (let index = 0; index < 160; index++)
      pcm.writeInt16LE(index % 2 ? amplitude : -amplitude, index * 2);
    return encodeTelnyxFromPcm16('PCMU', pcm).toString('base64');
  }
  /** L'appelant parle (ou se tait) pendant `ms`, trame par trame, l'horloge avançant avec l'audio. */
  async function caller(session: CallSession, ms: number, amplitude: number): Promise<void> {
    for (let elapsed = 0; elapsed < ms; elapsed += 40) {
      sendAudioToStt(session, frame(amplitude));
      await vi.advanceTimersByTimeAsync(40);
    }
  }
  const ends = (onEvent: ReturnType<typeof vi.fn>) =>
    onEvent.mock.calls.map(([event]) => event).filter((event) => event.type === 'UtteranceEnd');
  function collectingName(): { session: CallSession; onEvent: ReturnType<typeof vi.fn> } {
    const session = makeSession();
    const onEvent = vi.fn();
    session.onSttEvent = onEvent;
    session.conversation.nameCollection.state = 'collecting';
    return { session, onEvent };
  }
  const commit = (session: CallSession, text: string) =>
    handleSttMessage(session, { message_type: 'committed_transcript_with_timestamps', text });

  it('retient le segment tant que l’appelant parle encore, puis le rend quand il se tait', async () => {
    const { session, onEvent } = collectingName();
    await caller(session, 400, 3_000);
    commit(session, 'au nom de wet h');

    await caller(session, 1_200, 3_000);
    expect(ends(onEvent)).toHaveLength(0);

    await caller(session, 1_200, 0);
    expect(ends(onEvent)).toHaveLength(1);
    expect(ends(onEvent)[0].transcript).toBe('au nom de wet h');
  });

  it('recolle le segment suivant d’une épellation coupée en deux : un seul tour', async () => {
    const { session, onEvent } = collectingName();
    await caller(session, 400, 3_000);
    commit(session, 'au nom de wet h');

    await caller(session, 800, 3_000);
    handleSttMessage(session, { message_type: 'partial_transcript', text: 'o u e t' });
    await caller(session, 400, 3_000);
    expect(ends(onEvent)).toHaveLength(0);
    commit(session, 'o u e t');
    await caller(session, 1_500, 0);

    expect(ends(onEvent)).toHaveLength(1);
    expect(ends(onEvent)[0].transcript).toBe('au nom de wet h o u e t');
  });

  it('ne fusionne pas deux lettres doublées de part et d’autre du découpage', async () => {
    const { session, onEvent } = collectingName();
    await caller(session, 400, 3_000);
    commit(session, 'b a l');

    await caller(session, 400, 3_000);
    handleSttMessage(session, { message_type: 'partial_transcript', text: 'l e' });
    commit(session, 'l e');
    await caller(session, 1_500, 0);

    expect(ends(onEvent)[0].transcript).toBe('b a l l e');
  });

  it('ne retient jamais plus de 3 s, même si le bruit ressemble à de la voix', async () => {
    const { session, onEvent } = collectingName();
    await caller(session, 400, 3_000);
    commit(session, 'a k');

    await caller(session, 3_400, 3_000);

    expect(ends(onEvent)).toHaveLength(1);
  });

  it('garde la courte grâce habituelle quand l’appelant se tait déjà', async () => {
    const { session, onEvent } = collectingName();
    await caller(session, 400, 3_000);
    await caller(session, 800, 0);
    commit(session, 'a k');

    await vi.advanceTimersByTimeAsync(STT_TIMESTAMPED_COMMIT_GRACE_MS + STT_SPELLING_EOT_GRACE_MS);

    expect(ends(onEvent)).toHaveLength(1);
  });
});

describe('voix déjà prise en compte par le tour précédent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** Trame PCMU de 40 ms : niveau nul, ou signal carré d'amplitude donnée. */
  function frame(amplitude: number): string {
    const pcm = Buffer.alloc(320);
    for (let index = 0; index < 160; index++)
      pcm.writeInt16LE(index % 2 ? amplitude : -amplitude, index * 2);
    return encodeTelnyxFromPcm16('PCMU', pcm).toString('base64');
  }
  async function caller(session: CallSession, ms: number, amplitude: number): Promise<void> {
    for (let elapsed = 0; elapsed < ms; elapsed += 40) {
      sendAudioToStt(session, frame(amplitude));
      await vi.advanceTimersByTimeAsync(40);
    }
  }
  const spyBargeIn = () =>
    vi.spyOn(CallSessionManager.getInstance(), 'handleBargeIn').mockImplementation(() => undefined);

  /**
   * Appel 6a70dff9 : « pour quatre » est traité, l'agent répond, puis un « 4 » arrive 1,3 s après la
   * fin de la voix de l'appelant (écho de l'agent qui dit « 4 personnes ») et coupe la réponse. La
   * voix reçue pour « pour quatre » ne peut pas servir de preuve pour ce nouveau texte.
   */
  async function afterTreatedTurn(): Promise<CallSession> {
    const session = makeSession();
    await caller(session, 400, 3_000);
    // Fin des mots du tour traité : l'instant où l'appelant se tait.
    session.sttConsumedSpeechEndAt = Date.now();
    session.state = 'SPEAKING';
    return session;
  }

  it('ne prend pas la voix déjà traitée pour la preuve d’un nouveau texte', async () => {
    const session = await afterTreatedTurn();
    const handleBargeIn = spyBargeIn();
    await caller(session, 1_300, 0);

    handleSttMessage(session, { message_type: 'partial_transcript', text: 'quatre' });

    expect(handleBargeIn).not.toHaveBeenCalled();
    expect(session.turnTranscript).toBe('');
  });

  it('accepte le texte quand de la voix nouvelle est arrivée après le tour traité', async () => {
    const session = await afterTreatedTurn();
    const handleBargeIn = spyBargeIn();
    await caller(session, 600, 0);
    await caller(session, 400, 3_000);

    handleSttMessage(session, { message_type: 'partial_transcript', text: 'quatre' });

    expect(handleBargeIn).toHaveBeenCalledOnce();
  });

  it('accepte la voix qui dépasse à peine la fin des mots (souffle, traîne de la dernière syllabe)', async () => {
    const session = await afterTreatedTurn();
    session.sttConsumedSpeechEndAt = Date.now() - 100;
    const handleBargeIn = spyBargeIn();
    await caller(session, 400, 0);
    session.sttConsumedSpeechEndAt = Date.now() - 800;
    await caller(session, 80, 3_000);

    handleSttMessage(session, { message_type: 'partial_transcript', text: 'oui' });

    expect(handleBargeIn).toHaveBeenCalledOnce();
  });
});

describe('assemblage des segments autour d’une épellation (appel 3ba7c66f)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('VOICE_DIALOGUE_LISTENING_V2', 'true');
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function deepgramSession() {
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
    session.conversation.nameCollection.state = 'collecting';
    return { session, onEvent };
  }
  const ends = (onEvent: ReturnType<typeof vi.fn>) =>
    onEvent.mock.calls
      .map(([event]) => event)
      .filter((event) => event.type === 'UtteranceEnd')
      .map((event) => ({ transcript: event.transcript, trigger: event.finalTrigger }));
  const segment = (
    session: CallSession,
    transcript: string,
    speechFinal: boolean,
    extra: { fromFinalize?: boolean } = {},
  ) =>
    handleNormalizedSttMessage(session, {
      type: 'final_segment',
      transcript,
      speechFinal,
      ...extra,
    });

  it('un segment inachevé avant l’épellation part avec elle, et ne se recolle pas au tour suivant', async () => {
    const { session, onEvent } = deepgramSession();
    // « ce serait bien au nom de » : final non terminal, puis UtteranceEnd (le texte est retenu comme inachevé).
    segment(session, 'ce serait bien au nom de', false);
    handleNormalizedSttMessage(session, { type: 'utterance_end' });
    expect(session.sttSemanticHold?.transcript).toContain('au nom de');

    // L'épellation arrive dans un autre segment : le segment retenu fait partie du même tour.
    segment(session, 'de assam a 2 s a m', true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ends(onEvent)).toEqual([
      { transcript: 'ce serait bien au nom de assam a 2 s a m', trigger: 'spelling_hold' },
    ]);
    expect(session.sttSemanticHold).toBeNull();

    // Le tour suivant ne porte que ce que l'appelant vient de dire.
    session.conversation.nameCollection.state = 'idle';
    segment(session, 'non non', true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ends(onEvent).map((entry) => entry.transcript)).toEqual([
      'ce serait bien au nom de assam a 2 s a m',
      'non non',
    ]);
  });

  it('une lettre qui interrompt l’agent se recolle à l’épellation retenue, même si le dialogue n’attend plus le nom', async () => {
    const { session, onEvent } = deepgramSession();
    const handleBargeIn = vi
      .spyOn(CallSessionManager.getInstance(), 'handleBargeIn')
      .mockImplementation(() => undefined);
    segment(session, 'a 2 s', true, { fromFinalize: true });
    expect(session.pendingSttEndOfTurn?.transcript).toBe('a 2 s');

    // Entre-temps le modèle a répondu sans attendre le nom (doute) : la collecte n'est plus active.
    session.conversation.nameCollection.state = 'idle';
    session.state = 'SPEAKING';
    segment(session, 'a', true);

    expect(handleBargeIn).toHaveBeenCalledOnce();
    // Ni la lettre seule ni l'épellation retenue ne partent dans le désordre.
    expect(ends(onEvent)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ends(onEvent)).toEqual([{ transcript: 'a 2 s a', trigger: 'spelling_hold' }]);
  });

  it('une lettre isolée sans épellation retenue reste un tour à part', async () => {
    const { session, onEvent } = deepgramSession();
    session.conversation.nameCollection.state = 'idle';
    segment(session, 'a', true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ends(onEvent).map((entry) => entry.transcript)).toEqual(['a']);
  });
});

describe('mot seul peu sûr : ni interruption, ni tour (appel f2200632)', () => {
  function greetingSession() {
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
    session.state = 'SPEAKING';
    session.greetingPlaying = true;
    const handleBargeIn = vi
      .spyOn(CallSessionManager.getInstance(), 'handleBargeIn')
      .mockImplementation(() => undefined);
    return { session, onEvent, handleBargeIn };
  }
  const rouge = [{ word: 'rouge', confidence: 0.278, start: 0.48, end: 0.88 }];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('une partielle « rouge » à 0,28 ne coupe pas l’accueil', () => {
    const { session, handleBargeIn } = greetingSession();
    handleNormalizedSttMessage(session, { type: 'partial', transcript: 'rouge', words: rouge });
    expect(handleBargeIn).not.toHaveBeenCalled();
  });

  it('une partielle de plusieurs mots coupe l’accueil, même peu sûre', () => {
    const { session, handleBargeIn } = greetingSession();
    handleNormalizedSttMessage(session, {
      type: 'partial',
      transcript: 'je voudrais réserver',
      words: [
        { word: 'je', confidence: 0.3, start: 0, end: 0.1 },
        { word: 'voudrais', confidence: 0.3, start: 0.1, end: 0.3 },
        { word: 'réserver', confidence: 0.3, start: 0.3, end: 0.6 },
      ],
    });
    expect(handleBargeIn).toHaveBeenCalledTimes(1);
  });

  it('une partielle d’un mot sûr coupe l’accueil', () => {
    const { session, handleBargeIn } = greetingSession();
    handleNormalizedSttMessage(session, {
      type: 'partial',
      transcript: 'allô',
      words: [{ word: 'allô', confidence: 0.92, start: 0, end: 0.3 }],
    });
    expect(handleBargeIn).toHaveBeenCalledTimes(1);
  });

  it('le même mot validé comme texte final n’ouvre aucun tour, même hors accueil', () => {
    const { session, onEvent, handleBargeIn } = greetingSession();
    session.state = 'LISTENING';
    session.greetingPlaying = false;
    handleNormalizedSttMessage(session, {
      type: 'final_segment',
      transcript: 'rouge',
      words: rouge,
      speechFinal: true,
      speechEndOffsetMs: 880,
    });
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UtteranceEnd' }));
    expect(handleBargeIn).not.toHaveBeenCalled();
  });

  it('un mot sûr reste un tour', () => {
    const { session, onEvent } = greetingSession();
    session.state = 'LISTENING';
    session.greetingPlaying = false;
    handleNormalizedSttMessage(session, {
      type: 'final_segment',
      transcript: 'oui',
      words: [{ word: 'oui', confidence: 0.95, start: 0.1, end: 0.4 }],
      speechFinal: true,
      speechEndOffsetMs: 400,
    });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'UtteranceEnd' }));
  });
});

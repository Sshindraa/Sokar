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
  setSttSpellingProfile,
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
} from '../stream/stt-bridge';
import { createDeepgramSttAdapter } from '../stream/stt-provider-adapter';

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
    expect(url.searchParams.get('endpointing')).toBe('300');
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

  it('active le profil d’épellation sans envoyer de commande non supportée par Scribe', () => {
    const session = makeSession();
    const ws = makeWsMock();
    session.sttWs = ws;
    setSttSpellingProfile(session, true);
    expect(session.sttTurnConfig?.spellingActive).toBe(true);
    expect(ws.send).not.toHaveBeenCalled();
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

    it('utilise un silence Scribe de 0,5 s seulement quand le flag est actif', () => {
      const session = makeSession();
      setSttSpellingProfile(session, false);
      expect(session.sttTurnConfig?.base.vadSilenceThresholdSecs).toBe(0.5);
      delete process.env.VOICE_SMART_ENDPOINT_ENABLED;
      const legacy = makeSession({ callControlId: 'cc-stt-legacy' });
      setSttSpellingProfile(legacy, false);
      expect(legacy.sttTurnConfig?.base.vadSilenceThresholdSecs).toBe(0.95);
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
    vi.advanceTimersByTime(499);
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

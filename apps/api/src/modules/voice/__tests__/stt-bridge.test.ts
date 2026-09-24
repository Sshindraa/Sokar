import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { CallSession } from '../stream/types';
import { CallSessionManager } from '../stream/manager';
import {
  buildSttUrl,
  buildSttKeyterms,
  buildSttPreviousText,
  DEFAULT_STT_LANGUAGES,
  getSttLanguageCodes,
  sendAudioToStt,
  STT_AUDIO_BUFFER_MAX,
  handleSttMessage,
  setSttSpellingProfile,
  STT_SPELLING_EOT_GRACE_MS,
  STT_TIMESTAMPED_COMMIT_GRACE_MS,
  getSmartEndpointDelay,
  isSmartEndpointEnabled,
  SMART_ENDPOINT_HOLD_CORRECTION_MS,
  SMART_ENDPOINT_HOLD_NO_PUNCTUATION_MS,
  SMART_ENDPOINT_HOLD_SUSPENDED_MS,
  isLikelyIncompleteTranscript,
  isLikelyRepeatedNoiseTranscript,
  isPunctuationOnlyTranscript,
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
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      type: 'UtteranceEnd',
      transcript: 'Je voudrais réserver',
      words: [{ word: 'réserver', start: 0.5, end: 1.1 }],
    });
    expect(session.turnTranscript).toBe('');
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
      expect(onEvent).toHaveBeenCalledWith({ type: 'UtteranceEnd', transcript: 'A K' });
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
    expect(onEvent).toHaveBeenCalledWith({
      type: 'UtteranceEnd',
      transcript: 'Oui, demain',
      words: [{ word: 'demain', start: 0.2, end: 0.6 }],
    });
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

    expect(onEvent).toHaveBeenCalledWith({
      type: 'UtteranceEnd',
      transcript: 'I need a table',
      languageCode: 'en',
    });
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

      expect(onEvent).toHaveBeenCalledWith({
        type: 'UtteranceEnd',
        transcript: 'Deux personnes',
      });
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

  it.each([
    'transcriber_error',
    'input_error',
    'invalid_request',
    'commit_throttled',
    'unaccepted_terms',
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
    expect(onEvent).toHaveBeenCalledWith({ type: 'Error', message: messageType });
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
      onEvent.mock.calls.filter(([event]) => event.type === 'UtteranceEnd');

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
      expect(onEvent).toHaveBeenCalledWith({
        type: 'UtteranceEnd',
        transcript: 'Pour deux personnes.',
      });
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

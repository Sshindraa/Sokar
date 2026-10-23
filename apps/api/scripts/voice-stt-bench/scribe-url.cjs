/**
 * URL ElevenLabs Scribe Realtime pour le banc STT.
 *
 * Scribe n'est plus utilisé en production (Deepgram, avec Cartesia Ink-2 en secours) : le constructeur d'URL
 * a quitté `stt-bridge.ts` et vit ici, pour que le banc continue de mesurer Scribe comme référence.
 * Les paramètres sont ceux de l'ancienne production (VAD, `commit_strategy`, langues secondaires, `keyterms`).
 *
 * Variables lues : `ELEVENLABS_STT_HOST` (hôte, défaut `api.elevenlabs.io`). Les anciens réglages
 * `ELEVENLABS_STT_LANGUAGES`, `ELEVENLABS_STT_VAD_SILENCE_SECS`, `ELEVENLABS_STT_MIN_*` ne sont plus lus :
 * passez `languages` dans les options, ou modifiez l'URL renvoyée (voir `nb-run.ts`).
 */
const path = require('node:path');

const { buildSttKeyterms } = require(
  path.resolve(__dirname, '../../dist/modules/voice/stream/stt-keyterms.js'),
);

const DEFAULT_MODEL = 'scribe_v2_realtime';
const REALTIME_PATH = '/v1/speech-to-text/realtime';
const DEFAULT_LANGUAGES = ['fr', 'en'];
const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}$/u;
/** Alias acceptés dans les options, ramenés aux codes de Scribe. */
const LANGUAGE_ALIASES = { tl: 'fil', zh: 'zho', ja: 'jpn', ko: 'kor' };

const TURN_CONFIG = {
  vadSilenceThresholdSecs: 0.95,
  minSpeechDurationMs: 80,
  minSilenceDurationMs: 220,
};

function audioFormatForCodec(codec) {
  if (codec === 'PCMU') return 'ulaw_8000';
  return codec === 'L16' ? 'pcm_16000' : 'pcm_8000';
}

function normalizeLanguage(value) {
  const normalized = String(value).trim().toLowerCase();
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

/**
 * @param {string} [model]
 * @param {'PCMA' | 'PCMU' | 'L16'} [codec]
 * @param {unknown} [_turnConfig] conservé pour la signature historique, ignoré
 * @param {{ restaurantName?: string, keyterms?: readonly string[], languages?: readonly string[],
 *   filterBackgroundAudio?: boolean, forceFrench?: boolean }} [options]
 */
function buildSttUrl(model = DEFAULT_MODEL, codec = 'PCMU', _turnConfig, options = {}) {
  const params = new URLSearchParams({
    model_id: model,
    audio_format: audioFormatForCodec(codec),
    commit_strategy: 'vad',
    vad_silence_threshold_secs: String(TURN_CONFIG.vadSilenceThresholdSecs),
    vad_threshold: '0.4',
    min_speech_duration_ms: String(TURN_CONFIG.minSpeechDurationMs),
    min_silence_duration_ms: String(TURN_CONFIG.minSilenceDurationMs),
    // Scribe refuse `filter_background_audio` avec `include_timestamps`.
    ...(!options.filterBackgroundAudio ? { include_timestamps: 'true' } : {}),
    include_language_detection: options.forceFrench ? 'false' : 'true',
  });

  if (options.forceFrench) {
    params.set('language_code', 'fr');
  } else {
    for (const language of options.languages ?? DEFAULT_LANGUAGES) {
      const normalized = normalizeLanguage(language);
      if (LANGUAGE_CODE_PATTERN.test(normalized)) params.append('secondary_languages', normalized);
    }
  }
  if (options.filterBackgroundAudio) params.set('filter_background_audio', 'true');
  for (const keyterm of buildSttKeyterms(options.restaurantName, options.keyterms)) {
    params.append('keyterms', keyterm);
  }
  const host = process.env.ELEVENLABS_STT_HOST ?? 'api.elevenlabs.io';
  return 'wss://' + host + REALTIME_PATH + '?' + params.toString();
}

module.exports = { buildSttUrl };

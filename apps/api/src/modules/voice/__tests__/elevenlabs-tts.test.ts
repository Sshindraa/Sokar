import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildElevenLabsCacheVariant,
  buildElevenLabsTtsRequest,
  elevenLabsLanguageCode,
  elevenLabsOutputFormat,
  elevenLabsTtsModel,
  elevenLabsTtsStreamingEnabled,
  elevenLabsTtsVoiceId,
  telephonyTtsProvider,
} from '../stream/elevenlabs-tts';
import { buildCartesiaCacheVariant } from '../stream/cartesia-config';

const placeholderCredential = 'unit-test-placeholder-credential';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('elevenlabs-tts : format de sortie natif pour Telnyx', () => {
  it('associe chaque profil Telnyx à son format ElevenLabs natif', () => {
    expect(elevenLabsOutputFormat('alaw8k')).toBe('alaw_8000');
    expect(elevenLabsOutputFormat('mulaw8k')).toBe('ulaw_8000');
    expect(elevenLabsOutputFormat('pcm16k')).toBe('pcm_16000');
  });

  it('refuse un profil inconnu plutôt que d’envoyer un format erroné', () => {
    expect(() => elevenLabsOutputFormat('mp3')).toThrow('Format ElevenLabs inconnu');
  });
});

describe('elevenlabs-tts : requête de synthèse', () => {
  const request = {
    apiKey: placeholderCredential,
    voiceId: 'voix/42',
    model: 'eleven_v4_turbo',
    text: 'Bonjour, je vous écoute.',
    locale: 'fr-FR',
    codec: 'mulaw8k',
  };

  it('appelle le point de synthèse de la voix, avec le format natif en paramètre', () => {
    const built = buildElevenLabsTtsRequest(request);

    expect(built.url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voix%2F42?output_format=ulaw_8000',
    );
  });

  it('transmet la clé dans l’en-tête seulement, jamais dans l’URL ni dans le corps', () => {
    const built = buildElevenLabsTtsRequest(request);

    expect(built.headers['xi-api-key']).toBe(placeholderCredential);
    expect(built.url).not.toContain(placeholderCredential);
    expect(built.body).not.toContain(placeholderCredential);
  });

  it('envoie le texte, le modèle, la langue et la normalisation du texte', () => {
    const body = JSON.parse(buildElevenLabsTtsRequest(request).body);

    expect(body).toEqual({
      text: 'Bonjour, je vous écoute.',
      model_id: 'eleven_v4_turbo',
      language_code: 'fr',
      apply_text_normalization: 'on',
    });
  });
});

describe('elevenlabs-tts : langue et clé de cache', () => {
  it('dérive le code langue ISO 639-1 de la locale', () => {
    expect(elevenLabsLanguageCode('fr-FR')).toBe('fr');
    expect(elevenLabsLanguageCode('en-US')).toBe('en');
    expect(elevenLabsLanguageCode('')).toBe('fr');
  });

  it('ne partage jamais une clé de cache avec Cartesia, même pour la même phrase et le même codec', () => {
    const elevenLabsKey = buildElevenLabsCacheVariant({
      voiceId: 'voix-1',
      model: 'eleven_v4_turbo',
      locale: 'fr-FR',
      codec: 'mulaw8k',
    });
    const cartesiaKey = buildCartesiaCacheVariant({
      voiceId: 'voix-1',
      locale: 'fr-FR',
      codec: 'mulaw8k',
    });

    expect(elevenLabsKey.startsWith('elevenlabs|')).toBe(true);
    expect(elevenLabsKey).not.toBe(cartesiaKey);
  });

  it('change de clé quand le modèle change, pour ne pas réutiliser un ancien snapshot', () => {
    const v4 = buildElevenLabsCacheVariant({
      voiceId: 'voix-1',
      model: 'eleven_v4_turbo',
      locale: 'fr-FR',
      codec: 'alaw8k',
    });
    const other = buildElevenLabsCacheVariant({
      voiceId: 'voix-1',
      model: 'eleven_multilingual_v2',
      locale: 'fr-FR',
      codec: 'alaw8k',
    });

    expect(v4).not.toBe(other);
  });
});

describe('elevenlabs-tts : sélection du fournisseur', () => {
  it('reste sur Cartesia tant que la variable n’est pas positionnée', () => {
    vi.stubEnv('VOICE_TTS_PROVIDER', '');

    expect(telephonyTtsProvider()).toBe('cartesia');
  });

  it('bascule sur ElevenLabs seulement avec VOICE_TTS_PROVIDER=elevenlabs', () => {
    vi.stubEnv('VOICE_TTS_PROVIDER', 'elevenlabs');
    expect(telephonyTtsProvider()).toBe('elevenlabs');

    vi.stubEnv('VOICE_TTS_PROVIDER', 'deepgram');
    expect(telephonyTtsProvider()).toBe('cartesia');
  });

  it('utilise le modèle v4 turbo par défaut et lit la voix configurée', () => {
    vi.stubEnv('ELEVENLABS_TTS_MODEL', '');
    vi.stubEnv('ELEVENLABS_TTS_VOICE_ID', '  voix-test  ');

    expect(elevenLabsTtsModel()).toBe('eleven_v4_turbo');
    expect(elevenLabsTtsVoiceId()).toBe('voix-test');
  });

  it('n’a pas de voix ElevenLabs tant qu’elle n’est pas configurée', () => {
    vi.stubEnv('ELEVENLABS_TTS_VOICE_ID', '');

    expect(elevenLabsTtsVoiceId()).toBeNull();
  });
});

describe('elevenlabs-tts : synthèse en flux (drapeau ELEVENLABS_TTS_STREAMING)', () => {
  const request = {
    apiKey: placeholderCredential,
    voiceId: 'voix-1',
    model: 'eleven_v4_turbo',
    text: 'Bonjour, je vous écoute.',
    locale: 'fr-FR',
    codec: 'alaw8k',
  };

  it('reste sur le point de synthèse classique quand le drapeau est absent', () => {
    vi.stubEnv('ELEVENLABS_TTS_STREAMING', '');

    expect(elevenLabsTtsStreamingEnabled()).toBe(false);
    expect(buildElevenLabsTtsRequest(request).url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voix-1?output_format=alaw_8000',
    );
  });

  it('passe sur /stream quand le drapeau vaut exactement true', () => {
    vi.stubEnv('ELEVENLABS_TTS_STREAMING', 'true');

    expect(elevenLabsTtsStreamingEnabled()).toBe(true);
    expect(buildElevenLabsTtsRequest({ ...request, streaming: true }).url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voix-1/stream?output_format=alaw_8000',
    );
  });

  it('refuse les autres valeurs du drapeau', () => {
    for (const value of ['TRUE', '1', 'yes', 'oui']) {
      vi.stubEnv('ELEVENLABS_TTS_STREAMING', value);
      expect(elevenLabsTtsStreamingEnabled()).toBe(false);
    }
  });

  it('ne change ni les en-têtes ni le corps de la requête', () => {
    const classic = buildElevenLabsTtsRequest(request);
    const streamed = buildElevenLabsTtsRequest({ ...request, streaming: true });

    expect(streamed.headers).toEqual(classic.headers);
    expect(streamed.body).toBe(classic.body);
    expect(streamed.url).not.toContain(placeholderCredential);
  });
});

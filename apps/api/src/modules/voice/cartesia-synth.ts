/**
 * Synthèse vocale Cartesia — fonction pure réutilisable.
 *
 * Contrairement à `stream/fillers-cache.ts` et `stream/handler.ts` qui
 * utilisent `/tts/sse` pour streamer du G.711 8kHz vers Telnyx en temps réel
 * pendant un appel, ce module utilise `/tts/bytes` (HTTP one-shot) qui
 * retourne un fichier audio complet (MP3 24kHz) directement jouable dans
 * un navigateur via `<audio>`.
 *
 * Cas d'usage : endpoint démo onboarding, previews, exports audio.
 * Pas de dépendance Telnyx, pas de WebSocket, pas de codec télécom.
 */
import { DEFAULT_CARTESIA_VOICE_ID, CARTESIA_MODEL } from '@sokar/config';
import { logger } from '../../shared/logger/pino';
import {
  CARTESIA_NORMALIZATION,
  clampCartesiaSpeed,
  clampCartesiaVolume,
  type CartesiaGenerationConfig,
} from './stream/cartesia-config';
import { normalizeVoiceLocale } from './stream/voice-language';

export type CartesiaFormat = {
  container: 'mp3' | 'wav' | 'raw';
  encoding: 'mp3' | 'pcm_s16le' | 'pcm_alaw' | 'pcm_mulaw';
  sampleRate: 8000 | 16000 | 22050 | 24000 | 44100;
};

export const DEFAULT_WEB_FORMAT: CartesiaFormat = {
  container: 'mp3',
  encoding: 'mp3',
  sampleRate: 24000,
};

export type SynthesizeOptions = {
  text: string;
  voiceId?: string;
  format?: CartesiaFormat;
  /** Vitesse de parole (0.5–2.0). Defaults to 1.0 (Cartesia native). */
  speed?: number;
  /** Locale BCP-47 Cartesia (ex. fr-FR, en-US). */
  locale?: string;
  normalization?: 'auto' | 'off' | string;
  volume?: number;
  emotion?: string;
  pronunciationDictId?: string;
};

export function isCartesiaConfigured(): boolean {
  return Boolean(process.env.CARTESIA_API_KEY);
}

/**
 * Synthétise un texte en audio via le modèle Cartesia configuré.
 *
 * @returns Buffer audio (MP3 par défaut) ou null si Cartesia n'est pas
 *          configurée (CARTESIA_API_KEY absente). Le caller doit gérer le
 *          fallback transcript-only quand le retour est null.
 */
export async function synthesizeText(opts: SynthesizeOptions): Promise<Buffer | null> {
  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) {
    logger.warn('[cartesia-synth] CARTESIA_API_KEY absente — retour null (fallback transcript)');
    return null;
  }

  const voiceId = opts.voiceId ?? process.env.CARTESIA_VOICE_ID ?? DEFAULT_CARTESIA_VOICE_ID;
  const format = opts.format ?? DEFAULT_WEB_FORMAT;
  const speed = clampCartesiaSpeed(opts.speed);
  const volume = clampCartesiaVolume(opts.volume);
  const generationConfig: CartesiaGenerationConfig | undefined =
    speed === undefined && volume === undefined && !opts.emotion?.trim()
      ? undefined
      : {
          ...(speed === undefined ? {} : { speed }),
          ...(volume === undefined ? {} : { volume }),
          ...(opts.emotion?.trim() ? { emotion: opts.emotion.trim() } : {}),
        };
  const locale = normalizeVoiceLocale(opts.locale ?? 'fr-FR') ?? 'fr-FR';
  const pronunciationDictId =
    opts.pronunciationDictId?.trim() ||
    process.env.CARTESIA_PRONUNCIATION_DICT_ID?.trim() ||
    undefined;

  const response = await fetch('https://api.cartesia.ai/tts/bytes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cartesia-Version': '2026-03-01',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      model_id: CARTESIA_MODEL,
      transcript: opts.text,
      voice: { mode: 'id', id: voiceId },
      locale,
      normalization: opts.normalization ?? CARTESIA_NORMALIZATION,
      ...(generationConfig ? { generation_config: generationConfig } : {}),
      ...(pronunciationDictId ? { pronunciation_dict_id: pronunciationDictId } : {}),
      output_format: {
        container: format.container,
        encoding: format.encoding,
        sample_rate: format.sampleRate,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Cartesia TTS ${response.status}: ${detail.slice(0, 200)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

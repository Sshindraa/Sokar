import { DEFAULT_CARTESIA_VOICE_ID, CARTESIA_MODEL } from '@sokar/config';
import type { CallSession } from './types';

export const CARTESIA_NORMALIZATION = 'auto' as const;

export type CartesiaGenerationConfig = {
  speed?: number;
  volume?: number;
  emotion?: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampCartesiaSpeed(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) return undefined;
  const speed = clamp(value, 0.6, 1.5);
  return Math.abs(speed - 1) < 0.001 ? undefined : Number(speed.toFixed(3));
}

export function clampCartesiaVolume(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) return undefined;
  return Number(clamp(value, 0.5, 2).toFixed(3));
}

export function getCartesiaGenerationConfig(
  session: Pick<CallSession, 'personality'>,
): CartesiaGenerationConfig | undefined {
  const speed = clampCartesiaSpeed(session.personality?.speakingRate ?? undefined);
  const volume = clampCartesiaVolume(session.personality?.volume ?? undefined);
  const emotion = session.personality?.emotion?.trim() || undefined;
  if (speed === undefined && volume === undefined && emotion === undefined) return undefined;
  return {
    ...(speed === undefined ? {} : { speed }),
    ...(volume === undefined ? {} : { volume }),
    ...(emotion === undefined ? {} : { emotion }),
  };
}

export function getCartesiaVoiceId(session?: {
  personality?: { voiceIdCa?: string | null } | null;
}): string {
  return (
    session?.personality?.voiceIdCa?.trim() ||
    process.env.CARTESIA_VOICE_ID?.trim() ||
    DEFAULT_CARTESIA_VOICE_ID
  );
}

export function getCartesiaPronunciationDictId(session?: {
  personality?: { pronunciationDictId?: string | null } | null;
}): string | undefined {
  return (
    session?.personality?.pronunciationDictId?.trim() ||
    process.env.CARTESIA_PRONUNCIATION_DICT_ID?.trim() ||
    undefined
  );
}

/**
 * Empreinte commune aux caches audio. Elle invalide automatiquement les
 * buffers quand le modèle, la locale, la voix ou un réglage de génération
 * change, sans jamais stocker le texte ou un secret dans Redis.
 */
export function buildCartesiaCacheVariant(options: {
  voiceId: string;
  locale: string;
  codec: string;
  generationConfig?: CartesiaGenerationConfig;
  pronunciationDictId?: string;
}): string {
  return [
    options.voiceId,
    CARTESIA_MODEL,
    options.locale,
    CARTESIA_NORMALIZATION,
    options.codec,
    JSON.stringify(options.generationConfig ?? {}),
    options.pronunciationDictId ?? '',
  ].join('|');
}

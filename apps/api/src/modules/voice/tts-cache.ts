import crypto from 'crypto';
import { redisCache } from '../../shared/redis/client';
import { TTS_CACHE_TTL_SECONDS, TTS_CACHE_MIN_LENGTH } from '@sokar/config';

const isTtsCacheEnabled = () => process.env.TTS_CACHE_ENABLED === 'true';

function cacheKey(text: string, voiceId: string): string {
  const hash = crypto.createHash('sha256').update(text + '|' + voiceId).digest('hex').slice(0, 16);
  return `tts:${hash}`;
}

export async function getTtsCached(text: string, voiceId: string): Promise<Buffer | null> {
  if (!isTtsCacheEnabled() || text.length < TTS_CACHE_MIN_LENGTH) return null;
  const raw = await redisCache.getBuffer(cacheKey(text, voiceId));
  return raw ?? null;
}

export async function setTtsCached(text: string, voiceId: string, audio: Buffer): Promise<void> {
  if (!isTtsCacheEnabled() || text.length < TTS_CACHE_MIN_LENGTH) return;
  await redisCache.set(cacheKey(text, voiceId), audio, 'EX', TTS_CACHE_TTL_SECONDS);
}

export const WARMUP_PHRASES = [
  'Un instant, je vérifie ça pour vous...',
  'Bien sûr, avec plaisir.',
  'Je vous transfère immédiatement.',
  'Réservation confirmée !',
  'Nous sommes fermés ce créneau.',
  'Pouvez-vous répéter s\'il vous plaît ?',
];

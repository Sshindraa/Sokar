/**
 * Pré-génération des greetings audio par restaurant au boot.
 *
 * Le greeting "Bonjour, ici {restaurant}. Je vous écoute." est la première
 * chose que le client entend. Sans cache, il faut ~400-800ms pour le
 * synthétiser via Cartesia au premier appel. En pré-générant au boot et en
 * cachant dans Redis (via le TTS cache existant), le greeting devient un
 * cache hit instantané (~2ms lookup Redis).
 *
 * Stratégie :
 * 1. Au boot, charger tous les restaurants actifs depuis la DB
 * 2. Pour chaque restaurant, appliquer le même pipeline que speakTtsStreamed
 *    (cleanTextForTts → addNaturalPauses → split en phrases)
 * 3. Pour chaque phrase, générer l'audio via Cartesia et cacher dans Redis
 *    via setTtsCached (même cache que le TTS runtime)
 * 4. Au runtime, speakTtsStreamed trouve un cache hit pour chaque phrase
 *    → playback immédiat (~2ms Redis lookup vs ~400-800ms Cartesia synthesis)
 *
 * IMPORTANT : Le pipeline de transformation du texte (clean + pauses + split)
 * doit être identique à celui de speakTtsStreamed, sinon les clés de cache
 * ne correspondront pas.
 */
import { db } from '../../../shared/db/client';
import { logger } from '../../../shared/logger/pino';
import { getTtsCached, setTtsCached } from '../tts-cache';
import { cleanTextForTts, addNaturalPauses } from './tts-handler';
import { DEFAULT_CARTESIA_VOICE_ID } from '@sokar/config';

/**
 * Construit le texte du greeting pour un restaurant.
 * Doit être identique à buildInitialGreeting dans handler.ts.
 */
export function buildGreetingText(restaurantName: string): string {
  return `Bonjour, ici ${restaurantName}. Je vous écoute.`;
}

/**
 * Génère une phrase via Cartesia TTS (format PCMA 8kHz, compatible Telnyx).
 * Utilise l'endpoint /tts/bytes (HTTP, non-streaming) pour simplicité.
 *
 * Retry automatique sur 429 (concurrency limit free tier = 2) avec backoff
 * exponentiel : 500ms, 1000ms, 2000ms.
 */
async function generateSentenceAudio(text: string, voiceId: string): Promise<Buffer> {
  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        'Cartesia-Version': '2026-03-01',
        'X-API-Key': process.env.CARTESIA_API_KEY ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: 'sonic-3.5',
        transcript: text,
        voice: { mode: 'id', id: voiceId },
        output_format: {
          container: 'raw',
          encoding: 'pcm_alaw',
          sample_rate: 8000,
        },
      }),
    });

    if (response.ok) {
      return Buffer.from(await response.arrayBuffer());
    }

    // 429 = concurrency limit — retry avec backoff
    if (response.status === 429 && attempt < maxRetries) {
      await response.text().catch(() => {});
      const delayMs = 500 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    throw new Error(`Cartesia TTS ${response.status}: ${await response.text()}`);
  }
  throw new Error('Cartesia TTS: max retries exceeded');
}

/**
 * Pré-génère les greetings pour tous les restaurants actifs.
 * Fire-and-forget depuis main.ts — ne bloque pas l'API.
 *
 * @param restaurantNames Liste optionnelle pour tests. En prod, charge depuis la DB.
 */
export async function initGreetingCache(restaurantNames?: string[]): Promise<void> {
  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) {
    logger.warn('[greetings] No CARTESIA_API_KEY — greetings will not be pre-cached');
    return;
  }

  const voiceId = process.env.CARTESIA_VOICE_ID ?? DEFAULT_CARTESIA_VOICE_ID;
  // Clé de cache identique à celle utilisée par speakTtsStreamed :
  // `${voiceId}|sonic-3.5|alaw8k` pour PCMA
  const cacheVoiceId = `${voiceId}|sonic-3.5|alaw8k`;

  // Charger les noms de restaurants depuis la DB (si non fournis)
  let names = restaurantNames;
  if (!names) {
    try {
      const restaurants = await db.restaurant.findMany({
        select: { name: true },
      });
      names = restaurants.map((r: { name: string }) => r.name).filter(Boolean);
    } catch (err) {
      logger.warn({ err }, '[greetings] Failed to load restaurants from DB');
      return;
    }
  }

  if (!names || names.length === 0) {
    logger.info('[greetings] No restaurants found — skipping greeting pre-cache');
    return;
  }

  let cached = 0;
  let skipped = 0;
  let failed = 0;

  for (const name of names) {
    const greetingText = buildGreetingText(name);

    // Reproduire le même pipeline que speakTtsStreamed :
    // cleanTextForTts → addNaturalPauses → split en phrases
    const cleaned = cleanTextForTts(greetingText);
    const withPauses = addNaturalPauses(cleaned);
    const sentences = withPauses
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const sentence of sentences) {
      // Vérifier si déjà en cache (évite de régénérer au restart)
      try {
        const existing = await getTtsCached(sentence, cacheVoiceId);
        if (existing) {
          skipped++;
          continue;
        }
      } catch {
        // Redis error — on continue et on génère
      }

      // Générer via Cartesia
      try {
        const audio = await generateSentenceAudio(sentence, voiceId);
        await setTtsCached(sentence, cacheVoiceId, audio);
        cached++;
      } catch (err) {
        logger.warn(
          { err, restaurant: name, sentence },
          '[greetings] Generation failed (non-blocking)',
        );
        failed++;
      }
    }
  }

  logger.info(
    `[greetings] Pre-cache: ${cached} generated, ${skipped} already cached, ${failed} failed (${names?.length ?? 0} restaurants)`,
  );
}

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
 * 2. Pour chaque restaurant, générer le greeting via Cartesia (format PCMA 8kHz)
 * 3. Stocker dans Redis via setTtsCached (même cache que le TTS runtime)
 * 4. Au runtime, speakTtsStreamed trouve un cache hit → playback immédiat
 *
 * Le greeting est une seule phrase, donc pas besoin de split. Le cache TTS
 * utilise la même clé que le runtime, garantissant un hit.
 */
import { db } from '../../../shared/db/client';
import { logger } from '../../../shared/logger/pino';
import { getTtsCached, setTtsCached } from '../tts-cache';
import { DEFAULT_CARTESIA_VOICE_ID } from '@sokar/config';

/**
 * Construit le texte du greeting pour un restaurant.
 * Doit être identique à buildInitialGreeting dans handler.ts.
 */
export function buildGreetingText(restaurantName: string): string {
  return `Bonjour, ici ${restaurantName}. Je vous écoute.`;
}

/**
 * Génère le greeting via Cartesia TTS (format PCMA 8kHz, compatible Telnyx).
 * Utilise l'endpoint /tts/bytes (HTTP, non-streaming) pour simplicité.
 */
async function generateGreetingAudio(
  text: string,
  voiceId: string,
): Promise<Buffer> {
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

  if (!response.ok) {
    throw new Error(`Cartesia TTS ${response.status}: ${await response.text()}`);
  }

  return Buffer.from(await response.arrayBuffer());
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

    // Vérifier si déjà en cache (évite de régénérer au restart)
    try {
      const existing = await getTtsCached(greetingText, cacheVoiceId);
      if (existing) {
        skipped++;
        continue;
      }
    } catch {
      // Redis error — on continue et on génère
    }

    // Générer via Cartesia
    try {
      const audio = await generateGreetingAudio(greetingText, voiceId);
      await setTtsCached(greetingText, cacheVoiceId, audio);
      cached++;
    } catch (err) {
      logger.warn({ err, restaurant: name }, '[greetings] Generation failed (non-blocking)');
      failed++;
    }
  }

  logger.info(
    `[greetings] Pre-cache: ${cached} generated, ${skipped} already cached, ${failed} failed (${names?.length ?? 0} total)`,
  );
}

/**
 * Cache de fillers audio pré-générés pour combler les silences pendant
 * que le LLM réfléchit.
 *
 * Stratégie de cache à 2 niveaux (RAM + Redis) :
 * - RAM  : Map<string, string[]> — lookup O(1), perte au restart pm2
 * - Redis: persistant, TTL 30j — survit aux restarts
 *
 * Warm-up au boot (`initFillerCache`) :
 * 1. Charge les 13 fillers du pool (CASUAL/WARM/FORMAL)
 * 2. Check Redis pour chaque filler — hit → ajoute en RAM, 0 appel Cartesia
 * 3. Miss → ajoute à la liste "à générer"
 * 4. Génère en background (concurrence 4 pour éviter 429 Cartesia) et
 *    cache le résultat en RAM + Redis (TTL 30j)
 *
 * Au runtime (`playFiller`) :
 * - RAM hit → joue instantanément
 * - RAM miss + Redis hit → joue depuis Redis (latence ~2ms, négligeable)
 * - Total miss → log warn, fallback `speakTelnyxNative` (voix Telnyx native)
 *
 * Impact économique :
 * - Avant : 4 restarts pm2/jour × 13 fillers × 22 crédits = 1144 crédits/jour
 * - Après : 1 génération tous les 30 jours = 286 crédits/mois (réduction ~95%)
 */
import { WebSocket } from 'ws';
import crypto from 'node:crypto';
import type { CallSession } from './types';
import { writeDebugLog } from './debug-log';
import { splitTelnyxAudioFrames } from './audio-frames';
import { TTS_FRAME_DURATION_MS } from './constants';
import { logger } from '../../../shared/logger/pino';
import { DEFAULT_CARTESIA_VOICE_ID, FILLER_CACHE_TTL_SECONDS } from '@sokar/config';
import { redisCache } from '../../../shared/redis/client';

interface FillerSet {
  casual: string[];
  warm: string[];
  formal: string[];
}

const FILLERS: FillerSet = {
  casual: [
    'Je regarde ça…',
    'Laissez-moi voir…',
    'Un instant…',
    'Voyons voir…',
    'Alors, je vérifie…',
  ],
  warm: [
    'Pas de souci, je regarde ça…',
    "Je m'en occupe, une seconde…",
    'Je vous dis ça tout de suite…',
    'Alors laissez-moi checker…',
  ],
  formal: [
    'Veuillez patienter un instant…',
    'Je consulte nos disponibilités…',
    "Un moment, s'il vous plaît…",
    'Je regarde cela pour vous…',
  ],
};

/** Cache RAM : chunks audio (base64) pour chaque filler */
const fillerCache = new Map<string, string[]>();
let initialized = false;
let fillerEncoding: 'pcm_alaw' | 'pcm_mulaw' = 'pcm_alaw';

/**
 * Switch le codec filler selon la session Telnyx active.
 * À appeler au début de chaque appel (avant `playFiller`).
 * Note : le warm-up utilise le codec actif au moment du boot. Si une
 * session arrive avec l'autre codec, le lookup Redis s'adaptera
 * automatiquement (cf. `redisKey`).
 */
export function setFillerCodec(codec: 'PCMA' | 'PCMU'): void {
  fillerEncoding = codec === 'PCMA' ? 'pcm_alaw' : 'pcm_mulaw';
}

export function __resetFillerCacheForTests(): void {
  if (process.env.NODE_ENV !== 'test') return;
  fillerCache.clear();
  initialized = false;
  fillerEncoding = 'pcm_alaw';
}

/**
 * Clé Redis stable par (transcript, voice, codec). Le format est :
 * `filler:<sha256-prefix>` — on n'inclut pas le texte en clair dans la clé
 * pour éviter de stocker du français dans Redis (debug-only).
 */
function redisKey(text: string, voiceId: string, codec: 'pcm_alaw' | 'pcm_mulaw'): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${text}|${voiceId}|${codec}`)
    .digest('hex')
    .slice(0, 16);
  return `filler:${hash}`;
}

/**
 * Génère et cache les fillers audio au démarrage de l'application.
 * Idempotent : peut être appelé plusieurs fois sans dupliquer les appels.
 * Fire-and-forget depuis main.ts — ne bloque pas l'API.
 */
export async function initFillerCache(): Promise<void> {
  if (initialized) return;

  const allFillers = [...FILLERS.casual, ...FILLERS.warm, ...FILLERS.formal];

  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) {
    logger.warn('[fillers] No CARTESIA_API_KEY — fillers will not be cached');
    initialized = true;
    return;
  }

  const voiceId = process.env.CARTESIA_VOICE_ID ?? DEFAULT_CARTESIA_VOICE_ID;

  // ── Étape 1 : précharger depuis Redis (0 appel Cartesia si tout est chaud)
  let redisHits = 0;
  const toGenerate: string[] = [];
  for (const text of allFillers) {
    const key = redisKey(text, voiceId, fillerEncoding);
    try {
      const cached = await redisCache.get(key);
      if (cached) {
        const chunks = JSON.parse(cached) as string[];
        if (Array.isArray(chunks) && chunks.length > 0) {
          fillerCache.set(text, chunks);
          redisHits++;
          continue;
        }
      }
    } catch (err) {
      logger.warn({ err, text }, '[fillers] Redis read failed (continuing)');
    }
    toGenerate.push(text);
  }

  logger.info(
    `[fillers] Preload: ${redisHits}/${allFillers.length} from Redis, ${toGenerate.length} to generate`,
  );

  if (toGenerate.length === 0) {
    initialized = true;
    return;
  }

  // ── Étape 2 : générer ce qui manque (concurrence 4 pour éviter 429)
  const CONCURRENCY = 4;
  let generated = 0;

  for (let i = 0; i < toGenerate.length; i += CONCURRENCY) {
    const batch = toGenerate.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (text) => {
        try {
          const chunks = await generateFillerAudio(text);
          if (chunks.length > 0) {
            // RAM d'abord (lookup O(1) au runtime)
            fillerCache.set(text, chunks);
            // Redis ensuite (persistance cross-restart)
            const key = redisKey(text, voiceId, fillerEncoding);
            await redisCache.set(
              key,
              JSON.stringify(chunks),
              'EX',
              FILLER_CACHE_TTL_SECONDS ?? 2_592_000,
            );
            return true;
          }
        } catch (err) {
          logger.warn({ err, text }, '[fillers] Generation failed (non-blocking)');
        }
        return false;
      }),
    );
    generated += results.filter((r) => r.status === 'fulfilled' && r.value).length;
  }

  logger.info(
    `[fillers] Cached ${generated}/${toGenerate.length} new fillers (${redisHits} from Redis, total ${redisHits + generated}/${allFillers.length})`,
  );
  initialized = true;
}

/**
 * Joue un filler aléatoire sur le WebSocket Telnyx.
 * Choisit le style correspondant à la personnalité du restaurant.
 *
 * Lookup en 2 temps :
 * 1. RAM (instantané)
 * 2. Redis si RAM miss (latence ~2ms, premier appel après restart)
 */
export async function playFiller(
  target: CallSession | WebSocket,
  style: 'CASUAL' | 'FORMAL' | 'WARM',
): Promise<void> {
  const isSession = typeof target === 'object' && target !== null && 'callControlId' in target;
  const session = isSession ? (target as CallSession) : undefined;
  const ws = isSession ? (target as CallSession).telnyxWs : (target as WebSocket);

  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const pool = FILLERS[style.toLowerCase() as keyof FillerSet];
  const text = pool[Math.floor(Math.random() * pool.length)];

  // 1. RAM
  let chunks = fillerCache.get(text);

  // 2. Redis fallback
  if (!chunks) {
    try {
      const voiceId = process.env.CARTESIA_VOICE_ID ?? DEFAULT_CARTESIA_VOICE_ID;
      const key = redisKey(text, voiceId, fillerEncoding);
      const cached = await redisCache.get(key);
      if (cached) {
        chunks = JSON.parse(cached) as string[];
        if (Array.isArray(chunks) && chunks.length > 0) {
          // Promotion en RAM pour le prochain appel
          fillerCache.set(text, chunks);
        }
      }
    } catch (err) {
      logger.warn({ err, text }, '[fillers] Redis read failed during playFiller');
    }
  }

  if (chunks && chunks.length > 0) {
    const audio = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk, 'base64')));
    const frames = splitTelnyxAudioFrames(audio, fillerEncoding === 'pcm_alaw' ? 'PCMA' : 'PCMU');
    writeDebugLog(`[fillers] Playing filler: "${text}" (${frames.length} frames, 100ms paced)`);
    for (const frame of frames) {
      if (session && (session.ended || session.state !== 'PROCESSING')) {
        writeDebugLog(
          `[fillers] Interrupted filler playback due to state change (state=${session.state})`,
        );
        break;
      }
      if (ws.readyState !== WebSocket.OPEN) break;
      ws.send(JSON.stringify({ event: 'media', media: { payload: frame.toString('base64') } }));
      await new Promise((r) => setTimeout(r, TTS_FRAME_DURATION_MS));
    }
  } else {
    logger.warn({ text }, '[fillers] No cached audio for filler (warm-up incomplete?)');
  }
}

async function generateFillerAudio(text: string): Promise<string[]> {
  const response = await fetch('https://api.cartesia.ai/tts/sse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cartesia-Version': '2026-03-01',
      'X-API-Key': process.env.CARTESIA_API_KEY ?? '',
    },
    body: JSON.stringify({
      model_id: 'sonic-3.5',
      transcript: text,
      voice: {
        mode: 'id',
        id: process.env.CARTESIA_VOICE_ID ?? DEFAULT_CARTESIA_VOICE_ID,
      },
      output_format: {
        container: 'raw',
        encoding: fillerEncoding,
        sample_rate: 8000,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Filler TTS ${response.status}`);
  }

  const chunks: string[] = [];
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'chunk' && parsed.data) {
          chunks.push(parsed.data);
        }
      } catch {
        /* skip */
      }
    }
  }

  return chunks;
}

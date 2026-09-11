/**
 * Cache de fillers audio pré-générés pour combler les silences pendant
 * que le LLM réfléchit.
 *
 * Stratégie de cache à 2 niveaux (RAM + Redis) :
 * - RAM  : Map<string, string[]> — lookup O(1), perte au restart pm2
 * - Redis: persistant, TTL 30j — survit aux restarts
 *
 * Warm-up au boot (`initFillerCache`) :
 * 1. Charge les fillers français et anglais du pool (CASUAL/WARM/FORMAL)
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
 * - Avant : les redémarrages régénéraient les phrases des deux langues
 * - Après : une génération par langue tous les 30 jours, puis lecture RAM/Redis
 */
import { WebSocket } from 'ws';
import crypto from 'node:crypto';
import type { CallSession } from './types';
import {
  effectiveVoiceLanguage,
  normalizeVoiceLocale,
  type VoiceLanguageCode,
} from './voice-language';
import { writeDebugLog } from './debug-log';
import { splitTelnyxAudioFrames } from './audio-frames';
import { TTS_FRAME_DURATION_MS } from './constants';
import { logger } from '../../../shared/logger/pino';
import { CARTESIA_MODEL, FILLER_CACHE_TTL_SECONDS } from '@sokar/config';
import { redisCache } from '../../../shared/redis/client';
import {
  buildCartesiaCacheVariant,
  CARTESIA_NORMALIZATION,
  getCartesiaVoiceId,
} from './cartesia-config';

interface FillerSet {
  casual: string[];
  warm: string[];
  formal: string[];
}

export type FillerPurpose = 'availability' | 'generic' | 'goodbye';

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

const ENGLISH_FILLERS: FillerSet = {
  casual: ['Let me check that…', 'One moment…', 'Let me see…', 'I’ll check that for you…'],
  warm: [
    'Of course, let me check that…',
    'I’ll take care of that, one moment…',
    'Let me look into that for you…',
  ],
  formal: [
    'Please hold for a moment…',
    'I’m checking our availability…',
    'One moment, please…',
    'Let me check that for you…',
  ],
};

const GOODBYE_FILLERS: Record<keyof FillerSet, string[]> = {
  casual: [
    "D'accord, bonne soirée, au revoir.",
    'Très bien, je vous souhaite une excellente soirée.',
    'Pas de problème, au revoir et à bientôt.',
    'Entendu, passez une bonne soirée.',
  ],
  warm: [
    'Avec plaisir, passez une très bonne soirée, au revoir.',
    "Merci de votre appel, au revoir et à très bientôt j'espère.",
    'Très bien, excellente soirée à vous, au revoir.',
    "C'est noté, au revoir et à bientôt !",
  ],
  formal: [
    'Je vous remercie de votre appel. Au revoir.',
    'Très bien, je vous souhaite une excellente soirée. Au revoir.',
    'Merci et au revoir, passez une agréable soirée.',
    'Entendu, au revoir et bonne soirée.',
  ],
};

const ENGLISH_GOODBYE_FILLERS: Record<keyof FillerSet, string[]> = {
  casual: [
    'All right, have a great evening. Goodbye.',
    'Thanks for calling, goodbye.',
    'No problem, goodbye and see you soon.',
    'Take care, goodbye.',
  ],
  warm: [
    'My pleasure. Have a wonderful evening, goodbye.',
    'Thank you for calling. Goodbye, and see you soon.',
    'All set. Have a lovely evening, goodbye.',
    'It was a pleasure, goodbye.',
  ],
  formal: [
    'Thank you for calling. Goodbye.',
    'I wish you a very pleasant evening. Goodbye.',
    'Thank you and goodbye.',
    'Understood. Have a pleasant evening.',
  ],
};

const FILLER_BY_PURPOSE: Record<FillerPurpose, Record<keyof FillerSet, string>> = {
  availability: {
    casual: 'Je regarde ça…',
    warm: 'Pas de souci, je regarde ça…',
    formal: 'Je consulte nos disponibilités…',
  },
  generic: {
    casual: 'Un instant…',
    warm: "Je m'en occupe, une seconde…",
    formal: 'Veuillez patienter un instant…',
  },
  goodbye: {
    casual: "D'accord, bonne soirée, au revoir.",
    warm: "Merci de votre appel, au revoir et à très bientôt j'espère.",
    formal: 'Je vous remercie de votre appel. Au revoir.',
  },
};

const ENGLISH_FILLER_BY_PURPOSE: Record<FillerPurpose, Record<keyof FillerSet, string>> = {
  availability: {
    casual: 'Let me check that…',
    warm: 'Of course, let me check that…',
    formal: 'I’m checking our availability…',
  },
  generic: {
    casual: 'One moment…',
    warm: 'I’ll take care of that, one moment…',
    formal: 'Please hold for a moment…',
  },
  goodbye: {
    casual: 'All right, have a great evening. Goodbye.',
    warm: 'Thank you for calling. Goodbye, and see you soon.',
    formal: 'Thank you for calling. Goodbye.',
  },
};

export function selectFillerText(
  style: 'CASUAL' | 'FORMAL' | 'WARM',
  purpose: FillerPurpose,
  language: VoiceLanguageCode = 'fr',
): string {
  const fillers = language === 'en' ? ENGLISH_FILLER_BY_PURPOSE : FILLER_BY_PURPOSE;
  return fillers[purpose][style.toLowerCase() as keyof FillerSet];
}

/** Sélectionne une formule courte dans le pool de la personnalité. */
export function selectRandomFillerText(style: 'CASUAL' | 'FORMAL' | 'WARM'): string {
  const pool = FILLERS[style.toLowerCase() as keyof FillerSet];
  return pool[Math.floor(Math.random() * pool.length)];
}

export interface FillerPlaybackOptions {
  /** Annule le filler dès qu'une réponse ou une reprise de parole arrive. */
  signal?: AbortSignal;
  /** Autorise la variation du pool pour un filler générique. */
  randomize?: boolean;
}

/**
 * Sélectionne un goodbye filler aléatoire (variation pour éviter la répétition).
 */
export function selectRandomGoodbyeText(
  style: 'CASUAL' | 'FORMAL' | 'WARM',
  language: VoiceLanguageCode = 'fr',
): string {
  const pools = language === 'en' ? ENGLISH_GOODBYE_FILLERS : GOODBYE_FILLERS;
  const pool = pools[style.toLowerCase() as keyof FillerSet];
  return pool[Math.floor(Math.random() * pool.length)];
}

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
function redisKey(
  text: string,
  voiceId: string,
  codec: 'pcm_alaw' | 'pcm_mulaw',
  language: VoiceLanguageCode = 'fr',
): string {
  const locale = normalizeVoiceLocale(language) ?? `${language}-US`;
  const hash = crypto
    .createHash('sha256')
    .update(buildCartesiaCacheVariant({ voiceId, locale, codec }) + `|${text}`)
    .digest('hex')
    .slice(0, 16);
  return `filler:${hash}`;
}

function memoryKey(text: string, voiceId: string, language: VoiceLanguageCode): string {
  return `${voiceId}|${normalizeVoiceLocale(language) ?? `${language}-US`}|${text}`;
}

/**
 * Génère et cache les fillers audio au démarrage de l'application.
 * Idempotent : peut être appelé plusieurs fois sans dupliquer les appels.
 * Fire-and-forget depuis main.ts — ne bloque pas l'API.
 */
export async function initFillerCache(): Promise<void> {
  if (initialized) return;

  const allFillers: Array<{ text: string; language: VoiceLanguageCode }> = [
    ...[
      ...FILLERS.casual,
      ...FILLERS.warm,
      ...FILLERS.formal,
      ...GOODBYE_FILLERS.casual,
      ...GOODBYE_FILLERS.warm,
      ...GOODBYE_FILLERS.formal,
    ].map((text) => ({ text, language: 'fr' as const })),
    ...[
      ...ENGLISH_FILLERS.casual,
      ...ENGLISH_FILLERS.warm,
      ...ENGLISH_FILLERS.formal,
      ...ENGLISH_GOODBYE_FILLERS.casual,
      ...ENGLISH_GOODBYE_FILLERS.warm,
      ...ENGLISH_GOODBYE_FILLERS.formal,
    ].map((text) => ({ text, language: 'en' as const })),
  ];

  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) {
    logger.warn('[fillers] No CARTESIA_API_KEY — fillers will not be cached');
    initialized = true;
    return;
  }

  const voiceId = getCartesiaVoiceId();

  // ── Étape 1 : précharger depuis Redis (0 appel Cartesia si tout est chaud)
  let redisHits = 0;
  const toGenerate: Array<{ text: string; language: VoiceLanguageCode }> = [];
  for (const filler of allFillers) {
    const { text, language } = filler;
    const key = redisKey(text, voiceId, fillerEncoding, language);
    try {
      const cached = await redisCache.get(key);
      if (cached) {
        const chunks = JSON.parse(cached) as string[];
        if (Array.isArray(chunks) && chunks.length > 0) {
          fillerCache.set(memoryKey(text, voiceId, language), chunks);
          redisHits++;
          continue;
        }
      }
    } catch (err) {
      logger.warn({ err, text }, '[fillers] Redis read failed (continuing)');
    }
    toGenerate.push(filler);
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
      batch.map(async ({ text, language }) => {
        try {
          const chunks = await generateFillerAudio(text, language);
          if (chunks.length > 0) {
            // RAM d'abord (lookup O(1) au runtime)
            fillerCache.set(memoryKey(text, voiceId, language), chunks);
            // Redis ensuite (persistance cross-restart)
            const key = redisKey(text, voiceId, fillerEncoding, language);
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
  purpose: FillerPurpose = 'generic',
  options: FillerPlaybackOptions = {},
): Promise<void> {
  const isSession = typeof target === 'object' && target !== null && 'callControlId' in target;
  const session = isSession ? (target as CallSession) : undefined;
  const ws = isSession ? (target as CallSession).telnyxWs : (target as WebSocket);

  if (!ws || ws.readyState !== WebSocket.OPEN || options.signal?.aborted) return;

  const language = session ? effectiveVoiceLanguage(session) : 'fr';
  const voiceId = session ? getCartesiaVoiceId(session) : getCartesiaVoiceId();
  const text =
    purpose === 'generic' && options.randomize
      ? selectRandomFillerText(style)
      : selectFillerText(style, purpose, language);

  // 1. RAM
  let chunks = fillerCache.get(memoryKey(text, voiceId, language));

  // 2. Redis fallback
  if (!chunks) {
    try {
      const key = redisKey(text, voiceId, fillerEncoding, language);
      const cached = await redisCache.get(key);
      if (options.signal?.aborted) return;
      if (cached) {
        chunks = JSON.parse(cached) as string[];
        if (Array.isArray(chunks) && chunks.length > 0) {
          // Promotion en RAM pour le prochain appel
          fillerCache.set(memoryKey(text, voiceId, language), chunks);
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
      if (
        options.signal?.aborted ||
        (session && (session.ended || session.state !== 'PROCESSING'))
      ) {
        writeDebugLog(
          `[fillers] Interrupted filler playback due to cancellation or state change (state=${session?.state ?? 'unknown'})`,
        );
        break;
      }
      if (ws.readyState !== WebSocket.OPEN) break;
      ws.send(JSON.stringify({ event: 'media', media: { payload: frame.toString('base64') } }));
      await new Promise((r) => setTimeout(r, TTS_FRAME_DURATION_MS));
      if (options.signal?.aborted) break;
    }
  } else {
    logger.warn({ text }, '[fillers] No cached audio for filler (warm-up incomplete?)');
  }
}

async function generateFillerAudio(
  text: string,
  language: VoiceLanguageCode = 'fr',
): Promise<string[]> {
  const maxRetries = 3;
  let response: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    response = await fetch('https://api.cartesia.ai/tts/sse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cartesia-Version': '2026-03-01',
        'X-API-Key': process.env.CARTESIA_API_KEY ?? '',
      },
      body: JSON.stringify({
        model_id: CARTESIA_MODEL,
        transcript: text,
        locale: normalizeVoiceLocale(language) ?? `${language}-US`,
        normalization: CARTESIA_NORMALIZATION,
        voice: {
          mode: 'id',
          id: getCartesiaVoiceId(),
        },
        output_format: {
          container: 'raw',
          encoding: fillerEncoding,
          sample_rate: 8000,
        },
      }),
    });

    if (response.ok) break;
    // 429 = concurrency limit — retry avec backoff
    if (response.status === 429 && attempt < maxRetries) {
      await response.text().catch(() => {});
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
      continue;
    }
    throw new Error(`Filler TTS ${response.status}`);
  }

  if (!response || !response.ok) {
    throw new Error('Filler TTS: max retries exceeded');
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

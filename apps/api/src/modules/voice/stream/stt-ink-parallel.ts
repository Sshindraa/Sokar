/**
 * Cartesia Ink-2 en parallèle de Deepgram. Deepgram garde la décision de fin de phrase, les mots (timings,
 * confiance, bruit, interruption) et les mots isolés ; Ink-2 reçoit le même flux sur `/stt/websocket`
 * (mode manuel) et, à chaque fin de phrase Deepgram, un `finalize` : son texte remplace celui de Deepgram
 * s'il arrive dans le délai imparti.
 *
 * Banc du 22/10/2026 (40 phrases d'appels test, référence Gemini) : mots erronés Deepgram 31,0 %, Ink-2
 * manuel 23,8 % (phrases longues 24,2 % contre 31,7 %) ; `finalize` → transcription finale en 87 ms
 * (médiane), 128 ms (p90). Ink-2 rend vide un mot isolé (« F », « vingt ») : Deepgram le couvre.
 *
 * Restaurants listés seulement (`VOICE_STT_INK_PARALLEL_RESTAURANT_IDS`, vide par défaut, `*` = tous).
 * Plafond : secondes d'audio envoyées par jour (`VOICE_STT_INK_DAILY_SECONDS`, 3 crédits Cartesia par
 * seconde). Toute panne retombe sur Deepgram seul. Jamais de texte d'appel dans les journaux.
 */
import WebSocket from 'ws';
import { logger } from '../../../shared/logger/pino';
import { redisCache } from '../../../shared/redis/client';
import { parseRestaurantIdList } from './feature-flags';
import { callerSilenceMs } from './caller-voice-activity';
import { decodeTelnyxToPcm16, telnyxBytesPerMs } from './telnyx-codec';
import type { CallSession } from './types';

const DEFAULT_DAILY_SECONDS = 1800;
const DEFAULT_WAIT_MS = 250;
/** Un mot isolé reste à Deepgram : Ink-2 les rend vides (banc du 22/10/2026). */
export const INK_MIN_DEEPGRAM_WORDS = 2;
const MAX_CALL_SECONDS = 600;
/**
 * Seule la voix de l'appelant part chez Cartesia (facturé à la seconde reçue) : environ un quart d'un appel
 * d'après le banc du 22/10/2026 (12 min 45 s de parole sur 55 min). La détection est celle de Sokar
 * (`trackCallerVoice`), locale et gratuite : il faut décider avant d'envoyer.
 */
const SPEECH_HANGOVER_MS = 1000;
const PRE_ROLL_MS = 500;
const CARTESIA_VERSION = '2026-03-01';
const FILLERS = new Set([
  'euh',
  'heu',
  'hum',
  'hmm',
  'mmh',
  'mh',
  'ah',
  'oh',
  'bah',
  'ben',
  'hein',
]);

export interface InkParallelState {
  socket: InkSocket;
  ready: boolean;
  closed: boolean;
  /** Textes finaux reçus depuis le dernier `finalize`. */
  finals: string[];
  /** Attente en cours d'une fin de phrase : résolue au premier texte final après `finalize`. */
  waiter?: (text: string) => void;
  bytesSent: number;
  bytesPerSecond: number;
  /** Dernières 0,5 s non envoyées, pour ne pas couper le début d'une prise de parole. */
  preRoll: Buffer[];
  preRollBytes: number;
}

/** Ce que le module attend d'une socket : la `ws` du serveur, ou un double en test. */
export interface InkSocket {
  readonly readyState: number;
  send(data: Buffer | string): void;
  close(): void;
  on(
    event: 'open' | 'message' | 'close' | 'error',
    listener: (...args: unknown[]) => void,
  ): unknown;
}

export interface InkDeps {
  env?: NodeJS.ProcessEnv;
  createSocket?: (url: string, headers: Record<string, string>) => InkSocket;
  spend?: {
    get(key: string): Promise<string | null>;
    incrby(key: string, by: number): Promise<unknown>;
    expire(key: string, seconds: number): Promise<unknown>;
  };
  now?: () => number;
}

export function isSttInkParallelEnabled(
  restaurantId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!restaurantId) return false;
  const ids = parseRestaurantIdList(env.VOICE_STT_INK_PARALLEL_RESTAURANT_IDS);
  return ids.includes('*') || ids.includes(restaurantId);
}

function dailySecondsCap(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.VOICE_STT_INK_DAILY_SECONDS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DAILY_SECONDS;
}

function waitMs(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.VOICE_STT_INK_WAIT_MS);
  return Number.isFinite(parsed) && parsed >= 50 && parsed <= 1000 ? parsed : DEFAULT_WAIT_MS;
}

function spendKey(now: number): string {
  return `stt-ink:seconds:${new Date(now).toISOString().slice(0, 10)}`;
}

/** Format Cartesia du flux Telnyx : A-law et µ-law à 8 kHz tels quels, L16 en PCM16 16 kHz. */
export function inkAudioFormat(codec: CallSession['codec']): {
  encoding: string;
  sampleRate: number;
} {
  if (codec === 'PCMA') return { encoding: 'pcm_alaw', sampleRate: 8000 };
  if (codec === 'PCMU') return { encoding: 'pcm_mulaw', sampleRate: 8000 };
  return { encoding: 'pcm_s16le', sampleRate: 16_000 };
}

export function comparableWordCount(text: string): number {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word && !FILLERS.has(word)).length;
}

/**
 * Ouvre la socket Ink-2 de l'appel si le réglage le permet et que le plafond du jour n'est pas atteint.
 * Asynchrone et sans effet sur Deepgram : tant qu'elle n'est pas prête, Deepgram est seul.
 */
export async function openInkParallel(session: CallSession, deps: InkDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  if (session.sttInk || session.sttInkAttempted) return;
  session.sttInkAttempted = true;
  if (!isSttInkParallelEnabled(session.restaurantId, env)) return;
  const apiKey = (env.CARTESIA_API_KEY ?? '').trim();
  if (!apiKey) return;
  const spend = deps.spend ?? redisCache;
  const now = deps.now ?? Date.now;
  try {
    const used = Number(await spend.get(spendKey(now()))) || 0;
    if (used >= dailySecondsCap(env)) {
      logger.info({ callId: session.callControlId }, '[stt-ink] daily cap reached');
      return;
    }
  } catch {
    return;
  }
  const { encoding, sampleRate } = inkAudioFormat(session.codec);
  const query = new URLSearchParams({
    model: 'ink-2',
    language: 'fr',
    encoding,
    sample_rate: String(sampleRate),
  });
  const url = `wss://api.cartesia.ai/stt/websocket?${query}`;
  const headers = { 'X-API-Key': apiKey, 'Cartesia-Version': CARTESIA_VERSION };
  const socket = (
    deps.createSocket ?? ((u, h) => new WebSocket(u, { headers: h }) as unknown as InkSocket)
  )(url, headers);
  const state: InkParallelState = {
    socket,
    ready: false,
    closed: false,
    finals: [],
    bytesSent: 0,
    bytesPerSecond: sampleRate * (encoding === 'pcm_s16le' ? 2 : 1),
    preRoll: [],
    preRollBytes: 0,
  };
  session.sttInk = state;
  socket.on('open', () => {
    state.ready = true;
  });
  socket.on('message', (raw) => {
    let event: { type?: string; is_final?: boolean; text?: string };
    try {
      event = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (event.type === 'transcript' && event.is_final && event.text?.trim()) {
      state.finals.push(event.text.trim());
      if (state.waiter) {
        const resolve = state.waiter;
        state.waiter = undefined;
        resolve(takeFinals(state));
      }
    }
  });
  const stop = () => {
    if (state.closed) return;
    state.closed = true;
    state.ready = false;
    state.waiter?.('');
    state.waiter = undefined;
  };
  socket.on('close', stop);
  socket.on('error', () => {
    logger.warn({ callId: session.callControlId }, '[stt-ink] socket error, Deepgram alone');
    stop();
  });
}

function takeFinals(state: InkParallelState): string {
  const text = state.finals.join(' ').replace(/\s+/g, ' ').trim();
  state.finals = [];
  return text;
}

/**
 * Même audio que Deepgram, au format Cartesia, mais seulement pendant que l'appelant parle (et 1 s après sa
 * dernière voix) ; sinon les 0,5 s les plus récentes attendent en mémoire. Rien tant que la socket n'est pas
 * prête. `trackCallerVoice` doit avoir vu ce morceau avant l'appel.
 */
export function sendInkAudio(session: CallSession, telnyxAudio: Buffer, now = Date.now()): void {
  const state = session.sttInk;
  if (!state?.ready || state.closed || state.socket.readyState !== WebSocket.OPEN) return;
  if (state.bytesSent >= MAX_CALL_SECONDS * state.bytesPerSecond) return;
  if (callerSilenceMs(session, now) > SPEECH_HANGOVER_MS) {
    state.preRoll.push(telnyxAudio);
    state.preRollBytes += telnyxAudio.length;
    const maxBytes = PRE_ROLL_MS * telnyxBytesPerMs(session.codec);
    while (state.preRoll.length > 1 && state.preRollBytes - state.preRoll[0].length >= maxBytes) {
      state.preRollBytes -= state.preRoll.shift()!.length;
    }
    return;
  }
  const pending = state.preRoll.length
    ? Buffer.concat([...state.preRoll, telnyxAudio])
    : telnyxAudio;
  state.preRoll = [];
  state.preRollBytes = 0;
  const audio = session.codec === 'L16' ? decodeTelnyxToPcm16('L16', pending) : pending;
  try {
    state.socket.send(audio);
    state.bytesSent += audio.length;
  } catch {
    state.closed = true;
  }
}

/**
 * Texte à envoyer au dialogue pour une phrase finale Deepgram. Un mot isolé reste à Deepgram, sans
 * attendre ; sinon `finalize`, puis le texte Ink-2 s'il arrive dans le délai, sinon celui de Deepgram.
 */
export async function resolveInkTranscript(
  session: CallSession,
  deepgramTranscript: string,
  deps: InkDeps = {},
): Promise<{ transcript: string; source: 'deepgram' | 'ink'; waitedMs: number }> {
  const state = session.sttInk;
  const env = deps.env ?? process.env;
  if (!state?.ready || state.closed)
    return { transcript: deepgramTranscript, source: 'deepgram', waitedMs: 0 };
  const startedAt = Date.now();
  // Les finaux déjà reçus appartiennent à cette phrase ; finalize clôt le reste.
  const result = new Promise<string>((resolve) => {
    state.waiter = resolve;
  });
  try {
    state.socket.send('finalize');
  } catch {
    state.waiter = undefined;
    return { transcript: deepgramTranscript, source: 'deepgram', waitedMs: 0 };
  }
  if (comparableWordCount(deepgramTranscript) < INK_MIN_DEEPGRAM_WORDS) {
    // On finalise pour vider le tampon d'Ink-2, sans attendre : Deepgram garde les mots isolés, et le
    // texte qu'Ink-2 rendra pour cette phrase est jeté par l'attente déjà posée.
    return { transcript: deepgramTranscript, source: 'deepgram', waitedMs: 0 };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(''), waitMs(env));
  });
  const inkText = await Promise.race([result, timeout]);
  if (timer) clearTimeout(timer);
  const waitedMs = Date.now() - startedAt;
  if (!inkText) {
    // Trop tard ou rien : la suite éventuelle sera ignorée par la prochaine phrase.
    state.waiter = undefined;
    state.finals = [];
    return { transcript: deepgramTranscript, source: 'deepgram', waitedMs };
  }
  return { transcript: inkText, source: 'ink', waitedMs };
}

/** Fin d'appel : ferme la socket et ajoute les secondes envoyées au compteur du jour. */
export async function closeInkParallel(session: CallSession, deps: InkDeps = {}): Promise<void> {
  const state = session.sttInk;
  if (!state) return;
  session.sttInk = undefined;
  try {
    if (state.socket.readyState === WebSocket.OPEN) state.socket.send('close');
    state.socket.close();
  } catch {
    // Déjà fermée.
  }
  state.closed = true;
  const seconds = Math.ceil(state.bytesSent / state.bytesPerSecond);
  if (seconds <= 0) return;
  const spend = deps.spend ?? redisCache;
  const now = deps.now ?? Date.now;
  try {
    const key = spendKey(now());
    await spend.incrby(key, seconds);
    await spend.expire(key, 3 * 86_400);
  } catch (error) {
    logger.warn(
      {
        callId: session.callControlId,
        err: error instanceof Error ? error.message : String(error),
      },
      '[stt-ink] spend counter update failed',
    );
  }
  logger.info({ callId: session.callControlId, seconds }, '[stt-ink] call closed');
}

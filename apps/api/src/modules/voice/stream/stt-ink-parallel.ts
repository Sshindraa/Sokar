/**
 * Cartesia Ink-2 en parallèle de Deepgram. Deepgram garde la décision de fin de phrase et les mots isolés ; ses mots et confiances
 * ne sont associés au texte final que si ce texte vient de Deepgram. Ink-2 reçoit le même flux sur `/stt/websocket`
 * (mode manuel) et, à chaque fin de phrase Deepgram, un `finalize` : son texte remplace celui de Deepgram
 * s'il arrive dans le délai imparti et que le remplacement est explicitement autorisé.
 *
 * Banc du 22/10/2026 (40 phrases d'appels test, référence Gemini) : mots erronés Deepgram 31,0 %, Ink-2
 * manuel 23,8 % (phrases longues 24,2 % contre 31,7 %) ; `finalize` → transcription finale en 87 ms
 * (médiane), 128 ms (p90). Ink-2 rend vide un mot isolé (« F », « vingt ») : Deepgram le couvre.
 *
 * Comparaison limitée à `VOICE_STT_INK_RESTAURANT_IDS` (vide par défaut).
 * Deepgram reste la source, sauf opt-in supplémentaire `VOICE_STT_INK_REPLACE_RESTAURANT_IDS`. 3 crédits Cartesia par seconde envoyée,
 * au plus 10 min par appel ; les secondes du jour sont comptées dans Redis (`stt-ink:seconds:<jour>`) pour suivre
 * la dépense. Toute panne retombe sur Deepgram seul. Les textes ne sont journalisés que dans le périmètre debug test.
 */
import WebSocket from 'ws';
import { logger } from '../../../shared/logger/pino';
import { redisCache } from '../../../shared/redis/client';
import { addSttAudioSamples } from '../../usage/voice-usage.service';
import { callerSilenceMs } from './caller-voice-activity';
import { decodeTelnyxToPcm16, telnyxBytesPerMs } from './telnyx-codec';
import type { CallSession } from './types';

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
/**
 * `finalize` part dès 150 ms de silence local, avant la fin de phrase Deepgram (200 ms d'endpointing en
 * prod) : Ink-2 répond en ~90 ms, son texte est donc prêt quand Deepgram clôt la phrase.
 */
export const EARLY_FINALIZE_SILENCE_MS = 150;
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
  /** De la voix a été envoyée depuis le dernier `finalize`. */
  speechSinceFinalize: boolean;
  /** Un `finalize` attend encore sa réponse. */
  pendingFinalize: boolean;
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

function restaurantEnabled(env: NodeJS.ProcessEnv, key: string, restaurantId: string): boolean {
  return (env[key] ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(restaurantId);
}

export interface InkTranscriptResult {
  transcript: string;
  source: 'deepgram' | 'ink';
  waitedMs: number;
  /** Hypothèse de comparaison, jamais journalisée hors du périmètre debug test. */
  inkTranscript?: string;
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
 * Ouvre la socket Ink-2 pour les seuls restaurants explicitement autorisés, clé Cartesia requise.
 * Asynchrone et sans effet sur Deepgram : tant qu'elle n'est pas prête, Deepgram est seul.
 */
export async function openInkParallel(session: CallSession, deps: InkDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  if (session.sttInk || session.sttInkAttempted) return;
  session.sttInkAttempted = true;
  if (
    !session.restaurantId ||
    !restaurantEnabled(env, 'VOICE_STT_INK_RESTAURANT_IDS', session.restaurantId)
  )
    return;
  const apiKey = (env.CARTESIA_API_KEY ?? '').trim();
  if (!apiKey) return;
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
    speechSinceFinalize: false,
    pendingFinalize: false,
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
      state.pendingFinalize = false;
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
    addSttAudioSamples(
      session,
      session.codec === 'L16' ? audio.length / 2 : audio.length,
      'cartesia',
    );
    if (callerSilenceMs(session, now) < EARLY_FINALIZE_SILENCE_MS) {
      state.speechSinceFinalize = true;
    } else if (state.speechSinceFinalize && !state.pendingFinalize) {
      sendFinalize(state);
    }
  } catch {
    state.closed = true;
  }
}

function sendFinalize(state: InkParallelState): void {
  state.socket.send('finalize');
  state.pendingFinalize = true;
  state.speechSinceFinalize = false;
}

/** La réponse d'un `finalize` dont on ne veut plus est avalée, pour ne pas fuir dans la phrase suivante. */
function discardPendingReply(state: InkParallelState): void {
  state.finals = [];
  state.waiter = state.pendingFinalize ? () => undefined : undefined;
}

/**
 * Texte à envoyer au dialogue pour une phrase finale Deepgram. Le `finalize` est en général déjà parti au
 * premier silence (sinon il part maintenant). Un mot isolé reste à Deepgram, sans attendre ; sinon le texte
 * Ink-2 s'il est là ou arrive dans le délai, sinon celui de Deepgram.
 */
export async function resolveInkTranscript(
  session: CallSession,
  deepgramTranscript: string,
  deps: InkDeps = {},
): Promise<InkTranscriptResult> {
  const state = session.sttInk;
  const env = deps.env ?? process.env;
  const deepgram = (waitedMs = 0) => ({
    transcript: deepgramTranscript,
    source: 'deepgram' as const,
    waitedMs,
  });
  if (!state?.ready || state.closed) return deepgram();
  const select = (inkTranscript: string, waitedMs: number): InkTranscriptResult => ({
    transcript: restaurantEnabled(env, 'VOICE_STT_INK_REPLACE_RESTAURANT_IDS', session.restaurantId)
      ? inkTranscript
      : deepgramTranscript,
    source: restaurantEnabled(env, 'VOICE_STT_INK_REPLACE_RESTAURANT_IDS', session.restaurantId)
      ? 'ink'
      : 'deepgram',
    waitedMs,
    inkTranscript,
  });
  const startedAt = Date.now();
  if (state.speechSinceFinalize || (!state.pendingFinalize && !state.finals.length)) {
    try {
      sendFinalize(state);
    } catch {
      return deepgram();
    }
  }
  if (comparableWordCount(deepgramTranscript) < INK_MIN_DEEPGRAM_WORDS) {
    // Deepgram garde les mots isolés : ce qu'Ink-2 rend pour cette phrase est jeté.
    discardPendingReply(state);
    return deepgram();
  }
  if (!state.pendingFinalize) {
    const ready = takeFinals(state);
    return ready ? select(ready, 0) : deepgram();
  }
  const result = new Promise<string>((resolve) => {
    state.waiter = resolve;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(''), waitMs(env));
  });
  const inkText = await Promise.race([result, timeout]);
  if (timer) clearTimeout(timer);
  const waitedMs = Date.now() - startedAt;
  if (!inkText) {
    discardPendingReply(state);
    return deepgram(waitedMs);
  }
  return select(inkText, waitedMs);
}

const PARTY_NUMBER_WORDS: Record<string, string> = {
  deux: '2',
  trois: '3',
  quatre: '4',
  cinq: '5',
  six: '6',
  sept: '7',
  huit: '8',
  neuf: '9',
  dix: '10',
  onze: '11',
  douze: '12',
  treize: '13',
  quatorze: '14',
  quinze: '15',
  seize: '16',
  vingt: '20',
};

/**
 * Nombres de personnes d'une phrase : un nombre suivi de « personnes » ou « couverts ». Volontairement
 * étroit : sur le banc, comparer tous les nombres et jours déclenchait un désaccord dans 24 % des phrases
 * (« une réservation », lettres épelées « D » entendues « 2 ») ; le nombre de personnes seul, 1 sur 368.
 */
export function partySizeValues(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .split(/[^\p{L}\p{N}']+/u);
  const values: string[] = [];
  words.forEach((word, index) => {
    const value = PARTY_NUMBER_WORDS[word] ?? (/^\d{1,2}$/.test(word) ? word : undefined);
    if (
      value &&
      words.slice(index + 1, index + 3).some((next) => /^(personne|couvert)/.test(next))
    ) {
      values.push(value);
    }
  });
  return values;
}

/** Deepgram et Ink-2 ne s'accordent pas sur le nombre de personnes : à faire confirmer. */
export function partySizeDiffers(first: string, second: string): boolean {
  return partySizeValues(first).join(' ') !== partySizeValues(second).join(' ');
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

export interface InkDisagreementNote {
  heard: string;
  secondHeard: string;
  at: number;
  /** Dernière fin de phrase (compteur `sttFinalCount`) pour laquelle la note vaut ; ensuite elle disparaît. */
  validThrough?: number;
}

/** Une note ne sert que le tour de sa phrase, au plus 90 s, et jamais après la création de la réservation. */
export const INK_NOTE_TTL_MS = 90_000;

export function currentInkDisagreementNote(
  session: CallSession,
  reservationCreated: boolean,
  now = Date.now(),
): InkDisagreementNote | undefined {
  const note = session.sttInkNote;
  if (!note || reservationCreated || now - note.at > INK_NOTE_TTL_MS) return undefined;
  if (note.validThrough !== undefined && (session.sttFinalCount ?? 0) > note.validThrough) {
    return undefined;
  }
  return note;
}

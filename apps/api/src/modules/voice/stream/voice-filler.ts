/**
 * Petits mots d'attente (« hmm… », « alors… », « je regarde… ») : quand la réponse tarde, Léa glisse un son court,
 * préenregistré avec sa voix, pour que l'appelant n'entende pas de silence. Le calcul n'est pas plus court : c'est le
 * silence ressenti qui disparaît.
 *
 * Ce ne sont pas des phrases du modèle : le code les choisit et les joue à part, comme les phrases de secours. Le
 * prompt n'en sait rien et la réponse du modèle n'en dépend pas (seul un mot d'appui répété, « D'accord… D'accord, »,
 * est retiré de la voix ; voir `withoutRepeatedInterjection`).
 *
 * Règles :
 * - seulement quand ça traîne : à `VOICE_FILLER_DELAY_MS` (750 ms) après la fin de parole, et seulement si aucune
 *   phrase de la vraie réponse n'est encore partie vers la synthèse ;
 * - adapté au moment : avant une vérification de disponibilité ou une réservation, « je regarde » (`lookup`) ; tour
 *   jugé fini, réponse simple, « alors… », « d'accord… » (`ack`) ; fin de tour encore inconnue, un « hmm » d'écoute
 *   (`backchannel`), qui reste naturel si l'appelant n'avait pas fini ;
 * - jamais pendant une épellation, ni après un au revoir, ni quand l'appelant parle, ni sur la relance après silence ;
 * - jamais deux fois de suite le même son, jamais deux tours de suite (sauf « je regarde »), plafond par appel ;
 * - le ton suit le réglage « Ton de voix » du restaurant (`fillerStyle`), vouvoiement partout.
 *
 * La vraie réponse attend la fin du son (`waitForVoiceFiller`), sans chevauchement ni coupure. L'appelant qui parle
 * pendant le son le coupe (voix claire, qu'un écho n'atteint pas) ; un barge-in ou une nouvelle réponse aussi.
 *
 * Seulement pour les restaurants listés (`VOICE_FILLER_RESTAURANT_IDS`, `*` = tous), vide = aucun, et seulement sur
 * le chemin ElevenLabs Dialogue (voix de production). Rien n'est généré tant que la liste est vide.
 */
import crypto from 'node:crypto';
import { WebSocket } from 'ws';
import { FILLER_CACHE_TTL_SECONDS } from '@sokar/config';
import { logger } from '../../../shared/logger/pino';
import { redisCache } from '../../../shared/redis/client';
import { splitTelnyxAudioFrames } from './audio-frames';
import { callerSilenceMs, callerSpokeClearlySince } from './caller-voice-activity';
import { TTS_PACE_PAUSE_MS } from './constants';
import { recordDebugAgentSpeech, settleDebugSpeech } from './debug-dialogue';
import { getElevenLabsTtsVoiceId } from './elevenlabs-context';
import { buildElevenLabsTtsRequest, elevenLabsTtsModel } from './elevenlabs-tts';
import { parseRestaurantIdList } from './feature-flags';
import { spelledLettersOf } from './structured-turn/fact-guards';
import {
  decodeTelnyxToPcm16,
  encodeTelnyxFromPcm16,
  getTelnyxCodec,
  telnyxBytesPerMs,
  telnyxCodecProfile,
  type TelnyxCodec,
} from './telnyx-codec';
import { markVoiceTurnAudioSent, recordVoiceTurnEventIfCurrent } from './turn-telemetry';
import type { CallSession } from './types';

export type VoiceFillerStyle = 'CASUAL' | 'FORMAL' | 'WARM';
/**
 * `backchannel` : fin de tour encore inconnue. `ack` : tour fini, réponse simple. `lookup` : vérification de
 * disponibilité. `booking` : création de la réservation.
 */
export type VoiceFillerPurpose = 'backchannel' | 'ack' | 'lookup' | 'booking';

export interface VoiceFillerClip {
  readonly id: string;
  /** Texte donné à la synthèse. La virgule finale garde une intonation suspendue : la réponse enchaîne. */
  readonly text: string;
}

const BACKCHANNEL: readonly VoiceFillerClip[] = [
  { id: 'hmm', text: 'Hmm,' },
  { id: 'mmh', text: 'Mmh.' },
];

/**
 * Banque de sons, par ton et par moment (12 par ton). Vouvoiement partout ; aucun son ne promet un résultat. Des sons
 * courts, la réponse attend leur fin : mesurés après coupe (voix Lucie, 21/10), 0,5 s pour « hmm », 0,5 à 0,7 s pour
 * « alors », 0,7 à 1,1 s pour « je regarde » ou « je note ». Les formules de plus de 1,1 s ont été retirées.
 */
export const VOICE_FILLER_BANK: Record<
  VoiceFillerStyle,
  Record<VoiceFillerPurpose, readonly VoiceFillerClip[]>
> = {
  FORMAL: {
    backchannel: BACKCHANNEL,
    ack: [
      { id: 'bien', text: 'Bien,' },
      { id: 'entendu', text: 'Entendu,' },
      { id: 'alors', text: 'Alors,' },
    ],
    lookup: [
      { id: 'je-regarde-cela', text: 'Je regarde cela,' },
      { id: 'je-verifie', text: 'Je vérifie,' },
      { id: 'voyons-cela', text: 'Voyons cela,' },
      { id: 'je-consulte', text: 'Je consulte,' },
    ],
    booking: [
      { id: 'je-note-cela', text: 'Je note cela,' },
      { id: 'je-note', text: 'Je note,' },
      { id: 'j-enregistre', text: "J'enregistre," },
    ],
  },
  CASUAL: {
    backchannel: BACKCHANNEL,
    ack: [
      { id: 'd-accord', text: "D'accord," },
      { id: 'alors', text: 'Alors,' },
      { id: 'ok', text: 'OK,' },
    ],
    lookup: [
      { id: 'je-regarde', text: 'Je regarde,' },
      { id: 'voyons-voir', text: 'Voyons voir,' },
      { id: 'je-regarde-ca', text: 'Je regarde ça,' },
      { id: 'je-verifie', text: 'Je vérifie,' },
    ],
    booking: [
      { id: 'je-note-ca', text: 'Je note ça,' },
      { id: 'je-note', text: 'Je note,' },
      { id: 'j-enregistre-ca', text: "J'enregistre ça," },
    ],
  },
  WARM: {
    backchannel: BACKCHANNEL,
    ack: [
      { id: 'd-accord', text: "D'accord," },
      { id: 'tres-bien', text: 'Très bien,' },
      { id: 'alors', text: 'Alors,' },
    ],
    lookup: [
      { id: 'voyons-voir', text: 'Voyons voir,' },
      { id: 'laissez-moi-regarder', text: 'Laissez-moi regarder,' },
      { id: 'je-regarde-ca', text: 'Je regarde ça,' },
      { id: 'je-vous-regarde-ca', text: 'Je vous regarde ça,' },
    ],
    booking: [
      { id: 'je-vous-note-ca', text: 'Je vous note ça,' },
      { id: 'je-m-en-occupe', text: "Je m'en occupe," },
      { id: 'je-note-ca-pour-vous', text: 'Je note ça pour vous,' },
    ],
  },
};

/** Tous les textes distincts de la banque (préchargement, banc d'écoute). */
export function voiceFillerTexts(): string[] {
  const texts = new Set<string>();
  for (const purposes of Object.values(VOICE_FILLER_BANK)) {
    for (const clips of Object.values(purposes)) for (const clip of clips) texts.add(clip.text);
  }
  return [...texts];
}

// ─── Réglages ───────────────────────────────────────────────────────

export function isVoiceFillerEnabled(
  restaurantId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!restaurantId) return false;
  const ids = parseRestaurantIdList(env.VOICE_FILLER_RESTAURANT_IDS);
  return ids.includes('*') || ids.includes(restaurantId);
}

function anyVoiceFillerRestaurant(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseRestaurantIdList(env.VOICE_FILLER_RESTAURANT_IDS).length > 0;
}

/**
 * Délai après la fin de parole. Mesures du 20–21/10 (GPT-6 Luna) : la fin de parole est constatée 0,3 à 0,6 s après
 * le dernier mot et le premier son de la réponse part 1,5 à 1,9 s après. À 750 ms, une réponse rapide (première
 * phrase déjà partie vers la synthèse) n'est jamais couverte, et le son d'attente, court (0,4 à 0,6 s pour un
 * « hmm » ou un « alors »), finit avant que la réponse typique soit prête.
 */
export function voiceFillerDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.VOICE_FILLER_DELAY_MS ?? 750);
  return Number.isFinite(parsed) && parsed >= 300 && parsed <= 3_000 ? parsed : 750;
}

/** Sons d'attente au plus par appel. */
export function voiceFillerMaxPerCall(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.VOICE_FILLER_MAX_PER_CALL ?? 4);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : 4;
}

/** L'appelant a fait du bruit plus récemment que cela : il parle peut-être encore, on se tait. */
const CALLER_QUIET_MS = 400;

// ─── Choix du son ───────────────────────────────────────────────────

export type VoiceFillerSkipReason =
  | 'reply_ready'
  | 'spelling'
  | 'goodbye'
  | 'caller_speaking'
  | 'caller_unfinished'
  | 'cap'
  | 'consecutive_turn'
  | 'not_cached';

export interface VoiceFillerCallState {
  played: number;
  lastClipId?: string;
  lastTurn?: number;
}

export interface VoiceFillerChoiceInput {
  style: VoiceFillerStyle;
  /** Action lue dans le flux du modèle, ou décidée par le code (`check_availability` d'une seconde passe). */
  action: string | null;
  /** `turnComplete` lu dans le flux ; `null` tant qu'inconnu. */
  turnComplete: boolean | null;
  /** Une phrase de la vraie réponse est déjà partie vers la synthèse. */
  replyQueued: boolean;
  transcript: string;
  lastAwaiting: string | undefined;
  callerSilenceMs: number;
  turnNumber: number;
  call: VoiceFillerCallState;
  maxPerCall: number;
  /** Second son du même tour (« hmm… je regarde… ») : le plafond et la règle des tours de suite sont déjà passés. */
  followUp?: boolean;
  /** Le son existe dans le cache (voix, modèle et codec de l'appel). */
  isCached: (clip: VoiceFillerClip) => boolean;
  random?: () => number;
}

const GOODBYE =
  /\b(au revoir|bonne (soirée|journée|fin de journée|soiree|journee)|à bientôt|a bientot|bye|salut)\b/i;

/** Moment du tour, d'après ce que le flux du modèle a déjà dit. */
export function voiceFillerPurpose(
  action: string | null,
  turnComplete: boolean | null,
): VoiceFillerPurpose {
  if (action === 'check_availability') return 'lookup';
  if (action === 'create_reservation') return 'booking';
  return turnComplete === true ? 'ack' : 'backchannel';
}

/** Une vérification ou une réservation : l'attente sera longue, le son dit ce que Léa fait. */
export function isTaskFillerPurpose(purpose: VoiceFillerPurpose): boolean {
  return purpose === 'lookup' || purpose === 'booking';
}

export function chooseVoiceFiller(
  input: VoiceFillerChoiceInput,
): { clip: VoiceFillerClip; purpose: VoiceFillerPurpose } | { skip: VoiceFillerSkipReason } {
  if (input.replyQueued) return { skip: 'reply_ready' };
  if (
    input.lastAwaiting === 'customerName' ||
    input.lastAwaiting === 'customerNameConfirmation' ||
    spelledLettersOf(input.transcript) !== ''
  ) {
    return { skip: 'spelling' };
  }
  if (input.action === 'end_call' || GOODBYE.test(input.transcript)) return { skip: 'goodbye' };
  if (input.turnComplete === false) return { skip: 'caller_unfinished' };
  if (input.callerSilenceMs < CALLER_QUIET_MS) return { skip: 'caller_speaking' };
  const purpose = voiceFillerPurpose(input.action, input.turnComplete);
  if (input.followUp && !isTaskFillerPurpose(purpose)) return { skip: 'reply_ready' };
  if (!input.followUp && input.call.played >= input.maxPerCall) return { skip: 'cap' };
  if (
    !input.followUp &&
    !isTaskFillerPurpose(purpose) &&
    input.call.lastTurn === input.turnNumber - 1
  ) {
    return { skip: 'consecutive_turn' };
  }
  const candidates = VOICE_FILLER_BANK[input.style][purpose].filter(
    (clip) => clip.id !== input.call.lastClipId && input.isCached(clip),
  );
  if (!candidates.length) return { skip: 'not_cached' };
  const random = input.random ?? Math.random;
  const clip =
    candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
  return { clip, purpose };
}

const INTERJECTION = /^\s*(ah,?\s*)?(d'accord|très bien|bien|alors|entendu|ok|bon)\s*[,.…]?\s*/i;

const normalizeInterjection = (text: string): string =>
  text
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/^ah,?\s*/, '')
    .replace(/[,.…\s]+$/g, '')
    .trim();

/**
 * La réponse commence par le mot que le son d'attente vient de dire (« D'accord… D'accord, à quel nom ? ») : ce mot
 * est retiré de la voix. L'historique garde la phrase du modèle telle quelle.
 */
export function withoutRepeatedInterjection(phrase: string, fillerText: string): string {
  const match = INTERJECTION.exec(phrase.replace(/’/g, "'"));
  if (!match) return phrase;
  if (normalizeInterjection(match[0]) !== normalizeInterjection(fillerText)) return phrase;
  const rest = phrase.slice(match[0].length).trimStart();
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : '';
}

// ─── Cache audio ────────────────────────────────────────────────────

const audioCache = new Map<string, Buffer>();
const pendingGenerations = new Map<string, Promise<void>>();

function cacheVariant(codec: TelnyxCodec): string {
  return `${getElevenLabsTtsVoiceId()}|${elevenLabsTtsModel()}|${telnyxCodecProfile(codec).label}`;
}

function memoryKey(text: string, codec: TelnyxCodec): string {
  return `${cacheVariant(codec)}|${text}`;
}

function redisKey(text: string, codec: TelnyxCodec): string {
  const hash = crypto
    .createHash('sha256')
    .update(memoryKey(text, codec))
    .digest('hex')
    .slice(0, 16);
  return `voice-filler:v1:${hash}`;
}

export function cachedVoiceFillerAudio(text: string, codec: TelnyxCodec): Buffer | null {
  return audioCache.get(memoryKey(text, codec)) ?? null;
}

export function __setVoiceFillerAudioForTests(
  text: string,
  codec: TelnyxCodec,
  audio: Buffer | null,
): void {
  if (process.env.NODE_ENV !== 'test') return;
  if (audio) audioCache.set(memoryKey(text, codec), audio);
  else audioCache.delete(memoryKey(text, codec));
}

/** Niveau (RMS 16 bits) sous lequel une trame de 20 ms compte comme silence en début et en fin de son. */
const TRIM_RMS = 150;
const TRIM_STEP_MS = 20;
/** Gardé avant l'attaque, pour ne pas la couper. */
const TRIM_LEAD_MS = 20;

/**
 * Retire le silence de tête (le son part à la première trame) et la traîne sous le seuil (la réponse enchaîne).
 * La dernière trame Telnyx est complétée par du silence (≤ 100 ms) : c'est le seul blanc avant la réponse.
 */
export function trimVoiceFillerAudio(audio: Buffer, codec: TelnyxCodec): Buffer {
  const bytesPerMs = telnyxBytesPerMs(codec);
  const step = Math.round(TRIM_STEP_MS * bytesPerMs);
  const sampleBytes = telnyxCodecProfile(codec).bytesPerSample;
  const levels: number[] = [];
  for (let offset = 0; offset < audio.length; offset += step) {
    const pcm = decodeTelnyxToPcm16(codec, audio.subarray(offset, offset + step));
    let sum = 0;
    const samples = Math.floor(pcm.length / 2);
    for (let i = 0; i < samples; i++) sum += pcm.readInt16LE(i * 2) ** 2;
    levels.push(samples ? Math.sqrt(sum / samples) : 0);
  }
  const first = levels.findIndex((level) => level >= TRIM_RMS);
  if (first < 0) return Buffer.alloc(0);
  let last = levels.length - 1;
  while (last > first && levels[last] < TRIM_RMS) last--;
  const lead = Math.round(TRIM_LEAD_MS * bytesPerMs);
  const start = Math.max(0, first * step - lead);
  const end = Math.min(audio.length, (last + 1) * step);
  // Un échantillon L16 ne se coupe pas en deux.
  return audio.subarray(start - (start % sampleBytes), end - (end % sampleBytes));
}

async function synthesizeFiller(text: string, codec: TelnyxCodec): Promise<Buffer> {
  const request = buildElevenLabsTtsRequest({
    apiKey: process.env.ELEVENLABS_API_KEY?.trim() ?? '',
    voiceId: getElevenLabsTtsVoiceId(),
    model: elevenLabsTtsModel(),
    text,
    locale: 'fr-FR',
    codec: telnyxCodecProfile(codec).label,
  });
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    await response.text().catch(() => undefined);
    if (response.status !== 429 || attempt >= 3) {
      throw new Error(`ElevenLabs filler TTS ${response.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
}

async function loadOrGenerate(text: string, codec: TelnyxCodec): Promise<'redis' | 'generated'> {
  const key = redisKey(text, codec);
  const cached = await redisCache.getBuffer(key).catch(() => null);
  if (cached?.length) {
    audioCache.set(memoryKey(text, codec), cached);
    return 'redis';
  }
  const audio = trimVoiceFillerAudio(await synthesizeFiller(text, codec), codec);
  if (!audio.length) throw new Error('ElevenLabs filler TTS: silence only');
  audioCache.set(memoryKey(text, codec), audio);
  await redisCache.set(key, audio, 'EX', FILLER_CACHE_TTL_SECONDS).catch(() => undefined);
  return 'generated';
}

/**
 * Précharge la banque (RAM, Redis 30 jours) pour un codec. Ne fait rien tant qu'aucun restaurant n'est listé :
 * aucun caractère ElevenLabs n'est dépensé pour une fonction coupée. Environ 300 caractères par voix et par codec.
 */
export function initVoiceFillerCache(codec: TelnyxCodec = getTelnyxCodec()): Promise<void> {
  if (!anyVoiceFillerRestaurant() || !process.env.ELEVENLABS_API_KEY?.trim()) {
    return Promise.resolve();
  }
  const variant = cacheVariant(codec);
  const pending = pendingGenerations.get(variant);
  if (pending) return pending;
  const run = (async () => {
    let fromRedis = 0;
    let generated = 0;
    let failed = 0;
    for (const text of voiceFillerTexts()) {
      if (cachedVoiceFillerAudio(text, codec)) continue;
      try {
        if ((await loadOrGenerate(text, codec)) === 'redis') fromRedis++;
        else generated++;
      } catch (err) {
        failed++;
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), codec },
          '[voice-filler] generation failed',
        );
      }
    }
    logger.info({ codec, fromRedis, generated, failed }, '[voice-filler] cache ready');
  })().finally(() => pendingGenerations.delete(variant));
  pendingGenerations.set(variant, run);
  return run;
}

// ─── Lecture ────────────────────────────────────────────────────────

interface FillerPlayback {
  readonly clipText: string;
  done: Promise<void>;
  finished: boolean;
  stop(reason: string): void;
}

const playbacks = new WeakMap<CallSession, FillerPlayback>();
const callStates = new WeakMap<CallSession, VoiceFillerCallState>();

export function voiceFillerCallState(session: CallSession): VoiceFillerCallState {
  let state = callStates.get(session);
  if (!state) {
    state = { played: 0 };
    callStates.set(session, state);
  }
  return state;
}

/** La vraie réponse attend la fin du son d'attente en cours (aucun chevauchement). Résolu tout de suite sans son. */
export function waitForVoiceFiller(session: CallSession): Promise<void> {
  return playbacks.get(session)?.done ?? Promise.resolve();
}

function playFiller(
  session: CallSession,
  clip: VoiceFillerClip,
  purpose: VoiceFillerPurpose,
  audio: Buffer,
  turnId: string | undefined,
  signal: AbortSignal,
): FillerPlayback {
  const generation = session.ttsGeneration;
  const startedAt = Date.now();
  const frames = splitTelnyxAudioFrames(audio, session.codec);
  let stopReason: string | null = null;
  const debugEntry = recordDebugAgentSpeech(session, clip.text, 'filler');
  let framesSent = 0;

  const interrupted = (): string | null => {
    if (stopReason) return stopReason;
    if (signal.aborted) return 'aborted';
    if (session.ended || session.telnyxWs?.readyState !== WebSocket.OPEN) return 'ended';
    if (session.ttsGeneration !== generation) return 'barge_in';
    if (callerSpokeClearlySince(session, startedAt)) return 'caller_voice';
    return null;
  };

  const playback: FillerPlayback = {
    clipText: clip.text,
    done: Promise.resolve(),
    finished: false,
    stop: (reason) => {
      stopReason ??= reason;
    },
  };
  playbacks.set(session, playback);
  playback.done = (async () => {
    let reason: string | null = null;
    try {
      for (const frame of frames) {
        reason = interrupted();
        if (reason) break;
        session.telnyxWs.send(
          JSON.stringify({
            event: 'media',
            media: { payload: encodeTelnyxFromPcm16(session.codec, frame).toString('base64') },
          }),
        );
        if (framesSent === 0) {
          markVoiceTurnAudioSent(session, { ttsPath: 'filler', isFiller: true }, turnId);
        }
        framesSent++;
        await new Promise((resolve) => setTimeout(resolve, TTS_PACE_PAUSE_MS));
      }
      reason ??= framesSent < frames.length ? interrupted() : null;
    } finally {
      const completed = !reason && framesSent === frames.length;
      settleDebugSpeech(debugEntry, framesSent, completed);
      if (completed) {
        recordVoiceTurnEventIfCurrent(session, turnId, 'filler_completed', {
          purpose,
          clip: clip.id,
          durationMs: Date.now() - startedAt,
        });
      } else {
        // L'audio déjà envoyé est effacé chez Telnyx (une nouvelle réponse invalidée ne le fait pas ; un barge-in
        // l'a déjà fait, le refaire est sans effet).
        if (reason !== 'ended' && framesSent > 0) {
          session.telnyxWs.send(JSON.stringify({ event: 'clear' }));
        }
        recordVoiceTurnEventIfCurrent(session, turnId, 'filler_interrupted', {
          purpose,
          clip: clip.id,
          reason: reason ?? 'unknown',
          playedMs: framesSent * TTS_PACE_PAUSE_MS,
        });
      }
      playback.finished = true;
      if (playbacks.get(session) === playback) playbacks.delete(session);
    }
  })().catch((err: unknown) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), callId: session.callControlId },
      '[voice-filler] playback failed (non-blocking)',
    );
  });

  return playback;
}

// ─── Tour ───────────────────────────────────────────────────────────

export interface TurnFillerOptions {
  transcript: string;
  lastAwaiting: string | undefined;
  turnId: string | undefined;
  signal: AbortSignal;
  env?: NodeJS.ProcessEnv;
  random?: () => number;
  now?: () => number;
}

/**
 * Sons d'attente d'un tour : un premier son au délai, puis au plus un second quand une vérification ou une réservation
 * s'annonce (« hmm… je regarde ça… »). Le moteur signale ce qu'il apprend du flux (`observe`), la première phrase
 * envoyée à la synthèse (`replyQueued`) et une attente longue certaine (`expectLongWait`, seconde passe).
 */
export class TurnFiller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private action: string | null = null;
  private turnComplete: boolean | null = null;
  private replyIsQueued = false;
  /**
   * `pending` : délai en cours. `open` : délai passé, un son de vérification ou de réservation peut encore partir.
   * `closed` : plus aucun son à ce tour.
   */
  private phase: 'pending' | 'open' | 'closed' = 'pending';
  private playback: FillerPlayback | null = null;
  private chained = false;
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => number;

  constructor(
    private readonly session: CallSession,
    private readonly options: TurnFillerOptions,
  ) {
    this.env = options.env ?? process.env;
    this.now = options.now ?? Date.now;
    const speechEndAt = session.latencyTrace?.speechEndAt ?? this.now();
    const waitMs = Math.max(0, speechEndAt + voiceFillerDelayMs(this.env) - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fire();
    }, waitMs);
  }

  /** Champs lus dans le flux du modèle, dès qu'ils sont connus. */
  observe(fields: { action?: string | null; turnComplete?: boolean | null }): void {
    if (this.phase === 'closed') return;
    if (fields.action && fields.action !== this.action) {
      this.action = fields.action;
      if (this.action === 'end_call') return this.close();
      if (this.phase === 'open' && isTaskFillerPurpose(this.purpose())) this.fire();
    }
    if (typeof fields.turnComplete === 'boolean') this.turnComplete = fields.turnComplete;
    if (this.turnComplete === false) this.close();
  }

  /** Une phrase de la vraie réponse part vers la synthèse : plus aucun nouveau son (celui en cours finit). */
  replyQueued(): void {
    this.replyIsQueued = true;
    this.close();
  }

  /** Vérification ou réservation lancée par le code (seconde passe à venir) : l'attente sera longue. */
  expectLongWait(action: 'check_availability' | 'create_reservation'): void {
    if (this.phase === 'closed') return;
    this.action = action;
    this.turnComplete = true;
    if (this.phase === 'open') this.fire();
  }

  /** Texte du dernier son joué à ce tour, pour retirer un mot d'appui répété au début de la réponse. */
  get playedText(): string | null {
    return this.playback?.clipText ?? null;
  }

  /** Fin du tour : un son déjà commencé finit (la réponse l'attend), un son pas encore parti n'aura pas lieu. */
  dispose(): void {
    this.close();
  }

  private purpose(): VoiceFillerPurpose {
    return voiceFillerPurpose(this.action, this.turnComplete);
  }

  private close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.phase = 'closed';
  }

  private fire(): void {
    if (this.phase === 'closed') return;
    if (this.options.signal.aborted || this.session.ended) return this.close();
    const previous = this.playback;
    if (previous && !previous.finished) {
      // Le second son suit le premier, jamais par-dessus.
      if (!this.chained) {
        this.chained = true;
        previous.done
          .then(() => {
            this.chained = false;
            this.fire();
          })
          .catch(() => undefined);
      }
      return;
    }
    const followUp = previous !== null;
    const call = voiceFillerCallState(this.session);
    const codec = this.session.codec;
    const choice = chooseVoiceFiller({
      style: this.session.personality?.fillerStyle ?? 'CASUAL',
      action: this.action,
      turnComplete: this.turnComplete,
      replyQueued: this.replyIsQueued,
      transcript: this.options.transcript,
      lastAwaiting: this.options.lastAwaiting,
      callerSilenceMs: callerSilenceMs(this.session, this.now()),
      turnNumber: this.session.turnCount,
      call,
      maxPerCall: voiceFillerMaxPerCall(this.env),
      followUp,
      isCached: (clip) => cachedVoiceFillerAudio(clip.text, codec) !== null,
      ...(this.options.random ? { random: this.options.random } : {}),
    });
    if ('skip' in choice) {
      // Un son manquant pour ce codec (L16) : préchargé pour les appels suivants.
      if (choice.skip === 'not_cached') initVoiceFillerCache(codec).catch(() => undefined);
      // Ces refus tiennent au moment, pas au tour : une vérification à venir peut encore justifier « je regarde ».
      const retry = choice.skip === 'caller_speaking' || choice.skip === 'consecutive_turn';
      if (retry && !isTaskFillerPurpose(this.purpose())) this.phase = 'open';
      else this.close();
      if (!followUp || choice.skip !== 'reply_ready') {
        recordVoiceTurnEventIfCurrent(this.session, this.options.turnId, 'filler_skipped', {
          reason: choice.skip,
          purpose: this.purpose(),
        });
      }
      return;
    }
    const audio = cachedVoiceFillerAudio(choice.clip.text, codec);
    if (!audio) return this.close();
    // Après un son de vérification, plus rien ; après un « hmm », une vérification peut encore s'annoncer.
    if (isTaskFillerPurpose(choice.purpose)) this.close();
    else this.phase = 'open';
    if (!followUp) {
      call.played++;
      call.lastTurn = this.session.turnCount;
    }
    call.lastClipId = choice.clip.id;
    const speechEndAt = this.session.latencyTrace?.speechEndAt;
    recordVoiceTurnEventIfCurrent(this.session, this.options.turnId, 'filler_started', {
      purpose: choice.purpose,
      clip: choice.clip.id,
      ...(followUp ? { followUp: true } : {}),
      ...(speechEndAt !== undefined ? { sinceSpeechEndMs: this.now() - speechEndAt } : {}),
    });
    this.playback = playFiller(
      this.session,
      choice.clip,
      choice.purpose,
      audio,
      this.options.turnId,
      this.options.signal,
    );
  }
}

/**
 * Son d'attente pour ce tour, ou `null` : restaurant non listé, voix hors ElevenLabs Dialogue, relance après silence.
 */
export function createTurnFiller(
  session: CallSession,
  provider: 'elevenlabs' | 'cartesia' | null,
  options: TurnFillerOptions & { callerFinished?: boolean },
): TurnFiller | null {
  if (provider !== 'elevenlabs' || options.callerFinished) return null;
  if (!isVoiceFillerEnabled(session.restaurantId, options.env)) return null;
  return new TurnFiller(session, options);
}

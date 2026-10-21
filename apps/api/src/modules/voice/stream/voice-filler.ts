/**
 * Petit mot d'attente pendant une vraie vérification ou un vrai enregistrement : quand Léa vérifie un créneau ou
 * enregistre la réservation et que la réponse tarde, un son court, préenregistré avec sa voix, annonce ce qu'elle fait
 * (« Un instant, je regarde. », « Un instant, j'enregistre. ») pour que l'appelant n'entende pas de silence.
 *
 * Seulement ces deux cas (écoute de Hamza du 21/10 : les « hmm », « d'accord » et petits mots sur une question simple
 * ne sonnent pas humains). Le son part au lancement réel de l'action par le code (`runAvailability`,
 * `runCreateReservation`, voir `expectLongWait`), jamais sur la simple intention lue dans le flux : une action refusée
 * par les garde-fous ne déclenche rien. Il annonce l'action, jamais son résultat (pas de « c'est noté »).
 *
 * Ce ne sont pas des phrases du modèle : le code les choisit et les joue à part, comme les phrases de secours.
 *
 * Règles :
 * - seulement quand ça traîne : pas avant `VOICE_FILLER_DELAY_MS` (750 ms) après la fin de parole, et seulement si
 *   aucune phrase de la vraie réponse n'est encore partie vers la synthèse ;
 * - jamais pendant une épellation, ni quand l'appelant parle, ni sur la relance après silence ;
 * - jamais deux fois de suite le même son, plafond par appel ; le ton suit `fillerStyle`, vouvoiement partout.
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
/** `lookup` : vérification de disponibilité. `booking` : enregistrement de la réservation. */
export type VoiceFillerPurpose = 'lookup' | 'booking';
export type VoiceFillerAction = 'check_availability' | 'create_reservation';

export interface VoiceFillerClip {
  readonly id: string;
  readonly text: string;
}

/**
 * Banque de sons, par ton et par action. Chaque formule annonce l'action en cours sans recouper la réponse qui suit :
 * aucun résultat (« c'est noté », « je vous note ça »), aucun mot d'appui. Vouvoiement partout.
 */
export const VOICE_FILLER_BANK: Record<
  VoiceFillerStyle,
  Record<VoiceFillerPurpose, readonly VoiceFillerClip[]>
> = {
  FORMAL: {
    lookup: [
      { id: 'un-instant-je-verifie', text: 'Un instant, je vérifie.' },
      { id: 'je-verifie', text: 'Je vérifie.' },
      { id: 'un-instant-je-vous-prie', text: 'Un instant, je vous prie.' },
    ],
    booking: [
      { id: 'un-instant-j-enregistre', text: "Un instant, j'enregistre." },
      { id: 'j-enregistre', text: "J'enregistre." },
      { id: 'un-instant-je-vous-prie', text: 'Un instant, je vous prie.' },
    ],
  },
  CASUAL: {
    lookup: [
      { id: 'un-instant-je-regarde', text: 'Un instant, je regarde.' },
      { id: 'je-regarde', text: 'Je regarde.' },
      { id: 'je-verifie', text: 'Je vérifie.' },
    ],
    booking: [
      { id: 'un-instant-j-enregistre', text: "Un instant, j'enregistre." },
      { id: 'j-enregistre', text: "J'enregistre." },
      { id: 'une-seconde', text: 'Une seconde.' },
    ],
  },
  WARM: {
    lookup: [
      { id: 'un-instant-je-regarde', text: 'Un instant, je regarde.' },
      { id: 'je-regarde-pour-vous', text: 'Je regarde pour vous.' },
      { id: 'je-verifie', text: 'Je vérifie.' },
    ],
    booking: [
      { id: 'un-instant-j-enregistre', text: "Un instant, j'enregistre." },
      { id: 'je-m-en-occupe', text: "Je m'en occupe." },
      { id: 'une-petite-seconde', text: 'Une petite seconde.' },
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
 * Délai minimal après la fin de parole. Mesures du 20–21/10 (GPT-6 Luna) : la fin de parole est constatée 0,3 à 0,6 s
 * après le dernier mot ; une vérification ou un enregistrement démarre après le premier passage du modèle, vers 1,2 à
 * 1,5 s, et la réponse qui suit arrive vers 2,6 à 3 s. Le délai ne retient donc le son que sur un tour exceptionnellement
 * rapide ; dans le cas courant, il part au lancement de l'action.
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
  | 'caller_speaking'
  | 'cap'
  | 'not_cached';

export interface VoiceFillerCallState {
  played: number;
  lastClipText?: string;
}

export interface VoiceFillerChoiceInput {
  style: VoiceFillerStyle;
  /** Action réellement lancée par le code. */
  action: VoiceFillerAction;
  /** Une phrase de la vraie réponse est déjà partie vers la synthèse. */
  replyQueued: boolean;
  transcript: string;
  lastAwaiting: string | undefined;
  callerSilenceMs: number;
  call: VoiceFillerCallState;
  maxPerCall: number;
  /** Le son existe dans le cache (voix, modèle et codec de l'appel). */
  isCached: (clip: VoiceFillerClip) => boolean;
  random?: () => number;
}

export function voiceFillerPurpose(action: VoiceFillerAction): VoiceFillerPurpose {
  return action === 'check_availability' ? 'lookup' : 'booking';
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
  if (input.callerSilenceMs < CALLER_QUIET_MS) return { skip: 'caller_speaking' };
  if (input.call.played >= input.maxPerCall) return { skip: 'cap' };
  const purpose = voiceFillerPurpose(input.action);
  const candidates = VOICE_FILLER_BANK[input.style][purpose].filter(
    (clip) => clip.text !== input.call.lastClipText && input.isCached(clip),
  );
  if (!candidates.length) return { skip: 'not_cached' };
  const random = input.random ?? Math.random;
  const clip =
    candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
  return { clip, purpose };
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
 * aucun caractère ElevenLabs n'est dépensé pour une fonction coupée. Environ 200 caractères par voix et par codec.
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
  done: Promise<void>;
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
  const debugEntry = recordDebugAgentSpeech(session, clip.text, 'filler');
  let framesSent = 0;

  const interrupted = (): string | null => {
    if (signal.aborted) return 'aborted';
    if (session.ended || session.telnyxWs?.readyState !== WebSocket.OPEN) return 'ended';
    if (session.ttsGeneration !== generation) return 'barge_in';
    if (callerSpokeClearlySince(session, startedAt)) return 'caller_voice';
    return null;
  };

  const playback: FillerPlayback = {
    done: Promise.resolve(),
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
 * Petit mot d'attente d'un tour : au plus un, au lancement réel d'une vérification ou d'un enregistrement
 * (`expectLongWait`), pas avant le délai après la fin de parole, jamais après la première phrase de la réponse.
 */
export class TurnFiller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private replyIsQueued = false;
  private playback: FillerPlayback | null = null;
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => number;
  private readonly earliestAt: number;

  constructor(
    private readonly session: CallSession,
    private readonly options: TurnFillerOptions,
  ) {
    this.env = options.env ?? process.env;
    this.now = options.now ?? Date.now;
    const speechEndAt = session.latencyTrace?.speechEndAt ?? this.now();
    this.earliestAt = speechEndAt + voiceFillerDelayMs(this.env);
  }

  /** Vérification ou enregistrement lancé par le code : l'attente sera longue. */
  expectLongWait(action: VoiceFillerAction): void {
    if (this.closed || this.timer || this.playback) return;
    const waitMs = this.earliestAt - this.now();
    if (waitMs <= 0) return this.fire(action);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fire(action);
    }, waitMs);
  }

  /** Une phrase de la vraie réponse part vers la synthèse : plus aucun son (celui en cours finit). */
  replyQueued(): void {
    this.replyIsQueued = true;
    this.close();
  }

  /** Fin du tour : un son déjà commencé finit (la réponse l'attend), un son pas encore parti n'aura pas lieu. */
  dispose(): void {
    this.close();
  }

  private close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.closed = true;
  }

  private fire(action: VoiceFillerAction): void {
    if (this.closed) return;
    this.close();
    if (this.options.signal.aborted || this.session.ended) return;
    const call = voiceFillerCallState(this.session);
    const codec = this.session.codec;
    const choice = chooseVoiceFiller({
      style: this.session.personality?.fillerStyle ?? 'CASUAL',
      action,
      replyQueued: this.replyIsQueued,
      transcript: this.options.transcript,
      lastAwaiting: this.options.lastAwaiting,
      callerSilenceMs: callerSilenceMs(this.session, this.now()),
      call,
      maxPerCall: voiceFillerMaxPerCall(this.env),
      isCached: (clip) => cachedVoiceFillerAudio(clip.text, codec) !== null,
      ...(this.options.random ? { random: this.options.random } : {}),
    });
    if ('skip' in choice) {
      // Un son manquant pour ce codec (L16) : préchargé pour les appels suivants.
      if (choice.skip === 'not_cached') initVoiceFillerCache(codec).catch(() => undefined);
      recordVoiceTurnEventIfCurrent(this.session, this.options.turnId, 'filler_skipped', {
        reason: choice.skip,
        purpose: voiceFillerPurpose(action),
      });
      return;
    }
    const audio = cachedVoiceFillerAudio(choice.clip.text, codec);
    if (!audio) return;
    call.played++;
    // Par texte : les deux actions partagent parfois une formule, elle ne revient pas deux fois de suite.
    call.lastClipText = choice.clip.text;
    const speechEndAt = this.session.latencyTrace?.speechEndAt;
    recordVoiceTurnEventIfCurrent(this.session, this.options.turnId, 'filler_started', {
      purpose: choice.purpose,
      clip: choice.clip.id,
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

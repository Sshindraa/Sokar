/**
 * Second avis STT, en arrière-plan : quand Deepgram termine une phrase longue, son audio est retranscrit
 * par un autre modèle (MAI-Transcribe-2 via OpenRouter par défaut) sans retarder la réponse de l'agent.
 * Si les deux transcriptions diffèrent, le tour suivant reçoit une note : vérifier avec l'appelant toute
 * information de réservation qui en dépendrait, avant de la créer.
 *
 * Banc du 22/10/2026 sur 358 phrases d'appels test (référence Gemini, provisoire) : Deepgram 22,4 % de
 * mots erronés sur les phrases de 4 mots ou plus, MAI 15,9 %, mais MAI met 1 à 2 s : d'où l'arrière-plan.
 *
 * Restaurants listés seulement (`VOICE_STT_SECOND_OPINION_RESTAURANT_IDS`, vide par défaut, `*` = tous),
 * plafond de dépense quotidien partagé par tous les appels, jamais de texte d'appel dans les journaux.
 */
import { logger } from '../../../shared/logger/pino';
import { redisCache } from '../../../shared/redis/client';
import { parseRestaurantIdList } from './feature-flags';
import { alawToPcm16 } from './telnyx-codec';
import type { CallSession, SttWord } from './types';

export const SECOND_OPINION_MIN_WORDS = 4;
const DEFAULT_MODEL = 'microsoft/mai-transcribe-2';
const DEFAULT_DAILY_USD_CAP = 1;
const MAX_REQUESTS_PER_CALL = 8;
const AUDIO_RETENTION_MS = 20_000;
const LEAD_MS = 300;
const TAIL_MS = 300;
const REQUEST_TIMEOUT_MS = 8_000;
/** Une note sert le ou les tours qui suivent la phrase ; au-delà, elle n'a plus de sens. */
export const SECOND_OPINION_NOTE_TTL_MS = 90_000;
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

export interface SecondOpinionNote {
  heard: string;
  secondHeard: string;
  at: number;
}

export function isSttSecondOpinionEnabled(
  restaurantId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!restaurantId) return false;
  const ids = parseRestaurantIdList(env.VOICE_STT_SECOND_OPINION_RESTAURANT_IDS);
  return ids.includes('*') || ids.includes(restaurantId);
}

function enabledFor(session: CallSession): boolean {
  session.sttSecondOpinionEnabled ??= isSttSecondOpinionEnabled(session.restaurantId);
  return session.sttSecondOpinionEnabled;
}

/** Mots comparables : minuscules, sans ponctuation ni hésitations. */
export function comparableWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word && !FILLERS.has(word));
}

export function transcriptsDiffer(first: string, second: string): boolean {
  return comparableWords(first).join(' ') !== comparableWords(second).join(' ');
}

/**
 * Garde les dernières secondes d'audio envoyées à Deepgram, avec leur position dans le flux de la
 * connexion (les offsets Deepgram en dépendent). Une reconnexion remet le compteur à zéro : le tampon
 * repart alors de rien.
 */
export function recordSecondOpinionAudio(
  session: CallSession,
  providerAudio: Buffer,
  connectionStartByte: number,
  bytesPerMs: number,
): void {
  if (!enabledFor(session)) return;
  const chunks = (session.sttSecondOpinionAudio ??= []);
  const last = chunks.at(-1);
  if (last && connectionStartByte < last.startByte + last.data.length) chunks.length = 0;
  chunks.push({ startByte: connectionStartByte, data: Buffer.from(providerAudio) });
  const keepFrom = connectionStartByte + providerAudio.length - AUDIO_RETENTION_MS * bytesPerMs;
  while (chunks.length > 1 && chunks[0].startByte + chunks[0].data.length <= keepFrom)
    chunks.shift();
}

function ulawToPcm16(input: Buffer): Buffer {
  const output = Buffer.alloc(input.length * 2);
  for (let i = 0; i < input.length; i++) {
    const u = ~input[i] & 0xff;
    const exponent = (u >> 4) & 0x07;
    const magnitude = (((u & 0x0f) << 3) + 0x84) << exponent;
    output.writeInt16LE((u & 0x80 ? 0x84 - magnitude : magnitude - 0x84) | 0, i * 2);
  }
  return output;
}

function wavFromPcm16(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Audio de la phrase [startMs, endMs] (offsets Deepgram), en WAV PCM16, ou null s'il n'est plus tenu. */
export function extractUtteranceWav(
  session: CallSession,
  startMs: number,
  endMs: number,
  bytesPerMs: number,
): Buffer | null {
  const chunks = session.sttSecondOpinionAudio ?? [];
  if (!chunks.length || endMs <= startMs) return null;
  const from = Math.max(0, Math.floor((startMs - LEAD_MS) * bytesPerMs));
  const to = Math.ceil((endMs + TAIL_MS) * bytesPerMs);
  if (chunks[0].startByte > from) return null;
  const parts: Buffer[] = [];
  for (const chunk of chunks) {
    const chunkEnd = chunk.startByte + chunk.data.length;
    if (chunkEnd <= from || chunk.startByte >= to) continue;
    parts.push(
      chunk.data.subarray(
        Math.max(0, from - chunk.startByte),
        Math.min(chunk.data.length, to - chunk.startByte),
      ),
    );
  }
  if (!parts.length) return null;
  const raw = Buffer.concat(parts);
  // Audio tel que Deepgram le reçoit : A-law ou µ-law à 8 kHz, ou PCM16 16 kHz (L16 déjà décodé).
  if (session.codec === 'L16') return wavFromPcm16(raw, 16_000);
  return wavFromPcm16(session.codec === 'PCMA' ? alawToPcm16(raw) : ulawToPcm16(raw), 8_000);
}

function dailyCapUsd(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.VOICE_STT_SECOND_OPINION_DAILY_USD);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DAILY_USD_CAP;
}

function spendKey(now = new Date()): string {
  return `stt-second-opinion:usd:${now.toISOString().slice(0, 10)}`;
}

export interface SecondOpinionDeps {
  fetcher?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  spend?: {
    get(key: string): Promise<string | null>;
    incrbyfloat(key: string, by: number): Promise<unknown>;
    expire(key: string, seconds: number): Promise<unknown>;
  };
}

async function transcribe(
  wav: Buffer,
  deps: SecondOpinionDeps,
): Promise<{ text: string; cost: number } | null> {
  const env = deps.env ?? process.env;
  const apiKey = (env.OPENROUTER_API_KEY ?? '').trim();
  if (!apiKey) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await (deps.fetcher ?? fetch)(
      'https://openrouter.ai/api/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: env.VOICE_STT_SECOND_OPINION_MODEL || DEFAULT_MODEL,
          input_audio: { data: wav.toString('base64'), format: 'wav' },
          language: 'fr',
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { text?: string; usage?: { cost?: number } };
    return { text: (body.text ?? '').trim(), cost: Number(body.usage?.cost) || 0 };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Lance le second avis d'une phrase finale Deepgram, sans jamais attendre ni lever : la réponse de
 * l'agent part avec le texte Deepgram. Le résultat, s'il diffère, devient la note du tour suivant.
 */
export function requestSecondOpinion(
  session: CallSession,
  transcript: string,
  words: readonly SttWord[] | undefined,
  speechEndOffsetMs: number | undefined,
  bytesPerMs: number,
  deps: SecondOpinionDeps = {},
): Promise<void> | undefined {
  if (!enabledFor(session) || session.sttAdapter?.id !== 'deepgram') return undefined;
  if (comparableWords(transcript).length < SECOND_OPINION_MIN_WORDS) return undefined;
  if ((session.sttSecondOpinionCount ?? 0) >= MAX_REQUESTS_PER_CALL) return undefined;
  const firstStart = words?.find((word) => typeof word.start === 'number')?.start;
  if (firstStart === undefined || !speechEndOffsetMs) return undefined;
  const wav = extractUtteranceWav(session, firstStart * 1000, speechEndOffsetMs, bytesPerMs);
  if (!wav) return undefined;
  session.sttSecondOpinionCount = (session.sttSecondOpinionCount ?? 0) + 1;
  const env = deps.env ?? process.env;
  const spend = deps.spend ?? redisCache;
  const key = spendKey();
  const startedAt = Date.now();
  return (async () => {
    try {
      const spent = Number(await spend.get(key)) || 0;
      if (spent >= dailyCapUsd(env)) {
        logger.info({ callId: session.callControlId }, '[stt-second-opinion] daily cap reached');
        return;
      }
      const result = await transcribe(wav, deps);
      if (!result) {
        logger.warn({ callId: session.callControlId }, '[stt-second-opinion] no result');
        return;
      }
      if (result.cost > 0) {
        await spend.incrbyfloat(key, result.cost);
        await spend.expire(key, 3 * 86_400);
      }
      const differ = Boolean(result.text) && transcriptsDiffer(transcript, result.text);
      if (differ)
        session.sttSecondOpinionNote = {
          heard: transcript,
          secondHeard: result.text,
          at: Date.now(),
        };
      logger.info(
        {
          callId: session.callControlId,
          differ,
          words: comparableWords(transcript).length,
          latencyMs: Date.now() - startedAt,
        },
        '[stt-second-opinion] result',
      );
    } catch (error) {
      logger.warn(
        {
          callId: session.callControlId,
          err: error instanceof Error ? error.message : String(error),
        },
        '[stt-second-opinion] failed',
      );
    }
  })();
}

/** Note encore valable pour le tour en cours ; aucune une fois la réservation créée. */
export function currentSecondOpinionNote(
  session: CallSession,
  reservationCreated: boolean,
  now = Date.now(),
): SecondOpinionNote | undefined {
  const note = session.sttSecondOpinionNote;
  if (!note || reservationCreated || now - note.at > SECOND_OPINION_NOTE_TTL_MS) return undefined;
  return note;
}

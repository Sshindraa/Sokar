/** Paired Deepgram tuning matrix plus a PCMA-versus-L16 audio-path comparison. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash as hash } from 'node:crypto';
import { dirname, join } from 'node:path';
import WebSocket from 'ws';
import { NB_A3_CALIBRATION_IDS, NB_A3_CORPUS, NOISE_SEEDS } from './nb-corpus';
import { synthesize16k } from './nb-tts';
import {
  addBackgroundNoise,
  alawEncode,
  alawRoundTrip,
  applyPacketLoss,
  downsampleBy2,
  packetLossSeed,
  telephoneBandpass,
} from './nb-dsp';

const DATA_DIR = join(__dirname, '.data');
const AUDIO_DIR = join(DATA_DIR, 'audio16');
const PROFILE_FILE = join(DATA_DIR, 'nb-a3-keyterms.json');
const OUTPUT_FILE = join(DATA_DIR, 'nb-a3-results.json');
const CHUNK_MS = 20;
const TRAILING_SILENCE_MS = 1_500;
const MAX_AUDIO_SECONDS = 7_200;
const NOVA_3_USD_PER_MINUTE = 0.0048;
const KEYTERM_USD_PER_MINUTE = 0.0013;
type AudioPath = 'PCMA_8k' | 'L16_16k';
type Variant = 'clean' | 'noisy';
type KeytermSet = 'current' | 'generated';

interface KeytermProfile {
  current: string[];
  generated: string[];
}

interface Settings {
  audioPath: AudioPath;
  numerals: boolean;
  punctuate: boolean;
  keytermSet: KeytermSet;
}

interface Task extends Settings {
  clipId: string;
  split: 'calibration' | 'validation';
  variant: Variant;
  text: string;
  audio: Buffer;
  bytesPerMs: number;
  sampleRate: 8000 | 16000;
  noiseSeed: number | null;
  snrDb: number | null;
}

interface Result extends Omit<Task, 'audio'> {
  transcript: string;
  error: string | null;
  latencyMs: number | null;
  messagesSent: number;
  audioSentMs: number;
}

function splitForClip(clipId: string): 'calibration' | 'validation' {
  return NB_A3_CALIBRATION_IDS.has(clipId) ? 'calibration' : 'validation';
}

function loadProfile(): KeytermProfile {
  if (!existsSync(PROFILE_FILE)) {
    throw new Error('Profil local absent; lancer nb-a3-profile.ts avant le banc');
  }
  const profile = JSON.parse(readFileSync(PROFILE_FILE, 'utf8')) as KeytermProfile;
  if (!Array.isArray(profile.current) || !Array.isArray(profile.generated)) {
    throw new Error('Format du profil local invalide');
  }
  return profile;
}

function makeTasks(limit: number): Task[] {
  const noise = NOISE_SEEDS[0];
  const settings: Settings[] = [];
  for (const numerals of [true, false]) {
    for (const punctuate of [true, false]) {
      for (const keytermSet of ['current', 'generated'] as const) {
        settings.push({ audioPath: 'PCMA_8k', numerals, punctuate, keytermSet });
      }
    }
  }

  const tasks: Task[] = [];
  for (const clip of NB_A3_CORPUS.slice(0, limit)) {
    const audioFile = join(
      AUDIO_DIR,
      `${createAudioCacheKey(clip.text, NB_A3_CORPUS.indexOf(clip))}.pcm`,
    );
    if (!existsSync(audioFile)) {
      throw new Error('Clip say manquant dans le cache local; aucun appel ne sera lancé');
    }
    const native = readFileSync(audioFile);
    const variants: Array<{
      variant: Variant;
      pcm: Buffer;
      seed: number | null;
      snrDb: number | null;
    }> = [
      { variant: 'clean', pcm: native, seed: null, snrDb: null },
      {
        variant: 'noisy',
        pcm: addBackgroundNoise(native, 16_000, { snrDb: noise.snrDb, seed: noise.seed }),
        seed: noise.seed,
        snrDb: noise.snrDb,
      },
    ];

    for (const item of variants) {
      const lossSeed = packetLossSeed(clip.id, 'B', item.variant, noise.seed);
      const narrowPcm = alawRoundTrip(
        downsampleBy2(telephoneBandpass(item.pcm, 16_000, { lowHz: 300, highHz: 3_400 })),
      );
      const narrowWithLoss =
        item.variant === 'noisy'
          ? applyPacketLoss(narrowPcm, 8_000, { lossRate: 0.02, seed: lossSeed })
          : narrowPcm;
      const wideWithLoss =
        item.variant === 'noisy'
          ? applyPacketLoss(item.pcm, 16_000, { lossRate: 0.02, seed: lossSeed })
          : item.pcm;

      for (const setting of settings) {
        tasks.push({
          ...setting,
          clipId: clip.id,
          split: splitForClip(clip.id),
          variant: item.variant,
          text: clip.text,
          audio: alawEncode(narrowWithLoss),
          bytesPerMs: 8,
          sampleRate: 8_000,
          noiseSeed: item.seed,
          snrDb: item.snrDb,
        });
      }

      for (const keytermSet of ['current', 'generated'] as const) {
        tasks.push({
          audioPath: 'L16_16k',
          numerals: true,
          punctuate: false,
          keytermSet,
          clipId: clip.id,
          split: splitForClip(clip.id),
          variant: item.variant,
          text: clip.text,
          audio: wideWithLoss,
          bytesPerMs: 32,
          sampleRate: 16_000,
          noiseSeed: item.seed,
          snrDb: item.snrDb,
        });
      }
    }
  }
  return tasks;
}

function createAudioCacheKey(text: string, index: number): string {
  return createHash(`${index}|${text}`);
}

function createHash(value: string): string {
  return hash('sha256').update(value).digest('hex').slice(0, 16);
}

async function ensureAudioCache(limit: number): Promise<void> {
  const provider = process.env.BENCH_TTS_PROVIDER ?? 'say';
  for (const clip of NB_A3_CORPUS.slice(0, limit)) {
    const index = NB_A3_CORPUS.indexOf(clip);
    const audioFile = join(AUDIO_DIR, `${createAudioCacheKey(clip.text, index)}.pcm`);
    if (existsSync(audioFile)) continue;
    if (provider !== 'say') {
      throw new Error('Clip say manquant; générer les sources A3 avec BENCH_TTS_PROVIDER=say');
    }

    let audio: Buffer;
    try {
      audio = await synthesize16k({
        text: clip.text,
        voice: String(index),
        provider: 'say',
        apiKey: '',
      });
    } catch {
      throw new Error('Synthèse locale say échouée; aucun appel Deepgram lancé');
    }
    mkdirSync(AUDIO_DIR, { recursive: true });
    writeFileSync(audioFile, audio);
  }
}

function deepgramUrl(task: Task, keyterms: readonly string[]): string {
  const params = new URLSearchParams({
    model: 'nova-3',
    language: 'fr',
    encoding: task.audioPath === 'PCMA_8k' ? 'alaw' : 'linear16',
    sample_rate: String(task.sampleRate),
    interim_results: 'true',
    endpointing: '300',
    utterance_end_ms: '1000',
    vad_events: 'true',
    smart_format: 'false',
    numerals: String(task.numerals),
    punctuate: String(task.punctuate),
    mip_opt_out: 'true',
  });
  for (const keyterm of keyterms) params.append('keyterm', keyterm);
  return `wss://api.deepgram.com/v1/listen?${params}`;
}

function safeError(code: string): string {
  if (/402|credit|balance|quota|insufficient/iu.test(code)) return 'account_limit';
  if (/http[_ ]?401|http[_ ]?403|auth/iu.test(code)) return 'auth_error';
  if (/http[_ ]?429|rate/iu.test(code)) return 'rate_limited';
  return 'provider_error';
}

async function streamTask(
  task: Task,
  keyterms: readonly string[],
  apiKey: string,
): Promise<Pick<Result, 'transcript' | 'error' | 'latencyMs' | 'messagesSent' | 'audioSentMs'>> {
  const ws = new WebSocket(deepgramUrl(task, keyterms), {
    headers: { Authorization: `Token ${apiKey}` },
  });
  const finals: string[] = [];
  let settled = false;
  let speechEndAt: number | null = null;
  let finalAt: number | null = null;
  let messagesSent = 0;
  let sentBytes = 0;
  let timer: ReturnType<typeof setTimeout>;

  return new Promise((resolve) => {
    const finish = (error: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // Socket already closed.
      }
      resolve({
        transcript: finals.join(' ').replace(/\s+/gu, ' ').trim(),
        error,
        latencyMs: speechEndAt !== null && finalAt !== null ? finalAt - speechEndAt : null,
        messagesSent,
        audioSentMs: sentBytes / task.bytesPerMs,
      });
    };

    timer = setTimeout(() => finish(finals.length ? null : 'timeout'), 20_000);
    ws.on('error', () => finish('websocket_error'));
    ws.on('unexpected-response', (_request, response) => {
      const status = response.statusCode ?? 0;
      response.resume();
      finish(safeError(`http_${status}`));
    });
    ws.on('open', async () => {
      const stepBytes = CHUNK_MS * task.bytesPerMs;
      const silenceBytes = TRAILING_SILENCE_MS * task.bytesPerMs;
      const alignedLength = Math.ceil(task.audio.length / stepBytes) * stepBytes;
      const padding = Buffer.alloc(
        alignedLength - task.audio.length,
        task.audioPath === 'PCMA_8k' ? 0xd5 : 0,
      );
      const trailingSilence = Buffer.alloc(silenceBytes, task.audioPath === 'PCMA_8k' ? 0xd5 : 0);
      const payload = Buffer.concat([task.audio, padding, trailingSilence]);

      for (let offset = 0; offset < payload.length && !settled; offset += stepBytes) {
        const sentAt = Date.now();
        const chunk = payload.subarray(offset, offset + stepBytes);
        ws.send(chunk);
        messagesSent++;
        sentBytes += chunk.length;
        if (speechEndAt === null && offset + chunk.length >= task.audio.length) {
          speechEndAt = sentAt + Math.max(0, task.audio.length - offset) / task.bytesPerMs;
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, CHUNK_MS));
      }
      if (!settled) {
        try {
          ws.send(JSON.stringify({ type: 'Finalize' }));
          messagesSent++;
        } catch {
          finish('finalize_send_error');
        }
      }
    });
    ws.on('message', (raw, isBinary) => {
      if (isBinary) return;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (event.type === 'Error') {
        finish(safeError(String(event.code ?? event.description ?? 'provider_error')));
      } else if (event.type === 'Results') {
        const channel = event.channel as { alternatives?: Array<{ transcript?: string }> };
        const transcript = channel?.alternatives?.[0]?.transcript?.trim() ?? '';
        if (event.is_final === true && transcript) finals.push(transcript);
        if (event.speech_final === true) {
          finalAt = Date.now();
          finish(finals.length ? null : 'empty_final');
        }
      }
    });
    ws.on('close', () => {
      if (!settled) finish(finals.length ? 'closed_without_speech_final' : 'closed_without_final');
    });
  });
}

async function main(): Promise<void> {
  const limit = Number(process.env.BENCH_LIMIT ?? NB_A3_CORPUS.length);
  const concurrency = Number(process.env.BENCH_CONCURRENCY ?? 4);
  if (!Number.isInteger(limit) || limit < 1 || limit > NB_A3_CORPUS.length) {
    throw new Error(`BENCH_LIMIT doit être entre 1 et ${NB_A3_CORPUS.length}`);
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error('BENCH_CONCURRENCY doit être entre 1 et 8');
  }

  const dryRun = process.env.BENCH_A3_DRY_RUN === '1';
  const profile =
    dryRun && !existsSync(PROFILE_FILE) ? { current: [], generated: [] } : loadProfile();
  await ensureAudioCache(limit);
  const tasks = makeTasks(limit);
  const keytermSets: Record<KeytermSet, string[]> = {
    current: profile.current,
    generated: profile.generated,
  };
  const totalSeconds = tasks.reduce(
    (total, task) =>
      total + task.audio.length / task.bytesPerMs / 1000 + TRAILING_SILENCE_MS / 1000,
    0,
  );
  const maxSeconds = Number(process.env.BENCH_DG_MAX_AUDIO_SECONDS ?? MAX_AUDIO_SECONDS);
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || totalSeconds > maxSeconds) {
    throw new Error(
      `Plafond audio dépassé: ${Math.ceil(totalSeconds)} s estimées, plafond ${maxSeconds} s`,
    );
  }
  const estimatedCost = (totalSeconds / 60) * (NOVA_3_USD_PER_MINUTE + KEYTERM_USD_PER_MINUTE);
  process.stderr.write(
    `Estimation avant envoi: Nova-3, ${tasks.length} sessions, ${totalSeconds.toFixed(1)} s audio ` +
      `(${(totalSeconds / 60).toFixed(2)} min), coût PAYG indicatif $${estimatedCost.toFixed(4)} USD; ` +
      `MIP opt-out actif; le tarif réel peut différer selon son impact tarifaire fournisseur.\n`,
  );
  if (dryRun) return;
  if (tasks.length > 8 && process.env.BENCH_CONFIRM !== '1') {
    throw new Error('BENCH_CONFIRM=1 obligatoire pour plus de 8 sessions');
  }
  const apiKey = process.env.DEEPGRAM_BENCH_API_KEY?.trim();
  if (!apiKey) throw new Error('DEEPGRAM_BENCH_API_KEY manquant; aucun appel lancé');

  const results: Result[] = new Array(tasks.length);
  let next = 0;
  let done = 0;
  let accountLimit = false;
  async function worker(): Promise<void> {
    while (next < tasks.length && !accountLimit) {
      const index = next++;
      const task = tasks[index];
      const result = await streamTask(task, keytermSets[task.keytermSet], apiKey);
      if (result.error === 'account_limit') accountLimit = true;
      const { audio: _audio, ...record } = task;
      results[index] = { ...record, ...result };
      done++;
      process.stderr.write(`\r${done}/${tasks.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  process.stderr.write('\n');
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, `${JSON.stringify(results.filter(Boolean), null, 2)}\n`);
  if (accountLimit) process.stderr.write('Arrêt après refus de crédits du fournisseur.\n');
  process.stderr.write(
    `Résultats sauvegardés dans ${OUTPUT_FILE}; ${results.filter(Boolean).length} sessions terminées.\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Erreur du runner banc';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

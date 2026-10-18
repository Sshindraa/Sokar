/**
 * Banc TTS : Eleven v4 Turbo contre Cartesia Sonic 3.6 (modèle de production).
 *
 * Mesure le délai avant le premier son (streaming), la durée totale et le coût.
 * Pour chaque phrase, écrit une version propre (16 kHz) et une version
 * « téléphone » (passe-bande 300–3400 Hz, 8 kHz, A-law) pour l'écoute.
 *
 * Garde-fous : clé ElevenLabs unique (ELEVENLABS_API_KEY, partagée dev, prod, staging) ; clé Cartesia
 * de production seulement avec `--shared-cartesia-key` ; plafond `BENCH_MAX_CREDITS`
 * obligatoire, vérifié avant et pendant le run.
 *
 * Usage depuis apps/api :
 *   BENCH_MAX_CREDITS=2000 pnpm exec tsx --env-file=.env scripts/voice-tts-bench/tts-compare.ts
 *   (--dry-run : plan et estimation sans appel réseau ; --shared-cartesia-key : CARTESIA_API_KEY ;
 *   --cartesia-only : Cartesia seul, sans appel ElevenLabs)
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import { WebSocket, type RawData } from 'ws';

// Réglages alignés sur la production.
const CARTESIA_WS_URL = 'wss://api.cartesia.ai/tts/websocket'; // cartesia-context.ts
const CARTESIA_VERSION = '2026-03-01'; // cartesia-context.ts
const CARTESIA_MODEL = 'sonic-3.6'; // packages/config/src/constants.ts
const CARTESIA_LOCALE = 'fr-FR'; // cartesia-synth.ts (locale par défaut)
const CARTESIA_NORMALIZATION = 'auto'; // cartesia-config.ts

// Voix ElevenLabs : Hamet (bibliothèque, français standard, conversationnelle).
// Les voix de la bibliothèque passent par l'API depuis le plan payant (14/10/2026).
const ELEVEN_MODEL = 'eleven_v4_turbo';
const ELEVEN_VOICE_ID = 'lPojg5cGgbhot31LKO2z';

// Facturation : Cartesia « 1 credit = 1 character » ; ElevenLabs Turbo compté à 0,5 (GET /v1/models).
const CARTESIA_CREDITS_PER_CHAR = 1;
const ELEVEN_CREDITS_PER_CHAR = 0.5;

const LATENCY_TEXT = "D'accord, je vous réserve une table pour deux.";
const LATENCY_RUNS = 10;

// Phrases de réservation du corpus narrowband (mêmes textes, sans bruit).
const QUALITY_PHRASES = [
  { id: 'c01', text: 'Pour quatre personnes, s’il vous plaît.' },
  { id: 'c03', text: 'Nous serons dix.' },
  { id: 'h01', text: 'Vers vingt heures trente, s’il vous plaît.' },
  { id: 'h02', text: 'À dix-neuf heures quarante-cinq.' },
  { id: 'h03', text: 'On arrive à 19h45.' },
  { id: 'd01', text: 'Pour samedi soir, s’il vous plaît.' },
  { id: 'd03', text: 'Vendredi prochain, ce serait bien.' },
  { id: 'n01', text: 'C’est au nom de Lefèvre.' },
  { id: 'n05', text: 'C’est L-E-F-È-V-R-E.' },
  { id: 't01', text: 'Mon numéro, c’est zéro six trois neuf neuf huit un deux trois quatre.' },
];

const OUT_DIR = join(process.cwd(), 'scripts', 'voice-tts-bench', '.data');

const dryRun = process.argv.includes('--dry-run');
const cartesiaOnly = process.argv.includes('--cartesia-only');
const maxCredits = Number(process.env.BENCH_MAX_CREDITS);
if (!Number.isFinite(maxCredits) || maxCredits <= 0) {
  throw new Error('BENCH_MAX_CREDITS doit être un nombre positif');
}

const cartesiaVoiceId = process.env.CARTESIA_VOICE_ID?.trim() ?? '';
if (!cartesiaVoiceId) throw new Error('CARTESIA_VOICE_ID absente');

const elevenKey = process.env.ELEVENLABS_API_KEY?.trim() ?? '';
// Clé Cartesia de production seulement sur demande explicite (--shared-cartesia-key).
const sharedCartesiaKey = process.argv.includes('--shared-cartesia-key');
const cartesiaKeyName = sharedCartesiaKey ? 'CARTESIA_API_KEY' : 'CARTESIA_BENCH_API_KEY';
const cartesiaKey = process.env[cartesiaKeyName]?.trim() ?? '';
if (!dryRun) {
  if (!cartesiaOnly && !elevenKey) throw new Error('ELEVENLABS_API_KEY absente');
  if (!cartesiaKey) throw new Error(`${cartesiaKeyName} absente`);
  if (!sharedCartesiaKey && cartesiaKey === process.env.CARTESIA_API_KEY?.trim()) {
    throw new Error('CARTESIA_BENCH_API_KEY identique à la clé de production');
  }
}

const cartesiaChars =
  LATENCY_TEXT.length * LATENCY_RUNS +
  QUALITY_PHRASES.reduce((sum, phrase) => sum + phrase.text.length, 0);
// Une synthèse de préchauffage côté ElevenLabs (non mesurée).
const elevenChars = cartesiaOnly ? 0 : cartesiaChars + LATENCY_TEXT.length;
const estimate = cartesiaChars * CARTESIA_CREDITS_PER_CHAR + elevenChars * ELEVEN_CREDITS_PER_CHAR;

// eslint-disable-next-line no-console
console.log(
  `Plan : ${QUALITY_PHRASES.length} phrases, ${LATENCY_RUNS} mesures de latence par fournisseur`,
);
// eslint-disable-next-line no-console
console.log(`Caractères envoyés : Cartesia ${cartesiaChars}, ElevenLabs ${elevenChars}`);
// eslint-disable-next-line no-console
console.log(`Estimation : ${Math.round(estimate)} crédits (plafond ${maxCredits})`);
// eslint-disable-next-line no-console
console.log(`Clés : ${cartesiaOnly ? '' : 'ELEVENLABS_API_KEY, '}${cartesiaKeyName}`);
// eslint-disable-next-line no-console
if (cartesiaOnly) console.log("Mode Cartesia seul : ElevenLabs n'est pas appelé.");
if (sharedCartesiaKey)
  // eslint-disable-next-line no-console
  console.log('Clé Cartesia partagée avec la production (--shared-cartesia-key).');
if (estimate > maxCredits) throw new Error('Estimation au-dessus du plafond BENCH_MAX_CREDITS');
if (dryRun) {
  // eslint-disable-next-line no-console
  console.log('Dry-run : aucun appel réseau.');
  process.exit(0);
}

let spent = 0;
function charge(credits: number): void {
  spent += credits;
  if (spent > maxCredits) {
    throw new Error(`Plafond dépassé : ${Math.round(spent)} > ${maxCredits} crédits`);
  }
}

interface Synthesis {
  ttfaMs: number;
  totalMs: number;
  pcm: Buffer;
}

interface QualityRow {
  id: string;
  text: string;
  cartesiaTtfaMs: number;
  cartesiaTotalMs: number;
  cartesiaAudioS: number;
  elevenTtfaMs?: number;
  elevenTotalMs?: number;
  elevenAudioS?: number;
}

/** Cartesia en WebSocket, comme le chemin v2 de production (cartesia-context.ts). */
function synthCartesia(text: string, voiceId: string): Promise<Synthesis> {
  return new Promise((resolve, reject) => {
    const url = new URL(CARTESIA_WS_URL);
    url.searchParams.set('cartesia_version', CARTESIA_VERSION);
    const ws = new WebSocket(url.toString(), { headers: { 'X-API-Key': cartesiaKey } });
    const chunks: Buffer[] = [];
    let t0 = 0;
    let ttfaMs = 0;
    let settled = false;
    const timer = setTimeout(() => {
      ws.terminate();
      fail(new Error('Cartesia : délai dépassé'));
    }, 30_000);

    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }

    ws.on('open', () => {
      // La connexion est ouverte avant la mesure, comme dans le tour de parole.
      t0 = performance.now();
      ws.send(
        JSON.stringify({
          model_id: CARTESIA_MODEL,
          transcript: text,
          voice: { mode: 'id', id: voiceId },
          locale: CARTESIA_LOCALE,
          normalization: CARTESIA_NORMALIZATION,
          context_id: randomUUID(),
          output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 16000 },
          continue: false,
          max_buffer_delay_ms: 0,
        }),
      );
    });
    ws.on('message', (raw: RawData) => {
      const msg = JSON.parse(raw.toString()) as {
        type?: string;
        done?: boolean;
        data?: string;
        message?: string;
      };
      if (msg.type === 'error') {
        ws.close();
        fail(new Error(`Cartesia : ${msg.message ?? 'erreur'}`));
        return;
      }
      if (msg.type === 'chunk' && msg.data) {
        if (chunks.length === 0) ttfaMs = performance.now() - t0;
        chunks.push(Buffer.from(msg.data, 'base64'));
      }
      if (msg.done === true || msg.type === 'done') {
        const totalMs = performance.now() - t0;
        ws.close();
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ ttfaMs, totalMs, pcm: Buffer.concat(chunks) });
        }
      }
    });
    ws.on('error', (error) => fail(error));
    ws.on('close', () => fail(new Error('Cartesia : connexion fermée avant la fin')));
  });
}

/** ElevenLabs en HTTP streaming : TTFA = premier octet du corps de réponse. */
async function synthEleven(text: string): Promise<Synthesis> {
  const t0 = performance.now();
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}/stream?output_format=pcm_16000`,
    {
      method: 'POST',
      headers: { 'xi-api-key': elevenKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: ELEVEN_MODEL }),
    },
  );
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`ElevenLabs TTS ${res.status}: ${detail.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let ttfaMs = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length > 0) {
      if (chunks.length === 0) ttfaMs = performance.now() - t0;
      chunks.push(Buffer.from(value));
    }
  }
  return { ttfaMs, totalMs: performance.now() - t0, pcm: Buffer.concat(chunks) };
}

async function elevenCharacterCount(): Promise<number> {
  const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
    headers: { 'xi-api-key': elevenKey },
  });
  if (!res.ok) throw new Error(`ElevenLabs abonnement HTTP ${res.status}`);
  const body = (await res.json()) as { character_count: number };
  return body.character_count;
}

function ffmpeg(args: string[]): void {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
}

/** Écrit la version propre (16 kHz) et la version téléphone (G.711 A-law, 8 kHz). */
function writeAudio(name: string, pcm: Buffer): void {
  const raw = join(OUT_DIR, `${name}.pcm`);
  writeFileSync(raw, pcm);
  ffmpeg([
    '-f',
    's16le',
    '-ar',
    '16000',
    '-ac',
    '1',
    '-i',
    raw,
    join(OUT_DIR, `${name}-clean.wav`),
  ]);
  const alaw = join(OUT_DIR, `${name}-phone-alaw.wav`);
  ffmpeg([
    '-f',
    's16le',
    '-ar',
    '16000',
    '-ac',
    '1',
    '-i',
    raw,
    '-af',
    'highpass=f=300,lowpass=f=3400',
    '-ar',
    '8000',
    '-c:a',
    'pcm_alaw',
    alaw,
  ]);
  ffmpeg(['-i', alaw, '-c:a', 'pcm_s16le', join(OUT_DIR, `${name}-phone.wav`)]);
  rmSync(raw);
  rmSync(alaw);
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

const round = (value: number): number => Math.round(value);
const audioSeconds = (pcm: Buffer): number => pcm.length / 2 / 16000;
const na = (value: number | null | undefined): string =>
  value === undefined || value === null ? '—' : String(value);

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const usageBefore = cartesiaOnly ? 0 : await elevenCharacterCount();

  const cartesiaTtfa: number[] = [];
  const elevenTtfa: number[] = [];
  const quality: QualityRow[] = [];

  // Préchauffage ElevenLabs (connexion HTTP), non mesuré.
  if (!cartesiaOnly) {
    await synthEleven(LATENCY_TEXT);
    charge(LATENCY_TEXT.length * ELEVEN_CREDITS_PER_CHAR);
  }

  for (let i = 0; i < LATENCY_RUNS; i += 1) {
    const cartesia = await synthCartesia(LATENCY_TEXT, cartesiaVoiceId);
    charge(LATENCY_TEXT.length * CARTESIA_CREDITS_PER_CHAR);
    cartesiaTtfa.push(cartesia.ttfaMs);

    if (!cartesiaOnly) {
      const eleven = await synthEleven(LATENCY_TEXT);
      charge(LATENCY_TEXT.length * ELEVEN_CREDITS_PER_CHAR);
      elevenTtfa.push(eleven.ttfaMs);
    }
  }

  for (const phrase of QUALITY_PHRASES) {
    const cartesia = await synthCartesia(phrase.text, cartesiaVoiceId);
    charge(phrase.text.length * CARTESIA_CREDITS_PER_CHAR);
    writeAudio(`cartesia-${phrase.id}`, cartesia.pcm);

    const row: QualityRow = {
      id: phrase.id,
      text: phrase.text,
      cartesiaTtfaMs: round(cartesia.ttfaMs),
      cartesiaTotalMs: round(cartesia.totalMs),
      cartesiaAudioS: Number(audioSeconds(cartesia.pcm).toFixed(2)),
    };
    if (!cartesiaOnly) {
      const eleven = await synthEleven(phrase.text);
      charge(phrase.text.length * ELEVEN_CREDITS_PER_CHAR);
      writeAudio(`eleven-${phrase.id}`, eleven.pcm);
      row.elevenTtfaMs = round(eleven.ttfaMs);
      row.elevenTotalMs = round(eleven.totalMs);
      row.elevenAudioS = Number(audioSeconds(eleven.pcm).toFixed(2));
    }
    quality.push(row);
  }

  const usageAfter = cartesiaOnly ? 0 : await elevenCharacterCount();
  const elevenRealCredits = usageAfter - usageBefore;

  const summary = {
    date: new Date().toISOString(),
    cartesiaVoiceId,
    elevenVoiceId: ELEVEN_VOICE_ID,
    latency: {
      runs: LATENCY_RUNS,
      cartesiaMedianMs: round(percentile(cartesiaTtfa, 50)),
      cartesiaP95Ms: round(percentile(cartesiaTtfa, 95)),
      elevenMedianMs: elevenTtfa.length ? round(percentile(elevenTtfa, 50)) : null,
      elevenP95Ms: elevenTtfa.length ? round(percentile(elevenTtfa, 95)) : null,
      cartesiaTtfaMs: cartesiaTtfa.map(round),
      elevenTtfaMs: elevenTtfa.map(round),
    },
    credits: {
      estimate: Math.round(estimate),
      spentEstimate: Math.round(spent),
      cap: maxCredits,
      elevenRealDelta: elevenRealCredits,
      elevenCharsSent: elevenChars,
      cartesiaCharsSent: cartesiaChars,
    },
    quality,
  };
  writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(summary, null, 2));

  const report = [
    '# Banc TTS : Eleven v4 Turbo vs Cartesia Sonic 3.6',
    '',
    `Date : ${summary.date}`,
    `Clés : ${cartesiaOnly ? '' : 'ELEVENLABS_API_KEY, '}${cartesiaKeyName}`,
    `Voix Cartesia : ${cartesiaVoiceId} (prod)${cartesiaOnly ? '' : ` · voix ElevenLabs : Hamet, bibliothèque (${ELEVEN_VOICE_ID})`}`,
    `Mesure : depuis le poste de développement, pas depuis le VPS. TTFA = requête envoyée jusqu'au premier chunk audio, ${LATENCY_RUNS} répétitions.`,
    ...(cartesiaOnly
      ? ["Mode : Cartesia seul. ElevenLabs n'est pas mesuré (compte bloqué)."]
      : [
          'Limite : ElevenLabs reçoit le texte sans indication de langue (détection automatique), Cartesia reçoit fr-FR. La latence reste comparable.',
        ]),
    '',
    '## Latence',
    '',
    '| Fournisseur | TTFA médian | TTFA p95 |',
    '| --- | ---: | ---: |',
    `| Cartesia Sonic 3.6 (WebSocket, chemin opt-in en prod) | ${summary.latency.cartesiaMedianMs} ms | ${summary.latency.cartesiaP95Ms} ms |`,
    ...(cartesiaOnly
      ? []
      : [
          `| ElevenLabs Eleven v4 Turbo (HTTP streaming) | ${na(summary.latency.elevenMedianMs)} ms | ${na(summary.latency.elevenP95Ms)} ms |`,
        ]),
    '',
    '## Phrases',
    '',
    '| Id | Texte | Cartesia TTFA / total (ms) | ElevenLabs TTFA / total (ms) | Durée audio Cartesia / Eleven (s) |',
    '| --- | --- | ---: | ---: | ---: |',
    ...quality.map(
      (q) =>
        `| ${q.id} | ${q.text} | ${q.cartesiaTtfaMs} / ${q.cartesiaTotalMs} | ${na(q.elevenTtfaMs)} / ${na(q.elevenTotalMs)} | ${q.cartesiaAudioS} / ${na(q.elevenAudioS)} |`,
    ),
    '',
    '## Crédits',
    '',
    `- Estimation : ${summary.credits.estimate} crédits (plafond ${maxCredits}), dépensé selon nos compteurs : ${summary.credits.spentEstimate}.`,
    `- Cartesia : ${cartesiaChars} caractères envoyés, facturés à 1 crédit (estimation, non lue sur le compte).`,
    `- ElevenLabs : ${elevenChars} caractères envoyés, consommation lue sur le compte partagé (le delta peut inclure du trafic staging) : ${elevenRealCredits} crédits.`,
    '',
    '## Écoute',
    '',
    'Fichiers `<fournisseur>-<id>-clean.wav` (16 kHz) et `<fournisseur>-<id>-phone.wav` (passe-bande 300–3400 Hz, G.711 A-law, 8 kHz).',
    '',
  ].join('\n');
  writeFileSync(join(OUT_DIR, 'report.md'), report);

  const wavs = readdirSync(OUT_DIR)
    .filter((file) => file.endsWith('.wav'))
    .sort();
  execFileSync('zip', [
    '-q',
    '-j',
    join(OUT_DIR, 'tts-compare.zip'),
    ...wavs.map((f) => join(OUT_DIR, f)),
    join(OUT_DIR, 'report.md'),
  ]);

  // eslint-disable-next-line no-console
  console.log(report);
  // eslint-disable-next-line no-console
  console.log(`Archive : ${join(OUT_DIR, 'tts-compare.zip')}`);
  // eslint-disable-next-line no-console
  console.log(`Crédits ElevenLabs réellement consommés : ${elevenRealCredits}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

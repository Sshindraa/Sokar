/**
 * Variantes ElevenLabs v4 Turbo : options de l'API absentes du premier banc.
 *
 * Le premier banc envoyait seulement `text` et `model_id` sur l'endpoint text-to-speech.
 * Ce script compare, sur la même voix (Hamet) et les mêmes phrases :
 * - `tts` : référence du premier banc ;
 * - `tts-fr` : + `language_code: 'fr'` (la locale fr-FR côté Cartesia) ;
 * - `tts-fr-norm-on` : + `apply_text_normalization: 'on'` (nombres et heures épelés) ;
 * - `dialogue-fr` : endpoint text-to-dialogue, avec `language_code: 'fr'`.
 *
 * Mesure le délai avant le premier son (10 répétitions) et écrit, pour chaque phrase, les
 * versions propre (16 kHz) et téléphone (G.711 A-law, 8 kHz). Clé unique ElevenLabs ;
 * plafond `BENCH_MAX_CREDITS` vérifié avant et pendant le run.
 *
 * Usage depuis apps/api :
 *   BENCH_MAX_CREDITS=2000 pnpm exec tsx --env-file=.env scripts/voice-tts-bench/eleven-variants.ts
 *   (--dry-run : plan et estimation sans appel réseau)
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';

const ELEVEN_MODEL = 'eleven_v4_turbo';
const ELEVEN_VOICE_ID = 'lPojg5cGgbhot31LKO2z'; // Hamet, bibliothèque
// Multiplicateur Turbo observé dans GET /v1/models (character_cost_multiplier).
const CREDITS_PER_CHAR = 0.5;

const LATENCY_TEXT = "D'accord, je vous réserve une table pour deux.";
const LATENCY_RUNS = 10;

// Mêmes phrases que le comparatif principal.
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

type Variant = 'tts' | 'tts-fr' | 'tts-fr-norm-on' | 'dialogue-fr';
const VARIANTS: Variant[] = ['tts', 'tts-fr', 'tts-fr-norm-on', 'dialogue-fr'];

const OUT_ROOT = join(process.cwd(), 'scripts', 'voice-tts-bench', '.data', 'variants');

const dryRun = process.argv.includes('--dry-run');
const maxCredits = Number(process.env.BENCH_MAX_CREDITS);
if (!Number.isFinite(maxCredits) || maxCredits <= 0) {
  throw new Error('BENCH_MAX_CREDITS doit être un nombre positif');
}

const elevenKey = process.env.ELEVENLABS_API_KEY?.trim() ?? '';
if (!dryRun && !elevenKey) throw new Error('ELEVENLABS_API_KEY absente');

const charsPerVariant =
  LATENCY_TEXT.length * (LATENCY_RUNS + 1) +
  QUALITY_PHRASES.reduce((sum, phrase) => sum + phrase.text.length, 0);
const estimate = charsPerVariant * VARIANTS.length * CREDITS_PER_CHAR;
// eslint-disable-next-line no-console
console.log(`Variantes : ${VARIANTS.join(', ')}`);
// eslint-disable-next-line no-console
console.log(`Caractères envoyés : ${charsPerVariant * VARIANTS.length} au total`);
// eslint-disable-next-line no-console
console.log(`Estimation : ${Math.round(estimate)} crédits (plafond ${maxCredits})`);
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

function buildRequest(
  variant: Variant,
  text: string,
): { url: string; body: Record<string, unknown> } {
  const output = 'output_format=pcm_16000';
  if (variant === 'dialogue-fr') {
    return {
      url: `https://api.elevenlabs.io/v1/text-to-dialogue/stream?${output}`,
      body: {
        inputs: [{ text, voice_id: ELEVEN_VOICE_ID }],
        model_id: ELEVEN_MODEL,
        language_code: 'fr',
      },
    };
  }
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}/stream?${output}`;
  const base = { text, model_id: ELEVEN_MODEL };
  if (variant === 'tts') return { url, body: base };
  if (variant === 'tts-fr') return { url, body: { ...base, language_code: 'fr' } };
  return { url, body: { ...base, language_code: 'fr', apply_text_normalization: 'on' } };
}

interface Synthesis {
  ttfaMs: number;
  totalMs: number;
  pcm: Buffer;
}

/** HTTP streaming : TTFA = premier octet du corps de réponse. */
async function synth(variant: Variant, text: string): Promise<Synthesis> {
  const { url, body } = buildRequest(variant, text);
  const t0 = performance.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': elevenKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${variant} HTTP ${res.status}: ${detail.slice(0, 200)}`);
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

async function usage(): Promise<number> {
  const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
    headers: { 'xi-api-key': elevenKey },
  });
  if (!res.ok) throw new Error(`ElevenLabs abonnement HTTP ${res.status}`);
  return ((await res.json()) as { character_count: number }).character_count;
}

function ffmpeg(args: string[]): void {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
}

/** Écrit la version propre (16 kHz) et la version téléphone (G.711 A-law, 8 kHz). */
function writeAudio(dir: string, name: string, pcm: Buffer): void {
  const raw = join(dir, `${name}.pcm`);
  writeFileSync(raw, pcm);
  ffmpeg(['-f', 's16le', '-ar', '16000', '-ac', '1', '-i', raw, join(dir, `${name}-clean.wav`)]);
  const alaw = join(dir, `${name}-phone-alaw.wav`);
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
  ffmpeg(['-i', alaw, '-c:a', 'pcm_s16le', join(dir, `${name}-phone.wav`)]);
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

interface VariantResult {
  error?: string;
  ttfaMs?: number[];
  ttfaMedianMs?: number;
  ttfaP95Ms?: number;
  quality?: Array<{ id: string; ttfaMs: number; totalMs: number; audioS: number }>;
}

async function main(): Promise<void> {
  mkdirSync(OUT_ROOT, { recursive: true });
  const usageBefore = await usage();
  const results: Record<string, VariantResult> = {};

  for (const variant of VARIANTS) {
    const dir = join(OUT_ROOT, variant);
    mkdirSync(dir, { recursive: true });
    try {
      await synth(variant, LATENCY_TEXT); // préchauffage, non mesuré
      charge(LATENCY_TEXT.length * CREDITS_PER_CHAR);

      const ttfaMs: number[] = [];
      for (let i = 0; i < LATENCY_RUNS; i += 1) {
        const sample = await synth(variant, LATENCY_TEXT);
        charge(LATENCY_TEXT.length * CREDITS_PER_CHAR);
        ttfaMs.push(round(sample.ttfaMs));
      }

      const quality: VariantResult['quality'] = [];
      for (const phrase of QUALITY_PHRASES) {
        const sample = await synth(variant, phrase.text);
        charge(phrase.text.length * CREDITS_PER_CHAR);
        writeAudio(dir, phrase.id, sample.pcm);
        quality.push({
          id: phrase.id,
          ttfaMs: round(sample.ttfaMs),
          totalMs: round(sample.totalMs),
          audioS: Number(audioSeconds(sample.pcm).toFixed(2)),
        });
      }

      results[variant] = {
        ttfaMs,
        ttfaMedianMs: round(percentile(ttfaMs, 50)),
        ttfaP95Ms: round(percentile(ttfaMs, 95)),
        quality,
      };
    } catch (error) {
      // Une variante refusée par l'API n'arrête pas les autres.
      results[variant] = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  const usageAfter = await usage();
  const realDelta = usageAfter - usageBefore;

  const lines = [
    '# Variantes ElevenLabs v4 Turbo (voix Hamet)',
    '',
    `Date : ${new Date().toISOString()}`,
    "Mesure : depuis le poste de développement. TTFA = requête envoyée jusqu'au premier chunk audio, 10 répétitions.",
    '',
    '## Latence',
    '',
    '| Variante | TTFA médian | TTFA p95 | Statut |',
    '| --- | ---: | ---: | --- |',
    ...VARIANTS.map((variant) => {
      const r = results[variant];
      if (r.error) return `| ${variant} | — | — | refusée : ${r.error} |`;
      return `| ${variant} | ${r.ttfaMedianMs} ms | ${r.ttfaP95Ms} ms | ok |`;
    }),
    '',
    '## Durée totale par phrase (ms)',
    '',
    `| Id | ${VARIANTS.join(' | ')} |`,
    `| --- | ${VARIANTS.map(() => '---:').join(' | ')} |`,
    ...QUALITY_PHRASES.map((phrase) => {
      const cells = VARIANTS.map((variant) => {
        const row = results[variant].quality?.find((q) => q.id === phrase.id);
        return row ? String(row.totalMs) : '—';
      });
      return `| ${phrase.id} | ${cells.join(' | ')} |`;
    }),
    '',
    `Crédits : estimation ${Math.round(estimate)}, compteur ElevenLabs lu avant/après : ${realDelta}.`,
    '',
  ];
  const report = lines.join('\n');
  writeFileSync(join(OUT_ROOT, 'results.json'), JSON.stringify(results, null, 2));
  writeFileSync(join(OUT_ROOT, 'report.md'), report);
  execFileSync('zip', ['-q', '-r', join(OUT_ROOT, 'variants.zip'), '.'], { cwd: OUT_ROOT });

  // eslint-disable-next-line no-console
  console.log(report);
  // eslint-disable-next-line no-console
  console.log(`Archive : ${join(OUT_ROOT, 'variants.zip')}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

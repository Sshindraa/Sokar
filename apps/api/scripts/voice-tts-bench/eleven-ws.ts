/**
 * Latence WebSocket d'ElevenLabs v4 Turbo (endpoint TTS stream-input), même méthode que le
 * banc Cartesia : connexion ouverte avant la mesure, puis délai entre l'envoi du texte et le
 * premier chunk audio. Mêmes phrase et voix (Hamet) que le banc HTTP.
 *
 * Usage depuis apps/api :
 *   BENCH_MAX_CREDITS=2000 pnpm exec tsx --env-file=.env scripts/voice-tts-bench/eleven-ws.ts
 */

import { performance } from 'node:perf_hooks';
import { WebSocket, type RawData } from 'ws';

const ELEVEN_MODEL = 'eleven_v4_turbo';
const ELEVEN_VOICE_ID = 'lPojg5cGgbhot31LKO2z'; // Hamet, bibliothèque
// Multiplicateur Turbo observé dans GET /v1/models (character_cost_multiplier).
const CREDITS_PER_CHAR = 0.5;
const LATENCY_TEXT = "D'accord, je vous réserve une table pour deux.";
const RUNS = 10;

const maxCredits = Number(process.env.BENCH_MAX_CREDITS);
if (!Number.isFinite(maxCredits) || maxCredits <= 0) {
  throw new Error('BENCH_MAX_CREDITS doit être un nombre positif');
}
const elevenKey = process.env.ELEVENLABS_API_KEY?.trim() ?? '';
if (!elevenKey) throw new Error('ELEVENLABS_API_KEY absente');

let spent = 0;
function charge(chars: number): void {
  spent += chars * CREDITS_PER_CHAR;
  if (spent > maxCredits) {
    throw new Error(`Plafond dépassé : ${Math.round(spent)} > ${maxCredits} crédits`);
  }
}

interface WsSample {
  ttfaMs: number;
  totalMs: number;
  bytes: number;
}

/** Une synthèse sur une connexion WebSocket neuve, comme le banc Cartesia. */
function synthWs(text: string): Promise<WsSample> {
  return new Promise((resolve, reject) => {
    const url =
      `wss://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}/stream-input` +
      `?model_id=${ELEVEN_MODEL}&output_format=pcm_16000`;
    const ws = new WebSocket(url, { headers: { 'xi-api-key': elevenKey } });
    let t0 = 0;
    let ttfaMs = 0;
    let gotAudio = false;
    let bytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      ws.terminate();
      fail(new Error('ElevenLabs WS : délai dépassé'));
    }, 30_000);

    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }

    ws.on('open', () => {
      // Message d'initialisation, puis texte avec flush et fin de flux.
      ws.send(
        JSON.stringify({ text: ' ', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
      );
      t0 = performance.now();
      ws.send(JSON.stringify({ text, flush: true }));
      ws.send(JSON.stringify({ text: '' }));
    });
    ws.on('message', (raw: RawData) => {
      const msg = JSON.parse(raw.toString()) as {
        audio?: string | null;
        isFinal?: boolean;
        error?: string;
        message?: string;
      };
      if (msg.error || msg.message) {
        ws.close();
        fail(new Error(`ElevenLabs WS : ${msg.error ?? msg.message}`));
        return;
      }
      if (msg.audio) {
        if (!gotAudio) {
          gotAudio = true;
          ttfaMs = performance.now() - t0;
        }
        bytes += Buffer.from(msg.audio, 'base64').length;
      }
      if (msg.isFinal) {
        const totalMs = performance.now() - t0;
        ws.close();
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ ttfaMs, totalMs, bytes });
        }
      }
    });
    ws.on('unexpected-response', (_request, response) => {
      let body = '';
      response.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf-8');
      });
      response.on('end', () => {
        const detail = body.replaceAll(elevenKey, '<masqué>').slice(0, 300);
        fail(new Error(`ElevenLabs WS : HTTP ${response.statusCode} à l'ouverture ${detail}`));
      });
    });
    ws.on('error', (error) => fail(error));
    ws.on('close', () => fail(new Error('ElevenLabs WS : connexion fermée avant la fin')));
  });
}

async function usage(): Promise<number> {
  const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
    headers: { 'xi-api-key': elevenKey },
  });
  if (!res.ok) throw new Error(`ElevenLabs abonnement HTTP ${res.status}`);
  return ((await res.json()) as { character_count: number }).character_count;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

async function main(): Promise<void> {
  const usageBefore = await usage();

  // Préchauffage, non mesuré.
  await synthWs(LATENCY_TEXT);
  charge(LATENCY_TEXT.length);

  const ttfa: number[] = [];
  const totals: number[] = [];
  let bytes = 0;
  for (let i = 0; i < RUNS; i += 1) {
    const sample = await synthWs(LATENCY_TEXT);
    charge(LATENCY_TEXT.length);
    ttfa.push(Math.round(sample.ttfaMs));
    totals.push(Math.round(sample.totalMs));
    bytes = sample.bytes;
  }

  const usageAfter = await usage();
  // eslint-disable-next-line no-console
  console.log(`ElevenLabs v4 Turbo, WebSocket stream-input, voix Hamet (${RUNS} mesures)`);
  // eslint-disable-next-line no-console
  console.log(`TTFA médian ${percentile(ttfa, 50)} ms, p95 ${percentile(ttfa, 95)} ms`);
  // eslint-disable-next-line no-console
  console.log(`Durée totale médiane ${percentile(totals, 50)} ms`);
  // eslint-disable-next-line no-console
  console.log(`Octets audio par synthèse : ${bytes}`);
  // eslint-disable-next-line no-console
  console.log(`Crédits dépensés selon nos compteurs : ${Math.round(spent)}`);
  // eslint-disable-next-line no-console
  console.log(
    `Compteur ElevenLabs avant/après : ${usageBefore} → ${usageAfter} (delta ${usageAfter - usageBefore})`,
  );
  // eslint-disable-next-line no-console
  console.log(`TTFA individuels : ${ttfa.join(', ')}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

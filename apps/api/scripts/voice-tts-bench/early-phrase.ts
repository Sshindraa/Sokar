/**
 * Banc « premiers mots » : phrase entière contre premiers mots (jusqu'à la première virgule) puis suite,
 * sur le WebSocket ElevenLabs Text to Dialogue, voix et format de production.
 *
 * Mode whole : t=0 = phrase complète disponible, envoyée avec flush.
 * Mode early : t=0 = fragment disponible (il l'est DELTA ms plus tôt que la phrase), suite envoyée à +DELTA.
 * Le gain réel = DELTA + (ttfa whole - ttfa early). Lecture simulée en temps réel (8 kHz) : les trous de
 * lecture (suite arrivée trop tard) sont mesurés et gardés dans les WAV.
 *
 * Usage depuis apps/api (≈ 1 200 crédits pour 4 phrases × 2 modes × 5 essais) :
 *   BENCH_MAX_CREDITS=1500 RUNS=5 pnpm exec tsx --env-file=.env scripts/voice-tts-bench/early-phrase.ts <dossier>
 */
import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdirSync } from 'node:fs';
import { WebSocket, type RawData } from 'ws';

const VOICE = 'YxrwjAKoUKULGd0g8K9Y';
const URL =
  'wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?model_id=eleven_v4_turbo' +
  '&output_format=alaw_8000&language_code=fr&sync_alignment=true';
const key = process.env.ELEVENLABS_API_KEY?.trim() ?? '';
if (!key) throw new Error('ELEVENLABS_API_KEY absente');
const MAX_CREDITS = Number(process.env.BENCH_MAX_CREDITS ?? '1500');
const RUNS = Number(process.env.RUNS ?? '5');
// Débit du `say` observé : ~5,5 ms par caractère (0,22 s pour ~40 caractères).
const MS_PER_CHAR = 5.5;
const OUT = process.argv[2] ?? '.';

const REPLIES = [
  ['Très bien, pour combien de personnes ?', ''],
  ["Avec plaisir, je regarde ce qu'il nous reste samedi soir.", ''],
  ['Parfait, c’est noté pour quatre personnes à vingt heures.', 'À quel nom, s’il vous plaît ?'],
  ["D'accord, et à quel nom dois-je noter la réservation ?", ''],
] as const;

let spent = 0;
const charge = (n: number) => {
  spent += n * 0.5;
  if (spent > MAX_CREDITS) throw new Error(`plafond ${MAX_CREDITS} dépassé`);
};

interface Send {
  atMs: number;
  text: string;
  flush: boolean;
}
interface Result {
  ttfaMs: number;
  chunks: Array<{ atMs: number; bytes: Buffer }>;
}

function run(sends: Send[]): Promise<Result> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL, { headers: { 'xi-api-key': key } });
    let t0 = 0;
    let ttfa = -1;
    const chunks: Result['chunks'] = [];
    const timer = setTimeout(() => reject(new Error('timeout')), 30_000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ voices: [VOICE] }));
      // Socket ouvert d'avance, comme en production.
      setTimeout(() => {
        t0 = performance.now();
        for (const s of sends) {
          setTimeout(() => {
            charge(s.text.length);
            ws.send(
              JSON.stringify({
                inputs: [{ text: s.text, voice_id: VOICE, new_turn: false }],
                flush: s.flush,
              }),
            );
          }, s.atMs);
        }
        const last = Math.max(...sends.map((s) => s.atMs));
        setTimeout(() => ws.send(JSON.stringify({ close_socket: true })), last + 5);
      }, 300);
    });
    ws.on('message', (raw: RawData) => {
      const msg = JSON.parse(raw.toString()) as {
        audio?: string;
        is_final?: boolean;
        error?: string;
      };
      if (msg.error) {
        clearTimeout(timer);
        reject(new Error(msg.error));
        return;
      }
      if (msg.audio) {
        const at = performance.now() - t0;
        if (ttfa < 0) ttfa = at;
        chunks.push({ atMs: at, bytes: Buffer.from(msg.audio, 'base64') });
      }
      if (msg.is_final) {
        clearTimeout(timer);
        ws.close();
        resolve({ ttfaMs: ttfa, chunks });
      }
    });
    ws.on('error', reject);
  });
}

/** Lecture temps réel à 8 kHz A-law (1 octet = 0,125 ms) : trous insérés quand l'audio manque. */
function playout(chunks: Result['chunks'], startOffsetMs: number) {
  let clock = -1;
  let holeMs = 0;
  const parts: Buffer[] = [];
  const silence = (ms: number) => Buffer.alloc(Math.round(ms * 8), 0xd5);
  if (startOffsetMs > 0) parts.push(silence(startOffsetMs));
  for (const c of chunks) {
    if (clock < 0) clock = c.atMs;
    if (c.atMs > clock) {
      holeMs += c.atMs - clock;
      parts.push(silence(c.atMs - clock));
      clock = c.atMs;
    }
    parts.push(c.bytes);
    clock += c.bytes.length / 8;
  }
  return { audio: Buffer.concat(parts), holeMs };
}

function wav(alaw: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + alaw.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(6, 20); // A-law
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(8000, 28);
  h.writeUInt16LE(1, 32);
  h.writeUInt16LE(8, 34);
  h.write('data', 36);
  h.writeUInt32LE(alaw.length, 40);
  return Buffer.concat([h, alaw]);
}

const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const rows: string[] = [];
  for (const [index, [first, second]] of REPLIES.entries()) {
    const comma = first.indexOf(', ');
    const fragment = first.slice(0, comma + 1);
    const rest = first.slice(comma + 2);
    const delta = Math.round(rest.length * MS_PER_CHAR);
    const tail = second
      ? [{ atMs: delta + Math.round(second.length * MS_PER_CHAR), text: ` ${second}`, flush: true }]
      : [];
    const whole: number[] = [];
    const early: number[] = [];
    const holes: number[] = [];
    const wholeHoles: number[] = [];
    for (let r = 0; r < RUNS; r++) {
      const a = await run([
        { atMs: 0, text: first, flush: true },
        ...tail.map((t) => ({ ...t, atMs: t.atMs - delta })),
      ]);
      const b = await run([
        { atMs: 0, text: fragment, flush: true },
        { atMs: delta, text: ` ${rest}`, flush: true },
        ...tail,
      ]);
      whole.push(a.ttfaMs);
      early.push(b.ttfaMs);
      // Même axe : t=0 = fragment prêt. La phrase entière n'est prête qu'à +delta.
      const pa = playout(a.chunks, 0);
      const pb = playout(b.chunks, 0);
      holes.push(pb.holeMs);
      wholeHoles.push(pa.holeMs);
      if (r === 0) {
        writeFileSync(`${OUT}/raw-${index + 1}-whole.wav`, wav(pa.audio));
        writeFileSync(`${OUT}/raw-${index + 1}-early.wav`, wav(pb.audio));
      }
    }
    const gain = delta + median(whole) - median(early);
    rows.push(
      `${index + 1}. « ${fragment} » | delta ${delta} ms | ttfa phrase ${Math.round(median(whole))} ms | ` +
        `ttfa fragment ${Math.round(median(early))} ms | gain médian ${Math.round(gain)} ms | ` +
        `trous premiers mots ${holes.map(Math.round).join('/')} ms, phrase entière ${wholeHoles.map(Math.round).join('/')} ms | ` +
        `bruts phrase ${whole.map(Math.round).join('/')} fragment ${early.map(Math.round).join('/')}`,
    );
    // eslint-disable-next-line no-console
    console.log(rows.at(-1));
  }
  writeFileSync(`${OUT}/results.txt`, rows.join('\n') + `\ncrédits estimés : ${spent}\n`);
  // eslint-disable-next-line no-console
  console.log(`crédits estimés : ${spent}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

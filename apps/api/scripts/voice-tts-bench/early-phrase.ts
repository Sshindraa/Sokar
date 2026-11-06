/**
 * Compare le découpage actuel à la virgule et la phrase complète, avec le même flux de texte.
 * Usage depuis apps/api : ELEVENLABS_TTS_VOICE_ID=<voix active> RUNS=2 BENCH_MAX_CREDITS=1500
 *   pnpm exec tsx --env-file=.env scripts/voice-tts-bench/early-phrase.ts <dossier neuf>
 * Sans fournisseur : pnpm exec tsx scripts/voice-tts-bench/early-phrase.ts --self-check
 */
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdirSync } from 'node:fs';
import { WebSocket, type RawData } from 'ws';
import { alawToPcm16 } from '../../src/modules/voice/stream/telnyx-codec';
import { PhraseSplitter } from '../../src/modules/voice/stream/structured-turn/say-stream';
import {
  buildElevenLabsDialogueUrl,
  buildOpeningMessage,
  buildTextMessage,
  buildCloseMessage,
  getPronunciationDictionaryLocator,
} from '../../src/modules/voice/stream/elevenlabs-dialogue-context';

const REPLIES = [
  'Très bien, pour combien de personnes ?',
  "Avec plaisir, je regarde ce qu'il nous reste samedi soir.",
  'Parfait, c’est noté pour quatre personnes à vingt heures. À quel nom, s’il vous plaît ?',
  "D'accord, et à quel nom dois-je noter la réservation ?",
  'La terrasse est ouverte, mais les places dépendent de la météo. Souhaitez-vous réserver ?',
  'Demain à vingt heures trente, pour quatre personnes, au nom de Martin. Puis-je réserver ?',
  'A, S, S, A, M. Est-ce bien cela ?',
] as const;
type Mode = 'early' | 'whole';
interface Send {
  atMs: number;
  text: string;
  flush: boolean;
}
interface Result {
  ttfaMs: number;
  chunks: Array<{ atMs: number; bytes: Buffer }>;
}

// Même flux caractère par caractère pour les deux modes, lettres/chiffres protégés par le vrai splitter.
function schedule(text: string, mode: Mode, msPerChar: number): Send[] {
  const splitter = new PhraseSplitter();
  const sends: Send[] = [];
  for (let i = 0; i < text.length; i++) {
    for (const phrase of splitter.push(text[i], { early: mode === 'early' })) {
      sends.push({ atMs: (i + 1) * msPerChar, text: phrase, flush: true });
    }
  }
  const rest = splitter.flush();
  if (rest) sends.push({ atMs: text.length * msPerChar, text: rest, flush: true });
  return sends;
}

/** Lecture immédiate à 8 kHz A-law : conserve l'attente initiale et les trous de sous-alimentation. */
function playout(chunks: Result['chunks']) {
  let clock = 0;
  let holeMs = 0;
  let maxHoleMs = 0;
  let holeCount = 0;
  const parts: Buffer[] = [];
  for (const [index, c] of chunks.entries()) {
    if (c.atMs > clock) {
      const gap = c.atMs - clock;
      if (index > 0) {
        holeMs += gap;
        maxHoleMs = Math.max(maxHoleMs, gap);
        holeCount++;
      }
      parts.push(Buffer.alloc(Math.round(gap * 8), 0xd5));
      clock = c.atMs;
    }
    parts.push(c.bytes);
    clock += c.bytes.length / 8;
  }
  return { audio: Buffer.concat(parts), holeMs, maxHoleMs, holeCount };
}

function wav(alaw: Buffer): Buffer {
  const pcm = alawToPcm16(alaw);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(16000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function run(sends: Send[], key: string, voice: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      buildElevenLabsDialogueUrl({
        outputFormat: 'alaw_8000',
        languageCode: 'fr',
        syncAlignment: true,
      }),
      { headers: { 'xi-api-key': key } },
    );
    let t0 = 0;
    let ttfa = -1;
    let settled = false;
    const chunks: Result['chunks'] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      ws.terminate();
      if (error) reject(error);
      else if (!chunks.length) reject(new Error('Aucun audio reçu'));
      else resolve({ ttfaMs: ttfa, chunks });
    };
    timers.push(setTimeout(() => finish(new Error('timeout')), 30_000));
    ws.on('open', () => {
      ws.send(JSON.stringify(buildOpeningMessage(voice, getPronunciationDictionaryLocator())));
      timers.push(
        setTimeout(() => {
          t0 = performance.now();
          for (const s of sends) {
            timers.push(
              setTimeout(() => {
                ws.send(JSON.stringify(buildTextMessage(voice, s.text, { flush: s.flush })));
              }, s.atMs),
            );
          }
          timers.push(
            setTimeout(
              () => ws.send(JSON.stringify(buildCloseMessage())),
              Math.max(...sends.map((s) => s.atMs)) + 5,
            ),
          );
        }, 300),
      );
    });
    ws.on('message', (raw: RawData) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          audio?: string;
          is_final?: boolean;
          error?: unknown;
        };
        if (msg.error) return finish(new Error('Erreur ElevenLabs (réponse omise)'));
        if (msg.audio) {
          const at = performance.now() - t0;
          if (ttfa < 0) ttfa = at;
          chunks.push({ atMs: at, bytes: Buffer.from(msg.audio, 'base64') });
        }
        if (msg.is_final) finish();
      } catch {
        finish(new Error('Réponse ElevenLabs invalide'));
      }
    });
    ws.on('error', () => finish(new Error('Connexion ElevenLabs interrompue')));
    ws.on('close', () => finish(new Error('Connexion fermée avant is_final')));
  });
}

function selfCheck() {
  const early = schedule(REPLIES[0], 'early', 5.5);
  const whole = schedule(REPLIES[0], 'whole', 5.5);
  assert.equal(early[0].text, 'Très bien,');
  assert.equal(whole[0].text, REPLIES[0]);
  assert(early[0].atMs < whole[0].atMs);
  for (const text of REPLIES) {
    for (const mode of ['early', 'whole'] as const) {
      const sends = schedule(text, mode, 5.5);
      assert.equal(sends.map((s) => s.text).join(' '), text);
      assert(sends.every((s, i) => i === 0 || s.atMs >= sends[i - 1].atMs));
    }
  }
  assert.equal(schedule(REPLIES[6], 'early', 5.5)[0].text, 'A, S, S, A, M.');
  const played = playout([
    { atMs: 100, bytes: Buffer.alloc(800, 1) },
    { atMs: 250, bytes: Buffer.alloc(800, 2) },
  ]);
  assert.equal(played.holeMs, 50);
  assert.equal(played.maxHoleMs, 50);
  assert.equal(played.holeCount, 1);
  assert.equal(played.audio.length, 2800);
  assert.equal(wav(played.audio).readUInt32LE(40), played.audio.length * 2);
}

async function main() {
  selfCheck();
  if (process.argv.includes('--self-check')) {
    // eslint-disable-next-line no-console
    console.log('Self-check OK : texte, chronologie, épellation, trous et WAV.');
    return;
  }
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  const voice = process.env.ELEVENLABS_TTS_VOICE_ID?.trim();
  assert(key, 'ELEVENLABS_API_KEY absente');
  assert(voice, 'ELEVENLABS_TTS_VOICE_ID requis : utiliser la voix réellement active');
  const runs = Number(process.env.RUNS ?? '2');
  const maxCredits = Number(process.env.BENCH_MAX_CREDITS ?? '1500');
  const rates = (process.env.BENCH_MS_PER_CHAR ?? '5.5,15').split(',').map(Number);
  assert(Number.isInteger(runs) && runs >= 1 && runs <= 10, 'RUNS doit être entre 1 et 10');
  assert(
    rates.length <= 4 && rates.every((r) => Number.isFinite(r) && r > 0 && r <= 100),
    'BENCH_MS_PER_CHAR invalide',
  );
  const estimatedCredits =
    rates.reduce(
      (total, rate) =>
        total +
        REPLIES.reduce(
          (sum, text) =>
            sum +
            (['early', 'whole'] as const).reduce(
              (n, mode) =>
                n + schedule(text, mode, rate).reduce((chars, s) => chars + s.text.length, 0),
              0,
            ),
          0,
        ),
      0,
    ) *
    runs *
    0.5;
  assert(
    Number.isFinite(maxCredits) && maxCredits > 0 && estimatedCredits <= maxCredits,
    `Budget insuffisant : estimation ${estimatedCredits}, plafond ${maxCredits}`,
  );
  const out = process.argv[2];
  assert(out, 'Dossier de sortie neuf requis');
  mkdirSync(out); // Refuse d'écraser les écoutes ou leur clé de décodage.
  const rows: object[] = [];
  const listen = [
    '<!doctype html><html lang="fr"><meta charset="utf-8"><title>Comparaison vocale</title><h1>Comparaison vocale</h1><p>Écoutez chaque paire avant de consulter decode-and-metrics.json. Notez le rythme, l’intonation et votre préférence dans scores.csv. Le silence initial est conservé. Chaque paire contient le même texte.</p>',
  ];
  const scores = [
    'paire,rythme_A,rythme_B,intonation_A,intonation_B,preference_A_B_egalite,commentaire',
  ];
  const metadata = {
    voice,
    model: 'eleven_v4_turbo',
    rates,
    runs,
    estimatedCredits,
    dictionary: getPronunciationDictionaryLocator(),
    createdAt: new Date().toISOString(),
  };
  writeFileSync(`${out}/metadata.json`, JSON.stringify(metadata, null, 2));
  let pair = 0;
  for (const rate of rates) {
    for (const [index, text] of REPLIES.entries()) {
      for (let repeat = 0; repeat < runs; repeat++) {
        const id = String(++pair).padStart(2, '0');
        const modes: Mode[] = randomInt(2) ? ['whole', 'early'] : ['early', 'whole'];
        for (const [arm, mode] of modes.entries()) {
          const sends = schedule(text, mode, rate);
          const result = await run(sends, key, voice);
          const played = playout(result.chunks);
          const file = `${id}-${arm === 0 ? 'A' : 'B'}.wav`;
          writeFileSync(`${out}/${file}`, wav(played.audio));
          rows.push({
            pair: id,
            file,
            mode,
            case: index + 1,
            text,
            repeat,
            msPerChar: rate,
            firstAudioMs: result.ttfaMs,
            holeMs: played.holeMs,
            maxHoleMs: played.maxHoleMs,
            holeCount: played.holeCount,
            sends,
          });
          writeFileSync(`${out}/decode-and-metrics.json`, JSON.stringify(rows, null, 2));
        }
        listen.push(
          `<h2>Paire ${id}</h2><p>A <audio controls preload="none" src="${id}-A.wav"></audio> B <audio controls preload="none" src="${id}-B.wav"></audio></p>`,
        );
        writeFileSync(`${out}/listen.html`, listen.join('\n') + '</html>');
        scores.push(`${id},,,,,,`);
        writeFileSync(`${out}/scores.csv`, scores.join('\n') + '\n');
        // eslint-disable-next-line no-console
        console.log(`Paire ${id} générée`);
      }
    }
  }
  // eslint-disable-next-line no-console
  console.log(`${pair} paires ; estimation ${estimatedCredits} crédits. Écouter avant de décoder.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

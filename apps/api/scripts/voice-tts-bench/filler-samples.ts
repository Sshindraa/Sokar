/**
 * Écoute des petits mots d'attente (voir `src/modules/voice/stream/voice-filler.ts`).
 *
 * 1. Banque : chaque son est généré comme au préchargement de production (HTTP ElevenLabs, voix Lucie, v4 Turbo,
 *    A-law 8 kHz, `language_code=fr`), puis coupé par `trimVoiceFillerAudio`. Un WAV par son, par ton et par action.
 * 2. Situations où le cas se produit vraiment (vérification d'un créneau, enregistrement final) : la version actuelle
 *    (silence puis réponse) et la version avec petit mot, sur une même chronologie réaliste (fin de parole = 0).
 *    Réponses de Léa générées sur le WebSocket Text to Dialogue, comme en production ; l'appelant a une autre voix
 *    (George, voix de base ElevenLabs).
 *
 * Niveaux : l'appelant et la réponse sont ramenés à -22 LUFS chacun ; les sons d'attente reçoivent le même gain que la
 * réponse de leur situation (leur niveau relatif reste celui du téléphone). Les deux versions d'une situation ont donc
 * exactement la même réponse au même niveau.
 *
 * Usage depuis apps/api (≈ 300 caractères neufs, le reste vient du cache disque) :
 *   BENCH_MAX_CREDITS=800 pnpm exec tsx --env-file=.env scripts/voice-tts-bench/filler-samples.ts <dossier>
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket, type RawData } from 'ws';
import { buildElevenLabsTtsRequest } from '../../src/modules/voice/stream/elevenlabs-tts';
import { alawToPcm16 } from '../../src/modules/voice/stream/telnyx-codec';
import {
  VOICE_FILLER_BANK,
  trimVoiceFillerAudio,
  type VoiceFillerPurpose,
  type VoiceFillerStyle,
} from '../../src/modules/voice/stream/voice-filler';

const LEA = 'YxrwjAKoUKULGd0g8K9Y'; // Lucie, voix de production depuis le 15/10
const CALLER = 'JBFqnCBsd6RMkjVDRZzb'; // George, voix de base
const MODEL = 'eleven_v4_turbo';
const CREDITS_PER_CHAR = 0.5;
const TARGET_LUFS = -22;
/** Réseau et téléphone, ajoutés à tout son de Léa (les deux versions de la même façon). */
const TRANSPORT_MS = 200;
const FILLER_DELAY_MS = 750;
/** Trame Telnyx : le dernier morceau d'un son est complété par du silence jusqu'à 100 ms. */
const FRAME_BYTES = 800;

const key = process.env.ELEVENLABS_API_KEY?.trim() ?? '';
if (!key) throw new Error('ELEVENLABS_API_KEY absente');
const maxCredits = Number(process.env.BENCH_MAX_CREDITS ?? '800');
const OUT = path.resolve(process.argv[2] ?? 'filler-samples');
let spent = 0;
const charge = (text: string) => {
  spent += text.length * CREDITS_PER_CHAR;
  if (spent > maxCredits) throw new Error(`plafond ${maxCredits} crédits dépassé`);
};

/** Audio déjà généré, gardé sur disque : une relance ne refacture rien. */
function cached(kind: string, voiceId: string, text: string, make: () => Promise<Buffer>) {
  const dir = path.join(OUT, '.cache');
  mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `${createHash('sha256').update(`${kind}|${voiceId}|${text}`).digest('hex').slice(0, 16)}.alaw`,
  );
  if (existsSync(file)) return Promise.resolve(readFileSync(file));
  return make().then((audio) => {
    writeFileSync(file, audio);
    return audio;
  });
}

function httpTts(voiceId: string, text: string): Promise<Buffer> {
  return cached('http', voiceId, text, () => httpTtsUncached(voiceId, text));
}

async function httpTtsUncached(voiceId: string, text: string): Promise<Buffer> {
  charge(text);
  const request = buildElevenLabsTtsRequest({
    apiKey: key,
    voiceId,
    model: MODEL,
    text,
    locale: 'fr-FR',
    codec: 'alaw8k',
  });
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} : ${await response.text()}`);
  return Buffer.from(await response.arrayBuffer());
}

function dialogueTts(text: string): Promise<Buffer> {
  return cached('dialogue', LEA, text, () => dialogueTtsUncached(text));
}

function dialogueTtsUncached(text: string): Promise<Buffer> {
  charge(text);
  const url =
    'wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?model_id=eleven_v4_turbo' +
    '&output_format=alaw_8000&language_code=fr';
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { 'xi-api-key': key } });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => reject(new Error('timeout')), 30_000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ voices: [LEA] }));
      ws.send(JSON.stringify({ inputs: [{ text, voice_id: LEA, new_turn: false }], flush: true }));
      ws.send(JSON.stringify({ close_socket: true }));
    });
    ws.on('message', (raw: RawData) => {
      const msg = JSON.parse(raw.toString()) as {
        audio?: string;
        is_final?: boolean;
        error?: string;
      };
      if (msg.error) return reject(new Error(msg.error));
      if (msg.audio) chunks.push(Buffer.from(msg.audio, 'base64'));
      if (msg.is_final) {
        clearTimeout(timer);
        ws.close();
        resolve(Buffer.concat(chunks));
      }
    });
    ws.on('error', reject);
  });
}

/** PCM 16 bits petit-boutiste, 8 kHz. */
const toPcm = (alaw: Buffer) => alawToPcm16(alaw);
const silence = (ms: number) => Buffer.alloc(Math.round(ms * 8) * 2);
const durationMs = (pcm: Buffer) => pcm.length / 16;
const padToFrame = (alaw: Buffer) =>
  Buffer.concat([
    alaw,
    Buffer.alloc((FRAME_BYTES - (alaw.length % FRAME_BYTES)) % FRAME_BYTES, 0xd5),
  ]);

function wav(pcm: Buffer): Buffer {
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

/** Sonie intégrée et crête vraie, par ffmpeg (ebur128, résumé sur stderr). */
function measure(pcm: Buffer, scratch: string): { lufs: number; peak: number } {
  writeFileSync(scratch, wav(pcm));
  const { stderr } = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', scratch, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  return {
    lufs: Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]),
    peak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]),
  };
}

function gain(pcm: Buffer, db: number): Buffer {
  const factor = 10 ** (db / 20);
  const out = Buffer.alloc(pcm.length);
  for (let i = 0; i < pcm.length; i += 2) {
    const v = Math.round(pcm.readInt16LE(i) * factor);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, v)), i);
  }
  return out;
}

/** Place des morceaux sur une chronologie (ms). Aucun chevauchement : chaque morceau part au plus tôt à `atMs`. */
function timeline(parts: Array<{ atMs: number; pcm: Buffer }>, tailMs = 600): Buffer {
  const end = Math.max(...parts.map((p) => p.atMs + durationMs(p.pcm))) + tailMs;
  const out = silence(end);
  for (const p of parts) p.pcm.copy(out, Math.round(p.atMs * 8) * 2);
  return out;
}

interface Situation {
  name: string;
  style: VoiceFillerStyle;
  caller: string;
  reply: string;
  /** Premier son de la réponse, ms après la fin de parole, côté serveur (mesures du 20–21/10). */
  replyServerMs: number;
  /** Petit mot joué : identifiant dans la banque. */
  filler: { purpose: VoiceFillerPurpose; id: string };
  /** Lancement réel de l'action par le code (fin du premier passage du modèle), ms après la fin de parole. */
  actionStartMs: number;
}

const SITUATIONS: Situation[] = [
  {
    name: 'situation-1-verification-creneau',
    style: 'CASUAL',
    caller: 'On serait quatre, vers vingt heures.',
    reply: "Oui, il me reste une table à vingt heures samedi. À quel nom, s'il vous plaît ?",
    replyServerMs: 2_700,
    actionStartMs: 1_250,
    filler: { purpose: 'lookup', id: 'un-instant-je-regarde' },
  },
  {
    name: 'situation-2-verification-creneau-ton-formel',
    style: 'FORMAL',
    caller: 'Avez-vous encore de la place demain midi pour deux personnes ?',
    reply:
      'Oui, nous avons de la place demain à midi et à midi et demi. Quelle heure vous conviendrait ?',
    replyServerMs: 2_800,
    actionStartMs: 1_300,
    filler: { purpose: 'lookup', id: 'un-instant-je-verifie' },
  },
  {
    name: 'situation-3-enregistrement-final',
    style: 'WARM',
    caller: "Oui, c'est parfait.",
    reply: "C'est noté, votre table pour quatre est réservée samedi à vingt heures.",
    replyServerMs: 2_600,
    actionStartMs: 1_200,
    filler: { purpose: 'booking', id: 'un-instant-j-enregistre' },
  },
  {
    name: 'situation-4-enregistrement-final-ton-formel',
    style: 'FORMAL',
    caller: 'Oui, tout est exact.',
    reply: 'Votre réservation est confirmée pour demain à midi et demi, au nom de Martin.',
    replyServerMs: 2_600,
    actionStartMs: 1_200,
    filler: { purpose: 'booking', id: 'j-enregistre' },
  },
];

async function main() {
  const bankDir = path.join(OUT, 'banque');
  const scratch = path.join(OUT, '.mesure.wav');
  mkdirSync(bankDir, { recursive: true });
  const rows: string[] = [];

  // 1. Banque.
  const fillerAudio = new Map<string, Buffer>(); // texte → A-law coupé
  for (const [style, purposes] of Object.entries(VOICE_FILLER_BANK)) {
    for (const [purpose, clips] of Object.entries(purposes)) {
      for (const clip of clips) {
        let alaw = fillerAudio.get(clip.text);
        if (!alaw) {
          alaw = trimVoiceFillerAudio(await httpTts(LEA, clip.text), 'PCMA');
          fillerAudio.set(clip.text, alaw);
        }
        const name = `${style.toLowerCase()}-${purpose}-${clip.id}.wav`;
        writeFileSync(path.join(bankDir, name), wav(toPcm(alaw)));
        rows.push(`banque | ${name} | « ${clip.text} » | ${Math.round(alaw.length / 8)} ms`);
      }
    }
  }

  // 2. Situations.
  for (const situation of SITUATIONS) {
    const callerPcm = toPcm(await httpTts(CALLER, situation.caller));
    const replyPcm = toPcm(await dialogueTts(situation.reply));
    const callerGain = TARGET_LUFS - measure(callerPcm, scratch).lufs;
    const replyGain = TARGET_LUFS - measure(replyPcm, scratch).lufs;
    const caller = gain(callerPcm, callerGain);
    const reply = gain(replyPcm, replyGain);
    // Fin de parole de l'appelant = 0 sur la chronologie : l'appelant commence à -durée.
    const callerAt = 400;
    const zero = callerAt + durationMs(caller);
    const replyReadyAt = zero + situation.replyServerMs + TRANSPORT_MS;

    const current = timeline([
      { atMs: callerAt, pcm: caller },
      { atMs: replyReadyAt, pcm: reply },
    ]);

    const parts = [{ atMs: callerAt, pcm: caller }];
    const { filler } = situation;
    const clip = VOICE_FILLER_BANK[situation.style][filler.purpose].find((c) => c.id === filler.id);
    if (!clip) throw new Error(`son inconnu ${filler.id}`);
    // Comme en production : au lancement de l'action, pas avant le délai après la fin de parole.
    const fillerAt = zero + Math.max(FILLER_DELAY_MS, situation.actionStartMs) + TRANSPORT_MS;
    const fillerPcm = gain(toPcm(padToFrame(fillerAudio.get(clip.text)!)), replyGain);
    parts.push({ atMs: fillerAt, pcm: fillerPcm });
    const fillerNotes = [`« ${clip.text} » à ${Math.round(fillerAt - zero)} ms`];
    const cursor = fillerAt + durationMs(fillerPcm);
    const replyAt = Math.max(replyReadyAt, cursor);
    parts.push({ atMs: replyAt, pcm: reply });
    const withFiller = timeline(parts);

    writeFileSync(path.join(OUT, `${situation.name}-actuel.wav`), wav(current));
    writeFileSync(path.join(OUT, `${situation.name}-avec-attente.wav`), wav(withFiller));
    const a = measure(current, scratch);
    const b = measure(withFiller, scratch);
    rows.push(
      `${situation.name} | ton ${situation.style} | réponse à ${Math.round(replyReadyAt - zero)} ms ` +
        `(actuel) / ${Math.round(replyAt - zero)} ms (avec attente) | sons : ${fillerNotes.join(', ')} | ` +
        `crête ${a.peak} / ${b.peak} dBFS | réponse et appelant à ${TARGET_LUFS} LUFS`,
    );
  }

  writeFileSync(
    path.join(OUT, 'resultats.txt'),
    `${rows.join('\n')}\ncrédits estimés : ${Math.round(spent)}\n`,
  );

  // eslint-disable-next-line no-console
  console.log(`${rows.join('\n')}\ncrédits estimés : ${Math.round(spent)}`);
}

main()
  // Le client Redis importé avec la banque garde le processus ouvert.
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });

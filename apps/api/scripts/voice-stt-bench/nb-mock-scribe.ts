/**
 * Banc narrowband (phase 1) — faux serveur Scribe Realtime, pour vérifier la
 * plomberie hors ligne **sans crédit fournisseur**.
 *
 * Il parle le protocole minimal attendu par `nb-run.ts` : `session_started`,
 * une partielle, puis un commit déclenché par le silence final. Pour que la
 * table de score ne soit pas vide de sens, il reconnaît les clips **non
 * dégradés** (condition A) par une empreinte PCM et renvoie le vrai texte ;
 * tout le reste tombe sur un repli. Cela prouve que la chaîne
 * synthèse → conditions → WebSocket → latence/messages → scoring fonctionne.
 * **Ce n'est pas une mesure** : les transcriptions B/C/D sont volontairement
 * fausses ici, seul le fournisseur réel peut les produire.
 *
 * Usage :
 *   BENCH_STT_URL=ws://127.0.0.1:8799 node --import tsx scripts/voice-stt-bench/nb-mock-scribe.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { NB_CORPUS, clipVoice } from './nb-corpus';

const PORT = Number(process.env.BENCH_MOCK_PORT ?? 8799);
const AUDIO_DIR = join(__dirname, '.data', 'audio16');
const PREFIX_BYTES = 4000;
const FALLBACK = "je n'ai pas compris";

const TEXT_BY_FINGERPRINT = new Map<string, string>();

/** Nom de cache identique à `nb-run.ts` : sha256(`${voice}|${text}`) tronqué. */
function cacheName(voice: string, text: string): string {
  return `${createHash('sha256').update(`${voice}|${text}`).digest('hex').slice(0, 16)}.pcm`;
}

function fingerprint(pcm: Buffer): string {
  return createHash('sha256').update(pcm.subarray(0, PREFIX_BYTES)).digest('hex');
}

function loadFingerprints(): number {
  let loaded = 0;
  NB_CORPUS.forEach((clip, index) => {
    // Le runner a pu utiliser une voix Cartesia (UUID) ou `say` (index).
    for (const voice of [clipVoice(index), String(index)]) {
      const file = join(AUDIO_DIR, cacheName(voice, clip.text));
      if (!existsSync(file)) continue;
      TEXT_BY_FINGERPRINT.set(fingerprint(readFileSync(file)), clip.text);
      loaded++;
    }
  });
  return loaded;
}

function detectText(chunks: Buffer[]): string {
  return TEXT_BY_FINGERPRINT.get(fingerprint(Buffer.concat(chunks))) ?? FALLBACK;
}

function main(): void {
  const cached = existsSync(AUDIO_DIR) ? readdirSync(AUDIO_DIR).length : 0;
  const loaded = loadFingerprints();
  process.stderr.write(
    `mock Scribe Realtime sur ws://127.0.0.1:${PORT} (${loaded} empreintes, ${cached} fichiers)\n`,
  );

  const server = new WebSocketServer({ port: PORT });
  server.on('connection', (socket) => {
    const chunks: Buffer[] = [];
    let silentSamples = 0;
    let committed = false;

    socket.send(
      JSON.stringify({
        message_type: 'session_started',
        session_id: 'mock-session',
        config: { audio_format: 'mock', sample_rate: 16000, language_code: 'fr' },
      }),
    );

    socket.on('message', (raw) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (event.message_type !== 'input_audio_chunk') return;
      const chunk = Buffer.from(String(event.audio_base_64 ?? ''), 'base64');
      chunks.push(chunk);
      const sampleRate = Number(event.sample_rate ?? 16000);
      const totalSamples = Math.floor(chunk.length / 2);
      let silent = 0;
      for (let index = 0; index + 1 < chunk.length; index += 2) {
        if (chunk.readInt16LE(index) === 0) silent++;
      }
      silentSamples = silent === totalSamples ? silentSamples + silent : 0;

      if (!committed && silentSamples >= sampleRate * 0.8) {
        committed = true;
        // Le cache audio peut se remplir après le démarrage du mock : on relit
        // les empreintes au moment du commit, coût négligeable.
        loadFingerprints();
        const text = detectText(chunks);
        socket.send(
          JSON.stringify({
            message_type: 'partial_transcript',
            text: text.split(' ').slice(0, 2).join(' '),
          }),
        );
        socket.send(
          JSON.stringify({
            message_type: 'committed_transcript_with_timestamps',
            text,
            words: text.split(' ').map((word) => ({ text: word, type: 'word', logprob: 0 })),
          }),
        );
      }
    });
  });
}

main();

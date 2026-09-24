/**
 * Banc STT vocal — synthèse, dégradation téléphonique et transcription Scribe.
 *
 * À lancer sur le serveur, où se trouvent les clés (jamais copiées ailleurs) :
 *   node --env-file=.env scripts/voice-stt-bench/transcribe.cjs phrases.json > transcripts.json
 *
 * Chaque phrase est synthétisée par Cartesia en PCM 8 kHz, dégradée comme un
 * appel (bruit au SNR demandé, paquets de 20 ms perdus, codec A-law), puis
 * envoyée à Scribe avec l'URL de production (`buildSttUrl`, codec PCMA).
 * Les phrases sont synthétiques : aucun contenu d'appel réel n'est traité.
 * Sortie par phrase : transcription, mots avec `logprob`, transcriptions partielles.
 */
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');

const apiRoot = path.resolve(__dirname, '../..');
const { buildSttUrl } = require(path.join(apiRoot, 'dist/modules/voice/stream/stt-bridge.js'));

const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 4);
const FRAME = 160; // 20 ms à 8 kHz

function seeded(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function linearToAlaw(sample) {
  let s = sample;
  const sign = (s >> 8) & 0x80;
  if (sign) s = -s;
  if (s > 32635) s = 32635;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; exponent--, mask >>= 1);
  const mantissa = (s >> (exponent === 0 ? 4 : exponent + 3)) & 0x0f;
  return ((sign ? 0 : 0x80) | (exponent << 4) | mantissa) ^ 0x55;
}

/** Même décodage que `toPcm16FromAlaw` en production. */
function alawToPcm16(input) {
  const output = Buffer.alloc(input.length * 2);
  for (let i = 0; i < input.length; i++) {
    const a = input[i] ^ 0x55;
    let sample = (a & 0x0f) << 4;
    const segment = (a & 0x70) >> 4;
    if (segment === 0) sample += 8;
    else if (segment === 1) sample += 0x108;
    else {
      sample += 0x108;
      sample <<= segment - 1;
    }
    output.writeInt16LE(a & 0x80 ? sample : -sample, i * 2);
  }
  return output;
}

/** Bruit blanc au SNR demandé, pertes de paquets, puis aller-retour A-law. */
function degrade(pcm, { snrDb, packetLoss, id }) {
  const random = seeded([...id].reduce((sum, char) => sum * 31 + char.charCodeAt(0), 7) >>> 0);
  const samples = pcm.length / 2;
  let power = 0;
  for (let i = 0; i < samples; i++) power += pcm.readInt16LE(i * 2) ** 2;
  const noiseRms = Math.sqrt(power / Math.max(1, samples) / 10 ** (snrDb / 10));
  const alaw = Buffer.alloc(samples);
  for (let frame = 0; frame < samples; frame += FRAME) {
    const lost = random() < packetLoss;
    for (let i = frame; i < Math.min(samples, frame + FRAME); i++) {
      const gaussian =
        Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());
      const value = lost ? 0 : pcm.readInt16LE(i * 2) + gaussian * noiseRms;
      alaw[i] = linearToAlaw(Math.max(-32768, Math.min(32767, Math.round(value))));
    }
  }
  return alawToPcm16(alaw);
}

async function synthesize(phrase) {
  const response = await fetch('https://api.cartesia.ai/tts/bytes', {
    method: 'POST',
    headers: {
      'X-API-Key': process.env.CARTESIA_API_KEY.replace(/"/g, ''),
      'Cartesia-Version': '2025-04-16',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model_id: 'sonic-2',
      transcript: phrase.text,
      voice: {
        mode: 'id',
        id: phrase.voice,
        ...(phrase.speed ? { __experimental_controls: { speed: phrase.speed } } : {}),
      },
      output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 8000 },
      language: 'fr',
    }),
  });
  if (!response.ok) throw new Error(`Cartesia ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function transcribe(audio) {
  return new Promise((resolve) => {
    const url = buildSttUrl(undefined, 'PCMA', undefined, { restaurantName: 'Chez Sokar' });
    const ws = new WebSocket(url, { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } });
    const committed = [];
    const words = [];
    const partials = [];
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      ws.close();
      resolve({ transcript: committed.join(' ').trim(), words, partials, error: error ?? null });
    };
    const timer = setTimeout(() => finish(committed.length ? null : 'timeout'), 15000);
    ws.on('error', (err) => finish(err.message));
    ws.on('message', async (raw) => {
      const event = JSON.parse(raw);
      if (event.message_type === 'session_started') {
        const send = (chunk) =>
          ws.send(
            JSON.stringify({
              message_type: 'input_audio_chunk',
              audio_base_64: chunk.toString('base64'),
              sample_rate: 8000,
            }),
          );
        for (let i = 0; i < audio.length; i += FRAME * 2) {
          send(audio.subarray(i, i + FRAME * 2));
          await new Promise((r) => setTimeout(r, 20));
        }
        const silence = Buffer.alloc(FRAME * 2);
        for (let i = 0; i < 100; i++) {
          send(silence);
          await new Promise((r) => setTimeout(r, 20));
        }
        clearTimeout(timer);
        setTimeout(() => finish(), 1500);
      } else if (event.message_type === 'partial_transcript' && event.text?.trim()) {
        if (partials.at(-1) !== event.text.trim()) partials.push(event.text.trim());
      } else if (
        event.message_type === 'committed_transcript_with_timestamps' &&
        event.text?.trim()
      ) {
        committed.push(event.text.trim());
        // Mots et log-probabilités, pour mesurer la confiance comme en production.
        for (const word of event.words ?? []) {
          if (word.type === 'spacing' || !(word.text ?? word.word)) continue;
          words.push({ word: word.text ?? word.word, logprob: word.logprob ?? null });
        }
      } else if (/error/i.test(event.message_type ?? '')) {
        finish(event.message_type);
      }
    });
  });
}

async function main() {
  const phrases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const results = new Array(phrases.length);
  let next = 0;
  async function worker() {
    while (next < phrases.length) {
      const index = next++;
      const phrase = phrases[index];
      try {
        const audio = degrade(await synthesize(phrase), phrase);
        results[index] = { id: phrase.id, ...(await transcribe(audio)) };
      } catch (err) {
        results[index] = { id: phrase.id, transcript: '', error: err.message };
      }
      process.stderr.write(`\r${results.filter(Boolean).length}/${phrases.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stderr.write('\n');
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`, () => process.exit(0));
}

// Réutilisé par `second-opinion.cjs` : même synthèse, même dégradation, même Scribe Realtime.
module.exports = { degrade, synthesize, transcribe };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

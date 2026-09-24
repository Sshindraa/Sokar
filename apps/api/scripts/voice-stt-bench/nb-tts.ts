/**
 * Banc narrowband (phase 1) — synthèse TTS 16 kHz native.
 *
 * Source audio en PCM16 16 kHz (Cartesia par défaut, ElevenLabs en repli), car
 * la référence « haute » du banc doit être la voix non dégradée par G.711.
 * L'audio n'est synthétisé qu'une fois par clip puis mis en cache dans
 * `.data/audio16/` : les quatre conditions relisent exactement le même signal.
 *
 * Aucune clé n'est codée en dur : les valeurs viennent de l'environnement.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type TtsProvider = 'cartesia' | 'elevenlabs' | 'say';

export interface SynthOptions {
  text: string;
  voice: string;
  provider: TtsProvider;
  apiKey: string;
}

const CARTESIA_URL = 'https://api.cartesia.ai/tts/bytes';
const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

/** Renvoie du PCM16 mono 16 kHz brut. */
export async function synthesize16k(options: SynthOptions): Promise<Buffer> {
  if (options.provider === 'cartesia') return synthesizeCartesia(options);
  if (options.provider === 'say') return synthesizeMacSay(options);
  return synthesizeElevenLabs(options);
}

/**
 * Repli local sans crédit fournisseur : la synthèse macOS `say`, en 16 kHz
 * PCM16. Plusieurs voix françaises (Thomas, Jacques, Amélie) donnent la variété
 * demandée sans consommer Cartesia ni ElevenLabs. Utile quand le compte TTS est
 * épuisé, à condition de le signaler dans le rapport.
 */
const SAY_VOICES = ['Thomas', 'Jacques', 'Amélie'];

function synthesizeMacSay({ text, voice }: SynthOptions): Buffer {
  const sayVoice = SAY_VOICES[Number.parseInt(voice, 10) % SAY_VOICES.length] ?? SAY_VOICES[0];
  const file = join(tmpdir(), `nb-say-${Date.now()}-${Math.round(Math.random() * 1e6)}.wav`);
  try {
    execFileSync('say', ['-v', sayVoice, '--data-format=LEI16@16000', '-o', file, text]);
    return stripWavHeader(readFileSync(file));
  } finally {
    try {
      unlinkSync(file);
    } catch {
      /* best effort */
    }
  }
}

/** Extrait le flux PCM d'un WAV en localisant le chunk `data`. */
function stripWavHeader(buffer: Buffer): Buffer {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'data') return buffer.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  return buffer;
}

async function synthesizeCartesia({ text, voice, apiKey }: SynthOptions): Promise<Buffer> {
  const response = await fetch(CARTESIA_URL, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Cartesia-Version': '2025-04-16',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model_id: 'sonic-2',
      transcript: text,
      voice: { mode: 'id', id: voice },
      output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 16000 },
      language: 'fr',
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Cartesia TTS ${response.status}: ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function synthesizeElevenLabs({ text, voice, apiKey }: SynthOptions): Promise<Buffer> {
  const model = process.env.BENCH_TTS_MODEL ?? 'eleven_multilingual_v2';
  const response = await fetch(
    `${ELEVENLABS_URL}/${encodeURIComponent(voice)}?output_format=pcm_16000`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      // `language_code` n'est accepté que par les modèles v2.5 (turbo/flash).
      body: JSON.stringify(
        model.includes('v2_5')
          ? { text, model_id: model, language_code: 'fr' }
          : { text, model_id: model },
      ),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`ElevenLabs TTS ${response.status}: ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

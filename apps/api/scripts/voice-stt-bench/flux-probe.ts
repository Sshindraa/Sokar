/**
 * Sonde des « finals manquants » de Flux (banc nb-flux du 25/09) : rejoue un clip synthétique du banc
 * avec un silence d'amorce variable et un silence de fin prolongé, et journalise chaque événement
 * `TurnInfo` reçu (sans texte). Coût : quelques secondes d'audio Flux par variante.
 *
 *   cd apps/api && node --env-file=.env --import tsx scripts/voice-stt-bench/flux-probe.ts c02 c05 t01
 */
import WebSocket from 'ws';
import { NB_CORPUS } from './nb-corpus';
import { alawEncode, alawRoundTrip, downsampleBy2, telephoneBandpass } from './nb-dsp';
import { synthesize16k } from './nb-tts';

const CHUNK_MS = 20;
const BYTES_PER_MS = 8;
const ALAW_SILENCE = 0xd5;

interface ProbeEvent {
  atAudioMs: number;
  event: string;
  words: number;
  trigger?: unknown;
  eotConfidence?: unknown;
}

function fluxUrl(): string {
  const params = new URLSearchParams({
    model: 'flux-general-multi',
    language_hint: 'fr',
    encoding: 'alaw',
    sample_rate: '8000',
    eot_threshold: '0.7',
    eager_eot_threshold: '0.5',
    eot_timeout_ms: '1000',
    numerals: 'true',
    mip_opt_out: 'true',
  });
  const host =
    process.env.DEEPGRAM_API_HOST === 'api.deepgram.com'
      ? 'api.deepgram.com'
      : 'api.eu.deepgram.com';
  return `wss://${host}/v2/listen?${params}`;
}

async function probe(audio: Buffer, leadMs: number, forceAtTail: boolean): Promise<ProbeEvent[]> {
  const ws = new WebSocket(fluxUrl(), {
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY ?? ''}` },
  });
  const events: ProbeEvent[] = [];
  let sent = 0;
  ws.on('message', (raw, binary) => {
    if (binary) return;
    const message = JSON.parse(raw.toString()) as Record<string, unknown>;
    const event = message.type === 'TurnInfo' ? String(message.event) : String(message.type);
    const transcript = typeof message.transcript === 'string' ? message.transcript.trim() : '';
    events.push({
      atAudioMs: Math.round(sent / BYTES_PER_MS),
      event,
      words: transcript ? transcript.split(/\s+/u).length : 0,
      ...(message.trigger !== undefined ? { trigger: message.trigger } : {}),
      ...(message.end_of_turn_confidence !== undefined
        ? { eotConfidence: message.end_of_turn_confidence }
        : {}),
    });
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  const lead = Buffer.alloc(leadMs * BYTES_PER_MS, ALAW_SILENCE);
  const tail = Buffer.alloc(4_000 * BYTES_PER_MS, ALAW_SILENCE);
  const payload = Buffer.concat([lead, audio, tail]);
  const step = CHUNK_MS * BYTES_PER_MS;
  const speechEnd = lead.length + audio.length;
  let forced = false;
  for (let offset = 0; offset < payload.length; offset += step) {
    ws.send(payload.subarray(offset, offset + step));
    sent += Math.min(step, payload.length - offset);
    if (forceAtTail && !forced && sent >= speechEnd + 1_500 * BYTES_PER_MS) {
      forced = true;
      ws.send(JSON.stringify({ type: 'ForceEndTurn' }));
      events.push({ atAudioMs: Math.round(sent / BYTES_PER_MS), event: '>ForceEndTurn', words: 0 });
    }
    await new Promise((resolve) => setTimeout(resolve, CHUNK_MS));
  }
  ws.send(JSON.stringify({ type: 'CloseStream' }));
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  ws.close();
  return events.map((event) => ({
    ...event,
    atAudioMs: event.atAudioMs - Math.round(speechEnd / BYTES_PER_MS),
  }));
}

async function main(): Promise<void> {
  const ids = process.argv.slice(2);
  for (const id of ids) {
    const index = NB_CORPUS.findIndex((clip) => clip.id === id);
    if (index < 0) throw new Error(`clip inconnu ${id}`);
    const native = await synthesize16k({
      text: NB_CORPUS[index].text,
      voice: String(index),
      provider: 'say',
      apiKey: '',
    });
    const audio = alawEncode(alawRoundTrip(downsampleBy2(telephoneBandpass(native, 16_000))));
    for (const leadMs of [0, 1_000]) {
      const events = await probe(audio, leadMs, true);
      // eslint-disable-next-line no-console -- sortie du banc
      console.log(
        JSON.stringify({ clip: id, speechMs: audio.length / BYTES_PER_MS, leadMs, events }),
      );
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

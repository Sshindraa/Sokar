/**
 * Énergie par trame des deux pistes de l'enregistrement : la vérité sur qui parle quand.
 *
 * Reprend `speech_segments` de scripts/ops/voice_call_audio.py (trames de 20 ms, seuil adaptatif au
 * bruit de fond, pauses de moins de 350 ms fondues dans la même prise de parole, plages de moins de
 * 150 ms ignorées) pour que le rapport automatique et le script local donnent les mêmes mesures.
 * Le MP3 est décodé en WASM (mpg123-decoder) : il n'y a pas de ffmpeg sur le VPS.
 */

export type Segment = [start: number, end: number];

export interface TrackEnergy {
  segments: Segment[];
  noiseFloorDbfs: number;
  speechLevelDbfs: number | null;
  clippedRatio: number;
}

const FRAME_MS = 20;
const MERGE_GAP_SEC = 0.35;
const MIN_SEGMENT_SEC = 0.15;

/** Comme numpy.percentile (interpolation linéaire). */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = ((sorted.length - 1) * p) / 100;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export function analyzeTrack(samples: Float32Array, sampleRate: number): TrackEnergy {
  const frame = Math.floor((sampleRate * FRAME_MS) / 1000);
  const count = Math.floor(samples.length / frame);
  const db = new Float64Array(count);
  for (let f = 0; f < count; f++) {
    let sum = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) sum += samples[i] * samples[i];
    db[f] = 20 * Math.log10(Math.sqrt(sum / frame) + 1e-9);
  }
  const floor = percentile(
    [...db].sort((a, b) => a - b),
    10,
  );
  const threshold = Math.max(floor + 10, -50);

  const raw: Array<[number, number]> = [];
  let start: number | null = null;
  for (let f = 0; f < count; f++) {
    const on = db[f] > threshold;
    if (on && start === null) start = f;
    else if (!on && start !== null) {
      raw.push([(start * FRAME_MS) / 1000, (f * FRAME_MS) / 1000]);
      start = null;
    }
  }
  if (start !== null) raw.push([(start * FRAME_MS) / 1000, (count * FRAME_MS) / 1000]);

  const merged: Array<[number, number]> = [];
  for (const segment of raw) {
    const last = merged[merged.length - 1];
    if (last && segment[0] - last[1] < MERGE_GAP_SEC) last[1] = segment[1];
    else merged.push([segment[0], segment[1]]);
  }
  const segments = merged
    .filter(([from, to]) => to - from >= MIN_SEGMENT_SEC)
    .map(([from, to]): Segment => [round(from, 2), round(to, 2)]);

  const speech = [...db].filter((value) => value > threshold).sort((a, b) => a - b);
  let clipped = 0;
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) >= 0.99) clipped++;
  return {
    segments,
    noiseFloorDbfs: round(floor, 1),
    speechLevelDbfs: speech.length ? round(percentile(speech, 50), 1) : null,
    clippedRatio: round(samples.length ? clipped / samples.length : 0, 5),
  };
}

export interface DecodedCall {
  sampleRate: number;
  /** Appelant à gauche, agent à droite (enregistrement Telnyx « dual »). */
  channels: [Float32Array, Float32Array];
}

export async function decodeStereoMp3(bytes: Uint8Array): Promise<DecodedCall> {
  // ESM seul : tsc (CommonJS) le compile en require, ce que Node >= 20.19 / 22.12 sait charger.
  const { MPEGDecoder } = await import('mpg123-decoder');
  const decoder = new MPEGDecoder();
  try {
    await decoder.ready;
    const decoded = decoder.decode(bytes);
    if (decoded.channelData.length < 2 || decoded.samplesDecoded === 0) {
      throw new Error('Recording is not a stereo MP3 (expected caller left, agent right)');
    }
    return {
      sampleRate: decoded.sampleRate,
      channels: [decoded.channelData[0], decoded.channelData[1]],
    };
  } finally {
    decoder.free();
  }
}

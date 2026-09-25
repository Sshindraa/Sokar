/**
 * Banc narrowband (phase 1) — chaîne de dégradation audio.
 *
 * Reproduit ce que subit la voix dans un appel Telnyx G.711 :
 *   16 kHz PCM16
 *   → filtre passe-bande téléphonique 300–3400 Hz (2 biquads en cascade)
 *   → downsample 8 kHz
 *   → encodage/décodage A-law (même algorithme que `toPcm16FromAlaw` en prod)
 *   → PCM16 8 kHz
 * puis, selon la condition, upsample 16 kHz. Le bruit de fond et les pertes de
 * paquets sont ajoutés à seeds fixes, comme dans `transcribe.cjs`.
 *
 * Aucune dépendance externe : tout est en JS pur pour que le banc tourne hors
 * ligne sur des clips dont seul le format change.
 */

/** Générateur reproductible (mulberry32), identique à celui du banc existant. */
export function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed stable dérivée d'une chaîne (mêmes clips = mêmes seeds). */
export function seedFromString(value: string, salt = 7): number {
  let hash = salt >>> 0;
  for (const char of value) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return hash >>> 0;
}

/** F is paired to B so both conditions use the exact same packet-loss mask. */
export function packetLossSeed(
  clipId: string,
  condition: string,
  variant: string,
  repeat: number,
): number {
  const pairedCondition = condition === 'F' ? 'B' : condition;
  return seedFromString(`${clipId}-${pairedCondition}-${variant}-${repeat}`);
}

export function noiseControlLossSeed(condition: string, repeat: number): number {
  const pairedCondition = condition === 'F' ? 'B' : condition;
  return seedFromString(`noise-only-${pairedCondition}-${repeat}`);
}

export function pcmToSamples(pcm: Buffer): Float64Array {
  const count = Math.floor(pcm.length / 2);
  const samples = new Float64Array(count);
  for (let index = 0; index < count; index++) samples[index] = pcm.readInt16LE(index * 2);
  return samples;
}

export function samplesToPcm(samples: ArrayLike<number>): Buffer {
  const buffer = Buffer.allocUnsafe(samples.length * 2);
  for (let index = 0; index < samples.length; index++) {
    const clamped = Math.max(-32768, Math.min(32767, Math.round(samples[index])));
    buffer.writeInt16LE(clamped, index * 2);
  }
  return buffer;
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** Coefficients RBJ pour un filtre du second ordre. */
function biquad(
  kind: 'lowpass' | 'highpass',
  frequency: number,
  sampleRate: number,
  q = Math.SQRT1_2,
): Biquad {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const alpha = Math.sin(omega) / (2 * q);
  const cos = Math.cos(omega);
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  const b0 = kind === 'lowpass' ? (1 - cos) / 2 : (1 + cos) / 2;
  const b1 = kind === 'lowpass' ? 1 - cos : -(1 + cos);
  const b2 = b0;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function applyBiquad(samples: Float64Array, filter: Biquad): Float64Array {
  const output = new Float64Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < samples.length; index++) {
    const x0 = samples[index];
    const y0 = filter.b0 * x0 + filter.b1 * x1 + filter.b2 * x2 - filter.a1 * y1 - filter.a2 * y2;
    output[index] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return output;
}

/**
 * Filtre passe-bande téléphonique. `passes` répète la cascade pour une pente
 * plus raide (le vrai canal G.711 coupe encore plus net que 2 biquads).
 */
export function telephoneBandpass(
  pcm: Buffer,
  sampleRate: number,
  options: { lowHz?: number; highHz?: number; passes?: number } = {},
): Buffer {
  const lowHz = options.lowHz ?? 300;
  const highHz = options.highHz ?? 3400;
  const passes = options.passes ?? 2;
  let samples = pcmToSamples(pcm);
  for (let pass = 0; pass < passes; pass++)
    samples = applyBiquad(samples, biquad('highpass', lowHz, sampleRate));
  for (let pass = 0; pass < passes; pass++)
    samples = applyBiquad(samples, biquad('lowpass', highHz, sampleRate));
  return samplesToPcm(samples);
}

/** Décimation par 2 avec antialiasing (moyenne de paires). */
export function downsampleBy2(pcm: Buffer): Buffer {
  const samples = pcmToSamples(pcm);
  const output = new Float64Array(Math.floor(samples.length / 2));
  for (let index = 0; index < output.length; index++) {
    output[index] = (samples[index * 2] + samples[index * 2 + 1]) / 2;
  }
  return samplesToPcm(output);
}

/** Sur-échantillonnage par 2 (interpolation linéaire). */
export function upsampleBy2(pcm: Buffer): Buffer {
  const samples = pcmToSamples(pcm);
  const output = new Float64Array(samples.length * 2);
  for (let index = 0; index < samples.length; index++) {
    const current = samples[index];
    const next = samples[index + 1] ?? current;
    output[index * 2] = current;
    output[index * 2 + 1] = (current + next) / 2;
  }
  return samplesToPcm(output);
}

/**
 * Encodage A-law. Volontairement identique à `linearToAlaw` de
 * `transcribe.cjs`, qui est lui-même apparié au décodeur `toPcm16FromAlaw`
 * utilisé en production : on mesure l'aller-retour réel de la prod, pas une
 * variante normalisée.
 */
export function alawEncode(pcm: Buffer): Buffer {
  const samples = pcmToSamples(pcm);
  const output = Buffer.allocUnsafe(samples.length);
  for (let index = 0; index < samples.length; index++) {
    let sample = Math.max(-32768, Math.min(32767, Math.round(samples[index])));
    const sign = (sample >> 8) & 0x80;
    if (sign) sample = -sample;
    if (sample > 32635) sample = 32635;
    let exponent = 7;
    for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1);
    const mantissa = (sample >> (exponent === 0 ? 4 : exponent + 3)) & 0x0f;
    output[index] = ((sign ? 0 : 0x80) | (exponent << 4) | mantissa) ^ 0x55;
  }
  return output;
}

/** Décodage A-law vers PCM16, identique à `toPcm16FromAlaw` en production. */
export function alawDecode(input: Buffer): Buffer {
  const output = Buffer.allocUnsafe(input.length * 2);
  for (let index = 0; index < input.length; index++) {
    const alaw = input[index] ^ 0x55;
    let sample = (alaw & 0x0f) << 4;
    const segment = (alaw & 0x70) >> 4;
    if (segment === 0) sample += 8;
    else if (segment === 1) sample += 0x108;
    else sample = (sample + 0x108) << (segment - 1);
    output.writeInt16LE(alaw & 0x80 ? sample : -sample, index * 2);
  }
  return output;
}

/** Aller-retour A-law complet (ce que fait le réseau sur chaque échantillon). */
export function alawRoundTrip(pcm: Buffer): Buffer {
  return alawDecode(alawEncode(pcm));
}

function rms(samples: Float64Array): number {
  if (samples.length === 0) return 0;
  let power = 0;
  for (const sample of samples) power += sample * sample;
  return Math.sqrt(power / samples.length);
}

/**
 * Ajoute un fond sonore reproductible : souffle blanc au SNR demandé, ronflement
 * basse fréquence et bouffées de conversation. Approxime un restaurant ou une
 * rue ; ce n'est pas un enregistrement réel.
 */
export function addBackgroundNoise(
  pcm: Buffer,
  sampleRate: number,
  options: { snrDb: number; seed: number },
): Buffer {
  const samples = pcmToSamples(pcm);
  const random = mulberry32(options.seed);
  const signalRms = Math.max(1, rms(samples));
  const noiseRms = signalRms / 10 ** (options.snrDb / 20);
  const humFrequency = 50 + random() * 30;
  const output = new Float64Array(samples.length);
  let burstRemaining = 0;
  let burstAmplitude = 0;
  let burstPhase = 0;
  let burstFrequency = 300;
  for (let index = 0; index < samples.length; index++) {
    const gaussian = Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());
    const hum = 0.35 * noiseRms * Math.sin((2 * Math.PI * humFrequency * index) / sampleRate);
    if (burstRemaining <= 0 && random() < 1 / (sampleRate * 0.4)) {
      burstRemaining = Math.round(sampleRate * (0.15 + random() * 0.35));
      burstAmplitude = noiseRms * (0.8 + random());
      burstFrequency = 200 + random() * 900;
    }
    let chatter = 0;
    if (burstRemaining > 0) {
      burstRemaining--;
      burstPhase += (2 * Math.PI * burstFrequency) / sampleRate;
      chatter = burstAmplitude * Math.sin(burstPhase) * (0.6 + 0.4 * Math.sin(burstPhase / 7));
    }
    output[index] = samples[index] + gaussian * noiseRms + hum + chatter;
  }
  return samplesToPcm(output);
}

/** Same seeded restaurant/rue noise profile without a speech source. */
export function backgroundNoiseOnly(
  sampleRate: number,
  durationMs: number,
  options: { rms: number; seed: number },
): Buffer {
  const random = mulberry32(options.seed);
  const humFrequency = 50 + random() * 30;
  const output = new Float64Array(Math.round((sampleRate * durationMs) / 1000));
  let burstRemaining = 0;
  let burstAmplitude = 0;
  let burstPhase = 0;
  let burstFrequency = 300;
  for (let index = 0; index < output.length; index++) {
    const gaussian = Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());
    const hum = 0.35 * options.rms * Math.sin((2 * Math.PI * humFrequency * index) / sampleRate);
    if (burstRemaining <= 0 && random() < 1 / (sampleRate * 0.4)) {
      burstRemaining = Math.round(sampleRate * (0.15 + random() * 0.35));
      burstAmplitude = options.rms * (0.8 + random());
      burstFrequency = 200 + random() * 900;
    }
    let chatter = 0;
    if (burstRemaining > 0) {
      burstRemaining--;
      burstPhase += (2 * Math.PI * burstFrequency) / sampleRate;
      chatter = burstAmplitude * Math.sin(burstPhase) * (0.6 + 0.4 * Math.sin(burstPhase / 7));
    }
    output[index] = gaussian * options.rms + hum + chatter;
  }
  return samplesToPcm(output);
}

/** Perte de paquets aléatoire (frames de `frameMs` ms mises à zéro). */
export function applyPacketLoss(
  pcm: Buffer,
  sampleRate: number,
  options: { lossRate: number; frameMs?: number; seed: number },
): Buffer {
  if (options.lossRate <= 0) return pcm;
  const frameMs = options.frameMs ?? 20;
  const frameSamples = Math.round((sampleRate * frameMs) / 1000);
  const samples = pcmToSamples(pcm);
  const random = mulberry32(options.seed ^ 0x9e3779b9);
  for (let start = 0; start < samples.length; start += frameSamples) {
    if (random() < options.lossRate) {
      samples.fill(0, start, Math.min(samples.length, start + frameSamples));
    }
  }
  return samplesToPcm(samples);
}

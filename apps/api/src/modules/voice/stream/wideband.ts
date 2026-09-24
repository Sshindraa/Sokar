/**
 * Détection « wideband » : quelle part de l'énergie dépasse 4 kHz sur les
 * premières secondes de parole ?
 *
 * C'est la mesure qui dira si l'activation de L16 apporte réellement quelque
 * chose sur les appels réels : un appel dont le contenu est déjà limité à
 * 300–3400 Hz (téléphone classique, transit G.711 sur un tronçon) ne gagne rien
 * à passer en 16 kHz, même si le codec le permet.
 *
 * Méthode : filtre passe-haut 4 kHz (2 biquads en cascade) puis rapport des
 * énergies RMS « au-dessus de 4 kHz » / « total ». Aucune FFT, coût constant.
 * Le seuil est volontairement bas : on cherche la présence de contenu haute
 * fréquence, pas une qualité.
 */

export const WIDEBAND_CUTOFF_HZ = 4000;
export const WIDEBAND_RATIO_THRESHOLD = 0.0025;
/** Durée de parole analysée avant décision. */
export const WIDEBAND_WINDOW_MS = 3000;

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function highpass(frequency: number, sampleRate: number, q = Math.SQRT1_2): Biquad {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const alpha = Math.sin(omega) / (2 * q);
  const cos = Math.cos(omega);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
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

function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let power = 0;
  for (let index = 0; index < samples.length; index++) power += samples[index] * samples[index];
  return Math.sqrt(power / samples.length);
}

/**
 * Rapport d'énergie au-dessus de 4 kHz. 0 = aucun contenu haute fréquence
 * (bande téléphonique classique), proche de 1 = bruit large bande / sifflantes.
 */
export function highFrequencyEnergyRatio(pcm16: Buffer, sampleRate: number): number {
  const count = Math.floor(pcm16.length / 2);
  if (count === 0) return 0;
  const samples = new Float64Array(count);
  for (let index = 0; index < count; index++) samples[index] = pcm16.readInt16LE(index * 2);
  const total = rms(samples);
  if (total === 0) return 0;
  let filtered = applyBiquad(samples, highpass(WIDEBAND_CUTOFF_HZ, sampleRate));
  filtered = applyBiquad(filtered, highpass(WIDEBAND_CUTOFF_HZ, sampleRate));
  const amplitudeRatio = rms(filtered) / total;
  return amplitudeRatio * amplitudeRatio;
}

/**
 * Accumule les premières millisecondes d'audio d'un appel puis rend un verdict
 * unique, sans conserver l'audio (aucune PII, aucun buffer long).
 */
export class WidebandProbe {
  private readonly chunks: Buffer[] = [];
  private samples = 0;
  private decided = false;

  constructor(
    private readonly sampleRate: number,
    private readonly windowMs: number = WIDEBAND_WINDOW_MS,
  ) {}

  /** Ajoute du PCM16 little-endian ; rend `true`/`false` une seule fois. */
  add(pcm16: Buffer): boolean | null {
    if (this.decided || pcm16.length < 2) return null;
    // Un début d'appel silencieux ne doit pas consommer la fenêtre de parole.
    let power = 0;
    for (let i = 0; i + 1 < pcm16.length; i += 2) {
      const sample = pcm16.readInt16LE(i);
      power += sample * sample;
    }
    if (Math.sqrt(power / Math.floor(pcm16.length / 2)) < 300) return null;
    this.chunks.push(pcm16);
    this.samples += Math.floor(pcm16.length / 2);
    if (this.samples < (this.sampleRate * this.windowMs) / 1000) return null;
    this.decided = true;
    const ratio = highFrequencyEnergyRatio(Buffer.concat(this.chunks), this.sampleRate);
    this.chunks.length = 0;
    return ratio >= WIDEBAND_RATIO_THRESHOLD;
  }

  finish(): boolean {
    if (this.decided) return false;
    this.decided = true;
    const ratio = highFrequencyEnergyRatio(Buffer.concat(this.chunks), this.sampleRate);
    this.chunks.length = 0;
    return ratio >= WIDEBAND_RATIO_THRESHOLD;
  }

  reset(): void {
    this.chunks.length = 0;
    this.samples = 0;
    this.decided = false;
  }
}

/** Compare les deux lectures d'un payload L16 sans conserver d'audio après 500 ms. */
export class L16EndianProbe {
  private readonly chunks: Buffer[] = [];
  private samples = 0;
  private done = false;

  add(networkAudio: Buffer): { bigEndianRms: number; littleEndianRms: number } | null {
    if (this.done || networkAudio.length < 2) return null;
    const evenLength = networkAudio.length - (networkAudio.length % 2);
    const count = evenLength / 2;
    let bePower = 0;
    for (let i = 0; i < evenLength; i += 2) {
      const sample = networkAudio.readInt16BE(i);
      bePower += sample * sample;
    }
    // Ignore le silence initial ; la décision de parole utilise le décodage RTP attendu.
    if (Math.sqrt(bePower / count) < 300) return null;
    const remainingBytes = Math.max(0, (8000 - this.samples) * 2);
    const accepted = networkAudio.subarray(0, Math.min(evenLength, remainingBytes));
    this.chunks.push(accepted);
    this.samples += accepted.length / 2;
    return this.samples >= 8000 ? this.finish() : null;
  }

  finish(): { bigEndianRms: number; littleEndianRms: number } {
    this.done = true;
    const audio = Buffer.concat(this.chunks);
    let bePower = 0;
    let lePower = 0;
    for (let i = 0; i + 1 < audio.length; i += 2) {
      const be = audio.readInt16BE(i);
      const le = audio.readInt16LE(i);
      bePower += be * be;
      lePower += le * le;
    }
    const count = audio.length / 2;
    this.chunks.length = 0;
    return {
      bigEndianRms: count ? Math.round(Math.sqrt(bePower / count)) : 0,
      littleEndianRms: count ? Math.round(Math.sqrt(lePower / count)) : 0,
    };
  }
}

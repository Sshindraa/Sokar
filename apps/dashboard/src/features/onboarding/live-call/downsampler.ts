/**
 * Rééchantillonneur en flux continu par moyenne pondérée (filtre boîte), du taux du micro
 * (typiquement 48 kHz ou 44,1 kHz) vers 8 kHz. Garde l'état entre deux blocs : aucun
 * échantillon n'est perdu ni dupliqué à la frontière.
 */
export class Downsampler {
  private readonly ratio: number;
  private accumulator = 0;
  private filled = 0;

  constructor(inputRate: number, outputRate = 8000) {
    if (inputRate < outputRate) throw new Error('Downsampler: taux d’entrée trop bas');
    this.ratio = inputRate / outputRate;
  }

  process(input: Float32Array): Float32Array {
    const out: number[] = [];
    for (let i = 0; i < input.length; i++) {
      const sample = input[i];
      if (this.filled + 1 < this.ratio) {
        this.accumulator += sample;
        this.filled += 1;
      } else {
        const used = this.ratio - this.filled;
        this.accumulator += sample * used;
        out.push(this.accumulator / this.ratio);
        this.accumulator = sample * (1 - used);
        this.filled = 1 - used;
      }
    }
    return Float32Array.from(out);
  }
}

/** Découpe un flux de longueur variable en trames de taille fixe. */
export class FrameAssembler {
  private buffer = new Float32Array(0);

  constructor(private readonly frameSize: number) {}

  push(samples: Float32Array): Float32Array[] {
    const merged = new Float32Array(this.buffer.length + samples.length);
    merged.set(this.buffer);
    merged.set(samples, this.buffer.length);

    const frames: Float32Array[] = [];
    let offset = 0;
    while (merged.length - offset >= this.frameSize) {
      frames.push(merged.slice(offset, offset + this.frameSize));
      offset += this.frameSize;
    }
    this.buffer = merged.slice(offset);
    return frames;
  }
}

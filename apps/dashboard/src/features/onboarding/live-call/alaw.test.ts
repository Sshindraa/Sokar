import { describe, expect, it } from 'vitest';
import { ALAW_SILENCE, decodeAlaw, decodeAlawSample, encodeAlaw, encodeAlawSample } from './alaw';
import { Downsampler, FrameAssembler } from './downsampler';

describe('A-law G.711', () => {
  it('encode les valeurs de référence de la norme', () => {
    expect(encodeAlawSample(0)).toBe(ALAW_SILENCE);
    expect(encodeAlawSample(32767)).toBe(0xaa);
    expect(encodeAlawSample(-32768)).toBe(0x2a);
    expect(encodeAlawSample(-1)).toBe(0x55);
  });

  it('décode l’octet de silence en valeur quasi nulle', () => {
    expect(decodeAlawSample(ALAW_SILENCE)).toBe(8);
  });

  it('aller-retour : erreur de quantification bornée à ~3 % (plus 1 pas de silence)', () => {
    for (let pcm = -32768; pcm <= 32767; pcm += 7) {
      const back = decodeAlawSample(encodeAlawSample(pcm));
      expect(Math.abs(back - pcm)).toBeLessThanOrEqual(Math.max(16, Math.abs(pcm) * 0.04));
    }
  });

  it('préserve le signe', () => {
    expect(decodeAlawSample(encodeAlawSample(1000))).toBeGreaterThan(0);
    expect(decodeAlawSample(encodeAlawSample(-1000))).toBeLessThan(0);
  });

  it('encodeAlaw écrête les valeurs hors plage et décodeAlaw reste dans [-1, 1]', () => {
    const bytes = encodeAlaw(Float32Array.from([2, -2, 0]));
    expect(Array.from(bytes)).toEqual([0xaa, 0x2a, ALAW_SILENCE]);
    for (const value of decodeAlaw(bytes)) expect(Math.abs(value)).toBeLessThanOrEqual(1);
  });
});

describe('Downsampler', () => {
  it('divise par 6 le nombre d’échantillons (48 kHz → 8 kHz)', () => {
    const out = new Downsampler(48000).process(new Float32Array(4800).fill(0.5));
    expect(out).toHaveLength(800);
    for (const value of out) expect(value).toBeCloseTo(0.5, 5);
  });

  it('est continu entre deux blocs : mêmes sorties qu’un traitement en un bloc', () => {
    const signal = Float32Array.from({ length: 4410 }, (_, i) => Math.sin(i / 7));
    const whole = new Downsampler(44100).process(signal);

    const split = new Downsampler(44100);
    const parts = [split.process(signal.slice(0, 1000)), split.process(signal.slice(1000))];
    const joined = Float32Array.from(parts.flatMap((part) => Array.from(part)));

    expect(joined).toHaveLength(whole.length);
    joined.forEach((value, i) => expect(value).toBeCloseTo(whole[i], 6));
  });

  it('garde le rapport 44,1 kHz → 8 kHz sur la durée', () => {
    const out = new Downsampler(44100).process(new Float32Array(44100));
    expect(Math.abs(out.length - 8000)).toBeLessThanOrEqual(1);
  });

  it('refuse un taux d’entrée inférieur à 8 kHz', () => {
    expect(() => new Downsampler(4000)).toThrow();
  });
});

describe('FrameAssembler', () => {
  it('produit des trames fixes et conserve le reste', () => {
    const assembler = new FrameAssembler(160);
    expect(assembler.push(new Float32Array(100))).toHaveLength(0);
    expect(assembler.push(new Float32Array(300))).toHaveLength(2);
    expect(assembler.push(new Float32Array(80))).toHaveLength(1);
  });
});

import { describe, it, expect } from 'vitest';
import { analyzeTrack, decodeStereoMp3 } from '../call-report/energy';
import { encodeWavMono } from '../call-report/wav';
import { stereoMp3 } from './fixtures/call-report-stereo';

const RATE = 8000;

/** Signal de test : du bruit très faible partout, et un son franc sur les plages données (en secondes). */
function signal(durationSec: number, bursts: Array<[number, number]>): Float32Array {
  const samples = new Float32Array(Math.round(durationSec * RATE));
  for (let i = 0; i < samples.length; i++) samples[i] = 0.0005 * Math.sin(i * 0.37);
  for (const [from, to] of bursts) {
    for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i++) {
      samples[i] += 0.3 * Math.sin((2 * Math.PI * 440 * i) / RATE);
    }
  }
  return samples;
}

describe('analyzeTrack', () => {
  it('trouve les plages de parole', () => {
    const { segments } = analyzeTrack(
      signal(6, [
        [1, 2],
        [4, 5],
      ]),
      RATE,
    );
    expect(segments).toHaveLength(2);
    expect(segments[0][0]).toBeCloseTo(1, 1);
    expect(segments[0][1]).toBeCloseTo(2, 1);
    expect(segments[1][0]).toBeCloseTo(4, 1);
  });

  it('garde dans la même prise de parole une pause de moins de 350 ms', () => {
    const { segments } = analyzeTrack(
      signal(4, [
        [1, 1.5],
        [1.7, 2.2],
      ]),
      RATE,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0][1]).toBeCloseTo(2.2, 1);
  });

  it('sépare deux prises de parole éloignées de plus de 350 ms', () => {
    const { segments } = analyzeTrack(
      signal(4, [
        [1, 1.5],
        [2, 2.5],
      ]),
      RATE,
    );
    expect(segments).toHaveLength(2);
  });

  it('ignore un bruit de moins de 150 ms', () => {
    const { segments } = analyzeTrack(signal(4, [[1, 1.1]]), RATE);
    expect(segments).toEqual([]);
  });

  it('mesure le bruit de fond et le niveau de parole', () => {
    const track = analyzeTrack(signal(6, [[1, 3]]), RATE);
    expect(track.noiseFloorDbfs).toBeLessThan(-55);
    expect(track.speechLevelDbfs).toBeGreaterThan(-20);
    expect(track.clippedRatio).toBe(0);
  });

  it('renvoie un résultat vide pour une piste muette', () => {
    const track = analyzeTrack(new Float32Array(RATE * 2), RATE);
    expect(track.segments).toEqual([]);
    expect(track.speechLevelDbfs).toBeNull();
  });
});

describe('decodeStereoMp3', () => {
  it('sépare les deux pistes (appelant à gauche, agent à droite)', async () => {
    const { sampleRate, channels } = await decodeStereoMp3(stereoMp3());
    expect(sampleRate).toBe(RATE);
    expect(channels[0].length).toBeGreaterThan(RATE * 2.8);
    const left = analyzeTrack(channels[0], sampleRate).segments;
    const right = analyzeTrack(channels[1], sampleRate).segments;
    expect(left[0][0]).toBeCloseTo(0.5, 0);
    expect(left[0][1]).toBeCloseTo(1.5, 0);
    expect(right[0][0]).toBeCloseTo(2, 0);
    expect(right[0][1]).toBeCloseTo(2.8, 0);
  });

  it('refuse un enregistrement mono', async () => {
    await expect(decodeStereoMp3(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });
});

describe('encodeWavMono', () => {
  it('produit un WAV PCM 16 bits lisible', () => {
    const wav = encodeWavMono(new Float32Array([0, 0.5, -0.5]), 8000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE');
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(46, true)).toBe(16384);
    expect(view.getInt16(48, true)).toBe(-16384);
  });
});

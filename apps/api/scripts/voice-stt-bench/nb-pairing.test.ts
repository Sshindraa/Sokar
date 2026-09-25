import { describe, expect, it } from 'vitest';
import { noiseControlLossSeed, packetLossSeed } from './nb-dsp';

describe('paire de bruit F/B du banc', () => {
  it('réutilise exactement le masque de perte de paquets de B pour F', () => {
    expect(packetLossSeed('c01', 'F', 'noisy', 2)).toBe(packetLossSeed('c01', 'B', 'noisy', 2));
    expect(noiseControlLossSeed('F', 2)).toBe(noiseControlLossSeed('B', 2));
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildCartesiaCacheVariant,
  clampCartesiaSpeed,
  getCartesiaGenerationConfig,
} from '../stream/cartesia-config';

describe('Cartesia generation configuration', () => {
  it('clamps speed to the Sonic 3.6 supported range and omits the default', () => {
    expect(clampCartesiaSpeed(0.1)).toBe(0.6);
    expect(clampCartesiaSpeed(1)).toBeUndefined();
    expect(clampCartesiaSpeed(1.8)).toBe(1.5);
  });

  it('builds a generation config from restaurant personality controls', () => {
    expect(
      getCartesiaGenerationConfig({
        personality: {
          fillerStyle: 'WARM',
          speakingRate: 1.15,
          volume: 1.2,
          emotion: 'positivity',
        },
      }),
    ).toEqual({ speed: 1.15, volume: 1.2, emotion: 'positivity' });
  });

  it('changes the cache variant when locale or generation changes', () => {
    const base = buildCartesiaCacheVariant({
      voiceId: 'voice-a',
      locale: 'fr-FR',
      codec: 'alaw8k',
      generationConfig: { speed: 1.1 },
    });
    expect(
      buildCartesiaCacheVariant({
        voiceId: 'voice-a',
        locale: 'en-US',
        codec: 'alaw8k',
        generationConfig: { speed: 1.1 },
      }),
    ).not.toBe(base);
  });
});

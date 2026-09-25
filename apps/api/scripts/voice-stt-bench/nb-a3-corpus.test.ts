import { describe, expect, it } from 'vitest';
import {
  NB_A3_CALIBRATION_IDS,
  NB_A3_CORPUS,
  NB_A3_RESTAURANT_CLIPS,
  NB_CORPUS,
} from './nb-corpus';
import { containsNormalizedPhrase } from './nb-normalize';

describe('corpus business A3', () => {
  it('ajoute 10 clips calibration et 10 validation sans modifier le corpus historique', () => {
    expect(NB_CORPUS).toHaveLength(31);
    expect(NB_A3_RESTAURANT_CLIPS).toHaveLength(20);
    expect(NB_A3_CORPUS).toHaveLength(51);
    expect(
      NB_A3_RESTAURANT_CLIPS.filter((clip) => NB_A3_CALIBRATION_IDS.has(clip.id)),
    ).toHaveLength(10);
    expect(
      NB_A3_RESTAURANT_CLIPS.filter((clip) => !NB_A3_CALIBRATION_IDS.has(clip.id)),
    ).toHaveLength(10);
  });

  it('inclut chaque terme business critique comme expression normalisée dans son clip', () => {
    for (const clip of NB_A3_RESTAURANT_CLIPS) {
      const businessTerms = clip.critical.filter(
        (critical) => critical.label === 'terme restaurant',
      );
      expect(businessTerms.length).toBeGreaterThan(0);
      for (const critical of businessTerms) {
        expect(containsNormalizedPhrase(clip.text, critical.value)).toBe(true);
      }
    }
  });
});

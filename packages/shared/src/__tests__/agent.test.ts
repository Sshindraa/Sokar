import { describe, it, expect } from 'vitest';
import { PROFILE_TYPE_VALUES, PROFILE_TYPE_LABELS, FILLER_STYLE_VALUES, FILLER_STYLE_LABELS } from '../agent';

describe('agent', () => {
  it('every ProfileType has a French label', () => {
    for (const p of PROFILE_TYPE_VALUES) {
      expect(PROFILE_TYPE_LABELS[p], `label for ${p}`).toBeTypeOf('string');
      expect(PROFILE_TYPE_LABELS[p].length).toBeGreaterThan(0);
    }
  });

  it('every FillerStyle has a French label', () => {
    for (const f of FILLER_STYLE_VALUES) {
      expect(FILLER_STYLE_LABELS[f], `label for ${f}`).toBeTypeOf('string');
      expect(FILLER_STYLE_LABELS[f].length).toBeGreaterThan(0);
    }
  });
});

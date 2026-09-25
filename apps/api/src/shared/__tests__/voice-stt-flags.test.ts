import { describe, expect, it } from 'vitest';
import { voiceSttBooleanFlagSchema } from '../../env';

describe('flags expérimentaux Scribe', () => {
  it('reste coupé par défaut et n’accepte que true/false', () => {
    expect(voiceSttBooleanFlagSchema.parse(undefined)).toBe('false');
    expect(voiceSttBooleanFlagSchema.parse('true')).toBe('true');
    expect(voiceSttBooleanFlagSchema.parse('false')).toBe('false');
    expect(voiceSttBooleanFlagSchema.safeParse('enabled').success).toBe(false);
  });
});

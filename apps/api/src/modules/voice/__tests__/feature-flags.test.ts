import { describe, expect, it } from 'vitest';
import { parseRestaurantIdList, resolveVoiceFeatureSnapshot } from '../stream/feature-flags';
import type { CallSession } from '../stream/types';

describe('parseRestaurantIdList', () => {
  it('trims, drops empty entries and tolerates an absent value', () => {
    expect(parseRestaurantIdList(undefined)).toEqual([]);
    expect(parseRestaurantIdList(' rest-a , ,rest-b,')).toEqual(['rest-a', 'rest-b']);
  });
});

describe('resolveVoiceFeatureSnapshot', () => {
  it('uses the same Deepgram settings for every call', () => {
    const session = {} as Pick<CallSession, 'voiceFeatureSnapshot'>;
    expect(resolveVoiceFeatureSnapshot(session)).toEqual({
      deepgramModel: 'nova-3',
      deepgramNumeralsEnabled: true,
      deepgramPunctuateEnabled: false,
    });
  });

  it('freezes the snapshot on the session for the rest of the call', () => {
    const session = {} as Pick<CallSession, 'voiceFeatureSnapshot'>;
    const first = resolveVoiceFeatureSnapshot(session);
    expect(session.voiceFeatureSnapshot).toBe(first);
    expect(resolveVoiceFeatureSnapshot(session)).toBe(first);
  });
});

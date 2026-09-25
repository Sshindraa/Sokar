import { afterEach, describe, expect, it } from 'vitest';
import {
  isVoiceFeatureEnabledForRestaurant,
  resolveVoiceFeatureSnapshot,
} from '../stream/feature-flags';
import type { CallSession } from '../stream/types';

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

describe('voice feature flags', () => {
  it('keeps dialogue V2 disabled for an empty or non-matching restaurant list', () => {
    expect(
      isVoiceFeatureEnabledForRestaurant('dialogueListeningV2', 'rest-a', {
        VOICE_DIALOGUE_LISTENING_V2_RESTAURANT_IDS: '',
      }),
    ).toBe(false);
    expect(
      isVoiceFeatureEnabledForRestaurant('dialogueListeningV2', 'rest-a', {
        VOICE_DIALOGUE_LISTENING_V2_RESTAURANT_IDS: ' rest-b , rest-c ',
      }),
    ).toBe(false);
  });

  it('enables dialogue V2 globally or for a listed restaurant', () => {
    expect(
      isVoiceFeatureEnabledForRestaurant('dialogueListeningV2', 'rest-a', {
        VOICE_DIALOGUE_LISTENING_V2: 'true',
      }),
    ).toBe(true);
    expect(
      isVoiceFeatureEnabledForRestaurant('dialogueListeningV2', 'rest-a', {
        VOICE_DIALOGUE_LISTENING_V2_RESTAURANT_IDS: ' rest-a,rest-b ',
      }),
    ).toBe(true);
  });

  it('requires both the provider selection and allowlist for Deepgram', () => {
    expect(
      isVoiceFeatureEnabledForRestaurant('deepgramStt', 'rest-a', {
        VOICE_STT_PROVIDER: 'deepgram',
      }),
    ).toBe(false);
    expect(
      isVoiceFeatureEnabledForRestaurant('deepgramStt', 'rest-a', {
        VOICE_STT_PROVIDER: 'deepgram',
        VOICE_STT_PROVIDER_RESTAURANT_IDS: 'rest-b',
      }),
    ).toBe(false);
    expect(
      isVoiceFeatureEnabledForRestaurant('deepgramStt', 'rest-a', {
        VOICE_STT_PROVIDER: 'deepgram',
        VOICE_STT_PROVIDER_RESTAURANT_IDS: ' rest-a, rest-b ',
      }),
    ).toBe(true);
  });

  it('snapshots provider and dialogue flags once per call', () => {
    const session = {
      restaurantId: 'rest-a',
      voiceFeatureSnapshot: undefined,
    } as unknown as CallSession;
    const first = resolveVoiceFeatureSnapshot(session, {
      VOICE_STT_PROVIDER: 'deepgram',
      VOICE_STT_PROVIDER_RESTAURANT_IDS: 'rest-a',
    });
    const later = resolveVoiceFeatureSnapshot(session, {
      VOICE_STT_PROVIDER: 'scribe',
    });
    expect(later).toBe(first);
    expect(later.sttProvider).toBe('deepgram');
  });
});

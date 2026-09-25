import { afterEach, describe, expect, it } from 'vitest';
import {
  isVoiceDeepgramDialoguePilot,
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

  it('keeps Nova by default and gates Flux behind its own restaurant allowlist', () => {
    const pilot = { restaurantId: 'rest-a' } as CallSession;
    const other = { restaurantId: 'rest-b' } as CallSession;
    const env = {
      VOICE_DEEPGRAM_MODEL: 'flux-general-multi',
      VOICE_DEEPGRAM_MODEL_RESTAURANT_IDS: ' rest-a ',
    };

    expect(resolveVoiceFeatureSnapshot(pilot, env).deepgramModel).toBe('flux-general-multi');
    expect(resolveVoiceFeatureSnapshot(other, env).deepgramModel).toBe('nova-3');
    expect(
      resolveVoiceFeatureSnapshot({ restaurantId: 'rest-c' } as CallSession, {}).deepgramModel,
    ).toBe('nova-3');
  });

  it('keeps Deepgram formatting defaults and gates overrides per restaurant', () => {
    const pilot = { restaurantId: 'rest-a' } as CallSession;
    const other = { restaurantId: 'rest-b' } as CallSession;
    const env = {
      VOICE_DEEPGRAM_NUMERALS: 'false',
      VOICE_DEEPGRAM_NUMERALS_RESTAURANT_IDS: 'rest-a',
      VOICE_DEEPGRAM_PUNCTUATE: 'true',
      VOICE_DEEPGRAM_PUNCTUATE_RESTAURANT_IDS: 'rest-a',
      VOICE_DEEPGRAM_KEYTERMS_RESTAURANT_IDS: 'rest-a',
    };

    expect(resolveVoiceFeatureSnapshot(pilot, env)).toMatchObject({
      deepgramNumeralsEnabled: false,
      deepgramPunctuateEnabled: true,
      deepgramKeytermsEnabled: true,
    });
    expect(resolveVoiceFeatureSnapshot(other, env)).toMatchObject({
      deepgramNumeralsEnabled: true,
      deepgramPunctuateEnabled: false,
      deepgramKeytermsEnabled: false,
    });
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
    expect(later.deepgramModel).toBe('nova-3');
  });

  it('scopes the latency pilot to Deepgram plus Dialogue V2 allowlists', () => {
    const env = {
      VOICE_STT_PROVIDER: 'deepgram',
      VOICE_STT_PROVIDER_RESTAURANT_IDS: 'rest-a',
      VOICE_DIALOGUE_LISTENING_V2_RESTAURANT_IDS: 'rest-a',
    };
    const pilot = { restaurantId: 'rest-a' } as CallSession;
    const other = { restaurantId: 'rest-b' } as CallSession;
    resolveVoiceFeatureSnapshot(pilot, env);
    resolveVoiceFeatureSnapshot(other, env);

    expect(isVoiceDeepgramDialoguePilot(pilot)).toBe(true);
    expect(isVoiceDeepgramDialoguePilot(other)).toBe(false);
    expect(other.voiceFeatureSnapshot).toMatchObject({
      sttProvider: 'scribe',
      dialogueListeningV2Enabled: false,
    });
  });
});

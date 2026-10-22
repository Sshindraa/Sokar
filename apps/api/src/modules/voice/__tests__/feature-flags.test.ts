import { afterEach, describe, expect, it } from 'vitest';
import {
  isVoiceDeepgramKeytermsEnabled,
  isVoiceFeatureEnabledForRestaurant,
  isVoiceV2Default,
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

  it('fixe nova-3, les chiffres en nombres et pas de ponctuation pour tous les restaurants', () => {
    const snapshot = resolveVoiceFeatureSnapshot({ restaurantId: 'rest-a' } as CallSession, {});
    expect(snapshot).toMatchObject({
      deepgramModel: 'nova-3',
      deepgramNumeralsEnabled: true,
      deepgramPunctuateEnabled: false,
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

  it('scopes Deepgram and Dialogue V2 to their allowlists', () => {
    const env = {
      VOICE_STT_PROVIDER: 'deepgram',
      VOICE_STT_PROVIDER_RESTAURANT_IDS: 'rest-a',
      VOICE_DIALOGUE_LISTENING_V2_RESTAURANT_IDS: 'rest-a',
    };
    const pilot = { restaurantId: 'rest-a' } as CallSession;
    const other = { restaurantId: 'rest-b' } as CallSession;
    resolveVoiceFeatureSnapshot(pilot, env);
    resolveVoiceFeatureSnapshot(other, env);

    expect(pilot.voiceFeatureSnapshot).toMatchObject({
      sttProvider: 'deepgram',
      dialogueListeningV2Enabled: true,
    });
    expect(other.voiceFeatureSnapshot).toMatchObject({
      sttProvider: 'scribe',
      dialogueListeningV2Enabled: false,
    });
  });
});

describe('parcours vocal moderne par défaut (VOICE_V2_DEFAULT)', () => {
  const on = { VOICE_V2_DEFAULT: 'true', VOICE_STT_PROVIDER: 'deepgram' } as NodeJS.ProcessEnv;

  it('ne change rien tant que VOICE_V2_DEFAULT n’est pas true', () => {
    const off = { VOICE_STT_PROVIDER: 'deepgram' } as NodeJS.ProcessEnv;
    expect(isVoiceV2Default('rest-a', off)).toBe(false);
    expect(isVoiceV2Default('rest-a', { ...off, VOICE_V2_DEFAULT: 'false' })).toBe(false);
    expect(isVoiceFeatureEnabledForRestaurant('deepgramStt', 'rest-a', off)).toBe(false);
    expect(isVoiceFeatureEnabledForRestaurant('dialogueListeningV2', 'rest-a', off)).toBe(false);
    expect(isVoiceDeepgramKeytermsEnabled('rest-a', off)).toBe(false);
  });

  it('active Deepgram, mots-clés et Dialogue V2 pour tout restaurant', () => {
    expect(isVoiceFeatureEnabledForRestaurant('deepgramStt', 'nouveau-resto', on)).toBe(true);
    expect(isVoiceFeatureEnabledForRestaurant('dialogueListeningV2', 'nouveau-resto', on)).toBe(
      true,
    );
    expect(isVoiceDeepgramKeytermsEnabled('nouveau-resto', on)).toBe(true);
    const session = { restaurantId: 'nouveau-resto' } as CallSession;
    process.env.VOICE_V2_DEFAULT = 'true';
    process.env.VOICE_STT_PROVIDER = 'deepgram';
    expect(resolveVoiceFeatureSnapshot(session)).toMatchObject({
      sttProvider: 'deepgram',
      dialogueListeningV2Enabled: true,
      deepgramKeytermsEnabled: true,
    });
  });

  it('un restaurant exclu perd Deepgram et Dialogue V2 par défaut (sauf liste explicite)', () => {
    const optOut = { ...on, VOICE_V2_DISABLED_RESTAURANT_IDS: ' rest-x , rest-y ' };
    expect(isVoiceV2Default('rest-x', optOut)).toBe(false);
    expect(isVoiceFeatureEnabledForRestaurant('deepgramStt', 'rest-x', optOut)).toBe(false);
    expect(isVoiceFeatureEnabledForRestaurant('deepgramStt', 'rest-z', optOut)).toBe(true);
  });

  it('Deepgram reste désactivé sans VOICE_STT_PROVIDER=deepgram, même par défaut', () => {
    expect(
      isVoiceFeatureEnabledForRestaurant('deepgramStt', 'rest-a', { VOICE_V2_DEFAULT: 'true' }),
    ).toBe(false);
  });
});

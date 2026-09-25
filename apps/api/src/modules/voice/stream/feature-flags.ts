import type { CallSession } from './types';

export type VoiceSttProvider = 'scribe' | 'deepgram';

export function parseRestaurantIdList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((restaurantId) => restaurantId.trim())
    .filter(Boolean);
}

export function isVoiceFeatureEnabledForRestaurant(
  feature: 'dialogueListeningV2' | 'deepgramStt',
  restaurantId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (feature === 'dialogueListeningV2') {
    return (
      env.VOICE_DIALOGUE_LISTENING_V2 === 'true' ||
      parseRestaurantIdList(env.VOICE_DIALOGUE_LISTENING_V2_RESTAURANT_IDS).includes(restaurantId)
    );
  }

  return (
    env.VOICE_STT_PROVIDER === 'deepgram' &&
    parseRestaurantIdList(env.VOICE_STT_PROVIDER_RESTAURANT_IDS).includes(restaurantId)
  );
}

export interface VoiceFeatureSnapshot {
  dialogueListeningV2Enabled: boolean;
  sttProvider: VoiceSttProvider;
}

export function resolveVoiceFeatureSnapshot(
  session: Pick<CallSession, 'restaurantId' | 'voiceFeatureSnapshot'>,
  env: NodeJS.ProcessEnv = process.env,
): VoiceFeatureSnapshot {
  if (session.voiceFeatureSnapshot) return session.voiceFeatureSnapshot;

  const snapshot: VoiceFeatureSnapshot = {
    dialogueListeningV2Enabled: isVoiceFeatureEnabledForRestaurant(
      'dialogueListeningV2',
      session.restaurantId,
      env,
    ),
    sttProvider: isVoiceFeatureEnabledForRestaurant('deepgramStt', session.restaurantId, env)
      ? 'deepgram'
      : 'scribe',
  };
  session.voiceFeatureSnapshot = snapshot;
  return snapshot;
}

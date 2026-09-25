import type { CallSession } from './types';

export type VoiceSttProvider = 'scribe' | 'deepgram';
export type VoiceDeepgramModel = 'nova-3' | 'flux-general-multi';

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
  deepgramModel: VoiceDeepgramModel;
  deepgramNumeralsEnabled: boolean;
  deepgramPunctuateEnabled: boolean;
  deepgramKeytermsEnabled: boolean;
}

export function isVoiceDeepgramKeytermsEnabled(
  restaurantId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return parseRestaurantIdList(env.VOICE_DEEPGRAM_KEYTERMS_RESTAURANT_IDS).includes(restaurantId);
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
    deepgramModel:
      env.VOICE_DEEPGRAM_MODEL === 'flux-general-multi' &&
      parseRestaurantIdList(env.VOICE_DEEPGRAM_MODEL_RESTAURANT_IDS).includes(session.restaurantId)
        ? 'flux-general-multi'
        : 'nova-3',
    deepgramNumeralsEnabled: parseRestaurantIdList(
      env.VOICE_DEEPGRAM_NUMERALS_RESTAURANT_IDS,
    ).includes(session.restaurantId)
      ? env.VOICE_DEEPGRAM_NUMERALS !== 'false'
      : true,
    deepgramPunctuateEnabled:
      parseRestaurantIdList(env.VOICE_DEEPGRAM_PUNCTUATE_RESTAURANT_IDS).includes(
        session.restaurantId,
      ) && env.VOICE_DEEPGRAM_PUNCTUATE === 'true',
    deepgramKeytermsEnabled: isVoiceDeepgramKeytermsEnabled(session.restaurantId, env),
  };
  session.voiceFeatureSnapshot = snapshot;
  return snapshot;
}

/** Les améliorations de latence coûteuses restent limitées au pilote Deepgram + Dialogue V2. */
export function isVoiceDeepgramDialoguePilot(session: CallSession): boolean {
  const snapshot = resolveVoiceFeatureSnapshot(session);
  return snapshot.sttProvider === 'deepgram' && snapshot.dialogueListeningV2Enabled;
}

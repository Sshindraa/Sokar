import type { CallSession } from './types';

export type VoiceSttProvider = 'scribe' | 'deepgram';
export type VoiceDeepgramModel = 'nova-3' | 'flux-general-multi';

export function parseRestaurantIdList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((restaurantId) => restaurantId.trim())
    .filter(Boolean);
}

/**
 * Parcours vocal moderne par défaut (tour structuré, Deepgram, mots-clés Deepgram, écoute Dialogue V2 avec
 * filtre d'écho) pour tout restaurant, sans le lister un par un. `VOICE_V2_DISABLED_RESTAURANT_IDS` ramène un
 * restaurant à l'ancien chemin ; il n'annule pas les listes explicites, qui gardent leur effet.
 * Désactivé tant que `VOICE_V2_DEFAULT` n'est pas `true`.
 */
export function isVoiceV2Default(
  restaurantId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.VOICE_V2_DEFAULT === 'true' &&
    !parseRestaurantIdList(env.VOICE_V2_DISABLED_RESTAURANT_IDS).includes(restaurantId)
  );
}

/** Restaurants sur le tour structuré : liste explicite, ou parcours moderne par défaut. */
export function isVoiceStructuredTurnEnabled(
  restaurantId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    restaurantId &&
    (parseRestaurantIdList(env.VOICE_STRUCTURED_TURN_RESTAURANT_IDS).includes(restaurantId) ||
      isVoiceV2Default(restaurantId, env)),
  );
}

/**
 * Vérification de compréhension du tour structuré : le modèle lit littéralement ce que l'appelant a dit et
 * déclare s'il a dû deviner ; le code n'applique alors aucun changement ni aucune action. Seulement pour les
 * restaurants listés (`VOICE_UNDERSTANDING_CHECK_RESTAURANT_IDS`), vide = aucun.
 */
export function isVoiceUnderstandingCheckEnabled(
  restaurantId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    restaurantId &&
    parseRestaurantIdList(env.VOICE_UNDERSTANDING_CHECK_RESTAURANT_IDS).includes(restaurantId),
  );
}

/**
 * Juge de fin de tour séparé (voir `structured-turn/turn-end-judge.ts`) : une requête minimale, en parallèle du
 * passage anticipé, dit si l'appelant a fini ; son verdict remplace `turnComplete` pour fermer le tour et pour
 * décider de répondre. Seulement pour les restaurants listés (`VOICE_TURN_JUDGE_RESTAURANT_IDS`), vide = aucun.
 */
export function isVoiceTurnJudgeEnabled(
  restaurantId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    restaurantId &&
    parseRestaurantIdList(env.VOICE_TURN_JUDGE_RESTAURANT_IDS).includes(restaurantId),
  );
}

export function isVoiceFeatureEnabledForRestaurant(
  feature: 'dialogueListeningV2' | 'deepgramStt',
  restaurantId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (feature === 'dialogueListeningV2') {
    return (
      env.VOICE_DIALOGUE_LISTENING_V2 === 'true' ||
      parseRestaurantIdList(env.VOICE_DIALOGUE_LISTENING_V2_RESTAURANT_IDS).includes(
        restaurantId,
      ) ||
      isVoiceV2Default(restaurantId, env)
    );
  }

  return (
    env.VOICE_STT_PROVIDER === 'deepgram' &&
    (parseRestaurantIdList(env.VOICE_STT_PROVIDER_RESTAURANT_IDS).includes(restaurantId) ||
      isVoiceV2Default(restaurantId, env))
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
  return (
    parseRestaurantIdList(env.VOICE_DEEPGRAM_KEYTERMS_RESTAURANT_IDS).includes(restaurantId) ||
    isVoiceV2Default(restaurantId, env)
  );
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

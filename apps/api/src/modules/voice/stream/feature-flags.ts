import type { CallSession } from './types';

export type VoiceDeepgramModel = 'nova-3' | 'flux-general-multi';

export function parseRestaurantIdList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((restaurantId) => restaurantId.trim())
    .filter(Boolean);
}

export interface VoiceFeatureSnapshot {
  deepgramModel: VoiceDeepgramModel;
  deepgramNumeralsEnabled: boolean;
  deepgramPunctuateEnabled: boolean;
}

/**
 * Réglages Deepgram figés pour tout appel : nova-3, chiffres en nombres, sans ponctuation (le réglage
 * de production depuis septembre ; Flux et la ponctuation restent mesurables au banc,
 * scripts/voice-stt-bench). Le fournisseur, l'écoute Dialogue V2 avec filtre d'écho et les mots-clés
 * Deepgram sont actifs pour tous les restaurants, sans liste ni interrupteur.
 */
export function resolveVoiceFeatureSnapshot(
  session: Pick<CallSession, 'voiceFeatureSnapshot'>,
): VoiceFeatureSnapshot {
  if (session.voiceFeatureSnapshot) return session.voiceFeatureSnapshot;

  const snapshot: VoiceFeatureSnapshot = {
    deepgramModel: 'nova-3',
    deepgramNumeralsEnabled: true,
    deepgramPunctuateEnabled: false,
  };
  session.voiceFeatureSnapshot = snapshot;
  return snapshot;
}

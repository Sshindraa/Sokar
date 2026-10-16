import type { SpokenAlignment } from './interrupted-reply';
import type { CallSession } from './types';
import { createCartesiaContextTurn, isCartesiaContextV2Enabled } from './cartesia-context';
import { createElevenLabsContextTurn } from './elevenlabs-context';
import { isElevenLabsDialogueEnabledFor } from './elevenlabs-dialogue-context';

/**
 * Contrat commun des tours TTS en contexte (streaming de texte pendant la génération du LLM). Cartesia et ElevenLabs
 * l'implémentent, le moteur de tour structuré ne connaît que cette interface.
 */
export interface ContextTtsTurn {
  /** Fournisseur du tour, pour les métriques. */
  readonly provider: 'elevenlabs' | 'cartesia';
  /** Appelé quand l'appelant reprend la parole avant le premier son : la réponse préparée est jetée. */
  onHoldCancelled?: () => void;
  readonly hasAudioOutput: boolean;
  readonly framesSent: number;
  pause(): void;
  resume(): void;
  interruptionSnapshot(): {
    text: string;
    playedMs: number;
    totalMs: number | null;
    alignment?: SpokenAlignment;
  };
  push(transcript: string): void;
  finish(): Promise<void>;
  cancel(reason?: 'barge_in' | 'unused'): void;
}

/**
 * Choisit le fournisseur du tour. Le chemin ElevenLabs ne s'applique qu'aux restaurants listés (voir
 * `isElevenLabsDialogueEnabledFor`) et passe devant Cartesia ; s'il est actif sans clé d'API, on retombe sur Cartesia.
 * Sans aucun drapeau, le résultat est `null` : le chemin HTTP habituel reste en place.
 */
export function createContextTtsTurn(session: CallSession): ContextTtsTurn | null {
  if (isElevenLabsDialogueEnabledFor(session.restaurantId)) {
    const elevenLabsTurn = createElevenLabsContextTurn(session);
    if (elevenLabsTurn) return elevenLabsTurn;
  }
  if (isCartesiaContextV2Enabled()) return createCartesiaContextTurn(session, true);
  return null;
}

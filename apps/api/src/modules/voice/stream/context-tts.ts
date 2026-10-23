import type { SpokenAlignment } from './interrupted-reply';
import type { CallSession } from './types';
import { createCartesiaContextTurn } from './cartesia-context';
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
  /**
   * `tone` : balise d'expression à placer avant ce texte (ElevenLabs seulement ; ignorée ailleurs). `flush` : générer
   * ce texte tout de suite même sans ponctuation finale (premiers mots d'une phrase ; ElevenLabs seulement).
   */
  push(transcript: string, options?: { tone?: string; flush?: boolean }): void;
  finish(): Promise<void>;
  cancel(reason?: 'barge_in' | 'unused'): void;
}

/**
 * Choisit le fournisseur du tour. Le chemin ElevenLabs s'applique à tous les restaurants dès que la clé est
 * présente (voir `isElevenLabsDialogueEnabledFor`) et passe devant Cartesia.
 * Sans clé de fournisseur, le résultat est `null` : le chemin HTTP habituel reste en place.
 */
export function createContextTtsTurn(session: CallSession): ContextTtsTurn | null {
  if (isElevenLabsDialogueEnabledFor(session.restaurantId)) {
    const elevenLabsTurn = createElevenLabsContextTurn(session);
    if (elevenLabsTurn) return elevenLabsTurn;
  }
  return createCartesiaContextTurn(session);
}

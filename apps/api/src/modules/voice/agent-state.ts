/**
 * State machine explicite pour l'état agent — remplace le simple booléen `agentSpeaking`
 * qui cause des race conditions WebSocket.
 *
 * États :
 *   IDLE       → appel entrant, agent prêt
 *   LISTENING  → STT en cours, client parle
 *   PROCESSING → LLM génère la réponse
 *   SPEAKING   → TTS joue la réponse, client doit attendre
 *
 * Transitions valides :
 *   IDLE      → LISTENING  (VAD: début de parole client)
 *   LISTENING → IDLE       (VAD: fin de parole, pas de requête LLM)
 *   LISTENING → PROCESSING (VAD: fin de parole, requête LLM en cours)
 *   PROCESSING → SPEAKING  (TTS: premier byte reçu)
 *   SPEAKING  → LISTENING  (TTS: fin de lecture, retour écoute)
 *   SPEAKING  → IDLE       (fin d'appel)
 *   LISTENING → IDLE       (fin d'appel)
 *   PROCESSING → IDLE      (fin d'appel)
 */

import { logger } from '../../shared/logger/pino';

export type AgentState = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING';

const VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
  IDLE:       ['LISTENING'],
  LISTENING:  ['IDLE', 'PROCESSING'],
  PROCESSING: ['SPEAKING', 'IDLE'],
  SPEAKING:   ['LISTENING', 'IDLE'],
};

export class AgentStateMachine {
  private state: AgentState = 'IDLE';
  private listeners: Array<(from: AgentState, to: AgentState) => void> = [];

  get current(): AgentState {
    return this.state;
  }

  get isSpeaking(): boolean {
    return this.state === 'SPEAKING';
  }

  transition(to: AgentState): boolean {
    const allowed = VALID_TRANSITIONS[this.state];
    if (!allowed.includes(to)) {
      logger.warn(`[AgentState] Invalid transition: ${this.state} → ${to}`);
      return false;
    }
    const from = this.state;
    this.state = to;
    for (const fn of this.listeners) fn(from, to);
    return true;
  }

  onTransition(fn: (from: AgentState, to: AgentState) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  reset(): void {
    this.state = 'IDLE';
  }
}

/**
 * Spéculation du tour structuré : dès que la partielle Deepgram est stable, le
 * premier appel au modèle part avec exactement la requête qu'enverrait le tour
 * final. Rien n'est dit ni exécuté : quand la fin de phrase arrive, le moteur
 * reprend ce flux déjà commencé seulement si sa requête est identique au
 * caractère près (même phrase, même historique, même état), sinon il l'abandonne.
 *
 * Rejeu des appels réels du 27/09 : la partielle est déjà la phrase finale dans
 * ~40–50 % des tours, stable ~300–450 ms avant la fin officielle.
 */
import type { CallSession, ChatMessage } from '../types';
import type { CallSessionManager } from '../manager';

type StructuredFormat = Parameters<CallSessionManager['streamStructuredCompletion']>[2];

interface Speculation {
  key: string;
  deltas: string[];
  listeners: Set<(delta: string) => void>;
  controller: AbortController;
  done: Promise<string>;
}

const speculations = new WeakMap<CallSession, Speculation>();

function requestKey(messages: ChatMessage[], format: StructuredFormat): string {
  return JSON.stringify([messages, format]);
}

export function isStructuredSpeculationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VOICE_STRUCTURED_SPECULATION_ENABLED === 'true';
}

/** Lance (ou garde) la requête spéculative ; une requête différente remplace la précédente. */
export function startSpeculation(
  session: CallSession,
  mgr: CallSessionManager,
  messages: ChatMessage[],
  format: StructuredFormat,
): void {
  const key = requestKey(messages, format);
  const current = speculations.get(session);
  if (current?.key === key) return;
  current?.controller.abort();
  const controller = new AbortController();
  const speculation: Speculation = {
    key,
    deltas: [],
    listeners: new Set(),
    controller,
    done: Promise.resolve(''),
  };
  speculation.done = mgr.streamStructuredCompletion(session, messages, format, {
    signal: controller.signal,
    onDelta: (delta) => {
      speculation.deltas.push(delta);
      for (const listener of speculation.listeners) listener(delta);
    },
  });
  // Une spéculation abandonnée ou échouée n'est jamais une erreur du tour.
  speculation.done.catch(() => undefined);
  speculations.set(session, speculation);
}

/**
 * Reprend la spéculation si sa requête est identique : les fragments déjà reçus
 * sont rejoués, la suite arrive en direct. Sinon elle est abandonnée et null.
 */
export function takeSpeculation(
  session: CallSession,
  messages: ChatMessage[],
  format: StructuredFormat,
  onDelta: (delta: string) => void,
  signal: AbortSignal,
): Promise<string> | null {
  const speculation = speculations.get(session);
  speculations.delete(session);
  if (!speculation) return null;
  if (speculation.key !== requestKey(messages, format)) {
    speculation.controller.abort();
    return null;
  }
  signal.addEventListener('abort', () => speculation.controller.abort(), { once: true });
  for (const delta of speculation.deltas) onDelta(delta);
  speculation.listeners.add(onDelta);
  return speculation.done;
}

export function cancelSpeculation(session: CallSession): void {
  speculations.get(session)?.controller.abort();
  speculations.delete(session);
}

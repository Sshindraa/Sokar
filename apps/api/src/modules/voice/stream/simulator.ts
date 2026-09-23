/**
 * Simulateur d'appel vocal : fait passer des énoncés par le vrai pipeline
 * (événements Scribe → contrôleur → LLM → TTS) sans Telnyx ni Cartesia.
 * Le texte qui aurait été prononcé est capté via `session.speechSink`.
 *
 * Utilisé par la route de test `/api/test/simulate-utterance` et par le banc
 * d'évaluation (`modules/voice/eval`). Jamais branché sur un vrai appel.
 */
import { WebSocket } from 'ws';
import { CallSessionManager } from './manager';
import { handleSttEvent } from './llm-handler';
import { buildInitialGreeting } from './handler';
import { extractRestaurantName } from './llm-handler';
import type { CallSession } from './types';

export interface SpokenEntry {
  text: string;
  kind: 'speech' | 'filler';
}

export interface SimulatedCallOptions {
  callControlId?: string;
  from?: string;
  to?: string;
  restaurantId: string;
  restaurantName: string;
  systemPrompt: string;
  managerPhone?: string | null;
  timezone?: string;
  giftCardMinimumAmount?: number;
  isVip?: boolean;
  personality?: CallSession['personality'];
}

export interface SimulatedTurn {
  /** Phrases prononcées pendant ce tour (fillers exclus). */
  speech: string[];
  /** Fillers joués pendant ce tour. */
  fillers: string[];
}

/** Faux WebSocket Telnyx : ouvert, et ignore tout ce qu'on lui envoie. */
export function createFakeTelnyxWs(): WebSocket {
  return {
    readyState: WebSocket.OPEN,
    send: () => undefined,
    close: () => undefined,
    on: () => undefined,
    once: () => undefined,
  } as unknown as WebSocket;
}

/** Attache le capteur de parole à une session existante (route de test). */
export function attachSpeechSink(session: CallSession): SpokenEntry[] {
  const spoken: SpokenEntry[] = [];
  session.speechSink = (text, kind) => {
    spoken.push({ text, kind });
  };
  return spoken;
}

/**
 * Fait passer un énoncé comme s'il venait de Scribe (début puis fin de
 * parole), attend la fin du tour et renvoie ce que l'agent a dit.
 */
export async function simulateCallerUtterance(
  session: CallSession,
  transcript: string,
  options: { languageCode?: string; mgr?: CallSessionManager } = {},
): Promise<SimulatedTurn> {
  const mgr = options.mgr ?? CallSessionManager.getInstance();
  const spoken: SpokenEntry[] = [];
  const previousSink = session.speechSink;
  session.speechSink = (text, kind) => {
    spoken.push({ text, kind });
    previousSink?.(text, kind);
  };
  try {
    session.turnProcessing = null;
    handleSttEvent({ type: 'UtteranceStart' }, session, mgr);
    handleSttEvent(
      {
        type: 'UtteranceEnd',
        transcript,
        ...(options.languageCode ? { languageCode: options.languageCode } : {}),
      },
      session,
      mgr,
    );
    // TypeScript ne voit pas que handleSttEvent a posé turnProcessing.
    await (session.turnProcessing as Promise<void> | null);
    await session.ttsPlayback;
  } finally {
    session.speechSink = previousSink;
  }
  return {
    speech: spoken.filter((entry) => entry.kind === 'speech').map((entry) => entry.text),
    fillers: spoken.filter((entry) => entry.kind === 'filler').map((entry) => entry.text),
  };
}

/**
 * Crée une session simulée, prononce l'accueil comme le vrai handler et
 * renvoie la session prête à recevoir des énoncés.
 */
export async function startSimulatedCall(
  options: SimulatedCallOptions,
  mgr = CallSessionManager.getInstance(),
): Promise<{ session: CallSession; greeting: string; spoken: SpokenEntry[] }> {
  const callControlId = options.callControlId ?? `sim-call-${Date.now()}-${Math.random()}`;
  const session = mgr.create({
    callControlId,
    callSessionId: `${callControlId}-session`,
    from: options.from ?? '+33600000000',
    to: options.to ?? '+33100000000',
    restaurantId: options.restaurantId,
    restaurantName: options.restaurantName,
    managerPhone: options.managerPhone ?? null,
    timezone: options.timezone,
    giftCardMinimumAmount: options.giftCardMinimumAmount,
    systemPrompt: options.systemPrompt,
    isVip: options.isVip ?? false,
    telnyxWs: createFakeTelnyxWs(),
    callLegId: callControlId,
    codec: 'PCMU',
    personality: options.personality ?? null,
  });
  const spoken = attachSpeechSink(session);
  const greeting = buildInitialGreeting(extractRestaurantName(session.systemPrompt));
  mgr.transition(session, 'SPEAKING');
  session.speechSink?.(greeting, 'speech');
  mgr.transition(session, 'LISTENING');
  return { session, greeting, spoken };
}

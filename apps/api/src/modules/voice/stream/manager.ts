import { WebSocket } from 'ws';
import { createHash } from 'node:crypto';
import type { CallSession, FluxEvent, CallState } from './types';
import { LLM_MODEL } from '@sokar/config';
import { getRestaurantTools } from '../tools';

// Chargé paresseusement pour éviter les circular deps
let _db: any = null;
async function db() {
  if (!_db) _db = (await import('../../../shared/db/client')).db;
  return _db;
}

export class CallSessionManager {
  private readonly sessions = new Map<string, CallSession>();

  private static instance: CallSessionManager;
  static getInstance(): CallSessionManager {
    if (!this.instance) this.instance = new CallSessionManager();
    return this.instance;
  }

  create(opts: {
    callControlId: string;
    callSessionId: string;
    from: string;
    to: string;
    restaurantId: string;
    systemPrompt: string;
    isVip: boolean;
    telnyxWs: WebSocket;
    callLegId: string;
  }): CallSession {
    const session: CallSession = {
      callControlId: opts.callControlId,
      callSessionId: opts.callSessionId,
      callLegId: opts.callLegId,
      from: opts.from,
      to: opts.to,
      restaurantId: opts.restaurantId,
      systemPrompt: opts.systemPrompt,
      state: 'IDLE',
      turnCount: 0,
      isVip: opts.isVip,
      telnyxWs: opts.telnyxWs,
      deepgramWs: null,
      deepgramReady: null,
      onDeepgramEvent: null,
      audioBuffer: [],
      isSpeaking: false,
      bargeInChunks: 0,
      speculativeLlm: null,
      speculativeTranscript: '',
      speculativeResult: null,
      transcript: '',
      lastActivityAt: Date.now(),
      createdAt: Date.now(),
    };
    this.sessions.set(sessionIdKey(opts.callControlId), session);
    return session;
  }

  get(ccId: string): CallSession | undefined {
    return this.sessions.get(sessionIdKey(ccId));
  }

  delete(ccId: string): void {
    const session = this.sessions.get(sessionIdKey(ccId));
    if (session) {
      this.cleanup(session);
      this.sessions.delete(sessionIdKey(ccId));
    }
  }

  cleanup(session: CallSession): void {
    if (session.deepgramWs && session.deepgramWs.readyState === WebSocket.OPEN) {
      try { session.deepgramWs.close(); } catch { /* ignore */ }
    }
    session.deepgramWs = null;
    session.audioBuffer = [];
  }

  // ─── State Machine ──────────────────────────────────────────────

  transition(session: CallSession, newState: CallState): boolean {
    const valid: Record<CallState, CallState[]> = {
      IDLE:       ['LISTENING'],
      LISTENING:  ['PROCESSING', 'IDLE'],
      PROCESSING: ['SPEAKING', 'LISTENING', 'IDLE'],
      SPEAKING:   ['LISTENING', 'IDLE'],
    };

    if (!valid[session.state].includes(newState)) return false;

    session.state = newState;
    session.lastActivityAt = Date.now();
    return true;
  }

  // ─── Barge-in ───────────────────────────────────────────────────

  handleBargeIn(session: CallSession): void {
    if (session.state !== 'SPEAKING') return;
    this.sendTelnyxClear(session);
    this.transition(session, 'LISTENING');
    session.isSpeaking = false;
    console.log(`[barge-in] Call ${session.callControlId} — interrupted`);
  }

  private sendTelnyxClear(session: CallSession): void {
    if (session.telnyxWs.readyState !== WebSocket.OPEN) return;
    session.telnyxWs.send(JSON.stringify({ event: 'clear' }));
  }

  // ─── LLM Processing ─────────────────────────────────────────────

  async processUtterance(session: CallSession, transcript: string): Promise<string> {
    this.transition(session, 'PROCESSING');
    session.turnCount++;

    const response = await this.callLlm(session, transcript);

    this.transition(session, 'SPEAKING');
    return response;
  }

  /**
   * Appelle le LLM avec outils (function calling).
   * Si le LLM décide d'appeler un outil, on l'exécute et on rappelle le LLM
   * avec le résultat — jusqu'à 3 rounds max.
   */
  private async callLlm(
    session: CallSession,
    transcript: string,
  ): Promise<string> {
    const tools = getRestaurantTools(session.restaurantId);
    const messages: any[] = [
      { role: 'system', content: session.systemPrompt },
      { role: 'user', content: transcript },
    ];

    for (let round = 0; round < 3; round++) {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: LLM_MODEL,
          messages,
          max_tokens: 300,
          temperature: 0.7,
          tools,
          tool_choice: 'auto',
          provider: { order: ['mistral'], allow_fallbacks: false },
        }),
      });

      if (!response.ok) {
        throw new Error(`LLM ${response.status}: ${await response.text()}`);
      }

      const data = await response.json() as any;
      const msg = data.choices?.[0]?.message;

      if (!msg) throw new Error('Empty LLM response');

      // Si le LLM répond en texte → terminé
      if (msg.content?.trim()) return msg.content;

      // Si le LLM appelle un outil
      if (msg.tool_calls?.length > 0) {
        messages.push(msg);
        for (const tc of msg.tool_calls) {
          const result = await this.executeTool(session, tc.function.name, tc.function.arguments);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
        }
        continue; // round suivant
      }

      // Fallback
      return msg.content ?? '';
    }

    return 'Désolé, je n\'ai pas pu traiter votre demande.';
  }

  /**
   * Exécute un appel d'outil et retourne le résultat texte.
   */
  private async executeTool(
    session: CallSession,
    name: string,
    argsJson: string,
  ): Promise<string> {
    try {
      const args = JSON.parse(argsJson);

      switch (name) {
        case 'createReservation': {
          const { date, time, partySize, customerName, customerPhone } = args;
          const database = await db();
          const reservation = await database.reservation.create({
            data: {
              restaurantId: session.restaurantId,
              reservedAt: new Date(`${date}T${time}`),
              partySize: partySize ?? 1,
              customerName: customerName ?? 'Client',
              customerPhone: customerPhone ?? session.from,
              status: 'PENDING',
            },
          });
          return `Réservation confirmée pour ${customerName ?? 'le client'}, le ${date} à ${time}, pour ${partySize} personne(s). Numéro de réservation : ${reservation.id.slice(0, 8).toUpperCase()}.`;
        }

        case 'handoffToManager':
          return 'Je vous transfère au gérant. Merci de patienter.';

        default:
          return `Outil inconnu : ${name}`;
      }
    } catch (err: any) {
      console.error(`[tool] Error executing ${name}:`, err.message);
      return `Erreur lors de l'exécution de ${name}.`;
    }
  }
}

function sessionIdKey(ccId: string): string {
  return createHash('sha256').update(ccId).digest('hex').slice(0, 16);
}

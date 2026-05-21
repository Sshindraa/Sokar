import { WebSocket } from 'ws';
import { createHash } from 'node:crypto';
import type { CallSession, FluxEvent, CallState } from './types';
import { LLM_MODELS } from '@sokar/config';

/**
 * Gère le cycle de vie d'un appel :
 * - State machine (LISTENING → PROCESSING → SPEAKING → LISTENING)
 * - Barge-in (interruption pendant SPEAKING)
 * - Compteurs (turn count, timeout)
 */
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
  }): CallSession {
    const session: CallSession = {
      callControlId: opts.callControlId,
      callSessionId: opts.callSessionId,
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

  /** Nettoie les WebSockets Deepgram et les buffers */
  cleanup(session: CallSession): void {
    // Cleanup Deepgram WS
    if (session.deepgramWs && session.deepgramWs.readyState === WebSocket.OPEN) {
      try {
        session.deepgramWs.close();
      } catch { /* ignore */ }
    }
    session.deepgramWs = null;
    session.audioBuffer = [];
  }

  // ─── State Machine ──────────────────────────────────────────────

  transition(session: CallSession, newState: CallState): boolean {
    const valid: Record<CallState, CallState[]> = {
      IDLE:       ['LISTENING'],
      LISTENING:  ['PROCESSING', 'IDLE'],
      PROCESSING: ['SPEAKING', 'LISTENING', 'IDLE'], // LISTENING = caller a continué pendant spéculation
      SPEAKING:   ['LISTENING', 'IDLE'], // LISTENING = barge-in
    };

    if (!valid[session.state].includes(newState)) {
      return false; // transition invalide
    }

    session.state = newState;
    session.lastActivityAt = Date.now();
    return true;
  }

  // ─── Barge-in ───────────────────────────────────────────────────

  /**
   * Appelé quand Flux détecte que le caller parle pendant
   * qu'on est en train de parler (SPEAKING).
   */
  handleBargeIn(session: CallSession): void {
    if (session.state !== 'SPEAKING') return;

    // 1. Stop TTS playback → clear queue Telnyx
    this.sendTelnyxClear(session);

    // 2. Transition back to LISTENING
    this.transition(session, 'LISTENING');
    session.isSpeaking = false;

    console.log(`[barge-in] Call ${session.callControlId} — interrupted`);
  }

  /** Envoie un message `clear` au WebSocket Telnyx pour stopper l'audio */
  private sendTelnyxClear(session: CallSession): void {
    if (session.telnyxWs.readyState !== WebSocket.OPEN) return;
    session.telnyxWs.send(JSON.stringify({ event: 'clear' }));
  }

  // ─── LLM Processing ─────────────────────────────────────────────

  /**
   * Traite une transcription avec le LLM.
   * Dans le futur : appel OpenRouter via fetch.
   */
  async processUtterance(session: CallSession, transcript: string): Promise<string> {
    this.transition(session, 'PROCESSING');
    session.turnCount++;

    const model = session.isVip ? LLM_MODELS.PRO : LLM_MODELS.FLASH;

    // Appel OpenRouter
    const response = await this.callLlm(session.systemPrompt, transcript, model);

    // Une fois la réponse obtenue → SPEAKING pour TTS
    this.transition(session, 'SPEAKING');
    return response;
  }

  private async callLlm(
    systemPrompt: string,
    transcript: string,
    model: string,
  ): Promise<string> {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: transcript },
        ],
        max_tokens: 200,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content ?? '';
  }
}

function sessionIdKey(ccId: string): string {
  return createHash('sha256').update(ccId).digest('hex').slice(0, 16);
}

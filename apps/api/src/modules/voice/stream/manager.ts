import { WebSocket } from 'ws';
import { createHash } from 'node:crypto';
import type { CallSession, CallState } from './types';
import { VOICE_LLM_MODEL } from '@sokar/config'; // Resolved dynamically
import { getRestaurantTools } from '../tools';
import { ReservationService } from '../../reservations/reservation.service';
import { logger } from '../../../shared/logger/pino';
import * as Sentry from '@sentry/node';

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
    codec: 'PCMA' | 'PCMU';
    personality?: {
      fillerStyle: 'CASUAL' | 'FORMAL' | 'WARM';
      systemPromptExtra?: string | null;
    } | null;
  }): CallSession {
    const restaurantName = opts.systemPrompt
      .split('\n')[0]
      .replace(/^Tu es l'hôte d'accueil et assistant vocal chaleureux de /, '')
      .replace(/^Tu es l'assistant vocal de /, '')
      .replace(/\.$/, '')
      .trim();

    const greeting = `Bonjour, ${restaurantName} !`;

    const session: CallSession = {
      callControlId: opts.callControlId,
      callSessionId: opts.callSessionId,
      callLegId: opts.callLegId,
      from: opts.from,
      to: opts.to,
      restaurantId: opts.restaurantId,
      systemPrompt: opts.systemPrompt,
      state: 'IDLE',
      ended: false,
      turnCount: 0,
      isVip: opts.isVip,
      telnyxWs: opts.telnyxWs,
      codec: opts.codec,
      history: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'assistant', content: greeting },
      ],
      deepgramWs: null,
      deepgramReady: null,
      onDeepgramEvent: null,
      audioBuffer: [],
      isSpeaking: false,
      bargeInChunks: 0,
      abortController: null,
      speculativeLlm: null,
      speculativeTranscript: '',
      speculativeResult: null,
      transcript: '',
      turnTranscript: '',
      speechFinalTimer: null,
      lastActivityAt: Date.now(),
      createdAt: Date.now(),
      personality: opts.personality ?? null,
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
    session.ended = true;
    session.state = 'IDLE';
    session.isSpeaking = false;
    if (session.speechFinalTimer) {
      clearTimeout(session.speechFinalTimer);
      session.speechFinalTimer = null;
    }
    if (session.abortController) {
      session.abortController.abort();
      session.abortController = null;
    }
    if (session.deepgramWs && session.deepgramWs.readyState === WebSocket.OPEN) {
      try {
        session.deepgramWs.close();
      } catch {
        /* ignore */
      }
    }
    session.deepgramWs = null;
    session.audioBuffer = [];
  }

  // ─── State Machine ──────────────────────────────────────────────

  transition(session: CallSession, newState: CallState): boolean {
    if (session.ended && newState !== 'IDLE') return false;

    const valid: Record<CallState, CallState[]> = {
      IDLE: ['LISTENING', 'SPEAKING'],
      LISTENING: ['PROCESSING', 'IDLE'],
      PROCESSING: ['SPEAKING', 'LISTENING', 'IDLE'],
      SPEAKING: ['LISTENING', 'IDLE'],
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
    logger.info({ callId: session.callControlId }, '[barge-in] Call interrupted');
  }

  private sendTelnyxClear(session: CallSession): void {
    if (session.telnyxWs.readyState !== WebSocket.OPEN) return;
    session.telnyxWs.send(JSON.stringify({ event: 'clear' }));
  }

  // ─── LLM Processing ─────────────────────────────────────────────

  async processUtterance(session: CallSession, transcript: string): Promise<string> {
    this.transition(session, 'PROCESSING');
    session.turnCount++;

    // Mettre à jour l'historique avec la phrase utilisateur
    session.history.push({ role: 'user', content: transcript });

    const response = await this.callLlm(session, transcript);

    this.transition(session, 'SPEAKING');
    return response;
  }

  /**
   * Version streaming de processUtterance.
   * Appelle le LLM en stream, détecte les phrases complètes,
   * et invoque onPhrase dès qu'une phrase est prête.
   * Retourne le texte complet à la fin.
   */
  async processUtteranceStreaming(
    session: CallSession,
    transcript: string,
    onPhrase: (phrase: string) => Promise<void> | void,
  ): Promise<string> {
    this.transition(session, 'PROCESSING');
    session.turnCount++;
    session.history.push({ role: 'user', content: transcript });

    const fullText = await this.callLlmStreaming(session, onPhrase);

    this.transition(session, 'SPEAKING');
    return fullText;
  }

  /**
   * Mode simulation sans clé OpenRouter : réponses fixes qui déclenchent
   * createReservation sur demande explicite.
   */
  private async mockLlmResponse(session: CallSession, transcript: string): Promise<string> {
    const t = transcript.toLowerCase();
    const wantsReservation =
      t.includes('réservation') ||
      t.includes('réserver') ||
      t.includes('table') ||
      t.includes('place');

    if (wantsReservation) {
      // Simuler un appel d'outil créeReservation
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const date = tomorrow.toISOString().slice(0, 10);
      const args = JSON.stringify({
        date,
        time: '19:30',
        partySize: 2,
        customerName: session.from ?? 'Client Test',
        customerPhone: session.from,
      });
      const toolResult = await this.executeTool(session, 'createReservation', args);
      const reply = `Parfait, je note ça. ${toolResult}`;
      session.history.push({ role: 'assistant', content: reply });
      return reply;
    }

    const reply = 'Bonjour, bienvenue au restaurant. Je peux vous aider à réserver une table. Pour combien de personnes et à quelle heure ?';
    session.history.push({ role: 'assistant', content: reply });
    return reply;
  }

  /**
   * Appelle le LLM avec outils (function calling).
   * Si le LLM décide d'appeler un outil, on l'exécute et on rappelle le LLM
   * avec le résultat — jusqu'à 3 rounds max.
   */
  private async callLlm(session: CallSession, transcript: string): Promise<string> {
    if (process.env.SOKAR_SIMULATE_MOCK_LLM === 'true') {
      return this.mockLlmResponse(session, transcript);
    }

    const tools = getRestaurantTools(session.restaurantId);
    const messages = [...session.history];

    for (let round = 0; round < 3; round++) {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        signal: session.abortController?.signal,
        body: JSON.stringify({
          model: VOICE_LLM_MODEL,
          messages,
          max_tokens: 150,
          temperature: 0.7,
          tools,
          tool_choice: 'auto',
          ...(VOICE_LLM_MODEL?.includes('mistral')
            ? {
                provider: { order: ['mistral'], allow_fallbacks: false },
              }
            : {}),
        }),
      });

      if (!response.ok) {
        throw new Error(`LLM ${response.status}: ${await response.text()}`);
      }

      const data = (await response.json()) as any;
      const msg = data.choices?.[0]?.message;

      if (!msg) throw new Error('Empty LLM response');

      // Si le LLM répond en texte → terminé
      if (msg.content?.trim()) {
        session.history.push(msg);
        return msg.content;
      }

      // Si le LLM appelle un outil
      if (msg.tool_calls?.length > 0) {
        session.history.push(msg);
        messages.push(msg);
        for (const tc of msg.tool_calls) {
          const result = await this.executeTool(session, tc.function.name, tc.function.arguments);
          const toolMsg = { role: 'tool', tool_call_id: tc.id, content: result };
          session.history.push(toolMsg);
          messages.push(toolMsg);
        }
        continue; // round suivant
      }

      // Fallback
      session.history.push(msg);
      return msg.content ?? '';
    }

    const defaultErrorMsg = "Désolé, je n'ai pas pu traiter votre demande.";
    session.history.push({ role: 'assistant', content: defaultErrorMsg });
    return defaultErrorMsg;
  }

  /**
   * Version streaming de callLlm.
   * Parse le SSE d'OpenRouter, détecte les phrases complètes,
   * et invoque onPhrase pour chaque phrase.
   * Si un tool_call est détecté, fallback sur callLlm non-streaming.
   * Retourne le texte complet.
   */
  private async callLlmStreaming(
    session: CallSession,
    onPhrase: (phrase: string) => Promise<void> | void,
  ): Promise<string> {
    const tools = getRestaurantTools(session.restaurantId);
    const messages = [...session.history];

    for (let round = 0; round < 3; round++) {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        signal: session.abortController?.signal,
        body: JSON.stringify({
          model: VOICE_LLM_MODEL,
          messages,
          max_tokens: 150,
          temperature: 0.7,
          tools,
          tool_choice: 'auto',
          stream: true,
          ...(VOICE_LLM_MODEL?.includes('mistral')
            ? {
                provider: { order: ['mistral'], allow_fallbacks: false },
              }
            : {}),
        }),
      });

      if (!response.ok) {
        throw new Error(`LLM ${response.status}: ${await response.text()}`);
      }

      if (!response.body) {
        throw new Error('LLM response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sentenceBuffer = '';
      let fullText = '';
      let hasToolCall = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parser les lignes SSE
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);

            if (data === '[DONE]') {
              break;
            }

            try {
              const chunk = JSON.parse(data);
              const delta = chunk.choices?.[0]?.delta;

              if (!delta) continue;

              // Tool call détecté → arrêter le stream et fallback
              if (delta.tool_calls) {
                hasToolCall = true;
                break;
              }

              const token = delta.content ?? '';
              if (!token) continue;

              sentenceBuffer += token;
              fullText += token;

              // Détecter fin de phrase : . ! ? suivi d'espace ou fin
              const match = sentenceBuffer.match(/^(.+?[.!?])(\s+|$)/);
              if (match) {
                const phrase = match[1].trim();
                if (phrase) {
                  // Lancer onPhrase sans await pour ne pas bloquer le stream
                  Promise.resolve(onPhrase(phrase)).catch((err) =>
                    logger.error({ err }, 'onPhrase failed in sentence-buffered LLM stream'),
                  );
                }
                sentenceBuffer = sentenceBuffer.slice(match[0].length);
              }
            } catch {
              // Ignorer les lignes mal formées
            }
          }

          if (hasToolCall) break;
        }
      } finally {
        reader.releaseLock();
      }

      // Yield le reste du buffer s'il reste quelque chose
      if (sentenceBuffer.trim()) {
        await onPhrase(sentenceBuffer.trim());
      }

      if (hasToolCall) {
        // Fallback non-streaming pour gérer les tool calls
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          },
          body: JSON.stringify({
            model: VOICE_LLM_MODEL,
            messages,
            max_tokens: 150,
            temperature: 0.7,
            tools,
            tool_choice: 'auto',
            ...(VOICE_LLM_MODEL?.includes('mistral')
              ? {
                  provider: { order: ['mistral'], allow_fallbacks: false },
                }
              : {}),
          }),
        });

        if (!response.ok) {
          throw new Error(`LLM ${response.status}: ${await response.text()}`);
        }

        const data = (await response.json()) as any;
        const msg = data.choices?.[0]?.message;

        if (!msg) throw new Error('Empty LLM response');

        if (msg.content?.trim()) {
          session.history.push(msg);
          const text = msg.content.trim();
          await onPhrase(text);
          return text;
        }

        if (msg.tool_calls?.length > 0) {
          session.history.push(msg);
          messages.push(msg);
          for (const tc of msg.tool_calls) {
            const result = await this.executeTool(session, tc.function.name, tc.function.arguments);
            const toolMsg = { role: 'tool', tool_call_id: tc.id, content: result };
            session.history.push(toolMsg);
            messages.push(toolMsg);
          }
          continue; // round suivant
        }

        session.history.push(msg);
        return msg.content ?? '';
      }

      // Pas de tool call → streaming terminé normalement
      if (fullText.trim()) {
        session.history.push({ role: 'assistant', content: fullText.trim() });
      }
      return fullText.trim();
    }

    const defaultErrorMsg = "Désolé, je n'ai pas pu traiter votre demande.";
    session.history.push({ role: 'assistant', content: defaultErrorMsg });
    await onPhrase(defaultErrorMsg);
    return defaultErrorMsg;
  }

  /**
   * Exécute un appel d'outil et retourne le résultat texte.
   */
  private async executeTool(session: CallSession, name: string, argsJson: string): Promise<string> {
    try {
      const args = JSON.parse(argsJson);

      switch (name) {
        case 'createReservation': {
          const { date, time, partySize, customerName, customerPhone } = args;

          try {
            await ReservationService.create({
              restaurantId: session.restaurantId,
              callId: session.callLegId,
              reservedAt: new Date(`${date}T${time}`),
              partySize: partySize ?? 1,
              customerName: customerName ?? 'Client',
              customerPhone: customerPhone ?? session.from,
            });

            return `Réservation confirmée pour ${customerName ?? 'le client'}, le ${date} à ${time}, pour ${partySize ?? 1} personne(s). Un SMS de confirmation va être envoyé au client.`;
          } catch (err: any) {
            logger.error(
              { err: err.message, callId: session.callControlId },
              '[tool] ReservationService.create failed',
            );

            if (process.env.SENTRY_DSN) {
              Sentry.captureException(err, {
                tags: { service: 'manager-tool' },
                extra: { callId: session.callControlId },
              });
            }

            if (err.message === 'SLOT_NOT_AVAILABLE') {
              return `Désolé, ce créneau horaire n'est pas disponible (il y a un conflit dans l'agenda). Veuillez proposer une autre date ou heure.`;
            }

            return `Désolé, une erreur technique est survenue lors de l'enregistrement de la réservation. Veuillez essayer un autre créneau ou demander à parler au gérant.`;
          }
        }

        case 'handoffToManager':
          return 'Je vous transfère au gérant. Merci de patienter.';

        default:
          return `Outil inconnu : ${name}`;
      }
    } catch (err: any) {
      logger.error(
        { err, toolName: name, callId: session.callControlId },
        `[tool] Error executing ${name}: ${err.message}`,
      );
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(err, {
          tags: { service: 'manager', tool: name },
          extra: { callId: session.callControlId, argsJson },
        });
      }
      return `Erreur lors de l'exécution de ${name}.`;
    }
  }

  /**
   * Simulation locale : traite un transcript texte comme si Deepgram l'avait
   * reconnu, sans audio ni TTS. Retourne la réponse texte de l'assistant.
   * Utile pour tester les prompts et les outils en local sans clés providers.
   */
  async simulateUtterance(callControlId: string, transcript: string): Promise<string> {
    const session = this.get(callControlId);
    if (!session) throw new Error(`Session ${callControlId} not found`);
    if (session.ended) throw new Error(`Session ${callControlId} already ended`);

    session.transcript += (session.transcript ? ' ' : '') + transcript;
    return this.processUtterance(session, transcript);
  }
}

function sessionIdKey(ccId: string): string {
  return createHash('sha256').update(ccId).digest('hex').slice(0, 16);
}

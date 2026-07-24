import { WebSocket } from 'ws';
import { createHash } from 'node:crypto';
import type { CallSession, CallState, ChatMessage } from './types';
import {
  VOICE_LLM_MODEL_DEFAULT,
  VOICE_LLM_FALLBACK_MODEL_DEFAULT,
  CEREBRAS_BASE_URL,
} from '@sokar/config';
import { getRestaurantTools } from '../tools';
import {
  ReservationService,
  type AvailabilityResult,
} from '../../reservations/reservation.service';
import { db } from '../../../shared/db/client';
import { logger } from '../../../shared/logger/pino';
import * as Sentry from '@sentry/node';
import { GiftCardService } from '../../gift-cards/gift-card.service';
import { recommendGiftCardAmount } from '../../gift-cards/gift-card-recommender';
import { sendSms } from '../../../shared/telnyx/client';
import { trackGiftCardEvent } from '../../analytics/events.service';
import { AuditLogService } from '../../agentic-reservations/core/audit-log.service';
import { zonedTimeToUtc } from '../../floor-plan/availability-capacity-aware.service';
import { createConversationState } from './conversation-controller';
import { recordVoiceTurnEvent } from './turn-telemetry';

interface LlmResponse {
  choices?: Array<{ message: ChatMessage }>;
}

interface LlmRequestOptions {
  /** Omettre les outils pour les réponses conversationnelles sans effet métier. */
  includeTools?: boolean;
  /** Réduire la réponse quand une seule formule courte est attendue. */
  maxTokens?: number;
  temperature?: number;
  /** Une pré-réponse ne doit jamais modifier l'historique de l'appel. */
  persistHistory?: boolean;
}

/**
 * Résout le modèle LLM au runtime : env var VOICE_LLM_MODEL si définie,
 * sinon le défaut de @sokar/config.
 */
function getVoiceLlmModel(): string {
  return process.env.VOICE_LLM_MODEL ?? VOICE_LLM_MODEL_DEFAULT;
}

/**
 * Résout le modèle LLM de fallback (Cerebras direct) au runtime.
 */
function getVoiceLlmFallbackModel(): string {
  return process.env.VOICE_LLM_FALLBACK_MODEL ?? VOICE_LLM_FALLBACK_MODEL_DEFAULT;
}

/**
 * Résout l'URL de base OpenRouter au runtime : env var OPENROUTER_BASE_URL
 * si définie, sinon le défaut US. Permet de pointer vers un endpoint EU
 * ou un proxy sans redeploiement.
 */
function getOpenRouterBaseUrl(): string {
  return process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
}

/**
 * URL de base Cerebras pour le fallback direct (hors OpenRouter).
 */
function getCerebrasBaseUrl(): string {
  return CEREBRAS_BASE_URL;
}

/**
 * Retourne true si le fallback Cerebras est configuré (clé API présente).
 */
function isCerebrasFallbackEnabled(): boolean {
  return Boolean(process.env.CEREBRAS_API_KEY);
}

/**
 * Retourne le routing provider OpenRouter selon le modèle utilisé.
 *
 * - Llama  : force le provider Groq (LPU, TTFT ~150ms)
 * - Mistral : force le provider Mistral
 * - Gemini  : force le provider google-vertex (endpoints EU disponibles)
 * - Autres  : laisse OpenRouter choisir (default routing)
 */
function getProviderRouting(): Record<string, unknown> | undefined {
  const model = getVoiceLlmModel();
  if (model.includes('llama')) {
    return { provider: { order: ['groq'], allow_fallbacks: false } };
  }
  if (model.includes('mistral')) {
    return { provider: { order: ['mistral'], allow_fallbacks: false } };
  }
  if (model.includes('gemini')) {
    // Préférer Vertex (EU disponible), fallback sur AI Studio si Vertex indispo
    return { provider: { order: ['google-vertex', 'google'], allow_fallbacks: true } };
  }
  return undefined;
}

/**
 * Détermine si une erreur HTTP justifie le fallback Cerebras.
 * (429 = rate limit, 5xx = serveur en panne)
 */
function isFallbackEligibleError(status: number): boolean {
  return status === 429 || status >= 500;
}

function normalizeVoiceIdentity(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  const rows = Array.from({ length: left.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= right.length; leftIndex++) {
    let diagonal = rows[0];
    rows[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= left.length; rightIndex++) {
      const previous = rows[rightIndex];
      rows[rightIndex] = Math.min(
        rows[rightIndex] + 1,
        rows[rightIndex - 1] + 1,
        diagonal + (right[leftIndex - 1] === left[rightIndex - 1] ? 0 : 1),
      );
      diagonal = previous;
    }
  }

  return 1 - rows[left.length] / Math.max(left.length, right.length);
}

/**
 * Accepte une variation STT seulement si au moins deux mots ont été prononcés et que
 * chacun correspond à un mot du nom enregistré. La sélection reste ensuite soumise à
 * l'unicité du candidat sur le créneau exact.
 */
export function isSafeVoiceNameMatch(spokenName: string, storedName: string): boolean {
  const spokenTokens = normalizeVoiceIdentity(spokenName).split(' ').filter(Boolean);
  const storedTokens = normalizeVoiceIdentity(storedName).split(' ').filter(Boolean);
  if (spokenTokens.length < 2 || storedTokens.length < 2) return false;

  return spokenTokens.every((spokenToken) =>
    storedTokens.some((storedToken) => tokenSimilarity(spokenToken, storedToken) >= 0.8),
  );
}

function normalizeVoicePhone(value: string | null | undefined): string {
  return value?.replace(/\D/g, '') ?? '';
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
    restaurantName: string;
    timezone?: string;
    /** Montant minimum carte cadeau — défaut 10€ */
    giftCardMinimumAmount?: number;
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
    const restaurantName = opts.restaurantName;
    const giftCardMinimumAmount = opts.giftCardMinimumAmount ?? 10;

    const greeting = `Bonjour, ${restaurantName} !`;

    const session: CallSession = {
      callControlId: opts.callControlId,
      callSessionId: opts.callSessionId,
      callLegId: opts.callLegId,
      from: opts.from,
      to: opts.to,
      restaurantId: opts.restaurantId,
      restaurantName,
      timezone: opts.timezone ?? 'Europe/Paris',
      giftCardMinimumAmount,
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
      ttsPlayback: Promise.resolve(),
      ttsGeneration: 0,
      responseGeneration: 0,
      ttsContext: null,
      currentTurn: null,
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
      conversation: createConversationState(),
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
    session.ttsGeneration++;
    session.ttsContext?.cancel();
    session.ttsContext = null;
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
    session.responseGeneration++;
    session.ttsGeneration++;
    session.ttsContext?.cancel();
    session.ttsContext = null;
    this.sendTelnyxClear(session);
    this.transition(session, 'LISTENING');
    session.isSpeaking = false;
    recordVoiceTurnEvent(session, 'barge_in');
    logger.info({ callId: session.callControlId }, '[barge-in] Call interrupted');
  }

  private sendTelnyxClear(session: CallSession): void {
    if (session.telnyxWs.readyState !== WebSocket.OPEN) return;
    session.telnyxWs.send(JSON.stringify({ event: 'clear' }));
  }

  // ─── LLM Processing ─────────────────────────────────────────────

  async getAvailability(
    session: CallSession,
    date: string,
    partySize: number,
  ): Promise<AvailabilityResult> {
    return ReservationService.availability(session.restaurantId, date, partySize);
  }

  async processUtterance(session: CallSession, transcript: string): Promise<string> {
    const responseGeneration = session.responseGeneration;
    this.transition(session, 'PROCESSING');
    session.turnCount++;

    // Mettre à jour l'historique avec la phrase utilisateur
    session.history.push({ role: 'user', content: transcript });

    const signal = session.abortController?.signal;
    const response = (await this.callLlm(session, transcript, signal)) ?? '';

    if (!signal?.aborted && session.responseGeneration === responseGeneration) {
      this.transition(session, 'SPEAKING');
    }
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
    options: LlmRequestOptions = {},
  ): Promise<string> {
    const responseGeneration = session.responseGeneration;
    this.transition(session, 'PROCESSING');
    session.turnCount++;
    session.history.push({ role: 'user', content: transcript });

    const signal = session.abortController?.signal;
    const fullText = await this.callLlmStreaming(session, onPhrase, signal, options);

    if (!signal?.aborted && session.responseGeneration === responseGeneration) {
      this.transition(session, 'SPEAKING');
    }
    return fullText;
  }

  /**
   * Prépare une réponse LLM sans muter l'historique ni exécuter d'outil.
   * Elle ne peut être réutilisée que si Deepgram confirme ensuite exactement
   * le même énoncé final : aucun effet métier ne peut donc partir trop tôt.
   */
  async prepareSpeculativeReply(
    session: CallSession,
    transcript: string,
    signal: AbortSignal,
  ): Promise<string> {
    return (
      (await this.callLlm(session, transcript, signal, {
        includeTools: false,
        maxTokens: 40,
        persistHistory: false,
      })) ?? ''
    );
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

    const reply =
      'Bonjour, bienvenue au restaurant. Je peux vous aider à réserver une table. Pour combien de personnes et à quelle heure ?';
    session.history.push({ role: 'assistant', content: reply });
    return reply;
  }

  /**
   * Appelle le LLM avec outils (function calling).
   * Si le LLM décide d'appeler un outil, on l'exécute et on rappelle le LLM
   * avec le résultat — jusqu'à 3 rounds max.
   */
  private async callLlm(
    session: CallSession,
    transcript: string,
    signal?: AbortSignal,
    options: LlmRequestOptions = {},
  ): Promise<string | null> {
    if (process.env.SOKAR_SIMULATE_MOCK_LLM === 'true') {
      return this.mockLlmResponse(session, transcript);
    }

    const includeTools = options.includeTools !== false;
    const tools = includeTools ? getRestaurantTools(session.restaurantId) : undefined;
    const messages = [...session.history];

    for (let round = 0; round < 3; round++) {
      const response = await this.fetchLlmCompletion(messages, {
        tools,
        maxTokens: options.maxTokens ?? 150,
        temperature: options.temperature ?? 0.7,
        signal,
      });

      if (!response.ok) {
        throw new Error(`LLM ${response.status}: ${await response.text()}`);
      }

      const data = (await response.json()) as LlmResponse;
      signal?.throwIfAborted();
      const msg = data.choices?.[0]?.message;

      if (!msg) throw new Error('Empty LLM response');

      // Si le LLM répond en texte → terminé
      if (msg.content?.trim()) {
        if (options.persistHistory !== false) session.history.push(msg);
        return msg.content;
      }

      // Si le LLM appelle un outil
      const toolCalls = msg.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        // Une pré-réponse ne déclenche jamais une opération métier. Le tour
        // final reprendra alors le chemin LLM normal et ses outils.
        if (!includeTools) return null;
        session.history.push(msg);
        messages.push(msg);
        for (const tc of toolCalls) {
          signal?.throwIfAborted();
          const result = await this.executeTool(session, tc.function.name, tc.function.arguments);
          signal?.throwIfAborted();
          const toolMsg: ChatMessage = { role: 'tool', tool_call_id: tc.id, content: result };
          session.history.push(toolMsg);
          messages.push(toolMsg);
        }
        continue; // round suivant
      }

      // Fallback
      if (options.persistHistory !== false) session.history.push(msg);
      return msg.content ?? '';
    }

    const defaultErrorMsg = "Désolé, je n'ai pas pu traiter votre demande.";
    session.history.push({ role: 'assistant', content: defaultErrorMsg });
    return defaultErrorMsg;
  }

  /**
   * Fetch LLM completion avec fallback Cerebras automatique.
   *
   * 1. Tente OpenRouter (primaire : Llama 3.3 70B sur Groq, TTFT ~150ms)
   * 2. Si erreur 429/5xx et Cerebras configuré → fallback Gemma 4 31B (modèle 2026)
   *
   * @returns Response object (non-streaming)
   */
  private async fetchLlmCompletion(
    messages: ChatMessage[],
    opts: {
      tools?: ReturnType<typeof getRestaurantTools>;
      maxTokens: number;
      temperature: number;
      signal?: AbortSignal;
    },
  ): Promise<Response> {
    const body = {
      model: getVoiceLlmModel(),
      messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      ...(opts.tools ? { tools: opts.tools, tool_choice: 'auto' } : {}),
      ...(getProviderRouting() ?? {}),
    };

    const response = await fetch(`${getOpenRouterBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      signal: opts.signal,
      body: JSON.stringify(body),
    });

    if (!response.ok && isCerebrasFallbackEnabled() && isFallbackEligibleError(response.status)) {
      logger.warn(
        { status: response.status, model: getVoiceLlmModel() },
        'LLM primary failed, falling back to Cerebras',
      );
      // Consume the error body before retrying
      await response.text().catch(() => {});
      return this.fetchCerebrasCompletion(messages, opts);
    }

    return response;
  }

  /**
   * Fetch LLM completion via Cerebras direct API (fallback).
   * Utilise Gemma 4 31B (modèle 2026, function calling natif).
   */
  private async fetchCerebrasCompletion(
    messages: ChatMessage[],
    opts: {
      tools?: ReturnType<typeof getRestaurantTools>;
      maxTokens: number;
      temperature: number;
      signal?: AbortSignal;
    },
  ): Promise<Response> {
    const body = {
      model: getVoiceLlmFallbackModel(),
      messages,
      max_tokens: opts.maxTokens,
      // Gemma 4 recommande temp=1.0, top_p=0.95 sur Cerebras
      temperature: 1.0,
      top_p: 0.95,
      ...(opts.tools ? { tools: opts.tools, tool_choice: 'auto' } : {}),
    };

    return fetch(`${getCerebrasBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.CEREBRAS_API_KEY}`,
      },
      signal: opts.signal,
      body: JSON.stringify(body),
    });
  }

  /**
   * Fetch LLM streaming response avec fallback Cerebras automatique.
   *
   * 1. Tente OpenRouter streaming (primaire : Llama 3.3 70B sur Groq)
   * 2. Si erreur 429/5xx et Cerebras configuré → fallback Gemma 4 31B streaming
   *
   * @returns Response object (streaming)
   */
  private async fetchLlmStreaming(
    messages: ChatMessage[],
    opts: {
      tools?: ReturnType<typeof getRestaurantTools>;
      maxTokens: number;
      temperature: number;
      signal?: AbortSignal;
    },
  ): Promise<Response> {
    const body = {
      model: getVoiceLlmModel(),
      messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      ...(opts.tools ? { tools: opts.tools, tool_choice: 'auto' } : {}),
      stream: true,
      ...(getProviderRouting() ?? {}),
    };

    const response = await fetch(`${getOpenRouterBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      signal: opts.signal,
      body: JSON.stringify(body),
    });

    if (!response.ok && isCerebrasFallbackEnabled() && isFallbackEligibleError(response.status)) {
      logger.warn(
        { status: response.status, model: getVoiceLlmModel() },
        'LLM streaming primary failed, falling back to Cerebras',
      );
      await response.text().catch(() => {});
      return this.fetchCerebrasStreaming(messages, opts);
    }

    return response;
  }

  /**
   * Fetch LLM streaming via Cerebras direct API (fallback).
   */
  private async fetchCerebrasStreaming(
    messages: ChatMessage[],
    opts: {
      tools?: ReturnType<typeof getRestaurantTools>;
      maxTokens: number;
      temperature: number;
      signal?: AbortSignal;
    },
  ): Promise<Response> {
    const body = {
      model: getVoiceLlmFallbackModel(),
      messages,
      max_tokens: opts.maxTokens,
      temperature: 1.0,
      top_p: 0.95,
      ...(opts.tools ? { tools: opts.tools, tool_choice: 'auto' } : {}),
      stream: true,
    };

    return fetch(`${getCerebrasBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.CEREBRAS_API_KEY}`,
      },
      signal: opts.signal,
      body: JSON.stringify(body),
    });
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
    signal?: AbortSignal,
    options: LlmRequestOptions = {},
  ): Promise<string> {
    const includeTools = options.includeTools !== false;
    const tools = includeTools ? getRestaurantTools(session.restaurantId) : undefined;
    const messages = [...session.history];

    for (let round = 0; round < 3; round++) {
      const response = await this.fetchLlmStreaming(messages, {
        tools,
        maxTokens: options.maxTokens ?? 150,
        temperature: options.temperature ?? 0.7,
        signal,
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
        const response = await this.fetchLlmCompletion(messages, {
          tools,
          maxTokens: 150,
          temperature: 0.7,
          signal,
        });

        if (!response.ok) {
          throw new Error(`LLM ${response.status}: ${await response.text()}`);
        }

        const data = (await response.json()) as LlmResponse;
        signal?.throwIfAborted();
        const msg = data.choices?.[0]?.message;

        if (!msg) throw new Error('Empty LLM response');

        if (msg.content?.trim()) {
          session.history.push(msg);
          const text = msg.content.trim();
          await onPhrase(text);
          return text;
        }

        const toolCalls = msg.tool_calls;
        if (toolCalls && toolCalls.length > 0) {
          session.history.push(msg);
          messages.push(msg);
          for (const tc of toolCalls) {
            signal?.throwIfAborted();
            const result = await this.executeTool(session, tc.function.name, tc.function.arguments);
            signal?.throwIfAborted();
            const toolMsg: ChatMessage = { role: 'tool', tool_call_id: tc.id, content: result };
            session.history.push(toolMsg);
            messages.push(toolMsg);
          }
          continue; // round suivant
        }

        session.history.push(msg);
        return msg.content ?? '';
      }

      // Pas de tool call → streaming terminé normalement
      signal?.throwIfAborted();
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
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(
              { err: message, callId: session.callControlId },
              '[tool] ReservationService.create failed',
            );

            if (process.env.SENTRY_DSN) {
              Sentry.captureException(err, {
                tags: { service: 'manager-tool' },
                extra: { callId: session.callControlId },
              });
            }

            if (message === 'SLOT_NOT_AVAILABLE') {
              return `Désolé, ce créneau horaire n'est pas disponible (il y a un conflit dans l'agenda). Veuillez proposer une autre date ou heure.`;
            }

            return `Désolé, une erreur technique est survenue lors de l'enregistrement de la réservation. Veuillez essayer un autre créneau ou demander à parler au gérant.`;
          }
        }

        case 'checkAvailability': {
          const { date, partySize, time } = args;

          try {
            const result = await this.getAvailability(session, date, partySize ?? 2);

            if (result.slots.length === 0) {
              return `Désolé, il n'y a plus de créneaux disponibles le ${date} pour ${partySize ?? 2} personne(s). Le restaurant est soit fermé, soit complet à cette date.`;
            }

            if (time) {
              if (result.slots.includes(time)) {
                return `Le créneau de ${time} est disponible le ${date} pour ${partySize ?? 2} personne(s).`;
              }

              const alternatives = result.slots.slice(0, 2).join(', ');
              return `Le créneau de ${time} n'est pas disponible le ${date} pour ${partySize ?? 2} personne(s). Créneaux proches disponibles : ${alternatives}.`;
            }

            // Limiter à 8 créneaux pour ne pas noyer l'LLM
            const slots = result.slots.slice(0, 8);
            const slotsText = slots.join(', ');
            return `Créneaux disponibles le ${date} pour ${partySize ?? 2} personne(s) : ${slotsText}.${result.slots.length > 8 ? ` (et ${result.slots.length - 8} autres créneaux)` : ''}`;
          } catch (err: unknown) {
            logger.error(
              {
                err: err instanceof Error ? err.message : String(err),
                callId: session.callControlId,
              },
              '[tool] checkAvailability failed',
            );
            return `Désolé, je n'ai pas pu vérifier les disponibilités pour le ${date}. Veuillez proposer une autre date ou demander à parler au gérant.`;
          }
        }

        case 'cancelReservation': {
          const { customerName, date } = args;

          try {
            // Trouver la réservation par nom + date
            const dayStart = new Date(`${date}T00:00:00`);
            const dayEnd = new Date(`${date}T23:59:59`);

            const reservations = await db.reservation.findMany({
              where: {
                restaurantId: session.restaurantId,
                customerName: { contains: customerName, mode: 'insensitive' },
                reservedAt: { gte: dayStart, lte: dayEnd },
                status: 'CONFIRMED',
              },
            });

            if (reservations.length === 0) {
              return `Je n'ai trouvé aucune réservation au nom de ${customerName} pour le ${date}. Vérifiez l'orthographe du nom ou la date.`;
            }

            // Annuler la première réservation trouvée
            const reservation = reservations[0];
            await ReservationService.update(reservation.id, session.restaurantId, {
              status: 'CANCELLED',
            });

            return `J'ai bien annulé la réservation de ${customerName} pour le ${date}. Un message de confirmation sera envoyé.`;
          } catch (err: unknown) {
            logger.error(
              {
                err: err instanceof Error ? err.message : String(err),
                callId: session.callControlId,
              },
              '[tool] cancelReservation failed',
            );
            if (process.env.SENTRY_DSN) {
              Sentry.captureException(err, {
                tags: { service: 'manager-tool', tool: 'cancelReservation' },
                extra: { callId: session.callControlId, customerName, date },
              });
            }
            return `Désolé, une erreur est survenue lors de l'annulation. Je vais vous transférer au gérant qui pourra s'en occuper.`;
          }
        }

        case 'takeMessage': {
          const { customerName, message, callbackPhone } = args;

          try {
            await db.message.create({
              data: {
                restaurantId: session.restaurantId,
                callId: session.callLegId,
                customerName: customerName ?? 'Client',
                customerPhone: callbackPhone ?? session.from,
                content: message,
                status: 'PENDING',
              },
            });

            return `J'ai bien noté votre message pour le gérant : "${message}". Il vous recontactera${callbackPhone ? ` au ${callbackPhone}` : ''} dès que possible. Merci de votre appel.`;
          } catch (err: unknown) {
            logger.error(
              {
                err: err instanceof Error ? err.message : String(err),
                callId: session.callControlId,
              },
              '[tool] takeMessage failed',
            );
            if (process.env.SENTRY_DSN) {
              Sentry.captureException(err, {
                tags: { service: 'manager-tool', tool: 'takeMessage' },
                extra: { callId: session.callControlId, customerName },
              });
            }
            return `Je n'ai pas pu enregistrer votre message. Je vais vous transférer au gérant.`;
          }
        }

        case 'reportDelay': {
          const { customerName, date, time, delayMinutes } = args;
          if (
            typeof date !== 'string' ||
            typeof time !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
            !Number.isInteger(delayMinutes)
          ) {
            return 'Je n’ai pas pu identifier la réservation. Pouvez-vous confirmer votre nom, la date et l’heure de la réservation ?';
          }

          try {
            const restaurant = await db.restaurant.findUnique({
              where: { id: session.restaurantId },
              select: { timezone: true },
            });
            const startsAt = zonedTimeToUtc(date, time, restaurant?.timezone ?? 'Europe/Paris');
            let reservation = await db.reservation.findFirst({
              where: {
                restaurantId: session.restaurantId,
                customerName: { equals: customerName, mode: 'insensitive' },
                startsAt,
                state: 'CONFIRMED',
              },
              select: { id: true },
            });

            if (!reservation) {
              const candidates = await db.reservation.findMany({
                where: {
                  restaurantId: session.restaurantId,
                  startsAt,
                  state: 'CONFIRMED',
                },
                select: { id: true, customerName: true, customerPhone: true },
                take: 10,
              });
              const callerPhone = normalizeVoicePhone(session.from);
              const phoneMatches = callerPhone
                ? candidates.filter(
                    (candidate) => normalizeVoicePhone(candidate.customerPhone) === callerPhone,
                  )
                : [];
              const safeNameMatches = candidates.filter((candidate) =>
                isSafeVoiceNameMatch(customerName, candidate.customerName),
              );
              const matches = phoneMatches.length === 1 ? phoneMatches : safeNameMatches;

              if (matches.length === 1) {
                reservation = { id: matches[0].id };
                logger.info(
                  {
                    callId: session.callControlId,
                    reservationId: reservation.id,
                    strategy:
                      phoneMatches.length === 1 ? 'caller_phone' : 'safe_name_on_exact_slot',
                  },
                  '[tool] reportDelay resolved non-exact voice identity',
                );
              }
            }
            if (!reservation) {
              return 'Je n’ai pas trouvé cette réservation confirmée. Je vous transfère au gérant pour vous aider.';
            }

            await new AuditLogService(db).record({
              event: 'reservation_delay_reported',
              reservationId: reservation.id,
              actor: 'voice:caller',
              actorHash: AuditLogService.hashActor(`voice:${session.callLegId}`),
              correlationId: session.callLegId,
              metadata: { delayMinutes, source: 'voice' },
            });
            return `Merci, votre retard de ${delayMinutes} minutes est bien noté. L’équipe de salle va examiner les possibilités ; votre réservation n’est pas modifiée automatiquement.`;
          } catch (err: unknown) {
            logger.error({ err, callId: session.callControlId }, '[tool] reportDelay failed');
            return 'Je n’ai pas pu enregistrer ce retard. Je vous transfère au gérant.';
          }
        }

        case 'handoffToManager':
          return 'Je vous transfère au gérant. Merci de patienter.';

        case 'recommendGiftCardAmount': {
          const { occasion, partySize, budget } = args;
          try {
            const recommendation = recommendGiftCardAmount({
              occasion,
              partySize,
              budget,
            });
            return `Je suggère une carte cadeau de ${recommendation.amount}€ pour ${occasion} pour ${partySize} personne${partySize > 1 ? 's' : ''}. ${recommendation.messageSuggestion}`;
          } catch (err: unknown) {
            logger.error(
              {
                err: err instanceof Error ? err.message : String(err),
                callId: session.callControlId,
              },
              '[tool] recommendGiftCardAmount failed',
            );
            return "Désolé, je n'ai pas pu calculer une recommandation. Pourriez-vous me donner un montant ?";
          }
        }

        case 'purchaseGiftCard': {
          const { amount, occasion, senderName, senderPhone, recipientName, message } = args;

          const minimumAmount = session.giftCardMinimumAmount ?? 10;

          if (!amount || amount < minimumAmount) {
            return `Le montant minimum pour une carte cadeau est de ${minimumAmount}€. Quel montant souhaitez-vous ?`;
          }

          // Normalisation du téléphone : supprimer espaces, points, tirets, parenthèses
          const normalizedPhone = (senderPhone || '').replace(/[\s.\-()]/g, '');
          if (!normalizedPhone || !/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) {
            return "Pour envoyer le code par SMS, j'ai besoin d'un numéro de téléphone valide de l'expéditeur au format international (ex: +33612345678).";
          }

          await trackGiftCardEvent({
            event: 'gift_card_purchase_started',
            restaurantId: session.restaurantId,
            source: 'voice',
            amount,
          });

          try {
            const service = new GiftCardService(db);
            const card = await service.create({
              restaurantId: session.restaurantId,
              amount,
              occasion,
              senderName,
              senderPhone: normalizedPhone,
              recipientName,
              message,
              createdBy: 'VOICE',
              purchaseReference: 'test',
            });

            const code = card.code;
            const smsText = `Votre carte cadeau chez ${session.restaurantName} : ${code}. Montant : ${amount}€. À utiliser sur le site de réservation.`;

            try {
              await sendSms(normalizedPhone, smsText);
            } catch (smsErr: unknown) {
              logger.error(
                {
                  err: smsErr instanceof Error ? smsErr.message : String(smsErr),
                  callId: session.callControlId,
                  giftCardId: card.id,
                },
                '[tool] purchaseGiftCard SMS failed',
              );
              if (process.env.SENTRY_DSN) {
                Sentry.captureException(smsErr, {
                  tags: { service: 'manager-tool', tool: 'purchaseGiftCard' },
                  extra: {
                    callId: session.callControlId,
                    giftCardId: card.id,
                    senderPhone: normalizedPhone,
                  },
                });
              }
              return "La carte cadeau a été créée, mais je n'ai pas pu envoyer le SMS. Je vous transfère au gérant pour récupérer le code.";
            }

            await trackGiftCardEvent({
              event: 'gift_card_purchase_completed',
              restaurantId: session.restaurantId,
              source: 'voice',
              giftCardId: card.id,
              amount,
            });

            return `Carte cadeau de ${amount}€ créée pour ${recipientName}. Le code a été envoyé par SMS au ${normalizedPhone}.`;
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error(
              { err: errMsg, callId: session.callControlId },
              '[tool] purchaseGiftCard failed',
            );
            if (process.env.SENTRY_DSN) {
              Sentry.captureException(err, {
                tags: { service: 'manager-tool', tool: 'purchaseGiftCard' },
                extra: { callId: session.callControlId },
              });
            }
            await trackGiftCardEvent({
              event: 'gift_card_purchase_failed',
              restaurantId: session.restaurantId,
              source: 'voice',
              amount,
              metadata: { error: errMsg },
            });
            return 'Désolé, une erreur est survenue lors de la création de la carte cadeau. Je vous transfère au gérant.';
          }
        }

        default:
          return `Outil inconnu : ${name}`;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { err, toolName: name, callId: session.callControlId },
        `[tool] Error executing ${name}: ${message}`,
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

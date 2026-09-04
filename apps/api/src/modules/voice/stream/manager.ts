import { WebSocket } from 'ws';
import { createHash } from 'node:crypto';
import type { CallSession, CallState, ChatMessage } from './types';
import { CEREBRAS_BASE_URL } from '@sokar/config';
import { voiceConfig } from '../../../env';
import { getRestaurantTools } from '../tools';
import { validateToolArgs } from '../tool-schemas';
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
import { createConversationState, isNameCollectionBlocking } from './conversation-controller';
import { recordVoiceTurnEvent } from './turn-telemetry';
import { getVoiceLlmProvider } from '../llm-provider';
import {
  voiceLlmFallbackTotal,
  voiceProviderErrorsTotal,
} from '../../../shared/observability/metrics';

// ─── LLM error classification for voice_provider_errors_total ──────────
// Distingue les providers réels (cerebras | groq | openrouter) et les types
// d'erreur (429 | 4xx | 5xx | timeout | session_abort) pour permettre
// de mesurer la fiabilité de chaque provider indépendamment.

type LlmProvider = 'cerebras' | 'groq' | 'openrouter';

function classifyLlmHttpStatus(status: number): string {
  if (status === 429) return '429';
  if (status >= 400 && status < 500) return '4xx';
  return '5xx';
}

function recordLlmHttpError(provider: LlmProvider, status: number): void {
  voiceProviderErrorsTotal.inc({ provider, type: classifyLlmHttpStatus(status) });
}

function recordLlmException(
  provider: LlmProvider,
  err: unknown,
  sessionSignal?: AbortSignal,
): void {
  const isAbort = err instanceof Error && err.name === 'AbortError';
  const isSessionAbort = isAbort && sessionSignal?.aborted;
  voiceProviderErrorsTotal.inc({
    provider,
    type: isSessionAbort ? 'session_abort' : 'timeout',
  });
}

/**
 * Détecte une annulation de session (barge-in, raccroché) — pas un timeout.
 * Dans ce cas, on ne doit PAS enregistrer une failure provider ni lancer de
 * fallback : la session est terminée, le signal est déjà aborted, toute
 * requête ultérieure échouerait immédiatement.
 */
function isSessionAbortError(err: unknown, sessionSignal?: AbortSignal): boolean {
  return err instanceof Error && err.name === 'AbortError' && !!sessionSignal?.aborted;
}

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
 * Résout le modèle LLM depuis la configuration voice validée au démarrage.
 */
function getVoiceLlmModel(): string {
  return voiceConfig.VOICE_LLM_MODEL;
}

/**
 * Résout le modèle LLM de fallback depuis la configuration validée au démarrage.
 */
function getVoiceLlmFallbackModel(): string {
  return voiceConfig.VOICE_LLM_FALLBACK_MODEL;
}

/**
 * Résout l'URL de base OpenRouter depuis la configuration voice validée.
 */
function getOpenRouterBaseUrl(): string {
  return voiceConfig.OPENROUTER_BASE_URL;
}

/**
 * URL de base Cerebras pour le fallback direct (hors OpenRouter).
 */
function getCerebrasBaseUrl(): string {
  return CEREBRAS_BASE_URL;
}

/** URL de base Groq (API OpenAI-compatible), surchargeable pour les tests. */
function getGroqBaseUrl(): string {
  return voiceConfig.GROQ_BASE_URL;
}

/**
 * Détermine le provider de secours pour le provider primaire.
 * Groq (Qwen 3.8) retombe sur OpenRouter (Llama) ; les deux routes
 * historiques Cerebras/OpenRouter restent inchangées pour compatibilité.
 */
function getFallbackProvider(primary: LlmProvider): LlmProvider {
  if (primary === 'groq' || primary === 'cerebras') return 'openrouter';
  return 'cerebras';
}

/**
 * Retourne true si le fallback Cerebras est configuré (clé API présente).
 */
function isCerebrasFallbackEnabled(): boolean {
  return Boolean(voiceConfig.CEREBRAS_API_KEY);
}

/**
 * Retourne true si le fallback OpenRouter est configuré (clé API présente).
 */
function isOpenRouterFallbackEnabled(): boolean {
  return Boolean(voiceConfig.OPENROUTER_API_KEY);
}

/**
 * Retourne le routing provider OpenRouter selon le modèle utilisé.
 *
 * - Llama  : force le provider Groq (LPU, TTFT ~150ms)
 * - Mistral : force le provider Mistral
 * - Gemini  : force le provider google-vertex (endpoints EU disponibles)
 * - Autres  : laisse OpenRouter choisir (default routing)
 */
function getProviderRouting(model?: string): Record<string, unknown> | undefined {
  const m = model ?? getVoiceLlmModel();
  if (m.includes('llama')) {
    return { provider: { order: ['groq'], allow_fallbacks: false } };
  }
  if (m.includes('mistral')) {
    return { provider: { order: ['mistral'], allow_fallbacks: false } };
  }
  if (m.includes('gemini')) {
    // Préférer Vertex (EU disponible), fallback sur AI Studio si Vertex indispo
    return { provider: { order: ['google-vertex', 'google'], allow_fallbacks: true } };
  }
  return undefined;
}

/**
 * Détermine si une erreur HTTP justifie le fallback.
 * (402 = quota épuisé, 429 = rate limit, 5xx = serveur en panne)
 */
function isFallbackEligibleError(status: number): boolean {
  return status === 402 || status === 429 || status >= 500;
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

/**
 * Circuit breaker simple pour les providers LLM voice.
 * Après N échecs consécutifs, le provider est marqué "open" (skip) pendant
 * un cooldown. Au prochain appel après le cooldown, on tente une requête
 * "half-open" : si elle réussit, le breaker se ferme ; si elle échoue,
 * le cooldown redémarre.
 *
 * État in-memory (non persistant) — se réinitialise au redémarrage du process.
 * Suffisant pour un outage temporaire ; ne remplace pas un monitoring externe.
 */
interface CircuitBreakerState {
  failures: number;
  openedAt: number | null; // timestamp ms, null = closed
}

const CIRCUIT_BREAKER_THRESHOLD = 3; // 3 échecs consécutifs → open
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000; // 30s de cooldown

const circuitBreakers: Record<string, CircuitBreakerState> = {
  cerebras: { failures: 0, openedAt: null },
  groq: { failures: 0, openedAt: null },
  openrouter: { failures: 0, openedAt: null },
};

function isCircuitBreakerOpen(provider: LlmProvider): boolean {
  const state = circuitBreakers[provider];
  if (state.openedAt === null) return false;
  const elapsed = Date.now() - state.openedAt;
  if (elapsed >= CIRCUIT_BREAKER_COOLDOWN_MS) {
    // Half-open : on laisse passer une requête pour tester le provider
    logger.info({ provider }, `[circuit-breaker] ${provider} entering half-open state`);
    return false;
  }
  return true;
}

function recordProviderSuccess(provider: LlmProvider): void {
  const wasOpen = circuitBreakers[provider].openedAt !== null;
  circuitBreakers[provider] = { failures: 0, openedAt: null };
  if (wasOpen) {
    logger.info({ provider }, `[circuit-breaker] ${provider} closed (recovered)`);
  }
}

function recordProviderFailure(provider: LlmProvider): void {
  const state = circuitBreakers[provider];
  state.failures++;
  if (state.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    const wasOpen = state.openedAt !== null;
    state.openedAt = Date.now();
    if (!wasOpen) {
      logger.warn(
        { provider, failures: state.failures },
        `[circuit-breaker] ${provider} opened after ${state.failures} consecutive failures`,
      );
    } else {
      logger.warn(
        { provider, failures: state.failures },
        `[circuit-breaker] ${provider} half-open request failed, cooldown restarted`,
      );
    }
  }
}

function resetCircuitBreaker(provider: LlmProvider): void {
  circuitBreakers[provider] = { failures: 0, openedAt: null };
}

// Exporté pour les tests
export function _resetCircuitBreakersForTesting(): void {
  resetCircuitBreaker('cerebras');
  resetCircuitBreaker('groq');
  resetCircuitBreaker('openrouter');
}

/**
 * Timeout par requête LLM (ms). Si le provider ne répond pas dans ce délai,
 * on abort et on fallback. La valeur est validée dans env.ts.
 */
/**
 * Combine le signal de session avec un timeout par requête.
 * Retourne un signal qui abort si l'un des deux se déclenche.
 */
function withRequestTimeout(sessionSignal?: AbortSignal): AbortSignal {
  // AbortSignal.any est disponible en Node 20+
  const timeoutSignal = AbortSignal.timeout(voiceConfig.VOICE_LLM_TIMEOUT_MS);
  if (!sessionSignal) return timeoutSignal;
  return AbortSignal.any([sessionSignal, timeoutSignal]);
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
    if (session.ending?.timer) clearTimeout(session.ending.timer);
    session.ending?.complete?.();
    session.state = 'IDLE';
    session.isSpeaking = false;
    session.ttsGeneration++;
    session.ttsContext?.cancel();
    session.ttsContext = null;
    if (session.speechFinalTimer) {
      clearTimeout(session.speechFinalTimer);
      session.speechFinalTimer = null;
    }
    if (session.deepgramEndOfTurnTimer) {
      clearTimeout(session.deepgramEndOfTurnTimer);
      session.deepgramEndOfTurnTimer = null;
    }
    session.pendingDeepgramEndOfTurn = null;
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
    if ((session.ended || session.ending) && newState !== 'IDLE' && newState !== 'CLOSING')
      return false;

    const valid: Record<CallState, CallState[]> = {
      IDLE: ['LISTENING', 'SPEAKING', 'CLOSING'],
      LISTENING: ['PROCESSING', 'IDLE', 'CLOSING'],
      PROCESSING: ['SPEAKING', 'LISTENING', 'IDLE', 'CLOSING'],
      SPEAKING: ['LISTENING', 'IDLE', 'CLOSING'],
      CLOSING: ['IDLE'],
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

  /**
   * Fallback humain réellement persisté après deux clarifications de nom
   * infructueuses. Il réutilise le tool de prise de message, plutôt que de
   * prononcer une promesse de transfert sans effet côté restaurant.
   */
  async recordNameSpellingFallback(session: CallSession): Promise<string> {
    return this.executeTool(
      session,
      'takeMessage',
      JSON.stringify({
        customerName: session.conversation.nameCollection?.confirmedName ?? 'Client',
        message:
          "Le client a besoin d'une aide humaine pour confirmer l'orthographe de son nom avant sa réservation.",
        callbackPhone: session.from,
      }),
    );
  }

  /**
   * Résout l'ID primaire du Call à partir du call_leg_id Telnyx.
   *
   * `call_leg_id` est le `callSid` métier du provider, pas la clé étrangère
   * Prisma utilisée par Reservation et Message. Ne jamais le transmettre
   * directement à ces tables : PostgreSQL rejetterait l'écriture (ou, pire,
   * l'idempotence de réservation ne fonctionnerait pas).
   */
  private async resolveCallRecordId(session: CallSession): Promise<string | null> {
    try {
      const call = await db.call.findUnique({
        where: { callSid: session.callLegId },
        select: { id: true, restaurantId: true },
      });

      if (!call) {
        logger.error(
          { callId: session.callControlId, callLegId: session.callLegId },
          '[tool] Call record missing for voice session',
        );
        return null;
      }

      // Defense-in-depth : un call_leg_id ne doit jamais pouvoir être réutilisé
      // pour rattacher une réservation ou un message au mauvais restaurant.
      if (call.restaurantId !== session.restaurantId) {
        logger.error(
          {
            callId: session.callControlId,
            callLegId: session.callLegId,
            callRestaurantId: call.restaurantId,
            sessionRestaurantId: session.restaurantId,
          },
          '[tool] Call record belongs to another restaurant',
        );
        return null;
      }

      return call.id;
    } catch (err) {
      logger.error(
        { err, callId: session.callControlId, callLegId: session.callLegId },
        '[tool] Failed to resolve internal Call record',
      );
      return null;
    }
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
   * Mode simulation sans clé LLM : réponses fixes qui déclenchent
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
        maxTokens: options.maxTokens ?? 200,
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
        const questionEnd = msg.content.indexOf('?');
        const content = questionEnd < 0 ? msg.content : msg.content.slice(0, questionEnd + 1);
        if (options.persistHistory !== false) session.history.push({ role: 'assistant', content });
        return content;
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
   * Fetch LLM completion avec fallback automatique bidirectionnel.
   *
   * - Si VOICE_LLM_PROVIDER=groq :
   *   1. Groq direct (primaire : Qwen 3.8 27B, mode instruct)
   *   2. OpenRouter (fallback : Llama 3.3 70B) sur 402/429/5xx
   * - Si VOICE_LLM_PROVIDER=cerebras (défaut) :
   *   1. Cerebras direct (primaire : Gemma 4 31B, modèle 2026)
   *   2. OpenRouter (fallback : Llama 3.3 70B sur Groq) sur 429/5xx
   * - Si VOICE_LLM_PROVIDER=openrouter :
   *   1. OpenRouter (primaire : Llama 3.3 70B sur Groq, TTFT ~150ms)
   *   2. Cerebras direct (fallback : Gemma 4 31B) sur 429/5xx
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
    if (getVoiceLlmProvider() === 'groq') {
      // Circuit breaker : skip Groq si open
      if (!isCircuitBreakerOpen('groq')) {
        try {
          const response = await this.fetchGroqCompletion(messages, opts, getVoiceLlmModel());
          if (response.ok) {
            recordProviderSuccess('groq');
            return response;
          }
          recordProviderFailure('groq');
          recordLlmHttpError('groq', response.status);
          if (isOpenRouterFallbackEnabled() && isFallbackEligibleError(response.status)) {
            logger.warn(
              { status: response.status, model: getVoiceLlmModel() },
              'LLM primary (Groq) failed, falling back to OpenRouter',
            );
            await response.text().catch(() => {});
            return this.fetchWithFallback(
              'openrouter',
              messages,
              opts,
              getVoiceLlmFallbackModel(),
              false,
              'groq',
            );
          }
          return response;
        } catch (err) {
          // Session abort (barge-in, raccroché) — pas de failure ni fallback.
          if (isSessionAbortError(err, opts.signal)) {
            recordLlmException('groq', err, opts.signal);
            throw err;
          }
          recordProviderFailure('groq');
          recordLlmException('groq', err, opts.signal);
          if (isOpenRouterFallbackEnabled()) {
            logger.warn(
              { err: err instanceof Error ? err.message : String(err) },
              'LLM primary (Groq) network error, falling back to OpenRouter',
            );
            return this.fetchWithFallback(
              'openrouter',
              messages,
              opts,
              getVoiceLlmFallbackModel(),
              false,
              'groq',
            );
          }
          throw err;
        }
      }
      // Circuit breaker open → skip directly to OpenRouter
      logger.warn({ provider: 'groq' }, '[circuit-breaker] Groq skipped (open), using OpenRouter');
      return this.fetchWithFallback(
        'openrouter',
        messages,
        opts,
        getVoiceLlmFallbackModel(),
        false,
        'groq',
      );
    }

    const useCerebrasPrimary = getVoiceLlmProvider() === 'cerebras';

    if (useCerebrasPrimary) {
      // Circuit breaker : skip Cerebras si open
      if (!isCircuitBreakerOpen('cerebras')) {
        try {
          const response = await this.fetchCerebrasCompletion(messages, opts, getVoiceLlmModel());
          if (response.ok) {
            recordProviderSuccess('cerebras');
            return response;
          }
          // HTTP error — record failure, check fallback eligibility
          recordProviderFailure('cerebras');
          recordLlmHttpError('cerebras', response.status);
          if (isOpenRouterFallbackEnabled() && isFallbackEligibleError(response.status)) {
            logger.warn(
              { status: response.status, model: getVoiceLlmModel() },
              'LLM primary (Cerebras) failed, falling back to OpenRouter',
            );
            await response.text().catch(() => {});
            return this.fetchWithFallback(
              'openrouter',
              messages,
              opts,
              getVoiceLlmFallbackModel(),
              false,
            );
          }
          return response;
        } catch (err) {
          // Session abort (barge-in, raccroché) — pas de failure ni fallback.
          if (isSessionAbortError(err, opts.signal)) {
            recordLlmException('cerebras', err, opts.signal);
            throw err;
          }
          // Network error / timeout — record failure, fallback
          recordProviderFailure('cerebras');
          recordLlmException('cerebras', err, opts.signal);
          if (isOpenRouterFallbackEnabled()) {
            logger.warn(
              { err: err instanceof Error ? err.message : String(err) },
              'LLM primary (Cerebras) network error, falling back to OpenRouter',
            );
            return this.fetchWithFallback(
              'openrouter',
              messages,
              opts,
              getVoiceLlmFallbackModel(),
              false,
            );
          }
          throw err;
        }
      }
      // Circuit breaker open → skip directly to OpenRouter
      logger.warn(
        { provider: 'cerebras' },
        '[circuit-breaker] Cerebras skipped (open), using OpenRouter',
      );
      return this.fetchWithFallback(
        'openrouter',
        messages,
        opts,
        getVoiceLlmFallbackModel(),
        false,
      );
    }

    // OpenRouter primary, Cerebras fallback
    if (!isCircuitBreakerOpen('openrouter')) {
      try {
        const response = await this.fetchOpenRouterCompletion(messages, opts, getVoiceLlmModel());
        if (response.ok) {
          recordProviderSuccess('openrouter');
          return response;
        }
        recordProviderFailure('openrouter');
        recordLlmHttpError('openrouter', response.status);
        if (isCerebrasFallbackEnabled() && isFallbackEligibleError(response.status)) {
          logger.warn(
            { status: response.status, model: getVoiceLlmModel() },
            'LLM primary (OpenRouter) failed, falling back to Cerebras',
          );
          await response.text().catch(() => {});
          return this.fetchWithFallback(
            'cerebras',
            messages,
            opts,
            getVoiceLlmFallbackModel(),
            false,
          );
        }
        return response;
      } catch (err) {
        // Session abort (barge-in, raccroché) — pas de failure ni fallback.
        if (isSessionAbortError(err, opts.signal)) {
          recordLlmException('openrouter', err, opts.signal);
          throw err;
        }
        recordProviderFailure('openrouter');
        recordLlmException('openrouter', err, opts.signal);
        if (isCerebrasFallbackEnabled()) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'LLM primary (OpenRouter) network error, falling back to Cerebras',
          );
          return this.fetchWithFallback(
            'cerebras',
            messages,
            opts,
            getVoiceLlmFallbackModel(),
            false,
          );
        }
        throw err;
      }
    }
    logger.warn(
      { provider: 'openrouter' },
      '[circuit-breaker] OpenRouter skipped (open), using Cerebras',
    );
    return this.fetchWithFallback('cerebras', messages, opts, getVoiceLlmFallbackModel(), false);
  }

  /**
   * Fetch LLM completion via Cerebras direct API.
   * Utilise Gemma 4 (temp=1.0, top_p=0.95 recommandés sur Cerebras).
   */
  private async fetchCerebrasCompletion(
    messages: ChatMessage[],
    opts: {
      tools?: ReturnType<typeof getRestaurantTools>;
      maxTokens: number;
      temperature: number;
      signal?: AbortSignal;
    },
    model: string,
  ): Promise<Response> {
    const body = {
      model,
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
        Authorization: `Bearer ${voiceConfig.CEREBRAS_API_KEY}`,
      },
      signal: withRequestTimeout(opts.signal),
      body: JSON.stringify(body),
    });
  }

  /**
   * Fetch LLM completion via Groq direct API.
   * Qwen 3.8 est utilisé en mode instruct (reasoning désactivé) afin de
   * préserver le temps de réponse vocal ; le modèle supporte le tool use.
   */
  private async fetchGroqCompletion(
    messages: ChatMessage[],
    opts: {
      tools?: ReturnType<typeof getRestaurantTools>;
      maxTokens: number;
      temperature: number;
      signal?: AbortSignal;
    },
    model: string,
  ): Promise<Response> {
    const body = {
      model,
      messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      top_p: 0.8,
      // Qwen 3.8 est par défaut en mode instruct ; l'expliciter évite qu'une
      // modification du défaut fournisseur ne fasse remonter des tokens de raisonnement.
      reasoning_effort: 'none',
      ...(opts.tools ? { tools: opts.tools, tool_choice: 'auto' } : {}),
    };

    return fetch(`${getGroqBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${voiceConfig.GROQ_API_KEY}`,
      },
      signal: withRequestTimeout(opts.signal),
      body: JSON.stringify(body),
    });
  }

  /**
   * Fetch LLM completion via OpenRouter.
   */
  private async fetchOpenRouterCompletion(
    messages: ChatMessage[],
    opts: {
      tools?: ReturnType<typeof getRestaurantTools>;
      maxTokens: number;
      temperature: number;
      signal?: AbortSignal;
    },
    model: string,
  ): Promise<Response> {
    const body = {
      model,
      messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      ...(opts.tools ? { tools: opts.tools, tool_choice: 'auto' } : {}),
      ...(getProviderRouting(model) ?? {}),
    };

    return fetch(`${getOpenRouterBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${voiceConfig.OPENROUTER_API_KEY}`,
      },
      signal: withRequestTimeout(opts.signal),
      body: JSON.stringify(body),
    });
  }

  /**
   * Fetch LLM streaming response avec fallback automatique bidirectionnel.
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
  ): Promise<{ response: Response; provider: LlmProvider }> {
    if (getVoiceLlmProvider() === 'groq') {
      // Circuit breaker : skip Groq si open
      if (!isCircuitBreakerOpen('groq')) {
        try {
          const response = await this.fetchGroqStreaming(messages, opts, getVoiceLlmModel());
          if (response.ok) {
            recordProviderSuccess('groq');
            return { response, provider: 'groq' };
          }
          recordProviderFailure('groq');
          recordLlmHttpError('groq', response.status);
          if (isOpenRouterFallbackEnabled() && isFallbackEligibleError(response.status)) {
            logger.warn(
              { status: response.status, model: getVoiceLlmModel() },
              'LLM streaming primary (Groq) failed, falling back to OpenRouter',
            );
            await response.text().catch(() => {});
            const fallbackResponse = await this.fetchWithFallback(
              'openrouter',
              messages,
              opts,
              getVoiceLlmFallbackModel(),
              true,
              'groq',
            );
            return { response: fallbackResponse, provider: 'openrouter' };
          }
          return { response, provider: 'groq' };
        } catch (err) {
          // Session abort (barge-in, raccroché) — pas de failure ni fallback.
          if (isSessionAbortError(err, opts.signal)) {
            recordLlmException('groq', err, opts.signal);
            throw err;
          }
          recordProviderFailure('groq');
          recordLlmException('groq', err, opts.signal);
          if (isOpenRouterFallbackEnabled()) {
            logger.warn(
              { err: err instanceof Error ? err.message : String(err) },
              'LLM streaming primary (Groq) network error, falling back to OpenRouter',
            );
            const fallbackResponse = await this.fetchWithFallback(
              'openrouter',
              messages,
              opts,
              getVoiceLlmFallbackModel(),
              true,
              'groq',
            );
            return { response: fallbackResponse, provider: 'openrouter' };
          }
          throw err;
        }
      }
      // Circuit breaker open → skip directement à OpenRouter
      logger.warn({ provider: 'groq' }, '[circuit-breaker] Groq skipped (open), using OpenRouter');
      const fallbackResponse = await this.fetchWithFallback(
        'openrouter',
        messages,
        opts,
        getVoiceLlmFallbackModel(),
        true,
        'groq',
      );
      return { response: fallbackResponse, provider: 'openrouter' };
    }

    const useCerebrasPrimary = getVoiceLlmProvider() === 'cerebras';

    if (useCerebrasPrimary) {
      // Circuit breaker : skip Cerebras si open
      if (!isCircuitBreakerOpen('cerebras')) {
        try {
          const response = await this.fetchCerebrasStreaming(messages, opts, getVoiceLlmModel());
          if (response.ok) {
            recordProviderSuccess('cerebras');
            return { response, provider: 'cerebras' };
          }
          // HTTP error — record failure, check fallback eligibility
          recordProviderFailure('cerebras');
          recordLlmHttpError('cerebras', response.status);
          if (isOpenRouterFallbackEnabled() && isFallbackEligibleError(response.status)) {
            logger.warn(
              { status: response.status, model: getVoiceLlmModel() },
              'LLM streaming primary (Cerebras) failed, falling back to OpenRouter',
            );
            await response.text().catch(() => {});
            const fallbackResponse = await this.fetchWithFallback(
              'openrouter',
              messages,
              opts,
              getVoiceLlmFallbackModel(),
              true,
            );
            return { response: fallbackResponse, provider: 'openrouter' };
          }
          return { response, provider: 'cerebras' };
        } catch (err) {
          // Session abort (barge-in, raccroché) — pas de failure ni fallback.
          if (isSessionAbortError(err, opts.signal)) {
            recordLlmException('cerebras', err, opts.signal);
            throw err;
          }
          // Network error / timeout — record failure, fallback
          recordProviderFailure('cerebras');
          recordLlmException('cerebras', err, opts.signal);
          if (isOpenRouterFallbackEnabled()) {
            logger.warn(
              { err: err instanceof Error ? err.message : String(err) },
              'LLM streaming primary (Cerebras) network error, falling back to OpenRouter',
            );
            const fallbackResponse = await this.fetchWithFallback(
              'openrouter',
              messages,
              opts,
              getVoiceLlmFallbackModel(),
              true,
            );
            return { response: fallbackResponse, provider: 'openrouter' };
          }
          throw err;
        }
      }
      // Circuit breaker open → skip directly to OpenRouter
      logger.warn(
        { provider: 'cerebras' },
        '[circuit-breaker] Cerebras skipped (open), using OpenRouter',
      );
      const fallbackResponse = await this.fetchWithFallback(
        'openrouter',
        messages,
        opts,
        getVoiceLlmFallbackModel(),
        true,
      );
      return { response: fallbackResponse, provider: 'openrouter' };
    }

    // OpenRouter primary, Cerebras fallback
    if (!isCircuitBreakerOpen('openrouter')) {
      try {
        const response = await this.fetchOpenRouterStreaming(messages, opts, getVoiceLlmModel());
        if (response.ok) {
          recordProviderSuccess('openrouter');
          return { response, provider: 'openrouter' };
        }
        recordProviderFailure('openrouter');
        recordLlmHttpError('openrouter', response.status);
        if (isCerebrasFallbackEnabled() && isFallbackEligibleError(response.status)) {
          logger.warn(
            { status: response.status, model: getVoiceLlmModel() },
            'LLM streaming primary (OpenRouter) failed, falling back to Cerebras',
          );
          await response.text().catch(() => {});
          const fallbackResponse = await this.fetchWithFallback(
            'cerebras',
            messages,
            opts,
            getVoiceLlmFallbackModel(),
            true,
          );
          return { response: fallbackResponse, provider: 'cerebras' };
        }
        return { response, provider: 'openrouter' };
      } catch (err) {
        // Session abort (barge-in, raccroché) — pas de failure ni fallback.
        if (isSessionAbortError(err, opts.signal)) {
          recordLlmException('openrouter', err, opts.signal);
          throw err;
        }
        recordProviderFailure('openrouter');
        recordLlmException('openrouter', err, opts.signal);
        if (isCerebrasFallbackEnabled()) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'LLM streaming primary (OpenRouter) network error, falling back to Cerebras',
          );
          const fallbackResponse = await this.fetchWithFallback(
            'cerebras',
            messages,
            opts,
            getVoiceLlmFallbackModel(),
            true,
          );
          return { response: fallbackResponse, provider: 'cerebras' };
        }
        throw err;
      }
    }
    logger.warn(
      { provider: 'openrouter' },
      '[circuit-breaker] OpenRouter skipped (open), using Cerebras',
    );
    const fallbackResponse = await this.fetchWithFallback(
      'cerebras',
      messages,
      opts,
      getVoiceLlmFallbackModel(),
      true,
    );
    return { response: fallbackResponse, provider: 'cerebras' };
  }

  /**
   * Fetch via le provider de fallback avec circuit breaker + timeout.
   * Si le fallback échoue aussi, on relance l'erreur (pas de retry supplémentaire).
   */
  private async fetchWithFallback(
    provider: LlmProvider,
    messages: ChatMessage[],
    opts: {
      tools?: ReturnType<typeof getRestaurantTools>;
      maxTokens: number;
      temperature: number;
      signal?: AbortSignal;
    },
    model: string,
    isStreaming: boolean = false,
    sourceProvider?: LlmProvider,
  ): Promise<Response> {
    // Métrique : compter tous les fallbacks LLM (tous les chemins de fallback
    // passent par ici). La direction est déduite du provider cible.
    const source = sourceProvider ?? (provider === 'openrouter' ? 'cerebras' : 'openrouter');
    voiceLlmFallbackTotal.inc({ direction: `${source}_to_${provider}` });

    if (isCircuitBreakerOpen(provider)) {
      // Le fallback est aussi en circuit breaker — on tente quand même (half-open)
      // car on n'a pas d'autre option. Si ça échoue, l'erreur remonte.
      logger.warn(
        { provider },
        `[circuit-breaker] Fallback ${provider} is open, attempting half-open request`,
      );
    }
    try {
      const response = isStreaming
        ? provider === 'cerebras'
          ? await this.fetchCerebrasStreaming(messages, opts, model)
          : provider === 'groq'
            ? await this.fetchGroqStreaming(messages, opts, model)
            : await this.fetchOpenRouterStreaming(messages, opts, model)
        : provider === 'cerebras'
          ? await this.fetchCerebrasCompletion(messages, opts, model)
          : provider === 'groq'
            ? await this.fetchGroqCompletion(messages, opts, model)
            : await this.fetchOpenRouterCompletion(messages, opts, model);
      if (response.ok) {
        recordProviderSuccess(provider);
      } else {
        recordProviderFailure(provider);
        recordLlmHttpError(provider, response.status);
      }
      return response;
    } catch (err) {
      recordProviderFailure(provider);
      recordLlmException(provider, err, opts.signal);
      throw err;
    }
  }

  /**
   * Fetch LLM streaming via Cerebras direct API.
   */
  private async fetchCerebrasStreaming(
    messages: ChatMessage[],
    opts: {
      tools?: ReturnType<typeof getRestaurantTools>;
      maxTokens: number;
      temperature: number;
      signal?: AbortSignal;
    },
    model: string,
  ): Promise<Response> {
    const body = {
      model,
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
        Authorization: `Bearer ${voiceConfig.CEREBRAS_API_KEY}`,
      },
      signal: withRequestTimeout(opts.signal),
      body: JSON.stringify(body),
    });
  }

  /**
   * Fetch LLM streaming via Groq direct API.
   */
  private async fetchGroqStreaming(
    messages: ChatMessage[],
    opts: {
      tools?: ReturnType<typeof getRestaurantTools>;
      maxTokens: number;
      temperature: number;
      signal?: AbortSignal;
    },
    model: string,
  ): Promise<Response> {
    const body = {
      model,
      messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      top_p: 0.8,
      reasoning_effort: 'none',
      ...(opts.tools ? { tools: opts.tools, tool_choice: 'auto' } : {}),
      stream: true,
    };

    return fetch(`${getGroqBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${voiceConfig.GROQ_API_KEY}`,
      },
      signal: withRequestTimeout(opts.signal),
      body: JSON.stringify(body),
    });
  }

  /**
   * Fetch LLM streaming via OpenRouter.
   */
  private async fetchOpenRouterStreaming(
    messages: ChatMessage[],
    opts: {
      tools?: ReturnType<typeof getRestaurantTools>;
      maxTokens: number;
      temperature: number;
      signal?: AbortSignal;
    },
    model: string,
  ): Promise<Response> {
    const body = {
      model,
      messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      ...(opts.tools ? { tools: opts.tools, tool_choice: 'auto' } : {}),
      stream: true,
      ...(getProviderRouting(model) ?? {}),
    };

    return fetch(`${getOpenRouterBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${voiceConfig.OPENROUTER_API_KEY}`,
      },
      signal: withRequestTimeout(opts.signal),
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
      const { response, provider: providerUsed } = await this.fetchLlmStreaming(messages, {
        tools,
        maxTokens: options.maxTokens ?? 200,
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
      let phrasesYielded = false;
      let midStreamTimedOut = false;
      let questionReached = false;
      const emitCompletePhrases = () => {
        let match: RegExpMatchArray | null;
        while ((match = sentenceBuffer.match(/^([\s\S]+?(?:\?|[.!](?=\s|$)))\s*/))) {
          const phrase = match[1].trim();
          sentenceBuffer = sentenceBuffer.slice(match[0].length);
          if (!phrase) continue;
          phrasesYielded = true;
          Promise.resolve(onPhrase(phrase)).catch((err) =>
            logger.error({ err }, 'onPhrase failed in LLM stream'),
          );
          if (phrase.endsWith('?')) {
            questionReached = true;
            fullText = fullText.slice(0, fullText.indexOf('?') + 1);
            sentenceBuffer = '';
            break;
          }
        }
      };
      const toolCallAccumulator: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }> = [];

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

              // Accumuler les deltas de tool_call au lieu de réémettre un appel non-streaming
              if (delta.tool_calls) {
                hasToolCall = true;
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  if (!toolCallAccumulator[idx]) {
                    toolCallAccumulator[idx] = {
                      id: tc.id ?? '',
                      type: tc.type ?? 'function',
                      function: {
                        name: tc.function?.name ?? '',
                        arguments: tc.function?.arguments ?? '',
                      },
                    };
                  } else {
                    // Delta subséquent : concaténer les arguments
                    if (tc.function?.name)
                      toolCallAccumulator[idx].function.name = tc.function.name;
                    if (tc.function?.arguments)
                      toolCallAccumulator[idx].function.arguments += tc.function.arguments;
                    if (tc.id) toolCallAccumulator[idx].id = tc.id;
                  }
                }
                // NE PAS break — continuer à lire le stream pour accumuler tous les deltas
                // NE PAS continue — un delta peut contenir à la fois tool_calls et content.
                // On laisse le code traiter delta.content ci-dessous.
              }

              const token = delta.content ?? '';
              if (!token) continue;

              sentenceBuffer += token;
              fullText += token;

              emitCompletePhrases();
              if (questionReached) break;
            } catch {
              // Ignorer les lignes mal formées
            }
          }
          if (questionReached) {
            await reader.cancel().catch(() => undefined);
            break;
          }
        }
      } catch (streamErr) {
        // Timeout mid-stream ou autre erreur réseau pendant la lecture du stream
        if (streamErr instanceof Error && streamErr.name === 'AbortError') {
          // Si la session elle-même a été abortée (raccroché, barge-in),
          // ne pas retry — l'appel est terminé, retry gaspillerait des appels API.
          // withRequestTimeout combine le signal de session avec un signal de timeout ;
          // quand seul le timeout fire, signal?.aborted est false.
          if (signal?.aborted) {
            throw streamErr;
          }
          // Le timeout a fire (pas la session) → retry sur l'autre provider
          // Record failure for circuit breaker
          recordProviderFailure(providerUsed);

          if (!phrasesYielded && !fullText.trim() && !hasToolCall) {
            // Aucun audio envoyé à l'utilisateur et aucun tool call commencé
            // → on peut retry sur l'autre provider
            logger.warn(
              { provider: providerUsed, callId: session.callControlId },
              `[stream] Mid-stream timeout on ${providerUsed}, no audio sent yet — retrying with fallback provider`,
            );
            // Retry avec l'autre provider
            const fallbackProvider = getFallbackProvider(providerUsed);
            const fallbackModel = getVoiceLlmFallbackModel();
            const retryResponse = await this.fetchWithFallback(
              fallbackProvider,
              messages,
              {
                tools,
                maxTokens: options.maxTokens ?? 200,
                temperature: options.temperature ?? 0.7,
                signal,
              },
              fallbackModel,
              true,
              providerUsed,
            );

            if (!retryResponse.ok) {
              throw new Error(`LLM ${retryResponse.status}: ${await retryResponse.text()}`);
            }
            if (!retryResponse.body) {
              throw new Error('LLM response body is null');
            }

            // Lire le stream de retry avec le même parser
            const retryReader = retryResponse.body.getReader();
            try {
              while (true) {
                const { done: retryDone, value: retryValue } = await retryReader.read();
                if (retryDone) break;
                buffer += decoder.decode(retryValue, { stream: true });
                const retryLines = buffer.split('\n');
                buffer = retryLines.pop() ?? '';
                for (const line of retryLines) {
                  const trimmed = line.trim();
                  if (!trimmed.startsWith('data: ')) continue;
                  const data = trimmed.slice(6);
                  if (data === '[DONE]') break;
                  try {
                    const chunk = JSON.parse(data);
                    const delta = chunk.choices?.[0]?.delta;
                    if (!delta) continue;
                    if (delta.tool_calls) {
                      hasToolCall = true;
                      for (const tc of delta.tool_calls) {
                        const idx = tc.index ?? 0;
                        if (!toolCallAccumulator[idx]) {
                          toolCallAccumulator[idx] = {
                            id: tc.id ?? '',
                            type: tc.type ?? 'function',
                            function: {
                              name: tc.function?.name ?? '',
                              arguments: tc.function?.arguments ?? '',
                            },
                          };
                        } else {
                          if (tc.function?.name)
                            toolCallAccumulator[idx].function.name = tc.function.name;
                          if (tc.function?.arguments)
                            toolCallAccumulator[idx].function.arguments += tc.function.arguments;
                          if (tc.id) toolCallAccumulator[idx].id = tc.id;
                        }
                      }
                    }
                    const token = delta.content ?? '';
                    if (!token) continue;
                    sentenceBuffer += token;
                    fullText += token;
                    emitCompletePhrases();
                    if (questionReached) break;
                  } catch {
                    // Ignorer les lignes mal formées
                  }
                }
                if (questionReached) {
                  await retryReader.cancel().catch(() => undefined);
                  break;
                }
              }
            } finally {
              retryReader.releaseLock();
            }
          } else {
            // Du texte a déjà été envoyé à l'utilisateur → on ne peut pas retry
            // (l'utilisateur entendrait du doublon). On retourne ce qu'on a.
            midStreamTimedOut = true;
            logger.warn(
              {
                provider: providerUsed,
                callId: session.callControlId,
                partialTextLength: fullText.length,
              },
              `[stream] Mid-stream timeout on ${providerUsed}, ${phrasesYielded ? 'audio already sent' : 'text accumulated'} — returning partial response`,
            );
          }
        } else {
          // Non-AbortError — rethrow
          throw streamErr;
        }
      } finally {
        reader.releaseLock();
      }

      if (questionReached) {
        signal?.throwIfAborted();
        session.history.push({ role: 'assistant', content: fullText.trim() });
        return fullText.trim();
      }

      // Yield le reste du buffer s'il reste quelque chose
      if (sentenceBuffer.trim()) {
        phrasesYielded = true;
        await onPhrase(sentenceBuffer.trim());
      }

      if (hasToolCall && !midStreamTimedOut) {
        // Reconstruire les tool calls depuis les deltas accumulés
        const toolCalls = toolCallAccumulator.filter((tc) => tc.function.name); // ignorer les entrées vides
        if (toolCalls.length === 0) {
          // Aucun tool call valide — traiter comme texte normal
          if (fullText.trim()) {
            session.history.push({ role: 'assistant', content: fullText.trim() });
          }
          return fullText.trim();
        }

        // Log warning si les arguments semblent incomplets (stream interrompu ?)
        for (const tc of toolCalls) {
          if (!tc.function.arguments || !tc.function.arguments.trim()) {
            logger.warn(
              { toolName: tc.function.name, callId: session.callControlId },
              '[stream] Tool call reçu avec arguments vides — possible stream interrompu',
            );
          }
        }

        // Construire le message assistant avec les tool calls reconstruits
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: fullText.trim(),
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: tc.type,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        };
        session.history.push(assistantMsg);
        messages.push(assistantMsg);

        // Exécuter les tools directement (pas de réémission non-streaming)
        for (const tc of toolCalls) {
          signal?.throwIfAborted();
          const result = await this.executeTool(session, tc.function.name, tc.function.arguments);
          signal?.throwIfAborted();
          const toolMsg: ChatMessage = { role: 'tool', tool_call_id: tc.id, content: result };
          session.history.push(toolMsg);
          messages.push(toolMsg);
        }
        continue; // round suivant — le LLM recevra les résultats des tools
      }

      if (midStreamTimedOut) {
        // Timeout mid-stream avec audio déjà envoyé — retourner le texte partiel
        // sans exécuter les tool calls potentiellement incomplets
        if (fullText.trim()) {
          session.history.push({ role: 'assistant', content: fullText.trim() });
        }
        return fullText.trim();
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
    if (session.ending || session.ended) return 'Appel terminé.';
    try {
      const validated = validateToolArgs(name, argsJson);
      if (!validated.success) {
        logger.warn(
          { toolName: name, error: validated.error, callId: session.callControlId },
          '[tool] Zod validation rejected tool args',
        );
        return "Je n'ai pas pu comprendre les informations transmises. Pouvez-vous reformuler ?";
      }
      const args = validated.data as Record<string, any>;

      switch (name) {
        case 'createReservation': {
          const { date, time, partySize, customerName, customerPhone } = args;

          // Même si un provider LLM contourne la réponse déterministe, une
          // épellation en attente ne doit jamais déclencher d'effet métier.
          if (
            isNameCollectionBlocking(session) ||
            session.conversation.nameCollection?.fallbackRecorded
          ) {
            return "Je dois d'abord confirmer l'orthographe de votre nom. Pouvez-vous me redonner les lettres, s'il vous plaît ?";
          }

          // Le nom confirmé par notre garde déterministe est la source de
          // vérité ; il ne peut pas être réécrit en mot plausible par le LLM.
          const confirmedCustomerName =
            session.conversation.nameCollection?.confirmedName ??
            session.conversation.slots.customerName;
          const reservationCustomerName = confirmedCustomerName ?? customerName ?? 'Client';

          try {
            const callRecordId = await this.resolveCallRecordId(session);
            if (!callRecordId) {
              return "Je n'ai pas pu rattacher cet appel à la réservation. Je vais vous transférer au gérant.";
            }

            await ReservationService.create({
              restaurantId: session.restaurantId,
              callId: callRecordId,
              reservedAt: new Date(`${date}T${time}`),
              partySize: partySize ?? 1,
              customerName: reservationCustomerName,
              customerPhone: customerPhone ?? session.from,
            });

            return `Réservation confirmée pour ${reservationCustomerName}, le ${date} à ${time}, pour ${partySize ?? 1} personne(s). Un SMS de confirmation va être envoyé au client.`;
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
          const { customerName, date, time } = args;

          try {
            // Trouver la réservation par nom + date
            const dayStart = new Date(`${date}T00:00:00`);
            const dayEnd = new Date(`${date}T23:59:59`);

            // Requête volontairement large (contains+insensitive) pour capter les
            // variations STT ; l'affinage se fait en JS ci-dessous.
            const reservations = await db.reservation.findMany({
              where: {
                restaurantId: session.restaurantId,
                customerName: { contains: customerName, mode: 'insensitive' },
                reservedAt: { gte: dayStart, lte: dayEnd },
                // `state` porte la sémantique métier. Une demande PENDING
                // reste annulable, tandis que les états terminaux ne doivent
                // pas être proposés comme réservation active.
                state: { in: ['PENDING', 'CONFIRMED'] },
              },
              select: { id: true, customerName: true, customerPhone: true, reservedAt: true },
            });

            if (reservations.length === 0) {
              return `Je n'ai trouvé aucune réservation au nom de ${customerName} pour le ${date}. Vérifiez l'orthographe du nom ou la date.`;
            }

            // Cas simple : une seule réservation → on annule uniquement si le nom
            // correspond sûrement (contains est large — "Jean" peut matcher "Jean Dupont").
            if (reservations.length === 1) {
              if (isSafeVoiceNameMatch(customerName, reservations[0].customerName)) {
                await ReservationService.update(reservations[0].id, session.restaurantId, {
                  status: 'CANCELLED',
                });
                return `J'ai bien annulé la réservation de ${customerName} pour le ${date}. Un message de confirmation sera envoyé.`;
              }
              // Le nom ne correspond pas sûrement → transférer au gérant
              return `Je n'ai pas pu identifier votre réservation avec certitude. Je vous transfère au gérant qui pourra s'en occuper.`;
            }

            // Plusieurs réservations au même nom → résolution progressive
            // (même pattern que reportDelay) : téléphone appelant, puis nom sûr,
            // puis heure exacte. Si toujours ambigu → handoff au gérant, pas d'annulation.
            const callerPhone = normalizeVoicePhone(session.from);
            let resolved: { id: string } | null = null;

            // 1. Téléphone appelant
            if (callerPhone) {
              const phoneMatches = reservations.filter(
                (r) => normalizeVoicePhone(r.customerPhone) === callerPhone,
              );
              if (phoneMatches.length === 1) {
                resolved = { id: phoneMatches[0].id };
              }
            }

            // 2. Nom sûr (au moins 2 mots correspondants)
            if (!resolved) {
              const safeNameMatches = reservations.filter((r) =>
                isSafeVoiceNameMatch(customerName, r.customerName),
              );
              if (safeNameMatches.length === 1) {
                resolved = { id: safeNameMatches[0].id };
              }
            }

            // 3. Heure exacte si fournie — comparaison dans la timezone du restaurant
            // (le LLM fournit l'heure locale, pas UTC).
            if (!resolved && time) {
              const restaurant = await db.restaurant.findUnique({
                where: { id: session.restaurantId },
                select: { timezone: true },
              });
              const timeZone = restaurant?.timezone ?? 'Europe/Paris';
              const formatter = new Intl.DateTimeFormat('fr-FR', {
                timeZone,
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              });
              const timeMatches = reservations.filter((r) => {
                const reservationTime = formatter.format(r.reservedAt);
                return reservationTime === time;
              });
              if (timeMatches.length === 1) {
                resolved = { id: timeMatches[0].id };
              }
            }

            // 4. Résolu de manière unique → on annule
            if (resolved) {
              logger.info(
                { callId: session.callControlId, reservationId: resolved.id, strategy: 'cancel' },
                '[tool] cancelReservation resolved ambiguous match',
              );
              await ReservationService.update(resolved.id, session.restaurantId, {
                status: 'CANCELLED',
              });
              return `J'ai bien annulé la réservation de ${customerName} pour le ${date}. Un message de confirmation sera envoyé.`;
            }

            // 5. Toujours ambigu → transfert au gérant, PAS d'annulation
            return `J'ai trouvé plusieurs réservations au nom de ${customerName} pour le ${date}. Pour éviter d'annuler la mauvaise, je vous transfère au gérant qui pourra s'en occuper.`;
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
                extra: { callId: session.callControlId, date },
              });
            }
            return `Désolé, une erreur est survenue lors de l'annulation. Je vais vous transférer au gérant qui pourra s'en occuper.`;
          }
        }

        case 'takeMessage': {
          const { customerName, message, callbackPhone } = args;

          try {
            const callRecordId = await this.resolveCallRecordId(session);
            if (!callRecordId) {
              return "Je n'ai pas pu rattacher votre message à cet appel. Je vais vous transférer au gérant.";
            }

            await db.message.create({
              data: {
                restaurantId: session.restaurantId,
                callId: callRecordId,
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
                extra: { callId: session.callControlId },
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
          extra: { callId: session.callControlId },
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

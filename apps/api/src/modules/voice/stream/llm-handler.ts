/**
 * Logique LLM (Deepgram Flux) — gestion des événements Flux, traitement
 * des transcripts, spéculation LLM, et orchestration TTS.
 *
 * Extrait de handler.ts. Ces fonctions prennent une CallSession et un
 * CallSessionManager en paramètres. Elles mutent l'état de la session
 * (state, speculativeLlm, transcript, etc.) mais c'est le design
 * existant — le handler principal délègue en passant la session par
 * référence.
 */

import { WebSocket } from 'ws';
import type { FluxEvent, CallSession } from './types';
import type { CallSessionManager } from './manager';
import { playFiller } from './fillers-cache';
import { logger } from '../../../shared/logger/pino';
import { captureException } from '../../../shared/sentry/client';
import { writeDebugLog } from './debug-log';
import { cleanTextForTts, isSessionActiveForTts, speakTtsStreamed } from './tts-handler';
import {
  createCartesiaContextTurn,
  isCartesiaContextV2Enabled,
  type CartesiaContextTurn,
} from './cartesia-context';
import {
  recordVoiceTurnClassification,
  recordVoiceTurnEvent,
  startVoiceTurn,
} from './turn-telemetry';
import { isVoiceTtsContextV2Enabled } from '../../../shared/configcat';
import { TRANSCRIPT_DEDUPE_WINDOW_MS } from '../../../shared/constants/timeouts.js';
import {
  buildAvailabilityReply,
  buildDeterministicTurnResponse,
  classifyVoiceSpeechAct,
  getReadyAvailabilityRequest,
  recordAssistantReply,
  recordUserTurn,
} from './conversation-controller';

const recentTranscripts = new WeakMap<CallSession, { normalized: string; at: number }>();
export const LLM_FILLER_DELAY_MS = 1_000;

export function normalizeTranscriptForDedupe(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function shouldSkipDuplicateTranscript(session: CallSession, transcript: string): boolean {
  const normalized = normalizeTranscriptForDedupe(transcript);
  if (!normalized) return true;

  const previous = recentTranscripts.get(session);
  const now = Date.now();
  if (
    previous &&
    previous.normalized === normalized &&
    now - previous.at < TRANSCRIPT_DEDUPE_WINDOW_MS
  ) {
    return true;
  }

  recentTranscripts.set(session, { normalized, at: now });
  return false;
}

export function extractRestaurantName(systemPrompt: string): string {
  return systemPrompt
    .split('\n')[0]
    .replace(/^Tu es l'hôte d'accueil et assistant vocal chaleureux de /, '')
    .replace(/^Tu es l'assistant vocal (?:chaleureux )?de /, '')
    .replace(/\.$/, '')
    .trim();
}

export function stripRepeatedGreeting(text: string, session: CallSession): string {
  const restaurantName = extractRestaurantName(session.systemPrompt);
  const escapedName = restaurantName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const greetingPattern = new RegExp(
    `^\\s*Bonjour\\s*,?\\s*${escapedName}\\s*[,!.]?\\s*(?:Cet\\s+appel\\s+(?:peut\\s+être|est)\\s+enregistré[^.!?]*[.!?]\\s*)?(?:En\\s+quoi\\s+puis-je\\s+vous\\s+aider\\s*\\??)?\\s*`,
    'i',
  );

  return text
    .replace(greetingPattern, '')
    .replace(/^\s*Bonjour\s*[!,.:]?\s*/i, '')
    .replace(/^\s*En\s+quoi\s+puis-je\s+vous\s+aider\s*\?\s*/i, '')
    .trim();
}

/**
 * Réponse déterministe aux vérifications de présence en milieu d'appel.
 * Un « allô ? » isolé n'est pas une nouvelle intention : laisser le LLM le
 * traiter comme telle lui fait parfois rejouer la formule d'accueil.
 */
export function buildLivenessResponse(session: CallSession, transcript: string): string | null {
  const normalized = transcript
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const isLivenessCheck = /^(?:allo+|vous etes(?: toujours)? la|vous m entendez|ca a coupe)$/u.test(
    normalized,
  );
  if (!isLivenessCheck) return null;

  const lastAssistantMessage = [...session.history]
    .reverse()
    .find((message) => message.role === 'assistant' && message.content.trim())?.content;
  if (!lastAssistantMessage) return null;

  const lastQuestion = lastAssistantMessage.match(/(?:^|[.!]\s*)([^.?!]+\?)\s*$/u)?.[1]?.trim();
  return lastQuestion ? `Oui, je suis là. ${lastQuestion}` : 'Oui, je suis là. Je vous écoute.';
}

/**
 * Vérifie si deux transcripts sont suffisamment proches pour
 * réutiliser un résultat LLM spéculatif.
 *
 * Algorithme : le plus court des deux doit avoir 80%+ de ses mots
 * présents dans le plus long, avec le même ordre.
 * Ça évite les hallucinations sur les transcripts qui changent beaucoup.
 */
export function transcriptsMatch(a: string, b: string): boolean {
  const wordsA = a.toLowerCase().split(/\s+/);
  const wordsB = b.toLowerCase().split(/\s+/);
  const shorter = wordsA.length <= wordsB.length ? wordsA : wordsB;
  const longer = wordsA.length > wordsB.length ? wordsA : wordsB;

  if (shorter.length < 2) return false;

  let matches = 0;
  let j = 0;
  for (const word of shorter) {
    while (j < longer.length && longer[j] !== word) j++;
    if (j < longer.length && longer[j] === word) {
      matches++;
      j++;
    }
  }

  return matches / shorter.length >= 0.8;
}

/**
 * Gère les événements provenant de Deepgram Flux.
 */
export function handleFluxEvent(
  event: FluxEvent,
  session: CallSession,
  mgr: CallSessionManager,
): void {
  switch (event.type) {
    case 'UtteranceStart': {
      // Annuler toute requête LLM en cours (le caller continue de parler)
      if (session.abortController) {
        session.abortController.abort();
        session.abortController = null;
      }

      // Si on était en spéculation (PROCESSING), le caller continue → reset
      if (session.state === 'PROCESSING') {
        session.responseGeneration++;
        session.conversation.toolInFlight = null;
        session.speculativeLlm = null;
        session.speculativeResult = null;
        session.speculativeTranscript = '';
        mgr.transition(session, 'LISTENING');
      } else if (session.state === 'IDLE') {
        mgr.transition(session, 'LISTENING');
      }
      break;
    }

    case 'SpeechResumed': {
      if (session.abortController) {
        session.abortController.abort();
        session.abortController = null;
      }
      if (session.state === 'PROCESSING') {
        session.responseGeneration++;
        session.conversation.toolInFlight = null;
        session.speculativeLlm = null;
        session.speculativeResult = null;
        session.speculativeTranscript = '';
        mgr.transition(session, 'LISTENING');
      }
      break;
    }

    case 'InterimHighConfidence': {
      // Spéculation LLM : lancer le LLM sans attendre la fin de l'utterance
      // Stocker la promise pour la réutiliser si l'utterance finale correspond
      if (process.env.SPECULATIVE_LLM_ENABLED !== 'true') break;
      if (session.state !== 'LISTENING' && session.state !== 'IDLE') break;

      if (!session.latencyTrace) {
        session.latencyTrace = {
          startTime: Date.now(),
          sttFinalMs: 0,
        };
      }

      // Utiliser la transition du manager pour rester cohérent avec la state machine
      mgr.transition(session, 'PROCESSING'); // transition optimiste
      session.speculativeLlm = mgr
        .processUtterance(session, event.transcript)
        .then((response) => {
          session.speculativeResult = response;
          return response;
        })
        .catch((err) => {
          logger.error(
            { err, callId: session.callControlId },
            `[speculative] LLM failed: ${err.message}`,
          );
          captureException(err, {
            tags: { service: 'handler', action: 'speculative-llm' },
            extra: { callId: session.callControlId, transcript: event.transcript },
          });
          session.speculativeLlm = null;
          session.speculativeResult = null;
          return '';
        });
      break;
    }

    case 'UtteranceEnd': {
      if (!session.latencyTrace) {
        session.latencyTrace = {
          startTime: Date.now(),
          sttFinalMs: 0,
        };
      }

      // Cumuler le transcript pour persistance
      session.transcript += (session.transcript ? ' ' : '') + event.transcript;
      startVoiceTurn(session, event.transcript);

      const isSpeculativeEnabled = process.env.SPECULATIVE_LLM_ENABLED === 'true';
      const speculativeTranscript = session.speculativeTranscript;

      if (
        isSpeculativeEnabled &&
        session.speculativeLlm &&
        speculativeTranscript &&
        transcriptsMatch(speculativeTranscript, event.transcript)
      ) {
        // La spéculation est valide → utiliser le résultat en cache
        logger.info(
          { callId: session.callControlId },
          '[speculative] Match! Using cached LLM response',
        );
        session.speculativeLlm
          .then(async (response) => {
            if (response) {
              // Vérifier que la session est toujours en attente (pas déjà en train de parler)
              if (session.state !== 'LISTENING' && session.state !== 'IDLE') {
                writeDebugLog(
                  `[speculative] Session state is ${session.state}, skipping speculative speech`,
                );
                return;
              }
              mgr.transition(session, 'SPEAKING');
              await speakTtsStreamed(session, response);
              mgr.transition(session, 'LISTENING');
            }
          })
          .catch((err) =>
            logger.error(
              { err, callId: session.callControlId },
              '[speculative] speculativeLlm.then failed',
            ),
          );
        session.speculativeLlm = null;
        session.speculativeResult = null;
        session.speculativeTranscript = '';
      } else {
        // Pas de spéculation valide ou mismatch / désactivé !
        if (session.speculativeLlm) {
          logger.info(
            {
              callId: session.callControlId,
              interim: speculativeTranscript,
              final: event.transcript,
            },
            '[speculative] Mismatch or disabled. Clearing speculative state',
          );
          session.speculativeLlm = null;
          session.speculativeResult = null;
          session.speculativeTranscript = '';
          mgr.transition(session, 'LISTENING');
        }

        if (session.state === 'LISTENING' || session.state === 'IDLE') {
          // LLM streaming phrase par phrase (fire-and-forget avec catch)
          processTranscriptStreaming(session, event.transcript, mgr).catch((err) =>
            logger.error(
              { err, callId: session.callControlId },
              '[flux] processTranscriptStreaming failed',
            ),
          );
        }
      }
      break;
    }

    case 'FinalTranscript': {
      break;
    }

    case 'Error': {
      logger.error(
        { callId: session.callControlId, errorMsg: event.message },
        `[flux] Error: ${event.message}`,
      );
      const err = new Error(`Flux error: ${event.message}`);
      captureException(err, {
        tags: { service: 'handler', event: 'flux-error' },
        extra: { callId: session.callControlId },
      });
      speakTtsStreamed(session, "Désolé, je n'ai pas bien compris. Pouvez-vous répéter ?").catch(
        (err) =>
          logger.error(
            { err, callId: session.callControlId },
            '[flux] speakTtsStreamed fallback failed',
          ),
      );
      mgr.transition(session, 'LISTENING');
      break;
    }
  }
}

/**
 * Traite un transcript : LLM → TTS → envoi à Telnyx.
 * Mode classique (non-streaming) — utilisé par la spéculation et le fallback.
 *
 * NOTE: not currently called from this file. The streaming path
 * (processTranscriptStreaming) is the live code path. Kept for the
 * speculative / fallback flows that may re-introduce it.
 */
export function normalizeSttTranscript(text: string): string {
  if (!text) return text;
  return text
    .replace(/\b(un|une)\s+résumé\b/gi, 'une réservation')
    .replace(/\bje\s+souhaite\s+un\s+résumé\b/gi, 'je souhaite une réservation');
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function processTranscript(
  session: CallSession,
  rawTranscript: string,
  mgr: CallSessionManager,
): Promise<void> {
  const transcript = normalizeSttTranscript(rawTranscript);
  if (!transcript.trim()) return;
  if (session.ended || session.telnyxWs.readyState !== WebSocket.OPEN) {
    writeDebugLog(`[processTranscript] Session ended or WS closed, skipping transcript`);
    return;
  }
  if (shouldSkipDuplicateTranscript(session, transcript)) {
    writeDebugLog(`[processTranscript] Skipping duplicate transcript: "${transcript}"`);
    return;
  }

  writeDebugLog(`[processTranscript] Received transcript: "${transcript}"`);
  try {
    session.abortController = new AbortController();
    writeDebugLog(`[processTranscript] Calling LLM...`);
    const llmResponse = await mgr.processUtterance(session, transcript);

    if (session.latencyTrace) {
      session.latencyTrace.llmFirstTokenMs = Date.now() - session.latencyTrace.startTime;
    }
    const ttsResponse = stripRepeatedGreeting(llmResponse, session);
    writeDebugLog(`[processTranscript] LLM responded: "${llmResponse}"`);

    if (!ttsResponse) {
      writeDebugLog(`[processTranscript] LLM response empty after greeting strip, skipping TTS`);
      mgr.transition(session, 'LISTENING');
      return;
    }

    mgr.transition(session, 'SPEAKING');

    if (!isSessionActiveForTts(session)) {
      writeDebugLog(`[processTranscript] Session inactive after LLM, skipping TTS`);
      return;
    }

    writeDebugLog(`[processTranscript] Starting speakTtsStreamed...`);
    await speakTtsStreamed(session, ttsResponse);
    writeDebugLog(`[processTranscript] Completed speakTtsStreamed successfully`);

    mgr.transition(session, 'LISTENING');
    writeDebugLog(`[processTranscript] Transitioned back to LISTENING`);
  } catch (err: unknown) {
    writeDebugLog(`[processTranscript] Caught error`, err);
    logger.error(
      { err, callId: session.callControlId },
      `[pipeline] Error: ${err instanceof Error ? err.message : String(err)}`,
    );
    captureException(err, {
      tags: { service: 'handler', action: 'processTranscript' },
      extra: { callId: session.callControlId, transcript },
    });
    mgr.transition(session, 'LISTENING');
  } finally {
    session.abortController = null;
  }
}

/**
 * Version streaming : reçoit les phrases du LLM au fur et à mesure
 * et lance le TTS immédiatement sans attendre la réponse complète.
 */
async function processTranscriptStreaming(
  session: CallSession,
  rawTranscript: string,
  mgr: CallSessionManager,
): Promise<void> {
  const transcript = normalizeSttTranscript(rawTranscript);
  if (!transcript.trim()) return;
  if (session.ended || session.telnyxWs.readyState !== WebSocket.OPEN) {
    writeDebugLog(`[processTranscriptStreaming] Session ended or WS closed, skipping`);
    return;
  }
  if (shouldSkipDuplicateTranscript(session, transcript)) {
    writeDebugLog(`[processTranscriptStreaming] Skipping duplicate transcript: "${transcript}"`);
    return;
  }

  const responseGeneration = ++session.responseGeneration;
  const isCurrentResponse = () =>
    !session.ended && session.responseGeneration === responseGeneration;
  if (session.state === 'IDLE') mgr.transition(session, 'LISTENING');
  if (session.state === 'LISTENING') mgr.transition(session, 'PROCESSING');

  const livenessResponse = buildLivenessResponse(session, transcript);
  const speechAct = classifyVoiceSpeechAct(transcript);
  recordUserTurn(session, transcript, speechAct);
  recordVoiceTurnClassification(session, speechAct);
  logger.info(
    {
      callId: session.callControlId,
      speechAct,
      intent: session.conversation.intent,
      pendingQuestion: session.conversation.pendingQuestion,
    },
    '[voice-turn] Classified final user turn',
  );
  if (livenessResponse) {
    writeDebugLog(
      `[processTranscriptStreaming] Resuming the previous turn after liveness check: "${transcript}"`,
    );
    session.turnCount++;
    session.history.push(
      { role: 'user', content: transcript },
      { role: 'assistant', content: livenessResponse },
    );
    recordAssistantReply(session, livenessResponse);
    mgr.transition(session, 'SPEAKING');
    await speakTtsStreamed(session, livenessResponse);
    if (isCurrentResponse()) mgr.transition(session, 'LISTENING');
    return;
  }

  const deterministicResponse = buildDeterministicTurnResponse(session, speechAct);
  if (deterministicResponse) {
    writeDebugLog(
      `[processTranscriptStreaming] Handling ${speechAct} without LLM: "${transcript}"`,
    );
    session.turnCount++;
    session.history.push(
      { role: 'user', content: transcript },
      { role: 'assistant', content: deterministicResponse },
    );
    recordAssistantReply(session, deterministicResponse);
    mgr.transition(session, 'SPEAKING');
    await speakTtsStreamed(session, deterministicResponse);
    if (isCurrentResponse()) mgr.transition(session, 'LISTENING');
    return;
  }

  const availabilityRequest = getReadyAvailabilityRequest(session);
  if (availabilityRequest) {
    session.conversation.toolInFlight = 'checkAvailability';
    mgr.transition(session, 'PROCESSING');
    const availabilityStartedAt = Date.now();
    recordVoiceTurnEvent(session, 'availability_started', {
      date: availabilityRequest.date,
      time: availabilityRequest.time,
      partySize: availabilityRequest.partySize,
    });
    try {
      const availabilityPromise = mgr.getAvailability(
        session,
        availabilityRequest.date,
        availabilityRequest.partySize,
      );
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let firstResult:
        | { kind: 'result'; result: Awaited<typeof availabilityPromise> }
        | { kind: 'timeout' };
      try {
        firstResult = await Promise.race([
          availabilityPromise.then((result) => ({ kind: 'result' as const, result })),
          new Promise<{ kind: 'timeout' }>((resolve) => {
            timeout = setTimeout(() => resolve({ kind: 'timeout' }), LLM_FILLER_DELAY_MS);
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }

      if (!isCurrentResponse()) return;

      const result =
        firstResult.kind === 'result'
          ? firstResult.result
          : await (async () => {
              if (!isCurrentResponse()) return availabilityPromise;
              recordVoiceTurnEvent(session, 'filler_started', { purpose: 'availability' });
              writeDebugLog(
                `[voice-turn] Availability exceeds ${LLM_FILLER_DELAY_MS}ms; playing contextual filler`,
              );
              await playFiller(
                session,
                session.personality?.fillerStyle ?? 'CASUAL',
                'availability',
              );
              if (!isCurrentResponse()) return availabilityPromise;
              recordVoiceTurnEvent(session, 'filler_completed', { purpose: 'availability' });
              return availabilityPromise;
            })();
      if (!isCurrentResponse()) return;
      recordVoiceTurnEvent(session, 'availability_completed', {
        durationMs: Date.now() - availabilityStartedAt,
        slotCount: result.slots.length,
      });
      const response = buildAvailabilityReply(availabilityRequest, result.slots);
      session.conversation.lastAvailabilityCheck = availabilityRequest.key;
      session.turnCount++;
      session.history.push(
        { role: 'user', content: transcript },
        { role: 'assistant', content: response },
      );
      recordAssistantReply(session, response);
      mgr.transition(session, 'SPEAKING');
      await speakTtsStreamed(session, response);
      if (isCurrentResponse()) mgr.transition(session, 'LISTENING');
      return;
    } catch (err) {
      recordVoiceTurnEvent(session, 'availability_failed', {
        durationMs: Date.now() - availabilityStartedAt,
      });
      logger.warn(
        { err, callId: session.callControlId },
        '[voice-turn] Direct availability lookup failed; using the LLM fallback',
      );
    } finally {
      if (isCurrentResponse()) session.conversation.toolInFlight = null;
    }
  }

  writeDebugLog(`[processTranscriptStreaming] Starting LLM stream for: "${transcript}"`);

  // Double verrou : l'environnement garde le kill switch global fermé et
  // ConfigCat ne cible que le restaurant canary choisi.
  const useCartesiaContext =
    isCartesiaContextV2Enabled() && (await isVoiceTtsContextV2Enabled(session.restaurantId));
  if (!isCurrentResponse()) return;
  const ttsPromises: Promise<void>[] = [];
  const contextTtsRef: { current: CartesiaContextTurn | null } = { current: null };
  const abortController = new AbortController();

  try {
    session.abortController = abortController;
    const fullResponse = await mgr.processUtteranceStreaming(
      session,
      transcript,
      (phrase: string) => {
        if (!isCurrentResponse() || abortController.signal.aborted) return;
        writeDebugLog(`[processTranscriptStreaming] Phrase received: "${phrase}"`);
        if (session.latencyTrace && !session.latencyTrace.llmFirstTokenMs) {
          session.latencyTrace.llmFirstTokenMs = Date.now() - session.latencyTrace.startTime;
        }

        const cleanPhrase = stripRepeatedGreeting(phrase, session);
        if (!cleanPhrase) return;

        if (session.state !== 'SPEAKING') {
          mgr.transition(session, 'SPEAKING');
        }

        if (!isSessionActiveForTts(session)) {
          writeDebugLog(`[processTranscriptStreaming] Session inactive, skipping phrase`);
          return;
        }

        // Canary prosodique : les fragments d'une même réponse LLM partagent
        // un contexte Cartesia. Le fallback HTTP reste inchangé sans flag.
        contextTtsRef.current ??= createCartesiaContextTurn(session, useCartesiaContext);
        if (contextTtsRef.current) {
          session.ttsContext = contextTtsRef.current;
          contextTtsRef.current.push(cleanTextForTts(cleanPhrase));
          return;
        }

        // Lancer TTS en background pour ne pas bloquer le stream LLM
        const ttsPromise = speakTtsStreamed(session, cleanPhrase).catch((err: unknown) => {
          writeDebugLog(`[processTranscriptStreaming] TTS error for phrase: "${cleanPhrase}"`, err);
        });
        ttsPromises.push(ttsPromise);
      },
    );
    if (!isCurrentResponse() || abortController.signal.aborted) return;
    recordAssistantReply(session, fullResponse);

    writeDebugLog(`[processTranscriptStreaming] LLM stream ended, waiting for TTS...`);
    const contextTts = contextTtsRef.current;
    if (contextTts) {
      try {
        await contextTts.finish();
      } catch (err) {
        logger.error(
          { err, callId: session.callControlId },
          '[processTranscriptStreaming] Cartesia context TTS failed',
        );
        // Sans aucun audio envoyé, la réponse peut encore être prononcée via
        // le transport HTTP éprouvé. Après un audio partiel, on évite un doublon.
        if (!contextTts.hasAudioOutput && isSessionActiveForTts(session)) {
          await speakTtsStreamed(session, fullResponse);
        }
      }
    } else {
      await Promise.all(ttsPromises);
    }
    writeDebugLog(`[processTranscriptStreaming] All TTS completed`);

    if (isCurrentResponse()) {
      mgr.transition(session, 'LISTENING');
      writeDebugLog(`[processTranscriptStreaming] Transitioned back to LISTENING`);
    }
  } catch (err: unknown) {
    if (
      !isCurrentResponse() ||
      abortController.signal.aborted ||
      (err instanceof Error && err.name === 'AbortError')
    ) {
      writeDebugLog(`[processTranscriptStreaming] Stale response cancelled`);
      return;
    }
    writeDebugLog(`[processTranscriptStreaming] Caught error`, err);
    logger.error(
      { err, callId: session.callControlId },
      `[pipeline] Streaming error: ${err instanceof Error ? err.message : String(err)}`,
    );
    captureException(err, {
      tags: { service: 'handler', action: 'processTranscriptStreaming' },
      extra: { callId: session.callControlId, transcript },
    });
    mgr.transition(session, 'LISTENING');
  } finally {
    if (session.ttsContext === contextTtsRef.current) session.ttsContext = null;
    if (session.abortController === abortController) session.abortController = null;
  }
}

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
import { isSessionActiveForTts, speakTtsStreamed } from './tts-handler';
import { TRANSCRIPT_DEDUPE_WINDOW_MS } from '../../../shared/constants/timeouts.js';

const recentTranscripts = new WeakMap<CallSession, { normalized: string; at: number }>();

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
    .replace(/^Tu es l'assistant vocal de /, '')
    .replace(/\.$/, '')
    .trim();
}

export function stripRepeatedGreeting(text: string, session: CallSession): string {
  const restaurantName = extractRestaurantName(session.systemPrompt);
  const escapedName = restaurantName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const greetingPattern = new RegExp(
    `^\\s*Bonjour,\\s*${escapedName}(?:,\\s*cet\\s+appel\\s+peut\\s+être\\s+enregistré\\s+à\\s+des\\s+fins\\s+de\\s+qualité\\s+de\\s+service\\.?)?\\s*[!.]?\\s*(?:En\\s+quoi\\s+puis-je\\s+vous\\s+aider\\s*\\??)?\\s*`,
    'i',
  );

  return text.replace(greetingPattern, '').trim();
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
        session.speculativeLlm = null;
        session.speculativeResult = null;
        mgr.transition(session, 'LISTENING');
      } else if (session.state === 'IDLE') {
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function processTranscript(
  session: CallSession,
  transcript: string,
  mgr: CallSessionManager,
): Promise<void> {
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
    let responseReceived = false;
    const fillerTimer = setTimeout(() => {
      if (!responseReceived && !session.ended && session.state === 'PROCESSING') {
        writeDebugLog(`[processTranscript] LLM took too long (>400ms). Playing a voice filler...`);
        playFiller(session, session.personality?.fillerStyle ?? 'CASUAL').catch((err) =>
          writeDebugLog(`[processTranscript] playFiller failed: ${err}`),
        );
      }
    }, 400);

    writeDebugLog(`[processTranscript] Calling LLM...`);
    const llmResponse = await mgr.processUtterance(session, transcript);
    responseReceived = true;
    clearTimeout(fillerTimer);

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
  transcript: string,
  mgr: CallSessionManager,
): Promise<void> {
  if (!transcript.trim()) return;
  if (session.ended || session.telnyxWs.readyState !== WebSocket.OPEN) {
    writeDebugLog(`[processTranscriptStreaming] Session ended or WS closed, skipping`);
    return;
  }
  if (shouldSkipDuplicateTranscript(session, transcript)) {
    writeDebugLog(`[processTranscriptStreaming] Skipping duplicate transcript: "${transcript}"`);
    return;
  }

  writeDebugLog(`[processTranscriptStreaming] Starting LLM stream for: "${transcript}"`);

  const ttsPromises: Promise<void>[] = [];

  try {
    session.abortController = new AbortController();
    let firstTokenReceived = false;
    const fillerTimer = setTimeout(() => {
      if (!firstTokenReceived && !session.ended && session.state === 'PROCESSING') {
        writeDebugLog(
          `[processTranscriptStreaming] LLM took too long (>400ms). Playing a voice filler...`,
        );
        playFiller(session, session.personality?.fillerStyle ?? 'CASUAL').catch((err) =>
          writeDebugLog(`[processTranscriptStreaming] playFiller failed: ${err}`),
        );
      }
    }, 400);

    await mgr.processUtteranceStreaming(session, transcript, (phrase: string) => {
      firstTokenReceived = true;
      clearTimeout(fillerTimer);

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

      // Lancer TTS en background pour ne pas bloquer le stream LLM
      const ttsPromise = speakTtsStreamed(session, cleanPhrase).catch((err: unknown) => {
        writeDebugLog(`[processTranscriptStreaming] TTS error for phrase: "${cleanPhrase}"`, err);
      });
      ttsPromises.push(ttsPromise);
    });

    writeDebugLog(`[processTranscriptStreaming] LLM stream ended, waiting for TTS...`);
    await Promise.all(ttsPromises);
    writeDebugLog(`[processTranscriptStreaming] All TTS completed`);

    mgr.transition(session, 'LISTENING');
    writeDebugLog(`[processTranscriptStreaming] Transitioned back to LISTENING`);
  } catch (err: unknown) {
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
    session.abortController = null;
  }
}

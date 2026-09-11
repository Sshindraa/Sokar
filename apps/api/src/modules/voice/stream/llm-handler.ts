/**
 * Logique LLM (ElevenLabs Scribe) — gestion des événements Scribe, traitement
 * des transcripts, spéculation LLM, et orchestration TTS.
 *
 * Extrait de handler.ts. Ces fonctions prennent une CallSession et un
 * CallSessionManager en paramètres. Elles mutent l'état de la session
 * (state, speculativeLlm, transcript, etc.) mais c'est le design
 * existant — le handler principal délègue en passant la session par
 * référence.
 */

import { WebSocket } from 'ws';
import type { SttEvent, CallSession } from './types';
import type { CallSessionManager } from './manager';
import { finishCall, isExplicitCallEnd } from './call-ending';
import { playFiller, selectRandomGoodbyeText } from './fillers-cache';
import { logger } from '../../../shared/logger/pino';
import { captureException } from '../../../shared/sentry/client';
import { writeDebugLog } from './debug-log';
import { redactPii } from './pii-redact';
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
import { isSpeculativeLlmEnabled } from './speculation';
import { isNameCollectionBlocking } from './conversation-controller';
import { setSttSpellingProfile } from './stt-bridge';
import {
  effectiveVoiceLanguage,
  hasReliableLanguageEvidence,
  normalizeVoiceLanguage,
  resolveVoiceLanguage,
  supportsDeterministicVoiceLanguage,
  type VoiceLanguageCode,
} from './voice-language';
import {
  buildAvailabilityErrorReply,
  buildAvailabilityReply,
  buildDeterministicTurnResponse,
  buildReservationProgressResponse,
  classifyVoiceSpeechAct,
  getReadyAvailabilityRequest,
  handleCustomerNameTurn,
  parseSpelledNameTranscriptDetailed,
  recordAssistantReply,
  recordUserTurn,
  resetNameCollectionAfterFallback,
} from './conversation-controller';

const recentTranscripts = new WeakMap<CallSession, { normalized: string; at: number }>();
export const LLM_FILLER_DELAY_MS = 1_000;

function syncSpellingProfile(session: CallSession): void {
  setSttSpellingProfile(
    session,
    isNameCollectionBlocking(session) || session.conversation.pendingQuestion === 'customerName',
  );
}

function formatReservationTimeForSpeech(time: string, language: VoiceLanguageCode = 'fr'): string {
  if (language === 'en') {
    const [hourValue, minuteValue] = time.split(':').map(Number);
    const suffix = hourValue >= 12 ? 'PM' : 'AM';
    const hour = hourValue % 12 || 12;
    return minuteValue === 0
      ? `${hour} ${suffix}`
      : `${hour}:${String(minuteValue).padStart(2, '0')} ${suffix}`;
  }
  if (time === '12:00') return 'midi';
  if (time === '00:00') return 'minuit';
  const [hours, minutes] = time.split(':').map(Number);
  if (minutes === 0) return `${hours} heures`;
  return `${hours} heures ${String(minutes).padStart(2, '0')}`;
}

function buildReservationConfirmationResponse(session: CallSession, customerName: string): string {
  const { date, time, partySize } = session.conversation.slots;
  const language = effectiveVoiceLanguage(session);
  if (!date || !time || !partySize) {
    return language === 'en'
      ? `Your reservation is confirmed under the name ${customerName}.`
      : `C'est réservé au nom de ${customerName}.`;
  }

  const formattedDate = new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00.000Z`));
  if (language === 'en') {
    return `Your reservation is confirmed under the name ${customerName}, ${formattedDate} at ${formatReservationTimeForSpeech(time, language)}, for ${partySize} ${partySize === 1 ? 'person' : 'people'}. I will send you a confirmation text message.`;
  }
  return `C'est réservé au nom de ${customerName}, ${formattedDate} à ${formatReservationTimeForSpeech(time)}, pour ${partySize} personne${partySize > 1 ? 's' : ''}. Je vous envoie un SMS de confirmation.`;
}

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
  const firstLine = systemPrompt.split('\n')[0] ?? '';
  const withoutPrefix = firstLine
    .replace(/^Tu es l'hôte d'accueil et assistant vocal chaleureux de /, '')
    .replace(/^Tu es l'assistant vocal (?:chaleureux )?de /, '');

  // Le nom est suivi d'instructions internes : elles ne doivent jamais être vocalisées.
  return withoutPrefix
    .replace(/\.\s+L'accueil a déjà été prononcé.*$/u, '')
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
  const isLivenessCheck =
    /^(?:allo+|vous etes(?: toujours)? la|vous m entendez|ca a coupe|hello|hi|are you(?: still)? there|can you hear me|did we get disconnected)$/u.test(
      normalized,
    );
  if (!isLivenessCheck) return null;

  const lastAssistantMessage = [...session.history]
    .reverse()
    .find((message) => message.role === 'assistant' && message.content.trim())?.content;
  if (!lastAssistantMessage) return null;

  const lastQuestion = lastAssistantMessage.match(/(?:^|[.!]\s*)([^.?!]+\?)\s*$/u)?.[1]?.trim();
  return effectiveVoiceLanguage(session) === 'en'
    ? lastQuestion
      ? `Yes, I'm here. ${lastQuestion}`
      : "Yes, I'm here. I'm listening."
    : lastQuestion
      ? `Oui, je suis là. ${lastQuestion}`
      : 'Oui, je suis là. Je vous écoute.';
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
 * Une pré-réponse devient audible si le STT a stabilisé une phrase
 * suffisamment proche de la phrase spéculative. On utilise un fuzzy match
 * (80% de mots communs dans l'ordre) au lieu d'un match exact, car ElevenLabs
 * peut légèrement modifier le transcript entre l'interim et le final
 * (ponctuation, corrections de dernier mot).
 */
function speculativeTranscriptMatches(a: string, b: string): boolean {
  const normA = normalizeTranscriptForDedupe(a);
  const normB = normalizeTranscriptForDedupe(b);
  // Match exact d'abord (cas le plus commun)
  if (normA === normB) return true;
  // Fuzzy match : 80% de mots communs dans l'ordre
  return transcriptsMatch(normA, normB);
}

/**
 * Gère les événements provenant de ElevenLabs Scribe.
 */
export function handleSttEvent(
  event: SttEvent,
  session: CallSession,
  mgr: CallSessionManager,
): void {
  if (session.ended || session.ending) return;
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
      if (!isSpeculativeLlmEnabled(session)) break;
      const spellingInterim = parseSpelledNameTranscriptDetailed(event.transcript);
      const nameContextExpected =
        session.conversation?.pendingQuestion === 'customerName' ||
        ((session.conversation?.intent === 'reservation' ||
          session.conversation?.intent === 'availability') &&
          !session.conversation?.slots.customerName);
      if (
        isNameCollectionBlocking(session) ||
        session.conversation?.pendingQuestion === 'customerName' ||
        Boolean(spellingInterim && nameContextExpected)
      )
        break;
      if (session.state !== 'LISTENING' && session.state !== 'IDLE') break;

      // Ne change pas l'état de l'appel ni son historique : tant que Scribe n'a
      // pas confirmé le tour, l'appelant peut encore poursuivre sa phrase.
      const abortController = new AbortController();
      session.abortController = abortController;
      session.speculativeLlm = mgr
        .prepareSpeculativeReply(session, event.transcript, abortController.signal)
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
            extra: { callId: session.callControlId, transcript: redactPii(event.transcript) },
          });
          session.speculativeLlm = null;
          session.speculativeResult = null;
          return '';
        });
      break;
    }

    case 'UtteranceEnd': {
      const detectedLanguage = normalizeVoiceLanguage(event.languageCode);
      if (detectedLanguage) {
        const previousLanguage = effectiveVoiceLanguage(session);
        const languageDecision = resolveVoiceLanguage(
          previousLanguage,
          detectedLanguage,
          event.transcript,
          session.turnCount,
          session.voiceLanguageCandidate,
        );
        session.voiceLanguageCandidate = languageDecision.candidate;
        if (languageDecision.accepted) {
          session.voiceLanguageCode = languageDecision.language;
        } else {
          logger.info(
            {
              callId: session.callControlId,
              previousLanguage,
              detectedLanguage,
              evidence: hasReliableLanguageEvidence(event.transcript),
            },
            '[voice-language] Ignoring unstable language detection',
          );
        }
        if (languageDecision.changed) {
          // Une spéculation lancée avant le commit Scribe peut avoir utilisé
          // l'ancienne langue (notamment sur un premier « yes »). Elle ne doit
          // jamais être réutilisée après un changement de langue détecté.
          session.abortController?.abort();
          session.abortController = null;
          session.speculativeLlm = null;
          session.speculativeResult = null;
          session.speculativeTranscript = '';
          logger.info(
            {
              callId: session.callControlId,
              previousLanguage,
              language: languageDecision.language,
            },
            '[voice-language] Updated dialogue language from Scribe',
          );
        }
      }
      // Cumuler le transcript pour persistance
      session.transcript += (session.transcript ? ' ' : '') + event.transcript;
      startVoiceTurn(session, event.transcript);

      const isSpeculativeEnabled = isSpeculativeLlmEnabled(session);
      const speculativeTranscript = session.speculativeTranscript;
      const speechAct = classifyVoiceSpeechAct(event.transcript);
      const startFinalStreaming = () => {
        processTranscriptStreaming(session, event.transcript, mgr).catch((err) =>
          logger.error(
            { err, callId: session.callControlId },
            '[stt] processTranscriptStreaming failed',
          ),
        );
      };

      // Une spéculation commencée avant l'entrée dans la collecte du nom ne
      // doit jamais court-circuiter le contrôle déterministe de confirmation.
      if (
        isNameCollectionBlocking(session) ||
        session.conversation?.pendingQuestion === 'customerName'
      ) {
        session.speculativeLlm = null;
        session.speculativeResult = null;
        session.speculativeTranscript = '';
        startFinalStreaming();
        break;
      }

      if (
        isSpeculativeEnabled &&
        session.speculativeLlm &&
        speculativeTranscript &&
        speechAct === 'backchannel' &&
        speculativeTranscriptMatches(speculativeTranscript, event.transcript)
      ) {
        // La formulation reste générée par le LLM, mais son raisonnement a
        // commencé pendant la fin de phrase de l'appelant.
        logger.info(
          { callId: session.callControlId },
          '[speculative] Match! Using cached LLM response',
        );
        const speculativeLlm = session.speculativeLlm;
        session.speculativeLlm = null;
        session.speculativeResult = null;
        session.speculativeTranscript = '';
        speculativeLlm
          .then(async (response) => {
            const cleanResponse = stripRepeatedGreeting(response, session);
            if (!cleanResponse || session.state === 'SPEAKING' || session.ended) {
              if (!session.ended && session.state !== 'SPEAKING') startFinalStreaming();
              return;
            }

            recordUserTurn(session, event.transcript, speechAct);
            recordVoiceTurnClassification(session, speechAct);
            session.turnCount++;
            session.history.push(
              { role: 'user', content: event.transcript },
              { role: 'assistant', content: cleanResponse },
            );
            recordAssistantReply(session, cleanResponse);
            session.latencyTrace!.llmFirstTokenMs = Date.now() - session.latencyTrace!.startTime;
            recordVoiceTurnEvent(session, 'speculation_hit', {
              llmFirstTokenMs: session.latencyTrace!.llmFirstTokenMs,
            });
            mgr.transition(session, 'SPEAKING');
            await speakTtsStreamed(session, cleanResponse);
            if (!session.ended) mgr.transition(session, 'LISTENING');
          })
          .catch((err) => {
            logger.error(
              { err, callId: session.callControlId },
              '[speculative] speculativeLlm.then failed',
            );
            if (!session.ended && (session.state === 'LISTENING' || session.state === 'IDLE')) {
              startFinalStreaming();
            }
          });
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
          if (session.state === 'PROCESSING') mgr.transition(session, 'LISTENING');
        }

        if (session.state === 'LISTENING' || session.state === 'IDLE') {
          startFinalStreaming();
        }
      }
      break;
    }

    case 'Error': {
      logger.error(
        { callId: session.callControlId, errorMsg: event.message },
        `[stt] Error: ${event.message}`,
      );
      const err = new Error(`Scribe error: ${event.message}`);
      captureException(err, {
        tags: { service: 'handler', event: 'stt-error' },
        extra: { callId: session.callControlId },
      });
      speakTtsStreamed(
        session,
        effectiveVoiceLanguage(session) === 'en'
          ? "Sorry, I didn't understand. Could you repeat that, please?"
          : "Désolé, je n'ai pas bien compris. Pouvez-vous répéter ?",
      ).catch((err) =>
        logger.error(
          { err, callId: session.callControlId },
          '[stt] speakTtsStreamed fallback failed',
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
  if (session.ended || session.ending || session.telnyxWs.readyState !== WebSocket.OPEN) {
    writeDebugLog(`[processTranscript] Session ended or WS closed, skipping transcript`);
    return;
  }
  if (shouldSkipDuplicateTranscript(session, transcript)) {
    writeDebugLog(`[processTranscript] Skipping duplicate transcript: "${redactPii(transcript)}"`);
    return;
  }

  writeDebugLog(`[processTranscript] Received transcript: "${redactPii(transcript)}"`);
  try {
    session.abortController = new AbortController();
    writeDebugLog(`[processTranscript] Calling LLM...`);
    const llmResponse = await mgr.processUtterance(session, transcript);

    if (session.latencyTrace) {
      session.latencyTrace.llmFirstTokenMs = Date.now() - session.latencyTrace.startTime;
    }
    const ttsResponse = stripRepeatedGreeting(llmResponse, session);
    writeDebugLog(`[processTranscript] LLM responded: "${redactPii(llmResponse)}"`);

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
      extra: { callId: session.callControlId, transcript: redactPii(transcript) },
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
export async function processTranscriptStreaming(
  session: CallSession,
  rawTranscript: string,
  mgr: CallSessionManager,
): Promise<void> {
  const transcript = normalizeSttTranscript(rawTranscript);
  if (!transcript.trim()) return;
  if (session.ended || session.ending || session.telnyxWs.readyState !== WebSocket.OPEN) {
    writeDebugLog(`[processTranscriptStreaming] Session ended or WS closed, skipping`);
    return;
  }
  if (shouldSkipDuplicateTranscript(session, transcript)) {
    writeDebugLog(
      `[processTranscriptStreaming] Skipping duplicate transcript: "${redactPii(transcript)}"`,
    );
    return;
  }

  const responseGeneration = ++session.responseGeneration;
  const language = effectiveVoiceLanguage(session);
  const deterministicLanguage = supportsDeterministicVoiceLanguage(language);
  const isCurrentResponse = () =>
    !session.ended && session.responseGeneration === responseGeneration;
  if (session.state === 'IDLE') mgr.transition(session, 'LISTENING');
  if (session.state === 'LISTENING') mgr.transition(session, 'PROCESSING');

  const livenessResponse = deterministicLanguage
    ? buildLivenessResponse(session, transcript)
    : null;
  const classifiedAct = classifyVoiceSpeechAct(transcript);
  const explicitEnd = isExplicitCallEnd(transcript);
  const speechAct = classifiedAct === 'closing' && !explicitEnd ? 'backchannel' : classifiedAct;
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
  if (explicitEnd) {
    const goodbye = selectRandomGoodbyeText(session.personality?.fillerStyle ?? 'CASUAL', language);
    session.turnCount++;
    session.history.push(
      { role: 'user', content: transcript },
      { role: 'assistant', content: goodbye },
    );
    recordAssistantReply(session, goodbye);
    await finishCall(session, mgr, goodbye);
    return;
  }

  if (deterministicLanguage && /^(?:merci|thanks?|thank you)[.! ]*$/i.test(transcript)) {
    const question = session.conversation.lastAssistantQuestion;
    const response =
      language === 'en'
        ? question
          ? `You're welcome. ${question}`
          : "You're welcome."
        : question
          ? `Je vous en prie. ${question}`
          : 'Je vous en prie.';
    session.history.push(
      { role: 'user', content: transcript },
      { role: 'assistant', content: response },
    );
    recordAssistantReply(session, response);
    mgr.transition(session, 'SPEAKING');
    await speakTtsStreamed(session, response);
    if (isCurrentResponse()) mgr.transition(session, 'LISTENING');
    return;
  }

  // A short, unrecognized utterance after our farewell needs clarification,
  // not a newly invented cancellation/modification intent (real call: "Nova").
  const previousReply =
    session.history.filter((message) => message.role === 'assistant').at(-1)?.content ?? '';
  if (
    deterministicLanguage &&
    speechAct === 'content' &&
    /au revoir|à demain|goodbye|see you|have a (?:good|great) (?:day|evening)/i.test(
      previousReply,
    ) &&
    transcript.trim().split(/\s+/).length <= 3 &&
    !/attendez|ajout|annul|modif|reserv|personne|heure|wait|add|cancel|change|book|people|time/i.test(
      transcript,
    )
  ) {
    const response =
      language === 'en'
        ? "Sorry, I didn't quite understand. Did you want to add something?"
        : "Pardon, je n'ai pas bien compris. Vous souhaitiez ajouter quelque chose ?";
    session.history.push(
      { role: 'user', content: transcript },
      { role: 'assistant', content: response },
    );
    recordAssistantReply(session, response);
    mgr.transition(session, 'SPEAKING');
    await speakTtsStreamed(session, response);
    if (isCurrentResponse()) mgr.transition(session, 'LISTENING');
    return;
  }
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
    syncSpellingProfile(session);
    mgr.transition(session, 'SPEAKING');
    await speakTtsStreamed(session, livenessResponse);
    if (isCurrentResponse()) mgr.transition(session, 'LISTENING');
    return;
  }

  // Le STT reste Scribe pour la conversation générale. Pour une suite de
  // lettres, on évite toutefois que le LLM la transforme en mot plausible
  // (ex. « K I F » → « Kif ») et on exige une confirmation explicite.
  const customerNameTurn = deterministicLanguage
    ? handleCustomerNameTurn(session, transcript)
    : { response: null, escalate: false, confirmedName: null };
  if (customerNameTurn.response) {
    // Un nouveau tour peut avoir invalidé cette réponse pendant la lecture
    // TTS précédente (barge-in). Une réponse périmée ne doit jamais remettre
    // l'état en SPEAKING ni bloquer le tour suivant.
    if (!isCurrentResponse()) return;
    writeDebugLog(
      `[processTranscriptStreaming] Handling customer-name spelling without LLM: "${redactPii(transcript)}"`,
    );
    session.turnCount++;
    let response = customerNameTurn.response;
    if (customerNameTurn.escalate) {
      response = await mgr.recordNameSpellingFallback(session);
      resetNameCollectionAfterFallback(session);
    }
    session.history.push(
      { role: 'user', content: transcript },
      { role: 'assistant', content: response },
    );
    recordAssistantReply(session, response);
    syncSpellingProfile(session);
    if (!isCurrentResponse()) return;
    mgr.transition(session, 'SPEAKING');
    await speakTtsStreamed(session, response);
    if (isCurrentResponse()) mgr.transition(session, 'LISTENING');
    return;
  }

  // La confirmation libère le profil Scribe avant de repasser au LLM. Le texte
  // confirmé est injecté explicitement ; le LLM ne peut pas le « corriger ».
  if (!isCurrentResponse()) return;
  syncSpellingProfile(session);

  // Si le créneau a déjà été vérifié et que le client vient de confirmer le
  // nom, finaliser directement. Cela évite de perdre un « oui » dans un appel
  // LLM indisponible et garantit que le nom épelé reste la source de vérité.
  if (customerNameTurn.confirmedName) {
    const reservationResult = await mgr.createReservationFromConversation(session);
    if (!isCurrentResponse()) return;
    if (reservationResult) {
      const response = reservationResult.startsWith('Réservation confirmée')
        ? buildReservationConfirmationResponse(session, customerNameTurn.confirmedName)
        : reservationResult;
      session.turnCount++;
      session.history.push(
        { role: 'user', content: transcript },
        { role: 'assistant', content: response },
      );
      recordAssistantReply(session, response);
      syncSpellingProfile(session);
      mgr.transition(session, 'SPEAKING');
      await speakTtsStreamed(session, response);
      if (isCurrentResponse()) mgr.transition(session, 'LISTENING');
      return;
    }
  }

  const transcriptForLlm = customerNameTurn.confirmedName
    ? `${transcript}. Nom confirmé lettre par lettre : ${customerNameTurn.confirmedName
        .split('')
        .join(' ')}`
    : transcript;

  const deterministicResponse = deterministicLanguage
    ? (buildDeterministicTurnResponse(session, speechAct, transcript) ??
      buildReservationProgressResponse(session, transcript))
    : null;
  if (deterministicResponse) {
    if (!isCurrentResponse()) return;
    writeDebugLog(
      `[processTranscriptStreaming] Handling ${speechAct} without LLM: "${transcript}"`,
    );
    session.turnCount++;
    session.history.push(
      { role: 'user', content: transcript },
      { role: 'assistant', content: deterministicResponse },
    );
    recordAssistantReply(session, deterministicResponse);
    syncSpellingProfile(session);
    if (!isCurrentResponse()) return;
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
      const response = buildAvailabilityReply(availabilityRequest, result.slots, language);
      session.conversation.lastAvailabilityCheck = availabilityRequest.key;
      session.conversation.lastAvailabilityResult = {
        key: availabilityRequest.key,
        date: availabilityRequest.date,
        time: availabilityRequest.time,
        partySize: availabilityRequest.partySize,
        slots: [...result.slots],
      };
      session.turnCount++;
      session.history.push(
        { role: 'user', content: transcript },
        { role: 'assistant', content: response },
      );
      recordAssistantReply(session, response);
      syncSpellingProfile(session);
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
        '[voice-turn] Direct availability lookup failed; using a safe deterministic fallback',
      );
      if (isCurrentResponse()) {
        const response = buildAvailabilityErrorReply(language);
        session.turnCount++;
        session.history.push(
          { role: 'user', content: transcript },
          { role: 'assistant', content: response },
        );
        recordAssistantReply(session, response);
        syncSpellingProfile(session);
        mgr.transition(session, 'SPEAKING');
        await speakTtsStreamed(session, response);
        if (isCurrentResponse()) mgr.transition(session, 'LISTENING');
      }
      return;
    } finally {
      if (isCurrentResponse()) session.conversation.toolInFlight = null;
    }
  }

  writeDebugLog(`[processTranscriptStreaming] Starting LLM stream for: "${redactPii(transcript)}"`);
  // Une clôture ne peut ni créer ni modifier une réservation : on conserve la
  // formulation libre du LLM mais on omet le schéma d'outils et on borne la
  // réponse, ce qui réduit le prompt et le temps de génération.
  const llmOptions = undefined;

  // ── Thinking filler : combler le silence pendant que le LLM génère.
  // Joue un filler court ("Alors…", "Voyons voir…") immédiatement après la
  // phrase de l'utilisateur, avant que le LLM ne réponde. Cela élimine le
  // "vide" de 700ms qui donne l'impression d'une IA qui réfléchit.
  // Le filler est joué en parallèle du LLM : si le LLM répond avant la fin
  // du filler, le filler est coupé par le barge-in naturel du TTS.
  if (isCurrentResponse()) {
    recordVoiceTurnEvent(session, 'filler_started', { purpose: 'thinking' });
    playFiller(session, session.personality?.fillerStyle ?? 'CASUAL', 'generic').catch((err) => {
      logger.warn(
        { err, callId: session.callControlId },
        '[thinking-filler] failed (non-blocking)',
      );
    });
  }

  // Double verrou : l'environnement garde le kill switch global fermé et
  // ConfigCat ne cible que le restaurant canary choisi.
  const useCartesiaContext =
    isCartesiaContextV2Enabled() && (await isVoiceTtsContextV2Enabled(session.restaurantId));
  if (!isCurrentResponse()) return;
  const ttsPromises: Promise<void>[] = [];
  // Ouvrir le socket pendant la génération LLM masque sa poignée de main
  // réseau. Le contexte reste canary-gaté ; le fallback HTTP est inchangé
  // pour les restaurants non ciblés.
  const contextTtsRef: { current: CartesiaContextTurn | null } = {
    current: useCartesiaContext ? createCartesiaContextTurn(session, true) : null,
  };
  if (contextTtsRef.current) session.ttsContext = contextTtsRef.current;
  const abortController = new AbortController();

  try {
    session.abortController = abortController;
    const fullResponse = await mgr.processUtteranceStreaming(
      session,
      transcriptForLlm,
      (phrase: string) => {
        if (!isCurrentResponse() || abortController.signal.aborted) return;
        writeDebugLog(`[processTranscriptStreaming] Phrase received: "${redactPii(phrase)}"`);
        if (session.latencyTrace && !session.latencyTrace.llmFirstTokenMs) {
          session.latencyTrace.llmFirstTokenMs = Date.now() - session.latencyTrace.startTime;
          recordVoiceTurnEvent(session, 'llm_first_phrase', {
            llmFirstTokenMs: session.latencyTrace.llmFirstTokenMs,
          });
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

        // Les fragments d'une même réponse LLM partagent le contexte ouvert
        // avant le premier token. Le fallback HTTP reste disponible si le
        // contexte échoue avant le premier audio.
        if (contextTtsRef.current) {
          session.ttsContext = contextTtsRef.current;
          contextTtsRef.current.push(cleanTextForTts(cleanPhrase, effectiveVoiceLanguage(session)));
          return;
        }

        // Lancer TTS en background pour ne pas bloquer le stream LLM
        const ttsPromise = speakTtsStreamed(session, cleanPhrase).catch((err: unknown) => {
          writeDebugLog(`[processTranscriptStreaming] TTS error for phrase: "${cleanPhrase}"`, err);
        });
        ttsPromises.push(ttsPromise);
      },
      llmOptions,
    );
    if (!isCurrentResponse() || abortController.signal.aborted) return;
    recordAssistantReply(session, fullResponse);
    syncSpellingProfile(session);

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
      extra: { callId: session.callControlId, transcript: redactPii(transcript) },
    });
    mgr.transition(session, 'LISTENING');
  } finally {
    if (session.ttsContext === contextTtsRef.current) session.ttsContext = null;
    if (session.abortController === abortController) session.abortController = null;
  }
}

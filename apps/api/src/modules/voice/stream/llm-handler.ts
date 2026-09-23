/**
 * Logique LLM (ElevenLabs Scribe) — gestion des événements Scribe, traitement
 * des transcripts, spéculation LLM, et orchestration TTS.
 *
 * Extrait de handler.ts. Ces fonctions prennent une CallSession et un
 * CallSessionManager en paramètres. Elles mutent l'état de la session
 * (state, transcript, etc.) mais c'est le design
 * existant — le handler principal délègue en passant la session par
 * référence.
 */

import { buildLlmRecoveryReply } from './llm-recovery';
import { prefetchAvailabilityFromPartial, takeAvailabilityPrefetch } from './availability-prefetch';
import { WebSocket } from 'ws';
import type { SttEvent, CallSession } from './types';
import type { CallSessionManager } from './manager';
import { finishCall, isExplicitCallEnd } from './call-ending';
import { playFiller, selectRandomGoodbyeText } from './fillers-cache';
import { cancelScheduledFiller, scheduleThinkingFiller } from './filler-scheduler';
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
  recordVoiceTurnEventIfCurrent,
  completeVoiceTurnInput,
  markVoiceTurnLlmFirstPhrase,
  markVoiceTurnLlmFirstToken,
  startVoiceTurn,
} from './turn-telemetry';
import { isVoiceTtsContextV2Enabled } from '../../../shared/configcat';
import { TRANSCRIPT_DEDUPE_WINDOW_MS } from '../../../shared/constants/timeouts.js';
import {
  getActivePendingInteraction,
  isModelTurnStalled,
  isNameCollectionBlocking,
  recordModelTurnStall,
} from './conversation-controller';
import {
  captureTurnPlanPolicySnapshot,
  isTurnPlanShadowEnabled,
  recordInBandTurnPlanShadow,
  shouldObserveDeterministicTurnPlan,
} from './turn-plan-shadow';
import type { InBandTurnPlanResult, TurnPlanPolicySnapshot } from './turn-plan-shadow';
import {
  applyTurnPlanAuthority,
  hasDeterministicTurnProgress,
  hasTurnFactProgress,
  isTurnPlanAuthorityEnabled,
} from './turn-plan-authority';
import {
  recordVoiceTurnPlanDeferred,
  type VoiceTurnPlanDeferredOutcome,
} from '../../../shared/observability/metrics';
import type { TurnPlanContext } from './turn-plan';
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
  buildAvailabilityErrorPlan,
  getOpenAvailabilityRequest,
  buildOpenAvailabilityReply,
  buildAvailabilityLlmContext,
  buildAvailabilityReplyPlan,
  buildDeterministicTurnPlan,
  buildHumanFallbackClarification,
  buildReservationProgressPlan,
  classifyVoiceSpeechActInContext,
  clearDialogueGuardTrace,
  confirmReservationDraft,
  clearReservationConfirmation,
  getReadyAvailabilityRequest,
  handleCustomerNameTurn,
  finalAssistantQuestion,
  isAffirmativeShortResponse,
  isNegativeShortResponse,
  recordAssistantReplyWithPolicy,
  recordAssistantReplyFromLlmTextFallback,
  recordUserTurn,
  resolveHumanFallbackChoice,
  suspendPendingInteractionForDetour,
  resetNameCollectionAfterFallback,
} from './conversation-controller';

const recentTranscripts = new WeakMap<
  CallSession,
  { normalized: string; at: number; dialogueContext: string }
>();
export const LLM_FILLER_DELAY_MS = 1_000;
/** Attente maximale du TurnPlan séparé avant de retomber sur l'inférence texte. */
export const TURN_PLAN_REPLY_WAIT_MS = 1_500;

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

  // Le même mot peut être une réponse légitime à deux questions successives
  // (« oui » pour valider le nom, puis « oui » pour valider le récapitulatif).
  // Le contexte métier distingue ces tours tout en filtrant les doublons STT
  // qui répètent exactement le même événement.
  const dialogueContext = `${session.conversation?.pendingQuestion ?? ''}|${session.conversation?.lastAssistantQuestion ?? ''}`;
  const previous = recentTranscripts.get(session);
  const now = Date.now();
  if (
    previous &&
    previous.normalized === normalized &&
    previous.dialogueContext === dialogueContext &&
    now - previous.at < TRANSCRIPT_DEDUPE_WINDOW_MS
  ) {
    return true;
  }

  recentTranscripts.set(session, { normalized, at: now, dialogueContext });
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
 * Gère les événements provenant de ElevenLabs Scribe.
 */
export function handleSttEvent(
  event: SttEvent,
  session: CallSession,
  mgr: CallSessionManager,
): void {
  if (session.ended || session.ending || session.handoffInProgress) return;
  switch (event.type) {
    case 'UtteranceStart': {
      cancelScheduledFiller(session);
      if (session.currentTurn && session.state === 'PROCESSING') {
        recordVoiceTurnEvent(session, 'llm_interrupted', { reason: 'speech_resumed' });
      }
      // Démarrer le chronomètre avant le commit final afin d'inclure le silence VAD.
      startVoiceTurn(session);
      // Annuler toute requête LLM en cours (le caller continue de parler)
      if (session.abortController) {
        session.abortController.abort();
        session.abortController = null;
      }

      // Si on était en spéculation (PROCESSING), le caller continue → reset
      if (session.state === 'PROCESSING') {
        session.responseGeneration++;
        session.conversation.toolInFlight = null;
        mgr.transition(session, 'LISTENING');
      } else if (session.state === 'IDLE') {
        mgr.transition(session, 'LISTENING');
      }
      break;
    }

    case 'SpeechResumed': {
      cancelScheduledFiller(session);
      if (!session.currentTurn) startVoiceTurn(session);
      else recordVoiceTurnEvent(session, 'speech_resumed');
      if (session.abortController) {
        session.abortController.abort();
        session.abortController = null;
      }
      if (session.state === 'PROCESSING') {
        session.responseGeneration++;
        session.conversation.toolInFlight = null;
        mgr.transition(session, 'LISTENING');
      }
      break;
    }

    case 'PartialTranscript':
      prefetchAvailabilityFromPartial(session, mgr, event.transcript);
      break;

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
          session.abortController?.abort();
          session.abortController = null;
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
      // Cumuler le transcript pour persistance et rattacher la fin au tour
      // commencé par UtteranceStart.
      session.transcript += (session.transcript ? ' ' : '') + event.transcript;
      completeVoiceTurnInput(session, event.transcript, event.words);

      if (session.state === 'LISTENING' || session.state === 'IDLE') {
        processTranscriptStreaming(session, event.transcript, mgr).catch((err) =>
          logger.error(
            { err, callId: session.callControlId },
            '[stt] processTranscriptStreaming failed',
          ),
        );
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
 * fallback flows that may re-introduce it.
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

    markVoiceTurnLlmFirstToken(session, session.currentTurn?.id);
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
  const pendingQuestionBeforeTurn = session.conversation.pendingQuestion;
  const interactionBeforeTurn = getActivePendingInteraction(session);
  const turnPlanContext: TurnPlanContext = {
    transcript,
    language,
    timezone: session.timezone,
    referenceTime: new Date().toISOString(),
    intent: session.conversation.intent,
    pendingInteraction: interactionBeforeTurn
      ? {
          kind: interactionBeforeTurn.kind,
          intentContext: interactionBeforeTurn.intentContext ?? null,
          ...(interactionBeforeTurn.fallbackMode
            ? { fallbackMode: interactionBeforeTurn.fallbackMode }
            : {}),
          ...(interactionBeforeTurn.candidatePartySize !== undefined
            ? { candidatePartySize: interactionBeforeTurn.candidatePartySize }
            : {}),
        }
      : null,
    slots: {
      ...(session.conversation.slots.date ? { date: session.conversation.slots.date } : {}),
      ...(session.conversation.slots.time ? { time: session.conversation.slots.time } : {}),
      ...(session.conversation.slots.partySize !== undefined
        ? { partySize: session.conversation.slots.partySize }
        : {}),
    },
    hasConfirmedName: Boolean(session.conversation.nameCollection?.confirmedName),
  };
  const turnPlanBefore = captureTurnPlanPolicySnapshot(session, interactionBeforeTurn?.id ?? null);
  const turnPlanShadowEnabled = isTurnPlanShadowEnabled();
  const isCurrentResponse = () =>
    !session.ended && session.responseGeneration === responseGeneration;
  if (session.state === 'IDLE') mgr.transition(session, 'LISTENING');
  if (session.state === 'LISTENING') mgr.transition(session, 'PROCESSING');

  const livenessResponse = deterministicLanguage
    ? buildLivenessResponse(session, transcript)
    : null;
  const classifiedAct = classifyVoiceSpeechActInContext(session, transcript);
  const explicitEnd = isExplicitCallEnd(transcript);
  const speechAct = classifiedAct === 'closing' && !explicitEnd ? 'backchannel' : classifiedAct;
  if (!explicitEnd) suspendPendingInteractionForDetour(session, transcript);
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
    recordAssistantReplyWithPolicy(session, goodbye, {
      source: 'explicit',
      operation: 'cancel',
    });
    await finishCall(session, mgr, goodbye);
    return;
  }

  const confirmationTurn = pendingQuestionBeforeTurn === 'confirmation';
  const affirmativeConfirmation = confirmationTurn && isAffirmativeShortResponse(transcript);
  const negativeConfirmation = confirmationTurn && isNegativeShortResponse(transcript);
  if (negativeConfirmation) clearReservationConfirmation(session);

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
    recordAssistantReplyWithPolicy(session, response, {
      source: 'explicit',
      operation: question ? 'keep' : 'cancel',
    });
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
    recordAssistantReplyWithPolicy(session, response, {
      source: 'explicit',
      operation: 'activate',
      interaction: { kind: 'open', prompt: finalAssistantQuestion(response) ?? response },
    });
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
    recordAssistantReplyWithPolicy(session, livenessResponse, {
      source: 'explicit',
      operation: 'keep',
    });
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
    recordAssistantReplyWithPolicy(
      session,
      response,
      customerNameTurn.escalate
        ? { source: 'explicit', operation: 'cancel' }
        : {
            source: 'explicit',
            operation: 'activate',
            interaction: {
              kind: 'customerName',
              prompt: finalAssistantQuestion(response) ?? response,
            },
          },
    );
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

  // Le garde-fou anti-boucle a proposé un repli humain (transfert ou message).
  // L'annonce ne vaut que si l'action est réellement exécutée ici.
  if (
    deterministicLanguage &&
    pendingQuestionBeforeTurn === 'humanFallback' &&
    session.conversation.humanFallbackOffered
  ) {
    const fallbackChoice = resolveHumanFallbackChoice(session, transcript);
    if (fallbackChoice) {
      const response =
        fallbackChoice === 'clarify'
          ? buildHumanFallbackClarification(session, transcript)
          : await (fallbackChoice === 'transfer'
              ? mgr.handoffToManager(session, {
                  kind: 'human_fallback_choice',
                  choice: 'transfer',
                })
              : mgr.recordDialogueFallbackMessage(session, {
                  kind: 'human_fallback_choice',
                  choice: 'message',
                }));
      if (fallbackChoice !== 'clarify') {
        recordVoiceTurnEvent(session, 'dialogue_guard', {
          level: 'escalate',
          action: fallbackChoice,
        });
      }
      if (!isCurrentResponse()) return;
      session.turnCount++;
      session.history.push(
        { role: 'user', content: transcript },
        { role: 'assistant', content: response },
      );
      if (fallbackChoice === 'clarify') {
        recordAssistantReplyWithPolicy(session, response, {
          source: 'explicit',
          operation: 'activate',
          interaction: {
            kind: 'humanFallback',
            prompt: response,
            fallbackMode:
              session.conversation.humanFallbackMode ??
              (session.managerPhone?.trim() ? 'choice' : 'message'),
          },
        });
      } else {
        recordAssistantReplyWithPolicy(session, response, {
          source: 'explicit',
          operation: 'cancel',
        });
      }
      syncSpellingProfile(session);
      mgr.transition(session, 'SPEAKING');
      await speakTtsStreamed(session, response);
      if (isCurrentResponse()) mgr.transition(session, 'LISTENING');
      return;
    }
  }

  // Seul un « oui » au dernier récapitulatif ouvre le verrou de création. La
  // confirmation de l'orthographe du nom ne suffit pas : le client doit encore
  // valider la date, l'heure et le nombre de personnes.
  if (affirmativeConfirmation) {
    if (!confirmReservationDraft(session)) {
      const response =
        language === 'en'
          ? "I couldn't record that confirmation. Let me repeat the booking details first."
          : "Je n'ai pas pu enregistrer cette confirmation. Je vous relis d'abord les détails de la réservation.";
      session.turnCount++;
      session.history.push(
        { role: 'user', content: transcript },
        { role: 'assistant', content: response },
      );
      recordAssistantReplyWithPolicy(session, response, {
        source: 'explicit',
        operation: 'cancel',
      });
      mgr.transition(session, 'SPEAKING');
      await speakTtsStreamed(session, response);
      if (isCurrentResponse()) mgr.transition(session, 'LISTENING');
      return;
    }
    const reservationResult = await mgr.createReservationFromConversation(session);
    if (!isCurrentResponse()) return;
    if (reservationResult) {
      const confirmedCustomerName =
        session.conversation.nameCollection.confirmedName ??
        session.conversation.slots.customerName ??
        'Client';
      const response = reservationResult.startsWith('Réservation confirmée')
        ? buildReservationConfirmationResponse(session, confirmedCustomerName)
        : reservationResult;
      session.turnCount++;
      session.history.push(
        { role: 'user', content: transcript },
        { role: 'assistant', content: response },
      );
      recordAssistantReplyWithPolicy(session, response, {
        source: 'explicit',
        operation: 'cancel',
      });
      syncSpellingProfile(session);
      mgr.transition(session, 'SPEAKING');
      await speakTtsStreamed(session, response);
      if (isCurrentResponse()) mgr.transition(session, 'LISTENING');
      return;
    }
    // L'accord a été consommé avant l'appel métier. En cas de résultat vide ou
    // d'invalidation concurrente, on reste silencieux côté création et on
    // laisse le LLM demander une nouvelle validation contextualisée.
  }

  const transcriptForLlm = customerNameTurn.confirmedName
    ? `${transcript}. Nom confirmé lettre par lettre : ${customerNameTurn.confirmedName
        .split('')
        .join(' ')}`
    : transcript;

  const openRequest = deterministicLanguage ? getOpenAvailabilityRequest(session) : null;
  if (openRequest) {
    session.conversation.toolInFlight = 'checkAvailability';
    recordVoiceTurnEvent(session, 'availability_started', openRequest);
    let response: string;
    let explicitReplyPlan: ReturnType<typeof buildAvailabilityErrorPlan> | null = null;
    try {
      const result = await mgr.getAvailability(session, openRequest.date, openRequest.partySize);
      if (!isCurrentResponse()) return;
      recordVoiceTurnEvent(session, 'availability_completed', { slotCount: result.slots.length });
      response = buildOpenAvailabilityReply(session, result.slots);
    } catch (err) {
      if (!isCurrentResponse()) return;
      recordVoiceTurnEvent(session, 'availability_failed', {});
      logger.warn(
        { err, callId: session.callControlId },
        '[voice-turn] Open availability lookup failed',
      );
      session.conversation.offeredAvailability = undefined;
      explicitReplyPlan = buildAvailabilityErrorPlan(session);
      response = explicitReplyPlan.reply;
    } finally {
      if (isCurrentResponse()) session.conversation.toolInFlight = null;
    }
    session.turnCount++;
    session.history.push(
      { role: 'user', content: transcript },
      { role: 'assistant', content: response },
    );
    const offeredSlots = session.conversation.offeredAvailability;
    if (explicitReplyPlan) {
      recordAssistantReplyWithPolicy(session, response, explicitReplyPlan.proposal);
    } else if (offeredSlots) {
      recordAssistantReplyWithPolicy(session, response, {
        source: 'explicit',
        operation: 'activate',
        interaction: {
          kind: offeredSlots.slots.length ? 'timeChoice' : 'date',
          prompt: finalAssistantQuestion(response) ?? response,
        },
      });
    } else {
      recordAssistantReplyWithPolicy(session, response, {
        source: 'explicit',
        operation: 'cancel',
      });
    }
    mgr.transition(session, 'SPEAKING');
    await speakTtsStreamed(session, response);
    if (isCurrentResponse()) mgr.transition(session, 'LISTENING');
    return;
  }

  clearDialogueGuardTrace(session);
  // Canary TurnPlan : les relances déterministes ne servent qu'après un tour
  // compris par les extracteurs ; sinon le modèle interprète et propose le plan.
  // Après deux relances du modèle sur la même question, le déterministe reprend
  // la main pour reformuler puis proposer un repli humain réel.
  const turnPlanAuthorityEnabled = isTurnPlanAuthorityEnabled(session.restaurantId);
  const unresolvedContentTurn =
    turnPlanAuthorityEnabled &&
    !explicitEnd &&
    (speechAct === 'content' || speechAct === 'correction') &&
    !isNameCollectionBlocking(session) &&
    !hasDeterministicTurnProgress(
      turnPlanBefore,
      captureTurnPlanPolicySnapshot(session, interactionBeforeTurn?.id ?? null),
    );
  const modelTurnStalled = unresolvedContentTurn && isModelTurnStalled(session);
  if (modelTurnStalled) recordVoiceTurnPlanDeferred('stall_handoff');
  const deferUnresolvedToModel = unresolvedContentTurn && !modelTurnStalled;
  const deterministicReplyPlan = deterministicLanguage
    ? (buildDeterministicTurnPlan(session, speechAct, transcript, { deferUnresolvedToModel }) ??
      (deferUnresolvedToModel ? null : buildReservationProgressPlan(session, transcript)))
    : null;
  const deterministicResponse = deterministicReplyPlan?.reply ?? null;
  const dialogueGuard = session.conversation.lastDialogueGuard;
  if (deterministicResponse && dialogueGuard && dialogueGuard.level !== 'ask') {
    recordVoiceTurnEvent(session, 'dialogue_guard', {
      level: dialogueGuard.level,
      key: dialogueGuard.key,
      count: dialogueGuard.count,
    });
  }
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
    if (deterministicReplyPlan) {
      recordAssistantReplyWithPolicy(
        session,
        deterministicResponse,
        deterministicReplyPlan.proposal,
      );
    }
    // Shadow hors bande : mesure aussi les tours où la regex a décidé seule,
    // sans retarder la réponse déjà prête.
    if (
      turnPlanShadowEnabled &&
      !explicitEnd &&
      (speechAct === 'content' || speechAct === 'correction') &&
      !isNameCollectionBlocking(session) &&
      shouldObserveDeterministicTurnPlan()
    ) {
      const observedTurnId = session.currentTurn?.id;
      const observedAfter = captureTurnPlanPolicySnapshot(
        session,
        interactionBeforeTurn?.id ?? null,
      );
      mgr
        .observeTurnPlan(session, turnPlanContext, deterministicResponse, observedTurnId)
        .then((result) =>
          recordInBandTurnPlanShadow(
            session,
            turnPlanContext,
            result,
            turnPlanBefore,
            observedAfter,
            observedTurnId,
            'deterministic',
          ),
        )
        .catch((err: unknown) =>
          logger.warn({ err }, '[voice-turn] Deterministic TurnPlan observation failed'),
        );
    }
    syncSpellingProfile(session);
    if (!isCurrentResponse()) return;
    mgr.transition(session, 'SPEAKING');
    await speakTtsStreamed(session, deterministicResponse);
    if (isCurrentResponse()) mgr.transition(session, 'LISTENING');
    return;
  }

  let availabilityContext: string | undefined;
  const availabilityRequest = getReadyAvailabilityRequest(session);
  if (availabilityRequest) {
    session.conversation.toolInFlight = 'checkAvailability';
    mgr.transition(session, 'PROCESSING');
    const availabilityStartedAt = Date.now();
    // Réutilise la lecture lancée pendant la phrase du client si elle porte
    // sur la même date et le même nombre de personnes.
    const prefetched = takeAvailabilityPrefetch(
      session,
      availabilityRequest.date,
      availabilityRequest.partySize,
    );
    recordVoiceTurnEvent(session, 'availability_started', {
      prefetched: Boolean(prefetched),
      date: availabilityRequest.date,
      time: availabilityRequest.time,
      partySize: availabilityRequest.partySize,
    });
    try {
      const availabilityPromise = (prefetched ?? Promise.resolve(null)).then(
        (result) =>
          result ??
          mgr.getAvailability(session, availabilityRequest.date, availabilityRequest.partySize),
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
      session.conversation.lastAvailabilityCheck = availabilityRequest.key;
      session.conversation.lastAvailabilityResult = {
        key: availabilityRequest.key,
        date: availabilityRequest.date,
        time: availabilityRequest.time,
        partySize: availabilityRequest.partySize,
        slots: [...result.slots],
      };
      availabilityContext = buildAvailabilityLlmContext({
        request: availabilityRequest,
        availableSlots: result.slots,
        knownCustomerName:
          session.conversation.nameCollection.confirmedName ??
          session.conversation.slots.customerName ??
          null,
      });
    } catch (err) {
      recordVoiceTurnEvent(session, 'availability_failed', {
        durationMs: Date.now() - availabilityStartedAt,
      });
      logger.warn(
        { err, callId: session.callControlId },
        '[voice-turn] Direct availability lookup failed; using a safe deterministic fallback',
      );
      if (isCurrentResponse()) {
        const errorPlan = buildAvailabilityErrorPlan(session);
        const response = errorPlan.reply;
        session.turnCount++;
        session.history.push(
          { role: 'user', content: transcript },
          { role: 'assistant', content: response },
        );
        recordAssistantReplyWithPolicy(session, response, errorPlan.proposal);
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

  // Après une confirmation d'orthographe, le prochain tour doit être un
  // récapitulatif contextualisé. Réutiliser le dernier résultat vérifié évite
  // de redemander le nom et empêche le LLM de déclencher un outil trop tôt.
  if (customerNameTurn.confirmedName && !availabilityContext) {
    const { date, time, partySize } = session.conversation.slots;
    const lastAvailability = session.conversation.lastAvailabilityResult;
    if (date && time && partySize && lastAvailability?.key === `${date}:${time}:${partySize}`) {
      availabilityContext = buildAvailabilityLlmContext({
        request: { date, time, partySize },
        availableSlots: lastAvailability.slots,
        knownCustomerName: customerNameTurn.confirmedName,
      });
    }
  }

  writeDebugLog(`[processTranscriptStreaming] Starting LLM stream for: "${redactPii(transcript)}"`);
  // Une clôture ne peut ni créer ni modifier une réservation : on conserve la
  // formulation libre du LLM mais on omet le schéma d'outils et on borne la
  // réponse, ce qui réduit le prompt et le temps de génération.
  const telemetryTurnId = session.currentTurn?.id;
  let turnPlanRequested = false;
  const shouldCollectInBandTurnPlan =
    turnPlanShadowEnabled &&
    !explicitEnd &&
    speechAct !== 'liveness' &&
    !isNameCollectionBlocking(session);
  const llmOptions = {
    ...(availabilityContext ? { context: availabilityContext, includeTools: false } : {}),
    ...(confirmationTurn ? { includeTools: false } : {}),
    telemetryTurnId,
  };
  const recordTurnPlanObservation = (
    result: InBandTurnPlanResult,
    after = captureTurnPlanPolicySnapshot(session, interactionBeforeTurn?.id ?? null),
  ) => {
    if (!shouldCollectInBandTurnPlan || !telemetryTurnId) return;
    recordInBandTurnPlanShadow(
      session,
      turnPlanContext,
      result,
      turnPlanBefore,
      after,
      telemetryTurnId,
      deferUnresolvedToModel ? 'deferred' : 'llm',
    );
  };
  // Réponse LLM libre : le TurnPlan canary devient l'autorité des faits non
  // sensibles et de l'interaction attendue ; sinon l'inférence texte reste.
  // Le plan est une requête séparée, lancée dès que le texte parlé est connu :
  // l'audio part sans l'attendre, seul l'état du tour patiente (borné).
  const recordLlmReply = async (reply: string): Promise<void> => {
    if (!shouldCollectInBandTurnPlan) {
      recordAssistantReplyFromLlmTextFallback(session, reply);
      if (deferUnresolvedToModel) recordDeferredTurnOutcome('plan_unavailable');
      return;
    }
    turnPlanRequested = true;
    const planResult = await mgr.observeTurnPlan(
      session,
      turnPlanContext,
      reply,
      telemetryTurnId,
      TURN_PLAN_REPLY_WAIT_MS,
    );
    // Réponse devenue périmée (reprise de parole, nouveau tour) : comme avant,
    // elle ne modifie plus l'état.
    if (!isCurrentResponse()) {
      recordTurnPlanObservation({ status: 'aborted', durationMs: planResult.durationMs });
      return;
    }
    const plan = turnPlanAuthorityEnabled && planResult.status === 'valid' ? planResult.plan : null;
    if (!plan) {
      recordAssistantReplyFromLlmTextFallback(session, reply);
      recordTurnPlanObservation(planResult);
      if (deferUnresolvedToModel) recordDeferredTurnOutcome('plan_unavailable');
      return;
    }
    const deterministic = captureTurnPlanPolicySnapshot(session, interactionBeforeTurn?.id ?? null);
    const authority = applyTurnPlanAuthority(session, {
      context: turnPlanContext,
      plan,
      before: turnPlanBefore,
      speechAct,
      reply,
    });
    recordVoiceTurnEventIfCurrent(session, telemetryTurnId, 'turn_plan_authority', {
      appliedFacts: authority.appliedFacts.join(',') || null,
      assistantInteractionSource: authority.assistantInteractionSource,
    });
    // Le shadow reste comparé au déterministe seul, sinon l'accord serait circulaire.
    const after: TurnPlanPolicySnapshot = {
      ...captureTurnPlanPolicySnapshot(session, interactionBeforeTurn?.id ?? null),
      intent: deterministic.intent,
      slots: deterministic.slots,
      activeInteractionKind: authority.legacyAssistantInteraction,
    };
    recordTurnPlanObservation(planResult, after);
    if (deferUnresolvedToModel) {
      recordDeferredTurnOutcome(
        !authority.policyAccepted
          ? 'plan_rejected'
          : authority.appliedFacts.length
            ? 'fact_applied'
            : 'no_fact',
      );
    }
  };
  // Un tour confié au modèle garde le garde-fou anti-boucle : même question
  // reposée sans nouveau fait = relance comptée.
  const recordDeferredTurnOutcome = (outcome: VoiceTurnPlanDeferredOutcome) => {
    recordVoiceTurnPlanDeferred(outcome);
    const stallLevel = recordModelTurnStall(
      session,
      pendingQuestionBeforeTurn,
      hasTurnFactProgress(
        turnPlanBefore,
        captureTurnPlanPolicySnapshot(session, interactionBeforeTurn?.id ?? null),
      ),
    );
    recordVoiceTurnEventIfCurrent(session, telemetryTurnId, 'turn_plan_deferred', {
      outcome,
      stallLevel,
    });
  };

  // ── Thinking filler : combler ponctuellement le silence pendant que le LLM génère.
  // Le délai et la probabilité sont gérés par le scheduler ; une phrase rapide
  // ou une reprise de parole annule le filler avant tout audio.
  if (isCurrentResponse()) {
    scheduleThinkingFiller(session, session.personality?.fillerStyle ?? 'CASUAL');
  }

  // Le TTS Context V2 garde son ciblage ConfigCat indépendant du shadow TurnPlan.
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
  const llmStartedAt = Date.now();
  let llmPhraseReceived = false;
  recordVoiceTurnEventIfCurrent(session, telemetryTurnId, 'llm_started', {
    mode: availabilityContext ? 'availability_context' : 'live',
  });

  try {
    session.abortController = abortController;
    const generatedResponse = await mgr.processUtteranceStreaming(
      session,
      transcriptForLlm,
      (phrase: string) => {
        if (!isCurrentResponse() || abortController.signal.aborted) return;
        llmPhraseReceived = true;
        cancelScheduledFiller(session);
        writeDebugLog(`[processTranscriptStreaming] Phrase received: "${redactPii(phrase)}"`);
        markVoiceTurnLlmFirstPhrase(session, telemetryTurnId);
        recordVoiceTurnEvent(session, 'llm_phrase_generated', {
          characterCount: phrase.length,
        });

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
    const fullResponse = typeof generatedResponse === 'string' ? generatedResponse : '';
    if (!isCurrentResponse() || abortController.signal.aborted) return;
    recordVoiceTurnEventIfCurrent(session, telemetryTurnId, 'llm_completed', {
      mode: availabilityContext ? 'availability_context' : 'live',
      durationMs: Date.now() - llmStartedAt,
      characterCount: fullResponse.length,
    });
    if (!fullResponse.trim() && availabilityContext) {
      // Le LLM reste responsable de la formulation ; ce repli ne sert qu'en
      // cas de réponse vide du transport et reprend les faits vérifiés.
      const fallbackPlan = buildAvailabilityReplyPlan(
        session,
        availabilityRequest ?? {
          date: session.conversation.slots.date!,
          time: session.conversation.slots.time!,
          partySize: session.conversation.slots.partySize!,
        },
        session.conversation.lastAvailabilityResult?.slots ?? [],
        language,
      );
      const fallbackResponse = fallbackPlan.reply;
      session.history.push({ role: 'assistant', content: fallbackResponse });
      recordAssistantReplyWithPolicy(session, fallbackResponse, fallbackPlan.proposal);
      mgr.transition(session, 'SPEAKING');
      await speakTtsStreamed(session, fallbackResponse);
      if (isCurrentResponse()) mgr.transition(session, 'LISTENING');
      return;
    }
    const replyRecorded = recordLlmReply(fullResponse)
      .then(() => {
        if (isCurrentResponse()) syncSpellingProfile(session);
      })
      .catch((err: unknown) =>
        logger.warn(
          { err, callId: session.callControlId },
          '[processTranscriptStreaming] Failed to record LLM reply state',
        ),
      );

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
    await replyRecorded;

    if (isCurrentResponse()) {
      mgr.transition(session, 'LISTENING');
      writeDebugLog(`[processTranscriptStreaming] Transitioned back to LISTENING`);
    }
  } catch (err: unknown) {
    if (shouldCollectInBandTurnPlan && !turnPlanRequested) {
      recordTurnPlanObservation({
        status: abortController.signal.aborted ? 'aborted' : 'failed',
        durationMs: Date.now() - llmStartedAt,
      });
    }
    recordVoiceTurnEventIfCurrent(session, telemetryTurnId, 'llm_interrupted', {
      mode: availabilityContext ? 'availability_context' : 'live',
      reason: abortController.signal.aborted ? 'aborted' : 'error',
      durationMs: Date.now() - llmStartedAt,
    });
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
    // Délai dépassé ou erreur avant tout audio : ne jamais laisser un silence.
    // Une excuse courte puis la dernière question, qui reste en attente.
    if (!llmPhraseReceived && isSessionActiveForTts(session)) {
      cancelScheduledFiller(session);
      const recovery = buildLlmRecoveryReply(session);
      session.history.push({ role: 'assistant', content: recovery });
      mgr.transition(session, 'SPEAKING');
      await speakTtsStreamed(session, recovery);
      if (isCurrentResponse()) mgr.transition(session, 'LISTENING');
      return;
    }
    mgr.transition(session, 'LISTENING');
  } finally {
    cancelScheduledFiller(session);
    if (session.ttsContext === contextTtsRef.current) session.ttsContext = null;
    if (session.abortController === abortController) session.abortController = null;
  }
}

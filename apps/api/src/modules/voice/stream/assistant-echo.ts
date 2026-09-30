import type { CallSession } from './types';
import {
  voiceEchoSparedTotal,
  voiceEchoSuppressedTotal,
} from '../../../shared/observability/metrics';
import { callerSpokeClearlySince } from './caller-voice-activity';
import { logVoiceDebugText } from './debug-dialogue';
import { logger } from '../../../shared/logger/pino';

export type EchoStage = 'partial' | 'committed';

export interface AssistantEchoFilterResult {
  transcript: string;
  suppressed: boolean;
  strippedPrefix: boolean;
  nonEchoWordCount: number;
}

function tokens(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('fr-FR')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean);
}

function isExplicitInterruption(words: string[]): boolean {
  return words.length === 1 && ['non', 'stop', 'attends', 'attendez', 'wait'].includes(words[0]);
}

function longestPrefixInAgent(caller: string[], agent: string[]): number {
  let longest = 0;
  for (let start = 0; start < agent.length; start++) {
    let length = 0;
    while (
      length < caller.length &&
      start + length < agent.length &&
      caller[length] === agent[start + length]
    ) {
      length++;
    }
    longest = Math.max(longest, length);
  }
  return longest;
}

function orderedOverlap(caller: string[], agent: string[]): number {
  let cursor = 0;
  let matched = 0;
  for (const word of caller) {
    const index = agent.indexOf(word, cursor);
    if (index < 0) continue;
    matched++;
    cursor = index + 1;
  }
  return matched;
}

/**
 * Quand l'audio montre que l'appelant parle clairement, deux ou trois mots communs avec l'agent sont une
 * coïncidence (« bonjour vous », « je vous »), pas un écho : appels 5cebe456 et ce dernier test, où
 * « je vous appelle pour » devenait « appelle pour ». Seule une répétition longue de l'agent reste filtrée.
 */
const SPOKEN_OVER_MIN_PREFIX_WORDS = 4;
const SPOKEN_OVER_MIN_OVERLAP_WORDS = 5;
const SPOKEN_OVER_MIN_OVERLAP_RATIO = 0.8;
/** La parole claire compte si elle date de l'énoncé en cours (début de parole entendu, à peu près). */
const SPEECH_START_MARGIN_MS = 300;
const DEFAULT_LOOKBACK_MS = 2_000;

function callerIsClearlySpeaking(session: CallSession, now: number): boolean {
  const since =
    (session.sttLastSpeechStartedAt ?? now - DEFAULT_LOOKBACK_MS) - SPEECH_START_MARGIN_MS;
  return callerSpokeClearlySince(session, since);
}

/** Retard acoustique de l'écho après la fin de l'audio de l'agent (haut-parleur → micro). */
export const ECHO_ACOUSTIC_TAIL_MS = 900;

function isInEchoWindow(session: CallSession, now: number): boolean {
  if (
    session.agentAudioActive ||
    (session.agentAudioEndedAt !== undefined && now - session.agentAudioEndedAt <= 1_000)
  ) {
    return true;
  }
  // Aligné sur le moment où l'appelant a été *entendu* et non sur l'arrivée de la transcription :
  // une transcription d'écho arrive 0,5 à 1,5 s après le son, souvent hors des 1 s ci-dessus.
  // Un « c'est bien ça » dit après la fin de l'agent commence après le tail et n'est pas touché.
  const heardAt = session.sttLastSpeechStartedAt;
  if (heardAt === undefined || now - heardAt > 15_000) return false;
  return Boolean(
    session.agentAudioSpans?.some(
      (span) =>
        heardAt >= span.startedAt &&
        (span.endedAt === undefined || heardAt <= span.endedAt + ECHO_ACOUSTIC_TAIL_MS),
    ),
  );
}

/** Filtre les reprises STT qui recouvrent le texte récemment envoyé par l'agent. */
export function filterAssistantEcho(
  session: CallSession,
  transcript: string,
  stage: EchoStage,
  now = Date.now(),
): AssistantEchoFilterResult {
  const callerWords = tokens(transcript);
  const agentWords = tokens(session.recentAgentSpeechText ?? '');
  const unchanged = {
    transcript,
    suppressed: false,
    strippedPrefix: false,
    nonEchoWordCount: callerWords.length,
  };
  if (!callerWords.length || !agentWords.length || !isInEchoWindow(session, now)) return unchanged;
  if (isExplicitInterruption(callerWords)) return unchanged;

  const speakingClearly = callerIsClearlySpeaking(session, now);
  const prefixLength = longestPrefixInAgent(callerWords, agentWords);
  const prefixWouldStrip = prefixLength >= 2 && prefixLength < callerWords.length;
  const prefixStrips =
    prefixWouldStrip && (!speakingClearly || prefixLength >= SPOKEN_OVER_MIN_PREFIX_WORDS);
  if (prefixStrips) {
    const remainder = callerWords.slice(prefixLength);
    const rawWords = [...transcript.matchAll(/[\p{L}\p{N}]+/gu)];
    const suffixStart = rawWords[prefixLength]?.index;
    const result = {
      transcript:
        suffixStart === undefined ? remainder.join(' ') : transcript.slice(suffixStart).trim(),
      suppressed: false,
      strippedPrefix: true,
      nonEchoWordCount: remainder.length,
    };
    logVoiceDebugText(session, 'echo_prefix_stripped', {
      stage,
      before: transcript,
      after: result.transcript,
      agentSpeech: session.recentAgentSpeechText,
    });
    voiceEchoSuppressedTotal.inc({ stage });
    logger.info(
      {
        callId: session.callControlId,
        stage,
        outcome: 'prefix_stripped',
        callerWords: callerWords.length,
        keptWords: remainder.length,
      },
      '[stt] Assistant echo filtered',
    );
    return result;
  }

  const overlap = orderedOverlap(callerWords, agentWords);
  const overlapWouldSuppress =
    callerWords.length >= 2 &&
    overlap >= 2 &&
    (overlap === callerWords.length || overlap / callerWords.length >= 0.7);
  const overlapSuppresses =
    overlapWouldSuppress &&
    (!speakingClearly ||
      (callerWords.length >= SPOKEN_OVER_MIN_OVERLAP_WORDS &&
        overlap >= SPOKEN_OVER_MIN_OVERLAP_WORDS - 1 &&
        overlap / callerWords.length >= SPOKEN_OVER_MIN_OVERLAP_RATIO));
  if (overlapSuppresses) {
    logVoiceDebugText(session, 'echo_suppressed', {
      stage,
      before: transcript,
      agentSpeech: session.recentAgentSpeechText,
    });
    voiceEchoSuppressedTotal.inc({ stage });
    logger.info(
      {
        callId: session.callControlId,
        stage,
        outcome: 'suppressed',
        callerWords: callerWords.length,
      },
      '[stt] Assistant echo filtered',
    );
    return { ...unchanged, transcript: '', suppressed: true, nonEchoWordCount: 0 };
  }

  if (prefixWouldStrip || overlapWouldSuppress) {
    // Les anciennes règles auraient retiré ces mots : l'audio dit que l'appelant parlait.
    logVoiceDebugText(session, 'echo_spared', {
      stage,
      kept: transcript,
      agentSpeech: session.recentAgentSpeechText,
    });
    voiceEchoSparedTotal.inc({ stage });
    logger.info(
      {
        callId: session.callControlId,
        stage,
        outcome: 'spared_caller_speaking',
        callerWords: callerWords.length,
      },
      '[stt] Assistant echo filter spared the caller',
    );
  }
  return unchanged;
}

export function hasBargeInWordThreshold(result: AssistantEchoFilterResult): boolean {
  return !result.strippedPrefix || result.nonEchoWordCount >= 2;
}

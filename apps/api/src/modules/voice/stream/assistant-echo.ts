import type { CallSession } from './types';
import { voiceEchoSuppressedTotal } from '../../../shared/observability/metrics';
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

  const prefixLength = longestPrefixInAgent(callerWords, agentWords);
  if (prefixLength >= 2 && prefixLength < callerWords.length) {
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
  if (
    callerWords.length >= 2 &&
    overlap >= 2 &&
    (overlap === callerWords.length || overlap / callerWords.length >= 0.7)
  ) {
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

  return unchanged;
}

export function hasBargeInWordThreshold(result: AssistantEchoFilterResult): boolean {
  return !result.strippedPrefix || result.nonEchoWordCount >= 2;
}

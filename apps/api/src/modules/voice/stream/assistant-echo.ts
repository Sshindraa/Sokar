import type { CallSession } from './types';
import { voiceEchoSuppressedTotal } from '../../../shared/observability/metrics';

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

function isInEchoWindow(session: CallSession, now: number): boolean {
  return Boolean(
    session.agentAudioActive ||
    (session.agentAudioEndedAt !== undefined && now - session.agentAudioEndedAt <= 1_000),
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
    return result;
  }

  const overlap = orderedOverlap(callerWords, agentWords);
  if (
    callerWords.length >= 2 &&
    overlap >= 2 &&
    (overlap === callerWords.length || overlap / callerWords.length >= 0.7)
  ) {
    voiceEchoSuppressedTotal.inc({ stage });
    return { ...unchanged, transcript: '', suppressed: true, nonEchoWordCount: 0 };
  }

  return unchanged;
}

export function hasBargeInWordThreshold(result: AssistantEchoFilterResult): boolean {
  return !result.strippedPrefix || result.nonEchoWordCount >= 2;
}

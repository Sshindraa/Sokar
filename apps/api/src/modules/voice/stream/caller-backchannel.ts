import { describeInterruptionEvidence } from './barge-in-evidence';
import { callerSilenceMs } from './caller-voice-activity';
import { clearFastBargeIn } from './fast-barge-in';
import { conversationContinuityEnabledFor } from './feature-flags';
import { splitHeardReply } from './interrupted-reply';
import { recordVoiceTurnEvent } from './turn-telemetry';
import type { CallSession, SttWord } from './types';

interface Candidate {
  generation: number;
  speechStartedAt: number | undefined;
  lastVoiceAt: number | undefined;
  at: number;
  text: string;
}

const candidates = new WeakMap<CallSession, Candidate>();
const MAX_ACK_VOICE_MS = 600;
const MAX_FINAL_DELAY_MS = 2_000;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function clearBackchannelCandidate(session: CallSession): void {
  candidates.delete(session);
}

/** Le début de la première question, qui ne doit jamais être masqué par un acquiescement. */
function firstQuestionStart(text: string): number | null {
  for (const match of text.matchAll(/[^.!?…]*[.!?…]/gu)) {
    if (match[0].endsWith('?')) return match.index + match[0].length - match[0].trimStart().length;
  }
  return null;
}

/**
 * Cas prudent : acquiescement bref pendant une explication déjà commencée, avant sa question.
 * Aucun traitement des « non », corrections, relectures ou confirmations métier ; sans preuve
 * audio/texte suffisante, le chemin habituel de prise de parole reste responsable.
 */
export function handleCallerBackchannel(
  session: CallSession,
  transcript: string,
  stage: 'partial' | 'committed',
  words?: readonly SttWord[],
): boolean {
  if (!conversationContinuityEnabledFor(session.restaurantId)) return false;
  const text = normalize(transcript);
  const shortAck =
    !transcript.includes('?') && /^(?:oui|ouais|ok|okay|d accord|hum hum|mhm|yes|yeah)$/.test(text);
  const candidate = candidates.get(session);
  const sameUtterance =
    candidate &&
    candidate.generation === session.responseGeneration &&
    candidate.text === text &&
    candidate.speechStartedAt !== undefined &&
    candidate.speechStartedAt === session.sttLastSpeechStartedAt &&
    candidate.lastVoiceAt !== undefined &&
    candidate.lastVoiceAt === session.callerVoice?.lastVoiceAt &&
    Date.now() - candidate.at <= MAX_FINAL_DELAY_MS;
  if (!shortAck || (candidate && !sameUtterance)) candidates.delete(session);
  if (!shortAck) return false;

  const knownVoiceMs = describeInterruptionEvidence(transcript, words).voiceMs;
  const voice = session.callerVoice;
  const audioVoiceMs =
    (voice?.trackedMs ?? 0) >= 500 &&
    voice?.lastVoiceAt !== undefined &&
    session.sttLastSpeechStartedAt !== undefined
      ? voice.lastVoiceAt - session.sttLastSpeechStartedAt
      : null;
  const voiceMs = knownVoiceMs ?? audioVoiceMs;
  if (voiceMs === null || voiceMs < 0 || voiceMs > MAX_ACK_VOICE_MS) {
    candidates.delete(session);
    return false;
  }

  if (!(stage === 'committed' && sameUtterance)) {
    if (session.state !== 'SPEAKING' || !session.agentAudioActive || session.greetingPlaying)
      return false;
    const awaiting = session.agentReplyAwaiting ?? session.structuredTurn?.lastAwaiting;
    if (
      awaiting === 'confirmation' ||
      awaiting === 'confirmationResume' ||
      awaiting === 'customerNameConfirmation'
    )
      return false;
    const snapshot = session.ttsContext?.interruptionSnapshot?.();
    if (!snapshot?.text || snapshot.playedMs <= 0) return false;
    const heard = splitHeardReply(
      snapshot.text,
      snapshot.playedMs,
      snapshot.totalMs,
      snapshot.alignment,
    ).heard;
    // Les premiers mots / sons d'attente ne suffisent pas à prouver une explication.
    if ((heard.match(/[\p{L}\p{N}]+/gu) ?? []).length < 4) return false;
    const questionStart = firstQuestionStart(snapshot.text);
    // Marge avant la question : la mesure de réception est une estimation, pas une preuve acoustique.
    if (questionStart !== null && heard.length + 20 >= questionStart) return false;
  }

  // Si la voix s'est déjà arrêtée, reprendre immédiatement la pause réversible. Sinon son
  // minuteur reste actif : une voix qui se prolonge peut toujours devenir une vraie interruption.
  if (session.fastBargeIn?.paused && callerSilenceMs(session) >= 200) {
    clearFastBargeIn(session);
    session.ttsContext?.resume?.();
  }
  if (stage === 'partial') {
    candidates.set(session, {
      generation: session.responseGeneration,
      speechStartedAt: session.sttLastSpeechStartedAt,
      lastVoiceAt: session.callerVoice?.lastVoiceAt,
      at: candidate?.at ?? Date.now(),
      text,
    });
  } else {
    candidates.delete(session);
    recordVoiceTurnEvent(session, 'caller_backchannel', { outcome: 'continued_reply' });
  }
  return true;
}

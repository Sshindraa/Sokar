/**
 * Doublons de transcription. La reconnaissance livre parfois deux fois le même énoncé (segment forcé,
 * puis segment naturel). Le pipeline ignore le second ; l'interruption de l'agent doit en faire autant,
 * sinon le doublon coupe la réponse au tour qu'il répète, puis est écarté sans que rien ne la relance
 * (appel 30172d22 : la réponse « Bonjour, vous souhaitez réserver une table ? » coupée après 0,5 s).
 * Comparaison de texte normalisé et d'étape de dialogue : aucune liste de phrases.
 */
import { TRANSCRIPT_DEDUPE_WINDOW_MS } from '../../../shared/constants/timeouts';
import type { CallSession } from './types';

export function normalizeTranscriptForDedupe(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Le même mot peut être une réponse légitime à deux questions successives (« oui » pour valider le
 * nom, puis « oui » pour valider le récapitulatif) : l'étape du dialogue distingue ces tours.
 */
export function dialogueContextOf(session: CallSession): string {
  return `${session.conversation?.pendingQuestion ?? ''}|${session.conversation?.lastAssistantQuestion ?? ''}`;
}

/** Ce texte répète le dernier tour traité, à la même étape du dialogue, dans la fenêtre de doublon. */
export function isRepeatOfLastProcessedTurn(
  session: CallSession,
  transcript: string,
  now = Date.now(),
): boolean {
  const normalized = normalizeTranscriptForDedupe(transcript);
  return (
    normalized !== '' &&
    normalizeTranscriptForDedupe(session.lastProcessedTranscript ?? '') === normalized &&
    session.lastProcessedDialogueContext === dialogueContextOf(session) &&
    session.lastProcessedAt !== undefined &&
    now - session.lastProcessedAt < TRANSCRIPT_DEDUPE_WINDOW_MS
  );
}

/**
 * Dialogue par tour, pour analyser des appels de test.
 *
 * Seuls les restaurants listés dans VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS sont
 * concernés (liste vide = désactivé) : un restaurant client n'a jamais son
 * dialogue enregistré. Le texte passe par redactPii() (téléphones, e-mails) et
 * reste en base 14 jours (table voice_debug_turns, purge quotidienne).
 */
import { redactPii } from './pii-redact';
import type { CallSession, VoiceTurnDebugDialogue } from './types';

export const VOICE_DEBUG_DIALOGUE_RETENTION_DAYS = 14;

export function isVoiceDebugDialogueEnabled(restaurantId: string): boolean {
  const restaurantIds = (process.env.VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return restaurantIds.includes(restaurantId);
}

function currentDialogue(
  session: Pick<CallSession, 'restaurantId' | 'currentTurn'>,
): VoiceTurnDebugDialogue | null {
  const turn = session.currentTurn;
  if (!turn || !isVoiceDebugDialogueEnabled(session.restaurantId)) return null;
  return (turn.debugDialogue ??= { agentSpeech: [], fillers: [], tools: [] });
}

export function recordDebugCallerText(session: CallSession, text: string): void {
  const dialogue = currentDialogue(session);
  if (!dialogue || !text.trim()) return;
  // Un tour peut recevoir plusieurs commits Scribe (reprise de parole).
  const clean = redactPii(text.trim());
  dialogue.callerText = dialogue.callerText ? `${dialogue.callerText} ${clean}` : clean;
}

export function recordDebugAgentSpeech(
  session: CallSession,
  text: string,
  kind: 'speech' | 'filler' = 'speech',
): void {
  const dialogue = currentDialogue(session);
  if (!dialogue || !text.trim()) return;
  (kind === 'filler' ? dialogue.fillers : dialogue.agentSpeech).push(redactPii(text.trim()));
}

export function recordDebugTool(session: CallSession, name: string): void {
  const dialogue = currentDialogue(session);
  if (dialogue) dialogue.tools.push(name);
}

export function recordDebugSpeechAct(session: CallSession, speechAct: string): void {
  const dialogue = currentDialogue(session);
  if (dialogue) dialogue.speechAct = speechAct;
}

/** Supprime les dialogues de test arrivés à échéance (tâche quotidienne). */
export async function purgeExpiredVoiceDebugTurns(now = new Date()): Promise<number> {
  const { db } = await import('../../../shared/db/client');
  // tenant-scoping: global — purge de rétention sur tous les restaurants de test.
  const { count } = await db.voiceDebugTurn.deleteMany({ where: { expiresAt: { lte: now } } });
  return count;
}

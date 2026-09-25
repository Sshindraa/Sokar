/**
 * Dialogue par tour, pour analyser des appels de test.
 *
 * Seuls les restaurants listés dans VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS sont
 * concernés (liste vide = désactivé) : un restaurant client n'a jamais son
 * dialogue enregistré. Le texte passe par redactPii() (téléphones, e-mails) et
 * reste en base 14 jours (table voice_debug_turns, purge quotidienne).
 */
import { redactPii } from './pii-redact';
import type { CallSession, DebugSpeechEntry, VoiceTurnDebugDialogue } from './types';

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

/**
 * Note une réplique au moment où elle est demandée. Son statut reste « pending »
 * jusqu'à settleDebugSpeech : une réplique dont aucun audio n'est parti ne doit
 * pas apparaître comme dite.
 */
export function recordDebugAgentSpeech(
  session: CallSession,
  text: string,
  kind: 'speech' | 'filler' = 'speech',
): DebugSpeechEntry | null {
  rememberRecentAgentSpeech(session, text);
  const dialogue = currentDialogue(session);
  if (!dialogue || !text.trim()) return null;
  const entry: DebugSpeechEntry = { text: redactPii(text.trim()), status: 'pending' };
  (kind === 'filler' ? dialogue.fillers : dialogue.agentSpeech).push(entry);
  return entry;
}

export function rememberRecentAgentSpeech(session: CallSession, text: string): void {
  if (!text.trim()) return;
  const turnId = session.currentTurn?.id;
  if (session.recentAgentSpeechTurnId !== turnId) {
    session.recentAgentSpeechText = '';
    session.recentAgentSpeechTurnId = turnId;
  }
  session.recentAgentSpeechText = `${session.recentAgentSpeechText ?? ''} ${text.trim()}`
    .trim()
    .slice(-2_000);
}

/** Complète une réplique lue d'un seul flux (contexte Cartesia). */
export function appendDebugSpeechText(entry: DebugSpeechEntry, text: string): void {
  if (text.trim()) entry.text = `${entry.text} ${redactPii(text.trim())}`;
}

/**
 * Fixe le sort de l'audio d'une réplique à partir de ses propres trames :
 * aucune envoyée, envoi coupé en route, ou tout envoyé.
 */
export function settleDebugSpeech(
  entry: DebugSpeechEntry | null,
  framesSent: number,
  completed: boolean,
): void {
  if (!entry || entry.status !== 'pending') return;
  entry.status = framesSent <= 0 ? 'not_sent' : completed ? 'sent' : 'partially_sent';
}

/**
 * Texte persisté : répliques envoyées, les coupées marquées, celles sans audio
 * omises. « Envoyé » reste distinct d'« entendu » (tampon Telnyx vidé au barge-in).
 */
export function formatDebugSpeech(entries: readonly DebugSpeechEntry[]): string | null {
  const parts = entries
    .filter((entry) => entry.status !== 'not_sent')
    .map((entry) =>
      entry.status === 'sent'
        ? entry.text
        : `${entry.text} [${entry.status === 'partially_sent' ? 'envoi coupé' : 'en cours'}]`,
    );
  return parts.join(' ') || null;
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

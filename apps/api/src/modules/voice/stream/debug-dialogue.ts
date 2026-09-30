/**
 * Dialogue par tour, pour analyser des appels de test.
 *
 * Seuls les restaurants listés dans VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS sont
 * concernés (liste vide = désactivé) : un restaurant client n'a jamais son
 * dialogue enregistré. Le texte passe par redactPii() (téléphones, e-mails) et
 * reste en base 14 jours (table voice_debug_turns, purge quotidienne).
 */
import { redactPii } from './pii-redact';
import { logger } from '../../../shared/logger/pino';
import type { CallSession, DebugSpeechEntry, VoiceTurnDebugDialogue } from './types';

export const VOICE_DEBUG_DIALOGUE_RETENTION_DAYS = 14;

export function isVoiceDebugDialogueEnabled(restaurantId: string): boolean {
  const restaurantIds = (process.env.VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return restaurantIds.includes(restaurantId);
}

/**
 * Texte brut d'un événement STT (avant/après le filtre d'écho, segments finals, partielle au moment
 * d'une fin de tour forcée), pour comprendre pourquoi un mot a été perdu : les nombres de mots ne
 * suffisent pas (appel de test du 30/09 20 h 01). Même périmètre que le dialogue par tour : seuls les
 * restaurants de VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS, téléphones et e-mails masqués. Ces lignes
 * restent dans les journaux du serveur (rotation de 14 jours), sans envoi vers un service externe.
 */
export function logVoiceDebugText(
  session: Pick<CallSession, 'restaurantId' | 'callControlId'>,
  event: string,
  fields: Record<string, string | number | boolean | undefined>,
): void {
  if (!isVoiceDebugDialogueEnabled(session.restaurantId)) return;
  const safe = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      typeof value === 'string' ? redactPii(value) : value,
    ]),
  );
  logger.info(
    { callId: session.callControlId, voiceDebug: event, ...safe },
    '[voice-debug] raw text',
  );
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

/** Un écho revient avec le retard acoustique de l'appelant plus celui de la transcription. */
export const RECENT_AGENT_SPEECH_MS = 20_000;

/**
 * Mémorise ce que l'agent dit, toutes répliques confondues (accueil, phrases suivantes d'une
 * réponse). Le texte de référence de l'anti-écho est celui des dernières secondes, et non celui du
 * tour courant : l'écho d'une phrase arrive dans le tour suivant (appel 1b3f85e9).
 */
export function rememberRecentAgentSpeech(
  session: CallSession,
  text: string,
  now = Date.now(),
): void {
  if (!text.trim()) return;
  const log = (session.agentSpeechLog ??= []);
  log.push({ text: text.trim(), at: now });
  while (log.length && now - log[0].at > RECENT_AGENT_SPEECH_MS) log.shift();
  session.recentAgentSpeechText = log
    .map((entry) => entry.text)
    .join(' ')
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

/**
 * Juge de fin de tour séparé du modèle de dialogue.
 *
 * `turnComplete` était le premier champ de la grosse requête du tour (règles de réservation, état vérifié,
 * calendrier) et tenait mal : « je voudrais bien venir » jugé fini 5 fois sur 6 au banc. Ici une requête minimale,
 * qui ne voit que la dernière question de l'agent et ce que l'appelant a dit, et qui ne rend que `{ complete }`.
 * Aucune règle de réservation, aucun exemple, aucun mot-clé. Banc A/B (24 tirages, DeepInfra) : le cas réel
 * 1/16 → 16/16, la famille « attente » 65 % → 84 %, témoins 100 % → 100 %.
 *
 * Il tourne en parallèle du passage anticipé. Délai dépassé, erreur ou réponse invalide : verdict nul, et l'appelant
 * du juge garde le `turnComplete` du modèle comme avant.
 */
import type { CallSession, ChatMessage } from '../types';
import type { CallSessionManager } from '../manager';
import { logger } from '../../../../shared/logger/pino';
import {
  voiceTurnJudgeDurationMs,
  voiceTurnJudgeTotal,
} from '../../../../shared/observability/metrics';

export const TURN_END_JUDGE_INSTRUCTIONS =
  "Tu juges un seul point. Un agent téléphonique vient de poser une question et l'appelant répond. " +
  "La transcription vient d'une reconnaissance vocale au téléphone : elle peut s'arrêter en plein milieu d'une phrase ou d'une pensée. " +
  "Dis si l'appelant a terminé ce qu'il avait à dire pour le moment (complete=true), ou si tu attends encore la suite (complete=false).";

export const TURN_END_JUDGE_SCHEMA_NAME = 'turn_end_judge';

export const TURN_END_JUDGE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: TURN_END_JUDGE_SCHEMA_NAME,
    strict: true as const,
    schema: {
      type: 'object',
      properties: { complete: { type: 'boolean' } },
      required: ['complete'],
      additionalProperties: false,
    },
  },
};

/** Délai maximal du juge (ms) : au-delà, on garde le `turnComplete` du modèle. p90 mesuré du juge : 267 ms. */
export function turnEndJudgeTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.VOICE_TURN_JUDGE_TIMEOUT_MS ?? 800);
  return Number.isFinite(parsed) && parsed >= 200 && parsed <= 3_000 ? parsed : 800;
}

export function lastAgentQuestion(history: ChatMessage[]): string | undefined {
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index];
    if (
      message.role === 'assistant' &&
      typeof message.content === 'string' &&
      message.content.trim()
    ) {
      return message.content;
    }
  }
  return undefined;
}

export function buildTurnEndJudgeMessages(
  lastQuestion: string | undefined,
  transcript: string,
): ChatMessage[] {
  return [
    { role: 'system', content: TURN_END_JUDGE_INSTRUCTIONS },
    {
      role: 'user',
      content: `Dernière question de l'agent : ${lastQuestion ?? '(aucune)'}\nCe que l'appelant a dit : ${transcript}`,
    },
  ];
}

/** Verdict lu dans la réponse du juge, ou null si elle n'est pas `{ complete: boolean }`. */
export function parseTurnEndJudgeVerdict(text: string): boolean | null {
  try {
    const value = (JSON.parse(text) as { complete?: unknown }).complete;
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null;
  }
}

interface JudgeEntry {
  key: string;
  verdict: Promise<boolean | null>;
}

/** Le dernier verdict lancé par appel : la spéculation et le tour final de la même phrase le partagent. */
const entries = new WeakMap<CallSession, JudgeEntry>();

/**
 * Lance (ou reprend) le juge pour cette phrase. Ne rejette jamais : null en cas de délai dépassé, d'erreur ou de
 * réponse invalide. Une même phrase après la même question n'est jugée qu'une fois.
 */
export function startTurnEndJudge(
  session: CallSession,
  mgr: Pick<CallSessionManager, 'streamStructuredCompletion'>,
  transcript: string,
): Promise<boolean | null> {
  const question = lastAgentQuestion(session.history);
  const key = JSON.stringify([question ?? null, transcript]);
  const current = entries.get(session);
  if (current?.key === key) return current.verdict;

  const controller = new AbortController();
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, turnEndJudgeTimeoutMs());
    timer.unref?.();
  });
  const request = (async (): Promise<boolean | null> => {
    const text = await mgr.streamStructuredCompletion(
      session,
      buildTurnEndJudgeMessages(question, transcript),
      TURN_END_JUDGE_FORMAT,
      { signal: controller.signal, maxTokens: 30, onDelta: () => undefined },
    );
    return parseTurnEndJudgeVerdict(text);
  })();
  const verdict = Promise.race([request, timedOut])
    .catch((err: unknown) => {
      logger.warn(
        { err: err instanceof Error ? err.name : String(err), callId: session.callControlId },
        '[turn-judge] Request failed, falling back to turnComplete',
      );
      return null;
    })
    .then((result) => {
      if (timer) clearTimeout(timer);
      voiceTurnJudgeDurationMs.observe(Date.now() - startedAt);
      voiceTurnJudgeTotal.inc({
        outcome: result === null ? 'unavailable' : result ? 'complete' : 'incomplete',
      });
      return result;
    });
  // Une requête abandonnée par le délai peut encore échouer plus tard : jamais une erreur non gérée.
  request.catch(() => undefined);
  entries.set(session, { key, verdict });
  return verdict;
}

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
import { callerSilenceMs } from '../caller-voice-activity';
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

/**
 * Désaccord : le juge attend la suite alors que le modèle a jugé l'appelant fini et que sa réponse est prête.
 * Banc du 16/10 (Cerebras) : le juge seul a raison sur « demain à 14 heures non » (une correction arrive), le
 * modèle seul sur un début abandonné suivi d'une question complète (« bonjour je voudrais faire vous êtes ouvert
 * dimanche soir », 1/6 contre 3/3). En production, 10 « inachevé » sur 15 n'ont été suivis d'aucune parole :
 * 1,5 à 4,6 s de silence, puis une nouvelle requête au modèle. Ni l'un ni l'autre ne tranche : c'est le silence
 * réel de l'appelant qui décide. Silence de cette durée depuis sa dernière voix : la réponse prête part ; voix
 * reprise : le verdict du juge tient. 0 désactive (le juge l'emporte, comme avant).
 */
export function turnJudgeDisagreementSilenceMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.VOICE_TURN_JUDGE_DISAGREEMENT_SILENCE_MS ?? 1_200);
  if (parsed === 0) return 0;
  return Number.isFinite(parsed) && parsed >= 400 && parsed <= 3_000 ? parsed : 1_200;
}

export type JudgeDisagreementOutcome = 'silent' | 'resumed' | 'no_audio' | 'disabled' | 'aborted';

/** Moins d'audio suivi que cela : le détecteur de voix ne permet pas de constater un silence. */
const MIN_TRACKED_AUDIO_MS = 500;
const DISAGREEMENT_POLL_MS = 20;

/**
 * Attend, après un désaccord, que l'appelant se taise assez longtemps (`silent`) ou reprenne la parole depuis
 * `sinceMs`, la réception de sa phrase (`resumed`). Sans audio suivi, rien n'est constaté (`no_audio`) : le juge
 * l'emporte. Une voix faible ou un bruit compte comme une reprise : dans le doute, on garde l'attente du juge.
 */
export async function awaitCallerAfterJudgeDisagreement(
  session: CallSession,
  sinceMs: number,
  shouldContinue: () => boolean,
): Promise<JudgeDisagreementOutcome> {
  const silenceMs = turnJudgeDisagreementSilenceMs();
  if (silenceMs === 0) return 'disabled';
  const voice = session.callerVoice;
  if (!voice || (voice.trackedMs ?? 0) < MIN_TRACKED_AUDIO_MS) return 'no_audio';
  while (shouldContinue()) {
    const lastVoiceAt = session.callerVoice?.lastVoiceAt;
    if (lastVoiceAt !== undefined && lastVoiceAt > sinceMs) return 'resumed';
    if (callerSilenceMs(session) >= silenceMs) return 'silent';
    await new Promise((resolve) => setTimeout(resolve, DISAGREEMENT_POLL_MS));
  }
  return 'aborted';
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
  instructions: string = TURN_END_JUDGE_INSTRUCTIONS,
): ChatMessage[] {
  return [
    { role: 'system', content: instructions },
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
      { signal: controller.signal, maxTokens: 30, kind: 'judge', onDelta: () => undefined },
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

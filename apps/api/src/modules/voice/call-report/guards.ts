/** Déclenchements des garde-fous pendant l'appel, avec le texte concerné, d'après les journaux. */
import type { LogTurn } from './log-events';

export type GuardType =
  | 'phrase_dropped'
  | 'spelled_name_mismatch'
  | 'party_size_correction'
  | 'action_refused'
  | 'echo_stripped'
  | 'echo_suppressed';

export interface Guard {
  type: GuardType;
  turnId: string;
  text: string;
  detail?: string;
}

export function collectGuards(turns: readonly LogTurn[]): Guard[] {
  const guards: Guard[] = [];
  for (const turn of turns) {
    for (const dropped of turn.droppedPhrases) {
      guards.push({
        type: 'phrase_dropped',
        turnId: turn.turnId,
        text: dropped.text,
        ...(dropped.reason ? { detail: dropped.reason } : {}),
      });
    }
    for (const decision of turn.decisions) {
      const verdict = decision.actionDecision;
      if (!verdict || verdict === 'allowed') continue;
      const say = turn.outputs[0]?.say ?? '';
      if (verdict === 'spelled_name_mismatch' || verdict === 'party_size_correction') {
        guards.push({ type: verdict, turnId: turn.turnId, text: say });
      } else {
        guards.push({ type: 'action_refused', turnId: turn.turnId, text: say, detail: verdict });
      }
    }
    for (const echo of turn.echoEvents) {
      if (echo.type === 'echo_prefix_stripped') {
        guards.push({
          type: 'echo_stripped',
          turnId: turn.turnId,
          text: `${echo.before ?? ''} → ${echo.after ?? ''}`,
        });
      } else if (echo.type === 'echo_suppressed') {
        guards.push({
          type: 'echo_suppressed',
          turnId: turn.turnId,
          text: echo.before ?? echo.kept ?? '',
        });
      }
    }
  }
  return guards;
}

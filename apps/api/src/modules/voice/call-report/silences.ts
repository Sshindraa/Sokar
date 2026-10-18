/**
 * Silences perçus et leur cause.
 *
 * Un silence perçu est un intervalle où aucune des deux pistes ne porte de parole (énergie par
 * trame, voir energy.ts), pas un délai lu dans les journaux. La cause est tirée des journaux du
 * tour qui précède : verdict du juge, pause d'épellation, second passage, garde-fou, ou le
 * composant de délai le plus long.
 */
import type { Segment } from './energy';
import { isSpelledAt } from './ears';
import { tokenize } from './tokens';

export const SILENCE_MIN_SEC = 1.5;

export type SilenceOwner = 'agent_owed' | 'caller_owed' | 'agent_pause' | 'caller_pause';

export interface RawSilence {
  startSec: number;
  endSec: number;
  durationSec: number;
  owner: SilenceOwner;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function findSilences(
  caller: readonly Segment[],
  agent: readonly Segment[],
  minSec = SILENCE_MIN_SEC,
): RawSilence[] {
  const segments = [
    ...caller.map(([start, end]) => ({ start, end, who: 'caller' as const })),
    ...agent.map(([start, end]) => ({ start, end, who: 'agent' as const })),
  ].sort((a, b) => a.start - b.start);

  const silences: RawSilence[] = [];
  let lastEnd = -Infinity;
  let lastWho: 'caller' | 'agent' | null = null;
  for (const segment of segments) {
    if (lastWho !== null && segment.start - lastEnd >= minSec) {
      const owner: SilenceOwner =
        lastWho === 'caller'
          ? segment.who === 'agent'
            ? 'agent_owed'
            : 'caller_pause'
          : segment.who === 'caller'
            ? 'caller_owed'
            : 'agent_pause';
      silences.push({
        startSec: lastEnd,
        endSec: segment.start,
        durationSec: round2(segment.start - lastEnd),
        owner,
      });
    }
    if (segment.end > lastEnd) {
      lastEnd = segment.end;
      lastWho = segment.who;
    }
  }
  return silences;
}

export type SilenceCause =
  | 'judge_incomplete'
  | 'spelling_pause'
  | 'guard'
  | 'second_pass'
  | 'stt_endpointing'
  | 'model_latency'
  | 'tts_latency'
  | 'unknown'
  | 'unknown_no_logs';

export interface CauseInput {
  callerText: string;
  decisions: Array<{ pass?: number; judge?: string; actionDecision?: string }>;
  droppedPhrases: number;
  finalizeTriggers: string[];
  endOfSpeechToSttFinalMs?: number;
  holdMs?: number;
  llmFirstPhraseMs?: number;
  ttsFirstByteMs?: number;
}

export interface Attribution {
  cause: SilenceCause;
  detail: string;
}

export function attributeSilenceCause(turn: CauseInput | null): Attribution {
  if (!turn) return { cause: 'unknown_no_logs', detail: 'journaux du tour indisponibles' };

  if (turn.decisions.some((decision) => decision.judge === 'incomplete')) {
    return {
      cause: 'judge_incomplete',
      detail:
        "le juge de fin de tour a jugé l'énoncé inachevé : la réponse a attendu le silence de reprise",
    };
  }
  const tokens = tokenize(turn.callerText);
  if (tokens.length > 0 && isSpelledAt(tokens, tokens.length - 1)) {
    return { cause: 'spelling_pause', detail: "l'appelant finissait sur des lettres épelées" };
  }
  const refused = turn.decisions.find(
    (decision) => decision.actionDecision && decision.actionDecision !== 'allowed',
  );
  if (turn.droppedPhrases > 0 || refused) {
    return {
      cause: 'guard',
      detail: refused
        ? `garde-fou : ${refused.actionDecision}`
        : 'garde-fou : phrase retenue (question seule)',
    };
  }
  if (turn.decisions.some((decision) => (decision.pass ?? 1) >= 2)) {
    return { cause: 'second_pass', detail: 'second passage du modèle après un fait injecté' };
  }

  const components: Array<[SilenceCause, number]> = [
    ['stt_endpointing', (turn.endOfSpeechToSttFinalMs ?? 0) + (turn.holdMs ?? 0)],
    ['model_latency', turn.llmFirstPhraseMs ?? 0],
    ['tts_latency', turn.ttsFirstByteMs ?? 0],
  ];
  const [cause, ms] = components.sort((a, b) => b[1] - a[1])[0];
  if (ms <= 0) return { cause: 'unknown', detail: 'aucun composant de délai ne se démarque' };
  const stall = cause === 'stt_endpointing' && turn.finalizeTriggers.includes('stall');
  return {
    cause,
    detail: `${Math.round(ms)} ms${stall ? ', fin de tour forcée par la détection de blocage (stall)' : ''}`,
  };
}

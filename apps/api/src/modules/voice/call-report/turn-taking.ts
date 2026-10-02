/**
 * Tours de parole : verdicts « inachevé » suivis ou non d'une reprise, chevauchements, interruptions
 * réelles ou déclenchées par de l'écho. Tout vient des pistes (énergie, mots horodatés).
 */
import type { Segment } from './energy';
import type { TranscribedWord } from './deepgram-batch';
import { tokenize } from './tokens';

export const OVERLAP_MIN_SEC = 0.3;

export interface Overlap {
  startSec: number;
  endSec: number;
  durationSec: number;
  /** Qui a pris la parole en dernier, sur l'autre. */
  interrupter: 'agent' | 'caller';
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function findOverlaps(caller: readonly Segment[], agent: readonly Segment[]): Overlap[] {
  const overlaps: Overlap[] = [];
  for (const [callerStart, callerEnd] of caller) {
    for (const [agentStart, agentEnd] of agent) {
      const startSec = Math.max(callerStart, agentStart);
      const endSec = Math.min(callerEnd, agentEnd);
      const durationSec = round2(endSec - startSec);
      if (durationSec <= OVERLAP_MIN_SEC) continue;
      overlaps.push({
        startSec,
        endSec,
        durationSec,
        interrupter: agentStart > callerStart ? 'agent' : 'caller',
      });
    }
  }
  return overlaps.sort((a, b) => a.startSec - b.startSec);
}

export interface UnfinishedTurnInput {
  turnId: string;
  callerText: string;
  judgedIncomplete: boolean;
  /** Fin de parole de l'appelant sur sa piste. */
  callerEndSec: number | null;
  /** Première voix de l'agent après ce tour. */
  agentStartSec: number | null;
}

export interface UnfinishedVerdict {
  turnId: string;
  callerText: string;
  callerEndSec: number;
  /** Du silence a-t-il suivi sans voix de l'appelant ? Faux = le verdict « inachevé » était juste. */
  callerResumed: boolean;
  /** Durée de l'attente avant la voix de l'agent ; null si l'agent n'a pas répondu. */
  waitedSec: number | null;
}

export function unfinishedVerdicts(
  turns: readonly UnfinishedTurnInput[],
  caller: readonly Segment[],
): UnfinishedVerdict[] {
  const verdicts: UnfinishedVerdict[] = [];
  for (const turn of turns) {
    if (!turn.judgedIncomplete || turn.callerEndSec === null) continue;
    const waitEnd = turn.agentStartSec ?? Infinity;
    const callerResumed = caller.some(
      ([start]) => start > turn.callerEndSec! + 0.05 && start < waitEnd,
    );
    verdicts.push({
      turnId: turn.turnId,
      callerText: turn.callerText,
      callerEndSec: turn.callerEndSec,
      callerResumed,
      waitedSec:
        turn.agentStartSec === null ? null : round2(turn.agentStartSec - turn.callerEndSec),
    });
  }
  return verdicts;
}

export interface InterruptionInput {
  atSec: number;
  callerSegments: readonly Segment[];
  callerWords: readonly TranscribedWord[];
  /** Ce que l'agent venait de dire (texte envoyé à la synthèse), pour reconnaître son écho. */
  agentRecentText: string;
}

export interface InterruptionVerdict {
  kind: 'real' | 'echo' | 'unconfirmed';
  callerText: string;
}

const WINDOW_BEFORE_SEC = 1.2;
const WINDOW_AFTER_SEC = 0.5;
/** Part des mots entendus côté appelant qui reprennent le texte de l'agent pour parler d'écho. */
const ECHO_SHARE = 0.6;

export function classifyInterruption(input: InterruptionInput): InterruptionVerdict {
  const from = input.atSec - WINDOW_BEFORE_SEC;
  const to = input.atSec + WINDOW_AFTER_SEC;
  const heard = input.callerWords.filter((word) => word.end >= from && word.start <= to);
  const energy = input.callerSegments.some(([start, end]) => end >= from && start <= to);
  const callerText = heard.map((word) => word.text).join(' ');
  if (!energy && heard.length === 0) return { kind: 'unconfirmed', callerText };

  const heardTokens = tokenize(callerText);
  if (heardTokens.length > 0) {
    const agentTokens = new Set(tokenize(input.agentRecentText));
    const shared = heardTokens.filter((token) => agentTokens.has(token)).length;
    if (shared / heardTokens.length >= ECHO_SHARE) return { kind: 'echo', callerText };
  }
  return { kind: heard.length > 0 ? 'real' : 'unconfirmed', callerText };
}

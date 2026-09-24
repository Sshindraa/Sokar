import type { CallSession, VoiceSpeechAct } from './types';
import {
  recordVoiceChoiceAnswer,
  recordVoiceReadbackCorrected,
  recordVoiceReadback,
  recordVoiceQuestion,
  recordVoiceReprompt,
  type VoiceChoiceOutcome,
  type VoiceQualityCohort,
  type VoiceQualityKind,
} from '../../../shared/observability/metrics';

export type VoiceReadbackSlots = Partial<{
  partySize: number;
  date: string;
  time: string;
}>;

export interface VoiceChoicePrompt {
  kind: 'partySize' | 'weekday' | 'time';
  values: [string, string];
}

interface PendingReadback {
  value: string | number;
}

interface TurnCounts {
  turnId: string;
  readbacks: Set<VoiceQualityKind>;
  questions: Set<VoiceQualityKind>;
  reprompts: Set<VoiceQualityKind>;
}

const pendingReadbacks = new WeakMap<CallSession, Map<VoiceQualityKind, PendingReadback>>();
const turnCounts = new WeakMap<CallSession, TurnCounts>();

function fieldAndValue(
  slots: VoiceReadbackSlots,
  kind: VoiceQualityKind,
): string | number | undefined {
  if (kind === 'party_size') return slots.partySize;
  if (kind === 'date') return slots.date;
  return slots.time;
}

function normalizeKind(kind: VoiceChoicePrompt['kind']): VoiceQualityKind {
  if (kind === 'partySize') return 'party_size';
  if (kind === 'weekday') return 'date';
  return 'time';
}

function getTurnCounts(session: CallSession): TurnCounts | null {
  const turnId = session.currentTurn?.id;
  if (!turnId) return null;
  let counts = turnCounts.get(session);
  if (!counts || counts.turnId !== turnId) {
    counts = { turnId, readbacks: new Set(), questions: new Set(), reprompts: new Set() };
    turnCounts.set(session, counts);
  }
  return counts;
}

/** Enregistre un champ réellement inclus dans une relecture naturelle. */
export function recordVoiceReadbackForTurn(
  session: CallSession,
  kind: VoiceQualityKind,
  value: string | number,
): void {
  const counts = getTurnCounts(session);
  if (counts?.readbacks.has(kind)) {
    pendingReadbacks.get(session)?.set(kind, { value });
    return;
  }
  counts?.readbacks.add(kind);
  recordVoiceReadback(kind);
  const pending = pendingReadbacks.get(session) ?? new Map<VoiceQualityKind, PendingReadback>();
  pending.set(kind, { value });
  pendingReadbacks.set(session, pending);
}

/**
 * Consomme le tour immédiatement après une relecture. Seule une correction
 * explicite ou une valeur différente du même champ est comptée; la signature
 * de la correction ne survit jamais au tour suivant.
 */
export function observeVoiceReadbackResponse(
  session: CallSession,
  slots: VoiceReadbackSlots,
  speechAct: VoiceSpeechAct,
): void {
  const pending = pendingReadbacks.get(session);
  if (!pending) return;
  pendingReadbacks.delete(session);

  for (const [kind, readback] of pending) {
    const nextValue = fieldAndValue(slots, kind);
    const changed = nextValue !== undefined && String(nextValue) !== String(readback.value);
    const explicitCorrection = speechAct === 'correction' && pending.size === 1;
    if (changed || explicitCorrection) recordVoiceReadbackCorrected(kind);
  }
}

/** Enregistre l'issue de la réponse au choix précédent, sans exposer les candidats. */
export function recordVoiceChoiceResponse(
  choice: VoiceChoicePrompt | null,
  selectedValue: string | number | undefined,
  speechAct: VoiceSpeechAct,
  explicitlyNeither = false,
): void {
  if (!choice) return;
  let outcome: VoiceChoiceOutcome = explicitlyNeither ? 'neither' : 'other';
  if (!explicitlyNeither && selectedValue !== undefined) {
    const selected = String(selectedValue);
    if (selected === choice.values[0]) outcome = 'first';
    else if (selected === choice.values[1]) outcome = 'second';
  } else if (!explicitlyNeither && speechAct === 'correction') {
    outcome = 'neither';
  }
  recordVoiceChoiceAnswer(normalizeKind(choice.kind), outcome);
}

/** Compte les questions de slot émises et les répétitions de même champ, une fois par tour. */
export function recordVoiceQuestionForTurn(
  session: CallSession,
  kind: VoiceQualityKind,
  cohort: VoiceQualityCohort,
  repeated: boolean,
): void {
  const counts = getTurnCounts(session);
  if (counts?.questions.has(kind)) {
    if (repeated && !counts.reprompts.has(kind)) {
      counts.reprompts.add(kind);
      recordVoiceReprompt(kind, cohort);
    }
    return;
  }
  counts?.questions.add(kind);
  recordVoiceQuestion(kind, cohort);
  if (repeated) {
    counts?.reprompts.add(kind);
    recordVoiceReprompt(kind, cohort);
  }
}

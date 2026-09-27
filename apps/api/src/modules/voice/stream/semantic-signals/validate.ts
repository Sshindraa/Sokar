import type { PendingInteractionKind } from '../types';
import type { SemanticSignals } from './types';

export function validateSemanticSignals(
  signals: SemanticSignals,
  activeInteraction: PendingInteractionKind | 'none',
): { consistent: boolean; conflicts: string[] } {
  const high = (id: keyof SemanticSignals) => (signals[id]?.present ?? 0) >= 0.5;
  const conflicts: string[] = [];
  if (high('explicitly_confirms_proposal') && high('rejects_proposal'))
    conflicts.push('confirm_and_reject');
  if (
    activeInteraction === 'humanFallback' &&
    high('explicitly_requests_transfer') &&
    high('explicitly_requests_message')
  ) {
    conflicts.push('transfer_and_message');
  }
  if (high('needs_clarification') && high('explicitly_confirms_proposal'))
    conflicts.push('clarification_and_confirmation');
  return { consistent: conflicts.length === 0, conflicts };
}

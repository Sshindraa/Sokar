/**
 * Phase 2 (avis) de `needs_clarification` : ce que Jev aurait changé, sans rien
 * changer. Chaque tour noté est rangé selon que Jev et l'agent ont, ou non,
 * jugé qu'il fallait faire préciser l'appelant. Les tours « jev_only » sont
 * ceux où Jev aurait fait reposer la question alors que l'agent a continué :
 * ce sont eux qu'il faut relire avant de laisser Jev agir.
 */
import type { SemanticSignals } from './types';

export type ClarifyAdvisoryOutcome = 'both' | 'jev_only' | 'agent_only' | 'neither';

export function clarifyAdvisoryThreshold(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.VOICE_SEMANTIC_ADVISORY_CLARIFY_THRESHOLD ?? 0.8);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : 0.8;
}

/** L'agent a fait préciser quand il a lui-même jugé le message peu clair. */
export function agentAskedToClarify(interpretation: string | undefined): boolean | undefined {
  return interpretation === undefined ? undefined : interpretation === 'unclear';
}

export function classifyClarifyAdvisory(
  signals: SemanticSignals,
  agentInterpretation: string | undefined,
  threshold = clarifyAdvisoryThreshold(),
): ClarifyAdvisoryOutcome | null {
  const score = signals.needs_clarification?.present;
  const agent = agentAskedToClarify(agentInterpretation);
  if (score === undefined || agent === undefined) return null;
  const jev = score >= threshold;
  if (jev && agent) return 'both';
  if (jev) return 'jev_only';
  return agent ? 'agent_only' : 'neither';
}

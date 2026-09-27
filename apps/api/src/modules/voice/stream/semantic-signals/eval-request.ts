import { BEHAVIORS, CHOICE_QUESTIONS } from './behaviors';
import type { DecisionRequest, SpanMessage } from './types';

/** Un exemple hors ligne : les messages précédents, puis la réponse évaluée de l'agent. */
export interface EvalExample {
  input: SpanMessage[];
  output: SpanMessage;
}

/** Même format que `buildDecisionState` en production : ordre et rôles du span. */
export function buildEvalState(example: EvalExample): string {
  return [
    ...example.input.map(
      (message) => `${message.role === 'user' ? 'Client' : 'Agent'} : ${message.content}`,
    ),
    `Agent (réponse évaluée) : ${example.output.content}`,
  ].join('\n');
}

/**
 * Requête `decisions` hors ligne. Toutes les questions `choice` sont posées :
 * l'interaction active n'est pas connue pour un exemple exporté.
 */
export function buildEvalDecisionRequest(example: EvalExample, model: string): DecisionRequest {
  return {
    model,
    state: buildEvalState(example),
    questions: {
      ...Object.fromEntries(
        BEHAVIORS.map(({ id, instructions, present, absent }) => [
          id,
          { type: 'noul' as const, instructions, criteria: { true: present, false: absent } },
        ]),
      ),
      ...Object.fromEntries(
        CHOICE_QUESTIONS.map(({ id, instructions, criteria }) => [
          id,
          { type: 'choice' as const, instructions, criteria },
        ]),
      ),
    },
  };
}

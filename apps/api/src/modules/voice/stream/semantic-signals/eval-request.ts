import { BEHAVIORS, CHOICE_QUESTIONS } from './behaviors';
import type { DecisionRequest, SpanMessage } from './types';

/** Un exemple hors ligne : les messages précédents, puis la réponse évaluée de l'agent. */
export interface EvalExample {
  input: SpanMessage[];
  output: SpanMessage;
}

/**
 * État envoyé à Jev, en production comme hors ligne. Le dernier message du
 * client est isolé et nommé, précédé de la dernière question de l'agent ; les
 * échanges plus anciens sont marqués « à ne pas évaluer ». Sans ce cadrage,
 * Jev reportait une correction d'un tour précédent sur les tours suivants
 * (appel c5d6b07d : 14/23 bonnes réponses, 21/23 avec ce format).
 */
export function formatDecisionState(messages: SpanMessage[], reply?: string): string {
  const lastUser = messages.map((message) => message.role).lastIndexOf('user');
  const message = lastUser >= 0 ? messages[lastUser].content : '';
  const questionIndex =
    lastUser > 0 && messages[lastUser - 1].role === 'assistant' ? lastUser - 1 : -1;
  const question = questionIndex >= 0 ? messages[questionIndex].content : null;
  const context = messages.slice(0, questionIndex >= 0 ? questionIndex : Math.max(lastUser, 0));
  const speaker = (role: SpanMessage['role']) => (role === 'user' ? 'Client' : 'Agent');
  return [
    context.length
      ? `CONTEXTE ANTÉRIEUR (à ne pas évaluer) :\n${context
          .map((entry) => `${speaker(entry.role)} : ${entry.content}`)
          .join('\n')}`
      : null,
    question ? `DERNIÈRE QUESTION DE L'AGENT : ${question}` : null,
    `MESSAGE DU CLIENT À ÉVALUER : ${message}`,
    reply === undefined ? null : `RÉPONSE DE L'AGENT (à ne pas évaluer) : ${reply}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Même format que `buildDecisionState` en production. */
export function buildEvalState(example: EvalExample): string {
  return formatDecisionState(example.input, example.output.content);
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

import type { CallSession } from '../types';
import { redactPii } from '../pii-redact';
import { BEHAVIORS } from './behaviors';
import type { DecisionRequest, SpanMessage, SpanRequest } from './types';

interface BuildInput {
  transcript: string;
  reply: string;
  previousQuestion: string | null;
  model: string;
  historyTurns: number;
}

interface AnonymizedTurns {
  input: SpanMessage[];
  reply: string;
}

function anonymizedTurns(
  session: Pick<CallSession, 'history' | 'conversation' | 'from'>,
  input: BuildInput,
): AnonymizedTurns {
  const slots = session.conversation.slots as Record<string, unknown>;
  const names = [
    String(slots.customerName ?? ''),
    session.conversation.nameCollection?.confirmedName ?? '',
    session.conversation.nameCollection?.presentedCandidate ?? '',
  ].filter(Boolean);
  const knownValues: Array<[string, string]> = [
    ...names.flatMap(
      (name): Array<[string, string]> => [
        [name, '<CUSTOMER_NAME>'],
        ...name
          .split(/\s+/)
          .filter((part) => part.length >= 3)
          .map((part): [string, string] => [part, '<CUSTOMER_NAME>']),
      ],
    ),
    [String(slots.customerPhone ?? ''), '<PHONE>'],
    [String(slots.customerEmail ?? ''), '<EMAIL>'],
    [session.from, '<PHONE>'],
  ].filter(([value]) => value.trim().length >= 2) as Array<[string, string]>;
  // Longest first prevents a short name from masking part of a longer value.
  knownValues.sort((a, b) => b[0].length - a[0].length);
  const anonymize = (content: string): string => {
    let redacted = content;
    for (const [value, placeholder] of knownValues) {
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      redacted = redacted.replaceAll(
        new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'),
        placeholder,
      );
    }
    return redactPii(redacted).replaceAll('[PHONE]', '<PHONE>').replaceAll('[EMAIL]', '<EMAIL>');
  };

  const prior = session.history.filter(
    (message): message is SpanMessage =>
      (message.role === 'user' || message.role === 'assistant') && Boolean(message.content.trim()),
  );
  if (prior.at(-1)?.role === 'assistant' && prior.at(-1)?.content === input.reply) prior.pop();
  if (prior.at(-1)?.role === 'user' && prior.at(-1)?.content === input.transcript) prior.pop();
  const inputMessages = prior
    .filter((message) => message.role !== 'assistant' || message.content !== input.previousQuestion)
    .slice(-input.historyTurns * 2);
  if (input.previousQuestion) {
    inputMessages.push({ role: 'assistant', content: input.previousQuestion });
  }
  inputMessages.push({ role: 'user', content: input.transcript });
  return {
    input: inputMessages.map((message) => ({
      role: message.role,
      content: anonymize(message.content),
    })),
    reply: anonymize(input.reply),
  };
}

export function buildSemanticSpan(
  session: Pick<CallSession, 'history' | 'conversation' | 'from'>,
  input: BuildInput,
): SpanRequest {
  const turns = anonymizedTurns(session, input);
  return {
    model: input.model,
    span: {
      input: turns.input,
      output: { role: 'assistant', content: turns.reply },
    },
    behaviors: BEHAVIORS.map(({ id, definition }) => ({ id, definition })),
  };
}

/**
 * État textuel pour `POST /alpha/decisions` : mêmes messages anonymisés que le
 * span, dans l'ordre, avec la dernière question de l'agent et le dernier message
 * du client.
 */
export function buildDecisionState(
  session: Pick<CallSession, 'history' | 'conversation' | 'from'>,
  input: BuildInput,
): DecisionRequest {
  const turns = anonymizedTurns(session, input);
  return {
    model: input.model,
    state: [
      ...turns.input.map(
        (message) => `${message.role === 'user' ? 'Client' : 'Agent'} : ${message.content}`,
      ),
      `Agent (réponse évaluée) : ${turns.reply}`,
    ].join('\n'),
    questions: Object.fromEntries(
      BEHAVIORS.map(({ id, instructions, present, absent }) => [
        id,
        { type: 'noul' as const, instructions, criteria: { true: present, false: absent } },
      ]),
    ),
  };
}

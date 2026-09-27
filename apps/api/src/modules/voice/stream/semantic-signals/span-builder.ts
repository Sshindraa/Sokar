import type { CallSession } from '../types';
import { redactPii } from '../pii-redact';
import { BEHAVIORS } from './behaviors';
import type { SpanMessage, SpanRequest } from './types';

export function buildSemanticSpan(
  session: Pick<CallSession, 'history' | 'conversation' | 'from'>,
  input: {
    transcript: string;
    reply: string;
    previousQuestion: string | null;
    model: string;
    historyTurns: number;
  },
): SpanRequest {
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
      redacted = redacted.replaceAll(
        new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
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
    model: input.model,
    span: {
      input: inputMessages.map((message) => ({
        role: message.role,
        content: anonymize(message.content),
      })),
      output: { role: 'assistant', content: anonymize(input.reply) },
    },
    behaviors: BEHAVIORS.map(({ id, definition }) => ({ id, definition })),
  };
}

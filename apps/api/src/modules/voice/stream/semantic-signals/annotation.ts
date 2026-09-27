/**
 * Construction des tours à annoter à partir de `voice_debug_turns` (appels de
 * test uniquement). Un tour = les messages précédents, le dernier message du
 * client, puis la réponse de l'agent à évaluer. Téléphones et emails masqués.
 */
import { redactPii } from '../pii-redact';
import type { AnnotationItem } from './annotation-page';
import type { SpanMessage } from './types';

export type { AnnotationItem } from './annotation-page';

export const anonymizeAnnotationText = (text: string): string =>
  redactPii(text).replaceAll('[PHONE]', '<PHONE>').replaceAll('[EMAIL]', '<EMAIL>');

/** Un tour exportable par ligne `voice_debug_turns` qui a une parole du client et une réponse. */
export function buildAnnotationItems(
  turns: Array<{
    callId: string;
    turnId: string;
    sequence: number;
    callerText: string | null;
    agentText: string | null;
  }>,
  history: number,
): AnnotationItem[] {
  const byCall = new Map<string, typeof turns>();
  for (const turn of turns) {
    const list = byCall.get(turn.callId) ?? [];
    list.push(turn);
    byCall.set(turn.callId, list);
  }
  const items: AnnotationItem[] = [];
  for (const [callId, callTurns] of byCall) {
    callTurns.sort((a, b) => a.sequence - b.sequence);
    callTurns.forEach((turn, index) => {
      const caller = turn.callerText?.trim();
      const agent = turn.agentText?.trim();
      if (!caller || !agent) return;
      const input: SpanMessage[] = [];
      for (const previous of callTurns.slice(Math.max(0, index - history), index)) {
        if (previous.callerText?.trim())
          input.push({
            role: 'user',
            content: anonymizeAnnotationText(previous.callerText.trim()),
          });
        if (previous.agentText?.trim())
          input.push({
            role: 'assistant',
            content: anonymizeAnnotationText(previous.agentText.trim()),
          });
      }
      input.push({ role: 'user', content: anonymizeAnnotationText(caller) });
      items.push({
        id: `${callId}:${turn.turnId}`,
        input,
        output: { role: 'assistant', content: anonymizeAnnotationText(agent) },
        priority: 0,
      });
    });
  }
  return items;
}

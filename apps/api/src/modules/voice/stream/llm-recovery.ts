import { effectiveVoiceLanguage } from './voice-language';
import { pickVariant } from './reply-variants';
import type { CallSession } from './types';

/**
 * Phrase dite quand le LLM échoue ou dépasse son délai : une courte excuse,
 * puis la dernière question posée, pour que l'appelant sache quoi répondre.
 */
export function buildLlmRecoveryReply(session: CallSession): string {
  const question = session.conversation?.lastAssistantQuestion?.trim();
  if (effectiveVoiceLanguage(session) === 'en') {
    const apology = pickVariant(session, 'llm_recovery', [
      'Sorry, I had a small hiccup.',
      'Sorry about that, I missed something.',
    ]);
    return `${apology} ${question ?? 'Could you say that again?'}`;
  }
  const apology = pickVariant(session, 'llm_recovery', [
    'Excusez-moi, un petit souci de mon côté.',
    "Pardon, j'ai eu un petit souci.",
  ]);
  return `${apology} ${question ?? 'Pouvez-vous répéter ?'}`;
}

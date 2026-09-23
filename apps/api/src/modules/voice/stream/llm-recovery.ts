import { effectiveVoiceLanguage } from './voice-language';
import type { CallSession } from './types';

/**
 * Phrase dite quand le LLM échoue ou dépasse son délai : une courte excuse,
 * puis la dernière question posée, pour que l'appelant sache quoi répondre.
 */
export function buildLlmRecoveryReply(session: CallSession): string {
  const question = session.conversation?.lastAssistantQuestion?.trim();
  if (effectiveVoiceLanguage(session) === 'en') {
    return question
      ? `Sorry, I had a small hiccup. ${question}`
      : 'Sorry, I had a small hiccup. Could you say that again?';
  }
  return question
    ? `Excusez-moi, un petit souci de mon côté. ${question}`
    : 'Excusez-moi, un petit souci de mon côté. Pouvez-vous répéter ?';
}

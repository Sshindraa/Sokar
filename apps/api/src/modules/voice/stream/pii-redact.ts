import { createHash } from 'node:crypto';

/**
 * Utilitaire de redaction PII pour les debug logs.
 * Remplace les numéros de téléphone et emails par des placeholders.
 * Les noms ne sont pas redacted (trop difficile à détecter fiablement) —
 * les debug logs ne doivent pas être envoyés à des services externes.
 */

const PHONE_REGEX = /\+?\d[\d\s().-]{8,}\d/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Redacte les PII d'une chaîne pour les debug logs.
 * - Numéros de téléphone → [PHONE]
 * - Emails → [EMAIL]
 */
export function redactPii(text: string): string {
  return text.replace(PHONE_REGEX, '[PHONE]').replace(EMAIL_REGEX, '[EMAIL]');
}

/**
 * Description d'une transcription sans son contenu, pour les logs et Sentry.
 * Un nom dit seul (« Adebayor ») n'est pas détectable : le texte ne sort donc
 * pas du process. L'empreinte permet de relier les événements d'un même tour ;
 * le texte des appels de test reste lisible dans `voice_debug_turns`.
 */
export function describeTranscript(text: string): {
  transcriptLength: number;
  transcriptFingerprint: string;
} {
  return {
    transcriptLength: text.length,
    transcriptFingerprint: createHash('sha256').update(text).digest('hex').slice(0, 12),
  };
}

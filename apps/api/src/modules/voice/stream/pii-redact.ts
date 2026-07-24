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

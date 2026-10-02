import { createHash } from 'node:crypto';

/**
 * Utilitaire de redaction PII pour les debug logs.
 * Remplace les numéros de téléphone et emails par des placeholders.
 * Les noms ne sont pas redacted (trop difficile à détecter fiablement) —
 * les debug logs ne doivent pas être envoyés à des services externes.
 */

const PHONE_REGEX = /\+?\d[\d\s().-]{8,}\d/g;
/** Date ISO AAAA-MM-JJ (brouillon de réservation) : dix caractères de chiffres et de tirets, comme un numéro. */
const ISO_DATE_REGEX = /(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Redacte les PII d'une chaîne pour les debug logs.
 * - Numéros de téléphone → [PHONE] (une date AAAA-MM-JJ n'en est pas un)
 * - Emails → [EMAIL]
 */
export function redactPii(text: string): string {
  // Les dates sont mises de côté (jeton sans chiffre ni tiret) pendant le masquage des numéros, puis remises.
  const dates: string[] = [];
  const sheltered = text.replace(ISO_DATE_REGEX, (date) => {
    dates.push(date);
    return `\uE000${dates.length - 1}\uE001`;
  });
  const redacted = sheltered.replace(PHONE_REGEX, '[PHONE]').replace(EMAIL_REGEX, '[EMAIL]');
  return redacted.replace(/\uE000(\d+)\uE001/g, (_, index: string) => dates[Number(index)] ?? '');
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

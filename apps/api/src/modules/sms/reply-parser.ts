const POSITIVE_PATTERNS = /\b(oui|ok|confirme?|yes|ouais)\b/i;
const NEGATIVE_PATTERNS = /\b(non|annul\w*|cancel\w*|no\b)\b/i;

export type ReplyIntent = 'CONFIRMED' | 'CANCELLED' | 'UNKNOWN';

export function parseReply(text: string): ReplyIntent {
  const positive = POSITIVE_PATTERNS.test(text.trim());
  const negative = NEGATIVE_PATTERNS.test(text.trim());
  if (positive && negative) return 'UNKNOWN';
  if (positive) return 'CONFIRMED';
  if (negative) return 'CANCELLED';
  return 'UNKNOWN';
}

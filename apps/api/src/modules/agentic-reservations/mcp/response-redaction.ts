/**
 * Response redaction : sanitize les payloads de tool responses MCP.
 *
 * Règle d'or : aucune réponse MCP ne doit contenir :
 *   - Des secrets (api_key, token, secret, password)
 *   - Des données PII brutes (emails, numéros de téléphone)
 *   - Des données internes (holdToken, agent_client.id, etc.)
 *
 * Les redacted values sont remplacés par "[REDACTED]".
 *
 * Le redactor est défensif : on préfère redacter trop que pas assez.
 * Si un objet contient une clé qui matche la regex, on redact la valeur.
 *
 * Attention aux faux positifs : la PHONE_REGEX peut matcher des dates ISO
 * (ex: "2026-06-23" ou "2026-06-23T17:30:00.000Z"). Ces dates sont
 * préservées avant le passage de PHONE_REGEX.
 */

const SECRET_KEY_PATTERNS = [/api[_-]?key/i, /token/i, /secret/i, /password/i, /bearer/i];

const PII_KEY_PATTERNS = [/email/i, /phone/i, /customer[_-]?(name|phone|email)/i];

const INTERNAL_KEY_PATTERNS = [
  /^holdToken$/,
  /^quoteToken$/,
  /^agentClientId$/,
  /^apiKey$/,
  /^stripeCustomerId$/,
];

const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_REGEX = /(\+?\d[\d\s\-().*]{8,}\d)/g;
const LONG_HEX_REGEX = /\b[a-f0-9]{32,}\b/gi;
const UUID_REGEX = /\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi;
const ISO_DATE_REGEX = /\b(?:19|20)\d{2}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)?\b/g;

export function redactValue(key: string, value: unknown): unknown {
  if (SECRET_KEY_PATTERNS.some((p) => p.test(key))) return '[REDACTED]';
  if (PII_KEY_PATTERNS.some((p) => p.test(key))) return '[REDACTED]';
  if (INTERNAL_KEY_PATTERNS.some((p) => p.test(key))) return '[REDACTED]';
  return value;
}

export function redactPiiInString(value: string): string {
  // 1. Préserver les UUIDs (PHONE_REGEX peut matcher leur contenu)
  const preservedUuids: string[] = [];
  const withUuids = value.replace(UUID_REGEX, (match) => {
    preservedUuids.push(match);
    return `__SOKAR_UUID_${preservedUuids.length - 1}__`;
  });

  // 2. Préserver les dates ISO (PHONE_REGEX peut matcher "2026-06-23")
  const preservedDates: string[] = [];
  const withDates = withUuids.replace(ISO_DATE_REGEX, (match) => {
    preservedDates.push(match);
    return `__SOKAR_DATE_${preservedDates.length - 1}__`;
  });

  return withDates
    .replace(EMAIL_REGEX, '[REDACTED_EMAIL]')
    .replace(PHONE_REGEX, '[REDACTED_PHONE]')
    .replace(LONG_HEX_REGEX, '[REDACTED_HEX]')
    .replace(/__SOKAR_DATE_(\d+)__/g, (_match, idx) => preservedDates[Number(idx)] ?? _match)
    .replace(/__SOKAR_UUID_(\d+)__/g, (_match, idx) => preservedUuids[Number(idx)] ?? _match);
}

/**
 * Redact récursivement un objet/array.
 * Préserve les arrays. Préserve les types primitifs.
 */
export function redactResponse<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') return redactPiiInString(input) as T;
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (input instanceof Date) return input.toISOString() as T;
  if (Array.isArray(input)) {
    return input.map((v) => redactResponse(v)) as T;
  }
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const redacted = redactValue(k, v);
      out[k] = redacted === v ? redactResponse(v) : redacted;
    }
    return out as T;
  }
  return input;
}

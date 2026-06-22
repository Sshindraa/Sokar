/**
 * PII leak detector.
 *
 * Scan récursif d'un objet pour détecter des PII (phone, email, hex token)
 * qui n'auraient pas dû apparaître dans un tool response.
 *
 * Utilisé après redaction pour vérifier qu'il ne reste rien.
 * Si une PII est détectée, on incrémente `piiLeaksTotal` et on envoie
 * une alerte Sentry.
 *
 * La détection est volontairement conservatrice (regex simples) pour
 * minimiser les faux positifs. C'est une deuxième ligne de défense
 * après `response-redaction.ts`.
 */

import { piiLeaksTotal } from './metrics';
import { captureException } from '../sentry/client';

const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_REGEX = /\+?\d[\d\s\-().]{8,}\d/;
const HEX_LONG_REGEX = /\b[a-f0-9]{32,}\b/i;

export type PiiLeakReport = {
  hasLeak: boolean;
  leaks: Array<{ kind: 'email' | 'phone' | 'hex'; path: string; sample: string }>;
};

/**
 * Scanne un objet pour détecter des PII.
 * Renvoie un rapport détaillé des fuites trouvées.
 */
export function detectPiiLeaks(input: unknown, basePath: string = ''): PiiLeakReport {
  const leaks: PiiLeakReport['leaks'] = [];
  scan(input, basePath, leaks, new WeakSet<object>());
  return { hasLeak: leaks.length > 0, leaks };
}

function scan(
  value: unknown,
  path: string,
  leaks: PiiLeakReport['leaks'],
  seen: WeakSet<object>,
): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    checkString(value, path, leaks);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (let i = 0; i < value.length; i++) {
      scan(value[i], `${path}[${i}]`, leaks, seen);
    }
    return;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) return;
    seen.add(obj);
    for (const [k, v] of Object.entries(obj)) {
      const childPath = path ? `${path}.${k}` : k;
      // Skip complètement les clés whitelist (id, uuid, etc.) — pas de scan
      // récursif pour éviter les faux positifs sur les UUIDs qui ressemblent
      // à des numéros de téléphone.
      if (isAllowedKey(k)) {
        continue;
      }
      scan(v, childPath, leaks, seen);
    }
  }
}

function isAllowedKey(key: string): boolean {
  // Les clés de metadata internes (id, uuid, hash) ne sont pas des PII.
  // On SKIP complètement la valeur (pas de scan récursif) pour éviter
  // les faux positifs sur les UUIDs (qui ressemblent à des numéros de tel).
  const allowed = ['id', 'uuid', 'hash', 'reservationId', 'restaurantId', 'state', 'status'];
  return allowed.includes(key);
}

function checkString(value: string, path: string, leaks: PiiLeakReport['leaks']): void {
  if (EMAIL_REGEX.test(value)) {
    leaks.push({ kind: 'email', path, sample: value.slice(0, 30) });
    piiLeaksTotal.inc({ kind: 'email' });
  }
  if (PHONE_REGEX.test(value)) {
    leaks.push({ kind: 'phone', path, sample: value.slice(0, 30) });
    piiLeaksTotal.inc({ kind: 'phone' });
  }
  if (HEX_LONG_REGEX.test(value)) {
    leaks.push({ kind: 'hex', path, sample: value.slice(0, 30) });
    piiLeaksTotal.inc({ kind: 'hex' });
  }
}

/**
 * Vérifie un tool response et envoie une alerte Sentry si PII détectée.
 * À appeler après redaction pour doubler-check.
 */
export function assertNoPiiLeak(input: unknown, toolName: string): void {
  const report = detectPiiLeaks(input);
  if (report.hasLeak) {
    captureException(new Error(`PII leak detected in tool response: ${toolName}`), {
      extra: {
        tool: toolName,
        leakCount: report.leaks.length,
        leakKinds: report.leaks.map((l) => l.kind),
        leakPaths: report.leaks.map((l) => l.path),
      },
      tags: { alert: 'pii_leak', tool: toolName },
    });
  }
}

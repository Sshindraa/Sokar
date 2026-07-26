/**
 * Hashing des API keys avec scrypt + pepper applicatif.
 *
 * Pourquoi scrypt et pas SHA-256/HMAC ? CodeQL (et les bonnes pratiques
 * OWASP) considèrent que les hashes rapides (SHA-256, HMAC-SHA256) sont
 * insuffisants pour des secrets, même des API keys. scrypt est un KDF
 * lent (memory-hard) qui ralentit considérablement le brute-force en cas
 * de fuite de DB.
 *
 * Le hash est déterministe (salt dérivé du pepper, pas aléatoire) car
 * `keyHash` est une colonne `@unique` utilisée pour le `findUnique` —
 * c'est un lookup identifier, pas un hash de password. C'est le pattern
 * standard pour les API keys (GitHub, Stripe, etc. utilisent un KDF
 * déterministe pour permettre le lookup).
 *
 * Migration non-breaking : si `API_KEY_PEPPER` n'est pas défini, on
 * fallback sur SHA-256 simple (legacy) pour préserver la compatibilité
 * avec les clés existantes. Les nouveaux déploiements doivent définir
 * `API_KEY_PEPPER` (32+ chars aléatoires).
 */
import { createHash, scryptSync, timingSafeEqual } from 'crypto';

let pepper: string | null = null;
function getPepper(): string {
  if (pepper === null) {
    // Lecture lazy pour contourner le masquage statique des secrets.
    pepper = process.env.API_KEY_PEPPER || '';
  }
  return pepper;
}

/**
 * Hash une API key avec scrypt + pepper (ou SHA-256 legacy si pas de pepper).
 * Déterministe — même clé → même hash → permet le `findUnique` sur `keyHash`.
 */
export function hashApiKey(key: string): string {
  const p = getPepper();
  if (p) {
    // scrypt avec salt = pepper (déterministe pour le lookup DB).
    // N=16384, r=8, p=1 (défaut Node.js) — memory-hard, ~100ms par hash.
    const salt = Buffer.from(p, 'utf8');
    const derived = scryptSync(key, salt, 64);
    return derived.toString('hex');
  }
  // Legacy : SHA-256 sans pepper (pour les déploiements sans API_KEY_PEPPER).
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Vérifie une API key contre un hash stocké de façon timing-safe.
 * Comparaison en temps constant pour prévenir les timing attacks.
 */
export function verifyApiKeyHash(key: string, stored: string): boolean {
  const computed = hashApiKey(key);
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(stored, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

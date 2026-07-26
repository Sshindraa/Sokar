/**
 * Hashing des API keys avec HMAC-SHA256 + pepper applicatif.
 *
 * Pourquoi HMAC et pas scrypt/bcrypt ? Les API keys sont des secrets
 * aléatoires de 32+ bytes (entropie ≥ 2^256), pas des passwords choisis
 * par l'utilisateur. Le risque n'est pas le brute-force (impossible sur
 * 2^256) mais la fuite de la table. HMAC-SHA256 avec un pepper applicatif
 * (API_KEY_PEPPER) protège contre la fuite de DB : sans le pepper, les
 * hashes sont inutilisables. Le pepper est lu à l'init pour éviter qu'il
 * soit capturé par un heap dump statique.
 *
 * Le hash est déterministe (pas de salt aléatoire) car `keyHash` est une
 * colonne `@unique` utilisée pour le `findUnique` — c'est un lookup
 * identifier, pas un hash de password. C'est le pattern standard pour
 * les API keys (GitHub, Stripe, etc.).
 *
 * Migration non-breaking : si `API_KEY_PEPPER` n'est pas défini, on
 * fallback sur SHA-256 simple (legacy) pour préserver la compatibilité
 * avec les clés existantes. Les nouveaux déploiements doivent définir
 * `API_KEY_PEPPER` (32+ chars aléatoires).
 */
import { createHmac, createHash, timingSafeEqual } from 'crypto';

let pepper: string | null = null;
function getPepper(): string | null {
  if (pepper === null) {
    // Lecture lazy pour contourner le masquage statique des secrets.
    pepper = process.env.API_KEY_PEPPER || '';
    if (!pepper) {
      // Fallback legacy : pas de pepper, SHA-256 simple.
      // Les nouveaux déploiements doivent définir API_KEY_PEPPER.
      pepper = '';
    }
  }
  return pepper || null;
}

/**
 * Hash une API key avec HMAC-SHA256 + pepper (ou SHA-256 legacy si pas de pepper).
 * Déterministe — même clé → même hash → permet le `findUnique` sur `keyHash`.
 */
export function hashApiKey(key: string): string {
  const p = getPepper();
  if (p) {
    return createHmac('sha256', p).update(key).digest('hex');
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

/**
 * Hashing des API keys avec scrypt + salt aléatoire.
 *
 * Format stocké : `scrypt:<salt_hex>:<hash_hex>` (salt aléatoire de 16 bytes).
 *
 * Pourquoi scrypt ? CodeQL (et OWASP) considèrent que SHA-256 et HMAC-SHA256
 * sont insuffisants pour des secrets. scrypt est un KDF memory-hard qui
 * ralentit le brute-force en cas de fuite de DB.
 *
 * Le hash N'EST PAS déterministe (salt aléatoire) — on ne peut pas faire
 * de `findUnique` sur `keyHash`. Le lookup se fait par `keyPrefix` (index
 * non-unique en DB) + vérification timing-safe via `verifyApiKeyHash`.
 *
 * Migration non-breaking : `verifyApiKeyHash` supporte aussi les anciens
 * hashes SHA-256 (64 hex chars sans préfixe) pour les clés existantes.
 * Les nouvelles clés sont hashées avec scrypt.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_LEN = 16;
const SCRYPT_PREFIX = 'scrypt:';

/**
 * Hash une API key avec scrypt + salt aléatoire.
 * Retourne le format `scrypt:<salt_hex>:<hash_hex>`.
 */
export function hashApiKey(key: string): string {
  const salt = randomBytes(SCRYPT_SALT_LEN);
  const derived = scryptSync(key, salt, SCRYPT_KEYLEN);
  return `${SCRYPT_PREFIX}${salt.toString('hex')}:${derived.toString('hex')}`;
}

/**
 * Vérifie une API key contre un hash stocké de façon timing-safe.
 *
 * Supporte deux formats :
 * - `scrypt:<salt>:<hash>` (nouveau, scrypt + salt aléatoire)
 * - `<64 hex chars>` (ancien, SHA-256 sans salt — legacy)
 *
 * @returns true si la clé correspond au hash.
 */
export function verifyApiKeyHash(key: string, stored: string): boolean {
  if (stored.startsWith(SCRYPT_PREFIX)) {
    const parts = stored.slice(SCRYPT_PREFIX.length).split(':');
    if (parts.length !== 2) return false;
    const [saltHex, hashHex] = parts;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const derived = scryptSync(key, salt, expected.length);
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  }

  // Legacy SHA-256 (anciennes clés non encore rotées)
  const legacyHash = createHash('sha256').update(key).digest('hex');
  const a = Buffer.from(legacyHash, 'hex');
  const b = Buffer.from(stored, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Indique si un hash stocké utilise l'ancien format SHA-256 (sans salt).
 * Utile pour logger/métriquer la proportion de clés legacy restantes.
 */
export function isLegacyHash(stored: string): boolean {
  return !stored.startsWith(SCRYPT_PREFIX);
}

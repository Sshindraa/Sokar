/**
 * Génération de codes courts mnémoniques pour les cartes cadeau.
 *
 * Format : SKR-XXXX-XX (ex: SKR-X7F2-9K)
 * Alphabet : ABCDEFGHJKMNPQRSTUVWXYZ23456789 (exclut 0, O, I, L pour éviter la confusion visuelle)
 */
import type { PrismaClient } from '@prisma/client';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PREFIX = 'SKR';
const MAX_ATTEMPTS = 10;

/**
 * Génère un code court aléatoire au format SKR-XXXX-XX.
 */
export function generateShortCode(): string {
  const part = (len: number) =>
    Array.from({ length: len }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join(
      '',
    );
  return `${PREFIX}-${part(4)}-${part(2)}`;
}

/**
 * Génère un code court unique en vérifiant l'absence de collision en DB.
 * Boucle max 10 tentatives, puis lève une erreur.
 */
export async function generateUniqueShortCode(prisma: PrismaClient): Promise<string> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const code = generateShortCode();
    const existing = await prisma.giftCard.findUnique({
      where: { shortCode: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  throw new Error(`Impossible de générer un shortCode unique après ${MAX_ATTEMPTS} tentatives`);
}

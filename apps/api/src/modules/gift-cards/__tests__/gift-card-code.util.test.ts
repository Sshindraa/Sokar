/**
 * Tests for the gift card short-code generation utility.
 *
 * Format: SKR-XXXX-XX
 * Alphabet: ABCDEFGHJKMNPQRSTUVWXYZ23456789 (no 0, O, I, L)
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// setup.ts mocke gift-card-code.util pour retourner un shortCode fixe.
// On le démocke ici pour tester la vraie implémentation.
vi.mock('../gift-card-code.util', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    generateShortCode: actual.generateShortCode,
    generateUniqueShortCode: actual.generateUniqueShortCode,
  };
});

// On capture les fonctions dans un namespace pour éviter le top-level
// await (le tsconfig est en CJS / ES2020).
type ShortCodeModule = typeof import('../gift-card-code.util');
let generateShortCode: ShortCodeModule['generateShortCode'];
let generateUniqueShortCode: ShortCodeModule['generateUniqueShortCode'];

beforeAll(async () => {
  const mod = await import('../gift-card-code.util');
  generateShortCode = mod.generateShortCode;
  generateUniqueShortCode = mod.generateUniqueShortCode;
});

describe('generateShortCode', () => {
  it('produit un code au format SKR-XXXX-XX', () => {
    const code = generateShortCode();
    expect(code).toMatch(/^SKR-[A-Z0-9]{4}-[A-Z0-9]{2}$/);
  });

  it("n'utilise jamais les caractères ambigus (0, O, I, L)", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateShortCode();
      // Le préfixe SKR est fixe, on vérifie les 6 derniers caractères.
      const suffix = code.slice(4);
      expect(suffix).not.toMatch(/[0OIL]/);
    }
  });

  it("utilise uniquement l'alphabet attendu (ABCDEFGHJKMNPQRSTUVWXYZ23456789)", () => {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const allowed = new Set(alphabet.split(''));
    for (let i = 0; i < 200; i++) {
      const code = generateShortCode();
      const suffix = code.slice(4).replace(/-/g, '');
      for (const c of suffix) {
        expect(allowed.has(c)).toBe(true);
      }
    }
  });

  it('produit des codes différents (probabiliste, 100 itérations)', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) codes.add(generateShortCode());
    // Avec 31^6 ≈ 887M combinaisons, on n'aura pas de collision sur 100 tirages.
    expect(codes.size).toBe(100);
  });
});

describe('generateUniqueShortCode', () => {
  it('retourne le premier code si aucune collision en DB', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = { giftCard: { findUnique } } as unknown as PrismaClient;
    const code = await generateUniqueShortCode(prisma);
    expect(code).toMatch(/^SKR-[A-Z0-9]{4}-[A-Z0-9]{2}$/);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("boucle tant qu'il y a collision et retourne un code libre", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 'x' }) // 1ère tentative : collision
      .mockResolvedValueOnce({ id: 'y' }) // 2ème tentative : collision
      .mockResolvedValueOnce(null); // 3ème tentative : libre
    const prisma = { giftCard: { findUnique } } as unknown as PrismaClient;
    const code = await generateUniqueShortCode(prisma);
    expect(code).toMatch(/^SKR-[A-Z0-9]{4}-[A-Z0-9]{2}$/);
    expect(findUnique).toHaveBeenCalledTimes(3);
  });

  it('lève une erreur après MAX_ATTEMPTS collisions consécutives', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'x' });
    const prisma = { giftCard: { findUnique } } as unknown as PrismaClient;
    await expect(generateUniqueShortCode(prisma)).rejects.toThrow(
      /Impossible de générer un shortCode unique/,
    );
    expect(findUnique).toHaveBeenCalledTimes(10);
  });
});

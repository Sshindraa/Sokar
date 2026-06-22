/**
 * Test de non-régression migration identity_verification.
 *
 * Vérifie que les 2 nouvelles tables existent avec les bonnes colonnes :
 *   - identity_verification_otps
 *   - signed_token_usages
 *
 * Si ce test échoue après une migration, c'est que le schéma a dérivé
 * de ce que le code IdentityVerificationService attend.
 *
 * CE TEST EST DÉSACTIVÉ : le mock Prisma global de setup.ts empêche
 * d'utiliser la vraie DB. Pour l'exécuter, créer un vitest.config.no-mock.ts
 * qui n'inclut pas setup.ts, puis :
 *   pnpm exec vitest run src/modules/rgpd/__tests__/migration.test.ts \
 *     --config vitest.config.no-mock.ts
 *
 * En attendant, le suivi de migration se fait manuellement via :
 *   pnpm exec prisma migrate status
 * + revue de code des fichiers modifiés.
 */

import { describe } from 'vitest';

describe.skip('Migration identity_verification (non-régression) — voir commentaire en tête de fichier', () => {
  // Tests désactivés. Voir commentaire ci-dessus.
});

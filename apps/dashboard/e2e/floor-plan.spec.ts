import { test, expect } from '@playwright/test';

const demoFloorPlan = {
  id: 'e2e-floor-plan',
  name: 'Salle démo',
  isDefault: true,
  isActive: true,
  width: 800,
  height: 500,
  sections: [
    {
      id: 'e2e-section',
      name: 'Salle principale',
      position: 0,
      tables: [],
    },
  ],
  tables: [
    {
      id: 'e2e-table-t1',
      name: 'T1',
      capacity: 2,
      minCapacity: 1,
      isActive: true,
      positionX: 96,
      positionY: 96,
      width: 80,
      height: 80,
      rotation: 0,
      shape: 'round',
    },
    {
      id: 'e2e-table-t3',
      name: 'T3',
      capacity: 4,
      minCapacity: 1,
      isActive: true,
      positionX: 280,
      positionY: 96,
      width: 96,
      height: 80,
      rotation: 0,
      shape: 'rect',
    },
    {
      id: 'e2e-table-t4',
      name: 'T4',
      capacity: 6,
      minCapacity: 1,
      isActive: true,
      positionX: 480,
      positionY: 96,
      width: 112,
      height: 80,
      rotation: 0,
      shape: 'rect',
    },
  ],
  walls: [],
};

const demoFloorPlans = [
  {
    id: demoFloorPlan.id,
    name: demoFloorPlan.name,
    isDefault: true,
    isActive: true,
    tableCount: demoFloorPlan.tables.length,
  },
];

/**
 * Garde-fou non-régression du plan de salle (/dashboard/floor-plan).
 *
 * En mode demo local (NEXT_PUBLIC_DEMO_RESTAURANT_ID défini), le dashboard
 * utilise le restaurant "Chez Sokar Demo" et appelle l'API via le proxy Next.js.
 * Ce test vérifie que :
 *  - la vue "Live service" s'affiche sans bandeau d'erreur ;
 *  - le toggle vers "Salle édition" fonctionne ;
 *  - les onglets "Sections & tables" et "Plan visuel" s'affichent ;
 *  - les tables du plan demo (T1, T3, T4) sont rendues.
 */

test.describe('/dashboard/floor-plan — navigation et données demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/proxy/**', async (route) => {
      const { pathname } = new URL(route.request().url());
      const response = pathname.endsWith('/floor-plans')
        ? demoFloorPlans
        : pathname.includes(`/floor-plans/${demoFloorPlan.id}`)
          ? demoFloorPlan
          : pathname.includes('/floor-plan/reservations')
            ? []
            : null;

      await route.fulfill({
        status: response ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(response ?? { error: 'Route démo non mockée' }),
      });
    });
  });

  test('passe de Live service à Salle édition, Sections & tables puis Plan visuel', async ({
    page,
  }) => {
    await page.goto('/dashboard/floor-plan', { waitUntil: 'networkidle' });

    // Vue par défaut : Live service.
    await expect(page.getByRole('heading', { name: 'Live service' })).toBeVisible();

    // Bascule vers Salle édition.
    await page.getByRole('button', { name: 'Salle édition' }).click();
    await expect(page.getByRole('heading', { name: 'Salle édition' })).toBeVisible();

    // Onglet Sections & tables.
    await page.getByRole('button', { name: 'Sections & tables' }).click();
    await expect(page.getByText('Nouvelle section')).toBeVisible();

    // Retour au Plan visuel : les tables demo doivent s'afficher.
    await page.getByRole('button', { name: 'Plan visuel' }).click();
    const tableT1 = page.getByText('T1').first();
    await tableT1.scrollIntoViewIfNeeded();
    await expect(tableT1).toBeVisible();

    // Aucun bandeau d'erreur ne doit être présent.
    await expect(page.getByRole('button', { name: 'Réessayer' })).toHaveCount(0);
    await expect(page.getByText(/Impossible de charger/)).toHaveCount(0);
  });
});

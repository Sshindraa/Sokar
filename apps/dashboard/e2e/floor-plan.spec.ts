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
      id: 'e2e-section-terrasse',
      name: 'Terrasse',
      position: 0,
      tables: [],
    },
    {
      id: 'e2e-section-salle',
      name: 'Salle',
      position: 1,
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
      sectionId: 'e2e-section-terrasse',
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
      sectionId: 'e2e-section-salle',
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
      sectionId: 'e2e-section-salle',
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

type SimulationRequest = {
  partySize: number;
  startsAt: string;
  endsAt?: string;
  preferredSectionId?: string;
};

function simulationResponse(input: SimulationRequest) {
  const endsAt = input.endsAt ?? '2026-07-22T19:30:00.000Z';
  const query = { partySize: input.partySize, startsAt: input.startsAt, endsAt };

  if (input.partySize === 2) {
    return {
      query,
      feasible: true,
      bestScenarioId: 'direct-t1',
      explanation: 'Table T1 disponible à 19:00 pour 2 couverts.',
      scenarios: [
        {
          id: 'direct-t1',
          type: 'direct',
          feasible: true,
          confidence: 'high',
          title: 'Table T1 disponible',
          reason: 'Table T1 (2 couverts) disponible à 19:00.',
          actions: [],
          metrics: {
            coversGained: 2,
            conflictsCreated: 0,
            estimatedWaitMinutes: 0,
            tablesImpacted: ['T1'],
            reservationsToMove: [],
          },
          table: {
            id: 'e2e-table-t1',
            name: 'T1',
            capacity: 2,
            sectionId: 'e2e-section-terrasse',
            sectionName: 'Terrasse',
            floorPlanName: 'Salle démo',
          },
        },
      ],
    };
  }

  if (input.partySize === 4 && input.preferredSectionId === 'e2e-section-terrasse') {
    return {
      query,
      feasible: true,
      bestScenarioId: 'change-section-salle',
      explanation:
        'Aucune table dans la section demandée, mais la section Salle peut accueillir ce groupe à 19:00.',
      scenarios: [
        {
          id: 'direct-unavailable',
          type: 'direct',
          feasible: false,
          confidence: 'high',
          title: 'Aucune table disponible',
          reason: 'Aucune table de la section demandée ne peut accueillir ce groupe à ce créneau.',
          actions: [],
          metrics: {
            coversGained: 0,
            conflictsCreated: 0,
            estimatedWaitMinutes: null,
            tablesImpacted: [],
            reservationsToMove: [],
          },
        },
        {
          id: 'change-section-salle',
          type: 'change-section',
          feasible: true,
          confidence: 'medium',
          title: 'Changement de section : Salle',
          reason:
            'Aucune table dans la section demandée, mais la section Salle peut accueillir ce groupe à 19:00.',
          actions: [],
          metrics: {
            coversGained: 4,
            conflictsCreated: 0,
            estimatedWaitMinutes: 0,
            tablesImpacted: ['T3'],
            reservationsToMove: [],
          },
          table: {
            id: 'e2e-table-t3',
            name: 'T3',
            capacity: 4,
            sectionId: 'e2e-section-salle',
            sectionName: 'Salle',
            floorPlanName: 'Salle démo',
          },
        },
      ],
    };
  }

  return {
    query,
    feasible: false,
    bestScenarioId: 'refuse-next-slot',
    explanation: 'Aucune table disponible. Prochain créneau crédible : 20:30 le 2026-07-22.',
    scenarios: [
      {
        id: 'direct-unavailable',
        type: 'direct',
        feasible: false,
        confidence: 'high',
        title: 'Aucune table disponible',
        reason: 'Aucune table ne peut accueillir ce groupe à ce créneau.',
        actions: [],
        metrics: {
          coversGained: 0,
          conflictsCreated: 0,
          estimatedWaitMinutes: null,
          tablesImpacted: [],
          reservationsToMove: [],
        },
      },
      {
        id: 'refuse-next-slot',
        type: 'refuse',
        feasible: false,
        confidence: 'low',
        title: 'Aucune table disponible',
        reason:
          'Aucune table disponible à ce créneau. Prochain créneau crédible : 20:30 le 2026-07-22.',
        actions: [],
        metrics: {
          coversGained: 0,
          conflictsCreated: 0,
          estimatedWaitMinutes: 90,
          tablesImpacted: [],
          reservationsToMove: [],
        },
        nextAvailableAt: '2026-07-22T18:30:00.000Z',
        nextAvailableSectionId: 'e2e-section-salle',
      },
    ],
  };
}

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
      const isSimulation =
        route.request().method() === 'POST' && pathname.includes('/service-copilot/simulate');
      const response = isSimulation
        ? simulationResponse(route.request().postDataJSON() as SimulationRequest)
        : pathname.endsWith('/floor-plans')
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

  test('simule un placement direct sans ajouter de refus contradictoire', async ({ page }) => {
    await page.goto('/dashboard/floor-plan', { waitUntil: 'networkidle' });

    await page.locator('#sim-party-size').fill('2');
    await page.locator('#sim-starts-at').fill('2026-07-22T19:00');
    await page.getByRole('button', { name: 'Simuler' }).click();

    await expect(page.getByRole('heading', { name: 'Table T1 disponible' })).toBeVisible();
    await expect(page.getByText('Aucune table disponible', { exact: true })).toHaveCount(0);
  });

  test('propose une autre section quand la section préférée est pleine', async ({ page }) => {
    await page.goto('/dashboard/floor-plan', { waitUntil: 'networkidle' });

    await page.locator('#sim-party-size').fill('4');
    await page.locator('#sim-starts-at').fill('2026-07-22T19:00');
    await page.getByRole('combobox', { name: 'Section préférée' }).click();
    await page.getByRole('option', { name: 'Terrasse' }).click();
    await page.getByRole('button', { name: 'Simuler' }).click();

    await expect(
      page.getByRole('heading', { name: 'Changement de section : Salle' }),
    ).toBeVisible();
  });

  test('propose le prochain créneau quand le restaurant est complet', async ({ page }) => {
    await page.goto('/dashboard/floor-plan', { waitUntil: 'networkidle' });

    await page.locator('#sim-party-size').fill('6');
    await page.locator('#sim-starts-at').fill('2026-07-22T19:00');
    await page.getByRole('button', { name: 'Simuler' }).click();

    // Le rendu suit le fuseau du navigateur (UTC en CI, Europe/Paris en local).
    await expect(page.getByText(/Prochain créneau : 22 juil\. \d{2}:30/)).toBeVisible();
  });
});

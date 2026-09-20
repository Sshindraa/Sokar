import { test, expect, type Page } from '@playwright/test';

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

const demoServicePulse = {
  date: '2026-09-20',
  generatedAt: '2026-09-20T18:00:00.000Z',
  isLiveDate: true,
  status: 'calm',
  headline: 'Service sous contrôle',
  lateArrivals: 0,
  arrivalsToSeat: 0,
  arrivalsNext30Minutes: 0,
  seatedTables: 0,
  pendingWaitingList: 0,
  confirmedReservations: 0,
};

function patchedTableResponse(
  floorPlan: typeof demoFloorPlan,
  pathname: string,
  updates: Record<string, unknown>,
) {
  const tableId = pathname.split('/').at(-1);
  const tableIndex = floorPlan.tables.findIndex((item) => item.id === tableId);
  if (tableIndex < 0) return null;

  const updatedTable = { ...floorPlan.tables[tableIndex], ...updates };
  floorPlan.tables[tableIndex] = updatedTable;
  return updatedTable;
}

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

async function openInlineSimulator(page: Page) {
  const trigger = page.getByText('Accueillir un walk-in · Simulateur Copilot', { exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.locator('#sim-party-size')).toBeVisible();
}

/**
 * Garde-fou non-régression du plan de salle (/dashboard/floor-plan).
 *
 * En mode demo local (NEXT_PUBLIC_DEMO_RESTAURANT_ID défini), le dashboard
 * utilise le restaurant "Chez Sokar Demo" et appelle l'API via le proxy Next.js.
 * Ce test vérifie que :
 *  - la vue Live s'affiche sans bandeau d'erreur ;
 *  - la navigation vers l'édition fonctionne ;
 *  - les onglets "Sections & tables" et "Plan visuel" s'affichent ;
 *  - les tables du plan demo (T1, T3, T4) sont rendues.
 */

test.describe('/dashboard/floor-plan — navigation et données demo', () => {
  test.beforeEach(async ({ page }) => {
    const currentFloorPlan = structuredClone(demoFloorPlan);

    await page.route('**/api/proxy/**', async (route) => {
      const { pathname } = new URL(route.request().url());
      const requestMethod = route.request().method();
      const isSimulation =
        requestMethod === 'POST' && pathname.includes('/service-copilot/simulate');
      const isTablePatch = requestMethod === 'PATCH' && pathname.includes('/floor-plan/tables/');
      const response = isSimulation
        ? simulationResponse(route.request().postDataJSON() as SimulationRequest)
        : isTablePatch
          ? patchedTableResponse(
              currentFloorPlan,
              pathname,
              route.request().postDataJSON() as Record<string, unknown>,
            )
          : pathname.endsWith('/floor-plans')
            ? demoFloorPlans
            : pathname.includes(`/floor-plans/${demoFloorPlan.id}`)
              ? currentFloorPlan
              : pathname.includes('/floor-plan/reservations')
                ? []
                : pathname.includes('/waiting-list')
                  ? []
                  : pathname.includes('/service-copilot/delay-recoveries')
                    ? { recoveries: [] }
                    : pathname.includes('/service-copilot/pulse')
                      ? demoServicePulse
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
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-13', 'Parcours de navigation tactile iPhone 13.');

    await page.goto('/dashboard/floor-plan', { waitUntil: 'domcontentloaded' });

    // Vue Live par défaut : le plan et les onglets du service sont disponibles.
    await expect(page.getByRole('tab', { name: 'Plan' })).toBeVisible();

    // Bascule vers Salle édition via la navigation tactile.
    await page.getByRole('link', { name: 'Édition' }).click();
    await expect(page.getByRole('tab', { name: 'Plan visuel' })).toBeVisible();

    // Onglet Sections & tables.
    await page.getByRole('tab', { name: 'Sections & tables' }).click();
    await expect(page.getByText('Nouvelle section')).toBeVisible();

    // Retour au Plan visuel : les tables demo doivent s'afficher.
    await page.getByRole('tab', { name: 'Plan visuel' }).click();
    const tableT1 = page.getByText('T1').first();
    await tableT1.scrollIntoViewIfNeeded();
    await expect(tableT1).toBeVisible();

    // Aucun bandeau d'erreur ne doit être présent.
    await expect(page.getByRole('button', { name: 'Réessayer' })).toHaveCount(0);
    await expect(page.getByText(/Impossible de charger/)).toHaveCount(0);
    await expect(page.getByText('Route démo non mockée')).toHaveCount(0);
  });

  test('affiche une table ronde et une fiche tactile dans le viewport iPhone', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'iphone-13',
      'Validation spécifique au viewport iPhone 13.',
    );

    await page.goto('/dashboard/floor-plan?view=edit-plan&floorPlanId=e2e-floor-plan', {
      waitUntil: 'domcontentloaded',
    });

    const table = page.getByRole('button', { name: 'T1 · 2 places' });
    await table.click();

    const tableBody = table.locator('.bg-floor-table-surface').first();
    await expect(tableBody).toHaveClass(/rounded-full/);

    const sheet = page.getByLabel('Actions pour T1');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel('Nom de la table')).toBeVisible();
    await expect(sheet.getByLabel('Augmenter la capacité')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zoom arrière' })).toBeHidden();

    const sheetBox = await sheet.boundingBox();
    const viewport = page.viewportSize();
    expect(sheetBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect((sheetBox?.y ?? Number.POSITIVE_INFINITY) + (sheetBox?.height ?? 0)).toBeLessThanOrEqual(
      viewport?.height ?? 0,
    );

    await sheet.getByLabel('Augmenter la capacité').click();
    await expect(page.getByRole('button', { name: 'T1 · 3 places' })).toBeVisible();

    const tableName = sheet.getByLabel('Nom de la table');
    await tableName.fill('T1 bis');
    await tableName.blur();
    await expect(page.getByRole('button', { name: 'T1 bis · 3 places' })).toBeVisible();
  });

  test('garde les contrôles Live séparés et lisibles sur iPhone 13', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'iphone-13',
      'Validation spécifique au viewport iPhone 13.',
    );

    await page.goto('/dashboard/floor-plan?view=service-live&floorPlanId=e2e-floor-plan', {
      waitUntil: 'domcontentloaded',
    });

    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    const tabBoxes = await tabs.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom, width: rect.width };
      }),
    );
    expect(tabBoxes.every((box) => box.width > 0)).toBe(true);
    expect(new Set(tabBoxes.map((box) => box.y)).size).toBe(1);
    expect(tabBoxes[0]?.right ?? 0).toBeLessThanOrEqual(tabBoxes[1]?.x ?? 0);
    expect(tabBoxes[1]?.right ?? 0).toBeLessThanOrEqual(tabBoxes[2]?.x ?? 0);

    await expect(page.getByLabel('Date du service')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Filtrer par serveur' })).toBeVisible();
    await expect(page.getByText('Libre', { exact: true }).first()).toBeVisible();
  });

  test('libère le canvas avec une fiche tactile sur iPad portrait', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'ipad-mini',
      'Validation spécifique au viewport iPad Mini.',
    );

    await page.goto('/dashboard/floor-plan?view=edit-plan&floorPlanId=e2e-floor-plan', {
      waitUntil: 'domcontentloaded',
    });
    await page.getByRole('button', { name: 'T1 · 2 places' }).click();

    const sheet = page.getByLabel('Actions pour T1');
    await expect(sheet).toBeVisible();
    await expect(page.getByText('Inspecteur', { exact: true })).toBeHidden();

    const sheetBox = await sheet.boundingBox();
    const viewport = page.viewportSize();
    expect(sheetBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(sheetBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(672);
    expect((sheetBox?.y ?? Number.POSITIVE_INFINITY) + (sheetBox?.height ?? 0)).toBeLessThanOrEqual(
      viewport?.height ?? 0,
    );
  });

  test('simule un placement direct sans ajouter de refus contradictoire', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'iphone-13',
      'Le simulateur inline est réservé aux écrans md et plus.',
    );

    await page.goto('/dashboard/floor-plan', { waitUntil: 'domcontentloaded' });
    await openInlineSimulator(page);

    await page.locator('#sim-party-size').fill('2');
    await page.locator('#sim-starts-at').fill('2026-07-22T19:00');
    await page.getByRole('button', { name: 'Trouver une table' }).click();

    await expect(page.getByRole('heading', { name: 'Table T1 disponible' })).toBeVisible();
    await expect(page.getByText('Aucune table disponible', { exact: true })).toHaveCount(0);
  });

  test('propose une autre section quand la section préférée est pleine', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'iphone-13',
      'Le simulateur inline est réservé aux écrans md et plus.',
    );

    await page.goto('/dashboard/floor-plan', { waitUntil: 'domcontentloaded' });
    await openInlineSimulator(page);

    await page.locator('#sim-party-size').fill('4');
    await page.locator('#sim-starts-at').fill('2026-07-22T19:00');
    await page.getByRole('combobox', { name: 'Zone souhaitée' }).click();
    await page.getByRole('option', { name: 'Terrasse' }).click();
    await page.getByRole('button', { name: 'Trouver une table' }).click();

    await expect(
      page.getByRole('heading', { name: 'Changement de section : Salle' }),
    ).toBeVisible();
  });

  test('propose le prochain créneau quand le restaurant est complet', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'iphone-13',
      'Le simulateur inline est réservé aux écrans md et plus.',
    );

    await page.goto('/dashboard/floor-plan', { waitUntil: 'domcontentloaded' });
    await openInlineSimulator(page);

    await page.locator('#sim-party-size').fill('6');
    await page.locator('#sim-starts-at').fill('2026-07-22T19:00');
    await page.getByRole('button', { name: 'Trouver une table' }).click();

    // Le rendu suit le fuseau du navigateur (UTC en CI, Europe/Paris en local).
    await expect(page.getByText(/Prochain créneau : 22 juil\. \d{2}:30/)).toBeVisible();
  });
});

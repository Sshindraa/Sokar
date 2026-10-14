import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AdminProvisioningPage from './page';
import { formatWaitingTime, restaurantsAwaitingNumber } from './PendingNumbersSection';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ useApi: () => mocks }));

const HOUR = 3_600_000;
const ago = (milliseconds: number) => new Date(Date.now() - milliseconds).toISOString();

type Overrides = Partial<{
  restaurantId: string;
  restaurantName: string;
  city: string | null;
  phoneNumber: string;
  hasAssignedPhone: boolean;
  floorCompletedAt: string | null;
}>;

function status(overrides: Overrides) {
  const assigned = overrides.hasAssignedPhone ?? false;
  return {
    restaurantId: 'resto',
    restaurantName: 'Restaurant',
    city: null,
    phoneNumber: assigned ? '+33451221528' : '+000resto',
    hasAssignedPhone: assigned,
    provisioningStatus: assigned ? 'PHONE_ASSIGNED' : 'PENDING',
    telnyxPhoneNumberId: null,
    forwardingConfiguredAt: null,
    testCallValidatedAt: null,
    firstCallAt: null,
    floorCompletedAt: null,
    testCallControlId: null,
    forwardingCode: null,
    steps: {
      assignment: { completed: assigned, phoneNumber: '', voiceAppLink: null as string | null },
      webhook: { completed: false, webhookUrl: '' },
      forwarding: { completed: false, configuredAt: null, ussdCode: null },
      testCall: { completed: false, validatedAt: null },
    },
    ...overrides,
  };
}

function serve(restaurants: ReturnType<typeof status>[]) {
  mocks.get.mockImplementation(async (path: string) =>
    path === 'admin/provisioning/available-numbers'
      ? { ok: true, numbers: [] }
      : { ok: true, count: restaurants.length, restaurants },
  );
}

const section = () => screen.getByRole('region', { name: /En attente de numéro/ });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('page Provisioning : En attente de numéro', () => {
  it('affiche un restaurant en attente avec sa ville, sa durée et le nombre dans le titre', async () => {
    serve([
      status({
        restaurantId: 'a',
        restaurantName: 'Chez Émile',
        city: 'Lyon',
        floorCompletedAt: ago(3 * HOUR + 1000),
      }),
    ]);
    render(<AdminProvisioningPage />);

    expect(await screen.findByRole('heading', { name: 'En attente de numéro (1)' })).toBeVisible();
    const row = within(section()).getByRole('listitem');
    expect(row).toHaveTextContent('Chez Émile');
    expect(row).toHaveTextContent('Lyon');
    expect(row).toHaveTextContent('Attend depuis 3 h');
  });

  it('n’affiche ni un restaurant avec numéro ni un restaurant à la salle incomplète', async () => {
    serve([
      status({
        restaurantId: 'a',
        restaurantName: 'Avec numéro',
        hasAssignedPhone: true,
        floorCompletedAt: ago(5 * HOUR),
      }),
      status({ restaurantId: 'b', restaurantName: 'Salle incomplète', floorCompletedAt: null }),
      status({ restaurantId: 'c', restaurantName: 'En attente', floorCompletedAt: ago(HOUR) }),
    ]);
    render(<AdminProvisioningPage />);

    expect(await screen.findByRole('heading', { name: 'En attente de numéro (1)' })).toBeVisible();
    const items = within(section()).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('En attente');
    expect(within(section()).queryByText(/Avec numéro/)).not.toBeInTheDocument();
    expect(within(section()).queryByText(/Salle incomplète/)).not.toBeInTheDocument();
  });

  it('trie le plus ancien en premier', async () => {
    serve([
      status({ restaurantId: 'a', restaurantName: 'Récent', floorCompletedAt: ago(HOUR) }),
      status({ restaurantId: 'b', restaurantName: 'Ancien', floorCompletedAt: ago(50 * HOUR) }),
      status({ restaurantId: 'c', restaurantName: 'Moyen', floorCompletedAt: ago(10 * HOUR) }),
    ]);
    render(<AdminProvisioningPage />);

    await screen.findByRole('heading', { name: 'En attente de numéro (3)' });
    const names = within(section())
      .getAllByRole('listitem')
      .map((item) => item.textContent?.replace(/Attend.*/, '').replace(/Attribuer.*/, ''));
    expect(names).toEqual(['Ancien', 'Moyen', 'Récent']);
    expect(within(section()).getAllByRole('listitem')[0]).toHaveTextContent(
      'Attend depuis 2 jours',
    );
  });

  it('affiche un état vide court quand personne n’attend', async () => {
    serve([
      status({
        restaurantId: 'a',
        restaurantName: 'Avec numéro',
        hasAssignedPhone: true,
        floorCompletedAt: ago(HOUR),
      }),
    ]);
    render(<AdminProvisioningPage />);

    expect(await screen.findByText('Aucun restaurant en attente de numéro')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'En attente de numéro (0)' })).toBeVisible();
    expect(within(section()).queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('le bouton ouvre ce restaurant dans le panneau d’attribution', async () => {
    serve([
      status({ restaurantId: 'a', restaurantName: 'Premier de la liste', floorCompletedAt: null }),
      status({ restaurantId: 'b', restaurantName: 'Chez Émile', floorCompletedAt: ago(2 * HOUR) }),
    ]);
    render(<AdminProvisioningPage />);

    await screen.findByRole('heading', { name: 'En attente de numéro (1)' });
    const cockpit = () => document.getElementById('provisioning-cockpit') as HTMLElement;
    // Le premier restaurant de la liste est sélectionné par défaut.
    expect(within(cockpit()).getByRole('heading', { name: 'Premier de la liste' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Attribuer un numéro à Chez Émile' }));

    await waitFor(() =>
      expect(within(cockpit()).getByRole('heading', { name: 'Chez Émile' })).toBeVisible(),
    );
    expect(within(cockpit()).queryByText('Premier de la liste')).not.toBeInTheDocument();
    // Choisir un restaurant ne recharge pas la liste : 2 appels au chargement, aucun de plus.
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Chargement des restaurants en attente…')).not.toBeInTheDocument();
  });

  it('montre le chargement puis, en cas de panne, une erreur avec un nouvel essai', async () => {
    let release: (value: unknown) => void = () => undefined;
    mocks.get.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    mocks.get.mockImplementationOnce(async () => ({ ok: true, numbers: [] }));
    render(<AdminProvisioningPage />);

    expect(screen.getByText('Chargement des restaurants en attente…')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'En attente de numéro' })).toBeVisible();

    release(null);
    mocks.get.mockReset();
    mocks.get.mockRejectedValue(new Error('indisponible'));
    fireEvent.click(await screen.findByRole('button', { name: 'Actualiser' }));
    expect(
      await within(section()).findByText(
        'Impossible de charger les restaurants en attente de numéro.',
      ),
    ).toBeVisible();
    expect(screen.queryByText(/Aucun restaurant en attente/)).not.toBeInTheDocument();

    serve([
      status({ restaurantId: 'a', restaurantName: 'Chez Émile', floorCompletedAt: ago(HOUR) }),
    ]);
    fireEvent.click(within(section()).getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('heading', { name: 'En attente de numéro (1)' })).toBeVisible();
  });
});

describe('restaurantsAwaitingNumber et formatWaitingTime', () => {
  it('garde les salles terminées sans numéro, du plus ancien au plus récent', () => {
    const base = { city: null, hasAssignedPhone: false };
    const list = [
      { ...base, restaurantId: '1', restaurantName: 'B', floorCompletedAt: '2026-10-12T10:00:00Z' },
      { ...base, restaurantId: '2', restaurantName: 'A', floorCompletedAt: '2026-10-11T10:00:00Z' },
      { ...base, restaurantId: '3', restaurantName: 'C', floorCompletedAt: null },
      {
        ...base,
        restaurantId: '4',
        restaurantName: 'D',
        hasAssignedPhone: true,
        floorCompletedAt: '2026-10-10T10:00:00Z',
      },
    ];
    expect(restaurantsAwaitingNumber(list).map((r) => r.restaurantName)).toEqual(['A', 'B']);
  });

  it('écrit la durée en langage simple', () => {
    expect(formatWaitingTime(0)).toBe('moins d’une minute');
    expect(formatWaitingTime(-5000)).toBe('moins d’une minute');
    expect(formatWaitingTime(12 * 60_000)).toBe('12 min');
    expect(formatWaitingTime(3 * HOUR)).toBe('3 h');
    expect(formatWaitingTime(24 * HOUR)).toBe('1 jour');
    expect(formatWaitingTime(50 * HOUR)).toBe('2 jours');
  });
});

describe('page Provisioning : lien avec l’application voix et inventaire Telnyx', () => {
  type Link = 'linked' | 'failed' | 'skipped_no_connection_id' | 'skipped_manual_number' | null;

  function assignedWithLink(voiceAppLink: Link) {
    const base = status({ restaurantId: 'a', hasAssignedPhone: true });
    return {
      ...base,
      steps: { ...base.steps, assignment: { completed: true, phoneNumber: '', voiceAppLink } },
    };
  }

  function serveWith(
    restaurants: ReturnType<typeof status>[],
    numbers: { source: 'telnyx' | 'dev-fallback' | 'unavailable'; items?: unknown[] },
  ) {
    mocks.get.mockImplementation(async (path: string) =>
      path === 'admin/provisioning/available-numbers'
        ? { ok: true, numbers: numbers.items ?? [], source: numbers.source }
        : { ok: true, count: restaurants.length, restaurants },
    );
  }

  it('avertit quand le numéro attribué n’est pas relié à l’application voix', async () => {
    serveWith([assignedWithLink('skipped_no_connection_id')], { source: 'telnyx' });
    render(<AdminProvisioningPage />);

    const alert = await screen.findByText(/TELNYX_CONNECTION_ID n’est pas défini/);
    expect(alert).toBeVisible();
    expect(alert).toHaveTextContent('Reliez-le dans le portail Telnyx');
  });

  it('avertit aussi d’un refus de Telnyx et d’un numéro saisi à la main', async () => {
    serveWith([assignedWithLink('failed')], { source: 'telnyx' });
    const { unmount } = render(<AdminProvisioningPage />);
    expect(await screen.findByText(/Telnyx a refusé de relier ce numéro/)).toBeVisible();
    unmount();

    serveWith([assignedWithLink('skipped_manual_number')], { source: 'telnyx' });
    render(<AdminProvisioningPage />);
    expect(await screen.findByText(/Numéro saisi à la main/)).toBeVisible();
  });

  it('un lien jamais vérifié (ancien numéro) est signalé plutôt que présumé bon', async () => {
    serveWith([assignedWithLink(null)], { source: 'telnyx' });
    render(<AdminProvisioningPage />);

    expect(await screen.findByText(/n’a jamais été vérifié/)).toBeVisible();
  });

  it('n’avertit pas quand le numéro est bien relié', async () => {
    serveWith([assignedWithLink('linked')], { source: 'telnyx' });
    render(<AdminProvisioningPage />);

    await screen.findByText('Attribué');
    expect(screen.queryByText(/Reliez-le dans le portail Telnyx/)).not.toBeInTheDocument();
    expect(screen.queryByText(/n’a jamais été vérifié/)).not.toBeInTheDocument();
  });

  it('prévient quand l’inventaire Telnyx est indisponible, sans proposer de numéros', async () => {
    serveWith([status({ restaurantId: 'a' })], { source: 'unavailable' });
    render(<AdminProvisioningPage />);

    expect(await screen.findByText(/L’inventaire Telnyx est indisponible/)).toBeVisible();
    expect(screen.queryByText(/Inventaire Telnyx disponible/)).not.toBeInTheDocument();
  });

  it('dit que le compte Telnyx est vide plutôt que d’afficher une liste vide muette', async () => {
    serveWith([status({ restaurantId: 'a' })], { source: 'telnyx', items: [] });
    render(<AdminProvisioningPage />);

    expect(await screen.findByText(/Le compte Telnyx ne contient aucun numéro/)).toBeVisible();
  });
});

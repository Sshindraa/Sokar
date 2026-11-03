import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import EmptySlotsWidget from '../EmptySlotsWidget';

function renderWidget() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <EmptySlotsWidget />
    </NextIntlClientProvider>,
  );
}

// Mock contrôlable du hook useApi — on délègue à un objet mutable
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockUseApi = vi.fn(() => ({
  orgId: 'org_test_123' as string | undefined,
  isSignedIn: true,
  get: mockGet,
  post: mockPost,
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  useApi: () => mockUseApi(),
}));

function makeDay(overrides: Record<string, unknown> = {}) {
  return {
    date: '2026-06-30',
    dayName: 'mar',
    isOpen: true,
    openTime: '12:00',
    closeTime: '22:00',
    reservationCount: 5,
    covers: 12,
    isUnderbooked: false,
    revenueAtRisk: 0,
    ...overrides,
  };
}

function makeResponse(
  days: ReturnType<typeof makeDay>[],
  summaryOverrides: Record<string, unknown> = {},
) {
  return {
    days,
    summary: {
      underbookedDays: 0,
      totalOpenDays: days.length,
      revenueAtRisk: 0,
      avgRevenuePerReservation: 35,
      threshold: 3,
      ...summaryOverrides,
    },
  };
}

function makeSuggestion(overrides: Record<string, unknown> = {}) {
  return {
    date: '2026-11-04',
    service: 'midi',
    capacity: 40,
    freePlaces: 30,
    emptyPlaces: 18,
    forecastSource: 'historique',
    sends: 14,
    tiers: { CRENEAU: 1, REGULIER: 9, CONNU: 5 },
    costEstimate: { amount: 0.56, status: 'PRICED' },
    canPrepare: true,
    prepareBlockedReason: null,
    ...overrides,
  };
}

// Répond selon l'URL : une valeur Error fait échouer la route, sinon elle répond la valeur.
function routeGet(routes: { suggestions?: unknown; emptySlots?: unknown }) {
  mockGet.mockImplementation((path: string) => {
    const value = path === 'marketing/fill-suggestions' ? routes.suggestions : routes.emptySlots;
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  });
}

describe('EmptySlotsWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApi.mockReturnValue({
      orgId: 'org_test_123',
      isSignedIn: true,
      get: mockGet,
      post: mockPost,
      put: vi.fn(),
      patch: vi.fn(),
      del: vi.fn(),
    });
    // Par défaut la route des suggestions est refusée : la vue actuelle reste affichée.
    routeGet({ suggestions: new Error('Forbidden') });
  });

  it('état loading : affiche un skeleton', () => {
    // get ne résout jamais → loading reste true
    mockGet.mockReturnValue(new Promise(() => {}));
    renderWidget();
    // Le skeleton est rendu dans une section
    expect(document.querySelector('section')).toBeInTheDocument();
  });

  it('état error : annonce la panne avec un bouton pour réessayer, sans afficher la grille', async () => {
    routeGet({ suggestions: new Error('Forbidden'), emptySlots: new Error('Network error') });
    renderWidget();

    // Une panne ne doit pas ressembler à « aucun jour à renforcer ».
    expect(await screen.findByRole('alert')).toHaveTextContent('Network error');
    expect(
      screen.queryByText('Au moins 3 réservations sur chaque journée ouverte.'),
    ).not.toBeInTheDocument();

    routeGet({
      suggestions: new Error('Forbidden'),
      emptySlots: makeResponse([makeDay({ date: '2026-07-01' })], {}),
    });
    fireEvent.click(screen.getByRole('button', { name: /réessayer/i }));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    expect(mockGet).toHaveBeenCalledTimes(4);
  });

  it('état data : affiche les jours sous-réservés (actionableDays)', async () => {
    const days = [
      makeDay({ date: '2026-06-30', dayName: 'mar', reservationCount: 8 }),
      makeDay({
        date: '2026-07-01',
        dayName: 'mer',
        reservationCount: 2,
        isUnderbooked: true,
        revenueAtRisk: 120,
      }),
      makeDay({ date: '2026-07-02', dayName: 'jeu', reservationCount: 6 }),
      makeDay({ date: '2026-07-03', dayName: 'ven', reservationCount: 10 }),
      makeDay({ date: '2026-07-04', dayName: 'sam', reservationCount: 12 }),
      makeDay({ date: '2026-07-05', dayName: 'dim', isOpen: false }),
      makeDay({ date: '2026-07-06', dayName: 'lun', reservationCount: 7 }),
    ];
    routeGet({
      suggestions: new Error('Forbidden'),
      emptySlots: makeResponse(days, { underbookedDays: 1, revenueAtRisk: 120 }),
    });

    renderWidget();

    // Le titre reste court et directement exploitable en salle
    await waitFor(() => {
      expect(screen.getByText('Journées peu remplies')).toBeInTheDocument();
    });

    // Seul le jour sous-réservé (actionable) est listé
    expect(screen.getByText('Mercredi')).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) => element?.textContent?.replace(/\s+/g, ' ').trim() === '2 réservations',
        { selector: 'span' },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/120 €/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Remplir ce service' })).toHaveAttribute(
      'href',
      '/dashboard/marketing/fill-service?date=2026-07-01&service=soir',
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    fireEvent.focus(
      screen.getByRole('button', { name: 'Comprendre le seuil des journées peu remplies' }),
    );
    expect(await screen.findByRole('tooltip')).toHaveTextContent('ne mesure pas le remplissage');

    // Les jours pleins et fermés ne sont pas affichés
    expect(screen.queryByText('Mardi')).not.toBeInTheDocument();
    expect(screen.queryByText('Dimanche')).not.toBeInTheDocument();
    expect(screen.queryByText('Fermé')).not.toBeInTheDocument();
  });

  it("état data : semaine bien remplie (pas d'alerte)", async () => {
    const days = [
      makeDay({ date: '2026-07-10', dayName: 'mar' }),
      makeDay({ date: '2026-07-11', dayName: 'mer' }),
    ];
    routeGet({
      suggestions: new Error('Forbidden'),
      emptySlots: makeResponse(days, { underbookedDays: 0 }),
    });

    renderWidget();

    await waitFor(() => {
      expect(
        screen.getByText('Au moins 3 réservations sur chaque journée ouverte.'),
      ).toBeInTheDocument();
    });
  });

  it("retourne null si pas d'orgId", () => {
    mockUseApi.mockReturnValue({
      orgId: undefined,
      isSignedIn: false,
      get: mockGet,
      post: mockPost,
      put: vi.fn(),
      patch: vi.fn(),
      del: vi.fn(),
    });
    const { container } = renderWidget();
    expect(container.firstChild).toBeNull();
  });

  describe('suggestions de services creux', () => {
    it('affiche service, places vides et lien Préparer', async () => {
      routeGet({ suggestions: { data: [makeSuggestion()] }, emptySlots: makeResponse([]) });
      renderWidget();

      expect(await screen.findByText('Midi')).toBeInTheDocument();
      expect(screen.getByText(/18 places vides/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Préparer mercredi 4 nov. midi' })).toHaveAttribute(
        'href',
        '/dashboard/marketing/fill-service?date=2026-11-04&service=midi&channel=EMAIL',
      );
      expect(screen.queryByText(/Estimation sans historique suffisant/)).not.toBeInTheDocument();
    });

    it('affiche les envois, la composition par palier et le coût', async () => {
      routeGet({ suggestions: { data: [makeSuggestion()] }, emptySlots: makeResponse([]) });
      renderWidget();

      expect(await screen.findByText(/14 messages à envoyer/)).toBeInTheDocument();
      expect(screen.getByText(/1 habitué de ce créneau/)).toBeInTheDocument();
      expect(screen.getByText(/9 clients réguliers/)).toBeInTheDocument();
      expect(screen.getByText(/5 clients déjà venus/)).toBeInTheDocument();
      expect(screen.getByText(/Coût estimé : 0,56/)).toBeInTheDocument();
    });

    it('sans canPrepare : service affiché, pas de bouton Préparer', async () => {
      routeGet({
        suggestions: {
          data: [makeSuggestion({ canPrepare: false, sends: 0, tiers: {}, costEstimate: null })],
        },
        emptySlots: makeResponse([]),
      });
      renderWidget();

      expect(await screen.findByText('Midi')).toBeInTheDocument();
      expect(screen.getByText(/18 places vides/)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Préparer/ })).not.toBeInTheDocument();
      expect(screen.queryByText(/messages? à envoyer/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Ignorer/ })).toBeInTheDocument();
    });

    it('tarif non rapproché : le dit sans montant', async () => {
      routeGet({
        suggestions: {
          data: [makeSuggestion({ costEstimate: { amount: null, status: 'UNPRICED' } })],
        },
        emptySlots: makeResponse([]),
      });
      renderWidget();

      expect(await screen.findByText(/Tarif non rapproché/)).toBeInTheDocument();
    });

    it('n’additionne aucun gain et n’affiche aucun chiffre de couverts gagnés', async () => {
      routeGet({
        suggestions: {
          data: [makeSuggestion(), makeSuggestion({ date: '2026-11-05', service: 'soir' })],
        },
        emptySlots: makeResponse([]),
      });
      const { container } = renderWidget();

      await screen.findByText('Midi');
      expect(container.textContent).not.toMatch(/gagn|couverts|total|€ de|attendu/i);
      expect(container.textContent).not.toMatch(/28 messages/);
    });

    it('liste vide : annonce qu’il n’y a rien à remplir', async () => {
      routeGet({ suggestions: { data: [] }, emptySlots: makeResponse([]) });
      renderWidget();

      expect(
        await screen.findByText('Aucun service creux à remplir pour le moment.'),
      ).toBeInTheDocument();
    });

    it('route en 403 ou en panne : vue actuelle, avec ses 3 jours et ses libellés', async () => {
      const days = ['01', '02', '03', '04'].map((d) =>
        makeDay({ date: `2026-07-${d}`, reservationCount: 1, isUnderbooked: true }),
      );
      routeGet({
        suggestions: new Error('Forbidden'),
        emptySlots: makeResponse(days, { underbookedDays: 4 }),
      });
      renderWidget();

      expect(await screen.findByText('Journées peu remplies')).toBeInTheDocument();
      expect(screen.getAllByRole('link', { name: 'Remplir ce service' })).toHaveLength(3);
      expect(screen.getByText('+1 autre jour')).toBeInTheDocument();
      expect(screen.queryByText('Aucun service creux à remplir pour le moment.')).toBeNull();
    });

    it('les deux routes en panne : DataFetchError', async () => {
      routeGet({ suggestions: new Error('Panne A'), emptySlots: new Error('Panne B') });
      renderWidget();

      expect(await screen.findByRole('alert')).toHaveTextContent('Panne B');
    });

    it('suggestions OK et empty-slots en panne : affiche les suggestions, sans erreur', async () => {
      routeGet({ suggestions: { data: [makeSuggestion()] }, emptySlots: new Error('Panne') });
      renderWidget();

      expect(await screen.findByText('Midi')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('Ignorer : POST dismiss, la ligne disparaît', async () => {
      routeGet({
        suggestions: {
          data: [makeSuggestion(), makeSuggestion({ date: '2026-11-05', service: 'soir' })],
        },
        emptySlots: makeResponse([]),
      });
      mockPost.mockResolvedValue({});
      renderWidget();

      await screen.findByText('Midi');
      fireEvent.click(screen.getAllByRole('button', { name: /Ignorer/ })[0]);

      await waitFor(() => expect(screen.queryByText('Midi')).not.toBeInTheDocument());
      expect(mockPost).toHaveBeenCalledWith('marketing/fill-suggestions/dismiss', {
        date: '2026-11-04',
        service: 'midi',
      });
      expect(screen.getByText('Soir')).toBeInTheDocument();
    });

    it('Ignorer en échec : la ligne reste et le message d’erreur s’affiche', async () => {
      routeGet({ suggestions: { data: [makeSuggestion()] }, emptySlots: makeResponse([]) });
      mockPost.mockRejectedValue(new Error('503'));
      renderWidget();

      await screen.findByText('Midi');
      fireEvent.click(screen.getByRole('button', { name: /Ignorer/ }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Impossible d’ignorer ce service pour le moment. Réessayez.',
      );
      expect(screen.getByText('Midi')).toBeInTheDocument();
    });

    it.each([
      ['SENDS_DISABLED', 'Les envois marketing ne sont pas encore activés.'],
      ['BUDGET_EXHAUSTED', 'Le budget d’e-mails du jour est épuisé.'],
      ['NO_AUDIENCE', 'Aucun client à contacter pour ce service.'],
    ])('canPrepare faux, raison %s : affiche la phrase', async (reason, text) => {
      routeGet({
        suggestions: {
          data: [makeSuggestion({ canPrepare: false, prepareBlockedReason: reason })],
        },
        emptySlots: makeResponse([]),
      });
      renderWidget();

      const sentence = await screen.findByText(text);
      expect(sentence).toHaveClass('text-xs', 'text-muted-foreground');
      expect(screen.queryByRole('link', { name: /Préparer/ })).not.toBeInTheDocument();
    });

    it('aucune phrase sans raison (null, absente d’une ancienne entrée) ni quand canPrepare est vrai', async () => {
      const legacy = makeSuggestion({ canPrepare: false });
      delete (legacy as Record<string, unknown>).prepareBlockedReason;
      routeGet({
        suggestions: {
          data: [
            legacy,
            makeSuggestion({ date: '2026-11-05', service: 'soir' }),
            makeSuggestion({ date: '2026-11-06', canPrepare: false, prepareBlockedReason: null }),
          ],
        },
        emptySlots: makeResponse([]),
      });
      const { container } = renderWidget();

      await screen.findByText('Soir');
      expect(container.textContent).not.toMatch(/envois marketing|budget d’e-mails|Aucun client/);
    });

    it('Ignorer et Préparer nomment leur ligne', async () => {
      routeGet({
        suggestions: {
          data: [
            makeSuggestion({ date: '2026-11-03', service: 'midi' }),
            makeSuggestion({ date: '2026-11-04', service: 'soir' }),
          ],
        },
        emptySlots: makeResponse([]),
      });
      renderWidget();

      expect(
        await screen.findByRole('button', { name: 'Ignorer mardi 3 nov. midi' }),
      ).toBeVisible();
      expect(screen.getByRole('link', { name: 'Préparer mardi 3 nov. midi' })).toBeVisible();
      expect(screen.getByRole('button', { name: 'Ignorer mercredi 4 nov. soir' })).toBeVisible();
      expect(screen.getByRole('link', { name: 'Préparer mercredi 4 nov. soir' })).toBeVisible();
    });

    it('Ignorer est désactivé pendant l’appel, puis rétabli après un échec', async () => {
      routeGet({
        suggestions: {
          data: [
            makeSuggestion({ date: '2026-11-03', service: 'midi' }),
            makeSuggestion({ date: '2026-11-04', service: 'soir' }),
          ],
        },
        emptySlots: makeResponse([]),
      });
      let fail: (error: Error) => void = () => {};
      mockPost.mockReturnValue(new Promise((_, reject) => (fail = reject)));
      renderWidget();

      const first = await screen.findByRole('button', { name: 'Ignorer mardi 3 nov. midi' });
      fireEvent.click(first);
      expect(first).toBeDisabled();
      // Un second clic ne renvoie rien, et l'autre ligne reste active.
      fireEvent.click(first);
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Ignorer mercredi 4 nov. soir' })).toBeEnabled();

      fail(new Error('503'));
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      await waitFor(() => expect(first).toBeEnabled());
    });

    it('source simple : mention « Estimation sans historique suffisant »', async () => {
      routeGet({
        suggestions: { data: [makeSuggestion({ forecastSource: 'simple' })] },
        emptySlots: makeResponse([]),
      });
      renderWidget();

      expect(await screen.findByText(/Estimation sans historique suffisant/)).toBeInTheDocument();
    });
  });
});

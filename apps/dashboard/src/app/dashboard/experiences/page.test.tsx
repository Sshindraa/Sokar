import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExperiencesPage from './page';

// La page charge ses données en plusieurs requêtes : sous charge (pré-push, CI), 1 s par défaut ne suffit pas.
configure({ asyncUtilTimeout: 5000 });

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({
    get: apiMocks.get,
    post: apiMocks.post,
    patch: apiMocks.patch,
    del: apiMocks.del,
  }),
}));

const experience = {
  id: 'experience-1',
  key: 'wine-tasting',
  name: 'Dégustation de vins',
  description: null,
  durationMinutes: 90,
  priceCents: 4500,
  currency: 'EUR',
  capacity: 12,
  status: 'ACTIVE',
  sessionCount: 1,
  reservationCount: 1,
};

const sessionStartsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const sessionEndsAt = new Date(sessionStartsAt.getTime() + 90 * 60 * 1000);
const session = {
  id: 'session-1',
  experienceId: 'experience-1',
  startsAt: sessionStartsAt.toISOString(),
  endsAt: sessionEndsAt.toISOString(),
  capacityOverride: null,
  status: 'OPEN',
  experience: {
    key: 'wine-tasting',
    name: 'Dégustation de vins',
    priceCents: 4500,
    currency: 'EUR',
    capacity: 12,
  },
  reservationCount: 1,
};

const reservation = {
  id: 'experience-reservation-1',
  experienceId: 'experience-1',
  sessionId: 'session-1',
  quantity: 2,
  unitPriceCents: 4500,
  totalPriceCents: 9000,
  currency: 'EUR',
  status: 'CONFIRMED',
  experience: {
    key: 'wine-tasting',
    name: 'Dégustation de vins',
    priceCents: 4500,
    currency: 'EUR',
  },
  session: { startsAt: session.startsAt, endsAt: session.endsAt },
  customerName: 'Alice Martin',
  phoneLast4: '1234',
  cancelledAt: null,
};

describe('ExperiencesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/dashboard/experiences');
    apiMocks.del.mockResolvedValue({});
    apiMocks.get.mockImplementation((path: string) => {
      if (path.startsWith('experiences?')) return Promise.resolve({ data: [experience] });
      if (path.startsWith('experience-reservations'))
        return Promise.resolve({ data: [reservation] });
      return Promise.resolve({ data: [session] });
    });
    apiMocks.post.mockImplementation((path: string) => {
      if (path === 'experiences')
        return Promise.resolve({
          data: { ...experience, id: 'new-experience', name: 'Atelier vins', status: 'DRAFT' },
        });
      if (path.includes('/sessions') && path.endsWith('/reservations')) {
        return Promise.resolve({ data: { ...reservation, replayed: false } });
      }
      if (path.includes('/cancel'))
        return Promise.resolve({ data: { ...reservation, status: 'CANCELLED' } });
      return Promise.resolve({ data: session });
    });
    apiMocks.patch.mockResolvedValue({ data: { ...experience, status: 'DRAFT' } });
  });

  it('charge le catalogue, les sessions et les réservations', async () => {
    render(<ExperiencesPage />);

    expect(
      await screen.findByRole('heading', { name: 'Expériences & événements' }),
    ).toBeInTheDocument();
    expect((await screen.findAllByText('Dégustation de vins')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Alice Martin/)).toBeInTheDocument();
    expect(screen.getByText('Prochaines dates')).toBeInTheDocument();
    expect(screen.getByText('Réservations confirmées')).toBeInTheDocument();
  });

  it('convertit le prix saisi en euros en centimes pour l’API', async () => {
    render(<ExperiencesPage />);
    await screen.findByRole('heading', { name: 'Expériences & événements' });

    fireEvent.click(await screen.findByRole('button', { name: 'Créer une expérience' }));
    expect(screen.queryByLabelText('Clé')).not.toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('Nom'), { target: { value: 'Atelier vins' } });
    fireEvent.change(screen.getByLabelText('Prix par personne (€)'), {
      target: { value: '45.50' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer l’expérience' }));

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('experiences', {
        key: expect.stringMatching(/^atelier-vins-[a-f0-9]{8}$/),
        name: 'Atelier vins',
        durationMinutes: 90,
        priceCents: 4550,
        capacity: 12,
      }),
    );
    expect(await screen.findByText(/Expérience créée. Ajoutez maintenant/)).toBeInTheDocument();
  });

  it('ouvre directement le formulaire quand le choix global demande une expérience', async () => {
    window.history.replaceState({}, '', '/dashboard/experiences?create=1');
    render(<ExperiencesPage />);
    expect(await screen.findByRole('heading', { name: 'Nouvelle expérience' })).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('ouvre une session avec les dates converties en ISO', async () => {
    render(<ExperiencesPage />);
    await screen.findByRole('heading', { name: 'Expériences & événements' });
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter une date' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter la date' }));

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        'experiences/experience-1/sessions',
        expect.objectContaining({
          startsAt: expect.stringMatching(/T/),
          endsAt: expect.stringMatching(/T/),
        }),
      ),
    );
  });

  it('annule une réservation et garde le message de capacité libérée', async () => {
    render(<ExperiencesPage />);
    await screen.findByRole('heading', { name: 'Expériences & événements' });
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler' }));

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        'experience-reservations/experience-reservation-1/cancel',
      ),
    );
    expect(await screen.findByText('Réservation d’expérience annulée.')).toBeInTheDocument();
  });

  it('modifie une offre sans changer sa clé ni son statut', async () => {
    render(<ExperiencesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
    await waitFor(() => expect(screen.getByLabelText('Nom')).toHaveValue('Dégustation de vins'));
    expect(screen.getByLabelText('Prix par personne (€)')).toHaveValue('45,00');
    fireEvent.change(screen.getByLabelText('Prix par personne (€)'), {
      target: { value: '49,50' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() =>
      expect(apiMocks.patch).toHaveBeenCalledWith('experiences/experience-1', {
        name: 'Dégustation de vins',
        durationMinutes: 90,
        priceCents: 4950,
        capacity: 12,
      }),
    );
    expect(await screen.findByText('Expérience mise à jour.')).toBeInTheDocument();
  });

  it('permet d’activer un brouillon depuis l’en-tête de sa fiche', async () => {
    apiMocks.get.mockImplementation((path: string) =>
      Promise.resolve({
        data: path.startsWith('experiences?')
          ? [{ ...experience, status: 'DRAFT' }]
          : path.includes('/sessions?')
            ? [session]
            : [],
      }),
    );
    render(<ExperiencesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activer l’expérience' }));
    await waitFor(() =>
      expect(apiMocks.patch).toHaveBeenCalledWith('experiences/experience-1', { status: 'ACTIVE' }),
    );
  });

  it('demande une date avant de proposer l’activation', async () => {
    apiMocks.get.mockImplementation((path: string) =>
      Promise.resolve({
        data: path.startsWith('experiences?') ? [{ ...experience, status: 'DRAFT' }] : [],
      }),
    );
    render(<ExperiencesPage />);
    expect(
      await screen.findByText('Ajoutez une première date avant d’activer cette expérience.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activer l’expérience' })).not.toBeInTheDocument();
    const addSessionButton = await screen.findByRole('button', { name: 'Ajouter une date' });
    await waitFor(() => expect(addSessionButton).toBeEnabled());
    fireEvent.click(addSessionButton);
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter la date' }));
    expect(await screen.findByText('Prête à être activée')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Activer l’expérience' })).toBeEnabled();
  });

  it('confirme une suppression de brouillon avant d’appeler l’API', async () => {
    apiMocks.get.mockImplementation((path: string) =>
      Promise.resolve({
        data: path.startsWith('experiences?')
          ? [{ ...experience, status: 'DRAFT', reservationCount: 0 }]
          : path.includes('/sessions?')
            ? [session]
            : [],
      }),
    );
    render(<ExperiencesPage />);
    fireEvent.click(await screen.findByLabelText('Autres actions'));
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer l’expérience' }));
    expect(apiMocks.del).not.toHaveBeenCalled();
    expect(await screen.findByRole('dialog')).toHaveTextContent('Cette action est définitive');
    fireEvent.click(screen.getByRole('button', { name: /^Supprimer$/ }));
    await waitFor(() => expect(apiMocks.del).toHaveBeenCalledWith('experiences/experience-1'));
  });

  it('conserve uniquement l’archivage pour une expérience utilisée', async () => {
    render(<ExperiencesPage />);
    const menu = await screen.findByLabelText('Autres actions');
    fireEvent.click(menu);
    expect(
      screen.queryByRole('button', { name: 'Supprimer l’expérience' }),
    ).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Archiver' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Archiver$/ }));
    await waitFor(() =>
      expect(apiMocks.patch).toHaveBeenCalledWith('experiences/experience-1', {
        status: 'ARCHIVED',
      }),
    );
  });

  it('prépare une copie sans dates et sans créer de données avant validation', async () => {
    render(<ExperiencesPage />);
    fireEvent.click(await screen.findByLabelText('Autres actions'));
    fireEvent.click(await screen.findByRole('button', { name: 'Dupliquer' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Nom')).toHaveValue('Dégustation de vins (copie)'),
    );
    expect(screen.getByLabelText('Prix par personne (€)')).toHaveValue('45,00');
    expect(apiMocks.post).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Créer l’expérience' })).toBeEnabled();
  });

  it('présente un accueil vide sans formulaire ni compteurs', async () => {
    apiMocks.get.mockResolvedValue({ data: [] });
    render(<ExperiencesPage />);
    expect(await screen.findByText('Créez votre première expérience')).toBeInTheDocument();
    expect(screen.queryByLabelText('Nom')).not.toBeInTheDocument();
    expect(screen.queryByText('Expériences actives')).not.toBeInTheDocument();
    expect(screen.queryByText('Prochaines dates')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Créer une expérience' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('explique le verrouillage quand la fondation est désactivée', async () => {
    apiMocks.get.mockRejectedValue(
      new Error('Les expériences restent désactivées jusqu’à la qualification du pilote.'),
    );
    render(<ExperiencesPage />);
    expect(await screen.findByText('Expériences bientôt disponibles')).toBeInTheDocument();
    expect(screen.getByText(/Vos données ne sont pas modifiées/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Clé')).not.toBeInTheDocument();
    expect(screen.queryByText('Expériences actives')).not.toBeInTheDocument();
  });
});

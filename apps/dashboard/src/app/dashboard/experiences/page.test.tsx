import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExperiencesPage from './page';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({
    get: apiMocks.get,
    post: apiMocks.post,
    patch: apiMocks.patch,
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

const session = {
  id: 'session-1',
  experienceId: 'experience-1',
  startsAt: '2026-09-20T18:00:00.000Z',
  endsAt: '2026-09-20T19:30:00.000Z',
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
    apiMocks.get.mockImplementation((path: string) => {
      if (path.startsWith('experiences?')) return Promise.resolve({ data: [experience] });
      if (path.startsWith('experience-reservations'))
        return Promise.resolve({ data: [reservation] });
      return Promise.resolve({ data: [session] });
    });
    apiMocks.post.mockImplementation((path: string) => {
      if (path === 'experiences') return Promise.resolve({ data: experience });
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

    expect(await screen.findByRole('heading', { name: 'Expériences' })).toBeInTheDocument();
    expect(await screen.findByText('Dégustation de vins')).toBeInTheDocument();
    expect(await screen.findByText(/Alice Martin/)).toBeInTheDocument();
    expect(screen.getByText('Sessions — Dégustation de vins')).toBeInTheDocument();
    expect(screen.getByText('Réservations confirmées')).toBeInTheDocument();
  });

  it('crée une expérience avec des nombres explicites', async () => {
    render(<ExperiencesPage />);
    await screen.findByRole('heading', { name: 'Expériences' });

    fireEvent.change(screen.getByLabelText('Clé'), { target: { value: 'atelier-vins' } });
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Atelier vins' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer l’expérience' }));

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('experiences', {
        key: 'atelier-vins',
        name: 'Atelier vins',
        durationMinutes: 90,
        priceCents: 0,
        capacity: 12,
      }),
    );
    expect(await screen.findByText(/Expérience créée en brouillon/)).toBeInTheDocument();
  });

  it('ouvre une session avec les dates converties en ISO', async () => {
    render(<ExperiencesPage />);
    await screen.findByRole('heading', { name: 'Expériences' });
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir la session' }));

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
    await screen.findByRole('heading', { name: 'Expériences' });
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        'experience-reservations/experience-reservation-1/cancel',
      ),
    );
    expect(await screen.findByText('Réservation d’expérience annulée.')).toBeInTheDocument();
  });

  it('explique le verrouillage quand la fondation est désactivée', async () => {
    apiMocks.get.mockRejectedValue(new Error('EXPERIENCES_DISABLED'));
    render(<ExperiencesPage />);
    expect(await screen.findByText('EXPERIENCES_DISABLED')).toBeInTheDocument();
    expect(screen.getByText(/restent verrouillées pendant le gel/)).toBeInTheDocument();
  });
});

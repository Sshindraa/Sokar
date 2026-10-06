import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaceImportDraft } from '../onboarding-provider';
import { RestaurantStep } from './RestaurantStep';

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  post: vi.fn(),
  updateTask: vi.fn(),
  setPlaceImportDraft: vi.fn(),
  placeImportDraft: null as PlaceImportDraft | null,
  restaurant: {
    id: 'restaurant-1',
    name: 'Chez Sokar',
    managerPhone: '+33611112222',
    managerEmail: 'contact@sokar.fr',
    phoneE164: null as string | null,
    googlePlaceId: null as string | null,
  },
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ patch: mocks.patch, post: mocks.post, orgId: 'restaurant-1' }),
}));

vi.mock('../onboarding-provider', () => ({
  useOnboarding: () => ({
    state: { restaurant: mocks.restaurant },
    updateTask: mocks.updateTask,
    placeImportDraft: mocks.placeImportDraft,
    setPlaceImportDraft: mocks.setPlaceImportDraft,
  }),
}));

describe('RestaurantStep Google Places prefill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.placeImportDraft = null;
    Object.assign(mocks.restaurant, {
      name: 'Chez Sokar',
      managerPhone: '+33611112222',
      managerEmail: 'contact@sokar.fr',
      phoneE164: null,
      googlePlaceId: null,
    });
    mocks.patch.mockResolvedValue({});
    mocks.updateTask.mockResolvedValue({});
  });

  it('keeps the selected-place message compact and lets the user remove it from the search field', () => {
    mocks.placeImportDraft = {
      placeId: 'ChIJrestaurant123',
      name: 'Le Bistrot',
      phoneE164: '+33123456789',
      formattedAddress: '12 rue de la République',
      postalCode: '69002',
      city: 'Lyon',
      country: 'FR',
      openingHours: { mon: { open: '12:00', close: '14:30' } },
      hoursNeedReview: [],
    };

    render(<RestaurantStep onComplete={vi.fn()} />);

    expect(screen.queryByText(/Établissement sélectionné/)).not.toBeInTheDocument();
    expect(screen.getByText('Informations trouvées sur Google Maps')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retirer la fiche sélectionnée' }));
    expect(mocks.setPlaceImportDraft).toHaveBeenCalledWith(null);
  });

  it('shows Google Maps attribution only once while autocomplete results are open', async () => {
    mocks.placeImportDraft = {
      placeId: 'ChIJrestaurant123',
      name: 'Le Bistrot',
      phoneE164: '+33123456789',
      formattedAddress: '12 rue de la République',
      postalCode: '69002',
      city: 'Lyon',
      country: 'FR',
      openingHours: {},
      hoursNeedReview: [],
    };
    mocks.post.mockResolvedValue({
      suggestions: [{ placeId: 'ChIJcarmelo', mainText: 'Carmelo', secondaryText: 'Lyon, France' }],
    });

    render(<RestaurantStep onComplete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Rechercher un restaurant sur Google Maps'), {
      target: { value: 'Carmelo Lyon' },
    });

    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByText('Google Maps')).toBeInTheDocument();
    expect(screen.getAllByText('Google Maps')).toHaveLength(1);
  });

  it('uses the imported restaurant phone as the only number in the onboarding form', async () => {
    const place = {
      placeId: 'ChIJrestaurant123',
      name: 'Le Bistrot',
      phoneE164: '+33123456789',
      formattedAddress: '12 rue de la République',
      postalCode: '69002',
      city: 'Lyon',
      country: 'FR',
      openingHours: { mon: { open: '12:00', close: '14:30' } },
      hoursNeedReview: [],
    };
    mocks.post
      .mockResolvedValueOnce({
        suggestions: [
          {
            placeId: place.placeId,
            mainText: 'Le Bistrot',
            secondaryText: 'Lyon, France',
          },
        ],
      })
      .mockResolvedValueOnce(place);
    const complete = vi.fn();

    render(<RestaurantStep onComplete={complete} />);
    expect(screen.getByLabelText(/Le numéro que les clients vont appeler/)).toHaveValue('');
    expect(screen.getByText(/Facultatif : sélectionnez votre fiche/)).toBeInTheDocument();

    const searchInput = screen.getByLabelText('Rechercher un restaurant sur Google Maps');
    fireEvent.change(searchInput, {
      target: { value: 'Le Bistrot Lyon' },
    });
    await screen.findByRole('option', { name: /Le Bistrot.*Lyon, France/ });
    expect(screen.queryByText(/Facultatif : sélectionnez votre fiche/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('listbox')).getByText('Google Maps')).toBeInTheDocument();
    fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() => expect(mocks.setPlaceImportDraft).toHaveBeenCalledWith(place));
    expect(screen.getByLabelText(/Nom du restaurant/)).toHaveValue('Le Bistrot');
    expect(screen.getByLabelText(/Le numéro que les clients vont appeler/)).toHaveValue(
      '+33123456789',
    );

    // Provenance Google affichée champ par champ, uniquement là où la donnée a été importée.
    const nameLabel = screen.getByLabelText(/Nom du restaurant/).closest('label');
    const publicPhoneLabel = screen
      .getByLabelText(/Le numéro que les clients vont appeler/)
      .closest('label');
    const emailLabel = screen.getByLabelText('Email de gestion').closest('label');
    expect(within(nameLabel!).getByText('Importé depuis Google')).toBeInTheDocument();
    expect(within(publicPhoneLabel!).getByText('Importé depuis Google')).toBeInTheDocument();
    expect(within(emailLabel!).queryByText('Importé depuis Google')).not.toBeInTheDocument();
    expect(screen.getByText("Ce numéro servira aussi pour l'appel test.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continuer vers les horaires' }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith('restaurants/restaurant-1', {
        name: 'Le Bistrot',
        managerEmail: 'contact@sokar.fr',
        phoneE164: '+33123456789',
        googlePlaceId: place.placeId,
      }),
    );
    expect(complete).toHaveBeenCalledWith('hours');
  });
});

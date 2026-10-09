import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { OnboardingRestaurant } from '../types';
import type { PlaceImportDraft } from '../onboarding-provider';
import { ConnectIdentityStep } from './ConnectIdentityStep';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  updateTask: vi.fn(),
  setIdentityDraft: vi.fn(),
  setRestaurantDraft: vi.fn(),
  restaurant: {} as OnboardingRestaurant,
  placeImportDraft: null as PlaceImportDraft | null,
}));
vi.mock('@/lib/api', () => ({ useApi: () => ({ ...mocks, orgId: 'local-test' }) }));
vi.mock('../onboarding-provider', () => ({
  useOnboarding: () => ({ state: { restaurant: mocks.restaurant }, identityDraft: null, ...mocks }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.placeImportDraft = null;
  mocks.restaurant = {
    id: 'local-test',
    name: 'Chez Émile',
    managerEmail: '',
    managerPhone: '',
    phoneNumber: '',
    phoneAssigned: false,
    googleCalendarId: null,
    googleConnected: false,
    openingHours: { mon: { open: '12:00', close: '14:30' } },
    formattedAddress: '1 rue des Tables',
    postalCode: '69002',
    city: 'Lyon',
    country: 'FR',
    lat: 45.76,
    lng: 4.83,
  };
  mocks.get.mockResolvedValue({ available: true });
  mocks.patch.mockResolvedValue({});
  mocks.updateTask.mockResolvedValue({});
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

const submit = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Vérifier avant publication' }));
it('affiche l’éditeur, reprend l’adresse et passe directement à la publication sans cuisine ni présentation', async () => {
  const complete = vi.fn();
  render(<ConnectIdentityStep onComplete={complete} />);
  expect(screen.getByLabelText('Présentation Facultative')).toHaveValue('');
  expect(screen.queryByText(/Découvrez/)).not.toBeInTheDocument();
  const preview = screen.getByRole('complementary', {
    name: 'Aperçu de votre page de réservation',
  });
  expect(within(preview).getByRole('heading', { name: 'Chez Émile' })).toBeInTheDocument();
  expect(within(preview).getByText(/1 rue des Tables/)).toBeInTheDocument();
  submit();
  await waitFor(() => expect(complete).toHaveBeenCalledWith('connect-activation'));
  expect(mocks.patch).toHaveBeenCalledWith(
    'restaurants/local-test/connect',
    expect.objectContaining({
      description: '',
      cuisineType: [],
      priceRange: null,
      lat: 45.76,
      lng: 4.83,
    }),
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(mocks.post).not.toHaveBeenCalled();
});
it('actualise la présentation dans l’aperçu et conserve une présentation effacée', async () => {
  render(<ConnectIdentityStep onComplete={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Présentation Facultative'), {
    target: { value: 'Une cuisine de saison.' },
  });
  expect(
    within(screen.getByRole('complementary')).getByText('Une cuisine de saison.'),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Présentation Facultative'), { target: { value: '' } });
  submit();
  await waitFor(() =>
    expect(mocks.patch).toHaveBeenCalledWith(
      'restaurants/local-test/connect',
      expect.objectContaining({ description: '' }),
    ),
  );
});
it('ne sauvegarde pas un lien déjà utilisé', async () => {
  mocks.get.mockResolvedValue({ available: false });
  const complete = vi.fn();
  render(<ConnectIdentityStep onComplete={complete} />);
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('déjà utilisée');
  expect(mocks.patch).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
});
it('conserve la saisie si la sauvegarde échoue', async () => {
  mocks.patch.mockRejectedValue(new Error('offline'));
  render(<ConnectIdentityStep onComplete={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Présentation Facultative'), {
    target: { value: 'Notre présentation.' },
  });
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Votre saisie est conservée');
  expect(screen.getByLabelText('Présentation Facultative')).toHaveValue('Notre présentation.');
});
it('demande une adresse manquante dans l’éditeur', () => {
  mocks.restaurant.formattedAddress = '';
  render(<ConnectIdentityStep onComplete={vi.fn()} />);
  submit();
  expect(screen.getByRole('alert')).toHaveTextContent('Complétez l’adresse');
  expect(screen.getByLabelText('Rue et numéro')).toBeVisible();
  expect(mocks.patch).not.toHaveBeenCalled();
});
it('géocode une adresse corrigée sans garder les anciennes coordonnées', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify([{ lat: '45.8', lon: '4.9' }])));
  render(<ConnectIdentityStep onComplete={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
  fireEvent.change(screen.getByLabelText('Rue et numéro'), {
    target: { value: '2 rue des Tables' },
  });
  submit();
  await waitFor(() =>
    expect(mocks.patch).toHaveBeenCalledWith(
      'restaurants/local-test/connect',
      expect.objectContaining({ formattedAddress: '2 rue des Tables', lat: 45.8, lng: 4.9 }),
    ),
  );
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('2%20rue%20des%20Tables'));
});
it('refuse une position introuvable et permet de la préciser', async () => {
  mocks.restaurant.lat = null;
  vi.mocked(fetch).mockResolvedValue(new Response('[]'));
  render(<ConnectIdentityStep onComplete={vi.fn()} />);
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Adresse introuvable');
  expect(screen.getByLabelText('Latitude')).toBeVisible();
  expect(mocks.patch).not.toHaveBeenCalled();
});
it('reprend le brouillon Google restauré après le premier rendu', async () => {
  mocks.restaurant.name = '';
  mocks.restaurant.formattedAddress = '';
  const view = render(<ConnectIdentityStep onComplete={vi.fn()} />);
  mocks.placeImportDraft = {
    placeId: 'test-place',
    name: 'Little Italy Lyon',
    displayName: 'Little Italy',
    phoneE164: '',
    formattedAddress: '2 place des Tables',
    city: 'Lyon',
    postalCode: '69002',
    country: 'FR',
    lat: 45.76,
    lng: 4.83,
    openingHours: {},
    hoursNeedReview: [],
  };
  view.rerender(<ConnectIdentityStep onComplete={vi.fn()} />);
  expect(screen.getByRole('heading', { name: 'Little Italy' })).toBeInTheDocument();
  expect(screen.getByLabelText('Votre lien de réservation')).toHaveValue('little-italy');
  submit();
  await waitFor(() =>
    expect(mocks.patch).toHaveBeenCalledWith(
      'restaurants/local-test/connect',
      expect.objectContaining({ formattedAddress: '2 place des Tables' }),
    ),
  );
});
it('n’avance pas si la complétion échoue après la sauvegarde', async () => {
  mocks.updateTask.mockResolvedValue(null);
  const complete = vi.fn();
  render(<ConnectIdentityStep onComplete={complete} />);
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Votre saisie est conservée');
  expect(complete).not.toHaveBeenCalled();
});

it('permet de réessayer sans perdre l’adresse si la localisation est indisponible', async () => {
  mocks.restaurant.lat = null;
  vi.mocked(fetch).mockRejectedValue(new Error('offline'));
  render(<ConnectIdentityStep onComplete={vi.fn()} />);
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'La position ne peut pas être vérifiée',
  );
  expect(screen.getByLabelText('Latitude')).toBeVisible();
  expect(screen.getByLabelText('Rue et numéro')).toHaveValue('1 rue des Tables');
  expect(mocks.patch).not.toHaveBeenCalled();
});

it('laisse corriger un lien effacé sans le remplacer automatiquement', () => {
  render(<ConnectIdentityStep onComplete={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Votre lien de réservation'), { target: { value: '' } });
  expect(screen.getByLabelText('Votre lien de réservation')).toHaveValue('');
  submit();
  expect(screen.getByRole('alert')).toHaveTextContent('Vérifiez le lien');
  expect(mocks.patch).not.toHaveBeenCalled();
});

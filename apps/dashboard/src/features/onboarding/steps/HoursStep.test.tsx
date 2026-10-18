import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { PlaceImportDraft } from '../onboarding-provider';
import { HoursStep } from './HoursStep';

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  updateTask: vi.fn(),
  setPlaceImportDraft: vi.fn(),
  state: {
    restaurant: { openingHours: {} },
    defaultHours: {
      tue: { open: '12:00', close: '22:00' },
      wed: { open: '12:00', close: '22:00' },
    },
  },
  placeImportDraft: null as PlaceImportDraft | null,
}));
vi.mock('@/lib/api', () => ({ useApi: () => ({ patch: mocks.patch, orgId: 'restaurant-1' }) }));
vi.mock('../onboarding-provider', () => ({ useOnboarding: () => mocks }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.patch.mockResolvedValue({});
  mocks.updateTask.mockResolvedValue({});
  mocks.placeImportDraft = null;
});
function choose(label: string, time: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('option', { name: time }));
}

function configureDay(day: string) {
  fireEvent.click(screen.getByRole('button', { name: `Modifier ${day.toLowerCase()}` }));
  choose('Midi 12:00–14:30 : dernière arrivée', '13:30');
  choose('Soir 19:00–22:30 : dernière arrivée', '21:30');
}
it('affiche les jours et applique automatiquement les services aux autres jours ouverts', async () => {
  const complete = vi.fn();
  render(<HoursStep onComplete={complete} />);
  expect(screen.getAllByRole('combobox')).toHaveLength(2);
  expect(screen.queryByText(/Exemple :/)).not.toBeInTheDocument();
  expect(screen.queryByText('Vos jours')).not.toBeInTheDocument();
  expect(screen.queryByText('Horaires Google Maps')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Appliquer/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Continuer/ })).toBeDisabled();
  configureDay('Mardi');
  expect(screen.getByRole('button', { name: /Continuer/ })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Modifier mercredi' }));
  expect(
    screen.getByRole('combobox', { name: 'Midi 12:00–14:30 : dernière arrivée' }),
  ).toHaveTextContent('13:30');
  expect(
    screen.getByRole('combobox', { name: 'Soir 19:00–22:30 : dernière arrivée' }),
  ).toHaveTextContent('21:30');
  fireEvent.click(screen.getByRole('button', { name: /Continuer/ }));
  await waitFor(() => expect(complete).toHaveBeenCalledWith('floor'));
  for (const day of ['tue', 'wed'])
    expect(mocks.patch.mock.calls[0][1].openingHours[day].slots[1]).toEqual({
      open: '19:00',
      close: '22:30',
      lastBooking: '21:30',
    });
});
it('reste sur la page si la sauvegarde échoue', async () => {
  mocks.patch.mockRejectedValue(new Error('offline'));
  const complete = vi.fn();
  render(<HoursStep onComplete={complete} />);
  configureDay('Mardi');
  fireEvent.click(screen.getByRole('button', { name: /Continuer/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Réessayez');
  expect(complete).not.toHaveBeenCalled();
});

it('modifie les ouvertures dans un panneau et demande de reconfirmer le jour modifié', () => {
  render(<HoursStep onComplete={vi.fn()} />);
  configureDay('Mardi');
  expect(screen.getByRole('button', { name: /Continuer/ })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Modifier mardi' }));
  fireEvent.click(screen.getByRole('button', { name: 'Modifier les horaires de mardi' }));
  expect(screen.getByRole('region', { name: 'Horaires du mardi' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Mardi, midi : fermeture'), {
    target: { value: '15:00' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Terminer' }));
  expect(screen.queryByRole('region', { name: 'Horaires du mardi' })).not.toBeInTheDocument();
  expect(
    screen.getByRole('combobox', { name: 'Midi 12:00–15:00 : dernière arrivée' }),
  ).toHaveTextContent('Choisir');
  expect(screen.getByRole('button', { name: /Continuer/ })).toBeDisabled();
});
it('permet d’ouvrir un jour fermé sans confondre les services absents', () => {
  render(<HoursStep onComplete={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Modifier lundi' }));
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Modifier les horaires de lundi' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Lundi ouvert' }));
  fireEvent.click(screen.getByRole('button', { name: 'Terminer' }));
  expect(
    screen.getByRole('combobox', { name: 'Midi 12:00–14:30 : dernière arrivée' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('combobox', { name: 'Soir 19:00–22:30 : dernière arrivée' }),
  ).toBeInTheDocument();
});

it('applique automatiquement les deux heures aux autres jours ouverts', async () => {
  const complete = vi.fn();
  render(<HoursStep onComplete={complete} />);
  configureDay('Mardi');
  expect(screen.getByRole('button', { name: /Continuer/ })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Modifier mercredi' }));
  expect(
    screen.getByRole('combobox', { name: 'Midi 12:00–14:30 : dernière arrivée' }),
  ).toHaveTextContent('13:30');
  expect(
    screen.getByRole('combobox', { name: 'Soir 19:00–22:30 : dernière arrivée' }),
  ).toHaveTextContent('21:30');
  fireEvent.click(screen.getByRole('button', { name: /Continuer/ }));
  await waitFor(() => expect(complete).toHaveBeenCalledWith('floor'));
  const saved = mocks.patch.mock.calls[0][1].openingHours;
  expect(saved.mon).toBeNull();
  expect(saved.wed.slots).toEqual([
    { open: '12:00', close: '14:30', lastBooking: '13:30' },
    { open: '19:00', close: '22:30', lastBooking: '21:30' },
  ]);
});

it('ajuste automatiquement la dernière arrivée aux services plus courts', () => {
  mocks.placeImportDraft = {
    placeId: 'test-place',
    name: 'Restaurant',
    phoneE164: '',
    formattedAddress: '',
    postalCode: '',
    city: '',
    country: 'FR',
    hoursNeedReview: [],
    openingHours: {
      mon: {
        open: '12:00',
        close: '23:00',
        slots: [
          { open: '12:00', close: '15:00' },
          { open: '19:00', close: '23:00' },
        ],
      },
      tue: {
        open: '12:00',
        close: '22:00',
        slots: [
          { open: '12:00', close: '14:00' },
          { open: '19:00', close: '22:00' },
        ],
      },
      wed: { open: '19:00', close: '22:00' },
    },
  };
  render(<HoursStep onComplete={vi.fn()} />);
  choose('Midi 12:00–15:00 : dernière arrivée', '14:30');
  choose('Soir 19:00–23:00 : dernière arrivée', '21:30');
  expect(screen.getByRole('button', { name: /Continuer/ })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Modifier mardi' }));
  expect(
    screen.getByRole('combobox', { name: 'Midi 12:00–14:00 : dernière arrivée' }),
  ).toHaveTextContent('13:30');
  expect(
    screen.getByRole('combobox', { name: 'Soir 19:00–22:00 : dernière arrivée' }),
  ).toHaveTextContent('21:30');
  fireEvent.click(screen.getByRole('button', { name: 'Modifier mercredi' }));
  expect(screen.getAllByRole('combobox')).toHaveLength(1);
  expect(
    screen.getByRole('combobox', { name: 'Soir 19:00–22:00 : dernière arrivée' }),
  ).toHaveTextContent('21:30');
});

it('propage aussi les modifications suivantes aux autres jours ouverts', () => {
  render(<HoursStep onComplete={vi.fn()} />);
  configureDay('Mardi');
  fireEvent.click(screen.getByRole('button', { name: 'Modifier mercredi' }));
  choose('Midi 12:00–14:30 : dernière arrivée', '14:00');
  fireEvent.click(screen.getByRole('button', { name: 'Modifier mardi' }));
  expect(
    screen.getByRole('combobox', { name: 'Midi 12:00–14:30 : dernière arrivée' }),
  ).toHaveTextContent('14:00');
});

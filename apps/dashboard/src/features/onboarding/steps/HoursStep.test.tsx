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

function configureTuesday() {
  choose('Midi 12:00–14:30 : dernière arrivée', '13:30');
  choose('Soir 19:00–22:30 : dernière arrivée', '21:30');
}
it('édite uniquement le jour choisi et copie les derniers créneaux sans changer les horaires', async () => {
  const complete = vi.fn();
  render(<HoursStep onComplete={complete} />);
  expect(screen.getAllByRole('combobox')).toHaveLength(2);
  expect(screen.getByRole('button', { name: /Continuer/ })).toBeDisabled();
  expect(screen.queryByText(/Confirmer 14:00/)).not.toBeInTheDocument();
  configureTuesday();
  expect(screen.getByRole('button', { name: /Continuer/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Choisir les jours' }));
  fireEvent.click(screen.getByRole('button', { name: 'Appliquer à mercredi' }));
  fireEvent.click(screen.getByRole('button', { name: /^Appliquer$/ }));
  fireEvent.click(screen.getByRole('button', { name: /Continuer/ }));
  await waitFor(() => expect(complete).toHaveBeenCalledWith('floor'));
  for (const day of ['tue', 'wed'])
    expect(mocks.patch.mock.calls[0][1].openingHours[day].slots[1]).toEqual({
      open: '19:00',
      close: '22:30',
      lastBooking: '21:30',
    });
});
it('annule une copie et restaure aussi les confirmations', () => {
  render(<HoursStep onComplete={vi.fn()} />);
  configureTuesday();
  fireEvent.click(screen.getByRole('button', { name: 'Choisir les jours' }));
  fireEvent.click(screen.getByRole('button', { name: 'Appliquer à mercredi' }));
  fireEvent.click(screen.getByRole('button', { name: /^Appliquer$/ }));
  expect(screen.getByRole('button', { name: /Continuer/ })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(screen.getByRole('button', { name: /Continuer/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Modifier mercredi' }));
  expect(screen.getByRole('combobox', { name: /Midi.*dernière arrivée/ })).toHaveTextContent(
    'Choisir',
  );
});
it('conserve un service incompatible et empêche la progression', () => {
  mocks.placeImportDraft = {
    placeId: 'place123',
    name: 'Restaurant',
    phoneE164: '',
    formattedAddress: '',
    postalCode: '',
    city: '',
    country: 'FR',
    openingHours: {
      mon: { open: '11:30', close: '15:00' },
      tue: { open: '11:30', close: '14:00' },
    },
    hoursNeedReview: [],
  };
  render(<HoursStep onComplete={vi.fn()} />);
  choose('Service 11:30–15:00 : dernière arrivée', '14:30');
  fireEvent.click(screen.getByRole('button', { name: 'Choisir les jours' }));
  fireEvent.click(screen.getByRole('button', { name: 'Appliquer à mardi' }));
  fireEvent.click(screen.getByRole('button', { name: /^Appliquer$/ }));
  expect(screen.getByText(/À vérifier/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Continuer/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Modifier mardi' }));
  expect(
    screen.getByRole('combobox', { name: 'Service 11:30–14:00 : dernière arrivée' }),
  ).toHaveTextContent('Choisir');
});
it('reste sur la page si la sauvegarde échoue', async () => {
  mocks.patch.mockRejectedValue(new Error('offline'));
  const complete = vi.fn();
  render(<HoursStep onComplete={complete} />);
  configureTuesday();
  fireEvent.click(screen.getByRole('button', { name: 'Choisir les jours' }));
  fireEvent.click(screen.getByRole('button', { name: 'Appliquer à mercredi' }));
  fireEvent.click(screen.getByRole('button', { name: /^Appliquer$/ }));
  fireEvent.click(screen.getByRole('button', { name: /Continuer/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Réessayez');
  expect(complete).not.toHaveBeenCalled();
});

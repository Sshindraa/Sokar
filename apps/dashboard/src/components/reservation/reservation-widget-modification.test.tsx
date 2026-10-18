import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ReservationWidget from './reservation-widget';

afterEach(cleanup);
it('offers only real service slots and preserves explicit review before committing', async () => {
  const confirm = vi.fn().mockResolvedValue(undefined);
  const options = vi.fn().mockResolvedValue({
    slots: [
      { time: '12:00', proposalToken: 'lunch' },
      { time: '19:30', proposalToken: 'dinner' },
    ],
    maxPartySize: 6,
    message: 'Créneaux disponibles',
  });
  render(
    <ReservationWidget
      restaurantId="test"
      modification={{
        restaurantName: 'Restaurant de test',
        date: '2026-10-20',
        time: '19:30',
        partySize: 2,
        getOptions: options,
        confirm,
        onBusyChange: vi.fn(),
      }}
    />,
  );
  await screen.findByRole('button', { name: 'Déjeuner' });
  expect(screen.getByRole('button', { name: 'Choisir le créneau 19h30' })).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Choisir le créneau 12h00' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^3 personnes$/ }));
  const next = new Date();
  next.setDate(next.getDate() + 4);
  const day = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(next);
  fireEvent.click(screen.getByRole('button', { name: new RegExp(day, 'i') }));
  await waitFor(() => expect(options).toHaveBeenCalledTimes(3));
  fireEvent.click(await screen.findByRole('button', { name: 'Déjeuner' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Choisir le créneau 12h00' }));
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Continuer · 12h00' }));
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByText('Date', { selector: 'dt' })).toBeInTheDocument();
  expect(screen.getByText('Horaire', { selector: 'dt' })).toBeInTheDocument();
  expect(screen.getByText('Personnes', { selector: 'dt' })).toBeInTheDocument();
  expect(screen.getByText('Ambiance')).toBeInTheDocument();
  expect(screen.queryByText('Nouveau choix', { exact: true })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer la modification' }));
  await waitFor(() => expect(confirm).toHaveBeenCalledExactlyOnceWith('lunch'));
});

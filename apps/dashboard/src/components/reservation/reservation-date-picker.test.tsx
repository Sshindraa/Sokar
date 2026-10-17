import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReservationDatePicker } from './reservation-date-picker';

afterEach(cleanup);
const props = { value: '2026-10-20', min: '2026-10-18', max: '2027-01-15', theme: {} };

it('bounds month navigation and selects a future day without a native date field', async () => {
  const change = vi.fn();
  render(<ReservationDatePicker {...props} onChange={change} />);
  const trigger = screen.getByRole('button', { name: 'Choisir une date dans le calendrier' });
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('button', { name: 'Mois précédent' })).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: 'samedi 17 octobre 2026' })).toBeDisabled();
  expect(document.querySelector('input[type="date"]')).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Mois suivant' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Mois suivant' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'jeudi 17 décembre 2026' }));
  expect(change).toHaveBeenCalledExactlyOnceWith('2026-12-17');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('supports arrow keys and page-down across months without committing until selection', async () => {
  const change = vi.fn();
  render(<ReservationDatePicker {...props} onChange={change} />);
  fireEvent.click(screen.getByRole('button', { name: 'Choisir une date dans le calendrier' }));
  const dialog = await screen.findByRole('dialog');
  const selected = within(dialog).getByRole('button', { name: 'mardi 20 octobre 2026' });
  fireEvent.keyDown(selected, { key: 'ArrowRight' });
  const next = within(dialog).getByRole('button', { name: 'mercredi 21 octobre 2026' });
  await waitFor(() => expect(next).toHaveFocus());
  fireEvent.keyDown(next, { key: 'PageDown' });
  const november = await within(dialog).findByRole('button', { name: 'samedi 21 novembre 2026' });
  await waitFor(() => expect(november).toHaveFocus());
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(november);
  expect(change).toHaveBeenCalledExactlyOnceWith('2026-11-21');
});

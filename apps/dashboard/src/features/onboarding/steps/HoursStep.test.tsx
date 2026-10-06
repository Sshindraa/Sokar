import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { PlaceImportDraft } from '../onboarding-provider';
import { HoursStep } from './HoursStep';

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  updateTask: vi.fn(),
  state: {
    restaurant: { openingHours: {} },
    defaultHours: {
      tue: { open: '12:00', close: '22:00' },
      wed: { open: '12:00', close: '22:00' },
      thu: { open: '12:00', close: '22:00' },
      fri: { open: '12:00', close: '22:00' },
      sat: { open: '12:00', close: '22:00' },
    },
  },
  placeImportDraft: null as PlaceImportDraft | null,
}));

vi.mock('@/lib/api', () => ({ useApi: () => ({ patch: mocks.patch, orgId: 'restaurant-1' }) }));
vi.mock('../onboarding-provider', () => ({
  useOnboarding: () => ({
    state: mocks.state,
    updateTask: mocks.updateTask,
    placeImportDraft: mocks.placeImportDraft,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.patch.mockResolvedValue({});
  mocks.updateTask.mockResolvedValue({});
  mocks.placeImportDraft = null;
});

it('propose midi et soir par défaut, permet undo et enregistre les créneaux', async () => {
  const complete = vi.fn();
  render(<HoursStep onComplete={complete} />);

  expect(screen.getByRole('heading', { name: 'Horaires de réservation' })).toBeInTheDocument();
  expect(
    screen.getByText(
      'Choisissez les jours et les périodes où vous acceptez les réservations. Les clients pourront choisir une heure de réservation toutes les 30 minutes, par exemple 12 h, 12 h 30 ou 13 h.',
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      'Ces horaires concernent uniquement les réservations. Si le renvoi d’appel est activé, Sokar continue à prendre toutes les réservations en dehors de ces plages.',
    ),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Mardi, midi : ouverture')).toHaveValue('12:00');
  expect(screen.getByLabelText('Mardi, midi : fermeture')).toHaveValue('14:30');
  expect(screen.getByLabelText('Mardi, soir : ouverture')).toHaveValue('19:00');
  expect(screen.getByLabelText('Mardi, soir : fermeture')).toHaveValue('22:30');
  expect(screen.getAllByText('Midi', { exact: true })).toHaveLength(5);
  expect(screen.getAllByText('Soir', { exact: true })).toHaveLength(5);
  expect(screen.getAllByText('Fermé', { exact: true })).toHaveLength(2);

  const globalMode = screen.getByRole('radiogroup', {
    name: 'Rythme de service pour tous les jours ouverts',
  });
  fireEvent.click(within(globalMode).getByRole('radio', { name: 'Continu' }));
  expect(screen.getByLabelText('Mardi, service : ouverture')).toHaveValue('12:00');
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(screen.getByLabelText('Mardi, midi : ouverture')).toHaveValue('12:00');

  fireEvent.click(screen.getByRole('button', { name: 'Continuer vers Consignes & démo' }));
  await waitFor(() => {
    expect(mocks.patch).toHaveBeenCalledWith(
      'restaurants/restaurant-1',
      expect.objectContaining({
        openingHours: expect.objectContaining({
          tue: {
            open: '12:00',
            close: '22:30',
            slots: [
              { open: '12:00', close: '14:30' },
              { open: '19:00', close: '22:30' },
            ],
          },
          wed: expect.objectContaining({ slots: expect.any(Array) }),
        }),
      }),
    );
    expect(complete).toHaveBeenCalledWith('knowledge');
  });
});

it('permet de choisir le rythme de chaque jour avec des radios visibles', () => {
  render(<HoursStep onComplete={vi.fn()} />);
  const tuesdayRhythm = screen.getByRole('radiogroup', { name: 'Rythme du mardi' });
  const split = within(tuesdayRhythm).getByRole('radio', { name: 'Midi et soir' });
  const continuous = within(tuesdayRhythm).getByRole('radio', { name: 'Continu' });

  expect(split).toBeChecked();
  expect(continuous).not.toBeChecked();

  fireEvent.click(continuous);
  expect(continuous).toBeChecked();
  expect(screen.getByLabelText('Mardi, service : ouverture')).toHaveValue('12:00');

  fireEvent.click(split);
  expect(split).toBeChecked();
  expect(screen.getByLabelText('Mardi, midi : ouverture')).toHaveValue('12:00');
  expect(screen.queryByRole('button', { name: /copier/i })).not.toBeInTheDocument();
});

it('ouvre le lundi sans soumettre le formulaire ni avancer à la prochaine étape', () => {
  const complete = vi.fn();
  render(<HoursStep onComplete={complete} />);

  const mondaySwitch = screen.getByRole('switch', { name: /Lundi/ });
  expect(mondaySwitch).toHaveAttribute('aria-checked', 'false');

  fireEvent.click(mondaySwitch);

  expect(mondaySwitch).toHaveAttribute('aria-checked', 'true');
  expect(mocks.patch).not.toHaveBeenCalled();
  expect(mocks.updateTask).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
});

it('signale les services qui se chevauchent sur le jour concerné', () => {
  render(<HoursStep onComplete={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Mardi, midi : fermeture'), {
    target: { value: '15:00' },
  });
  fireEvent.change(screen.getByLabelText('Mardi, soir : ouverture'), {
    target: { value: '14:00' },
  });

  expect(screen.getByRole('alert')).toHaveTextContent('se chevauchent');
  expect(screen.getByRole('button', { name: 'Continuer vers Consignes & démo' })).toBeDisabled();
});

it('accepte une fermeture après minuit et la signale comme le lendemain', () => {
  render(<HoursStep onComplete={vi.fn()} />);
  const tuesdayRhythm = screen.getByRole('radiogroup', { name: 'Rythme du mardi' });
  fireEvent.click(within(tuesdayRhythm).getByRole('radio', { name: 'Continu' }));
  fireEvent.change(screen.getByLabelText('Mardi, service : ouverture'), {
    target: { value: '22:00' },
  });
  fireEvent.change(screen.getByLabelText('Mardi, service : fermeture'), {
    target: { value: '00:30' },
  });

  expect(screen.getByText('lendemain')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('propose les horaires Google comme point de départ et signale les jours à saisir', () => {
  mocks.placeImportDraft = {
    placeId: 'ChIJrestaurant123',
    name: 'Chez Sokar',
    phoneE164: '+33123456789',
    formattedAddress: '12 rue de la République',
    postalCode: '69002',
    city: 'Lyon',
    country: 'FR',
    openingHours: { mon: { open: '11:30', close: '14:00' } },
    hoursNeedReview: ['tue'],
  };

  render(<HoursStep onComplete={vi.fn()} />);

  expect(screen.getByRole('switch', { name: /Lundi/ })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByLabelText('Lundi, service : ouverture')).toHaveValue('11:30');
  expect(screen.getByRole('switch', { name: /Mardi/ })).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByText('Google Maps')).toBeInTheDocument();
  expect(screen.getByText(/À vérifier ou saisir manuellement : Mardi/)).toBeInTheDocument();
  expect(
    screen.getByText(/ne définissent pas forcément vos créneaux de réservation/),
  ).toBeInTheDocument();
});

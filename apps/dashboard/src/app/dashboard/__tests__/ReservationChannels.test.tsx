import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReservationChannels, { demoReservationChannels } from '../ReservationChannels';

describe('ReservationChannels', () => {
  it('affiche chaque canal avec sa part', () => {
    render(
      <ReservationChannels
        stats={[
          { channel: 'phone', reservations: 6, covers: 14 },
          { channel: 'website', reservations: 2, covers: 5 },
          { channel: 'google', reservations: 1, covers: 2 },
          { channel: 'ai', reservations: 0, covers: 0 },
          { channel: 'team', reservations: 1, covers: 4 },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Réservations par canal' })).toBeInTheDocument();
    expect(screen.getByText('Assistants IA')).toHaveAccessibleDescription(
      'ChatGPT, Perplexity et autres agents de réservation.',
    );
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Téléphone 60 %, Site et réseaux 20 %, Google 10 %, Équipe 10 %',
    );
    expect(screen.getByText(/Aucune pour l’instant/)).toBeInTheDocument();
  });

  it('propose d’ajouter le lien de réservation quand tout passe par le téléphone', () => {
    render(<ReservationChannels stats={[{ channel: 'phone', reservations: 3, covers: 7 }]} />);
    expect(screen.getByText(/Ajoutez votre lien de réservation/)).toBeInTheDocument();
  });

  it('montre un état vide sans réservation', () => {
    render(<ReservationChannels stats={[]} />);
    expect(screen.getByText(/Aucune réservation confirmée sur cette période/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('la répartition de démo retombe exactement sur les totaux', () => {
    const demo = demoReservationChannels(89, 236);
    expect(demo.reduce((sum, row) => sum + row.reservations, 0)).toBe(89);
    expect(demo.reduce((sum, row) => sum + row.covers, 0)).toBe(236);
    expect(demo.every((row) => row.reservations >= 0 && row.covers >= 0)).toBe(true);
  });
});

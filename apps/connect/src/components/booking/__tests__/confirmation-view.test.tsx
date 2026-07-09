/**
 * Tests unitaires pour le composant ConfirmationView.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfirmationView } from '@/components/booking/confirmation-view';
import type { ConfirmDto } from '@/components/booking/confirmation-view';

const result: ConfirmDto = {
  reservationId: 'RES-12345',
  restaurantName: 'Chez Sokar',
  date: '15 juillet 2024',
  time: '19:30',
  partySize: 4,
};

describe('ConfirmationView', () => {
  it('renders with role="status" and aria-live="polite"', () => {
    const { container } = render(<ConfirmationView result={result} slug="chez-sokar" />);
    const statusEl = container.querySelector('[role="status"]');
    expect(statusEl).not.toBeNull();
    expect(statusEl).toHaveAttribute('aria-live', 'polite');
  });

  it('displays the "Réservation confirmée" heading', () => {
    render(<ConfirmationView result={result} slug="chez-sokar" />);
    expect(screen.getByRole('heading', { name: /réservation confirmée/i })).toBeInTheDocument();
  });

  it('displays the restaurant name', () => {
    render(<ConfirmationView result={result} slug="chez-sokar" />);
    expect(screen.getByText('Chez Sokar')).toBeInTheDocument();
  });

  it('displays the date and time', () => {
    render(<ConfirmationView result={result} slug="chez-sokar" />);
    expect(screen.getByText('15 juillet 2024')).toBeInTheDocument();
    expect(screen.getByText('19:30')).toBeInTheDocument();
  });

  it('displays the party size with pluralization', () => {
    render(<ConfirmationView result={result} slug="chez-sokar" />);
    expect(screen.getByText(/4 personnes/)).toBeInTheDocument();
  });

  it('displays the reservation ID', () => {
    render(<ConfirmationView result={result} slug="chez-sokar" />);
    expect(screen.getByText('RES-12345')).toBeInTheDocument();
  });

  it('displays the SMS confirmation message', () => {
    render(<ConfirmationView result={result} slug="chez-sokar" />);
    expect(screen.getByText(/SMS de confirmation/i)).toBeInTheDocument();
  });

  it('shows a back link when not embedded', () => {
    render(<ConfirmationView result={result} slug="chez-sokar" />);
    const link = screen.getByRole('link', { name: /retour à la fiche/i });
    expect(link).toHaveAttribute('href', '/restaurant/chez-sokar');
  });

  it('does not show the back link when embedded', () => {
    render(<ConfirmationView result={result} slug="chez-sokar" embedded />);
    expect(screen.queryByRole('link', { name: /retour à la fiche/i })).not.toBeInTheDocument();
  });

  it('uses singular "personne" when partySize is 1', () => {
    render(<ConfirmationView result={{ ...result, partySize: 1 }} slug="chez-sokar" />);
    expect(screen.getByText(/1 personne/)).toBeInTheDocument();
    expect(screen.queryByText(/1 personnes/)).not.toBeInTheDocument();
  });
});

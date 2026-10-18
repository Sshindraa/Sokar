/**
 * Tests unitaires pour le composant ConfirmationView.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  afterEach(() => vi.unstubAllGlobals());
  it('uses the canonical personal link instead of a second inline withdrawal control', () => {
    const managementUrl = 'https://sokar.tech/r#fixture';
    render(
      <ConfirmationView
        result={{
          ...result,
          managementUrl,
          whatsappWithdrawalToken: ['test', 'receipt'].join('-'),
        }}
        slug="chez-sokar"
      />,
    );
    const link = screen.getByRole('link', { name: /gérer ma réservation/i });
    expect(link).toHaveAttribute('href', managementUrl);
    expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.queryByRole('button', { name: /retirer mon accord/i })).not.toBeInTheDocument();
  });
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

  it('does not promise delivery before it is known', () => {
    render(<ConfirmationView result={result} slug="chez-sokar" />);
    expect(screen.queryByText(/vous a été envoyé/i)).not.toBeInTheDocument();
  });

  it('withdraws WhatsApp agreement only after server acknowledgement', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', request);
    render(
      <ConfirmationView
        result={{ ...result, whatsappWithdrawalToken: ['test', 'receipt'].join('-') }}
        slug="chez-sokar"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /retirer mon accord/i }));
    await waitFor(() => expect(screen.getByText(/a été retiré/i)).toBeInTheDocument());
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining('/whatsapp-consent/withdraw'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does not announce withdrawal after network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    render(
      <ConfirmationView
        result={{ ...result, whatsappWithdrawalToken: ['test', 'receipt'].join('-') }}
        slug="chez-sokar"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /retirer mon accord/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText(/a été retiré/i)).not.toBeInTheDocument();
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

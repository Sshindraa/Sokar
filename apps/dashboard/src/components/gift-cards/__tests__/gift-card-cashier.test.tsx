import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GiftCardCashier } from '../gift-card-cashier';
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ useApi: () => ({ ...mocks, orgId: 'restaurant' }) }));
const detail = {
  card: {
    remainingAmount: 100,
    status: 'ACTIVE',
    currency: 'EUR',
    shortCode: 'SKR-TEST-01',
    expiresAt: null,
    type: 'SINGLE',
    closedAt: null,
    stripePaymentStatus: null,
  },
  redemptions: [],
};
describe('gift card cashier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue(detail);
  });
  it('confirms a real bill and retries the exact same debit after a network failure', async () => {
    const changed = vi.fn();
    mocks.post.mockRejectedValueOnce(new Error('Connexion interrompue')).mockResolvedValueOnce({
      id: 'receipt',
      billAmount: 150,
      appliedAmount: 100,
      remainingAmount: 0,
      complementAmount: 50,
      ticketReference: 'T42',
      redeemedAt: new Date().toISOString(),
    });
    render(<GiftCardCashier giftCardId="card" onChanged={changed} />);
    fireEvent.change(await screen.findByLabelText('Montant réel de l’addition (€)'), {
      target: { value: '150' },
    });
    fireEvent.change(screen.getByLabelText('Référence du ticket'), { target: { value: 'T42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier le débit' }));
    expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le débit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connexion interrompue');
    expect(screen.getByLabelText('Montant réel de l’addition (€)')).toBeDisabled();
    const firstBody = mocks.post.mock.calls[0][1];
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer la même demande' }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(mocks.post.mock.calls[1][1]).toEqual(firstBody);
    expect(firstBody).toMatchObject({ billAmount: 150, ticketReference: 'T42' });
    expect(screen.getByRole('status')).toHaveTextContent('Complément à encaisser');
    expect(screen.getByText('Historique des débits')).toBeInTheDocument();
  });
  it('allows correction after a definitive rejection while preserving the error', async () => {
    mocks.post.mockRejectedValue(
      Object.assign(new Error('Réservation introuvable.'), { status: 404 }),
    );
    render(<GiftCardCashier giftCardId="card" onChanged={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Montant réel de l’addition (€)'), {
      target: { value: '20' },
    });
    fireEvent.change(screen.getByLabelText('Référence du ticket'), { target: { value: 'T43' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier le débit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le débit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Réservation introuvable.');
    expect(screen.getByLabelText('Référence du ticket')).not.toBeDisabled();
  });

  it('does not offer a debit for a frozen card', async () => {
    mocks.get.mockResolvedValue({ ...detail, card: { ...detail.card, status: 'PAYMENT_REVIEW' } });
    render(<GiftCardCashier giftCardId="card" onChanged={vi.fn()} />);
    expect(
      await screen.findByText('Cette carte ne peut pas être débitée dans son état actuel.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vérifier le débit' })).not.toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GiftCardDeliveryHistory } from '../gift-card-delivery-history';
const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api', () => ({ useApi: () => ({ post: mocks.post, orgId: 'restaurant' }) }));
const unknown = {
  id: 'delivery',
  kind: 'recipient_email',
  channel: 'email',
  status: 'UNKNOWN',
  attempts: 1,
  sentAt: null,
  createdAt: '2026-09-30T12:00:00Z',
};
describe('gift card delivery operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('does not offer a blind retry for an uncertain delivery or staff management controls', () => {
    render(
      <GiftCardDeliveryHistory
        giftCardId="card"
        deliveries={[unknown]}
        canManage={false}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText(/Résultat incertain/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('requires a provider reference and explicit verification before a manual resolution', async () => {
    mocks.post.mockResolvedValue({ status: 'SENT' });
    render(
      <GiftCardDeliveryHistory
        giftCardId="card"
        deliveries={[unknown]}
        canManage
        onChanged={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Réessayer cet envoi' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Résoudre après vérification manuelle' }));
    const confirm = screen.getByRole('button', { name: 'Confirmer l’acceptation' });
    expect(confirm).toBeDisabled();
    fireEvent.change(
      screen.getByLabelText('Référence du dossier fournisseur (sans coordonnées personnelles)'),
      { target: { value: 'case-42' } },
    );
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        'restaurants/restaurant/gift-cards/card/operations/deliveries/delivery/resolve',
        { resolution: 'accepted', providerCaseReference: 'case-42' },
      ),
    );
  });
  it('preserves the same resend request after a lost response', async () => {
    const changed = vi.fn();
    mocks.post
      .mockRejectedValueOnce(new Error('Connexion perdue'))
      .mockResolvedValueOnce({ status: 'PENDING' });
    render(
      <GiftCardDeliveryHistory giftCardId="card" deliveries={[]} canManage onChanged={changed} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Renvoyer au destinataire par email' }));
    expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le renvoi' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connexion perdue');
    const first = mocks.post.mock.calls[0][1];
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer la même demande de renvoi' }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(mocks.post.mock.calls[1][1]).toEqual(first);
  });
});

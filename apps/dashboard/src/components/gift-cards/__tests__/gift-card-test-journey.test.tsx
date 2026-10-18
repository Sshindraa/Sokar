import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GiftCardTestJourney } from '../gift-card-test-journey';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ useApi: () => ({ get: mocks.get, orgId: 'demo' }) }));
const context = {
  enabled: true,
  purchaseUrl: 'http://localhost:4002/widget/demo/gift-card',
  beneficiaryBaseUrl: 'http://localhost:4002/gift-card/',
  giftCardEnabled: true,
  emailConfigured: false,
  smsConfigured: false,
};
function setup(ready: boolean, giftCardEnabled = true) {
  mocks.get.mockImplementation((url: string) =>
    Promise.resolve(
      url.endsWith('test-context')
        ? { ...context, giftCardEnabled }
        : { chargesEnabled: ready, payoutsEnabled: ready },
    ),
  );
  render(<GiftCardTestJourney />);
}
async function openJourney() {
  const summary = await screen.findByText('Mode test · Ouvrir le parcours de vérification');
  expect(summary.closest('details')).not.toHaveAttribute('open');
  fireEvent.click(summary);
}
describe('local test journey', () => {
  beforeEach(() => vi.clearAllMocks());
  it('keeps Stripe as the current action and blocks purchase until ready', async () => {
    setup(false);
    await openJourney();
    expect(await screen.findByRole('link', { name: 'Voir le statut Stripe' })).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Ouvrir le parcours d’achat' }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('Bloqué')).toHaveLength(4);
  });
  it('advances only after explicit checks and keeps completed steps compact', async () => {
    setup(true);
    await openJourney();
    const purchase = await screen.findByRole('link', { name: 'Ouvrir le parcours d’achat' });
    expect(purchase).toHaveAttribute('href', context.purchaseUrl);
    expect(screen.getAllByText('Terminé')).toHaveLength(1);
    expect(screen.queryByLabelText('Code de la carte de test')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Achat confirmé et code reçu' }));
    expect(
      screen.queryByRole('link', { name: 'Ouvrir le parcours d’achat' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Solde de 100 € vérifié' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Code de la carte de test'), {
      target: { value: 'SKR TEST/01' },
    });
    expect(screen.getByRole('link', { name: 'Voir le solde' })).toHaveAttribute(
      'href',
      'http://localhost:4002/gift-card/SKR%20TEST%2F01',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Solde de 100 € vérifié' }));
    expect(screen.getByText(/Solde attendu : 100 € − 40 € = 60 €/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Débit de 40 € et solde de 60 € vérifiés' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remboursement confirmé' }));
    expect(screen.getAllByText('Terminé')).toHaveLength(5);
    expect(screen.getByRole('status')).toHaveTextContent('Parcours validé par vos contrôles');
    expect(screen.getAllByText('Non configuré')).toHaveLength(2);
  });
  it('explains disabled sales even when Stripe is ready', async () => {
    setup(true, false);
    await openJourney();
    await waitFor(() => expect(screen.getByText('Terminé')).toBeInTheDocument());
    expect(
      screen.getByText('Activez la vente dans les réglages de l’établissement.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Ouvrir le parcours d’achat' }),
    ).not.toBeInTheDocument();
  });
  it('does not expose the local tools outside the guarded environment', async () => {
    mocks.get.mockResolvedValue({ enabled: false });
    const { container } = render(<GiftCardTestJourney />);
    await vi.waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BillingPage, stripeDocumentUrl } from './billing-page';
import type { BillingDetails, BillingStatus } from '@/types/api';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  orgId: 'org_1',
  role: 'OWNER',
  siteId: 'site_1',
  refresh: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ useApi: () => mocks }));
vi.mock('@/features/sites/site-context', () => ({
  useSiteSelection: () => ({
    accountId: 'account_1',
    status: 'ready',
    activeSite: { role: mocks.role },
    activeSiteId: mocks.siteId,
  }),
}));
vi.mock('./trial', () => ({
  useBillingStatus: () => ({ refresh: mocks.refresh }),
  TrialTrack: () => <p>Calendrier de votre essai</p>,
  TrialRecap: () => <p>Bilan de votre essai</p>,
}));

let status: BillingStatus;
let details: BillingDetails;
let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.orgId = 'org_1';
  mocks.role = 'OWNER';
  status = {
    plan: 'essential',
    subscriptionStatus: 'active',
    billingInterval: 'monthly',
    currentPeriodEnd: '2026-11-21T00:00:00Z',
    cancelAtPeriodEnd: false,
    entitledSiteCount: 1,
    accountScoped: true,
  };
  details = {
    hasCustomer: true,
    hasPaymentMethod: true,
    subscription: {
      status: 'active',
      canUpdatePlan: true,
      plan: 'essential',
      recurringAmount: 19900,
      currency: 'eur',
      interval: 'month',
      intervalCount: 1,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: status.currentPeriodEnd,
    },
    paymentMethod: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
    invoices: [
      {
        number: 'INV-001',
        createdAt: '2026-10-21T12:00:00Z',
        status: 'paid',
        total: 19900,
        currency: 'eur',
        pdfUrl: 'https://pay.stripe.com/invoice/test/pdf',
        hostedUrl: null,
      },
    ],
    hasMoreInvoices: false,
  };
  mocks.get.mockImplementation(async (path: string) =>
    path === 'billing/status' ? status : details,
  );
  mocks.post.mockResolvedValue({ url: 'https://billing.stripe.com/p/test' });
  window.history.replaceState({}, '', '/dashboard/billing');
  assign = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

function stubNavigation() {
  vi.stubGlobal('window', {
    ...window,
    document: window.document,
    location: { assign, search: '', pathname: '/dashboard/billing' },
    history: { replaceState: vi.fn() },
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
  });
}

describe('Mon abonnement', () => {
  it('shows real billing amount, masked card and downloadable invoice inside Sokar', async () => {
    render(<BillingPage />);
    expect(await screen.findByRole('heading', { name: 'Mon abonnement' })).toBeInTheDocument();
    expect(screen.getByText('visa ···· 4242')).toBeInTheDocument();
    expect(screen.getByText('Payée')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Télécharger la facture INV-001' })).toHaveAttribute(
      'href',
      details.invoices[0].pdfUrl,
    );
    expect(screen.getByText(/Tarif récurrent avant remises/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuel · −10 %' })).toBeInTheDocument();
  });
  it('renders the account summary while Stripe is still loading', async () => {
    mocks.get.mockImplementation((path: string) =>
      path === 'billing/status' ? Promise.resolve(status) : new Promise(() => {}),
    );
    render(<BillingPage />);
    expect(await screen.findByRole('heading', { name: 'Mon abonnement' })).toBeInTheDocument();
    expect(screen.getByText('Abonnement actif')).toBeInTheDocument();
    expect(screen.queryByText('Aucun moyen de paiement enregistré.')).not.toBeInTheDocument();
    expect(screen.queryByText(/Vos factures apparaîtront/)).not.toBeInTheDocument();
  });
  it('does not offer an unsupported plan change for a multi-item subscription', async () => {
    details.subscription!.canUpdatePlan = false;
    render(<BillingPage />);
    await screen.findByRole('heading', { name: 'Mon abonnement' });
    expect(screen.queryByRole('button', { name: 'Modifier la formule' })).not.toBeInTheDocument();
    expect(screen.getByText(/modification de cette formule nécessite/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Gérer dans Stripe/ })).toHaveLength(3);
  });
  it('does not request or display private billing for a manager', async () => {
    mocks.role = 'MANAGER';
    render(<BillingPage />);
    await screen.findByRole('heading', { name: 'Mon abonnement' });
    expect(mocks.get).not.toHaveBeenCalledWith('billing/details', expect.anything());
    expect(screen.queryByText('4242', { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gérer l’abonnement' })).not.toBeInTheDocument();
  });
  it('offers a retry for a Stripe outage and does not invent an empty invoice list', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === 'billing/details') throw new Error('Stripe offline');
      return status;
    });
    render(<BillingPage />);
    await screen.findByRole('heading', { name: 'Mon abonnement' });
    expect(
      screen.getAllByText(/informations Stripe sont momentanément indisponibles/),
    ).toHaveLength(2);
    expect(screen.queryByText(/Vos factures apparaîtront/)).not.toBeInTheDocument();
    mocks.get.mockImplementation(async (path: string) =>
      path === 'billing/status' ? status : details,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Réessayer' })[0]);
    expect(await screen.findByText('INV-001')).toBeInTheDocument();
  });
  it('opens the payment method flow with no client-supplied customer ID', async () => {
    stubNavigation();
    render(<BillingPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mettre à jour' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://billing.stripe.com/p/test'));
    expect(mocks.post).toHaveBeenCalledWith('billing/portal-session', {
      intent: 'payment_method',
      returnTo: 'billing',
    });
  });
  it('opens cancellation confirmation without canceling directly', async () => {
    stubNavigation();
    render(<BillingPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Gérer la résiliation/ }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('billing/portal-session', {
        intent: 'subscription_cancel',
        returnTo: 'billing',
      }),
    );
  });
  it('shows a trial, its actual end date, and the missing payment method', async () => {
    status.subscriptionStatus = 'trialing';
    status.trial = { startedAt: '2026-10-21', endsAt: '2026-11-04', totalDays: 14, daysLeft: 14 };
    details.subscription!.status = 'trialing';
    details.subscription!.currentPeriodEnd = '2026-11-04';
    details.hasPaymentMethod = false;
    details.paymentMethod = null;
    details.invoices = [];
    render(<BillingPage />);
    expect(await screen.findByText('Essai gratuit')).toBeInTheDocument();
    expect(screen.getByText('4 novembre 2026')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Ajouter un moyen de paiement/ }),
    ).toBeInTheDocument();
  });
  it('does not trust a forged success query parameter as a paid subscription', async () => {
    window.history.replaceState({}, '', '/dashboard/billing?billing=success');
    status.subscriptionStatus = 'canceled';
    details.subscription!.status = 'canceled';
    render(<BillingPage />);
    expect(await screen.findByText('Abonnement terminé')).toBeInTheDocument();
    expect(screen.queryByText('Abonnement actif')).not.toBeInTheDocument();
  });
  it('clears invoice data when the account changes and ignores the previous pending response', async () => {
    const view = render(<BillingPage />);
    await screen.findByText('INV-001');
    mocks.orgId = 'org_2';
    let resolveDetails!: (value: BillingDetails) => void;
    mocks.get.mockImplementation((path: string) =>
      path === 'billing/status'
        ? Promise.resolve(status)
        : new Promise((resolve) => {
            resolveDetails = resolve;
          }),
    );
    view.rerender(<BillingPage />);
    expect(screen.queryByText('INV-001')).not.toBeInTheDocument();
    resolveDetails({ ...details, invoices: [] });
    await screen.findByText(/Vos factures apparaîtront/);
  });
  it('starts checkout for the chosen offer and annual cadence without creating a second trial', async () => {
    status.subscriptionStatus = 'canceled';
    details.subscription!.status = 'canceled';
    mocks.post.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/test' });
    stubNavigation();
    render(<BillingPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Annuel/ }));
    fireEvent.click(screen.getByRole('button', { name: /Choisir Pro/ }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('billing/checkout-session', {
        plan: 'pro',
        billing: 'annual',
        returnTo: 'billing',
      }),
    );
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/test');
  });
  it('handles action errors and permits a retry', async () => {
    mocks.post.mockRejectedValueOnce(new Error('failed'));
    render(<BillingPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mettre à jour' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible d’ouvrir Stripe');
    expect(screen.getByRole('button', { name: 'Mettre à jour' })).toBeEnabled();
  });
});

describe('invoice documents', () => {
  it.each([
    'javascript:alert(1)',
    'https://evil.example/file',
    'https://pay.stripe.com.evil.example/pdf',
    'http://pay.stripe.com/pdf',
  ])('rejects %s', (url) => expect(stripeDocumentUrl(url)).toBeUndefined());
});

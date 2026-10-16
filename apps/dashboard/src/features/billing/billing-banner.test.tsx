import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ get: apiMocks.get, isSignedIn: true }),
}));

import { BillingBanner, trialDaysLeft } from './billing-banner';

const DAY_MS = 24 * 60 * 60 * 1000;

function status(overrides: Record<string, unknown>) {
  return {
    plan: 'essential',
    subscriptionStatus: 'active',
    billingInterval: 'monthly',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    entitledSiteCount: 1,
    accountScoped: false,
    suspended: false,
    ...overrides,
  };
}

describe('trialDaysLeft', () => {
  it('compte les jours restants arrondis au jour supérieur', () => {
    const now = Date.parse('2026-10-16T10:00:00.000Z');
    expect(trialDaysLeft(new Date(now + 2.5 * DAY_MS).toISOString(), now)).toBe(3);
    expect(trialDaysLeft(new Date(now - DAY_MS).toISOString(), now)).toBe(0);
    expect(trialDaysLeft(null, now)).toBeNull();
  });
});

describe('BillingBanner', () => {
  beforeEach(() => {
    apiMocks.get.mockReset();
  });

  it('signale un service suspendu et propose de choisir une formule', async () => {
    apiMocks.get.mockResolvedValue(status({ subscriptionStatus: 'canceled', suspended: true }));
    render(<BillingBanner />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'l’assistant téléphonique ne répond plus aux appels',
    );
    expect(screen.getByRole('link', { name: 'Choisir une formule' })).toHaveAttribute(
      'href',
      '/pricing',
    );
  });

  it('rappelle la fin de l’essai dans les derniers jours', async () => {
    apiMocks.get.mockResolvedValue(
      status({
        subscriptionStatus: 'trialing',
        currentPeriodEnd: new Date(Date.now() + 2.5 * DAY_MS).toISOString(),
      }),
    );
    render(<BillingBanner />);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Votre essai gratuit se termine dans 3 jours',
    );
  });

  it('reste discret en début d’essai, pour un abonnement actif ou en cas d’erreur', async () => {
    apiMocks.get.mockResolvedValueOnce(
      status({
        subscriptionStatus: 'trialing',
        currentPeriodEnd: new Date(Date.now() + 10 * DAY_MS).toISOString(),
      }),
    );
    const { container, unmount } = render(<BillingBanner />);
    await waitFor(() => expect(apiMocks.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    unmount();

    apiMocks.get.mockRejectedValueOnce(new Error('indisponible'));
    const second = render(<BillingBanner />);
    await waitFor(() => expect(apiMocks.get).toHaveBeenCalledTimes(2));
    expect(second.container).toBeEmptyDOMElement();
  });
});

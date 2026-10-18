import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingStatus } from '@/types/api';

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({
  useApi: () => ({ get: apiMocks.get, post: apiMocks.post, isSignedIn: true }),
}));

import {
  BillingNotice,
  BillingStatusProvider,
  TrialChip,
  TrialStartTimeline,
  trialHeadline,
} from './trial';

const DAY = 24 * 60 * 60 * 1000;

function trialing(daysLeft: number, calls = 47): BillingStatus {
  const endsAt = new Date(Date.now() + daysLeft * DAY - 60_000);
  return {
    plan: 'essential',
    subscriptionStatus: 'trialing',
    billingInterval: 'monthly',
    currentPeriodEnd: endsAt.toISOString(),
    cancelAtPeriodEnd: false,
    entitledSiteCount: 1,
    accountScoped: false,
    suspended: false,
    trial: {
      startedAt: new Date(endsAt.getTime() - 14 * DAY).toISOString(),
      endsAt: endsAt.toISOString(),
      totalDays: 14,
      daysLeft,
      recap: { calls, reservations: calls ? 18 : 0, covers: calls ? 52 : 0, phoneReservations: 15 },
    },
  };
}

function withStatus(status: BillingStatus, ui: React.ReactNode) {
  return render(<BillingStatusProvider initialStatus={status}>{ui}</BillingStatusProvider>);
}

describe('trialHeadline', () => {
  it('accorde les jours restants', () => {
    expect(trialHeadline(9)).toBe('Plus que 9 jours d’essai');
    expect(trialHeadline(1)).toBe('Plus qu’un jour d’essai');
    expect(trialHeadline(0)).toBe('Dernier jour d’essai');
  });
});

describe('TrialChip', () => {
  beforeEach(() => {
    apiMocks.get.mockReset();
    apiMocks.post.mockReset();
  });

  it('affiche les jours restants et ouvre le bilan de l’essai', () => {
    withStatus(trialing(9), <TrialChip canManageBilling />);
    fireEvent.click(screen.getByRole('button', { name: /Plus que 9 jours d’essai/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Plus que 9 jours d’essai');
    expect(screen.getByText('47')).toBeInTheDocument();
    expect(screen.getByText('Appels décrochés')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ajouter une carte/ })).toBeEnabled();
  });

  it('ouvre le portail Stripe pour ajouter la carte', async () => {
    apiMocks.post.mockResolvedValue({ url: 'https://billing.stripe.test/portal' });
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { assign }, writable: true });
    withStatus(trialing(9), <TrialChip canManageBilling />);
    fireEvent.click(screen.getByRole('button', { name: /Plus que 9 jours/ }));
    fireEvent.click(screen.getByRole('button', { name: /Ajouter une carte/ }));
    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://billing.stripe.test/portal'),
    );
    expect(apiMocks.post).toHaveBeenCalledWith('billing/portal-session');
  });

  it('signale un renvoi de ligne probablement absent sans appel reçu', () => {
    withStatus(trialing(5, 0), <TrialChip canManageBilling />);
    fireEvent.click(screen.getByRole('button', { name: /Plus que 5 jours/ }));
    expect(screen.getByText('Aucun appel reçu pour l’instant')).toBeInTheDocument();
  });

  it('n’apparaît pas hors période d’essai', () => {
    const { container } = withStatus(
      { ...trialing(9), subscriptionStatus: 'active', trial: undefined },
      <TrialChip canManageBilling />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('laisse le propriétaire ajouter la carte quand on n’a pas les droits', () => {
    withStatus(trialing(9), <TrialChip canManageBilling={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Plus que 9 jours/ }));
    expect(screen.queryByRole('button', { name: /Ajouter une carte/ })).not.toBeInTheDocument();
    expect(
      screen.getByText(/Le propriétaire du compte peut ajouter une carte/),
    ).toBeInTheDocument();
  });
});

describe('BillingNotice', () => {
  it('reste discret en début d’essai', () => {
    const { container } = withStatus(trialing(9), <BillingNotice canManageBilling />);
    expect(container).toBeEmptyDOMElement();
  });

  it('rappelle d’ajouter une carte les derniers jours', () => {
    withStatus(trialing(2), <BillingNotice canManageBilling />);
    expect(screen.getByRole('status')).toHaveTextContent('Plus que 2 jours d’essai');
    expect(screen.getByRole('button', { name: /Ajouter une carte/ })).toBeInTheDocument();
  });

  it('signale un service suspendu avec la réactivation', () => {
    withStatus(
      { ...trialing(0), subscriptionStatus: 'canceled', suspended: true, trial: undefined },
      <BillingNotice canManageBilling />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Votre assistant ne répond plus');
    expect(screen.getByRole('link', { name: /Réactiver mon assistant/ })).toHaveAttribute(
      'href',
      '/pricing',
    );
  });
});

describe('TrialStartTimeline', () => {
  it('date le rappel et le premier prélèvement', () => {
    render(<TrialStartTimeline totalDays={14} now={new Date('2026-10-16T10:00:00Z')} />);
    expect(screen.getByText('Aujourd’hui')).toBeInTheDocument();
    expect(screen.getByText('27 octobre')).toBeInTheDocument();
    expect(screen.getByText('30 octobre')).toBeInTheDocument();
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubscribeFromPricing } from './SubscribeFromPricing';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  search: 'subscribe_plan=pro&billing=annual',
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ orgId: 'org_test', post: mocks.post }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

describe('SubscribeFromPricing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = 'subscribe_plan=pro&billing=annual';
  });

  it('ouvre le endpoint de checkout avec la formule sélectionnée', async () => {
    mocks.post.mockRejectedValueOnce(
      new Error('La souscription en ligne sera bientôt disponible.'),
    );
    render(<SubscribeFromPricing />);

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith('billing/checkout-session', {
        plan: 'pro',
        billing: 'annual',
      });
    });
    expect(
      await screen.findByText('La souscription en ligne sera bientôt disponible.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Réessayer/i })).toBeInTheDocument();
  });

  it('ne déclenche rien sans sélection de formule', () => {
    mocks.search = '';
    render(<SubscribeFromPricing />);

    expect(mocks.post).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

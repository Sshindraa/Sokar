import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GiftCardTestBanner } from '../gift-card-test-banner';
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
describe('gift-card payment mode', () => {
  it('clearly labels test payments', () => {
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', ['pk', 'test', 'fixture'].join('_'));
    render(<GiftCardTestBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('aucun débit bancaire réel');
  });
  it('does not label live or unknown payments as test', () => {
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', ['pk', 'live', 'fixture'].join('_'));
    const { container } = render(<GiftCardTestBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});

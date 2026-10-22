import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MARKETING_CONSENT_VERSION } from '@sokar/shared';
import { MarketingConsentFields } from '../marketing-consent-fields';

const none = { EMAIL: false, SMS: false };

describe('MarketingConsentFields', () => {
  it('renders nothing until a contact detail is entered', () => {
    const { container } = render(
      <MarketingConsentFields
        restaurantName="Chez Sokar"
        email=""
        phone=""
        choice={none}
        onChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('offers one unchecked box per channel with the shared wording', () => {
    render(
      <MarketingConsentFields
        restaurantName="Chez Sokar"
        email="client@example.com"
        phone="+33612345678"
        choice={none}
        onChange={vi.fn()}
      />,
    );
    const email = screen.getByRole('checkbox', {
      name: 'Je souhaite recevoir par e-mail les offres et actualités de Chez Sokar. Je peux me désinscrire à tout moment.',
    });
    const sms = screen.getByRole('checkbox', {
      name: /par SMS les offres et actualités de Chez Sokar/,
    });
    expect(email).not.toBeChecked();
    expect(sms).not.toBeChecked();
    expect(screen.getByText(/vous pouvez réserver sans cocher/i)).toBeInTheDocument();
  });

  it('hides the e-mail box while the address is not usable', () => {
    render(
      <MarketingConsentFields
        restaurantName="Chez Sokar"
        email="client@"
        phone="+33612345678"
        choice={none}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('checkbox', { name: /par e-mail/ })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /par SMS/ })).toBeInTheDocument();
  });

  it('reports the tick of a channel and can be disabled while submitting', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MarketingConsentFields
        restaurantName="Chez Sokar"
        email="client@example.com"
        phone=""
        choice={none}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /par e-mail/ }));
    expect(onChange).toHaveBeenCalledWith('EMAIL', true);

    rerender(
      <MarketingConsentFields
        restaurantName="Chez Sokar"
        email="client@example.com"
        phone=""
        choice={none}
        onChange={onChange}
        disabled
      />,
    );
    expect(screen.getByRole('checkbox', { name: /par e-mail/ })).toBeDisabled();
    expect(MARKETING_CONSENT_VERSION).toMatch(/^marketing-consent-/);
  });
});

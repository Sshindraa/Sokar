import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PRIVACY_DOCUMENT, PRIVACY_PROVIDERS, PRIVACY_RETENTION_RULES } from '@sokar/shared';
import PrivacyPage from './page';

describe('Connect privacy disclosure', () => {
  it('renders the same suppliers and retention rules and keeps section links valid', () => {
    const { container } = render(<PrivacyPage />);
    const article = within(screen.getByRole('article', { name: 'Politique de confidentialité' }));
    for (const provider of PRIVACY_PROVIDERS)
      expect(article.getByText(provider.name)).toBeInTheDocument();
    for (const rule of PRIVACY_RETENTION_RULES)
      expect(article.getAllByText(rule.description).length).toBeGreaterThan(0);
    for (const link of container.querySelectorAll<HTMLAnchorElement>('nav a[href^="#"]')) {
      expect(container.querySelector(link.getAttribute('href')!)).not.toBeNull();
    }
    expect(container.textContent).not.toMatch(
      /Sokar SAS|Twilio|Brevo|Postmark|Clerk|Resend|Google Workspace|Cerebras|OpenRouter|Respan|PKCE|PostgreSQL|Redis|Prometheus|honeypot|rate-limiting|puis supprimés automatiquement/,
    );
    expect(container.textContent).toContain('hors de l’Espace économique européen');
    expect(container.textContent).toContain('liste nominative');
    expect(container.textContent).toContain(PRIVACY_DOCUMENT.reservationProcessing);
    expect(container.querySelector('a[href="mailto:privacy@sokar.tech"]')).not.toBeNull();
  });
});

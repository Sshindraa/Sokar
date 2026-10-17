import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PRIVACY_DOCUMENT, PRIVACY_PROVIDERS, PRIVACY_RETENTION_RULES } from '@sokar/shared';
import PrivacyPage, { metadata } from './page';

describe('dashboard privacy disclosure', () => {
  it('renders the shared suppliers and retention disclosures without superseded promises', () => {
    const { container } = render(<PrivacyPage />);
    for (const provider of PRIVACY_PROVIDERS)
      expect(screen.getByText(provider.name)).toBeInTheDocument();
    for (const rule of PRIVACY_RETENTION_RULES)
      expect(screen.getAllByText(rule.description).length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(
      /Sokar SAS|Twilio|Brevo|Postmark|Clerk|OpenRouter|Respan|PKCE|voice_id|__session|rgpd_erasure|AES-256|3 ans après la dernière interaction|Transcription supprimée à l’effacement/,
    );
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(container.textContent).toContain('hors de l’Espace économique européen');
    expect(container.textContent).toContain('liste nominative');
    expect(container.textContent).toContain(PRIVACY_DOCUMENT.reservationProcessing);
    expect(container.querySelector('a[href="mailto:privacy@sokar.tech"]')).not.toBeNull();
  });
});

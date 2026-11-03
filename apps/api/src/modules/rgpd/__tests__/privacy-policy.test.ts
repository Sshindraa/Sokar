import { describe, expect, it } from 'vitest';
import {
  PRIVACY_ANONYMIZATION_REFERENCE,
  PRIVACY_DOCUMENT,
  PRIVACY_PROVIDERS,
} from '@sokar/shared';
import { ANONYMIZATION_GRACE_DAYS, ANONYMIZATION_RETENTION_DAYS } from '../anonymization.service';
import { PRIVACY_POLICY_SUMMARY, PRIVACY_POLICY_TEXT } from '../privacy-policy';

describe('privacy disclosure compatibility', () => {
  it('qualifies the legacy retention threshold using the implemented reservation mechanism', () => {
    expect(PRIVACY_ANONYMIZATION_REFERENCE.reservationAgeDays).toBe(ANONYMIZATION_RETENTION_DAYS);
    expect(PRIVACY_ANONYMIZATION_REFERENCE.noRecentReservationDays).toBe(ANONYMIZATION_GRACE_DAYS);
    expect(PRIVACY_ANONYMIZATION_REFERENCE.enabledByDefault).toBe(false);
    expect(PRIVACY_POLICY_SUMMARY.automaticAnonymizationGuaranteed).toBe(false);
  });

  it('publishes the reservation e-mail with its purpose and retention', () => {
    expect(PRIVACY_POLICY_TEXT).toContain('- Adresse e-mail saisie pour une réservation en ligne');
    expect(PRIVACY_POLICY_TEXT).toContain('- Adresse e-mail de la réservation : L’adresse e-mail');
    expect(PRIVACY_POLICY_TEXT).toContain('sert à gérer cette réservation');
    expect(PRIVACY_POLICY_TEXT).toContain('jusqu’à son anonymisation');
  });

  it('publishes functional categories without the internal supplier inventory', () => {
    expect(new Set(PRIVACY_PROVIDERS.map((provider) => provider.id)).size).toBe(
      PRIVACY_PROVIDERS.length,
    );
    expect(PRIVACY_PROVIDERS).toHaveLength(5);
    expect(JSON.stringify(PRIVACY_POLICY_SUMMARY) + PRIVACY_POLICY_TEXT).not.toMatch(
      /Clerk|Cerebras|OpenRouter|Respan|Scribe|PostgreSQL|Redis|PKCE|AES-256/,
    );
    expect(PRIVACY_POLICY_TEXT).toContain('hors de l’Espace économique européen');
    expect(PRIVACY_POLICY_TEXT).toContain('privacy@sokar.tech');
    expect(PRIVACY_POLICY_TEXT).toContain('sans purge automatique');
    expect(PRIVACY_POLICY_TEXT).toContain(PRIVACY_DOCUMENT.reservationProcessing);
    expect(PRIVACY_POLICY_TEXT).toContain('Demandes de démonstration : intérêt légitime');
  });
});

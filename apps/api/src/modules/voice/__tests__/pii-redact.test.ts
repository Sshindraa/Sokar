import { describe, it, expect } from 'vitest';
import { redactPii } from '../stream/pii-redact';

describe('redactPii', () => {
  it('redacte les numéros de téléphone', () => {
    expect(redactPii('Mon numéro est +33 6 12 34 56 78')).toBe('Mon numéro est [PHONE]');
    expect(redactPii('Appelez le 0612345678')).toBe('Appelez le [PHONE]');
    expect(redactPii('Tel: +1 (555) 123-4567')).toBe('Tel: [PHONE]');
  });

  it('redacte les emails', () => {
    expect(redactPii('Mon email est jean.dupont@example.com')).toBe('Mon email est [EMAIL]');
    expect(redactPii('Contact: test.user+tag@domain.co.uk')).toBe('Contact: [EMAIL]');
  });

  it('redacte téléphone et email simultanément', () => {
    expect(redactPii('Email: jean@exemple.fr, Tel: +33 6 12 34 56 78')).toBe(
      'Email: [EMAIL], Tel: [PHONE]',
    );
  });

  it('ne modifie pas le texte sans PII', () => {
    expect(redactPii('Bonjour, je voudrais réserver une table')).toBe(
      'Bonjour, je voudrais réserver une table',
    );
  });

  it('ne redacte pas les nombres courts (pas des téléphones)', () => {
    expect(redactPii('Pour 4 personnes à 19h30')).toBe('Pour 4 personnes à 19h30');
  });
});

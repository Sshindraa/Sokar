import { describe, it, expect } from 'vitest';
import { describeTranscript, redactPii } from '../stream/pii-redact';

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

  it('ne prend pas une date AAAA-MM-JJ pour un numéro de téléphone (brouillon du voice-debug)', () => {
    expect(redactPii('2026-09-30')).toBe('2026-09-30');
    const draft = '{"date":"2026-09-30","time":"22:00","partySize":4,"customerName":"AASAM"}';
    expect(redactPii(draft)).toBe(draft);
    expect(redactPii('créneau 2026-09-30T19:00 puis 2026-10-01 à 12 h')).toBe(
      'créneau 2026-09-30T19:00 puis 2026-10-01 à 12 h',
    );
    // Une date à côté d'un vrai numéro : seul le numéro est masqué.
    expect(redactPii('le 2026-09-30 appelez le 0612345678 ou le 06-12-34-56-78')).toBe(
      'le 2026-09-30 appelez le [PHONE] ou le [PHONE]',
    );
    expect(redactPii('date 2026-09-30, tel +33 6 12 34 56 78')).toBe(
      'date 2026-09-30, tel [PHONE]',
    );
  });

  it('ne redacte pas les nombres courts (pas des téléphones)', () => {
    expect(redactPii('Pour 4 personnes à 19h30')).toBe('Pour 4 personnes à 19h30');
  });
});

describe('describeTranscript', () => {
  it('décrit une transcription sans exposer son contenu', () => {
    const described = describeTranscript("C'est au nom de Akif Adebayor.");

    expect(described.transcriptLength).toBe(30);
    expect(described.transcriptFingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(described)).not.toContain('Adebayor');
  });
});

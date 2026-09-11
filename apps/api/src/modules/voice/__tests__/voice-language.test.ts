import { describe, expect, it } from 'vitest';
import {
  buildLlmMessagesWithLanguage,
  buildVoiceLanguageInstruction,
  hasReliableLanguageEvidence,
  normalizeVoiceLocale,
  normalizeVoiceLanguage,
  resolveVoiceLanguage,
} from '../stream/voice-language';

describe('voice language routing', () => {
  it('normalizes Scribe BCP-47 and bibliographic language codes', () => {
    expect(normalizeVoiceLanguage('en-US')).toBe('en');
    expect(normalizeVoiceLanguage('ENG')).toBe('en');
    expect(normalizeVoiceLanguage('fr-FR')).toBe('fr');
    expect(normalizeVoiceLanguage('unknown')).toBeNull();
  });

  it('maps the detected language to a regional Cartesia locale', () => {
    expect(normalizeVoiceLocale('en-US')).toBe('en-US');
    expect(normalizeVoiceLocale('en-GB')).toBe('en-GB');
    expect(normalizeVoiceLocale('fr')).toBe('fr-FR');
    expect(normalizeVoiceLocale('ur')).toBe('ur-IN');
    expect(normalizeVoiceLocale('unknown')).toBeNull();
  });

  it('instructs the LLM to reason and answer in the detected language', () => {
    const messages = buildLlmMessagesWithLanguage(
      [
        { role: 'system', content: 'Restaurant instructions' },
        { role: 'user', content: 'I need a table for two' },
      ],
      'en',
    );

    expect(messages[0]).toEqual({ role: 'system', content: 'Restaurant instructions' });
    expect(messages[1].content).toContain('reason in English');
    expect(messages[1].content).toContain('answer the caller exclusively in English');
    expect(messages[2]).toEqual({ role: 'user', content: 'I need a table for two' });
    expect(buildVoiceLanguageInstruction('fr')).toContain('exclusivement en français');
  });

  it('écarte les fragments et répétitions avant de changer de langue', () => {
    expect(hasReliableLanguageEvidence('Euh, on se...')).toBe(false);
    expect(hasReliableLanguageEvidence('Waouh, waouh, waouh, waouh, calme-toi.')).toBe(false);
    expect(hasReliableLanguageEvidence('I would like a table for four people.')).toBe(true);
  });

  it('demande deux segments avant un changement de langue en cours d’appel', () => {
    const first = resolveVoiceLanguage(
      'fr',
      'it',
      'Vorrei prenotare un tavolo per quattro.',
      2,
      null,
    );
    expect(first).toEqual({
      language: 'fr',
      candidate: { code: 'it', count: 1 },
      accepted: false,
      changed: false,
    });

    const second = resolveVoiceLanguage(
      'fr',
      'it',
      'Domani sera alle otto, grazie.',
      3,
      first.candidate,
    );
    expect(second).toEqual({
      language: 'it',
      candidate: null,
      accepted: true,
      changed: true,
    });
  });

  it('accepte une langue claire sur le premier tour', () => {
    expect(resolveVoiceLanguage('fr', 'en', 'I need a table for two tomorrow.', 0, null)).toEqual({
      language: 'en',
      candidate: null,
      accepted: true,
      changed: true,
    });
  });
});

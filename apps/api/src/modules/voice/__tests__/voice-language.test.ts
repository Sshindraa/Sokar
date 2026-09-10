import { describe, expect, it } from 'vitest';
import {
  buildLlmMessagesWithLanguage,
  buildVoiceLanguageInstruction,
  normalizeVoiceLocale,
  normalizeVoiceLanguage,
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
});

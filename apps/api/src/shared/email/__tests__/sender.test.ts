import { describe, expect, it } from 'vitest';
import { emailReplyTo, emailSender } from '../index';
import { smsSender } from '../../telnyx/client';

describe('emailSender', () => {
  it('affiche « Suppernote » même quand EMAIL_FROM est une adresse nue', () => {
    expect(emailSender({ EMAIL_FROM: 'noreply@suppernote.com' })).toBe(
      'Suppernote <noreply@suppernote.com>',
    );
    expect(emailSender({ EMAIL_FROM: 'Équipe Suppernote <hello@suppernote.com>' })).toBe(
      'Équipe Suppernote <hello@suppernote.com>',
    );
    expect(emailSender({})).toBe('Suppernote <noreply@suppernote.com>');
  });
});

describe('emailReplyTo', () => {
  it('renvoie les réponses vers une boîte lue', () => {
    expect(emailReplyTo({})).toBe('hello@suppernote.com');
    expect(emailReplyTo({ EMAIL_REPLY_TO: 'support@suppernote.com' })).toBe(
      'support@suppernote.com',
    );
  });
});

describe('smsSender', () => {
  it('préfère l’expéditeur SMS dédié au numéro d’appel', () => {
    expect(smsSender({ TELNYX_SMS_FROM: 'SOKAR', TELNYX_FROM_NUMBER: '+33400000000' })).toBe(
      'SOKAR',
    );
    expect(smsSender({ TELNYX_FROM_NUMBER: '+33400000000' })).toBe('+33400000000');
    expect(() => smsSender({})).toThrow(/TELNYX_SMS_FROM/);
  });
});

import { describe, expect, it } from 'vitest';
import { emailReplyTo, emailSender } from '../index';
import { smsSender } from '../../telnyx/client';

describe('emailSender', () => {
  it('affiche « Sokar » même quand EMAIL_FROM est une adresse nue', () => {
    expect(emailSender({ EMAIL_FROM: 'noreply@sokar.tech' })).toBe('Sokar <noreply@sokar.tech>');
    expect(emailSender({ EMAIL_FROM: 'Équipe Sokar <hello@sokar.tech>' })).toBe(
      'Équipe Sokar <hello@sokar.tech>',
    );
    expect(emailSender({})).toBe('Sokar <noreply@sokar.tech>');
  });
});

describe('emailReplyTo', () => {
  it('renvoie les réponses vers une boîte lue', () => {
    expect(emailReplyTo({})).toBe('hello@sokar.tech');
    expect(emailReplyTo({ EMAIL_REPLY_TO: 'support@sokar.tech' })).toBe('support@sokar.tech');
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

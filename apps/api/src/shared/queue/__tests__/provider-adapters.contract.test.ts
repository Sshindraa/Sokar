import { describe, expect, it } from 'vitest';
import { classifyResendEmailResponse, normalizeResendSendResponse } from '../../email';
import { classifyTelnyxMessageResponse, normalizeTelnyxSendResponse } from '../../telnyx/client';

describe('notification provider adapters — contract fixtures', () => {
  it('retourne un reçu borné Telnyx avec l’identifiant d’acceptation', async () => {
    expect(normalizeTelnyxSendResponse({ data: { id: 'telnyx-message-1' } })).toEqual({
      outcome: 'success',
      provider: 'telnyx',
      channel: 'sms',
      providerMessageId: 'telnyx-message-1',
    });
  });

  it.each([
    ['queued', 'success'],
    ['sent', 'success'],
    ['delivered', 'success'],
    ['delivery_failed', 'success'],
    ['sending_failed', 'failure_certain'],
    ['expired', 'failure_certain'],
  ] as const)('classe le statut Telnyx %s comme %s', async (status, expected) => {
    expect(
      classifyTelnyxMessageResponse({
        data: { to: [{ status }] },
      }),
    ).toBe(expected);
  });

  it('garde delivery_failed comme acceptation anti-doublon, pas comme preuve de livraison', async () => {
    expect(classifyTelnyxMessageResponse({ data: { to: [{ status: 'delivery_failed' }] } })).toBe(
      'success',
    );
  });

  it('retourne unknown si Telnyx ne fournit pas de statut ou devient indisponible', async () => {
    expect(classifyTelnyxMessageResponse({ data: { id: 'telnyx-message-1' } })).toBe('unknown');
    expect(classifyTelnyxMessageResponse(undefined)).toBe('unknown');
  });

  it('retourne un reçu borné Resend avec l’identifiant du message accepté', async () => {
    expect(
      normalizeResendSendResponse({
        data: { id: 'resend-message-1' },
        error: null,
      }),
    ).toEqual({
      outcome: 'success',
      provider: 'resend',
      channel: 'email',
      providerMessageId: 'resend-message-1',
    });
  });

  it('préserve un refus Resend comme erreur certaine sans exposer le payload provider', () => {
    expect(() =>
      normalizeResendSendResponse({
        data: null,
        error: { message: 'invalid recipient', name: 'validation_error' },
      }),
    ).toThrow('Resend API error: invalid recipient');
  });

  it.each([
    ['queued', 'success'],
    ['sent', 'success'],
    ['delivered', 'success'],
    ['failed', 'failure_certain'],
    ['canceled', 'failure_certain'],
    ['suppressed', 'failure_certain'],
  ] as const)('classe l’événement Resend %s comme %s', async (event, expected) => {
    expect(classifyResendEmailResponse({ data: { last_event: event } })).toBe(expected);
  });

  it('retourne unknown pour un message Resend sans événement ou une erreur de lookup', async () => {
    expect(classifyResendEmailResponse({ data: { id: 'resend-message-1' } })).toBe('unknown');
    expect(classifyResendEmailResponse(undefined)).toBe('unknown');
  });
});

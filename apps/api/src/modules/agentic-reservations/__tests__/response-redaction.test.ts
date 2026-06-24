import { describe, expect, it } from 'vitest';
import { redactPiiInString, redactResponse, redactValue } from '../mcp/response-redaction.js';

describe('response-redaction', () => {
  describe('redactValue', () => {
    it('redacte apiKey', () => {
      expect(redactValue('apiKey', 'sk_live_xxx')).toBe('[REDACTED]');
      expect(redactValue('api_key', 'sk_live_xxx')).toBe('[REDACTED]');
    });
    it('redacte token', () => {
      expect(redactValue('token', 'xxx')).toBe('[REDACTED]');
      expect(redactValue('accessToken', 'xxx')).toBe('[REDACTED]');
    });
    it('redacte password', () => {
      expect(redactValue('password', 'xxx')).toBe('[REDACTED]');
    });
    it('redacte email', () => {
      expect(redactValue('email', 'a@b.com')).toBe('[REDACTED]');
      expect(redactValue('customerEmail', 'a@b.com')).toBe('[REDACTED]');
    });
    it('redacte phone', () => {
      expect(redactValue('phone', '+336****0000')).toBe('[REDACTED]');
      expect(redactValue('customerPhone', '+336****0000')).toBe('[REDACTED]');
    });
    it('redacte holdToken interne', () => {
      expect(redactValue('holdToken', 'abc123')).toBe('[REDACTED]');
      expect(redactValue('quoteToken', 'abc123')).toBe('[REDACTED]');
    });
    it('préserve les noms normaux', () => {
      expect(redactValue('name', 'Le Bistrot')).toBe('Le Bistrot');
      expect(redactValue('partySize', 4)).toBe(4);
    });
  });

  describe('redactPiiInString', () => {
    it('redacte les emails inline', () => {
      expect(redactPiiInString('Contact: test@example.com')).toContain('[REDACTED_EMAIL]');
    });
    it('redacte les téléphones inline', () => {
      expect(redactPiiInString('Appel +336****5678')).toContain('[REDACTED_PHONE]');
    });
    it('préserve les UUID', () => {
      const uuid = '9514c7fe-39af-4334-8038-fd93a13da84f';
      expect(redactPiiInString(`reservationId=${uuid}`)).toContain(uuid);
    });
    it('redacte les longs hex (token-like)', () => {
      const long = 'a'.repeat(64);
      expect(redactPiiInString(`token=${long}`)).toContain('[REDACTED_HEX]');
    });
    it('préserve les dates ISO (ne pas confondre avec des téléphones)', () => {
      expect(redactPiiInString('startsAt=2026-06-23T17:30:00.000Z')).not.toContain('[REDACTED_PHONE]');
      expect(redactPiiInString('startsAt=2026-06-23T17:30:00.000Z')).toContain('2026-06-23T17:30:00.000Z');
      expect(redactPiiInString('date=2026-06-24')).not.toContain('[REDACTED_PHONE]');
      expect(redactPiiInString('date=2026-06-24')).toContain('2026-06-24');
    });
    it('redacte toujours les vrais téléphones', () => {
      expect(redactPiiInString('Appel +336****5678 maintenant')).toContain('[REDACTED_PHONE]');
      expect(redactPiiInString('tel: 0612345678')).toContain('[REDACTED_PHONE]');
    });
    it('préserve le texte sans PII', () => {
      expect(redactPiiInString('Resto sympa, 4 personnes')).toBe('Resto sympa, 4 personnes');
    });
  });

  describe('redactResponse (récursif)', () => {
    it('redacte un objet plat', () => {
      const out = redactResponse({
        name: 'Le Bistrot',
        apiKey: 'sk_live_secret',
        email: 'test@example.com',
      });
      expect(out.name).toBe('Le Bistrot');
      expect(out.apiKey).toBe('[REDACTED]');
      expect(out.email).toBe('[REDACTED]');
    });

    it('redacte récursivement dans les arrays', () => {
      const out = redactResponse([
        { name: 'A', apiKey: 'x' },
        { name: 'B', apiKey: 'y' },
      ]);
      expect(out[0].apiKey).toBe('[REDACTED]');
      expect(out[1].apiKey).toBe('[REDACTED]');
      expect(out[0].name).toBe('A');
    });

    it('redacte dans les objets imbriqués', () => {
      const out = redactResponse({
        restaurant: { name: 'Le Bistrot', apiKey: 'secret' },
      });
      expect(out.restaurant.name).toBe('Le Bistrot');
      expect(out.restaurant.apiKey).toBe('[REDACTED]');
    });

    it('redacte les PII inline dans les strings', () => {
      const out = redactResponse({ message: 'Contact test@example.com' });
      expect(out.message).toContain('[REDACTED_EMAIL]');
    });

    it('préserve null/undefined', () => {
      expect(redactResponse(null)).toBeNull();
      expect(redactResponse(undefined)).toBeUndefined();
    });

    it('préserve les primitives', () => {
      expect(redactResponse(42)).toBe(42);
      expect(redactResponse('hello')).toBe('hello');
      expect(redactResponse(true)).toBe(true);
    });

    it('sérialise les Date en ISO string', () => {
      const out = redactResponse({
        startsAt: new Date('2026-06-23T17:30:00.000Z'),
      });
      expect(out.startsAt).toBe('2026-06-23T17:30:00.000Z');
    });
  });
});

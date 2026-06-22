import { describe, expect, it, beforeEach } from 'vitest';
import { detectPiiLeaks, assertNoPiiLeak } from '../pii-leak';
import { piiLeaksTotal } from '../metrics';

describe('PII leak detector', () => {
  beforeEach(() => {
    piiLeaksTotal.reset();
  });
  describe('detectPiiLeaks', () => {
    it('détecte un email', () => {
      const report = detectPiiLeaks({ contact: 'test@example.com' });
      expect(report.hasLeak).toBe(true);
      expect(report.leaks[0].kind).toBe('email');
    });

    it('détecte un numéro de téléphone long', () => {
      // Format : 10+ chiffres avec séparateurs possibles
      const report = detectPiiLeaks({ phone: '0612345678' });
      expect(report.hasLeak).toBe(true);
      expect(report.leaks[0].kind).toBe('phone');
    });

    it('détecte un hex long (token-like)', () => {
      const long = 'a'.repeat(64);
      const report = detectPiiLeaks({ token: long });
      expect(report.hasLeak).toBe(true);
      expect(report.leaks[0].kind).toBe('hex');
    });

    it('ignore les IDs courts (UUID)', () => {
      const report = detectPiiLeaks({ id: '550e8400-e29b-41d4-a716-446655440000' });
      // L'UUID ne contient pas de hex de 32+ chars contigus
      expect(report.hasLeak).toBe(false);
    });

    it('ignore les booléens et nombres', () => {
      const report = detectPiiLeaks({
        count: 42,
        active: true,
        null: null,
        undef: undefined,
      });
      expect(report.hasLeak).toBe(false);
    });

    it('scanne récursivement les arrays', () => {
      const report = detectPiiLeaks({ items: ['a', 'b', { email: 'x@y.com' }] });
      expect(report.hasLeak).toBe(true);
      expect(report.leaks[0].path).toContain('email');
    });

    it('scanne récursivement les objets imbriqués', () => {
      const report = detectPiiLeaks({ data: { user: { email: 'a@b.com' } } });
      expect(report.hasLeak).toBe(true);
      expect(report.leaks[0].path).toBe('data.user.email');
    });

    it('ne boucle pas sur les objets cycliques', () => {
      const root: Record<string, unknown> = { nested: { email: 'a@b.com' } };
      root.self = root;

      const report = detectPiiLeaks(root);

      expect(report.hasLeak).toBe(true);
      expect(report.leaks).toHaveLength(1);
      expect(report.leaks[0].path).toBe('nested.email');
    });

    it('ignore les clés allowed (id, uuid, hash)', () => {
      // Les clés "id", "uuid" etc. ne contiennent jamais de PII selon nos tests
      const report = detectPiiLeaks({
        id: 'abc-123',
        uuid: '550e8400-e29b-41d4-a716-446655440000',
        state: 'CONFIRMED',
      });
      expect(report.hasLeak).toBe(false);
    });

    it('retourne hasLeak=false pour un objet vide', () => {
      expect(detectPiiLeaks({}).hasLeak).toBe(false);
      expect(detectPiiLeaks(null).hasLeak).toBe(false);
      expect(detectPiiLeaks(undefined).hasLeak).toBe(false);
    });

    it('rapporte plusieurs leaks dans le même objet', () => {
      const report = detectPiiLeaks({
        a: 'test@example.com',
        b: '06****5678', // pas un vrai numéro E.164 mais matche le regex phone
        c: 'a'.repeat(64),
      });
      expect(report.hasLeak).toBe(true);
      // On attend au moins 2 leaks (email + hex), phone peut matcher
      // selon le format. Le test vérifie qu'on a plusieurs leaks.
      expect(report.leaks.length).toBeGreaterThanOrEqual(2);
      const kinds = report.leaks.map((l) => l.kind);
      expect(kinds).toContain('email');
      expect(kinds).toContain('hex');
    });
  });

  describe('assertNoPiiLeak', () => {
    it('ne throw pas sur un objet clean', () => {
      expect(() =>
        assertNoPiiLeak({ id: 'abc', name: 'Le Bistrot' }, 'get_restaurant_details'),
      ).not.toThrow();
    });
  });
});

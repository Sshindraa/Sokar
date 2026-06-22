import { describe, expect, it } from 'vitest';
import {
  buildPolicySnapshot,
  computeHoldExpiresAt,
  computeQuoteExpiresAt,
  DEFAULT_HOLD_TTL_SECONDS,
  DEFAULT_MAX_PARTY_SIZE,
  DEFAULT_MIN_LEAD_TIME_MINUTES,
  DEFAULT_QUOTE_TTL_SECONDS,
  PolicyValidationError,
  type RestaurantPolicyInput,
  validateExposureSettings,
  validateReservationAgainstPolicy,
} from '../core/policies.service.js';

const baseInput: RestaurantPolicyInput = {
  policyVersion: '2026-06-20',
  maxPartySize: 8,
  minLeadTimeMinutes: 60,
  requireManualValidation: false,
  quoteTtlSeconds: 300,
  holdTtlSeconds: 420,
  noShowPolicy: 'warning',
  notificationChannels: ['sms', 'email'],
  capacitySpecials: {},
};

describe('policies.service', () => {
  describe('validateExposureSettings', () => {
    it('passe sur settings valides', () => {
      expect(() => validateExposureSettings(baseInput)).not.toThrow();
    });

    it('rejette maxPartySize < 1', () => {
      expect(() => validateExposureSettings({ maxPartySize: 0 })).toThrow(PolicyValidationError);
    });

    it('rejette maxPartySize > 50', () => {
      expect(() => validateExposureSettings({ maxPartySize: 100 })).toThrow(/maxPartySize/);
    });

    it('rejette minLeadTimeMinutes < 0', () => {
      expect(() => validateExposureSettings({ minLeadTimeMinutes: -10 })).toThrow();
    });

    it('rejette minLeadTimeMinutes > 24h', () => {
      expect(() => validateExposureSettings({ minLeadTimeMinutes: 24 * 60 + 1 })).toThrow();
    });

    it('rejette quoteTtlSeconds < 30s', () => {
      expect(() => validateExposureSettings({ quoteTtlSeconds: 10 })).toThrow();
    });

    it('rejette quoteTtlSeconds > 1h', () => {
      expect(() => validateExposureSettings({ quoteTtlSeconds: 7200 })).toThrow();
    });

    it('rejette holdTtlSeconds < 60s', () => {
      expect(() => validateExposureSettings({ holdTtlSeconds: 30 })).toThrow();
    });

    it('rejette holdTtlSeconds ≤ quoteTtlSeconds (incohérence)', () => {
      expect(() => validateExposureSettings({ quoteTtlSeconds: 300, holdTtlSeconds: 300 })).toThrow(
        /holdTtlSeconds.*supérieur/,
      );
    });

    it('rejette noShowPolicy invalide', () => {
      expect(() => validateExposureSettings({ noShowPolicy: 'destroy' })).toThrow();
    });

    it('accepte warning/fee/block', () => {
      expect(() => validateExposureSettings({ noShowPolicy: 'warning' })).not.toThrow();
      expect(() => validateExposureSettings({ noShowPolicy: 'fee' })).not.toThrow();
      expect(() => validateExposureSettings({ noShowPolicy: 'block' })).not.toThrow();
    });
  });

  describe('buildPolicySnapshot', () => {
    it('utilise les valeurs fournies', () => {
      const snap = buildPolicySnapshot(baseInput);
      expect(snap.maxPartySize).toBe(8);
      expect(snap.minLeadTimeMinutes).toBe(60);
      expect(snap.quoteTtlSeconds).toBe(300);
      expect(snap.holdTtlSeconds).toBe(420);
      expect(snap.noShow.kind).toBe('warning');
      expect(snap.notificationChannels).toEqual(['sms', 'email']);
      expect(snap.policyVersion).toBe('2026-06-20');
    });

    it('applique les défauts si valeurs manquantes', () => {
      const snap = buildPolicySnapshot({
        policyVersion: '2026-06-20',
        maxPartySize: null,
        minLeadTimeMinutes: undefined,
        requireManualValidation: undefined,
        quoteTtlSeconds: null,
        holdTtlSeconds: undefined,
        noShowPolicy: null,
        notificationChannels: [],
        capacitySpecials: null,
      });
      expect(snap.maxPartySize).toBe(DEFAULT_MAX_PARTY_SIZE);
      expect(snap.minLeadTimeMinutes).toBe(DEFAULT_MIN_LEAD_TIME_MINUTES);
      expect(snap.quoteTtlSeconds).toBe(DEFAULT_QUOTE_TTL_SECONDS);
      expect(snap.holdTtlSeconds).toBe(DEFAULT_HOLD_TTL_SECONDS);
      expect(snap.noShow.kind).toBe('warning');
      expect(snap.notificationChannels).toEqual(['sms', 'email']);
    });

    it('fallback warning si noShowPolicy invalide', () => {
      const snap = buildPolicySnapshot({ ...baseInput, noShowPolicy: 'invalid' });
      expect(snap.noShow.kind).toBe('warning');
    });
  });

  describe('validateReservationAgainstPolicy', () => {
    it('accepte une demande conforme', () => {
      const snap = buildPolicySnapshot(baseInput);
      const inTwoHours = new Date(Date.now() + 2 * 60 * 60 * 1000);
      expect(() =>
        validateReservationAgainstPolicy(snap, {
          partySize: 4,
          startsAt: inTwoHours,
          channel: 'MCP',
        }),
      ).not.toThrow();
    });

    it('rejette partySize < 1', () => {
      const snap = buildPolicySnapshot(baseInput);
      const inOneHour = new Date(Date.now() + 60 * 60 * 1000);
      expect(() =>
        validateReservationAgainstPolicy(snap, {
          partySize: 0,
          startsAt: inOneHour,
          channel: 'MCP',
        }),
      ).toThrow(/partySize/);
    });

    it('rejette partySize > maxPartySize', () => {
      const snap = buildPolicySnapshot(baseInput);
      const inOneHour = new Date(Date.now() + 60 * 60 * 1000);
      expect(() =>
        validateReservationAgainstPolicy(snap, {
          partySize: 20,
          startsAt: inOneHour,
          channel: 'MCP',
        }),
      ).toThrow(/maxPartySize/);
    });

    it('rejette si lead time < minLeadTimeMinutes', () => {
      const snap = buildPolicySnapshot(baseInput); // 60 min
      const inTenMinutes = new Date(Date.now() + 10 * 60 * 1000);
      expect(() =>
        validateReservationAgainstPolicy(snap, {
          partySize: 2,
          startsAt: inTenMinutes,
          channel: 'MCP',
        }),
      ).toThrow(/lead time/i);
    });

    it('accepte si lead time = minLeadTimeMinutes', () => {
      const snap = buildPolicySnapshot(baseInput);
      const justEnough = new Date(Date.now() + 60 * 60 * 1000 + 100);
      expect(() =>
        validateReservationAgainstPolicy(snap, {
          partySize: 2,
          startsAt: justEnough,
          channel: 'MCP',
        }),
      ).not.toThrow();
    });
  });

  describe('computeQuoteExpiresAt / computeHoldExpiresAt', () => {
    it('ajoute quoteTtlSeconds', () => {
      const snap = buildPolicySnapshot(baseInput);
      const now = new Date('2026-06-21T12:00:00Z');
      const exp = computeQuoteExpiresAt(snap, now);
      expect(exp.getTime() - now.getTime()).toBe(300 * 1000);
    });

    it('ajoute holdTtlSeconds', () => {
      const snap = buildPolicySnapshot(baseInput);
      const now = new Date('2026-06-21T12:00:00Z');
      const exp = computeHoldExpiresAt(snap, now);
      expect(exp.getTime() - now.getTime()).toBe(420 * 1000);
    });

    it('holdTtlSeconds > quoteTtlSeconds (sanité)', () => {
      const snap = buildPolicySnapshot(baseInput);
      expect(snap.holdTtlSeconds).toBeGreaterThan(snap.quoteTtlSeconds);
    });
  });
});

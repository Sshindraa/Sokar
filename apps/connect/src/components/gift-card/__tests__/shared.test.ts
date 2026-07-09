/**
 * Tests unitaires pour les utilitaires partagés gift-card (shared.ts).
 */

import { describe, it, expect } from 'vitest';
import { formatEuro, todayIso, reservationTheme } from '@/components/gift-card/shared';

describe('formatEuro', () => {
  // fr-FR locale uses NBSP (U+00A0) before € and NARROW NO-BREAK SPACE (U+202F)
  // for thousands separator.
  const NBSP = '\u00A0';
  const NNBSP = '\u202F';

  it('formats a whole number with 2 decimal places', () => {
    expect(formatEuro(50)).toBe(`50,00${NBSP}€`);
  });

  it('formats a decimal amount', () => {
    expect(formatEuro(19.99)).toBe(`19,99${NBSP}€`);
  });

  it('formats zero', () => {
    expect(formatEuro(0)).toBe(`0,00${NBSP}€`);
  });

  it('formats a large amount with thousands separator', () => {
    expect(formatEuro(1000)).toBe(`1${NNBSP}000,00${NBSP}€`);
  });

  it('always includes the euro symbol', () => {
    expect(formatEuro(10)).toContain('€');
  });

  it('always uses comma as decimal separator (fr-FR)', () => {
    expect(formatEuro(10.5)).toContain(',');
  });
});

describe('todayIso', () => {
  it('returns a date string in YYYY-MM-DD format', () => {
    const result = todayIso();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns the current date (UTC)', () => {
    const now = new Date();
    const expected = now.toISOString().slice(0, 10);
    expect(todayIso()).toBe(expected);
  });

  it('returns a valid date that can be parsed', () => {
    const iso = todayIso();
    const parsed = new Date(iso);
    expect(parsed.toString()).not.toBe('Invalid Date');
  });
});

describe('reservationTheme', () => {
  it('is an object with CSS custom properties', () => {
    expect(typeof reservationTheme).toBe('object');
    expect(reservationTheme).not.toBeNull();
  });

  it('contains all expected CSS variables', () => {
    const keys = Object.keys(reservationTheme);
    expect(keys).toContain('--reservation-bg');
    expect(keys).toContain('--reservation-wash');
    expect(keys).toContain('--reservation-panel');
    expect(keys).toContain('--reservation-ink');
    expect(keys).toContain('--reservation-soft');
    expect(keys).toContain('--reservation-muted');
    expect(keys).toContain('--reservation-line');
    expect(keys).toContain('--reservation-glow');
    expect(keys).toContain('--reservation-success');
  });

  it('has string values for all CSS variables', () => {
    for (const value of Object.values(reservationTheme)) {
      expect(typeof value).toBe('string');
    }
  });

  it('has 9 CSS variables total', () => {
    expect(Object.keys(reservationTheme)).toHaveLength(9);
  });
});

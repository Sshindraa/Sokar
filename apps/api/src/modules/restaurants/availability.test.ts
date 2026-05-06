import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { RestaurantService } from './restaurant.service';

// On fixe une date de référence : lundi 4 mai 2026
const REFERENCE_DATE = new Date('2026-05-04T12:00:00+02:00');

describe('RestaurantService.isOpen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(REFERENCE_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const ctx = {
    openingHours: {
      mon: { open: '12:00', close: '14:30' },
      tue: { open: '12:00', close: '14:30' },
      wed: { open: '12:00', close: '14:30' },
      thu: { open: '12:00', close: '14:30' },
      fri: { open: '12:00', close: '14:30' },
      sat: { open: '19:00', close: '23:00' },
      sun: null,
    },
  };

  it('devrait retourner true pour un lundi 13h (en semaine, en service)', () => {
    expect(RestaurantService.isOpen(ctx, '2026-05-04', '13:00')).toBe(true);
  });

  it('devrait retourner false pour un dimanche (fermé)', () => {
    expect(RestaurantService.isOpen(ctx, '2026-05-10', '13:00')).toBe(false);
  });

  it('devrait retourner false pour un mercredi 11h (avant ouverture)', () => {
    expect(RestaurantService.isOpen(ctx, '2026-05-06', '11:00')).toBe(false);
  });

  it('devrait retourner false pour un mercredi 15h (après fermeture)', () => {
    expect(RestaurantService.isOpen(ctx, '2026-05-06', '15:00')).toBe(false);
  });

  it('devrait retourner true pour un samedi 20h (service du soir)', () => {
    expect(RestaurantService.isOpen(ctx, '2026-05-09', '20:00')).toBe(true);
  });
});

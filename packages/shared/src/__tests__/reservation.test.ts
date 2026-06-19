import { describe, it, expect } from 'vitest';
import {
  RESERVATION_STATUS_VALUES,
  ACTIVE_RESERVATION_STATUSES,
  isActiveReservationStatus,
  RESERVATION_STATUS_LABELS,
  RESERVATION_STATUS_VARIANT,
  type ReservationStatus,
} from '../reservation';

describe('reservation', () => {
  it('exposes exactly the 4 Prisma statuses', () => {
    expect(RESERVATION_STATUS_VALUES).toEqual([
      'CONFIRMED',
      'CANCELLED',
      'NO_SHOW',
      'SEATED',
    ]);
  });

  it('active statuses are a strict subset of all statuses', () => {
    for (const s of ACTIVE_RESERVATION_STATUSES) {
      expect(RESERVATION_STATUS_VALUES).toContain(s);
    }
    // CANCELLED and NO_SHOW must NOT be active (they free the slot)
    expect(isActiveReservationStatus('CANCELLED')).toBe(false);
    expect(isActiveReservationStatus('NO_SHOW')).toBe(false);
  });

  it('isActiveReservationStatus narrows the type', () => {
    const s: string = 'CONFIRMED';
    if (isActiveReservationStatus(s)) {
      // s is now ReservationStatus — this assignment is the type test
      const typed: ReservationStatus = s;
      expect(typed).toBe('CONFIRMED');
    } else {
      throw new Error('CONFIRMED should be active');
    }
  });

  it('every status has a French label and a variant (no UI holes)', () => {
    for (const s of RESERVATION_STATUS_VALUES) {
      expect(RESERVATION_STATUS_LABELS[s], `label for ${s}`).toBeTypeOf('string');
      expect(RESERVATION_STATUS_LABELS[s].length).toBeGreaterThan(0);
      expect(RESERVATION_STATUS_VARIANT[s], `variant for ${s}`).toBeTypeOf('string');
    }
  });
});

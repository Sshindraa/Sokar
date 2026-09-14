import { describe, expect, it } from 'vitest';
import { scoreReservationCheckMatch } from '../reservation-check-matcher.service';

const reservation = {
  id: 'reservation-1',
  reservedAt: '2026-09-14T19:00:00.000Z',
  partySize: 4,
  tableReference: 'T12',
  customerPhone: '+33 6 12 34 56 78',
};

describe('scoreReservationCheckMatch', () => {
  it('matches an exact provider reservation id at full confidence', () => {
    const result = scoreReservationCheckMatch({
      reservation: { ...reservation, reservationExternalId: 'abc-42' },
      check: {
        id: 'check-1',
        openedAt: '2026-09-14T23:00:00.000Z',
        reservationExternalId: ' ABC-42 ',
      },
    });

    expect(result).toMatchObject({
      score: 100,
      confidence: 1,
      status: 'MATCHED',
      method: 'RESERVATION_EXTERNAL_ID',
    });
    expect(result.reasons).toContain('reservation_external_id_exact');
  });

  it('combines table, time and party evidence into an automatic match', () => {
    const result = scoreReservationCheckMatch({
      reservation,
      check: {
        id: 'check-1',
        openedAt: '2026-09-14T19:30:00.000Z',
        tableReference: 't12',
        partySize: 5,
      },
    });

    expect(result).toMatchObject({ score: 85, confidence: 0.85, status: 'MATCHED' });
    expect(result.method).toBe('TABLE_AND_TIME');
  });

  it('requires review when a conflict cancels otherwise strong evidence', () => {
    const result = scoreReservationCheckMatch({
      reservation,
      check: {
        id: 'check-1',
        openedAt: '2026-09-14T19:30:00.000Z',
        tableReference: 't12',
        partySize: 4,
        conflict: true,
      },
    });

    expect(result).toMatchObject({ score: 35, confidence: 0.35, status: 'UNMATCHED' });
    expect(result.reasons).toContain('conflicting_confirmed_reservation');
  });

  it('uses a verified phone/token as an explicit scoring signal', () => {
    const result = scoreReservationCheckMatch({
      reservation,
      check: {
        id: 'check-1',
        openedAt: '2026-09-20T19:00:00.000Z',
        customerPhone: '+33612345678',
      },
    });

    expect(result).toMatchObject({ score: 40, status: 'UNMATCHED', method: 'CUSTOMER_TOKEN' });
  });
});

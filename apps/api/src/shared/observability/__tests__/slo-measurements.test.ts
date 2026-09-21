import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  measureBusinessSloInputs,
  measureReservationConfirmationCoverage,
  measureVoiceTranscriptCoverage,
} from '../slo-measurements';

function makeDb(counts: { call?: number[]; reservation?: number[] }): PrismaClient {
  const callCounts = [...(counts.call ?? [])];
  const reservationCounts = [...(counts.reservation ?? [])];
  return {
    call: { count: vi.fn(async () => callCounts.shift() ?? 0) },
    reservation: { count: vi.fn(async () => reservationCounts.shift() ?? 0) },
  } as unknown as PrismaClient;
}

describe('measureVoiceTranscriptCoverage', () => {
  it('retourne le ratio d’appels avec transcription et outcome', async () => {
    const db = makeDb({ call: [100, 4] });
    await expect(measureVoiceTranscriptCoverage(db)).resolves.toBeCloseTo(0.96, 5);
  });

  it('retourne null quand la fenêtre ne contient aucun appel', async () => {
    const db = makeDb({ call: [0, 0] });
    await expect(measureVoiceTranscriptCoverage(db)).resolves.toBeNull();
  });
});

describe('measureReservationConfirmationCoverage', () => {
  it('retourne le ratio de réservations avec trace d’envoi', async () => {
    const db = makeDb({ reservation: [200, 1] });
    await expect(measureReservationConfirmationCoverage(db)).resolves.toBeCloseTo(0.995, 5);
  });

  it('retourne null sans réservation confirmée dans la fenêtre', async () => {
    const db = makeDb({ reservation: [0, 0] });
    await expect(measureReservationConfirmationCoverage(db)).resolves.toBeNull();
  });
});

describe('measureBusinessSloInputs', () => {
  it('mesure les deux SLO métier en parallèle', async () => {
    const db = makeDb({ call: [10, 0], reservation: [10, 2] });
    await expect(measureBusinessSloInputs(db)).resolves.toEqual({
      voiceTranscriptCoverage: 1,
      reservationConfirmationCoverage: 0.8,
    });
  });

  it('dégrade en null si la base échoue, sans casser le tick', async () => {
    const db = {
      call: {
        count: vi.fn(async () => {
          throw new Error('db down');
        }),
      },
      reservation: {
        count: vi.fn(async () => {
          throw new Error('db down');
        }),
      },
    } as unknown as PrismaClient;

    await expect(measureBusinessSloInputs(db)).resolves.toEqual({
      voiceTranscriptCoverage: null,
      reservationConfirmationCoverage: null,
    });
  });
});

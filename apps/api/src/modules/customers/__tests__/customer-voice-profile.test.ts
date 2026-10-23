import { describe, expect, it, vi } from 'vitest';
import {
  latestReservationName,
  selectVoicePreferences,
  summarizeVisitHistory,
} from '../customer-voice-profile';

vi.mock('../../../shared/db/client', () => ({ db: {} }));

const now = new Date('2026-10-21T12:00:00.000Z');

function reservation(state: string, iso: string, partySize = 2) {
  return { state, startsAt: new Date(iso), reservedAt: new Date(iso), partySize };
}

describe('summarizeVisitHistory', () => {
  it('compte les visites passées, pas les annulations, absences ni réservations futures', () => {
    const summary = summarizeVisitHistory(
      [
        reservation('HONORED', '2026-09-12T18:30:00.000Z', 4),
        reservation('CONFIRMED', '2026-10-01T18:30:00.000Z', 2),
        reservation('SEATED', '2026-10-18T18:30:00.000Z', 6),
        reservation('CANCELLED', '2026-10-05T18:30:00.000Z'),
        reservation('NO_SHOW', '2026-10-08T18:30:00.000Z'),
        reservation('EXPIRED', '2026-10-09T18:30:00.000Z'),
        reservation('CONFIRMED', '2026-10-30T18:30:00.000Z', 3),
        reservation('PENDING', '2026-10-25T18:00:00.000Z', 5),
      ],
      now,
    );

    expect(summary.pastVisits).toBe(3);
    expect(summary.lastVisitAt).toBe('2026-10-18T18:30:00.000Z');
    expect(summary.typicalPartySize).toBe(4);
    expect(summary.upcomingReservation).toEqual({
      startsAt: '2026-10-25T18:00:00.000Z',
      partySize: 5,
    });
  });

  it('une réservation à venir annulée ne compte pas comme réservation à venir', () => {
    const summary = summarizeVisitHistory(
      [reservation('CANCELLED', '2026-10-25T18:00:00.000Z')],
      now,
    );
    expect(summary).toEqual({
      pastVisits: 0,
      lastVisitAt: null,
      upcomingReservation: null,
      typicalPartySize: null,
    });
  });

  it('utilise reservedAt quand startsAt manque', () => {
    const summary = summarizeVisitHistory(
      [
        {
          state: 'HONORED',
          startsAt: null,
          reservedAt: new Date('2026-08-01T19:00:00Z'),
          partySize: 2,
        },
      ],
      now,
    );
    expect(summary.pastVisits).toBe(1);
  });
});

describe('selectVoicePreferences', () => {
  const base = { source: 'MANUAL', confirmedAt: null, expiresAt: null };

  it("garde les saisies de l'équipe et les suggestions vocales confirmées", () => {
    const selected = selectVoicePreferences(
      [
        { ...base, key: 'preferred_section', value: 'terrasse' },
        { ...base, key: 'dietary_restrictions', value: ['sans gluten', 'sans lactose'] },
        {
          ...base,
          key: 'occasion_type',
          value: 'anniversaire',
          source: 'VOICE_SUGGESTION',
          confirmedAt: new Date('2026-10-01T00:00:00Z'),
        },
      ],
      now,
    );
    expect(selected).toEqual([
      { key: 'preferred_section', value: 'terrasse' },
      { key: 'dietary_restrictions', value: 'sans gluten, sans lactose' },
      { key: 'occasion_type', value: 'anniversaire' },
    ]);
  });

  it('écarte suggestions non confirmées, préférences expirées, clés inconnues et objets', () => {
    const selected = selectVoicePreferences(
      [
        { ...base, key: 'dietary_restrictions', value: 'vegan', source: 'VOICE_SUGGESTION' },
        {
          ...base,
          key: 'preferred_table',
          value: '12',
          expiresAt: new Date('2026-10-20T00:00:00Z'),
        },
        { ...base, key: 'favorite_wine', value: 'Brouilly' },
        { ...base, key: 'group_pattern', value: { size: 4 } },
        { ...base, key: 'preferred_language', value: '   ' },
      ],
      now,
    );
    expect(selected).toEqual([]);
  });

  it('borne une valeur trop longue', () => {
    const [selected] = selectVoicePreferences(
      [{ ...base, key: 'accessibility_needs', value: 'x'.repeat(300) }],
      now,
    );
    expect(selected.value.length).toBe(121);
    expect(selected.value.endsWith('…')).toBe(true);
  });
});

describe('latestReservationName', () => {
  it('prend le nom le plus récent en ignorant les vides et les placeholders de salle', () => {
    expect(
      latestReservationName([
        { customerName: '  ' },
        { customerName: 'Sans réservation' },
        { customerName: 'Walk-in' },
        { customerName: ' Hamza   Akkif ' },
        { customerName: 'Ancien Nom' },
      ]),
    ).toBe('Hamza Akkif');
  });

  it('aucun nom utilisable → null', () => {
    expect(latestReservationName([{ customerName: null }, {}])).toBeNull();
  });
});

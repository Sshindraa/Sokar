import { describe, expect, it } from 'vitest';
import { CheckAvailabilityInputSchema } from '../schemas';
import { parseMcpDateRange, parseMcpDateTime } from '../date-time';

describe('MCP date-time contract', () => {
  it('convertit une heure locale Europe/Paris en instant UTC', () => {
    expect(parseMcpDateTime('2026-09-10T20:00:00', 'Europe/Paris')?.toISOString()).toBe(
      '2026-09-10T18:00:00.000Z',
    );
  });

  it('applique le bon offset en hiver', () => {
    expect(parseMcpDateTime('2026-01-10T20:00', 'Europe/Paris')?.toISOString()).toBe(
      '2026-01-10T19:00:00.000Z',
    );
  });

  it('conserve les valeurs qui portent déjà un offset', () => {
    expect(parseMcpDateTime('2026-09-10T20:00:00+02:00', 'Europe/Paris')?.toISOString()).toBe(
      '2026-09-10T18:00:00.000Z',
    );
  });

  it('rejette une date calendaire impossible et un horaire DST inexistant', () => {
    expect(parseMcpDateTime('2026-02-30T20:00:00', 'Europe/Paris')).toBeNull();
    expect(parseMcpDateTime('2026-03-29T02:30:00', 'Europe/Paris')).toBeNull();
  });

  it('valide l’ordre de la plage et le fuseau demandé', () => {
    expect(
      parseMcpDateRange({
        start: '2026-09-10T20:00:00',
        end: '2026-09-10T22:00:00',
        timezone: 'Europe/Paris',
      }),
    ).toMatchObject({ ok: true, timezone: 'Europe/Paris' });

    expect(
      parseMcpDateRange({
        start: '2026-09-10T22:00:00',
        end: '2026-09-10T20:00:00',
        timezone: 'Europe/Paris',
      }),
    ).toMatchObject({ ok: false, code: 'INVALID_DATETIME' });

    expect(
      parseMcpDateRange({
        start: '2026-09-10T20:00:00',
        end: '2026-09-10T22:00:00',
        timezone: 'Mars/Olympus',
      }),
    ).toMatchObject({ ok: false, code: 'INVALID_DATETIME' });
  });

  it('expose le format local et le champ timezone dans le schéma MCP', () => {
    expect(
      CheckAvailabilityInputSchema.safeParse({
        restaurantId: '550e8400-e29b-41d4-a716-446655440000',
        partySize: 2,
        slotStart: '2026-09-10T20:00:00',
        slotEnd: '2026-09-10T22:00:00',
        timezone: 'Europe/Paris',
      }).success,
    ).toBe(true);
  });
});

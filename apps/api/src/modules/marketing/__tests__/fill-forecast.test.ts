import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../shared/db/client', () => ({ db: {} }));

import { forecastEmptyPlaces, type ForecastRow } from '../fill-forecast';

const NOW = new Date('2026-11-02T10:00:00Z');
const base = { date: '2026-11-04', service: 'soir' as const, now: NOW };
// Délai visé : mercredi 4 nov 18 h Paris (17:00Z) − lundi 2 nov 10:00Z = 2 j 7 h.
const LEAD_MS = new Date('2026-11-04T17:00:00Z').getTime() - NOW.getTime();

/** Un mercredi soir passé (weeksAgo semaines avant le 4 nov) : `late` couverts créés tard, 2 tôt. */
function service(weeksAgo: number, late: number): ForecastRow[] {
  const day = new Date(Date.UTC(2026, 10, 4 - 7 * weeksAgo));
  const reservedAt = new Date(day.getTime() + 18 * 3600_000 - 3600_000); // 17:00Z : 18 h Paris en hiver, 19 h en été, dans le service du soir dans les deux cas
  const start = reservedAt.getTime();
  const rows: ForecastRow[] = [
    { reservedAt, createdAt: new Date(start - LEAD_MS - 86_400_000), partySize: 2 },
  ];
  if (late > 0)
    rows.push({ reservedAt, createdAt: new Date(start - LEAD_MS + 60_000), partySize: late });
  return rows;
}

const weeks = (lates: number[]) => lates.flatMap((late, i) => service(i + 1, late));

describe('forecastEmptyPlaces', () => {
  it('médiane de 4 services [2, 4, 6, 8] arrivées tardives -> 5, source historique', () => {
    const r = forecastEmptyPlaces({ ...base, rows: weeks([2, 4, 6, 8]), freePlaces: 20 });
    expect(r).toEqual({ emptyPlaces: 15, lateArrivals: 5, forecastSource: 'historique' });
  });

  it('3 services comparables seulement -> source simple', () => {
    const r = forecastEmptyPlaces({ ...base, rows: weeks([2, 4, 6]), freePlaces: 20 });
    expect(r).toEqual({ emptyPlaces: 20, lateArrivals: 0, forecastSource: 'simple' });
  });

  it('ne garde que les 8 services les plus récents', () => {
    // 8 récents à 1, puis 4 anciens à 50 : la médiane ignore les anciens.
    const r = forecastEmptyPlaces({
      ...base,
      rows: weeks([1, 1, 1, 1, 1, 1, 1, 1, 50, 50, 50, 50]),
      freePlaces: 20,
    });
    expect(r.lateArrivals).toBe(1);
  });

  it('ignore une réservation créée avant le seuil', () => {
    const rows = weeks([0, 0, 0, 0]); // seulement des réservations anticipées
    const r = forecastEmptyPlaces({ ...base, rows, freePlaces: 20 });
    expect(r).toMatchObject({ lateArrivals: 0, forecastSource: 'historique', emptyPlaces: 20 });
  });

  it('ignore un autre jour de semaine et l autre service', () => {
    const other = weeks([9, 9, 9, 9]).map((r) => ({
      ...r,
      reservedAt: new Date(r.reservedAt.getTime() + 86_400_000), // jeudi
    }));
    const midi = weeks([9, 9, 9, 9]).map((r) => ({
      ...r,
      reservedAt: new Date(r.reservedAt.getTime() - 6 * 3600_000), // midi
    }));
    const r = forecastEmptyPlaces({ ...base, rows: [...other, ...midi], freePlaces: 20 });
    expect(r.forecastSource).toBe('simple');
  });

  it('une semaine sans réservation ne compte pas comme comparable', () => {
    const rows = [...service(1, 4), ...service(2, 4), ...service(4, 4), ...service(5, 4)];
    const r = forecastEmptyPlaces({ ...base, rows, freePlaces: 20 });
    expect(r).toMatchObject({ forecastSource: 'historique', lateArrivals: 4 });
  });

  it('jamais négatif', () => {
    const r = forecastEmptyPlaces({ ...base, rows: weeks([10, 10, 10, 10]), freePlaces: 3 });
    expect(r.emptyPlaces).toBe(0);
  });

  it('fenêtres justes à travers le changement d heure', () => {
    // Mercredis d'été (21, 14, 7 oct., 30 sept.) à 14:30Z = 16 h 30 Paris : dans la vraie fenêtre du
    // soir (début 16 h Paris = 14:00Z), hors d'une fenêtre naïve de 7 × 24 h qui débute à 15:00Z
    // (début du service cible, en heure d'hiver).
    const delayMs = new Date('2026-11-04T15:00:00Z').getTime() - NOW.getTime();
    const rows: ForecastRow[] = [0, 1, 2, 3].map((w) => {
      const at = new Date(Date.parse('2026-10-21T14:30:00Z') - w * 7 * 86_400_000);
      return { reservedAt: at, createdAt: new Date(at.getTime() - delayMs + 60_000), partySize: 3 };
    });
    const r = forecastEmptyPlaces({ ...base, rows, freePlaces: 20 });
    expect(r).toMatchObject({ forecastSource: 'historique', lateArrivals: 3 });
  });
});

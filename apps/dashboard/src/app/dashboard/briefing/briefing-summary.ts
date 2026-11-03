import type { Reservation, ServiceCard } from '@/types/api';

/** Réservations encore à servir ou en salle : annulées, absences et passées ne comptent pas. */
const UPCOMING_STATES = new Set(['PENDING', 'CONFIRMED', 'SEATED']);

export interface BriefingRow {
  reservation: Reservation;
  card: ServiceCard | undefined;
}

export interface BriefingSummary {
  reservations: number;
  covers: number;
  allergies: number;
  regulars: number;
  occasions: number;
  noShowRisks: number;
}

/** Les réservations à servir, par heure. */
export function upcomingReservations(reservations: Reservation[]): Reservation[] {
  return reservations
    .filter((reservation) => UPCOMING_STATES.has(reservation.state ?? reservation.status))
    .sort((a, b) => new Date(a.reservedAt).getTime() - new Date(b.reservedAt).getTime());
}

/** Chiffres du haut de page : un signal compte une fois par réservation. */
export function summarizeBriefing(rows: BriefingRow[]): BriefingSummary {
  const summary: BriefingSummary = {
    reservations: rows.length,
    covers: 0,
    allergies: 0,
    regulars: 0,
    occasions: 0,
    noShowRisks: 0,
  };
  for (const { reservation, card } of rows) {
    summary.covers += reservation.partySize;
    const kinds = new Set(card?.badges.map((badge) => badge.kind));
    if (kinds.has('allergy')) summary.allergies += 1;
    if (kinds.has('regular')) summary.regulars += 1;
    if (kinds.has('occasion')) summary.occasions += 1;
    if (kinds.has('no_show_risk')) summary.noShowRisks += 1;
  }
  return summary;
}

import type { ReservationChannel } from '@prisma/client';

/**
 * Canaux présentés au restaurateur dans « Réservations par canal ». Le canal technique
 * (`Reservation.channel`) ne suffit pas : une réservation Connect est `WEB` qu'elle vienne du site du
 * restaurant, de Google ou d'un clic depuis ChatGPT ; `source` porte cette provenance.
 */
export const RESERVATION_CHANNEL_GROUPS = ['phone', 'website', 'google', 'ai', 'team'] as const;
export type ReservationChannelGroup = (typeof RESERVATION_CHANNEL_GROUPS)[number];

const AI_WEB_SOURCES = new Set(['chatgpt', 'perplexity', 'bing']);

export function reservationChannelGroup(reservation: {
  channel: ReservationChannel;
  source: string | null;
}): ReservationChannelGroup {
  switch (reservation.channel) {
    case 'PHONE':
      return 'phone';
    case 'MCP':
    case 'OPENAI_RESERVE':
    case 'API':
      return 'ai';
    case 'ADMIN':
      return 'team';
    case 'WEB': {
      const source = reservation.source?.toLowerCase() ?? '';
      if (source === 'google') return 'google';
      if (AI_WEB_SOURCES.has(source)) return 'ai';
      return 'website';
    }
    default:
      return 'website';
  }
}

export interface ReservationChannelStat {
  channel: ReservationChannelGroup;
  reservations: number;
  covers: number;
}

/** Toujours les cinq canaux, dans le même ordre, pour un affichage stable même à zéro. */
export function summarizeReservationChannels(
  reservations: Array<{ channel: ReservationChannel; source: string | null; partySize: number }>,
): ReservationChannelStat[] {
  const stats = new Map<ReservationChannelGroup, ReservationChannelStat>(
    RESERVATION_CHANNEL_GROUPS.map((channel) => [channel, { channel, reservations: 0, covers: 0 }]),
  );
  for (const reservation of reservations) {
    const stat = stats.get(reservationChannelGroup(reservation))!;
    stat.reservations += 1;
    stat.covers += reservation.partySize;
  }
  return [...stats.values()];
}

import { db } from '../../shared/db/client';
import { sendSms } from '../../shared/telnyx/client';
import { ReservationService } from '../reservations/reservation.service';
import { logger } from '../../shared/logger/pino';

/**
 * Parser et handler partagés pour les réponses entrantes SMS et WhatsApp.
 *
 * Le client reçoit un rappel J-1. S'il répond NON, on annule la résa.
 * S'il répond OUI, on marque comme confirmé (bonus, pas requis).
 * Pas de réponse = normal, la résa reste confirmée.
 */

const POSITIVE_PATTERNS = /\b(oui|ok|confirme?|yes|ouais)\b/i;
const NEGATIVE_PATTERNS = /\b(non|annul\w*|cancel\w*|no\b)\b/i;

export type ReplyIntent = 'CONFIRMED' | 'CANCELLED' | 'UNKNOWN';

export function parseReply(text: string): ReplyIntent {
  const trimmed = text.trim();
  if (POSITIVE_PATTERNS.test(trimmed)) return 'CONFIRMED';
  if (NEGATIVE_PATTERNS.test(trimmed)) return 'CANCELLED';
  return 'UNKNOWN';
}

export interface HandleReplyResult {
  intent: ReplyIntent;
  reservationId?: string;
  action?: 'confirmed' | 'cancelled' | 'no_reservation';
}

/**
 * Traite une réponse entrante d'un client (SMS ou WhatsApp).
 *
 * @param from Numéro du client (E.164)
 * @param text Texte de la réponse
 * @param channel Canal d'origine ('sms' | 'whatsapp') — pour logging
 * @returns Résultat du traitement
 */
export async function handleReply(
  from: string,
  text: string,
  channel: 'sms' | 'whatsapp',
): Promise<HandleReplyResult> {
  const intent = parseReply(text);

  if (intent === 'UNKNOWN') {
    logger.info({ from, text, channel }, 'inbound reply: unparseable, ignoring');
    return { intent };
  }

  // Fenêtre de recherche élargie : [hier 00:00, J+1 23:59]
  // Couvre les edge cases :
  // - client répond J+1 pour une résa d'hier (résa hors fenêtre = pas matchée, OK)
  // - client répond tard le J-1 pour une résa du lendemain
  // - client répond tôt le jour J pour une résa du soir
  const now = new Date();
  const yesterdayStart = new Date(now);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  yesterdayStart.setHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(now);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
  tomorrowEnd.setHours(23, 59, 59, 999);

  const reservation = await db.reservation.findFirst({
    where: {
      customerPhone: from,
      status: 'CONFIRMED',
      confirmationStatus: 'PENDING',
      reservedAt: { gte: yesterdayStart, lte: tomorrowEnd },
    },
    include: {
      restaurant: { select: { id: true, name: true, managerPhone: true } },
    },
  });

  if (!reservation) {
    logger.info({ from, channel }, 'inbound reply: no pending reservation found');
    return { intent, action: 'no_reservation' };
  }

  if (intent === 'CONFIRMED') {
    await db.reservation.update({
      where: { id: reservation.id },
      data: {
        confirmationStatus: 'CONFIRMED',
        confirmedAt: new Date(),
      },
    });
    logger.info(
      { reservationId: reservation.id, from, channel },
      'reservation confirmed via reply',
    );
    return { intent, reservationId: reservation.id, action: 'confirmed' };
  }

  // intent === 'CANCELLED'
  try {
    await ReservationService.update(reservation.id, reservation.restaurantId, {
      status: 'CANCELLED',
    });
    await db.reservation.update({
      where: { id: reservation.id },
      data: {
        confirmationStatus: 'CANCELLED',
        confirmedAt: new Date(),
      },
    });

    // SMS au gérant : table libérée
    if (reservation.restaurant.managerPhone) {
      const dateStr = reservation.reservedAt.toLocaleDateString('fr-FR', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
      const timeStr = reservation.reservedAt.toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      });
      await sendSms(
        reservation.restaurant.managerPhone,
        `✅ Table libérée : ${reservation.customerName} a annulé sa résa de ${dateStr} ${timeStr} (${reservation.partySize} pers.) via ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}.`,
      );
    }

    logger.info(
      { reservationId: reservation.id, from, channel },
      'reservation cancelled via reply',
    );
    return { intent, reservationId: reservation.id, action: 'cancelled' };
  } catch (err: any) {
    logger.error(
      { err: err.message, reservationId: reservation.id, channel },
      'failed to cancel reservation via reply',
    );
    return { intent, reservationId: reservation.id };
  }
}

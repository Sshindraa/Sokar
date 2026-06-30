import { FastifyInstance } from 'fastify';
import { telnyxWebhookGuard } from '../voice/telnyx.guard';
import { db } from '../../shared/db/client';
import { sendSms } from '../../shared/telnyx/client';
import { ReservationService } from '../reservations/reservation.service';
import { logger } from '../../shared/logger/pino';

/**
 * Handler pour les SMS entrants de Telnyx (réponses clients).
 *
 * Quand un client répond OUI / NON au SMS de confirmation J-1,
 * Telnyx envoie un webhook `message.received` ici.
 *
 * Logique :
 * 1. Parser le texte (OUI/CONFIRME/OK → confirmé, NON/ANNUL/CANCEL → annulé)
 * 2. Trouver la réservation PENDING par numéro de téléphone + date du jour
 * 3. Mettre à jour le statut de confirmation
 * 4. Si annulé → status = CANCELLED + SMS au gérant
 */

const POSITIVE_PATTERNS = /\b(oui|ok|confirme?|yes|oui\b|ouais)\b/i;
const NEGATIVE_PATTERNS = /\b(non|annul\w*|cancel\w*|no\b|non\b)\b/i;

function parseReply(text: string): 'CONFIRMED' | 'CANCELLED' | 'UNKNOWN' {
  const trimmed = text.trim();
  if (POSITIVE_PATTERNS.test(trimmed)) return 'CONFIRMED';
  if (NEGATIVE_PATTERNS.test(trimmed)) return 'CANCELLED';
  return 'UNKNOWN';
}

export async function smsInboundRoutes(app: FastifyInstance) {
  app.post('/sms/telnyx/inbound', { preHandler: telnyxWebhookGuard }, async (req, reply) => {
    const body = req.body as any;
    const eventType = body?.data?.event_type;
    const payload = body?.data?.payload;

    if (eventType !== 'message.received') {
      return reply.send({ result: 'ignored' });
    }

    const from = payload?.from;
    const text = payload?.text;

    if (!from || !text) {
      req.log.warn({ from, hasText: !!text }, 'sms inbound: missing from or text');
      return reply.send({ result: 'ok' });
    }

    req.log.info({ from, textLength: text?.length }, 'sms inbound received');

    const intent = parseReply(text);

    if (intent === 'UNKNOWN') {
      req.log.info({ from, text }, 'sms inbound: unparseable reply, ignoring');
      return reply.send({ result: 'ok' });
    }

    // Trouver la réservation PENDING pour ce numéro, pour aujourd'hui ou demain
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowEnd = new Date(now);
    tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
    tomorrowEnd.setHours(23, 59, 59, 999);

    const reservation = await db.reservation.findFirst({
      where: {
        customerPhone: from,
        status: 'CONFIRMED',
        confirmationStatus: 'PENDING',
        reservedAt: { gte: todayStart, lte: tomorrowEnd },
      },
      include: {
        restaurant: { select: { id: true, name: true, managerPhone: true } },
      },
    });

    if (!reservation) {
      req.log.info({ from }, 'sms inbound: no pending reservation found for this number');
      return reply.send({ result: 'ok' });
    }

    if (intent === 'CONFIRMED') {
      await db.reservation.update({
        where: { id: reservation.id },
        data: {
          confirmationStatus: 'CONFIRMED',
          confirmedAt: new Date(),
        },
      });
      req.log.info({ reservationId: reservation.id, from }, 'reservation confirmed via SMS');
      return reply.send({ result: 'ok' });
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
          `✅ Table libérée : ${reservation.customerName} a annulé sa résa de ${dateStr} ${timeStr} (${reservation.partySize} pers.) via SMS de confirmation.`,
        );
      }

      req.log.info({ reservationId: reservation.id, from }, 'reservation cancelled via SMS');
    } catch (err: any) {
      logger.error(
        { err: err.message, reservationId: reservation.id },
        'failed to cancel reservation via SMS reply',
      );
    }

    return reply.send({ result: 'ok' });
  });
}

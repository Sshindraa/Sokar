import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { utcToZonedParts } from '../../shared/timezone/restaurant-time';
import {
  isReservationManagementEnabled,
  parseReservationManagementToken,
  verifyReservationManagementToken,
} from './reservation-management';

export async function reservationManagementRoutes(app: FastifyInstance) {
  app.post(
    '/public/reservation-management',
    {
      logLevel: 'silent',
      bodyLimit: 2048,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
      if (!isReservationManagementEnabled())
        return reply.code(404).send({ error: 'Lien indisponible.' });
      const input = z
        .object({ token: z.string().max(100), action: z.enum(['view', 'withdraw_whatsapp']) })
        .strict()
        .safeParse(req.body);
      if (!input.success) return reply.code(400).send({ error: 'Demande invalide.' });
      const parsed = parseReservationManagementToken(input.data.token);
      if (!parsed) return reply.code(404).send({ error: 'Lien invalide ou expiré.' });
      try {
        const row = await db.reservation.findUnique({
          where: { id: parsed.id },
          include: {
            restaurant: {
              select: { name: true, timezone: true, phoneNumber: true, formattedAddress: true },
            },
          },
        });
        if (!row || !verifyReservationManagementToken(input.data.token, row))
          return reply.code(404).send({ error: 'Lien invalide ou expiré.' });
        const consents =
          row.consents && typeof row.consents === 'object' && !Array.isArray(row.consents)
            ? row.consents
            : {};
        const whatsapp = (consents as Record<string, unknown>).transactionalWhatsapp === true;
        if (input.data.action === 'withdraw_whatsapp' && whatsapp) {
          const result = await db.reservation.updateMany({
            where: {
              id: row.id,
              restaurantId: row.restaurantId,
              consents: { equals: consents },
            },
            data: {
              consents: {
                ...consents,
                transactionalWhatsapp: false,
                whatsappWithdrawnAt: new Date().toISOString(),
              },
            },
          });
          if (result.count !== 1)
            return reply.code(409).send({ error: 'La réservation a changé. Veuillez réessayer.' });
        }
        const local = utcToZonedParts(row.startsAt ?? row.reservedAt, row.restaurant.timezone);
        return reply.send({
          restaurantName: row.restaurant.name,
          restaurantAddress: row.restaurant.formattedAddress ?? null,
          startsAt: (row.startsAt ?? row.reservedAt).toISOString(),
          endsAt: row.endsAt?.toISOString() ?? null,
          restaurantPhone: /^\+?[0-9 ()-]{6,24}$/.test(row.restaurant.phoneNumber)
            ? row.restaurant.phoneNumber
            : null,
          date: local.date,
          time: local.time,
          partySize: row.partySize,
          state: row.state,
          whatsappReminder: {
            visible: row.channel === 'WEB' && (whatsapp || 'whatsappConsentProof' in consents),
            enabled: input.data.action === 'withdraw_whatsapp' ? false : whatsapp,
          },
        });
      } catch {
        return reply.code(503).send({ error: 'Service indisponible. Veuillez réessayer.' });
      }
    },
  );
}

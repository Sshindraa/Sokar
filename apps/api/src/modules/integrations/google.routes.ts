import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { requireOrg } from '../../plugins/clerk';
import { GoogleCalendarClient } from '../../shared/google-calendar/client';
import { logger } from '../../shared/logger/pino';

/**
 * Dashboard public où ramener le restaurateur après Google (`DASHBOARD_URL`). L'ancien calcul dérivait
 * l'adresse de `PUBLIC_URL` (api.sokar.tech → app.sokar.tech) : un hôte que rien ne sert, donc une
 * page 404 à la fin de chaque connexion réussie.
 */
export function dashboardBase(environment: NodeJS.ProcessEnv = process.env): string {
  return (environment.DASHBOARD_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}

export async function googleRoutes(app: FastifyInstance) {
  // Initiate OAuth flow
  app.get(
    '/integrations/google-calendar/auth',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const restaurantId = req.restaurantId!;
      const authUrl = GoogleCalendarClient.getAuthUrl(restaurantId);
      return reply.send({ url: authUrl });
    },
  );

  // OAuth Callback
  app.get('/integrations/google-calendar/callback', async (req, reply) => {
    const querySchema = z.object({
      code: z.string(),
      state: z.string(), // state holds restaurantId
    });

    try {
      const { code, state } = querySchema.parse(req.query);
      const restaurantId = GoogleCalendarClient.resolveSignedState(state);

      const { refreshToken, googleCalendarId } =
        await GoogleCalendarClient.exchangeCodeForTokens(code);

      await db.restaurant.update({
        where: { id: restaurantId },
        data: {
          googleRefreshToken: refreshToken,
          googleCalendarId: googleCalendarId || 'primary',
        },
      });

      logger.info({ restaurantId }, '[GoogleCalendar] Successfully connected Google Calendar');

      // Retour dans les réglages du dashboard.
      return reply.redirect(`${dashboardBase()}/dashboard/settings?google_sync=success`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, '[GoogleCalendar] OAuth Callback failed');
      // Le détail reste dans les journaux : il n'a pas sa place dans une URL, ni sous les yeux du
      // restaurateur.
      return reply.redirect(`${dashboardBase()}/dashboard/settings?google_sync=error`);
    }
  });

  // Disconnect Google Calendar
  app.post(
    '/integrations/google-calendar/disconnect',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const restaurantId = req.restaurantId!;

      try {
        await db.restaurant.update({
          where: { id: restaurantId },
          data: {
            googleRefreshToken: null,
            googleCalendarId: null,
          },
        });

        logger.info({ restaurantId }, '[GoogleCalendar] Successfully disconnected Google Calendar');
        return reply.send({ success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message }, '[GoogleCalendar] Disconnection failed');
        return reply.status(500).send({ error: 'Failed to disconnect integration', message });
      }
    },
  );
}

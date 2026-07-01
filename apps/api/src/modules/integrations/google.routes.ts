import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { requireOrg } from '../../plugins/clerk';
import { GoogleCalendarClient } from '../../shared/google-calendar/client';
import { logger } from '../../shared/logger/pino';

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

      // Redirect back to frontend settings dashboard
      const publicUrl = process.env.PUBLIC_URL || 'http://localhost:4000';
      // If running on localhost default: API is on 4000, Web is on 3000
      const frontendUrl = publicUrl.includes('localhost:4000')
        ? 'http://localhost:3000'
        : publicUrl.replace('/api', '').replace('api.', 'app.');

      return reply.redirect(`${frontendUrl}/dashboard/settings?google_sync=success`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, '[GoogleCalendar] OAuth Callback failed');
      const publicUrl = process.env.PUBLIC_URL || 'http://localhost:4000';
      const frontendUrl = publicUrl.includes('localhost:4000')
        ? 'http://localhost:3000'
        : publicUrl;
      return reply.redirect(
        `${frontendUrl}/dashboard/settings?google_sync=error&message=${encodeURIComponent(message)}`,
      );
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

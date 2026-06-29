/**
 * Routes admin — funnel d'onboarding.
 *
 * GET /admin/onboarding-funnel  : agrège les onboarding_events en funnel
 *   de conversion par étape. Permet de mesurer le taux de complétion
 *   avant/après les changements (aha moment, pre-permission, etc.).
 *
 * Retourne :
 *   - totalRestaurants : nombre de restaurants ayant au moins 1 event
 *   - steps : par étape, le count d'events started/completed/skipped/blocked
 *   - demoCallPlayed : count d'events onboarding_demo_call_played
 *   - conversionRates : % de restaurants ayant complété chaque étape
 *     parmi ceux qui l'ont started
 *
 * Auth : requireOrg() (Clerk). Lecture seule.
 */

import { FastifyInstance } from 'fastify';
import { requireOrg } from '../../plugins/clerk';
import { db } from '../../shared/db/client';

const STEP_ORDER = [
  'restaurant',
  'hours',
  'knowledge',
  'calendar',
  'phone',
  'connect-identity',
  'connect-location',
  'connect-cuisine',
  'connect-capacity',
  'connect-activation',
] as const;

export async function onboardingFunnelRoutes(app: FastifyInstance) {
  app.get('/admin/onboarding-funnel', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = req.restaurantId as string;

    try {
      const events = await db.onboardingEvent.findMany({
        where: { restaurantId },
        select: { event: true, task: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });

      // Agrégation par étape
      const steps = STEP_ORDER.map((stepKey) => {
        const stepEvents = events.filter((e) => e.task === stepKey);
        return {
          step: stepKey,
          started: stepEvents.filter((e) => e.event === 'onboarding_step_started').length,
          completed: stepEvents.filter((e) => e.event === 'onboarding_step_completed').length,
          skipped: stepEvents.filter((e) => e.event === 'onboarding_step_skipped').length,
          blocked: stepEvents.filter((e) => e.event === 'onboarding_step_blocked').length,
        };
      });

      // Events globaux (non liés à une étape spécifique)
      const activated = events.filter((e) => e.event === 'onboarding_activated').length;
      const firstCall = events.filter((e) => e.event === 'onboarding_first_call').length;
      const demoCallPlayed = events.filter((e) => e.event === 'onboarding_demo_call_played').length;

      // Rates de conversion : % completed parmi started
      const conversionRates = steps.map((s) => ({
        step: s.step,
        rate: s.started > 0 ? Math.round((s.completed / s.started) * 100) : 0,
      }));

      // Funnel global : % de restaurants ayant complété chaque étape
      // parmi le total d'étapes started (premier event = entrée dans le funnel)
      const totalStarted = steps[0]?.started ?? 0;

      return reply.send({
        restaurantId,
        totalEvents: events.length,
        totalStarted,
        steps,
        conversionRates,
        milestones: {
          activated,
          firstCall,
          demoCallPlayed,
        },
        funnelCompletionRate:
          totalStarted > 0
            ? Math.round((steps.filter((s) => s.completed > 0).length / STEP_ORDER.length) * 100)
            : 0,
      });
    } catch (err) {
      req.log.error({ err, restaurantId }, 'onboarding-funnel: failed to aggregate events');
      return reply.status(500).send({ error: 'Failed to read onboarding funnel' });
    }
  });
}

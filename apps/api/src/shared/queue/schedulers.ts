/**
 * Inscription des jobs récurrents (BullMQ job schedulers).
 *
 * Extrait de `main.ts` pour que le même code serve les deux topologies :
 *  - développement : le process API démarre aussi les workers
 *    (`RUN_WORKERS_IN_PROCESS=true`) ;
 *  - production : le process `dist/worker.js` (PM2 `sokar-workers`) porte les
 *    workers et les schedulers, l'API ne fait que servir le HTTP.
 *
 * `upsertJobScheduler` est idempotent par identifiant : rejouer l'inscription
 * ne crée pas de doublon, et deux process ne se marchent pas dessus.
 */

import { db } from '../db/client';
import { logger } from '../logger/pino';
import { queues } from './queues';

export async function registerJobSchedulers(): Promise<void> {
  // Chaque scheduler est inscrit dans son propre try/catch pour qu'un
  // échec (ex: DB pas prête au boot) n'empêche pas l'inscription des
  // autres. Sans ça, une seule upsertJobScheduler qui throw avorte
  // silencieusement les 10+ schedulers suivants → alertes system-health
  // qui disparaissent au prochain restart PM2.
  const register = (label: string, fn: () => Promise<unknown>): Promise<void> =>
    fn()
      .then(() => {})
      .catch((err) => {
        logger.error({ err, scheduler: label }, 'Failed to register scheduler (non-blocking)');
      });

  // Evening-report : un scheduler par restaurant (boucle).
  try {
    // tenant-scoping: global — planification : un rapport par établissement.
    const restaurants = await db.restaurant.findMany({ select: { id: true } });
    for (const r of restaurants) {
      await register(`evening-report/${r.id}`, () =>
        queues.eveningReport.upsertJobScheduler(
          `nightly-${r.id}`,
          { pattern: '0 23 * * *', tz: 'Europe/Paris' },
          { name: 'nightly', data: { restaurantId: r.id } },
        ),
      );
    }
  } catch (err) {
    logger.error({ err }, 'Failed to load restaurants for evening-report schedulers');
  }

  await register('reconciliation/calls', () =>
    queues.reconciliation.upsertJobScheduler(
      'daily-call-reconciliation',
      { pattern: '20 3 * * *', tz: 'Europe/Paris' },
      { name: 'calls', data: { kind: 'calls' } },
    ),
  );
  await register('reconciliation/sms', () =>
    queues.reconciliation.upsertJobScheduler(
      'daily-sms-reconciliation',
      { pattern: '35 3 * * *', tz: 'Europe/Paris' },
      { name: 'sms', data: { kind: 'sms' } },
    ),
  );

  // SMS de rappel J-1 : envoie les SMS à 17h chaque jour
  await register('confirmation-sms/scan', () =>
    queues.confirmationSms.upsertJobScheduler(
      'daily-confirmation-scan',
      { pattern: '0 17 * * *', tz: 'Europe/Paris' },
      { name: 'confirmation-scan', data: { kind: 'scan' } },
    ),
  );

  // Rappel expiration carte cadeau : scan quotidien à 9h
  await register('gift-card-reminder/daily', () =>
    queues.giftCardReminder.upsertJobScheduler(
      'daily-gift-card-reminder',
      { pattern: '0 9 * * *', tz: 'Europe/Paris' },
      { name: 'gift-card-reminder-scan', data: { kind: 'scan' } },
    ),
  );

  // Réactivation VIP dormant : scan hebdo le lundi à 10h
  await register('reactivation/scan', () =>
    queues.reactivation.upsertJobScheduler(
      'weekly-vip-reactivation',
      { pattern: '0 10 * * 1', tz: 'Europe/Paris' },
      { name: 'reactivation-scan', data: { kind: 'scan' } },
    ),
  );

  // Automatisations marketing Pro : scan horaire à :15. Le worker
  // crée des campagnes snapshot mais ne met aucun fournisseur en jeu
  // tant que MARKETING_SENDS_ENABLED reste désactivé.
  await register('marketing-automation/hourly', () =>
    queues.marketingAutomation.upsertJobScheduler(
      'hourly-marketing-automation-scan',
      { pattern: '15 * * * *', tz: 'Europe/Paris' },
      { name: 'automation-scan', data: { kind: 'scan' } },
    ),
  );

  // Réconciliation des callbacks provider reçus avant la CampaignMessage :
  // elle ne contacte jamais le provider et ne dépend pas du flag d'envoi.
  await register('marketing-provider-reconciliation/5min', () =>
    queues.marketingProviderReconciliation.upsertJobScheduler(
      'marketing-provider-reconciliation-5min',
      { pattern: '*/5 * * * *', tz: 'Europe/Paris' },
      { name: 'reconcile-provider-events', data: { limit: 100 } },
    ),
  );

  // Expiration des liens de retour client : toutes les 15 minutes. Ce
  // nettoyage ne contacte aucun fournisseur et reste sûr pendant le gel.
  await register('reputation-feedback-expiry/15min', () =>
    queues.reputationFeedbackExpiry.upsertJobScheduler(
      'reputation-feedback-expiry-15min',
      { pattern: '*/15 * * * *', tz: 'Europe/Paris' },
      { name: 'expire-feedback-requests', data: { limit: 500 } },
    ),
  );

  // Expiration des avantages émis : toutes les 15 minutes. Le worker ne
  // contacte aucun provider et ne modifie que les grants encore ISSUED.
  await register('loyalty-grant-expiry/15min', () =>
    queues.loyaltyGrantExpiry.upsertJobScheduler(
      'loyalty-grant-expiry-15min',
      { pattern: '*/15 * * * *', tz: 'Europe/Paris' },
      { name: 'expire-loyalty-grants', data: { limit: 1_000 } },
    ),
  );

  // Fermeture des sessions d’expérience terminées : toutes les 15 minutes.
  // Le worker ne contacte aucun fournisseur et ne modifie que les sessions
  // encore ouvertes dont la date de fin est passée.
  await register('experience-session-expiry/15min', () =>
    queues.experienceSessionExpiry.upsertJobScheduler(
      'experience-session-expiry-15min',
      { pattern: '*/15 * * * *', tz: 'Europe/Paris' },
      { name: 'expire-experience-sessions', data: { limit: 1_000 } },
    ),
  );

  // Fermeture des sessions d’événement terminées : toutes les 15 minutes.
  // Le worker ne contacte aucun fournisseur et expire aussi la liste
  // d’attente locale des sessions fermées.
  await register('event-session-expiry/15min', () =>
    queues.eventSessionExpiry.upsertJobScheduler(
      'event-session-expiry-15min',
      { pattern: '*/15 * * * *', tz: 'Europe/Paris' },
      { name: 'expire-event-sessions', data: { limit: 1_000 } },
    ),
  );

  // Alert evaluation : toutes les 5 minutes. Lit les métriques Prometheus,
  // compare avec le snapshot précédent (Redis), déclenche les alertes
  // Sentry avec cooldown 30 min. Cf. alert-evaluation.worker.ts.
  await register('alert-evaluation/5min', () =>
    queues.alertEvaluation.upsertJobScheduler(
      'alert-evaluation-5min',
      { pattern: '*/5 * * * *', tz: 'Europe/Paris' },
      { name: 'evaluate-alerts' },
    ),
  );

  // Monitoring système : toutes les 5 minutes. Checks métier (files
  // BullMQ, appels sans transcription, réservations sans SMS) dispatchés
  // sur les canaux ALERT_* avec cooldown 30 min. Cf. system-health.worker.ts.
  await register('system-health/5min', () =>
    queues.systemHealth.upsertJobScheduler(
      'system-health-5min',
      { pattern: '*/5 * * * *', tz: 'Europe/Paris' },
      { name: 'system-health-checks' },
    ),
  );

  // Les enregistrements sont privés et temporaires : purge quotidienne
  // des objets dont la rétention applicative est arrivée à échéance.
  await register('telnyx-webhooks/recordings-purge', () =>
    queues.telnyxWebhooks.upsertJobScheduler(
      'call-recordings-purge-daily',
      { pattern: '20 3 * * *', tz: 'Europe/Paris' },
      { name: 'purge-expired-recordings' },
    ),
  );

  // Nettoyage des holds expirés (filet de sécurité, RES-008).
  await register('hold-cleanup/5min', () =>
    queues.holdCleanup.upsertJobScheduler(
      'hold-cleanup-5min',
      { pattern: '*/5 * * * *', tz: 'Europe/Paris' },
      { name: 'cleanup-expired-holds', data: {} },
    ),
  );

  // Nettoyage des entrées de liste d'attente expirées (filet de sécurité).
  await register('waiting-list-cleanup/5min', () =>
    queues.waitingListCleanup.upsertJobScheduler(
      'waiting-list-cleanup-5min',
      { pattern: '*/5 * * * *', tz: 'Europe/Paris' },
      { name: 'cleanup-expired-waiting-list', data: {} },
    ),
  );

  // Purge quotidienne des clés idempotency expirées (RES-005).
  await register('idempotency-purge/daily', () =>
    queues.idempotencyPurge.upsertJobScheduler(
      'daily-idempotency-purge',
      { pattern: '0 4 * * *', tz: 'Europe/Paris' },
      { name: 'purge-expired', data: {} },
    ),
  );

  // Publication des événements Postgres vers BullMQ. Le dispatcher est
  // relançable : les événements restent PENDING si Redis est indisponible.
  await register('outbox-dispatcher/minute', () =>
    queues.outboxDispatcher.upsertJobScheduler(
      'outbox-dispatch-minute',
      { pattern: '* * * * *', tz: 'Europe/Paris' },
      { name: 'dispatch', data: { limit: 100 } },
    ),
  );

  // Projection reconstructible du ledger : une panne ou une correction
  // de tarif peut être rejouée sans muter les événements bruts.
  await register('usage-rollup/hourly', () =>
    queues.usageRollup.upsertJobScheduler(
      'usage-rollup-hourly',
      { pattern: '15 * * * *', tz: 'Europe/Paris' },
      { name: 'rebuild-current-month', data: {} },
    ),
  );

  // Seuils de suivi interne 70/90/100 %. Ce worker n'impose aucun quota
  // client et reste désactivé par défaut ; la vue de marge opérateur est
  // la source de suivi principale.
  await register('usage-alerts/hourly', () =>
    queues.usageAlerts.upsertJobScheduler(
      'usage-alerts-hourly',
      { pattern: '30 * * * *', tz: 'Europe/Paris' },
      { name: 'scan', data: {} },
    ),
  );

  // Anonymisation RGPD (rétention 2 ans) : quotidienne à 3h. Le scheduler
  // tourne même quand l'opération est désactivée ; c'est le worker qui
  // refuse d'agir sans `RGPD_ANONYMIZATION_ENABLED=true`.
  await register('rgpd-anonymization/daily', () =>
    queues.rgpdAnonymization.upsertJobScheduler(
      'rgpd-anonymization-daily',
      { pattern: '0 3 * * *', tz: 'Europe/Paris' },
      { name: 'rgpd-anonymization-daily', data: {} },
    ),
  );
}

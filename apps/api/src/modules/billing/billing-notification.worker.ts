import { Worker } from 'bullmq';
import { redisQueue } from '../../shared/redis/client';
import { db } from '../../shared/db/client';
import { sendEmail } from '../../shared/email';
import { setupWorkerListeners, jobLogger } from '../../shared/queue/workers/helper';
import type { MessagingUsageContext } from '../usage/messaging-usage.service';
import { resolveAccountOwnerEmail } from '../restaurants/account-email.service';
import {
  buildServiceSuspendedEmail,
  buildTrialEndingEmail,
  type ActivityRecap,
  type BillingNotificationKind,
} from './billing-notification-emails';
import { getBillingStatus, subscriptionHasPaymentMethod } from './billing.service';

export interface BillingNotificationJobData {
  kind: BillingNotificationKind;
  restaurantId: string;
  subscriptionId: string;
  /** Début de la période résumée (début de l'essai ou de l'abonnement), ISO 8601. */
  since: string;
  /** Fin de l'essai, ISO 8601 (`trial-ending` seulement). */
  trialEndsAt?: string;
  /** L'abonnement s'est terminé à la fin de l'essai (`service-suspended` seulement). */
  endedFromTrial?: boolean;
}

export type BillingNotificationOutcome =
  | 'sent'
  | 'restaurant-not-found'
  | 'no-email'
  | 'card-on-file'
  | 'no-longer-trialing'
  | 'no-longer-suspended';

function hasEmailAddress(value: string | null | undefined): value is string {
  return Boolean(value && /^\S+@\S+\.\S+$/.test(value.trim()));
}

/** Activité du restaurant depuis `since` : appels reçus et réservations prises (hors annulées). */
export async function loadActivityRecap(restaurantId: string, since: Date): Promise<ActivityRecap> {
  const createdAt = { gte: since };
  const [calls, reservations, phoneReservations] = await Promise.all([
    db.call.count({ where: { restaurantId, createdAt } }),
    db.reservation.aggregate({
      where: { restaurantId, createdAt, status: { not: 'CANCELLED' } },
      _count: { _all: true },
      _sum: { partySize: true },
    }),
    db.reservation.count({
      where: { restaurantId, createdAt, status: { not: 'CANCELLED' }, channel: 'PHONE' },
    }),
  ]);
  return {
    calls,
    reservations: reservations._count._all,
    covers: reservations._sum.partySize ?? 0,
    phoneReservations,
  };
}

/**
 * Envoie l'e-mail s'il a encore un sens au moment de l'envoi : la carte a pu être ajoutée, ou le
 * compte réactivé, depuis l'événement Stripe. Aucune adresse n'est journalisée.
 */
export async function processBillingNotification(
  data: BillingNotificationJobData,
  jobId: string,
): Promise<BillingNotificationOutcome> {
  const restaurant = await db.restaurant.findUnique({
    where: { id: data.restaurantId },
    select: { id: true, name: true, managerEmail: true, accountId: true },
  });
  if (!restaurant) return 'restaurant-not-found';

  const status = await getBillingStatus({ restaurantId: restaurant.id });
  if (data.kind === 'trial-ending') {
    if (status.subscriptionStatus !== 'trialing') return 'no-longer-trialing';
    if (await subscriptionHasPaymentMethod(data.subscriptionId)) return 'card-on-file';
  } else if (!status.suspended) {
    return 'no-longer-suspended';
  }

  const recipient = hasEmailAddress(restaurant.managerEmail)
    ? restaurant.managerEmail.trim()
    : await resolveAccountOwnerEmail(restaurant.accountId);
  if (!recipient) return 'no-email';

  const recap = await loadActivityRecap(restaurant.id, new Date(data.since));
  const dashboardUrl = process.env.DASHBOARD_URL ?? 'https://sokar.tech';
  const email =
    data.kind === 'trial-ending'
      ? buildTrialEndingEmail({
          restaurantName: restaurant.name,
          trialEndsAt: new Date(data.trialEndsAt ?? Date.now()),
          recap,
          dashboardUrl,
        })
      : buildServiceSuspendedEmail({
          restaurantName: restaurant.name,
          endedFromTrial: data.endedFromTrial === true,
          recap,
          dashboardUrl,
        });

  const usageContext: MessagingUsageContext = {
    restaurantId: restaurant.id,
    sourceType: 'billing_notification',
    sourceId: `${data.subscriptionId}:${data.kind}:${jobId}`,
    metadata: { messageType: 'billing_notification', notificationKind: data.kind },
  };

  await sendEmail({ to: recipient, subject: email.subject, html: email.html, usage: usageContext });
  return 'sent';
}

export const billingNotificationWorker = new Worker(
  'billing-notifications',
  async (job) => {
    const log = jobLogger(job);
    const data = job.data as BillingNotificationJobData;
    const outcome = await processBillingNotification(data, String(job.id ?? 'manual'));
    log.info({ kind: data.kind, outcome }, 'billing notification processed');
  },
  { connection: redisQueue },
);

setupWorkerListeners(billingNotificationWorker);

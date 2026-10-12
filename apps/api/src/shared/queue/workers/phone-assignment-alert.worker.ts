import { Worker } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { db } from '../../db/client';
import { sendEmail } from '../../email';
import type { logger } from '../../logger/pino';
import { setupWorkerListeners, jobLogger } from './helper';
import { hasUsablePhone } from '../../../modules/restaurants/onboarding.service';
import type { PhoneAssignmentNeededJobData } from '../../../modules/restaurants/phone-assignment-alert';

/** Seuls champs lus : aucune donnée du gérant (ni téléphone, ni e-mail, ni nom). */
export interface PhoneAssignmentRestaurant {
  id: string;
  name: string;
  city: string | null;
  phoneNumber: string;
}

export interface PhoneAssignmentAlertDependencies {
  recipient: string | undefined;
  dashboardUrl: string;
  findRestaurant(restaurantId: string): Promise<PhoneAssignmentRestaurant | null>;
  send(email: { to: string; subject: string; html: string }): Promise<unknown>;
  log: Pick<typeof logger, 'info' | 'warn'>;
}

export type PhoneAssignmentAlertResult = 'sent' | 'no_recipient' | 'not_found' | 'already_assigned';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatParisDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  }).format(date);
}

export function buildPhoneAssignmentEmail(
  restaurant: PhoneAssignmentRestaurant,
  floorCompletedAt: string,
  dashboardUrl: string,
) {
  const adminUrl = `${dashboardUrl.replace(/\/+$/, '')}/admin/provisioning`;
  const name = escapeHtml(restaurant.name);
  const rows: [string, string][] = [
    ['Restaurant', name],
    ['Identifiant', escapeHtml(restaurant.id)],
    ['Ville', escapeHtml(restaurant.city?.trim() || 'Non renseignée')],
    ['Salle terminée le', escapeHtml(formatParisDate(floorCompletedAt))],
  ];
  return {
    subject: `Numéro Sokar à attribuer : ${restaurant.name}`,
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
        <h1 style="font-size:20px;margin:0 0 12px">Un restaurant attend son numéro Sokar</h1>
        <p style="margin:0 0 16px;line-height:1.5">
          ${name} a terminé sa salle. Sans numéro attribué, son canal Téléphone ne peut pas se
          terminer et son espace reste fermé.
        </p>
        <table style="border-collapse:collapse;margin:0 0 16px">
          ${rows
            .map(
              ([label, value]) =>
                `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${label}</td><td style="padding:4px 0">${value}</td></tr>`,
            )
            .join('')}
        </table>
        <a href="${escapeHtml(adminUrl)}"
           style="display:inline-block;background:#0f172a;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600">
          Attribuer un numéro
        </a>
      </div>
    `,
  };
}

/**
 * Envoie l'alerte à l'équipe. Ne fait rien si aucun destinataire n'est configuré, si le restaurant
 * n'existe plus, ou si un numéro a été attribué depuis la mise en file.
 */
export async function processPhoneAssignmentNeeded(
  data: PhoneAssignmentNeededJobData,
  deps: PhoneAssignmentAlertDependencies,
): Promise<PhoneAssignmentAlertResult> {
  const recipient = deps.recipient?.trim();
  if (!recipient) {
    deps.log.info('SOKAR_OPS_ALERT_EMAIL vide : alerte de numéro à attribuer non envoyée');
    return 'no_recipient';
  }
  const restaurant = await deps.findRestaurant(data.restaurantId);
  if (!restaurant) {
    deps.log.warn('restaurant introuvable : alerte de numéro à attribuer ignorée');
    return 'not_found';
  }
  if (hasUsablePhone(restaurant.phoneNumber)) {
    deps.log.info('numéro déjà attribué : alerte inutile');
    return 'already_assigned';
  }
  const email = buildPhoneAssignmentEmail(restaurant, data.floorCompletedAt, deps.dashboardUrl);
  await deps.send({ to: recipient, ...email });
  deps.log.info('alerte de numéro à attribuer envoyée');
  return 'sent';
}

export const phoneAssignmentAlertWorker = new Worker(
  'phone-assignment',
  async (job) => {
    await processPhoneAssignmentNeeded(job.data as PhoneAssignmentNeededJobData, {
      recipient: process.env.SOKAR_OPS_ALERT_EMAIL,
      dashboardUrl: process.env.DASHBOARD_URL ?? 'https://sokar.tech',
      findRestaurant: (restaurantId) =>
        db.restaurant.findUnique({
          where: { id: restaurantId },
          select: { id: true, name: true, city: true, phoneNumber: true },
        }),
      send: (email) => sendEmail(email),
      log: jobLogger(job),
    });
  },
  { connection: redisQueue },
);

setupWorkerListeners(phoneAssignmentAlertWorker);

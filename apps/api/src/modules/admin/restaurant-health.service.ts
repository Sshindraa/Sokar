/**
 * Santé d'un restaurant — vue synthétique pour le pilote.
 *
 * Agrège en une seule réponse :
 *   - le numéro attribué et l'état du provisioning Telnyx
 *   - le dernier appel (transcription / outcome présents ou non)
 *   - la dernière réservation
 *   - le dernier SMS tracé (audit d'envoi ou rappel J-1)
 *   - l'état des workers BullMQ (files, jobs en attente / échec)
 *
 * Consommé par la page dashboard /dashboard/admin/health.
 */

import { db } from '../../shared/db/client';
import {
  collectQueueStates,
  type QueueStateCounts,
} from '../../shared/observability/system-checks';

export interface WorkerState extends QueueStateCounts {
  queue: string;
  status: 'ok' | 'error';
}

export interface RestaurantHealth {
  restaurant: {
    id: string;
    name: string;
    slug: string | null;
  };
  phone: {
    number: string;
    carrier: string | null;
    provisioningStatus: string;
    telnyxPhoneNumberId: string | null;
    forwardingConfiguredAt: string | null;
    testCallValidatedAt: string | null;
    firstCallAt: string | null;
    smsConfirmEnabled: boolean;
  };
  lastCall: {
    callSid: string;
    at: string;
    durationSec: number | null;
    outcome: string | null;
    hasTranscript: boolean;
  } | null;
  lastReservation: {
    id: string;
    customerName: string;
    partySize: number;
    reservedAt: string;
    createdAt: string;
    status: string;
    channel: string;
  } | null;
  lastSms: {
    kind: string;
    at: string;
    reservationId: string | null;
    customerName: string | null;
  } | null;
  workers: WorkerState[];
  generatedAt: string;
}

/**
 * Construit la vue santé. Retourne null si le restaurant n'existe pas.
 * L'état des files est best-effort : une file inaccessible remonte 'error'
 * sans faire échouer toute la réponse.
 */
export async function buildRestaurantHealth(
  restaurantId: string,
): Promise<RestaurantHealth | null> {
  const restaurant = await db.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      id: true,
      name: true,
      slug: true,
      phoneNumber: true,
      carrier: true,
      provisioningStatus: true,
      telnyxPhoneNumberId: true,
      forwardingConfiguredAt: true,
      testCallValidatedAt: true,
      firstCallAt: true,
      smsConfirmEnabled: true,
    },
  });
  if (!restaurant) return null;

  const [lastCall, lastReservation, lastSmsAudit, lastReminder, queueStates] = await Promise.all([
    db.call.findFirst({
      where: { restaurantId },
      orderBy: { createdAt: 'desc' },
      select: {
        callSid: true,
        createdAt: true,
        durationSec: true,
        outcome: true,
        transcript: true,
      },
    }),
    db.reservation.findFirst({
      where: { restaurantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        customerName: true,
        partySize: true,
        reservedAt: true,
        createdAt: true,
        status: true,
        channel: true,
      },
    }),
    // Dernier SMS tracé par un worker (confirmation de création, promotion…).
    db.reservationAuditLog.findFirst({
      where: { event: { contains: 'sms' }, reservation: { restaurantId } },
      orderBy: { createdAt: 'desc' },
      select: { event: true, createdAt: true, reservationId: true },
    }),
    // Dernier rappel J-1 (SMS/WhatsApp) marqué sur la réservation.
    db.reservation.findFirst({
      where: { restaurantId, confirmationSentAt: { not: null } },
      orderBy: { confirmationSentAt: 'desc' },
      select: { id: true, customerName: true, confirmationSentAt: true },
    }),
    collectQueueStates(),
  ]);

  // Le « dernier SMS » est le plus récent des deux sources disponibles.
  let lastSms: RestaurantHealth['lastSms'] = null;
  const auditAt = lastSmsAudit?.createdAt ?? null;
  const reminderAt = lastReminder?.confirmationSentAt ?? null;
  if (auditAt && (!reminderAt || auditAt >= reminderAt)) {
    lastSms = {
      kind: lastSmsAudit!.event,
      at: auditAt.toISOString(),
      reservationId: lastSmsAudit!.reservationId,
      customerName: null,
    };
  } else if (reminderAt) {
    lastSms = {
      kind: 'reminder_j1',
      at: reminderAt.toISOString(),
      reservationId: lastReminder!.id,
      customerName: lastReminder!.customerName,
    };
  }

  const workers: WorkerState[] = Object.entries(queueStates).map(([queue, counts]) => ({
    queue,
    waiting: counts?.waiting ?? 0,
    active: counts?.active ?? 0,
    delayed: counts?.delayed ?? 0,
    failed: counts?.failed ?? 0,
    paused: counts?.paused ?? 0,
    status: counts ? 'ok' : 'error',
  }));

  return {
    restaurant: { id: restaurant.id, name: restaurant.name, slug: restaurant.slug },
    phone: {
      number: restaurant.phoneNumber,
      carrier: restaurant.carrier,
      provisioningStatus: restaurant.provisioningStatus,
      telnyxPhoneNumberId: restaurant.telnyxPhoneNumberId,
      forwardingConfiguredAt: restaurant.forwardingConfiguredAt?.toISOString() ?? null,
      testCallValidatedAt: restaurant.testCallValidatedAt?.toISOString() ?? null,
      firstCallAt: restaurant.firstCallAt?.toISOString() ?? null,
      smsConfirmEnabled: restaurant.smsConfirmEnabled,
    },
    lastCall: lastCall
      ? {
          callSid: lastCall.callSid,
          at: lastCall.createdAt.toISOString(),
          durationSec: lastCall.durationSec,
          outcome: lastCall.outcome,
          hasTranscript: lastCall.transcript !== null,
        }
      : null,
    lastReservation: lastReservation
      ? {
          id: lastReservation.id,
          customerName: lastReservation.customerName,
          partySize: lastReservation.partySize,
          reservedAt: lastReservation.reservedAt.toISOString(),
          createdAt: lastReservation.createdAt.toISOString(),
          status: lastReservation.status,
          channel: lastReservation.channel,
        }
      : null,
    lastSms,
    workers,
    generatedAt: new Date().toISOString(),
  };
}

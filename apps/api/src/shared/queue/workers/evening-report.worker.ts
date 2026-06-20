import { Worker } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { db } from '../../db/client';
import { sendEmail } from '../../email';
import { buildReportEmail } from '../../../modules/analytics/report.service';
import { setupWorkerListeners, jobLogger } from './helper';

interface EveningReportJobData {
  readonly restaurantId: string;
  readonly dayKey?: string;
  readonly idempotencyKey?: string;
}

function getReportDayRange(dayKey?: string): { start: Date; end: Date; label: string } {
  const base = dayKey ? new Date(`${dayKey}T00:00:00.000Z`) : new Date();
  if (Number.isNaN(base.getTime())) {
    throw new Error(`Invalid evening report dayKey: ${dayKey}`);
  }

  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(base);
  end.setHours(23, 59, 59, 999);

  return { start, end, label: start.toLocaleDateString('fr-FR') };
}

export const eveningReportWorker = new Worker(
  'evening-report',
  async (job) => {
    const log = jobLogger(job);
    const { restaurantId, dayKey } = job.data as EveningReportJobData;
    const { start, end, label } = getReportDayRange(dayKey);

    const [calls, reservations, restaurant] = await Promise.all([
      db.call.findMany({ where: { restaurantId, createdAt: { gte: start, lte: end } } }),
      db.reservation.findMany({
        where: { restaurantId, createdAt: { gte: start, lte: end } },
      }),
      db.restaurant.findUnique({ where: { id: restaurantId } }),
    ]);

    if (!restaurant) {
      log.warn('restaurant not found, skipping evening report');
      return;
    }

    if (!restaurant.managerEmail) {
      log.warn('restaurant manager email missing, skipping evening report');
      return;
    }

    const confirmedReservations = reservations.filter((r) => r.status === 'CONFIRMED');
    const reserved = confirmedReservations.length;
    const cancelled = reservations.filter((r) => r.status === 'CANCELLED').length;
    const totalCouverts = confirmedReservations.reduce(
      (sum, reservation) => sum + reservation.partySize,
      0,
    );
    const estimatedRevenue = reservations
      .filter((reservation) => reservation.estimatedRevenue)
      .reduce((sum, reservation) => sum + Number(reservation.estimatedRevenue), 0);

    await sendEmail({
      to: restaurant.managerEmail,
      subject: `📊 Résumé Sokar — ${label}`,
      html: buildReportEmail({
        restaurantName: restaurant.name,
        totalCalls: calls.length,
        reserved,
        cancelled,
        estimatedRevenue,
        totalCouverts,
      }),
    });

    log.info({ totalCalls: calls.length, reserved, cancelled, dayKey }, 'evening report sent');
  },
  { connection: redisQueue, concurrency: 3 },
);

setupWorkerListeners(eveningReportWorker);

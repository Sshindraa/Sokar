import { Worker }           from 'bullmq';
import { redisQueue }       from '../../redis/client';
import { db }               from '../../db/client';
import { sendEmail }        from '../../email';
import { buildReportEmail } from '../../../modules/analytics/report.service';

export const eveningReportWorker = new Worker('evening-report', async (job) => {
  const { restaurantId } = job.data;

  const startDay = new Date(); startDay.setHours(0, 0, 0, 0);
  const endDay   = new Date(); endDay.setHours(23, 59, 59, 999);

  const [calls, reservations, restaurant] = await Promise.all([
    db.call.findMany({ where: { restaurantId, createdAt: { gte: startDay, lte: endDay } } }),
    db.reservation.findMany({ where: { restaurantId, createdAt: { gte: startDay, lte: endDay } } }),
    db.restaurant.findUniqueOrThrow({ where: { id: restaurantId } }),
  ]);

  const reserved   = reservations.filter((r: any) => r.status === 'CONFIRMED').length;
  const cancelled  = reservations.filter((r: any) => r.status === 'CANCELLED').length;
  const totalCouverts = reservations
    .filter((r: any) => r.status === 'CONFIRMED')
    .reduce((s: number, r: any) => s + r.partySize, 0);
  const estimatedRevenue = reservations
    .filter((r: any) => r.estimatedRevenue)
    .reduce((sum: number, r: any) => sum + Number(r.estimatedRevenue), 0);

  await sendEmail({
    to:      restaurant.managerEmail,
    subject: `📊 Résumé Callyx — ${new Date().toLocaleDateString('fr-FR')}`,
    html:    buildReportEmail({ restaurantName: restaurant.name, totalCalls: calls.length, reserved, cancelled, estimatedRevenue, totalCouverts }),
  });
}, { connection: redisQueue });

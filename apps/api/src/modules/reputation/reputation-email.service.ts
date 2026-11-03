import { createHash, createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../../shared/db/client';
import { sendEmail } from '../../shared/email';
import { redisQueue } from '../../shared/redis/client';
import { queues } from '../../shared/queue/queues';
import {
  acquireNotificationClaim,
  buildNotificationClaimKey,
  classifyNotificationError,
  enqueueNotificationReconciliation,
  normalizeNotificationSendResult,
  NotificationProviderRefusedError,
  recordNotificationResult,
} from '../../shared/queue/notification-idempotency';
import { evaluateCapability } from '../entitlements/entitlement.service';
import { normalizeCustomerEmail } from '../customers/customer-crm.service';

export const REPUTATION_DAILY_EMAIL_LIMIT = 10;
const DAY = 86_400_000;
const COOLDOWN = 90 * DAY;
const TTL = 7 * DAY;

function tokenFor(restaurantId: string, reservationId: string): string {
  const secret = process.env.REPUTATION_EMAIL_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error('REPUTATION_EMAIL_SECRET_NOT_CONFIGURED');
  return createHmac('sha256', secret)
    .update(`sokar:reputation-email:v1:${restaurantId}:${reservationId}`)
    .digest('base64url');
}

export function reputationTokenHash(token: string): string {
  return createHash('sha256').update(`sokar:reputation-feedback:${token}`).digest('hex');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildReputationEmail(
  restaurantName: string,
  token: string,
): { subject: string; html: string } {
  const base = new URL(process.env.API_URL || 'https://api.sokar.tech');
  if (
    base.username ||
    base.password ||
    (base.protocol !== 'https:' &&
      !(
        process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(base.hostname)
      ))
  ) {
    throw new Error('REPUTATION_API_URL_INVALID');
  }
  const feedback = new URL('/reputation/respond', base);
  const unsubscribe = new URL('/reputation/unsubscribe', base);
  feedback.hash = token;
  unsubscribe.hash = token;
  const name = escapeHtml(restaurantName);
  return {
    subject: `Votre retour sur votre visite au restaurant ${restaurantName.replace(/\s+/g, ' ').trim()}`,
    html: `<p>Bonjour,</p><p>Comment s’est passée votre visite au restaurant ${name} ? Votre retour privé aidera son équipe à améliorer votre accueil.</p><p><a href="${escapeHtml(feedback.toString())}">Partager mon retour</a></p><p>Ce retour est transmis uniquement à l’équipe du restaurant.</p><p><a href="${escapeHtml(unsubscribe.toString())}">Ne plus recevoir ces demandes de retour</a></p>`,
  };
}

/** Resserre l'admission sous verrous : tentative incertaine comptée et aucun doublon inter-workers. */
async function reserveAttempt(args: {
  restaurantId: string;
  reservationId: string;
  customerId: string;
  tokenHash: string;
  now: Date;
}): Promise<'ready' | 'skip' | 'defer'> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('sokar:reputation-email-daily'))`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM customers WHERE id = ${args.customerId} AND restaurant_id = ${args.restaurantId} FOR UPDATE`,
    );
    const customer = await tx.customer.findFirst({
      where: { id: args.customerId, restaurantId: args.restaurantId, archivedAt: null },
      select: { feedbackEmailOptOutAt: true, feedbackEmailRequestedAt: true },
    });
    if (!customer || customer.feedbackEmailOptOutAt) return 'skip';
    let request = await tx.reputationFeedbackRequest.findUnique({
      where: { reservationId: args.reservationId },
    });
    if (request) {
      if (
        request.restaurantId !== args.restaurantId ||
        request.customerId !== args.customerId ||
        request.tokenHash !== args.tokenHash ||
        request.status !== 'PENDING' ||
        request.expiresAt <= args.now
      )
        return 'skip';
    } else if (
      customer.feedbackEmailRequestedAt &&
      args.now.getTime() - customer.feedbackEmailRequestedAt.getTime() < COOLDOWN
    ) {
      return 'skip';
    }
    const dayStart = new Date(
      Date.UTC(args.now.getUTCFullYear(), args.now.getUTCMonth(), args.now.getUTCDate()),
    );
    const count = await tx.reputationEmailAttempt.count({
      where: { attemptedAt: { gte: dayStart, lt: new Date(dayStart.getTime() + DAY) } },
    });
    if (count >= REPUTATION_DAILY_EMAIL_LIMIT) return 'defer';
    if (!request) {
      request = await tx.reputationFeedbackRequest.create({
        data: {
          restaurantId: args.restaurantId,
          reservationId: args.reservationId,
          customerId: args.customerId,
          channel: 'EMAIL',
          tokenHash: args.tokenHash,
          requestedAt: args.now,
          expiresAt: new Date(args.now.getTime() + TTL),
        },
      });
      await tx.customer.update({
        where: { id: args.customerId, restaurantId: args.restaurantId },
        data: { feedbackEmailRequestedAt: args.now },
      });
    }
    await tx.reputationEmailAttempt.create({
      data: { requestId: request.id, attemptedAt: args.now },
    });
    return 'ready';
  });
}

export async function sendReputationFeedbackEmail(args: {
  restaurantId: string;
  reservationId: string;
}): Promise<'sent' | 'skip' | 'defer' | 'unknown'> {
  const reservation = await db.reservation.findFirst({
    where: { id: args.reservationId, restaurantId: args.restaurantId },
    select: {
      id: true,
      restaurantId: true,
      customerId: true,
      customerEmail: true,
      state: true,
      isTest: true,
      restaurant: { select: { name: true, siteStatus: true } },
    },
  });
  if (
    !reservation ||
    reservation.state !== 'HONORED' ||
    reservation.isTest ||
    !reservation.customerId ||
    !reservation.customerEmail ||
    ['ARCHIVED', 'SUSPENDED'].includes(reservation.restaurant.siteStatus)
  )
    return 'skip';
  if (!(await evaluateCapability(args.restaurantId, 'reputation.feedback')).allowed) return 'skip';
  const address = normalizeCustomerEmail(reservation.customerEmail);
  if (!address) return 'skip';
  const token = tokenFor(args.restaurantId, args.reservationId);
  const email = buildReputationEmail(reservation.restaurant.name, token);
  const claimKey = buildNotificationClaimKey('reputation-feedback-email', args.reservationId);
  const claim = await acquireNotificationClaim(redisQueue, claimKey, {
    provider: 'resend',
    channel: 'email',
  });
  if (!claim.acquired || !claim.token) return 'skip';
  let started = false;
  try {
    const admission = await reserveAttempt({
      ...args,
      customerId: reservation.customerId,
      tokenHash: reputationTokenHash(token),
      now: new Date(),
    });
    if (admission !== 'ready') {
      await recordNotificationResult(redisQueue, claimKey, claim.token, 'failure_certain');
      return admission;
    }
    const customer = await db.customer.findFirst({
      where: { id: reservation.customerId, restaurantId: args.restaurantId, archivedAt: null },
      select: { feedbackEmailOptOutAt: true },
    });
    if (!customer || customer.feedbackEmailOptOutAt) {
      await recordNotificationResult(redisQueue, claimKey, claim.token, 'failure_certain');
      return 'skip';
    }
    started = true;
    const result = normalizeNotificationSendResult(
      await sendEmail({
        to: address,
        ...email,
        usage: {
          restaurantId: args.restaurantId,
          sourceType: 'reputation_feedback_email',
          sourceId: args.reservationId,
          metadata: { messageType: 'reputation_feedback_email' },
        },
      }),
      'resend',
      'email',
    );
    await recordNotificationResult(redisQueue, claimKey, claim.token, result.outcome, {
      provider: 'resend',
      channel: 'email',
      ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
    });
    if (result.outcome === 'failure_certain')
      throw new NotificationProviderRefusedError('resend', 'email');
    if (result.outcome === 'unknown') {
      await enqueueNotificationReconciliation(queues.reconciliation, {
        claimKey,
        provider: 'resend',
        channel: 'email',
        ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
      });
      return 'unknown';
    }
    await db.reputationFeedbackRequest.updateMany({
      where: {
        reservationId: args.reservationId,
        restaurantId: args.restaurantId,
        status: 'PENDING',
      },
      data: { status: 'SENT', sentAt: new Date() },
    });
    return 'sent';
  } catch (error) {
    if (error instanceof NotificationProviderRefusedError) throw error;
    const outcome = started ? classifyNotificationError(error) : 'failure_certain';
    await recordNotificationResult(redisQueue, claimKey, claim.token, outcome, {
      provider: 'resend',
      channel: 'email',
    });
    if (outcome === 'unknown') {
      await enqueueNotificationReconciliation(queues.reconciliation, {
        claimKey,
        provider: 'resend',
        channel: 'email',
      });
      return 'unknown';
    }
    if (started) throw new NotificationProviderRefusedError('resend', 'email');
    throw new Error('REPUTATION_EMAIL_PREPARATION_FAILED');
  }
}

/** An old invitation remains usable to withdraw, even after its feedback expiry. */
export async function unsubscribeReputationEmail(token: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) throw new Error('INVALID_REPUTATION_TOKEN');
  // Un lien public ne connaît pas le tenant : le hash unique identifie la demande avant tout accès au client.
  const request = await db.reputationFeedbackRequest.findUnique({
    where: { tokenHash: reputationTokenHash(token) },
    select: { customerId: true, restaurantId: true },
  });
  if (!request) throw new Error('INVALID_REPUTATION_TOKEN');
  await db.$transaction(async (tx) => {
    let id: string | null = request.customerId;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const customer: { id: string; mergedIntoId: string | null } | null =
        await tx.customer.findFirst({
          where: { id, restaurantId: request.restaurantId },
          select: { id: true, mergedIntoId: true },
        });
      if (!customer) throw new Error('INVALID_REPUTATION_TOKEN');
      await tx.customer.update({
        where: { id: customer.id, restaurantId: request.restaurantId },
        data: { feedbackEmailOptOutAt: new Date() },
      });
      id = customer.mergedIntoId;
    }
    if (id) throw new Error('INVALID_REPUTATION_TOKEN');
  });
}

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

export const WHATSAPP_REMINDER_CONSENT_VERSION = 'whatsapp-reminder-2026-10-17';

export function createWhatsAppReminderConsent(accepted: boolean, ipHash?: string) {
  if (!accepted) return { consents: { transactionalWhatsapp: false }, withdrawalToken: undefined };
  const withdrawalToken = randomBytes(32).toString('hex');
  return {
    withdrawalToken,
    consents: {
      transactionalWhatsapp: true,
      whatsappConsentProof: {
        version: WHATSAPP_REMINDER_CONSENT_VERSION,
        purpose: 'reservation_reminder',
        acceptedAt: new Date().toISOString(),
        ...(ipHash ? { ipHash } : {}),
      },
      whatsappWithdrawalTokenHash: createHash('sha256').update(withdrawalToken).digest('hex'),
    },
  };
}

export async function withdrawWhatsAppReminderConsent(
  db: PrismaClient,
  restaurantId: string,
  reservationId: string,
  token: string,
): Promise<'withdrawn' | 'not_found' | 'conflict'> {
  const reservation = await db.reservation.findFirst({
    where: { id: reservationId, restaurantId },
    select: { consents: true },
  });
  const original = reservation?.consents;
  if (!original || typeof original !== 'object' || Array.isArray(original)) return 'not_found';
  const consents = original as Record<string, Prisma.JsonValue>;
  const expected = consents.whatsappWithdrawalTokenHash;
  const hash = createHash('sha256').update(token).digest('hex');
  if (
    typeof expected !== 'string' ||
    expected.length !== hash.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(hash))
  )
    return 'not_found';
  if (consents.transactionalWhatsapp === false) return 'withdrawn';
  // Do not overwrite a concurrent consent change with a stale JSON snapshot.
  const result = await db.reservation.updateMany({
    where: { id: reservationId, restaurantId, consents: { equals: original } },
    data: {
      consents: {
        ...consents,
        transactionalWhatsapp: false,
        whatsappWithdrawnAt: new Date().toISOString(),
      },
    },
  });
  return result.count === 1 ? 'withdrawn' : 'conflict';
}

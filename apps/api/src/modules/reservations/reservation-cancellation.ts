import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export type CancellationReservation = {
  id: string;
  restaurantId: string;
  state: string;
  createdAt: Date;
  reservedAt: Date;
  startsAt: Date | null;
  partySize: number;
  cancellationPolicySnap: unknown;
  giftCardRedemptionSnap: unknown;
  _count: {
    reservationPayments: number;
    giftCardRedemptions: number;
    experienceReservations: number;
    eventOrders: number;
    distributionReservationLinks: number;
  };
};

export const cancellationRelations = {
  _count: {
    select: {
      reservationPayments: true,
      giftCardRedemptions: true,
      experienceReservations: true,
      eventOrders: true,
      distributionReservationLinks: true,
    },
  },
} as const;

const policySchema = z
  .object({
    freeUntilMinutesBefore: z.number().finite().int().min(0).max(525600),
    feeAmount: z.number().finite().nonnegative().optional(),
    feeCurrency: z.string().max(10).optional(),
    version: z.string().min(1).max(200),
    source: z.literal('onboarding-v1'),
    selfService: z.enum(['free_before_deadline', 'contact']),
    terms: z.string().min(1).max(280),
  })
  .strict();

export type CancellationOffer = {
  available: boolean;
  deadline: string | null;
  message: string;
  confirmationToken?: string;
  terms?: string;
};

// Separate domain from the bearer link; a viewed offer cannot authorize a changed booking.
function signature(row: CancellationReservation, bearer: string, expires: string): Buffer {
  return createHmac('sha256', Buffer.from(process.env.RESERVATION_MANAGEMENT_SECRET!, 'hex'))
    .update('reservation-cancellation-v1\0')
    .update(bearer)
    .update(
      `\0${expires}\0${row.id}\0${row.restaurantId}\0${row.state}\0${row.createdAt.toISOString()}`,
    )
    .update(`\0${(row.startsAt ?? row.reservedAt).toISOString()}\0${row.partySize}`)
    .update(`\0${JSON.stringify(row.cancellationPolicySnap)}\0${JSON.stringify(row._count)}`)
    .digest();
}

export function cancellationOffer(
  row: CancellationReservation,
  bearer: string,
  timezone: string,
  now = new Date(),
): CancellationOffer {
  const policy = policySchema.safeParse(row.cancellationPolicySnap);
  const unavailable = (message: string, deadline: string | null = null): CancellationOffer => ({
    available: false,
    message,
    deadline,
    ...(policy.success ? { terms: policy.data.terms } : {}),
  });
  if (row.state === 'CANCELLED') return unavailable('Votre réservation est annulée.');
  if (!['CONFIRMED', 'PENDING'].includes(row.state))
    return unavailable('Pour cette réservation, veuillez contacter le restaurant.');
  if (process.env.RESERVATION_SELF_CANCELLATION_ENABLED !== 'true')
    return unavailable('Pour annuler, veuillez contacter le restaurant.');
  if (
    !row._count ||
    Object.values(row._count).some((count) => count > 0) ||
    row.giftCardRedemptionSnap != null
  ) {
    return unavailable(
      'Les conditions particulières de cette réservation doivent être traitées avec le restaurant.',
    );
  }
  if (
    !policy.success ||
    policy.data.selfService !== 'free_before_deadline' ||
    (policy.data.feeAmount ?? 0) > 0
  ) {
    return unavailable(
      'Pour connaître et appliquer les conditions d’annulation de cette réservation, veuillez contacter le restaurant.',
    );
  }
  const startsAt = row.startsAt ?? row.reservedAt;
  const cutoff = new Date(startsAt.getTime() - policy.data.freeUntilMinutesBefore * 60_000);
  const deadline = cutoff.toISOString();
  if (now >= cutoff)
    return unavailable(
      'Le délai d’annulation en ligne est dépassé. Veuillez contacter le restaurant.',
      deadline,
    );
  const label = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(cutoff);
  const expires = String(
    Math.floor(Math.min(now.getTime() + 10 * 60_000, cutoff.getTime()) / 1000),
  );
  return {
    available: true,
    deadline,
    terms: policy.data.terms,
    message: `Annulation gratuite possible jusqu’au ${label}. Après cette limite, veuillez contacter le restaurant.`,
    confirmationToken: `${expires}.${signature(row, bearer, expires).toString('base64url')}`,
  };
}

export function verifyCancellationOffer(
  row: CancellationReservation,
  bearer: string,
  token: string,
  now = new Date(),
): boolean {
  if (!/^\d{10}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const [expires, mac] = token.split('.');
  if (Number(expires) * 1000 <= now.getTime()) return false;
  const bytes = Buffer.from(mac, 'base64url');
  return (
    bytes.length === 32 &&
    bytes.toString('base64url') === mac &&
    timingSafeEqual(signature(row, bearer, expires), bytes)
  );
}

export class CancellationConflict extends Error {
  constructor(message: string) {
    super(message);
  }
}

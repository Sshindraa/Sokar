import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Prisma, PrismaClient, Reservation } from '@prisma/client';
import { z } from 'zod';
import { DEFAULT_MAX_PARTY_SIZE } from '@sokar/config';
import { CapacityAwareAvailabilityService } from '../floor-plan/availability-capacity-aware.service';
import { resolveServiceDurationMinutes } from '../floor-plan/floor-plan.types';
import { utcToZonedParts, zonedTimeToUtc } from '../../shared/timezone/restaurant-time';
import { DEFAULT_ONLINE_MIN_LEAD_TIME_MINUTES } from '../../shared/reservations/lead-time';
import {
  cancellationRelations,
  reservationSelfServiceConditions,
  type CancellationReservation,
} from './reservation-cancellation';
import { verifyReservationManagementToken } from './reservation-management';
import {
  ReservationService,
  ReservationSlotUnavailableError,
  ReservationModificationNotAllowedError,
} from '../agentic-reservations/core/reservation.service';
import { AuditLogService } from '../agentic-reservations/core/audit-log.service';
import { HoldService } from '../agentic-reservations/core/hold.service';
import { IdempotencyService } from '../agentic-reservations/core/idempotency.service';
import { PrismaIdempotencyStore } from '../agentic-reservations/core/prisma-store';

type ManagedRow = Reservation & CancellationReservation;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const revision = (row: ManagedRow) =>
  digest([
    row.id,
    row.restaurantId,
    row.createdAt,
    row.state,
    row.reservedAt,
    row.startsAt,
    row.endsAt,
    row.partySize,
    row.tableId,
    row.cancellationPolicySnap,
    row.giftCardRedemptionSnap,
    row._count,
  ]);
export class ModificationConflict extends Error {}
const contact = 'Pour modifier cette réservation, veuillez contacter le restaurant.';

export function modificationAccess(
  row: CancellationReservation & { tableId?: string | null },
  bearer: string,
  timezone: string,
  manualValidation = false,
) {
  const conditions = reservationSelfServiceConditions(row, bearer, timezone);
  const available =
    process.env.RESERVATION_SELF_MODIFICATION_ENABLED === 'true' &&
    conditions.available &&
    !!row.tableId &&
    !manualValidation;
  return {
    available,
    message: available
      ? 'Votre réservation actuelle reste conservée jusqu’à la confirmation du nouveau choix.'
      : contact,
  };
}

const proposalSchema = z
  .object({
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    settings: z.string().regex(/^[a-f0-9]{64}$/),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    partySize: z.number().int().min(1).max(50),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    expires: z.number().int().positive(),
  })
  .strict();
type Proposal = z.infer<typeof proposalSchema>;
function mac(payload: string, bearer: string) {
  return createHmac('sha256', Buffer.from(process.env.RESERVATION_MANAGEMENT_SECRET!, 'hex'))
    .update('reservation-modification-v1\0')
    .update(bearer)
    .update('\0')
    .update(payload)
    .digest();
}
function encode(proposal: Proposal, bearer: string) {
  const payload = Buffer.from(JSON.stringify(proposal)).toString('base64url');
  return `${payload}.${mac(payload, bearer).toString('base64url')}`;
}
function decode(token: string, bearer: string): Proposal {
  if (token.length > 1500 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))
    throw new ModificationConflict(
      'Proposition invalide. Veuillez consulter les disponibilités à nouveau.',
    );
  const [payload, signature] = token.split('.');
  const received = Buffer.from(signature, 'base64url');
  if (
    received.length !== 32 ||
    signature !== received.toString('base64url') ||
    !timingSafeEqual(received, mac(payload, bearer))
  )
    throw new ModificationConflict('Proposition invalide.');
  try {
    return proposalSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
  } catch {
    throw new ModificationConflict('Proposition invalide.');
  }
}
async function context(
  db: PrismaClient | Prisma.TransactionClient,
  row: ManagedRow,
  bearer: string,
) {
  const restaurant = await db.restaurant.findUniqueOrThrow({
    where: { id: row.restaurantId },
    include: { exposureSettings: true },
  });
  if (
    !modificationAccess(row, bearer, restaurant.timezone).available ||
    !row.tableId ||
    restaurant.exposureSettings?.requireManualValidation
  )
    throw new ModificationConflict(contact);
  // A larger party can newly qualify for a deposit/guarantee even without an
  // existing payment record. Financial-policy restaurants stay with staff.
  const now = new Date();
  const financialPolicy = await db.reservationPaymentPolicy.findFirst({
    where: {
      restaurantId: row.restaurantId,
      activeFrom: { lte: now },
      OR: [{ activeUntil: null }, { activeUntil: { gt: now } }],
    },
    select: { id: true },
  });
  if (financialPolicy) throw new ModificationConflict(contact);
  const settings = restaurant.exposureSettings;
  return {
    restaurant,
    maxPartySize: Math.min(50, settings?.maxPartySize ?? DEFAULT_MAX_PARTY_SIZE),
    minLeadTimeMinutes: settings?.minLeadTimeMinutes ?? DEFAULT_ONLINE_MIN_LEAD_TIME_MINUTES,
    duration: resolveServiceDurationMinutes(settings?.capacitySpecials),
    settingsHash: digest([
      restaurant.timezone,
      restaurant.openingHours,
      settings?.maxPartySize,
      settings?.minLeadTimeMinutes,
      settings?.requireManualValidation,
      settings?.capacitySpecials,
    ]),
  };
}

export async function modificationOptions(
  db: PrismaClient,
  row: ManagedRow,
  bearer: string,
  partySize: number,
) {
  const ctx = await context(db, row, bearer);
  const date = utcToZonedParts(row.startsAt ?? row.reservedAt, ctx.restaurant.timezone).date;
  if (partySize > ctx.maxPartySize)
    return {
      date,
      partySize,
      maxPartySize: ctx.maxPartySize,
      slots: [],
      message: `Ce restaurant accepte jusqu’à ${ctx.maxPartySize} personnes en ligne. Votre réservation actuelle est conservée.`,
    };
  const availability = await new CapacityAwareAvailabilityService(db).getAvailability({
    restaurantId: row.restaurantId,
    date,
    partySize,
    excludeReservationId: row.id,
    defaultFloorOnly: true,
    minLeadTimeMinutes: ctx.minLeadTimeMinutes,
  });
  const slots = availability.slots.flatMap((slot) => {
    if (!slot.available) return [];
    const startsAt = zonedTimeToUtc(date, slot.time, ctx.restaurant.timezone);
    const endsAt = new Date(startsAt.getTime() + ctx.duration * 60000);
    if (
      partySize === row.partySize &&
      startsAt.getTime() === (row.startsAt ?? row.reservedAt).getTime()
    )
      return [];
    const terms = reservationSelfServiceConditions(
      { ...row, startsAt, reservedAt: startsAt },
      bearer,
      ctx.restaurant.timezone,
    );
    if (!terms.available || !terms.deadline) return [];
    const current = reservationSelfServiceConditions(row, bearer, ctx.restaurant.timezone);
    const proposal: Proposal = {
      revision: revision(row),
      settings: ctx.settingsHash,
      date,
      time: slot.time,
      partySize,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      expires: Math.floor(
        Math.min(Date.now() + 600000, Date.parse(terms.deadline), Date.parse(current.deadline!)) /
          1000,
      ),
    };
    return [{ time: slot.time, proposalToken: encode(proposal, bearer) }];
  });
  return {
    date,
    partySize,
    maxPartySize: ctx.maxPartySize,
    slots,
    message: slots.length
      ? 'Choisissez un nouveau créneau. Votre réservation actuelle est conservée.'
      : 'Aucun autre créneau disponible pour ce nombre de personnes. Votre réservation actuelle est conservée.',
  };
}

export async function confirmModification(
  db: PrismaClient,
  initial: ManagedRow,
  bearer: string,
  proposalToken: string,
) {
  const proposal = decode(proposalToken, bearer);
  const proposalDigest = digest(proposalToken);
  const audit = new AuditLogService(db);
  const service = new ReservationService(
    db,
    audit,
    new HoldService(db, audit),
    new IdempotencyService(new PrismaIdempotencyStore(db)),
  );
  try {
    await service.modifyReservation({
      reservationId: initial.id,
      restaurantId: initial.restaurantId,
      actor: 'customer:personal-link',
      publicClient: false,
      startsAt: new Date(proposal.startsAt),
      endsAt: new Date(proposal.endsAt),
      partySize: proposal.partySize,
      auditMetadata: { source: 'personal_reservation', proposalDigest },
      beforeModify: async (tx, current) => {
        if (!verifyReservationManagementToken(bearer, current))
          throw new ModificationConflict('Lien invalide ou expiré.');
        // Replay may acknowledge a committed change, even after its short offer expired.
        if (
          current.startsAt?.toISOString() === proposal.startsAt &&
          current.endsAt?.toISOString() === proposal.endsAt &&
          current.partySize === proposal.partySize
        ) {
          const applied = await tx.reservationAuditLog.findFirst({
            where: {
              reservationId: current.id,
              actor: 'customer:personal-link',
              event: 'reservation_fields_changed',
              metadata: { path: ['proposalDigest'], equals: proposalDigest },
            },
            select: { id: true },
          });
          if (applied) return;
        }
        const fresh = await tx.reservation.findUniqueOrThrow({
          where: { id: current.id, restaurantId: current.restaurantId },
          include: cancellationRelations,
        });
        const ctx = await context(tx, fresh, bearer);
        if (
          Date.now() >= proposal.expires * 1000 ||
          revision(fresh) !== proposal.revision ||
          ctx.settingsHash !== proposal.settings ||
          proposal.partySize > ctx.maxPartySize
        )
          throw new ModificationConflict(
            'La réservation ou les conditions ont changé. Veuillez consulter les disponibilités à nouveau.',
          );
        const target = {
          ...fresh,
          startsAt: new Date(proposal.startsAt),
          reservedAt: new Date(proposal.startsAt),
        };
        if (
          !reservationSelfServiceConditions(target, bearer, ctx.restaurant.timezone).available ||
          utcToZonedParts(target.startsAt, ctx.restaurant.timezone).date !==
            utcToZonedParts(fresh.startsAt ?? fresh.reservedAt, ctx.restaurant.timezone).date
        )
          throw new ModificationConflict(contact);
        const available = await new CapacityAwareAvailabilityService(db).getAvailability(
          {
            restaurantId: fresh.restaurantId,
            date: proposal.date,
            partySize: proposal.partySize,
            excludeReservationId: fresh.id,
            defaultFloorOnly: true,
            minLeadTimeMinutes: ctx.minLeadTimeMinutes,
          },
          tx,
        );
        if (!available.slots.some((slot) => slot.time === proposal.time && slot.available))
          throw new ModificationConflict(
            'Ce créneau vient d’être pris. Votre réservation initiale est conservée.',
          );
      },
    });
  } catch (error) {
    if (
      error instanceof ReservationSlotUnavailableError ||
      error instanceof ReservationModificationNotAllowedError
    )
      throw new ModificationConflict(
        'Ce changement n’est plus disponible. Votre réservation initiale est conservée.',
      );
    throw error;
  }
}

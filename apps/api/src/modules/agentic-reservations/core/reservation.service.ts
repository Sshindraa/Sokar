/**
 * Reservation service : crée, transitionne, annule les réservations.
 *
 * Pipeline createReservation :
 *   1. validateReservationAgainstPolicy
 *   2. checkAvailability (peut être court-circuité par un holdToken fourni)
 *   3. IdempotencyService.reserve (si canal agentic)
 *   4. HoldService.consumeHold (si holdToken fourni)
 *   5. INSERT Reservation + ReservationAuditLog dans une transaction
 *   6. IdempotencyService.complete
 *
 * Pipeline cancelReservation :
 *   1. assertCanTransition (state machine)
 *   2. UPDATE state + releaseHold (si applicable) dans une transaction
 *   3. audit log
 *
 * Pipeline transitionState (utilisé par SEATED / HONORED / NO_SHOW) :
 *   1. assertCanTransition
 *   2. UPDATE state + audit dans une transaction
 */

import { Prisma } from '@prisma/client';
import type { PrismaClient, ReservationState } from '@prisma/client';
import { AuditLogService } from './audit-log.service.js';
import { logger } from '../../../shared/logger/pino';
import {
  generateHoldToken,
  HoldAlreadyConsumedError,
  HoldConflictError,
  HoldNotFoundError,
  HoldService,
} from './hold.service.js';
import { IdempotencyPendingError, IdempotencyService } from './idempotency.service.js';
import { type PolicySnapshot, validateReservationAgainstPolicy } from './policies.service.js';
import { type ReservationChannel, assertCanTransition } from './state-machine.js';
import { GiftCardService } from '../../gift-cards/gift-card.service.js';
import type { GiftCardApplicationResult } from '../../gift-cards/gift-card.types.js';

export class ReservationNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Reservation not found: id=${id}`);
    this.name = 'ReservationNotFoundError';
  }
}

export class ReservationAlreadyExistsError extends Error {
  constructor(public readonly idempotencyKey: string) {
    super(`Reservation already exists for this idempotency key: ${idempotencyKey}`);
    this.name = 'ReservationAlreadyExistsError';
  }
}

export class ReservationSlotUnavailableError extends Error {
  constructor(
    public readonly restaurantId: string,
    public readonly startsAt: Date,
    public readonly partySize: number,
  ) {
    super(
      `Reservation slot unavailable: restaurant=${restaurantId} startsAt=${startsAt.toISOString()} party=${partySize}`,
    );
    this.name = 'ReservationSlotUnavailableError';
  }
}

export type CreateReservationInput = {
  restaurantId: string;
  partySize: number;
  startsAt: Date;
  endsAt: Date;
  customerName: string;
  customerPhone: string;
  channel: ReservationChannel;
  policy: PolicySnapshot;
  actor: string;
  /** Optionnel : hold token pour finaliser un hold existant */
  holdToken?: string;
  /** Optionnel : consentements collectés (RGPD) */
  consents?: {
    reservationProcessing: boolean;
    transactionalSms: boolean;
    transactionalEmail: boolean;
    marketingOptIn: boolean;
  };
  /** Optionnel : policy snapshot figé à T */
  cancellationPolicySnap?: unknown;
  noShowPolicySnap?: unknown;
  /** Optionnel : requêtes spéciales */
  specialRequests?: string;
  /** Optionnel : tableId pré-allouée (ex. Connect hold) */
  tableId?: string | null;
  /** Optionnel : code carte cadeau à appliquer */
  giftCardCode?: string;
  /** Optionnel : montant estimé de la réservation pour l'application de la carte cadeau */
  giftCardReservationAmount?: number;
};

export type CreateReservationResult = {
  reservationId: string;
  state: ReservationState;
  reused: boolean;
  giftCardApplication?: GiftCardApplicationResult;
};

export class ReservationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditLogService,
    private readonly holds: HoldService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Crée une réservation. Le flow complet est dans le service.
   */
  async createReservation(
    input: CreateReservationInput,
    idempotency: { scope: string; key: string; payloadHash: string; ttlSeconds: number },
  ): Promise<CreateReservationResult> {
    // 1. Valider la policy
    validateReservationAgainstPolicy(input.policy, {
      partySize: input.partySize,
      startsAt: input.startsAt,
      channel: input.channel,
    });

    // 2. Si un holdToken est fourni, vérifier qu'il existe et est valide
    let holdId: string | null = null;
    let tableId: string | null = input.tableId ?? null;
    if (input.holdToken) {
      const hold = await this.holds.findActiveByToken(input.holdToken);
      if (!hold) {
        throw new Error(`Invalid or expired hold token: ${input.holdToken}`);
      }
      if (hold.restaurantId !== input.restaurantId) {
        throw new Error('Hold does not match restaurant');
      }
      if (hold.partySize !== input.partySize) {
        throw new Error('Hold party size mismatch');
      }
      if (hold.type !== 'HOLD') {
        throw new Error('Provided token is a quote, not a hold');
      }
      holdId = hold.id;
      tableId = tableId ?? hold.tableId ?? null;
    }

    // 3. Réserver l'idempotence (Postgres first, Redis cache)
    const reserveResult = await this.idempotency.reserve({
      scope: idempotency.scope,
      key: idempotency.key,
      payloadHash: idempotency.payloadHash,
      ttlSeconds: idempotency.ttlSeconds,
    });

    if (reserveResult === 'reused') {
      const existing = await this.waitForCompletedIdempotency(
        idempotency.scope,
        idempotency.key,
        idempotency.payloadHash,
      );
      if (existing) {
        return existing;
      }
      throw new IdempotencyPendingError(idempotency.scope, idempotency.key);
    }

    // 4. INSERT dans une transaction
    let reservationId: string;
    try {
      reservationId = await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        let consumedHoldId: string | null = null;
        let shouldConsumeAfterReservation = false;

        if (holdId) {
          const hold = await tx.agenticHold.findUnique({ where: { id: holdId } });
          if (!hold || hold.type !== 'HOLD') throw new HoldNotFoundError(input.holdToken ?? holdId);
          if (hold.status === 'CONSUMED') throw new HoldAlreadyConsumedError(hold.id);
          if (
            hold.status !== 'ACTIVE' ||
            hold.expiresAt.getTime() <= now.getTime() ||
            hold.restaurantId !== input.restaurantId ||
            hold.partySize !== input.partySize ||
            hold.slotStart.getTime() !== input.startsAt.getTime()
          ) {
            throw new HoldNotFoundError(input.holdToken ?? holdId);
          }

          const consumed = await tx.agenticHold.updateMany({
            where: {
              id: hold.id,
              type: 'HOLD',
              status: 'ACTIVE',
              expiresAt: { gt: now },
            },
            data: {
              status: 'CONSUMED',
              consumedAt: now,
            },
          });
          if (consumed.count !== 1) {
            throw new HoldAlreadyConsumedError(hold.id);
          }
          consumedHoldId = hold.id;
        } else {
          await this.expireOverdueHoldForSlot(tx, {
            restaurantId: input.restaurantId,
            partySize: input.partySize,
            slotStart: input.startsAt,
            now,
          });

          try {
            const syntheticHold = await tx.agenticHold.create({
              data: {
                restaurantId: input.restaurantId,
                type: 'HOLD',
                partySize: input.partySize,
                slotStart: input.startsAt,
                slotEnd: input.endsAt,
                channel: input.channel,
                holdToken: generateHoldToken(),
                expiresAt: new Date(now.getTime() + input.policy.holdTtlSeconds * 1000),
                status: 'ACTIVE',
                policyVersion: input.policy.policyVersion,
              },
            });
            consumedHoldId = syntheticHold.id;
            shouldConsumeAfterReservation = true;
          } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
              throw new HoldConflictError(input.restaurantId, input.startsAt, input.partySize);
            }
            throw err;
          }
        }

        const blockingReservation = await this.findBlockingReservation(tx, {
          restaurantId: input.restaurantId,
          partySize: input.partySize,
          startsAt: input.startsAt,
        });
        if (blockingReservation) {
          throw new ReservationSlotUnavailableError(
            input.restaurantId,
            input.startsAt,
            input.partySize,
          );
        }

        const initialState: ReservationState = input.policy.requireManualValidation
          ? 'PENDING'
          : 'CONFIRMED';

        const reservation = await tx.reservation.create({
          data: {
            restaurantId: input.restaurantId,
            customerName: input.customerName,
            customerPhone: input.customerPhone,
            partySize: input.partySize,
            reservedAt: input.startsAt,
            channel: input.channel,
            state: initialState,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            specialRequests: input.specialRequests,
            createdByClient: input.actor,
            cancellationPolicySnap: input.cancellationPolicySnap
              ? (input.cancellationPolicySnap as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            noShowPolicySnap: input.noShowPolicySnap
              ? (input.noShowPolicySnap as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            consents: (input.consents ?? {}) as Prisma.InputJsonValue,
            privacyPolicyVersion: input.policy.policyVersion,
            idempotencyScope: idempotency.scope,
            idempotencyKey: idempotency.key,
            idempotencyPayloadHash: idempotency.payloadHash,
            consumedHoldId,
            tableId,
            status: 'CONFIRMED', // legacy enum, aligner avec state
          },
        });

        if (consumedHoldId) {
          if (shouldConsumeAfterReservation) {
            const consumed = await tx.agenticHold.updateMany({
              where: {
                id: consumedHoldId,
                status: 'ACTIVE',
              },
              data: {
                status: 'CONSUMED',
                consumedAt: now,
                reservationId: reservation.id,
              },
            });
            if (consumed.count !== 1) {
              throw new HoldAlreadyConsumedError(consumedHoldId);
            }
          } else {
            await tx.agenticHold.update({
              where: { id: consumedHoldId },
              data: { reservationId: reservation.id },
            });
          }

          await tx.reservationAuditLog.create({
            data: {
              event: 'hold_consumed',
              reservationId: reservation.id,
              holdId: consumedHoldId,
              actor: input.actor,
              metadata: {
                slotStart: input.startsAt.toISOString(),
                partySize: input.partySize,
              },
            },
          });
        }

        // Audit
        await tx.reservationAuditLog.create({
          data: {
            event: 'reservation_created',
            reservationId: reservation.id,
            holdId: consumedHoldId,
            actor: input.actor,
            toState: initialState,
            metadata: {
              partySize: input.partySize,
              channel: input.channel,
              requiresManualValidation: input.policy.requireManualValidation,
            },
          },
        });

        return reservation.id;
      });
    } catch (err) {
      await this.idempotency.fail({ scope: idempotency.scope, key: idempotency.key });
      throw err;
    }

    // 5. Marquer l'idempotence comme complétée
    await this.idempotency.complete({
      scope: idempotency.scope,
      key: idempotency.key,
      payloadHash: idempotency.payloadHash,
      reservationId,
    });

    const final = await this.prisma.reservation.findUnique({ where: { id: reservationId } });

    let giftCardApplication: GiftCardApplicationResult | undefined;
    if (
      input.giftCardCode &&
      input.giftCardReservationAmount &&
      input.giftCardReservationAmount > 0
    ) {
      try {
        const giftCardService = new GiftCardService(this.prisma);
        giftCardApplication = await giftCardService.applyToReservation({
          code: input.giftCardCode,
          restaurantId: input.restaurantId,
          reservationId,
          reservationAmount: input.giftCardReservationAmount,
        });

        if (giftCardApplication.paymentStatus !== 'COMPLEMENT_REQUIRED') {
          await this.prisma.reservation.update({
            where: { id: reservationId },
            data: {
              giftCardRedemptionSnap: {
                giftCardId: giftCardApplication.giftCardId,
                appliedAmount: giftCardApplication.appliedAmount,
                remainingAmount: giftCardApplication.remainingAmount,
                paymentStatus: giftCardApplication.paymentStatus,
                complementAmount: giftCardApplication.complementAmount,
              } as Prisma.InputJsonValue,
            },
          });
        }
      } catch (err) {
        logger.warn(
          { err, reservationId, giftCardCode: input.giftCardCode },
          'gift card application failed after reservation creation',
        );
      }
    }

    return {
      reservationId,
      state: (final?.state ?? 'CONFIRMED') as ReservationState,
      reused: false,
      giftCardApplication,
    };
  }

  /**
   * Transitionne une réservation vers un nouvel état.
   * Jette InvalidStateTransitionError si la transition n'est pas autorisée.
   */
  async transitionState(args: {
    reservationId: string;
    toState: ReservationState;
    actor: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({
        where: { id: args.reservationId },
      });
      if (!reservation) throw new ReservationNotFoundError(args.reservationId);

      const fromState = reservation.state as ReservationState;
      assertCanTransition(fromState, args.toState);

      await tx.reservation.update({
        where: { id: reservation.id },
        data: { state: args.toState },
      });

      const event = this.eventForTransition(args.toState);
      await tx.reservationAuditLog.create({
        data: {
          event,
          reservationId: reservation.id,
          actor: args.actor,
          fromState,
          toState: args.toState,
          metadata: (args.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    });
  }

  /**
   * Annule une réservation et libère le hold si applicable.
   */
  async cancelReservation(args: {
    reservationId: string;
    actor: string;
    reason?: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({
        where: { id: args.reservationId },
      });
      if (!reservation) throw new ReservationNotFoundError(args.reservationId);

      const fromState = reservation.state as ReservationState;
      assertCanTransition(fromState, 'CANCELLED');

      await tx.reservation.update({
        where: { id: reservation.id },
        data: { state: 'CANCELLED', status: 'CANCELLED' },
      });

      // Libérer le hold si encore actif
      if (reservation.consumedHoldId) {
        const hold = await tx.agenticHold.findUnique({
          where: { id: reservation.consumedHoldId },
        });
        if (hold && hold.status === 'CONSUMED') {
          // Le hold est déjà consommé, on log juste l'événement
          await tx.reservationAuditLog.create({
            data: {
              event: 'hold_released',
              holdId: hold.id,
              reservationId: reservation.id,
              actor: args.actor,
              metadata: { reason: 'reservation_cancelled' },
            },
          });
        }
      }

      await tx.reservationAuditLog.create({
        data: {
          event: 'reservation_cancelled',
          reservationId: reservation.id,
          actor: args.actor,
          fromState,
          toState: 'CANCELLED',
          metadata: (args.reason ? { reason: args.reason } : {}) as Prisma.InputJsonValue,
        },
      });
    });
  }

  private eventForTransition(to: ReservationState): string {
    switch (to) {
      case 'SEATED':
        return 'reservation_seated';
      case 'HONORED':
        return 'reservation_honored';
      case 'NO_SHOW':
        return 'reservation_no_show';
      case 'CANCELLED':
        return 'reservation_cancelled';
      case 'FAILED':
        return 'reservation_failed';
      case 'EXPIRED':
        return 'hold_expired';
      default:
        return 'state_transition';
    }
  }

  private async waitForCompletedIdempotency(
    scope: string,
    key: string,
    payloadHash: string,
  ): Promise<CreateReservationResult | null> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const existing = await this.idempotency.lookup(scope, key, payloadHash);
      if (existing.kind === 'conflict') {
        throw new ReservationAlreadyExistsError(key);
      }
      if (existing.kind === 'hit') {
        const reservation = await this.prisma.reservation.findUnique({
          where: { id: existing.reservationId },
        });
        if (reservation) {
          return {
            reservationId: reservation.id,
            state: reservation.state as ReservationState,
            reused: true,
          };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  }

  private async findBlockingReservation(
    tx: Prisma.TransactionClient,
    args: {
      restaurantId: string;
      partySize: number;
      startsAt: Date;
    },
  ): Promise<{ id: string } | null> {
    return tx.reservation.findFirst({
      where: {
        restaurantId: args.restaurantId,
        partySize: args.partySize,
        OR: [{ reservedAt: args.startsAt }, { startsAt: args.startsAt }],
        state: { in: ['PENDING', 'CONFIRMED', 'SEATED'] },
      },
      select: { id: true },
    });
  }

  private async expireOverdueHoldForSlot(
    tx: Prisma.TransactionClient,
    args: {
      restaurantId: string;
      partySize: number;
      slotStart: Date;
      now: Date;
    },
  ): Promise<void> {
    const overdue = await tx.agenticHold.findMany({
      where: {
        restaurantId: args.restaurantId,
        partySize: args.partySize,
        slotStart: args.slotStart,
        type: 'HOLD',
        status: 'ACTIVE',
        expiresAt: { lt: args.now },
      },
      select: { id: true, restaurantId: true },
    });

    for (const hold of overdue) {
      const updated = await tx.agenticHold.updateMany({
        where: {
          id: hold.id,
          status: 'ACTIVE',
          expiresAt: { lt: args.now },
        },
        data: { status: 'EXPIRED' },
      });
      if (updated.count !== 1) continue;

      await tx.reservationAuditLog.create({
        data: {
          event: 'hold_expired',
          holdId: hold.id,
          actor: 'system:reservation-service',
          metadata: { restaurantId: hold.restaurantId },
        },
      });
    }
  }
}

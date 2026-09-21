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
import type {
  PrismaClient,
  Reservation,
  ReservationState,
  ReservationStatus,
} from '@prisma/client';
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
import {
  type ReservationChannel,
  assertCanTransition,
  InvalidStateInvariantError,
} from './state-machine.js';
import {
  inferReservationObservationSource,
  observeReservationMutation,
  reservationCapacityEffect,
} from '../../../shared/observability/reservation-contract';
import { ACTIVE_RESERVATION_STATES } from '../../../shared/reservations/capacity.js';
import {
  creationProjection,
  transitionProjection,
  type CreatableReservationState,
} from '../../../shared/reservations/reservation-state.js';
import { GiftCardService } from '../../gift-cards/gift-card.service.js';
import { TableAllocationService } from '../../floor-plan/table-allocation.service.js';
import { CapacityAwareAvailabilityService } from '../../floor-plan/availability-capacity-aware.service.js';
import type { GiftCardApplicationResult } from '../../gift-cards/gift-card.types.js';
import {
  IDEMPOTENCY_POLL_INTERVAL_MS,
  IDEMPOTENCY_MAX_WAIT_ATTEMPTS,
} from '../../../shared/constants/timeouts.js';
import { DEFAULT_TRANSACTION_OPTIONS } from '../../../shared/db/transaction-options';
import { CustomerService } from '../../customers/customer.service';
import {
  deactivateMarketingConversions,
  recordMarketingAttributionClick,
  recordMarketingConversion,
  recordMarketingHonoredConversions,
} from '../../marketing/marketing-attribution.service';

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
  /** Optionnel : token signé d'une campagne marketing */
  marketingAttributionToken?: string;
};

export type CreateReservationResult = {
  reservationId: string;
  state: ReservationState;
  reused: boolean;
  giftCardApplication?: GiftCardApplicationResult;
};

function reservationLifecycleEvent(
  state: ReservationState,
): 'RESERVATION_CANCELLED' | 'RESERVATION_HONORED' | 'RESERVATION_NO_SHOW' | null {
  switch (state) {
    case 'CANCELLED':
      return 'RESERVATION_CANCELLED';
    case 'HONORED':
      return 'RESERVATION_HONORED';
    case 'NO_SHOW':
      return 'RESERVATION_NO_SHOW';
    default:
      return null;
  }
}

export class ReservationService {
  private readonly tableAllocation: TableAllocationService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditLogService,
    private readonly holds: HoldService,
    private readonly idempotency: IdempotencyService,
  ) {
    this.tableAllocation = new TableAllocationService(this.prisma);
  }

  /**
   * Crée une réservation. Le flow complet est dans le service.
   */
  async createReservation(
    input: CreateReservationInput,
    idempotency: { scope: string; key: string; payloadHash: string; ttlSeconds: number },
  ): Promise<CreateReservationResult> {
    const observationSource = inferReservationObservationSource(input.actor, input.channel);

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

    let customerId: string | null = null;
    try {
      customerId = (
        await CustomerService.lookupOrCreate(
          input.restaurantId,
          input.customerPhone,
          input.customerName,
        )
      ).id;
    } catch (error) {
      logger.warn(
        {
          err: error instanceof Error ? error.message : String(error),
          restaurantId: input.restaurantId,
        },
        '[AgenticReservationService] Customer CRM dual-write unavailable',
      );
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
        observeReservationMutation({
          source: observationSource,
          operation: 'create_replay',
          state: existing.state,
          idempotency: 'reused',
          audit: 'not_applicable',
          notification: 'not_applicable',
          capacity: 'unchanged',
          mutated: false,
        });
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

        // Les réservations/holds sans table utilisent une capacité globale
        // conservatrice. Le verrou advisory est posé au niveau du restaurant
        // (et non du seul startsAt) : deux créneaux qui se chevauchent doivent
        // être sérialisés, sinon chacun pourrait lire l'absence de blocker
        // avant le commit de l'autre.
        await this.lockCapacitySlot(tx, input.restaurantId);
        const globalBlocker = await this.findGlobalUnassignedBlocker(tx, {
          restaurantId: input.restaurantId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          now,
          excludeHoldId: holdId,
        });
        if (globalBlocker) {
          throw new ReservationSlotUnavailableError(
            input.restaurantId,
            input.startsAt,
            input.partySize,
          );
        }

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

          await this.lockActiveHold(tx, hold.id, now);

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

        // Vérifier que la table pré-allouée est toujours disponible.
        if (tableId) {
          const locked = await this.tableAllocation.lockTable(tx, tableId);
          if (!locked) {
            throw new ReservationSlotUnavailableError(
              input.restaurantId,
              input.startsAt,
              input.partySize,
            );
          }

          const stillAvailable = await this.tableAllocation.isTableAvailable(
            {
              tableId,
              startsAt: input.startsAt,
              endsAt: input.endsAt,
              // Le hold synthétique (ou le hold Connect consommé) est la
              // réservation de capacité courante ; il ne doit pas se
              // détecter lui-même comme blocker global.
              excludeHoldId: consumedHoldId ?? undefined,
            },
            tx,
          );
          if (!stillAvailable) {
            throw new ReservationSlotUnavailableError(
              input.restaurantId,
              input.startsAt,
              input.partySize,
            );
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

        const initialState: CreatableReservationState = input.policy.requireManualValidation
          ? 'PENDING'
          : 'CONFIRMED';

        const reservation = await tx.reservation.create({
          data: {
            restaurantId: input.restaurantId,
            ...(customerId ? { customerId } : {}),
            customerName: input.customerName,
            customerPhone: input.customerPhone,
            partySize: input.partySize,
            reservedAt: input.startsAt,
            channel: input.channel,
            ...creationProjection(initialState),
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
          },
        });

        if (consumedHoldId) {
          if (shouldConsumeAfterReservation) {
            await this.lockActiveHold(tx, consumedHoldId, now);
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
      }, DEFAULT_TRANSACTION_OPTIONS);
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

    try {
      await CustomerService.recordReservationEvent({
        restaurantId: input.restaurantId,
        customerId,
        phone: input.customerPhone,
        name: input.customerName,
        reservationId,
        eventType: 'RESERVATION_CREATED',
        occurredAt: new Date(),
      });
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.message : String(error), reservationId },
        '[AgenticReservationService] Customer timeline projection unavailable',
      );
    }

    // Campaign links are optional and best-effort: a malformed or expired
    // token must never block a valid agentic/web reservation. Resolve it to the
    // same tenant and customer before recording the created conversion.
    if (input.marketingAttributionToken && customerId) {
      try {
        const link = await recordMarketingAttributionClick({
          token: input.marketingAttributionToken,
        });
        if (link && link.restaurantId === input.restaurantId && link.customerId === customerId) {
          await recordMarketingConversion({
            restaurantId: input.restaurantId,
            campaignId: link.campaignId,
            customerId,
            reservationId,
            conversionType: 'RESERVATION_CREATED',
            attributedAt: new Date(),
            windowEndsAt: link.expiresAt,
          });
        }
      } catch (error) {
        logger.warn(
          {
            err: error instanceof Error ? error.message : String(error),
            reservationId,
          },
          '[AgenticReservationService] Marketing attribution projection unavailable',
        );
      }
    }

    let giftCardApplication: GiftCardApplicationResult | undefined;
    let giftCardSnapshotUpdated = false;
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
          giftCardSnapshotUpdated = true;
        }
      } catch (err) {
        logger.warn(
          { err, reservationId, giftCardCode: input.giftCardCode },
          'gift card application failed after reservation creation',
        );
      }
    }

    observeReservationMutation({
      source: observationSource,
      operation: 'create',
      status: final?.status,
      state: final?.state ?? 'CONFIRMED',
      idempotency: 'keyed',
      audit: 'written',
      notification: 'not_sent',
      capacity: 'reserved',
    });
    if (giftCardSnapshotUpdated) {
      observeReservationMutation({
        source: 'gift_card',
        operation: 'update',
        status: final?.status,
        state: final?.state ?? 'CONFIRMED',
        idempotency: 'not_applicable',
        audit: 'not_applicable',
        notification: 'not_applicable',
        capacity: 'unchanged',
      });
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
   * Jette InvalidStateTransitionError ou InvalidStateInvariantError si la transition n'est pas autorisée.
   */
  async transitionState(args: {
    reservationId: string;
    restaurantId: string;
    toState: ReservationState;
    actor: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    let fromState: ReservationState | undefined;
    let statusAfterTransition: ReservationStatus | undefined;
    let customerForProjection:
      | { customerId: string | null; phone: string | null; name: string }
      | undefined;
    await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({
        where: { id: args.reservationId, restaurantId: args.restaurantId },
      });
      if (!reservation) throw new ReservationNotFoundError(args.reservationId);

      customerForProjection = {
        customerId: reservation.customerId,
        phone: reservation.customerPhone,
        name: reservation.customerName,
      };

      fromState = reservation.state as ReservationState;
      assertCanTransition(fromState, args.toState, reservation);

      const projection = transitionProjection(
        args.toState,
        reservation.status as ReservationStatus,
      );
      statusAfterTransition = projection.status;

      if (args.toState === 'SEATED') {
        if (!reservation.tableId) {
          throw new InvalidStateInvariantError('SEATED requires a tableId');
        }
        const now = new Date();
        if (reservation.endsAt && reservation.endsAt <= now) {
          throw new InvalidStateInvariantError('Cannot seat a reservation that has already ended');
        }
        const startsAt = now;
        const endsAt = reservation.endsAt ?? new Date(now.getTime() + 2 * 60 * 60 * 1000);
        await this.tableAllocation.assertTableAvailableForSeating(
          {
            restaurantId: args.restaurantId,
            tableId: reservation.tableId,
            partySize: reservation.partySize,
            startsAt,
            endsAt,
            excludeReservationId: reservation.id,
          },
          tx,
        );
      }

      await tx.reservation.update({
        where: { id: reservation.id },
        data: projection,
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

    const capacity = reservationCapacityEffect(fromState, args.toState);
    if (capacity !== 'unchanged') {
      // Les transitions terminales libèrent la capacité logique. Le cache
      // doit être invalidé après le commit, sinon une réponse availability
      // peut rester bloquée jusqu'à son TTL.
      await CapacityAwareAvailabilityService.invalidateAvailability(args.restaurantId);
    }
    observeReservationMutation({
      source: inferReservationObservationSource(args.actor),
      operation: 'transition',
      status: statusAfterTransition,
      state: args.toState,
      idempotency: 'not_applicable',
      audit: 'written',
      notification: 'not_sent',
      capacity,
    });
    if (customerForProjection && reservationLifecycleEvent(args.toState)) {
      try {
        await CustomerService.recordReservationEvent({
          restaurantId: args.restaurantId,
          customerId: customerForProjection.customerId,
          phone: customerForProjection.phone,
          name: customerForProjection.name,
          reservationId: args.reservationId,
          eventType: reservationLifecycleEvent(args.toState)!,
          occurredAt: new Date(),
        });
      } catch (error) {
        logger.warn(
          {
            err: error instanceof Error ? error.message : String(error),
            reservationId: args.reservationId,
          },
          '[AgenticReservationService] Customer lifecycle projection unavailable',
        );
      }
    }
    if (args.toState === 'HONORED' && customerForProjection?.customerId) {
      try {
        await recordMarketingHonoredConversions({
          restaurantId: args.restaurantId,
          reservationId: args.reservationId,
          customerId: customerForProjection.customerId,
          honoredAt: new Date(),
        });
      } catch (error) {
        logger.warn(
          {
            err: error instanceof Error ? error.message : String(error),
            reservationId: args.reservationId,
          },
          '[AgenticReservationService] Marketing honored conversion unavailable',
        );
      }
    }
    if (args.toState === 'CANCELLED') {
      try {
        await deactivateMarketingConversions({
          restaurantId: args.restaurantId,
          reservationId: args.reservationId,
        });
      } catch (error) {
        logger.warn(
          {
            err: error instanceof Error ? error.message : String(error),
            reservationId: args.reservationId,
          },
          '[AgenticReservationService] Marketing conversion deactivation unavailable',
        );
      }
    }
  }

  /**
   * Annule une réservation et libère le hold si applicable.
   */
  async cancelReservation(args: {
    reservationId: string;
    actor: string;
    reason?: string;
  }): Promise<void> {
    const reservation = await this.prisma.$transaction<Reservation>(async (tx) => {
      const row = await tx.reservation.findUnique({
        where: { id: args.reservationId },
      });
      if (!row) throw new ReservationNotFoundError(args.reservationId);

      const fromState = row.state as ReservationState;
      assertCanTransition(fromState, 'CANCELLED', row);

      await tx.reservation.update({
        where: { id: row.id },
        data: transitionProjection('CANCELLED', row.status as ReservationStatus),
      });

      // Libérer le hold si encore actif
      if (row.consumedHoldId) {
        const hold = await tx.agenticHold.findUnique({
          where: { id: row.consumedHoldId },
        });
        if (hold && hold.status === 'CONSUMED') {
          // Le hold est déjà consommé, on log juste l'événement
          await tx.reservationAuditLog.create({
            data: {
              event: 'hold_released',
              holdId: hold.id,
              reservationId: row.id,
              actor: args.actor,
              metadata: { reason: 'reservation_cancelled' },
            },
          });
        }
      }

      await tx.reservationAuditLog.create({
        data: {
          event: 'reservation_cancelled',
          reservationId: row.id,
          actor: args.actor,
          fromState,
          toState: 'CANCELLED',
          metadata: (args.reason ? { reason: args.reason } : {}) as Prisma.InputJsonValue,
        },
      });

      return row;
    });

    try {
      await CustomerService.recordReservationEvent({
        restaurantId: reservation.restaurantId,
        customerId: reservation.customerId,
        phone: reservation.customerPhone,
        name: reservation.customerName,
        reservationId: reservation.id,
        eventType: 'RESERVATION_CANCELLED',
        occurredAt: new Date(),
      });
    } catch (error) {
      logger.warn(
        {
          err: error instanceof Error ? error.message : String(error),
          reservationId: reservation.id,
        },
        '[AgenticReservationService] Customer cancellation projection unavailable',
      );
    }

    try {
      await deactivateMarketingConversions({
        restaurantId: reservation.restaurantId,
        reservationId: reservation.id,
      });
    } catch (error) {
      logger.warn(
        {
          err: error instanceof Error ? error.message : String(error),
          reservationId: reservation.id,
        },
        '[AgenticReservationService] Marketing conversion deactivation unavailable',
      );
    }

    await CapacityAwareAvailabilityService.invalidateAvailability(reservation.restaurantId);
    observeReservationMutation({
      source: inferReservationObservationSource(args.actor),
      operation: 'cancel',
      status: 'CANCELLED',
      state: 'CANCELLED',
      idempotency: 'not_applicable',
      audit: 'written',
      notification: 'not_sent',
      capacity: 'released',
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
    for (let attempt = 0; attempt < IDEMPOTENCY_MAX_WAIT_ATTEMPTS; attempt++) {
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
      await new Promise((resolve) => setTimeout(resolve, IDEMPOTENCY_POLL_INTERVAL_MS));
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

  private async findGlobalUnassignedBlocker(
    tx: Prisma.TransactionClient,
    args: {
      restaurantId: string;
      startsAt: Date;
      endsAt: Date;
      now: Date;
      excludeHoldId?: string | null;
    },
  ): Promise<{ kind: 'reservation' | 'hold'; id: string } | null> {
    const reservation = await tx.reservation.findFirst({
      where: {
        restaurantId: args.restaurantId,
        tableId: null,
        state: { in: [...ACTIVE_RESERVATION_STATES] },
        OR: [
          {
            startsAt: { lt: args.endsAt },
            endsAt: { gt: args.startsAt },
          },
          {
            startsAt: { gte: args.startsAt, lt: args.endsAt },
            endsAt: null,
          },
          {
            startsAt: null,
            reservedAt: { gte: args.startsAt, lt: args.endsAt },
          },
        ],
      },
      select: { id: true },
    });
    if (reservation) return { kind: 'reservation', id: reservation.id };

    const hold = await tx.agenticHold.findFirst({
      where: {
        restaurantId: args.restaurantId,
        type: 'HOLD',
        status: 'ACTIVE',
        tableId: null,
        expiresAt: { gt: args.now },
        ...(args.excludeHoldId ? { id: { not: args.excludeHoldId } } : {}),
        slotStart: { lt: args.endsAt },
        slotEnd: { gt: args.startsAt },
      },
      select: { id: true },
    });
    return hold ? { kind: 'hold', id: hold.id } : null;
  }

  private async lockCapacitySlot(
    tx: Prisma.TransactionClient,
    restaurantId: string,
  ): Promise<void> {
    const query = Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${restaurantId}, 0))`;
    if (typeof tx.$executeRaw === 'function') {
      await tx.$executeRaw(query);
      return;
    }
    await tx.$queryRaw(query);
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

  private async lockActiveHold(
    tx: Prisma.TransactionClient,
    holdId: string,
    now: Date,
  ): Promise<void> {
    const locked = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM agentic_holds WHERE id = ${holdId} AND status = 'ACTIVE' AND type = 'HOLD' AND expires_at > ${now} AT TIME ZONE 'UTC' FOR UPDATE`,
    );
    if (!locked || locked.length === 0) {
      throw new HoldAlreadyConsumedError(holdId);
    }
  }
}

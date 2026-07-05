import type { PrismaClient } from '@prisma/client';
import { ReservationService } from '../agentic-reservations/core/reservation.service';
import { AuditLogService } from '../agentic-reservations/core/audit-log.service';
import { HoldService } from '../agentic-reservations/core/hold.service';
import {
  IdempotencyService,
  computeIdempotencyScope,
} from '../agentic-reservations/core/idempotency.service';
import { PrismaIdempotencyStore } from '../agentic-reservations/core/prisma-store';
import {
  buildPolicySnapshot,
  type PolicySnapshot,
} from '../agentic-reservations/core/policies.service';
import { resolveServiceDurationMinutes } from '../floor-plan/floor-plan.types.js';
import { zonedTimeToUtc } from '../floor-plan/availability-capacity-aware.service.js';
import { GiftCardService } from './gift-card.service';
import { GiftCardSlotsService } from './gift-card-slots.service';
import { GiftCardBookResult } from './gift-card.types.js';

export class GiftCardBookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GiftCardBookError';
  }
}

export class GiftCardBookService {
  private readonly giftCardService: GiftCardService;
  private readonly slotsService: GiftCardSlotsService;
  private readonly reservations: ReservationService;

  constructor(
    private readonly prisma: PrismaClient,
    slotsService?: GiftCardSlotsService,
  ) {
    this.giftCardService = new GiftCardService(prisma);
    this.slotsService = slotsService ?? new GiftCardSlotsService(prisma);
    const audit = new AuditLogService(prisma);
    const holds = new HoldService(prisma, audit);
    const idempotencyStore = new PrismaIdempotencyStore(prisma);
    const idempotency = new IdempotencyService(idempotencyStore);
    this.reservations = new ReservationService(prisma, audit, holds, idempotency);
  }

  async book(args: {
    code: string;
    slotIndex: number;
    customer: {
      firstName: string;
      lastName?: string;
      phone: string;
      email?: string;
    };
  }): Promise<GiftCardBookResult> {
    const { code, slotIndex, customer } = args;

    const validation = await this.giftCardService.validateCode(code);
    if (!validation.valid) {
      throw new GiftCardBookError(`Carte cadeau invalide : ${validation.reason}`);
    }

    const cardWithPack = await this.giftCardService.findByCodeOrShortCodeWithPack(code);
    if (!cardWithPack) {
      throw new GiftCardBookError('Carte cadeau introuvable');
    }

    const slots = await this.slotsService.suggestSlots({ giftCardCode: code });
    const chosen = slots[slotIndex];
    if (!chosen) {
      throw new GiftCardBookError('Créneau invalide');
    }

    const policy = await this.loadPolicy(cardWithPack.restaurantId);
    if (!policy) {
      throw new GiftCardBookError('No policy configured for this restaurant');
    }

    const customerName = customer.lastName
      ? `${customer.firstName} ${customer.lastName}`.trim()
      : customer.firstName;
    const partySize = cardWithPack.preferredPartySize ?? cardWithPack.pack?.maxPartySize ?? 2;
    const reservationAmount = cardWithPack.amount.toNumber();

    const [restaurant, settings] = await Promise.all([
      this.prisma.restaurant.findUnique({
        where: { id: cardWithPack.restaurantId },
        select: { timezone: true },
      }),
      this.prisma.restaurantExposureSettings.findUnique({
        where: { restaurantId: cardWithPack.restaurantId },
      }),
    ]);

    const timeZone = restaurant?.timezone ?? 'Europe/Paris';
    const serviceDurationMinutes = resolveServiceDurationMinutes(
      settings?.capacitySpecials as Record<string, unknown> | undefined,
    );
    const startsAt = zonedTimeToUtc(chosen.date, chosen.time, timeZone);
    const endsAt = new Date(startsAt.getTime() + serviceDurationMinutes * 60 * 1000);

    const idempotencyScope = computeIdempotencyScope({
      restaurantId: cardWithPack.restaurantId,
      channel: 'WEB',
      clientId: customer.phone,
    });

    const result = await this.reservations.createReservation(
      {
        restaurantId: cardWithPack.restaurantId,
        partySize,
        startsAt,
        endsAt,
        customerName,
        customerPhone: customer.phone,
        channel: 'WEB',
        policy,
        actor: 'gift-card:web',
        giftCardCode: code,
        giftCardReservationAmount: reservationAmount,
      },
      {
        scope: idempotencyScope,
        key: `gift-card-${code}-${chosen.date}-${chosen.time}`,
        payloadHash: `${customer.phone}-${chosen.date}-${chosen.time}`,
        ttlSeconds: 86400,
      },
    );

    return {
      reservationId: result.reservationId,
      state: result.state,
      giftCardApplication: result.giftCardApplication,
    };
  }

  private async loadPolicy(restaurantId: string): Promise<PolicySnapshot | null> {
    const settings = await this.prisma.restaurantExposureSettings.findUnique({
      where: { restaurantId },
    });
    if (!settings) return null;
    return buildPolicySnapshot({
      policyVersion: '2026-06-20',
      maxPartySize: settings.maxPartySize,
      minLeadTimeMinutes: settings.minLeadTimeMinutes,
      requireManualValidation: settings.requireManualValidation,
      quoteTtlSeconds: settings.quoteTtlSeconds,
      holdTtlSeconds: settings.holdTtlSeconds,
      noShowPolicy: settings.noShowPolicy,
      notificationChannels: [],
      capacitySpecials: settings.capacitySpecials as Record<string, unknown> | null | undefined,
    });
  }
}

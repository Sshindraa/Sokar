import type { PrismaClient, ReservationState, WaitingListStatus } from '@prisma/client';
import { TableAllocationService } from './table-allocation.service';
import { toCustomerFacingTime } from './customer-facing-time';

export interface DelayImpactSimulation {
  feasible: boolean;
  summary: string;
  delayMinutes: number;
  delayedReservation?: {
    id: string;
    customerName: string;
    originalTableName: string;
    originalStartsAt: string;
    proposedStartsAt: string;
    customerFacingProposedStartsAt?: string;
  };
  alternativeTable?: {
    id: string;
    name: string;
    capacity: number;
    sectionId: string | null;
  };
  waitingListEntry?: {
    id: string;
    customerName: string;
    partySize: number;
    requestedStartsAt: string;
    proposedStartsAt: string;
    proposedEndsAt: string;
    isAvailableNow: boolean;
    customerFacingRequestedStartsAt?: string;
  };
  safeguards: string[];
}

/**
 * Simule l'effet d'un retard annoncé sur le service, sans aucune écriture.
 *
 * Un plan n'est faisable que si :
 * - le groupe en retard peut rejoindre une autre table à sa nouvelle ETA ;
 * - la table initiale peut réellement accueillir un groupe de liste d'attente,
 *   en retirant uniquement la réservation retardée du calcul de conflit.
 *
 * L'exécution reste séparée et devra toujours revalider les deux affectations
 * sous verrou transactionnel.
 */
export class ServiceCopilotDelayImpactService {
  private readonly allocation: TableAllocationService;

  constructor(private readonly prisma: PrismaClient) {
    this.allocation = new TableAllocationService(prisma);
  }

  async simulate(args: {
    restaurantId: string;
    reservationId: string;
    delayMinutes: number;
    now?: Date;
  }): Promise<DelayImpactSimulation> {
    const now = args.now ?? new Date();
    const reservation = await this.prisma.reservation.findFirst({
      where: {
        id: args.reservationId,
        restaurantId: args.restaurantId,
        state: 'CONFIRMED' as ReservationState,
        tableId: { not: null },
        startsAt: { not: null },
        endsAt: { not: null },
      },
      select: {
        id: true,
        customerName: true,
        partySize: true,
        tableId: true,
        startsAt: true,
        endsAt: true,
        table: {
          select: {
            id: true,
            name: true,
            capacity: true,
            minCapacity: true,
            sectionId: true,
            isActive: true,
            floorPlan: { select: { isActive: true } },
          },
        },
      },
    });

    if (
      !reservation?.table ||
      !reservation.tableId ||
      !reservation.startsAt ||
      !reservation.endsAt ||
      !reservation.table.isActive ||
      !reservation.table.floorPlan.isActive
    ) {
      return {
        feasible: false,
        delayMinutes: args.delayMinutes,
        summary:
          'Cette réservation ne peut pas être analysée : elle doit être confirmée, datée et affectée à une table.',
        safeguards: ['Aucune modification n’a été effectuée.'],
      };
    }

    const proposedStartsAt = new Date(reservation.startsAt.getTime() + args.delayMinutes * 60_000);
    const proposedEndsAt = new Date(reservation.endsAt.getTime() + args.delayMinutes * 60_000);
    const alternatives = await this.allocation.suggest(
      {
        restaurantId: args.restaurantId,
        partySize: reservation.partySize,
        startsAt: proposedStartsAt,
        endsAt: proposedEndsAt,
        excludeTableIds: [reservation.tableId],
      },
      1,
    );
    const alternative = alternatives[0]?.table;
    const base = {
      delayMinutes: args.delayMinutes,
      delayedReservation: {
        id: reservation.id,
        customerName: reservation.customerName,
        originalTableName: reservation.table.name,
        originalStartsAt: reservation.startsAt.toISOString(),
        proposedStartsAt: proposedStartsAt.toISOString(),
        customerFacingProposedStartsAt: toCustomerFacingTime(proposedStartsAt).toISOString(),
      },
      safeguards: [
        'Simulation en lecture seule : aucune réservation ni table n’a été modifiée.',
        'Toute exécution devra revalider les deux tables sous verrou transactionnel.',
      ],
    };

    if (!alternative) {
      return {
        feasible: false,
        summary: `Aucune table alternative ne peut accueillir ${reservation.customerName} à sa nouvelle heure d’arrivée.`,
        ...base,
      };
    }

    const waitingEntries = await this.prisma.waitingListEntry.findMany({
      where: {
        restaurantId: args.restaurantId,
        status: 'PENDING' as WaitingListStatus,
        expiresAt: { gt: now },
        slotStart: { lte: reservation.startsAt },
        slotEnd: { gt: now },
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      take: 10,
      select: {
        id: true,
        partySize: true,
        customerFirstName: true,
        customerLastName: true,
        slotStart: true,
        slotEnd: true,
        preferredSectionId: true,
      },
    });

    for (const entry of waitingEntries) {
      if (
        entry.partySize > reservation.table.capacity ||
        entry.partySize < reservation.table.minCapacity ||
        (entry.preferredSectionId && entry.preferredSectionId !== reservation.table.sectionId)
      ) {
        continue;
      }
      const requestedDurationMs = entry.slotEnd.getTime() - entry.slotStart.getTime();
      const proposedStartsAt = entry.slotStart > now ? entry.slotStart : now;
      const proposedEndsAt = new Date(proposedStartsAt.getTime() + requestedDurationMs);
      const originalTableIsFree = await this.allocation.isTableAvailable({
        tableId: reservation.tableId,
        startsAt: proposedStartsAt,
        endsAt: proposedEndsAt,
        excludeReservationId: reservation.id,
      });
      if (!originalTableIsFree) continue;

      const customerName = [entry.customerFirstName, entry.customerLastName]
        .filter(Boolean)
        .join(' ');
      return {
        feasible: true,
        summary: `${reservation.customerName} peut être accueilli sur ${alternative.name} à sa nouvelle heure d’arrivée ; ${customerName} peut alors être proposé sur ${reservation.table.name}.`,
        alternativeTable: alternative,
        waitingListEntry: {
          id: entry.id,
          customerName,
          partySize: entry.partySize,
          requestedStartsAt: entry.slotStart.toISOString(),
          proposedStartsAt: proposedStartsAt.toISOString(),
          proposedEndsAt: proposedEndsAt.toISOString(),
          isAvailableNow: entry.slotStart <= now,
          customerFacingRequestedStartsAt: toCustomerFacingTime(proposedStartsAt).toISOString(),
        },
        ...base,
      };
    }

    return {
      feasible: false,
      summary: `Une table alternative existe pour ${reservation.customerName}, mais aucun groupe de liste d’attente ne peut être installé sans conflit sur ${reservation.table.name}.`,
      alternativeTable: alternative,
      ...base,
    };
  }
}

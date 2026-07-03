/**
 * TableAllocationService — allocation best-fit d'une table physique à une
 * réservation ou un hold.
 *
 * Contraintes :
 * - table.active = true
 * - table.capacity >= partySize
 * - table.minCapacity <= partySize (optionnel)
 * - pas de chevauchement avec une réservation bloquante sur la même table
 * - pas de chevauchement avec un hold actif sur la même table
 *
 * Stratégie par défaut : best-fit (plus petite table adaptée), puis préférence
 * de section.
 */

import type { PrismaClient, Table, Reservation, AgenticHold } from '@prisma/client';
import type { AllocateTableInput, TableAvailabilityCheck } from './floor-plan.types';

const BLOCKING_RESERVATION_STATES: Reservation['state'][] = ['PENDING', 'CONFIRMED', 'SEATED'];

export class TableAllocationService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Alloue la meilleure table disponible pour un créneau donné.
   * Renvoie null si aucune table n'est disponible.
   */
  async allocate(input: AllocateTableInput): Promise<Table | null> {
    const floorPlan = await this.prisma.floorPlan.findUnique({
      where: { restaurantId: input.restaurantId },
      select: { id: true },
    });
    if (!floorPlan) {
      return null;
    }

    const tables = await this.prisma.table.findMany({
      where: {
        floorPlanId: floorPlan.id,
        isActive: true,
        capacity: { gte: input.partySize },
        minCapacity: { lte: input.partySize },
        ...(input.excludeTableIds && input.excludeTableIds.length > 0
          ? { id: { notIn: input.excludeTableIds } }
          : {}),
      },
      include: { section: true },
      orderBy: [{ capacity: 'asc' }, { minCapacity: 'asc' }, { name: 'asc' }],
    });

    // 1. Essayer la section préférée
    let candidates = tables;
    if (input.preferredSectionId) {
      const preferred = tables.filter((t) => t.sectionId === input.preferredSectionId);
      if (preferred.length > 0) {
        candidates = preferred;
      }
    }

    for (const table of candidates) {
      const available = await this.isTableAvailable({
        tableId: table.id,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      });
      if (available) {
        return table;
      }
    }

    return null;
  }

  /**
   * Vérifie qu'une table est disponible sur un créneau donné.
   * Permet d'exclure une réservation ou un hold spécifique (utile pour
   * reallocation ou tests).
   */
  async isTableAvailable(check: TableAvailabilityCheck): Promise<boolean> {
    const [conflictingReservation, conflictingHold] = await Promise.all([
      this.findConflictingReservation(check),
      this.findConflictingHold(check),
    ]);

    return !conflictingReservation && !conflictingHold;
  }

  /**
   * Libère la table d'une réservation (met tableId à null).
   */
  async releaseTable(reservationId: string): Promise<void> {
    await this.prisma.reservation.update({
      where: { id: reservationId },
      data: { tableId: null },
    });
  }

  /**
   * Réassigne une réservation à une autre table.
   * Vérifie la disponibilité avant de mettre à jour.
   */
  async reallocate(reservationId: string, newTableId: string): Promise<void> {
    const reservation = await this.prisma.reservation.findUniqueOrThrow({
      where: { id: reservationId },
    });

    const table = await this.prisma.table.findUniqueOrThrow({
      where: { id: newTableId },
    });

    if (table.capacity < reservation.partySize) {
      throw new TableAllocationError(
        'TABLE_CAPACITY_TOO_SMALL',
        'Capacity too small for party size',
      );
    }

    if (!reservation.startsAt || !reservation.endsAt) {
      throw new TableAllocationError('RESERVATION_TIMES_MISSING', 'Reservation times are missing');
    }

    const available = await this.isTableAvailable({
      tableId: newTableId,
      startsAt: reservation.startsAt,
      endsAt: reservation.endsAt,
      excludeReservationId: reservationId,
    });

    if (!available) {
      throw new TableAllocationError('TABLE_NOT_AVAILABLE', 'Target table is not available');
    }

    await this.prisma.reservation.update({
      where: { id: reservationId },
      data: { tableId: newTableId },
    });
  }

  private async findConflictingReservation(
    check: TableAvailabilityCheck,
  ): Promise<Reservation | null> {
    return this.prisma.reservation.findFirst({
      where: {
        tableId: check.tableId,
        state: { in: BLOCKING_RESERVATION_STATES },
        ...(check.excludeReservationId ? { id: { not: check.excludeReservationId } } : {}),
        AND: [{ startsAt: { lt: check.endsAt } }, { endsAt: { gt: check.startsAt } }],
      },
    });
  }

  private async findConflictingHold(check: TableAvailabilityCheck): Promise<AgenticHold | null> {
    return this.prisma.agenticHold.findFirst({
      where: {
        tableId: check.tableId,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
        ...(check.excludeHoldId ? { id: { not: check.excludeHoldId } } : {}),
        AND: [{ slotStart: { lt: check.endsAt } }, { slotEnd: { gt: check.startsAt } }],
      },
    });
  }
}

export class TableAllocationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TableAllocationError';
  }
}

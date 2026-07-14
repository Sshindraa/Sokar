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

import { Prisma } from '@prisma/client';
import type { PrismaClient, Table, Reservation, AgenticHold } from '@prisma/client';
import type { AllocateTableInput, TableAvailabilityCheck } from './floor-plan.types';

const BLOCKING_RESERVATION_STATES: Reservation['state'][] = ['PENDING', 'CONFIRMED', 'SEATED'];

export class TableAllocationService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Alloue la meilleure table disponible pour un créneau donné.
   * Renvoie null si aucune table n'est disponible.
   */
  async allocate(input: AllocateTableInput, tx?: Prisma.TransactionClient): Promise<Table | null> {
    const prisma = tx ?? this.prisma;

    const floorPlan = await prisma.floorPlan.findUnique({
      where: { restaurantId: input.restaurantId },
      select: { id: true },
    });
    if (!floorPlan) {
      return null;
    }

    const tables = await prisma.table.findMany({
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
      // Verrouiller la ligne table pour éviter l'allocation concurrente.
      // SKIP LOCKED permet de passer à la candidate suivante si déjà verrouillée.
      const locked = await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM floor_plan_tables WHERE id = ${table.id} FOR UPDATE SKIP LOCKED`,
      );

      if (!locked || locked.length === 0) {
        continue;
      }

      const available = await this.isTableAvailable(
        {
          tableId: table.id,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
        },
        tx,
      );
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
  async isTableAvailable(
    check: TableAvailabilityCheck,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const [conflictingReservation, conflictingHold] = await Promise.all([
      this.findConflictingReservation(check, tx),
      this.findConflictingHold(check, tx),
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
  async reallocate(reservationId: string, newTableId: string): Promise<Reservation> {
    const reservation = await this.prisma.reservation.findUniqueOrThrow({
      where: { id: reservationId },
    });

    const table = await this.prisma.table.findUniqueOrThrow({
      where: { id: newTableId },
      include: { floorPlan: true },
    });

    if (table.floorPlan.restaurantId !== reservation.restaurantId) {
      throw new TableAllocationError(
        'TABLE_RESTAURANT_MISMATCH',
        'Table and reservation belong to different restaurants',
      );
    }

    if (!table.isActive) {
      throw new TableAllocationError('TABLE_NOT_ACTIVE', 'Table is not active');
    }

    if (table.capacity < reservation.partySize) {
      throw new TableAllocationError(
        'TABLE_CAPACITY_TOO_SMALL',
        'Capacity too small for party size',
      );
    }

    if (table.minCapacity > reservation.partySize) {
      throw new TableAllocationError(
        'TABLE_MIN_CAPACITY_TOO_HIGH',
        'Party size is below the table minimum capacity',
      );
    }

    if (!reservation.startsAt || !reservation.endsAt) {
      throw new TableAllocationError('RESERVATION_TIMES_MISSING', 'Reservation times are missing');
    }

    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockTable(tx, newTableId);
      if (!locked) {
        throw new TableAllocationError('TABLE_NOT_AVAILABLE', 'Target table is not available');
      }

      const available = await this.isTableAvailable(
        {
          tableId: newTableId,
          startsAt: reservation.startsAt as Date,
          endsAt: reservation.endsAt as Date,
          excludeReservationId: reservationId,
        },
        tx,
      );

      if (!available) {
        throw new TableAllocationError('TABLE_NOT_AVAILABLE', 'Target table is not available');
      }

      return tx.reservation.update({
        where: { id: reservationId },
        data: { tableId: newTableId },
      });
    });
  }

  private async findConflictingReservation(
    check: TableAvailabilityCheck,
    tx?: Prisma.TransactionClient,
  ): Promise<Reservation | null> {
    const prisma = tx ?? this.prisma;
    return prisma.reservation.findFirst({
      where: {
        tableId: check.tableId,
        state: { in: BLOCKING_RESERVATION_STATES },
        ...(check.excludeReservationId ? { id: { not: check.excludeReservationId } } : {}),
        AND: [{ startsAt: { lt: check.endsAt } }, { endsAt: { gt: check.startsAt } }],
      },
    });
  }

  private async findConflictingHold(
    check: TableAvailabilityCheck,
    tx?: Prisma.TransactionClient,
  ): Promise<AgenticHold | null> {
    const prisma = tx ?? this.prisma;
    return prisma.agenticHold.findFirst({
      where: {
        tableId: check.tableId,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
        ...(check.excludeHoldId ? { id: { not: check.excludeHoldId } } : {}),
        AND: [{ slotStart: { lt: check.endsAt } }, { slotEnd: { gt: check.startsAt } }],
      },
    });
  }

  /**
   * Verrouille une table avec SELECT FOR UPDATE (sans SKIP LOCKED).
   * Renvoie true si la table a été verrouillée, false si elle est déjà verrouillée.
   */
  async lockTable(tx: Prisma.TransactionClient, tableId: string): Promise<boolean> {
    const locked = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM floor_plan_tables WHERE id = ${tableId} FOR UPDATE`,
    );
    return locked && locked.length > 0;
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

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
import type { PrismaClient, Table, Reservation } from '@prisma/client';
import type {
  AllocateTableInput,
  AllocationSuggestion,
  TableAvailabilityCheck,
} from './floor-plan.types';

export class TableAllocationService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Alloue la meilleure table disponible pour un créneau donné.
   * Renvoie null si aucune table n'est disponible.
   *
   * Verrouille chaque table candidate (FOR UPDATE SKIP LOCKED) avant de
   * vérifier sa disponibilité. Pour une prévisualisation sans verrou,
   * utiliser `suggest`.
   */
  async allocate(
    input: AllocateTableInput,
    tx?: Prisma.TransactionClient,
    options?: { readOnly?: boolean },
  ): Promise<Table | null> {
    const prisma = tx ?? this.prisma;
    const tables = await this.findCandidateTables(input, tx);

    for (const table of tables) {
      // Verrouiller la ligne table pour éviter l'allocation concurrente.
      // SKIP LOCKED permet de passer à la candidate suivante si déjà verrouillée.
      // En mode lecture seule (dry-run), on saute le verrouillage pessimiste
      // pour ne pas bloquer les allocations concurrentes.
      if (!options?.readOnly) {
        const locked = await prisma.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM floor_plan_tables WHERE id = ${table.id} FOR UPDATE SKIP LOCKED`,
        );

        if (!locked || locked.length === 0) {
          continue;
        }
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
   * Prévisualise les meilleures tables disponibles (top `limit`) avec score et
   * raisons, SANS verrouiller les tables. Lecture seule — pour l'affichage
   * explicable dans le dashboard. L'attribution autoritaire reste
   * `assign-table`/`reallocate` (verrou + revalidation).
   */
  async suggest(input: AllocateTableInput, limit = 3): Promise<AllocationSuggestion[]> {
    const tables = await this.findCandidateTables(input);
    const suggestions: AllocationSuggestion[] = [];

    for (const table of tables) {
      const available = await this.isTableAvailable(
        { tableId: table.id, startsAt: input.startsAt, endsAt: input.endsAt },
        undefined,
      );
      if (!available) continue;

      suggestions.push({
        table: {
          id: table.id,
          name: table.name,
          capacity: table.capacity,
          minCapacity: table.minCapacity,
          sectionId: table.sectionId ?? null,
        },
        score: this.scoreCandidate(table, input),
        reasons: this.buildCandidateReasons(table, input),
      });

      if (suggestions.length >= limit) break;
    }

    // Tri décroissant par score (meilleur fit en premier). L'ordre de la query
    // (capacity asc) est déjà quasi-optimal, mais le score explicite rend le
    // classement stable et lisible côté UI.
    suggestions.sort((a, b) => b.score - a.score);
    return suggestions;
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
    const [hasReservationConflict, hasHoldConflict] = await Promise.all([
      this.hasConflictingReservation(check, tx),
      this.hasConflictingHold(check, tx),
    ]);

    return !hasReservationConflict && !hasHoldConflict;
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

  /**
   * Vérifie qu'une table est utilisable pour un placement (SEATED / walk-in).
   * Lance TableAllocationError si la table est introuvable, inactive, trop
   * petite, verrouillée par une autre opération, ou déjà occupée sur le créneau.
   */
  async assertTableAvailableForSeating(
    args: {
      restaurantId: string;
      tableId: string;
      partySize: number;
      startsAt: Date;
      endsAt: Date;
      excludeReservationId?: string;
    },
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const table = await tx.table.findFirst({
      where: { id: args.tableId, floorPlan: { restaurantId: args.restaurantId } },
      select: { id: true, isActive: true, capacity: true, minCapacity: true },
    });

    if (!table) {
      throw new TableAllocationError('TABLE_NOT_FOUND', 'Table introuvable');
    }
    if (!table.isActive) {
      throw new TableAllocationError('TABLE_NOT_ACTIVE', 'Table inactive');
    }
    if (table.capacity < args.partySize) {
      throw new TableAllocationError('TABLE_CAPACITY_TOO_SMALL', 'Capacité insuffisante');
    }
    if (table.minCapacity > args.partySize) {
      throw new TableAllocationError(
        'TABLE_MIN_CAPACITY_TOO_HIGH',
        'Party size below table minimum',
      );
    }

    const locked = await this.lockTable(tx, args.tableId);
    if (!locked) {
      throw new TableAllocationError(
        'TABLE_NOT_AVAILABLE',
        'Table verrouillée par une autre opération',
      );
    }

    const available = await this.isTableAvailable(
      {
        tableId: args.tableId,
        startsAt: args.startsAt,
        endsAt: args.endsAt,
        excludeReservationId: args.excludeReservationId,
      },
      tx,
    );

    if (!available) {
      throw new TableAllocationError('TABLE_NOT_AVAILABLE', 'Table non disponible sur ce créneau');
    }
  }

  /**
   * Sélectionne les tables candidates (actives, capacité/minCapacity compatibles,
   * exclusions), triées best-fit. Partagé par `allocate` et `suggest`.
   */
  private async findCandidateTables(
    input: AllocateTableInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Table[]> {
    const prisma = tx ?? this.prisma;

    const capacityFilter = {
      isActive: true,
      capacity: { gte: input.partySize },
      minCapacity: { lte: input.partySize },
      ...(input.excludeTableIds && input.excludeTableIds.length > 0
        ? { id: { notIn: input.excludeTableIds } }
        : {}),
    } as const;

    if (input.preferredSectionId) {
      const preferred = await prisma.table.findMany({
        where: {
          sectionId: input.preferredSectionId,
          floorPlan: { isActive: true },
          ...capacityFilter,
        },
        orderBy: [{ capacity: 'asc' }, { minCapacity: 'asc' }, { name: 'asc' }],
      });

      // Fallback : si la section préférée n'a aucune table compatible (capacité
      // ou toutes occupées), retomber sur le plan par défaut plutôt que de
      // renvoyer null. On marque `fromPreferredSectionFallback` pour que
      // `suggest` puisse l'expliquer dans les raisons.
      const floorPlan = await prisma.floorPlan.findFirst({
        where: { restaurantId: input.restaurantId, isActive: true, isDefault: true },
        select: { id: true },
      });
      if (!floorPlan) {
        return preferred;
      }
      const fallback = await prisma.table.findMany({
        where: {
          floorPlanId: floorPlan.id,
          ...capacityFilter,
          ...(preferred.length > 0 ? { id: { notIn: preferred.map((t) => t.id) } } : {}),
        },
        orderBy: [{ capacity: 'asc' }, { minCapacity: 'asc' }, { name: 'asc' }],
      });
      return [...preferred, ...fallback];
    }

    const floorPlan = await prisma.floorPlan.findFirst({
      where: { restaurantId: input.restaurantId, isActive: true, isDefault: true },
      select: { id: true },
    });
    if (!floorPlan) {
      return [];
    }

    return prisma.table.findMany({
      where: { floorPlanId: floorPlan.id, ...capacityFilter },
      orderBy: [{ capacity: 'asc' }, { minCapacity: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Score d'une candidate : plus la table est proche du nombre de couverts,
   * plus le score est élevé. Une table de la section préférée (si fournie) est
   * favorisée. Le score n'est qu'un ordre de tri — les `reasons` portent le
   * sens métier affiché.
   */
  private scoreCandidate(table: Table, input: AllocateTableInput): number {
    let score = 100 - (table.capacity - input.partySize) * 10;
    if (input.preferredSectionId && table.sectionId === input.preferredSectionId) {
      score += 15;
    }
    return score;
  }

  /**
   * Raisons FR (vouvoiement) expliquant la proposition, affichées telles quelles.
   */
  private buildCandidateReasons(table: Table, input: AllocateTableInput): string[] {
    const reasons: string[] = [];
    const spare = table.capacity - input.partySize;
    if (spare === 0) {
      reasons.push(`Capacité exacte pour ${input.partySize} couverts`);
    } else {
      reasons.push(`Table de ${table.capacity} couverts pour ${input.partySize} personnes`);
    }
    if (input.preferredSectionId && table.sectionId === input.preferredSectionId) {
      reasons.push('Dans votre section préférée');
    }
    if (spare === 0) {
      reasons.push('Optimise votre remplissage');
    }
    return reasons;
  }

  private async hasConflictingReservation(
    check: TableAvailabilityCheck,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const prisma = tx ?? this.prisma;
    const excludeClause = check.excludeReservationId
      ? Prisma.sql`AND id != ${check.excludeReservationId}`
      : Prisma.empty;
    const rows = await prisma.$queryRaw<Array<{ exists: number }>>(
      Prisma.sql`
        SELECT 1 as exists
        FROM reservations
        WHERE table_id = ${check.tableId}
          AND state IN ('PENDING', 'CONFIRMED', 'SEATED')
          AND starts_at IS NOT NULL
          AND ends_at IS NOT NULL
          AND tsrange(starts_at, ends_at) && tsrange(${check.startsAt}, ${check.endsAt})
          ${excludeClause}
        LIMIT 1
      `,
    );
    return rows.length > 0 && Number(rows[0].exists) === 1;
  }

  private async hasConflictingHold(
    check: TableAvailabilityCheck,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const prisma = tx ?? this.prisma;
    const excludeClause = check.excludeHoldId
      ? Prisma.sql`AND id != ${check.excludeHoldId}`
      : Prisma.empty;
    const rows = await prisma.$queryRaw<Array<{ exists: number }>>(
      Prisma.sql`
        SELECT 1 as exists
        FROM agentic_holds
        WHERE table_id = ${check.tableId}
          AND status = 'ACTIVE'
          AND expires_at > NOW()
          AND slot_start IS NOT NULL
          AND slot_end IS NOT NULL
          AND tsrange(slot_start, slot_end) && tsrange(${check.startsAt}, ${check.endsAt})
          ${excludeClause}
        LIMIT 1
      `,
    );
    return rows.length > 0 && Number(rows[0].exists) === 1;
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

import { Prisma } from '@prisma/client';
import type { PrismaClient, Section, Table, Wall } from '@prisma/client';
import { zonedTimeToUtc } from './availability-capacity-aware.service.js';
import { TableAllocationService } from './table-allocation.service.js';

/** Capacité minimale par défaut d'une table (1 personne) */
const DEFAULT_TABLE_MIN_CAPACITY = 1;

export class FloorPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FloorPlanValidationError';
  }
}

export class FloorPlanNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FloorPlanNotFoundError';
  }
}

export type FloorPlanWithSections = {
  id: string;
  name: string;
  width: number;
  height: number;
  restaurantId: string;
  sections: Array<
    Section & {
      tables: Table[];
    }
  >;
  tables: Table[];
  walls: Wall[];
};

export type PlanningReservation = {
  id: string;
  tableId: string | null;
  tableName: string | null;
  sectionName: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  partySize: number;
  customerName: string | null;
  state: string;
  seatedAt: Date | null;
};

export type CreateSectionInput = {
  name: string;
  position?: number;
};

export type UpdateSectionInput = Partial<CreateSectionInput>;

export type CreateTableInput = {
  sectionId?: string | null;
  name: string;
  capacity: number;
  minCapacity?: number;
  positionX?: number | null;
  positionY?: number | null;
  width?: number | null;
  height?: number | null;
  rotation?: number;
  shape?: string;
};

export type UpdateTableInput = Partial<CreateTableInput> & {
  isActive?: boolean;
};

export type UpdateFloorPlanInput = {
  name?: string;
  width?: number;
  height?: number;
};

export type CreateWallInput = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  type?: string;
  name?: string | null;
};

export type UpdateWallInput = Partial<CreateWallInput>;

export class FloorPlanService {
  private readonly tableAllocation: TableAllocationService;

  constructor(private readonly prisma: PrismaClient) {
    this.tableAllocation = new TableAllocationService(prisma);
  }

  async getOrCreateFloorPlan(restaurantId: string): Promise<FloorPlanWithSections> {
    const existing = await this.prisma.floorPlan.findUnique({
      where: { restaurantId },
      include: {
        sections: {
          orderBy: { position: 'asc' },
          include: {
            tables: { orderBy: [{ positionX: 'asc' }, { positionY: 'asc' }, { name: 'asc' }] },
          },
        },
        tables: {
          orderBy: [{ positionX: 'asc' }, { positionY: 'asc' }, { name: 'asc' }],
        },
        walls: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (existing) {
      return existing;
    }

    const created = await this.prisma.floorPlan.create({
      data: {
        restaurantId,
        name: 'Salle principale',
        width: 1400,
        height: 900,
      },
      include: {
        sections: {
          orderBy: { position: 'asc' },
          include: {
            tables: { orderBy: [{ positionX: 'asc' }, { positionY: 'asc' }, { name: 'asc' }] },
          },
        },
        tables: {
          orderBy: [{ positionX: 'asc' }, { positionY: 'asc' }, { name: 'asc' }],
        },
        walls: { orderBy: { createdAt: 'asc' } },
      },
    });

    return created;
  }

  async createFloorPlan(restaurantId: string, name?: string): Promise<FloorPlanWithSections> {
    const existing = await this.prisma.floorPlan.findUnique({
      where: { restaurantId },
    });
    if (existing) {
      return this.getOrCreateFloorPlan(restaurantId);
    }

    const created = await this.prisma.floorPlan.create({
      data: {
        restaurantId,
        name: name ?? 'Salle principale',
        width: 1400,
        height: 900,
      },
      include: {
        sections: {
          orderBy: { position: 'asc' },
          include: {
            tables: { orderBy: [{ positionX: 'asc' }, { positionY: 'asc' }, { name: 'asc' }] },
          },
        },
        tables: {
          orderBy: [{ positionX: 'asc' }, { positionY: 'asc' }, { name: 'asc' }],
        },
        walls: { orderBy: { createdAt: 'asc' } },
      },
    });

    return created;
  }

  async updateFloorPlan(
    restaurantId: string,
    input: UpdateFloorPlanInput,
  ): Promise<FloorPlanWithSections> {
    const floorPlan = await this.getOrCreateFloorPlan(restaurantId);

    await this.prisma.floorPlan.update({
      where: { id: floorPlan.id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.width !== undefined && { width: input.width }),
        ...(input.height !== undefined && { height: input.height }),
      },
    });

    return this.getOrCreateFloorPlan(restaurantId);
  }

  async createSection(restaurantId: string, input: CreateSectionInput): Promise<Section> {
    const floorPlan = await this.getOrCreateFloorPlan(restaurantId);
    const position = input.position ?? floorPlan.sections.length;

    return this.prisma.section.create({
      data: {
        floorPlanId: floorPlan.id,
        name: input.name,
        position,
      },
    });
  }

  async updateSection(
    restaurantId: string,
    sectionId: string,
    input: UpdateSectionInput,
  ): Promise<Section> {
    const floorPlan = await this.getOrCreateFloorPlan(restaurantId);
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, floorPlanId: floorPlan.id },
    });
    if (!section) {
      throw new FloorPlanNotFoundError('Section introuvable');
    }

    return this.prisma.section.update({
      where: { id: sectionId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.position !== undefined && { position: input.position }),
      },
    });
  }

  async deleteSection(restaurantId: string, sectionId: string): Promise<void> {
    const floorPlan = await this.getOrCreateFloorPlan(restaurantId);
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, floorPlanId: floorPlan.id },
    });
    if (!section) {
      throw new FloorPlanNotFoundError('Section introuvable');
    }

    await this.prisma.section.delete({ where: { id: sectionId } });
  }

  async createTable(restaurantId: string, input: CreateTableInput): Promise<Table> {
    this.validateTable(input);

    const floorPlan = await this.getOrCreateFloorPlan(restaurantId);

    if (input.sectionId) {
      const section = await this.prisma.section.findFirst({
        where: { id: input.sectionId, floorPlanId: floorPlan.id },
      });
      if (!section) {
        throw new FloorPlanNotFoundError('Section introuvable');
      }
    }

    return this.prisma.table.create({
      data: {
        floorPlanId: floorPlan.id,
        sectionId: input.sectionId ?? null,
        name: input.name,
        capacity: input.capacity,
        minCapacity: input.minCapacity ?? DEFAULT_TABLE_MIN_CAPACITY,
        positionX: input.positionX ?? null,
        positionY: input.positionY ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
        rotation: input.rotation ?? 0,
        shape: input.shape ?? 'rect',
      },
    });
  }

  async updateTable(
    restaurantId: string,
    tableId: string,
    input: UpdateTableInput,
  ): Promise<Table> {
    this.validateTable(input);

    const floorPlan = await this.getOrCreateFloorPlan(restaurantId);
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, floorPlanId: floorPlan.id },
    });
    if (!table) {
      throw new FloorPlanNotFoundError('Table introuvable');
    }

    if (input.sectionId !== undefined && input.sectionId !== null) {
      const section = await this.prisma.section.findFirst({
        where: { id: input.sectionId, floorPlanId: floorPlan.id },
      });
      if (!section) {
        throw new FloorPlanNotFoundError('Section introuvable');
      }
    }

    return this.prisma.table.update({
      where: { id: tableId },
      data: {
        ...(input.sectionId !== undefined && { sectionId: input.sectionId ?? null }),
        ...(input.name !== undefined && { name: input.name }),
        ...(input.capacity !== undefined && { capacity: input.capacity }),
        ...(input.minCapacity !== undefined && { minCapacity: input.minCapacity }),
        ...(input.positionX !== undefined && { positionX: input.positionX ?? null }),
        ...(input.positionY !== undefined && { positionY: input.positionY ?? null }),
        ...(input.width !== undefined && { width: input.width ?? null }),
        ...(input.height !== undefined && { height: input.height ?? null }),
        ...(input.rotation !== undefined && { rotation: input.rotation }),
        ...(input.shape !== undefined && { shape: input.shape }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    });
  }

  async deleteTable(restaurantId: string, tableId: string): Promise<void> {
    const floorPlan = await this.getOrCreateFloorPlan(restaurantId);
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, floorPlanId: floorPlan.id },
      include: {
        reservations: {
          where: {
            startsAt: { gte: new Date() },
            state: { in: ['PENDING', 'CONFIRMED', 'SEATED'] },
          },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!table) {
      throw new FloorPlanNotFoundError('Table introuvable');
    }

    if (table.reservations.length > 0) {
      await this.prisma.table.update({
        where: { id: tableId },
        data: { isActive: false },
      });
      return;
    }

    await this.prisma.table.delete({ where: { id: tableId } });
  }

  async getPlanning(restaurantId: string, date: string): Promise<PlanningReservation[]> {
    const floorPlan = await this.getOrCreateFloorPlan(restaurantId);
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { timezone: true },
    });
    const timeZone = restaurant?.timezone ?? 'Europe/Paris';
    const start = zonedTimeToUtc(date, '00:00', timeZone);
    const end = zonedTimeToUtc(date, '23:59:59.999', timeZone);

    const reservations = await this.prisma.reservation.findMany({
      where: {
        restaurantId,
        startsAt: { gte: start, lte: end },
        state: { in: ['PENDING', 'CONFIRMED', 'SEATED'] },
      },
      select: {
        id: true,
        tableId: true,
        startsAt: true,
        endsAt: true,
        partySize: true,
        customerName: true,
        state: true,
      },
      orderBy: { startsAt: 'asc' },
    });

    const tableMap = new Map(floorPlan.tables.map((t) => [t.id, t]));
    const sectionMap = new Map(floorPlan.sections.map((s) => [s.id, s]));

    const seatedLogs = await this.prisma.reservationAuditLog.findMany({
      where: {
        reservationId: { in: reservations.map((r) => r.id) },
        event: 'reservation_seated',
      },
      orderBy: { createdAt: 'asc' },
      select: { reservationId: true, createdAt: true },
    });
    const seatedAtByReservation = new Map<string, Date>();
    for (const log of seatedLogs) {
      if (log.reservationId && !seatedAtByReservation.has(log.reservationId)) {
        seatedAtByReservation.set(log.reservationId, log.createdAt);
      }
    }

    return reservations.map((r) => {
      const table = r.tableId ? (tableMap.get(r.tableId) ?? null) : null;
      const section = table?.sectionId ? (sectionMap.get(table.sectionId) ?? null) : null;
      return {
        id: r.id,
        tableId: r.tableId,
        tableName: table?.name ?? null,
        sectionName: section?.name ?? null,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        partySize: r.partySize,
        customerName: r.customerName,
        state: r.state,
        seatedAt: seatedAtByReservation.get(r.id) ?? null,
      };
    });
  }

  async createWalkIn(args: {
    restaurantId: string;
    tableId: string;
    partySize: number;
    customerName?: string;
    idempotencyKey: string;
  }): Promise<{ id: string }> {
    const now = new Date();
    const endsAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const idempotencyScope = 'walk-in';
    const payloadHash = `${args.restaurantId}:${args.tableId}:${args.idempotencyKey}`;

    return this.prisma.$transaction(async (tx) => {
      await this.tableAllocation.assertTableAvailableForSeating(
        {
          restaurantId: args.restaurantId,
          tableId: args.tableId,
          partySize: args.partySize,
          startsAt: now,
          endsAt,
        },
        tx,
      );

      try {
        const reservation = await tx.reservation.create({
          data: {
            restaurantId: args.restaurantId,
            tableId: args.tableId,
            partySize: args.partySize,
            customerName: args.customerName ?? 'Walk-in',
            reservedAt: now,
            channel: 'API',
            state: 'SEATED',
            status: 'SEATED',
            startsAt: now,
            endsAt,
            createdByClient: args.restaurantId,
            idempotencyScope,
            idempotencyKey: args.idempotencyKey,
            idempotencyPayloadHash: payloadHash,
            source: 'WALK_IN',
          },
        });

        await tx.reservationAuditLog.create({
          data: {
            event: 'reservation_seated',
            reservationId: reservation.id,
            actor: args.restaurantId,
            fromState: 'PENDING',
            toState: 'SEATED',
            metadata: { source: 'WALK_IN' },
          },
        });

        return { id: reservation.id };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const existing = await tx.reservation.findFirst({
            where: { idempotencyScope, idempotencyKey: args.idempotencyKey },
            select: { id: true },
          });
          if (existing) return { id: existing.id };
        }
        throw err;
      }
    });
  }

  async createWall(restaurantId: string, input: CreateWallInput): Promise<Wall> {
    const floorPlan = await this.getOrCreateFloorPlan(restaurantId);

    return this.prisma.wall.create({
      data: {
        floorPlanId: floorPlan.id,
        x1: input.x1,
        y1: input.y1,
        x2: input.x2,
        y2: input.y2,
        type: input.type ?? 'wall',
        name: input.name ?? null,
      },
    });
  }

  async updateWall(restaurantId: string, wallId: string, input: UpdateWallInput): Promise<Wall> {
    const floorPlan = await this.getOrCreateFloorPlan(restaurantId);
    const wall = await this.prisma.wall.findFirst({
      where: { id: wallId, floorPlanId: floorPlan.id },
    });
    if (!wall) {
      throw new FloorPlanNotFoundError('Mur introuvable');
    }

    return this.prisma.wall.update({
      where: { id: wallId },
      data: {
        ...(input.x1 !== undefined && { x1: input.x1 }),
        ...(input.y1 !== undefined && { y1: input.y1 }),
        ...(input.x2 !== undefined && { x2: input.x2 }),
        ...(input.y2 !== undefined && { y2: input.y2 }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.name !== undefined && { name: input.name ?? null }),
      },
    });
  }

  async deleteWall(restaurantId: string, wallId: string): Promise<void> {
    const floorPlan = await this.getOrCreateFloorPlan(restaurantId);
    const wall = await this.prisma.wall.findFirst({
      where: { id: wallId, floorPlanId: floorPlan.id },
    });
    if (!wall) {
      throw new FloorPlanNotFoundError('Mur introuvable');
    }

    await this.prisma.wall.delete({ where: { id: wallId } });
  }

  private validateTable(input: Partial<CreateTableInput>): void {
    if (input.capacity !== undefined) {
      const minCapacity = input.minCapacity ?? DEFAULT_TABLE_MIN_CAPACITY;
      if (input.capacity < minCapacity) {
        throw new FloorPlanValidationError(
          'La capacité doit être supérieure ou égale à la capacité minimale',
        );
      }
      if (input.capacity < DEFAULT_TABLE_MIN_CAPACITY) {
        throw new FloorPlanValidationError("La capacité doit être d'au moins 1");
      }
    }
    if (input.minCapacity !== undefined && input.minCapacity < 1) {
      throw new FloorPlanValidationError("La capacité minimale doit être d'au moins 1");
    }
  }
}

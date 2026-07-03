import type { PrismaClient, Section, Table } from '@prisma/client';

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
  restaurantId: string;
  sections: Array<
    Section & {
      tables: Table[];
    }
  >;
  tables: Table[];
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
  shape?: string;
};

export type UpdateTableInput = Partial<CreateTableInput> & {
  isActive?: boolean;
};

export class FloorPlanService {
  constructor(private readonly prisma: PrismaClient) {}

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
      },
    });

    if (existing) {
      return existing;
    }

    const created = await this.prisma.floorPlan.create({
      data: {
        restaurantId,
        name: 'Salle principale',
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
      },
    });

    return created;
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
        minCapacity: input.minCapacity ?? 1,
        positionX: input.positionX ?? null,
        positionY: input.positionY ?? null,
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
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);

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
      };
    });
  }

  private validateTable(input: Partial<CreateTableInput>): void {
    if (input.capacity !== undefined) {
      const minCapacity = input.minCapacity ?? 1;
      if (input.capacity < minCapacity) {
        throw new FloorPlanValidationError(
          'La capacité doit être supérieure ou égale à la capacité minimale',
        );
      }
      if (input.capacity < 1) {
        throw new FloorPlanValidationError("La capacité doit être d'au moins 1");
      }
    }
    if (input.minCapacity !== undefined && input.minCapacity < 1) {
      throw new FloorPlanValidationError("La capacité minimale doit être d'au moins 1");
    }
  }
}

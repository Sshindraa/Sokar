import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceCopilotSimulationService } from '../service-copilot-simulation.service';
import { TableAllocationService } from '../table-allocation.service';
import { CapacityAwareAvailabilityService } from '../availability-capacity-aware.service';
import type { AllocateTableInput } from '../floor-plan.types';

function makePrismaMock() {
  const defaultRestaurant = {
    id: 'rest-1',
    timezone: 'Europe/Paris',
    exposureSettings: { capacitySpecials: { serviceDurationMinutes: 120 } },
    openingHours: { tue: { open: '12:00', close: '22:00' } },
  };

  const restaurant = {
    findUnique: vi.fn(async (args: any) => (args.where.id === 'rest-1' ? defaultRestaurant : null)),
  };
  const section = { findMany: vi.fn() };
  const table = { findUnique: vi.fn() };

  const prisma: any = { restaurant, section, table };
  return { prisma, restaurant, section, table, defaultRestaurant };
}

function makeSuggestion(table: {
  id: string;
  name: string;
  capacity: number;
  sectionId?: string | null;
}) {
  return {
    table: {
      id: table.id,
      name: table.name,
      capacity: table.capacity,
      minCapacity: 1,
      sectionId: table.sectionId ?? null,
    },
    score: 100,
    reasons: ['Capacité compatible'],
  };
}

describe('ServiceCopilotSimulationService', () => {
  let svc: ServiceCopilotSimulationService;
  let mocks: ReturnType<typeof makePrismaMock>;
  let suggestSpy: ReturnType<typeof vi.spyOn>;
  let availabilitySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = makePrismaMock();

    if (!suggestSpy) {
      suggestSpy = vi.spyOn(TableAllocationService.prototype, 'suggest');
    }
    if (!availabilitySpy) {
      availabilitySpy = vi.spyOn(CapacityAwareAvailabilityService.prototype, 'getAvailability');
    }
    suggestSpy.mockReset();
    availabilitySpy.mockReset();

    svc = new ServiceCopilotSimulationService(mocks.prisma);
  });

  it('retourne le scénario direct feasible', async () => {
    const startsAt = new Date('2026-07-21T19:00:00.000Z');
    suggestSpy.mockResolvedValue([
      makeSuggestion({ id: 't1', name: 'T1', capacity: 4, sectionId: 'section-a' }),
    ]);
    mocks.table.findUnique.mockResolvedValue({
      id: 't1',
      name: 'T1',
      capacity: 4,
      minCapacity: 1,
      sectionId: 'section-a',
      section: { id: 'section-a', name: 'Terrasse', floorPlan: { name: 'Plan' } },
      floorPlan: { name: 'Plan' },
    });
    availabilitySpy.mockResolvedValue({
      restaurantId: 'rest-1',
      date: '2026-07-21',
      partySize: 2,
      slots: [],
    });

    const result = await svc.simulate({ restaurantId: 'rest-1', partySize: 2, startsAt });

    expect(result.feasible).toBe(true);
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].type).toBe('direct');
    expect(result.scenarios[0].feasible).toBe(true);
    expect(result.scenarios[0].table?.name).toBe('T1');
    expect(result.bestScenarioId).toBe(result.scenarios[0].id);
    expect(result.explanation).toContain('Table T1');
  });

  it('retourne le scénario change-section quand la section préférée est pleine', async () => {
    const startsAt = new Date('2026-07-21T19:00:00.000Z');
    suggestSpy.mockImplementation(async (input: AllocateTableInput) => {
      if (input.preferredSectionId === 'section-a') return [];
      if (input.preferredSectionId === 'section-b') {
        return [makeSuggestion({ id: 't2', name: 'T2', capacity: 4, sectionId: 'section-b' })];
      }
      return [];
    });
    mocks.section.findMany.mockResolvedValue([
      { id: 'section-a', name: 'Terrasse', floorPlan: { name: 'Plan' } },
      { id: 'section-b', name: 'Salle', floorPlan: { name: 'Plan' } },
    ]);
    mocks.table.findUnique.mockImplementation(async (args: any) => {
      if (args.where.id === 't2') {
        return {
          id: 't2',
          name: 'T2',
          capacity: 4,
          minCapacity: 1,
          sectionId: 'section-b',
          section: { id: 'section-b', name: 'Salle', floorPlan: { name: 'Plan' } },
          floorPlan: { name: 'Plan' },
        };
      }
      return null;
    });
    availabilitySpy.mockResolvedValue({
      restaurantId: 'rest-1',
      date: '2026-07-21',
      partySize: 2,
      slots: [],
    });

    const result = await svc.simulate({
      restaurantId: 'rest-1',
      partySize: 2,
      startsAt,
      preferredSectionId: 'section-a',
    });

    expect(result.feasible).toBe(true);
    expect(result.scenarios).toHaveLength(2);
    expect(result.scenarios[0].type).toBe('direct');
    expect(result.scenarios[0].feasible).toBe(false);
    expect(result.scenarios[1].type).toBe('change-section');
    expect(result.scenarios[1].feasible).toBe(true);
    expect(result.scenarios[1].table?.name).toBe('T2');
    expect(result.scenarios.some((scenario) => scenario.type === 'refuse')).toBe(false);
    expect(result.bestScenarioId).toBe(result.scenarios[1].id);
    expect(result.explanation).toContain('Salle');
  });

  it('retourne le scénario refuse avec le prochain créneau disponible', async () => {
    const startsAt = new Date('2026-07-21T19:00:00.000Z');
    const nextSlot = new Date('2026-07-21T19:30:00.000Z');

    suggestSpy.mockImplementation(async (input: AllocateTableInput) => {
      if (input.startsAt.getTime() === startsAt.getTime()) return [];
      if (input.startsAt.getTime() === nextSlot.getTime()) {
        return [makeSuggestion({ id: 't3', name: 'T3', capacity: 4, sectionId: 'section-a' })];
      }
      return [];
    });
    availabilitySpy.mockImplementation(
      async (args: {
        restaurantId: string;
        date: string;
        partySize: number;
        preferredSectionId?: string;
      }) => {
        if (args.date === '2026-07-21') {
          return {
            restaurantId: 'rest-1',
            date: '2026-07-21',
            partySize: 2,
            slots: [
              { time: '21:00', available: false },
              { time: '21:30', available: true },
            ],
          };
        }
        return { restaurantId: 'rest-1', date: args.date, partySize: 2, slots: [] };
      },
    );

    const result = await svc.simulate({ restaurantId: 'rest-1', partySize: 2, startsAt });

    expect(result.feasible).toBe(false);
    expect(result.scenarios).toHaveLength(2);
    expect(result.scenarios[0].type).toBe('direct');
    expect(result.scenarios[0].feasible).toBe(false);
    expect(result.scenarios[1].type).toBe('refuse');
    expect(result.scenarios[1].nextAvailableAt).toBe(nextSlot.toISOString());
    expect(result.scenarios[1].nextAvailableSectionId).toBe('section-a');
    expect(result.bestScenarioId).toBe(result.scenarios[1].id);
    expect(result.explanation).toContain('Prochain créneau');
  });
});

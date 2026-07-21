import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { TableAllocationService } from './table-allocation.service';
import {
  CapacityAwareAvailabilityService,
  zonedTimeToUtc,
} from './availability-capacity-aware.service';
import { resolveServiceDurationMinutes } from './floor-plan.types';

export type SimulationScenarioType = 'direct' | 'change-section' | 'refuse';

export interface SimulationAction {
  type: 'link' | 'api';
  label: string;
  href?: string;
  method?: 'PATCH' | 'POST';
  path?: string;
  body?: Record<string, unknown>;
}

export interface SimulationMetrics {
  coversGained: number;
  conflictsCreated: number;
  estimatedWaitMinutes: number | null;
  tablesImpacted: string[];
  reservationsToMove: {
    id: string;
    customerName?: string;
    fromTableName?: string;
    toTableName?: string;
    newStartsAt?: string;
  }[];
}

export interface SimulationScenario {
  id: string;
  type: SimulationScenarioType;
  feasible: boolean;
  confidence: 'high' | 'medium' | 'low';
  title: string;
  reason: string;
  actions: SimulationAction[];
  metrics: SimulationMetrics;
  table?: {
    id: string;
    name: string;
    capacity: number;
    sectionId: string | null;
    sectionName?: string | null;
    floorPlanName?: string | null;
  };
  nextAvailableAt?: string;
  nextAvailableSectionId?: string;
}

export interface SimulationResult {
  query: { partySize: number; startsAt: string; endsAt: string };
  feasible: boolean;
  scenarios: SimulationScenario[];
  bestScenarioId?: string;
  explanation: string;
}

export interface SimulateInput {
  restaurantId: string;
  partySize: number;
  startsAt: Date;
  endsAt?: Date;
  preferredSectionId?: string;
}

function minutesBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 60_000);
}

function formatZonedDate(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('fr-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function formatZonedTime(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  const hour = parseInt(get('hour'), 10) % 24;
  return `${String(hour).padStart(2, '0')}:${get('minute')}`;
}

function addDaysToZonedDate(dateStr: string, days: number, timeZone: string): string {
  const base = zonedTimeToUtc(dateStr, '12:00', timeZone);
  const shifted = new Date(base.getTime() + days * 86_400_000);
  return formatZonedDate(shifted, timeZone);
}

function reservationHref(input: { partySize: number; startsAt: string; tableId: string }): string {
  const params = new URLSearchParams({
    partySize: String(input.partySize),
    startsAt: input.startsAt,
    tableId: input.tableId,
  });
  return `/dashboard/reservations?${params.toString()}`;
}

/**
 * Service Copilot — simulation "what-if" read-only.
 *
 * Propose jusqu'à 3 scénarios pour accueillir un groupe :
 * 1. Placement direct (table disponible).
 * 2. Changement de section (si la section préférée est pleine).
 * 3. Refus avec proposition du prochain créneau disponible.
 *
 * Aucune écriture en base n'est effectuée ici.
 */
export class ServiceCopilotSimulationService {
  private readonly allocation: TableAllocationService;
  private readonly availability: CapacityAwareAvailabilityService;

  constructor(private readonly prisma: PrismaClient) {
    this.allocation = new TableAllocationService(prisma);
    this.availability = new CapacityAwareAvailabilityService(prisma);
  }

  async simulate(input: SimulateInput): Promise<SimulationResult> {
    const { restaurantId, partySize, startsAt, preferredSectionId } = input;

    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: {
        timezone: true,
        exposureSettings: { select: { capacitySpecials: true } },
      },
    });

    const timeZone = restaurant?.timezone ?? 'Europe/Paris';
    const serviceDurationMinutes = resolveServiceDurationMinutes(
      restaurant?.exposureSettings?.capacitySpecials,
    );
    const endsAt = input.endsAt ?? new Date(startsAt.getTime() + serviceDurationMinutes * 60_000);

    const query = {
      partySize,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    };

    const scenarios: SimulationScenario[] = [];

    // ─── Scénario 1 : placement direct ───
    const directSuggestions = await this.allocation.suggest(
      {
        restaurantId,
        partySize,
        startsAt,
        endsAt,
        preferredSectionId,
      },
      1,
    );
    const directInPreferred =
      directSuggestions.length > 0 &&
      (!preferredSectionId || directSuggestions[0].table.sectionId === preferredSectionId);
    const directScenario = await this.buildDirectScenario({
      suggestions: directSuggestions,
      partySize,
      startsAt,
      endsAt,
      timeZone,
      preferredSectionId,
      directInPreferred,
    });
    scenarios.push(directScenario);

    // ─── Scénario 2 : changement de section ───
    let changeSectionScenario: SimulationScenario | null = null;
    if (preferredSectionId && (!directInPreferred || directSuggestions.length === 0)) {
      changeSectionScenario = await this.buildChangeSectionScenario({
        restaurantId,
        partySize,
        startsAt,
        endsAt,
        preferredSectionId,
        timeZone,
      });
      if (changeSectionScenario) {
        scenarios.push(changeSectionScenario);
      }
    }

    // ─── Scénario 3 : refuse + prochain créneau ───
    const nextAvailable = await this.findNextAvailable({
      restaurantId,
      partySize,
      startsAt,
      serviceDurationMinutes,
      timeZone,
      preferredSectionId,
    });
    const refuseScenario = this.buildRefuseScenario({
      startsAt,
      nextAvailable,
      timeZone,
    });
    scenarios.push(refuseScenario);

    const feasible = scenarios.some(
      (s) => s.feasible && (s.type === 'direct' || s.type === 'change-section'),
    );

    let bestScenarioId: string | undefined;
    if (directScenario.feasible && directInPreferred) {
      bestScenarioId = directScenario.id;
    } else if (changeSectionScenario?.feasible) {
      bestScenarioId = changeSectionScenario.id;
    } else if (directScenario.feasible) {
      bestScenarioId = directScenario.id;
    } else {
      bestScenarioId = refuseScenario.id;
    }

    const explanation = this.buildExplanation({
      directScenario,
      changeSectionScenario,
      partySize,
      startsAt,
      nextAvailable,
      timeZone,
      directInPreferred,
    });

    return { query, feasible, scenarios, bestScenarioId, explanation };
  }

  private async buildDirectScenario(args: {
    suggestions: Awaited<ReturnType<TableAllocationService['suggest']>>;
    partySize: number;
    startsAt: Date;
    endsAt: Date;
    timeZone: string;
    preferredSectionId?: string;
    directInPreferred: boolean;
  }): Promise<SimulationScenario> {
    const { suggestions, partySize, startsAt, timeZone, preferredSectionId, directInPreferred } =
      args;
    const id = randomUUID();

    if (suggestions.length === 0) {
      return {
        id,
        type: 'direct',
        feasible: false,
        confidence: 'high',
        title: 'Aucune table disponible',
        reason: preferredSectionId
          ? 'Aucune table de la section demandée ne peut accueillir ce groupe à ce créneau.'
          : 'Aucune table ne peut accueillir ce groupe à ce créneau.',
        actions: [
          { type: 'link', label: 'Voir les réservations', href: '/dashboard/reservations' },
        ],
        metrics: {
          coversGained: 0,
          conflictsCreated: 0,
          estimatedWaitMinutes: null,
          tablesImpacted: [],
          reservationsToMove: [],
        },
      };
    }

    const best = suggestions[0];
    const table = await this.enrichTable(best.table.id);
    const timeLabel = formatZonedTime(startsAt, timeZone);

    const reasonParts: string[] = [];
    if (preferredSectionId && !directInPreferred) {
      reasonParts.push('La section demandée est pleine ; table disponible en fallback.');
    }
    reasonParts.push(`Table ${table.name} (${table.capacity} couverts) disponible à ${timeLabel}.`);

    return {
      id,
      type: 'direct',
      feasible: true,
      confidence: 'high',
      title: `Table ${table.name} disponible`,
      reason: reasonParts.join(' '),
      actions: [
        {
          type: 'link',
          label: 'Créer la réservation',
          href: reservationHref({ partySize, startsAt: startsAt.toISOString(), tableId: table.id }),
        },
      ],
      metrics: {
        coversGained: partySize,
        conflictsCreated: 0,
        estimatedWaitMinutes: 0,
        tablesImpacted: [table.name],
        reservationsToMove: [],
      },
      table,
    };
  }

  private async buildChangeSectionScenario(args: {
    restaurantId: string;
    partySize: number;
    startsAt: Date;
    endsAt: Date;
    preferredSectionId: string;
    timeZone: string;
  }): Promise<SimulationScenario | null> {
    const { restaurantId, partySize, startsAt, endsAt, preferredSectionId, timeZone } = args;

    const sections = await this.prisma.section.findMany({
      where: { floorPlan: { restaurantId } },
      include: { floorPlan: { select: { name: true } } },
    });

    for (const section of sections) {
      if (section.id === preferredSectionId) continue;

      const suggestions = await this.allocation.suggest(
        {
          restaurantId,
          partySize,
          startsAt,
          endsAt,
          preferredSectionId: section.id,
        },
        1,
      );

      if (suggestions.length > 0) {
        const best = suggestions[0];
        const table = await this.enrichTable(best.table.id);
        const timeLabel = formatZonedTime(startsAt, timeZone);
        return {
          id: randomUUID(),
          type: 'change-section',
          feasible: true,
          confidence: 'medium',
          title: `Changement de section : ${section.name}`,
          reason: `Aucune table dans la section demandée, mais la section ${section.name} peut accueillir ce groupe à ${timeLabel}.`,
          actions: [
            {
              type: 'link',
              label: 'Créer la réservation',
              href: reservationHref({
                partySize,
                startsAt: startsAt.toISOString(),
                tableId: table.id,
              }),
            },
          ],
          metrics: {
            coversGained: partySize,
            conflictsCreated: 0,
            estimatedWaitMinutes: 0,
            tablesImpacted: [table.name],
            reservationsToMove: [],
          },
          table: {
            ...table,
            sectionName: section.name,
            floorPlanName: section.floorPlan?.name ?? table.floorPlanName,
          },
        };
      }
    }

    return null;
  }

  private buildRefuseScenario(args: {
    startsAt: Date;
    nextAvailable: { nextAvailableAt: Date; nextAvailableSectionId?: string } | null;
    timeZone: string;
  }): SimulationScenario {
    const { startsAt, nextAvailable, timeZone } = args;
    const id = randomUUID();

    const waitMinutes = nextAvailable
      ? minutesBetween(startsAt, nextAvailable.nextAvailableAt)
      : null;

    return {
      id,
      type: 'refuse',
      feasible: false,
      confidence: 'low',
      title: 'Aucune table disponible',
      reason: nextAvailable
        ? `Aucune table disponible à ce créneau. Prochain créneau crédible : ${formatZonedTime(
            nextAvailable.nextAvailableAt,
            timeZone,
          )} le ${formatZonedDate(nextAvailable.nextAvailableAt, timeZone)}.`
        : 'Aucune table disponible dans les 7 prochains jours à ce créneau.',
      actions: [{ type: 'link', label: 'Voir les réservations', href: '/dashboard/reservations' }],
      metrics: {
        coversGained: 0,
        conflictsCreated: 0,
        estimatedWaitMinutes: waitMinutes,
        tablesImpacted: [],
        reservationsToMove: [],
      },
      nextAvailableAt: nextAvailable?.nextAvailableAt.toISOString(),
      nextAvailableSectionId: nextAvailable?.nextAvailableSectionId,
    };
  }

  private buildExplanation(args: {
    directScenario: SimulationScenario;
    changeSectionScenario: SimulationScenario | null;
    partySize: number;
    startsAt: Date;
    nextAvailable: { nextAvailableAt: Date; nextAvailableSectionId?: string } | null;
    timeZone: string;
    directInPreferred: boolean;
  }): string {
    const {
      directScenario,
      changeSectionScenario,
      partySize,
      startsAt,
      nextAvailable,
      timeZone,
      directInPreferred,
    } = args;

    if (directScenario.feasible && directInPreferred) {
      const table = directScenario.table;
      return `Table ${table?.name ?? '—'} disponible à ${formatZonedTime(
        startsAt,
        timeZone,
      )} pour ${partySize} couverts.`;
    }

    if (changeSectionScenario?.feasible) {
      return `Aucune table dans la section demandée, mais la section ${
        changeSectionScenario.table?.sectionName ??
        changeSectionScenario.title.split(' : ')[1] ??
        '—'
      } peut accueillir ce groupe à ${formatZonedTime(startsAt, timeZone)}.`;
    }

    if (directScenario.feasible) {
      const table = directScenario.table;
      return `Table ${table?.name ?? '—'} disponible à ${formatZonedTime(
        startsAt,
        timeZone,
      )} pour ${partySize} couverts.`;
    }

    if (nextAvailable) {
      return `Aucune table disponible. Prochain créneau crédible : ${formatZonedTime(
        nextAvailable.nextAvailableAt,
        timeZone,
      )} le ${formatZonedDate(nextAvailable.nextAvailableAt, timeZone)}.`;
    }

    return 'Aucune table disponible dans les 7 prochains jours.';
  }

  private async findNextAvailable(args: {
    restaurantId: string;
    partySize: number;
    startsAt: Date;
    serviceDurationMinutes: number;
    timeZone: string;
    preferredSectionId?: string;
  }): Promise<{ nextAvailableAt: Date; nextAvailableSectionId?: string } | null> {
    const {
      restaurantId,
      partySize,
      startsAt,
      serviceDurationMinutes,
      timeZone,
      preferredSectionId,
    } = args;

    const startDate = formatZonedDate(startsAt, timeZone);
    const startTime = formatZonedTime(startsAt, timeZone);

    for (let offset = 0; offset <= 7; offset++) {
      const date = offset === 0 ? startDate : addDaysToZonedDate(startDate, offset, timeZone);

      // 1. Essayer la section préférée (si fournie).
      if (preferredSectionId) {
        const slot = await this.findFirstAvailableSlot({
          restaurantId,
          date,
          partySize,
          startTime: offset === 0 ? startTime : undefined,
          preferredSectionId,
          serviceDurationMinutes,
          timeZone,
        });
        if (slot) {
          const suggestions = await this.allocation.suggest(
            {
              restaurantId,
              partySize,
              startsAt: slot.slotStart,
              endsAt: slot.slotEnd,
              preferredSectionId,
            },
            1,
          );
          if (suggestions.length > 0) {
            return {
              nextAvailableAt: slot.slotStart,
              nextAvailableSectionId: suggestions[0].table.sectionId ?? undefined,
            };
          }
        }
      }

      // 2. Sinon, chercher dans toutes les sections actives.
      const slot = await this.findFirstAvailableSlot({
        restaurantId,
        date,
        partySize,
        startTime: offset === 0 ? startTime : undefined,
        serviceDurationMinutes,
        timeZone,
      });
      if (slot) {
        const suggestions = await this.allocation.suggest(
          {
            restaurantId,
            partySize,
            startsAt: slot.slotStart,
            endsAt: slot.slotEnd,
          },
          1,
        );
        if (suggestions.length > 0) {
          return {
            nextAvailableAt: slot.slotStart,
            nextAvailableSectionId: suggestions[0].table.sectionId ?? undefined,
          };
        }
      }
    }

    return null;
  }

  private async findFirstAvailableSlot(args: {
    restaurantId: string;
    date: string;
    partySize: number;
    startTime?: string;
    preferredSectionId?: string;
    serviceDurationMinutes: number;
    timeZone: string;
  }): Promise<{ slotStart: Date; slotEnd: Date } | null> {
    const {
      restaurantId,
      date,
      partySize,
      startTime,
      preferredSectionId,
      serviceDurationMinutes,
      timeZone,
    } = args;

    const availability = await this.availability.getAvailability({
      restaurantId,
      date,
      partySize,
      preferredSectionId,
    });

    for (const s of availability.slots) {
      if (!s.available) continue;
      if (startTime && s.time < startTime) continue;

      const slotStart = zonedTimeToUtc(date, s.time, timeZone);
      const slotEnd = new Date(slotStart.getTime() + serviceDurationMinutes * 60_000);
      return { slotStart, slotEnd };
    }

    return null;
  }

  private async enrichTable(
    tableId: string,
  ): Promise<SimulationScenario['table'] & { id: string }> {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
      include: {
        section: { include: { floorPlan: { select: { name: true } } } },
        floorPlan: { select: { name: true } },
      },
    });

    if (!table) {
      return {
        id: tableId,
        name: '—',
        capacity: 0,
        sectionId: null,
        sectionName: null,
        floorPlanName: null,
      };
    }

    return {
      id: table.id,
      name: table.name,
      capacity: table.capacity,
      sectionId: table.sectionId ?? null,
      sectionName: table.section?.name ?? null,
      floorPlanName: table.section?.floorPlan?.name ?? table.floorPlan?.name ?? null,
    };
  }
}

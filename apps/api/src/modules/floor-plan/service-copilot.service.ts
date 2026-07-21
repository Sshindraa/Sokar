import { randomUUID } from 'node:crypto';
import type { PrismaClient, Reservation, WaitingListEntry } from '@prisma/client';
import { TableAllocationService } from './table-allocation.service';
import { resolveServiceDurationMinutes } from './floor-plan.types';
import {
  ServiceTurnPredictionService,
  type TurnPrediction,
} from './service-turn-prediction.service';

export interface ServiceCopilotRecommendation {
  id: string;
  kind: 'reported-delay' | 'late-reservation' | 'table-soon-free' | 'waiting-list-compatible';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  reason: string;
  action: {
    type: 'link' | 'call' | 'api';
    label: string;
    href?: string;
    method?: 'PATCH' | 'POST' | 'DELETE';
    path?: string;
    body?: Record<string, unknown>;
  };
  entityId?: string;
  expiresAt: string;
  metrics?: {
    minutesLate?: number;
    estimatedFreeAt?: string;
    covers?: number;
    tableName?: string;
    customerName?: string;
    estimatedDurationMinutes?: number;
    predictionConfidence?: 'high' | 'medium' | 'low';
    predictionSource?: 'historical-table' | 'historical-restaurant' | 'scheduled';
    predictionSampleSize?: number;
  };
}

type Priority = ServiceCopilotRecommendation['priority'];

const PRIORITY_RANK: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const LATE_THRESHOLD_MINUTES = 15;
const LATE_CRITICAL_MINUTES = 30;
const LATE_WINDOW_AFTER_STARTS_MINUTES = 60;
const SOON_FREE_WINDOW_MINUTES = 15;
const WAITING_LIST_WINDOW_MINUTES = 30;
const WAITING_LIST_URGENCY_MINUTES = 10;

type ReservationWithTable = Pick<
  Reservation,
  'id' | 'restaurantId' | 'customerName' | 'partySize' | 'state' | 'startsAt' | 'endsAt' | 'tableId'
> & { table: { name: string } | null };

type WaitingListEntryMinimal = Pick<
  WaitingListEntry,
  | 'id'
  | 'restaurantId'
  | 'partySize'
  | 'customerFirstName'
  | 'customerLastName'
  | 'customerPhone'
  | 'slotStart'
  | 'slotEnd'
  | 'preferredSectionId'
  | 'status'
  | 'position'
>;

function minutesBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 60_000);
}

function formatTime(date: Date, timeZone: string): string {
  return date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  });
}

/**
 * Service Copilot — moteur de recommandations déterministes, explicables et
 * actionnables pour l'équipe de salle.
 *
 * Règles métier implémentées :
 * 1. Client en retard (> 15 min) sur une réservation CONFIRMED.
 * 2. Table bientôt libre (dans les 15 min) parmi les réservations SEATED.
 * 3. Entrée de file d'attente compatible avec une table disponible dans les 30 min.
 *
 * Aucune mutation de la DB n'est effectuée ici : ce sont des suggestions.
 */
export class ServiceCopilotService {
  private get tableAllocation(): TableAllocationService {
    return new TableAllocationService(this.prisma);
  }

  constructor(private readonly prisma: PrismaClient) {}

  async getRecommendations(
    restaurantId: string,
    now = new Date(),
  ): Promise<ServiceCopilotRecommendation[]> {
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

    const lateThreshold = new Date(now.getTime() - LATE_THRESHOLD_MINUTES * 60_000);
    const soonFreeMax = new Date(now.getTime() + SOON_FREE_WINDOW_MINUTES * 60_000);
    const waitingListMax = new Date(now.getTime() + WAITING_LIST_WINDOW_MINUTES * 60_000);
    const waitingListUrgent = new Date(now.getTime() + WAITING_LIST_URGENCY_MINUTES * 60_000);

    const [lateReservations, seatedReservations, waitingListEntries] = await Promise.all([
      this.fetchLateReservations(restaurantId, lateThreshold),
      this.fetchSeatedReservations(restaurantId, now),
      this.fetchWaitingListEntries(restaurantId, now, waitingListMax),
    ]);
    const reportedDelays = await this.fetchReportedDelays(restaurantId, now);

    const seatedAtByReservation = await this.buildSeatedAtMap(seatedReservations.map((r) => r.id));
    const turnPredictions = await new ServiceTurnPredictionService(
      this.prisma,
    ).predictForReservations({
      restaurantId,
      scheduledDurationMinutes: serviceDurationMinutes,
      now,
      targets: seatedReservations.map((reservation) => ({
        reservationId: reservation.id,
        tableId: reservation.tableId,
        partySize: reservation.partySize,
      })),
    });

    const recommendations: ServiceCopilotRecommendation[] = [];
    const seen = new Set<string>();

    for (const delay of reportedDelays) {
      this.addUnique(recommendations, seen, this.buildReportedDelayRecommendation(delay));
    }

    for (const reservation of lateReservations) {
      const rec = this.buildLateReservationRecommendation(reservation, now, timeZone);
      if (rec) this.addUnique(recommendations, seen, rec);
    }

    for (const reservation of seatedReservations) {
      // TODO(id:seated-audit-log): idéalement on lit l'audit log ; en attendant,
      // on utilise startsAt comme approximation si seatedAt n'est pas connu.
      const seatedAt = seatedAtByReservation.get(reservation.id) ?? reservation.startsAt ?? now;
      const prediction = turnPredictions.get(reservation.id);
      const rec = this.buildTableSoonFreeRecommendation(
        reservation,
        seatedAt,
        prediction ?? {
          durationMinutes: serviceDurationMinutes,
          lowerBoundMinutes: serviceDurationMinutes,
          upperBoundMinutes: serviceDurationMinutes,
          confidence: 'low',
          source: 'scheduled',
          sampleSize: 0,
        },
        now,
        soonFreeMax,
        timeZone,
      );
      if (rec) this.addUnique(recommendations, seen, rec);
    }

    for (const entry of waitingListEntries) {
      const compatible = await this.isWaitingListEntryCompatible(entry, restaurantId);
      if (!compatible) continue;
      const rec = this.buildWaitingListRecommendation(entry, now, waitingListUrgent, timeZone);
      if (rec) this.addUnique(recommendations, seen, rec);
    }

    recommendations.sort((a, b) => {
      const priorityDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
    });

    return recommendations.slice(0, 3);
  }

  private async fetchReportedDelays(restaurantId: string, now: Date) {
    const logs = await this.prisma.reservationAuditLog.findMany({
      where: {
        event: 'reservation_delay_reported',
        createdAt: { gte: new Date(now.getTime() - 4 * 60 * 60_000) },
        reservation: { restaurantId, state: 'CONFIRMED' },
      },
      select: {
        reservationId: true,
        createdAt: true,
        metadata: true,
        reservation: { select: { customerName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const reported = logs.filter(
      (log) =>
        log.reservationId &&
        typeof (log.metadata as { delayMinutes?: unknown } | null | undefined)?.delayMinutes ===
          'number',
    );
    const reservationIds = reported.flatMap((log) =>
      log.reservationId ? [log.reservationId] : [],
    );
    if (reservationIds.length === 0) return reported;
    const recovered = await this.prisma.reservationAuditLog.findMany({
      where: {
        event: 'reservation_delay_recovered',
        reservationId: { in: reservationIds },
      },
      select: { reservationId: true, createdAt: true },
    });
    const recoveredAt = new Map(
      recovered.flatMap((log) =>
        log.reservationId ? [[log.reservationId, log.createdAt] as const] : [],
      ),
    );
    return reported.filter((log) => {
      const recovery = log.reservationId ? recoveredAt.get(log.reservationId) : undefined;
      return !recovery || recovery.getTime() < log.createdAt.getTime();
    });
  }

  private buildReportedDelayRecommendation(
    delay: Awaited<ReturnType<ServiceCopilotService['fetchReportedDelays']>>[number],
  ): ServiceCopilotRecommendation {
    const delayMinutes = (delay.metadata as { delayMinutes: number }).delayMinutes;
    const reservationId = delay.reservationId!;
    return {
      id: randomUUID(),
      kind: 'reported-delay',
      priority: delayMinutes >= 30 ? 'critical' : 'high',
      title: `${delay.reservation?.customerName ?? 'Client'} annonce ${delayMinutes} min de retard`,
      reason:
        'Signalé par téléphone. Analysez l’impact avant de déplacer une table ou de proposer une attente.',
      action: {
        type: 'link',
        label: 'Analyser l’impact',
        href: `/dashboard/floor-plan?reservationId=${encodeURIComponent(reservationId)}&delayMinutes=${delayMinutes}`,
      },
      entityId: reservationId,
      expiresAt: new Date(delay.createdAt.getTime() + 4 * 60 * 60_000).toISOString(),
      metrics: {
        minutesLate: delayMinutes,
        customerName: delay.reservation?.customerName ?? undefined,
      },
    };
  }

  private addUnique(
    list: ServiceCopilotRecommendation[],
    seen: Set<string>,
    rec: ServiceCopilotRecommendation,
  ): void {
    const key = `${rec.kind}:${rec.entityId ?? rec.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push(rec);
  }

  private fetchLateReservations(
    restaurantId: string,
    lateThreshold: Date,
  ): Promise<ReservationWithTable[]> {
    return this.prisma.reservation.findMany({
      where: {
        restaurantId,
        state: 'CONFIRMED',
        startsAt: { not: null, lt: lateThreshold },
      },
      select: {
        id: true,
        restaurantId: true,
        customerName: true,
        partySize: true,
        state: true,
        startsAt: true,
        endsAt: true,
        tableId: true,
        table: { select: { name: true } },
      },
      orderBy: { startsAt: 'asc' },
    }) as Promise<ReservationWithTable[]>;
  }

  private fetchSeatedReservations(
    restaurantId: string,
    now: Date,
  ): Promise<ReservationWithTable[]> {
    return this.prisma.reservation.findMany({
      where: {
        restaurantId,
        state: 'SEATED',
        tableId: { not: null },
        startsAt: { not: null, lte: now },
      },
      select: {
        id: true,
        restaurantId: true,
        customerName: true,
        partySize: true,
        state: true,
        startsAt: true,
        endsAt: true,
        tableId: true,
        table: { select: { name: true } },
      },
      orderBy: { startsAt: 'asc' },
    }) as Promise<ReservationWithTable[]>;
  }

  private async buildSeatedAtMap(reservationIds: string[]): Promise<Map<string, Date>> {
    const seatedLogs = await this.prisma.reservationAuditLog.findMany({
      where: {
        reservationId: { in: reservationIds },
        event: 'reservation_seated',
      },
      orderBy: { createdAt: 'asc' },
      select: { reservationId: true, createdAt: true },
    });

    const map = new Map<string, Date>();
    for (const log of seatedLogs) {
      if (log.reservationId && !map.has(log.reservationId)) {
        map.set(log.reservationId, log.createdAt);
      }
    }
    return map;
  }

  private buildLateReservationRecommendation(
    reservation: ReservationWithTable,
    now: Date,
    _timeZone: string,
  ): ServiceCopilotRecommendation | null {
    if (!reservation.startsAt) return null;

    const minutesLate = Math.max(0, minutesBetween(reservation.startsAt, now));
    const priority: Priority = minutesLate > LATE_CRITICAL_MINUTES ? 'critical' : 'high';
    const expiresAt = new Date(
      reservation.startsAt.getTime() + LATE_WINDOW_AFTER_STARTS_MINUTES * 60_000,
    );

    return {
      id: randomUUID(),
      kind: 'late-reservation',
      priority,
      title: `${reservation.customerName} est en retard de ${minutesLate} min — appeler / marquer absent`,
      reason: `Le client n'est pas arrivé et le créneau a débuté il y a ${minutesLate} minutes.`,
      action: {
        type: 'link',
        label: 'Gérer la réservation',
        href: '/dashboard/reservations',
      },
      entityId: reservation.id,
      expiresAt: expiresAt.toISOString(),
      metrics: {
        minutesLate,
        customerName: reservation.customerName,
      },
    };
  }

  private buildTableSoonFreeRecommendation(
    reservation: ReservationWithTable,
    seatedAt: Date,
    prediction: TurnPrediction,
    now: Date,
    soonFreeMax: Date,
    timeZone: string,
  ): ServiceCopilotRecommendation | null {
    const estimatedFreeAt = new Date(seatedAt.getTime() + prediction.durationMinutes * 60_000);
    if (
      estimatedFreeAt.getTime() <= now.getTime() ||
      estimatedFreeAt.getTime() > soonFreeMax.getTime()
    ) {
      return null;
    }

    const tableName = reservation.table?.name ?? '—';
    return {
      id: randomUUID(),
      kind: 'table-soon-free',
      priority: 'medium',
      title: `Table ${tableName} devrait se libérer vers ${formatTime(estimatedFreeAt, timeZone)} — prévenir ${reservation.customerName} (file d'attente)`,
      reason:
        prediction.source === 'scheduled'
          ? `Le service a commencé vers ${formatTime(seatedAt, timeZone)} ; libération estimée à ${formatTime(estimatedFreeAt, timeZone)} selon la durée configurée.`
          : `Le service a commencé vers ${formatTime(seatedAt, timeZone)} ; libération estimée à ${formatTime(estimatedFreeAt, timeZone)} d'après ${prediction.sampleSize} services comparables.`,
      action: {
        type: 'link',
        label: 'Voir le plan',
        href: '/dashboard/floor-plan',
      },
      entityId: reservation.id,
      expiresAt: estimatedFreeAt.toISOString(),
      metrics: {
        estimatedFreeAt: estimatedFreeAt.toISOString(),
        covers: reservation.partySize,
        tableName,
        customerName: reservation.customerName,
        estimatedDurationMinutes: prediction.durationMinutes,
        predictionConfidence: prediction.confidence,
        predictionSource: prediction.source,
        predictionSampleSize: prediction.sampleSize,
      },
    };
  }

  private fetchWaitingListEntries(
    restaurantId: string,
    now: Date,
    waitingListMax: Date,
  ): Promise<WaitingListEntryMinimal[]> {
    return this.prisma.waitingListEntry.findMany({
      where: {
        restaurantId,
        status: 'PENDING',
        slotStart: { gte: now, lte: waitingListMax },
      },
      select: {
        id: true,
        restaurantId: true,
        partySize: true,
        customerFirstName: true,
        customerLastName: true,
        customerPhone: true,
        slotStart: true,
        slotEnd: true,
        preferredSectionId: true,
        status: true,
        position: true,
      },
      orderBy: { slotStart: 'asc' },
      take: 20,
    }) as Promise<WaitingListEntryMinimal[]>;
  }

  private async isWaitingListEntryCompatible(
    entry: WaitingListEntryMinimal,
    restaurantId: string,
  ): Promise<boolean> {
    const suggestions = await this.tableAllocation.suggest(
      {
        restaurantId,
        partySize: entry.partySize,
        startsAt: entry.slotStart,
        endsAt: entry.slotEnd,
        preferredSectionId: entry.preferredSectionId ?? undefined,
      },
      1,
    );
    return suggestions.length > 0;
  }

  private buildWaitingListRecommendation(
    entry: WaitingListEntryMinimal,
    now: Date,
    waitingListUrgent: Date,
    timeZone: string,
  ): ServiceCopilotRecommendation | null {
    const fullName = `${entry.customerFirstName}${
      entry.customerLastName ? ` ${entry.customerLastName}` : ''
    }`.trim();
    const minutesUntil = Math.max(0, minutesBetween(now, entry.slotStart));
    const priority: Priority =
      entry.slotStart.getTime() < waitingListUrgent.getTime() ? 'high' : 'medium';

    return {
      id: randomUUID(),
      kind: 'waiting-list-compatible',
      priority,
      title: `${fullName}, ${entry.partySize} couverts, devient compatible dans ~${minutesUntil} min — proposer une table`,
      reason: `Une table est disponible vers ${formatTime(entry.slotStart, timeZone)} pour ${entry.partySize} couverts.`,
      action: {
        type: 'link',
        label: 'Proposer une table',
        href: '/dashboard/floor-plan',
      },
      entityId: entry.id,
      expiresAt: entry.slotStart.toISOString(),
      metrics: {
        covers: entry.partySize,
        customerName: fullName,
      },
    };
  }
}

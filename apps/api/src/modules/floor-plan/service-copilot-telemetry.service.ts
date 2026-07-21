import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  CopilotOccurrenceStatus,
  CopilotTelemetryEventType,
  Prisma,
  type PrismaClient,
} from '@prisma/client';
import type { ServiceCopilotRecommendation } from './service-copilot.service';

type TelemetryTokenPayload = {
  restaurantId: string;
  occurrenceKey: string;
  kind: string;
  entityId?: string;
  ruleVersion: string;
  expiresAt?: string;
};

type TelemetryClientEvent = 'VIEWED' | 'OPENED';

type ServerTelemetryEvent =
  | Exclude<TelemetryClientEvent, never>
  | 'APPLIED'
  | 'REVERTED'
  | 'CONFLICTED'
  | 'EXPIRED'
  | 'IGNORED';

type TelemetryClient = PrismaClient | Prisma.TransactionClient;

const EVENT_TO_STATUS: Record<ServerTelemetryEvent, CopilotOccurrenceStatus> = {
  VIEWED: 'OBSERVED',
  OPENED: 'OPENED',
  APPLIED: 'APPLIED',
  REVERTED: 'REVERTED',
  CONFLICTED: 'CONFLICTED',
  EXPIRED: 'EXPIRED',
  IGNORED: 'IGNORED',
};

function encode(payload: TelemetryTokenPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function isPrismaUniqueError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function canTransition(current: CopilotOccurrenceStatus, next: CopilotOccurrenceStatus): boolean {
  if (current === next || next === 'OBSERVED') return false;
  if (current === 'REVERTED') return false;
  if (next === 'APPLIED') return true;
  if (next === 'REVERTED') return current === 'APPLIED';
  if (current === 'APPLIED') return false;
  if (current === 'CONFLICTED' || current === 'EXPIRED' || current === 'IGNORED') return false;
  return true;
}

/**
 * Télémétrie de qualité en shadow mode. Elle ne commande jamais le service :
 * elle mesure les recommandations déjà présentées et leurs résultats.
 */
export class ServiceCopilotTelemetryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly secret = process.env.SERVICE_COPILOT_TELEMETRY_SECRET,
  ) {}

  issueToken(args: {
    restaurantId: string;
    recommendation: ServiceCopilotRecommendation;
  }): string | null {
    if (!this.secret) return null;
    const payload: TelemetryTokenPayload = {
      restaurantId: args.restaurantId,
      occurrenceKey: args.recommendation.occurrenceKey,
      kind: args.recommendation.kind,
      entityId: args.recommendation.entityId,
      ruleVersion: args.recommendation.ruleVersion,
      expiresAt: args.recommendation.expiresAt,
    };
    const data = encode(payload);
    const signature = createHmac('sha256', this.secret).update(data).digest('base64url');
    return `${data}.${signature}`;
  }

  async recordClientEvent(args: {
    token: string;
    event: TelemetryClientEvent;
    idempotencyKey: string;
    actor?: string | null;
    clientTime?: Date;
  }): Promise<{ idempotent: boolean }> {
    const payload = this.verifyToken(args.token);
    return this.recordEvent({
      ...payload,
      event: args.event,
      idempotencyKey: args.idempotencyKey,
      actor: args.actor,
      clientTime: args.clientTime,
    });
  }

  async recordServerEvent(
    args: {
      restaurantId: string;
      occurrenceKey: string;
      kind: string;
      entityId?: string;
      ruleVersion: string;
      expiresAt?: Date;
      event: ServerTelemetryEvent;
      idempotencyKey: string;
      reasonCode?: string;
      actor?: string | null;
      metadata?: Record<string, unknown>;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ idempotent: boolean }> {
    return this.recordEvent(args, tx);
  }

  async finalizeExpired(args: { restaurantId: string; now?: Date }): Promise<number> {
    const now = args.now ?? new Date();
    const stale = await this.prisma.copilotOccurrence.findMany({
      where: {
        restaurantId: args.restaurantId,
        expiresAt: { lt: now },
        status: { in: ['OBSERVED', 'OPENED'] },
      },
      select: {
        id: true,
        occurrenceKey: true,
        kind: true,
        entityId: true,
        ruleVersion: true,
        expiresAt: true,
        status: true,
      },
      take: 500,
    });
    for (const occurrence of stale) {
      await this.recordServerEvent({
        restaurantId: args.restaurantId,
        occurrenceKey: occurrence.occurrenceKey,
        kind: occurrence.kind,
        entityId: occurrence.entityId ?? undefined,
        ruleVersion: occurrence.ruleVersion,
        expiresAt: occurrence.expiresAt ?? undefined,
        event: occurrence.status === 'OBSERVED' ? 'IGNORED' : 'EXPIRED',
        idempotencyKey: `copilot-expiry:${occurrence.id}`,
        reasonCode:
          occurrence.status === 'OBSERVED'
            ? 'not_opened_before_expiry'
            : 'not_applied_before_expiry',
      });
    }
    return stale.length;
  }

  private verifyToken(token: string): TelemetryTokenPayload {
    if (!this.secret) throw new Error('La télémétrie Service Copilot n’est pas configurée.');
    const [data, signature, extra] = token.split('.');
    if (!data || !signature || extra) throw new Error('Jeton de télémétrie invalide.');
    const expected = createHmac('sha256', this.secret).update(data).digest('base64url');
    const valid =
      signature.length === expected.length &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!valid) throw new Error('Jeton de télémétrie invalide.');
    let payload: TelemetryTokenPayload;
    try {
      payload = JSON.parse(
        Buffer.from(data, 'base64url').toString('utf8'),
      ) as TelemetryTokenPayload;
    } catch {
      throw new Error('Jeton de télémétrie invalide.');
    }
    if (
      !payload.restaurantId ||
      !payload.occurrenceKey ||
      !payload.kind ||
      !payload.ruleVersion ||
      (payload.expiresAt && new Date(payload.expiresAt).getTime() < Date.now())
    ) {
      throw new Error('Jeton de télémétrie expiré ou incomplet.');
    }
    return payload;
  }

  private async recordEvent(
    args: {
      restaurantId: string;
      occurrenceKey: string;
      kind: string;
      entityId?: string;
      ruleVersion: string;
      expiresAt?: string | Date;
      event: ServerTelemetryEvent;
      idempotencyKey: string;
      reasonCode?: string;
      actor?: string | null;
      clientTime?: Date;
      metadata?: Record<string, unknown>;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ idempotent: boolean }> {
    const client = (tx ?? this.prisma) as TelemetryClient;
    const occurrence = await client.copilotOccurrence.upsert({
      where: {
        restaurantId_occurrenceKey: {
          restaurantId: args.restaurantId,
          occurrenceKey: args.occurrenceKey,
        },
      },
      create: {
        restaurantId: args.restaurantId,
        occurrenceKey: args.occurrenceKey,
        kind: args.kind,
        entityId: args.entityId,
        ruleVersion: args.ruleVersion,
        expiresAt: args.expiresAt ? new Date(args.expiresAt) : null,
        status: EVENT_TO_STATUS[args.event],
      },
      update: {},
    });
    const existingEvent = await client.copilotTelemetryEvent.findUnique({
      where: { idempotencyKey: args.idempotencyKey },
      select: { id: true },
    });
    if (existingEvent) return { idempotent: true };

    try {
      await client.copilotTelemetryEvent.create({
        data: {
          occurrenceId: occurrence.id,
          idempotencyKey: args.idempotencyKey,
          event: args.event as CopilotTelemetryEventType,
          reasonCode: args.reasonCode,
          actorHash: args.actor ? createHash('sha256').update(args.actor).digest('hex') : null,
          clientTime: args.clientTime,
          metadata: (args.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (isPrismaUniqueError(err)) return { idempotent: true };
      throw err;
    }

    const nextStatus = EVENT_TO_STATUS[args.event];
    if (canTransition(occurrence.status, nextStatus)) {
      await client.copilotOccurrence.update({
        where: { id: occurrence.id },
        data: { status: nextStatus },
      });
    }
    return { idempotent: false };
  }
}

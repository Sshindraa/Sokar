import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { requireOrg } from '../../plugins/clerk';
import { requireCapability } from '../entitlements/entitlement.guard';
import {
  createOrUpdatePosConnection,
  disconnectPosConnection,
  getPosConnectionHealth,
  listPosConnections,
  PosConnectionInputError,
  PosConnectionNotFoundError,
  PosConnectionStateError,
} from './pos-connection.service';
import type { PosCheckInput } from './pos-connector';
import {
  importPosChecks,
  PosCheckInputError,
  upsertReservationCheckMatch,
} from './pos-sync.service';

const ConnectionIdParamsSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

const ConnectionBodySchema = z.object({
  provider: z.string().trim().min(1).max(64),
  externalLocationId: z.string().trim().min(1).max(191),
  credentialReference: z.string().trim().min(1).max(191),
});

const DecimalInputSchema = z.union([
  z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d+)?$/),
  z.number().finite().nonnegative(),
]);

const MatchingHintsSchema = z
  .object({
    reservationExternalId: z.string().trim().min(1).max(256).nullable().optional(),
    partySize: z.number().int().min(1).max(100).nullable().optional(),
    customerPhone: z.string().trim().min(1).max(64).nullable().optional(),
    customerToken: z.string().trim().min(1).max(256).nullable().optional(),
    conflict: z.boolean().optional(),
  })
  .nullable()
  .optional();

const CheckBodySchema = z.object({
  externalId: z.string().trim().min(1).max(256),
  externalRevision: z.string().trim().min(1).max(128).nullable().optional(),
  openedAt: z.coerce.date(),
  closedAt: z.coerce.date().nullable().optional(),
  tableReference: z.string().trim().min(1).max(128).nullable().optional(),
  subtotal: DecimalInputSchema,
  tax: DecimalInputSchema,
  tip: DecimalInputSchema.nullable().optional(),
  discount: DecimalInputSchema.nullable().optional(),
  total: DecimalInputSchema,
  refundedAmount: DecimalInputSchema.nullable().optional(),
  currency: z.string().trim().length(3).optional(),
  rawPayload: z.unknown().optional(),
  reservationId: z.string().trim().min(1).max(128).nullable().optional(),
  matchingHints: MatchingHintsSchema,
});

const ImportBodySchema = z.object({
  checks: z.array(CheckBodySchema).min(1).max(500),
  dryRun: z.boolean().default(true),
  nextCursor: z.string().trim().max(512).nullable().optional(),
});

function posConnectorsEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.POS_CONNECTORS_ENABLED === 'true';
}

async function requirePosRole(
  request: { siteRole?: string },
  reply: FastifyReply,
): Promise<void | FastifyReply> {
  if (request.siteRole === 'OWNER' || request.siteRole === 'MANAGER') return;
  return reply.status(403).send({
    error: 'POS_ROLE_REQUIRED',
    message: 'L’accès aux connexions de caisse est réservé aux responsables.',
  });
}

async function requirePosFeature(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void | FastifyReply> {
  if (posConnectorsEnabled()) return;
  return reply.status(503).send({
    error: 'POS_CONNECTORS_DISABLED',
    message: 'Les connecteurs de caisse sont désactivés jusqu’à la qualification d’un pilote.',
  });
}

const requirePosRead = [
  requireOrg(),
  requireCapability('pos.connect'),
  requirePosRole,
  requirePosFeature,
];
const requirePosWrite = [
  requireOrg(),
  requireCapability('pos.connect'),
  requirePosRole,
  requirePosFeature,
];

function sendPosError(error: unknown, reply: FastifyReply): FastifyReply | undefined {
  if (error instanceof PosConnectionNotFoundError) {
    return reply.status(404).send({ error: error.code });
  }
  if (error instanceof PosConnectionStateError) {
    return reply.status(409).send({ error: error.code });
  }
  if (error instanceof PosConnectionInputError || error instanceof PosCheckInputError) {
    return reply.status(400).send({ error: error.code, message: error.message });
  }
  return undefined;
}

/** Local POS foundation. Provider adapters are intentionally not registered yet. */
export async function posRoutes(app: FastifyInstance) {
  app.get('/pos/connections', { preHandler: requirePosRead }, async (request, reply) => {
    return reply.send({ data: await listPosConnections(request.restaurantId) });
  });

  app.post('/pos/connections', { preHandler: requirePosWrite }, async (request, reply) => {
    const body = ConnectionBodySchema.parse(request.body);
    try {
      return reply.status(201).send({
        data: await createOrUpdatePosConnection(request.restaurantId, body),
      });
    } catch (error) {
      return sendPosError(error, reply) ?? Promise.reject(error);
    }
  });

  app.get('/pos/connections/:id/health', { preHandler: requirePosRead }, async (request, reply) => {
    const { id } = ConnectionIdParamsSchema.parse(request.params);
    try {
      return reply.send({ data: await getPosConnectionHealth(request.restaurantId, id) });
    } catch (error) {
      return sendPosError(error, reply) ?? Promise.reject(error);
    }
  });

  app.post(
    '/pos/connections/:id/disconnect',
    { preHandler: requirePosWrite },
    async (request, reply) => {
      const { id } = ConnectionIdParamsSchema.parse(request.params);
      try {
        return reply.send({ data: await disconnectPosConnection(request.restaurantId, id) });
      } catch (error) {
        return sendPosError(error, reply) ?? Promise.reject(error);
      }
    },
  );

  app.post(
    '/pos/connections/:id/checks/import',
    { preHandler: requirePosWrite },
    async (request, reply) => {
      const { id } = ConnectionIdParamsSchema.parse(request.params);
      const body = ImportBodySchema.parse(request.body);
      try {
        const result = await importPosChecks({
          restaurantId: request.restaurantId,
          connectionId: id,
          checks: body.checks as PosCheckInput[],
          dryRun: body.dryRun,
          nextCursor: body.nextCursor,
        });

        // Matching is opt-in per imported row. Reservation data is always
        // re-read through the tenant scope; a low-confidence result is only a
        // review suggestion and never enriches a customer profile.
        const matches = [];
        if (!body.dryRun) {
          for (const input of body.checks) {
            if (!input.reservationId) continue;
            const persisted = result.checks.find(
              (check) => check.externalId === input.externalId,
            ) as { id?: string; openedAt: string; tableReference: string | null } | undefined;
            if (!persisted?.id) continue;
            const reservation = await db.reservation.findFirst({
              where: { id: input.reservationId, restaurantId: request.restaurantId },
              select: {
                id: true,
                reservedAt: true,
                startsAt: true,
                partySize: true,
                tableId: true,
                customerPhone: true,
              },
            });
            if (!reservation) continue;
            matches.push(
              await upsertReservationCheckMatch({
                restaurantId: request.restaurantId,
                reservationId: reservation.id,
                posCheckId: persisted.id,
                reservation: reservation,
                check: {
                  id: persisted.id,
                  openedAt: persisted.openedAt,
                  tableReference: persisted.tableReference,
                  ...input.matchingHints,
                },
              }),
            );
          }
        }
        return reply.send({ data: result, matches });
      } catch (error) {
        return sendPosError(error, reply) ?? Promise.reject(error);
      }
    },
  );
}

export { posConnectorsEnabled };

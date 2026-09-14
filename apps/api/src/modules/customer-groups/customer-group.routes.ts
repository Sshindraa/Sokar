import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CustomerGroupConsentStatus } from '@prisma/client';
import { z } from 'zod';
import { requireOrg } from '../../plugins/clerk';
import { requireCapability } from '../entitlements/entitlement.guard';
import {
  createCustomerGroup,
  CustomerGroupConflictError,
  CustomerGroupCustomerNotFoundError,
  CustomerGroupInputError,
  CustomerGroupNotFoundError,
  getCustomerGroup,
  linkCustomerToGroup,
  listCustomerGroups,
  unlinkCustomerFromGroup,
  updateCustomerGroupConsent,
} from './customer-group.service';

const GroupParamsSchema = z.object({
  groupId: z.string().trim().min(1).max(128),
});

const CustomerParamsSchema = GroupParamsSchema.extend({
  customerId: z.string().trim().min(1).max(128),
});

const CreateGroupBodySchema = z.object({
  name: z.string().min(1).max(120),
  consentStatus: z.nativeEnum(CustomerGroupConsentStatus).optional(),
});

const ConsentBodySchema = z.object({
  consentStatus: z.nativeEnum(CustomerGroupConsentStatus),
});

const LinkMemberBodySchema = z.object({
  customerId: z.string().trim().min(1).max(128),
  source: z.string().trim().min(2).max(32),
  confidence: z.number().finite().min(0).max(1).optional(),
});

const IdempotencyKeySchema = z.string().trim().min(8).max(200);

function customerGroupsEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.CUSTOMER_GROUPS_ENABLED === 'true';
}

function readIdempotencyKey(request: FastifyRequest): string | undefined {
  const value = request.headers['idempotency-key'];
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === undefined) return undefined;
  return IdempotencyKeySchema.parse(candidate);
}

async function requireCustomerGroupFeature(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void | FastifyReply> {
  if (customerGroupsEnabled()) return;
  return reply.status(503).send({
    error: 'CUSTOMER_GROUPS_DISABLED',
    message: 'Le CRM groupe reste désactivé jusqu’à la qualification du pilote multi-site.',
  });
}

async function requireCustomerGroupRole(
  request: { siteRole?: string },
  reply: FastifyReply,
): Promise<void | FastifyReply> {
  if (request.siteRole === 'OWNER' || request.siteRole === 'MANAGER') return;
  return reply.status(403).send({
    error: 'CUSTOMER_GROUP_ROLE_REQUIRED',
    message: 'La gestion du CRM groupe est réservée aux responsables.',
  });
}

async function requireCustomerGroupOwner(
  request: { siteRole?: string },
  reply: FastifyReply,
): Promise<void | FastifyReply> {
  if (request.siteRole === 'OWNER') return;
  return reply.status(403).send({
    error: 'CUSTOMER_GROUP_OWNER_REQUIRED',
    message: 'La modification du consentement inter-établissements est réservée au propriétaire.',
  });
}

function sendCustomerGroupError(error: unknown, reply: FastifyReply): FastifyReply | undefined {
  if (
    error instanceof CustomerGroupNotFoundError ||
    error instanceof CustomerGroupCustomerNotFoundError
  ) {
    return reply.status(404).send({ error: error.code });
  }
  if (error instanceof CustomerGroupConflictError) {
    return reply.status(409).send({ error: error.code });
  }
  if (error instanceof CustomerGroupInputError) {
    return reply.status(400).send({ error: error.code, message: error.message });
  }
  return undefined;
}

const groupRead = [
  requireOrg(),
  requireCapability('customers.group'),
  requireCustomerGroupRole,
  requireCustomerGroupFeature,
];

const groupWrite = groupRead;

/**
 * Account-level customer identity routes.
 *
 * The active site is supplied by requireOrg(); account and site identifiers
 * are never accepted from the request body. The feature flag stays closed
 * until a multi-site pilot has validated consent and matching procedures.
 */
export async function customerGroupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/customer-groups', { preHandler: groupRead }, async (request, reply) => {
    try {
      return reply.send({
        data: await listCustomerGroups({
          accountId: request.accountId,
          restaurantId: request.restaurantId,
        }),
      });
    } catch (error) {
      return sendCustomerGroupError(error, reply) ?? Promise.reject(error);
    }
  });

  app.post('/customer-groups', { preHandler: groupWrite }, async (request, reply) => {
    const body = CreateGroupBodySchema.parse(request.body);
    try {
      const group = await createCustomerGroup({
        accountId: request.accountId,
        restaurantId: request.restaurantId,
        name: body.name,
        consentStatus: body.consentStatus,
        idempotencyKey: readIdempotencyKey(request),
        actor: `${request.userId ?? 'unknown'}:${request.restaurantId}`,
      });
      return reply.status(201).send({ data: group });
    } catch (error) {
      return sendCustomerGroupError(error, reply) ?? Promise.reject(error);
    }
  });

  app.get('/customer-groups/:groupId', { preHandler: groupRead }, async (request, reply) => {
    const { groupId } = GroupParamsSchema.parse(request.params);
    try {
      return reply.send({
        data: await getCustomerGroup({
          accountId: request.accountId,
          restaurantId: request.restaurantId,
          groupId,
        }),
      });
    } catch (error) {
      return sendCustomerGroupError(error, reply) ?? Promise.reject(error);
    }
  });

  app.patch(
    '/customer-groups/:groupId/consent',
    { preHandler: [...groupWrite, requireCustomerGroupOwner] },
    async (request, reply) => {
      const { groupId } = GroupParamsSchema.parse(request.params);
      const body = ConsentBodySchema.parse(request.body);
      try {
        const group = await updateCustomerGroupConsent({
          accountId: request.accountId,
          restaurantId: request.restaurantId,
          groupId,
          consentStatus: body.consentStatus,
        });
        return reply.send({ data: group });
      } catch (error) {
        return sendCustomerGroupError(error, reply) ?? Promise.reject(error);
      }
    },
  );

  app.post(
    '/customer-groups/:groupId/members',
    { preHandler: groupWrite },
    async (request, reply) => {
      const { groupId } = GroupParamsSchema.parse(request.params);
      const body = LinkMemberBodySchema.parse(request.body);
      try {
        const result = await linkCustomerToGroup({
          accountId: request.accountId,
          restaurantId: request.restaurantId,
          groupId,
          customerId: body.customerId,
          source: body.source,
          confidence: body.confidence,
        });
        return reply.status(result.idempotent ? 200 : 201).send({ data: result });
      } catch (error) {
        return sendCustomerGroupError(error, reply) ?? Promise.reject(error);
      }
    },
  );

  app.delete(
    '/customer-groups/:groupId/members/:customerId',
    { preHandler: groupWrite },
    async (request, reply) => {
      const { groupId, customerId } = CustomerParamsSchema.parse(request.params);
      try {
        const result = await unlinkCustomerFromGroup({
          accountId: request.accountId,
          restaurantId: request.restaurantId,
          groupId,
          customerId,
        });
        return reply.send({ data: result });
      } catch (error) {
        return sendCustomerGroupError(error, reply) ?? Promise.reject(error);
      }
    },
  );
}

export { customerGroupsEnabled };

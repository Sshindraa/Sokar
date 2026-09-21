import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ReputationFeedbackRequestStatus, ReputationRecoveryTaskStatus } from '@prisma/client';
import { requireOrg } from '../../plugins/clerk';
import { requireCapability } from '../entitlements/entitlement.guard';
import { RATE_LIMIT_PUBLIC_WRITE } from '../../plugins/rate-limit.policy';
import {
  REPUTATION_FEEDBACK_CHANNELS,
  REPUTATION_RECOVERY_STATUSES,
  createReputationFeedbackRequest,
  getReputationFeedbackRequest,
  listReputationFeedback,
  listReputationFeedbackRequests,
  listReputationRecoveryTasks,
  submitReputationFeedback,
  updateReputationRecoveryTask,
  ReputationCustomerNotFoundError,
  ReputationFeedbackRequestNotFoundError,
  ReputationFeedbackNotFoundError,
  ReputationFeedbackStateError,
  ReputationInputError,
  ReputationReservationNotFoundError,
  ReputationRecoveryTaskNotFoundError,
  ReputationSiteUnavailableError,
} from './reputation.service';

const RequestParamsSchema = z.object({ id: z.string().trim().min(1).max(128) });
const TaskParamsSchema = z.object({ id: z.string().trim().min(1).max(128) });
const CreateRequestBodySchema = z.object({
  reservationId: z.string().trim().min(1).max(128),
  channel: z.enum(REPUTATION_FEEDBACK_CHANNELS),
  expiresInHours: z.number().int().min(1).max(720).optional(),
});
const SubmitFeedbackBodySchema = z.object({
  token: z.string().trim().min(32).max(200),
  score: z.number().int().min(1).max(5),
  comment: z.string().max(2_000).nullable().optional(),
});
const FeedbackListQuerySchema = z.object({
  minScore: z.coerce.number().int().min(1).max(5).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const RequestListQuerySchema = z.object({
  status: z.nativeEnum(ReputationFeedbackRequestStatus).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const RecoveryListQuerySchema = z.object({
  status: z.enum(REPUTATION_RECOVERY_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const UpdateTaskBodySchema = z.object({
  status: z.nativeEnum(ReputationRecoveryTaskStatus),
  resolutionCode: z.string().trim().max(32).nullable().optional(),
  resolutionNote: z.string().max(2_000).nullable().optional(),
});

function reputationEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.REPUTATION_ENABLED === 'true';
}

async function requireReputationFeature(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void | FastifyReply> {
  if (reputationEnabled()) return;
  return reply.status(503).send({
    error: 'REPUTATION_DISABLED',
    message: 'Les retours clients restent désactivés jusqu’à la qualification du pilote.',
  });
}

async function requireReputationRole(
  request: { siteRole?: string },
  reply: FastifyReply,
): Promise<void | FastifyReply> {
  if (request.siteRole === 'OWNER' || request.siteRole === 'MANAGER') return;
  return reply.status(403).send({
    error: 'REPUTATION_ROLE_REQUIRED',
    message: 'La réputation et les actions de récupération sont réservées aux responsables.',
  });
}

function sendReputationError(error: unknown, reply: FastifyReply): FastifyReply | undefined {
  if (
    error instanceof ReputationFeedbackRequestNotFoundError ||
    error instanceof ReputationReservationNotFoundError ||
    error instanceof ReputationCustomerNotFoundError ||
    error instanceof ReputationRecoveryTaskNotFoundError
  ) {
    return reply.status(404).send({ error: error.code });
  }
  if (error instanceof ReputationSiteUnavailableError) {
    return reply.status(404).send({ error: error.code });
  }
  if (error instanceof ReputationFeedbackStateError) {
    return reply.status(409).send({ error: error.code });
  }
  if (error instanceof ReputationInputError) {
    return reply.status(400).send({ error: error.code, message: error.message });
  }
  return undefined;
}

const protectedRead = [
  requireOrg(),
  requireCapability('reputation.feedback'),
  requireReputationRole,
  requireReputationFeature,
];
const protectedWrite = protectedRead;

/**
 * Provider-neutral reputation foundation. Requests are created in dry-run and
 * the public submission endpoint consumes an opaque, expiring token. No SMS,
 * email, review-platform or loyalty provider is contacted here.
 */
export async function reputationRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/reputation/feedback-requests',
    { preHandler: protectedWrite },
    async (request, reply) => {
      const body = CreateRequestBodySchema.parse(request.body);
      try {
        const result = await createReputationFeedbackRequest({
          restaurantId: request.restaurantId,
          reservationId: body.reservationId,
          channel: body.channel,
          expiresInHours: body.expiresInHours,
        });
        return reply.status(result.replayed ? 200 : 201).send({ data: result });
      } catch (error) {
        return sendReputationError(error, reply) ?? Promise.reject(error);
      }
    },
  );

  app.get(
    '/reputation/feedback-requests',
    { preHandler: protectedRead },
    async (request, reply) => {
      const query = RequestListQuerySchema.parse(request.query);
      try {
        return reply.send({
          data: await listReputationFeedbackRequests({
            restaurantId: request.restaurantId,
            status: query.status,
            limit: query.limit,
          }),
        });
      } catch (error) {
        return sendReputationError(error, reply) ?? Promise.reject(error);
      }
    },
  );

  app.get(
    '/reputation/feedback-requests/:id',
    { preHandler: protectedRead },
    async (request, reply) => {
      const { id } = RequestParamsSchema.parse(request.params);
      try {
        return reply.send({
          data: await getReputationFeedbackRequest({
            restaurantId: request.restaurantId,
            requestId: id,
          }),
        });
      } catch (error) {
        return sendReputationError(error, reply) ?? Promise.reject(error);
      }
    },
  );

  app.get('/reputation/feedback', { preHandler: protectedRead }, async (request, reply) => {
    const query = FeedbackListQuerySchema.parse(request.query);
    try {
      return reply.send({
        data: await listReputationFeedback({
          restaurantId: request.restaurantId,
          minScore: query.minScore,
          limit: query.limit,
        }),
      });
    } catch (error) {
      return sendReputationError(error, reply) ?? Promise.reject(error);
    }
  });

  app.get('/reputation/recovery-tasks', { preHandler: protectedRead }, async (request, reply) => {
    const query = RecoveryListQuerySchema.parse(request.query);
    try {
      return reply.send({
        data: await listReputationRecoveryTasks({
          restaurantId: request.restaurantId,
          status: query.status,
          limit: query.limit,
        }),
      });
    } catch (error) {
      return sendReputationError(error, reply) ?? Promise.reject(error);
    }
  });

  app.patch(
    '/reputation/recovery-tasks/:id',
    { preHandler: protectedWrite },
    async (request, reply) => {
      const { id } = TaskParamsSchema.parse(request.params);
      const body = UpdateTaskBodySchema.parse(request.body);
      try {
        return reply.send({
          data: await updateReputationRecoveryTask({
            restaurantId: request.restaurantId,
            taskId: id,
            status: body.status,
            resolutionCode: body.resolutionCode,
            resolutionNote: body.resolutionNote,
            actor: request.userId ?? undefined,
          }),
        });
      } catch (error) {
        return sendReputationError(error, reply) ?? Promise.reject(error);
      }
    },
  );

  // Public, token-gated endpoint. The feature guard is deliberate: a token
  // cannot be used while the local foundation is disabled during the freeze.
  app.post(
    '/reputation/feedback/submit',
    {
      preHandler: requireReputationFeature,
      config: { rateLimit: RATE_LIMIT_PUBLIC_WRITE },
    },
    async (request, reply) => {
      const body = SubmitFeedbackBodySchema.parse(request.body);
      try {
        const result = await submitReputationFeedback(body);
        return reply.status(result.replayed ? 200 : 201).send({
          data: {
            feedbackId: result.feedback.id,
            recoveryTaskCreated: Boolean(result.recoveryTask),
            replayed: result.replayed,
          },
        });
      } catch (error) {
        // Public tokens deliberately return one generic 404 to avoid revealing
        // whether a reservation or customer exists.
        if (
          error instanceof ReputationFeedbackRequestNotFoundError ||
          error instanceof ReputationFeedbackNotFoundError
        ) {
          return reply.status(404).send({ error: 'REPUTATION_FEEDBACK_NOT_FOUND' });
        }
        return sendReputationError(error, reply) ?? Promise.reject(error);
      }
    },
  );
}

export { reputationEnabled };

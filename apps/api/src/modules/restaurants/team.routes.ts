import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireOrg } from '../../plugins/clerk';
import {
  TeamError,
  changeMemberRole,
  inviteMember,
  listTeam,
  removeMember,
  revokeInvitation,
  transferOwnership,
  type TeamErrorCode,
} from './team.service';

const STATUS_BY_CODE: Record<TeamErrorCode, number> = {
  INVALID_EMAIL: 400,
  INVALID_ROLE: 400,
  TOO_MANY_INVITATIONS: 409,
  ALREADY_INVITED: 409,
  ALREADY_MEMBER: 409,
  MEMBER_NOT_FOUND: 404,
  INVITATION_NOT_FOUND: 404,
  CANNOT_EDIT_SELF: 403,
  CANNOT_EDIT_OWNER: 403,
  IDENTITY_PROVIDER_UNAVAILABLE: 502,
  TRANSFER_INVALID: 409,
};

const InviteBody = z.object({ email: z.string().min(3).max(254), role: z.string().min(1).max(32) });
const RoleBody = z.object({ role: z.string().min(1).max(32) });
const TransferBody = z
  .object({
    targetUserId: z.string().trim().min(1).max(128),
    previousOwnerAccess: z.enum(['MANAGER', 'READ_ONLY', 'NONE']),
  })
  .strict();

const inviteRateLimit = { max: 20, timeWindow: '1 minute' };

/**
 * L'équipe se gère depuis le compte, par son propriétaire : inviter, changer un rôle, retirer.
 * L'accès des rôles aux autres routes est réglé par `role-policy.ts`.
 */
export async function teamRoutes(app: FastifyInstance) {
  type Owner = { organizationId: string; accountId: string; userId: string };

  /** Propriétaire d'un compte Sokar relié à une organisation Clerk, sinon la réponse est faite. */
  function requireOwner(req: FastifyRequest, reply: FastifyReply): Owner | null {
    if (req.siteRole !== 'OWNER' || !req.accountId || !req.clerkOrganizationId || !req.userId) {
      reply.status(403).send({
        error: 'TEAM_OWNER_REQUIRED',
        message: 'Seul le propriétaire du compte peut gérer l’équipe.',
      });
      return null;
    }
    return {
      organizationId: req.clerkOrganizationId,
      accountId: req.accountId,
      userId: req.userId,
    };
  }

  function sendTeamError(reply: FastifyReply, error: unknown) {
    if (error instanceof TeamError) {
      return reply
        .status(STATUS_BY_CODE[error.code])
        .send({ error: error.code, message: error.message });
    }
    throw error;
  }

  app.get('/team', { preHandler: requireOrg() }, async (req, reply) => {
    const owner = requireOwner(req, reply);
    if (!owner) return;
    try {
      return reply.send(
        await listTeam({
          organizationId: owner.organizationId,
          accountId: owner.accountId,
          currentUserId: owner.userId,
        }),
      );
    } catch (error) {
      return sendTeamError(reply, error);
    }
  });

  app.post('/team/transfer-ownership', { preHandler: requireOrg() }, async (req, reply) => {
    const owner = requireOwner(req, reply);
    if (!owner) return;
    const body = TransferBody.parse(req.body ?? {});
    try {
      await transferOwnership({ ...owner, actingUserId: owner.userId, ...body });
      return reply.status(204).send();
    } catch (error) {
      return sendTeamError(reply, error);
    }
  });

  app.post(
    '/team/invitations',
    { preHandler: requireOrg(), config: { rateLimit: inviteRateLimit } },
    async (req, reply) => {
      const owner = requireOwner(req, reply);
      if (!owner) return;
      const body = InviteBody.parse(req.body ?? {});
      try {
        const invitation = await inviteMember({
          organizationId: owner.organizationId,
          inviterUserId: owner.userId,
          email: body.email,
          role: body.role,
          redirectUrl: `${(process.env.DASHBOARD_URL ?? 'https://sokar.tech').replace(/\/$/, '')}/register`,
        });
        // Ni l'adresse ni le nom de l'invité ne vont dans les journaux.
        req.log.info({ invited_role: invitation.role }, 'team invitation sent');
        return reply.status(201).send(invitation);
      } catch (error) {
        return sendTeamError(reply, error);
      }
    },
  );

  app.delete<{ Params: { invitationId: string } }>(
    '/team/invitations/:invitationId',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const owner = requireOwner(req, reply);
      if (!owner) return;
      try {
        await revokeInvitation({
          organizationId: owner.organizationId,
          invitationId: req.params.invitationId,
          requestingUserId: owner.userId,
        });
        return reply.status(204).send();
      } catch (error) {
        return sendTeamError(reply, error);
      }
    },
  );

  app.patch<{ Params: { userId: string } }>(
    '/team/members/:userId',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const owner = requireOwner(req, reply);
      if (!owner) return;
      const body = RoleBody.parse(req.body ?? {});
      try {
        await changeMemberRole({
          accountId: owner.accountId,
          userId: req.params.userId,
          role: body.role,
          actingUserId: owner.userId,
        });
        req.log.info({ new_role: body.role }, 'team member role changed');
        return reply.status(204).send();
      } catch (error) {
        return sendTeamError(reply, error);
      }
    },
  );

  app.delete<{ Params: { userId: string } }>(
    '/team/members/:userId',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const owner = requireOwner(req, reply);
      if (!owner) return;
      try {
        await removeMember({
          organizationId: owner.organizationId,
          accountId: owner.accountId,
          userId: req.params.userId,
          actingUserId: owner.userId,
        });
        req.log.info('team member removed');
        return reply.status(204).send();
      } catch (error) {
        return sendTeamError(reply, error);
      }
    },
  );
}

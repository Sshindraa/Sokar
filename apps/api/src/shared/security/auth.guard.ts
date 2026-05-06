import { FastifyRequest, FastifyReply } from 'fastify';
import { auth } from '../../lib/auth';

export async function authGuard(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const session = await auth.api.getSession({ headers: req.headers as any });
  if (!session?.user) {
    reply.status(401).send({ error: 'Unauthorized' });
    return;
  }
  (req as any).user = session.user;
}

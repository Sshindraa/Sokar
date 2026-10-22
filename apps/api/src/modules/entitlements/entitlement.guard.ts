import type { FastifyReply, FastifyRequest } from 'fastify';
import type { EntitlementCapability } from '@sokar/config';
import { evaluateCapability } from './entitlement.service';

/** Runtime flags default open outside production so local contract tests and
 * development keep working without copying a deployment .env file. Production
 * is fail-closed when a flag is absent. */
export function isRuntimeFlagEnabled(
  flagName: string,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const configured = environment[flagName]?.trim().toLowerCase();
  if (configured === undefined) return environment.NODE_ENV !== 'production';
  return configured === 'true';
}

export function requireRuntimeFlag(
  flagName: string,
  message: string,
  error = `${flagName}_DISABLED`,
) {
  return async (_request: FastifyRequest, reply: FastifyReply) => {
    if (isRuntimeFlagEnabled(flagName)) return;
    return reply.status(503).send({ error, message });
  };
}

/** Server-side commercial guard. Runtime flags and provider health are checked separately. */
export function requireCapability(capability: EntitlementCapability) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const decision = await evaluateCapability(request.restaurantId, capability);
    if (!decision.allowed) {
      return reply.status(403).send({
        error: 'CAPABILITY_NOT_INCLUDED',
        message: 'Cette fonctionnalité n’est pas incluse dans votre formule.',
        capability,
        plan: decision.plan,
      });
    }
  };
}

import { buildApp } from '../main';
import type { FastifyInstance } from 'fastify';
import { vi } from 'vitest';

// Mock Clerk plugin — évite la validation des clés API en test
vi.mock('../plugins/clerk', () => ({
  registerClerk: vi.fn().mockResolvedValue(undefined),
  requireOrg: () => {
    return async (req: any, reply: any) => {
      const authHeader = req.headers?.authorization;
      if (!authHeader) {
        return reply.status(401).send({ error: 'Authentication required' });
      }
      (req as any).restaurantId = 'test-rest-1';
      (req as any).userId = 'test-user-1';
    };
  },
  requireAuth: () => {
    return async (req: any, reply: any) => {
      const authHeader = req.headers?.authorization;
      if (!authHeader) {
        return reply.status(401).send({ error: 'Authentication required' });
      }
      (req as any).userId = 'test-user-1';
    };
  },
}));

let app: FastifyInstance | null = null;

export async function getApp(): Promise<FastifyInstance> {
  if (!app) {
    app = await buildApp();
    await app.ready();
  }
  return app;
}

export async function closeApp(): Promise<void> {
  if (app) {
    await app.close();
    app = null;
  }
}

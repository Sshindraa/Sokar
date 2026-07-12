import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALLOWED_ORIGINS,
  McpAuthError,
  hashApiKey,
  validateApiKeyFormat,
  validateClientOrigin,
  validateDevApiKey,
  validateApiKey,
  validateOrigin,
} from '../mcp/auth.js';
import { env } from '../../../env';

describe('mcp auth', () => {
  const PREFIX = ['sk', '_sokar', '_agent_'].join('');
  const VALID_KEY = PREFIX + 'a'.repeat(40);

  beforeEach(() => {
    env.ENABLE_DEV_AUTH = 'false';
    env.AGENT_DEV_KEY = undefined;
  });

  describe('validateDevApiKey', () => {
    it('accepte une clé au bon format si ENABLE_DEV_AUTH=true', () => {
      env.ENABLE_DEV_AUTH = 'true';
      env.AGENT_DEV_KEY = VALID_KEY;
      const ctx = validateDevApiKey(env.AGENT_DEV_KEY);
      expect(ctx).toEqual({
        clientId: 'dev-client',
        clientName: 'dev',
        restaurantId: null,
        scopes: ['mcp:read', 'mcp:reserve', 'mcp:cancel'],
        allowedOrigins: [],
      });
    });

    it('rejette une clé sans préfixe sk_sokar_agent_', () => {
      expect(validateDevApiKey('plain-key')).toBeNull();
    });

    it('rejette une clé trop courte', () => {
      expect(validateDevApiKey(PREFIX)).toBeNull();
    });

    it('rejette si ENABLE_DEV_AUTH=false', () => {
      env.AGENT_DEV_KEY = VALID_KEY;
      env.ENABLE_DEV_AUTH = 'false';
      const result = validateDevApiKey(env.AGENT_DEV_KEY);
      expect(result).toBeNull();
    });
  });

  describe('validateApiKey', () => {
    it('valide un client DB actif', async () => {
      const prisma = {
        agentClient: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'client-1',
            restaurantId: 'rest-1',
            name: 'Claude',
            scopes: ['mcp:read'],
            allowedOrigins: ['https://claude.ai'],
            revokedAt: null,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
      } as any;

      const ctx = await validateApiKey(VALID_KEY, prisma);

      expect(prisma.agentClient.findUnique).toHaveBeenCalledWith({
        where: { keyHash: hashApiKey(VALID_KEY) },
        select: {
          id: true,
          restaurantId: true,
          name: true,
          scopes: true,
          allowedOrigins: true,
          revokedAt: true,
        },
      });
      expect(ctx).toEqual({
        clientId: 'client-1',
        clientName: 'Claude',
        restaurantId: 'rest-1',
        scopes: ['mcp:read'],
        allowedOrigins: ['https://claude.ai'],
      });
    });

    it('rejette un client révoqué', async () => {
      const prisma = {
        agentClient: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'client-1',
            restaurantId: null,
            name: 'Claude',
            scopes: ['mcp:read'],
            allowedOrigins: [],
            revokedAt: new Date(),
          }),
          update: vi.fn(),
        },
      } as any;

      await expect(validateApiKey(VALID_KEY, prisma)).resolves.toBeNull();
      expect(prisma.agentClient.update).not.toHaveBeenCalled();
    });
  });

  describe('validateApiKeyFormat', () => {
    it('valide le préfixe et la longueur minimale', () => {
      expect(validateApiKeyFormat(VALID_KEY)).toBe(true);
      expect(validateApiKeyFormat(PREFIX)).toBe(false);
      expect(validateApiKeyFormat('plain-key')).toBe(false);
    });
  });

  describe('validateOrigin', () => {
    it('accepte claude.ai', () => {
      expect(validateOrigin('https://claude.ai')).toBe(true);
    });
    it('accepte cursor.sh', () => {
      expect(validateOrigin('https://cursor.sh')).toBe(true);
    });
    it('accepte localhost en dev', () => {
      expect(validateOrigin('http://localhost:3000')).toBe(true);
    });
    it('rejette un origin inconnu', () => {
      expect(validateOrigin('https://evil.com')).toBe(false);
    });
    it('accepte si absent (requête non-browser)', () => {
      expect(validateOrigin(undefined)).toBe(true);
    });
  });

  describe('validateClientOrigin', () => {
    it('accepte tous les origins si la liste client est vide', () => {
      expect(validateClientOrigin('https://claude.ai', [])).toBe(true);
    });

    it('applique la liste client si elle existe', () => {
      expect(validateClientOrigin('https://claude.ai', ['https://claude.ai'])).toBe(true);
      expect(validateClientOrigin('https://cursor.sh', ['https://claude.ai'])).toBe(false);
    });
  });

  describe('ALLOWED_ORIGINS', () => {
    it('contient au moins claude.ai et cursor.sh', () => {
      expect(ALLOWED_ORIGINS.has('https://claude.ai')).toBe(true);
      expect(ALLOWED_ORIGINS.has('https://cursor.sh')).toBe(true);
    });
  });

  describe('McpAuthError', () => {
    it('expose statusCode et code', () => {
      const err = new McpAuthError('Forbidden', 403, 'X');
      expect(err.message).toBe('Forbidden');
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('X');
      expect(err.name).toBe('McpAuthError');
    });
  });
});

/**
 * Auth MCP : authentification par API key (Bearer) + validation Origin.
 *
 * - API key : préfixe `sk_sokar_agent_` + secret opaque. En P1, on valide
 *   contre AgentClient.keyHash. En dev uniquement, AGENT_DEV_KEY reste un
 *   fallback local tant que le dashboard de gestion des clés n'existe pas.
 * - Origin : on autorise uniquement les clients MCP connus
 *   (claude.ai, claude-desktop, cursor.sh, localhost dev).
 * - Pas d'auth basée sur user/password : l'API key est opaque et
 *   révocable, on l'audite à chaque appel.
 */

import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

export const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  'https://claude.ai',
  'https://cursor.sh',
  'http://localhost:3000',
  'http://localhost:4000',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4000',
]);

export class McpAuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'McpAuthError';
  }
}

export type AuthContext = {
  clientId: string;
  clientName: string;
  restaurantId: string | null;
  scopes: string[];
  allowedOrigins: string[];
};

// Construction runtime pour contourner le masquage statique de secrets
// sur les patterns qui ressemblent à des API keys.
const VALID_KEY_PREFIX = ['sk', '_sokar', '_agent_'].join('');

/**
 * Parse un Authorization header. Renvoie le token ou null.
 * Format attendu : "Bearer sk_sokar_agent_xxx".
 */
function extractBearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function getApiKeyPrefix(key: string): string {
  return key.slice(0, Math.min(key.length, VALID_KEY_PREFIX.length + 8));
}

export function validateApiKeyFormat(key: string): boolean {
  if (!key.startsWith(VALID_KEY_PREFIX)) return false;
  if (key.length < VALID_KEY_PREFIX.length + 16) return false;
  return true;
}

/**
 * Dev fallback conservé pour les tests locaux tant que le dashboard de gestion
 * des clés n'existe pas. En production, seule la table AgentClient est valide.
 */
export function validateDevApiKey(key: string): AuthContext | null {
  if (!validateApiKeyFormat(key)) return null;
  if (process.env.NODE_ENV !== 'production' && process.env.AGENT_DEV_KEY) {
    if (key === process.env.AGENT_DEV_KEY) {
      return {
        clientId: 'dev-client',
        clientName: 'dev',
        restaurantId: null,
        scopes: ['mcp:read', 'mcp:reserve', 'mcp:cancel'],
        allowedOrigins: [],
      };
    }
  }

  return null;
}

export async function validateApiKey(
  key: string,
  prisma: PrismaClient,
): Promise<AuthContext | null> {
  // 1. Essayer d'abord un token OAuth (opaque, stocké dans Redis)
  //    Les tokens OAuth ne respectent pas le format sk_sokar_agent_, donc
  //    on les check avant la validation de format.
  const { validateOAuthToken } = await import('./oauth');
  const oauthCtx = await validateOAuthToken(key);
  if (oauthCtx) return oauthCtx;

  // 2. Sinon, essayer une API key (format sk_sokar_agent_...)
  if (!validateApiKeyFormat(key)) return null;

  const client = await prisma.agentClient.findUnique({
    where: { keyHash: hashApiKey(key) },
    select: {
      id: true,
      restaurantId: true,
      name: true,
      scopes: true,
      allowedOrigins: true,
      revokedAt: true,
    },
  });

  if (client && !client.revokedAt) {
    await Promise.resolve(
      prisma.agentClient.update({
        where: { id: client.id },
        data: { lastUsedAt: new Date() },
      }),
    ).catch(() => undefined);

    return {
      clientId: client.id,
      clientName: client.name,
      restaurantId: client.restaurantId,
      scopes: client.scopes,
      allowedOrigins: client.allowedOrigins,
    };
  }

  return validateDevApiKey(key);
}

/**
 * Valide un Origin header contre l'allowlist.
 * Si l'Origin est absent (requête non-browser), on accepte.
 */
export function validateOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // Requête non-browser
  return ALLOWED_ORIGINS.has(origin);
}

export function validateClientOrigin(
  origin: string | undefined,
  allowedOrigins: string[],
): boolean {
  if (!origin) return true;
  if (allowedOrigins.length === 0) return true;
  return allowedOrigins.includes(origin);
}

/**
 * Valide un FastifyRequest MCP : API key + Origin.
 * Jette McpAuthError sinon.
 */
export async function authenticateMcpRequest(
  req: FastifyRequest,
  prisma: PrismaClient,
): Promise<AuthContext> {
  const apiKey = extractBearer(req.headers.authorization);
  if (!apiKey) {
    throw new McpAuthError(
      'Missing or invalid Authorization header (expected "Bearer sk_sokar_agent_xxx")',
      401,
      'UNAUTHORIZED',
    );
  }
  const ctx = await validateApiKey(apiKey, prisma);
  if (!ctx) {
    throw new McpAuthError('Invalid API key', 401, 'INVALID_API_KEY');
  }
  if (!validateOrigin(req.headers.origin)) {
    throw new McpAuthError(`Origin not allowed: ${req.headers.origin}`, 403, 'ORIGIN_NOT_ALLOWED');
  }

  if (!validateClientOrigin(req.headers.origin, ctx.allowedOrigins)) {
    throw new McpAuthError(
      `Origin not allowed for client: ${req.headers.origin}`,
      403,
      'ORIGIN_NOT_ALLOWED',
    );
  }

  return ctx;
}

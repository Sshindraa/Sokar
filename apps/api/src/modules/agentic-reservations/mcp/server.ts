/**
 * MCP server : route HTTP Fastify qui implémente le transport JSON-RPC
 * sur StreamableHTTP pour le MCP générique.
 *
 * Stratégie : on utilise un endpoint POST /mcp stateless. Chaque
 * requête est un message JSON-RPC 2.0. On dispatche sur le toolRegistry.
 *
 * Le SDK officiel (StreamableHTTPServerTransport) gère SSE + streaming.
 * En Phase 3, on supporte uniquement le mode JSON-RPC synchrone (request/
 * response) — le streaming SSE sera ajouté quand on supportera les
 * notifications push.
 *
 * Format de requête (JSON-RPC 2.0):
 *   { "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "...", "arguments": {...} } }
 *
 * Format de réponse:
 *   { "jsonrpc": "2.0", "id": 1, "result": { "content": [...], "isError": false } }
 *   ou { "jsonrpc": "2.0", "id": 1, "error": { "code": -32600, "message": "..." } }
 */

import type { FastifyContextConfig, FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { redisCache } from '../../../shared/redis/client';
import { logger } from '../../../shared/logger/pino';
import { ALLOWED_ORIGINS, McpAuthError, authenticateMcpRequest } from './auth';
import { McpRateLimiter } from './rate-limit';
import { McpToolRegistry, executeTool, type ToolContext } from './tools/registry';
import { TOOL_LIST } from './tools/tool-definitions';
import { getProtectedResourceMetadataUrl } from './oauth';

// Re-export pour les tests qui importent depuis server.ts
export { TOOL_LIST };

/**
 * Version du serveur MCP, indépendante de la version applicative.
 *
 * Politique : majeur quand le contrat exposé change de façon incompatible
 * (outil supprimé, champ retiré, sémantique modifiée), mineur quand on ajoute
 * un outil ou un champ, correctif pour un changement interne. Les clients MCP
 * lisent `serverInfo.version` pour leur télémétrie.
 */
export const MCP_SERVER_VERSION = '2.0.0';
const SUPPORTED_MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;

/**
 * Un client StreamableHTTP doit accepter `application/json` : notre transport
 * ne produit pas de SSE. Un header absent est toléré, les clients non
 * navigateur et les sondes de disponibilité ne l'envoient pas systématiquement.
 */
export function acceptsJsonResponse(acceptHeader: string | undefined): boolean {
  if (!acceptHeader) return true;
  return acceptHeader.split(',').some((entry) => {
    const mediaType = entry.split(';')[0]?.trim().toLowerCase();
    return mediaType === 'application/json' || mediaType === 'application/*' || mediaType === '*/*';
  });
}

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> } & Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

function jsonRpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

export class McpServer {
  private readonly toolRegistry: McpToolRegistry;
  private readonly rateLimiter: McpRateLimiter;

  constructor(private readonly prisma: PrismaClient) {
    this.rateLimiter = new McpRateLimiter(redisCache);
    this.toolRegistry = new McpToolRegistry(prisma, this.rateLimiter);
  }

  registerRoutes(app: FastifyInstance): void {
    const cors = { origin: [...ALLOWED_ORIGINS], credentials: false };
    app.options(
      '/mcp',
      { config: { cors } as FastifyContextConfig & { cors: typeof cors } },
      async (_req, reply) => reply.status(204).send(),
    );
    // GET /mcp : utilisé par les clients MCP StreamableHTTP pour tenter d'ouvrir
    // un stream SSE. On ne supporte pas SSE, donc on retourne 405 sans auth.
    // L'authentification n'est pas requise ici : elle est vérifiée sur POST /mcp.
    app.get(
      '/mcp',
      { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
      async (_req: FastifyRequest, reply: FastifyReply) => {
        return reply
          .status(405)
          .header('Allow', 'POST')
          .send({ error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
      },
    );

    // POST /mcp : endpoint principal JSON-RPC
    app.post(
      '/mcp',
      { config: { cors } as FastifyContextConfig & { cors: typeof cors } },
      async (req: FastifyRequest, reply: FastifyReply) => {
        if (!acceptsJsonResponse(req.headers.accept)) {
          return reply.status(406).send({
            error: 'Not Acceptable: this endpoint only produces application/json',
            code: 'NOT_ACCEPTABLE',
          });
        }

        const protocolVersionHeader = req.headers['mcp-protocol-version'];
        const hasSupportedProtocolVersion =
          typeof protocolVersionHeader === 'string' &&
          SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(
            protocolVersionHeader as (typeof SUPPORTED_MCP_PROTOCOL_VERSIONS)[number],
          );
        if (protocolVersionHeader !== undefined && !hasSupportedProtocolVersion) {
          return reply
            .status(400)
            .send(
              jsonRpcError(
                null,
                -32000,
                `Bad Request: unsupported MCP-Protocol-Version ${String(protocolVersionHeader)}`,
              ),
            );
        }

        let authCtx: ToolContext;
        try {
          const auth = await authenticateMcpRequest(req, this.prisma);
          authCtx = {
            clientId: auth.clientId,
            clientName: auth.clientName,
            restaurantId: auth.restaurantId,
            scopes: auth.scopes,
            actor: `agent:${auth.clientId}`,
            credentialType: auth.credentialType,
            transport: 'mcp',
            trustedRestaurantAccess:
              auth.credentialType === 'api_key' && auth.restaurantId !== null,
          };
        } catch (err) {
          if (err instanceof McpAuthError) {
            reply.status(err.statusCode);
            if (err.statusCode === 401) {
              reply.header(
                'WWW-Authenticate',
                `Bearer realm="sokar", resource_metadata="${getProtectedResourceMetadataUrl()}"`,
              );
            }
            if (err.statusCode === 429) reply.header('Retry-After', '60');
            return reply.send({ error: err.message, code: err.code });
          }
          throw err;
        }

        // Enforce one shared per-client budget before parsing or executing tools.
        const limit = await this.rateLimiter.check(authCtx.clientId, 'global');
        reply.header('X-RateLimit-Limit', '60');
        reply.header('X-RateLimit-Remaining', String(limit.remaining));
        if (!limit.allowed) {
          return reply
            .status(429)
            .header('Retry-After', String(Math.max(1, Math.ceil(limit.resetMs / 1000))))
            .send({ error: 'Rate limit exceeded', code: 'RATE_LIMITED' });
        }

        const body = req.body as JsonRpcRequest | JsonRpcRequest[] | undefined;
        if (!body) {
          return reply.status(400).send(jsonRpcError(null, -32700, 'Parse error: empty body'));
        }

        if (Array.isArray(body)) {
          return reply
            .status(400)
            .send(jsonRpcError(null, -32600, 'Batch requests are not supported'));
        }
        const response = await this.handleMessage(body, authCtx);
        if (response === null) {
          return reply.status(202).send();
        }
        return reply.send(response);
      },
    );
  }

  private async handleMessage(
    msg: JsonRpcRequest,
    ctx: ToolContext,
  ): Promise<JsonRpcResponse | null> {
    const id = msg.id ?? null;

    if (msg.jsonrpc !== '2.0') {
      return jsonRpcError(id, -32600, 'Invalid Request: jsonrpc must be "2.0"');
    }
    if (!msg.method) {
      return jsonRpcError(id, -32600, 'Invalid Request: method required');
    }
    // JSON-RPC notifications have no id and must never receive a response.
    if (msg.id === undefined) return null;

    try {
      switch (msg.method) {
        case 'initialize': {
          const requestedVersion =
            typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : null;
          const protocolVersion =
            requestedVersion && SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(requestedVersion as never)
              ? requestedVersion
              : SUPPORTED_MCP_PROTOCOL_VERSIONS[0];
          return jsonRpcResult(id, {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'sokar-mcp', version: MCP_SERVER_VERSION },
            instructions:
              'Search MCP-enabled restaurants, check availability, and ask for customer consent before booking. Use create_hold to keep a slot while confirming. To read, modify, or cancel a public booking, supply the original E.164 customerPhone.',
          });
        }

        case 'ping':
          return jsonRpcResult(id, {});

        case 'tools/list':
          return jsonRpcResult(id, {
            // Keep scoped tools discoverable so clients can explain the
            // required permission and trigger reauthorization on a call.
            // executeTool still enforces scopes before any operation runs.
            tools: TOOL_LIST,
          });

        case 'tools/call': {
          const params = msg.params ?? {};
          const toolName = params.name;
          const args = params.arguments ?? {};
          if (!toolName || typeof toolName !== 'string') {
            return jsonRpcError(id, -32602, 'Invalid params: name required');
          }
          const result = await executeTool(this.toolRegistry, toolName, args, ctx);
          if (result.ok) {
            return jsonRpcResult(id, {
              content: [{ type: 'text', text: JSON.stringify(result.data) }],
              structuredContent: result.data,
              isError: false,
            });
          }
          const missingScope =
            result.code === 'FORBIDDEN'
              ? /^Missing scope: (mcp:(?:read|reserve|cancel))$/u.exec(result.error)?.[1]
              : undefined;
          return jsonRpcResult(id, {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            isError: true,
            ...(missingScope
              ? {
                  _meta: {
                    'mcp/www_authenticate': [
                      `Bearer resource_metadata="${getProtectedResourceMetadataUrl()}", error="insufficient_scope", scope="${missingScope}", error_description="Additional permission is required to use this tool."`,
                    ],
                  },
                }
              : {}),
          });
        }

        default:
          return jsonRpcError(id, -32601, `Method not found: ${msg.method}`);
      }
    } catch (err: unknown) {
      logger.error({ err, method: msg.method, clientId: ctx.clientId }, 'mcp handle error');
      return jsonRpcError(id, -32603, 'Internal error');
    }
  }
}

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  const { db } = await import('../../../shared/db/client');
  const server = new McpServer(db);
  server.registerRoutes(app);
}

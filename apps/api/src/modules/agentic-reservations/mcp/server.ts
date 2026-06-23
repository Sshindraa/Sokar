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

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { redisCache } from '../../../shared/redis/client';
import { logger } from '../../../shared/logger/pino';
import { McpAuthError, authenticateMcpRequest } from './auth';
import { McpRateLimiter } from './rate-limit';
import { McpToolRegistry, executeTool, type ToolContext } from './tools/registry';
import { TOOL_LIST } from './tools/tool-definitions';
import { getIssuer } from './oauth';

// Re-export pour les tests qui importent depuis server.ts
export { TOOL_LIST };

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: any;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
};

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: any,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

function jsonRpcResult(id: string | number | null, result: any): JsonRpcResponse {
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
    // GET /mcp : utilisé par les clients MCP pour discovery (SSE init).
    // Sans auth → 401 avec WWW-Authenticate pour pointer vers OAuth metadata.
    // Avec auth → 405 car on ne supporte pas encore le streaming SSE.
    app.get('/mcp', async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        await authenticateMcpRequest(req, this.prisma);
        return reply.status(405).send({ error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
      } catch (err) {
        if (err instanceof McpAuthError) {
          return reply
            .status(401)
            .header(
              'WWW-Authenticate',
              `Bearer resource_metadata="${getIssuer()}/.well-known/oauth-authorization-server"`,
            )
            .send({ error: err.message, code: err.code });
        }
        throw err;
      }
    });

    // POST /mcp : endpoint principal JSON-RPC
    app.post('/mcp', async (req: FastifyRequest, reply: FastifyReply) => {
      let authCtx: ToolContext;
      try {
        const auth = await authenticateMcpRequest(req, this.prisma);
        authCtx = {
          clientId: auth.clientId,
          clientName: auth.clientName,
          restaurantId: auth.restaurantId,
          scopes: auth.scopes,
          actor: `agent:${auth.clientId}`,
        };
      } catch (err) {
        if (err instanceof McpAuthError) {
          return reply
            .status(err.statusCode)
            .header(
              'WWW-Authenticate',
              `Bearer resource_metadata="${getIssuer()}/.well-known/oauth-authorization-server"`,
            )
            .send({ error: err.message, code: err.code });
        }
        throw err;
      }

      const body = req.body as JsonRpcRequest | JsonRpcRequest[] | undefined;
      if (!body) {
        return reply.status(400).send(jsonRpcError(null, -32700, 'Parse error: empty body'));
      }

      const isBatch = Array.isArray(body);
      const messages = isBatch ? body : [body];

      const responses: (JsonRpcResponse | null)[] = [];
      for (const msg of messages) {
        responses.push(await this.handleMessage(msg, authCtx));
      }

      // Filtrer les null (notifications sans response)
      const filtered = responses.filter((r): r is JsonRpcResponse => r !== null);

      // Si toutes les réponses sont des notifications (pas de response),
      // retourner 202 Accepted sans body
      if (filtered.length === 0) {
        return reply.status(202).send();
      }

      const payload = isBatch ? filtered : filtered[0];

      // Rate limit headers (best-effort, non-blocking)
      try {
        const rl = await this.rateLimiter.check(authCtx.clientId, 'global');
        reply.header('X-RateLimit-Limit', '60');
        reply.header('X-RateLimit-Remaining', String(rl.remaining));
        if (!rl.allowed) {
          reply.header('Retry-After', String(Math.ceil(rl.resetMs / 1000)));
        }
      } catch {
        // Rate limiter down — fail-open, pas de headers
      }

      return reply.send(payload);
    });
  }

  private async handleMessage(msg: JsonRpcRequest, ctx: ToolContext): Promise<JsonRpcResponse> {
    const id = msg.id ?? null;

    if (msg.jsonrpc !== '2.0') {
      return jsonRpcError(id, -32600, 'Invalid Request: jsonrpc must be "2.0"');
    }
    if (!msg.method) {
      return jsonRpcError(id, -32600, 'Invalid Request: method required');
    }

    try {
      switch (msg.method) {
        case 'initialize':
          return jsonRpcResult(id, {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'sokar-mcp', version: '0.1.0' },
          });

        case 'notifications/initialized':
          // Notification client → serveur (pas de response en JSON-RPC).
          // Retourner un object vide avec id=null serait une réponse,
          // ce qui violerait la spec. On renvoie null pour que le caller
          // sache qu'il ne doit pas l'inclure dans le batch response.
          return null as any;

        case 'ping':
          return jsonRpcResult(id, {});

        case 'tools/list':
          return jsonRpcResult(id, { tools: TOOL_LIST });

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
              isError: false,
            });
          }
          return jsonRpcResult(id, {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            isError: true,
          });
        }

        default:
          return jsonRpcError(id, -32601, `Method not found: ${msg.method}`);
      }
    } catch (err: any) {
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

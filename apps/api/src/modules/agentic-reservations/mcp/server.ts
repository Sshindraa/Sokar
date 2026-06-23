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
import { getIssuer } from './oauth';

const TOOL_LIST = [
  {
    name: 'search_restaurants',
    title: 'Search Restaurants',
    description:
      'Search restaurants available for a given party size, time, and city. Returns matching restaurants with basic info.',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string' },
        partySize: { type: 'integer', minimum: 1, maximum: 50 },
        slotStart: { type: 'string', format: 'date-time' },
        slotEnd: { type: 'string', format: 'date-time' },
        cuisineType: { type: 'array', items: { type: 'string' } },
        maxResults: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
      },
      required: ['city', 'partySize', 'slotStart', 'slotEnd'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_restaurant_details',
    title: 'Get Restaurant Details',
    description:
      'Get details of a specific restaurant by ID, including name, address, phone, cuisine, and opening hours.',
    inputSchema: {
      type: 'object',
      properties: { restaurantId: { type: 'string', format: 'uuid' } },
      required: ['restaurantId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'check_availability',
    title: 'Check Availability',
    description:
      'Check if a specific restaurant has availability for a party size and time slot. Returns available time slots.',
    inputSchema: {
      type: 'object',
      properties: {
        restaurantId: { type: 'string', format: 'uuid' },
        partySize: { type: 'integer', minimum: 1, maximum: 50 },
        slotStart: { type: 'string', format: 'date-time' },
        slotEnd: { type: 'string', format: 'date-time' },
      },
      required: ['restaurantId', 'partySize', 'slotStart', 'slotEnd'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_reservation',
    title: 'Create Reservation',
    description:
      'Create a reservation at a restaurant. Requires explicit user consent for data processing. Returns reservation confirmation with ID.',
    inputSchema: {
      type: 'object',
      properties: {
        restaurantId: { type: 'string', format: 'uuid' },
        partySize: { type: 'integer', minimum: 1, maximum: 50 },
        startsAt: { type: 'string', format: 'date-time' },
        endsAt: { type: 'string', format: 'date-time' },
        customerName: { type: 'string' },
        customerPhone: { type: 'string', description: 'E.164 format' },
        specialRequests: { type: 'string' },
        holdToken: { type: 'string' },
        idempotencyKey: { type: 'string' },
        consents: {
          type: 'object',
          properties: {
            reservationProcessing: { type: 'boolean' },
            transactionalSms: { type: 'boolean' },
            transactionalEmail: { type: 'boolean' },
            marketingOptIn: { type: 'boolean' },
          },
          required: ['reservationProcessing'],
        },
      },
      required: [
        'restaurantId',
        'partySize',
        'startsAt',
        'endsAt',
        'customerName',
        'customerPhone',
        'idempotencyKey',
        'consents',
      ],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: 'cancel_reservation',
    title: 'Cancel Reservation',
    description:
      'Cancel an existing reservation by ID. The reservation status changes to cancelled and the customer is notified.',
    inputSchema: {
      type: 'object',
      properties: {
        reservationId: { type: 'string', format: 'uuid' },
        reason: { type: 'string' },
      },
      required: ['reservationId'],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: 'get_reservation_status',
    title: 'Get Reservation Status',
    description:
      'Get the status of an existing reservation by ID, including party size, date, and current state.',
    inputSchema: {
      type: 'object',
      properties: {
        reservationId: { type: 'string', format: 'uuid' },
      },
      required: ['reservationId'],
    },
    annotations: { readOnlyHint: true },
  },
];

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

      const responses: JsonRpcResponse[] = [];
      for (const msg of messages) {
        responses.push(await this.handleMessage(msg, authCtx));
      }

      const payload = isBatch ? responses : responses[0];
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
          // Notification client → serveur, on ne répond pas
          return jsonRpcResult(id, {});

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

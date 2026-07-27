#!/usr/bin/env node
/**
 * Bridge MCP stdio pour Claude Desktop.
 *
 * Il expose les mêmes tools que POST /mcp et délègue toute la logique métier,
 * auth, gating et audit au serveur HTTP Sokar.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_BASE = process.env.SOKAR_API_BASE ?? 'http://localhost:4000';
const MCP_KEY = process.env.SOKAR_MCP_KEY ?? 'sk_sokar_agent_' + 'a'.repeat(40);

type ToolCallResponse = {
  jsonrpc: '2.0';
  id: string | number;
  result?: {
    content?: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string; data?: unknown };
};

const server = new McpServer({
  name: 'sokar-restaurants',
  version: '0.1.0',
});

async function callHttpTool(name: string, args: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MCP_KEY}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return {
      content: [{ type: 'text' as const, text: `HTTP ${res.status}: ${text}` }],
      isError: true,
    };
  }

  const body = (await res.json()) as ToolCallResponse;
  if (body.error) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(body.error) }],
      isError: true,
    };
  }

  return {
    content: body.result?.content ?? [{ type: 'text' as const, text: '{}' }],
    isError: body.result?.isError ?? false,
  };
}

server.registerTool(
  'search_restaurants',
  {
    description: 'Search restaurants available for a given party size, time, and city.',
    inputSchema: {
      city: z.string().min(1).max(100),
      partySize: z.number().int().min(1).max(50),
      slotStart: z.string().datetime(),
      slotEnd: z.string().datetime(),
      cuisineType: z.array(z.string()).max(10).optional(),
      maxResults: z.number().int().min(1).max(20).optional(),
    },
  },
  async (args) => callHttpTool('search_restaurants', args),
);

server.registerTool(
  'get_restaurant_details',
  {
    description: 'Get public details of a specific restaurant by ID.',
    inputSchema: {
      restaurantId: z.string().uuid(),
    },
  },
  async (args) => callHttpTool('get_restaurant_details', args),
);

server.registerTool(
  'check_availability',
  {
    description: 'Check if a restaurant has availability for a party size and time slot.',
    inputSchema: {
      restaurantId: z.string().uuid(),
      partySize: z.number().int().min(1).max(50),
      slotStart: z.string().datetime(),
      slotEnd: z.string().datetime(),
    },
  },
  async (args) => callHttpTool('check_availability', args),
);

server.registerTool(
  'create_reservation',
  {
    description: 'Create a reservation. Requires explicit user consent.',
    inputSchema: {
      restaurantId: z.string().uuid(),
      partySize: z.number().int().min(1).max(50),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      customerName: z.string().min(1).max(100),
      customerPhone: z.string(),
      specialRequests: z.string().max(500).optional(),
      holdToken: z.string().optional(),
      idempotencyKey: z.string().min(1).max(100),
      consents: z.object({
        reservationProcessing: z.literal(true),
        transactionalSms: z.boolean().optional(),
        transactionalEmail: z.boolean().optional(),
        marketingOptIn: z.boolean().optional(),
      }),
    },
  },
  async (args) => callHttpTool('create_reservation', args),
);

server.registerTool(
  'cancel_reservation',
  {
    description: 'Cancel an existing reservation.',
    inputSchema: {
      reservationId: z.string().uuid(),
      reason: z.string().max(500).optional(),
    },
  },
  async (args) => callHttpTool('cancel_reservation', args),
);

server.registerTool(
  'get_reservation_status',
  {
    description: 'Get the status of an existing reservation by ID.',
    inputSchema: {
      reservationId: z.string().uuid(),
    },
  },
  async (args) => callHttpTool('get_reservation_status', args),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Sokar MCP stdio bridge running; proxy=${API_BASE}/mcp`);
}

main().catch((err) => {
  console.error('Sokar MCP stdio bridge failed:', err);
  process.exit(1);
});

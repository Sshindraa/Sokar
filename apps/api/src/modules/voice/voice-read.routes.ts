import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { redactPii } from './stream/pii-redact';

const LatestCallQuerySchema = z.object({
  restaurantId: z.string().trim().min(1).max(128),
});

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function readSuppliedToken(request: FastifyRequest): string | undefined {
  const header = request.headers['x-sokar-voice-read-token'];
  const supplied = Array.isArray(header) ? header[0] : header;
  if (supplied) return supplied;
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice('Bearer '.length).trim();
  return undefined;
}

async function requireVoiceReadToken(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void | FastifyReply> {
  const expected = process.env.SOKAR_VOICE_READ_TOKEN?.trim();
  if (!expected) {
    return reply.status(503).send({ error: 'VOICE_READ_TOKEN_NOT_CONFIGURED' });
  }
  const supplied = readSuppliedToken(request);
  // Hashing both sides gives equal-length buffers, so the comparison stays constant-time.
  if (!supplied || !timingSafeEqual(sha256(expected), sha256(supplied))) {
    return reply.status(401).send({ error: 'VOICE_READ_UNAUTHORIZED' });
  }
}

function redactNullable(text: string | null): string | null {
  return text === null ? null : redactPii(text);
}

/** Internal read-only feed of the latest call and its per-turn telemetry. Never writes. */
export async function voiceReadRoutes(app: FastifyInstance) {
  app.get(
    '/api/internal/voice/calls/latest',
    { preHandler: requireVoiceReadToken },
    async (request, reply) => {
      const { restaurantId } = LatestCallQuerySchema.parse(request.query);
      // Explicit select: callerPhone and recording storage fields are never read.
      const [call] = await db.call.findMany({
        where: { restaurantId },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          restaurantId: true,
          durationSec: true,
          transcript: true,
          intent: true,
          outcome: true,
          sttProvider: true,
          llmProvider: true,
          ttsProvider: true,
          carrier: true,
          recordingStatus: true,
          recordingError: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!call) return reply.status(404).send({ error: 'VOICE_CALL_NOT_FOUND' });

      const turns = await db.voiceTurnTelemetry.findMany({
        where: { callId: call.id },
        orderBy: { sequence: 'asc' },
      });

      return reply.send({
        call: {
          ...call,
          transcript: redactNullable(call.transcript),
          recordingError: redactNullable(call.recordingError),
          createdAt: call.createdAt.toISOString(),
          updatedAt: call.updatedAt.toISOString(),
        },
        turns: turns.map((turn) => ({
          ...turn,
          path: redactPii(turn.path),
          startedAt: turn.startedAt.toISOString(),
          endedAt: turn.endedAt?.toISOString() ?? null,
          createdAt: turn.createdAt.toISOString(),
          updatedAt: turn.updatedAt.toISOString(),
        })),
      });
    },
  );
}

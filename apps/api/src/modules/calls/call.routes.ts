import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { requireOrg } from '../../plugins/clerk';
import { Readable } from 'node:stream';
import { deletePrivateRecording, getPrivateRecording } from '../voice/call-recording.service';

const CallQuerySchema = z.object({
  // restaurantId is injected by requireOrg() from the Clerk orgId — never trust
  // a client-supplied value here. Scope the Prisma queries with req.restaurantId.
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function publicCall<T extends Record<string, unknown>>(call: T) {
  const {
    recordingStorageKey: _storageKey,
    recordingProviderId: _providerId,
    recordingError: _error,
    ...safe
  } = call;
  return safe;
}

export async function callRoutes(app: FastifyInstance) {
  app.get('/calls', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = req.restaurantId;
    const query = CallQuerySchema.parse(req.query);
    const { limit, offset } = query;

    const [calls, total] = await Promise.all([
      db.call.findMany({
        where: { restaurantId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.call.count({ where: { restaurantId } }),
    ]);

    return reply.send({
      data: calls.map((call) => publicCall(call as unknown as Record<string, unknown>)),
      total,
      limit,
      offset,
    });
  });

  app.get('/calls/:id', { preHandler: requireOrg() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const restaurantId = req.restaurantId;

    const call = await db.call.findUnique({
      where: { id, restaurantId },
      include: { latencyTrace: true },
    });

    if (!call) {
      return reply.status(404).send({ error: 'Call not found' });
    }

    return reply.send(publicCall(call as unknown as Record<string, unknown>));
  });

  app.get('/calls/:id/recording', { preHandler: requireOrg() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const restaurantId = req.restaurantId;
    const call = await db.call.findUnique({
      where: { id, restaurantId },
      select: {
        recordingStatus: true,
        recordingStorageKey: true,
        recordingContentType: true,
        recordingSizeBytes: true,
        recordingExpiresAt: true,
      },
    });

    if (!call) return reply.status(404).send({ error: 'Call not found' });
    if (
      call.recordingStatus !== 'AVAILABLE' ||
      !call.recordingStorageKey ||
      !call.recordingSizeBytes
    ) {
      return reply.status(404).send({ error: 'Recording not available' });
    }
    if (call.recordingExpiresAt && call.recordingExpiresAt <= new Date()) {
      return reply.status(410).send({ error: 'Recording expired' });
    }

    const requestedRange = req.headers.range;
    let range: string | undefined;
    if (requestedRange) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(requestedRange);
      if (!match) return reply.status(416).send({ error: 'Invalid byte range' });
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), call.recordingSizeBytes - 1) : undefined;
      if (start >= call.recordingSizeBytes || (end !== undefined && end < start)) {
        return reply.status(416).send({ error: 'Invalid byte range' });
      }
      range = `bytes=${start}-${end ?? ''}`;
    }

    const object = await getPrivateRecording(call.recordingStorageKey, range);
    if (!object.Body) return reply.status(502).send({ error: 'Recording storage unavailable' });

    reply.header('Content-Type', call.recordingContentType ?? 'audio/mpeg');
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Accept-Ranges', 'bytes');
    if (object.ContentLength !== undefined) reply.header('Content-Length', object.ContentLength);
    if (object.ContentRange) reply.header('Content-Range', object.ContentRange);
    if (range) reply.status(206);

    return reply.send(object.Body as Readable);
  });

  app.delete('/calls/:id', { preHandler: requireOrg() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const restaurantId = req.restaurantId;
    const call = await db.call.findUnique({
      where: { id, restaurantId },
      select: { recordingStorageKey: true },
    });
    if (!call) return reply.status(404).send({ error: 'Call not found' });
    if (call.recordingStorageKey) await deletePrivateRecording(call.recordingStorageKey);
    await db.call.delete({ where: { id, restaurantId } });
    return reply.status(204).send();
  });
}

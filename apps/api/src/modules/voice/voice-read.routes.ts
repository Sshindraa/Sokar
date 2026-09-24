/**
 * Lecture interne des appels vocaux, pour analyser les appels de test.
 *
 * Protégée par le jeton SOKAR_VOICE_READ_TOKEN (en-tête Authorization: Bearer).
 * Ne modifie rien. Renvoie les mesures de chaque tour et, pour les seuls
 * restaurants de VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS, le dialogue du tour.
 * Jamais le numéro de l'appelant, le transcript brut ni les champs
 * d'enregistrement.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { isVoiceDebugDialogueEnabled } from './stream/debug-dialogue';

const RestaurantQuerySchema = z.object({
  restaurantId: z.string().trim().min(1).max(128),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const CallParamsSchema = z.object({ callId: z.string().trim().min(1).max(128) });

const CALL_SELECT = {
  id: true,
  restaurantId: true,
  createdAt: true,
  durationSec: true,
  intent: true,
  outcome: true,
  sttProvider: true,
  llmProvider: true,
  ttsProvider: true,
} as const;

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

async function requireVoiceReadToken(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void | FastifyReply> {
  const expected = process.env.SOKAR_VOICE_READ_TOKEN?.trim();
  if (!expected) return reply.status(503).send({ error: 'VOICE_READ_TOKEN_NOT_CONFIGURED' });
  const authorization = request.headers.authorization;
  const supplied = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';
  // Les deux empreintes ont la même longueur : comparaison à temps constant.
  if (!supplied || !timingSafeEqual(sha256(expected), sha256(supplied))) {
    return reply.status(401).send({ error: 'VOICE_READ_UNAUTHORIZED' });
  }
}

type CallRow = {
  id: string;
  restaurantId: string;
  createdAt: Date;
  durationSec: number | null;
  intent: string | null;
  outcome: string | null;
  sttProvider: string | null;
  llmProvider: string | null;
  ttsProvider: string | null;
};

async function buildCallDetail(call: CallRow) {
  const dialogueEnabled = isVoiceDebugDialogueEnabled(call.restaurantId);
  const [turns, dialogues] = await Promise.all([
    db.voiceTurnTelemetry.findMany({
      where: { callId: call.id },
      orderBy: { sequence: 'asc' },
    }),
    dialogueEnabled
      ? db.voiceDebugTurn.findMany({
          where: { callId: call.id, restaurantId: call.restaurantId },
        })
      : Promise.resolve([]),
  ]);
  const dialogueByTurn = new Map(dialogues.map((dialogue) => [dialogue.turnId, dialogue]));

  return {
    call: { ...call, createdAt: call.createdAt.toISOString() },
    dialogueAvailable: dialogueEnabled && dialogues.length > 0,
    turns: turns.map((turn) => {
      const dialogue = dialogueByTurn.get(turn.turnId);
      return {
        sequence: turn.sequence,
        turnId: turn.turnId,
        path: turn.path,
        speechAct: dialogue?.speechAct ?? null,
        callerText: dialogue?.callerText ?? null,
        agentText: dialogue?.agentText ?? null,
        fillerText: dialogue?.fillerText ?? null,
        tools: dialogue?.tools ?? [],
        speechDurationMs: turn.speechDurationMs,
        speechToSttFinalMs: turn.speechToSttFinalMs,
        llmFirstTokenMs: turn.llmFirstTokenMs,
        llmFirstPhraseMs: turn.llmFirstPhraseMs,
        llmDurationMs: turn.llmDurationMs,
        availabilityDurationMs: turn.availabilityDurationMs,
        ttsFirstByteMs: turn.ttsFirstByteMs,
        sttFinalToAudioMs: turn.sttFinalToAudioMs,
        totalE2eMs: turn.totalE2eMs,
        interrupted: turn.interrupted,
        loopDetected: turn.loopDetected,
        completed: turn.completed,
        startedAt: turn.startedAt.toISOString(),
      };
    }),
  };
}

export async function voiceReadRoutes(app: FastifyInstance) {
  // Liste des derniers appels d'un restaurant.
  app.get('/api/internal/voice/calls', { preHandler: requireVoiceReadToken }, async (request) => {
    const { restaurantId, limit } = RestaurantQuerySchema.parse(request.query);
    // tenant-scoping: restaurantId explicite, accès interne par jeton.
    const calls = await db.call.findMany({
      where: { restaurantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: CALL_SELECT,
    });
    return { calls: calls.map((call) => ({ ...call, createdAt: call.createdAt.toISOString() })) };
  });

  // Dernier appel d'un restaurant, tour par tour.
  app.get(
    '/api/internal/voice/calls/latest',
    { preHandler: requireVoiceReadToken },
    async (request, reply) => {
      const { restaurantId } = RestaurantQuerySchema.parse(request.query);
      const [call] = await db.call.findMany({
        where: { restaurantId },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: CALL_SELECT,
      });
      if (!call) return reply.status(404).send({ error: 'VOICE_CALL_NOT_FOUND' });
      return buildCallDetail(call);
    },
  );

  // Un appel précis, tour par tour.
  app.get(
    '/api/internal/voice/calls/:callId',
    { preHandler: requireVoiceReadToken },
    async (request, reply) => {
      const { callId } = CallParamsSchema.parse(request.params);
      // tenant-scoping: global — lecture interne par jeton, tous restaurants, sans donnée client.
      const call = await db.call.findUnique({ where: { id: callId }, select: CALL_SELECT });
      if (!call) return reply.status(404).send({ error: 'VOICE_CALL_NOT_FOUND' });
      return buildCallDetail(call);
    },
  );
}

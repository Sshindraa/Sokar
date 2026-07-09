/**
 * Persistance des sessions d'appel en base de données.
 *
 * Extrait de handler.ts — fonctions pures qui prennent une CallSession
 * et écrivent/lisent en DB via Prisma.
 */

import type { CallSession } from './types';
import { logger } from '../../../shared/logger/pino';
import { captureException } from '../../../shared/sentry/client';
import { writeDebugLog } from './debug-log';

/** Crée ou met à jour un enregistrement Call en base pour un appel Flux */
export async function persistFluxCall(session: CallSession): Promise<void> {
  try {
    const { db } = await import('../../../shared/db/client');
    const durationSec = session.createdAt ? Math.round((Date.now() - session.createdAt) / 1000) : 0;

    await db.call.upsert({
      where: { callSid: session.callLegId },
      update: {
        durationSec,
        transcript: session.transcript || null,
        carrier: 'telnyx',
      },
      create: {
        callSid: session.callLegId,
        restaurantId: session.restaurantId,
        durationSec,
        transcript: session.transcript || null,
        carrier: 'telnyx',
      },
    });
  } catch (err) {
    logger.error({ err, callId: session.callLegId }, '[flux] Failed to persist call');
    captureException(err, {
      tags: { service: 'handler', action: 'persistFluxCall' },
      extra: { callId: session.callLegId },
    });
  }
}

/** Enregistre la trace de latence en base pour l'appel */
export async function persistLatencyTrace(session: CallSession): Promise<void> {
  const trace = session.latencyTrace;
  if (!trace) return;
  try {
    const { db } = await import('../../../shared/db/client');
    const callRecord = await db.call.findUnique({
      where: { callSid: session.callLegId },
    });
    if (!callRecord) {
      writeDebugLog(
        `[latency] No call record found for leg ${session.callLegId} to attach latency trace`,
      );
      return;
    }

    await db.latencyTrace.upsert({
      where: { callId: callRecord.id },
      update: {
        vadEndMs: 0,
        sttFinalMs: trace.sttFinalMs ?? 0,
        llmFirstToken: trace.llmFirstTokenMs ?? null,
        ttsFirstByte: trace.ttsFirstByteMs ?? null,
        audioPlayingMs: trace.totalE2eMs ?? null,
        totalE2eMs: trace.totalE2eMs ?? null,
      },
      create: {
        callId: callRecord.id,
        vadEndMs: 0,
        sttFinalMs: trace.sttFinalMs ?? 0,
        llmFirstToken: trace.llmFirstTokenMs ?? null,
        ttsFirstByte: trace.ttsFirstByteMs ?? null,
        audioPlayingMs: trace.totalE2eMs ?? null,
        totalE2eMs: trace.totalE2eMs ?? null,
      },
    });
    writeDebugLog(
      `[latency] Saved latency trace for call ${callRecord.id}: E2E ${trace.totalE2eMs}ms`,
    );
  } catch (err: unknown) {
    writeDebugLog(`[latency] Failed to persist latency trace`, err);
    logger.error({ err, callId: session.callLegId }, '[latency] Failed to persist latency trace');
    captureException(err, {
      tags: { service: 'handler', action: 'persistLatencyTrace' },
      extra: { callId: session.callLegId },
    });
  }
}

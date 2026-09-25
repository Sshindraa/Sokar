/**
 * Persistance des sessions d'appel en base de données.
 *
 * Extrait de handler.ts — fonctions pures qui prennent une CallSession
 * et écrivent/lisent en DB via Prisma.
 */

import type { CallSession, VoiceTurnLatencyTrace, VoiceTurnTelemetry } from './types';
import { snapshotVoiceTurnTelemetry } from './turn-telemetry';
import { CARTESIA_MODEL } from '@sokar/config';
import { getVoiceLlmModel, getVoiceLlmProvider } from '../llm-provider';
import { logger } from '../../../shared/logger/pino';
import { captureException } from '../../../shared/sentry/client';
import { writeDebugLog } from './debug-log';
import { VOICE_DEBUG_DIALOGUE_RETENTION_DAYS, formatDebugSpeech } from './debug-dialogue';
import { MS_TO_SECONDS } from '../../../shared/constants/time.js';

/** Crée ou met à jour un enregistrement Call en base pour un appel Scribe */
export async function persistSttCall(session: CallSession): Promise<void> {
  try {
    const { db } = await import('../../../shared/db/client');
    const durationSec = session.createdAt
      ? Math.round((Date.now() - session.createdAt) / MS_TO_SECONDS)
      : 0;
    // Un transcript vide ne doit jamais effacer une transcription déjà
    // enregistrée par un autre chemin (webhook de fin, rattrapage worker).
    const transcript = session.transcript?.trim() ? session.transcript : null;

    await db.call.upsert({
      where: { callSid: session.callLegId },
      update: {
        durationSec,
        ...(transcript ? { transcript } : {}),
        carrier: 'telnyx',
      },
      create: {
        callSid: session.callLegId,
        restaurantId: session.restaurantId,
        durationSec,
        transcript,
        carrier: 'telnyx',
      },
    });
  } catch (err) {
    logger.error({ err, callId: session.callLegId }, '[stt] Failed to persist call');
    captureException(err, {
      tags: { service: 'handler', action: 'persistSttCall' },
      extra: { callId: session.callLegId },
    });
  }
}

/** Enregistre la trace de latence en base pour l'appel */
export function persistLatencyTrace(session: CallSession): Promise<void> {
  const previous = session.voiceTelemetryPersistence ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => persistLatencyTraceNow(session))
    .catch((err: unknown) => {
      logger.error({ err, callId: session.callLegId }, '[latency] telemetry snapshot failed');
    });
  session.voiceTelemetryPersistence = next;
  next.then(
    () => {
      if (session.voiceTelemetryPersistence === next) session.voiceTelemetryPersistence = undefined;
    },
    () => {
      if (session.voiceTelemetryPersistence === next) session.voiceTelemetryPersistence = undefined;
    },
  );
  return next;
}

async function persistLatencyTraceNow(session: CallSession): Promise<void> {
  const trace = session.latencyTrace;
  const turns = snapshotVoiceTurnTelemetry(session);
  if (!trace && turns.length === 0) return;
  try {
    const { db } = await import('../../../shared/db/client');
    const callRecord = await db.call.findUnique({
      where: { callSid: session.callLegId },
      include: {
        reservation: { select: { id: true } },
      },
    });
    if (!callRecord) {
      writeDebugLog(
        `[latency] No call record found for leg ${session.callLegId} to attach latency trace`,
      );
      return;
    }

    const callProviders = {
      sttProvider: callRecord.sttProvider ?? session.sttModel ?? 'elevenlabs-scribe-v2-realtime',
      // Le stream courant est toujours routé par le provider canonique. Ne
      // recopions pas une valeur éventuellement fournie par un ancien webhook
      // dans la télémétrie de cette session.
      llmProvider: getVoiceLlmProvider(),
      llmModel: getVoiceLlmModel(),
      ttsProvider: callRecord.ttsProvider ?? `cartesia-${CARTESIA_MODEL}`,
    };

    const persistedTurns =
      session.voiceTelemetryPersistedTurns ?? (session.voiceTelemetryPersistedTurns = {});
    for (const turn of turns) {
      const data = buildVoiceTurnTelemetryData(turn, callRecord.id, callProviders);
      const revision = voiceTurnRevision(turn, data);
      if (persistedTurns[turn.id] === revision) continue;
      await db.voiceTurnTelemetry.upsert({
        where: {
          callId_turnId: {
            callId: callRecord.id,
            turnId: turn.id,
          },
        },
        update: data,
        create: data,
      });
      if (turn.debugDialogue) {
        const debug = buildVoiceDebugTurnData(turn, callRecord.id, session.restaurantId);
        // tenant-scoping: global — ligne ciblée par la clé de l'appel de cette session ;
        // restaurantId de la session écrit dans les données.
        await db.voiceDebugTurn.upsert({
          where: { callId_turnId: { callId: callRecord.id, turnId: turn.id } },
          update: debug,
          create: debug,
        });
      }
      persistedTurns[turn.id] = revision;
    }

    const rollup = buildVoiceCallTelemetryRollup(
      turns,
      {
        finalized: session.ended,
        reservationConfirmed: Boolean(callRecord.reservation) || callRecord.outcome === 'RESERVED',
        reservationIntentAbandoned:
          session.ended &&
          callRecord.intent === 'RESERVATION' &&
          callRecord.outcome !== 'RESERVED' &&
          callRecord.outcome !== 'HANDOFF' &&
          callRecord.outcome !== 'MESSAGE',
      },
      callProviders,
    );
    await db.voiceCallTelemetry.upsert({
      where: { callId: callRecord.id },
      update: rollup,
      create: { callId: callRecord.id, ...rollup },
    });

    if (trace) {
      const legacy = buildLegacyLatencyTrace(turns, trace);
      await db.latencyTrace.upsert({
        where: { callId: callRecord.id },
        update: legacy,
        create: { callId: callRecord.id, ...legacy },
      });
    }
    writeDebugLog(
      `[latency] Saved voice telemetry for call ${callRecord.id}: ${turns.length} turn(s)`,
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

function voiceTurnRevision(
  turn: VoiceTurnTelemetry,
  data: ReturnType<typeof buildVoiceTurnTelemetryData>,
): string {
  return JSON.stringify({
    sequence: turn.sequence,
    eventSequence: turn.eventSequence ?? 0,
    path: data.path,
    completed: data.completed,
    interrupted: data.interrupted,
    startedAt: data.startedAt.getTime(),
    endedAt: data.endedAt?.getTime() ?? null,
    trace: turn.latencyTrace ?? null,
    providers: [data.sttProvider, data.llmProvider, data.llmModel, data.ttsProvider],
    availability: [data.availabilitySearches, data.availabilityFailures],
    // Une phrase prononcée après l'écriture des mesures doit aussi être persistée.
    dialogue: turn.debugDialogue ?? null,
  });
}

/** Dialogue d'un tour de test, conservé VOICE_DEBUG_DIALOGUE_RETENTION_DAYS jours. */
function buildVoiceDebugTurnData(turn: VoiceTurnTelemetry, callId: string, restaurantId: string) {
  const dialogue = turn.debugDialogue!;
  return {
    callId,
    restaurantId,
    turnId: turn.id,
    sequence: turn.sequence,
    callerText: dialogue.callerText ?? null,
    agentText: formatDebugSpeech(dialogue.agentSpeech),
    fillerText: formatDebugSpeech(dialogue.fillers),
    speechAct: dialogue.speechAct ?? null,
    tools: [...dialogue.tools],
    expiresAt: new Date(turn.startedAt + VOICE_DEBUG_DIALOGUE_RETENTION_DAYS * 24 * 60 * 60 * 1000),
  };
}

type VoiceCallProviders = {
  sttProvider: string | null;
  llmProvider: string | null;
  llmModel: string | null;
  ttsProvider: string | null;
};

type VoiceCallTelemetryRollup = {
  llmProvider: string | null;
  llmModel: string | null;
  totalSpeechMs: number | null;
  totalTranscriptionMs: number | null;
  totalLlmMs: number | null;
  totalAvailabilityMs: number | null;
  totalTtsMs: number | null;
  firstLlmFirstTokenMs: number | null;
  firstLlmFirstPhraseMs: number | null;
  firstTtsFirstAudioMs: number | null;
  firstSttFinalToAudioMs: number | null;
  turnCount: number;
  llmTurnCount: number;
  deterministicTurnCount: number;
  fallbackTurnCount: number;
  availabilitySearchCount: number;
  availabilityFailureCount: number;
  loopCount: number;
  reservationConfirmed: boolean;
  reservationIntentAbandoned: boolean;
  finalizedAt: Date | null;
};

function firstDefined(values: Array<number | undefined>): number | null {
  return values.find((value): value is number => value !== undefined) ?? null;
}

function sumDefined(values: Array<number | undefined>): number | null {
  const defined = values.filter((value): value is number => value !== undefined);
  return defined.length > 0 ? defined.reduce((sum, value) => sum + value, 0) : null;
}

function sttFinalToAudio(trace: VoiceTurnLatencyTrace | undefined): number | undefined {
  if (trace?.sttFinalAt === undefined || trace.audioSentAt === undefined) return undefined;
  return Math.max(0, trace.audioSentAt - trace.sttFinalAt);
}

function audioFirstFrameMs(trace: VoiceTurnLatencyTrace | undefined): number | undefined {
  if (trace?.audioSentAt === undefined) return undefined;
  return Math.max(0, trace.audioSentAt - trace.startTime);
}

function transcriptionDuration(trace: VoiceTurnLatencyTrace | undefined): number | undefined {
  if (trace?.sttFinalMs === undefined) return undefined;
  if (trace.speechDurationMs === undefined) return trace.sttFinalMs;
  return Math.max(0, trace.sttFinalMs - trace.speechDurationMs);
}

function buildVoiceTurnTelemetryData(
  turn: VoiceTurnTelemetry,
  callId: string,
  providers: VoiceCallProviders,
) {
  const trace = turn.latencyTrace;
  return {
    callId,
    turnId: turn.id,
    sequence: turn.sequence,
    path: turn.path,
    transcriptLength: turn.transcriptLength,
    transcriptFingerprint: turn.transcriptFingerprint,
    speechDurationMs: trace?.speechDurationMs ?? null,
    transcriptionDurationMs: transcriptionDuration(trace) ?? null,
    speechToSttFinalMs: trace?.sttFinalMs ?? null,
    endOfSpeechToSttFinalMs: trace?.endOfSpeechToSttFinalMs ?? null,
    holdMs: trace?.holdMs ?? null,
    endOfSpeechToFirstAudioMs: trace?.endOfSpeechToFirstAudioMs ?? null,
    firstAudioIsFiller: trace?.firstAudioIsFiller ?? null,
    speechEndAt: trace?.speechEndAt !== undefined ? new Date(trace.speechEndAt) : null,
    llmFirstTokenMs: trace?.llmFirstTokenMs ?? null,
    llmFirstPhraseMs: trace?.llmFirstPhraseMs ?? null,
    llmDurationMs: trace?.llmCompletedMs ?? null,
    availabilityDurationMs: trace?.availabilityDurationMs ?? null,
    ttsFirstByteMs: trace?.ttsFirstByteMs ?? null,
    sttFinalToAudioMs: sttFinalToAudio(trace) ?? null,
    ttsDurationMs: trace?.ttsCompletedMs ?? null,
    totalE2eMs: trace?.totalE2eMs ?? null,
    sttProvider: turn.sttProvider ?? providers.sttProvider,
    llmProvider:
      turn.llmProvider ??
      (trace?.llmFirstTokenMs !== undefined || trace?.llmCompletedMs !== undefined
        ? providers.llmProvider
        : null),
    llmModel:
      turn.llmModel ??
      (trace?.llmFirstTokenMs !== undefined || trace?.llmCompletedMs !== undefined
        ? providers.llmModel
        : null),
    ttsProvider:
      turn.ttsProvider ??
      (trace?.ttsFirstByteMs !== undefined || trace?.ttsCompletedMs !== undefined
        ? providers.ttsProvider
        : null),
    availabilitySearches: turn.availabilitySearches,
    availabilityFailures: turn.availabilityFailures,
    loopDetected: turn.loopDetected,
    interrupted: Boolean(turn.interrupted || trace?.interruptedAt !== undefined),
    completed: turn.completed,
    startedAt: new Date(turn.startedAt),
    endedAt: turn.endedAt ? new Date(turn.endedAt) : null,
  };
}

function buildVoiceCallTelemetryRollup(
  turns: VoiceTurnTelemetry[],
  facts: {
    finalized: boolean;
    reservationConfirmed: boolean;
    reservationIntentAbandoned: boolean;
  },
  providers: VoiceCallProviders,
): VoiceCallTelemetryRollup {
  const traces = turns.map((turn) => turn.latencyTrace);
  const sttToAudio = traces.map(sttFinalToAudio);
  const llmWasUsed = turns.some(
    (turn) =>
      turn.llmProvider !== undefined ||
      turn.llmModel !== undefined ||
      turn.path === 'llm' ||
      turn.latencyTrace?.llmFirstTokenMs !== undefined ||
      turn.latencyTrace?.llmCompletedMs !== undefined,
  );
  return {
    llmProvider: llmWasUsed ? providers.llmProvider : null,
    llmModel: llmWasUsed ? providers.llmModel : null,
    // Sans timestamps de mots, la durée de parole est inconnue. Conserver
    // NULL évite de présenter le temps entre début et STT final comme du
    // temps de parole ; totalTranscriptionMs porte alors la mesure disponible.
    totalSpeechMs: sumDefined(traces.map((trace) => trace?.speechDurationMs)),
    totalTranscriptionMs: sumDefined(traces.map(transcriptionDuration)),
    totalLlmMs: sumDefined(traces.map((trace) => trace?.llmCompletedMs)),
    totalAvailabilityMs: sumDefined(traces.map((trace) => trace?.availabilityDurationMs)),
    totalTtsMs: sumDefined(traces.map((trace) => trace?.ttsCompletedMs)),
    firstLlmFirstTokenMs: firstDefined(traces.map((trace) => trace?.llmFirstTokenMs)),
    firstLlmFirstPhraseMs: firstDefined(traces.map((trace) => trace?.llmFirstPhraseMs)),
    firstTtsFirstAudioMs: firstDefined(traces.map(audioFirstFrameMs)),
    firstSttFinalToAudioMs: firstDefined(sttToAudio),
    turnCount: turns.length,
    llmTurnCount: turns.filter(
      (turn) =>
        turn.path === 'llm' ||
        (turn.path === 'availability' && turn.latencyTrace?.llmCompletedMs !== undefined),
    ).length,
    deterministicTurnCount: turns.filter((turn) => turn.path === 'deterministic').length,
    fallbackTurnCount: turns.filter((turn) => turn.path === 'fallback').length,
    availabilitySearchCount: turns.reduce((sum, turn) => sum + turn.availabilitySearches, 0),
    availabilityFailureCount: turns.reduce((sum, turn) => sum + turn.availabilityFailures, 0),
    loopCount: turns.filter((turn) => turn.loopDetected).length,
    reservationConfirmed: facts.reservationConfirmed,
    reservationIntentAbandoned: facts.reservationIntentAbandoned,
    finalizedAt: facts.finalized ? new Date() : null,
  };
}

function buildLegacyLatencyTrace(turns: VoiceTurnTelemetry[], currentTrace: VoiceTurnLatencyTrace) {
  const allTraces = turns
    .map((turn) => turn.latencyTrace)
    .filter(Boolean) as VoiceTurnLatencyTrace[];
  const traces = allTraces.length > 0 ? allTraces : [currentTrace];
  const maxE2e = traces.reduce<number | null>(
    (max, trace) =>
      trace.totalE2eMs === undefined
        ? max
        : max === null
          ? trace.totalE2eMs
          : Math.max(max, trace.totalE2eMs),
    null,
  );
  return {
    // Legacy fields remain populated, but now retain the first successful LLM
    // and the worst completed turn instead of whichever turn happened last.
    vadEndMs: traces.reduce<number | null>(
      (max, trace) =>
        trace.sttFinalMs === undefined
          ? max
          : max === null
            ? trace.sttFinalMs
            : Math.max(max, trace.sttFinalMs),
      null,
    ),
    sttFinalMs: traces[traces.length - 1]?.sttFinalMs ?? 0,
    llmFirstToken: firstDefined(traces.map((trace) => trace.llmFirstTokenMs)),
    ttsFirstByte: firstDefined(traces.map((trace) => trace.ttsFirstByteMs)),
    audioPlayingMs: maxE2e,
    totalE2eMs: maxE2e,
  };
}

import type { UsageCategory } from '@prisma/client';
import { enqueueOnDatabase } from '../../shared/outbox/outbox.service';
import { logger } from '../../shared/logger/pino';
import type { CallSession, VoiceUsageCounters } from '../voice/stream/types';
import { telnyxCodecProfile } from '../voice/stream/telnyx-codec';

const STT_SAMPLE_RATE = 8_000;

interface VoiceUsagePayload {
  restaurantId: string;
  category: UsageCategory;
  provider: string;
  quantity: number;
  unit: string;
  sourceType: string;
  sourceId: string;
  sourceEventKey: string;
  occurredAt: string;
  metadata: Record<string, string | number | boolean | null>;
}

export function ensureVoiceUsage(session: CallSession): VoiceUsageCounters {
  if (!session.voiceUsage) {
    session.voiceUsage = {
      sttAudioSamples: 0,
      cartesiaTtsCharacters: 0,
      llmByProvider: {},
    };
  }
  return session.voiceUsage;
}

/** Count only audio actually handed to Scribe, after any codec conversion. */
export function addSttAudioSamples(session: CallSession, samples: number): void {
  if (!Number.isFinite(samples) || samples <= 0) return;
  ensureVoiceUsage(session).sttAudioSamples += samples;
}

export function sttSamplesForBuffer(session: CallSession, audioBytes: number): number {
  // Comptage après conversion vers Scribe : PCMA et L16 sont PCM16,
  // PCMU reste en G.711 8 bits. Main divisait déjà PCMA par deux.
  return audioBytes / (session.codec === 'PCMU' ? 1 : 2);
}

/** Count Cartesia characters only after a provider request/cache miss. */
export function addCartesiaTtsCharacters(session: CallSession, characters: number): void {
  if (!Number.isFinite(characters) || characters <= 0) return;
  ensureVoiceUsage(session).cartesiaTtsCharacters += characters;
}

export function estimateTokenCount(text: string): number {
  const normalized = text.trim();
  return normalized ? Math.max(1, Math.ceil(normalized.length / 4)) : 0;
}

export function estimateMessagesTokens(messages: Array<{ content?: string }>): number {
  return messages.reduce((total, message) => total + estimateTokenCount(message.content ?? ''), 0);
}

export function addLlmUsage(
  session: CallSession,
  provider: string,
  turnKey: string,
  inputTokens: number,
  outputTokens: number,
  estimated: boolean,
): void {
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return;
  const normalizedProvider = provider.trim().toLowerCase() || 'unknown';
  const normalizedTurnKey = turnKey.trim() || `turn-${session.turnCount}`;
  const counters = ensureVoiceUsage(session);
  const byTurn = (counters.llmByProvider[normalizedProvider] ??= {});
  const current = (byTurn[normalizedTurnKey] ??= {
    inputTokens: 0,
    outputTokens: 0,
    estimated: false,
  });
  current.inputTokens += Math.max(0, Math.round(inputTokens));
  current.outputTokens += Math.max(0, Math.round(outputTokens));
  current.estimated ||= estimated;
}

function buildPayload(
  session: CallSession,
  category: UsageCategory,
  provider: string,
  quantity: number,
  unit: string,
  sourceEventKey: string,
  metadata: Record<string, string | number | boolean | null>,
): VoiceUsagePayload {
  return {
    restaurantId: session.restaurantId,
    category,
    provider,
    quantity,
    unit,
    sourceType: 'voice_call',
    sourceId: session.callLegId,
    sourceEventKey,
    occurredAt: new Date(session.createdAt || Date.now()).toISOString(),
    metadata,
  };
}

async function enqueueVoiceUsage(payload: VoiceUsagePayload): Promise<void> {
  await enqueueOnDatabase({
    restaurantId: payload.restaurantId,
    topic: 'usage',
    aggregateType: 'call',
    aggregateId: payload.sourceId,
    eventType: 'usage.record',
    idempotencyKey: payload.sourceEventKey,
    payload: payload as unknown as Record<string, unknown>,
  });
}

/**
 * Flush all provider counters to durable outbox intents. The method is safe to
 * call from Telnyx close, stop and error paths: keys are stable and enqueue is
 * idempotent, while a failed flush can be retried by the caller.
 */
export async function finalizeVoiceUsage(session: CallSession): Promise<void> {
  if (session.voiceUsage?.finalization) return session.voiceUsage.finalization;

  const promise = (async () => {
    const counters = ensureVoiceUsage(session);
    const tasks: Promise<void>[] = [];

    const sttSeconds = counters.sttAudioSamples / telnyxCodecProfile(session.codec).sampleRate;
    if (sttSeconds > 0) {
      tasks.push(
        enqueueVoiceUsage(
          buildPayload(
            session,
            'STT_SECONDS',
            'elevenlabs',
            sttSeconds,
            'seconds',
            `elevenlabs:stt:${session.callLegId}:final`,
            {
              model: session.sttModel ?? 'unknown',
              countMethod: 'audio_samples',
            },
          ),
        ),
      );
    }

    if (counters.cartesiaTtsCharacters > 0) {
      tasks.push(
        enqueueVoiceUsage(
          buildPayload(
            session,
            'TTS_CHARACTERS',
            'cartesia',
            counters.cartesiaTtsCharacters,
            'characters',
            `cartesia:tts:${session.callLegId}:final`,
            { model: 'sonic', countMethod: 'provider_requests' },
          ),
        ),
      );
    }

    for (const [provider, byTurn] of Object.entries(counters.llmByProvider)) {
      for (const [turnKey, usage] of Object.entries(byTurn)) {
        const commonMetadata = {
          provider,
          countMethod: usage.estimated ? 'estimated_chars' : 'provider_reported',
        } as const;
        if (usage.inputTokens > 0) {
          tasks.push(
            enqueueVoiceUsage(
              buildPayload(
                session,
                'LLM_INPUT_TOKENS',
                provider,
                usage.inputTokens,
                'tokens',
                `${provider}:llm:${session.callLegId}:${turnKey}:input`,
                commonMetadata,
              ),
            ),
          );
        }
        if (usage.outputTokens > 0) {
          tasks.push(
            enqueueVoiceUsage(
              buildPayload(
                session,
                'LLM_OUTPUT_TOKENS',
                provider,
                usage.outputTokens,
                'tokens',
                `${provider}:llm:${session.callLegId}:${turnKey}:output`,
                commonMetadata,
              ),
            ),
          );
        }
      }
    }

    const results = await Promise.allSettled(tasks);
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failed) throw failed.reason;
  })();

  session.voiceUsage = { ...ensureVoiceUsage(session), finalization: promise };
  try {
    await promise;
  } catch (error) {
    session.voiceUsage.finalization = undefined;
    logger.error(
      { err: error, callId: session.callControlId },
      '[usage] Failed to enqueue voice provider usage',
    );
    throw error;
  }
}

export const VOICE_STT_SAMPLE_RATE = STT_SAMPLE_RATE;

import type { UsageCategory } from '@prisma/client';
import { enqueueOnDatabase } from '../../shared/outbox/outbox.service';
import { logger } from '../../shared/logger/pino';
import type {
  CallSession,
  LlmRequestKind,
  VoiceSpeculationCounters,
  VoiceUsageCounters,
  VoiceUsageKindCounter,
} from '../voice/stream/types';
import { telnyxCodecProfile } from '../voice/stream/telnyx-codec';
import { ELEVENLABS_DIALOGUE_MODEL } from '../voice/stream/elevenlabs-dialogue-context';

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
      elevenLabsTtsCharacters: 0,
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

/** Count ElevenLabs characters only after they are sent to the provider, as for Cartesia. */
export function addElevenLabsTtsCharacters(session: CallSession, characters: number): void {
  if (!Number.isFinite(characters) || characters <= 0) return;
  ensureVoiceUsage(session).elevenLabsTtsCharacters += characters;
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
/**
 * Compte une requête au modèle par sorte (tour, second passage, anticipation, juge, relance). Mesure seulement :
 * rien ne change dans le dialogue ni dans la facturation enregistrée. Une requête interrompue (anticipation jetée)
 * compte son entrée estimée : le fournisseur la facture alors qu'elle n'apparaît pas dans `llmByProvider`.
 */
export function addLlmKindUsage(
  session: CallSession,
  kind: LlmRequestKind,
  inputTokens: number,
  outputTokens: number,
  interrupted: boolean,
  cachedInputTokens = 0,
): void {
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return;
  const counters = ensureVoiceUsage(session);
  const byKind = (counters.llmByKind ??= {});
  const current: VoiceUsageKindCounter = (byKind[kind] ??= {
    requests: 0,
    interrupted: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  });
  current.requests += 1;
  if (interrupted) current.interrupted += 1;
  current.inputTokens += Math.max(0, Math.round(inputTokens));
  if (Number.isFinite(cachedInputTokens)) {
    current.cachedInputTokens += Math.max(0, Math.round(cachedInputTokens));
  }
  current.outputTokens += Math.max(0, Math.round(outputTokens));
}

/** Résumé par sorte de requête, journalisé à la fin de l'appel (des comptes, jamais de texte). */
export function summarizeLlmKinds(
  counters: VoiceUsageCounters,
): Record<string, VoiceUsageKindCounter> {
  return Object.fromEntries(
    Object.entries(counters.llmByKind ?? {}).filter(
      ([, counter]) => counter && counter.requests > 0,
    ),
  ) as Record<string, VoiceUsageKindCounter>;
}

/**
 * Récapitulatif de l'anticipation pour le résumé de fin d'appel. `unresolved` : lancées encore en cours
 * quand l'appel s'est terminé (ni reprises, ni jetées, ni remplacées, ni abandonnées).
 */
export function summarizeSpeculation(
  counters: VoiceUsageCounters,
): (VoiceSpeculationCounters & { unresolved: number }) | null {
  const speculation = counters.speculation;
  if (!speculation) return null;
  const missed = Object.values(speculation.misses).reduce((total, count) => total + count, 0);
  const resolved = speculation.hits + missed + speculation.replaced + speculation.cancelled;
  return { ...speculation, unresolved: Math.max(0, speculation.launches - resolved) };
}

export async function finalizeVoiceUsage(session: CallSession): Promise<void> {
  if (session.voiceUsage?.finalization) return session.voiceUsage.finalization;

  const promise = (async () => {
    const counters = ensureVoiceUsage(session);
    const tasks: Promise<void>[] = [];
    const llmByKind = summarizeLlmKinds(counters);
    const speculation = summarizeSpeculation(counters);
    if (Object.keys(llmByKind).length || speculation) {
      logger.info(
        {
          callId: session.callControlId,
          restaurantId: session.restaurantId,
          llmByKind,
          ...(speculation ? { speculation } : {}),
        },
        '[usage] llm requests by kind',
      );
    }

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

    if (counters.elevenLabsTtsCharacters > 0) {
      tasks.push(
        enqueueVoiceUsage(
          buildPayload(
            session,
            'TTS_CHARACTERS',
            'elevenlabs',
            counters.elevenLabsTtsCharacters,
            'characters',
            `elevenlabs:tts:${session.callLegId}:final`,
            { model: ELEVENLABS_DIALOGUE_MODEL, countMethod: 'provider_requests' },
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

import { env } from '../../../../env';
import type { CallSession, PendingInteractionKind } from '../types';
import type { TurnPlan } from '../turn-plan';
import { recordVoiceTurnEventIfCurrent } from '../turn-telemetry';
import {
  voiceSemanticAgreementTotal,
  voiceSemanticConflictTotal,
  voiceSemanticDurationMs,
  voiceSemanticInputTokensTotal,
  voiceSemanticStatusTotal,
  voiceSemanticWouldClarifyTotal,
} from '../../../../shared/observability/metrics';
import { BEHAVIOR_SET_VERSION } from './behaviors';
import { buildSemanticSpan } from './span-builder';
import { scoreSpan } from './client';
import { validateSemanticSignals } from './validate';
import { compareSemanticSignals } from './compare';
import type { SemanticScoreResult } from './types';

export interface SemanticShadowConfig {
  enabled: boolean;
  sampleRate: number;
  model: 'span-01-pro' | 'span-01-free';
  timeoutMs: number;
  historyTurns: number;
  baseUrl: string;
  apiKey?: string;
}

function currentConfig(): SemanticShadowConfig {
  return {
    enabled: env.VOICE_SEMANTIC_SIGNALS_ENABLED === 'true',
    sampleRate: env.VOICE_SEMANTIC_SIGNALS_SAMPLE_RATE,
    model: env.VOICE_SEMANTIC_SIGNALS_MODEL,
    timeoutMs: env.VOICE_SEMANTIC_SIGNALS_TIMEOUT_MS,
    historyTurns: env.VOICE_SEMANTIC_SIGNALS_HISTORY_TURNS,
    baseUrl: env.RESPAN_BASE_URL,
    apiKey: env.RESPAN_API_KEY,
  };
}

/** Launches an observation and always returns before the network response. */
export function observeSemanticSignalsShadow(
  session: CallSession,
  turn: {
    transcript: string;
    reply: string;
    previousQuestion: string | null;
    plan?: TurnPlan;
    activeInteraction: PendingInteractionKind | 'none';
    turnId?: string;
    spanSession?: Pick<CallSession, 'history' | 'conversation' | 'from'>;
  },
  options: { config?: SemanticShadowConfig; fetcher?: typeof fetch; random?: () => number } = {},
): void {
  const config = options.config ?? currentConfig();
  if (!config.enabled || !config.apiKey?.trim()) {
    voiceSemanticStatusTotal.inc({ status: 'disabled' });
    return;
  }
  if ((options.random ?? Math.random)() >= config.sampleRate) return;
  try {
    const request = buildSemanticSpan(turn.spanSession ?? session, {
      transcript: turn.transcript,
      reply: turn.reply,
      previousQuestion: turn.previousQuestion,
      model: config.model,
      historyTurns: config.historyTurns,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    scoreSpan(request, {
      signal: controller.signal,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      fetcher: options.fetcher,
    })
      .then((result) => {
        clearTimeout(timer);
        recordSemanticResult(result, session, turn, config.model);
      })
      .catch(() => {
        clearTimeout(timer);
        voiceSemanticStatusTotal.inc({ status: 'network_error' });
      });
  } catch {
    voiceSemanticStatusTotal.inc({ status: 'invalid_response' });
  }
}

function recordSemanticResult(
  result: SemanticScoreResult,
  session: CallSession,
  turn: { plan?: TurnPlan; activeInteraction: PendingInteractionKind | 'none'; turnId?: string },
  model: string,
): void {
  voiceSemanticStatusTotal.inc({ status: result.status });
  voiceSemanticDurationMs.observe({ model }, result.durationMs);
  if (result.status !== 'ok') {
    recordVoiceTurnEventIfCurrent(session, turn.turnId, 'semantic_signals_shadow', {
      status: result.status,
      model,
      behaviorSetVersion: BEHAVIOR_SET_VERSION,
      durationMs: result.durationMs,
    });
    return;
  }
  voiceSemanticInputTokensTotal.inc(result.inputTokens);
  const validation = validateSemanticSignals(result.signals, turn.activeInteraction);
  const comparison = compareSemanticSignals(result.signals, turn.plan, turn.activeInteraction);
  for (const conflict of validation.conflicts) voiceSemanticConflictTotal.inc({ conflict });
  for (const [behavior, outcome] of Object.entries(comparison.agreements)) {
    voiceSemanticAgreementTotal.inc({
      behavior,
      outcome,
      behavior_set_version: BEHAVIOR_SET_VERSION,
    });
  }
  if (comparison.wouldClarify) {
    voiceSemanticWouldClarifyTotal.inc({ sensitive_action: comparison.wouldClarify });
  }
  const probabilities = Object.fromEntries(
    Object.entries(result.signals).flatMap(([id, score]) =>
      score
        ? [
            [`${id}_present`, score.present],
            [`${id}_absent`, score.absent],
            [`${id}_not_observable`, score.notObservable],
          ]
        : [],
    ),
  );
  recordVoiceTurnEventIfCurrent(session, turn.turnId, 'semantic_signals_shadow', {
    status: result.status,
    model,
    behaviorSetVersion: BEHAVIOR_SET_VERSION,
    durationMs: result.durationMs,
    inputTokens: result.inputTokens,
    consistent: validation.consistent,
    conflictCount: validation.conflicts.length,
    disagreeCount: Object.values(comparison.agreements).filter((outcome) => outcome === 'disagree')
      .length,
    wouldClarify: comparison.wouldClarify ?? null,
    ...probabilities,
  });
}

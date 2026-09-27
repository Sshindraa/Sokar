import { env } from '../../../../env';
import type { CallSession, PendingInteractionKind } from '../types';
import type { TurnPlan } from '../turn-plan';
import { recordVoiceTurnEventIfCurrent } from '../turn-telemetry';
import {
  voiceSemanticAgreementTotal,
  voiceSemanticChoiceConfidence,
  voiceSemanticConflictTotal,
  voiceSemanticDurationMs,
  voiceSemanticInputTokensTotal,
  voiceSemanticStatusTotal,
  voiceSemanticWouldClarifyTotal,
} from '../../../../shared/observability/metrics';
import { BEHAVIOR_SET_VERSION } from './behaviors';
import { buildDecisionState, buildSemanticSpan } from './span-builder';
import { scoreSpan } from './client';
import { scoreDecisions } from './openrouter-client';
import { validateSemanticSignals } from './validate';
import { compareSemanticSignals } from './compare';
import type { SemanticProvider, SemanticScoreResult } from './types';

/** Défauts par fournisseur : Respan n'accepte que ses modèles, OpenRouter passe par Jev. */
export const DEFAULT_SEMANTIC_MODELS: Record<SemanticProvider, string> = {
  openrouter: 'typesafe/jev-1.13-20260917',
  respan: 'span-01-pro',
};

export interface SemanticShadowConfig {
  enabled: boolean;
  sampleRate: number;
  provider: SemanticProvider;
  model: string;
  timeoutMs: number;
  historyTurns: number;
  baseUrl: string;
  apiKey?: string;
}

/** La clé et la base dépendent du fournisseur sélectionné. */
function providerSettings(provider: SemanticProvider): { apiKey?: string; baseUrl: string } {
  return provider === 'respan'
    ? { apiKey: env.RESPAN_API_KEY, baseUrl: env.RESPAN_BASE_URL }
    : { apiKey: env.OPENROUTER_API_KEY, baseUrl: env.OPENROUTER_BASE_URL };
}

function currentConfig(): SemanticShadowConfig {
  const provider = env.VOICE_SEMANTIC_SIGNALS_PROVIDER;
  const { apiKey, baseUrl } = providerSettings(provider);
  return {
    enabled: env.VOICE_SEMANTIC_SIGNALS_ENABLED === 'true',
    sampleRate: env.VOICE_SEMANTIC_SIGNALS_SAMPLE_RATE,
    provider,
    // Le défaut est propre au fournisseur ; `env.ts` résout la valeur finale.
    model: env.VOICE_SEMANTIC_SIGNALS_MODEL ?? DEFAULT_SEMANTIC_MODELS[provider],
    timeoutMs: env.VOICE_SEMANTIC_SIGNALS_TIMEOUT_MS,
    historyTurns: env.VOICE_SEMANTIC_SIGNALS_HISTORY_TURNS,
    baseUrl,
    apiKey,
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
  if (!config.enabled) return;
  if (!config.apiKey?.trim()) {
    voiceSemanticStatusTotal.inc({ status: 'missing_key', provider: config.provider });
    return;
  }
  if ((options.random ?? Math.random)() >= config.sampleRate) return;
  const currentIntent = turn.spanSession?.conversation.intent ?? session.conversation.intent;
  try {
    const spanSession = turn.spanSession ?? session;
    const input = {
      transcript: turn.transcript,
      reply: turn.reply,
      previousQuestion: turn.previousQuestion,
      model: config.model,
      historyTurns: config.historyTurns,
      activeInteraction: turn.activeInteraction,
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    const request = {
      signal: controller.signal,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      fetcher: options.fetcher,
    };
    const scored =
      config.provider === 'respan'
        ? scoreSpan(buildSemanticSpan(spanSession, input), request)
        : scoreDecisions(buildDecisionState(spanSession, input), request);
    scored
      .then((result) => {
        clearTimeout(timer);
        recordSemanticResult(result, session, turn, config, currentIntent);
      })
      .catch(() => {
        clearTimeout(timer);
        voiceSemanticStatusTotal.inc({ status: 'network_error', provider: config.provider });
      });
  } catch {
    voiceSemanticStatusTotal.inc({ status: 'invalid_response', provider: config.provider });
  }
}

function recordSemanticResult(
  result: SemanticScoreResult,
  session: CallSession,
  turn: { plan?: TurnPlan; activeInteraction: PendingInteractionKind | 'none'; turnId?: string },
  config: Pick<SemanticShadowConfig, 'model' | 'provider'>,
  currentIntent: CallSession['conversation']['intent'],
): void {
  const { model, provider } = config;
  voiceSemanticStatusTotal.inc({ status: result.status, provider });
  voiceSemanticDurationMs.observe({ model, provider }, result.durationMs);
  if (result.status !== 'ok') {
    recordVoiceTurnEventIfCurrent(session, turn.turnId, 'semantic_signals_shadow', {
      status: result.status,
      model,
      provider,
      behaviorSetVersion: BEHAVIOR_SET_VERSION,
      durationMs: result.durationMs,
    });
    return;
  }
  voiceSemanticInputTokensTotal.inc(result.inputTokens);
  const validation = validateSemanticSignals(result.signals, turn.activeInteraction);
  const comparison = compareSemanticSignals(
    result.signals,
    turn.plan,
    turn.activeInteraction,
    currentIntent,
    { supportsNotObservable: result.supportsNotObservable, choices: result.choices },
  );
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
  for (const [id, choice] of Object.entries(result.choices ?? {})) {
    const maxProbability = Math.max(0, ...Object.values(choice?.probabilities ?? {}));
    voiceSemanticChoiceConfidence.observe({ choice: id, provider }, maxProbability);
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
    provider,
    behaviorSetVersion: BEHAVIOR_SET_VERSION,
    durationMs: result.durationMs,
    inputTokens: result.inputTokens,
    consistent: validation.consistent,
    conflictCount: validation.conflicts.length,
    disagreeCount: Object.values(comparison.agreements).filter((outcome) => outcome === 'disagree')
      .length,
    wouldClarify: comparison.wouldClarify ?? null,
    ...Object.fromEntries(
      Object.entries(result.choices ?? {}).flatMap(([id, choice]) =>
        choice
          ? [
              [`${id}_option`, choice.choice],
              [`${id}_confidence`, choice.confidence],
              ...Object.entries(choice.probabilities).map(
                ([option, probability]) => [`${id}_${option}`, probability] as const,
              ),
            ]
          : [],
      ),
    ),
    ...probabilities,
  });
}

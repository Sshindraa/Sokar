import { z } from 'zod';
import { voiceSemanticAnswerSkippedTotal } from '../../../../shared/observability/metrics';
import { BEHAVIOR_IDS, CHOICE_IDS } from './behaviors';
import type {
  DecisionRequest,
  SemanticChoices,
  SemanticScoreResult,
  SemanticSignals,
} from './types';

/**
 * Réponse de `POST /alpha/decisions`. Jev accepte `noul` (une probabilité) et
 * `choice` (une distribution sur des options nommées). Le schéma de haut niveau
 * reste permissif : chaque réponse est validée séparément, pour qu'une réponse
 * d'un type inattendu n'invalide pas tout le lot.
 */
const responseSchema = z.object({
  answers: z.record(z.unknown()),
  usage: z.object({ input_tokens: z.number().int().nonnegative() }).optional(),
});

const noulAnswerSchema = z.object({
  type: z.literal('noul'),
  noul: z.number().min(0).max(1),
});

/** `confidence` est optionnelle : la probabilité maximale sert alors de repli. */
const choiceAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  probabilities: z.record(z.number().min(0).max(1)),
  confidence: z.number().min(0).max(1).optional(),
});

export async function scoreDecisions(
  request: DecisionRequest,
  options: { signal: AbortSignal; apiKey: string; baseUrl: string; fetcher?: typeof fetch },
): Promise<SemanticScoreResult> {
  const started = performance.now();
  const durationMs = () => performance.now() - started;
  try {
    const response = await (options.fetcher ?? fetch)(
      `${options.baseUrl.replace(/\/$/, '')}/alpha/decisions`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: options.signal,
      },
    );
    if (!response.ok) {
      return {
        status:
          response.status === 400
            ? 'invalid_request'
            : response.status === 402
              ? 'payment_required'
              : response.status === 403
                ? 'forbidden'
                : response.status === 429
                  ? 'rate_limited'
                  : 'http_error',
        durationMs: durationMs(),
      };
    }
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) return { status: 'invalid_response', durationMs: durationMs() };
    const signals: SemanticSignals = {};
    const choices: SemanticChoices = {};
    let expected = 0;
    for (const [id, rawAnswer] of Object.entries(parsed.data.answers)) {
      const isExpected = BEHAVIOR_IDS.has(id) || CHOICE_IDS.has(id);
      if (isExpected) expected++;
      const type =
        typeof rawAnswer === 'object' && rawAnswer !== null
          ? (rawAnswer as { type?: unknown }).type
          : undefined;
      if (type !== 'noul' && type !== 'choice') {
        if (isExpected)
          voiceSemanticAnswerSkippedTotal.inc({ provider: 'openrouter', reason: 'unknown_type' });
        continue;
      }
      if (type === 'noul') {
        const parsedAnswer = noulAnswerSchema.safeParse(rawAnswer);
        if (!parsedAnswer.success) {
          if (isExpected)
            voiceSemanticAnswerSkippedTotal.inc({
              provider: 'openrouter',
              reason: 'invalid_shape',
            });
          continue;
        }
        if (!BEHAVIOR_IDS.has(id)) continue;
        signals[id as keyof SemanticSignals] = {
          present: parsedAnswer.data.noul,
          absent: 1 - parsedAnswer.data.noul,
          notObservable: 0,
        };
        continue;
      }
      const parsedAnswer = choiceAnswerSchema.safeParse(rawAnswer);
      if (!parsedAnswer.success) {
        if (isExpected)
          voiceSemanticAnswerSkippedTotal.inc({ provider: 'openrouter', reason: 'invalid_shape' });
        continue;
      }
      if (!CHOICE_IDS.has(id)) continue;
      choices[id as keyof SemanticChoices] = {
        choice: parsedAnswer.data.choice,
        probabilities: parsedAnswer.data.probabilities,
        confidence:
          parsedAnswer.data.confidence ??
          Math.max(0, ...Object.values(parsedAnswer.data.probabilities)),
      };
    }
    // Un lot sans aucune réponse exploitable est traité comme une réponse illisible.
    if (Object.keys(signals).length === 0 && Object.keys(choices).length === 0 && expected > 0)
      return { status: 'invalid_response', durationMs: durationMs() };
    return {
      status: 'ok',
      signals,
      durationMs: durationMs(),
      inputTokens: parsed.data.usage?.input_tokens ?? 0,
      supportsNotObservable: false,
      choices,
    };
  } catch (error) {
    return {
      status:
        options.signal.aborted || (error instanceof Error && error.name === 'AbortError')
          ? 'timeout'
          : error instanceof SyntaxError
            ? 'invalid_response'
            : 'network_error',
      durationMs: durationMs(),
    };
  }
}

import { z } from 'zod';
import { BEHAVIOR_IDS, CHOICE_IDS } from './behaviors';
import type {
  DecisionRequest,
  SemanticChoices,
  SemanticScoreResult,
  SemanticSignals,
} from './types';

/**
 * Réponse de `POST /alpha/decisions`. Jev accepte `noul` (une probabilité) et
 * `choice` (une distribution sur des options nommées).
 */
const responseSchema = z.object({
  answers: z.record(
    z.union([
      z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) }),
      z.object({
        type: z.literal('choice'),
        choice: z.string(),
        probabilities: z.record(z.number().min(0).max(1)),
        confidence: z.number().min(0).max(1),
      }),
    ]),
  ),
  usage: z.object({ input_tokens: z.number().int().nonnegative() }).optional(),
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
    for (const [id, answer] of Object.entries(parsed.data.answers)) {
      if (answer.type === 'choice') {
        if (!CHOICE_IDS.has(id)) continue;
        choices[id as keyof SemanticChoices] = {
          choice: answer.choice,
          probabilities: answer.probabilities,
          confidence: answer.confidence,
        };
        continue;
      }
      if (!BEHAVIOR_IDS.has(id)) continue;
      signals[id as keyof SemanticSignals] = {
        present: answer.noul,
        absent: 1 - answer.noul,
        notObservable: 0,
      };
    }
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

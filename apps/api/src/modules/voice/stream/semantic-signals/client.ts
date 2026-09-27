import { z } from 'zod';
import { BEHAVIOR_IDS } from './behaviors';
import type { SemanticScoreResult, SemanticSignals, SpanRequest } from './types';

const responseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      p_present: z.number().min(0).max(1),
      p_absent: z.number().min(0).max(1),
      p_not_observable: z.number().min(0).max(1),
    }),
  ),
  usage: z.object({ input_tokens: z.number().int().nonnegative() }).optional(),
});

export async function scoreSpan(
  request: SpanRequest,
  options: { signal: AbortSignal; apiKey: string; baseUrl: string; fetcher?: typeof fetch },
): Promise<SemanticScoreResult> {
  const started = performance.now();
  const durationMs = () => performance.now() - started;
  try {
    const response = await (options.fetcher ?? fetch)(
      `${options.baseUrl.replace(/\/$/, '')}/scores`,
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
          response.status === 403
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
    for (const result of parsed.data.results) {
      if (!BEHAVIOR_IDS.has(result.id)) continue;
      signals[result.id as keyof SemanticSignals] = {
        present: result.p_present,
        absent: result.p_absent,
        notObservable: result.p_not_observable,
      };
    }
    return {
      status: 'ok',
      signals,
      durationMs: durationMs(),
      inputTokens: parsed.data.usage?.input_tokens ?? 0,
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

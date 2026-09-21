/**
 * Retry borné avec backoff exponentiel (R1-2).
 *
 * Trois règles :
 *  - le nombre de tentatives est explicite et petit : un retry qui s'éternise
 *    retarde la dégradation au lieu de la provoquer ;
 *  - seules les erreurs transitoires sont rejouées (timeout, réseau, 5xx) ;
 *    rejouer un 4xx ou une erreur métier ne fait que consommer du quota ;
 *  - le sleep est injectable pour que les tests n'attendent pas réellement.
 */

import { ProviderTimeoutError } from './timeout';

export interface RetryOptions {
  /** Nombre total de tentatives, première comprise. Défaut : 3. */
  readonly attempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly isRetryable?: (error: unknown) => boolean;
  readonly onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/**
 * Erreurs qui méritent un nouvel essai : timeout explicite, erreur réseau, ou
 * statut HTTP 5xx/429. Tout le reste (4xx, erreur métier) est définitif.
 */
export function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderTimeoutError) return true;
  if (!error || typeof error !== 'object') return false;

  const candidate = error as {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
  };
  if (typeof candidate.code === 'string' && NETWORK_ERROR_CODES.has(candidate.code)) return true;

  const status = typeof candidate.status === 'number' ? candidate.status : candidate.statusCode;
  if (typeof status === 'number' && (status >= 500 || status === 429)) return true;

  if (typeof candidate.message === 'string') {
    return /fetch failed|socket hang up|network|timeout/i.test(candidate.message);
  }
  return false;
}

export async function retry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 2_000;
  const isRetryable = options.isRetryable ?? isRetryableProviderError;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const random = options.random ?? Math.random;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const isLast = attempt === attempts;
      if (isLast || !isRetryable(error)) throw error;

      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      // Jitter ±20 % : évite que plusieurs workers retentent au même instant.
      const delayMs = Math.round(exponential * (0.8 + random() * 0.4));
      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

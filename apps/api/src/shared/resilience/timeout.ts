/**
 * Bornes de temps pour les appels fournisseurs (R1-2).
 *
 * Un `fetch` sans timeout peut rester en vol jusqu'à la mort de la socket : sur
 * le chemin vocal, cela signifie un appel téléphonique bloqué sans réponse. Le
 * timeout est donc la première brique de résilience, avant les retries et le
 * circuit breaker.
 */

export class ProviderTimeoutError extends Error {
  constructor(
    readonly label: string,
    readonly timeoutMs: number,
  ) {
    super(`${label} a dépassé ${timeoutMs} ms`);
    this.name = 'ProviderTimeoutError';
  }
}

/** Borne par défaut d'un appel fournisseur hors voice. */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 10_000;

/** Borne par défaut d'un appel sur le chemin vocal (TTS, STT, LLM). */
export const VOICE_PROVIDER_TIMEOUT_MS = 8_000;

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ProviderTimeoutError(label, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * `fetch` avec timeout explicite. Le signal est propagé si l'appelant en fournit
 * déjà un (annulation par l'appelant prioritaire).
 */
export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_PROVIDER_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: init.signal ?? controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ProviderTimeoutError(typeof url === 'string' ? url : url.toString(), timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

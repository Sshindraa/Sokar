/**
 * Fetch avec timeout via AbortController.
 * Si la requête dépasse 10s, elle est abortée et throw une erreur.
 */
const FETCH_TIMEOUT_MS = 10_000;

export function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

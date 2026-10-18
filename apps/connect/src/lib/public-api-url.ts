/**
 * Public address of the Sokar API, as AI assistants must call it (MCP, OAuth discovery).
 *
 * `API_URL` is the server-side address Connect uses to reach the API on the same host
 * (`http://127.0.0.1:4000` in production): it must never be published to a client.
 */
export const DEFAULT_PUBLIC_API_URL = 'https://api.sokar.tech';

export function publicApiUrl(env: Record<string, string | undefined> = process.env): string {
  const configured = env.PUBLIC_API_URL?.trim();
  return (configured || DEFAULT_PUBLIC_API_URL).replace(/\/+$/, '');
}

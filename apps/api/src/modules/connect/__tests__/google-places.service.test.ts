/**
 * Tests pour google-places.service.ts — fetchGooglePlacesRating.
 *
 * La fonction appelle l'API Google Places Details via fetch global.
 * On mock `fetch` (global) et le logger. On vérifie :
 *  - retour null si pas d'API key
 *  - retour null si placeId vide
 *  - parsing OK sur une réponse valide
 *  - retour null sur HTTP error
 *  - retour null sur status non-OK
 *  - retour null si pas de rating/avis
 *  - retour null sur erreur réseau (fetch reject)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../shared/logger/pino', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

import { fetchGooglePlacesRating } from '../google-places.service';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function makeErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: vi.fn(),
  } as unknown as Response;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('fetchGooglePlacesRating', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("retourne null si l'API key n'est pas configurée", async () => {
    const result = await fetchGooglePlacesRating('ChIJ1234', undefined);
    expect(result).toBeNull();
  });

  it('retourne null si le placeId est vide', async () => {
    const result = await fetchGooglePlacesRating('', 'test-api-key');
    expect(result).toBeNull();
  });

  it('retourne { rating, reviewCount } sur une réponse valide', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeOkResponse({
        status: 'OK',
        result: { rating: 4.5, user_ratings_total: 128 },
      }),
    );

    const result = await fetchGooglePlacesRating('ChIJ1234', 'test-api-key');

    expect(result).toEqual({ rating: 4.5, reviewCount: 128 });
  });

  it("encode le placeId dans l'URL (encodeURIComponent)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeOkResponse({
        status: 'OK',
        result: { rating: 4.0, user_ratings_total: 10 },
      }),
    );
    globalThis.fetch = fetchMock;

    await fetchGooglePlacesRating('ChIJ abc&def', 'my-key');

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('place_id=ChIJ%20abc%26def');
    expect(url).toContain('key=my-key');
    expect(url).toContain('fields=rating,user_ratings_total');
  });

  it("retourne null si l'API renvoie un HTTP error (500)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeErrorResponse(500));

    const result = await fetchGooglePlacesRating('ChIJ1234', 'test-api-key');
    expect(result).toBeNull();
  });

  it("retourne null si l'API renvoie un status non-OK", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeOkResponse({
        status: 'INVALID_REQUEST',
        error_message: 'Place not found',
      }),
    );

    const result = await fetchGooglePlacesRating('ChIJ1234', 'test-api-key');
    expect(result).toBeNull();
  });

  it("retourne null si le restaurant n'a pas encore d'avis (rating absent)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeOkResponse({
        status: 'OK',
        result: {},
      }),
    );

    const result = await fetchGooglePlacesRating('ChIJ1234', 'test-api-key');
    expect(result).toBeNull();
  });

  it('retourne null si user_ratings_total est absent', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeOkResponse({
        status: 'OK',
        result: { rating: 4.5 },
      }),
    );

    const result = await fetchGooglePlacesRating('ChIJ1234', 'test-api-key');
    expect(result).toBeNull();
  });

  it('retourne null si fetch lève une erreur réseau', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network timeout'));

    const result = await fetchGooglePlacesRating('ChIJ1234', 'test-api-key');
    expect(result).toBeNull();
  });

  it('passe un signal de timeout (AbortSignal) à fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeOkResponse({
        status: 'OK',
        result: { rating: 4.5, user_ratings_total: 128 },
      }),
    );
    globalThis.fetch = fetchMock;

    await fetchGooglePlacesRating('ChIJ1234', 'test-api-key');

    const fetchOptions = fetchMock.mock.calls[0][1] as RequestInit;
    expect(fetchOptions.signal).toBeDefined();
    expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
  });
});

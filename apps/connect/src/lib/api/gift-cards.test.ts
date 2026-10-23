import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout } from '@sokar/shared';
import { listGiftCardPacks } from './gift-cards';
vi.mock('@sokar/shared', () => ({ fetchWithTimeout: vi.fn() }));
afterEach(() => vi.clearAllMocks());
describe('chargement des packs publics', () => {
  it('distingue une erreur API d’une vraie liste vide', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValueOnce(new Response('not found', { status: 404 }));
    await expect(listGiftCardPacks('demo')).rejects.toThrow('Impossible de charger');
    vi.mocked(fetchWithTimeout).mockResolvedValueOnce(Response.json([]));
    await expect(listGiftCardPacks('demo')).resolves.toEqual([]);
  });
});

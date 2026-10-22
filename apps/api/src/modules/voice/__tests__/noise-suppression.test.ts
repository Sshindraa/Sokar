import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startNoiseSuppression } from '../noise-suppression';
import { telnyxFetch } from '../../../shared/telnyx/http-agent';
import { voiceNoiseSuppressionTotal } from '../../../shared/observability/metrics';
import type { CallSession } from '../stream/types';

vi.mock('../../../shared/telnyx/http-agent', () => ({ telnyxFetch: vi.fn() }));
vi.mock('../../../shared/logger/pino', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const session = { restaurantId: 'resto-1', callControlId: 'v3:abc/def' } as CallSession;

beforeEach(() => {
  vi.stubEnv('TELNYX_API_KEY', 'test-only-telnyx-token');
  voiceNoiseSuppressionTotal.reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('suppression de bruit Telnyx', () => {
  it("nettoie l'audio reçu de l'appelant (outbound côté Telnyx) avec Krisp, pour tout restaurant", async () => {
    vi.mocked(telnyxFetch).mockResolvedValue(new Response('{}', { status: 200 }));

    await startNoiseSuppression(session);

    const [path, init] = vi.mocked(telnyxFetch).mock.calls[0];
    expect(path).toBe('/v2/calls/v3%3Aabc%2Fdef/actions/suppression_start');
    expect(JSON.parse(String((init as { body: string }).body))).toEqual({
      direction: 'outbound',
      noise_suppression_engine: 'Krisp',
    });
    const counter = await voiceNoiseSuppressionTotal.get();
    expect(counter.values).toContainEqual(
      expect.objectContaining({ value: 1, labels: { engine: 'Krisp', outcome: 'started' } }),
    );
  });

  it('ne fait rien sans clé Telnyx', async () => {
    vi.stubEnv('TELNYX_API_KEY', '');
    await startNoiseSuppression(session);
    expect(telnyxFetch).not.toHaveBeenCalled();
  });

  it("ne bloque jamais l'appel quand Telnyx refuse ou échoue : l'échec est compté", async () => {
    vi.mocked(telnyxFetch).mockResolvedValueOnce(new Response('beta off', { status: 422 }));
    await expect(startNoiseSuppression(session)).resolves.toBeUndefined();
    vi.mocked(telnyxFetch).mockRejectedValueOnce(new Error('network down'));
    await expect(startNoiseSuppression(session)).resolves.toBeUndefined();
    const outcomes = (await voiceNoiseSuppressionTotal.get()).values.map((v) => v.labels.outcome);
    expect(outcomes.sort()).toEqual(['error', 'rejected']);
  });
});

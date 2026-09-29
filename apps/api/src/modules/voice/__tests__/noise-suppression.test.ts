import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceConfigSchema, voiceConfig, type VoiceConfig } from '../../../env';
import { noiseSuppressionEngineFor, startNoiseSuppression } from '../noise-suppression';
import { telnyxFetch } from '../../../shared/telnyx/http-agent';
import { voiceNoiseSuppressionTotal } from '../../../shared/observability/metrics';
import type { CallSession } from '../stream/types';

vi.mock('../../../shared/telnyx/http-agent', () => ({ telnyxFetch: vi.fn() }));
vi.mock('../../../shared/logger/pino', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const session = { restaurantId: 'resto-1', callControlId: 'v3:abc/def' } as CallSession;
let saved: Partial<VoiceConfig>;

beforeEach(() => {
  saved = {
    VOICE_NOISE_SUPPRESSION_ENGINE: voiceConfig.VOICE_NOISE_SUPPRESSION_ENGINE,
    VOICE_NOISE_SUPPRESSION_RESTAURANT_IDS: voiceConfig.VOICE_NOISE_SUPPRESSION_RESTAURANT_IDS,
  };
  vi.stubEnv('TELNYX_API_KEY', 'test-only-telnyx-token');
  voiceNoiseSuppressionTotal.reset();
});

afterEach(() => {
  Object.assign(voiceConfig, saved);
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const enable = (engine: string, ids = 'resto-1') =>
  Object.assign(voiceConfig, {
    VOICE_NOISE_SUPPRESSION_ENGINE: engine,
    VOICE_NOISE_SUPPRESSION_RESTAURANT_IDS: ids,
  });

describe('suppression de bruit Telnyx', () => {
  it('est désactivée par défaut : aucun appel Telnyx, même pour un restaurant listé', async () => {
    Object.assign(voiceConfig, {
      VOICE_NOISE_SUPPRESSION_ENGINE: 'off',
      VOICE_NOISE_SUPPRESSION_RESTAURANT_IDS: 'resto-1',
    });
    await startNoiseSuppression(session);
    expect(telnyxFetch).not.toHaveBeenCalled();
  });

  it("ne s'applique qu'aux restaurants listés", async () => {
    enable('Krisp', 'autre-resto, encore-un');
    expect(noiseSuppressionEngineFor('resto-1')).toBeNull();
    await startNoiseSuppression(session);
    expect(telnyxFetch).not.toHaveBeenCalled();
    enable('Krisp', 'autre-resto, resto-1');
    expect(noiseSuppressionEngineFor('resto-1')).toBe('Krisp');
  });

  it("nettoie l'audio reçu de l'appelant (outbound côté Telnyx) avec le moteur choisi", async () => {
    enable('AiCoustics');
    vi.mocked(telnyxFetch).mockResolvedValue(new Response('{}', { status: 200 }));

    await startNoiseSuppression(session);

    const [path, init] = vi.mocked(telnyxFetch).mock.calls[0];
    expect(path).toBe('/v2/calls/v3%3Aabc%2Fdef/actions/suppression_start');
    expect(JSON.parse(String((init as { body: string }).body))).toEqual({
      direction: 'outbound',
      noise_suppression_engine: 'AiCoustics',
    });
    const counter = await voiceNoiseSuppressionTotal.get();
    expect(counter.values).toContainEqual(
      expect.objectContaining({ value: 1, labels: { engine: 'AiCoustics', outcome: 'started' } }),
    );
  });

  it("ne bloque jamais l'appel quand Telnyx refuse ou échoue : l'échec est compté", async () => {
    enable('Krisp');
    vi.mocked(telnyxFetch).mockResolvedValueOnce(new Response('beta off', { status: 422 }));
    await expect(startNoiseSuppression(session)).resolves.toBeUndefined();
    vi.mocked(telnyxFetch).mockRejectedValueOnce(new Error('network down'));
    await expect(startNoiseSuppression(session)).resolves.toBeUndefined();
    const outcomes = (await voiceNoiseSuppressionTotal.get()).values.map((v) => v.labels.outcome);
    expect(outcomes.sort()).toEqual(['error', 'rejected']);
  });

  it('une valeur de moteur inconnue équivaut à « off »', () => {
    const parse = (value: unknown) =>
      VoiceConfigSchema.parse({ VOICE_NOISE_SUPPRESSION_ENGINE: value })
        .VOICE_NOISE_SUPPRESSION_ENGINE;
    expect(parse(undefined)).toBe('off');
    expect(parse('Krisp')).toBe('Krisp');
    expect(parse('nimporte-quoi')).toBe('off');
  });
});

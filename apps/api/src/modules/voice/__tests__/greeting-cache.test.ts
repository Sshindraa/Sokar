import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../shared/db/client', () => ({ db: {} }));

vi.mock('../../../shared/logger/pino', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../tts-cache', () => ({
  getTtsCached: vi.fn(),
  setTtsCached: vi.fn(),
}));

import { logger } from '../../../shared/logger/pino';
import { initGreetingCache } from '../stream/greeting-cache';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('initGreetingCache — voix Cartesia manquante', () => {
  it('nomme CARTESIA_VOICE_ID dans l’avertissement quand la voix est vide', async () => {
    vi.stubEnv('VOICE_TTS_PROVIDER', '');
    vi.stubEnv('CARTESIA_API_KEY', 'unit-test-placeholder-credential');
    vi.stubEnv('CARTESIA_VOICE_ID', '');

    await initGreetingCache(['Chez Test']);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('CARTESIA_VOICE_ID'));
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('ELEVENLABS'));
  });
});

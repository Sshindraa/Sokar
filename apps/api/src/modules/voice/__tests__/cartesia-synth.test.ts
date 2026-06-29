import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Cartesia-synth est un module pur qui appelle fetch() — on mock global.fetch.
// Pas de dépendance Redis, pas de DB, pas de Telnyx.

const fakeAudioBuffer = Buffer.from('fake-mp3-audio-bytes');

function mockFetchOk(buffer: Buffer = fakeAudioBuffer): void {
  vi.mocked(global.fetch).mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: async () =>
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    text: async () => '',
  } as Response);
}

function mockFetchFail(status: number, detail: string): void {
  vi.mocked(global.fetch).mockResolvedValue({
    ok: false,
    status,
    text: async () => detail,
  } as Response);
}

describe('cartesia-synth', () => {
  const originalKey = process.env.CARTESIA_API_KEY;
  const originalVoice = process.env.CARTESIA_VOICE_ID;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    global.fetch = vi.fn();
    delete process.env.CARTESIA_API_KEY;
    delete process.env.CARTESIA_VOICE_ID;
  });

  afterEach(() => {
    if (originalKey !== undefined) process.env.CARTESIA_API_KEY = originalKey;
    else delete process.env.CARTESIA_API_KEY;
    if (originalVoice !== undefined) process.env.CARTESIA_VOICE_ID = originalVoice;
    else delete process.env.CARTESIA_VOICE_ID;
  });

  it('retourne null quand CARTESIA_API_KEY est absente (fallback transcript)', async () => {
    const { synthesizeText, isCartesiaConfigured } = await import('../cartesia-synth');
    expect(isCartesiaConfigured()).toBe(false);
    const result = await synthesizeText({ text: 'Bonjour' });
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('synthétise et retourne un Buffer quand la clé est présente (HTTP 200)', async () => {
    process.env.CARTESIA_API_KEY = 'test';
    process.env.CARTESIA_VOICE_ID = 'voice-id-test';
    mockFetchOk();

    const { synthesizeText, isCartesiaConfigured } = await import('../cartesia-synth');
    expect(isCartesiaConfigured()).toBe(true);

    const result = await synthesizeText({ text: 'Bonjour, une table pour quatre.' });
    expect(result).toBeInstanceOf(Buffer);
    expect(result).toEqual(fakeAudioBuffer);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.cartesia.ai/tts/bytes',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-API-Key': 'test',
          'Cartesia-Version': '2026-03-01',
        }),
      }),
    );
  });

  it('utilise DEFAULT_CARTESIA_VOICE_ID quand CARTESIA_VOICE_ID est absente', async () => {
    process.env.CARTESIA_API_KEY = 'test';
    mockFetchOk();

    const { synthesizeText } = await import('../cartesia-synth');
    await synthesizeText({ text: 'Bonjour' });

    const callBody = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as any).body);
    expect(callBody.voice.id).toBe('f786b574-daa5-4673-aa0c-cbe3e8534c02');
  });

  it('permet de surcharger la voiceId via les options', async () => {
    process.env.CARTESIA_API_KEY = 'test';
    mockFetchOk();

    const { synthesizeText } = await import('../cartesia-synth');
    await synthesizeText({ text: 'Bonjour', voiceId: 'custom-voice' });

    const callBody = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as any).body);
    expect(callBody.voice.id).toBe('custom-voice');
  });

  it('inclut speed dans le body quand != 1.0', async () => {
    process.env.CARTESIA_API_KEY = 'test';
    mockFetchOk();

    const { synthesizeText } = await import('../cartesia-synth');
    await synthesizeText({ text: 'Bonjour', speed: 1.3 });

    const callBody = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as any).body);
    expect(callBody.speed).toBe(1.3);
  });

  it('omet speed du body quand = 1.0 (default Cartesia)', async () => {
    process.env.CARTESIA_API_KEY = 'test';
    mockFetchOk();

    const { synthesizeText } = await import('../cartesia-synth');
    await synthesizeText({ text: 'Bonjour', speed: 1.0 });

    const callBody = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as any).body);
    expect(callBody.speed).toBeUndefined();
  });

  it('throw une Error explicite quand Cartesia retourne une erreur HTTP', async () => {
    process.env.CARTESIA_API_KEY = 'test';
    mockFetchFail(503, 'Service Unavailable');

    const { synthesizeText } = await import('../cartesia-synth');
    await expect(synthesizeText({ text: 'Bonjour' })).rejects.toThrow(/Cartesia TTS 503/);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTelnyxStreamConfig, getTelnyxCodec } from '../stream/telnyx-codec';

afterEach(() => vi.unstubAllEnvs());

describe('restaurant-scoped Telnyx codec', () => {
  it('fails closed to PCMA when no restaurant allowlist is set', () => {
    vi.stubEnv('VOICE_TELNYX_CODEC', 'L16');
    vi.stubEnv('VOICE_TELNYX_CODEC_RESTAURANT_IDS', '');

    expect(getTelnyxCodec()).toBe('PCMA');
    expect(getTelnyxCodec('pilot')).toBe('PCMA');
  });

  it('limits L16 to listed restaurants and leaves other calls on PCMA', () => {
    vi.stubEnv('VOICE_TELNYX_CODEC', 'L16');
    vi.stubEnv('VOICE_TELNYX_CODEC_RESTAURANT_IDS', ' pilot-a , pilot-b ');

    expect(getTelnyxCodec('pilot-a')).toBe('L16');
    expect(getTelnyxCodec('other')).toBe('PCMA');
    expect(getTelnyxCodec()).toBe('PCMA');
    expect(buildTelnyxStreamConfig('wss://stream.test', getTelnyxCodec('pilot-a'))).toMatchObject({
      stream_bidirectional_codec: 'L16',
      stream_codec: 'L16',
      stream_bidirectional_sampling_rate: 16000,
    });
    expect(buildTelnyxStreamConfig('wss://stream.test', getTelnyxCodec('other'))).toMatchObject({
      stream_bidirectional_codec: 'PCMA',
    });
  });
});

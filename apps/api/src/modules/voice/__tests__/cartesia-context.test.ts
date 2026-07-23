import { describe, expect, it } from 'vitest';
import type { CallSession } from '../stream/types';
import {
  buildCartesiaContextRequest,
  buildCartesiaWebSocketUrl,
  isCartesiaContextV2Enabled,
} from '../stream/cartesia-context';

function makeSession(codec: 'PCMA' | 'PCMU'): CallSession {
  return { codec } as CallSession;
}

describe('Cartesia context TTS', () => {
  it('builds the documented WebSocket endpoint with an explicit API version', () => {
    expect(buildCartesiaWebSocketUrl()).toBe(
      'wss://api.cartesia.ai/tts/websocket?cartesia_version=2026-03-01',
    );
  });

  it('keeps the generation fields stable for every input in one context', () => {
    expect(
      buildCartesiaContextRequest(
        makeSession('PCMA'),
        'voice-fr',
        'context-1',
        'Très bien. ',
        true,
      ),
    ).toEqual({
      model_id: 'sonic-3.5',
      transcript: 'Très bien. ',
      voice: { mode: 'id', id: 'voice-fr' },
      language: 'fr',
      context_id: 'context-1',
      output_format: { container: 'raw', encoding: 'pcm_alaw', sample_rate: 8000 },
      continue: true,
    });
  });

  it('uses mulaw when the Telnyx call requests PCMU', () => {
    const request = buildCartesiaContextRequest(
      makeSession('PCMU'),
      'voice-fr',
      'context-1',
      '',
      false,
    );
    expect(request.output_format.encoding).toBe('pcm_mulaw');
    expect(request.continue).toBe(false);
  });

  it('stays disabled unless the canary flag is exactly true', () => {
    const original = process.env.VOICE_TTS_CONTEXT_V2_ENABLED;
    process.env.VOICE_TTS_CONTEXT_V2_ENABLED = 'false';
    expect(isCartesiaContextV2Enabled()).toBe(false);
    process.env.VOICE_TTS_CONTEXT_V2_ENABLED = 'true';
    expect(isCartesiaContextV2Enabled()).toBe(true);
    if (original === undefined) delete process.env.VOICE_TTS_CONTEXT_V2_ENABLED;
    else process.env.VOICE_TTS_CONTEXT_V2_ENABLED = original;
  });
});

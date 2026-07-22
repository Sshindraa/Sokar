import { describe, expect, it } from 'vitest';
import { splitTelnyxAudioFrames } from '../stream/audio-frames';
import { TTS_FRAME_BYTES } from '../stream/constants';

describe('splitTelnyxAudioFrames', () => {
  it('splits G.711 into 100 ms Telnyx RTP frames without losing source bytes', () => {
    const audio = Buffer.alloc(TTS_FRAME_BYTES * 2 + 17, 0x55);

    const frames = splitTelnyxAudioFrames(audio);

    expect(frames).toHaveLength(3);
    expect(frames.every((frame) => frame.length === TTS_FRAME_BYTES)).toBe(true);
    expect(Buffer.concat(frames).subarray(0, audio.length)).toEqual(audio);
  });

  it('pads the tail with silence and preserves an empty input', () => {
    const frames = splitTelnyxAudioFrames(Buffer.from([0x01, 0x02]));

    expect(frames[0].subarray(0, 2)).toEqual(Buffer.from([0x01, 0x02]));
    expect(frames[0].subarray(2)).toEqual(Buffer.alloc(TTS_FRAME_BYTES - 2, 0xd5));
    expect(splitTelnyxAudioFrames(Buffer.alloc(0))).toEqual([]);
  });
});

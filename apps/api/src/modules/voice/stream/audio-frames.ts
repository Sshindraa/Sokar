import { TTS_FRAME_BYTES } from './constants';

/**
 * Découpe un flux G.711 8 kHz en trames RTP homogènes pour Telnyx.
 * La dernière trame est complétée avec du silence G.711 : sa durée reste donc
 * toujours cohérente avec le pacing appliqué au WebSocket.
 */
export function splitTelnyxAudioFrames(audio: Buffer, codec: 'PCMA' | 'PCMU' = 'PCMA'): Buffer[] {
  if (audio.length === 0) return [];

  const frames: Buffer[] = [];
  // G.711 does not encode silence as 0x00. The idle samples are codec-specific.
  const silenceByte = codec === 'PCMA' ? 0xd5 : 0xff;
  for (let offset = 0; offset < audio.length; offset += TTS_FRAME_BYTES) {
    const frame = audio.subarray(offset, offset + TTS_FRAME_BYTES);
    frames.push(
      frame.length === TTS_FRAME_BYTES
        ? frame
        : Buffer.concat([frame, Buffer.alloc(TTS_FRAME_BYTES - frame.length, silenceByte)]),
    );
  }
  return frames;
}

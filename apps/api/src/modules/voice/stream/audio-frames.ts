import { padTelnyxFrame, telnyxFrameBytes, type TelnyxCodec } from './telnyx-codec';

/**
 * Découpe un flux audio en trames homogènes pour Telnyx (100 ms).
 * La dernière trame est complétée avec le silence du codec : sa durée reste
 * donc toujours cohérente avec le pacing appliqué au WebSocket.
 * PCMA/PCMU : 800 octets (G.711 8 kHz). L16 : 3200 octets (PCM16 16 kHz).
 */
export function splitTelnyxAudioFrames(audio: Buffer, codec: TelnyxCodec = 'PCMA'): Buffer[] {
  if (audio.length === 0) return [];

  const frames: Buffer[] = [];
  const frameBytes = telnyxFrameBytes(codec);
  for (let offset = 0; offset < audio.length; offset += frameBytes) {
    frames.push(padTelnyxFrame(codec, audio.subarray(offset, offset + frameBytes), frameBytes));
  }
  return frames;
}

import { describe, expect, it } from 'vitest';
import {
  buildTelnyxStreamConfig,
  decodeTelnyxToPcm16,
  encodeTelnyxFromPcm16,
  telnyxFrameBytes,
} from '../stream/telnyx-codec';
import { sttAudioFormatForCodec } from '../stream/stt-bridge';
import { highFrequencyEnergyRatio, L16EndianProbe, WidebandProbe } from '../stream/wideband';

function tone(frequency: number, durationMs = 3000): Buffer {
  const sampleRate = 16000;
  const samples = (sampleRate * durationMs) / 1000;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    pcm.writeInt16LE(
      Math.round(12000 * Math.sin((2 * Math.PI * frequency * i) / sampleRate)),
      i * 2,
    );
  }
  return pcm;
}

describe('Telnyx L16', () => {
  it('préserve le corps PCMA historique et configure les deux sens en L16 16k', () => {
    expect(buildTelnyxStreamConfig('wss://example.test', 'PCMA')).toEqual({
      stream_url: 'wss://example.test',
      stream_track: 'inbound_track',
      stream_bidirectional_mode: 'rtp',
      stream_bidirectional_codec: 'PCMA',
    });
    expect(buildTelnyxStreamConfig('wss://example.test', 'L16')).toMatchObject({
      stream_codec: 'L16',
      stream_bidirectional_codec: 'L16',
      stream_bidirectional_sampling_rate: 16000,
    });
  });

  it('utilise pcm_16000, 3200 octets par 100 ms et convertit le réseau big-endian', () => {
    expect(sttAudioFormatForCodec('L16')).toBe('pcm_16000');
    expect(telnyxFrameBytes('L16')).toBe(3200);
    const pcm = Buffer.from([0x34, 0x12, 0xcd, 0xab]);
    const network = encodeTelnyxFromPcm16('L16', pcm);
    expect(network).toEqual(Buffer.from([0x12, 0x34, 0xab, 0xcd]));
    expect(decodeTelnyxToPcm16('L16', network)).toEqual(pcm);
  });

  it('distingue un signal à 5 kHz d’un signal narrowband à 1 kHz', () => {
    expect(highFrequencyEnergyRatio(tone(1000), 16000)).toBeLessThan(0.0025);
    expect(highFrequencyEnergyRatio(tone(5000), 16000)).toBeGreaterThan(0.0025);
    const probe = new WidebandProbe(16000);
    expect(probe.add(tone(5000, 1000))).toBeNull();
    expect(probe.add(tone(5000, 2000))).toBe(true);
    expect(probe.add(tone(5000, 1000))).toBeNull();
  });

  it('mesure une seule fois les deux RMS sur 500 ms de parole L16', () => {
    const probe = new L16EndianProbe();
    const pcm = tone(1000, 500);
    const network = encodeTelnyxFromPcm16('L16', pcm);
    expect(probe.add(network.subarray(0, 8000))).toBeNull();
    const result = probe.add(network.subarray(8000));
    expect(result?.bigEndianRms).toBeGreaterThan(7000);
    expect(result?.bigEndianRms).toBeLessThan(10000);
    expect(result?.littleEndianRms).toBeGreaterThan(0);
    expect(probe.add(network)).toBeNull();
  });
});

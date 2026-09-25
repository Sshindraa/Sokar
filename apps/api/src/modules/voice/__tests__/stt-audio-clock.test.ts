import { describe, expect, it } from 'vitest';
import { mapSttAudioClock } from '../stream/stt-audio-clock';

describe('STT sent-audio clock', () => {
  it('maps provider offsets with measured wall-clock drift', () => {
    const mapping = mapSttAudioClock({
      connectionAudioStartedAt: 1_000,
      now: 1_700,
      sentBytes: 500 * 8,
      bytesPerMs: 8,
      providerOffsetMs: 450,
    });

    expect(mapping).toEqual({
      receivedAtAudioMs: 500,
      audioClockDriftMs: 200,
      speechEndAt: 1_650,
    });
  });

  it('uses only sent frames when input frames were dropped', () => {
    const mapping = mapSttAudioClock({
      connectionAudioStartedAt: 1_000,
      now: 1_100,
      sentBytes: 4 * 160,
      bytesPerMs: 8,
      providerOffsetMs: 60,
    });

    expect(mapping.receivedAtAudioMs).toBe(80);
    expect(mapping.audioClockDriftMs).toBe(20);
    expect(mapping.speechEndAt).toBe(1_080);
  });

  it('does not map a provider offset into the future of the sent audio clock', () => {
    const mapping = mapSttAudioClock({
      connectionAudioStartedAt: 1_000,
      now: 1_100,
      sentBytes: 80 * 8,
      bytesPerMs: 8,
      providerOffsetMs: 120,
    });

    expect(mapping.speechEndAt).toBe(1_100);
  });

  it('does not map a negative offset before the audio stream starts', () => {
    const mapping = mapSttAudioClock({
      connectionAudioStartedAt: 1_000,
      now: 1_050,
      sentBytes: 800,
      bytesPerMs: 8,
      providerOffsetMs: 10,
    });

    expect(mapping.speechEndAt).toBe(1_000);
  });
});

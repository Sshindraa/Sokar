export interface SttAudioClockSample {
  connectionAudioStartedAt: number;
  now: number;
  sentBytes: number;
  bytesPerMs: number;
  providerOffsetMs?: number;
}

export interface SttAudioClockMapping {
  receivedAtAudioMs: number;
  audioClockDriftMs: number;
  speechEndAt?: number;
}

/** Maps provider offsets against audio accepted by the socket, not socket-open time alone. */
export function mapSttAudioClock(sample: SttAudioClockSample): SttAudioClockMapping {
  const bytesPerMs =
    Number.isFinite(sample.bytesPerMs) && sample.bytesPerMs > 0 ? sample.bytesPerMs : 1;
  const receivedAtAudioMs = Math.max(0, sample.sentBytes) / bytesPerMs;
  const elapsedWallMs = sample.now - sample.connectionAudioStartedAt;
  const audioClockDriftMs = elapsedWallMs - receivedAtAudioMs;
  if (sample.providerOffsetMs === undefined || !Number.isFinite(sample.providerOffsetMs)) {
    return { receivedAtAudioMs, audioClockDriftMs };
  }

  const providerOffsetMs = Math.min(receivedAtAudioMs, Math.max(0, sample.providerOffsetMs));
  const speechEndAt = Math.min(
    sample.now,
    Math.max(
      sample.connectionAudioStartedAt,
      sample.connectionAudioStartedAt + providerOffsetMs + audioClockDriftMs,
    ),
  );
  return { receivedAtAudioMs, audioClockDriftMs, speechEndAt };
}

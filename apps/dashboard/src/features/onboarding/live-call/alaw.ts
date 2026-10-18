// ─── G.711 A-law ────────────────────────────────────────────────
// Le pipeline vocal de Sokar parle en A-law 8 kHz comme un appel téléphonique réel (PCMA) :
// la démonstration en direct restitue donc la qualité qu'un client entendra vraiment.
// Implémentation de référence ITU-T G.711 (même table de segments que la libsndfile / Sun).

const SEGMENT_END = [0x1f, 0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff] as const;

/** Octet A-law de silence (échantillon 0). */
export const ALAW_SILENCE = 0xd5;

/** Encode un échantillon PCM 16 bits signé en un octet A-law. */
export function encodeAlawSample(pcm: number): number {
  let value = pcm >> 3; // 16 bits → 13 bits
  let mask: number;
  if (value >= 0) {
    mask = 0xd5;
  } else {
    mask = 0x55;
    value = -value - 1;
  }

  let segment = 0;
  while (segment < 8 && value > SEGMENT_END[segment]) segment++;
  if (segment >= 8) return 0x7f ^ mask;

  let encoded = segment << 4;
  encoded |= segment < 2 ? (value >> 1) & 0x0f : (value >> segment) & 0x0f;
  return encoded ^ mask;
}

/** Décode un octet A-law en échantillon PCM 16 bits signé. */
export function decodeAlawSample(alaw: number): number {
  const value = alaw ^ 0x55;
  let magnitude = (value & 0x0f) << 4;
  const segment = (value & 0x70) >> 4;
  if (segment === 0) {
    magnitude += 8;
  } else if (segment === 1) {
    magnitude += 0x108;
  } else {
    magnitude += 0x108;
    magnitude <<= segment - 1;
  }
  return value & 0x80 ? magnitude : -magnitude;
}

/** Float32 [-1, 1] → octets A-law. Les valeurs hors plage sont écrêtées. */
export function encodeAlaw(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    out[i] = encodeAlawSample(Math.round(clamped * 32767));
  }
  return out;
}

/** Octets A-law → Float32 [-1, 1]. */
export function decodeAlaw(bytes: Uint8Array): Float32Array {
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = decodeAlawSample(bytes[i]) / 32768;
  return out;
}

import { z } from 'zod';

/**
 * Profils codec Telnyx Media Stream.
 *
 * La prod utilise PCMA (G.711 A-law, 8 kHz). `VOICE_TELNYX_CODEC=L16` bascule
 * sur le PCM linéaire 16 bits 16 kHz, ce qui supprime la quantification G.711
 * et double la bande passante côté STT.
 *
 * L16 sur Telnyx = PCM signé 16 bits, 16 kHz, **big-endian** (convention RTP
 * L16, RFC 3551). Telnyx ne documente pas l'endianness explicitement ; c'est
 * l'hypothèse à confirmer par l'appel de test staging. Une seule constante
 * (`TELNYX_L16_BIG_ENDIAN`) porte ce choix.
 */

export type TelnyxCodec = 'PCMA' | 'PCMU' | 'L16';
/** Codecs autorisés par le flag de production (`VOICE_TELNYX_CODEC`). */
export type TelnyxStreamCodec = 'PCMA' | 'L16';

export const TELNYX_STREAM_CODECS = ['PCMA', 'L16'] as const;

export const TELNYX_L16_BIG_ENDIAN = true;

export interface TelnyxCodecProfile {
  codec: TelnyxCodec;
  sampleRate: 8000 | 16000;
  bytesPerSample: 1 | 2;
  cartesiaEncoding: 'pcm_alaw' | 'pcm_mulaw' | 'pcm_s16le';
  /** Étiquette de cache/telemetry (`alaw8k`, `mulaw8k`, `pcm16k`). */
  label: string;
  /** Octet de remplissage d'une trame incomplète ; `null` = zéro (L16). */
  idleByte: number | null;
  /** `true` si le codec conserve les fréquences au-dessus de 4 kHz. */
  wideband: boolean;
}

const PROFILES: Record<TelnyxCodec, TelnyxCodecProfile> = {
  PCMA: {
    codec: 'PCMA',
    sampleRate: 8000,
    bytesPerSample: 1,
    cartesiaEncoding: 'pcm_alaw',
    label: 'alaw8k',
    idleByte: 0xd5,
    wideband: false,
  },
  PCMU: {
    codec: 'PCMU',
    sampleRate: 8000,
    bytesPerSample: 1,
    cartesiaEncoding: 'pcm_mulaw',
    label: 'mulaw8k',
    idleByte: 0xff,
    wideband: false,
  },
  L16: {
    codec: 'L16',
    sampleRate: 16000,
    bytesPerSample: 2,
    cartesiaEncoding: 'pcm_s16le',
    label: 'pcm16k',
    idleByte: null,
    wideband: true,
  },
};

export function telnyxCodecProfile(codec: TelnyxCodec): TelnyxCodecProfile {
  return PROFILES[codec];
}

/** Durée d'une trame Telnyx envoyée par le pipeline TTS (100 ms). */
export const TELNYX_FRAME_DURATION_MS = 100;

/** Octets par trame TTS sortante selon le codec (PCMA/PCMU : 800, L16 : 3200). */
export function telnyxFrameBytes(codec: TelnyxCodec): number {
  const profile = PROFILES[codec];
  return (TELNYX_FRAME_DURATION_MS / 1000) * profile.sampleRate * profile.bytesPerSample;
}

/** Octets par milliseconde d'audio (PCMA/PCMU : 8, L16 : 32). */
export function telnyxBytesPerMs(codec: TelnyxCodec): number {
  const profile = PROFILES[codec];
  return (profile.sampleRate / 1000) * profile.bytesPerSample;
}

/**
 * Valeur runtime du codec Telnyx. Le démarrage a validé la variable : une
 * valeur inattendue retombe sur PCMA plutôt que d'envoyer un format inconnu à
 * Telnyx pendant un appel.
 */
export function getTelnyxCodec(): TelnyxStreamCodec {
  const raw = process.env.VOICE_TELNYX_CODEC?.trim().toUpperCase();
  return raw === 'L16' ? 'L16' : 'PCMA';
}

export const telnyxCodecSchema = z.enum(TELNYX_STREAM_CODECS).default('PCMA');

/** Corps envoyé à l'API Telnyx (`actions/answer`) pour démarrer le stream. */
export interface TelnyxStreamConfig {
  stream_url: string;
  stream_track: 'inbound_track';
  stream_bidirectional_mode: 'rtp';
  stream_bidirectional_codec: TelnyxCodec;
  /** Codec du flux entrant ; posé seulement en L16. */
  stream_codec?: TelnyxCodec;
  /** Taux du flux bidirectionnel ; posé seulement en L16 (16 kHz). */
  stream_bidirectional_sampling_rate?: 16000;
}

/**
 * Construit la configuration de stream Telnyx.
 * En PCMA (défaut) la requête reste strictement celle d'aujourd'hui : ni
 * `stream_codec` ni `stream_bidirectional_sampling_rate`. En L16, les deux
 * directions passent en 16 kHz.
 */
export function buildTelnyxStreamConfig(
  streamUrl: string,
  codec: TelnyxCodec = getTelnyxCodec(),
): TelnyxStreamConfig {
  const base: TelnyxStreamConfig = {
    stream_url: streamUrl,
    stream_track: 'inbound_track',
    stream_bidirectional_mode: 'rtp',
    stream_bidirectional_codec: codec,
  };
  if (codec !== 'L16') return base;
  return {
    ...base,
    stream_codec: 'L16',
    stream_bidirectional_sampling_rate: 16000,
  };
}

/** Échange les octets d'un PCM16 (big-endian ⇄ little-endian). */
export function swapBytes16(input: Buffer): Buffer {
  const output = Buffer.from(input);
  for (let index = 0; index + 1 < output.length; index += 2) {
    const first = output[index];
    output[index] = output[index + 1];
    output[index + 1] = first;
  }
  return output;
}

/** Décodage A-law → PCM16, identique à `toPcm16FromAlaw` historique. */
export function alawToPcm16(input: Buffer): Buffer {
  const output = Buffer.allocUnsafe(input.length * 2);
  for (let index = 0; index < input.length; index++) {
    const alaw = input[index] ^ 0x55;
    let sample = (alaw & 0x0f) << 4;
    const segment = (alaw & 0x70) >> 4;
    if (segment === 0) sample += 8;
    else if (segment === 1) sample += 0x108;
    else sample = (sample + 0x108) << (segment - 1);
    output.writeInt16LE(alaw & 0x80 ? sample : -sample, index * 2);
  }
  return output;
}

/**
 * Audio entrant Telnyx → PCM16 little-endian, tel qu'attendu par Scribe.
 * PCMA : décodage A-law. PCMU : octets µ-law passés tels quels (`ulaw_8000`).
 * L16 : échange d'octets si Telnyx émet en big-endian.
 */
export function decodeTelnyxToPcm16(codec: TelnyxCodec, input: Buffer): Buffer {
  if (codec === 'PCMA') return alawToPcm16(input);
  if (codec === 'L16') return TELNYX_L16_BIG_ENDIAN ? swapBytes16(input) : input;
  return input;
}

/** Trame sortante : PCM16 little-endian → format attendu par Telnyx. */
export function encodeTelnyxFromPcm16(codec: TelnyxCodec, pcmLe: Buffer): Buffer {
  if (codec !== 'L16') return pcmLe;
  return TELNYX_L16_BIG_ENDIAN ? swapBytes16(pcmLe) : pcmLe;
}

/** Remplit une trame incomplète avec le silence du codec. */
export function padTelnyxFrame(codec: TelnyxCodec, frame: Buffer, size: number): Buffer {
  if (frame.length === size) return frame;
  const idle = PROFILES[codec].idleByte;
  const filler =
    idle === null ? Buffer.alloc(size - frame.length) : Buffer.alloc(size - frame.length, idle);
  return Buffer.concat([frame, filler]);
}

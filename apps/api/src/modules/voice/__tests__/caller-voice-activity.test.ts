import { describe, expect, it } from 'vitest';
import type { CallSession } from '../stream/types';
import { callerSilenceMs, chunkRms, trackCallerVoice } from '../stream/caller-voice-activity';
import { encodeTelnyxFromPcm16 } from '../stream/telnyx-codec';

const session = (): CallSession => ({ codec: 'L16' }) as unknown as CallSession;

/** 20 ms d'un signal carré d'amplitude donnée, au format de l'audio Telnyx (L16). */
function frame(amplitude: number): Buffer {
  const pcm = Buffer.alloc(160 * 2);
  for (let index = 0; index < 160; index++)
    pcm.writeInt16LE(index % 2 ? amplitude : -amplitude, index * 2);
  return encodeTelnyxFromPcm16('L16', pcm);
}

describe('chunkRms', () => {
  it('mesure le niveau efficace, 0 pour du vide', () => {
    const square = Buffer.alloc(8);
    [1000, -1000, 1000, -1000].forEach((value, index) => square.writeInt16LE(value, index * 2));
    expect(chunkRms(square)).toBe(1000);
    expect(chunkRms(Buffer.alloc(0))).toBe(0);
  });
});

describe('trackCallerVoice / callerSilenceMs', () => {
  it('ne connaît aucune durée de silence tant que personne n’a parlé', () => {
    const s = session();
    trackCallerVoice(s, frame(0), 1_000);
    expect(callerSilenceMs(s, 5_000)).toBe(Number.POSITIVE_INFINITY);
  });

  it('compte le silence depuis la dernière trame de voix', () => {
    const s = session();
    trackCallerVoice(s, frame(3_000), 1_000);
    trackCallerVoice(s, frame(3_000), 1_020);
    trackCallerVoice(s, frame(0), 1_040);
    expect(callerSilenceMs(s, 1_400)).toBe(380);
  });

  it('ignore une trame isolée (clic, souffle)', () => {
    const s = session();
    trackCallerVoice(s, frame(3_000), 1_000);
    trackCallerVoice(s, frame(0), 1_020);
    trackCallerVoice(s, frame(3_000), 1_040);
    trackCallerVoice(s, frame(0), 1_060);
    expect(callerSilenceMs(s, 2_000)).toBe(Number.POSITIVE_INFINITY);
  });

  it('ne prend pas un bruit de ligne faible pour de la voix', () => {
    const s = session();
    for (let index = 0; index < 50; index++) trackCallerVoice(s, frame(150), 1_000 + index * 20);
    expect(callerSilenceMs(s, 3_000)).toBe(Number.POSITIVE_INFINITY);
  });

  it('relève son seuil sous un bruit de fond soutenu, sans perdre la voix qui le dépasse', () => {
    const s = session();
    for (let index = 0; index < 400; index++) trackCallerVoice(s, frame(280), 1_000 + index * 20);
    expect(callerSilenceMs(s, 9_500)).toBe(Number.POSITIVE_INFINITY);
    trackCallerVoice(s, frame(4_000), 10_000);
    trackCallerVoice(s, frame(4_000), 10_020);
    expect(callerSilenceMs(s, 10_100)).toBe(80);
  });
});

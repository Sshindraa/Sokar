import { describe, expect, it } from 'vitest';
import type { CallSession } from '../stream/types';
import {
  callerSilenceMs,
  callerSpokeClearlySince,
  callerVoiceMarginMs,
  chunkRms,
  noCallerVoiceSince,
  trackCallerVoice,
} from '../stream/caller-voice-activity';
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

describe('parole claire (preuve audio contre l’écho)', () => {
  // Une trame de ce fichier dure 10 ms (160 échantillons L16 à 16 kHz).
  it('exige un niveau fort tenu au moins 160 ms : un bruit moyen ou un pic bref ne compte pas', () => {
    const s = session();
    for (let index = 0; index < 40; index++) trackCallerVoice(s, frame(600), 1_000 + index * 10);
    expect(callerSpokeClearlySince(s, 0)).toBe(false);
    for (let index = 0; index < 15; index++) trackCallerVoice(s, frame(3_000), 2_000 + index * 10);
    expect(callerSpokeClearlySince(s, 0)).toBe(false);
    trackCallerVoice(s, frame(3_000), 2_150);
    expect(callerSpokeClearlySince(s, 0)).toBe(true);
  });

  it('se souvient du dernier instant de parole claire, et une trame faible coupe la série', () => {
    const s = session();
    for (let index = 0; index < 20; index++) trackCallerVoice(s, frame(3_000), 5_000 + index * 10);
    expect(callerSpokeClearlySince(s, 5_100)).toBe(true);
    expect(callerSpokeClearlySince(s, 6_000)).toBe(false);
    trackCallerVoice(s, frame(0), 5_300);
    for (let index = 0; index < 10; index++) trackCallerVoice(s, frame(3_000), 6_000 + index * 10);
    expect(callerSpokeClearlySince(s, 6_000)).toBe(false);
  });
});

describe('absence de voix pour une transcription (noCallerVoiceSince)', () => {
  it('ne juge pas tant que l’audio n’est pas suivi : seul un silence constaté disqualifie', () => {
    expect(noCallerVoiceSince(session(), 0)).toBe(false);
  });

  it('ne juge pas sur quelques millisecondes d’audio : ce n’est pas un silence constaté', () => {
    const s = session();
    for (let index = 0; index < 5; index++) trackCallerVoice(s, frame(0), 1_000 + index * 10);
    expect(noCallerVoiceSince(s, 0)).toBe(false);
  });

  it('constate l’absence de voix quand l’audio suivi n’en contient pas', () => {
    const s = session();
    for (let index = 0; index < 50; index++) trackCallerVoice(s, frame(40), 1_000 + index * 20);
    expect(noCallerVoiceSince(s, 0)).toBe(true);
  });

  it('constate la voix quand elle date de l’énoncé en cours', () => {
    const s = session();
    trackCallerVoice(s, frame(3_000), 5_000);
    trackCallerVoice(s, frame(3_000), 5_020);
    expect(noCallerVoiceSince(s, 4_000)).toBe(false);
  });

  it('ne compte pas une voix antérieure à l’énoncé en cours', () => {
    const s = session();
    trackCallerVoice(s, frame(3_000), 1_000);
    trackCallerVoice(s, frame(3_000), 1_020);
    for (let index = 0; index < 60; index++) trackCallerVoice(s, frame(0), 1_040 + index * 10);
    expect(noCallerVoiceSince(s, 5_000)).toBe(true);
  });
});

describe('marge de la voix sur l’instant de référence (callerVoiceMarginMs)', () => {
  it('ne juge pas sans assez d’audio suivi', () => {
    expect(callerVoiceMarginMs(session(), 0)).toBeUndefined();
    const s = session();
    for (let index = 0; index < 5; index++) trackCallerVoice(s, frame(3_000), 1_000 + index * 10);
    expect(callerVoiceMarginMs(s, 0)).toBeUndefined();
  });

  it('rend moins l’infini quand aucune voix n’a jamais été reçue', () => {
    const s = session();
    for (let index = 0; index < 60; index++) trackCallerVoice(s, frame(0), 1_000 + index * 10);
    expect(callerVoiceMarginMs(s, 0)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('rend l’avance (positive) ou le retard (négatif) de la dernière voix sur l’instant donné', () => {
    const s = session();
    trackCallerVoice(s, frame(3_000), 5_000);
    trackCallerVoice(s, frame(3_000), 5_020);
    for (let index = 0; index < 60; index++) trackCallerVoice(s, frame(0), 5_040 + index * 10);
    expect(callerVoiceMarginMs(s, 4_000)).toBe(1_020);
    expect(callerVoiceMarginMs(s, 5_500)).toBe(-480);
  });
});

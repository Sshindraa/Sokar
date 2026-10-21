import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

vi.mock('../../../shared/logger/pino', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../shared/redis/client', () => ({
  redisCache: { getBuffer: vi.fn(async () => null), set: vi.fn(async () => 'OK') },
}));

import { logger } from '../../../shared/logger/pino';
import { markVoiceTurnAudioSent, startVoiceTurn } from '../stream/turn-telemetry';
import type { CallSession } from '../stream/types';
import {
  __setVoiceFillerAudioForTests,
  VOICE_FILLER_BANK,
  chooseVoiceFiller,
  createTurnFiller,
  isVoiceFillerEnabled,
  trimVoiceFillerAudio,
  voiceFillerCallState,
  voiceFillerDelayMs,
  voiceFillerTexts,
  waitForVoiceFiller,
  type VoiceFillerChoiceInput,
} from '../stream/voice-filler';

const ENV = { VOICE_FILLER_RESTAURANT_IDS: 'resto-1' } as NodeJS.ProcessEnv;
/** Trois trames Telnyx (300 ms) de son A-law non silencieux. */
const CLIP_AUDIO = Buffer.alloc(2_400, 0x2a);

function choiceInput(overrides: Partial<VoiceFillerChoiceInput> = {}): VoiceFillerChoiceInput {
  return {
    style: 'CASUAL',
    action: 'check_availability',
    replyQueued: false,
    transcript: 'on serait quatre vers vingt heures',
    lastAwaiting: 'time',
    callerSilenceMs: 800,
    call: { played: 0 },
    maxPerCall: 4,
    isCached: () => true,
    random: () => 0,
    ...overrides,
  };
}

function makeSession(): {
  session: CallSession;
  sent: Array<{ event: string }>;
} {
  const sent: Array<{ event: string }> = [];
  const session = {
    callControlId: 'call-filler',
    restaurantId: 'resto-1',
    codec: 'PCMA',
    ended: false,
    state: 'PROCESSING',
    ttsGeneration: 1,
    turnCount: 3,
    currentTurn: null,
    conversation: { intent: 'reservation' },
    personality: { fillerStyle: 'CASUAL' },
    telnyxWs: {
      readyState: WebSocket.OPEN,
      send: (payload: string) => sent.push(JSON.parse(payload) as { event: string }),
    },
  } as unknown as CallSession;
  startVoiceTurn(session, 'on serait quatre');
  return { session, sent };
}

function loggedEvents(): Array<Record<string, unknown>> {
  return vi
    .mocked(logger.info)
    .mock.calls.map(([payload]) => (payload as { voiceTurn?: Record<string, unknown> }).voiceTurn)
    .filter((turn): turn is Record<string, unknown> => Boolean(turn));
}

const media = (sent: Array<{ event: string }>) => sent.filter((m) => m.event === 'media').length;

function cacheWholeBank(audio: Buffer | null): void {
  for (const text of voiceFillerTexts()) __setVoiceFillerAudioForTests(text, 'PCMA', audio);
}

describe('voice filler : réglage', () => {
  it('vide = aucun restaurant ; `*` = tous', () => {
    expect(isVoiceFillerEnabled('resto-1', {} as NodeJS.ProcessEnv)).toBe(false);
    expect(isVoiceFillerEnabled('resto-1', ENV)).toBe(true);
    expect(isVoiceFillerEnabled('resto-2', ENV)).toBe(false);
    expect(
      isVoiceFillerEnabled('resto-2', { VOICE_FILLER_RESTAURANT_IDS: '*' } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it('délai par défaut 750 ms, borné', () => {
    expect(voiceFillerDelayMs({} as NodeJS.ProcessEnv)).toBe(750);
    expect(voiceFillerDelayMs({ VOICE_FILLER_DELAY_MS: '900' } as NodeJS.ProcessEnv)).toBe(900);
    expect(voiceFillerDelayMs({ VOICE_FILLER_DELAY_MS: '50' } as NodeJS.ProcessEnv)).toBe(750);
  });

  it('réglage vide : aucun son, comportement actuel', () => {
    const { session } = makeSession();
    const signal = new AbortController().signal;
    const options = { transcript: 'bonjour', lastAwaiting: 'open', turnId: 't', signal };
    expect(
      createTurnFiller(session, 'elevenlabs', { ...options, env: {} as NodeJS.ProcessEnv }),
    ).toBeNull();
    // Hors ElevenLabs Dialogue, ou relance après silence : jamais.
    expect(createTurnFiller(session, 'cartesia', { ...options, env: ENV })).toBeNull();
    expect(createTurnFiller(session, null, { ...options, env: ENV })).toBeNull();
    expect(
      createTurnFiller(session, 'elevenlabs', { ...options, env: ENV, callerFinished: true }),
    ).toBeNull();
  });
});

describe('voice filler : banque', () => {
  it('seulement la vérification et l’enregistrement, par ton', () => {
    for (const purposes of Object.values(VOICE_FILLER_BANK)) {
      expect(Object.keys(purposes).sort()).toEqual(['booking', 'lookup']);
      expect(purposes.lookup.length).toBeGreaterThanOrEqual(2);
      expect(purposes.booking.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('annonce l’action sans recouper la réponse : ni accusé de réception, ni résultat, vouvoiement', () => {
    for (const purposes of Object.values(VOICE_FILLER_BANK)) {
      for (const clip of Object.values(purposes).flat()) {
        expect(clip.text).not.toMatch(/\b(hmm|mmh|d'accord|très bien|alors|ok|bien sûr)\b/i);
        expect(clip.text).not.toMatch(/\bnot[eé]\b|je (vous )?note|réservé|c'est fait/i);
        expect(clip.text).not.toMatch(/\b(tu|te|toi|ton|ta|tes)\b/i);
      }
    }
  });
});

describe('voice filler : choix du son', () => {
  it('« je regarde » pour une vérification, « j’enregistre » pour une réservation', () => {
    expect(chooseVoiceFiller(choiceInput())).toMatchObject({ purpose: 'lookup' });
    expect(chooseVoiceFiller(choiceInput({ action: 'create_reservation' }))).toMatchObject({
      purpose: 'booking',
    });
  });

  it('suit le ton du restaurant', () => {
    const choice = chooseVoiceFiller(choiceInput({ style: 'FORMAL' }));
    expect(VOICE_FILLER_BANK.FORMAL.lookup).toContain('clip' in choice ? choice.clip : null);
  });

  it('rien pendant une épellation de nom', () => {
    expect(chooseVoiceFiller(choiceInput({ lastAwaiting: 'customerName' }))).toEqual({
      skip: 'spelling',
    });
    expect(chooseVoiceFiller(choiceInput({ transcript: 'h o u e t' }))).toEqual({
      skip: 'spelling',
    });
  });

  it("rien quand l'appelant parle encore, ni quand la réponse est déjà partie", () => {
    expect(chooseVoiceFiller(choiceInput({ callerSilenceMs: 120 }))).toEqual({
      skip: 'caller_speaking',
    });
    expect(chooseVoiceFiller(choiceInput({ replyQueued: true }))).toEqual({ skip: 'reply_ready' });
  });

  it('jamais deux fois de suite la même formule', () => {
    for (const purposes of Object.values(VOICE_FILLER_BANK)) {
      for (const clip of Object.values(purposes).flat()) {
        for (const random of [() => 0, () => 0.99]) {
          const choice = chooseVoiceFiller(
            choiceInput({ call: { played: 1, lastClipText: clip.text }, random }),
          );
          expect('clip' in choice && choice.clip.text).not.toBe(clip.text);
        }
      }
    }
  });

  it('plafond par appel ; son absent du cache : rien', () => {
    expect(chooseVoiceFiller(choiceInput({ call: { played: 4 } }))).toEqual({ skip: 'cap' });
    expect(chooseVoiceFiller(choiceInput({ isCached: () => false }))).toEqual({
      skip: 'not_cached',
    });
  });
});

describe('voice filler : coupe du son', () => {
  it('coupe le silence de tête et de traîne', () => {
    const silence = Buffer.alloc(800, 0xd5);
    const voice = Buffer.alloc(800, 0x2a);
    const trimmed = trimVoiceFillerAudio(Buffer.concat([silence, voice, silence]), 'PCMA');
    expect(trimmed.length).toBeGreaterThanOrEqual(800);
    expect(trimmed.length).toBeLessThanOrEqual(800 + 160);
    expect(trimVoiceFillerAudio(silence, 'PCMA').length).toBe(0);
  });
});

describe('voice filler : déclenchement et interruption', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    cacheWholeBank(CLIP_AUDIO);
  });
  afterEach(() => {
    vi.useRealTimers();
    cacheWholeBank(null);
  });

  function arm(session: CallSession, signal = new AbortController().signal) {
    session.latencyTrace!.speechEndAt = Date.now();
    const filler = createTurnFiller(session, 'elevenlabs', {
      transcript: 'on serait quatre vers vingt heures',
      lastAwaiting: 'time',
      turnId: session.currentTurn?.id,
      signal,
      env: ENV,
      random: () => 0,
    });
    expect(filler).not.toBeNull();
    return filler!;
  }

  it('aucun son sans vérification ni enregistrement, même si la réponse tarde', async () => {
    const { session, sent } = makeSession();
    const filler = arm(session);
    await vi.advanceTimersByTimeAsync(3_000);
    filler.replyQueued();
    expect(sent).toHaveLength(0);
  });

  it('vérification lancée après le délai : le son part tout de suite', async () => {
    const { session, sent } = makeSession();
    const filler = arm(session);
    await vi.advanceTimersByTimeAsync(1_200);
    filler.expectLongWait('check_availability');
    expect(media(sent)).toBe(1);
    await vi.advanceTimersByTimeAsync(400);
    expect(media(sent)).toBe(3);
    expect(loggedEvents().find((e) => e.event === 'filler_started')).toMatchObject({
      purpose: 'lookup',
    });
    expect(loggedEvents().some((e) => e.event === 'filler_completed')).toBe(true);
    expect(session.latencyTrace?.firstAudioIsFiller).toBe(true);
  });

  it('action lancée avant le délai : le son attend le délai, et rien si la réponse part avant', async () => {
    const { session, sent } = makeSession();
    const filler = arm(session);
    await vi.advanceTimersByTimeAsync(300);
    filler.expectLongWait('create_reservation');
    await vi.advanceTimersByTimeAsync(400);
    expect(media(sent)).toBe(0);
    await vi.advanceTimersByTimeAsync(60);
    expect(media(sent)).toBe(1);

    const other = makeSession();
    const quick = arm(other.session);
    quick.expectLongWait('check_availability');
    await vi.advanceTimersByTimeAsync(500);
    quick.replyQueued();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(media(other.sent)).toBe(0);
  });

  it('un seul son par tour', async () => {
    const { session, sent } = makeSession();
    const filler = arm(session);
    await vi.advanceTimersByTimeAsync(1_000);
    filler.expectLongWait('check_availability');
    filler.expectLongWait('create_reservation');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(media(sent)).toBe(3);
  });

  it('la vraie réponse attend la fin du son, et son premier son est mesuré à part', async () => {
    const { session } = makeSession();
    const filler = arm(session);
    await vi.advanceTimersByTimeAsync(1_000);
    filler.expectLongWait('check_availability');
    filler.replyQueued();
    let released = false;
    const release = waitForVoiceFiller(session).then(() => {
      released = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(released).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    await release;
    expect(released).toBe(true);
    markVoiceTurnAudioSent(session, { ttsPath: 'elevenlabs_dialogue', isFiller: false });
    expect(session.latencyTrace?.endOfSpeechToReplyAudioMs).toBeGreaterThanOrEqual(1_300);
    expect(loggedEvents().some((e) => e.event === 'reply_first_audio')).toBe(true);
  });

  it('barge-in : le son s’arrête net et Telnyx est vidé', async () => {
    const { session, sent } = makeSession();
    const filler = arm(session);
    await vi.advanceTimersByTimeAsync(1_000);
    filler.expectLongWait('check_availability');
    session.ttsGeneration++;
    await vi.advanceTimersByTimeAsync(500);
    expect(media(sent)).toBe(1);
    expect(sent.at(-1)).toEqual({ event: 'clear' });
    expect(loggedEvents().find((e) => e.event === 'filler_interrupted')).toMatchObject({
      reason: 'barge_in',
    });
  });

  it("l'appelant reprend la parole pendant le son : coupé", async () => {
    const { session, sent } = makeSession();
    const filler = arm(session);
    await vi.advanceTimersByTimeAsync(1_000);
    filler.expectLongWait('check_availability');
    session.callerVoice = { noiseFloor: 0, voiceRun: 3, lastClearVoiceAt: Date.now() };
    await vi.advanceTimersByTimeAsync(500);
    expect(sent.at(-1)).toEqual({ event: 'clear' });
    expect(loggedEvents().find((e) => e.event === 'filler_interrupted')).toMatchObject({
      reason: 'caller_voice',
    });
  });

  it('sur un appel : jamais deux fois de suite la même formule, plafond respecté', async () => {
    const { session } = makeSession();
    const played: unknown[] = [];
    for (let turn = 0; turn < 8; turn++) {
      startVoiceTurn(session, 'tour');
      const filler = arm(session);
      await vi.advanceTimersByTimeAsync(1_000);
      filler.expectLongWait(turn % 2 ? 'create_reservation' : 'check_availability');
      await vi.advanceTimersByTimeAsync(1_000);
      const started = loggedEvents().filter((e) => e.event === 'filler_started');
      played.splice(0, played.length, ...started.map((e) => e.clip));
    }
    expect(played).toHaveLength(4);
    for (let index = 1; index < played.length; index++) {
      expect(played[index]).not.toBe(played[index - 1]);
    }
    expect(voiceFillerCallState(session).played).toBe(4);
  });
});

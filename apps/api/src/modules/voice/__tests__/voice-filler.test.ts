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
  withoutRepeatedInterjection,
  type VoiceFillerChoiceInput,
} from '../stream/voice-filler';

const ENV = { VOICE_FILLER_RESTAURANT_IDS: 'resto-1' } as NodeJS.ProcessEnv;
/** Trois trames Telnyx (300 ms) de son A-law non silencieux. */
const CLIP_AUDIO = Buffer.alloc(2_400, 0x2a);

function choiceInput(overrides: Partial<VoiceFillerChoiceInput> = {}): VoiceFillerChoiceInput {
  return {
    style: 'CASUAL',
    action: null,
    turnComplete: null,
    replyQueued: false,
    transcript: 'je voudrais réserver samedi soir',
    lastAwaiting: 'open',
    callerSilenceMs: 800,
    turnNumber: 3,
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
  startVoiceTurn(session, 'je voudrais réserver');
  return { session, sent };
}

function loggedEvents(): Array<Record<string, unknown>> {
  return vi
    .mocked(logger.info)
    .mock.calls.map(([payload]) => (payload as { voiceTurn?: Record<string, unknown> }).voiceTurn)
    .filter((turn): turn is Record<string, unknown> => Boolean(turn));
}

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
  it('8 à 15 variantes par ton, vouvoiement partout', () => {
    for (const purposes of Object.values(VOICE_FILLER_BANK)) {
      const clips = Object.values(purposes).flat();
      expect(clips.length).toBeGreaterThanOrEqual(8);
      expect(clips.length).toBeLessThanOrEqual(15);
      for (const clip of clips) {
        expect(clip.text).not.toMatch(/\b(tu|te|toi|ton|ta|tes)\b/i);
        expect(clip.text.length).toBeLessThanOrEqual(30);
      }
    }
  });
});

describe('voice filler : choix du son', () => {
  it('adapté au moment : « je regarde » avant une vérification, « je note » avant une réservation, « hmm » si la fin de tour est inconnue', () => {
    const lookup = chooseVoiceFiller(choiceInput({ action: 'check_availability' }));
    expect(lookup).toMatchObject({ purpose: 'lookup' });
    const booking = chooseVoiceFiller(choiceInput({ action: 'create_reservation' }));
    expect(booking).toMatchObject({ purpose: 'booking' });
    expect(chooseVoiceFiller(choiceInput({ turnComplete: true }))).toMatchObject({
      purpose: 'ack',
    });
    expect(chooseVoiceFiller(choiceInput())).toMatchObject({ purpose: 'backchannel' });
  });

  it('suit le ton du restaurant', () => {
    const choice = chooseVoiceFiller(
      choiceInput({ style: 'FORMAL', action: 'check_availability' }),
    );
    expect('clip' in choice && VOICE_FILLER_BANK.FORMAL.lookup).toContain(
      'clip' in choice ? choice.clip : null,
    );
  });

  it('rien pendant une épellation de nom', () => {
    expect(chooseVoiceFiller(choiceInput({ lastAwaiting: 'customerName' }))).toEqual({
      skip: 'spelling',
    });
    expect(chooseVoiceFiller(choiceInput({ lastAwaiting: 'customerNameConfirmation' }))).toEqual({
      skip: 'spelling',
    });
    expect(chooseVoiceFiller(choiceInput({ transcript: 'h o u e t' }))).toEqual({
      skip: 'spelling',
    });
  });

  it('rien après un au revoir', () => {
    expect(chooseVoiceFiller(choiceInput({ action: 'end_call' }))).toEqual({ skip: 'goodbye' });
    expect(chooseVoiceFiller(choiceInput({ transcript: 'merci, bonne soirée' }))).toEqual({
      skip: 'goodbye',
    });
  });

  it("rien quand l'appelant parle encore ou n'a pas fini", () => {
    expect(chooseVoiceFiller(choiceInput({ callerSilenceMs: 120 }))).toEqual({
      skip: 'caller_speaking',
    });
    expect(chooseVoiceFiller(choiceInput({ turnComplete: false }))).toEqual({
      skip: 'caller_unfinished',
    });
  });

  it('rien sur un tour déjà rapide : la réponse est déjà partie', () => {
    expect(chooseVoiceFiller(choiceInput({ replyQueued: true }))).toEqual({ skip: 'reply_ready' });
  });

  it('jamais deux fois de suite le même son', () => {
    for (const clip of VOICE_FILLER_BANK.CASUAL.lookup) {
      const choice = chooseVoiceFiller(
        choiceInput({
          action: 'check_availability',
          call: { played: 1, lastClipId: clip.id, lastTurn: 1 },
          random: () => 0.99,
        }),
      );
      expect('clip' in choice && choice.clip.id).not.toBe(clip.id);
      const first = chooseVoiceFiller(
        choiceInput({
          action: 'check_availability',
          call: { played: 1, lastClipId: clip.id, lastTurn: 1 },
          random: () => 0,
        }),
      );
      expect('clip' in first && first.clip.id).not.toBe(clip.id);
    }
  });

  it('plafond par appel, et pas deux tours de suite (sauf « je regarde »)', () => {
    expect(chooseVoiceFiller(choiceInput({ call: { played: 4 } }))).toEqual({ skip: 'cap' });
    expect(chooseVoiceFiller(choiceInput({ call: { played: 1, lastTurn: 2 } }))).toEqual({
      skip: 'consecutive_turn',
    });
    expect(
      chooseVoiceFiller(
        choiceInput({ action: 'check_availability', call: { played: 1, lastTurn: 2 } }),
      ),
    ).toMatchObject({ purpose: 'lookup' });
  });

  it('son absent du cache : rien', () => {
    expect(chooseVoiceFiller(choiceInput({ isCached: () => false }))).toEqual({
      skip: 'not_cached',
    });
  });
});

describe('voice filler : enchaînement avec la réponse', () => {
  it("retire le mot d'appui que le son vient de dire", () => {
    expect(withoutRepeatedInterjection("D'accord, et à quel nom ?", "D'accord,")).toBe(
      'Et à quel nom ?',
    );
    expect(withoutRepeatedInterjection('Très bien.', 'Très bien,')).toBe('');
    expect(withoutRepeatedInterjection("D'accord, et à quel nom ?", 'Alors,')).toBe(
      "D'accord, et à quel nom ?",
    );
    expect(withoutRepeatedInterjection('Pour combien de personnes ?', 'Hmm,')).toBe(
      'Pour combien de personnes ?',
    );
  });

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
      transcript: 'je voudrais réserver samedi',
      lastAwaiting: 'open',
      turnId: session.currentTurn?.id,
      signal,
      env: ENV,
      random: () => 0,
    });
    expect(filler).not.toBeNull();
    return filler!;
  }

  it('seulement au-delà du délai après la fin de parole', async () => {
    const { session, sent } = makeSession();
    arm(session);
    await vi.advanceTimersByTimeAsync(700);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60);
    expect(sent.filter((m) => m.event === 'media')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(400);
    expect(sent.filter((m) => m.event === 'media')).toHaveLength(3);
    expect(loggedEvents().map((e) => e.event)).toEqual(
      expect.arrayContaining(['filler_started', 'tts_first_audio', 'filler_completed']),
    );
    expect(session.latencyTrace?.firstAudioIsFiller).toBe(true);
  });

  it('réponse partie avant le délai : aucun son', async () => {
    const { session, sent } = makeSession();
    const filler = arm(session);
    await vi.advanceTimersByTimeAsync(400);
    filler.replyQueued();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent).toHaveLength(0);
  });

  it('la vraie réponse attend la fin du son, et son premier son est mesuré à part', async () => {
    const { session } = makeSession();
    const filler = arm(session);
    await vi.advanceTimersByTimeAsync(760);
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
    expect(session.latencyTrace?.endOfSpeechToReplyAudioMs).toBeGreaterThanOrEqual(1_000);
    expect(loggedEvents().some((e) => e.event === 'reply_first_audio')).toBe(true);
  });

  it('barge-in : le son s’arrête net', async () => {
    const { session, sent } = makeSession();
    arm(session);
    await vi.advanceTimersByTimeAsync(760);
    session.ttsGeneration++;
    await vi.advanceTimersByTimeAsync(500);
    expect(sent.filter((m) => m.event === 'media')).toHaveLength(1);
    const interrupted = loggedEvents().find((e) => e.event === 'filler_interrupted');
    expect(interrupted).toMatchObject({ reason: 'barge_in' });
  });

  it("l'appelant reprend la parole pendant le son : coupé et effacé chez Telnyx", async () => {
    const { session, sent } = makeSession();
    arm(session);
    await vi.advanceTimersByTimeAsync(760);
    session.callerVoice = { noiseFloor: 0, voiceRun: 3, lastClearVoiceAt: Date.now() };
    await vi.advanceTimersByTimeAsync(500);
    expect(sent.at(-1)).toEqual({ event: 'clear' });
    expect(loggedEvents().find((e) => e.event === 'filler_interrupted')).toMatchObject({
      reason: 'caller_voice',
    });
  });

  it('attente longue après un « hmm » refusé : « je regarde » part à la seconde passe', async () => {
    const { session, sent } = makeSession();
    const state = voiceFillerCallState(session);
    state.played = 1;
    state.lastTurn = session.turnCount - 1;
    const filler = arm(session);
    await vi.advanceTimersByTimeAsync(800);
    expect(sent).toHaveLength(0);
    filler.expectLongWait('check_availability');
    await vi.advanceTimersByTimeAsync(10);
    expect(sent.filter((m) => m.event === 'media')).toHaveLength(1);
    expect(loggedEvents().find((e) => e.event === 'filler_started')).toMatchObject({
      purpose: 'lookup',
    });
  });

  it('« hmm… » puis « je regarde… » quand une vérification s’annonce, sans chevauchement', async () => {
    const { session, sent } = makeSession();
    const filler = arm(session);
    await vi.advanceTimersByTimeAsync(760);
    expect(sent.filter((m) => m.event === 'media')).toHaveLength(1);
    filler.observe({ action: 'check_availability' });
    await vi.advanceTimersByTimeAsync(100);
    // Le premier son (3 trames) n'est pas fini : le second attend.
    expect(sent.filter((m) => m.event === 'media')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent.filter((m) => m.event === 'media')).toHaveLength(6);
    const started = loggedEvents().filter((e) => e.event === 'filler_started');
    expect(started.map((e) => e.purpose)).toEqual(['backchannel', 'lookup']);
    expect(started[1]).toMatchObject({ followUp: true });
    expect(voiceFillerCallState(session).played).toBe(1);
  });

  it('pas de second son quand la réponse est déjà partie', async () => {
    const { session, sent } = makeSession();
    const filler = arm(session);
    await vi.advanceTimersByTimeAsync(760);
    filler.replyQueued();
    filler.expectLongWait('check_availability');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent.filter((m) => m.event === 'media')).toHaveLength(3);
  });

  it('pas deux fois de suite le même son ni au-delà du plafond sur un appel', async () => {
    const { session } = makeSession();
    const played: unknown[] = [];
    for (let turn = 0; turn < 8; turn++) {
      session.turnCount += 2;
      startVoiceTurn(session, 'tour');
      const filler = arm(session);
      filler.expectLongWait('check_availability');
      await vi.advanceTimersByTimeAsync(1_500);
      const started = loggedEvents().filter((e) => e.event === 'filler_started');
      played.splice(0, played.length, ...started.map((e) => e.clip));
    }
    expect(played).toHaveLength(4);
    for (let index = 1; index < played.length; index++) {
      expect(played[index]).not.toBe(played[index - 1]);
    }
  });
});

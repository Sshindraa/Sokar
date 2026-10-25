import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleCallerBackchannel } from '../stream/caller-backchannel';
import { createStructuredTurnState } from '../stream/structured-turn/fact-guards';
import type { CallSession } from '../stream/types';

const explanation =
  'Nous accueillons les groupes dans la grande salle du restaurant. Vous souhaitez venir quel jour ?';
function fixture() {
  const resume = vi.fn();
  const cancel = vi.fn();
  const snapshot = { text: explanation, playedMs: 3_200, totalMs: 8_000 };
  const session = {
    restaurantId: 'continuity-test',
    state: 'SPEAKING',
    agentAudioActive: true,
    ended: false,
    responseGeneration: 1,
    sttLastSpeechStartedAt: Date.now() - 500,
    callerVoice: { noiseFloor: 0, voiceRun: 0, trackedMs: 3_000, lastVoiceAt: Date.now() - 300 },
    structuredTurn: createStructuredTurnState(),
    ttsContext: { resume, cancel, interruptionSnapshot: () => snapshot },
    fastBargeIn: { paused: true, voicedMs: 0 },
  } as unknown as CallSession;
  return { session, resume, cancel, snapshot };
}

beforeEach(() => {
  vi.stubEnv('VOICE_CONVERSATION_CONTINUITY_RESTAURANT_IDS', 'continuity-test');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T18:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('acquiescement pendant une explication', () => {
  it('reste inactif hors liste de qualification', () => {
    vi.stubEnv('VOICE_CONVERSATION_CONTINUITY_RESTAURANT_IDS', '');
    expect(handleCallerBackchannel(fixture().session, 'Oui.', 'partial')).toBe(false);
  });
  it('reprend la même lecture sans annuler ; absorbe le final tardif du même énoncé', () => {
    const { session, resume, cancel } = fixture();
    expect(handleCallerBackchannel(session, 'Oui.', 'partial')).toBe(true);
    expect(resume).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    session.state = 'LISTENING';
    session.agentAudioActive = false;
    vi.advanceTimersByTime(500);
    expect(handleCallerBackchannel(session, 'oui', 'committed')).toBe(true);
    expect(session.responseGeneration).toBe(1);
  });

  it.each([
    'Non.',
    'Non, plutôt vingt heures.',
    'Oui mais nous serons cinq.',
    'Attendez.',
    'Au revoir.',
    'Oui c’est ça.',
    'Oui 20.',
    'Oui ?',
  ])('ne masque jamais une correction, un arrêt ou un accord plus précis : %s', (text) =>
    expect(handleCallerBackchannel(fixture().session, text, 'partial')).toBe(false),
  );

  it('une partielle oui peut devenir une vraie prise de parole', () => {
    const { session } = fixture();
    expect(handleCallerBackchannel(session, 'Oui.', 'partial')).toBe(true);
    expect(handleCallerBackchannel(session, 'Oui mais nous serons cinq.', 'partial')).toBe(false);
    session.state = 'LISTENING';
    expect(handleCallerBackchannel(session, 'Oui.', 'committed')).toBe(false);
  });

  it('ne consomme pas le oui suivant à une autre question, génération ou prise de parole', () => {
    for (const change of ['speech', 'voice', 'generation', 'timeout']) {
      const { session } = fixture();
      expect(handleCallerBackchannel(session, 'Oui.', 'partial')).toBe(true);
      session.state = 'LISTENING';
      if (change === 'speech') session.sttLastSpeechStartedAt = Date.now();
      if (change === 'voice') session.callerVoice!.lastVoiceAt = Date.now();
      if (change === 'generation') session.responseGeneration++;
      if (change === 'timeout') vi.advanceTimersByTime(2_001);
      expect(handleCallerBackchannel(session, 'Oui.', 'committed')).toBe(false);
    }
  });

  it('ne masque pas une réponse si la question a commencé ou si une confirmation est en cours', () => {
    const { session, snapshot } = fixture();
    snapshot.playedMs = 7_000;
    expect(handleCallerBackchannel(session, 'Oui.', 'partial')).toBe(false);
    snapshot.playedMs = 3_200;
    for (const awaiting of [
      'confirmation',
      'confirmationResume',
      'customerNameConfirmation',
    ] as const) {
      session.structuredTurn!.lastAwaiting = awaiting;
      expect(handleCallerBackchannel(session, 'Oui.', 'partial')).toBe(false);
    }
  });

  it('protège une confirmation qui commence à parler avant la mise à jour de lastAwaiting', () => {
    const { session } = fixture();
    session.structuredTurn!.lastAwaiting = 'humanFallback';
    session.agentReplyAwaiting = 'confirmation';
    expect(handleCallerBackchannel(session, 'Oui.', 'partial')).toBe(false);
  });

  it('sans preuve, avec parole longue, pendant accueil ou premiers mots : chemin normal', () => {
    const { session, snapshot } = fixture();
    session.greetingPlaying = true;
    expect(handleCallerBackchannel(session, 'Oui.', 'partial')).toBe(false);
    session.greetingPlaying = false;
    snapshot.playedMs = 200;
    expect(handleCallerBackchannel(session, 'Oui.', 'partial')).toBe(false);
    snapshot.playedMs = 3_200;
    session.callerVoice = undefined;
    expect(handleCallerBackchannel(session, 'Oui.', 'partial')).toBe(false);
    expect(
      handleCallerBackchannel(session, 'Oui.', 'partial', [{ word: 'oui', start: 0, end: 1 }]),
    ).toBe(false);
  });
});

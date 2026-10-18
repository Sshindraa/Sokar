import { describe, it, expect } from 'vitest';
import { analyzeCall, type AnalyzeInput } from '../call-report/analyze';
import type { LogEvent } from '../call-report/log-events';
import type { Transcription, TranscribedWord } from '../call-report/deepgram-batch';
import type { TrackEnergy } from '../call-report/energy';

// Appel fictif : aucune donnée réelle. Il porte les défauts que le rapport doit retrouver.
const BASE = Date.parse('2026-10-02T12:00:00.000Z');
const REC_START = BASE + 500;
/** Instant du journal pour un instant de l'enregistrement (le serveur est ~0,1 s en avance sur l'audio). */
const logAt = (audioSec: number) => REC_START + Math.round((audioSec + 0.1) * 1000);

const words = (list: Array<[string, number, number]>): TranscribedWord[] =>
  list.map(([text, start, end]) => ({ text, start, end, confidence: 0.9 }));

const transcription = (
  engine: 'nova' | 'whisper',
  list: Array<[string, number, number]>,
): Transcription => ({
  engine,
  model: engine === 'nova' ? 'nova-3' : 'whisper-large',
  words: words(list),
  text: list.map(([text]) => text).join(' '),
  durationSec: 60,
  costUsd: engine === 'nova' ? 0.0043 : 0.0048,
});

const track = (segments: Array<[number, number]>): TrackEnergy => ({
  segments,
  noiseFloorDbfs: -60,
  speechLevelDbfs: -25,
  clippedRatio: 0,
});

const ev = (
  atMs: number,
  type: string,
  fields: Record<string, unknown> = {},
  turnId?: string,
): LogEvent => ({ atMs, type, callKey: 'call-A', ...(turnId ? { turnId } : {}), fields });

function input(overrides: Partial<AnalyzeInput> = {}): AnalyzeInput {
  const logEvents: LogEvent[] = [
    ev(logAt(1), 'started', {}, 't1'),
    ev(logAt(2.8), 'final_segment', { text: 'bonjour une table pour demain' }),
    ev(logAt(2.9), 'structured_output', {
      transcript: 'bonjour une table pour demain',
      say: 'Avec plaisir. À quelle heure ?',
    }),
    ev(
      logAt(2.9),
      'structured_turn',
      { pass: 1, actionDecision: 'allowed', judge: 'complete' },
      't1',
    ),
    ev(logAt(3.8), 'tts_first_audio', { endOfSpeechToFirstAudioMs: 800 }, 't1'),
    ev(logAt(6.5), 'started', {}, 't2'),
    ev(logAt(7.6), 'final_segment', { text: 'midi 30' }),
    ev(logAt(7.7), 'structured_output', {
      transcript: 'midi 30',
      say: "D'accord. Avec deux s et deux m ?",
    }),
    ev(
      logAt(7.7),
      'structured_turn',
      { pass: 1, actionDecision: 'allowed', judge: 'incomplete' },
      't2',
    ),
    ev(logAt(11), 'tts_first_audio', { endOfSpeechToFirstAudioMs: 3100 }, 't2'),
  ];
  return {
    call: {
      id: 'call-1',
      restaurantId: 'rest-1',
      callSid: 'leg-1',
      createdAt: new Date(BASE).toISOString(),
      durationSec: 20,
      outcome: 'INFO',
      recordingStartedAt: new Date(REC_START).toISOString(),
    },
    turns: [
      {
        sequence: 1,
        turnId: 't1',
        callerText: 'bonjour une table pour demain',
        agentText: 'Avec plaisir. À quelle heure ?',
      },
      {
        sequence: 2,
        turnId: 't2',
        callerText: 'midi 30',
        agentText: "D'accord. Avec deux s et deux m ?",
      },
    ],
    logEvents,
    logStatus: 'linked',
    tracks: {
      caller: track([
        [1, 3],
        [6.5, 7.5],
      ]),
      agent: track([
        [3.8, 5.5],
        [11, 13.5],
      ]),
    },
    transcripts: {
      caller: {
        nova: transcription('nova', [
          ['bonjour', 1, 1.4],
          ['une', 1.4, 1.6],
          ['table', 1.6, 2],
          ['pour', 2, 2.3],
          ['demain', 2.3, 3],
          ['midi', 6.5, 7],
          ['35', 7, 7.5],
        ]),
        whisper: transcription('whisper', [
          ['bonjour', 1, 1.4],
          ['une', 1.4, 1.6],
          ['table', 1.6, 2],
          ['pour', 2, 2.3],
          ['demain', 2.3, 3],
          ['midi', 6.5, 7],
          ['35', 7, 7.5],
        ]),
      },
      agent: transcription('nova', [
        ['avec', 3.8, 4],
        ['plaisir', 4, 4.4],
        ['à', 4.6, 4.7],
        ['quelle', 4.7, 5],
        ['heure', 5, 5.5],
        ["d'accord", 11, 11.5],
        ['avec', 11.6, 11.8],
        ['deux', 11.8, 12],
        ['secondes', 12, 12.5],
        ['et', 12.5, 12.6],
        ['deux', 12.6, 12.8],
        ['mètres', 12.8, 13.5],
      ]),
    },
    ...overrides,
  };
}

describe('analyzeCall', () => {
  const report = analyzeCall(input());

  it('mesure le délai de réponse sur les pistes, pas sur les journaux', () => {
    expect(report.timeline[0].responseDelaySec).toBeCloseTo(0.8, 1);
    expect(report.timeline[1].responseDelaySec).toBeCloseTo(3.5, 1);
    expect(report.timeline[1].logDelayMs).toBe(3100);
  });

  it("place chaque tour sur la piste : ce que le direct a transcrit, ce que l'oreille après coup entend", () => {
    expect(report.timeline[1].callerLive).toBe('midi 30');
    expect(report.timeline[1].callerHeard.nova).toContain('35');
    expect(report.timeline[1].agentHeard).toContain('secondes');
  });

  it('retrouve « midi 30 » entendu « midi 35 » par les deux oreilles après coup', () => {
    expect(report.ears).toHaveLength(1);
    expect(report.ears[0]).toMatchObject({
      kind: 'number',
      agreement: 'engines_agree_against_live',
      turnId: 't2',
    });
  });

  it('retrouve « deux s et deux m » prononcé « deux secondes et deux mètres »', () => {
    expect(report.mouth).toHaveLength(1);
    expect(report.mouth[0]).toMatchObject({ kind: 'isolated_letters', turnId: 't2' });
    expect(report.mouth[0].cutByInterruption).toBe(false);
  });

  it('retrouve le silence de 3,5 s et sa cause : le verdict « inachevé » sans reprise', () => {
    const silence = report.silences.find(
      (item) => item.owner === 'agent_owed' && item.durationSec > 3,
    );
    expect(silence).toMatchObject({ turnId: 't2', cause: 'judge_incomplete' });
    expect(report.turnTaking.unfinished).toHaveLength(1);
    expect(report.turnTaking.unfinished[0].callerResumed).toBe(false);
  });

  it('recale les journaux sur l’audio et dit combien de tours ont servi', () => {
    expect(report.clock.calibratedOnTurns).toBe(2);
    expect(report.clock.offsetSec).toBeCloseTo(-0.1, 1);
  });

  it('classe la prononciation avant la compréhension et le silence', () => {
    expect(report.summary.issues.slice(0, 3).map((issue) => issue.kind)).toEqual([
      'mouth_isolated_letters',
      'ears_live_wrong',
      'silence_false_unfinished',
    ]);
    expect(report.summary.oneLine.startsWith('1) ')).toBe(true);
  });

  it('chiffre le coût des transcriptions après coup', () => {
    expect(report.costUsd).toBeCloseTo(0.0043 * 2 + 0.0048, 6);
    expect(report.engines.map((engine) => engine.engine)).toEqual(['nova', 'whisper', 'nova']);
  });

  it('signale dans le rapport que les journaux manquent, et dégrade sans planter', () => {
    const degraded = analyzeCall(input({ logEvents: [], logStatus: 'missing' }));
    expect(degraded.logs.status).toBe('missing');
    expect(degraded.limits.join(' ')).toMatch(/Journaux/);
    expect(degraded.silences.find((item) => item.durationSec > 3)?.cause).toBe('unknown_no_logs');
    expect(degraded.mouth).toHaveLength(1);
  });

  it('masque les numéros de téléphone dans tout le rapport', () => {
    const withPhone = input();
    withPhone.turns[0].callerText = 'bonjour mon numéro est 06 12 34 56 78';
    const text = JSON.stringify(analyzeCall(withPhone));
    expect(text).not.toContain('06 12 34 56 78');
  });

  it('ne déforme pas les identifiants (un UUID ressemble à un numéro de téléphone)', () => {
    const withUuid = input();
    withUuid.turns[0].turnId = 'a231b635-4748-4ad1-96d4-1f4ebb391966';
    withUuid.logEvents = withUuid.logEvents.map((event) =>
      event.turnId === 't1' ? { ...event, turnId: 'a231b635-4748-4ad1-96d4-1f4ebb391966' } : event,
    );
    const result = analyzeCall(withUuid);
    expect(result.timeline[0].turnId).toBe('a231b635-4748-4ad1-96d4-1f4ebb391966');
    expect(result.call.createdAt).toBe(withUuid.call.createdAt);
  });

  it('garde le `say` de chaque passage et retient le dernier comme celui qui a été dit', () => {
    const twoPasses = input();
    twoPasses.logEvents.push(
      ev(logAt(8), 'structured_output', {
        transcript: 'midi 30',
        say: 'Désolé, pouvez-vous répéter ?',
      }),
    );
    const turn = analyzeCall(twoPasses).timeline[1];
    expect(turn.modelSays).toEqual([
      "D'accord. Avec deux s et deux m ?",
      'Désolé, pouvez-vous répéter ?',
    ]);
    expect(turn.modelSay).toBe('Désolé, pouvez-vous répéter ?');
  });

  it('ignore un mot transcrit là où la piste appelant est muette (hallucination de Whisper)', () => {
    const hallucinated = input();
    hallucinated.transcripts.caller.whisper!.words.push(
      { text: 'merci', start: 15, end: 15.5, confidence: 0.3 },
      { text: "d'avoir", start: 15.5, end: 16, confidence: 0.3 },
    );
    const result = analyzeCall(hallucinated);
    expect(result.ears).toHaveLength(1);
    expect(result.limits.join(' ')).toMatch(/sans voix/);
  });

  it("mesure la fin de parole de l'appelant sur l'énergie, pas sur le dernier mot transcrit", () => {
    const echo = input();
    // Nova étire « 35 » jusqu'à 9 s : la piste appelant se tait à 7,5 s.
    echo.transcripts.caller.nova.words[echo.transcripts.caller.nova.words.length - 1].end = 9;
    expect(analyzeCall(echo).timeline[1].responseDelaySec).toBeCloseTo(3.5, 1);
  });

  it("marque les écarts d'un tour interrompu (là où une lettre se perd ou se recolle)", () => {
    const interrupted = input();
    interrupted.logEvents.push(ev(logAt(7.4), 'barge_in', {}, 't2'));
    const result = analyzeCall(interrupted);
    expect(result.turnTaking.interruptions).toHaveLength(1);
    expect(result.ears[0].duringInterruption).toBe(true);
  });

  it("n'attribue pas à un tour les mots qu'un autre tour a dits (le texte de la piste est découpé par tour)", () => {
    // Le direct a coupé « a 2 s a m » en deux tours ; la piste le porte d'un seul tenant.
    const split = input();
    split.turns[0].callerText = 'a 2 s';
    split.turns[1].callerText = 'm';
    split.transcripts.caller.nova.words = [
      { text: 'a', start: 1, end: 1.2, confidence: 1 },
      { text: '2', start: 1.3, end: 1.5, confidence: 1 },
      { text: 's', start: 1.6, end: 1.8, confidence: 1 },
      { text: 'a', start: 6.4, end: 6.6, confidence: 1 },
      { text: 'm', start: 6.7, end: 7.2, confidence: 1 },
    ];
    delete split.transcripts.caller.whisper;
    const result = analyzeCall(split);
    const lost = result.ears.find((item) => item.turnId === 't2');
    expect(lost).toMatchObject({ kind: 'isolated_letters', live: expect.stringContaining('m') });
    expect(lost?.engines.nova).toContain('a m');
    expect(result.ears.find((item) => item.turnId === 't1')).toBeUndefined();
  });

  it("signale une suite de lettres relue, non validée, puis épelée à l'identique (erreur d'oreille probable)", () => {
    const same = input();
    same.turns = [
      {
        sequence: 1,
        turnId: 't1',
        callerText: 'a 2 s a m',
        agentText: 'Je note A, double A, S, A, M. C’est bien ça ?',
      },
      {
        sequence: 2,
        turnId: 't2',
        callerText: 'non a 2 s a m',
        agentText: 'Je note A, double A, S, A, M.',
      },
    ];
    const result = analyzeCall(same);
    expect(result.turnTaking.identicalRespellings).toHaveLength(1);
    expect(result.summary.issues.some((issue) => issue.kind === 'systematic_ear_error')).toBe(true);
  });

  it("signale l'abandon d'un appel de réservation qui finit sans réservation, avec ses derniers échanges", () => {
    const abandoned = input();
    abandoned.call.intent = 'RESERVATION';
    abandoned.call.outcome = 'INFO';
    const result = analyzeCall(abandoned);
    expect(result.outcome.abandoned).toBe(true);
    expect(result.outcome.lastExchanges).toHaveLength(2);
    expect(result.summary.issues.some((issue) => issue.kind === 'abandoned')).toBe(true);
  });

  it("ne signale pas d'abandon quand la réservation est faite", () => {
    const booked = input();
    booked.call.intent = 'RESERVATION';
    booked.call.outcome = 'RESERVED';
    expect(analyzeCall(booked).outcome.abandoned).toBe(false);
  });

  it('signale une épellation répartie sur plusieurs tours', () => {
    const split = input();
    split.turns[0].callerText = 'a';
    split.turns[1].callerText = 'a 2 s';
    const result = analyzeCall(split);
    expect(result.turnTaking.splitSpellings).toHaveLength(1);
    expect(result.summary.issues.some((issue) => issue.kind === 'spelling_split')).toBe(true);
  });

  it('fonctionne sans oreille Whisper (indisponible)', () => {
    const base = input();
    delete base.transcripts.caller.whisper;
    const partial = analyzeCall(base);
    expect(partial.limits.join(' ')).toMatch(/Whisper/);
    expect(partial.ears[0].agreement).toBe('engine_differs');
  });
});

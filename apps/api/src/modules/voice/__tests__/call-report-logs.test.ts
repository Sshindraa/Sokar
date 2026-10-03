import { describe, it, expect } from 'vitest';
import {
  parseLogLine,
  selectCallLog,
  buildLogTurns,
  buildLoggedInterruptions,
} from '../call-report/log-events';

const T0 = Date.parse('2026-10-02T12:27:03.000Z');
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();
const pino = (offsetMs: number, fields: Record<string, unknown>) =>
  `2026-10-02 14:27:03: ${JSON.stringify({ level: 'info', time: at(offsetMs), ...fields })}`;
const turnEvent = (offsetMs: number, callId: string, turnId: string, event: string, extra = {}) =>
  pino(offsetMs, {
    voiceTurn: { callId, turnId, event, eventAt: T0 + offsetMs, ...extra },
    msg: `[voice-turn] ${event}`,
  });
const debug = (offsetMs: number, callId: string, voiceDebug: string, extra = {}) =>
  pino(offsetMs, { callId, voiceDebug, ...extra, msg: '[voice-debug] raw text' });

describe('parseLogLine', () => {
  it('lit une ligne pm2 (horodatage local devant) et une ligne JSON brute', () => {
    const line = pino(0, { callId: 'c1', msg: '[stream] Start call' });
    expect(parseLogLine(line)).toMatchObject({ atMs: T0, type: 'stream_start', callKey: 'c1' });
    expect(parseLogLine(line.slice(line.indexOf('{')))).toMatchObject({ type: 'stream_start' });
  });

  it("ignore une ligne qui n'est pas du JSON", () => {
    expect(parseLogLine('not json')).toBeNull();
    expect(parseLogLine('2026-10-02 14:27:03: {broken')).toBeNull();
  });

  it('nomme les événements de tour et les textes bruts', () => {
    expect(parseLogLine(turnEvent(10, 'c1', 't1', 'tts_first_audio'))).toMatchObject({
      type: 'tts_first_audio',
      turnId: 't1',
      callKey: 'c1',
    });
    expect(parseLogLine(debug(10, 'c1', 'phrase_dropped', { text: 'Bonjour' }))).toMatchObject({
      type: 'phrase_dropped',
      fields: { text: 'Bonjour' },
    });
  });

  it("lit l'identifiant d'appel sous callId et call_id", () => {
    expect(
      parseLogLine(pino(0, { call_id: 'c9', msg: '[stream] New Telnyx WS connection for call' }))
        ?.callKey,
    ).toBe('c9');
  });
});

describe('selectCallLog', () => {
  const lines = [
    pino(0, { callId: 'A', msg: '[stream] Start call' }),
    pino(60_000, { callId: 'B', msg: '[stream] Start call' }),
    pino(61_000, { callId: 'B', msg: '[stream] Telnyx stream stop' }),
  ].map((line) => parseLogLine(line)!);

  it("relie l'appel par la ligne de liaison quand elle existe", () => {
    const linked = [
      ...lines,
      parseLogLine(
        pino(100, { callId: 'A', callLegId: 'leg-1', msg: '[voice-report] call linked' }),
      )!,
    ];
    const result = selectCallLog(linked, { callLegId: 'leg-1', createdAtMs: T0 + 60_000 });
    expect(result.status).toBe('linked');
    expect(result.callKey).toBe('A');
  });

  it("à défaut, relie par l'heure de création de l'appel et le dit", () => {
    const result = selectCallLog(lines, { callLegId: 'leg-x', createdAtMs: T0 + 60_300 });
    expect(result).toMatchObject({ status: 'matched_by_time', callKey: 'B' });
  });

  it('déclare les journaux absents quand aucun appel ne démarre à cette heure (rotation)', () => {
    const result = selectCallLog(lines, { callLegId: 'leg-x', createdAtMs: T0 + 3_600_000 });
    expect(result).toMatchObject({ status: 'missing', callKey: null });
  });

  it('refuse une correspondance ambiguë', () => {
    const twins = [
      pino(0, { callId: 'A', msg: '[stream] Start call' }),
      pino(2_000, { callId: 'B', msg: '[stream] Start call' }),
    ].map((line) => parseLogLine(line)!);
    const result = selectCallLog(twins, { callLegId: 'leg-x', createdAtMs: T0 + 1_000 });
    expect(result.status).toBe('ambiguous');
  });
});

describe('buildLogTurns', () => {
  const events = [
    turnEvent(1_000, 'A', 't1', 'started'),
    debug(1_500, 'A', 'final_segment', { text: 'bonjour', speechFinal: true }),
    debug(1_900, 'A', 'finalize_sent', {
      trigger: 'semantic',
      partial: 'bonjour',
      callerSilenceMs: 500,
    }),
    debug(2_000, 'A', 'structured_output', {
      transcript: 'bonjour',
      say: 'Bonjour, que puis-je faire ?',
      understanding: 'clear',
    }),
    turnEvent(2_010, 'A', 't1', 'structured_turn', {
      pass: 1,
      action: 'none',
      awaiting: 'date',
      actionDecision: 'allowed',
      judge: 'incomplete',
    }),
    turnEvent(2_500, 'A', 't1', 'tts_first_audio', { endOfSpeechToFirstAudioMs: 900 }),
    turnEvent(6_000, 'A', 't2', 'started'),
    debug(6_100, 'A', 'final_segment', { text: 'demain' }),
    debug(6_500, 'A', 'phrase_dropped', {
      text: 'Pour combien ?',
      reason: 'time_given_without_party_size',
    }),
  ]
    .map((line) => parseLogLine(line)!)
    .filter(Boolean);

  it('range chaque événement dans son tour, par identifiant de tour ou par heure', () => {
    const turns = buildLogTurns(events);
    expect(turns.map((turn) => turn.turnId)).toEqual(['t1', 't2']);
    expect(turns[0].finals).toEqual(['bonjour']);
    expect(turns[0].finalizes[0]).toMatchObject({ trigger: 'semantic' });
    expect(turns[1].finals).toEqual(['demain']);
    expect(turns[1].droppedPhrases[0]).toMatchObject({ text: 'Pour combien ?' });
  });

  it('garde la sortie du modèle et le verdict du juge de chaque passage', () => {
    const [turn] = buildLogTurns(events);
    expect(turn.outputs[0]).toMatchObject({
      say: 'Bonjour, que puis-je faire ?',
      transcript: 'bonjour',
    });
    expect(turn.decisions[0]).toMatchObject({
      pass: 1,
      judge: 'incomplete',
      actionDecision: 'allowed',
    });
  });

  it("garde l'heure de la première voix de l'agent", () => {
    const [turn] = buildLogTurns(events);
    expect(turn.firstAudioAtMs).toBe(T0 + 2_500);
    expect(turn.endOfSpeechToFirstAudioMs).toBe(900);
  });
});

describe('buildLoggedInterruptions', () => {
  it("garde l'interruption de l'accueil, avant tout tour, avec son décalage depuis le décroché", () => {
    const events = [
      pino(0, { callId: 'A', msg: '[stream] Start call' }),
      pino(1_300, {
        callId: 'A',
        wordCount: 1,
        minWordConfidence: 0.278,
        voiceMs: 400,
        msg: '[barge-in] User spoke while assistant was speaking. Interrupting.',
      }),
      turnEvent(1_301, 'A', 't1', 'started'),
      pino(4_000, {
        callId: 'A',
        msg: '[barge-in] Refused: a single weak word is not enough to interrupt',
      }),
    ].map((line) => parseLogLine(line)!);
    expect(buildLoggedInterruptions(events)).toEqual([
      {
        type: 'barge_in_detected',
        atMs: expect.any(Number),
        offsetSec: 1.3,
        beforeFirstTurn: true,
        wordCount: 1,
        minWordConfidence: 0.278,
        voiceMs: 400,
      },
      {
        type: 'barge_in_refused',
        atMs: expect.any(Number),
        offsetSec: 4,
        beforeFirstTurn: false,
      },
    ]);
  });
});

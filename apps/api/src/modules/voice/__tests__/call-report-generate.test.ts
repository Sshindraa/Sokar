import { describe, it, expect, vi } from 'vitest';
import { generateCallReport } from '../call-report/generate';
import { renderMarkdown } from '../call-report/markdown';
import type { Transcriber } from '../call-report/deepgram-batch';
import { stereoMp3 } from './fixtures/call-report-stereo';

const mp3 = stereoMp3();
const BASE = Date.parse('2026-10-02T12:00:00.000Z');

const raw = () => ({
  mp3,
  call: {
    id: 'call-1',
    restaurantId: 'rest-1',
    callSid: 'leg-1',
    createdAt: new Date(BASE).toISOString(),
    durationSec: 3,
    outcome: 'INFO',
    recordingStartedAt: new Date(BASE).toISOString(),
  },
  turns: [{ sequence: 1, turnId: 't1', callerText: 'bonjour', agentText: 'Bonsoir.' }],
  logLines: [
    JSON.stringify({
      time: new Date(BASE + 100).toISOString(),
      callId: 'A',
      msg: '[stream] Start call',
    }),
    JSON.stringify({
      time: new Date(BASE + 600).toISOString(),
      voiceTurn: { callId: 'A', turnId: 't1', event: 'started', eventAt: BASE + 600 },
      msg: '[voice-turn] started',
    }),
  ],
});

const word = (text: string, start: number, end: number) => ({ text, start, end, confidence: 1 });

function transcriber(options: { failWhisper?: boolean } = {}): Transcriber {
  return vi.fn(async (_wav: Uint8Array, engine) => {
    if (engine === 'whisper' && options.failWhisper) throw new Error('whisper unavailable');
    return {
      engine,
      model: engine === 'nova' ? 'nova-3' : 'whisper-large',
      words: [word('bonjour', 0.6, 1.2)],
      text: 'bonjour',
      durationSec: 3,
      costUsd: 0.001,
    };
  });
}

describe('generateCallReport', () => {
  it('décode les deux pistes, transcrit appelant (deux oreilles) et agent, puis analyse', async () => {
    const transcribe = transcriber();
    const report = await generateCallReport(raw(), { transcribe });
    expect(transcribe).toHaveBeenCalledTimes(3);
    const engines = (transcribe as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1]);
    expect(engines.sort()).toEqual(['nova', 'nova', 'whisper']);
    expect(report.tracks.caller.speechLevelDbfs).not.toBeNull();
    expect(report.logs.status).toBe('matched_by_time');
    expect(report.engines).toHaveLength(3);
  });

  it('envoie à chaque oreille un WAV mono, jamais le MP3 deux pistes', async () => {
    const transcribe = transcriber();
    await generateCallReport(raw(), { transcribe });
    for (const [wav] of (transcribe as ReturnType<typeof vi.fn>).mock.calls) {
      expect(String.fromCharCode(...(wav as Uint8Array).slice(0, 4))).toBe('RIFF');
    }
  });

  it("continue sans Whisper s'il échoue, et le dit", async () => {
    const report = await generateCallReport(raw(), {
      transcribe: transcriber({ failWhisper: true }),
    });
    expect(report.engines).toHaveLength(2);
    expect(report.limits.join(' ')).toMatch(/Whisper/);
  });

  it('échoue si la transcription de référence (Nova-3) échoue', async () => {
    const failing: Transcriber = async (_wav, engine) => {
      if (engine === 'nova') throw new Error('deepgram down');
      throw new Error('whisper down');
    };
    await expect(generateCallReport(raw(), { transcribe: failing })).rejects.toThrow(
      /deepgram down/,
    );
  });
});

describe('renderMarkdown', () => {
  it('rend les sections du rapport, sans numéro de téléphone', async () => {
    const data = raw();
    data.turns[0].callerText = 'bonjour au 06 12 34 56 78';
    const markdown = renderMarkdown(await generateCallReport(data, { transcribe: transcriber() }));
    for (const heading of [
      '# Appel call-1',
      '## Synthèse',
      '## Chronologie',
      "## L'oreille",
      '## La bouche',
      '## Silences',
      '## Tours de parole',
      '## Garde-fous',
      'Ré-épellations identiques après relecture',
      '## Issue',
    ]) {
      expect(markdown).toContain(heading);
    }
    expect(markdown).not.toContain('06 12 34 56 78');
  });
});

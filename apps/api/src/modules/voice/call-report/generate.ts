/**
 * Génère le rapport d'un appel enregistré : décode les deux pistes, mesure leur énergie, les fait
 * transcrire après coup, puis analyse. Aucun appel au modèle de dialogue.
 *
 * Les transcriptions passent par `deps.transcribe` : le worker appelle Deepgram directement, le
 * script local passe par le VPS (la clé Deepgram n'en sort pas).
 */
import { analyzeCall } from './analyze';
import type { Transcriber, Transcription } from './deepgram-batch';
import { analyzeTrack, decodeStereoMp3 } from './energy';
import { parseLogLine, selectCallLog, type LogEvent } from './log-events';
import type { CallReport, ReportCall, ReportTurnRow } from './types';
import { encodeWavMono } from './wav';

export interface RawCallInput {
  call: ReportCall;
  turns: ReportTurnRow[];
  /** Lignes pino de l'API couvrant l'appel (déjà filtrées sur sa fenêtre de temps, ou non). */
  logLines: string[];
  mp3: Uint8Array;
}

export async function generateCallReport(
  raw: RawCallInput,
  deps: { transcribe: Transcriber; now?: Date },
): Promise<CallReport> {
  const decoded = await decodeStereoMp3(raw.mp3);
  const [callerSamples, agentSamples] = decoded.channels;
  const tracks = {
    caller: analyzeTrack(callerSamples, decoded.sampleRate),
    agent: analyzeTrack(agentSamples, decoded.sampleRate),
  };
  const callerWav = encodeWavMono(callerSamples, decoded.sampleRate);
  const agentWav = encodeWavMono(agentSamples, decoded.sampleRate);

  const [callerNova, callerWhisper, agent] = await Promise.allSettled([
    deps.transcribe(callerWav, 'nova'),
    deps.transcribe(callerWav, 'whisper'),
    deps.transcribe(agentWav, 'nova'),
  ]);
  // Nova-3 est l'oreille de référence : sans elle, pas de rapport. Whisper est un renfort.
  if (callerNova.status === 'rejected') throw callerNova.reason;
  if (agent.status === 'rejected') throw agent.reason;
  const whisper: Transcription | undefined =
    callerWhisper.status === 'fulfilled' ? callerWhisper.value : undefined;

  const events = raw.logLines
    .map((line) => parseLogLine(line))
    .filter((event): event is LogEvent => event !== null);
  const selection = selectCallLog(events, {
    callLegId: raw.call.callSid,
    createdAtMs: Date.parse(raw.call.createdAt),
  });

  const report = analyzeCall({
    call: raw.call,
    turns: raw.turns,
    logEvents: selection.events,
    logStatus: selection.status,
    logCallKey: selection.callKey,
    tracks,
    transcripts: {
      caller: { nova: callerNova.value, ...(whisper ? { whisper } : {}) },
      agent: agent.value,
    },
    now: deps.now,
  });
  return report;
}

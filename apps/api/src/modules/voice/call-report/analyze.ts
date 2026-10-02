/**
 * Assemble le rapport d'un appel à partir de ce qui a été mesuré : pistes (énergie), transcriptions
 * après coup, journaux du serveur et dialogue par tour. Fonction pure : aucune lecture ni appel réseau,
 * donc entièrement testable avec des données fictives.
 */
import { compareEars } from './ears';
import type { Segment, TrackEnergy } from './energy';
import { collectGuards } from './guards';
import { buildLogTurns, type LogEvent, type LogSelection, type LogTurn } from './log-events';
import { redactPii } from '../stream/pii-redact';
import { attributeSilenceCause, findSilences, type CauseInput } from './silences';
import { findSplitSpellings } from './spelling';
import { oneLineSummary, rankIssues } from './summary';
import { tokenize } from './tokens';
import {
  classifyInterruption,
  findOverlaps,
  unfinishedVerdicts,
  type UnfinishedTurnInput,
} from './turn-taking';
import {
  REPORT_VERSION,
  type CallReport,
  type EarsReport,
  type InterruptionReport,
  type MouthDivergence,
  type ReportCall,
  type ReportTurnRow,
  type SilenceReport,
  type TurnReport,
} from './types';
import type { TranscribedWord, Transcription } from './deepgram-batch';
import { flattenWords, mapTokensToWords, spanOfTokens, zoneTexts } from './word-map';

export interface AnalyzeInput {
  call: ReportCall;
  turns: ReportTurnRow[];
  logEvents: LogEvent[];
  logStatus: LogSelection['status'];
  logCallKey?: string | null;
  tracks: { caller: TrackEnergy; agent: TrackEnergy };
  transcripts: {
    caller: { nova: Transcription; whisper?: Transcription };
    agent: Transcription;
  };
  now?: Date;
}

/** Une réplique coupée par une interruption est marquée dans le texte persisté (debug-dialogue.ts). */
const CUT_MARK = /\s*\[(envoi coupé|en cours)\]/g;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

function ranges(tokenLists: string[][]): Array<[number, number]> {
  let cursor = 0;
  return tokenLists.map((tokens) => {
    const range: [number, number] = [cursor, cursor + tokens.length];
    cursor += tokens.length;
    return range;
  });
}

/** Segment d'énergie le plus proche d'un instant, dans une tolérance (la parole transcrite n'a pas les mêmes bords). */
function nearestSegment(
  segments: readonly Segment[],
  atSec: number,
  toleranceSec: number,
): Segment | null {
  let best: Segment | null = null;
  let bestDistance = Infinity;
  for (const segment of segments) {
    const distance =
      atSec < segment[0] ? segment[0] - atSec : atSec > segment[1] ? atSec - segment[1] : 0;
    if (distance <= toleranceSec && distance < bestDistance) {
      best = segment;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Garde les mots qui reposent sur de la voix : un mot dont aucun instant n'a d'énergie sur la piste
 * ne peut pas être de la parole de cette piste (hallucination d'un moteur sur du silence ou du bruit).
 */
const VOICE_MARGIN_SEC = 0.2;

function voicedWords(
  words: readonly TranscribedWord[],
  segments: readonly Segment[],
): { kept: TranscribedWord[]; dropped: number } {
  const kept = words.filter((word) =>
    segments.some(
      ([start, end]) =>
        end >= word.start - VOICE_MARGIN_SEC && start <= word.end + VOICE_MARGIN_SEC,
    ),
  );
  return { kept, dropped: words.length - kept.length };
}

function withWords(transcription: Transcription, words: TranscribedWord[]): Transcription {
  return { ...transcription, words };
}

function causeInput(row: ReportTurnRow, turn: LogTurn): CauseInput {
  return {
    callerText: row.callerText ?? '',
    decisions: turn.decisions,
    droppedPhrases: turn.droppedPhrases.length,
    finalizeTriggers: turn.finalizes.map((item) => item.trigger ?? ''),
    endOfSpeechToSttFinalMs: turn.endOfSpeechToSttFinalMs,
    holdMs: turn.holdMs,
    llmFirstPhraseMs: turn.llmFirstPhraseMs,
    ttsFirstByteMs: turn.ttsFirstByteMs,
  };
}

/** Identifiants et dates : un UUID ou une date ressemble à un numéro de téléphone, ils ne sont pas du texte d'appel. */
const UNREDACTED_KEYS = new Set([
  'id',
  'turnId',
  'restaurantId',
  'callKey',
  'createdAt',
  'generatedAt',
  'engine',
  'model',
]);

function redactDeep<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, item: unknown) =>
      typeof item === 'string' && !UNREDACTED_KEYS.has(key) ? redactPii(item) : item,
    ),
  ) as T;
}

export function analyzeCall(input: AnalyzeInput): CallReport {
  const { call, tracks, transcripts } = input;
  const rows = [...input.turns].sort((a, b) => a.sequence - b.sequence);
  const logTurns = buildLogTurns(input.logEvents);
  const logByTurn = new Map(logTurns.map((turn) => [turn.turnId, turn]));
  const limits: string[] = [];
  const logsAvailable = input.logStatus === 'linked' || input.logStatus === 'matched_by_time';
  if (input.logStatus === 'missing') {
    limits.push(
      'Journaux du serveur introuvables pour cet appel (rotation à 14 jours, ou appel d’avant la ligne de liaison) : causes des silences, verdicts du juge, garde-fous et interruptions non disponibles.',
    );
  } else if (input.logStatus === 'ambiguous') {
    limits.push(
      'Plusieurs appels démarrent à la même heure dans les journaux : aucun rattachement, causes non disponibles.',
    );
  } else if (input.logStatus === 'matched_by_time') {
    limits.push(
      'Appel relié aux journaux par l’heure de création (pas de ligne de liaison) : rattachement probable, non certain.',
    );
  }
  if (rows.every((row) => !row.callerText && !row.agentText)) {
    limits.push(
      'Dialogue par tour non conservé pour ce restaurant (VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS) ou purgé (14 jours) : comparaison direct/après coup et chronologie réduites.',
    );
  }
  if (!transcripts.caller.whisper) {
    limits.push('Oreille Whisper indisponible : comparaison à deux seulement (direct et Nova-3).');
  }

  // --- Les mots sans voix dessous ne comptent pas ---
  const callerSegments = tracks.caller.segments;
  const novaVoiced = voicedWords(transcripts.caller.nova.words, callerSegments);
  const whisperVoiced = transcripts.caller.whisper
    ? voicedWords(transcripts.caller.whisper.words, callerSegments)
    : null;
  const agentVoiced = voicedWords(transcripts.agent.words, tracks.agent.segments);
  const droppedWords = novaVoiced.dropped + (whisperVoiced?.dropped ?? 0) + agentVoiced.dropped;
  if (droppedWords > 0) {
    limits.push(
      `${droppedWords} mot(s) transcrits sans voix sur la piste correspondante ont été ignorés (hallucination probable d'un moteur).`,
    );
  }

  // --- Ce que le direct a transcrit, rattaché aux mots de la piste appelant ---
  const nova = withWords(transcripts.caller.nova, novaVoiced.kept);
  const whisper =
    transcripts.caller.whisper && whisperVoiced
      ? withWords(transcripts.caller.whisper, whisperVoiced.kept)
      : undefined;
  const callerTokens = rows.map((row) => tokenize(row.callerText ?? ''));
  const callerRanges = ranges(callerTokens);
  const liveTokens = callerTokens.flat();
  const novaMap = mapTokensToWords(liveTokens, flattenWords(nova.words));
  const callerSpans = rows.map((_, index) =>
    spanOfTokens(novaMap, nova.words, callerRanges[index][0], callerRanges[index][1]),
  );

  // --- Ce qui a été envoyé à la synthèse, rattaché aux mots de la piste agent ---
  const agentWords = agentVoiced.kept;
  const sentClean = rows.map((row) => (row.agentText ?? '').replace(CUT_MARK, '').trim());
  const sentCut = rows.map(
    (row) => CUT_MARK.test(row.agentText ?? '') && ((CUT_MARK.lastIndex = 0), true),
  );
  const agentSentTokens = rows.map((row, index) =>
    tokenize([row.fillerText ?? '', sentClean[index]].filter(Boolean).join(' ')),
  );
  const agentRanges = ranges(agentSentTokens);
  const sentAll = agentSentTokens.flat();
  const agentMap = mapTokensToWords(sentAll, flattenWords(agentWords));
  const agentSpans = rows.map((_, index) =>
    spanOfTokens(agentMap, agentWords, agentRanges[index][0], agentRanges[index][1]),
  );

  // --- Frontières mesurées sur l'énergie des pistes ---
  // La fin de parole est celle du dernier segment de la piste appelant qui recouvre le tour : les
  // bords des mots transcrits flottent (écho, mot tardif), l'énergie non.
  const callerEnds = callerSpans.map((span) => {
    if (!span) return null;
    const overlapping = tracks.caller.segments.filter(
      ([start, end]) => end >= span.start - 0.3 && start <= span.end + 0.3,
    );
    return overlapping.length > 0 ? Math.max(...overlapping.map(([, end]) => end)) : span.end;
  });
  const agentSpanStarts = agentSpans.map((span, index) => {
    if (!span || agentSentTokens[index].length === 0) return null;
    const segment = nearestSegment(tracks.agent.segments, span.start, 0.6);
    return segment ? segment[0] : span.start;
  });
  const nextAgentStartAfter = (atSec: number): number | null =>
    tracks.agent.segments.find(([start]) => start >= atSec - 0.05)?.[0] ?? null;

  // --- Horloge des journaux recalée sur l'audio : première voix de l'agent, journal contre piste ---
  const recordingStartMs = call.recordingStartedAt ? Date.parse(call.recordingStartedAt) : NaN;
  const offsets: number[] = [];
  rows.forEach((row, index) => {
    const turn = logByTurn.get(row.turnId);
    const start = agentSpanStarts[index];
    if (turn?.firstAudioAtMs !== undefined && start !== null && !Number.isNaN(recordingStartMs)) {
      offsets.push(start - (turn.firstAudioAtMs - recordingStartMs) / 1000);
    }
  });
  const offsetSec = offsets.length > 0 ? round2(median(offsets)) : null;
  const audioTimeOf = (atMs: number): number | null =>
    offsetSec === null ? null : round2((atMs - recordingStartMs) / 1000 + offsetSec);

  // --- Chronologie ---
  const timeline: TurnReport[] = rows.map((row, index) => {
    const turn = logByTurn.get(row.turnId);
    const callerEnd = callerEnds[index];
    const agentStart = agentSpanStarts[index];
    const [from, to] = agentRanges[index];
    const heardTokens = agentMap.slice(from, to).filter((value): value is number => value !== null);
    const agentHeard =
      heardTokens.length > 0
        ? agentWords
            .slice(Math.min(...heardTokens), Math.max(...heardTokens) + 1)
            .map((word) => word.text)
            .join(' ')
        : null;
    const modelSays = (turn?.outputs ?? []).map((output) => output.say ?? '').filter(Boolean);
    const callerHeardNova = spanText(nova, callerSpans[index]);
    const callerHeardWhisper = whisper ? spanText(whisper, callerSpans[index]) : undefined;
    return {
      sequence: row.sequence,
      turnId: row.turnId,
      callerLive: row.callerText ?? '',
      callerHeard: {
        ...(callerHeardNova ? { nova: callerHeardNova } : {}),
        ...(callerHeardWhisper ? { whisper: callerHeardWhisper } : {}),
      },
      modelSay: modelSays[modelSays.length - 1] ?? null,
      modelSays,
      agentSent: row.agentText ?? null,
      agentHeard,
      callerSpan: callerSpans[index],
      agentStartSec: agentStart,
      responseDelaySec:
        callerEnd !== null && agentStart !== null ? round2(agentStart - callerEnd) : null,
      logDelayMs: turn?.endOfSpeechToFirstAudioMs ?? row.endOfSpeechToFirstAudioMs ?? null,
      judge: turn?.decisions.find((decision) => decision.judge)?.judge ?? null,
      understanding: turn?.outputs[0]?.understanding ?? null,
    };
  });

  // --- L'oreille : direct contre après coup, tour par tour, sur le même morceau d'audio ---
  const novaZones = zoneTexts(callerSpans, nova.words);
  const whisperZones = whisper ? zoneTexts(callerSpans, whisper.words) : null;
  const ears: EarsReport[] = rows.flatMap((row, index) =>
    compareEars({
      live: row.callerText ?? '',
      engines: {
        nova: novaZones[index],
        ...(whisperZones ? { whisper: whisperZones[index] } : {}),
      },
    }).map((item) => ({
      ...item,
      turnId: row.turnId,
      atSec: callerSpans[index] ? round2(callerSpans[index]!.start) : null,
      duringInterruption: false,
    })),
  );

  // --- La bouche : texte envoyé à la synthèse contre piste agent, tour par tour ---
  const agentZones = zoneTexts(agentSpans, agentWords);
  const mouth: MouthDivergence[] = rows.flatMap((row, index) =>
    compareEars({
      live: agentSentTokens[index].join(' '),
      engines: { nova: agentZones[index] },
    })
      // Le début de la piste agent porte l'accueil, absent du texte des tours : ce n'est pas un écart.
      .filter((item) => !(index === 0 && item.kind === 'word' && item.liveStart === 0))
      .map((item) => ({
        ...item,
        turnId: row.turnId,
        atSec: agentSpans[index] ? round2(agentSpans[index]!.start) : null,
        cutByInterruption: sentCut[index],
      })),
  );

  // --- Silences, avec leur cause ---
  const silences: SilenceReport[] = findSilences(tracks.caller.segments, tracks.agent.segments).map(
    (silence) => {
      let turnId: string | null = null;
      let cause: SilenceReport['cause'] = null;
      let detail: string | null = null;
      if (silence.owner === 'agent_owed') {
        const index = callerEnds.findIndex(
          (end) => end !== null && Math.abs(end - silence.startSec) <= 0.6,
        );
        if (index >= 0) {
          turnId = rows[index].turnId;
          const turn = logsAvailable ? logByTurn.get(rows[index].turnId) : undefined;
          const attribution = attributeSilenceCause(turn ? causeInput(rows[index], turn) : null);
          cause = attribution.cause;
          detail = attribution.detail;
        } else {
          cause = logsAvailable ? 'unknown' : 'unknown_no_logs';
          detail = 'aucun tour ne correspond à ce silence';
        }
      }
      return { ...silence, turnId, cause, detail };
    },
  );

  // --- Tours de parole ---
  const unfinishedInputs: UnfinishedTurnInput[] = rows.map((row, index) => ({
    turnId: row.turnId,
    callerText: row.callerText ?? '',
    judgedIncomplete:
      logByTurn.get(row.turnId)?.decisions.some((decision) => decision.judge === 'incomplete') ??
      false,
    callerEndSec: callerEnds[index],
    agentStartSec:
      callerEnds[index] === null ? null : nextAgentStartAfter(callerEnds[index] as number),
  }));
  const unfinished = unfinishedVerdicts(unfinishedInputs, tracks.caller.segments);
  const overlaps = findOverlaps(tracks.caller.segments, tracks.agent.segments);

  const interruptions: InterruptionReport[] = [];
  let unclassified = 0;
  logTurns.forEach((turn) => {
    const rowIndex = rows.findIndex((row) => row.turnId === turn.turnId);
    for (const event of turn.interruptions.filter((item) => item.type === 'barge_in')) {
      const atSec = audioTimeOf(event.atMs);
      if (atSec === null) {
        unclassified++;
        continue;
      }
      const recentAgent = [rows[rowIndex - 1], rows[rowIndex]]
        .map((row, i) => (row ? sentClean[rowIndex - 1 + i] : ''))
        .join(' ');
      interruptions.push({
        ...classifyInterruption({
          atSec,
          callerSegments: tracks.caller.segments,
          callerWords: nova.words,
          agentRecentText: recentAgent,
        }),
        turnId: turn.turnId,
        atSec,
      });
    }
  });
  // Une lettre se perd ou se recolle quand le tour (ou le suivant) a été interrompu.
  const interruptedIndexes = interruptions
    .map((item) => rows.findIndex((row) => row.turnId === item.turnId))
    .filter((index) => index >= 0);
  for (const item of ears) {
    const index = rows.findIndex((row) => row.turnId === item.turnId);
    item.duringInterruption = interruptedIndexes.some((k) => index === k || index === k + 1);
  }
  if (unclassified > 0) {
    limits.push(
      `Horloge des journaux non recalée sur l’audio : ${unclassified} interruption(s) non classée(s).`,
    );
  }

  // --- Garde-fous, issue ---
  const guards = collectGuards(logTurns);
  const noCallerVoice = input.logEvents.filter((event) => event.type === 'no_caller_voice').length;

  const exchanges = rows
    .filter((row) => row.callerText || row.agentText)
    .map((row) => ({ callerText: row.callerText ?? '', agentText: row.agentText ?? null }));
  const lastCallerEnd = Math.max(0, ...tracks.caller.segments.map((segment) => segment[1]));
  const lastAgentEnd = Math.max(0, ...tracks.agent.segments.map((segment) => segment[1]));
  const lastAgentText = [...sentClean].reverse().find(Boolean) ?? '';
  // Une réservation voulue qui se termine sans réservation ni message est un abandon ; ou l'agent
  // pose une question à laquelle personne ne répond.
  const wantedReservation = call.intent === 'RESERVATION';
  const endedWithoutBooking = ['INFO', 'NO_ACTION', 'ERROR'].includes(call.outcome ?? '');
  const abandoned =
    (wantedReservation && endedWithoutBooking) ||
    (call.outcome !== 'RESERVED' &&
      lastAgentEnd > lastCallerEnd &&
      lastAgentText.trim().endsWith('?'));
  const outcome = { result: call.outcome, abandoned, lastExchanges: exchanges.slice(-3) };
  const splitSpellings = findSplitSpellings(
    rows.map((row) => ({ turnId: row.turnId, callerText: row.callerText })),
  );

  const issues = rankIssues({
    mouth,
    ears,
    silences,
    unfinished,
    overlaps,
    interruptions,
    guards,
    splitSpellings,
    outcome,
  });

  const engines = [transcripts.caller.nova, transcripts.caller.whisper, transcripts.agent]
    .filter((item): item is Transcription => Boolean(item))
    .map((item) => ({
      engine: item.engine,
      model: item.model,
      durationSec: item.durationSec,
      costUsd: item.costUsd,
    }));

  const summarize = (energy: TrackEnergy) => ({
    noiseFloorDbfs: energy.noiseFloorDbfs,
    speechLevelDbfs: energy.speechLevelDbfs,
    clippedRatio: energy.clippedRatio,
  });

  return redactDeep({
    reportVersion: REPORT_VERSION,
    generatedAt: (input.now ?? new Date()).toISOString(),
    call: {
      id: call.id,
      restaurantId: call.restaurantId,
      createdAt: call.createdAt,
      durationSec: call.durationSec,
      outcome: call.outcome,
    },
    logs: { status: input.logStatus, callKey: input.logCallKey ?? null },
    tracks: { caller: summarize(tracks.caller), agent: summarize(tracks.agent) },
    clock: { offsetSec, calibratedOnTurns: offsets.length },
    timeline,
    ears,
    mouth,
    silences,
    turnTaking: { unfinished, overlaps, interruptions, splitSpellings },
    guards,
    counters: { noCallerVoice },
    outcome,
    summary: { oneLine: oneLineSummary(issues), issues },
    engines,
    costUsd: engines.reduce((sum, engine) => sum + engine.costUsd, 0),
    limits,
  });
}

function spanText(
  transcription: Transcription,
  span: { start: number; end: number } | null,
): string | undefined {
  if (!span) return undefined;
  const text = transcription.words
    .filter((word) => word.end >= span.start - 0.05 && word.start <= span.end + 0.05)
    .map((word) => word.text)
    .join(' ');
  return text || undefined;
}

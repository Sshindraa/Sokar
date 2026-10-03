/** Formes partagées du rapport automatique d'un appel. */
import type { EarDivergence } from './ears';
import type { Guard } from './guards';
import type { Attribution, SilenceOwner } from './silences';
import type { Overlap, UnfinishedVerdict, InterruptionVerdict } from './turn-taking';
import type { LogSelection } from './log-events';
import type { Respelling } from './respelling';
import type { SplitSpelling } from './spelling';

export const REPORT_VERSION = 1;

/** Un tour tel que la lecture interne le sert (table voice_debug_turns + mesures du tour). */
export interface ReportTurnRow {
  sequence: number;
  turnId: string;
  callerText: string | null;
  agentText: string | null;
  fillerText?: string | null;
  speechAct?: string | null;
  tools?: string[];
  speechEndAt?: string | null;
  endOfSpeechToFirstAudioMs?: number | null;
  interrupted?: boolean;
}

export interface ReportCall {
  id: string;
  restaurantId: string;
  callSid: string;
  createdAt: string;
  durationSec: number | null;
  outcome: string | null;
  /** Intention détectée (RESERVATION, INFO…) : sans réservation à la fin, l'appel est abandonné. */
  intent?: string | null;
  recordingStartedAt: string | null;
}

export interface TurnReport {
  sequence: number;
  turnId: string;
  /** Ce que le direct a transcrit. */
  callerLive: string;
  /** Ce que les oreilles après coup entendent de la même parole. */
  callerHeard: { nova?: string; whisper?: string };
  /** Ce que le modèle a écrit dans `say` (première sortie du tour), si les journaux l'ont gardé. */
  modelSay: string | null;
  /** Le `say` de chaque passage du modèle dans le tour (un second passage remplace le premier). */
  modelSays: string[];
  /** Texte réellement envoyé à la synthèse vocale (les répliques coupées sont marquées). */
  agentSent: string | null;
  /** Ce que la piste agent contient pour ce tour. */
  agentHeard: string | null;
  callerSpan: { start: number; end: number } | null;
  agentStartSec: number | null;
  /** Fin de parole de l'appelant → première voix de l'agent, mesuré sur les pistes. */
  responseDelaySec: number | null;
  /** Le même délai lu dans les journaux, pour recoupement. */
  logDelayMs: number | null;
  judge: string | null;
  understanding: string | null;
}

export interface MouthDivergence extends EarDivergence {
  turnId: string | null;
  atSec: number | null;
  /** La réplique a été coupée par une interruption : un texte manquant n'est pas une faute de prononciation. */
  cutByInterruption: boolean;
}

export interface EarsReport extends EarDivergence {
  turnId: string | null;
  atSec: number | null;
  /** Le tour (ou le suivant) a été interrompu : c'est là qu'une lettre se perd ou se recolle. */
  duringInterruption: boolean;
}

export interface SilenceReport {
  startSec: number;
  endSec: number;
  durationSec: number;
  owner: SilenceOwner;
  turnId: string | null;
  cause: Attribution['cause'] | null;
  detail: string | null;
}

export interface InterruptionReport extends InterruptionVerdict {
  turnId: string;
  atSec: number | null;
}

export type IssueKind =
  | 'mouth_isolated_letters'
  | 'mouth_number'
  | 'ears_strong'
  | 'ears_live_wrong'
  | 'silence_false_unfinished'
  | 'silence_long'
  | 'agent_over_caller'
  | 'interruption_echo'
  | 'echo_stripped_words'
  | 'guard_name_refused'
  | 'systematic_ear_error'
  | 'spelling_split'
  | 'abandoned';

export interface Issue {
  kind: IssueKind;
  /** 0 à 100, sert au classement. */
  score: number;
  title: string;
  evidence: string;
  turnId: string | null;
  atSec: number | null;
}

export interface CallReport {
  reportVersion: number;
  generatedAt: string;
  call: {
    id: string;
    restaurantId: string;
    createdAt: string;
    durationSec: number | null;
    outcome: string | null;
  };
  logs: { status: LogSelection['status']; callKey: string | null };
  tracks: {
    caller: { noiseFloorDbfs: number; speechLevelDbfs: number | null; clippedRatio: number };
    agent: { noiseFloorDbfs: number; speechLevelDbfs: number | null; clippedRatio: number };
  };
  clock: { offsetSec: number | null; calibratedOnTurns: number };
  timeline: TurnReport[];
  ears: EarsReport[];
  mouth: MouthDivergence[];
  silences: SilenceReport[];
  turnTaking: {
    unfinished: UnfinishedVerdict[];
    overlaps: Overlap[];
    interruptions: InterruptionReport[];
    splitSpellings: SplitSpelling[];
    /** Lettres relues, non validées, puis épelées de nouveau à l'identique : erreur d'oreille systématique probable. */
    identicalRespellings: Respelling[];
  };
  guards: Guard[];
  counters: { noCallerVoice: number };
  outcome: {
    result: string | null;
    abandoned: boolean;
    /** Les derniers échanges (au plus trois), pour voir ce qui a précédé l'abandon. */
    lastExchanges: Array<{ callerText: string; agentText: string | null }>;
  };
  summary: { oneLine: string; issues: Issue[] };
  engines: Array<{ engine: string; model: string; durationSec: number; costUsd: number }>;
  costUsd: number;
  /** Limites de ce rapport (journaux manquants, horloge non recalée, oreille absente…). */
  limits: string[];
}

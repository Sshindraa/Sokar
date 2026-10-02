/**
 * Tâche du worker qui construit le rapport d'un appel de test après la fin de l'enregistrement.
 *
 * Elle ne touche pas à l'appel : elle tourne après lui, lit l'enregistrement privé, et écrit le
 * rapport à côté. Toute erreur est journalisée (sans texte d'appel) et absorbée : pas de nouvelle
 * tentative, pas de statut d'échec, pas d'effet sur le reste. Les dépendances sont injectées pour le
 * test ; le câblage réel est dans job-runtime.ts.
 */
import { generateCallReport } from './generate';
import type { Transcriber } from './deepgram-batch';
import { renderMarkdown } from './markdown';
import { reportStorageKeys } from '../call-recording.service';
import type { ReportCall, ReportTurnRow } from './types';

export function isCallReportEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CALL_REPORT_ENABLED === 'true';
}

export interface ReportCallRow {
  id: string;
  restaurantId: string;
  callSid: string;
  createdAt: Date;
  durationSec: number | null;
  outcome: string | null;
  intent: string | null;
  recordingStatus: string;
  recordingStorageKey: string | null;
  recordingStartedAt: Date | null;
}

export interface ReportJobDeps {
  isAllowed(restaurantId: string): boolean;
  findCall(callLegId: string): Promise<ReportCallRow | null>;
  loadTurns(call: ReportCallRow): Promise<ReportTurnRow[]>;
  readRecording(storageKey: string): Promise<Uint8Array>;
  readLogs(fromMs: number, toMs: number): Promise<string[]>;
  transcribe: Transcriber;
  store(storageKey: string, body: string, contentType: string): Promise<void>;
  log: {
    info(fields: Record<string, unknown>, message: string): void;
    warn(fields: Record<string, unknown>, message: string): void;
  };
}

export type ReportJobResult =
  | { status: 'stored' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed' };

/** Marge avant la création de l'appel et après sa fin, pour les lignes de journal qui l'entourent. */
const LOG_MARGIN_BEFORE_MS = 30_000;
const LOG_MARGIN_AFTER_MS = 90_000;

export async function buildCallReportJob(
  callLegId: string,
  deps: ReportJobDeps,
): Promise<ReportJobResult> {
  const call = await deps.findCall(callLegId).catch(() => null);
  if (!call) return { status: 'skipped', reason: 'call_not_found' };
  if (!deps.isAllowed(call.restaurantId)) {
    return { status: 'skipped', reason: 'restaurant_not_allowed' };
  }
  if (call.recordingStatus !== 'AVAILABLE' || !call.recordingStorageKey) {
    return { status: 'skipped', reason: 'recording_unavailable' };
  }

  try {
    const mp3 = await deps.readRecording(call.recordingStorageKey);
    const turns = await deps.loadTurns(call);
    const createdMs = call.createdAt.getTime();
    const logLines = await deps.readLogs(
      createdMs - LOG_MARGIN_BEFORE_MS,
      createdMs + (call.durationSec ?? 300) * 1000 + LOG_MARGIN_AFTER_MS,
    );
    const reportCall: ReportCall = {
      id: call.id,
      restaurantId: call.restaurantId,
      callSid: call.callSid,
      createdAt: call.createdAt.toISOString(),
      durationSec: call.durationSec,
      outcome: call.outcome,
      intent: call.intent,
      recordingStartedAt: call.recordingStartedAt?.toISOString() ?? null,
    };
    const report = await generateCallReport(
      { call: reportCall, turns, logLines, mp3 },
      { transcribe: deps.transcribe },
    );
    const keys = reportStorageKeys(call.recordingStorageKey);
    await deps.store(keys.json, JSON.stringify(report, null, 1), 'application/json');
    await deps.store(keys.markdown, renderMarkdown(report), 'text/markdown');
    // Comptes et mesures seulement : jamais de texte d'appel dans les journaux.
    deps.log.info(
      {
        callId: call.id,
        restaurantId: call.restaurantId,
        logs: report.logs.status,
        issues: report.summary.issues.length,
        silencesOver2s: report.silences.filter((item) => item.durationSec > 2).length,
        earsDivergences: report.ears.filter((item) => item.severity === 'high').length,
        mouthDivergences: report.mouth.filter((item) => item.severity === 'high').length,
        costUsd: Number(report.costUsd.toFixed(4)),
      },
      '[call-report] stored',
    );
    return { status: 'stored' };
  } catch (err) {
    deps.log.warn(
      {
        callId: call.id,
        restaurantId: call.restaurantId,
        err: err instanceof Error ? err.message : String(err),
      },
      '[call-report] generation failed (no effect on the call)',
    );
    return { status: 'failed' };
  }
}

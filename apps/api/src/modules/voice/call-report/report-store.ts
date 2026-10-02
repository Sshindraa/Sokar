/**
 * Lecture des rapports déjà stockés : un rapport par appel, et le résumé d'une journée. Appelé sur le
 * VPS par `voice_call_audio.py report` (le stockage privé n'est accessible que depuis le VPS).
 */
import { db } from '../../../shared/db/client';
import {
  getPrivateRecording,
  isTestCallRecordingEnabled,
  reportStorageKeys,
} from '../call-recording.service';
import { parisDayRange, renderDailySummary, summarizeReports } from './daily-summary';
import type { CallReport } from './types';

async function readText(storageKey: string): Promise<string | null> {
  try {
    const object = await getPrivateRecording(storageKey);
    const chunks: Uint8Array[] = [];
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'NoSuchKey' || name === 'NotFound') return null;
    throw err;
  }
}

/** Le rapport d'un appel (début de l'id accepté), ou null s'il n'existe pas ou hors liste des tests. */
export async function readStoredReport(
  callIdPrefix: string,
  format: 'markdown' | 'json',
): Promise<string | null> {
  // tenant-scoping: global — lecture interne ; le restaurant est contrôlé contre la liste des tests.
  const call = await db.call.findFirst({
    where: { id: { startsWith: callIdPrefix } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, restaurantId: true, recordingStorageKey: true },
  });
  if (!call?.recordingStorageKey || !isTestCallRecordingEnabled(call.restaurantId)) return null;
  const keys = reportStorageKeys(call.recordingStorageKey);
  return readText(format === 'json' ? keys.json : keys.markdown);
}

/** Résumé Markdown des rapports d'une journée locale de Paris (AAAA-MM-JJ). */
export async function loadDailySummary(day: string, restaurantId?: string): Promise<string> {
  const { fromMs, toMs } = parisDayRange(day);
  // tenant-scoping: global — lecture interne ; seuls les restaurants de test ont un enregistrement.
  const calls = await db.call.findMany({
    where: {
      recordingStatus: 'AVAILABLE',
      createdAt: { gte: new Date(fromMs), lt: new Date(toMs) },
      ...(restaurantId ? { restaurantId } : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, restaurantId: true, recordingStorageKey: true },
  });
  const reports: CallReport[] = [];
  for (const call of calls) {
    if (!call.recordingStorageKey || !isTestCallRecordingEnabled(call.restaurantId)) continue;
    const text = await readText(reportStorageKeys(call.recordingStorageKey).json);
    if (text) reports.push(JSON.parse(text) as CallReport);
  }
  return renderDailySummary(day, summarizeReports(reports));
}

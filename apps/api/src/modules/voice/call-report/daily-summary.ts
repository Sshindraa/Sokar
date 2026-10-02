/**
 * Résumé quotidien des rapports d'appel : combien d'appels, de silences de plus de 2 s, de divergences
 * de transcription, d'écarts de prononciation, d'abandons, avec la commande qui ouvre chaque rapport.
 */
import type { CallReport } from './types';

export interface DailySummary {
  calls: number;
  silencesOver2s: number;
  earsDivergences: number;
  mouthDivergences: number;
  abandoned: number;
  /** Rapports générés sans les journaux du serveur : leurs causes de silence manquent. */
  withoutLogs: number;
  costUsd: number;
  lines: Array<{ callId: string; createdAt: string; oneLine: string; abandoned: boolean }>;
}

export function summarizeReports(reports: readonly CallReport[]): DailySummary {
  const summary: DailySummary = {
    calls: reports.length,
    silencesOver2s: 0,
    earsDivergences: 0,
    mouthDivergences: 0,
    abandoned: 0,
    withoutLogs: 0,
    costUsd: 0,
    lines: [],
  };
  for (const report of reports) {
    summary.silencesOver2s += report.silences.filter(
      (silence) => silence.owner === 'agent_owed' && silence.durationSec > 2,
    ).length;
    summary.earsDivergences += report.ears.filter((item) => item.severity === 'high').length;
    summary.mouthDivergences += report.mouth.filter(
      (item) => item.severity === 'high' && !item.cutByInterruption,
    ).length;
    if (report.outcome.abandoned) summary.abandoned++;
    if (report.logs.status === 'missing' || report.logs.status === 'ambiguous')
      summary.withoutLogs++;
    summary.costUsd += report.costUsd;
    summary.lines.push({
      callId: report.call.id,
      createdAt: report.call.createdAt,
      oneLine: report.summary.oneLine,
      abandoned: report.outcome.abandoned,
    });
  }
  summary.lines.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return summary;
}

export function renderDailySummary(day: string, summary: DailySummary): string {
  const lines = [`# Résumé des appels du ${day}`, ''];
  if (summary.calls === 0) return [...lines, 'Aucun rapport pour cette journée.', ''].join('\n');
  lines.push(
    `- Appels avec rapport : **${summary.calls}**`,
    `- Silences de plus de 2 s avant la réponse de l'agent : **${summary.silencesOver2s}**`,
    `- Divergences de transcription (lettre ou nombre, direct contre après coup) : **${summary.earsDivergences}**`,
    `- Écarts de prononciation (texte envoyé contre piste agent) : **${summary.mouthDivergences}**`,
    `- Appels abandonnés (réservation voulue, aucune réservation) : **${summary.abandoned}**`,
    `- Coût des transcriptions après coup : ≈ ${summary.costUsd.toFixed(3)} $`,
  );
  if (summary.withoutLogs > 0) {
    lines.push(
      `- ⚠ ${summary.withoutLogs} rapport(s) sans journaux du serveur (rotation à 14 jours) : causes des silences indisponibles.`,
    );
  }
  lines.push('', '## Appels', '');
  for (const line of summary.lines) {
    lines.push(
      `- ${line.createdAt.slice(11, 16)} UTC · \`voice_call_audio.py report ${line.callId.slice(0, 8)}\`${line.abandoned ? ' · abandon' : ''} — ${line.oneLine}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** Début et fin (exclue) de la journée locale de Paris, en millisecondes UTC. */
export function parisDayRange(day: string): { fromMs: number; toMs: number } {
  const [year, month, date] = day.split('-').map(Number);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const startOf = (y: number, m: number, d: number): number => {
    for (const offsetHours of [1, 2]) {
      const candidate = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetHours * 3_600_000;
      const parts = Object.fromEntries(
        formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]),
      );
      if (
        Number(parts.year) === y &&
        Number(parts.month) === m &&
        Number(parts.day) === d &&
        Number(parts.hour) === 0
      ) {
        return candidate;
      }
    }
    return Date.UTC(y, m - 1, d, 0, 0, 0);
  };
  const next = new Date(Date.UTC(year, month - 1, date + 1));
  return {
    fromMs: startOf(year, month, date),
    toMs: startOf(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()),
  };
}

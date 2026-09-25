/**
 * Banc narrowband (phase 1) — scoring local (gratuit, hors ligne).
 *
 * Pour chaque condition (A/B/C/D) et chaque variante (propre/bruit) :
 *   - % d'informations critiques correctes, global et par catégorie ;
 *   - WER normalisé (minuscules, ponctuation retirée, chiffres = lettres) ;
 *   - latence du dernier chunk au transcript final (moyenne, écart, p50/p95) ;
 *   - nombre de messages WebSocket envoyés.
 *
 * Les répétitions donnent moyenne et écart-type ; la variante bruitée utilise
 * plusieurs seeds de bruit. Croise aussi B et A pour lister les 10 pires
 * erreurs de B et dire si A les corrige.
 *
 * Dénominateur : **toutes** les sessions comptent, y compris celles sans
 * transcript (silence, bruit) et les erreurs fournisseur. Une session vide est
 * un échec de transcription : ses informations critiques sont fausses et son
 * WER vaut 1 (référence entièrement manquante). Les exclure gonflait le taux de
 * réussite et faisait varier le dénominateur de 69 à 93 selon la condition.
 *
 * Usage :
 *   pnpm --filter @sokar/api exec tsx scripts/voice-stt-bench/nb-score.ts .data/nb-results.json
 */
import { readFileSync } from 'node:fs';
import { NB_CORPUS, ALL_CATEGORIES, type CriticalCategory } from './nb-corpus';
import { digitSequence, normalizeTokens, wordErrorRate } from './nb-normalize';
import type { BenchRecord, Condition, Variant } from './nb-run';

const CLIP_BY_ID = new Map(NB_CORPUS.map((clip) => [clip.id, clip]));
const CONDITIONS: Condition[] = ['A', 'B', 'C', 'D', 'E'];
const VARIANTS: Variant[] = ['clean', 'noisy'];
const VARIANT_LABEL: Record<Variant, string> = { clean: 'propre', noisy: 'bruit' };

function hasCritical(transcript: string, category: CriticalCategory, value: string): boolean {
  if (category === 'telephone') return digitSequence(transcript).includes(value);
  return normalizeTokens(transcript).includes(value);
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round(fraction * (sorted.length - 1))),
  );
  return sorted[index];
}

interface Cell {
  records: BenchRecord[];
  criticalTotal: number;
  criticalCorrect: number;
  perCategory: Map<CriticalCategory, { total: number; correct: number }>;
  wer: number[];
  latency: number[];
  messages: number[];
  /** Sessions au transcript vide ou en erreur, comptées comme échecs. */
  failed: number;
}

function emptyCell(): Cell {
  return {
    records: [],
    criticalTotal: 0,
    criticalCorrect: 0,
    perCategory: new Map(),
    wer: [],
    latency: [],
    messages: [],
    failed: 0,
  };
}

function main(): void {
  const resultsPath = process.argv[2] ?? '.data/nb-results.json';
  const records = JSON.parse(readFileSync(resultsPath, 'utf8')) as BenchRecord[];

  const cells = new Map<string, Cell>();
  const key = (condition: Condition, variant: Variant) => `${condition}|${variant}`;
  for (const condition of CONDITIONS) {
    for (const variant of VARIANTS) cells.set(key(condition, variant), emptyCell());
  }

  for (const record of records) {
    const cell = cells.get(key(record.condition, record.variant));
    if (!cell) continue;
    cell.records.push(record);

    const clip = CLIP_BY_ID.get(record.clipId);
    const transcript = record.error ? '' : record.transcript.trim();
    if (transcript.length === 0 || record.error) cell.failed++;

    // Session vide ou en erreur = échec : tous les faits attendus sont faux et
    // le WER vaut 1 (aucune hypothèse face à la référence complète).
    cell.wer.push(wordErrorRate(clip?.text ?? record.text, transcript).wer);
    if (record.latencyMs >= 0) cell.latency.push(record.latencyMs);
    cell.messages.push(record.messagesSent);

    for (const critical of clip?.critical ?? []) {
      cell.criticalTotal++;
      const bucket = cell.perCategory.get(critical.category) ?? { total: 0, correct: 0 };
      bucket.total++;
      if (hasCritical(transcript, critical.category, critical.value)) {
        cell.criticalCorrect++;
        bucket.correct++;
      }
      cell.perCategory.set(critical.category, bucket);
    }
  }

  const pct = (value: number) => `${(100 * value).toFixed(1)} %`;
  const lines: string[] = [];

  lines.push('', '## Informations critiques correctes', '');
  lines.push(
    'Toutes les sessions comptent : une session vide ou en erreur est un échec (dénominateur constant).',
    '',
    '| Condition | Variante | Sessions | dont vides/erreur | Critiques correctes | WER moyen | WER écart | Latence moy. (ms) | Latence p50/p95 | Messages WS |',
    '|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const condition of CONDITIONS) {
    for (const variant of VARIANTS) {
      const cell = cells.get(key(condition, variant))!;
      const correctRate = cell.criticalTotal ? cell.criticalCorrect / cell.criticalTotal : 0;
      lines.push(
        `| ${condition} | ${VARIANT_LABEL[variant]} | ${cell.records.length} | ` +
          `${cell.failed} | ` +
          `${cell.criticalCorrect}/${cell.criticalTotal} (${pct(correctRate)}) | ` +
          `${mean(cell.wer).toFixed(3)} | ${stdDev(cell.wer).toFixed(3)} | ` +
          `${mean(cell.latency).toFixed(0)} | ${percentile(cell.latency, 0.5).toFixed(0)}/${percentile(cell.latency, 0.95).toFixed(0)} | ` +
          `${mean(cell.messages).toFixed(1)} |`,
      );
    }
  }

  lines.push('', '## Informations critiques par catégorie', '');
  lines.push(
    `| Condition | Variante | ${ALL_CATEGORIES.join(' | ')} |`,
    `|---|---|${ALL_CATEGORIES.map(() => '---').join('|')}|`,
  );
  for (const condition of CONDITIONS) {
    for (const variant of VARIANTS) {
      const cell = cells.get(key(condition, variant))!;
      const perCategory = ALL_CATEGORIES.map((category) => {
        const bucket = cell.perCategory.get(category);
        if (!bucket) return '—';
        return `${bucket.correct}/${bucket.total} (${pct(bucket.correct / bucket.total)})`;
      });
      lines.push(`| ${condition} | ${VARIANT_LABEL[variant]} | ${perCategory.join(' | ')} |`);
    }
  }

  // 10 pires erreurs de B (propre) et correction par A (propre).
  const bClean = cells.get(key('B', 'clean'))!.records;
  const aCleanByClip = new Map(
    cells.get(key('A', 'clean'))!.records.map((record) => [record.clipId, record]),
  );
  const errorDetails = bClean
    // Les sessions vides comptent aussi : ce sont les pires erreurs possibles.
    .map((record) => {
      const clip = CLIP_BY_ID.get(record.clipId);
      const criticallyCorrect = (clip?.critical ?? []).filter((critical) =>
        hasCritical(record.transcript, critical.category, critical.value),
      );
      const missing = (clip?.critical ?? []).filter(
        (critical) => !hasCritical(record.transcript, critical.category, critical.value),
      );
      const aTranscript = aCleanByClip.get(record.clipId)?.transcript ?? '';
      const fixedByA = missing.every((critical) =>
        hasCritical(aTranscript, critical.category, critical.value),
      );
      return {
        record,
        missing,
        criticallyCorrect: criticallyCorrect.length,
        fixedByA,
        wer: wordErrorRate(clip?.text ?? record.text, record.transcript).wer,
      };
    })
    .filter((entry) => entry.missing.length > 0)
    .sort((left, right) => right.wer - left.wer)
    .slice(0, 10);

  lines.push('', '## 10 pires erreurs de B (propre) et correction par A', '');
  lines.push(
    '| # | Clip | Attendu | (manquant) | Transcript B | A corrige ? | A entendu |',
    '|---|---|---|---|---|---|---|',
  );
  errorDetails.forEach((entry, index) => {
    const clip = CLIP_BY_ID.get(entry.record.clipId);
    const expected = (clip?.critical ?? [])
      .map((critical) => `${critical.category}=${critical.value}`)
      .join(', ');
    const missing = entry.missing
      .map((critical) => `${critical.category}=${critical.value}`)
      .join(', ');
    const aTranscript = aCleanByClip.get(entry.record.clipId)?.transcript ?? '';
    lines.push(
      `| ${index + 1} | ${entry.record.clipId} | ${expected} | ${missing || '—'} | ` +
        `« ${entry.record.transcript.trim() || (entry.record.error ? `erreur : ${entry.record.error}` : '(vide)')} » | ` +
        `${entry.fixedByA ? 'oui' : 'non'} | « ${aTranscript} » |`,
    );
  });
  if (!errorDetails.length)
    lines.push('| — | — | — | — | aucune erreur critique en B propre | — | — |');

  process.stdout.write(`${lines.join('\n')}\n`);
}

main();

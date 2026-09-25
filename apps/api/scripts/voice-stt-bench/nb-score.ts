/**
 * Banc narrowband (phase 1) — scoring local (gratuit, hors ligne).
 *
 * Pour chaque condition (A/B/C/D/E/F) et chaque variante (propre/bruit) :
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
import { createHash } from 'node:crypto';
import { NB_CORPUS, ALL_CATEGORIES, type CriticalCategory } from './nb-corpus';
import { digitSequence, normalizeTokens, wordErrorRate } from './nb-normalize';
import type { BenchRecord, Condition, Variant } from './nb-run';

const CLIP_BY_ID = new Map(NB_CORPUS.map((clip) => [clip.id, clip]));
const CONDITIONS: Condition[] = ['A', 'B', 'C', 'D', 'E', 'F'];
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

function formatMeanDelta(values: number[], digits: number, suffix = ''): string {
  const average = mean(values);
  return `${average >= 0 ? '+' : ''}${average.toFixed(digits)} ± ${stdDev(values).toFixed(digits)}${suffix}`;
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

function metricsByRepeat(
  records: BenchRecord[],
  condition: Condition,
  variant: Variant,
): Map<number, { criticalRate: number; wer: number; latency: number }> {
  const grouped = new Map<
    number,
    { correct: number; total: number; wers: number[]; latencies: number[] }
  >();
  for (const record of records) {
    if (record.condition !== condition || record.variant !== variant || record.noiseOnly) continue;
    const clip = CLIP_BY_ID.get(record.clipId);
    const bucket = grouped.get(record.repeat) ?? { correct: 0, total: 0, wers: [], latencies: [] };
    const transcript = record.error ? '' : record.transcript.trim();
    for (const critical of clip?.critical ?? []) {
      bucket.total++;
      if (hasCritical(transcript, critical.category, critical.value)) {
        bucket.correct++;
      }
    }
    bucket.wers.push(wordErrorRate(clip?.text ?? record.text, transcript).wer);
    if (record.latencyMs >= 0) bucket.latencies.push(record.latencyMs);
    grouped.set(record.repeat, bucket);
  }
  return new Map(
    [...grouped].map(([repeat, bucket]) => [
      repeat,
      {
        criticalRate: bucket.total ? bucket.correct / bucket.total : 0,
        wer: mean(bucket.wers),
        latency: mean(bucket.latencies),
      },
    ]),
  );
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
  const resultsPaths = process.argv.slice(2);
  const inputPaths = resultsPaths.length ? resultsPaths : ['.data/nb-results.json'];
  const records = inputPaths.flatMap(
    (resultsPath) => JSON.parse(readFileSync(resultsPath, 'utf8')) as BenchRecord[],
  );

  const cells = new Map<string, Cell>();
  const key = (condition: Condition, variant: Variant) => `${condition}|${variant}`;
  for (const condition of CONDITIONS) {
    for (const variant of VARIANTS) cells.set(key(condition, variant), emptyCell());
  }

  for (const record of records) {
    if (record.noiseOnly) continue;
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

  lines.push('', '## Variation appariée B/F entre répétitions', '');
  lines.push(
    '| Variante | B critiques par répétition | F critiques par répétition | Δ critiques (points) | Δ WER | Δ latence (ms) |',
    '|---|---|---|---:|---:|---:|',
  );
  for (const variant of VARIANTS) {
    const bMetrics = metricsByRepeat(records, 'B', variant);
    const fMetrics = metricsByRepeat(records, 'F', variant);
    const pairedRepeats = [...bMetrics.keys()]
      .filter((repeat) => fMetrics.has(repeat))
      .sort((left, right) => left - right);
    const criticalDeltas = pairedRepeats.map(
      (repeat) => (fMetrics.get(repeat)!.criticalRate - bMetrics.get(repeat)!.criticalRate) * 100,
    );
    const werDeltas = pairedRepeats.map(
      (repeat) => fMetrics.get(repeat)!.wer - bMetrics.get(repeat)!.wer,
    );
    const latencyDeltas = pairedRepeats.map(
      (repeat) => fMetrics.get(repeat)!.latency - bMetrics.get(repeat)!.latency,
    );
    const bSummary = pairedRepeats
      .map((repeat) => `R${repeat + 1} ${pct(bMetrics.get(repeat)!.criticalRate)}`)
      .join('; ');
    const fSummary = pairedRepeats
      .map((repeat) => `R${repeat + 1} ${pct(fMetrics.get(repeat)!.criticalRate)}`)
      .join('; ');
    lines.push(
      `| ${VARIANT_LABEL[variant]} | ${bSummary || '—'} | ${fSummary || '—'} | ` +
        `${formatMeanDelta(criticalDeltas, 1, ' pt')} | ` +
        `${formatMeanDelta(werDeltas, 3)} | ${formatMeanDelta(latencyDeltas, 0, ' ms')} |`,
    );
  }

  // Expose uniquement des empreintes de transcripts : jamais de texte brut dans les rapports.
  const bClean = cells.get(key('B', 'clean'))!.records;
  const aCleanByClip = new Map(
    cells
      .get(key('A', 'clean'))!
      .records.map((record) => [`${record.clipId}|${record.repeat}`, record]),
  );
  const errorDetails = bClean
    // Les sessions vides comptent aussi : ce sont les pires erreurs possibles.
    .map((record) => {
      const clip = CLIP_BY_ID.get(record.clipId);
      const bTranscript = record.error ? '' : record.transcript;
      const criticallyCorrect = (clip?.critical ?? []).filter((critical) =>
        hasCritical(bTranscript, critical.category, critical.value),
      );
      const missing = (clip?.critical ?? []).filter(
        (critical) => !hasCritical(bTranscript, critical.category, critical.value),
      );
      const aRecord = aCleanByClip.get(`${record.clipId}|${record.repeat}`);
      const aTranscript = aRecord?.error ? '' : (aRecord?.transcript ?? '');
      const fixedByA = missing.every((critical) =>
        hasCritical(aTranscript, critical.category, critical.value),
      );
      return {
        record,
        bTranscript,
        aTranscript,
        missing: missing.map((critical) => critical.category),
        criticallyCorrect: criticallyCorrect.length,
        fixedByA,
        wer: wordErrorRate(clip?.text ?? record.text, bTranscript).wer,
      };
    })
    .filter((entry) => entry.missing.length > 0)
    .sort((left, right) => right.wer - left.wer)
    .slice(0, 10);

  lines.push('', '## 10 pires erreurs de B (propre) et correction par A', '');
  lines.push(
    '| # | Clip | Catégories manquantes | B longueur/empreinte | A corrige ? | A longueur/empreinte |',
    '|---|---|---|---|---|---|---|',
  );
  errorDetails.forEach((entry, index) => {
    const fingerprint = (value: string) =>
      createHash('sha256').update(value).digest('hex').slice(0, 12);
    lines.push(
      `| ${index + 1} | ${entry.record.clipId} | ${entry.missing.join(', ') || '—'} | ` +
        `${entry.bTranscript.length}/${fingerprint(entry.bTranscript)} | ` +
        `${entry.fixedByA ? 'oui' : 'non'} | ${entry.aTranscript.length}/${fingerprint(entry.aTranscript)} |`,
    );
  });
  if (!errorDetails.length)
    lines.push('| — | — | — | aucune erreur critique en B propre | — | — |');

  const noiseControls = records.filter((record) => record.noiseOnly);
  lines.push('', '## Faux déclenchements sur bruit seul', '');
  lines.push(
    '| Condition | Sessions | Texte commité | Erreurs fournisseur |',
    '|---|---:|---:|---:|',
  );
  for (const condition of ['B', 'F'] as const) {
    const controls = noiseControls.filter((record) => record.condition === condition);
    const triggered = controls.filter((record) => record.transcript.trim().length > 0).length;
    const errors = controls.filter((record) => Boolean(record.error)).length;
    lines.push(`| ${condition} | ${controls.length} | ${triggered} | ${errors} |`);
  }
  lines.push(
    '',
    '| Seed bruit | Condition | Texte commité | Erreur fournisseur |',
    '|---:|---|---:|---:|',
  );
  const noiseSeeds = [
    ...new Set(
      noiseControls
        .map((record) => record.noiseSeed)
        .filter((seed): seed is number => seed !== null),
    ),
  ].sort((left, right) => left - right);
  for (const seed of noiseSeeds) {
    for (const condition of ['B', 'F'] as const) {
      const record = noiseControls.find(
        (entry) => entry.noiseSeed === seed && entry.condition === condition,
      );
      lines.push(
        `| ${seed} | ${condition} | ${record?.transcript.trim() ? 1 : 0} | ${record?.error ? 1 : 0} |`,
      );
    }
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

main();

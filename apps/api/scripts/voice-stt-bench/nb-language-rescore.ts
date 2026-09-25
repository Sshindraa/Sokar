/** Rescore offline les tours B/E que l'application FR pourrait récupérer. */
import { readFileSync } from 'node:fs';
import { NB_CORPUS, type CriticalCategory } from './nb-corpus';
import { digitSequence, normalizeTokens } from './nb-normalize';
import type { BenchRecord } from './nb-run';
import { extractConversationSlots } from '../../src/modules/voice/stream/conversation-controller';

const clips = new Map(NB_CORPUS.map((clip) => [clip.id, clip]));
const categoryField: Partial<Record<CriticalCategory, 'date' | 'time' | 'partySize'>> = {
  chiffres: 'partySize',
  heures: 'time',
  dates: 'date',
};

function isLikelyNonFrench(record: BenchRecord): boolean {
  if (record.detectedLanguage) return record.detectedLanguage.split('-')[0].toLowerCase() !== 'fr';
  const value = record.transcript.toLocaleLowerCase('fr-FR').normalize('NFD');
  const english = /\b(?:at|people|guests|tomorrow|reservation|booking|table for|we are)\b/u;
  const dutch = /\b(?:zo gaat|gaat|reservering|morgen|voor|uur)\b/u;
  return english.test(value) || dutch.test(value);
}

function baselineCorrect(transcript: string, category: CriticalCategory, value: string): boolean {
  if (category === 'telephone') return digitSequence(transcript).includes(value);
  return normalizeTokens(transcript).includes(value);
}

function parserRecovered(
  transcript: string,
  expected: string,
  category: CriticalCategory,
  reference: string,
): boolean {
  const field = categoryField[category];
  if (!field) return false;
  const timezone = 'Europe/Paris';
  const extracted = extractConversationSlots(transcript, timezone);
  if (field === 'partySize') return extracted.partySize === Number(expected);
  if (field === 'time') return extracted.time === expected;
  const expectedDate = extractConversationSlots(reference, timezone).date;
  return Boolean(expectedDate && extracted.date === expectedDate);
}

interface ScoreCell {
  sessions: number;
  nonFrench: number;
  criticalTotal: number;
  baselineCorrect: number;
  recovered: number;
  byCategory: Map<CriticalCategory, { total: number; correct: number; recovered: number }>;
}

function main(): void {
  const paths = process.argv.slice(2);
  const inputPaths = paths.length
    ? paths
    : [
        'scripts/voice-stt-bench/.data/nb-results.json',
        'scripts/voice-stt-bench/.data/nb-results-E.json',
      ];
  const records = inputPaths.flatMap(
    (file) => JSON.parse(readFileSync(file, 'utf8')) as BenchRecord[],
  );
  const cells = new Map<string, ScoreCell>();
  const keyFor = (condition: string, variant: string) => `${condition}|${variant}`;

  for (const record of records) {
    if (!['B', 'E'].includes(record.condition) || record.noiseOnly) continue;
    const key = keyFor(record.condition, record.variant);
    const cell = cells.get(key) ?? {
      sessions: 0,
      nonFrench: 0,
      criticalTotal: 0,
      baselineCorrect: 0,
      recovered: 0,
      byCategory: new Map(),
    };
    cell.sessions++;
    const transcript = record.error ? '' : record.transcript;
    const nonFrench = isLikelyNonFrench(record);
    if (nonFrench) cell.nonFrench++;
    const clip = clips.get(record.clipId);
    for (const critical of clip?.critical ?? []) {
      const correct = baselineCorrect(transcript, critical.category, critical.value);
      const recovered =
        !correct &&
        nonFrench &&
        !record.error &&
        parserRecovered(transcript, critical.value, critical.category, clip?.text ?? record.text);
      cell.criticalTotal++;
      if (correct) cell.baselineCorrect++;
      if (recovered) cell.recovered++;
      const bucket = cell.byCategory.get(critical.category) ?? {
        total: 0,
        correct: 0,
        recovered: 0,
      };
      bucket.total++;
      if (correct) bucket.correct++;
      if (recovered) bucket.recovered++;
      cell.byCategory.set(critical.category, bucket);
    }
    cells.set(key, cell);
  }

  const pct = (value: number, total: number) =>
    total ? `${((100 * value) / total).toFixed(1)} %` : '—';
  process.stdout.write(
    [
      'Détection non-FR : language_code enregistré si présent, sinon heuristique lexicale conservatrice (les anciennes données ne stockent pas language_code).',
      '',
      '| Condition | Variante | Sessions | Non-FR estimés | Récupérations exactes | Score initial | Score après parseur |',
      '|---|---|---:|---:|---:|---:|---:|',
      ...['B', 'E'].flatMap((condition) =>
        ['clean', 'noisy'].map((variant) => {
          const cell = cells.get(keyFor(condition, variant));
          if (!cell) return `| ${condition} | ${variant} | 0 | 0 | 0 | — | — |`;
          return (
            `| ${condition} | ${variant} | ${cell.sessions} | ${cell.nonFrench} | ${cell.recovered} | ` +
            `${cell.baselineCorrect}/${cell.criticalTotal} (${pct(cell.baselineCorrect, cell.criticalTotal)}) | ` +
            `${cell.baselineCorrect + cell.recovered}/${cell.criticalTotal} ` +
            `(${pct(cell.baselineCorrect + cell.recovered, cell.criticalTotal)}) |`
          );
        }),
      ),
      '',
      '| Condition | Variante | Catégorie | Correct initial | Récupérés |',
      '|---|---|---|---:|---:|',
      ...['B', 'E'].flatMap((condition) =>
        ['clean', 'noisy'].flatMap((variant) => {
          const cell = cells.get(keyFor(condition, variant));
          return [...(cell?.byCategory ?? new Map())].map(
            ([category, bucket]) =>
              `| ${condition} | ${variant} | ${category} | ${bucket.correct}/${bucket.total} | ${bucket.recovered} |`,
          );
        }),
      ),
      '',
    ].join('\n'),
  );
}

main();

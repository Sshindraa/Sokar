import { readFileSync } from 'node:fs';
import { ALL_CATEGORIES, NB_CORPUS, type CriticalCategory } from './nb-corpus';
import { digitSequence, normalizeTokens, wordErrorRate } from './nb-normalize';

type FormatMode = 'smart' | 'numerals' | 'none';
type Variant = 'clean' | 'noisy';
interface Result {
  clipId: string;
  condition: 'B';
  variant: Variant;
  formatMode: FormatMode;
  transcript: string;
  error: string | null;
  text: string;
}

const clips = new Map(NB_CORPUS.map((clip) => [clip.id, clip]));
const modes: FormatMode[] = ['smart', 'numerals', 'none'];
const variants: Variant[] = ['clean', 'noisy'];

function criticalMatches(transcript: string, category: CriticalCategory, value: string): boolean {
  if (category === 'telephone') return digitSequence(transcript).includes(value);
  return normalizeTokens(transcript).includes(value);
}

function main(): void {
  const paths = process.argv.slice(2);
  if (!paths.length) throw new Error('Indiquer les trois fichiers JSON de résultats');
  const records = paths.flatMap((file) => JSON.parse(readFileSync(file, 'utf8')) as Result[]);
  const keys = modes.flatMap((mode) => variants.map((variant) => `${mode}|${variant}`));
  const cells = new Map(keys.map((key) => [key, [] as Result[]]));
  for (const record of records) cells.get(`${record.formatMode}|${record.variant}`)?.push(record);

  const lines = [
    '| Réglage | Variante | Sessions / erreurs | Informations critiques | ' +
      ALL_CATEGORIES.join(' | ') +
      ' | WER moyen |',
    '|---|---|---:|---:|' + ALL_CATEGORIES.map(() => '---:').join('|') + '|---:|',
  ];
  for (const mode of modes) {
    for (const variant of variants) {
      const cell = cells.get(`${mode}|${variant}`) ?? [];
      let total = 0;
      let correct = 0;
      let errors = 0;
      let werTotal = 0;
      const categoryCounts = new Map(ALL_CATEGORIES.map((category) => [category, [0, 0]]));
      for (const record of cell) {
        const transcript = record.error ? '' : record.transcript.trim();
        if (record.error || !transcript) errors++;
        const clip = clips.get(record.clipId);
        werTotal += wordErrorRate(clip?.text ?? record.text, transcript).wer;
        for (const critical of clip?.critical ?? []) {
          total++;
          const counts = categoryCounts.get(critical.category)!;
          counts[1]++;
          if (criticalMatches(transcript, critical.category, critical.value)) {
            correct++;
            counts[0]++;
          }
        }
      }
      const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
      const categorySummary = ALL_CATEGORIES.map((category) => {
        const [n, d] = categoryCounts.get(category)!;
        return `${n}/${d} (${pct(n, d)})`;
      });
      lines.push(
        `| ${mode} | ${variant} | ${cell.length} / ${errors} | ${correct}/${total} ` +
          `(${pct(correct, total)}) | ${categorySummary.join(' | ')} | ` +
          `${cell.length ? (werTotal / cell.length).toFixed(3) : '—'} |`,
      );
    }
  }
  process.stdout.write(lines.join('\n') + '\n');
}

main();

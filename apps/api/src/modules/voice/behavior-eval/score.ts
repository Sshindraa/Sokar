import { reconcileSpelledName } from '../stream/structured-turn/fact-guards';
import type { StructuredTurnDraft } from '../stream/structured-turn/schema';
import type {
  BehaviorCase,
  BehaviorCheck,
  BehaviorResponses,
  BehaviorSplit,
  BehaviorSummary,
  CaseResult,
  CheckResult,
  PerturbationKind,
  SamplePredicate,
  SplitSummary,
} from './types';

/** En dessous, le modèle ou le réseau a un problème : le cas échoue quel que soit le reste. */
export const MIN_VALID_RATE = 0.9;

/** Un tiers des cas, par hachage de l'identifiant : jamais choisis à la main. */
const HOLDOUT_MODULO = 3;

type Output = Record<string, unknown>;

const sayOf = (output: Output): string => (typeof output.say === 'string' ? output.say : '');

function lastSentence(text: string): string {
  return (
    (text.match(/[^.!?]+[.!?]*/g) ?? [])
      .map((sentence) => sentence.trim())
      .filter(Boolean)
      .pop() ?? ''
  );
}

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Hachage FNV-1a 32 bits : stable d'une exécution à l'autre, sans dépendance. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Calibration : on règle et on diagnostique dessus. Contrôle : on ne règle jamais dessus. */
export function splitOf(
  testCase: Pick<BehaviorCase, 'id' | 'split' | 'perturbation'>,
): BehaviorSplit {
  if (testCase.split) return testCase.split;
  const id = testCase.perturbation?.base ?? testCase.id;
  return hashString(id) % HOLDOUT_MODULO === 0 ? 'holdout' : 'calibration';
}

function rate(outputs: Output[], predicate: (output: Output) => boolean): number {
  return outputs.length ? outputs.filter(predicate).length / outputs.length : 0;
}

function sameValue(actual: unknown, expected: string | number): boolean {
  if (typeof expected === 'number') return actual === expected;
  return typeof actual === 'string' && actual.trim().toLowerCase() === expected.toLowerCase();
}

const EMPTY_DRAFT: StructuredTurnDraft = { date: '', time: '', partySize: 0, customerName: '' };

/** Brouillon sortant, mesuré après le garde-fou de l'épellation, comme dans le moteur. */
function outputDraft(output: Output, testCase: BehaviorCase): Record<string, unknown> | undefined {
  const draft = output.draft;
  if (!draft || typeof draft !== 'object') return undefined;
  return reconcileSpelledName(
    { ...EMPTY_DRAFT, ...(draft as Partial<StructuredTurnDraft>) },
    testCase.transcript,
    (testCase.awaiting ?? 'open') as never,
  ) as unknown as Record<string, unknown>;
}

function inputDraft(testCase: BehaviorCase): Record<string, unknown> {
  return { ...EMPTY_DRAFT, ...testCase.draft };
}

/** Le contrôle est-il tenu par CE tirage ? */
export function holds(predicate: SamplePredicate, output: Output, testCase: BehaviorCase): boolean {
  switch (predicate.kind) {
    case 'field': {
      const actual = output[predicate.path];
      if ('equals' in predicate && predicate.equals !== undefined) {
        return actual === predicate.equals;
      }
      return actual !== predicate.notEquals;
    }
    case 'fieldIn':
      return predicate.values.includes(output[predicate.path]);
    case 'draft':
      return sameValue(outputDraft(output, testCase)?.[predicate.field], predicate.equals);
    case 'draftUnchanged': {
      const draft = outputDraft(output, testCase);
      if (!draft) return false;
      const before = inputDraft(testCase);
      return predicate.fields.every((field) => {
        const actual = draft[field];
        const expected = before[field];
        return typeof expected === 'number'
          ? actual === expected
          : typeof actual === 'string' && actual.trim() === String(expected).trim();
      });
    }
    case 'say':
      return new RegExp(predicate.pattern, 'iu').test(sayOf(output)) === predicate.expect;
    case 'noRepeatOf':
      return !normalize(lastSentence(sayOf(output))).includes(normalize(predicate.text));
  }
}

function describe(predicate: SamplePredicate): string {
  switch (predicate.kind) {
    case 'field': {
      const wanted =
        predicate.equals !== undefined
          ? `= ${JSON.stringify(predicate.equals)}`
          : `≠ ${JSON.stringify(predicate.notEquals)}`;
      return `${predicate.path} ${wanted}`;
    }
    case 'fieldIn':
      return `${predicate.path} ∈ ${JSON.stringify(predicate.values)}`;
    case 'draft':
      return `draft.${predicate.field} = ${JSON.stringify(predicate.equals)}`;
    case 'draftUnchanged':
      return `draft.${predicate.fields.join(', ')} inchangé`;
    case 'say':
      return `phrase ${predicate.expect ? 'contient' : 'évite'} /${predicate.pattern}/`;
    case 'noRepeatOf':
      return `ne recopie pas « ${predicate.text} »`;
  }
}

function scoreCheck(check: BehaviorCheck, outputs: Output[], testCase: BehaviorCase): CheckResult {
  if (check.kind === 'sayWords') {
    const counts = outputs.map(
      (output) => sayOf(output).trim().split(/\s+/).filter(Boolean).length,
    );
    const mean = counts.length ? counts.reduce((sum, n) => sum + n, 0) / counts.length : 0;
    return {
      description: `moyenne de mots ≤ ${check.maxMean} (mesuré : ${mean.toFixed(1)})`,
      rate: mean,
      required: check.maxMean,
      passed: counts.length > 0 && mean <= check.maxMean,
    };
  }
  if (check.kind === 'anyOf') {
    const value = rate(outputs, (output) =>
      check.of.some((predicate) => holds(predicate, output, testCase)),
    );
    return done(check.of.map(describe).join(' OU '), value, check.minRate);
  }
  const value = rate(outputs, (output) => holds(check, output, testCase));
  return done(describe(check), value, check.minRate);
}

function done(description: string, value: number, required: number): CheckResult {
  return { description, rate: value, required, passed: value >= required };
}

/** Variantes générées et cas à vérité non établie : rapportés, jamais bloquants. */
export function isInformational(testCase: BehaviorCase): boolean {
  return Boolean(testCase.perturbation) || testCase.truthStatus === 'unverified';
}

export function scoreCase(testCase: BehaviorCase, samples: (Output | null)[]): CaseResult {
  const outputs = samples.filter((sample): sample is Output => sample !== null);
  const validRate = samples.length ? outputs.length / samples.length : 0;
  const checks = testCase.checks.map((check) => scoreCheck(check, outputs, testCase));
  return {
    id: testCase.id,
    behavior: testCase.behavior,
    split: splitOf(testCase),
    valid: outputs.length,
    samples: samples.length,
    informational: isInformational(testCase),
    passed: validRate >= MIN_VALID_RATE && checks.every((check) => check.passed),
    checks,
    ...(testCase.perturbation
      ? { perturbation: testCase.perturbation, successRate: checks[0]?.rate ?? 0 }
      : {}),
  };
}

export function scoreAll(cases: BehaviorCase[], responses: BehaviorResponses): CaseResult[] {
  return cases.map((testCase) => scoreCase(testCase, responses.responses[testCase.id] ?? []));
}

const PERTURBATION_KINDS: PerturbationKind[] = ['ablation', 'substitution', 'noise'];

function meanRate(results: CaseResult[]): number | null {
  if (!results.length) return null;
  return results.reduce((sum, result) => sum + (result.successRate ?? 0), 0) / results.length;
}

/** Indicateurs agrégés par découpage, à partir des variantes générées et des comportements tenus. */
export function summarize(results: CaseResult[]): BehaviorSummary {
  const summary = {} as BehaviorSummary;
  for (const split of ['calibration', 'holdout'] as const) {
    const inSplit = results.filter((result) => result.split === split);
    const blocking = inSplit.filter((result) => !result.informational);
    const usable = (kind: PerturbationKind) =>
      inSplit.filter(
        (result) =>
          result.perturbation?.kind === kind &&
          result.samples > 0 &&
          result.valid / result.samples >= MIN_VALID_RATE,
      );
    const ablation = usable('ablation');
    const substitution = usable('substitution');
    const noise = usable('noise');
    const ablationRate = meanRate(ablation);
    const entry: SplitSummary = {
      held: blocking.filter((result) => result.passed).length,
      total: blocking.length,
      variants: {
        ablation: ablation.length,
        substitution: substitution.length,
        noise: noise.length,
      },
      falseAcceptRate: ablationRate === null ? null : 1 - ablationRate,
      fidelityRate: meanRate(substitution),
      noiseRobustness: meanRate(noise),
    };
    summary[split] = entry;
  }
  return summary;
}

const percent = (value: number | null): string =>
  value === null ? 'n/a' : `${(value * 100).toFixed(0)} %`;

export function formatSummary(summary: BehaviorSummary): string {
  const lines = ['Indicateurs (variantes générées, par découpage) :'];
  for (const split of ['calibration', 'holdout'] as const) {
    const entry = summary[split];
    const counts = PERTURBATION_KINDS.map((kind) => `${kind} ${entry.variants[kind]}`).join(', ');
    lines.push(
      `  ${split} : comportements tenus ${entry.held}/${entry.total} ; ` +
        `fausse acceptation ${percent(entry.falseAcceptRate)} ; fidélité ${percent(entry.fidelityRate)} ; ` +
        `robustesse au bruit ${percent(entry.noiseRobustness)} (variantes : ${counts})`,
    );
  }
  return lines.join('\n');
}

export function formatReport(results: CaseResult[]): string {
  const lines: string[] = [];
  for (const result of results) {
    const mark = result.informational ? '·' : result.passed ? '✓' : '✗';
    lines.push(
      `${mark} ${result.id} [${result.behavior}] ${result.valid}/${result.samples} réponses valides` +
        (result.informational ? ' (informatif)' : ''),
    );
    for (const check of result.checks) {
      const measured = check.description.includes('mesuré')
        ? ''
        : result.informational
          ? ` : ${(check.rate * 100).toFixed(0)} %`
          : ` : ${(check.rate * 100).toFixed(0)} % (seuil ${(check.required * 100).toFixed(0)} %)`;
      const checkMark = result.informational ? '·' : check.passed ? '✓' : '✗';
      lines.push(`    ${checkMark} ${check.description}${measured}`);
    }
  }
  const blocking = results.filter((result) => !result.informational);
  const failed = blocking.filter((result) => !result.passed);
  lines.push('', `${blocking.length - failed.length}/${blocking.length} comportements tenus`);
  const informational = results.length - blocking.length;
  if (informational) lines.push(`${informational} cas informatifs (non bloquants)`);
  return lines.join('\n');
}

/** Écarts entre deux exécutions, cas par cas puis par indicateur : pour juger un changement. */
export function compareRuns(
  before: { results: CaseResult[]; summary: BehaviorSummary },
  after: { results: CaseResult[]; summary: BehaviorSummary },
): string {
  const lines: string[] = [];
  const previous = new Map(before.results.map((result) => [result.id, result]));
  for (const result of after.results) {
    const old = previous.get(result.id);
    if (!old) {
      lines.push(`+ ${result.id} : nouveau`);
      continue;
    }
    result.checks.forEach((check, index) => {
      const oldCheck = old.checks[index];
      if (!oldCheck) return;
      const delta = check.rate - oldCheck.rate;
      if (Math.abs(delta) < 0.005) return;
      lines.push(
        `${delta > 0 ? '▲' : '▼'} ${result.id} : ${check.description} : ` +
          `${(oldCheck.rate * 100).toFixed(0)} % → ${(check.rate * 100).toFixed(0)} %`,
      );
    });
  }
  for (const id of previous.keys()) {
    if (!after.results.some((result) => result.id === id)) lines.push(`- ${id} : retiré`);
  }
  lines.push('', 'Indicateurs :');
  for (const split of ['calibration', 'holdout'] as const) {
    const pair = (
      name: keyof Pick<SplitSummary, 'falseAcceptRate' | 'fidelityRate' | 'noiseRobustness'>,
    ) => `${name} ${percent(before.summary[split][name])} → ${percent(after.summary[split][name])}`;
    lines.push(
      `  ${split} : ${pair('falseAcceptRate')} ; ${pair('fidelityRate')} ; ${pair('noiseRobustness')}`,
    );
  }
  return lines.join('\n');
}

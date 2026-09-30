import { reconcileSpelledName } from '../stream/structured-turn/fact-guards';
import type { StructuredTurnDraft } from '../stream/structured-turn/schema';
import type {
  BehaviorCase,
  BehaviorCheck,
  BehaviorResponses,
  CaseResult,
  CheckResult,
} from './types';

/** En dessous, le modèle ou le réseau a un problème : le cas échoue quel que soit le reste. */
export const MIN_VALID_RATE = 0.9;

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

function rate(outputs: Output[], predicate: (output: Output) => boolean): number {
  return outputs.length ? outputs.filter(predicate).length / outputs.length : 0;
}

function sameValue(actual: unknown, expected: string | number): boolean {
  if (typeof expected === 'number') return actual === expected;
  return typeof actual === 'string' && actual.trim().toLowerCase() === expected.toLowerCase();
}

function scoreCheck(check: BehaviorCheck, outputs: Output[], testCase: BehaviorCase): CheckResult {
  switch (check.kind) {
    case 'field': {
      const value = rate(outputs, (output) => {
        const actual = output[check.path];
        if ('equals' in check && check.equals !== undefined) return actual === check.equals;
        return actual !== check.notEquals;
      });
      const wanted =
        check.equals !== undefined
          ? `= ${JSON.stringify(check.equals)}`
          : `≠ ${JSON.stringify(check.notEquals)}`;
      return done(`${check.path} ${wanted}`, value, check.minRate);
    }
    case 'draft': {
      // Le brouillon est mesuré après le garde-fou de l'épellation, comme dans le moteur.
      const value = rate(outputs, (output) => {
        const draft = output.draft as StructuredTurnDraft | undefined;
        const reconciled = draft
          ? reconcileSpelledName(draft, testCase.transcript, (testCase.awaiting ?? 'open') as never)
          : undefined;
        return sameValue((reconciled as Output | undefined)?.[check.field], check.equals);
      });
      return done(`draft.${check.field} = ${JSON.stringify(check.equals)}`, value, check.minRate);
    }
    case 'say': {
      const pattern = new RegExp(check.pattern, 'iu');
      const value = rate(outputs, (output) => pattern.test(sayOf(output)) === check.expect);
      return done(
        `phrase ${check.expect ? 'contient' : 'évite'} /${check.pattern}/`,
        value,
        check.minRate,
      );
    }
    case 'sayWords': {
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
    case 'noRepeatOf': {
      const banned = normalize(check.text);
      const value = rate(
        outputs,
        (output) => !normalize(lastSentence(sayOf(output))).includes(banned),
      );
      return done(`ne recopie pas « ${check.text} »`, value, check.minRate);
    }
  }
}

function done(description: string, value: number, required: number): CheckResult {
  return { description, rate: value, required, passed: value >= required };
}

export function scoreCase(testCase: BehaviorCase, samples: (Output | null)[]): CaseResult {
  const outputs = samples.filter((sample): sample is Output => sample !== null);
  const validRate = samples.length ? outputs.length / samples.length : 0;
  const checks = testCase.checks.map((check) => scoreCheck(check, outputs, testCase));
  return {
    id: testCase.id,
    behavior: testCase.behavior,
    valid: outputs.length,
    samples: samples.length,
    passed: validRate >= MIN_VALID_RATE && checks.every((check) => check.passed),
    checks,
  };
}

export function scoreAll(cases: BehaviorCase[], responses: BehaviorResponses): CaseResult[] {
  return cases.map((testCase) => scoreCase(testCase, responses.responses[testCase.id] ?? []));
}

export function formatReport(results: CaseResult[]): string {
  const lines: string[] = [];
  for (const result of results) {
    lines.push(
      `${result.passed ? '✓' : '✗'} ${result.id} [${result.behavior}] ${result.valid}/${result.samples} réponses valides`,
    );
    for (const check of result.checks) {
      const measured = check.description.includes('mesuré')
        ? ''
        : ` : ${(check.rate * 100).toFixed(0)} % (seuil ${(check.required * 100).toFixed(0)} %)`;
      lines.push(`    ${check.passed ? '✓' : '✗'} ${check.description}${measured}`);
    }
  }
  const failed = results.filter((result) => !result.passed);
  lines.push('', `${results.length - failed.length}/${results.length} comportements tenus`);
  return lines.join('\n');
}

import {
  authorizeStructuredAction,
  createStructuredTurnState,
  reconcileSpelledName,
  wordCount,
} from '../stream/structured-turn/fact-guards';
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

/**
 * Brouillon sortant. Par défaut la sortie BRUTE du modèle ; `guarded` applique le garde-fou de l'épellation
 * de fact-guards.ts (seul garde-fou qui retouche le brouillon), comme le moteur en appel. Les chiffres
 * d'épellation qui comptent sont les bruts : un garde-fou qui rattrape le modèle ne dit rien de ce que
 * comprend le prompt.
 */
function outputDraft(
  output: Output,
  testCase: BehaviorCase,
  guarded: boolean,
): Record<string, unknown> | undefined {
  const draft = output.draft;
  if (!draft || typeof draft !== 'object') return undefined;
  const complete = { ...EMPTY_DRAFT, ...(draft as Partial<StructuredTurnDraft>) };
  if (!guarded) return complete as unknown as Record<string, unknown>;
  return reconcileSpelledName(
    complete,
    testCase.transcript,
    (testCase.awaiting ?? 'open') as never,
    // Le moteur passe le nom du brouillon avant le tour : celui que l'agent vient de relire.
    testCase.draft?.customerName,
  ) as unknown as Record<string, unknown>;
}

function inputDraft(testCase: BehaviorCase): Record<string, unknown> {
  return { ...EMPTY_DRAFT, ...testCase.draft };
}

/** Le contrôle est-il tenu par CE tirage ? */
export function holds(
  predicate: SamplePredicate,
  output: Output,
  testCase: BehaviorCase,
  guarded = false,
): boolean {
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
      return sameValue(outputDraft(output, testCase, guarded)?.[predicate.field], predicate.equals);
    case 'draftUnchanged': {
      const draft = outputDraft(output, testCase, guarded);
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
    case 'hangsUp': {
      const state = {
        ...createStructuredTurnState(),
        reservationCreated: testCase.reservationCreated === true,
        lastAwaiting: (testCase.awaiting ?? 'none') as never,
      };
      const decision = authorizeStructuredAction(
        state,
        output as never,
        inputDraft(testCase) as never,
        { maxPartySize: 99, transcriptWords: wordCount(testCase.transcript) },
      );
      return (output.action === 'end_call' && decision.allowed) === predicate.expect;
    }
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
    case 'hangsUp':
      return predicate.expect
        ? 'raccroche (à travers le moteur)'
        : 'ne raccroche pas (à travers le moteur)';
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

/**
 * Un contrôle de tirage (tous les genres sauf la longueur moyenne, qui est une moyenne et non un oui/non).
 * Sert à la réussite d'un tirage entier, pour la comparaison A/B.
 */
function checkHolds(
  check: Exclude<BehaviorCheck, { kind: 'sayWords' }>,
  output: Output,
  testCase: BehaviorCase,
  guarded: boolean,
): boolean {
  return check.kind === 'anyOf'
    ? check.of.some((predicate) => holds(predicate, output, testCase, guarded))
    : holds(check, output, testCase, guarded);
}

/**
 * Le tirage tient-il TOUS les contrôles du cas ? Cas `engine` : après garde-fous du code, sinon sortie brute.
 * Les contrôles de longueur moyenne n'ont pas de sens pour un tirage seul : ils sont ignorés.
 */
export function drawSucceeds(testCase: BehaviorCase, output: Output): boolean {
  const guarded = testCase.measures === 'engine';
  return testCase.checks.every(
    (check) => check.kind === 'sayWords' || checkHolds(check, output, testCase, guarded),
  );
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
  return done(
    check.kind === 'anyOf' ? check.of.map(describe).join(' OU ') : describe(check),
    rate(outputs, (output) => checkHolds(check, output, testCase, false)),
    check.minRate,
    rate(outputs, (output) => checkHolds(check, output, testCase, true)),
    testCase.measures,
  );
}

function done(
  description: string,
  raw: number,
  required: number,
  guarded: number,
  measures: BehaviorCase['measures'],
): CheckResult {
  const differs = Math.abs(guarded - raw) > 1e-9;
  // Cas `model` : le chiffre est la sortie brute. Cas `engine` : celui d'après les garde-fous, avec le brut à côté.
  const value = measures === 'engine' ? guarded : raw;
  return {
    description,
    rate: value,
    required,
    passed: value >= required,
    // Seulement quand les garde-fous changent le résultat : sinon un seul chiffre suffit.
    ...(differs ? (measures === 'engine' ? { rawRate: raw } : { guardedRate: guarded }) : {}),
  };
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
    family: testCase.family,
    measures: testCase.measures,
    split: splitOf(testCase),
    valid: outputs.length,
    samples: samples.length,
    informational: isInformational(testCase),
    passed: validRate >= MIN_VALID_RATE && checks.every((check) => check.passed),
    checks,
    ...(testCase.perturbation
      ? {
          perturbation: testCase.perturbation,
          successRate: checks[0]?.rate ?? 0,
          guardedSuccessRate: checks[0]?.guardedRate ?? checks[0]?.rate ?? 0,
        }
      : {}),
  };
}

export function scoreAll(cases: BehaviorCase[], responses: BehaviorResponses): CaseResult[] {
  return cases.map((testCase) => scoreCase(testCase, responses.responses[testCase.id] ?? []));
}

const PERTURBATION_KINDS: PerturbationKind[] = ['ablation', 'substitution', 'noise'];

function meanRate(results: CaseResult[], guarded = false): number | null {
  if (!results.length) return null;
  const pick = (result: CaseResult) =>
    (guarded ? result.guardedSuccessRate : result.successRate) ?? 0;
  return results.reduce((sum, result) => sum + pick(result), 0) / results.length;
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
    const guardedAblationRate = meanRate(ablation, true);
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
      guarded: {
        falseAcceptRate: guardedAblationRate === null ? null : 1 - guardedAblationRate,
        fidelityRate: meanRate(substitution, true),
        noiseRobustness: meanRate(noise, true),
      },
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
    const g = entry.guarded;
    if (
      g.falseAcceptRate !== entry.falseAcceptRate ||
      g.fidelityRate !== entry.fidelityRate ||
      g.noiseRobustness !== entry.noiseRobustness
    ) {
      lines.push(
        `    après garde-fous du code : fausse acceptation ${percent(g.falseAcceptRate)} ; ` +
          `fidélité ${percent(g.fidelityRate)} ; robustesse au bruit ${percent(g.noiseRobustness)}`,
      );
    }
  }
  return lines.join('\n');
}

export function formatReport(results: CaseResult[]): string {
  const lines: string[] = [];
  for (const result of results) {
    const mark = result.informational ? '·' : result.passed ? '✓' : '✗';
    lines.push(
      `${mark} ${result.id} [${result.family} · mesure ${result.measures === 'engine' ? 'le moteur' : 'le modèle'}] ${result.valid}/${result.samples} réponses valides` +
        (result.informational ? ' (informatif)' : ''),
    );
    for (const check of result.checks) {
      const measured = check.description.includes('mesuré')
        ? ''
        : result.informational
          ? ` : ${(check.rate * 100).toFixed(0)} %`
          : ` : ${(check.rate * 100).toFixed(0)} % (seuil ${(check.required * 100).toFixed(0)} %)`;
      const checkMark = result.informational ? '·' : check.passed ? '✓' : '✗';
      // Le brut est le chiffre qui compte ; l'écart avec l'après garde-fous est ce que le code rattrape.
      const guarded =
        check.guardedRate !== undefined
          ? ` [brut ; après garde-fous : ${(check.guardedRate * 100).toFixed(0)} %]`
          : check.rawRate !== undefined
            ? ` [après garde-fous ; brut du modèle : ${(check.rawRate * 100).toFixed(0)} %]`
            : '';
      lines.push(`    ${checkMark} ${check.description}${measured}${guarded}`);
    }
  }
  const blocking = results.filter((result) => !result.informational);
  const failed = blocking.filter((result) => !result.passed);
  lines.push('', `${blocking.length - failed.length}/${blocking.length} comportements tenus`);
  const informational = results.length - blocking.length;
  if (informational) lines.push(`${informational} cas informatifs (non bloquants)`);
  return lines.join('\n');
}

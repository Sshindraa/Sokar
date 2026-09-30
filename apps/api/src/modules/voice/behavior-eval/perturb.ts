/**
 * Variantes dégradées des cas annotés : le modèle reçoit une transcription altérée et on mesure s'il
 * invente, suit ou ignore la valeur. Tout est généré à partir des cas eux-mêmes, de façon
 * déterministe (graine fixe) : aucune phrase n'est écrite à la main ici. Ce qui tient lieu de
 * « vérité » est une annotation du fichier de cas (`valueSpans`, `spanPool`), jamais une règle sur
 * des mots : le code ne sait pas ce qu'est une heure, il sait seulement quelle sous-chaîne l'annotation
 * désigne.
 *
 * - ablation : la sous-chaîne qui porte la valeur est retirée. Le brouillon ne doit pas changer, ou le
 *   modèle doit dire qu'il n'a pas compris (interpretation=unclear ou confidence=low).
 * - substitution : la sous-chaîne est remplacée par celle d'un autre appel, pour le même champ. Le
 *   brouillon doit porter la nouvelle valeur : le modèle suit la phrase, pas son a priori.
 * - bruit : un mot pris au hasard dans le corpus des cas est inséré à côté de la sous-chaîne. La valeur
 *   annotée doit rester extraite.
 *
 * Variantes informatives : seuils à fixer après la mesure de référence (minRate 0 ici).
 */
import { hashString } from './score';
import type {
  BehaviorCase,
  BehaviorCasesFile,
  PerturbationKind,
  SamplePredicate,
  SpanField,
  ValueSpan,
} from './types';

export const PERTURB_SEED = 20260930;
/** Tirages par variante : la suite reste sous le plafond de requêtes du rejeu. */
export const PERTURB_SAMPLES = 5;

export type BehaviorSuite = 'default' | 'perturb' | 'all';

/** PRNG mulberry32 : petit, stable, sans dépendance. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

const sameSpan = (a: ValueSpan, b: ValueSpan): boolean =>
  a.text === b.text || String(a.value).toLowerCase() === String(b.value).toLowerCase();

/** Tous les spans annotés d'un champ : les cas eux-mêmes puis le réservoir de spans réels. */
function spansOf(file: BehaviorCasesFile, field: SpanField): ValueSpan[] {
  const fromCases = file.cases.flatMap((testCase) => testCase.valueSpans?.[field] ?? []);
  return [...fromCases, ...(file.spanPool?.[field] ?? [])];
}

/** Mots du corpus des cas (phrases de l'appelant), hors ce qui porte une valeur annotée. */
function noiseWords(file: BehaviorCasesFile): string[] {
  const annotated = [
    ...file.cases.flatMap((testCase) => Object.values(testCase.valueSpans ?? {})),
    ...Object.values(file.spanPool ?? {}).flat(),
  ];
  const spanTokens = new Set(annotated.flatMap((span) => span.text.toLowerCase().split(/\s+/u)));
  const texts = [
    ...file.cases.map((testCase) => testCase.transcript),
    ...Object.values(file.histories ?? {}).flatMap((history) =>
      history.filter((message) => message.role === 'user').map((message) => message.content),
    ),
  ];
  const words = new Set<string>();
  for (const text of texts) {
    for (const raw of text.toLowerCase().split(/\s+/u)) {
      const word = raw.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
      if (word.length < 3 || /\d/.test(word) || spanTokens.has(word)) continue;
      words.add(word);
    }
  }
  return [...words].sort();
}

const unclearOrLowOrUnchanged = (field: SpanField): SamplePredicate[] => [
  { kind: 'draftUnchanged', fields: [field] },
  { kind: 'fieldIn', path: 'interpretation', values: ['unclear'] },
  { kind: 'fieldIn', path: 'confidence', values: ['low'] },
];

function variant(
  base: BehaviorCase,
  kind: PerturbationKind,
  field: SpanField,
  transcript: string,
  check: BehaviorCase['checks'][number],
): BehaviorCase {
  return {
    id: `${base.id}~${kind}~${field}`,
    behavior: `dégradation : ${kind}`,
    source: `variante « ${kind} » de ${base.id} (générée)`,
    history: base.history,
    transcript,
    ...(base.draft ? { draft: base.draft } : {}),
    ...(base.awaiting ? { awaiting: base.awaiting } : {}),
    ...(base.profile ? { profile: base.profile } : {}),
    ...(base.dayPart ? { dayPart: base.dayPart } : {}),
    ...(base.split ? { split: base.split } : {}),
    samples: PERTURB_SAMPLES,
    perturbation: { kind, base: base.id, field },
    checks: [check],
  };
}

/** Variantes dégradées de tous les cas annotés, dans un ordre et avec un contenu déterministes. */
export function generatePerturbations(
  file: BehaviorCasesFile,
  seed: number = PERTURB_SEED,
): BehaviorCase[] {
  const words = noiseWords(file);
  const variants: BehaviorCase[] = [];
  for (const base of file.cases) {
    for (const [fieldName, span] of Object.entries(base.valueSpans ?? {})) {
      const field = fieldName as SpanField;
      if (!base.transcript.includes(span.text)) {
        throw new Error(`Span « ${span.text} » absent de la phrase du cas ${base.id}`);
      }
      const random = prng(seed ^ hashString(`${base.id}/${field}`));
      const pick = <T>(list: T[]): T | undefined =>
        list.length ? list[Math.floor(random() * list.length)] : undefined;

      const ablated = collapse(base.transcript.replace(span.text, ' '));
      if (ablated) {
        variants.push(
          variant(base, 'ablation', field, ablated, {
            kind: 'anyOf',
            of: unclearOrLowOrUnchanged(field),
            minRate: 0,
          }),
        );
      }

      const donor = pick(spansOf(file, field).filter((other) => !sameSpan(other, span)));
      if (donor) {
        variants.push(
          variant(base, 'substitution', field, base.transcript.replace(span.text, donor.text), {
            kind: 'draft',
            field,
            equals: donor.value,
            minRate: 0,
          }),
        );
      }

      const word = pick(words);
      if (word) {
        const before = random() < 0.5;
        const transcript = base.transcript.replace(
          span.text,
          before ? `${word} ${span.text}` : `${span.text} ${word}`,
        );
        variants.push(
          variant(base, 'noise', field, transcript, {
            kind: 'draft',
            field,
            equals: span.value,
            minRate: 0,
          }),
        );
      }
    }
  }
  return variants;
}

/** Cas de la suite demandée ; `perturb` et `all` regénèrent les mêmes variantes à chaque appel. */
export function casesForSuite(file: BehaviorCasesFile, suite: BehaviorSuite): BehaviorCase[] {
  if (suite === 'default') return file.cases;
  const generated = generatePerturbations(file);
  return suite === 'perturb' ? generated : [...file.cases, ...generated];
}

/**
 * Comparaison de ce que le direct a entendu avec ce que les oreilles après coup entendent de la
 * même piste appelant. Comparaison structurelle (alignement, lettres isolées, chiffres) : aucune
 * liste de mots.
 */
import { alignTokens, divergenceRuns, type AlignOp } from './align';
import { tokenize } from './tokens';

export type EngineName = 'nova' | 'whisper';
export type DivergenceKind = 'isolated_letters' | 'number' | 'number_form' | 'word';
export type EarAgreement =
  /** Une seule oreille après coup, et elle diffère du direct. */
  | 'engine_differs'
  /** Les deux oreilles après coup entendent la même chose, contre le direct. */
  | 'engines_agree_against_live'
  /** Une oreille après coup rejoint le direct, l'autre diffère. */
  | 'one_engine_differs'
  /** Les trois entendent des choses différentes. */
  | 'all_differ';

export interface EarDivergence {
  kind: DivergenceKind;
  severity: 'high' | 'medium' | 'low';
  agreement: EarAgreement;
  /** Moteurs dont le texte diffère du direct. */
  differing: EngineName[];
  /** Les oreilles après coup se contredisent sur une lettre ou un nombre : signal fort. */
  strong: boolean;
  /** L'écart touche une épellation (lettres isolées voisines), pas une lettre seule. */
  inSpelling: boolean;
  /** Texte du direct, avec un jeton de contexte de chaque côté. */
  live: string;
  engines: Partial<Record<EngineName, string>>;
  /** Plage [début, fin[ en jetons du texte direct. */
  liveStart: number;
  liveEnd: number;
}

const isSingle = (token: string): boolean => token.length === 1;
const isLetter = (token: string): boolean => /^\p{L}$/u.test(token);
const hasDigit = (token: string): boolean => /\d/.test(token);

/**
 * Le jeton fait-il partie d'une épellation ? Une suite de jetons d'un seul caractère qui compte
 * deux lettres voisines (« h o u e t », « a m ») ou au moins trois lettres. Une lettre seule
 * (« il a », « à 8 h ») n'en est pas une.
 */
export function isSpelledAt(tokens: readonly string[], index: number): boolean {
  if (!isSingle(tokens[index] ?? '')) return false;
  let start = index;
  while (start > 0 && isSingle(tokens[start - 1])) start--;
  let end = index;
  while (end + 1 < tokens.length && isSingle(tokens[end + 1])) end++;
  const run = tokens.slice(start, end + 1);
  const letters = run.filter(isLetter).length;
  const adjacentLetters = run.some((token, i) => isLetter(token) && isLetter(run[i + 1] ?? ''));
  return adjacentLetters || letters >= 3;
}

interface Window {
  start: number;
  end: number;
}

interface EngineView {
  tokens: string[];
  ops: AlignOp[];
}

function sliceFor(
  view: EngineView,
  window: Window,
  liveLength: number,
): { text: string; tokens: string[]; spelled: boolean } {
  const picked: number[] = [];
  let refPos = 0;
  for (const op of view.ops) {
    if (op.type === 'ins') {
      // Une insertion appartient à la plage qui la suit ; la dernière plage garde celles de la fin du texte.
      const inside =
        refPos >= window.start &&
        (refPos < window.end || (refPos === window.end && window.end === liveLength));
      if (inside) picked.push(op.hypIndex);
      continue;
    }
    if (op.refIndex >= window.start && op.refIndex < window.end && op.type !== 'del') {
      picked.push(op.hypIndex);
    }
    refPos = op.refIndex + 1;
  }
  const tokens = picked.map((index) => view.tokens[index]);
  return {
    text: tokens.join(' '),
    tokens,
    spelled: picked.some((index) => isSpelledAt(view.tokens, index)),
  };
}

export function compareEars(input: {
  live: string;
  engines: Partial<Record<EngineName, string>>;
}): EarDivergence[] {
  const live = tokenize(input.live);
  const views = new Map<EngineName, EngineView>();
  const windows: Window[] = [];
  for (const [name, text] of Object.entries(input.engines) as [EngineName, string][]) {
    const tokens = tokenize(text);
    const ops = alignTokens(live, tokens);
    views.set(name, { tokens, ops });
    for (const run of divergenceRuns(live, tokens, ops)) {
      windows.push({
        start: Math.max(0, run.refStart - 1),
        end: Math.min(live.length, run.refStart + run.ref.length + 1),
      });
    }
  }
  windows.sort((a, b) => a.start - b.start);
  const merged: Window[] = [];
  for (const window of windows) {
    const last = merged[merged.length - 1];
    if (last && window.start <= last.end) last.end = Math.max(last.end, window.end);
    else merged.push({ ...window });
  }

  const pieces = merged;

  const result: EarDivergence[] = [];
  for (const window of pieces) {
    const liveTokens = live.slice(window.start, window.end);
    const liveText = liveTokens.join(' ');
    const inSpelling = liveTokens.some((_, i) => isSpelledAt(live, window.start + i));

    const texts: Partial<Record<EngineName, string>> = {};
    const differing: EngineName[] = [];
    let spelled = inSpelling;
    let isolatedLetter = false;
    let numberChange = false;
    let numberForm = false;
    for (const [name, view] of views) {
      const slice = sliceFor(view, window, live.length);
      texts[name] = slice.text;
      if (slice.text === liveText) continue;
      differing.push(name);
      spelled ||= slice.spelled;
      // Seuls les jetons qui diffèrent comptent (le contexte autour ne décide pas du genre d'écart).
      const core = divergenceRuns(liveTokens, slice.tokens, alignTokens(liveTokens, slice.tokens));
      for (const run of core) {
        if ([...run.ref, ...run.hyp].some(isLetter)) isolatedLetter = true;
        const liveDigits = run.ref.filter(hasDigit).join(' ');
        const otherDigits = run.hyp.filter(hasDigit).join(' ');
        if (liveDigits && otherDigits) numberChange ||= liveDigits !== otherDigits;
        else if (liveDigits || otherDigits) numberForm = true;
      }
    }
    if (differing.length === 0) continue;

    const kind: DivergenceKind = isolatedLetter
      ? 'isolated_letters'
      : numberChange
        ? 'number'
        : numberForm
          ? 'number_form'
          : 'word';
    const severity =
      kind === 'isolated_letters' || kind === 'number'
        ? 'high'
        : kind === 'word'
          ? 'low'
          : 'medium';

    const engineCount = views.size;
    let agreement: EarAgreement;
    if (engineCount === 1) agreement = 'engine_differs';
    else if (differing.length === 1) agreement = 'one_engine_differs';
    else
      agreement =
        new Set(differing.map((name) => texts[name])).size === 1
          ? 'engines_agree_against_live'
          : 'all_differ';

    const enginesDisagree = agreement === 'one_engine_differs' || agreement === 'all_differ';
    result.push({
      kind,
      severity,
      agreement,
      differing,
      strong: severity === 'high' && enginesDisagree,
      inSpelling: spelled,
      live: liveText,
      engines: texts,
      liveStart: window.start,
      liveEnd: window.end,
    });
  }
  return result;
}

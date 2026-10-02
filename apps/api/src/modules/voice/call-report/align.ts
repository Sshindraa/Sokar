/**
 * Alignement mot à mot de deux suites de jetons (distance d'édition pondérée).
 *
 * La substitution coûte moins qu'une suppression plus une insertion quand les deux mots se
 * ressemblent, pour que « assam » / « assan » soit un seul écart et non deux.
 */
export type AlignOp =
  | { type: 'match'; refIndex: number; hypIndex: number }
  | { type: 'sub'; refIndex: number; hypIndex: number }
  | { type: 'del'; refIndex: number }
  | { type: 'ins'; hypIndex: number };

function charDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

function substitutionCost(a: string, b: string): number {
  if (a === b) return 0;
  return 0.1 + (0.9 * charDistance(a, b)) / Math.max(a.length, b.length);
}

const GAP_COST = 1;

export function alignTokens(ref: readonly string[], hyp: readonly string[]): AlignOp[] {
  const rows = ref.length + 1;
  const cols = hyp.length + 1;
  const cost = Array.from({ length: rows }, () => new Float64Array(cols));
  for (let i = 1; i < rows; i++) cost[i][0] = i * GAP_COST;
  for (let j = 1; j < cols; j++) cost[0][j] = j * GAP_COST;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      cost[i][j] = Math.min(
        cost[i - 1][j - 1] + substitutionCost(ref[i - 1], hyp[j - 1]),
        cost[i - 1][j] + GAP_COST,
        cost[i][j - 1] + GAP_COST,
      );
    }
  }

  const ops: AlignOp[] = [];
  let i = ref.length;
  let j = hyp.length;
  const EPSILON = 1e-9;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const sub = substitutionCost(ref[i - 1], hyp[j - 1]);
      if (Math.abs(cost[i][j] - (cost[i - 1][j - 1] + sub)) < EPSILON) {
        ops.push({
          type: sub === 0 ? 'match' : 'sub',
          refIndex: i - 1,
          hypIndex: j - 1,
        });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && Math.abs(cost[i][j] - (cost[i - 1][j] + GAP_COST)) < EPSILON) {
      ops.push({ type: 'del', refIndex: i - 1 });
      i--;
    } else {
      ops.push({ type: 'ins', hypIndex: j - 1 });
      j--;
    }
  }
  return ops.reverse();
}

export interface DivergenceRun {
  /** Jetons de la référence concernés (vide pour une pure insertion). */
  ref: string[];
  /** Jetons de l'autre transcription concernés (vide pour une pure suppression). */
  hyp: string[];
  /** Position du premier jeton de la référence ; en cas de pure insertion, position où elle s'insère. */
  refStart: number;
  hypStart: number;
}

/** Regroupe les écarts consécutifs de l'alignement en plages. */
export function divergenceRuns(
  ref: readonly string[],
  hyp: readonly string[],
  ops: readonly AlignOp[],
): DivergenceRun[] {
  const runs: DivergenceRun[] = [];
  let current: DivergenceRun | null = null;
  let refPos = 0;
  let hypPos = 0;
  for (const op of ops) {
    if (op.type === 'match') {
      current = null;
      refPos = op.refIndex + 1;
      hypPos = op.hypIndex + 1;
      continue;
    }
    if (!current) {
      current = { ref: [], hyp: [], refStart: refPos, hypStart: hypPos };
      runs.push(current);
    }
    if (op.type === 'sub' || op.type === 'del') {
      current.ref.push(ref[op.refIndex]);
      refPos = op.refIndex + 1;
    }
    if (op.type === 'sub' || op.type === 'ins') {
      current.hyp.push(hyp[op.hypIndex]);
      hypPos = op.hypIndex + 1;
    }
  }
  return runs;
}
